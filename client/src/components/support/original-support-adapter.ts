/**
 * S18 — pure adapter from the S16 student-safe ticket API shape to the view
 * model used by the restored original Support presentation (support-old.tsx).
 *
 * No React, no I/O. Every mapper copies an explicit allow-list of fields, so a
 * field that is not listed here (staff-only data, internal notes, emails,
 * storage paths, assignee ids...) can never reach the UI even if an API
 * response ever carried it. Internal comments and attachments hanging off
 * internal comments are dropped as defence in depth.
 */
import {
  SUPPORT_TOPIC_INFO,
  type SupportTopic,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from "@shared/support-contract";

// ---------------------------------------------------------------------------
// Input shape: only the fields the adapter may read. Extra properties on a
// real payload are ignored by construction.
// ---------------------------------------------------------------------------

export interface OriginalSourceComment {
  readonly id: string;
  readonly author_name?: string | null;
  readonly author_kind?: "student" | "staff" | string;
  readonly content: string;
  readonly is_internal?: boolean;
  readonly created_at: string;
}

export interface OriginalSourceAttachment {
  readonly id: string;
  readonly comment_id?: string | null;
  readonly file_name: string;
  readonly file_size: number;
  readonly file_type: string;
  readonly uploaded_by_kind?: "student" | "staff" | string;
  readonly created_at?: string;
}

export interface OriginalSourceStatusEvent {
  readonly id: string;
  readonly old_status?: TicketStatus | null;
  readonly new_status: TicketStatus;
  readonly created_at: string;
}

export interface OriginalSourceTicket {
  readonly id: string;
  readonly ticket_number: string;
  readonly subject: string;
  readonly description: string;
  readonly category: TicketCategory;
  readonly topic?: SupportTopic;
  readonly priority: TicketPriority;
  readonly status: TicketStatus;
  readonly created_at: string;
  readonly updated_at: string;
  readonly resolved_at?: string | null;
  readonly resolution_notes?: string | null;
  readonly assignee?: { readonly name?: string | null } | null;
  readonly context?: { readonly title?: string; readonly code?: string | null } | null;
  readonly message_count?: number;
  readonly attachment_count?: number;
  readonly ticket_comments?: readonly OriginalSourceComment[];
  readonly ticket_attachments?: readonly OriginalSourceAttachment[];
  readonly ticket_status_history?: readonly OriginalSourceStatusEvent[];
  readonly permissions?: { readonly can_reply?: boolean; readonly can_attach?: boolean };
}

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

export interface OriginalCardModel {
  readonly id: string;
  readonly ticketNumber: string;
  readonly subject: string;
  readonly description: string;
  readonly status: TicketStatus;
  readonly priority: TicketPriority;
  readonly category: TicketCategory;
  readonly topic: SupportTopic;
  readonly topicLabel: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resolvedAt: string | null;
  readonly resolutionNotes: string | null;
  readonly advisorName: string | null;
  readonly contextLabel: string | null;
  readonly commentCount: number;
  readonly attachmentCount: number;
  readonly awaitingYou: boolean;
}

export interface OriginalCommentModel {
  readonly id: string;
  readonly authorName: string;
  readonly authorKind: "student" | "staff";
  readonly content: string;
  readonly createdAt: string;
}

export interface OriginalAttachmentModel {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly uploadedByKind: "student" | "staff";
}

export interface OriginalHistoryModel {
  readonly id: string;
  readonly status: TicketStatus;
  readonly createdAt: string;
}

export interface OriginalDetailModel extends OriginalCardModel {
  readonly comments: readonly OriginalCommentModel[];
  readonly attachments: readonly OriginalAttachmentModel[];
  readonly statusHistory: readonly OriginalHistoryModel[];
  readonly canReply: boolean | undefined;
  readonly canAttach: boolean;
}

const FALLBACK_TOPIC: Record<TicketCategory, SupportTopic> = {
  academic: "course_assistance",
  enrollment: "transfer_credit",
  document: "transcript_document",
  technical: "account_technical",
  billing: "billing",
  general: "general",
};

const byTime = (a: string, b: string) => new Date(a).getTime() - new Date(b).getTime();

export function toCardModel(t: OriginalSourceTicket): OriginalCardModel {
  const topic = t.topic && t.topic in SUPPORT_TOPIC_INFO ? t.topic : FALLBACK_TOPIC[t.category] ?? "general";
  const ctx = t.context?.title ? (t.context.code ? `${t.context.title} (${t.context.code})` : t.context.title) : null;
  const publicCount = t.ticket_comments ? publicComments(t.ticket_comments).length : undefined;
  return {
    id: t.id,
    ticketNumber: t.ticket_number,
    subject: t.subject,
    description: t.description,
    status: t.status,
    priority: t.priority,
    category: t.category,
    topic,
    topicLabel: SUPPORT_TOPIC_INFO[topic].label,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    resolvedAt: t.resolved_at ?? null,
    resolutionNotes: t.resolution_notes ?? null,
    advisorName: t.assignee?.name ? String(t.assignee.name) : null,
    contextLabel: ctx,
    commentCount: publicCount ?? t.message_count ?? 0,
    attachmentCount: t.ticket_attachments ? publicAttachments(t.ticket_attachments, t.ticket_comments).length : (t.attachment_count ?? 0),
    awaitingYou: t.status === "waiting_on_student",
  };
}

/** Chronological, public messages only. */
export function publicComments(comments: readonly OriginalSourceComment[] | undefined | null): OriginalSourceComment[] {
  return (comments ?? []).filter((c) => c.is_internal !== true).slice().sort((a, b) => byTime(a.created_at, b.created_at));
}

/** Drops attachments that hang off an internal note. */
export function publicAttachments(
  attachments: readonly OriginalSourceAttachment[] | undefined | null,
  comments: readonly Pick<OriginalSourceComment, "id" | "is_internal">[] | undefined | null,
): OriginalSourceAttachment[] {
  const internal = new Set((comments ?? []).filter((c) => c.is_internal === true).map((c) => c.id));
  return (attachments ?? []).filter((a) => !a.comment_id || !internal.has(a.comment_id));
}

export function toDetailModel(t: OriginalSourceTicket): OriginalDetailModel {
  const comments = publicComments(t.ticket_comments).map<OriginalCommentModel>((c) => {
    const kind = c.author_kind === "student" ? "student" : "staff";
    return {
      id: c.id,
      authorName: c.author_name ? String(c.author_name) : "", // the UI supplies a localized "You" / team label
      authorKind: kind,
      content: c.content,
      createdAt: c.created_at,
    };
  });
  const attachments = publicAttachments(t.ticket_attachments, t.ticket_comments).map<OriginalAttachmentModel>((a) => ({
    id: a.id,
    name: a.file_name,
    size: a.file_size,
    type: a.file_type,
    uploadedByKind: a.uploaded_by_kind === "student" ? "student" : "staff",
  }));
  const statusHistory = (t.ticket_status_history ?? [])
    .slice()
    .sort((a, b) => byTime(a.created_at, b.created_at))
    .map<OriginalHistoryModel>((h) => ({ id: h.id, status: h.new_status, createdAt: h.created_at }));
  return {
    ...toCardModel(t),
    commentCount: comments.length,
    attachmentCount: attachments.length,
    comments,
    attachments,
    statusHistory,
    canReply: t.permissions?.can_reply,
    canAttach: t.permissions?.can_attach === true,
  };
}

// ---------------------------------------------------------------------------
// Counters: the original four cards. `closed` has no card of its own and is
// folded into "Resolved" (both mean: nothing left for the student to do).
// ---------------------------------------------------------------------------

export const COUNTER_KEYS = ["open", "in_progress", "waiting_on_student", "resolved"] as const;
export type CounterKey = (typeof COUNTER_KEYS)[number];

export function counterKeyFor(status: TicketStatus): CounterKey {
  return status === "closed" ? "resolved" : status;
}

export type StatusCounts = Readonly<Record<CounterKey, number>>;

export function statusCounts(tickets: readonly { readonly status: TicketStatus }[]): StatusCounts {
  const counts: Record<CounterKey, number> = { open: 0, in_progress: 0, waiting_on_student: 0, resolved: 0 };
  for (const t of tickets) counts[counterKeyFor(t.status)] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Search and filters (same rules as the original: subject, number, description)
// ---------------------------------------------------------------------------

export interface OriginalFilters {
  readonly query: string;
  readonly status: CounterKey | "all";
  readonly topic: SupportTopic | "all";
}

export const NO_FILTERS: OriginalFilters = { query: "", status: "all", topic: "all" };

export const hasActiveFilters = (f: OriginalFilters): boolean => f.query.trim() !== "" || f.status !== "all" || f.topic !== "all";

export function filterCards(cards: readonly OriginalCardModel[], f: OriginalFilters): OriginalCardModel[] {
  const q = f.query.trim().toLowerCase();
  return cards.filter((c) => {
    if (f.status !== "all" && counterKeyFor(c.status) !== f.status) return false;
    if (f.topic !== "all" && c.topic !== f.topic) return false;
    if (!q) return true;
    return c.subject.toLowerCase().includes(q) || c.ticketNumber.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
  });
}

/** Most recently updated first. */
export function sortByRecent<T extends { readonly updatedAt: string }>(items: readonly T[]): T[] {
  return items.slice().sort((a, b) => byTime(b.updatedAt, a.updatedAt));
}

// ---------------------------------------------------------------------------
// Look (S28 polish): Lumière theme tokens only, one restrained palette. Gold marks the one state that needs the
// student ("Waiting on you"); working states are neutral; resolved is a quiet green; red only for urgent.
// Every pill keeps a hairline border so it reads on both light and dark themes.
// ---------------------------------------------------------------------------

const NEUTRAL = { color: "text-student-muted", bgColor: "border border-student-line-strong bg-student-card" } as const;

export const ORIGINAL_STATUS_STYLE: Readonly<Record<TicketStatus, { readonly color: string; readonly bgColor: string }>> = {
  open: NEUTRAL,
  in_progress: NEUTRAL,
  waiting_on_student: { color: "text-student-gold-ink", bgColor: "border border-student-gold bg-student-gold-soft" },
  resolved: { color: "text-st-applied", bgColor: "border border-st-applied/40 bg-st-applied-soft" },
  closed: NEUTRAL,
};

export const ORIGINAL_PRIORITY_STYLE: Readonly<Record<TicketPriority, { readonly color: string; readonly bgColor: string }>> = {
  low: NEUTRAL,
  medium: NEUTRAL,
  high: { color: "text-st-attention", bgColor: "border border-st-attention/40 bg-st-attention-soft" },
  urgent: { color: "text-st-urgent", bgColor: "border border-st-urgent/40 bg-st-urgent-soft" },
};

/** Topic chips are labels, not states: one neutral style for every category. */
const TOPIC_CHIP = "border border-student-line bg-student-card text-student-muted";
export const ORIGINAL_CATEGORY_STYLE: Readonly<Record<TicketCategory, string>> = {
  academic: TOPIC_CHIP,
  technical: TOPIC_CHIP,
  billing: TOPIC_CHIP,
  document: TOPIC_CHIP,
  general: TOPIC_CHIP,
  enrollment: TOPIC_CHIP,
};

/** The original card shows a priority chip; students are always "medium", so only a staff-raised level is worth a chip on the list. */
export const showPriorityOnCard = (p: TicketPriority): boolean => p !== "medium";
