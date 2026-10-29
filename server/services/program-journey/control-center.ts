/**
 * S27 — owner Control Center aggregate (ControlCenterView), computed server-side from existing data.
 *
 * Two parts: loadControlCenterFacts() runs bounded read-only SQL (every query has a LIMIT); buildControlCenter()
 * is pure (facts + clock in, view out) so the rules are unit-testable.
 *
 * Synthetic demo accounts (preferred_name starting with DEMO) appear as student rows with isDemo = true but never
 * produce queue items, deadlines, payment figures, support windows or counts. Dates are UTC calendar days.
 */
import { sql } from "drizzle-orm";
import { isDemoPreferredName } from "@shared/synthetic-accounts";
import { allocateReceipts } from "@shared/billing-ledger";
import type { ControlCenterView, ControlQueueItem, ControlStudentRow, QueueKind } from "@shared/s27-contract";
import {
  buildPaceInput,
  computeDeadlines,
  computePace,
  computeSupport,
  daysBetween,
  isLogged,
  type AwardRowLike,
  type PlanContentLike,
  type ProgressRowLike,
} from "./math";
import type { SqlExecutor } from "./service";

export const LOW_SCORE_PERCENT = 65;
export const LOW_SCORE_WINDOW_DAYS = 14;
export const INACTIVE_DAYS = 7;
export const DEADLINE_WINDOW_DAYS = 14;
export const PAYMENT_SOON_DAYS = 7;
export const ELECTIVE_SUBJECT_PREFIX = "Elective change request:";
const STUDENT_LIMIT = 500;

export interface CcStudent { id: string; code: string | null; name: string; preferredName: string | null; userId: string | null }
export interface CcEnrollment { id: string; studentId: string; status: string; requiredHalfUnits: number; startedOn: string | null; createdAt: string; content: (PlanContentLike & { courses?: ReadonlyArray<{ key: string; title?: string; halfUnits: number; status: string; tasks?: ReadonlyArray<{ key: string; kind: "lesson" | "exam" | "project" }> }> }) | null }
export interface CcAgreement {
  studentId: string; signedOn: string | null; activatedOn: string | null; supportMonths: number; accessMonths: number;
  languageTestDays: number; priorSchoolingDays: number; languageTestStatus: "open" | "done" | "waived"; languageTestDoneOn: string | null;
  priorSchoolingStatus: "open" | "done" | "waived"; priorSchoolingDoneOn: string | null;
}
export interface CcBilling {
  studentId: string; currency: string; agreedCents: number; discountCents: number; paidCents: number;
  installments: Array<{ id: string; dueDate: string; amountCents: number; sortOrder: number; label: string | null }>;
}
export interface CcTicket { id: string; studentId: string; subject: string; status: string; createdAt: string }
export interface CcResult { studentId: string; courseKey: string; taskKey: string | null; outcome: string }
export interface ControlCenterFacts {
  students: CcStudent[];
  enrollments: CcEnrollment[];
  progress: Array<ProgressRowLike & { studentId: string; enrollmentId: string }>;
  awards: Array<AwardRowLike & { studentId: string; enrollmentId: string }>;
  results: Array<CcResult & { enrollmentId: string }>;
  agreements: CcAgreement[];
  pendingDocuments: Array<{ studentId: string; count: number }>;
  evidenceAwaiting: Array<{ studentId: string; count: number }>;
  billing: CcBilling[];
  receiptsThisMonth: Array<{ studentId: string; amountCents: number }>;
  tickets: CcTicket[];
  sessionRequests: Array<{ id: string; studentId: string; slotAt: string }>;
  /** True when any row cap was hit while loading (the view is then incomplete). */
  truncated: boolean;
}

const isDemo = (s: CcStudent) => isDemoPreferredName(s.preferredName);
const groupBy = <T,>(xs: readonly T[], key: (x: T) => string) => {
  const m = new Map<string, T[]>();
  for (const x of xs) { const k = key(x); const a = m.get(k); if (a) a.push(x); else m.set(k, [x]); }
  return m;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildControlCenter(facts: ControlCenterFacts, now: Date): ControlCenterView {
  const today = now.toISOString().slice(0, 10);
  const nowMs = now.getTime();
  const queue: ControlQueueItem[] = [];
  const deadlines: ControlCenterView["deadlines"][number][] = [];
  const supportWindows: { studentId: string; studentName: string; monthsLeft: number }[] = [];
  const rowsOut: ControlStudentRow[] = [];
  const queueByStudent = new Map<string, ControlQueueItem[]>();

  const enrollmentsBy = groupBy(facts.enrollments, (e) => e.studentId);
  const progressBy = groupBy(facts.progress, (p) => p.enrollmentId);
  const awardsBy = groupBy(facts.awards, (a) => a.enrollmentId);
  const resultsBy = groupBy(facts.results, (r) => r.enrollmentId);
  const agreementBy = new Map(facts.agreements.map((a) => [a.studentId, a] as const));
  const billingBy = new Map(facts.billing.map((b) => [b.studentId, b] as const));
  const docsBy = new Map(facts.pendingDocuments.map((d) => [d.studentId, d.count] as const));
  const evidenceBy = new Map(facts.evidenceAwaiting.map((d) => [d.studentId, d.count] as const));
  const ticketsBy = groupBy(facts.tickets, (t) => t.studentId);
  const sessionsBy = groupBy(facts.sessionRequests, (s) => s.studentId);
  const demoIds = new Set(facts.students.filter(isDemo).map((s) => s.id));

  let signedNotPaid = 0;
  let overdueInstallments = 0;
  let flying = 0;
  let preEnrollment = 0;
  const currencyVotes = new Map<string, number>();

  for (const s of facts.students) {
    const demo = isDemo(s);
    const items: ControlQueueItem[] = [];
    const href = (tab: string) => `/admin/students/${encodeURIComponent(s.id)}?tab=${tab}`;
    const add = (kind: QueueKind, severity: ControlQueueItem["severity"], title: string, detail: string, to: string, at: string | null = null, idSuffix = "") =>
      items.push({ id: `${kind}:${s.id}${idSuffix}`, kind, severity, studentId: s.id, studentName: s.name, title, detail, href: to, at });

    const open = (enrollmentsBy.get(s.id) ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
    const agreement = agreementBy.get(s.id) ?? null;
    const progress = open ? progressBy.get(open.id) ?? [] : [];
    const awards = open ? awardsBy.get(open.id) ?? [] : [];

    // ── documents and payment evidence awaiting staff review
    const docs = docsBy.get(s.id) ?? 0;
    if (docs > 0) add("document_review", "warning", `${plural(docs, "document")} to review`, "Uploaded by the student and waiting for verification.", href("documents"));
    const evidence = evidenceBy.get(s.id) ?? 0;
    if (evidence > 0) add("payment_evidence", "warning", `${plural(evidence, "payment proof", "payment proofs")} to review`, "Payment evidence submitted by the student, awaiting confirmation.", href("billing"));

    // ── billing: overdue / soon-due installments, signed but unpaid
    const bill = billingBy.get(s.id) ?? null;
    let nextInstallment: { label: string; dueOn: string; daysLeft: number } | null = null;
    if (bill) {
      const alloc = allocateReceipts(bill.installments.map((i) => ({ id: i.id, dueDate: i.dueDate, amountCents: i.amountCents, label: i.label, sortOrder: i.sortOrder })), bill.paidCents, today);
      const unpaid = alloc.filter((i) => i.status !== "paid");
      const overdue = unpaid.filter((i) => i.status === "overdue");
      const soon = unpaid.filter((i) => i.status !== "overdue" && daysBetween(today, i.dueDate) <= PAYMENT_SOON_DAYS);
      if (!demo) overdueInstallments += overdue.length;
      if (overdue.length) {
        const first = overdue[0]!;
        add("payment_overdue", "critical", `${plural(overdue.length, "installment")} overdue`, `Oldest was due ${first.dueDate} (${daysBetween(first.dueDate, today)} days ago).`, href("billing"), first.dueDate);
      } else if (soon.length) {
        const first = soon[0]!;
        const d = daysBetween(today, first.dueDate);
        add("payment_overdue", "warning", d === 0 ? "Installment due today" : `Installment due in ${plural(d, "day")}`, `Due ${first.dueDate}.`, href("billing"), first.dueDate);
      }
      if (unpaid[0]) nextInstallment = { label: "Installment due", dueOn: unpaid[0].dueDate, daysLeft: daysBetween(today, unpaid[0].dueDate) };
    }
    if (agreement?.signedOn && (bill?.paidCents ?? 0) === 0) {
      if (!demo) signedNotPaid += 1;
      add("payment_missing", "warning", "Signed, no payment recorded", `Agreement signed ${agreement.signedOn}; no payment has been confirmed yet.`, href("billing"), agreement.signedOn);
    }

    // ── agreement deadlines within 14 days (overdue included)
    let nextDeadline: ControlStudentRow["nextDeadline"] = null;
    let supportMonthsLeft: number | null = null;
    if (agreement) {
      const terms = { ...agreement, languageTestScore: null, languageTestTarget: null };
      const open14 = computeDeadlines(terms, today).filter((d) => d.dueOn && d.status === "open" && d.daysLeft !== null);
      for (const d of open14) {
        if (d.daysLeft! <= DEADLINE_WINDOW_DAYS) {
          if (!demo) deadlines.push({ studentId: s.id, studentName: s.name, label: d.label, dueOn: d.dueOn!, daysLeft: d.daysLeft! });
          add("deadline_soon", d.daysLeft! < 0 ? "critical" : d.daysLeft! <= 7 ? "warning" : "info",
            d.daysLeft! < 0 ? `${d.label} overdue` : `${d.label} due in ${plural(d.daysLeft!, "day")}`, `${d.rule}; due ${d.dueOn}.`, href("overview"), d.dueOn, `:${d.key}`);
        }
      }
      const cands = [...open14.map((d) => ({ label: d.label, dueOn: d.dueOn!, daysLeft: d.daysLeft! })), ...(nextInstallment ? [nextInstallment] : [])].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
      nextDeadline = cands[0] ?? null;
      const support = computeSupport(agreement, today);
      supportMonthsLeft = support.supportMonthsLeft;
      if (!demo && supportMonthsLeft !== null) supportWindows.push({ studentId: s.id, studentName: s.name, monthsLeft: supportMonthsLeft });
    }

    // ── high-school activity: inactive, low scores, school result needed, pace
    let creditsConfirmed = 0;
    let paceLabel: string | null = null;
    let estimatedFinishOn: string | null = null;
    let lastActivityOn: string | null = null;
    if (open?.content) {
      const logs = progress.map((p) => p.updatedAt).sort();
      lastActivityOn = logs.length ? logs[logs.length - 1]!.slice(0, 10) : null;
      creditsConfirmed = awards.reduce((n, a) => n + a.halfUnits, 0) / 2;
      const pace = computePace(buildPaceInput({ today, requiredHalfUnits: open.requiredHalfUnits, content: open.content, progress, awards }));
      paceLabel = pace.stale && pace.itemsLogged28d === 0 ? "No recent work logged" : `${pace.creditsPerWeek ?? 0} credits per week`;
      estimatedFinishOn = pace.creditsPerWeek ? pace.estimatedFinishOn : null;

      if (open.status === "active") {
        const ref = lastActivityOn ?? open.startedOn ?? open.createdAt.slice(0, 10);
        if (daysBetween(ref, today) >= INACTIVE_DAYS) add("inactive", "warning", "No activity logged", `Nothing logged since ${ref} (${plural(daysBetween(ref, today), "day")}).`, href("roadmap"), ref);
      }
      const cutoff = nowMs - LOW_SCORE_WINDOW_DAYS * 86_400_000;
      const low = progress.filter((p) => p.reportedScorePercent !== null && p.reportedScorePercent < LOW_SCORE_PERCENT && Date.parse(p.updatedAt) >= cutoff);
      if (low.length) {
        const lowest = Math.min(...low.map((p) => p.reportedScorePercent!));
        add("low_grade", "warning", `${plural(low.length, "low reported score")}`, `Lowest reported ${lowest}% (below ${LOW_SCORE_PERCENT}%) in the last ${LOW_SCORE_WINDOW_DAYS} days. Student-reported, not official.`, href("roadmap"), low.map((p) => p.updatedAt).sort().pop() ?? null);
      }
      const results = resultsBy.get(open.id) ?? [];
      const officialCourse = new Set(results.filter((r) => r.taskKey === null).map((r) => r.courseKey));
      const taskPassed = new Set(results.filter((r) => r.taskKey !== null && r.outcome === "passed").map((r) => `${r.courseKey}\u0000${r.taskKey}`));
      const reported = new Set(progress.filter((p) => isLogged(p)).map((p) => `${p.courseKey}\u0000${p.taskKey}`));
      const needing = (open.content.courses ?? []).filter((c) => c.status === "planned" && (c.tasks?.length ?? 0) > 0 && !officialCourse.has(c.key)
        && c.tasks!.every((t) => reported.has(`${c.key}\u0000${t.key}`) || taskPassed.has(`${c.key}\u0000${t.key}`)));
      if (needing.length) {
        add("school_result_needed", "warning", `${plural(needing.length, "course")} need${needing.length === 1 ? "s" : ""} the school's result`,
          `All work reported for ${needing.slice(0, 3).map((c) => (c.title ?? c.key).split(" — ")[0]).join(", ")}${needing.length > 3 ? ", …" : ""}; no official course result recorded yet.`, href("roadmap"));
      }
    }

    // ── tickets, elective requests, session requests
    for (const t of ticketsBy.get(s.id) ?? []) {
      if (t.subject.startsWith(ELECTIVE_SUBJECT_PREFIX)) {
        add("elective_approval", "info", "Elective change request", `${t.subject.slice(ELECTIVE_SUBJECT_PREFIX.length).trim().slice(0, 100)}`, `/admin/elective-requests?ticket=${encodeURIComponent(t.id)}`, t.createdAt, `:${t.id}`);
      } else if (t.status === "open") {
        add("support_reply", "warning", "Support ticket waiting on staff", t.subject.slice(0, 100), `/admin/support-center?ticket=${encodeURIComponent(t.id)}`, t.createdAt, `:${t.id}`);
      }
    }
    for (const r of sessionsBy.get(s.id) ?? []) {
      add("session_request", "info", "Orientation session requested", `Requested slot ${r.slotAt.slice(0, 16).replace("T", " ")} UTC.`, href("sessions"), r.slotAt, `:${r.id}`);
    }

    // ── row
    const preEnrolled = open?.status === "planned" || (!!agreement && !agreement.activatedOn);
    const worst = items.some((i) => i.severity === "critical") ? "critical" : items.some((i) => i.severity === "warning") ? "warning" : null;
    const status: ControlStudentRow["status"] = !open && !agreement ? { tone: "neutral", label: "No program yet" }
      : worst === "critical" ? { tone: "critical", label: "Needs you" }
      : worst === "warning" ? { tone: "warning", label: "Attention" }
      : preEnrolled ? { tone: "gold", label: "Pre-enrollment" }
      : { tone: "ok", label: "On track" };
    rowsOut.push({
      studentId: s.id, name: s.name, code: s.code, program: open ? "high_school" : "none", isDemo: demo,
      creditsConfirmed, creditsRequired: open ? open.requiredHalfUnits / 2 : null, paceLabel, estimatedFinishOn, status, nextDeadline, lastActivityOn, supportMonthsLeft,
    });
    if (!demo) {
      queue.push(...items);
      queueByStudent.set(s.id, items);
      if (preEnrolled) preEnrollment += 1;
      else if (open?.status === "active" && status.tone === "ok") flying += 1;
      if (bill) currencyVotes.set(bill.currency, (currencyVotes.get(bill.currency) ?? 0) + 1);
    }
  }

  const sev = { critical: 0, warning: 1, info: 2 } as const;
  queue.sort((a, b) => sev[a.severity] - sev[b.severity] || (a.at ?? "9999").localeCompare(b.at ?? "9999") || a.id.localeCompare(b.id));
  deadlines.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  supportWindows.sort((a, b) => a.monthsLeft - b.monthsLeft);
  const received = facts.receiptsThisMonth.filter((r) => !demoIds.has(r.studentId)).reduce((n, r) => n + r.amountCents, 0);
  const currency = [...currencyVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    generatedAt: now.toISOString(),
    truncated: facts.truncated,
    queue,
    students: rowsOut,
    deadlines,
    payments: { receivedThisMonthCents: received, currency, signedNotPaid, overdueInstallments },
    supportWindows,
    counts: { needsYou: [...queueByStudent.values()].filter((v) => v.length > 0).length, flying, deadlines14d: deadlines.length, preEnrollment },
  };
}

// ── facts (bounded read-only SQL) ────────────────────────────────────────────

type Row = Record<string, unknown>;
const rows = (r: unknown): Row[] => Array.from(r as Row[]);
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** Per-query row caps. Hitting any cap (or the student cap) sets ControlCenterView.truncated. */
export const CC_LIMITS = { students: STUDENT_LIMIT, progress: 20000, awards: 20000, results: 20000, installments: 5000, tickets: 300, sessions: 200 } as const;

export async function loadControlCenterFacts(db: SqlExecutor, now: Date, limits: typeof CC_LIMITS = CC_LIMITS): Promise<ControlCenterFacts> {
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const OPEN = sql`('planned','active','on_hold')`;
  let truncated = false;
  // Fetch one extra row to detect that a cap was hit; every list is cut to its cap afterwards.
  const capped = <T,>(list: T[], cap: number): T[] => { if (list.length > cap) { truncated = true; return list.slice(0, cap); } return list; };

  const studentRows = capped(rows(await db.execute(sql`SELECT id, student_code, first_name, last_name, preferred_name, user_id FROM students ORDER BY created_at DESC, id LIMIT ${limits.students + 1}`)), limits.students);
  const ids = studentRows.map((r) => String(r.id));
  // Every other query is restricted to the students actually loaded, with a deterministic order.
  const IN = ids.length ? sql`(${sql.join(ids.map((i) => sql`${i}`), sql`, `)})` : sql`(NULL)`;
  const [enrollments, progress, awards, results, agreements, docs, evidence, obligations, discounts, receipts, installments, monthReceipts, tickets, sessions] = await Promise.all([
    db.execute(sql`SELECT e.id, e.student_id, e.status, e.total_required_half_units, e.started_on::text AS started_on, e.created_at, v.content
                     FROM hs_enrollments e LEFT JOIN hs_roadmap_versions v ON v.enrollment_id = e.id AND v.status = 'published'
                    WHERE e.status IN ${OPEN} AND e.student_id IN ${IN} ORDER BY e.created_at DESC, e.id`),
    db.execute(sql`SELECT p.enrollment_id, p.student_id, p.course_key, p.task_key, p.status, p.reported_score_percent, p.updated_at
                     FROM hs_task_progress p JOIN hs_enrollments e ON e.id = p.enrollment_id WHERE e.status IN ${OPEN} AND p.student_id IN ${IN}
                    ORDER BY p.updated_at DESC, p.id LIMIT ${limits.progress + 1}`),
    db.execute(sql`SELECT a.enrollment_id, a.student_id, a.course_key, a.source, a.half_units
                     FROM hs_credit_awards a JOIN hs_enrollments e ON e.id = a.enrollment_id WHERE a.status = 'active' AND e.status IN ${OPEN} AND a.student_id IN ${IN}
                    ORDER BY a.recorded_at DESC, a.id LIMIT ${limits.awards + 1}`),
    db.execute(sql`SELECT r.enrollment_id, r.student_id, r.course_key, r.task_key, r.outcome
                     FROM hs_official_results r JOIN hs_enrollments e ON e.id = r.enrollment_id WHERE r.status = 'active' AND e.status IN ${OPEN} AND r.student_id IN ${IN}
                    ORDER BY r.recorded_at DESC, r.id LIMIT ${limits.results + 1}`),
    db.execute(sql`SELECT student_id, signed_on::text AS signed_on, activated_on::text AS activated_on, support_months, access_months, language_test_days, prior_schooling_days,
                          language_test_status, language_test_done_on::text AS language_test_done_on, prior_schooling_status, prior_schooling_done_on::text AS prior_schooling_done_on
                     FROM student_agreements WHERE student_id IN ${IN} ORDER BY student_id`),
    db.execute(sql`SELECT student_id, count(*)::int AS n FROM student_documents WHERE status = 'pending' AND soft_deleted = false AND doc_type <> 'chat_attachment' AND student_id IN ${IN} GROUP BY student_id ORDER BY student_id`),
    db.execute(sql`SELECT student_id, count(*)::int AS n FROM student_billing_evidence WHERE status = 'awaiting_review' AND student_id IN ${IN} GROUP BY student_id ORDER BY student_id`),
    db.execute(sql`SELECT student_id, agreed_cents::bigint AS agreed_cents, currency FROM student_billing_obligations WHERE student_id IN ${IN} ORDER BY student_id`),
    db.execute(sql`SELECT student_id, COALESCE(SUM(amount_cents),0)::bigint AS total FROM student_billing_discounts WHERE voided_at IS NULL AND student_id IN ${IN} GROUP BY student_id ORDER BY student_id`),
    db.execute(sql`SELECT student_id, COALESCE(SUM(amount_cents),0)::bigint AS total FROM student_billing_receipts WHERE voided_at IS NULL AND student_id IN ${IN} GROUP BY student_id ORDER BY student_id`),
    db.execute(sql`SELECT id, student_id, due_date::text AS due_date, amount_cents::bigint AS amount_cents, label, sort_order FROM student_billing_installments
                    WHERE student_id IN ${IN} ORDER BY due_date, sort_order, id LIMIT ${limits.installments + 1}`),
    db.execute(sql`SELECT student_id, COALESCE(SUM(amount_cents),0)::bigint AS total FROM student_billing_receipts WHERE voided_at IS NULL AND received_date >= ${monthStart}::date AND student_id IN ${IN} GROUP BY student_id ORDER BY student_id`),
    db.execute(sql`SELECT t.id, t.subject, t.status, t.created_at, s.id AS student_id FROM support_tickets t JOIN students s ON s.user_id = t.reporter_id
                    WHERE t.status IN ('open','in_progress','waiting_on_student') AND s.id IN ${IN} ORDER BY t.created_at, t.id LIMIT ${limits.tickets + 1}`),
    db.execute(sql`SELECT id, student_id, slot_at FROM orientation_sessions WHERE status = 'requested' AND student_id IN ${IN} ORDER BY slot_at, id LIMIT ${limits.sessions + 1}`),
  ]);
  const cap = (r: unknown, n: number) => capped(rows(r), n);
  const progressRows = cap(progress, limits.progress);
  const awardRows = cap(awards, limits.awards);
  const resultRows = cap(results, limits.results);
  const installmentRows = cap(installments, limits.installments);
  const ticketRows = cap(tickets, limits.tickets);
  const sessionRows = cap(sessions, limits.sessions);

  const discBy = new Map(rows(discounts).map((r) => [String(r.student_id), Number(r.total)] as const));
  const paidBy = new Map(rows(receipts).map((r) => [String(r.student_id), Number(r.total)] as const));
  const instBy = groupBy(installmentRows, (r) => String(r.student_id));
  return {
    students: studentRows.map((r) => ({ id: String(r.id), code: str(r.student_code), name: `${r.first_name} ${r.last_name}`.trim(), preferredName: str(r.preferred_name), userId: str(r.user_id) })),
    enrollments: rows(enrollments).map((r) => ({ id: String(r.id), studentId: String(r.student_id), status: String(r.status), requiredHalfUnits: Number(r.total_required_half_units), startedOn: str(r.started_on), createdAt: iso(r.created_at), content: (r.content as CcEnrollment["content"]) ?? null })),
    progress: progressRows.map((r) => ({ enrollmentId: String(r.enrollment_id), studentId: String(r.student_id), courseKey: String(r.course_key), taskKey: String(r.task_key), status: String(r.status), reportedScorePercent: r.reported_score_percent === null ? null : Number(r.reported_score_percent), updatedAt: iso(r.updated_at) })),
    awards: awardRows.map((r) => ({ enrollmentId: String(r.enrollment_id), studentId: String(r.student_id), courseKey: str(r.course_key), source: String(r.source), halfUnits: Number(r.half_units) })),
    results: resultRows.map((r) => ({ enrollmentId: String(r.enrollment_id), studentId: String(r.student_id), courseKey: String(r.course_key), taskKey: str(r.task_key), outcome: String(r.outcome) })),
    agreements: rows(agreements).map((r) => ({
      studentId: String(r.student_id), signedOn: str(r.signed_on), activatedOn: str(r.activated_on), supportMonths: Number(r.support_months), accessMonths: Number(r.access_months),
      languageTestDays: Number(r.language_test_days), priorSchoolingDays: Number(r.prior_schooling_days),
      languageTestStatus: r.language_test_status as CcAgreement["languageTestStatus"], languageTestDoneOn: str(r.language_test_done_on),
      priorSchoolingStatus: r.prior_schooling_status as CcAgreement["priorSchoolingStatus"], priorSchoolingDoneOn: str(r.prior_schooling_done_on),
    })),
    pendingDocuments: rows(docs).map((r) => ({ studentId: String(r.student_id), count: Number(r.n) })),
    evidenceAwaiting: rows(evidence).map((r) => ({ studentId: String(r.student_id), count: Number(r.n) })),
    billing: rows(obligations).map((r) => ({
      studentId: String(r.student_id), currency: String(r.currency), agreedCents: Number(r.agreed_cents), discountCents: discBy.get(String(r.student_id)) ?? 0,
      paidCents: paidBy.get(String(r.student_id)) ?? 0,
      installments: (instBy.get(String(r.student_id)) ?? []).map((i) => ({ id: String(i.id), dueDate: String(i.due_date), amountCents: Number(i.amount_cents), sortOrder: Number(i.sort_order), label: str(i.label) })),
    })),
    receiptsThisMonth: rows(monthReceipts).map((r) => ({ studentId: String(r.student_id), amountCents: Number(r.total) })),
    tickets: ticketRows.map((r) => ({ id: String(r.id), studentId: String(r.student_id), subject: String(r.subject), status: String(r.status), createdAt: iso(r.created_at) })),
    sessionRequests: sessionRows.map((r) => ({ id: String(r.id), studentId: String(r.student_id), slotAt: iso(r.slot_at) })),
    truncated,
  };
}

export async function computeControlCenter(db: SqlExecutor, now: Date): Promise<ControlCenterView> {
  return buildControlCenter(await loadControlCenterFacts(db, now), now);
}

