/**
 * S30 operational layer: the ONE store for academic/operational events, exception state, in-app notifications and
 * background-run heartbeats (tables in supabase/migrations/20261106100000_s30_operations_academic.sql).
 *
 * - Events: append-only; `dedupeKey` makes emitters idempotent (ON CONFLICT DO NOTHING). Data holds identifiers, keys
 *   and counts only, never free-text record bodies.
 * - Exceptions: derived by the Control Center (server/services/program-journey/control-center.ts); this module only
 *   stores the owner's acknowledgement/snooze per exception id and merges it in.
 * - Notifications: one row per (recipient, dedupeKey). Email goes through the existing deliverEmail (Resend) only when
 *   the app transport is configured; the row records what actually happened.
 * Every function degrades: when the S30 tables are not applied, reads return empty results (isMissingTable) so
 * existing pages keep working.
 */
import { sql } from "drizzle-orm";
import { isDemoPreferredName } from "@shared/synthetic-accounts";
import type { ControlCenterView } from "@shared/s27-contract";
import type {
  ExceptionState,
  NotificationKind,
  NotificationView,
  NotificationsView,
  OpsEventKind,
  OpsEventView,
  OpsExceptionView,
  OpsExceptionsView,
  OpsSeverity,
} from "@shared/s30-contract";
import { logger } from "../../lib/logger";

export interface SqlExecutor { execute(query: ReturnType<typeof sql>): PromiseLike<unknown> }
export type TxDb = SqlExecutor & { transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> };
type Row = Record<string, unknown>;
export const rows = (r: unknown): Row[] => Array.from((r ?? []) as Row[]);
export const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
export const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** True for "relation does not exist" (S30 migration not applied yet), looking through wrapped causes. */
export function isMissingTable(error: unknown): boolean {
  for (let e: any = error, i = 0; e && i < 4; e = e.cause, i++) if (e.code === "42P01" || e.code === "42704") return true;
  return false;
}

export class OpsError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); this.name = "OpsError"; }
}

// ── events ───────────────────────────────────────────────────────────────────

export interface RecordEventInput {
  readonly kind: OpsEventKind;
  readonly studentId?: string | null;
  readonly subjectType?: string | null;
  readonly subjectId?: string | null;
  readonly severity?: OpsSeverity;
  readonly data?: Readonly<Record<string, string | number | boolean | null>>;
  readonly dedupeKey?: string | null;
  readonly actorId?: string | null;
}

/** Inserts one event; returns false when the dedupe key already exists. Never throws for a missing table. */
export async function recordEvent(db: SqlExecutor, e: RecordEventInput): Promise<boolean> {
  try {
    const out = rows(await db.execute(sql`INSERT INTO ops_events (kind, student_id, subject_type, subject_id, severity, data, dedupe_key, actor_id)
      VALUES (${e.kind}, ${e.studentId ?? null}, ${e.subjectType ?? null}, ${e.subjectId ?? null}, ${e.severity ?? "info"}, ${JSON.stringify(e.data ?? {})}::jsonb,
              ${e.dedupeKey ?? null}, ${e.actorId ?? null})
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id`));
    return out.length > 0;
  } catch (error) {
    if (isMissingTable(error)) return false;
    throw error;
  }
}

/** Fire-and-forget variant for request paths: an event failure never fails the user's action. */
export function emitEvent(db: SqlExecutor, e: RecordEventInput): void {
  void recordEvent(db, e).catch((error: unknown) => logger.warn("Ops event emit failed", { kind: e.kind, code: (error as { code?: string })?.code }));
}

const studentHref = (id: string, tab = "overview") => `/admin/students/${encodeURIComponent(id)}?tab=${tab}`;
function eventHref(kind: string, studentId: string | null, subjectType: string | null, subjectId: string | null): string | null {
  if (subjectType === "import_batch" && subjectId) return `/admin/imports?batch=${encodeURIComponent(subjectId)}`;
  if (kind.startsWith("calendar.")) return "/admin/calendar";
  if (studentId) return studentHref(studentId, kind.startsWith("program.session") ? "sessions" : kind.startsWith("academic.") ? "roadmap" : "overview");
  return null;
}

export async function listEvents(db: SqlExecutor, opts: { limit?: number; studentId?: string | null; beforeSeq?: number | null } = {}): Promise<OpsEventView[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  try {
    const list = rows(await db.execute(sql`SELECT e.id, e.seq, e.kind, e.severity, e.student_id, e.subject_type, e.subject_id, e.data, e.created_at,
        s.first_name, s.last_name, s.preferred_name
      FROM ops_events e LEFT JOIN students s ON s.id = e.student_id
      WHERE (${opts.studentId ?? null}::text IS NULL OR e.student_id = ${opts.studentId ?? null})
        AND (${opts.beforeSeq ?? null}::bigint IS NULL OR e.seq < ${opts.beforeSeq ?? null})
      ORDER BY e.seq DESC LIMIT ${limit}`));
    return list.map((r) => {
      const studentId = str(r.student_id);
      return {
        id: String(r.id), seq: Number(r.seq), kind: r.kind as OpsEventKind, severity: r.severity as OpsSeverity, studentId,
        studentName: studentId ? `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || null : null,
        isDemo: isDemoPreferredName(str(r.preferred_name)),
        subjectType: str(r.subject_type), subjectId: str(r.subject_id), data: (r.data as OpsEventView["data"]) ?? {},
        href: eventHref(String(r.kind), studentId, str(r.subject_type), str(r.subject_id)), createdAt: iso(r.created_at),
      };
    });
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

// ── exceptions ───────────────────────────────────────────────────────────────

export async function loadExceptionStates(db: SqlExecutor): Promise<Map<string, { state: ExceptionState; snoozedUntil: string | null }>> {
  try {
    const list = rows(await db.execute(sql`SELECT exception_id, state, snoozed_until FROM ops_exception_states ORDER BY exception_id LIMIT 5000`));
    return new Map(list.map((r) => [String(r.exception_id), { state: r.state as ExceptionState, snoozedUntil: r.snoozed_until ? iso(r.snoozed_until) : null }]));
  } catch (error) {
    if (isMissingTable(error)) return new Map();
    throw error;
  }
}

/** Pure merge: Control Center queue + stored owner state. An expired snooze is open again. */
export function mergeExceptions(cc: ControlCenterView, states: ReadonlyMap<string, { state: ExceptionState; snoozedUntil: string | null }>, now: Date): OpsExceptionsView {
  const out: OpsExceptionView[] = cc.queue.map((q) => {
    const s = states.get(q.id);
    if (!s) return { ...q, state: "open", snoozedUntil: null };
    if (s.state === "snoozed" && (!s.snoozedUntil || Date.parse(s.snoozedUntil) <= now.getTime())) return { ...q, state: "open", snoozedUntil: null };
    return { ...q, state: s.state, snoozedUntil: s.snoozedUntil };
  });
  const counts = { open: 0, acknowledged: 0, snoozed: 0 };
  for (const e of out) counts[e.state] += 1;
  return { generatedAt: now.toISOString(), truncated: cc.truncated, exceptions: out, counts };
}

export async function setExceptionState(db: SqlExecutor, exceptionId: string, state: ExceptionState, snoozeDays: number | undefined, actorId: string, now: Date): Promise<void> {
  if (state === "open") {
    await db.execute(sql`DELETE FROM ops_exception_states WHERE exception_id = ${exceptionId}`);
  } else {
    const until = state === "snoozed" ? new Date(now.getTime() + (snoozeDays ?? 1) * 86_400_000).toISOString() : null;
    await db.execute(sql`INSERT INTO ops_exception_states (exception_id, state, snoozed_until, updated_by, updated_at)
      VALUES (${exceptionId}, ${state}, ${until}::timestamptz, ${actorId}, now())
      ON CONFLICT (exception_id) DO UPDATE SET state = EXCLUDED.state, snoozed_until = EXCLUDED.snoozed_until, updated_by = EXCLUDED.updated_by, updated_at = now()`);
  }
  const studentId = exceptionId.split(":")[1] ?? null;
  await recordEvent(db, {
    kind: state === "open" ? "ops.exception_reopened" : state === "snoozed" ? "ops.exception_snoozed" : "ops.exception_acknowledged",
    studentId: studentId && (await studentExists(db, studentId)) ? studentId : null,
    subjectType: "exception", subjectId: exceptionId.slice(0, 128), data: { exceptionKind: exceptionId.split(":")[0] ?? null, snoozeDays: snoozeDays ?? null }, actorId,
  });
}

async function studentExists(db: SqlExecutor, id: string): Promise<boolean> {
  return rows(await db.execute(sql`SELECT 1 AS ok FROM students WHERE id = ${id} LIMIT 1`)).length > 0;
}

// ── notifications ────────────────────────────────────────────────────────────

export interface NotifyInput {
  readonly recipientUserId: string;
  readonly kind: NotificationKind;
  readonly params: Readonly<Record<string, string | number | null>>;
  readonly href: string | null;
  readonly dedupeKey: string;
}
export interface EmailSender {
  /** Returns what happened; the sender looks up address and language itself and never throws. */
  (recipientUserId: string, kind: NotificationKind, params: Readonly<Record<string, string | number | null>>, href: string | null): Promise<"sent" | "not_configured" | "failed" | "skipped">;
}

/** Creates the notification once per (recipient, dedupeKey). Returns the new id, or null when it already existed. */
export async function notify(db: SqlExecutor, n: NotifyInput, email?: EmailSender): Promise<string | null> {
  let id: string | null = null;
  try {
    const out = rows(await db.execute(sql`INSERT INTO ops_notifications (recipient_user_id, kind, params, href, dedupe_key, email_status)
      VALUES (${n.recipientUserId}, ${n.kind}, ${JSON.stringify(n.params)}::jsonb, ${n.href}, ${n.dedupeKey}, ${email ? "skipped" : "not_requested"})
      ON CONFLICT (recipient_user_id, dedupe_key) DO NOTHING RETURNING id`));
    id = out[0] ? String(out[0].id) : null;
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  if (id && email) {
    const status = await email(n.recipientUserId, n.kind, n.params, n.href).catch(() => "failed" as const);
    await db.execute(sql`UPDATE ops_notifications SET email_status = ${status} WHERE id = ${id}::uuid`);
  }
  return id;
}

export async function listNotifications(db: SqlExecutor, userId: string, limit = 30): Promise<NotificationsView> {
  try {
    const list = rows(await db.execute(sql`SELECT id, kind, params, href, read_at, created_at FROM ops_notifications WHERE recipient_user_id = ${userId}
      ORDER BY created_at DESC, id LIMIT ${Math.min(Math.max(limit, 1), 100)}`));
    const [u] = rows(await db.execute(sql`SELECT count(*)::int AS n FROM ops_notifications WHERE recipient_user_id = ${userId} AND read_at IS NULL`));
    return {
      notifications: list.map((r): NotificationView => ({
        id: String(r.id), kind: r.kind as NotificationKind, params: (r.params as NotificationView["params"]) ?? {}, href: str(r.href),
        readAt: r.read_at ? iso(r.read_at) : null, createdAt: iso(r.created_at),
      })),
      unread: Number(u?.n ?? 0),
    };
  } catch (error) {
    if (isMissingTable(error)) return { notifications: [], unread: 0 };
    throw error;
  }
}

/** Marks one of the user's own notifications read (another user's id simply matches nothing). */
export async function markNotificationRead(db: SqlExecutor, userId: string, id: string | null): Promise<number> {
  const out = rows(await db.execute(id
    ? sql`UPDATE ops_notifications SET read_at = now() WHERE recipient_user_id = ${userId} AND id = ${id}::uuid AND read_at IS NULL RETURNING id`
    : sql`UPDATE ops_notifications SET read_at = now() WHERE recipient_user_id = ${userId} AND read_at IS NULL RETURNING id`));
  return out.length;
}

/** User ids of active administrators (notification recipients for owner-level events). */
export async function adminUserIds(db: SqlExecutor): Promise<string[]> {
  return rows(await db.execute(sql`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 20`)).map((r) => String(r.id));
}

// ── background-run heartbeat ─────────────────────────────────────────────────

export async function runStarted(db: SqlExecutor, name: string): Promise<void> {
  await db.execute(sql`INSERT INTO ops_runs (name, last_started_at, last_status) VALUES (${name}, now(), 'running')
    ON CONFLICT (name) DO UPDATE SET last_started_at = now(), last_status = 'running'`);
}
export async function runFinished(db: SqlExecutor, name: string, status: "ok" | "error", detail: Record<string, string | number | boolean | null>): Promise<void> {
  await db.execute(sql`UPDATE ops_runs SET last_finished_at = now(), last_status = ${status}, detail = ${JSON.stringify(detail)}::jsonb WHERE name = ${name}`);
}
export async function readRun(db: SqlExecutor, name: string): Promise<{ startedAt: string | null; finishedAt: string | null; status: string | null; detail: Record<string, unknown> } | null> {
  try {
    const [r] = rows(await db.execute(sql`SELECT last_started_at, last_finished_at, last_status, detail FROM ops_runs WHERE name = ${name}`));
    return r ? { startedAt: r.last_started_at ? iso(r.last_started_at) : null, finishedAt: r.last_finished_at ? iso(r.last_finished_at) : null, status: str(r.last_status), detail: (r.detail as Record<string, unknown>) ?? {} } : null;
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}
