import { describe, expect, it } from "vitest";
import {
  actualPace, arcGeometry, arrivalIso, beadFractions, buildAlertCards, buildFlightStops, buildRadarChips, clampPace, deadlinesToWatch, plannerOutputs, pointOnArc,
  presetValue, ringFraction, severityFor, spanParts, weekAgenda, weekOfProgram, weeksVersusTarget,
} from "../client/src/lib/s27/cockpit-model";
import { s27Journey, S27_TODAY } from "./helpers/s27-fixtures";

describe("S27 countdown alert cards", () => {
  const journey = s27Journey();
  const agreement = journey.agreement!;
  const next = { title: "Exam 4", courseKey: "english-3", courseTitle: "English 3", dueDate: "2026-11-02" };

  it("builds task, open deadline, support and a check card for a done deadline, in that order", () => {
    const cards = buildAlertCards({ nextTask: next, agreement, today: S27_TODAY });
    expect(cards.map((c) => c.kind)).toEqual(["task", "deadline", "support", "deadline"]);
    expect(cards[0]).toMatchObject({ big: 4, unit: "days", severity: "info" });
    expect(cards[1]).toMatchObject({ deadlineKey: "prior_schooling_proof", big: 38, done: false, severity: "warn" });
    expect(cards[2]).toMatchObject({ big: 7, unit: "months", severity: "ok" });
    expect(cards[3]).toMatchObject({ deadlineKey: "language_test", done: true, severity: "ok", detail: "Score 112 (target 105–115)" });
  });
  it("a deadline within 3 days or overdue is critical; late shows days overdue", () => {
    expect(severityFor(3, "warn")).toBe("crit");
    expect(severityFor(4, "warn")).toBe("warn");
    const overdue = { ...agreement, deadlines: [{ ...agreement.deadlines[1]!, dueOn: "2026-10-27", daysLeft: -2 }] };
    const [c] = buildAlertCards({ nextTask: null, agreement: overdue, today: S27_TODAY });
    expect(c).toMatchObject({ severity: "crit", unit: "overdue", big: 2 });
  });
  it("waived deadlines and open deadlines without a date make no card; the support card needs an end date", () => {
    const a = { ...agreement, supportEndsOn: null, supportMonthsLeft: null, deadlines: [{ ...agreement.deadlines[1]!, status: "waived" as const }, { ...agreement.deadlines[1]!, dueOn: null }] };
    expect(buildAlertCards({ nextTask: null, agreement: a, today: S27_TODAY })).toEqual([]);
  });
  it("caps at four cards by default and honours max", () => {
    expect(buildAlertCards({ nextTask: next, agreement, today: S27_TODAY, max: 2 })).toHaveLength(2);
    expect(buildAlertCards({ nextTask: next, agreement, today: S27_TODAY })).toHaveLength(4);
  });
  it("ring fraction is the remaining share of the window, never empty", () => {
    expect(ringFraction(45, 90)).toBe(0.5);
    expect(ringFraction(0, 90)).toBe(0.02);
    expect(ringFraction(200, 90)).toBe(1);
    expect(ringFraction(null, 90)).toBe(0);
  });
  it("counts open deadlines due within 30 days for the status pill", () => {
    expect(deadlinesToWatch(agreement)).toBe(0);
    expect(deadlinesToWatch({ ...agreement, deadlines: [{ ...agreement.deadlines[1]!, daysLeft: 12 }] })).toBe(1);
  });
  it("week of program from the enrollment window", () => {
    expect(weekOfProgram("2026-09-07", "2026-12-28", S27_TODAY)).toEqual({ week: 8, total: 16 });
    expect(weekOfProgram(null, "2026-12-28", S27_TODAY)).toBeNull();
  });
});

describe("S27 radar chips", () => {
  it("lists electives, next checkpoint, waiting courses, advisor replies and the last log", () => {
    const chips = buildRadarChips({ electivesAwaiting: 5, coursesAwaitingSchool: 1, journey: s27Journey(), tickets: [{ status: "in_progress", last_public_reply_by: "staff" }], today: S27_TODAY });
    expect(chips.map((c) => c.key)).toEqual(["electives", "checkpoint", "waiting", "support", "logged"]);
    expect(chips.at(-1)).toMatchObject({ tone: "ok", n: 1 });
  });
  it("a stale log turns the chip amber", () => {
    const j = s27Journey();
    const chips = buildRadarChips({ electivesAwaiting: 0, coursesAwaitingSchool: 0, journey: { ...j, pace: { ...j.pace!, lastLoggedOn: "2026-10-10" } }, tickets: null, today: S27_TODAY });
    expect(chips.find((c) => c.key === "logged")).toMatchObject({ tone: "warn", n: 19 });
  });
});

describe("S27 pace planner math", () => {
  it("clamps and rounds the slider to 1.0-3.0 in tenths", () => {
    expect(clampPace(0.4)).toBe(1);
    expect(clampPace(3.7)).toBe(3);
    expect(clampPace(1.26)).toBe(1.3);
  });
  it("presets: actual follows the logged pace, the others are fixed", () => {
    expect(presetValue("actual", 1.6)).toBe(1.6);
    expect(presetValue("actual", null)).toBeNull();
    expect([presetValue("steady", 1.6), presetValue("accelerated", 1.6), presetValue("sprint", 1.6)]).toEqual([1.2, 2, 2.6]);
  });
  it("actual pace comes from the journey and is null without logs", () => {
    expect(actualPace(s27Journey())).toBe(1.6);
    expect(actualPace(null)).toBeNull();
  });
  it("arrival = today + remaining / pace weeks", () => {
    expect(arrivalIso("2026-10-29", 12, 1.6)).toBe("2026-12-21");
    expect(arrivalIso("2026-10-29", 0, 1.6)).toBe("2026-10-29");
    expect(arrivalIso("2026-10-29", 12, 0)).toBeNull();
  });
  it("weeks before (+) or after (-) the plan's target", () => {
    expect(weeksVersusTarget("2026-12-14", "2026-12-28")).toBe(2);
    expect(weeksVersusTarget("2027-01-11", "2026-12-28")).toBe(-2);
    expect(weeksVersusTarget("2026-12-28", "2026-12-28")).toBe(0);
    expect(weeksVersusTarget(null, "2026-12-28")).toBeNull();
  });
  it("span splits weeks into months and weeks (a 4-week remainder rolls into the month)", () => {
    expect(spanParts(105)).toEqual({ months: 3, weeks: 2 });
    expect(spanParts(0)).toEqual({ months: 0, weeks: 0 });
    expect(spanParts(28)).toEqual({ months: 1, weeks: 0 });
  });
  it("outputs for a scenario", () => {
    const o = plannerOutputs({ today: "2026-10-29", startedOn: "2026-09-07", targetOn: "2026-12-28", remaining: 12, pace: 2 });
    expect(o).toMatchObject({ arrival: "2026-12-10", weeksVsTarget: 3, creditsLeft: 12, weeksToGo: 6 });
    expect(o.wholeProgram).toEqual({ months: 3, weeks: 0 });
    expect(plannerOutputs({ today: "2026-10-29", startedOn: null, targetOn: null, remaining: 12, pace: null }).arrival).toBeNull();
  });
});

describe("S27 flight path geometry", () => {
  it("the arc runs from the left baseline to the right baseline and peaks in between", () => {
    const g = arcGeometry(1000, 340);
    expect(pointOnArc(g, 0)).toEqual(g.A);
    expect(pointOnArc(g, 1)).toEqual(g.B);
    expect(pointOnArc(g, 0.5).y).toBeLessThan(g.A.y);
    expect(g.narrow).toBe(false);
    expect(arcGeometry(390, 280).narrow).toBe(true);
  });
  it("one bead per projected week until the diploma", () => {
    const beads = beadFractions(9, 21, 2);
    expect(beads).toHaveLength(5);
    expect(beads[0]).toBeCloseTo(11 / 21);
    expect(beadFractions(9, 21, null)).toEqual([]);
  });
  it("stops come from the accelerated plan bands, drop empty or full ones, and mark reached stops", () => {
    const stops = buildFlightStops({
      required: 21, confirmed: 9,
      bands: [{ from: 1, to: 4, cumulativeHalfUnits: 6 }, { from: 5, to: 8, cumulativeHalfUnits: 16 }, { from: 9, to: 13, cumulativeHalfUnits: 32 }],
      milestones: null,
    });
    expect(stops.map((s) => [s.id, s.credits, s.reached])).toEqual([["foundations", 3, true], ["momentum", 8, true], ["summit", 16, false]]);
  });
  it("falls back to monthly milestones, and shows no stops without plan data", () => {
    const m = [4, 9, 15, 21].map((c, i) => ({ month: `2026-${String(9 + i).padStart(2, "0")}`, cumulativeHalfUnits: c * 2 }));
    expect(buildFlightStops({ required: 21, confirmed: 0, bands: null, milestones: m }).map((s) => s.credits)).toEqual([4, 9, 15]);
    expect(buildFlightStops({ required: 21, confirmed: 0, bands: null, milestones: null })).toEqual([]);
  });
});

describe("S27 next-7-days agenda", () => {
  const t = (key: string, dueDate: string | null, overdue = false) => ({ courseKey: "c", courseTitle: "C", key, title: key, dueDate, overdue });
  it("keeps overdue work first, then work due within 7 days in date order", () => {
    const out = weekAgenda([t("far", "2026-11-20"), t("b", "2026-11-04"), t("late", "2026-10-20", true), t("a", "2026-10-30"), t("none", null)], S27_TODAY);
    expect(out.map((x) => x.key)).toEqual(["late", "a", "b"]);
  });
});
