/**
 * S22 hosted-journey: shared types, the honest backing classifier and the tiny assertion helpers.
 *
 * The central rule: a step is only ever labelled REAL when the run's Target is a hosted target that was
 * constructed through makeHostedTarget() (which calls assertStagingTarget). An in-process / local target can
 * never produce REAL for any service, whatever a step or an adapter claims.
 */
import { assertStagingTarget, checkAppUrl, type StagingTarget } from '../lib/staging-guard';

export type Service = 'db' | 'auth' | 'storage' | 'email' | 'app';
export const SERVICES: readonly Service[] = ['db', 'auth', 'storage', 'email', 'app'];
export type BackingValue = 'REAL' | 'LOCAL' | 'MOCKED' | 'NOT_USED';
export type Backing = Record<Service, BackingValue>;
export type StepStatus = 'PASS' | 'FAIL' | 'SKIPPED';

export interface HostedTarget {
  readonly mode: 'hosted';
  readonly appUrl: string; // origin
  readonly supabaseUrl: string;
  readonly ref: string;
  /** Only makeHostedTarget() can set this; it proves assertStagingTarget() passed. */
  readonly guardPassed: true;
}
export interface LocalTarget {
  readonly mode: 'local-inprocess';
  readonly appUrl: string; // loopback origin
  readonly description: string;
}
export type Target = HostedTarget | LocalTarget;

export class JourneyConfigError extends Error {}

/** Hosted target: the staging guard runs first (ref allow/deny list, typed confirmation, URL shape, production origin refusal). */
export function makeHostedTarget(env: Record<string, string | undefined> = process.env): HostedTarget {
  const t: StagingTarget = assertStagingTarget({ env, requireSupabaseUrl: true, requireAppUrl: true });
  return { mode: 'hosted', appUrl: t.appUrl!, supabaseUrl: t.supabaseUrl!, ref: t.ref, guardPassed: true };
}

/** Local target: loopback only, so a deployed URL can never be labelled "local" (nor the reverse). */
export function makeLocalTarget(appUrl: string, description: string): LocalTarget {
  const u = new URL(appUrl);
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
    throw new JourneyConfigError(`a local target must be loopback (got ${u.hostname})`);
  }
  checkAppUrl(appUrl);
  return { mode: 'local-inprocess', appUrl: u.origin, description };
}

/** What a local run is allowed to claim, per service, when the service is used by a step. */
export const LOCAL_DEFAULT_POLICY: Record<Service, Exclude<BackingValue, 'REAL' | 'NOT_USED'>> = {
  db: 'LOCAL', // throwaway PostgreSQL 16, real SQL
  app: 'LOCAL', // the real route code, in process
  auth: 'MOCKED', // local JWT / doubled provider
  storage: 'MOCKED', // in-memory object store double
  email: 'MOCKED',
};

/**
 * Maps the services a step exercises to honest backing labels.
 * hosted + used -> REAL; local + used -> LOCAL/MOCKED (REAL is impossible); not used -> NOT_USED.
 * `localPolicy` may only choose between LOCAL and MOCKED; passing REAL throws.
 */
export function classifyBacking(
  target: Target,
  uses: readonly Service[],
  localPolicy: Partial<Record<Service, BackingValue>> = {},
): Backing {
  const out = {} as Backing;
  for (const s of SERVICES) {
    if (!uses.includes(s)) { out[s] = 'NOT_USED'; continue; }
    if (target.mode === 'hosted') { out[s] = 'REAL'; continue; }
    const wanted = localPolicy[s] ?? LOCAL_DEFAULT_POLICY[s];
    if (wanted === 'REAL') throw new JourneyConfigError(`a local run cannot claim REAL for ${s}`);
    out[s] = wanted === 'NOT_USED' ? LOCAL_DEFAULT_POLICY[s] : wanted;
  }
  return out;
}

// ── actors, sessions, privileged operations ──────────────────────────────────────────────────────────────────────

export type ActorKey = 'admin' | 'staff' | 'studentA' | 'studentB';
export interface Identity {
  key: ActorKey;
  email: string;
  password: string;
  fullName: string;
  role: 'admin' | 'staff' | 'student';
  userId?: string;
}
export interface Session {
  key: ActorKey;
  userId: string;
  email: string;
  bearer: string;
  csrf: string;
  issuedAt: number;
}

/** Authentication through the app's own endpoints (hosted) or a documented stand-in (local). */
export interface Sessions {
  /** POST /api/auth/login (hosted). Returns status; session only on success. */
  tryLogin(identity: Identity): Promise<{ status: number; body?: unknown; session?: Session }>;
  /** POST /api/auth/logout. */
  logout(session: Session): Promise<{ status: number; body?: unknown }>;
}

/**
 * Privileged setup / verification operations that are NOT available over the public app API.
 * Every use is labelled in the step detail. Hosted: SUPABASE_SERVICE_KEY + DATABASE_URL (both guarded).
 */
export interface Ops {
  readonly describe: string;
  sql<T = Record<string, any>>(query: string, params?: unknown[]): Promise<T[]>;
  /** Several statements in ONE transaction (all or nothing). */
  sqlTx(statements: string[]): Promise<void>;
  /** Creates the auth user plus its public.users / profiles rows. */
  createAuthUser(input: { email: string; password: string; fullName: string; role: Identity['role']; confirmed: boolean }): Promise<{ id: string }>;
  /** Supabase admin generateLink -> a verification token_hash for an existing unconfirmed user; null when unsupported. */
  generateVerificationToken(email: string): Promise<{ tokenHash: string } | null>;
  isEmailConfirmed(userId: string, email: string): Promise<boolean>;
  setAccountStatus(userId: string, status: 'active' | 'inactive'): Promise<void>;
  /** true/false, or null when the backend cannot answer. */
  storageObjectExists(storagePath: string): Promise<boolean | null>;
  removeStorageObjects(paths: string[]): Promise<void>;
  deleteAuthUser(userId: string): Promise<void>;
  /** Optional: make the next signup's provider call fail (local only). */
  injectNextSignupFailure?: () => void;
  close(): Promise<void>;
}

/** Capabilities that depend on the target, never on the step. */
export interface Caps {
  /** Probe Supabase Storage endpoints directly (needs the real project URL + anon key). */
  directStorage: boolean;
  /** Rate-limit pacing against the deployed limiter (100 req/15 min, 5 logins/15 min, 3 signups/hour). */
  pace: boolean;
}

// ── assertion helpers (no vitest: this file also runs standalone) ────────────────────────────────────────────────

export class CheckError extends Error {}

export function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new CheckError(message);
}
export function eq<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new CheckError(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
export function inSet<T>(actual: T, allowed: readonly T[], message: string): void {
  if (!allowed.includes(actual)) throw new CheckError(`${message}: expected one of ${JSON.stringify(allowed)}, got ${JSON.stringify(actual)}`);
}

export interface StepRecord {
  id: string;
  title: string;
  status: StepStatus;
  backing: Backing;
  durationMs: number;
  detail: Record<string, unknown>;
  skippedChecks: { check: string; reason: string }[];
  observations: Record<string, unknown>;
  note?: string;
}
