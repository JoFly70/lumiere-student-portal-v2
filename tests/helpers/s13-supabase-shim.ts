/**
 * S13 — a Supabase client double for the first-student journey, ONE app on ONE database:
 *   - `students` and `student_documents` (used by POST /api/students and /api/documents
 *     through supabaseAdmin) are served by a tiny PostgREST-subset shim over the real
 *     local Postgres, so those routes run for real against the same rows the HS service reads.
 *   - the four support tables go to the S08 in-memory fake (they are not in the local migration chain).
 *   - storage: public URL is synthetic; everything else is the fake's storage.
 * Synthetic data only.
 */
import type { LocalPg } from "./s05-local-pg";
import { createFakeSupportSupabase } from "./fake-supabase-support";

const PG_TABLES = new Set(["students", "student_documents"]);
const IDENT = /^[a-z_][a-z0-9_]*$/;
type Filter = { col: string; op: "eq" | "neq" | "is"; val: unknown };
type Result = { data: any; error: { message: string; code?: string } | null };

class PgQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" = "select";
  private payload: Record<string, unknown> = {};
  private filters: Filter[] = [];
  private mode: "many" | "single" | "maybe" = "many";
  private returning = false;
  constructor(private readonly pg: LocalPg, private readonly table: string) {}

  select() { if (this.op === "select") this.returning = true; else this.returning = true; return this; }
  insert(row: Record<string, unknown>) { this.op = "insert"; this.payload = row; return this; }
  update(patch: Record<string, unknown>) { this.op = "update"; this.payload = patch; return this; }
  eq(col: string, val: unknown) { this.filters.push({ col, op: "eq", val }); return this; }
  neq(col: string, val: unknown) { this.filters.push({ col, op: "neq", val }); return this; }
  is(col: string, val: unknown) { this.filters.push({ col, op: "is", val }); return this; }
  order() { return this; }
  limit() { return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  private where(params: unknown[]): string {
    if (!this.filters.length) return "";
    const parts = this.filters.map((f) => {
      if (!IDENT.test(f.col)) throw new Error(`shim: unsupported column ${f.col}`);
      if (f.op === "is") return f.val === null ? `t."${f.col}" is null` : `t."${f.col}" is ${f.val ? "true" : "false"}`;
      params.push(f.val as never);
      return `t."${f.col}" ${f.op === "eq" ? "=" : "<>"} $${params.length}`;
    });
    return ` where ${parts.join(" and ")}`;
  }

  private async run(): Promise<Result> {
    if (!PG_TABLES.has(this.table)) throw new Error(`shim: table ${this.table} is not Postgres-backed`);
    const params: unknown[] = [];
    let sql: string;
    const cols = Object.keys(this.payload);
    cols.forEach((c) => { if (!IDENT.test(c)) throw new Error(`shim: unsupported column ${c}`); });
    if (this.op === "insert") {
      params.push(this.pg.client.json(this.payload as never));
      const list = cols.map((c) => `"${c}"`).join(", ");
      sql = `insert into ${this.table} as t (${list}) select ${list} from jsonb_populate_record(null::${this.table}, $1::jsonb) returning to_jsonb(t.*) as r`;
    } else if (this.op === "update") {
      params.push(this.pg.client.json(this.payload as never));
      const sets = cols.map((c) => `"${c}" = (select r."${c}" from jsonb_populate_record(null::${this.table}, $1::jsonb) r)`).join(", ");
      sql = `update ${this.table} as t set ${sets}${this.where(params)} returning to_jsonb(t.*) as r`;
    } else {
      sql = `select to_jsonb(t.*) as r from ${this.table} as t${this.where(params)}`;
    }
    let rows: any[];
    try {
      rows = (await this.pg.client.unsafe(sql, params as never[])) as unknown as any[];
    } catch (e: any) {
      return { data: null, error: { message: String(e?.message ?? e), code: e?.code } };
    }
    const data = rows.map((x) => x.r);
    if (this.mode === "single") {
      return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: `${data.length} rows`, code: "PGRST116" } };
    }
    if (this.mode === "maybe") return { data: data[0] ?? null, error: null };
    return { data, error: null };
  }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.run().then(ok, bad);
  }
}

export function makeS13Supabase(pg: LocalPg) {
  const fake = createFakeSupportSupabase();
  const client = {
    auth: { getUser: async () => ({ data: { user: null }, error: { message: "invalid token" } }) },
    from: (table: string) => (PG_TABLES.has(table) ? new PgQuery(pg, table) : (fake.client as any).from(table)),
    storage: {
      from: (bucket: string) => ({
        ...((fake.client as any).storage.from(bucket) as object),
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://storage.synthetic.example/${bucket}/${p}` } }),
      }),
    },
  };
  return { client, fake };
}
