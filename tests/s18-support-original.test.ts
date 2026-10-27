/**
 * S18 — restored original Support UI: adapter mapping, counters, privacy and
 * the "no sample data in the live path" guarantee. Pure; no DOM.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COUNTER_KEYS,
  NO_FILTERS,
  ORIGINAL_STATUS_STYLE,
  counterKeyFor,
  filterCards,
  hasActiveFilters,
  publicAttachments,
  publicComments,
  sortByRecent,
  statusCounts,
  toCardModel,
  toDetailModel,
  type OriginalSourceTicket,
} from "../client/src/components/support/original-support-adapter";
import { SUPPORT_TEXT } from "../client/src/components/support/original-support-text";
import { TICKET_STATUSES, TICKET_CATEGORIES, SUPPORT_TOPICS, SUPPORT_TOPIC_INFO } from "../shared/support-contract";
import {
  ALL_DETAILS, INTERNAL_NOTE_TEXT, TICKET_AWAITING_STUDENT, TICKET_RESOLVED, TICKET_WITH_CONTEXT, TICKET_WITH_LEAKED_INTERNAL, TICKET_WITH_LUMIERE,
} from "./helpers/support-ui-fixtures";

const read = (...p: string[]) => fs.readFileSync(path.resolve(import.meta.dirname, "..", ...p), "utf8");
const withStatus = (status: (typeof TICKET_STATUSES)[number], id = status): OriginalSourceTicket => ({ ...TICKET_WITH_LUMIERE, id, status });

describe("status mapping and counters", () => {
  it("shows exactly four counters; waiting maps to waiting_on_student", () => {
    expect(COUNTER_KEYS).toEqual(["open", "in_progress", "waiting_on_student", "resolved"]);
    expect(SUPPORT_TEXT.status.waiting_on_student).toBe("Waiting on you");
  });

  it("folds closed into Resolved and leaves the others alone", () => {
    expect(counterKeyFor("closed")).toBe("resolved");
    expect(counterKeyFor("resolved")).toBe("resolved");
    for (const s of ["open", "in_progress", "waiting_on_student"] as const) expect(counterKeyFor(s)).toBe(s);
  });

  it("counts every ticket exactly once, including closed", () => {
    const list = [withStatus("open", "a"), withStatus("open", "b"), withStatus("in_progress"), withStatus("waiting_on_student"), withStatus("resolved"), withStatus("closed")];
    const c = statusCounts(list);
    expect(c).toEqual({ open: 2, in_progress: 1, waiting_on_student: 1, resolved: 2 });
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(list.length);
  });

  it("has a label and a colour for every S16 status", () => {
    for (const s of TICKET_STATUSES) {
      expect(SUPPORT_TEXT.status[s]).toBeTruthy();
      expect(ORIGINAL_STATUS_STYLE[s].color).toMatch(/text-/);
    }
  });

  it("an empty list yields zero counters", () => {
    expect(statusCounts([])).toEqual({ open: 0, in_progress: 0, waiting_on_student: 0, resolved: 0 });
  });
});

describe("adapter mapping", () => {
  it("renames snake_case fields and derives topic label and flags", () => {
    const m = toCardModel(TICKET_AWAITING_STUDENT);
    expect(m).toMatchObject({
      id: "t-1", ticketNumber: "LP-1042", status: "waiting_on_student", topic: "transfer_credit",
      topicLabel: SUPPORT_TOPIC_INFO.transfer_credit.label,
      awaitingYou: true, advisorName: "Camille Moreau", commentCount: 2,
    });
    expect(m.createdAt).toBe(TICKET_AWAITING_STUDENT.created_at);
  });

  it("derives a topic for legacy tickets without one", () => {
    const m = toCardModel({ ...TICKET_WITH_LUMIERE, topic: undefined, category: "billing" });
    expect(m.topic).toBe("billing");
  });

  it("every category and topic has a label", () => {
    for (const category of TICKET_CATEGORIES) expect(toCardModel({ ...TICKET_WITH_LUMIERE, topic: undefined, category }).topicLabel).toBeTruthy();
    for (const topic of SUPPORT_TOPICS) expect(toCardModel({ ...TICKET_WITH_LUMIERE, topic }).topicLabel).toBeTruthy();
  });

  it("formats the verified context as a single label", () => {
    expect(toCardModel(TICKET_WITH_CONTEXT).contextLabel).toBe("Principles of Marketing (MKT300)");
    expect(toCardModel(TICKET_WITH_LUMIERE).contextLabel).toBeNull();
  });

  it("detail: chronological comments, attachments, ordered status history", () => {
    const d = toDetailModel({
      ...TICKET_AWAITING_STUDENT,
      ticket_comments: [...TICKET_AWAITING_STUDENT.ticket_comments].reverse(),
      ticket_status_history: [
        { id: "h2", old_status: "open", new_status: "in_progress", created_at: "2026-10-26T01:00:00.000Z" },
        { id: "h1", old_status: null, new_status: "open", created_at: "2026-10-25T09:00:00.000Z" },
      ],
      ticket_attachments: TICKET_WITH_CONTEXT.ticket_attachments,
    });
    expect(d.comments.map((c) => c.id)).toEqual(["c-1", "c-2"]);
    expect(d.comments.map((c) => c.authorKind)).toEqual(["student", "staff"]);
    expect(d.statusHistory.map((h) => h.status)).toEqual(["open", "in_progress"]);
    expect(d.attachments).toEqual([{ id: "a-1", name: "touchstone-2-feedback.pdf", size: 184_320, type: "application/pdf", uploadedByKind: "student" }]);
    expect(d.canAttach).toBe(true);
    expect(d.canReply).toBe(true);
  });

  it("detail: a summary without thread data yields empty collections, not a crash", () => {
    const d = toDetailModel({ ...TICKET_WITH_LUMIERE, ticket_comments: undefined, ticket_attachments: undefined, ticket_status_history: undefined, permissions: undefined });
    expect(d.comments).toEqual([]);
    expect(d.attachments).toEqual([]);
    expect(d.statusHistory).toEqual([]);
    expect(d.canAttach).toBe(false);
    expect(d.canReply).toBeUndefined();
  });
});

describe("privacy: nothing staff-only or internal passes through", () => {
  const poisoned = {
    ...TICKET_AWAITING_STUDENT,
    reporter_email: "leak@synthetic.example",
    assigned_to: "staff-user-99",
    is_overdue: true,
    reporter_id: "student-user-1",
    metadata: { internalFlag: "SECRET-META" },
    internal_notes: "SECRET-NOTES",
    assignee: { id: "staff-user-99", name: "Camille Moreau", role: "admin", email: "camille@synthetic.example" },
    ticket_comments: [
      ...TICKET_AWAITING_STUDENT.ticket_comments.map((c) => ({ ...c, author_id: "staff-user-99", author_role: "admin", ip: "10.0.0.1" })),
      { ...TICKET_AWAITING_STUDENT.ticket_comments[1]!, id: "c-int", content: INTERNAL_NOTE_TEXT, is_internal: true },
    ],
    ticket_attachments: [
      { id: "a-ok", ticket_id: "t-1", comment_id: null, file_name: "ok.pdf", file_size: 10, file_type: "application/pdf", uploaded_by: "staff-user-99", uploaded_by_kind: "staff", created_at: "2026-10-26T00:00:00.000Z", storage_path: "private/secret/path" },
      { id: "a-int", ticket_id: "t-1", comment_id: "c-int", file_name: "internal-only.pdf", file_size: 10, file_type: "application/pdf", uploaded_by: "staff-user-99", uploaded_by_kind: "staff", created_at: "2026-10-26T00:00:00.000Z" },
    ],
    ticket_status_history: [{ id: "h", old_status: "open", new_status: "in_progress", created_at: "2026-10-26T00:00:00.000Z", changed_by: "staff-user-99" }],
    permissions: { can_reply: true, can_attach: true, can_add_internal_note: true, can_assign: true, allowed_statuses: ["closed"], can_change_priority: true },
  } as unknown as OriginalSourceTicket;

  it("card and detail models drop every field outside the allow-list", () => {
    const json = JSON.stringify([toCardModel(poisoned), toDetailModel(poisoned)]);
    for (const secret of [
      "leak@synthetic.example", "staff-user-99", "SECRET-META", "SECRET-NOTES", "camille@synthetic.example", "10.0.0.1",
      "private/secret/path", INTERNAL_NOTE_TEXT, "internal-only.pdf", "reporter_email", "assigned_to", "is_overdue", "changed_by", "allowed_statuses",
    ]) expect(json).not.toContain(secret);
  });

  it("keys of the models are exactly the documented view model", () => {
    expect(Object.keys(toCardModel(poisoned)).sort()).toEqual([
      "advisorName", "attachmentCount", "awaitingYou", "category", "commentCount", "contextLabel", "createdAt", "description", "id", "priority",
      "resolutionNotes", "resolvedAt", "status", "subject", "ticketNumber", "topic", "topicLabel", "updatedAt",
    ]);
    const d = toDetailModel(poisoned);
    expect(Object.keys(d.comments[0]!).sort()).toEqual(["authorKind", "authorName", "content", "createdAt", "id"]);
    expect(Object.keys(d.attachments[0]!).sort()).toEqual(["id", "name", "size", "type", "uploadedByKind"]);
    expect(Object.keys(d.statusHistory[0]!).sort()).toEqual(["createdAt", "id", "status"]);
  });

  it("internal comments and their attachments are filtered even if the API leaked them", () => {
    const d = toDetailModel(TICKET_WITH_LEAKED_INTERNAL);
    expect(d.comments.map((c) => c.content)).not.toContain(INTERNAL_NOTE_TEXT);
    expect(d.commentCount).toBe(1);
    expect(publicComments(poisoned.ticket_comments).map((c) => c.id)).not.toContain("c-int");
    expect(publicAttachments(poisoned.ticket_attachments, poisoned.ticket_comments).map((a) => a.id)).toEqual(["a-ok"]);
  });

  it("card comment count ignores internal notes when the thread is present", () => {
    expect(toCardModel(poisoned).commentCount).toBe(2);
  });
});

describe("search and filters", () => {
  const cards = ALL_DETAILS.map((t) => toCardModel(t));

  it("no filters returns everything; hasActiveFilters is false", () => {
    expect(filterCards(cards, NO_FILTERS)).toHaveLength(cards.length);
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
  });

  it("searches subject, ticket number and description, case-insensitively", () => {
    expect(filterCards(cards, { ...NO_FILTERS, query: "TRANSCRIPT" }).map((c) => c.id)).toEqual(["t-1"]);
    expect(filterCards(cards, { ...NO_FILTERS, query: "lp-1051" }).map((c) => c.id)).toEqual(["t-2"]);
    expect(filterCards(cards, { ...NO_FILTERS, query: "blank page" }).map((c) => c.id)).toEqual(["t-2"]);
    expect(filterCards(cards, { ...NO_FILTERS, query: "  nothing-matches-this " })).toEqual([]);
  });

  it("status filter uses the counter buckets (resolved includes closed)", () => {
    const withClosed = [...cards, toCardModel({ ...TICKET_RESOLVED, id: "t-closed", status: "closed" })];
    const resolved = filterCards(withClosed, { ...NO_FILTERS, status: "resolved" }).map((c) => c.id);
    expect(resolved).toContain("t-closed");
    expect(resolved).toContain("t-3");
    expect(filterCards(withClosed, { ...NO_FILTERS, status: "waiting_on_student" }).map((c) => c.id)).toEqual(["t-1"]);
    expect(filterCards(withClosed, { ...NO_FILTERS, status: "open" }).map((c) => c.id)).toEqual(["t-5"]);
  });

  it("topic filter and combined filters", () => {
    expect(filterCards(cards, { ...NO_FILTERS, topic: "billing" }).map((c) => c.id)).toEqual(["t-3", "t-4"]);
    expect(filterCards(cards, { query: "lp-1008", status: "resolved", topic: "billing" }).map((c) => c.id)).toEqual(["t-3"]);
    expect(hasActiveFilters({ ...NO_FILTERS, topic: "billing" })).toBe(true);
  });

  it("sorts most recently updated first", () => {
    expect(sortByRecent(cards)[0]!.id).toBe("t-5");
  });

  it("counters always count the whole list, independent of filters", () => {
    const filtered = filterCards(cards, { ...NO_FILTERS, query: "invoice" });
    expect(statusCounts(cards)).not.toEqual(statusCounts(filtered));
    expect(Object.values(statusCounts(cards)).reduce((a, b) => a + b, 0)).toBe(cards.length);
  });
});

describe("live path ships no sample data and no client-side authorization", () => {
  const LIVE = [
    "client/src/pages/support.tsx",
    "client/src/components/support/original-student-support.tsx",
    "client/src/components/support/original-ticket-detail.tsx",
    "client/src/components/support/original-create-dialog.tsx",
    "client/src/components/support/original-support-adapter.ts",
    "client/src/components/support/original-support-bits.tsx",
    "client/src/components/support/original-support-text.ts",
  ];

  it("never imports support-old or references sampleTickets", () => {
    for (const f of LIVE) {
      const src = read(f);
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, f).not.toMatch(/support-old|sampleTickets|mike\.brown|student\.lumiere\.app/i);
    }
  });

  it("support.tsx routes students to the original UI and staff to the desk; support-old is not routed", () => {
    const page = read("client/src/pages/support.tsx");
    expect(page).toContain("isSupportStaffRole(user?.role) ? <StaffSupportDesk /> : <OriginalStudentSupport />");
    expect(read("client/src/App.tsx")).not.toMatch(/support-old/);
  });

  it("has no admin toggle, internal-note switch or status select", () => {
    for (const f of LIVE) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, f).not.toMatch(/isAdminView|switch-admin-mode|switch-internal-note|isInternal|select-status|onStatusChange/);
    }
  });

  it("uses the real hooks (idempotent create, comments, attachments) and no fake uploads", () => {
    const dialog = read("client/src/components/support/original-create-dialog.tsx");
    expect(dialog).toContain("newIdempotencyKey");
    expect(dialog).toContain("useCreateTicket");
    expect(read("client/src/components/support/original-ticket-detail.tsx")).toContain("useCreateComment");
    expect(read("client/src/components/support/original-ticket-detail.tsx")).toContain("useUploadTicketAttachment");
    expect(read("client/src/components/support/original-student-support.tsx")).toContain("useUploadTicketAttachment");
  });
});
