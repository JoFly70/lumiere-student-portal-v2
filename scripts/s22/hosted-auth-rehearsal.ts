/**
 * S22 hosted auth rehearsal. OWNER-RUN, STAGING ONLY.
 *
 *   npx tsx scripts/s22/hosted-auth-rehearsal.ts --dry-run     # prints the plan, no network
 *   npx tsx scripts/s22/hosted-auth-rehearsal.ts               # runs against staging
 *
 * Required env (names only; never commit values):
 *   S22_STAGING_PROJECT_REF, S22_STAGING_CONFIRM=staging:<ref>   (staging guard)
 *   SUPABASE_URL=https://<ref>.supabase.co, APP_URL=<staging app origin>
 *   SUPABASE_SERVICE_KEY            service role: generateLink, profile status, cleanup
 *   S22_ADMIN_EMAIL, S22_ADMIN_PASSWORD   a STAGING admin account (used via the app's login API)
 *   one of: S22_TEST_EMAIL_DOMAIN   a domain the owner controls (synthetic s22-<run>@domain)
 *           S22_TEST_INBOX          owner+s22-<run>@gmail.com style plus-addressing
 * Optional:
 *   S22_STUDENT_ID   uuid of a SYNTHETIC staging student record, enables the account-linkage step
 *   S22_RUN_ID       run label (default: timestamp)
 *   --keep-user      do not delete the synthetic auth user afterwards
 *   --no-wait        fail fast on HTTP 429 instead of waiting for the app's rate limiter to reset
 *   --out=<path>     evidence file (default docs/recovery/s22/evidence/hosted-auth-rehearsal-<run>.json)
 *
 * Every step records REAL_PASS / REAL_FAIL / NOT_RUN. Nothing is simulated by this script:
 * if a step cannot run, it is NOT_RUN with the reason. Only synthetic identities are created.
 * No token, password or link credential is written to the evidence (all text goes through redact()).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { assertStagingTarget, redact, StagingGuardError } from './lib/staging-guard';

export type StepStatus = 'REAL_PASS' | 'REAL_FAIL' | 'NOT_RUN';
export interface StepRecord {
  id: string;
  title: string;
  status: StepStatus;
  detail: string;
  evidence?: Record<string, unknown>;
}

export const PLAN: ReadonlyArray<{ id: string; title: string }> = [
  { id: 'preflight', title: 'Guard + env + synthetic identity + app reachable' },
  { id: 'admin_login', title: 'Admin logs in through POST /api/auth/login' },
  { id: 'uninvited_denied', title: 'Registration without an invitation is refused (403), no account created' },
  { id: 'invitation_created', title: 'Admin creates invitation through POST /api/admin/invitations' },
  { id: 'wrong_email_denied', title: 'Invitation cannot be used for a different email' },
  { id: 'register', title: 'Registration with the invitation (POST /api/auth/signup)' },
  { id: 'unverified_login_denied', title: 'Login is refused until the email is verified' },
  { id: 'delivery_request', title: 'Real delivery: POST /api/auth/resend-verification accepted (OWNER confirms inbox receipt)' },
  { id: 'verification_link', title: 'Obtain verification link via admin generateLink; redirect host equals APP_URL host' },
  { id: 'verify_via_app', title: 'Verify through the app (GET page route + POST /api/auth/verify-email); replay refused' },
  { id: 'login', title: 'Login (POST /api/auth/login)' },
  { id: 'session_check', title: 'Session check (GET /api/me)' },
  { id: 'session_invalid_denied', title: 'Forged / expired / garbage bearer tokens are rejected (401)' },
  { id: 'student_linkage', title: 'Account linked to the synthetic student record (needs S22_STUDENT_ID)' },
  { id: 'logout', title: 'Logout, then the same token is rejected' },
  { id: 'recovery_request', title: 'Password recovery request accepted (generic response; OWNER confirms inbox receipt)' },
  { id: 'recovery_link', title: 'Obtain recovery link via admin generateLink; redirect host equals APP_URL host' },
  { id: 'password_reset', title: 'Reset password via the app (token_hash); old password refused, new password works' },
  { id: 'inactive_denied', title: 'Inactive profile is denied at login and on an existing token; status restored' },
  { id: 'natural_expiry', title: 'Natural access-token expiry (JWT lifetime, default 1h) -- NOT automated' },
  { id: 'cleanup', title: 'Remove the synthetic account' },
];

/** Derives the synthetic test address, or throws. Never a real student address. */
export function deriveTestEmail(env: Record<string, string | undefined>, runId: string): string {
  const safeRun = runId.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
  if (!safeRun) throw new Error('run id is empty after sanitising');
  const domain = (env.S22_TEST_EMAIL_DOMAIN ?? '').trim().toLowerCase();
  const inbox = (env.S22_TEST_INBOX ?? '').trim().toLowerCase();
  if (domain) {
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new Error('S22_TEST_EMAIL_DOMAIN is not a domain');
    return `s22-${safeRun}@${domain}`;
  }
  if (inbox) {
    const m = /^([a-z0-9._-]+)@([a-z0-9.-]+\.[a-z]{2,})$/.exec(inbox);
    if (!m || m[1].includes('+')) throw new Error('S22_TEST_INBOX must be a plain address like owner@example.com');
    return `${m[1]}+s22-${safeRun}@${m[2]}`;
  }
  throw new Error('set S22_TEST_EMAIL_DOMAIN (a domain you control) or S22_TEST_INBOX (plus-addressing)');
}

export function sameHost(a: string | undefined | null, b: string): boolean {
  try {
    return !!a && new URL(a).host.toLowerCase() === new URL(b).host.toLowerCase();
  } catch {
    return false;
  }
}

/** Keeps header/payload, corrupts the signature: a forged token. */
export function forgeJwt(token: string, patch: Record<string, unknown> = {}): string {
  const [h, p] = token.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>;
  const body = Buffer.from(JSON.stringify({ ...payload, ...patch })).toString('base64url');
  return `${h}.${body}.${'A'.repeat(43)}`;
}

/** Operations that need the service role (or the DB). Injected so tests can run without Supabase. */
export interface AdminOps {
  generateLink(type: 'magiclink' | 'recovery', email: string, redirectTo: string): Promise<{ hashedToken: string; redirectTo: string | null; verificationType: string | null }>;
  setProfileStatus(userId: string, status: 'active' | 'inactive'): Promise<void>;
  findLocalUserId(email: string): Promise<string | null>;
  deleteAccount(userId: string): Promise<void>;
}

export interface RehearsalContext {
  appUrl: string;
  fetch: typeof fetch;
  admin: AdminOps;
  adminEmail: string;
  adminPassword: string;
  testEmail: string;
  studentId?: string;
  keepUser?: boolean;
  /**
   * The app's own limiters are real (login 5/15min/IP, signup 3/h/IP, reset 3/h/IP).
   * On HTTP 429 wait for the advertised reset and retry once; false = fail fast.
   */
  waitOnRateLimit?: boolean;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

type Json = Record<string, any>;

export async function runRehearsal(ctx: RehearsalContext): Promise<StepRecord[]> {
  const records = new Map<string, StepRecord>();
  const state: Json = {};
  const password1 = `S22!${Math.random().toString(36).slice(2)}Aa1`;
  const password2 = `S22!${Math.random().toString(36).slice(2)}Bb2`;

  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const call = async (method: string, path: string, opts: { token?: string; body?: unknown } = {}, retried = false): Promise<{ status: number; json: Json; text: string }> => {
    const csrf = opts.token && opts.token === state.adminToken && method !== 'GET' ? state.adminCsrf : undefined;
    const res = await ctx.fetch(`${ctx.appUrl}${path}`, {
      method,
      headers: {
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 429 && ctx.waitOnRateLimit && !retried) {
      const advertised = Number(res.headers.get('ratelimit-reset') ?? res.headers.get('retry-after'));
      const waitMs = Math.min(Math.max(Number.isFinite(advertised) && advertised > 0 ? advertised : 60, 1), 3600) * 1000 + 1000;
      ctx.log?.(`rate limited on ${method} ${path}; waiting ${Math.round(waitMs / 1000)}s then retrying once`);
      await sleep(waitMs);
      return call(method, path, opts, true);
    }
    const text = await res.text();
    let json: Json = {};
    try { json = JSON.parse(text); } catch { /* html page */ }
    return { status: res.status, json, text };
  };

  async function step(id: string, requires: string[], fn: () => Promise<{ ok: boolean; detail: string; evidence?: Json }>) {
    const def = PLAN.find((s) => s.id === id)!;
    const blocked = requires.find((r) => records.get(r)?.status !== 'REAL_PASS');
    if (blocked) {
      records.set(id, { id, title: def.title, status: 'NOT_RUN', detail: `skipped: prerequisite ${blocked} did not pass` });
      return;
    }
    try {
      const r = await fn();
      records.set(id, { id, title: def.title, status: r.ok ? 'REAL_PASS' : 'REAL_FAIL', detail: r.detail, evidence: r.evidence });
    } catch (error) {
      records.set(id, { id, title: def.title, status: 'REAL_FAIL', detail: `threw: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  const notRun = (id: string, detail: string) => {
    records.set(id, { id, title: PLAN.find((s) => s.id === id)!.title, status: 'NOT_RUN', detail });
  };

  await step('preflight', [], async () => {
    const r = await call('GET', '/ready');
    return { ok: r.status > 0 && r.status < 600, detail: `GET /ready -> ${r.status}`, evidence: { status: r.status } };
  });

  await step('admin_login', ['preflight'], async () => {
    const r = await call('POST', '/api/auth/login', { body: { email: ctx.adminEmail, password: ctx.adminPassword } });
    state.adminToken = r.json.session?.access_token;
    state.adminCsrf = r.json.session?.csrf_token ?? r.json.csrfToken;
    if (state.adminToken && !state.adminCsrf) state.adminCsrf = (await call('GET', '/api/csrf-token', { token: state.adminToken })).json.csrfToken;
    const isAdmin = r.json.user?.role === 'admin';
    return { ok: r.status === 200 && !!state.adminToken && isAdmin, detail: `login -> ${r.status}, role=${r.json.user?.role ?? 'n/a'}` };
  });

  await step('uninvited_denied', ['preflight'], async () => {
    const none = await call('POST', '/api/auth/signup', { body: { email: ctx.testEmail, password: password1, fullName: 'S22 Synthetic' } });
    const created = await ctx.admin.findLocalUserId(ctx.testEmail);
    return {
      ok: none.status === 403 && none.json.code === 'INVITATION_REQUIRED' && created === null,
      detail: `no-token -> ${none.status} ${none.json.code}; account created: ${created !== null} (signup limiter is 3/h/IP, so only 3 signup calls are made in a run)`,
    };
  });

  await step('invitation_created', ['admin_login'], async () => {
    const r = await call('POST', '/api/admin/invitations', { token: state.adminToken, body: { email: ctx.testEmail, expiresInHours: 2 } });
    state.invitation = r.json.token;
    return { ok: r.status === 201 && typeof r.json.token === 'string' && r.json.email === ctx.testEmail, detail: `POST /api/admin/invitations -> ${r.status}`, evidence: { expiresAt: r.json.expiresAt } };
  });

  await step('wrong_email_denied', ['invitation_created'], async () => {
    const other = ctx.testEmail.replace('@', '.other@');
    const r = await call('POST', '/api/auth/signup', { body: { email: other, password: password1, fullName: 'S22 Synthetic', invitationToken: state.invitation } });
    return { ok: r.status === 403 && r.json.code === 'INVITATION_INVALID', detail: `different email -> ${r.status} ${r.json.code}` };
  });

  await step('register', ['invitation_created', 'wrong_email_denied'], async () => {
    const r = await call('POST', '/api/auth/signup', { body: { email: ctx.testEmail, password: password1, fullName: 'S22 Synthetic', invitationToken: state.invitation } });
    state.userId = r.json.user?.id;
    const sessionIssued = !!r.json.session;
    return {
      ok: r.status === 200 && r.json.success === true && !sessionIssued,
      detail: `signup -> ${r.status}; session issued: ${sessionIssued} (must be false: ENABLE_EMAIL_VERIFICATION=true and Confirm email ON)`,
    };
  });

  await step('unverified_login_denied', ['register'], async () => {
    const r = await call('POST', '/api/auth/login', { body: { email: ctx.testEmail, password: password1 } });
    return { ok: r.status === 401 && !r.json.session, detail: `login before verification -> ${r.status}` };
  });

  await step('delivery_request', ['register'], async () => {
    const r = await call('POST', '/api/auth/resend-verification', { body: { email: ctx.testEmail } });
    return {
      ok: r.status === 200 && r.json.success === true,
      detail: `resend-verification -> ${r.status}. OWNER: confirm the email arrived at ${ctx.testEmail.replace(/^[^@+]+/, '***')}, came from the configured sender, and its button host equals the APP_URL host`,
      evidence: { ownerConfirmationRequired: true },
    };
  });

  await step('verification_link', ['register'], async () => {
    const link = await ctx.admin.generateLink('magiclink', ctx.testEmail, `${ctx.appUrl}/verify-email`);
    state.verifyHash = link.hashedToken;
    // GoTrue reports verification_type "signup" for an unconfirmed user's magiclink.
    state.verifyType = link.verificationType === 'signup' ? 'signup' : 'email';
    const hostOk = sameHost(link.redirectTo, ctx.appUrl);
    return {
      ok: !!link.hashedToken && hostOk,
      detail: `generateLink -> redirect_to host ${hostOk ? 'equals' : 'DOES NOT equal'} APP_URL host (a mismatch means the redirect allow-list or Site URL is wrong)`,
      evidence: { redirectToHost: link.redirectTo ? new URL(link.redirectTo).host : null },
    };
  });

  await step('verify_via_app', ['verification_link'], async () => {
    const page = await call('GET', `/auth/verify?token_hash=${encodeURIComponent(state.verifyHash)}&type=${state.verifyType}`);
    const first = await call('POST', '/api/auth/verify-email', { body: { token_hash: state.verifyHash, type: state.verifyType } });
    const replay = await call('POST', '/api/auth/verify-email', { body: { token_hash: state.verifyHash, type: state.verifyType } });
    return {
      ok: page.status === 200 && first.status === 200 && first.json.verified === true && replay.status === 401 && replay.json.verified === false,
      detail: `page ${page.status}; verify -> ${first.status} verified=${first.json.verified}; replay -> ${replay.status}`,
    };
  });

  await step('login', ['verify_via_app'], async () => {
    const r = await call('POST', '/api/auth/login', { body: { email: ctx.testEmail, password: password1 } });
    state.token = r.json.session?.access_token;
    state.userId = r.json.user?.id ?? state.userId;
    return { ok: r.status === 200 && !!state.token, detail: `login -> ${r.status}, role=${r.json.user?.role ?? 'n/a'}` };
  });

  await step('session_check', ['login'], async () => {
    const r = await call('GET', '/api/me', { token: state.token });
    return { ok: r.status === 200 && r.json.user?.email === ctx.testEmail && r.json.user?.role === 'student', detail: `/api/me -> ${r.status}, role=${r.json.user?.role ?? 'n/a'}` };
  });

  await step('session_invalid_denied', ['login'], async () => {
    const exp = Math.floor(Date.now() / 1000) - 3600;
    const results = {
      forgedExpired: (await call('GET', '/api/me', { token: forgeJwt(state.token, { exp }) })).status,
      forgedFuture: (await call('GET', '/api/me', { token: forgeJwt(state.token, { exp: exp + 7 * 86400 }) })).status,
      garbage: (await call('GET', '/api/me', { token: 'not.a.jwt' })).status,
      none: (await call('GET', '/api/me')).status,
    };
    return { ok: Object.values(results).every((s) => s === 401), detail: `statuses ${JSON.stringify(results)} (all must be 401)`, evidence: results };
  });

  if (!ctx.studentId) notRun('student_linkage', 'S22_STUDENT_ID not set (needs a synthetic staging student record)');
  else {
    await step('student_linkage', ['login', 'admin_login'], async () => {
      const link = await call('POST', `/api/admin/students/${ctx.studentId}/account/link`, { token: state.adminToken, body: { userId: state.userId } });
      const view = await call('GET', `/api/admin/students/${ctx.studentId}/account`, { token: state.adminToken });
      const linked = JSON.stringify(view.json).includes(state.userId);
      state.linked = link.status === 200;
      return { ok: link.status === 200 && view.status === 200 && linked, detail: `link -> ${link.status}; account view -> ${view.status}, shows the user: ${linked}` };
    });
  }

  await step('logout', ['login'], async () => {
    const out = await call('POST', '/api/auth/logout', { token: state.token });
    const after = await call('GET', '/api/me', { token: state.token });
    return { ok: out.status === 200 && after.status === 401, detail: `logout -> ${out.status}; /api/me with the same token afterwards -> ${after.status} (must be 401)` };
  });

  await step('recovery_request', ['verify_via_app'], async () => {
    const known = await call('POST', '/api/auth/reset-password', { body: { email: ctx.testEmail } });
    const unknown = await call('POST', '/api/auth/reset-password', { body: { email: `nobody-${Date.now()}@${ctx.testEmail.split('@')[1]}` } });
    return {
      ok: known.status === 200 && unknown.status === 200 && JSON.stringify(known.json) === JSON.stringify(unknown.json),
      detail: `known -> ${known.status}, unknown -> ${unknown.status}, identical bodies: ${JSON.stringify(known.json) === JSON.stringify(unknown.json)}. OWNER: confirm the reset email arrived and its link host equals the APP_URL host`,
      evidence: { ownerConfirmationRequired: true },
    };
  });

  await step('recovery_link', ['verify_via_app'], async () => {
    const link = await ctx.admin.generateLink('recovery', ctx.testEmail, `${ctx.appUrl}/reset-password`);
    state.recoveryHash = link.hashedToken;
    const hostOk = sameHost(link.redirectTo, ctx.appUrl);
    return { ok: !!link.hashedToken && hostOk, detail: `generateLink recovery -> redirect_to host ${hostOk ? 'equals' : 'DOES NOT equal'} APP_URL host` };
  });

  await step('password_reset', ['recovery_link', 'login'], async () => {
    const wrongType = await call('POST', '/api/auth/update-password', { body: { password: password2, token_hash: state.recoveryHash, recovery_type: 'signup' } });
    const reset = await call('POST', '/api/auth/update-password', { body: { password: password2, token_hash: state.recoveryHash, recovery_type: 'recovery' } });
    const replay = await call('POST', '/api/auth/update-password', { body: { password: `${password2}x`, token_hash: state.recoveryHash, recovery_type: 'recovery' } });
    const oldPw = await call('POST', '/api/auth/login', { body: { email: ctx.testEmail, password: password1 } });
    const newPw = await call('POST', '/api/auth/login', { body: { email: ctx.testEmail, password: password2 } });
    state.token = newPw.json.session?.access_token;
    return {
      ok: wrongType.status === 401 && reset.status === 200 && replay.status === 401 && oldPw.status === 401 && newPw.status === 200,
      detail: `wrong type ${wrongType.status}; reset ${reset.status}; replay ${replay.status}; old password ${oldPw.status}; new password ${newPw.status}`,
    };
  });

  await step('inactive_denied', ['password_reset'], async () => {
    let result: { ok: boolean; detail: string };
    try {
      await ctx.admin.setProfileStatus(state.userId, 'inactive');
      const onToken = await call('GET', '/api/me', { token: state.token });
      const onLogin = await call('POST', '/api/auth/login', { body: { email: ctx.testEmail, password: password2 } });
      result = {
        ok: onToken.status === 403 && onToken.json.code === 'ACCOUNT_INACTIVE' && onLogin.status === 403 && onLogin.json.code === 'ACCOUNT_INACTIVE',
        detail: `existing token -> ${onToken.status} ${onToken.json.code}; login -> ${onLogin.status} ${onLogin.json.code}`,
      };
    } finally {
      await ctx.admin.setProfileStatus(state.userId, 'active');
    }
    const restored = await call('POST', '/api/auth/login', { body: { email: ctx.testEmail, password: password2 } });
    return { ok: result.ok && restored.status === 200, detail: `${result.detail}; after restore login -> ${restored.status}` };
  });

  notRun('natural_expiry',
    'Not automated. The app holds no session store: every request calls supabase.auth.getUser(token), so expiry is the Supabase access-token lifetime (JWT expiry, default 3600s) and the refresh-token policy. Forged/expired tokens are covered by session_invalid_denied; to observe natural expiry, log in, wait JWT expiry + 1 minute, and call /api/me.');

  // Cleanup: always attempt, even when earlier steps failed.
  try {
    if (state.linked && ctx.studentId) {
      await call('POST', `/api/admin/students/${ctx.studentId}/account/unlink`, { token: state.adminToken, body: { reason: 'S22 rehearsal cleanup' } });
    }
    if (ctx.keepUser) {
      notRun('cleanup', '--keep-user: synthetic account left in place');
    } else {
      const id: string | null = state.userId ?? (await ctx.admin.findLocalUserId(ctx.testEmail));
      if (id) {
        await ctx.admin.deleteAccount(id);
        records.set('cleanup', { id: 'cleanup', title: PLAN.find((s) => s.id === 'cleanup')!.title, status: 'REAL_PASS', detail: 'synthetic account removed (consumed invitation row remains as audit)' });
      } else notRun('cleanup', 'no synthetic account was created');
    }
  } catch (error) {
    records.set('cleanup', { id: 'cleanup', title: PLAN.find((s) => s.id === 'cleanup')!.title, status: 'REAL_FAIL', detail: `cleanup failed: ${error instanceof Error ? error.message : String(error)}; remove ${ctx.testEmail} manually` });
  }

  return PLAN.map((p) => records.get(p.id) ?? { id: p.id, title: p.title, status: 'NOT_RUN' as const, detail: 'not reached' });
}

/** Real AdminOps against hosted Supabase using the service role. */
export function supabaseAdminOps(supabaseUrl: string, serviceKey: string): AdminOps {
  const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return {
    async generateLink(type, email, redirectTo) {
      const { data, error } = await sb.auth.admin.generateLink({ type, email, options: { redirectTo } });
      if (error || !data?.properties?.hashed_token) throw new Error(`generateLink failed: ${error?.message ?? 'no token'}`);
      return { hashedToken: data.properties.hashed_token, redirectTo: data.properties.redirect_to ?? null, verificationType: data.properties.verification_type ?? null };
    },
    async setProfileStatus(userId, status) {
      const { error } = await sb.from('profiles').update({ status }).eq('user_id', userId);
      if (error) throw new Error(`profile status update failed: ${error.message}`);
    },
    async findLocalUserId(email) {
      const { data, error } = await sb.from('users').select('id').eq('email', email).maybeSingle();
      if (error) throw new Error(`users lookup failed: ${error.message}`);
      return data?.id ?? null;
    },
    async deleteAccount(userId) {
      await sb.from('profiles').delete().eq('user_id', userId);
      await sb.from('users').delete().eq('id', userId);
      const { error } = await sb.auth.admin.deleteUser(userId);
      if (error) throw new Error(`auth user delete failed: ${error.message}`);
    },
  };
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const runId = (process.env.S22_RUN_ID ?? new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)).trim();

  let guardMessage = 'ok';
  let target: ReturnType<typeof assertStagingTarget> | null = null;
  try {
    target = assertStagingTarget({ requireSupabaseUrl: true, requireAppUrl: true });
  } catch (error) {
    guardMessage = error instanceof StagingGuardError ? error.message : 'guard failed';
  }

  if (dryRun) {
    let email = '(unset)';
    try { email = deriveTestEmail(process.env, runId); } catch (error) { email = `(${(error as Error).message})`; }
    console.log(JSON.stringify({
      mode: 'dry-run (no network, nothing created)',
      stagingGuard: target ? 'passes' : `would REFUSE: ${guardMessage}`,
      appUrlHost: target?.appUrl ? new URL(target.appUrl).host : null,
      syntheticIdentity: email.replace(/^[^@]+/, 's22-<run>'),
      requiredEnv: ['S22_STAGING_PROJECT_REF', 'S22_STAGING_CONFIRM', 'SUPABASE_URL', 'APP_URL', 'SUPABASE_SERVICE_KEY', 'S22_ADMIN_EMAIL', 'S22_ADMIN_PASSWORD', 'S22_TEST_EMAIL_DOMAIN | S22_TEST_INBOX'],
      optionalEnv: ['S22_STUDENT_ID', 'S22_RUN_ID'],
      plan: PLAN,
    }, null, 2));
    return;
  }

  if (!target?.appUrl || !target.supabaseUrl) {
    console.error(`[s22-auth] refused: ${guardMessage}`);
    process.exitCode = 1;
    return;
  }
  const need = (name: string) => {
    const v = process.env[name]?.trim();
    if (!v) throw new Error(`${name} is required`);
    return v;
  };
  const ctx: RehearsalContext = {
    appUrl: target.appUrl,
    fetch,
    admin: supabaseAdminOps(target.supabaseUrl, need('SUPABASE_SERVICE_KEY')),
    adminEmail: need('S22_ADMIN_EMAIL'),
    adminPassword: need('S22_ADMIN_PASSWORD'),
    testEmail: deriveTestEmail(process.env, runId),
    studentId: process.env.S22_STUDENT_ID?.trim() || undefined,
    keepUser: process.argv.includes('--keep-user'),
    waitOnRateLimit: !process.argv.includes('--no-wait'),
    log: (m) => console.error(`[s22-auth] ${m}`),
  };

  const steps = await runRehearsal(ctx);
  const evidence = {
    runId,
    ranAt: new Date().toISOString(),
    stagingRef: target.ref,
    appHost: new URL(target.appUrl).host,
    summary: {
      REAL_PASS: steps.filter((s) => s.status === 'REAL_PASS').length,
      REAL_FAIL: steps.filter((s) => s.status === 'REAL_FAIL').length,
      NOT_RUN: steps.filter((s) => s.status === 'NOT_RUN').length,
    },
    steps,
  };
  const out = arg('out') ?? `docs/recovery/s22/evidence/hosted-auth-rehearsal-${runId}.json`;
  const text = redact(JSON.stringify(evidence, null, 2));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text + '\n');
  console.log(text);
  console.error(`[s22-auth] evidence written to ${out}`);
  if (evidence.summary.REAL_FAIL > 0) process.exitCode = 1;
}

const invoked = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invoked) {
  main().catch((error) => {
    console.error(`[s22-auth] ${redact(error instanceof Error ? error.message : String(error))}`);
    process.exitCode = 1;
  });
}
