import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, allDayStartsAt, daysBetween, groupItemsByDay, itemDayKeys, localDateTime, localDayKey, monthGrid, rangeForView,
  startOfWeek, weekDays, weekdayLabels, zoneOffsetMs, zonedToUtcIso, formatDate, formatTime,
} from "../client/src/lib/calendar-dates";
import { s30CalendarEn, s30CalendarFr } from "../client/src/i18n/modules/s30-calendar";
import { CALENDAR_ITEM_KINDS, type CalendarItem } from "../shared/s30-contract";
import { CHECKPOINT_KEYS } from "../shared/s27-contract";

const item = (over: Partial<CalendarItem>): CalendarItem => ({
  id: "x", kind: "advisor_meeting", source: "calendar_event", studentId: "s", studentName: "S", studentCode: null, isDemo: false,
  title: "t", titleKey: null, start: "2026-03-08T15:00:00.000Z", end: null, allDay: false, timeZone: "UTC", status: "scheduled",
  location: null, href: "/", editable: false, recordId: "r", ...over,
});

describe("date arithmetic", () => {
  it("adds days and months without zone drift", () => {
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(daysBetween("2026-03-01", "2026-04-01")).toBe(31);
  });
  it("week starts", () => {
    expect(startOfWeek("2026-11-01", 0)).toBe("2026-11-01"); // Sunday
    expect(startOfWeek("2026-11-01", 1)).toBe("2026-10-26");
    expect(weekDays("2026-11-04", 1)).toHaveLength(7);
  });
});

describe("month grid", () => {
  it("covers whole weeks and flags the month", () => {
    const g = monthGrid("2026-02-15", 1); // Feb 2026 starts on Sunday, 28 days
    expect(g.every((r) => r.length === 7)).toBe(true);
    expect(g[0]![0]!.date).toBe("2026-01-26");
    expect(g[g.length - 1]![6]!.date).toBe("2026-03-01");
    expect(g.flat().filter((c) => c.inMonth)).toHaveLength(28);
    expect(g).toHaveLength(5);
  });
  it("Sunday start", () => {
    const g = monthGrid("2026-02-15", 0);
    expect(g[0]![0]!.date).toBe("2026-02-01");
    expect(g).toHaveLength(4);
  });
  it("six rows when needed and ranges stay within the 120-day API limit", () => {
    expect(monthGrid("2026-08-10", 1)).toHaveLength(6);
    for (const v of ["month", "week", "agenda"] as const) {
      const r = rangeForView(v, "2026-08-10", 1);
      expect(daysBetween(r.from, r.to)).toBeLessThanOrEqual(41);
    }
    expect(rangeForView("week", "2026-11-04", 1)).toEqual({ from: "2026-11-02", to: "2026-11-08" });
  });
  it("weekday labels follow the week start", () => {
    expect(weekdayLabels("en", 1, "short")[0]).toMatch(/^Mon/);
    expect(weekdayLabels("en", 0, "short")[0]).toMatch(/^Sun/);
  });
});

describe("time zones", () => {
  it("Toronto offsets across DST", () => {
    expect(zoneOffsetMs(Date.parse("2026-01-15T12:00:00Z"), "America/Toronto")).toBe(-5 * 3600_000);
    expect(zoneOffsetMs(Date.parse("2026-07-15T12:00:00Z"), "America/Toronto")).toBe(-4 * 3600_000);
  });
  it("groups an evening instant by the local day, not the UTC day", () => {
    // 2026-07-15 23:30 Toronto (EDT) = 2026-07-16T03:30Z
    expect(localDayKey("2026-07-16T03:30:00Z", "America/Toronto")).toBe("2026-07-15");
    expect(localDayKey("2026-07-16T03:30:00Z", "UTC")).toBe("2026-07-16");
    // winter: 23:30 EST = 04:30Z
    expect(localDayKey("2026-01-16T04:30:00Z", "America/Toronto")).toBe("2026-01-15");
  });
  it("DST transition days keep sensible grouping (Toronto spring forward 2026-03-08)", () => {
    const items = [
      item({ id: "a", start: "2026-03-08T04:30:00Z" }), // 23:30 EST on the 7th
      item({ id: "b", start: "2026-03-08T05:30:00Z" }), // 00:30 EST on the 8th
      item({ id: "c", start: "2026-03-09T03:30:00Z" }), // 23:30 EDT on the 8th
      item({ id: "d", start: "2026-03-09T04:30:00Z" }), // 00:30 EDT on the 9th
    ];
    const g = groupItemsByDay(items, "America/Toronto");
    expect(g.get("2026-03-07")!.map((i) => i.id)).toEqual(["a"]);
    expect(g.get("2026-03-08")!.map((i) => i.id)).toEqual(["b", "c"]);
    expect(g.get("2026-03-09")!.map((i) => i.id)).toEqual(["d"]);
  });
  it("fall back day (Toronto 2026-11-01) is a single local day", () => {
    const g = groupItemsByDay([
      item({ id: "a", start: "2026-11-01T04:30:00Z" }), // 00:30 EDT
      item({ id: "b", start: "2026-11-02T04:30:00Z" }), // 23:30 EST, still the 1st (day is 25 hours long)
      item({ id: "c", start: "2026-11-02T05:30:00Z" }), // 00:30 EST on the 2nd
    ], "America/Toronto");
    expect(g.get("2026-11-01")!.map((i) => i.id)).toEqual(["a", "b"]);
    expect(g.get("2026-11-02")!.map((i) => i.id)).toEqual(["c"]);
  });
  it("Africa/Casablanca (UTC+1, UTC+0 during Ramadan) groups by local day", () => {
    // 2026-03-01: Morocco is on UTC+0 during Ramadan (about Feb 19 to Mar 22 2026): 23:30Z is 23:30 local
    expect(localDayKey("2026-03-01T23:30:00Z", "Africa/Casablanca")).toBe("2026-03-01");
    // outside Ramadan UTC+1: 23:30Z is already the next day
    expect(localDayKey("2026-06-01T23:30:00Z", "Africa/Casablanca")).toBe("2026-06-02");
    const g = groupItemsByDay([item({ id: "a", start: "2026-06-01T23:30:00Z" })], "Africa/Casablanca");
    expect([...g.keys()]).toEqual(["2026-06-02"]);
  });
  it("zonedToUtcIso converts wall time and round-trips", () => {
    expect(zonedToUtcIso("2026-07-15", "09:00", "America/Toronto")).toBe("2026-07-15T13:00:00.000Z");
    expect(zonedToUtcIso("2026-01-15", "09:00", "America/Toronto")).toBe("2026-01-15T14:00:00.000Z");
    expect(zonedToUtcIso("2026-06-01", "09:00", "Africa/Casablanca")).toBe("2026-06-01T08:00:00.000Z");
    for (const [d, t, z] of [["2026-03-08", "12:00", "America/Toronto"], ["2026-11-01", "12:00", "America/Toronto"], ["2026-06-01", "23:45", "Africa/Casablanca"]] as const) {
      expect(localDateTime(zonedToUtcIso(d, t, z), z)).toEqual({ date: d, time: t });
    }
  });
  it("handles the DST gap and the repeated hour", () => {
    // 02:30 on 2026-03-08 does not exist in Toronto: resolves to just after the gap (03:30 EDT = 07:30Z)
    expect(zonedToUtcIso("2026-03-08", "02:30", "America/Toronto")).toBe("2026-03-08T07:30:00.000Z");
    // 01:30 on 2026-11-01 happens twice: first occurrence (EDT) = 05:30Z
    expect(zonedToUtcIso("2026-11-01", "01:30", "America/Toronto")).toBe("2026-11-01T05:30:00.000Z");
  });
});

describe("all-day items", () => {
  const zones = ["America/Toronto", "Africa/Casablanca", "Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"];
  it("stay on their date in every zone", () => {
    for (const z of zones) {
      const g = groupItemsByDay([item({ id: "d", allDay: true, start: "2026-03-08", timeZone: "UTC" })], z);
      expect([...g.keys()]).toEqual(["2026-03-08"]);
    }
  });
  it("multi-day spans are inclusive and zone-free", () => {
    expect(itemDayKeys({ allDay: true, start: "2026-03-07", end: "2026-03-09" }, "Pacific/Kiritimati")).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
  });
  it("formatting a calendar date ignores the viewer's zone", () => {
    expect(formatDate("2026-03-08", "en", { day: "numeric", month: "long" })).toBe("March 8");
    expect(allDayStartsAt("2026-03-08")).toBe("2026-03-08T00:00:00.000Z");
  });
  it("sorts all-day first, then timed by time", () => {
    const g = groupItemsByDay([
      item({ id: "t2", start: "2026-03-08T18:00:00Z" }), item({ id: "all", allDay: true, start: "2026-03-08" }), item({ id: "t1", start: "2026-03-08T15:00:00Z" }),
    ], "UTC");
    expect(g.get("2026-03-08")!.map((i) => i.id)).toEqual(["all", "t1", "t2"]);
  });
  it("timed spans across midnight cover both local days; an end at local midnight does not spill", () => {
    expect(itemDayKeys({ allDay: false, start: "2026-07-15T23:00:00Z", end: "2026-07-16T01:00:00Z" }, "UTC")).toEqual(["2026-07-15", "2026-07-16"]);
    expect(itemDayKeys({ allDay: false, start: "2026-07-15T22:00:00Z", end: "2026-07-16T00:00:00Z" }, "UTC")).toEqual(["2026-07-15"]);
  });
  it("formats times in the given zone", () => {
    expect(formatTime("2026-07-15T13:00:00Z", "America/Toronto", "en")).toMatch(/9:00/);
  });
});

describe("calendar strings", () => {
  const en = s30CalendarEn as Record<string, string>;
  const fr = s30CalendarFr as Record<string, string>;
  it("covers every kind, status, title key and checkpoint", () => {
    for (const k of CALENDAR_ITEM_KINDS) expect(en[`cal.kind.${k}`], k).toBeTruthy();
    for (const s of ["scheduled", "requested", "done", "cancelled", "overdue"]) expect(en[`cal.status.${s}`], s).toBeTruthy();
    for (const k of CHECKPOINT_KEYS) expect(en[`s30.cal.checkpoint.${k}`], k).toBeTruthy();
    for (const k of ["language_test", "prior_schooling_proof", "orientation", "courseEnd", "targetCompletion"]) expect(en[`s30.cal.title.${k}`], k).toBeTruthy();
  });
  it("French differs from English for every key and uses the typographic apostrophe", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(en).filter((k) => en[k] === fr[k])).toEqual([]);
    expect(Object.values(fr).filter((v) => v.includes("'"))).toEqual([]);
  });
});
