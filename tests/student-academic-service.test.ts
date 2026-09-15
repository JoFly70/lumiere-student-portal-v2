/**
 * Phase 2B — Student Academic Record Service Unit Tests
 *
 * Tests service guards and state transitions using mocked repository.
 * No real database connection required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStudentAcademicService } from '../server/services/student-academic-service';
import { StudentAcademicError } from '../server/lib/student-academic-errors';
import type { Tx } from '../server/repositories/student-academic-repo';

// ── Mock repository ───────────────────────────────────────────────────────────

function createMockRepo() {
  const store: Record<string, any> = {
    students: new Map(),
    programVersions: new Map(),
    assignments: new Map(),
    sources: new Map(),
    creditRecords: new Map(),
    verificationEvents: new Map(),
    decisions: new Map(),
    exceptions: new Map(),
    documents: new Map(),
    seqCounters: { verification: 0, decision: 0 },
  };

  return {
    _store: store,

    async getStudent(id: string, tx?: Tx) {
      return store.students.get(id) ?? null;
    },
    async getProgramVersion(id: string, tx?: Tx) {
      return store.programVersions.get(id) ?? null;
    },
    async getProgramVersionWithProgram(id: string, tx?: Tx) {
      const pv = store.programVersions.get(id);
      if (!pv) return null;
      return {
        version: pv,
        program: { id: 'prog-1', institutionId: 'inst-1', name: 'Test Program', code: 'TP' },
        institution: { id: 'inst-1', name: 'Test Inst', slug: 'test' },
      };
    },
    async getAssignment(id: string, tx?: Tx) {
      return store.assignments.get(id) ?? null;
    },
    async getActiveAssignmentForStudent(studentId: string, tx?: Tx) {
      for (const a of store.assignments.values()) {
        if (a.studentId === studentId && a.status === 'active') return a;
      }
      return null;
    },
    async listAssignments(studentId: string, tx?: Tx) {
      return [...store.assignments.values()].filter(a => a.studentId === studentId);
    },
    async createAssignment(input: any, tx?: Tx) {
      const id = `pa-${store.assignments.size + 1}`;
      const row = { id, ...input, status: 'active', assignedAt: new Date(), endedAt: null, metadata: {}, createdAt: new Date(), updatedAt: new Date() };
      store.assignments.set(id, row);
      return row;
    },
    async updateAssignmentStatus(id: string, status: string, endedAt?: Date | null, tx?: Tx) {
      const row = store.assignments.get(id);
      if (!row) return null;
      const updated = { ...row, status, endedAt: endedAt ?? row.endedAt, updatedAt: new Date() };
      store.assignments.set(id, updated);
      return updated;
    },
    async lockStudentRow(id: string, tx?: Tx) {},
    async lockAssignmentRow(id: string, tx?: Tx) {},

    async createSource(input: any, tx?: Tx) {
      const id = `src-${store.sources.size + 1}`;
      const row = { id, ...input, status: 'received', metadata: {}, createdAt: new Date(), updatedAt: new Date() };
      store.sources.set(id, row);
      return row;
    },
    async getSource(id: string, tx?: Tx) {
      return store.sources.get(id) ?? null;
    },
    async listSourcesForStudent(studentId: string, tx?: Tx) {
      return [...store.sources.values()].filter(s => s.studentId === studentId);
    },
    async updateSourceStatus(id: string, status: string, tx?: Tx) {
      const row = store.sources.get(id);
      if (!row) return null;
      const updated = { ...row, status, updatedAt: new Date() };
      store.sources.set(id, updated);
      return updated;
    },
    async getDocumentOwnership(id: string, tx?: Tx) {
      return store.documents.get(id) ?? null;
    },

    async createCreditRecord(input: any, tx?: Tx) {
      const id = `cr-${store.creditRecords.size + 1}`;
      const row = { id, ...input, status: 'extracted', metadata: {}, createdAt: new Date(), updatedAt: new Date() };
      store.creditRecords.set(id, row);
      return row;
    },
    async getCreditRecord(id: string, tx?: Tx) {
      return store.creditRecords.get(id) ?? null;
    },
    async listCreditRecordsByStudent(studentId: string, tx?: Tx) {
      return [...store.creditRecords.values()].filter(c => c.studentId === studentId);
    },
    async listCreditRecordsBySource(sourceId: string, tx?: Tx) {
      return [...store.creditRecords.values()].filter(c => c.sourceId === sourceId);
    },
    async updateCreditRecord(id: string, set: any, tx?: Tx) {
      const row = store.creditRecords.get(id);
      if (!row) return null;
      const updated = { ...row, ...set, updatedAt: new Date() };
      store.creditRecords.set(id, updated);
      return updated;
    },
    async lockCreditRecordRow(id: string, tx?: Tx) {},

    async appendVerificationEvent(input: any, tx?: Tx) {
      store.seqCounters.verification++;
      const id = `ve-${store.seqCounters.verification}`;
      const row = { id, ...input, seq: store.seqCounters.verification, snapshot: input.snapshot ?? {}, createdAt: new Date() };
      if (!store.verificationEvents.has(input.creditRecordId)) store.verificationEvents.set(input.creditRecordId, []);
      store.verificationEvents.get(input.creditRecordId).push(row);
      return row;
    },
    async listVerificationEvents(creditRecordId: string, tx?: Tx) {
      return (store.verificationEvents.get(creditRecordId) ?? []).sort((a, b) => b.seq - a.seq);
    },
    async getLatestVerificationEvent(creditRecordId: string, tx?: Tx) {
      const events = (store.verificationEvents.get(creditRecordId) ?? []).sort((a, b) => b.seq - a.seq);
      return events[0] ?? null;
    },

    async appendDecision(input: any, tx?: Tx) {
      store.seqCounters.decision++;
      const id = `dec-${store.seqCounters.decision}`;
      const row = { id, ...input, seq: store.seqCounters.decision, metadata: input.metadata ?? {}, createdAt: new Date() };
      const key = `${input.creditRecordId}:${input.programAssignmentId}`;
      if (!store.decisions.has(key)) store.decisions.set(key, []);
      store.decisions.get(key).push(row);
      return row;
    },
    async listDecisions(creditRecordId: string, programAssignmentId: string, tx?: Tx) {
      const key = `${creditRecordId}:${programAssignmentId}`;
      return (store.decisions.get(key) ?? []).sort((a, b) => b.seq - a.seq);
    },
    async getLatestDecision(creditRecordId: string, programAssignmentId: string, tx?: Tx) {
      const key = `${creditRecordId}:${programAssignmentId}`;
      const decisions = (store.decisions.get(key) ?? []).sort((a, b) => b.seq - a.seq);
      return decisions[0] ?? null;
    },

    async createException(input: any, tx?: Tx) {
      const id = `exc-${store.exceptions.size + 1}`;
      const row = { id, ...input, status: 'active', metadata: {}, createdAt: new Date() };
      store.exceptions.set(id, row);
      return row;
    },
    async getException(id: string, tx?: Tx) {
      return store.exceptions.get(id) ?? null;
    },
    async listActiveExceptionsForStudent(studentId: string, tx?: Tx) {
      return [...store.exceptions.values()].filter(e => e.studentId === studentId && e.status === 'active');
    },
    async listActiveExceptionsForAssignment(paId: string, tx?: Tx) {
      return [...store.exceptions.values()].filter(e => e.programAssignmentId === paId && e.status === 'active');
    },
    async updateExceptionStatus(id: string, status: string, tx?: Tx) {
      const row = store.exceptions.get(id);
      if (!row) return null;
      const updated = { ...row, status };
      store.exceptions.set(id, updated);
      return updated;
    },
    async lockExceptionRow(id: string, tx?: Tx) {},

    // Knowledge provenance reads
    async getInstitution(id: string, tx?: Tx) { return store.institutions?.get(id) ?? null; },
    async getCreditProvider(id: string, tx?: Tx) { return store.creditProviders?.get(id) ?? null; },
    async getProviderCourseVersion(id: string, tx?: Tx) { return store.providerCourseVersions?.get(id) ?? null; },
    async getEquivalency(id: string, tx?: Tx) { return store.equivalencies?.get(id) ?? null; },
    async getInstitutionCourseVersion(id: string, tx?: Tx) { return store.institutionCourseVersions?.get(id) ?? null; },
    async getClaimVersion(id: string, tx?: Tx) { return store.claimVersions?.get(id) ?? null; },
    async getClaim(id: string, tx?: Tx) { return store.claims?.get(id) ?? null; },
    async getRequirementWithProgramVersion(id: string, tx?: Tx) { return store.requirements?.get(id) ?? null; },
    async getAcademicRuleWithProgramVersion(id: string, tx?: Tx) { return store.academicRules?.get(id) ?? null; },

    // Batch reads
    async getLatestVerificationEventsBatch(ids: string[], tx?: Tx) {
      const result: Record<string, any> = {};
      for (const id of ids) {
        const events = (store.verificationEvents.get(id) ?? []).sort((a: any, b: any) => b.seq - a.seq);
        if (events[0]) result[id] = events[0];
      }
      return result;
    },
    async getLatestDecisionsBatch(ids: string[], paId: string, tx?: Tx) {
      const result: Record<string, any> = {};
      for (const id of ids) {
        const key = `${id}:${paId}`;
        const decisions = (store.decisions.get(key) ?? []).sort((a: any, b: any) => b.seq - a.seq);
        if (decisions[0]) result[id] = decisions[0];
      }
      return result;
    },
  };
}

function createService(repo: any) {
  return createStudentAcademicService(repo, async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
    return await fn({} as Tx);
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Phase 2B — Student Academic Record Service', () => {
  let repo: ReturnType<typeof createMockRepo>;
  let service: ReturnType<typeof createService>;

  beforeEach(() => {
    repo = createMockRepo();
    service = createService(repo);
    // Seed a student
    repo._store.students.set('s1', { id: 's1', user_id: 'u1', first_name: 'Test', last_name: 'Student' });
    // Seed a program version (active)
    repo._store.programVersions.set('pv1', { id: 'pv1', programId: 'prog-1', status: 'active', versionLabel: 'v1' });
    // Seed a draft program version
    repo._store.programVersions.set('pv-draft', { id: 'pv-draft', programId: 'prog-1', status: 'draft', versionLabel: 'draft' });
    // Seed knowledge entities for provenance
    repo._store.institutions = new Map([['inst-1', { id: 'inst-1', name: 'Test Inst', slug: 'test' }], ['inst-2', { id: 'inst-2', name: 'Other Inst', slug: 'other' }]]);
    repo._store.creditProviders = new Map([['cp-1', { id: 'cp-1', name: 'Test Provider' }]]);
    repo._store.providerCourseVersions = new Map([['pcv-1', { id: 'pcv-1', title: 'Test Provider Course' }]]);
    repo._store.institutionCourseVersions = new Map([['icv-1', { version: { id: 'icv-1' }, institution: { id: 'inst-1' } }]]);
    repo._store.equivalencies = new Map([['eq-1', { id: 'eq-1', institutionId: 'inst-1' }]]);
    repo._store.claimVersions = new Map([['cv-1', { id: 'cv-1', claimId: 'cl-1', status: 'confirmed' }]]);
    repo._store.claims = new Map([['cl-1', { id: 'cl-1', currentVersionId: 'cv-1' }]]);
    repo._store.requirements = new Map([['req-1', { requirement: { id: 'req-1' }, programVersion: { id: 'pv1' } }]]);
    repo._store.academicRules = new Map([
      ['ar-1', { rule: { id: 'ar-1', institutionId: 'inst-1', programVersionId: 'pv1' }, programVersion: { id: 'pv1' } }],
      ['ar-inst', { rule: { id: 'ar-inst', institutionId: 'inst-1', programVersionId: null }, programVersion: null }],
      ['ar-other-pv', { rule: { id: 'ar-other-pv', institutionId: 'inst-1', programVersionId: 'pv-other' }, programVersion: { id: 'pv-other' } }],
      ['ar-other-inst', { rule: { id: 'ar-other-inst', institutionId: 'inst-2', programVersionId: null }, programVersion: null }],
    ]);
  });

  // ── Program Assignment ─────────────────────────────────────────────────────

  describe('assignProgram', () => {
    it('rejects missing student', async () => {
      await expect(service.assignProgram({ studentId: 'missing', programVersionId: 'pv1' }))
        .rejects.toThrow(/Student not found/);
    });

    it('rejects missing program version', async () => {
      await expect(service.assignProgram({ studentId: 's1', programVersionId: 'missing' }))
        .rejects.toThrow(/Program version not found/);
    });

    it('rejects draft program version', async () => {
      await expect(service.assignProgram({ studentId: 's1', programVersionId: 'pv-draft' }))
        .rejects.toThrow(/Draft program versions cannot be assigned/);
    });

    it('rejects duplicate active assignment', async () => {
      await service.assignProgram({ studentId: 's1', programVersionId: 'pv1' });
      await expect(service.assignProgram({ studentId: 's1', programVersionId: 'pv1' }))
        .rejects.toThrow(/already has an active/);
    });

    it('creates active assignment', async () => {
      const result = await service.assignProgram({ studentId: 's1', programVersionId: 'pv1' });
      expect(result.status).toBe('active');
      expect(result.studentId).toBe('s1');
    });
  });

  describe('switchProgramAssignment', () => {
    it('rejects when no active assignment exists', async () => {
      await expect(service.switchProgramAssignment({ studentId: 's1', newProgramVersionId: 'pv1' }))
        .rejects.toThrow(/no active program assignment/);
    });

    it('rejects same program version', async () => {
      await service.assignProgram({ studentId: 's1', programVersionId: 'pv1' });
      await expect(service.switchProgramAssignment({ studentId: 's1', newProgramVersionId: 'pv1' }))
        .rejects.toThrow(/must differ/);
    });

    it('supersedes old and creates new active', async () => {
      await service.assignProgram({ studentId: 's1', programVersionId: 'pv1' });
      repo._store.programVersions.set('pv2', { id: 'pv2', programId: 'prog-1', status: 'active', versionLabel: 'v2' });
      const result = await service.switchProgramAssignment({ studentId: 's1', newProgramVersionId: 'pv2' });
      expect(result.oldAssignment.status).toBe('superseded');
      expect(result.newAssignment.status).toBe('active');
      expect(result.newAssignment.programVersionId).toBe('pv2');
    });
  });

  // ── Academic Sources ────────────────────────────────────────────────────────

  describe('createAcademicSource', () => {
    it('rejects missing student', async () => {
      await expect(service.createAcademicSource({ studentId: 'missing', sourceType: 'transcript', title: 'T' }))
        .rejects.toThrow(/Student not found/);
    });

    it('rejects document ownership mismatch', async () => {
      repo._store.documents.set('doc1', { userId: 'other-user' });
      await expect(service.createAcademicSource({ studentId: 's1', documentId: 'doc1', sourceType: 'transcript', title: 'T' }))
        .rejects.toThrow(/does not belong/);
    });

    it('creates source when document belongs to student', async () => {
      repo._store.documents.set('doc1', { userId: 'u1' });
      const result = await service.createAcademicSource({ studentId: 's1', documentId: 'doc1', sourceType: 'transcript', title: 'T' });
      expect(result.status).toBe('received');
    });
  });

  describe('transitionAcademicSource', () => {
    it('rejects invalid transition', async () => {
      await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T' });
      // source is 'received', cannot go directly to 'verified'
      await expect(service.transitionAcademicSource({ sourceId: 'src-1', newStatus: 'verified' }))
        .rejects.toThrow(/Cannot transition/);
    });

    it('allows received → extracted', async () => {
      await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T' });
      const result = await service.transitionAcademicSource({ sourceId: 'src-1', newStatus: 'extracted' });
      expect(result.status).toBe('extracted');
    });

    it('allows extracted → verified', async () => {
      await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T' });
      await service.transitionAcademicSource({ sourceId: 'src-1', newStatus: 'extracted' });
      const result = await service.transitionAcademicSource({ sourceId: 'src-1', newStatus: 'verified' });
      expect(result.status).toBe('verified');
    });

    it('rejects superseded → any', async () => {
      await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T' });
      await service.transitionAcademicSource({ sourceId: 'src-1', newStatus: 'extracted' });
      await service.transitionAcademicSource({ sourceId: 'src-1', newStatus: 'superseded' });
      await expect(service.transitionAcademicSource({ sourceId: 'src-1', newStatus: 'extracted' }))
        .rejects.toThrow(/Cannot transition/);
    });
  });

  // ── Credit Records ───────────────────────────────────────────────────────────

  describe('createCreditRecord', () => {
    it('derives studentId from source server-side', async () => {
      await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T' });
      const result = await service.createCreditRecord({ sourceId: 'src-1', rawTitle: 'Test Course' });
      expect(result.studentId).toBe('s1');
      expect(result.status).toBe('extracted');
    });

    it('rejects missing source', async () => {
      await expect(service.createCreditRecord({ sourceId: 'missing', rawTitle: 'T' }))
        .rejects.toThrow(/source not found/);
    });
  });

  describe('correctCreditRecord', () => {
    it('rejects superseded record', async () => {
      await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T' });
      await service.createCreditRecord({ sourceId: 'src-1', rawTitle: 'Test Course' });
      await repo.updateCreditRecord('cr-1', { status: 'superseded' });
      await expect(service.correctCreditRecord({ creditRecordId: 'cr-1', corrections: { rawTitle: 'Fixed' } }))
        .rejects.toThrow(/Superseded/);
    });

    it('blocks correction when accepted decision exists', async () => {
      await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T' });
      await service.createCreditRecord({ sourceId: 'src-1', rawTitle: 'Test Course' });
      await service.assignProgram({ studentId: 's1', programVersionId: 'pv1' });
      // Manually set up verified state + accepted decision
      await repo.updateCreditRecord('cr-1', { status: 'verified' });
      repo._store.verificationEvents.set('cr-1', [{ id: 've-1', creditRecordId: 'cr-1', action: 'verified', seq: 1, snapshot: {}, createdAt: new Date() }]);
      repo._store.decisions.set('cr-1:pa-1', [{ id: 'dec-1', creditRecordId: 'cr-1', programAssignmentId: 'pa-1', action: 'accepted', seq: 1, creditsAwarded: '3', createdAt: new Date() }]);
      await expect(service.correctCreditRecord({ creditRecordId: 'cr-1', corrections: { rawTitle: 'Fixed' } }))
        .rejects.toThrow(/accepted decision/);
    });
  });

  // ── Verification ─────────────────────────────────────────────────────────────

  describe('recordCreditVerification', () => {
    it('maps action to record status', async () => {
      await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T' });
      await service.createCreditRecord({ sourceId: 'src-1', rawTitle: 'Test Course' });
      const result = await service.recordCreditVerification({ creditRecordId: 'cr-1', action: 'verified' });
      expect(result.action).toBe('verified');
      const record = await repo.getCreditRecord('cr-1');
      expect(record.status).toBe('verified');
    });

    it('uses seq for latest ordering not created_at', async () => {
      await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T' });
      await service.createCreditRecord({ sourceId: 'src-1', rawTitle: 'Test Course' });
      await service.recordCreditVerification({ creditRecordId: 'cr-1', action: 'submitted' });
      await service.recordCreditVerification({ creditRecordId: 'cr-1', action: 'verified' });
      const latest = await repo.getLatestVerificationEvent('cr-1');
      expect(latest.action).toBe('verified');
      expect(latest.seq).toBe(2);
    });

    it('rejects verification on superseded record', async () => {
      await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T' });
      await service.createCreditRecord({ sourceId: 'src-1', rawTitle: 'Test Course' });
      await repo.updateCreditRecord('cr-1', { status: 'superseded' });
      await expect(service.recordCreditVerification({ creditRecordId: 'cr-1', action: 'verified' }))
        .rejects.toThrow(/Superseded/);
    });
  });

  // ── Credit Decisions ─────────────────────────────────────────────────────────

  describe('recordCreditDecision', () => {
    beforeEach(async () => {
      await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T' });
      await service.createCreditRecord({ sourceId: 'src-1', rawTitle: 'Test Course' });
      await service.assignProgram({ studentId: 's1', programVersionId: 'pv1' });
    });

    it('rejects decision before verification', async () => {
      await expect(service.recordCreditDecision({
        creditRecordId: 'cr-1', programAssignmentId: 'pa-1', action: 'accepted', creditsAwarded: '3',
      })).rejects.toThrow(/verified/);
    });

    it('accepts verified credit', async () => {
      await repo.updateCreditRecord('cr-1', { status: 'verified' });
      repo._store.verificationEvents.set('cr-1', [{ id: 've-1', creditRecordId: 'cr-1', action: 'verified', seq: 1, snapshot: {}, createdAt: new Date() }]);
      const result = await service.recordCreditDecision({
        creditRecordId: 'cr-1', programAssignmentId: 'pa-1', action: 'accepted', creditsAwarded: '3',
      });
      expect(result.action).toBe('accepted');
    });

    it('rejects duplicate accepted decision', async () => {
      await repo.updateCreditRecord('cr-1', { status: 'verified' });
      repo._store.verificationEvents.set('cr-1', [{ id: 've-1', creditRecordId: 'cr-1', action: 'verified', seq: 1, snapshot: {}, createdAt: new Date() }]);
      await service.recordCreditDecision({ creditRecordId: 'cr-1', programAssignmentId: 'pa-1', action: 'accepted', creditsAwarded: '3' });
      await expect(service.recordCreditDecision({
        creditRecordId: 'cr-1', programAssignmentId: 'pa-1', action: 'accepted', creditsAwarded: '3',
      })).rejects.toThrow(/already accepted/);
    });

    it('rejects cross-student assignment/credit mismatch', async () => {
      repo._store.students.set('s2', { id: 's2', user_id: 'u2', first_name: 'Other', last_name: 'Student' });
      repo._store.programVersions.set('pv2', { id: 'pv2', programId: 'prog-1', status: 'active', versionLabel: 'v2' });
      await service.assignProgram({ studentId: 's2', programVersionId: 'pv2' });
      await repo.updateCreditRecord('cr-1', { status: 'verified' });
      repo._store.verificationEvents.set('cr-1', [{ id: 've-1', creditRecordId: 'cr-1', action: 'verified', seq: 1, snapshot: {}, createdAt: new Date() }]);
      await expect(service.recordCreditDecision({
        creditRecordId: 'cr-1', programAssignmentId: 'pa-2', action: 'accepted', creditsAwarded: '3',
      })).rejects.toThrow(/different students/);
    });

    it('revokes prior accepted decision', async () => {
      await repo.updateCreditRecord('cr-1', { status: 'verified' });
      repo._store.verificationEvents.set('cr-1', [{ id: 've-1', creditRecordId: 'cr-1', action: 'verified', seq: 1, snapshot: {}, createdAt: new Date() }]);
      await service.recordCreditDecision({ creditRecordId: 'cr-1', programAssignmentId: 'pa-1', action: 'accepted', creditsAwarded: '3' });
      const revoked = await service.recordCreditDecision({ creditRecordId: 'cr-1', programAssignmentId: 'pa-1', action: 'revoked' });
      expect(revoked.action).toBe('revoked');
    });

    it('rejects revoke with no prior decision', async () => {
      await expect(service.recordCreditDecision({
        creditRecordId: 'cr-1', programAssignmentId: 'pa-1', action: 'revoked',
      })).rejects.toThrow(/No prior decision/);
    });
  });

  // ── Exceptions ────────────────────────────────────────────────────────────────

  describe('createAcademicException', () => {
    beforeEach(async () => {
      await service.assignProgram({ studentId: 's1', programVersionId: 'pv1' });
    });

    it('creates exception with credit record target', async () => {
      await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T' });
      await service.createCreditRecord({ sourceId: 'src-1', rawTitle: 'Test Course' });
      const result = await service.createAcademicException({
        studentId: 's1', programAssignmentId: 'pa-1', exceptionType: 'credit_override', creditRecordId: 'cr-1', rationale: 'Override credits',
      });
      expect(result.status).toBe('active');
    });

    it('rejects non-"other" exception without a target', async () => {
      await expect(service.createAcademicException({
        studentId: 's1', programAssignmentId: 'pa-1', exceptionType: 'requirement_waiver', rationale: 'Waive',
      })).rejects.toThrow(/at least one target/);
    });

    it('allows "other" exception without a target', async () => {
      const result = await service.createAcademicException({
        studentId: 's1', programAssignmentId: 'pa-1', exceptionType: 'other', rationale: 'Other reason',
      });
      expect(result.status).toBe('active');
    });
  });

  describe('supersedeAcademicException', () => {
    it('supersedes old and creates new', async () => {
      await service.assignProgram({ studentId: 's1', programVersionId: 'pv1' });
      const old = await service.createAcademicException({
        studentId: 's1', programAssignmentId: 'pa-1', exceptionType: 'other', rationale: 'Old',
      });
      const result = await service.supersedeAcademicException({
        oldExceptionId: old.id, exceptionType: 'other', rationale: 'New',
      });
      expect(result.oldException.status).toBe('superseded');
      expect(result.newException.status).toBe('active');
      expect(result.newException.supersedesExceptionId).toBe(old.id);
    });
  });

  describe('revokeAcademicException', () => {
    it('revokes active exception', async () => {
      await service.assignProgram({ studentId: 's1', programVersionId: 'pv1' });
      const exc = await service.createAcademicException({
        studentId: 's1', programAssignmentId: 'pa-1', exceptionType: 'other', rationale: 'Test',
      });
      const result = await service.revokeAcademicException({ exceptionId: exc.id });
      expect(result.status).toBe('revoked');
    });

    it('rejects revoking already revoked exception', async () => {
      await service.assignProgram({ studentId: 's1', programVersionId: 'pv1' });
      const exc = await service.createAcademicException({
        studentId: 's1', programAssignmentId: 'pa-1', exceptionType: 'other', rationale: 'Test',
      });
      await service.revokeAcademicException({ exceptionId: exc.id });
      await expect(service.revokeAcademicException({ exceptionId: exc.id }))
        .rejects.toThrow(/Only active/);
    });
  });

  // ── Read Model ────────────────────────────────────────────────────────────────

  describe('getStudentAcademicRecord', () => {
    it('returns coherent structure', async () => {
      await service.assignProgram({ studentId: 's1', programVersionId: 'pv1' });
      await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T' });
      await service.createCreditRecord({ sourceId: 'src-1', rawTitle: 'Test Course' });
      const record = await service.getStudentAcademicRecord('s1');
      expect(record.student.id).toBe('s1');
      expect(record.activeProgramAssignment).toBeTruthy();
      expect(record.academicSources).toHaveLength(1);
      expect(record.creditRecords).toHaveLength(1);
      expect(record.activeExceptions).toEqual([]);
    });

    it('rejects missing student', async () => {
      await expect(service.getStudentAcademicRecord('missing'))
        .rejects.toThrow(/Student not found/);
    });
  });

  // ── Regression tests for Phase 2B corrections ──────────────────────────────────

  describe('source provenance validation', () => {
    it('rejects nonexistent issuing institution', async () => {
      await expect(service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T', issuingInstitutionId: 'missing' }))
        .rejects.toThrow(/Issuing institution not found/);
    });

    it('rejects nonexistent issuing provider', async () => {
      await expect(service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T', issuingProviderId: 'missing' }))
        .rejects.toThrow(/Issuing credit provider not found/);
    });

    it('accepts valid issuing institution', async () => {
      const result = await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T', issuingInstitutionId: 'inst-1' });
      expect(result.issuingInstitutionId).toBe('inst-1');
    });
  });

  describe('credit course version validation', () => {
    it('rejects nonexistent institution course version', async () => {
      await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T' });
      await expect(service.createCreditRecord({ sourceId: 'src-1', rawTitle: 'Test', institutionCourseVersionId: 'missing' }))
        .rejects.toThrow(/Institution course version not found/);
    });

    it('rejects nonexistent provider course version', async () => {
      await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T' });
      await expect(service.createCreditRecord({ sourceId: 'src-1', rawTitle: 'Test', providerCourseVersionId: 'missing' }))
        .rejects.toThrow(/Provider course version not found/);
    });

    it('accepts valid course version references', async () => {
      await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T' });
      const result = await service.createCreditRecord({ sourceId: 'src-1', rawTitle: 'Test', institutionCourseVersionId: 'icv-1' });
      expect(result.institutionCourseVersionId).toBe('icv-1');
    });
  });

  describe('academic rule scoping', () => {
    beforeEach(async () => {
      await service.assignProgram({ studentId: 's1', programVersionId: 'pv1' });
    });

    it('rejects program-specific rule from another program version', async () => {
      await expect(service.createAcademicException({
        studentId: 's1', programAssignmentId: 'pa-1', exceptionType: 'other', academicRuleId: 'ar-other-pv', rationale: 'Test',
      })).rejects.toThrow(/different program version/);
    });

    it('rejects institution-wide rule from another institution', async () => {
      await expect(service.createAcademicException({
        studentId: 's1', programAssignmentId: 'pa-1', exceptionType: 'other', academicRuleId: 'ar-other-inst', rationale: 'Test',
      })).rejects.toThrow(/different institution/);
    });

    it('accepts program-specific rule matching assignment program version', async () => {
      const result = await service.createAcademicException({
        studentId: 's1', programAssignmentId: 'pa-1', exceptionType: 'other', academicRuleId: 'ar-1', rationale: 'Test',
      });
      expect(result.status).toBe('active');
    });

    it('accepts institution-wide rule matching assignment institution', async () => {
      const result = await service.createAcademicException({
        studentId: 's1', programAssignmentId: 'pa-1', exceptionType: 'other', academicRuleId: 'ar-inst', rationale: 'Test',
      });
      expect(result.status).toBe('active');
    });
  });

  describe('supersede exception validation', () => {
    it('invalid replacement leaves old exception active', async () => {
      await service.assignProgram({ studentId: 's1', programVersionId: 'pv1' });
      const old = await service.createAcademicException({
        studentId: 's1', programAssignmentId: 'pa-1', exceptionType: 'other', rationale: 'Old',
      });
      // Attempt supersede with invalid academic rule
      await expect(service.supersedeAcademicException({
        oldExceptionId: old.id, exceptionType: 'other', academicRuleId: 'ar-other-inst', rationale: 'Invalid replacement',
      })).rejects.toThrow(/different institution/);
      // Old exception should remain active
      const check = await repo.getException(old.id);
      expect(check.status).toBe('active');
    });
  });

  describe('batch read model', () => {
    it('returns same correct latest seq results', async () => {
      await service.assignProgram({ studentId: 's1', programVersionId: 'pv1' });
      await service.createAcademicSource({ studentId: 's1', sourceType: 'transcript', title: 'T' });
      await service.createCreditRecord({ sourceId: 'src-1', rawTitle: 'Course 1' });
      await service.recordCreditVerification({ creditRecordId: 'cr-1', action: 'submitted' });
      await service.recordCreditVerification({ creditRecordId: 'cr-1', action: 'verified' });

      const record = await service.getStudentAcademicRecord('s1');
      expect(record.latestVerifications['cr-1']).toBeTruthy();
      expect(record.latestVerifications['cr-1'].action).toBe('verified');
    });
  });
});
