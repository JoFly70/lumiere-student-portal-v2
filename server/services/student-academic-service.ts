/**
 * Student Academic Record Service — Business Rules + State Transitions
 *
 * Enforces the canonical Student Academic Record workflows:
 *   PROGRAM ASSIGNMENT → ACADEMIC SOURCE → CREDIT RECORD
 *   → VERIFICATION → CREDIT DECISION → EXCEPTION
 *
 * No hard-delete operations. Append-only tables are never updated or deleted.
 * Row locking and transactions protect concurrency invariants.
 */

import { db } from '../lib/db';
import * as repo from '../repositories/student-academic-repo';
import type { Tx } from '../repositories/student-academic-repo';
import {
  StudentAcademicError,
  notFoundError,
  validationError,
  invalidStateError,
  duplicateError,
  programRequiredError,
  verificationRequiredError,
  provenanceMismatchError,
} from '../lib/student-academic-errors';

// ── Types ────────────────────────────────────────────────────────────────────

type SourceStatus = 'received' | 'extracted' | 'verified' | 'rejected' | 'superseded';
type RecordStatus = 'extracted' | 'verified' | 'rejected' | 'needs_review' | 'superseded';
type VerificationAction = 'submitted' | 'verified' | 'rejected' | 'needs_review' | 'corrected' | 'superseded';
type DecisionAction = 'accepted' | 'rejected' | 'needs_review' | 'revoked';
type ExceptionType = 'requirement_waiver' | 'course_substitution' | 'credit_override' | 'level_override' | 'residency_override' | 'other';
type ExceptionStatus = 'active' | 'revoked' | 'superseded';

// ── Allowed source status transitions ────────────────────────────────────────

const SOURCE_TRANSITIONS: Record<SourceStatus, SourceStatus[]> = {
  received: ['extracted', 'rejected', 'superseded'],
  extracted: ['verified', 'rejected', 'superseded'],
  verified: ['superseded'],
  rejected: ['superseded'],
  superseded: [],
};

// ── Verification action → record status mapping ───────────────────────────────

const VERIFICATION_STATUS_MAP: Record<VerificationAction, RecordStatus> = {
  submitted: 'extracted',
  verified: 'verified',
  rejected: 'rejected',
  needs_review: 'needs_review',
  corrected: 'extracted',
  superseded: 'superseded',
};

// ── Return types ──────────────────────────────────────────────────────────────

export type AssignmentRow = NonNullable<Awaited<ReturnType<typeof repo.createAssignment>>>;
export type SourceRow = NonNullable<Awaited<ReturnType<typeof repo.createSource>>>;
export type CreditRecordRow = NonNullable<Awaited<ReturnType<typeof repo.createCreditRecord>>>;
export type VerificationEventRow = NonNullable<Awaited<ReturnType<typeof repo.appendVerificationEvent>>>;
export type DecisionRow = NonNullable<Awaited<ReturnType<typeof repo.appendDecision>>>;
export type ExceptionRow = NonNullable<Awaited<ReturnType<typeof repo.createException>>>;

export interface StudentAcademicRecord {
  student: NonNullable<Awaited<ReturnType<typeof repo.getStudent>>>;
  activeProgramAssignment: AssignmentRow | null;
  programVersion: Awaited<ReturnType<typeof repo.getProgramVersionWithProgram>> | null;
  academicSources: SourceRow[];
  creditRecords: CreditRecordRow[];
  latestVerifications: Record<string, VerificationEventRow>;
  latestDecisions: Record<string, DecisionRow>;
  activeExceptions: ExceptionRow[];
}

// ── Service factory ───────────────────────────────────────────────────────────

export interface StudentAcademicService {
  // Program Assignment
  assignProgram(input: { studentId: string; programVersionId: string; assignedBy?: string | null; cohortLabel?: string | null; reason?: string | null }): Promise<AssignmentRow>;
  switchProgramAssignment(input: { studentId: string; newProgramVersionId: string; assignedBy?: string | null; reason?: string | null }): Promise<{ oldAssignment: AssignmentRow; newAssignment: AssignmentRow }>;
  // Academic Sources
  createAcademicSource(input: { studentId: string; documentId?: string | null; sourceType: string; title: string; issuingInstitutionId?: string | null; issuingProviderId?: string | null; externalFileId?: string | null; sourceDate?: string | null; receivedAt?: Date | null; createdBy?: string | null }): Promise<SourceRow>;
  transitionAcademicSource(input: { sourceId: string; newStatus: SourceStatus; reason?: string | null }): Promise<SourceRow>;
  // Credit Records
  createCreditRecord(input: { sourceId: string; recordType?: string; sourceLineKey?: string | null; rawCourseCode?: string | null; rawTitle: string; rawCredits?: string | null; rawGrade?: string | null; rawLevel?: string | null; term?: string | null; completedOn?: string | null; institutionCourseVersionId?: string | null; providerCourseVersionId?: string | null; normalizedCredits?: string | null; normalizedLevel?: string | null; createdBy?: string | null }): Promise<CreditRecordRow>;
  correctCreditRecord(input: { creditRecordId: string; corrections: Partial<{ rawCourseCode: string | null; rawTitle: string; rawCredits: string | null; rawGrade: string | null; rawLevel: string | null; term: string | null; completedOn: string | null; institutionCourseVersionId: string | null; providerCourseVersionId: string | null; normalizedCredits: string | null; normalizedLevel: string | null }>; reviewerId?: string | null; rationale?: string | null }): Promise<CreditRecordRow>;
  // Verification
  recordCreditVerification(input: { creditRecordId: string; action: VerificationAction; reviewerId?: string | null; rationale?: string | null }): Promise<VerificationEventRow>;
  // Credit Decisions
  recordCreditDecision(input: { creditRecordId: string; programAssignmentId: string; action: DecisionAction; creditsAwarded?: string | null; levelAwarded?: string | null; equivalencyId?: string | null; targetInstitutionCourseVersionId?: string | null; basisClaimVersionId?: string | null; decidedBy?: string | null; rationale?: string | null }): Promise<DecisionRow>;
  // Exceptions
  createAcademicException(input: { studentId: string; programAssignmentId: string; exceptionType: ExceptionType; requirementId?: string | null; academicRuleId?: string | null; creditRecordId?: string | null; approvedBy?: string | null; rationale: string; effectiveFrom?: Date | null; effectiveTo?: Date | null }): Promise<ExceptionRow>;
  supersedeAcademicException(input: { oldExceptionId: string; exceptionType: ExceptionType; requirementId?: string | null; academicRuleId?: string | null; creditRecordId?: string | null; approvedBy?: string | null; rationale: string; effectiveFrom?: Date | null; effectiveTo?: Date | null }): Promise<{ oldException: ExceptionRow; newException: ExceptionRow }>;
  revokeAcademicException(input: { exceptionId: string }): Promise<ExceptionRow>;
  // Read Model
  getStudentAcademicRecord(studentId: string): Promise<StudentAcademicRecord>;
}

export function createStudentAcademicService(
  repository: typeof repo,
  transactionRunner: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>,
): StudentAcademicService {

  // ── Program Assignment ─────────────────────────────────────────────────────

  async function assignProgram(input: { studentId: string; programVersionId: string; assignedBy?: string | null; cohortLabel?: string | null; reason?: string | null }): Promise<AssignmentRow> {
    return await transactionRunner(async (tx: Tx) => {
      const student = await repository.getStudent(input.studentId, tx);
      if (!student) throw notFoundError('Student not found', { studentId: input.studentId });

      const pv = await repository.getProgramVersion(input.programVersionId, tx);
      if (!pv) throw notFoundError('Program version not found', { programVersionId: input.programVersionId });
      if (pv.status === 'draft') throw validationError('Draft program versions cannot be assigned', { programVersionId: input.programVersionId, status: pv.status });

      await repository.lockStudentRow(input.studentId, tx);

      const existing = await repository.getActiveAssignmentForStudent(input.studentId, tx);
      if (existing) throw duplicateError('Student already has an active program assignment', { studentId: input.studentId, existingAssignmentId: existing.id });

      return await repository.createAssignment({
        studentId: input.studentId,
        programVersionId: input.programVersionId,
        cohortLabel: input.cohortLabel ?? null,
        assignedBy: input.assignedBy ?? null,
        reason: input.reason ?? null,
      }, tx);
    });
  }

  async function switchProgramAssignment(input: { studentId: string; newProgramVersionId: string; assignedBy?: string | null; reason?: string | null }): Promise<{ oldAssignment: AssignmentRow; newAssignment: AssignmentRow }> {
    return await transactionRunner(async (tx: Tx) => {
      const student = await repository.getStudent(input.studentId, tx);
      if (!student) throw notFoundError('Student not found', { studentId: input.studentId });

      await repository.lockStudentRow(input.studentId, tx);

      const current = await repository.getActiveAssignmentForStudent(input.studentId, tx);
      if (!current) throw programRequiredError('Student has no active program assignment to switch from', { studentId: input.studentId });

      const newPv = await repository.getProgramVersion(input.newProgramVersionId, tx);
      if (!newPv) throw notFoundError('New program version not found', { programVersionId: input.newProgramVersionId });
      if (newPv.status === 'draft') throw validationError('Draft program versions cannot be assigned', { programVersionId: input.newProgramVersionId, status: newPv.status });
      if (input.newProgramVersionId === current.programVersionId) throw validationError('New program version must differ from current', { currentVersionId: current.programVersionId, newVersionId: input.newProgramVersionId });

      const oldAssignment = await repository.updateAssignmentStatus(current.id, 'superseded', new Date(), tx);
      const newAssignment = await repository.createAssignment({
        studentId: input.studentId,
        programVersionId: input.newProgramVersionId,
        assignedBy: input.assignedBy ?? null,
        reason: input.reason ?? null,
      }, tx);

      return { oldAssignment, newAssignment };
    });
  }

  // ── Academic Sources ───────────────────────────────────────────────────────

  async function createAcademicSource(input: { studentId: string; documentId?: string | null; sourceType: string; title: string; issuingInstitutionId?: string | null; issuingProviderId?: string | null; externalFileId?: string | null; sourceDate?: string | null; receivedAt?: Date | null; createdBy?: string | null }): Promise<SourceRow> {
    const student = await repository.getStudent(input.studentId);
    if (!student) throw notFoundError('Student not found', { studentId: input.studentId });

    if (input.documentId) {
      const doc = await repository.getDocumentOwnership(input.documentId);
      if (!doc) throw notFoundError('Document not found', { documentId: input.documentId });
      if (doc.userId !== student.user_id) throw validationError('Document does not belong to this student', { documentId: input.documentId, studentUserId: student.user_id });
    }

    if (input.issuingInstitutionId) {
      const inst = await repository.getInstitution(input.issuingInstitutionId);
      if (!inst) throw notFoundError('Issuing institution not found', { issuingInstitutionId: input.issuingInstitutionId });
    }

    if (input.issuingProviderId) {
      const provider = await repository.getCreditProvider(input.issuingProviderId);
      if (!provider) throw notFoundError('Issuing credit provider not found', { issuingProviderId: input.issuingProviderId });
    }

    return await repository.createSource({
      studentId: input.studentId,
      documentId: input.documentId ?? null,
      sourceType: input.sourceType as SourceRow['sourceType'],
      title: input.title,
      issuingInstitutionId: input.issuingInstitutionId ?? null,
      issuingProviderId: input.issuingProviderId ?? null,
      externalFileId: input.externalFileId ?? null,
      sourceDate: input.sourceDate ?? null,
      receivedAt: input.receivedAt ?? null,
      createdBy: input.createdBy ?? null,
    });
  }

  async function transitionAcademicSource(input: { sourceId: string; newStatus: SourceStatus; reason?: string | null }): Promise<SourceRow> {
    const source = await repository.getSource(input.sourceId);
    if (!source) throw notFoundError('Academic source not found', { sourceId: input.sourceId });

    const allowed = SOURCE_TRANSITIONS[source.status as SourceStatus];
    if (!allowed || !allowed.includes(input.newStatus)) {
      throw invalidStateError(`Cannot transition source from ${source.status} to ${input.newStatus}`, { sourceId: input.sourceId, currentStatus: source.status, attemptedStatus: input.newStatus });
    }

    return await repository.updateSourceStatus(input.sourceId, input.newStatus);
  }

  // ── Credit Records ──────────────────────────────────────────────────────────

  async function createCreditRecord(input: { sourceId: string; recordType?: string; sourceLineKey?: string | null; rawCourseCode?: string | null; rawTitle: string; rawCredits?: string | null; rawGrade?: string | null; rawLevel?: string | null; term?: string | null; completedOn?: string | null; institutionCourseVersionId?: string | null; providerCourseVersionId?: string | null; normalizedCredits?: string | null; normalizedLevel?: string | null; createdBy?: string | null }): Promise<CreditRecordRow> {
    const source = await repository.getSource(input.sourceId);
    if (!source) throw notFoundError('Academic source not found', { sourceId: input.sourceId });

    if (input.institutionCourseVersionId) {
      const icv = await repository.getInstitutionCourseVersion(input.institutionCourseVersionId);
      if (!icv) throw notFoundError('Institution course version not found', { institutionCourseVersionId: input.institutionCourseVersionId });
    }

    if (input.providerCourseVersionId) {
      const pcv = await repository.getProviderCourseVersion(input.providerCourseVersionId);
      if (!pcv) throw notFoundError('Provider course version not found', { providerCourseVersionId: input.providerCourseVersionId });
    }

    // studentId is always derived server-side from the source
    return await repository.createCreditRecord({
      studentId: source.studentId,
      sourceId: input.sourceId,
      recordType: (input.recordType as CreditRecordRow['recordType']) ?? 'course',
      sourceLineKey: input.sourceLineKey ?? null,
      rawCourseCode: input.rawCourseCode ?? null,
      rawTitle: input.rawTitle,
      rawCredits: input.rawCredits ?? null,
      rawGrade: input.rawGrade ?? null,
      rawLevel: input.rawLevel ?? null,
      term: input.term ?? null,
      completedOn: input.completedOn ?? null,
      institutionCourseVersionId: input.institutionCourseVersionId ?? null,
      providerCourseVersionId: input.providerCourseVersionId ?? null,
      normalizedCredits: input.normalizedCredits ?? null,
      normalizedLevel: input.normalizedLevel ?? null,
      createdBy: input.createdBy ?? null,
    });
  }

  async function correctCreditRecord(input: { creditRecordId: string; corrections: Partial<{ rawCourseCode: string | null; rawTitle: string; rawCredits: string | null; rawGrade: string | null; rawLevel: string | null; term: string | null; completedOn: string | null; institutionCourseVersionId: string | null; providerCourseVersionId: string | null; normalizedCredits: string | null; normalizedLevel: string | null }>; reviewerId?: string | null; rationale?: string | null }): Promise<CreditRecordRow> {
    return await transactionRunner(async (tx: Tx) => {
      await repository.lockCreditRecordRow(input.creditRecordId, tx);
      const record = await repository.getCreditRecord(input.creditRecordId, tx);
      if (!record) throw notFoundError('Credit record not found', { creditRecordId: input.creditRecordId });
      if (record.status === 'superseded') throw invalidStateError('Superseded credit records cannot be corrected', { creditRecordId: input.creditRecordId });

      // Check if any accepted decision exists for ANY program assignment
      const assignment = await repository.getActiveAssignmentForStudent(record.studentId, tx);
      if (assignment) {
        const latestDecision = await repository.getLatestDecision(input.creditRecordId, assignment.id, tx);
        if (latestDecision && latestDecision.action === 'accepted') {
          throw invalidStateError('Cannot correct a credit record with an active accepted decision; revoke the decision first', { creditRecordId: input.creditRecordId, decisionId: latestDecision.id });
        }
      }

      const updated = await repository.updateCreditRecord(input.creditRecordId, {
        ...input.corrections,
        status: 'extracted',
      }, tx);

      // Append verification event = corrected with server-generated snapshot
      await repository.appendVerificationEvent({
        creditRecordId: input.creditRecordId,
        action: 'corrected',
        reviewerId: input.reviewerId ?? null,
        rationale: input.rationale ?? null,
        snapshot: updated as unknown as Record<string, unknown>,
      }, tx);

      return updated;
    });
  }

  // ── Verification ────────────────────────────────────────────────────────────

  async function recordCreditVerification(input: { creditRecordId: string; action: VerificationAction; reviewerId?: string | null; rationale?: string | null }): Promise<VerificationEventRow> {
    return await transactionRunner(async (tx: Tx) => {
      await repository.lockCreditRecordRow(input.creditRecordId, tx);
      const record = await repository.getCreditRecord(input.creditRecordId, tx);
      if (!record) throw notFoundError('Credit record not found', { creditRecordId: input.creditRecordId });
      if (record.status === 'superseded') throw invalidStateError('Superseded credit records cannot be verified', { creditRecordId: input.creditRecordId });

      // If an accepted decision is effective, block verification that would invalidate the verified record
      const assignment = await repository.getActiveAssignmentForStudent(record.studentId, tx);
      if (assignment) {
        const latestDecision = await repository.getLatestDecision(input.creditRecordId, assignment.id, tx);
        if (latestDecision && latestDecision.action === 'accepted') {
          throw invalidStateError('Cannot verify a credit record with an active accepted decision; revoke the decision first', { creditRecordId: input.creditRecordId, decisionId: latestDecision.id });
        }
      }

      const newStatus = VERIFICATION_STATUS_MAP[input.action];

      // Update record status
      await repository.updateCreditRecord(input.creditRecordId, { status: newStatus }, tx);

      // Append verification event with server-generated snapshot
      const updatedRecord = await repository.getCreditRecord(input.creditRecordId, tx);
      return await repository.appendVerificationEvent({
        creditRecordId: input.creditRecordId,
        action: input.action,
        reviewerId: input.reviewerId ?? null,
        rationale: input.rationale ?? null,
        snapshot: updatedRecord as unknown as Record<string, unknown>,
      }, tx);
    });
  }

  // ── Credit Decisions ─────────────────────────────────────────────────────────

  async function recordCreditDecision(input: { creditRecordId: string; programAssignmentId: string; action: DecisionAction; creditsAwarded?: string | null; levelAwarded?: string | null; equivalencyId?: string | null; targetInstitutionCourseVersionId?: string | null; basisClaimVersionId?: string | null; decidedBy?: string | null; rationale?: string | null }): Promise<DecisionRow> {
    return await transactionRunner(async (tx: Tx) => {
      await repository.lockCreditRecordRow(input.creditRecordId, tx);

      const record = await repository.getCreditRecord(input.creditRecordId, tx);
      if (!record) throw notFoundError('Credit record not found', { creditRecordId: input.creditRecordId });

      const assignment = await repository.getAssignment(input.programAssignmentId, tx);
      if (!assignment) throw notFoundError('Program assignment not found', { programAssignmentId: input.programAssignmentId });

      // Assignment and credit record must belong to same student
      if (assignment.studentId !== record.studentId) {
        throw provenanceMismatchError('Program assignment and credit record belong to different students', { assignmentStudentId: assignment.studentId, recordStudentId: record.studentId });
      }

      // Assignment must be active
      if (assignment.status !== 'active') {
        throw invalidStateError('Program assignment must be active', { programAssignmentId: input.programAssignmentId, status: assignment.status });
      }

      const latestDecision = await repository.getLatestDecision(input.creditRecordId, input.programAssignmentId, tx);

      if (input.action === 'accepted') {
        // Credit record status must be verified
        if (record.status !== 'verified') {
          throw verificationRequiredError('Credit record must be verified before acceptance', { creditRecordId: input.creditRecordId, status: record.status });
        }
        // Latest verification action must be verified
        const latestV = await repository.getLatestVerificationEvent(input.creditRecordId, tx);
        if (!latestV || latestV.action !== 'verified') {
          throw verificationRequiredError('Latest verification must be "verified" before acceptance', { creditRecordId: input.creditRecordId, latestAction: latestV?.action ?? 'none' });
        }
        // creditsAwarded > 0
        if (!input.creditsAwarded || parseFloat(input.creditsAwarded) <= 0) {
          throw validationError('Accepted decisions require creditsAwarded > 0', { creditsAwarded: input.creditsAwarded });
        }
        // Cannot accept again if latest decision is already accepted
        if (latestDecision && latestDecision.action === 'accepted') {
          throw duplicateError('Latest decision for this record+assignment is already accepted; revoke first', { creditRecordId: input.creditRecordId, programAssignmentId: input.programAssignmentId, decisionId: latestDecision.id });
        }
      }

      if (input.action === 'rejected' || input.action === 'needs_review') {
        // Credit record status must be verified
        if (record.status !== 'verified') {
          throw verificationRequiredError('Credit record must be verified before a decision', { creditRecordId: input.creditRecordId, status: record.status });
        }
        const latestV = await repository.getLatestVerificationEvent(input.creditRecordId, tx);
        if (!latestV || latestV.action !== 'verified') {
          throw verificationRequiredError('Latest verification must be "verified" before a decision', { creditRecordId: input.creditRecordId, latestAction: latestV?.action ?? 'none' });
        }
        // creditsAwarded must be null/zero
        if (input.creditsAwarded && parseFloat(input.creditsAwarded) > 0) {
          throw validationError(`${input.action} decisions must not have positive creditsAwarded`, { creditsAwarded: input.creditsAwarded });
        }
      }

      if (input.action === 'revoked') {
        if (!latestDecision) throw invalidStateError('No prior decision to revoke', { creditRecordId: input.creditRecordId, programAssignmentId: input.programAssignmentId });
        if (latestDecision.action === 'revoked') throw invalidStateError('Latest decision is already revoked', { decisionId: latestDecision.id });
        if (input.creditsAwarded && parseFloat(input.creditsAwarded) > 0) {
          throw validationError('Revoked decisions must not have positive creditsAwarded', { creditsAwarded: input.creditsAwarded });
        }
      }

      // Validate provenance for ALL actions when provenance fields are supplied
      await validateProvenance(input, assignment, tx);

      return await repository.appendDecision({
        creditRecordId: input.creditRecordId,
        programAssignmentId: input.programAssignmentId,
        action: input.action,
        creditsAwarded: input.creditsAwarded ?? null,
        levelAwarded: input.levelAwarded ?? null,
        equivalencyId: input.equivalencyId ?? null,
        targetInstitutionCourseVersionId: input.targetInstitutionCourseVersionId ?? null,
        basisClaimVersionId: input.basisClaimVersionId ?? null,
        decidedBy: input.decidedBy ?? null,
        rationale: input.rationale ?? null,
      }, tx);
    });
  }

  // ── Provenance validation ────────────────────────────────────────────────────

  async function validateProvenance(input: { equivalencyId?: string | null; targetInstitutionCourseVersionId?: string | null; basisClaimVersionId?: string | null }, assignment: AssignmentRow, tx: Tx): Promise<void> {
    const pvWithProgram = await repository.getProgramVersionWithProgram(assignment.programVersionId, tx);
    if (!pvWithProgram) throw notFoundError('Program version not found', { programVersionId: assignment.programVersionId });
    const assignmentInstitutionId = pvWithProgram.institution.id;

    if (input.equivalencyId) {
      const equiv = await repository.getEquivalency(input.equivalencyId, tx);
      if (!equiv) throw notFoundError('Equivalency not found', { equivalencyId: input.equivalencyId });
      if (equiv.institutionId !== assignmentInstitutionId) {
        throw provenanceMismatchError('Equivalency institution does not match assigned program institution', { equivalencyInstitutionId: equiv.institutionId, assignmentInstitutionId });
      }
    }

    if (input.targetInstitutionCourseVersionId) {
      const icv = await repository.getInstitutionCourseVersion(input.targetInstitutionCourseVersionId, tx);
      if (!icv) throw notFoundError('Institution course version not found', { targetInstitutionCourseVersionId: input.targetInstitutionCourseVersionId });
      if (icv.institution.id !== assignmentInstitutionId) {
        throw provenanceMismatchError('Target institution course version does not belong to the assigned program institution', { courseInstitutionId: icv.institution.id, assignmentInstitutionId });
      }
    }

    if (input.basisClaimVersionId) {
      const cv = await repository.getClaimVersion(input.basisClaimVersionId, tx);
      if (!cv) throw notFoundError('Claim version not found', { basisClaimVersionId: input.basisClaimVersionId });
      if (cv.status !== 'confirmed') {
        throw provenanceMismatchError('Claim version must be confirmed', { claimVersionId: input.basisClaimVersionId, status: cv.status });
      }
      const claim = await repository.getClaim(cv.claimId, tx);
      if (!claim) throw notFoundError('Parent claim not found', { claimId: cv.claimId });
      if (claim.currentVersionId !== input.basisClaimVersionId) {
        throw provenanceMismatchError('Claim version must be the current version of its parent claim', { claimVersionId: input.basisClaimVersionId, currentVersionId: claim.currentVersionId });
      }
    }
  }

  // ── Exceptions ──────────────────────────────────────────────────────────────

  async function validateExceptionTargets(input: { studentId: string; programAssignmentId: string; exceptionType: ExceptionType; requirementId?: string | null; academicRuleId?: string | null; creditRecordId?: string | null }, assignment: AssignmentRow, tx?: Tx): Promise<void> {
    if (input.creditRecordId) {
      const record = await repository.getCreditRecord(input.creditRecordId, tx);
      if (!record) throw notFoundError('Credit record not found', { creditRecordId: input.creditRecordId });
      if (record.studentId !== input.studentId) throw validationError('Credit record does not belong to this student', { recordStudentId: record.studentId, studentId: input.studentId });
    }

    if (input.requirementId) {
      const reqPv = await repository.getRequirementWithProgramVersion(input.requirementId, tx);
      if (!reqPv) throw notFoundError('Requirement not found', { requirementId: input.requirementId });
      if (reqPv.programVersion.id !== assignment.programVersionId) {
        throw provenanceMismatchError('Requirement does not belong to the assigned program version', { requirementProgramVersionId: reqPv.programVersion.id, assignmentProgramVersionId: assignment.programVersionId });
      }
    }

    if (input.academicRuleId) {
      const rulePv = await repository.getAcademicRuleWithProgramVersion(input.academicRuleId, tx);
      if (!rulePv) throw notFoundError('Academic rule not found', { academicRuleId: input.academicRuleId });
      const pvWithProgram = await repository.getProgramVersionWithProgram(assignment.programVersionId, tx);
      if (!pvWithProgram) throw notFoundError('Program version not found', { programVersionId: assignment.programVersionId });
      // If rule has a programVersionId, it MUST match the assignment's programVersionId
      if (rulePv.programVersion) {
        if (rulePv.programVersion.id !== assignment.programVersionId) {
          throw provenanceMismatchError('Academic rule belongs to a different program version', { ruleProgramVersionId: rulePv.programVersion.id, assignmentProgramVersionId: assignment.programVersionId });
        }
      } else {
        // Institution-wide rule: institutionId MUST match the assigned program's institution
        if (rulePv.rule.institutionId !== pvWithProgram.institution.id) {
          throw provenanceMismatchError('Institution-wide academic rule belongs to a different institution', { ruleInstitutionId: rulePv.rule.institutionId, assignmentInstitutionId: pvWithProgram.institution.id });
        }
      }
    }

    // For non-"other" exceptions, require at least one meaningful target
    if (input.exceptionType !== 'other' && !input.requirementId && !input.academicRuleId && !input.creditRecordId) {
      throw validationError('Non-"other" exceptions require at least one target: requirementId, academicRuleId, or creditRecordId', { exceptionType: input.exceptionType });
    }
  }

  async function createAcademicException(input: { studentId: string; programAssignmentId: string; exceptionType: ExceptionType; requirementId?: string | null; academicRuleId?: string | null; creditRecordId?: string | null; approvedBy?: string | null; rationale: string; effectiveFrom?: Date | null; effectiveTo?: Date | null }): Promise<ExceptionRow> {
    const assignment = await repository.getAssignment(input.programAssignmentId);
    if (!assignment) throw notFoundError('Program assignment not found', { programAssignmentId: input.programAssignmentId });
    if (assignment.status !== 'active') throw invalidStateError('Program assignment must be active', { programAssignmentId: input.programAssignmentId, status: assignment.status });
    if (assignment.studentId !== input.studentId) throw validationError('Assignment does not belong to this student', { assignmentStudentId: assignment.studentId, studentId: input.studentId });

    await validateExceptionTargets(input, assignment);

    return await repository.createException({
      studentId: input.studentId,
      programAssignmentId: input.programAssignmentId,
      exceptionType: input.exceptionType,
      requirementId: input.requirementId ?? null,
      academicRuleId: input.academicRuleId ?? null,
      creditRecordId: input.creditRecordId ?? null,
      approvedBy: input.approvedBy ?? null,
      rationale: input.rationale,
      effectiveFrom: input.effectiveFrom ?? null,
      effectiveTo: input.effectiveTo ?? null,
    });
  }

  async function supersedeAcademicException(input: { oldExceptionId: string; exceptionType: ExceptionType; requirementId?: string | null; academicRuleId?: string | null; creditRecordId?: string | null; approvedBy?: string | null; rationale: string; effectiveFrom?: Date | null; effectiveTo?: Date | null }): Promise<{ oldException: ExceptionRow; newException: ExceptionRow }> {
    return await transactionRunner(async (tx: Tx) => {
      await repository.lockExceptionRow(input.oldExceptionId, tx);
      const oldException = await repository.getException(input.oldExceptionId, tx);
      if (!oldException) throw notFoundError('Exception not found', { exceptionId: input.oldExceptionId });
      if (oldException.status !== 'active') throw invalidStateError('Only active exceptions can be superseded', { exceptionId: input.oldExceptionId, status: oldException.status });

      const assignment = await repository.getAssignment(oldException.programAssignmentId, tx);
      if (!assignment) throw notFoundError('Program assignment not found', { programAssignmentId: oldException.programAssignmentId });

      // Validate replacement targets BEFORE changing the old exception
      await validateExceptionTargets({
        studentId: oldException.studentId,
        programAssignmentId: oldException.programAssignmentId,
        exceptionType: input.exceptionType,
        requirementId: input.requirementId ?? null,
        academicRuleId: input.academicRuleId ?? null,
        creditRecordId: input.creditRecordId ?? null,
      }, assignment, tx);

      const updated = await repository.updateExceptionStatus(input.oldExceptionId, 'superseded', tx);
      const newException = await repository.createException({
        studentId: oldException.studentId,
        programAssignmentId: oldException.programAssignmentId,
        exceptionType: input.exceptionType,
        requirementId: input.requirementId ?? null,
        academicRuleId: input.academicRuleId ?? null,
        creditRecordId: input.creditRecordId ?? null,
        supersedesExceptionId: input.oldExceptionId,
        approvedBy: input.approvedBy ?? null,
        rationale: input.rationale,
        effectiveFrom: input.effectiveFrom ?? null,
        effectiveTo: input.effectiveTo ?? null,
      }, tx);

      return { oldException: updated, newException };
    });
  }

  async function revokeAcademicException(input: { exceptionId: string }): Promise<ExceptionRow> {
    return await transactionRunner(async (tx: Tx) => {
      await repository.lockExceptionRow(input.exceptionId, tx);
      const exception = await repository.getException(input.exceptionId, tx);
      if (!exception) throw notFoundError('Exception not found', { exceptionId: input.exceptionId });
      if (exception.status !== 'active') throw invalidStateError('Only active exceptions can be revoked', { exceptionId: input.exceptionId, status: exception.status });
      return await repository.updateExceptionStatus(input.exceptionId, 'revoked', tx);
    });
  }

  // ── Read Model ──────────────────────────────────────────────────────────────

  async function getStudentAcademicRecord(studentId: string): Promise<StudentAcademicRecord> {
    const student = await repository.getStudent(studentId);
    if (!student) throw notFoundError('Student not found', { studentId });

    const activeProgramAssignment = await repository.getActiveAssignmentForStudent(studentId);
    let programVersion: Awaited<ReturnType<typeof repo.getProgramVersionWithProgram>> | null = null;
    if (activeProgramAssignment) {
      programVersion = await repository.getProgramVersionWithProgram(activeProgramAssignment.programVersionId);
    }

    const academicSources = await repository.listSourcesForStudent(studentId);
    const creditRecords = await repository.listCreditRecordsByStudent(studentId);

    // Batch reads: latest verification + latest decision per credit record
    const creditRecordIds = creditRecords.map(cr => cr.id);
    const latestVerifications = await repository.getLatestVerificationEventsBatch(creditRecordIds);

    let latestDecisions: Record<string, DecisionRow> = {};
    if (activeProgramAssignment) {
      latestDecisions = await repository.getLatestDecisionsBatch(creditRecordIds, activeProgramAssignment.id);
    }

    const activeExceptions = await repository.listActiveExceptionsForStudent(studentId);

    return {
      student,
      activeProgramAssignment,
      programVersion,
      academicSources,
      creditRecords,
      latestVerifications,
      latestDecisions,
      activeExceptions,
    };
  }

  return {
    assignProgram,
    switchProgramAssignment,
    createAcademicSource,
    transitionAcademicSource,
    createCreditRecord,
    correctCreditRecord,
    recordCreditVerification,
    recordCreditDecision,
    createAcademicException,
    supersedeAcademicException,
    revokeAcademicException,
    getStudentAcademicRecord,
  };
}

// ── Default service instance ──────────────────────────────────────────────────

export const studentAcademicService = createStudentAcademicService(repo, async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
  return await db.transaction(fn);
});
