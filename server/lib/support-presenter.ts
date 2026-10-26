/**
 * S08 — present database rows as SupportTicketSummary/Detail for a viewer.
 * Pure. Students never receive staff-only data: internal comments, attachments
 * linked to internal comments, metadata, assigned_to, reporter_email,
 * changed_by, storage paths, staff user ids.
 */
import {
  TICKET_STATUSES,
  awaitingFor,
  canStaffTransition,
  isOverdue,
  isSupportManager,
  statusAfterStudentReply,
  topicForTicket,
  type SupportAttachment,
  type SupportComment,
  type SupportContext,
  type SupportPerson,
  type SupportRole,
  type SupportStatusEvent,
  type SupportTicketDetail,
  type SupportTicketSummary,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from "@shared/support-contract";

type Row = Record<string, any>;

export interface SupportViewer {
  readonly id: string;
  readonly role: string;
}

export const isStudentViewer = (v: SupportViewer): boolean => v.role === "student";

/** The viewer's access to one ticket row. Unknown roles are denied. */
export function viewerCanAccessTicket(viewer: SupportViewer, ticket: Row): boolean {
  switch (viewer.role) {
    case "student": return ticket.reporter_id === viewer.id;
    case "coach": return !!ticket.assigned_to && ticket.assigned_to === viewer.id;
    case "admin":
    case "staff": return true;
    default: return false;
  }
}

function meta(ticket: Row): Record<string, unknown> {
  return ticket.metadata && typeof ticket.metadata === "object" && !Array.isArray(ticket.metadata)
    ? (ticket.metadata as Record<string, unknown>)
    : {};
}

export function awaitingSinceOf(ticket: Row): string {
  const v = meta(ticket).awaiting_since;
  return typeof v === "string" && v ? v : String(ticket.updated_at ?? ticket.created_at ?? new Date(0).toISOString());
}

function contextOf(ticket: Row): SupportContext | null {
  const c = meta(ticket).context as Row | undefined;
  if (!c || c.kind !== "roadmap_item" || typeof c.itemKey !== "string") return null;
  return c as unknown as SupportContext;
}

const personRole = (role: unknown): SupportRole =>
  role === "admin" || role === "staff" || role === "coach" || role === "student" ? role : "staff";

/** Comments the viewer may see. */
export function visibleComments(viewer: SupportViewer, comments: readonly Row[]): Row[] {
  return isStudentViewer(viewer) ? comments.filter((c) => !c.is_internal) : [...comments];
}

/** Attachments the viewer may see (students: none linked to an internal comment). */
export function visibleAttachments(viewer: SupportViewer, attachments: readonly Row[], comments: readonly Row[]): Row[] {
  if (!isStudentViewer(viewer)) return [...attachments];
  const internal = new Set(comments.filter((c) => c.is_internal).map((c) => c.id));
  return attachments.filter((a) => !a.comment_id || !internal.has(a.comment_id));
}

export interface PresentInput {
  readonly ticket: Row;
  readonly comments: readonly Row[];
  readonly attachments: readonly Row[];
  /** id -> {name, role}; used for the assignee. */
  readonly people: ReadonlyMap<string, { name: string; role: string }>;
  readonly viewer: SupportViewer;
  readonly now: Date;
}

export function presentSummary(input: PresentInput): SupportTicketSummary {
  const { ticket, viewer, now } = input;
  const student = isStudentViewer(viewer);
  const comments = visibleComments(viewer, input.comments);
  const attachments = visibleAttachments(viewer, input.attachments, input.comments);
  const status = ticket.status as TicketStatus;
  const priority = ticket.priority as TicketPriority;
  const awaitingSince = awaitingSinceOf(ticket);

  let lastPublic: Row | null = null;
  for (const c of input.comments) {
    if (c.is_internal) continue;
    if (!lastPublic || String(c.created_at) >= String(lastPublic.created_at)) lastPublic = c;
  }

  const person = ticket.assigned_to ? input.people.get(String(ticket.assigned_to)) : undefined;
  const assignee: SupportPerson | null = ticket.assigned_to
    ? {
        id: student ? "assignee" : String(ticket.assigned_to),
        name: person?.name ?? "Lumière team",
        role: student ? "staff" : personRole(person?.role),
      }
    : null;

  const summary: SupportTicketSummary = {
    id: ticket.id,
    ticket_number: ticket.ticket_number,
    subject: ticket.subject,
    description: ticket.description,
    category: ticket.category as TicketCategory,
    topic: topicForTicket(ticket.metadata, ticket.category as TicketCategory),
    priority,
    status,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    resolved_at: ticket.resolved_at ?? null,
    resolution_notes: ticket.resolution_notes ?? null,
    reporter_id: ticket.reporter_id,
    reporter_name: ticket.reporter_name,
    assignee,
    awaiting: awaitingFor(status),
    awaiting_since: awaitingSince,
    context: contextOf(ticket),
    message_count: comments.length,
    attachment_count: attachments.length,
    last_public_reply_by: lastPublic ? (lastPublic.author_role === "student" ? "student" : "staff") : null,
    last_public_reply_at: lastPublic ? lastPublic.created_at : null,
  };
  if (student) return summary;
  return {
    ...summary,
    reporter_email: ticket.reporter_email,
    assigned_to: ticket.assigned_to ?? null,
    is_overdue: isOverdue({ status, priority, awaitingSince }, now),
  };
}

export function presentComment(viewer: SupportViewer, c: Row): SupportComment {
  const student = isStudentViewer(viewer);
  const kind = c.author_role === "student" ? "student" : "staff";
  return {
    id: c.id,
    ticket_id: c.ticket_id,
    author_id: student && kind === "staff" ? "staff" : c.author_id,
    author_name: c.author_name,
    author_role: student && kind === "staff" ? "staff" : c.author_role,
    author_kind: kind,
    content: c.content,
    is_internal: student ? false : !!c.is_internal,
    created_at: c.created_at,
  };
}

export function presentAttachment(viewer: SupportViewer, ticket: Row, a: Row): SupportAttachment {
  const kind = a.uploaded_by === ticket.reporter_id ? "student" : "staff";
  return {
    id: a.id,
    ticket_id: a.ticket_id,
    comment_id: a.comment_id ?? null,
    file_name: a.file_name,
    file_size: a.file_size,
    file_type: a.file_type,
    uploaded_by: isStudentViewer(viewer) && kind === "staff" ? "staff" : a.uploaded_by,
    uploaded_by_kind: kind,
    created_at: a.created_at,
  };
}

export function presentStatusEvent(viewer: SupportViewer, h: Row): SupportStatusEvent {
  const base: SupportStatusEvent = {
    id: h.id,
    old_status: h.old_status ?? null,
    new_status: h.new_status,
    created_at: h.created_at,
  };
  return isStudentViewer(viewer) ? base : { ...base, changed_by: h.changed_by };
}

export function presentDetail(input: PresentInput & { readonly history: readonly Row[] }): SupportTicketDetail {
  const { ticket, viewer, now } = input;
  const summary = presentSummary(input);
  const status = ticket.status as TicketStatus;
  const student = isStudentViewer(viewer);
  let canReply: boolean;
  let allowed: TicketStatus[] = [];
  if (student) {
    canReply = statusAfterStudentReply(status, ticket.resolved_at, now).ok;
  } else {
    canReply = status !== "closed" || isSupportManager(viewer.role);
    allowed = TICKET_STATUSES.filter((s) => canStaffTransition(viewer.role, status, s));
  }
  return {
    ...summary,
    ticket_comments: visibleComments(viewer, input.comments).map((c) => presentComment(viewer, c)),
    ticket_attachments: visibleAttachments(viewer, input.attachments, input.comments).map((a) => presentAttachment(viewer, ticket, a)),
    ticket_status_history: input.history.map((h) => presentStatusEvent(viewer, h)),
    permissions: {
      can_reply: canReply,
      can_attach: status !== "closed",
      can_add_internal_note: !student,
      can_assign: isSupportManager(viewer.role),
      allowed_statuses: allowed,
      can_change_priority: !student,
    },
  };
}
