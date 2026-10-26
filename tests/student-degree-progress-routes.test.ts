/**
 * S04 — GET /api/student/degree-progress route tests.
 * Real requireAuth + requireRole; only the data dependencies are injected.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import crypto from "crypto";

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
  const signature = crypto.createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: "mock-no-supabase" }) } },
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

const userRows: Record<string, { id: string; email: string; name: string; role: string }> = {
  admin: { id: IDS.admin, email: "admin@test.com", name: "A", role: "admin" },
  staff: { id: IDS.staff, email: "staff@test.com", name: "S", role: "staff" },
  student: { id: IDS.student, email: "student@test.com", name: "St", role: "student" },
  coach: { id: IDS.coach, email: "coach@test.com", name: "C", role: "coach" },
};

const deps = {
  getStudentByUserId: vi.fn(),
  getAcademicRecord: vi.fn(),
  resolveContext: vi.fn(),
  getProgress: vi.fn(),
  getRequirementLabels: vi.fn(),
};

const OWN_STUDENT = "student-own";
const context = { studentId: OWN_STUDENT, programAssignmentId: "assign-1", programVersionId: "pv-1" };
const record = {
  activeProgramAssignment: { cohortLabel: "Fall" },
  programVersion: {
    version: { versionLabel: "2025" }, program: { name: "BA", code: "BA" }, institution: { name: "Uni" },
  },
  academicSources: [],
  creditRecords: [{ id: "c1", sourceId: "s1", recordType: "course", status: "verified", rawTitle: "Eng", rawCredits: "3.00" }],
  latestVerifications: { c1: { action: "verified" } },
  latestDecisions: { c1: { action: "accepted", creditsAwarded: "3.00" } },
};
const composedReport = {
  projectionKind: "INFORMATIONAL_ONLY", status: "COMPOSED",
  contractVersion: "4D.1", schemaVersion: "x", context,
  snapshot: { fingerprint: "sha256:SECRETPRINT", asOf: "2025-01-01T00:00:00.000Z", context, occurrences: [{ value: "SECRET" }] },
  integrationDiagnostics: [{ code: "SECRET_DIAGNOSTIC", ids: ["x"] }],
  phase3Output: {
    compositionKind: "COMPOSED",
    results: [{
      projectionKind: "INFORMATIONAL_ONLY", requirementId: "req-1", academicRuleId: "rule-secret",
      status: "SATISFIED", requiredAmount: "3", appliedAmount: "3", remainingAmount: "0", reason: null,
      provenance: { studentCreditRecordIds: ["c1"], claimVersionIds: ["claim-secret"], sourceIds: ["src-secret"] },
    }],
  },
};

async function makeApp(role: keyof typeof userRows | null): Promise<{ app: Express; token: string | null }> {
  currentUserRow = role ? [userRows[role]] : [];
  const { createStudentDegreeProgressRouter } = await import("../server/routes/student-degree-progress");
  const app = express();
  app.use(express.json());
  app.use("/api/student", createStudentDegreeProgressRouter(deps as never));
  return { app, token: role ? makeLocalJWT(userRows[role].id, userRows[role].email) : null };
}

describe("GET /api/student/degree-progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deps.getStudentByUserId.mockResolvedValue({ id: OWN_STUDENT });
    deps.getAcademicRecord.mockResolvedValue(record);
    deps.resolveContext.mockResolvedValue(context);
    deps.getProgress.mockResolvedValue(composedReport);
    deps.getRequirementLabels.mockResolvedValue({ "req-1": { code: "GEN", title: "General Education", sequence: 1 } });
  });

  it("returns the composed student view for the student role", async () => {
    const { app, token } = await makeApp("student");
    const res = await request(app).get("/api/student/degree-progress").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.contractVersion).toBe("student-degree-progress/1");
    expect(res.body.state).toBe("COMPOSED");
    expect(res.body.totals).toMatchObject({ requiredCredits: "3", appliedCredits: "3", verifiedCreditsOnRecord: "3" });
    expect(res.body.requirements[0]).toMatchObject({ title: "General Education", code: "GEN" });
    expect(res.body.credits[0].standing).toBe("VERIFIED_APPLIED");
    const text = JSON.stringify(res.body);
    for (const secret of ["SECRET", "fingerprint", "rule-secret", "claim-secret", "src-secret", "integrationDiagnostics"]) {
      expect(text).not.toContain(secret);
    }
    expect(deps.getRequirementLabels).toHaveBeenCalledWith("pv-1", ["req-1"]);
  });

  it("resolves the student only from the authenticated user", async () => {
    const { app, token } = await makeApp("student");
    await request(app).get("/api/student/degree-progress").set("Authorization", `Bearer ${token}`);
    expect(deps.getStudentByUserId).toHaveBeenCalledWith(IDS.student);
    expect(deps.getAcademicRecord).toHaveBeenCalledWith(OWN_STUDENT);
    expect(deps.resolveContext).toHaveBeenCalledWith(OWN_STUDENT);
    expect(deps.getProgress).toHaveBeenCalledWith(context);
  });

  it("rejects a studentId query parameter with 400 before any data access", async () => {
    const { app, token } = await makeApp("student");
    const res = await request(app).get("/api/student/degree-progress?studentId=someone-else")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(deps.getStudentByUserId).not.toHaveBeenCalled();
    expect(deps.getProgress).not.toHaveBeenCalled();
  });

  it("ignores studentId in a request body or path (no such route)", async () => {
    const { app, token } = await makeApp("student");
    const res = await request(app).get("/api/student/degree-progress/other-student")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(deps.getProgress).not.toHaveBeenCalled();
  });

  it.each(["admin", "staff", "coach"] as const)("denies the %s role with 403", async (role) => {
    const { app, token } = await makeApp(role);
    const res = await request(app).get("/api/student/degree-progress").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(deps.getStudentByUserId).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const { app } = await makeApp(null);
    const res = await request(app).get("/api/student/degree-progress");
    expect(res.status).toBe(401);
    expect(deps.getStudentByUserId).not.toHaveBeenCalled();
  });

  it("returns NO_ACTIVE_PROGRAM when there is no active assignment", async () => {
    deps.getAcademicRecord.mockResolvedValue({ ...record, activeProgramAssignment: null, programVersion: null });
    const { app, token } = await makeApp("student");
    const res = await request(app).get("/api/student/degree-progress").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("NO_ACTIVE_PROGRAM");
    expect(res.body.totals).toBeNull();
    expect(deps.getProgress).not.toHaveBeenCalled();
  });

  it("returns NO_ACTIVE_PROGRAM when the context resolver finds no assignment", async () => {
    deps.resolveContext.mockResolvedValue(null);
    const { app, token } = await makeApp("student");
    const res = await request(app).get("/api/student/degree-progress").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("NO_ACTIVE_PROGRAM");
  });

  it("returns UNDER_REVIEW without amounts when the canonical report needs manual review", async () => {
    deps.getProgress.mockResolvedValue({
      ...composedReport, status: "MANUAL_REVIEW", phase3Output: null,
      integrationDiagnostics: [{ code: "SECRET_DIAGNOSTIC" }],
    });
    const { app, token } = await makeApp("student");
    const res = await request(app).get("/api/student/degree-progress").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("UNDER_REVIEW");
    expect(res.body.totals).toBeNull();
    expect(res.body.requirements).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain("SECRET");
  });

  it("returns 404 with a code when the user has no student profile", async () => {
    deps.getStudentByUserId.mockResolvedValue(null);
    const { app, token } = await makeApp("student");
    const res = await request(app).get("/api/student/degree-progress").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("STUDENT_PROFILE_NOT_FOUND");
  });

  it("hides internals on failure with a generic 500", async () => {
    deps.getProgress.mockRejectedValue(new Error("db password=hunter2 at /srv/internal"));
    const { app, token } = await makeApp("student");
    const res = await request(app).get("/api/student/degree-progress").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });

  it("fails closed with 500 if the resolved context belongs to another student", async () => {
    deps.resolveContext.mockResolvedValue({ ...context, studentId: "someone-else" });
    const { app, token } = await makeApp("student");
    const res = await request(app).get("/api/student/degree-progress").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(deps.getProgress).not.toHaveBeenCalled();
  });
});
