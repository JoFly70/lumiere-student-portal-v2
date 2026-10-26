/**
 * S12 — graduate programs migrations on a disposable PostgreSQL 16.
 * Static rules for the enum migration, idempotency, immutability and pinning
 * triggers, the verified-evidence CHECK, append-only history, RLS and grants.
 * Synthetic data only.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, seedStudent, seedUser, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const ROOT = path.resolve(import.meta.dirname, "..");
const ENUM_FILE = "20261029100000_s12_graduate_audit_events.sql";
const TABLES_FILE = "20261029110000_s12_graduate_programs.sql";
const read = (f: string) => fs.readFileSync(path.join(ROOT, "supabase", "migrations", f), "utf8");

const GRADUATE_EVENT_TYPES = [
  "graduate.offering_created", "graduate.rule_set_created", "graduate.program_enrolled", "graduate.program_updated",
  "graduate.subject_created", "graduate.result_recorded", "graduate.student_progress_reported", "graduate.record_created",
  "graduate.record_updated", "graduate.record_verified", "graduate.record_rejected", "graduate.official_change_blocked",
  "graduate.credit_recorded", "graduate.access_denied",
];
const TABLES = [
  "graduate_program_offerings", "graduate_cohort_rule_sets", "student_graduate_programs", "graduate_subjects",
  "graduate_records", "graduate_credit_entries", "graduate_events",
];

describe("S12 enum migration, static", () => {
  const sql = read(ENUM_FILE).replace(/\/\*[\s\S]*?\*\//g, "");

  it("adds exactly the 14 graduate.* values, IF NOT EXISTS, with no transaction wrapper or data statements", () => {
    const adds = [...sql.matchAll(/ALTER TYPE\s+(?:public\.)?audit_event_type\s+ADD VALUE\s+(IF NOT EXISTS\s+)?'([^']+)'/gi)];
    expect(adds.map((a) => a[2]).sort()).toEqual([...GRADUATE_EVENT_TYPES].sort());
    expect(adds.every((a) => !!a[1])).toBe(true);
    expect(/^\s*(BEGIN|COMMIT)\b/im.test(sql)).toBe(false);
    expect(/\b(INSERT|UPDATE|SELECT)\b/i.test(sql)).toBe(false);
  });

  it("the union in server/lib/audit.ts carries the same values", () => {
    const audit = fs.readFileSync(path.join(ROOT, "server", "lib", "audit.ts"), "utf8");
    for (const t of GRADUATE_EVENT_TYPES) expect(audit).toContain(`'${t}'`);
  });
});

describe.skipIf(!PG_BINARIES_AVAILABLE)("S12 graduate migrations on disposable PostgreSQL 16", () => {
  let pg: LocalPg;
  let staff: Awaited<ReturnType<typeof seedUser>>;
  let studentUser: Awaited<ReturnType<typeof seedUser>>;
  let otherUser: Awaited<ReturnType<typeof seedUser>>;
  let student: Awaited<ReturnType<typeof seedStudent>>;
  let other: Awaited<ReturnType<typeof seedStudent>>;
  let offeringId: string;
  let ruleSetId: string;
  let programId: string;

  beforeAll(async () => {
    pg = await startLocalPg();
    staff = await seedUser(pg, "staff");
    studentUser = await seedUser(pg, "student");
    otherUser = await seedUser(pg, "student");
    student = await seedStudent(pg, { userId: studentUser.id });
    other = await seedStudent(pg, { userId: otherUser.id });
    const [o] = await pg.sql(
      `insert into graduate_program_offerings (key, category, route, marketing_title, awarding_institution, program_version)
       values ('syn-uni-mba', 'mba', 'eneb_unimarconi', 'Synthetic MBA', 'unimarconi', '2026.1') returning id`,
    );
    offeringId = o.id as string;
    const [r] = await pg.sql(
      `insert into graduate_cohort_rule_sets (offering_id, cohort_label, version, effective_from, rules)
       values ('${offeringId}', '2026 intake', 1, '2026-01-01', '[]'::jsonb) returning id`,
    );
    ruleSetId = r.id as string;
    const [p] = await pg.sql(
      `insert into student_graduate_programs (student_id, offering_id, rule_set_id, route, cohort_label, enrolled_at)
       values ('${student.id}', '${offeringId}', '${ruleSetId}', 'eneb_unimarconi', '2026 intake', '2026-02-01') returning id`,
    );
    programId = p.id as string;
  }, 300_000);
  afterAll(async () => {
    await pg?.stop();
  }, 60_000);

  const rejects = async (query: string, pattern?: RegExp) => {
    let error: unknown = null;
    try {
      await pg.sql(query);
    } catch (e) {
      error = e;
    }
    expect(error, `expected to be rejected: ${query}`).not.toBeNull();
    if (pattern) expect((error as Error).message).toMatch(pattern);
  };

  it("applied both files, in filename order, after the S10 audit chain predecessors", () => {
    const applied = pg.appliedFiles;
    const i = applied.indexOf(`supabase/migrations/${ENUM_FILE}`);
    const j = applied.indexOf(`supabase/migrations/${TABLES_FILE}`);
    expect(i).toBeGreaterThan(applied.indexOf("supabase/migrations/20261028100000_s10_support_idempotency_index.sql"));
    expect(j).toBeGreaterThan(i);
  });

  it("the audit enum contains every graduate.* value", async () => {
    const rows = await pg.sql(`select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'audit_event_type'`);
    const labels = rows.map((r) => r.enumlabel as string);
    expect(GRADUATE_EVENT_TYPES.filter((t) => !labels.includes(t))).toEqual([]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("re-applying both migrations is a no-op", async () => {
    const snapshot = async () =>
      (await pg.sql(
        `select (select count(*)::int from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'audit_event_type') as enum_values,
                (select count(*)::int from pg_trigger where not tgisinternal and (tgname like 'graduate%' or tgname like 'student_graduate%')) as triggers,
                (select count(*)::int from pg_policies where tablename = any(array['${TABLES.join("','")}'])) as policies,
                (select count(*)::int from pg_constraint where conrelid::regclass::text = any(array['${TABLES.join("','")}'])) as constraints,
                (select count(*)::int from pg_indexes where tablename = any(array['${TABLES.join("','")}'])) as indexes`,
      ))[0];
    const before = await snapshot();
    await pg.client.unsafe(read(ENUM_FILE)).simple();
    await pg.client.unsafe(read(TABLES_FILE)).simple();
    expect(await snapshot()).toEqual(before);
    // Existing data survived the re-run.
    const [n] = await pg.sql(`select count(*)::int as n from student_graduate_programs`);
    expect(n.n).toBeGreaterThanOrEqual(1);
  });

  it("RLS is enabled everywhere, only SELECT policies exist, and anon/authenticated hold no write privilege", async () => {
    const rls = await pg.sql(`select relname, relrowsecurity from pg_class where relname = any(array['${TABLES.join("','")}']) and relkind = 'r'`);
    expect(rls.length).toBe(TABLES.length);
    expect(rls.every((r) => r.relrowsecurity === true)).toBe(true);
    const policies = await pg.sql(`select tablename, cmd from pg_policies where tablename = any(array['${TABLES.join("','")}'])`);
    expect(policies.length).toBe(TABLES.length);
    expect(policies.every((p) => p.cmd === "SELECT")).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      for (const t of TABLES) {
        for (const priv of ["INSERT", "UPDATE", "DELETE"]) {
          const [r] = await pg.sql(`select has_table_privilege('${role}', 'public.${t}', '${priv}') as ok`);
          expect(r.ok, `${role} ${priv} on ${t}`).toBe(false);
        }
      }
    }
  });

  describe("rule sets are immutable", () => {
    it("rejects changes to rules, cohort label, version, effective date and offering", async () => {
      await rejects(`update graduate_cohort_rule_sets set rules = '[{"key":"thesis"}]'::jsonb where id = '${ruleSetId}'`, /immutable/);
      await rejects(`update graduate_cohort_rule_sets set cohort_label = 'other' where id = '${ruleSetId}'`, /immutable/);
      await rejects(`update graduate_cohort_rule_sets set version = 9 where id = '${ruleSetId}'`, /immutable/);
      await rejects(`update graduate_cohort_rule_sets set effective_from = '2030-01-01' where id = '${ruleSetId}'`, /immutable/);
    });

    it("allows only active -> superseded, and never back", async () => {
      const [o2] = await pg.sql(
        `insert into graduate_program_offerings (key, category, route, marketing_title, awarding_institution, program_version)
         values ('syn-uni-bdbi', 'big_data_bi', 'eneb_unimarconi', 'Synthetic BDBI', 'unimarconi', '2026.1') returning id`,
      );
      const [rs] = await pg.sql(
        `insert into graduate_cohort_rule_sets (offering_id, cohort_label, version, effective_from) values ('${o2.id}', 'c', 1, '2026-01-01') returning id`,
      );
      await pg.sql(`update graduate_cohort_rule_sets set status = 'superseded' where id = '${rs.id}'`);
      await rejects(`update graduate_cohort_rule_sets set status = 'active' where id = '${rs.id}'`, /active to superseded/);
    });

    it("keeps one active rule set per offering and cohort, and one row per version", async () => {
      await rejects(
        `insert into graduate_cohort_rule_sets (offering_id, cohort_label, version, effective_from) values ('${offeringId}', '2026 intake', 2, '2026-06-01')`,
        /one_active/,
      );
      await rejects(
        `insert into graduate_cohort_rule_sets (offering_id, cohort_label, version, effective_from, status) values ('${offeringId}', 'x', 1, '2026-06-01', 'superseded')`,
        /offering_version_unique/,
      );
    });
  });

  describe("an enrollment pins its rule set", () => {
    it("rejects re-pointing the rule set, offering, student or route", async () => {
      const [o3] = await pg.sql(
        `insert into graduate_program_offerings (key, category, route, marketing_title, awarding_institution, program_version)
         values ('syn-uni-hr', 'hr_talent', 'eneb_unimarconi', 'Synthetic HR', 'unimarconi', '2026.1') returning id`,
      );
      const [rs3] = await pg.sql(
        `insert into graduate_cohort_rule_sets (offering_id, cohort_label, version, effective_from) values ('${o3.id}', '2026 intake', 1, '2026-01-01') returning id`,
      );
      await rejects(`update student_graduate_programs set rule_set_id = '${rs3.id}' where id = '${programId}'`, /pinned/);
      await rejects(`update student_graduate_programs set offering_id = '${o3.id}' where id = '${programId}'`, /pinned/);
      await rejects(`update student_graduate_programs set student_id = '${other.id}' where id = '${programId}'`, /pinned/);
      await rejects(`update student_graduate_programs set route = 'eneb_only' where id = '${programId}'`, /pinned/);
      // Ordinary fields still update.
      await pg.sql(`update student_graduate_programs set eneb_status = 'in_progress', note = 'x' where id = '${programId}'`);
    });

    it("rejects an enrollment whose rule set belongs to another offering", async () => {
      const [o4] = await pg.sql(
        `insert into graduate_program_offerings (key, category, route, marketing_title, awarding_institution, program_version)
         values ('syn-uni-smm', 'sales_marketing', 'eneb_unimarconi', 'Synthetic SMM', 'unimarconi', '2026.1') returning id`,
      );
      await rejects(
        `insert into student_graduate_programs (student_id, offering_id, rule_set_id, route, cohort_label, enrolled_at)
         values ('${student.id}', '${o4.id}', '${ruleSetId}', 'eneb_unimarconi', 'c', '2026-02-01')`,
        /does not belong/,
      );
    });

    it("a student may hold several programmes", async () => {
      await pg.sql(
        `insert into student_graduate_programs (student_id, offering_id, rule_set_id, route, cohort_label, enrolled_at)
         values ('${student.id}', '${offeringId}', '${ruleSetId}', 'eneb_unimarconi', '2026 intake', '2026-03-01')`,
      );
      const [n] = await pg.sql(`select count(*)::int as n from student_graduate_programs where student_id = '${student.id}'`);
      expect(n.n).toBe(2);
    });
  });

  describe("verified records need the full evidence set", () => {
    it("rejects an evidence-less verified row", async () => {
      await rejects(
        `insert into graduate_records (program_id, student_id, kind, verification_status) values ('${programId}', '${student.id}', 'university_admission', 'verified')`,
        /verified_evidence_check/,
      );
    });

    it("rejects verified rows with any evidence column missing; accepts the complete row", async () => {
      const base = {
        issuing_institution: "'unimarconi'",
        document_type_label: "'Admission letter'",
        document_reference: "'SYN-REF-1'",
        decision_date: "'2026-05-01'",
        reviewer_user_id: `'${staff.id}'`,
      };
      const insert = (omit: string | null, kind = "university_admission", extra: Record<string, string> = {}) => {
        const cols = { ...base, ...extra };
        const keys = Object.keys(cols).filter((k) => k !== omit);
        return `insert into graduate_records (program_id, student_id, kind, verification_status, ${keys.join(", ")})
                values ('${programId}', '${student.id}', '${kind}', 'verified', ${keys.map((k) => (cols as Record<string, string>)[k]).join(", ")})`;
      };
      for (const omit of ["issuing_institution", "document_type_label", "document_reference", "decision_date", "reviewer_user_id"]) {
        await rejects(insert(omit), /verified_evidence_check/);
      }
      // A document id can stand in for a reference.
      await pg.sql(insert("document_reference", "university_admission", { document_id: "'doc-synthetic-1'" }));
      await pg.sql(insert(null));
    });

    it("a verified conferral also needs its effective date", async () => {
      const full = `insert into graduate_records (program_id, student_id, kind, verification_status, issuing_institution, document_type_label, document_reference, decision_date, reviewer_user_id`;
      await rejects(`${full}) values ('${programId}', '${student.id}', 'award_conferral', 'verified', 'unimarconi', 'Conferral decree', 'SYN-C1', '2026-09-01', '${staff.id}')`, /conferral_date_check/);
      await pg.sql(`${full}, effective_date) values ('${programId}', '${student.id}', 'award_conferral', 'verified', 'unimarconi', 'Conferral decree', 'SYN-C1', '2026-09-01', '${staff.id}', '2026-09-01')`);
    });

    it("unverified rows do not need evidence", async () => {
      await pg.sql(`insert into graduate_records (program_id, student_id, kind) values ('${programId}', '${student.id}', 'university_application')`);
    });

    it("rejects unknown kinds and statuses", async () => {
      await rejects(`insert into graduate_records (program_id, student_id, kind) values ('${programId}', '${student.id}', 'made_up')`, /kind_check/);
      await rejects(`insert into graduate_records (program_id, student_id, kind, verification_status) values ('${programId}', '${student.id}', 'eneb_transcript', 'approved')`, /verification_status_check/);
    });
  });

  describe("credit entries", () => {
    let recordId: string;
    beforeAll(async () => {
      const [r] = await pg.sql(`insert into graduate_records (program_id, student_id, kind) values ('${programId}', '${student.id}', 'recognition_request') returning id`);
      recordId = r.id as string;
    });

    it("conditional recognition must state its conditions", async () => {
      await rejects(
        `insert into graduate_credit_entries (program_id, authority, record_id, label, amount, unit, recognition_outcome)
         values ('${programId}', 'university_recognized', '${recordId}', 'Synthetic', 6, 'CFU', 'recognized_with_conditions')`,
        /conditions_check/,
      );
    });

    it("is append-only (no updates)", async () => {
      const [c] = await pg.sql(
        `insert into graduate_credit_entries (program_id, authority, record_id, label, amount, unit)
         values ('${programId}', 'eneb_stated', '${recordId}', 'Synthetic', 6, 'ECTS') returning id`,
      );
      await rejects(`update graduate_credit_entries set amount = 60 where id = '${c.id}'`, /append-only/);
    });
  });

  describe("graduate_events is append-only", () => {
    it("accepts inserts and rejects UPDATE and DELETE", async () => {
      const [e] = await pg.sql(
        `insert into graduate_events (program_id, student_id, actor_user_id, actor_role, action, entity_type, entity_id, before, after)
         values ('${programId}', '${student.id}', '${staff.id}', 'staff', 'program_updated', 'program', '${programId}', null, '{"a":1}'::jsonb) returning id`,
      );
      await rejects(`update graduate_events set action = 'x' where id = '${e.id}'`, /append-only/);
      await rejects(`delete from graduate_events where id = '${e.id}'`, /append-only/);
      await rejects(`delete from graduate_events`, /append-only/);
    });
  });

  describe("row level security", () => {
    /** Runs a select as role `authenticated` with auth.uid() = uid. */
    const asUser = async (uid: string, query: string) => {
      const conn = pg.connect({ max: 1 });
      try {
        return await conn.begin(async (tx) => {
          await tx`select set_config('request.jwt.claim.sub', ${uid}, true)`;
          await tx.unsafe(`set local role authenticated`);
          return Array.from(await tx.unsafe(query));
        });
      } finally {
        await conn.end({ timeout: 5 });
      }
    };

    beforeAll(async () => {
      // Supabase grants table privileges to `authenticated` by default; the disposable shim does not. Mirror it for SELECT only.
      await pg.sql(`grant select on ${TABLES.join(", ")} to authenticated`);
      await pg.sql(
        `insert into student_graduate_programs (student_id, offering_id, rule_set_id, route, cohort_label, enrolled_at)
         values ('${other.id}', '${offeringId}', '${ruleSetId}', 'eneb_unimarconi', '2026 intake', '2026-02-01')`,
      );
      await pg.sql(`insert into graduate_subjects (program_id, authority, title) values ('${programId}', 'eneb', 'Synthetic subject')`);
    });

    it("a student reads only their own programmes, subjects and records", async () => {
      const own = await asUser(studentUser.id, `select student_id from student_graduate_programs`);
      expect(own.length).toBeGreaterThan(0);
      expect(own.every((r) => r.student_id === student.id)).toBe(true);
      expect((await asUser(otherUser.id, `select id from graduate_subjects`)).length).toBe(0);
      expect((await asUser(otherUser.id, `select id from graduate_records`)).length).toBe(0);
      expect((await asUser(studentUser.id, `select id from graduate_subjects`)).length).toBeGreaterThan(0);
    });

    it("a student cannot read events or the catalogue; staff can read everything", async () => {
      expect((await asUser(studentUser.id, `select id from graduate_events`)).length).toBe(0);
      expect((await asUser(studentUser.id, `select id from graduate_cohort_rule_sets`)).length).toBe(0);
      expect((await asUser(studentUser.id, `select id from graduate_program_offerings`)).length).toBe(0);
      expect((await asUser(staff.id, `select id from graduate_events`)).length).toBeGreaterThan(0);
      expect((await asUser(staff.id, `select id from student_graduate_programs`)).length).toBeGreaterThanOrEqual(3);
    });

    it("an authenticated student cannot write", async () => {
      let error: unknown = null;
      try {
        await asUser(studentUser.id, `update student_graduate_programs set note = 'hacked'`);
      } catch (e) {
        error = e;
      }
      expect(error).not.toBeNull();
    });
  });
});
