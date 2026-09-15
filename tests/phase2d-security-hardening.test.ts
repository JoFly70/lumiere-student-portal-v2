/**
 * Phase 2D Security Hardening — Real Privilege + Session Isolation Tests
 *
 * REAL STACK, NO MOCKS (except per-role REST clients, which are the system
 * under test): Supabase Auth, real HTTP /api/auth/login, real PostgREST
 * authorization, real RLS, real SECURITY DEFINER privileges.
 *
 * OPT-IN + FAIL-CLOSED: runs only with RUN_P2D_SECURITY_E2E=1 against the
 * canonical project. Disposable p2dsec-<timestamp> fixtures, cleaned in
 * afterAll even on failure, with zero-leftover verification.
 *
 * Proves:
 *  - user login session != shared service-role session (behavioral)
 *  - anon: no audit SELECT/INSERT, no privileged RPC EXECUTE
 *  - authenticated student: no audit writes, no privileged RPC EXECUTE,
 *    SELECT only own rows (actor or target), not other users' rows
 *  - authenticated admin: SELECT all rows via RLS, no direct INSERT
 *  - service_role: INSERT works, createAuditLog() works, retention
 *    trigger populates retention_until
 */

import { describe, it, expect, beforeAll, afterAll, vitest } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

try {
  const envContent = readFileSync('.env', 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i > 0 && !process.env[trimmed.slice(0, i)]) process.env[trimmed.slice(0, i)] = trimmed.slice(i + 1);
  }
} catch {}

const { db } = await import('../server/lib/db');
import { sql } from 'drizzle-orm';

const RUN_TESTS = process.env.RUN_P2D_SECURITY_E2E === '1';
const CANONICAL = 'rheronevecsffaejteoj';
const CANONICAL_URL = `https://${CANONICAL}.supabase.co`;

const it_sec = RUN_TESTS ? it : it.skip;
const describe_sec = RUN_TESTS ? describe : describe.skip;

const PREFIX = `p2dsec-${Date.now()}`;
const PASSWORD = `S3cure!Pass#${Date.now()}`;

function preflight(): void {
  const checks = [
    ['DATABASE_URL', (process.env.DATABASE_URL ?? '').includes(CANONICAL)],
    ['SUPABASE_URL', process.env.SUPABASE_URL === CANONICAL_URL],
    ['VITE_SUPABASE_URL', process.env.VITE_SUPABASE_URL === CANONICAL_URL],
    ['SERVICE_KEY', (process.env.SUPABASE_SERVICE_KEY ?? '').startsWith('sb_secret_')],
    ['ANON_KEY', (process.env.SUPABASE_ANON_KEY ?? '').startsWith('sb_publishable_')],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length > 0) throw new Error(`Preflight FAILED: ${failed.map(([l]) => l).join(', ')} — aborting before mutation`);
}

let admin: ReturnType<typeof createClient>;
let app: Express;

// Fixture tracking
const trackedUserIds: string[] = [];

// Role clients (real REST identity under test)
let anonRest: ReturnType<typeof createClient>;
let studentRest: ReturnType<typeof createClient>;
let adminRest: ReturnType<typeof createClient>;

let studentUserId = '';
let adminUserId = '';      // public.users.id used as audit actor
let studentAuthId = '';
let adminAuthId = '';      // auth user ids
let studentRowId = '';
let adminRowId = '';
let serviceRowId = '';

async function createRealUser(role: 'student' | 'admin'): Promise<{ authId: string; usersId: string }> {
  const email = `${PREFIX}-${role}@test.lumiere.app`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser(${role}) failed: ${error?.message}`);
  trackedUserIds.push(data.user.id);
  // users.id equals the auth uid, exactly as production rows are created.
  await db.execute(sql`INSERT INTO users (id, email, name, role) VALUES (${data.user.id}, ${email}, ${PREFIX + ' ' + role}, ${role})`);
  return { authId: data.user.id, usersId: data.user.id };
}

async function loginThroughApp(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200 || !res.body.session?.access_token) throw new Error(`real login failed for ${email}: ${res.status}`);
  return res.body.session.access_token;
}

let cleanupError: string | null = null;

async function cleanup(): Promise<void> {
  const errors: string[] = [];
  try {
    // Audit rows first (FK to users), scoped to tracked actors/subjects.
    const ids = [studentUserId, adminUserId, studentRowId, adminRowId, serviceRowId].filter(Boolean);
    if (ids.length > 0) {
      const idList = sql.join(ids.map(i => sql`${i}`), sql`, `);
      await db.execute(sql`DELETE FROM audit_logs WHERE actor_user_id IN (${idList}) OR target_user_id IN (${idList}) OR target_resource_id LIKE ${PREFIX + '%'}`);
    }
    await db.execute(sql`DELETE FROM audit_logs WHERE actor_user_id LIKE ${PREFIX + '%'} OR target_user_id LIKE ${PREFIX + '%'}`);
    await db.execute(sql`DELETE FROM students WHERE student_code LIKE ${PREFIX + '%'} OR user_id IN (SELECT id FROM users WHERE email LIKE ${PREFIX + '%@test.lumiere.app'})`);
    await db.execute(sql`DELETE FROM users WHERE email LIKE ${PREFIX + '%@test.lumiere.app'}`);
  } catch (e) { errors.push(`db cleanup: ${(e as Error).message}`); }

  for (const uid of trackedUserIds) {
    try { await admin.auth.admin.deleteUser(uid); } catch (e) { errors.push(`auth ${uid}: ${(e as Error).message}`); }
  }
  cleanupError = errors.length ? errors.join('; ') : null;
}

describe_sec('Phase 2D Security Hardening — real privilege + session isolation', () => {
  if (RUN_TESTS) vitest.setConfig({ testTimeout: 90000, hookTimeout: 120000 });

  beforeAll(async () => {
    if (!RUN_TESTS) return;
    preflight();

    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anonRest = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });

    const { registerRoutes } = await import('../server/routes');
    app = express();
    app.use(express.json());
    await registerRoutes(app);

    // Real users + rows we can point audits at. users.id equals the auth uid
    // (as in production) so the audit RLS policy (auth.uid()::text) matches.
    const student = await createRealUser('student');
    const adminUsr = await createRealUser('admin');
    studentUserId = student.usersId;
    adminUserId = adminUsr.usersId;
    studentAuthId = student.authId;
    adminAuthId = adminUsr.authId;

    // Role REST clients with REAL user JWTs
    const studentToken = await loginThroughApp(`${PREFIX}-student@test.lumiere.app`);
    const adminToken = await loginThroughApp(`${PREFIX}-admin@test.lumiere.app`);
    studentRest = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${studentToken}` } },
    });
    adminRest = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${adminToken}` } },
    });

    // Seed one audit row per identity for SELECT scoping tests
    const mk = async (actorId: string) => {
      const { data, error } = await admin.from('audit_logs').insert({
        event_type: 'admin.bulk_operation',
        severity: 'info',
        actor_user_id: actorId,
        actor_role: 'staff',
        target_resource_type: 'security_test',
        target_resource_id: `${PREFIX}-seed-${actorId.slice(0, 8)}`,
        action_description: `${PREFIX} seed row`,
        metadata: {},
        is_educational_record: false,
        is_financial_record: false,
      }).select('id').single();
      if (error) throw new Error(`seed audit row failed: ${error.message}`);
      return data.id;
    };
    studentRowId = await mk(studentUserId);
    adminRowId = await mk(adminUserId);
    // Service row uses NULL actor (pure service action)
    {
      const { data, error } = await admin.from('audit_logs').insert({
        event_type: 'admin.bulk_operation',
        severity: 'info',
        target_resource_type: 'security_test',
        target_resource_id: `${PREFIX}-seed-service`,
        action_description: `${PREFIX} service seed row`,
        metadata: {},
      }).select('id').single();
      if (error) throw new Error(`service seed failed: ${error.message}`);
      serviceRowId = data.id;
    }
  });

  afterAll(async () => {
    if (!RUN_TESTS) return;
    await cleanup();

    // Zero-leftover verification
    const u = (await db.execute(sql`SELECT count(*)::int AS c FROM users WHERE email LIKE ${PREFIX + '%@test.lumiere.app'}`)) as any[];
    expect(Number(u[0].c)).toBe(0);
    const a = (await db.execute(sql`SELECT count(*)::int AS c FROM audit_logs WHERE target_resource_type = 'security_test' AND target_resource_id LIKE ${PREFIX + '%'} OR actor_user_id LIKE ${PREFIX + '%'} OR target_user_id LIKE ${PREFIX + '%'}`)) as any[];
    expect(Number(a[0].c)).toBe(0);
    const { data: authUsers } = await admin.auth.admin.listUsers();
    const leftover = (authUsers?.users ?? []).filter((x: any) => (x.email ?? '').startsWith(PREFIX));
    expect(leftover.length).toBe(0);
    if (cleanupError) throw new Error(`cleanup errors: ${cleanupError}`);
  });

  // ══════════════════════════════════════════════════════════════════
  // Shared client session isolation (behavioral)
  // ══════════════════════════════════════════════════════════════════

  describe('shared service client never acquires a user session', () => {
    it_sec('service-role REST insert after real logins still writes with service authority', async () => {
      // The app has already served two real /api/auth/logins in beforeAll.
      // If the shared client were poisoned, this insert would run as
      // 'authenticated' (no INSERT grant) and fail.
      const { data, error } = await admin.from('audit_logs').insert({
        event_type: 'admin.bulk_operation',
        severity: 'info',
        actor_user_id: adminUserId,
        target_resource_type: 'security_test',
        target_resource_id: `${PREFIX}-post-login-service-insert`,
        action_description: `${PREFIX} service insert after logins`,
        metadata: {},
        is_educational_record: true,
      }).select('id, retention_until').single();
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      expect(data?.retention_until).toBeTruthy(); // retention trigger ran
      serviceRowId = serviceRowId || '';
      // track for cleanup
      await db.execute(sql`DELETE FROM audit_logs WHERE id = ${data!.id}`);
    });

    it_sec('two different users can log in back-to-back without cross-request session bleed', async () => {
      const t1 = await loginThroughApp(`${PREFIX}-student@test.lumiere.app`);
      const t2 = await loginThroughApp(`${PREFIX}-admin@test.lumiere.app`);
      expect(t1).not.toBe(t2);

      // Immediately after logins, the SERVICE client must still operate as
      // service_role (insert succeeds) — proving no user session persisted
      // onto the shared service client.
      const { error } = await admin.from('audit_logs').insert({
        event_type: 'admin.bulk_operation',
        severity: 'info',
        target_resource_type: 'security_test',
        target_resource_id: `${PREFIX}-cross-login-check`,
        action_description: `${PREFIX} post second login service insert`,
        metadata: {},
      });
      expect(error).toBeNull();
      await db.execute(sql`DELETE FROM audit_logs WHERE target_resource_id = ${PREFIX + '-cross-login-check'}`);
    });

    it_sec('isolated user-auth clients do not leak tokens into the service client', async () => {
      // The app's login route now uses createUserAuthClient(); the shared
      // admin client must still hold NO session after those logins. Prove
      // via getSession() on the module singleton used by the app.
      const { supabaseAdmin } = await import('../server/lib/supabase');
      const { data } = await supabaseAdmin.auth.getSession();
      expect(data.session).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ANON: no audit access at all
  // ══════════════════════════════════════════════════════════════════

  describe('anon is fully denied', () => {
    it_sec('anon cannot SELECT audit_logs', async () => {
      const { data, error } = await anonRest.from('audit_logs').select('*').limit(1);
      // RLS: no anon policy → zero rows; grant revoked → error. Either way
      // no data may be returned.
      expect(data ?? []).toHaveLength(0);
      expect(error).toBeTruthy(); // permission denied for table
    });

    it_sec('anon cannot INSERT audit_logs', async () => {
      const { error } = await anonRest.from('audit_logs').insert({
        event_type: 'admin.bulk_operation',
        action_description: 'anon insert attempt',
        metadata: {},
      });
      expect(error).toBeTruthy();
    });

    it_sec('anon cannot execute create_audit_log()', async () => {
      const { error } = await anonRest.rpc('create_audit_log', {
        p_event_type: 'admin.bulk_operation',
        p_action_description: 'anon rpc attempt',
      });
      expect(error).toBeTruthy();
    });

    it_sec('anon cannot execute purge_expired_audit_logs()', async () => {
      const { error } = await anonRest.rpc('purge_expired_audit_logs');
      expect(error).toBeTruthy();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // AUTHENTICATED STUDENT: read own rows only, no writes, no RPCs
  // ══════════════════════════════════════════════════════════════════

  describe('authenticated student is scoped and denied writes', () => {
    it_sec('student cannot INSERT audit_logs', async () => {
      const { error } = await studentRest.from('audit_logs').insert({
        event_type: 'admin.bulk_operation',
        action_description: 'student insert attempt',
        metadata: {},
      });
      expect(error).toBeTruthy();
    });

    it_sec('student cannot UPDATE or DELETE audit rows', async () => {
      const { error: upErr } = await studentRest.from('audit_logs')
        .update({ action_description: 'tampered' })
        .eq('id', studentRowId);
      expect(upErr).toBeTruthy();

      const { error: delErr } = await studentRest.from('audit_logs')
        .delete()
        .eq('id', studentRowId);
      expect(delErr).toBeTruthy();
    });

    it_sec('student cannot execute create_audit_log() or purge_expired_audit_logs()', async () => {
      const { error: rpcErr } = await studentRest.rpc('create_audit_log', {
        p_event_type: 'admin.bulk_operation',
        p_action_description: 'student rpc attempt',
      });
      expect(rpcErr).toBeTruthy();

      const { error: purgeErr } = await studentRest.rpc('purge_expired_audit_logs');
      expect(purgeErr).toBeTruthy();
    });

    it_sec('student SELECTs only rows where they are actor or target', async () => {
      const { data, error } = await studentRest.from('audit_logs').select('*');
      expect(error).toBeNull();
      const rows = data ?? [];
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const row of rows) {
        expect([studentUserId, null]).toContain(row.actor_user_id);
        expect(row.actor_user_id === studentUserId || row.target_user_id === studentUserId).toBe(true);
      }
      // Must include their own seeded row
      expect(rows.some(r => r.id === studentRowId)).toBe(true);
    });

    it_sec('student cannot SELECT an unrelated user\'s audit rows', async () => {
      const { data } = await studentRest.from('audit_logs').select('*').eq('id', adminRowId);
      expect(data ?? []).toHaveLength(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // AUTHENTICATED ADMIN: RLS SELECT all, no direct writes
  // ══════════════════════════════════════════════════════════════════

  describe('authenticated admin reads through RLS, cannot write', () => {
    it_sec('admin can SELECT audit rows via RLS (including own and others)', async () => {
      const { data, error } = await adminRest.from('audit_logs').select('*');
      expect(error).toBeNull();
      const rows = data ?? [];
      expect(rows.some(r => r.id === adminRowId)).toBe(true);
      expect(rows.some(r => r.id === studentRowId)).toBe(true);
    });

    it_sec('admin cannot INSERT audit_logs with a normal user JWT', async () => {
      const { error } = await adminRest.from('audit_logs').insert({
        event_type: 'admin.bulk_operation',
        action_description: 'admin direct insert attempt',
        metadata: {},
      });
      expect(error).toBeTruthy();
    });

    it_sec('admin cannot UPDATE or DELETE audit rows', async () => {
      const { error: upErr } = await adminRest.from('audit_logs')
        .update({ action_description: 'tampered' }).eq('id', adminRowId);
      expect(upErr).toBeTruthy();

      const { error: delErr } = await adminRest.from('audit_logs')
        .delete().eq('id', adminRowId);
      expect(delErr).toBeTruthy();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // SERVICE ROLE: full authority
  // ══════════════════════════════════════════════════════════════════

  describe('service role retains full authority', () => {
    it_sec('service-role INSERT works and retention trigger populates', async () => {
      const { data, error } = await admin.from('audit_logs').insert({
        event_type: 'admin.bulk_operation',
        severity: 'info',
        actor_user_id: adminUserId,
        target_resource_type: 'security_test',
        target_resource_id: `${PREFIX}-svc-final`,
        action_description: `${PREFIX} service authority proof`,
        metadata: { probe: true },
        is_financial_record: true,
      }).select('id, retention_until, is_financial_record').single();
      expect(error).toBeNull();
      expect(data?.retention_until).toBeTruthy();
      // financial record → 7 year retention
      const yrs = (new Date(data!.retention_until).getTime() - Date.now()) / (365.25 * 24 * 3600 * 1000);
      expect(yrs).toBeGreaterThan(6.5);
      expect(yrs).toBeLessThan(7.5);
      await db.execute(sql`DELETE FROM audit_logs WHERE id = ${data!.id}`);
    });

    it_sec('createAuditLog() RPC continues to work for service role', async () => {
      const { data, error } = await admin.rpc('create_audit_log', {
        p_event_type: 'admin.bulk_operation',
        p_action_description: `${PREFIX} rpc service path`,
        p_target_resource_type: 'security_test',
        p_target_resource_id: `${PREFIX}-rpc-svc`,
        p_is_educational_record: true,
      });
      expect(error).toBeNull();
      expect(data).toBeTruthy();
      const rows = (await db.execute(sql`SELECT retention_until FROM audit_logs WHERE id = ${data}`)) as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].retention_until).toBeTruthy();
      await db.execute(sql`DELETE FROM audit_logs WHERE id = ${data}`);
    });
  });
});
