/**
 * S22: pure checks over a Supabase Auth settings snapshot (Management API
 * GET /v1/projects/{ref}/config/auth). No I/O, no secrets in the output.
 *
 * These are the settings the app's auth emails depend on. The app routes that
 * produce/consume the links are listed in docs/recovery/s22/auth-email.md.
 */

/** Paths the app actually serves/uses for auth emails (client/src/App.tsx). */
export const AUTH_REDIRECT_PATHS = ['/auth/verify', '/verify-email', '/reset-password'] as const;

export type AuthSettingsSnapshot = Record<string, unknown>;

export interface AuthSettingCheck {
  id: string;
  ok: boolean;
  /** 'warn' checks do not fail the run. */
  severity: 'fail' | 'warn';
  detail: string;
}

function normalize(value: string): string | null {
  try {
    const u = new URL(value.trim());
    u.hash = '';
    u.search = '';
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

function allowList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n,]/) : [];
  return raw.filter((e): e is string => typeof e === 'string').map((e) => e.trim()).filter(Boolean);
}

/** Supabase redirect allow-list matching: exact, `/*` (one segment) or `/**` (any depth). */
export function allowListCovers(entries: string[], target: string): boolean {
  const want = normalize(target);
  if (!want) return false;
  return entries.some((entry) => {
    if (entry.endsWith('/**')) {
      const base = normalize(entry.slice(0, -3));
      return !!base && (want === base || want.startsWith(`${base}/`));
    }
    if (entry.endsWith('/*')) {
      const base = normalize(entry.slice(0, -2));
      return !!base && want.startsWith(`${base}/`) && !want.slice(base.length + 1).includes('/');
    }
    return normalize(entry) === want;
  });
}

export type TemplateFormat = 'token_hash' | 'confirmation_url' | 'unknown';

export function classifyTemplate(content: unknown): TemplateFormat {
  if (typeof content !== 'string' || !content.trim()) return 'unknown';
  if (/\{\{\s*\.TokenHash\s*\}\}/.test(content)) return 'token_hash';
  if (/\{\{\s*\.ConfirmationURL\s*\}\}/.test(content)) return 'confirmation_url';
  return 'unknown';
}

export function checkAuthSettings(
  snapshot: AuthSettingsSnapshot,
  appUrl: string,
  extraAppUrls: string[] = [],
): { ok: boolean; checks: AuthSettingCheck[] } {
  const checks: AuthSettingCheck[] = [];
  const add = (id: string, ok: boolean, detail: string, severity: 'fail' | 'warn' = 'fail') =>
    checks.push({ id, ok, severity, detail });

  const app = normalize(appUrl);
  add('app_url_valid', !!app && appUrl.startsWith('https://'), 'APP_URL must be an https URL');

  add('signups_disabled', snapshot.disable_signup === true,
    'disable_signup must be true: accounts exist only via POST /api/admin/invitations then POST /api/auth/signup');
  add('confirm_email_on', snapshot.mailer_autoconfirm === false,
    'mailer_autoconfirm must be false (Confirm email ON); the server also needs ENABLE_EMAIL_VERIFICATION=true');

  const site = typeof snapshot.site_url === 'string' ? normalize(snapshot.site_url) : null;
  add('site_url_matches_app_url', !!app && site === app, `site_url is ${site ?? 'unset'}, expected ${app ?? 'APP_URL'}`);

  const list = allowList(snapshot.uri_allow_list);
  for (const origin of [appUrl, ...extraAppUrls]) {
    const base = normalize(origin);
    if (!base) {
      add(`redirect_allow_list:${origin}`, false, 'not a valid URL');
      continue;
    }
    for (const path of AUTH_REDIRECT_PATHS) {
      add(`redirect_allow_list:${base}${path}`, allowListCovers(list, `${base}${path}`),
        'must be in Authentication > URL Configuration > Redirect URLs');
    }
  }

  const confirmation = classifyTemplate(snapshot.mailer_templates_confirmation_content);
  const recovery = classifyTemplate(snapshot.mailer_templates_recovery_content);
  add('confirmation_template_token_hash', confirmation === 'token_hash',
    `confirmation template format: ${confirmation} (token_hash recommended: scanner-proof; confirmation_url works only via the fragment flow)`, 'warn');
  add('recovery_template_token_hash', recovery === 'token_hash',
    `recovery template format: ${recovery} (token_hash recommended; confirmation_url works only via the fragment flow)`, 'warn');

  if (typeof snapshot.rate_limit_email_sent === 'number') {
    add('email_rate_limit_known', true, `rate_limit_email_sent=${snapshot.rate_limit_email_sent}/hour`, 'warn');
  }
  return { ok: checks.every((c) => c.ok || c.severity === 'warn'), checks };
}

/** Manual checklist printed when no management token is available. */
export function authSettingsChecklist(appUrl: string, extraAppUrls: string[] = []): string[] {
  const origins = [appUrl, ...extraAppUrls];
  return [
    'Authentication > Providers > Email: enabled; "Confirm email" ON; "Allow new users to sign up" OFF (disable_signup=true)',
    `Authentication > URL Configuration > Site URL = ${appUrl}`,
    ...origins.flatMap((o) => AUTH_REDIRECT_PATHS.map((p) => `Authentication > URL Configuration > Redirect URLs contains ${o.replace(/\/+$/, '')}${p}`)),
    'Authentication > Emails > SMTP Settings: custom SMTP enabled (host, port, user, password, sender)',
    'Authentication > Emails > Templates (Confirm signup): link = {{ .SiteURL }}/auth/verify?token_hash={{ .TokenHash }}&type=signup',
    'Authentication > Emails > Templates (Reset password): link = {{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery',
    'Server env: APP_URL, ENABLE_EMAIL_VERIFICATION=true, AUTH_EMAIL_MODE=custom_smtp',
  ];
}
