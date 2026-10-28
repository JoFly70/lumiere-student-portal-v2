import { describe, expect, it } from 'vitest';
import {
  buildApplicationEnvironment,
  STAGING_REF,
  validateStagingDatabaseIdentity,
  validateStagingIdentity,
  validateStagingServiceKey,
  validateStartupEnvironment,
  validateStagingAuthConfiguration,
  stagingOrigin,
} from '../scripts/staging/guard.mjs';

// Identity-only URLs: deliberately contain no passwords, tokens, or secret keys.
const identityUrl = `postgresql://postgres.${STAGING_REF}@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require`;
const identity = {
  S22_STAGING_PROJECT_REF: STAGING_REF,
  S22_STAGING_CONFIRM: `staging:${STAGING_REF}`,
  SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
  VITE_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
};

describe('staging-only startup guard (offline, no credentials)', () => {
  it('accepts the exact staging project and password-free session-pooler identity', () => {
    expect(() => validateStagingIdentity(identity)).not.toThrow();
    expect(validateStagingDatabaseIdentity(identityUrl).username).toBe(`postgres.${STAGING_REF}`);
  });

  it.each([
    {},
    { ...identity, S22_STAGING_PROJECT_REF: undefined },
    { ...identity, S22_STAGING_CONFIRM: undefined },
    { ...identity, S22_STAGING_PROJECT_REF: 'another-project' },
    { ...identity, SUPABASE_URL: 'https://unrelated.invalid' },
    { ...identity, VITE_SUPABASE_URL: 'https://unrelated.invalid' },
    { ...identity, NEXT_PUBLIC_SUPABASE_URL: 'https://unrelated.invalid' },
  ])('rejects missing or conflicting staging identity', (env) => {
    expect(() => validateStagingIdentity(env)).toThrow();
  });

  it.each([
    undefined, '', 'not a URL',
    identityUrl.replace(STAGING_REF, 'unrelated'),
    identityUrl.replace('aws-0-us-east-1.pooler.supabase.com', 'unrelated.invalid'),
    identityUrl.replace('.supabase.com', '.supabase.com.attacker.invalid'),
    identityUrl.replace(':5432', ':6543'),
    identityUrl.replace('/postgres?', '/other?'),
    identityUrl.replace('postgresql:', 'https:'),
    identityUrl.replace('sslmode=require', 'sslmode=disable'),
    identityUrl.replace('?sslmode=require', ''),
    `${identityUrl}&host=unrelated.invalid`,
    `${identityUrl}&sslmode=disable`,
    `${identityUrl}#fragment`,
  ])('rejects invalid database identity or unsafe transport options', (url) => {
    expect(() => validateStagingDatabaseIdentity(url)).toThrow();
  });

  it('fails closed without STAGING_DATABASE_URL even when a managed URL exists', () => {
    const env = { ...identity };
    Object.defineProperty(env, 'DATABASE_URL', {
      enumerable: true,
      get() { throw new Error('Managed DATABASE_URL must never be read'); },
    });
    expect(() => validateStartupEnvironment(env)).toThrow('STAGING_DATABASE_URL is required');
  });

  it('does not treat a password-free identity URL as startup credentials', () => {
    expect(() => validateStartupEnvironment({
      ...identity, STAGING_DATABASE_URL: identityUrl,
    })).toThrow('must include its staging database password');
  });

  it.each([{}, { SUPABASE_SERVICE_KEY: '' }, { SUPABASE_SERVICE_KEY: undefined }])(
    'fails closed when the server-only staging service key is absent',
    (env) => {
      expect(() => validateStagingServiceKey(env)).toThrow('SUPABASE_SERVICE_KEY is required');
    },
  );

  it('replaces the child connection without reading inherited managed URL or PG values', () => {
    const env = { STAGING_DATABASE_URL: identityUrl, REPLIT_DEV_DOMAIN: 'staging.replit.dev' };
    for (const name of ['DATABASE_URL', 'PGPASSWORD', 'PGHOST']) {
      Object.defineProperty(env, name, {
        enumerable: true,
        get() { throw new Error('Inherited database variable must never be read'); },
      });
    }
    const child = buildApplicationEnvironment(env);
    expect(child.DATABASE_URL).toBe(identityUrl);
    expect(child).not.toHaveProperty('STAGING_DATABASE_URL');
    expect(child).not.toHaveProperty('PGPASSWORD');
    expect(child).not.toHaveProperty('PGHOST');
    expect(child.NODE_ENV).toBe('development');
    expect(child.EMAIL_ENABLED).toBe('false');
    expect(child.ENABLE_EMAIL_VERIFICATION).toBe('true');
    expect(child.ALLOW_DEMO_MODE).toBe('false');
  });
  it('requires verification and rejects demo shortcuts without any credentials', () => {
    expect(() => validateStagingAuthConfiguration({ ENABLE_EMAIL_VERIFICATION: 'true' })).not.toThrow();
    for (const value of [undefined, 'false', 'TRUE', '']) {
      expect(() => validateStagingAuthConfiguration({ ENABLE_EMAIL_VERIFICATION: value })).toThrow();
    }
    expect(() => validateStagingAuthConfiguration({ ENABLE_EMAIL_VERIFICATION: 'true', ALLOW_DEMO_MODE: 'true' })).toThrow();
  });

  it('S25 published mode: production build, declared *.replit.app origin only', () => {
    const origin = 'https://lumiere-staging.replit.app';
    expect(stagingOrigin({ STAGING_PUBLISHED_ORIGIN: origin, APP_URL: origin, PUBLIC_APP_URL: origin }, true)).toBe('lumiere-staging.replit.app');
    for (const bad of ['https://lumiereportal.app', 'http://lumiere-staging.replit.app', 'https://x.replit.app.attacker.invalid', undefined]) {
      expect(() => stagingOrigin({ STAGING_PUBLISHED_ORIGIN: bad, APP_URL: bad, PUBLIC_APP_URL: bad }, true)).toThrow();
    }
    expect(() => stagingOrigin({ STAGING_PUBLISHED_ORIGIN: origin, APP_URL: 'https://other.replit.app', PUBLIC_APP_URL: origin }, true)).toThrow();
    const child = buildApplicationEnvironment({ STAGING_DATABASE_URL: identityUrl, STAGING_PUBLISHED_ORIGIN: origin }, { published: true });
    expect(child.NODE_ENV).toBe('production');
    expect(child.CUSTOM_DOMAIN).toBe('lumiere-staging.replit.app');
    expect(child.DATABASE_URL).toBe(identityUrl);
    expect(child.ENABLE_EMAIL_VERIFICATION).toBe('true');
    expect(child.EMAIL_ENABLED).toBe('false');
  });
});
