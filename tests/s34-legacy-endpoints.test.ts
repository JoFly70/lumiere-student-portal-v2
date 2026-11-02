import { describe, it, expect, vi, beforeEach } from "vitest";

// S34 (S33-06): legacy student-callable endpoints. Handler-level via supertest with mocked storage/auth.
const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockGenerateRoadmap = vi.fn();
const mockAssign = vi.fn();
const roleState = vi.hoisted(() => ({ role: "student" as string }));

vi.mock("../server/lib/account-status.js", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/invitations.js", () => ({
  normalizeInvitationEmail: (e: string) => e,
  claimInvitation: vi.fn(), releaseInvitation: vi.fn(), consumeInvitation: vi.fn(),
}));
vi.mock("../server/lib/supabase.js", () => ({
  supabaseAdmin: { auth: { getUser: mockGetUser, admin: {} }, from: mockFrom },
  isSupabaseConfigured: true,
  createUserAuthClient: () => ({ auth: {} }),
}));
// getUserRole reads users.role through drizzle
vi.mock("../server/lib/db.js", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ role: roleState.role }] }) }) }) },
}));
vi.mock("../server/lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../server/roadmap-generator.js", () => ({ generateRoadmap: mockGenerateRoadmap, getFlightDeckData: vi.fn(async () => ({})) }));
vi.mock("../server/services/assignment-service.js", () => ({ assignCoursesToStudent: mockAssign }));
vi.mock("../server/routes/two-factor.js", () => ({ default: vi.fn((r: unknown) => r) }));
vi.mock("../server/routes/students.js", () => ({ default: vi.fn() }));
vi.mock("../server/routes/documents.js", () => ({ default: vi.fn() }));
vi.mock("../server/routes/tickets.js", () => ({ default: vi.fn() }));
vi.mock("../server/routes/admin.js", () => ({ default: vi.fn() }));
vi.mock("../server/routes/programs.js", () => ({ default: vi.fn() }));
vi.mock("../server/services/flight-deck-service.js", () => ({ getFlightDeckData: vi.fn(async () => ({})) }));
vi.mock("../server/services/template-service.js", () => ({ getAllTemplates: vi.fn(async () => []), getTemplateById: vi.fn(async () => null) }));
vi.mock("../server/services/enrollment-service.js", () => ({ getUserEnrollments: vi.fn(async () => []), createEnrollment: vi.fn(), updateEnrollment: vi.fn(), deleteEnrollment: vi.fn() }));

import express from "express";
import request from "supertest";

let app: express.Application;
const INTERNAL = "relation \"secret_table\" does not exist at pg:5432";

function auth(role: string | null) {
  roleState.role = role ?? "student";
  if (!role) {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: "bad" } });
    return;
  }
  mockGetUser.mockResolvedValue({ data: { user: { id: "u1", email: "u@test.com", email_confirmed_at: "2026-01-01" } }, error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === "users") {
      const row = { data: { id: "u1", role }, error: null };
      return { select: () => ({ eq: () => ({ maybeSingle: async () => row, single: async () => row }) }) };
    }
    if (table === "degree_templates") return { select: () => ({ limit: async () => ({ data: [{ id: "t" }], error: null }) }) };
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.NODE_ENV = "test";
  app = express();
  app.use(express.json());
  const { registerRoutes } = await import("../server/routes.js");
  await registerRoutes(app);
});

const post = (path: string, body: object) => request(app).post(path).set("Authorization", "Bearer t").send(body);

describe("S33-06 POST /api/assignments", () => {
  const body = { courses: [{ courseId: "c1" }] };
  it("refuses students with 403 and writes nothing", async () => {
    auth("student");
    const res = await post("/api/assignments", body);
    expect(res.status).toBe(403);
    expect(mockAssign).not.toHaveBeenCalled();
  });
  it("401 when unauthenticated", async () => {
    auth(null);
    expect((await request(app).post("/api/assignments").send(body)).status).toBe(401);
    expect(mockAssign).not.toHaveBeenCalled();
  });
  it.each(["staff", "admin"])("still allows %s", async (role) => {
    auth(role);
    mockAssign.mockResolvedValue([{ id: "e1" }]);
    const res = await post("/api/assignments", body);
    expect(res.status).toBe(201);
    expect(mockAssign).toHaveBeenCalledTimes(1);
  });
  it("500 body carries no internal error text", async () => {
    auth("staff");
    mockAssign.mockRejectedValue(new Error(INTERNAL));
    const res = await post("/api/assignments", body);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret_table");
  });
});

describe("S33-06 POST /api/generate-plan", () => {
  const body = { template_id: "tmpl-1" };
  it("refuses students with 403 and generates nothing", async () => {
    auth("student");
    expect((await post("/api/generate-plan", body)).status).toBe(403);
    expect(mockGenerateRoadmap).not.toHaveBeenCalled();
  });
  it("401 when unauthenticated", async () => {
    auth(null);
    expect((await request(app).post("/api/generate-plan").send(body)).status).toBe(401);
  });
  it.each(["staff", "admin"])("still allows %s", async (role) => {
    auth(role);
    mockGenerateRoadmap.mockResolvedValue({ planId: "p1", summary: {}, steps: [], financials: {} });
    expect((await post("/api/generate-plan", body)).status).toBe(200);
  });
  it("500 body carries no details or internal text", async () => {
    auth("staff");
    mockGenerateRoadmap.mockRejectedValue(new Error(INTERNAL));
    const res = await post("/api/generate-plan", body);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to generate plan" });
  });
});

describe("S33-06 GET /api/system/check", () => {
  it("unauthenticated callers get 401 and no internals", async () => {
    auth(null);
    const res = await request(app).get("/api/system/check");
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toMatch(/schema|migrations|supabase/i);
  });
  it("students and staff get 403", async () => {
    for (const role of ["student", "staff"]) {
      auth(role);
      const res = await request(app).get("/api/system/check").set("Authorization", "Bearer t");
      expect(res.status).toBe(403);
    }
  });
  it("admin still gets the status", async () => {
    auth("admin");
    const res = await request(app).get("/api/system/check").set("Authorization", "Bearer t");
    expect(res.status).toBe(200);
    expect(res.body.schema_ready).toBe(true);
  });
});
