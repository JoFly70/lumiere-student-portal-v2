import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PG_BINARIES_AVAILABLE,
  S05_PG_SKIP_MESSAGE,
  s05MigrationExists,
  seedAcademicRecord,
  seedStudent,
  seedUser,
  startLocalPg,
  type LocalPg,
} from "./helpers/s05-local-pg";

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

describe.skipIf(!PG_BINARIES_AVAILABLE)("S05 local Postgres harness", () => {
  let pg: LocalPg;
  beforeAll(async () => {
    pg = await startLocalPg();
  }, 240_000);
  afterAll(async () => {
    await pg?.stop();
  }, 60_000);

  it("starts a cluster", async () => {
    const rows = await pg.sql("select 1 as one, current_database() as db");
    expect(rows[0].one).toBe(1);
    expect(String(rows[0].db)).toMatch(/^s05_/);
  });

  it("applies the real repository migrations in order", () => {
    const files = pg.appliedFiles.filter((f) => f.startsWith("supabase/migrations/"));
    expect(files.length).toBeGreaterThanOrEqual(17);
    expect(files[0]).toContain("20251217230356_011_degree_programs_courses.sql");
    expect(files).toContain("supabase/migrations/20260915160000_phase2a_student_academic_record.sql");
    expect(files).toContain("supabase/migrations/20260916010000_phase4b_student_credit_placement.sql");
  });

  it("has the canonical tables and the Supabase shim", async () => {
    const rows = await pg.sql(`
      select table_name from information_schema.tables where table_schema = 'public'
        and table_name in ('users','students','student_program_assignments','student_academic_sources',
                           'student_credit_records','student_credit_decisions','student_credit_verification_events')`);
    expect(rows.length).toBe(7);
    const [uid] = await pg.sql("select auth.uid() as uid");
    expect(uid.uid).toBeNull();
  });

  it("seeds a user, a student and a verified canonical credit", async () => {
    const staff = await seedUser(pg, "staff");
    const user = await seedUser(pg, "student");
    const student = await seedStudent(pg, { userId: user.id });
    const academic = await seedAcademicRecord(pg, student.id, { staffUserId: staff.id, awardedCredits: "4.00" });
    const [row] = await pg.sql(`
      select s.user_id, d.credits_awarded, a.status as assignment_status
        from students s
        join student_credit_decisions d on d.credit_record_id = '${academic.creditRecordId}'
        join student_program_assignments a on a.id = d.program_assignment_id
       where s.id = '${student.id}'`);
    expect(row.user_id).toBe(user.id);
    expect(row.credits_awarded).toBe("4.00");
    expect(row.assignment_status).toBe("active");
  });

  it("auth.uid() reads the request.jwt.claim.sub GUC", async () => {
    const user = await seedUser(pg, "student");
    const rows = await pg.client.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub', ${user.id}, true)`;
      return tx`select auth.uid()::text as uid`;
    });
    expect(rows[0].uid).toBe(user.id);
  });

  it.skipIf(!s05MigrationExists())("applied the S05 roadmap migration: 5 tables with unique indexes", async () => {
    expect(pg.appliedFiles).toContain("supabase/migrations/20261026100000_s05_student_roadmap.sql");
    const tables = await pg.sql(`
      select table_name from information_schema.tables
       where table_schema = 'public' and table_name like 'student\\_roadmap\\_%' order by 1`);
    expect(tables.map((r) => r.table_name)).toEqual([
      "student_roadmap_imports",
      "student_roadmap_plans",
      "student_roadmap_progress",
      "student_roadmap_progress_events",
      "student_roadmap_versions",
    ]);
    const uniques = await pg.sql(`
      select tablename, indexname from pg_indexes
       where schemaname = 'public' and tablename like 'student\\_roadmap\\_%' and indexdef like 'CREATE UNIQUE INDEX%'`);
    const byTable = new Map<string, number>();
    for (const u of uniques) byTable.set(String(u.tablename), (byTable.get(String(u.tablename)) ?? 0) + 1);
    for (const t of ["student_roadmap_plans", "student_roadmap_versions", "student_roadmap_imports", "student_roadmap_progress"]) {
      expect(byTable.get(t) ?? 0, `unique index on ${t}`).toBeGreaterThanOrEqual(1);
    }
    const names = uniques.map((u) => u.indexname);
    expect(names).toContain("student_roadmap_versions_one_draft_idx");
    expect(names).toContain("student_roadmap_versions_one_published_idx");
    expect(names).toContain("student_roadmap_imports_idempotency_idx");
  });
});
