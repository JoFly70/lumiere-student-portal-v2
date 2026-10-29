/**
 * S26 — Owner AI grounding. Pure composition of ONE student's saved records into numbered
 * source records ("R1", "R2", ...) that the owner assistant may cite.
 *
 * Data minimisation: the records carry no legal name, date of birth, email, phone, address,
 * guardian name or free-text message bodies. The student is referred to by student code only.
 * Every fact comes from a stored record; nothing is estimated or invented here.
 */
import { formatHalfUnits, type StudentHighSchoolView, type HsReviewQueueItem } from "@shared/high-school-contract";

export interface OwnerContextStudent {
  readonly id: string;
  readonly student_code?: string | null;
  readonly status: string;
  readonly user_id?: string | null;
}

export interface OwnerContextDocument {
  readonly id: string;
  readonly doc_type: string;
  readonly status: string;
  readonly uploaded_at?: string | null;
  readonly rejection_reason?: string | null;
  readonly required_for_enrollment?: boolean | null;
}

export interface OwnerContextTicket {
  readonly id: string;
  readonly subject?: string | null;
  readonly status: string;
  readonly category?: string | null;
  readonly priority?: string | null;
  readonly updated_at?: string | null;
}

export interface OwnerContextBilling {
  readonly state: "configured" | "not_configured";
  readonly currency?: string | null;
  readonly agreedCents?: number | null;
  readonly discountCents?: number | null;
  readonly paidCents?: number | null;
  readonly remainingCents?: number | null;
  readonly nextDue?: { readonly dueDate: string; readonly amountCents: number; readonly status?: string } | null;
  readonly lastReceipt?: { readonly receivedDate: string; readonly amountCents: number; readonly methodLabel: string } | null;
  readonly evidenceAwaiting?: number;
}

export interface OwnerContextInput {
  readonly billing?: OwnerContextBilling | null;
  readonly student: OwnerContextStudent;
  readonly highSchool: StudentHighSchoolView | null;
  readonly reviewQueue: readonly HsReviewQueueItem[];
  readonly documents: readonly OwnerContextDocument[];
  readonly tickets: readonly OwnerContextTicket[];
}

export interface OwnerSourceRecord {
  readonly ref: string;
  readonly kind: "student" | "credits" | "course" | "graduation" | "guardians" | "documents" | "document" | "tickets" | "ticket" | "review" | "pace";
  readonly label: string;
  /** Admin portal path the owner can open to check the record. */
  readonly path: string;
  readonly text: string;
}

const clip = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
/** Removes anything that looks like contact data from free text before it can reach a model. */
export function scrubFreeText(s: string | null | undefined, n = 120): string {
  return clip(s, n * 2)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]")
    .slice(0, n);
}

const COURSE_STATUS_TEXT: Record<string, string> = {
  not_started: "not started",
  in_progress: "in progress (student-reported)",
  awaiting_school: "student reported finished, awaiting the school's official result",
  official_complete: "officially completed (school-confirmed)",
  not_passed: "not passed (official)",
  replaced: "replaced in the plan",
  transfer_credit: "covered by accepted transfer credit (school-confirmed)",
};

export function composeOwnerContext(input: OwnerContextInput): OwnerSourceRecord[] {
  const out: OwnerSourceRecord[] = [];
  const base = `/admin/students/${encodeURIComponent(input.student.id)}`;
  const push = (r: Omit<OwnerSourceRecord, "ref">) => out.push({ ...r, ref: `R${out.length + 1}` });
  const hs = input.highSchool;
  const code = input.student.student_code || "(no student code)";

  push({
    kind: "student",
    label: "Student file",
    path: base,
    text: `Student ${code}; file status ${input.student.status}; portal login ${input.student.user_id ? "linked" : "not linked"}; high-school enrollment ${hs ? hs.enrollment.status : "none"}${hs ? `; program "${hs.enrollment.programTitle}"; start ${hs.enrollment.startedOn ?? "not set"}; target completion ${hs.enrollment.targetCompletionDate ?? "not set"}; awarding school disclosed to student: ${hs.enrollment.institutionDisclosed ? "yes" : "no"}` : ""}.`,
  });
  if (!hs) return appendDocsTickets(out, input, base, push);

  const c = hs.credits;
  push({
    kind: "credits",
    label: "Official credit summary",
    path: `${base}/high-school`,
    text: `Required ${formatHalfUnits(c.requiredHalfUnits)} credits (core ${formatHalfUnits(c.core.requiredHalfUnits)}, elective ${formatHalfUnits(c.elective.requiredHalfUnits)}). Officially earned (school-confirmed) ${formatHalfUnits(c.earnedHalfUnits)}; remaining ${formatHalfUnits(c.remainingHalfUnits)}; student-reported awaiting school confirmation ${formatHalfUnits(c.awaitingConfirmationHalfUnits)}. Roadmap ${hs.roadmap ? `published as version ${hs.roadmap.versionNumber}` : "not published"}.`,
  });
  push({
    kind: "pace",
    label: "Planned pace",
    path: `${base}/high-school`,
    text: `Pace status ${hs.pace.status}; planned cumulative by now ${hs.pace.expectedByNowHalfUnits === null ? "not configured" : formatHalfUnits(hs.pace.expectedByNowHalfUnits)} credits; next milestone ${hs.pace.nextMilestone ? `${hs.pace.nextMilestone.month} = ${formatHalfUnits(hs.pace.nextMilestone.cumulativeHalfUnits)} cumulative credits` : "none"}. Milestones are planning targets, not school deadlines.`,
  });
  for (const subject of hs.subjects) {
    for (const course of subject.courses) {
      const testOnly = /TEST ONLY|APPROVAL PENDING|NOT SCHOOL-APPROVED/i.test(course.title);
      const openTasks = course.tasks.filter((t) => t.status === "not_started" || t.status === "in_progress" || t.status === "retake_required").length;
      push({
        kind: "course",
        label: `Course: ${clip(course.title, 80)}`,
        path: `${base}/high-school`,
        text: `${clip(course.title, 120)} — ${course.kind}, ${formatHalfUnits(course.halfUnits)} credit, area ${course.areaKey}; status ${COURSE_STATUS_TEXT[course.status] ?? course.status}; planned window ${course.plannedStart ?? "?"} to ${course.plannedEnd ?? "?"}; tasks ${course.tasksDone}/${course.tasksTotal} reported done, ${openTasks} still open${course.tasks.some((t) => t.overdue) ? "; has overdue planned tasks" : ""}${testOnly ? "; TEST ONLY elective, school approval pending, earns no confirmed credit" : ""}.`,
      });
    }
  }
  const g = hs.graduation;
  push({
    kind: "graduation",
    label: "Graduation requirements",
    path: `${base}/high-school`,
    text: `Graduation status ${g.status}; credits satisfied ${g.creditsSatisfied ? "yes" : "no"}; outstanding exams ${g.outstandingExams}; outstanding projects ${g.outstandingProjects}; eligibility confirmed ${g.eligibilityConfirmedAt ? "yes" : "no"}; financial clearance ${g.financialClearance ?? "not available"}; transcript ${g.transcript.status}; diploma ${g.diploma.status}.`,
  });
  push({
    kind: "guardians",
    label: "Guardians and contacts",
    path: `${base}?tab=profile`,
    text: hs.guardians.length === 0
      ? "No guardian or authorized contact is recorded."
      : hs.guardians.map((x, i) => `Contact ${i + 1} (${clip(x.relationship, 30)}): standing ${x.standing}; may discuss academics ${x.mayDiscussAcademics ? "yes" : "no"}; may discuss finances ${x.mayDiscussFinances ? "yes" : "no"}`).join("; ") + ".",
  });
  if (input.reviewQueue.length > 0) {
    push({
      kind: "review",
      label: "Staff review queue",
      path: `${base}/high-school`,
      text: `${input.reviewQueue.length} student report(s) wait for school evidence or a recorded result: ` +
        input.reviewQueue.slice(0, 12).map((q) => `${clip(q.courseTitle, 60)} / ${clip(q.taskTitle, 60)} (reported ${q.reportedStatus})`).join("; ") + ".",
    });
  }
  if (hs.attention.length > 0) {
    push({ kind: "review", label: "Attention items", path: `${base}/high-school`, text: hs.attention.slice(0, 10).map((a) => `${a.kind}: ${clip(a.message, 100)}`).join("; ") + "." });
  }
  return appendDocsTickets(out, input, base, push);
}

function appendDocsTickets(
  out: OwnerSourceRecord[],
  input: OwnerContextInput,
  base: string,
  push: (r: Omit<OwnerSourceRecord, "ref">) => void,
): OwnerSourceRecord[] {
  const b = input.billing;
  if (b) {
    const m = (c: number | null | undefined) => `${((c ?? 0) / 100).toFixed(2)} ${b.currency ?? ""}`.trim();
    push({
      kind: "documents",
      label: "Billing ledger",
      path: `${base}/billing`,
      text: b.state !== "configured" ? "No billing obligation is recorded." :
        `Agreed ${m(b.agreedCents)}; adjustments ${m(b.discountCents)}; paid (staff-confirmed receipts only) ${m(b.paidCents)}; remaining ${m(b.remainingCents)}.${b.nextDue ? ` Next installment ${m(b.nextDue.amountCents)} due ${b.nextDue.dueDate}${b.nextDue.status ? ` (${b.nextDue.status})` : ""}.` : ""}${b.lastReceipt ? ` Last confirmed payment ${m(b.lastReceipt.amountCents)} on ${b.lastReceipt.receivedDate} (${scrubFreeText(b.lastReceipt.methodLabel, 40)}).` : " No payment confirmed yet."} Payment evidence awaiting review: ${b.evidenceAwaiting ?? 0}.`,
    });
  }
  if (input.documents.length === 0) {
    push({ kind: "documents", label: "Documents", path: `${base}?tab=documents`, text: "No documents are on file." });
  } else {
    for (const d of input.documents.slice(0, 15)) {
      push({
        kind: "document",
        label: `Document: ${d.doc_type}`,
        path: `${base}?tab=documents`,
        text: `Document type ${d.doc_type}; review status ${d.status}${d.required_for_enrollment ? "; required for enrollment" : ""}; uploaded ${d.uploaded_at?.slice(0, 10) ?? "unknown date"}${d.rejection_reason ? `; reason given: ${scrubFreeText(d.rejection_reason, 100)}` : ""}.`,
      });
    }
  }
  if (input.tickets.length === 0) {
    push({ kind: "tickets", label: "Support tickets", path: `/admin/support?studentId=${encodeURIComponent(input.student.id)}`, text: "No support tickets." });
  } else {
    for (const t of input.tickets.slice(0, 10)) {
      push({
        kind: "ticket",
        label: `Ticket: ${scrubFreeText(t.subject, 60) || t.id}`,
        path: `/admin/support?ticket=${encodeURIComponent(t.id)}`,
        text: `Support ticket "${scrubFreeText(t.subject, 100)}"; status ${t.status}; category ${t.category ?? "?"}; priority ${t.priority ?? "?"}; last update ${t.updated_at?.slice(0, 10) ?? "?"}.`,
      });
    }
  }
  return out;
}

/** Keeps only citations to records that exist, in first-mention order. */
export function extractCitations(reply: string, records: readonly OwnerSourceRecord[]): OwnerSourceRecord[] {
  const byRef = new Map(records.map((r) => [r.ref, r]));
  const seen = new Set<string>();
  const cited: OwnerSourceRecord[] = [];
  for (const m of reply.matchAll(/\bR(\d{1,3})\b/g)) {
    const ref = `R${m[1]}`;
    const rec = byRef.get(ref);
    if (rec && !seen.has(ref)) { seen.add(ref); cited.push(rec); }
  }
  return cited;
}

/**
 * Deterministic, non-AI record summary used when no live model is available. Labelled as such
 * in the UI; it lists only facts present in the records.
 */
export function recordSummary(records: readonly OwnerSourceRecord[]): string {
  const pick = (k: OwnerSourceRecord["kind"]) => records.filter((r) => r.kind === k);
  const lines: string[] = [];
  for (const r of [...pick("student"), ...pick("credits"), ...pick("graduation"), ...records.filter((x) => x.label === "Billing ledger")]) lines.push(`${r.text} [${r.ref}]`);
  const docs = pick("document").filter((d) => !/status verified/.test(d.text));
  if (docs.length) lines.push(`Documents needing action: ${docs.map((d) => `${d.label.replace("Document: ", "")} [${d.ref}]`).join(", ")}.`);
  const open = pick("ticket").filter((t) => !/status (resolved|closed)/.test(t.text));
  if (open.length) lines.push(`Open tickets: ${open.map((t) => `${t.label.replace("Ticket: ", "")} [${t.ref}]`).join(", ")}.`);
  const pending = pick("course").filter((c) => !/officially completed/.test(c.text)).length;
  if (pending) lines.push(`${pending} planned course(s) have no official result yet.`);
  return lines.join("\n");
}
