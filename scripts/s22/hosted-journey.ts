/**
 * S22 hosted first-student journey: the S21 23-step journey (J1-J23) plus the S22 additions (J24-J29), driven over
 * HTTP against a DEPLOYED staging app as real synthetic users. No server code is imported.
 *
 *   npx tsx scripts/s22/hosted-journey.ts --dry-run                  # print the plan; no request is made
 *   npx tsx scripts/s22/hosted-journey.ts                            # run against APP_URL (staging only)
 *   npx tsx scripts/s22/hosted-journey.ts --cleanup                  # run, then remove what the run created
 *   npx tsx scripts/s22/hosted-journey.ts --cleanup --run-id <id>    # clean up an earlier run (add --dry-run to preview)
 *
 * Environment (see docs/recovery/s22/hosted-journey.md):
 *   S22_STAGING_PROJECT_REF, S22_STAGING_CONFIRM=staging:<ref>   guard (scripts/s22/lib/staging-guard.ts)
 *   APP_URL                       the deployed staging app (https; the production origins are refused)
 *   SUPABASE_URL                  https://<ref>.supabase.co
 *   SUPABASE_SERVICE_KEY          service role key of the staging project (setup + Storage/Auth checks, labelled)
 *   DATABASE_URL                  staging database (invitation hash check, status flip, tamper step, cleanup)
 *   S22_TEST_INBOX | S22_TEST_EMAIL_DOMAIN   where synthetic addresses live (name+s22-<run>-a@host or s22-<run>-a@domain)
 *   SUPABASE_ANON_KEY             optional; otherwise read from the app's /env.js
 *   S22_JOURNEY_PACE=off          disable client-side rate pacing (only if the deployed limiters were raised)
 *   S22_EVIDENCE_DIR              default docs/recovery/s22-evidence
 *
 * Evidence is written only for a run that actually executed against a hosted target.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertStagingTarget, redact, StagingGuardError } from './lib/staging-guard';
import { cleanupRun } from './journey/cleanup';
import type { Manifest } from './journey/ctx';
import { createAppSessions, createHostedOps } from './journey/hosted-ops';
import { Http } from './journey/http';
import { buildIdentities, makeGovernor, newRunId, runJourney, type Evidence } from './journey/runner';
import { STEPS } from './journey/steps';
import { classifyBacking, makeHostedTarget, type Target } from './journey/types';

export * from './journey/types';
export { runJourney, buildIdentities, newRunId, summarizeMatrix, MANUAL_CHECKS } from './journey/runner';
export { STEPS } from './journey/steps';
export { Http, RateGovernor, DEPLOYED_RATE_RULES } from './journey/http';
export { cleanupRun } from './journey/cleanup';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

interface Args { dryRun: boolean; cleanup: boolean; runId: string | null }

export function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, cleanup: false, runId: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    if (x === '--dry-run') a.dryRun = true;
    else if (x === '--cleanup') a.cleanup = true;
    else if (x === '--run-id') a.runId = argv[++i] ?? null;
    else throw new Error(`unknown argument ${x}`);
  }
  return a;
}

/** The plan printed by --dry-run: no request is made, no secret is printed. */
export function planText(runId: string, env: Record<string, string | undefined>): string {
  const lines: string[] = [];
  lines.push(`S22 hosted journey plan (run id ${runId})`);
  let guard = 'OK';
  let target: Target | null = null;
  try { target = makeHostedTarget(env); assertStagingTarget({ env, requireDatabase: true, requireSupabaseUrl: true, requireAppUrl: true }); } catch (e) {
    guard = `REFUSED - ${e instanceof StagingGuardError ? e.message : (e as Error).message}`;
  }
  lines.push(`staging guard: ${guard}`);
  if (target?.mode === 'hosted') lines.push(`app: ${new URL(target.appUrl).host}   supabase: ${new URL(target.supabaseUrl).host}`);
  lines.push(`service key present: ${Boolean(env.SUPABASE_SERVICE_KEY)}   database url present: ${Boolean(env.DATABASE_URL)}   pacing: ${env.S22_JOURNEY_PACE === 'off' ? 'OFF' : 'on (100 req/15 min, 5 logins/15 min, 3 signups/hour)'}`);
  try {
    const ids = buildIdentities(runId, { inbox: env.S22_TEST_INBOX, domain: env.S22_TEST_EMAIL_DOMAIN });
    lines.push('synthetic identities:');
    for (const i of Object.values(ids)) lines.push(`  ${i.key.padEnd(9)} ${i.email}  (${i.fullName})`);
  } catch (e) { lines.push(`synthetic identities: REFUSED - ${(e as Error).message}`); }
  lines.push('steps (backing if this run is hosted and the step passes):');
  if (target?.mode === 'hosted') {
    for (const s of STEPS) {
      const b = classifyBacking(target, s.uses);
      lines.push(`  ${s.id.padEnd(3)} ${s.title.slice(0, 96)}  [${Object.entries(b).filter(([, v]) => v !== 'NOT_USED').map(([k, v]) => `${k}=${v}`).join(' ')}]`);
    }
  } else {
    for (const s of STEPS) lines.push(`  ${s.id.padEnd(3)} ${s.title.slice(0, 96)}  [uses ${s.uses.join(',')}]`);
  }
  lines.push('cleanup (--cleanup): removes only rows/objects tagged s22-<run id>- (accounts, students and everything below them, invitations, Storage objects, auth users)');
  lines.push(`evidence file (only after a real run): docs/recovery/s22-evidence/hosted-journey-${runId}.json`);
  lines.push('no request is made by --dry-run');
  return lines.join('\n');
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

export async function main(argv: string[], env: Record<string, string | undefined> = process.env, out: (s: string) => void = (s) => console.log(s)): Promise<number> {
  const args = parseArgs(argv);
  const runId = args.runId ?? newRunId();
  const evidenceDir = path.resolve(REPO_ROOT, env.S22_EVIDENCE_DIR ?? 'docs/recovery/s22-evidence');

  if (args.dryRun && !args.cleanup) {
    const text = planText(runId, env);
    out(redact(text));
    return text.includes('REFUSED') ? 2 : 0;
  }

  // Guard FIRST: nothing below runs (and no request is made) unless this passes.
  let target;
  try {
    target = makeHostedTarget(env);
    assertStagingTarget({ env, requireDatabase: true, requireSupabaseUrl: true, requireAppUrl: true });
  } catch (e) {
    out(`refused: ${(e as Error).message}`);
    return 2;
  }
  const ops = createHostedOps(target, env);

  try {
    if (args.cleanup && args.runId) {
      const manifestFile = path.join(evidenceDir, `hosted-journey-${runId}.manifest.json`);
      const manifest: Manifest | null = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null;
      const report = await cleanupRun(ops.rawSql(), ops, { runId, confirm: !args.dryRun, manifest, log: out });
      out(redact(JSON.stringify(report, null, 2)));
      return report.errors.length ? 1 : 0;
    }

    const governor = env.S22_JOURNEY_PACE === 'off' ? null : makeGovernor((rule, ms) => out(`pacing: waiting ${Math.round(ms / 1000)}s for the ${rule} window`));
    const http = new Http({ target, governor });
    const ids = buildIdentities(runId, { inbox: env.S22_TEST_INBOX, domain: env.S22_TEST_EMAIL_DOMAIN });
    const manifestFile = path.join(evidenceDir, `hosted-journey-${runId}.manifest.json`);
    out(`run ${runId} against ${new URL(target.appUrl).host} (supabase ${target.ref}); pacing ${governor ? 'on' : 'off'}`);
    const { evidence, manifest } = await runJourney({
      target, http, ops, auth: createAppSessions(http), caps: { directStorage: true, pace: Boolean(governor) },
      runId, ids, anonKey: env.SUPABASE_ANON_KEY, governor,
      log: (l) => out(redact(l)), onManifestChange: (m) => writeJson(manifestFile, m),
    });
    writeJson(manifestFile, manifest);
    const file = path.join(evidenceDir, `hosted-journey-${runId}.json`);
    writeJson(file, evidence);
    out(`${evidence.verdict}: ${evidence.counts.PASS} PASS, ${evidence.counts.FAIL} FAIL, ${evidence.counts.SKIPPED} SKIPPED; evidence ${path.relative(REPO_ROOT, file)}`);

    if (args.cleanup) {
      const report = await cleanupRun(ops.rawSql(), ops, { runId, confirm: true, manifest, log: out });
      out(redact(JSON.stringify(report, null, 2)));
      writeJson(path.join(evidenceDir, `hosted-journey-${runId}.cleanup.json`), report);
      if (report.errors.length) return 1;
    } else {
      out(`data from this run remains in staging; remove it with: npx tsx scripts/s22/hosted-journey.ts --cleanup --run-id ${runId}`);
    }
    return evidence.hostedPass ? 0 : 1;
  } finally {
    await ops.close();
  }
}

export type { Evidence };

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(redact(String((e as Error)?.stack ?? e))); process.exit(1); });
}
