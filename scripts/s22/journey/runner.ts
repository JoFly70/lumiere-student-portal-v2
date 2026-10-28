/**
 * Journey runner + evidence. The runner is target-agnostic: the same code runs against the deployed staging app
 * (hosted target, real services) or an in-process app (local target, doubles). The evidence says which, and the
 * backing labels come from classifyBacking(), never from the step.
 */
import { randomBytes } from 'node:crypto';
import { redact } from '../lib/staging-guard';
import { Ctx, type Manifest } from './ctx';
import { Http, DEPLOYED_RATE_RULES, RateGovernor } from './http';
import { STEPS, type StepDef } from './steps';
import {
  SERVICES, classifyBacking,
  type ActorKey, type Backing, type BackingValue, type Caps, type Identity, type Ops, type Service, type Sessions, type StepRecord, type Target,
} from './types';

export interface EmailSpec { inbox?: string; domain?: string }

export function newRunId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}

/** Synthetic identities. Addresses come only from S22_TEST_INBOX (plus-addressing) or S22_TEST_EMAIL_DOMAIN. */
export function buildIdentities(runId: string, spec: EmailSpec): Record<ActorKey, Identity> {
  const mail = (label: string): string => {
    if (spec.inbox) {
      const m = /^([^@+\s]+)(?:\+[^@]*)?@([^@\s]+)$/.exec(spec.inbox.trim());
      if (!m) throw new Error('S22_TEST_INBOX must look like name@example.com');
      return `${m[1]}+s22-${runId}-${label}@${m[2]}`.toLowerCase();
    }
    if (spec.domain) return `s22-${runId}-${label}@${spec.domain.trim().toLowerCase()}`;
    throw new Error('set S22_TEST_INBOX (name@host) or S22_TEST_EMAIL_DOMAIN (a domain you control): synthetic addresses are never invented');
  };
  const pw = () => `S22-${randomBytes(9).toString('base64url')}-aA1!`;
  return {
    admin: { key: 'admin', email: mail('admin'), password: pw(), fullName: 'S22 Synthetic Admin', role: 'admin' },
    staff: { key: 'staff', email: mail('staff'), password: pw(), fullName: 'S22 Synthetic Staff', role: 'staff' },
    studentA: { key: 'studentA', email: mail('a'), password: pw(), fullName: 'S22 Synthetic Student A', role: 'student' },
    studentB: { key: 'studentB', email: mail('b'), password: pw(), fullName: 'S22 Synthetic Student B', role: 'student' },
  };
}

export const MANUAL_CHECKS = [
  'E-mail delivery is NOT verified by this script. Signup (J2) makes the app attempt the first verification e-mail (best effort, see docs/recovery/s22/auth-email.md) and invitations are handed back by the API, but no inbox is read: the verification token used in J3 comes from the identity-provider admin API (generateLink). Confirm by hand that mail reaches S22_TEST_INBOX, from the right sender, with a link on the staging host. Hence every step labels email NOT_USED.',
  'Natural token expiry is not provable over HTTP (an expired-claim token signed with an unknown key is rejected, which is not the same thing).',
  'The journey is HTTP-only: browser rendering, the SPA router and the Replit custom domain / TLS certificate are not exercised.',
  'A failing identity provider cannot be induced on a real project, so "a failed provider call releases the invitation" is covered by the local rehearsal only.',
];

export interface RunOptions {
  target: Target;
  http: Http;
  ops: Ops;
  auth: Sessions;
  caps: Caps;
  runId: string;
  ids: Record<ActorKey, Identity>;
  /** Local runs may choose LOCAL vs MOCKED per service; REAL is rejected by classifyBacking. */
  localPolicy?: Partial<Record<Service, BackingValue>>;
  anonKey?: string;
  log?: (line: string) => void;
  onManifestChange?: (m: Manifest) => void;
  steps?: StepDef[];
  governor?: RateGovernor | null;
}

export interface Evidence {
  schema: 's22-hosted-journey/v1';
  runId: string;
  startedAt: string;
  finishedAt: string;
  mode: Target['mode'];
  hostedVerified: boolean;
  hostedPass: boolean;
  verdict: 'HOSTED PASS' | 'HOSTED FAIL' | 'LOCAL ONLY - NOT A HOSTED RESULT';
  target: Record<string, string>;
  counts: { PASS: number; FAIL: number; SKIPPED: number };
  httpRequests: number;
  rateLimitWaits: { rule: string; seconds: number }[];
  serviceMatrix: Record<Service, Record<BackingValue, number>>;
  skippedChecks: { step: string; check: string; reason: string }[];
  manualChecks: string[];
  steps: StepRecord[];
}

const REQUIRED_IDS = STEPS.map((s) => s.id);

export function summarizeMatrix(steps: StepRecord[]): Evidence['serviceMatrix'] {
  const m = {} as Evidence['serviceMatrix'];
  for (const s of SERVICES) m[s] = { REAL: 0, LOCAL: 0, MOCKED: 0, NOT_USED: 0 };
  for (const st of steps) for (const s of SERVICES) m[s][st.backing[s]]++;
  return m;
}

export async function runJourney(opts: RunOptions): Promise<{ evidence: Evidence; manifest: Manifest; ctx: Ctx }> {
  const log = opts.log ?? (() => {});
  const ctx = new Ctx(opts.target, opts.runId, opts.http, opts.ops, opts.auth, opts.caps, opts.ids, opts.onManifestChange);
  if (opts.anonKey) ctx.state.anonKey = opts.anonKey;
  const steps = opts.steps ?? STEPS;
  const startedAt = new Date();
  const records: StepRecord[] = [];
  const status = new Map<string, StepRecord['status']>();
  let aborted: string | null = null;

  for (const def of steps) {
    const backing: Backing = classifyBacking(opts.target, def.uses, opts.localPolicy);
    const base = { id: def.id, title: def.title, backing };
    const unmet = (def.requires ?? []).find((r) => status.get(r) !== 'PASS');
    if (aborted || unmet) {
      const note = aborted ? `run aborted after ${aborted} failed` : `requires ${unmet}, which is ${status.get(unmet!) ?? 'not run'}`;
      records.push({ ...base, status: 'SKIPPED', durationMs: 0, detail: {}, skippedChecks: [], observations: {}, note });
      status.set(def.id, 'SKIPPED');
      log(`${def.id} SKIPPED (${note})`);
      continue;
    }
    ctx.scratch = { detail: {}, skippedChecks: [], observations: {} };
    const t0 = Date.now();
    let result: StepRecord['status'] = 'PASS';
    let note: string | undefined;
    try {
      await def.run(ctx);
    } catch (e) {
      result = 'FAIL';
      note = redact(String((e as Error)?.message ?? e)).slice(0, 600);
      if (def.fatal) aborted = def.id;
    }
    records.push({ ...base, status: result, durationMs: Date.now() - t0, detail: ctx.scratch.detail, skippedChecks: ctx.scratch.skippedChecks, observations: ctx.scratch.observations, note });
    status.set(def.id, result);
    log(`${def.id} ${result}${note ? ` - ${note}` : ''} (${Date.now() - t0} ms)`);
  }

  // Checks that had to wait for a rate-limit window (e.g. the signup limiter allows 3 per hour).
  for (const d of ctx.takeDeferred()) {
    const rec = records.find((r) => r.id === d.stepId);
    if (!rec || rec.status !== 'PASS') continue;
    try {
      await d.fn();
      rec.detail.deferredChecks = [...((rec.detail.deferredChecks as string[] | undefined) ?? []), `${d.name}: PASS`];
    } catch (e) {
      rec.status = 'FAIL';
      rec.note = redact(`deferred check "${d.name}" failed: ${(e as Error).message}`).slice(0, 600);
      status.set(rec.id, 'FAIL');
      log(`${rec.id} FAIL (deferred) - ${rec.note}`);
    }
  }

  const counts = { PASS: 0, FAIL: 0, SKIPPED: 0 };
  for (const r of records) counts[r.status]++;
  const allRan = REQUIRED_IDS.every((id) => records.some((r) => r.id === id)) && opts.steps === undefined;
  const t = opts.target;
  const hosted = t.mode === 'hosted';
  const realOnly = records.every((r) => SERVICES.every((s) => r.backing[s] === 'REAL' || r.backing[s] === 'NOT_USED'));
  const hostedPass = hosted && allRan && counts.FAIL === 0 && counts.SKIPPED === 0 && realOnly;
  const evidence: Evidence = {
    schema: 's22-hosted-journey/v1',
    runId: opts.runId,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    mode: opts.target.mode,
    hostedVerified: hosted,
    hostedPass,
    verdict: !hosted ? 'LOCAL ONLY - NOT A HOSTED RESULT' : hostedPass ? 'HOSTED PASS' : 'HOSTED FAIL',
    target: t.mode === 'hosted'
      ? { appHost: new URL(t.appUrl).host, supabaseHost: new URL(t.supabaseUrl).host, privileged: opts.ops.describe }
      : { description: t.description, privileged: opts.ops.describe },
    counts,
    httpRequests: opts.http.requestCount,
    rateLimitWaits: (opts.governor?.waits ?? []).map((w) => ({ rule: w.rule, seconds: Math.round(w.ms / 1000) })),
    serviceMatrix: summarizeMatrix(records),
    skippedChecks: records.flatMap((r) => r.skippedChecks.map((s) => ({ step: r.id, ...s }))),
    manualChecks: MANUAL_CHECKS,
    steps: records,
  };
  return { evidence, manifest: ctx.manifest, ctx };
}

export function makeGovernor(onWait?: (rule: string, ms: number) => void): RateGovernor {
  return new RateGovernor(DEPLOYED_RATE_RULES, Date.now, undefined, onWait);
}
