import { describe, expect, it } from "vitest";
import {
  PREVIEW_AREAS,
  PREVIEW_COURSES,
  PREVIEW_PROGRAM,
  areaTotals,
  cellsFor,
  previewSubjects,
  sumTotals,
  totalsFor,
} from "../client/src/lib/flight-deck-preview-data";

describe("Flight Deck preview data invariants (synthetic)", () => {
  it("21 credits = 16 core + 5 elective, in half-units 42 / 32 / 10", () => {
    expect(PREVIEW_PROGRAM.requiredHalfUnits).toBe(42);
    expect(PREVIEW_PROGRAM.coreHalfUnits + PREVIEW_PROGRAM.electiveHalfUnits).toBe(42);
    const core = PREVIEW_AREAS.filter((a) => a.kind === "core").reduce((n, a) => n + a.requiredHalfUnits, 0);
    const elective = PREVIEW_AREAS.filter((a) => a.kind === "elective").reduce((n, a) => n + a.requiredHalfUnits, 0);
    expect(core).toBe(PREVIEW_PROGRAM.coreHalfUnits);
    expect(elective).toBe(PREVIEW_PROGRAM.electiveHalfUnits);
    expect(totalsFor("core").verified + totalsFor("core").in_progress + totalsFor("core").planned + totalsFor("core").open).toBe(32);
  });
  it("statuses sum to the requirement for every area, subject and the whole program", () => {
    for (const a of PREVIEW_AREAS) expect(sumTotals(areaTotals(a)), a.key).toBe(a.requiredHalfUnits);
    for (const s of previewSubjects()) expect(sumTotals(s.totals), s.subject).toBe(s.requiredHalfUnits);
    expect(sumTotals(totalsFor("all"))).toBe(42);
    expect(sumTotals(totalsFor("core")) + sumTotals(totalsFor("elective"))).toBe(42);
  });
  it("no area is over-assigned and every course belongs to an area", () => {
    for (const a of PREVIEW_AREAS) {
      const assigned = PREVIEW_COURSES.filter((c) => c.areaKey === a.key).reduce((n, c) => n + c.halfUnits, 0);
      expect(assigned, a.key).toBeLessThanOrEqual(a.requiredHalfUnits);
    }
    for (const c of PREVIEW_COURSES) expect(PREVIEW_AREAS.some((a) => a.key === c.areaKey), c.key).toBe(true);
    expect(Number.isInteger(PREVIEW_COURSES.reduce((n, c) => n + c.halfUnits, 0))).toBe(true);
  });
  it("the whole-program split is the documented sample (16 / 10 / 9 / 7) and the strip has one cell per half-unit", () => {
    expect(totalsFor("all")).toEqual({ verified: 16, in_progress: 10, planned: 9, open: 7 });
    expect(cellsFor(totalsFor("all"))).toHaveLength(42);
  });
  it("real vocabulary is present: U.S. History and Health and Nutrition, a half-credit course exists", () => {
    const titles = PREVIEW_COURSES.map((c) => c.title);
    expect(titles).toContain("U.S. History");
    expect(titles).toContain("Health and Nutrition");
    expect(PREVIEW_COURSES.some((c) => c.halfUnits === 1)).toBe(true);
  });
});
