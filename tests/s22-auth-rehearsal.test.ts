/**
 * Logic tests for scripts/s22/hosted-auth-rehearsal.ts. The "fake app" below is a LOCAL SIMULATION
 * that proves the script's orchestration, expectations and evidence handling. It is NOT hosted
 * evidence: nothing here contacts Supabase or a deployed app.
 */
import { describe, expect, it } from "vitest";
import { deriveTestEmail, forgeJwt, PLAN, runRehearsal, sameHost, type AdminOps } from "../scripts/s22/hosted-auth-rehearsal";
import { redact } from "../scripts/s22/lib/staging-guard";

const APP = "https://staging-portal.example.app";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub: string, n: number) => `${b64({ alg: "HS256" })}.${b64({ sub, exp: 9999999999, n })}.${"S".repeat(43)}`;

function fakeWorld(opts: { leakSessionOnSignup?: boolean; skipInactiveGate?: boolean; badRedirect?: boolean } = {}) {
  const users = new Map<string, any>();
  const tokens = new Map<string, string>(); // token -> userId
  const invitations = new Map<string, string>(); // token -> email
  const hashes = new Map<string, { email: string; type: string }>();
  let n = 0;
  const admin = { id: "adm-1", email: "admin@staging.test", password: "adminpw" };
  const byEmail = (e: string) => [...users.values()].find((u) => u.email === e);

  const respond = (status: number, body: unknown = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  const fetchFake = (async (url: string, init: any = {}) => {
    const u = new URL(url);
    expect(u.origin).toBe(APP);
    const body = init.body ? JSON.parse(init.body) : {};
    const bearer = (init.headers?.Authorization ?? "").replace("Bearer ", "");
    const me = tokens.get(bearer);
    const route = `${init.method} ${u.pathname}`;
    switch (route) {
      case "GET /ready": return respond(200, { ready: true });
      case "POST /api/auth/login": {
        if (body.email === admin.email && body.password === admin.password) {
          const t = jwt(admin.id, ++n); tokens.set(t, admin.id);
          return respond(200, { user: { id: admin.id, email: admin.email, role: "admin" }, session: { access_token: t } });
        }
        const user = byEmail(body.email);
        if (!user || user.password !== body.password || !user.confirmed) return respond(401, { error: "Invalid credentials" });
        if (user.status !== "active") return respond(403, { code: "ACCOUNT_INACTIVE" });
        const t = jwt(user.id, ++n); tokens.set(t, user.id);
        return respond(200, { user: { id: user.id, email: user.email, role: "student" }, session: { access_token: t } });
      }
      case "POST /api/admin/invitations": {
        if (me !== admin.id) return respond(401);
        const token = `inv-${++n}`; invitations.set(token, body.email);
        return respond(201, { id: "i", email: body.email, expiresAt: "x", token });
      }
      case "POST /api/auth/signup": {
        if (!body.invitationToken) return respond(403, { code: "INVITATION_REQUIRED" });
        if (invitations.get(body.invitationToken) !== body.email) return respond(403, { code: "INVITATION_INVALID" });
        invitations.delete(body.invitationToken);
        const id = `u-${++n}`;
        users.set(id, { id, email: body.email, password: body.password, confirmed: false, status: "active" });
        return respond(200, { success: true, user: { id }, ...(opts.leakSessionOnSignup ? { session: { access_token: "x" } } : {}) });
      }
      case "POST /api/auth/resend-verification": return respond(200, { success: true });
      case "GET /auth/verify": return respond(200, "<html></html>");
      case "POST /api/auth/verify-email": {
        const h = hashes.get(body.token_hash);
        if (!h || !["signup", "email"].includes(body.type)) return respond(401, { verified: false });
        hashes.delete(body.token_hash); byEmail(h.email).confirmed = true;
        return respond(200, { verified: true });
      }
      case "GET /api/me": {
        if (!me) return respond(401);
        const user = users.get(me);
        if (user && user.status !== "active" && !opts.skipInactiveGate) return respond(403, { code: "ACCOUNT_INACTIVE" });
        return respond(200, { user: { email: user?.email, role: "student" } });
      }
      case "POST /api/auth/logout": tokens.delete(bearer); return respond(200, { success: true });
      case "POST /api/auth/reset-password": return respond(200, { success: true, message: "If that email is registered" });
      case "POST /api/auth/update-password": {
        const h = hashes.get(body.token_hash);
        if (body.recovery_type !== "recovery" || !h || h.type !== "recovery") return respond(401);
        hashes.delete(body.token_hash);
        byEmail(h.email).password = body.password;
        for (const [t, id] of tokens) if (id === byEmail(h.email).id) tokens.delete(t);
        return respond(200, { success: true });
      }
      default: return respond(404, { route });
    }
  }) as unknown as typeof fetch;

  const ops: AdminOps = {
    async generateLink(type, email, redirectTo) {
      const h = `hash-${++n}-abcdefgh`;
      hashes.set(h, { email, type: type === "recovery" ? "recovery" : "signup" });
      return { hashedToken: h, redirectTo: opts.badRedirect ? "https://wrong.example/x" : redirectTo, verificationType: type === "recovery" ? "recovery" : "signup" };
    },
    async setProfileStatus(id, status) { users.get(id).status = status; },
    async findLocalUserId(email) { return byEmail(email)?.id ?? null; },
    async deleteAccount(id) { users.delete(id); },
  };
  return { fetchFake, ops, users };
}

const base = (w: ReturnType<typeof fakeWorld>, studentId?: string) => ({
  appUrl: APP, fetch: w.fetchFake, admin: w.ops, adminEmail: "admin@staging.test", adminPassword: "adminpw",
  testEmail: "s22-t1@tests.example.org", studentId,
});

describe("S22 hosted-auth rehearsal helpers", () => {
  it("derives a synthetic address from a controlled domain or plus-addressing, and refuses otherwise", () => {
    expect(deriveTestEmail({ S22_TEST_EMAIL_DOMAIN: "Tests.Example.org" }, "Run_1")).toBe("s22-run1@tests.example.org");
    expect(deriveTestEmail({ S22_TEST_INBOX: "owner@gmail.com" }, "r2")).toBe("owner+s22-r2@gmail.com");
    expect(() => deriveTestEmail({}, "r")).toThrow(/S22_TEST_EMAIL_DOMAIN/);
    expect(() => deriveTestEmail({ S22_TEST_INBOX: "a+b@gmail.com" }, "r")).toThrow();
    expect(() => deriveTestEmail({ S22_TEST_EMAIL_DOMAIN: "not a domain" }, "r")).toThrow();
  });
  it("sameHost and forgeJwt", () => {
    expect(sameHost("https://a.app/x?y=1", "https://a.app")).toBe(true);
    expect(sameHost("https://b.app/x", "https://a.app")).toBe(false);
    expect(sameHost(null, "https://a.app")).toBe(false);
    const forged = forgeJwt(jwt("u", 1), { exp: 1 });
    expect(JSON.parse(Buffer.from(forged.split(".")[1], "base64url").toString()).exp).toBe(1);
    expect(forged.split(".")[2]).not.toBe("S".repeat(43));
  });
  it("plan lists every step id once", () => {
    const ids = PLAN.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["register", "verify_via_app", "login", "session_check", "logout", "password_reset", "inactive_denied", "student_linkage", "natural_expiry"]) expect(ids).toContain(id);
  });
});

describe("S22 hosted-auth rehearsal orchestration (LOCAL SIMULATION, not hosted evidence)", () => {
  it("passes every automatable step against a conforming fake and marks the rest NOT_RUN", async () => {
    const w = fakeWorld();
    const steps = await runRehearsal(base(w));
    const status = Object.fromEntries(steps.map((s) => [s.id, s.status]));
    expect(status).toMatchObject({
      preflight: "REAL_PASS", admin_login: "REAL_PASS", uninvited_denied: "REAL_PASS", invitation_created: "REAL_PASS",
      wrong_email_denied: "REAL_PASS", register: "REAL_PASS", unverified_login_denied: "REAL_PASS", delivery_request: "REAL_PASS",
      verification_link: "REAL_PASS", verify_via_app: "REAL_PASS", login: "REAL_PASS", session_check: "REAL_PASS",
      session_invalid_denied: "REAL_PASS", logout: "REAL_PASS", recovery_request: "REAL_PASS", recovery_link: "REAL_PASS",
      password_reset: "REAL_PASS", inactive_denied: "REAL_PASS", cleanup: "REAL_PASS",
      student_linkage: "NOT_RUN", natural_expiry: "NOT_RUN",
    });
    expect(w.users.size).toBe(0); // synthetic account removed
  });
  it("detects a session issued before verification", async () => {
    const steps = await runRehearsal(base(fakeWorld({ leakSessionOnSignup: true })));
    expect(steps.find((s) => s.id === "register")!.status).toBe("REAL_FAIL");
    expect(steps.find((s) => s.id === "verify_via_app")!.status).toBe("NOT_RUN");
  });
  it("detects an inactive account that is still served, and restores the status", async () => {
    const w = fakeWorld({ skipInactiveGate: true });
    const steps = await runRehearsal({ ...base(w), keepUser: true });
    expect(steps.find((s) => s.id === "inactive_denied")!.status).toBe("REAL_FAIL");
    expect([...w.users.values()][0].status).toBe("active");
  });
  it("detects a redirect host that is not APP_URL (allow-list / Site URL misconfigured)", async () => {
    const steps = await runRehearsal(base(fakeWorld({ badRedirect: true })));
    expect(steps.find((s) => s.id === "verification_link")!.status).toBe("REAL_FAIL");
    expect(steps.find((s) => s.id === "verify_via_app")!.status).toBe("NOT_RUN");
  });
  it("waits for the app's rate limiter on 429 and retries once; fails fast with --no-wait", async () => {
    const w = fakeWorld();
    let hits = 0;
    const limited = (async (url: string, init: any) => {
      if (String(url).endsWith("/api/auth/login") && hits++ === 0) return new Response("{}", { status: 429, headers: { "RateLimit-Reset": "30" } });
      return w.fetchFake(url, init);
    }) as unknown as typeof fetch;
    const sleeps: number[] = [];
    const waited = await runRehearsal({ ...base(w), fetch: limited, waitOnRateLimit: true, sleep: async (ms) => { sleeps.push(ms); } });
    expect(sleeps).toEqual([31000]);
    expect(waited.find((s) => s.id === "admin_login")!.status).toBe("REAL_PASS");

    hits = 0;
    const fast = await runRehearsal({ ...base(fakeWorld()), fetch: limited, waitOnRateLimit: false });
    expect(fast.find((s) => s.id === "admin_login")!.status).toBe("REAL_FAIL");
  });
  it("evidence carries no tokens, passwords or hashed tokens after redaction", async () => {
    const steps = await runRehearsal(base(fakeWorld()));
    const text = redact(JSON.stringify(steps));
    expect(text).not.toMatch(/hash-\d+-abcdefgh|inv-\d+|adminpw|S22!/);
    expect(text).not.toMatch(/eyJ/);
  });
});
