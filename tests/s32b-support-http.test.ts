/**
 * S32-B support repairs: HTTP tests over createTicketsRouter(deps) with the in-memory Supabase fake.
 * SA-02 (ticket part): staff receive student_id, coaches never do.
 * SA-12: search by reporter name/email/ticket number/student code, studentId filter for staff, coach stays assigned-only.
 * SA-31: single elective-requests list endpoint (admin only).
 * Synthetic data only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { createFakeClock, createFakeSupportSupabase } from "./helpers/fake-supabase-support";

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
  deliverEmail: vi.fn().mockResolvedValue("not_configured"),
  emailTransportConfigured: vi.fn(() => false),
  sendTicketCreatedEmailToStaff: vi.fn(),
  sendTicketStatusUpdateEmail: vi.fn(),
  sendNewCommentEmail: vi.fn(),
}));

import { createTicketsRouter } from "../server/routes/tickets";

const NOW = "2026-10-26T12:00:00.000Z";
const UUID_B = "11111111-1111-4111-8111-111111111111";
const U = {
  studentA: { id: "user-student-a", email: "ada.student@example.test", name: "Ada Student", role: "student" },
  studentB: { id: UUID_B, email: "ben.student@example.test", name: "Ben Student", role: "student" },
  staff: { id: "user-staff", email: "sam.staff@example.test", name: "Sam Staff", role: "staff" },
  admin: { id: "user-admin", email: "alex.admin@example.test", name: "Alex Admin", role: "admin" },
  coach: { id: "user-coach-1", email: "cora.coach@example.test", name: "Cora Coach", role: "coach" },
} as const;
type Who = keyof typeof U;
const STUDENT_RECORDS: Record<string, string> = { "user-student-a": "stu-a", [UUID_B]: "stu-b" };

function build(codeLookup: (term: string) => Promise<string[]> = async () => []) {
  const clock = createFakeClock(NOW);
  const fake = createFakeSupportSupabase({ clock });
  Object.values(U).forEach((u) => fake.seedUser({ ...u }));
  const authenticate: RequestHandler = (req, res, next) => {
    const u = U[req.header("x-test-user") as Who];
    if (!u) return res.status(401).json({ error: "no user" });
    (req as any).user = { id: u.id, email: u.email, role: u.role };
    next();
  };
  const router = createTicketsRouter({
    supabase: fake.client as any,
    isConfigured: () => true,
    authenticate,
    getAccountStatus: async () => "active",
    resolveStudentUserId: async (studentId: string) => Object.entries(STUDENT_RECORDS).find(([, s]) => s === studentId)?.[0] ?? null,
    getStudentByUserId: async (userId: string) => (STUDENT_RECORDS[userId] ? { id: STUDENT_RECORDS[userId] } : null),
    findReporterIdsByStudentCode: codeLookup,
    loadPublishedRoadmap: vi.fn() as any,
    audit: vi.fn().mockResolvedValue(undefined) as any,
    notify: { ticketCreated: vi.fn(), staffReplied: vi.fn(), studentReplied: vi.fn(), statusChanged: vi.fn() } as any,
    now: () => clock.now(),
  } as any);
  const app = express();
  app.use(express.json());
  app.use("/api/tickets", router);
  const as = (who: Who) => ({ get: (url: string) => request(app).get(url).set("x-test-user", who) });
  const seed = (o: { reporter: "studentA" | "studentB"; subject?: string; assignedTo?: Who | null; number?: string; subjectOverride?: string }) => {
    const r = U[o.reporter];
    return fake.seed("support_tickets", {
      reporter_id: r.id, reporter_name: r.name, reporter_email: r.email,
      subject: o.subject ?? "Seeded support request", description: "Seeded description of the problem.",
      category: "academic", priority: "medium", status: "open",
      assigned_to: o.assignedTo ? U[o.assignedTo].id : null,
      ...(o.number ? { ticket_number: o.number } : {}),
      metadata: { topic: "course_assistance", awaiting_since: NOW }, created_at: NOW, updated_at: NOW,
    });
  };
  return { app, fake, as, seed };
}

const ids = (res: request.Response) => res.body.tickets.map((t: any) => t.id).sort();
afterEach(() => vi.clearAllMocks());

describe("SA-12 studentId filter and search", () => {
  it("staff ?studentId= returns that student's tickets (all assignees); student and coach stay forbidden", async () => {
    const h = build();
    const a = h.seed({ reporter: "studentA" });
    const b1 = h.seed({ reporter: "studentB" });
    const b2 = h.seed({ reporter: "studentB", assignedTo: "coach" });
    const staff = await h.as("staff").get("/api/tickets?studentId=stu-b");
    expect(staff.status).toBe(200);
    expect(ids(staff)).toEqual([b1.id, b2.id].sort());
    expect(ids(staff)).not.toContain(a.id);
    expect((await h.as("admin").get("/api/tickets?studentId=stu-b")).status).toBe(200);
    expect((await h.as("coach").get("/api/tickets?studentId=stu-b")).status).toBe(403);
    expect((await h.as("studentA").get("/api/tickets?studentId=stu-b")).status).toBe(403);
    // An unknown student id yields an empty list, not an error.
    const none = await h.as("staff").get("/api/tickets?studentId=stu-unknown");
    expect(none.body.tickets).toEqual([]);
  });

  it("a coach stays limited to assigned tickets, including with a search term", async () => {
    const h = build();
    const mine = h.seed({ reporter: "studentB", assignedTo: "coach" });
    h.seed({ reporter: "studentB" });
    h.seed({ reporter: "studentA" });
    const res = await h.as("coach").get("/api/tickets?search=student");
    expect(ids(res)).toEqual([mine.id]);
    const byEmail = await h.as("coach").get("/api/tickets?search=ada.student@example.test");
    expect(byEmail.body.tickets).toEqual([]);
    const forged = await h.as("coach").get("/api/tickets?assignedTo=unassigned");
    expect(ids(forged)).toEqual([mine.id]);
  });

  it("finds tickets by reporter email, reporter name, ticket number and subject", async () => {
    const h = build();
    const a = h.seed({ reporter: "studentA", subject: "Transcript upload", number: "LUM-00101" });
    const b = h.seed({ reporter: "studentB", subject: "Plan question", number: "LUM-00202" });
    expect(ids(await h.as("staff").get("/api/tickets?search=ben.student@example.test"))).toEqual([b.id]);
    expect(ids(await h.as("staff").get("/api/tickets?search=Ada"))).toEqual([a.id]);
    expect(ids(await h.as("staff").get("/api/tickets?search=LUM-00202"))).toEqual([b.id]);
    expect(ids(await h.as("staff").get("/api/tickets?search=transcript"))).toEqual([a.id]);
    expect((await h.as("staff").get("/api/tickets?search=nobody-matches")).body.tickets).toEqual([]);
  });

  it("search input is inert: wildcards and filter syntax never widen the result", async () => {
    const h = build();
    h.seed({ reporter: "studentA" });
    h.seed({ reporter: "studentB" });
    const inject = await h.as("staff").get(`/api/tickets?search=${encodeURIComponent("x,subject.ilike.%,reporter_id.neq.0")}`);
    expect(inject.status).toBe(200);
    expect(inject.body.tickets).toEqual([]);
    const underscore = await h.as("staff").get(`/api/tickets?search=${encodeURIComponent("A_a")}`);
    expect(underscore.body.tickets).toEqual([]); // "_" must not act as a single-character wildcard
  });

  it("finds a student's tickets by student code for admin and staff only", async () => {
    const lookup = vi.fn(async (term: string) => (term.toUpperCase() === "LUM-STU-0007" ? [UUID_B] : []));
    const h = build(lookup);
    h.seed({ reporter: "studentA" });
    const b = h.seed({ reporter: "studentB", assignedTo: "coach" });
    expect(ids(await h.as("staff").get("/api/tickets?search=LUM-STU-0007"))).toEqual([b.id]);
    expect(ids(await h.as("admin").get("/api/tickets?search=LUM-STU-0007"))).toEqual([b.id]);
    lookup.mockClear();
    const coach = await h.as("coach").get("/api/tickets?search=LUM-STU-0007");
    expect(coach.body.tickets).toEqual([]);
    expect(lookup).not.toHaveBeenCalled(); // coaches never trigger a student-record lookup
  });
});

describe("SA-02 ticket detail student link", () => {
  it("returns student_id to admin and staff, never to the coach or the student", async () => {
    const h = build();
    const t = h.seed({ reporter: "studentB", assignedTo: "coach" });
    for (const who of ["admin", "staff"] as const) {
      const res = await h.as(who).get(`/api/tickets/${t.id}`);
      expect(res.body.ticket.student_id, who).toBe("stu-b");
    }
    expect((await h.as("coach").get(`/api/tickets/${t.id}`)).body.ticket.student_id).toBeUndefined();
    expect((await h.as("studentB").get(`/api/tickets/${t.id}`)).body.ticket.student_id).toBeUndefined();
  });

  it("returns the status history to staff (it is rendered by the desk)", async () => {
    const h = build();
    const t = h.seed({ reporter: "studentB" });
    h.fake.seed("ticket_status_history", { ticket_id: t.id, old_status: "open", new_status: "in_progress", changed_by: U.staff.id });
    const res = await h.as("staff").get(`/api/tickets/${t.id}`);
    expect(res.body.ticket.ticket_status_history).toHaveLength(1);
    expect(res.body.ticket.ticket_status_history[0].new_status).toBe("in_progress");
  });
});

describe("SA-31 elective requests list endpoint", () => {
  it("admin gets every elective ticket with its internal stage notes in one request; staff, coach and student are refused", async () => {
    const h = build();
    const e1 = h.seed({ reporter: "studentA", subject: "Elective change request: Art → Music" });
    const e2 = h.seed({ reporter: "studentB", subject: "Elective change request: Drama → Debate" });
    h.seed({ reporter: "studentA", subject: "Something else" });
    h.fake.seed("ticket_comments", { ticket_id: e1.id, author_id: U.admin.id, author_name: "Alex Admin", author_role: "admin", content: "[ELECTIVE-STAGE] lumiere_review\nChecking", is_internal: true });
    h.fake.seed("ticket_comments", { ticket_id: e1.id, author_id: U.admin.id, author_name: "Alex Admin", author_role: "admin", content: "Private chat", is_internal: true });
    h.fake.seed("ticket_comments", { ticket_id: e2.id, author_id: U.studentB.id, author_name: "Ben Student", author_role: "student", content: "[ELECTIVE-STAGE] approved", is_internal: false });
    const res = await h.as("admin").get("/api/tickets/elective-requests");
    expect(res.status).toBe(200);
    expect(res.body.requests.map((r: any) => r.id).sort()).toEqual([e1.id, e2.id].sort());
    const r1 = res.body.requests.find((r: any) => r.id === e1.id);
    expect(r1.stage_notes).toHaveLength(1);
    expect(r1.stage_notes[0].content).toContain("lumiere_review");
    expect(res.body.requests.find((r: any) => r.id === e2.id).stage_notes).toEqual([]); // a public comment cannot move a stage
    for (const who of ["staff", "coach", "studentA"] as const) {
      expect((await h.as(who).get("/api/tickets/elective-requests")).status, who).toBe(403);
    }
  });
});
