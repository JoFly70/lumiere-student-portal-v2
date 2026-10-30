/**
 * Degree (bachelor's) Flight Deck cockpit view-model (pure; no React, no I/O).
 *
 * The degree student gets the same cockpit as the high-school student; this file maps what the degree APIs return
 * onto the cockpit's cards:
 *   GET /api/student/roadmap         -> next course task, Next 7 days, flight-path stops, graduation target
 *   GET /api/student/degree-progress -> applied / required credits, requirement groups, warnings
 * Authority is unchanged: applied (earned) credit comes only from the canonical degree progress view; planned credit
 * comes from the published roadmap and is never counted as earned. Nothing here is invented: no data, no card content.
 */
import type { StudentRoadmapItemView, StudentRoadmapView } from "@shared/student-roadmap-contract";
import type { StudentDegreeProgressView } from "@shared/student-degree-progress-view";
import {
  buildCreditsBySource, buildWarnings, isActivePlanItem, isCourseDone, orderedItems, splitCourses, toCents,
  type CreditsBySource, type DegreeWarning,
} from "@/components/degree-journey/model";
import type { AgendaTask } from "./cockpit-model";
import { daysBetween } from "./dates";

const credits = (cents: number | null): number => (cents === null ? 0 : cents / 100);

// ── credits ─────────────────────────────────────────────────────────────────

export interface DegreeFigures {
  /** False when the degree has no credit total to chart (no program, or zero required credits). */
  readonly known: boolean;
  readonly required: number;
  /** Applied by the university (canonical). 0 when the record is not composed. */
  readonly confirmed: number;
  readonly earnedKnown: boolean;
  /** Credits on active roadmap courses not yet officially accepted (a plan, never earned). */
  readonly planned: number;
  /** Required minus applied. */
  readonly remaining: number;
  readonly fraction: number;
  readonly source: CreditsBySource;
}

export function degreeFigures(roadmap: StudentRoadmapView, progress: StudentDegreeProgressView | null): DegreeFigures {
  const source = buildCreditsBySource(roadmap, progress);
  const required = credits(source.requiredCents);
  const confirmed = credits(source.earnedCents);
  return {
    known: source.state === "ready" && required > 0,
    required,
    confirmed,
    earnedKnown: source.earnedKnown,
    planned: credits(source.plannedCents),
    remaining: Math.max(0, required - confirmed),
    fraction: required > 0 ? Math.max(0, Math.min(1, confirmed / required)) : 0,
    source,
  };
}

// ── requirement groups (credits card) ───────────────────────────────────────

export interface DegreeRequirementRow {
  readonly id: string;
  readonly label: string;
  readonly status: StudentDegreeProgressView["requirements"][number]["status"];
  /** Credits; null when the engine produced no amount for this requirement. */
  readonly required: number | null;
  readonly applied: number | null;
  readonly remaining: number | null;
  readonly done: boolean;
  readonly review: boolean;
}

/** One row per requirement the canonical record composed; empty unless the record is composed. */
export function degreeRequirementRows(progress: StudentDegreeProgressView | null): DegreeRequirementRow[] {
  if (!progress || progress.state !== "COMPOSED") return [];
  return progress.requirements.filter((r) => r.title.trim() || r.code).map((r) => {
    const required = r.unit === "credit" ? toCents(r.requiredAmount) : null;
    const applied = r.unit === "credit" ? toCents(r.appliedAmount) : null;
    const remaining = r.unit === "credit" ? toCents(r.remainingAmount) : null;
    const known = required !== null && required > 0 && applied !== null;
    return {
      id: r.requirementId,
      label: r.title.trim() || (r.code ?? ""),
      status: r.status,
      required: known ? credits(required) : null,
      applied: known ? credits(applied) : null,
      remaining: remaining !== null ? credits(remaining) : null,
      done: r.status === "SATISFIED",
      review: r.status === "MANUAL_REVIEW" || r.status === "CONFLICT",
    };
  });
}

/** The plain-language checks worth showing on the deck: residency first, then holds / approvals / reviews (max 4). */
export function degreeNotes(roadmap: StudentRoadmapView, progress: StudentDegreeProgressView | null, max = 4): DegreeWarning[] {
  const all = buildWarnings(roadmap, progress);
  const residency = all.filter((w) => w.id.startsWith("res:"));
  const rest = all.filter((w) => !w.id.startsWith("res:"));
  return [...residency, ...rest].slice(0, max);
}

// ── tasks: Up next, Next 7 days, countdown ──────────────────────────────────

export interface DegreeOpenTask extends AgendaTask {
  /** Course credits (decimal), or null. */
  readonly credits: number | null;
  /** True for a course with no scheduled tasks: the course itself is the task (title = course title). */
  readonly courseLevel: boolean;
}

const OPEN_TASK = new Set(["not_started", "in_progress"]);

function isOverdue(due: string | null, today: string): boolean {
  const d = due ? daysBetween(today, due) : null;
  return d !== null && d < 0;
}

/**
 * Open work the student can act on, in plan order (courses already started first, then the rest). Courses on hold or
 * waiting for an advisor approval are not offered (they show as a note instead). A course with no scheduled tasks is
 * itself the task, dated by its planned end.
 */
export function degreeOpenTasks(roadmap: StudentRoadmapView, today: string): DegreeOpenTask[] {
  const { now, upNext } = splitCourses(roadmap);
  const out: DegreeOpenTask[] = [];
  for (const item of [...now, ...upNext]) {
    if (!item.canReport || isCourseDone(item)) continue;
    const cr = toCents(item.credits);
    const base = { courseKey: item.key, courseTitle: item.title, credits: cr === null ? null : cr / 100 };
    if (item.tasks.length === 0) {
      out.push({ ...base, key: "course", title: item.title, dueDate: item.plannedEnd, overdue: isOverdue(item.plannedEnd, today), courseLevel: true });
      continue;
    }
    for (const t of item.tasks.filter((x) => OPEN_TASK.has(x.status))) {
      out.push({ ...base, key: t.key, title: t.title, dueDate: t.dueDate, overdue: isOverdue(t.dueDate, today), courseLevel: false });
    }
  }
  return out;
}

/** The one "Up next" item: the most overdue work, else the first open task in plan order. */
export function degreeNextTask(open: readonly DegreeOpenTask[]): DegreeOpenTask | null {
  const overdue = open.filter((o) => o.overdue).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];
  return overdue ?? open[0] ?? null;
}

// ── plan dates and the flight path ──────────────────────────────────────────

export interface DegreePlanDates {
  /** Earliest phase start in the plan, or null. */
  readonly startsOn: string | null;
  /** The roadmap's graduation milestone target date, or null when it has none. */
  readonly graduationOn: string | null;
}

export function degreePlanDates(roadmap: StudentRoadmapView): DegreePlanDates {
  const starts = roadmap.phases.map((p) => p.startDate).filter((d): d is string => !!d).sort();
  const grad = roadmap.milestones.filter((m) => m.kind === "graduation" && m.targetDate).map((m) => m.targetDate as string).sort();
  return { startsOn: starts[0] ?? null, graduationOn: grad[grad.length - 1] ?? null };
}

export interface DegreeStop {
  readonly id: string;
  /** Cumulative credits at the end of this phase if every planned course up to it is accepted. */
  readonly credits: number;
  readonly name: string;
  readonly targetOn: string | null;
}

export const MAX_DEGREE_STOPS = 3;
/** A stop this close to the seal cannot be labelled without covering it, so it is left off the arc. */
export const MAX_STOP_FRACTION = 0.92;

function plannedCredit(item: StudentRoadmapItemView): number {
  return isActivePlanItem(item) && item.stage !== "officially_accepted" ? credits(toCents(item.credits)) : 0;
}

/** At most `max` entries spread across the list. */
function spread<T>(list: readonly T[], max: number): T[] {
  const n = list.length;
  if (n <= max) return [...list];
  return Array.from({ length: max }, (_, k) => list[Math.min(n - 1, Math.ceil(((k + 1) * n) / (max + 1)) - 1)]!);
}

/**
 * Stops on the arc, one per plan phase that still has planned courses: the credits applied now plus the planned credits
 * of every phase up to and including this one. (The student view of a milestone says how many courses remain, not which,
 * so milestones are not placed on the arc; the graduation milestone only dates the destination.) Stops at or beyond 92% of the
 * degree total are left out (they would sit under the seal). No plan data, no stops.
 */
export function buildDegreeStops(roadmap: StudentRoadmapView, figures: Pick<DegreeFigures, "required" | "confirmed">): DegreeStop[] {
  const { required, confirmed } = figures;
  if (required <= 0) return [];
  const stops: DegreeStop[] = [];
  let running = confirmed;
  for (const phase of [...roadmap.phases].sort((a, b) => a.sequence - b.sequence)) {
    const add = phase.items.reduce((n, i) => n + plannedCredit(i), 0);
    if (add <= 0) continue;
    running += add;
    if (running >= required * MAX_STOP_FRACTION) break;
    stops.push({ id: phase.key, credits: running, name: phase.title, targetOn: phase.endDate });
  }
  return spread(stops, MAX_DEGREE_STOPS);
}
