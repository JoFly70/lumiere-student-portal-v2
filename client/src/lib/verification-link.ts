/**
 * Reads an email-verification link (Supabase). A token in the URL is only a
 * claim: the caller must have the server confirm it. Credentials are never
 * returned in error results and the URL scrub removes them from history.
 */
export type VerificationLink =
  | { kind: 'credential'; accessToken?: string; tokenHash?: string; type?: string }
  | { kind: 'error'; reason: 'expired' | 'invalid' | 'unsupported' }
  | { kind: 'missing' };

const SENSITIVE_KEYS = [
  'access_token', 'refresh_token', 'token', 'token_hash', 'code', 'type',
  'expires_at', 'expires_in', 'token_type', 'provider_token',
  'error', 'error_code', 'error_description',
];

export function parseVerificationLink(url: string): VerificationLink {
  const parsed = new URL(url, 'http://localhost');
  const hash = new URLSearchParams(parsed.hash.slice(1));
  const query = parsed.searchParams;
  const get = (key: string) => hash.get(key) || query.get(key) || null;

  const errorCode = get('error_code');
  const error = get('error');
  if (errorCode || error) {
    const text = `${errorCode ?? ''} ${get('error_description') ?? ''}`.toLowerCase();
    return { kind: 'error', reason: text.includes('expired') ? 'expired' : 'invalid' };
  }

  const type = get('type') || undefined;
  if (type === 'recovery') return { kind: 'error', reason: 'invalid' };

  const tokenHash = get('token_hash');
  if (tokenHash) return { kind: 'credential', tokenHash, type: type ?? 'signup' };

  const accessToken = hash.get('access_token') || null; // fragment only
  if (accessToken) return { kind: 'credential', accessToken, type };

  // PKCE `code` or bare `token` cannot be verified: the app's server creates
  // the user, so no browser holds a code verifier. Say so, so the UI can point
  // the student at a fresh token_hash link instead of a generic "invalid".
  if (get('code') || get('token')) return { kind: 'error', reason: 'unsupported' };
  return { kind: 'missing' };
}

export function verificationUrlWithoutCredentials(url: string): string {
  const parsed = new URL(url, 'http://localhost');
  const scrub = (value: string) => {
    const params = new URLSearchParams(value);
    for (const key of SENSITIVE_KEYS) params.delete(key);
    return params.toString();
  };
  const query = scrub(parsed.search.slice(1));
  const hash = scrub(parsed.hash.slice(1));
  return `${parsed.pathname}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`;
}
