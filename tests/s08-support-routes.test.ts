/**
 * S08 Student Support Center: HTTP tests over createTicketsRouter(deps).
 *
 * The router is mounted in a small express app with express.json(). Every
 * collaborator is injected: an in-memory Supabase fake (tests/helpers/
 * fake-supabase-support.ts), a header-driven `authenticate`, vi.fn audit and
 * notifier (no email is ever sent), a synthetic published roadmap and a fixed
 * clock. Synthetic data only.
 *
 * Separate block at the end: the REAL requireAuth is mounted as `authenticate`
 * (local-JWT path, users lookup and account status mocked) to prove that
 * deactivated accounts get 403 ACCOUNT_INACTIVE on the support routes.
 */
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express, type RequestHandler } from "express";
import request from "supertest";
import type { StudentRoadmapView } from "../shared/student-roadmap-contract";
import { ALLOWED_SUPPORT_TOUCHES, createFakeClock, createFakeSupportSupabase, missingRelationError, type FakeSupportSupabase } from "./helpers/fake-supabase-support";

// ---------------------------------------------------------------------------
// Module mocks (external services only). The router under test receives its
// collaborators by injection; these keep the default-deps module graph and the
// real requireAuth block from reaching Supabase, Postgres or an email transport.
// ---------------------------------------------------------------------------
const accountActive = vi.hoisted(() => ({ value: true }));
const userRow = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => (accountActive.value ? "active" : "inactive")),
  isAccountActive: vi.fn(async () => accountActive.value),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: { auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "invalid" } })) }, from: vi.fn(), storage: { from: vi.fn() } },
  isSupabaseConfigured: false,
  createUserAuthClient: vi.fn(),
}));
vi.mock("../server/lib/db", () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => userRow.rows) })) })) })) },
}));
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
import { requireAuth } from "../server/middleware/auth";

// ---------------------------------------------------------------------------
// Synthetic world
// ---------------------------------------------------------------------------
const U = {
  studentA: { id: "user-student-a", email: "ada.student@example.test", name: "Ada Student", role: "student" },
  studentB: { id: "user-student-b", email: "ben.student@example.test", name: "Ben Student", role: "student" },
  staff: { id: "user-staff", email: "sam.staff@example.test", name: "Sam Staff", role: "staff" },
  admin: { id: "user-admin", email: "alex.admin@example.test", name: "Alex Admin", role: "admin" },
  coachAssigned: { id: "user-coach-1", email: "cora.coach@example.test", name: "Cora Coach", role: "coach" },
  coachOther: { id: "user-coach-2", email: "carl.coach@example.test", name: "Carl Coach", role: "coach" },
  staffInactive: { id: "user-staff-inactive", email: "old.staff@example.test", name: "Old Staff", role: "staff" },
} as const;
type UserKey = keyof typeof U;
const STUDENT_RECORDS: Record<string, string> = { "user-student-a": "stu-a", "user-student-b": "stu-b" };
const INACTIVE_IDS = new Set<string>([U.staffInactive.id]);
const NOW = "2026-10-26T12:00:00.000Z";
const day = (n: number) => new Date(new Date(NOW).getTime() - n * 86_400_000).toISOString();

const VALID_CREATE = { subject: "Question about my plan", description: "I would like help understanding my next courses.", topic: "roadmap_question" } as const;

function roadmapView(overrides: Partial<StudentRoadmapView> = {}): StudentRoadmapView {
  const base: any = {
    contractVersion: "student-roadmap/1",
    state: "PUBLISHED",
    preview: false,
    plan: { title: "Synthetic plan", summary: null, versionNumber: 3, publishedAt: day(10) },
    objectives: [],
    phases: [{
      key: "phase-1", title: "Foundation", sequence: 1, objectiveKey: null, startDate: null, endDate: null, description: null,
      counts: { itemsTotal: 2, itemsOfficiallyAccepted: 0, itemsProviderComplete: 0, itemsInProgress: 0, itemsNotStarted: 2, tasksTotal: 0, tasksGraded: 0, tasksSubmitted: 0 },
      state: "current",
      items: [
        { key: "item-eng101", phaseKey: "phase-1", objectiveKey: "obj", sequence: 1, kind: "course", code: "ENG101", title: "Synthetic Composition", provider: null, institution: null, credits: "3.00", plannedStart: null, plannedEnd: null, planStatus: "planned", holdReason: null, approval: null, alternativeOf: null, studentNote: null, waitingOn: [], itemStatus: "not_started", itemRevision: 0, tasks: [], taskCounts: { total: 0, graded: 0, submitted: 0, inProgress: 0, notStarted: 0 }, stage: "not_started", official: null, canReport: true, reportBlockedReason: null },
        { key: "item-dropped", phaseKey: "phase-1", objectiveKey: "obj", sequence: 2, kind: "course", code: "HIS101", title: "Dropped Course", provider: null, institution: null, credits: "3.00", plannedStart: null, plannedEnd: null, planStatus: "dropped", holdReason: null, approval: null, alternativeOf: null, studentNote: null, waitingOn: [], itemStatus: "not_started", itemRevision: 0, tasks: [], taskCounts: { total: 0, graded: 0, submitted: 0, inProgress: 0, notStarted: 0 }, stage: "not_started", official: null, canReport: false, reportBlockedReason: "not_active" },
      ],
    }],
    milestones: [],
    counts: { itemsTotal: 2, itemsOfficiallyAccepted: 0, itemsProviderComplete: 0, itemsInProgress: 0, itemsNotStarted: 2, tasksTotal: 0, tasksGraded: 0, tasksSubmitted: 0 },
    today: { focusItemKeys: [], headline: "", detail: "", nextMilestoneKey: null },
    foundation: { credentials: [], sources: [], ladder: { reported: "0", provisional: "0", verified: "0", applied: null, surplus: null, planned: "0", required: null }, degreeState: "NO_ACTIVE_PROGRAM" },
    history: { previousVersions: [], retiredProgress: [] },
  };
  return { ...base, ...overrides } as StudentRoadmapView;
}

interface Harness {
  app: Express;
  fake: FakeSupportSupabase;
  clock: ReturnType<typeof createFakeClock>;
  audit: ReturnType<typeof vi.fn>;
  notify: Record<"ticketCreated" | "staffReplied" | "studentReplied" | "statusChanged", ReturnType<typeof vi.fn>>;
  loadPublishedRoadmap: ReturnType<typeof vi.fn>;
  configured: { value: boolean };
}

const harnesses: Harness[] = [];

function build(opts: { authenticate?: RequestHandler } = {}): Harness {
  const clock = createFakeClock(NOW);
  const fake = createFakeSupportSupabase({ clock });
  Object.values(U).forEach((u) => fake.seedUser({ ...u }));
  const audit = vi.fn().mockResolvedValue(undefined);
  const notify = {
    ticketCreated: vi.fn().mockResolvedValue(true),
    staffReplied: vi.fn().mockResolvedValue(true),
    studentReplied: vi.fn().mockResolvedValue(true),
    statusChanged: vi.fn().mockResolvedValue(true),
  };
  const loadPublishedRoadmap = vi.fn(async () => roadmapView());
  const configured = { value: true };
  const authenticate: RequestHandler = opts.authenticate ?? ((req, res, next) => {
    const key = req.header("x-test-user") as UserKey | undefined;
    const user = key ? U[key] : undefined;
    if (!user) return res.status(401).json({ error: "Missing or invalid authorization header" });
    (req as any).user = { id: user.id, email: user.email, role: user.role };
    next();
  });
  const router = createTicketsRouter({
    supabase: fake.client as any,
    isConfigured: () => configured.value,
    authenticate,
    getAccountStatus: async (id: string) => (INACTIVE_IDS.has(id) ? "inactive" : "active"),
    resolveStudentUserId: async (studentId: string) => Object.entries(STUDENT_RECORDS).find(([, s]) => s === studentId)?.[0] ?? null,
    getStudentByUserId: async (userId: string) => (STUDENT_RECORDS[userId] ? { id: STUDENT_RECORDS[userId] } : null),
    loadPublishedRoadmap: loadPublishedRoadmap as any,
    audit: audit as any,
    notify: notify as any,
    now: () => clock.now(),
  } as any);
  const app = express();
  app.use(express.json());
  app.use("/api/tickets", router);
  const h = { app, fake, clock, audit, notify, loadPublishedRoadmap, configured };
  harnesses.push(h);
  return h;
}

const as = (h: Harness, who: UserKey) => ({
  get: (url: string) => request(h.app).get(url).set("x-test-user", who),
  post: (url: string, body?: unknown) => request(h.app).post(url).set("x-test-user", who).send(body as object),
  patch: (url: string, body?: unknown) => request(h.app).patch(url).set("x-test-user", who).send(body as object),
});

/** Seeds a ticket straight into the fake (same defaults as the database). */
function seedTicket(h: Harness, o: { reporter?: UserKey; status?: string; priority?: string; assignedTo?: UserKey | null; metadata?: Record<string, unknown>; resolvedAt?: string | null; createdAt?: string; subject?: string; withOpeningComment?: boolean } = {}) {
  const reporter = U[o.reporter ?? "studentA"];
  const created = o.createdAt ?? NOW;
  const t = h.fake.seed("support_tickets", {
    reporter_id: reporter.id, reporter_name: reporter.name, reporter_email: reporter.email,
    subject: o.subject ?? "Seeded support request", description: "Seeded description of the problem.",
    category: "academic", priority: o.priority ?? "medium", status: o.status ?? "open",
    assigned_to: o.assignedTo ? U[o.assignedTo].id : null,
    resolved_at: o.resolvedAt ?? null, resolution_notes: o.resolvedAt ? "Seeded resolution." : null,
    metadata: { topic: "course_assistance", awaiting_since: created, ...(o.metadata ?? {}) },
    created_at: created, updated_at: created,
  });
  if (o.withOpeningComment !== false) {
    h.fake.seed("ticket_comments", { ticket_id: t.id, author_id: reporter.id, author_name: reporter.name, author_role: "student", content: "Seeded description of the problem.", is_internal: false, created_at: created, updated_at: created });
  }
  return t;
}
function seedComment(h: Harness, ticketId: string, who: UserKey, content: string, isInternal = false) {
  const u = U[who];
  return h.fake.seed("ticket_comments", { ticket_id: ticketId, author_id: u.id, author_name: u.name, author_role: u.role, content, is_internal: isInternal, created_at: NOW, updated_at: NOW });
}

afterEach(() => {
  // Global invariant: no test ever touches an academic table; users is read-only.
  for (const h of harnesses.splice(0)) {
    const touched = [...h.fake.touchedTables()];
    expect(touched.filter((t) => !ALLOWED_SUPPORT_TOUCHES.includes(t))).toEqual([]);
    expect(h.fake.writtenTables().has("users")).toBe(false);
  }
  vi.clearAllMocks();
});

const bodyText = (res: request.Response) => JSON.stringify(res.body);

// ---------------------------------------------------------------------------
describe("1. create", () => {
  it("student creates a ticket: 201, priority forced medium, reporter from session, first public comment", async () => {
    const h = build();
    const res = await as(h, "studentA").post("/api/tickets", VALID_CREATE);
    expect(res.status).toBe(201);
    const t = res.body.ticket;
    expect(t.priority).toBe("medium");
    expect(t.status).toBe("open");
    expect(t.reporter_id).toBe(U.studentA.id);
    expect(t.ticket_number).toMatch(/^LUM-\d{5,}$/);
    expect(t.topic).toBe("roadmap_question");
    expect(t.awaiting).toBe("staff");
    expect(h.fake.rows("support_tickets")).toHaveLength(1);
    const comments = h.fake.rows("ticket_comments");
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ is_internal: false, author_id: U.studentA.id, content: VALID_CREATE.description });
  });

  it("a student-supplied priority is ignored (forced medium) and cannot create on behalf of someone else", async () => {
    const h = build();
    const res = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, priority: "urgent" });
    expect(res.status).toBe(201);
    expect(res.body.ticket.priority).toBe("medium");
    // Identity fields are not part of the strict schema: rejected, not silently honoured.
    for (const extra of [{ reporter_id: U.studentB.id }, { reporterId: U.studentB.id }, { studentId: "stu-b" }, { reporter_email: "x@example.test" }]) {
      const bad = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, ...extra });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe("VALIDATION_FAILED");
    }
    expect(h.fake.rows("support_tickets")).toHaveLength(1);
    expect(h.fake.rows("support_tickets")[0].reporter_id).toBe(U.studentA.id);
  });

  it("validation errors are 400 VALIDATION_FAILED and write nothing", async () => {
    const h = build();
    const res = await as(h, "studentA").post("/api/tickets", { subject: "x", description: "short", topic: "general" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(h.fake.rows("support_tickets")).toHaveLength(0);
  });

  it("staff cannot open a ticket through POST / (403)", async () => {
    const h = build();
    for (const who of ["staff", "admin", "coachAssigned"] as const) {
      const res = await as(h, who).post("/api/tickets", VALID_CREATE);
      expect(res.status).toBe(403);
    }
    expect(h.fake.rows("support_tickets")).toHaveLength(0);
  });

  it("unauthenticated requests are rejected by authenticate", async () => {
    const h = build();
    expect((await request(h.app).get("/api/tickets")).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe("2/3. visibility and isolation", () => {
  it("student lists only their own tickets", async () => {
    const h = build();
    const mine = seedTicket(h, { reporter: "studentA", subject: "Ada question one" });
    seedTicket(h, { reporter: "studentB", subject: "Ben question one" });
    const res = await as(h, "studentA").get("/api/tickets");
    expect(res.status).toBe(200);
    expect(res.body.tickets.map((t: any) => t.id)).toEqual([mine.id]);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.tickets[0]).not.toHaveProperty("assigned_to");
    expect(res.body.tickets[0]).not.toHaveProperty("reporter_email");
    expect(res.body.tickets[0]).not.toHaveProperty("is_overdue");
    expect(res.body.tickets[0]).not.toHaveProperty("metadata");
  });

  it("another student gets 404 on detail, comment, patch, attachments, upload-url and download", async () => {
    const h = build();
    const t = seedTicket(h, { reporter: "studentA" });
    const att = h.fake.seed("ticket_attachments", { ticket_id: t.id, file_name: "a.pdf", file_size: 100, file_type: "application/pdf", storage_path: `tickets/${t.id}/${U.studentA.id}/1700000000-abcd12.pdf`, uploaded_by: U.studentA.id });
    const b = as(h, "studentB");
    const results = await Promise.all([
      b.get(`/api/tickets/${t.id}`),
      b.post(`/api/tickets/${t.id}/comments`, { content: "hello there" }),
      b.patch(`/api/tickets/${t.id}`, { subject: "Changed subject text" }),
      b.post(`/api/tickets/${t.id}/attachments/upload-url`, { file_name: "a.pdf", file_size: 100, file_type: "application/pdf" }),
      b.post(`/api/tickets/${t.id}/attachments`, { file_name: "a.pdf", file_size: 100, file_type: "application/pdf", storage_path: `tickets/${t.id}/${U.studentB.id}/1700000000-abcd12.pdf` }),
      b.get(`/api/tickets/${t.id}/attachments/${att.id}/download-url`),
    ]);
    for (const r of results) {
      expect(r.status).toBe(404);
      expect(r.body.code).toBe("NOT_FOUND");
    }
    expect(h.fake.rows("ticket_comments")).toHaveLength(1);
    expect(h.fake.rows("support_tickets")[0].subject).toBe("Seeded support request");
  });

  it("studentId filter is ADMIN-ONLY: student, staff and coach get 403 FORBIDDEN; admin gets the server-resolved student's tickets", async () => {
    const h = build();
    seedTicket(h, { reporter: "studentA", assignedTo: "coachAssigned" });
    seedTicket(h, { reporter: "studentB" });
    for (const who of ["studentA", "staff", "coachAssigned"] as const) {
      const res = await as(h, who).get("/api/tickets?studentId=stu-b");
      expect(res.status, who).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    }
    const res = await as(h, "admin").get("/api/tickets?studentId=stu-b");
    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(1);
    expect(res.body.tickets[0].reporter_id).toBe(U.studentB.id);
  });

  it("coach sees only assigned tickets; unassigned coach gets 404 on a ticket; admin/staff see all", async () => {
    const h = build();
    const t = seedTicket(h, { assignedTo: "coachAssigned" });
    seedTicket(h, { reporter: "studentB" });
    const mine = await as(h, "coachAssigned").get("/api/tickets");
    expect(mine.body.tickets.map((x: any) => x.id)).toEqual([t.id]);
    expect((await as(h, "coachAssigned").get(`/api/tickets/${t.id}`)).status).toBe(200);
    const other = await as(h, "coachOther").get(`/api/tickets/${t.id}`);
    expect(other.status).toBe(404);
    expect((await as(h, "coachOther").get("/api/tickets")).body.tickets).toHaveLength(0);
    expect((await as(h, "staff").get("/api/tickets")).body.tickets).toHaveLength(2);
    expect((await as(h, "admin").get("/api/tickets")).body.tickets).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
describe("4/5/7/8. conversation lifecycle", () => {
  it("staff reply moves open -> in_progress, student sees it, student reply on waiting_on_student -> in_progress", async () => {
    const h = build();
    const t = seedTicket(h);
    const reply = await as(h, "staff").post(`/api/tickets/${t.id}/comments`, { content: "Thanks, we are looking into this." });
    expect(reply.status).toBe(201);
    expect(reply.body.ticket.status).toBe("in_progress");
    expect(h.fake.rows("support_tickets")[0].status).toBe("in_progress");

    const seen = await as(h, "studentA").get(`/api/tickets/${t.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.ticket.ticket_comments.map((c: any) => c.content)).toContain("Thanks, we are looking into this.");
    const staffComment = seen.body.ticket.ticket_comments.find((c: any) => c.content === "Thanks, we are looking into this.");
    expect(staffComment.author_kind).toBe("staff");
    expect(staffComment.author_id).toBe("staff"); // staff identity is not exposed to students
    expect(seen.body.ticket.last_public_reply_by).toBe("staff");

    const wait = await as(h, "staff").post(`/api/tickets/${t.id}/comments`, { content: "Could you send me the course code?", nextStatus: "waiting_on_student" });
    expect(wait.status).toBe(201);
    expect(wait.body.ticket.status).toBe("waiting_on_student");
    expect(wait.body.ticket.awaiting).toBe("student");

    const back = await as(h, "studentA").post(`/api/tickets/${t.id}/comments`, { content: "The code is ENG101." });
    expect(back.status).toBe(201);
    expect(h.fake.rows("support_tickets")[0].status).toBe("in_progress");
    expect(h.notify.studentReplied).toHaveBeenCalled();
    expect(h.notify.staffReplied).toHaveBeenCalled();
  });

  it("staff cannot be bypassed: student nextStatus is 403 and student cannot use isInternal", async () => {
    const h = build();
    const t = seedTicket(h);
    expect((await as(h, "studentA").post(`/api/tickets/${t.id}/comments`, { content: "close it", nextStatus: "closed" })).status).toBe(403);
    expect((await as(h, "studentA").post(`/api/tickets/${t.id}/comments`, { content: "secret", isInternal: true })).status).toBe(403);
    expect(h.fake.rows("ticket_comments")).toHaveLength(1);
  });

  it("resolve needs resolutionNotes (400 RESOLUTION_REQUIRED); student then sees notes and awaiting none", async () => {
    const h = build();
    const t = seedTicket(h, { status: "in_progress" });
    const missing = await as(h, "staff").patch(`/api/tickets/${t.id}`, { status: "resolved" });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("RESOLUTION_REQUIRED");
    expect(h.fake.rows("support_tickets")[0].status).toBe("in_progress");

    const ok = await as(h, "staff").patch(`/api/tickets/${t.id}`, { status: "resolved", resolutionNotes: "Your transfer evaluation is complete." });
    expect(ok.status).toBe(200);
    const row = h.fake.rows("support_tickets")[0];
    expect(row.status).toBe("resolved");
    expect(row.resolved_by).toBe(U.staff.id);
    expect(row.resolved_at).toBe(NOW);

    const view = await as(h, "studentA").get(`/api/tickets/${t.id}`);
    expect(view.body.ticket.resolution_notes).toBe("Your transfer evaluation is complete.");
    expect(view.body.ticket.awaiting).toBe("none");
    expect(view.body.ticket.status).toBe("resolved");
  });

  it("reply & resolve through a comment uses the reply as the resolution notes", async () => {
    const h = build();
    const t = seedTicket(h, { status: "in_progress" });
    const res = await as(h, "staff").post(`/api/tickets/${t.id}/comments`, { content: "All done, see your updated plan.", nextStatus: "resolved" });
    expect(res.status).toBe(201);
    expect(h.fake.rows("support_tickets")[0]).toMatchObject({ status: "resolved", resolution_notes: "All done, see your updated plan." });
  });

  it("student reply within 14 days reopens; after the window 409 REOPEN_WINDOW_EXPIRED; closed 409 TICKET_CLOSED", async () => {
    const h = build();
    const recent = seedTicket(h, { status: "resolved", resolvedAt: day(3) });
    const old = seedTicket(h, { status: "resolved", resolvedAt: day(20) });
    const closed = seedTicket(h, { status: "closed", resolvedAt: day(40) });

    const ok = await as(h, "studentA").post(`/api/tickets/${recent.id}/comments`, { content: "This is still not working." });
    expect(ok.status).toBe(201);
    expect(h.fake.rows("support_tickets").find((r) => r.id === recent.id)!.status).toBe("open");

    const late = await as(h, "studentA").post(`/api/tickets/${old.id}/comments`, { content: "Following up late." });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("REOPEN_WINDOW_EXPIRED");

    const shut = await as(h, "studentA").post(`/api/tickets/${closed.id}/comments`, { content: "Hello?" });
    expect(shut.status).toBe(409);
    expect(shut.body.code).toBe("TICKET_CLOSED");
    expect(h.fake.rows("support_tickets").find((r) => r.id === old.id)!.status).toBe("resolved");
  });

  it("student may edit subject/description only while open, unassigned and unanswered", async () => {
    const h = build();
    const t = seedTicket(h);
    const ok = await as(h, "studentA").patch(`/api/tickets/${t.id}`, { subject: "A clearer subject line" });
    expect(ok.status).toBe(200);
    expect(h.fake.rows("support_tickets")[0].subject).toBe("A clearer subject line");
    await as(h, "staff").post(`/api/tickets/${t.id}/comments`, { content: "Looking at it now." });
    const late = await as(h, "studentA").patch(`/api/tickets/${t.id}`, { subject: "Another subject change" });
    expect([403, 409]).toContain(late.status);
  });
});

// ---------------------------------------------------------------------------
describe("6. internal notes never reach students", () => {
  it("hides internal comments, counts, last public reply, linked attachments and download", async () => {
    const h = build();
    const t = seedTicket(h, { status: "in_progress", assignedTo: "staff" });
    seedComment(h, t.id, "staff", "PUBLIC-REPLY-TEXT");
    const note = seedComment(h, t.id, "staff", "INTERNAL-SECRET-NOTE", true);
    const noteAtt = h.fake.seed("ticket_attachments", { ticket_id: t.id, comment_id: note.id, file_name: "internal.pdf", file_size: 100, file_type: "application/pdf", storage_path: `tickets/${t.id}/${U.staff.id}/1-internal.pdf`, uploaded_by: U.staff.id });
    const publicAtt = h.fake.seed("ticket_attachments", { ticket_id: t.id, comment_id: null, file_name: "public.pdf", file_size: 100, file_type: "application/pdf", storage_path: `tickets/${t.id}/${U.studentA.id}/1-public.pdf`, uploaded_by: U.studentA.id });
    h.fake.addStorageObject(noteAtt.storage_path);

    const detail = await as(h, "studentA").get(`/api/tickets/${t.id}`);
    expect(detail.status).toBe(200);
    expect(bodyText(detail)).not.toContain("INTERNAL-SECRET-NOTE");
    expect(detail.body.ticket.ticket_comments.every((c: any) => c.is_internal === false)).toBe(true);
    expect(detail.body.ticket.ticket_attachments.map((a: any) => a.id)).toEqual([publicAtt.id]);
    expect(bodyText(detail)).not.toContain("internal.pdf");
    expect(detail.body.ticket.message_count).toBe(2); // opening + public reply
    expect(detail.body.ticket.last_public_reply_by).toBe("staff");
    for (const key of ["metadata", "assigned_to", "reporter_email"]) expect(detail.body.ticket).not.toHaveProperty(key);

    const list = await as(h, "studentA").get("/api/tickets");
    expect(list.body.tickets[0].message_count).toBe(2);
    expect(bodyText(list)).not.toContain("INTERNAL-SECRET-NOTE");

    const dl = await as(h, "studentA").get(`/api/tickets/${t.id}/attachments/${noteAtt.id}/download-url`);
    expect(dl.status).toBe(404);

    // Staff do see it, clearly flagged.
    const staffView = await as(h, "staff").get(`/api/tickets/${t.id}`);
    expect(staffView.body.ticket.ticket_comments.some((c: any) => c.is_internal && c.content === "INTERNAL-SECRET-NOTE")).toBe(true);
    expect(staffView.body.ticket.message_count).toBe(3);
  });

  it("an internal note never changes status and never notifies the student", async () => {
    const h = build();
    const t = seedTicket(h, { status: "open" });
    const res = await as(h, "staff").post(`/api/tickets/${t.id}/comments`, { content: "Check the transcript first.", isInternal: true });
    expect(res.status).toBe(201);
    expect(h.fake.rows("support_tickets")[0].status).toBe("open");
    expect(h.notify.staffReplied).not.toHaveBeenCalled();
    expect(h.notify.statusChanged).not.toHaveBeenCalled();
    expect(h.fake.opsOn("ticket_status_history", "insert")).toHaveLength(0);
  });

  it("student isInternal:true is rejected 403", async () => {
    const h = build();
    const t = seedTicket(h);
    const res = await as(h, "studentA").post(`/api/tickets/${t.id}/comments`, { content: "sneaky", isInternal: true });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe("9. history and audit", () => {
  it("keeps every comment, records status history with changed_by, audits support.* without bodies", async () => {
    const h = build();
    const created = await as(h, "studentA").post("/api/tickets", VALID_CREATE);
    const id = created.body.ticket.id;
    const BODY = "ZEBRA-UNIQUE-MESSAGE-BODY";
    await as(h, "staff").post(`/api/tickets/${id}/comments`, { content: BODY });
    await as(h, "staff").post(`/api/tickets/${id}/comments`, { content: "NOTE-BODY-XYZ", isInternal: true });
    await as(h, "staff").patch(`/api/tickets/${id}`, { assignedTo: U.coachAssigned.id });
    await as(h, "staff").patch(`/api/tickets/${id}`, { priority: "high" });
    await as(h, "staff").patch(`/api/tickets/${id}`, { status: "resolved", resolutionNotes: "RESOLUTION-TEXT-QQ" });

    expect(h.fake.rows("ticket_comments")).toHaveLength(3);
    const history = h.fake.rows("ticket_status_history");
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history.every((r) => r.ticket_id === id && typeof r.changed_by === "string")).toBe(true);
    expect(history.some((r) => r.old_status === "in_progress" && r.new_status === "resolved" && r.changed_by === U.staff.id)).toBe(true);

    const calls = h.audit.mock.calls.map((c) => c[0]);
    const types = calls.map((c: any) => c.eventType);
    expect(types.length).toBeGreaterThan(0);
    expect(types.every((t: string) => t.startsWith("support."))).toBe(true);
    expect(types).not.toContain("system.maintenance_mode");
    expect(types).not.toContain("admin.bulk_operation");
    expect(types).toEqual(expect.arrayContaining(["support.ticket_created", "support.comment_added", "support.internal_note_added", "support.status_changed"]));
    for (const c of calls as any[]) {
      expect(c.targetResourceType).toBe("support_ticket");
      expect(c.targetResourceId).toBe(id);
    }
    const auditText = JSON.stringify(calls);
    for (const secret of [BODY, "NOTE-BODY-XYZ", "RESOLUTION-TEXT-QQ", VALID_CREATE.description]) expect(auditText).not.toContain(secret);

    // The full conversation is still there for staff.
    const staffView = await as(h, "staff").get(`/api/tickets/${id}`);
    expect(staffView.body.ticket.ticket_comments).toHaveLength(3);
    expect(staffView.body.ticket.ticket_status_history.length).toBeGreaterThanOrEqual(2);
    expect(staffView.body.ticket.ticket_status_history[0]).toHaveProperty("changed_by");
    const studentView = await as(h, "studentA").get(`/api/tickets/${id}`);
    expect(studentView.body.ticket.ticket_status_history.every((e: any) => !("changed_by" in e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("10. authorization and transitions", () => {
  it("student PATCH of status, priority, assignedTo and resolutionNotes is 403", async () => {
    const h = build();
    const t = seedTicket(h);
    for (const body of [{ status: "closed" }, { priority: "urgent" }, { assignedTo: U.staff.id }, { resolutionNotes: "done" }]) {
      expect((await as(h, "studentA").patch(`/api/tickets/${t.id}`, body)).status).toBe(403);
    }
    expect(h.fake.rows("support_tickets")[0]).toMatchObject({ status: "open", priority: "medium", assigned_to: null });
  });

  it("coach: assigned coach cannot assign or close; unassigned coach gets 404 on PATCH", async () => {
    const h = build();
    const t = seedTicket(h, { status: "in_progress", assignedTo: "coachAssigned" });
    expect((await as(h, "coachAssigned").patch(`/api/tickets/${t.id}`, { assignedTo: U.coachOther.id })).status).toBe(403);
    expect((await as(h, "coachAssigned").patch(`/api/tickets/${t.id}`, { status: "closed" })).status).toBe(403);
    expect((await as(h, "coachOther").patch(`/api/tickets/${t.id}`, { status: "waiting_on_student" })).status).toBe(404);
    const ok = await as(h, "coachAssigned").patch(`/api/tickets/${t.id}`, { status: "waiting_on_student" });
    expect(ok.status).toBe(200);
    expect(h.fake.rows("support_tickets")[0].assigned_to).toBe(U.coachAssigned.id);
  });

  it("illegal and same-status transitions are 409 INVALID_TRANSITION", async () => {
    const h = build();
    const t = seedTicket(h, { status: "open" });
    const same = await as(h, "staff").patch(`/api/tickets/${t.id}`, { status: "open" });
    expect(same.status).toBe(409);
    expect(same.body.code).toBe("INVALID_TRANSITION");
    const resolved = seedTicket(h, { status: "resolved", resolvedAt: day(1) });
    const bad = await as(h, "staff").patch(`/api/tickets/${resolved.id}`, { status: "waiting_on_student" });
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe("INVALID_TRANSITION");
    const closedOnly = seedTicket(h, { status: "closed", resolvedAt: day(30) });
    expect((await as(h, "staff").patch(`/api/tickets/${closedOnly.id}`, { status: "resolved", resolutionNotes: "x done" })).status).toBe(409);
  });

  it("assignment: valid assignee ok; inactive, non-staff and unknown users are 400 INVALID_ASSIGNEE; null unassigns", async () => {
    const h = build();
    const t = seedTicket(h, { status: "in_progress" });
    const ok = await as(h, "staff").patch(`/api/tickets/${t.id}`, { assignedTo: U.coachAssigned.id });
    expect(ok.status).toBe(200);
    expect(h.fake.rows("support_tickets")[0].assigned_to).toBe(U.coachAssigned.id);
    for (const target of [U.staffInactive.id, U.studentB.id, "user-does-not-exist"]) {
      const res = await as(h, "admin").patch(`/api/tickets/${t.id}`, { assignedTo: target });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_ASSIGNEE");
    }
    expect(h.fake.rows("support_tickets")[0].assigned_to).toBe(U.coachAssigned.id);
    const un = await as(h, "admin").patch(`/api/tickets/${t.id}`, { assignedTo: null });
    expect(un.status).toBe(200);
    expect(h.fake.rows("support_tickets")[0].assigned_to).toBeNull();
  });

  it("staff directory: admin/staff only, active staff only", async () => {
    const h = build();
    expect((await as(h, "studentA").get("/api/tickets/staff-directory")).status).toBe(403);
    expect((await as(h, "coachAssigned").get("/api/tickets/staff-directory")).status).toBe(403);
    const res = await as(h, "staff").get("/api/tickets/staff-directory");
    expect(res.status).toBe(200);
    const ids = res.body.staff.map((p: any) => p.id);
    expect(ids).toEqual(expect.arrayContaining([U.staff.id, U.admin.id, U.coachAssigned.id]));
    expect(ids).not.toContain(U.staffInactive.id);
    expect(ids).not.toContain(U.studentA.id);
    expect(res.body.staff[0]).not.toHaveProperty("email");
  });

  it("detail permissions reflect the caller (students: no assign / internal)", async () => {
    const h = build();
    const t = seedTicket(h, { status: "in_progress", assignedTo: "coachAssigned" });
    const s = (await as(h, "studentA").get(`/api/tickets/${t.id}`)).body.ticket.permissions;
    expect(s.can_reply).toBe(true);
    expect(s.can_add_internal_note).toBe(false);
    expect(s.can_assign).toBe(false);
    expect(s.allowed_statuses).toEqual([]);
    const m = (await as(h, "staff").get(`/api/tickets/${t.id}`)).body.ticket.permissions;
    expect(m.can_assign).toBe(true);
    expect(m.can_add_internal_note).toBe(true);
    expect(m.allowed_statuses).toEqual(expect.arrayContaining(["waiting_on_student", "resolved", "closed"]));
    const c = (await as(h, "coachAssigned").get(`/api/tickets/${t.id}`)).body.ticket.permissions;
    expect(c.can_assign).toBe(false);
    expect(c.allowed_statuses).not.toContain("closed");
  });
});

// ---------------------------------------------------------------------------
describe("11. attachments", () => {
  const upload = (h: Harness, who: UserKey, id: string, body: object) => as(h, who).post(`/api/tickets/${id}/attachments/upload-url`, body);

  it("upload-url: allowed file gives a path under tickets/<ticketId>/<callerId>/ and no public URL", async () => {
    const h = build();
    const t = seedTicket(h);
    const res = await upload(h, "studentA", t.id, { file_name: "transcript.pdf", file_size: 2048, file_type: "application/pdf" });
    expect(res.status).toBe(200);
    expect(res.body.storagePath.startsWith(`tickets/${t.id}/${U.studentA.id}/`)).toBe(true);
    expect(res.body.storagePath.endsWith(".pdf")).toBe(true);
    expect(res.body.uploadUrl).toBeTruthy();
    expect(res.body).not.toHaveProperty("publicUrl");
    expect(bodyText(res)).not.toMatch(/public/i);
  });

  it("rejects disallowed types (400 ATTACHMENT_TYPE_NOT_ALLOWED), mismatched extension and files over 10 MB", async () => {
    const h = build();
    const t = seedTicket(h);
    const exe = await upload(h, "studentA", t.id, { file_name: "run.exe", file_size: 100, file_type: "application/x-msdownload" });
    expect(exe.status).toBe(400);
    expect(exe.body.code).toBe("ATTACHMENT_TYPE_NOT_ALLOWED");
    const mismatch = await upload(h, "studentA", t.id, { file_name: "photo.exe", file_size: 100, file_type: "image/png" });
    expect(mismatch.status).toBe(400);
    const big = await upload(h, "studentA", t.id, { file_name: "big.pdf", file_size: 10 * 1024 * 1024 + 1, file_type: "application/pdf" });
    expect(big.status).toBe(400);
    expect(h.fake.storageCalls.filter((c) => c.method === "createSignedUploadUrl")).toHaveLength(0);
  });

  it("recording an attachment: valid object ok; foreign, document and missing paths are 400", async () => {
    const h = build();
    const t = seedTicket(h);
    const good = `tickets/${t.id}/${U.studentA.id}/1700000000-abcd12.pdf`;
    h.fake.addStorageObject(good);
    const base = { file_name: "transcript.pdf", file_size: 2048, file_type: "application/pdf" };
    const ok = await as(h, "studentA").post(`/api/tickets/${t.id}/attachments`, { ...base, storage_path: good });
    expect(ok.status).toBe(201);
    expect(h.fake.rows("ticket_attachments")).toHaveLength(1);
    expect(h.fake.rows("ticket_attachments")[0]).toMatchObject({ ticket_id: t.id, uploaded_by: U.studentA.id, storage_path: good });
    expect(bodyText(ok)).not.toContain("publicUrl");

    const otherUser = `tickets/${t.id}/${U.studentB.id}/1700000000-abcd12.pdf`;
    const otherTicket = `tickets/${seedTicket(h, { reporter: "studentB" }).id}/${U.studentA.id}/1700000000-abcd12.pdf`;
    const docs = `documents/stu-b/passport.pdf`;
    const traversal = `tickets/${t.id}/${U.studentA.id}/../${U.studentB.id}/1700000000-abcd12.pdf`;
    for (const p of [otherUser, otherTicket, docs, traversal]) h.fake.addStorageObject(p);
    for (const p of [otherUser, otherTicket, docs, traversal]) {
      const res = await as(h, "studentA").post(`/api/tickets/${t.id}/attachments`, { ...base, storage_path: p });
      expect(res.status, p).toBe(400);
      expect(res.body.code).toBe("ATTACHMENT_PATH_INVALID");
    }
    const ghost = await as(h, "studentA").post(`/api/tickets/${t.id}/attachments`, { ...base, storage_path: `tickets/${t.id}/${U.studentA.id}/never-uploaded.pdf` });
    expect(ghost.status).toBe(400);
    expect(h.fake.rows("ticket_attachments")).toHaveLength(1);
  });

  it("comment_id must belong to the ticket; a student cannot attach to an internal comment", async () => {
    const h = build();
    const t = seedTicket(h, { status: "in_progress" });
    const other = seedTicket(h);
    const internal = seedComment(h, t.id, "staff", "private", true);
    const foreign = seedComment(h, other.id, "studentA", "other ticket comment");
    const path = `tickets/${t.id}/${U.studentA.id}/1700000000-abcd12.pdf`;
    h.fake.addStorageObject(path);
    const base = { file_name: "a.pdf", file_size: 10, file_type: "application/pdf", storage_path: path };
    expect((await as(h, "studentA").post(`/api/tickets/${t.id}/attachments`, { ...base, comment_id: internal.id })).status).toBeGreaterThanOrEqual(400);
    expect((await as(h, "studentA").post(`/api/tickets/${t.id}/attachments`, { ...base, comment_id: foreign.id })).status).toBeGreaterThanOrEqual(400);
    expect(h.fake.rows("ticket_attachments")).toHaveLength(0);
  });

  it("closed tickets accept no new attachments", async () => {
    const h = build();
    const t = seedTicket(h, { status: "closed", resolvedAt: day(30) });
    const path = `tickets/${t.id}/${U.studentA.id}/1700000000-abcd12.pdf`;
    h.fake.addStorageObject(path);
    const a = await upload(h, "studentA", t.id, { file_name: "a.pdf", file_size: 10, file_type: "application/pdf" });
    const b = await as(h, "studentA").post(`/api/tickets/${t.id}/attachments`, { file_name: "a.pdf", file_size: 10, file_type: "application/pdf", storage_path: path });
    expect([403, 409]).toContain(a.status);
    expect([403, 409]).toContain(b.status);
  });

  it("download: signed URL for access holders only, short-lived, audited, no public URL", async () => {
    const h = build();
    const t = seedTicket(h, { status: "in_progress" });
    const path = `tickets/${t.id}/${U.studentA.id}/1700000000-abcd12.pdf`;
    h.fake.addStorageObject(path);
    const att = h.fake.seed("ticket_attachments", { ticket_id: t.id, file_name: "a.pdf", file_size: 10, file_type: "application/pdf", storage_path: path, uploaded_by: U.studentA.id });
    const ok = await as(h, "studentA").get(`/api/tickets/${t.id}/attachments/${att.id}/download-url`);
    expect(ok.status).toBe(200);
    expect(ok.body.downloadUrl).toContain("download-token");
    expect(ok.body.downloadUrl).toContain("expires=300");
    expect(ok.body).not.toHaveProperty("publicUrl");
    expect((await as(h, "staff").get(`/api/tickets/${t.id}/attachments/${att.id}/download-url`)).status).toBe(200);
    expect((await as(h, "studentB").get(`/api/tickets/${t.id}/attachments/${att.id}/download-url`)).status).toBe(404);
    expect((await as(h, "coachOther").get(`/api/tickets/${t.id}/attachments/${att.id}/download-url`)).status).toBe(404);
    expect(h.audit.mock.calls.map((c) => c[0].eventType)).toContain("support.attachment_downloaded");
    // An attachment id from another ticket is not reachable through this ticket.
    const t2 = seedTicket(h, { reporter: "studentB" });
    const att2 = h.fake.seed("ticket_attachments", { ticket_id: t2.id, file_name: "b.pdf", file_size: 10, file_type: "application/pdf", storage_path: `tickets/${t2.id}/${U.studentB.id}/1-b.pdf`, uploaded_by: U.studentB.id });
    expect((await as(h, "studentA").get(`/api/tickets/${t.id}/attachments/${att2.id}/download-url`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe("12. external failures", () => {
  it("supabase not configured -> 503 SUPPORT_UNAVAILABLE (never a fake success)", async () => {
    const h = build();
    h.configured.value = false;
    const list = await as(h, "studentA").get("/api/tickets");
    expect(list.status).toBe(503);
    expect(list.body.code).toBe("SUPPORT_UNAVAILABLE");
    const create = await as(h, "studentA").post("/api/tickets", VALID_CREATE);
    expect(create.status).toBe(503);
    expect(create.body.code).toBe("SUPPORT_UNAVAILABLE");
    expect(h.fake.ops).toHaveLength(0);
  });

  it("storage errors are 503 STORAGE_UNAVAILABLE for upload-url and download-url", async () => {
    const h = build();
    const t = seedTicket(h);
    const path = `tickets/${t.id}/${U.studentA.id}/1700000000-abcd12.pdf`;
    const att = h.fake.seed("ticket_attachments", { ticket_id: t.id, file_name: "a.pdf", file_size: 10, file_type: "application/pdf", storage_path: path, uploaded_by: U.studentA.id });
    h.fake.failStorage();
    const up = await as(h, "studentA").post(`/api/tickets/${t.id}/attachments/upload-url`, { file_name: "a.pdf", file_size: 10, file_type: "application/pdf" });
    expect(up.status).toBe(503);
    expect(up.body.code).toBe("STORAGE_UNAVAILABLE");
    const dl = await as(h, "studentA").get(`/api/tickets/${t.id}/attachments/${att.id}/download-url`);
    expect(dl.status).toBe(503);
    expect(dl.body.code).toBe("STORAGE_UNAVAILABLE");
    h.fake.addStorageObject(path);
    const rec = await as(h, "studentA").post(`/api/tickets/${t.id}/attachments`, { file_name: "a.pdf", file_size: 10, file_type: "application/pdf", storage_path: path });
    expect(rec.status).toBe(503);
    expect(rec.body.code).toBe("STORAGE_UNAVAILABLE");
  });

  it("roadmap loader failure -> 503 CONTEXT_UNAVAILABLE and no ticket is created", async () => {
    const h = build();
    h.loadPublishedRoadmap.mockRejectedValueOnce(new Error("roadmap database offline"));
    const res = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, context: { roadmapItemKey: "item-eng101" } });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("CONTEXT_UNAVAILABLE");
    expect(bodyText(res)).not.toContain("roadmap database offline");
    expect(h.fake.rows("support_tickets")).toHaveLength(0);
    expect(h.fake.rows("ticket_comments")).toHaveLength(0);
    const opts = await (async () => { h.loadPublishedRoadmap.mockRejectedValueOnce(new Error("down")); return as(h, "studentA").get("/api/tickets/context-options"); })();
    expect(opts.status).toBe(503);
    expect(opts.body.code).toBe("CONTEXT_UNAVAILABLE");
  });

  it("context key not in the plan (or on a dropped item) -> 400 CONTEXT_NOT_IN_PLAN and no ticket", async () => {
    const h = build();
    for (const key of ["item-not-in-plan", "item-dropped"]) {
      const res = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, context: { roadmapItemKey: key } });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("CONTEXT_NOT_IN_PLAN");
    }
    expect(h.fake.rows("support_tickets")).toHaveLength(0);
  });

  it("S10: context is verified against the CALLER's own CURRENT published roadmap (another student's key and a superseded-version key are rejected)", async () => {
    const h = build();
    const withItem = (key: string, versionNumber: number) => {
      const v: any = roadmapView();
      v.plan = { ...v.plan, versionNumber };
      v.phases[0].items = [{ ...v.phases[0].items[0], key }];
      return v as StudentRoadmapView;
    };
    // Student B's current plan holds an item A does not have; A's current plan is v4,
    // where the v3 item "item-old-v3" no longer exists.
    h.loadPublishedRoadmap.mockImplementation(async (studentId: string) =>
      studentId === "stu-b" ? withItem("item-only-in-b", 2) : withItem("item-current-v4", 4));
    for (const key of ["item-only-in-b", "item-old-v3"]) {
      const res = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, context: { roadmapItemKey: key } });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("CONTEXT_NOT_IN_PLAN");
    }
    expect(h.fake.rows("support_tickets")).toHaveLength(0);
    const ok = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, context: { roadmapItemKey: "item-current-v4" } });
    expect(ok.status).toBe(201);
    expect(ok.body.ticket.context).toMatchObject({ itemKey: "item-current-v4", planVersion: 4 });
    expect(h.loadPublishedRoadmap.mock.calls.every((c) => c[0] === "stu-a")).toBe(true);
  });

  it("verified context is stored as a snapshot and shown on the ticket; browser cannot supply ids or titles", async () => {
    const h = build();
    const ok = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, context: { roadmapItemKey: "item-eng101" } });
    expect(ok.status).toBe(201);
    expect(ok.body.ticket.context).toMatchObject({ kind: "roadmap_item", itemKey: "item-eng101", title: "Synthetic Composition", code: "ENG101", planVersion: 3 });
    expect(h.loadPublishedRoadmap).toHaveBeenCalledWith("stu-a");
    const forged = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, context: { roadmapItemKey: "item-eng101", title: "Forged", studentId: "stu-b" } });
    expect(forged.status).toBe(400);
  });

  it("context-options lists only active items of the published plan; unpublished plan -> available false; students only", async () => {
    const h = build();
    const res = await as(h, "studentA").get("/api/tickets/context-options");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: true, planVersion: 3 });
    expect(res.body.items.map((i: any) => i.key)).toEqual(["item-eng101"]);
    h.loadPublishedRoadmap.mockResolvedValueOnce(roadmapView({ state: "NOT_PUBLISHED", plan: null, phases: [] } as any));
    const none = await as(h, "studentA").get("/api/tickets/context-options");
    expect(none.body).toMatchObject({ available: false, items: [] });
    expect((await as(h, "staff").get("/api/tickets/context-options")).status).toBe(403);
  });

  it("missing ticket_status_history / ticket_attachments tables: detail is still 200 with empty arrays", async () => {
    const h = build();
    const t = seedTicket(h);
    h.fake.missingTable("ticket_status_history");
    h.fake.missingTable("ticket_attachments");
    for (const who of ["studentA", "staff"] as const) {
      const res = await as(h, who).get(`/api/tickets/${t.id}`);
      expect(res.status).toBe(200);
      expect(res.body.ticket.ticket_status_history).toEqual([]);
      expect(res.body.ticket.ticket_attachments).toEqual([]);
      expect(res.body.ticket.ticket_comments.length).toBe(1);
    }
    expect(missingRelationError("x").code).toBe("42P01");
  });

  it("a status change still succeeds when the history table is missing (best effort)", async () => {
    const h = build();
    const t = seedTicket(h, { status: "open" });
    h.fake.missingTable("ticket_status_history");
    const res = await as(h, "staff").patch(`/api/tickets/${t.id}`, { status: "waiting_on_student" });
    expect(res.status).toBe(200);
    expect(h.fake.rows("support_tickets")[0].status).toBe("waiting_on_student");
  });

  it("a rejecting notifier does not turn a 201 into a failure and the response claims no email delivery", async () => {
    const h = build();
    for (const fn of Object.values(h.notify)) fn.mockRejectedValue(new Error("smtp down"));
    const res = await as(h, "studentA").post("/api/tickets", VALID_CREATE);
    expect(res.status).toBe(201);
    expect(bodyText(res)).not.toMatch(/email(ed)?\s+(sent|delivered)|notification (sent|delivered)|we (have )?emailed/i);
    expect(res.body).not.toHaveProperty("emailSent");
    expect(res.body).not.toHaveProperty("notified");
    const t = res.body.ticket;
    const reply = await as(h, "staff").post(`/api/tickets/${t.id}/comments`, { content: "We are on it, thank you." });
    expect(reply.status).toBe(201);
  });

  it("DB insert error -> 500 with a code and no ticket is left behind", async () => {
    const h = build();
    h.fake.failTable("support_tickets", { message: "connection terminated", code: "08006" }, "insert");
    const res = await as(h, "studentA").post("/api/tickets", VALID_CREATE);
    expect(res.status).toBe(500);
    expect(typeof res.body.code).toBe("string");
    expect(bodyText(res)).not.toContain("connection terminated");
    expect(h.fake.rows("support_tickets")).toHaveLength(0);
    expect(h.fake.rows("ticket_comments")).toHaveLength(0);
  });

  // ---- S10: truthful creation (compensating rollback + idempotent retry) ----
  const KEY = "form-submission-key-0001";
  const auditCalls = (h: Harness) => h.audit.mock.calls.map((c) => c[0] as any);

  it("S10: opening-comment failure -> 503 SUPPORT_CREATE_INCOMPLETE, no orphan ticket, failure audited, no notification", async () => {
    const h = build();
    h.fake.failTable("ticket_comments", { message: "boom", code: "XX000" }, "insert");
    const res = await as(h, "studentA").post("/api/tickets", VALID_CREATE);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("SUPPORT_CREATE_INCOMPLETE");
    expect(res.body.details).toEqual({ saved: false, mayHaveSaved: false });
    expect(res.body.ticket).toBeUndefined();
    expect(bodyText(res)).not.toContain("boom");
    expect(h.fake.rows("support_tickets")).toHaveLength(0);
    expect(h.fake.rows("ticket_comments")).toHaveLength(0);
    expect(h.fake.opsOn("support_tickets", "delete")).toHaveLength(1);
    const audits = auditCalls(h);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ eventType: "support.ticket_created", severity: "error", metadata: { outcome: "rolled_back", failedStep: "opening_comment" } });
    expect(JSON.stringify(audits[0])).not.toContain(VALID_CREATE.description);
    expect(h.notify.ticketCreated).not.toHaveBeenCalled();
  });

  it("S10: compensating delete also fails -> 503 telling the student it may have saved, critical audit, orphan only on delete failure", async () => {
    const h = build();
    h.fake.failTable("ticket_comments", { message: "boom", code: "XX000" }, "insert");
    h.fake.failTable("support_tickets", { message: "delete refused", code: "XX001" }, "delete");
    const res = await as(h, "studentA").post("/api/tickets", VALID_CREATE);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("SUPPORT_CREATE_INCOMPLETE");
    expect(res.body.details).toEqual({ saved: false, mayHaveSaved: true });
    expect(res.body.error).toMatch(/may appear|could not confirm/i);
    expect(bodyText(res)).not.toContain("delete refused");
    expect(h.fake.rows("support_tickets")).toHaveLength(1); // the orphan the audit/log point at
    expect(auditCalls(h)[0]).toMatchObject({ severity: "critical", metadata: { outcome: "rollback_failed" } });
    expect(h.notify.ticketCreated).not.toHaveBeenCalled();
  });

  it("S10: retry with the same key after a rolled-back failure creates exactly one complete ticket", async () => {
    const h = build();
    h.fake.failTable("ticket_comments", { message: "boom", code: "XX000" }, "insert", 1);
    const first = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, idempotencyKey: KEY });
    expect(first.status).toBe(503);
    const second = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, idempotencyKey: KEY });
    expect(second.status).toBe(201);
    expect(h.fake.rows("support_tickets")).toHaveLength(1);
    expect(h.fake.rows("ticket_comments")).toHaveLength(1);
  });

  it("S10: concurrent duplicate rejected by the unique index -> 409 SUPPORT_CREATE_IN_PROGRESS, nothing created", async () => {
    const h = build();
    h.fake.failTable("support_tickets", { message: "duplicate key value violates unique constraint", code: "23505" }, "insert", 1);
    const res = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, idempotencyKey: KEY });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SUPPORT_CREATE_IN_PROGRESS");
    expect(bodyText(res)).not.toContain("duplicate key");
    expect(h.fake.rows("ticket_comments")).toHaveLength(0);
    expect(h.notify.ticketCreated).not.toHaveBeenCalled();
  });

  it("S10: retry after a FAILED rollback removes the incomplete leftover and recreates cleanly", async () => {
    const h = build();
    h.fake.failTable("ticket_comments", { message: "boom", code: "XX000" }, "insert", 1);
    h.fake.failTable("support_tickets", { message: "delete refused", code: "XX001" }, "delete", 1);
    const first = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, idempotencyKey: KEY });
    expect(first.body.details.mayHaveSaved).toBe(true);
    expect(h.fake.rows("support_tickets")).toHaveLength(1);
    const orphanId = h.fake.rows("support_tickets")[0].id;
    const second = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, idempotencyKey: KEY });
    expect(second.status).toBe(201);
    expect(second.body.ticket.id).not.toBe(orphanId);
    expect(h.fake.rows("support_tickets")).toHaveLength(1);
    expect(h.fake.rows("ticket_comments")).toHaveLength(1);
  });

  it("S10: retry with the same key after success returns the existing ticket (200, same id), no duplicate, no second notification", async () => {
    const h = build();
    const first = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, idempotencyKey: KEY });
    expect(first.status).toBe(201);
    const again = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, idempotencyKey: KEY });
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.ticket.id).toBe(first.body.ticket.id);
    expect(h.fake.rows("support_tickets")).toHaveLength(1);
    expect(h.fake.rows("ticket_comments")).toHaveLength(1);
    expect(h.notify.ticketCreated).toHaveBeenCalledTimes(1);
    expect(auditCalls(h).filter((a) => a.eventType === "support.ticket_created")).toHaveLength(1);
  });

  it("S10: the same key from a different student never returns or reveals the first student's ticket", async () => {
    const h = build();
    const a = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, subject: "Ada private subject", idempotencyKey: KEY });
    const b = await as(h, "studentB").post("/api/tickets", { ...VALID_CREATE, subject: "Ben own subject", idempotencyKey: KEY });
    expect(b.status).toBe(201);
    expect(b.body.ticket.id).not.toBe(a.body.ticket.id);
    expect(bodyText(b)).not.toContain("Ada private subject");
    expect(h.fake.rows("support_tickets")).toHaveLength(2);
    expect(h.fake.rows("support_tickets").find((t) => t.id === b.body.ticket.id)?.reporter_id).toBe(U.studentB.id);
  });

  it("S10: requests without a key behave as before; malformed keys are rejected; the key is never exposed to students", async () => {
    const h = build();
    const plain = await as(h, "studentA").post("/api/tickets", VALID_CREATE);
    const plain2 = await as(h, "studentA").post("/api/tickets", VALID_CREATE);
    expect([plain.status, plain2.status]).toEqual([201, 201]);
    expect(h.fake.rows("support_tickets")).toHaveLength(2);
    expect((await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, idempotencyKey: "short" })).status).toBe(400);
    const keyed = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, idempotencyKey: KEY });
    expect(bodyText(keyed)).not.toContain(KEY);
    expect(h.fake.rows("support_tickets").find((t) => t.id === keyed.body.ticket.id)?.metadata.idempotency_key).toBe(KEY);
  });

  it("S10: creating a ticket (with academic context) writes only support tables and never touches academic data", async () => {
    const h = build();
    const res = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, context: { roadmapItemKey: "item-eng101" }, idempotencyKey: KEY });
    expect(res.status).toBe(201);
    expect([...h.fake.writtenTables()].sort()).toEqual(["support_tickets", "ticket_comments"]);
  });
});

// ---------------------------------------------------------------------------
describe("stats, overdue and filters", () => {
  it("/stats/summary is reachable (not swallowed by /:id); students are 403", async () => {
    const h = build();
    seedTicket(h);
    const res = await as(h, "staff").get("/api/tickets/stats/summary");
    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({ awaitingStaff: 1, awaitingStudent: 0, unassigned: 1 });
    expect(res.body.stats.byStatus.open).toBe(1);
    expect((await as(h, "studentA").get("/api/tickets/stats/summary")).status).toBe(403);
  });

  it("coach stats are scoped to assigned tickets", async () => {
    const h = build();
    seedTicket(h, { assignedTo: "coachAssigned", status: "in_progress" });
    seedTicket(h, { reporter: "studentB" });
    seedTicket(h, { reporter: "studentB", status: "waiting_on_student" });
    const coach = await as(h, "coachAssigned").get("/api/tickets/stats/summary");
    expect(coach.status).toBe(200);
    expect(coach.body.stats.awaitingStaff).toBe(1);
    expect(coach.body.stats.awaitingStudent).toBe(0);
    expect(coach.body.stats.unassigned).toBe(0);
    const admin = await as(h, "admin").get("/api/tickets/stats/summary");
    expect(admin.body.stats.awaitingStaff).toBe(2);
    expect(admin.body.stats.awaitingStudent).toBe(1);
    expect(admin.body.stats.unassigned).toBe(1); // unassigned among tickets awaiting staff
  });

  it("overdue is computed from awaiting_since and priority (staff only)", async () => {
    const h = build();
    const late = seedTicket(h, { priority: "medium", metadata: { awaiting_since: day(3) }, subject: "Overdue medium request" });
    seedTicket(h, { priority: "medium", subject: "Fresh medium request" });
    seedTicket(h, { status: "waiting_on_student", metadata: { awaiting_since: day(10) }, subject: "Waiting on the student" });
    const all = await as(h, "staff").get("/api/tickets");
    const byId = Object.fromEntries(all.body.tickets.map((t: any) => [t.subject, t]));
    expect(byId["Overdue medium request"].is_overdue).toBe(true);
    expect(byId["Fresh medium request"].is_overdue).toBe(false);
    expect(byId["Waiting on the student"].is_overdue).toBe(false);
    const only = await as(h, "staff").get("/api/tickets?overdue=true");
    expect(only.body.tickets.map((t: any) => t.id)).toEqual([late.id]);
    expect((await as(h, "staff").get("/api/tickets/stats/summary")).body.stats.overdue).toBe(1);
    // Students never get the overdue flag, whatever they ask for.
    const mine = await as(h, "studentA").get("/api/tickets?overdue=true");
    expect(mine.body.tickets.every((t: any) => !("is_overdue" in t))).toBe(true);
  });

  it("queue filters: view, awaiting, assignedTo, search, pagination", async () => {
    const h = build();
    const a = seedTicket(h, { subject: "Transcript upload problem", assignedTo: "staff" });
    const b = seedTicket(h, { subject: "Billing invoice question", status: "waiting_on_student" });
    const c = seedTicket(h, { subject: "Old resolved request", status: "resolved", resolvedAt: day(2) });
    const ids = (r: request.Response) => r.body.tickets.map((t: any) => t.id).sort();
    expect(ids(await as(h, "staff").get("/api/tickets?view=active"))).toEqual([a.id, b.id].sort());
    expect(ids(await as(h, "staff").get("/api/tickets?view=resolved"))).toEqual([c.id]);
    expect(ids(await as(h, "staff").get("/api/tickets?awaiting=student"))).toEqual([b.id]);
    expect(ids(await as(h, "staff").get("/api/tickets?awaiting=staff&view=active"))).toEqual([a.id]);
    expect(ids(await as(h, "staff").get("/api/tickets?assignedTo=unassigned"))).toEqual([b.id, c.id].sort());
    expect(ids(await as(h, "staff").get("/api/tickets?assignedTo=me"))).toEqual([a.id]);
    expect(ids(await as(h, "staff").get("/api/tickets?search=billing"))).toEqual([b.id]);
    const page = await as(h, "staff").get("/api/tickets?limit=2&offset=0");
    expect(page.body.tickets).toHaveLength(2);
    expect(page.body.pagination).toMatchObject({ total: 3, limit: 2, offset: 0 });
  });
});

// ---------------------------------------------------------------------------
describe("journey", () => {
  it("student opens -> creates -> staff receives -> staff replies -> student replies -> staff resolves -> student sees the outcome", async () => {
    const h = build();
    // Student opens the form: academic context options come from the published plan.
    const options = await as(h, "studentA").get("/api/tickets/context-options");
    expect(options.body.items[0].key).toBe("item-eng101");
    // Creates.
    const created = await as(h, "studentA").post("/api/tickets", { ...VALID_CREATE, subject: "Which course comes next?", context: { roadmapItemKey: "item-eng101" } });
    expect(created.status).toBe(201);
    const id = created.body.ticket.id;
    // Staff receives it in the queue.
    h.clock.advance(60 * 60_000);
    const queue = await as(h, "staff").get("/api/tickets?view=active&awaiting=staff");
    expect(queue.body.tickets.map((t: any) => t.id)).toContain(id);
    expect((await as(h, "staff").get("/api/tickets/stats/summary")).body.stats.awaitingStaff).toBe(1);
    // Staff replies and waits for the student.
    h.clock.advance(60 * 60_000);
    await as(h, "staff").patch(`/api/tickets/${id}`, { assignedTo: U.staff.id });
    const r1 = await as(h, "staff").post(`/api/tickets/${id}/comments`, { content: "Which term are you aiming for?", nextStatus: "waiting_on_student" });
    expect(r1.body.ticket.status).toBe("waiting_on_student");
    expect((await as(h, "staff").get("/api/tickets?awaiting=student")).body.tickets.map((t: any) => t.id)).toContain(id);
    const waiting = await as(h, "studentA").get(`/api/tickets/${id}`);
    expect(waiting.body.ticket.awaiting).toBe("student");
    // Student replies.
    h.clock.advance(60 * 60_000);
    const r2 = await as(h, "studentA").post(`/api/tickets/${id}/comments`, { content: "Spring term, please." });
    expect(r2.status).toBe(201);
    expect((await as(h, "staff").get(`/api/tickets/${id}`)).body.ticket.status).toBe("in_progress");
    // Staff leaves an internal note, then resolves.
    await as(h, "staff").post(`/api/tickets/${id}/comments`, { content: "Checked the plan; ENG101 is next.", isInternal: true });
    h.clock.advance(60 * 60_000);
    const done = await as(h, "staff").patch(`/api/tickets/${id}`, { status: "resolved", resolutionNotes: "ENG101 is your next course; it starts in the spring term." });
    expect(done.status).toBe(200);
    // Student sees the outcome, never the note.
    const outcome = await as(h, "studentA").get(`/api/tickets/${id}`);
    expect(outcome.body.ticket).toMatchObject({ status: "resolved", awaiting: "none", resolution_notes: "ENG101 is your next course; it starts in the spring term." });
    expect(bodyText(outcome)).not.toContain("Checked the plan");
    expect(outcome.body.ticket.ticket_comments.map((c: any) => c.author_kind)).toEqual(["student", "staff", "student"]);
    expect(h.fake.rows("ticket_comments")).toHaveLength(4);
    // Everything stayed inside the support tables.
    expect([...h.fake.touchedTables()].every((t) => ALLOWED_SUPPORT_TOUCHES.includes(t))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("deactivated accounts with the REAL requireAuth", () => {
  const JWT_SECRET = process.env.SESSION_SECRET || "local-dev-secret-change-in-production";
  function makeLocalJWT(userId: string, email: string): string {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ userId, email, iss: "lumiere-local", exp: now + 3600, iat: now, sub: userId })).toString("base64url");
    const sig = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
    return `${header}.${payload}.${sig}`;
  }

  beforeEach(() => { accountActive.value = true; userRow.rows = []; });
  afterEach(() => { accountActive.value = true; userRow.rows = []; });

  it("inactive student and inactive staff get 403 ACCOUNT_INACTIVE on every support route; an active account passes the same wiring", async () => {
    const h = build({ authenticate: requireAuth as RequestHandler });
    const t = seedTicket(h, { assignedTo: "staff" });
    const tokenFor = (u: { id: string; email: string; role: string; name: string }) => {
      userRow.rows = [{ id: u.id, email: u.email, name: u.name, role: u.role }];
      return `Bearer ${makeLocalJWT(u.id, u.email)}`;
    };

    // Control: active account is authenticated by the real middleware.
    accountActive.value = true;
    const okRes = await request(h.app).get("/api/tickets").set("Authorization", tokenFor(U.studentA));
    expect(okRes.status).toBe(200);

    accountActive.value = false;
    for (const u of [U.studentA, U.staff]) {
      const auth = tokenFor(u);
      const calls = await Promise.all([
        request(h.app).get("/api/tickets").set("Authorization", auth),
        request(h.app).get(`/api/tickets/${t.id}`).set("Authorization", auth),
        request(h.app).post("/api/tickets").set("Authorization", auth).send(VALID_CREATE),
        request(h.app).post(`/api/tickets/${t.id}/comments`).set("Authorization", auth).send({ content: "hello there" }),
        request(h.app).patch(`/api/tickets/${t.id}`).set("Authorization", auth).send({ status: "closed" }),
        request(h.app).get("/api/tickets/stats/summary").set("Authorization", auth),
      ]);
      for (const r of calls) {
        expect(r.status).toBe(403);
        expect(r.body.code).toBe("ACCOUNT_INACTIVE");
      }
    }
    expect(h.fake.rows("ticket_comments")).toHaveLength(1);
    expect(h.audit).not.toHaveBeenCalled();
  });
});
