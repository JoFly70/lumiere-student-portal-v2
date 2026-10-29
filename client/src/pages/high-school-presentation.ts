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
import { formatCreditsLocale, translate, type Language } from "@/i18n";

/**
 * Every helper that returns wording takes an optional trailing `lang` (default English, so callers and tests that
 * do not pass one are unchanged). Components pass the language from useT(); nothing here reads storage.
 */
const tr = (lang: Language, key: string, vars?: Record<string, string | number>) => translate(lang, key, vars);
/** English singular only for exactly 1 credit (2 half-units); French is singular below 2 credits (under 4 half-units). */
export const creditUnit = (half: HalfUnits, lang: Language = "en") => tr(lang, (lang === "fr" ? half < 4 : half === 2) ? "hs.unit.credit" : "hs.unit.credits");

export const HS_PATH = "/high-school";
export const HS_TABS = [
  { id: "roadmap", label: "Roadmap" },
  { id: "journey", label: "My Journey" },
  { id: "subjects", label: "My Subjects" },
  { id: "graduation", label: "My Graduation" },
] as const;
export type HsTabId = (typeof HS_TABS)[number]["id"];

/** Tab label split so the "My " lead-in can be dropped on narrow screens ("Mon ", "Mes " in French). */
export function hsTabParts(id: HsTabId, lang: Language = "en"): { prefix: string; rest: string } {
  return { prefix: tr(lang, `hs.tab.${id}.prefix`), rest: tr(lang, `hs.tab.${id}.rest`) };
}

export function tabFromHash(hash: string | null | undefined): HsTabId | null {
  const id = (hash ?? "").replace(/^#/, "");
  return HS_TABS.some((t) => t.id === id) ? (id as HsTabId) : null;
}

// ── Credits ─────────────────────────────────────────────────────────────────

/** "10.5" with the unit: "1 credit" / "10.5 credits". */
export function creditsLabel(half: HalfUnits, lang: Language = "en"): string {
  return `${formatCreditsLocale(half, lang)} ${creditUnit(half, lang)}`;
}

/** "10.5 of 21 credits". */
export function creditsOfLabel(earned: HalfUnits, required: HalfUnits, lang: Language = "en"): string {
  return tr(lang, "hs.creditsOf", { earned: formatCreditsLocale(earned, lang), required: formatCreditsLocale(required, lang), unit: creditUnit(required, lang) });
}

/** Whole-number percent for sizing a graphic, floored (never rounds up to 100). */
export function barPercent(part: HalfUnits, whole: HalfUnits): number {
  return halfUnitPercent(part, whole);
}

/**
 * Work the student reported as finished but the school has not confirmed. Plain text only:
 * it is never drawn as credit (not in the ring, not in a bar).
 */
export function reportedWaitingLabel(half: HalfUnits, courses = 0, lang: Language = "en"): string | null {
  if (half <= 0) return null;
  if (courses <= 0) return tr(lang, "hs.waiting.credits", { credits: creditsLabel(half, lang) });
  return tr(lang, courses === 1 ? "hs.waiting.coursesOne" : "hs.waiting.coursesOther", { n: courses, credits: creditsLabel(half, lang) });
}

/** Courses whose every task the student marked submitted (what credits.awaitingConfirmationHalfUnits counts). */
export function fullySentCourseCount(subjects: readonly HsSubjectView[]): number {
  return subjects.reduce((n, s) => n + s.courses.filter((c) => c.status === "awaiting_school").length, 0);
}

// ── Titles ──────────────────────────────────────────────────────────────────

const PLACEHOLDER_SUFFIX = /\s*\((?:confirmed per enrollment|to be confirmed)\)\s*$/i;

/** Template placeholders such as "Mathematics course 3 (confirmed per enrollment)" show as "Mathematics course 3". */
export function courseTitleView(title: string): { title: string; toBeConfirmed: boolean } {
  const clean = title.replace(PLACEHOLDER_SUFFIX, "").trim();
  return { title: clean || title, toBeConfirmed: clean !== title.trim() };
}

export function cleanCourseTitle(title: string): string {
  return courseTitleView(title).title;
}

/** Titles for tasks listed together: a repeated title gets its course name so rows are distinguishable. */
export function taskListTitles<T extends { key: string; title: string; courseKey: string; courseTitle: string }>(tasks: readonly T[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(t.title, (counts.get(t.title) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const t of tasks) out.set(`${t.courseKey}:${t.key}`, (counts.get(t.title) ?? 0) > 1 ? `${t.title} (${cleanCourseTitle(t.courseTitle)})` : t.title);
  return out;
}

/** Each task once, first occurrence wins. */
export function uniqueTasks<T extends { key: string; courseKey: string }>(tasks: readonly T[]): T[] {
  const seen = new Set<string>();
  return tasks.filter((t) => {
    const k = `${t.courseKey}:${t.key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Courses the student can still work on that have a written project the school has not confirmed. */
export function hasOpenProject(course: HsCourseView): boolean {
  if (course.status === "replaced" || course.status === "transfer_credit" || course.status === "official_complete") return false;
  return course.tasks.some((t) => t.kind === "project" && t.status !== "official_passed");
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

export function subjectLabel(subject: HsSubjectArea, lang: Language = "en"): string {
  return lang === "en" ? HS_SUBJECT_LABELS[subject] : tr(lang, `hs.subject.${subject}`);
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

/** Active work first, finished next, replaced last (the UI tucks replaced ones into "Earlier plan"). */
export function sortedCourses(courses: readonly HsCourseView[]): HsCourseView[] {
  return [...courses]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => COURSE_ORDER[a.c.status] - COURSE_ORDER[b.c.status] || a.i - b.i)
    .map((x) => x.c);
}

export interface CourseGroups {
  /** In progress, waiting for the school, not passed, then not started. */
  readonly active: HsCourseView[];
  /** Official complete and transfer credit. */
  readonly done: HsCourseView[];
  /** Replaced by an updated plan. */
  readonly earlier: HsCourseView[];
}

export function groupCourses(courses: readonly HsCourseView[]): CourseGroups {
  const sorted = sortedCourses(courses);
  const rank = (c: HsCourseView) => ({ in_progress: 0, awaiting_school: 1, not_passed: 2, not_started: 3 } as Partial<Record<HsCourseDisplayStatus, number>>)[c.status] ?? 9;
  const active = sorted.filter((c) => rank(c) < 9).sort((a, b) => rank(a) - rank(b));
  return {
    active,
    done: sorted.filter((c) => c.status === "official_complete" || c.status === "transfer_credit"),
    earlier: sorted.filter((c) => c.status === "replaced"),
  };
}

/** The subject that holds the current course (the only one open by default). */
export function currentSubject(view: Pick<StudentHighSchoolView, "current" | "subjects">): HsSubjectArea | null {
  const key = view.current.course?.key;
  if (!key) return null;
  return view.subjects.find((s) => s.courses.some((c) => c.key === key))?.subject ?? null;
}

const TASK_KIND_ORDER: Record<HsTaskKind, number> = { lesson: 0, project: 1, exam: 2 };
export function sortedTasks(tasks: readonly HsTaskView[]): HsTaskView[] {
  return [...tasks]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => TASK_KIND_ORDER[a.t.kind] - TASK_KIND_ORDER[b.t.kind] || a.i - b.i)
    .map((x) => x.t);
}

export const TASK_KIND_LABEL: Record<HsTaskKind, string> = { lesson: "Lessons", exam: "Exam", project: "Written project" };

export function taskKindLabel(kind: HsTaskKind, lang: Language = "en"): string {
  return tr(lang, `hs.taskKind.${kind}`);
}

export function subjectSummary(s: HsSubjectView, lang: Language = "en"): string {
  return `${creditsOfLabel(s.earnedHalfUnits, s.requiredHalfUnits, lang)} (${lang === "fr" ? "officiels" : "official"})`;
}

export function courseCountLabel(s: HsSubjectView, lang: Language = "en"): string {
  const active = s.courses.filter((c) => c.status !== "replaced").length;
  return tr(lang, active === 1 ? "hs.course.one" : "hs.course.other", { n: active });
}

// ── Status language ─────────────────────────────────────────────────────────

export interface StatusView {
  readonly key: StatusKey;
  readonly label: string;
}

/** Colour + icon + label always travel together (see StatusPill). */
export function taskStatusView(status: HsTaskDisplayStatus, lang: Language = "en"): StatusView {
  const l = (k: string) => tr(lang, `hs.task.${k}`);
  switch (status) {
    case "official_passed": return { key: "official", label: l("official_passed") };
    case "official_failed": return { key: "attention", label: l("official_failed") };
    case "retake_required": return { key: "attention", label: l("retake_required") };
    // Produced purely by the student marking "Submitted" or typing a score: never worded as the school's step.
    case "pending_review": return { key: "submitted", label: l("pending_review") };
    case "in_progress": return { key: "progress", label: l("in_progress") };
    default: return { key: "notstarted", label: l("not_started") };
  }
}

export function courseStatusView(status: HsCourseDisplayStatus, lang: Language = "en"): StatusView {
  const l = (k: string) => tr(lang, `hs.courseStatus.${k}`);
  switch (status) {
    case "official_complete": return { key: "official", label: l("official_complete") };
    case "transfer_credit": return { key: "official", label: l("transfer_credit") };
    case "awaiting_school": return { key: "submitted", label: l("awaiting_school") };
    case "in_progress": return { key: "progress", label: l("in_progress") };
    case "not_passed": return { key: "attention", label: l("not_passed") };
    case "replaced": return { key: "notstarted", label: l("replaced") };
    default: return { key: "notstarted", label: l("not_started") };
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

export function reportedStatusOptions(lang: Language = "en"): readonly { value: HsReportedStatus; label: string }[] {
  return REPORTED_STATUS_OPTIONS.map((o) => ({ value: o.value, label: tr(lang, `hs.reported.${o.value}`) }));
}

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
export function scoreLines(task: Pick<HsTaskView, "officialScorePercent" | "reportedScorePercent">, lang: Language = "en"): ScoreLine[] {
  const out: ScoreLine[] = [];
  if (task.officialScorePercent !== null) out.push({ kind: "official", label: tr(lang, "hs.score.official", { n: task.officialScorePercent }) });
  if (task.reportedScorePercent !== null) out.push({ kind: "reported", label: tr(lang, "hs.score.reported", { n: task.reportedScorePercent }) });
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

export function monthLabel(ym: string, lang: Language = "en"): string {
  const t = Date.parse(`${ym}-01T00:00:00Z`);
  if (Number.isNaN(t)) return ym;
  return new Date(t).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function dueLabel(due: string | null, today: string, formatDate: (iso: string | null) => string | null, lang: Language = "en"): string | null {
  const when = formatDate(due);
  if (!when) return null;
  const d = daysUntil(due, today);
  if (d === null) return tr(lang, "hs.due.target", { when });
  if (d < 0) return tr(lang, "hs.due.was", { when });
  if (d === 0) return tr(lang, "hs.due.today", { when });
  if (d === 1) return tr(lang, "hs.due.tomorrow", { when });
  return tr(lang, "hs.due.target", { when });
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

export function paceView(pace: StudentHighSchoolView["pace"], lang: Language = "en"): PaceView {
  // One pace measure only: the status is computed from the monthly milestones, so a weekly figure
  // is shown only when the plan has no milestones (two measures can disagree on one card).
  const usesMilestones = pace.expectedByNowHalfUnits !== null || pace.nextMilestone !== null;
  const weekly = !usesMilestones && pace.weeklyTargetHalfUnits !== null ? tr(lang, "hs.pace.weekly", { credits: creditsLabel(pace.weeklyTargetHalfUnits, lang) }) : "";
  switch (pace.status) {
    case "on_track":
      return { key: "progress", label: tr(lang, "hs.pace.onTrack"), detail: tr(lang, "hs.pace.onTrackDetail", { weekly }) };
    case "ahead":
      return { key: "applied", label: tr(lang, "hs.pace.ahead"), detail: tr(lang, "hs.pace.aheadDetail", { weekly }) };
    case "behind":
      return { key: "attention", label: tr(lang, "hs.pace.behind"), detail: tr(lang, "hs.pace.behindDetail", { weekly }) };
    default:
      return { key: "notstarted", label: tr(lang, "hs.pace.none"), detail: tr(lang, "hs.pace.noneDetail") };
  }
}

export function nextMilestoneLabel(pace: StudentHighSchoolView["pace"], lang: Language = "en"): string | null {
  const m = pace.nextMilestone;
  if (!m) return null;
  return tr(lang, "hs.pace.milestone", { month: monthLabel(m.month, lang), credits: creditsLabel(m.cumulativeHalfUnits, lang) });
}

export interface PaceBar {
  /** Official credit, as a floored percent of the requirement. */
  readonly officialPercent: number;
  /** Where the plan expected the student to be by now; null when no milestones are configured. */
  readonly expectedPercent: number | null;
  /** Visible line under the bar; the bar itself carries the official total. null when there is nothing to add. */
  readonly summary: string | null;
  readonly ariaLabel: string;
  /** True when there is nothing to draw yet: no official credit and no plan milestone. The card then says so in words. */
  readonly empty: boolean;
}

/** ONE measure: official credits against what the plan's milestones expected by now. No calendar bar. */
export function paceBar(view: Pick<StudentHighSchoolView, "credits" | "pace">, lang: Language = "en"): PaceBar {
  const { earnedHalfUnits: earned, requiredHalfUnits: required } = view.credits;
  const expected = view.pace.expectedByNowHalfUnits;
  const officialPercent = barPercent(earned, required);
  const expectedPercent = expected === null ? null : barPercent(Math.min(expected, required), required);
  const summary = expected === null ? null : tr(lang, "hs.pace.expectedSummary", { credits: creditsLabel(Math.min(expected, required), lang) });
  const ariaLabel = `${tr(lang, "hs.official", { label: creditsOfLabel(earned, required, lang) })}${expected === null ? "" : tr(lang, "hs.pace.ariaExpected", { n: formatCreditsLocale(expected, lang) })}`;
  return { officialPercent, expectedPercent, summary, ariaLabel, empty: earned === 0 && expected === null };
}

/** Title of the requirements panel: past tense once the diploma is conferred. */
export function requirementsTitle(conferred: boolean, lang: Language = "en"): string {
  return tr(lang, conferred ? "hs.requirements.conferred" : "hs.requirements.pending");
}

/** The target date line. A date is a target, never a guarantee. */
export function targetDateLine(view: Pick<StudentHighSchoolView, "enrollment" | "credits">, formatDate: (iso: string | null) => string | null, lang: Language = "en"): string {
  if (view.credits.remainingHalfUnits === 0) return tr(lang, "hs.target.allOfficial");
  const when = formatDate(view.enrollment.targetCompletionDate);
  if (!when) return tr(lang, "hs.target.unset");
  return tr(lang, "hs.target.date", { when });
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

export function nextStep(view: StudentHighSchoolView, today: string, formatDate: (iso: string | null) => string | null, lang: Language = "en"): NextStep {
  const l = (k: string, vars?: Record<string, string | number>) => tr(lang, `hs.next.${k}`, vars);
  if (view.graduation.status === "diploma_conferred") {
    return { tone: "done", title: l("graduated"), detail: l("graduatedDetail"), courseKey: null, taskKey: null, action: { label: l("graduatedAction"), tab: "graduation" } };
  }
  if (!view.roadmap) {
    return { tone: "plan", title: l("planTitle"), detail: l("planDetail"), courseKey: null, taskKey: null, action: null };
  }
  const t = view.current.nextTask;
  if (t) {
    const when = dueLabel(t.dueDate, today, formatDate, lang);
    return {
      tone: "task",
      title: t.title,
      detail: `${cleanCourseTitle(t.courseTitle)}${when ? ` · ${when}` : ""}`,
      courseKey: t.courseKey,
      taskKey: t.key,
      action: { label: l("openCourse"), tab: "subjects" },
    };
  }
  if (view.graduation.status === "eligibility_confirmed") {
    return { tone: "graduation", title: l("eligibleTitle"), detail: l("eligibleDetail"), courseKey: null, taskKey: null, action: { label: l("goGraduation"), tab: "graduation" } };
  }
  if (view.awaitingGrade.length > 0) {
    const n = view.awaitingGrade.length;
    return { tone: "review", title: l("waitingTitle"), detail: l(n === 1 ? "waitingTasksOne" : "waitingTasksOther", { n }), courseKey: null, taskKey: null, action: { label: l("seeSubjects"), tab: "subjects" } };
  }
  if (view.graduation.creditsSatisfied) {
    return { tone: "graduation", title: l("creditsDoneTitle"), detail: l("creditsDoneDetail"), courseKey: null, taskKey: null, action: { label: l("goGraduation"), tab: "graduation" } };
  }
  const started = view.credits.earnedHalfUnits > 0 || view.subjects.some((s) => s.courses.some((c) => c.status !== "not_started"));
  return {
    tone: started ? "plan" : "welcome",
    title: started ? l("pickTitle") : l("startTitle"),
    detail: l("openSubjectsDetail"),
    courseKey: null,
    taskKey: null,
    action: { label: l("openSubjects"), tab: "subjects" },
  };
}

/**
 * Attention items for the Journey next-step card. Items already shown elsewhere on the tab are dropped:
 * the next task itself (its card says so) and pace (the pace card says so).
 */
export function journeyAttention(view: Pick<StudentHighSchoolView, "attention" | "current">): HsAttentionItem[] {
  const nextKey = view.current.nextTask?.key ?? null;
  return view.attention.filter((a) => a.kind !== "behind_pace" && !(nextKey !== null && a.taskKey === nextKey));
}

export interface AttentionView {
  /** Who acts, in the student's words. */
  readonly title: string;
  /** Extra detail from the server, shown only when the title does not already say it. */
  readonly detail: string | null;
  readonly action: { readonly kind: "documents" | "course" | "support"; readonly label: string } | null;
}

/** Every attention kind has an owner: work the student does reads as theirs, Lumière's as Lumière's. */
export function attentionView(a: Pick<HsAttentionItem, "kind" | "message">, lang: Language = "en"): AttentionView {
  const l = (k: string) => tr(lang, `hs.attention.${k}`);
  switch (a.kind) {
    case "documents_requested":
      return /transcript/i.test(a.message)
        ? { title: l("transcript"), detail: null, action: { kind: "documents", label: l("upload") } }
        : { title: l("document"), detail: a.message, action: { kind: "documents", label: l("upload") } };
    case "overdue_task":
      return { title: l("overdue"), detail: a.message, action: { kind: "course", label: l("openCourse") } };
    case "retake_required":
      return { title: l("retake"), detail: a.message, action: { kind: "course", label: l("openCourse") } };
    case "behind_pace":
      return { title: l("behind"), detail: a.message, action: { kind: "support", label: l("askLumiere") } };
    case "not_passed":
      return { title: l("notPassed"), detail: a.message, action: { kind: "support", label: l("askLumiere") } };
    default:
      return { title: l("help"), detail: a.message, action: { kind: "support", label: l("askLumiere") } };
  }
}

// ── Graduation ──────────────────────────────────────────────────────────────

export interface ReviewStatusView {
  readonly key: StatusKey;
  readonly label: string;
  readonly detail: string;
}

export function reviewStatusView(g: HsGraduationView, lang: Language = "en"): ReviewStatusView {
  const l = (k: string) => tr(lang, `hs.review.${k}`);
  if (g.status === "diploma_conferred") return { key: "official", label: l("conferred"), detail: l("conferredDetail") };
  if (g.status === "eligibility_confirmed") return { key: "official", label: l("eligible"), detail: l("eligibleDetail") };
  if (g.creditsSatisfied && g.outstandingExams === 0 && g.outstandingProjects === 0) {
    return { key: "submitted", label: l("pending"), detail: l("pendingDetail") };
  }
  return { key: "notstarted", label: l("notReady"), detail: l("notReadyDetail") };
}

/** Outstanding work phrased as what is left in the plan. null when nothing is left. */
export function outstandingWorkLabel(g: Pick<HsGraduationView, "outstandingExams" | "outstandingProjects">, lang: Language = "en"): string | null {
  const parts: string[] = [];
  if (g.outstandingExams > 0) parts.push(tr(lang, g.outstandingExams === 1 ? "hs.outstanding.examOne" : "hs.outstanding.examOther", { n: g.outstandingExams }));
  if (g.outstandingProjects > 0) parts.push(tr(lang, g.outstandingProjects === 1 ? "hs.outstanding.projectOne" : "hs.outstanding.projectOther", { n: g.outstandingProjects }));
  if (parts.length === 0) return null;
  const work = parts.length === 2 ? tr(lang, "hs.outstanding.and", { a: parts[0], b: parts[1] }) : parts[0];
  return tr(lang, "hs.outstanding.left", { work });
}

export function financialClearanceView(value: HsGraduationView["financialClearance"], lang: Language = "en"): { key: StatusKey; label: string; detail: string } {
  const l = (k: string) => tr(lang, `hs.clearance.${k}`);
  switch (value) {
    case "cleared": return { key: "applied", label: l("cleared"), detail: l("clearedDetail") };
    case "hold": return { key: "attention", label: l("hold"), detail: l("holdDetail") };
    default: return { key: "notstarted", label: l("unknown"), detail: l("unknownDetail") };
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

export function deliveryLabel(status: HsGraduationView["transcript"]["status"], lang: Language = "en"): string {
  return tr(lang, `hs.delivery.${status}`);
}

export function transcriptRequestState(g: HsGraduationView, lang: Language = "en"): TranscriptRequestState {
  const statusLabel = deliveryLabel(g.transcript.status, lang);
  if (!canRequestTranscript(g)) {
    return { enabled: false, reason: tr(lang, "hs.transcript.notEligible"), statusLabel };
  }
  if (g.transcript.status !== "not_requested") {
    return { enabled: false, reason: tr(lang, g.transcript.status === "requested" ? "hs.transcript.requested" : "hs.transcript.ready"), statusLabel };
  }
  return { enabled: true, reason: tr(lang, "hs.transcript.canRequest"), statusLabel };
}

export function diplomaDeliveryLabel(g: HsGraduationView["diploma"], lang: Language = "en"): string {
  if (g.status === "not_requested") return tr(lang, "hs.diploma.notConferred");
  return deliveryLabel(g.status, lang);
}

export function creditRequirementRows(view: Pick<StudentHighSchoolView, "credits">, lang: Language = "en"): { id: "core" | "elective"; label: string; earned: HalfUnits; required: HalfUnits; satisfied: boolean }[] {
  const { core, elective } = view.credits;
  return [
    { id: "core", label: tr(lang, "hs.credits.core"), earned: core.earnedHalfUnits, required: core.requiredHalfUnits, satisfied: core.earnedHalfUnits >= core.requiredHalfUnits },
    { id: "elective", label: tr(lang, "hs.credits.elective"), earned: elective.earnedHalfUnits, required: elective.requiredHalfUnits, satisfied: elective.earnedHalfUnits >= elective.requiredHalfUnits },
  ];
}

// ── Prior education ─────────────────────────────────────────────────────────

export function priorEducationStatusLabel(s: PriorEducationStatus, lang: Language = "en"): string {
  switch (s) {
    case "reported": return tr(lang, "hs.prior.reported");
    case "documents_requested": return tr(lang, "hs.prior.documents_requested");
    default: return tr(lang, "hs.prior.evaluated");
  }
}

export type ClaimView = { readonly status: TransferClaimStatus; readonly courseTitle: string; readonly claimedHalfUnits: HalfUnits; readonly acceptedHalfUnits?: HalfUnits | null };

/** Titles of courses the school recorded as transfer credit (the only proof that a claim became credit). */
export function recordedTransferTitles(subjects: readonly HsSubjectView[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const s of subjects) for (const c of s.courses) if (c.status === "transfer_credit") out.add(cleanCourseTitle(c.title).toLowerCase());
  return out;
}

/**
 * A claim is the student's / Lumière's statement, never credit. Only a course that appears in the subjects
 * with status transfer_credit shows the official badge; every other state uses a non-official style.
 */
export function claimStatusView(s: TransferClaimStatus, recorded = false, lang: Language = "en"): StatusView {
  switch (s) {
    case "claimed": return { key: "notstarted", label: tr(lang, "hs.claim.claimed") };
    case "submitted_to_school": return { key: "submitted", label: tr(lang, "hs.claim.submitted") };
    case "accepted":
    case "partially_accepted":
      return recorded
        ? { key: "official", label: tr(lang, "hs.claim.recorded") }
        : { key: "progress", label: tr(lang, "hs.claim.acceptedNotRecorded") };
    default: return { key: "attention", label: tr(lang, "hs.claim.rejected") };
  }
}

/** "Accepted: 1 of 1.5 credits" when the school's accepted amount is known. */
export function claimAcceptedLabel(c: ClaimView, lang: Language = "en"): string | null {
  if (c.acceptedHalfUnits === undefined || c.acceptedHalfUnits === null) return null;
  return tr(lang, "hs.claim.accepted", { accepted: formatCreditsLocale(c.acceptedHalfUnits, lang), claimed: creditsLabel(c.claimedHalfUnits, lang) });
}

// ── Guardians ───────────────────────────────────────────────────────────────

export function guardianStandingView(standing: HsGuardianStanding, lang: Language = "en"): StatusView & { detail: string } {
  const l = (k: string) => tr(lang, `hs.guardian.${k}`);
  switch (standing) {
    case "verified_guardian": return { key: "applied", label: l("verified"), detail: l("verifiedDetail") };
    case "guardian_unverified": return { key: "submitted", label: l("unverified"), detail: l("unverifiedDetail") };
    case "revoked": return { key: "notstarted", label: l("revoked"), detail: l("revokedDetail") };
    default: return { key: "notstarted", label: l("parent"), detail: l("parentDetail") };
  }
}

function sharingParts(g: HsGuardianView, lang: Language): string {
  const parts: string[] = [];
  if (g.mayDiscussAcademics) parts.push(tr(lang, "hs.guardian.shareAcademics"));
  if (g.mayDiscussFinances) parts.push(tr(lang, "hs.guardian.shareBilling"));
  return parts.length === 2 ? tr(lang, "hs.guardian.shareBoth", { a: parts[0], b: parts[1] }) : (parts[0] ?? "");
}

export function guardianSharingLabel(g: HsGuardianView, lang: Language = "en"): string {
  const parts = sharingParts(g, lang);
  return parts === "" ? tr(lang, "hs.guardian.shareNone") : tr(lang, "hs.guardian.shareSome", { parts });
}

export const GUARDIAN_EXPLAINER = "Lumière discusses grades or billing only with verified guardians who have that permission.";
export const NO_PORTAL_ACCESS_NOTE = "Nobody on this list can sign in to your account.";

export function guardianExplainer(lang: Language = "en"): string {
  return tr(lang, "hs.guardian.explainer");
}

export function noPortalAccessNote(lang: Language = "en"): string {
  return tr(lang, "hs.guardian.noPortal");
}

/** One short line per person; the standing pill already says who they are. */
export function guardianSharingShort(g: HsGuardianView, lang: Language = "en"): string {
  const parts = sharingParts(g, lang);
  return parts === "" ? tr(lang, "hs.guardian.shortNone") : tr(lang, "hs.guardian.shortSome", { parts });
}

export const GOVERNANCE_COPY = {
  /** The single short trust line in the header. */
  headline: "Only your school confirms grades, credits and your diploma.",
  /** Two sentences, behind the "What's official?" disclosure. */
  detail: "Lumière plans and supports you. Anything you report here helps us help you, but it only becomes official once your school confirms it.",
} as const;

export function governanceCopy(lang: Language = "en"): { headline: string; detail: string } {
  return { headline: tr(lang, "hs.gov.headline"), detail: tr(lang, "hs.gov.detail") };
}

// ── Support ─────────────────────────────────────────────────────────────────

export function supportDraft(course: Pick<HsCourseView, "title" | "key">, schoolLine: string, lang: Language = "en"): { subject: string; description: string } {
  const title = cleanCourseTitle(course.title);
  return {
    subject: tr(lang, "hs.supportDraft.subject", { title }),
    description: tr(lang, "hs.supportDraft.description", { title, school: schoolLine }),
  };
}

/** A stable per-course idempotency key (matches the support key pattern: 16-100 of A-Za-z0-9_-). */
export function supportKeyFor(courseKey: string, nonce: string): string {
  return `hs-${courseKey}-${nonce}`.replace(/[^A-Za-z0-9_-]/g, "-").padEnd(16, "0").slice(0, 100);
}

export function describeGeneratedAt(iso: string, formatDate: (iso: string | null) => string | null, lang: Language = "en"): string {
  const when = formatDate(iso.slice(0, 10));
  return when ? tr(lang, "hs.updated", { when }) : tr(lang, "hs.updatedRecently");
}
