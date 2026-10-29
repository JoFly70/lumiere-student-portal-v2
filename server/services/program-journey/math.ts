/**
 * S27 — pure date, deadline, checkpoint and logged-pace math. No I/O, no clock reads: every function takes
 * "today" as a yyyy-mm-dd string. All dates are UTC calendar days (Africa/Casablanca is treated as UTC for
 * "today" and "Monday"; the one-hour offset never moves a date for the purposes shown here).
 */
import {
  CHECKPOINT_KEYS,
  CHECKPOINT_LABELS,
  type AgreementDeadlineView,
  type CheckpointKey,
  type CheckpointView,
  type DeadlineStatus,
  type LoggedPaceView,
} from "@shared/s27-contract";

export const DAY_MS = 86_400_000;
const parse = (d: string) => new Date(`${d}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return fmt(new Date(parse(date).getTime() + days * DAY_MS));
}

/** Calendar month addition; the day is clamped to the end of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const d = parse(date);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fmt(target);
}

/** Whole days from a to b (b - a); negative when b is before a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / DAY_MS);
}

/** Monday (UTC) of the week containing the date. */
export function mondayOf(date: string): string {
  const dow = parse(date).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

/** Months left until `endsOn`, rounded UP to whole months (a partial month counts as one); 0 once ended. */
export function monthsLeft(today: string, endsOn: string): number {
  if (endsOn <= today) return 0;
  let m = 0;
  while (addMonths(today, m) < endsOn) m++;
  return m;
}

// ── agreement terms and deadlines ────────────────────────────────────────────

export interface AgreementTerms {
  readonly signedOn: string | null;
  readonly activatedOn: string | null;
  readonly supportMonths: number;
  readonly accessMonths: number;
  readonly languageTestDays: number;
  readonly priorSchoolingDays: number;
  readonly languageTestStatus: DeadlineStatus;
  readonly languageTestDoneOn: string | null;
  readonly languageTestScore: number | null;
  readonly languageTestTarget: string | null;
  readonly priorSchoolingStatus: DeadlineStatus;
  readonly priorSchoolingDoneOn: string | null;
}

export function computeSupport(terms: Pick<AgreementTerms, "activatedOn" | "supportMonths" | "accessMonths">, today: string) {
  const supportEndsOn = terms.activatedOn ? addMonths(terms.activatedOn, terms.supportMonths) : null;
  const accessEndsOn = terms.activatedOn ? addMonths(terms.activatedOn, terms.accessMonths) : null;
  return { supportEndsOn, accessEndsOn, supportMonthsLeft: supportEndsOn ? monthsLeft(today, supportEndsOn) : null };
}

function deadline(
  key: AgreementDeadlineView["key"],
  label: string,
  rule: string,
  dueOn: string | null,
  status: DeadlineStatus,
  doneOn: string | null,
  detail: string | null,
  today: string,
): AgreementDeadlineView {
  return { key, label, rule, dueOn, status, doneOn: status === "done" ? doneOn : null, detail, daysLeft: dueOn && status === "open" ? daysBetween(today, dueOn) : null };
}

export function computeDeadlines(t: AgreementTerms, today: string): AgreementDeadlineView[] {
  const scoreDetail = t.languageTestScore !== null || t.languageTestTarget
    ? [t.languageTestScore !== null ? `Score ${t.languageTestScore}` : null, t.languageTestTarget ? (t.languageTestScore !== null ? `(target ${t.languageTestTarget})` : `Target ${t.languageTestTarget}`) : null].filter(Boolean).join(" ")
    : null;
  return [
    deadline("language_test", "Language test", `${t.languageTestDays} days after signing`,
      t.signedOn ? addDays(t.signedOn, t.languageTestDays) : null, t.languageTestStatus, t.languageTestDoneOn, scoreDetail, today),
    deadline("prior_schooling_proof", "Proof of prior schooling", `${t.priorSchoolingDays} days after activation`,
      t.activatedOn ? addDays(t.activatedOn, t.priorSchoolingDays) : null, t.priorSchoolingStatus, t.priorSchoolingDoneOn, null, today),
  ];
}

// ── checkpoints ──────────────────────────────────────────────────────────────

export interface CheckpointRow { readonly key: CheckpointKey; readonly plannedOn: string | null; readonly doneOn: string | null }

/**
 * One view per checkpoint key, in contract order. The language-test checkpoint is done automatically when the
 * language-test deadline is done (its date is the deadline's doneOn). The first not-done checkpoint is "next".
 */
export function computeCheckpoints(rows: readonly CheckpointRow[], languageTest: Pick<AgreementDeadlineView, "status" | "doneOn"> | null): CheckpointView[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  let nextAssigned = false;
  return CHECKPOINT_KEYS.map((key) => {
    const row = byKey.get(key);
    let doneOn = row?.doneOn ?? null;
    if (key === "language_test" && !doneOn && languageTest?.status === "done") doneOn = languageTest.doneOn ?? row?.plannedOn ?? "";
    const done = doneOn !== null;
    let status: CheckpointView["status"] = "upcoming";
    if (done) status = "done";
    else if (!nextAssigned) { status = "next"; nextAssigned = true; }
    return { key, label: CHECKPOINT_LABELS[key], status, plannedOn: row?.plannedOn ?? null, doneOn: done ? (doneOn || null) : null };
  });
}

// ── logged pace ──────────────────────────────────────────────────────────────

export interface PacePlanCourse {
  readonly key: string;
  readonly halfUnits: number;
  /** task key -> kind, for every task of the course in the published plan. */
  readonly tasks: ReadonlyMap<string, "lesson" | "exam" | "project">;
}
export interface PaceLoggedItem {
  readonly courseKey: string;
  readonly taskKey: string;
  /** When the student last reported the task as submitted or with a score (ISO timestamp). */
  readonly at: string;
}
export interface PaceInput {
  readonly today: string;
  readonly requiredHalfUnits: number;
  readonly courses: readonly PacePlanCourse[];
  readonly logged: readonly PaceLoggedItem[];
  /** Courses that already hold an official, active course-completion credit (full credit, no pace estimate needed). */
  readonly awardedCourseKeys: ReadonlySet<string>;
  /** Official credit not tied to a plan course (e.g. accepted transfer credit), in half-units. */
  readonly otherAwardedHalfUnits: number;
  readonly weeklyExamLimit: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
export const PACE_WINDOW_DAYS = 28;
export const PACE_STALE_DAYS = 7;

/**
 * Pace from the student's own logs. Each submitted/scored task of a planned course is worth
 * (course credits / tasks in the course); creditsPerWeek = credit-equivalents logged in the last 28 days / 4.
 * Student reports never create official credit: this only estimates arrival.
 *
 * Remaining = required credits - (official credit + credit-equivalents already logged on courses that have no
 * official completion yet), so work already done but not yet confirmed is not counted twice.
 */
export function computePace(input: PaceInput): LoggedPaceView {
  const { today } = input;
  const courseByKey = new Map(input.courses.map((c) => [c.key, c]));
  const value = (courseKey: string): number => {
    const c = courseByKey.get(courseKey);
    return c && c.tasks.size > 0 ? c.halfUnits / 2 / c.tasks.size : 0;
  };
  // One entry per task (latest report wins), only tasks that exist in the plan.
  const latest = new Map<string, PaceLoggedItem>();
  for (const item of input.logged) {
    const c = courseByKey.get(item.courseKey);
    if (!c || !c.tasks.has(item.taskKey)) continue;
    const k = `${item.courseKey}\u0000${item.taskKey}`;
    const cur = latest.get(k);
    if (!cur || item.at > cur.at) latest.set(k, item);
  }
  const items = [...latest.values()];
  const dayOf = (item: PaceLoggedItem) => item.at.slice(0, 10);
  const windowStart = addDays(today, -(PACE_WINDOW_DAYS - 1));
  const inWindow = items.filter((i) => dayOf(i) >= windowStart && dayOf(i) <= today);
  const credits28 = inWindow.reduce((n, i) => n + value(i.courseKey), 0);
  const creditsPerWeek = round2(credits28 / (PACE_WINDOW_DAYS / 7));
  const lastLoggedOn = items.reduce<string | null>((m, i) => (m === null || dayOf(i) > m ? dayOf(i) : m), null);
  const stale = lastLoggedOn === null || daysBetween(lastLoggedOn, today) >= PACE_STALE_DAYS;

  const monday = mondayOf(today);
  const examsThisWeek = items.filter((i) => dayOf(i) >= monday && dayOf(i) <= today && courseByKey.get(i.courseKey)?.tasks.get(i.taskKey) === "exam").length;

  const officialCredits = input.otherAwardedHalfUnits / 2 + input.courses.filter((c) => input.awardedCourseKeys.has(c.key)).reduce((n, c) => n + c.halfUnits / 2, 0);
  const loggedUnconfirmed = items.filter((i) => !input.awardedCourseKeys.has(i.courseKey)).reduce((n, i) => n + value(i.courseKey), 0);
  const remaining = Math.max(0, input.requiredHalfUnits / 2 - officialCredits - loggedUnconfirmed);
  let estimatedFinishOn: string | null = null;
  if (remaining <= 0) estimatedFinishOn = today;
  else if (creditsPerWeek > 0) estimatedFinishOn = addDays(today, Math.ceil((remaining / creditsPerWeek) * 7));

  return { creditsPerWeek, itemsLogged28d: inWindow.length, lastLoggedOn, stale, estimatedFinishOn, examsThisWeek, weeklyExamLimit: input.weeklyExamLimit };
}

// ── pace input from stored rows (shared by the student journey and the Control Center) ──────────

export interface PlanContentLike {
  readonly courses?: ReadonlyArray<{ key: string; halfUnits: number; status: string; title?: string; tasks?: ReadonlyArray<{ key: string; kind: "lesson" | "exam" | "project" }> }>;
  readonly policies?: { weeklyExamLimit?: number | null } | null;
}
export interface ProgressRowLike { readonly courseKey: string; readonly taskKey: string; readonly status: string; readonly reportedScorePercent: number | null; readonly updatedAt: string }
export interface AwardRowLike { readonly courseKey: string | null; readonly source: string; readonly halfUnits: number }

/** A task counts as "logged" when the student reported it submitted or entered a score. */
export const isLogged = (p: Pick<ProgressRowLike, "status" | "reportedScorePercent">) => p.status === "submitted" || p.reportedScorePercent !== null;

export function buildPaceInput(args: {
  today: string;
  requiredHalfUnits: number;
  content: PlanContentLike;
  progress: readonly ProgressRowLike[];
  awards: readonly AwardRowLike[];
}): PaceInput {
  const courses: PacePlanCourse[] = (args.content.courses ?? []).filter((c) => c.status === "planned").map((c) => ({
    key: c.key, halfUnits: c.halfUnits, tasks: new Map((c.tasks ?? []).map((t) => [t.key, t.kind] as const)),
  }));
  const isCourseAward = (a: AwardRowLike) => a.source === "course_completion" && !!a.courseKey;
  return {
    today: args.today,
    requiredHalfUnits: args.requiredHalfUnits,
    courses,
    logged: args.progress.filter(isLogged).map((p) => ({ courseKey: p.courseKey, taskKey: p.taskKey, at: p.updatedAt })),
    awardedCourseKeys: new Set(args.awards.filter(isCourseAward).map((a) => a.courseKey as string)),
    otherAwardedHalfUnits: args.awards.filter((a) => !isCourseAward(a)).reduce((n, a) => n + a.halfUnits, 0),
    weeklyExamLimit: args.content.policies?.weeklyExamLimit ?? null,
  };
}
