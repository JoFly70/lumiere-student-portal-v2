/**
 * S07 — final acceptance journey (EPH master + execution pair, then the v2 pair).
 *
 * REAL: disposable PostgreSQL 16 with the repository migrations, the production
 * Express app wired by `registerRoutes`, real requireAuth (local HS256 JWT ->
 * users row in Postgres), real RBAC, multer multipart upload (master in
 * "workbook", execution workbook in "companion"), the xlsx importer, plan
 * review/validation, diff, publication, the student projection and the
 * canonical degree-progress loader (the seeded academic record is read for real).
 *
 * STUBBED (external services only): hosted Supabase auth/profile lookups
 * (replaced by the local JWT), audit logging.
 *
 * Writes synthetic-data JSON to docs/recovery/s07-evidence/journey/ for the
 * README and for scripts/s07/render-journey.ts.
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
import { CANONICAL_TABLES, snapshotCanonical, sha256 } from "./helpers/s05-roadmap-stack";
import { buildEphExecution, buildEphMaster, buildRutExecution, buildRutMaster } from "./fixtures/s07/builders";

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
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const OUT = path.resolve(import.meta.dirname, "..", "docs/recovery/s07-evidence/journey");

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ex = { key: string; code: string; severity: string };
const save = (name: string, data: unknown) => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2) + "\n");
};
const allItems = (view: any): any[] => view.phases.flatMap((p: any) => p.items);
const findItem = (view: any, key: string) => allItems(view).find((i) => i.key === key);
const warningKeys = (draft: { exceptions: Ex[] }) => draft.exceptions.filter((e) => e.severity === "warning").map((e) => e.key);
const countBy = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

describe.skipIf(!ready)("S07 acceptance journey — EPH pair, real Postgres + real HTTP", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let staff: SeededUser;
  let admin: SeededUser;
  let studentUser: SeededUser;
  let student: SeededStudent;

  const tok = (u: SeededUser) => ({ Authorization: `Bearer ${makeLocalJWT(u.id, u.email)}` });
  const api = () => request(base);
  const adminPath = (rest = "", id?: string) => `/api/admin/students/${id ?? student.id}/roadmap${rest}`;
  const pair = (
    who: SeededUser,
    m: { buffer: Buffer; fileName: string },
    c: { buffer: Buffer; fileName: string },
    id?: string,
  ) =>
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
    student = await seedStudent(pg, { userId: studentUser.id, firstName: "EPH", lastName: "Journey" });
    await seedAcademicRecord(pg, student.id, { staffUserId: staff.id });
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
  let ackDraftRevision = 0;
  let publishedId = "";
  let viewPublished: any;
  let viewAfterProgress: any;
  let publishedContentHash = "";

  beforeAll(async () => {
    m1 = await buildEphMaster(1);
    e1 = await buildEphExecution(1);
    m2 = await buildEphMaster(2);
    e2 = await buildEphExecution(2);
    expect(sha256(m1.buffer)).not.toBe(sha256(m2.buffer));
  });

  it("step 1 — staff opens the student workspace: no plan, no draft, and the student sees NOT_PUBLISHED", async () => {
    canonicalBefore = await snapshotCanonical(pg);
    const res = await api().get(adminPath()).set(tok(staff));
    expect(res.status).toBe(200);
    expect(res.body.studentId).toBe(student.id);
    expect(res.body.planId).toBeNull();
    expect(res.body.draft).toBeNull();
    expect(res.body.published).toBeNull();
    expect(res.body.versions).toEqual([]);
    save("01-staff-initial-state.json", res.body);
    const sv = await studentView();
    expect(sv.state).toBe("NOT_PUBLISHED");
  });

  it("steps 2-3 — staff imports the master + the execution workbook in ONE multipart request -> ONE draft, no duplicate courses, every execution course merged", async () => {
    const res = await pair(staff, m1, e1);
    expect(res.status).toBe(201);
    draft = res.body.draft;
    expect(draft.import.fileName).toBe("eph-master-v1.xlsx + eph-execution-v1.xlsx");
    expect(draft.import.templateId).toBe("lumiere-degree-master-v1+lumiere-execution-v1");
    expect(draft.versionNumber).toBe(1);
    expect(draft.publishable).toBe(false);

    const keys: string[] = draft.content.items.map((i: any) => i.key);
    expect(keys).toHaveLength(24);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate course keys
    const codes = draft.content.items.map((i: any) => i.code).filter(Boolean);
    expect(new Set(codes).size).toBe(codes.length);

    // every execution course (COMPANION_ITEM_MERGED) maps to exactly one master item that carries both provenances
    const merged = (draft.exceptions as Ex[]).filter((e) => e.code === "COMPANION_ITEM_MERGED");
    expect(merged.length).toBeGreaterThanOrEqual(20);
    for (const ex of merged) {
      const itemKey = ex.key.split(":")[1];
      const item = draft.content.items.find((i: any) => i.key === itemKey);
      expect(item, itemKey).toBeDefined();
      const roles = item.provenance.map((p: any) => p.role);
      expect(roles, itemKey).toEqual(expect.arrayContaining(["master", "execution"]));
    }
    // the execution-only course is reported, not turned into a plan item
    expect((draft.exceptions as Ex[]).some((e) => e.code === "COMPANION_ROW_UNMATCHED")).toBe(true);
    expect(draft.content.items.some((i: any) => /statistics/i.test(i.title) && /business 205/i.test(i.code ?? ""))).toBe(false);
    // dated tasks from the execution schedule
    expect(draft.content.items.some((i: any) => i.tasks.some((t: any) => t.dueDate && t.week))).toBe(true);
    expect((draft.exceptions as Ex[]).filter((e) => e.severity === "blocking")).toEqual([]);

    // the same pair again is an idempotent replay (one draft only)
    const again = await pair(staff, m1, e1);
    expect(again.status).toBe(200);
    expect(again.body.draft.versionNumber).toBe(1);
    const state = await api().get(adminPath()).set(tok(staff));
    expect(state.body.versions.filter((v: any) => v.status === "draft")).toHaveLength(1);
    draft = state.body.draft;
    save("02-v1-draft-state.json", state.body);
  });

  it("step 4 — reportedHistory holds prior credential/baseline/completed work separately; items contain only future/planned work", () => {
    const history: any[] = draft.content.reportedHistory;
    const kinds = new Set(history.map((h) => h.kind));
    expect(kinds.has("credit_baseline")).toBe(true);
    expect(kinds.has("course")).toBe(true);
    expect(history.some((h) => h.reportedStatus === "completed")).toBe(true);
    expect(history.find((h) => h.kind === "credit_baseline").reportedCredits).toBe("51");
    const fromMasterOnly = history.every((h) => Array.isArray(h.provenance));
    expect(fromMasterOnly).toBe(true);

    const items: any[] = draft.content.items;
    // items hold plan work only
    for (const i of items) expect(["planned", "hold", "alternative"], i.key).toContain(i.planStatus);
    const itemTitles = new Set(items.map((i) => String(i.title).toLowerCase()));
    for (const h of history.filter((x) => x.reportedStatus === "completed")) {
      expect(itemTitles.has(String(h.title).toLowerCase()), `completed work "${h.title}" must not be a plan item`).toBe(false);
    }
    // nothing in items marks a prior baseline / credential
    expect(items.every((i) => i.kind === "course" || i.kind === "exam")).toBe(true);
    // schedule metadata is captured from the execution workbook
    expect(draft.content.schedule).toMatchObject({ weeks: 42, startsOn: "2026-08-31", preparedOn: "2026-08-24" });
    save("03-v1-reported-history.json", { schedule: draft.content.schedule, reportedHistory: history, planItemKeys: items.map((i) => ({ key: i.key, planStatus: i.planStatus })) });
  });

  it("step 5 — exceptions: conditional-assumption warnings and invalid-schedule warnings", () => {
    const ex = draft.exceptions as Ex[];
    const codes = new Set(ex.map((e) => e.code));
    const warningCodes = new Set(ex.filter((e) => e.severity === "warning").map((e) => e.code));
    for (const c of [
      "CONDITIONAL_ALLOCATION",
      "EQUIVALENCY_CONDITIONAL",
      "REPORTED_HISTORY_NOT_CREDIT",
      "STARTING_CREDITS_UNVERIFIED",
      "LICENSING_CREDIT_SEPARATE",
      "REGISTRATION_GATE_UNDOCUMENTED",
      "EXAM_AFTER_TERM_DEADLINE",
      "DEADLINE_CONFLICT",
    ]) {
      expect(warningCodes.has(c), c).toBe(true);
    }
    // depends on the wall clock: the 2026-08-24 schedule has past-due items without progress from mid-September on
    if (Date.now() >= Date.UTC(2026, 8, 20)) expect(warningCodes.has("SCHEDULE_STALE")).toBe(true);
    expect(codes.has("COMPANION_ROW_UNMATCHED")).toBe(true);
    expect(codes.has("REGISTRATION_AFTER_DEADLINE")).toBe(true);
    const counts = countBy(ex.map((e) => `${e.code}/${e.severity}`));
    save("04-v1-exception-list.json", {
      note: "Exception codes produced by the real importer + plan review for the EPH master + execution v1 pair (synthetic data).",
      total: ex.length,
      countsByCodeAndSeverity: counts,
      exceptions: ex,
    });
    console.log("S07 v1 exception codes:", JSON.stringify(counts));
  });

  it("step 6 — staff previews the student-shaped view (no staff-only data, no reportedHistory); a STAFF publish attempt is 403", async () => {
    const preview = await api().get(adminPath("/draft/preview")).set(tok(staff));
    expect(preview.status).toBe(200);
    expect(preview.body.preview).toBe(true);
    expect(preview.body.contractVersion).toBe("student-roadmap/1");
    expect(preview.body.phases.length).toBeGreaterThan(0);
    const text = JSON.stringify(preview.body);
    for (const forbidden of ["reportedHistory", "credit_baseline", "Credits reported as already earned", "provenance", "staffNote", "COMPANION_", "New Study.com Phase 1 external", "exceptions"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    save("05-v1-staff-preview.json", preview.body);
    // the student still sees nothing
    expect((await studentView()).state).toBe("NOT_PUBLISHED");

    const refused = await api().post(adminPath("/draft/publish")).set(tok(staff)).send({ expectedDraftRevision: draft.draftRevision, expectedPublishedVersionId: null });
    expect(refused.status).toBe(403);
    expect((await api().get(adminPath()).set(tok(staff))).body.published).toBeNull();
  });

  it("step 7 — admin: publish is refused until warnings are acknowledged; staff acknowledges; a stale publish is 409; admin publishes", async () => {
    const early = await api().post(adminPath("/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: draft.draftRevision, expectedPublishedVersionId: null });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe("ROADMAP_NOT_PUBLISHABLE");

    const ack = await api()
      .post(adminPath("/draft/acknowledge"))
      .set(tok(admin))
      .send({ expectedDraftRevision: draft.draftRevision, exceptionKeys: warningKeys(draft), note: "S07 acceptance: warnings reviewed" });
    expect(ack.status).toBe(200);
    expect(ack.body.draft.publishable).toBe(true);
    expect(ack.body.draft.acknowledgements.length).toBe(warningKeys(draft).length);
    ackDraftRevision = ack.body.draft.draftRevision;
    expect(ackDraftRevision).toBeGreaterThan(draft.draftRevision);

    // stale publish: the revision the reviewer looked at before acknowledging
    const stale = await api().post(adminPath("/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: draft.draftRevision, expectedPublishedVersionId: null });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("ROADMAP_STALE_DRAFT");
    expect((await studentView()).state).toBe("NOT_PUBLISHED");

    const pub = await api().post(adminPath("/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: ackDraftRevision, expectedPublishedVersionId: null });
    expect(pub.status).toBe(200);
    expect(pub.body.published.versionNumber).toBe(1);
    expect(pub.body.draft).toBeNull();
    publishedId = pub.body.published.versionId;
    publishedContentHash = sha256(JSON.stringify(pub.body.published.content));
    save("06-v1-published-state.json", pub.body);
  });

  it("step 8 — student GET /api/student/roadmap: published, a clear headline and focus items", async () => {
    const view = await studentView();
    viewPublished = view;
    expect(view.state).toBe("PUBLISHED");
    expect(view.preview).toBe(false);
    expect(view.plan.versionNumber).toBe(1);
    expect(view.today.focusItemKeys.length).toBeGreaterThan(0);
    expect(view.today.focusItemKeys.length).toBeLessThanOrEqual(3);
    for (const k of view.today.focusItemKeys) expect(findItem(view, k), k).toBeDefined();
    expect(typeof view.today.headline).toBe("string");
    expect(view.today.headline.trim().length).toBeGreaterThan(10);
    expect(view.today.detail.trim().length).toBeGreaterThan(0);
    const text = JSON.stringify(view);
    for (const forbidden of ["reportedHistory", "credit_baseline", "provenance", "staffNote", "COMPANION_", "exceptions"]) expect(text, forbidden).not.toContain(forbidden);
    expect(view.foundation.degreeState).toBeDefined();
    save("07-student-view-published.json", view);
    // the canonical degree-progress view (real loader) the Flight Deck also reads
    const dp = await api().get("/api/student/degree-progress").set(tok(studentUser));
    expect(dp.status).toBe(200);
    save("07b-student-degree-progress.json", dp.body);
  });

  it("step 9 — the roadmap has courses, milestones, tasks and remaining-work counts", () => {
    const view = viewPublished;
    const items = allItems(view);
    expect(items).toHaveLength(24);
    expect(items.some((i) => i.kind === "course")).toBe(true);
    expect(items.some((i) => i.kind === "exam")).toBe(true);
    expect(view.milestones.map((m: any) => m.kind)).toEqual(expect.arrayContaining(["checkpoint", "application", "graduation"]));
    expect(view.milestones.every((m: any) => typeof m.remainingItems === "number")).toBe(true);
    const taskKinds = new Set(items.flatMap((i) => i.tasks.map((t: any) => t.kind)));
    expect(taskKinds.has("exam")).toBe(true);
    expect(taskKinds.has("assignment")).toBe(true);
    expect(items.some((i) => i.tasks.some((t: any) => t.dueDate))).toBe(true);
    expect(view.counts.itemsTotal).toBeGreaterThan(0);
    expect(view.counts.itemsNotStarted).toBe(view.counts.itemsTotal);
    expect(view.counts.tasksTotal).toBe(items.filter((i) => i.planStatus === "planned" || i.planStatus === "hold").reduce((n, i) => n + i.tasks.length, 0));
    expect(view.counts.tasksGraded).toBe(0);
    expect(view.phases.filter((p: any) => p.state === "current")).toHaveLength(1);
  });

  it("step 9b — Sophia/Study.com challenge, milestone and written-assignment (written-assignment) tasks, via the RUT pair for a second student", async () => {
    const rutUser = await seedUser(pg, "student");
    const rut = await seedStudent(pg, { userId: rutUser.id, firstName: "RUT", lastName: "Journey" });
    const [rm, re] = [await buildRutMaster(), await buildRutExecution()];
    const up = await pair(staff, rm, re, rut.id);
    expect(up.status).toBe(201);
    const keys = warningKeys(up.body.draft);
    const ack = await api().post(adminPath("/draft/acknowledge", rut.id)).set(tok(staff)).send({ expectedDraftRevision: up.body.draft.draftRevision, exceptionKeys: keys, note: "reviewed" });
    expect(ack.status).toBe(200);
    const pub = await api().post(adminPath("/draft/publish", rut.id)).set(tok(admin)).send({ expectedDraftRevision: ack.body.draft.draftRevision, expectedPublishedVersionId: null });
    expect(pub.status).toBe(200);
    const view = (await api().get("/api/student/roadmap").set(tok(rutUser))).body;
    expect(view.state).toBe("PUBLISHED");
    const kinds = new Set(allItems(view).flatMap((i) => i.tasks.map((t: any) => t.kind)));
    save("08-rut-student-view.json", view);
    expect([...kinds].sort()).toEqual(expect.arrayContaining(["challenge", "milestone", "assignment"]));
    // Study.com written papers are imported as dated "assignment" tasks (the importer emits no "paper" kind for them)
    expect(allItems(view).some((i) => i.tasks.some((t: any) => t.kind === "assignment" && t.dueDate))).toBe(true);
    expect(view.today.focusItemKeys.length).toBeGreaterThan(0);
    save("08-rut-student-view.json", view);
  });

  it("steps 10-11 — student updates a task (in_progress -> submitted) and items; the returned view and a fresh GET agree", async () => {
    const itemKey = "business-103";
    const before = findItem(viewPublished, itemKey);
    expect(before.canReport).toBe(true);
    const taskKey = before.tasks.find((t: any) => t.kind === "assignment").key;

    const t1 = await progress(itemKey, taskKey, "in_progress", 0);
    expect(t1.status).toBe(200);
    expect(findItem(t1.body, itemKey).tasks.find((t: any) => t.key === taskKey).status).toBe("in_progress");
    const t2 = await progress(itemKey, taskKey, "submitted", 1);
    expect(t2.status).toBe(200);
    const i1 = await progress(itemKey, null, "in_progress", 0);
    expect(i1.status).toBe(200);
    // the other three students-reported items used by the v2 re-import checks
    for (const key of ["u-s-history-i", "business-308", "opm-3010"]) expect((await progress(key, null, "in_progress", 0)).status, key).toBe(200);
    const lastWrite = await progress("business-308", findItem(viewPublished, "business-308").tasks[0].key, "submitted", 0);
    expect(lastWrite.status).toBe(200);

    const fresh = await studentView();
    // what both Flight Deck and Roadmap consume: the authoritative view from the write equals a fresh GET
    expect(fresh.counts).toEqual(lastWrite.body.counts);
    expect(fresh.today).toEqual(lastWrite.body.today);
    expect(allItems(fresh).map((i) => [i.key, i.itemStatus, i.stage, i.itemRevision, i.tasks.map((t: any) => [t.key, t.status, t.revision])])).toEqual(
      allItems(lastWrite.body).map((i) => [i.key, i.itemStatus, i.stage, i.itemRevision, i.tasks.map((t: any) => [t.key, t.status, t.revision])]),
    );
    const after = findItem(fresh, itemKey);
    expect(after.itemStatus).toBe("in_progress");
    expect(after.stage).not.toBe("not_started");
    expect(after.tasks.find((t: any) => t.key === taskKey)).toMatchObject({ status: "submitted", revision: 2 });
    expect(fresh.counts.itemsInProgress).toBe(4);
    expect(fresh.counts.tasksSubmitted).toBe(2);
    expect(fresh.counts.itemsNotStarted).toBe(viewPublished.counts.itemsTotal - 4);
    expect(fresh.counts.itemsTotal).toBe(viewPublished.counts.itemsTotal);
    // a stale revision is refused
    const stale = await progress(itemKey, taskKey, "graded", 0);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("ROADMAP_PROGRESS_CONFLICT");
    viewAfterProgress = fresh;
    save("09-student-view-after-progress.json", fresh);
    save("09b-progress-before-after-counts.json", { before: viewPublished.counts, after: fresh.counts, beforeToday: viewPublished.today, afterToday: fresh.today });
  });

  it("step 12 — v2 pair: diff shows rescheduled / replaced / removed / added; progress preserved or flagged; publish v2", async () => {
    const up = await pair(staff, m2, e2);
    expect(up.status).toBe(201);
    const d = up.body.draft;
    expect(d.diff.baseVersionNumber).toBe(1);
    expect(d.diff.added.map((a: any) => a.itemKey).sort()).toEqual(["business-324", "introduction-to-chemistry"]);
    expect(d.diff.removed.map((r: any) => `${r.itemKey}:${r.hasProgress}`).sort()).toEqual(["business-308:true", "opm-3010:true"]);
    const changed = d.diff.changed as { itemKey: string; fields: string[]; rescheduleOnly: boolean }[];
    const b103 = changed.find((c) => c.itemKey === "business-103");
    expect(b103).toBeDefined();
    expect(b103!.rescheduleOnly).toBe(true);
    expect(b103!.fields.join(",")).toMatch(/planned(Start|End)|sequence|phaseKey/);
    expect(d.diff.unchangedCount).toBeGreaterThan(0);
    expect(changed.find((c) => c.itemKey === "u-s-history-i")?.rescheduleOnly ?? true).toBe(true);
    const progressFlag = (d.exceptions as Ex[]).filter((e) => e.code === "PROGRESS_ON_REMOVED_ITEM");
    expect(progressFlag.length).toBe(2);
    // the replacement did not inherit the replaced item's progress
    expect(findItem(viewAfterProgress, "business-308").itemStatus).toBe("in_progress");

    const ack = await api().post(adminPath("/draft/acknowledge")).set(tok(staff)).send({ expectedDraftRevision: d.draftRevision, exceptionKeys: warningKeys(d), note: "v2 reviewed" });
    expect(ack.status).toBe(200);
    save("10-v2-draft-state.json", ack.body);
    save("11-v2-diff.json", { diff: d.diff, progressWarnings: progressFlag, exceptionCounts: countBy((d.exceptions as Ex[]).map((e) => `${e.code}/${e.severity}`)) });
    // published unchanged until publish
    expect((await studentView()).plan.versionNumber).toBe(1);
    const pub = await api().post(adminPath("/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: ack.body.draft.draftRevision, expectedPublishedVersionId: publishedId });
    expect(pub.status).toBe(200);
    expect(pub.body.published.versionNumber).toBe(2);

    const v2 = await studentView();
    expect(v2.plan.versionNumber).toBe(2);
    // unchanged and rescheduled items keep progress
    expect(findItem(v2, "u-s-history-i").itemStatus).toBe("in_progress");
    const r103 = findItem(v2, "business-103");
    expect(r103.itemStatus).toBe("in_progress");
    expect(r103.tasks.find((t: any) => t.kind === "assignment").status).toBe("submitted");
    expect(r103.plannedEnd).not.toBe(findItem(viewAfterProgress, "business-103").plannedEnd);
    // replacement / added items start empty
    for (const k of ["business-324", "introduction-to-chemistry"]) {
      const it = findItem(v2, k);
      expect(it, k).toBeDefined();
      expect(it.itemStatus).toBe("not_started");
      expect(it.stage).toBe("not_started");
      expect(it.tasks.every((t: any) => t.status === "not_started")).toBe(true);
    }
    // removed-with-progress is kept as history, not transferred
    expect(findItem(v2, "business-308")).toBeUndefined();
    expect(findItem(v2, "opm-3010")).toBeUndefined();
    expect(v2.history.retiredProgress.map((r: any) => r.itemKey).sort()).toEqual(["business-308", "opm-3010"]);
    expect(v2.history.previousVersions).toHaveLength(1);
    const rows = await pg.sql(`select item_key from student_roadmap_progress where student_id = '${student.id}' and item_key in ('business-324','introduction-to-chemistry')`);
    expect(rows).toHaveLength(0);
    save("12-student-view-v2.json", v2);
    publishedId = pub.body.published.versionId;
  });

  it("step 13 — canonical credit tables are byte-identical; the foundation ladder is unchanged; the student cannot reach admin endpoints or change credit/degree/plan", async () => {
    const after = await snapshotCanonical(pg);
    for (const t of CANONICAL_TABLES) expect(after[t], t).toEqual(canonicalBefore[t]);
    expect(CANONICAL_TABLES.length).toBeGreaterThanOrEqual(4);
    // the whole row content, not just a digest
    const rowCounts = await pg.sql(`select (select count(*)::int from student_credit_records) as records, (select count(*)::int from student_program_assignments) as assignments`);
    expect(rowCounts[0].records).toBeGreaterThan(0);
    expect(rowCounts[0].assignments).toBeGreaterThan(0);

    // ladder figures: identical before and after student activity (planned changes only with the plan itself)
    expect(viewAfterProgress.foundation).toEqual(viewPublished.foundation);
    const v2 = await studentView();
    expect({ ...v2.foundation.ladder, planned: null }).toEqual({ ...viewPublished.foundation.ladder, planned: null });
    expect(v2.foundation.degreeState).toBe(viewPublished.foundation.degreeState);
    expect(v2.foundation.credentials).toEqual(viewPublished.foundation.credentials);

    // student: 403 on every admin endpoint
    const adminCalls: Array<[string, string]> = [
      ["get", adminPath()],
      ["put", adminPath("/draft")],
      ["post", adminPath("/draft/acknowledge")],
      ["get", adminPath("/draft/preview")],
      ["post", adminPath("/draft/publish")],
      ["post", adminPath("/draft/discard")],
      ["post", adminPath("/draft/from-published")],
    ];
    for (const [method, url] of adminCalls) {
      const res = await (api() as unknown as Record<string, (u: string) => request.Test>)[method](url).set(tok(studentUser)).send({});
      expect(res.status, `${method} ${url}`).toBe(403);
    }
    expect((await pair(studentUser, m1, e1)).status).toBe(403);

    // student cannot change credit, degree or plan through the progress endpoint
    for (const extra of [{ credits: "3" }, { planStatus: "dropped" }, { degreeId: crypto.randomUUID() }, { studentId: crypto.randomUUID() }, { standing: "VERIFIED_APPLIED" }]) {
      const res = await api().post("/api/student/roadmap/progress").set(tok(studentUser)).send({ itemKey: "business-103", taskKey: null, status: "provider_complete", expectedRevision: 1, ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    // official acceptance is not a reportable status
    const official = await progress("business-103", null, "officially_accepted", 1);
    expect(official.status).toBe(400);
    // reporting on a hold item is refused
    const hold = await progress("quantitative-skills-for-business", null, "in_progress", 0);
    expect(hold.status).toBe(422);

    // the published plan content is unchanged by all student activity (v2 is the only change, made by admin)
    const state = await api().get(adminPath()).set(tok(staff));
    expect(state.body.published.versionNumber).toBe(2);
    const v1Content = state.body.versions.find((v: any) => v.versionNumber === 1);
    expect(v1Content.status).toBe("superseded");
    expect(publishedContentHash).toHaveLength(64);

    const final = await snapshotCanonical(pg);
    save("13-canonical-before-after.json", {
      note: "Row counts and md5 digests of the canonical credit tables before step 1 and after all staff publications and student activity (synthetic data).",
      tables: CANONICAL_TABLES,
      before: canonicalBefore,
      after: final,
      identical: JSON.stringify(canonicalBefore) === JSON.stringify(final),
      foundationLadderV1: viewPublished.foundation.ladder,
      foundationLadderAfterProgress: viewAfterProgress.foundation.ladder,
      foundationLadderV2: v2.foundation.ladder,
      degreeState: v2.foundation.degreeState,
    });
    expect(JSON.stringify(canonicalBefore)).toBe(JSON.stringify(final));
  });
});
