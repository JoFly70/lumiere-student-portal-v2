/**
 * S05 round 2 — real HTTP end to end over a real Postgres.
 *
 * Real: the Express app wired by server/routes.ts `registerRoutes` (the same
 * mounting order as production, plus the roadmap-scoped JSON parser from
 * server/index.ts), the real routers with their DEFAULT dependencies
 * (defaultStudentRoadmapService -> drizzle -> disposable Postgres), real
 * requireAuth (local JWT -> users row looked up in Postgres), real RBAC,
 * multer, the xlsx importer, validation, projection and the canonical
 * degree-progress loader (no injection at all in this file).
 *
 * Mocked (external services only): supabase client and the account-status
 * profile lookup (both would call Supabase over the network), audit logging.
 * The mocked Supabase getUser only resolves tokens of the form `supa:<userId>`
 * and is used solely for the legacy /api/enrollments routes, which
 * authenticate with a Supabase token rather than the local JWT.
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
  type SeededStudent,
  type SeededUser,
} from "./helpers/s05-local-pg";
import { CANONICAL_TABLES, snapshotCanonical } from "./helpers/s05-roadmap-stack";
import { scenarioA, scenarioM, scenarioR } from "./fixtures/s05";

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
vi.mock("../server/lib/supabase", () => {
  const getUser = vi.fn(async (token: string) =>
    token.startsWith("supa:")
      ? { data: { user: { id: token.slice(5), email: "supa@synthetic.example" } }, error: null }
      : { data: { user: null }, error: { message: "invalid token" } },
  );
  return {
    supabaseAdmin: { auth: { getUser }, from: vi.fn() },
    createUserAuthClient: vi.fn(),
    isSupabaseConfigured: vi.fn(() => false),
  };
});
vi.mock("../server/lib/audit", () => ({
  auditAdmin: vi.fn().mockResolvedValue(undefined),
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  auditAction: vi.fn().mockResolvedValue(undefined),
}));

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);
const ready = PG_BINARIES_AVAILABLE && s05MigrationExists();

describe.skipIf(!ready)("S05 roadmap — real HTTP end to end", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let staff: SeededUser;
  let admin: SeededUser;
  let coach: SeededUser;
  let studentUser: SeededUser;
  let student: SeededStudent;
  let otherUser: SeededUser;
  let otherStudent: SeededStudent;

  const tok = (u: SeededUser) => ({ Authorization: `Bearer ${makeLocalJWT(u.id, u.email)}` });
  const api = () => request(base);
  const adminPath = (studentId: string, rest = "") => `/api/admin/students/${studentId}/roadmap${rest}`;

  beforeAll(async () => {
    pg = await startLocalPg();
    process.env.DATABASE_URL = pg.url;
    delete process.env.ALLOW_DEMO_MODE;
    staff = await seedUser(pg, "staff");
    admin = await seedUser(pg, "admin");
    coach = await seedUser(pg, "coach");
    studentUser = await seedUser(pg, "student");
    student = await seedStudent(pg, { userId: studentUser.id });
    otherUser = await seedUser(pg, "student");
    otherStudent = await seedStudent(pg, { userId: otherUser.id });
    await seedAcademicRecord(pg, student.id, { staffUserId: staff.id });

    const { registerRoutes } = await import("../server/routes");
    const app = express();
    // Same parser order as server/index.ts
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

  const xlsx = async (buf: Buffer, name: string) => ({ buf, name });
  const upload = (studentId: string, user: SeededUser, f: { buf: Buffer; name: string }, qs = "") =>
    api()
      .post(adminPath(studentId, `/imports${qs}`))
      .set(tok(user))
      .attach("workbook", f.buf, { filename: f.name, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

  describe("happy path: upload -> review -> acknowledge -> preview -> publish -> student GET -> progress -> GET", () => {
    let before: Awaited<ReturnType<typeof snapshotCanonical>>;
    let draftRevision: number;

    it("before any import the student sees NOT_PUBLISHED", async () => {
      before = await snapshotCanonical(pg);
      const res = await api().get("/api/student/roadmap").set(tok(studentUser));
      expect(res.status).toBe(200);
      expect(res.body.state).toBe("NOT_PUBLISHED");
      expect(res.body.contractVersion).toBe("student-roadmap/1");
    });

    // Built once: the zip container embeds the build time, so rebuilding is not byte-identical.
    let scenarioRBytes: Awaited<ReturnType<typeof scenarioR.workbook.build>>;

    it("staff uploads the scenario R .xlsx (multipart) -> 201 with a draft", async () => {
      scenarioRBytes = await scenarioR.workbook.build();
      const res = await upload(student.id, staff, await xlsx(scenarioRBytes, scenarioR.workbook.fileName));
      expect(res.status).toBe(201);
      expect(res.body.draft.content.items).toHaveLength(16);
      expect(res.body.draft.import.fileName).toBe(scenarioR.workbook.fileName);
      expect(res.body.draft.import.templateId).toBe("lumiere-roadmap-v1");
      draftRevision = res.body.draft.draftRevision;
    });

    it("the identical upload again is a 200 replay with the same draft", async () => {
      const res = await upload(student.id, staff, await xlsx(scenarioRBytes, "renamed.xlsx"));
      expect(res.status).toBe(200);
      expect(res.body.draft.versionNumber).toBe(1);
    });

    it("staff reviews state, previews (no staff note), and the student still sees nothing", async () => {
      const state = await api().get(adminPath(student.id)).set(tok(staff));
      expect(state.status).toBe(200);
      expect(state.body.draft.diff.baseVersionNumber).toBeNull();
      expect(JSON.stringify(state.body)).toContain("Capstone course: schedule only"); // staff-only data is visible to staff
      const preview = await api().get(adminPath(student.id, "/draft/preview")).set(tok(staff));
      expect(preview.status).toBe(200);
      expect(preview.body.preview).toBe(true);
      expect(JSON.stringify(preview.body)).not.toContain("staffNote");
      expect(JSON.stringify(preview.body)).not.toContain("Capstone course: schedule only");
      const asStudent = await api().get("/api/student/roadmap").set(tok(studentUser));
      expect(asStudent.body.state).toBe("NOT_PUBLISHED");
    });

    it("staff may acknowledge (no warnings here -> validation error for a bogus key) and is refused publishing", async () => {
      const bogus = await api().post(adminPath(student.id, "/draft/acknowledge")).set(tok(staff)).send({ expectedDraftRevision: draftRevision, exceptionKeys: ["NOPE:1"] });
      expect(bogus.status).toBe(400);
      expect(bogus.body.error.code).toBe("ROADMAP_VALIDATION_ERROR");
      const pub = await api().post(adminPath(student.id, "/draft/publish")).set(tok(staff)).send({ expectedDraftRevision: draftRevision, expectedPublishedVersionId: null });
      expect(pub.status).toBe(403);
    });

    it("admin publishes -> 200; stale publish afterwards is a typed error", async () => {
      const pub = await api().post(adminPath(student.id, "/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: draftRevision, expectedPublishedVersionId: null });
      expect(pub.status).toBe(200);
      expect(pub.body.published.versionNumber).toBe(1);
      expect(pub.body.draft).toBeNull();
      const again = await api().post(adminPath(student.id, "/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: draftRevision, expectedPublishedVersionId: null });
      expect(again.status).toBe(404);
      expect(again.body.error.code).toBe("ROADMAP_NO_DRAFT");
    });

    it("student GET /api/student/roadmap shows the published plan with the REAL canonical foundation", async () => {
      const res = await api().get("/api/student/roadmap").set(tok(studentUser));
      expect(res.status).toBe(200);
      expect(res.body.state).toBe("PUBLISHED");
      expect(res.body.counts.itemsTotal).toBe(16);
      expect(res.body.phases).toHaveLength(8);
      expect(JSON.stringify(res.body)).not.toContain("staffNote");
      expect(res.body.foundation.degreeState).toBe("UNDER_REVIEW");
      expect(res.body.foundation.ladder.applied).toBeNull();
    });

    it("student POST progress -> 200 view; stale revision -> 409; GET reflects the write", async () => {
      const post = await api()
        .post("/api/student/roadmap/progress")
        .set(tok(studentUser))
        .send({ itemKey: "r-acct-101", taskKey: null, status: "in_progress", expectedRevision: 0 });
      expect(post.status).toBe(200);
      expect(post.body.counts.itemsInProgress).toBe(1);
      const task = await api()
        .post("/api/student/roadmap/progress")
        .set(tok(studentUser))
        .send({ itemKey: "r-acct-101", taskKey: "challenge-1", status: "graded", expectedRevision: 0 });
      expect(task.status).toBe(200);
      const stale = await api()
        .post("/api/student/roadmap/progress")
        .set(tok(studentUser))
        .send({ itemKey: "r-acct-101", taskKey: null, status: "provider_complete", expectedRevision: 0 });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe("ROADMAP_PROGRESS_CONFLICT");
      expect(stale.body.error.details.currentRevision).toBe(1);

      const get = await api().get("/api/student/roadmap").set(tok(studentUser));
      expect(get.body.counts).toEqual(task.body.counts);
      expect(get.body.counts.tasksGraded).toBe(1);
      const item = get.body.phases.flatMap((p: { items: { key: string }[] }) => p.items).find((i: { key: string }) => i.key === "r-acct-101");
      expect(item.itemStatus).toBe("in_progress");
      expect(item.itemRevision).toBe(1);
    });

    it("item keys resolve only from the student's own plan; the other student has none and cannot report on it", async () => {
      const own = await api().post("/api/student/roadmap/progress").set(tok(otherUser)).send({ itemKey: "r-acct-101", taskKey: null, status: "in_progress", expectedRevision: 0 });
      expect(own.status).toBe(404);
      expect(own.body.error.code).toBe("ROADMAP_ITEM_NOT_FOUND");
      const view = await api().get("/api/student/roadmap").set(tok(otherUser));
      expect(view.body.state).toBe("NOT_PUBLISHED");
      const rows = await pg.sql(`select count(*)::int as n from student_roadmap_progress where student_id = '${otherStudent.id}'`);
      expect(rows[0].n).toBe(0);
      // unknown keys, and statuses that do not belong to the level
      const unknown = await api().post("/api/student/roadmap/progress").set(tok(studentUser)).send({ itemKey: "nope", taskKey: null, status: "in_progress", expectedRevision: 0 });
      expect(unknown.status).toBe(404);
      const wrongLevel = await api().post("/api/student/roadmap/progress").set(tok(studentUser)).send({ itemKey: "r-fin-301", taskKey: null, status: "graded", expectedRevision: 0 });
      expect(wrongLevel.status).toBe(422);
      expect(wrongLevel.body.error.code).toBe("ROADMAP_ITEM_NOT_REPORTABLE");
    });

    it("re-import v2 over HTTP: diff, warning acknowledgement, publish, retired progress visible to the student", async () => {
      await api().post("/api/student/roadmap/progress").set(tok(studentUser)).send({ itemKey: "r-bus-230", taskKey: null, status: "in_progress", expectedRevision: 0 });
      const rev = scenarioR.revisions[0];
      const up = await upload(student.id, staff, await xlsx(await rev.build(), rev.fileName));
      expect(up.status).toBe(201);
      const d = up.body.draft;
      expect(d.diff.added.map((a: { itemKey: string }) => a.itemKey)).toEqual(["r-soc-101"]);
      expect(d.diff.removed).toEqual([expect.objectContaining({ itemKey: "r-bus-230", hasProgress: true })]);
      const warnKeys = d.exceptions.filter((e: { severity: string }) => e.severity === "warning").map((e: { key: string }) => e.key);
      expect(warnKeys.length).toBeGreaterThan(0);
      const early = await api().post(adminPath(student.id, "/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: d.draftRevision, expectedPublishedVersionId: up.body.published.versionId });
      expect(early.status).toBe(422);
      expect(early.body.error.code).toBe("ROADMAP_NOT_PUBLISHABLE");
      const ack = await api().post(adminPath(student.id, "/draft/acknowledge")).set(tok(staff)).send({ expectedDraftRevision: d.draftRevision, exceptionKeys: warnKeys, note: "ok" });
      expect(ack.status).toBe(200);
      expect(ack.body.draft.publishable).toBe(true);
      // published unchanged until publish
      const mid = await api().get("/api/student/roadmap").set(tok(studentUser));
      expect(mid.body.plan.versionNumber).toBe(1);
      const stalePub = await api().post(adminPath(student.id, "/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: ack.body.draft.draftRevision, expectedPublishedVersionId: null });
      expect(stalePub.status).toBe(409);
      expect(stalePub.body.error.code).toBe("ROADMAP_STALE_DRAFT");
      const pub = await api().post(adminPath(student.id, "/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: ack.body.draft.draftRevision, expectedPublishedVersionId: up.body.published.versionId });
      expect(pub.status).toBe(200);
      const after = await api().get("/api/student/roadmap").set(tok(studentUser));
      expect(after.body.plan.versionNumber).toBe(2);
      expect(after.body.history.retiredProgress.map((r: { itemKey: string }) => r.itemKey)).toEqual(["r-bus-230"]);
      expect(after.body.history.previousVersions).toHaveLength(1);
    });

    it("none of this touched canonical credit tables", async () => {
      expect(await snapshotCanonical(pg)).toEqual(before);
      expect(CANONICAL_TABLES).toHaveLength(4);
    });

    it("draft management endpoints: from-published, edit, discard", async () => {
      const from = await api().post(adminPath(student.id, "/draft/from-published")).set(tok(staff)).send({});
      expect(from.status).toBe(200);
      const again = await api().post(adminPath(student.id, "/draft/from-published")).set(tok(staff)).send({});
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("ROADMAP_DRAFT_EXISTS");
      const content = from.body.draft.content;
      const edit = await api().put(adminPath(student.id, "/draft")).set(tok(staff)).send({ expectedDraftRevision: from.body.draft.draftRevision, content: { ...content, title: "Edited title" } });
      expect(edit.status).toBe(200);
      expect(edit.body.draft.content.title).toBe("Edited title");
      const staleEdit = await api().put(adminPath(student.id, "/draft")).set(tok(staff)).send({ expectedDraftRevision: from.body.draft.draftRevision, content });
      expect(staleEdit.status).toBe(409);
      const invalid = await api().put(adminPath(student.id, "/draft")).set(tok(staff)).send({ expectedDraftRevision: edit.body.draft.draftRevision, content: { nope: true } });
      expect(invalid.status).toBe(400);
      const discard = await api().post(adminPath(student.id, "/draft/discard")).set(tok(staff)).send({ expectedDraftRevision: edit.body.draft.draftRevision });
      expect(discard.status).toBe(200);
      expect(discard.body.draft).toBeNull();
    });
  });

  describe("JSON import package over HTTP", () => {
    it("accepts a roadmap package, rejects an invalid one with a blocking, unreadable import (422)", async () => {
      const { aiPackageScenarioS } = await import("./fixtures/s05");
      const st = await seedStudent(pg);
      const ok = await api().post(adminPath(st.id, "/imports")).set(tok(staff)).send(aiPackageScenarioS);
      expect(ok.status).toBe(201);
      expect(ok.body.draft.import.templateId).toBe("ai-package-v1");
      expect(ok.body.draft.publishable).toBe(false);
      const st2 = await seedStudent(pg);
      const bad = await api().post(adminPath(st2.id, "/imports")).set(tok(staff)).send({ format: "wrong", content: 1 });
      expect(bad.status).toBe(422);
      expect(bad.body.error.code).toBe("ROADMAP_IMPORT_UNREADABLE");
      expect(JSON.stringify(bad.body.error.details.exceptions)).toContain("PACKAGE_INVALID");
      const empty = await api().post(adminPath(st2.id, "/imports")).set(tok(staff)).send({});
      expect(empty.status).toBe(400);
    });
  });

  describe("negative security", () => {
    it("unauthenticated requests -> 401 on every roadmap endpoint", async () => {
      const calls: Array<[string, string]> = [
        ["get", adminPath(student.id)],
        ["post", adminPath(student.id, "/imports")],
        ["put", adminPath(student.id, "/draft")],
        ["post", adminPath(student.id, "/draft/acknowledge")],
        ["get", adminPath(student.id, "/draft/preview")],
        ["post", adminPath(student.id, "/draft/publish")],
        ["post", adminPath(student.id, "/draft/discard")],
        ["post", adminPath(student.id, "/draft/from-published")],
        ["get", "/api/student/roadmap"],
        ["post", "/api/student/roadmap/progress"],
      ];
      for (const [method, url] of calls) {
        const res = await (api() as unknown as Record<string, (u: string) => request.Test>)[method](url);
        expect(res.status, `${method} ${url}`).toBe(401);
      }
      const forged = await api().get("/api/student/roadmap").set({ Authorization: "Bearer a.b.c" });
      expect(forged.status).toBe(401);
      const unknownUser = await api().get("/api/student/roadmap").set({ Authorization: `Bearer ${makeLocalJWT(crypto.randomUUID(), "ghost@synthetic.example")}` });
      expect(unknownUser.status).toBe(401);
    });

    it("a student calling any admin roadmap endpoint -> 403 and nothing is created", async () => {
      const wb = await scenarioA.workbook.build();
      const target = otherStudent.id;
      const calls: Array<[string, string]> = [
        ["get", adminPath(target)],
        ["put", adminPath(target, "/draft")],
        ["post", adminPath(target, "/draft/acknowledge")],
        ["get", adminPath(target, "/draft/preview")],
        ["post", adminPath(target, "/draft/publish")],
        ["post", adminPath(target, "/draft/discard")],
        ["post", adminPath(target, "/draft/from-published")],
      ];
      for (const [method, url] of calls) {
        const res = await (api() as unknown as Record<string, (u: string) => request.Test>)[method](url).set(tok(studentUser)).send({});
        expect(res.status, `${method} ${url}`).toBe(403);
      }
      const imp = await upload(target, studentUser, await xlsx(wb, "x.xlsx"));
      expect(imp.status).toBe(403);
      const own = await upload(student.id, studentUser, await xlsx(wb, "x.xlsx"));
      expect(own.status).toBe(403);
      const plans = await pg.sql(`select count(*)::int as n from student_roadmap_plans where student_id = '${target}'`);
      expect(plans[0].n).toBe(0);
    });

    it("coach cannot use the staff roadmap API; staff and admin cannot use the student API", async () => {
      expect((await api().get(adminPath(student.id)).set(tok(coach))).status).toBe(403);
      expect((await api().get("/api/student/roadmap").set(tok(staff))).status).toBe(403);
      expect((await api().get("/api/student/roadmap").set(tok(admin))).status).toBe(403);
      expect((await api().post("/api/student/roadmap/progress").set(tok(staff)).send({ itemKey: "a", taskKey: null, status: "in_progress", expectedRevision: 0 })).status).toBe(403);
    });

    it("staff can import and preview but publish is admin-only (403); admin may also import", async () => {
      const st = await seedStudent(pg);
      // Build once: the workbook zip embeds its build time (2 s resolution), so two
      // builds straddling a boundary differ and the replay below would 409 under load.
      const bytes = await scenarioA.workbook.build();
      const imp = await upload(st.id, staff, await xlsx(bytes, "a.xlsx"));
      expect(imp.status).toBe(201);
      const prev = await api().get(adminPath(st.id, "/draft/preview")).set(tok(staff));
      expect(prev.status).toBe(200);
      const pub = await api().post(adminPath(st.id, "/draft/publish")).set(tok(staff)).send({ expectedDraftRevision: imp.body.draft.draftRevision, expectedPublishedVersionId: null });
      expect(pub.status).toBe(403);
      const state = await api().get(adminPath(st.id)).set(tok(staff));
      expect(state.body.published).toBeNull();
      const adminImp = await upload(st.id, admin, await xlsx(bytes, "a.xlsx"));
      expect(adminImp.status).toBe(200); // same bytes -> idempotent replay for the admin
      const ok = await api().post(adminPath(st.id, "/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: imp.body.draft.draftRevision, expectedPublishedVersionId: null });
      expect(ok.status).toBe(200);
    });

    it("a student naming studentId in the query or body -> 400, before any data access", async () => {
      const q1 = await api().get(`/api/student/roadmap?studentId=${otherStudent.id}`).set(tok(studentUser));
      expect(q1.status).toBe(400);
      expect(q1.body.error.code).toBe("ROADMAP_VALIDATION_ERROR");
      const q2 = await api().post(`/api/student/roadmap/progress?studentId=${otherStudent.id}`).set(tok(studentUser)).send({ itemKey: "r-acct-101", taskKey: null, status: "in_progress", expectedRevision: 5 });
      expect(q2.status).toBe(400);
      const b = await api().post("/api/student/roadmap/progress").set(tok(studentUser)).send({ studentId: otherStudent.id, itemKey: "r-acct-101", taskKey: null, status: "in_progress", expectedRevision: 5 });
      expect(b.status).toBe(400);
      const extra = await api().post("/api/student/roadmap/progress").set(tok(studentUser)).send({ itemKey: "r-acct-101", taskKey: null, status: "in_progress", expectedRevision: 5, credits: "3" });
      expect(extra.status).toBe(400);
      const none = await pg.sql(`select count(*)::int as n from student_roadmap_progress where student_id = '${otherStudent.id}'`);
      expect(none[0].n).toBe(0);
      // staff: query-string studentId on a staff route is rejected too
      const s = await api().get(`${adminPath(student.id)}?studentId=${otherStudent.id}`).set(tok(staff));
      expect(s.status).toBe(400);
    });

    it("a student account without a student profile -> 404 STUDENT_PROFILE_NOT_FOUND", async () => {
      const lonely = await seedUser(pg, "student");
      const res = await api().get("/api/student/roadmap").set(tok(lonely));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("STUDENT_PROFILE_NOT_FOUND");
    });

    it("rejects non-xlsx, oversized, empty and multi-file uploads; unknown student 404", async () => {
      const st = await seedStudent(pg);
      const wrongExt = await upload(st.id, staff, { buf: await scenarioA.workbook.build(), name: "plan.csv" });
      expect(wrongExt.status).toBe(400);
      const notZip = await upload(st.id, staff, { buf: Buffer.from("a,b,c\n1,2,3\n"), name: "plan.xlsx" });
      expect(notZip.status).toBe(400);
      expect(notZip.body.error.code).toBe("ROADMAP_VALIDATION_ERROR");
      const big = Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(5 * 1024 * 1024 + 10, 1)]);
      const tooBig = await upload(st.id, staff, { buf: big, name: "huge.xlsx" });
      expect(tooBig.status).toBe(413);
      const corrupt = await upload(st.id, staff, { buf: Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.from("not really a workbook")]), name: "broken.xlsx" });
      expect(corrupt.status).toBe(422);
      expect(corrupt.body.error.code).toBe("ROADMAP_IMPORT_UNREADABLE");
      const noFile = await api().post(adminPath(st.id, "/imports")).set(tok(staff)).field("note", "hi");
      expect(noFile.status).toBe(400);
      const wrongField = await api().post(adminPath(st.id, "/imports")).set(tok(staff)).attach("file", await scenarioA.workbook.build(), "a.xlsx");
      expect(wrongField.status).toBe(400);
      const two = await api().post(adminPath(st.id, "/imports")).set(tok(staff))
        .attach("workbook", await scenarioA.workbook.build(), "a.xlsx").attach("workbook", await scenarioA.workbook.build(), "b.xlsx");
      expect(two.status).toBe(400);
      const missing = await upload("no-such-student", staff, await xlsx(await scenarioA.workbook.build(), "a.xlsx"));
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe("ROADMAP_STUDENT_NOT_FOUND");
      const created = await pg.sql(`select count(*)::int as n from student_roadmap_versions v join student_roadmap_plans p on p.id = v.plan_id where p.student_id = '${st.id}'`);
      expect(created[0].n).toBe(0);
    });

    it("scenario M over HTTP: publish is refused (422) until warnings are acknowledged; ack of an unknown key is a 400", async () => {
      const st = await seedStudent(pg);
      const up = await upload(st.id, staff, await xlsx(await scenarioM.workbook.build(), scenarioM.workbook.fileName));
      expect(up.status).toBe(201);
      const warnings = up.body.draft.exceptions.filter((e: { severity: string }) => e.severity === "warning");
      expect(warnings.length).toBe(4);
      const refused = await api().post(adminPath(st.id, "/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: up.body.draft.draftRevision, expectedPublishedVersionId: null });
      expect(refused.status).toBe(422);
      expect(refused.body.error.details.unacknowledged).toHaveLength(4);
      const badBody = await api().post(adminPath(st.id, "/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: "1" });
      expect(badBody.status).toBe(400);
    });

    it("legacy /api/enrollments POST and DELETE are 403 for students (Supabase-token path) and the table stays empty", async () => {
      const supaStudent = { Authorization: `Bearer supa:${studentUser.id}` };
      const post = await api().post("/api/enrollments").set(supaStudent).send({ courseId: crypto.randomUUID(), status: "planned" });
      expect(post.status).toBe(403);
      expect(post.body.error.code).toBe("ROADMAP_STAFF_MANAGED");
      const del = await api().delete(`/api/enrollments/${crypto.randomUUID()}`).set(supaStudent);
      expect(del.status).toBe(403);
      expect(del.body.error.code).toBe("ROADMAP_STAFF_MANAGED");
      const anon = await api().post("/api/enrollments").send({});
      expect(anon.status).toBe(401);
    });
  });
});
