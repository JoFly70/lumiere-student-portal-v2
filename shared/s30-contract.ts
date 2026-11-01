/**
 * S30 Phase A shared contract: Academic Calendar (month / week / agenda views for students and staff, reminders,
 * iCalendar export and revocable subscription feeds).
 *
 * Tables: supabase/migrations/20261107100000_s30_academic_calendar.sql. Server: server/services/s30/calendar*.ts,
 * routes server/routes/s30-calendar.ts. Dates are ISO strings; instants are UTC ("…Z"); date-only values are
 * "YYYY-MM-DD" and are never shifted by a time zone.
 *
 * The calendar owns no operational state: timeline events and reminder notifications go to the operational layer
 * owned by S29 through ONE port (server/services/s30/calendar-port.ts).
 */
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const instant = z.string().datetime({ offset: true });

// ── Academic Calendar ───────────────────────────────────────────────────────

export const CALENDAR_ITEM_KINDS = [
  "academic_deadline", "document_deadline", "course_milestone", "orientation", "advisor_meeting", "support_session", "program_checkpoint",
] as const;
export type CalendarItemKind = (typeof CALENDAR_ITEM_KINDS)[number];
export const CALENDAR_EVENT_KINDS = ["advisor_meeting", "support_session", "program_checkpoint", "academic_deadline"] as const;
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];
export type CalendarItemSource = "agreement" | "checkpoint" | "orientation" | "calendar_event" | "roadmap" | "high_school_plan";
export type CalendarItemStatus = "scheduled" | "requested" | "done" | "cancelled" | "overdue";

export interface CalendarItem {
  /** Stable across reads: `${source}:${recordId}[:${subKey}]`. */
  readonly id: string;
  readonly kind: CalendarItemKind;
  readonly source: CalendarItemSource;
  readonly studentId: string;
  readonly studentName: string | null;
  readonly studentCode: string | null;
  readonly isDemo: boolean;
  /** Record data (course titles are data, never translated); `titleKey` when the title is a product label. */
  readonly title: string;
  readonly titleKey: string | null;
  /** All-day items: "YYYY-MM-DD". Timed items: UTC instant. */
  readonly start: string;
  readonly end: string | null;
  readonly allDay: boolean;
  /** IANA zone the item was scheduled in (display hint; timed instants are absolute). */
  readonly timeZone: string;
  readonly status: CalendarItemStatus;
  readonly location: string | null;
  /** Where the viewer acts on it (role-appropriate route). */
  readonly href: string;
  /** Viewer may reschedule/cancel through the calendar API. */
  readonly editable: boolean;
  /** For calendar_event items: the row id; for orientation: the session id. */
  readonly recordId: string;
}
export interface CalendarView {
  readonly from: string;
  readonly to: string;
  readonly generatedAt: string;
  readonly items: readonly CalendarItem[];
  readonly truncated: boolean;
}
const tz = z.string().trim().min(1).max(64).refine((v) => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }, "Unknown time zone");
export const calendarRangeSchema = z
  .object({ from: isoDate, to: isoDate, studentId: z.string().trim().min(1).max(128).optional(), includeDemo: z.enum(["0", "1"]).optional() })
  .strict()
  .refine((v) => v.from <= v.to, { message: "from must be on or before to" })
  .refine((v) => (Date.parse(`${v.to}T00:00:00Z`) - Date.parse(`${v.from}T00:00:00Z`)) / 86_400_000 <= 120, { message: "range is limited to 120 days" });
export const createCalendarEventSchema = z
  .object({
    studentId: z.string().trim().min(1).max(128),
    kind: z.enum(CALENDAR_EVENT_KINDS),
    title: z.string().trim().min(1).max(120),
    startsAt: instant,
    endsAt: instant.nullable().optional(),
    allDay: z.boolean().default(false),
    timeZone: tz.default("UTC"),
    location: z.string().trim().max(200).nullable().optional(),
    visibleToStudent: z.boolean().default(true),
    notify: z.boolean().default(true),
  })
  .strict()
  .refine((v) => !v.endsAt || Date.parse(v.endsAt) > Date.parse(v.startsAt), { message: "endsAt must be after startsAt", path: ["endsAt"] });
export type CreateCalendarEventInput = z.infer<typeof createCalendarEventSchema>;
export const updateCalendarEventSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    startsAt: instant.optional(),
    endsAt: instant.nullable().optional(),
    allDay: z.boolean().optional(),
    timeZone: tz.optional(),
    location: z.string().trim().max(200).nullable().optional(),
    visibleToStudent: z.boolean().optional(),
    status: z.enum(["scheduled", "cancelled"]).optional(),
    notify: z.boolean().default(true),
  })
  .strict();
export type UpdateCalendarEventInput = z.infer<typeof updateCalendarEventSchema>;

export interface CalendarSubscriptionView {
  readonly id: string;
  readonly scope: "student" | "staff";
  readonly privacy: "minimal" | "detailed";
  readonly label: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  /** Feed URL path; the token is shown ONCE, at creation (only its hash is stored). */
  readonly feedPath: string | null;
}
export const createSubscriptionSchema = z
  .object({ privacy: z.enum(["minimal", "detailed"]).default("minimal"), label: z.string().trim().max(60).optional() })
  .strict();

// ── API paths ───────────────────────────────────────────────────────────────

const enc = encodeURIComponent;
export const S30_API = {
  staffCalendar: "/api/admin/calendar",
  staffCalendarEvents: "/api/admin/calendar/events",
  staffCalendarEvent: (id: string) => `/api/admin/calendar/events/${enc(id)}`,
  staffCalendarIcs: "/api/admin/calendar/export.ics",
  staffSubscriptions: "/api/admin/calendar/subscriptions",
  staffSubscription: (id: string) => `/api/admin/calendar/subscriptions/${enc(id)}`,
  studentCalendar: "/api/student/calendar",
  studentCalendarIcs: "/api/student/calendar/export.ics",
  studentSubscriptions: "/api/student/calendar/subscriptions",
  studentSubscription: (id: string) => `/api/student/calendar/subscriptions/${enc(id)}`,
  feed: (token: string) => `/calendar/feed/${enc(token)}.ics`,
} as const;

export const S30_ERROR_CODES = {
  VALIDATION: "S30_VALIDATION_FAILED",
  NOT_FOUND: "S30_NOT_FOUND",
  FORBIDDEN: "S30_FORBIDDEN",
  INVALID_TRANSITION: "S30_INVALID_TRANSITION",
  UNAVAILABLE: "S30_UNAVAILABLE",
  DUPLICATE_SCHEDULE: "S30_DUPLICATE_SCHEDULE",
} as const;

/** Audit event types written by the calendar routes (identifiers, kinds and counts only). In the enum via the S30 migration. */
export const S30_AUDIT_EVENTS = {
  calendarEventChanged: "calendar.event_changed",
  calendarSubscriptionChanged: "calendar.subscription_changed",
  calendarAccessDenied: "calendar.access_denied",
} as const;

/**
 * Role matrix (server-enforced):
 *  - admin + staff: read every student's calendar (demo students only on request), schedule / reschedule / cancel
 *    calendar events, export, manage their own staff feed links. Orientation sessions are rescheduled through the
 *    existing admin-only S27 endpoint.
 *  - student: reads only their own items (staff-only events excluded; a studentId parameter is refused), exports, and
 *    manages their own feed links.
 *  - coach: no calendar access.
 *  - feed URLs: a revocable 256-bit token (only its SHA-256 is stored); the owner's CURRENT role is re-checked on
 *    every fetch; "minimal" privacy shows only kinds (+ student code for staff), "detailed" shows titles and names.
 */
