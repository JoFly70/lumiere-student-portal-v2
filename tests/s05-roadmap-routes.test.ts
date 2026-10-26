/**
 * S05 roadmap HTTP boundary tests. Real requireAuth + requireRole; the data
 * layer is an in-memory fake repository behind the real service and projection.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import crypto from "crypto";
import { createFakeRoadmapStore } from "./helpers/fake-roadmap-repo";

const IDS = {
  admin: "00000000-0000-0000-0000-000000000001",
  staff: "00000000-0000-0000-0000-000000000002",
  student: "00000000-0000-0000-0000-000000000003",
  coach: "00000000-0000-0000-0000-000000000004",
};
const JWT_SECRET = process.env.SESSION_SECRET || "local-dev-secret-change-in-production";

function makeLocalJWT(userId: string, email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    userId, email, iss: "lumiere-local",
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
    sub: userId, aud: "authenticated", role: "authenticated",
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

const mockGetUser = vi.hoisted(() => vi.fn());
vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/account-status.js", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: { auth: { getUser: mockGetUser } },
  isSupabaseConfigured: true,
  createUserAuthClient: () => ({ auth: {} }),
}));
vi.mock("../server/lib/supabase.js", () => ({
  supabaseAdmin: { auth: { getUser: mockGetUser } },
  isSupabaseConfigured: true,
  createUserAuthClient: () => ({ auth: {} }),
}));
let currentUserRow: unknown[] = [];
vi.mock("../server/lib/db", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => currentUserRow) })) })) })),
  },
}));
vi.mock("../server/lib/audit", () => ({
  auditAdmin: vi.fn().mockResolvedValue(undefined),
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../server/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../server/lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const userRows: Record<string, { id: string; email: string; name: string; role: string }> = {
  admin: { id: IDS.admin, email: "admin@test.com", name: "A", role: "admin" },
  staff: { id: IDS.staff, email: "staff@test.com", name: "S", role: "staff" },
  student: { id: IDS.student, email: "student@test.com", name: "St", role: "student" },
  coach: { id: IDS.coach, email: "coach@test.com", name: "C", role: "coach" },
};

import { createStudentRoadmapService } from "../server/services/student-roadmap-service";
import { diffRoadmapContent, validateRoadmapContent } from "../shared/student-roadmap-validation";
import { ROADMAP_CONTENT_VERSION, type ConversionResult, type RoadmapContent } from "../shared/student-roadmap-contract";
import { createAdminStudentRoadmapRouter } from "../server/routes/admin-student-roadmap";
import { createStudentRoadmapRouter } from "../server/routes/student-roadmap";

const STAFF_SECRET = "STAFF-ONLY-NOTE-xyz";
const STUDENT_ID = "stu-1";

const roadmap: RoadmapContent = {
  contentVersion: ROADMAP_CONTENT_VERSION,
  title: "Plan",
  objectives: [{ key: "ba", title: "BA", kind: "primary", linkedToProgramAssignment: true, status: "active" }],
  phases: [{ key: "p1", title: "Phase 1", sequence: 1 }],
  items: [{
    key: "eng101", phaseKey: "p1", objectiveKey: "ba", sequence: 1, kind: "course", title: "English", dependsOn: [],
    planStatus: "planned", staffNote: STAFF_SECRET, studentNote: "Visible note",
    linkedCreditRecordId: "11111111-1111-4111-8111-111111111111",
    tasks: [{ key: "t1", kind: "paper", title: "Paper", sequence: 1 }],
  }],
  milestones: [],
} as unknown as RoadmapContent;

const conversion: ConversionResult = {
  templateId: "lumiere-roadmap-v1", content: roadmap, exceptions: [],
  summary: { kind: "workbook", fileName: "p.xlsx", sheetsRead: ["Plan"], rowsRead: 1, rowsConverted: 1, rowsSkipped: 0, generator: null },
};

function build() {
  const store = createFakeRoadmapStore([STUDENT_ID]);
  const service = createStudentRoadmapService({
    repo: store.repo, transaction: store.transaction, readTx: store.tx,
    loadDegreeProgress: async () => null, validate: validateRoadmapContent, diff: diffRoadmapContent, now: () => new Date(),
  });
  const convertWorkbook = vi.fn(async () => conversion);
  const convertImportPackage = vi.fn(() => conversion);
  const getStudentByUserId = vi.fn(async (userId: string) => (userId === IDS.student ? { id: STUDENT_ID } : null));
  const app: Express = express();
  app.use(express.json());
  app.use("/api/admin", createAdminStudentRoadmapRouter({ service, convertWorkbook, convertImportPackage }));
  app.use("/api/student", createStudentRoadmapRouter({ getStudentByUserId, service }));
  return { app, store, service, convertWorkbook, convertImportPackage, getStudentByUserId };
}

function as(role: keyof typeof userRows) {
  currentUserRow = [userRows[role]];
  return { Authorization: `Bearer ${makeLocalJWT(userRows[role].id, userRows[role].email)}` };
}

const ADMIN_BASE = `/api/admin/students/${STUDENT_ID}/roadmap`;

async function publishViaApi(ctx: ReturnType<typeof build>) {
  const imported = await request(ctx.app).post(`${ADMIN_BASE}/imports`).set(as("staff")).send({ format: "pkg" });
  expect(imported.status).toBe(201);
  const published = await request(ctx.app).post(`${ADMIN_BASE}/draft/publish`).set(as("admin"))
    .send({ expectedDraftRevision: imported.body.draft.draftRevision, expectedPublishedVersionId: null });
  expect(published.status).toBe(200);
  return published.body;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: null }, error: "mock-no-supabase" });
});

describe("staff roadmap routes: authorization", () => {
  it("rejects unauthenticated requests", async () => {
    const ctx = build();
    currentUserRow = [];
    expect((await request(ctx.app).get(ADMIN_BASE)).status).toBe(401);
  });

  it.each(["student", "coach"] as const)("denies the %s role on every staff route", async (role) => {
    const ctx = build();
    const headers = as(role);
    const calls = [
      request(ctx.app).get(ADMIN_BASE).set(headers),
      request(ctx.app).post(`${ADMIN_BASE}/imports`).set(headers).send({ format: "x" }),
      request(ctx.app).put(`${ADMIN_BASE}/draft`).set(headers).send({}),
      request(ctx.app).post(`${ADMIN_BASE}/draft/acknowledge`).set(headers).send({}),
      request(ctx.app).get(`${ADMIN_BASE}/draft/preview`).set(headers),
      request(ctx.app).post(`${ADMIN_BASE}/draft/publish`).set(headers).send({}),
      request(ctx.app).post(`${ADMIN_BASE}/draft/discard`).set(headers).send({}),
      request(ctx.app).post(`${ADMIN_BASE}/draft/from-published`).set(headers).send({}),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
    expect(ctx.convertImportPackage).not.toHaveBeenCalled();
    expect(ctx.store.state.plans).toHaveLength(0);
  });

  it("lets staff read and import but only admins publish", async () => {
    const ctx = build();
    expect((await request(ctx.app).get(ADMIN_BASE).set(as("staff"))).status).toBe(200);
    const imported = await request(ctx.app).post(`${ADMIN_BASE}/imports`).set(as("staff")).send({ format: "pkg" });
    expect(imported.status).toBe(201);
    const body = { expectedDraftRevision: imported.body.draft.draftRevision, expectedPublishedVersionId: null };
    expect((await request(ctx.app).post(`${ADMIN_BASE}/draft/publish`).set(as("staff")).send(body)).status).toBe(403);
    expect(ctx.store.state.plans[0].publishedVersionId).toBeNull();
    expect((await request(ctx.app).post(`${ADMIN_BASE}/draft/publish`).set(as("admin")).send(body)).status).toBe(200);
  });

  it("rejects a studentId query parameter on staff routes", async () => {
    const ctx = build();
    const res = await request(ctx.app).get(`${ADMIN_BASE}?studentId=other`).set(as("staff"));
    expect(res.status).toBe(400);
  });
});

describe("staff roadmap routes: behavior", () => {
  it("returns 404 for an unknown student with a typed error", async () => {
    const ctx = build();
    const res = await request(ctx.app).get("/api/admin/students/ghost/roadmap").set(as("staff"));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ROADMAP_STUDENT_NOT_FOUND");
  });

  it("answers 201 then 200 for an idempotent package import and 409 for a different one", async () => {
    const ctx = build();
    const first = await request(ctx.app).post(`${ADMIN_BASE}/imports`).set(as("staff")).send({ format: "pkg", a: 1, b: 2 });
    const replay = await request(ctx.app).post(`${ADMIN_BASE}/imports`).set(as("staff")).send({ b: 2, format: "pkg", a: 1 });
    expect([first.status, replay.status]).toEqual([201, 200]);
    expect(replay.body.draft.versionId).toBe(first.body.draft.versionId);
    const other = await request(ctx.app).post(`${ADMIN_BASE}/imports`).set(as("staff")).send({ format: "pkg", a: 9 });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe("ROADMAP_DRAFT_EXISTS");
    const replaced = await request(ctx.app).post(`${ADMIN_BASE}/imports?replaceDraft=true`).set(as("staff")).send({ format: "pkg", a: 9 });
    expect(replaced.status).toBe(201);
  });

  it("accepts an .xlsx upload, hashes the bytes, and rejects other files", async () => {
    const ctx = build();
    const bytes = Buffer.concat([Buffer.from("PK"), Buffer.from([3, 4, 5, 6, 7])]);
    const ok = await request(ctx.app).post(`${ADMIN_BASE}/imports`).set(as("staff"))
      .attach("workbook", bytes, { filename: "plan.xlsx", contentType: "application/octet-stream" });
    expect(ok.status).toBe(201);
    expect(ctx.convertWorkbook).toHaveBeenCalledWith(bytes, { fileName: "plan.xlsx" });
    expect(ok.body.draft.import.fileSha256).toBe(crypto.createHash("sha256").update(bytes).digest("hex"));

    const csv = await request(ctx.app).post(`${ADMIN_BASE}/imports`).set(as("staff"))
      .attach("workbook", Buffer.from("a,b"), { filename: "plan.csv", contentType: "text/csv" });
    expect(csv.status).toBe(400);
    const none = await request(ctx.app).post(`${ADMIN_BASE}/imports`).set(as("staff")).field("x", "y");
    expect(none.status).toBe(400);
  });

  it("rejects workbooks over 5 MB", async () => {
    const ctx = build();
    const big = Buffer.alloc(5 * 1024 * 1024 + 10, 0);
    big[0] = 0x50; big[1] = 0x4b;
    const res = await request(ctx.app).post(`${ADMIN_BASE}/imports`).set(as("staff")).attach("workbook", big, "big.xlsx");
    expect(res.status).toBe(413);
    expect(ctx.convertWorkbook).not.toHaveBeenCalled();
  });

  it("surfaces an unreadable import as 422 with exceptions", async () => {
    const ctx = build();
    ctx.convertImportPackage.mockReturnValueOnce({
      ...conversion, content: null,
      exceptions: [{ key: "PACKAGE_INVALID:x", code: "PACKAGE_INVALID", severity: "blocking", message: "bad", ref: {} }],
    });
    const res = await request(ctx.app).post(`${ADMIN_BASE}/imports`).set(as("staff")).send({ format: "pkg" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ROADMAP_IMPORT_UNREADABLE");
    expect(res.body.error.details.exceptions).toHaveLength(1);
  });

  it("validates edit bodies and returns 409 for a stale publish", async () => {
    const ctx = build();
    const imported = await request(ctx.app).post(`${ADMIN_BASE}/imports`).set(as("staff")).send({ format: "pkg" });
    expect((await request(ctx.app).put(`${ADMIN_BASE}/draft`).set(as("staff")).send({ content: roadmap })).status).toBe(400);
    expect((await request(ctx.app).post(`${ADMIN_BASE}/draft/publish`).set(as("admin")).send({ expectedDraftRevision: 7, expectedPublishedVersionId: null })).status).toBe(409);
    expect((await request(ctx.app).post(`${ADMIN_BASE}/draft/publish`).set(as("admin")).send({ expectedDraftRevision: 0 })).status).toBe(400);
    expect(imported.body.draft.publishable).toBe(true);
  });

  it("preview shows the student's view and never leaks staffNote or the credit link", async () => {
    const ctx = build();
    await request(ctx.app).post(`${ADMIN_BASE}/imports`).set(as("staff")).send({ format: "pkg" });
    const state = await request(ctx.app).get(ADMIN_BASE).set(as("staff"));
    expect(JSON.stringify(state.body)).toContain(STAFF_SECRET); // staff see the plan as written
    const preview = await request(ctx.app).get(`${ADMIN_BASE}/draft/preview`).set(as("staff"));
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ preview: true, contractVersion: "student-roadmap/1" });
    const text = JSON.stringify(preview.body);
    expect(text).not.toContain(STAFF_SECRET);
    expect(text).not.toContain("staffNote");
    expect(text).not.toContain("linkedCreditRecordId");
    expect(text).toContain("Visible note");
  });
});

describe("student roadmap routes", () => {
  it("serves only the published version and never leaks staffNote", async () => {
    const ctx = build();
    await request(ctx.app).post(`${ADMIN_BASE}/imports`).set(as("staff")).send({ format: "pkg" });
    const before = await request(ctx.app).get("/api/student/roadmap").set(as("student"));
    expect(before.status).toBe(200);
    expect(before.body.state).toBe("NOT_PUBLISHED");
    const draftText = JSON.stringify(before.body);
    expect(draftText).not.toContain("English");

    const state = await request(ctx.app).get(ADMIN_BASE).set(as("staff"));
    await request(ctx.app).post(`${ADMIN_BASE}/draft/publish`).set(as("admin"))
      .send({ expectedDraftRevision: state.body.draft.draftRevision, expectedPublishedVersionId: null });
    const after = await request(ctx.app).get("/api/student/roadmap").set(as("student"));
    expect(after.body.state).toBe("PUBLISHED");
    expect(after.body.preview).toBe(false);
    const text = JSON.stringify(after.body);
    expect(text).toContain("English");
    expect(text).not.toContain(STAFF_SECRET);
    expect(text).not.toContain("linkedCreditRecordId");
  });

  it("resolves the student only from the authenticated user", async () => {
    const ctx = build();
    await request(ctx.app).get("/api/student/roadmap").set(as("student"));
    expect(ctx.getStudentByUserId).toHaveBeenCalledWith(IDS.student);
  });

  it("rejects a studentId in the query or body with 400 before any data access", async () => {
    const ctx = build();
    await publishViaApi(ctx);
    ctx.getStudentByUserId.mockClear();
    const q = await request(ctx.app).get("/api/student/roadmap?studentId=other").set(as("student"));
    expect(q.status).toBe(400);
    const b = await request(ctx.app).post("/api/student/roadmap/progress").set(as("student"))
      .send({ studentId: "other", itemKey: "eng101", taskKey: null, status: "in_progress", expectedRevision: 0 });
    expect(b.status).toBe(400);
    expect(ctx.getStudentByUserId).not.toHaveBeenCalled();
    expect(ctx.store.state.progress).toHaveLength(0);
  });

  it.each(["admin", "staff", "coach"] as const)("denies the %s role", async (role) => {
    const ctx = build();
    expect((await request(ctx.app).get("/api/student/roadmap").set(as(role))).status).toBe(403);
    expect((await request(ctx.app).post("/api/student/roadmap/progress").set(as(role)).send({})).status).toBe(403);
  });

  it("reports progress, returns the authoritative view and maps errors", async () => {
    const ctx = build();
    await publishViaApi(ctx);
    const send = (body: object) => request(ctx.app).post("/api/student/roadmap/progress").set(as("student")).send(body);

    const ok = await send({ itemKey: "eng101", taskKey: "t1", status: "in_progress", expectedRevision: 0 });
    expect(ok.status).toBe(200);
    expect(ok.body.phases[0].items[0].tasks[0]).toMatchObject({ status: "in_progress", revision: 1 });

    const conflict = await send({ itemKey: "eng101", taskKey: "t1", status: "submitted", expectedRevision: 0 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toMatchObject({ code: "ROADMAP_PROGRESS_CONFLICT", details: { currentRevision: 1 } });

    expect((await send({ itemKey: "ghost", taskKey: null, status: "in_progress", expectedRevision: 0 })).status).toBe(404);
    const wrongLevel = await send({ itemKey: "eng101", taskKey: null, status: "graded", expectedRevision: 0 });
    expect(wrongLevel.status).toBe(422);
    expect((await send({ itemKey: "eng101", taskKey: "t1", status: "bogus", expectedRevision: 1 })).status).toBe(400);
    expect((await send({ itemKey: "eng101", taskKey: null, status: "in_progress", expectedRevision: 0, extra: 1 })).status).toBe(400);
  });

  it("returns 404 when the account has no student profile", async () => {
    const ctx = build();
    ctx.getStudentByUserId.mockResolvedValueOnce(null);
    const res = await request(ctx.app).get("/api/student/roadmap").set(as("student"));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("STUDENT_PROFILE_NOT_FOUND");
  });

  it("hides internals on unexpected failures", async () => {
    const ctx = build();
    const failing = express();
    failing.use(express.json());
    failing.use("/api/student", createStudentRoadmapRouter({
      getStudentByUserId: async () => ({ id: STUDENT_ID }),
      service: { getStudentView: async () => { throw new Error("db password=hunter2"); }, reportProgress: ctx.service.reportProgress },
    }));
    const res = await request(failing).get("/api/student/roadmap").set(as("student"));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });
});

describe("legacy /api/enrollments is staff-managed for students", () => {
  const enrollmentMocks = vi.hoisted(() => ({
    getUserEnrollments: vi.fn(async () => []),
    createEnrollment: vi.fn(async () => ({ id: "e-new" })),
    updateEnrollment: vi.fn(async () => ({ id: "e-1" })),
    deleteEnrollment: vi.fn(async () => true),
    getEnrollment: vi.fn(async () => ({
      id: "e-1", userId: "u", providerId: "prov", title: "Algebra", credits: 3, status: "todo", courseCode: "MAT1", notes: null,
    })),
  }));
  vi.mock("../server/services/enrollment-service.js", () => enrollmentMocks);

  let app: Express;
  beforeEach(async () => {
    app = express();
    app.use(express.json());
    const { registerRoutes } = await import("../server/routes.js");
    await registerRoutes(app);
  });

  function login(role: keyof typeof userRows) {
    currentUserRow = [{ role: userRows[role].role }];
    mockGetUser.mockResolvedValue({ data: { user: { id: userRows[role].id, email: userRows[role].email } }, error: null });
    return { Authorization: "Bearer supabase-token" };
  }

  it("blocks a student from creating or deleting enrollments", async () => {
    const created = await request(app).post("/api/enrollments").set(login("student"))
      .send({ providerId: "prov", title: "Sneaky", credits: 3 });
    expect(created.status).toBe(403);
    expect(created.body.error.code).toBe("ROADMAP_STAFF_MANAGED");
    const deleted = await request(app).delete("/api/enrollments/e-1").set(login("student"));
    expect(deleted.status).toBe(403);
    expect(deleted.body.error.code).toBe("ROADMAP_STAFF_MANAGED");
    expect(enrollmentMocks.createEnrollment).not.toHaveBeenCalled();
    expect(enrollmentMocks.deleteEnrollment).not.toHaveBeenCalled();
  });

  it("lets a student change activity fields only", async () => {
    const identity = await request(app).put("/api/enrollments/e-1").set(login("student")).send({ title: "Renamed", credits: 6 });
    expect(identity.status).toBe(403);
    expect(identity.body.error).toMatchObject({ code: "ROADMAP_STAFF_MANAGED", fields: ["title", "credits"] });
    expect(enrollmentMocks.updateEnrollment).not.toHaveBeenCalled();

    const resubmitted = await request(app).put("/api/enrollments/e-1").set(login("student"))
      .send({ title: "Algebra", credits: 3, status: "in_progress" });
    expect(resubmitted.status).toBe(200);
    expect(enrollmentMocks.updateEnrollment).toHaveBeenCalledTimes(1);
  });

  it("keeps staff behavior and GET unchanged", async () => {
    const created = await request(app).post("/api/enrollments").set(login("staff"))
      .send({ providerId: "prov", title: "Course", credits: 3 });
    expect(created.status).toBe(201);
    expect((await request(app).delete("/api/enrollments/e-1").set(login("staff"))).status).toBe(204);
    expect((await request(app).get("/api/enrollments").set(login("student"))).status).toBe(200);
  });
});
