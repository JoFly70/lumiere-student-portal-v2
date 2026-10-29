/**
 * S27 — Program agreement, Lumière checkpoints, orientation sessions, post-secondary goal,
 * logged pace and the owner Control Center.
 *
 * One contract shared by server and client. Dates are ISO yyyy-mm-dd strings; money is integer cents.
 *
 * Rules carried from the signed program agreement (configurable per student, never hard-coded to one family):
 *   - language test (e.g. an English proficiency test) due `signedOn + languageTestDays` (default 30)
 *   - proof of prior schooling due `activatedOn + priorSchoolingDays` (default 90)
 *   - Lumière support lasts `supportMonths` from activation (default 9)
 *   - school platform access lasts up to `accessMonths` from activation (default 36)
 *   - orientation sessions included: `orientationSessionsIncluded` (default 2, 30 minutes each)
 *
 * Privacy: student/guardian views never include internal notes, prices of other students, bank details,
 * or staff-only documents. Real student data never appears in fixtures or the public repository.
 */
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd");
const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullable().optional();

// ── agreement ────────────────────────────────────────────────────────────────

export const AGREEMENT_DEADLINE_KEYS = ["language_test", "prior_schooling_proof"] as const;
export type AgreementDeadlineKey = (typeof AGREEMENT_DEADLINE_KEYS)[number];
export const DEADLINE_STATUSES = ["open", "done", "waived"] as const;
export type DeadlineStatus = (typeof DEADLINE_STATUSES)[number];

export interface AgreementDeadlineView {
  readonly key: AgreementDeadlineKey;
  readonly label: string;
  /** Plain-language rule, e.g. "30 days after signing". */
  readonly rule: string;
  /** Null until the anchor date (signing / activation) is set. */
  readonly dueOn: string | null;
  readonly status: DeadlineStatus;
  readonly doneOn: string | null;
  /** e.g. "Score 112 (target 105–115)". Never contains private data. */
  readonly detail: string | null;
  /** Days from today to dueOn (negative = overdue); null when no due date or not open. */
  readonly daysLeft: number | null;
}

export interface UniversityTarget {
  readonly name: string;
  readonly city: string;
  /** e.g. "French track". */
  readonly track: string;
  readonly program: string;
  readonly why: string;
  readonly admission: string;
  readonly url: string | null;
}
export interface PostSecondaryGoal {
  /** e.g. "Communication". */
  readonly field: string;
  /** e.g. "Québec". */
  readonly region: string;
  readonly interests: readonly string[];
  readonly targets: readonly UniversityTarget[];
  readonly alsoReviewed: readonly string[];
  /** Date of Lumière's orientation study, if any. */
  readonly studyOn: string | null;
}
export const universityTargetSchema = z
  .object({
    name: text(120), city: text(80), track: text(80), program: text(200), why: text(400), admission: text(500),
    url: z.string().trim().url().max(400).nullable(),
  })
  .strict();
export const postSecondaryGoalSchema = z
  .object({
    field: text(80), region: text(80), interests: z.array(text(60)).max(10),
    targets: z.array(universityTargetSchema).max(6), alsoReviewed: z.array(text(120)).max(10),
    studyOn: isoDate.nullable(),
  })
  .strict();

export interface ProgramAgreementView {
  readonly signedOn: string | null;
  readonly activatedOn: string | null;
  readonly supportMonths: number;
  readonly supportEndsOn: string | null;
  readonly supportMonthsLeft: number | null;
  readonly accessMonths: number;
  readonly accessEndsOn: string | null;
  readonly deadlines: readonly AgreementDeadlineView[];
  readonly orientationSessionsIncluded: number;
  readonly orientationSessionsUsed: number;
  readonly goal: PostSecondaryGoal | null;
  /**
   * S27 backend additions (optional so existing client fixtures stay valid; the server always fills them).
   * They let the staff form show and edit the configurable terms without a second endpoint.
   */
  readonly languageTestDays?: number;
  readonly priorSchoolingDays?: number;
  readonly languageTestScore?: number | null;
  readonly languageTestTarget?: string | null;
}

/** Staff update (PUT). Every field optional; unknown keys rejected. */
export const updateAgreementSchema = z
  .object({
    signedOn: isoDate.nullable().optional(),
    activatedOn: isoDate.nullable().optional(),
    supportMonths: z.number().int().min(1).max(60).optional(),
    accessMonths: z.number().int().min(1).max(120).optional(),
    languageTestDays: z.number().int().min(1).max(365).optional(),
    priorSchoolingDays: z.number().int().min(1).max(365).optional(),
    orientationSessionsIncluded: z.number().int().min(0).max(10).optional(),
    languageTest: z
      .object({ status: z.enum(DEADLINE_STATUSES), doneOn: isoDate.nullable().optional(), score: z.number().int().min(0).max(200).nullable().optional(), target: optText(40) })
      .strict()
      .optional(),
    priorSchoolingProof: z.object({ status: z.enum(DEADLINE_STATUSES), doneOn: isoDate.nullable().optional() }).strict().optional(),
    goal: postSecondaryGoalSchema.nullable().optional(),
  })
  .strict();
export type UpdateAgreementInput = z.infer<typeof updateAgreementSchema>;

// ── checkpoints (Lumière coordination milestones) ───────────────────────────

export const CHECKPOINT_KEYS = [
  "file_opened", "program_activated", "kickoff_call", "language_test", "midpoint_check", "readiness_check", "closing",
] as const;
export type CheckpointKey = (typeof CHECKPOINT_KEYS)[number];
export const CHECKPOINT_LABELS: Record<CheckpointKey, string> = {
  file_opened: "File opened",
  program_activated: "Program activated",
  kickoff_call: "Kickoff call",
  language_test: "Language test",
  midpoint_check: "Midpoint check",
  readiness_check: "Diploma-readiness check",
  closing: "Closing: transcript & diploma",
};
export interface CheckpointView {
  readonly key: CheckpointKey;
  readonly label: string;
  /** "next" = the first not-done checkpoint. */
  readonly status: "done" | "next" | "upcoming";
  readonly plannedOn: string | null;
  readonly doneOn: string | null;
}
export const completeCheckpointSchema = z.object({ doneOn: isoDate.optional(), plannedOn: isoDate.nullable().optional() }).strict();
export const planCheckpointSchema = z.object({ plannedOn: isoDate.nullable() }).strict();

// ── orientation sessions ─────────────────────────────────────────────────────

export const SESSION_STATUSES = ["requested", "confirmed", "completed", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export interface OrientationSessionView {
  readonly id: string;
  /** ISO datetime with offset, e.g. 2026-11-03T17:00:00+01:00. */
  readonly slotAt: string;
  readonly status: SessionStatus;
  readonly prep: Readonly<Record<string, readonly string[]>>;
  /** Notes and next steps written by Lumière after the session (student-visible). */
  readonly notes: string | null;
  readonly createdAt: string;
}
export const requestSessionSchema = z
  .object({
    slotAt: z.string().datetime({ offset: true }),
    prep: z.record(z.string().max(60), z.array(z.string().max(60)).max(8)).refine((v) => Object.keys(v).length <= 6, "Too many questions"),
    channel: z.enum(["portal", "whatsapp"]).default("portal"),
  })
  .strict();
/** Staff creates a session on the student's behalf (e.g. agreed over WhatsApp). Default status "confirmed". */
export const createSessionByStaffSchema = requestSessionSchema.extend({ status: z.enum(["requested", "confirmed"]).default("confirmed") });
export const updateSessionSchema = z
  .object({ status: z.enum(SESSION_STATUSES).optional(), slotAt: z.string().datetime({ offset: true }).optional(), notes: optText(4000) })
  .strict();

// ── logged pace ──────────────────────────────────────────────────────────────

/**
 * Pace from the student's own logs (submitted or graded items) over the last 28 days, converted to
 * credit-equivalents: each task is worth (course credits / number of tasks in the course).
 * It only estimates arrival; credits count once the school confirms them.
 */
export interface LoggedPaceView {
  readonly creditsPerWeek: number | null;
  readonly itemsLogged28d: number;
  readonly lastLoggedOn: string | null;
  /** True when nothing was logged in the last 7 days. */
  readonly stale: boolean;
  /** Estimated date the remaining credits are reached at this pace (null when pace is null/0). */
  readonly estimatedFinishOn: string | null;
  /** Exams logged since Monday of the current week (the school's weekly limit is shown next to it). */
  readonly examsThisWeek: number;
  readonly weeklyExamLimit: number | null;
}

// ── student journey (one call for the student shell) ────────────────────────

export interface StudentJourneyView {
  readonly agreement: ProgramAgreementView | null;
  readonly checkpoints: readonly CheckpointView[];
  readonly sessions: readonly OrientationSessionView[];
  readonly pace: LoggedPaceView | null;
}

// ── owner Control Center ─────────────────────────────────────────────────────

export const QUEUE_KINDS = [
  "document_review", "payment_evidence", "payment_overdue", "payment_missing", "deadline_soon",
  "inactive", "low_grade", "school_result_needed", "elective_approval", "session_request", "support_reply",
] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];
export interface ControlQueueItem {
  readonly id: string;
  readonly kind: QueueKind;
  readonly severity: "critical" | "warning" | "info";
  readonly studentId: string;
  readonly studentName: string;
  readonly title: string;
  readonly detail: string;
  /** Client route to act on it, e.g. /admin/students/:id?tab=billing */
  readonly href: string;
  readonly at: string | null;
}
export interface ControlStudentRow {
  readonly studentId: string;
  readonly name: string;
  readonly code: string | null;
  readonly program: "high_school" | "degree" | "none";
  readonly isDemo: boolean;
  readonly creditsConfirmed: number;
  readonly creditsRequired: number | null;
  readonly paceLabel: string | null;
  readonly estimatedFinishOn: string | null;
  readonly status: { readonly tone: "ok" | "warning" | "critical" | "gold" | "neutral"; readonly label: string };
  readonly nextDeadline: { readonly label: string; readonly dueOn: string; readonly daysLeft: number } | null;
  readonly lastActivityOn: string | null;
  readonly supportMonthsLeft: number | null;
}
export interface ControlCenterView {
  readonly generatedAt: string;
  readonly queue: readonly ControlQueueItem[];
  readonly students: readonly ControlStudentRow[];
  readonly deadlines: readonly { readonly studentId: string; readonly studentName: string; readonly label: string; readonly dueOn: string; readonly daysLeft: number }[];
  readonly payments: { readonly receivedThisMonthCents: number; readonly currency: string | null; readonly signedNotPaid: number; readonly overdueInstallments: number };
  readonly supportWindows: readonly { readonly studentId: string; readonly studentName: string; readonly monthsLeft: number }[];
  /** Real-student counts exclude synthetic demo accounts. */
  readonly counts: { readonly needsYou: number; readonly flying: number; readonly deadlines14d: number; readonly preEnrollment: number };
}

// ── staff notes (student file timeline) ──────────────────────────────────────

export interface StaffNoteView {
  readonly id: string;
  readonly body: string;
  readonly authorName: string | null;
  readonly createdAt: string;
}
export const createStaffNoteSchema = z.object({ body: text(4000) }).strict();

// ── API paths ────────────────────────────────────────────────────────────────

const enc = encodeURIComponent;
export const S27_API = {
  studentJourney: "/api/student/journey",
  studentSessions: "/api/student/orientation-sessions",
  controlCenter: "/api/admin/control-center",
  agreement: (studentId: string) => `/api/admin/students/${enc(studentId)}/agreement`,
  checkpoint: (studentId: string, key: CheckpointKey) => `/api/admin/students/${enc(studentId)}/checkpoints/${enc(key)}`,
  sessions: (studentId: string) => `/api/admin/students/${enc(studentId)}/orientation-sessions`,
  session: (studentId: string, sessionId: string) => `/api/admin/students/${enc(studentId)}/orientation-sessions/${enc(sessionId)}`,
  notes: (studentId: string) => `/api/admin/students/${enc(studentId)}/notes`,
  staffJourney: (studentId: string) => `/api/admin/students/${enc(studentId)}/journey`,
} as const;

export const S27_ERROR_CODES = {
  VALIDATION: "S27_VALIDATION_FAILED",
  NOT_FOUND: "S27_NOT_FOUND",
  NO_SESSIONS_LEFT: "S27_NO_SESSIONS_LEFT",
  FORBIDDEN: "S27_FORBIDDEN",
  /** S27 backend addition: e.g. confirming a cancelled session, or completing one that was never confirmed (409). */
  INVALID_TRANSITION: "S27_INVALID_TRANSITION",
} as const;

/**
 * S27 backend addition: audit event types written by the S27 routes (identifiers, keys, statuses and counts only;
 * never note bodies, session notes or goal text). They exist in the audit_event_type enum through
 * supabase/migrations/20261105100000_s27_program_journey.sql.
 */
export const S27_AUDIT_EVENTS = {
  agreementUpdated: "program.agreement_updated",
  checkpointUpdated: "program.checkpoint_updated",
  sessionRequested: "program.session_requested",
  sessionUpdated: "program.session_updated",
  noteAdded: "program.note_added",
  accessDenied: "program.access_denied",
} as const;

/**
 * Role matrix (server-enforced): admin reads and writes everything; staff reads the journey, notes and the
 * Control Center and may add notes; coach has no access; a student reads only their own journey and may request
 * an orientation session (the student is resolved from the session, a studentId in query/body is rejected).
 * Dates are computed in UTC (Africa/Casablanca is treated as UTC for "today" and "Monday").
 */
