/**
 * Phase 5C.1 — controlled placement workflow server boundary.
 *
 * Uses real authentication and admin RBAC. Degree Progress, placement service,
 * and audit boundaries are injected so no request test can mutate persistence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import crypto from "crypto";
import { invalidStateError } from "../server/lib/student-academic-errors";

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const STAFF_ID = "00000000-0000-0000-0000-000000000002";
const COACH_ID = "00000000-0000-0000-0000-000000000003";
const STUDENT_USER_ID = "00000000-0000-0000-0000-000000000004";
const STUDENT_ID = "student-text-pk-001";
const ASSIGNMENT_ID = "10000000-0000-0000-0000-000000000001";
const PROGRAM_VERSION_ID = "20000000-0000-0000-0000-000000000001";
const DECISION_ID = "30000000-0000-0000-0000-000000000001";
const REQUIREMENT_ID = "40000000-0000-0000-0000-000000000001";
const RULE_ID = "50000000-0000-0000-0000-000000000001";
const PLACEMENT_ID = "60000000-0000-0000-0000-000000000001";
const NEW_PLACEMENT_ID = "60000000-0000-0000-0000-000000000002";
const FINGERPRINT = `sha256:${"a".repeat(64)}`;
const STALE_FINGERPRINT = `sha256:${"b".repeat(64)}`;
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

vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: "test" }),
    },
  },
  isSupabaseConfigured: false,
}));

vi.mock("../server/lib/audit", () => ({
  auditAdmin: vi.fn().mockResolvedValue(undefined),
  createAuditLog: vi.fn().mockResolvedValue(undefined),
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
    transaction: vi.fn(),
  },
}));

const deps = {
  resolveContext: vi.fn(),
  getProgress: vi.fn(),
  placementService: {
    assertPlacementContext: vi.fn(),
    createPlacement: vi.fn(),
    supersedePlacement: vi.fn(),
    revokePlacement: vi.fn(),
  },
  audit: vi.fn(),
  readSnapshotInTransaction: vi.fn(),
};

const context = {
  studentId: STUDENT_ID,
  programAssignmentId: ASSIGNMENT_ID,
  programVersionId: PROGRAM_VERSION_ID,
};

const placement = {
  id: PLACEMENT_ID,
  studentCreditDecisionId: DECISION_ID,
  programAssignmentId: ASSIGNMENT_ID,
  requirementId: REQUIREMENT_ID,
  academicRuleId: RULE_ID,
  status: "active" as const,
  supersedesPlacementId: null,
  supersededByPlacementId: null,
  actor: ADMIN_ID,
  rationale: "Operator selected canonical requirement",
  metadata: {},
  provenance: {},
  revokedBy: null,
  revokedAt: null,
  revocationRationale: null,
  supersededBy: null,
  supersededAt: null,
  supersedeRationale: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const newPlacement = {
  ...placement,
  id: NEW_PLACEMENT_ID,
  supersedesPlacementId: PLACEMENT_ID,
};

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    expectedSnapshotFingerprint: FINGERPRINT,
    studentCreditDecisionId: DECISION_ID,
    requirementId: REQUIREMENT_ID,
    academicRuleId: RULE_ID,
    rationale: "Operator selected canonical requirement",
    ...overrides,
  };
}

function authRow(role: "admin" | "staff" | "coach" | "student") {
  const id = role === "admin"
    ? ADMIN_ID
    : role === "staff"
      ? STAFF_ID
      : role === "coach"
        ? COACH_ID
        : STUDENT_USER_ID;
  return { id, email: `${role}@test.com`, name: role, role };
}

async function appFor(role: "admin" | "staff" | "coach" | "student" | null): Promise<{
  app: Express;
  auth: string | null;
}> {
  const app = express();
  app.use(express.json());
  const row = role ? authRow(role) : null;
  mockDb.rows = row ? [row] : [];
  const { createAdminStudentCreditPlacementRouter } = await import(
    "../server/routes/admin-student-credit-placement"
  );
  app.use("/api/admin", createAdminStudentCreditPlacementRouter(deps));
  return {
    app,
    auth: row ? token(row.id, role!) : null,
  };
}

describe("Phase 5C.1 — admin controlled placement workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deps.resolveContext.mockResolvedValue(context);
    deps.getProgress.mockResolvedValue({
      snapshot: { fingerprint: FINGERPRINT },
    });
    deps.placementService.assertPlacementContext.mockResolvedValue(placement);
    deps.placementService.createPlacement.mockResolvedValue(placement);
    deps.placementService.supersedePlacement.mockResolvedValue({
      oldPlacement: { ...placement, status: "superseded" },
      newPlacement,
    });
    deps.placementService.revokePlacement.mockResolvedValue({
      ...placement,
      status: "revoked",
      revokedBy: ADMIN_ID,
    });
    deps.audit.mockResolvedValue(undefined);
    deps.readSnapshotInTransaction.mockResolvedValue({
      status: "ACCEPTED",
      academicSnapshot: {
        status: "ACCEPTED",
        snapshotFingerprint: FINGERPRINT,
      },
    });
  });

  it("creates through the placement service with one progress call, active assignment, and server actor", async () => {
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .post(`/api/admin/students/${STUDENT_ID}/placements`)
      .set("Authorization", `Bearer ${auth}`)
      .send(createBody());

    expect(response.status).toBe(201);
    expect(deps.resolveContext).toHaveBeenCalledOnce();
    expect(deps.resolveContext).toHaveBeenCalledWith(STUDENT_ID);
    expect(deps.getProgress).toHaveBeenCalledOnce();
    expect(deps.getProgress).toHaveBeenCalledWith(context);
    expect(deps.placementService.createPlacement).toHaveBeenCalledOnce();
    expect(deps.placementService.createPlacement).toHaveBeenCalledWith({
      studentCreditDecisionId: DECISION_ID,
      programAssignmentId: ASSIGNMENT_ID,
      requirementId: REQUIREMENT_ID,
      academicRuleId: RULE_ID,
      actor: ADMIN_ID,
      rationale: "Operator selected canonical requirement",
      metadata: {
        workflow: "admin_controlled_placement",
        operation: "create",
        studentId: STUDENT_ID,
        snapshotFingerprint: FINGERPRINT,
      },
      provenance: {
        source: "admin_controlled_placement_workflow",
        snapshotFingerprint: FINGERPRINT,
        context,
      },
    }, {
      beforeWrite: expect.any(Function),
    });
  });

  it("rejects a stale snapshot with 409 before placement or audit", async () => {
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .post(`/api/admin/students/${STUDENT_ID}/placements`)
      .set("Authorization", `Bearer ${auth}`)
      .send(createBody({ expectedSnapshotFingerprint: STALE_FINGERPRINT }));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PLACEMENT_WORKFLOW_STALE_SNAPSHOT");
    expect(deps.getProgress).toHaveBeenCalledOnce();
    expect(deps.placementService.createPlacement).not.toHaveBeenCalled();
    expect(deps.audit).not.toHaveBeenCalled();
  });

  it.each(["create", "supersede", "revoke"] as const)(
    "returns the exact stale-snapshot contract when the %s transaction guard detects a mismatch",
    async (operation) => {
      const mutation = operation === "create"
        ? deps.placementService.createPlacement
        : operation === "supersede"
          ? deps.placementService.supersedePlacement
          : deps.placementService.revokePlacement;
      mutation.mockImplementationOnce(async (_input: unknown, options: any) => {
        await options.beforeWrite({ transaction: operation });
        throw new Error("guard should have rejected");
      });
      deps.readSnapshotInTransaction.mockResolvedValueOnce({
        status: "ACCEPTED",
        academicSnapshot: {
          status: "ACCEPTED",
          snapshotFingerprint: STALE_FINGERPRINT,
        },
      });
      const { app, auth } = await appFor("admin");
      const path = operation === "create"
        ? `/api/admin/students/${STUDENT_ID}/placements`
        : `/api/admin/students/${STUDENT_ID}/placements/${PLACEMENT_ID}/${operation}`;
      const body = operation === "create"
        ? createBody()
        : operation === "supersede"
          ? {
              expectedSnapshotFingerprint: FINGERPRINT,
              requirementId: REQUIREMENT_ID,
              rationale: "Move placement",
            }
          : {
              expectedSnapshotFingerprint: FINGERPRINT,
              rationale: "Revoke placement",
            };

      const response = await request(app)
        .post(path)
        .set("Authorization", `Bearer ${auth}`)
        .send(body);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: {
          code: "PLACEMENT_WORKFLOW_STALE_SNAPSHOT",
          message: "Degree progress changed; refresh before updating placements",
        },
      });
      expect(deps.readSnapshotInTransaction).toHaveBeenCalledWith(
        context,
        { transaction: operation },
      );
      expect(deps.audit).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["create", { status: "REJECTED", diagnostics: [] }],
    ["supersede", {
      status: "ACCEPTED",
      academicSnapshot: {
        status: "ACCEPTED",
        snapshotFingerprint: "invalid",
      },
    }],
    ["revoke", {
      status: "ACCEPTED",
      academicSnapshot: {
        status: "ACCEPTED",
        snapshotFingerprint: undefined,
      },
    }],
  ] as const)(
    "returns the exact unavailable-snapshot contract when the %s transaction guard cannot read a canonical fingerprint",
    async (operation, snapshot) => {
      const mutation = operation === "create"
        ? deps.placementService.createPlacement
        : operation === "supersede"
          ? deps.placementService.supersedePlacement
          : deps.placementService.revokePlacement;
      mutation.mockImplementationOnce(async (_input: unknown, options: any) => {
        await options.beforeWrite({ transaction: operation });
        throw new Error("guard should have rejected");
      });
      deps.readSnapshotInTransaction.mockResolvedValueOnce(snapshot);
      const { app, auth } = await appFor("admin");
      const path = operation === "create"
        ? `/api/admin/students/${STUDENT_ID}/placements`
        : `/api/admin/students/${STUDENT_ID}/placements/${PLACEMENT_ID}/${operation}`;
      const body = operation === "create"
        ? createBody()
        : operation === "supersede"
          ? {
              expectedSnapshotFingerprint: FINGERPRINT,
              requirementId: REQUIREMENT_ID,
              rationale: "Move placement",
            }
          : {
              expectedSnapshotFingerprint: FINGERPRINT,
              rationale: "Revoke placement",
            };

      const response = await request(app)
        .post(path)
        .set("Authorization", `Bearer ${auth}`)
        .send(body);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: {
          code: "PLACEMENT_WORKFLOW_SNAPSHOT_UNAVAILABLE",
          message: "Current degree progress snapshot is unavailable",
        },
      });
      expect(deps.audit).not.toHaveBeenCalled();
    },
  );

  it.each([null, undefined, "sha256:not-canonical"])(
    "fails closed for absent or invalid current fingerprint %s",
    async (fingerprint) => {
      deps.getProgress.mockResolvedValue({
        snapshot: fingerprint === undefined ? {} : fingerprint === null ? null : { fingerprint },
      });
      const { app, auth } = await appFor("admin");
      const response = await request(app)
        .post(`/api/admin/students/${STUDENT_ID}/placements`)
        .set("Authorization", `Bearer ${auth}`)
        .send(createBody());

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe("PLACEMENT_WORKFLOW_SNAPSHOT_UNAVAILABLE");
      expect(deps.placementService.createPlacement).not.toHaveBeenCalled();
      expect(deps.audit).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for no active context without progress, mutation, or audit", async () => {
    deps.resolveContext.mockResolvedValue(null);
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .post(`/api/admin/students/${STUDENT_ID}/placements`)
      .set("Authorization", `Bearer ${auth}`)
      .send(createBody());

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("PLACEMENT_WORKFLOW_CONTEXT_NOT_FOUND");
    expect(deps.getProgress).not.toHaveBeenCalled();
    expect(deps.placementService.createPlacement).not.toHaveBeenCalled();
    expect(deps.audit).not.toHaveBeenCalled();
  });

  it("fails closed when resolved context does not match the path student", async () => {
    deps.resolveContext.mockResolvedValue({ ...context, studentId: "other-student" });
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .post(`/api/admin/students/${STUDENT_ID}/placements`)
      .set("Authorization", `Bearer ${auth}`)
      .send(createBody());

    expect(response.status).toBe(500);
    expect(deps.getProgress).not.toHaveBeenCalled();
    expect(deps.placementService.createPlacement).not.toHaveBeenCalled();
  });

  it.each(["staff", "coach", "student"] as const)(
    "rejects %s with 403 before workflow dependencies",
    async (role) => {
      const { app, auth } = await appFor(role);
      const response = await request(app)
        .post(`/api/admin/students/${STUDENT_ID}/placements`)
        .set("Authorization", `Bearer ${auth}`)
        .send(createBody());

      expect(response.status).toBe(403);
      expect(deps.resolveContext).not.toHaveBeenCalled();
      expect(deps.getProgress).not.toHaveBeenCalled();
      expect(deps.placementService.createPlacement).not.toHaveBeenCalled();
    },
  );

  it("rejects unauthenticated requests with 401 before workflow dependencies", async () => {
    const { app } = await appFor(null);
    const response = await request(app)
      .post(`/api/admin/students/${STUDENT_ID}/placements`)
      .send(createBody());

    expect(response.status).toBe(401);
    expect(deps.resolveContext).not.toHaveBeenCalled();
    expect(deps.getProgress).not.toHaveBeenCalled();
    expect(deps.placementService.createPlacement).not.toHaveBeenCalled();
  });

  it.each([
    ["createdBy", ADMIN_ID],
    ["decidedBy", ADMIN_ID],
    ["reviewerId", ADMIN_ID],
    ["approvedBy", ADMIN_ID],
    ["studentId", STUDENT_ID],
    ["metadata", { injected: true }],
    ["provenance", { injected: true }],
    ["unknown", "field"],
  ])("strictly rejects browser-supplied %s", async (field, value) => {
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .post(`/api/admin/students/${STUDENT_ID}/placements`)
      .set("Authorization", `Bearer ${auth}`)
      .send(createBody({ [field]: value }));

    expect(response.status).toBe(400);
    expect(deps.resolveContext).not.toHaveBeenCalled();
    expect(deps.getProgress).not.toHaveBeenCalled();
    expect(deps.placementService.createPlacement).not.toHaveBeenCalled();
  });

  it.each([
    ["actor", ADMIN_ID],
    ["programAssignmentId", ASSIGNMENT_ID],
  ])(
    "explicitly rejects browser injection of create-placement %s before context, progress, mutation, or audit",
    async (field, value) => {
      const { app, auth } = await appFor("admin");
      const response = await request(app)
        .post(`/api/admin/students/${STUDENT_ID}/placements`)
        .set("Authorization", `Bearer ${auth}`)
        .send(createBody({ [field]: value }));

      expect(response.status).toBe(400);
      expect(deps.resolveContext).not.toHaveBeenCalled();
      expect(deps.getProgress).not.toHaveBeenCalled();
      expect(deps.placementService.createPlacement).not.toHaveBeenCalled();
      expect(deps.audit).not.toHaveBeenCalled();
    },
  );

  it("supersedes with historical identity omitted and only server-controlled workflow data", async () => {
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .post(`/api/admin/students/${STUDENT_ID}/placements/${PLACEMENT_ID}/supersede`)
      .set("Authorization", `Bearer ${auth}`)
      .send({
        expectedSnapshotFingerprint: FINGERPRINT,
        requirementId: REQUIREMENT_ID,
        academicRuleId: null,
        rationale: "Move the recorded credit to another selected requirement",
      });

    expect(response.status).toBe(201);
    expect(deps.getProgress).toHaveBeenCalledOnce();
    expect(deps.placementService.supersedePlacement).toHaveBeenCalledWith({
      oldPlacementId: PLACEMENT_ID,
      requirementId: REQUIREMENT_ID,
      academicRuleId: null,
      actor: ADMIN_ID,
      rationale: "Move the recorded credit to another selected requirement",
      metadata: {
        workflow: "admin_controlled_placement",
        operation: "supersede",
        studentId: STUDENT_ID,
        snapshotFingerprint: FINGERPRINT,
      },
      provenance: {
        source: "admin_controlled_placement_workflow",
        snapshotFingerprint: FINGERPRINT,
        context,
      },
    }, {
      beforeWrite: expect.any(Function),
    });
    const input = deps.placementService.supersedePlacement.mock.calls[0][0];
    expect(input).not.toHaveProperty("studentCreditDecisionId");
    expect(input).not.toHaveProperty("programAssignmentId");
    expect(deps.placementService.assertPlacementContext).toHaveBeenCalledWith({
      placementId: PLACEMENT_ID,
      studentId: STUDENT_ID,
      programAssignmentId: ASSIGNMENT_ID,
      programVersionId: PROGRAM_VERSION_ID,
    });
  });

  it.each([
    ["studentCreditDecisionId", DECISION_ID],
    ["programAssignmentId", ASSIGNMENT_ID],
  ])("rejects browser-supplied supersede %s", async (field, value) => {
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .post(`/api/admin/students/${STUDENT_ID}/placements/${PLACEMENT_ID}/supersede`)
      .set("Authorization", `Bearer ${auth}`)
      .send({
        expectedSnapshotFingerprint: FINGERPRINT,
        requirementId: REQUIREMENT_ID,
        rationale: "Move placement",
        [field]: value,
      });

    expect(response.status).toBe(400);
    expect(deps.resolveContext).not.toHaveBeenCalled();
    expect(deps.placementService.supersedePlacement).not.toHaveBeenCalled();
  });

  it("revokes through the service with only placement id, server actor, and rationale", async () => {
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .post(`/api/admin/students/${STUDENT_ID}/placements/${PLACEMENT_ID}/revoke`)
      .set("Authorization", `Bearer ${auth}`)
      .send({
        expectedSnapshotFingerprint: FINGERPRINT,
        rationale: "Recorded placement is no longer applicable",
      });

    expect(response.status).toBe(200);
    expect(deps.getProgress).toHaveBeenCalledOnce();
    expect(deps.placementService.revokePlacement).toHaveBeenCalledWith({
      placementId: PLACEMENT_ID,
      actor: ADMIN_ID,
      rationale: "Recorded placement is no longer applicable",
    }, {
      beforeWrite: expect.any(Function),
    });
    expect(deps.placementService.assertPlacementContext).toHaveBeenCalledWith({
      placementId: PLACEMENT_ID,
      studentId: STUDENT_ID,
      programAssignmentId: ASSIGNMENT_ID,
      programVersionId: PROGRAM_VERSION_ID,
    });
  });

  it.each(["supersede", "revoke"] as const)(
    "blocks cross-student %s before mutation and audit",
    async (operation) => {
      deps.placementService.assertPlacementContext.mockRejectedValue(
        invalidStateError("Placement context mismatch"),
      );
      const { app, auth } = await appFor("admin");
      const body = operation === "supersede"
        ? {
            expectedSnapshotFingerprint: FINGERPRINT,
            requirementId: REQUIREMENT_ID,
            rationale: "Move placement",
          }
        : {
            expectedSnapshotFingerprint: FINGERPRINT,
            rationale: "Revoke placement",
          };
      const response = await request(app)
        .post(`/api/admin/students/${STUDENT_ID}/placements/${PLACEMENT_ID}/${operation}`)
        .set("Authorization", `Bearer ${auth}`)
        .send(body);

      expect(response.status).toBe(409);
      expect(deps.getProgress).toHaveBeenCalledOnce();
      expect(deps.placementService.assertPlacementContext).toHaveBeenCalledOnce();
      expect(deps.placementService.supersedePlacement).not.toHaveBeenCalled();
      expect(deps.placementService.revokePlacement).not.toHaveBeenCalled();
      expect(deps.audit).not.toHaveBeenCalled();
    },
  );

  it("audits identifiers only and only after a successful mutation", async () => {
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .post(`/api/admin/students/${STUDENT_ID}/placements`)
      .set("Authorization", `Bearer ${auth}`)
      .send(createBody());

    expect(response.status).toBe(201);
    expect(deps.audit).toHaveBeenCalledOnce();
    expect(deps.placementService.createPlacement.mock.invocationCallOrder[0])
      .toBeLessThan(deps.audit.mock.invocationCallOrder[0]);
    const audit = deps.audit.mock.calls[0][0];
    expect(audit).toMatchObject({
      eventType: "admin.bulk_operation",
      actorUserId: ADMIN_ID,
      actorRole: "admin",
      targetResourceType: "student_credit_placement",
      targetResourceId: PLACEMENT_ID,
      isEducationalRecord: true,
      metadata: {
        operation: "create",
        studentId: STUDENT_ID,
        programAssignmentId: ASSIGNMENT_ID,
        studentCreditDecisionId: DECISION_ID,
        requirementId: REQUIREMENT_ID,
        academicRuleId: RULE_ID,
        expectedSnapshotFingerprint: FINGERPRINT,
        currentSnapshotFingerprint: FINGERPRINT,
      },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain("rationale");
    expect(audit.metadata).not.toHaveProperty("body");
    expect(audit.metadata).not.toHaveProperty("provenance");
  });

  it("maps placement domain errors without auditing", async () => {
    deps.placementService.revokePlacement.mockRejectedValue(
      invalidStateError("Only an active placement can be revoked", {
        placementId: PLACEMENT_ID,
        status: "revoked",
      }),
    );
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .post(`/api/admin/students/${STUDENT_ID}/placements/${PLACEMENT_ID}/revoke`)
      .set("Authorization", `Bearer ${auth}`)
      .send({
        expectedSnapshotFingerprint: FINGERPRINT,
        rationale: "Attempt revoke",
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("STUDENT_ACADEMIC_INVALID_STATE");
    expect(deps.audit).not.toHaveBeenCalled();
  });

  it.each(["create", "supersede", "revoke"] as const)(
    "maps an in-transaction inactive-assignment %s rejection to 409 without auditing",
    async (operation) => {
      const mutation = operation === "create"
        ? deps.placementService.createPlacement
        : operation === "supersede"
          ? deps.placementService.supersedePlacement
          : deps.placementService.revokePlacement;
      mutation.mockRejectedValueOnce(
        invalidStateError("Program assignment must be active for placement", {
          programAssignmentId: ASSIGNMENT_ID,
          status: "superseded",
        }),
      );
      const { app, auth } = await appFor("admin");
      const path = operation === "create"
        ? `/api/admin/students/${STUDENT_ID}/placements`
        : `/api/admin/students/${STUDENT_ID}/placements/${PLACEMENT_ID}/${operation}`;
      const body = operation === "create"
        ? createBody()
        : operation === "supersede"
          ? {
              expectedSnapshotFingerprint: FINGERPRINT,
              requirementId: REQUIREMENT_ID,
              rationale: "Move placement",
            }
          : {
              expectedSnapshotFingerprint: FINGERPRINT,
              rationale: "Revoke placement",
            };
      const response = await request(app)
        .post(path)
        .set("Authorization", `Bearer ${auth}`)
        .send(body);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("STUDENT_ACADEMIC_INVALID_STATE");
      expect(mutation).toHaveBeenCalledOnce();
      expect(deps.audit).not.toHaveBeenCalled();
    },
  );

  it("sanitizes unexpected placement errors without auditing", async () => {
    deps.placementService.createPlacement.mockRejectedValue(new Error("database secret detail"));
    const { app, auth } = await appFor("admin");
    const response = await request(app)
      .post(`/api/admin/students/${STUDENT_ID}/placements`)
      .set("Authorization", `Bearer ${auth}`)
      .send(createBody());

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal Server Error" },
    });
    expect(JSON.stringify(response.body)).not.toContain("database secret detail");
    expect(deps.audit).not.toHaveBeenCalled();
  });
});