import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuthToken, setAuthToken } from '../client/src/lib/api';
import { apiRequest, getQueryFn } from '../client/src/lib/queryClient';

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