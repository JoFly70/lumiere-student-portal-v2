/**
 * Student self-read API: GET /api/student/degree-progress (S04).
 *
 * The student is resolved ONLY from the authenticated user id; no identifier
 * is accepted from the path, query or body. The canonical degree progress
 * report and the student's academic record are projected into the
 * student-safe StudentDegreeProgressView. Diagnostics, fingerprints and
 * provenance internals are never part of the response.
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { logger } from '../lib/logger';
import { getDegreeProgress, type DegreeProgressReport } from '../services/degree-progress-service';
import { studentAcademicService } from '../services/student-academic-service';
import {
  getRequirementWithProgramVersion,
  getStudentByUserId,
} from '../repositories/student-academic-repo';
import { resolveActiveDegreeProgressContext } from './admin-degree-progress';
import type { DegreeEvaluationSnapshotContext } from '@shared/degree-evaluation-snapshot';
import {
  projectStudentDegreeProgress,
  type ProjectionAcademicRecord,
  type ProjectionRequirementLabel,
} from '@shared/student-degree-progress-projection';
import type { StudentDegreeProgressView } from '@shared/student-degree-progress-view';

export interface StudentDegreeProgressDependencies {
  readonly getStudentByUserId: (userId: string) => Promise<{ readonly id: string } | null>;
  readonly getAcademicRecord: (studentId: string) => Promise<ProjectionAcademicRecord>;
  readonly resolveContext: (studentId: string) => Promise<DegreeEvaluationSnapshotContext | null>;
  readonly getProgress: (context: DegreeEvaluationSnapshotContext) => Promise<DegreeProgressReport>;
  /** Labels for the evaluated requirements of one program version. */
  readonly getRequirementLabels: (
    programVersionId: string,
    requirementIds: readonly string[],
  ) => Promise<Readonly<Record<string, ProjectionRequirementLabel>>>;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Same read path the admin workspace uses for requirement labels
 * (getRequirementWithProgramVersion). A row that belongs to another program
 * version is ignored, never used as a label.
 */
export async function loadRequirementLabels(
  programVersionId: string,
  requirementIds: readonly string[],
): Promise<Record<string, ProjectionRequirementLabel>> {
  const labels: Record<string, ProjectionRequirementLabel> = {};
  await Promise.all([...new Set(requirementIds)].map(async (id) => {
    const row = await getRequirementWithProgramVersion(id);
    if (!row || row.requirement.programVersionId !== programVersionId) return;
    labels[id] = {
      code: str(row.requirement.code),
      title: str(row.requirement.title),
      sequence: typeof row.requirement.sequence === 'number' ? row.requirement.sequence : null,
    };
  }));
  return labels;
}

export const defaultStudentDegreeProgressDependencies: StudentDegreeProgressDependencies = {
  getStudentByUserId: (userId) => getStudentByUserId(userId),
  getAcademicRecord: (studentId) => studentAcademicService.getStudentAcademicRecord(studentId),
  resolveContext: resolveActiveDegreeProgressContext,
  getProgress: getDegreeProgress,
  getRequirementLabels: loadRequirementLabels,
};

/**
 * Canonical degree progress for one student, projected into the student-safe
 * view. Reusable by other student-facing read models (e.g. the S05 roadmap
 * foundation); the caller is responsible for resolving studentId from the
 * authenticated user.
 */
export async function loadStudentDegreeProgressView(
  studentId: string,
  deps: Pick<
    StudentDegreeProgressDependencies,
    'getAcademicRecord' | 'resolveContext' | 'getProgress' | 'getRequirementLabels'
  > = defaultStudentDegreeProgressDependencies,
): Promise<StudentDegreeProgressView> {
  const record = await deps.getAcademicRecord(studentId);
  const context = record.activeProgramAssignment
    ? await deps.resolveContext(studentId)
    : null;

  if (context === null) {
    return projectStudentDegreeProgress({
      report: null,
      record: { ...record, activeProgramAssignment: null, programVersion: null },
      requirementLabels: {},
    });
  }
  if (context.studentId !== studentId) {
    throw new Error('degree progress context does not match the authenticated student');
  }

  const report = await deps.getProgress(context);
  if (
    report.snapshot?.context
    && report.snapshot.context.studentId !== studentId
  ) {
    throw new Error('degree progress report does not match the authenticated student');
  }
  const requirementIds = report.status === 'COMPOSED'
    && report.phase3Output.compositionKind === 'COMPOSED'
    ? report.phase3Output.results
      .map((result) => result.requirementId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  const requirementLabels = requirementIds.length > 0
    ? await deps.getRequirementLabels(context.programVersionId, requirementIds)
    : {};

  return projectStudentDegreeProgress({ report, record, requirementLabels });
}

export function createStudentDegreeProgressRouter(
  deps: StudentDegreeProgressDependencies = defaultStudentDegreeProgressDependencies,
) {
  const router = Router();

  router.get(
    '/degree-progress',
    requireAuth,
    requireRole(['student']),
    async (req: Request, res: Response) => {
      // The student is always the authenticated user. Reject any attempt to
      // name a student explicitly.
      if (Object.prototype.hasOwnProperty.call(req.query, 'studentId')) {
        return res.status(400).json({
          error: {
            code: 'STUDENT_DEGREE_PROGRESS_VALIDATION_ERROR',
            message: 'studentId is not accepted',
          },
        });
      }

      try {
        const student = await deps.getStudentByUserId(req.user!.id);
        if (!student) {
          return res.status(404).json({
            error: {
              code: 'STUDENT_PROFILE_NOT_FOUND',
              message: 'No student profile found for this account',
            },
          });
        }

        return res.json(await loadStudentDegreeProgressView(student.id, deps));
      } catch (error) {
        logger.error('Student degree progress failed', {
          userId: req.user?.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  return router;
}

export default createStudentDegreeProgressRouter;
