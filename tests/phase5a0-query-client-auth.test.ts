import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuthToken, setAuthToken } from '../client/src/lib/api';
import { apiRequest, getQueryFn, queryClient } from '../client/src/lib/queryClient';

type SessionStorageShim = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
};

function createSessionStorageShim(): SessionStorageShim {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
}

function okResponse(body: unknown = {}) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(''),
  } as unknown as Response;
}

const defaultQueryCallsites = [
  {
    sourceFile: 'client/src/pages/admin.tsx',
    callsite: 'analytics/dashboard',
    queryKey: ['/api/admin/analytics/dashboard'],
  },
  {
    sourceFile: 'client/src/pages/admin.tsx',
    callsite: 'users object key',
    queryKey: ['/api/admin/users', { search: 'Ada', role: 'admin' }],
  },
  {
    sourceFile: 'client/src/pages/admin.tsx',
    callsite: 'students object key',
    queryKey: ['/api/admin/students', { search: 'Ada', status: 'active' }],
  },
  {
    sourceFile: 'client/src/pages/admin.tsx',
    callsite: 'audit logs object key',
    queryKey: ['/api/admin/audit-logs', { limit: 100 }],
  },
  {
    sourceFile: 'client/src/pages/dashboard.tsx',
    callsite: 'system/check',
    queryKey: ['/api/system/check'],
  },
  {
    sourceFile: 'client/src/pages/dashboard.tsx',
    callsite: 'me',
    queryKey: ['/api/me'],
  },
  {
    sourceFile: 'client/src/pages/dashboard.tsx',
    callsite: 'degree-templates',
    queryKey: ['/api/degree-templates'],
  },
  {
    sourceFile: 'client/src/pages/dashboard.tsx',
    callsite: 'plans+planId',
    queryKey: ['/api/plans', 'plan-123'],
  },
  {
    sourceFile: 'client/src/pages/flight-deck.tsx',
    callsite: 'flight-deck',
    queryKey: ['/api/flight-deck'],
  },
  {
    sourceFile: 'client/src/pages/roadmap.tsx',
    callsite: 'enrollments',
    queryKey: ['/api/enrollments'],
  },
  {
    sourceFile: 'client/src/components/course-assignment-dialog.tsx',
    callsite: 'templates',
    queryKey: ['/api/templates'],
  },
] as const;

describe('Phase 5A.0 query client authentication', () => {
  const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: createSessionStorageShim(),
    });
    fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    setAuthToken(null);
  });

  afterEach(() => {
    setAuthToken(null);
    vi.unstubAllGlobals();
    if (originalSessionStorage) {
      Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
    } else {
      delete (globalThis as { sessionStorage?: SessionStorageShim }).sessionStorage;
    }
  });

  it('uses the current auth token for the representative Admin Students query', async () => {
    sessionStorage.setItem('sb_access_token', 'stale-session-token');
    setAuthToken('current-token');

    const queryFn = getQueryFn({ on401: 'throw' });
    await queryFn({
      queryKey: ['/api/admin/students', { search: 'Ada', status: 'active' }],
    } as any);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0];
    expect(requestInit.headers).toEqual({ Authorization: 'Bearer current-token' });
    expect(requestInit.credentials).toBe('include');
  });

  it('uses the current auth token for generic apiRequest and preserves request semantics', async () => {
    sessionStorage.setItem('sb_access_token', 'stale-session-token');
    setAuthToken('current-token');

    await apiRequest('POST', '/api/example', { name: 'Ada' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/example', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer current-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Ada' }),
      credentials: 'include',
    });
  });

  it('covers every live default-query callsite through the singleton queryClient', async () => {
    expect(defaultQueryCallsites).toHaveLength(11);
    expect(defaultQueryCallsites.map(({ sourceFile }) => sourceFile)).toEqual([
      'client/src/pages/admin.tsx',
      'client/src/pages/admin.tsx',
      'client/src/pages/admin.tsx',
      'client/src/pages/admin.tsx',
      'client/src/pages/dashboard.tsx',
      'client/src/pages/dashboard.tsx',
      'client/src/pages/dashboard.tsx',
      'client/src/pages/dashboard.tsx',
      'client/src/pages/flight-deck.tsx',
      'client/src/pages/roadmap.tsx',
      'client/src/components/course-assignment-dialog.tsx',
    ]);
    expect(defaultQueryCallsites.map(({ callsite }) => callsite)).toEqual([
      'analytics/dashboard',
      'users object key',
      'students object key',
      'audit logs object key',
      'system/check',
      'me',
      'degree-templates',
      'plans+planId',
      'flight-deck',
      'enrollments',
      'templates',
    ]);

    for (const site of defaultQueryCallsites) {
      queryClient.clear();
      fetchMock.mockReset().mockResolvedValue(okResponse({ callsite: site.callsite }));
      sessionStorage.setItem('sb_access_token', 'stale-session-token');
      setAuthToken('current-token');

      await queryClient.fetchQuery({ queryKey: site.queryKey });

      expect(fetchMock, `${site.sourceFile} ${site.callsite}`).toHaveBeenCalledTimes(1);
      const [, requestInit] = fetchMock.mock.calls[0];
      expect(requestInit.headers, `${site.sourceFile} ${site.callsite}`).toEqual({
        Authorization: 'Bearer current-token',
      });
      expect(requestInit.credentials, `${site.sourceFile} ${site.callsite}`).toBe('include');
    }
  });

  it('does not send an Authorization header when the current auth token is null', async () => {
    sessionStorage.setItem('sb_access_token', 'stale-session-token');
    setAuthToken(null);

    const queryFn = getQueryFn({ on401: 'throw' });
    await queryFn({ queryKey: ['/api/example'] } as any);
    await apiRequest('GET', '/api/example');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({});
    expect(fetchMock.mock.calls[1][1].headers).toEqual({});
  });

  it('reads token changes at request time rather than import time', async () => {
    setAuthToken('first-token');
    await apiRequest('GET', '/api/first');

    setAuthToken('second-token');
    const queryFn = getQueryFn({ on401: 'throw' });
    await queryFn({ queryKey: ['/api/second'] } as any);

    expect(getAuthToken()).toBe('second-token');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      Authorization: 'Bearer first-token',
    });
    expect(fetchMock.mock.calls[1][1].headers).toEqual({
      Authorization: 'Bearer second-token',
    });
  });
});