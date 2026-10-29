/**
 * S27 Flight Deck cockpit view-model (pure; no React, no I/O).
 *
 * Every number comes from the student's real record: credits from StudentHighSchoolView (official only),
 * deadlines / checkpoints / pace from StudentJourneyView (shared/s27-contract.ts). Nothing is a hard-coded total.
 * Dates are targets, never guarantees; only the awarding school confirms credits.
 */
import type { StudentHighSchoolView } from "@shared/high-school-contract";
import type { AgreementDeadlineKey, AgreementDeadlineView, CheckpointView, ProgramAgreementView, StudentJourneyView } from "@shared/s27-contract";
import { addDaysIso, daysBetween } from "./dates";

// ── credits ─────────────────────────────────────────────────────────────────

/** Half-units (integers) to display credits (numbers, .5 steps). */
export const toCredits = (half: number): number => half / 2;

export interface CreditFigures {
  readonly required: number;
  readonly confirmed: number;
  readonly waiting: number;
  readonly remaining: number;
  readonly fraction: number;
}

export function creditFigures(view: Pick<StudentHighSchoolView, "credits">): CreditFigures {
  const c = view.credits;
  const required = toCredits(c.requiredHalfUnits);
  const confirmed = toCredits(c.earnedHalfUnits);
  return {
    required,
    confirmed,
    waiting: toCredits(c.awaitingConfirmationHalfUnits),
    remaining: Math.max(0, required - confirmed),
    fraction: required > 0 ? Math.max(0, Math.min(1, confirmed / required)) : 0,
  };
}

// ── countdown alert cards ───────────────────────────────────────────────────

export type Severity = "crit" | "warn" | "info" | "ok";

export interface AlertCard {
  readonly key: string;
  readonly kind: "task" | "deadline" | "support";
  readonly deadlineKey: AgreementDeadlineKey | null;
  /** A finished deadline renders as a check card. */
  readonly done: boolean;
  readonly severity: Severity;
  /** Number inside the ring (days, months, or days overdue). null when there is no date. */
  readonly big: number | null;
  readonly unit: "days" | "months" | "overdue" | "none";
  /** 0..1, share of the window still ahead (ring fill). */
  readonly fraction: number;
  readonly dueOn: string | null;
  readonly daysLeft: number | null;
  readonly title: string | null;
  readonly subtitle: string | null;
  readonly detail: string | null;
  readonly courseKey: string | null;
}

/** 3 days or fewer (or overdue) is always critical, whatever the card's usual tone. */
export function severityFor(daysLeft: number | null, base: Severity): Severity {
  if (daysLeft !== null && daysLeft <= 3) return "crit";
  return base;
}

/** Ring fill: remaining share of the window, never fully empty so the ring stays visible. */
export function ringFraction(daysLeft: number | null, windowDays: number): number {
  if (daysLeft === null || windowDays <= 0) return 0;
  return Math.max(0.02, Math.min(1, daysLeft / windowDays));
}

const DEFAULT_WINDOW: Record<AgreementDeadlineKey, number> = { language_test: 30, prior_schooling_proof: 90 };

function deadlineWindow(d: AgreementDeadlineView, agreement: ProgramAgreementView): number {
  const anchor = d.key === "language_test" ? agreement.signedOn : agreement.activatedOn;
  const w = anchor && d.dueOn ? daysBetween(anchor, d.dueOn) : null;
  return w !== null && w > 0 ? w : DEFAULT_WINDOW[d.key];
}

export interface NextTaskInput {
  readonly title: string;
  readonly courseKey: string;
  readonly courseTitle: string;
  readonly dueDate: string | null;
}

export function buildAlertCards(input: { nextTask: NextTaskInput | null; agreement: ProgramAgreementView | null; today: string; max?: number }): AlertCard[] {
  const { nextTask, agreement, today } = input;
  const cards: AlertCard[] = [];

  if (nextTask) {
    const left = nextTask.dueDate ? daysBetween(today, nextTask.dueDate) : null;
    cards.push({
      key: `task:${nextTask.courseKey}`, kind: "task", deadlineKey: null, done: false,
      severity: severityFor(left, "info"),
      big: left === null ? null : Math.abs(left), unit: left === null ? "none" : left < 0 ? "overdue" : "days",
      fraction: ringFraction(left, 7), dueOn: nextTask.dueDate, daysLeft: left,
      title: nextTask.title, subtitle: nextTask.courseTitle, detail: null, courseKey: nextTask.courseKey,
    });
  }

  const open: AlertCard[] = [];
  const done: AlertCard[] = [];
  for (const d of agreement?.deadlines ?? []) {
    if (!agreement || d.status === "waived") continue;
    if (d.status === "done") {
      done.push({
        key: `deadline:${d.key}`, kind: "deadline", deadlineKey: d.key, done: true, severity: "ok",
        big: null, unit: "none", fraction: 1, dueOn: d.dueOn, daysLeft: null,
        title: d.label, subtitle: d.rule, detail: d.detail, courseKey: null,
      });
      continue;
    }
    if (!d.dueOn) continue;
    const left = d.daysLeft ?? daysBetween(today, d.dueOn);
    open.push({
      key: `deadline:${d.key}`, kind: "deadline", deadlineKey: d.key, done: false,
      severity: severityFor(left, "warn"),
      big: left === null ? null : Math.abs(left), unit: left === null ? "none" : left < 0 ? "overdue" : "days",
      fraction: ringFraction(left, deadlineWindow(d, agreement)), dueOn: d.dueOn, daysLeft: left,
      title: d.label, subtitle: d.rule, detail: d.detail, courseKey: null,
    });
  }
  open.sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));

  const support: AlertCard[] = [];
  if (agreement && agreement.supportMonthsLeft !== null && agreement.supportEndsOn) {
    const left = daysBetween(today, agreement.supportEndsOn);
    const window = agreement.activatedOn ? daysBetween(agreement.activatedOn, agreement.supportEndsOn) : null;
    const months = Math.max(0, agreement.supportMonthsLeft);
    support.push({
      key: "support", kind: "support", deadlineKey: null, done: false,
      severity: months <= 1 ? "warn" : "ok",
      big: months, unit: "months",
      fraction: ringFraction(left, window && window > 0 ? window : agreement.supportMonths * 30.4),
      dueOn: agreement.supportEndsOn, daysLeft: left,
      title: null, subtitle: null, detail: null, courseKey: null,
    });
  }

  const all = [...cards, ...open, ...support, ...done];
  return all.slice(0, input.max ?? 4);
}

// ── status pills ────────────────────────────────────────────────────────────

/** Open agreement deadlines due within 30 days (overdue included). */
export function deadlinesToWatch(agreement: ProgramAgreementView | null): number {
  return (agreement?.deadlines ?? []).filter((d) => d.status === "open" && d.dueOn && d.daysLeft !== null && d.daysLeft <= 30).length;
}

/** "Week 8 of 16" from the enrollment window; null unless both dates exist. */
export function weekOfProgram(startedOn: string | null, targetEnd: string | null, today: string): { week: number; total: number } | null {
  if (!startedOn || !targetEnd) return null;
  const done = daysBetween(startedOn, today);
  const span = daysBetween(startedOn, targetEnd);
  if (done === null || span === null || span <= 0 || done < 0) return null;
  const total = Math.max(1, Math.ceil(span / 7));
  return { week: Math.min(total, Math.floor(done / 7) + 1), total };
}

// ── "also on your radar" chips ──────────────────────────────────────────────

export type RadarTone = "warn" | "info" | "ok";
export interface RadarChip {
  readonly key: "electives" | "checkpoint" | "waiting" | "support" | "logged";
  readonly tone: RadarTone;
  readonly n: number;
  readonly on: string | null;
  readonly href: string;
}

export interface TicketLike { readonly status?: string | null; readonly last_public_reply_by?: string | null }

export function buildRadarChips(input: {
  electivesAwaiting: number;
  coursesAwaitingSchool: number;
  journey: StudentJourneyView | null;
  tickets: readonly TicketLike[] | null;
  today: string;
}): RadarChip[] {
  const chips: RadarChip[] = [];
  if (input.electivesAwaiting > 0) chips.push({ key: "electives", tone: "warn", n: input.electivesAwaiting, on: null, href: "/high-school" });
  const next = input.journey?.checkpoints.find((c) => c.status === "next");
  if (next) chips.push({ key: "checkpoint", tone: "info", n: 0, on: next.plannedOn, href: "/flight-deck" });
  if (input.coursesAwaitingSchool > 0) chips.push({ key: "waiting", tone: "info", n: input.coursesAwaitingSchool, on: null, href: "/high-school" });
  const replies = (input.tickets ?? []).filter((t) => t.status !== "resolved" && t.status !== "closed" && t.last_public_reply_by === "staff").length;
  if (replies > 0) chips.push({ key: "support", tone: "info", n: replies, on: null, href: "/support" });
  const pace = input.journey?.pace;
  if (pace) {
    const ago = pace.lastLoggedOn ? daysBetween(pace.lastLoggedOn, input.today) : null;
    chips.push({ key: "logged", tone: ago !== null && ago <= 7 ? "ok" : "warn", n: ago ?? -1, on: pace.lastLoggedOn, href: "/high-school" });
  }
  return chips;
}

// ── checkpoints ─────────────────────────────────────────────────────────────

export function checkpointProgress(checkpoints: readonly CheckpointView[]): { done: number; total: number } {
  return { done: checkpoints.filter((c) => c.status === "done").length, total: checkpoints.length };
}

// ── pace + planner math ─────────────────────────────────────────────────────

export const PACE_MIN = 1;
export const PACE_MAX = 3;
export const PACE_STEP = 0.1;

export const roundPace = (v: number): number => Math.round(v * 10) / 10;
export const clampPace = (v: number): number => Math.max(PACE_MIN, Math.min(PACE_MAX, roundPace(v)));

export type PresetId = "actual" | "steady" | "accelerated" | "sprint";
export const PACE_PRESETS: readonly { readonly id: PresetId; readonly pace: number | null }[] = [
  { id: "actual", pace: null },
  { id: "steady", pace: 1.2 },
  { id: "accelerated", pace: 2.0 },
  { id: "sprint", pace: 2.6 },
];

/** The student's logged pace as a planner value, or null when nothing has been logged. */
export function actualPace(journey: StudentJourneyView | null): number | null {
  const v = journey?.pace?.creditsPerWeek ?? null;
  return v !== null && Number.isFinite(v) && v > 0 ? roundPace(v) : null;
}

/** Value a preset stands for ("actual" follows the logged pace; null when there is none). */
export function presetValue(id: PresetId, actual: number | null): number | null {
  const p = PACE_PRESETS.find((x) => x.id === id);
  if (!p) return null;
  return p.pace ?? actual;
}

/** Whole days to cover `remaining` credits at `pace` credits a week. */
export function daysToFinish(remaining: number, pace: number): number | null {
  if (!(pace > 0) || !Number.isFinite(remaining)) return null;
  if (remaining <= 0) return 0;
  return Math.round((remaining / pace) * 7);
}

export function arrivalIso(today: string, remaining: number, pace: number): string | null {
  const d = daysToFinish(remaining, pace);
  return d === null ? null : addDaysIso(today, d);
}

/** Weeks the scenario lands before (+) or after (-) the plan's target date. */
export function weeksVersusTarget(arrival: string | null, target: string | null): number | null {
  if (!arrival || !target) return null;
  const d = daysBetween(arrival, target);
  return d === null ? null : Math.round(d / 7);
}

/** "3 mo 2 wk" parts for a span in days (4.345 weeks per month; a 4-week remainder rolls into the month). */
export function spanParts(days: number): { months: number; weeks: number } {
  const w = Math.max(0, Math.round(days / 7));
  let months = Math.floor(w / 4.345);
  let weeks = Math.round(w - months * 4.345);
  if (weeks >= 4) { months += 1; weeks = 0; }
  return { months, weeks };
}

export interface PlannerOutputs {
  readonly arrival: string | null;
  readonly weeksVsTarget: number | null;
  readonly wholeProgram: { months: number; weeks: number } | null;
  readonly creditsLeft: number;
  readonly weeksToGo: number | null;
}

export function plannerOutputs(input: { today: string; startedOn: string | null; targetOn: string | null; remaining: number; pace: number | null }): PlannerOutputs {
  const arrival = input.pace ? arrivalIso(input.today, input.remaining, input.pace) : null;
  const total = arrival && input.startedOn ? daysBetween(input.startedOn, arrival) : null;
  const days = input.pace ? daysToFinish(input.remaining, input.pace) : null;
  return {
    arrival,
    weeksVsTarget: weeksVersusTarget(arrival, input.targetOn),
    wholeProgram: total !== null && total >= 0 ? spanParts(total) : null,
    creditsLeft: input.remaining,
    weeksToGo: days === null ? null : Math.round(days / 7),
  };
}

/** Schedule tile: credits ahead (+) or behind (-) the plan's expected position today; null when no plan position. */
export function scheduleDelta(view: Pick<StudentHighSchoolView, "credits" | "pace">): number | null {
  const expected = view.pace.expectedByNowHalfUnits;
  if (expected === null || expected === undefined) return null;
  return toCredits(view.credits.earnedHalfUnits - expected);
}

/** Estimated arrival: the logged-pace estimate, else the plan's own target date. */
export function estimatedArrival(journey: StudentJourneyView | null, view: Pick<StudentHighSchoolView, "enrollment">): { on: string | null; basis: "pace" | "plan" | "none" } {
  const fromPace = journey?.pace?.estimatedFinishOn ?? null;
  if (fromPace) return { on: fromPace, basis: "pace" };
  const target = view.enrollment.targetCompletionDate;
  return target ? { on: target, basis: "plan" } : { on: null, basis: "none" };
}

// ── flight path geometry ────────────────────────────────────────────────────

export interface Pt { readonly x: number; readonly y: number }
export interface ArcGeometry { readonly A: Pt; readonly B: Pt; readonly C: Pt; readonly base: number; readonly narrow: boolean }

/** Quadratic arc from "Enrolled" (left, on the baseline) to the diploma seal (right, on the baseline). */
export function arcGeometry(width: number, height: number): ArcGeometry {
  const narrow = width < 620;
  const pad = narrow ? 30 : 60;
  const padR = narrow ? 52 : 140;
  const base = height - (narrow ? 92 : 100);
  const top = narrow ? 84 : 52;
  const A = { x: pad, y: base };
  const B = { x: width - padR, y: base };
  const C = { x: (A.x + B.x) / 2, y: 2 * top - base + (narrow ? 60 : 30) };
  return { A, B, C, base, narrow };
}

export function pointOnArc(g: ArcGeometry, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * g.A.x + 2 * u * t * g.C.x + t * t * g.B.x, y: u * u * g.A.y + 2 * u * t * g.C.y + t * t * g.B.y };
}

/** Heading in degrees at t (0 = pointing right). */
export function angleOnArc(g: ArcGeometry, t: number): number {
  const u = 1 - t;
  const dx = 2 * u * (g.C.x - g.A.x) + 2 * t * (g.B.x - g.C.x);
  const dy = 2 * u * (g.C.y - g.A.y) + 2 * t * (g.B.y - g.C.y);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function arcPath(g: ArcGeometry, t0: number, t1: number, steps = 60): string {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const p = pointOnArc(g, t0 + ((t1 - t0) * i) / steps);
    d += `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }
  return d;
}

/** One bead per projected week from today's position to the end (t in 0..1). */
export function beadFractions(confirmed: number, required: number, pace: number | null): number[] {
  if (!pace || pace <= 0 || required <= 0) return [];
  const out: number[] = [];
  for (let k = 1; confirmed + pace * k < required - 0.05 && k < 200; k++) out.push((confirmed + pace * k) / required);
  return out;
}

// ── flight stops (phase credit milestones) ──────────────────────────────────

export type StopId = "foundations" | "momentum" | "summit";
export interface FlightStop {
  readonly id: StopId;
  /** Cumulative credits planned by the end of this phase. */
  readonly credits: number;
  readonly reached: boolean;
  /** Plan label: "weeks 1–4" for an accelerated plan, or the milestone month (yyyy-mm). */
  readonly weeks: { readonly from: number; readonly to: number } | null;
  readonly month: string | null;
}

const STOP_IDS: readonly StopId[] = ["foundations", "momentum", "summit"];

/**
 * Up to three stops on the arc, from the plan itself: cumulative planned credit at the end of the first three
 * accelerated phases ("weeks X–Y"), else spread over the plan's monthly milestones. No plan data, no stops.
 */
export function buildFlightStops(input: {
  required: number;
  confirmed: number;
  bands: readonly { from: number; to: number; cumulativeHalfUnits: number }[] | null;
  milestones: readonly { month: string; cumulativeHalfUnits: number }[] | null;
}): FlightStop[] {
  const { required, confirmed } = input;
  const raw: { credits: number; weeks: FlightStop["weeks"]; month: string | null }[] = [];
  if (input.bands && input.bands.some((b) => b.cumulativeHalfUnits > 0)) {
    for (const b of input.bands.slice(0, 3)) raw.push({ credits: toCredits(b.cumulativeHalfUnits), weeks: { from: b.from, to: b.to }, month: null });
  } else if (input.milestones && input.milestones.length >= 3) {
    const sorted = [...input.milestones].sort((a, b) => a.month.localeCompare(b.month));
    const n = sorted.length;
    for (const idx of [Math.ceil(n / 4), Math.ceil(n / 2), Math.ceil((3 * n) / 4)]) {
      const m = sorted[Math.min(n - 1, Math.max(0, idx - 1))]!;
      raw.push({ credits: toCredits(m.cumulativeHalfUnits), weeks: null, month: m.month });
    }
  }
  const stops: FlightStop[] = [];
  raw.forEach((r, i) => {
    const prev = stops[stops.length - 1];
    if (r.credits <= 0 || r.credits >= required || (prev && r.credits <= prev.credits)) return;
    stops.push({ id: STOP_IDS[i]!, credits: r.credits, reached: confirmed >= r.credits, weeks: r.weeks, month: r.month });
  });
  return stops;
}

/** Estimated date a stop is reached at `pace`; null when already reached or no pace. */
export function stopEstimate(today: string, confirmed: number, stopCredits: number, pace: number | null): string | null {
  if (!pace || confirmed >= stopCredits) return null;
  return arrivalIso(today, stopCredits - confirmed, pace);
}

// ── agenda ──────────────────────────────────────────────────────────────────

export interface AgendaTask {
  readonly courseKey: string;
  readonly courseTitle: string;
  readonly key: string;
  readonly title: string;
  readonly dueDate: string | null;
  readonly overdue: boolean;
}

/** Open work due from today through the next 7 days (overdue work leads), soonest first. */
export function weekAgenda(tasks: readonly AgendaTask[], today: string): AgendaTask[] {
  return tasks
    .filter((t) => {
      if (t.overdue) return true;
      const d = t.dueDate ? daysBetween(today, t.dueDate) : null;
      return d !== null && d >= 0 && d <= 7;
    })
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
}
