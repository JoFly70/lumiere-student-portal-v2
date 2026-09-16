/**
 * Phase 5A.1 — admin student workspace presentation boundary.
 *
 * The route uses the real authentication and role middleware.  Canonical
 * repository reads and the degree-progress service are injected so this test
 * cannot accidentally make a database call or compose progress twice.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import crypto from "crypto";

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const STAFF_ID = "00000000-0000-0000-0000-000000000002";
const COACH_ID = "00000000-0000-0000-0000-000000000003";
const STUDENT_ID = "student-text-pk-001";
const JWT_SECRET = process.env.SESSION_SECRET || "local-dev-secret-change-in-production";

function token(userId: string, role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    userId,
    email: `${role}@test.com`,
    iss: "lumiere-local",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    sub: userId,
    aud: "authenticated",
    role: "authenticated",
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

const mockDb = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; email: string; name: string; role: string }>,
}));

const canonicalRepo = vi.hoisted(() => ({
  getActiveAssignmentForStudent: vi.fn(),
  getAcademicRuleWithProgramVersion: vi.fn(),
  getRequirementWithProgramVersion: vi.fn(),
  getStudent: vi.fn(),
  getProgramVersionWithProgram: vi.fn(),
}));

vi.mock("../server/repositories/student-academic-repo", () => canonicalRepo);

vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: "test" }),
    },
  },
}));

vi.mock("../server/lib/audit", () => ({
  auditAdmin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../server/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => mockDb.rows),
        })),
      })),
    })),
  },
}));

const deps = vi.hoisted(() => ({
  getStudent: vi.fn(),
  getActiveAssignment: vi.fn(),
  getProgramContext: vi.fn(),
  getProgress: vi.fn(),
  resolveDisplayLabels: vi.fn(),
}));

const report = {
  projectionKind: "INFORMATIONAL_ONLY",
  status: "COMPOSED",
  context: {
    studentId: STUDENT_ID,
    programAssignmentId: "assignment-1",
    programVersionId: "version-1",
  },
  snapshot: {
    asOf: "2025-01-01T00:00:00.000Z",
    fingerprint: "sha256:test",
  },
  integrationDiagnostics: [{ stage: "INTEGRATION", reason: "DIAGNOSTIC", code: "DIAGNOSTIC" }],
  phase3Output: {
    status: "COMPOSED",
    diagnostics: [],
    recordedCreditProjection: {
      results: [{
        projectionKind: "INFORMATIONAL_ONLY",
        requirementId: "requirement-1",
        academicRuleId: "rule-1",
        status: "CONFLICT",
        requiredAmount: "3",
        appliedAmount: "0",
        remainingAmount: "3",
        reason: "CANONICAL_CONFLICT",
        provenance: {},
      }],
    },
  },
};

const labels = {
  programs: { "program-1": { label: "Canonical Program", source: "canonical" as const } },
  programVersions: { "version-1": { label: "2025 Catalog", source: "canonical" as const } },
  requirements: { "requirement-1": { label: "Canonical Requirement", source: "canonical" as const } },
  academicRules: {},
  courses: {},
  sources: {},
  missingIds: ["rule-1"],
};

async function appFor(role: "admin" | "staff" | "coach" | null): Promise<{
  app: Express;
  auth: string | null;
}> {
  const app = express();
  app.use(express.json());
  const row = role === "admin"
    ? { id: ADMIN_ID, email: "admin@test.com", name: "Admin", role }
    : role === "staff"
      ? { id: STAFF_ID, email: "staff@test.com", name: "Staff", role }
      : { id: COACH_ID, email: "coach@test.com", name: "Coach", role: "coach" };
  mockDb.rows = role ? [row] : [];
  const { createAdminStudentWorkspaceRouter } = await import("../server/routes/admin-student-workspace");
  app.use("/api/admin", createAdminStudentWorkspaceRouter(deps));
  return { app, auth: role ? token(row.id, role) : null };
}

describe("Phase 5A.1 — admin student workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deps.getStudent.mockResolvedValue({ id: STUDENT_ID, first_name: "Ada", last_name: "Lovelace" });
    deps.getActiveAssignment.mockResolvedValue({
      id: "assignment-1",
      studentId: STUDENT_ID,
      programVersionId: "version-1",
      status: "active",
    });
    deps.getProgramContext.mockResolvedValue({
      institution: { id: "institution-1" },
      program: { id: "program-1", institutionId: "institution-1", name: "Canonical Program" },
      version: { id: "version-1", programId: "program-1", versionLabel: "2025 Catalog" },
    });
    deps.getProgress.mockResolvedValue(report);
    deps.resolveDisplayLabels.mockResolvedValue(labels);
  });

  it("returns one operator workspace and invokes progress exactly once", async () => {
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .get(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${auth}`);

    expect(response.status).toBe(200);
    expect(deps.getProgress).toHaveBeenCalledTimes(1);
    expect(deps.getProgress).toHaveBeenCalledWith({
      studentId: STUDENT_ID,
      programAssignmentId: "assignment-1",
      programVersionId: "version-1",
    });
    expect(response.body.report).toEqual(report);
    expect(response.body.displayLabels.requirements["requirement-1"]).toEqual({
      label: "Canonical Requirement",
      source: "canonical",
    });
    expect(response.body.displayLabels.academicRules["rule-1"]).toEqual({
      label: "rule-1",
      source: "id-fallback",
    });
    expect(response.body.displayLabels.missingIds).toContain("rule-1");
    expect(response.body.needsAttention.groups.conflict).toHaveLength(1);
    expect(response.body.snapshot).toEqual({
      asOf: report.snapshot.asOf,
      fingerprint: report.snapshot.fingerprint,
      integrationDiagnostics: report.integrationDiagnostics,
    });
  });

  it("authenticates before dependencies and permits only administrators", async () => {
    for (const role of [null, "staff", "coach"] as const) {
      const { app, auth } = await appFor(role);
      const response = await request(app)
        .get(`/api/admin/students/${STUDENT_ID}/workspace`)
        .set(auth ? "Authorization" : "X-Test", auth ? `Bearer ${auth}` : "none");
      expect(response.status).toBe(role === null ? 401 : 403);
      expect(deps.getStudent).not.toHaveBeenCalled();
      expect(deps.getProgress).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid, missing student, assignment, and program context without progress", async () => {
    const { app, auth } = await appFor("admin");
    const invalid = await request(app)
      .get("/api/admin/students/%20%20/workspace")
      .set("Authorization", `Bearer ${auth}`);
    expect(invalid.status).toBe(400);
    expect(deps.getStudent).not.toHaveBeenCalled();

    deps.getStudent.mockResolvedValueOnce(null);
    const missingStudent = await request(app)
      .get(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${auth}`);
    expect(missingStudent.status).toBe(404);

    deps.getStudent.mockResolvedValue({ id: STUDENT_ID });
    deps.getActiveAssignment.mockResolvedValueOnce(null);
    const missingAssignment = await request(app)
      .get(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${auth}`);
    expect(missingAssignment.status).toBe(404);

    deps.getProgramContext.mockResolvedValueOnce(null);
    const missingProgram = await request(app)
      .get(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${auth}`);
    expect(missingProgram.status).toBe(404);
    expect(deps.getProgress).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "missing institution",
      mutate: () => deps.getProgramContext.mockResolvedValueOnce({
        program: { id: "program-1", institutionId: "institution-1" },
        version: { id: "version-1", programId: "program-1" },
      }),
      code: "ADMIN_STUDENT_PROGRAM_CONTEXT_NOT_FOUND",
    },
    {
      name: "institution missing id",
      mutate: () => deps.getProgramContext.mockResolvedValueOnce({
        institution: {},
        program: { id: "program-1", institutionId: "institution-1" },
        version: { id: "version-1", programId: "program-1" },
      }),
      code: "ADMIN_STUDENT_PROGRAM_CONTEXT_NOT_FOUND",
    },
    {
      name: "student identity mismatch",
      mutate: () => deps.getStudent.mockResolvedValueOnce({ id: "different-student" }),
      code: "ADMIN_STUDENT_NOT_FOUND",
    },
    {
      name: "assignment student mismatch",
      mutate: () => deps.getActiveAssignment.mockResolvedValueOnce({
        id: "assignment-1",
        studentId: "different-student",
        programVersionId: "version-1",
        status: "active",
      }),
      code: "ADMIN_STUDENT_ACTIVE_ASSIGNMENT_NOT_FOUND",
    },
    {
      name: "non-active assignment",
      mutate: () => deps.getActiveAssignment.mockResolvedValueOnce({
        id: "assignment-1",
        studentId: STUDENT_ID,
        programVersionId: "version-1",
        status: "available",
      }),
      code: "ADMIN_STUDENT_ACTIVE_ASSIGNMENT_NOT_FOUND",
    },
    {
      name: "program version mismatch",
      mutate: () => deps.getProgramContext.mockResolvedValueOnce({
        program: { id: "program-1" },
        version: { id: "different-version", programId: "program-1" },
      }),
      code: "ADMIN_STUDENT_PROGRAM_CONTEXT_NOT_FOUND",
    },
    {
      name: "program mismatch",
      mutate: () => deps.getProgramContext.mockResolvedValueOnce({
        program: { id: "different-program" },
        version: { id: "version-1", programId: "program-1" },
      }),
      code: "ADMIN_STUDENT_PROGRAM_CONTEXT_NOT_FOUND",
    },
    {
      name: "institution association mismatch",
      mutate: () => deps.getProgramContext.mockResolvedValueOnce({
        institution: { id: "institution-2" },
        program: { id: "program-1", institutionId: "institution-1" },
        version: { id: "version-1", programId: "program-1" },
      }),
      code: "ADMIN_STUDENT_PROGRAM_CONTEXT_NOT_FOUND",
    },
  ])("rejects $name before progress composition", async ({ mutate, code }) => {
    mutate();
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .get(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${auth}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe(code);
    expect(deps.getProgress).not.toHaveBeenCalled();
  });

  it("uses only canonical rows from the active program version for labels", async () => {
    // The default resolver must refuse rows whose canonical ownership points
    // at another version, rather than displaying misleading titles.
    deps.resolveDisplayLabels.mockReset();
    canonicalRepo.getRequirementWithProgramVersion.mockResolvedValue({
      requirement: {
        id: "requirement-1",
        programVersionId: "different-version",
        title: "Wrong Requirement",
      },
      programVersion: { id: "different-version", status: "active" },
    });
    canonicalRepo.getAcademicRuleWithProgramVersion.mockResolvedValue({
      rule: {
        id: "rule-1",
        programVersionId: "different-version",
        ruleKey: "wrong-rule",
        title: "Wrong Rule",
      },
      programVersion: { id: "different-version", status: "active" },
    });
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .get(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${auth}`);

    expect(response.status).toBe(200);
    expect(response.body.displayLabels.requirements["requirement-1"]).toEqual({
      label: "requirement-1",
      source: "id-fallback",
    });
    expect(response.body.displayLabels.academicRules["rule-1"]).toEqual({
      label: "rule-1",
      source: "id-fallback",
    });
    expect(response.body.displayLabels.missingIds).toEqual(
      expect.arrayContaining(["requirement-1", "rule-1"]),
    );
  });

  it("does not advertise course or source labels without canonical lookups", async () => {
    deps.resolveDisplayLabels.mockResolvedValueOnce({
      programs: {},
      programVersions: {},
      requirements: {},
      academicRules: {},
      courses: { "course-1": { label: "Inferred course", source: "canonical" } },
      sources: { "source-1": { label: "Inferred source", source: "canonical" } },
      missingIds: [],
    });
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .get(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${auth}`);

    expect(response.status).toBe(200);
    expect(response.body.displayLabels.courses).toEqual({});
    expect(response.body.displayLabels.sources).toEqual({});
  });

  it("accounts for every missing canonical requirement and rule label", async () => {
    deps.resolveDisplayLabels.mockReset();
    canonicalRepo.getRequirementWithProgramVersion.mockResolvedValueOnce(null);
    canonicalRepo.getAcademicRuleWithProgramVersion.mockResolvedValueOnce(null);
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .get(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${auth}`);

    expect(response.status).toBe(200);
    expect(response.body.displayLabels.requirements["requirement-1"]).toEqual({
      label: "requirement-1",
      source: "id-fallback",
    });
    expect(response.body.displayLabels.academicRules["rule-1"]).toEqual({
      label: "rule-1",
      source: "id-fallback",
    });
    expect(response.body.displayLabels.missingIds).toEqual(
      expect.arrayContaining(["requirement-1", "rule-1"]),
    );
  });

  it("does not expose a write handler", async () => {
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .post(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${auth}`);
    expect(response.status).toBe(404);
    expect(deps.getProgress).not.toHaveBeenCalled();
  });

  it("groups report-level manual review without changing the report", async () => {
    const manualReport = {
      ...report,
      status: "MANUAL_REVIEW",
      phase3Output: null,
      integrationDiagnostics: [{
        stage: "INTEGRATION",
        reason: "SNAPSHOT_READER_FAILED",
        code: "SNAPSHOT_READER_FAILED",
      }],
    };
    deps.getProgress.mockResolvedValue(manualReport);
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .get(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${auth}`);

    expect(response.status).toBe(200);
    expect(response.body.report).toEqual(manualReport);
    expect(response.body.needsAttention.groups.manualReview).toEqual([
      { status: "MANUAL_REVIEW" },
    ]);
    expect(response.body.needsAttention.reasons).toContain("SNAPSHOT_READER_FAILED");
  });

  it("uses only canonical result and diagnostic locations for attention", async () => {
    const nestedNoise = {
      status: "MISSING",
      reason: "INVENTED_NESTED_REASON",
      metadata: { status: "CONFLICT", reason: "INVENTED_METADATA_REASON" },
      provenance: { status: "PARTIAL", reason: "INVENTED_PROVENANCE_REASON" },
    };
    const diagnostic = {
      stage: "COMPOSITION",
      projectionKind: "INFORMATIONAL_ONLY",
      status: "MANUAL_REVIEW",
      reason: "CANONICAL_DIAGNOSTIC",
      provenance: { status: "MISSING", reason: "NOT_A_DIAGNOSTIC" },
    };
    const canonicalResult = {
      projectionKind: "INFORMATIONAL_ONLY",
      requirementId: "requirement-1",
      academicRuleId: "rule-1",
      status: "PARTIAL",
      reason: "CANONICAL_PARTIAL",
      provenance: nestedNoise,
    };
    const attentionReport = {
      ...report,
      phase3Output: {
        ...report.phase3Output,
        diagnostics: [diagnostic, { ...diagnostic }],
        recordedCreditProjection: {
          ...report.phase3Output.recordedCreditProjection,
          results: [canonicalResult],
        },
        arbitraryNested: nestedNoise,
      },
      integrationDiagnostics: [],
    };
    deps.getProgress.mockResolvedValue(attentionReport);
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .get(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${auth}`);

    expect(response.status).toBe(200);
    expect(response.body.needsAttention.groups).toEqual({
      manualReview: [],
      missing: [],
      partial: [canonicalResult],
      conflict: [],
    });
    expect(response.body.needsAttention.reasons).toEqual([
      "CANONICAL_DIAGNOSTIC",
      "CANONICAL_PARTIAL",
    ]);
    expect(response.body.needsAttention.diagnostics).toEqual([diagnostic]);
  });

  it("keeps manual-review diagnostics in the diagnostic sidecar only", async () => {
    const diagnostic = {
      stage: "COMPOSITION",
      projectionKind: "INFORMATIONAL_ONLY",
      status: "MANUAL_REVIEW",
      reason: "CANONICAL_DIAGNOSTIC",
      provenance: {},
    };
    const attentionReport = {
      ...report,
      status: "MANUAL_REVIEW",
      phase3Output: {
        ...report.phase3Output,
        diagnostics: [diagnostic],
      },
      integrationDiagnostics: [],
    };
    deps.getProgress.mockResolvedValue(attentionReport);
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .get(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${auth}`);

    expect(response.status).toBe(200);
    expect(response.body.needsAttention.groups.manualReview).toEqual([
      { status: "MANUAL_REVIEW" },
    ]);
    expect(response.body.needsAttention.diagnostics).toEqual([diagnostic]);
  });
});