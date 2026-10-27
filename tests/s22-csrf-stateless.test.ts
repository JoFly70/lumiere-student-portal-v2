import { afterEach, describe, expect, it, vi } from 'vitest';

async function freshModule(secret: string | undefined) {
  vi.resetModules();
  if (secret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = secret;
  return import('../server/middleware/csrf');
}

describe('S22 stateless CSRF tokens (multi-instance Autoscale)', () => {
  const original = process.env.SESSION_SECRET;
  afterEach(() => {
    vi.useRealTimers();
    if (original === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = original;
  });

  it('a token minted on one instance verifies on another with the same SESSION_SECRET', async () => {
    const a = await freshModule('x'.repeat(40));
    const token = a.generateCsrfToken('user-1');
    const b = await freshModule('x'.repeat(40));
    expect(b.verifyCsrfToken('user-1', token)).toBe(true);
  });

  it('rejects another user, another secret, tampering, garbage and expiry', async () => {
    const m = await freshModule('y'.repeat(40));
    const token = m.generateCsrfToken('user-1');
    expect(m.verifyCsrfToken('user-2', token)).toBe(false);
    const [exp, nonce, mac] = token.split('.');
    expect(m.verifyCsrfToken('user-1', `${Number(exp) + 1000}.${nonce}.${mac}`)).toBe(false);
    expect(m.verifyCsrfToken('user-1', `${exp}.${nonce}x.${mac}`)).toBe(false);
    expect(m.verifyCsrfToken('user-1', 'not-a-token')).toBe(false);
    expect(m.verifyCsrfToken('user-1', '')).toBe(false);
    const other = await freshModule('z'.repeat(40));
    expect(other.verifyCsrfToken('user-1', token)).toBe(false);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    expect(other.verifyCsrfToken('user-1', other.generateCsrfToken('user-1'))).toBe(true);
    expect(m.verifyCsrfToken('user-1', token)).toBe(false);
  });

  it('logout revokes the token on the instance that handled it', async () => {
    const m = await freshModule('w'.repeat(40));
    const token = m.generateCsrfToken('user-1');
    m.deleteCsrfToken('user-1', token);
    expect(m.verifyCsrfToken('user-1', token)).toBe(false);
  });

  it('without SESSION_SECRET uses a random per-process key, never a guessable default', async () => {
    const a = await freshModule(undefined);
    const token = a.generateCsrfToken('user-1');
    expect(a.verifyCsrfToken('user-1', token)).toBe(true);
    const b = await freshModule(undefined);
    expect(b.verifyCsrfToken('user-1', token)).toBe(false);
  });
});
