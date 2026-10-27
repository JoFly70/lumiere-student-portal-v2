#!/usr/bin/env tsx
/**
 * S22 bootstrap runner. Applies scripts/s22/bootstrap-manifest.ts to a target, one psql
 * `--single-transaction` per file, stopping at the first error.
 *
 *   npx tsx scripts/s22/staging-bootstrap.ts --target=local [--twice] [--verify] [--evidence=out.json]
 *   npx tsx scripts/s22/staging-bootstrap.ts --target=staging --i-understand-this-writes-to-staging [--twice] [--evidence=out.json]
 *   add --dry-run to print the plan without connecting to anything.
 *
 * staging reads S22_STAGING_PROJECT_REF, S22_STAGING_CONFIRM, DATABASE_URL (see lib/staging-guard.ts); the guard runs
 * BEFORE any connection. DATABASE_URL is never printed and never put on a command line.
 */
import fs from 'node:fs';
import path from 'node:path';
import { applySteps, LOCAL_PRELUDE_FILES, LOCAL_PRELUDE_SQL, REPO_ROOT, verifyManifest } from './bootstrap-manifest';
import { applyFile, pgEnvFromUrl, runCommand, type PgEnv } from './lib/psql';
import { assertStagingTarget, redact, StagingGuardError } from './lib/staging-guard';

export interface FileResult { pass: number; step: string; file: string; rc: number; ms: number; error: string; skipped?: boolean }
export interface BootstrapEvidence {
  schema: 's22-bootstrap/1';
  generatedAt: string;
  target: 'local-pg16' | 'staging';
  hosted: boolean;
  stagingRef?: string;
  databaseHost?: string;
  twice: boolean;
  ok: boolean;
  filesApplied: number;
  results: FileResult[];
  verification?: unknown;
}

export interface PlanLine { pass: number; step: string; file: string; kind: 'prelude' | 'apply' }

export function buildPlan(opts: { twice: boolean; local: boolean }): PlanLine[] {
  const plan: PlanLine[] = [];
  const passes = opts.twice ? 2 : 1;
  for (let pass = 1; pass <= passes; pass++) {
    if (opts.local && pass === 1) for (const f of LOCAL_PRELUDE_FILES) plan.push({ pass, step: 'prelude', file: f, kind: 'prelude' });
    for (const s of applySteps()) for (const f of s.files) {
      if (pass > 1 && s.oneShot) continue;
      plan.push({ pass, step: s.id, file: f, kind: 'apply' });
    }
  }
  return plan;
}

export function runPlan(pg: PgEnv, plan: PlanLine[], local: boolean, log: (l: string) => void): FileResult[] {
  const results: FileResult[] = [];
  let lastPass = 0;
  for (const line of plan) {
    if (line.pass !== lastPass) { log(`== pass ${line.pass}${line.pass > 1 ? ' (idempotency)' : ''}`); lastPass = line.pass; }
    if (local && line.kind === 'prelude') {
      const r = applyFile(pg, path.join(REPO_ROOT, line.file));
      results.push({ pass: line.pass, step: line.step, file: line.file, rc: r.rc, ms: r.ms, error: r.error });
      log(fmt(results[results.length - 1]));
      if (r.rc !== 0) break;
      const d = runCommand(pg, LOCAL_PRELUDE_SQL);
      const dr = { pass: line.pass, step: line.step, file: '(inline) default privileges for API roles', rc: d.rc, ms: d.ms, error: d.error };
      results.push(dr); log(fmt(dr));
      if (d.rc !== 0) break;
      continue;
    }
    const r = applyFile(pg, path.join(REPO_ROOT, line.file));
    const res: FileResult = { pass: line.pass, step: line.step, file: line.file, rc: r.rc, ms: r.ms, error: r.error };
    results.push(res); log(fmt(res));
    if (r.rc !== 0) break;
  }
  return results;
}

const fmt = (r: FileResult) =>
  `${String(r.step).padEnd(7)} ${r.file.padEnd(82)} rc=${r.rc} ${(r.ms / 1000).toFixed(3).padStart(7)}s ${redact(r.error)}`;

function parseArgs(argv: string[]) {
  const flag = (n: string) => argv.includes(`--${n}`);
  const val = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  return {
    target: val('target'), dryRun: flag('dry-run'), twice: flag('twice'), verify: flag('verify'),
    evidence: val('evidence'), understand: flag('i-understand-this-writes-to-staging'),
  };
}

export async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  if (a.target !== 'local' && a.target !== 'staging') {
    console.error('usage: staging-bootstrap.ts --target=local|staging [--dry-run] [--twice] [--verify] [--evidence=path] [--i-understand-this-writes-to-staging]');
    return 2;
  }
  const local = a.target === 'local';
  const problems = verifyManifest();
  if (problems.length) { console.error(`manifest invalid:\n  ${problems.join('\n  ')}`); return 2; }
  const plan = buildPlan({ twice: a.twice, local });

  if (a.dryRun) {
    console.log(`DRY RUN (nothing is connected or executed). target=${a.target} files=${plan.length}${a.twice ? ' (two passes)' : ''}`);
    for (const l of plan) console.log(`pass ${l.pass}  ${String(l.step).padEnd(7)} ${l.file}`);
    console.log('then verify (read-only): ' + 'scripts/s22/hosted-verify.ts');
    return 0;
  }

  let pg: PgEnv; let stop: (() => Promise<void>) | undefined;
  const evidenceBase: Pick<BootstrapEvidence, 'schema' | 'generatedAt' | 'twice'> = { schema: 's22-bootstrap/1', generatedAt: new Date().toISOString(), twice: a.twice };
  let target: BootstrapEvidence['target']; let stagingRef: string | undefined; let host: string | undefined;
  if (local) {
    const { startLocalPg } = await import('../../tests/helpers/s05-local-pg');
    const cluster = await startLocalPg({ bare: true });
    pg = pgEnvFromUrl(cluster.url); stop = () => cluster.stop(); target = 'local-pg16';
    console.log('target: throwaway local PostgreSQL 16 (NOT hosted)');
  } else {
    if (!a.understand) { console.error('refusing: staging mode requires --i-understand-this-writes-to-staging'); return 2; }
    try {
      const t = assertStagingTarget({ requireDatabase: true });
      stagingRef = t.ref; host = t.databaseHost;
    } catch (e) {
      if (e instanceof StagingGuardError) { console.error(`staging guard refused: ${e.message}`); return 2; }
      throw e;
    }
    pg = pgEnvFromUrl(process.env.DATABASE_URL as string); target = 'staging';
    console.log(`target: staging project ${stagingRef} (host ${host})`);
  }

  let results: FileResult[] = []; let verification: unknown;
  try {
    results = runPlan(pg, plan, local, (l) => console.log(l));
    const ok = results.length > 0 && results.every((r) => r.rc === 0) && results.filter((r) => r.step !== 'prelude' && !r.file.startsWith('(inline)')).length === plan.filter((p) => p.kind === 'apply').length;
    if (ok && a.verify) {
      const { runVerification, printVerification } = await import('./hosted-verify');
      const v = runVerification(pg);
      printVerification(v, (l) => console.log(l));
      verification = v;
    }
    const verified = verification ? (verification as { ok: boolean }).ok : true;
    const evidence: BootstrapEvidence = {
      ...evidenceBase, target, hosted: target === 'staging', stagingRef, databaseHost: host, ok: ok && verified,
      filesApplied: results.filter((r) => r.rc === 0 && !r.file.startsWith('(inline)')).length, results, verification,
    };
    if (a.evidence) {
      fs.mkdirSync(path.dirname(path.resolve(a.evidence)), { recursive: true });
      fs.writeFileSync(a.evidence, JSON.stringify(evidence, null, 2) + '\n');
      console.log(`evidence: ${a.evidence}`);
    }
    console.log(`== result: ${evidence.ok ? 'PASS' : 'FAIL'} (${evidence.filesApplied} file applications ok)`);
    return evidence.ok ? 0 : 1;
  } finally {
    if (stop) await stop();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(redact(String(e?.stack ?? e))); process.exit(1); });
}
