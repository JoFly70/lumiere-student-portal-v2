/**
 * Student Academic Record Repository — Data Access Layer
 *
 * Typed CRUD operations for the six Phase 2A Student Academic Record tables.
 * No business rules, no canonicalization decisions, no hard-delete.
 * Append-only tables (verification_events, decisions) support INSERT and SELECT only.
 */

import { db } from '../lib/db';
import {
  studentProgramAssignments,
  studentAcademicSources,
  studentCreditRecords,
  studentCreditVerificationEvents,
  studentCreditDecisions,
  studentAcademicExceptions,
} from '@shared/student-academic-schema';
import {
  studentsTable,
  documents,
} from '@shared/schema';
import {
  programVersions,
  programsV2,
  institutions,
  institutionCourses,
  institutionCourseVersions,
  creditProviders,
  providerCourseVersions,
  equivalenciesV2,
  claimVersions,
  knowledgeClaims,
  requirementsV2,
  academicRules,
} from '@shared/knowledge-schema';
import { eq, and, desc, sql, isNull, inArray } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';

export type Tx = PgTransaction<any, any, any> | typeof db;

export type VerificationEventRow = NonNullable<Awaited<ReturnType<typeof appendVerificationEvent>>>;
export type DecisionRow = NonNullable<Awaited<ReturnType<typeof appendDecision>>>;

// ── Program Assignments ─────────────────────────────────────────────────────

export async function getStudent(studentId: string, tx: Tx = db) {
  const [row] = await tx.select().from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
  return row ?? null;
}

export async function getStudentByUserId(userId: string, tx: Tx = db) {
  const [row] = await tx.select().from(studentsTable).where(eq(studentsTable.user_id, userId)).limit(1);
  return row ?? null;
}

export async function getProgramVersion(programVersionId: string, tx: Tx = db) {
  const [row] = await tx.select().from(programVersions).where(eq(programVersions.id, programVersionId)).limit(1);
  return row ?? null;
}

export async function getProgramVersionWithProgram(programVersionId: string, tx: Tx = db) {
  const rows = await tx
    .select({
      version: programVersions,
      program: programsV2,
      institution: institutions,
    })
    .from(programVersions)
    .innerJoin(programsV2, eq(programVersions.programId, programsV2.id))
    .innerJoin(institutions, eq(programsV2.institutionId, institutions.id))
    .where(eq(programVersions.id, programVersionId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAssignment(assignmentId: string, tx: Tx = db) {
  const [row] = await tx.select().from(studentProgramAssignments).where(eq(studentProgramAssignments.id, assignmentId)).limit(1);
  return row ?? null;
}

export async function getActiveAssignmentForStudent(studentId: string, tx: Tx = db) {
  const [row] = await tx.select().from(studentProgramAssignments)
    .where(and(eq(studentProgramAssignments.studentId, studentId), eq(studentProgramAssignments.status, 'active')))
    .limit(1);
  return row ?? null;
}

export async function listAssignments(studentId: string, tx: Tx = db) {
  return await tx.select().from(studentProgramAssignments)
    .where(eq(studentProgramAssignments.studentId, studentId))
    .orderBy(desc(studentProgramAssignments.assignedAt));
}

export async function createAssignment(input: {
  studentId: string;
  programVersionId: string;
  cohortLabel?: string | null;
  assignedBy?: string | null;
  reason?: string | null;
}, tx: Tx = db) {
  const [row] = await tx.insert(studentProgramAssignments).values({
    studentId: input.studentId,
    programVersionId: input.programVersionId,
    status: 'active',
    cohortLabel: input.cohortLabel ?? null,
    assignedBy: input.assignedBy ?? null,
    reason: input.reason ?? null,
  }).returning();
  return row;
}

export async function updateAssignmentStatus(assignmentId: string, status: 'active' | 'completed' | 'withdrawn' | 'superseded', endedAt?: Date | null, tx: Tx = db) {
  const set: Record<string, unknown> = { status, updatedAt: new Date() };
  if (endedAt !== undefined) set.endedAt = endedAt;
  const [row] = await tx.update(studentProgramAssignments).set(set).where(eq(studentProgramAssignments.id, assignmentId)).returning();
  return row;
}

export async function lockStudentRow(studentId: string, tx: Tx = db): Promise<void> {
  await tx.execute(sql`SELECT id FROM students WHERE id = ${studentId} FOR UPDATE`);
}

export async function lockAssignmentRow(assignmentId: string, tx: Tx = db): Promise<void> {
  await tx.execute(sql`SELECT id FROM student_program_assignments WHERE id = ${assignmentId} FOR UPDATE`);
}

// ── Academic Sources ────────────────────────────────────────────────────────

export async function createSource(input: {
  studentId: string;
  documentId?: string | null;
  sourceType: 'transcript' | 'credential_evaluation' | 'provider_record' | 'exam_score' | 'institution_record' | 'manual' | 'other';
  title: string;
  issuingInstitutionId?: string | null;
  issuingProviderId?: string | null;
  externalFileId?: string | null;
  sourceDate?: string | null;
  receivedAt?: Date | null;
  createdBy?: string | null;
}, tx: Tx = db) {
  const [row] = await tx.insert(studentAcademicSources).values({
    studentId: input.studentId,
    documentId: input.documentId ?? null,
    sourceType: input.sourceType,
    title: input.title,
    issuingInstitutionId: input.issuingInstitutionId ?? null,
    issuingProviderId: input.issuingProviderId ?? null,
    externalFileId: input.externalFileId ?? null,
    sourceDate: input.sourceDate ?? null,
    receivedAt: input.receivedAt ?? null,
    createdBy: input.createdBy ?? null,
  }).returning();
  return row;
}

export async function getSource(sourceId: string, tx: Tx = db) {
  const [row] = await tx.select().from(studentAcademicSources).where(eq(studentAcademicSources.id, sourceId)).limit(1);
  return row ?? null;
}

export async function listSourcesForStudent(studentId: string, tx: Tx = db) {
  return await tx.select().from(studentAcademicSources)
    .where(eq(studentAcademicSources.studentId, studentId))
    .orderBy(desc(studentAcademicSources.createdAt));
}

export async function updateSourceStatus(sourceId: string, status: 'received' | 'extracted' | 'verified' | 'rejected' | 'superseded', tx: Tx = db) {
  const [row] = await tx.update(studentAcademicSources).set({ status, updatedAt: new Date() }).where(eq(studentAcademicSources.id, sourceId)).returning();
  return row;
}

export async function getDocumentOwnership(documentId: string, tx: Tx = db) {
  const [row] = await tx.select({ userId: documents.userId }).from(documents).where(eq(documents.id, documentId)).limit(1);
  return row ?? null;
}

// ── Credit Records ───────────────────────────────────────────────────────────

export async function createCreditRecord(input: {
  studentId: string;
  sourceId: string;
  recordType?: 'course' | 'exam' | 'credential_award' | 'other';
  sourceLineKey?: string | null;
  rawCourseCode?: string | null;
  rawTitle: string;
  rawCredits?: string | null;
  rawGrade?: string | null;
  rawLevel?: string | null;
  term?: string | null;
  completedOn?: string | null;
  institutionCourseVersionId?: string | null;
  providerCourseVersionId?: string | null;
  normalizedCredits?: string | null;
  normalizedLevel?: string | null;
  createdBy?: string | null;
}, tx: Tx = db) {
  const [row] = await tx.insert(studentCreditRecords).values({
    studentId: input.studentId,
    sourceId: input.sourceId,
    recordType: input.recordType ?? 'course',
    status: 'extracted',
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
  }).returning();
  return row;
}

export async function getCreditRecord(creditRecordId: string, tx: Tx = db) {
  const [row] = await tx.select().from(studentCreditRecords).where(eq(studentCreditRecords.id, creditRecordId)).limit(1);
  return row ?? null;
}

export async function listCreditRecordsByStudent(studentId: string, tx: Tx = db) {
  return await tx.select().from(studentCreditRecords)
    .where(eq(studentCreditRecords.studentId, studentId))
    .orderBy(desc(studentCreditRecords.createdAt));
}

export async function listCreditRecordsBySource(sourceId: string, tx: Tx = db) {
  return await tx.select().from(studentCreditRecords)
    .where(eq(studentCreditRecords.sourceId, sourceId))
    .orderBy(desc(studentCreditRecords.createdAt));
}

export async function updateCreditRecord(creditRecordId: string, set: {
  rawCourseCode?: string | null;
  rawTitle?: string;
  rawCredits?: string | null;
  rawGrade?: string | null;
  rawLevel?: string | null;
  term?: string | null;
  completedOn?: string | null;
  institutionCourseVersionId?: string | null;
  providerCourseVersionId?: string | null;
  normalizedCredits?: string | null;
  normalizedLevel?: string | null;
  status?: 'extracted' | 'verified' | 'rejected' | 'needs_review' | 'superseded';
}, tx: Tx = db) {
  const [row] = await tx.update(studentCreditRecords).set({ ...set, updatedAt: new Date() }).where(eq(studentCreditRecords.id, creditRecordId)).returning();
  return row;
}

export async function lockCreditRecordRow(creditRecordId: string, tx: Tx = db): Promise<void> {
  await tx.execute(sql`SELECT id FROM student_credit_records WHERE id = ${creditRecordId} FOR UPDATE`);
}

// ── Verification Events (append-only) ────────────────────────────────────────

export async function appendVerificationEvent(input: {
  creditRecordId: string;
  action: 'submitted' | 'verified' | 'rejected' | 'needs_review' | 'corrected' | 'superseded';
  reviewerId?: string | null;
  rationale?: string | null;
  snapshot?: Record<string, unknown>;
}, tx: Tx = db) {
  const [row] = await tx.insert(studentCreditVerificationEvents).values({
    creditRecordId: input.creditRecordId,
    action: input.action,
    reviewerId: input.reviewerId ?? null,
    rationale: input.rationale ?? null,
    snapshot: input.snapshot ?? {},
  }).returning();
  return row;
}

export async function listVerificationEvents(creditRecordId: string, tx: Tx = db) {
  return await tx.select().from(studentCreditVerificationEvents)
    .where(eq(studentCreditVerificationEvents.creditRecordId, creditRecordId))
    .orderBy(desc(studentCreditVerificationEvents.seq));
}

export async function getLatestVerificationEvent(creditRecordId: string, tx: Tx = db) {
  const [row] = await tx.select().from(studentCreditVerificationEvents)
    .where(eq(studentCreditVerificationEvents.creditRecordId, creditRecordId))
    .orderBy(desc(studentCreditVerificationEvents.seq))
    .limit(1);
  return row ?? null;
}

// ── Credit Decisions (append-only) ───────────────────────────────────────────

export async function appendDecision(input: {
  creditRecordId: string;
  programAssignmentId: string;
  action: 'accepted' | 'rejected' | 'needs_review' | 'revoked';
  creditsAwarded?: string | null;
  levelAwarded?: string | null;
  equivalencyId?: string | null;
  targetInstitutionCourseVersionId?: string | null;
  basisClaimVersionId?: string | null;
  decidedBy?: string | null;
  rationale?: string | null;
  metadata?: Record<string, unknown>;
}, tx: Tx = db) {
  const [row] = await tx.insert(studentCreditDecisions).values({
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
    metadata: input.metadata ?? {},
  }).returning();
  return row;
}

export async function listDecisions(creditRecordId: string, programAssignmentId: string, tx: Tx = db) {
  return await tx.select().from(studentCreditDecisions)
    .where(and(
      eq(studentCreditDecisions.creditRecordId, creditRecordId),
      eq(studentCreditDecisions.programAssignmentId, programAssignmentId),
    ))
    .orderBy(desc(studentCreditDecisions.seq));
}

export async function getLatestDecision(creditRecordId: string, programAssignmentId: string, tx: Tx = db) {
  const [row] = await tx.select().from(studentCreditDecisions)
    .where(and(
      eq(studentCreditDecisions.creditRecordId, creditRecordId),
      eq(studentCreditDecisions.programAssignmentId, programAssignmentId),
    ))
    .orderBy(desc(studentCreditDecisions.seq))
    .limit(1);
  return row ?? null;
}

// ── Exceptions ───────────────────────────────────────────────────────────────

export async function createException(input: {
  studentId: string;
  programAssignmentId: string;
  exceptionType: 'requirement_waiver' | 'course_substitution' | 'credit_override' | 'level_override' | 'residency_override' | 'other';
  requirementId?: string | null;
  academicRuleId?: string | null;
  creditRecordId?: string | null;
  supersedesExceptionId?: string | null;
  approvedBy?: string | null;
  rationale: string;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
}, tx: Tx = db) {
  const [row] = await tx.insert(studentAcademicExceptions).values({
    studentId: input.studentId,
    programAssignmentId: input.programAssignmentId,
    exceptionType: input.exceptionType,
    status: 'active',
    requirementId: input.requirementId ?? null,
    academicRuleId: input.academicRuleId ?? null,
    creditRecordId: input.creditRecordId ?? null,
    supersedesExceptionId: input.supersedesExceptionId ?? null,
    approvedBy: input.approvedBy ?? null,
    rationale: input.rationale,
    effectiveFrom: input.effectiveFrom ?? null,
    effectiveTo: input.effectiveTo ?? null,
  }).returning();
  return row;
}

export async function getException(exceptionId: string, tx: Tx = db) {
  const [row] = await tx.select().from(studentAcademicExceptions).where(eq(studentAcademicExceptions.id, exceptionId)).limit(1);
  return row ?? null;
}

export async function listActiveExceptionsForStudent(studentId: string, tx: Tx = db) {
  return await tx.select().from(studentAcademicExceptions)
    .where(and(eq(studentAcademicExceptions.studentId, studentId), eq(studentAcademicExceptions.status, 'active')));
}

export async function listActiveExceptionsForAssignment(programAssignmentId: string, tx: Tx = db) {
  return await tx.select().from(studentAcademicExceptions)
    .where(and(eq(studentAcademicExceptions.programAssignmentId, programAssignmentId), eq(studentAcademicExceptions.status, 'active')));
}

export async function updateExceptionStatus(exceptionId: string, status: 'active' | 'revoked' | 'superseded', tx: Tx = db) {
  const [row] = await tx.update(studentAcademicExceptions).set({ status }).where(eq(studentAcademicExceptions.id, exceptionId)).returning();
  return row;
}

export async function lockExceptionRow(exceptionId: string, tx: Tx = db): Promise<void> {
  await tx.execute(sql`SELECT id FROM student_academic_exceptions WHERE id = ${exceptionId} FOR UPDATE`);
}

// ── Knowledge Provenance Reads ───────────────────────────────────────────────

export async function getInstitution(institutionId: string, tx: Tx = db) {
  const [row] = await tx.select().from(institutions).where(eq(institutions.id, institutionId)).limit(1);
  return row ?? null;
}

export async function getCreditProvider(providerId: string, tx: Tx = db) {
  const [row] = await tx.select().from(creditProviders).where(eq(creditProviders.id, providerId)).limit(1);
  return row ?? null;
}

export async function getProviderCourseVersion(courseVersionId: string, tx: Tx = db) {
  const [row] = await tx.select().from(providerCourseVersions).where(eq(providerCourseVersions.id, courseVersionId)).limit(1);
  return row ?? null;
}

export async function getEquivalency(equivalencyId: string, tx: Tx = db) {
  const [row] = await tx.select().from(equivalenciesV2).where(eq(equivalenciesV2.id, equivalencyId)).limit(1);
  return row ?? null;
}

export async function getInstitutionCourseVersion(courseVersionId: string, tx: Tx = db) {
  const rows = await tx
    .select({
      version: institutionCourseVersions,
      institution: institutions,
    })
    .from(institutionCourseVersions)
    .innerJoin(institutionCourses, eq(institutionCourseVersions.institutionCourseId, institutionCourses.id))
    .innerJoin(institutions, eq(institutionCourses.institutionId, institutions.id))
    .where(eq(institutionCourseVersions.id, courseVersionId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getClaimVersion(claimVersionId: string, tx: Tx = db) {
  const [row] = await tx.select().from(claimVersions).where(eq(claimVersions.id, claimVersionId)).limit(1);
  return row ?? null;
}

export async function getClaim(claimId: string, tx: Tx = db) {
  const [row] = await tx.select().from(knowledgeClaims).where(eq(knowledgeClaims.id, claimId)).limit(1);
  return row ?? null;
}

export async function getRequirementWithProgramVersion(requirementId: string, tx: Tx = db) {
  const rows = await tx
    .select({
      requirement: requirementsV2,
      programVersion: programVersions,
    })
    .from(requirementsV2)
    .innerJoin(programVersions, eq(requirementsV2.programVersionId, programVersions.id))
    .where(eq(requirementsV2.id, requirementId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAcademicRuleWithProgramVersion(academicRuleId: string, tx: Tx = db) {
  const rows = await tx
    .select({
      rule: academicRules,
      programVersion: programVersions,
    })
    .from(academicRules)
    .leftJoin(programVersions, eq(academicRules.programVersionId, programVersions.id))
    .where(eq(academicRules.id, academicRuleId))
    .limit(1);
  return rows[0] ?? null;
}

// ── Batch reads for read model ──────────────────────────────────────────────

export async function getLatestVerificationEventsBatch(creditRecordIds: string[], tx: Tx = db): Promise<Record<string, VerificationEventRow>> {
  if (creditRecordIds.length === 0) return {};
  const rows = await tx.select()
    .from(studentCreditVerificationEvents)
    .where(inArray(studentCreditVerificationEvents.creditRecordId, creditRecordIds))
    .orderBy(desc(studentCreditVerificationEvents.seq));
  const result: Record<string, VerificationEventRow> = {};
  for (const row of rows) {
    if (!(row.creditRecordId in result)) result[row.creditRecordId] = row;
  }
  return result;
}

export async function getLatestDecisionsBatch(creditRecordIds: string[], programAssignmentId: string, tx: Tx = db): Promise<Record<string, DecisionRow>> {
  if (creditRecordIds.length === 0) return {};
  const rows = await tx.select()
    .from(studentCreditDecisions)
    .where(and(
      eq(studentCreditDecisions.programAssignmentId, programAssignmentId),
      inArray(studentCreditDecisions.creditRecordId, creditRecordIds),
    ))
    .orderBy(desc(studentCreditDecisions.seq));
  const result: Record<string, DecisionRow> = {};
  for (const row of rows) {
    if (!(row.creditRecordId in result)) result[row.creditRecordId] = row;
  }
  return result;
}
