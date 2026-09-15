/**
 * Phase 4F — Admin Degree Progress API Route Tests
 *
 * Uses the actual requireAuth and requireRole middleware.  Only the
 * Degree Progress Service boundary is mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import crypto from 'crypto';

const ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const STUDENT_ID = '00000000-0000-0000-0000-000000000003';
const VALID_STUDENT_ID = 'student-text-pk-001';
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

const mockService = vi.hoisted(() => ({
  getDegreeProgress: vi.fn(),
}));

const mockResolver = vi.hoisted(() => ({
  resolveContext: vi.fn(),
}));

vi.mock('../server/services/degree-progress-service', () => ({
  getDegreeProgress: mockService.getDegreeProgress,
}));

vi.mock('../server/lib/supabase', () => ({
  supabaseAdmin: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: 'mock-no-supabase' }),
    },
  },
}));

const userRows = new Map([
  [ADMIN_ID, { id: ADMIN_ID, email: 'admin@test.com', name: 'Admin', role: 'admin' }],
  [STUDENT_ID, { id: STUDENT_ID, email: 'student@test.com', name: 'Student', role: 'student' }],
]);

let currentUserRow: typeof userRows extends Map<string, infer T> ? T[] : never[] = [];

vi.mock('../server/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => currentUserRow),
        })),
      })),
    })),
  },
}));

vi.mock('../server/lib/audit', () => ({
  auditAdmin: vi.fn().mockResolvedValue(undefined),
}));

const composedReport = {
  projectionKind: 'INFORMATIONAL_ONLY',
  status: 'COMPOSED',
  contractVersion: '4D.1',
  schemaVersion: '4D.canonical-integration.1',
  context: {
    studentId: VALID_STUDENT_ID,
    programAssignmentId: 'assignment-1',
    programVersionId: 'program-version-1',
  },
  snapshot: {
    fingerprint: 'sha256:canonical-fingerprint',
    asOf: '2025-01-01T00:00:00.000Z',
    contractVersion: '4C.1',
    schemaVersion: '4C.canonical.1',
    context: {
      studentId: VALID_STUDENT_ID,
      programAssignmentId: 'assignment-1',
      programVersionId: 'program-version-1',
    },
    occurrences: [],
  },
  integrationDiagnostics: [
    {
      stage: 'INTEGRATION',
      reason: 'INFORMATIONAL_DIAGNOSTIC',
      code: 'INFORMATIONAL_DIAGNOSTIC',
      ids: ['assignment-1'],
      occurrences: [],
    },
  ],
  phase3Output: {
    compositionKind: 'INFORMATIONAL_ONLY',
    status: 'COMPOSED',
    context: {
      studentId: VALID_STUDENT_ID,
      programAssignmentId: 'assignment-1',
      programVersionId: 'program-version-1',
    },
    summary: { totalRequirements: 1, satisfiedRequirements: 1 },
    requirementResults: [],
  },
};

const manualReviewReport = {
  projectionKind: 'INFORMATIONAL_ONLY',
  status: 'MANUAL_REVIEW',
  contractVersion: '4D.1',
  schemaVersion: '4D.canonical-integration.1',
  context: {
    studentId: VALID_STUDENT_ID,
    programAssignmentId: 'assignment-1',
    programVersionId: 'program-version-1',
  },
  snapshot: null,
  integrationDiagnostics: [
    {
      stage: 'INTEGRATION',
      reason: 'SNAPSHOT_READER_FAILED',
      code: 'SNAPSHOT_READER_FAILED',
      ids: [VALID_STUDENT_ID],
      occurrences: [],
    },
  ],
  phase3Output: null,
};

const activeContext = {
  studentId: VALID_STUDENT_ID,
  programAssignmentId: 'assignment-1',
  programVersionId: 'program-version-1',
};

async function createTestApp(userRole: 'admin' | 'student' | null): Promise<{
  app: Express;
  token: string | null;
}> {
  const app = express();
  app.use(express.json());

  if (userRole === null) {
    currentUserRow = [];
  } else {
    const userId = userRole === 'admin' ? ADMIN_ID : STUDENT_ID;
    currentUserRow = [userRows.get(userId)!];
  }

  const { createAdminDegreeProgressRouter } = await import('../server/routes/admin-degree-progress');
  app.use('/api/admin/degree-progress', createAdminDegreeProgressRouter({
    resolveContext: mockResolver.resolveContext,
    getProgress: mockService.getDegreeProgress,
  }));

  return {
    app,
    token: userRole === null
      ? null
      : makeLocalJWT(userRole === 'admin' ? ADMIN_ID : STUDENT_ID, `${userRole}@test.com`),
  };
}

describe('Phase 4F — Admin Degree Progress API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolver.resolveContext.mockResolvedValue(activeContext);
    mockService.getDegreeProgress.mockResolvedValue(composedReport);
  });

  describe('real authentication and admin authorization', () => {
    it('rejects missing authentication with 401', async () => {
      const { app } = await createTestApp(null);

      const response = await request(app)
        .get(`/api/admin/degree-progress/students/${VALID_STUDENT_ID}/degree-progress`);

      expect(response.status).toBe(401);
      expect(mockResolver.resolveContext).not.toHaveBeenCalled();
      expect(mockService.getDegreeProgress).not.toHaveBeenCalled();
    });

    it('rejects invalid authentication with 401', async () => {
      const { app } = await createTestApp(null);

      const response = await request(app)
        .get(`/api/admin/degree-progress/students/${VALID_STUDENT_ID}/degree-progress`)
        .set('Authorization', 'Bearer definitely-invalid');

      expect(response.status).toBe(401);
      expect(mockResolver.resolveContext).not.toHaveBeenCalled();
      expect(mockService.getDegreeProgress).not.toHaveBeenCalled();
    });

    it('rejects authenticated non-admin users with 403', async () => {
      const { app, token } = await createTestApp('student');

      const response = await request(app)
        .get(`/api/admin/degree-progress/students/${VALID_STUDENT_ID}/degree-progress`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(mockResolver.resolveContext).not.toHaveBeenCalled();
      expect(mockService.getDegreeProgress).not.toHaveBeenCalled();
    });
  });

  describe('studentId validation and service invocation', () => {
    it('allows a valid admin request and trims studentId', async () => {
      const { app, token } = await createTestApp('admin');

      const response = await request(app)
        .get('/api/admin/degree-progress/students/%20%20student-text-pk-001%20/degree-progress')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(mockResolver.resolveContext).toHaveBeenCalledTimes(1);
      expect(mockResolver.resolveContext).toHaveBeenCalledWith(VALID_STUDENT_ID);
      expect(mockService.getDegreeProgress).toHaveBeenCalledTimes(1);
      expect(mockService.getDegreeProgress).toHaveBeenCalledWith(activeContext);
    });

    it.each([
      ['blank', '   '],
      ['too long', 'x'.repeat(129)],
    ])('rejects %s studentId with 400 without calling service', async (_label, studentId) => {
      const { app, token } = await createTestApp('admin');

      const response = await request(app)
        .get(`/api/admin/degree-progress/students/${encodeURIComponent(studentId)}/degree-progress`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('DEGREE_PROGRESS_VALIDATION_ERROR');
      expect(mockResolver.resolveContext).not.toHaveBeenCalled();
      expect(mockService.getDegreeProgress).not.toHaveBeenCalled();
    });

    it('rejects a missing studentId with 400 without calling service', async () => {
      const { app, token } = await createTestApp('admin');

      const response = await request(app)
        .get('/api/admin/degree-progress/students/degree-progress')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('DEGREE_PROGRESS_VALIDATION_ERROR');
      expect(mockResolver.resolveContext).not.toHaveBeenCalled();
      expect(mockService.getDegreeProgress).not.toHaveBeenCalled();
    });

    it('rejects a duplicate query studentId trick without calling service', async () => {
      const { app, token } = await createTestApp('admin');

      const response = await request(app)
        .get(`/api/admin/degree-progress/students/${VALID_STUDENT_ID}/degree-progress?studentId[]=other`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('DEGREE_PROGRESS_VALIDATION_ERROR');
      expect(mockResolver.resolveContext).not.toHaveBeenCalled();
      expect(mockService.getDegreeProgress).not.toHaveBeenCalled();
    });

    it('rejects malformed non-string params fail-closed without calling service', async () => {
      const router = (await import('../server/routes/admin-degree-progress')).createAdminDegreeProgressRouter(
        {
          resolveContext: mockResolver.resolveContext,
          getProgress: mockService.getDegreeProgress,
        },
      );
      const routeLayer = (router as any).stack.find(
        (layer: any) => layer.route?.path === '/students/:studentId/degree-progress',
      );
      const handler = routeLayer.route.stack[0].handle;
      const response = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      await handler(
        {
          params: { studentId: ['not', 'a', 'string'] },
          query: {},
        },
        response,
      );

      expect(response.status).toHaveBeenCalledWith(400);
      expect(mockResolver.resolveContext).not.toHaveBeenCalled();
      expect(mockService.getDegreeProgress).not.toHaveBeenCalled();
    });

    it('returns 404 for no active assignment without calling service', async () => {
      mockResolver.resolveContext.mockResolvedValue(null);
      const { app, token } = await createTestApp('admin');

      const response = await request(app)
        .get(`/api/admin/degree-progress/students/${VALID_STUDENT_ID}/degree-progress`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: {
          code: 'DEGREE_PROGRESS_CONTEXT_NOT_FOUND',
          message: 'No active degree program assignment found for student',
        },
      });
      expect(mockResolver.resolveContext).toHaveBeenCalledTimes(1);
      expect(mockResolver.resolveContext).toHaveBeenCalledWith(VALID_STUDENT_ID);
      expect(mockService.getDegreeProgress).not.toHaveBeenCalled();
    });

    it.each([
      ['malformed context', { studentId: VALID_STUDENT_ID, programAssignmentId: '', programVersionId: 'program-version-1' }],
      ['resolver throw', new Error('sensitive resolver detail')],
    ])('returns sanitized 500 for %s without calling service', async (_label, resolverResult) => {
      if (resolverResult instanceof Error) {
        mockResolver.resolveContext.mockRejectedValue(resolverResult);
      } else {
        mockResolver.resolveContext.mockResolvedValue(resolverResult);
      }
      const { app, token } = await createTestApp('admin');

      const response = await request(app)
        .get(`/api/admin/degree-progress/students/${VALID_STUDENT_ID}/degree-progress`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
      expect(JSON.stringify(response.body)).not.toContain('sensitive resolver detail');
      expect(mockResolver.resolveContext).toHaveBeenCalledTimes(1);
      expect(mockService.getDegreeProgress).not.toHaveBeenCalled();
    });
  });

  describe('report envelope and failure handling', () => {
    it('preserves the full report and metadata without mutating or freezing service output', async () => {
      const { app, token } = await createTestApp('admin');
      const original = structuredClone(composedReport);

      const response = await request(app)
        .get(`/api/admin/degree-progress/students/${VALID_STUDENT_ID}/degree-progress`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        report: composedReport,
        snapshotFingerprint: composedReport.snapshot.fingerprint,
        asOf: composedReport.snapshot.asOf,
        integrationDiagnostics: composedReport.integrationDiagnostics,
      });
      expect(composedReport).toEqual(original);
      expect(Object.isFrozen(composedReport)).toBe(false);
      expect(Object.isFrozen(composedReport.snapshot)).toBe(false);
    });

    it('faithfully exposes manual review with null snapshot metadata', async () => {
      mockService.getDegreeProgress.mockResolvedValue(manualReviewReport);
      const { app, token } = await createTestApp('admin');

      const response = await request(app)
        .get(`/api/admin/degree-progress/students/${VALID_STUDENT_ID}/degree-progress`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        report: manualReviewReport,
        snapshotFingerprint: null,
        asOf: null,
        integrationDiagnostics: manualReviewReport.integrationDiagnostics,
      });
    });

    it('returns sanitized 500 and does not retry a rejected service call', async () => {
      mockService.getDegreeProgress.mockRejectedValue(new Error('sensitive internal detail'));
      const { app, token } = await createTestApp('admin');

      const response = await request(app)
        .get(`/api/admin/degree-progress/students/${VALID_STUDENT_ID}/degree-progress`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
      expect(JSON.stringify(response.body)).not.toContain('sensitive internal detail');
      expect(mockResolver.resolveContext).toHaveBeenCalledTimes(1);
      expect(mockService.getDegreeProgress).toHaveBeenCalledTimes(1);
    });

    it('is read-only and does not expose a POST handler', async () => {
      const { app, token } = await createTestApp('admin');

      const response = await request(app)
        .post(`/api/admin/degree-progress/students/${VALID_STUDENT_ID}/degree-progress`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(mockService.getDegreeProgress).not.toHaveBeenCalled();
    });
  });
});