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
  // S32-B: a validated (or approved) import batch waiting for the owner to commit it
  "import_awaiting_approval",
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
  // Off until the owner reviews the Needs Attention queue and switches the Concierge on (no student emails before that).
  enabled: false,
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

export type FleetIntent = "attention_today" | "no_recent_progress" | "documents_blocking" | "week_priorities" | "support_waiting" | "draft_followups" | "overview"
  /** S30 Phase C: answered from the S30 academic calendar and the Control Center pace (server/services/s30/fleet-context.ts). */
  | "deadlines_soon" | "behind_pace";

export interface FleetReference {
  /** [A1], [A2]... cites an attention item; the UI links to `href`. */
  readonly ref: string;
  readonly key: string;
  readonly studentId: string | null;
  readonly studentName: string | null;
  readonly isDemo: boolean;
  readonly label: string;
  readonly href: string;
  /** "fact" (recorded), "student_reported" (claim), "reported" (provider/school import, not official) or "verified" (institution-confirmed). */
  readonly provenance: "fact" | "student_reported" | "reported" | "verified";
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
} as const;

// ── HTTP surface (mounted in server/routes.ts) ──────────────────────────────

export const S29_API = {
  // student (role student; the student is resolved from the session)
  inbox: "/api/student/s29/notifications",
  inboxRead: "/api/student/s29/notifications/read",
  preferences: "/api/student/s29/notifications/preferences",
  // staff (admin + staff unless noted)
  attention: "/api/admin/s29/attention",
  attentionAction: (key: string) => `/api/admin/s29/attention/${encodeURIComponent(key)}/action`,
  attentionSync: "/api/admin/s29/attention/sync", // admin
  conciergeSettings: "/api/admin/s29/concierge/settings", // admin (GET/PUT)
  outbox: "/api/admin/s29/notifications",
  outboxRetry: (id: string) => `/api/admin/s29/notifications/${encodeURIComponent(id)}/retry`, // admin
  fleetAsk: "/api/admin/s29/fleet/ask", // admin
  diagnostics: "/api/admin/s29/diagnostics", // admin
  diagnosticCheck: (key: string) => `/api/admin/s29/diagnostics/checks/${encodeURIComponent(key)}`, // admin POST
  incidents: "/api/admin/s29/diagnostics/incidents", // admin
  incident: (id: string) => `/api/admin/s29/diagnostics/incidents/${encodeURIComponent(id)}`, // admin POST { action }
  schedulerRun: "/api/admin/s29/diagnostics/scheduler/run", // admin POST
} as const;
