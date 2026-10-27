import { checkSupabaseAuthConfig, type SupabaseAuthConfigSnapshot } from '../server/lib/supabase-auth-config-check';
import { checkAuthSettings, authSettingsChecklist } from './s22/auth-config-checks';
import { assertStagingTarget, StagingGuardError } from './s22/lib/staging-guard';

// Modes:
//   (default)  inspects the canonical production project (unchanged behaviour)
//   --staging  inspects the S22 staging project named by S22_STAGING_PROJECT_REF
//              (guarded by assertStagingTarget; refuses production refs/origins)
// EXTRA_APP_URLS (comma separated) adds origins whose redirect URLs must also be
// allow-listed, e.g. EXTRA_APP_URLS=https://lumiereportal.app for production.

const CANONICAL_PROJECT_REF = 'rheronevecsffaejteoj';

async function main() {
  const appUrl = process.env.APP_URL?.trim();
  const staging = process.argv.includes('--staging');
  const extraAppUrls = (process.env.EXTRA_APP_URLS ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  let projectRef: string;
  if (staging) {
    try {
      projectRef = assertStagingTarget({ requireAppUrl: true }).ref;
    } catch (error) {
      console.error(`[auth-config] ${error instanceof StagingGuardError ? error.message : 'staging guard failed'}`);
      process.exitCode = 1;
      return;
    }
  } else {
    projectRef = process.env.SUPABASE_PROJECT_REF?.trim() || CANONICAL_PROJECT_REF;
  }
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();

  if (!appUrl) {
    console.error('[auth-config] APP_URL is required');
    process.exitCode = 1;
    return;
  }

  if (!staging && projectRef !== CANONICAL_PROJECT_REF) {
    console.error('[auth-config] Refusing to inspect a non-canonical Supabase project');
    process.exitCode = 1;
    return;
  }

  if (!accessToken) {
    // No management token: nothing was verified. Print what the owner must check by hand.
    console.log(JSON.stringify({
      ok: null,
      status: 'NOT RUN: SUPABASE_ACCESS_TOKEN not set; verify these manually in the Supabase dashboard',
      checklist: authSettingsChecklist(appUrl, extraAppUrls),
    }, null, 2));
    process.exitCode = 2;
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
  const settings = checkAuthSettings(snapshot as Record<string, unknown>, appUrl, extraAppUrls);

  console.log(JSON.stringify({
    ok: result.ok && settings.ok,
    mode: staging ? 'staging' : 'canonical',
    authSettings: settings.checks,
    checks: {
      siteUrlMatch: result.siteUrlMatch,
      resetRedirectPresent: result.resetRedirectPresent,
      publicSignupDisabled: result.publicSignupDisabled,
      smtpMode: result.smtpMode,
    },
    smtp: {
      ...(result.smtpHost ? { host: result.smtpHost } : {}),
      ...(result.smtpSenderEmail ? { senderEmail: result.smtpSenderEmail } : {}),
      ...(result.smtpSenderName ? { senderName: result.smtpSenderName } : {}),
    },
    failures: result.failures,
  }, null, 2));

  if (!result.ok || !settings.ok) process.exitCode = 1;
}

main().catch(() => {
  console.error('[auth-config] Unexpected verifier failure');
  process.exitCode = 1;
});
