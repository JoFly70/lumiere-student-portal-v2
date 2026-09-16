import { checkSupabaseAuthConfig, type SupabaseAuthConfigSnapshot } from '../server/lib/supabase-auth-config-check';

const CANONICAL_PROJECT_REF = 'rheronevecsffaejteoj';

async function main() {
  const appUrl = process.env.APP_URL?.trim();
  const requestedProjectRef = process.env.SUPABASE_PROJECT_REF?.trim();
  const projectRef = requestedProjectRef || CANONICAL_PROJECT_REF;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();

  if (!appUrl) {
    console.error('[auth-config] APP_URL is required');
    process.exitCode = 1;
    return;
  }

  if (projectRef !== CANONICAL_PROJECT_REF) {
    console.error('[auth-config] Refusing to inspect a non-canonical Supabase project');
    process.exitCode = 1;
    return;
  }

  if (!accessToken) {
    console.error('[auth-config] SUPABASE_ACCESS_TOKEN is required');
    process.exitCode = 1;
    return;
  }

  let response: Response;
  try {
    response = await fetch(
      `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/config/auth`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      },
    );
  } catch {
    console.error('[auth-config] Supabase Management API request failed');
    process.exitCode = 1;
    return;
  }

  if (!response.ok) {
    console.error(`[auth-config] Supabase Management API returned HTTP ${response.status}`);
    process.exitCode = 1;
    return;
  }

  let snapshot: SupabaseAuthConfigSnapshot;
  try {
    snapshot = await response.json() as SupabaseAuthConfigSnapshot;
  } catch {
    console.error('[auth-config] Supabase Management API returned invalid JSON');
    process.exitCode = 1;
    return;
  }

  const result = checkSupabaseAuthConfig(snapshot, appUrl);

  console.log(JSON.stringify({
    ok: result.ok,
    checks: {
      siteUrlMatch: result.siteUrlMatch,
      resetRedirectPresent: result.resetRedirectPresent,
      smtpMode: result.smtpMode,
    },
    smtp: {
      ...(result.smtpHost ? { host: result.smtpHost } : {}),
      ...(result.smtpSenderEmail ? { senderEmail: result.smtpSenderEmail } : {}),
      ...(result.smtpSenderName ? { senderName: result.smtpSenderName } : {}),
    },
    failures: result.failures,
  }, null, 2));

  if (!result.ok) process.exitCode = 1;
}

main().catch(() => {
  console.error('[auth-config] Unexpected verifier failure');
  process.exitCode = 1;
});
