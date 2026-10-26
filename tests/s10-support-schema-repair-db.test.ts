/**
 * S10 - support schema repair migration against real disposable PostgreSQL 16.
 *
 * LOCAL ONLY. "Production lineage" here is an APPROXIMATION: the S02 build order restricted to
 * PRODUCTION_DATABASE_SETUP.sql + the supabase/migrations chain, without the disposable-only
 * supplements that reconstruct tables production may lack. It is not a copy of the live database.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, seedUser, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const ROOT = path.resolve(import.meta.dirname, "..");
const REPAIR = "20261028200000_s10_support_schema_repair.sql";
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const repairSql = () => read(`supabase/migrations/${REPAIR}`);

const SUPPORT_EVENTS = [
  "support.ticket_created", "support.ticket_updated", "support.status_changed", "support.assignment_changed",
  "support.priority_changed", "support.comment_added", "support.internal_note_added",
  "support.attachment_added", "support.attachment_downloaded", "support.access_denied",
];
const ATTACHMENT_COLS = ["id", "ticket_id", "comment_id", "file_name", "file_size", "file_type", "storage_path", "uploaded_by", "created_at"];
const HISTORY_COLS = ["id", "ticket_id", "old_status", "new_status", "changed_by", "change_reason", "created_at"];

async function cols(pg: LocalPg, table: string): Promise<string[]> {
  const rows = await pg.sql(`select column_name from information_schema.columns where table_schema='public' and table_name='${table}'`);
  return rows.map((r) => r.column_name as string);
}

describe("S10 repair migration file", () => {
  const sql = repairSql();
  it("is idempotent by construction and private by default", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.ticket_attachments/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.ticket_status_history/);
    expect(sql).toMatch(/ALTER TABLE public\.ticket_attachments ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE public\.ticket_status_history ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON public\.ticket_attachments FROM anon, authenticated/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM|ALTER TABLE [^;]*DROP/i);
    expect(sql).not.toMatch(/CREATE TRIGGER/i);
  });
  it("never writes the literal 'system' into a foreign key column", () => {
    const code = sql.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/'system'/);
  });
});

describe.skipIf(!PG_BINARIES_AVAILABLE)("S10 repair - full chain (with disposable supplements)", () => {
  let pg: LocalPg;
  beforeAll(async () => {
    pg = await startLocalPg();
  }, 300_000);
  afterAll(async () => {
    await pg?.stop();
  }, 60_000);

  it("applies the repair as part of the chain, after S08", () => {
    const files = pg.appliedFiles.filter((f) => f.startsWith("supabase/migrations/"));
    expect(files.indexOf(`supabase/migrations/${REPAIR}`)).toBeGreaterThan(
      files.indexOf("supabase/migrations/20261027100000_s08_support_audit_events.sql"),
    );
  });

  it("re-applying the repair (and the S05/S07/S08 migrations) any number of times is a no-op", async () => {
    const before = await pg.sql(`select table_name from information_schema.tables where table_schema='public' order by 1`);
    const idempotent = [
      "20261026100000_s05_student_roadmap.sql",
      "20261026110000_s07_roadmap_audit_event_types.sql",
      "20261027100000_s08_support_audit_events.sql",
      REPAIR,
    ];
    for (let pass = 0; pass < 2; pass++) {
      for (const f of idempotent) await pg.sql(read(`supabase/migrations/${f}`));
    }
    const after = await pg.sql(`select table_name from information_schema.tables where table_schema='public' order by 1`);
    expect(after.map((r) => r.table_name)).toEqual(before.map((r) => r.table_name));
  });

  it("second pass over the WHOLE supabase/migrations chain: the post-2026-09 files are idempotent", async () => {
    // Older files (Dec 2025 011 policies, phase files) were never written to be re-run; they are
    // reported, not asserted. Everything from the knowledge/audit/roadmap/support era must re-apply cleanly.
    const dir = path.join(ROOT, "supabase", "migrations");
    const failed: string[] = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      try {
        await pg.sql(read(`supabase/migrations/${f}`));
      } catch {
        failed.push(f);
      }
    }
    // Recorded so the checklist can state exactly which files must never be re-run on a live database.
    console.info("S10 second-pass non-idempotent legacy files:", JSON.stringify(failed));
    expect(failed).not.toContain(REPAIR);
    expect(failed).not.toContain("20261026100000_s05_student_roadmap.sql");
    expect(failed).not.toContain("20261026110000_s07_roadmap_audit_event_types.sql");
    expect(failed).not.toContain("20261027100000_s08_support_audit_events.sql");
  }, 120_000);

  it("exposes the support tables with the columns the code reads", async () => {
    expect(await cols(pg, "ticket_attachments")).toEqual(expect.arrayContaining(ATTACHMENT_COLS));
    expect(await cols(pg, "ticket_status_history")).toEqual(expect.arrayContaining(HISTORY_COLS));
  });
});

describe.skipIf(!PG_BINARIES_AVAILABLE)("S10 repair - simulated legacy production lineage", () => {
  let pg: LocalPg;
  beforeAll(async () => {
    pg = await startLocalPg({ lineage: "production", exclude: [REPAIR] });
  }, 300_000);
  afterAll(async () => {
    await pg?.stop();
  }, 60_000);

  it("reproduces the drift: S08 tables are absent before the repair, core tables and enums are present", async () => {
    const [r] = await pg.sql(
      `select to_regclass('public.ticket_attachments') is null as no_att, to_regclass('public.ticket_status_history') is null as no_hist,
              to_regclass('public.support_tickets') is not null as has_tickets, to_regclass('public.ticket_comments') is not null as has_comments`,
    );
    expect(r).toEqual({ no_att: true, no_hist: true, has_tickets: true, has_comments: true });
    const enums = await pg.sql(
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'audit_event_type' and e.enumlabel like 'support.%'`,
    );
    expect(enums.map((e) => e.enumlabel).sort()).toEqual([...SUPPORT_EVENTS].sort());
    const roadmap = await pg.sql(`select table_name from information_schema.tables where table_schema='public' and table_name like 'student_roadmap_%'`);
    expect(roadmap.length).toBe(5);
  });

  it("the repair creates the tables with RLS on, no client privileges, service_role access", async () => {
    await pg.sql(repairSql());
    expect(await cols(pg, "ticket_attachments")).toEqual(expect.arrayContaining(ATTACHMENT_COLS));
    expect(await cols(pg, "ticket_status_history")).toEqual(expect.arrayContaining(HISTORY_COLS));
    for (const t of ["ticket_attachments", "ticket_status_history"]) {
      const [rls] = await pg.sql(`select relrowsecurity as on from pg_class where oid = 'public.${t}'::regclass`);
      expect(rls.on).toBe(true);
      const [p] = await pg.sql(
        `select has_table_privilege('anon','public.${t}','SELECT,INSERT,UPDATE,DELETE') as anon_any,
                has_table_privilege('authenticated','public.${t}','SELECT') as auth_select,
                has_table_privilege('authenticated','public.${t}','INSERT') as auth_insert,
                has_table_privilege('service_role','public.${t}','SELECT') as svc_select,
                has_table_privilege('service_role','public.${t}','INSERT') as svc_insert`,
      );
      expect(p).toEqual({ anon_any: false, auth_select: false, auth_insert: false, svc_select: true, svc_insert: true });
      const [pol] = await pg.sql(`select count(*)::int as n from pg_policies where schemaname='public' and tablename='${t}'`);
      expect(pol.n).toBe(0);
    }
  });

  it("is idempotent: a second and third run change nothing", async () => {
    const snap = async () =>
      JSON.stringify(await pg.sql(`select table_name, column_name, data_type from information_schema.columns where table_schema='public' and table_name in ('ticket_attachments','ticket_status_history') order by 1, ordinal_position`));
    const first = await snap();
    await pg.sql(repairSql());
    await pg.sql(repairSql());
    expect(await snap()).toBe(first);
  });

  it("enforces the data constraints the API relies on (size, name, FK, cascade)", async () => {
    const user = await seedUser(pg, "student");
    const [t] = await pg.sql(
      `insert into support_tickets (reporter_id, reporter_name, reporter_email, subject, description) values ('${user.id}','S','s@example.com','Subject here','A description here') returning id`,
    );
    const ok = `insert into ticket_attachments (ticket_id, file_name, file_size, file_type, storage_path, uploaded_by) values ('${t.id}','a.pdf',100,'application/pdf','tickets/${t.id}/${user.id}/x.pdf','${user.id}')`;
    await pg.sql(ok);
    await expect(pg.sql(ok.replace("100,", "0,"))).rejects.toThrow(/valid_file_size/);
    await expect(pg.sql(ok.replace("100,", "10485761,"))).rejects.toThrow(/valid_file_size/);
    await expect(pg.sql(ok.replace("'a.pdf'", "''"))).rejects.toThrow(/valid_file_name/);
    await expect(pg.sql(ok.replace(`'${user.id}')`, `'no-such-user')`))).rejects.toThrow(/foreign key/);
    await pg.sql(`delete from support_tickets where id = '${t.id}'`);
    const [n] = await pg.sql(`select count(*)::int as n from ticket_attachments where ticket_id = '${t.id}'`);
    expect(n.n).toBe(0);
  });
});

describe.skipIf(!PG_BINARIES_AVAILABLE)("S10 repair - legacy migrations/010 status trigger", () => {
  let pg: LocalPg;
  beforeAll(async () => {
    pg = await startLocalPg({ lineage: "production", exclude: [REPAIR] });
    // Reproduce a production database where migrations/010 was applied by hand: take the table, function
    // and trigger definitions verbatim from the legacy file.
    const legacy = read("migrations/010_support_tickets_system.sql");
    const tables = legacy.slice(legacy.indexOf("-- Ticket attachments table"), legacy.indexOf("-- Function to generate ticket numbers"));
    const fnStart = legacy.indexOf("-- Function to create status history on status change");
    const trgEnd = legacy.indexOf("-- Indexes for performance");
    expect(tables).toContain("CREATE TABLE IF NOT EXISTS ticket_attachments");
    expect(legacy.slice(fnStart, trgEnd)).toContain("'system'");
    await pg.sql(tables);
    await pg.sql(legacy.slice(fnStart, trgEnd));
  }, 300_000);
  afterAll(async () => {
    await pg?.stop();
  }, 60_000);

  async function newTicket() {
    const user = await seedUser(pg, "student");
    const [t] = await pg.sql(
      `insert into support_tickets (reporter_id, reporter_name, reporter_email, subject, description) values ('${user.id}','S','s@example.com','Subject here','A description here') returning id`,
    );
    return { user, id: t.id as string };
  }

  it("BEFORE the repair the legacy trigger breaks every status change (FK on 'system')", async () => {
    const { id } = await newTicket();
    await expect(pg.sql(`update support_tickets set status = 'in_progress' where id = '${id}'`)).rejects.toThrow(/foreign key|changed_by/);
    const [r] = await pg.sql(`select status from support_tickets where id = '${id}'`);
    expect(r.status).toBe("open");
  });

  it("AFTER the repair status changes succeed and no 'system' row is ever written", async () => {
    await pg.sql(repairSql());
    const { id, user } = await newTicket();
    await pg.sql(`update support_tickets set status = 'in_progress' where id = '${id}'`);
    const [r] = await pg.sql(`select status from support_tickets where id = '${id}'`);
    expect(r.status).toBe("in_progress");
    const [none] = await pg.sql(`select count(*)::int as n from ticket_status_history where ticket_id = '${id}'`);
    expect(none.n).toBe(0); // no actor known to the database: the API records history itself

    // With a real actor named in the legacy setting the trigger records a correctly attributed row.
    await pg.client.begin(async (tx) => {
      await tx.unsafe(`select set_config('app.current_user_id', '${user.id}', true)`);
      await tx.unsafe(`update support_tickets set status = 'resolved' where id = '${id}'`);
    });
    const rows = await pg.sql(`select changed_by, old_status, new_status from ticket_status_history where ticket_id = '${id}'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ changed_by: user.id, old_status: "in_progress", new_status: "resolved" });

    // An actor that is not a user is ignored rather than failing the update.
    await pg.client.begin(async (tx) => {
      await tx.unsafe(`select set_config('app.current_user_id', 'system', true)`);
      await tx.unsafe(`update support_tickets set status = 'closed' where id = '${id}'`);
    });
    const [after] = await pg.sql(`select status from support_tickets where id = '${id}'`);
    expect(after.status).toBe("closed");
    const [bad] = await pg.sql(`select count(*)::int as n from ticket_status_history where changed_by = 'system'`);
    expect(bad.n).toBe(0);
  });

  it("the repaired function is not callable by client roles", async () => {
    const [p] = await pg.sql(
      `select has_function_privilege('anon','public.track_ticket_status_change()','EXECUTE') as anon_x,
              has_function_privilege('authenticated','public.track_ticket_status_change()','EXECUTE') as auth_x,
              has_function_privilege('service_role','public.track_ticket_status_change()','EXECUTE') as svc_x`,
    );
    expect(p).toEqual({ anon_x: false, auth_x: false, svc_x: true });
  });
});
