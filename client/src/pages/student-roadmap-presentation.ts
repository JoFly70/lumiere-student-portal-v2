/**
 * Pure presentation logic for the Lumière-assigned roadmap (S05).
 *
 * Nothing here awards, computes or infers credit. Credit amounts are decimal
 * strings from view.foundation.ladder and are only re-formatted. The only
 * numeric conversions (`barFraction`) size graphics and are never rendered.
 * There is deliberately no weighted overall percentage.
 */
import { currentLanguage, type Language } from "@/i18n";
import { djTranslate } from "@/components/degree-journey/i18n";
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

export const BRAND_NAME = "Lumière Student Portal";

// ── Sections ────────────────────────────────────────────────────────────────

/**
 * Page ownership (S07): the Flight Deck owns "where you stand" in full (progress,
 * foundation, horizon); the Roadmap owns the journey. Each page links to the other
 * instead of repeating its detail.
 */
export const FLIGHT_DECK_SECTIONS = [
  { id: "section-today", label: "Today" },
  { id: "section-journey", label: "Journey" },
  { id: "section-progress", label: "Progress" },
  { id: "section-foundation", label: "Foundation" },
  { id: "section-horizon", label: "Horizon" },
] as const;

export const ROADMAP_SECTIONS = [
  { id: "section-today", label: "Now" },
  { id: "section-roadmap", label: "Phases" },
] as const;

export const FLIGHT_DECK_PATH = "/flight-deck";
export const ROADMAP_PATH = "/roadmap";
export const FOUNDATION_HREF = `${FLIGHT_DECK_PATH}#section-foundation`;
export const HORIZON_HREF = `${FLIGHT_DECK_PATH}#section-horizon`;

// ── Status language (S07) ───────────────────────────────────────────────────
// Seven semantic statuses; colours live in index.css (--st-*). Gold is the brand
// accent and is NOT a status. Every status is shown with an icon AND a label.

export type StatusKey = "official" | "applied" | "provider" | "progress" | "submitted" | "notstarted" | "attention";

export interface StatusMeta {
  readonly key: StatusKey;
  readonly label: string;
  readonly help: string;
}

export const STATUS_META: Record<StatusKey, StatusMeta> = {
  official: { key: "official", label: "Officially accepted", help: "Lumière verified it on your record." },
  applied: { key: "applied", label: "Applied", help: "Verified credit counted toward a degree requirement." },
  provider: { key: "provider", label: "Complete at provider", help: "You finished it at the provider; Lumière still reviews it." },
  progress: { key: "progress", label: "In progress", help: "You have started the work." },
  submitted: { key: "submitted", label: "Submitted", help: "Submitted and waiting to be graded." },
  notstarted: { key: "notstarted", label: "Not started", help: "Nothing reported yet." },
  attention: { key: "attention", label: "Needs attention", help: "On hold, waiting for approval, or overdue." },
};

/** Status colour for an item stage. "All tasks done" is still work in progress until it is complete at the provider. */
export function stageStatus(stage: StudentItemStage): StatusKey {
  switch (stage) {
    case "officially_accepted": return "official";
    case "provider_complete": return "provider";
    case "submitted": return "submitted";
    case "in_progress":
    case "graded": return "progress";
    default: return "notstarted";
  }
}

export function taskStatusKey(status: StudentTaskStatus): StatusKey {
  if (status === "graded") return "progress";
  if (status === "submitted") return "submitted";
  if (status === "in_progress") return "progress";
  return "notstarted";
}

// ── Stages ──────────────────────────────────────────────────────────────────

export interface StagePresentation {
  readonly stage: StudentItemStage;
  readonly label: string;
  /** Short label printed under each step of the stage track. */
  readonly short: string;
  readonly help: string;
}

export const STAGES: readonly StagePresentation[] = [
  { stage: "not_started", label: "Not started", short: "Not started", help: "Nothing has been reported on this yet." },
  { stage: "in_progress", label: "In progress", short: "Started", help: "You have started the work." },
  { stage: "submitted", label: "Submitted", short: "Submitted", help: "Every task is submitted or done." },
  { stage: "graded", label: "All tasks done", short: "All done", help: "You have reported every task done." },
  {
    stage: "provider_complete",
    label: "Complete at provider",
    short: "At provider",
    help: "You reported this complete at the course provider. Lumière still has to review it.",
  },
  {
    stage: "officially_accepted",
    label: "Officially accepted",
    short: "Official",
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

/** "Started" instead of "In progress" while no task is done yet. */
export function stageLabelFor(item: StudentRoadmapItemView): string {
  if (item.stage === "in_progress" && item.taskCounts.graded === 0) return "Started";
  return stagePresentation(item.stage).label;
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

/** Student-facing wording. The API value "graded" is shown as "Done": the student reports work done and never grades. */
export const TASK_STATUS_OPTIONS: readonly { value: StudentTaskStatus; label: string; reported: string }[] = [
  { value: "not_started", label: "Not started", reported: "not started" },
  { value: "in_progress", label: "Started", reported: "started" },
  { value: "submitted", label: "Submitted", reported: "submitted" },
  { value: "graded", label: "Done", reported: "done" },
];

/** Status choices offered for a task. Challenges/quizzes/exams have no "submitted" step unless already there. */
export function statusOptionsFor(task: StudentTaskView): readonly { value: StudentTaskStatus; label: string; reported: string }[] {
  if (taskControlKind(task.kind) === "segmented" || task.status === "submitted") return TASK_STATUS_OPTIONS;
  return TASK_STATUS_OPTIONS.filter((o) => o.value !== "submitted");
}

export function taskStatusLabel(status: StudentTaskStatus): string {
  return TASK_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

export function taskReportedPhrase(status: StudentTaskStatus): string {
  return TASK_STATUS_OPTIONS.find((o) => o.value === status)?.reported ?? status;
}

/** "5 of 8 challenges done"; mixed kinds read "5 of 8 tasks done". Null with no tasks. */
export function taskProgressPhrase(item: StudentRoadmapItemView): string | null {
  const { total, graded } = item.taskCounts;
  if (total === 0) return null;
  const kinds = new Set(item.tasks.map((t) => t.kind));
  const noun = kinds.size === 1 ? taskKindLabel([...kinds][0], total !== 1) : total === 1 ? "task" : "tasks";
  return `${graded} of ${total} ${noun} done`;
}

/**
 * The next tasks the student can still ACT on, in plan order: not started or
 * started. Submitted tasks need no more action until they are graded, so they
 * are listed separately (awaitingGradingTasks), never as "Next up".
 */
export function nextTasks(item: StudentRoadmapItemView, limit = 3): StudentTaskView[] {
  return item.tasks.filter((t) => t.status === "not_started" || t.status === "in_progress").slice(0, limit);
}

/** Tasks submitted and waiting to be graded. */
export function awaitingGradingTasks(item: StudentRoadmapItemView): StudentTaskView[] {
  return item.tasks.filter((t) => t.status === "submitted");
}

/** "2 tasks submitted, awaiting grading" for the whole plan; null when none. */
export function awaitingGradingSentence(view: StudentRoadmapView): string | null {
  const n = view.counts.tasksSubmitted;
  if (n <= 0) return null;
  return `${n} ${n === 1 ? "task" : "tasks"} submitted, awaiting grading`;
}

// ── Due dates (S07) ─────────────────────────────────────────────────────────

export type DueTone = "overdue" | "soon" | "later";

export interface DueInfo {
  readonly iso: string;
  /** "Nov 3" (year only when it is not the current year). */
  readonly dateText: string;
  readonly tone: DueTone;
  /** Visible words: "Due Nov 3", "Due in 3 days", "Overdue since Oct 20". */
  readonly text: string;
}

const MS_DAY = 86_400_000;

export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Due-date wording for a task that still needs the student; null for done tasks or no date. */
export function dueInfo(task: StudentTaskView, today: string = todayIso()): DueInfo | null {
  if (!task.dueDate || task.status === "graded" || task.status === "submitted") return null;
  const due = Date.parse(`${task.dueDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(now)) return null;
  const days = Math.round((due - now) / MS_DAY);
  const sameYear = task.dueDate.slice(0, 4) === today.slice(0, 4);
  const dateText = new Date(due).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
  if (days < 0) return { iso: task.dueDate, dateText, tone: "overdue", text: `Overdue since ${dateText}` };
  if (days === 0) return { iso: task.dueDate, dateText, tone: "soon", text: "Due today" };
  if (days <= 7) return { iso: task.dueDate, dateText, tone: "soon", text: `Due in ${days} ${days === 1 ? "day" : "days"} (${dateText})` };
  return { iso: task.dueDate, dateText, tone: "later", text: `Due ${dateText}` };
}

/** The earliest due date among an item's open tasks. */
export function nextDue(item: StudentRoadmapItemView, today: string = todayIso()): DueInfo | null {
  const infos = item.tasks.map((t) => dueInfo(t, today)).filter((d): d is DueInfo => d !== null);
  infos.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
  return infos[0] ?? null;
}

/** Reporting is allowed unless the item is dropped/alternative or already officially accepted. */
export function controlsEnabled(item: StudentRoadmapItemView): boolean {
  return item.canReport && item.stage !== "officially_accepted";
}

/** Why reporting is closed for this item, in the student\'s words; null when it is open or not applicable. */
export function blockedReasonText(item: StudentRoadmapItemView): string | null {
  if (item.canReport || item.stage === "officially_accepted") return null;
  if (item.reportBlockedReason === "on_hold") {
    const why = item.holdReason ? `${item.holdReason.replace(/[.\s]+$/, "")}. ` : "";
    return `On hold: ${why}Reporting reopens when Lumière lifts the hold.`;
  }
  if (item.reportBlockedReason === "approval_pending") return "Waiting for advisor approval before you start.";
  return null;
}

export function blockedReasonShort(item: StudentRoadmapItemView): string | null {
  if (item.canReport || item.stage === "officially_accepted") return null;
  if (item.reportBlockedReason === "on_hold") return "On hold";
  if (item.reportBlockedReason === "approval_pending") return "Awaiting approval";
  return null;
}

/**
 * One visible sentence that explains the short pill on a COLLAPSED row, so the
 * meaning never depends on hover or on opening the card.
 */
export function blockedReasonInline(item: StudentRoadmapItemView): string | null {
  if (item.canReport || item.stage === "officially_accepted") return null;
  if (item.reportBlockedReason === "on_hold") return "Lumière has paused this course. You can start again when the hold is lifted.";
  if (item.reportBlockedReason === "approval_pending") return "Your advisor must approve this course before you can start it.";
  return null;
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
  title: "Did you finish this at the provider?",
  body:
    "Only say yes if the provider shows the course as finished. This tells Lumière you have finished it; it does not award credit. Our team reviews it before it counts, and you can undo this until then.",
  confirm: "Yes, I finished it",
  button: "I finished this at the provider",
  preNote: "Lumière will review it. Telling us you finished does not award credit.",
  cancel: "Not yet",
} as const;

export function savedMessage(label: string, lang: Language = currentLanguage()): string {
  return djTranslate(lang, "dj.save.saved", { label });
}

export function taskSavedLabel(task: StudentTaskView, status: StudentTaskStatus): string {
  return `you reported ${task.title} ${taskReportedPhrase(status)}`;
}

// ── Counts (never a weighted percentage) ────────────────────────────────────

export interface CountSegment {
  readonly key: "accepted" | "provider" | "progress" | "not_started";
  /** Scoped, student-facing label. "Officially accepted" always says it counts roadmap courses. */
  readonly label: string;
  readonly status: StatusKey;
  readonly value: number;
}

export const COUNT_SCOPE_NOTE =
  "These counts cover roadmap courses only. Credit you already hold is shown separately, below.";

export function countSegments(counts: StudentRoadmapCounts): CountSegment[] {
  return [
    { key: "accepted", label: "Roadmap courses officially accepted", status: "official", value: counts.itemsOfficiallyAccepted },
    { key: "provider", label: "Complete at provider", status: "provider", value: counts.itemsProviderComplete },
    { key: "progress", label: "In progress", status: "progress", value: counts.itemsInProgress },
    { key: "not_started", label: "Not started", status: "notstarted", value: counts.itemsNotStarted },
  ];
}

/** Share of a segment, used ONLY to size the stacked bar. */
export function segmentFraction(value: number, counts: StudentRoadmapCounts): number {
  const total = countSegments(counts).reduce((sum, s) => sum + s.value, 0);
  return total > 0 ? value / total : 0;
}

export function countsSentence(counts: StudentRoadmapCounts): string {
  const noun = counts.itemsTotal === 1 ? "roadmap course" : "roadmap courses";
  const parts = [
    `${counts.itemsOfficiallyAccepted} officially accepted by Lumière`,
    `${counts.itemsProviderComplete} complete at provider`,
    `${counts.itemsInProgress} in progress`,
    `${counts.itemsNotStarted} not started`,
  ];
  return `Your plan has ${counts.itemsTotal} ${noun}: ${parts.join(", ")}.`;
}

export interface PriorCreditBaseline {
  /** Applied academic credits from the canonical record, or null while under review. */
  readonly applied: string | null;
  readonly required: string | null;
  readonly headline: string;
  readonly detail: string;
}

/**
 * The prior-credit baseline: academic credit already APPLIED to the degree
 * (canonical foundation). It is not a roadmap count and is never summed with one.
 */
export function priorCreditBaseline(f: StudentFoundationView): PriorCreditBaseline {
  const applied = formatDecimal(f.ladder.applied);
  const required = formatDecimal(f.ladder.required);
  if (applied === null) {
    return {
      applied: null,
      required,
      headline: "Under review",
      detail: "Lumière is still reviewing your record, so applied credit is not shown yet.",
    };
  }
  return {
    applied,
    required,
    headline: `${applied}${required ? ` of ${required}` : ""} ${required || applied !== "1" ? "credits" : "credit"} applied`,
    detail: "Academic credit from your record that Lumière has already applied to your degree. It is separate from the roadmap courses above.",
  };
}

/** Counts for ONE phase. Always scoped in the wording ("In this phase"). */
export function phaseSummaryLine(phase: StudentRoadmapPhaseView): string {
  const finished = phase.counts.itemsOfficiallyAccepted + phase.counts.itemsProviderComplete;
  const parts = [`In this phase: ${finished} of ${phase.counts.itemsTotal} ${phase.counts.itemsTotal === 1 ? "item" : "items"} finished`];
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
    phases.find((p) => p.state === "also_active") ??
    phases.find((p) => p.state === "upcoming") ??
    phases[phases.length - 1] ??
    null
  );
}

/** Other unfinished phases the student has also started (never labelled "current"). */
export function alsoActivePhases(view: StudentRoadmapView): StudentRoadmapPhaseView[] {
  return sortedPhases(view).filter((p) => p.state === "also_active");
}

export const PHASE_STATE_LABEL: Record<StudentRoadmapPhaseView["state"], string> = {
  complete: "Complete",
  current: "Current phase",
  also_active: "Also active",
  upcoming: "Upcoming",
};

export function phaseStateHelp(state: StudentRoadmapPhaseView["state"]): string | null {
  if (state === "also_active") return "You have started work here too, alongside your current phase.";
  return null;
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

/**
 * Scope-stated, and omitted when it would only repeat the whole-plan count
 * (every unfinished item is before this milestone).
 */
export function milestoneStatusLine(m: StudentRoadmapMilestoneView, view?: StudentRoadmapView): string | null {
  if (m.reached) return "Reached";
  if (m.remainingItems === 0) return "Waiting for Lumière to confirm";
  if (view) {
    const unfinished = view.counts.itemsTotal - view.counts.itemsOfficiallyAccepted - view.counts.itemsProviderComplete;
    if (m.remainingItems === unfinished) return null;
  }
  return `${m.remainingItems} ${m.remainingItems === 1 ? "item" : "items"} to finish first`;
}

// ── Dates ───────────────────────────────────────────────────────────────────

export function formatShortDate(iso: string | null | undefined, lang: "en" | "fr" = "en"): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
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
  /** Status colour of the rung; null for the neutral "reported" total. */
  readonly status: StatusKey | null;
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
    { key: "reported", status: null, label: "Reported", value: ladder.reported, help: "Everything on the documents you provided. The two rows below split it into waiting and verified." },
    { key: "provisional", status: "submitted", label: "Waiting for verification", value: ladder.provisional, help: "Part of the reported total that Lumière has not verified yet." },
    { key: "verified", status: "official", label: "Verified", value: ladder.verified, help: "Part of the reported total that Lumière has checked and accepted." },
    {
      key: "applied",
      status: "applied",
      label: "Applied",
      value: ladder.applied,
      help: ladder.applied === null ? "Shown once Lumière finishes reviewing your record." : "Part of the verified total that counts toward your degree requirements.",
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

/** "69 reported in total: 60 of them verified, 9 waiting for Lumière." Cumulative, never additive across rungs. */
export function ladderTotalsSentence(ladder: Ladder): string {
  const rep = creditsText(ladder.reported) ?? "0 credits";
  const ver = formatDecimal(ladder.verified) ?? "0";
  const wait = formatDecimal(ladder.provisional) ?? "0";
  return `${rep} reported in total: ${ver} of them verified, ${wait} waiting for Lumière to verify.`;
}

export function credentialStandingLabel(standing: StudentFoundationView["credentials"][number]["standing"]): {
  label: string;
  verified: boolean;
  status: StatusKey;
} {
  if (standing === "VERIFIED_APPLIED" || standing === "VERIFIED_NOT_APPLIED") return { label: "Verified", verified: true, status: "official" };
  if (standing === "NOT_ACCEPTED") return { label: "Not accepted", verified: false, status: "attention" };
  return { label: "Waiting for verification", verified: false, status: "submitted" };
}

/** The reportable item to jump to from the "Now" strip: first focus item. */
export function nowTarget(view: StudentRoadmapView): StudentRoadmapItemView | null {
  return focusItems(view)[0] ?? null;
}

/** Student-facing program name: the primary objective's canonical program, else its title. */
export function primaryObjectiveTitle(view: StudentRoadmapView): string | null {
  const primary = view.objectives.find((o) => o.kind === "primary");
  return primary ? (primary.canonicalProgramName ?? primary.title) : null;
}

/** Credits the degree still needs that no roadmap item covers: required - applied - planned, only when > 0. */
export function stillToPlan(ladder: StudentFoundationView["ladder"]): string | null {
  const req = toHundredths(ladder.required);
  const applied = toHundredths(ladder.applied);
  const planned = toHundredths(ladder.planned);
  if (req === null || applied === null || planned === null) return null;
  const gap = req - applied - planned;
  return gap > 0 ? fromHundredths(gap) : null;
}

/**
 * Credit on the ladder that belongs to no listed credential (credit from other
 * courses on the record). Derived only from ladder + credential amounts.
 */
export function otherCreditNote(f: StudentFoundationView): string | null {
  const sum = (xs: (string | null)[]) => xs.reduce<number>((n, v) => n + (toHundredths(v) ?? 0), 0);
  const verifiedListed = sum(f.credentials.filter((c) => c.standing === "VERIFIED_APPLIED" || c.standing === "VERIFIED_NOT_APPLIED").map((c) => c.awardedCredits));
  const waitingListed = sum(f.credentials.filter((c) => c.standing === "PENDING_VERIFICATION" || c.standing === "NEEDS_REVIEW").map((c) => c.reportedCredits));
  const verifiedOther = (toHundredths(f.ladder.verified) ?? 0) - verifiedListed;
  const waitingOther = (toHundredths(f.ladder.provisional) ?? 0) - waitingListed;
  const parts: string[] = [];
  if (verifiedOther > 0) parts.push(`${fromHundredths(verifiedOther)} more verified ${fromHundredths(verifiedOther) === "1" ? "credit" : "credits"}`);
  if (waitingOther > 0) parts.push(`${fromHundredths(waitingOther)} ${fromHundredths(waitingOther) === "1" ? "credit" : "credits"} waiting for verification`);
  return parts.length ? `Plus ${parts.join(" and ")} from other courses on your record.` : null;
}
