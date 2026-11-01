/**
 * S29 — Student Intelligence & Operations: shared contracts.
 *
 * One connected chain:
 *   recorded facts -> rules engine (attention items) -> concierge (student reminders) -> notification outbox
 *   -> in-portal inbox + email (Resend via server/lib/email.ts deliverEmail)
 *   Control Center (Needs Attention) and Fleet AI read the SAME attention items; the Diagnostics Studio
 *   watches every link (jobs, outbox, imports, calendar).
 *
 * Integrity rules encoded here:
 *   - Every attention item and reminder comes from a recorded fact (`reason.facts`), never from AI.
 *   - Claim levels keep student/provider claims apart from institution-verified outcomes. An import can never
 *     create an institution-verified outcome; it can only REQUEST verification through the existing review flow.
 *   - Delivery states are what actually happened; "accepted" means the provider accepted the message.
 */
import { z } from "zod";

// ── attention (rules engine output) ─────────────────────────────────────────

export const ATTENTION_KINDS = [
  // from the S27 Control Center rules (same detection, one source of truth)
  "document_review", "payment_evidence", "payment_overdue", "payment_missing", "deadline_soon",
  "inactive", "low_grade", "school_result_needed", "elective_approval", "session_request", "support_reply",
  // S29 additions
  "checkpoint_missed", "checkpoint_soon", "orientation_upcoming", "import_verification", "notification_failed",
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export const ATTENTION_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type AttentionPriority = (typeof ATTENTION_PRIORITIES)[number];

export const ATTENTION_STATUSES = ["open", "dismissed", "resolved"] as const;
export type AttentionStatus = (typeof ATTENTION_STATUSES)[number];

/** Workflow an item belongs to (filter facet). */
export const ATTENTION_WORKFLOWS = ["academic", "documents", "billing", "support", "appointments", "operations"] as const;
export type AttentionWorkflow = (typeof ATTENTION_WORKFLOWS)[number];

export interface AttentionReason {
  /** Stable rule identifier, e.g. "inactive.days" */
  readonly rule: string;
  /** Recorded facts that triggered the rule (dates, counts, ids). No message bodies, no contact data. */
  readonly facts: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AttentionItemView {
  /** Deterministic dedupe key, e.g. "inactive:<studentId>" */
  readonly key: string;
  readonly kind: AttentionKind;
  readonly workflow: AttentionWorkflow;
  readonly priority: AttentionPriority;
  readonly status: AttentionStatus;
  readonly studentId: string | null;
  readonly studentName: string | null;
  readonly studentCode: string | null;
  readonly isDemo: boolean;
  /** What needs attention (English fallback; the client renders `attn.kind.<kind>` with reason facts). */
  readonly title: string;
  readonly detail: string;
  readonly reason: AttentionReason;
  /** When the underlying issue arose (fact date), if known. */
  readonly arisenAt: string | null;
  /** When the rules engine first saw it. */
  readonly detectedAt: string;
  readonly lastSeenAt: string;
  /** Recommended next action key (client: `attn.action.<action>`). */
  readonly action: string;
  readonly href: string;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
  readonly resolution: string | null;
  /** Dismissed items reappear after this instant (snooze), or when the facts change. */
  readonly snoozedUntil: string | null;
}

export interface AttentionQueueView {
  readonly generatedAt: string;
  /** Source of the list: "store" (persisted, with history) or "live" (computed now; S29 schema not applied). */
  readonly source: "store" | "live";
  readonly items: readonly AttentionItemView[];
  readonly recentlyClosed: readonly AttentionItemView[];
  /** Real students only (demo excluded). */
  readonly counts: { readonly open: number; readonly urgent: number; readonly high: number; readonly dueThisWeek: number; readonly closed7d: number };
  readonly lastSyncAt: string | null;
  readonly truncated: boolean;
}

export const attentionActionSchema = z.object({
  action: z.enum(["dismiss", "resolve", "reopen"]),
  note: z.string().trim().max(500).optional(),
  /** Dismiss only: hide for N days (1-30). Without it, the item stays dismissed until its facts change. */
  snoozeDays: z.number().int().min(1).max(30).optional(),
}).strict();
export type AttentionActionInput = z.infer<typeof attentionActionSchema>;

// ── concierge settings and preferences ──────────────────────────────────────

export const conciergeSettingsSchema = z.object({
  enabled: z.boolean(),
  inactiveDays: z.number().int().min(3).max(60),
  deadlineWindowDays: z.number().int().min(1).max(60),
  paymentReminderDays: z.number().int().min(1).max(30),
  orientationReminderHours: z.number().int().min(2).max(96),
  supportUnansweredHours: z.number().int().min(4).max(168),
  /** Same reminder (rule + subject) is not repeated within this many days. */
  repeatAfterDays: z.number().int().min(1).max(30),
  /** Global cap of concierge messages per student per rolling 7 days. */
  maxPerWeek: z.number().int().min(1).max(14),
  /** Language when the student has not chosen one (first pilot: French). */
  defaultLanguage: z.enum(["en", "fr"]),
}).strict();
export type ConciergeSettings = z.infer<typeof conciergeSettingsSchema>;

export const DEFAULT_CONCIERGE_SETTINGS: ConciergeSettings = {
  enabled: true,
  inactiveDays: 7,
  deadlineWindowDays: 14,
  paymentReminderDays: 7,
  orientationReminderHours: 24,
  supportUnansweredHours: 24,
  repeatAfterDays: 7,
  maxPerWeek: 3,
  defaultLanguage: "fr",
};

export const NOTIFICATION_CATEGORIES = ["support", "documents", "roadmap", "progress", "billing", "appointments", "operations"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const notificationPreferencesSchema = z.object({
  /** Email per category; the in-portal inbox always receives every notification. */
  email: z.record(z.enum(NOTIFICATION_CATEGORIES), z.boolean()),
  quietHours: z.object({ enabled: z.boolean(), start: hhmm, end: hhmm }).strict(),
  /** IANA zone; null = the student record's time zone, else UTC. */
  timeZone: z.string().max(64).nullable(),
  /** Max reminder emails per day (support replies and document decisions are not reminders). */
  maxRemindersPerDay: z.number().int().min(0).max(5),
}).strict();
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  email: { support: true, documents: true, roadmap: true, progress: true, billing: true, appointments: true, operations: true },
  quietHours: { enabled: true, start: "21:00", end: "08:00" },
  timeZone: null,
  maxRemindersPerDay: 1,
};

// ── notifications (outbox + inbox) ──────────────────────────────────────────

/**
 * Delivery state of the email channel. In-app delivery is immediate (the inbox row is the record).
 *   queued          waiting for the scheduler (or for quiet hours to end)
 *   attempted       a send is in progress / was attempted and will be retried
 *   accepted        the email provider accepted the message (not proof of inbox delivery)
 *   failed          bounded retries exhausted, or permanently rejected
 *   not_configured  email transport is not configured (EMAIL_ENABLED/EMAIL_FROM/RESEND_API_KEY)
 *   suppressed      intentionally not emailed: synthetic account, preference off, no address, frequency cap
 *   in_app_only     this notification has no email channel
 */
export const EMAIL_STATES = ["queued", "attempted", "accepted", "failed", "not_configured", "suppressed", "in_app_only"] as const;
export type EmailState = (typeof EMAIL_STATES)[number];

export interface NotificationView {
  readonly id: string;
  readonly category: NotificationCategory;
  readonly template: string;
  readonly language: "en" | "fr";
  readonly title: string;
  readonly body: string;
  readonly href: string | null;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export interface InboxView {
  readonly items: readonly NotificationView[];
  readonly unread: number;
}

export interface OutboxRowView {
  readonly id: string;
  readonly audience: "student" | "staff";
  readonly studentId: string | null;
  readonly studentName: string | null;
  readonly isDemo: boolean;
  readonly category: NotificationCategory;
  readonly template: string;
  readonly source: string;
  readonly emailState: EmailState;
  readonly suppressedReason: string | null;
  readonly attempts: number;
  readonly nextAttemptAt: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly sentAt: string | null;
  readonly readAt: string | null;
}

export interface OutboxView {
  readonly rows: readonly OutboxRowView[];
  readonly counts: Readonly<Record<EmailState, number>>;
  readonly emailConfigured: boolean;
  readonly scheduler: { readonly lastTickAt: string | null; readonly lastDeliverySuccessAt: string | null };
}

// ── calendar ────────────────────────────────────────────────────────────────

export const CALENDAR_KINDS = ["milestone", "submission", "orientation", "advisor", "document", "support", "checkpoint", "billing"] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export interface CalendarEventView {
  /** Stable id: "<source>:<record id>[:<sub>]" (also the iCalendar UID prefix). */
  readonly id: string;
  readonly kind: CalendarKind;
  readonly source: "orientation_sessions" | "student_checkpoints" | "student_agreements" | "billing" | "roadmap" | "calendar_events";
  readonly studentId: string;
  readonly studentName: string | null;
  readonly isDemo: boolean;
  readonly title: string;
  /** ISO instant for timed events; for all-day events the date at 00:00Z and allDay = true. */
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly allDay: boolean;
  readonly status: "scheduled" | "requested" | "done" | "cancelled" | "overdue";
  readonly href: string;
  /** Staff may reschedule / cancel (only S29 calendar events and orientation sessions). */
  readonly editable: boolean;
  readonly updatedAt: string | null;
}

export interface CalendarView {
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
  readonly events: readonly CalendarEventView[];
  readonly truncated: boolean;
}

export const createCalendarEventSchema = z.object({
  studentId: z.string().trim().min(1).max(128),
  kind: z.enum(["advisor", "document", "support", "submission", "milestone"]),
  title: z.string().trim().min(1).max(140),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  allDay: z.boolean().default(false),
  /** Shown to the student when true (internal staff-only events otherwise). */
  visibleToStudent: z.boolean().default(true),
}).strict();
export type CreateCalendarEventInput = z.infer<typeof createCalendarEventSchema>;

export const updateCalendarEventSchema = z.object({
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  title: z.string().trim().min(1).max(140).optional(),
  status: z.enum(["scheduled", "cancelled", "done"]).optional(),
}).strict();
export type UpdateCalendarEventInput = z.infer<typeof updateCalendarEventSchema>;

export interface CalendarSubscriptionView {
  readonly id: string;
  readonly label: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}

// ── academic imports ────────────────────────────────────────────────────────

/** What a row claims. Only the review workflow can turn a claim into an institution-verified outcome. */
export const CLAIM_LEVELS = ["reported", "completed", "submitted", "school_result"] as const;
export type ClaimLevel = (typeof CLAIM_LEVELS)[number];

export const IMPORT_FIELDS = ["student_code", "course_code", "activity", "status", "score_percent", "credits", "activity_date", "provider", "reference"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_KINDS = ["provider_progress", "school_results", "course_worksheet", "generic"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export type ImportRowOutcome = "new" | "changed" | "unchanged" | "duplicate_in_file" | "invalid" | "conflict";

export interface ImportRowView {
  readonly rowNumber: number;
  readonly outcome: ImportRowOutcome;
  readonly studentCode: string | null;
  readonly studentId: string | null;
  readonly courseCode: string | null;
  readonly activity: string | null;
  readonly claimLevel: ClaimLevel | null;
  readonly scorePercent: number | null;
  readonly credits: number | null;
  readonly activityDate: string | null;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly changes: readonly { readonly field: string; readonly from: string | null; readonly to: string | null }[];
}

export interface ImportBatchView {
  readonly id: string;
  readonly status: "previewed" | "committed" | "discarded";
  readonly kind: ImportKind;
  readonly fileName: string;
  readonly fileSha256: string;
  readonly sheet: string | null;
  readonly headers: readonly string[];
  readonly mapping: Readonly<Partial<Record<ImportField, number>>>;
  readonly defaultClaimLevel: ClaimLevel;
  readonly scopeStudentId: string | null;
  readonly counts: Readonly<Record<ImportRowOutcome, number>>;
  readonly rows: readonly ImportRowView[];
  readonly createdAt: string;
  readonly createdBy: string;
  readonly committedAt: string | null;
  readonly committedBy: string | null;
  /** True when this exact file was already committed (idempotent replay). */
  readonly replayOf: string | null;
}

export const importPreviewOptionsSchema = z.object({
  templateId: z.string().uuid().optional(),
  mapping: z.record(z.enum(IMPORT_FIELDS), z.number().int().min(0).max(79)).optional(),
  defaultClaimLevel: z.enum(CLAIM_LEVELS).default("reported"),
  scopeStudentId: z.string().trim().min(1).max(128).optional(),
  sheet: z.string().max(64).optional(),
}).strict();
export type ImportPreviewOptions = z.infer<typeof importPreviewOptionsSchema>;

export const importTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(IMPORT_KINDS),
  /** Header text (normalised) per field. */
  columns: z.record(z.enum(IMPORT_FIELDS), z.string().trim().min(1).max(120)),
  defaultClaimLevel: z.enum(CLAIM_LEVELS),
}).strict();
export type ImportTemplateInput = z.infer<typeof importTemplateSchema>;

export interface ImportTemplateView extends ImportTemplateInput { readonly id: string; readonly createdAt: string }

// ── diagnostics ─────────────────────────────────────────────────────────────

export const HEALTH_STATES = ["live", "healthy", "degraded", "failed", "not_configured", "unknown"] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

export interface SubsystemView {
  readonly key: string;
  readonly state: HealthState;
  readonly checkedAt: string;
  readonly latencyMs: number | null;
  /** Short evidence lines (no secrets, no student data). */
  readonly evidence: readonly string[];
}

export interface FeatureReadinessView {
  readonly key: string;
  readonly state: HealthState;
  readonly evidence: readonly string[];
}

export interface IncidentView {
  readonly id: string;
  readonly fingerprint: string;
  readonly subsystem: string;
  readonly category: string;
  readonly severity: "info" | "warning" | "critical";
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly occurrences: number;
  readonly lastRequestId: string | null;
  readonly status: "open" | "acknowledged" | "resolved";
  readonly likelyCause: string | null;
  readonly nextAction: string | null;
  readonly acknowledgedBy: string | null;
}

export interface JobView {
  readonly name: string;
  readonly intervalSeconds: number;
  readonly lastStartedAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastError: string | null;
  readonly consecutiveFailures: number;
  readonly runs: number;
  readonly state: HealthState;
}

export interface ReleaseView {
  readonly appUrl: string | null;
  readonly environment: string;
  /** SHA the running process reports (release.json written by the release runner). */
  readonly runningSha: string | null;
  /** SHA in release/S26_RELEASE_SHA on the release branch (fetched; null if unreachable). */
  readonly markerSha: string | null;
  readonly markerCheckedAt: string | null;
  readonly isApprovedReleaseLive: boolean | null;
  readonly processStartedAt: string;
  readonly releaseFileWrittenAt: string | null;
  readonly customDomain: { readonly host: string; readonly state: HealthState; readonly evidence: string };
}

export interface DiagnosticsView {
  readonly generatedAt: string;
  readonly summary: { readonly state: HealthState; readonly headline: string; readonly openIncidents: number; readonly failingSubsystems: number };
  readonly release: ReleaseView;
  readonly subsystems: readonly SubsystemView[];
  readonly features: readonly FeatureReadinessView[];
  readonly jobs: readonly JobView[];
  readonly incidents: readonly IncidentView[];
}

export const DIAGNOSTIC_CHECKS = [
  "programs_page", "profile_access", "document_storage", "support_academic_apis", "email", "scheduler", "schema", "release",
] as const;
export type DiagnosticCheckKey = (typeof DIAGNOSTIC_CHECKS)[number];

export interface DiagnosticCheckResult {
  readonly key: DiagnosticCheckKey;
  readonly state: HealthState;
  readonly ranAt: string;
  readonly durationMs: number;
  readonly steps: readonly { readonly label: string; readonly ok: boolean | null; readonly detail: string }[];
  readonly conclusion: string;
  readonly nextAction: string | null;
}

// ── fleet copilot ───────────────────────────────────────────────────────────

export const fleetQuestionSchema = z.object({
  question: z.string().trim().min(1).max(600),
  language: z.enum(["en", "fr"]),
  includeDemo: z.boolean().default(false),
}).strict();
export type FleetQuestionInput = z.infer<typeof fleetQuestionSchema>;

export type FleetIntent = "attention_today" | "no_recent_progress" | "documents_blocking" | "week_priorities" | "support_waiting" | "draft_followups" | "overview";

export interface FleetReference {
  /** [A1], [A2]... cites an attention item; the UI links to `href`. */
  readonly ref: string;
  readonly key: string;
  readonly studentId: string | null;
  readonly studentName: string | null;
  readonly isDemo: boolean;
  readonly label: string;
  readonly href: string;
  /** "fact" (recorded), "student_reported" (claim) or "verified" (institution-confirmed). */
  readonly provenance: "fact" | "student_reported" | "verified";
}

export interface FleetDraft {
  readonly studentId: string;
  readonly studentName: string;
  readonly language: "en" | "fr";
  readonly subject: string;
  readonly body: string;
  readonly basedOn: readonly string[];
}

export interface FleetAnswer {
  readonly intent: FleetIntent;
  /** Deterministic answer built from the attention items (always present; not AI). */
  readonly summary: string;
  readonly lines: readonly { readonly text: string; readonly refs: readonly string[] }[];
  readonly references: readonly FleetReference[];
  readonly drafts: readonly FleetDraft[];
  /** Optional AI narrative over AGGREGATE counts only (no names, codes, ids, documents or messages). */
  readonly ai: { readonly mode: "live" | "unavailable" | "not_requested"; readonly reason?: string; readonly text: string | null; readonly model?: { readonly requested: string; readonly served: string | null } };
  readonly privacy: string;
  readonly requiresHumanApproval: true;
  readonly generatedAt: string;
}

export const S29_ERROR_CODES = {
  UNAVAILABLE: "S29_UNAVAILABLE",
  VALIDATION: "S29_VALIDATION_FAILED",
  NOT_FOUND: "S29_NOT_FOUND",
  FORBIDDEN: "S29_FORBIDDEN",
  CONFLICT: "S29_CONFLICT",
  IMPORT_INVALID_FILE: "S29_IMPORT_INVALID_FILE",
} as const;

// ── HTTP surface (mounted in server/routes.ts) ──────────────────────────────

export const S29_API = {
  // student (role student; the student is resolved from the session)
  inbox: "/api/student/s29/notifications",
  inboxRead: "/api/student/s29/notifications/read",
  preferences: "/api/student/s29/notifications/preferences",
  studentCalendar: "/api/student/s29/calendar",
  studentCalendarIcs: "/api/student/s29/calendar.ics",
  subscriptions: "/api/student/s29/calendar/subscriptions",
  subscription: (id: string) => `/api/student/s29/calendar/subscriptions/${encodeURIComponent(id)}`,
  // staff (admin + staff unless noted)
  attention: "/api/admin/s29/attention",
  attentionAction: (key: string) => `/api/admin/s29/attention/${encodeURIComponent(key)}/action`,
  attentionSync: "/api/admin/s29/attention/sync", // admin
  conciergeSettings: "/api/admin/s29/concierge/settings", // admin (GET/PUT)
  outbox: "/api/admin/s29/notifications",
  outboxRetry: (id: string) => `/api/admin/s29/notifications/${encodeURIComponent(id)}/retry`, // admin
  staffCalendar: "/api/admin/s29/calendar",
  staffCalendarIcs: "/api/admin/s29/calendar.ics",
  calendarEvents: "/api/admin/s29/calendar/events", // admin POST
  calendarEvent: (id: string) => `/api/admin/s29/calendar/events/${encodeURIComponent(id)}`, // admin PATCH
  staffSubscriptions: "/api/admin/s29/calendar/subscriptions",
  staffSubscription: (id: string) => `/api/admin/s29/calendar/subscriptions/${encodeURIComponent(id)}`,
  imports: "/api/admin/s29/imports",
  importPreview: "/api/admin/s29/imports/preview", // multipart: file + options (JSON string)
  importBatch: (id: string) => `/api/admin/s29/imports/${encodeURIComponent(id)}`,
  importRemap: (id: string) => `/api/admin/s29/imports/${encodeURIComponent(id)}/remap`,
  importCommit: (id: string) => `/api/admin/s29/imports/${encodeURIComponent(id)}/commit`,
  importDiscard: (id: string) => `/api/admin/s29/imports/${encodeURIComponent(id)}/discard`,
  importTemplates: "/api/admin/s29/imports/templates",
  importTemplate: (id: string) => `/api/admin/s29/imports/templates/${encodeURIComponent(id)}`,
  fleetAsk: "/api/admin/s29/fleet/ask", // admin
  diagnostics: "/api/admin/s29/diagnostics", // admin
  diagnosticCheck: (key: string) => `/api/admin/s29/diagnostics/checks/${encodeURIComponent(key)}`, // admin POST
  incidents: "/api/admin/s29/diagnostics/incidents", // admin
  incident: (id: string) => `/api/admin/s29/diagnostics/incidents/${encodeURIComponent(id)}`, // admin POST { action }
  schedulerRun: "/api/admin/s29/diagnostics/scheduler/run", // admin POST
  // public, token-authenticated calendar feed (revocable)
  feed: (token: string) => `/api/calendar/feed/${token}.ics`,
} as const;

/** Import batch list item (no rows). */
export type ImportBatchSummary = Omit<ImportBatchView, "rows" | "headers" | "mapping">;
