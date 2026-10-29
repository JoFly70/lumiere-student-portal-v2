import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applySteps, EXCLUDED_MIGRATIONS, REPO_ROOT, STEPS, verifyFiles, verifyManifest } from '../scripts/s22/bootstrap-manifest';
import { buildPlan, main } from '../scripts/s22/staging-bootstrap';
import { main as verifyMain } from '../scripts/s22/hosted-verify';
import { parseCsv, pgEnvFromUrl } from '../scripts/s22/lib/psql';

const REF = 'abcdefghijklmnopqrst';
const SECRET = 'S3cr3t-pw-do-not-print';

describe('S22 bootstrap manifest', () => {
  it('is consistent with the repository (files exist, every migration listed or excluded)', () => {
    expect(verifyManifest()).toEqual([]);
  });

  it('keeps the staging-readiness order of the 11 steps', () => {
    const ids = STEPS.map((s) => s.id);
    expect(ids.filter((i) => /^\d+$/.test(i))).toEqual(['01','02','03','04','05','06','07','08','09','10','11']);
    // S22 additions sit after step 10 and before verification
    expect(ids.slice(-5)).toEqual(['10', '10b', '10c', '10d', '11']);
    const flat = applySteps().flatMap((s) => s.files);
    const at = (needle: string) => flat.findIndex((f) => f.includes(needle));
    expect(at('011_degree_programs_courses')).toBe(0);
    expect(at('PRODUCTION_DATABASE_SETUP')).toBe(1);
    expect(at('10-prereq-tables')).toBeLessThan(at('s05_student_roadmap'));
    expect(at('s11_high_school_audit_event_types')).toBeLessThan(at('30-account-gate'));
    expect(at('30-account-gate')).toBeLessThan(at('35-client-privilege-hardening'));
    expect(at('35-client-privilege-hardening')).toBeLessThan(at('90_storage_buckets'));
    expect(at('90_storage_buckets')).toBeLessThan(at('s21_document_attachments'));
    expect(at('s21_student_welcome')).toBeLessThan(at('s22_account_gate_restore'));
    expect(at('s22_account_gate_restore')).toBeLessThan(at('s25_client_write_lockdown'));
    expect(verifyFiles()).toContain('scripts/s22/hosted-verify.sql');
  });

  it('lists every migration once each, no exclusions', () => {
    const dir = fs.readdirSync(path.join(REPO_ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'));
    const listed = STEPS.flatMap((s) => s.files).filter((f) => f.startsWith('supabase/migrations/'));
    expect(new Set(listed).size).toBe(dir.length);
    expect(listed.length).toBe(dir.length);
    expect(Object.keys(EXCLUDED_MIGRATIONS)).toEqual([]);
  });

  it('second pass skips only the one-shot baseline', () => {
    const p1 = buildPlan({ twice: false, local: false });
    const p2 = buildPlan({ twice: true, local: false }).filter((l) => l.pass === 2);
    expect(p2.length).toBeGreaterThan(0);
    expect(p2.length).toBeLessThan(p1.length);
    expect(p2.some((l) => ['01', '02', '03'].includes(l.step))).toBe(false);
    expect(p2.some((l) => l.step === '08')).toBe(true);
  });

  it('parses psql CSV and builds libpq env without exposing the URL in argv', () => {
    expect(parseCsv('a,b,c\r\n"x,1",t,"he said ""hi"""\n')).toEqual([['a', 'b', 'c'], ['x,1', 't', 'he said "hi"']]);
    const env = pgEnvFromUrl(`postgresql://postgres.${REF}:${SECRET}@aws-0-eu.pooler.supabase.com:5432/postgres`);
    expect(env.PGUSER).toBe(`postgres.${REF}`);
    expect(env.PGSSLMODE).toBe('require');
    expect(env.PGPASSWORD).toBe(SECRET);
  });
});

describe('S22 bootstrap CLI guards', () => {
  const saved = { ...process.env };
  let out: string[];
  beforeEach(() => {
    for (const k of Object.keys(process.env)) if (/^(S22_|DATABASE_URL|SUPABASE_|PG)/.test(k)) delete process.env[k];
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
    vi.spyOn(console, 'error').mockImplementation((...a) => { out.push(a.join(' ')); });
  });
  afterEach(() => { vi.restoreAllMocks(); process.env = { ...saved }; });

  it('refuses staging mode without the acknowledgement flag', async () => {
    expect(await main(['--target=staging'])).toBe(2);
    expect(out.join('\n')).toContain('--i-understand-this-writes-to-staging');
  });

  it('refuses staging mode without the guard environment, before any connection', async () => {
    expect(await main(['--target=staging', '--i-understand-this-writes-to-staging'])).toBe(2);
    expect(out.join('\n')).toContain('staging guard refused');
    expect(await verifyMain(['--target=staging'])).toBe(2);
  });

  it('refuses the canonical production project and a mismatching database host', async () => {
    process.env.S22_STAGING_PROJECT_REF = 'rheronevecsffaejteoj';
    process.env.S22_STAGING_CONFIRM = 'staging:rheronevecsffaejteoj';
    process.env.DATABASE_URL = `postgres://postgres:${SECRET}@db.rheronevecsffaejteoj.supabase.co:5432/postgres`;
    expect(await main(['--target=staging', '--i-understand-this-writes-to-staging'])).toBe(2);
    process.env.S22_STAGING_PROJECT_REF = REF;
    process.env.S22_STAGING_CONFIRM = `staging:${REF}`;
    expect(await main(['--target=staging', '--i-understand-this-writes-to-staging'])).toBe(2);
    expect(await verifyMain(['--target=staging'])).toBe(2);
    expect(out.join('\n')).not.toContain(SECRET);
  });

  it('dry-run prints the plan and contains no secrets, even with a full staging environment', async () => {
    process.env.S22_STAGING_PROJECT_REF = REF;
    process.env.S22_STAGING_CONFIRM = `staging:${REF}`;
    process.env.DATABASE_URL = `postgres://postgres:${SECRET}@db.${REF}.supabase.co:5432/postgres`;
    process.env.SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.signaturesignature';
    expect(await main(['--target=staging', '--dry-run', '--twice'])).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('DRY RUN');
    expect(text).toContain('PRODUCTION_DATABASE_SETUP.sql');
    expect(text).toContain('20261102130000_s21_student_welcome.sql');
    expect(text).toContain('pass 2');
    for (const s of [SECRET, 'eyJhbGci', 'DATABASE_URL', 'postgres://']) expect(text).not.toContain(s);
  });
});
