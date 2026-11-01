/**
 * S30 shared contract. Phase A: Academic Calendar (month / week / agenda views for students and staff, reminders,
 * iCalendar export and revocable subscription feeds). Phase B: Academic Data Import Center.
 *
 * Academic integrity (enforced server-side and by the database):
 *   planned work (roadmap)  ->  student-reported progress (hs_task_progress)  ->  provider-reported progress (imports)
 *   ->  submitted evidence (student_documents)  ->  institution-verified outcomes (hs_official_results / credit awards).
 *   An import NEVER creates an official result, a credit award or a verified document. Its records carry an explicit
 *   tier ("provider_reported" | "institution_reported") and, when they report completion, a review flag.
 *
 * Tables: supabase/migrations/20261107100000_s30_academic_calendar.sql (Phase A) and
 * 20261107110000_s30_academic_imports.sql (Phase B). Server: server/services/s30/calendar*.ts,
 * routes server/routes/s30-calendar.ts. Dates are ISO strings; instants are UTC ("…Z"); date-only values are
 * "YYYY-MM-DD" and are never shifted by a time zone.
 *
 * The calendar owns no operational state: timeline events and reminder notifications go to the operational layer
 * owned by S29 through ONE port (server/services/s30/calendar-port.ts).
 */
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const instant = z.string().datetime({ offset: true });

// ── evidence tiers ──────────────────────────────────────────────────────────

export const EVIDENCE_TIERS = ["planned", "student_reported", "provider_reported", "institution_reported", "submitted_evidence", "verified"] as const;
export type EvidenceTier = (typeof EVIDENCE_TIERS)[number];

// ── Academic Data Import Center ─────────────────────────────────────────────

export const IMPORT_SOURCE_KINDS = ["provider_progress", "course_progress_report", "school_results"] as const;
export type ImportSourceKind = (typeof IMPORT_SOURCE_KINDS)[number];
/** Tier assigned to committed records by source kind. Never "verified". */
export const IMPORT_TIER_BY_SOURCE: Record<ImportSourceKind, "provider_reported" | "institution_reported"> = {
  provider_progress: "provider_reported",
  course_progress_report: "provider_reported",
  school_results: "institution_reported",
};
export const IMPORT_FIELDS = ["student_code", "course", "task", "progress_status", "percent_complete", "score_percent", "credits_reported", "reported_on"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const IMPORT_REQUIRED_FIELDS: readonly ImportField[] = ["student_code", "course"];
export type ImportColumnMapping = Partial<Record<ImportField, string>>;

export const IMPORT_STATUSES = ["uploaded", "validated", "approved", "committed", "rolled_back", "discarded"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 2000;

export const IMPORT_ISSUE_CODES = [
  "student_missing", "student_not_found", "course_missing", "course_not_on_plan", "bad_status", "bad_percent", "bad_score",
  "bad_credits", "bad_date", "future_date", "formula_text", "duplicate_in_file", "no_measure", "completion_needs_review",
  "credits_informational", "demo_student", "conflicting_value",
] as const;
export type ImportIssueCode = (typeof IMPORT_ISSUE_CODES)[number];
export interface ImportIssue { readonly code: ImportIssueCode; readonly field: ImportField | null; readonly severity: "error" | "warning" | "info" }

export interface ImportNormalizedRow {
  readonly studentCode: string | null;
  readonly course: string | null;
  readonly courseKey: string | null;
  readonly task: string | null;
  readonly progressStatus: "not_started" | "in_progress" | "completed" | null;
  readonly percentComplete: number | null;
  readonly scorePercent: number | null;
  readonly creditsReported: number | null;
  readonly reportedOn: string | null;
}
export interface ImportRowView {
  readonly rowNumber: number;
  readonly raw: Readonly<Record<string, string>>;
  readonly normalized: ImportNormalizedRow | null;
  readonly studentId: string | null;
  readonly studentName: string | null;
  readonly outcome: "pending" | "valid" | "warning" | "invalid";
  readonly diff: "new" | "changed" | "unchanged" | "duplicate_in_file" | null;
  readonly issues: readonly ImportIssue[];
  /** For "changed": the active record's values being replaced. */
  readonly previous: Partial<ImportNormalizedRow> | null;
}
export interface ImportCounts {
  readonly total: number;
  readonly valid: number;
  readonly warning: number;
  readonly invalid: number;
  readonly new: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly duplicateInFile: number;
  readonly students: number;
  readonly needsReview: number;
  readonly committed?: number;
  readonly rolledBack?: number;
}
export interface ImportBatchView {
  readonly id: string;
  readonly status: ImportStatus;
  readonly sourceKind: ImportSourceKind;
  readonly tier: "provider_reported" | "institution_reported";
  readonly providerLabel: string | null;
  readonly fileName: string | null;
  readonly fileFormat: "csv" | "xlsx";
  readonly fileSha256: string;
  readonly fileBytes: number;
  readonly sheetName: string | null;
  readonly headers: readonly string[];
  readonly mapping: ImportColumnMapping | null;
  readonly suggestedMapping: ImportColumnMapping;
  readonly mappingId: string | null;
  readonly counts: Partial<ImportCounts>;
  readonly uploadedBy: string | null;
  readonly uploadedAt: string;
  readonly validatedAt: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly committedBy: string | null;
  readonly committedAt: string | null;
  readonly rolledBackBy: string | null;
  readonly rolledBackAt: string | null;
  readonly rollbackReason: string | null;
  /** Same file (hash) already committed in another batch. */
  readonly duplicateOfBatchId: string | null;
}
export interface ImportBatchDetail extends ImportBatchView {
  readonly rows: readonly ImportRowView[];
  readonly rowsTruncated: boolean;
}
export interface ImportMappingView {
  readonly id: string;
  readonly name: string;
  readonly sourceKind: ImportSourceKind;
  readonly columns: ImportColumnMapping;
  readonly updatedAt: string;
}
const header = z.string().trim().min(1).max(120);
export const importMappingColumnsSchema = z
  .object(Object.fromEntries(IMPORT_FIELDS.map((f) => [f, header.optional()])) as Record<ImportField, z.ZodOptional<typeof header>>)
  .strict();
export const importUploadMetaSchema = z
  .object({
    sourceKind: z.enum(IMPORT_SOURCE_KINDS),
    providerLabel: z.string().trim().min(1).max(80).optional(),
    mappingId: z.string().uuid().optional(),
  })
  .strict();
export const importMapSchema = z
  .object({
    columns: importMappingColumnsSchema,
    saveAs: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
export const importRollbackSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
export const reviewReportedRecordSchema = z.object({ reviewState: z.enum(["reviewed", "needs_review"]) }).strict();

export interface ReportedRecordView {
  readonly id: string;
  readonly studentId: string;
  readonly tier: "provider_reported" | "institution_reported";
  readonly providerLabel: string | null;
  readonly courseKey: string | null;
  readonly courseLabel: string;
  readonly taskLabel: string | null;
  readonly progressStatus: "not_started" | "in_progress" | "completed" | null;
  readonly percentComplete: number | null;
  readonly scorePercent: number | null;
  readonly creditsReported: number | null;
  readonly reportedOn: string | null;
  readonly reviewState: "none" | "needs_review" | "reviewed";
  readonly batchId: string;
  readonly createdAt: string;
}

// ── Academic Calendar ───────────────────────────────────────────────────────

export const CALENDAR_ITEM_KINDS = [
  "academic_deadline", "document_deadline", "course_milestone", "orientation", "advisor_meeting", "support_session", "program_checkpoint",
] as const;
export type CalendarItemKind = (typeof CALENDAR_ITEM_KINDS)[number];
export const CALENDAR_EVENT_KINDS = ["advisor_meeting", "support_session", "program_checkpoint", "academic_deadline"] as const;
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];
export type CalendarItemSource = "agreement" | "checkpoint" | "orientation" | "calendar_event" | "roadmap" | "high_school_plan";
export type CalendarItemStatus = "scheduled" | "requested" | "done" | "cancelled" | "overdue";

export interface CalendarItem {
  /** Stable across reads: `${source}:${recordId}[:${subKey}]`. */
  readonly id: string;
  readonly kind: CalendarItemKind;
  readonly source: CalendarItemSource;
  readonly studentId: string;
  readonly studentName: string | null;
  readonly studentCode: string | null;
  readonly isDemo: boolean;
  /** Record data (course titles are data, never translated); `titleKey` when the title is a product label. */
  readonly title: string;
  readonly titleKey: string | null;
  /** All-day items: "YYYY-MM-DD". Timed items: UTC instant. */
  readonly start: string;
  readonly end: string | null;
  readonly allDay: boolean;
  /** IANA zone the item was scheduled in (display hint; timed instants are absolute). */
  readonly timeZone: string;
  readonly status: CalendarItemStatus;
  readonly location: string | null;
  /** Where the viewer acts on it (role-appropriate route). */
  readonly href: string;
  /** Viewer may reschedule/cancel through the calendar API. */
  readonly editable: boolean;
  /** For calendar_event items: the row id; for orientation: the session id. */
  readonly recordId: string;
}
export interface CalendarView {
  readonly from: string;
  readonly to: string;
  readonly generatedAt: string;
  readonly items: readonly CalendarItem[];
  readonly truncated: boolean;
}
const tz = z.string().trim().min(1).max(64).refine((v) => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }, "Unknown time zone");
export const calendarRangeSchema = z
  .object({ from: isoDate, to: isoDate, studentId: z.string().trim().min(1).max(128).optional(), includeDemo: z.enum(["0", "1"]).optional() })
  .strict()
  .refine((v) => v.from <= v.to, { message: "from must be on or before to" })
  .refine((v) => (Date.parse(`${v.to}T00:00:00Z`) - Date.parse(`${v.from}T00:00:00Z`)) / 86_400_000 <= 120, { message: "range is limited to 120 days" });
export const createCalendarEventSchema = z
  .object({
    studentId: z.string().trim().min(1).max(128),
    kind: z.enum(CALENDAR_EVENT_KINDS),
    title: z.string().trim().min(1).max(120),
    startsAt: instant,
    endsAt: instant.nullable().optional(),
    allDay: z.boolean().default(false),
    timeZone: tz.default("UTC"),
    location: z.string().trim().max(200).nullable().optional(),
    visibleToStudent: z.boolean().default(true),
    notify: z.boolean().default(true),
  })
  .strict()
  .refine((v) => !v.endsAt || Date.parse(v.endsAt) > Date.parse(v.startsAt), { message: "endsAt must be after startsAt", path: ["endsAt"] });
export type CreateCalendarEventInput = z.infer<typeof createCalendarEventSchema>;
export const updateCalendarEventSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    startsAt: instant.optional(),
    endsAt: instant.nullable().optional(),
    allDay: z.boolean().optional(),
    timeZone: tz.optional(),
    location: z.string().trim().max(200).nullable().optional(),
    visibleToStudent: z.boolean().optional(),
    status: z.enum(["scheduled", "cancelled"]).optional(),
    notify: z.boolean().default(true),
  })
  .strict();
export type UpdateCalendarEventInput = z.infer<typeof updateCalendarEventSchema>;

export interface CalendarSubscriptionView {
  readonly id: string;
  readonly scope: "student" | "staff";
  readonly privacy: "minimal" | "detailed";
  readonly label: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  /** Feed URL path; the token is shown ONCE, at creation (only its hash is stored). */
  readonly feedPath: string | null;
}
export const createSubscriptionSchema = z
  .object({ privacy: z.enum(["minimal", "detailed"]).default("minimal"), label: z.string().trim().max(60).optional() })
  .strict();

// ── API paths ───────────────────────────────────────────────────────────────

const enc = encodeURIComponent;
export const S30_API = {
  staffCalendar: "/api/admin/calendar",
  staffCalendarEvents: "/api/admin/calendar/events",
  staffCalendarEvent: (id: string) => `/api/admin/calendar/events/${enc(id)}`,
  staffCalendarIcs: "/api/admin/calendar/export.ics",
  staffSubscriptions: "/api/admin/calendar/subscriptions",
  staffSubscription: (id: string) => `/api/admin/calendar/subscriptions/${enc(id)}`,
  studentCalendar: "/api/student/calendar",
  studentCalendarIcs: "/api/student/calendar/export.ics",
  studentSubscriptions: "/api/student/calendar/subscriptions",
  studentSubscription: (id: string) => `/api/student/calendar/subscriptions/${enc(id)}`,
  feed: (token: string) => `/calendar/feed/${enc(token)}.ics`,
  imports: "/api/admin/imports",
  importBatch: (id: string) => `/api/admin/imports/${enc(id)}`,
  importMap: (id: string) => `/api/admin/imports/${enc(id)}/map`,
  importApprove: (id: string) => `/api/admin/imports/${enc(id)}/approve`,
  importCommit: (id: string) => `/api/admin/imports/${enc(id)}/commit`,
  importRollback: (id: string) => `/api/admin/imports/${enc(id)}/rollback`,
  importDiscard: (id: string) => `/api/admin/imports/${enc(id)}/discard`,
  importMappings: "/api/admin/imports/mappings",
  importTemplate: "/api/admin/imports/template.csv",
  reportedRecords: (studentId: string) => `/api/admin/students/${enc(studentId)}/reported-records`,
  reportedRecord: (studentId: string, id: string) => `/api/admin/students/${enc(studentId)}/reported-records/${enc(id)}`,
} as const;

export const S30_ERROR_CODES = {
  VALIDATION: "S30_VALIDATION_FAILED",
  NOT_FOUND: "S30_NOT_FOUND",
  FORBIDDEN: "S30_FORBIDDEN",
  INVALID_TRANSITION: "S30_INVALID_TRANSITION",
  UNAVAILABLE: "S30_UNAVAILABLE",
  DUPLICATE_SCHEDULE: "S30_DUPLICATE_SCHEDULE",
  FILE_REJECTED: "S30_FILE_REJECTED",
  THROTTLED: "THROTTLED",
} as const;

/** Audit event types written by the calendar routes (identifiers, kinds and counts only). In the enum via the S30 migration. */
export const S30_AUDIT_EVENTS = {
  calendarEventChanged: "calendar.event_changed",
  calendarSubscriptionChanged: "calendar.subscription_changed",
  calendarAccessDenied: "calendar.access_denied",
  importUploaded: "import.batch_uploaded",
  importValidated: "import.batch_validated",
  importApproved: "import.batch_approved",
  importCommitted: "import.batch_committed",
  importRolledBack: "import.batch_rolled_back",
  importDiscarded: "import.batch_discarded",
  mappingSaved: "import.mapping_saved",
  reportedRecordReviewed: "import.record_reviewed",
  importAccessDenied: "import.access_denied",
} as const;

/**
 * Role matrix (server-enforced):
 *  - admin + staff: read every student's calendar (demo students only on request), schedule / reschedule / cancel
 *    calendar events, export, manage their own staff feed links. Orientation sessions are rescheduled through the
 *    existing admin-only S27 endpoint.
 *  - student: reads only their own items (staff-only events excluded; a studentId parameter is refused), exports, and
 *    manages their own feed links.
 *  - coach: no calendar access.
 *  - Imports (Phase B): admin + staff upload, map, validate, preview and discard drafts; ONLY admin approves, commits,
 *    rolls back and marks imported records reviewed. Coaches and students have no access. Students are matched by
 *    student code only; a row can never attach data to a student by name.
 *  - feed URLs: a revocable 256-bit token (only its SHA-256 is stored); the owner's CURRENT role is re-checked on
 *    every fetch; "minimal" privacy shows only kinds (+ student code for staff), "detailed" shows titles and names.
 */
