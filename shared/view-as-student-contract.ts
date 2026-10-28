/**
 * S25 — owner "View as Student": a READ-ONLY administrative preview of exactly what the student sees.
 *
 * GET /api/admin/students/:studentId/view-as-student   (requireAuth + role admin; audited as profile.viewed)
 *   -> ViewAsStudentResponse
 *
 * The student-facing parts are the same projections the student's own endpoints return
 * (StudentHighSchoolView, AcademicProjection). No login, session or token of the student is used,
 * and there is no write endpoint behind this preview. The staff summary is derived only from
 * stored records (official awards, recorded results, reported progress, review queue, events);
 * nothing is estimated.
 */
import type { AcademicProjection } from "./academic-projection-contract";
import type { HalfUnits, HsReviewQueueItem, StudentHighSchoolView } from "./high-school-contract";

export const VIEW_AS_STUDENT_MODE = "read_only_preview" as const;

export interface ViewAsStudentSummary {
  readonly creditsRequiredHalfUnits: HalfUnits;
  /** Official credit only (school-confirmed awards). */
  readonly creditsEarnedHalfUnits: HalfUnits;
  readonly creditsRemainingHalfUnits: HalfUnits;
  /** Courses the student reported finished but the school has not confirmed. Never counted as earned. */
  readonly awaitingConfirmationHalfUnits: HalfUnits;
  /** Published-plan courses in progress or awaiting the school. */
  readonly coursesUnderway: number;
  /** Tasks the student reported done that wait for an official result. */
  readonly studentReportedTasks: number;
  /** Tasks with an official result recorded from school evidence. */
  readonly officialResults: number;
  /** Items in the staff review queue (student reports waiting for evidence/a recorded result). */
  readonly pendingEvidence: number;
  /** Newest recorded high-school event, if any. */
  readonly lastRecordedActivityAt: string | null;
  readonly nextMilestone: { readonly month: string; readonly cumulativeHalfUnits: HalfUnits } | null;
  readonly roadmapPublished: boolean;
}

export interface ViewAsStudentResponse {
  readonly mode: typeof VIEW_AS_STUDENT_MODE;
  readonly student: {
    readonly id: string;
    readonly displayName: string;
    readonly status: string;
    /** Whether a portal login is linked; the preview never uses it. */
    readonly hasPortalAccount: boolean;
    /** The student's saved portal language (EN/FR toggle), or null when never saved server-side. */
    readonly preferredLanguage: "en" | "fr" | null;
  };
  /** null when the student has no high school enrollment. */
  readonly highSchool: StudentHighSchoolView | null;
  readonly academicProjection: AcademicProjection | null;
  readonly summary: ViewAsStudentSummary | null;
  readonly generatedAt: string;
}

const UNDERWAY = new Set(["in_progress", "awaiting_school"]);
const OFFICIAL = new Set(["official_passed", "official_failed", "retake_required"]);

/** Pure: counts from the student's own projection plus the staff review queue and newest event. */
export function summarizeForPreview(
  view: StudentHighSchoolView,
  reviewQueue: readonly HsReviewQueueItem[],
  newestEventAt: string | null,
): ViewAsStudentSummary {
  const courses = view.subjects.flatMap((s) => s.courses);
  const tasks = courses.flatMap((c) => c.tasks);
  return {
    creditsRequiredHalfUnits: view.credits.requiredHalfUnits,
    creditsEarnedHalfUnits: view.credits.earnedHalfUnits,
    creditsRemainingHalfUnits: view.credits.remainingHalfUnits,
    awaitingConfirmationHalfUnits: view.credits.awaitingConfirmationHalfUnits,
    coursesUnderway: courses.filter((c) => UNDERWAY.has(c.status)).length,
    studentReportedTasks: tasks.filter((t) => t.status === "pending_review").length,
    officialResults: tasks.filter((t) => OFFICIAL.has(t.status)).length,
    pendingEvidence: reviewQueue.length,
    lastRecordedActivityAt: newestEventAt,
    nextMilestone: view.pace.nextMilestone,
    roadmapPublished: view.roadmap !== null,
  };
}
