/**
 * S30 — calendar reminders. The calendar decides WHAT is due (pure planReminders); S29's notification outbox and
 * Concierge decide HOW and WHEN it is delivered. There is no scheduler or notification store here.
 *
 *   collectDueCalendarReminders(db, now)  -> CalendarNotification[] (deterministic dedupe keys)
 *   dispatchCalendarReminders(db, now)    -> pushes them through the calendar operations port (calendar-port.ts)
 * S29's job runner should call dispatchCalendarReminders on its schedule (e.g. every 15 minutes); duplicates are
 * harmless because every notification carries a stable dedupe key.
 *
 * Windows: deadlines (academic/document) 3 days before and on the day -> student + administrators (email allowed);
 *          appointments within 24 hours -> student (once confirmed) + administrators;
 *          course milestones 2 days before -> student only, in-app.
 * Overdue items are not reminded here: the Control Center queue owns them. Demo students never reach administrators.
 */
import { sql } from "drizzle-orm";
import type { CalendarItem } from "@shared/s30-contract";
import { buildCalendarItems, loadCalendarFacts, type CalendarFacts } from "./calendar";
import { calendarOperationsPort, type CalendarNotification, type CalendarNotificationKind, type PortResult } from "./calendar-port";
import { rows, type SqlExecutor } from "./db-util";

const DAY = 86_400_000;

export interface PlannedReminder {
  readonly item: CalendarItem;
  readonly kind: CalendarNotificationKind;
  readonly window: "3d" | "0d" | "24h" | "2d";
  readonly toStudent: boolean;
  readonly toAdmins: boolean;
  readonly allowEmail: boolean;
}

const daysUntil = (today: string, date: string) => Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);

/** Pure: which reminders are due at `now` for these items. */
export function planReminders(items: readonly CalendarItem[], now: Date): PlannedReminder[] {
  const today = now.toISOString().slice(0, 10);
  const out: PlannedReminder[] = [];
  for (const item of items) {
    if (item.status === "done" || item.status === "cancelled" || item.status === "overdue") continue;
    if (item.kind === "academic_deadline" || item.kind === "document_deadline") {
      const d = daysUntil(today, item.start);
      if (d === 0) out.push({ item, kind: "calendar.reminder.deadline", window: "0d", toStudent: true, toAdmins: true, allowEmail: true });
      else if (d > 0 && d <= 3) out.push({ item, kind: "calendar.reminder.deadline", window: "3d", toStudent: true, toAdmins: true, allowEmail: true });
    } else if (item.kind === "orientation" || item.kind === "advisor_meeting" || item.kind === "support_session") {
      if (item.allDay) continue;
      const ms = Date.parse(item.start) - now.getTime();
      if (ms > 0 && ms <= DAY) out.push({ item, kind: "calendar.reminder.appointment", window: "24h", toStudent: item.status !== "requested", toAdmins: true, allowEmail: true });
    } else if (item.kind === "course_milestone") {
      const d = daysUntil(today, item.start);
      if (d >= 0 && d <= 2) out.push({ item, kind: "calendar.reminder.milestone", window: "2d", toStudent: true, toAdmins: false, allowEmail: false });
    }
  }
  return out;
}

/** Pure: planned reminders -> outbox notifications for the student's user and the administrators. */
export function toNotifications(plan: readonly PlannedReminder[], userOf: ReadonlyMap<string, string | null>, adminIds: readonly string[]): CalendarNotification[] {
  const out: CalendarNotification[] = [];
  for (const p of plan) {
    const key = `calendar-reminder:${p.item.id}:${p.item.start}:${p.window}`.slice(0, 200);
    const params = { date: p.item.start, itemKind: p.item.kind, titleKey: p.item.titleKey };
    const studentUser = userOf.get(p.item.studentId) ?? null;
    if (p.toStudent && studentUser) out.push({ recipientUserId: studentUser, audience: "student", kind: p.kind, params, href: "/calendar", allowEmail: p.allowEmail && !p.item.isDemo, dedupeKey: key });
    if (p.toAdmins && !p.item.isDemo) {
      for (const admin of adminIds) {
        out.push({ recipientUserId: admin, audience: "staff", kind: p.kind, params: { ...params, studentId: p.item.studentId }, href: `/admin/students/${encodeURIComponent(p.item.studentId)}?tab=overview`, allowEmail: false, dedupeKey: key });
      }
    }
  }
  return out;
}

export async function collectDueCalendarReminders(db: SqlExecutor, now: Date, facts?: CalendarFacts): Promise<CalendarNotification[]> {
  const from = new Date(now.getTime() - DAY).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 4 * DAY).toISOString().slice(0, 10);
  const f = facts ?? (await loadCalendarFacts(db, { studentIds: null }));
  const plan = planReminders(buildCalendarItems(f, { role: "admin" }, { from, to }, now, { includeDemo: true }), now);
  const admins = plan.some((p) => p.toAdmins) ? rows(await db.execute(sql`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 20`)).map((r) => String(r.id)) : [];
  return toNotifications(plan, new Map(f.students.map((s) => [s.id, s.userId] as const)), admins);
}

export async function dispatchCalendarReminders(db: SqlExecutor, now: Date): Promise<{ readonly due: number; readonly results: Readonly<Record<PortResult, number>> }> {
  const due = await collectDueCalendarReminders(db, now);
  const results: Record<PortResult, number> = { accepted: 0, duplicate: 0, not_wired: 0, failed: 0 };
  const port = calendarOperationsPort();
  for (const n of due) {
    const r = await port.enqueueNotification(n).catch(() => "failed" as const);
    results[r] += 1;
  }
  return { due: due.length, results };
}
