/**
 * S30 Phase A — operational layer + academic calendar over the production registerRoutes app and a throwaway
 * PostgreSQL (the full migration chain, including 20261106100000_s30_operations_academic.sql).
 * Real: requireAuth/RBAC (local JWTs), CSRF, every S30 SQL path, the calendar feed. Doubled: Supabase client, audit
 * sink, email transport (spy; nothing is sent). Synthetic data only.
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

const holder = vi.hoisted(() => ({ supabase: null as any, delivered: [] as Array<{ to: string; subject: string }> }));
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
vi.mock("../server/lib/email", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    deliverEmail: vi.fn(async (m: { to: string; subject: string }) => { holder.delivered.push(m); return "sent"; }),
    emailTransportConfigured: vi.fn(() => true),
    sendEmail: vi.fn(async () => false),
  };
});

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const at = (offsetDays: number, hourUtc: number) => `${day(offsetDays)}T${String(hourUtc).padStart(2, "0")}:00:00.000Z`;

describe.skipIf(!PG_BINARIES_AVAILABLE)("S30 Phase A: operations + calendar (real Postgres, production routes)", () => {
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
    await pg?.stop();
  }, 60_000);

  it("the S30 migration created 10 tables with RLS on and no client privileges, and is idempotent", async () => {
    const r = await pg.sql(`select c.relname, c.relrowsecurity, has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('ops_events','ops_exception_states','ops_notifications','ops_runs','academic_import_mappings',
      'academic_import_batches','academic_import_rows','academic_reported_records','calendar_events','calendar_subscriptions')`);
    expect(r).toHaveLength(10);
    expect(r.every((x: any) => x.relrowsecurity && !x.auth_select)).toBe(true);
    const fs = await import("node:fs");
    await pg.sql(fs.readFileSync("supabase/migrations/20261106100000_s30_operations_academic.sql", "utf8"));
    const enumCount = await pg.sql(`select count(*)::int as n from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'audit_event_type' and (e.enumlabel like 'ops.%' or e.enumlabel like 'import.%' or e.enumlabel like 'calendar.%')`);
    expect(enumCount[0]!.n).toBe(11);
  });

  it("role scoping: coach and students are refused staff surfaces; staff cannot reach admin-only operations", async () => {
    for (const path of ["/api/admin/operations/exceptions", "/api/admin/operations/events", `/api/admin/calendar?${range}`]) {
      expect((await api().get(path).set(coach.bearer)).status, path).toBe(403);
      expect((await api().get(path).set(ada.user.bearer)).status, path).toBe(403);
      expect((await api().get(path).set(staff.bearer)).status, path).toBe(200);
    }
    expect((await api().get("/api/admin/operations/diagnostics").set(staff.bearer)).status).toBe(403);
    expect((await api().post("/api/admin/operations/concierge/run").set(staff.auth)).status).toBe(403);
    expect((await api().get(`/api/student/calendar?${range}`).set(staff.bearer)).status).toBe(403);
    expect((await api().get(`/api/student/calendar?${range}`).set(coach.bearer)).status).toBe(403);
    expect((await api().get(`/api/admin/calendar?${range}`)).status).toBe(401);
  });

  let eventId = "";
  it("schedules an advisor meeting (CSRF required), refuses a duplicate, and the student sees it but not another student's", async () => {
    const body = { studentId: ada.student.id, kind: "advisor_meeting", title: "Advisor meeting", startsAt: at(5, 14), endsAt: at(5, 15), timeZone: "America/Toronto", location: "Video call" };
    expect((await api().post("/api/admin/calendar/events").set(staff.bearer).send(body)).status).toBe(403);
    const res = await api().post("/api/admin/calendar/events").set(staff.auth).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    eventId = res.body.id;
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

  it("rescheduling notifies the student (in-app + email), cancelling is final, and events are recorded", async () => {
    holder.delivered.length = 0;
    const moved = await api().patch(`/api/admin/calendar/events/${eventId}`).set(admin.auth).send({ startsAt: at(6, 14), endsAt: at(6, 15) });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.change).toBe("rescheduled");
    const notes = await api().get("/api/notifications").set(ada.user.bearer);
    expect(notes.body.notifications.some((n: any) => n.kind === "calendar.event_changed" && n.params.change === "rescheduled")).toBe(true);
    expect(holder.delivered.some((m) => m.to === ada.user.email)).toBe(true);
    // another user cannot mark Ada's notification read
    const id = notes.body.notifications[0].id;
    expect((await api().post(`/api/notifications/${id}/read`).set(ben.user.auth)).body.updated).toBe(0);
    expect((await api().post(`/api/notifications/${id}/read`).set(ada.user.auth)).body.updated).toBe(1);
    const cancelled = await api().patch(`/api/admin/calendar/events/${eventId}`).set(admin.auth).send({ status: "cancelled" });
    expect(cancelled.body.change).toBe("cancelled");
    expect((await api().patch(`/api/admin/calendar/events/${eventId}`).set(admin.auth).send({ title: "x" })).status).toBe(409);
    const events = await api().get(`/api/admin/operations/events?studentId=${ada.student.id}`).set(staff.bearer);
    expect(events.body.events.map((e: any) => e.kind)).toEqual(expect.arrayContaining(["calendar.event_scheduled", "calendar.event_rescheduled", "calendar.event_cancelled"]));
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

  it("the Proactive Concierge reminds the student and the owner once (idempotent) and records its run", async () => {
    holder.delivered.length = 0;
    const first = await api().post("/api/admin/operations/concierge/run").set(admin.auth);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.created).toBeGreaterThanOrEqual(2);
    const ada1 = await api().get("/api/notifications").set(ada.user.bearer);
    expect(ada1.body.notifications.some((n: any) => n.kind === "reminder.deadline")).toBe(true);
    const own = await api().get("/api/notifications").set(admin.bearer);
    expect(own.body.notifications.some((n: any) => n.kind === "reminder.deadline" && n.params.studentName === "Ada Synthetic")).toBe(true);
    const second = await api().post("/api/admin/operations/concierge/run").set(admin.auth);
    expect(second.body.created).toBe(0);
    const diag = await api().get("/api/admin/operations/diagnostics").set(admin.bearer);
    expect(diag.status).toBe(200);
    const by = Object.fromEntries(diag.body.checks.map((c: any) => [c.key, c]));
    expect(by.schema.status).toBe("ok");
    expect(by.concierge.code).toBe("ok");
    expect(by.calendar.facts.activeFeeds).toBe(1);
    expect(by.notifications.facts.emailTransport).toBe(true);
  });

  it("exceptions merge the Control Center queue with owner state (acknowledge / snooze / reopen; admin only)", async () => {
    const list = await api().get("/api/admin/operations/exceptions").set(staff.bearer);
    expect(list.status).toBe(200);
    const ex = list.body.exceptions.find((e: any) => e.studentId === ada.student.id && e.kind === "deadline_soon");
    expect(ex).toBeTruthy();
    const path = `/api/admin/operations/exceptions/${encodeURIComponent(ex.id)}`;
    expect((await api().patch(path).set(staff.auth).send({ state: "acknowledged" })).status).toBe(403);
    expect((await api().patch(path).set(admin.auth).send({ state: "snoozed" })).status).toBe(400);
    expect((await api().patch(path).set(admin.auth).send({ state: "snoozed", snoozeDays: 3 })).body.state).toBe("snoozed");
    const after = await api().get("/api/admin/operations/exceptions").set(admin.bearer);
    expect(after.body.exceptions.find((e: any) => e.id === ex.id).state).toBe("snoozed");
    expect((await api().patch(path).set(admin.auth).send({ state: "open" })).body.state).toBe("open");
    expect((await api().patch("/api/admin/operations/exceptions/nope:none").set(admin.auth).send({ state: "acknowledged" })).status).toBe(404);
  });

  it("an S27 orientation request feeds the operational event store", async () => {
    const res = await api().post("/api/student/orientation-sessions").set(ada.user.auth).send({ slotAt: at(9, 13), prep: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    let kinds: string[] = [];
    for (let i = 0; i < 20 && !kinds.includes("program.session_changed"); i++) {
      await new Promise((r) => setTimeout(r, 100));
      kinds = (await api().get(`/api/admin/operations/events?studentId=${ada.student.id}`).set(admin.bearer)).body.events.map((e: any) => e.kind);
    }
    expect(kinds).toContain("program.session_changed");
  });
});
