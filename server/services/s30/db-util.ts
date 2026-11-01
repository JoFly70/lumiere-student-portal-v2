/** S30 calendar: small SQL helpers shared by the calendar service and routes (no operational state of its own). */
import { sql } from "drizzle-orm";

export interface SqlExecutor { execute(query: ReturnType<typeof sql>): PromiseLike<unknown> }
export type TxDb = SqlExecutor & { transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> };
type Row = Record<string, unknown>;
export const rows = (r: unknown): Row[] => Array.from((r ?? []) as Row[]);
export const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
export const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** True for "relation does not exist" (migration not applied yet), looking through wrapped causes. */
export function isMissingTable(error: unknown): boolean {
  for (let e: any = error, i = 0; e && i < 4; e = e.cause, i++) if (e.code === "42P01" || e.code === "42704") return true;
  return false;
}

/** A request-level error with an HTTP status and a stable code (calendar and import routes). */
export class S30Error extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); this.name = "S30Error"; }
}
export { S30Error as CalendarError };
