/**
 * S08 student support presentation helpers. Pure: no React, no I/O. Student
 * wording only; staff wording lives in the staff desk.
 */
import { format, formatDistance, formatDistanceStrict } from "date-fns";
import {
  STUDENT_REOPEN_WINDOW_DAYS,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_STATUS_LABEL,
  SUPPORT_TARGET_HOURS,
  SUPPORT_TOPICS,
  SUPPORT_TOPIC_INFO,
  attachmentTypeAllowed,
  statusAfterStudentReply,
  type SupportAttachment,
  type SupportComment,
  type SupportContext,
  type SupportTopic,
  type TicketPriority,
  type TicketStatus,
} from "@shared/support-contract";
import type { StatusKey } from "@/pages/student-roadmap-presentation";

export const SUBJECT_MIN = 5;
export const SUBJECT_MAX = 200;
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 5000;

// ---------------------------------------------------------------------------
// Status and next action
// ---------------------------------------------------------------------------

export const STUDENT_STATUS_LABEL: Readonly<Record<TicketStatus, string>> = {
  open: SUPPORT_STATUS_LABEL.open.student,
  in_progress: SUPPORT_STATUS_LABEL.in_progress.student,
  waiting_on_student: SUPPORT_STATUS_LABEL.waiting_on_student.student,
  resolved: SUPPORT_STATUS_LABEL.resolved.student,
  closed: SUPPORT_STATUS_LABEL.closed.student,
};

export function studentStatusLabel(status: TicketStatus): string {
  return STUDENT_STATUS_LABEL[status];
}

/**
 * Age text for a staff queue row, tied to what the clock measures. Only a ticket
 * awaiting staff counts "waiting"; otherwise the last meaningful date is shown,
 * so a resolved ticket never reads "1 day" from a stale awaiting_since.
 */
export function staffRowAge(
  t: { readonly awaiting: "staff" | "student" | "none"; readonly awaiting_since: string; readonly created_at: string; readonly resolved_at?: string | null; readonly updated_at?: string },
  now: Date,
): string {
  const span = (iso: string | null | undefined) => {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? formatDistanceStrict(d, now) : "";
  };
  if (t.awaiting === "staff") return `Waiting ${span(t.awaiting_since)}`.trim();
  if (t.awaiting === "student") return `Asked ${span(t.awaiting_since)} ago`;
  const done = t.resolved_at ?? t.updated_at ?? t.created_at;
  return `Resolved ${span(done)} ago`;
}

export type NextActionTone = "you" | "lumiere" | "done";

export interface NextAction {
  readonly tone: NextActionTone;
  readonly title: string;
  readonly detail: string;
}

interface NextActionInput {
  readonly status: TicketStatus;
  readonly resolved_at?: string | null;
  readonly assignee?: { readonly name: string } | null;
}

/** Whole days left in the reopen window, or null when not applicable. */
export function reopenDaysLeft(resolvedAt: string | null | undefined, now: Date): number | null {
  if (!resolvedAt) return null;
  const ageMs = now.getTime() - new Date(resolvedAt).getTime();
  if (Number.isNaN(ageMs)) return null;
  return Math.max(0, Math.ceil(STUDENT_REOPEN_WINDOW_DAYS - ageMs / 86_400_000));
}

export function nextAction(t: NextActionInput, now: Date): NextAction {
  const advisor = t.assignee?.name ? t.assignee.name : "your Lumière advisor";
  switch (t.status) {
    case "waiting_on_student":
      return {
        tone: "you",
        title: "Waiting for your reply",
        detail: "Your Lumière advisor needs a little more from you. Reply below so we can keep going.",
      };
    case "open":
      return {
        tone: "lumiere",
        title: "With your Lumière advisor",
        detail: "Lumière has received your request. You will see the reply right here.",
      };
    case "in_progress":
      return {
        tone: "lumiere",
        title: "With your Lumière advisor",
        detail: `${advisor === "your Lumière advisor" ? "Your advisor is" : `${advisor} is`} working on your request. You will see the reply right here.`,
      };
    case "resolved": {
      const res = statusAfterStudentReply("resolved", t.resolved_at, now);
      return res.ok
        ? {
            tone: "done",
            title: "Resolved",
            detail: `Still need help? Reply within ${STUDENT_REOPEN_WINDOW_DAYS} days of the resolution to reopen this request.`,
          }
        : {
            tone: "done",
            title: "Resolved and closed",
            detail: "The reopen window has passed. Please start a new request if you need more help.",
          };
    }
    default:
      return {
        tone: "done",
        title: "Closed",
        detail: "This request is closed. Start a new request if you need more help.",
      };
  }
}

export interface ReplyState {
  readonly canReply: boolean;
  /** Plain-language explanation, always set when canReply is false. */
  readonly reason: string | null;
  /** Short note shown next to an enabled box, e.g. reopening. */
  readonly note: string | null;
}

export function replyState(
  t: { status: TicketStatus; resolved_at?: string | null },
  canReplyPermission: boolean | undefined,
  now: Date,
): ReplyState {
  const res = statusAfterStudentReply(t.status, t.resolved_at, now);
  if (!res.ok) {
    return {
      canReply: false,
      reason:
        res.code === "TICKET_CLOSED"
          ? "This request is closed, so replies are turned off. Start a new request if you need more help."
          : `This request was resolved more than ${STUDENT_REOPEN_WINDOW_DAYS} days ago, so it can no longer be reopened. Please start a new request.`,
      note: null,
    };
  }
  if (canReplyPermission === false) {
    return { canReply: false, reason: "You cannot reply to this request right now.", note: null };
  }
  if (t.status === "resolved") {
    return { canReply: true, reason: null, note: "Sending a reply will reopen this request." };
  }
  return { canReply: true, reason: null, note: null };
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface GroupableTicket {
  readonly status: TicketStatus;
  readonly updated_at: string;
}

export interface TicketGroups<T extends GroupableTicket> {
  readonly needsReply: T[];
  readonly withLumiere: T[];
  readonly resolved: T[];
  /** needsReply + withLumiere */
  readonly outstanding: number;
}

export function groupTickets<T extends GroupableTicket>(tickets: readonly T[]): TicketGroups<T> {
  const byRecent = (a: T, b: T) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  const needsReply = tickets.filter((t) => t.status === "waiting_on_student").sort(byRecent);
  const withLumiere = tickets.filter((t) => t.status === "open" || t.status === "in_progress").sort(byRecent);
  const resolved = tickets.filter((t) => t.status === "resolved" || t.status === "closed").sort(byRecent);
  return { needsReply, withLumiere, resolved, outstanding: needsReply.length + withLumiere.length };
}

export function outstandingSummary(g: { needsReply: readonly unknown[]; outstanding: number }): string {
  if (g.outstanding === 0) return "No open requests";
  const open = `${g.outstanding} open ${g.outstanding === 1 ? "request" : "requests"}`;
  return g.needsReply.length > 0 ? `${open} · ${g.needsReply.length} waiting for you` : open;
}

// ---------------------------------------------------------------------------
// Conversation data hygiene (defence in depth)
// ---------------------------------------------------------------------------

/** Chronological public messages only. Internal notes are never shown to students. */
export function publicComments<T extends Pick<SupportComment, "is_internal" | "created_at">>(
  comments: readonly T[] | undefined | null,
): T[] {
  return (comments ?? [])
    .filter((c) => c.is_internal !== true)
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

/** Drops attachments that hang off an internal note, if the API ever sent them. */
export function publicAttachments(
  attachments: readonly SupportAttachment[] | undefined | null,
  comments: readonly Pick<SupportComment, "id" | "is_internal">[] | undefined | null,
): SupportAttachment[] {
  const internal = new Set((comments ?? []).filter((c) => c.is_internal).map((c) => c.id));
  return (attachments ?? []).filter((a) => !a.comment_id || !internal.has(a.comment_id));
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export function relativeTime(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (Math.abs(now.getTime() - d.getTime()) < 60_000) return "just now";
  return formatDistance(d, now, { addSuffix: true });
}

export function absoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return format(d, "MMM d, yyyy 'at' h:mm a");
}

// ---------------------------------------------------------------------------
// Topic, context, validation
// ---------------------------------------------------------------------------

export const TOPIC_CHOICES = SUPPORT_TOPICS.map((key) => ({ key, ...SUPPORT_TOPIC_INFO[key] }));

export function topicLabel(topic: SupportTopic): string {
  return SUPPORT_TOPIC_INFO[topic].label;
}

export function contextLabel(c: Pick<SupportContext, "title" | "code"> | null | undefined): string | null {
  if (!c) return null;
  return c.code ? `${c.title} (${c.code})` : c.title;
}

export interface RequestDraft {
  topic: SupportTopic | null;
  subject: string;
  description: string;
}

export type RequestErrors = Partial<Record<"topic" | "subject" | "description", string>>;

/** Mirrors createTicketInputSchema (trimmed lengths). */
export function validateRequestDraft(d: RequestDraft): RequestErrors {
  const errors: RequestErrors = {};
  const subject = d.subject.trim();
  const description = d.description.trim();
  if (!d.topic) errors.topic = "Choose the topic that fits best so the right person sees it.";
  if (subject.length < SUBJECT_MIN) {
    errors.subject = `Add a short subject of at least ${SUBJECT_MIN} characters.`;
  } else if (subject.length > SUBJECT_MAX) {
    errors.subject = `Please keep the subject under ${SUBJECT_MAX} characters (now ${subject.length}).`;
  }
  if (description.length < DESCRIPTION_MIN) {
    errors.description = `Tell us a little more, at least ${DESCRIPTION_MIN} characters, so we can help properly.`;
  } else if (description.length > DESCRIPTION_MAX) {
    errors.description = `Please keep the description under ${DESCRIPTION_MAX} characters (now ${description.length}).`;
  }
  return errors;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ATTACHMENT_HELP = "PDF, PNG, JPG, WebP, TXT, DOC or DOCX, up to 10 MB.";

export function attachmentError(file: { name: string; size: number; type: string }): string | null {
  if (file.size <= 0) return "That file is empty.";
  if (file.size > SUPPORT_ATTACHMENT_MAX_BYTES) {
    return `${file.name} is ${formatFileSize(file.size)}. Files can be up to 10 MB.`;
  }
  if (!attachmentTypeAllowed(file.name, file.type)) {
    return `${file.name} is not a supported type. Please use ${ATTACHMENT_HELP.replace(/, up to 10 MB\.$/, ".")}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Staff queue filters. Each stats tile and queue chip maps to exactly one
// server query, and the server's stats counts use the same rules, so a
// tile number always equals the list it opens.
// ---------------------------------------------------------------------------

export type StaffQueueKey = "needs" | "waiting" | "overdue" | "mine" | "unassigned" | "resolved" | "all";

export function staffQueueFilters(key: StaffQueueKey): Record<string, string | boolean> {
  switch (key) {
    case "needs": return { view: "active", awaiting: "staff" };
    case "waiting": return { view: "active", awaiting: "student" };
    case "overdue": return { overdue: true };
    case "mine": return { view: "active", assignedTo: "me" };
    // Same population as the "Unassigned" tile: tickets that need a staff response.
    case "unassigned": return { view: "active", awaiting: "staff", assignedTo: "unassigned" };
    case "resolved": return { view: "resolved" };
    default: return {};
  }
}

/**
 * Value of the "Assigned to" dropdown. The list card shows `assignee`, so the
 * dropdown must resolve the same person even when `assigned_to` is absent
 * (it is optional in the contract); otherwise the card says "Assigned: X" while
 * the dropdown says "Unassigned".
 */
export function assigneeSelectValue(t: { readonly assigned_to?: string | null; readonly assignee?: { readonly id: string } | null }): string {
  return t.assigned_to ?? t.assignee?.id ?? "";
}

// ---------------------------------------------------------------------------
// Staff desk (S10 staff pass): one status vocabulary, ticket urgency and age.
// ---------------------------------------------------------------------------

/**
 * Ticket status in the shared Lumiere status language (index.css --st-*). The
 * WORDS still come from SUPPORT_STATUS_LABEL; only the colour/icon family is chosen
 * here. New work is "submitted" (waiting to be picked up), staff working on it is
 * "progress", a ball in the student's court is the quiet dashed "not started",
 * done is green. Overdue and urgent are expressed by their own pills, not here.
 */
export function ticketStatusKey(status: TicketStatus): StatusKey {
  switch (status) {
    case "open": return "submitted";
    case "in_progress": return "progress";
    case "resolved": return "applied";
    default: return "notstarted";
  }
}

/** The response target for a priority, in words ("24-hour target", "2-day target"). */
export function targetLabel(priority: TicketPriority): string {
  const h = SUPPORT_TARGET_HOURS[priority];
  return h % 24 === 0 ? `${h / 24}-day target` : `${h}-hour target`;
}

/**
 * "2 days past the 24-hour target" for a ticket awaiting staff that is overdue,
 * otherwise null. Computed from the same clock and target the server's overdue flag uses.
 */
export function overdueByLabel(
  t: { readonly awaiting: "staff" | "student" | "none"; readonly awaiting_since: string; readonly priority: TicketPriority; readonly is_overdue?: boolean },
  now: Date,
): string | null {
  if (!t.is_overdue || t.awaiting !== "staff") return null;
  const since = new Date(t.awaiting_since).getTime();
  if (Number.isNaN(since)) return null;
  const over = now.getTime() - since - SUPPORT_TARGET_HOURS[t.priority] * 3_600_000;
  if (over <= 0) return null;
  return `${formatDistanceStrict(0, over)} past the ${targetLabel(t.priority)}`;
}

/** Initials for an avatar chip: "Camille Moreau" -> "CM". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase();
}

/** Every queue the desk offers, with plain-language help. The first three are also KPI tiles. */
export const STAFF_QUEUES: readonly { readonly key: StaffQueueKey; readonly label: string; readonly help: string }[] = [
  { key: "needs", label: "Needs response", help: "Waiting on Lumière" },
  { key: "overdue", label: "Overdue", help: "Past the response target" },
  { key: "unassigned", label: "Unassigned", help: "No advisor yet" },
  { key: "waiting", label: "Waiting on student", help: "Ball is with the student" },
  { key: "mine", label: "Mine", help: "Assigned to you" },
  { key: "resolved", label: "Resolved", help: "Finished" },
  { key: "all", label: "All", help: "Everything" },
];

/**
 * Staff triage order: open work first, overdue before on-time, then whoever has
 * waited longest. Resolved/closed tickets keep the server order (newest first)
 * after the open ones. The server returns newest-first; this is the desk's order.
 */
export function orderStaffQueue<T extends { status: string; awaiting_since: string; is_overdue?: boolean }>(tickets: readonly T[]): T[] {
  const done = (t: T) => t.status === "resolved" || t.status === "closed";
  const open = tickets.filter((t) => !done(t));
  const closed = tickets.filter(done);
  open.sort((a, b) => Number(!!b.is_overdue) - Number(!!a.is_overdue) || a.awaiting_since.localeCompare(b.awaiting_since));
  return [...open, ...closed];
}
