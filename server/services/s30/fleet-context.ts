/**
 * S30 Phase C — calendar and pace context for S29's Fleet copilot (server/services/s29/fleet.ts).
 *
 * S29's copilot answers from the attention store. Two owner questions need data the attention store does not hold:
 *   "Who is approaching an important academic deadline?"   -> the S30 academic calendar (agreement deadlines,
 *                                                             checkpoints, plan and roadmap milestones, scheduled events)
 *   "Who may be falling behind their planned pace?"        -> the Control Center pace estimate vs the plan's target date,
 *                                                             plus overdue planned course milestones
 * buildFleetCalendarContext() is pure; loadFleetCalendarContext() reads the same bounded sources the calendar and
 * Control Center already read. Nothing here calls a model; values stay on the server.
 */
import type { CalendarItem } from "@shared/s30-contract";
import type { ControlStudentRow } from "@shared/s27-contract";
import { computeControlCenter } from "../program-journey/control-center";
import { buildCalendarItems, loadCalendarFacts } from "./calendar";
import type { SqlExecutor } from "./db-util";

export const FLEET_DEADLINE_WINDOW_DAYS = 14;
const DAY = 86_400_000;

export interface FleetDeadline {
  readonly key: string;
  readonly studentId: string;
  readonly studentName: string | null;
  readonly isDemo: boolean;
  readonly itemKind: CalendarItem["kind"];
  readonly date: string;
  /** Negative = overdue. */
  readonly daysLeft: number;
  /** Translation key when the title is a product label (else null and `title` is record data). */
  readonly titleKey: string | null;
  readonly title: string;
  readonly href: string;
  readonly source: CalendarItem["source"];
}
export interface FleetPace {
  readonly key: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly isDemo: boolean;
  readonly estimatedOn: string | null;
  readonly targetOn: string | null;
  readonly missedMilestones: number;
  readonly reason: "finish_after_target" | "no_pace_with_target" | "missed_milestones";
  readonly href: string;
}
export interface FleetCalendarContext {
  readonly deadlines: readonly FleetDeadline[];
  readonly pace: readonly FleetPace[];
}

const DEADLINE_KINDS = new Set<CalendarItem["kind"]>(["academic_deadline", "document_deadline", "course_milestone", "program_checkpoint"]);
const daysUntil = (today: string, date: string) => Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
const fileHref = (id: string, tab: string) => `/admin/students/${encodeURIComponent(id)}?tab=${tab}`;

export function buildFleetCalendarContext(input: { now: Date; calendar: readonly CalendarItem[]; students: readonly ControlStudentRow[]; targets: ReadonlyMap<string, string> }): FleetCalendarContext {
  const today = input.now.toISOString().slice(0, 10);
  const deadlines: FleetDeadline[] = [];
  for (const c of input.calendar) {
    if (!DEADLINE_KINDS.has(c.kind) || c.status === "done" || c.status === "cancelled") continue;
    const d = daysUntil(today, c.start);
    if (d > FLEET_DEADLINE_WINDOW_DAYS || d < -FLEET_DEADLINE_WINDOW_DAYS) continue;
    deadlines.push({ key: `calendar:${c.id}`, studentId: c.studentId, studentName: c.studentName, isDemo: c.isDemo, itemKind: c.kind, date: c.start.slice(0, 10), daysLeft: d,
      titleKey: c.titleKey, title: c.title, href: c.href, source: c.source });
  }
  deadlines.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));

  const missed = new Map<string, number>();
  for (const c of input.calendar) if (c.kind === "course_milestone" && c.status === "overdue") missed.set(c.studentId, (missed.get(c.studentId) ?? 0) + 1);
  const pace: FleetPace[] = [];
  for (const s of input.students) {
    if (s.program === "none") continue;
    const target = input.targets.get(s.studentId) ?? null;
    const m = missed.get(s.studentId) ?? 0;
    const late = !!(target && s.estimatedFinishOn && s.estimatedFinishOn > target);
    const stalled = !!(target && !s.estimatedFinishOn && s.paceLabel !== null);
    if (!late && !stalled && m < 2) continue;
    pace.push({ key: `pace:${s.studentId}`, studentId: s.studentId, studentName: s.name, isDemo: s.isDemo, estimatedOn: s.estimatedFinishOn, targetOn: target, missedMilestones: m,
      reason: late ? "finish_after_target" : stalled ? "no_pace_with_target" : "missed_milestones", href: fileHref(s.studentId, "roadmap") });
  }
  const rank = { finish_after_target: 0, no_pace_with_target: 1, missed_milestones: 2 } as const;
  pace.sort((a, b) => rank[a.reason] - rank[b.reason] || b.missedMilestones - a.missedMilestones || a.studentName.localeCompare(b.studentName));
  return { deadlines, pace };
}

export async function loadFleetCalendarContext(db: SqlExecutor, now: Date): Promise<FleetCalendarContext> {
  const day = (offset: number) => new Date(now.getTime() + offset * DAY).toISOString().slice(0, 10);
  const [cc, facts] = await Promise.all([computeControlCenter(db, now), loadCalendarFacts(db, { studentIds: null })]);
  const calendar = buildCalendarItems(facts, { role: "admin" }, { from: day(-60), to: day(FLEET_DEADLINE_WINDOW_DAYS) }, now, { includeDemo: true });
  const targets = new Map<string, string>();
  for (const p of facts.plans) { const t = p.content?.pacing?.targetCompletionDate; if (t) targets.set(p.studentId, t); }
  return buildFleetCalendarContext({ now, calendar, students: cc.students, targets });
}
