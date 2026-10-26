import { EventEmitter } from "node:events";
import express from "express";
import rateLimit from "express-rate-limit";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  checkRedisHealth,
  configureRateLimitBackend,
  createRateLimitStore,
  getRateLimitBackend,
  setRateLimitBackendHealthy,
  trackRedisHealth,
  withCommandTimeout,
} from "../server/lib/rate-limit-store";

// Fake node-redis client: events, isReady and ping are all this code relies on.
class FakeRedis extends EventEmitter {
  isReady = false;
  pingImpl: () => Promise<unknown> = async () => "PONG";
  ping() { return this.pingImpl(); }
}

describe("redis readiness tracking (mocked client)", () => {
  it("follows ready, disconnect, failed ping and recovery", async () => {
    const client = new FakeRedis();
    trackRedisHealth(client);
    configureRateLimitBackend(() => ({
      increment: async () => ({ totalHits: 1, resetTime: new Date() }),
      decrement: async () => {},
      resetKey: async () => {},
    }));

    client.isReady = true;
    client.emit("ready");
    expect(getRateLimitBackend()).toBe("redis");

    client.isReady = false;
    client.emit("reconnecting");
    expect(getRateLimitBackend()).toBe("memory"); // /ready: distributedRateLimit false

    client.isReady = true;
    client.emit("ready");
    expect(getRateLimitBackend()).toBe("redis");

    client.emit("end");
    expect(getRateLimitBackend()).toBe("memory");
    client.emit("ready");
    expect(getRateLimitBackend()).toBe("redis");

    // A command-level error on a ready client does not flip readiness...
    client.emit("error", new Error("ERR something"));
    expect(getRateLimitBackend()).toBe("redis");
    // ...but an error while not ready does.
    client.isReady = false;
    client.emit("error", new Error("ECONNREFUSED"));
    expect(getRateLimitBackend()).toBe("memory");

    // Failed ping -> not ready; successful ping on a ready client -> ready again.
    client.pingImpl = async () => { throw new Error("The client is closed"); };
    expect(await checkRedisHealth(client)).toBe(false);
    expect(getRateLimitBackend()).toBe("memory");
    client.isReady = true;
    client.pingImpl = async () => "PONG";
    expect(await checkRedisHealth(client)).toBe(true);
    expect(getRateLimitBackend()).toBe("redis");

    // A ping that stalls is bounded and counts as a failure.
    client.pingImpl = () => new Promise(() => {});
    vi.useFakeTimers();
    const pending = checkRedisHealth(client);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await pending).toBe(false);
    vi.useRealTimers();
    expect(getRateLimitBackend()).toBe("memory");
    setRateLimitBackendHealthy(true);
  });
});

describe("bounded Redis commands (mocked)", () => {
  it("rejects a stalled command within the bound instead of hanging", async () => {
    const started = Date.now();
    await expect(withCommandTimeout(() => new Promise(() => {}), 50)).rejects.toThrow(/timed out after 50ms/);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("passes through results and rejections of prompt commands", async () => {
    await expect(withCommandTimeout(async () => "OK", 50)).resolves.toBe("OK");
    await expect(withCommandTimeout(async () => { throw new Error("boom"); }, 50)).rejects.toThrow("boom");
    await expect(withCommandTimeout(() => { throw new Error("sync"); }, 50)).rejects.toThrow("sync");
  });
});

describe("fail-closed limiter on a failing store (mocked)", () => {
  it("returns an error and never reaches the handler", async () => {
    const store = createRateLimitStore("rl:s06-fail:");
    const handler = vi.fn((_req, res) => res.status(204).end());
    const app = express();
    app.post(
      "/",
      rateLimit({ windowMs: 60_000, limit: 5, store, validate: false }),
      handler,
    );
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: err.message });
    });

    // Store calls reject, as a bounded command does while Redis is down.
    store.attach(() => ({
      increment: () => withCommandTimeout(() => new Promise(() => {}), 50),
      decrement: async () => {},
      resetKey: async () => {},
    }));

    const res = await request(app).post("/");
    expect(res.status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
  });
});
