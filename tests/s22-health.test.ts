import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const db = vi.hoisted(() => ({ mode: "ok" as "ok" | "error" | "hang" }));
vi.mock("../server/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        limit: () =>
          db.mode === "hang" ? new Promise(() => {}) : Promise.resolve({ error: db.mode === "error" ? { message: "boom SECRETVALUE" } : null }),
      }),
    }),
  },
}));
vi.mock("../server/lib/logger", () => ({ logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../server/lib/rate-limit-store", () => ({ getRateLimitBackend: () => "memory" }));
import { registerHealthRoutes } from "../server/routes/health";

const app = () => { const a = express(); registerHealthRoutes(a); return a; };

describe("S22 health / readiness for Autoscale", () => {
  beforeEach(() => { db.mode = "ok"; vi.useRealTimers(); });

  it("/live is static and never touches the database", async () => {
    db.mode = "hang";
    const res = await request(app()).get("/live");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ alive: true });
  });

  it("/health returns 200 with no secret-bearing fields", async () => {
    const res = await request(app()).get("/health");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/SUPABASE|DATABASE_URL|sb_secret|eyJ|SESSION/i);
    expect(res.body.checks.database).toBe("ok");
  });

  it("/health reports 503 without leaking the database error text", async () => {
    db.mode = "error";
    const res = await request(app()).get("/health");
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain("SECRETVALUE");
  });

  it("/health answers 503 within the probe bound when the database hangs", async () => {
    db.mode = "hang";
    const t0 = Date.now();
    const res = await request(app()).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.checks.database).toBe("error");
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 10000);

  it("/ready (non-production) is 200 when the database answers, 503 when it hangs", async () => {
    expect((await request(app()).get("/ready")).status).toBe(200);
    db.mode = "hang";
    const res = await request(app()).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ready: false });
  }, 10000);

  it("registers no /api/health aliases (they would burn the /api rate limit); probes use /health /ready /live", async () => {
    const a = app();
    expect((await request(a).get("/api/health")).status).toBe(404);
  });
});
