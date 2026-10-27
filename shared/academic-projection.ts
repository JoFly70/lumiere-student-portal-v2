/**
 * Academic projection (S18): pure mapping from the student's high school view to the
 * student-safe AcademicProjection contract. No academic engine lives here: official
 * figures are copied from view.credits (already capped per area); in-progress,
 * planned and awaiting-school figures are integer sums of course half-units by status.
 * No GPA, no probability.
 */
import {
  ACADEMIC_PROJECTION_CONTRACT,
  type AcademicAreaCoverage,
  type AcademicBasis,
  type AcademicCourse,
  type AcademicCreditBucket,
  type AcademicMilestone,
  type AcademicNextAction,
  type AcademicProjection,
  type AcademicSubject,
} from "./academic-projection-contract";
import {
  halfUnitPercent,
  sumHalfUnits,
  type HalfUnits,
  type HsCourseDisplayStatus,
  type HsCourseView,
  type StudentHighSchoolView,
} from "./high-school-contract";

export interface AcademicProjectionMeta {
  readonly templateKey: string | null;
  readonly templateVersion: number | null;
  /** Published plan milestones (additive; the student view only carries the next one). */
  readonly milestones?: readonly { readonly month: string; readonly cumulativeHalfUnits: HalfUnits }[];
}

const BASIS: Record<HsCourseDisplayStatus, AcademicBasis> = {
  official_complete: "official",
  transfer_credit: "official",
  awaiting_school: "awaiting_school",
  in_progress: "in_progress",
  not_started: "planned",
  replaced: "not_counted",
  not_passed: "not_counted",
};

export function projectAcademic(view: StudentHighSchoolView, meta: AcademicProjectionMeta): AcademicProjection {
  const allCourses: readonly HsCourseView[] = view.subjects.flatMap((s) => s.courses);
  const sumBy = (courses: readonly HsCourseView[], basis: AcademicBasis) =>
    sumHalfUnits(courses.filter((c) => BASIS[c.status] === basis).map((c) => c.halfUnits));

  const bucket = (courses: readonly HsCourseView[]) => ({
    awaitingSchoolHalfUnits: sumBy(courses, "awaiting_school"),
    inProgressHalfUnits: sumBy(courses, "in_progress"),
    plannedHalfUnits: sumBy(courses, "planned"),
  });

  const byArea: AcademicAreaCoverage[] = view.credits.byArea.map((a) => ({
    key: a.key,
    label: a.label,
    kind: a.kind,
    subject: a.subject,
    requiredHalfUnits: a.requiredHalfUnits,
    officialHalfUnits: a.countedHalfUnits,
    ...bucket(allCourses.filter((c) => c.areaKey === a.key)),
  }));

  const kindBucket = (kind: "core" | "elective", required: HalfUnits, official: HalfUnits): AcademicCreditBucket => ({
    requiredHalfUnits: required,
    officialHalfUnits: official,
    ...bucket(allCourses.filter((c) => c.kind === kind)),
  });

  const officialTotal = sumHalfUnits(byArea.map((a) => a.officialHalfUnits));
  const required = view.credits.requiredHalfUnits;

  const subjects: AcademicSubject[] = view.subjects.map((s) => ({
    subject: s.subject,
    label: s.label,
    requiredHalfUnits: s.requiredHalfUnits,
    officialHalfUnits: s.earnedHalfUnits,
    courses: s.courses.map(
      (c): AcademicCourse => ({
        key: c.key,
        title: c.title,
        areaKey: c.areaKey,
        kind: c.kind,
        halfUnits: c.halfUnits,
        status: c.status,
        basis: BASIS[c.status],
        plannedStart: c.plannedStart,
        plannedEnd: c.plannedEnd,
        tasksDone: c.tasksDone,
        tasksTotal: c.tasksTotal,
        tasks: c.tasks.map((t) => ({ key: t.key, title: t.title, kind: t.kind, status: t.status, dueDate: t.dueDate, overdue: t.overdue })),
      }),
    ),
  }));

  const dueOf = (courseKey: string | null, taskKey: string | null): string | null => {
    if (!courseKey || !taskKey) return null;
    return allCourses.find((c) => c.key === courseKey)?.tasks.find((t) => t.key === taskKey)?.dueDate ?? null;
  };

  const nextActions: AcademicNextAction[] = [];
  const nt = view.current.nextTask;
  if (nt) {
    nextActions.push({ kind: "next_task", message: nt.title, courseKey: nt.courseKey, taskKey: nt.key, dueDate: nt.dueDate, owner: "student" });
  }
  for (const a of view.attention) {
    nextActions.push({
      kind: a.kind,
      message: a.message,
      courseKey: a.courseKey,
      taskKey: a.taskKey,
      dueDate: dueOf(a.courseKey, a.taskKey),
      owner: a.kind === "support_open" ? "lumiere" : "student",
    });
  }

  const milestones: AcademicMilestone[] = [...(meta.milestones ?? [])]
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
    .map((m) => ({ month: m.month, cumulativeHalfUnits: m.cumulativeHalfUnits, reached: officialTotal >= m.cumulativeHalfUnits }));

  const configured = view.roadmap !== null || allCourses.length > 0;

  return {
    contract: ACADEMIC_PROJECTION_CONTRACT,
    generatedAt: view.generatedAt,
    dataState: configured ? "plan_published" : "not_configured",
    program: {
      kind: "high_school",
      enrollmentId: view.enrollment.id,
      title: view.enrollment.programTitle,
      status: view.enrollment.status,
      schoolDisplayName: view.enrollment.schoolDisplayName,
      institutionDisclosed: view.enrollment.institutionDisclosed,
      templateKey: meta.templateKey,
      templateVersion: meta.templateVersion,
      startedOn: view.enrollment.startedOn,
      targetCompletionDate: view.enrollment.targetCompletionDate,
    },
    credits: {
      total: {
        requiredHalfUnits: required,
        officialHalfUnits: officialTotal,
        ...bucket(allCourses),
        remainingHalfUnits: Math.max(0, required - officialTotal),
        officialPercent: halfUnitPercent(officialTotal, required),
      },
      core: kindBucket("core", view.credits.core.requiredHalfUnits, view.credits.core.earnedHalfUnits),
      elective: kindBucket("elective", view.credits.elective.requiredHalfUnits, view.credits.elective.earnedHalfUnits),
      byArea,
    },
    subjects,
    nextActions,
    milestones,
    pace: {
      status: view.pace.status,
      expectedByNowHalfUnits: view.pace.expectedByNowHalfUnits,
      weeklyTargetHalfUnits: view.pace.weeklyTargetHalfUnits,
    },
    graduation: {
      status: view.graduation.status,
      creditsSatisfied: view.graduation.creditsSatisfied,
      outstandingExams: view.graduation.outstandingExams,
      outstandingProjects: view.graduation.outstandingProjects,
      eligibilityConfirmedAt: view.graduation.eligibilityConfirmedAt,
    },
    provenance: {
      planVersion: view.roadmap?.versionNumber ?? null,
      publishedAt: view.roadmap?.publishedAt ?? null,
      studentMessage: view.roadmap?.studentMessage ?? null,
      officialBoundary: "school_confirmed_only",
    },
  };
}
