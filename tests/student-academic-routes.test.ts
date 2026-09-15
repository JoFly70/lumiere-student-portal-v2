/**
 * Phase 2C — Student Academic Record API Route Tests
 *
 * Tests the ACTUAL student-academic router with REAL requireAuth + requireRole.
 * Only mocks dependencies BEHIND authentication:
 *   - database user lookup (db.select)
 *   - Supabase auth fallback (always rejects, forcing local JWT path)
 *   - Student Academic Service (boundary mock)
 *   - audit persistence (createAuditLog no-op)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { StudentAcademicError } from '../server/lib/student-academic-errors';

// ── Test user IDs ────────────────────────────────────────────────────────────────

const ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const STAFF_ID = '00000000-0000-0000-0000-000000000002';
const STUDENT_ID = '00000000-0000-0000-0000-000000000003';
const COACH_ID = '00000000-0000-0000-0000-000000000004';
const VALID_UUID = '12345678-1234-1234-1234-123456789012';
const ANOTHER_UUID = '87654321-4321-4321-4321-210987654321';
const STUDENT_PK = 'student-text-pk-001';

const JWT_SECRET = process.env.SESSION_SECRET || 'local-dev-secret-change-in-production';

function makeLocalJWT(userId: string, email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    userId,
    email,
    iss: 'lumiere-local',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    sub: userId,
    aud: 'authenticated',
    role: 'authenticated',
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

// ── Mock the Student Academic Service ───────────────────────────────────────────

const mockService = vi.hoisted(() => ({
  assignProgram: vi.fn(),
  switchProgramAssignment: vi.fn(),
  createAcademicSource: vi.fn(),
  transitionAcademicSource: vi.fn(),
  createCreditRecord: vi.fn(),
  correctCreditRecord: vi.fn(),
  recordCreditVerification: vi.fn(),
  recordCreditDecision: vi.fn(),
  createAcademicException: vi.fn(),
  supersedeAcademicException: vi.fn(),
  revokeAcademicException: vi.fn(),
  getStudentAcademicRecord: vi.fn(),
  getStudentAcademicRecordForUser: vi.fn(),
}));

vi.mock('../server/services/student-academic-service', () => ({
  studentAcademicService: mockService,
  createStudentAcademicService: vi.fn(() => mockService),
}));

// ── Mock audit ──────────────────────────────────────────────────────────────────

const mockAudit = vi.hoisted(() => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  auditAdmin: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../server/lib/audit', () => ({
  createAuditLog: mockAudit.createAuditLog,
  auditAdmin: mockAudit.auditAdmin,
}));

// ── Mock supabase so requireAuth uses local JWT path only ───────────────────────

vi.mock('../server/lib/supabase', () => ({
  supabaseAdmin: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: 'mock-no-supabase' }) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ range: vi.fn(() => ({ data: [], error: null, count: 0 })) })) })),
      insert: vi.fn(() => ({ error: null })),
    })),
  },
  isSupabaseConfigured: false,
}));

// ── Mock db to return user rows for requireAuth ─────────────────────────────────

const userRows = new Map<string, { id: string; email: string; name: string; role: string }>([
  [ADMIN_ID, { id: ADMIN_ID, email: 'admin@test.com', name: 'Admin', role: 'admin' }],
  [STAFF_ID, { id: STAFF_ID, email: 'staff@test.com', name: 'Staff', role: 'staff' }],
  [STUDENT_ID, { id: STUDENT_ID, email: 'student@test.com', name: 'Student', role: 'student' }],
  [COACH_ID, { id: COACH_ID, email: 'coach@test.com', name: 'Coach', role: 'coach' }],
]);

vi.mock('../server/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => currentUserRow),
        })),
      })),
    })),
    transaction: vi.fn(async (fn: any) => fn({})),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => []) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => []) })) })) })),
    execute: vi.fn(async () => {}),
  },
}));

let currentUserRow: { id: string; email: string; name: string; role: string }[] = [];

// ── Test app factory ─────────────────────────────────────────────────────────────

async function createTestApp(userRole: string | null, userId: string = ADMIN_ID): Promise<{ app: Express; token: string | null }> {
  const app = express();
  app.use(express.json());

  let token: string | null = null;
  if (userRole !== null) {
    const email = userRole === 'admin' ? 'admin@test.com'
      : userRole === 'staff' ? 'staff@test.com'
      : userRole === 'student' ? 'student@test.com'
      : 'coach@test.com';
    token = makeLocalJWT(userId, email);
    currentUserRow = userRows.get(userId) ? [userRows.get(userId)!] : [];
  } else {
    currentUserRow = [];
  }
  const { default: internalRouter, studentSelfRouter } = await import('../server/routes/student-academic');
  app.use('/api/admin/student-academic', internalRouter);
  app.use('/api/student', studentSelfRouter);

  return { app, token };
}

// Warm the router import at module load so the first test in the file
// doesn't pay module-graph cost inside vitest's 5s per-test window.
await import('../server/routes/student-academic');

// ── Full internal record fixture ────────────────────────────────────────────────

const fullRecord = {
  student: { id: STUDENT_PK, student_code: 'SC-1', first_name: 'Test', middle_name: null, last_name: 'Student', preferred_name: null, status: 'active' },
  activeProgramAssignment: { id: VALID_UUID, status: 'active', cohortLabel: 'C1', assignedAt: new Date(), endedAt: null },
  programVersion: {
    version: { id: VALID_UUID, versionLabel: 'v1' },
    program: { id: ANOTHER_UUID, code: 'PROG', name: 'Program' },
    institution: { id: VALID_UUID, name: 'Inst' },
  },
  academicSources: [],
  creditRecords: [],
  latestVerifications: {},
  latestDecisions: {},
  activeExceptions: [],
};

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('Phase 2C — Student Academic Record API Routes', () => {
  let app: Express;
  let token: string | null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService.assignProgram.mockResolvedValue({ id: VALID_UUID, status: 'active', studentId: STUDENT_PK });
    mockService.switchProgramAssignment.mockResolvedValue({ oldAssignment: { id: VALID_UUID, status: 'superseded' }, newAssignment: { id: ANOTHER_UUID, status: 'active' } });
    mockService.createAcademicSource.mockResolvedValue({ id: VALID_UUID, status: 'received', studentId: STUDENT_PK });
    mockService.transitionAcademicSource.mockResolvedValue({ id: VALID_UUID, status: 'extracted', studentId: STUDENT_PK });
    mockService.createCreditRecord.mockResolvedValue({ id: VALID_UUID, status: 'extracted', studentId: STUDENT_PK });
    mockService.correctCreditRecord.mockResolvedValue({ id: VALID_UUID, status: 'extracted', studentId: STUDENT_PK });
    mockService.recordCreditVerification.mockResolvedValue({ id: VALID_UUID, action: 'verified' });
    mockService.recordCreditDecision.mockResolvedValue({ id: VALID_UUID, action: 'accepted' });
    mockService.createAcademicException.mockResolvedValue({ id: VALID_UUID, status: 'active', studentId: STUDENT_PK });
    mockService.supersedeAcademicException.mockResolvedValue({ oldException: { id: VALID_UUID, status: 'superseded' }, newException: { id: ANOTHER_UUID, status: 'active', studentId: STUDENT_PK } });
    mockService.revokeAcademicException.mockResolvedValue({ id: VALID_UUID, status: 'revoked', studentId: STUDENT_PK });
    mockService.getStudentAcademicRecord.mockResolvedValue(fullRecord);
    mockService.getStudentAcademicRecordForUser.mockResolvedValue(fullRecord);
    mockAudit.createAuditLog.mockResolvedValue(undefined);
  });

  // ── AUTH / RBAC ─────────────────────────────────────────────────────────────

  describe('Auth/RBAC (real middleware)', () => {
    it('1. unauthenticated internal GET → 401', async () => {
      ({ app, token } = await createTestApp(null));
      const res = await request(app).get(`/api/admin/student-academic/students/${STUDENT_PK}`);
      expect(res.status).toBe(401);
    });

    it('2. student internal GET → 403', async () => {
      ({ app, token } = await createTestApp('student', STUDENT_ID));
      const res = await request(app).get(`/api/admin/student-academic/students/${STUDENT_PK}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('3. coach internal GET → 403', async () => {
      ({ app, token } = await createTestApp('coach', COACH_ID));
      const res = await request(app).get(`/api/admin/student-academic/students/${STUDENT_PK}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('4. staff internal GET → 200', async () => {
      ({ app, token } = await createTestApp('staff', STAFF_ID));
      const res = await request(app).get(`/api/admin/student-academic/students/${STUDENT_PK}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('5. admin internal GET → 200', async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
      const res = await request(app).get(`/api/admin/student-academic/students/${STUDENT_PK}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('6. staff mutation reaches service', async () => {
      ({ app, token } = await createTestApp('staff', STAFF_ID));
      const res = await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/program-assignments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ programVersionId: VALID_UUID });
      expect(res.status).toBe(201);
      expect(mockService.assignProgram).toHaveBeenCalled();
    });

    it('7. admin mutation reaches service', async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
      const res = await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/program-assignments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ programVersionId: VALID_UUID });
      expect(res.status).toBe(201);
      expect(mockService.assignProgram).toHaveBeenCalled();
    });

    it('8. coach mutation → 403', async () => {
      ({ app, token } = await createTestApp('coach', COACH_ID));
      const res = await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/program-assignments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ programVersionId: VALID_UUID });
      expect(res.status).toBe(403);
    });

    it('9. student mutation → 403', async () => {
      ({ app, token } = await createTestApp('student', STUDENT_ID));
      const res = await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/program-assignments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ programVersionId: VALID_UUID });
      expect(res.status).toBe(403);
    });
  });

  // ── STUDENT SELF ─────────────────────────────────────────────────────────────

  describe('Student self-read', () => {
    it('10. unauthenticated self GET → 401', async () => {
      ({ app, token } = await createTestApp(null));
      const res = await request(app).get('/api/student/academic-record');
      expect(res.status).toBe(401);
    });

    it('11. student self GET → 200', async () => {
      ({ app, token } = await createTestApp('student', STUDENT_ID));
      const res = await request(app).get('/api/student/academic-record').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('12. self route calls service using req.user.id', async () => {
      ({ app, token } = await createTestApp('student', STUDENT_ID));
      await request(app).get('/api/student/academic-record').set('Authorization', `Bearer ${token}`);
      expect(mockService.getStudentAcademicRecordForUser).toHaveBeenCalledWith(STUDENT_ID);
    });

    it('13. self route has no client-selected student ID', async () => {
      ({ app, token } = await createTestApp('student', STUDENT_ID));
      await request(app).get('/api/student/academic-record?studentId=attacker').set('Authorization', `Bearer ${token}`);
      expect(mockService.getStudentAcademicRecordForUser).toHaveBeenCalledWith(STUDENT_ID);
      expect(mockService.getStudentAcademicRecord).not.toHaveBeenCalled();
    });

    it('14. coach self GET → 403', async () => {
      ({ app, token } = await createTestApp('coach', COACH_ID));
      const res = await request(app).get('/api/student/academic-record').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('15. staff self GET → 403', async () => {
      ({ app, token } = await createTestApp('staff', STAFF_ID));
      const res = await request(app).get('/api/student/academic-record').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('16. admin self GET → 403', async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
      const res = await request(app).get('/api/student/academic-record').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ── STUDENT-SAFE PROJECTION ─────────────────────────────────────────────────

  describe('Student-safe projection', () => {
    beforeEach(async () => {
      ({ app, token } = await createTestApp('student', STUDENT_ID));
      mockService.getStudentAcademicRecordForUser.mockResolvedValue({
        ...fullRecord,
        academicSources: [{ id: VALID_UUID, sourceType: 'transcript', status: 'received', title: 'T', sourceDate: null, receivedAt: null, createdBy: 'staff-actor' }],
        creditRecords: [{ id: VALID_UUID, recordType: 'course', status: 'verified', rawCourseCode: 'C1', rawTitle: 'Course', rawCredits: '3.00', rawGrade: 'A', rawLevel: null, term: null, completedOn: null, normalizedCredits: null, normalizedLevel: null }],
        latestVerifications: { [VALID_UUID]: { id: VALID_UUID, creditRecordId: VALID_UUID, action: 'verified', reviewerId: 'reviewer-actor', rationale: 'internal', snapshot: { secret: true }, seq: 1 } },
        latestDecisions: { [VALID_UUID]: { id: VALID_UUID, creditRecordId: VALID_UUID, programAssignmentId: VALID_UUID, action: 'accepted', creditsAwarded: '3.00', levelAwarded: null, decidedBy: 'decider-actor', rationale: 'internal', metadata: { secret: true }, seq: 1 } },
        activeExceptions: [{ id: VALID_UUID, exceptionType: 'other', status: 'active', effectiveFrom: null, effectiveTo: null, approvedBy: 'approver-actor', rationale: 'internal' }],
      });
    });

    it('17. omits reviewerId', async () => {
      const res = await request(app).get('/api/student/academic-record').set('Authorization', `Bearer ${token}`);
      expect(JSON.stringify(res.body)).not.toContain('reviewerId');
      expect(JSON.stringify(res.body)).not.toContain('reviewer-actor');
    });

    it('18. omits decidedBy', async () => {
      const res = await request(app).get('/api/student/academic-record').set('Authorization', `Bearer ${token}`);
      expect(JSON.stringify(res.body)).not.toContain('decidedBy');
      expect(JSON.stringify(res.body)).not.toContain('decider-actor');
    });

    it('19. omits approvedBy', async () => {
      const res = await request(app).get('/api/student/academic-record').set('Authorization', `Bearer ${token}`);
      expect(JSON.stringify(res.body)).not.toContain('approvedBy');
      expect(JSON.stringify(res.body)).not.toContain('approver-actor');
    });

    it('20. omits rationale/snapshot/metadata/internal actor fields', async () => {
      const res = await request(app).get('/api/student/academic-record').set('Authorization', `Bearer ${token}`);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('rationale');
      expect(body).not.toContain('snapshot');
      expect(body).not.toContain('metadata');
      expect(body).not.toContain('createdBy');
      expect(body).not.toContain('staff-actor');
    });
  });

  // ── INPUT SECURITY ──────────────────────────────────────────────────────────

  describe('Input security', () => {
    beforeEach(async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
    });

    it('21. malformed UUID path → 400', async () => {
      const res = await request(app).post('/api/admin/student-academic/sources/not-a-uuid/transition')
        .set('Authorization', `Bearer ${token}`)
        .send({ newStatus: 'extracted' });
      expect(res.status).toBe(400);
    });

    it('22. invalid enum → 400', async () => {
      const res = await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/sources`)
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceType: 'garbage', title: 'T' });
      expect(res.status).toBe(400);
    });

    it('23. invalid date → 400', async () => {
      const res = await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/sources`)
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceType: 'transcript', title: 'T', sourceDate: '01/15/2025' });
      expect(res.status).toBe(400);
    });

    it('24. invalid credit decimal → 400', async () => {
      const res = await request(app).post(`/api/admin/student-academic/sources/${VALID_UUID}/credit-records`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rawTitle: 'T', rawCredits: '-5' });
      expect(res.status).toBe(400);
    });

    it('25. actor spoof assignedBy → 400', async () => {
      const res = await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/program-assignments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ programVersionId: VALID_UUID, assignedBy: 'attacker' });
      expect(res.status).toBe(400);
    });

    it('26. actor spoof createdBy → 400', async () => {
      const res = await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/sources`)
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceType: 'transcript', title: 'T', createdBy: 'attacker' });
      expect(res.status).toBe(400);
    });

    it('27. actor spoof reviewerId → 400', async () => {
      const res = await request(app).post(`/api/admin/student-academic/credit-records/${VALID_UUID}/verifications`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'verified', reviewerId: 'attacker' });
      expect(res.status).toBe(400);
    });

    it('28. actor spoof decidedBy → 400', async () => {
      const res = await request(app).post(`/api/admin/student-academic/credit-records/${VALID_UUID}/decisions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ programAssignmentId: ANOTHER_UUID, action: 'accepted', creditsAwarded: '3.00', decidedBy: 'attacker' });
      expect(res.status).toBe(400);
    });

    it('29. actor spoof approvedBy → 400', async () => {
      const res = await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/exceptions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ programAssignmentId: ANOTHER_UUID, exceptionType: 'other', rationale: 'R', approvedBy: 'attacker' });
      expect(res.status).toBe(400);
    });

    it('30. spoof studentId/body-derived identity → 400', async () => {
      const res = await request(app).post(`/api/admin/student-academic/sources/${VALID_UUID}/credit-records`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rawTitle: 'T', studentId: 'attacker' });
      expect(res.status).toBe(400);
    });

    it('31. unknown mutation property → 400', async () => {
      const res = await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/program-assignments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ programVersionId: VALID_UUID, status: 'active' });
      expect(res.status).toBe(400);
    });

    it('32. empty correction PATCH → 400', async () => {
      const res = await request(app).patch(`/api/admin/student-academic/credit-records/${VALID_UUID}/correct`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rationale: 'nothing to correct' });
      expect(res.status).toBe(400);
    });
  });

  // ── ACTOR DERIVATION ────────────────────────────────────────────────────────

  describe('Actor derivation', () => {
    beforeEach(async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
    });

    it('33. assign uses req.user.id', async () => {
      await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/program-assignments`)
        .set('Authorization', `Bearer ${token}`).send({ programVersionId: VALID_UUID });
      expect(mockService.assignProgram.mock.calls[0][0].assignedBy).toBe(ADMIN_ID);
    });

    it('34. source creation uses req.user.id', async () => {
      await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/sources`)
        .set('Authorization', `Bearer ${token}`).send({ sourceType: 'transcript', title: 'T' });
      expect(mockService.createAcademicSource.mock.calls[0][0].createdBy).toBe(ADMIN_ID);
    });

    it('35. correction uses req.user.id', async () => {
      await request(app).patch(`/api/admin/student-academic/credit-records/${VALID_UUID}/correct`)
        .set('Authorization', `Bearer ${token}`).send({ rawTitle: 'Fixed' });
      expect(mockService.correctCreditRecord.mock.calls[0][0].reviewerId).toBe(ADMIN_ID);
    });

    it('36. verification uses req.user.id', async () => {
      await request(app).post(`/api/admin/student-academic/credit-records/${VALID_UUID}/verifications`)
        .set('Authorization', `Bearer ${token}`).send({ action: 'verified' });
      expect(mockService.recordCreditVerification.mock.calls[0][0].reviewerId).toBe(ADMIN_ID);
    });

    it('37. decision uses req.user.id', async () => {
      await request(app).post(`/api/admin/student-academic/credit-records/${VALID_UUID}/decisions`)
        .set('Authorization', `Bearer ${token}`).send({ programAssignmentId: ANOTHER_UUID, action: 'accepted', creditsAwarded: '3.00' });
      expect(mockService.recordCreditDecision.mock.calls[0][0].decidedBy).toBe(ADMIN_ID);
    });

    it('38. exception create/supersede uses req.user.id', async () => {
      await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/exceptions`)
        .set('Authorization', `Bearer ${token}`).send({ programAssignmentId: ANOTHER_UUID, exceptionType: 'other', rationale: 'R' });
      expect(mockService.createAcademicException.mock.calls[0][0].approvedBy).toBe(ADMIN_ID);

      await request(app).post(`/api/admin/student-academic/exceptions/${VALID_UUID}/supersede`)
        .set('Authorization', `Bearer ${token}`).send({ exceptionType: 'other', rationale: 'R2' });
      expect(mockService.supersedeAcademicException.mock.calls[0][0].approvedBy).toBe(ADMIN_ID);
    });
  });

  // ── ERROR MAPPING ───────────────────────────────────────────────────────────

  describe('Error mapping', () => {
    beforeEach(async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
    });

    it('39. validation error → 400', async () => {
      mockService.assignProgram.mockRejectedValueOnce(new StudentAcademicError('STUDENT_ACADEMIC_VALIDATION_ERROR', 'Bad'));
      const res = await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/program-assignments`)
        .set('Authorization', `Bearer ${token}`).send({ programVersionId: VALID_UUID });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('STUDENT_ACADEMIC_VALIDATION_ERROR');
    });

    it('40. not found → 404', async () => {
      mockService.getStudentAcademicRecord.mockRejectedValueOnce(new StudentAcademicError('STUDENT_ACADEMIC_NOT_FOUND', 'Missing'));
      const res = await request(app).get(`/api/admin/student-academic/students/${STUDENT_PK}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('STUDENT_ACADEMIC_NOT_FOUND');
    });

    it('41. duplicate → 409', async () => {
      mockService.assignProgram.mockRejectedValueOnce(new StudentAcademicError('STUDENT_ACADEMIC_DUPLICATE', 'Dup'));
      const res = await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/program-assignments`)
        .set('Authorization', `Bearer ${token}`).send({ programVersionId: VALID_UUID });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('STUDENT_ACADEMIC_DUPLICATE');
    });

    it('42. invalid state → 409', async () => {
      mockService.transitionAcademicSource.mockRejectedValueOnce(new StudentAcademicError('STUDENT_ACADEMIC_INVALID_STATE', 'State'));
      const res = await request(app).post(`/api/admin/student-academic/sources/${VALID_UUID}/transition`)
        .set('Authorization', `Bearer ${token}`).send({ newStatus: 'extracted' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('STUDENT_ACADEMIC_INVALID_STATE');
    });

    it('43. verification required → 409', async () => {
      mockService.recordCreditDecision.mockRejectedValueOnce(new StudentAcademicError('STUDENT_ACADEMIC_VERIFICATION_REQUIRED', 'Verify'));
      const res = await request(app).post(`/api/admin/student-academic/credit-records/${VALID_UUID}/decisions`)
        .set('Authorization', `Bearer ${token}`).send({ programAssignmentId: ANOTHER_UUID, action: 'accepted', creditsAwarded: '3.00' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('STUDENT_ACADEMIC_VERIFICATION_REQUIRED');
    });

    it('44. provenance mismatch → 409', async () => {
      mockService.recordCreditDecision.mockRejectedValueOnce(new StudentAcademicError('STUDENT_ACADEMIC_PROVENANCE_MISMATCH', 'Mismatch'));
      const res = await request(app).post(`/api/admin/student-academic/credit-records/${VALID_UUID}/decisions`)
        .set('Authorization', `Bearer ${token}`).send({ programAssignmentId: ANOTHER_UUID, action: 'accepted', creditsAwarded: '3.00' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('STUDENT_ACADEMIC_PROVENANCE_MISMATCH');
    });

    it('45. unexpected error → sanitized 500', async () => {
      mockService.getStudentAcademicRecord.mockRejectedValueOnce(new Error('DB connection failed with password secret'));
      const res = await request(app).get(`/api/admin/student-academic/students/${STUDENT_PK}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).not.toContain('DB');
      expect(res.body.error.message).not.toContain('secret');
    });
  });

  // ── AUDIT ───────────────────────────────────────────────────────────────

  describe('Audit', () => {
    beforeEach(async () => {
      ({ app, token } = await createTestApp('staff', STAFF_ID));
    });

    it('46. successful mutations audited', async () => {
      await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/program-assignments`)
        .set('Authorization', `Bearer ${token}`).send({ programVersionId: VALID_UUID });
      expect(mockAudit.createAuditLog).toHaveBeenCalled();
    });

    it('47. audit actor is authenticated staff/admin user', async () => {
      await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/program-assignments`)
        .set('Authorization', `Bearer ${token}`).send({ programVersionId: VALID_UUID });
      const call = mockAudit.createAuditLog.mock.calls[0][0];
      expect(call.actorUserId).toBe(STAFF_ID);
      expect(call.actorRole).toBe('staff');
    });

    it('48. audit entry marked educational record', async () => {
      await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/program-assignments`)
        .set('Authorization', `Bearer ${token}`).send({ programVersionId: VALID_UUID });
      const call = mockAudit.createAuditLog.mock.calls[0][0];
      expect(call.isEducationalRecord).toBe(true);
    });

    it('49. failed mutation is not recorded as successful mutation', async () => {
      mockService.assignProgram.mockRejectedValueOnce(new StudentAcademicError('STUDENT_ACADEMIC_DUPLICATE', 'Dup'));
      await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/program-assignments`)
        .set('Authorization', `Bearer ${token}`).send({ programVersionId: VALID_UUID });
      expect(mockAudit.createAuditLog).not.toHaveBeenCalled();
    });

    it('50. students.id is never passed as targetUserId (FK is users.id)', async () => {
      await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/program-assignments`)
        .set('Authorization', `Bearer ${token}`).send({ programVersionId: VALID_UUID });
      const call = mockAudit.createAuditLog.mock.calls[0][0];
      expect(call.targetUserId).toBeUndefined();
      expect(call.targetUserId).not.toBe(STUDENT_PK);
      // 'target_user_id' key must not be set to a students.id value
      expect(call.target_user_id).toBeUndefined();
    });

    it('51. known studentId stored in audit metadata, not targetUserId', async () => {
      await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/program-assignments`)
        .set('Authorization', `Bearer ${token}`).send({ programVersionId: VALID_UUID });
      const call = mockAudit.createAuditLog.mock.calls[0][0];
      expect(call.metadata.studentId).toBe(STUDENT_PK);
      expect(call.targetUserId).toBeUndefined();
    });

    it('52. audit metadata merged with route metadata without sensitive fields', async () => {
      await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/sources`)
        .set('Authorization', `Bearer ${token}`).send({ sourceType: 'transcript', title: 'T' });
      const call = mockAudit.createAuditLog.mock.calls[0][0];
      expect(call.metadata).toMatchObject({ sourceType: 'transcript', studentId: STUDENT_PK });
      const serialized = JSON.stringify(call.metadata);
      expect(serialized).not.toContain('rationale');
      expect(serialized).not.toContain('title');
    });

    it('53. returned-row studentIds propagate to audit metadata', async () => {
      await request(app).post(`/api/admin/student-academic/sources/${VALID_UUID}/transition`)
        .set('Authorization', `Bearer ${token}`).send({ newStatus: 'extracted' });
      expect(mockAudit.createAuditLog.mock.calls[0][0].metadata.studentId).toBe(STUDENT_PK);

      await request(app).post(`/api/admin/student-academic/sources/${VALID_UUID}/credit-records`)
        .set('Authorization', `Bearer ${token}`).send({ rawTitle: 'T' });
      expect(mockAudit.createAuditLog.mock.calls[1][0].metadata.studentId).toBe(STUDENT_PK);

      await request(app).patch(`/api/admin/student-academic/credit-records/${VALID_UUID}/correct`)
        .set('Authorization', `Bearer ${token}`).send({ rawTitle: 'Fixed' });
      expect(mockAudit.createAuditLog.mock.calls[2][0].metadata.studentId).toBe(STUDENT_PK);

      await request(app).post(`/api/admin/student-academic/exceptions/${VALID_UUID}/supersede`)
        .set('Authorization', `Bearer ${token}`).send({ exceptionType: 'other', rationale: 'R' });
      expect(mockAudit.createAuditLog.mock.calls[3][0].metadata.studentId).toBe(STUDENT_PK);

      await request(app).post(`/api/admin/student-academic/exceptions/${VALID_UUID}/revoke`)
        .set('Authorization', `Bearer ${token}`);
      expect(mockAudit.createAuditLog.mock.calls[4][0].metadata.studentId).toBe(STUDENT_PK);
    });

    it('54. admin actor role recorded for admin', async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
      await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/program-assignments`)
        .set('Authorization', `Bearer ${token}`).send({ programVersionId: VALID_UUID });
      const call = mockAudit.createAuditLog.mock.calls[0][0];
      expect(call.actorUserId).toBe(ADMIN_ID);
      expect(call.actorRole).toBe('admin');
      expect(call.isEducationalRecord).toBe(true);
    });
  });

  // ── NO DELETE ───────────────────────────────────────────────────────────────

  describe('No delete', () => {
    it('50. DELETE requests have no supported mutation route', async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
      const paths = [
        `/api/admin/student-academic/students/${STUDENT_PK}`,
        `/api/admin/student-academic/students/${STUDENT_PK}/program-assignments`,
        `/api/admin/student-academic/sources/${VALID_UUID}`,
        `/api/admin/student-academic/credit-records/${VALID_UUID}`,
        `/api/admin/student-academic/exceptions/${VALID_UUID}`,
      ];
      for (const path of paths) {
        const res = await request(app).delete(path).set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(404);
      }
    });
  });

  // ── REVOKE STRICT EMPTY BODY ──────────────────────────────────────────────

  describe('Revoke strict empty body', () => {
    beforeEach(async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
    });

    it('55. empty body succeeds', async () => {
      const res = await request(app).post(`/api/admin/student-academic/exceptions/${VALID_UUID}/revoke`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(mockService.revokeAcademicException).toHaveBeenCalledWith({ exceptionId: VALID_UUID });
    });

    it('56. empty JSON object body succeeds', async () => {
      const res = await request(app).post(`/api/admin/student-academic/exceptions/${VALID_UUID}/revoke`)
        .set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(200);
    });

    const rejectedFields = ['approvedBy', 'studentId', 'status', 'metadata', 'rationale', 'unknownField'];
    for (const field of rejectedFields) {
      it(`57. revoke rejects body field "${field}" → 400`, async () => {
        const res = await request(app).post(`/api/admin/student-academic/exceptions/${VALID_UUID}/revoke`)
          .set('Authorization', `Bearer ${token}`).send({ [field]: 'x' });
        expect(res.status).toBe(400);
        expect(mockService.revokeAcademicException).not.toHaveBeenCalled();
      });
    }
  });

  // ── SEMANTIC DATE VALIDATION ──────────────────────────────────────────────

  describe('Semantic date validation (Zod 3.24)', () => {
    beforeEach(async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
    });

    it('58. impossible date 2025-02-30 → 400', async () => {
      const res = await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/sources`)
        .set('Authorization', `Bearer ${token}`).send({ sourceType: 'transcript', title: 'T', sourceDate: '2025-02-30' });
      expect(res.status).toBe(400);
      expect(mockService.createAcademicSource).not.toHaveBeenCalled();
    });

    it('59. impossible date 2025-13-01 → 400', async () => {
      const res = await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/sources`)
        .set('Authorization', `Bearer ${token}`).send({ sourceType: 'transcript', title: 'T', sourceDate: '2025-13-01' });
      expect(res.status).toBe(400);
    });

    it('60. valid leap day 2024-02-29 accepted', async () => {
      const res = await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/sources`)
        .set('Authorization', `Bearer ${token}`).send({ sourceType: 'transcript', title: 'T', sourceDate: '2024-02-29' });
      expect(res.status).toBe(201);
      expect(mockService.createAcademicSource.mock.calls[0][0].sourceDate).toBe('2024-02-29');
    });

    it('61. impossible datetime 2025-02-30T10:00:00Z → 400', async () => {
      const res = await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/exceptions`)
        .set('Authorization', `Bearer ${token}`).send({ programAssignmentId: ANOTHER_UUID, exceptionType: 'other', rationale: 'R', effectiveFrom: '2025-02-30T10:00:00Z' });
      expect(res.status).toBe(400);
      expect(mockService.createAcademicException).not.toHaveBeenCalled();
    });

    it('62. invalid datetime hour 2025-01-15T25:00:00Z → 400', async () => {
      const res = await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/exceptions`)
        .set('Authorization', `Bearer ${token}`).send({ programAssignmentId: ANOTHER_UUID, exceptionType: 'other', rationale: 'R', effectiveFrom: '2025-01-15T25:00:00Z' });
      expect(res.status).toBe(400);
    });

    it('63. valid Z datetime transformed to Date', async () => {
      await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/exceptions`)
        .set('Authorization', `Bearer ${token}`).send({ programAssignmentId: ANOTHER_UUID, exceptionType: 'other', rationale: 'R', effectiveFrom: '2025-01-15T10:00:00Z' });
      expect(mockService.createAcademicException).toHaveBeenCalled();
      expect(mockService.createAcademicException.mock.calls[0][0].effectiveFrom).toBeInstanceOf(Date);
    });

    it('64. valid offset datetime transformed to Date', async () => {
      await request(app).post(`/api/admin/student-academic/students/${STUDENT_PK}/exceptions`)
        .set('Authorization', `Bearer ${token}`).send({ programAssignmentId: ANOTHER_UUID, exceptionType: 'other', rationale: 'R', effectiveFrom: '2025-01-15T10:00:00+02:00' });
      expect(mockService.createAcademicException).toHaveBeenCalled();
      expect(mockService.createAcademicException.mock.calls[0][0].effectiveFrom).toBeInstanceOf(Date);
    });
  });

  // ── STUDENT ID NORMALIZATION ──────────────────────────────────────────────

  describe('Student ID normalization', () => {
    beforeEach(async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
    });

    it('65. trimmed studentId used for service and audit', async () => {
      const rawId = encodeURIComponent(` ${STUDENT_PK} `);
      const res = await request(app).post(`/api/admin/student-academic/students/${rawId}/program-assignments`)
        .set('Authorization', `Bearer ${token}`).send({ programVersionId: VALID_UUID });
      expect(res.status).toBe(201);
      expect(mockService.assignProgram.mock.calls[0][0].studentId).toBe(STUDENT_PK);
      const auditCall = mockAudit.createAuditLog.mock.calls[0][0];
      expect(auditCall.metadata.studentId).toBe(STUDENT_PK);
    });

    it('66. whitespace-only studentId → 400', async () => {
      const rawId = encodeURIComponent('   ');
      const res = await request(app).get(`/api/admin/student-academic/students/${rawId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });
  });

  // ── PRODUCTION MOUNT ORDER ─────────────────────────────────────────────────

  describe('Production mount order (registerRoutes)', () => {
    it('staff GET /api/admin/student-academic → 200 while staff GET /api/admin/users → 403', async () => {
      currentUserRow = [userRows.get(STAFF_ID)!];
      const staffToken = makeLocalJWT(STAFF_ID, 'staff@test.com');

      vi.doMock('../server/middleware/rate-limit', () => ({
        authRateLimit: (req: unknown, res: unknown, next: () => void) => next(),
        passwordResetRateLimit: (req: unknown, res: unknown, next: () => void) => next(),
        signupRateLimit: (req: unknown, res: unknown, next: () => void) => next(),
        apiRateLimit: (req: unknown, res: unknown, next: () => void) => next(),
      }));
      vi.doMock('../server/middleware/csrf', () => ({
        generateCsrfToken: vi.fn(() => 'mock-csrf'),
        requireCsrf: (req: unknown, res: unknown, next: () => void) => next(),
        deleteCsrfToken: vi.fn(),
      }));
      vi.doMock('../server/routes/two-factor', () => ({ default: express.Router() }));
      vi.doMock('../server/routes/students', () => ({ default: express.Router() }));
      vi.doMock('../server/routes/documents', () => ({ default: express.Router() }));
      vi.doMock('../server/routes/tickets', () => ({ default: express.Router() }));
      vi.doMock('../server/routes/programs', () => ({ default: express.Router() }));
      vi.doMock('../server/routes/health', () => ({ default: express.Router() }));
      vi.doMock('../server/storage', () => ({ storage: {} }));
      vi.doMock('../server/roadmap-generator', () => ({ generateRoadmap: vi.fn() }));

      const { registerRoutes } = await import('../server/routes');
      const app = express();
      app.use(express.json());
      await registerRoutes(app);

      const saRes = await request(app).get(`/api/admin/student-academic/students/${STUDENT_PK}`)
        .set('Authorization', `Bearer ${staffToken}`);
      expect(saRes.status).toBe(200);

      const adminRes = await request(app).get('/api/admin/users')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(adminRes.status).toBe(403);

      vi.doUnmock('../server/middleware/rate-limit');
      vi.doUnmock('../server/middleware/csrf');
      vi.doUnmock('../server/routes/two-factor');
      vi.doUnmock('../server/routes/students');
      vi.doUnmock('../server/routes/documents');
      vi.doUnmock('../server/routes/tickets');
      vi.doUnmock('../server/routes/programs');
      vi.doUnmock('../server/routes/health');
      vi.doUnmock('../server/storage');
      vi.doUnmock('../server/roadmap-generator');
    });
  });
});
