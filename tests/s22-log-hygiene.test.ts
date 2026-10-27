import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import winston from "winston";
import { redactString, redactValue, safeRequestContext, scrubSentryEvent } from "../server/lib/log-redaction";

describe("S22 log hygiene", () => {
  it("redacts credentials in strings", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk";
    const out = redactString(
      `GET /auth/verify?token_hash=SECRETHASH&type=signup Bearer abcdefghijkl1234 ${jwt} ` +
        `https://x.supabase.co/storage/v1/object/sign/documents/a.pdf?token=SIGNEDSECRET`,
    );
    for (const leak of ["SECRETHASH", "abcdefghijkl1234", jwt, "SIGNEDSECRET"]) expect(out).not.toContain(leak);
  });

  it("redacts sensitive keys, nested, and keeps integrity checkpoint fields", () => {
    const out = redactValue({
      headers: { authorization: "Bearer zzzzzzzzzzzz", cookie: "sid=1" },
      signedUrl: "https://x/storage/v1/object/sign/b/p?token=abc",
      reply: "private assistant answer", messages: [{ content: "hi" }], fileContent: "pdf bytes",
      event: "assistant_integrity_checkpoint", conversationId: "c1", seq: 3, hash: "deadbeef",
    }) as any;
    expect(JSON.stringify(out)).not.toMatch(/zzzz|sid=1|abc|private assistant|pdf bytes/);
    expect(out).toMatchObject({ event: "assistant_integrity_checkpoint", conversationId: "c1", seq: 3, hash: "deadbeef" });
  });

  it("scrubs Sentry events and drops health probes", () => {
    const evt = scrubSentryEvent({
      request: { url: "https://a/auth/verify?token_hash=S", headers: { authorization: "x" }, cookies: { a: 1 }, data: { password: "p" }, query_string: "token_hash=S" },
    })!;
    expect(JSON.stringify(evt)).not.toMatch(/token_hash|authorization|password|"S"/);
    expect(scrubSentryEvent({ request: { url: "https://a/ready" } })).toBeNull();
  });

  it("request context carries no headers or query", () => {
    expect(Object.keys(safeRequestContext({ method: "GET", path: "/x", ip: "1.1.1.1", headers: { a: 1 } } as any)).sort())
      .toEqual(["ip", "method", "path"]);
  });

  it("the real winston logger redacts meta and still emits assistant_integrity_checkpoint", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    const { logger } = await import("../server/lib/logger");
    const lines: string[] = [];
    const sink = new Writable({ write(chunk, _e, cb) { lines.push(String(chunk)); cb(); } });
    logger.clear();
    logger.add(new winston.transports.Stream({ stream: sink }));
    logger.info("assistant_integrity_checkpoint", { event: "assistant_integrity_checkpoint", conversationId: "c1", ownerUserId: "u", seq: 1, hash: "abc123" });
    logger.warn("bad", { headers: { authorization: "Bearer LEAKLEAKLEAK" }, url: "/x?token_hash=LEAKHASH" });
    await new Promise((r) => setImmediate(r));
    const all = lines.join("");
    expect(all).toContain("assistant_integrity_checkpoint");
    expect(all).toContain("abc123");
    expect(all).not.toMatch(/LEAKLEAKLEAK|LEAKHASH/);
  });

  it("index.ts no longer forwards req.headers / req.url to Sentry or logs query strings", () => {
    const src = readFileSync("server/index.ts", "utf8");
    expect(src).not.toMatch(/headers:\s*req\.headers/);
    expect(src).not.toMatch(/url:\s*req\.url/);
    expect(src).toMatch(/const path = req\.path;/); // request logger uses path without query
  });
});
