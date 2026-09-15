/**
 * Phase 2D — Real Auth + HTTP + RBAC + Service + PostgreSQL E2E
 *
 * Proves the complete Student Academic Record stack against the canonical
 * development Supabase/PostgreSQL project (rheronevecsffaejteoj):
 * Supabase Auth → /api/auth/login → registerRoutes → requireAuth → requireRole
 * → Student Academic router → service → repository → Drizzle → PostgreSQL.
 * The real audit sink (audit_logs) is exercised; no mocks for any of the above.
 *
 * Fixture/cleanup pattern follows tests/phase2b-student-academic-service-db.test.ts.
 * Real-auth pattern follows tests/phase1dc-http-e2e.test.ts.
 *
 * OPT-IN + FAIL-CLOSED: runs only with RUN_PHASE2D_E2E=1 and only when all env
 * preflight checks pass for the canonical project. Never prints secret values.
 * Creates only disposable p2d-<timestamp> prefixed fixtures, cleaned in
 * dependency order in afterAll (even on failure), then verifies zero leftovers.
 */

import { describe, it, expect, afterAll, beforeAll, vitest } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Load .env before any server module imports that capture env vars at load time.
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
import { sql } from 'drizzle-orm';

const RUN_TESTS = process.env.RUN_PHASE2D_E2E === '1';
const DB_URL = process.env.DATABASE_URL ?? '';
const CANONICAL = 'rheronevecsffaejteoj';
const CANONICAL_URL = `https://${CANONICAL}.supabase.co`;
const IS_TARGET = DB_URL.includes(CANONICAL);

const it_e2e = RUN_TESTS ? it : it.skip;
const describe_e2e = RUN_TESTS ? describe : describe.skip;

const PREFIX = `p2d-${Date.now()}`;
const TESU_SLUG = 'tesu';
const TEST_PASSWORD = `T3st!Pass#${Date.now()}`;
const FAKE_ACTOR = 'attacker';

// ── Preflight (fail-closed, before ANY mutation) ──────────────────────────────

function runPreflightChecks(): { label: string; pass: boolean }[] {
  return [
    { label: 'DATABASE_URL contains canonical project', pass: DB_URL.includes(CANONICAL) },
    { label: 'SUPABASE_URL is canonical', pass: process.env.SUPABASE_URL === CANONICAL_URL },
    { label: 'VITE_SUPABASE_URL is canonical', pass: process.env.VITE_SUPABASE_URL === CANONICAL_URL },
    { label: 'SUPABASE_SERVICE_KEY shape', pass: (process.env.SUPABASE_SERVICE_KEY ?? '').startsWith('sb_secret_') },
    { label: 'SUPABASE_ANON_KEY shape', pass: (process.env.SUPABASE_ANON_KEY ?? '').startsWith('sb_publishable_') },
    { label: 'VITE_SUPABASE_ANON_KEY shape', pass: (process.env.VITE_SUPABASE_ANON_KEY ?? '').startsWith('sb_publishable_') },
  ];
}

// ── Supabase admin client for Auth user lifecycle (lazy init) ─────────────────

let _supabaseAdmin: ReturnType<typeof createClient> | null = null;
function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_KEY || '', {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _supabaseAdmin;
}

// ── Test app factory: REAL registerRoutes, no mocks ──────────────────────────

let cachedApp: Express | null = null;
async function createTestApp(): Promise<Express> {
  if (cachedApp) return cachedApp;
  const app = express();
  app.use(express.json());
  const { registerRoutes } = await import('../server/routes');
  await registerRoutes(app);
  cachedApp = app;
  return app;
}

// ── Real users via Supabase Auth + public.users + real login ─────────────────

interface TestUser {
  id: string;      // users.id / auth.users.id
  email: string;
  role: string;
  token: string;
}

async function createRealUser(role: 'admin' | 'staff' | 'student' | 'coach'): Promise<TestUser> {
  const email = `${PREFIX}-${role}@test.lumiere.app`;

  const { data: authData, error: authError } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (authError || !authData.user) {
    throw new Error(`Failed to create Supabase Auth user for ${role}: ${authError?.message}`);
  }
  const userId = authData.user.id;

  await db.execute(sql`
    INSERT INTO users (id, email, name, role)
    VALUES (${userId}, ${email}, ${PREFIX + ' ' + role}, ${role})
  `);

  // Login through the ACTUAL application endpoint — never bypass it.
  const app = await createTestApp();
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email, password: TEST_PASSWORD });

  if (loginRes.status !== 200 || !loginRes.body.session?.access_token) {
    throw new Error(`Real login failed for ${role}: status=${loginRes.status}`);
  }

  return { id: userId, email, role, token: loginRes.body.session.access_token };
}

// ── Fixture tracking ──────────────────────────────────────────────────────────

let adminUser: TestUser;
let staffUser: TestUser;
let studentUser: TestUser;
let coachUser: TestUser;

let tesuId: string;
let programId: string;
let programVersionId: string;
let studentId: string;          // students.id (text PK, NOT a users.id)
let studentAuthUserId: string;  // students.user_id → users.id

// IDs created through the real HTTP pipeline
let assignmentId = '';
let sourceId = '';
let creditRecordId = '';
let secondCreditRecordId = '';
let exceptionId = '';

// Set in beforeAll from the real database. When false, the real audit sink is
// unavailable and §12 tests fail loudly rather than pretending to pass.
let auditTableExists = false;

// ── Cleanup: dependency order, prefix-scoped, runs even on failure ───────────

let cleanupError: string | null = null;

async function cleanupAllFixtures(): Promise<void> {
  const errors: string[] = [];

  // Collected BEFORE deletion so events/decisions/audits can be verified gone.
  let creditIds: string[] = [];
  let auditActorIds: string[] = [];
  let auditResourceIds: string[] = [];
  try {
    const crRes = await db.execute(sql`
      SELECT cr.id FROM student_credit_records cr
      WHERE cr.student_id IN (SELECT id FROM students WHERE student_code LIKE ${PREFIX + '%'} OR id LIKE ${PREFIX + '%'})
    `);
    creditIds = (crRes as any[]).map(r => r.id);

    const actorRes = await db.execute(sql`SELECT id FROM users WHERE email LIKE ${PREFIX + '%@test.lumiere.app'}`);
    auditActorIds = (actorRes as any[]).map(r => r.id);

    const resRes = await db.execute(sql`
      SELECT id FROM (
        SELECT id FROM student_program_assignments WHERE student_id IN (SELECT id FROM students WHERE student_code LIKE ${PREFIX + '%'} OR id LIKE ${PREFIX + '%'})
        UNION ALL SELECT id FROM student_academic_sources WHERE student_id IN (SELECT id FROM students WHERE student_code LIKE ${PREFIX + '%'} OR id LIKE ${PREFIX + '%'})
        UNION ALL SELECT id FROM student_credit_records WHERE student_id IN (SELECT id FROM students WHERE student_code LIKE ${PREFIX + '%'} OR id LIKE ${PREFIX + '%'})
        UNION ALL SELECT id FROM student_academic_exceptions WHERE student_id IN (SELECT id FROM students WHERE student_code LIKE ${PREFIX + '%'} OR id LIKE ${PREFIX + '%'})
      ) t
    `);
    auditResourceIds = (resRes as any[]).map(r => r.id);
  } catch (e) {
    errors.push(`fixture collection failed: ${(e as Error).message}`);
  }

  // actor_user_id FK references public.users — audit rows MUST go first.
  // Guarded: the canonical project may legitimately lack audit_logs (reported
  // as a Phase 2D blocker); cleanup must not fail for the other fixtures.
  const auditStmts: any[] = [];
  if (auditTableExists) {
    if (auditActorIds.length > 0) {
      auditStmts.push(sql`DELETE FROM audit_logs WHERE actor_user_id IN (${sql.join(auditActorIds.map(i => sql`${i}`), sql`, `)})`);
    }
    if (auditResourceIds.length > 0) {
      auditStmts.push(sql`DELETE FROM audit_logs WHERE target_resource_id IN (${sql.join(auditResourceIds.map(i => sql`${i}`), sql`, `)})`);
    }
  }
  for (const stmt of auditStmts) {
    try { await db.execute(stmt); } catch (e) { errors.push(`audit cleanup: ${(e as Error).message}`); }
  }

  // Academic data, children before parents, scoped by student prefix.
  const studentSub = sql`(SELECT id FROM students WHERE student_code LIKE ${PREFIX + '%'} OR id LIKE ${PREFIX + '%'})`;
  const stmts = [
    sql`DELETE FROM student_academic_exceptions WHERE student_id IN ${studentSub}`,
    sql`DELETE FROM student_credit_decisions WHERE credit_record_id IN (SELECT id FROM student_credit_records WHERE student_id IN ${studentSub})`,
    sql`DELETE FROM student_credit_verification_events WHERE credit_record_id IN (SELECT id FROM student_credit_records WHERE student_id IN ${studentSub})`,
    sql`DELETE FROM student_credit_records WHERE student_id IN ${studentSub}`,
    sql`DELETE FROM student_academic_sources WHERE student_id IN ${studentSub}`,
    sql`DELETE FROM student_program_assignments WHERE student_id IN ${studentSub}`,
    sql`DELETE FROM students WHERE student_code LIKE ${PREFIX + '%'} OR id LIKE ${PREFIX + '%'}`,
    sql`DELETE FROM users WHERE email LIKE ${PREFIX + '%@test.lumiere.app'}`,
    sql`DELETE FROM knowledge_program_versions WHERE version_label LIKE ${PREFIX + '%'}`,
    sql`DELETE FROM knowledge_programs_v2 WHERE code LIKE ${PREFIX + '%'}`,
  ];
  for (const stmt of stmts) {
    try { await db.execute(stmt); } catch (e) { errors.push(`cleanup: ${(e as Error).message}`); }
  }

  // Disposable Supabase Auth users, by tracked public.users prefix.
  try {
    const { data: authList } = await getSupabaseAdmin().auth.admin.listUsers();
    const prefixed = (authList?.users ?? []).filter((u: any) => (u.email ?? '').startsWith(PREFIX));
    for (const u of prefixed) {
      try { await getSupabaseAdmin().auth.admin.deleteUser(u.id); } catch (e) {
        errors.push(`auth user ${u.id}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    errors.push(`auth list: ${(e as Error).message}`);
  }

  cleanupError = errors.length > 0 ? errors.join('; ') : null;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe_e2e('Phase 2D: Real Auth+HTTP+RBAC+Service+PostgreSQL E2E — Student Academic Record', () => {
  if (RUN_TESTS) {
    vitest.setConfig({ testTimeout: 90000, hookTimeout: 120000 });
  }

  beforeAll(async () => {
    if (!RUN_TESTS) return;
    if (!DB_URL) throw new Error('DATABASE_URL not set');
    if (!IS_TARGET) {
      throw new Error(`RUN_PHASE2D_E2E=1 but DATABASE_URL does not point to ${CANONICAL}. Refusing to run.`);
    }

    // Fail-closed preflight — abort BEFORE creating users or fixtures.
    const checks = runPreflightChecks();
    const failed = checks.filter(c => !c.pass);
    if (failed.length > 0) {
      throw new Error(`Phase 2D preflight FAILED: ${failed.map(c => c.label).join(', ')}. Aborting before any mutation.`);
    }

    // Does the real audit sink exist in this project? (Phase 2D gate input.)
    const auditCheck = await db.execute(sql`SELECT count(*)::int as cnt FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs'`);
    auditTableExists = Number((auditCheck as any[])[0].cnt) > 0;

    const instRes = await db.execute(sql`SELECT id FROM knowledge_institutions WHERE slug = ${TESU_SLUG}`);
    tesuId = (instRes as any[])[0].id;

    // REAL users + real login (4 roles — within the 5-per-15min login limit)
    adminUser = await createRealUser('admin');
    staffUser = await createRealUser('staff');
    studentUser = await createRealUser('student');
    coachUser = await createRealUser('coach');

    // Disposable student linked to the real student Auth user
    studentId = `${PREFIX}-student`;
    studentAuthUserId = studentUser.id;
    await db.execute(sql`
      INSERT INTO students (id, user_id, student_code, status, first_name, last_name, dob, residency, email, phone_primary, address_country, address_line1)
      VALUES (${studentId}, ${studentAuthUserId}, ${PREFIX + '-CODE'}, 'lead', 'Test', 'Student', '2000-01-01', 'us', ${PREFIX + '-student@test.lumiere.app'}, '555-0000', 'US', '123 Test St')
    `);

    // Minimum disposable Knowledge fixtures (Phase 2B pattern)
    const progRes = await db.execute(sql`
      INSERT INTO knowledge_programs_v2 (institution_id, code, name)
      VALUES (${tesuId}, ${PREFIX + '-PROG'}, ${PREFIX + ' Test Program'})
      RETURNING id
    `);
    programId = (progRes as any[])[0].id;
    const pvRes = await db.execute(sql`
      INSERT INTO knowledge_program_versions (program_id, version_label, status)
      VALUES (${programId}, ${PREFIX + '-v1'}, 'active')
      RETURNING id
    `);
    programVersionId = (pvRes as any[])[0].id;
  });

  afterAll(async () => {
    if (!RUN_TESTS) return;
    await cleanupAllFixtures();

    // ── Cleanup verification: ZERO Phase 2D leftovers (prefix-scoped) ──
    const verify = async (label: string, query: any) => {
      const r = await db.execute(query);
      const cnt = Number((r as any[])[0].cnt);
      if (cnt !== 0) throw new Error(`Cleanup verification FAILED: ${label} = ${cnt} leftover`);
    };
    const studentSub = sql`(SELECT id FROM students WHERE student_code LIKE ${PREFIX + '%'} OR id LIKE ${PREFIX + '%'})`;
    try {
      if (auditTableExists) {
        await verify('audit_logs (by Phase 2D actors)', sql`SELECT count(*)::int as cnt FROM audit_logs WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE ${PREFIX + '%@test.lumiere.app'})`);
        // After users are deleted, verify by resource ids collected pre-cleanup is
        // impossible — instead verify via our known pipeline resource ids.
        const knownResourceIds = [assignmentId, sourceId, creditRecordId, secondCreditRecordId, exceptionId].filter(Boolean);
        if (knownResourceIds.length > 0) {
          await verify('audit_logs (by Phase 2D resource ids)', sql`SELECT count(*)::int as cnt FROM audit_logs WHERE target_resource_id IN (${sql.join(knownResourceIds.map(i => sql`${i}`), sql`, `)})`);
        }
      }
      await verify('student_academic_exceptions', sql`SELECT count(*)::int as cnt FROM student_academic_exceptions WHERE student_id IN ${studentSub}`);
      await verify('student_credit_decisions', sql`SELECT count(*)::int as cnt FROM student_credit_decisions WHERE credit_record_id IN (SELECT id FROM student_credit_records WHERE student_id IN ${studentSub}) OR decided_by IN (SELECT id FROM users WHERE email LIKE ${PREFIX + '%@test.lumiere.app'})`);
      await verify('student_credit_verification_events', sql`SELECT count(*)::int as cnt FROM student_credit_verification_events WHERE credit_record_id IN (SELECT id FROM student_credit_records WHERE student_id IN ${studentSub}) OR reviewer_id IN (SELECT id FROM users WHERE email LIKE ${PREFIX + '%@test.lumiere.app'})`);
      await verify('student_credit_records', sql`SELECT count(*)::int as cnt FROM student_credit_records WHERE student_id IN ${studentSub}`);
      await verify('student_academic_sources', sql`SELECT count(*)::int as cnt FROM student_academic_sources WHERE student_id IN ${studentSub}`);
      await verify('student_program_assignments', sql`SELECT count(*)::int as cnt FROM student_program_assignments WHERE student_id IN ${studentSub}`);
      await verify('students', sql`SELECT count(*)::int as cnt FROM students WHERE student_code LIKE ${PREFIX + '%'} OR id LIKE ${PREFIX + '%'}`);
      await verify('users', sql`SELECT count(*)::int as cnt FROM users WHERE email LIKE ${PREFIX + '%@test.lumiere.app'}`);
      await verify('knowledge_program_versions', sql`SELECT count(*)::int as cnt FROM knowledge_program_versions WHERE version_label LIKE ${PREFIX + '%'}`);
      await verify('knowledge_programs_v2', sql`SELECT count(*)::int as cnt FROM knowledge_programs_v2 WHERE code LIKE ${PREFIX + '%'}`);

      // Zero prefixed Supabase Auth users remain
      const { data: authList } = await getSupabaseAdmin().auth.admin.listUsers();
      const leftoverAuth = (authList?.users ?? []).filter((u: any) => (u.email ?? '').startsWith(PREFIX));
      if (leftoverAuth.length > 0) throw new Error(`Cleanup verification FAILED: ${leftoverAuth.length} leftover Supabase Auth users`);

      if (cleanupError) throw new Error(`Cleanup had errors: ${cleanupError}`);
    } catch (e) {
      throw new Error(`${(e as Error).message}${cleanupError ? ` | cleanup errors: ${cleanupError}` : ''}`);
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // §6. REAL RBAC MATRIX
  // ═════════════════════════════════════════════════════════════════════════

  describe('§6: Real RBAC matrix', () => {
    it_e2e('internal GET unauthenticated → 401', async () => {
      const app = await createTestApp();
      const res = await request(app).get(`/api/admin/student-academic/students/${studentId}`);
      expect(res.status).toBe(401);
    });

    it_e2e('internal GET student → 403', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .get(`/api/admin/student-academic/students/${studentId}`)
        .set('Authorization', `Bearer ${studentUser.token}`);
      expect(res.status).toBe(403);
    });

    it_e2e('internal GET coach → 403', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .get(`/api/admin/student-academic/students/${studentId}`)
        .set('Authorization', `Bearer ${coachUser.token}`);
      expect(res.status).toBe(403);
    });

    it_e2e('internal GET staff → 200', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .get(`/api/admin/student-academic/students/${studentId}`)
        .set('Authorization', `Bearer ${staffUser.token}`);
      expect(res.status).toBe(200);
    });

    it_e2e('internal GET admin → 200', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .get(`/api/admin/student-academic/students/${studentId}`)
        .set('Authorization', `Bearer ${adminUser.token}`);
      expect(res.status).toBe(200);
    });

    it_e2e('mutation student → 403', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post(`/api/admin/student-academic/students/${studentId}/program-assignments`)
        .set('Authorization', `Bearer ${studentUser.token}`)
        .send({ programVersionId });
      expect(res.status).toBe(403);
    });

    it_e2e('mutation coach → 403', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post(`/api/admin/student-academic/students/${studentId}/program-assignments`)
        .set('Authorization', `Bearer ${coachUser.token}`)
        .send({ programVersionId });
      expect(res.status).toBe(403);
    });

    it_e2e('self GET unauthenticated → 401', async () => {
      const app = await createTestApp();
      const res = await request(app).get('/api/student/academic-record');
      expect(res.status).toBe(401);
    });

    it_e2e('self GET student → 200', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .get('/api/student/academic-record')
        .set('Authorization', `Bearer ${studentUser.token}`);
      expect(res.status).toBe(200);
    });

    it_e2e('self GET coach/staff/admin → 403', async () => {
      const app = await createTestApp();
      for (const u of [coachUser, staffUser, adminUser]) {
        const res = await request(app)
          .get('/api/student/academic-record')
          .set('Authorization', `Bearer ${u.token}`);
        expect(res.status).toBe(403);
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // §7. FULL REAL HTTP ACADEMIC PIPELINE
  // ═════════════════════════════════════════════════════════════════════════

  describe('§7: Full real HTTP pipeline', () => {
    it_e2e('A. program assignment HTTP → DB (staff)', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post(`/api/admin/student-academic/students/${studentId}/program-assignments`)
        .set('Authorization', `Bearer ${staffUser.token}`)
        .send({ programVersionId, cohortLabel: `${PREFIX}-cohort` });
      expect(res.status).toBe(201);
      assignmentId = res.body.assignment.id;

      const rows = (await db.execute(sql`
        SELECT * FROM student_program_assignments WHERE id = ${assignmentId}
      `)) as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe('active');
      expect(rows[0].student_id).toBe(studentId);
      expect(rows[0].program_version_id).toBe(programVersionId);
      expect(rows[0].assigned_by).toBe(staffUser.id);
    });

    it_e2e('B1. academic source HTTP → DB (staff)', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post(`/api/admin/student-academic/students/${studentId}/sources`)
        .set('Authorization', `Bearer ${staffUser.token}`)
        .send({ sourceType: 'transcript', title: `${PREFIX} disposable transcript` });
      expect(res.status).toBe(201);
      sourceId = res.body.source.id;

      const rows = (await db.execute(sql`
        SELECT * FROM student_academic_sources WHERE id = ${sourceId}
      `)) as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].student_id).toBe(studentId);
      expect(rows[0].created_by).toBe(staffUser.id);
      expect(rows[0].status).toBe('received');
    });

    it_e2e('B2. source transition received → extracted (staff)', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post(`/api/admin/student-academic/sources/${sourceId}/transition`)
        .set('Authorization', `Bearer ${staffUser.token}`)
        .send({ newStatus: 'extracted' });
      expect(res.status).toBe(200);

      const rows = (await db.execute(sql`SELECT status FROM student_academic_sources WHERE id = ${sourceId}`)) as any[];
      expect(rows[0].status).toBe('extracted');
    });

    it_e2e('C. credit record HTTP → DB (admin, studentId derived from source)', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post(`/api/admin/student-academic/sources/${sourceId}/credit-records`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          rawCourseCode: 'TEST101',
          rawTitle: 'Phase 2D Test Course',
          rawCredits: '3.00',
        });
      expect(res.status).toBe(201);
      creditRecordId = res.body.creditRecord.id;

      const rows = (await db.execute(sql`
        SELECT * FROM student_credit_records WHERE id = ${creditRecordId}
      `)) as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].student_id).toBe(studentId);
      expect(rows[0].source_id).toBe(sourceId);
      expect(rows[0].created_by).toBe(adminUser.id);
      expect(rows[0].status).toBe('extracted');
      expect(rows[0].raw_credits).toBe('3.00');
    });

    it_e2e('D. verification HTTP → DB (staff)', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post(`/api/admin/student-academic/credit-records/${creditRecordId}/verifications`)
        .set('Authorization', `Bearer ${staffUser.token}`)
        .send({ action: 'verified', rationale: 'Phase 2D verification' });
      expect(res.status).toBe(201);

      const crRows = (await db.execute(sql`SELECT status FROM student_credit_records WHERE id = ${creditRecordId}`)) as any[];
      expect(crRows[0].status).toBe('verified');

      const evRows = (await db.execute(sql`
        SELECT * FROM student_credit_verification_events WHERE credit_record_id = ${creditRecordId}
        ORDER BY seq DESC LIMIT 1
      `)) as any[];
      expect(evRows.length).toBe(1);
      expect(evRows[0].action).toBe('verified');
      expect(evRows[0].reviewer_id).toBe(staffUser.id);
      expect(Number(evRows[0].seq)).toBeGreaterThan(0);
      expect(evRows[0].snapshot).toBeTruthy();
      expect(Object.keys(evRows[0].snapshot ?? {}).length).toBeGreaterThan(0);
    });

    it_e2e('E. credit decision HTTP → DB (admin)', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post(`/api/admin/student-academic/credit-records/${creditRecordId}/decisions`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          programAssignmentId: assignmentId,
          action: 'accepted',
          creditsAwarded: '3.00',
          levelAwarded: '100',
        });
      expect(res.status).toBe(201);

      const rows = (await db.execute(sql`
        SELECT * FROM student_credit_decisions WHERE credit_record_id = ${creditRecordId} ORDER BY seq DESC LIMIT 1
      `)) as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].action).toBe('accepted');
      expect(rows[0].credits_awarded).toBe('3.00');
      expect(rows[0].program_assignment_id).toBe(assignmentId);
      expect(rows[0].decided_by).toBe(adminUser.id);
      expect(Number(rows[0].seq)).toBeGreaterThan(0);
    });

    it_e2e('F. academic exception HTTP → DB (staff)', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post(`/api/admin/student-academic/students/${studentId}/exceptions`)
        .set('Authorization', `Bearer ${staffUser.token}`)
        .send({
          programAssignmentId: assignmentId,
          exceptionType: 'other',
          rationale: 'Phase 2D disposable exception',
        });
      expect(res.status).toBe(201);
      exceptionId = res.body.exception.id;

      const rows = (await db.execute(sql`
        SELECT * FROM student_academic_exceptions WHERE id = ${exceptionId}
      `)) as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].student_id).toBe(studentId);
      expect(rows[0].program_assignment_id).toBe(assignmentId);
      expect(rows[0].status).toBe('active');
      expect(rows[0].approved_by).toBe(staffUser.id);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // §8. REAL INTERNAL READ MODEL
  // ═════════════════════════════════════════════════════════════════════════

  describe('§8: Real internal read model', () => {
    it_e2e('GET internal record coherently reflects the full pipeline', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .get(`/api/admin/student-academic/students/${studentId}`)
        .set('Authorization', `Bearer ${staffUser.token}`);
      expect(res.status).toBe(200);

      const record = res.body;
      expect(record.student.id).toBe(studentId);
      expect(record.student.student_code).toBe(`${PREFIX}-CODE`);
      expect(record.activeProgramAssignment?.id).toBe(assignmentId);
      expect(record.programVersion?.version.id).toBe(programVersionId);
      expect(record.programVersion?.program.id).toBe(programId);
      expect(record.academicSources.map((s: any) => s.id)).toContain(sourceId);
      const cr = record.creditRecords.find((c: any) => c.id === creditRecordId);
      expect(cr).toBeDefined();
      // Read model batches latest verification/decision per credit record
      expect(record.latestVerifications[creditRecordId]?.action).toBe('verified');
      expect(record.latestDecisions[creditRecordId]?.action).toBe('accepted');
      expect(record.latestDecisions[creditRecordId]?.creditsAwarded).toBe('3.00');
      expect(record.activeExceptions.map((e: any) => e.id)).toContain(exceptionId);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // §9. REAL STUDENT SELF-READ (ownership + safe projection)
  // ═════════════════════════════════════════════════════════════════════════

  describe('§9: Real student self-read', () => {
    it_e2e('ownership resolves through req.user.id → students.user_id', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .get('/api/student/academic-record')
        .set('Authorization', `Bearer ${studentUser.token}`);
      expect(res.status).toBe(200);
      expect(res.body.student.id).toBe(studentId);
      expect(res.body.student.studentCode).toBe(`${PREFIX}-CODE`);
    });

    it_e2e('query selection cannot alter ownership (studentId param ignored)', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .get('/api/student/academic-record?studentId=fake-other-student')
        .set('Authorization', `Bearer ${studentUser.token}`);
      expect(res.status).toBe(200);
      expect(res.body.student.id).toBe(studentId);
    });

    it_e2e('student-safe projection contains pipeline data, no internal fields', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .get('/api/student/academic-record')
        .set('Authorization', `Bearer ${studentUser.token}`);
      expect(res.status).toBe(200);

      const body = res.body;
      // Expected student-visible content
      expect(body.program?.programId).toBe(programId);
      expect(body.academicSources.map((s: any) => s.id)).toContain(sourceId);
      const cr = body.creditRecords.find((c: any) => c.id === creditRecordId);
      expect(cr).toBeDefined();
      expect(cr.verification?.action).toBe('verified');
      expect(cr.decision?.action).toBe('accepted');
      expect(cr.decision?.creditsAwarded).toBe('3.00');
      expect(body.activeExceptions.map((e: any) => e.exceptionType)).toContain('other');

      // Internal-only fields must NOT appear anywhere in the serialized response
      const serialized = JSON.stringify(body);
      for (const forbidden of ['reviewerId', 'decidedBy', 'approvedBy', 'createdBy', 'rationale', 'snapshot', 'metadata']) {
        expect(serialized).not.toContain(forbidden);
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // §10. REAL ACTOR-SPOOF REJECTION
  // ═════════════════════════════════════════════════════════════════════════

  describe('§10: Real actor-spoof rejection', () => {
    it_e2e('assignedBy in body → 400, no extra mutation persisted', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post(`/api/admin/student-academic/students/${studentId}/program-assignments`)
        .set('Authorization', `Bearer ${staffUser.token}`)
        .send({ programVersionId, assignedBy: FAKE_ACTOR });
      expect(res.status).toBe(400);

      // Student already has an active assignment from the pipeline; a spoofed
      // mutation must not have added or changed anything.
      const rows = (await db.execute(sql`
        SELECT count(*)::int as cnt FROM student_program_assignments WHERE student_id = ${studentId}
      `)) as any[];
      expect(Number(rows[0].cnt)).toBe(1);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // §11. REAL ERROR MAPPING
  // ═════════════════════════════════════════════════════════════════════════

  describe('§11: Real error mapping', () => {
    it_e2e('malformed UUID → 400', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post(`/api/admin/student-academic/sources/not-a-uuid/transition`)
        .set('Authorization', `Bearer ${staffUser.token}`)
        .send({ newStatus: 'extracted' });
      expect(res.status).toBe(400);
    });

    it_e2e('nonexistent source → 404', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post('/api/admin/student-academic/sources/00000000-0000-0000-0000-000000000099/transition')
        .set('Authorization', `Bearer ${staffUser.token}`)
        .send({ newStatus: 'extracted' });
      expect(res.status).toBe(404);
    });

    it_e2e('nonexistent credit record → 404', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post('/api/admin/student-academic/credit-records/00000000-0000-0000-0000-000000000099/verifications')
        .set('Authorization', `Bearer ${staffUser.token}`)
        .send({ action: 'verified', rationale: 'x' });
      expect(res.status).toBe(404);
    });

    it_e2e('duplicate active program assignment → 409', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post(`/api/admin/student-academic/students/${studentId}/program-assignments`)
        .set('Authorization', `Bearer ${staffUser.token}`)
        .send({ programVersionId });
      expect(res.status).toBe(409);
    });

    it_e2e('invalid state transition (extracted → received) → 409', async () => {
      const app = await createTestApp();
      const res = await request(app)
        .post(`/api/admin/student-academic/sources/${sourceId}/transition`)
        .set('Authorization', `Bearer ${staffUser.token}`)
        .send({ newStatus: 'received' });
      expect(res.status).toBe(409);
    });

    it_e2e('accepted decision before verification → 409 (disposable second credit record)', async () => {
      const app = await createTestApp();
      const createRes = await request(app)
        .post(`/api/admin/student-academic/sources/${sourceId}/credit-records`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ rawCourseCode: 'TEST102', rawTitle: 'Phase 2D Second Course', rawCredits: '1.00' });
      expect(createRes.status).toBe(201);
      secondCreditRecordId = createRes.body.creditRecord.id;

      const res = await request(app)
        .post(`/api/admin/student-academic/credit-records/${secondCreditRecordId}/decisions`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          programAssignmentId: assignmentId,
          action: 'accepted',
          creditsAwarded: '1.00',
        });
      expect(res.status).toBe(409);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // §12. REAL AUDIT PERSISTENCE
  // ═════════════════════════════════════════════════════════════════════════

  describe('§12: Real audit persistence', () => {
    it_e2e('pipeline mutation audit rows actually persisted in audit_logs', async () => {
      if (!auditTableExists) {
        throw new Error('REAL AUDIT SINK UNAVAILABLE: public.audit_logs does not exist in the canonical project — the audit logging schema was never applied. Student Academic mutations currently produce no audit trail (createAuditLog silently drops writes). This is a Phase 2 closure blocker.');
      }
      const rows = (await db.execute(sql`
        SELECT * FROM audit_logs
        WHERE target_resource_id IN (${sql.join([assignmentId, sourceId, creditRecordId, exceptionId].filter(Boolean).map(i => sql`${i}`), sql`, `)})
        ORDER BY created_at ASC
      `)) as any[];

      const byResource = new Map<string, any[]>();
      for (const r of rows) {
        const list = byResource.get(r.target_resource_id) ?? [];
        list.push(r);
        byResource.set(r.target_resource_id, list);
      }

      // Every pipeline mutation produced a persisted audit row
      expect(rows.length).toBeGreaterThanOrEqual(4);
      expect(byResource.get(assignmentId)?.length).toBeGreaterThan(0);
      expect(byResource.get(sourceId)?.length).toBeGreaterThan(0);
      expect(byResource.get(creditRecordId)?.length).toBeGreaterThan(0);
      expect(byResource.get(exceptionId)?.length).toBeGreaterThan(0);
    });

    it_e2e('representative rows: actor/role/educational flag/metadata correct, no FK failure', async () => {
      if (!auditTableExists) {
        throw new Error('REAL AUDIT SINK UNAVAILABLE: public.audit_logs does not exist in the canonical project — the audit logging schema was never applied.');
      }
      const rows = (await db.execute(sql`
        SELECT * FROM audit_logs WHERE target_resource_id = ${assignmentId} ORDER BY created_at ASC
      `)) as any[];
      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        // actor must be one of the real authenticated users (FK held → no silent failure)
        expect([staffUser.id, adminUser.id]).toContain(row.actor_user_id);
        expect(['staff', 'admin']).toContain(row.actor_role);
        expect(row.is_educational_record).toBe(true);
        expect(row.target_resource_type).toBeTruthy();
        expect(row.target_resource_id).toBe(assignmentId);
        // Phase 2C fix: target_user_id must NOT be students.id
        expect(row.target_user_id).not.toBe(studentId);

        // studentId in metadata when route knows it; never contains sensitive content
        const meta = row.metadata ?? {};
        if (Object.keys(meta).length > 0) {
          expect(meta.studentId).toBe(studentId);
        }
        const metaStr = JSON.stringify(meta).toLowerCase();
        for (const forbidden of ['rationale', 'grade', 'snapshot', 'password', 'token', 'secret']) {
          expect(metaStr).not.toContain(forbidden);
        }
      }

      // The assignment audit row was written by staff who performed the mutation
      const assignRow = rows.find(r => r.action_description?.startsWith('assign'));
      expect(assignRow).toBeDefined();
      expect(assignRow.actor_user_id).toBe(staffUser.id);
      expect(assignRow.actor_role).toBe('staff');
    });

    it_e2e('no audit rows written by unauthenticated/unknown actors', async () => {
      if (!auditTableExists) {
        throw new Error('REAL AUDIT SINK UNAVAILABLE: public.audit_logs does not exist in the canonical project — the audit logging schema was never applied.');
      }
      const rows = (await db.execute(sql`
        SELECT actor_user_id FROM audit_logs
        WHERE target_resource_id IN (${sql.join([assignmentId, sourceId, creditRecordId, exceptionId].filter(Boolean).map(i => sql`${i}`), sql`, `)})
      `)) as any[];
      for (const r of rows) {
        expect([staffUser.id, adminUser.id]).toContain(r.actor_user_id);
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // §13. HISTORY / APPEND-ONLY
  // ═════════════════════════════════════════════════════════════════════════

  describe('§13: History / append-only behavior', () => {
    it_e2e('events have sequences, latest selected correctly, no DELETE endpoint', async () => {
      const app = await createTestApp();

      const evRows = (await db.execute(sql`
        SELECT seq, action FROM student_credit_verification_events WHERE credit_record_id = ${creditRecordId} ORDER BY seq
      `)) as any[];
      expect(evRows.length).toBeGreaterThanOrEqual(1);
      expect(Number(evRows[evRows.length - 1].seq)).toBeGreaterThan(0);
      expect(evRows[evRows.length - 1].action).toBe('verified');

      const decRows = (await db.execute(sql`
        SELECT seq, action FROM student_credit_decisions WHERE credit_record_id = ${creditRecordId} ORDER BY seq
      `)) as any[];
      expect(decRows.length).toBeGreaterThanOrEqual(1);
      expect(Number(decRows[decRows.length - 1].seq)).toBeGreaterThan(0);
      expect(decRows[decRows.length - 1].action).toBe('accepted');

      // Read model selects the latest event (the only ones we created)
      const detail = await request(app)
        .get(`/api/admin/student-academic/students/${studentId}`)
        .set('Authorization', `Bearer ${adminUser.token}`);
      expect(detail.body.latestVerifications[creditRecordId]?.action).toBe('verified');
      expect(detail.body.latestDecisions[creditRecordId]?.action).toBe('accepted');

      // No DELETE Student Academic endpoint exists
      const delRes = await request(app)
        .delete(`/api/admin/student-academic/students/${studentId}`)
        .set('Authorization', `Bearer ${adminUser.token}`);
      expect(delRes.status).toBe(404);
    });
  });
});
