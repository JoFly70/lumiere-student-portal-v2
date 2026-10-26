/**
 * S10 — consolidated student-experience acceptance journey.
 *
 * ONE Express app (production `registerRoutes`), real RBAC with local HS256 JWTs.
 *
 *   Academic journey (A1-A8, the S07 13-step assertions) .. REAL disposable PostgreSQL 16 +
 *       repository migrations, real importer / plan review / diff / publish / projection /
 *       canonical degree-progress loader.
 *   Support journey (S1-S9) .................................. the REAL production `/api/tickets`
 *       router mounted by registerRoutes (real requireAuth; roadmap context verified against the
 *       REAL published roadmap in Postgres). ONLY the four support tables and the storage bucket
 *       are the S08 in-memory Supabase fake: the support tables are NOT in the local migration
 *       chain (they come from legacy migrations/010, which the harness does not apply) and the
 *       router speaks PostgREST, not SQL. The fake is installed behind the mocked `supabaseAdmin`.
 *
 * STUBBED: hosted Supabase auth/profile lookups (local JWT instead), audit logging, email.
 *
 * Evidence goes to docs/recovery/s10-evidence/journey/ in a normalised form (uuids, timestamps
 * and hashes replaced by stable placeholders; no wall-clock values) so reruns do not dirty git.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
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
import { buildEphExecution, buildEphMaster, buildRutExecution, buildRutMaster } from "./fixtures/s07/builders";
import { createFakeSupportSupabase } from "./helpers/fake-supabase-support";

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

// The support tables + storage: the S08 in-memory fake, installed behind supabaseAdmin.
const supportFake = vi.hoisted(() => ({ current: null as null | { client: { from(t: string): unknown; storage: unknown } } }));

vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: {
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "invalid token" } })) },
    from: (t: string) => supportFake.current!.client.from(t),
    get storage() {
      return supportFake.current!.client.storage;
    },
  },
  createUserAuthClient: vi.fn(),
  isSupabaseConfigured: true,
}));
vi.mock("../server/lib/audit", () => ({
  auditAdmin: vi.fn().mockResolvedValue(undefined),
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  auditAction: vi.fn().mockResolvedValue(undefined),
  auditSystem: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../server/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(false),
  sendTicketCreatedEmailToStaff: vi.fn(),
  sendTicketStatusUpdateEmail: vi.fn(),
  sendNewCommentEmail: vi.fn(),
}));

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);
const ready = PG_BINARIES_AVAILABLE && s05MigrationExists();
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const OUT = path.resolve(import.meta.dirname, "..", "docs/recovery/s10-evidence/journey");

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ex = { key: string; code: string; severity: string };

/** Replace anything nondeterministic so committed evidence is stable across runs. */
function normalise(value: unknown): unknown {
  const ids = new Map<string, string>();
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const walk = (v: any): any => {
    if (typeof v === "string") {
      if (/^[0-9a-f]{64}$/i.test(v)) return "<hash>";
      let s = v.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<ts>");
      s = s.replace(UUID, (m) => {
        if (!ids.has(m)) ids.set(m, `<id-${ids.size + 1}>`);
        return ids.get(m)!;
      });
      return s.replace(/\/\d{10,16}-[a-z0-9]{4,24}\./g, "/<stamp>.");
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value);
}
const save = (name: string, data: unknown) => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(normalise(data), null, 2) + "\n");
};
const allItems = (view: any): any[] => view.phases.flatMap((p: any) => p.items);
const findItem = (view: any, key: string) => allItems(view).find((i) => i.key === key);
const warningKeys = (draft: { exceptions: Ex[] }) => draft.exceptions.filter((e) => e.severity === "warning").map((e) => e.key);
const rowsOf = (body: any): any[] => (Array.isArray(body) ? body : body.tickets ?? []);

describe.skipIf(!ready)("S10 consolidated journey — real Postgres + real HTTP (+ S08 support fake)", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let staff: SeededUser;
  let admin: SeededUser;
  let studentUser: SeededUser;
  let otherStudentUser: SeededUser;
  let student: SeededStudent;
  const fake = createFakeSupportSupabase();
  supportFake.current = fake;

  const tok = (u: SeededUser) => ({ Authorization: `Bearer ${makeLocalJWT(u.id, u.email)}` });
  const api = () => request(base);
  const adminPath = (rest = "", id?: string) => `/api/admin/students/${id ?? student.id}/roadmap${rest}`;
  const pair = (who: SeededUser, m: { buffer: Buffer; fileName: string }, c: { buffer: Buffer; fileName: string }, id?: string) =>
    api()
      .post(adminPath("/imports", id))
      .set(tok(who))
      .attach("workbook", m.buffer, { filename: m.fileName, contentType: XLSX })
      .attach("companion", c.buffer, { filename: c.fileName, contentType: XLSX });
  const studentView = async () => (await api().get("/api/student/roadmap").set(tok(studentUser))).body;
  const progress = (itemKey: string, taskKey: string | null, status: string, expectedRevision: number) =>
    api().post("/api/student/roadmap/progress").set(tok(studentUser)).send({ itemKey, taskKey, status, expectedRevision });

  beforeAll(async () => {
    pg = await startLocalPg();
    process.env.DATABASE_URL = pg.url;
    delete process.env.ALLOW_DEMO_MODE;
    staff = await seedUser(pg, "staff");
    admin = await seedUser(pg, "admin");
    studentUser = await seedUser(pg, "student");
    otherStudentUser = await seedUser(pg, "student");
    student = await seedStudent(pg, { userId: studentUser.id, firstName: "EPH", lastName: "Journey" });
    await seedAcademicRecord(pg, student.id, { staffUserId: staff.id });
    // the support router reads `users` through PostgREST for names / staff directory
    for (const [u, name] of [
      [staff, "Sam Staff"],
      [admin, "Alex Admin"],
      [studentUser, "Ada Student"],
      [otherStudentUser, "Ben Student"],
    ] as const) {
      fake.seedUser({ id: u.id, email: u.email, name, role: u.role });
    }
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

  let m1: Awaited<ReturnType<typeof buildEphMaster>>;
  let e1: Awaited<ReturnType<typeof buildEphExecution>>;
  let m2: Awaited<ReturnType<typeof buildEphMaster>>;
  let e2: Awaited<ReturnType<typeof buildEphExecution>>;
  let canonicalBefore: Awaited<ReturnType<typeof snapshotCanonical>>;
  let draft: any;
  let publishedId = "";
  let viewPublished: any;
  let viewAfterProgress: any;
  let v2View: any;
  let rutOnlyKey = "";

  beforeAll(async () => {
    m1 = await buildEphMaster(1);
    e1 = await buildEphExecution(1);
    m2 = await buildEphMaster(2);
    e2 = await buildEphExecution(2);
  });

  // ------------------------------------------------------------------ academic journey
  it("A1 import: one EPH pair -> one draft, no duplicate keys, history separate, idempotent replay", async () => {
    canonicalBefore = await snapshotCanonical(pg);
    expect((await studentView()).state).toBe("NOT_PUBLISHED");
    const res = await pair(staff, m1, e1);
    expect(res.status).toBe(201);
    draft = res.body.draft;
    const keys: string[] = draft.content.items.map((i: any) => i.key);
    expect(keys).toHaveLength(24);
    expect(new Set(keys).size).toBe(keys.length);
    expect((draft.exceptions as Ex[]).filter((e) => e.severity === "blocking")).toEqual([]);
    const again = await pair(staff, m1, e1);
    expect(again.status).toBe(200);
    const state = await api().get(adminPath()).set(tok(staff));
    expect(state.body.versions.filter((v: any) => v.status === "draft")).toHaveLength(1);
    draft = state.body.draft;

    const history: any[] = draft.content.reportedHistory;
    expect(history.find((h) => h.kind === "credit_baseline").reportedCredits).toBe("51");
    expect(history.some((h) => h.reportedStatus === "completed")).toBe(true);
    for (const i of draft.content.items) expect(["planned", "hold", "alternative"]).toContain(i.planStatus);
    const titles = new Set(draft.content.items.map((i: any) => String(i.title).toLowerCase()));
    for (const h of history.filter((x: any) => x.reportedStatus === "completed")) expect(titles.has(String(h.title).toLowerCase())).toBe(false);
    save("A01-import-and-history.json", {
      step: "A1 staff imports master+execution pair; history kept separate from plan items",
      draftVersion: draft.versionNumber,
      planItems: keys.length,
      duplicateKeys: 0,
      blockingExceptions: 0,
      replayCreatedSecondDraft: false,
      reportedHistoryKinds: [...new Set(history.map((h: any) => h.kind))].sort(),
      creditBaselineReported: "51",
      completedHistoryRowsAsPlanItems: 0,
    });
  });

  it("A2 warnings need acknowledgement; staff cannot publish; stale revision 409; admin publishes", async () => {
    const codes = new Set((draft.exceptions as Ex[]).filter((e) => e.severity === "warning").map((e) => e.code));
    for (const c of ["CONDITIONAL_ALLOCATION", "EQUIVALENCY_CONDITIONAL", "REPORTED_HISTORY_NOT_CREDIT", "STARTING_CREDITS_UNVERIFIED", "LICENSING_CREDIT_SEPARATE"]) {
      expect(codes.has(c), c).toBe(true);
    }
    const preview = await api().get(adminPath("/draft/preview")).set(tok(staff));
    expect(preview.status).toBe(200);
    const text = JSON.stringify(preview.body);
    for (const forbidden of ["reportedHistory", "credit_baseline", "provenance", "staffNote", "COMPANION_", "exceptions"]) expect(text).not.toContain(forbidden);
    const staffPub = await api().post(adminPath("/draft/publish")).set(tok(staff)).send({ expectedDraftRevision: draft.draftRevision, expectedPublishedVersionId: null });
    expect(staffPub.status).toBe(403);
    const early = await api().post(adminPath("/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: draft.draftRevision, expectedPublishedVersionId: null });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe("ROADMAP_NOT_PUBLISHABLE");
    const ack = await api().post(adminPath("/draft/acknowledge")).set(tok(admin)).send({ expectedDraftRevision: draft.draftRevision, exceptionKeys: warningKeys(draft), note: "S10 acceptance: warnings reviewed" });
    expect(ack.status).toBe(200);
    expect(ack.body.draft.publishable).toBe(true);
    const stale = await api().post(adminPath("/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: draft.draftRevision, expectedPublishedVersionId: null });
    expect(stale.status).toBe(409);
    expect((await studentView()).state).toBe("NOT_PUBLISHED");
    const pub = await api().post(adminPath("/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: ack.body.draft.draftRevision, expectedPublishedVersionId: null });
    expect(pub.status).toBe(200);
    publishedId = pub.body.published.versionId;
    save("A02-acknowledge-and-publish.json", {
      step: "A2 warnings need acknowledgement, then admin publishes",
      warningCodesAcknowledged: [...codes].sort(),
      staffPublish: 403,
      publishBeforeAcknowledge: 422,
      stalePublish: 409,
      adminPublish: 200,
      publishedVersion: pub.body.published.versionNumber,
      previewContainsStaffOnlyData: false,
    });
  });

  it("A3 student sees one named next task and the roadmap content", async () => {
    viewPublished = await studentView();
    const v = viewPublished;
    expect(v.state).toBe("PUBLISHED");
    expect(v.today.focusItemKeys.length).toBeGreaterThan(0);
    expect(v.today.focusItemKeys.length).toBeLessThanOrEqual(3);
    expect(v.today.headline.trim().length).toBeGreaterThan(10);
    const items = allItems(v);
    expect(items).toHaveLength(24);
    expect(v.phases.filter((p: any) => p.state === "current")).toHaveLength(1);
    expect(items.some((i) => i.tasks.some((t: any) => t.dueDate))).toBe(true);
    const text = JSON.stringify(v);
    for (const forbidden of ["reportedHistory", "credit_baseline", "provenance", "staffNote", "exceptions"]) expect(text).not.toContain(forbidden);
    save("A03-student-sees-published-roadmap.json", {
      step: "A3 student sees a named next task",
      state: v.state,
      focusItemCount: v.today.focusItemKeys.length,
      focusItemTitles: v.today.focusItemKeys.map((k: string) => findItem(v, k).title),
      currentPhases: 1,
      items: items.length,
      milestoneKinds: v.milestones.map((m: any) => m.kind),
    });
  });

  it("A4 second student (RUT pair) has challenge / milestone / assignment tasks", async () => {
    const rutUser = await seedUser(pg, "student");
    const rut = await seedStudent(pg, { userId: rutUser.id, firstName: "RUT", lastName: "Journey" });
    const [rm, re] = [await buildRutMaster(), await buildRutExecution()];
    const up = await pair(staff, rm, re, rut.id);
    expect(up.status).toBe(201);
    const ack = await api().post(adminPath("/draft/acknowledge", rut.id)).set(tok(staff)).send({ expectedDraftRevision: up.body.draft.draftRevision, exceptionKeys: warningKeys(up.body.draft), note: "reviewed" });
    const pub = await api().post(adminPath("/draft/publish", rut.id)).set(tok(admin)).send({ expectedDraftRevision: ack.body.draft.draftRevision, expectedPublishedVersionId: null });
    expect(pub.status).toBe(200);
    const view = (await api().get("/api/student/roadmap").set(tok(rutUser))).body;
    const kinds = new Set(allItems(view).flatMap((i) => i.tasks.map((t: any) => t.kind)));
    expect([...kinds].sort()).toEqual(expect.arrayContaining(["challenge", "milestone", "assignment"]));
    const eph = new Set(allItems(viewPublished).map((i) => i.key));
    rutOnlyKey = allItems(view).map((i) => i.key).find((k) => !eph.has(k)) ?? "";
    expect(rutOnlyKey).not.toBe("");
    save("A04-second-student-task-kinds.json", { step: "A4 RUT pair task kinds", taskKinds: [...kinds].sort() });
  });

  it("A5 progress write equals a fresh GET (what Flight Deck and Roadmap both consume)", async () => {
    const itemKey = "business-103";
    const before = findItem(viewPublished, itemKey);
    const taskKey = before.tasks.find((t: any) => t.kind === "assignment").key;
    expect((await progress(itemKey, taskKey, "in_progress", 0)).status).toBe(200);
    expect((await progress(itemKey, taskKey, "submitted", 1)).status).toBe(200);
    expect((await progress(itemKey, null, "in_progress", 0)).status).toBe(200);
    for (const key of ["u-s-history-i", "business-308", "opm-3010"]) expect((await progress(key, null, "in_progress", 0)).status, key).toBe(200);
    const last = await progress("business-308", findItem(viewPublished, "business-308").tasks[0].key, "submitted", 0);
    expect(last.status).toBe(200);
    const fresh = await studentView();
    expect(fresh.counts).toEqual(last.body.counts);
    expect(fresh.today).toEqual(last.body.today);
    const shape = (v: any) => allItems(v).map((i) => [i.key, i.itemStatus, i.stage, i.itemRevision, i.tasks.map((t: any) => [t.key, t.status, t.revision])]);
    expect(shape(fresh)).toEqual(shape(last.body));
    expect(fresh.counts.itemsInProgress).toBe(4);
    expect(fresh.counts.tasksSubmitted).toBe(2);
    expect((await progress(itemKey, taskKey, "graded", 0)).status).toBe(409);
    viewAfterProgress = fresh;
    save("A05-progress-consistent.json", { step: "A5 progress; write result equals fresh GET", countsBefore: viewPublished.counts, countsAfter: fresh.counts, staleRevision: 409 });
  });

  it("A6 v2: progress kept on rescheduled items; replacements start empty; retired progress kept as history", async () => {
    const up = await pair(staff, m2, e2);
    expect(up.status).toBe(201);
    const d = up.body.draft;
    expect(d.diff.added.map((a: any) => a.itemKey).sort()).toEqual(["business-324", "introduction-to-chemistry"]);
    expect(d.diff.removed.map((r: any) => `${r.itemKey}:${r.hasProgress}`).sort()).toEqual(["business-308:true", "opm-3010:true"]);
    expect((d.exceptions as Ex[]).filter((e) => e.code === "PROGRESS_ON_REMOVED_ITEM")).toHaveLength(2);
    const ack = await api().post(adminPath("/draft/acknowledge")).set(tok(staff)).send({ expectedDraftRevision: d.draftRevision, exceptionKeys: warningKeys(d), note: "v2 reviewed" });
    expect(ack.status).toBe(200);
    expect((await studentView()).plan.versionNumber).toBe(1);
    const pub = await api().post(adminPath("/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: ack.body.draft.draftRevision, expectedPublishedVersionId: publishedId });
    expect(pub.status).toBe(200);
    v2View = await studentView();
    expect(v2View.plan.versionNumber).toBe(2);
    expect(findItem(v2View, "business-103")).toMatchObject({ itemStatus: "in_progress" });
    expect(findItem(v2View, "business-103").tasks.find((t: any) => t.kind === "assignment").status).toBe("submitted");
    for (const k of ["business-324", "introduction-to-chemistry"]) {
      const it = findItem(v2View, k);
      expect(it.itemStatus).toBe("not_started");
      expect(it.tasks.every((t: any) => t.status === "not_started")).toBe(true);
    }
    expect(findItem(v2View, "business-308")).toBeUndefined();
    expect(v2View.history.retiredProgress.map((r: any) => r.itemKey).sort()).toEqual(["business-308", "opm-3010"]);
    save("A06-revision-preserves-progress.json", {
      step: "A6 revision v2",
      added: d.diff.added.map((a: any) => a.itemKey).sort(),
      removedWithProgress: d.diff.removed.map((r: any) => r.itemKey).sort(),
      rescheduledItemKeepsProgress: true,
      replacementsStartEmpty: true,
      retiredProgress: v2View.history.retiredProgress.map((r: any) => r.itemKey).sort(),
      publishedVersion: 2,
    });
  });

  it("A7 canonical academic credits are byte-identical; student cannot reach admin endpoints or change credit/plan", async () => {
    const after = await snapshotCanonical(pg);
    for (const t of CANONICAL_TABLES) expect(after[t], t).toEqual(canonicalBefore[t]);
    expect(viewAfterProgress.foundation).toEqual(viewPublished.foundation);
    expect({ ...v2View.foundation.ladder, planned: null }).toEqual({ ...viewPublished.foundation.ladder, planned: null });
    for (const [method, url] of [["get", adminPath()], ["put", adminPath("/draft")], ["post", adminPath("/draft/publish")]] as Array<[string, string]>) {
      const res = await (api() as unknown as Record<string, (u: string) => request.Test>)[method](url).set(tok(studentUser)).send({});
      expect(res.status, url).toBe(403);
    }
    for (const extra of [{ credits: "3" }, { planStatus: "dropped" }, { studentId: crypto.randomUUID() }, { standing: "VERIFIED_APPLIED" }]) {
      const res = await api().post("/api/student/roadmap/progress").set(tok(studentUser)).send({ itemKey: "business-103", taskKey: null, status: "provider_complete", expectedRevision: 1, ...extra });
      expect(res.status).toBe(400);
    }
    expect((await progress("business-103", null, "officially_accepted", 1)).status).toBe(400);
    save("A07-canonical-credits-unchanged.json", {
      step: "A7 canonical credit tables unchanged by import/publish/student activity",
      tables: CANONICAL_TABLES,
      identical: JSON.stringify(canonicalBefore) === JSON.stringify(after),
      foundationLadderUnchangedByStudentActivity: true,
      studentAdminEndpoints: 403,
      studentCreditOrPlanFields: 400,
      officiallyAcceptedAsStudentStatus: 400,
    });
  });

  // ------------------------------------------------------------------ support journey
  const t = (who: SeededUser) => ({
    list: () => api().get("/api/tickets").set(tok(who)),
    get: (id: string) => api().get(`/api/tickets/${id}`).set(tok(who)),
    post: (p: string, body: object = {}) => api().post(`/api/tickets${p}`).set(tok(who)).send(body),
    patch: (id: string, body: object) => api().patch(`/api/tickets/${id}`).set(tok(who)).send(body),
    dl: (id: string, att: string) => api().get(`/api/tickets/${id}/attachments/${att}/download-url`).set(tok(who)),
  });
  const ADA = () => t(studentUser);
  const BEN = () => t(otherStudentUser);
  const SAM = () => t(staff);
  let ticketId = "";
  let internalCommentId = "";
  let staffAttachmentId = "";
  let ownAttachmentId = "";

  it("S1 student opens support; context options come from the REAL current published roadmap (v2)", async () => {
    const list = await ADA().list();
    expect(list.status).toBe(200);
    const res = await api().get("/api/tickets/context-options").set(tok(studentUser));
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.planVersion).toBe(2);
    const keys: string[] = res.body.items.map((i: any) => i.key ?? i.itemKey);
    expect(keys).toContain("business-103");
    expect(keys).toContain("business-324"); // added in v2
    expect(keys).not.toContain("business-308"); // removed in v2
    save("S01-student-opens-support.json", { step: "S1 student opens support", ticketsListed: rowsOf(list.body).length, contextAvailable: true, planVersion: res.body.planVersion, offersCurrentItem: true, offersAddedItem: true, offersRemovedItem: false });
  });

  it("S2 create a request with roadmap context; stale, foreign and invented item keys are rejected", async () => {
    const codes: Record<string, unknown> = {};
    for (const [label, key] of [["staleRemovedInV2", "business-308"], ["foreignOtherStudentsPlan", rutOnlyKey], ["invented", "not-a-real-item"]] as const) {
      const bad = await ADA().post("", { subject: "Question about a course", description: "I need help with this item please.", topic: "roadmap_question", context: { roadmapItemKey: key } });
      expect(bad.status, key).toBe(400);
      expect(bad.body.code ?? bad.body.error?.code, key).toBe("CONTEXT_NOT_IN_PLAN");
      codes[label] = { status: bad.status, code: bad.body.code ?? bad.body.error?.code };
    }
    expect(fake.rows("support_tickets")).toHaveLength(0);
    const ok = await ADA().post("", { subject: "Question about Business 103", description: "I am unsure which assignment to do next in Business 103.", topic: "roadmap_question", context: { roadmapItemKey: "business-103" } });
    expect(ok.status).toBe(201);
    ticketId = ok.body.ticket.id;
    const ctx = ok.body.ticket.metadata?.context ?? ok.body.ticket.context;
    expect(ctx).toMatchObject({ itemKey: "business-103", planVersion: 2 });
    save("S02-create-with-context.json", { step: "S2 create with verified roadmap context", rejected: codes, ticketsStoredAfterRejections: 0, created: { status: 201, context: ctx } });
  });

  it("S3 staff sees the request in the queue", async () => {
    const list = await SAM().list();
    expect(list.status).toBe(200);
    expect(rowsOf(list.body).map((x) => x.id)).toContain(ticketId);
    const detail = await SAM().get(ticketId);
    expect(detail.status).toBe(200);
    save("S03-staff-sees-ticket.json", { step: "S3 staff sees it", visibleInQueue: true, status: detail.body.ticket.status });
  });

  it("S4 staff replies publicly and adds an internal note", async () => {
    const reply = await SAM().post(`/${ticketId}/comments`, { content: "Start with the written assignment, then the quiz.", isInternal: false });
    expect(reply.status).toBe(201);
    const note = await SAM().post(`/${ticketId}/comments`, { content: "INTERNAL: student seems behind; check advisor notes.", isInternal: true });
    expect(note.status).toBe(201);
    const staffDetail = await SAM().get(ticketId);
    const internal = staffDetail.body.ticket.ticket_comments.find((c: any) => c.is_internal);
    expect(internal).toBeDefined();
    internalCommentId = internal.id;
    expect(staffDetail.body.ticket.status).toBe("in_progress");
    save("S04-staff-reply-and-note.json", { step: "S4 staff reply + internal note", publicReply: 201, internalNote: 201, statusAfterReply: staffDetail.body.ticket.status, staffSeesInternalNote: true });
  });

  it("S5 student sees the reply but never the internal note, and replies", async () => {
    const d = await ADA().get(ticketId);
    expect(d.status).toBe(200);
    const text = JSON.stringify(d.body);
    expect(text).not.toContain("INTERNAL:");
    expect(text).not.toContain("advisor notes");
    expect(d.body.ticket.ticket_comments.every((c: any) => !c.is_internal)).toBe(true);
    expect(d.body.ticket.ticket_comments.map((c: any) => c.content)).toContain("Start with the written assignment, then the quiz.");
    expect((await ADA().post(`/${ticketId}/comments`, { content: "Thank you, I will start with the assignment." })).status).toBe(201);
    expect((await ADA().post(`/${ticketId}/comments`, { content: "sneaky note", isInternal: true })).status).toBe(403);
    save("S05-student-sees-reply-only.json", { step: "S5 student sees public reply only", internalNoteVisibleToStudent: false, studentReply: 201, studentInternalNote: 403 });
  });

  it("S6 attachments: path and ownership enforced; internal-note attachments invisible to the student", async () => {
    const own = await ADA().post(`/${ticketId}/attachments/upload-url`, { file_name: "plan.pdf", file_size: 2048, file_type: "application/pdf" });
    expect(own.status).toBe(200);
    expect(own.body.storagePath).toMatch(new RegExp(`^tickets/${ticketId}/${studentUser.id}/`));
    fake.addStorageObject(own.body.storagePath);
    const reg = await ADA().post(`/${ticketId}/attachments`, { file_name: "plan.pdf", file_size: 2048, file_type: "application/pdf", storage_path: own.body.storagePath });
    expect(reg.status).toBe(201);
    ownAttachmentId = reg.body.attachment.id;
    const rejected: number[] = [];
    for (const p of [
      `tickets/${ticketId}/${otherStudentUser.id}/1700000000-abcd12.pdf`,
      `tickets/other-ticket/${studentUser.id}/1700000000-abcd12.pdf`,
      `documents/${studentUser.id}/transcript.pdf`,
      `tickets/${ticketId}/${studentUser.id}/../1700000000-abcd12.pdf`,
      `tickets/${ticketId}/${studentUser.id}/1700000000-ghost12.pdf`,
    ]) {
      const res = await ADA().post(`/${ticketId}/attachments`, { file_name: "plan.pdf", file_size: 2048, file_type: "application/pdf", storage_path: p });
      expect(res.status, p).toBe(400);
      rejected.push(res.status);
    }
    expect((await ADA().post(`/${ticketId}/attachments/upload-url`, { file_name: "run.exe", file_size: 10, file_type: "application/x-msdownload" })).status).toBe(400);

    const su = await SAM().post(`/${ticketId}/attachments/upload-url`, { file_name: "advisor-notes.pdf", file_size: 1024, file_type: "application/pdf" });
    expect(su.status).toBe(200);
    expect(su.body.storagePath).toMatch(new RegExp(`^tickets/${ticketId}/${staff.id}/`));
    fake.addStorageObject(su.body.storagePath);
    const sreg = await SAM().post(`/${ticketId}/attachments`, { file_name: "advisor-notes.pdf", file_size: 1024, file_type: "application/pdf", storage_path: su.body.storagePath, comment_id: internalCommentId });
    expect(sreg.status).toBe(201);
    staffAttachmentId = sreg.body.attachment.id;

    const sd = await ADA().get(ticketId);
    expect(sd.body.ticket.ticket_attachments.map((a: any) => a.file_name)).toEqual(["plan.pdf"]);
    expect(JSON.stringify(sd.body)).not.toContain("advisor-notes");
    expect((await ADA().dl(ticketId, staffAttachmentId)).status).toBe(404);
    const dl = await ADA().dl(ticketId, ownAttachmentId);
    expect(dl.status).toBe(200);
    expect(dl.body.expiresInSeconds).toBe(300);
    expect((await BEN().dl(ticketId, ownAttachmentId)).status).toBe(404);
    expect((await SAM().dl(ticketId, staffAttachmentId)).status).toBe(200);
    save("S06-attachments.json", { step: "S6 attachment path + ownership", ownUploadPathShape: "tickets/<ticket>/<uploader>/<stamp>.pdf", ownRegister: 201, rejectedPaths: rejected, disallowedFileType: 400, studentSeesStaffAttachment: false, studentDownloadOfInternalAttachment: 404, studentDownloadOwn: 200, otherStudentDownload: 404, staffDownloadInternal: 200, signedUrlSeconds: 300 });
  });

  it("S7 another student cannot read, reply to, change or attach to the ticket (404); the list excludes it", async () => {
    const codes = {
      read: (await BEN().get(ticketId)).status,
      comment: (await BEN().post(`/${ticketId}/comments`, { content: "hello there" })).status,
      patch: (await BEN().patch(ticketId, { subject: "Changed subject here" })).status,
      uploadUrl: (await BEN().post(`/${ticketId}/attachments/upload-url`, { file_name: "a.pdf", file_size: 10, file_type: "application/pdf" })).status,
    };
    expect(Object.values(codes)).toEqual([404, 404, 404, 404]);
    expect(rowsOf((await BEN().list()).body).map((x) => x.id)).not.toContain(ticketId);
    const own = { status: (await ADA().patch(ticketId, { status: "closed" })).status, priority: (await ADA().patch(ticketId, { priority: "urgent" })).status };
    expect(own).toEqual({ status: 403, priority: 403 });
    save("S07-cross-student-isolation.json", { step: "S7 isolation", otherStudent: codes, otherStudentListContainsTicket: false, ownerChangeStatusOrPriority: own });
  });

  it("S8 staff resolves with a resolution note; the student sees the outcome", async () => {
    const noNote = await SAM().patch(ticketId, { status: "resolved" });
    expect(noNote.status).toBeGreaterThanOrEqual(400);
    const note = "Do the written assignment first; the quiz opens after it is graded.";
    expect((await SAM().patch(ticketId, { status: "resolved", resolutionNotes: note })).status).toBe(200);
    const d = await ADA().get(ticketId);
    expect(d.body.ticket.status).toBe("resolved");
    expect(d.body.ticket.resolution_notes).toBe(note);
    expect(JSON.stringify(d.body)).not.toContain("INTERNAL:");
    expect(JSON.stringify(d.body)).not.toContain("advisor-notes");
    save("S08-resolve-and-outcome.json", { step: "S8 staff resolves; student sees outcome", resolveWithoutNoteStatus: noNote.status, resolve: 200, studentSeesStatus: "resolved", studentSeesResolutionNote: true, internalLeaked: false });
  });

  it("S9 end state: canonical credits unchanged after the whole journey; support wrote only support tables", async () => {
    const after = await snapshotCanonical(pg);
    for (const tbl of CANONICAL_TABLES) expect(after[tbl], tbl).toEqual(canonicalBefore[tbl]);
    expect([...fake.writtenTables()].sort()).toEqual(["support_tickets", "ticket_attachments", "ticket_comments", "ticket_status_history"]);
    save("S09-final-state.json", {
      step: "S9 final",
      canonicalTablesIdentical: true,
      supportWritesTouchedOnly: [...fake.writtenTables()].sort(),
      academicBackend: "real disposable PostgreSQL 16 + repository migrations",
      supportBackend: "S08 in-memory Supabase fake behind the production /api/tickets router (support tables are not in the local migration chain)",
    });
  });
});
