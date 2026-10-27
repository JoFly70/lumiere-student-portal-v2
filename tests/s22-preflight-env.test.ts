import { describe, expect, it } from 'vitest';
import { runPreflight, render } from '../scripts/s22/preflight-env';

const REF = 'abcdefghijklmnopqrst';
const PROD = 'rheronevecsffaejteoj';
const secretKey = 'sb_secret_' + 'x'.repeat(30);
const pubKey = 'sb_publishable_' + 'y'.repeat(30);
const staging = {
  NODE_ENV: 'production', S22_STAGING_PROJECT_REF: REF, S22_STAGING_CONFIRM: `staging:${REF}`,
  SUPABASE_URL: `https://${REF}.supabase.co`, VITE_SUPABASE_URL: `https://${REF}.supabase.co`,
  DATABASE_URL: `postgresql://postgres.${REF}:PASSWORDVALUE@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  SUPABASE_SERVICE_KEY: secretKey, SUPABASE_ANON_KEY: pubKey, VITE_SUPABASE_ANON_KEY: pubKey,
  SESSION_SECRET: 's'.repeat(40), APP_URL: 'https://lumiere-staging.replit.app',
  ENABLE_EMAIL_VERIFICATION: 'true', AUTH_EMAIL_MODE: 'custom_smtp', REDIS_URL: 'redis://h:6379',
};
const prod = {
  ...staging, S22_STAGING_PROJECT_REF: undefined, S22_STAGING_CONFIRM: undefined,
  SUPABASE_URL: `https://${PROD}.supabase.co`, VITE_SUPABASE_URL: `https://${PROD}.supabase.co`,
  DATABASE_URL: `postgresql://postgres.${PROD}:PASSWORDVALUE@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  APP_URL: 'https://lumiereportal.app',
};
const fails = (f: ReturnType<typeof runPreflight>) => f.filter((x) => x.level === 'FAIL').map((x) => x.name);

describe('S22 preflight-env', () => {
  it('passes a complete staging environment and never prints values', () => {
    const f = runPreflight(staging);
    expect(fails(f)).toEqual([]);
    const text = render(f, 'staging');
    for (const v of ['PASSWORDVALUE', secretKey, pubKey, 's'.repeat(40)]) expect(text).not.toContain(v);
  });

  it.each([
    ['NODE_ENV', { NODE_ENV: 'development' }],
    ['SESSION_SECRET', { SESSION_SECRET: 'short' }],
    ['ENABLE_EMAIL_VERIFICATION', { ENABLE_EMAIL_VERIFICATION: undefined }],
    ['ALLOW_DEMO_MODE', { ALLOW_DEMO_MODE: 'true' }],
    ['SPARK_ASSISTANT_ENABLED', { SPARK_ASSISTANT_ENABLED: 'true' }],
    ['AUTH_EMAIL_MODE', { AUTH_EMAIL_MODE: undefined }],
    ['staging guard', { APP_URL: 'https://lumiereportal.app' }],
    ['staging guard', { S22_STAGING_PROJECT_REF: PROD, S22_STAGING_CONFIRM: `staging:${PROD}` }],
    ['staging guard', { DATABASE_URL: `postgresql://postgres.${'z'.repeat(20)}:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres` }],
    ['SUPABASE_SERVICE_KEY', { SUPABASE_SERVICE_KEY: pubKey }],
    ['SUPABASE_ANON_KEY', { SUPABASE_ANON_KEY: secretKey }],
    ['SUPABASE_ANON_KEY', { SUPABASE_ANON_KEY: undefined }],
  ])('fails on %s', (name, patch) => {
    expect(fails(runPreflight({ ...staging, ...patch }))).toContain(name);
  });

  it('missing Redis is a warning in staging, a failure with --require-redis and in production', () => {
    const env = { ...staging, REDIS_URL: undefined };
    expect(fails(runPreflight(env))).toEqual([]);
    expect(runPreflight(env).some((x) => x.level === 'WARN' && x.name === 'REDIS_URL')).toBe(true);
    expect(fails(runPreflight(env, { requireRedis: true }))).toContain('REDIS_URL');
    expect(fails(runPreflight({ ...prod, REDIS_URL: undefined }, { production: true, productionRef: PROD }))).toContain('REDIS_URL');
  });

  it('production mode needs the explicit ref and the apex APP_URL', () => {
    expect(fails(runPreflight(prod, { production: true, productionRef: PROD }))).toEqual([]);
    expect(fails(runPreflight(prod, { production: true }))).toContain('production ref');
    expect(fails(runPreflight(prod, { production: true, productionRef: REF }))).toContain('SUPABASE_URL');
    expect(fails(runPreflight({ ...prod, APP_URL: 'https://lumiere-student-portal-v-2.replit.app' }, { production: true, productionRef: PROD }))).toContain('APP_URL');
    expect(fails(runPreflight(prod, { production: true, productionRef: 'ypbzdbfqoflyszdsbivn' }))).toContain('production ref');
  });

  it('detects variables that disagree on the project ref', () => {
    const other = 'q'.repeat(20);
    expect(fails(runPreflight({ ...staging, VITE_SUPABASE_URL: `https://${other}.supabase.co` }))).toEqual(
      expect.arrayContaining(['staging guard', 'single project ref']));
  });
});
