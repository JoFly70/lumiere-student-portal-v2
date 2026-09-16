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
  getRequirementDisplay: vi.fn(),
  getAcademicRuleDisplay: vi.fn(),
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
    observations: [],
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
    deps.getRequirementDisplay.mockResolvedValue({
      requirement: {
        id: "requirement-1",
        programVersionId: "version-1",
        title: "Canonical Requirement",
      },
      programVersion: { id: "version-1" },
    });
    deps.getAcademicRuleDisplay.mockResolvedValue(null);
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
    expect(deps.getRequirementDisplay).toHaveBeenCalledWith("requirement-1");
    expect(deps.getAcademicRuleDisplay).toHaveBeenCalledWith("rule-1");
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
    deps.getRequirementDisplay.mockResolvedValue({
      requirement: {
        id: "requirement-1",
        programVersionId: "different-version",
        title: "Wrong Requirement",
      },
      programVersion: { id: "different-version", status: "active" },
    });
    deps.getAcademicRuleDisplay.mockResolvedValue({
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
    expect(deps.getRequirementDisplay).toHaveBeenCalledWith("requirement-1");
    expect(deps.getAcademicRuleDisplay).toHaveBeenCalledWith("rule-1");
  });

  it("does not advertise course or source labels without canonical lookups", async () => {
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .get(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${auth}`);

    expect(response.status).toBe(200);
    expect(response.body.displayLabels.courses).toEqual({});
    expect(response.body.displayLabels.sources).toEqual({});
  });

  it("accounts for every missing canonical requirement and rule label", async () => {
    deps.getRequirementDisplay.mockResolvedValueOnce(null);
    deps.getAcademicRuleDisplay.mockResolvedValueOnce(null);
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

  it("uses production repository defaults and preserves canonical ownership fallbacks", async () => {
    const productionReport = {
      ...report,
      phase3Output: {
        ...report.phase3Output,
        recordedCreditProjection: { results: [] },
        results: [
          { ...report.phase3Output.results[0], requirementId: "requirement-canonical", academicRuleId: "rule-canonical" },
          { ...report.phase3Output.results[0], requirementId: "requirement-missing", academicRuleId: "rule-missing" },
          { ...report.phase3Output.results[0], requirementId: "requirement-foreign", academicRuleId: "rule-foreign" },
        ],
      },
    };
    canonicalRepo.getStudent.mockResolvedValue({ id: STUDENT_ID, first_name: "Ada", last_name: "Lovelace" });
    canonicalRepo.getActiveAssignmentForStudent.mockResolvedValue({
      id: "assignment-1",
      studentId: STUDENT_ID,
      programVersionId: "version-1",
      status: "active",
    });
    canonicalRepo.getProgramVersionWithProgram.mockResolvedValue({
      institution: { id: "institution-1" },
      program: { id: "program-1", institutionId: "institution-1", name: "Canonical Program" },
      version: { id: "version-1", programId: "program-1", versionLabel: "2025 Catalog" },
    });
    canonicalRepo.getRequirementWithProgramVersion.mockImplementation(async (id: string) => {
      if (id === "requirement-canonical") return {
        requirement: { id, programVersionId: "version-1", title: "Canonical Requirement" },
        programVersion: { id: "version-1" },
      };
      if (id === "requirement-foreign") return {
        requirement: { id, programVersionId: "foreign-version", title: "Foreign Requirement" },
        programVersion: { id: "foreign-version" },
      };
      return null;
    });
    canonicalRepo.getAcademicRuleWithProgramVersion.mockImplementation(async (id: string) => {
      if (id === "rule-canonical") return {
        rule: { id, programVersionId: "version-1", title: "Canonical Rule" },
        programVersion: { id: "version-1" },
      };
      if (id === "rule-foreign") return {
        rule: { id, programVersionId: "foreign-version", title: "Foreign Rule" },
        programVersion: { id: "foreign-version" },
      };
      return null;
    });
    const app = express();
    app.use(express.json());
    mockDb.rows = [{ id: ADMIN_ID, email: "admin@test.com", name: "Admin", role: "admin" }];
    const { createAdminStudentWorkspaceRouter } = await import("../server/routes/admin-student-workspace");
    app.use("/api/admin", createAdminStudentWorkspaceRouter({
      getProgress: vi.fn().mockResolvedValue(productionReport),
    }));
    const response = await request(app)
      .get(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${token(ADMIN_ID, "admin")}`);

    expect(response.status).toBe(200);
    expect(canonicalRepo.getRequirementWithProgramVersion).toHaveBeenCalledTimes(3);
    expect(canonicalRepo.getAcademicRuleWithProgramVersion).toHaveBeenCalledTimes(3);
    expect(response.body.displayLabels.requirements).toEqual({
      "requirement-canonical": { label: "Canonical Requirement", source: "canonical" },
      "requirement-missing": { label: "requirement-missing", source: "id-fallback" },
      "requirement-foreign": { label: "requirement-foreign", source: "id-fallback" },
    });
    expect(response.body.displayLabels.academicRules).toEqual({
      "rule-canonical": { label: "Canonical Rule", source: "canonical" },
      "rule-missing": { label: "rule-missing", source: "id-fallback" },
      "rule-foreign": { label: "rule-foreign", source: "id-fallback" },
    });
    expect(response.body.displayLabels.missingIds).toEqual(expect.arrayContaining([
      "requirement-missing",
      "requirement-foreign",
      "rule-missing",
      "rule-foreign",
    ]));
  });

  it("does not expose a write handler", async () => {
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .post(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${auth}`);
    expect(response.status).toBe(404);
    expect(deps.getProgress).not.toHaveBeenCalled();
  });

  it("exposes report-level manual review without inventing an attention group", async () => {
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
    expect(response.body.needsAttention.reportStatus).toBe("MANUAL_REVIEW");
    expect(response.body.needsAttention.groups).toEqual({
      manualReview: [],
      missing: [],
      partial: [],
      conflict: [],
    });
    expect(response.body.needsAttention.reasons).toEqual(["SNAPSHOT_READER_FAILED"]);
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
        results: [canonicalResult],
        observations: [],
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
    expect(response.body.needsAttention.diagnostics).toEqual([diagnostic, diagnostic]);
  });

  it("does not rescan nested recorded projections when aggregate items repeat", async () => {
    const aggregateResult = {
      projectionKind: "INFORMATIONAL_ONLY",
      requirementId: "requirement-1",
      academicRuleId: "rule-1",
      status: "PARTIAL",
      reason: "CANONICAL_PARTIAL",
      provenance: {},
    };
    const attentionReport = {
      ...report,
      phase3Output: {
        ...report.phase3Output,
        results: [aggregateResult],
        observations: [aggregateResult],
        recordedExceptionProjection: {
          results: [aggregateResult],
          observations: [aggregateResult],
        },
      },
      integrationDiagnostics: [],
    };
    deps.getProgress.mockResolvedValue(attentionReport);
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .get(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${auth}`);

    expect(response.status).toBe(200);
    expect(response.body.needsAttention.groups.partial).toEqual([aggregateResult]);
  });

  it("returns a sanitized 500 for a progress context mismatch without resolving labels", async () => {
    const reportSerialization = vi.fn(() => {
      throw new Error("report must not be serialized");
    });
    deps.getProgress.mockResolvedValueOnce({
      ...report,
      context: {
        ...report.context,
        programVersionId: "foreign-version",
      },
      toJSON: reportSerialization,
    });
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .get(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${auth}`);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Internal server error" });
    expect(deps.getProgress).toHaveBeenCalledTimes(1);
    expect(deps.getRequirementDisplay).not.toHaveBeenCalled();
    expect(deps.getAcademicRuleDisplay).not.toHaveBeenCalled();
    expect(reportSerialization).not.toHaveBeenCalled();
  });

  it("keeps manual-review aggregate diagnostics in the diagnostic sidecar only", async () => {
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
    expect(response.body.needsAttention.reportStatus).toBe("MANUAL_REVIEW");
    expect(response.body.needsAttention.groups.manualReview).toEqual([]);
    expect(response.body.needsAttention.diagnostics).toEqual([diagnostic]);
  });

  it("does not synthesize attention for manual review with empty phase3 aggregates", async () => {
    const manualReport = {
      ...report,
      status: "MANUAL_REVIEW",
      phase3Output: {
        ...report.phase3Output,
        results: [],
        observations: [],
        diagnostics: [],
      },
      integrationDiagnostics: [],
    };
    deps.getProgress.mockResolvedValue(manualReport);
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .get(`/api/admin/students/${STUDENT_ID}/workspace`)
      .set("Authorization", `Bearer ${auth}`);

    expect(response.status).toBe(200);
    expect(response.body.needsAttention).toEqual({
      hasAttention: false,
      reportStatus: "MANUAL_REVIEW",
      groups: {
        manualReview: [],
        missing: [],
        partial: [],
        conflict: [],
      },
      reasons: [],
      diagnostics: [],
      integrationDiagnostics: [],
    });
    expect(response.body.report).toEqual(manualReport);
  });
});