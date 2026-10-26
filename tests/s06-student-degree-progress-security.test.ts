/**
 * S06 — Security boundaries of GET /api/student/degree-progress.
 *
 * Negative tests with synthetic records. The REAL requireAuth, real
 * account-status gate and real requireRole run; only the Supabase client, the
 * users-table lookup and the route's data dependencies are mocked. This does
 * NOT prove behavior against a real Supabase auth stack or database.
 *
 * Complements (does not repeat) tests/student-degree-progress-routes.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import crypto from "crypto";

const ID_A = "00000000-0000-0000-0000-0000000000a1";
const ID_B = "00000000-0000-0000-0000-0000000000b2";
const ID_ADMIN = "00000000-0000-0000-0000-0000000000ad";
const STUDENT_A = "student-record-A";
const STUDENT_B = "student-record-B";
const JWT_SECRET = process.env.SESSION_SECRET || "local-dev-secret-change-in-production";

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}
function localJwt(userId: string, overrides: Record<string, unknown> = {}, secret = JWT_SECRET): string {
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({
    userId, email: `${userId}@test.com`, iss: "lumiere-local", sub: userId,
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
    ...overrides,
  });
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

// ── mocks ───────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  userRows: new Map<string, { id: string; email: string; name: string; role: unknown }>(),
  profileStatus: new Map<string, string | "ERROR" | "THROW">(),
  getUser: vi.fn(),
  auditAdmin: vi.fn(),
}));

vi.mock("../server/lib/supabase", () => {
  const from = () => ({
    select: () => ({
      eq: (_col: string, userId: string) => ({
        maybeSingle: async () => {
          const s = mocks.profileStatus.get(userId);
          if (s === "THROW") throw new Error("profiles table exploded");
          if (s === "ERROR") return { data: null, error: { message: "db down" } };
          return { data: s === undefined ? null : { status: s }, error: null };
        },
      }),
    }),
  });
  return { supabaseAdmin: { auth: { getUser: mocks.getUser }, from } };
});

// users-table lookup: drizzle chain select().from().where(eq(users.id, X)).limit(1).
// The id is read back out of the eq() sentinel so the lookup is per-user.
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: (col: unknown, val: unknown) => ({ __eqVal: val, col }) };
});
vi.mock("../server/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((cond: { __eqVal?: string }) => ({
          limit: vi.fn(async () => {
            const row = mocks.userRows.get(String(cond?.__eqVal));
            return row ? [row] : [];
          }),
        })),
      })),
    })),
  },
}));
vi.mock("../server/lib/audit", () => ({
  auditAdmin: mocks.auditAdmin,
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

// ── fixtures ────────────────────────────────────────────────────────────────
const deps = {
  getStudentByUserId: vi.fn(),
  getAcademicRecord: vi.fn(),
  resolveContext: vi.fn(),
  getProgress: vi.fn(),
  getRequirementLabels: vi.fn(),
};
const adminDeps = { resolveContext: vi.fn(), getProgress: vi.fn() };

const studentOf: Record<string, string> = { [ID_A]: STUDENT_A, [ID_B]: STUDENT_B };
const ctxOf = (sid: string) => ({
  studentId: sid, programAssignmentId: `assign-${sid}`, programVersionId: "pv-1",
});

function recordFor(sid: string) {
  return {
    activeProgramAssignment: { cohortLabel: `cohort-${sid}` },
    programVersion: {
      version: { versionLabel: "2025" }, program: { name: `Program-${sid}`, code: "BA" },
      institution: { name: "Uni" },
    },
    academicSources: [],
    creditRecords: [{ id: `cr-${sid}`, sourceId: null, recordType: "course", status: "verified", rawTitle: `Course-${sid}`, rawCredits: "3.00" }],
    latestVerifications: { [`cr-${sid}`]: { action: "verified" } },
    latestDecisions: { [`cr-${sid}`]: { action: "accepted", creditsAwarded: "3.00" } },
  };
}

function reportFor(sid: string, resultOverrides: Record<string, unknown> = {}) {
  const context = ctxOf(sid);
  return {
    projectionKind: "INFORMATIONAL_ONLY", status: "COMPOSED", contractVersion: "4D.1",
    schemaVersion: "internal-schema", context,
    snapshot: {
      fingerprint: "sha256:LEAK_FINGERPRINT", asOf: "2025-01-01T00:00:00.000Z", context,
      occurrences: [{ value: "LEAK_OCCURRENCE" }],
    },
    integrationDiagnostics: [{ code: "LEAK_DIAGNOSTIC", ids: ["LEAK_ID"] }],
    phase3Output: {
      compositionKind: "COMPOSED",
      results: [{
        projectionKind: "INFORMATIONAL_ONLY", requirementId: "req-1", academicRuleId: "LEAK_RULE",
        status: "SATISFIED", requiredAmount: "3", appliedAmount: "3", remainingAmount: "0",
        reason: "LEAK_REASON",
        provenance: { studentCreditRecordIds: [`cr-${sid}`], claimVersionIds: ["LEAK_CLAIM"], sourceIds: ["LEAK_SOURCE"] },
        ...resultOverrides,
      }],
    },
  };
}

const LEAK_STRINGS = ["LEAK_", "sha256:", "hunter2", "/srv/internal", "node_modules", "at Object.", "at async", ".ts:", "ECONNREFUSED"];
const FORBIDDEN_KEY = /diagnostic|fingerprint|provenance|snapshot|phase3|claimversion|academicruleid|studentcreditrecordids|schemaversion|projectionkind|programassignmentid|programversionid|occurrence|stack|trace|errno|sqlstate|internal/i;

/** Deep scan of a parsed JSON value: every key and every string value. */
function scan(value: unknown, path = "$", found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v, i) => scan(v, `${path}[${i}]`, found));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(k)) found.push(`key ${path}.${k}`);
      scan(v, `${path}.${k}`, found);
    }
  } else if (typeof value === "string") {
    for (const s of LEAK_STRINGS) if (value.includes(s)) found.push(`value ${path} contains ${s}`);
  }
  return found;
}
function assertNoLeak(res: request.Response) {
  expect(scan(res.body)).toEqual([]);
  const raw = res.text;
  for (const s of LEAK_STRINGS) expect(raw).not.toContain(s);
  for (const h of ["x-powered-by-stack", "x-debug"]) expect(res.headers[h]).toBeUndefined();
}

async function makeApp(): Promise<Express> {
  const { createStudentDegreeProgressRouter } = await import("../server/routes/student-degree-progress");
  const { createAdminDegreeProgressRouter } = await import("../server/routes/admin-degree-progress");
  const app = express();
  app.use(express.json());
  app.use("/api/student", createStudentDegreeProgressRouter(deps as never));
  app.use("/api/admin/degree-progress", createAdminDegreeProgressRouter(adminDeps as never));
  return app;
}

function addUser(id: string, role: unknown, status: string | undefined = "active") {
  mocks.userRows.set(id, { id, email: `${id}@test.com`, name: "N", role });
  if (status !== undefined) mocks.profileStatus.set(id, status);
}

const get = (app: Express, url = "/api/student/degree-progress", token?: string) => {
  const r = request(app).get(url);
  return token ? r.set("Authorization", `Bearer ${token}`) : r;
};
const depsUntouched = () => {
  for (const f of Object.values(deps)) expect(f).not.toHaveBeenCalled();
  for (const f of Object.values(adminDeps)) expect(f).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.userRows.clear();
  mocks.profileStatus.clear();
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid JWT" } });
  addUser(ID_A, "student");
  addUser(ID_B, "student");
  addUser(ID_ADMIN, "admin");

  deps.getStudentByUserId.mockImplementation(async (uid: string) => (studentOf[uid] ? { id: studentOf[uid] } : null));
  deps.getAcademicRecord.mockImplementation(async (sid: string) => recordFor(sid));
  deps.resolveContext.mockImplementation(async (sid: string) => ctxOf(sid));
  deps.getProgress.mockImplementation(async (ctx: { studentId: string }) => reportFor(ctx.studentId));
  deps.getRequirementLabels.mockResolvedValue({ "req-1": { code: "GEN", title: "General", sequence: 1 } });
  adminDeps.resolveContext.mockResolvedValue(ctxOf(STUDENT_A));
  adminDeps.getProgress.mockResolvedValue(reportFor(STUDENT_A));
});

// ── 1. authenticated identity ───────────────────────────────────────────────
describe("1. authentication on the real requireAuth path", () => {
  it("sanity: a valid active student token is accepted", async () => {
    const res = await get(await makeApp(), undefined, localJwt(ID_A));
    expect(res.status).toBe(200);
  });

  const header = (value: string) => async () => {
    const res = await request(await makeApp()).get("/api/student/degree-progress").set("Authorization", value);
    expect(res.status).toBe(401);
    depsUntouched();
  };
  it("rejects a non-Bearer scheme with 401", header("Basic dXNlcjpwYXNz"));
  it("rejects lowercase 'bearer' scheme with 401", header(`bearer ${"x"}`));
  it("rejects an empty Bearer token with 401", header("Bearer "));
  it("rejects a malformed (non-JWT) token with 401", header("Bearer not-a-jwt"));
  it("rejects a 3-part garbage token with 401", header("Bearer aaa.bbb.ccc"));

  it("rejects a local token with a bad signature (401)", async () => {
    const res = await get(await makeApp(), undefined, localJwt(ID_A, {}, "wrong-secret"));
    expect(res.status).toBe(401);
    depsUntouched();
  });
  it("rejects an expired local token (401)", async () => {
    const res = await get(await makeApp(), undefined, localJwt(ID_A, { exp: Math.floor(Date.now() / 1000) - 10 }));
    expect(res.status).toBe(401);
    depsUntouched();
  });
  it("rejects a local token with the wrong issuer or no exp (401)", async () => {
    const app = await makeApp();
    expect((await get(app, undefined, localJwt(ID_A, { iss: "evil" }))).status).toBe(401);
    expect((await get(app, undefined, localJwt(ID_A, { exp: undefined }))).status).toBe(401);
    depsUntouched();
  });
  it("rejects an unsigned alg=none token (401)", async () => {
    const t = `${b64({ alg: "none", typ: "JWT" })}.${b64({ userId: ID_A, email: "a@b.c", iss: "lumiere-local", exp: 9999999999 })}.`;
    const res = await get(await makeApp(), undefined, t);
    expect(res.status).toBe(401);
    depsUntouched();
  });
  it("rejects a token whose payload was tampered after signing (401)", async () => {
    const good = localJwt(ID_A);
    const [h, , s] = good.split(".");
    const forged = `${h}.${b64({ userId: ID_ADMIN, email: "x@y.z", iss: "lumiere-local", exp: 9999999999 })}.${s}`;
    const res = await get(await makeApp(), undefined, forged);
    expect(res.status).toBe(401);
    depsUntouched();
  });
  it("rejects a validly signed local token for a user with no local profile (401)", async () => {
    const res = await get(await makeApp(), undefined, localJwt("00000000-0000-0000-0000-00000000dead"));
    expect(res.status).toBe(401);
    depsUntouched();
  });

  it("treats a Supabase-rejected (invalid/expired) token as 401", async () => {
    const res = await get(await makeApp(), undefined, "supabase-looking-token");
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired token" });
    depsUntouched();
  });
  it("treats a thrown Supabase client error as 401 without leaking the error", async () => {
    mocks.getUser.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.5:5432 at /srv/internal"));
    const res = await get(await makeApp(), undefined, "supabase-looking-token");
    expect(res.status).toBe(401);
    assertNoLeak(res);
    depsUntouched();
  });
  it("accepts a Supabase-verified user whose profile is active", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: ID_A, email: "a@test.com" } }, error: null });
    const res = await get(await makeApp(), undefined, "supabase-token");
    expect(res.status).toBe(200);
    expect(deps.getStudentByUserId).toHaveBeenCalledWith(ID_A);
  });
  it("rejects a Supabase-verified user with no local profile (401)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "ghost-user", email: "g@test.com" } }, error: null });
    const res = await get(await makeApp(), undefined, "supabase-token");
    expect(res.status).toBe(401);
    depsUntouched();
  });
  it("in production a locally signed token is not accepted (falls to Supabase, 401)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await get(await makeApp(), undefined, localJwt(ID_A));
    expect(res.status).toBe(401);
    depsUntouched();
  });
  it("does not allow demo mode to bypass auth when ALLOW_DEMO_MODE is unset or in production", async () => {
    vi.stubEnv("ALLOW_DEMO_MODE", "true");
    vi.stubEnv("NODE_ENV", "production");
    const res = await get(await makeApp());
    expect(res.status).toBe(500); // fail closed, never an authenticated student
    depsUntouched();
  });

  it.each(["inactive", "archived", "pending", "weird-status"])(
    "rejects an account whose profile status is %s (403 ACCOUNT_INACTIVE)", async (status) => {
      mocks.profileStatus.set(ID_A, status);
      const res = await get(await makeApp(), undefined, localJwt(ID_A));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ACCOUNT_INACTIVE");
      depsUntouched();
    });
  it("rejects an account with a missing profile row (403)", async () => {
    mocks.profileStatus.delete(ID_A);
    const res = await get(await makeApp(), undefined, localJwt(ID_A));
    expect(res.status).toBe(403);
    depsUntouched();
  });
  it("fails closed when the profile status lookup errors or throws (403, no leak)", async () => {
    const app = await makeApp();
    for (const mode of ["ERROR", "THROW"] as const) {
      mocks.profileStatus.set(ID_A, mode);
      const res = await get(app, undefined, localJwt(ID_A));
      expect(res.status).toBe(403);
      assertNoLeak(res);
    }
    depsUntouched();
  });
  it("rejects an inactive account on the Supabase path too (403)", async () => {
    mocks.profileStatus.set(ID_A, "archived");
    mocks.getUser.mockResolvedValue({ data: { user: { id: ID_A, email: "a@test.com" } }, error: null });
    const res = await get(await makeApp(), undefined, "supabase-token");
    expect(res.status).toBe(403);
    depsUntouched();
  });
  it("an authenticated student without a student profile gets 404, not another student's data", async () => {
    addUser("00000000-0000-0000-0000-0000000000c3", "student");
    const res = await get(await makeApp(), undefined, localJwt("00000000-0000-0000-0000-0000000000c3"));
    expect(res.status).toBe(404);
    expect(deps.getAcademicRecord).not.toHaveBeenCalled();
    expect(deps.getProgress).not.toHaveBeenCalled();
  });
});

// ── 2. isolation ────────────────────────────────────────────────────────────
describe("2. student-to-student isolation", () => {
  it("student A receives only A's record and student B only B's", async () => {
    const app = await makeApp();
    const a = await get(app, undefined, localJwt(ID_A));
    const b = await get(app, undefined, localJwt(ID_B));
    expect(a.body.program.programName).toBe(`Program-${STUDENT_A}`);
    expect(a.text).toContain(`cr-${STUDENT_A}`);
    expect(a.text).not.toContain(STUDENT_B);
    expect(b.body.program.programName).toBe(`Program-${STUDENT_B}`);
    expect(b.text).not.toContain(STUDENT_A);
  });

  it("every data lookup for A uses A's authenticated ids only, even with B's ids on the request", async () => {
    const app = await makeApp();
    const res = await get(
      app, `/api/student/degree-progress?userId=${ID_B}&student_id=${STUDENT_B}&id=${STUDENT_B}`, localJwt(ID_A),
    ).set("X-Student-Id", STUDENT_B).set("X-User-Id", ID_B);
    expect(res.status).toBe(200);
    expect(deps.getStudentByUserId.mock.calls).toEqual([[ID_A]]);
    expect(deps.getAcademicRecord.mock.calls).toEqual([[STUDENT_A]]);
    expect(deps.resolveContext.mock.calls).toEqual([[STUDENT_A]]);
    expect(deps.getProgress.mock.calls).toEqual([[ctxOf(STUDENT_A)]]);
    expect(JSON.stringify(deps.getRequirementLabels.mock.calls)).not.toContain(STUDENT_B);
    expect(res.text).not.toContain(STUDENT_B);
  });

  it("a token whose body claims B's userId but is signed for A's sub/userId mismatch cannot read B", async () => {
    // Payload tampering is rejected by signature; a *signed* token naming B authenticates as B, never A.
    const res = await get(await makeApp(), undefined, localJwt(ID_B, { sub: ID_A }));
    expect(deps.getStudentByUserId).toHaveBeenCalledWith(ID_B);
    expect(res.body.program.programName).toBe(`Program-${STUDENT_B}`);
  });

  it("fails closed (500, generic) when the report snapshot belongs to another student", async () => {
    deps.getProgress.mockResolvedValue(reportFor(STUDENT_B));
    const res = await get(await makeApp(), undefined, localJwt(ID_A));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
    assertNoLeak(res);
    expect(res.text).not.toContain(STUDENT_B);
    expect(deps.getRequirementLabels).not.toHaveBeenCalled();
  });

  it("two concurrent requests for A and B never cross-contaminate", async () => {
    const app = await makeApp();
    const [a, b] = await Promise.all([
      get(app, undefined, localJwt(ID_A)), get(app, undefined, localJwt(ID_B)),
    ]);
    expect(a.text).not.toContain(STUDENT_B);
    expect(b.text).not.toContain(STUDENT_A);
  });
});

// ── 3. client-supplied identifiers ──────────────────────────────────────────
describe("3. client-supplied identifiers", () => {
  const base = "/api/student/degree-progress";

  // Rejected with 400 (only the exact key `studentId` is rejected by the route).
  it.each([
    ["?studentId=", "empty value"],
    [`?studentId=${STUDENT_B}`, "plain"],
    [`?studentId=${STUDENT_B}&studentId=${STUDENT_A}`, "duplicate"],
    [`?studentId[]=${STUDENT_B}`, "array syntax"],
    [`?studentId[0]=${STUDENT_B}`, "indexed array"],
    [`?studentId[x]=${STUDENT_B}`, "object syntax"],
    [`?studentId=${STUDENT_A}`, "even the caller's own id"],
    [`?foo=1&studentId=${STUDENT_B}`, "mixed with other params"],
  ])("returns 400 for %s (%s) with no data access", async (qs) => {
    const res = await get(await makeApp(), base + qs, localJwt(ID_A));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("STUDENT_DEGREE_PROGRESS_VALIDATION_ERROR");
    expect(res.text).not.toContain(STUDENT_B);
    depsUntouched();
  });

  // Ignored (200) — the response must be A's own, and B's id must not reach any dependency.
  it.each([
    ["?student_id=STUDENT_B"], ["?userId=ID_B"], ["?user_id=ID_B"], ["?id=STUDENT_B"],
    ["?StudentId=STUDENT_B"], ["?studentid=STUDENT_B"], ["?student=STUDENT_B"],
    ["?userId=ID_B&userId=ID_A"], ["?userId[]=ID_B"], ["?student_id[]=STUDENT_B"],
    ["?programAssignmentId=assign-STUDENT_B"], ["?programVersionId=pv-evil"],
  ])("ignores %s and still serves only the authenticated student's record", async (qs) => {
    const q = qs.replace(/STUDENT_B/g, STUDENT_B).replace(/ID_B/g, ID_B).replace(/ID_A/g, ID_A);
    const res = await get(await makeApp(), base + q, localJwt(ID_A));
    expect(res.status).toBe(200);
    expect(deps.getStudentByUserId.mock.calls).toEqual([[ID_A]]);
    expect(deps.getAcademicRecord.mock.calls).toEqual([[STUDENT_A]]);
    expect(deps.resolveContext.mock.calls).toEqual([[STUDENT_A]]);
    expect(deps.getProgress.mock.calls).toEqual([[ctxOf(STUDENT_A)]]);
    expect(res.text).not.toContain(STUDENT_B);
  });

  it("ignores identifier headers (X-Student-Id, X-User-Id, X-Forwarded-User, Impersonate)", async () => {
    const res = await get(await makeApp(), base, localJwt(ID_A))
      .set("X-Student-Id", STUDENT_B).set("X-User-Id", ID_B)
      .set("X-Forwarded-User", ID_B).set("X-Impersonate-User", ID_B).set("X-Act-As", STUDENT_B);
    expect(res.status).toBe(200);
    expect(deps.getStudentByUserId.mock.calls).toEqual([[ID_A]]);
    expect(deps.getAcademicRecord.mock.calls).toEqual([[STUDENT_A]]);
    expect(res.text).not.toContain(STUDENT_B);
  });

  it("ignores identifiers in a JSON body or cookie on a GET (body studentId is not consulted)", async () => {
    const res = await get(await makeApp(), base, localJwt(ID_A))
      .set("Cookie", `studentId=${STUDENT_B}; userId=${ID_B}`)
      .send({ studentId: STUDENT_B, userId: ID_B });
    expect(res.status).toBe(200);
    expect(deps.getAcademicRecord.mock.calls).toEqual([[STUDENT_A]]);
    expect(res.text).not.toContain(STUDENT_B);
  });

  it.each([
    `/${STUDENT_B}`, `/${ID_B}`, `/${STUDENT_A}`, "/..%2f..%2fadmin", "/%2e%2e/%2e%2e/api/admin/degree-progress",
    "/students/" + STUDENT_B, "/student/" + STUDENT_B,
  ])("path variant /degree-progress%s resolves to no route (404) and reads nothing", async (suffix) => {
    const res = await get(await makeApp(), `${base}${suffix}`, localJwt(ID_A));
    expect([404, 400]).toContain(res.status);
    expect(res.status).not.toBe(200);
    depsUntouched();
  });

  it("does not expose write verbs on the endpoint (POST/PUT/PATCH/DELETE are 404)", async () => {
    const app = await makeApp();
    const token = localJwt(ID_A);
    for (const m of ["post", "put", "patch", "delete"] as const) {
      const res = await request(app)[m](base).set("Authorization", `Bearer ${token}`).send({ studentId: STUDENT_B });
      expect(res.status).toBe(404);
    }
    depsUntouched();
  });
});

// ── 4. role boundaries ──────────────────────────────────────────────────────
describe("4. staff / student boundaries", () => {
  it.each([["applicant"], ["parent"], ["Student"], ["STUDENT"], ["student,admin"], ["superadmin"], [""], [null], [undefined]])(
    "denies a user whose stored role is %j on the student endpoint (403)", async (role) => {
      addUser(ID_B, role);
      const res = await get(await makeApp(), undefined, localJwt(ID_B));
      expect(res.status).toBe(403);
      depsUntouched();
    });

  it("the 403 body for a wrong role carries no student data", async () => {
    const res = await get(await makeApp(), undefined, localJwt(ID_ADMIN));
    expect(res.status).toBe(403);
    expect(res.text).not.toContain(STUDENT_A);
    assertNoLeak(res);
  });

  const adminUrl = (id: string) => `/api/admin/degree-progress/students/${id}/degree-progress`;
  it("a student cannot reach the admin degree-progress route for their own or another id (403)", async () => {
    const app = await makeApp();
    for (const id of [STUDENT_A, STUDENT_B]) {
      const res = await get(app, adminUrl(id), localJwt(ID_A));
      expect(res.status).toBe(403);
      expect(res.text).not.toMatch(/fingerprint|integrationDiagnostics/);
    }
    expect((await get(app, "/api/admin/degree-progress/students/degree-progress", localJwt(ID_A))).status).toBe(403);
    depsUntouched();
  });
  it("coach, staff and unknown roles cannot reach the admin route either (403)", async () => {
    const app = await makeApp();
    for (const role of ["coach", "staff", "applicant", null]) {
      addUser(ID_B, role);
      expect((await get(app, adminUrl(STUDENT_A), localJwt(ID_B))).status).toBe(403);
    }
    depsUntouched();
  });
  it("the admin route is 401 without a token or with an invalid one", async () => {
    const app = await makeApp();
    expect((await get(app, adminUrl(STUDENT_A))).status).toBe(401);
    expect((await get(app, adminUrl(STUDENT_A), "garbage")).status).toBe(401);
    depsUntouched();
  });
  it("an inactive admin is rejected on the admin route (403)", async () => {
    mocks.profileStatus.set(ID_ADMIN, "archived");
    expect((await get(await makeApp(), adminUrl(STUDENT_A), localJwt(ID_ADMIN))).status).toBe(403);
    depsUntouched();
  });
  it("sanity: an active admin does reach the admin route (control for the 403s above)", async () => {
    const res = await get(await makeApp(), adminUrl(STUDENT_A), localJwt(ID_ADMIN));
    expect(res.status).toBe(200);
    expect(adminDeps.resolveContext).toHaveBeenCalledWith(STUDENT_A);
  });
  it("a student token cannot be used to elevate by sending admin-ish headers or query", async () => {
    const res = await get(await makeApp(), `${adminUrl(STUDENT_A)}?role=admin`, localJwt(ID_A))
      .set("X-User-Role", "admin").set("X-Role", "admin");
    expect(res.status).toBe(403);
    depsUntouched();
  });
});

// ── 5. no sensitive diagnostics ─────────────────────────────────────────────
describe("5. no sensitive diagnostics in any response", () => {
  const ok = async () => get(await makeApp(), undefined, localJwt(ID_A));

  it("the scanner itself detects planted leaks (guards against a vacuous scan)", () => {
    expect(scan({ a: [{ integrationDiagnostics: 1 }], b: "x LEAK_Y", c: { stackTrace: "z" }, d: { fingerprint: "f" } }).length).toBe(4);
    expect(scan({ credits: [{ creditRecordId: "c1", sourceId: "s1" }] })).toEqual([]);
  });

  it("success: deep key and value scan finds no diagnostics, fingerprints, provenance or engine internals", async () => {
    const res = await ok();
    expect(res.status).toBe(200);
    assertNoLeak(res);
    // The only context-ish identifiers allowed are the student's own credit/source ids.
    expect(Object.keys(res.body).sort()).toEqual([
      "asOf", "attention", "contractVersion", "credits", "milestones", "nextSteps",
      "program", "requirements", "sources", "state", "totals",
    ]);
  });

  it("requirement CONFLICT with engine internals and reason text leaks nothing", async () => {
    deps.getProgress.mockResolvedValue(reportFor(STUDENT_A, {
      status: "CONFLICT", appliedAmount: null, remainingAmount: null, reason: "LEAK_CONFLICT_REASON sha256:abc",
      conflicts: [{ code: "LEAK_CONFLICT_CODE", claimVersionIds: ["LEAK_CLAIM"] }],
    }));
    const res = await ok();
    expect(res.status).toBe(200);
    expect(res.body.requirements[0].status).toBe("CONFLICT");
    assertNoLeak(res);
  });

  it("requirement MANUAL_REVIEW inside a composed report leaks nothing", async () => {
    deps.getProgress.mockResolvedValue(reportFor(STUDENT_A, {
      status: "MANUAL_REVIEW", appliedAmount: null, remainingAmount: null, reason: "LEAK_MR_REASON",
    }));
    const res = await ok();
    expect(res.status).toBe(200);
    assertNoLeak(res);
  });

  it("report-level MANUAL_REVIEW (UNDER_REVIEW) with diagnostics and a fingerprint leaks nothing", async () => {
    deps.getProgress.mockResolvedValue({
      ...reportFor(STUDENT_A), status: "MANUAL_REVIEW", phase3Output: null,
      integrationDiagnostics: [{ code: "LEAK_DIAGNOSTIC", message: "LEAK_MESSAGE at /srv/internal/x.ts:12" }],
    });
    const res = await ok();
    expect(res.body.state).toBe("UNDER_REVIEW");
    assertNoLeak(res);
  });

  it("NO_ACTIVE_PROGRAM response leaks nothing", async () => {
    deps.resolveContext.mockResolvedValue(null);
    const res = await ok();
    expect(res.body.state).toBe("NO_ACTIVE_PROGRAM");
    assertNoLeak(res);
    expect(deps.getProgress).not.toHaveBeenCalled();
  });

  it("student-profile 404 leaks nothing", async () => {
    deps.getStudentByUserId.mockResolvedValue(null);
    const res = await ok();
    expect(res.status).toBe(404);
    assertNoLeak(res);
  });

  const stackError = () => {
    const e = new Error("db password=hunter2 ECONNREFUSED at /srv/internal/db.ts:44");
    e.stack = "Error: boom\n    at Object.<anonymous> (/srv/internal/node_modules/pg/index.ts:10:5)\n    at async handler";
    return Object.assign(e, { code: "ECONNREFUSED", detail: "LEAK_DETAIL", sql: "select * from secrets" });
  };
  it.each(["getStudentByUserId", "getAcademicRecord", "resolveContext", "getProgress", "getRequirementLabels"] as const)(
    "a throw in %s yields exactly a generic 500 with no message, stack or code", async (dep) => {
      deps[dep].mockRejectedValue(stackError());
      const res = await ok();
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Internal server error" });
      assertNoLeak(res);
      expect(res.text).not.toMatch(/secrets|LEAK_DETAIL|boom/);
    });

  it("a non-Error rejection (string/object) is also generic", async () => {
    deps.getProgress.mockRejectedValue({ sql: "select 1", password: "hunter2" });
    const res = await ok();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
    assertNoLeak(res);
  });

  it("a synchronous throw in a dependency is still a generic 500", async () => {
    deps.getAcademicRecord.mockImplementation(() => { throw stackError(); });
    const res = await ok();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
    assertNoLeak(res);
  });

  it("a malformed engine report (missing phase3Output) does not echo the raw report", async () => {
    deps.getProgress.mockResolvedValue({ ...reportFor(STUDENT_A), phase3Output: { compositionKind: "COMPOSED", results: [{ requirementId: "req-1", status: "SATISFIED", provenance: { claimVersionIds: ["LEAK_CLAIM"] }, reason: "LEAK_REASON", academicRuleId: "LEAK_RULE" }] } });
    const res = await ok();
    assertNoLeak(res);
  });

  it("the 401/403 error bodies carry no diagnostics or stack either", async () => {
    const app = await makeApp();
    mocks.profileStatus.set(ID_B, "pending");
    for (const r of [
      await get(app), await get(app, undefined, "garbage"), await get(app, undefined, localJwt(ID_B)),
      await get(app, undefined, localJwt(ID_ADMIN)),
    ]) {
      expect([401, 403]).toContain(r.status);
      assertNoLeak(r);
    }
  });
});
