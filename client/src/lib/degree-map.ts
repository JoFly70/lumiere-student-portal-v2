/**
 * Degree-map model (pure) for the high-school roadmap: 21 credits = 16 core + 5 electives, never university semantics.
 * Three honest credit states per course:
 *   verified = the awarding school confirmed it (official_complete, transfer_credit)
 *   reported = the student marked every task submitted; the school has not confirmed (awaiting_school)
 *   planned  = everything else that is still in the plan (not started / in progress / not passed)
 * Only the server's `credits` numbers are used for verified/reported totals; this module only groups and counts.
 */
import type { HalfUnits, HsCourseView, HsSubjectView, HsTaskView, StudentHighSchoolView } from "@shared/high-school-contract";
import { courseTitleView, orderedSubjects } from "@/pages/high-school-presentation";
import { electiveShortTitle } from "@/lib/elective-change";

/** Course title for display: placeholder suffixes and TEST ONLY / approval markers removed (the approval pill says it). */
export const displayTitle = (title: string): string => electiveShortTitle(courseTitleView(title).title);

export type CreditBasis = "verified" | "reported" | "planned";

export function courseBasis(c: Pick<HsCourseView, "status">): CreditBasis | null {
  if (c.status === "replaced") return null;
  if (c.status === "official_complete" || c.status === "transfer_credit") return "verified";
  if (c.status === "awaiting_school") return "reported";
  return "planned";
}

export interface MapGroup {
  readonly subject: HsSubjectView["subject"];
  readonly kind: "core" | "elective";
  readonly requiredHalfUnits: HalfUnits;
  readonly verified: HalfUnits;
  readonly reported: HalfUnits;
  readonly planned: HalfUnits;
  readonly courses: readonly HsCourseView[];
  readonly tasksDone: number;
  readonly tasksTotal: number;
}

export interface MapTotals {
  readonly required: HalfUnits;
  readonly verified: HalfUnits;
  readonly reported: HalfUnits;
  /** Still-planned credit, capped so verified + reported + planned never exceeds the requirement. */
  readonly planned: HalfUnits;
  readonly remaining: HalfUnits;
  readonly coreRequired: HalfUnits;
  readonly electiveRequired: HalfUnits;
  readonly courseCount: number;
}

export function buildDegreeMap(view: StudentHighSchoolView): { totals: MapTotals; groups: MapGroup[] } {
  const groups: MapGroup[] = orderedSubjects(view.subjects).map((s) => {
    const courses = s.courses.filter((c) => c.status !== "replaced");
    const sum = (basis: CreditBasis) => courses.filter((c) => courseBasis(c) === basis).reduce((n, c) => n + c.halfUnits, 0);
    const isElective = s.subject === "electives" || (courses.length > 0 && courses.every((c) => c.kind === "elective"));
    return {
      subject: s.subject,
      kind: isElective ? "elective" : "core",
      requiredHalfUnits: s.requiredHalfUnits,
      verified: s.earnedHalfUnits,
      reported: sum("reported"),
      planned: sum("planned"),
      courses,
      tasksDone: courses.reduce((n, c) => n + c.tasksDone, 0),
      tasksTotal: courses.reduce((n, c) => n + c.tasksTotal, 0),
    };
  });
  const c = view.credits;
  const verified = c.earnedHalfUnits;
  const reported = c.awaitingConfirmationHalfUnits;
  const plannedRaw = groups.reduce((n, g) => n + g.planned, 0);
  const planned = Math.max(0, Math.min(plannedRaw, c.requiredHalfUnits - verified - reported));
  return {
    groups,
    totals: {
      required: c.requiredHalfUnits,
      verified,
      reported,
      planned,
      remaining: c.remainingHalfUnits,
      coreRequired: c.core.requiredHalfUnits,
      electiveRequired: c.elective.requiredHalfUnits,
      courseCount: groups.reduce((n, g) => n + g.courses.length, 0),
    },
  };
}

// ---------------------------------------------------------------------------------------------- timeline

/** "Planning target: accelerated weeks 1–4 after activation": weeks relative to activation, never a calendar date. */
export function coursePhaseWeeks(c: Pick<HsCourseView, "tasks">): { from: number; to: number } | null {
  for (const t of c.tasks) {
    const m = /weeks?\s*(\d+)\s*(?:[–-]|to)\s*(\d+)/i.exec(t.title);
    if (m && /planning target|after activation/i.test(t.title)) return { from: Number(m[1]), to: Number(m[2]) };
  }
  return null;
}

export const ACCELERATED_BANDS = [
  { id: "w1_4", from: 1, to: 4 },
  { id: "w5_8", from: 5, to: 8 },
  { id: "w9_13", from: 9, to: 13 },
  { id: "w14_16", from: 14, to: 16 },
] as const;

export interface PhaseBand {
  readonly id: (typeof ACCELERATED_BANDS)[number]["id"];
  readonly from: number;
  readonly to: number;
  readonly courses: readonly HsCourseView[];
  /** Credit planned inside this band (half-units). */
  readonly halfUnits: HalfUnits;
  /** Cumulative planned credit by the end of this band (half-units). */
  readonly cumulative: HalfUnits;
}

/** An accelerated plan: at least one (non-replaced) course carries a relative "weeks X–Y" planning target. */
export function isAcceleratedPlan(groups: readonly MapGroup[]): boolean {
  return groups.some((g) => g.courses.some((c) => coursePhaseWeeks(c) !== null));
}

export function buildPhaseBands(groups: readonly MapGroup[]): PhaseBand[] {
  const all = groups.flatMap((g) => g.courses);
  let cumulative = 0;
  return ACCELERATED_BANDS.map((b) => {
    const inBand = all.filter((c) => {
      const w = coursePhaseWeeks(c);
      return w !== null && w.from >= b.from && w.from <= b.to;
    });
    const halfUnits = inBand.reduce((n, c) => n + c.halfUnits, 0);
    cumulative += halfUnits;
    return { ...b, courses: inBand, halfUnits, cumulative };
  });
}

export interface MonthCell {
  readonly month: string;
  readonly cumulativeHalfUnits: HalfUnits;
  readonly state: "reached" | "current" | "upcoming" | "missed";
}

/** Monthly milestones of a dated plan. "reached" compares VERIFIED credit with the month's target. */
export function buildMonthBand(view: Pick<StudentHighSchoolView, "milestones" | "credits">, today: string): MonthCell[] {
  const ym = today.slice(0, 7);
  const verified = view.credits.earnedHalfUnits;
  return [...(view.milestones ?? [])]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({
      month: m.month,
      cumulativeHalfUnits: m.cumulativeHalfUnits,
      state: verified >= m.cumulativeHalfUnits ? "reached" : m.month === ym ? "current" : m.month < ym ? "missed" : "upcoming",
    }));
}

// ---------------------------------------------------------------------------------------------- tasks

export type OpenTask = HsTaskView & { readonly courseKey: string; readonly courseTitle: string };
const OPEN = new Set(["not_started", "in_progress", "retake_required"]);
/** The "Planning target: accelerated weeks X–Y" row is a plan note, not work the student does. */
export const isPlanningTarget = (t: Pick<HsTaskView, "title">): boolean => /^Planning target/i.test(t.title);

/** Student-actionable tasks in plan order, active courses first (in progress, then not started). */
export function openTasks(view: Pick<StudentHighSchoolView, "subjects">): OpenTask[] {
  const rank = (c: HsCourseView) => (c.status === "in_progress" ? 0 : c.status === "not_started" ? 1 : 2);
  const courses = view.subjects
    .flatMap((s) => s.courses)
    .filter((c) => c.status === "in_progress" || c.status === "not_started" || c.status === "not_passed")
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map((x) => x.c);
  return courses.flatMap((c) => c.tasks.filter((t) => OPEN.has(t.status) && !isPlanningTarget(t)).map((t) => ({ ...t, courseKey: c.key, courseTitle: c.title })));
}

/** The one "Continue studying" task: the server's next task, else the first open task. Overdue work wins. */
export function nextOpenTask(view: StudentHighSchoolView): OpenTask | null {
  const open = openTasks(view);
  const overdue = open.find((t) => t.overdue);
  return overdue ?? view.current.nextTask ?? open[0] ?? null;
}

/** 2 to 4 immediate tasks (the next one first), distinct, overdue and dated ones leading. */
export function immediateTasks(view: StudentHighSchoolView, limit = 3): OpenTask[] {
  const head = nextOpenTask(view);
  const rest = openTasks(view).filter((t) => !(head && t.courseKey === head.courseKey && t.key === head.key));
  const ranked = rest
    .map((t, i) => ({ t, i }))
    .sort((a, b) => Number(b.t.overdue) - Number(a.t.overdue) || (a.t.dueDate ?? "9999").localeCompare(b.t.dueDate ?? "9999") || a.i - b.i)
    .map((x) => x.t);
  return [...(head ? [head] : []), ...ranked].slice(0, Math.max(2, Math.min(4, limit)));
}

export function findCourse(view: Pick<StudentHighSchoolView, "subjects">, key: string | null): HsCourseView | null {
  if (!key) return null;
  for (const s of view.subjects) for (const c of s.courses) if (c.key === key) return c;
  return null;
}
