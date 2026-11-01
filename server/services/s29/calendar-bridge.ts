/**
 * S29 <- S30 bridge: implements S30's CalendarOperationsPort (server/services/s30/calendar-port.ts) on top of the S29
 * operational layer, and runs S30's reminder dispatch on the durable S29 scheduler.
 *
 * S29 does not import S30 (the two land through separate branches). The S30 types are mirrored structurally here and
 * the integration is three lines at startup, after both are merged (see wireS30Calendar):
 *
 *   import { setCalendarOperationsPort } from "./services/s30/calendar-port";
 *   import { dispatchCalendarReminders } from "./services/s30/calendar-reminders";
 *   wireS30Calendar({ setCalendarOperationsPort, dispatchCalendarReminders });
 *
 *   recordEvent          -> audit log entry 's29.calendar_updated' (identifiers, kinds, dates only)
 *   enqueueNotification  -> s29_notifications (outbox + inbox), idempotent on the port's dedupe key; students get the
 *                           inbox entry and, when allowEmail, the email (preferences, quiet hours, synthetic-account and
 *                           .invalid suppression still apply); staff entries are visible in the Notifications page.
 *   calendar.reminders   -> scheduler job (every 15 min) calling S30's dispatchCalendarReminders.
 */
import { sql } from "drizzle-orm";
import { createAuditLog } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { errorCode, rows, s29Schema, str, type SqlExecutor, type Tx } from "./db";
import { enqueue, type StudentRecipient } from "./outbox";
import { registerJob } from "./scheduler";
import { formatDate, type Lang } from "./templates";
import { loadSettings } from "./attention-store";

// ── structural mirror of S30's port types (shared/s30-contract.ts + calendar-port.ts) ──
export type PortResult = "accepted" | "duplicate" | "not_wired" | "failed";
export interface CalendarOpsEventLike {
  readonly kind: string; readonly studentId: string; readonly calendarEventId: string; readonly eventKind: string;
  readonly startsAt: string; readonly actorId: string | null; readonly dedupeKey: string;
}
export interface CalendarNotificationLike {
  readonly recipientUserId: string;
  readonly audience: "student" | "staff";
  readonly kind: string;
  readonly params: Readonly<{ date: string; itemKind: string; titleKey?: string | null; change?: string | null; studentId?: string | null }>;
  readonly href: string;
  readonly allowEmail: boolean;
  readonly dedupeKey: string;
}
export interface CalendarOperationsPortLike {
  recordEvent(event: CalendarOpsEventLike): Promise<PortResult>;
  enqueueNotification(notification: CalendarNotificationLike): Promise<PortResult>;
}

export const CALENDAR_TEMPLATES: Record<string, string> = {
  "calendar.reminder.deadline": "calendar.reminder.deadline",
  "calendar.reminder.appointment": "calendar.reminder.appointment",
  "calendar.reminder.milestone": "calendar.reminder.milestone",
  "calendar.event_changed": "calendar.event_changed",
};

const ITEM_LABEL: Record<string, { en: string; fr: string }> = {
  academic_deadline: { en: "academic deadline", fr: "échéance académique" },
  document_deadline: { en: "document deadline", fr: "échéance de document" },
  course_milestone: { en: "course milestone", fr: "jalon de cours" },
  orientation: { en: "orientation session", fr: "séance d’orientation" },
  advisor_meeting: { en: "advisor meeting", fr: "rendez-vous avec votre conseiller" },
  support_session: { en: "support session", fr: "séance d’accompagnement" },
  program_checkpoint: { en: "program checkpoint", fr: "point d’étape du programme" },
};
const CHANGE_LABEL: Record<string, { en: string; fr: string }> = {
  scheduled: { en: "scheduled", fr: "ajout" },
  rescheduled: { en: "rescheduled", fr: "report" },
  cancelled: { en: "cancelled", fr: "annulation" },
};

const bridgeState = { wired: false, lastDispatchAt: null as string | null, lastDispatch: null as Record<string, unknown> | null, accepted: 0, duplicates: 0, failed: 0 };
export function calendarBridgeState() { return { ...bridgeState }; }

async function defaultDb(): Promise<Tx> {
  const { db } = await import("../../lib/db");
  return db as unknown as Tx;
}

async function studentForUser(db: SqlExecutor, userId: string): Promise<StudentRecipient | null> {
  const r = rows(await db.execute(sql`SELECT s.id, s.user_id, s.first_name, s.preferred_name, s.timezone, COALESCE(u.email, s.email) AS email, l.language
      FROM students s JOIN users u ON u.id = s.user_id LEFT JOIN user_language_preference l ON l.user_id = s.user_id WHERE s.user_id = ${userId} LIMIT 1`))[0];
  if (!r) return null;
  return { studentId: String(r.id), userId: str(r.user_id), email: str(r.email), name: String(r.first_name ?? ""), preferredName: str(r.preferred_name), timeZone: str(r.timezone), language: r.language === "en" || r.language === "fr" ? r.language : null };
}

/** Values-only parameters localised for the templates (dates in the recipient's zone; item kinds translated). */
function params(n: CalendarNotificationLike, tz: string): Record<string, string | number | null> {
  const timed = /T\d{2}:\d{2}/.test(n.params.date);
  const item = ITEM_LABEL[n.params.itemKind] ?? { en: "calendar item", fr: "élément de calendrier" };
  const change = CHANGE_LABEL[n.params.change ?? ""] ?? { en: "updated", fr: "modification" };
  return {
    whenEn: formatDate(n.params.date, "en", tz, timed), whenFr: formatDate(n.params.date, "fr", tz, timed),
    itemEn: item.en, itemFr: item.fr, changeEn: change.en, changeFr: change.fr, href: n.href,
  };
}

export function createCalendarOpsAdapter(getDb: () => Promise<SqlExecutor> = defaultDb, now: () => Date = () => new Date()): CalendarOperationsPortLike {
  return {
    async recordEvent(e) {
      try {
        await createAuditLog({
          eventType: "s29.calendar_updated", severity: "info", actorUserId: e.actorId ?? undefined, targetResourceType: "student", targetResourceId: e.studentId,
          actionDescription: `Calendar ${e.kind.replace("calendar.event_", "")}`, isEducationalRecord: true,
          metadata: { calendarEventId: e.calendarEventId, eventKind: e.eventKind, startsAt: e.startsAt, dedupeKey: e.dedupeKey.slice(0, 200) },
        });
        return "accepted";
      } catch (error) {
        logger.warn("S29 calendar bridge recordEvent failed", { code: errorCode(error) });
        return "failed";
      }
    },
    async enqueueNotification(n) {
      try {
        if (!CALENDAR_TEMPLATES[n.kind] || !n.href.startsWith("/")) return "failed";
        const db = await getDb();
        if (!(await s29Schema(db)).present) return "not_wired";
        const at = now();
        const settings = await loadSettings(db);
        if (n.audience === "student") {
          const rec = await studentForUser(db, n.recipientUserId);
          if (!rec) return "failed";
          const res = await enqueue(db, {
            dedupeKey: `s30:${n.dedupeKey}`.slice(0, 300), audience: "student", template: n.kind, source: "calendar", params: params(n, rec.timeZone ?? "UTC"),
            student: rec, defaultLanguage: settings.defaultLanguage, inAppOnly: !n.allowEmail, now: at,
          });
          return res.created ? "accepted" : "duplicate";
        }
        const u = rows(await db.execute(sql`SELECT u.id, u.email, u.role, l.language FROM users u LEFT JOIN user_language_preference l ON l.user_id = u.id WHERE u.id = ${n.recipientUserId}`))[0];
        if (!u || (u.role !== "admin" && u.role !== "staff")) return "failed";
        const lang: Lang = u.language === "fr" ? "fr" : "en";
        const res = await enqueue(db, {
          dedupeKey: `s30:${n.dedupeKey}:${n.recipientUserId}`.slice(0, 300), audience: "staff", template: n.kind, source: "calendar", params: params(n, "UTC"),
          staff: { userId: String(u.id), email: u.email ? String(u.email) : null, language: lang }, inAppOnly: !n.allowEmail, now: at,
        });
        return res.created ? "accepted" : "duplicate";
      } catch (error) {
        logger.warn("S29 calendar bridge enqueue failed", { kind: n.kind, code: errorCode(error) });
        return "failed";
      }
    },
  };
}

export interface S30CalendarModules {
  setCalendarOperationsPort(port: CalendarOperationsPortLike | null): void;
  dispatchCalendarReminders(db: SqlExecutor, now: Date): Promise<{ readonly due: number; readonly results: Readonly<Record<PortResult, number>> }>;
}

/** One call at startup once S30 is merged: installs the port and the 15-minute reminder job on the S29 scheduler. */
export function wireS30Calendar(s30: S30CalendarModules, opts: { getDb?: () => Promise<SqlExecutor> } = {}): void {
  s30.setCalendarOperationsPort(createCalendarOpsAdapter(opts.getDb));
  registerJob({
    name: "calendar.reminders", intervalSeconds: 900,
    run: async (db, now) => {
      const out = await s30.dispatchCalendarReminders(db, now);
      bridgeState.lastDispatchAt = now.toISOString();
      bridgeState.lastDispatch = { due: out.due, ...out.results };
      bridgeState.accepted += out.results.accepted; bridgeState.duplicates += out.results.duplicate; bridgeState.failed += out.results.failed;
      if (out.results.not_wired > 0) throw Object.assign(new Error("calendar port not wired"), { code: "PORT_NOT_WIRED" });
      return { due: out.due, ...out.results };
    },
  });
  bridgeState.wired = true;
}
