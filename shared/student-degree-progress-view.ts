/**
 * Student-facing canonical degree progress contract (S04).
 *
 * Served read-only by GET /api/student/degree-progress for the authenticated
 * student's own record. Every number is taken from canonical academic facts
 * (the degree evaluation snapshot and the student academic record); nothing
 * is estimated. Amounts are decimal strings exactly as the canonical engine
 * produces them (numeric(6,2)), never floats.
 *
 * When the canonical engine cannot compose a result (MANUAL_REVIEW), the
 * view carries no totals and no per-requirement amounts, so the client cannot
 * display a number the engine did not produce.
 */

export const STUDENT_DEGREE_PROGRESS_CONTRACT = "student-degree-progress/1" as const;

export type StudentDegreeProgressState =
  /** Canonical progress composed; totals and requirement amounts present. */
  | "COMPOSED"
  /** Student has a program, but the canonical result needs staff review. */
  | "UNDER_REVIEW"
  /** No active program assignment yet. */
  | "NO_ACTIVE_PROGRAM";

export type StudentRequirementStatus =
  | "SATISFIED"
  | "PARTIAL"
  | "MISSING"
  | "CONFLICT"
  | "MANUAL_REVIEW";

export interface StudentProgramSummary {
  readonly programName: string;
  readonly programCode: string | null;
  readonly versionLabel: string | null;
  readonly institutionName: string | null;
  readonly cohortLabel: string | null;
}

export interface StudentProgressTotals {
  readonly unit: "credit";
  /** Sum of required credits across evaluated credit requirements. */
  readonly requiredCredits: string;
  /** Credits the canonical engine applied toward those requirements. */
  readonly appliedCredits: string;
  /** requiredCredits − appliedCredits, never negative. */
  readonly remainingCredits: string;
  /** Distinct credit records that are verified with an accepted decision. */
  readonly verifiedCreditsOnRecord: string;
  readonly requirementsSatisfied: number;
  readonly requirementsTotal: number;
}

export interface StudentRequirementView {
  readonly requirementId: string;
  readonly code: string | null;
  readonly title: string;
  readonly sequence: number | null;
  readonly status: StudentRequirementStatus;
  readonly unit: string | null;
  /** Null whenever the engine did not produce the amount. */
  readonly requiredAmount: string | null;
  readonly appliedAmount: string | null;
  readonly remainingAmount: string | null;
  /** Course-level contributions the engine applied to this requirement. */
  readonly appliedCreditRecordIds: readonly string[];
}

/**
 * Classification of a credit record from the student's point of view.
 * VERIFIED_* values are verified academic facts; every other value is
 * preliminary and must be presented as such.
 */
export type StudentCreditStanding =
  | "VERIFIED_APPLIED"
  | "VERIFIED_NOT_APPLIED"
  | "PENDING_VERIFICATION"
  | "NEEDS_REVIEW"
  | "NOT_ACCEPTED";

export interface StudentCreditView {
  readonly creditRecordId: string;
  readonly courseCode: string | null;
  readonly title: string;
  readonly term: string | null;
  readonly completedOn: string | null;
  readonly recordType: string;
  /** Credits as reported on the source document (preliminary). */
  readonly reportedCredits: string | null;
  /** Credits awarded by an accepted staff decision (verified). */
  readonly awardedCredits: string | null;
  readonly standing: StudentCreditStanding;
  readonly sourceId: string | null;
  /** Requirement ids this credit is applied to in the canonical result. */
  readonly appliedToRequirementIds: readonly string[];
}

export interface StudentCreditSourceView {
  readonly sourceId: string;
  readonly title: string;
  readonly sourceType: string;
  readonly status: "received" | "extracted" | "verified" | "rejected" | "superseded";
  readonly sourceDate: string | null;
  readonly receivedAt: string | null;
  readonly creditRecordCount: number;
}

export type StudentAttentionKind =
  | "PROGRESS_UNDER_REVIEW"
  | "REQUIREMENT_REVIEW"
  | "CREDIT_PENDING_VERIFICATION"
  | "CREDIT_NEEDS_REVIEW"
  | "SOURCE_PENDING_REVIEW"
  | "NO_ACTIVE_PROGRAM";

export interface StudentAttentionItem {
  readonly kind: StudentAttentionKind;
  /** Who acts next. Students cannot change verified academic facts. */
  readonly owner: "staff" | "student";
  readonly title: string;
  readonly detail: string;
  readonly requirementId?: string;
  readonly creditRecordId?: string;
  readonly sourceId?: string;
}

export interface StudentMilestone {
  readonly id: string;
  readonly label: string;
  /** Threshold in applied credits (decimal string), when credit-based. */
  readonly thresholdCredits: string | null;
  readonly reached: boolean;
}

export type StudentNextStepKind =
  | "UPLOAD_DOCUMENTS"
  | "AWAIT_VERIFICATION"
  | "CONTACT_ADVISOR"
  | "COMPLETE_REQUIREMENT"
  | "DEGREE_REQUIREMENTS_MET";

export interface StudentNextStep {
  readonly kind: StudentNextStepKind;
  readonly title: string;
  readonly detail: string;
  /** In-app route for the action, e.g. "/documents" or "/support". */
  readonly href: string | null;
  readonly requirementId?: string;
}

export interface StudentDegreeProgressView {
  readonly contractVersion: typeof STUDENT_DEGREE_PROGRESS_CONTRACT;
  readonly state: StudentDegreeProgressState;
  /** Snapshot as-of timestamp (ISO) from the canonical engine. */
  readonly asOf: string | null;
  readonly program: StudentProgramSummary | null;
  /** Present only when state === "COMPOSED". */
  readonly totals: StudentProgressTotals | null;
  /** Empty unless state === "COMPOSED"; ordered by sequence then code. */
  readonly requirements: readonly StudentRequirementView[];
  readonly credits: readonly StudentCreditView[];
  readonly sources: readonly StudentCreditSourceView[];
  readonly attention: readonly StudentAttentionItem[];
  readonly milestones: readonly StudentMilestone[];
  /** Deterministic, ordered by priority; derived only from the facts above. */
  readonly nextSteps: readonly StudentNextStep[];
}
