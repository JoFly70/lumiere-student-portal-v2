/**
 * Academic projection (S18): one student-safe, read-only shape that drives the real Academic Flight Deck.
 *
 * Source of truth: the student's own high school program (StudentHighSchoolView, built by
 * projectStudentView/computeCreditSummary). This contract adds NO academic computation of its own:
 * every credit figure is copied or summed (integer half-units) from that view.
 *
 * Rules:
 *  - Credits are integer half-units (1 credit = 2). Format with formatHalfUnits at presentation only.
 *  - "official" = school-confirmed (active awards). Reported, in-progress and planned are never added to it.
 *  - Required totals come from the student's approved program configuration (template areas), never constants.
 *  - No GPA, no graduation probability.
 *  - `dataState` distinguishes "nothing configured yet" from "configured, zero progress".
 *
 * Endpoint: GET /api/student/academic-projection (student only, own record only)
 *   200 AcademicProjection
 *   404 { code: "HS_NO_ENROLLMENT" } when the student has no high school program
 */
import type {
  HalfUnits,
  HsCourseDisplayStatus,
  HsEnrollmentStatus,
  HsGraduationStatus,
  HsRequirementKind,
  HsSubjectArea,
  HsTaskDisplayStatus,
} from "./high-school-contract";

export const ACADEMIC_PROJECTION_CONTRACT = "academic-projection/1" as const;
export const ACADEMIC_PROJECTION_API = "/api/student/academic-projection" as const;

/** How certain a value is. Only "official" counts toward earned credit. */
export type AcademicBasis = "official" | "awaiting_school" | "in_progress" | "planned" | "not_counted";

/**
 * not_configured – enrollment exists but no published plan / requirement areas (show setup state, not 0%).
 * plan_published – areas and courses exist; progress may legitimately be zero.
 */
export type AcademicDataState = "not_configured" | "plan_published";

export interface AcademicProgramInfo {
  readonly kind: "high_school";
  readonly enrollmentId: string;
  readonly title: string;
  readonly status: HsEnrollmentStatus;
  readonly schoolDisplayName: string;
  readonly institutionDisclosed: boolean;
  /** Curriculum template configuration, e.g. "us-hs-diploma-21" v2. null when not exposed. */
  readonly templateKey: string | null;
  readonly templateVersion: number | null;
  readonly startedOn: string | null;
  readonly targetCompletionDate: string | null;
}

export interface AcademicCreditBucket {
  readonly requiredHalfUnits: HalfUnits;
  /** Official, school-confirmed (capped per area). */
  readonly officialHalfUnits: HalfUnits;
  /** Student-reported finished, not yet confirmed by the school. */
  readonly awaitingSchoolHalfUnits: HalfUnits;
  /** Courses currently in progress (not counted). */
  readonly inProgressHalfUnits: HalfUnits;
  /** Courses planned but not started (not counted). */
  readonly plannedHalfUnits: HalfUnits;
}

export interface AcademicAreaCoverage extends AcademicCreditBucket {
  readonly key: string;
  readonly label: string;
  readonly kind: HsRequirementKind;
  readonly subject: HsSubjectArea;
}

export interface AcademicCredits {
  readonly total: AcademicCreditBucket & {
    readonly remainingHalfUnits: HalfUnits;
    /** Official only, 0..100 floored. */
    readonly officialPercent: number;
  };
  readonly core: AcademicCreditBucket;
  readonly elective: AcademicCreditBucket;
  readonly byArea: readonly AcademicAreaCoverage[];
}

export interface AcademicTask {
  readonly key: string;
  readonly title: string;
  readonly kind: string;
  readonly status: HsTaskDisplayStatus;
  readonly dueDate: string | null;
  readonly overdue: boolean;
}

export interface AcademicCourse {
  readonly key: string;
  readonly title: string;
  readonly areaKey: string;
  readonly kind: HsRequirementKind;
  readonly halfUnits: HalfUnits;
  readonly status: HsCourseDisplayStatus;
  readonly basis: AcademicBasis;
  readonly plannedStart: string | null;
  readonly plannedEnd: string | null;
  readonly tasksDone: number;
  readonly tasksTotal: number;
  readonly tasks: readonly AcademicTask[];
}

export interface AcademicSubject {
  readonly subject: HsSubjectArea;
  readonly label: string;
  readonly requiredHalfUnits: HalfUnits;
  readonly officialHalfUnits: HalfUnits;
  readonly courses: readonly AcademicCourse[];
}

export interface AcademicNextAction {
  readonly kind:
    | "next_task"
    | "overdue_task"
    | "behind_pace"
    | "retake_required"
    | "not_passed"
    | "documents_requested"
    | "support_open";
  readonly message: string;
  readonly courseKey: string | null;
  readonly taskKey: string | null;
  readonly dueDate: string | null;
  /** Who acts next. "student" unless the item is waiting on Lumière/the school. */
  readonly owner: "student" | "lumiere";
}

export interface AcademicMilestone {
  /** "YYYY-MM" from the published plan. */
  readonly month: string;
  readonly cumulativeHalfUnits: HalfUnits;
  /** Official credit already meets this milestone. */
  readonly reached: boolean;
}

export interface AcademicProjection {
  readonly contract: typeof ACADEMIC_PROJECTION_CONTRACT;
  readonly generatedAt: string;
  readonly dataState: AcademicDataState;
  readonly program: AcademicProgramInfo;
  readonly credits: AcademicCredits;
  readonly subjects: readonly AcademicSubject[];
  readonly nextActions: readonly AcademicNextAction[];
  readonly milestones: readonly AcademicMilestone[];
  readonly pace: {
    readonly status: "on_track" | "behind" | "ahead" | "not_configured";
    readonly expectedByNowHalfUnits: HalfUnits | null;
    readonly weeklyTargetHalfUnits: HalfUnits | null;
  };
  readonly graduation: {
    readonly status: HsGraduationStatus;
    readonly creditsSatisfied: boolean;
    readonly outstandingExams: number;
    readonly outstandingProjects: number;
    readonly eligibilityConfirmedAt: string | null;
  };
  readonly provenance: {
    readonly planVersion: number | null;
    readonly publishedAt: string | null;
    readonly studentMessage: string | null;
    /** Always this constant: earned credit is school-confirmed only. */
    readonly officialBoundary: "school_confirmed_only";
  };
}
