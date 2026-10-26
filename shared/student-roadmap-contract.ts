/**
 * S05 — Lumière-assigned interactive roadmap: the shared contract.
 *
 * Doctrine: Lumière staff own, modify and publish each student's roadmap.
 * Students follow the CURRENT PUBLISHED version, report coursework activity
 * against it and never change the plan, degree assignment or credits.
 *
 * Authority boundaries (do not blur):
 * - Prior and earned credit is canonical: it comes ONLY from the S04
 *   StudentDegreeProgressView (student academic record + degree engine).
 *   The roadmap never stores, awards or recomputes credit.
 * - The roadmap is a planning document: a versioned JSON document
 *   (RoadmapContent) per student. Versions are immutable once published.
 * - Student activity (task progress) is stored separately, keyed by the
 *   stable item key and task key, so it survives re-publication and date
 *   changes and is never transferred to a different (replacement) item.
 * - Imports (Excel templates, AI-produced packages) only ever produce DRAFT
 *   content plus review exceptions. Nothing imported is an institutional
 *   decision; any credit/acceptance claim in an import is ignored and flagged.
 */
import { z } from "zod";
import type { StudentCreditStanding } from "./student-degree-progress-view";

// ── Keys and primitives ──────────────────────────────────────────────────────

/** Stable identity: lowercase slug, 1–80 chars, [a-z0-9] plus "-" "_" ".". */
export const roadmapKeySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,79}$/, "must be a lowercase key of [a-z0-9._-], max 80 chars");

/** ISO calendar date YYYY-MM-DD. */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

/** Decimal credit amount as a string, max 2 decimals (matches numeric(6,2)). */
export const creditAmountSchema = z.string().regex(/^\d{1,4}(\.\d{1,2})?$/, "must be a decimal string");

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullable().optional();

// ── Roadmap content (the versioned planning document) ────────────────────────

export const ROADMAP_CONTENT_VERSION = "roadmap-content/1" as const;

export const roadmapObjectiveKindSchema = z.enum([
  /** The degree the student is assigned to (canonical program assignment). */
  "primary",
  /** An additional credential pursued after or beside the primary. */
  "secondary",
  /** Pursued concurrently (e.g. concurrent master's). */
  "parallel",
  /** Prerequisite track for a later admission (e.g. nursing prerequisites). */
  "prerequisite",
]);

export const roadmapObjectiveSchema = z.object({
  key: roadmapKeySchema,
  title: text(200),
  kind: roadmapObjectiveKindSchema,
  institution: optText(200),
  credentialLabel: optText(120),
  /** True only for the primary objective tied to the canonical assignment. */
  linkedToProgramAssignment: z.boolean().default(false),
  /** "changed" = an approved, historical objective kept for context. */
  status: z.enum(["active", "completed", "changed", "alternative"]).default("active"),
  note: optText(1000),
});

export const roadmapPhaseSchema = z.object({
  key: roadmapKeySchema,
  title: text(200),
  sequence: z.number().int().min(0).max(10_000),
  objectiveKey: roadmapKeySchema.nullable().optional(),
  startDate: isoDateSchema.nullable().optional(),
  endDate: isoDateSchema.nullable().optional(),
  description: optText(1000),
});

export const roadmapTaskKindSchema = z.enum([
  "challenge",
  "milestone",
  "touchstone",
  "paper",
  "quiz",
  "exam",
  "assignment",
  "other",
]);

export const roadmapTaskSchema = z.object({
  /** Stable within its item, e.g. "challenge-3", "touchstone-1", "final-exam". */
  key: roadmapKeySchema,
  kind: roadmapTaskKindSchema,
  title: text(200),
  sequence: z.number().int().min(0).max(10_000),
});

export const roadmapItemKindSchema = z.enum(["course", "exam", "application", "task"]);

export const roadmapItemSchema = z.object({
  /** Stable identity across versions. Progress is keyed by this. */
  key: roadmapKeySchema,
  phaseKey: roadmapKeySchema,
  objectiveKey: roadmapKeySchema,
  sequence: z.number().int().min(0).max(10_000),
  kind: roadmapItemKindSchema.default("course"),
  code: optText(40),
  title: text(200),
  provider: optText(120),
  /** Institution that will grant/accept the credit (e.g. the degree school). */
  institution: optText(200),
  /** Planned credit value (informational; never an award). */
  credits: creditAmountSchema.nullable().optional(),
  plannedStart: isoDateSchema.nullable().optional(),
  plannedEnd: isoDateSchema.nullable().optional(),
  /** Item keys that must be officially accepted or provider-complete first. */
  dependsOn: z.array(roadmapKeySchema).max(50).default([]),
  /** Staff-controlled plan status. */
  planStatus: z.enum(["planned", "hold", "alternative", "dropped"]).default("planned"),
  hold: z.object({ reason: text(500) }).nullable().optional(),
  approval: z
    .object({
      required: z.boolean(),
      status: z.enum(["pending", "approved", "not_required"]),
      note: optText(500),
    })
    .nullable()
    .optional(),
  /** For planStatus "alternative": the item key this is an alternative to. */
  alternativeOf: roadmapKeySchema.nullable().optional(),
  /**
   * Staff link to a canonical credit record. Official acceptance is shown ONLY
   * through this link, read from the canonical record.
   */
  linkedCreditRecordId: z.string().uuid().nullable().optional(),
  tasks: z.array(roadmapTaskSchema).max(100).default([]),
  /** Shown to the student. */
  studentNote: optText(1000),
  /** Staff-only; never sent to the student. */
  staffNote: optText(2000),
});

export const roadmapMilestoneSchema = z.object({
  key: roadmapKeySchema,
  title: text(200),
  kind: z.enum(["checkpoint", "application", "objective_complete", "graduation"]),
  targetDate: isoDateSchema.nullable().optional(),
  objectiveKey: roadmapKeySchema.nullable().optional(),
  /** Reached when every listed item is officially accepted or provider-complete. */
  afterItemKeys: z.array(roadmapKeySchema).max(200).default([]),
});

export const roadmapContentSchema = z.object({
  contentVersion: z.literal(ROADMAP_CONTENT_VERSION),
  title: text(200),
  /** Shown to the student at the top of the roadmap. */
  summary: optText(2000),
  objectives: z.array(roadmapObjectiveSchema).min(1).max(10),
  phases: z.array(roadmapPhaseSchema).min(1).max(50),
  items: z.array(roadmapItemSchema).max(500),
  milestones: z.array(roadmapMilestoneSchema).max(100).default([]),
});

export type RoadmapObjective = z.infer<typeof roadmapObjectiveSchema>;
export type RoadmapPhase = z.infer<typeof roadmapPhaseSchema>;
export type RoadmapTask = z.infer<typeof roadmapTaskSchema>;
export type RoadmapTaskKind = z.infer<typeof roadmapTaskKindSchema>;
export type RoadmapItem = z.infer<typeof roadmapItemSchema>;
export type RoadmapMilestone = z.infer<typeof roadmapMilestoneSchema>;
export type RoadmapContent = z.infer<typeof roadmapContentSchema>;

// ── Review exceptions ────────────────────────────────────────────────────────

/**
 * blocking: must be FIXED by editing the draft (publish refused while present).
 * warning:  must be ACKNOWLEDGED by staff before publish (uncertain mappings).
 * info:     displayed only.
 */
export type RoadmapExceptionSeverity = "blocking" | "warning" | "info";

export type RoadmapExceptionCode =
  // conversion (template / package)
  | "UNKNOWN_TEMPLATE"
  | "MISSING_REQUIRED_COLUMN"
  | "UNMAPPED_COLUMN"
  | "ROW_SKIPPED"
  | "MISSING_TITLE"
  | "INVALID_DATE"
  | "INVALID_CREDITS"
  | "INVALID_TASK_COUNT"
  | "PHASE_CREATED_FROM_ROW"
  | "OBJECTIVE_CREATED_FROM_ROW"
  | "GENERATED_ITEM_KEY"
  | "AI_LOW_CONFIDENCE"
  | "AI_CREDIT_CLAIM_IGNORED"
  | "CONDITIONAL_ALLOCATION"
  | "PACKAGE_INVALID"
  // content validation (draft edits re-run these)
  | "DUPLICATE_ITEM_KEY"
  | "DUPLICATE_TASK_KEY"
  | "DUPLICATE_PHASE_KEY"
  | "DUPLICATE_OBJECTIVE_KEY"
  | "UNKNOWN_PHASE"
  | "UNKNOWN_OBJECTIVE"
  | "UNKNOWN_DEPENDENCY"
  | "DEPENDENCY_CYCLE"
  | "ALTERNATIVE_UNKNOWN_TARGET"
  | "NO_PRIMARY_OBJECTIVE"
  | "MULTIPLE_PRIMARY_OBJECTIVES"
  | "DATE_ORDER"
  | "HOLD_WITHOUT_REASON"
  | "UNKNOWN_MILESTONE_ITEM"
  // re-import / diff
  | "PROGRESS_ON_REMOVED_ITEM"
  | "PROGRESS_ON_REMOVED_TASK"
  | "OBJECTIVE_CHANGED";

export interface RoadmapExceptionRef {
  readonly sheet?: string;
  /** 1-based spreadsheet row. */
  readonly row?: number;
  readonly column?: string;
  readonly itemKey?: string;
  readonly taskKey?: string;
  readonly path?: string;
}

export interface RoadmapException {
  /**
   * Deterministic: `${code}:${ref.itemKey ?? ref.sheet + "!" + ref.row ?? ...}`
   * so acknowledgements survive re-validation of the same draft.
   */
  readonly key: string;
  readonly code: RoadmapExceptionCode;
  readonly severity: RoadmapExceptionSeverity;
  readonly message: string;
  readonly ref: RoadmapExceptionRef;
}

export interface RoadmapExceptionAcknowledgement {
  readonly exceptionKey: string;
  readonly acknowledgedBy: string;
  readonly acknowledgedAt: string;
  readonly note: string | null;
}

// ── Diff between the published version and a draft ─────────────────────────

export interface RoadmapItemChange {
  readonly itemKey: string;
  readonly title: string;
  /** Field names of RoadmapItem that differ, e.g. ["plannedStart","plannedEnd"]. */
  readonly fields: readonly string[];
  /** True when only plannedStart/plannedEnd/sequence/phaseKey changed. */
  readonly rescheduleOnly: boolean;
}

export interface RoadmapDiff {
  readonly baseVersionNumber: number | null;
  readonly added: readonly { readonly itemKey: string; readonly title: string }[];
  readonly removed: readonly { readonly itemKey: string; readonly title: string; readonly hasProgress: boolean }[];
  readonly changed: readonly RoadmapItemChange[];
  readonly unchangedCount: number;
  readonly objectivesAdded: readonly string[];
  readonly objectivesRemoved: readonly string[];
  readonly objectivesChanged: readonly string[];
  readonly phasesChanged: boolean;
  readonly milestonesChanged: boolean;
}

/** Signatures implemented in shared/student-roadmap-validation.ts. */
export type ValidateRoadmapContent = (content: RoadmapContent) => RoadmapException[];
export type DiffRoadmapContent = (
  previous: RoadmapContent | null,
  next: RoadmapContent,
  /** itemKey -> set of task keys (plus "__item__") with recorded student progress. */
  progressKeys: ReadonlyMap<string, ReadonlySet<string>>,
  baseVersionNumber: number | null,
) => { diff: RoadmapDiff; exceptions: RoadmapException[] };

// ── Conversion (Excel template adapters and AI packages) ────────────────────

export const ROADMAP_IMPORT_PACKAGE_FORMAT = "lumiere-roadmap-package/1" as const;

/**
 * Structured package an AI system (ChatGPT, Claude, …) or a script may produce.
 * It goes through exactly the same validation as a workbook. `confidence` below
 * "high" and every `needsReview` produce warning exceptions. `creditClaims`
 * are never applied; each produces AI_CREDIT_CLAIM_IGNORED.
 */
export const roadmapImportPackageSchema = z.object({
  format: z.literal(ROADMAP_IMPORT_PACKAGE_FORMAT),
  generator: z.object({ name: text(80), model: optText(120), preparedAt: optText(40) }),
  content: z.unknown(),
  itemAnnotations: z
    .array(
      z.object({
        itemKey: z.string(),
        confidence: z.enum(["high", "medium", "low"]),
        needsReview: z.boolean().default(false),
        rationale: optText(1000),
        conditionalAllocation: optText(500),
      }),
    )
    .default([]),
  creditClaims: z.array(z.object({ description: z.string().max(500) })).default([]),
});
export type RoadmapImportPackage = z.infer<typeof roadmapImportPackageSchema>;

export interface ConversionSourceSummary {
  readonly kind: "workbook" | "package";
  readonly fileName: string | null;
  readonly sheetsRead: readonly string[];
  readonly rowsRead: number;
  readonly rowsConverted: number;
  readonly rowsSkipped: number;
  readonly generator: string | null;
}

export interface ConversionResult {
  /** e.g. "lumiere-roadmap-v1" or "ai-package-v1". */
  readonly templateId: string;
  /** Null only when nothing usable could be produced (blocking exceptions explain why). */
  readonly content: RoadmapContent | null;
  readonly exceptions: readonly RoadmapException[];
  readonly summary: ConversionSourceSummary;
}

// ── Student progress (activity reporting) ────────────────────────────────────

/** Pseudo task key for item-level progress. */
export const ITEM_LEVEL_TASK_KEY = "__item__" as const;

/** Task-level statuses a student may report. "graded" = done/passed. */
export const studentTaskStatusSchema = z.enum(["not_started", "in_progress", "submitted", "graded"]);
/** Item-level statuses a student may report. Official acceptance is never reportable. */
export const studentItemStatusSchema = z.enum(["not_started", "in_progress", "provider_complete"]);

export type StudentTaskStatus = z.infer<typeof studentTaskStatusSchema>;
export type StudentItemStatus = z.infer<typeof studentItemStatusSchema>;

export const studentProgressUpdateSchema = z
  .object({
    itemKey: roadmapKeySchema,
    /** null = item-level status. */
    taskKey: roadmapKeySchema.nullable(),
    status: z.union([studentTaskStatusSchema, studentItemStatusSchema]),
    /** Revision of the progress row the client saw; 0 when none existed. */
    expectedRevision: z.number().int().min(0),
  })
  .strict();
export type StudentProgressUpdate = z.infer<typeof studentProgressUpdateSchema>;

/** One stored progress row, as the projection consumes it. */
export interface RoadmapProgressRecord {
  readonly itemKey: string;
  /** ITEM_LEVEL_TASK_KEY for item-level rows. */
  readonly taskKey: string;
  readonly status: StudentTaskStatus | StudentItemStatus;
  readonly revision: number;
  readonly updatedAt: string;
}

// ── Student-facing view: GET /api/student/roadmap ───────────────────────────

export const STUDENT_ROADMAP_CONTRACT = "student-roadmap/1" as const;

/**
 * Derived stage of an item, in order. Only "officially_accepted" reflects an
 * institutional decision (canonical record via linkedCreditRecordId).
 */
export type StudentItemStage =
  | "not_started"
  | "in_progress"
  /** Every task submitted or graded, at least one only submitted. */
  | "submitted"
  /** Every task graded (or no tasks and student marked in progress → no). */
  | "graded"
  /** Student reported the course complete at the provider. */
  | "provider_complete"
  /** Linked canonical credit record is VERIFIED_APPLIED or VERIFIED_NOT_APPLIED. */
  | "officially_accepted";

export interface StudentTaskView {
  readonly key: string;
  readonly kind: RoadmapTaskKind;
  readonly title: string;
  readonly status: StudentTaskStatus;
  readonly revision: number;
  readonly updatedAt: string | null;
}

export interface StudentRoadmapItemView {
  readonly key: string;
  readonly phaseKey: string;
  readonly objectiveKey: string;
  readonly sequence: number;
  readonly kind: RoadmapItem["kind"];
  readonly code: string | null;
  readonly title: string;
  readonly provider: string | null;
  readonly institution: string | null;
  readonly credits: string | null;
  readonly plannedStart: string | null;
  readonly plannedEnd: string | null;
  readonly planStatus: RoadmapItem["planStatus"];
  readonly holdReason: string | null;
  readonly approval: { readonly required: boolean; readonly status: "pending" | "approved" | "not_required" } | null;
  readonly alternativeOf: string | null;
  readonly studentNote: string | null;
  /** Dependencies not yet provider-complete / officially accepted. */
  readonly waitingOn: readonly { readonly itemKey: string; readonly title: string }[];
  readonly itemStatus: StudentItemStatus;
  readonly itemRevision: number;
  readonly tasks: readonly StudentTaskView[];
  readonly taskCounts: {
    readonly total: number;
    readonly graded: number;
    readonly submitted: number;
    readonly inProgress: number;
    readonly notStarted: number;
  };
  readonly stage: StudentItemStage;
  /** From the canonical record via the staff link; null when not linked. */
  readonly official: {
    readonly standing: StudentCreditStanding;
    readonly awardedCredits: string | null;
  } | null;
  /** False for dropped/alternative items. Hold still allows reporting. */
  readonly canReport: boolean;
}

export interface StudentRoadmapPhaseView {
  readonly key: string;
  readonly title: string;
  readonly sequence: number;
  readonly objectiveKey: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly description: string | null;
  readonly items: readonly StudentRoadmapItemView[];
  /** Counts over active items only (planStatus planned or hold). */
  readonly counts: StudentRoadmapCounts;
  readonly state: "complete" | "current" | "upcoming";
}

/** Plain counts. No weighted overall percentage anywhere. */
export interface StudentRoadmapCounts {
  readonly itemsTotal: number;
  readonly itemsOfficiallyAccepted: number;
  readonly itemsProviderComplete: number;
  readonly itemsInProgress: number;
  readonly itemsNotStarted: number;
  readonly tasksTotal: number;
  readonly tasksGraded: number;
  readonly tasksSubmitted: number;
}

export interface StudentRoadmapObjectiveView {
  readonly key: string;
  readonly title: string;
  readonly kind: RoadmapObjective["kind"];
  readonly institution: string | null;
  readonly credentialLabel: string | null;
  readonly status: RoadmapObjective["status"];
  readonly note: string | null;
  /** For the linked primary objective: canonical program name, else null. */
  readonly canonicalProgramName: string | null;
  readonly counts: StudentRoadmapCounts;
}

export interface StudentRoadmapMilestoneView {
  readonly key: string;
  readonly title: string;
  readonly kind: RoadmapMilestone["kind"];
  readonly targetDate: string | null;
  readonly objectiveKey: string | null;
  readonly reached: boolean;
  readonly remainingItems: number;
}

/** "Your Foundation": canonical prior academic standing (from S04 view only). */
export interface StudentFoundationView {
  /** Prior degrees and credentials (credit records of type credential_award). */
  readonly credentials: readonly {
    readonly creditRecordId: string;
    readonly title: string;
    readonly completedOn: string | null;
    readonly reportedCredits: string | null;
    readonly awardedCredits: string | null;
    readonly standing: StudentCreditStanding;
    readonly sourceTitle: string | null;
    readonly sourceType: string | null;
  }[];
  readonly sources: readonly {
    readonly sourceId: string;
    readonly title: string;
    readonly sourceType: string;
    readonly status: string;
    readonly creditRecordCount: number;
  }[];
  /**
   * The credit ladder. Each value is an exact decimal string or null when not
   * produced by the canonical engine (e.g. applied while under review).
   *   reported:   on documents, not rejected (preliminary)
   *   provisional: reported but pending verification / needs review
   *   verified:   verified with an accepted staff decision (awarded credits)
   *   applied:    counted toward degree requirements (capped per requirement)
   *   surplus:    verified − applied (accepted but not needed by any requirement)
   *   planned:    credits of active roadmap items not yet officially accepted
   *   required:   total required by the degree
   */
  readonly ladder: {
    readonly reported: string;
    readonly provisional: string;
    readonly verified: string;
    readonly applied: string | null;
    readonly surplus: string | null;
    readonly planned: string;
    readonly required: string | null;
  };
  readonly degreeState: "COMPOSED" | "UNDER_REVIEW" | "NO_ACTIVE_PROGRAM";
}

export interface StudentTodayView {
  /** Up to 3 items to act on now: in-progress first, then next available. */
  readonly focusItemKeys: readonly string[];
  /** Single highest-priority message; never duplicated elsewhere. */
  readonly headline: string;
  readonly detail: string;
  readonly nextMilestoneKey: string | null;
}

export interface StudentRoadmapView {
  readonly contractVersion: typeof STUDENT_ROADMAP_CONTRACT;
  readonly state: "PUBLISHED" | "NOT_PUBLISHED";
  /** True when this is a staff preview of a draft (never for students). */
  readonly preview: boolean;
  readonly plan: {
    readonly title: string;
    readonly summary: string | null;
    readonly versionNumber: number;
    readonly publishedAt: string | null;
  } | null;
  readonly objectives: readonly StudentRoadmapObjectiveView[];
  readonly phases: readonly StudentRoadmapPhaseView[];
  readonly milestones: readonly StudentRoadmapMilestoneView[];
  readonly counts: StudentRoadmapCounts;
  readonly today: StudentTodayView;
  readonly foundation: StudentFoundationView;
  readonly history: {
    readonly previousVersions: readonly {
      readonly versionNumber: number;
      readonly publishedAt: string | null;
      readonly supersededAt: string | null;
    }[];
    /** Progress recorded on items no longer in the plan. Preserved, not transferred. */
    readonly retiredProgress: readonly {
      readonly itemKey: string;
      readonly title: string | null;
      readonly itemStatus: StudentItemStatus | null;
      readonly tasksGraded: number;
    }[];
  };
}

// ── Staff API: /api/admin/students/:studentId/roadmap ───────────────────────

export interface AdminRoadmapVersionSummary {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly status: "draft" | "published" | "superseded" | "discarded";
  readonly title: string;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
  readonly importId: string | null;
}

export interface AdminRoadmapDraftView {
  readonly versionId: string;
  readonly versionNumber: number;
  /** Optimistic-concurrency token for draft edits/ack/publish/discard. */
  readonly draftRevision: number;
  readonly baseVersionId: string | null;
  readonly content: RoadmapContent;
  readonly exceptions: readonly RoadmapException[];
  readonly acknowledgements: readonly RoadmapExceptionAcknowledgement[];
  readonly diff: RoadmapDiff;
  readonly import: {
    readonly importId: string;
    readonly templateId: string;
    readonly fileName: string | null;
    readonly fileSha256: string;
    readonly summary: ConversionSourceSummary;
  } | null;
  /** True when no blocking exceptions and every warning is acknowledged. */
  readonly publishable: boolean;
}

export interface AdminRoadmapState {
  readonly studentId: string;
  readonly planId: string | null;
  readonly published: (AdminRoadmapVersionSummary & { readonly content: RoadmapContent }) | null;
  readonly draft: AdminRoadmapDraftView | null;
  readonly versions: readonly AdminRoadmapVersionSummary[];
}

/**
 * Endpoints (all JSON; errors are { error: { code, message } }):
 *
 * Staff (roles staff + admin unless noted), student resolved from :studentId:
 *   GET    /api/admin/students/:studentId/roadmap                       → AdminRoadmapState
 *   POST   /api/admin/students/:studentId/roadmap/imports               → AdminRoadmapState (201, or 200 if idempotent replay)
 *            multipart/form-data field "workbook" (.xlsx)  OR  JSON body RoadmapImportPackage
 *            query replaceDraft=true to discard an existing open draft; else 409 ROADMAP_DRAFT_EXISTS
 *            idempotency: same student + same file sha256 + same base published version → existing draft returned
 *   PUT    /api/admin/students/:studentId/roadmap/draft                 → AdminRoadmapState
 *            { expectedDraftRevision, content }  (re-validated; acks kept by exception key)
 *   POST   /api/admin/students/:studentId/roadmap/draft/acknowledge     → AdminRoadmapState
 *            { expectedDraftRevision, exceptionKeys: string[], note?: string }
 *   GET    /api/admin/students/:studentId/roadmap/draft/preview         → StudentRoadmapView (preview: true)
 *   POST   /api/admin/students/:studentId/roadmap/draft/publish  (ADMIN ONLY) → AdminRoadmapState
 *            { expectedDraftRevision, expectedPublishedVersionId: string | null }
 *            409 ROADMAP_STALE_DRAFT when the draft or the published base changed,
 *            422 ROADMAP_NOT_PUBLISHABLE when blocking/unacknowledged exceptions remain.
 *   POST   /api/admin/students/:studentId/roadmap/draft/discard         → AdminRoadmapState
 *            { expectedDraftRevision }
 *   POST   /api/admin/students/:studentId/roadmap/draft/from-published  → AdminRoadmapState
 *            {} — opens a draft copied from the published version for manual edits
 *
 * Student (role student; student resolved ONLY from the authenticated user;
 * any studentId in path/query/body is rejected with 400):
 *   GET    /api/student/roadmap            → StudentRoadmapView (published only)
 *   POST   /api/student/roadmap/progress   → StudentRoadmapView (authoritative, after the write)
 *            body StudentProgressUpdate; 409 ROADMAP_PROGRESS_CONFLICT on revision mismatch,
 *            404 ROADMAP_ITEM_NOT_FOUND when the key is not in the CURRENT published version,
 *            422 ROADMAP_ITEM_NOT_REPORTABLE for dropped/alternative items or a status
 *            that does not match the level (task vs item).
 */
export const ROADMAP_ERROR_CODES = [
  "ROADMAP_VALIDATION_ERROR",
  "ROADMAP_STUDENT_NOT_FOUND",
  "ROADMAP_NOT_FOUND",
  "ROADMAP_DRAFT_EXISTS",
  "ROADMAP_NO_DRAFT",
  "ROADMAP_STALE_DRAFT",
  "ROADMAP_NOT_PUBLISHABLE",
  "ROADMAP_IMPORT_UNREADABLE",
  "ROADMAP_PROGRESS_CONFLICT",
  "ROADMAP_ITEM_NOT_FOUND",
  "ROADMAP_ITEM_NOT_REPORTABLE",
] as const;
export type RoadmapErrorCode = (typeof ROADMAP_ERROR_CODES)[number];

// ── Excel template "lumiere-roadmap-v1" (the reference template) ────────────
/**
 * Workbook layout. Header matching is case/space/punctuation-insensitive and
 * accepts the aliases listed. Unknown columns → UNMAPPED_COLUMN (info).
 *
 * Sheet "Plan" (required; aliases "Roadmap", first sheet if neither exists)
 *   Row 1 headers. One row per roadmap item. Columns:
 *     Phase*            (aliases: Stage, Term, Block)      — phase title; phase key = slug
 *     Objective         (aliases: Degree, Goal, Track)     — objective title or key; default primary
 *     Seq               (aliases: Order, #, Sequence)      — integer; default row order
 *     Code              (aliases: Course Code, Course #)
 *     Title*            (aliases: Course, Course Title, Course Name, Item)
 *     Provider          (aliases: Source, Platform)        — e.g. Sophia, Study.com, UMPI
 *     Institution       (aliases: Credit To, School)
 *     Credits           (aliases: Cr, Credit Hours, SH)
 *     Start             (aliases: Start Date, Planned Start)
 *     End               (aliases: End Date, Target, Target End, Due)
 *     Depends On        (aliases: Prereq, Prerequisites)   — comma list of Plan Keys / codes
 *     Status            (aliases: Plan Status)             — Planned | Hold | Alternative | Dropped
 *     Hold Reason
 *     Approval          — Required | Pending | Approved (anything else → not_required)
 *     Alternative For   — Plan Key / code of the item this replaces as an alternative
 *     Challenges | Milestones | Touchstones | Papers | Quizzes | Exams | Assignments
 *                       — integer counts; generate tasks "challenge-1".."challenge-N", etc.
 *     Tasks             — free list "Touchstone 1; Final Exam" (each → task kind by keyword)
 *     Kind              — Course | Exam | Application | Task
 *     Student Note      (alias: Notes)
 *     Staff Note        (alias: Internal Note)
 *     Plan Key          (aliases: Key, ID)                 — stable item key; when absent the key is
 *                       generated slug(objectiveKey + "-" + (code || title)) and GENERATED_ITEM_KEY (info)
 *     Condition         — text → CONDITIONAL_ALLOCATION (warning)
 *   Rows whose Title and Code are both empty are skipped silently; a row whose first
 *   cell starts with "#" is a comment. Header-like repeated rows → ROW_SKIPPED.
 *
 * Sheet "Objectives" (optional): Key | Title* | Kind (Primary/Secondary/Parallel/Prerequisite)
 *   | Institution | Credential | Status | Note.  First primary is linkedToProgramAssignment.
 *   Absent → one primary objective titled from the "Plan Title" or "Primary degree".
 *
 * Sheet "Milestones" (optional): Key | Title* | Kind | Target Date | Objective | After (comma list)
 *
 * Sheet "About" (optional): two columns Label | Value; recognised labels
 *   "Plan Title", "Summary", "Primary Degree", "Institution".
 *
 * Dates: Excel date cells, "YYYY-MM-DD", "M/D/YYYY", "Mon YYYY" (→ 1st of month).
 */
export const ROADMAP_TEMPLATE_V1_ID = "lumiere-roadmap-v1" as const;
