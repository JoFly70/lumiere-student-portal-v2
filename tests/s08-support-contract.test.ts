/**
 * S08 — pure contract rules, presenter stripping, notifications, context.
 */
import { describe, expect, it, vi } from "vitest";
import {
  attachmentTypeAllowed, awaitingFor, canStaffTransition, createTicketInputSchema, isOverdue,
  statusAfterStudentReply, topicForTicket, SUPPORT_ATTACHMENT_MAX_BYTES,
} from "../shared/support-contract";
import { presentDetail, presentSummary, viewerCanAccessTicket } from "../server/lib/support-presenter";
import { createSupportNotifier, escapeHtml } from "../server/lib/support-notifications";
import { listContextOptions, verifyRoadmapContext } from "../server/lib/support-context";

const NOW = new Date("2026-10-27T12:00:00Z");
const ticket = (over: Record<string, unknown> = {}) => ({
  id: "t1", ticket_number: "LUM-10001", reporter_id: "stu", reporter_name: "Stu", reporter_email: "stu@x.com",
  subject: "Help me", description: "Need help please", category: "academic", priority: "medium", status: "open",
  assigned_to: "coach1", resolved_at: null, resolution_notes: null,
  created_at: "2026-10-27T08:00:00Z", updated_at: "2026-10-27T08:00:00Z",
  metadata: { topic: "roadmap_question", awaiting_since: "2026-10-27T08:00:00Z", secret: "staff-only" }, ...over,
});
const comments = [
  { id: "c1", ticket_id: "t1", author_id: "stu", author_name: "Stu", author_role: "student", content: "hello", is_internal: false, created_at: "2026-10-27T08:00:00Z" },
  { id: "c2", ticket_id: "t1", author_id: "coach1", author_name: "Coach", author_role: "coach", content: "INTERNAL SECRET", is_internal: true, created_at: "2026-10-27T09:00:00Z" },
  { id: "c3", ticket_id: "t1", author_id: "coach1", author_name: "Coach", author_role: "coach", content: "public reply", is_internal: false, created_at: "2026-10-27T10:00:00Z" },
];
const attachments = [
  { id: "a1", ticket_id: "t1", comment_id: "c1", file_name: "a.pdf", file_size: 5, file_type: "application/pdf", storage_path: "tickets/t1/stu/x.pdf", uploaded_by: "stu", created_at: "x" },
  { id: "a2", ticket_id: "t1", comment_id: "c2", file_name: "b.pdf", file_size: 5, file_type: "application/pdf", storage_path: "tickets/t1/coach1/y.pdf", uploaded_by: "coach1", created_at: "x" },
];
const people = new Map([["coach1", { name: "Coach", role: "coach" }]]);
const history = [{ id: "h1", old_status: "open", new_status: "in_progress", changed_by: "coach1", created_at: "x" }];
const base = { ticket: ticket(), comments, attachments, people, now: NOW };

describe("contract rules", () => {
  it("validates staff transitions", () => {
    expect(canStaffTransition("coach", "open", "in_progress")).toBe(true);
    expect(canStaffTransition("coach", "open", "closed")).toBe(false);
    expect(canStaffTransition("staff", "open", "closed")).toBe(true);
    expect(canStaffTransition("coach", "closed", "in_progress")).toBe(false);
    expect(canStaffTransition("staff", "open", "open")).toBe(false);
    expect(canStaffTransition("student", "open", "in_progress")).toBe(false);
  });
  it("student reply rules", () => {
    expect(statusAfterStudentReply("closed", null, NOW)).toEqual({ ok: false, code: "TICKET_CLOSED" });
    expect(statusAfterStudentReply("waiting_on_student", null, NOW)).toEqual({ ok: true, next: "in_progress" });
    expect(statusAfterStudentReply("resolved", "2026-10-20T00:00:00Z", NOW)).toEqual({ ok: true, next: "open" });
    expect(statusAfterStudentReply("resolved", "2026-09-01T00:00:00Z", NOW)).toEqual({ ok: false, code: "REOPEN_WINDOW_EXPIRED" });
  });
  it("awaiting and overdue", () => {
    expect(awaitingFor("waiting_on_student")).toBe("student");
    expect(awaitingFor("resolved")).toBe("none");
    expect(isOverdue({ status: "open", priority: "urgent", awaitingSince: "2026-10-27T07:00:00Z" }, NOW)).toBe(true);
    expect(isOverdue({ status: "open", priority: "low", awaitingSince: "2026-10-27T07:00:00Z" }, NOW)).toBe(false);
    expect(isOverdue({ status: "waiting_on_student", priority: "urgent", awaitingSince: "2020-01-01T00:00:00Z" }, NOW)).toBe(false);
  });
  it("attachment allow-list and topic fallback", () => {
    expect(attachmentTypeAllowed("a.pdf", "application/pdf")).toBe(true);
    expect(attachmentTypeAllowed("a.exe", "application/pdf")).toBe(false);
    expect(attachmentTypeAllowed("a.pdf", "application/x-msdownload")).toBe(false);
    expect(SUPPORT_ATTACHMENT_MAX_BYTES).toBe(10485760);
    expect(topicForTicket({}, "billing")).toBe("billing");
  });
  it("create schema requires topic or category and rejects unknown keys", () => {
    expect(createTicketInputSchema.safeParse({ subject: "Hello there", description: "A long description" }).success).toBe(false);
    expect(createTicketInputSchema.safeParse({ subject: "Hello there", description: "A long description", topic: "general", reporter_id: "x" }).success).toBe(false);
    expect(createTicketInputSchema.safeParse({ subject: "Hello there", description: "A long description", topic: "general" }).success).toBe(true);
  });
});

describe("access and presenter", () => {
  it("scopes access by role", () => {
    const t = ticket();
    expect(viewerCanAccessTicket({ id: "stu", role: "student" }, t)).toBe(true);
    expect(viewerCanAccessTicket({ id: "other", role: "student" }, t)).toBe(false);
    expect(viewerCanAccessTicket({ id: "coach1", role: "coach" }, t)).toBe(true);
    expect(viewerCanAccessTicket({ id: "coach2", role: "coach" }, t)).toBe(false);
    expect(viewerCanAccessTicket({ id: "coach1", role: "coach" }, ticket({ assigned_to: null }))).toBe(false);
    expect(viewerCanAccessTicket({ id: "s", role: "staff" }, t)).toBe(true);
    expect(viewerCanAccessTicket({ id: "s", role: "mystery" }, t)).toBe(false);
  });
  it("strips staff-only data for students", () => {
    const d = presentDetail({ ...base, history, viewer: { id: "stu", role: "student" } });
    const json = JSON.stringify(d);
    expect(json).not.toContain("INTERNAL SECRET");
    expect(json).not.toContain("storage_path");
    expect(json).not.toContain("staff-only");
    expect(d).not.toHaveProperty("reporter_email");
    expect(d).not.toHaveProperty("assigned_to");
    expect(d).not.toHaveProperty("is_overdue");
    expect(d).not.toHaveProperty("metadata");
    expect(d.ticket_comments.map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(d.ticket_attachments.map((a) => a.id)).toEqual(["a1"]);
    expect(d.message_count).toBe(2);
    expect(d.attachment_count).toBe(1);
    expect(d.ticket_status_history[0]).not.toHaveProperty("changed_by");
    expect(d.assignee?.id).not.toBe("coach1");
    expect(d.permissions.can_add_internal_note).toBe(false);
    expect(d.permissions.allowed_statuses).toEqual([]);
    expect(d.last_public_reply_by).toBe("staff");
  });
  it("gives staff the full picture", () => {
    const d = presentDetail({ ...base, history, viewer: { id: "coach1", role: "coach" } });
    expect(d.ticket_comments).toHaveLength(3);
    expect(d.ticket_comments[1].is_internal).toBe(true);
    expect(d.message_count).toBe(3);
    expect(d.attachment_count).toBe(2);
    expect(d.reporter_email).toBe("stu@x.com");
    expect(d.assigned_to).toBe("coach1");
    expect(d.is_overdue).toBe(false); // 4h old, medium target 48h
  });
});

describe("overdue flag in staff summary", () => {
  it("respects the target hours", () => {
    const young = presentSummary({ ...base, ticket: ticket({ metadata: { awaiting_since: "2026-10-27T10:00:00Z" } }), viewer: { id: "s", role: "staff" } });
    expect(young.is_overdue).toBe(false);
    const old = presentSummary({ ...base, ticket: ticket({ metadata: { awaiting_since: "2026-10-20T10:00:00Z" } }), viewer: { id: "s", role: "staff" } });
    expect(old.is_overdue).toBe(true);
    expect(old.awaiting).toBe("staff");
  });
  it("falls back to updated_at for legacy tickets without metadata", () => {
    const s = presentSummary({ ...base, ticket: ticket({ metadata: null }), viewer: { id: "s", role: "staff" } });
    expect(s.awaiting_since).toBe("2026-10-27T08:00:00Z");
    expect(s.topic).toBe("course_assistance");
  });
});

describe("notifications", () => {
  it("escapes HTML", () => {
    expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe("&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
  });
  it("routes recipients and escapes content", async () => {
    const sendEmail = vi.fn(async () => true);
    const n = createSupportNotifier({ sendEmail });
    const t = { ticketNumber: "LUM-1", subject: "<b>hi</b>" };
    await n.staffReplied({ ...t, studentEmail: "stu@x.com", studentName: "<i>S</i>", staffName: "Coach", excerpt: "<script>alert(1)</script>" });
    await n.studentReplied({ ...t, studentName: "S", assigneeEmail: "coach@x.com", excerpt: "hi" });
    await n.studentReplied({ ...t, studentName: "S", assigneeEmail: null, excerpt: "hi" });
    await n.statusChanged({ ...t, studentEmail: "stu@x.com", studentName: "S", status: "resolved" });
    await n.ticketCreated({ ...t, studentName: "S", studentEmail: "stu@x.com", topicLabel: "General" });
    const calls = sendEmail.mock.calls.map((c: any[]) => c[0]);
    expect(calls[0].to).toBe("stu@x.com");
    expect(calls[0].html).not.toContain("<script>");
    expect(calls[0].html).toContain("&lt;script&gt;");
    expect(calls[0].html).not.toContain("<i>S</i>");
    expect(calls[1].to).toBe("coach@x.com");
    expect(calls[2].to).not.toBe("stu@x.com");
    expect(calls[2].to).toBe(process.env.ADMIN_EMAIL || "support@lumiere.edu");
    expect(calls[3].to).toBe("stu@x.com");
    expect(calls[4].to).not.toBe("stu@x.com");
  });
});

describe("roadmap context", () => {
  const item = (key: string, planStatus: string) => ({ key, title: `Title ${key}`, code: `C-${key}`, kind: "course", planStatus });
  const view: any = {
    state: "PUBLISHED", preview: false, plan: { title: "P", summary: null, versionNumber: 3, publishedAt: null },
    phases: [{ key: "p1", title: "Phase 1", items: [item("a", "planned"), item("b", "hold"), item("c", "dropped"), item("d", "alternative")] }],
  };
  it("verifies only active items of the published plan", () => {
    expect(verifyRoadmapContext(view, "a", NOW)).toMatchObject({ kind: "roadmap_item", itemKey: "a", title: "Title a", code: "C-a", itemKind: "course", planVersion: 3, verifiedAt: NOW.toISOString() });
    expect(verifyRoadmapContext(view, "b", NOW)).not.toBeNull();
    expect(verifyRoadmapContext(view, "c", NOW)).toBeNull();
    expect(verifyRoadmapContext(view, "d", NOW)).toBeNull();
    expect(verifyRoadmapContext(view, "zzz", NOW)).toBeNull();
    expect(verifyRoadmapContext({ ...view, state: "NOT_PUBLISHED", plan: null }, "a", NOW)).toBeNull();
    expect(verifyRoadmapContext({ ...view, preview: true }, "a", NOW)).toBeNull();
  });
  it("lists options without mutating the view", () => {
    const frozen = JSON.stringify(view);
    const o = listContextOptions(view);
    expect(o).toMatchObject({ available: true, planVersion: 3 });
    expect(o.items.map((i) => i.key)).toEqual(["a", "b"]);
    expect(o.items[0].phaseTitle).toBe("Phase 1");
    expect(JSON.stringify(view)).toBe(frozen);
    expect(listContextOptions({ ...view, state: "NOT_PUBLISHED", plan: null })).toEqual({ available: false, planVersion: null, items: [] });
  });
});
