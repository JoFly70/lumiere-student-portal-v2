/**
 * S30 Phase A — pure units: iCalendar writer, calendar read model (role scoping, statuses, ranges) and the calendar
 * reminder plan handed to the S29 notification outbox through the calendar port. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { buildIcs, escapeText, foldLine, itemSummary } from "../server/services/s30/ics";
import { buildCalendarItems, type CalendarFacts } from "../server/services/s30/calendar";
import { planReminders, toNotifications } from "../server/services/s30/calendar-reminders";
import { calendarOperationsPort, calendarPortWired, setCalendarOperationsPort } from "../server/services/s30/calendar-port";
import type { CalendarItem } from "../shared/s30-contract";

const NOW = new Date("2026-11-10T15:00:00.000Z");

function facts(over: Partial<CalendarFacts> = {}): CalendarFacts {
  return {
    students: [
      { id: "s-a", code: "SYN-A", name: "Ada Synthetic", preferredName: null, userId: "u-a" },
      { id: "s-b", code: "SYN-B", name: "Ben Synthetic", preferredName: null, userId: "u-b" },
      { id: "s-d", code: "SYN-D", name: "Demo Person", preferredName: "DEMO-S30", userId: "u-d" },
    ],
    agreements: [{ studentId: "s-a", signedOn: "2026-10-13", activatedOn: "2026-10-01", languageTestDays: 30, priorSchoolingDays: 90, languageTestStatus: "open", languageTestDoneOn: null,
      priorSchoolingStatus: "open", priorSchoolingDoneOn: null, supportMonths: 9, accessMonths: 36 }],
    checkpoints: [{ studentId: "s-a", key: "kickoff_call", plannedOn: "2026-11-05", doneOn: "2026-11-05" }, { studentId: "s-b", key: "midpoint_check", plannedOn: "2026-11-01", doneOn: null }],
    sessions: [{ id: "sess-1", studentId: "s-a", slotAt: "2026-11-11T09:00:00.000Z", status: "confirmed" }],
    plans: [{ studentId: "s-b", content: { courses: [{ key: "eng-9", title: "English 9 — Core", status: "planned", plannedEnd: "2026-11-20", tasks: [{ key: "u1", title: "Unit 1", dueDate: "2026-11-08" }, { key: "u2", title: "Unit 2", dueDate: "2026-11-12" }] }], pacing: { targetCompletionDate: "2026-12-01" } }, logged: new Set(["eng-9\u0000u1"]) }],
    degreeRoadmaps: [{ studentId: "s-a", milestones: [{ key: "m1", title: "Capstone ready", targetDate: "2026-11-25" }] }],
    events: [
      { id: "e-1", studentId: "s-a", kind: "advisor_meeting", title: "Advisor meeting", startsAt: "2026-11-12T14:00:00.000Z", endsAt: "2026-11-12T14:30:00.000Z", allDay: false, timeZone: "America/Toronto", location: "Video", status: "scheduled", visibleToStudent: true, sequence: 0 },
      { id: "e-2", studentId: "s-a", kind: "support_session", title: "Staff prep (internal)", startsAt: "2026-11-13T14:00:00.000Z", endsAt: null, allDay: false, timeZone: "UTC", location: null, status: "scheduled", visibleToStudent: false, sequence: 0 },
      { id: "e-3", studentId: "s-d", kind: "advisor_meeting", title: "Demo meeting", startsAt: "2026-11-12T10:00:00.000Z", endsAt: null, allDay: false, timeZone: "UTC", location: null, status: "scheduled", visibleToStudent: true, sequence: 0 },
    ],
    truncated: false,
    ...over,
  };
}
const RANGE = { from: "2026-11-01", to: "2026-11-30" };

describe("calendar read model", () => {
  it("derives deadlines, checkpoints, sessions, plan milestones, roadmap milestones and scheduled events with statuses", () => {
    const items = buildCalendarItems(facts(), { role: "admin" }, RANGE, NOW);
    const byId = new Map(items.map((i) => [i.id, i] as const));
    expect(byId.get("agreement:s-a:language_test")).toMatchObject({ kind: "academic_deadline", start: "2026-11-12", allDay: true, status: "scheduled", href: "/admin/students/s-a?tab=overview" });
    expect(byId.get("checkpoint:s-a:kickoff_call")?.status).toBe("done");
    expect(byId.get("checkpoint:s-b:midpoint_check")?.status).toBe("overdue");
    expect(byId.get("orientation:sess-1")).toMatchObject({ kind: "orientation", allDay: false, end: "2026-11-11T09:30:00.000Z", editable: true });
    expect(byId.get("hsplan:s-b:eng-9:u1")?.status).toBe("done");
    expect(byId.get("hsplan:s-b:eng-9:u2")).toMatchObject({ status: "scheduled", title: "English 9 — Unit 2" });
    expect(byId.get("roadmap:s-a:m1")?.kind).toBe("course_milestone");
    expect(byId.get("event:e-1")).toMatchObject({ kind: "advisor_meeting", editable: true, location: "Video" });
    expect(items.some((i) => i.studentId === "s-d")).toBe(false); // demo hidden by default for staff
    expect(buildCalendarItems(facts(), { role: "admin" }, RANGE, NOW, { includeDemo: true }).some((i) => i.studentId === "s-d")).toBe(true);
    // ordered by start
    const keys = items.map((i) => (i.allDay ? `${i.start}T00:00:00.000Z` : i.start));
    expect([...keys].sort()).toEqual(keys);
  });

  it("a student sees only their own items, never staff-only events, never another student's identity, and cannot edit", () => {
    const items = buildCalendarItems(facts(), { role: "student", studentId: "s-a" }, RANGE, NOW);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.studentId === "s-a")).toBe(true);
    expect(items.some((i) => i.id === "event:e-2")).toBe(false);
    expect(items.every((i) => !i.editable && i.studentName === null && i.studentCode === null)).toBe(true);
    expect(items.find((i) => i.id === "agreement:s-a:prior_schooling_proof")).toBeUndefined(); // due 2026-12-30, outside range
    expect(items.find((i) => i.id === "event:e-1")?.href).toBe("/calendar");
  });

  it("staff cannot reschedule orientation sessions (admin-only S27 endpoint), and ranges are respected", () => {
    const staff = buildCalendarItems(facts(), { role: "staff" }, RANGE, NOW);
    expect(staff.find((i) => i.id === "orientation:sess-1")?.editable).toBe(false);
    const narrow = buildCalendarItems(facts(), { role: "admin" }, { from: "2026-11-20", to: "2026-11-21" }, NOW);
    expect(narrow.map((i) => i.id)).toEqual(["hsplan:s-b:eng-9:end"]);
  });
});

describe("iCalendar writer", () => {
  const items = buildCalendarItems(facts(), { role: "admin" }, RANGE, NOW);
  it("writes a valid VCALENDAR with UTC timed events, exclusive all-day DTEND, CRLF and reminders", () => {
    const ics = buildIcs(items, { calendarName: "Test, calendar", lang: "en", privacy: "detailed", baseUrl: "https://portal.synthetic.example", audience: "staff", now: NOW });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("X-WR-CALNAME:Test\\, calendar");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261112\r\nDTEND;VALUE=DATE:20261113");
    expect(ics).toContain("DTSTART:20261112T140000Z\r\nDTEND:20261112T143000Z");
    expect(ics).toContain("UID:event:e-1@lumiere-portal");
    expect(ics).toContain("URL:https://portal.synthetic.example/admin/students/s-a?tab=sessions");
    expect(ics).toContain("TRIGGER:-PT1H");
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(items.length);
  });
  it("minimal privacy hides names, titles and locations", () => {
    const ev = items.find((i) => i.id === "event:e-1")!;
    expect(itemSummary(ev, { lang: "fr", privacy: "minimal", audience: "staff" })).toBe("Rendez-vous avec la conseillère ou le conseiller · SYN-A");
    expect(itemSummary(ev, { lang: "en", privacy: "minimal", audience: "student" })).toBe("Advisor meeting");
    const ics = buildIcs([ev], { calendarName: "x", lang: "en", privacy: "minimal", baseUrl: null, audience: "staff", now: NOW });
    expect(ics).not.toContain("Ada");
    expect(ics).not.toContain("LOCATION");
  });
  it("escapes and folds safely (UTF-8 aware)", () => {
    expect(escapeText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
    const long = `SUMMARY:${"é".repeat(80)}`;
    const folded = foldLine(long);
    expect(folded.split("\r\n ").join("")).toBe(long);
    expect(folded.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});

describe("calendar reminder plan", () => {
  const mk = (over: Partial<CalendarItem>): CalendarItem => ({
    id: "x", kind: "academic_deadline", source: "agreement", studentId: "s-a", studentName: null, studentCode: null, isDemo: false, title: "t", titleKey: null,
    start: "2026-11-12", end: null, allDay: true, timeZone: "UTC", status: "scheduled", location: null, href: "/", editable: false, recordId: "r", ...over,
  });
  it("deadlines at 3 days and on the day; appointments within 24h; milestones at 2 days (student only); nothing for done/overdue", () => {
    const plan = planReminders([
      mk({ id: "d3", start: "2026-11-12" }),
      mk({ id: "d0", start: "2026-11-10", kind: "document_deadline" }),
      mk({ id: "d5", start: "2026-11-15" }),
      mk({ id: "a1", kind: "advisor_meeting", allDay: false, start: "2026-11-11T09:00:00.000Z" }),
      mk({ id: "a2", kind: "orientation", allDay: false, start: "2026-11-12T16:00:00.000Z" }),
      mk({ id: "a3", kind: "orientation", allDay: false, start: "2026-11-11T08:00:00.000Z", status: "requested" }),
      mk({ id: "m1", kind: "course_milestone", start: "2026-11-11" }),
      mk({ id: "done", status: "done", start: "2026-11-11" }),
      mk({ id: "late", status: "overdue", start: "2026-11-09" }),
    ], NOW);
    const by = new Map(plan.map((p) => [p.item.id, p] as const));
    expect([...by.keys()].sort()).toEqual(["a1", "a3", "d0", "d3", "m1"]);
    expect(by.get("d3")).toMatchObject({ window: "3d", kind: "calendar.reminder.deadline", toAdmins: true, allowEmail: true });
    expect(by.get("d0")?.window).toBe("0d");
    expect(by.get("a1")).toMatchObject({ window: "24h", kind: "calendar.reminder.appointment", toStudent: true });
    expect(by.get("a3")?.toStudent).toBe(false); // a request not yet confirmed: owner only
    expect(by.get("m1")).toMatchObject({ toAdmins: false, allowEmail: false });
  });
});


describe("reminders -> S29 outbox notifications (through the calendar port)", () => {
  const items = buildCalendarItems(facts(), { role: "admin" }, RANGE, NOW, { includeDemo: true });
  const plan = planReminders(items, NOW);
  it("addresses the student's user and the administrators with stable dedupe keys; demo students never reach administrators", () => {
    const out = toNotifications(plan, new Map([["s-a", "u-a"], ["s-b", "u-b"], ["s-d", "u-d"]]), ["admin-1"]);
    const deadline = out.filter((n) => n.dedupeKey.startsWith("calendar-reminder:agreement:s-a:language_test:"));
    expect(deadline.map((n) => n.recipientUserId).sort()).toEqual(["admin-1", "u-a"]);
    expect(deadline.find((n) => n.audience === "student")).toMatchObject({ href: "/calendar", allowEmail: true, params: { date: "2026-11-12", itemKind: "academic_deadline" } });
    expect(deadline.find((n) => n.audience === "staff")).toMatchObject({ allowEmail: false, href: "/admin/students/s-a?tab=overview" });
    expect(out.some((n) => n.recipientUserId === "admin-1" && n.params.studentId === "s-d")).toBe(false);
    const again = toNotifications(planReminders(items, NOW), new Map([["s-a", "u-a"]]), ["admin-1"]);
    expect(again.map((n) => n.dedupeKey)).toEqual(expect.arrayContaining(deadline.map((n) => n.dedupeKey)));
    // no record free text in params
    expect(out.every((n) => Object.keys(n.params).every((k) => ["date", "itemKind", "titleKey", "change", "studentId"].includes(k)))).toBe(true);
  });
  it("the default port is an explicit no-op until S26 wires S29", async () => {
    setCalendarOperationsPort(null);
    expect(calendarPortWired()).toBe(false);
    expect(await calendarOperationsPort().enqueueNotification(toNotifications(plan, new Map([["s-a", "u-a"]]), [])[0]!)).toBe("not_wired");
    const seen: string[] = [];
    setCalendarOperationsPort({ recordEvent: async () => "accepted", enqueueNotification: async (n) => { seen.push(n.dedupeKey); return "accepted"; } });
    expect(calendarPortWired()).toBe(true);
    await calendarOperationsPort().enqueueNotification(toNotifications(plan, new Map([["s-a", "u-a"]]), [])[0]!);
    expect(seen).toHaveLength(1);
    setCalendarOperationsPort(null);
  });
});
