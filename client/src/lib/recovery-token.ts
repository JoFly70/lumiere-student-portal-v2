/**
 * Reads the access token format emitted by Supabase password recovery links.
 *
 * Supabase places the token in the URL fragment. Query-string access tokens
 * are intentionally not accepted because they are more readily leaked.
 */
export function extractRecoveryToken(url: string): string | null {
  const parsedUrl = new URL(url, 'http://localhost');
  const hashParams = new URLSearchParams(parsedUrl.hash.slice(1));
  if (hashParams.get('type') !== 'recovery') {
    return null;
  }

  const token = hashParams.get('access_token');
  return token || null;
}

export type RecoveryLink =
  | { kind: 'access_token'; accessToken: string }
  | { kind: 'token_hash'; tokenHash: string }
  | { kind: 'error'; reason: 'expired' | 'invalid' }
  /** PKCE `?code=` or bare `?token=`: cannot be exchanged (no browser verifier). */
  | { kind: 'unsupported' }
  | { kind: 'none' };

const TOKEN_HASH_RE = /^[A-Za-z0-9_-]{8,256}$/;

/**
 * Classifies a /reset-password URL. Supported: fragment access_token with
 * type=recovery (Supabase ConfirmationURL, implicit flow) and
 * `token_hash` + type=recovery (custom email template; exchanged server-side
 * only when the new password is submitted, so link scanners cannot consume it).
 */
export function parseRecoveryLink(url: string): RecoveryLink {
  const parsedUrl = new URL(url, 'http://localhost');
  const hash = new URLSearchParams(parsedUrl.hash.slice(1));
  const query = parsedUrl.searchParams;
  const get = (key: string) => hash.get(key) || query.get(key) || null;

  if (get('error') || get('error_code')) {
    const text = `${get('error_code') ?? ''} ${get('error_description') ?? ''}`.toLowerCase();
    return { kind: 'error', reason: text.includes('expired') ? 'expired' : 'invalid' };
  }
  const accessToken = extractRecoveryToken(url);
  if (accessToken) return { kind: 'access_token', accessToken };

  const tokenHash = get('token_hash');
  if (tokenHash) {
    return get('type') === 'recovery' && TOKEN_HASH_RE.test(tokenHash)
      ? { kind: 'token_hash', tokenHash }
      : { kind: 'error', reason: 'invalid' };
  }
  if (get('code') || get('token')) return { kind: 'unsupported' };
  return { kind: 'none' };
}

/**
 * Removes credential parameters from both URL components while retaining
 * unrelated query and fragment parameters.
 */
export function recoveryUrlWithoutCredentials(url: string): string {
  const parsedUrl = new URL(url, 'http://localhost');
  const credentialKeys = new Set([
    'access_token',
    'refresh_token',
    'token',
    'token_hash',
    'code',
    'type',
    'expires_at',
    'expires_in',
    'token_type',
    'error',
    'error_code',
    'error_description',
  ]);
  const scrub = (value: string) => {
    const params = new URLSearchParams(value);
    for (const key of credentialKeys) {
      params.delete(key);
    }
    return params.toString();
  };

  const query = scrub(parsedUrl.search.slice(1));
  const hash = scrub(parsedUrl.hash.slice(1));
  return `${parsedUrl.pathname}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`;
}