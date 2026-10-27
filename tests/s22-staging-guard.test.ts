import { describe, expect, it } from 'vitest';
import { assertStagingTarget, redact, StagingGuardError } from '../scripts/s22/lib/staging-guard';

const REF = 'abcdefghijklmnopqrst';
const base = { S22_STAGING_PROJECT_REF: REF, S22_STAGING_CONFIRM: `staging:${REF}` };

describe('S22 staging guard', () => {
  it('accepts the named staging project (direct and pooler)', () => {
    const t = assertStagingTarget({ env: { ...base,
      SUPABASE_URL: `https://${REF}.supabase.co`,
      DATABASE_URL: `postgresql://postgres.${REF}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
      APP_URL: 'https://lumiere-staging.replit.app' } });
    expect(t.ref).toBe(REF);
    expect(t.databaseHost).toBe('aws-0-us-east-1.pooler.supabase.com');
    expect(assertStagingTarget({ env: { ...base, DATABASE_URL: `postgres://postgres:pw@db.${REF}.supabase.co:5432/postgres` } }).databaseHost)
      .toBe(`db.${REF}.supabase.co`);
  });

  it.each([
    ['missing ref', {}],
    ['canonical production ref', { S22_STAGING_PROJECT_REF: 'rheronevecsffaejteoj', S22_STAGING_CONFIRM: 'staging:rheronevecsffaejteoj' }],
    ['historical ref', { S22_STAGING_PROJECT_REF: 'ypbzdbfqoflyszdsbivn', S22_STAGING_CONFIRM: 'staging:ypbzdbfqoflyszdsbivn' }],
    ['missing confirmation', { S22_STAGING_PROJECT_REF: REF }],
    ['SUPABASE_URL of another project', { ...base, SUPABASE_URL: 'https://rheronevecsffaejteoj.supabase.co' }],
    ['VITE url of another project', { ...base, VITE_SUPABASE_URL: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co' }],
    ['database of another project', { ...base, DATABASE_URL: 'postgres://postgres:pw@db.rheronevecsffaejteoj.supabase.co:5432/postgres' }],
    ['pooler user of another project', { ...base, DATABASE_URL: 'postgres://postgres.zzzzzzzzzzzzzzzzzzzz:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres' }],
    ['neon database', { ...base, DATABASE_URL: 'postgres://u:pw@ep-x.neon.tech/clientdesk' }],
    ['unknown host', { ...base, DATABASE_URL: 'postgres://u:pw@10.0.0.5:5432/postgres' }],
    ['production APP_URL', { ...base, APP_URL: 'https://lumiereportal.app' }],
    ['published V2 APP_URL', { ...base, APP_URL: 'https://lumiere-student-portal-v-2.replit.app/' }],
  ])('rejects %s', (_label, env) => {
    expect(() => assertStagingTarget({ env })).toThrow(StagingGuardError);
  });

  it('never echoes credentials in errors', () => {
    try {
      assertStagingTarget({ env: { ...base, DATABASE_URL: 'postgres://postgres:SuperSecret1@db.rheronevecsffaejteoj.supabase.co/postgres' } });
    } catch (e) {
      expect(String(e)).not.toContain('SuperSecret1');
    }
  });

  it('redacts passwords, JWTs, secret keys and link tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstu';
    const out = redact(`postgres://postgres.x:pw123@h/db ${jwt} sb_secret_abc123 https://a/verify?token_hash=xyz&type=signup #access_token=qq`);
    for (const s of ['pw123', jwt, 'abc123', 'xyz', '=qq']) expect(out).not.toContain(s);
  });
});
