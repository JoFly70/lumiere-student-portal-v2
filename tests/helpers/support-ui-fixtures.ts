/**
 * Synthetic support fixtures (S08). Names and emails are fictional
 * (@synthetic.example). Dates are anchored to SUPPORT_NOW so rendering is stable.
 */
import type { SupportComment, SupportTicketDetail, SupportTicketSummary } from "../../shared/support-contract";

export const SUPPORT_NOW = new Date("2026-10-26T15:00:00.000Z");

const STUDENT_ID = "student-user-1";
const ADVISOR = { id: "advisor-1", name: "Camille Moreau", role: "staff" as const };

const base: Omit<SupportTicketDetail, "id" | "ticket_number" | "subject" | "description" | "category" | "topic" | "status" | "created_at" | "updated_at" | "ticket_comments"> = {
  priority: "medium",
  resolved_at: null,
  resolution_notes: null,
  reporter_id: STUDENT_ID,
  reporter_name: "Amélie Laurent",
  assignee: ADVISOR,
  awaiting: "staff",
  awaiting_since: "2026-10-25T09:00:00.000Z",
  context: null,
  message_count: 1,
  attachment_count: 0,
  last_public_reply_by: "student",
  last_public_reply_at: "2026-10-25T09:00:00.000Z",
  ticket_attachments: [],
  ticket_status_history: [],
  permissions: {
    can_reply: true,
    can_attach: true,
    can_add_internal_note: false,
    can_assign: false,
    allowed_statuses: [],
    can_change_priority: false,
  },
};

const student = (id: string, ticket_id: string, content: string, created_at: string): SupportComment => ({
  id, ticket_id, author_id: STUDENT_ID, author_name: "Amélie Laurent", author_role: "student",
  author_kind: "student", content, is_internal: false, created_at,
});
const advisor = (id: string, ticket_id: string, content: string, created_at: string): SupportComment => ({
  id, ticket_id, author_id: ADVISOR.id, author_name: ADVISOR.name, author_role: "staff",
  author_kind: "staff", content, is_internal: false, created_at,
});

/** Awaiting the student, with an advisor reply. */
export const TICKET_AWAITING_STUDENT: SupportTicketDetail = {
  ...base,
  id: "t-1",
  ticket_number: "LP-1042",
  subject: "Which transcript should I send to the university?",
  description: "I am applying for transfer credit and I am not sure whether to send the provider transcript or the Lumière summary.",
  category: "enrollment",
  topic: "transfer_credit",
  status: "waiting_on_student",
  awaiting: "student",
  awaiting_since: "2026-10-26T10:00:00.000Z",
  created_at: "2026-10-25T09:00:00.000Z",
  updated_at: "2026-10-26T10:00:00.000Z",
  message_count: 2,
  last_public_reply_by: "staff",
  last_public_reply_at: "2026-10-26T10:00:00.000Z",
  ticket_comments: [
    student("c-1", "t-1", "I am applying for transfer credit and I am not sure whether to send the provider transcript or the Lumière summary.", "2026-10-25T09:00:00.000Z"),
    advisor("c-2", "t-1", "Thanks Amélie. Could you tell me which university and the deadline? Then I can confirm exactly what they accept.", "2026-10-26T10:00:00.000Z"),
  ],
};

/** With Lumière, in progress. */
export const TICKET_WITH_LUMIERE: SupportTicketDetail = {
  ...base,
  id: "t-2",
  ticket_number: "LP-1051",
  subject: "Cannot open my course dashboard",
  description: "Since this morning the dashboard shows a blank page after I sign in.",
  category: "technical",
  topic: "account_technical",
  status: "in_progress",
  created_at: "2026-10-26T08:00:00.000Z",
  updated_at: "2026-10-26T12:00:00.000Z",
  ticket_comments: [
    student("c-3", "t-2", "Since this morning the dashboard shows a blank page after I sign in.", "2026-10-26T08:00:00.000Z"),
  ],
};

/** Resolved with resolution notes, inside the reopen window. */
export const TICKET_RESOLVED: SupportTicketDetail = {
  ...base,
  id: "t-3",
  ticket_number: "LP-1008",
  subject: "Invoice for September",
  description: "I cannot find my September invoice in the portal.",
  category: "billing",
  topic: "billing",
  status: "resolved",
  awaiting: "none",
  created_at: "2026-10-14T09:00:00.000Z",
  updated_at: "2026-10-20T09:00:00.000Z",
  resolved_at: "2026-10-20T09:00:00.000Z",
  resolution_notes: "Your September invoice has been re-issued and sent to amelie.laurent@synthetic.example.",
  ticket_comments: [
    student("c-4", "t-3", "I cannot find my September invoice in the portal.", "2026-10-14T09:00:00.000Z"),
    advisor("c-5", "t-3", "Re-issuing it now, you will have it shortly.", "2026-10-20T09:00:00.000Z"),
  ],
};

/** Resolved long ago: the reopen window has passed. */
export const TICKET_RESOLVED_EXPIRED: SupportTicketDetail = {
  ...TICKET_RESOLVED,
  id: "t-4",
  ticket_number: "LP-0977",
  subject: "Welcome call scheduling",
  resolved_at: "2026-09-01T09:00:00.000Z",
  updated_at: "2026-09-01T09:00:00.000Z",
  resolution_notes: "Your welcome call took place on August 29.",
};

/** Carries verified academic context and an advisor attachment. */
export const TICKET_WITH_CONTEXT: SupportTicketDetail = {
  ...base,
  id: "t-5",
  ticket_number: "LP-1060",
  subject: "Question about Marketing Fundamentals pacing",
  description: "I am behind on Touchstone 2 and want to know whether I should adjust my target date.",
  category: "academic",
  topic: "course_assistance",
  status: "open",
  assignee: null,
  created_at: "2026-10-26T14:30:00.000Z",
  updated_at: "2026-10-26T14:30:00.000Z",
  context: {
    kind: "roadmap_item",
    itemKey: "course-mkt-101",
    title: "Marketing Fundamentals",
    code: "MKT 101",
    itemKind: "course",
    planVersion: 3,
    verifiedAt: "2026-10-26T14:30:00.000Z",
  },
  attachment_count: 1,
  ticket_attachments: [
    {
      id: "a-1", ticket_id: "t-5", comment_id: "c-6", file_name: "touchstone-2-feedback.pdf", file_size: 184_320,
      file_type: "application/pdf", uploaded_by: STUDENT_ID, uploaded_by_kind: "student", created_at: "2026-10-26T14:31:00.000Z",
    },
  ],
  ticket_comments: [
    student("c-6", "t-5", "I am behind on Touchstone 2 and want to know whether I should adjust my target date.", "2026-10-26T14:30:00.000Z"),
  ],
};

/** A leaked internal note. Student UI must never render it. */
export const INTERNAL_NOTE_TEXT = "INTERNAL: student is on probation, do not mention";
export const TICKET_WITH_LEAKED_INTERNAL: SupportTicketDetail = {
  ...TICKET_WITH_LUMIERE,
  ticket_comments: [
    ...TICKET_WITH_LUMIERE.ticket_comments,
    { ...advisor("c-x", "t-2", INTERNAL_NOTE_TEXT, "2026-10-26T09:00:00.000Z"), is_internal: true },
  ],
};

export const ALL_DETAILS: readonly SupportTicketDetail[] = [
  TICKET_AWAITING_STUDENT, TICKET_WITH_LUMIERE, TICKET_RESOLVED, TICKET_RESOLVED_EXPIRED, TICKET_WITH_CONTEXT,
];

export function toSummary(t: SupportTicketDetail): SupportTicketSummary {
  const { ticket_comments, ticket_attachments, ticket_status_history, permissions, ...summary } = t;
  void ticket_comments; void ticket_attachments; void ticket_status_history; void permissions;
  return summary;
}

export const ALL_SUMMARIES: readonly SupportTicketSummary[] = ALL_DETAILS.map(toSummary);

export const CONTEXT_OPTIONS = {
  available: true,
  planVersion: 3,
  items: [
    { key: "course-mkt-101", title: "Marketing Fundamentals", code: "MKT 101", kind: "course", phaseTitle: "Foundation" },
    { key: "milestone-transfer", title: "Transfer application", code: null, kind: "milestone", phaseTitle: "Horizon" },
  ],
};
