// Authenticated API client utility
import { isSessionExpiredResponse, notifySessionExpired } from './session-expiry';

let authToken: string | null = null;
let csrfToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

/** CSRF tokens are `<expiresAtMs>.<nonce>.<signature>` and live one hour; renew 5 minutes before expiry. */
const CSRF_RENEW_MARGIN_MS = 5 * 60_000;
let csrfRenewal: Promise<string | null> | null = null;

export function csrfTokenExpiresAt(token: string | null): number | null {
  const ms = Number(token?.split('.')[0]);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/**
 * The CSRF token for a state-changing request, renewed first when it is missing or about to expire.
 * The token is issued at sign-in and was never renewed with the session, so after an hour every write
 * failed with 403. Concurrent callers share one renewal; on failure the current token is returned.
 */
export async function freshCsrfToken(force = false): Promise<string | null> {
  if (!authToken) return csrfToken;
  const expiresAt = csrfTokenExpiresAt(csrfToken);
  // Keep a token with time left, or one whose expiry cannot be read (not issued by this server's format).
  if (!force && csrfToken && (expiresAt === null || expiresAt - Date.now() > CSRF_RENEW_MARGIN_MS)) return csrfToken;
  if (!csrfRenewal) {
    const bearer = authToken;
    csrfRenewal = (async () => {
      try {
        const res = await fetch('/api/csrf-token', { headers: { Authorization: `Bearer ${bearer}` } });
        if (!res.ok) return csrfToken;
        const body = await res.json().catch(() => null);
        if (typeof body?.csrfToken === 'string' && authToken === bearer) csrfToken = body.csrfToken;
        return csrfToken;
      } catch {
        return csrfToken;
      } finally {
        csrfRenewal = null;
      }
    })();
  }
  return csrfRenewal;
}

const isCsrfRejection = (status: number, body: any): boolean => {
  if (status !== 403) return false;
  const code = body?.code ?? (body?.error && typeof body.error === 'object' ? body.error.code : undefined);
  return code === 'CSRF_TOKEN_INVALID' || code === 'CSRF_TOKEN_MISSING';
};

/** Error thrown for non-2xx responses; keeps the machine-readable `code` and `details` the API sends. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiRequest<T = any>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);

  // Add auth token if available
  const token = getAuthToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Add CSRF token for state-changing requests (renewed before it expires)
  const stateMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
  const stateChanging = stateMethods.includes(options.method?.toUpperCase() || 'GET');
  if (stateChanging) {
    const csrf = await freshCsrfToken();
    if (csrf) {
      headers.set('X-CSRF-Token', csrf);
    }
  }

  // Add content type for JSON requests
  if (options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  let response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let error = await response.json().catch(() => ({ error: 'Request failed' }));
    // A rejected CSRF token (expired or rotated): renew it once and repeat the request.
    if (stateChanging && token && isCsrfRejection(response.status, error)) {
      const renewed = await freshCsrfToken(true);
      if (renewed) {
        headers.set('X-CSRF-Token', renewed);
        response = await fetch(url, { ...options, headers });
        if (response.ok) return response.status === 204 ? (undefined as T) : response.json();
        error = await response.json().catch(() => ({ error: 'Request failed' }));
      }
    }
    // Most routes answer { error: "message", code }; newer ones answer { error: { code, message, details } }.
    const nested = error?.error && typeof error.error === 'object' ? error.error : null;
    const message = nested ? nested.message : error?.error;
    const code = nested ? nested.code : error?.code;
    if (token && isSessionExpiredResponse(response.status, typeof message === 'string' ? message : undefined)) notifySessionExpired();
    throw new ApiError(
      typeof message === 'string' && message ? message : `HTTP ${response.status}: ${response.statusText}`,
      response.status,
      typeof code === 'string' ? code : undefined,
      nested ? nested.details : error.details,
    );
  }

  // 204 No Content (e.g. DELETE) has no JSON body.
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// Convenience methods
export const api = {
  get: <T = any>(url: string) => apiRequest<T>(url, { method: 'GET' }),

  post: <T = any>(url: string, data?: any) =>
    apiRequest<T>(url, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T = any>(url: string, data?: any) =>
    apiRequest<T>(url, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T = any>(url: string) =>
    apiRequest<T>(url, { method: 'DELETE' }),
};
