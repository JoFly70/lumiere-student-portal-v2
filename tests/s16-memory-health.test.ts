import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { evaluateMemoryPressure, getMemoryPressure, MEMORY_PRESSURE_THRESHOLD } from "../server/lib/memory-pressure";

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const normal = {
  heapUsed: 39 * MiB, rss: 121 * MiB,
  heapLimit: 2 * GiB, systemCapacity: 16 * GiB, constrainedCapacity: 4 * GiB,
};
const database = vi.hoisted(() => ({ error: null as { message: string } | null }));
vi.mock("../server/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: {
    from: () => ({ select: () => ({ limit: async () => ({ error: database.error }) }) }),
  },
}));
vi.mock("../server/lib/logger", () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock("../server/lib/rate-limit-store", () => ({ getRateLimitBackend: () => "memory" }));
vi.mock("../server/lib/memory-pressure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/lib/memory-pressure")>();
  return { ...actual, getMemoryPressure: vi.fn() };
});
import { registerHealthRoutes } from "../server/routes/health";
import { logger } from "../server/lib/logger";

describe("real memory-pressure calculation", () => {
  it("does not mistake 39/41 MiB allocated-heap occupancy for memory pressure", () => {
    const result = evaluateMemoryPressure(normal);
    expect(result.status).toBe("ok");
    expect(result.heapUsedRatio).toBeCloseTo(39 / 2048);
    expect(result.rssRatio).toBeCloseTo(121 / 4096);
    expect(result.rssCapacityBytes).toBe(4 * GiB);
    expect(result.capacitySource).toBe("process_constraint");
  });

  it("warns at the actual V8 limit threshold, independently of low RSS", () => {
    expect(evaluateMemoryPressure({ ...normal, heapUsed: 2 * GiB * MEMORY_PRESSURE_THRESHOLD }))
      .toMatchObject({ status: "warning", reasons: ["heap_limit_pressure"] });
  });

  it("warns for native/buffer RSS pressure even when the JS heap is small", () => {
    expect(evaluateMemoryPressure({ ...normal, rss: 4 * GiB * MEMORY_PRESSURE_THRESHOLD }))
      .toMatchObject({ status: "warning", reasons: ["rss_capacity_pressure"] });
  });

  it("reports both pressure signals when both real limits are near exhaustion", () => {
    expect(evaluateMemoryPressure({ ...normal, heapUsed: 2 * GiB, rss: 4 * GiB }).reasons)
      .toEqual(["heap_limit_pressure", "rss_capacity_pressure"]);
  });

  it("does not round below-threshold raw byte usage up into a warning", () => {
    expect(evaluateMemoryPressure({
      ...normal, heapUsed: 1000 * MiB * MEMORY_PRESSURE_THRESHOLD - 1, heapLimit: 1000 * MiB,
    }).status).toBe("ok");
  });

  it.each([0, undefined, Number.POSITIVE_INFINITY])("uses system capacity when constraint %s is unknown", (limit) => {
    expect(evaluateMemoryPressure({ ...normal, constrainedCapacity: limit }))
      .toMatchObject({ rssCapacityBytes: 16 * GiB, capacitySource: "system" });
  });

  it("never chooses a constraint larger than physical system capacity", () => {
    expect(evaluateMemoryPressure({ ...normal, systemCapacity: 2 * GiB }).rssCapacityBytes).toBe(2 * GiB);
  });

  it("can use a valid constraint when system capacity is unavailable", () => {
    expect(evaluateMemoryPressure({ ...normal, systemCapacity: 0 }))
      .toMatchObject({ status: "ok", rssCapacityBytes: 4 * GiB });
  });

  it.each([
    [{ heapLimit: 0 }, "heap_measurement_unavailable"],
    [{ heapLimit: Number.NaN }, "heap_measurement_unavailable"],
    [{ heapUsed: Number.NaN }, "heap_measurement_unavailable"],
    [{ rss: -1 }, "rss_measurement_unavailable"],
    [{ systemCapacity: 0, constrainedCapacity: 0 }, "rss_measurement_unavailable"],
  ])("does not silently report healthy with invalid measurements %j", (invalid, reason) => {
    expect(evaluateMemoryPressure({ ...normal, ...invalid }))
      .toMatchObject({ status: "warning", reasons: [reason] });
  });
});

describe("production health HTTP behavior without any database access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.error = null;
    vi.mocked(getMemoryPressure).mockReturnValue(evaluateMemoryPressure(normal));
    vi.spyOn(process, "memoryUsage").mockReturnValue({
      heapUsed: 39 * MiB, heapTotal: 41 * MiB, rss: 121 * MiB, external: MiB, arrayBuffers: MiB,
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  function app() {
    const application = express();
    registerHealthRoutes(application);
    return application;
  }

  it("returns 200 for the reported normal V8 occupancy while retaining all memory diagnostics", async () => {
    const res = await request(app()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.checks).toEqual({ database: "ok", memory: "ok" });
    expect(res.body.memory).toMatchObject({ heapUsed: 39, heapTotal: 41, rss: 121 });
    expect(res.body.memoryPressure).toMatchObject({ status: "ok", heapLimitBytes: 2 * GiB, rssCapacityBytes: 4 * GiB });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    { heapUsed: 2 * GiB },
    { rss: 4 * GiB },
    { heapLimit: 0 },
  ])("retains HTTP 503 and warning logs for genuine or unknown pressure %j", async (overrides) => {
    vi.mocked(getMemoryPressure).mockReturnValue(evaluateMemoryPressure({ ...normal, ...overrides }));
    const res = await request(app()).get("/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "degraded", checks: { memory: "warning" } });
    expect(logger.warn).toHaveBeenCalledWith("Health check: High memory usage", expect.any(Object));
  });

  it("retains database-error HTTP 503 even when memory is healthy", async () => {
    database.error = { message: "synthetic database failure" };
    const res = await request(app()).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ database: "error", memory: "ok" });
  });

  it("leaves production /ready failed for signup-policy and Redis failures", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://portal.example.com");
    vi.stubEnv("SUPABASE_URL", "https://project-ref.supabase.co");
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@db.project-ref.supabase.co:5432/postgres");
    vi.stubEnv("SUPABASE_ANON_KEY", "synthetic-anon-key");
    vi.stubEnv("SUPABASE_SERVICE_KEY", "synthetic-service-key");
    vi.stubEnv("SESSION_SECRET", "a-synthetic-secret-with-more-than-32-chars");
    vi.stubEnv("AUTH_EMAIL_MODE", "custom_smtp");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      external: { email: true }, disable_signup: false,
    }), { status: 200 })));
    const res = await request(app()).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body.ready).toBe(false);
    expect(res.body.checks.authEmail).toBe(false);
    expect(res.body.checks.distributedRateLimit).toBe(false);
  });
});
