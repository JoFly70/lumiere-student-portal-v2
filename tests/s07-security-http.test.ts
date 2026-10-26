/**
 * S07 — security acceptance over real HTTP + real local Postgres.
 *
 * Adds only the cases S05/S06 did not cover (see
 * docs/recovery/s07-evidence/security/acceptance-matrix.md): a student or coach
 * attempting to change academic credit, program assignment or placements through
 * the staff academic APIs, student-to-student isolation of academic information
 * on real data, and controlled profile fields. Canonical credit tables must be
 * byte-identical after every attempt.
 *
 * Real: Express app from `registerRoutes`, real requireAuth/requireRole, local
 * HS256 JWT resolved to a real `users` row, drizzle/Postgres.
 * Mocked (external services only): Supabase client and account-status lookup,
 * audit logging. NOT exercised: hosted Supabase Auth/GoTrue, hosted account
 * status, production schema/RLS parity.
 */
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import {
  PG_BINARIES_AVAILABLE,
  S05_PG_SKIP_MESSAGE,
  s05MigrationExists,
  seedAcademicRecord,
  seedStudent,
  seedUser,
  startLocalPg,
  type LocalPg,
  type SeededAcademic,
  type SeededStudent,
  type SeededUser,
} from "./helpers/s05-local-pg";
import { snapshotCanonical } from "./helpers/s05-roadmap-stack";

const JWT_SECRET = process.env.SESSION_SECRET || "local-dev-secret-change-in-production";

function makeLocalJWT(userId: string, email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ userId, email, iss: "lumiere-local", exp: now + 3600, iat: now, sub: userId, aud: "authenticated", role: "authenticated" }),
  ).toString("base64url");
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
vi.mock("../server/lib/audit", () => ({
  auditAdmin: vi.fn().mockResolvedValue(undefined),
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  auditAction: vi.fn().mockResolvedValue(undefined),
}));

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);
const ready = PG_BINARIES_AVAILABLE && s05MigrationExists();

const UUID = () => crypto.randomUUID();

describe.skipIf(!ready)("S07 security — students and coaches cannot change or read academic data they do not own", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let staff: SeededUser;
  let coach: SeededUser;
  let userA: SeededUser;
  let userB: SeededUser;
  let studentA: SeededStudent;
  let studentB: SeededStudent;
  let acadA: SeededAcademic;
  let acadB: SeededAcademic;

  const tok = (u: SeededUser) => ({ Authorization: `Bearer ${makeLocalJWT(u.id, u.email)}` });
  const api = () => request(base);

  beforeAll(async () => {
    pg = await startLocalPg();
    process.env.DATABASE_URL = pg.url;
    delete process.env.ALLOW_DEMO_MODE;
    staff = await seedUser(pg, "staff");
    coach = await seedUser(pg, "coach");
    userA = await seedUser(pg, "student");
    userB = await seedUser(pg, "student");
    studentA = await seedStudent(pg, { userId: userA.id });
    studentB = await seedStudent(pg, { userId: userB.id });
    acadA = await seedAcademicRecord(pg, studentA.id, { staffUserId: staff.id, courseTitle: "Alpha Composition" });
    acadB = await seedAcademicRecord(pg, studentB.id, { staffUserId: staff.id, courseTitle: "Zebra Studies Unique" });

    const { registerRoutes } = await import("../server/routes");
    const app = express();
    app.use(/^\/api\/admin\/students\/[^/]+\/roadmap(\/|$)/, express.json({ limit: "2mb" }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 300_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pg?.stop();
  }, 60_000);

  /** Every staff/admin academic-credit mutation the server exposes (method, path, body). */
  const mutations = (): Array<[string, string, Record<string, unknown>]> => {
    const s = studentB.id;
    const sa = "/api/admin/student-academic";
    return [
      ["post", `${sa}/students/${s}/program-assignments`, { programVersionId: UUID() }],
      ["post", `${sa}/students/${s}/program-assignments/switch`, { programVersionId: UUID() }],
      ["post", `${sa}/students/${s}/sources`, { sourceType: "transcript", title: "Forged" }],
      ["post", `${sa}/sources/${acadB.sourceId}/transition`, { status: "verified" }],
      ["post", `${sa}/sources/${acadB.sourceId}/credit-records`, { recordType: "course", rawTitle: "Forged", rawCredits: "120.00" }],
      ["patch", `${sa}/credit-records/${acadB.creditRecordId}/correct`, { rawCredits: "120.00" }],
      ["post", `${sa}/credit-records/${acadB.creditRecordId}/verifications`, { action: "verified" }],
      ["post", `${sa}/credit-records/${acadB.creditRecordId}/decisions`, { action: "accepted", creditsAwarded: "120.00" }],
      ["post", `${sa}/students/${s}/exceptions`, { exceptionType: "credit_override" }],
      ["post", `${sa}/exceptions/${UUID()}/supersede`, {}],
      ["post", `${sa}/exceptions/${UUID()}/revoke`, {}],
      ["post", `/api/admin/students/${s}/placements`, { studentCreditDecisionId: UUID(), requirementId: UUID(), rationale: "forged" }],
    ];
  };

  const sendAs = (user: SeededUser, [method, path, body]: [string, string, Record<string, unknown>]) =>
    (api() as unknown as Record<string, (p: string) => request.Test>)[method](path).set(tok(user)).send(body);

  for (const [label, who] of [
    ["a student (other student's record)", () => userA],
    ["a student (own record)", () => userA],
    ["a coach", () => coach],
  ] as const) {
    it(`${label} gets 403 on every academic credit / assignment / placement mutation and nothing changes`, async () => {
      const before = await snapshotCanonical(pg);
      const exceptionsBefore = await pg.sql(`select count(*)::int as n from student_academic_exceptions`);
      for (const m of mutations()) {
        // "own record" variant targets student A's ids instead of B's
        const target = label.includes("own") ? swapToA(m) : m;
        const res = await sendAs(who(), target);
        expect(res.status, `${m[0].toUpperCase()} ${target[1]}`).toBe(403);
      }
      expect(await snapshotCanonical(pg)).toEqual(before);
      expect(await pg.sql(`select count(*)::int as n from student_academic_exceptions`)).toEqual(exceptionsBefore);
      const placements = await pg.sql(`select count(*)::int as n from student_credit_placements`);
      expect(placements[0].n).toBe(0);
    });
  }

  function swapToA(m: [string, string, Record<string, unknown>]): [string, string, Record<string, unknown>] {
    return [m[0], m[1].replaceAll(studentB.id, studentA.id).replaceAll(acadB.sourceId, acadA.sourceId).replaceAll(acadB.creditRecordId, acadA.creditRecordId), m[2]];
  }

  it("unauthenticated requests get 401 on the same mutations", async () => {
    for (const [method, path, body] of mutations()) {
      const res = await (api() as unknown as Record<string, (p: string) => request.Test>)[method](path).send(body);
      expect(res.status, path).toBe(401);
    }
  });

  it("staff control: the same endpoint family is reachable by staff (not a blanket deny) - read of student B", async () => {
    const res = await api().get(`/api/admin/student-academic/students/${studentB.id}`).set(tok(staff));
    expect(res.status).toBe(200);
  });

  it("a student cannot read staff academic or degree-progress views of any student, own included", async () => {
    for (const sid of [studentA.id, studentB.id]) {
      for (const p of [
        `/api/admin/student-academic/students/${sid}`,
        `/api/admin/degree-progress/students/${sid}/degree-progress`,
        `/api/admin/students/${sid}/workspace`,
        `/api/admin/students/${sid}/roadmap`,
      ]) {
        const res = await api().get(p).set(tok(userA));
        expect(res.status, p).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain("Zebra Studies Unique");
      }
    }
  });

  it("student A sees only A's academic record and degree progress; B's data never appears, whatever ids A supplies", async () => {
    const b = ["Zebra Studies Unique", studentB.id, acadB.creditRecordId, acadB.sourceId, studentB.code, studentB.email];
    const record = await api().get(`/api/student/academic-record?studentId=${studentB.id}&student_id=${studentB.id}`).set(tok(userA)).set("x-student-id", studentB.id);
    expect(record.status).toBe(200);
    expect(JSON.stringify(record.body)).toContain("Alpha Composition");
    for (const needle of b) expect(JSON.stringify(record.body)).not.toContain(needle);

    const progress = await api().get("/api/student/degree-progress").set(tok(userA)).set("x-student-id", studentB.id);
    expect(progress.status).toBe(200);
    for (const needle of b) expect(JSON.stringify(progress.body)).not.toContain(needle);
    expect(JSON.stringify(progress.body)).toContain("Alpha Composition");

    const injected = await api().get(`/api/student/degree-progress?studentId=${studentB.id}`).set(tok(userA));
    expect(injected.status).toBe(400);
    for (const needle of b) expect(JSON.stringify(injected.body)).not.toContain(needle);
  });

  it("student B is isolated in the other direction as well", async () => {
    const res = await api().get("/api/student/academic-record").set(tok(userB));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain("Zebra Studies Unique");
    expect(JSON.stringify(res.body)).not.toContain("Alpha Composition");
  });

  // The legacy students router reads through Supabase (mocked here), so controlled-field edits on the
  // student's OWN profile are covered by tests/s03-student-records.test.ts (mocked) and stay UNVERIFIED
  // against a real Supabase. This stack can prove the ownership gate, which runs first.
  it("another student's profile is not writable (ownership gate 403) and nothing changes", async () => {
    const phoneBefore = await pg.sql(`select phone_primary from students where id = '${studentB.id}'`);
    const other = await api().put(`/api/students/${studentB.id}`).set(tok(userA)).send({ phonePrimary: "+15559999999" });
    expect(other.status).toBe(403);
    expect((await pg.sql(`select phone_primary from students where id = '${studentB.id}'`))[0].phone_primary).toBe(phoneBefore[0].phone_primary);
  });

  it("a student cannot read another student's profile or documents", async () => {
    for (const p of [`/api/students/${studentB.id}`, `/api/students/${studentB.id}/contacts`]) {
      const res = await api().get(p).set(tok(userA));
      expect([403, 404], p).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(studentB.email);
    }
  });

  it("student roadmap and published-plan write paths are closed: admin endpoints 403, progress for another student's item 404, studentId injection 400", async () => {
    const before = await snapshotCanonical(pg);
    const admin = `/api/admin/students/${studentB.id}/roadmap`;
    for (const [m, p] of [["put", `${admin}/draft`], ["post", `${admin}/draft/publish`], ["post", `${admin}/draft/acknowledge`], ["post", `${admin}/draft/discard`], ["post", `${admin}/draft/from-published`]] as const) {
      const res = await (api() as unknown as Record<string, (p: string) => request.Test>)[m](p).set(tok(userA)).send({});
      expect(res.status, `${m} ${p}`).toBe(403);
    }
    const noPlan = await api().post("/api/student/roadmap/progress").set(tok(userA)).send({ itemKey: "acc", taskKey: null, status: "in_progress", expectedRevision: 0 });
    expect(noPlan.status).toBe(404);
    const injected = await api().post("/api/student/roadmap/progress").set(tok(userA)).send({ studentId: studentB.id, itemKey: "acc", taskKey: null, status: "in_progress", expectedRevision: 0 });
    expect(injected.status).toBe(400);
    expect(await snapshotCanonical(pg)).toEqual(before);
    const plans = await pg.sql(`select count(*)::int as n from student_roadmap_plans`);
    expect(plans[0].n).toBe(0);
  });
});
