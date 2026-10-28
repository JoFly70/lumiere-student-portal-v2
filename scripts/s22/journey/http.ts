/**
 * S22 hosted-journey HTTP layer: a Target-bound fetch wrapper (so a test can aim the same steps at an in-process
 * server), a URL allow-list for the few calls that leave the app (signed storage URLs), and a rate governor for the
 * deployed limiter.
 *
 * The deployed app rate-limits per IP (server/middleware/rate-limit.ts): ALL /api/* 100 requests / 15 min,
 * /api/auth/login 5 / 15 min, /api/auth/signup 3 / hour. A 29-step journey is ~250 API calls, so a hosted run MUST
 * pace itself; the governor below spaces requests to stay inside those budgets (with a safety margin) and honours 429
 * Retry-After. Local in-process runs set NODE_ENV=test, where the limiters are skipped, and run with pace off.
 */
import { redact } from '../lib/staging-guard';
import type { Session, Target } from './types';

export interface HttpResult {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
  json: any;
  bytes: Buffer;
}

export interface RateRule {
  name: string;
  match: (method: string, path: string) => boolean;
  max: number;
  windowMs: number;
}

/** Budgets sit below the deployed limits to leave room for retries and for the operator's own traffic. */
export const DEPLOYED_RATE_RULES: RateRule[] = [
  { name: 'api (100/15min)', match: (_m, p) => p.startsWith('/api/'), max: 85, windowMs: 15 * 60_000 },
  { name: 'login (5/15min)', match: (_m, p) => p === '/api/auth/login', max: 4, windowMs: 15 * 60_000 },
  { name: 'signup (3/hour)', match: (m, p) => m === 'POST' && p === '/api/auth/signup', max: 3, windowMs: 60 * 60_000 },
  // SPARK_ASSISTANT_RATE_LIMIT_PER_MINUTE defaults to 6 per account for POST .../messages (server/services/academic-assistant/config.ts).
  { name: 'assistant messages (6/min)', match: (m, p) => m === 'POST' && /^\/api\/assistant\/conversations\/[^/]+\/messages$/.test(p), max: 5, windowMs: 60_000 },
  { name: 'verify-email (20/15min)', match: (_m, p) => p === '/api/auth/verify-email', max: 15, windowMs: 15 * 60_000 },
];

export class RateGovernor {
  private readonly hits = new Map<string, number[]>();
  waits: { rule: string; ms: number }[] = [];
  constructor(
    private readonly rules: RateRule[],
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly onWait: (rule: string, ms: number) => void = () => {},
  ) {}

  /** Resolves when the request may be sent without exceeding any matching rule, and records it. */
  async acquire(method: string, path: string): Promise<void> {
    const matching = this.rules.filter((r) => r.match(method.toUpperCase(), path));
    for (;;) {
      let wait = 0;
      let blocking = '';
      const t = this.now();
      for (const r of matching) {
        const list = (this.hits.get(r.name) ?? []).filter((x) => x > t - r.windowMs);
        this.hits.set(r.name, list);
        if (list.length >= r.max) {
          const w = list[list.length - r.max]! + r.windowMs - t + 250;
          if (w > wait) { wait = w; blocking = r.name; }
        }
      }
      if (wait <= 0) break;
      this.waits.push({ rule: blocking, ms: wait });
      this.onWait(blocking, wait);
      await this.sleep(wait);
    }
    const t = this.now();
    for (const r of matching) this.hits.set(r.name, [...(this.hits.get(r.name) ?? []), t]);
  }

  /** A 429 from the server: remember that the window is full so the next acquire waits. */
  noteRejected(method: string, path: string, retryAfterMs: number): number {
    return Math.min(Math.max(retryAfterMs, 1_000), 15 * 60_000);
  }
}

export interface HttpOptions {
  target: Target;
  fetchImpl?: typeof fetch;
  governor?: RateGovernor | null;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ReqInit {
  session?: Session | null;
  json?: unknown;
  form?: FormData;
  body?: BodyInit;
  headers?: Record<string, string>;
  /** Do not send the CSRF header even when the session has one (negative tests). */
  noCsrf?: boolean;
}

export class Http {
  requestCount = 0;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly opts: HttpOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }
  get target(): Target { return this.opts.target; }

  /** A request to the app under test (relative path, always /api/... or a root path). */
  async app(method: string, path: string, init: ReqInit = {}): Promise<HttpResult> {
    if (!path.startsWith('/')) throw new Error(`app path must start with /: ${path}`);
    const url = this.opts.target.appUrl + path;
    const headers: Record<string, string> = { accept: 'application/json', ...(init.headers ?? {}) };
    if (init.session) {
      headers.authorization = `Bearer ${init.session.bearer}`;
      if (init.session.csrf && !init.noCsrf) headers['x-csrf-token'] = init.session.csrf;
    }
    let body: BodyInit | undefined = init.body;
    if (init.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(init.json); }
    if (init.form) body = init.form;
    const pathOnly = path.split('?')[0]!;
    for (let attempt = 0; ; attempt++) {
      if (this.opts.governor) await this.opts.governor.acquire(method, pathOnly);
      const res = await this.send(method, url, headers, body);
      if (res.status === 429 && this.opts.governor && attempt < 3) {
        const ra = Number(res.headers.get('retry-after'));
        const ms = this.opts.governor.noteRejected(method, pathOnly, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 60_000);
        await (this.opts.sleep ?? ((m: number) => new Promise<void>((r) => setTimeout(r, m))))(ms);
        continue;
      }
      return res;
    }
  }

  /**
   * A request that leaves the app: a signed storage URL issued BY the app, or a direct Supabase probe.
   * Hosted: the host must be the staging project's (this also proves the app is wired to the right project).
   * Local: loopback only.
   */
  async external(method: string, url: string, init: { headers?: Record<string, string>; body?: BodyInit } = {}): Promise<HttpResult> {
    this.assertExternalAllowed(url);
    return this.send(method, url, init.headers ?? {}, init.body);
  }

  assertExternalAllowed(url: string): void {
    const u = new URL(url);
    const t = this.opts.target;
    if (t.mode === 'hosted') {
      if (u.protocol !== 'https:' || u.hostname !== `${t.ref}.supabase.co`) {
        throw new Error(`refusing to call ${u.protocol}//${u.hostname}: only https://${t.ref}.supabase.co is allowed (the app may be wired to a different Supabase project)`);
      }
    } else if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
      throw new Error(`refusing to call non-loopback host ${u.hostname} from a local run`);
    }
  }

  private async send(method: string, url: string, headers: Record<string, string>, body?: BodyInit): Promise<HttpResult> {
    this.requestCount++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 60_000);
    try {
      const res = await this.fetchImpl(url, { method, headers, body, signal: ctrl.signal, redirect: 'manual' });
      const bytes = Buffer.from(await res.arrayBuffer());
      const text = bytes.length <= 2_000_000 ? bytes.toString('utf8') : '';
      let json: any = null;
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('json') || /^\s*[{[]/.test(text)) { try { json = JSON.parse(text); } catch { json = null; } }
      return { status: res.status, ok: res.status >= 200 && res.status < 300, headers: res.headers, text, json, bytes };
    } catch (e) {
      throw new Error(redact(`request ${method} ${new URL(url).pathname} failed: ${(e as Error).message}`));
    } finally {
      clearTimeout(timer);
    }
  }
}

export function describeFailure(res: HttpResult, label: string): string {
  return redact(`${label} -> ${res.status} ${(res.text || '').slice(0, 300)}`);
}
