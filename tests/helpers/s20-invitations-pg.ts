/**
 * S20: a PostgREST-subset query shim for public.account_invitations over the REAL local Postgres, so the real
 * server/lib/invitations.ts (create/claim/release/consume) and POST /api/admin/invitations run against real SQL.
 * Supports exactly what those callers use: select/insert/update, eq, is, gt, or("col.is.null,col.lt.<v>"), order, limit, single, maybeSingle.
 * Synthetic data only.
 */
import type { LocalPg } from "./s05-local-pg";

const IDENT = /^[a-z_][a-z0-9_]*$/;
type Result = { data: any; error: { message: string; code?: string } | null };

export class InvitationQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" = "select";
  private payload: Record<string, unknown> = {};
  private conds: string[] = [];
  private params: unknown[] = [];
  private mode: "many" | "single" | "maybe" = "many";
  constructor(private readonly pg: LocalPg) {}
  private col(c: string) { if (!IDENT.test(c)) throw new Error(`shim: bad column ${c}`); return `t."${c}"`; }
  private p(v: unknown) { this.params.push(v as never); return `$${this.params.length}`; }
  select() { return this; }
  insert(row: Record<string, unknown>) { this.op = "insert"; this.payload = row; return this; }
  update(patch: Record<string, unknown>) { this.op = "update"; this.payload = patch; return this; }
  eq(c: string, v: unknown) { this.conds.push(`${this.col(c)} = ${this.p(v)}`); return this; }
  is(c: string, v: unknown) { this.conds.push(v === null ? `${this.col(c)} is null` : `${this.col(c)} is ${v ? "true" : "false"}`); return this; }
  gt(c: string, v: unknown) { this.conds.push(`${this.col(c)} > ${this.p(v)}::timestamptz`); return this; }
  or(expr: string) {
    const parts = expr.split(/,(?=[a-z_]+\.)/).map((clause) => {
      const m = /^([a-z_]+)\.(is|lt)\.(.+)$/.exec(clause);
      if (!m) throw new Error(`shim: unsupported or() clause ${clause}`);
      if (m[2] === "is") return `${this.col(m[1]!)} is null`;
      return `${this.col(m[1]!)} < ${this.p(m[3])}::timestamptz`;
    });
    this.conds.push(`(${parts.join(" or ")})`);
    return this;
  }
  order() { return this; }
  limit() { return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  private async run(): Promise<Result> {
    let sql: string;
    const cols = Object.keys(this.payload);
    cols.forEach((c) => this.col(c));
    try {
      if (this.op === "insert") {
        const j = this.p(this.pg.client.json(this.payload as never));
        const list = cols.map((c) => `"${c}"`).join(", ");
        sql = `insert into account_invitations as t (${list}) select ${list} from jsonb_populate_record(null::account_invitations, ${j}::jsonb) returning to_jsonb(t.*) as r`;
      } else if (this.op === "update") {
        const j = this.p(this.pg.client.json(this.payload as never));
        const sets = cols.map((c) => `"${c}" = (select r."${c}" from jsonb_populate_record(null::account_invitations, ${j}::jsonb) r)`).join(", ");
        sql = `update account_invitations as t set ${sets}${this.conds.length ? ` where ${this.conds.join(" and ")}` : ""} returning to_jsonb(t.*) as r`;
      } else {
        sql = `select to_jsonb(t.*) as r from account_invitations as t${this.conds.length ? ` where ${this.conds.join(" and ")}` : ""}`;
      }
      const rows = (await this.pg.client.unsafe(sql, this.params as never[])) as unknown as any[];
      const data = rows.map((x) => x.r);
      if (this.mode === "single") return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: `${data.length} rows`, code: "PGRST116" } };
      if (this.mode === "maybe") return { data: data[0] ?? null, error: null };
      return { data, error: null };
    } catch (e: any) {
      return { data: null, error: { message: String(e?.message ?? e), code: e?.code } };
    }
  }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.run().then(ok, bad);
  }
}
