/**
 * S08 — the support audit-event migration against a real disposable Postgres.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, seedUser, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const S08_FILE = "20261027100000_s08_support_audit_events.sql";
const EVENTS = [
  "support.ticket_created", "support.ticket_updated", "support.status_changed", "support.assignment_changed",
  "support.priority_changed", "support.comment_added", "support.internal_note_added",
  "support.attachment_added", "support.attachment_downloaded", "support.access_denied",
];

describe("S08 migration file", () => {
  it("exists and guards every ADD VALUE", () => {
    const sql = fs.readFileSync(path.resolve(import.meta.dirname, "..", "supabase", "migrations", S08_FILE), "utf8");
    for (const e of EVENTS) expect(sql).toContain(`ADD VALUE IF NOT EXISTS '${e}'`);
    expect(sql.match(/^ALTER TYPE .* ADD VALUE/gm)?.length).toBe(EVENTS.length);
  });
});

describe.skipIf(!PG_BINARIES_AVAILABLE)("S08 support audit events — real Postgres", () => {
  let pg: LocalPg;
  beforeAll(async () => {
    pg = await startLocalPg();
  }, 300_000);
  afterAll(async () => {
    await pg?.stop();
  }, 60_000);

  it("applies the full chain including the S08 migration, last", () => {
    const files = pg.appliedFiles.filter((f) => f.startsWith("supabase/migrations/"));
    expect(files).toContain(`supabase/migrations/${S08_FILE}`);
    expect(files.indexOf(`supabase/migrations/${S08_FILE}`)).toBeGreaterThan(
      files.indexOf("supabase/migrations/20261026100000_s05_student_roadmap.sql"),
    );
  });

  it("has every support.* enum value", async () => {
    const rows = await pg.sql(
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'audit_event_type' and e.enumlabel like 'support.%'`,
    );
    expect(rows.map((r) => r.enumlabel).sort()).toEqual([...EVENTS].sort());
  });

  it("is idempotent when re-applied", async () => {
    const sql = fs.readFileSync(path.resolve(import.meta.dirname, "..", "supabase", "migrations", S08_FILE), "utf8");
    await pg.sql(sql);
    const [r] = await pg.sql(`select count(*)::int as n from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname='audit_event_type' and e.enumlabel like 'support.%'`);
    expect(r.n).toBe(EVENTS.length);
  });

  it("inserts a support.ticket_created audit row", async () => {
    await pg.sql(
      `insert into audit_logs (event_type, severity, action_description, target_resource_type, target_resource_id, metadata)
       values ('support.ticket_created', 'info', 'Support ticket created', 'support_ticket', 'abc', '{"ticketNumber":"LUM-10001"}'::jsonb)`,
    );
    const [row] = await pg.sql(`select event_type, metadata from audit_logs where event_type = 'support.ticket_created'`);
    expect(row.event_type).toBe("support.ticket_created");
    expect(row.metadata.ticketNumber).toBe("LUM-10001");
  });

  it("has the support tables with the expected columns", async () => {
    const cols = async (t: string) =>
      (await pg.sql(`select column_name, data_type from information_schema.columns where table_schema='public' and table_name='${t}'`));
    const tickets = await cols("support_tickets");
    const names = tickets.map((c) => c.column_name);
    for (const c of ["id", "ticket_number", "reporter_id", "subject", "category", "priority", "status", "assigned_to", "resolved_at", "resolution_notes", "metadata"]) {
      expect(names).toContain(c);
    }
    expect(tickets.find((c) => c.column_name === "metadata")?.data_type).toBe("jsonb");
    const comments = (await cols("ticket_comments")).map((c) => c.column_name);
    for (const c of ["ticket_id", "author_id", "author_role", "content", "is_internal"]) expect(comments).toContain(c);
  });

  it("generates ticket numbers through the trigger", async () => {
    const user = await seedUser(pg, "student");
    const [a] = await pg.sql(
      `insert into support_tickets (reporter_id, reporter_name, reporter_email, subject, description, metadata)
       values ('${user.id}', 'Test Student', 'ts@example.com', 'Subject one', 'A description here', '{"topic":"general"}'::jsonb) returning ticket_number, metadata, status, priority`,
    );
    const [b] = await pg.sql(
      `insert into support_tickets (reporter_id, reporter_name, reporter_email, subject, description)
       values ('${user.id}', 'Test Student', 'ts@example.com', 'Subject two', 'Another description') returning ticket_number`,
    );
    expect(a.ticket_number).toMatch(/^LUM-\d{5,}$/);
    expect(b.ticket_number).toMatch(/^LUM-\d{5,}$/);
    expect(b.ticket_number).not.toBe(a.ticket_number);
    expect(a.metadata.topic).toBe("general");
    expect(a.status).toBe("open");
    expect(a.priority).toBe("medium");
  });
});
