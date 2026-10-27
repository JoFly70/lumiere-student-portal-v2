import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  createResendVerificationHandler,
  createVerifyEmailHandler,
  RESEND_GENERIC_MESSAGE,
  type VerificationDeps,
} from "../server/lib/email-verification";
import { parseVerificationLink, verificationUrlWithoutCredentials } from "../client/src/lib/verification-link";
import { authEn, authFr } from "../client/src/i18n/modules/auth";

const JWT = "aaaa1111.bbbb2222.cccc3333";
const HASH = "pkce_abcdef123456";

function deps(over: Partial<VerificationDeps> = {}): VerificationDeps {
  return {
    isConfigured: () => true,
    getUser: vi.fn(async () => ({ data: { user: { email_confirmed_at: "2026-01-01T00:00:00Z" } }, error: null })),
    verifyOtp: vi.fn(async () => ({ data: { user: { email_confirmed_at: "2026-01-01T00:00:00Z" } }, error: null })),
    resend: vi.fn(async () => ({ error: null })),
    appUrl: () => "https://portal.example.edu",
    warn: vi.fn(),
    ...over,
  };
}
function app(d: VerificationDeps) {
  const a = express();
  a.use(express.json());
  a.post("/verify", createVerifyEmailHandler(d));
  a.post("/resend", createResendVerificationHandler(d));
  return a;
}

describe("S20 verify-email endpoint", () => {
  it("missing token -> no success", async () => {
    const r = await request(app(deps())).post("/verify").send({});
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ verified: false, code: "MISSING" });
  });
  it("malformed tokens -> no success and provider never called", async () => {
    const d = deps();
    for (const body of [
      { access_token: "not-a-jwt" },
      { access_token: JWT, type: "recovery" },
      { token_hash: "x", type: "signup" },
      { token_hash: HASH, type: "recovery" },
      { access_token: { a: 1 } },
    ]) {
      const r = await request(app(d)).post("/verify").send(body);
      expect(r.status).toBe(400);
      expect(r.body.verified).toBe(false);
    }
    expect(d.getUser).not.toHaveBeenCalled();
    expect(d.verifyOtp).not.toHaveBeenCalled();
  });
  it("expired/replayed (provider error) -> 401, no success", async () => {
    const err = { error: { message: "Email link is invalid or has expired" }, data: { user: null } };
    const d = deps({ verifyOtp: vi.fn(async () => err), getUser: vi.fn(async () => err) });
    const a = await request(app(d)).post("/verify").send({ token_hash: HASH, type: "signup" });
    const b = await request(app(d)).post("/verify").send({ access_token: JWT });
    for (const r of [a, b]) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ verified: false, code: "INVALID_OR_EXPIRED" });
    }
  });
  it("valid token whose email is not confirmed -> no success", async () => {
    const d = deps({ getUser: vi.fn(async () => ({ data: { user: { email_confirmed_at: null } }, error: null })) });
    const r = await request(app(d)).post("/verify").send({ access_token: JWT });
    expect(r.status).toBe(401);
    expect(r.body.verified).toBe(false);
  });
  it("valid token_hash and access_token -> success; credential not echoed or logged", async () => {
    const d = deps();
    const a = await request(app(d)).post("/verify").send({ token_hash: HASH, type: "signup" });
    const b = await request(app(d)).post("/verify").send({ access_token: JWT, type: "signup" });
    for (const r of [a, b]) {
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ verified: true });
      expect(JSON.stringify(r.body)).not.toContain(JWT);
    }
    expect(d.verifyOtp).toHaveBeenCalledWith({ token_hash: HASH, type: "signup" });
    expect(JSON.stringify((d.warn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(JWT);
  });
  it("provider exception -> 503, not success, no secret leaked", async () => {
    const d = deps({ getUser: vi.fn(async () => { throw new Error(`boom ${JWT}`); }) });
    const r = await request(app(d)).post("/verify").send({ access_token: JWT });
    expect(r.status).toBe(503);
    expect(r.body.verified).toBe(false);
    expect(JSON.stringify(r.body)).not.toContain(JWT);
    expect(JSON.stringify((d.warn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(JWT);
  });
});

describe("S20 resend-verification endpoint", () => {
  it("returns an identical generic response for existing and unknown addresses", async () => {
    const ok = deps();
    const unknown = deps({ resend: vi.fn(async () => ({ error: { message: "User not found" } })) });
    const throwing = deps({ resend: vi.fn(async () => { throw new Error("down"); }) });
    const bodies = [];
    for (const d of [ok, unknown, throwing]) {
      const r = await request(app(d)).post("/resend").send({ email: "a@example.com" });
      expect(r.status).toBe(200);
      bodies.push(r.body);
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(bodies[0]).toEqual({ success: true, message: RESEND_GENERIC_MESSAGE });
    expect(JSON.stringify(bodies)).not.toContain("a@example.com");
  });
  it("uses signup resend (never creates accounts) and rejects bad emails", async () => {
    const d = deps();
    expect((await request(app(d)).post("/resend").send({ email: "nope" })).status).toBe(400);
    expect((await request(app(d)).post("/resend").send({})).status).toBe(400);
    expect(d.resend).not.toHaveBeenCalled();
    await request(app(d)).post("/resend").send({ email: "a@example.com" });
    expect(d.resend).toHaveBeenCalledWith("a@example.com", "https://portal.example.edu/verify-email");
  });
  it("does not log the email address", async () => {
    const d = deps({ resend: vi.fn(async () => ({ error: { message: "x" } })) });
    await request(app(d)).post("/resend").send({ email: "private@example.com" });
    expect(JSON.stringify((d.warn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("private@example.com");
  });
});

describe("S20 resend rate limit", () => {
  it("allows three per hour then 429", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    vi.resetModules();
    const mod = await import("../server/lib/email-verification");
    const a = express();
    a.use(express.json());
    a.post("/resend", mod.resendVerificationRateLimit, mod.createResendVerificationHandler(deps()));
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await request(a).post("/resend").send({ email: "r@example.com" })).status);
    process.env.NODE_ENV = prev;
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});

describe("S20 verification link parsing (client)", () => {
  const p = (s: string) => parseVerificationLink(`https://x.test/verify-email${s}`);
  it("missing -> missing", () => expect(p("")).toEqual({ kind: "missing" }));
  it("expired error in hash or query", () => {
    expect(p("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")).toEqual({ kind: "error", reason: "expired" });
    expect(p("?error_code=otp_expired")).toEqual({ kind: "error", reason: "expired" });
  });
  it("other error -> invalid; recovery/PKCE code -> invalid", () => {
    expect(p("#error=access_denied")).toEqual({ kind: "error", reason: "invalid" });
    expect(p(`#access_token=${JWT}&type=recovery`)).toEqual({ kind: "error", reason: "invalid" });
    expect(p("?code=abc")).toEqual({ kind: "error", reason: "unsupported" });
  });
  it("token present is only a credential, never success", () => {
    expect(p(`#access_token=${JWT}&type=signup`)).toEqual({ kind: "credential", accessToken: JWT, type: "signup" });
    expect(p(`?token_hash=${HASH}&type=email`)).toEqual({ kind: "credential", tokenHash: HASH, type: "email" });
    expect(p(`?access_token=${JWT}`)).toEqual({ kind: "missing" });
  });
  it("scrubs credentials from the URL", () => {
    const clean = verificationUrlWithoutCredentials(`https://x.test/verify-email?token_hash=${HASH}&keep=1#access_token=${JWT}&refresh_token=r&type=signup&error_code=otp_expired`);
    expect(clean).toBe("/verify-email?keep=1");
    expect(clean).not.toContain(JWT);
  });
});

describe("S20 verify-email page wiring", () => {
  const src = readFileSync(resolve(process.cwd(), "client/src/pages/verify-email.tsx"), "utf8");
  it("no fake timer success; calls server; strips URL; no logging", () => {
    expect(src).not.toMatch(/setTimeout/);
    expect(src).toContain("/api/auth/verify-email");
    expect(src).toContain("history.replaceState");
    expect(src).not.toMatch(/console\./);
  });
  it("EN/FR keys have parity", () => {
    expect(Object.keys(authFr).sort()).toEqual(Object.keys(authEn).sort());
    expect(authEn["auth.verify.expiredBody"]).toBeTruthy();
  });
});
