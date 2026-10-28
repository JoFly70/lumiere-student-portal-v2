/**
 * S11 — High School Pathway: real HTTP end to end over a real Postgres.
 *
 * Real: Express app from server/routes.ts registerRoutes, the real S11 routers
 * and service with default dependencies (drizzle -> disposable Postgres),
 * real requireAuth (local JWT -> users row), real RBAC, real triggers.
 * Mocked (external services only): Supabase client, account-status lookup,
 * audit sink (createAuditLog is a spy so audit events can be asserted).
 * Synthetic data only.
 */
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
// This route matrix deliberately exceeds the shared per-IP request budget.
// Test RBAC here; rate-limit behavior has its own tests, never disable it in app code.
vi.mock("../server/middleware/rate-limit", async (importOriginal) => ({
  ...await importOriginal<typeof import("../server/middleware/rate-limit")>(),
  apiRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import { HS_AUDIT_EVENTS, HS_ERROR_CODES as E, TEMPLATE_TN_22, formatHalfUnits, creditsToHalfUnits, type StaffHighSchoolState, type StudentHighSchoolView } from "../shared/high-school-contract";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, seedAcademicRecord, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";
import { applyS09Migration } from "./helpers/s09-apply-migration";
import {
  fullPlanContent, makeLocalJWT, protectedTables, seedActor, seedContact, seedDocument, seedHsStudent, snapshotTables, type Actor, type HsStudent, type TableSnapshot,
} from "./helpers/s11-hs-e2e-extra";

const mocks = vi.hoisted(() => ({ audit: vi.fn(async (..._a: unknown[]) => undefined) }));
vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: { auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "invalid token" } })) }, from: vi.fn(), storage: { from: vi.fn() } },
  createUserAuthClient: vi.fn(),
  isSupabaseConfigured: vi.fn(() => false),
}));
vi.mock("../server/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...Object.fromEntries(Object.entries(actual).map(([k, v]) => [k, typeof v === "function" ? vi.fn().mockResolvedValue(undefined) : v])),
    createAuditLog: mocks.audit,
  };
});

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const ZERO = "00000000-0000-4000-8000-000000000000";
const code = (res: request.Response): string | undefined => res.body?.error?.code ?? (typeof res.body?.error === "string" ? undefined : res.body?.code);
const auditedTypes = () => mocks.audit.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);

describe.skipIf(!PG_BINARIES_AVAILABLE)("S11 high school pathway — real HTTP end to end", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let staff: Actor;
  let admin: Actor;
  let coach: Actor;
  let univ: HsStudent; // also holds a university program (seeded before the snapshot)
  let tables: string[] = [];
  let before: TableSnapshot;

  const api = () => request(base);
  const A = (sid: string) => `/api/admin/students/${sid}/high-school`;
  const AE = (sid: string, eid: string) => `${A(sid)}/enrollments/${eid}`;
  const ok = (res: request.Response, label = "request"): any => {
    if (res.status >= 300) throw new Error(`${label} failed ${res.status}: ${JSON.stringify(res.body).slice(0, 500)}`);
    return res.body;
  };
  const get = async (sid: string, who: Actor = staff): Promise<StaffHighSchoolState> => ok(await api().get(A(sid)).set(who.auth), "get state");
  const studentView = async (s: HsStudent): Promise<StudentHighSchoolView> => ok(await api().get("/api/student/high-school").set(s.user.auth), "student view");
  const verifiedDoc = (s: HsStudent) => seedDocument(pg, s.student.id, { status: "verified" });

  async function enroll(s: HsStudent, extra: Record<string, unknown> = {}): Promise<{ eid: string; state: StaffHighSchoolState }> {
    const res = await api().post(`${A(s.student.id)}/enrollments`).set(staff.auth).send({ templateKey: "us-hs-diploma-21", templateVersion: 1, status: "active", ...extra });
    const state = ok(res, "create enrollment") as StaffHighSchoolState;
    return { eid: state.current!.enrollment.id, state };
  }

  /** Draft from template (or from published), optional edit, save, publish as admin. */
  async function publishPlan(s: HsStudent, eid: string, edit: (content: any) => any = fullPlanContent): Promise<StaffHighSchoolState> {
    const sid = s.student.id;
    let state = ok(await api().post(`${AE(sid, eid)}/roadmap/draft/from-template`).set(staff.auth).send({}), "draft from template") as StaffHighSchoolState;
    const draft = state.current!.draft!;
    state = ok(await api().put(`${AE(sid, eid)}/roadmap/draft`).set(staff.auth).send({ expectedDraftRevision: draft.draftRevision, content: edit(draft.content) }), "save draft");
    const saved = state.current!.draft!;
    return ok(await api().post(`${AE(sid, eid)}/roadmap/publish`).set(admin.auth).send({ expectedDraftRevision: saved.draftRevision, expectedPublishedVersionId: state.current!.published?.versionId ?? null }), "publish");
  }

  const courseResult = (s: HsStudent, eid: string, courseKey: string, doc: string, outcome = "completed") =>
    api().post(`${AE(s.student.id, eid)}/results/course`).set(staff.auth).send({ courseKey, outcome, evidenceDocumentId: doc });

  async function complete(s: HsStudent, eid: string, keys: string[], doc: string) {
    for (const k of keys) ok(await courseResult(s, eid, k, doc), `complete ${k}`);
  }
  const plannedKeys = (st: StaffHighSchoolState, pred: (c: any) => boolean = () => true) =>
    st.current!.published!.content.courses.filter((c) => c.status === "planned" && pred(c)).map((c) => c.key);
  const ELECTIVE = (c: any) => c.areaKey === "electives";

  beforeAll(async () => {
    pg = await startLocalPg();
    await applyS09Migration(pg);
    process.env.DATABASE_URL = pg.url;
    delete process.env.ALLOW_DEMO_MODE;
    staff = await seedActor(pg, "staff");
    admin = await seedActor(pg, "admin");
    coach = await seedActor(pg, "coach");
    univ = await seedHsStudent(pg, "Uma");
    await seedAcademicRecord(pg, univ.student.id, { staffUserId: staff.id });
    tables = await protectedTables(pg);
    before = await snapshotTables(pg, tables);
    const { registerRoutes } = await import("../server/routes");
    const app = express();
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

  beforeEach(() => {
    mocks.audit.mockClear();
  });

  // ── 1 ────────────────────────────────────────────────────────────────────
  it("1. 16 core + 5 elective credits: official completions with evidence drive core/elective/remaining exactly", async () => {
    const s = await seedHsStudent(pg, "Core");
    const { eid } = await enroll(s);
    const st = await publishPlan(s, eid);
    const doc = await verifiedDoc(s);
    expect(st.current!.credits).toMatchObject({ requiredHalfUnits: 42, earnedHalfUnits: 0, remainingHalfUnits: 42 });
    expect(st.current!.credits.core.requiredHalfUnits).toBe(32);
    expect(st.current!.credits.elective.requiredHalfUnits).toBe(10);
    const core = plannedKeys(st, (c) => !ELECTIVE(c));
    expect(core).toHaveLength(17); // 17 core COURSES (two startup courses are 0.5 each) = 16 core CREDITS
    await complete(s, eid, core, doc);
    const mid = (await get(s.student.id)).current!.credits;
    expect(mid).toMatchObject({ earnedHalfUnits: 32, remainingHalfUnits: 10 });
    expect(mid.core.earnedHalfUnits).toBe(32);
    expect(mid.elective.earnedHalfUnits).toBe(0);
    await complete(s, eid, plannedKeys(st, ELECTIVE), doc);
    const done = (await get(s.student.id)).current!.credits;
    expect(done).toMatchObject({ earnedHalfUnits: 42, remainingHalfUnits: 0, percentComplete: 100 });
    expect(done.core.earnedHalfUnits).toBe(32);
    expect(done.elective.earnedHalfUnits).toBe(10);
    expect(formatHalfUnits(done.core.earnedHalfUnits)).toBe("16");
    expect(formatHalfUnits(done.elective.earnedHalfUnits)).toBe("5");
    const view = await studentView(s);
    expect(view.credits.earnedHalfUnits).toBe(42);
  }, 120_000);

  // ── 2 ────────────────────────────────────────────────────────────────────
  it("2. half-credit arithmetic: two 0.5 startup courses = 1; 41 half-units = '20.5'; integers only, no float drift", async () => {
    const s = await seedHsStudent(pg, "Half");
    const { eid } = await enroll(s);
    const half = (content: any) => {
      const next = fullPlanContent(content);
      next.courses = next.courses.filter((c: any) => c.key !== "elective-5");
      for (const k of ["half-a", "half-b"]) next.courses.push({ key: k, title: `Half credit ${k}`, areaKey: "electives", halfUnits: 1, status: "planned", replacesCourseKey: null, plannedStart: null, plannedEnd: null, tasks: [] });
      return next;
    };
    const st = await publishPlan(s, eid, half);
    const doc = await verifiedDoc(s);
    ok(await courseResult(s, eid, "startup-personal-growth", doc));
    expect((await get(s.student.id)).current!.credits.earnedHalfUnits).toBe(1);
    ok(await courseResult(s, eid, "startup-learning-tech", doc));
    const afterStartup = (await get(s.student.id)).current!.credits;
    expect(afterStartup.earnedHalfUnits).toBe(2);
    expect(afterStartup.byArea.find((a) => a.key === "startup")).toMatchObject({ requiredHalfUnits: 2, earnedHalfUnits: 2, countedHalfUnits: 2 });
    expect(formatHalfUnits(afterStartup.earnedHalfUnits)).toBe("1");
    const rest = plannedKeys(st).filter((k) => !k.startsWith("startup-") && k !== "half-b");
    await complete(s, eid, rest, doc);
    const c41 = (await get(s.student.id)).current!.credits;
    expect(c41.earnedHalfUnits).toBe(41);
    expect(formatHalfUnits(c41.earnedHalfUnits)).toBe("20.5");
    expect(formatHalfUnits(c41.remainingHalfUnits)).toBe("0.5");
    expect(JSON.stringify(c41)).not.toMatch(/\d\.\d{3,}/); // no float drift
    for (const v of [c41.requiredHalfUnits, c41.earnedHalfUnits, c41.remainingHalfUnits, c41.core.earnedHalfUnits, c41.elective.earnedHalfUnits]) expect(Number.isInteger(v)).toBe(true);
    ok(await courseResult(s, eid, "half-b", doc));
    expect((await get(s.student.id)).current!.credits).toMatchObject({ earnedHalfUnits: 42, remainingHalfUnits: 0 });
    expect(creditsToHalfUnits(0.5) + creditsToHalfUnits(0.5)).toBe(2);
    // a credit value that is not a multiple of 0.5 is rejected by the API
    const bad = await api().post(`${AE(s.student.id, eid)}/awards/transfer`).set(staff.auth).send({ claimId: ZERO, areaKey: "math", halfUnits: 1.5, evidenceDocumentId: doc });
    expect(bad.status).toBe(400);
    expect(code(bad)).toBe(E.VALIDATION);
  }, 120_000);

  // ── 3 ────────────────────────────────────────────────────────────────────
  it("3. configurable 22-credit requirement: the TN template and a staff override with a reason", async () => {
    const tn = await seedHsStudent(pg, "Tenn");
    const r1 = ok(await api().post(`${A(tn.student.id)}/enrollments`).set(staff.auth).send({ templateKey: TEMPLATE_TN_22.templateKey, templateVersion: 1, status: "active" })) as StaffHighSchoolState;
    expect(r1.current!.enrollment).toMatchObject({ totalRequiredHalfUnits: 44, jurisdiction: "US-TN", requiredOverrideReason: null });
    expect(r1.current!.credits.requiredHalfUnits).toBe(44);
    expect(r1.current!.credits.core.requiredHalfUnits).toBe(34); // 4 math instead of 3 => 17 core credits
    expect(formatHalfUnits(r1.current!.credits.requiredHalfUnits)).toBe("22");

    const ov = await seedHsStudent(pg, "Override");
    const noReason = await api().post(`${A(ov.student.id)}/enrollments`).set(staff.auth).send({ templateKey: "us-hs-diploma-21", templateVersion: 1, totalRequiredHalfUnitsOverride: 44 });
    expect(noReason.status).toBe(422);
    expect(code(noReason)).toBe(E.VALIDATION);
    const tooShort = await api().post(`${A(ov.student.id)}/enrollments`).set(staff.auth).send({ templateKey: "us-hs-diploma-21", templateVersion: 1, totalRequiredHalfUnitsOverride: 44, overrideReason: "tn" });
    expect(tooShort.status).toBe(400);
    const good = ok(await api().post(`${A(ov.student.id)}/enrollments`).set(staff.auth).send({ templateKey: "us-hs-diploma-21", templateVersion: 1, status: "active", totalRequiredHalfUnitsOverride: 44, overrideReason: "Student resides in Tennessee (22 credits)" })) as StaffHighSchoolState;
    expect(good.current!.enrollment).toMatchObject({ totalRequiredHalfUnits: 44, requiredOverrideReason: "Student resides in Tennessee (22 credits)" });
    expect(good.current!.credits.requiredHalfUnits).toBe(44);
    expect(good.current!.credits.remainingHalfUnits).toBe(44);
    // the template itself is untouched: another student still gets 21
    const plain = await seedHsStudent(pg, "Plain");
    expect((await enroll(plain)).state.current!.credits.requiredHalfUnits).toBe(42);
  }, 60_000);

  // ── 4 ────────────────────────────────────────────────────────────────────
  describe("4. authorization matrix", () => {
    const ROLES = ["anonymous", "student", "coach", "staff", "admin"] as const;
    let sid: string;
    let s4: HsStudent;
    const actor = (r: (typeof ROLES)[number]): Record<string, string> => ({ anonymous: {}, student: s4?.user.auth, coach: coach.auth, staff: staff.auth, admin: admin.auth }[r] ?? {});
    type Row = { method: "get" | "post" | "put" | "patch"; path: () => string; body?: object; allowed: readonly (typeof ROLES)[number][] };
    const STAFF_ADMIN = ["staff", "admin"] as const;
    const rows = (): Row[] => {
      const E_ = AE(sid, ZERO);
      return [
        { method: "get", path: () => "/api/admin/high-school/templates", allowed: STAFF_ADMIN },
        { method: "post", path: () => "/api/admin/high-school/templates", body: {}, allowed: ["admin"] },
        { method: "get", path: () => A(sid), allowed: STAFF_ADMIN },
        { method: "post", path: () => `${A(sid)}/enrollments`, body: {}, allowed: STAFF_ADMIN },
        { method: "patch", path: () => E_, body: {}, allowed: STAFF_ADMIN },
        { method: "post", path: () => `${E_}/prior-education`, body: {}, allowed: STAFF_ADMIN },
        { method: "post", path: () => `${E_}/transfer-claims`, body: {}, allowed: STAFF_ADMIN },
        { method: "post", path: () => `${E_}/transfer-claims/${ZERO}/resolve`, body: {}, allowed: STAFF_ADMIN },
        { method: "post", path: () => `${E_}/roadmap/draft/from-template`, body: {}, allowed: STAFF_ADMIN },
        { method: "put", path: () => `${E_}/roadmap/draft`, body: {}, allowed: STAFF_ADMIN },
        { method: "post", path: () => `${E_}/roadmap/publish`, body: {}, allowed: ["admin"] },
        { method: "post", path: () => `${E_}/results/task`, body: {}, allowed: STAFF_ADMIN },
        { method: "post", path: () => `${E_}/results/course`, body: {}, allowed: STAFF_ADMIN },
        { method: "post", path: () => `${E_}/awards/transfer`, body: {}, allowed: STAFF_ADMIN },
        { method: "post", path: () => `${E_}/awards/${ZERO}/void`, body: {}, allowed: ["admin"] },
        { method: "post", path: () => `${E_}/graduation`, body: {}, allowed: STAFF_ADMIN },
        { method: "post", path: () => `${E_}/guardian-notes`, body: {}, allowed: STAFF_ADMIN },
        { method: "post", path: () => `${A(sid)}/historical-graduate`, body: {}, allowed: ["admin"] },
        { method: "get", path: () => "/api/student/high-school", allowed: ["student"] },
        { method: "post", path: () => "/api/student/high-school/progress", body: {}, allowed: ["student"] },
        { method: "post", path: () => "/api/student/high-school/transcript-request", body: {}, allowed: ["student"] },
        { method: "get", path: () => "/api/student/programs", allowed: ["student"] },
      ];
    };

    it("every endpoint x {anonymous, student, coach, staff, admin}: 401 without login, 403 for the wrong role, never 401/403 for an allowed role", async () => {
      s4 = await seedHsStudent(pg, "Matrix");
      sid = s4.student.id;
      const { eid } = await enroll(s4);
      await publishPlan(s4, eid);
      const failures: string[] = [];
      for (const row of rows()) {
        for (const role of ROLES) {
          let req = api()[row.method](row.path()).set(actor(role));
          if (row.body) req = req.send(row.body);
          const res = await req;
          const want = row.allowed.includes(role);
          const pass = want ? res.status !== 401 && res.status !== 403 : role === "anonymous" ? res.status === 401 : res.status === 403;
          if (!pass) failures.push(`${row.method.toUpperCase()} ${row.path().replace(sid, ":sid").replace(ZERO, ":id")} as ${role}: ${res.status} (allowed=${want})`);
        }
      }
      expect(failures).toEqual([]);
    }, 120_000);

    it("admin-only actions refused for staff change nothing: staff cannot publish, void, confer, or import a historical graduate", async () => {
      const s = await seedHsStudent(pg, "AdminOnly");
      const { eid } = await enroll(s);
      let state = ok(await api().post(`${AE(s.student.id, eid)}/roadmap/draft/from-template`).set(staff.auth).send({}));
      const rev = state.current.draft.draftRevision;
      const pub = await api().post(`${AE(s.student.id, eid)}/roadmap/publish`).set(staff.auth).send({ expectedDraftRevision: rev, expectedPublishedVersionId: null });
      expect(pub.status).toBe(403);
      state = await get(s.student.id);
      expect(state.current!.published).toBeNull();
      expect(state.current!.draft!.status).toBe("draft");
      const doc = await verifiedDoc(s);
      expect((await api().post(`${A(s.student.id)}/historical-graduate`).set(staff.auth).send({ templateKey: "us-hs-diploma-21", templateVersion: 1, conferredOn: "2025-06-01", awardingSchoolName: "Synthetic Academy", diplomaEvidenceDocumentId: doc, transcriptEvidenceDocumentId: doc, note: "import" })).status).toBe(403);
      expect((await get(s.student.id)).enrollments).toHaveLength(1);
    }, 60_000);

    it("a student cannot reach staff endpoints for their own id, and staff/admin/coach have no student view", async () => {
      const own = await api().get(A(s4.student.id)).set(s4.user.auth);
      expect(own.status).toBe(403);
      expect(JSON.stringify(own.body)).not.toContain(s4.student.id);
      for (const who of [staff, admin, coach]) expect((await api().get("/api/student/high-school").set(who.auth)).status).toBe(403);
    });
  });

  // ── 5 ────────────────────────────────────────────────────────────────────
  it("5. unauthorized guardian access is prevented: contacts never log in, standing follows S09 authority, notes stay staff-only", async () => {
    const s = await seedHsStudent(pg, "Guarded");
    const { eid } = await enroll(s);
    await publishPlan(s, eid);
    const parent = await seedContact(pg, s.student.id, { type: "parent", fullName: "Pia Parent", relationship: "Mother", scopes: ["academic", "financial", "emergency"], authority: "listed" });
    const pending = await seedContact(pg, s.student.id, { type: "guardian", fullName: "Gus Guardian", relationship: "Legal guardian", scopes: ["academic", "emergency"], authority: "pending_verification" });
    const verified = await seedContact(pg, s.student.id, { type: "guardian", fullName: "Vera Verified", relationship: "Court-appointed guardian", scopes: ["academic", "emergency"], authority: "verified" });
    const verifiedNoAcademic = await seedContact(pg, s.student.id, { type: "guardian", fullName: "Vic Financial", relationship: "Guardian", scopes: ["financial", "emergency"], authority: "verified" });
    const other = await seedHsStudent(pg, "OtherFamily");
    const foreign = await seedContact(pg, other.student.id, { type: "parent", fullName: "Olga Other", relationship: "Mother" });
    const usersBefore = (await pg.sql(`select count(*)::int as n from users`))[0]!.n;

    const state = await get(s.student.id);
    const by = (id: string) => state.guardians.find((g) => g.contactId === id)!;
    expect(by(parent)).toMatchObject({ standing: "listed_parent", mayDiscussAcademics: false, mayDiscussFinances: false, hasPortalAccess: false });
    expect(by(pending)).toMatchObject({ standing: "guardian_unverified", mayDiscussAcademics: false, hasPortalAccess: false });
    expect(by(verified)).toMatchObject({ standing: "verified_guardian", mayDiscussAcademics: true, mayDiscussFinances: false, hasPortalAccess: false });
    expect(by(verifiedNoAcademic)).toMatchObject({ standing: "verified_guardian", mayDiscussAcademics: false, mayDiscussFinances: true, hasPortalAccess: false });
    expect(state.guardians.every((g) => g.hasPortalAccess === false)).toBe(true);

    // a contact id is not an identity: a token minted for it is refused everywhere
    const forged = { Authorization: `Bearer ${makeLocalJWT(verified, "vera@synthetic.example")}` };
    for (const path of ["/api/student/high-school", "/api/student/programs", A(s.student.id)]) expect((await api().get(path).set(forged)).status).toBe(401);
    // no endpoint accepts a guardian identity
    for (const body of [{ guardianId: verified }, { contactId: verified }, { studentId: s.student.id }]) {
      const res = await api().post("/api/student/high-school/transcript-request").set(s.user.auth).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const viaQuery = await api().get(`/api/student/high-school?studentId=${s.student.id}`).set(s.user.auth);
    expect(viaQuery.status).toBe(400);
    expect(code(viaQuery)).toBe(E.STUDENT_ID_NOT_ACCEPTED);

    // staff-only notes
    const secret = "SECRET-STAFF-NOTE-7731";
    const noted = ok(await api().post(`${AE(s.student.id, eid)}/guardian-notes`).set(staff.auth).send({ contactId: verified, note: secret }));
    expect(noted.guardians.find((g: any) => g.contactId === verified).notes.map((n: any) => n.note)).toContain(secret);
    const view = await studentView(s);
    expect(JSON.stringify(view)).not.toContain(secret);
    expect(view.guardians.every((g) => g.hasPortalAccess === false && !("notes" in g))).toBe(true);
    // a note about a contact of ANOTHER student is refused
    const res = await api().post(`${AE(s.student.id, eid)}/guardian-notes`).set(staff.auth).send({ contactId: foreign, note: "should not attach" });
    expect(res.status).toBe(404);
    expect(code(res)).toBe(E.CONTACT_NOT_FOUND);
    expect((await pg.sql(`select count(*)::int as n from users`))[0]!.n).toBe(usersBefore);
  }, 60_000);

  // ── 6 ────────────────────────────────────────────────────────────────────
  it("6. prior study never awards credit automatically: an accepted claim stays at 0 until a transfer award with evidence", async () => {
    const s = await seedHsStudent(pg, "Transfer");
    const { eid } = await enroll(s);
    await publishPlan(s, eid);
    const evalDoc = await verifiedDoc(s);
    const pendingDoc = await seedDocument(pg, s.student.id, { status: "pending" });
    const pe = ok(await api().post(`${AE(s.student.id, eid)}/prior-education`).set(staff.auth).send({ schoolName: "Collège Synthétique", country: "France", status: "evaluated", evidenceDocumentId: evalDoc }));
    const priorId = pe.current.priorEducation[0].id;
    const claim = async (title: string, half: number) => {
      const st = ok(await api().post(`${AE(s.student.id, eid)}/transfer-claims`).set(staff.auth).send({ priorEducationId: priorId, courseTitle: title, areaKey: "math", claimedHalfUnits: half }));
      return st.current.priorEducation[0].claims.find((c: any) => c.courseTitle === title).id as string;
    };
    const accepted = await claim("Algebra I", 2);
    const unresolved = await claim("Geometry", 2);
    const declined = await claim("Statistics", 2);
    const resolve = (id: string, status: string) => api().post(`${AE(s.student.id, eid)}/transfer-claims/${id}/resolve`).set(staff.auth).send({ status, note: "per school letter" });
    ok(await resolve(accepted, "accepted"));
    ok(await resolve(declined, "declined"));
    let st = await get(s.student.id);
    expect(st.current!.credits.earnedHalfUnits).toBe(0);
    expect(st.current!.awards).toHaveLength(0);
    expect((await studentView(s)).credits.earnedHalfUnits).toBe(0);
    const award = (claimId: string, evidence: string | undefined, half = 2) =>
      api().post(`${AE(s.student.id, eid)}/awards/transfer`).set(staff.auth).send({ claimId, areaKey: "math", halfUnits: half, ...(evidence ? { evidenceDocumentId: evidence } : {}) });
    expect((await award(unresolved, evalDoc)).status).toBe(409);
    expect(code(await award(unresolved, evalDoc))).toBe(E.CLAIM_NOT_ACCEPTED);
    expect(code(await award(declined, evalDoc))).toBe(E.CLAIM_NOT_ACCEPTED);
    const noEv = await award(accepted, undefined);
    expect(noEv.status).toBe(400);
    expect(code(noEv)).toBe(E.EVIDENCE_REQUIRED);
    const badEv = await award(accepted, pendingDoc);
    expect(badEv.status).toBe(422);
    expect(code(badEv)).toBe(E.EVIDENCE_INVALID);
    expect((await award(accepted, evalDoc, 4)).status).toBe(422); // more than claimed
    expect((await get(s.student.id)).current!.credits.earnedHalfUnits).toBe(0);
    ok(await award(accepted, evalDoc, 2));
    st = await get(s.student.id);
    expect(st.current!.credits.earnedHalfUnits).toBe(2);
    expect(st.current!.credits.byArea.find((a) => a.key === "math")).toMatchObject({ earnedHalfUnits: 2, countedHalfUnits: 2 });
    expect(st.current!.awards[0]).toMatchObject({ source: "transfer", claimId: accepted, status: "active" });
  }, 60_000);

  // ── 7 / 8 ────────────────────────────────────────────────────────────────
  describe("7-8. student reports vs official results; exam and project pending review", () => {
    let s: HsStudent;
    let eid: string;
    let doc: string;
    const withTasks = (content: any) => {
      const next = fullPlanContent(content);
      const c = next.courses.find((x: any) => x.key === "english-1");
      c.tasks = [
        { key: "lesson-1", kind: "lesson", title: "Unit 1 lessons", dueDate: "2027-01-10" },
        { key: "exam-1", kind: "exam", title: "Midterm exam", dueDate: "2027-02-01" },
        { key: "project-1", kind: "project", title: "Essay project", dueDate: "2027-03-01" },
      ];
      return next;
    };
    const report = (taskKey: string, body: object) => api().post("/api/student/high-school/progress").set(s.user.auth).send({ courseKey: "english-1", taskKey, expectedRevision: 0, ...body });
    const findTask = (v: StudentHighSchoolView, key: string) => v.subjects.flatMap((x) => x.courses).find((c) => c.key === "english-1")!.tasks.find((t) => t.key === key)!;

    it("7. a student who marks every task submitted and reports a score sees pending review; earned credit does not move", async () => {
      s = await seedHsStudent(pg, "Report");
      ({ eid } = await enroll(s));
      await publishPlan(s, eid, withTasks);
      doc = await verifiedDoc(s);
      for (const t of ["lesson-1", "exam-1", "project-1"]) ok(await report(t, { status: "submitted", reportedScorePercent: 95 }), `report ${t}`);
      const v = await studentView(s);
      const course = v.subjects.flatMap((x) => x.courses).find((c) => c.key === "english-1")!;
      expect(course.status).toBe("awaiting_school");
      expect(course.tasks.every((t) => t.status === "pending_review")).toBe(true);
      expect(findTask(v, "exam-1")).toMatchObject({ reportedScorePercent: 95, officialScorePercent: null });
      expect(v.credits.earnedHalfUnits).toBe(0);
      expect(v.credits.awaitingConfirmationHalfUnits).toBeGreaterThanOrEqual(0);
      expect((await get(s.student.id)).current!.credits.earnedHalfUnits).toBe(0);
      // the staff view of the same course has no official result yet
      expect((await get(s.student.id)).current!.results).toHaveLength(0);
      // staff record the official course result: credit appears, status becomes official_complete
      ok(await courseResult(s, eid, "english-1", doc));
      const after = await studentView(s);
      expect(after.credits.earnedHalfUnits).toBe(2);
      expect(after.subjects.flatMap((x) => x.courses).find((c) => c.key === "english-1")!.status).toBe("official_complete");
    }, 60_000);

    it("8. exams and projects awaiting a grade appear in awaitingGrade and the staff review queue, and leave both after the official result", async () => {
      const s8 = await seedHsStudent(pg, "Pending");
      const e8 = (await enroll(s8)).eid;
      await publishPlan(s8, e8, withTasks);
      const d8 = await verifiedDoc(s8);
      const rep = (t: string, b: object) => api().post("/api/student/high-school/progress").set(s8.user.auth).send({ courseKey: "english-1", taskKey: t, expectedRevision: 0, ...b });
      ok(await rep("exam-1", { status: "submitted", reportedScorePercent: 88, note: "Saw 88%" }));
      ok(await rep("project-1", { status: "submitted" }));
      ok(await rep("lesson-1", { status: "in_progress" }));
      const stale = await rep("exam-1", { status: "submitted", reportedScorePercent: 50 }); // revision is now 1
      expect(stale.status).toBe(409);
      expect(code(stale)).toBe(E.REVISION_CONFLICT);
      let v = await studentView(s8);
      expect(v.awaitingGrade.map((t) => t.key).sort()).toEqual(["exam-1", "project-1"]);
      expect(v.writtenProjects.map((t) => t.key)).toContain("project-1");
      let st = await get(s8.student.id);
      expect(st.current!.reviewQueue.map((q) => `${q.taskKey}:${q.kind}`).sort()).toEqual(["exam-1:exam", "project-1:project"]);
      expect(st.current!.reviewQueue.find((q) => q.taskKey === "exam-1")).toMatchObject({ reportedScorePercent: 88, reportedStatus: "submitted", note: "Saw 88%" });
      const task = (taskKey: string, outcome: string, evidenceDocumentId?: string) =>
        api().post(`${AE(s8.student.id, e8)}/results/task`).set(staff.auth).send({ courseKey: "english-1", taskKey, outcome, scorePercent: 90, ...(evidenceDocumentId ? { evidenceDocumentId } : {}) });
      expect(code(await task("exam-1", "passed"))).toBe(E.EVIDENCE_REQUIRED);
      expect(code(await task("exam-1", "passed", await seedDocument(pg, s8.student.id, { status: "pending" })))).toBe(E.EVIDENCE_INVALID);
      expect((await get(s8.student.id)).current!.reviewQueue).toHaveLength(2); // still pending
      ok(await task("exam-1", "passed", d8));
      st = await get(s8.student.id);
      expect(st.current!.reviewQueue.map((q) => q.taskKey)).toEqual(["project-1"]);
      v = await studentView(s8);
      expect(v.awaitingGrade.map((t) => t.key)).toEqual(["project-1"]);
      expect(v.subjects.flatMap((x) => x.courses).find((c) => c.key === "english-1")!.tasks.find((t) => t.key === "exam-1")).toMatchObject({ status: "official_passed", officialScorePercent: 90 });
      ok(await task("project-1", "passed", d8));
      expect((await get(s8.student.id)).current!.reviewQueue).toHaveLength(0);
      expect((await studentView(s8)).awaitingGrade).toHaveLength(0);
      // a task result is not a course result: no credit yet
      expect((await studentView(s8)).credits.earnedHalfUnits).toBe(0);
    }, 60_000);
  });

  // ── 9 ────────────────────────────────────────────────────────────────────
  it("9. retake and pace policies apply only when configured", async () => {
    const examPlan = (policies?: Record<string, number | null>) => (content: any) => {
      const next = fullPlanContent(content);
      next.courses.find((c: any) => c.key === "english-1").tasks = [{ key: "exam-1", kind: "exam", title: "Final exam", dueDate: null }];
      if (policies) next.policies = { ...next.policies, ...policies };
      return next;
    };
    const fail = (s: HsStudent, eid: string, doc: string) =>
      api().post(`${AE(s.student.id, eid)}/results/task`).set(staff.auth).send({ courseKey: "english-1", taskKey: "exam-1", outcome: "failed", scorePercent: 40, evidenceDocumentId: doc });

    const free = await seedHsStudent(pg, "NoPolicy");
    const { eid: e1 } = await enroll(free);
    const st = await publishPlan(free, e1, examPlan());
    expect(Object.values(st.current!.published!.content.policies).every((v) => v === null)).toBe(true);
    const d1 = await verifiedDoc(free);
    for (let i = 0; i < 4; i++) ok(await fail(free, e1, d1), `failed attempt ${i + 1}`);
    expect((await get(free.student.id)).current!.results.filter((r) => r.outcome === "failed")).toHaveLength(4);

    const limited = await seedHsStudent(pg, "TwoAttempts");
    const { eid: e2 } = await enroll(limited);
    const st2 = await publishPlan(limited, e2, examPlan({ maxExamAttempts: 2 }));
    expect(st2.current!.published!.content.policies).toMatchObject({ maxExamAttempts: 2, minDaysBetweenExams: null, passingPercent: null });
    const d2 = await verifiedDoc(limited);
    ok(await fail(limited, e2, d2));
    ok(await fail(limited, e2, d2));
    const third = await fail(limited, e2, d2);
    expect(third.status).toBe(409);
    expect(code(third)).toBe(E.POLICY_VIOLATION);
    expect((await get(limited.student.id)).current!.results.filter((r) => r.outcome === "failed")).toHaveLength(2);
    // a pass is still recordable once the limit is reached (the policy limits failures, not success)
    ok(await api().post(`${AE(limited.student.id, e2)}/results/task`).set(staff.auth).send({ courseKey: "english-1", taskKey: "exam-1", outcome: "passed", scorePercent: 80, evidenceDocumentId: d2 }));

    const spaced = await seedHsStudent(pg, "MinDays");
    const { eid: e3 } = await enroll(spaced);
    await publishPlan(spaced, e3, examPlan({ minDaysBetweenExams: 7 }));
    const d3 = await verifiedDoc(spaced);
    ok(await fail(spaced, e3, d3));
    const tooSoon = await fail(spaced, e3, d3);
    expect(tooSoon.status).toBe(409);
    expect(code(tooSoon)).toBe(E.POLICY_VIOLATION);
  }, 120_000);

  // ── 10 ───────────────────────────────────────────────────────────────────
  it("10. a new published version keeps progress and results; replaced courses stay visible; v1 is immutable", async () => {
    const s = await seedHsStudent(pg, "Versions");
    const { eid } = await enroll(s);
    const withExam = (content: any) => {
      const next = fullPlanContent(content);
      next.courses.find((c: any) => c.key === "english-1").tasks = [{ key: "exam-1", kind: "exam", title: "Midterm", dueDate: "2027-02-01" }];
      next.courses.find((c: any) => c.key === "english-1").plannedStart = "2027-01-04";
      return next;
    };
    const v1 = await publishPlan(s, eid, withExam);
    const v1Id = v1.current!.published!.versionId;
    expect(v1.current!.published!.versionNumber).toBe(1);
    const doc = await verifiedDoc(s);
    ok(await api().post("/api/student/high-school/progress").set(s.user.auth).send({ courseKey: "english-1", taskKey: "exam-1", status: "submitted", reportedScorePercent: 77, expectedRevision: 0 }));
    ok(await courseResult(s, eid, "startup-personal-growth", doc));
    const earnedBefore = (await get(s.student.id)).current!.credits.earnedHalfUnits;
    expect(earnedBefore).toBe(1);

    // v2: from the published version, replace english-2, reschedule english-1
    let state = ok(await api().post(`${AE(s.student.id, eid)}/roadmap/draft/from-template`).set(staff.auth).send({}));
    expect(state.current.draft.versionNumber).toBe(2);
    const content = JSON.parse(JSON.stringify(state.current.draft.content));
    expect(content.courses.find((c: any) => c.key === "english-1").tasks).toHaveLength(1); // draft started from the published plan, not the bare template
    content.courses.find((c: any) => c.key === "english-2").status = "replaced";
    content.courses.push({ key: "english-2-new", title: "English 2 (new term)", areaKey: "english", halfUnits: 2, status: "planned", replacesCourseKey: "english-2", plannedStart: "2027-05-03", plannedEnd: "2027-07-30", tasks: [] });
    content.courses.find((c: any) => c.key === "english-1").plannedStart = "2027-03-01";
    state = ok(await api().put(`${AE(s.student.id, eid)}/roadmap/draft`).set(staff.auth).send({ expectedDraftRevision: state.current.draft.draftRevision, content }));
    const v2 = ok(await api().post(`${AE(s.student.id, eid)}/roadmap/publish`).set(admin.auth).send({ expectedDraftRevision: state.current.draft.draftRevision, expectedPublishedVersionId: v1Id }));
    expect(v2.current.published.versionNumber).toBe(2);
    expect(v2.current.versionHistory.map((v: any) => `${v.versionNumber}:${v.status}`)).toEqual(["2:published", "1:superseded"]);

    // progress and official results survive
    const view = await studentView(s);
    const eng1 = view.subjects.flatMap((x) => x.courses).find((c) => c.key === "english-1")!;
    expect(eng1.tasks.find((t) => t.key === "exam-1")).toMatchObject({ status: "pending_review", reportedScorePercent: 77 });
    expect(eng1.plannedStart).toBe("2027-03-01");
    expect(view.credits.earnedHalfUnits).toBe(earnedBefore);
    expect(view.roadmap!.versionNumber).toBe(2);
    const all = view.subjects.flatMap((x) => x.courses);
    expect(all.find((c) => c.key === "english-2")!.status).toBe("replaced");
    expect(all.find((c) => c.key === "english-2-new")).toMatchObject({ status: "not_started", replacesCourseKey: "english-2" });
    expect((await get(s.student.id)).current!.results).toHaveLength(1);

    // v1 is immutable at the database level
    await expect(pg.sql(`update hs_roadmap_versions set content = '{}'::jsonb where id = '${v1Id}'`)).rejects.toThrow(/immutable/);
    await expect(pg.sql(`delete from hs_roadmap_versions where id = '${v1Id}'`)).rejects.toThrow(/cannot be deleted/);
    const [row] = await pg.sql(`select content->'courses'->0->>'key' as k, status from hs_roadmap_versions where id = '${v1Id}'`);
    expect(row).toMatchObject({ k: "startup-personal-growth", status: "superseded" });
    const v1Content = await pg.sql(`select jsonb_array_length(content->'courses') as n from hs_roadmap_versions where id = '${v1Id}'`);
    expect(Number(v1Content[0]!.n)).toBe(v1.current!.published!.content.courses.length);
  }, 120_000);

  // ── 11 ───────────────────────────────────────────────────────────────────
  it("11. graduation needs official evidence: confirm and confer enforce evidence, credits and role", async () => {
    const s = await seedHsStudent(pg, "Grad");
    const { eid } = await enroll(s);
    const st = await publishPlan(s, eid);
    const doc = await verifiedDoc(s);
    const diplomaDoc = await seedDocument(pg, s.student.id, { status: "verified", docType: "hs_diploma" });
    const pending = await seedDocument(pg, s.student.id, { status: "pending" });
    const grad = (as: Actor, body: object) => api().post(`${AE(s.student.id, eid)}/graduation`).set(as.auth).send(body);
    const today = new Date().toISOString().slice(0, 10);

    // confirm_eligibility is admin-only ("(A)"): staff are refused (403, audited as access_denied) and nothing changes
    const deniedBefore = auditedTypes().filter((t) => t === "high_school.access_denied").length;
    const staffConfirm = await grad(staff, { action: "confirm_eligibility", evidenceDocumentId: doc });
    expect(staffConfirm.status).toBe(403);
    expect(auditedTypes().filter((t) => t === "high_school.access_denied").length).toBe(deniedBefore + 1);
    expect((await get(s.student.id)).current!.graduation).toMatchObject({ status: "in_progress", eligibilityConfirmedAt: null, eligibilityEvidenceDocumentId: null });

    const none = await grad(admin, { action: "confirm_eligibility" });
    expect(none.status).toBe(400);
    expect(code(none)).toBe(E.EVIDENCE_REQUIRED);
    const unverified = await grad(admin, { action: "confirm_eligibility", evidenceDocumentId: pending });
    expect(unverified.status).toBe(422);
    expect(code(unverified)).toBe(E.EVIDENCE_INVALID);
    const short = await grad(admin, { action: "confirm_eligibility", evidenceDocumentId: doc });
    expect(short.status).toBe(409);
    expect(code(short)).toBe(E.NOT_ELIGIBLE);
    expect(short.body.error.details.blockers.length).toBeGreaterThan(0);
    expect((await get(s.student.id)).current!.graduation.blockers.length).toBeGreaterThan(0);
    // confer before eligibility is confirmed
    expect(code(await grad(admin, { action: "confer_diploma", conferredOn: today, diplomaEvidenceDocumentId: diplomaDoc, transcriptEvidenceDocumentId: doc }))).toBe(E.NOT_ELIGIBLE);

    await complete(s, eid, plannedKeys(st), doc);
    expect((await get(s.student.id)).current!.graduation.blockers).toEqual([]);
    // eligibility evidence must be a transcript / other official-school document, not a diploma
    const wrongEligibility = await grad(admin, { action: "confirm_eligibility", evidenceDocumentId: diplomaDoc });
    expect(wrongEligibility.status).toBe(422);
    expect(code(wrongEligibility)).toBe(E.EVIDENCE_INVALID);
    expect(wrongEligibility.body.error.message).toMatch(/hs_transcript or other/);
    const confirmed = ok(await grad(admin, { action: "confirm_eligibility", evidenceDocumentId: doc, note: "School completion review received" }));
    expect(confirmed.current.graduation).toMatchObject({ status: "eligibility_confirmed", eligibilityEvidenceDocumentId: doc });
    expect((await studentView(s)).graduation.status).toBe("eligibility_confirmed");

    const confer = { action: "confer_diploma", conferredOn: today, diplomaEvidenceDocumentId: diplomaDoc, transcriptEvidenceDocumentId: doc };
    expect((await grad(staff, confer)).status).toBe(403); // confer is admin-only
    // evidence document types: the diploma must be an hs_diploma, the transcript an hs_transcript
    const diplomaIsTranscript = await grad(admin, { ...confer, diplomaEvidenceDocumentId: doc });
    expect(diplomaIsTranscript.status).toBe(422);
    expect(code(diplomaIsTranscript)).toBe(E.EVIDENCE_INVALID);
    expect(diplomaIsTranscript.body.error.message).toMatch(/hs_diploma/);
    expect(code(await grad(admin, { ...confer, transcriptEvidenceDocumentId: diplomaDoc }))).toBe(E.EVIDENCE_INVALID);
    // the conferral date is never in the future
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const futureConfer = await grad(admin, { ...confer, conferredOn: future });
    expect(futureConfer.status).toBe(422);
    expect(code(futureConfer)).toBe(E.VALIDATION);
    // ... nor before eligibility was confirmed
    const pastConfer = await grad(admin, { ...confer, conferredOn: "2020-01-01" });
    expect(pastConfer.status).toBe(422);
    expect(code(pastConfer)).toBe(E.VALIDATION);
    const noDiploma = await grad(admin, { ...confer, diplomaEvidenceDocumentId: undefined });
    expect(noDiploma.status).toBe(400);
    expect(code(noDiploma)).toBe(E.EVIDENCE_REQUIRED);
    expect(code(await grad(admin, { ...confer, transcriptEvidenceDocumentId: pending }))).toBe(E.EVIDENCE_INVALID);
    expect(code(await grad(admin, { ...confer, diplomaEvidenceDocumentId: "no-such-document" }))).toBe(E.EVIDENCE_INVALID);
    expect((await get(s.student.id)).current!.graduation.status).toBe("eligibility_confirmed");
    const conferred = ok(await grad(admin, confer));
    expect(conferred.current.graduation).toMatchObject({ status: "diploma_conferred", diploma: { conferredOn: today, documentId: diplomaDoc }, transcript: { documentId: doc } });
    expect(conferred.current.enrollment.status).toBe("completed");
    const v = await studentView(s);
    expect(v.graduation.status).toBe("diploma_conferred");
    expect(v.enrollment.status).toBe("completed");
    // records are locked after completion
    expect((await courseResult(s, eid, "elective-1", doc, "not_passed")).status).toBe(409);
    // delivery status "delivered" without a document is refused before conferral
    const other = await seedHsStudent(pg, "NoDocs");
    const { eid: e2 } = await enroll(other);
    const early = await api().post(`${AE(other.student.id, e2)}/graduation`).set(staff.auth).send({ action: "set_transcript_status", value: "issued" });
    expect(early.status).toBe(400);
    expect(code(early)).toBe(E.EVIDENCE_REQUIRED);
  }, 120_000);

  // ── 12 ───────────────────────────────────────────────────────────────────
  it("12. a historical graduate is imported with confirmed records only", async () => {
    const s = await seedHsStudent(pg, "Historic");
    const diploma = await seedDocument(pg, s.student.id, { status: "verified", docType: "hs_diploma" });
    const transcript = await verifiedDoc(s);
    const pending = await seedDocument(pg, s.student.id, { status: "pending" });
    const body = { templateKey: "us-hs-diploma-21", templateVersion: 1, conferredOn: "2024-06-14", awardingSchoolName: "Synthetic Online Academy", diplomaEvidenceDocumentId: diploma, transcriptEvidenceDocumentId: transcript, note: "Diploma on file" };
    const post = (as: Actor, b: object) => api().post(`${A(s.student.id)}/historical-graduate`).set(as.auth).send(b);
    expect((await post(staff, body)).status).toBe(403);
    expect(code(await post(admin, { ...body, transcriptEvidenceDocumentId: pending }))).toBe(E.EVIDENCE_INVALID);
    // wrong document types: a transcript is not a diploma and vice versa
    const swapped = await post(admin, { ...body, diplomaEvidenceDocumentId: transcript, transcriptEvidenceDocumentId: diploma });
    expect(swapped.status).toBe(422);
    expect(code(swapped)).toBe(E.EVIDENCE_INVALID);
    // the conferral date cannot be in the future
    const futureDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const futureHistoric = await post(admin, { ...body, conferredOn: futureDate });
    expect(futureHistoric.status).toBe(422);
    expect(code(futureHistoric)).toBe(E.VALIDATION);
    expect((await get(s.student.id)).enrollments).toHaveLength(0);
    const done = ok(await post(admin, body)) as StaffHighSchoolState;
    expect(done.current!.enrollment).toMatchObject({ isHistorical: true, status: "completed", awardingSchoolName: "Synthetic Online Academy" });
    expect(done.current!.graduation).toMatchObject({ status: "diploma_conferred", diploma: { conferredOn: "2024-06-14", documentId: diploma }, transcript: { documentId: transcript } });
    // eligibility evidence is the transcript document (the diploma is not silently reused)
    expect(done.current!.graduation.eligibilityEvidenceDocumentId).toBe(transcript);
    expect(done.current!.awards).toHaveLength(0); // no credit is invented for history
    expect(done.current!.credits.earnedHalfUnits).toBe(0);
    const v = await studentView(s);
    expect(v.graduation.status).toBe("diploma_conferred");
    const again = await post(admin, body);
    expect(again.status).toBe(409);
    expect(code(again)).toBe(E.ALREADY_RECORDED);
    // a historical graduate cannot be given new official results
    expect((await api().post(`${AE(s.student.id, done.current!.enrollment.id)}/results/course`).set(staff.auth).send({ courseKey: "english-1", outcome: "completed", evidenceDocumentId: diploma })).status).toBeGreaterThanOrEqual(400);
  }, 60_000);

  // ── 13 ───────────────────────────────────────────────────────────────────
  it("13. simultaneous (high school + university) and successive (withdrawn, then a new) programs", async () => {
    const { eid } = await enroll(univ);
    const programs = ok(await api().get("/api/student/programs").set(univ.user.auth));
    expect(programs.programs.map((p: any) => p.kind).sort()).toEqual(["high_school", "university_degree"]);
    expect(programs.programs.find((p: any) => p.kind === "high_school")).toMatchObject({ id: eid, current: true });
    expect(programs.programs.find((p: any) => p.kind === "university_degree").current).toBe(true);
    expect((await get(univ.student.id)).hasUniversityProgram).toBe(true);
    const view = await studentView(univ);
    expect(view.enrollment.id).toBe(eid);

    const s = await seedHsStudent(pg, "Successive");
    const first = await enroll(s);
    expect((await get(s.student.id)).hasUniversityProgram).toBe(false);
    const dup = await api().post(`${A(s.student.id)}/enrollments`).set(staff.auth).send({ templateKey: "us-hs-diploma-21", templateVersion: 1 });
    expect(dup.status).toBe(409);
    expect(code(dup)).toBe(E.ENROLLMENT_ALREADY_OPEN);
    ok(await api().patch(AE(s.student.id, first.eid)).set(staff.auth).send({ expectedRevision: first.state.current!.enrollment.revision, status: "withdrawn", note: "Student withdrew from the school" }));
    const second = await enroll(s, { templateKey: TEMPLATE_TN_22.templateKey });
    expect(second.eid).not.toBe(first.eid);
    const st = await get(s.student.id);
    expect(st.enrollments.map((e) => e.status)).toEqual(["active", "withdrawn"]);
    expect(st.current!.enrollment.id).toBe(second.eid);
    const prog = ok(await api().get("/api/student/programs").set(s.user.auth));
    expect(prog.programs.filter((p: any) => p.kind === "high_school").map((p: any) => `${p.status}:${p.current}`).sort()).toEqual(["active:true", "withdrawn:false"]);
    // withdrawn enrollment records are locked
    expect((await api().post(`${AE(s.student.id, first.eid)}/prior-education`).set(staff.auth).send({ schoolName: "Late School", country: "France" })).status).toBe(409);
  }, 60_000);

  // ── 14 ───────────────────────────────────────────────────────────────────
  it("14. cross-student isolation: B never sees A, A's enrollment id under B's path is 404, B's evidence cannot be used for A", async () => {
    const a = await seedHsStudent(pg, "Alpha");
    const b = await seedHsStudent(pg, "Bravo");
    const ea = (await enroll(a, { })).eid;
    await publishPlan(a, ea);
    const eb = (await enroll(b)).eid;
    await publishPlan(b, eb);
    const docA = await verifiedDoc(a);
    const docB = await verifiedDoc(b);
    ok(await api().patch(AE(a.student.id, ea)).set(staff.auth).send({ expectedRevision: 0, awardingSchoolName: "Alpha-Only Academy", note: "school confirmed" }));
    const viewB = await studentView(b);
    expect(viewB.enrollment.id).toBe(eb);
    expect(JSON.stringify(viewB)).not.toContain(ea);
    expect(JSON.stringify(viewB)).not.toContain("Alpha-Only Academy");
    // staff: A's enrollment under B's path
    const wrongPatch = await api().patch(AE(b.student.id, ea)).set(staff.auth).send({ expectedRevision: 0, note: "cross student" });
    expect(wrongPatch.status).toBe(404);
    expect(code(wrongPatch)).toBe(E.NO_ENROLLMENT);
    expect((await courseResult(b, ea, "english-1", docB)).status).toBe(404);
    expect((await api().post(`${AE(b.student.id, ea)}/roadmap/draft/from-template`).set(staff.auth).send({})).status).toBe(404);
    expect((await api().post(`${AE(b.student.id, ea)}/graduation`).set(staff.auth).send({ action: "set_financial_clearance", value: "cleared", note: "nope" })).status).toBe(404);
    // B's evidence for A's result
    const cross = await courseResult(a, ea, "english-1", docB);
    expect(cross.status).toBe(422);
    expect(code(cross)).toBe(E.EVIDENCE_INVALID);
    expect((await get(a.student.id)).current!.results).toHaveLength(0);
    ok(await courseResult(a, ea, "english-1", docA));
    expect((await get(b.student.id)).current!.results).toHaveLength(0);
    expect((await studentView(b)).credits.earnedHalfUnits).toBe(0);
    // unknown student
    expect((await api().get(A(ZERO)).set(staff.auth)).status).toBe(404);
    // B cannot report progress into A's enrollment: the student is resolved from the login only
    const sneaky = await api().post("/api/student/high-school/progress").set(b.user.auth).send({ courseKey: "english-1", taskKey: "x", status: "submitted", expectedRevision: 0, enrollmentId: ea });
    expect(sneaky.status).toBe(400);
  }, 60_000);

  // ── 15 ───────────────────────────────────────────────────────────────────
  describe("15. failure paths and audit events", () => {
    it("revision conflicts, unknown keys and duplicate records are refused cleanly", async () => {
      const s = await seedHsStudent(pg, "Failures");
      const { eid, state } = await enroll(s);
      const doc = await verifiedDoc(s);
      // enrollment revision conflict
      ok(await api().patch(AE(s.student.id, eid)).set(staff.auth).send({ expectedRevision: state.current!.enrollment.revision, targetCompletionDate: "2028-06-30", note: "target set" }));
      const stale = await api().patch(AE(s.student.id, eid)).set(staff.auth).send({ expectedRevision: state.current!.enrollment.revision, targetCompletionDate: "2029-01-01", note: "stale write" });
      expect(stale.status).toBe(409);
      expect(code(stale)).toBe(E.REVISION_CONFLICT);
      expect((await get(s.student.id)).current!.enrollment.targetCompletionDate).toBe("2028-06-30");
      // draft conflicts
      let st = ok(await api().post(`${AE(s.student.id, eid)}/roadmap/draft/from-template`).set(staff.auth).send({}));
      const rev = st.current.draft.draftRevision;
      const content = fullPlanContent(st.current.draft.content);
      ok(await api().put(`${AE(s.student.id, eid)}/roadmap/draft`).set(staff.auth).send({ expectedDraftRevision: rev, content }));
      const staleDraft = await api().put(`${AE(s.student.id, eid)}/roadmap/draft`).set(staff.auth).send({ expectedDraftRevision: rev, content });
      expect(code(staleDraft)).toBe(E.REVISION_CONFLICT);
      const stalePublish = await api().post(`${AE(s.student.id, eid)}/roadmap/publish`).set(admin.auth).send({ expectedDraftRevision: rev, expectedPublishedVersionId: null });
      expect(stalePublish.status).toBe(409);
      expect(code(stalePublish)).toBe(E.REVISION_CONFLICT);
      // results before any publish
      expect(code(await courseResult(s, eid, "english-1", doc))).toBe(E.NO_PUBLISHED_ROADMAP);
      const fresh = await get(s.student.id);
      ok(await api().post(`${AE(s.student.id, eid)}/roadmap/publish`).set(admin.auth).send({ expectedDraftRevision: fresh.current!.draft!.draftRevision, expectedPublishedVersionId: null }));
      // unknown keys
      const extraKey = await api().post(`${AE(s.student.id, eid)}/results/course`).set(staff.auth).send({ courseKey: "english-1", outcome: "completed", evidenceDocumentId: doc, earnedHalfUnits: 99 });
      expect(extraKey.status).toBe(400);
      expect(code(extraKey)).toBe(E.VALIDATION);
      expect(code(await courseResult(s, eid, "no-such-course", doc))).toBe(E.UNKNOWN_COURSE_OR_TASK);
      expect((await api().post(`${A(s.student.id)}/enrollments`).set(staff.auth).send({ templateKey: "nope", templateVersion: 1 })).status).toBe(404);
      expect((await api().get(`${A(s.student.id)}?studentId=${s.student.id}`).set(staff.auth)).status).toBe(400);
      expect((await api().patch(`${A(s.student.id)}/enrollments/not-a-uuid`).set(staff.auth).send({ expectedRevision: 0, note: "bad id" })).status).toBe(404);
      // duplicates
      ok(await courseResult(s, eid, "english-1", doc));
      const dup = await courseResult(s, eid, "english-1", doc);
      expect(dup.status).toBe(409);
      expect(code(dup)).toBe(E.ALREADY_RECORDED);
      expect((await get(s.student.id)).current!.awards.filter((a) => a.courseKey === "english-1")).toHaveLength(1);
    }, 60_000);

    it("a database failure (missing table) returns a truthful 503 without internals and leaves no partial state", async () => {
      const s = await seedHsStudent(pg, "DbFail");
      const { eid, state } = await enroll(s);
      const revision = state.current!.enrollment.revision;
      await pg.sql(`alter table hs_events rename to hs_events_offline`);
      let res: request.Response;
      try {
        res = await api().patch(AE(s.student.id, eid)).set(staff.auth).send({ expectedRevision: revision, targetCompletionDate: "2030-01-01", note: "will roll back" });
      } finally {
        await pg.sql(`alter table hs_events_offline rename to hs_events`);
      }
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: { code: "HS_UNAVAILABLE", message: "High school records are temporarily unavailable" } });
      expect(JSON.stringify(res.body)).not.toMatch(/hs_events|relation|postgres|select|insert|stack/i);
      const after = await get(s.student.id);
      expect(after.current!.enrollment.revision).toBe(revision);
      expect(after.current!.enrollment.targetCompletionDate).toBeNull();
      // and the service recovers
      ok(await api().patch(AE(s.student.id, eid)).set(staff.auth).send({ expectedRevision: revision, targetCompletionDate: "2030-01-01", note: "retry works" }));
    }, 60_000);

    it("every mutation writes an hs_events row and an audit call; refused access is audited as access_denied", async () => {
      const s = await seedHsStudent(pg, "Audited");
      mocks.audit.mockClear();
      const { eid } = await enroll(s);
      const doc = await verifiedDoc(s);
      const contact = await seedContact(pg, s.student.id, { type: "parent", fullName: "Audit Parent", relationship: "Father" });
      const taskPlan = (content: any) => {
        const next = fullPlanContent(content);
        next.courses.find((c: any) => c.key === "english-1").tasks = [{ key: "exam-1", kind: "exam", title: "Exam", dueDate: null }];
        return next;
      };
      await publishPlan(s, eid, taskPlan);
      const pe = ok(await api().post(`${AE(s.student.id, eid)}/prior-education`).set(staff.auth).send({ schoolName: "Audit School", country: "France" }));
      const claimState = ok(await api().post(`${AE(s.student.id, eid)}/transfer-claims`).set(staff.auth).send({ priorEducationId: pe.current.priorEducation[0].id, courseTitle: "Algebra", areaKey: "math", claimedHalfUnits: 2 }));
      const claimId = claimState.current.priorEducation[0].claims[0].id;
      ok(await api().post(`${AE(s.student.id, eid)}/transfer-claims/${claimId}/resolve`).set(staff.auth).send({ status: "accepted", note: "school accepted" }));
      ok(await api().post(`${AE(s.student.id, eid)}/awards/transfer`).set(staff.auth).send({ claimId, areaKey: "math", halfUnits: 2, evidenceDocumentId: doc }));
      ok(await api().post("/api/student/high-school/progress").set(s.user.auth).send({ courseKey: "english-1", taskKey: "exam-1", status: "submitted", expectedRevision: 0 }));
      ok(await api().post(`${AE(s.student.id, eid)}/results/task`).set(staff.auth).send({ courseKey: "english-1", taskKey: "exam-1", outcome: "passed", scorePercent: 90, evidenceDocumentId: doc }));
      ok(await courseResult(s, eid, "english-1", doc));
      const awardId = (await get(s.student.id)).current!.awards.find((a) => a.courseKey === "english-1")!.id;
      ok(await api().post(`${AE(s.student.id, eid)}/awards/${awardId}/void`).set(admin.auth).send({ reason: "recorded in error" }));
      ok(await api().post(`${AE(s.student.id, eid)}/graduation`).set(staff.auth).send({ action: "set_financial_clearance", value: "cleared", note: "billing confirmed" }));
      ok(await api().post(`${AE(s.student.id, eid)}/guardian-notes`).set(staff.auth).send({ contactId: contact, note: "spoke by phone" }));
      ok(await api().patch(AE(s.student.id, eid)).set(staff.auth).send({ expectedRevision: (await get(s.student.id)).current!.enrollment.revision, targetCompletionDate: "2029-06-01", note: "target moved" }));
      expect((await api().get(A(s.student.id)).set(s.user.auth)).status).toBe(403);
      expect((await api().post(`${AE(s.student.id, eid)}/roadmap/publish`).set(staff.auth).send({})).status).toBe(403);
      await new Promise((r) => setTimeout(r, 50));

      const seen = new Set(auditedTypes());
      for (const ev of HS_AUDIT_EVENTS) expect(seen, `audit event ${ev}`).toContain(ev);
      const denied = mocks.audit.mock.calls.map((c) => c[0] as any).filter((c) => c.eventType === "high_school.access_denied");
      expect(denied.length).toBeGreaterThanOrEqual(2);
      expect(denied.map((d) => d.actorRole).sort()).toEqual(expect.arrayContaining(["student", "staff"]));
      // audit metadata never carries notes or names
      const blob = JSON.stringify(mocks.audit.mock.calls);
      for (const secret of ["spoke by phone", "Audit School", "billing confirmed", "recorded in error", "target moved"]) expect(blob).not.toContain(secret);
      // hs_events rows for the same mutations
      const rows = await pg.sql(`select distinct event_type from hs_events where student_id = '${s.student.id}'`);
      const types = rows.map((r) => String(r.event_type));
      for (const t of ["enrollment_created", "roadmap_draft_opened", "roadmap_draft_saved", "roadmap_published", "prior_education_recorded", "transfer_claim_created", "transfer_claim_resolved", "credit_awarded", "official_task_result", "official_course_result", "credit_voided", "financial_clearance_set", "guardian_note", "enrollment_updated"]) {
        expect(types, `hs_events ${t}`).toContain(t);
      }
      const progressEvents = await pg.sql(`select count(*)::int as n from hs_task_progress_events where student_id = '${s.student.id}'`);
      expect(progressEvents[0]!.n).toBe(1);
      // append-only
      await expect(pg.sql(`update hs_events set summary = 'tampered' where student_id = '${s.student.id}'`)).rejects.toThrow(/append-only/);
      await expect(pg.sql(`delete from hs_official_results where student_id = '${s.student.id}'`)).rejects.toThrow(/cannot be deleted/);
    }, 120_000);
  });

  // ── 16 ───────────────────────────────────────────────────────────────────
  it("16. university credit tables are unchanged by the whole journey (incl. diploma conferral) and a student cannot change official records", async () => {
    // a student who tries to touch official records directly
    const s = await seedHsStudent(pg, "Tamper");
    const { eid } = await enroll(s);
    await publishPlan(s, eid, (content: any) => {
      const next = fullPlanContent(content);
      next.courses.find((c: any) => c.key === "english-1").tasks = [{ key: "exam-1", kind: "exam", title: "Exam", dueDate: null }];
      return next;
    });
    const doc = await verifiedDoc(s);
    const count = async (t: string) => Number((await pg.sql(`select count(*)::int as n from ${t}`))[0]!.n);
    const hsBefore = { results: await count("hs_official_results"), awards: await count("hs_credit_awards"), grad: await count("hs_graduation_records") };
    const attempts: [string, string, object][] = [
      ["post", `${AE(s.student.id, eid)}/results/course`, { courseKey: "english-1", outcome: "completed", evidenceDocumentId: doc }],
      ["post", `${AE(s.student.id, eid)}/results/task`, { courseKey: "english-1", taskKey: "exam-1", outcome: "passed", scorePercent: 100, evidenceDocumentId: doc }],
      ["post", `${AE(s.student.id, eid)}/awards/transfer`, { claimId: ZERO, areaKey: "math", halfUnits: 2, evidenceDocumentId: doc }],
      ["post", `${AE(s.student.id, eid)}/graduation`, { action: "confer_diploma", conferredOn: "2026-01-01", diplomaEvidenceDocumentId: doc, transcriptEvidenceDocumentId: doc }],
      ["post", `${AE(s.student.id, eid)}/roadmap/publish`, {}],
      ["patch", AE(s.student.id, eid), { expectedRevision: 0, status: "completed", note: "student says done" }],
      ["post", `${A(s.student.id)}/historical-graduate`, {}],
    ];
    for (const [method, path, body] of attempts) {
      const res = await (api() as any)[method](path).set(s.user.auth).send(body);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    // forged official fields in a progress report are rejected (strict schema)
    for (const extra of [{ earnedHalfUnits: 42 }, { outcome: "passed" }, { officialScorePercent: 100 }, { status2: "x" }]) {
      const res = await api().post("/api/student/high-school/progress").set(s.user.auth).send({ courseKey: "english-1", taskKey: "exam-1", status: "submitted", expectedRevision: 0, ...extra });
      expect(res.status).toBe(400);
    }
    expect({ results: await count("hs_official_results"), awards: await count("hs_credit_awards"), grad: await count("hs_graduation_records") }).toEqual(hsBefore);
    expect((await studentView(s)).credits.earnedHalfUnits).toBe(0);
    // a legitimate student report cannot override an official result
    ok(await courseResult(s, eid, "english-1", doc));
    const locked = await api().post("/api/student/high-school/progress").set(s.user.auth).send({ courseKey: "english-1", taskKey: "exam-1", status: "submitted", expectedRevision: 0 });
    expect(locked.status).toBe(409);
    expect(code(locked)).toBe(E.OFFICIAL_RECORD_LOCKED);

    // tables snapshotted before ANY high school action (incl. conferrals in tests 11-12)
    expect(await protectedTables(pg)).toEqual(tables);
    const afterSnapshot = await snapshotTables(pg, tables);
    expect(afterSnapshot).toEqual(before);
    expect(tables).toEqual(expect.arrayContaining(["student_credit_records", "student_credit_decisions", "student_credit_verification_events", "student_program_assignments"]));
    expect(await count("hs_graduation_records")).toBeGreaterThan(0);
  }, 120_000);
});
