/**
 * Phase 1D-C — Final Real HTTP/Auth/RBAC E2E + Phase 1 Closure
 *
 * Proves the real Knowledge HTTP stack end-to-end:
 * HTTP → registerRoutes → requireAuth → RBAC → Knowledge Router → Knowledge Service → Repository → Drizzle → PostgreSQL
 *
 * Uses REAL Supabase Auth for test users. No mocks for auth, Knowledge Service,
 * repository, or database. The only permitted mock is a narrow passthrough
 * for auditAdmin if the legacy audit sink causes instability.
 *
 * OPT-IN: Set RUN_PHASE1DC_E2E=1 to enable. Without this env var, all tests
 * are skipped. Also requires DATABASE_URL pointing to rheronevecsffaejteoj.
 */

import { describe, it, expect, afterEach, beforeAll, vitest } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { readFileSync } from 'fs';

// Load .env so SUPABASE_URL, SUPABASE_SERVICE_KEY, DATABASE_URL are available
// Must happen BEFORE any server module imports that capture env vars at load time.
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

// Dynamic imports after env is loaded
const { db } = await import('../server/lib/db');
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  evidenceSources,
  evidenceExcerpts,
  knowledgeClaims,
  claimVersions,
  claimEvidence,
  verificationEvents,
  knowledgeConflicts,
  academicRules,
} from '@shared/knowledge-schema';

const RUN_TESTS = process.env.RUN_PHASE1DC_E2E === '1';
const DB_URL = process.env.DATABASE_URL ?? '';
const IS_TARGET = DB_URL.includes('rheronevecsffaejteoj');

const it_e2e = RUN_TESTS ? it : it.skip;
const describe_e2e = RUN_TESTS ? describe : describe.skip;

const PREFIX = `p1dc-${Date.now()}`;
const TESU_SLUG = 'tesu';
const TEST_PASSWORD = `T3st!Pass#${Date.now()}`;

// ── Fixture tracking ─────────────────────────────────────────────────────────
let createdAcademicRuleIds: string[] = [];
let createdConflictIds: string[] = [];
let createdClaimEvidenceIds: { cv: string; ee: string }[] = [];
let createdVerificationEventIds: string[] = [];
let createdVersionIds: string[] = [];
let createdClaimIds: string[] = [];
let createdExcerptIds: string[] = [];
let createdSourceIds: string[] = [];
let createdUserIds: string[] = [];
let preTestCounts: Record<string, number> = {};

// ── Supabase admin client for user creation/deletion (lazy init) ─────────────
let _supabaseAdmin: ReturnType<typeof createClient> | null = null;
function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || '';
    _supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _supabaseAdmin;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getTesuId(): Promise<string> {
  const result = await db.execute(
    sql`SELECT id FROM knowledge_institutions WHERE slug = ${TESU_SLUG}`
  );
  return (result as any)[0].id as string;
}

async function snapshotCounts(): Promise<Record<string, number>> {
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM knowledge_evidence_sources) as kes,
      (SELECT count(*) FROM knowledge_evidence_excerpts) as kee,
      (SELECT count(*) FROM knowledge_claims) as kc,
      (SELECT count(*) FROM knowledge_claim_versions) as kcv,
      (SELECT count(*) FROM knowledge_claim_evidence) as kce,
      (SELECT count(*) FROM knowledge_verification_events) as kve,
      (SELECT count(*) FROM knowledge_conflicts) as kcon,
      (SELECT count(*) FROM knowledge_academic_rules) as kar,
      (SELECT count(*) FROM knowledge_institutions) as ki,
      (SELECT count(*) FROM users) as users,
      (SELECT count(*) FROM students) as students,
      (SELECT count(*) FROM documents) as docs,
      (SELECT count(*) FROM support_tickets) as tickets,
      (SELECT count(*) FROM ticket_comments) as comments
  `);
  return result[0] as any;
}

interface TestUser {
  id: string;
  email: string;
  password: string;
  role: string;
  token: string;
}

async function createTestUser(role: 'admin' | 'staff' | 'student'): Promise<TestUser> {
  const email = `${PREFIX}-${role}@test.lumiere.app`;

  // Create Supabase Auth user
  const { data: authData, error: authError } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });

  if (authError || !authData.user) {
    throw new Error(`Failed to create Supabase auth user for ${role}: ${authError?.message}`);
  }

  const userId = authData.user.id;
  createdUserIds.push(userId);

  // Create public.users row with the correct role
  await db.insert(users).values({
    id: userId,
    email,
    name: `${PREFIX} ${role}`,
    role,
  });

  // Login via the ACTUAL application endpoint
  const app = await createTestApp();
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email, password: TEST_PASSWORD });

  if (loginRes.status !== 200 || !loginRes.body.session?.access_token) {
    throw new Error(`Login failed for ${role}: status=${loginRes.status} body=${JSON.stringify(loginRes.body)}`);
  }

  return {
    id: userId,
    email,
    password: TEST_PASSWORD,
    role,
    token: loginRes.body.session.access_token,
  };
}

async function deleteTestUser(userId: string) {
  // Delete from public.users
  try { await db.delete(users).where(eq(users.id, userId)); } catch {}
  // Delete from Supabase Auth
  try { await getSupabaseAdmin().auth.admin.deleteUser(userId); } catch {}
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

async function cleanupAllFixtures() {
  for (const id of createdAcademicRuleIds) {
    try { await db.delete(academicRules).where(eq(academicRules.id, id)); } catch {}
  }
  for (const id of createdConflictIds) {
    try { await db.delete(knowledgeConflicts).where(eq(knowledgeConflicts.id, id)); } catch {}
  }
  for (const { cv, ee } of createdClaimEvidenceIds) {
    try {
      await db.delete(claimEvidence).where(
        sql`${claimEvidence.claimVersionId} = ${cv} AND ${claimEvidence.evidenceExcerptId} = ${ee}`
      );
    } catch {}
  }
  for (const id of createdVerificationEventIds) {
    try { await db.delete(verificationEvents).where(eq(verificationEvents.id, id)); } catch {}
  }
  for (const vid of createdVersionIds) {
    try { await db.delete(verificationEvents).where(eq(verificationEvents.claimVersionId, vid)); } catch {}
    try { await db.delete(claimEvidence).where(eq(claimEvidence.claimVersionId, vid)); } catch {}
  }
  for (const id of createdVersionIds) {
    try { await db.update(claimVersions).set({ supersedesVersionId: null }).where(eq(claimVersions.supersedesVersionId, id)); } catch {}
  }
  for (const id of createdVersionIds) {
    try {
      const [v] = await db.select().from(claimVersions).where(eq(claimVersions.id, id)).limit(1);
      if (v) {
        try { await db.update(knowledgeClaims).set({ currentVersionId: null }).where(eq(knowledgeClaims.id, v.claimId)); } catch {}
      }
    } catch {}
  }
  for (const id of createdVersionIds) {
    try { await db.delete(claimVersions).where(eq(claimVersions.id, id)); } catch {}
  }
  for (const id of createdClaimIds) {
    try { await db.delete(knowledgeClaims).where(eq(knowledgeClaims.id, id)); } catch {}
  }
  for (const id of createdExcerptIds) {
    try { await db.delete(evidenceExcerpts).where(eq(evidenceExcerpts.id, id)); } catch {}
  }
  for (const id of createdSourceIds) {
    try { await db.delete(evidenceSources).where(eq(evidenceSources.id, id)); } catch {}
  }
  for (const userId of createdUserIds) {
    await deleteTestUser(userId);
  }

  createdAcademicRuleIds = [];
  createdConflictIds = [];
  createdClaimEvidenceIds = [];
  createdVerificationEventIds = [];
  createdVersionIds = [];
  createdClaimIds = [];
  createdExcerptIds = [];
  createdSourceIds = [];
  createdUserIds = [];
}

// ── Test app factory: uses REAL registerRoutes ──────────────────────────────

let cachedApp: Express | null = null;

async function createTestApp(): Promise<Express> {
  if (cachedApp) return cachedApp;

  const app = express();
  app.use(express.json());

  // Use the REAL registerRoutes which mounts all routes in production order
  const { registerRoutes } = await import('../server/routes');
  await registerRoutes(app);

  cachedApp = app;
  return app;
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe_e2e('Phase 1D-C: Real HTTP/Auth/RBAC E2E + Phase 1 Closure', () => {
  if (RUN_TESTS) {
    vitest.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
  }

  let tesuId: string;
  let adminUser: TestUser;
  let staffUser: TestUser;
  let studentUser: TestUser;

  beforeAll(async () => {
    if (!RUN_TESTS) return;
    if (!DB_URL) throw new Error('DATABASE_URL not set');
    if (!IS_TARGET) {
      throw new Error('RUN_PHASE1DC_E2E=1 but DATABASE_URL does not point to rheronevecsffaejteoj. Refusing to run.');
    }
    tesuId = await getTesuId();
    preTestCounts = await snapshotCounts();

    // Create real Supabase Auth users with matching public.users rows
    adminUser = await createTestUser('admin');
    staffUser = await createTestUser('staff');
    studentUser = await createTestUser('student');
  });

  afterEach(async () => {
    if (!RUN_TESTS) return;
    // Clean up Knowledge fixtures after each test (but not users)
    for (const id of createdAcademicRuleIds) {
      try { await db.delete(academicRules).where(eq(academicRules.id, id)); } catch {}
    }
    for (const id of createdConflictIds) {
      try { await db.delete(knowledgeConflicts).where(eq(knowledgeConflicts.id, id)); } catch {}
    }
    for (const { cv, ee } of createdClaimEvidenceIds) {
      try {
        await db.delete(claimEvidence).where(
          sql`${claimEvidence.claimVersionId} = ${cv} AND ${claimEvidence.evidenceExcerptId} = ${ee}`
        );
      } catch {}
    }
    for (const id of createdVerificationEventIds) {
      try { await db.delete(verificationEvents).where(eq(verificationEvents.id, id)); } catch {}
    }
    for (const vid of createdVersionIds) {
      try { await db.delete(verificationEvents).where(eq(verificationEvents.claimVersionId, vid)); } catch {}
      try { await db.delete(claimEvidence).where(eq(claimEvidence.claimVersionId, vid)); } catch {}
    }
    for (const id of createdVersionIds) {
      try { await db.update(claimVersions).set({ supersedesVersionId: null }).where(eq(claimVersions.supersedesVersionId, id)); } catch {}
    }
    for (const id of createdVersionIds) {
      try {
        const [v] = await db.select().from(claimVersions).where(eq(claimVersions.id, id)).limit(1);
        if (v) {
          try { await db.update(knowledgeClaims).set({ currentVersionId: null }).where(eq(knowledgeClaims.id, v.claimId)); } catch {}
        }
      } catch {}
    }
    for (const id of createdVersionIds) {
      try { await db.delete(claimVersions).where(eq(claimVersions.id, id)); } catch {}
    }
    for (const id of createdClaimIds) {
      try { await db.delete(knowledgeClaims).where(eq(knowledgeClaims.id, id)); } catch {}
    }
    for (const id of createdExcerptIds) {
      try { await db.delete(evidenceExcerpts).where(eq(evidenceExcerpts.id, id)); } catch {}
    }
    for (const id of createdSourceIds) {
      try { await db.delete(evidenceSources).where(eq(evidenceSources.id, id)); } catch {}
    }

    createdAcademicRuleIds = [];
    createdConflictIds = [];
    createdClaimEvidenceIds = [];
    createdVerificationEventIds = [];
    createdVersionIds = [];
    createdClaimIds = [];
    createdExcerptIds = [];
    createdSourceIds = [];
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §3. REAL TEMP USERS + LOGIN + RBAC MATRIX
  // ═══════════════════════════════════════════════════════════════════════════

  describe('§3: Real Supabase Auth users + RBAC matrix', () => {
    it_e2e('unauthenticated Knowledge GET → 401', async () => {
      const app = await createTestApp();
      const res = await request(app).get('/api/admin/knowledge/evidence-sources');
      expect(res.status).toBe(401);
    });

    it_e2e('student Knowledge GET → 403', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .get('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${studentUser.token}`);
      expect(res.status).toBe(403);
    });

    it_e2e('staff Knowledge GET → 200', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .get('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${staffUser.token}`);
      expect(res.status).toBe(200);
    });

    it_e2e('staff Knowledge mutation → 403', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${staffUser.token}`)
        .send({ sourceType: 'official_web', title: 'Test' });
      expect(res.status).toBe(403);
    });

    it_e2e('admin Knowledge GET → 200', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .get('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${adminUser.token}`);
      expect(res.status).toBe(200);
    });

    it_e2e('admin Knowledge mutation → allowed (201)', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          sourceType: 'official_web',
          title: `${PREFIX} RBAC test source`,
          authorityLevel: 'primary',
          institutionId: tesuId,
        });
      expect(res.status).toBe(201);
      expect(res.body.evidenceSource).toBeDefined();
      expect(res.body.evidenceSource.id).toBeDefined();
      createdSourceIds.push(res.body.evidenceSource.id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §4. REAL HTTP KNOWLEDGE PIPELINE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('§4: Full HTTP Knowledge pipeline', () => {
    it_e2e('create evidence source → excerpt → claim → version → evidence → verify → confirm → academic rule → GET detail', async () => {
      const app = await createTestApp();
      const authHeader = `Bearer ${adminUser.token}`;

      // 1. Create evidence source
      const sourceRes = await request(app)
        .post('/api/admin/knowledge/evidence-sources')
        .set('Authorization', authHeader)
        .send({
          sourceType: 'official_catalog',
          title: `${PREFIX} pipeline source`,
          authorityLevel: 'primary',
          institutionId: tesuId,
        });
      expect(sourceRes.status).toBe(201);
      const sourceId = sourceRes.body.evidenceSource.id;
      createdSourceIds.push(sourceId);

      // Verify createdBy is the authenticated admin ID
      expect(sourceRes.body.evidenceSource.createdBy).toBe(adminUser.id);

      // 2. Create excerpt
      const excerptRes = await request(app)
        .post(`/api/admin/knowledge/evidence-sources/${sourceId}/excerpts`)
        .set('Authorization', authHeader)
        .send({
          excerptText: `${PREFIX} pipeline excerpt text`,
          locator: 'page 42',
        });
      expect(excerptRes.status).toBe(201);
      const excerptId = excerptRes.body.excerpt.id;
      createdExcerptIds.push(excerptId);

      // 3. Create claim
      const claimRes = await request(app)
        .post('/api/admin/knowledge/claims')
        .set('Authorization', authHeader)
        .send({
          claimKey: `${PREFIX}-pipeline-claim`,
          claimType: 'rule',
          subjectType: 'institution',
          subjectId: tesuId,
        });
      expect(claimRes.status).toBe(201);
      const claimId = claimRes.body.claim.id;
      createdClaimIds.push(claimId);

      // Verify createdBy is the authenticated admin ID
      expect(claimRes.body.claim.createdBy).toBe(adminUser.id);

      // 4. Create claim version
      const versionRes = await request(app)
        .post(`/api/admin/knowledge/claims/${claimId}/versions`)
        .set('Authorization', authHeader)
        .send({
          statement: `${PREFIX} pipeline statement`,
          confidence: 85,
        });
      expect(versionRes.status).toBe(201);
      const versionId = versionRes.body.claimVersion.id;
      createdVersionIds.push(versionId);

      // Verify createdBy is the authenticated admin ID
      expect(versionRes.body.claimVersion.createdBy).toBe(adminUser.id);

      // 5. Attach supporting evidence
      const evidenceRes = await request(app)
        .post(`/api/admin/knowledge/claim-versions/${versionId}/evidence`)
        .set('Authorization', authHeader)
        .send({
          evidenceExcerptId: excerptId,
          relationshipType: 'supports',
        });
      expect(evidenceRes.status).toBe(201);
      createdClaimEvidenceIds.push({ cv: versionId, ee: excerptId });

      // 6. Record verified verification
      const verifyRes = await request(app)
        .post(`/api/admin/knowledge/claim-versions/${versionId}/verifications`)
        .set('Authorization', authHeader)
        .send({
          action: 'verified',
        });
      expect(verifyRes.status).toBe(201);
      const verificationId = verifyRes.body.verificationEvent.id;
      createdVerificationEventIds.push(verificationId);

      // Verify reviewerId is the authenticated admin ID
      expect(verifyRes.body.verificationEvent.reviewerId).toBe(adminUser.id);

      // 7. Confirm claim version
      const confirmRes = await request(app)
        .post(`/api/admin/knowledge/claim-versions/${versionId}/confirm`)
        .set('Authorization', authHeader)
        .send({});
      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.confirmation.status).toBe('confirmed');

      // 8. Create academic rule
      const ruleRes = await request(app)
        .post('/api/admin/knowledge/academic-rules')
        .set('Authorization', authHeader)
        .send({
          institutionId: tesuId,
          ruleKey: `${PREFIX}-pipeline-rule`,
          ruleKind: 'residency',
          title: `${PREFIX} pipeline academic rule`,
          claimVersionId: versionId,
          ruleValue: { maxCredits: 90 },
        });
      expect(ruleRes.status).toBe(201);
      const ruleId = ruleRes.body.academicRule.id;
      createdAcademicRuleIds.push(ruleId);

      // 9. GET claim-version detail — verify full provenance
      const detailRes = await request(app)
        .get(`/api/admin/knowledge/claim-versions/${versionId}`)
        .set('Authorization', authHeader);
      expect(detailRes.status).toBe(200);

      const detail = detailRes.body;
      // Confirmed version
      expect(detail.version.id).toBe(versionId);
      expect(detail.version.status).toBe('confirmed');
      // Parent claim
      expect(detail.claim.id).toBe(claimId);
      expect(detail.claim.claimKey).toContain('pipeline');
      // Supporting evidence provenance
      expect(detail.evidenceRelationships.length).toBe(1);
      expect(detail.evidenceRelationships[0].relationship.relationshipType).toBe('supports');
      expect(detail.evidenceRelationships[0].excerpt.id).toBe(excerptId);
      // Verification event
      expect(detail.verificationEvents.length).toBe(1);
      expect(detail.verificationEvents[0].action).toBe('verified');
      expect(detail.verificationEvents[0].reviewerId).toBe(adminUser.id);
      // Canonical academic rule
      expect(detail.canonicalRecords.academicRules.length).toBe(1);
      expect(detail.canonicalRecords.academicRules[0].id).toBe(ruleId);
      expect(detail.canonicalRecords.academicRules[0].claimVersionId).toBe(versionId);
      // claimVersionId provenance
      expect(detail.canonicalRecords.academicRules[0].claimVersionId).toBe(detail.version.id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §5. REAL HTTP ERROR / SECURITY BOUNDARIES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('§5: HTTP error/security boundaries', () => {
    it_e2e('malformed UUID → 400 KNOWLEDGE_VALIDATION_ERROR', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .get('/api/admin/knowledge/claims/not-a-uuid')
        .set('Authorization', `Bearer ${adminUser.token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
    });

    it_e2e('nonexistent valid UUID → 404 KNOWLEDGE_NOT_FOUND', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .get('/api/admin/knowledge/claims/00000000-0000-0000-0000-000000000099')
        .set('Authorization', `Bearer ${adminUser.token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('KNOWLEDGE_NOT_FOUND');
    });

    it_e2e('duplicate claim → 409 KNOWLEDGE_DUPLICATE', async () => {
      const app = await createTestApp();
      const authHeader = `Bearer ${adminUser.token}`;
      const claimKey = `${PREFIX}-dup-test`;

      // First creation succeeds
      const res1 = await request(app)
        .post('/api/admin/knowledge/claims')
        .set('Authorization', authHeader)
        .send({
          claimKey,
          claimType: 'rule',
          subjectType: 'institution',
          subjectId: tesuId,
        });
      expect(res1.status).toBe(201);
      createdClaimIds.push(res1.body.claim.id);

      // Second creation with same claimKey → 409
      const res2 = await request(app)
        .post('/api/admin/knowledge/claims')
        .set('Authorization', authHeader)
        .send({
          claimKey,
          claimType: 'rule',
          subjectType: 'institution',
          subjectId: tesuId,
        });
      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('KNOWLEDGE_DUPLICATE');
    });

    it_e2e('confirmation without supporting evidence → 409 KNOWLEDGE_EVIDENCE_REQUIRED', async () => {
      const app = await createTestApp();
      const authHeader = `Bearer ${adminUser.token}`;

      // Create claim + version but NO evidence
      const claimRes = await request(app)
        .post('/api/admin/knowledge/claims')
        .set('Authorization', authHeader)
        .send({
          claimKey: `${PREFIX}-no-evidence`,
          claimType: 'rule',
          subjectType: 'institution',
          subjectId: tesuId,
        });
      expect(claimRes.status).toBe(201);
      createdClaimIds.push(claimRes.body.claim.id);

      const versionRes = await request(app)
        .post(`/api/admin/knowledge/claims/${claimRes.body.claim.id}/versions`)
        .set('Authorization', authHeader)
        .send({ statement: `${PREFIX} no evidence stmt`, confidence: 50 });
      expect(versionRes.status).toBe(201);
      createdVersionIds.push(versionRes.body.claimVersion.id);

      // Confirm without evidence → 409
      const confirmRes = await request(app)
        .post(`/api/admin/knowledge/claim-versions/${versionRes.body.claimVersion.id}/confirm`)
        .set('Authorization', authHeader)
        .send({});
      expect(confirmRes.status).toBe(409);
      expect(confirmRes.body.error.code).toBe('KNOWLEDGE_EVIDENCE_REQUIRED');
    });

    it_e2e('spoofed actor fields are rejected (strict body)', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post('/api/admin/knowledge/evidence-sources')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          sourceType: 'official_web',
          title: `${PREFIX} spoofed actor`,
          createdBy: 'spoofed-actor-id',
        });
      // .strict() on the Zod schema rejects unknown keys
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
    });

    it_e2e('no Knowledge DELETE workflow exists', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .delete('/api/admin/knowledge/evidence-sources/00000000-0000-0000-0000-000000000099')
        .set('Authorization', `Bearer ${adminUser.token}`);
      // No DELETE route registered → Express returns 404
      expect(res.status).toBe(404);
    });

    it_e2e('error responses do not leak DB/internal errors', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .get('/api/admin/knowledge/claims/00000000-0000-0000-0000-000000000099')
        .set('Authorization', `Bearer ${adminUser.token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('KNOWLEDGE_NOT_FOUND');
      // Must not contain stack traces, SQL, or internal paths
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toMatch(/stack|trace|at\s+\/|node_modules|drizzle|pg\./i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §5b. /env.js SECRET-EXPOSURE CHECK
  // ═══════════════════════════════════════════════════════════════════════════

  describe('§5b: /env.js secret-exposure check', () => {
    it_e2e('controlled rheronevecsffaejteoj URL exposed, publishable key available, secret key NEVER exposed, ypbz NEVER exposed', async () => {
      const app = await createTestApp();
      const res = await request(app).get('/env.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('javascript');

      const body = res.text;
      // Controlled URL is exposed
      expect(body).toContain('rheronevecsffaejteoj');
      // Public/publishable key is available
      expect(body).toContain('sb_publishable_');
      // sb_secret_ key is NEVER exposed
      expect(body).not.toContain('sb_secret_');
      // Obsolete ypbz project is NEVER exposed
      expect(body).not.toContain('ypbzdbfqoflyszdsbivn');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §6. CLEANUP VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('§6: Cleanup verification', () => {
    it_e2e('final fixture counts are clean — institutions=3, no Phase 1D-C fixtures', async () => {
      // Clean up all Knowledge fixtures + users
      await cleanupAllFixtures();

      const postCounts = await snapshotCounts();

      // Knowledge tables must be at 0 (except institutions = 3)
      expect(Number(postCounts.kes)).toBe(0);
      expect(Number(postCounts.kee)).toBe(0);
      expect(Number(postCounts.kc)).toBe(0);
      expect(Number(postCounts.kcv)).toBe(0);
      expect(Number(postCounts.kce)).toBe(0);
      expect(Number(postCounts.kve)).toBe(0);
      expect(Number(postCounts.kcon)).toBe(0);
      expect(Number(postCounts.kar)).toBe(0);
      expect(Number(postCounts.ki)).toBe(3);

      // Operational tables must be unchanged from pre-test
      expect(Number(postCounts.users)).toBe(Number(preTestCounts.users));
      expect(Number(postCounts.students)).toBe(Number(preTestCounts.students));
      expect(Number(postCounts.docs)).toBe(Number(preTestCounts.docs));
      expect(Number(postCounts.tickets)).toBe(Number(preTestCounts.tickets));
      expect(Number(postCounts.comments)).toBe(Number(preTestCounts.comments));
    });
  });
});
