#!/usr/bin/env tsx
/**
 * S22 read-only verifier. Runs, each inside BEGIN TRANSACTION READ ONLY ... ROLLBACK:
 *   scripts/release/s14/00-baseline-probe.sql, 01-account-readiness.sql, 90-verify.sql, scripts/s22/hosted-verify.sql
 * and folds them into one list of `check | pass | detail` rows plus a JSON evidence file.
 *
 *   S22_STAGING_PROJECT_REF=<ref> S22_STAGING_CONFIRM=staging:<ref> DATABASE_URL=... \
 *     npx tsx scripts/s22/hosted-verify.ts --target=staging --evidence=evidence/verify.json
 *   LOCAL_DATABASE_URL=postgres://postgres@127.0.0.1:PORT/db npx tsx scripts/s22/hosted-verify.ts --target=local
 *
 * The project ref in the evidence comes from the staging guard, never from the database.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './bootstrap-manifest';
import { parseCsv, pgEnvFromUrl, queryReadOnly, type PgEnv } from './lib/psql';
import { assertStagingTarget, redact, StagingGuardError } from './lib/staging-guard';

export type Pass = boolean | 'info';
export interface VerifyRow { source: string; check: string; pass: Pass; detail: string }
export interface VerifyFileResult { file: string; rc: number; error: string; ms: number; rows: number; failed: number }
export interface VerifyReport {
  schema: 's22-verify/1';
  generatedAt: string;
  ok: boolean;
  files: VerifyFileResult[];
  counts: { total: number; pass: number; fail: number; info: number };
  rows: VerifyRow[];
  target?: 'local-pg16' | 'staging';
  hosted?: boolean;
  stagingRef?: string;
  databaseHost?: string;
}

const bool = (v: string): boolean => v === 't' || v === 'true';
const S14 = 'scripts/release/s14/';

interface Spec { file: string; source: string; map: (r: string[]) => VerifyRow | null }
const SPECS: Spec[] = [
  { file: `${S14}00-baseline-probe.sql`, source: '00-baseline-probe', map: ([section, label, ok, detail]) => {
    if (section === 'A_migration' || section === 'B_s13_gap') return { source: '00-baseline-probe', check: `${section} | ${label}`, pass: bool(ok), detail };
    return null; // C_detail repeats A; D_ledger is informational (the ledger is not trusted)
  } },
  { file: `${S14}01-account-readiness.sql`, source: '01-account-readiness', map: ([section, name, value, pass]) =>
    // C_admin_count is 0 until the owner creates the first admin: informational on a fresh project
    ({ source: '01-account-readiness', check: `${section} | ${name}`, pass: section === 'C_admin_count' ? 'info' : bool(pass), detail: value }) },
  { file: `${S14}90-verify.sql`, source: '90-verify', map: ([, name, pass, detail]) => ({ source: '90-verify', check: name, pass: bool(pass), detail }) },
  { file: 'scripts/s22/hosted-verify.sql', source: 'hosted-verify', map: ([check, pass, detail]) => ({ source: 'hosted-verify', check, pass: bool(pass), detail }) },
];

export function runVerification(pg: PgEnv): VerifyReport {
  const rows: VerifyRow[] = []; const files: VerifyFileResult[] = [];
  for (const spec of SPECS) {
    const r = queryReadOnly(pg, path.join(REPO_ROOT, spec.file));
    let mapped: VerifyRow[] = [];
    if (r.rc === 0) {
      const table = parseCsv(r.stdout);
      mapped = table.slice(1).filter((x) => x.length > 1).map(spec.map).filter((x): x is VerifyRow => x !== null);
    } else {
      mapped = [{ source: spec.source, check: `${spec.file} could not run`, pass: false, detail: r.error }];
    }
    rows.push(...mapped);
    files.push({ file: spec.file, rc: r.rc, error: r.error, ms: Math.round(r.ms), rows: mapped.length, failed: mapped.filter((m) => m.pass === false).length });
  }
  const pass = rows.filter((r) => r.pass === true).length;
  const fail = rows.filter((r) => r.pass === false).length;
  const info = rows.filter((r) => r.pass === 'info').length;
  return { schema: 's22-verify/1', generatedAt: new Date().toISOString(), ok: fail === 0 && files.every((f) => f.rc === 0) && rows.length > 0,
    files, counts: { total: rows.length, pass, fail, info }, rows };
}

export function printVerification(v: VerifyReport, log: (l: string) => void): void {
  for (const f of v.files) log(`verify ${f.file.padEnd(52)} rc=${f.rc} rows=${String(f.rows).padStart(3)} failed=${f.failed} ${(f.ms / 1000).toFixed(3)}s ${redact(f.error)}`);
  for (const r of v.rows.filter((x) => x.pass !== true)) log(`  ${r.pass === 'info' ? 'info' : 'FAIL'}  ${r.source} | ${r.check} | ${redact(r.detail).slice(0, 160)}`);
  log(`verify: ${v.counts.pass} pass, ${v.counts.fail} fail, ${v.counts.info} informational of ${v.counts.total} checks => ${v.ok ? 'PASS' : 'FAIL'}`);
}

export async function main(argv: string[]): Promise<number> {
  const val = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const target = val('target'); const evidence = val('evidence');
  let pg: PgEnv; let meta: Partial<VerifyReport>;
  if (target === 'staging') {
    try {
      const t = assertStagingTarget({ requireDatabase: true });
      meta = { target: 'staging', hosted: true, stagingRef: t.ref, databaseHost: t.databaseHost };
    } catch (e) {
      if (e instanceof StagingGuardError) { console.error(`staging guard refused: ${e.message}`); return 2; }
      throw e;
    }
    pg = pgEnvFromUrl(process.env.DATABASE_URL as string);
    console.log(`target: staging project ${meta.stagingRef} (host ${meta.databaseHost}); read-only transactions`);
  } else if (target === 'local') {
    const u = process.env.LOCAL_DATABASE_URL ?? '';
    if (!u || !['127.0.0.1', 'localhost'].includes(new URL(u).hostname)) { console.error('--target=local needs LOCAL_DATABASE_URL on 127.0.0.1/localhost'); return 2; }
    pg = pgEnvFromUrl(u); meta = { target: 'local-pg16', hosted: false };
    console.log('target: local PostgreSQL (NOT hosted)');
  } else { console.error('usage: hosted-verify.ts --target=staging|local [--evidence=path]'); return 2; }

  const report: VerifyReport = { ...runVerification(pg), ...meta };
  printVerification(report, (l) => console.log(l));
  if (evidence) {
    fs.mkdirSync(path.dirname(path.resolve(evidence)), { recursive: true });
    fs.writeFileSync(evidence, JSON.stringify(report, null, 2) + '\n');
    console.log(`evidence: ${evidence}`);
  }
  return report.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(redact(String(e?.stack ?? e))); process.exit(1); });
}
