/**
 * Pure mapping from the server's AcademicProjection to the inputs of the Academic Flight Deck instruments (S18).
 * No React, no I/O, no computation of academic standing: every figure is copied or summed (integer half-units)
 * from the projection. Format with formatHalfUnits only at presentation time.
 *
 * Invariants (tested in tests/s18-flight-deck-ui.test.ts):
 *  - "official" is school-confirmed credit only. Awaiting-school, in-progress and planned credit are separate
 *    tallies and are never added into it, in either view mode.
 *  - "Verified only" shows official credit. "Including planned" shows official + awaiting + in progress + planned
 *    as a labelled projection next to (never instead of) the official figure.
 *  - A plan that is not configured is its own state: it is never shown as 0 or 0%.
 */
import { formatHalfUnits, type HalfUnits, type HsCourseDisplayStatus, type HsTaskDisplayStatus } from "@shared/high-school-contract";
import type {
  AcademicBasis,
  AcademicCourse,
  AcademicCreditBucket,
  AcademicMilestone,
  AcademicNextAction,
  AcademicProjection,
  AcademicSubject,
} from "@shared/academic-projection-contract";

export type ViewMode = "verified" | "projected";

export type CreditStatus = "official" | "awaiting_school" | "in_progress" | "planned" | "open";

/** Strongest evidence first. */
export const CREDIT_STATUSES: readonly CreditStatus[] = ["official", "awaiting_school", "in_progress", "planned", "open"];

export const STATUS_LABEL: Record<CreditStatus, string> = {
  official: "Official",
  awaiting_school: "Awaiting school",
  in_progress: "In progress",
  planned: "Planned",
  open: "Not yet planned",
};

export function statusHint(status: CreditStatus, schoolName: string): string {
  switch (status) {
    case "official":
      return `Confirmed by ${schoolName}`;
    case "awaiting_school":
      return "You reported it finished; the school has not confirmed it";
    case "in_progress":
      return "Started, not yet finished";
    case "planned":
      return "On your plan, not started";
    case "open":
      return "Required, with no course planned yet";
  }
}

export const MODE_OPTIONS: readonly { readonly id: ViewMode; readonly label: string }[] = [
  { id: "verified", label: "Verified only" },
  { id: "projected", label: "Including planned" },
];

export const BASIS_LABEL: Record<AcademicBasis, string> = {
  official: "Official",
  awaiting_school: "Awaiting school",
  in_progress: "In progress",
  planned: "Planned",
  not_counted: "Not counted",
};

/** Course basis -> credit status used for swatches. "not_counted" has no credit and is drawn as open. */
export function basisToStatus(basis: AcademicBasis): CreditStatus {
  return basis === "not_counted" ? "open" : basis;
}

export const COURSE_STATUS_LABEL: Record<HsCourseDisplayStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  awaiting_school: "Waiting for the school to confirm",
  official_complete: "Complete, confirmed by the school",
  not_passed: "Not passed",
  replaced: "Replaced",
  transfer_credit: "Transfer credit",
};

export const TASK_STATUS_LABEL: Record<HsTaskDisplayStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  pending_review: "Submitted, waiting for review",
  official_passed: "Passed (official)",
  official_failed: "Not passed (official)",
  retake_required: "Retake required",
};

// ---------------------------------------------------------------------------------------------------------------------
// Tallies
// ---------------------------------------------------------------------------------------------------------------------

export interface Tally {
  readonly required: HalfUnits;
  readonly official: HalfUnits;
  readonly awaiting_school: HalfUnits;
  readonly in_progress: HalfUnits;
  readonly planned: HalfUnits;
  /** Required and not covered by any of the above. */
  readonly open: HalfUnits;
  /** True when the bucket held more than the requirement and the surplus was not drawn. */
  readonly clipped: boolean;
}

/** Fills the requirement in order of evidence strength; anything beyond the requirement is not drawn. */
export function tallyOf(bucket: AcademicCreditBucket): Tally {
  let left = Math.max(0, bucket.requiredHalfUnits);
  let clipped = false;
  const take = (n: HalfUnits): HalfUnits => {
    const want = Math.max(0, n);
    const got = Math.min(want, left);
    if (got < want) clipped = true;
    left -= got;
    return got;
  };
  const official = take(bucket.officialHalfUnits);
  const awaiting_school = take(bucket.awaitingSchoolHalfUnits);
  const in_progress = take(bucket.inProgressHalfUnits);
  const planned = take(bucket.plannedHalfUnits);
  return { required: Math.max(0, bucket.requiredHalfUnits), official, awaiting_school, in_progress, planned, open: left, clipped };
}

/** Half-units counted in the chosen view. "verified" is official only. */
export function shownHalfUnits(t: Tally, mode: ViewMode): HalfUnits {
  return mode === "verified" ? t.official : t.official + t.awaiting_school + t.in_progress + t.planned;
}

/** Statuses drawn in the chosen view (the rest are dimmed or drawn as empty track, never merged). */
export function countsInMode(status: CreditStatus, mode: ViewMode): boolean {
  return status === "open" ? false : mode === "projected" || status === "official";
}

export function creditsText(half: HalfUnits): string {
  return `${formatHalfUnits(half)} ${half === 2 ? "credit" : "credits"}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Deck state
// ---------------------------------------------------------------------------------------------------------------------

export type DeckState = "not_configured" | "zero_progress" | "partial" | "complete";

export function deckState(p: AcademicProjection): DeckState {
  const t = p.credits.total;
  if (p.dataState === "not_configured" || t.requiredHalfUnits <= 0) return "not_configured";
  if (t.officialHalfUnits >= t.requiredHalfUnits) return "complete";
  if (t.officialHalfUnits === 0 && t.awaitingSchoolHalfUnits === 0 && t.inProgressHalfUnits === 0) return "zero_progress";
  return "partial";
}

// ---------------------------------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-26" or "2026-10-26T09:00:00Z" -> "26 Oct 2026". Anything unparsable is returned as given. */
export function formatDay(value: string | null | undefined): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : value;
}

/** "2026-10" -> "Oct 2026". */
export function formatMonth(value: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(value);
  if (!m) return value;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : value;
}

// ---------------------------------------------------------------------------------------------------------------------
// Gauge + legend
// ---------------------------------------------------------------------------------------------------------------------

export interface GaugeSegment {
  readonly status: Exclude<CreditStatus, "open">;
  readonly halfUnits: HalfUnits;
  readonly from: HalfUnits;
  readonly to: HalfUnits;
  /** Drawn in the current mode. Hidden segments keep their numbers for the legend. */
  readonly visible: boolean;
}

export interface GaugeModel {
  readonly requiredHalfUnits: HalfUnits;
  readonly segments: readonly GaugeSegment[];
  /** Number in the centre of the gauge for the chosen mode. */
  readonly shownHalfUnits: HalfUnits;
  /** Always the official figure, in both modes. */
  readonly officialHalfUnits: HalfUnits;
  readonly officialPercent: number;
  readonly caption: string;
  readonly ariaLabel: string;
  readonly tally: Tally;
}

const DRAWN: ReadonlyArray<Exclude<CreditStatus, "open">> = ["official", "awaiting_school", "in_progress", "planned"];

export function buildGauge(p: AcademicProjection, mode: ViewMode): GaugeModel {
  const t = tallyOf(p.credits.total);
  let cursor = 0;
  const segments: GaugeSegment[] = DRAWN.map((status) => {
    const from = cursor;
    cursor += t[status];
    return { status, halfUnits: t[status], from, to: cursor, visible: countsInMode(status, mode) };
  });
  const parts = CREDIT_STATUSES.map((s) => `${formatHalfUnits(t[s])} ${STATUS_LABEL[s].toLowerCase()}`).join(", ");
  return {
    requiredHalfUnits: t.required,
    segments,
    shownHalfUnits: shownHalfUnits(t, mode),
    officialHalfUnits: t.official,
    officialPercent: p.credits.total.officialPercent,
    caption: mode === "verified" ? "Official credit" : "Including planned",
    ariaLabel: `Credit gauge of ${formatHalfUnits(t.required)} required credits: ${parts}`,
    tally: t,
  };
}

export interface LegendRow {
  readonly status: CreditStatus;
  readonly label: string;
  readonly hint: string;
  readonly halfUnits: HalfUnits;
  readonly creditsText: string;
  readonly halfUnitsText: string;
  readonly dim: boolean;
}

export function buildLegend(p: AcademicProjection, mode: ViewMode): LegendRow[] {
  const t = tallyOf(p.credits.total);
  return CREDIT_STATUSES.map((status) => ({
    status,
    label: STATUS_LABEL[status],
    hint: statusHint(status, p.program.schoolDisplayName),
    halfUnits: t[status],
    creditsText: formatHalfUnits(t[status]),
    halfUnitsText: `${t[status]} of ${t.required} half-units`,
    dim: status !== "open" && !countsInMode(status, mode),
  }));
}

export function buildHeadline(p: AcademicProjection, mode: ViewMode): string {
  const t = tallyOf(p.credits.total);
  const req = formatHalfUnits(t.required);
  if (mode === "verified") return `${formatHalfUnits(t.official)} of ${req} credits are official`;
  const extra = t.awaiting_school + t.in_progress + t.planned;
  return `${formatHalfUnits(t.official)} official, ${formatHalfUnits(extra)} more awaiting, in progress or planned, of ${req} credits`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------------------------------------------------

export interface CoverageRow {
  readonly key: string;
  readonly name: string;
  readonly group: "whole" | "core" | "elective" | "area";
  readonly tally: Tally;
  readonly shown: HalfUnits;
  readonly text: string;
  readonly foot: string;
}

function coverageRow(key: string, name: string, group: CoverageRow["group"], bucket: AcademicCreditBucket, mode: ViewMode): CoverageRow {
  const tally = tallyOf(bucket);
  const shown = shownHalfUnits(tally, mode);
  return {
    key,
    name,
    group,
    tally,
    shown,
    text: `${formatHalfUnits(shown)} of ${formatHalfUnits(tally.required)} credits`,
    foot: `${shown} of ${tally.required} half-units · ${tally.required - shown} still to ${mode === "projected" ? "confirm or plan" : "confirm"}`,
  };
}

export function buildCoverage(p: AcademicProjection, mode: ViewMode): { main: CoverageRow[]; areas: CoverageRow[] } {
  const c = p.credits;
  return {
    main: [
      coverageRow("whole", "Whole program", "whole", c.total, mode),
      coverageRow("core", "Core requirement", "core", c.core, mode),
      coverageRow("elective", "Elective requirement", "elective", c.elective, mode),
    ],
    areas: c.byArea.map((a) => coverageRow(`area-${a.key}`, a.label, "area", a, mode)),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------------------------------------------------

export interface SubjectStripModel {
  readonly subject: AcademicSubject["subject"];
  readonly label: string;
  readonly tally: Tally;
  readonly shown: HalfUnits;
  /** One entry per required half-unit, strongest evidence first (drawn status, already mode-aware). */
  readonly cells: readonly CreditStatus[];
  readonly meta: string;
  readonly ariaLabel: string;
}

function courseTally(courses: readonly AcademicCourse[], required: HalfUnits): Tally {
  const sum = (basis: AcademicBasis) => courses.filter((c) => c.basis === basis).reduce((n, c) => n + c.halfUnits, 0);
  return tallyOf({
    requiredHalfUnits: required,
    officialHalfUnits: sum("official"),
    awaitingSchoolHalfUnits: sum("awaiting_school"),
    inProgressHalfUnits: sum("in_progress"),
    plannedHalfUnits: sum("planned"),
  });
}

/** Subject tally: the sum of its requirement areas (server-capped official credit); falls back to the subject's courses. */
export function subjectTally(p: AcademicProjection, s: AcademicSubject): Tally {
  const areas = p.credits.byArea.filter((a) => a.subject === s.subject);
  if (areas.length === 0) return courseTally(s.courses, s.requiredHalfUnits);
  const sum = (pick: (a: AcademicCreditBucket) => number) => areas.reduce((n, a) => n + pick(a), 0);
  return tallyOf({
    requiredHalfUnits: s.requiredHalfUnits,
    officialHalfUnits: sum((a) => a.officialHalfUnits),
    awaitingSchoolHalfUnits: sum((a) => a.awaitingSchoolHalfUnits),
    inProgressHalfUnits: sum((a) => a.inProgressHalfUnits),
    plannedHalfUnits: sum((a) => a.plannedHalfUnits),
  });
}

export function cellsFor(t: Tally, mode: ViewMode): CreditStatus[] {
  const out: CreditStatus[] = [];
  for (const status of DRAWN) {
    const n = t[status];
    for (let i = 0; i < n; i++) out.push(countsInMode(status, mode) ? status : "open");
  }
  for (let i = 0; i < t.open; i++) out.push("open");
  return out;
}

export function buildSubjectStrips(p: AcademicProjection, mode: ViewMode): SubjectStripModel[] {
  return p.subjects.map((s) => {
    const tally = subjectTally(p, s);
    const shown = shownHalfUnits(tally, mode);
    return {
      subject: s.subject,
      label: s.label,
      tally,
      shown,
      cells: cellsFor(tally, mode),
      meta: `${shown} of ${tally.required}`,
      ariaLabel: `${s.label}: ${shown} of ${tally.required} half-units ${mode === "verified" ? "official" : "official, awaiting, in progress or planned"}. Open details.`,
    };
  });
}

export interface TaskRow {
  readonly key: string;
  readonly title: string;
  readonly statusLabel: string;
  readonly due: string;
  readonly overdue: boolean;
}

export interface CourseRow {
  readonly key: string;
  readonly title: string;
  readonly areaLabel: string;
  readonly kindLabel: string;
  readonly status: CreditStatus;
  readonly basisLabel: string;
  readonly courseStatusLabel: string;
  readonly halfUnits: HalfUnits;
  readonly halfUnitsText: string;
  readonly creditsText: string;
  readonly dates: string;
  readonly tasksText: string;
  readonly tasks: readonly TaskRow[];
}

export interface SubjectDetail {
  readonly subject: AcademicSubject["subject"];
  readonly label: string;
  readonly subtitle: string;
  readonly tally: Tally;
  readonly courses: readonly CourseRow[];
  readonly math: ReadonlyArray<{ status: CreditStatus; label: string; halfUnits: HalfUnits }>;
  readonly requiredText: string;
  readonly areas: ReadonlyArray<{ key: string; label: string; officialHalfUnits: HalfUnits; requiredHalfUnits: HalfUnits }>;
}

export function buildCourseRow(c: AcademicCourse, areaLabel: string): CourseRow {
  const dates = c.plannedStart || c.plannedEnd ? `${c.plannedStart ? formatDay(c.plannedStart) : "?"} to ${c.plannedEnd ? formatDay(c.plannedEnd) : "?"}` : "";
  return {
    key: c.key,
    title: c.title,
    areaLabel,
    kindLabel: c.kind === "core" ? "Core" : "Elective",
    status: basisToStatus(c.basis),
    basisLabel: BASIS_LABEL[c.basis],
    courseStatusLabel: COURSE_STATUS_LABEL[c.status] ?? c.status,
    halfUnits: c.halfUnits,
    halfUnitsText: `${c.halfUnits} half-${c.halfUnits === 1 ? "unit" : "units"}`,
    creditsText: creditsText(c.halfUnits),
    dates,
    tasksText: c.tasksTotal > 0 ? `${c.tasksDone} of ${c.tasksTotal} tasks done` : "No tasks listed",
    tasks: c.tasks.map((t) => ({
      key: t.key,
      title: t.title,
      statusLabel: TASK_STATUS_LABEL[t.status] ?? t.status,
      due: t.dueDate ? `Due ${formatDay(t.dueDate)}` : "",
      overdue: t.overdue,
    })),
  };
}

export function buildSubjectDetail(p: AcademicProjection, s: AcademicSubject): SubjectDetail {
  const tally = subjectTally(p, s);
  const areas = p.credits.byArea.filter((a) => a.subject === s.subject);
  const areaLabel = (key: string) => areas.find((a) => a.key === key)?.label ?? s.label;
  const allElective = areas.length > 0 && areas.every((a) => a.kind === "elective");
  return {
    subject: s.subject,
    label: s.label,
    subtitle: `${allElective ? "Elective" : "Core"} requirement · ${creditsText(tally.required)} (${tally.required} half-units)`,
    tally,
    courses: s.courses.map((c) => buildCourseRow(c, areaLabel(c.areaKey))),
    math: CREDIT_STATUSES.map((status) => ({ status, label: STATUS_LABEL[status], halfUnits: tally[status] })),
    requiredText: `${tally.required} half-units = ${formatHalfUnits(tally.required)} ${tally.required === 2 ? "credit" : "credits"}`,
    areas: areas.map((a) => ({ key: a.key, label: a.label, officialHalfUnits: a.officialHalfUnits, requiredHalfUnits: a.requiredHalfUnits })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------------------------------------------------

export type MilestoneState = "done" | "current" | "upcoming";

export interface MilestoneModel {
  readonly key: string;
  readonly month: string;
  readonly title: string;
  readonly when: string;
  readonly state: MilestoneState;
  readonly stateLabel: string;
  readonly note: string;
  readonly targetHalfUnits: HalfUnits;
  readonly officialHalfUnits: HalfUnits;
  /** Official credit still needed to meet the milestone (0 when reached). */
  readonly gapHalfUnits: HalfUnits;
  readonly detail: string;
}

export function buildMilestones(p: AcademicProjection): MilestoneModel[] {
  const sorted = [...p.milestones].sort((a, b) => a.month.localeCompare(b.month));
  const official = p.credits.total.officialHalfUnits;
  const firstOpen = sorted.findIndex((m: AcademicMilestone) => !m.reached);
  return sorted.map((m, i) => {
    const state: MilestoneState = m.reached ? "done" : i === firstOpen ? "current" : "upcoming";
    const gap = Math.max(0, m.cumulativeHalfUnits - official);
    const target = `${formatHalfUnits(m.cumulativeHalfUnits)} official credits`;
    return {
      key: m.month,
      month: m.month,
      title: `${target} by ${formatMonth(m.month)}`,
      when: formatMonth(m.month),
      state,
      stateLabel: state === "done" ? "Reached" : state === "current" ? "Next milestone" : "Upcoming",
      note: m.reached ? "Official credit already meets this step." : `${formatHalfUnits(gap)} more official ${gap === 2 ? "credit" : "credits"} needed.`,
      targetHalfUnits: m.cumulativeHalfUnits,
      officialHalfUnits: official,
      gapHalfUnits: gap,
      detail: m.reached
        ? `Your official credit (${formatHalfUnits(official)}) meets the ${formatHalfUnits(m.cumulativeHalfUnits)} credits your plan expects by ${formatMonth(m.month)}.`
        : `Your plan expects ${formatHalfUnits(m.cumulativeHalfUnits)} official credits by ${formatMonth(m.month)}. You have ${formatHalfUnits(official)} official so far. Only credit confirmed by the school counts toward a milestone.`,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Next actions
// ---------------------------------------------------------------------------------------------------------------------

export type ActionTone = "attention" | "normal";

export interface NextActionModel {
  readonly key: string;
  readonly kind: AcademicNextAction["kind"];
  readonly kindLabel: string;
  readonly message: string;
  readonly href: string;
  readonly courseKey: string | null;
  readonly taskKey: string | null;
  readonly due: string;
  readonly tone: ActionTone;
  readonly ownerLabel: string;
}

const KIND_LABEL: Record<AcademicNextAction["kind"], string> = {
  next_task: "Next task",
  overdue_task: "Overdue",
  behind_pace: "Behind pace",
  retake_required: "Retake required",
  not_passed: "Not passed",
  documents_requested: "Documents requested",
  support_open: "Support",
};

const ATTENTION: ReadonlySet<AcademicNextAction["kind"]> = new Set(["overdue_task", "behind_pace", "retake_required", "not_passed", "documents_requested"]);

/** Where a next action leads. Course and task keys are carried on the model for deep links when the page supports them. */
export function actionHref(kind: AcademicNextAction["kind"]): string {
  if (kind === "documents_requested") return "/documents";
  if (kind === "support_open") return "/support";
  return "/high-school";
}

export function buildNextActions(p: AcademicProjection): NextActionModel[] {
  return p.nextActions.map((a, i) => ({
    key: `${a.kind}-${a.courseKey ?? "none"}-${a.taskKey ?? i}`,
    kind: a.kind,
    kindLabel: KIND_LABEL[a.kind] ?? a.kind,
    message: a.message,
    href: actionHref(a.kind),
    courseKey: a.courseKey,
    taskKey: a.taskKey,
    due: a.dueDate ? `Due ${formatDay(a.dueDate)}` : "",
    tone: ATTENTION.has(a.kind) ? "attention" : "normal",
    ownerLabel: a.owner === "lumiere" ? "Waiting on Lumière" : "Your move",
  }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Provenance, pace, graduation
// ---------------------------------------------------------------------------------------------------------------------

export interface ProvenanceModel {
  readonly officialDefinition: string;
  readonly plan: string;
  readonly template: string;
  readonly program: string;
  readonly dates: string;
  readonly studentMessage: string | null;
  readonly generated: string;
}

export function buildProvenance(p: AcademicProjection): ProvenanceModel {
  const school = p.program.schoolDisplayName;
  const { planVersion, publishedAt, studentMessage } = p.provenance;
  const plan =
    planVersion === null && !publishedAt
      ? "No plan has been published yet."
      : `Plan version ${planVersion ?? "?"}${publishedAt ? `, published ${formatDay(publishedAt)}` : ""}.`;
  const t = p.program;
  const template = t.templateKey ? `Requirements template ${t.templateKey}${t.templateVersion !== null ? ` (version ${t.templateVersion})` : ""}.` : "Requirements template not shown.";
  const dates = [t.startedOn ? `Started ${formatDay(t.startedOn)}` : "", t.targetCompletionDate ? `target completion ${formatDay(t.targetCompletionDate)}` : ""].filter(Boolean).join(", ");
  return {
    officialDefinition: `Official means confirmed by ${school}. Credit you report, courses in progress and planned courses are shown separately and never counted as official.`,
    plan,
    template,
    program: t.title,
    dates,
    studentMessage: studentMessage ?? null,
    generated: `Updated ${formatDay(p.generatedAt)}`,
  };
}

export function paceText(p: AcademicProjection): string | null {
  const { status, expectedByNowHalfUnits } = p.pace;
  if (status === "not_configured" || expectedByNowHalfUnits === null) return null;
  const expected = `${formatHalfUnits(expectedByNowHalfUnits)} credits expected by now`;
  const label = status === "behind" ? "Behind your plan" : status === "ahead" ? "Ahead of your plan" : "On track";
  return `${label}: ${expected}, ${formatHalfUnits(p.credits.total.officialHalfUnits)} official.`;
}

export function graduationText(p: AcademicProjection): string {
  const g = p.graduation;
  if (g.status === "diploma_conferred") return "Diploma conferred.";
  if (g.status === "eligibility_confirmed") return `Graduation eligibility confirmed${g.eligibilityConfirmedAt ? ` on ${formatDay(g.eligibilityConfirmedAt)}` : ""}.`;
  const bits: string[] = [];
  bits.push(g.creditsSatisfied ? "Credits satisfied" : "Credits not yet satisfied");
  if (g.outstandingExams > 0) bits.push(`${g.outstandingExams} ${g.outstandingExams === 1 ? "exam" : "exams"} outstanding`);
  if (g.outstandingProjects > 0) bits.push(`${g.outstandingProjects} ${g.outstandingProjects === 1 ? "project" : "projects"} outstanding`);
  return `${bits.join(", ")}.`;
}

export function configText(p: AcademicProjection): string {
  const c = p.credits;
  return `Program configuration: ${formatHalfUnits(c.total.requiredHalfUnits)} credits = ${formatHalfUnits(c.core.requiredHalfUnits)} core + ${formatHalfUnits(c.elective.requiredHalfUnits)} elective (${c.total.requiredHalfUnits} = ${c.core.requiredHalfUnits} + ${c.elective.requiredHalfUnits} half-units), set by your approved program, not a universal rule.`;
}
