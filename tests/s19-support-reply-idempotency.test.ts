/** S19: reply idempotency (Idempotency-Key header) on POST /api/tickets/:id/comments. Synthetic data only. */
import { afterEach, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { createFakeClock, createFakeSupportSupabase } from "./helpers/fake-supabase-support";

vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: { auth: { getUser: vi.fn() }, from: vi.fn(), storage: { from: vi.fn() } },
  isSupabaseConfigured: false,
  createUserAuthClient: vi.fn(),
}));
vi.mock("../server/lib/db", () => ({ db: {} }));
vi.mock("../server/lib/audit", () => ({
  auditAdmin: vi.fn().mockResolvedValue(undefined),
  auditSystem: vi.fn().mockResolvedValue(undefined),
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../server/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(false),
  sendTicketCreatedEmailToStaff: vi.fn(),
  sendTicketStatusUpdateEmail: vi.fn(),
  sendNewCommentEmail: vi.fn(),
}));

import { createTicketsRouter } from "../server/routes/tickets";

const NOW = "2026-10-26T12:00:00.000Z";
const A = { id: "user-student-a", email: "ada.student@example.test", name: "Ada Student", role: "student" };
const B = { id: "user-student-b", email: "ben.student@example.test", name: "Ben Student", role: "student" };
const KEY = "reply-key-0123456789abcdef";

function build() {
  const clock = createFakeClock(NOW);
  const fake = createFakeSupportSupabase({ clock });
  [A, B].forEach((u) => fake.seedUser({ ...u }));
  const audit = vi.fn().mockResolvedValue(undefined);
  const notify = { ticketCreated: vi.fn(), staffReplied: vi.fn(), studentReplied: vi.fn().mockResolvedValue(true), statusChanged: vi.fn() };
  const authenticate: RequestHandler = (req, res, next) => {
    const u = req.header("x-test-user") === "b" ? B : req.header("x-test-user") === "a" ? A : null;
    if (!u) return res.status(401).json({ error: "no" });
    (req as any).user = { id: u.id, email: u.email, role: u.role };
    next();
  };
  const router = createTicketsRouter({
    supabase: fake.client as any, isConfigured: () => true, authenticate,
    getAccountStatus: async () => "active",
    resolveStudentUserId: async () => null, getStudentByUserId: async (id: string) => ({ id: `stu-${id}` }),
    loadPublishedRoadmap: (async () => null) as any, audit: audit as any, notify: notify as any, now: () => clock.now(),
  } as any);
  const app = express();
  app.use(express.json());
  app.use("/api/tickets", router);
  const ticket = fake.seed("support_tickets", {
    reporter_id: A.id, reporter_name: A.name, reporter_email: A.email, subject: "Seeded request", description: "Seeded description text.",
    category: "academic", priority: "medium", status: "waiting_on_student", assigned_to: null, resolved_at: null,
    metadata: { topic: "course_assistance", awaiting_since: NOW }, created_at: NOW, updated_at: NOW,
  });
  fake.seed("ticket_comments", { ticket_id: ticket.id, author_id: A.id, author_name: A.name, author_role: "student", content: "Seeded description text.", is_internal: false, created_at: NOW, updated_at: NOW });
  const post = (who: "a" | "b", body: object, key?: string) => {
    const r = request(app).post(`/api/tickets/${ticket.id}/comments`).set("x-test-user", who);
    if (key) r.set("Idempotency-Key", key);
    return r.send(body);
  };
  return { fake, audit, notify, ticket, post };
}

afterEach(() => vi.clearAllMocks());
const countComments = (f: ReturnType<typeof build>) => f.fake.rows("ticket_comments").length;

describe("S19 reply idempotency", () => {
  it("first send creates (201); the same key again returns the same comment (200) with no second insert, audit or notification", async () => {
    const h = build();
    const first = await h.post("a", { content: "Here is the missing document." }, KEY);
    expect(first.status).toBe(201);
    expect(countComments(h)).toBe(2);
    await new Promise((r) => setTimeout(r, 10));
    const auditAfterFirst = h.audit.mock.calls.length;
    const notifyAfterFirst = h.notify.studentReplied.mock.calls.length;
    expect(notifyAfterFirst).toBe(1);

    const retry = await h.post("a", { content: "Here is the missing document." }, KEY);
    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBe(true);
    expect(retry.body.comment.id).toBe(first.body.comment.id);
    expect(countComments(h)).toBe(2);
    await new Promise((r) => setTimeout(r, 10));
    expect(h.audit.mock.calls.length).toBe(auditAfterFirst);
    expect(h.notify.studentReplied.mock.calls.length).toBe(notifyAfterFirst);
  });

  it("a different key, or no key, creates a new comment", async () => {
    const h = build();
    expect((await h.post("a", { content: "One" }, KEY)).status).toBe(201);
    expect((await h.post("a", { content: "Two" }, "another-key-0123456789abcd")).status).toBe(201);
    expect((await h.post("a", { content: "Three" })).status).toBe(201);
    expect(countComments(h)).toBe(4);
  });

  it("is scoped to the author: another student cannot replay or read the comment through the key", async () => {
    const h = build();
    await h.post("a", { content: "Mine" }, KEY);
    const other = await h.post("b", { content: "Not mine" }, KEY);
    expect(other.status).toBe(404); // B has no access to A's ticket
    expect(countComments(h)).toBe(2);
  });

  it("rejects a malformed key", async () => {
    const h = build();
    const res = await h.post("a", { content: "Hello" }, "short");
    expect(res.status).toBe(400);
    expect(countComments(h)).toBe(1);
  });

  it("the unique index race (23505) re-selects and returns the winner", async () => {
    const h = build();
    const [r1, r2] = await Promise.all([h.post("a", { content: "Race" }, KEY), h.post("a", { content: "Race" }, KEY)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    expect(r1.body.comment.id).toBe(r2.body.comment.id);
    expect(countComments(h)).toBe(2);
  });
});

import fs from "node:fs";
describe("S19 reply idempotency (client wiring)", () => {
  const read = (f: string) => fs.readFileSync(f, "utf8");
  it("sends an Idempotency-Key header, keeps the key across retries, resets it on success and disables the button while pending", () => {
    const hook = read("client/src/hooks/use-tickets.ts");
    expect(hook).toContain("'Idempotency-Key': idempotencyKey");
    const detail = read("client/src/components/support/original-ticket-detail.tsx");
    expect(detail).toContain("idempotencyKey: replyKey.current.key");
    expect(detail).toContain("replyKey.current?.content !== content");
    expect(detail).toMatch(/onSuccess: \(\) => \{ replyKey\.current = null;/);
    expect(detail).toContain("comment.isPending");
    expect(detail).toMatch(/disabled=\{!draft\.trim\(\) \|\| !canReply \|\| comment\.isPending\}/);
  });
});
