/**
 * S22 auth email link formats and redirect derivation. LOCAL TESTS ONLY: no
 * Supabase is contacted. Provider behaviour is described in docs/recovery/s22/auth-email.md.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  AUTH_REDIRECT_PATHS,
  authRedirectUrl,
  createResendVerificationHandler,
  exchangeRecoveryTokenHash,
  sendInitialVerificationEmail,
  type VerificationDeps,
} from "../server/lib/email-verification";
import { resolvePasswordResetAppUrl } from "../server/lib/auth-policy";
import { parseVerificationLink } from "../client/src/lib/verification-link";
import { extractRecoveryToken, parseRecoveryLink, recoveryUrlWithoutCredentials } from "../client/src/lib/recovery-token";
import { authEn, authFr } from "../client/src/i18n/modules/auth";

const JWT = "aaaa1111.bbbb2222.cccc3333";
const HASH = "abcdef1234567890";
const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("S22 PKCE ?code= handling (verification)", () => {
  const p = (q: string) => parseVerificationLink(`https://x.test/auth/verify${q}`);
  it("?code= and bare ?token= are reported as unsupported, not generic invalid", () => {
    expect(p("?code=abc123")).toEqual({ kind: "error", reason: "unsupported" });
    expect(p("#code=abc123")).toEqual({ kind: "error", reason: "unsupported" });
    expect(p("?token=pkce_abc&type=signup")).toEqual({ kind: "error", reason: "unsupported" });
  });
  it("token_hash and fragment access_token still work; errors still win over code", () => {
    expect(p(`?token_hash=${HASH}&type=signup`)).toEqual({ kind: "credential", tokenHash: HASH, type: "signup" });
    expect(p(`#access_token=${JWT}&type=signup`)).toEqual({ kind: "credential", accessToken: JWT, type: "signup" });
    expect(p("?code=abc&error_code=otp_expired")).toEqual({ kind: "error", reason: "expired" });
  });
  it("an unsupported-link message and French translation exist and mention requesting a new link", () => {
    expect(authEn["auth.verify.unsupportedBody"]).toMatch(/not supported.*new/i);
    expect(authFr["auth.verify.unsupportedBody"].length).toBeGreaterThan(20);
    expect(authEn["auth.reset.linkUnsupported"]).toMatch(/not supported.*new/i);
    expect(authFr["auth.reset.linkUnsupported"].length).toBeGreaterThan(20);
    expect(authEn["auth.reset.linkExpired"]).toMatch(/expired/i);
  });
  it("the verify page offers the resend path for the unsupported state", () => {
    const src = read("client/src/pages/verify-email.tsx");
    expect(src).toContain("unsupported: 'auth.verify.unsupportedBody'");
    expect(src).toContain("/resend-verification");
  });
});

describe("S22 recovery link parsing", () => {
  const p = (suffix: string) => parseRecoveryLink(`https://x.test/reset-password${suffix}`);
  it("fragment access_token with type=recovery (implicit flow)", () => {
    expect(p(`#access_token=${JWT}&type=recovery`)).toEqual({ kind: "access_token", accessToken: JWT });
    expect(extractRecoveryToken(`https://x.test/reset-password#access_token=${JWT}&type=recovery`)).toBe(JWT);
  });
  it("token_hash with type=recovery (custom template)", () => {
    expect(p(`?token_hash=${HASH}&type=recovery`)).toEqual({ kind: "token_hash", tokenHash: HASH });
  });
  it("token_hash of another type or malformed is invalid (a signup link is not a reset link)", () => {
    expect(p(`?token_hash=${HASH}&type=signup`)).toEqual({ kind: "error", reason: "invalid" });
    expect(p(`?token_hash=short&type=recovery`)).toEqual({ kind: "error", reason: "invalid" });
  });
  it("PKCE ?code= is unsupported; provider errors map to expired/invalid; nothing -> none", () => {
    expect(p("?code=abc")).toEqual({ kind: "unsupported" });
    expect(p("?token=pkce_abc")).toEqual({ kind: "unsupported" });
    expect(p("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")).toEqual({ kind: "error", reason: "expired" });
    expect(p("#error=server_error")).toEqual({ kind: "error", reason: "invalid" });
    expect(p("")).toEqual({ kind: "none" });
  });
  it("query access_token is not accepted; credentials and error params are scrubbed from the URL", () => {
    expect(p(`?access_token=${JWT}&type=recovery`)).toEqual({ kind: "none" });
    expect(recoveryUrlWithoutCredentials(`https://x.test/reset-password?token_hash=${HASH}&type=recovery&keep=1#error=a&error_code=b&error_description=c&expires_in=1`)).toBe("/reset-password?keep=1");
  });
  it("the reset page uses the parsed link and offers the request form with the message", () => {
    const src = read("client/src/pages/reset-password.tsx");
    expect(src).toContain("parseRecoveryLink(window.location.href)");
    expect(src).toContain("auth.reset.linkUnsupported");
    expect(src).toContain("token_hash: recoveryTokenHash");
  });
});

describe("S22 recovery token_hash exchange (server helper)", () => {
  it("returns the recovery session access token only for a valid hash", async () => {
    const exchange = vi.fn(async () => ({ data: { session: { access_token: JWT } }, error: null }));
    expect(await exchangeRecoveryTokenHash(exchange, HASH)).toBe(JWT);
    expect(exchange).toHaveBeenCalledWith({ token_hash: HASH, type: "recovery" });
  });
  it("rejects malformed input without calling the provider", async () => {
    const exchange = vi.fn();
    for (const bad of [undefined, "", "x", 12, { a: 1 }, "has space 123456"]) {
      expect(await exchangeRecoveryTokenHash(exchange as never, bad)).toBeNull();
    }
    expect(exchange).not.toHaveBeenCalled();
  });
  it("expired/used hash, missing session, and provider exceptions all yield null", async () => {
    expect(await exchangeRecoveryTokenHash(async () => ({ data: null, error: { message: "expired" } }), HASH)).toBeNull();
    expect(await exchangeRecoveryTokenHash(async () => ({ data: { session: null }, error: null }), HASH)).toBeNull();
    expect(await exchangeRecoveryTokenHash(async () => { throw new Error("down"); }, HASH)).toBeNull();
  });
  it("update-password exchanges only when a token_hash is sent, after the recovery_type check", () => {
    const src = read("server/routes.ts");
    const i = src.indexOf('app.post("/api/auth/update-password"');
    const body = src.slice(i, src.indexOf("Email verification: success only", i));
    expect(body.indexOf("recovery_type !== 'recovery'")).toBeGreaterThan(-1);
    expect(body.indexOf("recovery_type !== 'recovery'")).toBeLessThan(body.indexOf("exchangeRecoveryTokenHash"));
    expect(body).toContain("hasRecoveryAuthenticationMethod(access_token)");
  });
});

describe("S22 first verification email (admin.createUser sends none)", () => {
  const deps = (over: Partial<VerificationDeps> = {}) => ({
    resend: vi.fn(async () => ({ error: null })),
    appUrl: () => "https://staging.example.app",
    warn: vi.fn(),
    ...over,
  });
  it("sends a signup resend whose redirect derives from APP_URL", async () => {
    const d = deps();
    expect(await sendInitialVerificationEmail(d, "a@example.com")).toBe(true);
    expect(d.resend).toHaveBeenCalledWith("a@example.com", "https://staging.example.app/verify-email");
  });
  it("provider error or exception is non-fatal, logged without the address", async () => {
    for (const d of [deps({ resend: vi.fn(async () => ({ error: { message: "rate limit" } })) }), deps({ resend: vi.fn(async () => { throw new Error("down a@example.com"); }) })]) {
      expect(await sendInitialVerificationEmail(d, "a@example.com")).toBe(false);
      expect(JSON.stringify((d.warn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("a@example.com");
    }
  });
  it("signup route calls it only when ENABLE_EMAIL_VERIFICATION is on, after the invitation is consumed", () => {
    const src = read("server/routes.ts");
    const call = src.indexOf("await sendInitialVerificationEmail(verificationDeps, email)");
    expect(call).toBeGreaterThan(src.indexOf("consumeInvitation(invitationId, authData.user.id)"));
    expect(src.slice(call - 80, call)).toContain("if (emailVerificationEnabled)");
  });
});

describe("S22 redirects derive from APP_URL only", () => {
  it("authRedirectUrl", () => {
    expect(authRedirectUrl("https://a.example", AUTH_REDIRECT_PATHS.resetPassword)).toBe("https://a.example/reset-password");
    expect(authRedirectUrl(null, "/x")).toBeUndefined();
  });
  it("works for the staging origin and for https://lumiereportal.app purely by configuration", () => {
    for (const origin of ["https://staging-portal.example.app", "https://lumiere-student-portal-v-2.replit.app", "https://lumiereportal.app"]) {
      for (const input of [origin, `${origin}/`]) {
        expect(resolvePasswordResetAppUrl(input, true)).toBe(origin);
      }
    }
    expect(resolvePasswordResetAppUrl("http://lumiereportal.app", true)).toBeNull();
    expect(resolvePasswordResetAppUrl("", true)).toBeNull();
  });
  it("resend redirect ignores Host and X-Forwarded-* headers", async () => {
    const resend = vi.fn(async () => ({ error: null }));
    const d: VerificationDeps = {
      isConfigured: () => true, getUser: vi.fn(), verifyOtp: vi.fn(), resend,
      appUrl: () => resolvePasswordResetAppUrl("https://lumiereportal.app", true),
      warn: vi.fn(),
    };
    const a = express();
    a.use(express.json());
    a.post("/resend", createResendVerificationHandler(d));
    await request(a).post("/resend").set("Host", "evil.example").set("X-Forwarded-Host", "evil.example").set("Origin", "https://evil.example").send({ email: "a@example.com" });
    expect(resend).toHaveBeenCalledWith("a@example.com", "https://lumiereportal.app/verify-email");
  });
  it("no server code derives a URL from request host/origin/protocol headers", () => {
    const offenders: string[] = [];
    const bad = /req\.(hostname|protocol|host\b)|headers\.host|get\(\s*['"](host|origin|referer|x-forwarded-host|x-forwarded-proto)['"]|headers\[\s*['"](host|origin|referer|x-forwarded-host)['"]/i;
    for (const f of walk(join(root, "server"))) {
      const text = readFileSync(f, "utf8");
      text.split("\n").forEach((line, i) => { if (bad.test(line)) offenders.push(`${f.replace(root + "/", "")}:${i + 1}`); });
    }
    expect(offenders).toEqual([]);
  });
  it("every redirectTo / emailRedirectTo in server code goes through authRedirectUrl or the APP_URL resolver", () => {
    const hits: string[] = [];
    for (const f of walk(join(root, "server"))) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/\b(redirectTo|emailRedirectTo)\b\s*[:=]/.test(line) && !/authRedirectUrl\(/.test(line)) hits.push(`${f.replace(root + "/", "")}:${i + 1}:${line.trim()}`);
      });
    }
    // The only other assignment is the typed parameter name passed through `resend`.
    expect(hits.filter((h) => !h.includes("emailRedirectTo ? { emailRedirectTo }") && !h.includes("redirectTo: string | undefined"))).toEqual([]);
  });
});

describe("S22 link format guarantees (static)", () => {
  it("the app never opts into PKCE and never exchanges codes; the client bundles no Supabase auth", () => {
    const supabase = read("server/lib/supabase.ts");
    expect(supabase).not.toMatch(/flowType\s*:\s*['"]pkce['"]/);
    for (const f of walk(join(root, "server"))) {
      expect(readFileSync(f, "utf8")).not.toContain("exchangeCodeForSession");
    }
    for (const f of walk(join(root, "client/src"))) {
      const text = readFileSync(f, "utf8");
      expect(text).not.toContain("exchangeCodeForSession");
      expect(text).not.toMatch(/from ['"]@supabase\/supabase-js['"]/);
    }
  });
  it("the app's only auth-email senders are resetPasswordForEmail (server) and auth.resend type signup", () => {
    const senders: string[] = [];
    for (const f of walk(join(root, "server"))) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/\.(resetPasswordForEmail|inviteUserByEmail|signInWithOtp|generateLink)\(|auth\.resend\(/.test(line)) senders.push(`${f.replace(root + "/", "")}:${i + 1}`);
      });
    }
    // admin-student-experience.ts calls auth.admin.generateLink only to mint a session for a SYNTHETIC demo
    // account and exchanges it server-side at once (verifyOtp): admin generateLink sends no email.
    expect(senders.map((s) => s.split(":")[0]).sort()).toEqual(["server/routes.ts", "server/routes.ts", "server/routes/admin-student-experience.ts"]);
  });
});
