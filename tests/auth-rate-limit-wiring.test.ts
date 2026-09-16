import fs from "node:fs";
import path from "node:path";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const originalNodeEnv = process.env.NODE_ENV;
let authRateLimit: RequestHandler;
let passwordResetRateLimit: RequestHandler;
let passwordUpdateRateLimit: RequestHandler;
let signupRateLimit: RequestHandler;

beforeAll(async () => {
  process.env.NODE_ENV = "production";
  const middleware = await import("../server/middleware/rate-limit");
  authRateLimit = middleware.authRateLimit;
  passwordResetRateLimit = middleware.passwordResetRateLimit;
  passwordUpdateRateLimit = middleware.passwordUpdateRateLimit;
  signupRateLimit = middleware.signupRateLimit;
});

afterAll(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

async function requestStatuses(limiter: RequestHandler, count: number) {
  const app = express();
  app.use(express.json());
  app.post("/", limiter, (_req, res) => res.status(204).end());

  const statuses: number[] = [];
  let policy = "";
  for (let attempt = 0; attempt < count; attempt += 1) {
    const response = await request(app)
      .post("/")
      .send({ email: `rate-limit-${count}@example.com`, password: "not-a-secret" });
    statuses.push(response.status);
    policy = response.headers["ratelimit-policy"] ?? policy;
  }
  return { statuses, policy };
}

describe("authentication rate-limit wiring", () => {
  it("keeps login at five attempts per fifteen minutes", async () => {
    const result = await requestStatuses(authRateLimit, 6);
    expect(result.statuses).toEqual([
      204, 204, 204, 204, 204, 429,
    ]);
    expect(result.policy).toMatch(/5;w=900/);
  });

  it("keeps signup at three attempts per hour", async () => {
    const result = await requestStatuses(signupRateLimit, 4);
    expect(result.statuses).toEqual([
      204, 204, 204, 429,
    ]);
    expect(result.policy).toMatch(/3;w=3600/);
  });

  it("keeps password reset at three attempts per hour", async () => {
    const result = await requestStatuses(passwordResetRateLimit, 4);
    expect(result.statuses).toEqual([
      204, 204, 204, 429,
    ]);
    expect(result.policy).toMatch(/3;w=3600/);
  });

  it("gives password updates their own five-attempt limiter", async () => {
    const result = await requestStatuses(passwordUpdateRateLimit, 6);
    expect(result.statuses).toEqual([204, 204, 204, 204, 204, 429]);
    expect(result.policy).toMatch(/5;w=900/);
  });

  it("does not mount a second global auth limiter before request logging", () => {
    const serverSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/index.ts"),
      "utf8",
    );
    const requestLoggerPosition = serverSource.indexOf("// Request logging middleware");
    const routeRegistrationPosition = serverSource.indexOf(
      "const server = await registerRoutes(app)",
    );

    expect(serverSource).not.toMatch(/app\.use\(\s*['"]\/api\/auth['"]/);
    expect(serverSource).not.toContain(
      "const authLimiter = createLimiter(rateLimitConfig.auth)",
    );
    expect(requestLoggerPosition).toBeGreaterThan(-1);
    expect(routeRegistrationPosition).toBeGreaterThan(requestLoggerPosition);
  });
});