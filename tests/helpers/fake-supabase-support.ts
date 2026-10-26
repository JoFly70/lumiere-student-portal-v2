/**
 * In-memory fake of EXACTLY the Supabase builder subset documented in
 * docs/s08/S08-support-api-spec.md ("Supabase builder subset"):
 *
 *   from(table).select(cols?, { count: 'exact' }?) | insert(row|rows) | update(patch)
 *   filters: eq neq in is(col, null) gte lte ilike
 *   modifiers: order range limit single maybeSingle
 *   delete() with the same filters (cascades from support_tickets to its children);
 *   JSON text path filters such as eq('metadata->>idempotency_key', v)
 *   insert/update: optional .select(cols?) then optional .single()
 *   awaiting resolves { data, error, count? }
 *   storage.from(bucket): createSignedUploadUrl / createSignedUrl / list
 *
 * Any other method (upsert, or, not, textSearch, embedded resources
 * such as "ticket_comments(*)") is deliberately absent / rejected so a router
 * that leaves the documented subset fails loudly in tests.
 *
 * PostgREST semantics: .single() with 0 or >1 rows -> error code PGRST116;
 * .maybeSingle() with 0 rows -> data null (>1 rows -> PGRST116).
 * Synthetic data only.
 */
import { randomUUID } from "node:crypto";

export type Row = Record<string, any>;
export interface FakeError { message: string; code: string; details?: string | null; hint?: string | null }
export interface FakeResult { data: any; error: FakeError | null; count?: number | null }

export const SUPPORT_TABLES = ["support_tickets", "ticket_comments", "ticket_attachments", "ticket_status_history"] as const;
/** Tables the support router may touch: the four support tables plus users (read only). */
export const ALLOWED_SUPPORT_TOUCHES: readonly string[] = [...SUPPORT_TABLES, "users"];

const COLUMNS: Record<string, readonly string[]> = {
  support_tickets: [
    "id", "ticket_number", "reporter_id", "reporter_name", "reporter_email", "subject", "description", "category",
    "priority", "status", "assigned_to", "assigned_at", "resolved_at", "resolved_by", "resolution_notes", "tags",
    "metadata", "created_at", "updated_at",
  ],
  ticket_comments: ["id", "ticket_id", "author_id", "author_name", "author_role", "content", "is_internal", "created_at", "updated_at"],
  ticket_attachments: ["id", "ticket_id", "comment_id", "file_name", "file_size", "file_type", "storage_path", "uploaded_by", "created_at"],
  ticket_status_history: ["id", "ticket_id", "old_status", "new_status", "changed_by", "change_reason", "created_at"],
};
const ENUMS: Record<string, Record<string, readonly string[]>> = {
  support_tickets: {
    status: ["open", "in_progress", "waiting_on_student", "resolved", "closed"],
    priority: ["low", "medium", "high", "urgent"],
    category: ["academic", "technical", "billing", "document", "enrollment", "general"],
  },
  ticket_status_history: {
    old_status: ["open", "in_progress", "waiting_on_student", "resolved", "closed"],
    new_status: ["open", "in_progress", "waiting_on_student", "resolved", "closed"],
  },
};
const NOT_NULL: Record<string, readonly string[]> = {
  support_tickets: ["reporter_id", "reporter_name", "reporter_email", "subject", "description"],
  ticket_comments: ["ticket_id", "author_id", "author_name", "author_role", "content"],
  ticket_attachments: ["ticket_id", "file_name", "file_size", "file_type", "storage_path", "uploaded_by"],
  ticket_status_history: ["ticket_id", "new_status", "changed_by"],
};

export type OpKind = "select" | "insert" | "update" | "delete";
export interface RecordedOp {
  table: string;
  op: OpKind;
  filters: { kind: string; column: string; value: unknown }[];
  /** Rows returned / affected. */
  rows: number;
  error: FakeError | null;
  /** The payload of insert/update (deep-cloned). */
  payload?: unknown;
}
export interface StorageCall { bucket: string; method: string; path: string; error: boolean }

export interface FakeFailure {
  table: string;
  /** Omit to fail every op on the table. */
  op?: OpKind;
  error: FakeError;
  /** Fail only this many times, then recover. Omit for always. */
  times?: number;
}

export const missingRelationError = (table: string): FakeError => ({
  message: `relation "public.${table}" does not exist`,
  code: "42P01",
  details: null,
  hint: null,
});

export interface FakeClock { now(): Date; set(iso: string | Date): void; advance(ms: number): void }
export function createFakeClock(startIso = "2026-10-26T12:00:00.000Z"): FakeClock {
  let t = new Date(startIso).getTime();
  return {
    now: () => new Date(t),
    set: (v) => { t = new Date(v).getTime(); },
    advance: (ms) => { t += ms; },
  };
}

export interface FakeSupabaseOptions {
  clock?: FakeClock;
  /** First numeric part of generated ticket numbers (LUM-<n>). Default 10001. */
  firstTicketNumber?: number;
}

export function createFakeSupportSupabase(options: FakeSupabaseOptions = {}) {
  const clock = options.clock ?? createFakeClock();
  const tables: Record<string, Row[]> = {
    support_tickets: [], ticket_comments: [], ticket_attachments: [], ticket_status_history: [], users: [],
  };
  const ops: RecordedOp[] = [];
  const storageCalls: StorageCall[] = [];
  const failures: FakeFailure[] = [];
  const missing = new Set<string>();
  const objects = new Set<string>();
  const storageFail: { error: { message: string } | null } = { error: null };
  let nextTicketNo = options.firstTicketNumber ?? 10001;
  let sequence = 0;

  const clone = <T,>(v: T): T => (v === undefined ? v : (structuredClone(v) as T));
  const tableRows = (t: string): Row[] => (tables[t] ??= []);

  /** PostgREST JSON text path filter, e.g. "metadata->>idempotency_key": base column + key. */
  const baseColumn = (c: string): string => c.split("->")[0];
  function columnValue(row: Row, column: string): any {
    const m = /^([a-z_]+)->>([A-Za-z0-9_]+)$/.exec(column);
    if (!m) return row[column];
    const v = row[m[1]]?.[m[2]];
    return v === undefined || v === null ? undefined : String(v);
  }

  function colsOk(table: string, cols: string[]): FakeError | null {
    const known = COLUMNS[table];
    if (!known) return null; // users and others: permissive
    const bad = cols.map(baseColumn).find((c) => !known.includes(c));
    return bad ? { message: `column ${table}.${bad} does not exist`, code: "42703" } : null;
  }

  function injected(table: string, op: OpKind): FakeError | null {
    if (missing.has(table)) return missingRelationError(table);
    const f = failures.find((x) => x.table === table && (!x.op || x.op === op) && (x.times === undefined || x.times > 0));
    if (!f) return null;
    if (f.times !== undefined) f.times -= 1;
    return f.error;
  }

  function ilikeToRegex(pattern: string): RegExp {
    const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
    return new RegExp(`^${esc}$`, "i");
  }

  function cmp(a: any, b: any): number {
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    return a < b ? -1 : 1;
  }

  type Filter = { kind: "eq" | "neq" | "in" | "is" | "gte" | "lte" | "ilike"; column: string; value: any };
  function matches(row: Row, f: Filter): boolean {
    const v = columnValue(row, f.column);
    switch (f.kind) {
      case "eq": return v === f.value;
      case "neq": return v !== f.value && v !== undefined;
      case "in": return (f.value as unknown[]).includes(v);
      case "is": return f.value === null ? v === null || v === undefined : v === f.value;
      case "gte": return v !== null && v !== undefined && cmp(v, f.value) >= 0;
      case "lte": return v !== null && v !== undefined && cmp(v, f.value) <= 0;
      case "ilike": return typeof v === "string" && ilikeToRegex(String(f.value)).test(v);
    }
  }

  function validateRow(table: string, row: Row): FakeError | null {
    const badCol = colsOk(table, Object.keys(row));
    if (badCol) return badCol;
    for (const [col, allowed] of Object.entries(ENUMS[table] ?? {})) {
      const v = row[col];
      if (v !== undefined && v !== null && !allowed.includes(v)) {
        return { message: `invalid input value for enum ${col}: "${v}"`, code: "22P02" };
      }
    }
    for (const col of NOT_NULL[table] ?? []) {
      if (row[col] === undefined || row[col] === null) {
        return { message: `null value in column "${col}" of relation "${table}" violates not-null constraint`, code: "23502" };
      }
    }
    if (table === "ticket_attachments") {
      if (!(row.file_size > 0 && row.file_size <= 10 * 1024 * 1024)) {
        return { message: 'new row violates check constraint "valid_file_size"', code: "23514" };
      }
    }
    return null;
  }

  function applyInsertDefaults(table: string, input: Row): Row {
    const now = clock.now().toISOString();
    const row: Row = { ...clone(input) };
    row.id ??= randomUUID();
    if (table === "support_tickets") {
      row.ticket_number ??= `LUM-${nextTicketNo++}`;
      row.category ??= "general";
      row.priority ??= "medium";
      row.status ??= "open";
      row.assigned_to ??= null;
      row.assigned_at ??= null;
      row.resolved_at ??= null;
      row.resolved_by ??= null;
      row.resolution_notes ??= null;
      row.tags ??= [];
      row.metadata ??= {};
      row.created_at ??= now;
      row.updated_at ??= now;
    } else if (table === "ticket_comments") {
      row.is_internal ??= false;
      row.created_at ??= now;
      row.updated_at ??= now;
    } else if (table === "ticket_attachments") {
      row.comment_id ??= null;
      row.created_at ??= now;
    } else if (table === "ticket_status_history") {
      row.old_status ??= null;
      row.change_reason ??= null;
      row.created_at ??= now;
    }
    // Deterministic tie-break for same-millisecond rows.
    Object.defineProperty(row, "__seq", { value: sequence++, enumerable: false });
    return row;
  }

  function project(row: Row, cols: string | undefined): Row {
    if (!cols || cols.trim() === "*") return clone(row);
    const out: Row = {};
    for (const c of cols.split(",").map((s) => s.trim()).filter(Boolean)) out[c] = clone(row[c]);
    return out;
  }

  class Query implements PromiseLike<FakeResult> {
    private op: OpKind = "select";
    private payload: Row | Row[] | undefined;
    private filters: Filter[] = [];
    private orders: { column: string; ascending: boolean }[] = [];
    private from_: number | null = null;
    private to_: number | null = null;
    private limit_: number | null = null;
    private cols: string | undefined = "*";
    private wantCount = false;
    private returning = false;
    private mode: "many" | "single" | "maybe" = "many";

    constructor(private table: string) {}

    select(cols?: string, opts?: { count?: "exact" }) {
      if (cols && /[()]/.test(cols)) {
        // Embedded resources are outside the documented subset.
        this.cols = cols;
        (this as any).__embedded = true;
      } else {
        this.cols = cols ?? "*";
      }
      if (this.op === "select") this.wantCount = opts?.count === "exact";
      else this.returning = true;
      return this;
    }
    insert(row: Row | Row[]) { this.op = "insert"; this.payload = row; return this; }
    update(patch: Row) { this.op = "update"; this.payload = patch; return this; }
    delete() { this.op = "delete"; return this; }
    eq(column: string, value: unknown) { this.filters.push({ kind: "eq", column, value }); return this; }
    neq(column: string, value: unknown) { this.filters.push({ kind: "neq", column, value }); return this; }
    in(column: string, value: unknown[]) { this.filters.push({ kind: "in", column, value }); return this; }
    is(column: string, value: null) { this.filters.push({ kind: "is", column, value }); return this; }
    gte(column: string, value: unknown) { this.filters.push({ kind: "gte", column, value }); return this; }
    lte(column: string, value: unknown) { this.filters.push({ kind: "lte", column, value }); return this; }
    ilike(column: string, value: string) { this.filters.push({ kind: "ilike", column, value }); return this; }
    order(column: string, opts?: { ascending?: boolean }) { this.orders.push({ column, ascending: opts?.ascending !== false }); return this; }
    range(from: number, to: number) { this.from_ = from; this.to_ = to; return this; }
    limit(n: number) { this.limit_ = n; return this; }
    single() { this.mode = "single"; if (this.op !== "select") this.returning = true; return this; }
    maybeSingle() { this.mode = "maybe"; if (this.op !== "select") this.returning = true; return this; }

    then<R1 = FakeResult, R2 = never>(
      onfulfilled?: ((value: FakeResult) => R1 | PromiseLike<R1>) | null,
      onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
    ): Promise<R1 | R2> {
      return Promise.resolve().then(() => this.execute()).then(onfulfilled, onrejected);
    }

    private record(rows: number, error: FakeError | null): void {
      ops.push({
        table: this.table, op: this.op, rows, error,
        filters: this.filters.map((f) => ({ kind: f.kind, column: f.column, value: clone(f.value) })),
        payload: this.payload === undefined ? undefined : clone(this.payload),
      });
    }

    private fail(error: FakeError): FakeResult {
      this.record(0, error);
      return { data: null, error, ...(this.wantCount ? { count: null } : {}) };
    }

    private shape(rows: Row[], count: number | null): FakeResult {
      if (this.mode === "many") {
        const out: FakeResult = { data: rows, error: null };
        if (this.wantCount) out.count = count;
        return out;
      }
      if (rows.length === 1) return { data: rows[0], error: null, ...(this.wantCount ? { count } : {}) };
      if (rows.length === 0 && this.mode === "maybe") return { data: null, error: null };
      return {
        data: null,
        error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116", details: `The result contains ${rows.length} rows`, hint: null },
      };
    }

    private execute(): FakeResult {
      if ((this as any).__embedded) {
        return this.fail({ message: "embedded resources are not supported by the S08 builder subset", code: "PGRST200" });
      }
      const pre = injected(this.table, this.op);
      if (pre) return this.fail(pre);

      const known = COLUMNS[this.table];
      const filterCols = this.filters.map((f) => f.column).concat(this.orders.map((o) => o.column));
      const badFilter = colsOk(this.table, filterCols);
      if (badFilter) return this.fail(badFilter);
      if (this.cols && this.cols.trim() !== "*") {
        const bad = colsOk(this.table, this.cols.split(",").map((s) => s.trim()).filter(Boolean));
        if (bad) return this.fail(bad);
      }
      void known;

      const store = tableRows(this.table);

      if (this.op === "insert") {
        const inputs = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
        const created: Row[] = [];
        for (const input of inputs) {
          const row = applyInsertDefaults(this.table, input);
          const err = validateRow(this.table, row);
          if (err) return this.fail(err);
          created.push(row);
        }
        if (this.table === "support_tickets") {
          for (const row of created) {
            if (store.some((r) => r.ticket_number === row.ticket_number)) {
              return this.fail({ message: "duplicate key value violates unique constraint", code: "23505" });
            }
          }
        }
        store.push(...created);
        this.record(created.length, null);
        if (!this.returning) return { data: null, error: null };
        return this.shape(created.map((r) => project(r, this.cols)), null);
      }

      let matched = store.filter((r) => this.filters.every((f) => matches(r, f)));

      if (this.op === "update") {
        const patch = this.payload as Row;
        const probe = { ...(matched[0] ?? {}), ...patch };
        const err = matched.length ? validateRow(this.table, probe) : colsOk(this.table, Object.keys(patch));
        if (err) return this.fail(err);
        for (const r of matched) {
          Object.assign(r, clone(patch));
          if (COLUMNS[this.table]?.includes("updated_at") && !("updated_at" in patch)) r.updated_at = clock.now().toISOString();
        }
        this.record(matched.length, null);
        if (!this.returning) return { data: null, error: null };
        return this.shape(matched.map((r) => project(r, this.cols)), null);
      }

      if (this.op === "delete") {
        const doomed = new Set(matched);
        const remaining = store.filter((r) => !doomed.has(r));
        store.length = 0;
        store.push(...remaining);
        // ON DELETE CASCADE from the ticket to its children (schema FKs).
        if (this.table === "support_tickets") {
          const ids = new Set(matched.map((r) => r.id));
          for (const child of ["ticket_comments", "ticket_attachments", "ticket_status_history"]) {
            const rows = tableRows(child);
            const keep = rows.filter((r) => !ids.has(r.ticket_id));
            rows.length = 0;
            rows.push(...keep);
          }
        }
        this.record(matched.length, null);
        return { data: null, error: null };
      }

      // select
      for (const o of [...this.orders].reverse()) {
        matched = [...matched].sort((a, b) => {
          const c = cmp(a[o.column], b[o.column]);
          if (c !== 0) return o.ascending ? c : -c;
          const sa = (a as any).__seq ?? 0;
          const sb = (b as any).__seq ?? 0;
          return o.ascending ? sa - sb : sb - sa;
        });
      }
      const count = matched.length;
      if (this.from_ !== null && this.to_ !== null) matched = matched.slice(this.from_, this.to_ + 1);
      if (this.limit_ !== null) matched = matched.slice(0, this.limit_);
      this.record(matched.length, null);
      return this.shape(matched.map((r) => project(r, this.cols)), this.wantCount ? count : null);
    }
  }

  const client = {
    from(table: string) {
      return {
        select: (cols?: string, opts?: { count?: "exact" }) => new Query(table).select(cols, opts),
        insert: (row: Row | Row[]) => new Query(table).insert(row),
        update: (patch: Row) => new Query(table).update(patch),
        delete: () => new Query(table).delete(),
      };
    },
    storage: {
      from(bucket: string) {
        const call = async <T,>(method: string, path: string, ok: () => T) => {
          if (storageFail.error) {
            storageCalls.push({ bucket, method, path, error: true });
            return { data: null, error: { message: storageFail.error.message } };
          }
          storageCalls.push({ bucket, method, path, error: false });
          return ok();
        };
        return {
          createSignedUploadUrl: (path: string) =>
            call("createSignedUploadUrl", path, () => ({
              data: { signedUrl: `https://storage.synthetic.invalid/upload/${bucket}/${path}?token=upload-token`, token: "upload-token", path },
              error: null,
            })),
          createSignedUrl: (path: string, seconds: number) =>
            call("createSignedUrl", path, () => ({
              data: { signedUrl: `https://storage.synthetic.invalid/object/sign/${bucket}/${path}?token=download-token&expires=${seconds}` },
              error: null,
            })),
          list: (folder: string, opts?: { search?: string }) =>
            call("list", folder, () => {
              const prefix = folder.replace(/\/+$/, "") + "/";
              const names = [...objects]
                .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
                .map((p) => p.slice(prefix.length))
                .filter((n) => !opts?.search || n.includes(opts.search));
              return { data: names.map((name) => ({ name })), error: null };
            }),
        };
      },
    },
  };

  return {
    /** Hand this to the router as `supabase`. */
    client,
    clock,
    tables,
    ops,
    storageCalls,

    // seeding
    seedUser(row: { id: string; email: string; name: string; role: string }): Row {
      tables.users.push({ ...row });
      return row;
    },
    /** Inserts a row with the same defaults as the database (bypasses recording). */
    seed(table: string, row: Row): Row {
      const r = applyInsertDefaults(table, row);
      tableRows(table).push(r);
      return r;
    },

    // storage simulation
    addStorageObject(path: string) { objects.add(path); },
    removeStorageObject(path: string) { objects.delete(path); },
    hasStorageObject: (path: string) => objects.has(path),
    failStorage(message = "storage backend unavailable") { storageFail.error = { message }; },
    recoverStorage() { storageFail.error = null; },

    // failure injection
    failTable(table: string, error: FakeError, op?: OpKind, times?: number) { failures.push({ table, error, op, times }); },
    /** Simulates a table that does not exist: every op returns 42P01. */
    missingTable(table: string) { missing.add(table); },
    restoreTable(table: string) { missing.delete(table); },
    clearFailures() { failures.length = 0; missing.clear(); },

    // inspection
    touchedTables(): Set<string> { return new Set(ops.map((o) => o.table)); },
    opsOn(table: string, op?: OpKind) { return ops.filter((o) => o.table === table && (!op || o.op === op)); },
    /** Tables that received a write (insert/update). */
    writtenTables(): Set<string> { return new Set(ops.filter((o) => o.op !== "select").map((o) => o.table)); },
    rows: (table: string) => tableRows(table),
    resetOps() { ops.length = 0; storageCalls.length = 0; },
  };
}

export type FakeSupportSupabase = ReturnType<typeof createFakeSupportSupabase>;
