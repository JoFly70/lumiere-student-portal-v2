/**
 * S30 Phase B security fixes over the production registerRoutes app and a throwaway PostgreSQL:
 *  - rollbacks must go newest-first (an older import whose records were replaced cannot be rolled back first), so a
 *    later rollback can never resurrect withdrawn data;
 *  - academic_import_rows.raw keeps only the mapped columns after validation and is cleared on commit, rollback and
 *    discard; a column dropped by that pruning can only be mapped again from a new upload;
 *  - the rollback reason is in the audit metadata.
 * Synthetic data only.
 */
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";
import { applyS09Migration } from "./helpers/s09-apply-migration";
import { seedActor, seedHsStudent, type Actor, type HsStudent } from "./helpers/s11-hs-e2e-extra";
import { makeS13Supabase } from "./helpers/s13-supabase-shim";

const holder = vi.hoisted(() => ({ supabase: null as any, audits: [] as any[] }));
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
  return Object.fromEntries(Object.entries(actual).map(([k, v]) => [k, typeof v === "function" && k !== "getAuditFailureStats" ? vi.fn(async (e: unknown) => { holder.audits.push(e); }) : v]));
});

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

describe.skipIf(!PG_BINARIES_AVAILABLE)("S30 Phase B fixes (real Postgres, production routes)", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let admin: Actor;
  let ada: HsStudent;
  const api = () => request(base);
  const MAP = { student_code: "Student code", course: "Course", task: "Task", score_percent: "Score" };
  const csv = (score: number, extra = "") => [`Student code,Course,Task,Score,Notes`, `${ada.student.code},English 9,Unit 1 exam,${score},${extra}`].join("\n");
  const committed = async (score: number) => {
    const up = await api().post("/api/admin/imports").set(admin.auth).field("sourceKind", "provider_progress").attach("file", Buffer.from(csv(score, `n${score}`)), `s${score}.csv`);
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect((await api().post(`/api/admin/imports/${up.body.id}/map`).set(admin.auth).send({ columns: MAP })).status).toBe(200);
    expect((await api().post(`/api/admin/imports/${up.body.id}/approve`).set(admin.auth)).status).toBe(200);
    const c = await api().post(`/api/admin/imports/${up.body.id}/commit`).set(admin.auth);
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    return { id: up.body.id as string, result: c.body.result };
  };
  const activeScore = async () => (await pg.sql(`select score_percent::float as s from academic_reported_records where student_id = '${ada.student.id}' and status = 'active'`)).map((r: any) => r.s);

  beforeAll(async () => {
    pg = await startLocalPg();
    await applyS09Migration(pg);
    process.env.DATABASE_URL = pg.url;
    holder.supabase = makeS13Supabase(pg);
    admin = await seedActor(pg, "admin");
    ada = await seedHsStudent(pg, "Ada");
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

  it("rollbacks go newest-first: an older import whose records were replaced is refused, so nothing is resurrected", async () => {
    const a = await committed(80);
    const b = await committed(81);
    const c = await committed(82);
    expect([a.result.inserted, b.result.superseded, c.result.superseded]).toEqual([1, 1, 1]);
    expect(await activeScore()).toEqual([82]);
    const refused = await api().post(`/api/admin/imports/${b.id}/rollback`).set(admin.auth).send({ reason: "Out of order attempt" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain("roll back the newer import first");
    expect(refused.body.error.message).toContain(c.id);
    expect((await api().get(`/api/admin/imports/${b.id}`).set(admin.bearer)).body.status).toBe("committed");
    const rc = await api().post(`/api/admin/imports/${c.id}/rollback`).set(admin.auth).send({ reason: "Wrong file C" });
    expect(rc.body.result).toEqual({ withdrawn: 1, restored: 1 });
    expect(await activeScore()).toEqual([81]);
    const rb = await api().post(`/api/admin/imports/${b.id}/rollback`).set(admin.auth).send({ reason: "Wrong file B" });
    expect(rb.body.result).toEqual({ withdrawn: 1, restored: 1 });
    expect(await activeScore()).toEqual([80]);
    const audit = holder.audits.find((e) => e.eventType === "import.batch_rolled_back" && e.metadata?.batchId === b.id);
    expect(audit?.metadata).toMatchObject({ reason: "Wrong file B", withdrawn: 1, restored: 1 });
  });

  it("raw cells: only mapped columns after validation; a pruned column needs a new upload; cleared on commit and discard", async () => {
    const up = await api().post("/api/admin/imports").set(admin.auth).field("sourceKind", "provider_progress").attach("file", Buffer.from(csv(90, "private note")), "raw.csv");
    const before = await pg.sql(`select raw from academic_import_rows where batch_id = '${up.body.id}'`);
    expect(before[0]!.raw).toHaveProperty("Notes", "private note");
    await api().post(`/api/admin/imports/${up.body.id}/map`).set(admin.auth).send({ columns: MAP });
    const pruned = await pg.sql(`select raw from academic_import_rows where batch_id = '${up.body.id}'`);
    expect(Object.keys(pruned[0]!.raw).sort()).toEqual(["Course", "Score", "Student code", "Task"]);
    expect(JSON.stringify(pruned)).not.toContain("private note");
    const remap = await api().post(`/api/admin/imports/${up.body.id}/map`).set(admin.auth).send({ columns: { ...MAP, task: "Notes" } });
    expect(remap.status).toBe(409);
    // re-validating with the same columns still works (e.g. after a student code was fixed in the database)
    expect((await api().post(`/api/admin/imports/${up.body.id}/map`).set(admin.auth).send({ columns: MAP })).status).toBe(200);
    expect((await api().post(`/api/admin/imports/${up.body.id}/discard`).set(admin.auth)).status).toBe(200);
    expect((await pg.sql(`select count(*)::int as n from academic_import_rows where batch_id = '${up.body.id}' and raw <> '{}'::jsonb`))[0]!.n).toBe(0);
    // every committed or rolled-back batch from the first test has no raw cells left
    expect((await pg.sql(`select count(*)::int as n from academic_import_rows r join academic_import_batches b on b.id = r.batch_id where b.status in ('committed','rolled_back','discarded') and r.raw <> '{}'::jsonb`))[0]!.n).toBe(0);
  });
});
