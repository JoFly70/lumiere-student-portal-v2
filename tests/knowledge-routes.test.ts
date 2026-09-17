/**
 * Phase 1C — Knowledge API Route Tests (Corrected)
 *
 * Tests the ACTUAL Knowledge router with REAL requireAuth + requireRole middleware.
 * Only mocks dependencies BEHIND authentication:
 *   - database user lookup (db.select)
 *   - Supabase auth.getUser (always rejects, forcing local JWT path)
 *   - Knowledge Service (boundary mock)
 *   - audit (no-op)
 *
 * Uses real local JWT tokens signed with SESSION_SECRET so the real
 * requireAuth middleware resolves the test user and role.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { KnowledgeError } from '../server/lib/knowledge-errors';

// ── Test user IDs ────────────────────────────────────────────────────────────────

const ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const STAFF_ID = '00000000-0000-0000-0000-000000000002';
const STUDENT_ID = '00000000-0000-0000-0000-000000000003';
const COACH_ID = '00000000-0000-0000-0000-000000000004';
const VALID_UUID = '12345678-1234-1234-1234-123456789012';
const ANOTHER_UUID = '87654321-4321-4321-4321-210987654321';

const JWT_SECRET = process.env.SESSION_SECRET || 'local-dev-secret-change-in-production';

// ── Real local JWT generator (matches auth.ts verifyLocalJWT) ──────────────────

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

// ── Mock the Knowledge Service ─────────────────────────────────────────────────

const mockService = vi.hoisted(() => ({
  createEvidenceSource: vi.fn(),
  addEvidenceExcerpt: vi.fn(),
  listEvidenceSources: vi.fn(),
  getEvidenceSourceDetail: vi.fn(),
  createKnowledgeClaim: vi.fn(),
  listClaims: vi.fn(),
  getClaimDetail: vi.fn(),
  createClaimVersion: vi.fn(),
  getClaimVersionDetail: vi.fn(),
  attachEvidenceToClaimVersion: vi.fn(),
  recordVerification: vi.fn(),
  confirmClaimVersion: vi.fn(),
  supersedeClaimVersion: vi.fn(),
  createKnowledgeConflict: vi.fn(),
  resolveKnowledgeConflict: vi.fn(),
  listConflicts: vi.fn(),
  getConflict: vi.fn(),
  createAcademicRuleFromVerifiedClaim: vi.fn(),
  createEquivalencyFromVerifiedClaim: vi.fn(),
  createArticulationFromVerifiedClaim: vi.fn(),
  updateEvidenceSourceMetadata: vi.fn(),
  attachEvidenceSourceFile: vi.fn(),
}));

const mockKnowledgeStorage = vi.hoisted(() => ({
  createKnowledgeEvidenceUpload: vi.fn(),
  completeKnowledgeEvidenceUpload: vi.fn(),
  createKnowledgeEvidenceDownload: vi.fn(),
}));

vi.mock('../server/services/knowledge-service', () => ({
  knowledgeService: mockService,
  createKnowledgeService: vi.fn(() => mockService),
}));
vi.mock('../server/lib/knowledge-storage', () => mockKnowledgeStorage);

// ── Mock audit to avoid Supabase calls ──────────────────────────────────────────

const mockAudit = vi.hoisted(() => ({
  auditAdmin: vi.fn().mockResolvedValue(undefined),
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../server/lib/audit', () => ({
  auditAdmin: mockAudit.auditAdmin,
  createAuditLog: mockAudit.createAuditLog,
}));

// ── Mock supabase so requireAuth uses local JWT path only ───────────────────────

vi.mock('../server/lib/supabase', () => ({
  supabaseAdmin: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: 'mock-no-supabase' }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          range: vi.fn(() => ({ data: [], error: null, count: 0 })),
        })),
      })),
      insert: vi.fn(() => ({ error: null })),
      update: vi.fn(() => ({ eq: vi.fn(() => ({ error: null })) })),
      delete: vi.fn(() => ({ eq: vi.fn(() => ({ error: null })) })),
    })),
  },
  isSupabaseConfigured: false,
}));

// ── Mock db to return user rows for requireAuth ─────────────────────────────────
// The real requireAuth queries db.select().from(users).where(eq(users.id, userId)).limit(1)
// We intercept the chain to return the right user row based on userId.

const userRows = new Map<string, { id: string; email: string; name: string; role: string }>([
  [ADMIN_ID, { id: ADMIN_ID, email: 'admin@test.com', name: 'Admin', role: 'admin' }],
  [STAFF_ID, { id: STAFF_ID, email: 'staff@test.com', name: 'Staff', role: 'staff' }],
  [STUDENT_ID, { id: STUDENT_ID, email: 'student@test.com', name: 'Student', role: 'student' }],
  [COACH_ID, { id: COACH_ID, email: 'coach@test.com', name: 'Coach', role: 'coach' }],
]);

vi.mock('../server/lib/db', () => ({
  db: {
    select: vi.fn((fields: unknown) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const chain = {
            limit: vi.fn(async () => currentUserRow),
            orderBy: vi.fn(async () => []),
          };
          return chain;
        }),
      })),
    })),
    transaction: vi.fn(async (fn: any) => fn({})),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => []) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => []) })) })) })),
    execute: vi.fn(async () => {}),
  },
}));

// Global to pass the user row through the db mock chain
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
    // Set up the db mock to return this user
    currentUserRow = userRows.get(userId) ? [userRows.get(userId)!] : [];
  } else {
    currentUserRow = [];
  }

  // Mount the real knowledge router
  const knowledgeRouter = (await import('../server/routes/knowledge')).default;
  app.use('/api/admin/knowledge', knowledgeRouter);

  return { app, token };
}

// ── Constants ────────────────────────────────────────────────────────────────────

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('Phase 1C — Knowledge API Routes', () => {
  let app: Express;
  let token: string | null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService.listEvidenceSources.mockResolvedValue([]);
    mockService.listClaims.mockResolvedValue([]);
    mockService.listConflicts.mockResolvedValue([]);
    mockService.getEvidenceSourceDetail.mockResolvedValue({ source: { id: VALID_UUID, externalFileId: `evidence-sources/${VALID_UUID}/file.pdf` }, excerpts: [] });
    mockService.getClaimDetail.mockResolvedValue({ claim: { id: VALID_UUID }, versions: [] });
    mockService.getClaimVersionDetail.mockResolvedValue({
      version: { id: VALID_UUID }, claim: { id: VALID_UUID },
      evidenceRelationships: [], verificationEvents: [], openConflicts: [],
      canonicalRecords: { academicRules: [], equivalencies: [], articulations: [] },
    });
    mockService.getConflict.mockResolvedValue({ id: VALID_UUID, status: 'open' });
    mockService.createEvidenceSource.mockResolvedValue({ id: VALID_UUID, title: 'Test' });
    mockService.addEvidenceExcerpt.mockResolvedValue({ id: VALID_UUID });
    mockService.createKnowledgeClaim.mockResolvedValue({ id: VALID_UUID, claimKey: 'test' });
    mockService.createClaimVersion.mockResolvedValue({ id: VALID_UUID, versionNumber: 1 });
    mockService.attachEvidenceToClaimVersion.mockResolvedValue({ claimVersionId: VALID_UUID, evidenceExcerptId: ANOTHER_UUID });
    mockService.recordVerification.mockResolvedValue({ id: VALID_UUID });
    mockService.confirmClaimVersion.mockResolvedValue({ claimVersionId: VALID_UUID, claimId: VALID_UUID, status: 'confirmed' });
    mockService.supersedeClaimVersion.mockResolvedValue({ oldVersionId: VALID_UUID, newVersionId: ANOTHER_UUID, claimId: VALID_UUID, status: 'superseded' });
    mockService.createKnowledgeConflict.mockResolvedValue({ id: VALID_UUID, status: 'open' });
    mockService.resolveKnowledgeConflict.mockResolvedValue({ id: VALID_UUID, status: 'resolved' });
    mockService.createAcademicRuleFromVerifiedClaim.mockResolvedValue({ id: VALID_UUID, status: 'confirmed' });
    mockService.createEquivalencyFromVerifiedClaim.mockResolvedValue({ id: VALID_UUID, status: 'confirmed' });
    mockService.createArticulationFromVerifiedClaim.mockResolvedValue({ id: VALID_UUID, status: 'confirmed' });
    mockService.updateEvidenceSourceMetadata.mockResolvedValue({ id: VALID_UUID, title: 'Test', lifecycleStatus: 'current' });
    mockService.attachEvidenceSourceFile.mockResolvedValue({ id: VALID_UUID, title: 'Test', externalFileId: `evidence-sources/${VALID_UUID}/file.pdf`, contentHash: 'sha256:abc' });
    mockKnowledgeStorage.createKnowledgeEvidenceUpload.mockResolvedValue({ upload_url: 'https://upload', upload_token: 'token', storage_path: `evidence-sources/${VALID_UUID}/file.pdf`, expires_in: 3600 });
    mockKnowledgeStorage.completeKnowledgeEvidenceUpload.mockResolvedValue({ storagePath: `evidence-sources/${VALID_UUID}/file.pdf`, contentHash: 'sha256:abc' });
    mockKnowledgeStorage.createKnowledgeEvidenceDownload.mockResolvedValue({ download_url: 'https://download', expires_in: 3600 });
    mockAudit.auditAdmin.mockResolvedValue(undefined);
    mockAudit.createAuditLog.mockResolvedValue(undefined);
  });

  // ── A. REAL requireAuth executes ──────────────────────────────────────────────
  // ── B. REAL requireRole executes ──────────────────────────────────────────────

  describe('Auth/RBAC (real middleware)', () => {
    it('A1. unauthenticated GET → 401', async () => {
      ({ app, token } = await createTestApp(null));
      const res = await request(app).get('/api/admin/knowledge/evidence-sources');
      expect(res.status).toBe(401);
    });

    it('A2. student GET → 403', async () => {
      ({ app, token } = await createTestApp('student', STUDENT_ID));
      const res = await request(app).get('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('A3. coach GET → 403', async () => {
      ({ app, token } = await createTestApp('coach', COACH_ID));
      const res = await request(app).get('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('A4. staff GET → 200', async () => {
      ({ app, token } = await createTestApp('staff', STAFF_ID));
      const res = await request(app).get('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('A5. staff mutation → 403', async () => {
      ({ app, token } = await createTestApp('staff', STAFF_ID));
      const res = await request(app).post('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceType: 'official_web', title: 'Test' });
      expect(res.status).toBe(403);
    });

    it('A6. admin GET → 200', async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
      const res = await request(app).get('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('A7. admin mutation reaches Knowledge Service', async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
      const res = await request(app).post('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceType: 'official_web', title: 'Test Source' });
      expect(res.status).toBe(201);
      expect(mockService.createEvidenceSource).toHaveBeenCalled();
    });
  });

  // ── C. actual registerRoutes mount order ──────────────────────────────────────

  describe('Production mount order (registerRoutes)', () => {
    it('C1. staff GET /api/admin/knowledge → 200 while staff GET /api/admin/users → 403', async () => {
      // We test the actual mount order by importing registerRoutes
      // and mocking only the unrelated routers/services.
      currentUserRow = [userRows.get(STAFF_ID)!];
      const staffToken = makeLocalJWT(STAFF_ID, 'staff@test.com');

      // We need to mock the rate limiter to avoid issues
      vi.doMock('../server/middleware/rate-limit', () => ({
        authRateLimit: (req: unknown, res: unknown, next: () => void) => next(),
        passwordResetRateLimit: (req: unknown, res: unknown, next: () => void) => next(),
        passwordUpdateRateLimit: (req: unknown, res: unknown, next: () => void) => next(),
        signupRateLimit: (req: unknown, res: unknown, next: () => void) => next(),
        apiRateLimit: (req: unknown, res: unknown, next: () => void) => next(),
      }));

      // Mock csrf
      vi.doMock('../server/middleware/csrf', () => ({
        generateCsrfToken: vi.fn(() => 'mock-csrf'),
        requireCsrf: (req: unknown, res: unknown, next: () => void) => next(),
        deleteCsrfToken: vi.fn(),
      }));

      // Mock two-factor routes
      vi.doMock('../server/routes/two-factor', () => ({
        default: express.Router(),
      }));

      // Mock other routers that make external calls
      vi.doMock('../server/routes/students', () => ({ default: express.Router() }));
      vi.doMock('../server/routes/documents', () => ({ default: express.Router() }));
      vi.doMock('../server/routes/tickets', () => ({ default: express.Router() }));
      vi.doMock('../server/routes/programs', () => ({ default: express.Router() }));
      vi.doMock('../server/routes/health', () => ({ default: express.Router() }));

      // Mock storage
      vi.doMock('../server/storage', () => ({ storage: {} }));

      // Mock roadmap-generator
      vi.doMock('../server/roadmap-generator', () => ({ generateRoadmap: vi.fn() }));

      const { registerRoutes } = await import('../server/routes');
      const app = express();
      app.use(express.json());
      await registerRoutes(app);

      // Staff can access knowledge routes
      const knowledgeRes = await request(app).get('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(knowledgeRes.status).toBe(200);

      // Staff CANNOT access generic admin routes
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

  // ── D/E/F. Multi-filter AND semantics ─────────────────────────────────────────

  describe('Multi-filter AND semantics (repository)', () => {
    // These tests verify the repository list functions combine filters with AND.
    // We mock the db chain to capture the where clause.

    it('D. evidence sources: sourceType + institutionId + providerId combined with AND', async () => {
      const { listEvidenceSources } = await import('../server/repositories/knowledge-repo');
      const whereConditions: unknown[] = [];
      const mockQuery = {
        where: vi.fn((cond: unknown) => { whereConditions.push(cond); return mockQuery; }),
        limit: vi.fn(() => mockQuery),
        offset: vi.fn(() => mockQuery),
        orderBy: vi.fn(async () => [{ id: 'test' }]),
      };
      const mockDb = {
        select: vi.fn(() => ({ from: vi.fn(() => ({ $dynamic: () => mockQuery })) })),
      };
      await listEvidenceSources({
        sourceType: 'official_web' as any,
        institutionId: VALID_UUID,
        providerId: ANOTHER_UUID,
      }, mockDb as any);
      expect(whereConditions.length).toBe(1);
    });

    it('E. claims: status + claimType + subjectType + claimKey combined with AND', async () => {
      const { listClaims } = await import('../server/repositories/knowledge-repo');
      const whereConditions: unknown[] = [];
      const mockQuery = {
        where: vi.fn((cond: unknown) => { whereConditions.push(cond); return mockQuery; }),
        limit: vi.fn(() => mockQuery),
        offset: vi.fn(() => mockQuery),
        orderBy: vi.fn(async () => [{ id: 'test' }]),
      };
      const mockDb = {
        select: vi.fn(() => ({ from: vi.fn(() => ({ $dynamic: () => mockQuery })) })),
      };
      await listClaims({
        status: 'confirmed' as any,
        claimType: 'equivalency' as any,
        subjectType: 'institution' as any,
        claimKey: 'test-key',
      }, mockDb as any);
      expect(whereConditions.length).toBe(1);
    });

    it('F. conflicts: status + conflictType combined with AND', async () => {
      const { listConflicts } = await import('../server/repositories/knowledge-repo');
      const whereConditions: unknown[] = [];
      const mockQuery = {
        where: vi.fn((cond: unknown) => { whereConditions.push(cond); return mockQuery; }),
        limit: vi.fn(() => mockQuery),
        offset: vi.fn(() => mockQuery),
        orderBy: vi.fn(async () => [{ id: 'test' }]),
      };
      const mockDb = {
        select: vi.fn(() => ({ from: vi.fn(() => ({ $dynamic: () => mockQuery })) })),
      };
      await listConflicts({
        status: 'open' as any,
        conflictType: 'contradiction' as any,
      }, mockDb as any);
      expect(whereConditions.length).toBe(1);
    });
  });

  // ── G-K. Invalid enum filter → 400 ────────────────────────────────────────────

  describe('Enum filter validation', () => {
    beforeEach(async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
    });

    it('G. invalid sourceType filter → 400', async () => {
      const res = await request(app).get('/api/admin/knowledge/evidence-sources?sourceType=garbage')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
    });

    it('H. invalid claim status → 400', async () => {
      const res = await request(app).get('/api/admin/knowledge/claims?status=garbage')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
    });

    it('I. invalid claimType → 400', async () => {
      const res = await request(app).get('/api/admin/knowledge/claims?claimType=garbage')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
    });

    it('J. invalid subjectType → 400', async () => {
      const res = await request(app).get('/api/admin/knowledge/claims?subjectType=garbage')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
    });

    it('K. invalid conflict status/type → 400', async () => {
      const resStatus = await request(app).get('/api/admin/knowledge/conflicts?status=garbage')
        .set('Authorization', `Bearer ${token}`);
      expect(resStatus.status).toBe(400);

      const resType = await request(app).get('/api/admin/knowledge/conflicts?conflictType=garbage')
        .set('Authorization', `Bearer ${token}`);
      expect(resType.status).toBe(400);
    });
  });

  // ── L. Claim-version provenance exposes excerpt + source ──────────────────────

  describe('Claim-version provenance', () => {
    it('L. getClaimVersionDetail exposes evidence relationship → excerpt → source', async () => {
      // Test the ACTUAL service read model, not a mocked route response.
      // We call the real service with a mocked repository that returns provenance data.
      // Use vi.importActual to bypass the vi.mock of the service module.
      const actual = await vi.importActual<typeof import('../server/services/knowledge-service')>('../server/services/knowledge-service');
      const createKnowledgeService = actual.createKnowledgeService;

      const mockRepo = {
        getClaimVersion: vi.fn().mockResolvedValue({ id: VALID_UUID, claimId: ANOTHER_UUID, status: 'confirmed' }),
        getClaimById: vi.fn().mockResolvedValue({ id: ANOTHER_UUID, claimKey: 'test' }),
        listEvidenceWithProvenance: vi.fn().mockResolvedValue([
          {
            relationship: { claimVersionId: VALID_UUID, evidenceExcerptId: 'excerpt-1', relationshipType: 'supports', notes: null },
            excerpt: {
              id: 'excerpt-1',
              excerptText: 'The transfer policy states...',
              locator: 'page 5',
              pageNumber: 5,
              section: 'Transfer Credits',
            },
            source: {
              id: 'source-1',
              sourceType: 'official_catalog',
              title: '2025-2026 Catalog',
              sourceUrl: 'https://example.edu/catalog',
              authorityLevel: 'primary',
              publishedAt: new Date('2025-01-01'),
              effectiveFrom: new Date('2025-01-01'),
              effectiveTo: null,
            },
          },
        ]),
        listVerificationEvents: vi.fn().mockResolvedValue([]),
        listOpenConflictsForVersion: vi.fn().mockResolvedValue([]),
        getAcademicRulesByClaimVersion: vi.fn().mockResolvedValue([]),
        getEquivalenciesByClaimVersion: vi.fn().mockResolvedValue([]),
        getArticulationsByClaimVersion: vi.fn().mockResolvedValue([]),
      };

      const mockTxRunner = async (fn: (tx: unknown) => Promise<unknown>) => fn({});

      const service = createKnowledgeService(mockRepo as any, mockTxRunner as any);
      const detail = await service.getClaimVersionDetail(VALID_UUID);

      // Verify provenance chain: relationship → excerpt → source
      expect(detail.evidenceRelationships).toHaveLength(1);
      const er = detail.evidenceRelationships[0];
      expect(er.relationship.relationshipType).toBe('supports');
      expect(er.excerpt.id).toBe('excerpt-1');
      expect(er.excerpt.excerptText).toBe('The transfer policy states...');
      expect(er.source.id).toBe('source-1');
      expect(er.source.title).toBe('2025-2026 Catalog');
      expect(er.source.sourceUrl).toBe('https://example.edu/catalog');
      expect(er.source.authorityLevel).toBe('primary');
    });
  });

  // ── M/N. Missing mutation audit fixes ────────────────────────────────────────

  describe('Mutation audit logging', () => {
    beforeEach(async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
    });

    it('M. excerpt creation is audited', async () => {
      await request(app).post(`/api/admin/knowledge/evidence-sources/${VALID_UUID}/excerpts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ excerptText: 'Test excerpt' });
      expect(mockAudit.auditAdmin).toHaveBeenCalled();
      const auditCall = mockAudit.auditAdmin.mock.calls[mockAudit.auditAdmin.mock.calls.length - 1];
      expect(auditCall[0]).toBe('admin.bulk_operation');
      expect(auditCall[1]).toBe(ADMIN_ID);
      expect(auditCall[4]).toMatchObject({ resourceType: 'evidence_excerpt' });
    });

    it('N. evidence attachment is audited', async () => {
      await request(app).post(`/api/admin/knowledge/claim-versions/${VALID_UUID}/evidence`)
        .set('Authorization', `Bearer ${token}`)
        .send({ evidenceExcerptId: ANOTHER_UUID, relationshipType: 'supports' });
      expect(mockAudit.auditAdmin).toHaveBeenCalled();
      const auditCall = mockAudit.auditAdmin.mock.calls[mockAudit.auditAdmin.mock.calls.length - 1];
      expect(auditCall[0]).toBe('admin.bulk_operation');
      expect(auditCall[1]).toBe(ADMIN_ID);
      expect(auditCall[4]).toMatchObject({ resourceType: 'claim_evidence' });
    });
  });

  // ── O/P. ISO date validation ──────────────────────────────────────────────────

  describe('ISO date validation', () => {
    beforeEach(async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
    });

    it('O. non-ISO date string → 400', async () => {
      const res = await request(app).post('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceType: 'official_web', title: 'Test', effectiveFrom: '01/15/2025' });
      expect(res.status).toBe(400);
    });

    it('P. valid ISO date string → service receives Date', async () => {
      await request(app).post('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceType: 'official_web', title: 'Test', effectiveFrom: '2025-01-15T00:00:00.000Z' });
      expect(mockService.createEvidenceSource).toHaveBeenCalled();
      const callArg = mockService.createEvidenceSource.mock.calls[0][0];
      expect(callArg.effectiveFrom).toBeInstanceOf(Date);
    });
  });

  // ── Actor trust ────────────────────────────────────────────────────────────────

  describe('Actor trust', () => {
    beforeEach(async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
    });

    it('evidence source receives createdBy = authenticated admin ID', async () => {
      await request(app).post('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceType: 'official_web', title: 'Test' });
      const callArg = mockService.createEvidenceSource.mock.calls[0][0];
      expect(callArg.createdBy).toBe(ADMIN_ID);
    });

    it('client cannot inject createdBy through body', async () => {
      const res = await request(app).post('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceType: 'official_web', title: 'Test', createdBy: 'attacker-id' });
      // .strict() rejects unknown fields
      expect(res.status).toBe(400);
    });

    it('verification receives reviewerId = authenticated admin ID', async () => {
      await request(app).post(`/api/admin/knowledge/claim-versions/${VALID_UUID}/verifications`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'verified' });
      const callArg = mockService.recordVerification.mock.calls[0][0];
      expect(callArg.reviewerId).toBe(ADMIN_ID);
    });

    it('supersession receives reviewerId = authenticated admin ID', async () => {
      await request(app).post(`/api/admin/knowledge/claim-versions/${VALID_UUID}/supersede`)
        .set('Authorization', `Bearer ${token}`)
        .send({ newVersionId: ANOTHER_UUID });
      const callArgs = mockService.supersedeClaimVersion.mock.calls[0];
      expect(callArgs[2]).toBe(ADMIN_ID);
    });

    it('conflict resolution receives resolvedBy = authenticated admin ID', async () => {
      await request(app).post(`/api/admin/knowledge/conflicts/${VALID_UUID}/resolve`)
        .set('Authorization', `Bearer ${token}`)
        .send({ resolutionNotes: 'Resolved' });
      const callArgs = mockService.resolveKnowledgeConflict.mock.calls[0];
      expect(callArgs[2]).toBe(ADMIN_ID);
    });
  });

  // ── Error mapping ──────────────────────────────────────────────────────────────

  describe('Error mapping', () => {
    beforeEach(async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
    });

    it('KNOWLEDGE_VALIDATION_ERROR → 400', async () => {
      mockService.createEvidenceSource.mockRejectedValueOnce(
        new KnowledgeError('KNOWLEDGE_VALIDATION_ERROR', 'Bad input'),
      );
      const res = await request(app).post('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceType: 'official_web', title: 'Test' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
    });

    it('KNOWLEDGE_NOT_FOUND → 404', async () => {
      mockService.getEvidenceSourceDetail.mockRejectedValueOnce(
        new KnowledgeError('KNOWLEDGE_NOT_FOUND', 'Not found'),
      );
      const res = await request(app).get(`/api/admin/knowledge/evidence-sources/${VALID_UUID}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('KNOWLEDGE_NOT_FOUND');
    });

    it('KNOWLEDGE_DUPLICATE → 409', async () => {
      mockService.createKnowledgeClaim.mockRejectedValueOnce(
        new KnowledgeError('KNOWLEDGE_DUPLICATE', 'Duplicate'),
      );
      const res = await request(app).post('/api/admin/knowledge/claims')
        .set('Authorization', `Bearer ${token}`)
        .send({ claimKey: 'test', claimType: 'equivalency', subjectType: 'institution' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('KNOWLEDGE_DUPLICATE');
    });

    it('KNOWLEDGE_INVALID_STATE → 409', async () => {
      mockService.confirmClaimVersion.mockRejectedValueOnce(
        new KnowledgeError('KNOWLEDGE_INVALID_STATE', 'Bad state'),
      );
      const res = await request(app).post(`/api/admin/knowledge/claim-versions/${VALID_UUID}/confirm`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('KNOWLEDGE_INVALID_STATE');
    });

    it('KNOWLEDGE_EVIDENCE_REQUIRED → 409', async () => {
      mockService.confirmClaimVersion.mockRejectedValueOnce(
        new KnowledgeError('KNOWLEDGE_EVIDENCE_REQUIRED', 'Need evidence'),
      );
      const res = await request(app).post(`/api/admin/knowledge/claim-versions/${VALID_UUID}/confirm`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('KNOWLEDGE_EVIDENCE_REQUIRED');
    });

    it('KNOWLEDGE_VERIFICATION_REQUIRED → 409', async () => {
      mockService.confirmClaimVersion.mockRejectedValueOnce(
        new KnowledgeError('KNOWLEDGE_VERIFICATION_REQUIRED', 'Need verification'),
      );
      const res = await request(app).post(`/api/admin/knowledge/claim-versions/${VALID_UUID}/confirm`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('KNOWLEDGE_VERIFICATION_REQUIRED');
    });

    it('KNOWLEDGE_OPEN_CONFLICT → 409', async () => {
      mockService.confirmClaimVersion.mockRejectedValueOnce(
        new KnowledgeError('KNOWLEDGE_OPEN_CONFLICT', 'Open conflict'),
      );
      const res = await request(app).post(`/api/admin/knowledge/claim-versions/${VALID_UUID}/confirm`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('KNOWLEDGE_OPEN_CONFLICT');
    });

    it('KNOWLEDGE_SUPERSESSION_REQUIRED → 409', async () => {
      mockService.confirmClaimVersion.mockRejectedValueOnce(
        new KnowledgeError('KNOWLEDGE_SUPERSESSION_REQUIRED', 'Need supersession'),
      );
      const res = await request(app).post(`/api/admin/knowledge/claim-versions/${VALID_UUID}/confirm`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('KNOWLEDGE_SUPERSESSION_REQUIRED');
    });

    it('unexpected error → sanitized 500', async () => {
      mockService.getEvidenceSourceDetail.mockRejectedValueOnce(new Error('DB connection failed'));
      const res = await request(app).get(`/api/admin/knowledge/evidence-sources/${VALID_UUID}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).not.toContain('DB');
    });
  });

  // ── Workflow routes ────────────────────────────────────────────────────────────

  describe('Workflow routes', () => {
    beforeEach(async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
    });

    it('evidence source creation returns 201', async () => {
      const res = await request(app).post('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceType: 'official_web', title: 'Test' });
      expect(res.status).toBe(201);
      expect(res.body.evidenceSource).toBeDefined();
    });

    it('excerpt creation returns 201', async () => {
      const res = await request(app).post(`/api/admin/knowledge/evidence-sources/${VALID_UUID}/excerpts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ excerptText: 'Test excerpt' });
      expect(res.status).toBe(201);
      expect(res.body.excerpt).toBeDefined();
    });

    it('claim creation returns 201', async () => {
      const res = await request(app).post('/api/admin/knowledge/claims')
        .set('Authorization', `Bearer ${token}`)
        .send({ claimKey: 'test', claimType: 'equivalency', subjectType: 'institution' });
      expect(res.status).toBe(201);
      expect(res.body.claim).toBeDefined();
    });

    it('claim version creation returns 201', async () => {
      const res = await request(app).post(`/api/admin/knowledge/claims/${VALID_UUID}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ statement: 'test', confidence: 75 });
      expect(res.status).toBe(201);
      expect(res.body.claimVersion).toBeDefined();
    });

    it('evidence attachment returns 201', async () => {
      const res = await request(app).post(`/api/admin/knowledge/claim-versions/${VALID_UUID}/evidence`)
        .set('Authorization', `Bearer ${token}`)
        .send({ evidenceExcerptId: ANOTHER_UUID, relationshipType: 'supports' });
      expect(res.status).toBe(201);
      expect(res.body.evidenceRelationship).toBeDefined();
    });

    it('verification returns 201', async () => {
      const res = await request(app).post(`/api/admin/knowledge/claim-versions/${VALID_UUID}/verifications`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'verified' });
      expect(res.status).toBe(201);
      expect(res.body.verificationEvent).toBeDefined();
    });

    it('confirmation returns 200', async () => {
      const res = await request(app).post(`/api/admin/knowledge/claim-versions/${VALID_UUID}/confirm`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.confirmation).toBeDefined();
    });

    it('supersession returns 200', async () => {
      const res = await request(app).post(`/api/admin/knowledge/claim-versions/${VALID_UUID}/supersede`)
        .set('Authorization', `Bearer ${token}`)
        .send({ newVersionId: ANOTHER_UUID });
      expect(res.status).toBe(200);
      expect(res.body.supersession).toBeDefined();
    });

    it('conflict creation returns 201', async () => {
      const res = await request(app).post('/api/admin/knowledge/conflicts')
        .set('Authorization', `Bearer ${token}`)
        .send({ claimVersionAId: VALID_UUID, conflictType: 'contradiction', description: 'Test conflict' });
      expect(res.status).toBe(201);
      expect(res.body.conflict).toBeDefined();
    });

    it('conflict resolution returns 200', async () => {
      const res = await request(app).post(`/api/admin/knowledge/conflicts/${VALID_UUID}/resolve`)
        .set('Authorization', `Bearer ${token}`)
        .send({ resolutionNotes: 'Resolved by admin' });
      expect(res.status).toBe(200);
      expect(res.body.conflict).toBeDefined();
    });

    it('academic rule creation returns 201', async () => {
      const res = await request(app).post('/api/admin/knowledge/academic-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({
          institutionId: VALID_UUID,
          ruleKey: 'transfer-rule',
          ruleKind: 'transfer',
          title: 'Transfer Rule',
          claimVersionId: ANOTHER_UUID,
        });
      expect(res.status).toBe(201);
      expect(res.body.academicRule).toBeDefined();
    });

    it('equivalency creation returns 201', async () => {
      const res = await request(app).post('/api/admin/knowledge/equivalencies')
        .set('Authorization', `Bearer ${token}`)
        .send({
          sourceProviderCourseVersionId: VALID_UUID,
          institutionId: ANOTHER_UUID,
          claimVersionId: VALID_UUID,
        });
      expect(res.status).toBe(201);
      expect(res.body.equivalency).toBeDefined();
    });

    it('articulation creation returns 201', async () => {
      const res = await request(app).post('/api/admin/knowledge/articulations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          programVersionId: VALID_UUID,
          requirementId: ANOTHER_UUID,
          claimVersionId: VALID_UUID,
        });
      expect(res.status).toBe(201);
      expect(res.body.articulation).toBeDefined();
    });
  });

  // ── Read models ────────────────────────────────────────────────────────────────

  describe('Read models', () => {
    beforeEach(async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
    });

    it('evidence source detail includes excerpts', async () => {
      mockService.getEvidenceSourceDetail.mockResolvedValueOnce({
        source: { id: VALID_UUID, title: 'Test' },
        excerpts: [{ id: 'excerpt-1', excerptText: 'Text' }],
      });
      const res = await request(app).get(`/api/admin/knowledge/evidence-sources/${VALID_UUID}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.source).toBeDefined();
      expect(res.body.excerpts).toHaveLength(1);
    });

    it('claim detail includes versions', async () => {
      mockService.getClaimDetail.mockResolvedValueOnce({
        claim: { id: VALID_UUID, claimKey: 'test' },
        versions: [{ id: 'v1', versionNumber: 1 }, { id: 'v2', versionNumber: 2 }],
      });
      const res = await request(app).get(`/api/admin/knowledge/claims/${VALID_UUID}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.claim).toBeDefined();
      expect(res.body.versions).toHaveLength(2);
    });

    it('claim-version detail includes provenance/verification/conflicts/canonical records', async () => {
      mockService.getClaimVersionDetail.mockResolvedValueOnce({
        version: { id: VALID_UUID, status: 'confirmed' },
        claim: { id: VALID_UUID },
        evidenceRelationships: [{
          relationship: { relationshipType: 'supports' },
          excerpt: { id: 'er-1', excerptText: 'text' },
          source: { id: 'src-1', title: 'Source' },
        }],
        verificationEvents: [{ id: 've-1', action: 'verified' }],
        openConflicts: [],
        canonicalRecords: {
          academicRules: [{ id: 'ar-1' }],
          equivalencies: [{ id: 'eq-1' }],
          articulations: [{ id: 'art-1' }],
        },
      });
      const res = await request(app).get(`/api/admin/knowledge/claim-versions/${VALID_UUID}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.version).toBeDefined();
      expect(res.body.claim).toBeDefined();
      expect(res.body.evidenceRelationships).toHaveLength(1);
      expect(res.body.evidenceRelationships[0].excerpt).toBeDefined();
      expect(res.body.evidenceRelationships[0].source).toBeDefined();
      expect(res.body.verificationEvents).toHaveLength(1);
      expect(res.body.openConflicts).toHaveLength(0);
      expect(res.body.canonicalRecords.academicRules).toHaveLength(1);
      expect(res.body.canonicalRecords.equivalencies).toHaveLength(1);
      expect(res.body.canonicalRecords.articulations).toHaveLength(1);
    });

    it('resolved conflicts remain queryable', async () => {
      mockService.listConflicts.mockResolvedValueOnce([
        { id: 'c1', status: 'resolved' },
        { id: 'c2', status: 'open' },
      ]);
      const res = await request(app).get('/api/admin/knowledge/conflicts')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].status).toBe('resolved');
    });
  });

  // ── No hard delete ──────────────────────────────────────────────────────────────

  describe('No hard delete', () => {
    it('no Knowledge DELETE endpoint exists', async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
      const paths = [
        `/api/admin/knowledge/evidence-sources/${VALID_UUID}`,
        `/api/admin/knowledge/claims/${VALID_UUID}`,
        `/api/admin/knowledge/claim-versions/${VALID_UUID}`,
        `/api/admin/knowledge/conflicts/${VALID_UUID}`,
      ];
      for (const path of paths) {
        const res = await request(app).delete(path)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(404);
      }
    });
  });

  // ── Validation ──────────────────────────────────────────────────────────────────

  describe('Validation', () => {
    beforeEach(async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
    });

    it('malformed UUID param → controlled 400', async () => {
      const res = await request(app).get('/api/admin/knowledge/evidence-sources/not-a-uuid')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
    });

    it('malformed UUID body field → controlled 400', async () => {
      const res = await request(app).post('/api/admin/knowledge/claims')
        .set('Authorization', `Bearer ${token}`)
        .send({ claimKey: 'test', claimType: 'equivalency', subjectType: 'institution', subjectId: 'not-a-uuid' });
      expect(res.status).toBe(400);
    });

    it('invalid pagination → 400', async () => {
      const res = await request(app).get('/api/admin/knowledge/evidence-sources?limit=-1')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('unknown/spoofable fields are rejected', async () => {
      const res = await request(app).post('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceType: 'official_web', title: 'Test', createdBy: 'attacker-id' });
      expect(res.status).toBe(400);
    });
  });

  describe('PR1 evidence source behavior', () => {
    beforeEach(async () => {
      ({ app, token } = await createTestApp('admin', ADMIN_ID));
    });

    it('rejects actor, verification, and file fields from create body', async () => {
      for (const field of ['createdBy', 'verifiedBy', 'verifiedAt', 'externalFileId', 'contentHash']) {
        const res = await request(app).post('/api/admin/knowledge/evidence-sources')
          .set('Authorization', `Bearer ${token}`)
          .send({ sourceType: 'official_web', title: 'Test', [field]: 'spoof' });
        expect(res.status).toBe(400);
      }
    });

    it('rejects empty and actor fields from PATCH', async () => {
      for (const body of [{}, { createdBy: 'spoof' }, { verifiedBy: 'spoof' }, { verifiedAt: new Date().toISOString() }]) {
        const res = await request(app).patch(`/api/admin/knowledge/evidence-sources/${VALID_UUID}`)
          .set('Authorization', `Bearer ${token}`).send(body);
        expect(res.status).toBe(400);
      }
    });

    it('PATCH current derives verification actor/time from session', async () => {
      const res = await request(app).patch(`/api/admin/knowledge/evidence-sources/${VALID_UUID}`)
        .set('Authorization', `Bearer ${token}`).send({ lifecycleStatus: 'current' });
      expect(res.status).toBe(200);
      const input = mockService.updateEvidenceSourceMetadata.mock.calls.at(-1)?.[1];
      expect(input.verifiedBy).toBe(ADMIN_ID);
      expect(input.verifiedAt).toBeInstanceOf(Date);
    });

    it('PATCH non-current clears verification fields', async () => {
      mockService.getEvidenceSourceDetail.mockResolvedValueOnce({
        source: { id: VALID_UUID, lifecycleStatus: 'current', verifiedAt: new Date(), verifiedBy: ADMIN_ID }, excerpts: [],
      });
      const res = await request(app).patch(`/api/admin/knowledge/evidence-sources/${VALID_UUID}`)
        .set('Authorization', `Bearer ${token}`).send({ lifecycleStatus: 'historical' });
      expect(res.status).toBe(200);
      expect(mockService.updateEvidenceSourceMetadata.mock.calls.at(-1)?.[1]).toMatchObject({ verifiedBy: null, verifiedAt: null });
    });

    it('current metadata edit preserves stored verification fields', async () => {
      const verifiedAt = new Date('2024-01-01T00:00:00.000Z');
      mockService.getEvidenceSourceDetail.mockResolvedValueOnce({
        source: { id: VALID_UUID, lifecycleStatus: 'current', academicYear: '2024-2025', verifiedAt, verifiedBy: ADMIN_ID }, excerpts: [],
      });
      const res = await request(app).patch(`/api/admin/knowledge/evidence-sources/${VALID_UUID}`)
        .set('Authorization', `Bearer ${token}`).send({ lifecycleStatus: 'current', academicYear: '2025-2026' });
      expect(res.status).toBe(200);
      const input = mockService.updateEvidenceSourceMetadata.mock.calls.at(-1)?.[1];
      expect(input).toEqual({ lifecycleStatus: 'current', academicYear: '2025-2026' });
      expect(input.verifiedAt).toBeUndefined();
      expect(input.verifiedBy).toBeUndefined();
    });

    it('admin upload, completion, and download use source-backed storage', async () => {
      mockAudit.auditAdmin.mockClear();
      const upload = await request(app).post(`/api/admin/knowledge/evidence-sources/${VALID_UUID}/upload`)
        .set('Authorization', `Bearer ${token}`).send({ fileName: 'catalog.pdf', fileSize: 100, mimeType: 'application/pdf' });
      expect(upload.status).toBe(200);
      expect(mockKnowledgeStorage.createKnowledgeEvidenceUpload).toHaveBeenCalledWith(VALID_UUID, 'catalog.pdf', 100, 'application/pdf');

      const complete = await request(app).post(`/api/admin/knowledge/evidence-sources/${VALID_UUID}/upload/complete`)
        .set('Authorization', `Bearer ${token}`).send({ storagePath: `evidence-sources/${VALID_UUID}/file.pdf` });
      expect(complete.status).toBe(200);
      expect(mockService.attachEvidenceSourceFile).toHaveBeenCalledWith(VALID_UUID, `evidence-sources/${VALID_UUID}/file.pdf`, 'sha256:abc');
      expect(mockAudit.auditAdmin).toHaveBeenCalledWith('admin.bulk_operation', ADMIN_ID, undefined, expect.stringContaining('Attached evidence file'), expect.any(Object));

      const download = await request(app).get(`/api/admin/knowledge/evidence-sources/${VALID_UUID}/download`)
        .set('Authorization', `Bearer ${token}`);
      expect(download.status).toBe(200);
      expect(mockKnowledgeStorage.createKnowledgeEvidenceDownload).toHaveBeenCalledWith(VALID_UUID, `evidence-sources/${VALID_UUID}/file.pdf`);
    });

    it('does not audit a failed immutable attachment', async () => {
      mockAudit.auditAdmin.mockClear();
      mockService.attachEvidenceSourceFile.mockRejectedValueOnce(new Error('already attached'));
      const res = await request(app).post(`/api/admin/knowledge/evidence-sources/${VALID_UUID}/upload/complete`)
        .set('Authorization', `Bearer ${token}`).send({ storagePath: `evidence-sources/${VALID_UUID}/file.pdf` });
      expect(res.status).toBe(500);
      expect(mockAudit.auditAdmin).not.toHaveBeenCalled();
    });

    it('staff cannot mutate upload, completion, or metadata', async () => {
      ({ app, token } = await createTestApp('staff', STAFF_ID));
      for (const operation of [
        request(app).post(`/api/admin/knowledge/evidence-sources/${VALID_UUID}/upload`).send({ fileName: 'a.pdf', fileSize: 1, mimeType: 'application/pdf' }),
        request(app).post(`/api/admin/knowledge/evidence-sources/${VALID_UUID}/upload/complete`).send({ storagePath: `evidence-sources/${VALID_UUID}/file.pdf` }),
        request(app).patch(`/api/admin/knowledge/evidence-sources/${VALID_UUID}`).send({ lifecycleStatus: 'current' }),
      ]) {
        expect((await operation.set('Authorization', `Bearer ${token}`)).status).toBe(403);
      }
    });

    it('staff can read institutions and source detail/download', async () => {
      ({ app, token } = await createTestApp('staff', STAFF_ID));
      expect((await request(app).get('/api/admin/knowledge/institutions').set('Authorization', `Bearer ${token}`)).status).toBe(200);
      expect((await request(app).get(`/api/admin/knowledge/evidence-sources/${VALID_UUID}`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
      expect((await request(app).get(`/api/admin/knowledge/evidence-sources/${VALID_UUID}/download`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
    });
  });
});
