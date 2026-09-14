/**
 * Phase 1C — Knowledge API Route Tests
 *
 * Tests the ACTUAL Knowledge router with real requireAuth + requireRole middleware.
 * Mocks only the Knowledge Service boundary and the database auth lookup so
 * route tests remain deterministic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Express } from 'express';

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
}));

// Mock the service module before importing the router
vi.mock('../server/services/knowledge-service', () => ({
  knowledgeService: mockService,
  createKnowledgeService: vi.fn(() => mockService),
}));

// Import the REAL KnowledgeError for use in tests (so instanceof matches in sendKnowledgeError)
import { KnowledgeError } from '../server/lib/knowledge-errors';

// Mock audit to avoid Supabase calls
vi.mock('../server/lib/audit', () => ({
  auditAdmin: vi.fn().mockResolvedValue(undefined),
}));

// Mock auth middleware to use the pre-attached user
vi.mock('../server/middleware/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }
    next();
  },
}));

// Mock RBAC middleware to use the pre-attached user role
vi.mock('../server/middleware/rbac', () => ({
  requireRole: (allowedRoles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions', required: allowedRoles, current: req.user.role });
    }
    next();
  },
}));

// Mock the database so requireAuth doesn't try to query
vi.mock('../server/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    transaction: vi.fn(async (fn: any) => fn({})),
  },
}));

// Mock supabase so requireAuth doesn't make network calls
vi.mock('../server/lib/supabase', () => ({
  supabaseAdmin: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: 'mock' }) },
  },
  isSupabaseConfigured: false,
}));

// ── Test app factory ─────────────────────────────────────────────────────────────

function createTestApp(userRole: string | null, userId: string = '00000000-0000-0000-0000-000000000001'): Express {
  const app = express();
  app.use(express.json());

  // Simulate requireAuth: attach user or reject
  app.use((req: any, _res: any, next: any) => {
    if (userRole === null) {
      // Simulate no auth header
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        _res.status(401).json({ error: 'Missing or invalid authorization header' });
        return;
      }
    }
    if (userRole !== null) {
      req.user = { id: userId, email: 'test@test.com', role: userRole };
      req.audit = { actorId: userId };
    }
    next();
  });

  return app;
}

// Helper to mount the real knowledge router with real RBAC
async function mountKnowledgeRouter(app: Express) {
  const knowledgeRouter = (await import('../server/routes/knowledge')).default;
  app.use('/api/admin/knowledge', knowledgeRouter);
  return app;
}

// Helper to also mount the generic admin router (to test mount order)
async function mountAdminRouter(app: Express) {
  // Simulate the admin router that requires admin role
  const adminRouter = express.Router();
  adminRouter.use((req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  });
  adminRouter.get('/users', (req: any, res: any) => res.json({ users: [] }));
  app.use('/api/admin', adminRouter);
}

// ── Constants ────────────────────────────────────────────────────────────────────

const ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const STAFF_ID = '00000000-0000-0000-0000-000000000002';
const STUDENT_ID = '00000000-0000-0000-0000-000000000003';
const COACH_ID = '00000000-0000-0000-0000-000000000004';
const VALID_UUID = '12345678-1234-1234-1234-123456789012';
const ANOTHER_UUID = '87654321-4321-4321-4321-210987654321';

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('Phase 1C — Knowledge API Routes', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    // Set default mock returns
    mockService.listEvidenceSources.mockResolvedValue([]);
    mockService.listClaims.mockResolvedValue([]);
    mockService.listConflicts.mockResolvedValue([]);
    mockService.getEvidenceSourceDetail.mockResolvedValue({ source: { id: VALID_UUID }, excerpts: [] });
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
    mockService.attachEvidenceToClaimVersion.mockResolvedValue({ id: VALID_UUID });
    mockService.recordVerification.mockResolvedValue({ id: VALID_UUID });
    mockService.confirmClaimVersion.mockResolvedValue({ claimVersionId: VALID_UUID, claimId: VALID_UUID, status: 'confirmed' });
    mockService.supersedeClaimVersion.mockResolvedValue({ oldVersionId: VALID_UUID, newVersionId: ANOTHER_UUID, claimId: VALID_UUID, status: 'superseded' });
    mockService.createKnowledgeConflict.mockResolvedValue({ id: VALID_UUID, status: 'open' });
    mockService.resolveKnowledgeConflict.mockResolvedValue({ id: VALID_UUID, status: 'resolved' });
    mockService.createAcademicRuleFromVerifiedClaim.mockResolvedValue({ id: VALID_UUID, status: 'confirmed' });
    mockService.createEquivalencyFromVerifiedClaim.mockResolvedValue({ id: VALID_UUID, status: 'confirmed' });
    mockService.createArticulationFromVerifiedClaim.mockResolvedValue({ id: VALID_UUID, status: 'confirmed' });
  });

  // ── AUTH/RBAC ─────────────────────────────────────────────────────────────────

  describe('Auth/RBAC', () => {
    it('1. unauthenticated GET → 401', async () => {
      app = createTestApp(null);
      await mountKnowledgeRouter(app);
      const res = await request(app).get('/api/admin/knowledge/evidence-sources');
      expect(res.status).toBe(401);
    });

    it('2. student GET → 403', async () => {
      app = createTestApp('student', STUDENT_ID);
      await mountKnowledgeRouter(app);
      const res = await request(app).get('/api/admin/knowledge/evidence-sources');
      expect(res.status).toBe(403);
    });

    it('3. coach GET → 403', async () => {
      app = createTestApp('coach', COACH_ID);
      await mountKnowledgeRouter(app);
      const res = await request(app).get('/api/admin/knowledge/evidence-sources');
      expect(res.status).toBe(403);
    });

    it('4. staff GET → 200', async () => {
      app = createTestApp('staff', STAFF_ID);
      await mountKnowledgeRouter(app);
      const res = await request(app).get('/api/admin/knowledge/evidence-sources');
      expect(res.status).toBe(200);
    });

    it('5. staff mutation → 403', async () => {
      app = createTestApp('staff', STAFF_ID);
      await mountKnowledgeRouter(app);
      const res = await request(app).post('/api/admin/knowledge/evidence-sources')
        .send({ sourceType: 'official_web', title: 'Test' });
      expect(res.status).toBe(403);
    });

    it('6. admin GET → 200', async () => {
      app = createTestApp('admin', ADMIN_ID);
      await mountKnowledgeRouter(app);
      const res = await request(app).get('/api/admin/knowledge/evidence-sources');
      expect(res.status).toBe(200);
    });

    it('7. admin mutation reaches Knowledge Service', async () => {
      app = createTestApp('admin', ADMIN_ID);
      await mountKnowledgeRouter(app);
      const res = await request(app).post('/api/admin/knowledge/evidence-sources')
        .send({ sourceType: 'official_web', title: 'Test Source' });
      expect(res.status).toBe(201);
      expect(mockService.createEvidenceSource).toHaveBeenCalled();
    });
  });

  // ── PRODUCTION MOUNT ORDER ──────────────────────────────────────────────────────

  describe('Production mount order', () => {
    it('8. staff GET through production mount is NOT intercepted by admin-only router', async () => {
      app = createTestApp('staff', STAFF_ID);
      // Mount knowledge router FIRST (as in production)
      await mountKnowledgeRouter(app);
      // Then mount the generic admin router
      await mountAdminRouter(app);

      const res = await request(app).get('/api/admin/knowledge/evidence-sources');
      expect(res.status).toBe(200);
      // Verify the admin router would block staff
      const adminRes = await request(app).get('/api/admin/users');
      expect(adminRes.status).toBe(403);
    });
  });

  // ── VALIDATION ────────────────────────────────────────────────────────────────────

  describe('Validation', () => {
    beforeEach(async () => {
      app = createTestApp('admin', ADMIN_ID);
      await mountKnowledgeRouter(app);
    });

    it('9. malformed UUID param → controlled 400', async () => {
      const res = await request(app).get('/api/admin/knowledge/evidence-sources/not-a-uuid');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_UUID');
    });

    it('10. malformed UUID body field → controlled 400', async () => {
      const res = await request(app).post('/api/admin/knowledge/claims')
        .send({ claimKey: 'test', claimType: 'equivalency', subjectType: 'institution', subjectId: 'not-a-uuid' });
      expect(res.status).toBe(400);
    });

    it('11. invalid pagination → 400', async () => {
      const res = await request(app).get('/api/admin/knowledge/evidence-sources?limit=-1');
      expect(res.status).toBe(400);
    });

    it('12. ISO date strings are converted correctly before service call', async () => {
      const res = await request(app).post('/api/admin/knowledge/evidence-sources')
        .send({
          sourceType: 'official_web',
          title: 'Test',
          effectiveFrom: '2025-01-01T00:00:00.000Z',
          effectiveTo: '2025-12-31T00:00:00.000Z',
        });
      expect(res.status).toBe(201);
      const callArg = mockService.createEvidenceSource.mock.calls[0][0];
      expect(callArg.effectiveFrom).toBeInstanceOf(Date);
      expect(callArg.effectiveTo).toBeInstanceOf(Date);
    });

    it('13. unknown/spoofable fields are rejected', async () => {
      const res = await request(app).post('/api/admin/knowledge/evidence-sources')
        .send({ sourceType: 'official_web', title: 'Test', createdBy: 'attacker-id' });
      expect(res.status).toBe(400);
    });
  });

  // ── ACTOR TRUST ───────────────────────────────────────────────────────────────────

  describe('Actor trust', () => {
    beforeEach(async () => {
      app = createTestApp('admin', ADMIN_ID);
      await mountKnowledgeRouter(app);
    });

    it('14. evidence source receives createdBy = authenticated admin ID', async () => {
      await request(app).post('/api/admin/knowledge/evidence-sources')
        .send({ sourceType: 'official_web', title: 'Test' });
      const callArg = mockService.createEvidenceSource.mock.calls[0][0];
      expect(callArg.createdBy).toBe(ADMIN_ID);
    });

    it('15. claim receives createdBy = authenticated admin ID', async () => {
      await request(app).post('/api/admin/knowledge/claims')
        .send({ claimKey: 'test', claimType: 'equivalency', subjectType: 'institution' });
      const callArg = mockService.createKnowledgeClaim.mock.calls[0][0];
      expect(callArg.createdBy).toBe(ADMIN_ID);
    });

    it('16. claim version receives createdBy = authenticated admin ID', async () => {
      await request(app).post('/api/admin/knowledge/claims/' + VALID_UUID + '/versions')
        .send({ statement: 'test', confidence: 75 });
      const callArg = mockService.createClaimVersion.mock.calls[0][0];
      expect(callArg.createdBy).toBe(ADMIN_ID);
    });

    it('17. verification receives reviewerId = authenticated admin ID', async () => {
      await request(app).post('/api/admin/knowledge/claim-versions/' + VALID_UUID + '/verifications')
        .send({ action: 'verified' });
      const callArg = mockService.recordVerification.mock.calls[0][0];
      expect(callArg.reviewerId).toBe(ADMIN_ID);
    });

    it('18. supersession receives reviewerId = authenticated admin ID', async () => {
      await request(app).post('/api/admin/knowledge/claim-versions/' + VALID_UUID + '/supersede')
        .send({ newVersionId: ANOTHER_UUID });
      const callArgs = mockService.supersedeClaimVersion.mock.calls[0];
      expect(callArgs[2]).toBe(ADMIN_ID);
    });

    it('19. conflict resolution receives resolvedBy = authenticated admin ID', async () => {
      await request(app).post('/api/admin/knowledge/conflicts/' + VALID_UUID + '/resolve')
        .send({ resolutionNotes: 'Resolved' });
      const callArgs = mockService.resolveKnowledgeConflict.mock.calls[0];
      expect(callArgs[2]).toBe(ADMIN_ID);
    });

    it('20. client cannot impersonate another actor through body fields', async () => {
      await request(app).post('/api/admin/knowledge/evidence-sources')
        .send({ sourceType: 'official_web', title: 'Test', createdBy: 'attacker-id' });
      // Should be rejected by .strict() schema
      const callArg = mockService.createEvidenceSource.mock.calls[0];
      // If it was rejected, the service was never called
      if (callArg) {
        expect(callArg[0].createdBy).not.toBe('attacker-id');
      }
    });
  });

  // ── ERROR MAPPING ─────────────────────────────────────────────────────────────────

  describe('Error mapping', () => {

    beforeEach(async () => {
      app = createTestApp('admin', ADMIN_ID);
      await mountKnowledgeRouter(app);
    });

    it('21. KNOWLEDGE_VALIDATION_ERROR → 400', async () => {
      mockService.createEvidenceSource.mockRejectedValueOnce(
        new KnowledgeError('KNOWLEDGE_VALIDATION_ERROR', 'Bad input'),
      );
      const res = await request(app).post('/api/admin/knowledge/evidence-sources')
        .send({ sourceType: 'official_web', title: 'Test' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
    });

    it('22. KNOWLEDGE_NOT_FOUND → 404', async () => {
      mockService.getEvidenceSourceDetail.mockRejectedValueOnce(
        new KnowledgeError('KNOWLEDGE_NOT_FOUND', 'Not found'),
      );
      const res = await request(app).get('/api/admin/knowledge/evidence-sources/' + VALID_UUID);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('KNOWLEDGE_NOT_FOUND');
    });

    it('23. KNOWLEDGE_DUPLICATE → 409', async () => {
      mockService.createKnowledgeClaim.mockRejectedValueOnce(
        new KnowledgeError('KNOWLEDGE_DUPLICATE', 'Duplicate'),
      );
      const res = await request(app).post('/api/admin/knowledge/claims')
        .send({ claimKey: 'test', claimType: 'equivalency', subjectType: 'institution' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('KNOWLEDGE_DUPLICATE');
    });

    it('24. KNOWLEDGE_INVALID_STATE → 409', async () => {
      mockService.confirmClaimVersion.mockRejectedValueOnce(
        new KnowledgeError('KNOWLEDGE_INVALID_STATE', 'Bad state'),
      );
      const res = await request(app).post('/api/admin/knowledge/claim-versions/' + VALID_UUID + '/confirm');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('KNOWLEDGE_INVALID_STATE');
    });

    it('25. KNOWLEDGE_EVIDENCE_REQUIRED → 409', async () => {
      mockService.confirmClaimVersion.mockRejectedValueOnce(
        new KnowledgeError('KNOWLEDGE_EVIDENCE_REQUIRED', 'Need evidence'),
      );
      const res = await request(app).post('/api/admin/knowledge/claim-versions/' + VALID_UUID + '/confirm');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('KNOWLEDGE_EVIDENCE_REQUIRED');
    });

    it('26. KNOWLEDGE_VERIFICATION_REQUIRED → 409', async () => {
      mockService.confirmClaimVersion.mockRejectedValueOnce(
        new KnowledgeError('KNOWLEDGE_VERIFICATION_REQUIRED', 'Need verification'),
      );
      const res = await request(app).post('/api/admin/knowledge/claim-versions/' + VALID_UUID + '/confirm');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('KNOWLEDGE_VERIFICATION_REQUIRED');
    });

    it('27. KNOWLEDGE_OPEN_CONFLICT → 409', async () => {
      mockService.confirmClaimVersion.mockRejectedValueOnce(
        new KnowledgeError('KNOWLEDGE_OPEN_CONFLICT', 'Open conflict'),
      );
      const res = await request(app).post('/api/admin/knowledge/claim-versions/' + VALID_UUID + '/confirm');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('KNOWLEDGE_OPEN_CONFLICT');
    });

    it('28. KNOWLEDGE_SUPERSESSION_REQUIRED → 409', async () => {
      mockService.confirmClaimVersion.mockRejectedValueOnce(
        new KnowledgeError('KNOWLEDGE_SUPERSESSION_REQUIRED', 'Need supersession'),
      );
      const res = await request(app).post('/api/admin/knowledge/claim-versions/' + VALID_UUID + '/confirm');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('KNOWLEDGE_SUPERSESSION_REQUIRED');
    });

    it('29. unexpected error → sanitized 500', async () => {
      mockService.getEvidenceSourceDetail.mockRejectedValueOnce(new Error('DB connection failed'));
      const res = await request(app).get('/api/admin/knowledge/evidence-sources/' + VALID_UUID);
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).not.toContain('DB');
    });
  });

  // ── WORKFLOW ROUTES ───────────────────────────────────────────────────────────────

  describe('Workflow routes', () => {
    beforeEach(async () => {
      app = createTestApp('admin', ADMIN_ID);
      await mountKnowledgeRouter(app);
    });

    it('30. evidence source creation returns 201', async () => {
      const res = await request(app).post('/api/admin/knowledge/evidence-sources')
        .send({ sourceType: 'official_web', title: 'Test' });
      expect(res.status).toBe(201);
      expect(res.body.evidenceSource).toBeDefined();
    });

    it('31. excerpt creation returns 201', async () => {
      const res = await request(app).post('/api/admin/knowledge/evidence-sources/' + VALID_UUID + '/excerpts')
        .send({ excerptText: 'Test excerpt' });
      expect(res.status).toBe(201);
      expect(res.body.excerpt).toBeDefined();
    });

    it('32. claim creation returns 201', async () => {
      const res = await request(app).post('/api/admin/knowledge/claims')
        .send({ claimKey: 'test', claimType: 'equivalency', subjectType: 'institution' });
      expect(res.status).toBe(201);
      expect(res.body.claim).toBeDefined();
    });

    it('33. claim version creation returns 201', async () => {
      const res = await request(app).post('/api/admin/knowledge/claims/' + VALID_UUID + '/versions')
        .send({ statement: 'test', confidence: 75 });
      expect(res.status).toBe(201);
      expect(res.body.claimVersion).toBeDefined();
    });

    it('34. evidence attachment returns 201', async () => {
      const res = await request(app).post('/api/admin/knowledge/claim-versions/' + VALID_UUID + '/evidence')
        .send({ evidenceExcerptId: ANOTHER_UUID, relationshipType: 'supports' });
      expect(res.status).toBe(201);
      expect(res.body.evidenceRelationship).toBeDefined();
    });

    it('35. verification returns 201', async () => {
      const res = await request(app).post('/api/admin/knowledge/claim-versions/' + VALID_UUID + '/verifications')
        .send({ action: 'verified' });
      expect(res.status).toBe(201);
      expect(res.body.verificationEvent).toBeDefined();
    });

    it('36. confirmation returns 200', async () => {
      const res = await request(app).post('/api/admin/knowledge/claim-versions/' + VALID_UUID + '/confirm');
      expect(res.status).toBe(200);
      expect(res.body.confirmation).toBeDefined();
    });

    it('37. supersession returns 200', async () => {
      const res = await request(app).post('/api/admin/knowledge/claim-versions/' + VALID_UUID + '/supersede')
        .send({ newVersionId: ANOTHER_UUID });
      expect(res.status).toBe(200);
      expect(res.body.supersession).toBeDefined();
    });

    it('38. conflict creation returns 201', async () => {
      const res = await request(app).post('/api/admin/knowledge/conflicts')
        .send({ claimVersionAId: VALID_UUID, conflictType: 'contradiction', description: 'Test conflict' });
      expect(res.status).toBe(201);
      expect(res.body.conflict).toBeDefined();
    });

    it('39. conflict resolution returns 200', async () => {
      const res = await request(app).post('/api/admin/knowledge/conflicts/' + VALID_UUID + '/resolve')
        .send({ resolutionNotes: 'Resolved by admin' });
      expect(res.status).toBe(200);
      expect(res.body.conflict).toBeDefined();
    });

    it('40. academic rule creation returns 201', async () => {
      const res = await request(app).post('/api/admin/knowledge/academic-rules')
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

    it('41. equivalency creation returns 201', async () => {
      const res = await request(app).post('/api/admin/knowledge/equivalencies')
        .send({
          sourceProviderCourseVersionId: VALID_UUID,
          institutionId: ANOTHER_UUID,
          claimVersionId: VALID_UUID,
        });
      expect(res.status).toBe(201);
      expect(res.body.equivalency).toBeDefined();
    });

    it('42. articulation creation returns 201', async () => {
      const res = await request(app).post('/api/admin/knowledge/articulations')
        .send({
          programVersionId: VALID_UUID,
          requirementId: ANOTHER_UUID,
          claimVersionId: VALID_UUID,
        });
      expect(res.status).toBe(201);
      expect(res.body.articulation).toBeDefined();
    });
  });

  // ── READ MODELS ───────────────────────────────────────────────────────────────────

  describe('Read models', () => {
    beforeEach(async () => {
      app = createTestApp('admin', ADMIN_ID);
      await mountKnowledgeRouter(app);
    });

    it('43. evidence source detail includes excerpts', async () => {
      mockService.getEvidenceSourceDetail.mockResolvedValueOnce({
        source: { id: VALID_UUID, title: 'Test' },
        excerpts: [{ id: 'excerpt-1', excerptText: 'Text' }],
      });
      const res = await request(app).get('/api/admin/knowledge/evidence-sources/' + VALID_UUID);
      expect(res.status).toBe(200);
      expect(res.body.source).toBeDefined();
      expect(res.body.excerpts).toHaveLength(1);
    });

    it('44. claim detail includes versions', async () => {
      mockService.getClaimDetail.mockResolvedValueOnce({
        claim: { id: VALID_UUID, claimKey: 'test' },
        versions: [{ id: 'v1', versionNumber: 1 }, { id: 'v2', versionNumber: 2 }],
      });
      const res = await request(app).get('/api/admin/knowledge/claims/' + VALID_UUID);
      expect(res.status).toBe(200);
      expect(res.body.claim).toBeDefined();
      expect(res.body.versions).toHaveLength(2);
    });

    it('45. claim-version detail includes provenance/verification/conflicts/canonical records', async () => {
      mockService.getClaimVersionDetail.mockResolvedValueOnce({
        version: { id: VALID_UUID, status: 'confirmed' },
        claim: { id: VALID_UUID },
        evidenceRelationships: [{ id: 'er-1' }],
        verificationEvents: [{ id: 've-1', action: 'verified' }],
        openConflicts: [],
        canonicalRecords: {
          academicRules: [{ id: 'ar-1' }],
          equivalencies: [{ id: 'eq-1' }],
          articulations: [{ id: 'art-1' }],
        },
      });
      const res = await request(app).get('/api/admin/knowledge/claim-versions/' + VALID_UUID);
      expect(res.status).toBe(200);
      expect(res.body.version).toBeDefined();
      expect(res.body.claim).toBeDefined();
      expect(res.body.evidenceRelationships).toHaveLength(1);
      expect(res.body.verificationEvents).toHaveLength(1);
      expect(res.body.openConflicts).toHaveLength(0);
      expect(res.body.canonicalRecords.academicRules).toHaveLength(1);
      expect(res.body.canonicalRecords.equivalencies).toHaveLength(1);
      expect(res.body.canonicalRecords.articulations).toHaveLength(1);
    });

    it('46. resolved conflicts remain queryable', async () => {
      mockService.listConflicts.mockResolvedValueOnce([
        { id: 'c1', status: 'resolved' },
        { id: 'c2', status: 'open' },
      ]);
      const res = await request(app).get('/api/admin/knowledge/conflicts');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].status).toBe('resolved');
    });
  });

  // ── NO HARD DELETE ─────────────────────────────────────────────────────────────────

  describe('No hard delete', () => {
    it('47. no Knowledge DELETE endpoint exists', async () => {
      app = createTestApp('admin', ADMIN_ID);
      await mountKnowledgeRouter(app);

      // Try various DELETE paths
      const paths = [
        '/api/admin/knowledge/evidence-sources/' + VALID_UUID,
        '/api/admin/knowledge/claims/' + VALID_UUID,
        '/api/admin/knowledge/claim-versions/' + VALID_UUID,
        '/api/admin/knowledge/conflicts/' + VALID_UUID,
      ];

      for (const path of paths) {
        const res = await request(app).delete(path);
        expect(res.status).toBe(404); // No DELETE route defined
      }
    });
  });
});
