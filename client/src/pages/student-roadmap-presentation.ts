/**
 * Pure presentation logic for the Lumière-assigned roadmap (S05).
 *
 * Nothing here awards, computes or infers credit. Credit amounts are decimal
 * strings from view.foundation.ladder and are only re-formatted. The only
 * numeric conversions (`barFraction`) size graphics and are never rendered.
 * There is deliberately no weighted overall percentage.
 */
import type {
  RoadmapTaskKind,
  StudentItemStage,
  StudentProgressUpdate,
  StudentFoundationView,
  StudentRoadmapCounts,
  StudentRoadmapItemView,
  StudentRoadmapMilestoneView,
  StudentRoadmapObjectiveView,
  StudentRoadmapPhaseView,
  StudentRoadmapView,
  StudentTaskStatus,
  StudentTaskView,
} from "@shared/student-roadmap-contract";
import type { StudentRequirementView } from "@shared/student-degree-progress-view";
import { formatDecimal } from "@/pages/student-progress-presentation";

export const BRAND_NAME = "Lumière Higher-Ed Pathways";

// ── Sections ────────────────────────────────────────────────────────────────

export const ROADMAP_SECTIONS = [
  { id: "section-today", label: "Today" },
  { id: "section-roadmap", label: "Roadmap" },
  { id: "section-foundation", label: "Foundation" },
  { id: "section-horizon", label: "Horizon" },
] as const;

// ── Stages ──────────────────────────────────────────────────────────────────

export interface StagePresentation {
  readonly stage: StudentItemStage;
  readonly label: string;
  readonly help: string;
}

export const STAGES: readonly StagePresentation[] = [
  { stage: "not_started", label: "Not started", help: "Nothing has been reported on this yet." },
  { stage: "in_progress", label: "In progress", help: "You have started the work." },
  { stage: "submitted", label: "Submitted", help: "Every task is submitted or graded." },
  { stage: "graded", label: "Graded", help: "Every task is graded." },
  {
    stage: "provider_complete",
    label: "Complete at provider",
    help: "You reported this complete at the course provider. Lumière still has to review it.",
  },
  {
    stage: "officially_accepted",
    label: "Officially accepted",
    help: "Lumière has verified this on your record. Only Lumière staff can make this decision.",
  },
];

export const OFFICIAL_ACCEPTANCE_EXPLANATION =
  "Official acceptance is Lumière's decision. It appears here only after our team verifies the course on your record; you cannot set it yourself.";

export function stageIndex(stage: StudentItemStage): number {
  const i = STAGES.findIndex((s) => s.stage === stage);
  return i < 0 ? 0 : i;
}

export function stagePresentation(stage: StudentItemStage): StagePresentation {
  return STAGES[stageIndex(stage)];
}

export function stageAriaLabel(stage: StudentItemStage): string {
  return `Stage ${stageIndex(stage) + 1} of ${STAGES.length}: ${stagePresentation(stage).label}`;
}

// ── Tasks ───────────────────────────────────────────────────────────────────

const TASK_KIND_LABELS: Record<RoadmapTaskKind, readonly [string, string]> = {
  challenge: ["challenge", "challenges"],
  milestone: ["milestone", "milestones"],
  touchstone: ["touchstone", "touchstones"],
  paper: ["paper", "papers"],
  quiz: ["quiz", "quizzes"],
  exam: ["exam", "exams"],
  assignment: ["assignment", "assignments"],
  other: ["task", "tasks"],
};

export function taskKindLabel(kind: RoadmapTaskKind, plural = false): string {
  return TASK_KIND_LABELS[kind][plural ? 1 : 0];
}

export type TaskControlKind = "toggle" | "segmented";

/** Touchstones, papers and milestones have a submit/grade cycle; the rest are done or not. */
export function taskControlKind(kind: RoadmapTaskKind): TaskControlKind {
  return kind === "touchstone" || kind === "paper" || kind === "milestone" ? "segmented" : "toggle";
}

export const TASK_STATUS_OPTIONS: readonly { value: StudentTaskStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "submitted", label: "Submitted" },
  { value: "graded", label: "Graded" },
];

export function taskStatusLabel(status: StudentTaskStatus): string {
  return TASK_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

/** "5 of 8 challenges done"; mixed kinds read "5 of 8 tasks done". Null with no tasks. */
export function taskProgressPhrase(item: StudentRoadmapItemView): string | null {
  const { total, graded } = item.taskCounts;
  if (total === 0) return null;
  const kinds = new Set(item.tasks.map((t) => t.kind));
  const noun = kinds.size === 1 ? taskKindLabel([...kinds][0], total !== 1) : total === 1 ? "task" : "tasks";
  return `${graded} of ${total} ${noun} done`;
}

/** The next tasks still to do, in plan order. */
export function nextTasks(item: StudentRoadmapItemView, limit = 3): StudentTaskView[] {
  return item.tasks.filter((t) => t.status !== "graded").slice(0, limit);
}

/** Reporting is allowed unless the item is dropped/alternative or already officially accepted. */
export function controlsEnabled(item: StudentRoadmapItemView): boolean {
  return item.canReport && item.stage !== "officially_accepted";
}

export function doneToggleTarget(task: StudentTaskView): StudentTaskStatus {
  return task.status === "graded" ? "not_started" : "graded";
}

// ── Progress updates (what the student may report) ──────────────────────────

export const ITEM_ROW = "__item__";

export function rowKey(itemKey: string, taskKey: string | null): string {
  return `${itemKey}:${taskKey ?? ITEM_ROW}`;
}

export function taskUpdate(
  item: StudentRoadmapItemView,
  task: StudentTaskView,
  status: StudentTaskStatus,
): StudentProgressUpdate {
  return { itemKey: item.key, taskKey: task.key, status, expectedRevision: task.revision };
}

export function itemUpdate(
  item: StudentRoadmapItemView,
  status: "not_started" | "in_progress" | "provider_complete",
): StudentProgressUpdate {
  return { itemKey: item.key, taskKey: null, status, expectedRevision: item.itemRevision };
}

export function canMarkProviderComplete(item: StudentRoadmapItemView): boolean {
  return item.canReport && item.stage !== "officially_accepted" && item.itemStatus !== "provider_complete";
}

export function canUndoProviderComplete(item: StudentRoadmapItemView): boolean {
  return item.canReport && item.stage !== "officially_accepted" && item.itemStatus === "provider_complete";
}

export const PROVIDER_COMPLETE_CONFIRM = {
  title: "Mark this course complete at the provider?",
  body:
    "Only do this if the provider shows the course as finished. This tells Lumière you have finished it; it does not award credit. Our team verifies it before it counts, and you can undo this until then.",
  confirm: "Yes, it is complete",
  cancel: "Not yet",
} as const;

export function savedMessage(label: string): string {
  return `Saved: ${label}.`;
}

export function taskSavedLabel(task: StudentTaskView, status: StudentTaskStatus): string {
  return `${task.title} marked ${taskStatusLabel(status).toLowerCase()}`;
}

// ── Counts (never a weighted percentage) ────────────────────────────────────

export interface CountSegment {
  readonly key: "accepted" | "provider" | "progress" | "not_started";
  readonly label: string;
  readonly value: number;
}

export function countSegments(counts: StudentRoadmapCounts): CountSegment[] {
  return [
    { key: "accepted", label: "Officially accepted", value: counts.itemsOfficiallyAccepted },
    { key: "provider", label: "Complete at provider", value: counts.itemsProviderComplete },
    { key: "progress", label: "In progress", value: counts.itemsInProgress },
    { key: "not_started", label: "Not started", value: counts.itemsNotStarted },
  ];
}

/** Share of a segment, used ONLY to size the stacked bar. */
export function segmentFraction(value: number, counts: StudentRoadmapCounts): number {
  const total = countSegments(counts).reduce((sum, s) => sum + s.value, 0);
  return total > 0 ? value / total : 0;
}

export function countsSentence(counts: StudentRoadmapCounts): string {
  const noun = counts.itemsTotal === 1 ? "item" : "items";
  return `${counts.itemsTotal} ${noun} on your roadmap: ${countSegments(counts)
    .map((s) => `${s.value} ${s.label.toLowerCase()}`)
    .join(", ")}.`;
}

export function phaseSummaryLine(phase: StudentRoadmapPhaseView): string {
  const finished = phase.counts.itemsOfficiallyAccepted + phase.counts.itemsProviderComplete;
  const parts = [`${finished} of ${phase.counts.itemsTotal} ${phase.counts.itemsTotal === 1 ? "item" : "items"} finished`];
  if (phase.counts.tasksTotal > 0) {
    parts.push(`${phase.counts.tasksGraded} of ${phase.counts.tasksTotal} tasks done`);
  }
  return parts.join(" · ");
}

// ── Lookup helpers ──────────────────────────────────────────────────────────

export function isPublished(view: StudentRoadmapView): boolean {
  return view.state === "PUBLISHED" && view.plan !== null;
}

export function allItems(view: StudentRoadmapView): StudentRoadmapItemView[] {
  return view.phases.flatMap((p) => p.items);
}

export function itemsByKey(view: StudentRoadmapView): Map<string, StudentRoadmapItemView> {
  return new Map(allItems(view).map((i) => [i.key, i]));
}

export function focusItems(view: StudentRoadmapView): StudentRoadmapItemView[] {
  const byKey = itemsByKey(view);
  return view.today.focusItemKeys
    .map((k) => byKey.get(k))
    .filter((i): i is StudentRoadmapItemView => Boolean(i))
    .slice(0, 3);
}

export function currentPhase(view: StudentRoadmapView): StudentRoadmapPhaseView | null {
  const phases = [...view.phases].sort((a, b) => a.sequence - b.sequence);
  return (
    phases.find((p) => p.state === "current") ??
    phases.find((p) => p.state === "upcoming") ??
    phases[phases.length - 1] ??
    null
  );
}

export function sortedPhases(view: StudentRoadmapView): StudentRoadmapPhaseView[] {
  return [...view.phases].sort((a, b) => a.sequence - b.sequence);
}

export function upcomingPhases(view: StudentRoadmapView): StudentRoadmapPhaseView[] {
  return sortedPhases(view).filter((p) => p.state === "upcoming");
}

export function nextMilestone(view: StudentRoadmapView): StudentRoadmapMilestoneView | null {
  const byKey = view.today.nextMilestoneKey
    ? view.milestones.find((m) => m.key === view.today.nextMilestoneKey)
    : undefined;
  if (byKey) return byKey;
  return horizonMilestones(view).find((m) => !m.reached) ?? null;
}

export function horizonMilestones(view: StudentRoadmapView): StudentRoadmapMilestoneView[] {
  return view.milestones
    .map((m, index) => ({ m, index }))
    .sort((a, b) => {
      const da = a.m.targetDate ?? "9999-99-99";
      const db = b.m.targetDate ?? "9999-99-99";
      return da === db ? a.index - b.index : da < db ? -1 : 1;
    })
    .map(({ m }) => m);
}

const MILESTONE_KIND_LABELS: Record<StudentRoadmapMilestoneView["kind"], string> = {
  checkpoint: "Checkpoint",
  application: "Application",
  objective_complete: "Objective complete",
  graduation: "Graduation",
};

export function milestoneKindLabel(kind: StudentRoadmapMilestoneView["kind"]): string {
  return MILESTONE_KIND_LABELS[kind];
}

export function milestoneStatusLine(m: StudentRoadmapMilestoneView): string {
  if (m.reached) return "Reached";
  if (m.remainingItems === 0) return "Waiting for Lumière to confirm";
  return `${m.remainingItems} ${m.remainingItems === 1 ? "item" : "items"} to go`;
}

// ── Dates ───────────────────────────────────────────────────────────────────

export function formatShortDate(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function dateRangeLabel(start: string | null, end: string | null): string | null {
  const s = formatShortDate(start);
  const e = formatShortDate(end);
  if (s && e) return `${s} to ${e}`;
  if (e) return `Target ${e}`;
  if (s) return `Starts ${s}`;
  return null;
}

// ── Objectives (lanes) ──────────────────────────────────────────────────────

const OBJECTIVE_KIND_LABELS: Record<StudentRoadmapObjectiveView["kind"], string> = {
  primary: "Primary degree",
  secondary: "Secondary credential",
  parallel: "Parallel track",
  prerequisite: "Prerequisite track",
};

const OBJECTIVE_KIND_HELP: Record<StudentRoadmapObjectiveView["kind"], string> = {
  primary: "The degree you are assigned to.",
  secondary: "An additional credential, after or beside your primary degree.",
  parallel: "Pursued at the same time as your primary degree.",
  prerequisite: "Courses needed before a later admission.",
};

export function objectiveKindLabel(kind: StudentRoadmapObjectiveView["kind"]): string {
  return OBJECTIVE_KIND_LABELS[kind];
}
export function objectiveKindHelp(kind: StudentRoadmapObjectiveView["kind"]): string {
  return OBJECTIVE_KIND_HELP[kind];
}

export interface LaneOption {
  readonly key: string;
  readonly label: string;
  readonly kindLabel: string | null;
}

export const ALL_LANES = "all";

/** Filter choices; only offered when the plan has more than one objective. */
export function laneOptions(view: StudentRoadmapView): LaneOption[] {
  const usable = view.objectives.filter((o) => o.status !== "changed");
  if (usable.length < 2) return [];
  return [
    { key: ALL_LANES, label: "Everything", kindLabel: null },
    ...usable.map((o) => ({ key: o.key, label: o.title, kindLabel: objectiveKindLabel(o.kind) })),
  ];
}

export function objectiveFor(view: StudentRoadmapView, key: string): StudentRoadmapObjectiveView | undefined {
  return view.objectives.find((o) => o.key === key);
}

export interface PhaseItems {
  /** Reportable plan items, in sequence. */
  readonly main: StudentRoadmapItemView[];
  /** Alternative routes (muted, not reportable). */
  readonly alternatives: StudentRoadmapItemView[];
}

export function phaseItems(phase: StudentRoadmapPhaseView, lane: string = ALL_LANES): PhaseItems {
  const visible = phase.items
    .filter((i) => i.planStatus !== "dropped")
    .filter((i) => lane === ALL_LANES || i.objectiveKey === lane)
    .sort((a, b) => a.sequence - b.sequence);
  return {
    main: visible.filter((i) => i.planStatus !== "alternative"),
    alternatives: visible.filter((i) => i.planStatus === "alternative"),
  };
}

export function itemDateLabel(item: StudentRoadmapItemView): string | null {
  return dateRangeLabel(item.plannedStart, item.plannedEnd);
}

export function alternativeTargetTitle(view: StudentRoadmapView, item: StudentRoadmapItemView): string | null {
  return item.alternativeOf ? (itemsByKey(view).get(item.alternativeOf)?.title ?? null) : null;
}

export function itemCreditsLabel(item: StudentRoadmapItemView): string | null {
  if (item.stage === "officially_accepted" && item.official?.awardedCredits) {
    const v = formatDecimal(item.official.awardedCredits);
    return v ? `${v} ${v === "1" ? "credit" : "credits"} awarded by Lumière` : null;
  }
  const planned = formatDecimal(item.credits);
  return planned ? `${planned} ${planned === "1" ? "credit" : "credits"} planned` : null;
}

// ── Foundation and the credit ladder ────────────────────────────────────────

export interface LadderRung {
  readonly key: "reported" | "provisional" | "verified" | "applied";
  readonly label: string;
  readonly value: string | null;
  readonly help: string;
}

type Ladder = StudentFoundationView["ladder"];

export const SURPLUS_EXPLANATION =
  "Verified credits beyond what any requirement needs; they're on your record but don't move you closer to graduation.";
export const PLANNED_EXPLANATION =
  "Credits from roadmap courses that Lumière has not accepted yet. This is planning only, not credit.";
export const APPLIED_VS_VERIFIED =
  "Verified means Lumière checked and accepted the credit. Applied means that credit is counted toward a degree requirement.";

export function ladderRungs(ladder: Ladder): LadderRung[] {
  return [
    { key: "reported", label: "Reported", value: ladder.reported, help: "Credits on documents you provided, not yet checked." },
    { key: "provisional", label: "Provisional", value: ladder.provisional, help: "Reported credits waiting for Lumière to verify." },
    { key: "verified", label: "Verified", value: ladder.verified, help: "Checked and accepted by Lumière staff." },
    {
      key: "applied",
      label: "Applied",
      value: ladder.applied,
      help: ladder.applied === null ? "Shown once Lumière finishes reviewing your record." : "Verified credits counted toward your degree requirements.",
    },
  ];
}

/** Common scale so bar lengths are comparable. Graphic sizing only. */
export function ladderScale(ladder: Ladder): number {
  const nums = [ladder.required, ladder.reported, ladder.provisional, ladder.verified, ladder.applied, ladder.planned]
    .map((v) => (v === null ? 0 : Number.parseFloat(v)))
    .filter((n) => Number.isFinite(n));
  return Math.max(0, ...nums);
}

export function barFraction(value: string | null, scale: number): number {
  if (value === null || scale <= 0) return 0;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(1, n / scale);
}

export function hasPositive(value: string | null): boolean {
  if (value === null) return false;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0;
}

export function creditsText(value: string | null): string | null {
  const d = formatDecimal(value);
  return d === null ? null : `${d} ${d === "1" ? "credit" : "credits"}`;
}

export function ladderAriaLabel(ladder: Ladder): string {
  const parts = ladderRungs(ladder)
    .map((r) => (r.value === null ? null : `${r.label} ${creditsText(r.value)}`))
    .filter(Boolean);
  if (ladder.required) parts.push(`degree requires ${creditsText(ladder.required)}`);
  return parts.join(", ");
}

export function foundationHeadline(f: StudentFoundationView): string {
  const n = f.credentials.length;
  if (n === 0) return "Your starting point";
  return n === 1 ? "Your starting point: 1 prior credential" : `Your starting point: ${n} prior credentials`;
}

export function foundationStateNote(f: StudentFoundationView): string | null {
  if (f.degreeState === "UNDER_REVIEW") {
    return "Lumière staff is reviewing your record, so applied and surplus credits are not shown yet.";
  }
  if (f.degreeState === "NO_ACTIVE_PROGRAM") {
    return "Your degree program has not been assigned yet, so applied and surplus credits are not shown.";
  }
  return null;
}

/** "9 of 6" never appears: credit above a requirement's need is stated as surplus. */
function toHundredths(value: string | null): number | null {
  if (value === null || !/^\d+(\.\d+)?$/.test(value)) return null;
  const [whole, frac = ""] = value.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}
function fromHundredths(n: number): string {
  const whole = Math.floor(n / 100);
  const frac = String(n % 100).padStart(2, "0");
  return formatDecimal(`${whole}.${frac}`) ?? String(whole);
}

export interface RequirementLine {
  readonly text: string;
  readonly surplusNote: string | null;
}

export function requirementLine(req: StudentRequirementView): RequirementLine | null {
  const applied = toHundredths(req.appliedAmount);
  const required = toHundredths(req.requiredAmount);
  if (applied === null || required === null) return null;
  if (applied > required) {
    return {
      text: `${fromHundredths(required)} of ${fromHundredths(required)} credits`,
      surplusNote: `${fromHundredths(applied - required)} more verified than this requirement needs; the extra is surplus.`,
    };
  }
  return { text: `${fromHundredths(applied)} of ${fromHundredths(required)} credits`, surplusNote: null };
}
