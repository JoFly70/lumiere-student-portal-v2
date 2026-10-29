/**
 * S27 log-first Roadmap view-model (pure). Groups the published plan into Now / Up next / Electives (awaiting
 * approval) / Completed, maps tasks to the assessment dots, and holds the client-side guidance of the Log sheet.
 *
 * Official results are only what the school confirmed (server `status`); what the student logs is "waiting for a grade".
 */
import type { HsCourseView, HsTaskView, StudentHighSchoolView } from "@shared/high-school-contract";
import { electiveAwaitsApproval, electiveShortTitle } from "@/lib/elective-change";
import { courseTitleView } from "@/pages/high-school-presentation";
import { isPlanningTarget } from "@/lib/degree-map";

/** Default pass mark of the log guidance. A template policy (passingPercent) overrides it when one is configured. */
export const DEFAULT_PASS_PERCENT = 65;

/** "English 3: Analyzing Texts and Building Compositions" -> "English 3" (the school's numbered titles keep their number). */
export function shortCourseName(title: string): string {
  const m = /^(.{2,40}?):\s+\S/.exec(title);
  return m ? m[1]!.trim() : title;
}
export const courseName = (title: string): string => shortCourseName(electiveShortTitle(courseTitleView(title).title));

// ── dots ────────────────────────────────────────────────────────────────────

export type DotState = "done" | "sub" | "fail" | "next" | "todo";
export interface Dot {
  readonly key: string;
  readonly state: DotState;
  /** "P" for a project, "R" for a retake, the item number otherwise; a check for a passed item. */
  readonly label: string;
  readonly project: boolean;
  readonly title: string;
}

/** Tasks the student actually works on (the plan's "Planning target" note is not one). */
export const workTasks = (course: Pick<HsCourseView, "tasks">): readonly HsTaskView[] => course.tasks.filter((t) => !isPlanningTarget(t));

export function dotState(status: HsTaskView["status"]): DotState {
  switch (status) {
    case "official_passed": return "done";
    case "pending_review": return "sub";
    case "official_failed":
    case "retake_required": return "fail";
    default: return "todo";
  }
}

/** One dot per assessment; the first open one gets the gold "next" ring. */
export function buildDots(course: Pick<HsCourseView, "tasks">): Dot[] {
  const tasks = workTasks(course);
  let nextTaken = false;
  let n = 0;
  return tasks.map((t) => {
    const project = t.kind === "project";
    if (!project) n += 1;
    let state = dotState(t.status);
    if (state === "todo" && !nextTaken) { state = "next"; nextTaken = true; }
    if (state === "fail" && t.status === "retake_required") nextTaken = true;
    const label = state === "done" ? "✓" : project ? "P" : t.status === "retake_required" ? "R" : String(n);
    return { key: t.key, state, label, project, title: t.title };
  });
}

/** The next thing to do in a course: a retake first, else the first open item. */
export function nextTaskOf(course: Pick<HsCourseView, "tasks">): HsTaskView | null {
  const tasks = workTasks(course);
  return tasks.find((t) => t.status === "retake_required") ?? tasks.find((t) => t.status === "not_started" || t.status === "in_progress") ?? null;
}

export function passedCount(course: Pick<HsCourseView, "tasks">): { done: number; total: number; pct: number; waiting: number } {
  const tasks = workTasks(course);
  const done = tasks.filter((t) => t.status === "official_passed").length;
  const total = tasks.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0, waiting: tasks.filter((t) => t.status === "pending_review").length };
}

// ── grouping ────────────────────────────────────────────────────────────────

export interface RoadmapGroups {
  readonly now: readonly HsCourseView[];
  readonly upNext: readonly { course: HsCourseView; no: number }[];
  readonly electives: readonly { course: HsCourseView; no: number }[];
  readonly completed: readonly HsCourseView[];
  readonly totalCourses: number;
}

/** Courses in plan order: planned start first (undated last), then the server order. Replaced courses are not part of the plan. */
const isDone = (c: Pick<HsCourseView, "status">) => c.status === "official_complete" || c.status === "transfer_credit";
const sortKey = (c: HsCourseView) => (isDone(c) ? "0000" : c.plannedStart ?? "9999");

export function planOrder(view: Pick<StudentHighSchoolView, "subjects">): HsCourseView[] {
  return view.subjects
    .flatMap((s) => s.courses)
    .filter((c) => c.status !== "replaced")
    .map((c, i) => ({ c, i }))
    .sort((a, b) => sortKey(a.c).localeCompare(sortKey(b.c)) || a.i - b.i)
    .map((x) => x.c);
}

export function groupRoadmap(view: Pick<StudentHighSchoolView, "subjects">): RoadmapGroups {
  const ordered = planOrder(view);
  const numbered = ordered.map((course, i) => ({ course, no: i + 1 }));
  const now: HsCourseView[] = [];
  const upNext: { course: HsCourseView; no: number }[] = [];
  const electives: { course: HsCourseView; no: number }[] = [];
  const completed: HsCourseView[] = [];
  for (const { course, no } of numbered) {
    if (course.status === "official_complete" || course.status === "transfer_credit") completed.push(course);
    else if (electiveAwaitsApproval(course.title)) electives.push({ course, no });
    else if (course.status === "in_progress" || course.status === "awaiting_school" || course.status === "not_passed") now.push(course);
    else upNext.push({ course, no });
  }
  return { now, upNext, electives, completed, totalCourses: ordered.length };
}

/** Courses completed / total, for the summary tile. */
export function completedTile(groups: Pick<RoadmapGroups, "completed" | "totalCourses">): { done: number; total: number } {
  return { done: groups.completed.length, total: groups.totalCourses };
}

/** Average of the official scores recorded on a completed course, or null when none were recorded. */
export function averageScore(course: Pick<HsCourseView, "tasks">): number | null {
  const scores = workTasks(course).map((t) => t.officialScorePercent).filter((s): s is number => typeof s === "number");
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
}

// ── Log sheet ───────────────────────────────────────────────────────────────

export interface LogCourseOption {
  readonly key: string;
  readonly title: string;
  readonly items: readonly LogItemOption[];
  readonly defaultItemKey: string | null;
}
export interface LogItemOption {
  readonly key: string;
  readonly title: string;
  readonly kind: HsTaskView["kind"];
  /** The student already sent it (waiting for a grade): they may add the score. */
  readonly submitted: boolean;
  readonly revision: number;
}

/** Courses and items the student may report on. Official results are locked by the school and never offered. */
export function loggableCourses(view: Pick<StudentHighSchoolView, "subjects">): LogCourseOption[] {
  const out: LogCourseOption[] = [];
  for (const course of planOrder(view)) {
    if (electiveAwaitsApproval(course.title)) continue;
    if (!(course.status === "in_progress" || course.status === "not_started" || course.status === "awaiting_school" || course.status === "not_passed")) continue;
    const items: LogItemOption[] = workTasks(course)
      .filter((t) => t.status === "not_started" || t.status === "in_progress" || t.status === "pending_review" || t.status === "retake_required")
      .map((t) => ({ key: t.key, title: t.title, kind: t.kind, submitted: t.status === "pending_review", revision: t.progressRevision }));
    if (items.length === 0) continue;
    const next = nextTaskOf(course);
    out.push({ key: course.key, title: courseName(course.title), items, defaultItemKey: next && items.some((i) => i.key === next.key) ? next.key : items[0]!.key });
  }
  return out;
}

export type LogMode = "submitted" | "graded";

export interface GuidancePolicy {
  /** Pass mark in percent. */
  readonly passingPercent: number;
  /** Optional retake wording configured by the template / roadmap policy. */
  readonly retakeNote?: string | null;
}
export const DEFAULT_GUIDANCE_POLICY: GuidancePolicy = { passingPercent: DEFAULT_PASS_PERCENT, retakeNote: null };

export type GuidanceKey = "none" | "project_pending" | "scoreRange" | "passed" | "below_exam" | "below_project" | "below_generic";
export interface Guidance {
  readonly key: GuidanceKey;
  readonly tone: "neutral" | "good" | "bad";
  /** Policy text to append when the template configures one. */
  readonly note: string | null;
}

/** Parses the score box: "" -> null; a whole number 0..100 -> number; anything else -> "invalid". */
export function parseScore(raw: string): number | null | "invalid" {
  const s = raw.trim();
  if (s === "") return null;
  if (!/^\d{1,3}$/.test(s)) return "invalid";
  const n = Number(s);
  return n >= 0 && n <= 100 ? n : "invalid";
}

/** Client-side guidance under the score box. Never blocks saving: the school decides every outcome. */
export function logGuidance(input: { mode: LogMode; scoreRaw: string; kind: HsTaskView["kind"] | null; policy?: GuidancePolicy }): Guidance {
  const policy = input.policy ?? DEFAULT_GUIDANCE_POLICY;
  const none: Guidance = { key: "none", tone: "neutral", note: null };
  if (input.mode !== "graded" || input.scoreRaw.trim() === "") {
    return input.kind === "project" ? { key: "project_pending", tone: "neutral", note: null } : none;
  }
  const score = parseScore(input.scoreRaw);
  if (score === "invalid") return { key: "scoreRange", tone: "bad", note: null };
  if (score === null) return none;
  if (score >= policy.passingPercent) return { key: "passed", tone: "good", note: null };
  const note = policy.retakeNote ?? null;
  if (input.kind === "exam") return { key: "below_exam", tone: "bad", note };
  if (input.kind === "project") return { key: "below_project", tone: "bad", note };
  return { key: "below_generic", tone: "bad", note };
}

/** What the POST carries: Submitted -> submitted without a score field (so a score already reported is kept;
 *  null would erase it); Graded -> submitted with the score. */
export function progressPayload(input: { courseKey: string; taskKey: string; mode: LogMode; scoreRaw: string; expectedRevision: number }):
  | { ok: true; body: { courseKey: string; taskKey: string; status: "submitted"; reportedScorePercent?: number; expectedRevision: number } }
  | { ok: false; reason: "score" } {
  if (input.mode === "graded") {
    const score = parseScore(input.scoreRaw);
    if (score === null || score === "invalid") return { ok: false, reason: "score" };
    return { ok: true, body: { courseKey: input.courseKey, taskKey: input.taskKey, status: "submitted", reportedScorePercent: score, expectedRevision: input.expectedRevision } };
  }
  return { ok: true, body: { courseKey: input.courseKey, taskKey: input.taskKey, status: "submitted", expectedRevision: input.expectedRevision } };
}

/** Optimistic update of the cached view: the task shows as "waiting for the school" with the reported score. */
export function applyOptimisticProgress(
  view: StudentHighSchoolView,
  body: { courseKey: string; taskKey: string; reportedScorePercent?: number | null },
): StudentHighSchoolView {
  const patchTask = (t: HsTaskView): HsTaskView => ({ ...t, status: "pending_review", reportedScorePercent: body.reportedScorePercent ?? t.reportedScorePercent, progressRevision: t.progressRevision + 1, overdue: false });
  return {
    ...view,
    subjects: view.subjects.map((s) => ({
      ...s,
      courses: s.courses.map((c) =>
        c.key !== body.courseKey ? c : { ...c, status: c.status === "not_started" ? "in_progress" : c.status, tasks: c.tasks.map((t) => (t.key === body.taskKey ? patchTask(t) : t)) },
      ),
    })),
  };
}
