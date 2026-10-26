/**
 * S10 - S09 profile migration inside the FULL migration chain, on a real disposable PostgreSQL 16.
 *
 * LOCAL ONLY. Proves:
 *   - the chain (... S05 20261026100000, S07 audit 20261026110000, S09 profile 20261026200000,
 *     S08 support audit 20261027100000, S10 idempotency 20261028100000, S10 support repair
 *     20261028200000) plus the disposable supplement applies cleanly in filename order;
 *   - every migration in that chain can be re-run (idempotent), schema fingerprint unchanged;
 *   - the S09 to_regclass / pg_type guards: with student_contacts ABSENT the S09 migration still
 *     applies (corrections table created, contact parts skipped) and a re-run after the table
 *     exists adds the authority columns + CHECK + enum values;
 *   - the S09 objects exist with the expected shape (enum values, columns, CHECK, one-pending
 *     partial unique index, RLS, SELECT-only policy, no direct-write grants);
 *   - every audit event type the S09 code can emit exists in audit_event_type.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, seedStudent, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const ROOT = path.resolve(import.meta.dirname, "..");
const CHAIN = [
  "20261026100000_s05_student_roadmap.sql",
  "20261026110000_s07_roadmap_audit_event_types.sql",
  "20261026200000_s09_student_profile.sql",
  "20261027100000_s08_support_audit_events.sql",
  "20261028100000_s10_support_idempotency_index.sql",
  "20261028200000_s10_support_schema_repair.sql",
];
const S09 = CHAIN[2];
const readMigration = (f: string) => fs.readFileSync(path.join(ROOT, "supabase", "migrations", f), "utf8");

async function fingerprint(pg: LocalPg): Promise<Record<string, unknown>> {
  const cols = await pg.sql(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
    where table_schema='public' and table_name in ('student_contacts','student_identity_corrections') order by 1,2`);
  const idx = await pg.sql(`select indexname, indexdef from pg_indexes where schemaname='public'
    and tablename in ('student_contacts','student_identity_corrections') order by 1`);
  const cons = await pg.sql(`select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid in (to_regclass('public.student_contacts'), to_regclass('public.student_identity_corrections')) order by 1,2`);
  const pol = await pg.sql(`select tablename, policyname, cmd from pg_policies where schemaname='public'
    and tablename = 'student_identity_corrections' order by 2`);
  const enums = await pg.sql(`select t.typname, e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid
    where t.typname in ('contact_type_enum','audit_event_type') order by 1,2`);
  return { cols, idx, cons, pol, enums: enums.map((e) => `${e.typname}:${e.enumlabel}`) };
}

async function assertS09Objects(pg: LocalPg) {
  // enum values
  const labels = (await pg.sql(`select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='contact_type_enum'`)).map((r) => r.enumlabel);
  expect(labels).toEqual(expect.arrayContaining(["parent", "spouse", "guardian", "other", "emergency", "representative"]));

  // authority columns
  const cols = await pg.sql(`select column_name, data_type, is_nullable, column_default from information_schema.columns
    where table_schema='public' and table_name='student_contacts' and column_name like 'authority\\_%' order by 1`);
  const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
  expect(Object.keys(byName).sort()).toEqual(["authority_note", "authority_status", "authority_verified_at", "authority_verified_by"]);
  expect(byName.authority_status.is_nullable).toBe("NO");
  expect(String(byName.authority_status.column_default)).toContain("'listed'");
  expect(byName.authority_verified_at.data_type).toBe("timestamp with time zone");

  // CHECK constraint enforced
  const [def] = await pg.sql(`select pg_get_constraintdef(oid) as d from pg_constraint where conname='student_contacts_authority_status_check'`);
  expect(def.d).toMatch(/listed.*pending_verification.*verified.*revoked/s);
  const stu = await seedStudent(pg);
  await expect(
    pg.sql(`insert into student_contacts (student_id, type, full_name, relationship, phone, authority_status)
            values ('${stu.id}', 'guardian', 'Bad Status', 'x', '+15550000001', 'god_mode')`),
  ).rejects.toThrow(/student_contacts_authority_status_check/);
  const [ok] = await pg.sql(`insert into student_contacts (student_id, type, full_name, relationship, phone)
            values ('${stu.id}', 'representative', 'Default Status', 'x', '+15550000002') returning authority_status`);
  expect(ok.authority_status).toBe("listed");

  // corrections table + one-pending partial unique index
  const [{ rls }] = await pg.sql(`select relrowsecurity as rls from pg_class where oid = to_regclass('public.student_identity_corrections')`);
  expect(rls).toBe(true);
  const [idx] = await pg.sql(`select indexdef from pg_indexes where indexname='student_identity_corrections_one_pending_idx'`);
  expect(idx.indexdef).toMatch(/UNIQUE INDEX/);
  expect(idx.indexdef).toMatch(/\(student_id\)/);
  expect(idx.indexdef).toMatch(/WHERE \(status = 'pending'/);
  const ins = (status: string) =>
    pg.sql(`insert into student_identity_corrections (student_id, requested_by, requested_changes, current_snapshot, reason, status)
            values ('${stu.id}', 'u', '{}'::jsonb, '{}'::jsonb, 'r', '${status}')`);
  await ins("pending");
  await expect(ins("pending")).rejects.toThrow(/student_identity_corrections_one_pending_idx/);
  await ins("rejected");
  await ins("rejected"); // history is unlimited
  await expect(ins("bogus")).rejects.toThrow(/check/i);

  // SELECT-only policy, no direct writes for anon/authenticated
  const pol = await pg.sql(`select cmd, roles from pg_policies where tablename='student_identity_corrections'`);
  expect(pol.map((p) => p.cmd)).toEqual(["SELECT"]);
  for (const role of ["anon", "authenticated"]) {
    for (const priv of ["INSERT", "UPDATE", "DELETE"]) {
      const [g] = await pg.sql(`select has_table_privilege('${role}', 'public.student_identity_corrections', '${priv}') as ok`);
      expect(g.ok, `${role} ${priv}`).toBe(false);
    }
  }
}

describe("S10 profile migration chain - file level", () => {
  it("the six chain files exist and sort in the documented order", () => {
    const all = fs.readdirSync(path.join(ROOT, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    const idx = CHAIN.map((f) => all.indexOf(f));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("the S09 migration is additive: no drops, truncates or deletes, and no direct-write policies", () => {
    const code = readMigration(S09).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/DROP\s+(TABLE|COLUMN|TYPE)|TRUNCATE|DELETE\s+FROM/i);
    expect(code).not.toMatch(/CREATE POLICY[^;]*FOR\s+(INSERT|UPDATE|DELETE|ALL)/i);
  });

  it("S09 server code writes audit events only through writeAuditLog (-> admin.bulk_operation)", () => {
    const service = fs.readFileSync(path.join(ROOT, "server/services/student-profile-service.ts"), "utf8");
    const routes = fs.readFileSync(path.join(ROOT, "server/routes/students.ts"), "utf8");
    const audit = fs.readFileSync(path.join(ROOT, "server/lib/audit.ts"), "utf8");
    for (const src of [service, routes]) {
      expect(src).not.toMatch(/createAuditLog|auditProfile|auditDocument|eventType:/);
    }
    const fn = audit.slice(audit.indexOf("export async function writeAuditLog"));
    expect(fn).toMatch(/eventType: 'admin\.bulk_operation'/);
  });
});

describe.skipIf(!PG_BINARIES_AVAILABLE)("S10 profile migration chain - full chain with supplement", () => {
  let pg: LocalPg;
  beforeAll(async () => {
    pg = await startLocalPg();
  }, 300_000);
  afterAll(async () => {
    await pg?.stop();
  }, 60_000);

  it("applies every chain file, in filename order, before the disposable supplement", () => {
    const applied = pg.appliedFiles.map((f) => path.basename(f));
    const pos = CHAIN.map((f) => applied.indexOf(f));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    const supp = applied.indexOf("50_runtime_supplement.sql");
    expect(supp).toBeGreaterThan(Math.max(...pos));
    // the migrations directory portion is in filename order
    const migrationPart = pg.appliedFiles.filter((f) => f.startsWith("supabase/migrations/"));
    expect(migrationPart).toEqual([...migrationPart].sort());
  });

  it("first pass: student_contacts did not exist when S09 ran, so contact parts were skipped (supplement creates it later)", async () => {
    const cols = await pg.sql(`select column_name from information_schema.columns where table_name='student_contacts' and column_name like 'authority\\_%'`);
    expect(cols.length).toBe(0);
    const [{ t }] = await pg.sql(`select to_regclass('public.student_identity_corrections') is not null as t`);
    expect(t).toBe(true); // students existed, so the corrections table was created on pass 1
    const labels = (await pg.sql(`select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='contact_type_enum'`)).map((r) => r.enumlabel);
    // the enum exists in the production lineage, so pass 1 already added the new values
    expect(labels).toEqual(expect.arrayContaining(["emergency", "representative"]));
  });

  it("re-running S09 once student_contacts exists adds the authority columns, CHECK and all S09 objects", async () => {
    await pg.sql(readMigration(S09));
    await assertS09Objects(pg);
  });

  it("every migration in the chain is idempotent on re-run: schema fingerprint is unchanged", async () => {
    const before = await fingerprint(pg);
    for (const f of CHAIN) {
      await pg.sql(readMigration(f));
    }
    await pg.sql(readMigration(S09));
    expect(await fingerprint(pg)).toEqual(before);
    await assertS09Objects(pg);
  });

  it("every audit event type the S09 code can emit exists in audit_event_type", async () => {
    // writeAuditLog always maps to admin.bulk_operation; the profile action name goes in metadata.action
    const labels = (await pg.sql(`select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='audit_event_type'`)).map((r) => r.enumlabel);
    expect(labels).toContain("admin.bulk_operation");
    // and the S07/S08 types the other modules emit are in the same chain
    for (const l of ["roadmap.published", "support.ticket_created", "support.access_denied"]) expect(labels).toContain(l);
    // profile.* types exist too, though S09 does not use them (documented in the integration record)
    for (const l of ["profile.updated", "profile.photo_uploaded"]) expect(labels).toContain(l);
  });
});

describe.skipIf(!PG_BINARIES_AVAILABLE)("S10 profile migration chain - to_regclass guards (student_contacts absent, then created)", () => {
  let pg: LocalPg;
  beforeAll(async () => {
    // production lineage = no disposable supplement, so student_contacts is genuinely absent
    pg = await startLocalPg({ lineage: "production" });
  }, 300_000);
  afterAll(async () => {
    await pg?.stop();
  }, 60_000);

  it("S09 applies cleanly (and twice) while student_contacts is absent, without creating it", async () => {
    const [{ t }] = await pg.sql(`select to_regclass('public.student_contacts') is not null as t`);
    expect(t).toBe(false);
    await pg.sql(readMigration(S09));
    await pg.sql(readMigration(S09));
    const [{ t2 }] = await pg.sql(`select to_regclass('public.student_contacts') is not null as t2`);
    expect(t2).toBe(false);
    const [{ c }] = await pg.sql(`select to_regclass('public.student_identity_corrections') is not null as c`);
    expect(c).toBe(true);
  });

  it("after student_contacts is created from the supplement DDL, re-running S09 completes the contact parts", async () => {
    const supplement = fs.readFileSync(path.join(ROOT, "scripts/disposable-env/50_runtime_supplement.sql"), "utf8");
    const start = supplement.indexOf("create table if not exists student_contacts");
    const end = supplement.indexOf(");", start) + 2;
    expect(start).toBeGreaterThan(0);
    await pg.sql(supplement.slice(start, end));
    await pg.sql(readMigration(S09));
    await assertS09Objects(pg);
  });

  it("when the contact_type_enum type is also absent, S09 still applies and skips the enum step", async () => {
    const bare = await startLocalPg({ bare: true });
    try {
      // minimal tables only: students is required for the corrections table
      await bare.sql(`
        create schema if not exists auth;
        create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
        create table public.users (id text primary key, role text);
        create table public.students (id text primary key, user_id text);`);
      for (const r of ["anon", "authenticated"]) await bare.sql(`do $$ begin create role ${r}; exception when duplicate_object then null; end $$;`);
      await bare.sql(readMigration(S09));
      const [{ e }] = await bare.sql(`select exists(select 1 from pg_type where typname='contact_type_enum') as e`);
      expect(e).toBe(false);
      const [{ c }] = await bare.sql(`select to_regclass('public.student_identity_corrections') is not null as c`);
      expect(c).toBe(true);
    } finally {
      await bare.stop();
    }
  }, 120_000);
});
