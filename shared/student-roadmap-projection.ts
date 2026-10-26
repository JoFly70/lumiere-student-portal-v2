/**
 * S05 — pure projection of a roadmap version + student progress + canonical
 * degree progress into the student-facing StudentRoadmapView.
 *
 * No I/O, no clocks, no randomness. staffNote and linkedCreditRecordId are
 * never copied into the view. Credit figures come only from the S04
 * StudentDegreeProgressView (exact decimals, never floats); the roadmap
 * stores and computes no credit of its own. No weighted percentages anywhere.
 */
import {
  ITEM_LEVEL_TASK_KEY,
  STUDENT_ROADMAP_CONTRACT,
  studentItemStatusSchema,
  studentTaskStatusSchema,
  type RoadmapContent,
  type RoadmapItem,
  type RoadmapProgressRecord,
  type StudentFoundationView,
  type StudentItemStage,
  type StudentItemStatus,
  type StudentRoadmapCounts,
  type StudentRoadmapItemView,
  type StudentRoadmapMilestoneView,
  type StudentRoadmapObjectiveView,
  type StudentRoadmapPhaseView,
  type StudentRoadmapView,
  type StudentTaskStatus,
  type StudentTaskView,
  type StudentTodayView,
} from "./student-roadmap-contract";
import type { StudentCreditStanding, StudentDegreeProgressView } from "./student-degree-progress-view";

export interface ProjectStudentRoadmapInput {
  /** Null when nothing is published (and for a missing draft). */
  readonly content: RoadmapContent | null;
  readonly versionNumber: number;
  readonly publishedAt: string | null;
  readonly preview: boolean;
  readonly progress: readonly RoadmapProgressRecord[];
  readonly degreeProgress: StudentDegreeProgressView | null;
  readonly previousVersions: StudentRoadmapView["history"]["previousVersions"];
  /** Titles of items no longer in the plan, for the retired-progress list. */
  readonly retiredTitles?: Readonly<Record<string, string>>;
}

// ── exact decimals (hundredths) ──────────────────────────────────────────────

const DECIMAL_PATTERN = /^\d{1,12}(?:\.\d{1,6})?$/;

function toHundredths(value: string | null | undefined): bigint | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!DECIMAL_PATTERN.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  if (/[1-9]/.test(fraction.slice(2))) return null;
  return BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, "0"));
}

function format2dp(value: bigint): string {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const EMPTY_COUNTS: StudentRoadmapCounts = {
  itemsTotal: 0,
  itemsOfficiallyAccepted: 0,
  itemsProviderComplete: 0,
  itemsInProgress: 0,
  itemsNotStarted: 0,
  tasksTotal: 0,
  tasksGraded: 0,
  tasksSubmitted: 0,
};

// ── per-item derivation ──────────────────────────────────────────────────────

interface DerivedItem {
  readonly item: RoadmapItem;
  readonly tasks: StudentTaskView[];
  readonly itemStatus: StudentItemStatus;
  readonly itemRevision: number;
  readonly stage: StudentItemStage;
  readonly official: StudentRoadmapItemView["official"];
  readonly active: boolean;
  readonly done: boolean;
}

const isActive = (item: RoadmapItem) => item.planStatus === "planned" || item.planStatus === "hold";

function parseTaskStatus(value: string | undefined): StudentTaskStatus {
  const parsed = studentTaskStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : "not_started";
}

function parseItemStatus(value: string | undefined): StudentItemStatus {
  const parsed = studentItemStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : "not_started";
}

function deriveStage(
  official: StudentRoadmapItemView["official"],
  itemStatus: StudentItemStatus,
  tasks: readonly StudentTaskView[],
): StudentItemStage {
  if (official && (official.standing === "VERIFIED_APPLIED" || official.standing === "VERIFIED_NOT_APPLIED")) {
    return "officially_accepted";
  }
  if (itemStatus === "provider_complete") return "provider_complete";
  if (tasks.length > 0 && tasks.every((t) => t.status === "graded")) return "graded";
  if (tasks.length > 0 && tasks.every((t) => t.status === "submitted" || t.status === "graded")) return "submitted";
  if (tasks.some((t) => t.status !== "not_started") || itemStatus === "in_progress") return "in_progress";
  return "not_started";
}

function countsFor(derived: readonly DerivedItem[]): StudentRoadmapCounts {
  const active = derived.filter((d) => d.active);
  let tasksTotal = 0;
  let tasksGraded = 0;
  let tasksSubmitted = 0;
  for (const d of active) {
    tasksTotal += d.tasks.length;
    tasksGraded += d.tasks.filter((t) => t.status === "graded").length;
    tasksSubmitted += d.tasks.filter((t) => t.status === "submitted").length;
  }
  return {
    itemsTotal: active.length,
    itemsOfficiallyAccepted: active.filter((d) => d.stage === "officially_accepted").length,
    itemsProviderComplete: active.filter((d) => d.stage === "provider_complete").length,
    itemsInProgress: active.filter((d) => d.stage === "in_progress" || d.stage === "submitted" || d.stage === "graded").length,
    itemsNotStarted: active.filter((d) => d.stage === "not_started").length,
    tasksTotal,
    tasksGraded,
    tasksSubmitted,
  };
}

// ── foundation ───────────────────────────────────────────────────────────────

function buildFoundation(
  degree: StudentDegreeProgressView | null,
  plannedHundredths: bigint,
): StudentFoundationView {
  const credits = degree?.credits ?? [];
  const sources = degree?.sources ?? [];
  const sourceById = new Map(sources.map((s) => [s.sourceId, s]));

  const credentials = credits
    .filter((c) => c.recordType === "credential_award")
    .map((c) => {
      const source = c.sourceId ? sourceById.get(c.sourceId) : undefined;
      return {
        creditRecordId: c.creditRecordId,
        title: c.title,
        completedOn: c.completedOn,
        reportedCredits: c.reportedCredits,
        awardedCredits: c.awardedCredits,
        standing: c.standing,
        sourceTitle: source?.title ?? null,
        sourceType: source?.sourceType ?? null,
      };
    });

  let reported = 0n;
  let provisional = 0n;
  let verified = 0n;
  for (const c of credits) {
    const rep = toHundredths(c.reportedCredits) ?? 0n;
    if (c.standing !== "NOT_ACCEPTED") reported += rep;
    if (c.standing === "PENDING_VERIFICATION" || c.standing === "NEEDS_REVIEW") provisional += rep;
    if (c.standing === "VERIFIED_APPLIED" || c.standing === "VERIFIED_NOT_APPLIED") {
      verified += toHundredths(c.awardedCredits) ?? 0n;
    }
  }
  const applied = toHundredths(degree?.totals?.appliedCredits ?? null);
  const required = toHundredths(degree?.totals?.requiredCredits ?? null);
  const surplus = applied === null ? null : verified > applied ? verified - applied : 0n;

  return {
    credentials,
    sources: sources.map((s) => ({
      sourceId: s.sourceId,
      title: s.title,
      sourceType: s.sourceType,
      status: s.status,
      creditRecordCount: s.creditRecordCount,
    })),
    ladder: {
      reported: format2dp(reported),
      provisional: format2dp(provisional),
      verified: format2dp(verified),
      applied: applied === null ? null : format2dp(applied),
      surplus: surplus === null ? null : format2dp(surplus),
      planned: format2dp(plannedHundredths),
      required: required === null ? null : format2dp(required),
    },
    degreeState: degree?.state ?? "NO_ACTIVE_PROGRAM",
  };
}

// ── main ─────────────────────────────────────────────────────────────────────

export function projectStudentRoadmap(input: ProjectStudentRoadmapInput): StudentRoadmapView {
  const { content, degreeProgress } = input;
  const previousVersions = input.previousVersions;
  const creditById = new Map((degreeProgress?.credits ?? []).map((c) => [c.creditRecordId, c]));

  if (!content) {
    return {
      contractVersion: STUDENT_ROADMAP_CONTRACT,
      state: "NOT_PUBLISHED",
      preview: input.preview,
      plan: null,
      objectives: [],
      phases: [],
      milestones: [],
      counts: EMPTY_COUNTS,
      today: {
        focusItemKeys: [],
        headline: "Your roadmap is being prepared",
        detail: "Your Lumière advisor is preparing your roadmap. It will appear here as soon as it is published.",
        nextMilestoneKey: null,
      },
      foundation: buildFoundation(degreeProgress, 0n),
      history: { previousVersions, retiredProgress: [] },
    };
  }

  // progress index
  const progressByItem = new Map<string, Map<string, RoadmapProgressRecord>>();
  for (const row of input.progress) {
    let m = progressByItem.get(row.itemKey);
    if (!m) progressByItem.set(row.itemKey, (m = new Map()));
    m.set(row.taskKey, row);
  }

  const phaseSeq = new Map(content.phases.map((p) => [p.key, p.sequence]));
  const orderItems = (a: RoadmapItem, b: RoadmapItem) =>
    (phaseSeq.get(a.phaseKey) ?? 0) - (phaseSeq.get(b.phaseKey) ?? 0)
    || a.sequence - b.sequence
    || cmp(a.key, b.key);

  const derivedByKey = new Map<string, DerivedItem>();
  for (const item of content.items) {
    const rows = progressByItem.get(item.key);
    const itemRow = rows?.get(ITEM_LEVEL_TASK_KEY);
    const itemStatus = parseItemStatus(itemRow?.status);
    const tasks: StudentTaskView[] = [...item.tasks]
      .sort((a, b) => a.sequence - b.sequence || cmp(a.key, b.key))
      .map((task) => {
        const row = rows?.get(task.key);
        return {
          key: task.key,
          kind: task.kind,
          title: task.title,
          status: parseTaskStatus(row?.status),
          revision: row?.revision ?? 0,
          updatedAt: row?.updatedAt ?? null,
        };
      });
    const credit = item.linkedCreditRecordId ? creditById.get(item.linkedCreditRecordId) : undefined;
    const official = credit
      ? { standing: credit.standing as StudentCreditStanding, awardedCredits: credit.awardedCredits }
      : null;
    const stage = deriveStage(official, itemStatus, tasks);
    derivedByKey.set(item.key, {
      item,
      tasks,
      itemStatus,
      itemRevision: itemRow?.revision ?? 0,
      stage,
      official,
      active: isActive(item),
      done: stage === "officially_accepted" || stage === "provider_complete",
    });
  }
  const isDone = (key: string) => derivedByKey.get(key)?.done === true;

  const itemView = (d: DerivedItem): StudentRoadmapItemView => {
    const item = d.item;
    const waitingOn = item.dependsOn
      .filter((key) => derivedByKey.has(key) && !isDone(key))
      .map((key) => ({ itemKey: key, title: derivedByKey.get(key)!.item.title }));
    return {
      key: item.key,
      phaseKey: item.phaseKey,
      objectiveKey: item.objectiveKey,
      sequence: item.sequence,
      kind: item.kind,
      code: item.code ?? null,
      title: item.title,
      provider: item.provider ?? null,
      institution: item.institution ?? null,
      credits: item.credits ?? null,
      plannedStart: item.plannedStart ?? null,
      plannedEnd: item.plannedEnd ?? null,
      planStatus: item.planStatus,
      holdReason: item.hold?.reason ?? null,
      approval: item.approval ? { required: item.approval.required, status: item.approval.status } : null,
      alternativeOf: item.alternativeOf ?? null,
      studentNote: item.studentNote ?? null,
      waitingOn,
      itemStatus: d.itemStatus,
      itemRevision: d.itemRevision,
      tasks: d.tasks,
      taskCounts: {
        total: d.tasks.length,
        graded: d.tasks.filter((t) => t.status === "graded").length,
        submitted: d.tasks.filter((t) => t.status === "submitted").length,
        inProgress: d.tasks.filter((t) => t.status === "in_progress").length,
        notStarted: d.tasks.filter((t) => t.status === "not_started").length,
      },
      stage: d.stage,
      official: d.official,
      canReport: d.active,
    };
  };

  const sortedItems = [...content.items].sort(orderItems);
  const allDerived = sortedItems.map((i) => derivedByKey.get(i.key)!);
  const views = new Map(allDerived.map((d) => [d.item.key, itemView(d)]));

  // phases
  const sortedPhases = [...content.phases].sort((a, b) => a.sequence - b.sequence || cmp(a.key, b.key));
  const phaseDerived = sortedPhases.map((p) => allDerived.filter((d) => d.item.phaseKey === p.key));
  let currentAssigned = false;
  const phases: StudentRoadmapPhaseView[] = sortedPhases.map((phase, idx) => {
    const members = phaseDerived[idx];
    const active = members.filter((d) => d.active);
    const complete = active.length > 0 && active.every((d) => d.done);
    let state: StudentRoadmapPhaseView["state"];
    if (complete) state = "complete";
    else if (!currentAssigned) {
      state = "current";
      currentAssigned = true;
    } else state = "upcoming";
    return {
      key: phase.key,
      title: phase.title,
      sequence: phase.sequence,
      objectiveKey: phase.objectiveKey ?? null,
      startDate: phase.startDate ?? null,
      endDate: phase.endDate ?? null,
      description: phase.description ?? null,
      items: members.map((d) => views.get(d.item.key)!),
      counts: countsFor(members),
      state,
    };
  });

  // objectives
  const objectives: StudentRoadmapObjectiveView[] = content.objectives.map((o) => ({
    key: o.key,
    title: o.title,
    kind: o.kind,
    institution: o.institution ?? null,
    credentialLabel: o.credentialLabel ?? null,
    status: o.status,
    note: o.note ?? null,
    canonicalProgramName:
      o.kind === "primary" && o.linkedToProgramAssignment ? degreeProgress?.program?.programName ?? null : null,
    counts: countsFor(allDerived.filter((d) => d.item.objectiveKey === o.key)),
  }));

  // milestones
  const milestoneOrder = content.milestones.map((m, order) => ({ m, order }));
  milestoneOrder.sort((a, b) => {
    const ad = a.m.targetDate ?? null;
    const bd = b.m.targetDate ?? null;
    if (ad !== bd) {
      if (ad === null) return 1;
      if (bd === null) return -1;
      return cmp(ad, bd);
    }
    return a.order - b.order;
  });
  const milestones: StudentRoadmapMilestoneView[] = milestoneOrder.map(({ m }) => {
    let reached: boolean;
    let remaining: number;
    if (m.afterItemKeys.length > 0) {
      remaining = m.afterItemKeys.filter((k) => !isDone(k)).length;
      reached = remaining === 0;
    } else {
      const scope = allDerived.filter((d) => d.active && (!m.objectiveKey || d.item.objectiveKey === m.objectiveKey));
      remaining = scope.filter((d) => !d.done).length;
      reached = scope.length > 0 && remaining === 0;
    }
    return {
      key: m.key,
      title: m.title,
      kind: m.kind,
      targetDate: m.targetDate ?? null,
      objectiveKey: m.objectiveKey ?? null,
      reached,
      remainingItems: remaining,
    };
  });

  // today
  const activeDerived = allDerived.filter((d) => d.active);
  const working = activeDerived.filter((d) => d.stage === "in_progress" || d.stage === "submitted" || d.stage === "graded");
  const startable = activeDerived.filter(
    (d) => d.item.planStatus === "planned" && d.stage === "not_started"
      && views.get(d.item.key)!.waitingOn.length === 0,
  );
  const focus = [...working, ...startable].slice(0, 3);
  const nextMilestone = milestones.find((m) => !m.reached) ?? null;
  const tasksRemaining = (d: DerivedItem) => d.tasks.filter((t) => t.status !== "graded").length;

  let headline: string;
  let detail: string;
  if (activeDerived.length === 0) {
    headline = "Your roadmap has no active courses yet";
    detail = "Your Lumière advisor will add courses here.";
  } else if (activeDerived.every((d) => d.done)) {
    const awaiting = activeDerived.filter((d) => d.stage !== "officially_accepted").length;
    headline = "Every planned course is complete";
    detail = awaiting > 0
      ? `${awaiting} ${awaiting === 1 ? "course is" : "courses are"} awaiting official acceptance by Lumière.`
      : "Every course has been officially accepted.";
  } else if (focus.length > 0) {
    const first = focus[0];
    const remaining = tasksRemaining(first);
    const isWorking = first.stage !== "not_started";
    headline = `${isWorking ? "Continue" : "Start"} ${first.item.title}`;
    if (first.tasks.length === 0) {
      detail = isWorking ? "Keep going and mark the course complete when you finish it." : "Begin when you are ready.";
    } else if (remaining === 0) {
      detail = "All tasks are graded. Mark the course complete when you finish it at the provider.";
    } else {
      detail = `${remaining} ${remaining === 1 ? "task" : "tasks"} remaining.`;
    }
  } else {
    headline = "Waiting on earlier courses";
    detail = "Your next courses unlock when the courses they depend on are complete.";
  }
  const today: StudentTodayView = {
    focusItemKeys: focus.map((d) => d.item.key),
    headline,
    detail,
    nextMilestoneKey: nextMilestone?.key ?? null,
  };

  // foundation
  let planned = 0n;
  for (const d of activeDerived) {
    if (d.stage !== "officially_accepted") planned += toHundredths(d.item.credits ?? null) ?? 0n;
  }

  // retired progress
  const retired: StudentRoadmapView["history"]["retiredProgress"][number][] = [];
  const contentKeys = new Set(content.items.map((i) => i.key));
  for (const key of [...progressByItem.keys()].sort()) {
    if (contentKeys.has(key)) continue;
    const rows = progressByItem.get(key)!;
    const itemRow = rows.get(ITEM_LEVEL_TASK_KEY);
    let tasksGraded = 0;
    for (const [taskKey, row] of rows) {
      if (taskKey !== ITEM_LEVEL_TASK_KEY && row.status === "graded") tasksGraded++;
    }
    retired.push({
      itemKey: key,
      title: input.retiredTitles?.[key] ?? null,
      itemStatus: itemRow ? parseItemStatus(itemRow.status) : null,
      tasksGraded,
    });
  }

  return {
    contractVersion: STUDENT_ROADMAP_CONTRACT,
    state: "PUBLISHED",
    preview: input.preview,
    plan: {
      title: content.title,
      summary: content.summary ?? null,
      versionNumber: input.versionNumber,
      publishedAt: input.publishedAt,
    },
    objectives,
    phases,
    milestones,
    counts: countsFor(allDerived),
    today,
    foundation: buildFoundation(degreeProgress, planned),
    history: { previousVersions, retiredProgress: retired },
  };
}
