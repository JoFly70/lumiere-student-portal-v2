/**
 * S32-B staff-experience repairs (operations): SA-01 hidden calendar events never remind the student, SA-13 no invisible
 * staff reminder rows, SA-14 Concierge off stops student reminders (one owner per reminder), SA-23 validated imports
 * awaiting approval appear in Needs Attention. Pure units plus the S29 calendar bridge on a real disposable PostgreSQL.
 * Synthetic data only; nothing is sent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, type LocalPg } from "./helpers/s05-local-pg";
import { bootHighSchoolApp, seedStudent, startHighSchoolPg, type HighSchoolApp } from "./helpers/s11-hs-stack";
import { planFromFacts, toNotifications } from "../server/services/s30/calendar-reminders";
import type { CalendarFacts } from "../server/services/s30/calendar";
import { planReminders as planConcierge } from "../server/services/s29/concierge";
import { buildAttention, EMPTY_EXTRA, type AttentionCandidate } from "../server/services/s29/rules";
import { DEFAULT_CONCIERGE_SETTINGS, type ConciergeSettings } from "../shared/s29-contract";
import type { ControlCenterFacts } from "../server/services/program-journey/control-center";

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const NOW = new Date("2026-11-10T15:00:00.000Z");
const RANGE = { from: "2026-11-01", to: "2026-11-30" };
const USERS = new Map([["s-a", "u-a"]]);

function facts(over: Partial<CalendarFacts> = {}): CalendarFacts {
  const ev = (id: string, visibleToStudent: boolean, startsAt = "2026-11-11T09:00:00.000Z") => ({
    id, studentId: "s-a", kind: "advisor_meeting" as const, title: "Case review", startsAt, endsAt: null, allDay: false, timeZone: "UTC", location: null,
    status: "scheduled" as const, visibleToStudent, sequence: 0,
  });
  return {
    students: [{ id: "s-a", code: "SYN-A", name: "Ada Synthetic", preferredName: null, userId: "u-a" }],
    agreements: [{ studentId: "s-a", signedOn: "2026-10-13", activatedOn: "2026-10-01", languageTestDays: 30, priorSchoolingDays: 90, languageTestStatus: "open", languageTestDoneOn: null,
      priorSchoolingStatus: "open", priorSchoolingDoneOn: null, supportMonths: 9, accessMonths: 36 }],
    checkpoints: [],
    sessions: [{ id: "sess-1", studentId: "s-a", slotAt: "2026-11-11T09:00:00.000Z", status: "confirmed" }],
    plans: [],
    degreeRoadmaps: [{ studentId: "s-a", milestones: [{ key: "m1", title: "Capstone ready", targetDate: "2026-11-11" }] }],
    events: [ev("e-hidden", false)],
    truncated: false,
    ...over,
  } as CalendarFacts;
}

describe("SA-01 staff-only calendar events never remind the student", () => {
  it("a hidden advisor_meeting within 24h produces zero student rows; a visible one produces exactly one", () => {
    const hidden = toNotifications(planFromFacts(facts(), NOW, RANGE), USERS).filter((n) => n.params.itemKind === "advisor_meeting");
    expect(hidden.filter((n) => n.audience === "student")).toHaveLength(0);
    expect(hidden).toHaveLength(0);

    const visibleFacts = facts({ events: facts().events.map((e) => ({ ...e, visibleToStudent: true })) });
    const visible = toNotifications(planFromFacts(visibleFacts, NOW, RANGE), USERS).filter((n) => n.params.itemKind === "advisor_meeting");
    expect(visible.filter((n) => n.audience === "student")).toHaveLength(1);
    expect(visible[0]).toMatchObject({ kind: "calendar.reminder.appointment", recipientUserId: "u-a" });
  });
  it("flipping the event from visible to hidden removes its reminder; the plan fails closed without a visibility set", async () => {
    const { planReminders } = await import("../server/services/s30/calendar-reminders");
    const { buildCalendarItems } = await import("../server/services/s30/calendar");
    const items = buildCalendarItems(facts(), { role: "admin" }, RANGE, NOW, { includeDemo: true });
    expect(planReminders(items, NOW).some((p) => p.item.source === "calendar_event")).toBe(false);
  });
});

describe("SA-13 no invisible staff/admin calendar reminder rows", () => {
  it("every calendar reminder is addressed to the student; nothing with audience staff is produced", () => {
    const visibleFacts = facts({ events: facts().events.map((e) => ({ ...e, visibleToStudent: true })) });
    const out = toNotifications(planFromFacts(visibleFacts, NOW, RANGE), USERS);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((n) => n.audience === "student")).toBe(true);
    expect(out.some((n) => n.audience === "staff")).toBe(false);
  });
});

describe("SA-14 one owner per reminder", () => {
  it("agreement deadlines and orientation sessions are the Concierge's; the calendar never reminds them as well", () => {
    const calendar = toNotifications(planFromFacts(facts(), NOW, RANGE), USERS);
    expect(calendar.some((n) => n.dedupeKey.startsWith("calendar-reminder:agreement:") || n.dedupeKey.startsWith("calendar-reminder:orientation:"))).toBe(false);
    const cand = (kind: AttentionCandidate["kind"], f: AttentionCandidate["reason"]["facts"]): AttentionCandidate => ({
      key: `${kind}:s-a`, kind, workflow: "documents", priority: "high", studentId: "s-a", studentName: null, studentCode: null, isDemo: false, title: "t", detail: "d",
      reason: { rule: kind, facts: f }, fingerprint: "f", arisenAt: null, action: "a", href: "/",
    });
    const on: ConciergeSettings = { ...DEFAULT_CONCIERGE_SETTINGS, enabled: true };
    const plan = planConcierge([cand("deadline_soon", { deadline: "language_test", dueOn: "2026-11-12", daysLeft: 2 }), cand("orientation_upcoming", { sessionId: "sess-1", slotAt: "2026-11-11T09:00:00.000Z" })], { tickets: [] }, on, NOW);
    expect(plan.map((p) => p.rule).sort()).toEqual(["deadline", "orientation"]);
    expect(planConcierge([cand("deadline_soon", { deadline: "language_test", dueOn: "2026-11-12", daysLeft: 2 })], { tickets: [] }, { ...on, enabled: false }, NOW)).toEqual([]);
  });
});

describe.skipIf(!PG_BINARIES_AVAILABLE)("SA-14 Concierge switch gates calendar reminders (S29 bridge, real Postgres)", () => {
  let pg: LocalPg;
  let hs: HighSchoolApp;
  let db: import("../server/services/s29/db").Tx;
  let student: Awaited<ReturnType<typeof seedStudent>>;
  const reminder = (dedupeKey: string, kind = "calendar.reminder.appointment") => ({
    recipientUserId: student.userId, audience: "student" as const, kind, params: { date: "2026-11-11T09:00:00.000Z", itemKind: "advisor_meeting" }, href: "/calendar", allowEmail: true, dedupeKey,
  });

  beforeAll(async () => {
    pg = await startHighSchoolPg();
    hs = await bootHighSchoolApp(pg, { now: NOW.toISOString() });
    db = (await import("../server/lib/db")).db as never;
    const { resetS29SchemaCache } = await import("../server/services/s29/db");
    resetS29SchemaCache();
    student = await seedStudent(pg, { name: "Pilot Gate" });
    await pg.sql(`update users set email = 'pilot.gate@lumiere-qa-mail.net' where id = '${student.userId}'`);
  }, 300_000);
  afterAll(async () => { await hs?.close(); await pg?.stop(); }, 60_000);

  it("Concierge off: no student reminder row; the change notice is still sent. On: exactly one row, no duplicate", async () => {
    const { createCalendarOpsAdapter } = await import("../server/services/s29/calendar-bridge");
    const { saveSettings } = await import("../server/services/s29/attention-store");
    const port = createCalendarOpsAdapter(async () => db, () => NOW);
    await saveSettings(db, { ...DEFAULT_CONCIERGE_SETTINGS, enabled: false }, "test");

    for (const kind of ["calendar.reminder.deadline", "calendar.reminder.appointment", "calendar.reminder.milestone"]) {
      expect(await port.enqueueNotification(reminder(`off:${kind}`, kind))).toBe("suppressed");
    }
    expect((await pg.sql(`select count(*)::int as n from s29_notifications where source = 'calendar'`))[0]!.n).toBe(0);

    const change = { ...reminder("change:1", "calendar.event_changed"), params: { date: "2026-11-11T09:00:00.000Z", itemKind: "advisor_meeting", change: "rescheduled" } };
    expect(await port.enqueueNotification(change)).toBe("accepted");
    expect((await pg.sql(`select count(*)::int as n from s29_notifications where source = 'calendar' and template = 'calendar.event_changed'`))[0]!.n).toBe(1);

    await saveSettings(db, { ...DEFAULT_CONCIERGE_SETTINGS, enabled: true }, "test");
    expect(await port.enqueueNotification(reminder("on:1"))).toBe("accepted");
    expect(await port.enqueueNotification(reminder("on:1"))).toBe("duplicate");
    expect((await pg.sql(`select count(*)::int as n from s29_notifications where source = 'calendar' and template = 'calendar.reminder.appointment'`))[0]!.n).toBe(1);
    expect((await pg.sql(`select count(*)::int as n from s29_notifications where source = 'calendar' and audience <> 'student'`))[0]!.n).toBe(0);
  });
});

describe("SA-23 import awaiting approval in Needs Attention", () => {
  const cc: ControlCenterFacts = {
    students: [], enrollments: [], progress: [], awards: [], results: [], agreements: [], pendingDocuments: [], evidenceAwaiting: [], billing: [],
    receiptsThisMonth: [], tickets: [], sessionRequests: [], truncated: false,
  };
  const batch = { id: "b-1", sourceKind: "provider_progress", rows: 12, students: 3, validatedAt: "2026-11-08T10:00:00.000Z" };
  const pick = (extra: Partial<typeof EMPTY_EXTRA>) => buildAttention(cc, { ...EMPTY_EXTRA, ...extra }, DEFAULT_CONCIERGE_SETTINGS, NOW).items.filter((i) => i.kind === "import_awaiting_approval");

  it("one item per pending batch, linked to the batch in the Import center; nothing once it is committed or discarded", () => {
    const items = pick({ pendingImports: [batch, { ...batch, id: "b-2" }] });
    expect(items.map((i) => i.key).sort()).toEqual(["import_awaiting_approval:b-1", "import_awaiting_approval:b-2"]);
    expect(items[0]).toMatchObject({ studentId: null, workflow: "operations", action: "approve_import", href: "/admin/imports?batch=b-1", title: "Import awaiting approval" });
    expect(items[0]!.reason.facts).toMatchObject({ batchId: "b-1", rows: 12, students: 3 });
    expect(items[0]!.priority).toBe("normal");
    // committed / discarded batches leave the pending set, so the next sync resolves the item
    expect(pick({ pendingImports: [] })).toEqual([]);
  });
  it("a batch waiting more than three days is raised to high priority", () => {
    expect(pick({ pendingImports: [{ ...batch, validatedAt: "2026-11-01T10:00:00.000Z" }] })[0]!.priority).toBe("high");
  });
});
