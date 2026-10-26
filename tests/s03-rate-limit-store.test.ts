import fs from "node:fs";
import path from "node:path";
import express from "express";
import rateLimit, { MemoryStore } from "express-rate-limit";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  configureRateLimitBackend,
  createRateLimitStore,
  getRateLimitBackend,
} from "../server/lib/rate-limit-store";

describe("shared rate-limit backend", () => {
  it("moves limiters created before startup onto the shared backend with distinct prefixes", async () => {
    // One MemoryStore per prefix stands in for Redis: two "instances" sharing a
    // prefix share counts, as they would through one Redis server.
    const shared = new Map<string, MemoryStore>();
    const prefixes: string[] = [];

    const limiterOptions = { windowMs: 60_000, limit: 2, standardHeaders: true, legacyHeaders: false };
    const appFor = (store: ReturnType<typeof createRateLimitStore>) => {
      const app = express();
      app.post("/", rateLimit({ ...limiterOptions, store }), (_req, res) => res.status(204).end());
      return app;
    };
    const instanceA = appFor(createRateLimitStore("rl:test-auth:"));
    const instanceB = appFor(createRateLimitStore("rl:test-auth:"));
    const other = appFor(createRateLimitStore("rl:test-other:"));
    expect(getRateLimitBackend()).toBe("memory");

    configureRateLimitBackend((prefix) => {
      prefixes.push(prefix);
      const proxy = {
        init: (options: any) => {
          if (!shared.has(prefix)) {
            const store = new MemoryStore();
            store.init(options);
            shared.set(prefix, store);
          }
        },
        get: (key: string) => shared.get(prefix)!.get(key),
        increment: (key: string) => shared.get(prefix)!.increment(key),
        decrement: (key: string) => shared.get(prefix)!.decrement(key),
        resetKey: (key: string) => shared.get(prefix)!.resetKey(key),
      };
      return proxy;
    });
    expect(getRateLimitBackend()).toBe("redis");
    expect(prefixes).toEqual(expect.arrayContaining(["rl:test-auth:", "rl:test-other:"]));

    expect((await request(instanceA).post("/")).status).toBe(204);
    expect((await request(instanceB).post("/")).status).toBe(204);
    // The third attempt is limited even though it reaches a different instance.
    expect((await request(instanceA).post("/")).status).toBe(429);
    expect((await request(other).post("/")).status).toBe(204);

    for (const store of shared.values()) store.shutdown();
  });

  it("gives every authentication limiter a store from the shared backend", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "server/middleware/rate-limit.ts"), "utf8");
    const limiters = source.match(/export const \w+ = rateLimit\(\{/g) ?? [];
    const stores = source.match(/store: createRateLimitStore\('rl:[a-z-]+:'\)/g) ?? [];
    expect(limiters.length).toBeGreaterThanOrEqual(6);
    expect(stores).toHaveLength(limiters.length);
    expect(new Set(stores).size).toBe(stores.length);
  });

  it("configures Redis stores with sendCommand rather than a shared client store", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "server/index.ts"), "utf8");
    expect(source).toContain("configureRateLimitBackend(");
    expect(source).toContain("sendCommand: (...args: string[]) => redisClient.sendCommand(args)");
    expect(source).not.toMatch(/client:\s*redisClient/);
  });
});
