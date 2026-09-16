import { setAuthToken, setCsrfToken } from './api';
import { queryClient } from './queryClient';

export interface AuthLifecycleUser {
  id: string;
}

export interface AuthLifecycleSession {
  access_token: string;
  csrf_token?: string;
}

export interface RestorableAuthUser extends AuthLifecycleUser {
  email: string;
  name: string;
  role?: string;
}

export interface RestorableAuthSession extends AuthLifecycleSession {
  refresh_token?: string | null;
  expires_at: number;
}

export interface RestorableAuthState {
  user: RestorableAuthUser;
  session: RestorableAuthSession;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isRestorableAuthState(value: unknown): value is RestorableAuthState {
  if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.session)) {
    return false;
  }

  return (
    typeof value.user.id === 'string' &&
    typeof value.user.email === 'string' &&
    typeof value.user.name === 'string' &&
    typeof value.session.access_token === 'string' &&
    value.session.access_token.length > 0 &&
    typeof value.session.expires_at === 'number' &&
    Number.isFinite(value.session.expires_at) &&
    value.session.expires_at > Math.floor(Date.now() / 1000)
  );
}

/**
 * Synchronize API credentials and the singleton cache before exposing auth state.
 */
export function publishAuthLifecycle(
  previousIdentity: string | null,
  nextUser: AuthLifecycleUser | null,
  nextSession: AuthLifecycleSession | null,
  publish: () => void,
): string | null {
  const nextIdentity = nextUser?.id ?? null;

  setAuthToken(nextSession?.access_token ?? null);
  setCsrfToken(nextSession?.csrf_token ?? null);

  if (previousIdentity !== nextIdentity) {
    queryClient.clear();
  }

  publish();
  return nextIdentity;
}