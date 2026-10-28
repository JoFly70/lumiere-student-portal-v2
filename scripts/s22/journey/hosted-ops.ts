/**
 * Hosted implementations of the privileged Ops (Supabase service role + staging database) and of Sessions (the
 * app's own /api/auth/login, /api/csrf-token and /api/auth/logout). Used only after makeHostedTarget() succeeded.
 *
 * Every function here is a labelled shortcut: the journey steps record which of them they used.
 */
import postgres from 'postgres';
import { assertStagingTarget, redact } from '../lib/staging-guard';
import { Http } from './http';
import type { HostedTarget, Identity, Ops, Session, Sessions } from './types';

export function createHostedOps(target: HostedTarget, env: Record<string, string | undefined> = process.env): Ops & { rawSql(): postgres.Sql } {
  // Re-validates DATABASE_URL (must be the staging project's) in addition to the target check.
  assertStagingTarget({ env, requireDatabase: true, requireSupabaseUrl: true, requireAppUrl: true });
  const serviceKey = env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_KEY is required for the hosted journey (admin user creation, verification link, Storage checks)');
  const sb = target.supabaseUrl;
  let sqlClient: postgres.Sql | null = null;
  const db = (): postgres.Sql => {
    if (!sqlClient) sqlClient = postgres(env.DATABASE_URL!, { ssl: 'require', max: 1, prepare: false, idle_timeout: 20, onnotice: () => {} });
    return sqlClient;
  };
  const admin = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${sb}${path}`, {
      method,
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, ok: res.ok, json, text: redact(text.slice(0, 300)) };
  };

  return {
    describe: 'service-role (Supabase admin API + Storage) and DATABASE_URL (staging project)',
    rawSql: db,
    async sql(query, params = []) {
      return (await db().unsafe(query, params as never[])) as unknown as any[];
    },
    async sqlTx(statements) {
      await db().begin(async (tx) => { for (const s of statements) await tx.unsafe(s); });
    },
    async createAuthUser({ email, password, fullName, role, confirmed }) {
      const r = await admin('POST', '/auth/v1/admin/users', { email, password, email_confirm: confirmed, user_metadata: { full_name: fullName } });
      if (!r.ok || !r.json?.id) throw new Error(`admin createUser failed (${r.status}): ${r.text}`);
      const id = String(r.json.id);
      const q = db();
      await q.unsafe('insert into users (id, email, name, role) values ($1, $2, $3, $4::role) on conflict (id) do nothing', [id, email, fullName, role]);
      await q.unsafe("insert into profiles (user_id, status) values ($1, 'active') on conflict (user_id) do nothing", [id]);
      return { id };
    },
    async generateVerificationToken(email) {
      const r = await admin('POST', '/auth/v1/admin/generate_link', { type: 'magiclink', email });
      const hashed = r.json?.hashed_token ?? r.json?.properties?.hashed_token;
      return r.ok && typeof hashed === 'string' ? { tokenHash: hashed } : null;
    },
    async isEmailConfirmed(userId) {
      const r = await admin('GET', `/auth/v1/admin/users/${userId}`);
      if (!r.ok) throw new Error(`admin getUser failed (${r.status}): ${r.text}`);
      return Boolean(r.json?.email_confirmed_at || r.json?.confirmed_at);
    },
    async setAccountStatus(userId, status) {
      await db().unsafe('update profiles set status = $2::status where user_id = $1', [userId, status]);
    },
    async storageObjectExists(storagePath) {
      const slash = storagePath.lastIndexOf('/');
      const r = await admin('POST', '/storage/v1/object/list/student-documents', { prefix: storagePath.slice(0, slash), search: storagePath.slice(slash + 1), limit: 100 });
      if (!r.ok || !Array.isArray(r.json)) return null;
      return r.json.some((o: any) => o?.name === storagePath.slice(slash + 1));
    },
    async removeStorageObjects(paths) {
      for (let i = 0; i < paths.length; i += 50) {
        const r = await admin('DELETE', '/storage/v1/object/student-documents', { prefixes: paths.slice(i, i + 50) });
        if (!r.ok) throw new Error(`storage remove failed (${r.status}): ${r.text}`);
      }
    },
    async deleteAuthUser(userId) {
      const r = await admin('DELETE', `/auth/v1/admin/users/${userId}`);
      if (!r.ok && r.status !== 404) throw new Error(`admin deleteUser failed (${r.status}): ${r.text}`);
    },
    async close() { if (sqlClient) await sqlClient.end({ timeout: 5 }); sqlClient = null; },
  };
}

/** Sessions through the deployed app's own endpoints. */
export function createAppSessions(http: Http): Sessions {
  return {
    async tryLogin(identity: Identity) {
      const res = await http.app('POST', '/api/auth/login', { json: { email: identity.email, password: identity.password } });
      if (res.status !== 200 || !res.json?.session?.access_token) return { status: res.status, body: res.json };
      const bearer = String(res.json.session.access_token);
      const csrf = await http.app('GET', '/api/csrf-token', { headers: { authorization: `Bearer ${bearer}` } });
      if (csrf.status !== 200 || !csrf.json?.csrfToken) return { status: csrf.status === 200 ? 500 : csrf.status, body: csrf.json };
      const session: Session = { key: identity.key, userId: String(res.json.user?.id), email: identity.email, bearer, csrf: String(csrf.json.csrfToken), issuedAt: Date.now() };
      return { status: 200, body: res.json, session };
    },
    async logout(session) {
      const res = await http.app('POST', '/api/auth/logout', { session });
      return { status: res.status, body: res.json };
    },
  };
}
