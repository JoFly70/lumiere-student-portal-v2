/**
 * S32-B (SA-03) role boundaries on the REAL server: the Express app from `registerRoutes`, real requireAuth / role
 * guards / CSRF, a real local Postgres. Synthetic data only.
 *
 * Staff now open the primary Student File, so the reads it makes must work for staff; every operation that stays
 * administrator-only (Advanced Workspace, activity feed, account link / unlink / email correction, activation,
 * agreement edits, checkpoints and session changes, placements, Owner AI, view-as-student, invitations, user
 * administration, import approval) must still be refused for staff, and coaches are refused all of it.
 * Each request carries a valid CSRF token for its user, so a 403 here is the role guard, not CSRF.
 */
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { applyS09Migration } from "./helpers/s09-apply-migration";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, s05MigrationExists, seedStudent, seedUser, startLocalPg, type LocalPg, type SeededStudent, type SeededUser } from "./helpers/s05-local-pg";

const JWT_SECRET = process.env.SESSION_SECRET || "local-dev-secret-change-in-production";
function makeLocalJWT(userId: string, email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ userId, email, iss: "lumiere-local", exp: now + 3600, iat: now, sub: userId, aud: "authenticated", role: "authenticated" })).toString("base64url");
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: { auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "invalid token" } })) }, from: vi.fn() },
  createUserAuthClient: vi.fn(),
  isSupabaseConfigured: vi.fn(() => false),
}));

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);
const ready = PG_BINARIES_AVAILABLE && s05MigrationExists();
const UUID = () => crypto.randomUUID();

describe.skipIf(!ready)("S32-B staff may open the Student File; admin-only operations stay admin-only", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let staff: SeededUser;
  let coach: SeededUser;
  let student: SeededStudent;
  let generateCsrfToken: (id: string) => string;

  const as = (u: SeededUser) => ({ Authorization: `Bearer ${makeLocalJWT(u.id, u.email)}`, "X-CSRF-Token": generateCsrfToken(u.id) });
  const send = (u: SeededUser, method: string, path: string, body?: unknown) =>
    (request(base) as unknown as Record<string, (p: string) => request.Test>)[method](path).set(as(u)).send((body ?? {}) as object);

  beforeAll(async () => {
    pg = await startLocalPg();
    await applyS09Migration(pg); // profile tables (the Student File header and Guardian panel read them)
    process.env.DATABASE_URL = pg.url;
    delete process.env.ALLOW_DEMO_MODE;
    staff = await seedUser(pg, "staff");
    coach = await seedUser(pg, "coach");
    student = await seedStudent(pg, {});
    ({ generateCsrfToken } = await import("../server/middleware/csrf"));
    const { registerRoutes } = await import("../server/routes");
    const app = express();
    app.use(express.json());
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 300_000);
  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pg?.stop();
  }, 60_000);

  const s = () => student.id;
  const adminOnly = (): Array<[string, string, unknown?]> => [
    ["get", `/api/admin/students/${s()}/workspace`],
    ["get", `/api/admin/students/${s()}/activity`],
    ["get", `/api/admin/students/${s()}/account`],
    ["post", `/api/admin/students/${s()}/account/link`, { userId: UUID() }],
    ["post", `/api/admin/students/${s()}/account/unlink`, { reason: "boundary test" }],
    ["post", `/api/admin/students/${s()}/email`, { email: "x@synthetic.example", reason: "boundary test" }],
    ["patch", `/api/admin/students/${s()}/status`, { status: "active" }],
    ["put", `/api/admin/students/${s()}/agreement`, { supportMonths: 12 }],
    ["post", `/api/admin/students/${s()}/checkpoints/kickoff_call`, {}],
    ["post", `/api/admin/students/${s()}/placements`, { studentCreditDecisionId: UUID(), requirementId: UUID(), rationale: "boundary" }],
    ["post", `/api/admin/students/${s()}/owner-assistant`, { question: "x", language: "en", task: "answer" }],
    ["get", `/api/admin/students/${s()}/view-as-student`],
    ["post", `/api/admin/students/${s()}/experience`, {}],
    ["get", "/api/admin/invitations"],
    ["post", "/api/admin/invitations", { email: "x@synthetic.example", language: "en", sendEmail: false }],
    ["get", "/api/admin/users"],
    ["get", "/api/admin/audit-logs"],
  ];
  const staffReads = (): string[] => [
    `/api/students/${s()}`,
    `/api/students/${s()}/profile`,
    `/api/admin/students/${s()}/journey`,
    `/api/admin/students/${s()}/agreement`,
    `/api/admin/students/${s()}/notes`,
    `/api/admin/students/${s()}/orientation-sessions`,
    `/api/admin/students/${s()}/billing`,
    `/api/documents/student/${s()}`,
    "/api/admin/directory/students",
    "/api/students?limit=5",
  ];

  it("staff are refused every administrator-only operation by the role guard (not by CSRF)", async () => {
    for (const [m, p, b] of adminOnly()) {
      const res = await send(staff, m, p, b);
      expect(res.status, `${m.toUpperCase()} ${p}`).toBe(403);
      expect(JSON.stringify(res.body), `${m.toUpperCase()} ${p}`).not.toMatch(/CSRF_TOKEN/);
    }
  });

  it("coaches are refused the administrator-only operations too", async () => {
    for (const [m, p, b] of adminOnly()) expect((await send(coach, m, p, b)).status, `${m} ${p}`).toBe(403);
  });

  it("staff can read what the Student File shows (no 403 noise)", async () => {
    for (const p of staffReads()) {
      const res = await send(staff, "get", p);
      expect(res.status, p).not.toBe(403);
      expect(res.status, p).not.toBe(401);
      // Two reads go through the Supabase client, which this harness mocks out (documents list, student list): their
      // role check has already passed when they answer anything other than 401/403.
      if (!p.startsWith("/api/documents/") && !p.startsWith("/api/students?")) expect(res.status, p).toBeLessThan(500);
    }
  });

  it("coaches cannot read student records", async () => {
    for (const p of [`/api/admin/students/${s()}/journey`, `/api/admin/students/${s()}/billing`, "/api/admin/directory/students", "/api/students?limit=5"]) {
      expect((await send(coach, "get", p)).status, p).toBe(403);
    }
  });
});
