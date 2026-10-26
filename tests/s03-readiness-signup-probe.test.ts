import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/lib/supabase", () => {
  const ok = { select: () => ({ limit: async () => ({ error: null }) }) };
  return { isSupabaseConfigured: true, supabaseAdmin: { from: () => ok } };
});
vi.mock("../server/lib/rate-limit-store", () => ({ getRateLimitBackend: () => "redis" }));

const env = {
  NODE_ENV: "production",
  APP_URL: "https://portal.example.com",
  SUPABASE_URL: "https://project-ref.supabase.co",
  DATABASE_URL: "postgresql://user:pw@db.project-ref.supabase.co:5432/postgres",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_KEY: "service-key",
  SESSION_SECRET: "a-production-session-secret-with-32-chars",
  AUTH_EMAIL_MODE: "custom_smtp",
};
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

async function readyWith(settings: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(settings), { status: 200 })));
  const { registerHealthRoutes } = await import("../server/routes/health");
  const app = express();
  registerHealthRoutes(app);
  const paths = ["/api/health/ready", "/health/ready", "/ready"];
  for (const path of paths) {
    const response = await request(app).get(path);
    if (response.status !== 404) return response;
  }
  throw new Error("readiness route not found");
}

describe("production readiness Supabase signup probe", () => {
  it("is ready only when public signup is disabled (invitation-only)", async () => {
    const response = await readyWith({ disable_signup: true, external: { email: true } });
    expect(response.status).toBe(200);
    expect(response.body.checks.authEmail).toBe(true);
  });

  it("is not ready when Supabase public signup is enabled", async () => {
    for (const disable_signup of [false, undefined]) {
      const response = await readyWith({ disable_signup, external: { email: true } });
      expect(response.status).toBe(503);
      expect(response.body.checks.authEmail).toBe(false);
    }
  });

  it("is not ready when the email provider is disabled", async () => {
    const response = await readyWith({ disable_signup: true, external: { email: false } });
    expect(response.status).toBe(503);
  });
});
