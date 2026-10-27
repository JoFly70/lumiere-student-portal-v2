/**
 * S11 — High School Pathway: PURE projection and validation functions.
 *
 * No database or server imports: the server service, the UI and the unit tests
 * all use the same code. Everything is deterministic given its inputs (the
 * clock is always injected as `nowIso`).
 *
 * Doctrine encoded here:
 *   - credit comes only from ACTIVE awards, in integer half-units;
 *   - a student report (in_progress / submitted / a score) is never official;
 *   - the student view carries a generic school description until disclosure.
 */
import { z } from "zod";
import { effectiveContactScopes, type ContactAuthorityStatus } from "./student-profile-contract";
import {
  GENERIC_SCHOOL_DESCRIPTION,
  HS_REQUIREMENT_KINDS,
  HS_SUBJECT_AREAS,
  hsPolicySchema,
  HS_SUBJECT_LABELS,
  NO_POLICIES,
  formatHalfUnits,
  halfUnitPercent,
  sumHalfUnits,
  type HalfUnits,
  type HsAttentionItem,
  type HsCourseDisplayStatus,
  type HsCourseView,
  type HsCreditSummary,
  type HsCurriculumTemplate,
  type HsEnrollmentStatus,
  type HsFinancialClearance,
  type HsGraduationStatus,
  type HsGraduationView,
  type HsGuardianView,
  type HsOfficialCourseOutcome,
  type HsOfficialTaskOutcome,
  type HsPolicies,
  type HsRequirementArea,
  type HsReportedStatus,
  type HsReviewQueueItem,
  type HsRoadmapContent,
  type HsSubjectArea,
  type HsSubjectView,
  type HsTaskDisplayStatus,
  type HsTaskView,
  type HsDeliveryStatus,
  type PriorEducationStatus,
  type StudentHighSchoolView,
  type TransferClaimStatus,
} from "./high-school-contract";

// ---------------------------------------------------------------------------
// Input records (plain data; the service maps DB rows into these)
// ---------------------------------------------------------------------------

export interface HsProgressRecord {
  readonly courseKey: string;
  readonly taskKey: string;
  readonly status: HsReportedStatus;
  readonly reportedScorePercent: number | null;
  readonly note: string | null;
  readonly revision: number;
  readonly updatedAt: string;
}

/** An ACTIVE official task result. */
export interface HsTaskResultRecord {
  readonly courseKey: string;
  readonly taskKey: string;
  readonly outcome: HsOfficialTaskOutcome;
  readonly scorePercent: number | null;
  readonly recordedAt: string;
}

/** An ACTIVE official course result. */
export interface HsCourseResultRecord {
  readonly courseKey: string;
  readonly outcome: HsOfficialCourseOutcome;
  readonly recordedAt: string;
}

export interface HsAwardRecord {
  readonly id: string;
  readonly source: "course_completion" | "transfer";
  readonly courseKey: string | null;
  readonly areaKey: string;
  readonly halfUnits: HalfUnits;
  readonly status: "active" | "voided";
}

export interface HsGraduationRecordInput {
  readonly status: HsGraduationStatus;
  readonly eligibilityConfirmedAt: string | null;
  readonly eligibilityEvidenceDocumentId: string | null;
  readonly conferredOn: string | null;
  readonly diplomaEvidenceDocumentId: string | null;
  readonly transcriptEvidenceDocumentId: string | null;
  readonly transcriptStatus: HsDeliveryStatus;
  readonly diplomaDeliveryStatus: HsDeliveryStatus;
  readonly financialClearance: HsFinancialClearance;
}

export interface HsPriorEducationInput {
  readonly id: string;
  readonly schoolName: string;
  readonly status: PriorEducationStatus;
  readonly claims: readonly {
    readonly id: string;
    readonly courseTitle: string;
    readonly claimedHalfUnits: HalfUnits;
    readonly acceptedHalfUnits?: HalfUnits | null;
    readonly status: TransferClaimStatus;
  }[];
}

export interface HsProjectionInput {
  readonly enrollment: {
    readonly id: string;
    readonly status: HsEnrollmentStatus;
    readonly programTitle: string;
    readonly startedOn: string | null;
    readonly targetCompletionDate: string | null;
    readonly institutionDisclosed: boolean;
    readonly awardingSchoolName: string | null;
    readonly totalRequiredHalfUnits: HalfUnits;
  };
  /** Areas used when no roadmap is published yet (the template's areas, adjusted to the total). */
  readonly fallbackAreas: readonly HsRequirementArea[];
  readonly roadmap: { readonly versionNumber: number; readonly publishedAt: string; readonly content: HsRoadmapContent } | null;
  readonly progress: readonly HsProgressRecord[];
  readonly taskResults: readonly HsTaskResultRecord[];
  readonly courseResults: readonly HsCourseResultRecord[];
  readonly awards: readonly HsAwardRecord[];
  readonly priorEducation: readonly HsPriorEducationInput[];
  readonly graduation: HsGraduationRecordInput | null;
  readonly guardians: readonly HsGuardianView[];
  readonly nowIso: string;
}

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

/**
 * Credit summary from ACTIVE awards only. Per area the counted credit is
 * min(earned, required): surplus in one area never counts toward another.
 * `earnedHalfUnits` is the total of all active awards; core/elective earned
 * are the counted (capped) amounts of their areas.
 */
export function computeCreditSummary(
  areas: readonly HsRequirementArea[],
  totalRequiredHalfUnits: HalfUnits,
  awards: readonly HsAwardRecord[],
  awaitingConfirmationHalfUnits = 0,
): HsCreditSummary {
  const active = awards.filter((a) => a.status === "active");
  const earnedByArea = new Map<string, number>();
  for (const a of active) earnedByArea.set(a.areaKey, (earnedByArea.get(a.areaKey) ?? 0) + a.halfUnits);

  const byArea = areas.map((a) => {
    const earned = earnedByArea.get(a.key) ?? 0;
    return {
      key: a.key,
      label: a.label,
      kind: a.kind,
      subject: a.subject,
      requiredHalfUnits: a.requiredHalfUnits,
      earnedHalfUnits: earned,
      countedHalfUnits: Math.min(earned, a.requiredHalfUnits),
    };
  });
  const earned = sumHalfUnits(active.map((a) => a.halfUnits));
  const coreAreas = byArea.filter((a) => a.kind === "core");
  const electiveAreas = byArea.filter((a) => a.kind === "elective");
  return {
    requiredHalfUnits: totalRequiredHalfUnits,
    earnedHalfUnits: earned,
    remainingHalfUnits: Math.max(0, totalRequiredHalfUnits - earned),
    awaitingConfirmationHalfUnits,
    core: {
      requiredHalfUnits: sumHalfUnits(coreAreas.map((a) => a.requiredHalfUnits)),
      earnedHalfUnits: sumHalfUnits(coreAreas.map((a) => a.countedHalfUnits)),
    },
    elective: {
      requiredHalfUnits: sumHalfUnits(electiveAreas.map((a) => a.requiredHalfUnits)),
      earnedHalfUnits: sumHalfUnits(electiveAreas.map((a) => a.countedHalfUnits)),
    },
    byArea,
    percentComplete: halfUnitPercent(Math.min(earned, totalRequiredHalfUnits), totalRequiredHalfUnits),
  };
}

/**
 * Why a diploma cannot be confirmed yet; empty = credits satisfied.
 * The overall check uses the sum of per-area COUNTED credit (min(earned, required)),
 * so surplus in one area can never satisfy the total. `earnedHalfUnits` stays the
 * raw official sum for display.
 */
export function creditBlockers(credits: HsCreditSummary): string[] {
  const blockers: string[] = [];
  const counted = sumHalfUnits(credits.byArea.map((a) => a.countedHalfUnits));
  if (counted < credits.requiredHalfUnits) {
    const surplus = credits.earnedHalfUnits > counted;
    blockers.push(
      `Earned ${formatHalfUnits(counted)} of ${formatHalfUnits(credits.requiredHalfUnits)} required credits` +
        (surplus ? " (credit above an area's requirement does not count toward another area)" : ""),
    );
  }
  // Every area must be met: surplus core credit never silently fills an elective
  // shortfall. When the school counts an extra course as an elective, staff record
  // that award under the elective area.
  for (const a of credits.byArea) {
    if (a.earnedHalfUnits < a.requiredHalfUnits) {
      blockers.push(
        `${a.kind === "core" ? "Core area" : "Elective area"} ${a.label}: ${formatHalfUnits(a.earnedHalfUnits)} of ${formatHalfUnits(a.requiredHalfUnits)} credits`,
      );
    }
  }
  return blockers;
}

// ---------------------------------------------------------------------------
// Dates and policies
// ---------------------------------------------------------------------------

export const todayOf = (nowIso: string): string => nowIso.slice(0, 10);
const monthOf = (nowIso: string): string => nowIso.slice(0, 7);

/** Policies are enforced only when explicitly configured; null/absent means "not configured". */
export function effectivePolicies(content: HsRoadmapContent | null | undefined): HsPolicies {
  return content?.policies ?? NO_POLICIES;
}

// ---------------------------------------------------------------------------
// Tasks and courses
// ---------------------------------------------------------------------------

function latestBy<T extends { readonly recordedAt: string }>(items: readonly T[]): T | null {
  let best: T | null = null;
  for (const it of items) if (!best || it.recordedAt >= best.recordedAt) best = it;
  return best;
}

const OFFICIAL_DISPLAY: Record<HsOfficialTaskOutcome, HsTaskDisplayStatus> = {
  passed: "official_passed",
  failed: "official_failed",
  retake_required: "retake_required",
};

/** What the student sees for one task. A report never becomes official. */
export function taskDisplayStatus(
  progress: Pick<HsProgressRecord, "status" | "reportedScorePercent" | "updatedAt"> | null,
  official: Pick<HsTaskResultRecord, "outcome" | "recordedAt"> | null,
): HsTaskDisplayStatus {
  if (official && official.outcome === "passed") return "official_passed";
  if (official && (!progress || progress.updatedAt <= official.recordedAt)) return OFFICIAL_DISPLAY[official.outcome];
  if (!progress) return "not_started";
  if (progress.status === "submitted" || progress.reportedScorePercent !== null) return "pending_review";
  return progress.status === "in_progress" ? "in_progress" : "not_started";
}

type CourseWithTasks = HsRoadmapContent["courses"][number];

function buildTaskViews(
  course: CourseWithTasks,
  progress: readonly HsProgressRecord[],
  taskResults: readonly HsTaskResultRecord[],
  today: string,
): HsTaskView[] {
  return course.tasks.map((t) => {
    const p = progress.find((x) => x.courseKey === course.key && x.taskKey === t.key) ?? null;
    const official = latestBy(taskResults.filter((r) => r.courseKey === course.key && r.taskKey === t.key));
    const status = taskDisplayStatus(p, official);
    const open = status === "not_started" || status === "in_progress" || status === "official_failed" || status === "retake_required";
    return {
      key: t.key,
      kind: t.kind,
      title: t.title,
      dueDate: t.dueDate,
      status,
      reportedScorePercent: p?.reportedScorePercent ?? null,
      officialScorePercent: official?.scorePercent ?? null,
      progressRevision: p?.revision ?? 0,
      overdue: open && t.dueDate !== null && t.dueDate < today,
    };
  });
}

/** Course status from the tasks and the official course result. */
export function courseDisplayStatus(
  planStatus: CourseWithTasks["status"],
  tasks: readonly HsTaskView[],
  courseResult: Pick<HsCourseResultRecord, "outcome"> | null,
): HsCourseDisplayStatus {
  if (courseResult?.outcome === "completed") return "official_complete";
  if (planStatus !== "planned") return "replaced";
  if (courseResult?.outcome === "not_passed") return "not_passed";
  if (tasks.length > 0 && tasks.every((t) => t.status === "pending_review" || t.status === "official_passed")) {
    return "awaiting_school";
  }
  if (tasks.some((t) => t.status !== "not_started")) return "in_progress";
  return "not_started";
}

export function buildCourseViews(
  content: HsRoadmapContent,
  progress: readonly HsProgressRecord[],
  taskResults: readonly HsTaskResultRecord[],
  courseResults: readonly HsCourseResultRecord[],
  nowIso: string,
): HsCourseView[] {
  const today = todayOf(nowIso);
  const areaByKey = new Map(content.areas.map((a) => [a.key, a]));
  return content.courses.map((c) => {
    const area = areaByKey.get(c.areaKey);
    const tasks = buildTaskViews(c, progress, taskResults, today);
    const result = latestBy(courseResults.filter((r) => r.courseKey === c.key));
    return {
      key: c.key,
      title: c.title,
      areaKey: c.areaKey,
      subject: (area?.subject ?? "electives") as HsSubjectArea,
      kind: area?.kind ?? "elective",
      halfUnits: c.halfUnits,
      status: courseDisplayStatus(c.status, tasks, result),
      plannedStart: c.plannedStart,
      plannedEnd: c.plannedEnd,
      replacesCourseKey: c.replacesCourseKey,
      tasks,
      tasksDone: tasks.filter((t) => t.status === "official_passed").length,
      tasksTotal: tasks.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Pace
// ---------------------------------------------------------------------------

/**
 * Milestone "2026-12: 10" = 10 half-units cumulative expected by the END of
 * December 2026. The expectation "by now" is the latest milestone in a month
 * that has already ended (strictly before the current month); the next
 * milestone is the first one in the current month or later.
 */
export function computePace(
  content: HsRoadmapContent | null,
  earnedHalfUnits: HalfUnits,
  nowIso: string,
): StudentHighSchoolView["pace"] {
  const milestones = [...(content?.pacing.milestones ?? [])].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  const weekly = content?.pacing.weeklyTargetHalfUnits ?? null;
  if (milestones.length === 0) {
    return { weeklyTargetHalfUnits: weekly, expectedByNowHalfUnits: null, status: "not_configured", nextMilestone: null };
  }
  const month = monthOf(nowIso);
  const past = milestones.filter((m) => m.month < month);
  const expected = past.length > 0 ? past[past.length - 1].cumulativeHalfUnits : 0;
  const next = milestones.find((m) => m.month >= month) ?? null;
  const status = earnedHalfUnits < expected ? "behind" : earnedHalfUnits > expected ? "ahead" : "on_track";
  return {
    weeklyTargetHalfUnits: weekly,
    expectedByNowHalfUnits: expected,
    status,
    nextMilestone: next ? { month: next.month, cumulativeHalfUnits: next.cumulativeHalfUnits } : null,
  };
}

// ---------------------------------------------------------------------------
// Graduation
// ---------------------------------------------------------------------------

const EMPTY_GRADUATION: HsGraduationRecordInput = {
  status: "in_progress",
  eligibilityConfirmedAt: null,
  eligibilityEvidenceDocumentId: null,
  conferredOn: null,
  diplomaEvidenceDocumentId: null,
  transcriptEvidenceDocumentId: null,
  transcriptStatus: "not_requested",
  diplomaDeliveryStatus: "not_requested",
  financialClearance: "unknown",
};

export function projectGraduationView(
  record: HsGraduationRecordInput | null,
  credits: HsCreditSummary,
  courses: readonly HsCourseView[],
): HsGraduationView {
  const g = record ?? EMPTY_GRADUATION;
  const live = courses.filter((c) => c.status !== "replaced" && c.status !== "official_complete");
  const outstanding = (kind: "exam" | "project") =>
    live.reduce((n, c) => n + c.tasks.filter((t) => t.kind === kind && t.status !== "official_passed").length, 0);
  return {
    status: g.status,
    creditsSatisfied: creditBlockers(credits).length === 0,
    outstandingExams: outstanding("exam"),
    outstandingProjects: outstanding("project"),
    eligibilityConfirmedAt: g.eligibilityConfirmedAt,
    financialClearance: g.financialClearance === "unknown" ? null : g.financialClearance,
    transcript: { status: g.transcriptStatus, documentId: g.transcriptEvidenceDocumentId },
    diploma: { status: g.diplomaDeliveryStatus, conferredOn: g.conferredOn, documentId: g.diplomaEvidenceDocumentId },
  };
}

// ---------------------------------------------------------------------------
// Student projection
// ---------------------------------------------------------------------------

type TaskWithCourse = HsTaskView & { readonly courseKey: string; readonly courseTitle: string };

/** The institution name is shown only once staff disclosed it AND the enrollment is confirmed. */
export function schoolDisplayNameFor(e: {
  readonly institutionDisclosed: boolean;
  readonly awardingSchoolName: string | null;
  readonly status: HsEnrollmentStatus;
}): { name: string; disclosed: boolean } {
  const disclosed = e.institutionDisclosed && !!e.awardingSchoolName && (e.status === "active" || e.status === "completed");
  return { name: disclosed ? (e.awardingSchoolName as string) : GENERIC_SCHOOL_DESCRIPTION, disclosed };
}

export function projectStudentView(input: HsProjectionInput): StudentHighSchoolView {
  const content = input.roadmap?.content ?? null;
  const areas: readonly HsRequirementArea[] = content?.areas ?? input.fallbackAreas;
  const courses = content
    ? buildCourseViews(content, input.progress, input.taskResults, input.courseResults, input.nowIso)
    : [];

  const awaitingHalf = sumHalfUnits(courses.filter((c) => c.status === "awaiting_school").map((c) => c.halfUnits));
  const credits = computeCreditSummary(areas, input.enrollment.totalRequiredHalfUnits, input.awards, awaitingHalf);
  const pace = computePace(content, credits.earnedHalfUnits, input.nowIso);

  const live = courses.filter((c) => c.status !== "replaced");
  const withCourse = (c: HsCourseView, t: HsTaskView): TaskWithCourse => ({ ...t, courseKey: c.key, courseTitle: c.title });
  const awaitingGrade = live.flatMap((c) => c.tasks.filter((t) => t.status === "pending_review").map((t) => withCourse(c, t)));
  const writtenProjects = live.flatMap((c) => c.tasks.filter((t) => t.kind === "project").map((t) => withCourse(c, t)));

  const currentCourse =
    live.find((c) => c.status === "in_progress") ??
    live.find((c) => c.status === "awaiting_school") ??
    live.find((c) => c.status === "not_started") ??
    null;
  // The next actionable task: in the current course first, then in plan order, so a
  // course waiting on the school never hides work the student can already start.
  const actionable = (t: HsTaskView) =>
    t.status === "in_progress" || t.status === "not_started" || t.status === "retake_required" || t.status === "official_failed";
  const nextCourse =
    (currentCourse && currentCourse.tasks.some(actionable) ? currentCourse : null) ??
    live.find((c) => c.status !== "official_complete" && c.status !== "transfer_credit" && c.tasks.some(actionable)) ??
    null;
  const nextTaskSrc = nextCourse?.tasks.find(actionable) ?? null;

  const attention: HsAttentionItem[] = [];
  for (const c of live) {
    for (const t of c.tasks) {
      if (t.overdue) attention.push({ kind: "overdue_task", message: `${t.title} was due ${t.dueDate}`, courseKey: c.key, taskKey: t.key });
      if (t.status === "retake_required") attention.push({ kind: "retake_required", message: `${t.title} needs a retake`, courseKey: c.key, taskKey: t.key });
    }
    if (c.status === "not_passed") attention.push({ kind: "not_passed", message: `${c.title} was not passed`, courseKey: c.key, taskKey: null });
  }
  if (pace.status === "behind") {
    attention.push({ kind: "behind_pace", message: "You are behind the planned pace", courseKey: null, taskKey: null });
  }
  for (const p of input.priorEducation) {
    if (p.status === "documents_requested") {
      attention.push({ kind: "documents_requested", message: `Documents requested for ${p.schoolName}`, courseKey: null, taskKey: null });
    }
  }

  // Canonical subject order (English first), regardless of the order of the requirement areas.
  const present = new Set<HsSubjectArea>(areas.map((a) => a.subject));
  const subjectOrder: HsSubjectArea[] = HS_SUBJECT_AREAS.filter((s) => present.has(s));
  const subjects: HsSubjectView[] = subjectOrder.map((subject) => {
    const subjectAreas = credits.byArea.filter((a) => a.subject === subject);
    return {
      subject,
      label: HS_SUBJECT_LABELS[subject],
      requiredHalfUnits: sumHalfUnits(subjectAreas.map((a) => a.requiredHalfUnits)),
      earnedHalfUnits: sumHalfUnits(subjectAreas.map((a) => a.countedHalfUnits)),
      courses: courses.filter((c) => c.subject === subject),
    };
  });

  const school = schoolDisplayNameFor(input.enrollment);
  return {
    enrollment: {
      id: input.enrollment.id,
      status: input.enrollment.status,
      schoolDisplayName: school.name,
      institutionDisclosed: school.disclosed,
      programTitle: input.enrollment.programTitle,
      startedOn: input.enrollment.startedOn,
      targetCompletionDate: input.enrollment.targetCompletionDate,
    },
    roadmap: input.roadmap
      ? { versionNumber: input.roadmap.versionNumber, publishedAt: input.roadmap.publishedAt, studentMessage: content?.studentMessage ?? null }
      : null,
    credits,
    current: { course: currentCourse, nextTask: nextCourse && nextTaskSrc ? withCourse(nextCourse, nextTaskSrc) : null },
    pace,
    writtenProjects,
    awaitingGrade,
    attention,
    subjects,
    graduation: projectGraduationView(input.graduation, credits, courses),
    priorEducation: input.priorEducation.map((p) => ({
      id: p.id,
      schoolLabel: p.schoolName,
      status: p.status,
      claims: p.claims.map((c) => ({
        id: c.id,
        courseTitle: c.courseTitle,
        claimedHalfUnits: c.claimedHalfUnits,
        acceptedHalfUnits: c.acceptedHalfUnits ?? null,
        status: c.status,
      })),
    })),
    guardians: input.guardians,
    generatedAt: input.nowIso,
  };
}

// ---------------------------------------------------------------------------
// Staff pieces
// ---------------------------------------------------------------------------

/** Tasks the student reported as submitted (or scored) with no newer official result. */
export function computeReviewQueue(
  content: HsRoadmapContent | null,
  progress: readonly HsProgressRecord[],
  taskResults: readonly HsTaskResultRecord[],
): HsReviewQueueItem[] {
  if (!content) return [];
  const queue: HsReviewQueueItem[] = [];
  for (const course of content.courses) {
    if (course.status !== "planned") continue;
    for (const task of course.tasks) {
      const p = progress.find((x) => x.courseKey === course.key && x.taskKey === task.key) ?? null;
      const official = latestBy(taskResults.filter((r) => r.courseKey === course.key && r.taskKey === task.key));
      if (taskDisplayStatus(p, official) !== "pending_review" || !p) continue;
      queue.push({
        courseKey: course.key,
        courseTitle: course.title,
        taskKey: task.key,
        taskTitle: task.title,
        kind: task.kind,
        reportedStatus: p.status,
        reportedScorePercent: p.reportedScorePercent,
        reportedAt: p.updatedAt,
        note: p.note,
      });
    }
  }
  return queue.sort((a, b) => (a.reportedAt < b.reportedAt ? -1 : a.reportedAt > b.reportedAt ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Roadmap content validation (against the template)
// ---------------------------------------------------------------------------

export interface RoadmapValidationOptions {
  /** The enrollment's configured total (template default or approved override). */
  readonly expectedTotalHalfUnits?: HalfUnits;
  /** Course keys with progress, results or awards: they may be replaced/removed but never deleted. */
  readonly protectedCourseKeys?: ReadonlySet<string>;
  /** "courseKey|taskKey" with progress or results: never deleted. */
  readonly protectedTaskKeys?: ReadonlySet<string>;
}

export function validateRoadmapContent(
  content: HsRoadmapContent,
  template: Pick<HsCurriculumTemplate, "areas">,
  opts: RoadmapValidationOptions = {},
): string[] {
  const errors: string[] = [];
  const areaKeys = new Set<string>();
  for (const a of content.areas) {
    if (areaKeys.has(a.key)) errors.push(`Duplicate requirement area ${a.key}`);
    areaKeys.add(a.key);
  }
  const templateAreas = new Map(template.areas.map((a) => [a.key, a]));
  for (const key of templateAreas.keys()) if (!areaKeys.has(key)) errors.push(`Requirement area ${key} from the template is missing`);
  for (const a of content.areas) {
    const t = templateAreas.get(a.key);
    if (!t) errors.push(`Requirement area ${a.key} is not part of the template`);
    else if (t.kind !== a.kind) errors.push(`Requirement area ${a.key} must stay ${t.kind}`);
  }
  const areaSum = sumHalfUnits(content.areas.map((a) => a.requiredHalfUnits));
  if (areaSum !== content.totalRequiredHalfUnits) {
    errors.push(
      `Area requirements (${formatHalfUnits(areaSum)} credits) must equal the total required (${formatHalfUnits(content.totalRequiredHalfUnits)} credits)`,
    );
  }
  if (opts.expectedTotalHalfUnits !== undefined && content.totalRequiredHalfUnits !== opts.expectedTotalHalfUnits) {
    errors.push(
      `Total required credits (${formatHalfUnits(content.totalRequiredHalfUnits)}) must match the enrollment (${formatHalfUnits(opts.expectedTotalHalfUnits)})`,
    );
  }

  const courseKeys = new Set<string>();
  for (const c of content.courses) {
    if (courseKeys.has(c.key)) errors.push(`Duplicate course key ${c.key}`);
    courseKeys.add(c.key);
  }
  for (const c of content.courses) {
    if (!areaKeys.has(c.areaKey)) errors.push(`Course ${c.key} references unknown area ${c.areaKey}`);
    if (c.replacesCourseKey !== null) {
      if (c.replacesCourseKey === c.key) errors.push(`Course ${c.key} cannot replace itself`);
      else if (!courseKeys.has(c.replacesCourseKey)) errors.push(`Course ${c.key} replaces unknown course ${c.replacesCourseKey}`);
    }
    if (c.plannedStart && c.plannedEnd && c.plannedStart > c.plannedEnd) errors.push(`Course ${c.key} ends before it starts`);
    const taskKeys = new Set<string>();
    for (const t of c.tasks) {
      if (taskKeys.has(t.key)) errors.push(`Duplicate task key ${t.key} in course ${c.key}`);
      taskKeys.add(t.key);
    }
    for (const protectedTask of opts.protectedTaskKeys ?? []) {
      const [ck, tk] = protectedTask.split("|");
      if (ck === c.key && !taskKeys.has(tk)) errors.push(`Task ${tk} of course ${c.key} has recorded activity and cannot be deleted`);
    }
  }
  for (const key of opts.protectedCourseKeys ?? []) {
    if (!courseKeys.has(key)) {
      errors.push(`Course ${key} has recorded progress, results or credit and cannot be deleted; mark it replaced or removed`);
    }
  }
  // A protected task whose whole course is gone is already reported at course level.

  const months = new Set<string>();
  let last = -1;
  for (const m of [...content.pacing.milestones].sort((a, b) => (a.month < b.month ? -1 : 1))) {
    if (months.has(m.month)) errors.push(`Duplicate pacing milestone ${m.month}`);
    months.add(m.month);
    if (m.cumulativeHalfUnits < last) errors.push(`Pacing milestone ${m.month} must not decrease`);
    last = Math.max(last, m.cumulativeHalfUnits);
    if (m.cumulativeHalfUnits > content.totalRequiredHalfUnits) errors.push(`Pacing milestone ${m.month} exceeds the total required credits`);
  }
  return errors;
}

/** Builds the first draft of a roadmap from a template, adjusting electives to a configured total. */
export function contentFromTemplate(
  template: HsCurriculumTemplate,
  totalRequiredHalfUnits: HalfUnits,
  targetCompletionDate: string | null,
): { content: HsRoadmapContent; error: string | null } {
  const delta = totalRequiredHalfUnits - template.totalRequiredHalfUnits;
  let areas = template.areas.map((a) => ({ key: a.key, label: a.label, kind: a.kind, subject: a.subject, requiredHalfUnits: a.requiredHalfUnits }));
  let error: string | null = null;
  if (delta !== 0) {
    const idx = areas.findIndex((a) => a.kind === "elective");
    if (idx < 0 || areas[idx].requiredHalfUnits + delta < 0) {
      error = "The configured total cannot be reached by adjusting elective credits";
    } else {
      areas = areas.map((a, i) => (i === idx ? { ...a, requiredHalfUnits: a.requiredHalfUnits + delta } : a));
    }
  }
  return {
    error,
    content: {
      totalRequiredHalfUnits,
      areas,
      courses: template.courses.map((c) => ({
        key: c.key,
        title: c.title,
        areaKey: c.areaKey,
        halfUnits: c.halfUnits,
        status: "planned" as const,
        replacesCourseKey: null,
        plannedStart: null,
        plannedEnd: null,
        tasks: [],
      })),
      pacing: { targetCompletionDate, weeklyTargetHalfUnits: null, milestones: [] },
      policies: { ...template.policies },
      studentMessage: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Guardians (S09 authority -> HS standing)
// ---------------------------------------------------------------------------

export interface HsContactInput {
  readonly id: string;
  readonly type: string;
  readonly full_name: string;
  readonly relationship: string;
  readonly scopes: readonly string[];
  readonly authority_status: string | null;
}

const GUARDIAN_TYPES = new Set(["parent", "guardian", "representative"]);

/** null = the contact is not a parent/guardian/representative (e.g. emergency, spouse). */
export function toGuardianView(c: HsContactInput): HsGuardianView | null {
  if (!GUARDIAN_TYPES.has(c.type)) return null;
  const authority: ContactAuthorityStatus =
    c.authority_status === "verified" || c.authority_status === "revoked" || c.authority_status === "pending_verification"
      ? c.authority_status
      : "listed";
  let standing: HsGuardianView["standing"];
  if (authority === "revoked") standing = "revoked";
  else if (authority === "verified") standing = "verified_guardian";
  else if (c.type === "parent" && authority === "listed") standing = "listed_parent";
  else standing = "guardian_unverified";
  const effective = effectiveContactScopes(c.scopes ?? [], authority);
  const verified = standing === "verified_guardian";
  return {
    contactId: c.id,
    fullName: c.full_name,
    relationship: c.relationship,
    standing,
    mayDiscussAcademics: verified && effective.includes("academic"),
    mayDiscussFinances: verified && effective.includes("financial"),
    hasPortalAccess: false,
  };
}

// ---------------------------------------------------------------------------
// Template request schema (POST /api/admin/high-school/templates, admin only)
// ---------------------------------------------------------------------------

const templateKeySchema = z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9-_.]*$/, "lowercase key");

export const hsCurriculumTemplateSchema = z
  .object({
    templateKey: templateKeySchema,
    version: z.number().int().min(1),
    title: z.string().trim().min(3).max(200),
    jurisdiction: z.string().trim().min(2).max(20).nullable(),
    totalRequiredHalfUnits: z.number().int().min(2).max(200),
    areas: z
      .array(
        z
          .object({
            key: templateKeySchema,
            label: z.string().trim().min(1).max(80),
            kind: z.enum(HS_REQUIREMENT_KINDS),
            subject: z.enum(HS_SUBJECT_AREAS),
            requiredHalfUnits: z.number().int().min(0).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    courses: z
      .array(
        z
          .object({
            key: templateKeySchema,
            title: z.string().trim().min(1).max(160),
            areaKey: templateKeySchema,
            halfUnits: z.number().int().min(1).max(200),
            required: z.boolean(),
          })
          .strict(),
      )
      .max(120),
    policies: hsPolicySchema,
    sourceNote: z.string().trim().max(1000),
  })
  .strict();
