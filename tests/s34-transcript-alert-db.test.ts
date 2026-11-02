/**
 * S34 (S33-05, review fix): the transcript-request query runs on real Postgres and dates the item from the latest
 * transition to 'requested' (hs_events), so later graduation edits do not reset its age.
 * Bare cluster with the two columns-only tables the query reads; every other loadAttentionExtra query is stubbed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { PG_BINARIES_AVAILABLE, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";
import { loadAttentionExtra } from "../server/services/s29/rules";

describe.skipIf(!PG_BINARIES_AVAILABLE)("S34 transcript request query (real Postgres)", () => {
  let pg: LocalPg; let client: postgres.Sql;
  beforeAll(async () => {
    pg = await startLocalPg({ bare: true });
    client = postgres(pg.url, { max: 2, onnotice: () => {} });
    await pg.sql(`CREATE TABLE hs_graduation_records (student_id text, transcript_status text, updated_at timestamptz);
      CREATE TABLE hs_events (student_id text, event_type text, summary text, created_at timestamptz);
      INSERT INTO hs_graduation_records VALUES ('s1','requested','2026-10-30T00:00:00Z'), ('s2','requested','2026-10-25T00:00:00Z'), ('s3','issued','2026-10-20T00:00:00Z');
      INSERT INTO hs_events VALUES ('s1','transcript_requested','Student requested their transcript','2026-10-10T00:00:00Z'),
        ('s1','transcript_requested','Student asked again about their transcript','2026-10-28T00:00:00Z'),
        ('s3','transcript_requested','Student requested their transcript','2026-10-01T00:00:00Z');`);
  }, 120_000);
  afterAll(async () => { await client?.end(); await pg?.stop(); });

  it("one row per outstanding request, aged from the request event (fallback: record update time)", async () => {
    const real = drizzle(client); const dialect = new PgDialect();
    const db = { execute: async (q: any) => (dialect.sqlToQuery(q).sql.includes("hs_graduation_records") ? real.execute(q) : []) };
    const extra = await loadAttentionExtra(db as any, new Date("2026-11-02T00:00:00Z"), false);
    const rows = [...(extra.transcriptRequests ?? [])].map((r) => ({ studentId: r.studentId, on: r.requestedAt.slice(0, 10) }));
    expect(rows).toEqual([{ studentId: "s1", on: "2026-10-10" }, { studentId: "s2", on: "2026-10-25" }]);
  });
});
