/**
 * S29 — Notification Center: durable outbox + in-portal inbox (one row per notification in s29_notifications).
 *
 * enqueue()  idempotent on dedupe_key (INSERT ... ON CONFLICT DO NOTHING): the same event or reminder can be
 *            produced any number of times (restarts, retries, overlapping schedulers) and is stored once.
 *            The inbox copy is visible immediately; the email channel starts "queued" or is decided up front:
 *            suppressed (synthetic account, preference off, no address, frequency cap) or in_app_only.
 * deliverDue() claims due rows with FOR UPDATE SKIP LOCKED + a short lease, sends through the EXISTING
 *            deliverEmail() (Resend), and records exactly what happened: accepted / not_configured / attempted
 *            (retry with backoff) / failed (after MAX_ATTEMPTS). Never claims delivery it did not get.
 * Quiet hours: a reminder's email waits (next_attempt_at) until the recipient's quiet hours end, in their zone.
 */
import { sql } from "drizzle-orm";
import { isSyntheticAccount } from "@shared/synthetic-accounts";
import {
  DEFAULT_PREFERENCES, EMAIL_STATES, notificationPreferencesSchema,
  type EmailState, type InboxView, type NotificationCategory, type NotificationPreferences, type OutboxView,
} from "@shared/s29-contract";
import { deliverEmail, emailTransportConfigured, type EmailDelivery } from "../../lib/email";
import { logger } from "../../lib/logger";
import { emailHtml, renderTemplate, type Lang } from "./templates";
import { errorCode, iso, isoReq, rows, str, type SqlExecutor } from "./db";

export const MAX_ATTEMPTS = 5;
const LEASE_SECONDS = 120;
const DELIVERY_BATCH = 20;

export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.APP_URL || env.PUBLIC_APP_URL || "https://lumiere-student-portal-v-2.replit.app").replace(/\/+$/, "");
}

// ── preferences ──────────────────────────────────────────────────────────────

export async function loadPreferences(db: SqlExecutor, userId: string | null): Promise<NotificationPreferences> {
  if (!userId) return DEFAULT_PREFERENCES;
  const r = rows(await db.execute(sql`SELECT prefs FROM s29_notification_preferences WHERE user_id = ${userId}`))[0];
  if (!r) return DEFAULT_PREFERENCES;
  const p = r.prefs as Partial<NotificationPreferences>;
  const merged = { ...DEFAULT_PREFERENCES, ...p, email: { ...DEFAULT_PREFERENCES.email, ...(p.email ?? {}) }, quietHours: { ...DEFAULT_PREFERENCES.quietHours, ...(p.quietHours ?? {}) } };
  const parsed = notificationPreferencesSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_PREFERENCES;
}

export async function savePreferences(db: SqlExecutor, userId: string, prefs: NotificationPreferences): Promise<NotificationPreferences> {
  if (prefs.timeZone && !validTimeZone(prefs.timeZone)) throw Object.assign(new Error("Unknown time zone"), { code: "S29_VALIDATION_FAILED" });
  await db.execute(sql`INSERT INTO s29_notification_preferences (user_id, prefs, updated_at) VALUES (${userId}, ${JSON.stringify(prefs)}::jsonb, now())
                       ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now()`);
  return prefs;
}

export function validTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

/** Minutes since local midnight in `tz`. */
function localMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** When quiet hours are on and `at` falls inside them (in tz), the first instant after they end; otherwise `at`. */
export function afterQuietHours(at: Date, quiet: NotificationPreferences["quietHours"], tz: string): Date {
  if (!quiet.enabled) return at;
  const start = toMin(quiet.start);
  const end = toMin(quiet.end);
  if (start === end) return at;
  const now = localMinutes(at, tz);
  const inside = start < end ? now >= start && now < end : now >= start || now < end;
  if (!inside) return at;
  const wait = (end - now + 1440) % 1440;
  return new Date(at.getTime() + wait * 60_000 - (at.getUTCSeconds() * 1000 + at.getUTCMilliseconds()));
}

// ── recipients ───────────────────────────────────────────────────────────────

export interface StudentRecipient {
  readonly studentId: string;
  readonly userId: string | null;
  readonly email: string | null;
  readonly name: string;
  readonly preferredName: string | null;
  readonly timeZone: string | null;
  readonly language: Lang | null;
}

export async function loadStudentRecipient(db: SqlExecutor, studentId: string): Promise<StudentRecipient | null> {
  const r = rows(await db.execute(sql`SELECT s.id, s.user_id, s.first_name, s.preferred_name, s.timezone, COALESCE(u.email, s.email) AS email, l.language
      FROM students s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN user_language_preference l ON l.user_id = s.user_id WHERE s.id = ${studentId}`))[0];
  if (!r) return null;
  return {
    studentId: String(r.id), userId: str(r.user_id), email: str(r.email), name: String(r.first_name ?? ""), preferredName: str(r.preferred_name),
    timeZone: str(r.timezone), language: r.language === "en" || r.language === "fr" ? r.language : null,
  };
}

export function recipientIsSynthetic(r: Pick<StudentRecipient, "email" | "preferredName" | "name">): boolean {
  return isSyntheticAccount({ email: r.email, preferred_name: r.preferredName, first_name: r.name });
}

// ── enqueue ──────────────────────────────────────────────────────────────────

export interface EnqueueInput {
  readonly dedupeKey: string;
  readonly audience: "student" | "staff";
  readonly template: string;
  readonly source: string;
  readonly params: Readonly<Record<string, string | number | null | undefined>>;
  readonly student?: StudentRecipient | null;
  /** Staff audience: recipient user and address. */
  readonly staff?: { readonly userId: string; readonly email: string | null; readonly language: Lang } | null;
  readonly defaultLanguage?: Lang;
  /** Email decision forced by the caller (e.g. frequency cap) */
  readonly forceSuppress?: string | null;
  readonly now?: Date;
}

export interface EnqueueResult { readonly id: string | null; readonly created: boolean; readonly emailState: EmailState | null }

export async function enqueue(db: SqlExecutor, input: EnqueueInput): Promise<EnqueueResult> {
  const now = input.now ?? new Date();
  const lang: Lang = input.audience === "student" ? input.student?.language ?? input.defaultLanguage ?? "fr" : input.staff?.language ?? "en";
  const rendered = renderTemplate(input.template, lang, input.params);
  const recipientUserId = input.audience === "student" ? input.student?.userId ?? null : input.staff?.userId ?? null;
  const email = input.audience === "student" ? input.student?.email ?? null : input.staff?.email ?? null;
  const studentId = input.student?.studentId ?? null;
  const synthetic = input.student ? recipientIsSynthetic(input.student) : false;

  let state: EmailState = "queued";
  let suppressed: string | null = null;
  let nextAt: Date | null = now;
  if (input.forceSuppress) { state = "suppressed"; suppressed = input.forceSuppress; }
  else if (synthetic) { state = "suppressed"; suppressed = "synthetic_account"; }
  else if (!email) { state = "suppressed"; suppressed = "no_address"; }
  else {
    const prefs = recipientUserId ? await loadPreferences(db, recipientUserId).catch(() => DEFAULT_PREFERENCES) : DEFAULT_PREFERENCES;
    if (!prefs.email[rendered.category as NotificationCategory]) { state = "suppressed"; suppressed = "preference_off"; }
    else if (rendered.reminder) {
      const tz = prefs.timeZone ?? input.student?.timeZone ?? "UTC";
      nextAt = afterQuietHours(now, prefs.quietHours, validTimeZone(tz) ? tz : "UTC");
    }
  }
  if (state !== "queued") nextAt = null;

  const out = rows(await db.execute(sql`INSERT INTO s29_notifications
      (dedupe_key, audience, recipient_user_id, student_id, is_demo, category, template, source, language, params, title, body, href, is_reminder, email_state, suppressed_reason, next_attempt_at, created_at, updated_at)
    VALUES (${input.dedupeKey.slice(0, 300)}, ${input.audience}, ${recipientUserId}, ${studentId}, ${synthetic}, ${rendered.category}, ${input.template}, ${input.source.slice(0, 40)}, ${lang},
            ${JSON.stringify(input.params)}::jsonb, ${rendered.title}, ${rendered.body}, ${rendered.href}, ${rendered.reminder}, ${state}, ${suppressed}, ${nextAt ? nextAt.toISOString() : null}::timestamptz,
            ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING id, email_state`));
  if (!out[0]) return { id: null, created: false, emailState: null };
  return { id: String(out[0].id), created: true, emailState: out[0].email_state as EmailState };
}

// ── delivery ─────────────────────────────────────────────────────────────────

export type Deliver = (options: { to: string; subject: string; html: string; text?: string }) => Promise<EmailDelivery>;

export function backoffMs(attempt: number): number {
  return Math.min(6 * 3_600_000, 60_000 * 2 ** Math.max(0, attempt - 1) * 2); // 2, 4, 8, 16 min ... capped at 6 h
}

export interface DeliveryResult { readonly claimed: number; readonly accepted: number; readonly retried: number; readonly failed: number; readonly notConfigured: number; readonly suppressed: number }

export async function deliverDue(db: SqlExecutor & { transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> }, now: Date, deliver: Deliver = (o) => deliverEmail(o)): Promise<DeliveryResult> {
  const nowIso = now.toISOString();
  const leaseIso = new Date(now.getTime() + LEASE_SECONDS * 1000).toISOString();
  const claimed = await db.transaction(async (tx) => rows(await tx.execute(sql`
    UPDATE s29_notifications n SET lease_until = ${leaseIso}::timestamptz, attempts = n.attempts + 1, email_state = 'attempted', updated_at = now()
     WHERE n.id IN (SELECT id FROM s29_notifications WHERE email_state IN ('queued', 'attempted') AND next_attempt_at <= ${nowIso}::timestamptz
                      AND (lease_until IS NULL OR lease_until < ${nowIso}::timestamptz) AND attempts < ${MAX_ATTEMPTS}
                    ORDER BY next_attempt_at, created_at LIMIT ${DELIVERY_BATCH} FOR UPDATE SKIP LOCKED)
    RETURNING n.id, n.audience, n.recipient_user_id, n.student_id, n.is_demo, n.language, n.title, n.body, n.href, n.attempts, n.template`)));
  const res = { claimed: claimed.length, accepted: 0, retried: 0, failed: 0, notConfigured: 0, suppressed: 0 };
  for (const r of claimed) {
    const id = String(r.id);
    let to: string | null = null;
    let synthetic = r.is_demo === true;
    try {
      if (r.audience === "student" && r.student_id) {
        const rec = await loadStudentRecipient(db, String(r.student_id));
        to = rec?.email ?? null;
        synthetic = synthetic || (rec ? recipientIsSynthetic(rec) : false);
      } else if (r.recipient_user_id) {
        to = str(rows(await db.execute(sql`SELECT email FROM users WHERE id = ${String(r.recipient_user_id)}`))[0]?.email) ?? null;
        if (!to && r.audience === "staff") to = process.env.ADMIN_EMAIL || null;
      } else if (r.audience === "staff") {
        to = process.env.ADMIN_EMAIL || null;
      }
    } catch (error) {
      logger.warn("S29 outbox recipient lookup failed", { code: errorCode(error) });
    }
    // Re-check at send time: never email a synthetic fixture, an empty address or a reserved domain.
    if (synthetic || !to || isSyntheticAccount({ email: to })) {
      await db.execute(sql`UPDATE s29_notifications SET email_state = 'suppressed', suppressed_reason = ${synthetic ? "synthetic_account" : "no_address"}, lease_until = NULL, next_attempt_at = NULL, updated_at = now() WHERE id = ${id}`);
      res.suppressed += 1;
      continue;
    }
    const lang: Lang = r.language === "en" ? "en" : "fr";
    const link = r.href ? `${appBaseUrl()}${String(r.href)}` : null;
    const mail = emailHtml(lang, String(r.title), String(r.body), link);
    let outcome: EmailDelivery;
    try {
      outcome = await deliver({ to, subject: mail.subject, html: mail.html, text: mail.text });
    } catch {
      outcome = "failed";
    }
    const attempts = Number(r.attempts);
    if (outcome === "sent") {
      await db.execute(sql`UPDATE s29_notifications SET email_state = 'accepted', sent_at = now(), lease_until = NULL, next_attempt_at = NULL, last_error = NULL, updated_at = now() WHERE id = ${id}`);
      res.accepted += 1;
    } else if (outcome === "not_configured") {
      await db.execute(sql`UPDATE s29_notifications SET email_state = 'not_configured', lease_until = NULL, next_attempt_at = NULL, last_error = 'email transport not configured', updated_at = now() WHERE id = ${id}`);
      res.notConfigured += 1;
    } else if (attempts >= MAX_ATTEMPTS) {
      await db.execute(sql`UPDATE s29_notifications SET email_state = 'failed', lease_until = NULL, next_attempt_at = NULL, last_error = 'provider rejected or unreachable (retries exhausted)', updated_at = now() WHERE id = ${id}`);
      res.failed += 1;
    } else {
      const next = new Date(now.getTime() + backoffMs(attempts)).toISOString();
      await db.execute(sql`UPDATE s29_notifications SET email_state = 'attempted', lease_until = NULL, next_attempt_at = ${next}::timestamptz, last_error = 'provider rejected or unreachable; will retry', updated_at = now() WHERE id = ${id}`);
      res.retried += 1;
    }
  }
  return res;
}

/** Staff retry: a failed / not_configured email goes back to the queue with a fresh attempt budget. */
export async function retryNotification(db: SqlExecutor, id: string): Promise<boolean> {
  const out = rows(await db.execute(sql`UPDATE s29_notifications SET email_state = 'queued', attempts = 0, next_attempt_at = now(), last_error = NULL, lease_until = NULL, updated_at = now()
    WHERE id = ${id} AND email_state IN ('failed', 'not_configured') AND is_demo = false RETURNING id`));
  return out.length > 0;
}

// ── views ────────────────────────────────────────────────────────────────────

export async function readInbox(db: SqlExecutor, userId: string, limit = 50): Promise<InboxView> {
  const [items, unread] = await Promise.all([
    db.execute(sql`SELECT id, category, template, language, title, body, href, created_at, read_at FROM s29_notifications WHERE recipient_user_id = ${userId} AND audience = 'student' ORDER BY created_at DESC LIMIT ${limit}`),
    db.execute(sql`SELECT count(*)::int AS n FROM s29_notifications WHERE recipient_user_id = ${userId} AND audience = 'student' AND read_at IS NULL`),
  ]);
  return {
    items: rows(items).map((r) => ({ id: String(r.id), category: r.category as NotificationCategory, template: String(r.template), language: r.language === "en" ? "en" : "fr", title: String(r.title), body: String(r.body), href: str(r.href), createdAt: isoReq(r.created_at), readAt: iso(r.read_at) })),
    unread: Number(rows(unread)[0]?.n ?? 0),
  };
}

export async function markRead(db: SqlExecutor, userId: string, ids: readonly string[] | "all"): Promise<number> {
  const out = ids === "all"
    ? await db.execute(sql`UPDATE s29_notifications SET read_at = now(), updated_at = now() WHERE recipient_user_id = ${userId} AND read_at IS NULL RETURNING id`)
    : ids.length === 0 ? [] : await db.execute(sql`UPDATE s29_notifications SET read_at = now(), updated_at = now() WHERE recipient_user_id = ${userId} AND read_at IS NULL AND id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) RETURNING id`);
  return rows(out).length;
}

export async function readOutbox(db: SqlExecutor, filter: { state?: EmailState; studentId?: string; limit?: number }, scheduler: OutboxView["scheduler"]): Promise<OutboxView> {
  const lim = Math.min(Math.max(filter.limit ?? 100, 1), 300);
  const where = sql.join([
    sql`TRUE`,
    filter.state ? sql`n.email_state = ${filter.state}` : sql`TRUE`,
    filter.studentId ? sql`n.student_id = ${filter.studentId}` : sql`TRUE`,
  ], sql` AND `);
  const [list, counts] = await Promise.all([
    db.execute(sql`SELECT n.id, n.audience, n.student_id, n.is_demo, n.category, n.template, n.source, n.email_state, n.suppressed_reason, n.attempts, n.next_attempt_at, n.last_error, n.created_at, n.sent_at, n.read_at,
                          s.first_name, s.last_name FROM s29_notifications n LEFT JOIN students s ON s.id = n.student_id WHERE ${where} ORDER BY n.created_at DESC LIMIT ${lim}`),
    db.execute(sql`SELECT email_state, count(*)::int AS n FROM s29_notifications WHERE created_at >= now() - interval '30 days' GROUP BY email_state`),
  ]);
  const c = Object.fromEntries(EMAIL_STATES.map((s) => [s, 0])) as Record<EmailState, number>;
  for (const r of rows(counts)) c[r.email_state as EmailState] = Number(r.n);
  return {
    rows: rows(list).map((r) => ({
      id: String(r.id), audience: r.audience === "staff" ? "staff" : "student", studentId: str(r.student_id),
      studentName: r.first_name ? `${r.first_name} ${r.last_name ?? ""}`.trim() : null, isDemo: r.is_demo === true,
      category: r.category as NotificationCategory, template: String(r.template), source: String(r.source), emailState: r.email_state as EmailState,
      suppressedReason: str(r.suppressed_reason), attempts: Number(r.attempts), nextAttemptAt: iso(r.next_attempt_at), lastError: str(r.last_error),
      createdAt: isoReq(r.created_at), sentAt: iso(r.sent_at), readAt: iso(r.read_at),
    })),
    counts: c,
    emailConfigured: emailTransportConfigured(),
    scheduler,
  };
}
