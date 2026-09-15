/**
 * Phase 2B — Real DB Service Tests: Student Academic Record
 *
 * OPT-IN: Set RUN_PHASE2B_DB_TESTS=1 to enable.
 * Requires DATABASE_URL pointing to rheronevecsffaejteoj.
 *
 * Uses real repository + real service + real Drizzle/PostgreSQL.
 * Creates disposable prefixed fixtures and cleans up afterward.
 */

import { describe, it, expect, beforeAll, afterAll, vitest } from 'vitest';
import { readFileSync } from 'fs';

try {
  const envContent = readFileSync('.env', 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i > 0 && !process.env[trimmed.slice(0, i)]) {
      process.env[trimmed.slice(0, i)] = trimmed.slice(i + 1);
    }
  }
} catch {}

const repo = await import('../server/repositories/student-academic-repo');
const { createStudentAcademicService } = await import('../server/services/student-academic-service');
const { db } = await import('../server/lib/db');
import { sql } from 'drizzle-orm';
import type { Tx } from '../server/repositories/student-academic-repo';

const RUN_TESTS = process.env.RUN_PHASE2B_DB_TESTS === '1';
const DB_URL = process.env.DATABASE_URL ?? '';
const IS_TARGET = DB_URL.includes('rheronevecsffaejteoj');

const it_db = RUN_TESTS ? it : it.skip;
const describe_db = RUN_TESTS ? describe : describe.skip;

const PREFIX = `p2b-${Date.now()}`;

describe_db('Phase 2B: Real DB Service Tests — Student Academic Record', () => {
  if (RUN_TESTS) {
    vitest.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
  }

  let service: ReturnType<typeof createStudentAcademicService>;
  let tesuId: string;
  let testUserId: string;
  let testStudentId: string;
  let testProgramId: string;
  let programVersionId: string;
  let programVersionId2: string;

  beforeAll(async () => {
    if (!RUN_TESTS) return;
    if (!DB_URL || !IS_TARGET) throw new Error('RUN_PHASE2B_DB_TESTS=1 requires DATABASE_URL containing rheronevecsffaejteoj');

    service = createStudentAcademicService(repo, async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
      return await db.transaction(fn);
    });

    // Get TESU institution
    const instResult = await db.execute(sql`SELECT id FROM knowledge_institutions WHERE slug = 'tesu'`);
    tesuId = (instResult as any[])[0].id;

    // Create program + two versions
    testUserId = `${PREFIX}-user`;
    testStudentId = `${PREFIX}-student`;

    const progResult = await db.execute(sql`
      INSERT INTO knowledge_programs_v2 (institution_id, code, name)
      VALUES (${tesuId}, ${PREFIX + '-PROG'}, ${PREFIX + ' Test Program'})
      RETURNING id
    `);
    testProgramId = (progResult as any[])[0].id;

    const pv1 = await db.execute(sql`INSERT INTO knowledge_program_versions (program_id, version_label, status) VALUES (${testProgramId}, ${PREFIX + '-v1'}, 'active') RETURNING id`);
    programVersionId = (pv1 as any[])[0].id;

    const pv2 = await db.execute(sql`INSERT INTO knowledge_program_versions (program_id, version_label, status) VALUES (${testProgramId}, ${PREFIX + '-v2'}, 'active') RETURNING id`);
    programVersionId2 = (pv2 as any[])[0].id;

    // Create user + student
    await db.execute(sql`INSERT INTO users (id, email, name, role) VALUES (${testUserId}, ${PREFIX + '@test.lumiere.app'}, ${PREFIX + ' User'}, 'staff')`);
    await db.execute(sql`INSERT INTO students (id, user_id, student_code, status, first_name, last_name, dob, residency, email, phone_primary, address_country, address_line1) VALUES (${testStudentId}, ${testUserId}, ${PREFIX + '-CODE'}, 'lead', 'Test', 'Student', '2000-01-01', 'us', ${PREFIX + '@test.lumiere.app'}, '555-0000', 'US', '123 Test St')`);
  });

  afterAll(async () => {
    if (!RUN_TESTS) return;

    const errors: string[] = [];

    // Cleanup in dependency order
    const cleanupStmts = [
      sql`DELETE FROM student_academic_exceptions WHERE student_id = ${testStudentId}`,
      sql`DELETE FROM student_credit_decisions WHERE credit_record_id IN (SELECT id FROM student_credit_records WHERE student_id = ${testStudentId})`,
      sql`DELETE FROM student_credit_verification_events WHERE credit_record_id IN (SELECT id FROM student_credit_records WHERE student_id = ${testStudentId})`,
      sql`DELETE FROM student_credit_records WHERE student_id = ${testStudentId}`,
      sql`DELETE FROM student_academic_sources WHERE student_id = ${testStudentId}`,
      sql`DELETE FROM student_program_assignments WHERE student_id = ${testStudentId}`,
      sql`DELETE FROM students WHERE id = ${testStudentId}`,
      sql`DELETE FROM users WHERE id = ${testUserId}`,
      sql`DELETE FROM knowledge_program_versions WHERE program_id = ${testProgramId}`,
      sql`DELETE FROM knowledge_programs_v2 WHERE id = ${testProgramId}`,
    ];

    for (const stmt of cleanupStmts) {
      try { await db.execute(stmt); } catch (e) { errors.push((e as Error).message); }
    }

    // Verify zero fixtures remain
    const checks = [
      { label: 'exceptions', query: sql`SELECT count(*)::int as cnt FROM student_academic_exceptions WHERE student_id = ${testStudentId}` },
      { label: 'credit_records', query: sql`SELECT count(*)::int as cnt FROM student_credit_records WHERE student_id = ${testStudentId}` },
      { label: 'sources', query: sql`SELECT count(*)::int as cnt FROM student_academic_sources WHERE student_id = ${testStudentId}` },
      { label: 'assignments', query: sql`SELECT count(*)::int as cnt FROM student_program_assignments WHERE student_id = ${testStudentId}` },
      { label: 'users', query: sql`SELECT count(*)::int as cnt FROM users WHERE id = ${testUserId}` },
      { label: 'students', query: sql`SELECT count(*)::int as cnt FROM students WHERE id = ${testStudentId}` },
      { label: 'program_versions', query: sql`SELECT count(*)::int as cnt FROM knowledge_program_versions WHERE program_id = ${testProgramId}` },
      { label: 'programs', query: sql`SELECT count(*)::int as cnt FROM knowledge_programs_v2 WHERE id = ${testProgramId}` },
    ];

    for (const c of checks) {
      const r = await db.execute(c.query);
      if ((r as any[])[0].cnt > 0) errors.push(`${c.label}: ${(r as any[])[0].cnt} leftover`);
    }

    // Verify institutions unchanged
    const instCount = await db.execute(sql`SELECT count(*)::int as cnt FROM knowledge_institutions`);
    if ((instCount as any[])[0].cnt !== 3) errors.push(`institutions: expected 3, got ${(instCount as any[])[0].cnt}`);

    if (errors.length > 0) throw new Error(`Cleanup FAILED: ${errors.join('; ')}`);
  });

  // ── Tests ────────────────────────────────────────────────────────────────────

  it_db('1. initial assignment works', async () => {
    const assignment = await service.assignProgram({
      studentId: testStudentId,
      programVersionId,
      assignedBy: testUserId,
    });
    expect(assignment.status).toBe('active');
    expect(assignment.studentId).toBe(testStudentId);
  });

  it_db('2. real concurrent duplicate active assignment → one winner', async () => {
    // Create a dedicated disposable student with NO active assignment
    const concUserId = `${PREFIX}-conc-user`;
    const concStudentId = `${PREFIX}-conc-student`;
    await db.execute(sql`INSERT INTO users (id, email, name, role) VALUES (${concUserId}, ${PREFIX + 'conc@test.lumiere.app'}, ${PREFIX + ' Conc'}, 'staff')`);
    await db.execute(sql`INSERT INTO students (id, user_id, student_code, status, first_name, last_name, dob, residency, email, phone_primary, address_country, address_line1) VALUES (${concStudentId}, ${concUserId}, ${PREFIX + '-CONC'}, 'lead', 'Conc', 'Student', '2000-01-01', 'us', ${PREFIX + 'conc@test.lumiere.app'}, '555-2222', 'US', '789 Conc St')`);

    // Start TWO assignProgram calls concurrently
    const results = await Promise.allSettled([
      service.assignProgram({ studentId: concStudentId, programVersionId, assignedBy: testUserId }),
      service.assignProgram({ studentId: concStudentId, programVersionId, assignedBy: testUserId }),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // DB contains exactly 1 active assignment
    const active = await repo.getActiveAssignmentForStudent(concStudentId);
    expect(active).toBeTruthy();
    expect(active.status).toBe('active');

    // Cleanup
    await db.execute(sql`DELETE FROM student_program_assignments WHERE student_id = ${concStudentId}`);
    await db.execute(sql`DELETE FROM students WHERE id = ${concStudentId}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${concUserId}`);
  });

  it_db('3. switch assignment atomically supersedes old', async () => {
    const result = await service.switchProgramAssignment({
      studentId: testStudentId,
      newProgramVersionId: programVersionId2,
      assignedBy: testUserId,
    });
    expect(result.oldAssignment.status).toBe('superseded');
    expect(result.newAssignment.status).toBe('active');
    expect(result.newAssignment.programVersionId).toBe(programVersionId2);
  });

  it_db('4. source → credit record creation works and derives student', async () => {
    const source = await service.createAcademicSource({
      studentId: testStudentId,
      sourceType: 'transcript',
      title: 'Test Transcript',
      createdBy: testUserId,
    });
    expect(source.studentId).toBe(testStudentId);

    const record = await service.createCreditRecord({
      sourceId: source.id,
      rawTitle: 'Intro to Biology',
      rawCourseCode: 'BIO101',
      rawCredits: '3.00',
    });
    expect(record.studentId).toBe(testStudentId);
    expect(record.status).toBe('extracted');
  });

  it_db('5. verification updates status and latest event follows seq', async () => {
    const sources = await repo.listSourcesForStudent(testStudentId);
    const source = sources[0];
    const records = await repo.listCreditRecordsBySource(source.id);
    const record = records[0];

    await service.recordCreditVerification({
      creditRecordId: record.id,
      action: 'submitted',
      reviewerId: testUserId,
    });

    await service.recordCreditVerification({
      creditRecordId: record.id,
      action: 'verified',
      reviewerId: testUserId,
    });

    const latest = await repo.getLatestVerificationEvent(record.id);
    expect(latest.action).toBe('verified');
    expect(latest.seq).toBeGreaterThan(0);

    const updated = await repo.getCreditRecord(record.id);
    expect(updated.status).toBe('verified');
  });

  it_db('6. decision before verification is rejected', async () => {
    // Create a fresh source + record that hasn't been verified
    const source = await service.createAcademicSource({
      studentId: testStudentId,
      sourceType: 'manual',
      title: 'Manual Record',
      createdBy: testUserId,
    });
    const record = await service.createCreditRecord({
      sourceId: source.id,
      rawTitle: 'Unverified Course',
    });

    const assignment = await repo.getActiveAssignmentForStudent(testStudentId);

    await expect(service.recordCreditDecision({
      creditRecordId: record.id,
      programAssignmentId: assignment.id,
      action: 'accepted',
      creditsAwarded: '3',
    })).rejects.toThrow(/verified/);
  });

  it_db('7. verified credit can be accepted', async () => {
    const sources = await repo.listSourcesForStudent(testStudentId);
    const source = sources.find(s => s.title === 'Test Transcript');
    const records = await repo.listCreditRecordsBySource(source.id);
    const record = records[0];
    const assignment = await repo.getActiveAssignmentForStudent(testStudentId);

    const decision = await service.recordCreditDecision({
      creditRecordId: record.id,
      programAssignmentId: assignment.id,
      action: 'accepted',
      creditsAwarded: '3.00',
      decidedBy: testUserId,
    });
    expect(decision.action).toBe('accepted');
  });

  it_db('8. real concurrent acceptance → one effective winner', async () => {
    // Create a fresh verified credit record with no prior decision
    const concSource = await service.createAcademicSource({
      studentId: testStudentId,
      sourceType: 'exam_score',
      title: 'Concurrent Exam',
      createdBy: testUserId,
    });
    const concRecord = await service.createCreditRecord({
      sourceId: concSource.id,
      rawTitle: 'Concurrent Test Course',
      rawCredits: '3.00',
    });
    await service.recordCreditVerification({ creditRecordId: concRecord.id, action: 'verified', reviewerId: testUserId });

    const assignment = await repo.getActiveAssignmentForStudent(testStudentId);

    // Start TWO accepted decisions concurrently
    const results = await Promise.allSettled([
      service.recordCreditDecision({ creditRecordId: concRecord.id, programAssignmentId: assignment.id, action: 'accepted', creditsAwarded: '3.00', decidedBy: testUserId }),
      service.recordCreditDecision({ creditRecordId: concRecord.id, programAssignmentId: assignment.id, action: 'accepted', creditsAwarded: '3.00', decidedBy: testUserId }),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Decision history contains exactly one accepted decision
    const decisions = await repo.listDecisions(concRecord.id, assignment.id);
    const acceptedDecisions = decisions.filter(d => d.action === 'accepted');
    expect(acceptedDecisions).toHaveLength(1);

    // Latest effective decision is accepted
    const latest = await repo.getLatestDecision(concRecord.id, assignment.id);
    expect(latest.action).toBe('accepted');
  });

  it_db('9. accepted credit cannot be corrected until decision revoked', async () => {
    const sources = await repo.listSourcesForStudent(testStudentId);
    const source = sources.find(s => s.title === 'Test Transcript');
    const records = await repo.listCreditRecordsBySource(source.id);
    const record = records[0];
    const assignment = await repo.getActiveAssignmentForStudent(testStudentId);

    await expect(service.correctCreditRecord({
      creditRecordId: record.id,
      corrections: { rawTitle: 'Corrected Title' },
      reviewerId: testUserId,
    })).rejects.toThrow(/accepted decision/);

    // Revoke the decision
    await service.recordCreditDecision({
      creditRecordId: record.id,
      programAssignmentId: assignment.id,
      action: 'revoked',
      decidedBy: testUserId,
    });
  });

  it_db('10. revoke → correction succeeds and status returns extracted', async () => {
    const sources = await repo.listSourcesForStudent(testStudentId);
    const source = sources.find(s => s.title === 'Test Transcript');
    const records = await repo.listCreditRecordsBySource(source.id);
    const record = records[0];

    const corrected = await service.correctCreditRecord({
      creditRecordId: record.id,
      corrections: { rawTitle: 'Corrected Biology' },
      reviewerId: testUserId,
      rationale: 'Fixing title',
    });
    expect(corrected.rawTitle).toBe('Corrected Biology');
    expect(corrected.status).toBe('extracted');

    // Verify a corrected verification event was appended
    const latest = await repo.getLatestVerificationEvent(record.id);
    expect(latest.action).toBe('corrected');
  });

  it_db('11. cross-student/program provenance is rejected', async () => {
    // Create a second student
    const userId2 = `${PREFIX}-user2`;
    const studentId2 = `${PREFIX}-student2`;
    await db.execute(sql`INSERT INTO users (id, email, name, role) VALUES (${userId2}, ${PREFIX + '2@test.lumiere.app'}, ${PREFIX + ' User2'}, 'student')`);
    await db.execute(sql`INSERT INTO students (id, user_id, student_code, status, first_name, last_name, dob, residency, email, phone_primary, address_country, address_line1) VALUES (${studentId2}, ${userId2}, ${PREFIX + '-CODE2'}, 'lead', 'Test2', 'Student2', '2000-01-01', 'us', ${PREFIX + '2@test.lumiere.app'}, '555-1111', 'US', '456 Test Ave')`);

    // Assign second student to a different program version
    await service.assignProgram({ studentId: studentId2, programVersionId, assignedBy: testUserId });

    // Create a credit record for student1
    const sources = await repo.listSourcesForStudent(testStudentId);
    const source = sources[0];
    const records = await repo.listCreditRecordsBySource(source.id);
    const record = records[0];

    // Get student2's assignment
    const assignment2 = await repo.getActiveAssignmentForStudent(studentId2);

    // Try to make a decision cross-student
    await expect(service.recordCreditDecision({
      creditRecordId: record.id,
      programAssignmentId: assignment2.id,
      action: 'accepted',
      creditsAwarded: '3',
    })).rejects.toThrow(/different students/);

    // Cleanup student2
    await db.execute(sql`DELETE FROM student_program_assignments WHERE student_id = ${studentId2}`);
    await db.execute(sql`DELETE FROM students WHERE id = ${studentId2}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${userId2}`);
  });

  it_db('12. exception create → supersede → revoke history persists', async () => {
    const assignment = await repo.getActiveAssignmentForStudent(testStudentId);

    const exc1 = await service.createAcademicException({
      studentId: testStudentId,
      programAssignmentId: assignment.id,
      exceptionType: 'other',
      rationale: 'Initial exception',
      approvedBy: testUserId,
    });
    expect(exc1.status).toBe('active');

    const result = await service.supersedeAcademicException({
      oldExceptionId: exc1.id,
      exceptionType: 'other',
      rationale: 'Replacement exception',
      approvedBy: testUserId,
    });
    expect(result.oldException.status).toBe('superseded');
    expect(result.newException.status).toBe('active');
    expect(result.newException.supersedesExceptionId).toBe(exc1.id);

    const revoked = await service.revokeAcademicException({ exceptionId: result.newException.id });
    expect(revoked.status).toBe('revoked');

    // Verify history persists (old exception still exists as superseded)
    const oldCheck = await repo.getException(exc1.id);
    expect(oldCheck.status).toBe('superseded');
  });

  it_db('13. getStudentAcademicRecord returns coherent structure', async () => {
    const record = await service.getStudentAcademicRecord(testStudentId);
    expect(record.student.id).toBe(testStudentId);
    expect(record.activeProgramAssignment).toBeTruthy();
    expect(record.programVersion).toBeTruthy();
    expect(record.academicSources.length).toBeGreaterThan(0);
    expect(record.creditRecords.length).toBeGreaterThan(0);
    expect(record.activeExceptions).toBeDefined();
  });

  it_db('14. transaction rollback leaves no partial state when a write is fault-injected', async () => {
    // Create a fault-injecting service that throws mid-transaction
    const faultService = createStudentAcademicService(repo, async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
      return await db.transaction(async (tx: Tx) => {
        const result = await fn(tx);
        throw new Error('Fault-injected rollback');
      });
    });

    // Use recordCreditVerification which runs inside transactionRunner — fault injection should rollback
    const sources = await repo.listSourcesForStudent(testStudentId);
    const manualSource = sources.find(s => s.title === 'Manual Record');
    const manualRecords = await repo.listCreditRecordsBySource(manualSource.id);
    const unverifiedRecord = manualRecords[0];

    // Capture status before
    const beforeRecord = await repo.getCreditRecord(unverifiedRecord.id);
    const beforeStatus = beforeRecord.status;

    await expect(faultService.recordCreditVerification({
      creditRecordId: unverifiedRecord.id,
      action: 'verified',
      reviewerId: testUserId,
    })).rejects.toThrow('Fault-injected rollback');

    // Verify no verification event was persisted and status unchanged
    const afterRecord = await repo.getCreditRecord(unverifiedRecord.id);
    expect(afterRecord.status).toBe(beforeStatus);
    const events = await repo.listVerificationEvents(unverifiedRecord.id);
    expect(events.filter(e => e.action === 'verified')).toHaveLength(0);
  });
});
