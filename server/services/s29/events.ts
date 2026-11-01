/**
 * S29 — portal events -> Notification Center.
 *
 * Existing workflows (support replies, document decisions, roadmap publication, orientation sessions, calendar
 * changes) call emitStudentEvent() AFTER their own write succeeded. It is fire-and-forget and never fails the
 * caller: when the S29 schema is not applied yet it returns "unavailable" and the caller may fall back to its
 * previous behaviour (the support desk keeps its direct email in that case).
 * Each event carries a deterministic dedupe key, so a retried request never produces a second notification.
 */
import { logger } from "../../lib/logger";
import { errorCode, s29Schema, type SqlExecutor } from "./db";
import { enqueue, loadStudentRecipient } from "./outbox";
import { loadSettings } from "./attention-store";
import { formatDate } from "./templates";

export interface StudentEvent {
  readonly studentId: string;
  readonly template: string;
  readonly dedupeKey: string;
  readonly params?: Readonly<Record<string, string | number | null>>;
  /** ISO instant rendered as whenEn / whenFr in the student's zone. */
  readonly when?: string | null;
}

export type EmitOutcome = "queued" | "duplicate" | "unavailable" | "no_account" | "error";

async function defaultDb(): Promise<SqlExecutor> {
  const { db } = await import("../../lib/db");
  return db as unknown as SqlExecutor;
}

export async function emitStudentEvent(ev: StudentEvent, deps: { db?: SqlExecutor; now?: Date } = {}): Promise<EmitOutcome> {
  try {
    if (!process.env.DATABASE_URL && !deps.db) return "unavailable";
    const db = deps.db ?? (await defaultDb());
    if (!(await s29Schema(db)).present) return "unavailable";
    const rec = await loadStudentRecipient(db, ev.studentId);
    if (!rec || !rec.userId) return "no_account";
    const settings = await loadSettings(db);
    const tz = rec.timeZone ?? "UTC";
    const params: Record<string, string | number | null> = { ...(ev.params ?? {}) };
    if (ev.when) { params.whenEn = formatDate(ev.when, "en", tz, true); params.whenFr = formatDate(ev.when, "fr", tz, true); }
    const res = await enqueue(db, { dedupeKey: ev.dedupeKey, audience: "student", template: ev.template, source: "event", params, student: rec, defaultLanguage: settings.defaultLanguage, now: deps.now });
    return res.created ? "queued" : "duplicate";
  } catch (error) {
    logger.warn("S29 event enqueue failed", { template: ev.template, code: errorCode(error) });
    return "error";
  }
}

/** Fire-and-forget wrapper for request handlers. */
export function emitStudentEventSoon(ev: StudentEvent): void {
  void emitStudentEvent(ev).catch(() => undefined);
}

/** Look up the student behind a support-ticket email (support notifier only knows the address). */
export async function studentIdForEmail(email: string, deps: { db?: SqlExecutor } = {}): Promise<string | null> {
  try {
    const db = deps.db ?? (await defaultDb());
    const { sql } = await import("drizzle-orm");
    const r = Array.from((await db.execute(sql`SELECT s.id FROM students s LEFT JOIN users u ON u.id = s.user_id WHERE lower(COALESCE(u.email, s.email)) = lower(${email}) ORDER BY s.created_at LIMIT 1`)) as Array<{ id: string }>)[0];
    return r ? String(r.id) : null;
  } catch {
    return null;
  }
}
