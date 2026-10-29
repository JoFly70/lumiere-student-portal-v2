/** Pure helpers for the journey tab extras: planned credits, upcoming tasks, monthly milestones. */
import type { HalfUnits, HsCourseView, HsTaskView, StudentHighSchoolView } from "@shared/high-school-contract";

const DAY = 86_400_000;
const day = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
};

const COUNTED_IN_PLAN = (c: HsCourseView) => c.status !== "replaced";

/** Half-units planned across all courses of the roadmap (not earned credit). */
export function plannedHalfUnits(view: StudentHighSchoolView): HalfUnits {
  return view.subjects.reduce((n, s) => n + s.courses.filter(COUNTED_IN_PLAN).reduce((m, c) => m + c.halfUnits, 0), 0);
}

export type UpcomingGroup = "overdue" | "thisWeek" | "nextWeek" | "later";
export interface UpcomingTask {
  readonly group: UpcomingGroup;
  readonly task: HsTaskView;
  readonly courseKey: string;
  readonly courseTitle: string;
}

const OPEN_STATUSES = new Set(["not_started", "in_progress"]);

/** Student-actionable tasks with a target date, bucketed by the week of `today`. */
export function upcomingTasks(view: StudentHighSchoolView, today: string): UpcomingTask[] {
  const t0 = day(today);
  if (t0 === null) return [];
  const out: UpcomingTask[] = [];
  for (const s of view.subjects) {
    for (const c of s.courses) {
      if (c.status === "replaced" || c.status === "transfer_credit" || c.status === "official_complete") continue;
      for (const task of c.tasks) {
        if (!OPEN_STATUSES.has(task.status)) continue;
        const d = day(task.dueDate);
        if (d === null) continue;
        const diff = Math.round((d - t0) / DAY);
        const group: UpcomingGroup = diff < 0 ? "overdue" : diff <= 7 ? "thisWeek" : diff <= 14 ? "nextWeek" : "later";
        out.push({ group, task, courseKey: c.key, courseTitle: c.title });
      }
    }
  }
  return out.sort((a, b) => (day(a.task.dueDate) ?? 0) - (day(b.task.dueDate) ?? 0));
}

export interface MilestoneRow {
  readonly month: string;
  readonly cumulativeHalfUnits: HalfUnits;
  readonly current: boolean;
  readonly past: boolean;
}

export function milestoneRows(view: StudentHighSchoolView, today: string): MilestoneRow[] {
  const ym = today.slice(0, 7);
  return (view.milestones ?? []).map((m) => ({ ...m, current: m.month === ym, past: m.month < ym }));
}
