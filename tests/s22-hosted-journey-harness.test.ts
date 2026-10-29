/**
 * S22 — proves the hosted-journey HARNESS locally. NOT a hosted result.
 *
 * Runs the very step functions of scripts/s22/hosted-journey.ts (P0, P1, J1-J29) against an in-process Express app
 * (production registerRoutes) on a throwaway PostgreSQL 16, with the S21 test doubles for Supabase Auth / account status /
 * audit / e-mail / the support tables, plus a byte-faithful in-memory Storage double (signed upload/download URLs served by
 * the same process) so the attachment, photo and isolation steps move real bytes.
 *
 * The assertions here are about the harness: that every step ran, and that the evidence labels the run
 * LOCAL/MOCKED and can never say REAL or "HOSTED PASS". Also covers the rate governor, the target allow-list, the
 * synthetic identities, --dry-run, the guard-first CLI behaviour and the run-scoped cleanup.
 */
import crypto from "node:crypto";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";
import { applyS09Migration } from "./helpers/s09-apply-migration";
import { makeLocalJWT } from "./helpers/s11-hs-e2e-extra";
import { makeS13Supabase } from "./helpers/s13-supabase-shim";
import { InvitationQuery } from "./helpers/s20-invitations-pg";
import { generateCsrfToken } from "../server/middleware/csrf";
import { Http, RateGovernor, type RateRule } from "../scripts/s22/journey/http";
import { buildIdentities, newRunId, runJourney, MANUAL_CHECKS } from "../scripts/s22/journey/runner";
import { STEPS } from "../scripts/s22/journey/steps";
import { cleanupRun } from "../scripts/s22/journey/cleanup";
import { classifyBacking, JourneyConfigError, makeHostedTarget, makeLocalTarget, type Identity, type Ops, type Session, type Sessions } from "../scripts/s22/journey/types";
import { main, planText } from "../scripts/s22/hosted-journey";

const holder = vi.hoisted(() => ({
  supabase: null as any,
  storage: null as any,
  pg: null as any,
  InvitationQuery: null as any,
  inactive: new Set<string>(),
  confirmedEmails: new Set<string>(),
  createUser: vi.fn(),
  deleteUser: vi.fn(async () => ({ error: null })),
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async (id: string) => (holder.inactive.has(id) ? "suspended" : "active")),
  isAccountActive: vi.fn(async (id: string) => !holder.inactive.has(id)),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: {
    auth: { getUser: (...a: any[]) => (holder as any).getUser(...a), admin: { createUser: (...a: any[]) => (holder as any).createUser(...a), deleteUser: (...a: any[]) => (holder as any).deleteUser(...a) } },
    from: (t: string) => {
      if (t === "account_invitations") return new holder.InvitationQuery(holder.pg);
      if (t === "users" || t === "profiles") {
        const ok = Promise.resolve({ data: null, error: null });
        return { insert: () => ok, delete: () => ({ eq: () => ok }), select: () => ({ eq: () => ({ maybeSingle: () => ok }) }) };
      }
      return holder.supabase.client.from(t);
    },
    get storage() { return holder.storage; },
  },
  createUserAuthClient: () => ({ auth: { signInWithPassword: (...a: any[]) => (holder as any).signIn(...a), verifyOtp: (...a: any[]) => (holder as any).verifyOtp(...a), resend: vi.fn(async () => ({ error: null })) } }),
  isSupabaseConfigured: true,
}));
vi.mock("../server/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(actual).map(([k, v]) => [k, typeof v === "function" ? vi.fn().mockResolvedValue(undefined) : v]));
});
vi.mock("../server/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(false),
  sendTicketCreatedEmailToStaff: vi.fn(), sendTicketStatusUpdateEmail: vi.fn(), sendNewCommentEmail: vi.fn(),
}));

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

// ── byte-faithful Storage double ─────────────────────────────────────────────────────────────────────────────────
function makeByteStorage(baseUrl: () => string) {
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const flags = { corruptDownloads: false, ignoreRemove: false };
  const key = (bucket: string, p: string) => `${bucket}/${p}`;
  const from = (bucket: string) => ({
    createSignedUploadUrl: async (p: string) => ({ data: { signedUrl: `${baseUrl()}/__fake-storage/upload/${bucket}/${p}?token=upload-token`, token: "upload-token", path: p }, error: null }),
    createSignedUrl: async (p: string, seconds: number) =>
      objects.has(key(bucket, p))
        ? { data: { signedUrl: `${baseUrl()}/__fake-storage/object/${bucket}/${p}?token=dl&expires=${seconds}` }, error: null }
        : { data: null, error: { message: "Object not found" } },
    list: async (folder: string, opts?: { search?: string }) => {
      const prefix = key(bucket, folder) + "/";
      const items = [...objects.entries()]
        .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
        .map(([k, v]) => ({ name: k.slice(prefix.length), metadata: { size: v.bytes.length, mimetype: v.contentType } }))
        .filter((o) => !opts?.search || o.name.includes(opts.search));
      return { data: items, error: null };
    },
    download: async (p: string) => {
      const o = objects.get(key(bucket, p));
      return o ? { data: new Blob([new Uint8Array(o.bytes)]), error: null } : { data: null, error: { message: "Object not found" } };
    },
    upload: async (p: string, body: Buffer, opts?: { contentType?: string; upsert?: boolean }) => {
      if (objects.has(key(bucket, p)) && !opts?.upsert) return { data: null, error: { message: "The resource already exists" } };
      objects.set(key(bucket, p), { bytes: Buffer.from(body), contentType: opts?.contentType ?? "application/octet-stream" });
      return { data: { path: p }, error: null };
    },
    remove: async (paths: string[]) => { if (!flags.ignoreRemove) for (const p of paths) objects.delete(key(bucket, p)); return { data: [], error: null }; },
    getPublicUrl: (p: string) => ({ data: { publicUrl: `https://storage.synthetic.example/${bucket}/${p}` } }),
  });
  return {
    objects,
    flags,
    from,
    listBuckets: async () => ({ data: [{ name: "student-documents" }], error: null }),
    createBucket: async () => ({ data: null, error: null }),
    mount(app: express.Express) {
      const raw = express.raw({ type: () => true, limit: "40mb" });
      app.put(/^\/__fake-storage\/upload\/([^/]+)\/(.+)$/, raw, (req, res) => {
        const [bucket, p] = [req.params[0]!, decodeURIComponent(req.params[1]!)];
        if (req.query.token !== "upload-token") return res.status(403).json({ error: "bad token" });
        if (objects.has(key(bucket, p)) && req.headers["x-upsert"] !== "true") return res.status(409).json({ error: "Duplicate" });
        objects.set(key(bucket, p), { bytes: Buffer.from(req.body), contentType: String(req.headers["content-type"] ?? "") });
        return res.status(200).json({ Key: key(bucket, p) });
      });
      app.get(/^\/__fake-storage\/object\/([^/]+)\/(.+)$/, (req, res) => {
        const o = objects.get(key(req.params[0]!, decodeURIComponent(req.params[1]!)));
        if (!o) return res.status(404).json({ error: "Object not found" });
        const body = flags.corruptDownloads ? Buffer.concat([Buffer.from([o.bytes[0]! ^ 0xff]), o.bytes.subarray(1)]) : o.bytes;
        return res.status(200).type(o.contentType || "application/octet-stream").send(body);
      });
    },
  };
}

// ── harness-only unit tests (no database) ────────────────────────────────────────────────────────────────────────
describe("S22 harness: backing classification is honest", () => {
  const hosted = () => makeHostedTarget({
    S22_STAGING_PROJECT_REF: "abcdefghijklmnopqrst", S22_STAGING_CONFIRM: "staging:abcdefghijklmnopqrst",
    SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", APP_URL: "https://stg.example.app",
  });
  it("hosted + used = REAL, unused = NOT_USED", () => {
    expect(classifyBacking(hosted(), ["app", "db"])).toEqual({ db: "REAL", auth: "NOT_USED", storage: "NOT_USED", email: "NOT_USED", app: "REAL" });
  });
  it("a local target can never yield REAL, whatever the policy says", () => {
    const local = makeLocalTarget("http://127.0.0.1:5000", "test");
    expect(classifyBacking(local, ["app", "db", "auth", "storage", "email"])).toEqual({ db: "LOCAL", auth: "MOCKED", storage: "MOCKED", email: "MOCKED", app: "LOCAL" });
    expect(() => classifyBacking(local, ["db"], { db: "REAL" })).toThrow(JourneyConfigError);
  });
  it("a local target must be loopback; a hosted target needs the staging guard", () => {
    expect(() => makeLocalTarget("https://stg.example.app", "x")).toThrow(JourneyConfigError);
    expect(() => makeHostedTarget({})).toThrow();
    expect(() => makeHostedTarget({ S22_STAGING_PROJECT_REF: "abcdefghijklmnopqrst", S22_STAGING_CONFIRM: "staging:abcdefghijklmnopqrst", SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", APP_URL: "https://lumiereportal.app" })).toThrow(/production/);
    expect(() => makeHostedTarget({ S22_STAGING_PROJECT_REF: "rheronevecsffaejteoj", S22_STAGING_CONFIRM: "staging:rheronevecsffaejteoj", SUPABASE_URL: "https://rheronevecsffaejteoj.supabase.co", APP_URL: "https://stg.example.app" })).toThrow(/refusing project/);
  });
  it("every step declares its services, and J1-J29 plus the two preflights are all present, in order", () => {
    expect(STEPS.map((s) => s.id)).toEqual(["P0", "P1", ...Array.from({ length: 29 }, (_, i) => `J${i + 1}`)]);
    for (const s of STEPS) expect(s.uses.length).toBeGreaterThan(0);
    expect(STEPS.find((s) => s.id === "J24")!.uses).toContain("storage");
  });
});

describe("S22 harness: transport guards", () => {
  it("hosted runs may only leave the app for the staging project's own host", () => {
    const t = makeHostedTarget({ S22_STAGING_PROJECT_REF: "abcdefghijklmnopqrst", S22_STAGING_CONFIRM: "staging:abcdefghijklmnopqrst", SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", APP_URL: "https://stg.example.app" });
    const h = new Http({ target: t, fetchImpl: (async () => { throw new Error("no network in this test"); }) as typeof fetch });
    expect(() => h.assertExternalAllowed("https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/sign/x")).not.toThrow();
    expect(() => h.assertExternalAllowed("https://rheronevecsffaejteoj.supabase.co/storage/v1/x")).toThrow(/different Supabase project/);
    expect(() => h.assertExternalAllowed("http://abcdefghijklmnopqrst.supabase.co/x")).toThrow();
    expect(() => h.assertExternalAllowed("https://evil.example/x")).toThrow();
  });
  it("local runs may only call loopback", () => {
    const h = new Http({ target: makeLocalTarget("http://127.0.0.1:1234", "x") });
    expect(() => h.assertExternalAllowed("http://127.0.0.1:9/x")).not.toThrow();
    expect(() => h.assertExternalAllowed("https://abcdefghijklmnopqrst.supabase.co/x")).toThrow(/loopback/);
  });
  it("RateGovernor spaces requests to the deployed budgets using a fake clock", async () => {
    let now = 0;
    const slept: number[] = [];
    const rules: RateRule[] = [
      { name: "api", match: (_m, p) => p.startsWith("/api/"), max: 3, windowMs: 1000 },
      { name: "login", match: (_m, p) => p === "/api/auth/login", max: 1, windowMs: 5000 },
    ];
    const g = new RateGovernor(rules, () => now, async (ms) => { slept.push(ms); now += ms; });
    for (let i = 0; i < 3; i++) await g.acquire("GET", "/api/x");
    expect(slept).toEqual([]);
    await g.acquire("GET", "/api/x"); // 4th within 1 s -> must wait for the first to age out
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeGreaterThanOrEqual(1000);
    await g.acquire("POST", "/api/auth/login");
    const before = slept.length;
    await g.acquire("POST", "/api/auth/login"); // second login inside 5 s
    expect(slept.length).toBeGreaterThan(before);
    expect(slept.at(-1)).toBeGreaterThanOrEqual(4000);
    await g.acquire("GET", "/health"); // not matched by any rule
    expect(g.waits.length).toBe(slept.length);
  });
  it("synthetic identities are tagged, obviously fictional and never invented without an inbox/domain", () => {
    const id = "20261027101500-ab12";
    const a = buildIdentities(id, { inbox: "owner@example.com" });
    expect(a.studentA.email).toBe(`owner+s22-${id}-a@example.com`);
    expect(a.studentA.fullName).toBe("S22 Synthetic Student A");
    const b = buildIdentities(id, { domain: "Mail.Example.Org" });
    expect(b.studentB.email).toBe(`s22-${id}-b@mail.example.org`);
    expect(new Set(Object.values(a).map((i) => i.password)).size).toBe(4);
    expect(() => buildIdentities(id, {})).toThrow(/never invented/);
    expect(() => buildIdentities(id, { inbox: "not-an-address" })).toThrow();
  });
});

describe("S22 harness: CLI is guard-first and --dry-run makes no request", () => {
  it("--dry-run prints the plan, refuses without the guard, and never calls fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const lines: string[] = [];
    const code = await main(["--dry-run"], {}, (s) => lines.push(s));
    expect(code).toBe(2);
    const text = lines.join("\n");
    expect(text).toContain("staging guard: REFUSED");
    for (const id of ["P0", "P1", "J1", "J24", "J29"]) expect(text).toContain(`  ${id}`);
    expect(spy).not.toHaveBeenCalled();
    const okEnv = { S22_STAGING_PROJECT_REF: "abcdefghijklmnopqrst", S22_STAGING_CONFIRM: "staging:abcdefghijklmnopqrst", SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", APP_URL: "https://stg.example.app", DATABASE_URL: "postgres://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres", S22_TEST_INBOX: "owner@example.com" };
    const plan = planText("20261027101500-ab12", okEnv);
    expect(plan).toContain("staging guard: OK");
    expect(plan).toContain("owner+s22-20261027101500-ab12-a@example.com");
    expect(plan).not.toContain("pw@");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("a real run is refused before any request when the guard fails (production origin, missing confirmation)", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const lines: string[] = [];
    const base = { S22_STAGING_PROJECT_REF: "abcdefghijklmnopqrst", SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", DATABASE_URL: "postgres://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres", SUPABASE_SERVICE_KEY: "x", S22_TEST_INBOX: "owner@example.com" };
    expect(await main([], { ...base, APP_URL: "https://stg.example.app" }, (s) => lines.push(s))).toBe(2); // no S22_STAGING_CONFIRM
    expect(await main([], { ...base, S22_STAGING_CONFIRM: "staging:abcdefghijklmnopqrst", APP_URL: "https://lumiereportal.app" }, (s) => lines.push(s))).toBe(2);
    expect(await main(["--cleanup", "--run-id", "20261027101500-ab12"], base, (s) => lines.push(s))).toBe(2);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ── the journey itself, in process ───────────────────────────────────────────────────────────────────────────────
describe.skipIf(!PG_BINARIES_AVAILABLE)("S22 hosted-journey harness against an in-process app (LOCAL, not hosted)", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base = "";
  let ops: Ops;
  let runId = "";
  let result: Awaited<ReturnType<typeof runJourney>>;

  beforeAll(async () => {
    pg = await startLocalPg();
    await applyS09Migration(pg);
    process.env.DATABASE_URL = pg.url;
    process.env.ENABLE_EMAIL_VERIFICATION = "true";
    process.env.SPARK_ASSISTANT_RATE_LIMIT_PER_MINUTE = "120"; // local only; the hosted run paces itself to the deployed default of 6/min
    delete process.env.ALLOW_DEMO_MODE;
    holder.pg = pg;
    holder.InvitationQuery = InvitationQuery;
    holder.supabase = makeS13Supabase(pg);
    const store = makeByteStorage(() => base);
    holder.storage = store;

    // Stand-in for Supabase verifying its own access tokens: since S23, local JWTs are not accepted while
    // email verification is enforced, so the mocked provider resolves the harness's locally minted tokens.
    holder.getUser.mockImplementation(async (token: string) => {
      const invalid = { data: { user: null }, error: { message: "invalid token", status: 401 } };
      const parts = String(token ?? "").split(".");
      if (parts.length !== 3) return invalid;
      let claims: { userId?: string; email?: string; exp?: number };
      try { claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")); } catch { return invalid; }
      if (!claims.userId || !claims.email || (claims.exp ?? 0) * 1000 < Date.now()) return invalid;
      const secret = process.env.SESSION_SECRET || "local-dev-secret-change-in-production";
      const expected = crypto.createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
      if (parts[2] !== expected) return invalid;
      const [u] = await pg.sql(`select id, email from users where id = '${claims.userId}'`);
      if (!u) return invalid;
      return { data: { user: { id: String(u.id), email: String(u.email), email_confirmed_at: holder.confirmedEmails.has(String(u.email)) ? new Date().toISOString() : null } }, error: null };
    });
    holder.signIn.mockImplementation(async ({ email }: { email: string }) =>
      holder.confirmedEmails.has(email) ? { data: { session: { access_token: "a", refresh_token: "b", expires_at: 1 } }, error: null } : { data: { session: null }, error: { message: "Email not confirmed" } });
    holder.createUser.mockImplementation(async (arg: { email: string; email_confirm: boolean }) => {
      const existing = await pg.sql(`select id from users where lower(email) = lower('${arg.email}')`);
      if (existing.length) return { data: { user: null }, error: { message: "User already registered" } };
      const id = crypto.randomUUID();
      if (arg.email_confirm) holder.confirmedEmails.add(arg.email); else holder.confirmedEmails.delete(arg.email);
      await pg.sql(`insert into auth.users (id, email, raw_app_meta_data) values ('${id}', '${arg.email}', '{"role":"student"}'::jsonb)`);
      await pg.sql(`insert into users (id, email, name, role) values ('${id}', '${arg.email}', 'S22 Synthetic Student A', 'student')`);
      return { data: { user: { id, email: arg.email } }, error: null };
    });
    holder.verifyOtp.mockImplementation(async ({ token_hash }: { token_hash: string }) => {
      const m = /^local_verified_([A-Za-z0-9_-]+)$/.exec(token_hash);
      if (!m) return { data: { user: null }, error: { message: "Token has expired or is invalid" } };
      const email = Buffer.from(m[1]!, "base64url").toString("utf8");
      holder.confirmedEmails.add(email);
      return { data: { user: { email_confirmed_at: new Date().toISOString() } }, error: null };
    });

    const { registerRoutes } = await import("../server/routes");
    const app = express();
    store.mount(app);
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    ops = {
      describe: "local: throwaway PostgreSQL 16 + in-memory doubles (no Supabase)",
      sql: async (q, params = []) => (await pg.client.unsafe(q, params as never[])) as unknown as any[],
      sqlTx: async (stmts) => { await pg.client.begin(async (tx) => { for (const s of stmts) await tx.unsafe(s); }); },
      createAuthUser: async ({ email, fullName, role, confirmed }) => {
        const id = crypto.randomUUID();
        await pg.sql(`insert into auth.users (id, email, raw_app_meta_data) values ('${id}', '${email}', '{"role":"${role}"}'::jsonb)`);
        await pg.sql(`insert into users (id, email, name, role) values ('${id}', '${email}', '${fullName}', '${role}')`);
        await pg.sql(`insert into profiles (user_id, status) values ('${id}', 'active') on conflict (user_id) do nothing`);
        if (confirmed) holder.confirmedEmails.add(email);
        return { id };
      },
      generateVerificationToken: async (email) => ({ tokenHash: `local_verified_${Buffer.from(email).toString("base64url")}` }),
      isEmailConfirmed: async (_id, email) => holder.confirmedEmails.has(email),
      setAccountStatus: async (id, status) => { if (status === "inactive") holder.inactive.add(id); else holder.inactive.delete(id); },
      storageObjectExists: async (p) => store.objects.has(`student-documents/${p}`),
      removeStorageObjects: async (paths) => { for (const p of paths) store.objects.delete(`student-documents/${p}`); },
      deleteAuthUser: async (id) => { await pg.sql(`delete from auth.users where id = '${id}'`); },
      injectNextSignupFailure: () => { holder.createUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "provider down" } }); },
      close: async () => {},
    };
  }, 300_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pg?.stop();
  }, 60_000);

  const localSessions = (): Sessions => ({
    async tryLogin(identity: Identity) {
      if (!holder.confirmedEmails.has(identity.email)) return { status: 401 };
      const [u] = await pg.sql(`select id from users where lower(email) = lower('${identity.email}')`);
      if (!u) return { status: 401 };
      const id = String(u.id);
      const session: Session = { key: identity.key, userId: id, email: identity.email, bearer: makeLocalJWT(id, identity.email), csrf: generateCsrfToken(id), issuedAt: Date.now() };
      return { status: 200, session };
    },
    // MOCKED: a local JWT cannot be revoked; the real /api/auth/logout needs Supabase.
    async logout() { return { status: 200 }; },
  });

  it("runs P0, P1, J1-J29 through the harness; every step passes locally and the evidence is labelled LOCAL/MOCKED, never REAL", async () => {
    runId = newRunId();
    const target = makeLocalTarget(base, "in-process Express (production registerRoutes) on throwaway PostgreSQL 16; auth/storage/email are test doubles");
    const http = new Http({ target, governor: null });
    result = await runJourney({
      target, http, ops, auth: localSessions(), caps: { directStorage: false, pace: false },
      runId, ids: buildIdentities(runId, { domain: "example.test" }),
      log: (l) => process.stdout.write(`  ${l}\n`),
    });
    const ev = result.evidence;

    // labelling
    if (process.env.S22_HARNESS_DUMP) (await import("node:fs")).writeFileSync(process.env.S22_HARNESS_DUMP, JSON.stringify(ev, null, 2));
    expect(ev.mode).toBe("local-inprocess");
    expect(ev.hostedVerified).toBe(false);
    expect(ev.hostedPass).toBe(false);
    expect(ev.verdict).toBe("LOCAL ONLY - NOT A HOSTED RESULT");
    for (const s of ev.steps) {
      expect(["LOCAL", "NOT_USED"], `${s.id} db`).toContain(s.backing.db);
      expect(["LOCAL", "NOT_USED"], `${s.id} app`).toContain(s.backing.app);
      for (const svc of ["auth", "storage", "email"] as const) expect(["MOCKED", "NOT_USED"], `${s.id} ${svc}`).toContain(s.backing[svc]);
    }
    for (const svc of Object.values(ev.serviceMatrix)) expect(svc.REAL).toBe(0);
    expect(JSON.stringify(ev)).not.toContain("HOSTED PASS");
    expect(ev.manualChecks).toEqual(MANUAL_CHECKS);
    expect(ev.target.description).toContain("test doubles");

    // coverage: every step ran, in order, and passed
    expect(ev.steps.map((s) => s.id)).toEqual(["P0", "P1", ...Array.from({ length: 29 }, (_, i) => `J${i + 1}`)]);
    const failed = ev.steps.filter((s) => s.status !== "PASS").map((s) => `${s.id}: ${s.status} ${s.note ?? ""}`);
    expect(failed).toEqual([]);
    expect(ev.counts).toEqual({ PASS: 31, FAIL: 0, SKIPPED: 0 });
    expect(ev.httpRequests).toBeGreaterThan(200);

    // what a local run cannot prove is listed, not hidden
    const skipped = ev.skippedChecks.map((s) => `${s.step}: ${s.check}`);
    expect(skipped.some((s) => s.startsWith("P0:"))).toBe(true);
    expect(skipped.some((s) => s.startsWith("J27:") && /direct Supabase Storage/.test(s))).toBe(true);
    expect(ev.steps.find((s) => s.id === "J2")!.detail.deferredChecks).toEqual(["a consumed invitation cannot be reused: PASS"]);

    // the programme maths the S20/S21 journey asserts, as observed through HTTP
    const j6 = ev.steps.find((s) => s.id === "J6")!.detail;
    expect(j6).toMatchObject({ coreHalfUnits: 32, electiveHalfUnits: 10, totalHalfUnits: 42, totalCredits: 21 });
    expect(ev.steps.find((s) => s.id === "J10")!.detail).toMatchObject({ officialHalfUnits: 3, officialCredits: 1.5, remainingHalfUnits: 39 });
    // 8 formats, byte-identical
    const j24 = ev.steps.find((s) => s.id === "J24")!.detail as any;
    expect(Object.keys(j24.perFormat).sort()).toEqual(["csv", "docx", "jpg", "pdf", "png", "txt", "webp", "xlsx"]);
    for (const f of Object.values(j24.perFormat) as any[]) expect(f.byteIdentical).toBe(true);
    // no secret or token in the evidence
    const text = JSON.stringify(ev);
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
    for (const id of Object.values(result.ctx.ids)) expect(text).not.toContain(id.password);
  }, 900_000);

  it("a step failure is reported as FAIL and later dependent steps are SKIPPED, never PASS", async () => {
    const target = makeLocalTarget(base, "in-process");
    const http = new Http({ target, governor: null });
    const rid = newRunId();
    const boom = { ...STEPS.find((s) => s.id === "P0")!, run: async () => { throw new Error("boom eyJabcdefghij.abcdefghijk.abcdefghijk"); } };
    const out = await runJourney({
      target, http, ops, auth: localSessions(), caps: { directStorage: false, pace: false },
      runId: rid, ids: buildIdentities(rid, { domain: "example.test" }), steps: [boom, STEPS.find((s) => s.id === "P1")!, STEPS.find((s) => s.id === "J1")!],
    });
    expect(out.evidence.steps.map((s) => s.status)).toEqual(["FAIL", "SKIPPED", "SKIPPED"]);
    expect(out.evidence.steps[0]!.note).toContain("<jwt>");
    expect(out.evidence.hostedPass).toBe(false);
    expect(out.evidence.counts).toEqual({ PASS: 0, FAIL: 1, SKIPPED: 2 });
  });

  it("cleanup removes only the rows and objects of the run (dry run first), and leaves unrelated data alone", async () => {
    expect(result, "the journey test must have run first").toBeTruthy();
    const [control] = await pg.sql(`insert into users (id, email, name, role) values ('${crypto.randomUUID()}', 'control-${runId}@synthetic.example', 'Control', 'student') returning id`);
    await pg.sql(`insert into auth.users (id, email, raw_app_meta_data) values ('${control!.id}', 'control-${runId}@synthetic.example', '{}'::jsonb)`);
    const tag = `%s22-${runId}-%`;
    const count = async (sqlText: string) => Number((await pg.sql(sqlText))[0]!.n);
    const before = {
      users: await count(`select count(*)::int n from users where email ilike '${tag}'`),
      students: await count(`select count(*)::int n from students where email ilike '${tag}'`),
      docs: await count(`select count(*)::int n from student_documents`),
    };
    expect(before.users).toBe(4);
    expect(before.students).toBe(2);

    const plan = await cleanupRun(pg.client, ops, { runId, confirm: false, manifest: result.manifest });
    expect(plan.dryRun).toBe(true);
    expect(plan.errors).toEqual([]);
    expect(plan.roots).toEqual({ users: 4, students: 2, invitations: 1 });
    expect(plan.storageObjects).toBeGreaterThan(8);
    expect(await count(`select count(*)::int n from users where email ilike '${tag}'`)).toBe(4); // dry run deleted nothing

    const report = await cleanupRun(pg.client, ops, { runId, confirm: true, manifest: result.manifest });
    expect(report.errors).toEqual([]);
    expect(report.assistantOwnersPurged).toBe(4);
    expect(await count(`select count(*)::int n from users where email ilike '${tag}'`)).toBe(0);
    expect(await count(`select count(*)::int n from students where email ilike '${tag}'`)).toBe(0);
    expect(await count(`select count(*)::int n from account_invitations where email ilike '${tag}'`)).toBe(0);
    expect(await count(`select count(*)::int n from student_documents`)).toBe(0);
    expect(await count(`select count(*)::int n from assistant_conversations`)).toBe(0);
    expect(await count(`select count(*)::int n from student_assistant_memory`)).toBe(0);
    expect(await count(`select count(*)::int n from users where id = '${control!.id}'`)).toBe(1); // unrelated row survives
    // append-only triggers are back on
    const trg = await pg.sql(`select count(*)::int n from pg_trigger where tgrelid = 'assistant_messages'::regclass and not tgisinternal and tgenabled = 'D'`);
    expect(trg[0]!.n).toBe(0);
    // Storage double emptied of this run's objects
    const leftover = [...(holder.storage.objects as Map<string, unknown>).keys()];
    expect(leftover).toEqual([]);
    // a second run is a no-op
    const again = await cleanupRun(pg.client, ops, { runId, confirm: true, manifest: result.manifest });
    expect(again.roots).toEqual({ users: 0, students: 0, invitations: 0 });
  }, 120_000);

  // Mutation tests: the assertions must have teeth, otherwise "all PASS" proves nothing.
  const fullRun = async (fetchImpl?: typeof fetch, sessions: Sessions = localSessions()) => {
    const rid = newRunId();
    const target = makeLocalTarget(base, "in-process (mutation test)");
    const out = await runJourney({
      target, http: new Http({ target, governor: null, fetchImpl }), ops, auth: sessions, caps: { directStorage: false, pace: false },
      runId: rid, ids: buildIdentities(rid, { domain: "example.test" }),
    });
    return { rid, ...out };
  };
  const wipe = async (rid: string, manifest: any) => {
    const r = await cleanupRun(pg.client, ops, { runId: rid, confirm: true, manifest });
    expect(r.errors).toEqual([]);
  };

  it("mutation: if student B's token were really student A's, the isolation step fails and the run cannot pass", async () => {
    const tokens: Record<string, { bearer: string; csrf: string }> = {};
    const inner = localSessions();
    const sessions: Sessions = {
      logout: inner.logout,
      async tryLogin(identity) { const r = await inner.tryLogin(identity); if (r.session) tokens[identity.key] = { bearer: r.session.bearer, csrf: r.session.csrf }; return r; },
    };
    const swap = (async (url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      if (tokens.studentA && tokens.studentB && h.get("authorization") === `Bearer ${tokens.studentB.bearer}`) {
        h.set("authorization", `Bearer ${tokens.studentA.bearer}`);
        h.set("x-csrf-token", tokens.studentA.csrf);
      }
      return fetch(url, { ...init, headers: h });
    }) as typeof fetch;
    const r = await fullRun(swap, sessions);
    expect(r.evidence.steps.find((s) => s.id === "J11")!.status).toBe("FAIL");
    expect(r.evidence.counts.FAIL).toBeGreaterThanOrEqual(1);
    expect(r.evidence.hostedPass).toBe(false);
    await wipe(r.rid, r.manifest);
  }, 300_000);

  it("mutation: if Storage returned altered bytes, J24 fails (the byte comparison is real)", async () => {
    holder.storage.flags.corruptDownloads = true;
    try {
      const r = await fullRun();
      const j24 = r.evidence.steps.find((s) => s.id === "J24")!;
      expect(j24.status).toBe("FAIL");
      expect(j24.note).toMatch(/bytes differ/);
      expect(r.evidence.steps.find((s) => s.id === "J29")!.status).toBe("SKIPPED");
      await wipe(r.rid, r.manifest);
    } finally { holder.storage.flags.corruptDownloads = false; }
  }, 300_000);

  it("mutation: if a rejected upload were kept in Storage, J25 fails", async () => {
    holder.storage.flags.ignoreRemove = true;
    try {
      const r = await fullRun();
      const j25 = r.evidence.steps.find((s) => s.id === "J25")!;
      expect(j25.status).toBe("FAIL");
      expect(j25.note).toMatch(/must be deleted from Storage/);
      holder.storage.flags.ignoreRemove = false;
      await wipe(r.rid, r.manifest);
    } finally { holder.storage.flags.ignoreRemove = false; }
  }, 300_000);
});
