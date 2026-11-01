/**
 * S30 calendar -> S29 operational layer: the ONE seam between the Academic Calendar and the operational infrastructure
 * owned by S29 (event store, notification outbox, Concierge, diagnostics). The calendar never stores events or
 * notifications itself.
 *
 * Integration (S26): call setCalendarOperationsPort() once at startup with an adapter onto S29's services, e.g.
 *   setCalendarOperationsPort({
 *     recordEvent: (e) => s29Events.record({ type: e.kind, studentId: e.studentId, ... }),
 *     enqueueNotification: (n) => s29Outbox.enqueue({ userId: n.recipientUserId, kind: n.kind, ... }),
 *   });
 * and let S29's Concierge/job runner call collectDueCalendarReminders() (calendar-reminders.ts) on its schedule.
 * Until then the default port is a no-op that reports "not_wired": nothing is lost (the calendar re-reads its source
 * records on every request) and nothing is sent twice.
 */
import type { CalendarItemKind } from "@shared/s30-contract";

/** Calendar events emitted for the operational timeline (identifiers, kinds and dates only). */
export type CalendarOpsEventKind = "calendar.event_scheduled" | "calendar.event_rescheduled" | "calendar.event_cancelled";
export interface CalendarOpsEvent {
  readonly kind: CalendarOpsEventKind;
  readonly studentId: string;
  readonly calendarEventId: string;
  readonly eventKind: string;
  readonly startsAt: string;
  readonly actorId: string | null;
  /** Stable key: the adapter should make delivery idempotent on it. */
  readonly dedupeKey: string;
}

/** Notification kinds the calendar asks the outbox to deliver (the outbox owns templates, language, email/in-app). */
export type CalendarNotificationKind = "calendar.reminder.deadline" | "calendar.reminder.appointment" | "calendar.reminder.milestone" | "calendar.event_changed";
export interface CalendarNotification {
  readonly recipientUserId: string;
  readonly audience: "student" | "staff";
  readonly kind: CalendarNotificationKind;
  /** Values only (no record free text): ISO date/instant, item kind, optional translation key, change word. */
  readonly params: Readonly<{ date: string; itemKind: CalendarItemKind | string; titleKey?: string | null; change?: string | null; studentId?: string | null }>;
  /** Portal path to open (always starts with "/"). */
  readonly href: string;
  /** Whether email is appropriate (the outbox still applies its own preferences and demo/.invalid rules). */
  readonly allowEmail: boolean;
  readonly dedupeKey: string;
}

/** "suppressed": the operational layer deliberately did not send it (e.g. Concierge reminders switched off). */
export type PortResult = "accepted" | "duplicate" | "suppressed" | "not_wired" | "failed";
export interface CalendarOperationsPort {
  recordEvent(event: CalendarOpsEvent): Promise<PortResult>;
  enqueueNotification(notification: CalendarNotification): Promise<PortResult>;
}

const notWired: CalendarOperationsPort = {
  recordEvent: async () => "not_wired",
  enqueueNotification: async () => "not_wired",
};
let current: CalendarOperationsPort = notWired;

export function setCalendarOperationsPort(port: CalendarOperationsPort | null): void { current = port ?? notWired; }
export function calendarOperationsPort(): CalendarOperationsPort { return current; }
export const calendarPortWired = () => current !== notWired;
