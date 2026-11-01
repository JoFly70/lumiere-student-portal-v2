/**
 * S29 — database helpers shared by the intelligence & operations services.
 *
 * Every S29 service takes an injected SqlExecutor (the same shape as the S27 services) so the rules stay testable
 * against the real-Postgres harness, and production wiring uses server/lib/db.ts (a lazily created pool).
 */
import { sql } from "drizzle-orm";
import type { SqlExecutor } from "../program-journey/service";

export type { SqlExecutor };
export type Tx = SqlExecutor & { transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> };

export type Row = Record<string, unknown>;
export const rows = (r: unknown): Row[] => Array.from((r ?? []) as Row[]);
export const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
export const isoReq = (v: unknown): string => iso(v) ?? new Date(0).toISOString();
export const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
export const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

export const S29_TABLES = [
  "s29_settings", "s29_notification_preferences", "s29_attention_items", "s29_notifications", "s29_jobs",
  "s29_incidents", "s29_calendar_events", "s29_calendar_tokens", "s29_import_templates", "s29_import_batches", "s29_academic_records",
] as const;

/** Postgres SQLSTATE / driver codes meaning "the store or its schema is not there" (migration not applied yet). */
const INFRA_CODES = new Set(["42P01", "42703", "3D000", "57P01", "57P03", "53300", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_DESTROYED"]);
export function isInfraError(error: unknown): boolean {
  for (let e: any = error, i = 0; e && i < 4; e = e.cause, i++) {
    const code = typeof e.code === "string" ? e.code : "";
    if (INFRA_CODES.has(code) || code.startsWith("08")) return true;
  }
  return false;
}
/** Error code only — never the message (a wrapped query error carries its parameters). */
export function errorCode(error: unknown): string {
  for (let e: any = error, i = 0; e && i < 4; e = e.cause, i++) {
    if (typeof e.code === "string" && e.code) return e.code;
  }
  return error instanceof Error ? error.name : typeof error;
}

let schemaCache: { at: number; present: boolean; missing: string[] } | null = null;
/** Whether every S29 table exists (cached 60 s; a missing schema is re-checked sooner). */
export async function s29Schema(db: SqlExecutor, nowMs = Date.now()): Promise<{ present: boolean; missing: string[] }> {
  if (schemaCache && nowMs - schemaCache.at < (schemaCache.present ? 60_000 : 15_000)) return schemaCache;
  const list = sql.join(S29_TABLES.map((t) => sql`${t}`), sql`, `);
  const found = new Set(rows(await db.execute(sql`SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN (${list})`)).map((r) => String(r.relname)));
  const missing = S29_TABLES.filter((t) => !found.has(t));
  schemaCache = { at: nowMs, present: missing.length === 0, missing };
  return schemaCache;
}
export function resetS29SchemaCache(): void { schemaCache = null; }

export class S29Error extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
