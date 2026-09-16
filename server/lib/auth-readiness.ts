/**
 * Production-only configuration and schema readiness checks.
 *
 * This module is deliberately side-effect free.  In particular, importing it
 * must never create a client or contact Supabase.  Callers provide the
 * read-only schema/auth probes so this remains useful in unit tests and in
 * deployments which use a different database client.
 */

export type AuthReadinessConfig = {
  appUrl?: string;
  supabaseUrl?: string;
  databaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceKey?: string;
  sessionSecret?: string;
  demoMode?: boolean;
};

export type AuthReadinessProbes = {
  /** Read-only checks for the two public tables. */
  checkTables?: () => Promise<{ users: boolean; profiles: boolean }>;
  /** Observable, non-secret Supabase Auth/email configuration indicator. */
  checkAuthEmail?: () => Promise<boolean>;
};

export type AuthReadinessResult = {
  ready: boolean;
  checks: {
    appUrl: boolean;
    supabaseUrl: boolean;
    databaseConsistency: boolean;
    usersTable: boolean;
    profilesTable: boolean;
    demoModeDisabled: boolean;
    sessionSecret: boolean;
    authEmail: boolean;
  };
  /** Safe diagnostic names only; never includes URLs, connection strings, or keys. */
  failures: string[];
};

function isProductionUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function hasConsistentDatabase(supabaseValue: string | undefined, databaseValue: string | undefined): boolean {
  if (!supabaseValue || !databaseValue) return false;
  try {
    const supabase = new URL(supabaseValue);
    const database = new URL(databaseValue);
    if (!['postgres:', 'postgresql:'].includes(database.protocol)) return false;
    // Supabase's database hostname is db.<project-ref>.supabase.co while its
    // API hostname is <project-ref>.supabase.co. Compare only public host
    // components; credentials and query parameters are never logged or returned.
    const projectRef = supabase.hostname.split('.')[0];
    if (
      !projectRef ||
      supabase.hostname !== `${projectRef}.supabase.co`
    ) return false;
    // Direct database URLs use db.<ref>.supabase.co. Supavisor pooler URLs
    // do not include the ref in their host, but do include it in the
    // postgres.<ref> username.
    const directHostMatch =
      database.hostname === `db.${projectRef}.supabase.co`;
    const poolerHostMatch = /^(?:aws-\d+-[a-z0-9-]+\.)?pooler\.supabase\.com$/i
      .test(database.hostname);
    const poolerUserMatch = poolerHostMatch &&
      decodeURIComponent(database.username) === `postgres.${projectRef}`;
    return directHostMatch || poolerUserMatch;
  } catch {
    return false;
  }
}

function hasSafeSessionSecret(value: string | undefined): boolean {
  if (!value || value.length < 32) return false;
  return ![
    'local-dev-secret-change-in-production',
    'dev-secret-change-in-production',
  ].includes(value);
}

export async function validateProductionAuthReadiness(
  config: AuthReadinessConfig,
  probes: AuthReadinessProbes = {},
): Promise<AuthReadinessResult> {
  const checks = {
    appUrl: isProductionUrl(config.appUrl),
    supabaseUrl: isProductionUrl(config.supabaseUrl),
    databaseConsistency: hasConsistentDatabase(config.supabaseUrl, config.databaseUrl),
    usersTable: false,
    profilesTable: false,
    demoModeDisabled: config.demoMode !== true,
    sessionSecret: hasSafeSessionSecret(config.sessionSecret),
    // Keys establish that the server can use the configured project. The
    // provider/signup state must come from the read-only settings probe below;
    // ENABLE_EMAIL_VERIFICATION is intentionally not consulted because
    // administrator-confirmed signup is a valid production configuration.
    authEmail: Boolean(config.supabaseAnonKey && config.supabaseServiceKey && probes.checkAuthEmail),
  };

  if (probes.checkTables) {
    try {
      const tables = await probes.checkTables();
      checks.usersTable = tables.users === true;
      checks.profilesTable = tables.profiles === true;
    } catch {
      // A failed probe is represented as not ready without leaking database errors.
    }
  }
  if (probes.checkAuthEmail) {
    try {
      checks.authEmail = checks.authEmail && await probes.checkAuthEmail();
    } catch {
      checks.authEmail = false;
    }
  }

  const failures = Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  return { ready: failures.length === 0, checks, failures };
}