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