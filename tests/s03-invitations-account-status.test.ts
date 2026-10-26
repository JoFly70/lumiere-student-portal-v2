import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<[string, unknown[]]> = [];
const result = vi.hoisted(() => ({ value: { data: null as unknown, error: null as unknown } }));

function chain(): any {
  const proxy: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') return undefined;
        if (prop === 'maybeSingle' || prop === 'single') {
          return () => Promise.resolve(result.value);
        }
        return (...args: unknown[]) => {
          calls.push([prop, args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

vi.mock('../server/lib/supabase.js', () => ({
  supabaseAdmin: { from: (table: string) => { calls.push(['from', [table]]); return chain(); } },
}));
vi.mock('../server/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  claimInvitation,
  createInvitation,
  hashInvitationToken,
  normalizeInvitationEmail,
} from '../server/lib/invitations';
import { getAccountStatus, isAccountActive } from '../server/lib/account-status';

beforeEach(() => {
  calls.length = 0;
  result.value = { data: null, error: null };
});

describe('invitations', () => {
  it('stores only a hash of a high-entropy token and binds the invitation to a normalized email', async () => {
    result.value = { data: { id: 'i1', email: 'a@b.co', expires_at: 'x' }, error: null };
    const inv = await createInvitation({ email: '  A@B.co ', createdBy: 'admin-1' });

    expect(inv.token.length).toBeGreaterThanOrEqual(40);
    const insert = calls.find(([m]) => m === 'insert')![1][0] as Record<string, unknown>;
    expect(insert.email).toBe('a@b.co');
    expect(insert.role).toBe('student');
    expect(insert.token_hash).toBe(hashInvitationToken(inv.token));
    expect(JSON.stringify(insert)).not.toContain(inv.token);
  });

  it('claims only unconsumed, unrevoked, unexpired invitations for the same email', async () => {
    result.value = { data: { id: 'i1' }, error: null };
    await expect(claimInvitation('tok', 'User@X.com')).resolves.toBe('i1');

    expect(calls).toContainEqual(['eq', ['token_hash', hashInvitationToken('tok')]]);
    expect(calls).toContainEqual(['eq', ['email', 'user@x.com']]);
    expect(calls).toContainEqual(['is', ['consumed_at', null]]);
    expect(calls).toContainEqual(['is', ['revoked_at', null]]);
    expect(calls.some(([m, a]) => m === 'gt' && a[0] === 'expires_at')).toBe(true);
  });

  it('returns null when no invitation matches', async () => {
    await expect(claimInvitation('tok', 'u@x.com')).resolves.toBeNull();
    await expect(claimInvitation('', 'u@x.com')).resolves.toBeNull();
  });

  it('normalizes email', () => {
    expect(normalizeInvitationEmail(' Foo@Bar.COM ')).toBe('foo@bar.com');
  });
});

describe('account status', () => {
  it('is active only for an existing profile with status active', async () => {
    result.value = { data: { status: 'active' }, error: null };
    await expect(isAccountActive('u')).resolves.toBe(true);
  });

  it.each([
    [{ data: { status: 'archived' }, error: null }, 'archived'],
    [{ data: { status: 'inactive' }, error: null }, 'inactive'],
    [{ data: { status: 'pending' }, error: null }, 'pending'],
    [{ data: null, error: null }, 'missing'],
    [{ data: null, error: { message: 'db down' } }, 'unknown'],
    [{ data: { status: 'weird' }, error: null }, 'unknown'],
  ])('fails closed for %j', async (value, expected) => {
    result.value = value as any;
    await expect(getAccountStatus('u')).resolves.toBe(expected);
    await expect(isAccountActive('u')).resolves.toBe(false);
  });
});
