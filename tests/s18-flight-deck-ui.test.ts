import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildCoverage,
  buildGauge,
  buildHeadline,
  buildLegend,
  buildMilestones,
  buildNextActions,
  buildProvenance,
  buildSubjectDetail,
  buildSubjectStrips,
  cellsFor,
  deckState,
  formatDay,
  formatMonth,
  tallyOf,
} from "../client/src/lib/academic-flight-deck-presentation";
import { filterStudentNav, flightDeckVariant, programAccess, studentLandingPath } from "../client/src/lib/student-programs";
import { isNoHighSchoolEnrollment } from "../client/src/lib/academic-projection-queries";
import { ApiError } from "../client/src/lib/api";
import type { StudentProgramsView } from "../shared/high-school-contract";
import { S18_COMPLETE, S18_NOT_CONFIGURED, S18_PARTIAL, S18_SCHOOL, S18_ZERO, makeProjection } from "./helpers/s18-flight-deck-fixtures";

const read = (p: string) => readFileSync(p, "utf8");
const prog = (...kinds: Array<"high_school" | "university_degree">): StudentProgramsView => ({
  programs: kinds.map((kind, i) => ({ kind, id: String(i), title: kind, status: "active", current: true })),
});

describe("fixture sanity (21 = 16 core + 5 elective, includes a half credit)", () => {
  it("configuration", () => {
    const c = S18_PARTIAL.credits;
    expect([c.total.requiredHalfUnits, c.core.requiredHalfUnits, c.elective.requiredHalfUnits]).toEqual([42, 32, 10]);
    expect(c.total.officialHalfUnits % 2).toBe(0); // 16 half-units, but individual courses include 1-half-unit ones
    expect(S18_PARTIAL.subjects.flatMap((s) => s.courses).some((x) => x.halfUnits === 1)).toBe(true);
  });
});

describe("official is never merged with awaiting / in progress / planned", () => {
  const t = tallyOf(S18_PARTIAL.credits.total);
  it("tally keeps the five categories separate and sums to the requirement", () => {
    expect(t.official).toBe(S18_PARTIAL.credits.total.officialHalfUnits);
    expect(t.official + t.awaiting_school + t.in_progress + t.planned + t.open).toBe(t.required);
    expect(t.awaiting_school).toBeGreaterThan(0);
    expect(t.planned).toBeGreaterThan(0);
  });
  it("gauge: official figure is identical in both modes; projected only adds the shown number", () => {
    const v = buildGauge(S18_PARTIAL, "verified");
    const p = buildGauge(S18_PARTIAL, "projected");
    expect(v.officialHalfUnits).toBe(p.officialHalfUnits);
    expect(v.shownHalfUnits).toBe(t.official);
    expect(p.shownHalfUnits).toBe(t.official + t.awaiting_school + t.in_progress + t.planned);
    expect(p.shownHalfUnits).toBeGreaterThan(v.shownHalfUnits);
    expect(v.segments.find((s) => s.status === "official")!.halfUnits).toBe(t.official);
    expect(v.segments.filter((s) => s.visible).map((s) => s.status)).toEqual(["official"]);
    expect(p.segments.every((s) => s.visible)).toBe(true);
    expect(v.caption).toBe("Official credit");
    expect(p.caption).toBe("Including planned");
  });
  it("planned-only plan has zero official credit in both modes", () => {
    for (const mode of ["verified", "projected"] as const) expect(buildGauge(S18_ZERO, mode).officialHalfUnits).toBe(0);
    expect(buildGauge(S18_ZERO, "verified").shownHalfUnits).toBe(0);
    expect(buildGauge(S18_ZERO, "projected").shownHalfUnits).toBeGreaterThan(0);
  });
  it("coverage rows and subject cells never turn planned into official", () => {
    for (const row of buildCoverage(S18_PARTIAL, "verified").main) expect(row.shown).toBe(row.tally.official);
    const cells = cellsFor(t, "verified");
    expect(cells.filter((c) => c === "official").length).toBe(t.official);
    expect(cells).not.toContain("planned");
    expect(cells).not.toContain("in_progress");
    expect(cellsFor(t, "projected").filter((c) => c === "official").length).toBe(t.official);
    const strips = buildSubjectStrips(S18_PARTIAL, "verified");
    for (const s of strips) expect(s.cells.filter((c) => c === "official").length).toBe(s.tally.official);
  });
  it("legend dims non-official statuses in verified mode", () => {
    const rows = buildLegend(S18_PARTIAL, "verified");
    expect(rows.filter((r) => r.dim).map((r) => r.status)).toEqual(["awaiting_school", "in_progress", "planned"]);
    expect(buildLegend(S18_PARTIAL, "projected").some((r) => r.dim)).toBe(false);
  });
  it("surplus planned credit beyond the requirement is not drawn as extra", () => {
    const over = tallyOf({ requiredHalfUnits: 4, officialHalfUnits: 2, awaitingSchoolHalfUnits: 0, inProgressHalfUnits: 0, plannedHalfUnits: 6 });
    expect(over.official).toBe(2);
    expect(over.planned).toBe(2);
    expect(over.clipped).toBe(true);
  });
});

describe("states", () => {
  it("not_configured is its own state and never a percentage", () => {
    expect(deckState(S18_NOT_CONFIGURED)).toBe("not_configured");
    expect(S18_NOT_CONFIGURED.credits.total.requiredHalfUnits).toBe(0);
    // a plan_published projection with no requirement is also not a 0%
    expect(deckState({ ...S18_PARTIAL, credits: { ...S18_PARTIAL.credits, total: { ...S18_PARTIAL.credits.total, requiredHalfUnits: 0 } } })).toBe("not_configured");
  });
  it("zero progress, partial, complete", () => {
    expect(deckState(S18_ZERO)).toBe("zero_progress");
    expect(deckState(S18_PARTIAL)).toBe("partial");
    expect(deckState(S18_COMPLETE)).toBe("complete");
    expect(S18_COMPLETE.credits.total.officialHalfUnits).toBe(42);
  });
  it("404 HS_NO_ENROLLMENT is detected, other errors are not", () => {
    expect(isNoHighSchoolEnrollment(new ApiError("none", 404, "HS_NO_ENROLLMENT"))).toBe(true);
    expect(isNoHighSchoolEnrollment(new ApiError("none", 404))).toBe(false);
    expect(isNoHighSchoolEnrollment(new ApiError("boom", 500, "HS_NO_ENROLLMENT"))).toBe(false);
    expect(isNoHighSchoolEnrollment(new Error("x"))).toBe(false);
  });
});

describe("half credits format", () => {
  it("1 half-unit is 0.5 and 3 is 1.5", () => {
    expect(buildHeadline(makeProjection({ courses: [{ key: "a", title: "A", area: "electives", hu: 1, basis: "official" }] }), "verified")).toContain("0.5 of 21 credits");
    const science = buildSubjectDetail(S18_PARTIAL, S18_PARTIAL.subjects.find((s) => s.subject === "science")!);
    expect(science.courses.find((c) => c.key === "science-lab")!.creditsText).toBe("0.5 credits");
    expect(science.courses.find((c) => c.key === "science-lab")!.halfUnitsText).toBe("1 half-unit");
    expect(science.tally.official).toBe(3);
    expect(buildCoverage(S18_PARTIAL, "verified").areas.find((r) => r.key === "area-science")!.text).toBe("1.5 of 3 credits");
  });
  it("whole credits have no decimals", () => {
    expect(buildGauge(S18_PARTIAL, "verified").tally.required).toBe(42);
    expect(buildHeadline(S18_PARTIAL, "verified")).toBe("8 of 21 credits are official");
  });
});

describe("drill-downs and metadata", () => {
  it("subject drawer lists courses with basis, status and tasks", () => {
    const eng = buildSubjectDetail(S18_PARTIAL, S18_PARTIAL.subjects.find((s) => s.subject === "english")!);
    const e3 = eng.courses.find((c) => c.key === "english-3")!;
    expect(e3.basisLabel).toBe("In progress");
    expect(e3.courseStatusLabel).toBe("In progress");
    expect(e3.tasks).toHaveLength(3);
    expect(e3.tasksText).toBe("1 of 3 tasks done");
    expect(eng.courses.find((c) => c.key === "english-1")!.basisLabel).toBe("Official");
    const hd = buildSubjectDetail(S18_PARTIAL, S18_PARTIAL.subjects.find((s) => s.subject === "humanities_digital")!);
    expect(hd.areas.length).toBe(2);
  });
  it("milestones: reached by official credit only, one current", () => {
    const ms = buildMilestones(S18_PARTIAL);
    expect(S18_PARTIAL.credits.total.officialHalfUnits).toBe(16);
    expect(ms.map((m) => m.state)).toEqual(["done", "done", "current", "upcoming", "upcoming"]);
    expect(ms[2]!.gapHalfUnits).toBe(8);
    expect(ms[0]!.gapHalfUnits).toBe(0);
    expect(ms[0]!.when).toBe("Sep 2026");
  });
  it("next actions route by kind", () => {
    const hrefs = Object.fromEntries(buildNextActions(S18_PARTIAL).map((a) => [a.kind, a.href]));
    expect(hrefs).toEqual({ overdue_task: "/high-school", next_task: "/high-school", documents_requested: "/documents" });
    expect(buildNextActions({ ...S18_PARTIAL, nextActions: [{ kind: "support_open", message: "m", courseKey: null, taskKey: null, dueDate: null, owner: "lumiere" }] })[0]!.href).toBe("/support");
    expect(buildNextActions(S18_PARTIAL).find((a) => a.kind === "overdue_task")!.tone).toBe("attention");
  });
  it("provenance names the school, plan version/date and template", () => {
    const p = buildProvenance(S18_PARTIAL);
    expect(p.officialDefinition).toContain(`confirmed by ${S18_SCHOOL}`);
    expect(p.plan).toBe("Plan version 3, published 30 Aug 2026.");
    expect(p.template).toContain("us-hs-diploma-21");
    expect(p.template).toContain("version 2");
  });
  it("date helpers", () => {
    expect(formatDay("2026-10-26T09:00:00Z")).toBe("26 Oct 2026");
    expect(formatMonth("2027-03")).toBe("Mar 2027");
    expect(formatDay(null)).toBe("");
  });
});

describe("navigation and landing rules", () => {
  const NAV = ["/flight-deck", "/high-school", "/roadmap", "/profile", "/documents", "/billing", "/support"].map((url) => ({ url }));
  const urls = (a: ReturnType<typeof programAccess>) => filterStudentNav(NAV, a).map((i) => i.url);
  it("HS-only students land on /flight-deck and see the high school variant", () => {
    const a = programAccess(prog("high_school"));
    expect(studentLandingPath(a)).toBe("/flight-deck");
    expect(flightDeckVariant(a)).toBe("high_school");
  });
  it("university and mixed students keep the university deck; unknown access too", () => {
    expect(flightDeckVariant(programAccess(prog("university_degree")))).toBe("university");
    expect(flightDeckVariant(programAccess(prog("high_school", "university_degree")))).toBe("university");
    expect(flightDeckVariant(programAccess(undefined))).toBe("university");
  });
  it("HS-only nav: Flight Deck then High School first, no Roadmap, Billing kept", () => {
    const u = urls(programAccess(prog("high_school")));
    expect(u.slice(0, 2)).toEqual(["/flight-deck", "/high-school"]);
    expect(u).not.toContain("/roadmap");
    for (const keep of ["/profile", "/documents", "/support", "/billing"]) expect(u).toContain(keep);
  });
  it("mixed students see everything; university-only students have no High School", () => {
    expect(urls(programAccess(prog("high_school", "university_degree")))).toEqual(NAV.map((i) => i.url));
    expect(urls(programAccess(prog("university_degree")))).not.toContain("/high-school");
  });
});

describe("source hygiene", () => {
  const files = [
    "client/src/pages/high-school-flight-deck.tsx",
    "client/src/components/os/academic-instruments.tsx",
    "client/src/lib/academic-flight-deck-presentation.ts",
    "client/src/lib/academic-projection-queries.ts",
    "client/src/pages/flight-deck-router.tsx",
  ];
  it("the real page never imports the synthetic preview data or components", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/flight-deck-preview-data/);
      expect(src, f).not.toMatch(/components\/os\/(credit-gauge|flight-deck-instruments|subject-sheet|prototype-banner)/);
      expect(src, f).not.toMatch(/PREVIEW_|previewSubjects/);
    }
  });
  it("credits are formatted with formatHalfUnits and the page reads the projection endpoint", () => {
    expect(read("client/src/lib/academic-flight-deck-presentation.ts")).toContain("formatHalfUnits");
    expect(read("client/src/lib/academic-projection-queries.ts")).toContain("ACADEMIC_PROJECTION_API");
  });
  it("the page reserves an empty assistant slot and has the required states", () => {
    const page = read("client/src/pages/high-school-flight-deck.tsx");
    expect(page).toContain('data-slot="academic-assistant"');
    for (const id of ["not-configured", "hs-flight-deck-skeleton", "hs-flight-deck-no-enrollment", "button-retry"]) {
      expect(page + read("client/src/components/student-progress/states.tsx")).toContain(id);
    }
    expect(page).toContain("Your plan is being prepared");
  });
  it("the router picks the deck by program access", () => {
    const router = read("client/src/pages/flight-deck-router.tsx");
    expect(router).toContain("flightDeckVariant(access)");
    expect(router).toContain("<FlightDeck />");
    expect(router).toContain("<HighSchoolFlightDeck />");
  });
});
