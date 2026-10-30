/**
 * S27 — the BACHELOR'S demo persona (DEMO-S27-P9) provisioned by the SAME code the release runner uses
 * (scripts/s26/demo-cohort.ts provisionPersona -> scripts/s26/demo-bachelors.ts) against a REAL disposable
 * PostgreSQL 16, then read back through the real student HTTP routes the client calls
 * (GET /api/student/roadmap, /api/student/degree-progress, /api/student/programs, /api/student/journey) and the
 * client's own degree Roadmap model (credits by source, course buckets, warnings).
 *
 * Proves: idempotent (second run: every table identical), degree program + requirement groups + credit sources,
 * no billing rows, DEMO markers, and nothing belonging to a non-DEMO student (or any pre-existing row) changes.
 *
 * Supabase is replaced by a small double backed by the same local Postgres for users / profiles / students
 * (auth.admin.createUser writes the auth shim's auth.users); storage uploads and audit writes are no-ops.
 * Synthetic data only.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, seedAcademicRecord, type LocalPg } from "./helpers/s05-local-pg";
import { seedStaff, seedStudent, startHighSchoolPg } from "./helpers/s11-hs-stack";
import { makeLocalJWT } from "./helpers/s09-profile-stack";
import { isDemoPreferredName, isSyntheticAccount } from "../shared/synthetic-accounts";
import { buildCreditsBySource, buildWarnings, splitCourses } from "../client/src/components/degree-journey/model";
import type { StudentRoadmapView } from "../shared/student-roadmap-contract";
import type { StudentDegreeProgressView } from "../shared/student-degree-progress-view";

const shared = vi.hoisted(() => ({ pg: null as null | { client: any } }));

vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: async () => "active",
  isAccountActive: async () => true,
}));
vi.mock("../server/lib/audit", async (orig) => ({
  ...(await orig<object>()),
  auditAdmin: async () => undefined,
  createAuditLog: async () => undefined,
  auditAction: async () => undefined,
}));
vi.mock("../server/lib/supabase", async () => {
  const { fixtureProviderGetUser: getUser } = await import("./helpers/s09-profile-stack");
  const PG = new Set(["users", "profiles", "students"]);
  const IDENT = /^[a-z_][a-z0-9_]*$/;
  type R = { data: any; error: { message: string; code?: string } | null };
  class Q implements PromiseLike<R> {
    op: "select" | "insert" | "update" | "upsert" = "select";
    payload: Record<string, unknown> = {};
    filters: Array<[string, unknown]> = [];
    mode: "many" | "single" | "maybe" = "many";
    conflict: string | null = null;
    ignore = false;
    constructor(readonly table: string) {}
    select() { return this; }
    insert(row: Record<string, unknown>) { this.op = "insert"; this.payload = row; return this; }
    upsert(row: Record<string, unknown>, o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) { this.op = "upsert"; this.payload = row; this.conflict = o.onConflict ?? "id"; this.ignore = !!o.ignoreDuplicates; return this; }
    update(patch: Record<string, unknown>) { this.op = "update"; this.payload = patch; return this; }
    eq(c: string, v: unknown) { this.filters.push([c, v]); return this; }
    order() { return this; }
    limit() { return this; }
    contains() { return this; }
    single() { this.mode = "single"; return this; }
    maybeSingle() { this.mode = "maybe"; return this; }
    async run(): Promise<R> {
      if (!PG.has(this.table)) return { data: this.mode === "many" ? [] : null, error: null };
      const c = shared.pg!.client;
      const cols = Object.keys(this.payload);
      for (const k of [...cols, ...this.filters.map((f) => f[0]), this.conflict ?? "id"]) if (!IDENT.test(k)) throw new Error(`double: ${k}`);
      const params: unknown[] = [];
      const where = this.filters.length ? ` where ${this.filters.map(([k, v]) => { params.push(v); return `t."${k}" = $${params.length}`; }).join(" and ")}` : "";
      let sql: string;
      const list = cols.map((k) => `"${k}"`).join(", ");
      if (this.op === "insert" || this.op === "upsert") {
        params.unshift(c.json(this.payload));
        const onConflict = this.op === "upsert"
          ? this.ignore ? ` on conflict ("${this.conflict}") do nothing` : ` on conflict ("${this.conflict}") do update set ${cols.map((k) => `"${k}" = excluded."${k}"`).join(", ")}`
          : "";
        sql = `insert into ${this.table} as t (${list}) select ${list} from jsonb_populate_record(null::${this.table}, $1::jsonb)${onConflict} returning to_jsonb(t.*) as r`;
      } else if (this.op === "update") {
        params.unshift(c.json(this.payload));
        const w = where.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + 1}`);
        sql = `update ${this.table} as t set ${cols.map((k) => `"${k}" = (select r."${k}" from jsonb_populate_record(null::${this.table}, $1::jsonb) r)`).join(", ")}${w} returning to_jsonb(t.*) as r`;
      } else sql = `select to_jsonb(t.*) as r from ${this.table} as t${where}`;
      let rows: any[];
      try { rows = await c.unsafe(sql, params); } catch (e: any) { return { data: null, error: { message: String(e?.message ?? e), code: e?.code } }; }
      const data = rows.map((x) => x.r);
      if (this.mode === "single") return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: `${data.length} rows`, code: "PGRST116" } };
      if (this.mode === "maybe") return { data: data[0] ?? null, error: null };
      return { data, error: null };
    }
    then<A = R, B = never>(ok?: ((v: R) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) { return this.run().then(ok, bad); }
  }
  const supabaseAdmin = {
    auth: {
      getUser,
      admin: {
        createUser: async (o: { email: string; user_metadata?: unknown }) => {
          const id = (await import("node:crypto")).randomUUID();
          await shared.pg!.client`insert into auth.users (id, email, raw_app_meta_data) values (${id}, ${o.email}, ${JSON.stringify({ role: "student" })}::jsonb)`;
          return { data: { user: { id, email: o.email } }, error: null };
        },
        updateUserById: async () => ({ data: {}, error: null }),
      },
    },
    from: (table: string) => new Q(table),
    storage: { from: () => ({ upload: async () => ({ data: {}, error: null }), getPublicUrl: (p: string) => ({ data: { publicUrl: `https://storage.synthetic.example/${p}` } }) }) },
  };
  return { supabaseAdmin, createUserAuthClient: () => ({}), isSupabaseConfigured: false };
});

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

/** Every public table: row count + digest of all rows (full content). */
async function snapshotAll(pg: LocalPg): Promise<Record<string, { n: number; d: string }>> {
  const tables = await pg.sql(`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`);
  const out: Record<string, { n: number; d: string }> = {};
  for (const { table_name: t } of tables) {
    const [r] = await pg.sql(`select count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as d from public."${t}" x`);
    out[t] = { n: Number(r.n), d: String(r.d) };
  }
  return out;
}

/** Digest, per table with an id column, of the rows that existed in `before` (by id). */
async function digestRows(pg: LocalPg, ids: Record<string, string[]>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [t, list] of Object.entries(ids)) {
    if (!list.length) continue;
    const [r] = await pg.client.unsafe(`select coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as d from public."${t}" x where x.id::text = any($1)`, [list]);
    out[t] = String(r.d);
  }
  return out;
}

describe.skipIf(!PG_BINARIES_AVAILABLE)("S27 bachelor's demo persona on real Postgres", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let actorId: string;
  let realStudentId: string;
  let preIds: Record<string, string[]>;
  let preDigest: Record<string, string>;
  let afterFirst: Record<string, { n: number; d: string }>;
  let personaStudentId: string;
  let personaUserId: string;
  let personaEmail: string;
  const warnings: Record<string, string> = {};

  const provision = async () => {
    const { PERSONAS, provisionPersona } = await import("../scripts/s26/demo-cohort");
    const persona = PERSONAS.find((p) => p.key === "DEMO-S27-P9")!;
    return provisionPersona({ actorId, supabaseAdmin: (await import("../server/lib/supabase")).supabaseAdmin, warnings }, persona);
  };

  beforeAll(async () => {
    pg = await startHighSchoolPg();
    shared.pg = pg;
    process.env.DATABASE_URL = pg.url;
    process.env.EMAIL_ENABLED = "false";
    delete process.env.ALLOW_DEMO_MODE;
    actorId = (await seedStaff(pg, "admin")).userId;
    // A REAL-looking (non-DEMO) student with a university record of its own: must never change.
    const real = await seedStudent(pg, { name: "Jordan Realstudent" });
    realStudentId = real.studentId;
    await seedAcademicRecord(pg, realStudentId, { staffUserId: actorId });
    const tables = await pg.sql(`select table_name from information_schema.columns where table_schema='public' and column_name='id' order by 1`);
    preIds = {};
    for (const { table_name: t } of tables) preIds[t] = (await pg.sql(`select id::text as id from public."${t}"`)).map((r) => String(r.id));
    preDigest = await digestRows(pg, preIds);

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

  it("provisions the persona with no step failure", async () => {
    const out = await provision();
    expect(warnings).toEqual({});
    expect(out).not.toBeNull();
    personaStudentId = out!.studentId;
    const [s] = await pg.sql(`select s.*, u.email as u_email, u.name as u_name, u.role as u_role from students s join users u on u.id = s.user_id where s.id = '${personaStudentId}'`);
    personaUserId = String(s.user_id);
    personaEmail = String(s.u_email);
    afterFirst = await snapshotAll(pg);
  }, 300_000);

  it("is idempotent: a second run reports no failure and leaves every table identical", async () => {
    const out = await provision();
    expect(warnings).toEqual({});
    expect(out!.studentId).toBe(personaStudentId);
    expect(await snapshotAll(pg)).toEqual(afterFirst);
  }, 300_000);

  it("carries every DEMO marker and no money", async () => {
    const [s] = await pg.sql(`select s.preferred_name, s.first_name, s.last_name, s.email, s.status, u.email as u_email, u.name as u_name, u.role as u_role from students s join users u on u.id = s.user_id where s.id = '${personaStudentId}'`);
    expect(s.preferred_name).toBe("DEMO-S27-P9");
    expect(isDemoPreferredName(String(s.preferred_name))).toBe(true);
    expect(s.first_name).toBe("DEMO Avery");
    expect(s.last_name).toBe("Bachelor's plan (synthetic)");
    expect(String(s.u_email)).toMatch(/@lumiere-demo\.invalid$/);
    expect(s.u_role).toBe("student");
    expect(String(s.u_name)).toMatch(/^DEMO/);
    expect(s.status).toBe("active");
    expect(isSyntheticAccount({ email: String(s.email), preferred_name: String(s.preferred_name) })).toBe(true);
    // No billing / payment rows of any kind for this persona.
    const money = await pg.sql(`select table_name from information_schema.columns where table_schema='public' and column_name='student_id' and (table_name like 'billing%' or table_name like '%payment%' or table_name like '%invoice%' or table_name like '%receipt%' or table_name like '%installment%')`);
    for (const { table_name: t } of money) {
      const [r] = await pg.sql(`select count(*)::int as n from public."${t}" where student_id::text = '${personaStudentId}'`);
      expect({ t, n: Number(r.n) }).toEqual({ t, n: 0 });
    }
    // No high-school enrollment: this is the degree student.
    const [hs] = await pg.sql(`select count(*)::int as n from hs_enrollments where student_id = '${personaStudentId}'`).catch(() => [{ n: 0 }]);
    expect(Number(hs.n)).toBe(0);
    // The fictional catalog entry is marked and names no real school.
    const [inst] = await pg.sql(`select i.name, p.name as program, v.total_credits_required from knowledge_institutions i join knowledge_programs_v2 p on p.institution_id = i.id join knowledge_program_versions v on v.program_id = p.id where p.code = 'DEMO-BSBA'`);
    expect(inst).toMatchObject({ name: "DEMO University (fictional)", program: "Bachelor of Science in Business Administration", total_credits_required: 120 });
  });

  it("the student's degree view (GET /api/student/degree-progress) has the requirement groups and earned credit", async () => {
    const res = await request(base).get("/api/student/degree-progress").set({ Authorization: `Bearer ${makeLocalJWT(personaUserId, personaEmail)}` });
    expect(res.status).toBe(200);
    const view = res.body as StudentDegreeProgressView;
    expect(view.state).toBe("COMPOSED");
    if (view.state !== "COMPOSED") return;
    expect(Number(view.totals!.requiredCredits)).toBe(120);
    expect(Number(view.totals!.appliedCredits)).toBe(60);
    const req = Object.fromEntries(view.requirements.map((r) => [r.title, [r.status, Number(r.appliedAmount), Number(r.requiredAmount), Number(r.remainingAmount)]]));
    expect(req).toEqual({
      "General education": ["SATISFIED", 36, 36, 0],
      "Business major": [expect.any(String), 12, 36, 24],
      "Free electives": [expect.any(String), 12, 33, 21],
      "Residency: courses taken at the university itself": [expect.any(String), 0, 15, 15],
    });
    // 20 verified, accepted and placed credit records from two sources (prior college transcript, employer training).
    expect(view.credits).toHaveLength(20);
    expect(view.credits.every((c) => c.standing === "VERIFIED_APPLIED")).toBe(true);
    expect(view.sources.map((s) => [s.sourceType, s.status, s.creditRecordCount]).sort()).toEqual([["provider_record", "verified", 4], ["transcript", "verified", 16]]);
  });

  it("the Roadmap the client renders: credits by source, courses by status, warnings, target finish", async () => {
    const auth = { Authorization: `Bearer ${makeLocalJWT(personaUserId, personaEmail)}` };
    const roadmap = (await request(base).get("/api/student/roadmap").set(auth)).body as StudentRoadmapView;
    const progress = (await request(base).get("/api/student/degree-progress").set(auth)).body as StudentDegreeProgressView;
    expect(roadmap.state).toBe("PUBLISHED");
    const credits = buildCreditsBySource(roadmap, progress);
    expect(credits.state).toBe("ready");
    const seg = Object.fromEntries(credits.segments.map((s) => [s.id, s.cents / 100]));
    expect(seg).toEqual({ "earned-transfer": 48, "earned-workplace": 12, "planned-sophia": 39, "planned-study.com": 12, open: 9 });
    expect([credits.requiredCents, credits.earnedCents, credits.plannedCents, credits.openCents].map((c) => c! / 100)).toEqual([120, 60, 51, 9]);

    const items = Object.fromEntries(roadmap.phases.flatMap((p) => p.items).map((i) => [i.code, i]));
    expect(items.SCI110).toMatchObject({ provider: "Sophia", planStatus: "hold", reportBlockedReason: "on_hold" });
    expect(items.PSY101).toMatchObject({ credits: null, reportBlockedReason: "approval_pending", institution: "Prior community college (DEMO)" });
    expect(items.SOC101.stage).toBe("graded");
    expect(items.MAT120.stage).toBe("provider_complete");
    expect(items.ENG101.stage).toBe("in_progress");
    expect(items.FIN301).toMatchObject({ provider: "Study.com", stage: "submitted" });
    expect(items.LAW201).toMatchObject({ provider: "Study.com", stage: "in_progress" });
    expect(items.MGT330.stage).toBe("not_started");
    expect(items.ENG215.stage).toBe("not_started");

    const buckets = splitCourses(roadmap);
    expect(buckets.completed.map((i) => i.code)).toEqual(["MAT120"]);
    expect(buckets.now.map((i) => i.code)).toEqual(expect.arrayContaining(["SOC101", "FIN301", "ENG101", "LAW201"]));
    expect(buckets.upNext.map((i) => i.code)).toEqual(expect.arrayContaining(["PSY101", "SCI110", "MGT330", "ENG215"]));

    const warn = buildWarnings(roadmap, progress).map((w) => `${w.key}:${w.params.course ?? w.params.n ?? ""}`);
    expect(warn).toEqual(expect.arrayContaining(["dj.warn.approval:PSY101", "dj.warn.hold:SCI110", "dj.warn.gradePosted:SOC101", "dj.warn.finishedAtProvider:MAT120", "dj.warn.residency:15"]));
    expect(roadmap.milestones.find((m) => m.kind === "graduation")?.targetDate).toBe("2027-03-31");
    expect(roadmap.plan?.title).toMatch(/^DEMO/);
  });

  it("is a university-degree student with a master's-direction goal for Beyond the Bachelor's", async () => {
    const auth = { Authorization: `Bearer ${makeLocalJWT(personaUserId, personaEmail)}` };
    const programs = await request(base).get("/api/student/programs").set(auth);
    expect(programs.status).toBe(200);
    expect(JSON.stringify(programs.body)).toContain("university_degree");
    expect(programs.body.programs.some((p: { kind: string }) => p.kind === "high_school")).toBe(false);
    const journey = await request(base).get("/api/student/journey").set(auth);
    expect(journey.status).toBe(200);
    const goal = journey.body.agreement?.goal;
    expect(goal?.field).toMatch(/master/i);
    expect(goal?.targets.length).toBeGreaterThan(0);
    expect(goal.targets.every((t: { name: string }) => t.name.startsWith("DEMO"))).toBe(true);
  });

  it("touches nothing that existed before (incl. the non-DEMO student's record)", async () => {
    expect(await digestRows(pg, preIds)).toEqual(preDigest);
    const [n] = await pg.sql(`select count(*)::int as n from student_program_assignments where student_id = '${realStudentId}'`);
    expect(Number(n.n)).toBe(1);
    // Every student row added by provisioning is a DEMO student.
    const added = await pg.client.unsafe(`select preferred_name from students where not (id::text = any($1))`, [preIds.students ?? []]);
    expect(added.map((r) => String(r.preferred_name))).toEqual(["DEMO-S27-P9"]);
  });
});
