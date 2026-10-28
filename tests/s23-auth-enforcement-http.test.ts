/**
 * Real Express routes and disposable local PostgreSQL only.
 * Supabase, invitations, and every email operation are mocked. No inbox/network
 * delivery, dashboard configuration, hosted identities or hosted writes.
 */
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type http from "node:http";
import { PG_BINARIES_AVAILABLE, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";

const f = vi.hoisted(() => ({
  confirmed: false, unexpectedAutoConfirm: false,
  providerId: "00000000-0000-4000-8000-000000000123",
  createUser: vi.fn(), deleteUser: vi.fn(), signIn: vi.fn(), signOut: vi.fn(),
  resend: vi.fn(), release: vi.fn(), claim: vi.fn(), insert: vi.fn(),
  publicSignup: vi.fn(), publicOtp: vi.fn(),
}));
vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account inactive", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"), isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/invitations", async (importOriginal) => ({
  ...await importOriginal<typeof import("../server/lib/invitations")>(),
  claimInvitation: f.claim, consumeInvitation: vi.fn(async () => true),
  releaseInvitation: f.release, normalizeInvitationEmail: (email: string) => email.trim().toLowerCase(),
}));
vi.mock("../server/middleware/rate-limit", async (importOriginal) => ({
  ...await importOriginal<typeof import("../server/middleware/rate-limit")>(),
  // This suite tests policy, not request quotas; no application limits change.
  signupRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  authRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../server/lib/supabase", () => {
  const user = () => ({ id: f.providerId, email: "invite@s23.invalid", email_confirmed_at: f.confirmed ? "2026-01-01T00:00:00Z" : null });
  const chain = () => {
    const q: any = {
      select: () => q, eq: () => q,
      insert: (value: unknown) => { f.insert(value); return Promise.resolve({ error: null }); },
      single: async () => ({ data: { id: f.providerId, email: "invite@s23.invalid", name: "Synthetic", role: "student" }, error: null }),
      maybeSingle: async () => ({ data: { id: f.providerId, email: "invite@s23.invalid", name: "Synthetic", role: "student" }, error: null }),
    };
    return q;
  };
  return {
    isSupabaseConfigured: true,
    supabaseAdmin: { auth: { getUser: async () => ({ data: { user: user() }, error: null }), admin: { createUser: f.createUser, deleteUser: f.deleteUser } }, from: chain },
    createUserAuthClient: () => ({ auth: { signInWithPassword: f.signIn, signOut: f.signOut, resend: f.resend, signUp: f.publicSignup, signInWithOtp: f.publicOtp } }),
  };
});

describe.skipIf(!PG_BINARIES_AVAILABLE)("S23 confirmation enforcement: real HTTP, mocked provider/mail", () => {
  let pg: LocalPg; let app: express.Express; let server: http.Server;
  beforeAll(async () => {
    pg = await startLocalPg();
    vi.stubEnv("DATABASE_URL", pg.url);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ENABLE_EMAIL_VERIFICATION", "true");
    vi.stubEnv("ALLOW_DEMO_MODE", "false");
    vi.stubEnv("APP_URL", "https://staging.example.invalid");
    vi.stubEnv("EMAIL_ENABLED", "false");
    app = express(); app.use(express.json());
    const { registerRoutes } = await import("../server/routes");
    server = await registerRoutes(app);
  }, 300_000);
  afterAll(async () => {
    server?.close();
    await pg?.stop();
    vi.unstubAllEnvs();
  }, 60_000);
  beforeEach(() => {
    vi.clearAllMocks(); f.confirmed = false; f.unexpectedAutoConfirm = false;
    f.claim.mockImplementation(async (token, email) => token === "synthetic-invite" && email === "invite@s23.invalid" ? "synthetic-invitation" : null);
    f.createUser.mockImplementation(async () => ({ data: { user: { id: f.providerId, email_confirmed_at: f.unexpectedAutoConfirm ? "2026-01-01T00:00:00Z" : null } }, error: null }));
    f.resend.mockResolvedValue({ error: null });
    f.signOut.mockResolvedValue({ error: null });
    // Model the public registration endpoints being disabled. The invited
    // workflow must instead use server-admin creation and existing-user resend.
    f.publicSignup.mockResolvedValue({ data: { user: null, session: null }, error: { code: "signup_disabled", message: "Signups not allowed for this instance" } });
    f.publicOtp.mockResolvedValue({ data: { user: null, session: null }, error: { code: "signup_disabled", message: "Signups not allowed for this instance" } });
    f.signIn.mockImplementation(async () => ({
      data: { user: { id: f.providerId, email_confirmed_at: f.confirmed ? "2026-01-01T00:00:00Z" : null }, session: { access_token: "synthetic-access", refresh_token: "synthetic-refresh" } }, error: null,
    }));
  });
  const signup = (extra = {}) => request(app).post("/api/auth/signup").send({ email: "invite@s23.invalid", password: "synthetic-password-only", fullName: "Synthetic", ...extra });
  it("requires an invitation before any identity or email action", async () => {
    expect((await signup()).status).toBe(403);
    expect(f.createUser).not.toHaveBeenCalled(); expect(f.resend).not.toHaveBeenCalled();
  });
  it.each([
    { invitationToken: "wrong" },
    { invitationToken: "synthetic-invite", email: "other@s23.invalid" },
  ])("rejects invalid or email-mismatched invitations", async (body) => {
    expect((await signup(body)).status).toBe(403);
    expect(f.createUser).not.toHaveBeenCalled(); expect(f.resend).not.toHaveBeenCalled();
  });
  it("creates an unconfirmed invited student and returns no automatic session", async () => {
    const r = await signup({ invitationToken: "synthetic-invite" });
    expect(r.status).toBe(200); expect(r.body.emailVerificationRequired).toBe(true);
    expect(r.body.message).toContain("check your email");
    expect(r.body.session).toBeUndefined();
    expect(f.createUser).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: false }));
    expect(f.signIn).not.toHaveBeenCalled();
    expect(f.resend).toHaveBeenCalledWith(expect.objectContaining({ type: "signup", options: { emailRedirectTo: "https://staging.example.invalid/verify-email" } }));
  });
  it("fails closed when the provider unexpectedly auto-confirms the newly created identity", async () => {
    f.unexpectedAutoConfirm = true;
    const r = await signup({ invitationToken: "synthetic-invite" });
    expect(r.status).toBe(503); expect(r.body.session).toBeUndefined();
    expect(f.deleteUser).toHaveBeenCalledWith(f.providerId); expect(f.release).toHaveBeenCalled();
    expect(f.insert).not.toHaveBeenCalled(); expect(f.resend).not.toHaveBeenCalled();
  });
  it("uses admin creation and existing-user resend, not disabled public signup/OTP", async () => {
    const r = await signup({ invitationToken: "synthetic-invite" });
    expect(r.status).toBe(200);
    expect(r.body.emailVerificationRequired).toBe(true);
    expect(r.body.session).toBeUndefined();
    expect(f.createUser).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: false }));
    expect(f.resend).toHaveBeenCalledOnce();
    expect(f.publicSignup).not.toHaveBeenCalled();
    expect(f.publicOtp).not.toHaveBeenCalled();
    expect(f.signIn).not.toHaveBeenCalled();
  });
  it("never falls back to public signup or automatic login when confirmation resend fails", async () => {
    f.resend.mockResolvedValue({ error: { message: "Synthetic mail transport unavailable" } });
    const r = await signup({ invitationToken: "synthetic-invite" });
    expect(r.status).toBe(200);
    expect(r.body.emailVerificationRequired).toBe(true);
    expect(r.body.session).toBeUndefined();
    expect(f.publicSignup).not.toHaveBeenCalled();
    expect(f.publicOtp).not.toHaveBeenCalled();
    expect(f.signIn).not.toHaveBeenCalled();
  });
  it("does not return tokens even when a misconfigured provider issues an unverified login session", async () => {
    const r = await request(app).post("/api/auth/login").send({ email: "invite@s23.invalid", password: "synthetic-password-only" });
    expect(r.status).toBe(403); expect(r.body.code).toBe("EMAIL_VERIFICATION_REQUIRED");
    expect(JSON.stringify(r.body)).not.toContain("synthetic-access");
    expect(f.signOut).toHaveBeenCalledWith({ scope: "global" });
  });
  it("permits a confirmed active account to log in", async () => {
    f.confirmed = true;
    const r = await request(app).post("/api/auth/login").send({ email: "invite@s23.invalid", password: "synthetic-password-only" });
    expect(r.status).toBe(200); expect(r.body.session).toBeDefined();
  });
  it.each(["/api/me", "/api/student/high-school"])("rejects direct/refreshed unconfirmed bearer access to %s", async (url) => {
    const r = await request(app).get(url).set("Authorization", "Bearer synthetic-refreshed-session");
    expect(r.status).toBe(403); expect(r.body.code).toBe("EMAIL_VERIFICATION_REQUIRED");
  });
});
