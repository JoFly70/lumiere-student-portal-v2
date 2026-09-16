export type SupabaseAuthConfigSnapshot = {
  site_url?: unknown;
  uri_allow_list?: unknown;
  smtp_admin_email?: unknown;
  smtp_host?: unknown;
  smtp_port?: unknown;
  smtp_user?: unknown;
  smtp_sender_name?: unknown;
  smtp_pass?: unknown;
  [key: string]: unknown;
};

export type SupabaseAuthConfigCheck = {
  ok: boolean;
  siteUrlMatch: boolean;
  resetRedirectPresent: boolean;
  smtpMode: 'custom_smtp' | 'supabase_default';
  smtpHost?: string;
  smtpSenderEmail?: string;
  smtpSenderName?: string;
  failures: string[];
};

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    url.hash = '';
    url.search = '';
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

function parseAllowList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,]/)
      : [];

  return raw
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function checkSupabaseAuthConfig(
  config: SupabaseAuthConfigSnapshot,
  appUrl: string,
): SupabaseAuthConfigCheck {
  const expectedAppUrl = normalizeUrl(appUrl);
  const configuredSiteUrl = normalizeUrl(asNonEmptyString(config.site_url));
  const expectedResetUrl = expectedAppUrl
    ? `${expectedAppUrl}/reset-password`
    : null;

  const allowList = parseAllowList(config.uri_allow_list)
    .map((entry) => normalizeUrl(entry))
    .filter((entry): entry is string => Boolean(entry));

  const smtpHost = asNonEmptyString(config.smtp_host);
  const smtpSenderEmail = asNonEmptyString(config.smtp_admin_email);
  const smtpSenderName = asNonEmptyString(config.smtp_sender_name);
  const smtpPortPresent =
    (typeof config.smtp_port === 'number' && Number.isFinite(config.smtp_port)) ||
    (typeof config.smtp_port === 'string' && config.smtp_port.trim().length > 0);

  const smtpMode: 'custom_smtp' | 'supabase_default' =
    smtpHost && smtpSenderEmail && smtpPortPresent
      ? 'custom_smtp'
      : 'supabase_default';

  const siteUrlMatch = Boolean(
    expectedAppUrl &&
    configuredSiteUrl &&
    expectedAppUrl === configuredSiteUrl,
  );
  const resetRedirectPresent = Boolean(
    expectedResetUrl && allowList.includes(expectedResetUrl),
  );

  const failures: string[] = [];
  if (!siteUrlMatch) failures.push('siteUrl');
  if (!resetRedirectPresent) failures.push('resetRedirect');
  if (smtpMode !== 'custom_smtp') failures.push('customSmtp');

  return {
    ok: failures.length === 0,
    siteUrlMatch,
    resetRedirectPresent,
    smtpMode,
    ...(smtpHost ? { smtpHost } : {}),
    ...(smtpSenderEmail ? { smtpSenderEmail } : {}),
    ...(smtpSenderName ? { smtpSenderName } : {}),
    failures,
  };
}
