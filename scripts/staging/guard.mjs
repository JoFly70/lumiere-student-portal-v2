// Offline validation only. This module never imports application/database code.
export const STAGING_REF = 'tqgwoyzlnkqwkcjsiocd';
const SUPABASE_ORIGIN = `https://${STAGING_REF}.supabase.co`;

export class StagingStartupError extends Error {}
const refuse = (message) => { throw new StagingStartupError(message); };

export function validateStagingIdentity(env) {
  if (env.S22_STAGING_PROJECT_REF !== STAGING_REF ||
      env.S22_STAGING_CONFIRM !== `staging:${STAGING_REF}`) {
    refuse('Staging project identity or confirmation is missing or incorrect.');
  }
  for (const name of ['SUPABASE_URL', 'VITE_SUPABASE_URL']) {
    if (env[name] !== SUPABASE_ORIGIN) refuse(`${name} must identify the approved staging project.`);
  }
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_URL !== SUPABASE_ORIGIN) {
    refuse('NEXT_PUBLIC_SUPABASE_URL conflicts with staging.');
  }
}

// Deliberately separate identity parsing from credential checks so offline tests
// can exercise valid targets without creating any passwords or credential keys.
export function validateStagingDatabaseIdentity(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    refuse('STAGING_DATABASE_URL is required.');
  }
  let url;
  try { url = new URL(value); } catch { refuse('STAGING_DATABASE_URL is not a valid connection URL.'); }
  let username;
  try { username = decodeURIComponent(url.username); } catch {
    refuse('STAGING_DATABASE_URL has invalid user encoding.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !/^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) ||
      username !== `postgres.${STAGING_REF}` ||
      url.port !== '5432' || url.pathname !== '/postgres' || url.hash) {
    refuse('STAGING_DATABASE_URL must use the approved staging session pooler, port 5432, and postgres database.');
  }
  const params = [...url.searchParams];
  if (params.some(([key]) => key !== 'sslmode') ||
      params.filter(([key]) => key === 'sslmode').length !== 1 ||
      !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode'))) {
    refuse('STAGING_DATABASE_URL requires one sslmode=require (or stronger) and no other query options.');
  }
  return url;
}

function validateKey(key, role, name) {
  if (typeof key !== 'string' || !key.trim()) refuse(`${name} is required.`);
  const prefix = role === 'service_role' ? 'sb_secret_' : 'sb_publishable_';
  // New-format opaque keys have no locally inspectable project claim. Their
  // provenance must be established by the owner when entering staging Secrets.
  if (key.startsWith(prefix) && /^[A-Za-z0-9_-]+$/.test(key.slice(prefix.length)) &&
      key.length > prefix.length) return;
  try {
    const parts = key.split('.');
    if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (claims.ref !== STAGING_REF || claims.role !== role ||
        !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000) throw new Error();
  } catch {
    refuse(`${name} has an invalid role, project identity, format, or expiry.`);
  }
}

export function validateStagingServiceKey(env) {
  validateKey(env.SUPABASE_SERVICE_KEY, 'service_role', 'SUPABASE_SERVICE_KEY');
}

export function validateStagingAuthConfiguration(env) {
  if (env.ENABLE_EMAIL_VERIFICATION !== 'true') refuse('Staging requires ENABLE_EMAIL_VERIFICATION=true.');
  if (env.ALLOW_DEMO_MODE && env.ALLOW_DEMO_MODE !== 'false') refuse('Staging does not permit demo authentication.');
}

export function validateStartupEnvironment(env) {
  validateStagingIdentity(env);
  const database = validateStagingDatabaseIdentity(env.STAGING_DATABASE_URL);
  if (!database.password) refuse('STAGING_DATABASE_URL must include its staging database password.');
  validateStagingServiceKey(env);
  validateKey(env.SUPABASE_ANON_KEY, 'anon', 'SUPABASE_ANON_KEY');
  for (const name of ['VITE_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    if (env[name]) {
      validateKey(env[name], 'anon', name);
      if (env[name] !== env.SUPABASE_ANON_KEY) refuse(`${name} conflicts with SUPABASE_ANON_KEY.`);
    }
  }
  for (const name of Object.keys(env)) {
    if (/^(VITE_|NEXT_PUBLIC_|PUBLIC_)/.test(name) &&
        (/(SERVICE|SECRET|PASSWORD)/i.test(name) || env[name] === env.SUPABASE_SERVICE_KEY)) {
      refuse('A public environment variable contains or names a privileged credential.');
    }
  }
  if (typeof env.SESSION_SECRET !== 'string' || env.SESSION_SECRET.length < 32) {
    refuse('SESSION_SECRET must be configured with at least 32 characters.');
  }
  const host = env.REPLIT_DEV_DOMAIN;
  if (typeof host !== 'string' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.replit\.dev$/.test(host) ||
      env.APP_URL !== `https://${host}` || env.PUBLIC_APP_URL !== `https://${host}`) {
    refuse('APP_URL and PUBLIC_APP_URL must equal this staging Repl development origin.');
  }
  validateStagingAuthConfiguration(env);
}

// Exclude these names BEFORE looking up their values. In particular, never read,
// spread, compare, parse, log, or forward the inherited managed DATABASE_URL.
export function buildApplicationEnvironment(env) {
  const child = {};
  for (const name of Object.keys(env)) {
    if (name === 'DATABASE_URL' || name === 'STAGING_DATABASE_URL' ||
        /^PG/.test(name) || ['NODE_OPTIONS', 'NODE_PATH'].includes(name)) continue;
    if (typeof env[name] === 'string') child[name] = env[name];
  }
  child.DATABASE_URL = env.STAGING_DATABASE_URL;
  child.NODE_ENV = 'development';
  child.CUSTOM_DOMAIN = env.REPLIT_DEV_DOMAIN;
  child.EMAIL_ENABLED = 'false';
  child.ENABLE_EMAIL_VERIFICATION = 'true';
  child.ALLOW_DEMO_MODE = 'false';
  return child;
}
