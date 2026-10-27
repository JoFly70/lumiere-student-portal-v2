/**
 * S22: runs the real bootstrap manifest (twice) against a throwaway local PostgreSQL 16 and then the read-only
 * verifier. LOCAL PG16 ONLY: this proves the SQL and the ordering, it proves nothing about a hosted Supabase project.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySteps } from '../scripts/s22/bootstrap-manifest';
import { buildPlan, runPlan } from '../scripts/s22/staging-bootstrap';
import { runVerification } from '../scripts/s22/hosted-verify';
import { pgEnvFromUrl, type PgEnv } from '../scripts/s22/lib/psql';
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, startLocalPg, type LocalPg } from './helpers/s05-local-pg';
import { spawnSync } from 'node:child_process';

const HAVE_PSQL = spawnSync('psql', ['--version']).status === 0;
if (!PG_BINARIES_AVAILABLE || !HAVE_PSQL) console.warn(S05_PG_SKIP_MESSAGE + (HAVE_PSQL ? '' : ' (psql missing)'));

describe.skipIf(!PG_BINARIES_AVAILABLE || !HAVE_PSQL)('S22 bootstrap on local PG16 (NOT hosted)', () => {
  let pg: LocalPg; let env: PgEnv;
  const log: string[] = [];

  beforeAll(async () => {
    pg = await startLocalPg({ bare: true });
    env = pgEnvFromUrl(pg.url);
  }, 120_000);
  afterAll(async () => { await pg?.stop(); });

  it('applies the manifest twice, every file rc=0', () => {
    const plan = buildPlan({ twice: true, local: true });
    const results = runPlan(env, plan, true, (l) => log.push(l));
    const failed = results.filter((r) => r.rc !== 0);
    expect(failed, failed.map((f) => `${f.file}: ${f.error}`).join('\n')).toEqual([]);
    const applyFiles = applySteps().flatMap((s) => s.files).length;
    expect(results.filter((r) => r.pass === 1 && r.step !== 'prelude').length).toBe(applyFiles);
    expect(results.some((r) => r.pass === 2)).toBe(true);
  }, 180_000);

  it('read-only verification: every check passes', () => {
    const v = runVerification(env);
    const bad = v.rows.filter((r) => r.pass === false);
    expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
    expect(v.files.every((f) => f.rc === 0)).toBe(true);
    expect(v.ok).toBe(true);
    expect(v.counts.pass).toBeGreaterThan(150);
    for (const needle of ['bucket student-documents exists and is private', 'student-documents file_size_limit = 20 MB', 'assistant_messages trigger assistant_messages_guard_trg', 'rls assistant_integrity_checkpoints', 'is_staff_or_admin() applies the active-account check'])
      expect(v.rows.some((r) => r.check.includes(needle) && r.pass === true), needle).toBe(true);
  }, 120_000);

  it('verification leaves the database unchanged (read-only)', async () => {
    const snap = async () => JSON.stringify(await pg.sql(`SELECT (SELECT count(*) FROM pg_class) c, (SELECT count(*) FROM pg_proc) p, (SELECT count(*) FROM students) s, (SELECT count(*) FROM storage.buckets) b`));
    const before = await snap();
    runVerification(env);
    expect(await snap()).toBe(before);
  }, 60_000);

  it('detects regressions (negative control)', async () => {
    await pg.sql(`GRANT SELECT ON students TO anon;
      UPDATE storage.buckets SET public = true WHERE id = 'documents';
      UPDATE storage.buckets SET file_size_limit = 10485760 WHERE id = 'student-documents';
      ALTER TABLE assistant_messages DISABLE TRIGGER assistant_messages_guard_trg;
      CREATE OR REPLACE FUNCTION public.is_staff_or_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
        AS $$ SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()::text AND role IN ('staff','admin')) $$;`);
    const v = runVerification(env);
    expect(v.ok).toBe(false);
    const failed = v.rows.filter((r) => r.pass === false).map((r) => r.check).join('\n');
    for (const needle of ['anon has no privilege', 'bucket documents exists and is private', 'file_size_limit = 20 MB', 'assistant_messages_guard_trg', 'is_staff_or_admin() applies the active-account check'])
      expect(failed, needle).toContain(needle);
  }, 60_000);
});
