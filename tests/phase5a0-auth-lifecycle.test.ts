import { afterEach, describe, expect, it } from 'vitest';
import { getAuthToken, getCsrfToken, setAuthToken, setCsrfToken } from '../client/src/lib/api';
import {
  isRestorableAuthState,
  publishAuthLifecycle,
  type AuthLifecycleSession,
  type AuthLifecycleUser,
} from '../client/src/lib/auth-lifecycle';
import { queryClient } from '../client/src/lib/queryClient';

const userA: AuthLifecycleUser = { id: 'user-a' };
const userB: AuthLifecycleUser = { id: 'user-b' };
const sessionA: AuthLifecycleSession = {
  access_token: 'access-a',
  csrf_token: 'csrf-a',
};
const sessionB: AuthLifecycleSession = {
  access_token: 'access-b',
  csrf_token: 'csrf-b',
};

afterEach(() => {
  queryClient.clear();
  setAuthToken(null);
  setCsrfToken(null);
});

describe('Phase 5A.0 auth lifecycle', () => {
  it('accepts the successful auto-login signup persisted shape without requiring role', () => {
    const storedSignup = {
      user: {
        id: 'user-a',
        email: 'ada@example.com',
        name: 'Ada',
      },
      session: {
        access_token: 'access-a',
        refresh_token: 'refresh-a',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        csrf_token: 'csrf-a',
      },
    };
    const observations: Array<{
      accessToken: string | null;
      csrfToken: string | null;
      cachedData: unknown;
    }> = [];

    expect(isRestorableAuthState(storedSignup)).toBe(true);
    queryClient.setQueryData(['/api/me'], { stale: true });
    publishAuthLifecycle(null, storedSignup.user, storedSignup.session, () => {
      observations.push({
        accessToken: getAuthToken(),
        csrfToken: getCsrfToken(),
        cachedData: queryClient.getQueryData(['/api/me']),
      });
    });

    expect(observations).toEqual([
      { accessToken: 'access-a', csrfToken: 'csrf-a', cachedData: undefined },
    ]);
  });

  it.each([
    ['stored-session restore', null, userA, sessionA],
    ['fresh login', null, userA, sessionA],
    ['successful auto-login signup', null, userA, sessionA],
  ])(
    '%s publishes only after access and CSRF tokens are synchronized',
    (_operation, previousIdentity, nextUser, nextSession) => {
      const observations: Array<{
        accessToken: string | null;
        csrfToken: string | null;
      }> = [];

      publishAuthLifecycle(previousIdentity, nextUser, nextSession, () => {
        observations.push({
          accessToken: getAuthToken(),
          csrfToken: getCsrfToken(),
        });
      });

      expect(observations).toEqual([
        { accessToken: nextSession.access_token, csrfToken: nextSession.csrf_token },
      ]);
    },
  );

  it('clears singleton cached data before publishing whenever identity changes', () => {
    queryClient.setQueryData(['/api/me'], { owner: 'user-a' });
    const observations: Array<unknown> = [];

    const nextIdentity = publishAuthLifecycle('user-a', userB, sessionB, () => {
      observations.push(queryClient.getQueryData(['/api/me']));
    });

    expect(nextIdentity).toBe('user-b');
    expect(observations).toEqual([undefined]);
    expect(queryClient.getQueryData(['/api/me'])).toBeUndefined();
  });

  it.each([
    ['login/restore', null, userA, sessionA],
    ['logout', 'user-a', null, null],
  ])('%s clears cache across null/identity transitions', (
    _operation,
    previousIdentity,
    nextUser,
    nextSession,
  ) => {
    queryClient.setQueryData(['/api/me'], { stale: true });
    const observations: Array<unknown> = [];

    publishAuthLifecycle(previousIdentity, nextUser, nextSession, () => {
      observations.push(queryClient.getQueryData(['/api/me']));
    });

    expect(observations).toEqual([undefined]);
    expect(queryClient.getQueryData(['/api/me'])).toBeUndefined();
  });

  it('retains cache for same-identity session updates', () => {
    queryClient.setQueryData(['/api/me'], { owner: 'user-a' });

    publishAuthLifecycle('user-a', userA, sessionB, () => {});

    expect(queryClient.getQueryData(['/api/me'])).toEqual({ owner: 'user-a' });
  });

  it('clears tokens before publishing logout state', () => {
    setAuthToken(sessionA.access_token);
    setCsrfToken(sessionA.csrf_token);
    const observations: Array<{
      accessToken: string | null;
      csrfToken: string | null;
    }> = [];

    publishAuthLifecycle('user-a', null, null, () => {
      observations.push({
        accessToken: getAuthToken(),
        csrfToken: getCsrfToken(),
      });
    });

    expect(observations).toEqual([{ accessToken: null, csrfToken: null }]);
  });
});