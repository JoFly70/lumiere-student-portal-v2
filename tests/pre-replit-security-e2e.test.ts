/**
 * Pre-Replit Security Sweep — Real Access Tests (opt-in)
 *
 * RUN_PRE_REPLIT_SECURITY_E2E=1 against canonical project only. FAIL-CLOSED
 * preflight. Disposable prsec-<ts> fixtures; afterAll cleanup + zero-leftover
 * verification. Real Auth, real JWTs, real PostgREST/RLS, real RPC EXECUTE.
 */

import { describe, it, expect, beforeAll, afterAll, vitest } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
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

const RUN_TESTS = process.env.RUN_PRE_REPLIT_SECURITY_E2E === '1';
const CANONICAL = 'rheronevecsffaejteoj';
const CANONICAL_URL = `https://${CANONICAL}.supabase.co`;

const it_sec = RUN_TESTS ? it : it.skip;
const describe_sec = RUN_TESTS ? describe : describe.skip;

function preflight(): void {
  const checks = [
    ['DATABASE_URL', (process.env.DATABASE_URL ?? '').includes(CANONICAL)],
    ['SUPABASE_URL', process.env.SUPABASE_URL === CANONICAL_URL],
    ['VITE_SUPABASE_URL', process.env.VITE_SUPABASE_URL === CANONICAL_URL],
    ['SERVICE_KEY', (process.env.SUPABASE_SERVICE_KEY ?? '').startsWith('sb_secret_')],
    ['ANON_KEY', (process.env.SUPABASE_ANON_KEY ?? '').startsWith('sb_publishable_')],
    ['VITE_ANON_KEY', (process.env.VITE_SUPABASE_ANON_KEY ?? '').startsWith('sb_publishable_')],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length > 0) throw new Error(`Preflight FAILED: ${failed.map(([l]) => l).join(', ')} — aborting before mutation`);
}

const PREFIX = `prsec-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const PASSWORD = `S3cure!Pass#${Date.now()}`;

let admin: ReturnType<typeof createClient>;
let anonRest: ReturnType<typeof createClient>;
let studentRest: ReturnType<typeof createClient>;
let student2Rest: ReturnType<typeof createClient>;
let coachRest: ReturnType<typeof createClient>;
let staffRest: ReturnType<typeof createClient>;
let adminRest: ReturnType<typeof createClient>;

let studentId = '';
let student2Id = '';
let staffId = '';
const trackedAuthIds: string[] = [];
const trackedUsersRows: string[] = [];

let cleanupError: string | null = null;
async function cleanup(): Promise<void> {
  const errors: string[] = [];
  try {
    await admin.from('support_tickets').delete().like('subject', `${PREFIX}%`);
    await admin.from('audit_logs').delete().like('target_resource_id', `${PREFIX}%`);
    await admin.from('students').delete().like('student_code', `${PREFIX}%`);
    await admin.from('users').delete().like('email', `${PREFIX}%@prsec.test`);
  } catch (e) { errors.push(`db: ${(e as Error).message}`); }
  for (const uid of trackedAuthIds) {
    try { await admin.auth.admin.deleteUser(uid); } catch (e) { errors.push(`auth ${uid}: ${(e as Error).message}`); }
  }
  cleanupError = errors.length ? errors.join('; ') : null;
}

async function makeUser(role: 'student' | 'student2' | 'coach' | 'staff' | 'admin'): Promise<ReturnType<typeof createClient>> {
  const email = `${PREFIX}-${role}@prsec.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser(${role}): ${error?.message}`);
  trackedAuthIds.push(data.user.id);
  const ins = await admin.from('users').insert({ id: data.user.id, email, name: `${PREFIX} ${role}`, role: role === 'student2' ? 'student' : role }).select('id').single();
  if (ins.error) throw new Error(`users insert(${role}): ${ins.error.message}`);
  trackedUsersRows.push(data.user.id);

  // Isolated anonymous sign-in (never on the shared service client — that
  // would poison its session, and signOut() on it would revoke the token).
  const authClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: login, error: loginErr } = await authClient.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginErr || !login.session) throw new Error(`fixture login(${role}): ${loginErr?.message}`);
  const token = login.session.access_token;
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

describe_sec('Pre-Replit Security Sweep — real access tests', () => {
  if (RUN_TESTS) vitest.setConfig({ testTimeout: 90000, hookTimeout: 120000 });

  beforeAll(async () => {
    if (!RUN_TESTS) return;
    preflight();
    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Idempotency guard: remove any stale prsec- fixture users from an
    // aborted earlier run so re-runs cannot collide on email uniqueness.
    const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const u of existing?.users ?? []) {
      if (u.email?.startsWith('prsec-')) {
        trackedAuthIds.push(u.id);
        await admin.auth.admin.deleteUser(u.id).catch(() => {});
      }
    }
    await admin.from('support_tickets').delete().like('subject', 'prsec-%');
    await admin.from('audit_logs').delete().like('target_resource_id', 'prsec-%');
    await admin.from('students').delete().like('student_code', 'prsec-%');
    await admin.from('users').delete().like('email', 'prsec-%@prsec.test');
    anonRest = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    studentRest = await makeUser('student');
    student2Rest = await makeUser('student2');
    coachRest = await makeUser('coach');
    staffRest = await makeUser('staff');
    adminRest = await makeUser('admin');
    studentId = trackedUsersRows[0];
    student2Id = trackedUsersRows[1];
    staffId = trackedUsersRows[3];

    const mkStudent = async (uid: string, role: string) => {
      const r = await admin.from('students').insert({
        user_id: uid, student_code: `${PREFIX}-${role}`, first_name: role, last_name: 'Fixture', status: 'active',
        dob: '2000-01-01', email: `${PREFIX}-${role}@prsec.test`,
        residency: 'us', phone_primary: '+10000000000', address_country: 'US', address_line1: `${PREFIX} Test Lane`,
      }).select('id').single();
      if (r.error) throw new Error(`students insert(${role}): ${r.error.message}`);
      return r.data.id;
    };
    await mkStudent(studentId, 'student');
    await mkStudent(student2Id, 'student2');
  });

  afterAll(async () => {
    if (!RUN_TESTS) return;
    await cleanup();
    const check = async (t: string, op: () => Promise<number>) => {
      const n = await op();
      expect(n, `${t} leftover`).toBe(0);
    };
    const cnt = (table: string, col: string, val: string) => async () => {
      const r = await admin.from(table).select('*', { count: 'exact', head: true }).like(col, val);
      return r.count ?? -1;
    };
    await check('auth users', async () => {
      const { data } = await admin.auth.admin.listUsers();
      return (data?.users ?? []).filter((u: any) => (u.email ?? '').startsWith(PREFIX)).length;
    });
    await check('users rows', cnt('users', 'email', `${PREFIX}%`));
    await check('students rows', cnt('students', 'student_code', `${PREFIX}%`));
    await check('tickets rows', cnt('support_tickets', 'subject', `${PREFIX}%`));
    await check('audit rows', cnt('audit_logs', 'target_resource_id', `${PREFIX}%`));
    if (cleanupError) throw new Error(`cleanup errors: ${cleanupError}`);
  });

  // ═══ anon: sensitive-table access denied ═══
  describe('anon denied on sensitive tables', () => {
    const tables = ['users', 'students', 'documents', 'support_tickets', 'ticket_comments', 'weekly_metrics', 'student_program_enrollments', 'student_program_assignments', 'student_academic_sources', 'student_credit_records', 'student_credit_verification_events', 'student_credit_decisions', 'student_academic_exceptions'];
    for (const t of tables) {
      it_sec(`anon cannot SELECT ${t}`, async () => {
        const { data, error } = await (anonRest as any).from(t).select('*').limit(1);
        expect(data ?? []).toHaveLength(0);
        expect(error).toBeTruthy();
      });
    }

    it_sec('anon cannot INSERT users or students', async () => {
      const u = await anonRest.from('users').insert({ email: `${PREFIX}-x@prsec.test`, name: 'x', role: 'student' });
      expect(u.error).toBeTruthy();
      const s = await anonRest.from('students').insert({ user_id: '00000000-0000-0000-0000-000000000000', student_code: `${PREFIX}-x`, status: 'active' });
      expect(s.error).toBeTruthy();
    });

    it_sec('anon cannot UPDATE or DELETE users', async () => {
      const up = await anonRest.from('users').update({ name: 'hacked' }).eq('id', studentId);
      expect(up.error).toBeTruthy();
      const del = await anonRest.from('users').delete().eq('id', studentId);
      expect(del.error).toBeTruthy();
    });
  });

  // ═══ anon: hardened functions not executable ═══
  describe('hardened functions denied for anon', () => {
    it_sec('anon cannot execute RLS helper or trigger helper RPCs', async () => {
      for (const rpc of [
        { name: 'is_staff_or_admin', args: {} },
        { name: 'knowledge_is_admin', args: {} },
        { name: 'knowledge_is_staff_or_admin', args: {} },
        { name: 'student_owns_record', args: { p_student_id: 'x' } },
        { name: 'generate_ticket_number', args: {} },
        { name: 'set_ticket_number', args: {} },
        { name: 'knowledge_update_updated_at', args: {} },
      ] as const) {
        const { error } = await (anonRest as any).rpc(rpc.name, rpc.args);
        expect(error, `${rpc.name} should deny anon`).toBeTruthy();
      }
    });
  });

  // ═══ student cross-user isolation ═══
  describe('student cross-user isolation', () => {
    it_sec('student sees own users row, not another student\'s', async () => {
      const own = await studentRest.from('users').select('*').eq('id', studentId);
      expect(own.error).toBeNull();
      expect(own.data?.length).toBe(1);
      const other = await studentRest.from('users').select('*').eq('id', student2Id);
      expect(other.data ?? []).toHaveLength(0);
    });

    it_sec('student sees own students profile, not another student\'s', async () => {
      const own = await studentRest.from('students').select('*').eq('user_id', studentId);
      expect(own.error).toBeNull();
      expect(own.data?.length).toBe(1);
      const other = await studentRest.from('students').select('*').eq('user_id', student2Id);
      expect(other.data ?? []).toHaveLength(0);
    });

    it_sec('student cannot read staff user rows', async () => {
      const r = await studentRest.from('users').select('*').eq('id', staffId);
      expect(r.data ?? []).toHaveLength(0);
    });
  });

  // ═══ Knowledge role matrix ═══
  describe('Knowledge role matrix preserved', () => {
    it_sec('anon cannot retrieve knowledge rows', async () => {
      const r = await anonRest.from('knowledge_institutions').select('*').limit(1);
      expect(r.data ?? []).toHaveLength(0);
      expect(r.error).toBeTruthy();
    });

    it_sec('student cannot retrieve knowledge rows', async () => {
      const r = await studentRest.from('knowledge_institutions').select('*').limit(1);
      expect(r.data ?? []).toHaveLength(0);
    });

    it_sec('coach cannot retrieve knowledge rows', async () => {
      const r = await coachRest.from('knowledge_institutions').select('*').limit(1);
      expect(r.data ?? []).toHaveLength(0);
    });

    it_sec('staff can read knowledge rows (Phase 1 rule)', async () => {
      const r = await staffRest.from('knowledge_institutions').select('*').limit(5);
      expect(r.error).toBeNull();
      expect((r.data ?? []).length).toBeGreaterThanOrEqual(1);
    });

    it_sec('admin can read and mutate knowledge rows (Phase 1 rule)', async () => {
      const read = await adminRest.from('knowledge_institutions').select('slug').limit(1);
      expect(read.error).toBeNull();
      expect((read.data ?? []).length).toBe(1);
      const slug = read.data![0].slug;
      const upd = await adminRest.from('knowledge_institutions').update({ name: `${PREFIX} probe` }).eq('slug', slug).select('slug');
      expect(upd.error).toBeNull();
      expect(upd.data ?? []).toHaveLength(1); // admin RLS-visible row actually updated
      // restore original name via service role
      const orig = await admin.from('knowledge_institutions').select('name').eq('slug', slug).single();
      await admin.from('knowledge_institutions').update({ name: orig.data?.name ?? null }).eq('slug', slug);
      // PostgREST UPDATE under RLS: rows hidden by USING are silently skipped
      // (0 rows), not an error. Prove denial by zero-row update + unchanged data.
      const denied = await studentRest.from('knowledge_institutions').update({ name: 'nope' }).eq('slug', slug);
      expect(denied.error).toBeNull();
      expect(denied.data ?? []).toHaveLength(0);
      const after = await admin.from('knowledge_institutions').select('name').eq('slug', slug).single();
      expect(after.data?.name).toBe(orig.data?.name);
    });
  });

  // ═══ Ticket ownership ═══
  describe('support ticket ownership isolation', () => {
    it_sec('anon cannot create or view tickets', async () => {
      const ins = await anonRest.from('support_tickets').insert({ subject: `${PREFIX}-anon`, description: 'x', reporter_id: studentId, reporter_name: 'x', reporter_email: 'x@prsec.test' });
      expect(ins.error).toBeTruthy();
      const sel = await anonRest.from('support_tickets').select('*').limit(1);
      expect(sel.data ?? []).toHaveLength(0);
      expect(sel.error).toBeTruthy();
    });

    it_sec('student cannot read another student\'s ticket; staff can', async () => {
      const mk = await admin.from('support_tickets').insert({
        subject: `${PREFIX}-t1`, description: 'isolation probe',
        reporter_id: student2Id, reporter_name: `${PREFIX} student2`, reporter_email: `${PREFIX}-student2@prsec.test`,
        status: 'open', priority: 'low',
      }).select('id, ticket_number').single();
      expect(mk.error).toBeNull();
      // set_ticket_number trigger generated a compliant ticket number
      expect(mk.data?.ticket_number ?? '').toMatch(/^LUM-[0-9]{5,}$/);

      const other = await studentRest.from('support_tickets').select('*').eq('id', mk.data!.id);
      expect(other.data ?? []).toHaveLength(0);

      const own = await student2Rest.from('support_tickets').select('*').eq('id', mk.data!.id);
      expect(own.error).toBeNull();
      expect(own.data?.length).toBe(1);

      const staffView = await staffRest.from('support_tickets').select('*').eq('id', mk.data!.id);
      expect(staffView.error).toBeNull();
      expect(staffView.data?.length).toBe(1);
    });
  });

  // ═══ Legacy reference data intentional ═══
  describe('legacy reference tables remain intentionally readable', () => {
    it_sec('anon can view active courses/degree_programs/program_courses', async () => {
      const c = await anonRest.from('courses').select('id').limit(3);
      expect(c.error).toBeNull();
      const d = await anonRest.from('degree_programs').select('id').limit(3);
      expect(d.error).toBeNull();
      const p = await anonRest.from('program_courses').select('*').limit(3);
      expect(p.error).toBeNull();
    });
  });

  // ═══ Service role still authoritative ═══
  describe('service-role backend operations still work', () => {
    it_sec('service role reads sensitive tables and writes audit rows', async () => {
      const u = await admin.from('users').select('id').limit(1);
      expect(u.error).toBeNull();
      const a = await admin.from('audit_logs').insert({
        event_type: 'admin.bulk_operation',
        severity: 'info',
        target_resource_type: 'prsec_probe',
        target_resource_id: `${PREFIX}-svc`,
        action_description: `${PREFIX} service probe`,
        metadata: {},
      }).select('id').single();
      expect(a.error).toBeNull();
      expect(a.data?.id).toBeTruthy();
      await admin.from('audit_logs').delete().eq('id', a.data!.id);
    });
  });
});
