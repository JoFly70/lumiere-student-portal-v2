/**
 * S07 — two-workbook import over real HTTP + real Postgres (same harness as
 * tests/s05-roadmap-http-e2e.test.ts): master + companion execution workbook
 * -> ONE draft -> review exceptions -> preview -> publish; then the v2 pair
 * re-imported, preserving progress on unchanged/rescheduled items and not
 * transferring it to a replacement.
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
import { buildEphExecution, buildEphMaster } from "./fixtures/s07/builders";

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

type Ex = { key: string; code: string; severity: string };

describe.skipIf(!ready)("S07 two-workbook import — real HTTP end to end", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let staff: SeededUser;
  let admin: SeededUser;
  let studentUser: SeededUser;
  let student: SeededStudent;

  const tok = (u: SeededUser) => ({ Authorization: `Bearer ${makeLocalJWT(u.id, u.email)}` });
  const api = () => request(base);
  const adminPath = (rest = "") => `/api/admin/students/${student.id}/roadmap${rest}`;
  const pair = (m: { buffer: Buffer; fileName: string }, c: { buffer: Buffer; fileName: string } | null, qs = "") => {
    let r = api().post(adminPath(`/imports${qs}`)).set(tok(staff)).attach("workbook", m.buffer, { filename: m.fileName, contentType: XLSX });
    if (c) r = r.attach("companion", c.buffer, { filename: c.fileName, contentType: XLSX });
    return r;
  };
  const warnings = (draft: { exceptions: Ex[] }) => draft.exceptions.filter((e) => e.severity === "warning").map((e) => e.key);
  const studentItem = (view: { phases: { items: { key: string }[] }[] }, key: string) =>
    view.phases.flatMap((p) => p.items).find((i) => i.key === key) as Record<string, unknown> | undefined;

  beforeAll(async () => {
    pg = await startLocalPg();
    process.env.DATABASE_URL = pg.url;
    delete process.env.ALLOW_DEMO_MODE;
    staff = await seedUser(pg, "staff");
    admin = await seedUser(pg, "admin");
    studentUser = await seedUser(pg, "student");
    student = await seedStudent(pg, { userId: studentUser.id });
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
  let before: Awaited<ReturnType<typeof snapshotCanonical>>;
  let draftRevision = 0;
  let firstVersionNumber = 0;
  let publishedId: string | null = null;

  beforeAll(async () => {
    m1 = await buildEphMaster(1);
    e1 = await buildEphExecution(1);
    m2 = await buildEphMaster(2);
    e2 = await buildEphExecution(2);
  });

  it("rejects a companion without a master and a non-.xlsx companion", async () => {
    const onlyCompanion = await api().post(adminPath("/imports")).set(tok(staff)).attach("companion", e1.buffer, { filename: e1.fileName, contentType: XLSX });
    expect(onlyCompanion.status).toBe(400);
    const bad = await api().post(adminPath("/imports")).set(tok(staff)).attach("workbook", m1.buffer, { filename: m1.fileName }).attach("companion", Buffer.from("PK\u0003\u0004"), { filename: "x.csv" });
    expect(bad.status).toBe(400);
    const unknownField = await api().post(adminPath("/imports")).set(tok(staff)).attach("workbook", m1.buffer, { filename: m1.fileName }).attach("third", e1.buffer, { filename: "t.xlsx" });
    expect(unknownField.status).toBe(400);
  });

  it("master-only upload keeps working (existing behaviour)", async () => {
    before = await snapshotCanonical(pg);
    const res = await pair(m1, null);
    expect(res.status).toBe(201);
    expect(res.body.draft.import.templateId).toBe("lumiere-degree-master-v1");
    expect(res.body.draft.content.items).toHaveLength(24);
    const discard = await api().post(adminPath("/draft/discard")).set(tok(staff)).send({ expectedDraftRevision: res.body.draft.draftRevision });
    expect(discard.status).toBe(200);
  });

  it("master + companion -> ONE draft with merged items, exceptions, history and milestones", async () => {
    const res = await pair(m1, e1);
    expect(res.status).toBe(201);
    const d = res.body.draft;
    draftRevision = d.draftRevision;
    firstVersionNumber = d.versionNumber;
    expect(d.import.fileName).toBe("eph-master-v1.xlsx + eph-execution-v1.xlsx");
    expect(d.import.templateId).toBe("lumiere-degree-master-v1+lumiere-execution-v1");
    expect(d.content.items).toHaveLength(24); // no duplicated courses, the unmatched execution row is not a course
    const codes = new Set((d.exceptions as Ex[]).map((e) => e.code));
    for (const c of ["COMPANION_ITEM_MERGED", "COMPANION_ROW_UNMATCHED", "DEADLINE_CONFLICT", "REPORTED_HISTORY_NOT_CREDIT", "CONDITIONAL_ALLOCATION", "SHEET_NOT_RECOGNISED"]) {
      expect(codes.has(c), c).toBe(true);
    }
    expect((d.exceptions as Ex[]).filter((e) => e.severity === "blocking")).toEqual([]);
    // conversion exceptions survive validation re-derivation (CONVERSION_CODES)
    const state = await api().get(adminPath()).set(tok(staff));
    expect((state.body.draft.exceptions as Ex[]).some((e) => e.code === "COMPANION_ROW_UNMATCHED")).toBe(true);
    expect(state.body.draft.content.reportedHistory.some((h: { kind: string }) => h.kind === "credit_baseline")).toBe(true);
    expect(state.body.draft.content.schedule.weeks).toBe(42);
    const cis = state.body.draft.content.items.find((i: { key: string }) => i.key === "cis-1070");
    expect(cis.provenance.map((p: { role: string }) => p.role)).toEqual(expect.arrayContaining(["master", "execution"]));
  });

  it("the identical pair again is an idempotent replay of the same draft", async () => {
    const same = await pair(m1, e1);
    expect(same.status).toBe(200);
    expect(same.body.draft.versionNumber).toBe(firstVersionNumber);
  });

  it("reported history is staff-only: preview and the student never see it, credit is untouched", async () => {
    const state = await api().get(adminPath()).set(tok(staff));
    draftRevision = state.body.draft.draftRevision;
    const preview = await api().get(adminPath("/draft/preview")).set(tok(staff));
    expect(preview.status).toBe(200);
    const text = JSON.stringify(preview.body);
    expect(text).not.toContain("reportedHistory");
    expect(text).not.toContain("Credits reported as already earned");
    expect(text).not.toContain("provenance");
    const snap = await snapshotCanonical(pg);
    for (const t of CANONICAL_TABLES) expect(snap[t], t).toEqual(before[t]);
  });

  it("staff acknowledges the warnings, admin publishes; the student sees the plan without staff-only data", async () => {
    const state = await api().get(adminPath()).set(tok(staff));
    const draft = state.body.draft;
    const ack = await api().post(adminPath("/draft/acknowledge")).set(tok(staff)).send({ expectedDraftRevision: draft.draftRevision, exceptionKeys: warnings(draft), note: "reviewed" });
    expect(ack.status).toBe(200);
    expect(ack.body.draft.publishable).toBe(true);
    const pub = await api().post(adminPath("/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: ack.body.draft.draftRevision, expectedPublishedVersionId: null });
    expect(pub.status).toBe(200);
    publishedId = pub.body.published.versionId;
    const view = await api().get("/api/student/roadmap").set(tok(studentUser));
    expect(view.body.state).toBe("PUBLISHED");
    const text = JSON.stringify(view.body);
    expect(text).not.toContain("reportedHistory");
    expect(text).not.toContain("credit_baseline");
    expect(text).not.toContain("COMPANION_");
    expect(studentItem(view.body, "business-103")).toBeDefined();
  });

  it("student reports progress on a rescheduled, a replaced and a removed course", async () => {
    for (const key of ["business-103", "business-308", "opm-3010"]) {
      const r = await api().post("/api/student/roadmap/progress").set(tok(studentUser)).send({ itemKey: key, taskKey: null, status: "in_progress", expectedRevision: 0 });
      expect(r.status, key).toBe(200);
    }
    const t = await api().post("/api/student/roadmap/progress").set(tok(studentUser)).send({ itemKey: "business-103", taskKey: "assignment-1", status: "graded", expectedRevision: 0 });
    expect(t.status).toBe(200);
  });

  it("v2 pair re-import: diff shows added/removed/rescheduled; progress kept on unchanged items, never moved to a replacement", async () => {
    const up = await pair(m2, e2);
    expect(up.status).toBe(201);
    const d = up.body.draft;
    expect(d.diff.added.map((a: { itemKey: string }) => a.itemKey).sort()).toEqual(["business-324", "introduction-to-chemistry"]);
    expect(d.diff.removed.map((r: { itemKey: string; hasProgress: boolean }) => `${r.itemKey}:${r.hasProgress}`).sort()).toEqual(["business-308:true", "opm-3010:true"]);
    expect(d.diff.changed.map((c: { itemKey: string }) => c.itemKey)).toContain("business-103");
    expect(d.exceptions.some((e: Ex) => e.code === "PROGRESS_ON_REMOVED_ITEM")).toBe(true);
    const ack = await api().post(adminPath("/draft/acknowledge")).set(tok(staff)).send({ expectedDraftRevision: d.draftRevision, exceptionKeys: warnings(d), note: "v2 reviewed" });
    expect(ack.status).toBe(200);
    const pub = await api().post(adminPath("/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: ack.body.draft.draftRevision, expectedPublishedVersionId: publishedId });
    expect(pub.status).toBe(200);

    const view = await api().get("/api/student/roadmap").set(tok(studentUser));
    expect(studentItem(view.body, "business-103")?.itemStatus).toBe("in_progress");
    expect(studentItem(view.body, "business-324")?.itemStatus).toBe("not_started");
    expect(studentItem(view.body, "introduction-to-chemistry")?.itemStatus).toBe("not_started");
    const rows = await pg.sql(`select item_key, task_key, status from student_roadmap_progress where student_id = '${student.id}' order by item_key, task_key`);
    expect(rows.find((r: { item_key: string }) => r.item_key === "business-324")).toBeUndefined();
    expect(rows.some((r: { item_key: string; task_key: string; status: string }) => r.item_key === "business-103" && r.task_key === "assignment-1" && r.status === "graded")).toBe(true);
  });
});
