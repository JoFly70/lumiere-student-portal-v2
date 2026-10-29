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

  // Add CSRF token for state-changing requests
  const stateMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
  if (stateMethods.includes(options.method?.toUpperCase() || 'GET')) {
    const csrf = getCsrfToken();
    if (csrf) {
      headers.set('X-CSRF-Token', csrf);
    }
  }

  // Add content type for JSON requests
  if (options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    if (token && isSessionExpiredResponse(response.status, error?.error)) notifySessionExpired();
    throw new ApiError(
      error.error || `HTTP ${response.status}: ${response.statusText}`,
      response.status,
      typeof error.code === 'string' ? error.code : undefined,
      error.details,
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
