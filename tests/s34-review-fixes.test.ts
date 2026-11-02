/** S34 independent-review fixes: limiter store failure is 503 (never 401); Sentry gets no 4xx / handler duplicates; e-mails masked. */
import { afterEach, describe, expect, it } from "vitest";
import { enforceUserRateLimit } from "../server/middleware/rate-limit";
import { logger, setErrorReporter } from "../server/lib/logger";
import { scrubSentryEvent } from "../server/lib/log-redaction";

function fakeRes() {
  const res: any = { statusCode: 200, headersSent: false, body: undefined, listeners: {} as Record<string, () => void> };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; res.headersSent = true; return res; };
  res.once = (e: string, f: () => void) => { res.listeners[e] = f; };
  return res;
}

describe("enforceUserRateLimit fails closed as 503, never rejects", () => {
  it("store error passed to next(err) -> 503 rate_limit_unavailable, request stops", async () => {
    const res = fakeRes();
    const ok = await enforceUserRateLimit({ path: "/api/x" } as any, res, (_q, _s, next) => next(new Error("redis timeout")));
    expect(ok).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: "rate_limit_unavailable" });
  });
  it("synchronous throw is handled the same way", async () => {
    const res = fakeRes();
    const ok = await enforceUserRateLimit({ path: "/api/x" } as any, res, () => { throw new Error("boom"); });
    expect(ok).toBe(false);
    expect(res.statusCode).toBe(503);
  });
  it("allowed request continues", async () => {
    expect(await enforceUserRateLimit({ path: "/api/x" } as any, fakeRes(), (_q, _s, next) => next())).toBe(true);
  });
});

describe("logger -> error tracker filtering", () => {
  const seen: string[] = [];
  afterEach(() => { setErrorReporter(null); seen.length = 0; });
  it("forwards 5xx / unspecified, skips 4xx and handler-reported errors", () => {
    setErrorReporter((e) => seen.push(e.message));
    logger.error("route failed", { error: new Error("db down") });
    logger.error("Request error", { error: { message: "bad json" }, statusCode: 400 });
    logger.error("Request error", { error: { message: "crash" }, statusCode: 500, errorReport: "skip" });
    expect(seen).toEqual(["db down"]);
  });
});

describe("Sentry events mask e-mail addresses", () => {
  it("masks in messages, exception values and extras", () => {
    const evt = scrubSentryEvent({ message: "no user jane.doe@example.com", exception: { values: [{ value: "dup key (email)=(a.b@x.org)" }] }, extra: { route: "/api" } }) as any;
    expect(JSON.stringify(evt)).not.toMatch(/@example\.com|@x\.org/);
    expect(evt.message).toContain("[email]");
  });
});
