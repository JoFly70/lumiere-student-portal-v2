import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  getDegreeProgress,
  type DegreeProgressReport,
} from '../services/degree-progress-service';
import {
  getActiveAssignmentForStudent,
} from '../repositories/student-academic-repo';
import type { DegreeEvaluationSnapshotContext } from '@shared/degree-evaluation-snapshot';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';

export type ResolveDegreeProgressContext = (
  studentId: string,
) => Promise<DegreeEvaluationSnapshotContext | null>;

export type GetDegreeProgress = (
  request: DegreeEvaluationSnapshotContext,
) => Promise<DegreeProgressReport>;

export interface AdminDegreeProgressDependencies {
  readonly resolveContext: ResolveDegreeProgressContext;
  readonly getProgress: GetDegreeProgress;
}

const studentIdSchema = z.string().trim().min(1).max(128);
const contextSchema = z.object({
  studentId: z.string().refine((value) => value.trim().length > 0),
  programAssignmentId: z.string().refine((value) => value.trim().length > 0),
  programVersionId: z.string().refine((value) => value.trim().length > 0),
}).strict();

function meaningfulString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function resolveActiveDegreeProgressContext(
  studentId: string,
): Promise<DegreeEvaluationSnapshotContext | null> {
  const assignment = await getActiveAssignmentForStudent(studentId);
  if (
    assignment === null
    || !meaningfulString(assignment.id)
    || !meaningfulString(assignment.programVersionId)
  ) {
    return null;
  }

  return {
    studentId,
    programAssignmentId: assignment.id.trim(),
    programVersionId: assignment.programVersionId.trim(),
  };
}

function validationError(res: Response) {
  return res.status(400).json({
    error: {
      code: 'DEGREE_PROGRESS_VALIDATION_ERROR',
      message: 'studentId must be a non-empty string of at most 128 characters',
    },
  });
}

export function createAdminDegreeProgressRouter(
  { resolveContext, getProgress }: AdminDegreeProgressDependencies,
) {
  const router = Router();

  router.use(requireAuth);
  router.use(requireRole(['admin']));

  const handleGet = async (req: Request, res: Response) => {
    const rawStudentId = req.params.studentId;

    // studentId is a path-only input. Reject malformed params and attempts to
    // provide a second value through the query string before service access.
    if (
      typeof rawStudentId !== 'string'
      || Object.prototype.hasOwnProperty.call(req.query, 'studentId')
    ) {
      return validationError(res);
    }

    const parsedStudentId = studentIdSchema.safeParse(rawStudentId);
    if (!parsedStudentId.success) {
      return validationError(res);
    }

    try {
      const resolvedContext: unknown = await resolveContext(parsedStudentId.data);
      if (resolvedContext === null) {
        return res.status(404).json({
          error: {
            code: 'DEGREE_PROGRESS_CONTEXT_NOT_FOUND',
            message: 'No active degree program assignment found for student',
          },
        });
      }

      const context = contextSchema.safeParse(resolvedContext);
      if (!context.success || context.data.studentId !== parsedStudentId.data) {
        return res.status(500).json({ error: 'Internal server error' });
      }

      const report = await getProgress(context.data);
      const snapshot = report.snapshot;

      return res.json({
        report,
        snapshotFingerprint: snapshot?.fingerprint ?? null,
        asOf: snapshot?.asOf ?? null,
        integrationDiagnostics: report.integrationDiagnostics,
      });
    } catch {
      return res.status(500).json({ error: 'Internal server error' });
    }
  };

  router.get('/students/:studentId/degree-progress', handleGet);
  // Keep a missing path parameter on the same phase-specific 400 contract.
  router.get('/students/degree-progress', handleGet);

  return router;
}

export default createAdminDegreeProgressRouter({
  resolveContext: resolveActiveDegreeProgressContext,
  getProgress: getDegreeProgress,
});