/**
 * S10 — audit enum chain: every audit event type the code can emit must be
 * insertable after the FULL migration chain (filename order) on a disposable
 * local PostgreSQL 16, and the S10 idempotency index must behave as documented.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, seedUser, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const AUDIT_SRC = fs.readFileSync(path.join(ROOT, "server", "lib", "audit.ts"), "utf8");

/** Every member of the AuditEventType union in server/lib/audit.ts. */
function emittableEventTypes(): string[] {
  const start = AUDIT_SRC.indexOf("export type AuditEventType");
  const end = AUDIT_SRC.indexOf("export type AuditSeverity");
  const block = AUDIT_SRC.slice(start, end);
  return [...block.matchAll(/\|\s*'([a-z0-9_.]+)'/g)].map((m) => m[1]);
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : [],
  );
}

describe("audit event types in code", () => {
  const types = emittableEventTypes();

  it("parses a plausible, duplicate-free union", () => {
    expect(types.length).toBeGreaterThan(60);
    expect(new Set(types).size).toBe(types.length);
    expect(types).toContain("support.ticket_created");
    expect(types).toContain("roadmap.published");
  });

  it("every literal eventType used under server/ is in the union (no `as any` escapes)", () => {
    const used = new Set<string>();
    for (const file of walk(path.join(ROOT, "server"))) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/eventType:\s*["']([a-z0-9_]+\.[a-z0-9_.]+)["']/g)) used.add(m[1]);
      for (const m of text.matchAll(/\baudit[A-Za-z]*\(\s*["']([a-z0-9_]+\.[a-z0-9_.]+)["']/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(5);
    expect([...used].filter((t) => !types.includes(t))).toEqual([]);
  });
});

describe("enum migrations, static checks", () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const enumFiles = files.filter((f) => /ALTER TYPE\s+(public\.)?audit_event_type\s+ADD VALUE/i.test(fs.readFileSync(path.join(MIGRATIONS, f), "utf8")));

  it("S07 and S08 enum migrations sort after the phase-2D enum creation", () => {
    const create = files.indexOf("20260915180000_phase2d_audit_logging.sql");
    expect(create).toBeGreaterThanOrEqual(0);
    for (const f of enumFiles) expect(files.indexOf(f)).toBeGreaterThan(create);
    expect(enumFiles).toEqual(expect.arrayContaining(["20261026110000_s07_roadmap_audit_event_types.sql", "20261027100000_s08_support_audit_events.sql"]));
  });

  it("every ADD VALUE is IF NOT EXISTS, no transaction wrapper, and no value is added twice across files", () => {
    const seen = new Map<string, string>();
    for (const f of enumFiles) {
      const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const adds = [...sql.matchAll(/ALTER TYPE\s+(?:public\.)?audit_event_type\s+ADD VALUE\s+(IF NOT EXISTS\s+)?'([^']+)'/gi)];
      expect(adds.length).toBeGreaterThan(0);
      for (const a of adds) {
        expect(a[1], `${f}: ${a[2]} must be IF NOT EXISTS`).toBeTruthy();
        expect(seen.has(a[2]), `${a[2]} added in both ${seen.get(a[2])} and ${f}`).toBe(false);
        seen.set(a[2], f);
      }
      // A new enum value cannot be used in the transaction that adds it; these files only add.
      expect(/^\s*(BEGIN|COMMIT)\b/im.test(sql)).toBe(false);
      expect(/\b(INSERT|UPDATE|SELECT)\b/i.test(sql)).toBe(false);
    }
  });
});

describe.skipIf(!PG_BINARIES_AVAILABLE)("full migration chain on disposable PostgreSQL 16", () => {
  let pg: LocalPg;
  beforeAll(async () => {
    pg = await startLocalPg();
  }, 300_000);
  afterAll(async () => {
    await pg?.stop();
  }, 60_000);

  it("applied the migrations in filename order (S10 index last)", () => {
    const applied = pg.appliedFiles.filter((f) => f.startsWith("supabase/migrations/"));
    const sorted = [...applied].sort();
    // The harness moves the 011 course migration first by design; everything else is sorted.
    expect(applied.slice(1)).toEqual(sorted.filter((f) => !f.endsWith("20251217230356_011_degree_programs_courses.sql")));
    expect(applied[applied.length - 1]).toBe("supabase/migrations/20261028100000_s10_support_idempotency_index.sql");
  });

  it("the enum has no duplicate labels and contains every event type the code can emit", async () => {
    const rows = await pg.sql(
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'audit_event_type'`,
    );
    const labels = rows.map((r) => r.enumlabel as string);
    expect(new Set(labels).size).toBe(labels.length);
    expect(emittableEventTypes().filter((t) => !labels.includes(t))).toEqual([]);
  });

  it("every emittable event type is insertable into audit_logs", async () => {
    const types = emittableEventTypes();
    for (const t of types) {
      await pg.sql(
        `insert into audit_logs (event_type, severity, action_description, metadata) values ('${t}', 'info', 'S10 chain check', '{}'::jsonb)`,
      );
    }
    const [r] = await pg.sql(`select count(distinct event_type)::int as n from audit_logs where action_description = 'S10 chain check'`);
    expect(r.n).toBe(types.length);
  });

  it("re-applying the S07, S08 and S10 migrations is a no-op", async () => {
    for (const f of [
      "20261026110000_s07_roadmap_audit_event_types.sql",
      "20261027100000_s08_support_audit_events.sql",
      "20261028100000_s10_support_idempotency_index.sql",
    ]) {
      await pg.sql(fs.readFileSync(path.join(MIGRATIONS, f), "utf8"));
    }
  });

  it("S10 index: same student + same key is rejected, other student / keyless are fine; ticket delete cascades", async () => {
    const a = await seedUser(pg, "student", "idem-a");
    const b = await seedUser(pg, "student", "idem-b");
    const ins = (uid: string, subj: string, meta: string) =>
      pg.sql(
        `insert into support_tickets (reporter_id, reporter_name, reporter_email, subject, description, metadata)
         values ('${uid}', 'T', 't@example.com', '${subj}', 'A description here', '${meta}'::jsonb) returning id`,
      );
    const first = await ins(a.id, "First subject", '{"idempotency_key":"key-0123456789abcdef"}');
    await expect(ins(a.id, "Second subject", '{"idempotency_key":"key-0123456789abcdef"}')).rejects.toMatchObject({ code: "23505" });
    await ins(b.id, "Other student", '{"idempotency_key":"key-0123456789abcdef"}');
    await ins(a.id, "Keyless one", "{}");
    await ins(a.id, "Keyless two", "{}");
    await pg.sql(
      `insert into ticket_comments (ticket_id, author_id, author_name, author_role, content) values ('${first[0].id}', '${a.id}', 'T', 'student', 'opening')`,
    );
    await pg.sql(`delete from support_tickets where id = '${first[0].id}'`);
    const [c] = await pg.sql(`select count(*)::int as n from ticket_comments where ticket_id = '${first[0].id}'`);
    expect(c.n).toBe(0);
  });
});
