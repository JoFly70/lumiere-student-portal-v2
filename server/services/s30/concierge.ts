/**
 * S30 — Proactive Concierge: the reminder sweep that turns calendar items into notifications.
 *
 * Reads the calendar (which itself reads agreements, checkpoints, sessions, plans and scheduled events), and for each
 * upcoming item creates ONE notification per recipient and window (dedupe keys make re-runs and multiple instances
 * harmless). Students get in-app notifications plus email when the app email transport is configured (never for
 * synthetic demo accounts or .invalid addresses). Administrators get in-app notifications for deadlines and
 * appointments. Overdue items are not re-notified here: they are exceptions in the Control Center queue.
 *
 * Windows:  deadlines (academic/document) -> 3 days before and on the day;  appointments -> within 24 hours;
 *           course milestones -> 2 days before (student only, in-app only).
 */
import { sql } from "drizzle-orm";
import type { CalendarItem, NotificationKind } from "@shared/s30-contract";
import { isDemoPreferredName } from "@shared/synthetic-accounts";
import { deliverEmail, emailTransportConfigured } from "../../lib/email";
import { buildNotificationEmail, type MailLang } from "../../lib/s30-notification-email";
import { logger } from "../../lib/logger";
import { buildCalendarItems, loadCalendarFacts, type CalendarFacts } from "./calendar";
import { adminUserIds, notify, recordEvent, rows, runFinished, runStarted, str, type EmailSender, type SqlExecutor } from "./ops";

export const CONCIERGE_RUN = "concierge.reminders";
const DAY = 86_400_000;

export interface PlannedReminder {
  readonly item: CalendarItem;
  readonly kind: NotificationKind;
  readonly window: "3d" | "0d" | "24h" | "2d";
  readonly toStudent: boolean;
  readonly toAdmins: boolean;
  readonly emailStudent: boolean;
}

/** Pure: which reminders are due at `now` for these items. */
export function planReminders(items: readonly CalendarItem[], now: Date): PlannedReminder[] {
  const today = now.toISOString().slice(0, 10);
  const out: PlannedReminder[] = [];
  for (const item of items) {
    if (item.status === "done" || item.status === "cancelled" || item.status === "overdue") continue;
    if (item.kind === "academic_deadline" || item.kind === "document_deadline") {
      const days = Math.round((Date.parse(`${item.start.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
      if (days === 0) out.push({ item, kind: "reminder.deadline", window: "0d", toStudent: true, toAdmins: true, emailStudent: true });
      else if (days > 0 && days <= 3) out.push({ item, kind: "reminder.deadline", window: "3d", toStudent: true, toAdmins: true, emailStudent: true });
    } else if (item.kind === "orientation" || item.kind === "advisor_meeting" || item.kind === "support_session") {
      if (item.allDay) continue;
      const ms = Date.parse(item.start) - now.getTime();
      if (ms > 0 && ms <= DAY) out.push({ item, kind: "reminder.appointment", window: "24h", toStudent: item.status !== "requested", toAdmins: true, emailStudent: true });
    } else if (item.kind === "course_milestone" || item.kind === "program_checkpoint") {
      const days = Math.round((Date.parse(`${item.start.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
      if (days >= 0 && days <= 2 && item.kind === "course_milestone") out.push({ item, kind: "reminder.milestone", window: "2d", toStudent: true, toAdmins: false, emailStudent: false });
    }
  }
  return out;
}

/** Email through the existing transport, in the recipient's saved language. Never for demo accounts. */
export function createEmailSender(db: SqlExecutor, env: NodeJS.ProcessEnv = process.env): EmailSender {
  return async (userId, kind, params, href) => {
    if (!emailTransportConfigured(env)) return "not_configured";
    const [u] = rows(await db.execute(sql`SELECT u.email, l.language, s.preferred_name FROM users u
        LEFT JOIN user_language_preference l ON l.user_id = u.id LEFT JOIN students s ON s.user_id = u.id WHERE u.id = ${userId} LIMIT 1`));
    const email = str(u?.email);
    if (!email || /\.invalid$/i.test(email) || isDemoPreferredName(str(u?.preferred_name))) return "skipped";
    const lang: MailLang = u?.language === "fr" ? "fr" : "en";
    const mail = buildNotificationEmail({ kind, lang, params, appUrl: env.APP_URL || "", href });
    return deliverEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text }, env);
  };
}

export interface ConciergeResult { readonly planned: number; readonly created: number; readonly emailed: number; readonly students: number }

export async function runConcierge(db: SqlExecutor, now: Date, deps: { email?: EmailSender; facts?: CalendarFacts } = {}): Promise<ConciergeResult> {
  await runStarted(db, CONCIERGE_RUN);
  try {
    const from = new Date(now.getTime() - DAY).toISOString().slice(0, 10);
    const to = new Date(now.getTime() + 4 * DAY).toISOString().slice(0, 10);
    const facts = deps.facts ?? (await loadCalendarFacts(db, { studentIds: null }));
    const items = buildCalendarItems(facts, { role: "admin" }, { from, to }, now, { includeDemo: true });
    const plan = planReminders(items, now);
    const userOf = new Map(facts.students.map((s) => [s.id, s.userId] as const));
    const admins = plan.some((p) => p.toAdmins) ? await adminUserIds(db) : [];
    const email = deps.email ?? createEmailSender(db);
    let created = 0;
    let emailed = 0;
    const students = new Set<string>();
    for (const p of plan) {
      const key = `reminder:${p.item.id}:${p.item.start}:${p.window}`.slice(0, 200);
      const date = p.item.start;
      const studentUser = userOf.get(p.item.studentId) ?? null;
      if (p.toStudent && studentUser) {
        const id = await notify(db, { recipientUserId: studentUser, kind: p.kind, params: { date, itemKind: p.item.kind, title: p.item.titleKey ? null : p.item.title.slice(0, 120), titleKey: p.item.titleKey }, href: "/calendar", dedupeKey: key }, p.emailStudent ? email : undefined);
        if (id) { created += 1; students.add(p.item.studentId); if (p.emailStudent) emailed += 1; }
      }
      if (p.toAdmins && !p.item.isDemo) {
        for (const admin of admins) {
          const id = await notify(db, {
            recipientUserId: admin, kind: p.kind,
            params: { date, itemKind: p.item.kind, studentName: p.item.studentName, studentCode: p.item.studentCode, title: p.item.titleKey ? null : p.item.title.slice(0, 120), titleKey: p.item.titleKey },
            href: `/admin/students/${encodeURIComponent(p.item.studentId)}?tab=overview`, dedupeKey: key,
          });
          if (id) created += 1;
        }
      }
      await recordEvent(db, { kind: "concierge.reminder_sent", studentId: p.item.studentId, subjectType: "calendar_item", subjectId: p.item.id.slice(0, 128), data: { itemKind: p.item.kind, window: p.window }, dedupeKey: key });
    }
    const result = { planned: plan.length, created, emailed, students: students.size };
    await runFinished(db, CONCIERGE_RUN, "ok", { ...result, emailTransport: emailTransportConfigured() });
    return result;
  } catch (error) {
    logger.error("Concierge sweep failed", { code: (error as { code?: string })?.code, name: (error as Error)?.name });
    await runFinished(db, CONCIERGE_RUN, "error", { code: String((error as { code?: string })?.code ?? "unknown") }).catch(() => undefined);
    throw error;
  }
}

/** Starts the periodic sweep (every 15 minutes, first run after 1 minute). Off when S30_CONCIERGE=off. */
export function startConciergeScheduler(db: SqlExecutor, env: NodeJS.ProcessEnv = process.env): (() => void) | null {
  if (env.S30_CONCIERGE === "off" || env.NODE_ENV === "test") return null;
  const tick = () => { void runConcierge(db, new Date()).catch(() => undefined); };
  const first = setTimeout(tick, 60_000);
  const every = setInterval(tick, 15 * 60_000);
  first.unref?.();
  every.unref?.();
  return () => { clearTimeout(first); clearInterval(every); };
}
