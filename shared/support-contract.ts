/**
 * S08 — Student Support Center contract.
 *
 * Shared by server/routes/tickets.ts and the client support UI. Pure: no I/O.
 *
 * Storage stays on the EXISTING tables (support_tickets, ticket_comments,
 * ticket_attachments, ticket_status_history). The student-facing "topic" is a
 * finer-grained label stored in support_tickets.metadata.topic and mapped onto
 * the existing ticket_category enum, so no enum migration is needed.
 */
import { z } from "zod";

export const SUPPORT_CONTRACT_VERSION = "support/1" as const;

// ---------------------------------------------------------------------------
// Enums mirrored from the existing database types
// ---------------------------------------------------------------------------

export const TICKET_STATUSES = ["open", "in_progress", "waiting_on_student", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_CATEGORIES = ["academic", "technical", "billing", "document", "enrollment", "general"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Student-facing topics
// ---------------------------------------------------------------------------

export const SUPPORT_TOPICS = [
  "course_assistance",
  "roadmap_question",
  "transfer_credit",
  "transcript_document",
  "account_technical",
  "billing",
  "general",
] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export const SUPPORT_TOPIC_INFO: Readonly<Record<SupportTopic, {
  readonly label: string;
  readonly hint: string;
  readonly category: TicketCategory;
}>> = {
  course_assistance: {
    label: "Course or assignment help",
    hint: "Questions about a course, an assignment or an exam",
    category: "academic",
  },
  roadmap_question: {
    label: "Academic roadmap question",
    hint: "Your plan, sequencing or what comes next",
    category: "academic",
  },
  transfer_credit: {
    label: "University or transfer credit",
    hint: "Credit transfer, applications or university requirements",
    category: "enrollment",
  },
  transcript_document: {
    label: "Transcript or document problem",
    hint: "Transcripts, uploads or official documents",
    category: "document",
  },
  account_technical: {
    label: "Account or technical issue",
    hint: "Signing in, the Portal or something not working",
    category: "technical",
  },
  billing: {
    label: "Billing question",
    hint: "Invoices, payments or plan charges",
    category: "billing",
  },
  general: {
    label: "General support",
    hint: "Anything else we can help with",
    category: "general",
  },
};

/** Legacy tickets have no topic; derive a sensible label from the category. */
export function topicForTicket(metadata: unknown, category: TicketCategory): SupportTopic {
  const raw = (metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).topic : undefined);
  if (typeof raw === "string" && (SUPPORT_TOPICS as readonly string[]).includes(raw)) return raw as SupportTopic;
  switch (category) {
    case "academic": return "course_assistance";
    case "enrollment": return "transfer_credit";
    case "document": return "transcript_document";
    case "technical": return "account_technical";
    case "billing": return "billing";
    default: return "general";
  }
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export type SupportRole = "student" | "coach" | "staff" | "admin";

/** Admin and staff manage the whole queue; a coach only tickets assigned to them. */
export const isSupportManager = (role: string | undefined): boolean => role === "admin" || role === "staff";
export const isSupportStaffRole = (role: string | undefined): boolean =>
  role === "admin" || role === "staff" || role === "coach";

// ---------------------------------------------------------------------------
// One status vocabulary. Staff and students see different words for the same
// state on purpose (staff: queue triage; student: who has the ball), but both
// come from this single map so the correspondence is explicit and testable.
// ---------------------------------------------------------------------------

export const SUPPORT_STATUS_LABEL: Readonly<Record<TicketStatus, { readonly staff: string; readonly student: string }>> = {
  open: { staff: "New", student: "Received" },
  in_progress: { staff: "In progress", student: "With your advisor" },
  waiting_on_student: { staff: "Waiting on student", student: "Waiting for you" },
  resolved: { staff: "Resolved", student: "Resolved" },
  closed: { staff: "Closed", student: "Closed" },
};

export const staffStatusLabel = (status: TicketStatus): string => SUPPORT_STATUS_LABEL[status]?.staff ?? String(status);

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

/** Staff transitions. Anything not listed (including X -> X) is rejected. */
export const STAFF_STATUS_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  open: ["in_progress", "waiting_on_student", "resolved", "closed"],
  in_progress: ["waiting_on_student", "resolved", "closed"],
  waiting_on_student: ["in_progress", "resolved", "closed"],
  resolved: ["in_progress", "closed"],
  closed: ["in_progress"],
};

/** Closing or reopening a closed ticket is reserved for admin/staff. */
export function canStaffTransition(role: string | undefined, from: TicketStatus, to: TicketStatus): boolean {
  if (!isSupportStaffRole(role)) return false;
  if (!STAFF_STATUS_TRANSITIONS[from].includes(to)) return false;
  if ((to === "closed" || from === "closed") && !isSupportManager(role)) return false;
  return true;
}

/** Days after resolution during which a student reply reopens the ticket. */
export const STUDENT_REOPEN_WINDOW_DAYS = 14;

/**
 * Status a ticket moves to when its STUDENT posts a reply, or an error code
 * when the student may not reply at all. `null` means "no status change".
 */
export function statusAfterStudentReply(
  status: TicketStatus,
  resolvedAt: string | null | undefined,
  now: Date,
): { readonly ok: true; readonly next: TicketStatus | null } | { readonly ok: false; readonly code: "TICKET_CLOSED" | "REOPEN_WINDOW_EXPIRED" } {
  switch (status) {
    case "closed":
      return { ok: false, code: "TICKET_CLOSED" };
    case "resolved": {
      if (resolvedAt) {
        const ageMs = now.getTime() - new Date(resolvedAt).getTime();
        if (ageMs > STUDENT_REOPEN_WINDOW_DAYS * 86_400_000) return { ok: false, code: "REOPEN_WINDOW_EXPIRED" };
      }
      return { ok: true, next: "open" };
    }
    case "waiting_on_student":
      return { ok: true, next: "in_progress" };
    default:
      return { ok: true, next: null };
  }
}

// ---------------------------------------------------------------------------
// Who acts next, and service targets
// ---------------------------------------------------------------------------

export type SupportAwaiting = "staff" | "student" | "none";

export function awaitingFor(status: TicketStatus): SupportAwaiting {
  if (status === "waiting_on_student") return "student";
  if (status === "resolved" || status === "closed") return "none";
  return "staff";
}

/** First-response / follow-up target, in hours, while a ticket awaits staff. */
export const SUPPORT_TARGET_HOURS: Readonly<Record<TicketPriority, number>> = {
  urgent: 4,
  high: 24,
  medium: 48,
  low: 72,
};

/**
 * A ticket is overdue when it is waiting on staff and the clock (started by
 * the latest student activity, or creation) has run past the target.
 */
export function isOverdue(
  ticket: { readonly status: TicketStatus; readonly priority: TicketPriority; readonly awaitingSince: string },
  now: Date,
): boolean {
  if (awaitingFor(ticket.status) !== "staff") return false;
  const since = new Date(ticket.awaitingSince).getTime();
  if (Number.isNaN(since)) return false;
  return now.getTime() - since > SUPPORT_TARGET_HOURS[ticket.priority] * 3_600_000;
}

// ---------------------------------------------------------------------------
// Optional academic context
// ---------------------------------------------------------------------------

/**
 * The browser only names a roadmap item key. The server resolves the student
 * from the session, loads that student's CURRENT PUBLISHED roadmap through the
 * read-only S05 service and stores a verified snapshot. Student ids or course
 * ids from the browser are never trusted.
 */
export const supportContextInputSchema = z.object({
  roadmapItemKey: z.string().trim().min(1).max(120),
}).strict();
export type SupportContextInput = z.infer<typeof supportContextInputSchema>;

export interface SupportContext {
  readonly kind: "roadmap_item";
  readonly itemKey: string;
  readonly title: string;
  readonly code: string | null;
  readonly itemKind: string;
  readonly planVersion: number;
  readonly verifiedAt: string;
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/**
 * Client-generated idempotency key for ticket creation (one per form
 * submission, reused on retry). Stored in support_tickets.metadata and scoped
 * to the reporting student by the server.
 */
export const SUPPORT_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

export const createTicketInputSchema = z.object({
  subject: z.string().trim().min(5).max(200),
  description: z.string().trim().min(10).max(5000),
  /** New clients send a topic; legacy clients send a category. One is required. */
  topic: z.enum(SUPPORT_TOPICS).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  /** Accepted only from staff creating on behalf; ignored (forced to medium) for students. */
  priority: z.enum(TICKET_PRIORITIES).optional(),
  context: supportContextInputSchema.optional(),
  idempotencyKey: z.string().regex(SUPPORT_IDEMPOTENCY_KEY_PATTERN).optional(),
}).strict().refine((v) => !!v.topic || !!v.category, { message: "topic is required", path: ["topic"] });
export type CreateTicketInput = z.infer<typeof createTicketInputSchema>;

export const createCommentInputSchema = z.object({
  content: z.string().trim().min(1).max(5000),
  isInternal: z.boolean().default(false),
  /** Staff only: apply a status transition together with a public reply. */
  nextStatus: z.enum(TICKET_STATUSES).optional(),
}).strict();
export type CreateCommentInput = z.infer<typeof createCommentInputSchema>;

export const updateTicketInputSchema = z.object({
  subject: z.string().trim().min(5).max(200).optional(),
  description: z.string().trim().min(10).max(5000).optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assignedTo: z.string().min(1).max(64).nullable().optional(),
  /** Student-visible outcome. Required when moving to resolved. */
  resolutionNotes: z.string().trim().max(2000).optional(),
}).strict();
export type UpdateTicketInput = z.infer<typeof updateTicketInputSchema>;

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export const SUPPORT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const SUPPORT_ATTACHMENT_TYPES: Readonly<Record<string, readonly string[]>> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "text/plain": ["txt"],
  "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
};

export function attachmentTypeAllowed(fileName: string, fileType: string): boolean {
  const exts = SUPPORT_ATTACHMENT_TYPES[fileType];
  if (!exts) return false;
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return exts.includes(ext);
}

// ---------------------------------------------------------------------------
// Response shapes (what GET endpoints return after server-side presentation)
// ---------------------------------------------------------------------------

export interface SupportPerson {
  readonly id: string;
  readonly name: string;
  readonly role: SupportRole;
}

export interface SupportTicketSummary {
  readonly id: string;
  readonly ticket_number: string;
  readonly subject: string;
  readonly description: string;
  readonly category: TicketCategory;
  readonly topic: SupportTopic;
  readonly priority: TicketPriority;
  readonly status: TicketStatus;
  readonly created_at: string;
  readonly updated_at: string;
  readonly resolved_at: string | null;
  readonly resolution_notes: string | null;
  readonly reporter_id: string;
  readonly reporter_name: string;
  /** Staff views only (omitted for students). */
  readonly reporter_email?: string;
  /** Staff views only (omitted for students). */
  readonly assigned_to?: string | null;
  readonly assignee: SupportPerson | null;
  readonly awaiting: SupportAwaiting;
  readonly awaiting_since: string;
  /** Staff views only. */
  readonly is_overdue?: boolean;
  readonly context: SupportContext | null;
  /** Public messages only for students; staff counts include internal notes. */
  readonly message_count: number;
  readonly attachment_count: number;
  /** Latest public reply author kind, for "Lumière replied" cues. */
  readonly last_public_reply_by: "student" | "staff" | null;
  readonly last_public_reply_at: string | null;
}

export interface SupportComment {
  readonly id: string;
  readonly ticket_id: string;
  readonly author_id: string;
  readonly author_name: string;
  readonly author_role: string;
  /** Convenience for rendering: student vs Lumière team. */
  readonly author_kind: "student" | "staff";
  readonly content: string;
  /** Always false in student views (internal notes are never sent to students). */
  readonly is_internal: boolean;
  readonly created_at: string;
}

export interface SupportAttachment {
  readonly id: string;
  readonly ticket_id: string;
  readonly comment_id: string | null;
  readonly file_name: string;
  readonly file_size: number;
  readonly file_type: string;
  readonly uploaded_by: string;
  readonly uploaded_by_kind: "student" | "staff";
  readonly created_at: string;
}

export interface SupportStatusEvent {
  readonly id: string;
  readonly old_status: TicketStatus | null;
  readonly new_status: TicketStatus;
  readonly created_at: string;
  /** Staff views only. */
  readonly changed_by?: string;
}

export interface SupportTicketDetail extends SupportTicketSummary {
  readonly ticket_comments: readonly SupportComment[];
  readonly ticket_attachments: readonly SupportAttachment[];
  readonly ticket_status_history: readonly SupportStatusEvent[];
  /** Staff-only capability hints; for students only `can_reply` / `can_attach` are set. */
  readonly permissions: {
    readonly can_reply: boolean;
    readonly can_attach: boolean;
    readonly can_add_internal_note: boolean;
    readonly can_assign: boolean;
    readonly allowed_statuses: readonly TicketStatus[];
    readonly can_change_priority: boolean;
  };
}

export interface SupportTicketListResponse {
  readonly tickets: readonly SupportTicketSummary[];
  readonly pagination: { readonly total: number; readonly limit: number; readonly offset: number };
}

export interface SupportStatsResponse {
  readonly stats: {
    readonly byStatus: Readonly<Record<TicketStatus, number>>;
    readonly byCategory: Readonly<Record<string, number>>;
    readonly awaitingStaff: number;
    readonly awaitingStudent: number;
    readonly overdue: number;
    readonly unassigned: number;
    readonly avgResolutionHours: number;
    readonly resolvedLast30Days: number;
  };
}

/** Stable machine-readable error codes returned as `{ error, code }`. */
export type SupportErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_TRANSITION"
  | "RESOLUTION_REQUIRED"
  | "TICKET_CLOSED"
  | "REOPEN_WINDOW_EXPIRED"
  | "INVALID_ASSIGNEE"
  | "CONTEXT_NOT_IN_PLAN"
  | "CONTEXT_UNAVAILABLE"
  | "ATTACHMENT_TYPE_NOT_ALLOWED"
  | "ATTACHMENT_PATH_INVALID"
  | "STORAGE_UNAVAILABLE"
  | "SUPPORT_UNAVAILABLE"
  | "SUPPORT_CREATE_INCOMPLETE"
  | "SUPPORT_CREATE_IN_PROGRESS";
