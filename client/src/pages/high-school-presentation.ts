/**
 * Pure presentation logic for the student High School Pathway page (S11).
 *
 * Nothing here computes official credit. Credit amounts arrive as integer
 * half-units and are only formatted (formatHalfUnits, never float division).
 * Wording rules: a date is a "target", never a guarantee; a student report is
 * never "official"; only the awarding school confirms grades, credits and the
 * diploma.
 */
import {
  HS_SUBJECT_AREAS,
  HS_SUBJECT_LABELS,
  formatHalfUnits,
  halfUnitPercent,
  type HalfUnits,
  type HsAttentionItem,
  type HsCourseDisplayStatus,
  type HsCourseView,
  type HsGraduationView,
  type HsGuardianStanding,
  type HsGuardianView,
  type HsReportedStatus,
  type HsSubjectArea,
  type HsSubjectView,
  type HsTaskDisplayStatus,
  type HsTaskKind,
  type HsTaskView,
  type PriorEducationStatus,
  type StudentHighSchoolView,
  type TransferClaimStatus,
} from "@shared/high-school-contract";
import type { StatusKey } from "@/pages/student-roadmap-presentation";

export const HS_PATH = "/high-school";
export const HS_TABS = [
  { id: "journey", label: "My Journey" },
  { id: "subjects", label: "My Subjects" },
  { id: "graduation", label: "My Graduation" },
] as const;
export type HsTabId = (typeof HS_TABS)[number]["id"];

export function tabFromHash(hash: string | null | undefined): HsTabId | null {
  const id = (hash ?? "").replace(/^#/, "");
  return HS_TABS.some((t) => t.id === id) ? (id as HsTabId) : null;
}

// ── Credits ─────────────────────────────────────────────────────────────────

/** "10.5" with the unit: "1 credit" / "10.5 credits". */
export function creditsLabel(half: HalfUnits): string {
  return `${formatHalfUnits(half)} ${half === 2 ? "credit" : "credits"}`;
}

/** "10.5 of 21 credits". */
export function creditsOfLabel(earned: HalfUnits, required: HalfUnits): string {
  return `${formatHalfUnits(earned)} of ${formatHalfUnits(required)} credits`;
}

/** Whole-number percent for sizing a graphic, floored (never rounds up to 100). */
export function barPercent(part: HalfUnits, whole: HalfUnits): number {
  return halfUnitPercent(part, whole);
}

export function awaitingConfirmationLabel(half: HalfUnits): string | null {
  if (half <= 0) return null;
  return `${creditsLabel(half)} awaiting school confirmation`;
}

// ── Subjects ────────────────────────────────────────────────────────────────

/** Subjects in the contract order, whatever order the server sent; unknown subjects are dropped. */
export function orderedSubjects(subjects: readonly HsSubjectView[]): HsSubjectView[] {
  const bySubject = new Map(subjects.map((s) => [s.subject, s]));
  return HS_SUBJECT_AREAS.flatMap((area) => {
    const s = bySubject.get(area);
    return s ? [s] : [];
  });
}

export function subjectLabel(subject: HsSubjectArea): string {
  return HS_SUBJECT_LABELS[subject];
}

const COURSE_ORDER: Record<HsCourseDisplayStatus, number> = {
  in_progress: 0,
  awaiting_school: 1,
  not_started: 2,
  official_complete: 3,
  transfer_credit: 4,
  not_passed: 5,
  replaced: 6,
};

/** Active work first, finished next, replaced last (still visible, keeps history). */
export function sortedCourses(courses: readonly HsCourseView[]): HsCourseView[] {
  return [...courses]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => COURSE_ORDER[a.c.status] - COURSE_ORDER[b.c.status] || a.i - b.i)
    .map((x) => x.c);
}

const TASK_KIND_ORDER: Record<HsTaskKind, number> = { lesson: 0, project: 1, exam: 2 };
export function sortedTasks(tasks: readonly HsTaskView[]): HsTaskView[] {
  return [...tasks]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => TASK_KIND_ORDER[a.t.kind] - TASK_KIND_ORDER[b.t.kind] || a.i - b.i)
    .map((x) => x.t);
}

export const TASK_KIND_LABEL: Record<HsTaskKind, string> = { lesson: "Lessons", exam: "Exam", project: "Written project" };

export function subjectSummary(s: HsSubjectView): string {
  return `${creditsOfLabel(s.earnedHalfUnits, s.requiredHalfUnits)} (official)`;
}

export function courseCountLabel(s: HsSubjectView): string {
  const active = s.courses.filter((c) => c.status !== "replaced").length;
  return `${active} ${active === 1 ? "course" : "courses"}`;
}

// ── Status language ─────────────────────────────────────────────────────────

export interface StatusView {
  readonly key: StatusKey;
  readonly label: string;
}

/** Colour + icon + label always travel together (see StatusPill). */
export function taskStatusView(status: HsTaskDisplayStatus): StatusView {
  switch (status) {
    case "official_passed": return { key: "official", label: "Official: passed" };
    case "official_failed": return { key: "attention", label: "Official: not passed" };
    case "retake_required": return { key: "attention", label: "Official: retake needed" };
    case "pending_review": return { key: "submitted", label: "Pending school review" };
    case "in_progress": return { key: "progress", label: "In progress" };
    default: return { key: "notstarted", label: "Not started" };
  }
}

export function courseStatusView(status: HsCourseDisplayStatus): StatusView {
  switch (status) {
    case "official_complete": return { key: "official", label: "Official: completed" };
    case "transfer_credit": return { key: "official", label: "Transfer credit (accepted by the school)" };
    case "awaiting_school": return { key: "submitted", label: "Awaiting school confirmation" };
    case "in_progress": return { key: "progress", label: "In progress" };
    case "not_passed": return { key: "attention", label: "Official: not passed" };
    case "replaced": return { key: "notstarted", label: "Replaced in your updated plan" };
    default: return { key: "notstarted", label: "Not started" };
  }
}

export function isOfficialTask(status: HsTaskDisplayStatus): boolean {
  return status === "official_passed" || status === "official_failed" || status === "retake_required";
}

/** The student-reported status that corresponds to a displayed task status. */
export function reportedStatusOf(status: HsTaskDisplayStatus): HsReportedStatus {
  if (status === "pending_review") return "submitted";
  if (status === "in_progress") return "in_progress";
  return "not_started";
}

export const REPORTED_STATUS_OPTIONS: readonly { value: HsReportedStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "submitted", label: "Submitted to the school" },
];

/** Whether the student may still change this task (official results are locked). */
export function canReportTask(task: Pick<HsTaskView, "status">, courseStatus: HsCourseDisplayStatus): boolean {
  if (isOfficialTask(task.status)) return false;
  return courseStatus !== "replaced" && courseStatus !== "transfer_credit" && courseStatus !== "official_complete";
}

/** Parse the optional grade field: "" -> null, else integer 0-100, else undefined (invalid). */
export function parseReportedScore(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  if (!/^\d{1,3}$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 0 && n <= 100 ? n : undefined;
}

export interface ScoreLine {
  readonly kind: "official" | "reported";
  readonly label: string;
}

/** Official and reported grades are never mixed: each carries its own label. */
export function scoreLines(task: Pick<HsTaskView, "officialScorePercent" | "reportedScorePercent">): ScoreLine[] {
  const out: ScoreLine[] = [];
  if (task.officialScorePercent !== null) out.push({ kind: "official", label: `Official (confirmed by the school): ${task.officialScorePercent}%` });
  if (task.reportedScorePercent !== null) out.push({ kind: "reported", label: `You reported: ${task.reportedScorePercent}%` });
  return out;
}

// ── Dates ───────────────────────────────────────────────────────────────────

function parseDay(iso: string | null | undefined): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

const DAY = 86_400_000;

export function daysUntil(iso: string | null | undefined, today: string): number | null {
  const a = parseDay(iso);
  const b = parseDay(today);
  if (a === null || b === null) return null;
  return Math.round((a - b) / DAY);
}

export function monthLabel(ym: string): string {
  const t = Date.parse(`${ym}-01T00:00:00Z`);
  if (Number.isNaN(t)) return ym;
  return new Date(t).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function dueLabel(due: string | null, today: string, formatDate: (iso: string | null) => string | null): string | null {
  const when = formatDate(due);
  if (!when) return null;
  const d = daysUntil(due, today);
  if (d === null) return `Target ${when}`;
  if (d < 0) return `Target was ${when}`;
  if (d === 0) return `Target today (${when})`;
  if (d === 1) return `Target tomorrow (${when})`;
  return `Target ${when}`;
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// ── Pace and target ─────────────────────────────────────────────────────────

export interface PaceView {
  readonly key: StatusKey;
  readonly label: string;
  readonly detail: string;
}

export function paceView(pace: StudentHighSchoolView["pace"]): PaceView {
  const weekly = pace.weeklyTargetHalfUnits !== null ? `Weekly target: ${creditsLabel(pace.weeklyTargetHalfUnits)}. ` : "";
  switch (pace.status) {
    case "on_track":
      return { key: "progress", label: "On track", detail: `${weekly}You are keeping up with your plan.` };
    case "ahead":
      return { key: "applied", label: "Ahead of target", detail: `${weekly}You are ahead of your plan. Nice work.` };
    case "behind":
      return { key: "attention", label: "Behind target", detail: `${weekly}You are a little behind your plan. Lumière can help adjust it.` };
    default:
      return { key: "notstarted", label: "Target not set yet", detail: "Lumière has not set a weekly or monthly target for you yet." };
  }
}

export function expectedByNowLabel(pace: StudentHighSchoolView["pace"]): string | null {
  if (pace.expectedByNowHalfUnits === null) return null;
  return `The plan expected ${creditsLabel(pace.expectedByNowHalfUnits)} by now`;
}

export function nextMilestoneLabel(pace: StudentHighSchoolView["pace"]): string | null {
  const m = pace.nextMilestone;
  if (!m) return null;
  return `By ${monthLabel(m.month)}: ${creditsLabel(m.cumulativeHalfUnits)} in total`;
}

export interface TargetProgress {
  /** Share of the planned time window that has passed (0-100, floored). */
  readonly timePercent: number | null;
  readonly creditPercent: number;
  readonly daysLeft: number | null;
  readonly headline: string;
  readonly detail: string;
}

/**
 * Credit progress next to time passed toward the planned completion target. It is an estimate, not a promise.
 * When staff configured a pace (milestones), that plan is the only judgement shown, so this card never says
 * "keeping pace" next to a "Behind target" pill; the calendar comparison is used only without a configured pace.
 */
export function targetProgress(
  view: Pick<StudentHighSchoolView, "enrollment" | "credits"> & { readonly pace?: Pick<StudentHighSchoolView["pace"], "status"> },
  today: string,
): TargetProgress {
  const { startedOn, targetCompletionDate } = view.enrollment;
  const creditPercent = view.credits.percentComplete;
  const start = parseDay(startedOn);
  const end = parseDay(targetCompletionDate);
  const now = parseDay(today);
  const daysLeft = daysUntil(targetCompletionDate, today);
  if (view.credits.remainingHalfUnits === 0) {
    return { timePercent: null, creditPercent, daysLeft, headline: "All required credits are official", detail: "The school's graduation review is the next step." };
  }
  if (!targetCompletionDate || end === null) {
    return { timePercent: null, creditPercent, daysLeft: null, headline: "No completion target set yet", detail: "Lumière will set a target date with you." };
  }
  let timePercent: number | null = null;
  if (start !== null && now !== null && end > start) timePercent = Math.max(0, Math.min(100, Math.floor(((now - start) * 100) / (end - start))));
  const weeks = daysLeft === null ? null : Math.ceil(daysLeft / 7);
  const headline =
    daysLeft === null ? "Planned completion target"
    : daysLeft < 0 ? "Your target date has passed"
    : weeks !== null && weeks <= 1 ? "Your target date is this week"
    : `About ${weeks} weeks to your target date`;
  const gap = timePercent === null ? null : creditPercent - timePercent;
  const planStatus = view.pace?.status ?? "not_configured";
  const detail =
    planStatus === "behind" ? "Your plan's milestones show you a little behind. The date is a target, not a guarantee, and your plan can be adjusted."
    : planStatus === "on_track" || planStatus === "ahead" ? "You are keeping up with your plan's milestones. The date is a target, not a guarantee."
    : gap === null ? "This date is a target, not a guarantee."
    : gap >= 0 ? "Credits are keeping pace with the calendar. The date is a target, not a guarantee."
    : "Credits are a little behind the calendar. The date is a target, not a guarantee, and your plan can be adjusted.";
  return { timePercent, creditPercent, daysLeft, headline, detail };
}

// ── Next step ───────────────────────────────────────────────────────────────

export interface NextStep {
  readonly tone: "task" | "review" | "plan" | "graduation" | "done" | "welcome";
  readonly title: string;
  readonly detail: string;
  readonly courseKey: string | null;
  readonly taskKey: string | null;
  readonly action: { readonly label: string; readonly tab: HsTabId } | null;
}

export function nextStep(view: StudentHighSchoolView, today: string, formatDate: (iso: string | null) => string | null): NextStep {
  if (view.graduation.status === "diploma_conferred") {
    return { tone: "done", title: "You graduated", detail: "Your diploma has been conferred by your school.", courseKey: null, taskKey: null, action: { label: "See your graduation details", tab: "graduation" } };
  }
  if (!view.roadmap) {
    return { tone: "plan", title: "Your plan is on its way", detail: "Lumière is preparing your roadmap. You will see your first steps here as soon as it is published.", courseKey: null, taskKey: null, action: null };
  }
  const t = view.current.nextTask;
  if (t) {
    const when = dueLabel(t.dueDate, today, formatDate);
    return {
      tone: "task",
      title: t.title,
      detail: `${t.courseTitle}${when ? ` · ${when}` : ""}`,
      courseKey: t.courseKey,
      taskKey: t.key,
      action: { label: "Open this course", tab: "subjects" },
    };
  }
  if (view.graduation.status === "eligibility_confirmed") {
    return { tone: "graduation", title: "Your school confirmed you are eligible", detail: "You can request your transcript while the school finishes your diploma.", courseKey: null, taskKey: null, action: { label: "Go to My Graduation", tab: "graduation" } };
  }
  if (view.awaitingGrade.length > 0) {
    return { tone: "review", title: "Waiting for your school to grade your work", detail: `${view.awaitingGrade.length} ${view.awaitingGrade.length === 1 ? "task is" : "tasks are"} pending school review. Nothing more to do on these right now.`, courseKey: null, taskKey: null, action: { label: "See what is pending", tab: "subjects" } };
  }
  if (view.graduation.creditsSatisfied) {
    return { tone: "graduation", title: "All required credits are official", detail: "Your school is doing its official completion review.", courseKey: null, taskKey: null, action: { label: "Go to My Graduation", tab: "graduation" } };
  }
  const started = view.credits.earnedHalfUnits > 0 || view.subjects.some((s) => s.courses.some((c) => c.status !== "not_started"));
  return {
    tone: started ? "plan" : "welcome",
    title: started ? "Pick your next course" : "Start with your first course",
    detail: "Open My Subjects to see what is planned for you.",
    courseKey: null,
    taskKey: null,
    action: { label: "Open My Subjects", tab: "subjects" },
  };
}

export function attentionLabel(kind: HsAttentionItem["kind"]): string {
  switch (kind) {
    case "overdue_task": return "Past target date";
    case "behind_pace": return "Pace";
    case "retake_required": return "Retake needed";
    case "not_passed": return "Not passed";
    case "documents_requested": return "Documents requested";
    default: return "Support";
  }
}

// ── Graduation ──────────────────────────────────────────────────────────────

export interface ReviewStatusView {
  readonly key: StatusKey;
  readonly label: string;
  readonly detail: string;
}

export function reviewStatusView(g: HsGraduationView): ReviewStatusView {
  if (g.status === "diploma_conferred") return { key: "official", label: "Diploma conferred", detail: "Your school conferred your diploma." };
  if (g.status === "eligibility_confirmed") return { key: "official", label: "Eligibility confirmed by the school", detail: "Your school confirmed that you meet its graduation requirements." };
  if (g.creditsSatisfied && g.outstandingExams === 0 && g.outstandingProjects === 0) {
    return { key: "submitted", label: "Review by the school pending", detail: "Your credits look complete. Only the school can confirm that you are eligible to graduate." };
  }
  return { key: "notstarted", label: "Not ready for review yet", detail: "The school reviews your record once all required credits, exams and projects are official." };
}

export function financialClearanceView(value: HsGraduationView["financialClearance"]): { key: StatusKey; label: string; detail: string } {
  switch (value) {
    case "cleared": return { key: "applied", label: "Cleared", detail: "No balance is blocking your diploma." };
    case "hold": return { key: "attention", label: "On hold", detail: "A balance may delay your diploma. Ask Lumière for details." };
    case "unknown": return { key: "notstarted", label: "Not available here", detail: "Not available here. Ask Lumière." };
    default: return { key: "notstarted", label: "Not available here", detail: "Not available here. Ask Lumière." };
  }
}

export function canRequestTranscript(g: HsGraduationView): boolean {
  return g.status === "eligibility_confirmed" || g.status === "diploma_conferred";
}

export interface TranscriptRequestState {
  readonly enabled: boolean;
  readonly reason: string;
  readonly statusLabel: string;
}

const DELIVERY_LABEL: Record<HsGraduationView["transcript"]["status"], string> = {
  not_requested: "Not requested yet",
  requested: "Requested. Lumière is asking the school",
  issued: "Issued by the school",
  delivered: "Delivered",
};

export function deliveryLabel(status: HsGraduationView["transcript"]["status"]): string {
  return DELIVERY_LABEL[status];
}

export function transcriptRequestState(g: HsGraduationView): TranscriptRequestState {
  const statusLabel = deliveryLabel(g.transcript.status);
  if (!canRequestTranscript(g)) {
    return { enabled: false, reason: "You can request your official transcript once your school confirms you are eligible to graduate.", statusLabel };
  }
  if (g.transcript.status !== "not_requested") {
    return { enabled: false, reason: g.transcript.status === "requested" ? "Your request is with Lumière. We will update this page as the school responds." : "Your transcript is ready. Find it in Documents.", statusLabel };
  }
  return { enabled: true, reason: "Lumière will ask your school to issue your official transcript.", statusLabel };
}

export function diplomaDeliveryLabel(g: HsGraduationView["diploma"]): string {
  if (g.status === "not_requested") return "Not conferred yet";
  return deliveryLabel(g.status);
}

export function creditRequirementRows(view: Pick<StudentHighSchoolView, "credits">): { id: "core" | "elective"; label: string; earned: HalfUnits; required: HalfUnits; satisfied: boolean }[] {
  const { core, elective } = view.credits;
  return [
    { id: "core", label: "Core credits", earned: core.earnedHalfUnits, required: core.requiredHalfUnits, satisfied: core.earnedHalfUnits >= core.requiredHalfUnits },
    { id: "elective", label: "Elective credits", earned: elective.earnedHalfUnits, required: elective.requiredHalfUnits, satisfied: elective.earnedHalfUnits >= elective.requiredHalfUnits },
  ];
}

// ── Prior education ─────────────────────────────────────────────────────────

export function priorEducationStatusLabel(s: PriorEducationStatus): string {
  switch (s) {
    case "reported": return "Reported. Under review by the school";
    case "documents_requested": return "Documents requested";
    default: return "Evaluated";
  }
}

/** Claims are never shown as credit; only the school's decision is described. */
export function claimStatusView(s: TransferClaimStatus): StatusView {
  switch (s) {
    case "claimed": return { key: "notstarted", label: "Under review by the school" };
    case "submitted_to_school": return { key: "submitted", label: "Under review by the school" };
    case "accepted": return { key: "official", label: "Accepted by the school" };
    case "partially_accepted": return { key: "official", label: "Partly accepted by the school" };
    default: return { key: "attention", label: "Not accepted by the school" };
  }
}

// ── Guardians ───────────────────────────────────────────────────────────────

export function guardianStandingView(standing: HsGuardianStanding): StatusView & { detail: string } {
  switch (standing) {
    case "verified_guardian": return { key: "applied", label: "Verified guardian", detail: "Lumière verified this person's legal role." };
    case "guardian_unverified": return { key: "submitted", label: "Guardian — awaiting verification", detail: "Lumière has not verified this yet." };
    case "revoked": return { key: "notstarted", label: "No longer authorized", detail: "This person is no longer listed as authorized." };
    default: return { key: "notstarted", label: "Listed parent", detail: "Listed by you. No special permissions." };
  }
}

export function guardianSharingLabel(g: HsGuardianView): string {
  const parts: string[] = [];
  if (g.mayDiscussAcademics) parts.push("grades and progress");
  if (g.mayDiscussFinances) parts.push("billing");
  if (parts.length === 0) return "Lumière does not discuss grades or billing with this person.";
  return `Lumière may discuss ${parts.join(" and ")} with this person.`;
}

export const GUARDIAN_EXPLAINER =
  "Verification does not give anyone access to your portal account. Lumière discusses grades or billing only with verified guardians who have that permission.";

export const GOVERNANCE_COPY = {
  headline: "Your school confirms grades, credits and your diploma. Lumière plans and supports.",
  detail: "Anything you report here helps Lumière support you, but it only becomes official once the school confirms it.",
} as const;

// ── Support ─────────────────────────────────────────────────────────────────

export function supportDraft(course: Pick<HsCourseView, "title" | "key">, schoolLine: string): { subject: string; description: string } {
  return {
    subject: `High school help: ${course.title}`,
    description: `Hi Lumière, I would like help with "${course.title}" in my high school plan (${schoolLine}). `,
  };
}

/** A stable per-course idempotency key (matches the support key pattern: 16-100 of A-Za-z0-9_-). */
export function supportKeyFor(courseKey: string, nonce: string): string {
  return `hs-${courseKey}-${nonce}`.replace(/[^A-Za-z0-9_-]/g, "-").padEnd(16, "0").slice(0, 100);
}

export function describeGeneratedAt(iso: string, formatDate: (iso: string | null) => string | null): string {
  return `Updated ${formatDate(iso.slice(0, 10)) ?? "recently"}`;
}
