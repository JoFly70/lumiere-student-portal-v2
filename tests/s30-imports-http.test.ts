/**
 * S30 Phase B — Academic Data Import Center over the production registerRoutes app and a throwaway PostgreSQL (the
 * full migration chain incl. 20261107110000_s30_academic_imports.sql).
 * Real: requireAuth/RBAC (local JWTs), CSRF, multer limits, every import SQL path. Doubled: Supabase client, audit
 * sink, and the S29 operational layer (a spy installed as the imports port). Synthetic data only.
 */
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import ExcelJS from "exceljs";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";
import { applyS09Migration } from "./helpers/s09-apply-migration";
import { seedActor, seedHsStudent, type Actor, type HsStudent } from "./helpers/s11-hs-e2e-extra";
import { makeS13Supabase } from "./helpers/s13-supabase-shim";
import { setImportOperationsPort, type ImportNotification, type ImportOpsEvent } from "../server/services/s30/imports-port";

const holder = vi.hoisted(() => ({ supabase: null as any }));
vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: {
    auth: { getUser: async (t: string) => (await import("./helpers/s09-profile-stack")).fixtureProviderGetUser(t), admin: { createUser: vi.fn(), deleteUser: vi.fn() } },
    from: (t: string) => holder.supabase.client.from(t),
    get storage() { return holder.supabase.client.storage; },
  },
  createUserAuthClient: () => ({ auth: {} }),
  isSupabaseConfigured: true,
}));
vi.mock("../server/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(actual).map(([k, v]) => [k, typeof v === "function" && k !== "getAuditFailureStats" ? vi.fn().mockResolvedValue(undefined) : v]));
});

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

describe.skipIf(!PG_BINARIES_AVAILABLE)("S30 Phase B: Academic Data Import Center (real Postgres, production routes)", () => {
  const port = { events: [] as ImportOpsEvent[], notes: [] as ImportNotification[] };
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let admin: Actor, staff: Actor, coach: Actor;
  let ada: HsStudent, ben: HsStudent;
  const api = () => request(base);
  let csv1 = "";
  const MAP = { student_code: "Student code", course: "Course", task: "Task", progress_status: "Status", score_percent: "Score", credits_reported: "Credits", reported_on: "Date" };

  const upload = (who: Actor, body: Buffer | string, name = "progress.csv", sourceKind = "provider_progress", extra: Record<string, string> = {}) => {
    let r = api().post("/api/admin/imports").set(who.auth).field("sourceKind", sourceKind).field("providerLabel", "Synthetic Provider");
    for (const [k, v] of Object.entries(extra)) r = r.field(k, v);
    return r.attach("file", Buffer.isBuffer(body) ? body : Buffer.from(body), name);
  };
  const flow = async (who: Actor, body: string | Buffer, name?: string) => {
    const up = await upload(who, body, name);
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const mapped = await api().post(`/api/admin/imports/${up.body.id}/map`).set(who.auth).send({ columns: MAP });
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(200);
    return mapped.body;
  };

  beforeAll(async () => {
    pg = await startLocalPg();
    await applyS09Migration(pg);
    process.env.DATABASE_URL = pg.url;
    holder.supabase = makeS13Supabase(pg);
    setImportOperationsPort({
      recordEvent: async (e) => { port.events.push(e); return "accepted"; },
      enqueueNotification: async (n) => { port.notes.push(n); return "accepted"; },
    });
    admin = await seedActor(pg, "admin");
    staff = await seedActor(pg, "staff");
    coach = await seedActor(pg, "coach");
    ada = await seedHsStudent(pg, "Ada");
    ben = await seedHsStudent(pg, "Ben");
    csv1 = [
      "Student code,Course,Task,Status,Score,Credits,Date",
      `${ada.student.code},English 9,Unit 1 exam,completed,88,0.5,2026-10-01`,
      `${ada.student.code},English 9,Unit 2 exam,in progress,,,2026-10-02`,
      `${ben.student.code},Algebra I,,completed,91,1,2026-10-03`,
      `UNKNOWN-CODE,Algebra I,,completed,91,,2026-10-03`,
      `${ben.student.code},=HYPERLINK("http://evil.example"),,completed,50,,2026-10-03`,
      `${ada.student.code},English 9,Unit 1 exam,completed,88,0.5,2026-10-01`,
    ].join("\n");
    const { registerRoutes } = await import("../server/routes");
    const app = express();
    app.use(express.json());
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 300_000);

  afterAll(async () => {
    setImportOperationsPort(null);
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pg?.stop();
  }, 60_000);

  it("the imports migration created 4 tables with RLS on and no client privileges, 9 audit event types, and is idempotent", async () => {
    const r = await pg.sql(`select c.relname, c.relrowsecurity, has_table_privilege('authenticated', c.oid, 'SELECT') as s
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('academic_import_mappings','academic_import_batches','academic_import_rows','academic_reported_records')`);
    expect(r).toHaveLength(4);
    expect(r.every((x: any) => x.relrowsecurity && !x.s)).toBe(true);
    const fs = await import("node:fs");
    await pg.sql(fs.readFileSync("supabase/migrations/20261107110000_s30_academic_imports.sql", "utf8"));
    const n = await pg.sql(`select count(*)::int as n from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'audit_event_type' and e.enumlabel like 'import.%'`);
    expect(n[0]!.n).toBe(9);
    // 'verified' can never be stored as a tier
    await expect(pg.sql(`insert into academic_reported_records (student_id, batch_id, tier, course_label, identity_key, fingerprint) values ('${ada.student.id}', gen_random_uuid(), 'verified', 'x', 'k', '${"0".repeat(64)}')`)).rejects.toThrow();
  });

  it("roles and CSRF: coach and student refused; staff can upload and validate but not approve, commit or roll back", async () => {
    expect((await api().get("/api/admin/imports").set(coach.bearer)).status).toBe(403);
    expect((await api().get("/api/admin/imports").set(ada.user.bearer)).status).toBe(403);
    expect((await upload(ada.user, csv1)).status).toBe(403);
    expect((await api().post("/api/admin/imports").set(staff.bearer).field("sourceKind", "provider_progress").attach("file", Buffer.from(csv1), "p.csv")).status).toBe(403);
    const body = await flow(staff, csv1);
    expect((await api().post(`/api/admin/imports/${body.id}/approve`).set(staff.auth)).status).toBe(403);
    expect((await api().post(`/api/admin/imports/${body.id}/commit`).set(staff.auth)).status).toBe(403);
    expect((await api().post(`/api/admin/imports/${body.id}/discard`).set(staff.auth)).status).toBe(200);
    expect((await api().get(`/api/admin/students/${ada.student.id}/reported-records`).set(coach.bearer)).status).toBe(403);
  });

  it("rejects unsafe or invalid files with a clear reason", async () => {
    const pdf = await upload(admin, Buffer.from("%PDF-1.7\nfake"), "results.pdf");
    expect(pdf.status).toBe(400);
    expect(pdf.body.error).toMatchObject({ code: "S30_FILE_REJECTED", reason: "unsupported_format" });
    expect((await upload(admin, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), "old.xls")).body.error.reason).toBe("unsupported_format");
    expect((await upload(admin, Buffer.alloc(5 * 1024 * 1024 + 10, 0x61), "big.csv")).body.error.reason).toBe("too_large");
    expect((await upload(admin, "just one column\nx\n")).body.error.reason).toBe("no_header");
    expect((await upload(admin, csv1, "p.csv", "made_up_kind")).status).toBe(400);
    const badMap = await upload(admin, csv1);
    expect((await api().post(`/api/admin/imports/${badMap.body.id}/map`).set(admin.auth).send({ columns: { student_code: "Student code" } })).status).toBe(400);
  });

  let batchId = "";
  it("validates: student matched by code only, unknown code and formula text invalid, in-file duplicate flagged, nothing written yet", async () => {
    const b = await flow(admin, csv1);
    batchId = b.id;
    expect(b.status).toBe("validated");
    expect(b.tier).toBe("provider_reported");
    expect(b.counts).toMatchObject({ total: 6, invalid: 2, new: 3, duplicateInFile: 1, students: 2, needsReview: 2 });
    const byRow = new Map(b.rows.map((r: any) => [r.rowNumber, r]));
    expect(byRow.get(5)).toMatchObject({ outcome: "invalid", studentId: null });
    expect(byRow.get(6).issues.map((i: any) => i.code)).toContain("formula_text");
    expect(byRow.get(7)).toMatchObject({ diff: "duplicate_in_file", outcome: "warning" });
    expect(byRow.get(2)).toMatchObject({ studentId: ada.student.id, diff: "new" });
    expect((await pg.sql(`select count(*)::int as n from academic_reported_records`))[0]!.n).toBe(0);
    expect((await api().post(`/api/admin/imports/${batchId}/commit`).set(admin.auth)).status).toBe(409); // not approved yet
  });

  it("commits approved rows as REPORTED records only: no official result, credit award or verified document is created", async () => {
    const before = await pg.sql(`select (select count(*) from hs_official_results)::int as r, (select count(*) from hs_credit_awards)::int as a, (select count(*) from student_documents where status = 'verified')::int as d`);
    expect((await api().post(`/api/admin/imports/${batchId}/approve`).set(admin.auth)).status).toBe(200);
    port.events.length = 0; port.notes.length = 0;
    const c = await api().post(`/api/admin/imports/${batchId}/commit`).set(admin.auth);
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.result).toMatchObject({ inserted: 3, superseded: 0, needsReview: 2, students: 2 });
    const after = await pg.sql(`select (select count(*) from hs_official_results)::int as r, (select count(*) from hs_credit_awards)::int as a, (select count(*) from student_documents where status = 'verified')::int as d`);
    expect(after[0]).toEqual(before[0]);
    const recs = await api().get(`/api/admin/students/${ada.student.id}/reported-records`).set(staff.bearer);
    expect(recs.body.records).toHaveLength(2);
    expect(recs.body.records.every((r: any) => r.tier === "provider_reported" && r.providerLabel === "Synthetic Provider")).toBe(true);
    expect(recs.body.records.find((r: any) => r.taskLabel === "Unit 1 exam")).toMatchObject({ progressStatus: "completed", reviewState: "needs_review", creditsReported: 0.5 });
    // Ben's records never appear under Ada and vice versa
    const benRecs = await api().get(`/api/admin/students/${ben.student.id}/reported-records`).set(admin.bearer);
    expect(benRecs.body.records.map((r: any) => r.studentId)).toEqual([ben.student.id]);
    // S29 layer received events and owner notifications through the port
    expect(port.events.map((e) => e.kind).sort()).toEqual(["academic.import_committed", "academic.progress_reported", "academic.progress_reported", "academic.review_required", "academic.review_required"]);
    expect(port.notes.map((n) => n.kind).sort()).toEqual(["import.committed", "import.review_required"]);
    expect(port.notes.every((n) => n.recipientUserId === admin.id && n.href === `/admin/imports?batch=${batchId}`)).toBe(true);
    const { importReviewSummary } = await import("../server/services/s30/imports/service");
    expect(await importReviewSummary((await import("../server/lib/db")).db as any)).toEqual(expect.arrayContaining([{ studentId: ada.student.id, tier: "provider_reported", count: 1 }, { studentId: ben.student.id, tier: "provider_reported", count: 1 }]));
  });

  it("re-importing the same file is idempotent: everything unchanged, flagged as a duplicate file, nothing to approve", async () => {
    const again = await flow(admin, csv1);
    expect(again.counts).toMatchObject({ new: 0, changed: 0, unchanged: 3 });
    expect(again.duplicateOfBatchId).toBe(batchId);
    const ap = await api().post(`/api/admin/imports/${again.id}/approve`).set(admin.auth);
    expect(ap.status).toBe(409);
    expect((await pg.sql(`select count(*)::int as n from academic_reported_records where status = 'active'`))[0]!.n).toBe(3);
  });

  let correctionId = "";
  it("a corrected value supersedes the active record (shows previous -> new); rollback restores the previous record", async () => {
    const xlsx = new ExcelJS.Workbook();
    const ws = xlsx.addWorksheet("Export");
    ws.addRow(["Student code", "Course", "Task", "Status", "Score", "Credits", "Date"]);
    ws.addRow([ada.student.code, "English 9", "Unit 1 exam", "completed", { formula: "45*2", result: 90 }, 0.5, new Date(Date.UTC(2026, 9, 1))]);
    const b = await flow(admin, Buffer.from(await xlsx.xlsx.writeBuffer()), "export.xlsx");
    correctionId = b.id;
    expect(b.fileFormat).toBe("xlsx");
    expect(b.counts).toMatchObject({ changed: 1, new: 0 });
    expect(b.rows[0]).toMatchObject({ diff: "changed", previous: { scorePercent: 88 }, normalized: { scorePercent: 90 } });
    await api().post(`/api/admin/imports/${correctionId}/approve`).set(admin.auth);
    const c = await api().post(`/api/admin/imports/${correctionId}/commit`).set(admin.auth);
    expect(c.body.result).toMatchObject({ inserted: 1, superseded: 1 });
    const active = await pg.sql(`select score_percent::float as s from academic_reported_records where student_id = '${ada.student.id}' and task_label = 'Unit 1 exam' and status = 'active'`);
    expect(active.map((r: any) => r.s)).toEqual([90]);
    expect((await api().post(`/api/admin/imports/${correctionId}/rollback`).set(admin.auth).send({ reason: "x" })).status).toBe(400);
    const rb = await api().post(`/api/admin/imports/${correctionId}/rollback`).set(admin.auth).send({ reason: "Wrong export file" });
    expect(rb.status).toBe(200);
    expect(rb.body.result).toEqual({ withdrawn: 1, restored: 1 });
    expect(rb.body.batch).toMatchObject({ status: "rolled_back", rollbackReason: "Wrong export file" });
    const restored = await pg.sql(`select score_percent::float as s from academic_reported_records where student_id = '${ada.student.id}' and task_label = 'Unit 1 exam' and status = 'active'`);
    expect(restored.map((r: any) => r.s)).toEqual([88]);
    expect((await api().post(`/api/admin/imports/${correctionId}/rollback`).set(admin.auth).send({ reason: "again" })).status).toBe(409);
    expect(port.events.some((e) => e.kind === "academic.import_rolled_back" && e.batchId === correctionId)).toBe(true);
  });

  it("review state is admin-only and never creates credit; mappings are reusable; history and template are available", async () => {
    const recs = (await api().get(`/api/admin/students/${ada.student.id}/reported-records`).set(admin.bearer)).body.records;
    const target = recs.find((r: any) => r.reviewState === "needs_review");
    const path = `/api/admin/students/${ada.student.id}/reported-records/${target.id}`;
    expect((await api().patch(path).set(staff.auth).send({ reviewState: "reviewed" })).status).toBe(403);
    expect((await api().patch(`/api/admin/students/${ben.student.id}/reported-records/${target.id}`).set(admin.auth).send({ reviewState: "reviewed" })).status).toBe(404);
    expect((await api().patch(path).set(admin.auth).send({ reviewState: "reviewed" })).body.reviewState).toBe("reviewed");
    expect((await pg.sql(`select count(*)::int as n from hs_credit_awards`))[0]!.n).toBe(0);
    const up = await upload(admin, csv1);
    await api().post(`/api/admin/imports/${up.body.id}/map`).set(admin.auth).send({ columns: MAP, saveAs: "Synthetic provider export" });
    const maps = (await api().get("/api/admin/imports/mappings").set(staff.bearer)).body.mappings;
    expect(maps.map((m: any) => m.name)).toContain("Synthetic provider export");
    // The upload limit (10 per minute per user) has been used up by this suite; it is per user, so a second admin can upload.
    expect((await upload(admin, csv1)).body.error?.code).toBe("THROTTLED");
    const admin2 = await seedActor(pg, "admin");
    const reused = await upload(admin2, csv1, "again.csv", "provider_progress", { mappingId: maps[0].id });
    expect(reused.body).toMatchObject({ status: "validated", mappingId: maps[0].id });
    const hist = (await api().get("/api/admin/imports").set(staff.bearer)).body.batches;
    expect(hist.length).toBeGreaterThanOrEqual(5);
    expect(hist.every((h: any) => /^[0-9a-f]{64}$/.test(h.fileSha256))).toBe(true);
    const tpl = await api().get("/api/admin/imports/template.csv").set(staff.bearer);
    expect(tpl.headers["content-type"]).toContain("text/csv");
    expect(tpl.text.split("\r\n")[0]).toBe("student_code,course,task,status,percent_complete,score,credits,date");
  });
});
