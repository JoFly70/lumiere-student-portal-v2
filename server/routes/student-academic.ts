/**
 * Student Academic Record API Router
 *
 * Two security surfaces:
 *   A. INTERNAL ADVISOR/ADMIN API  — mounted at /api/admin/student-academic
 *      staff, admin → READ + MUTATE; student/coach → 403 (coach fails closed)
 *   B. STUDENT SELF-READ API       — mounted at /api/student/academic-record
 *      student → own record only; everyone else denied
 *
 * All mutations go through the Student Academic Service.
 * No route imports the repository for mutation. No hard-delete endpoints.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { studentAcademicService } from '../services/student-academic-service';
import { sendStudentAcademicError } from '../lib/student-academic-http';
import { createAuditLog } from '../lib/audit';
import {
  studentAcademicSourceTypeEnum,
  studentAcademicSourceStatusEnum,
  studentCreditRecordTypeEnum,
  studentCreditVerificationActionEnum,
  studentCreditDecisionActionEnum,
  studentAcademicExceptionTypeEnum,
} from '@shared/student-academic-schema';

type SourceStatus = 'received' | 'extracted' | 'verified' | 'rejected' | 'superseded';
type VerificationAction = 'submitted' | 'verified' | 'rejected' | 'needs_review' | 'corrected' | 'superseded';
type DecisionAction = 'accepted' | 'rejected' | 'needs_review' | 'revoked';
type ExceptionType = 'requirement_waiver' | 'course_substitution' | 'credit_override' | 'level_override' | 'residency_override' | 'other';

// ── Enum value arrays derived from the shared schema ──────────────────────────

const SOURCE_TYPES = studentAcademicSourceTypeEnum.enumValues as readonly [string, ...string[]];
const SOURCE_STATUSES = studentAcademicSourceStatusEnum.enumValues as readonly [string, ...string[]];
const RECORD_TYPES = studentCreditRecordTypeEnum.enumValues as readonly [string, ...string[]];
const VERIFICATION_ACTIONS = studentCreditVerificationActionEnum.enumValues as readonly [string, ...string[]];
const DECISION_ACTIONS = studentCreditDecisionActionEnum.enumValues as readonly [string, ...string[]];
const EXCEPTION_TYPES = studentAcademicExceptionTypeEnum.enumValues as readonly [string, ...string[]];

// ── Shared Zod helpers ────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();
const uuidOptionalSchema = z.string().uuid().nullable().optional();

// Strict YYYY-MM-DD date (no time component)
const dateOnlySchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (expected YYYY-MM-DD)')
  .nullable()
  .optional();

// Strict ISO datetime → Date
const isoDateTimeSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/, 'Invalid ISO datetime format')
  .transform((val) => new Date(val))
  .nullable()
  .optional();

// Decimal string compatible with numeric(6,2): non-negative, max 4 integer digits + 2 decimals
const decimalStringSchema = z.string()
  .regex(/^\d{1,4}(\.\d{1,2})?$/, 'Credits must be a non-negative decimal string with at most 2 decimal places')
  .nullable()
  .optional();

// studentId is a text PK, not necessarily a UUID
const studentIdParamSchema = z.string().trim().min(1).max(128);

// ── Audit helper (local to this router) ───────────────────────────────────────

async function auditMutation(req: Request, opts: {
  studentId?: string | null;
  resourceType: string;
  resourceId: string;
  action: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const user = req.user;
  if (!user) return;
  await createAuditLog({
    eventType: 'admin.bulk_operation',
    severity: 'info',
    actorUserId: user.id,
    actorRole: user.role,
    targetUserId: opts.studentId ?? undefined,
    targetResourceType: opts.resourceType,
    targetResourceId: opts.resourceId,
    actionDescription: `${opts.action} ${opts.resourceType} ${opts.resourceId}`,
    metadata: opts.metadata ?? {},
    isEducationalRecord: true,
  });
}

// ── Student-safe projection ───────────────────────────────────────────────────

function projectStudentSafe(record: Awaited<ReturnType<typeof studentAcademicService.getStudentAcademicRecord>>) {
  const s = record.student;
  return {
    student: {
      id: s.id,
      studentCode: s.student_code,
      firstName: s.first_name,
      middleName: s.middle_name ?? null,
      lastName: s.last_name,
      preferredName: s.preferred_name ?? null,
      status: s.status,
    },
    activeProgramAssignment: record.activeProgramAssignment ? {
      id: record.activeProgramAssignment.id,
      status: record.activeProgramAssignment.status,
      cohortLabel: record.activeProgramAssignment.cohortLabel ?? null,
      assignedAt: record.activeProgramAssignment.assignedAt,
      endedAt: record.activeProgramAssignment.endedAt ?? null,
    } : null,
    program: record.programVersion ? {
      versionId: record.programVersion.version.id,
      versionLabel: record.programVersion.version.versionLabel,
      programId: record.programVersion.program.id,
      programCode: record.programVersion.program.code,
      programName: record.programVersion.program.name,
      institutionId: record.programVersion.institution.id,
      institutionName: record.programVersion.institution.name,
    } : null,
    academicSources: record.academicSources.map(src => ({
      id: src.id,
      sourceType: src.sourceType,
      status: src.status,
      title: src.title,
      sourceDate: src.sourceDate ?? null,
      receivedAt: src.receivedAt ?? null,
    })),
    creditRecords: record.creditRecords.map(cr => {
      const latestV = record.latestVerifications[cr.id];
      const latestD = record.latestDecisions[cr.id];
      return {
        id: cr.id,
        recordType: cr.recordType,
        status: cr.status,
        rawCourseCode: cr.rawCourseCode ?? null,
        rawTitle: cr.rawTitle,
        rawCredits: cr.rawCredits ?? null,
        rawGrade: cr.rawGrade ?? null,
        rawLevel: cr.rawLevel ?? null,
        term: cr.term ?? null,
        completedOn: cr.completedOn ?? null,
        normalizedCredits: cr.normalizedCredits ?? null,
        normalizedLevel: cr.normalizedLevel ?? null,
        verification: latestV ? { action: latestV.action } : null,
        decision: latestD ? {
          action: latestD.action,
          creditsAwarded: latestD.creditsAwarded ?? null,
          levelAwarded: latestD.levelAwarded ?? null,
        } : null,
      };
    }),
    activeExceptions: record.activeExceptions.map(ex => ({
      id: ex.id,
      exceptionType: ex.exceptionType,
      status: ex.status,
      effectiveFrom: ex.effectiveFrom ?? null,
      effectiveTo: ex.effectiveTo ?? null,
    })),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// A. INTERNAL ADVISOR/ADMIN API
// ═════════════════════════════════════════════════════════════════════════════

const internalRouter = Router();

internalRouter.use(requireAuth);
internalRouter.use(requireRole(['staff', 'admin']));

// ── READ: full internal record ───────────────────────────────────────────────

internalRouter.get('/students/:studentId', async (req: Request, res: Response) => {
  try {
    const idCheck = studentIdParamSchema.safeParse(req.params.studentId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'STUDENT_ACADEMIC_VALIDATION_ERROR', message: 'studentId must be a non-empty string of at most 128 characters' } });
    }
    const record = await studentAcademicService.getStudentAcademicRecord(req.params.studentId);
    res.json(record);
  } catch (error) {
    sendStudentAcademicError(res, error);
  }
});

// ── Program assignment ───────────────────────────────────────────────────────

const assignProgramBody = z.object({
  programVersionId: z.string().uuid(),
  cohortLabel: z.string().trim().min(1).nullable().optional(),
  reason: z.string().nullable().optional(),
}).strict();

internalRouter.post('/students/:studentId/program-assignments', async (req: Request, res: Response) => {
  try {
    const idCheck = studentIdParamSchema.safeParse(req.params.studentId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'STUDENT_ACADEMIC_VALIDATION_ERROR', message: 'studentId must be a non-empty string of at most 128 characters' } });
    }
    const validated = assignProgramBody.parse(req.body);
    const result = await studentAcademicService.assignProgram({
      studentId: req.params.studentId,
      programVersionId: validated.programVersionId,
      cohortLabel: validated.cohortLabel ?? null,
      reason: validated.reason ?? null,
      assignedBy: req.user!.id,
    });
    await auditMutation(req, {
      studentId: req.params.studentId,
      resourceType: 'program_assignment',
      resourceId: result.id,
      action: 'assign',
      metadata: { programVersionId: validated.programVersionId },
    });
    res.status(201).json({ assignment: result });
  } catch (error) {
    sendStudentAcademicError(res, error);
  }
});

const switchProgramBody = z.object({
  newProgramVersionId: z.string().uuid(),
  reason: z.string().nullable().optional(),
}).strict();

internalRouter.post('/students/:studentId/program-assignments/switch', async (req: Request, res: Response) => {
  try {
    const idCheck = studentIdParamSchema.safeParse(req.params.studentId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'STUDENT_ACADEMIC_VALIDATION_ERROR', message: 'studentId must be a non-empty string of at most 128 characters' } });
    }
    const validated = switchProgramBody.parse(req.body);
    const result = await studentAcademicService.switchProgramAssignment({
      studentId: req.params.studentId,
      newProgramVersionId: validated.newProgramVersionId,
      reason: validated.reason ?? null,
      assignedBy: req.user!.id,
    });
    await auditMutation(req, {
      studentId: req.params.studentId,
      resourceType: 'program_assignment',
      resourceId: result.newAssignment.id,
      action: 'switch',
      metadata: { oldAssignmentId: result.oldAssignment.id, newProgramVersionId: validated.newProgramVersionId },
    });
    res.status(200).json({ switch: result });
  } catch (error) {
    sendStudentAcademicError(res, error);
  }
});

// ── Academic sources ─────────────────────────────────────────────────────────

const createSourceBody = z.object({
  documentId: z.string().nullable().optional(),
  sourceType: z.enum(SOURCE_TYPES),
  title: z.string().trim().min(1),
  issuingInstitutionId: uuidOptionalSchema,
  issuingProviderId: uuidOptionalSchema,
  externalFileId: z.string().nullable().optional(),
  sourceDate: dateOnlySchema,
  receivedAt: isoDateTimeSchema,
}).strict();

internalRouter.post('/students/:studentId/sources', async (req: Request, res: Response) => {
  try {
    const idCheck = studentIdParamSchema.safeParse(req.params.studentId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'STUDENT_ACADEMIC_VALIDATION_ERROR', message: 'studentId must be a non-empty string of at most 128 characters' } });
    }
    const validated = createSourceBody.parse(req.body);
    const result = await studentAcademicService.createAcademicSource({
      studentId: req.params.studentId,
      documentId: validated.documentId ?? null,
      sourceType: validated.sourceType,
      title: validated.title,
      issuingInstitutionId: validated.issuingInstitutionId ?? null,
      issuingProviderId: validated.issuingProviderId ?? null,
      externalFileId: validated.externalFileId ?? null,
      sourceDate: validated.sourceDate ?? null,
      receivedAt: validated.receivedAt ?? null,
      createdBy: req.user!.id,
    });
    await auditMutation(req, {
      studentId: req.params.studentId,
      resourceType: 'academic_source',
      resourceId: result.id,
      action: 'create',
      metadata: { sourceType: validated.sourceType },
    });
    res.status(201).json({ source: result });
  } catch (error) {
    sendStudentAcademicError(res, error);
  }
});

const transitionSourceBody = z.object({
  newStatus: z.enum(SOURCE_STATUSES),
}).strict();

internalRouter.post('/sources/:sourceId/transition', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.sourceId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'STUDENT_ACADEMIC_VALIDATION_ERROR', message: 'sourceId must be a valid UUID' } });
    }
    const validated = transitionSourceBody.parse(req.body);
    const result = await studentAcademicService.transitionAcademicSource({
      sourceId: req.params.sourceId,
      newStatus: validated.newStatus as SourceStatus,
    });
    await auditMutation(req, {
      resourceType: 'academic_source',
      resourceId: result.id,
      action: 'transition',
      metadata: { newStatus: validated.newStatus },
    });
    res.status(200).json({ source: result });
  } catch (error) {
    sendStudentAcademicError(res, error);
  }
});

// ── Credit records ────────────────────────────────────────────────────────────

const createCreditRecordBody = z.object({
  recordType: z.enum(RECORD_TYPES).optional(),
  sourceLineKey: z.string().nullable().optional(),
  rawCourseCode: z.string().nullable().optional(),
  rawTitle: z.string().trim().min(1),
  rawCredits: decimalStringSchema,
  rawGrade: z.string().nullable().optional(),
  rawLevel: z.string().nullable().optional(),
  term: z.string().nullable().optional(),
  completedOn: dateOnlySchema,
  institutionCourseVersionId: uuidOptionalSchema,
  providerCourseVersionId: uuidOptionalSchema,
  normalizedCredits: decimalStringSchema,
  normalizedLevel: z.string().nullable().optional(),
}).strict();

internalRouter.post('/sources/:sourceId/credit-records', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.sourceId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'STUDENT_ACADEMIC_VALIDATION_ERROR', message: 'sourceId must be a valid UUID' } });
    }
    const validated = createCreditRecordBody.parse(req.body);
    const result = await studentAcademicService.createCreditRecord({
      sourceId: req.params.sourceId,
      recordType: validated.recordType,
      sourceLineKey: validated.sourceLineKey ?? null,
      rawCourseCode: validated.rawCourseCode ?? null,
      rawTitle: validated.rawTitle,
      rawCredits: validated.rawCredits ?? null,
      rawGrade: validated.rawGrade ?? null,
      rawLevel: validated.rawLevel ?? null,
      term: validated.term ?? null,
      completedOn: validated.completedOn ?? null,
      institutionCourseVersionId: validated.institutionCourseVersionId ?? null,
      providerCourseVersionId: validated.providerCourseVersionId ?? null,
      normalizedCredits: validated.normalizedCredits ?? null,
      normalizedLevel: validated.normalizedLevel ?? null,
      createdBy: req.user!.id,
    });
    await auditMutation(req, {
      resourceType: 'credit_record',
      resourceId: result.id,
      action: 'create',
      metadata: { sourceId: req.params.sourceId, recordType: result.recordType },
    });
    res.status(201).json({ creditRecord: result });
  } catch (error) {
    sendStudentAcademicError(res, error);
  }
});

const correctCreditRecordBody = z.object({
  rawCourseCode: z.string().nullable().optional(),
  rawTitle: z.string().trim().min(1).optional(),
  rawCredits: decimalStringSchema,
  rawGrade: z.string().nullable().optional(),
  rawLevel: z.string().nullable().optional(),
  term: z.string().nullable().optional(),
  completedOn: dateOnlySchema,
  institutionCourseVersionId: uuidOptionalSchema,
  providerCourseVersionId: uuidOptionalSchema,
  normalizedCredits: decimalStringSchema,
  normalizedLevel: z.string().nullable().optional(),
  rationale: z.string().nullable().optional(),
}).strict().refine((data) => {
  const correctionKeys = ['rawCourseCode', 'rawTitle', 'rawCredits', 'rawGrade', 'rawLevel', 'term', 'completedOn', 'institutionCourseVersionId', 'providerCourseVersionId', 'normalizedCredits', 'normalizedLevel'];
  return correctionKeys.some((k) => data[k as keyof typeof data] !== undefined);
}, { message: 'At least one correction field is required' });

internalRouter.patch('/credit-records/:creditRecordId/correct', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.creditRecordId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'STUDENT_ACADEMIC_VALIDATION_ERROR', message: 'creditRecordId must be a valid UUID' } });
    }
    const validated = correctCreditRecordBody.parse(req.body);
    const { rationale, ...corrections } = validated;
    const result = await studentAcademicService.correctCreditRecord({
      creditRecordId: req.params.creditRecordId,
      corrections,
      reviewerId: req.user!.id,
      rationale: rationale ?? null,
    });
    await auditMutation(req, {
      resourceType: 'credit_record',
      resourceId: result.id,
      action: 'correct',
    });
    res.status(200).json({ creditRecord: result });
  } catch (error) {
    sendStudentAcademicError(res, error);
  }
});

// ── Credit verification ──────────────────────────────────────────────────────

const verificationBody = z.object({
  action: z.enum(VERIFICATION_ACTIONS),
  rationale: z.string().nullable().optional(),
}).strict();

internalRouter.post('/credit-records/:creditRecordId/verifications', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.creditRecordId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'STUDENT_ACADEMIC_VALIDATION_ERROR', message: 'creditRecordId must be a valid UUID' } });
    }
    const validated = verificationBody.parse(req.body);
    const result = await studentAcademicService.recordCreditVerification({
      creditRecordId: req.params.creditRecordId,
      action: validated.action as VerificationAction,
      reviewerId: req.user!.id,
      rationale: validated.rationale ?? null,
    });
    await auditMutation(req, {
      resourceType: 'credit_verification',
      resourceId: result.id,
      action: validated.action,
      metadata: { creditRecordId: req.params.creditRecordId },
    });
    res.status(201).json({ verificationEvent: result });
  } catch (error) {
    sendStudentAcademicError(res, error);
  }
});

// ── Credit decisions ─────────────────────────────────────────────────────────

const decisionBody = z.object({
  programAssignmentId: z.string().uuid(),
  action: z.enum(DECISION_ACTIONS),
  creditsAwarded: decimalStringSchema,
  levelAwarded: z.string().nullable().optional(),
  equivalencyId: uuidOptionalSchema,
  targetInstitutionCourseVersionId: uuidOptionalSchema,
  basisClaimVersionId: uuidOptionalSchema,
  rationale: z.string().nullable().optional(),
}).strict();

internalRouter.post('/credit-records/:creditRecordId/decisions', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.creditRecordId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'STUDENT_ACADEMIC_VALIDATION_ERROR', message: 'creditRecordId must be a valid UUID' } });
    }
    const validated = decisionBody.parse(req.body);
    const result = await studentAcademicService.recordCreditDecision({
      creditRecordId: req.params.creditRecordId,
      programAssignmentId: validated.programAssignmentId,
      action: validated.action as DecisionAction,
      creditsAwarded: validated.creditsAwarded ?? null,
      levelAwarded: validated.levelAwarded ?? null,
      equivalencyId: validated.equivalencyId ?? null,
      targetInstitutionCourseVersionId: validated.targetInstitutionCourseVersionId ?? null,
      basisClaimVersionId: validated.basisClaimVersionId ?? null,
      rationale: validated.rationale ?? null,
      decidedBy: req.user!.id,
    });
    await auditMutation(req, {
      resourceType: 'credit_decision',
      resourceId: result.id,
      action: validated.action,
      metadata: { creditRecordId: req.params.creditRecordId, programAssignmentId: validated.programAssignmentId },
    });
    res.status(201).json({ decision: result });
  } catch (error) {
    sendStudentAcademicError(res, error);
  }
});

// ── Academic exceptions ──────────────────────────────────────────────────────

const createExceptionBody = z.object({
  programAssignmentId: z.string().uuid(),
  exceptionType: z.enum(EXCEPTION_TYPES),
  requirementId: uuidOptionalSchema,
  academicRuleId: uuidOptionalSchema,
  creditRecordId: uuidOptionalSchema,
  rationale: z.string().trim().min(1),
  effectiveFrom: isoDateTimeSchema,
  effectiveTo: isoDateTimeSchema,
}).strict();

internalRouter.post('/students/:studentId/exceptions', async (req: Request, res: Response) => {
  try {
    const idCheck = studentIdParamSchema.safeParse(req.params.studentId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'STUDENT_ACADEMIC_VALIDATION_ERROR', message: 'studentId must be a non-empty string of at most 128 characters' } });
    }
    const validated = createExceptionBody.parse(req.body);
    const result = await studentAcademicService.createAcademicException({
      studentId: req.params.studentId,
      programAssignmentId: validated.programAssignmentId,
      exceptionType: validated.exceptionType as ExceptionType,
      requirementId: validated.requirementId ?? null,
      academicRuleId: validated.academicRuleId ?? null,
      creditRecordId: validated.creditRecordId ?? null,
      rationale: validated.rationale,
      effectiveFrom: validated.effectiveFrom ?? null,
      effectiveTo: validated.effectiveTo ?? null,
      approvedBy: req.user!.id,
    });
    await auditMutation(req, {
      studentId: req.params.studentId,
      resourceType: 'academic_exception',
      resourceId: result.id,
      action: 'create',
      metadata: { exceptionType: validated.exceptionType },
    });
    res.status(201).json({ exception: result });
  } catch (error) {
    sendStudentAcademicError(res, error);
  }
});

const supersedeExceptionBody = z.object({
  exceptionType: z.enum(EXCEPTION_TYPES),
  requirementId: uuidOptionalSchema,
  academicRuleId: uuidOptionalSchema,
  creditRecordId: uuidOptionalSchema,
  rationale: z.string().trim().min(1),
  effectiveFrom: isoDateTimeSchema,
  effectiveTo: isoDateTimeSchema,
}).strict();

internalRouter.post('/exceptions/:exceptionId/supersede', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.exceptionId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'STUDENT_ACADEMIC_VALIDATION_ERROR', message: 'exceptionId must be a valid UUID' } });
    }
    const validated = supersedeExceptionBody.parse(req.body);
    const result = await studentAcademicService.supersedeAcademicException({
      oldExceptionId: req.params.exceptionId,
      exceptionType: validated.exceptionType as ExceptionType,
      requirementId: validated.requirementId ?? null,
      academicRuleId: validated.academicRuleId ?? null,
      creditRecordId: validated.creditRecordId ?? null,
      rationale: validated.rationale,
      effectiveFrom: validated.effectiveFrom ?? null,
      effectiveTo: validated.effectiveTo ?? null,
      approvedBy: req.user!.id,
    });
    await auditMutation(req, {
      resourceType: 'academic_exception',
      resourceId: result.newException.id,
      action: 'supersede',
      metadata: { oldExceptionId: req.params.exceptionId },
    });
    res.status(201).json({ supersession: result });
  } catch (error) {
    sendStudentAcademicError(res, error);
  }
});

internalRouter.post('/exceptions/:exceptionId/revoke', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.exceptionId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'STUDENT_ACADEMIC_VALIDATION_ERROR', message: 'exceptionId must be a valid UUID' } });
    }
    const result = await studentAcademicService.revokeAcademicException({ exceptionId: req.params.exceptionId });
    await auditMutation(req, {
      resourceType: 'academic_exception',
      resourceId: result.id,
      action: 'revoke',
    });
    res.status(200).json({ exception: result });
  } catch (error) {
    sendStudentAcademicError(res, error);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// B. STUDENT SELF-READ API
// ═════════════════════════════════════════════════════════════════════════════

const studentSelfRouter = Router();

studentSelfRouter.get('/academic-record', requireAuth, requireRole(['student']), async (req: Request, res: Response) => {
  try {
    const record = await studentAcademicService.getStudentAcademicRecordForUser(req.user!.id);
    res.json(projectStudentSafe(record));
  } catch (error) {
    sendStudentAcademicError(res, error);
  }
});

// ── Export ────────────────────────────────────────────────────────────────────

export { internalRouter as studentAcademicInternalRouter, studentSelfRouter };
export default internalRouter;
