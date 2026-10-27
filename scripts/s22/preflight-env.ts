/**
 * S22 environment preflight. Validates variable NAMES and SHAPES only; never prints values
 * (project refs are public subdomains and may be shown).
 *
 * Staging (default):
 *   S22_STAGING_PROJECT_REF=<ref> S22_STAGING_CONFIRM=staging:<ref> \
 *     npx tsx scripts/s22/preflight-env.ts
 * Production (pre-cutover gate, read-only, offline):
 *   npx tsx scripts/s22/preflight-env.ts --production --ref <production project ref>
 * Flags: --require-redis (staging: make missing REDIS_URL a failure)
 *
 * Reads process.env (set the variables in the shell from the deployment's secret names, or run
 * it inside the Replit shell of the target deployment's Repl). Exits 1 on any FAIL.
 */
import { pathToFileURL } from 'node:url';
import {
  assertStagingTarget, checkAppUrl, FORBIDDEN_PROJECT_REFS, StagingGuardError,
} from './lib/staging-guard';

export const PRODUCTION_APP_ORIGIN = 'https://lumiereportal.app';

export type Level = 'PASS' | 'FAIL' | 'WARN';
export interface Finding { level: Level; name: string; detail: string }
export interface PreflightOptions {
  production?: boolean;
  productionRef?: string;
  requireRedis?: boolean;
}
type Env = Record<string, string | undefined>;

const DEV_SECRETS = ['local-dev-secret-change-in-production', 'dev-secret-change-in-production'];

function refFromSupabaseUrl(v: string | undefined): string | null {
  if (!v) return null;
  try { const m = new URL(v).hostname.match(/^([a-z]{20})\.supabase\.co$/); return m ? m[1] : null; } catch { return null; }
}
function refFromDatabaseUrl(v: string | undefined): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    const direct = u.hostname.match(/^db\.([a-z]{20})\.supabase\.co$/);
    if (direct) return direct[1];
    const user = decodeURIComponent(u.username).match(/^postgres\.([a-z]{20})$/);
    return user && /\.pooler\.supabase\.com$/.test(u.hostname) ? user[1] : null;
  } catch { return null; }
}
function jwtClaims(key: string): Record<string, unknown> | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
}
/** 'secret' | 'publishable' | 'unknown' without exposing the key. */
function keyKind(key: string | undefined): { kind: 'secret' | 'publishable' | 'unknown'; ref?: string } {
  if (!key) return { kind: 'unknown' };
  if (key.startsWith('sb_secret_')) return { kind: 'secret' };
  if (key.startsWith('sb_publishable_')) return { kind: 'publishable' };
  const c = jwtClaims(key);
  if (c?.role === 'service_role') return { kind: 'secret', ref: c.ref as string | undefined };
  if (c?.role === 'anon') return { kind: 'publishable', ref: c.ref as string | undefined };
  return { kind: 'unknown' };
}

export function runPreflight(env: Env, opts: PreflightOptions = {}): Finding[] {
  const out: Finding[] = [];
  const add = (level: Level, name: string, detail: string) => out.push({ level, name, detail });
  const need = (ok: boolean, name: string, pass: string, fail: string) => add(ok ? 'PASS' : 'FAIL', name, ok ? pass : fail);
  const mode = opts.production ? 'production' : 'staging';

  need(env.NODE_ENV === 'production', 'NODE_ENV', 'is production', 'must be "production"');

  // Which Supabase project does this environment target?
  let expectedRef: string | null = null;
  if (opts.production) {
    expectedRef = opts.productionRef ?? null;
    if (!expectedRef || !/^[a-z]{20}$/.test(expectedRef)) {
      add('FAIL', 'production ref', 'pass the production project ref explicitly: --ref <20 letters>');
      expectedRef = null;
    } else if (FORBIDDEN_PROJECT_REFS[expectedRef] && expectedRef !== 'rheronevecsffaejteoj') {
      add('FAIL', 'production ref', `${expectedRef} is a forbidden historical ref`);
      expectedRef = null;
    } else add('PASS', 'production ref', `explicit ref ${expectedRef}`);
  } else {
    try {
      const t = assertStagingTarget({ env, requireSupabaseUrl: true, requireDatabase: true, requireAppUrl: true });
      expectedRef = t.ref;
      add('PASS', 'staging guard', `ref ${t.ref}, SUPABASE_URL/DATABASE_URL/APP_URL pass assertStagingTarget`);
    } catch (e) {
      add('FAIL', 'staging guard', e instanceof StagingGuardError ? e.message : 'guard failed');
    }
  }

  // One ref across every variable.
  const refs: Array<[string, string | null, string | undefined]> = [
    ['SUPABASE_URL', refFromSupabaseUrl(env.SUPABASE_URL), env.SUPABASE_URL],
    ['DATABASE_URL', refFromDatabaseUrl(env.DATABASE_URL), env.DATABASE_URL],
    ['VITE_SUPABASE_URL', refFromSupabaseUrl(env.VITE_SUPABASE_URL), env.VITE_SUPABASE_URL],
  ];
  if (env.NEXT_PUBLIC_SUPABASE_URL) refs.push(['NEXT_PUBLIC_SUPABASE_URL', refFromSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL), env.NEXT_PUBLIC_SUPABASE_URL]);
  const seen = new Set<string>();
  for (const [name, ref, raw] of refs) {
    if (!raw) {
      if (name === 'VITE_SUPABASE_URL') add('WARN', name, 'unset (not read by the running app; /env.js is built from SUPABASE_URL)');
      else add('FAIL', name, 'is required');
      continue;
    }
    if (!ref) { add('FAIL', name, 'is not a recognised https://<ref>.supabase.co URL / Supabase Postgres URL'); continue; }
    seen.add(ref);
    if (expectedRef && ref !== expectedRef) add('FAIL', name, `targets ${ref}, expected ${expectedRef}`);
    else add('PASS', name, `targets ${ref}`);
  }
  need(seen.size <= 1, 'single project ref', 'all Supabase variables agree', `variables disagree: ${[...seen].join(', ')}`);

  // Keys (shape only; never echoed).
  const service = keyKind(env.SUPABASE_SERVICE_KEY);
  need(service.kind === 'secret', 'SUPABASE_SERVICE_KEY', 'secret-key shape', 'missing or not a service/secret key');
  for (const name of ['SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'] as const) {
    const v = env[name];
    if (!v) {
      if (name === 'SUPABASE_ANON_KEY' && !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) add('FAIL', name, 'is required at runtime (/env.js, /ready and user sign-in read it)');
      else if (name === 'VITE_SUPABASE_ANON_KEY') add('WARN', name, 'unset (not read by the running app)');
      continue;
    }
    const k = keyKind(v);
    if (k.kind !== 'publishable') add('FAIL', name, 'must be a publishable/anon key (a secret or unknown key would be served to browsers)');
    else add('PASS', name, 'publishable/anon shape');
    if (k.ref && expectedRef && k.ref !== expectedRef) add('FAIL', name, `JWT ref claim is ${k.ref}, expected ${expectedRef}`);
  }
  if (service.ref && expectedRef && service.ref !== expectedRef) add('FAIL', 'SUPABASE_SERVICE_KEY', `JWT ref claim is ${service.ref}, expected ${expectedRef}`);
  if (env.SUPABASE_ANON_KEY && env.VITE_SUPABASE_ANON_KEY && env.SUPABASE_ANON_KEY !== env.VITE_SUPABASE_ANON_KEY)
    add('WARN', 'anon key parity', 'SUPABASE_ANON_KEY and VITE_SUPABASE_ANON_KEY differ');

  const secret = env.SESSION_SECRET ?? '';
  need(secret.length >= 32 && !DEV_SECRETS.includes(secret), 'SESSION_SECRET', 'length >= 32 and not a dev default', 'must be at least 32 characters and not a dev default');

  // APP_URL
  if (opts.production) {
    need(env.APP_URL === PRODUCTION_APP_ORIGIN, 'APP_URL', `is ${PRODUCTION_APP_ORIGIN}`, `must be exactly ${PRODUCTION_APP_ORIGIN} in production mode`);
    if (env.PUBLIC_APP_URL) need(env.PUBLIC_APP_URL === PRODUCTION_APP_ORIGIN, 'PUBLIC_APP_URL', 'matches', `must be ${PRODUCTION_APP_ORIGIN}`);
    if (env.CUSTOM_DOMAIN && env.CUSTOM_DOMAIN !== 'lumiereportal.app') add('FAIL', 'CUSTOM_DOMAIN', 'must be unset or lumiereportal.app');
  } else {
    if (env.APP_URL) {
      try { checkAppUrl(env.APP_URL); add('PASS', 'APP_URL', 'non-production https origin'); }
      catch (e) { add('FAIL', 'APP_URL', (e as Error).message); }
      if (env.APP_URL.replace(/\/$/, '').toLowerCase() !== new URL(env.APP_URL).origin) add('WARN', 'APP_URL', 'should be a bare origin without path');
    }
    if (env.PUBLIC_APP_URL) {
      try { checkAppUrl(env.PUBLIC_APP_URL); if (env.APP_URL && new URL(env.PUBLIC_APP_URL).origin !== new URL(env.APP_URL).origin) add('FAIL', 'PUBLIC_APP_URL', 'differs from APP_URL'); else add('PASS', 'PUBLIC_APP_URL', 'matches'); }
      catch (e) { add('FAIL', 'PUBLIC_APP_URL', (e as Error).message); }
    }
  }

  need(env.ENABLE_EMAIL_VERIFICATION === 'true', 'ENABLE_EMAIL_VERIFICATION', 'true', 'must be "true" (unset means accounts are auto-confirmed and skip email verification)');
  need(!env.ALLOW_DEMO_MODE || env.ALLOW_DEMO_MODE === 'false', 'ALLOW_DEMO_MODE', 'unset/false', 'must be unset');

  const spark = env.SPARK_ASSISTANT_ENABLED;
  if (spark === 'true') {
    add(opts.production ? 'WARN' : 'FAIL', 'SPARK_ASSISTANT_ENABLED', opts.production ? 'live assistant enabled; confirm this is intended and META_MODEL_API_KEY / SPARK_ASSISTANT_LIVE_ROLES=admin are set' : 'must be unset/false in staging unless the live-assistant test is explicitly being run');
  } else add('PASS', 'SPARK_ASSISTANT_ENABLED', 'unset/false (assistant answers locally)');

  // Mail: SMTP is configured inside Supabase Auth; the app only declares it.
  const mail = (env.AUTH_EMAIL_MODE ?? '').trim().toLowerCase();
  if (mail === 'custom_smtp') add('PASS', 'AUTH_EMAIL_MODE', 'custom_smtp (declaration only; the SMTP credentials live in Supabase Auth settings, verify with npm run verify:supabase-auth-config and a real inbox test)');
  else if (mail === 'supabase_default') add(opts.production ? 'FAIL' : 'WARN', 'AUTH_EMAIL_MODE', 'supabase_default sends from the shared Supabase mailer (heavily rate limited); /ready reports not ready');
  else add('FAIL', 'AUTH_EMAIL_MODE', 'must be custom_smtp (or supabase_default for staging)');
  if (env.EMAIL_ENABLED === 'true') add('WARN', 'EMAIL_ENABLED', 'app-level mailer is a log-only stub (no SMTP transport exists in server/lib/email.ts)');

  // Redis vs /ready
  if (env.REDIS_URL) {
    need(/^rediss?:\/\//.test(env.REDIS_URL), 'REDIS_URL', 'redis(s):// shape; /ready reports distributedRateLimit only while the connection is live', 'must start with redis:// or rediss://');
  } else {
    const strict = opts.production || opts.requireRedis;
    add(strict ? 'FAIL' : 'WARN', 'REDIS_URL', 'unset: rate limits are per instance and production /ready returns 503 (distributedRateLimit=false)');
  }
  return out;
}

export function render(findings: Finding[], mode: string): string {
  const lines = findings.map((f) => `${f.level.padEnd(4)}  ${f.name}: ${f.detail}`);
  const fails = findings.filter((f) => f.level === 'FAIL').length;
  const warns = findings.filter((f) => f.level === 'WARN').length;
  return [`S22 preflight (${mode})`, ...lines, `result: ${fails === 0 ? 'PASS' : 'FAIL'} (${fails} failures, ${warns} warnings)`].join('\n');
}

function main(): void {
  const argv = process.argv.slice(2);
  const production = argv.includes('--production');
  const i = argv.indexOf('--ref');
  const findings = runPreflight(process.env, {
    production, productionRef: i >= 0 ? argv[i + 1] : undefined, requireRedis: argv.includes('--require-redis'),
  });
  console.log(render(findings, production ? 'production' : 'staging'));
  process.exit(findings.some((f) => f.level === 'FAIL') ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
