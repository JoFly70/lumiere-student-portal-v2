/**
 * S22 staging guard. Every S22 script that talks to a hosted Supabase project or
 * a deployed app calls assertStagingTarget() first. It refuses anything that is not
 * the one explicitly named, non-production staging project:
 *
 *  - S22_STAGING_PROJECT_REF must be set (20 lowercase letters) and must not be a
 *    known production / historical / unrelated project ref;
 *  - S22_STAGING_CONFIRM must equal `staging:<ref>` (typed by the operator);
 *  - SUPABASE_URL (if given) must be exactly https://<ref>.supabase.co;
 *  - DATABASE_URL (if given) must be a Supabase host for that same ref
 *    (db.<ref>.supabase.co, or the pooler with user postgres.<ref>).
 *
 * Nothing here prints a secret: errors name variables, never their values
 * (project refs are public subdomains and may be shown).
 */

/** Refs that S22 scripts must never touch. */
export const FORBIDDEN_PROJECT_REFS: Record<string, string> = {
  rheronevecsffaejteoj: 'canonical Supabase of the published V2 app (treat as production)',
  ypbzdbfqoflyszdsbivn: 'historical project ref (Replit handoff: do not use)',
  brrktoofhtcylxrundvl: 'historical project ref (Replit handoff: do not use)',
};

/** Hosts that are never a staging target (other applications' databases). */
const FORBIDDEN_HOST_PATTERNS = [/neon\.tech$/i, /clientdesk/i];

export const PRODUCTION_ORIGINS = [
  'https://lumiereportal.app',
  'https://www.lumiereportal.app',
  'https://lumiere-student-portal-v-2.replit.app',
];

export class StagingGuardError extends Error {}

const REF_RE = /^[a-z]{20}$/;

export interface StagingTarget {
  ref: string;
  supabaseUrl?: string;
  databaseHost?: string;
  appUrl?: string;
}

export interface GuardInput {
  env?: Record<string, string | undefined>;
  requireDatabase?: boolean;
  requireSupabaseUrl?: boolean;
  requireAppUrl?: boolean;
}

export function assertStagingTarget(input: GuardInput = {}): StagingTarget {
  const env = input.env ?? process.env;
  const ref = (env.S22_STAGING_PROJECT_REF ?? '').trim();
  if (!REF_RE.test(ref)) {
    throw new StagingGuardError('S22_STAGING_PROJECT_REF must be set to the 20-letter staging project ref');
  }
  if (FORBIDDEN_PROJECT_REFS[ref]) {
    throw new StagingGuardError(`refusing project ${ref}: ${FORBIDDEN_PROJECT_REFS[ref]}`);
  }
  if ((env.S22_STAGING_CONFIRM ?? '') !== `staging:${ref}`) {
    throw new StagingGuardError(`S22_STAGING_CONFIRM must equal "staging:${ref}"`);
  }

  const target: StagingTarget = { ref };

  const supabaseUrl = env.SUPABASE_URL;
  if (supabaseUrl || input.requireSupabaseUrl) {
    if (!supabaseUrl) throw new StagingGuardError('SUPABASE_URL is required');
    checkSupabaseUrl(supabaseUrl, ref, 'SUPABASE_URL');
    target.supabaseUrl = `https://${ref}.supabase.co`;
  }
  const viteUrl = env.VITE_SUPABASE_URL;
  if (viteUrl) checkSupabaseUrl(viteUrl, ref, 'VITE_SUPABASE_URL');

  const dbUrl = env.DATABASE_URL;
  if (dbUrl || input.requireDatabase) {
    if (!dbUrl) throw new StagingGuardError('DATABASE_URL is required');
    target.databaseHost = checkDatabaseUrl(dbUrl, ref);
  }

  const appUrl = env.APP_URL;
  if (appUrl || input.requireAppUrl) {
    if (!appUrl) throw new StagingGuardError('APP_URL is required');
    target.appUrl = checkAppUrl(appUrl);
  }
  return target;
}

function checkSupabaseUrl(value: string, ref: string, name: string): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new StagingGuardError(`${name} is not a URL`); }
  if (url.protocol !== 'https:' || url.hostname !== `${ref}.supabase.co`) {
    throw new StagingGuardError(`${name} must be https://${ref}.supabase.co (got host ${url.hostname})`);
  }
}

/** Returns the host (no credentials) when DATABASE_URL targets the staging ref. */
export function checkDatabaseUrl(value: string, ref: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new StagingGuardError('DATABASE_URL is not a URL'); }
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new StagingGuardError('DATABASE_URL must be postgres://');
  const host = url.hostname.toLowerCase();
  const user = decodeURIComponent(url.username).toLowerCase();
  if (FORBIDDEN_HOST_PATTERNS.some((re) => re.test(host))) {
    throw new StagingGuardError(`refusing DATABASE_URL host ${host}: not a Supabase staging database`);
  }
  for (const bad of Object.keys(FORBIDDEN_PROJECT_REFS)) {
    if (host.includes(bad) || user.includes(bad)) {
      throw new StagingGuardError(`refusing DATABASE_URL for project ${bad}`);
    }
  }
  const direct = host === `db.${ref}.supabase.co`;
  const pooler = /\.pooler\.supabase\.com$/.test(host) && user === `postgres.${ref}`;
  if (!direct && !pooler) {
    throw new StagingGuardError(`DATABASE_URL must target db.${ref}.supabase.co or the pooler as postgres.${ref} (got host ${host})`);
  }
  return host;
}

export function checkAppUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new StagingGuardError('APP_URL is not a URL'); }
  const origin = url.origin.toLowerCase();
  if (PRODUCTION_ORIGINS.includes(origin)) {
    throw new StagingGuardError(`refusing APP_URL ${origin}: production origin`);
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new StagingGuardError('APP_URL must be https (or localhost)');
  }
  return origin;
}

/** Removes credentials from any string before it is logged. */
export function redact(text: string): string {
  return text
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+):[^@\s]+@/gi, '$1:***@')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '<jwt>')
    .replace(/\b(sb_(?:secret|publishable)_)[A-Za-z0-9_-]+/g, '$1***')
    .replace(/([?&#](?:access_token|refresh_token|token|token_hash|code|apikey)=)[^&\s"]+/gi, '$1***');
}
