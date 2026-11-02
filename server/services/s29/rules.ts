/**
 * S29 — deterministic rules engine ("Needs Attention").
 *
 * One source of truth: the S27 Control Center rules (buildControlCenter over loadControlCenterFacts) produce the
 * base exceptions; this module adds the S29 rules (missed / upcoming coordination checkpoints, confirmed orientation
 * sessions coming up, imported school results awaiting verification, failed notifications) and normalises every
 * exception into an AttentionCandidate: what, who, why (recorded facts), when, priority, next action, link.
 *
 * Pure: buildAttention(facts, extra, settings, now) has no I/O; loadAttentionInputs() runs bounded read-only SQL.
 * Synthetic demo students produce candidates flagged isDemo (shown labelled, never counted in real totals).
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { isDemoPreferredName } from "@shared/synthetic-accounts";
import type { ControlQueueItem } from "@shared/s27-contract";
import type { AttentionKind, AttentionPriority, AttentionWorkflow, ConciergeSettings } from "@shared/s29-contract";
import { buildControlCenter, loadControlCenterFacts, type ControlCenterFacts } from "../program-journey/control-center";
import { daysBetween } from "../program-journey/math";
import { errorCode, rows, iso, isoReq, str, type SqlExecutor } from "./db";

export interface AttentionCandidate {
  readonly key: string;
  readonly kind: AttentionKind;
  readonly workflow: AttentionWorkflow;
  readonly priority: AttentionPriority;
  readonly studentId: string | null;
  readonly studentName: string | null;
  readonly studentCode: string | null;
  readonly isDemo: boolean;
  readonly title: string;
  readonly detail: string;
  readonly reason: { readonly rule: string; readonly facts: Readonly<Record<string, string | number | boolean | null>> };
  readonly fingerprint: string;
  readonly arisenAt: string | null;
  readonly action: string;
  readonly href: string;
}

export interface AttentionExtraFacts {
  /** Lumière coordination checkpoints planned but not done (student_checkpoints). */
  readonly checkpoints: ReadonlyArray<{ studentId: string; key: string; plannedOn: string }>;
  /** Confirmed orientation sessions in the near future. */
  readonly upcomingSessions: ReadonlyArray<{ id: string; studentId: string; slotAt: string }>;
  /** Imported school results awaiting the authorized review workflow. */
  readonly pendingVerification: ReadonlyArray<{ studentId: string; count: number; oldest: string }>;
  /** Most recent imported academic activity per student (counts as progress for the inactivity rule). */
  readonly importedActivity: ReadonlyArray<{ studentId: string; lastOn: string }>;
  /** Import batches validated (or approved) and waiting for the owner to commit or discard them: one per batch. */
  readonly pendingImports: ReadonlyArray<{ id: string; sourceKind: string; rows: number; students: number; validatedAt: string }>;
  /** S32-B: unlinked student records whose email matches an unlinked student-role account (admin confirms the link). */
  readonly readyToLink?: ReadonlyArray<{ studentId: string; accountCreatedAt: string }>;
  /** Notifications whose email delivery failed (bounded). */
  readonly failedNotifications: ReadonlyArray<{ id: string; studentId: string | null; template: string; at: string }>;
  /** S34 (S33-05): students whose high-school transcript status is still 'requested' (one row per student). */
  readonly transcriptRequests?: ReadonlyArray<{ studentId: string; requestedAt: string }>;
}

export const EMPTY_EXTRA: AttentionExtraFacts = { checkpoints: [], upcomingSessions: [], pendingVerification: [], importedActivity: [], pendingImports: [], readyToLink: [], failedNotifications: [] };

const WORKFLOW: Record<AttentionKind, AttentionWorkflow> = {
  document_review: "documents", payment_evidence: "billing", payment_overdue: "billing", payment_missing: "billing",
  deadline_soon: "documents", inactive: "academic", low_grade: "academic", school_result_needed: "academic",
  elective_approval: "academic", session_request: "appointments", support_reply: "support",
  checkpoint_missed: "academic", checkpoint_soon: "academic", orientation_upcoming: "appointments",
  import_verification: "academic", notification_failed: "operations", import_awaiting_approval: "operations",
  account_ready_to_link: "operations", transcript_requested: "academic",
};
const ACTION: Record<AttentionKind, string> = {
  document_review: "review_documents", payment_evidence: "review_payment", payment_overdue: "follow_up_payment",
  payment_missing: "record_payment", deadline_soon: "check_deadline", inactive: "contact_student", low_grade: "review_scores",
  school_result_needed: "record_school_result", elective_approval: "decide_elective", session_request: "confirm_session",
  support_reply: "reply_support", checkpoint_missed: "complete_checkpoint", checkpoint_soon: "prepare_checkpoint",
  orientation_upcoming: "prepare_session", import_verification: "verify_results", notification_failed: "check_delivery", import_awaiting_approval: "approve_import",
  account_ready_to_link: "link_account", transcript_requested: "prepare_transcript",
};

/** Facts that change every day (counters) are left out of the fingerprint, so a dismissal survives until the facts change. */
const VOLATILE = new Set(["days", "daysLeft", "hoursWaiting"]);
export function fingerprintOf(kind: string, arisenAt: string | null, facts: Readonly<Record<string, unknown>>): string {
  const stable = Object.keys(facts).filter((k) => !VOLATILE.has(k)).sort().map((k) => `${k}=${String(facts[k])}`).join("&");
  return createHash("sha256").update(`${kind}|${arisenAt ?? ""}|${stable}`).digest("hex").slice(0, 40);
}

function priorityFromQueue(item: ControlQueueItem, settings: ConciergeSettings, nowMs: number): AttentionPriority {
  if (item.kind === "support_reply") {
    const hours = item.at ? (nowMs - Date.parse(item.at)) / 3_600_000 : 0;
    return hours >= settings.supportUnansweredHours * 2 ? "urgent" : hours >= settings.supportUnansweredHours ? "high" : "normal";
  }
  if (item.kind === "inactive") {
    const days = Number(item.facts?.days ?? 0);
    return days >= settings.inactiveDays * 3 ? "urgent" : "high";
  }
  return item.severity === "critical" ? "urgent" : item.severity === "warning" ? "high" : "normal";
}

export function buildAttention(facts: ControlCenterFacts, extra: AttentionExtraFacts, settings: ConciergeSettings, now: Date): { items: AttentionCandidate[]; truncated: boolean } {
  const nowMs = now.getTime();
  const today = now.toISOString().slice(0, 10);
  const view = buildControlCenter(facts, now, { inactiveDays: settings.inactiveDays, deadlineWindowDays: settings.deadlineWindowDays, paymentSoonDays: settings.paymentReminderDays });
  const studentBy = new Map(facts.students.map((s) => [s.id, s] as const));
  const demo = (id: string | null) => (id ? isDemoPreferredName(studentBy.get(id)?.preferredName ?? null) : false);
  const name = (id: string | null) => (id ? studentBy.get(id)?.name ?? null : null);
  const code = (id: string | null) => (id ? studentBy.get(id)?.code ?? null : null);
  const fileHref = (id: string, tab: string) => `/admin/students/${encodeURIComponent(id)}?tab=${tab}`;
  const importedBy = new Map(extra.importedActivity.map((a) => [a.studentId, a.lastOn] as const));

  const out: AttentionCandidate[] = [];
  const push = (c: Omit<AttentionCandidate, "workflow" | "action" | "fingerprint" | "studentName" | "studentCode" | "isDemo"> & { action?: string }) =>
    out.push({
      ...c,
      workflow: WORKFLOW[c.kind],
      action: c.action ?? ACTION[c.kind],
      studentName: name(c.studentId),
      studentCode: code(c.studentId),
      isDemo: demo(c.studentId),
      fingerprint: fingerprintOf(c.kind, c.arisenAt, c.reason.facts),
    });

  // 1. Base rules (S27 Control Center) for every student, demo included (demo items are labelled downstream).
  //    buildControlCenter excludes demo items from view.queue, so rebuild the per-student list for demo students too.
  const demoFacts: ControlCenterFacts = { ...facts, students: facts.students.map((s) => ({ ...s, preferredName: isDemoPreferredName(s.preferredName) ? null : s.preferredName })) };
  const demoIds = new Set(facts.students.filter((s) => isDemoPreferredName(s.preferredName)).map((s) => s.id));
  const demoQueue = demoIds.size ? buildControlCenter(demoFacts, now, { inactiveDays: settings.inactiveDays, deadlineWindowDays: settings.deadlineWindowDays, paymentSoonDays: settings.paymentReminderDays }).queue.filter((q) => demoIds.has(q.studentId)) : [];
  for (const q of [...view.queue, ...demoQueue]) {
    // Imported provider activity counts as academic progress: drop "inactive" when an import is recent enough.
    if (q.kind === "inactive") {
      const last = importedBy.get(q.studentId);
      if (last && daysBetween(last, today) < settings.inactiveDays) continue;
    }
    push({
      key: q.id, kind: q.kind, priority: priorityFromQueue(q, settings, nowMs), studentId: q.studentId,
      title: q.title, detail: q.detail, reason: { rule: `cc.${q.kind}`, facts: q.facts ?? {} }, arisenAt: q.at ? isoReq(q.at) : null, href: q.href,
    });
  }

  // 2. Coordination checkpoints (planned, not done): missed, or due within the deadline window.
  for (const c of extra.checkpoints) {
    if (!studentBy.has(c.studentId)) continue;
    const daysLeft = daysBetween(today, c.plannedOn);
    if (daysLeft < 0) {
      push({ key: `checkpoint_missed:${c.studentId}:${c.key}`, kind: "checkpoint_missed", priority: daysLeft < -7 ? "urgent" : "high", studentId: c.studentId,
        title: "Checkpoint date passed", detail: `Checkpoint "${c.key}" was planned for ${c.plannedOn} and is not marked done.`,
        reason: { rule: "checkpoint.planned_passed", facts: { checkpoint: c.key, plannedOn: c.plannedOn, daysLeft } }, arisenAt: `${c.plannedOn}T00:00:00.000Z`, href: fileHref(c.studentId, "overview") });
    } else if (daysLeft <= Math.min(settings.deadlineWindowDays, 7)) {
      push({ key: `checkpoint_soon:${c.studentId}:${c.key}`, kind: "checkpoint_soon", priority: daysLeft <= 2 ? "high" : "normal", studentId: c.studentId,
        title: "Checkpoint coming up", detail: `Checkpoint "${c.key}" is planned for ${c.plannedOn}.`,
        reason: { rule: "checkpoint.planned_soon", facts: { checkpoint: c.key, plannedOn: c.plannedOn, daysLeft } }, arisenAt: null, href: fileHref(c.studentId, "overview") });
    }
  }

  // 3. Confirmed orientation sessions within the reminder window (plus a day of preparation for staff).
  const windowMs = (settings.orientationReminderHours + 24) * 3_600_000;
  for (const s of extra.upcomingSessions) {
    if (!studentBy.has(s.studentId)) continue;
    const ms = Date.parse(s.slotAt) - nowMs;
    if (ms < 0 || ms > windowMs) continue;
    push({ key: `orientation_upcoming:${s.studentId}:${s.id}`, kind: "orientation_upcoming", priority: ms <= 24 * 3_600_000 ? "high" : "normal", studentId: s.studentId,
      title: "Orientation session coming up", detail: `Confirmed session at ${s.slotAt.slice(0, 16).replace("T", " ")} UTC.`,
      reason: { rule: "orientation.confirmed_upcoming", facts: { sessionId: s.id, slotAt: s.slotAt } }, arisenAt: null, href: fileHref(s.studentId, "sessions") });
  }

  // 4. Imported school results waiting for the authorized review workflow (never auto-verified).
  for (const p of extra.pendingVerification) {
    if (!studentBy.has(p.studentId)) continue;
    push({ key: `import_verification:${p.studentId}`, kind: "import_verification", priority: daysBetween(p.oldest.slice(0, 10), today) > 7 ? "high" : "normal", studentId: p.studentId,
      title: `${p.count} imported result${p.count === 1 ? "" : "s"} to verify`, detail: "Provider- or school-reported (imported); not official until the school's result is recorded through the review workflow.",
      reason: { rule: "import.school_result_pending", facts: { count: p.count, oldest: p.oldest.slice(0, 10) } }, arisenAt: p.oldest, href: `/admin/students/${encodeURIComponent(p.studentId)}/roadmap` });
  }

  // 5. Import batches validated and waiting for the owner (approve + commit are admin-only). One item per batch; it clears
  //    on its own when the batch is committed or discarded (it leaves the pending set).
  for (const b of extra.pendingImports) {
    const waitingDays = daysBetween(b.validatedAt.slice(0, 10), today);
    push({ key: `import_awaiting_approval:${b.id}`, kind: "import_awaiting_approval", priority: waitingDays > 3 ? "high" : "normal", studentId: null,
      title: "Import awaiting approval", detail: `A validated import (${b.rows} row${b.rows === 1 ? "" : "s"}, ${b.students} student${b.students === 1 ? "" : "s"}) is waiting for the owner to approve and commit it, or discard it. Nothing is applied until then.`,
      reason: { rule: "import.batch_pending_approval", facts: { batchId: b.id, source: b.sourceKind, rows: b.rows, students: b.students } }, arisenAt: b.validatedAt, href: `/admin/imports?batch=${encodeURIComponent(b.id)}` });
  }

  // 6. S32-B: the student created their portal account (same email as the record) but it is not linked yet. The item
  //    opens the Student File, whose enrollment line offers the admin-only "Link account" with a confirmation. It
  //    clears on its own once the account is linked (the student leaves the set).
  for (const r of extra.readyToLink ?? []) {
    if (!studentBy.has(r.studentId)) continue;
    push({ key: `account_ready_to_link:${r.studentId}`, kind: "account_ready_to_link", priority: daysBetween(r.accountCreatedAt.slice(0, 10), today) > 2 ? "high" : "normal", studentId: r.studentId,
      title: "Portal account ready to link", detail: "The student created a portal account with the record email. Confirm and link it so their portal shows their file.",
      reason: { rule: "enrollment.account_ready_to_link", facts: { accountCreatedOn: r.accountCreatedAt.slice(0, 10) } }, arisenAt: r.accountCreatedAt, href: fileHref(r.studentId, "overview") });
  }

  // 6b. S34 (S33-05): a graduate asked for their transcript (hs_graduation_records.transcript_status = 'requested').
  //     One item per student (stable key); it clears on its own once staff move the status to issued / delivered.
  //     Opens the Graduation tab of the staff High School page, where the status is updated.
  for (const t of extra.transcriptRequests ?? []) {
    if (!studentBy.has(t.studentId)) continue;
    push({ key: `transcript_requested:${t.studentId}`, kind: "transcript_requested", priority: daysBetween(t.requestedAt.slice(0, 10), today) > 7 ? "high" : "normal", studentId: t.studentId,
      title: "Transcript requested", detail: "The student requested their high school transcript. Prepare it and update the transcript status in the Graduation tab.",
      reason: { rule: "hs.transcript_requested", facts: { requestedOn: t.requestedAt.slice(0, 10) } }, arisenAt: t.requestedAt, href: `/admin/students/${encodeURIComponent(t.studentId)}/high-school?tab=graduation` });
  }

  // 7. Notifications whose email delivery failed after bounded retries.
  for (const f of extra.failedNotifications) {
    push({ key: `notification_failed:${f.id}`, kind: "notification_failed", priority: "normal", studentId: f.studentId && studentBy.has(f.studentId) ? f.studentId : null,
      title: "Email delivery failed", detail: `Notification "${f.template}" could not be delivered by email after retries.`,
      reason: { rule: "outbox.failed", facts: { notificationId: f.id, template: f.template } }, arisenAt: f.at, href: `/admin/notifications?state=failed` });
  }

  const rank: Record<AttentionPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  out.sort((a, b) => rank[a.priority] - rank[b.priority] || (a.arisenAt ?? "9999").localeCompare(b.arisenAt ?? "9999") || a.key.localeCompare(b.key));
  return { items: out, truncated: view.truncated };
}

// ── bounded read-only loading ────────────────────────────────────────────────

export async function loadAttentionExtra(db: SqlExecutor, now: Date, s29Present: boolean): Promise<AttentionExtraFacts> {
  const horizon = new Date(now.getTime() + 8 * 86_400_000).toISOString();
  const [checkpoints, sessions] = await Promise.all([
    db.execute(sql`SELECT student_id, key, planned_on::text AS planned_on FROM student_checkpoints WHERE done_on IS NULL AND planned_on IS NOT NULL ORDER BY planned_on, student_id LIMIT 1000`),
    db.execute(sql`SELECT id, student_id, slot_at FROM orientation_sessions WHERE status = 'confirmed' AND slot_at >= ${now.toISOString()}::timestamptz AND slot_at <= ${horizon}::timestamptz ORDER BY slot_at LIMIT 200`),
  ]);
  // S30 Phase B import store (academic_reported_records): records awaiting staff review, and the latest imported
  // (provider-/school-reported) activity per student. Optional: before the S30 migration the table is absent -> none.
  let pending: unknown = [];
  let imported: unknown = [];
  try {
    [pending, imported] = await Promise.all([
      db.execute(sql`SELECT student_id, count(*)::int AS n, min(created_at) AS oldest FROM academic_reported_records
        WHERE status = 'active' AND review_state = 'needs_review' GROUP BY student_id ORDER BY student_id LIMIT 1000`),
      db.execute(sql`SELECT student_id, max(COALESCE(reported_on, created_at::date))::text AS last_on FROM academic_reported_records
        WHERE status = 'active' GROUP BY student_id ORDER BY student_id LIMIT 1000`),
    ]);
  } catch (error) {
    if (errorCode(error) !== "42P01") throw error;
  }
  let pendingImports: unknown = [];
  try {
    pendingImports = await db.execute(sql`SELECT id, source_kind, counts, validated_at FROM academic_import_batches
      WHERE status IN ('validated', 'approved') AND validated_at IS NOT NULL ORDER BY validated_at, id LIMIT 50`);
  } catch (error) {
    if (errorCode(error) !== "42P01") throw error;
  }
  // S32-B: unlinked records with a matching, unlinked student account (bounded).
  const ready = await db.execute(sql`SELECT s.id AS student_id, min(u.created_at) AS created_at FROM students s
    JOIN users u ON lower(u.email) = lower(s.email) AND u.role::text = 'student'
    WHERE s.user_id IS NULL AND s.email IS NOT NULL AND s.email <> ''
      AND NOT EXISTS (SELECT 1 FROM students s2 WHERE s2.user_id = u.id)
    GROUP BY s.id ORDER BY s.id LIMIT 200`);
  // S34 (S33-05): outstanding transcript requests; DISTINCT per student. Optional: absent before the high-school migration.
  let transcripts: unknown = [];
  try {
    transcripts = await db.execute(sql`SELECT student_id, max(updated_at) AS requested_at FROM hs_graduation_records
      WHERE transcript_status = 'requested' GROUP BY student_id ORDER BY student_id LIMIT 200`);
  } catch (error) {
    if (errorCode(error) !== "42P01") throw error;
  }
  let failed: unknown = [];
  if (s29Present) {
    failed = await db.execute(sql`SELECT id, student_id, template, updated_at FROM s29_notifications WHERE email_state = 'failed' AND updated_at >= ${new Date(now.getTime() - 14 * 86_400_000).toISOString()}::timestamptz ORDER BY updated_at DESC LIMIT 50`);
  }
  return {
    checkpoints: rows(checkpoints).map((r) => ({ studentId: String(r.student_id), key: String(r.key), plannedOn: String(r.planned_on) })),
    upcomingSessions: rows(sessions).map((r) => ({ id: String(r.id), studentId: String(r.student_id), slotAt: isoReq(r.slot_at) })),
    pendingVerification: rows(pending).map((r) => ({ studentId: String(r.student_id), count: Number(r.n), oldest: isoReq(r.oldest) })),
    importedActivity: rows(imported).map((r) => ({ studentId: String(r.student_id), lastOn: String(r.last_on) })),
    pendingImports: rows(pendingImports).map((r) => {
      const c = (r.counts ?? {}) as { total?: number; students?: number };
      return { id: String(r.id), sourceKind: String(r.source_kind), rows: Number(c.total ?? 0), students: Number(c.students ?? 0), validatedAt: isoReq(r.validated_at) };
    }),
    readyToLink: rows(ready).map((r) => ({ studentId: String(r.student_id), accountCreatedAt: isoReq(r.created_at) })),
    transcriptRequests: rows(transcripts).map((r) => ({ studentId: String(r.student_id), requestedAt: isoReq(r.requested_at) })),
    failedNotifications: rows(failed).map((r) => ({ id: String(r.id), studentId: str(r.student_id), template: String(r.template), at: iso(r.updated_at) ?? now.toISOString() })),
  };
}

export async function computeAttention(db: SqlExecutor, now: Date, settings: ConciergeSettings, s29Present: boolean) {
  const [facts, extra] = await Promise.all([loadControlCenterFacts(db, now), loadAttentionExtra(db, now, s29Present)]);
  return { ...buildAttention(facts, extra, settings, now), facts, extra };
}
