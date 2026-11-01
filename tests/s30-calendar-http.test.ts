/**
 * S30 Phase A — Academic Calendar over the production registerRoutes app and a throwaway PostgreSQL (the full
 * migration chain, including 20261107100000_s30_academic_calendar.sql).
 * Real: requireAuth/RBAC (local JWTs), CSRF, every calendar SQL path, the iCalendar feed. Doubled: Supabase client,
 * audit sink, and the S29 operational layer (a spy installed as the calendar operations port). Synthetic data only.
 */
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";
import { applyS09Migration } from "./helpers/s09-apply-migration";
import { seedActor, seedHsStudent, type Actor, type HsStudent } from "./helpers/s11-hs-e2e-extra";
import { makeS13Supabase } from "./helpers/s13-supabase-shim";
import { setCalendarOperationsPort, type CalendarNotification, type CalendarOpsEvent } from "../server/services/s30/calendar-port";
import { dispatchCalendarReminders } from "../server/services/s30/calendar-reminders";

const holder = vi.hoisted(() => ({ supabase: null as any }));
vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: {
    auth: { getUser: async (t: string) => (await import("./helpers/s09-profile-stack")).fixtureProviderGetUser(t), admin: { createUser: vi.fn(), deleteUser: vi.fn() } },
    from: (t: string) => holder.supabase.client.from(t),
    get storage() { return holder.supabase.client.storage; },
  },
  createUserAuthClient: () => ({ auth: {} }),
  isSupabaseConfigured: true,
}));
vi.mock("../server/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(actual).map(([k, v]) => [k, typeof v === "function" && k !== "getAuditFailureStats" ? vi.fn().mockResolvedValue(undefined) : v]));
});

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const at = (offsetDays: number, hourUtc: number) => `${day(offsetDays)}T${String(hourUtc).padStart(2, "0")}:00:00.000Z`;

describe.skipIf(!PG_BINARIES_AVAILABLE)("S30 Phase A: academic calendar (real Postgres, production routes)", () => {
  const port = { events: [] as CalendarOpsEvent[], notes: [] as CalendarNotification[], keys: new Set<string>() };
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let admin: Actor, staff: Actor, coach: Actor;
  let ada: HsStudent, ben: HsStudent;
  const api = () => request(base);
  const range = `from=${day(-10)}&to=${day(40)}`;

  beforeAll(async () => {
    process.env.APP_URL = "https://portal.synthetic.example";
    pg = await startLocalPg();
    await applyS09Migration(pg);
    process.env.DATABASE_URL = pg.url;
    holder.supabase = makeS13Supabase(pg);
    setCalendarOperationsPort({
      recordEvent: async (e) => { port.events.push(e); return "accepted"; },
      enqueueNotification: async (n) => { const k = `${n.recipientUserId}|${n.dedupeKey}`; if (port.keys.has(k)) return "duplicate"; port.keys.add(k); port.notes.push(n); return "accepted"; },
    });
    admin = await seedActor(pg, "admin");
    staff = await seedActor(pg, "staff");
    coach = await seedActor(pg, "coach");
    ada = await seedHsStudent(pg, "Ada");
    ben = await seedHsStudent(pg, "Ben");
    // Ada signed 28 days ago: the 30-day language test is due in 2 days.
    await pg.sql(`insert into student_agreements (student_id, signed_on, activated_on) values ('${ada.student.id}', '${day(-28)}', '${day(-28)}')`);
    const { registerRoutes } = await import("../server/routes");
    const app = express();
    app.use(express.json());
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 300_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    setCalendarOperationsPort(null);
    await pg?.stop();
  }, 60_000);

  it("the calendar migration created 2 tables with RLS on and no client privileges, and is idempotent", async () => {
    const r = await pg.sql(`select c.relname, c.relrowsecurity, has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('calendar_events','calendar_subscriptions')`);
    expect(r).toHaveLength(2);
    expect(r.every((x: any) => x.relrowsecurity && !x.auth_select)).toBe(true);
    const fs = await import("node:fs");
    await pg.sql(fs.readFileSync("supabase/migrations/20261107100000_s30_academic_calendar.sql", "utf8"));
    const enumCount = await pg.sql(`select count(*)::int as n from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'audit_event_type' and e.enumlabel like 'calendar.%'`);
    expect(enumCount[0]!.n).toBe(3);
    const ops = await pg.sql(`select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace and relname in ('ops_events','ops_notifications','ops_exception_states','ops_runs')`);
    expect(ops[0]!.n).toBe(0); // S30 creates no operational-layer tables (S29 owns events, notifications, exceptions)
  });

  it("role scoping: coaches and students are refused the staff calendar; students and staff are refused the other side", async () => {
    for (const path of [`/api/admin/calendar?${range}`, "/api/admin/calendar/subscriptions", `/api/admin/calendar/export.ics?${range}`]) {
      expect((await api().get(path).set(coach.bearer)).status, path).toBe(403);
      expect((await api().get(path).set(ada.user.bearer)).status, path).toBe(403);
      expect((await api().get(path).set(staff.bearer)).status, path).toBe(200);
    }
    expect((await api().post("/api/admin/calendar/events").set(coach.auth).send({})).status).toBe(403);
    expect((await api().post("/api/admin/calendar/events").set(ada.user.auth).send({})).status).toBe(403);
    expect((await api().get(`/api/student/calendar?${range}`).set(staff.bearer)).status).toBe(403);
    expect((await api().get(`/api/student/calendar?${range}`).set(coach.bearer)).status).toBe(403);
    expect((await api().get(`/api/admin/calendar?${range}`)).status).toBe(401);
  });

  let eventId = "";
  it("schedules an advisor meeting (CSRF required), refuses a duplicate, records the event, and the student sees it but not another student's", async () => {
    const body = { studentId: ada.student.id, kind: "advisor_meeting", title: "Advisor meeting", startsAt: at(5, 14), endsAt: at(5, 15), timeZone: "America/Toronto", location: "Video call" };
    expect((await api().post("/api/admin/calendar/events").set(staff.bearer).send(body)).status).toBe(403);
    const res = await api().post("/api/admin/calendar/events").set(staff.auth).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    eventId = res.body.id;
    expect(port.events.at(-1)).toMatchObject({ kind: "calendar.event_scheduled", studentId: ada.student.id, calendarEventId: eventId });
    expect(port.notes.at(-1)).toMatchObject({ recipientUserId: ada.user.id, kind: "calendar.event_changed", params: { change: "scheduled" } });
    const dup = await api().post("/api/admin/calendar/events").set(admin.auth).send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("S30_DUPLICATE_SCHEDULE");
    await api().post("/api/admin/calendar/events").set(admin.auth).send({ ...body, kind: "support_session", title: "Internal prep", visibleToStudent: false });
    const mine = await api().get(`/api/student/calendar?${range}`).set(ada.user.bearer);
    expect(mine.status).toBe(200);
    const ids = mine.body.items.map((i: any) => i.id);
    expect(ids).toContain(`event:${eventId}`);
    expect(ids).toContain(`agreement:${ada.student.id}:language_test`);
    expect(mine.body.items.some((i: any) => i.title === "Internal prep")).toBe(false);
    expect(mine.body.items.every((i: any) => i.studentName === null && !i.editable)).toBe(true);
    const other = await api().get(`/api/student/calendar?${range}`).set(ben.user.bearer);
    expect(other.body.items.some((i: any) => i.studentId === ada.student.id)).toBe(false);
    expect((await api().get(`/api/student/calendar?${range}&studentId=${ada.student.id}`).set(ben.user.bearer)).status).toBe(400);
    const staffView = await api().get(`/api/admin/calendar?${range}&studentId=${ada.student.id}`).set(staff.bearer);
    expect(staffView.body.items.find((i: any) => i.id === `event:${eventId}`)).toMatchObject({ studentName: "Ada Synthetic", editable: true });
    expect((await api().get(`/api/admin/calendar?from=${day(0)}&to=${day(200)}`).set(staff.bearer)).status).toBe(400); // > 120 days
  });

  it("rescheduling and cancelling go to the S29 layer through the port (event + student notification); cancelled is final", async () => {
    const before = port.notes.length;
    const moved = await api().patch(`/api/admin/calendar/events/${eventId}`).set(admin.auth).send({ startsAt: at(6, 14), endsAt: at(6, 15) });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body).toMatchObject({ change: "rescheduled", sequence: 1 });
    expect(port.events.at(-1)).toMatchObject({ kind: "calendar.event_rescheduled", calendarEventId: eventId });
    expect(port.notes.slice(before).some((n) => n.recipientUserId === ada.user.id && n.params.change === "rescheduled" && n.allowEmail)).toBe(true);
    const silent = await api().patch(`/api/admin/calendar/events/${eventId}`).set(admin.auth).send({ title: "Advisor meeting (video)", notify: false });
    expect(silent.body.change).toBe("updated");
    const cancelled = await api().patch(`/api/admin/calendar/events/${eventId}`).set(admin.auth).send({ status: "cancelled" });
    expect(cancelled.body.change).toBe("cancelled");
    expect(port.events.at(-1)?.kind).toBe("calendar.event_cancelled");
    expect((await api().patch(`/api/admin/calendar/events/${eventId}`).set(admin.auth).send({ title: "x" })).status).toBe(409);
    const view = await api().get(`/api/student/calendar?${range}`).set(ada.user.bearer);
    expect(view.body.items.find((i: any) => i.id === `event:${eventId}`)?.status).toBe("cancelled");
  });

  it("subscription feeds: shown once, scoped to the owner, minimal privacy by default, revocable", async () => {
    const created = await api().post("/api/student/calendar/subscriptions").set(ada.user.auth).send({});
    expect(created.status).toBe(201);
    expect(created.body.feedPath).toMatch(/^\/calendar\/feed\/[A-Za-z0-9_-]{43}\.ics$/);
    const listed = await api().get("/api/student/calendar/subscriptions").set(ada.user.bearer);
    expect(listed.body.subscriptions[0].feedPath).toBeNull();
    const [row] = await pg.sql(`select token_hash from calendar_subscriptions where id = '${created.body.id}'`);
    expect(created.body.feedPath).not.toContain(String(row!.token_hash));
    const feed = await api().get(created.body.feedPath);
    expect(feed.status).toBe(200);
    expect(feed.headers["content-type"]).toContain("text/calendar");
    expect(feed.text).toContain("BEGIN:VCALENDAR");
    expect(feed.text).toContain("SUMMARY:Academic deadline");
    expect(feed.text).not.toContain("Ada");
    expect(feed.text).not.toContain("Internal prep");
    // Ben cannot revoke Ada's link
    expect((await api().delete(`/api/student/calendar/subscriptions/${created.body.id}`).set(ben.user.auth)).status).toBe(404);
    // staff detailed feed identifies students; a student token never becomes a staff feed
    const staffSub = await api().post("/api/admin/calendar/subscriptions").set(staff.auth).send({ privacy: "detailed" });
    const staffFeed = await api().get(staffSub.body.feedPath);
    expect(staffFeed.text).toContain("Ada Synthetic");
    expect((await api().delete(`/api/student/calendar/subscriptions/${created.body.id}`).set(ada.user.auth)).status).toBe(204);
    expect((await api().get(created.body.feedPath)).status).toBe(404);
    expect((await api().get("/calendar/feed/not-a-token.ics")).status).toBe(404);
    // demoting the staff member disables their staff feed on the next fetch
    await pg.sql(`update users set role = 'coach' where id = '${staff.id}'`);
    expect((await api().get(staffSub.body.feedPath)).status).toBe(404);
    await pg.sql(`update users set role = 'staff' where id = '${staff.id}'`);
  });

  it("due reminders are handed to the S29 outbox once per recipient (stable dedupe keys)", async () => {
    const first = await dispatchCalendarReminders((await import("../server/lib/db")).db as any, new Date());
    expect(first.due).toBeGreaterThanOrEqual(2);
    expect(first.results.accepted).toBeGreaterThanOrEqual(2);
    expect(port.notes.some((n) => n.recipientUserId === ada.user.id && n.kind === "calendar.reminder.deadline")).toBe(true);
    expect(port.notes.some((n) => n.recipientUserId === admin.id && n.kind === "calendar.reminder.deadline" && n.params.studentId === ada.student.id)).toBe(true);
    const second = await dispatchCalendarReminders((await import("../server/lib/db")).db as any, new Date());
    expect(second.results.accepted).toBe(0);
    expect(second.results.duplicate).toBe(first.results.accepted);
  });
});
