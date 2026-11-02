/**
 * S34 / S33-02: per-user rate limiting, login/refresh separation, single general limiter, 429 UX,
 * transient-429 session handling, and the programs-lookup failure state.
 */
import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import React, { createElement } from "react";
(globalThis as any).React = React; // classic JSX runtime in client sources under vitest
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
const live = { skip: () => false };

// ---- mocks for exercising the REAL requireAuth without a database or Supabase ---------------------------------
const tokens: Record<string, { id: string; role: string }> = {
  "tok-ann": { id: "u-ann", role: "staff" },
  "tok-bob": { id: "u-bob", role: "admin" },
  "tok-cy": { id: "u-cy", role: "staff" },
};
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: {
    auth: {
      getUser: async (token: string) => {
        const t = tokens[token];
        return t ? { data: { user: { id: t.id, email: `${t.id}@x.test` } }, error: null } : { data: { user: null }, error: { message: "invalid jwt" } };
      },
    },
  },
}));
vi.mock("../server/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  },
}));
vi.mock("../server/lib/account-status", () => ({ isAccountActive: async () => true, ACCOUNT_INACTIVE_RESPONSE: { error: "inactive" } }));
vi.mock("../server/lib/auth-policy", () => ({
  emailVerificationRequired: () => false,
  hasRequiredEmailConfirmation: () => true,
  EMAIL_VERIFICATION_REQUIRED_RESPONSE: { error: "verify" },
}));

const originalEnv = process.env.NODE_ENV;
let mw: typeof import("../server/middleware/rate-limit");
let authMod: typeof import("../server/middleware/auth");
let cfg: typeof import("../server/config/production");

beforeAll(async () => {
  process.env.NODE_ENV = "production"; // limiters skip only when NODE_ENV === 'test'
  cfg = await import("../server/config/production");
  mw = await import("../server/middleware/rate-limit");
  authMod = await import("../server/middleware/auth");
});
afterAll(() => {
  process.env.NODE_ENV = originalEnv;
});

/** requireAuth variant: real middleware but the DB lookup is replaced by the token table. */
function fakeVerifiedAuth(): express.RequestHandler {
  return (req, res, next) => {
    const t = tokens[(req.headers.authorization ?? "").replace("Bearer ", "")];
    if (!t) return res.status(401).json({ error: "Invalid or expired token" });
    req.user = { id: t.id, email: `${t.id}@x.test`, role: t.role };
    next();
  };
}

function buildApp(opts: { ceiling?: number; user?: number; admin?: number } = {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api", mw.createIpCeilingLimiter({ ...live, max: opts.ceiling ?? cfg.rateLimitConfig.ipCeiling.max }));
  const post = mw.createPostAuthRateLimit(
    mw.createUserLimiter("t:user:", cfg.rateLimitConfig.user, "user", { ...live, max: opts.user ?? cfg.rateLimitConfig.user.max }),
    mw.createUserLimiter("t:admin:", cfg.rateLimitConfig.adminUser, "admin-user", { ...live, max: opts.admin ?? cfg.rateLimitConfig.adminUser.max }),
  );
  app.use("/api", (req, res, next) => {
    const t = tokens[(req.headers.authorization ?? "").replace("Bearer ", "")];
    if (!t) return next(); // unauthenticated traffic only meets the IP ceiling
    fakeVerifiedAuth()(req, res, () => post(req, res, next));
  });
  app.use("/api", (req, res) => res.json({ ok: true, user: req.user?.id ?? null }));
  return app;
}
const as = (app: express.Express, tok: string, url = "/api/students") => request(app).get(url).set("Authorization", `Bearer ${tok}`);

describe("per-user budgets (verified identity)", () => {
  it("three staff behind one IP work normally with independent budgets", async () => {
    const app = buildApp({ user: 20, ceiling: 1000 });
    for (let i = 0; i < 20; i++) {
      for (const t of ["tok-ann", "tok-bob", "tok-cy"]) expect((await as(app, t)).status).toBe(200);
    }
  });

  it("exhausting one user's budget only affects that user", async () => {
    const app = buildApp({ user: 5, ceiling: 1000 });
    for (let i = 0; i < 5; i++) expect((await as(app, "tok-ann")).status).toBe(200);
    const blocked = await as(app, "tok-ann");
    expect(blocked.status).toBe(429);
    expect((await as(app, "tok-cy")).status).toBe(200);
    expect((await as(app, "tok-bob")).status).toBe(200);
  });

  it("admin routes have an additional per-user budget that does not touch other users", async () => {
    const app = buildApp({ user: 100, admin: 3, ceiling: 1000 });
    for (let i = 0; i < 3; i++) expect((await as(app, "tok-bob", "/api/admin/x")).status).toBe(200);
    const blocked = await as(app, "tok-bob", "/api/admin/x");
    expect(blocked.status).toBe(429);
    expect(blocked.body.scope).toBe("admin-user");
    expect((await as(app, "tok-bob", "/api/students")).status).toBe(200); // non-admin path unaffected
    expect((await as(app, "tok-ann", "/api/admin/x")).status).toBe(200);
  });

  it("keys only from verified auth: x-user-id and friends cannot choose or dodge a bucket", async () => {
    const app = buildApp({ user: 3, ceiling: 1000 });
    for (let i = 0; i < 3; i++) {
      expect((await as(app, "tok-ann").set("x-user-id", `forged-${i}`).set("x-forwarded-user", "evil")).status).toBe(200);
    }
    expect((await as(app, "tok-ann").set("x-user-id", "someone-else")).status).toBe(429);
    // and a forged id cannot spend somebody else's budget
    expect((await as(app, "tok-cy").set("x-user-id", "u-ann")).status).toBe(200);
    const req = { user: { id: "u-real" }, headers: { "x-user-id": "forged" }, ip: "1.2.3.4" } as any;
    expect(mw.verifiedUserKey(req)).toBe("user:u-real");
    expect(mw.verifiedUserKey({ headers: { "x-user-id": "forged" }, ip: "1.2.3.4" } as any)).toBe("anon:1.2.3.4");
  });

  it("the real requireAuth runs the per-user limiter after verifying the token (per-user, 600 default)", async () => {
    const app = express();
    app.use("/api", authMod.requireAuth, (req, res) => res.json({ id: req.user?.id }));
    const first = await as(app, "tok-ann");
    // db mock returns no profile: requireAuth answers 401 before limiting, proving identity comes from the verified path only.
    expect(first.status).toBe(401);
    const src = read("server/middleware/auth.ts");
    expect(src.match(/await enforceUserRateLimit\(req, res\)/g)?.length).toBe(2);
    expect(src.indexOf("req.user = {")).toBeLessThan(src.indexOf("await enforceUserRateLimit(req, res)"));
  });

  it("counts a request once even if auth middleware runs twice", async () => {
    const post = mw.createPostAuthRateLimit(
      mw.createUserLimiter("t:once:", cfg.rateLimitConfig.user, "user", { ...live, max: 2 }),
      mw.createUserLimiter("t:once-a:", cfg.rateLimitConfig.adminUser, "admin-user", { ...live, max: 2 }),
    );
    const app = express();
    app.use((req, _res, next) => { req.user = { id: "u-twice", email: "t@x", role: "staff" }; next(); });
    app.get("/api/y", post, post, (_req, res) => res.json({ ok: true }));
    expect((await request(app).get("/api/y")).status).toBe(200);
    expect((await request(app).get("/api/y")).status).toBe(200);
    expect((await request(app).get("/api/y")).status).toBe(429);
  });

  it("a long admin session (15 min of 60 s polling plus browsing) and 3 staff on one IP stay under the limits", async () => {
    const app = buildApp(); // production values
    const staff = ["tok-ann", "tok-bob", "tok-cy"];
    for (let minute = 0; minute < 15; minute++) {
      for (const t of staff) {
        // diagnostics poll + support-desk poll + one page view (~14 requests, ~8 of them admin)
        const calls = ["/api/admin/diagnostics", "/api/tickets", ...Array(8).fill("/api/admin/students"), ...Array(6).fill("/api/students")];
        for (const url of calls) {
          const r = await as(app, t, url);
          if (r.status !== 200) throw new Error(`minute ${minute} ${t} ${url} -> ${r.status}`);
        }
      }
    }
    // 3 staff x 15 x 16 = 720 requests from one IP, below the 1500 ceiling; each user 240 (< 600), admin 150 (< 300)
    expect(3 * 15 * 16).toBeLessThan(cfg.rateLimitConfig.ipCeiling.max);
    expect(15 * 16).toBeLessThan(cfg.rateLimitConfig.user.max);
    expect(15 * 10).toBeLessThan(cfg.rateLimitConfig.adminUser.max);
  }, 60_000);

  it("keeps the IP ceiling for unauthenticated traffic", async () => {
    const app = buildApp({ ceiling: 3 });
    for (let i = 0; i < 3; i++) expect((await request(app).get("/api/public")).status).toBe(200);
    expect((await request(app).get("/api/public")).status).toBe(429);
  });
});

describe("login and refresh", () => {
  function authApp() {
    const app = express();
    app.use(express.json());
    app.post("/api/auth/login", mw.createLoginLimiter({ ...live, max: cfg.rateLimitConfig.login.max }), (req, res) =>
      req.body.password === "right" ? res.json({ ok: true }) : res.status(401).json({ error: "Invalid credentials" }));
    app.post("/api/auth/refresh", mw.createRefreshLimiter(live), (_req, res) => res.json({ session: {} }));
    return app;
  }

  it("blocks login brute force after the configured number of failures", async () => {
    const app = authApp();
    const max = cfg.rateLimitConfig.login.max;
    expect(max).toBeLessThanOrEqual(10);
    for (let i = 0; i < max; i++) expect((await request(app).post("/api/auth/login").send({ password: "bad" })).status).toBe(401);
    const blocked = await request(app).post("/api/auth/login").send({ password: "bad" });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: "rate_limited", scope: "login" });
    expect(typeof blocked.body.retryAfter).toBe("number");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    // even the right password is refused while blocked
    expect((await request(app).post("/api/auth/login").send({ password: "right" })).status).toBe(429);
  });

  it("successful sign-ins (a whole office in the morning) do not consume the login budget", async () => {
    const app = authApp();
    for (let i = 0; i < 25; i++) expect((await request(app).post("/api/auth/login").send({ password: "right" })).status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ password: "bad" })).status).toBe(401);
  });

  it("refresh has its own bucket: renewals never exhaust login, and a blocked login never blocks renewals", async () => {
    const app = authApp();
    for (let i = 0; i < 30; i++) expect((await request(app).post("/api/auth/refresh").send({})).status).toBe(200);
    for (let i = 0; i < cfg.rateLimitConfig.login.max; i++) await request(app).post("/api/auth/login").send({ password: "bad" });
    expect((await request(app).post("/api/auth/login").send({ password: "bad" })).status).toBe(429);
    expect((await request(app).post("/api/auth/refresh").send({})).status).toBe(200);
    expect(cfg.rateLimitConfig.refresh.max).toBeGreaterThan(cfg.rateLimitConfig.login.max);
  });

  it("429 bodies are clean JSON with a stable code", async () => {
    const app = express();
    app.get("/", mw.createIpCeilingLimiter({ ...live, max: 1 }), (_r, res) => res.json({}));
    await request(app).get("/");
    const r = await request(app).get("/");
    expect(r.status).toBe(429);
    expect(r.body.code).toBe("rate_limited");
    expect(r.body.error).not.toMatch(/IP/);
    expect(r.body.retryAfter).toBeGreaterThan(0);
  });
});

describe("wiring: one general limiter, middleware order", () => {
  it("the duplicate /api limiter is gone; index.ts mounts exactly one IP ceiling", () => {
    const index = read("server/index.ts");
    const routes = read("server/routes.ts");
    const limiter = read("server/middleware/rate-limit.ts");
    expect(index.match(/app\.use\(['"]\/api['"],/g)?.filter((m) => m).length).toBeGreaterThanOrEqual(1);
    expect(index.match(/app\.use\('\/api', ipCeilingRateLimit\)/g)?.length).toBe(1);
    expect(index).not.toMatch(/apiLimiter|adminLimiter|app\.use\('\/api\/admin', /);
    expect(routes).not.toMatch(/apiRateLimit/);
    expect(routes).not.toMatch(/app\.use\(\s*["']\/api["']\s*,\s*\w*[Rr]ate/);
    expect(limiter).not.toMatch(/export const apiRateLimit/);
    // the ceiling is mounted before body parsing and the request logger, and before routes
    expect(index.indexOf("ipCeilingRateLimit)")).toBeLessThan(index.indexOf("// Request logging middleware"));
  });

  it("login uses the failure-only limiter and refresh a separate one", () => {
    const routes = read("server/routes.ts");
    expect(routes).toMatch(/app\.post\("\/api\/auth\/login", loginRateLimit,/);
    expect(routes).toMatch(/app\.post\("\/api\/auth\/refresh", refreshRateLimit,/);
    expect(routes).not.toMatch(/\/api\/auth\/(login|refresh)", authRateLimit/);
  });

  it("is a single counter for an /api request (the ceiling) plus the per-user one only after auth", async () => {
    const app = buildApp({ ceiling: 4, user: 1000 });
    // Authenticated requests hit the ceiling exactly once each
    for (let i = 0; i < 4; i++) expect((await as(app, "tok-ann")).status).toBe(200);
    expect((await as(app, "tok-ann")).status).toBe(429);
  });

  it("configured limits match the documented numbers", () => {
    const c = cfg.rateLimitConfig;
    expect([c.ipCeiling.max, c.user.max, c.adminUser.max, c.login.max, c.refresh.max]).toEqual([1500, 600, 300, 10, 60]);
  });
});

// ---- client -----------------------------------------------------------------------------------------------------
function stubLanguage(lang: "en" | "fr") {
  vi.stubGlobal("localStorage", { getItem: (k: string) => (k === "lumiere_language" ? lang : null), setItem: () => {}, removeItem: () => {} });
}
const resp429 = (retryAfter?: string) =>
  ({
    ok: false,
    status: 429,
    statusText: "Too Many Requests",
    headers: { get: (h: string) => (h.toLowerCase() === "retry-after" ? retryAfter ?? null : null) },
    json: async () => ({ error: "Too many requests. Please wait a minute and try again.", code: "rate_limited" }),
    text: async () => '{"error":"Too many requests. Please slow down."}',
  }) as unknown as Response;

describe("429 client messages", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["en", /wait a minute/i, /try again/i],
    ["fr", /patienter une minute/i, /réessayer/i],
  ] as const)("apiRequest (queryClient) and api.get show one friendly %s message", async (lang, wait, again) => {
    stubLanguage(lang);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resp429()));
    const { apiRequest, RateLimitedError } = await import("../client/src/lib/queryClient");
    const { api, ApiError } = await import("../client/src/lib/api");
    const e1 = await apiRequest("GET", "/api/x").catch((e) => e);
    expect(e1).toBeInstanceOf(RateLimitedError);
    expect(e1.message).toMatch(wait);
    expect(e1.message).toMatch(again);
    expect(e1.message).not.toMatch(/\{|429:|"error"/);
    const e2 = await api.get("/api/x").catch((e) => e);
    expect(e2).toBeInstanceOf(ApiError);
    expect(e2.status).toBe(429);
    expect(e2.code).toBe("rate_limited");
    expect(e2.message).toBe(e1.message);
  });

  it("mentions minutes only when Retry-After is long, in both languages", async () => {
    const { rateLimitedMessage, parseRetryAfterSeconds } = await import("../client/src/lib/rate-limit-message");
    expect(parseRetryAfterSeconds("600")).toBe(600);
    expect(parseRetryAfterSeconds("Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
    stubLanguage("fr");
    expect(rateLimitedMessage(600)).toMatch(/10 min/);
    stubLanguage("en");
    expect(rateLimitedMessage(600)).toMatch(/10 min/);
    expect(rateLimitedMessage(30)).not.toMatch(/min,/);
  });
});

describe("transient failures never sign the user out or show the wrong deck", () => {
  it("a 429 on refresh is transient: only a refusal expires the session", () => {
    const src = read("client/src/lib/auth.tsx");
    expect(src).toMatch(/if \(res\.status === 401 \|\| res\.status === 403\) \{ lastOutcome = 'rejected'; expire\(\)/);
    expect(src).toMatch(/lastOutcome = 'transient';\s*\n\s*const retryAfter = res\.status === 429/);
    expect(src).toMatch(/lastOutcome === 'rejected' && session\.expires_at/);
    // the 429 branch itself never calls expire()
    const branch = src.slice(src.indexOf("S34: 429"), src.indexOf("} catch {", src.indexOf("S34: 429")));
    expect(branch).not.toMatch(/expire\(\)/);
  });

  it("a high-school student whose programs lookup fails sees a retry state, not the bachelor deck", async () => {
    vi.resetModules();
    vi.doMock("@/pages/flight-deck", () => ({ default: () => createElement("div", null, "UNIVERSITY-DECK") }));
    vi.doMock("@/pages/high-school-flight-deck", () => ({ default: () => createElement("div", null, "HS-DECK") }));
    vi.doMock("@/components/student-progress/student-ui", () => ({ StudentSurface: ({ children }: any) => createElement("main", null, children) }));
    const state: any = { isLoading: false, hasHighSchool: false, highSchoolOnly: false, lookupFailed: true, retry: () => {} };
    vi.doMock("@/lib/student-programs", async () => {
      const real = await vi.importActual<any>("@/lib/student-programs");
      return { ...real, useStudentPrograms: () => state };
    });
    stubLanguage("fr");
    const { default: Router } = await import("../client/src/pages/flight-deck-router");
    const { I18nProvider } = await import("../client/src/i18n");
    const wrap = (C: any) => createElement(I18nProvider, { initialLanguage: "fr", children: createElement(C) });
    const failed = renderToStaticMarkup(wrap(Router));
    expect(failed).not.toContain("UNIVERSITY-DECK");
    expect(failed).toContain("programs-load-error");
    expect(failed).toContain("Réessayer");
    // healthy answers still pick the right deck
    state.lookupFailed = false;
    state.highSchoolOnly = true;
    expect(renderToStaticMarkup(wrap(Router))).toContain("HS-DECK");
    state.highSchoolOnly = false;
    expect(renderToStaticMarkup(wrap(Router))).toContain("UNIVERSITY-DECK");
    vi.unstubAllGlobals();
    vi.doUnmock("@/lib/student-programs");
  });
});
