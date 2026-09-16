import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  resolveActiveDegreeProgressContext,
  type GetDegreeProgress,
  type ResolveDegreeProgressContext,
} from "./admin-degree-progress";
import { getDegreeProgress } from "../services/degree-progress-service";
import {
  createStudentCreditPlacementServiceWithDefaults,
  type StudentCreditPlacementService,
} from "../services/student-credit-placement-service";
import type {
  StudentCreditPlacementTx,
} from "../repositories/student-credit-placement-repo";
import {
  readDegreeEvaluationSnapshotInTransaction,
} from "../services/degree-evaluation-snapshot-service";
import type {
  DegreeEvaluationSnapshotRepository,
  DegreeEvaluationSnapshotTx,
} from "../repositories/degree-evaluation-snapshot-repo";
import type { DegreeEvaluationSnapshotContext } from "@shared/degree-evaluation-snapshot";
import { createAuditLog, type AuditLogEntry } from "../lib/audit";
import { sendStudentAcademicError } from "../lib/student-academic-http";

const studentIdSchema = z.string().trim().min(1).max(128);
const uuidSchema = z.string().uuid();
const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const rationaleSchema = z.string().trim().min(1);

const createPlacementBody = z.object({
  expectedSnapshotFingerprint: fingerprintSchema,
  studentCreditDecisionId: uuidSchema,
  requirementId: uuidSchema,
  academicRuleId: uuidSchema.nullable().optional(),
  rationale: rationaleSchema,
}).strict();

const supersedePlacementBody = z.object({
  expectedSnapshotFingerprint: fingerprintSchema,
  requirementId: uuidSchema,
  academicRuleId: uuidSchema.nullable().optional(),
  rationale: rationaleSchema,
}).strict();

const revokePlacementBody = z.object({
  expectedSnapshotFingerprint: fingerprintSchema,
  rationale: rationaleSchema,
}).strict();

const resolvedContextSchema = z.object({
  studentId: z.string().trim().min(1).max(128),
  programAssignmentId: z.string().trim().min(1),
  programVersionId: z.string().trim().min(1),
}).strict();

type CreateAuditLog = (entry: AuditLogEntry) => Promise<void>;
type ReadSnapshotInTransaction = (
  context: DegreeEvaluationSnapshotContext,
  tx: DegreeEvaluationSnapshotTx,
  repository?: DegreeEvaluationSnapshotRepository,
) => ReturnType<typeof readDegreeEvaluationSnapshotInTransaction>;

export interface AdminStudentCreditPlacementDependencies {
  readonly resolveContext: ResolveDegreeProgressContext;
  readonly getProgress: GetDegreeProgress;
  readonly placementService: StudentCreditPlacementService;
  readonly audit: CreateAuditLog;
  readonly readSnapshotInTransaction?: ReadSnapshotInTransaction;
}

type ActiveMutationContext = z.infer<typeof resolvedContextSchema> & {
  readonly snapshotFingerprint: string;
};

class PlacementWorkflowSnapshotError extends Error {
  constructor(
    readonly code:
      | "PLACEMENT_WORKFLOW_STALE_SNAPSHOT"
      | "PLACEMENT_WORKFLOW_SNAPSHOT_UNAVAILABLE",
  ) {
    super(code === "PLACEMENT_WORKFLOW_STALE_SNAPSHOT"
      ? "Degree progress changed; refresh before updating placements"
      : "Current degree progress snapshot is unavailable");
    this.name = "PlacementWorkflowSnapshotError";
  }
}

function sendPlacementWorkflowError(res: Response, error: unknown): boolean {
  if (!(error instanceof PlacementWorkflowSnapshotError)) return false;
  res.status(error.code === "PLACEMENT_WORKFLOW_STALE_SNAPSHOT" ? 409 : 500).json({
    error: {
      code: error.code,
      message: error.message,
    },
  });
  return true;
}

function validationError(res: Response, message: string) {
  return res.status(400).json({
    error: {
      code: "PLACEMENT_WORKFLOW_VALIDATION_ERROR",
      message,
    },
  });
}

async function resolveMutationContext(
  studentId: string,
  expectedSnapshotFingerprint: string,
  dependencies: AdminStudentCreditPlacementDependencies,
  res: Response,
): Promise<ActiveMutationContext | null> {
  const resolved: unknown = await dependencies.resolveContext(studentId);
  if (resolved === null) {
    res.status(404).json({
      error: {
        code: "PLACEMENT_WORKFLOW_CONTEXT_NOT_FOUND",
        message: "No active degree program assignment found for student",
      },
    });
    return null;
  }

  const context = resolvedContextSchema.safeParse(resolved);
  if (!context.success || context.data.studentId !== studentId) {
    res.status(500).json({ error: "Internal server error" });
    return null;
  }

  const report = await dependencies.getProgress(context.data);
  const currentFingerprint = report.snapshot?.fingerprint;
  if (!fingerprintSchema.safeParse(currentFingerprint).success) {
    res.status(500).json({
      error: {
        code: "PLACEMENT_WORKFLOW_SNAPSHOT_UNAVAILABLE",
        message: "Current degree progress snapshot is unavailable",
      },
    });
    return null;
  }

  if (currentFingerprint !== expectedSnapshotFingerprint) {
    res.status(409).json({
      error: {
        code: "PLACEMENT_WORKFLOW_STALE_SNAPSHOT",
        message: "Degree progress changed; refresh before updating placements",
      },
    });
    return null;
  }

  return {
    ...context.data,
    snapshotFingerprint: currentFingerprint,
  };
}

function transactionalFingerprintGuard(
  context: ActiveMutationContext,
  expectedSnapshotFingerprint: string,
  dependencies: AdminStudentCreditPlacementDependencies,
) {
  return async (tx: StudentCreditPlacementTx) => {
    // The placement service invokes this only after its assignment lock, which
    // serializes Phase 5C placement writers. This is not a global version token
    // for canonical tables mutated outside that lock domain.
    const readSnapshot = dependencies.readSnapshotInTransaction
      ?? readDegreeEvaluationSnapshotInTransaction;
    const snapshot = await readSnapshot({
      studentId: context.studentId,
      programAssignmentId: context.programAssignmentId,
      programVersionId: context.programVersionId,
    }, tx as DegreeEvaluationSnapshotTx);
    if (
      snapshot.status !== "ACCEPTED"
      || snapshot.academicSnapshot.status !== "ACCEPTED"
    ) {
      throw new PlacementWorkflowSnapshotError("PLACEMENT_WORKFLOW_SNAPSHOT_UNAVAILABLE");
    }
    const currentFingerprint = snapshot.academicSnapshot.snapshotFingerprint;
    if (!fingerprintSchema.safeParse(currentFingerprint).success) {
      throw new PlacementWorkflowSnapshotError("PLACEMENT_WORKFLOW_SNAPSHOT_UNAVAILABLE");
    }
    if (currentFingerprint !== expectedSnapshotFingerprint) {
      throw new PlacementWorkflowSnapshotError("PLACEMENT_WORKFLOW_STALE_SNAPSHOT");
    }
  };
}

function workflowMetadata(
  operation: "create" | "supersede",
  context: ActiveMutationContext,
) {
  return {
    workflow: "admin_controlled_placement",
    operation,
    studentId: context.studentId,
    snapshotFingerprint: context.snapshotFingerprint,
  } as const;
}

function workflowProvenance(context: ActiveMutationContext) {
  return {
    source: "admin_controlled_placement_workflow",
    snapshotFingerprint: context.snapshotFingerprint,
    context: {
      studentId: context.studentId,
      programAssignmentId: context.programAssignmentId,
      programVersionId: context.programVersionId,
    },
  } as const;
}

async function auditPlacement(
  req: Request,
  dependencies: AdminStudentCreditPlacementDependencies,
  input: {
    operation: "create" | "supersede" | "revoke";
    placementId: string;
    context: ActiveMutationContext;
    studentCreditDecisionId?: string;
    requirementId?: string;
    academicRuleId?: string | null;
  },
) {
  await dependencies.audit({
    eventType: "admin.bulk_operation",
    severity: "info",
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    targetResourceType: "student_credit_placement",
    targetResourceId: input.placementId,
    actionDescription: `${input.operation} student_credit_placement ${input.placementId}`,
    metadata: {
      operation: input.operation,
      studentId: input.context.studentId,
      programAssignmentId: input.context.programAssignmentId,
      ...(input.studentCreditDecisionId
        ? { studentCreditDecisionId: input.studentCreditDecisionId }
        : {}),
      ...(input.requirementId ? { requirementId: input.requirementId } : {}),
      ...(input.academicRuleId !== undefined
        ? { academicRuleId: input.academicRuleId }
        : {}),
      expectedSnapshotFingerprint: input.context.snapshotFingerprint,
      currentSnapshotFingerprint: input.context.snapshotFingerprint,
    },
    isEducationalRecord: true,
  });
}

export function createAdminStudentCreditPlacementRouter(
  dependencies: AdminStudentCreditPlacementDependencies,
) {
  const router = Router();
  router.use(requireAuth);
  router.use(requireRole(["admin"]));

  router.post("/students/:studentId/placements", async (req: Request, res: Response) => {
    const studentId = studentIdSchema.safeParse(req.params.studentId);
    if (!studentId.success) {
      return validationError(res, "studentId must be a non-empty string of at most 128 characters");
    }

    const body = createPlacementBody.safeParse(req.body);
    if (!body.success) return sendStudentAcademicError(res, body.error);

    try {
      const context = await resolveMutationContext(
        studentId.data,
        body.data.expectedSnapshotFingerprint,
        dependencies,
        res,
      );
      if (!context) return;

      const placement = await dependencies.placementService.createPlacement({
        studentCreditDecisionId: body.data.studentCreditDecisionId,
        programAssignmentId: context.programAssignmentId,
        requirementId: body.data.requirementId,
        academicRuleId: body.data.academicRuleId ?? null,
        actor: req.user!.id,
        rationale: body.data.rationale,
        metadata: workflowMetadata("create", context),
        provenance: workflowProvenance(context),
      }, {
        beforeWrite: transactionalFingerprintGuard(
          context,
          body.data.expectedSnapshotFingerprint,
          dependencies,
        ),
      });
      await auditPlacement(req, dependencies, {
        operation: "create",
        placementId: placement.id,
        context,
        studentCreditDecisionId: body.data.studentCreditDecisionId,
        requirementId: body.data.requirementId,
        academicRuleId: body.data.academicRuleId ?? null,
      });
      return res.status(201).json({ placement });
    } catch (error) {
      if (sendPlacementWorkflowError(res, error)) return;
      return sendStudentAcademicError(res, error);
    }
  });

  router.post(
    "/students/:studentId/placements/:placementId/supersede",
    async (req: Request, res: Response) => {
      const studentId = studentIdSchema.safeParse(req.params.studentId);
      const placementId = uuidSchema.safeParse(req.params.placementId);
      if (!studentId.success) {
        return validationError(res, "studentId must be a non-empty string of at most 128 characters");
      }
      if (!placementId.success) {
        return validationError(res, "placementId must be a valid UUID");
      }

      const body = supersedePlacementBody.safeParse(req.body);
      if (!body.success) return sendStudentAcademicError(res, body.error);

      try {
        const context = await resolveMutationContext(
          studentId.data,
          body.data.expectedSnapshotFingerprint,
          dependencies,
          res,
        );
        if (!context) return;

        await dependencies.placementService.assertPlacementContext({
          placementId: placementId.data,
          studentId: context.studentId,
          programAssignmentId: context.programAssignmentId,
          programVersionId: context.programVersionId,
        });
        const supersession = await dependencies.placementService.supersedePlacement({
          oldPlacementId: placementId.data,
          requirementId: body.data.requirementId,
          academicRuleId: body.data.academicRuleId ?? null,
          actor: req.user!.id,
          rationale: body.data.rationale,
          metadata: workflowMetadata("supersede", context),
          provenance: workflowProvenance(context),
        }, {
          beforeWrite: transactionalFingerprintGuard(
            context,
            body.data.expectedSnapshotFingerprint,
            dependencies,
          ),
        });
        await auditPlacement(req, dependencies, {
          operation: "supersede",
          placementId: supersession.newPlacement.id,
          context,
          studentCreditDecisionId: supersession.newPlacement.studentCreditDecisionId,
          requirementId: body.data.requirementId,
          academicRuleId: body.data.academicRuleId ?? null,
        });
        return res.status(201).json({ supersession });
      } catch (error) {
        if (sendPlacementWorkflowError(res, error)) return;
        return sendStudentAcademicError(res, error);
      }
    },
  );

  router.post(
    "/students/:studentId/placements/:placementId/revoke",
    async (req: Request, res: Response) => {
      const studentId = studentIdSchema.safeParse(req.params.studentId);
      const placementId = uuidSchema.safeParse(req.params.placementId);
      if (!studentId.success) {
        return validationError(res, "studentId must be a non-empty string of at most 128 characters");
      }
      if (!placementId.success) {
        return validationError(res, "placementId must be a valid UUID");
      }

      const body = revokePlacementBody.safeParse(req.body);
      if (!body.success) return sendStudentAcademicError(res, body.error);

      try {
        const context = await resolveMutationContext(
          studentId.data,
          body.data.expectedSnapshotFingerprint,
          dependencies,
          res,
        );
        if (!context) return;

        await dependencies.placementService.assertPlacementContext({
          placementId: placementId.data,
          studentId: context.studentId,
          programAssignmentId: context.programAssignmentId,
          programVersionId: context.programVersionId,
        });
        const placement = await dependencies.placementService.revokePlacement({
          placementId: placementId.data,
          actor: req.user!.id,
          rationale: body.data.rationale,
        }, {
          beforeWrite: transactionalFingerprintGuard(
            context,
            body.data.expectedSnapshotFingerprint,
            dependencies,
          ),
        });
        await auditPlacement(req, dependencies, {
          operation: "revoke",
          placementId: placement.id,
          context,
          studentCreditDecisionId: placement.studentCreditDecisionId,
          requirementId: placement.requirementId,
          academicRuleId: placement.academicRuleId,
        });
        return res.status(200).json({ placement });
      } catch (error) {
        if (sendPlacementWorkflowError(res, error)) return;
        return sendStudentAcademicError(res, error);
      }
    },
  );

  return router;
}

export default createAdminStudentCreditPlacementRouter({
  resolveContext: resolveActiveDegreeProgressContext,
  getProgress: getDegreeProgress,
  placementService: createStudentCreditPlacementServiceWithDefaults(),
  audit: createAuditLog,
});