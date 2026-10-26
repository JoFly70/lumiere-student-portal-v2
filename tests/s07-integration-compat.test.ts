/**
 * S07 integration compatibility: S05 roadmap routes alongside the S06 server
 * changes (rate limiter store, Redis readiness, /ready). Only gaps not covered
 * by s05-roadmap-*.test.ts, s06-redis-readiness.test.ts or s03-rate-limit-store.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));

import { registerRoutes } from "../server/routes";
import { authRateLimit } from "../server/middleware/rate-limit";
import { configureRateLimitBackend, getRateLimitBackend, withCommandTimeout } from "../server/lib/rate-limit-store";

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

describe("S07 integration: roadmap routes alongside the S06 server changes", () => {
  it("production registerRoutes mounts every staff and student roadmap route behind requireAuth", async () => {
    const app = express();
    app.use(express.json());
    const server = await registerRoutes(app);
    try {
      const routes: Array<["get" | "post" | "put", string]> = [
        ["get", "/api/admin/students/s-1/roadmap"],
        ["post", "/api/admin/students/s-1/roadmap/imports"],
        ["put", "/api/admin/students/s-1/roadmap/draft"],
        ["post", "/api/admin/students/s-1/roadmap/draft/acknowledge"],
        ["get", "/api/admin/students/s-1/roadmap/draft/preview"],
        ["post", "/api/admin/students/s-1/roadmap/draft/publish"],
        ["post", "/api/admin/students/s-1/roadmap/draft/discard"],
        ["post", "/api/admin/students/s-1/roadmap/draft/from-published"],
        ["get", "/api/student/roadmap"],
        ["post", "/api/student/roadmap/progress"],
      ];
      for (const [method, url] of routes) {
        const res = await request(app)[method](url).send({});
        // 401 proves the route exists (an unmounted path would 404) and that requireAuth runs first.
        expect({ method, url, status: res.status }).toEqual({ method, url, status: 401 });
      }
    } finally {
      server.close();
    }
  });

  it("server/index.ts keeps the S06 order: webhooks, limiters, roadmap JSON parser, default parser, health, routes", () => {
    const src = read("server/index.ts");
    const at = (needle: string) => {
      const i = src.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const adminLimiter = at("app.use('/api/admin', adminLimiter)");
    const apiLimiter = at("app.use('/api', apiLimiter)");
    const roadmapParser = at("roadmap(\\/|$)/, express.json({ limit: '2mb' })");
    const defaultParser = at("app.use(express.json({");
    expect(at("registerWebhookRoutes(app)")).toBeLessThan(adminLimiter);
    expect(adminLimiter).toBeLessThan(apiLimiter);
    expect(apiLimiter).toBeLessThan(roadmapParser);
    expect(roadmapParser).toBeLessThan(defaultParser);
    expect(at("registerHealthRoutes(app)")).toBeLessThan(at("await registerRoutes(app)"));
    expect(src).toContain("configureRateLimitBackend(");
  });

  it("no limiter opts out of fail-closed behaviour (passOnStoreError)", () => {
    for (const file of ["server/index.ts", "server/middleware/rate-limit.ts", "server/routes.ts", "server/lib/rate-limit-store.ts"]) {
      expect(read(file), file).not.toMatch(/passOnStoreError\s*:\s*true/);
    }
  });
});

describe("S07 integration: the real auth limiter fails closed when the shared store is down", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("authRateLimit (not a copy) errors and never reaches the handler while Redis commands fail", async () => {
    // authRateLimit skips itself under NODE_ENV=test; enable it for this request.
    process.env.NODE_ENV = "development";
    // Re-point every registered limiter (including authRateLimit) at a backend whose commands time out.
    configureRateLimitBackend(() => ({
      increment: () => withCommandTimeout(() => new Promise(() => {}), 50),
      decrement: async () => {},
      resetKey: async () => {},
    }));
    expect(getRateLimitBackend()).toBe("redis");

    const handler = vi.fn((...args: unknown[]) => (args[1] as express.Response).status(200).json({ ok: true }));
    const app = express();
    app.post("/api/auth/login", authRateLimit, handler);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express identifies error handlers by arity 4
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: err.message });
    });

    const res = await request(app).post("/api/auth/login");
    expect(res.status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
  });
});
