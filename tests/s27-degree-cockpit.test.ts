import { describe, expect, it } from "vitest";
import type { StudentRoadmapItemView, StudentRoadmapPhaseView, StudentRoadmapView } from "../shared/student-roadmap-contract";
import type { StudentDegreeProgressView, StudentRequirementView } from "../shared/student-degree-progress-view";
import {
  buildDegreeStops, degreeFigures, degreeNextTask, degreeNotes, degreeOpenTasks, degreePlanDates, degreeRequirementRows,
} from "../client/src/lib/s27/degree-cockpit-model";
import { buildRadarChips, weekAgenda } from "../client/src/lib/s27/cockpit-model";
import { HIGH_SCHOOL_FLIGHT_DECK_PATH, HIGH_SCHOOL_PATH, highSchoolRouteRedirect, programKinds } from "../client/src/lib/student-programs";
import { translate } from "../client/src/i18n";

const TODAY = "2026-10-29";

function task(key: string, status: "not_started" | "in_progress" | "submitted" | "graded", dueDate: string | null = null) {
  return { key, kind: "challenge" as const, title: `Task ${key}`, dueDate, status, revision: 0, updatedAt: null };
}
function item(over: Partial<StudentRoadmapItemView> & { key: string }): StudentRoadmapItemView {
  return {
    phaseKey: "gen", objectiveKey: "o1", sequence: 1, kind: "course", code: null, title: `Course ${over.key}`, provider: "Sophia Learning", institution: null,
    credits: "3", plannedStart: null, plannedEnd: null, planStatus: "planned", holdReason: null, approval: null, alternativeOf: null,
    studentNote: null, waitingOn: [], itemStatus: "not_started", itemRevision: 0, tasks: [],
    taskCounts: { total: 0, graded: 0, submitted: 0, inProgress: 0, notStarted: 0 },
    stage: "not_started", official: null, canReport: true, reportBlockedReason: null, ...over,
  } as StudentRoadmapItemView;
}
function phase(key: string, sequence: number, items: StudentRoadmapItemView[], extra: Partial<StudentRoadmapPhaseView> = {}): StudentRoadmapPhaseView {
  return { key, title: key === "gen" ? "General education" : "Business major", sequence, objectiveKey: null, startDate: null, endDate: null, description: null, items, counts: {} as never, state: "current", ...extra };
}
function roadmap(phases: StudentRoadmapPhaseView[], over: Partial<StudentRoadmapView> = {}): StudentRoadmapView {
  return {
    contractVersion: "student-roadmap/1", state: "PUBLISHED", preview: false,
    plan: { title: "Plan", summary: null, versionNumber: 1, publishedAt: null },
    objectives: [], phases, milestones: [], counts: {} as never,
    today: { focusItemKeys: [], headline: "", detail: "", nextMilestoneKey: null },
    foundation: { credentials: [], sources: [], degreeState: "COMPOSED", ladder: { reported: "0", provisional: "0", verified: "60", applied: "60", surplus: null, planned: "0", required: "120" } },
    history: { previousVersions: [], retiredProgress: [] }, ...over,
  } as StudentRoadmapView;
}
const req = (id: string, title: string, required: string, applied: string, status: StudentRequirementView["status"] = "PARTIAL"): StudentRequirementView => ({
  requirementId: id, code: id.toUpperCase(), title, sequence: 1, status, unit: "credit", requiredAmount: required, appliedAmount: applied,
  remainingAmount: String(Number(required) - Number(applied)), appliedCreditRecordIds: [],
} as StudentRequirementView);
function progress(requirements: StudentRequirementView[] = []): StudentDegreeProgressView {
  return {
    contractVersion: "student-degree-progress/1", state: "COMPOSED", asOf: null, program: null,
    totals: { unit: "credit", requiredCredits: "120", appliedCredits: "60", remainingCredits: "60", verifiedCreditsOnRecord: "60", requirementsSatisfied: 1, requirementsTotal: requirements.length },
    requirements, attention: [], milestones: [], nextSteps: [], sources: [], credits: [],
  } as unknown as StudentDegreeProgressView;
}

const GEN = [
  item({ key: "eng101", title: "English Composition I", stage: "in_progress", tasks: [task("c1", "graded", "2026-10-20"), task("c2", "in_progress", "2026-11-02"), task("c3", "not_started", "2026-11-09")], taskCounts: { total: 3, graded: 1, submitted: 0, inProgress: 1, notStarted: 1 }, plannedEnd: "2026-11-23" }),
  item({ key: "his110", title: "U.S. History I", plannedEnd: "2026-12-07" }),
  item({ key: "sci110", title: "Environmental Science", planStatus: "hold", canReport: false, reportBlockedReason: "approval_pending" }),
];
const BUS = [item({ key: "eco201", title: "Microeconomics", phaseKey: "bus", plannedEnd: "2027-01-04" }), item({ key: "acc210", title: "Financial Accounting", phaseKey: "bus" })];

describe("degree cockpit: credits", () => {
  it("applied / required / planned come from degree progress and the roadmap, never mixed", () => {
    const rm = roadmap([phase("gen", 1, GEN), phase("bus", 2, BUS)]);
    const f = degreeFigures(rm, progress());
    expect(f).toMatchObject({ known: true, required: 120, confirmed: 60, planned: 15, remaining: 60, earnedKnown: true });
    expect(f.fraction).toBe(0.5);
  });
  it("no required total means no chart (unknown, not zero)", () => {
    const rm = roadmap([phase("gen", 1, GEN)], { foundation: { credentials: [], sources: [], degreeState: "NO_ACTIVE_PROGRAM", ladder: { reported: "0", provisional: "0", verified: "0", applied: null, surplus: null, planned: "0", required: null } } as never });
    expect(degreeFigures(rm, null)).toMatchObject({ known: false, required: 0, earnedKnown: false });
  });
  it("credits by source reuse the degree-journey model (earned / planned by provider / open)", () => {
    const rm = roadmap([phase("gen", 1, GEN), phase("bus", 2, BUS)]);
    const groups = degreeFigures(rm, progress()).source.segments.map((s) => s.group);
    expect(groups).toContain("earned");
    expect(groups).toContain("planned");
    expect(groups).toContain("open");
  });
});

describe("degree cockpit: requirement groups", () => {
  it("one row per requirement with applied/required credits; unknown amounts stay null", () => {
    const rows = degreeRequirementRows(progress([
      req("gen", "General education", "36", "36", "SATISFIED"),
      req("bus", "Business major", "36", "12"),
      req("res", "Residency", "15", "0", "MISSING"),
      { ...req("x", "Capstone review", "0", "0", "MANUAL_REVIEW"), requiredAmount: null, appliedAmount: null, remainingAmount: null } as StudentRequirementView,
    ]));
    expect(rows.map((r) => [r.label, r.applied, r.required, r.done, r.review])).toEqual([
      ["General education", 36, 36, true, false], ["Business major", 12, 36, false, false], ["Residency", 0, 15, false, false], ["Capstone review", null, null, false, true],
    ]);
  });
  it("is empty unless the canonical record is composed", () => {
    expect(degreeRequirementRows(null)).toEqual([]);
    expect(degreeRequirementRows({ ...progress([req("a", "A", "3", "0")]), state: "UNDER_REVIEW" } as StudentDegreeProgressView)).toEqual([]);
  });
  it("the residency warning leads the notes", () => {
    const p = progress([req("res", "Residency (institution-taught term course)", "15", "0", "MISSING")]);
    const rm = roadmap([phase("gen", 1, GEN)]);
    const notes = degreeNotes(rm, p);
    expect(notes[0]).toMatchObject({ key: "dj.warn.residency", params: { n: "15" } });
    expect(notes.some((n) => n.key === "dj.warn.approval")).toBe(true);
    expect(degreeNotes(rm, p, 1)).toHaveLength(1);
  });
});

describe("degree cockpit: Up next / Next 7 days", () => {
  const rm = roadmap([phase("gen", 1, GEN), phase("bus", 2, BUS)]);
  it("offers started courses first, open tasks only, never held courses", () => {
    const open = degreeOpenTasks(rm, TODAY);
    expect(open.map((o) => `${o.courseKey}:${o.key}`)).toEqual(["eng101:c2", "eng101:c3", "his110:course", "eco201:course", "acc210:course"]);
    expect(open.find((o) => o.courseKey === "sci110")).toBeUndefined();
    expect(open[2]).toMatchObject({ courseLevel: true, dueDate: "2026-12-07", credits: 3 });
  });
  it("the next task is the first open one; overdue work leads", () => {
    expect(degreeNextTask(degreeOpenTasks(rm, TODAY))).toMatchObject({ courseKey: "eng101", key: "c2", overdue: false });
    const late = roadmap([phase("gen", 1, [item({ key: "a", tasks: [task("t1", "not_started", "2026-10-10")] }), item({ key: "b", tasks: [task("t2", "not_started", "2026-10-01")] })])]);
    expect(degreeNextTask(degreeOpenTasks(late, TODAY))).toMatchObject({ courseKey: "b", overdue: true });
  });
  it("no open work gives no next task (designed empty state)", () => {
    expect(degreeNextTask(degreeOpenTasks(roadmap([phase("gen", 1, [item({ key: "d", stage: "officially_accepted" })])]), TODAY))).toBeNull();
  });
  it("the shared week agenda works on degree tasks", () => {
    const week = weekAgenda(degreeOpenTasks(rm, TODAY), TODAY);
    expect(week.map((w) => w.key)).toEqual(["c2"]);
  });
});

describe("degree cockpit: flight path", () => {
  it("stops are cumulative planned credits per phase, below the degree total", () => {
    const rm = roadmap([phase("gen", 1, GEN, { endDate: "2026-12-20" }), phase("bus", 2, BUS, { endDate: "2027-03-20" })]);
    const stops = buildDegreeStops(rm, { required: 120, confirmed: 60 });
    // hold course (3) is still planned credit; 3 + 3 + 3 = 9 in gen, then 6 in bus
    expect(stops.map((s) => [s.name, s.credits, s.targetOn])).toEqual([["General education", 69, "2026-12-20"], ["Business major", 75, "2027-03-20"]]);
  });
  it("a stop at or beyond the total, or too close to the seal to label, is dropped; no plan means no stops", () => {
    const rm = roadmap([phase("gen", 1, GEN)]);
    expect(buildDegreeStops(rm, { required: 62, confirmed: 60 })).toEqual([]);
    expect(buildDegreeStops(rm, { required: 72, confirmed: 60 })).toEqual([]); // 69 is 96% of 72
    expect(buildDegreeStops(roadmap([]), { required: 120, confirmed: 60 })).toEqual([]);
    expect(buildDegreeStops(rm, { required: 0, confirmed: 0 })).toEqual([]);
  });
  it("caps at three stops, spread across the plan", () => {
    const many = Array.from({ length: 8 }, (_, i) => phase(`p${i}`, i + 1, [item({ key: `i${i}`, phaseKey: `p${i}` })]));
    expect(buildDegreeStops(roadmap(many), { required: 120, confirmed: 60 })).toHaveLength(3);
  });
  it("plan start is the earliest phase start; graduation is the graduation milestone date only", () => {
    const rm = roadmap([phase("gen", 1, GEN, { startDate: "2026-10-01" }), phase("bus", 2, BUS, { startDate: "2026-09-15" })], {
      milestones: [
        { key: "cp", title: "Checkpoint", kind: "checkpoint", targetDate: "2027-01-01", objectiveKey: null, reached: false, remainingItems: 2 },
        { key: "grad", title: "Graduation", kind: "graduation", targetDate: "2027-03-31", objectiveKey: null, reached: false, remainingItems: 5 },
      ],
    });
    expect(degreePlanDates(rm)).toEqual({ startsOn: "2026-09-15", graduationOn: "2027-03-31" });
    expect(degreePlanDates(roadmap([phase("gen", 1, GEN)]))).toEqual({ startsOn: null, graduationOn: null });
  });
});

describe("degree cockpit: radar links", () => {
  it("roadmap-related chips link to the degree roadmap, not the high-school page", () => {
    const chips = buildRadarChips({ electivesAwaiting: 0, coursesAwaitingSchool: 2, journey: null, tickets: [], today: TODAY, roadmapHref: "/roadmap" });
    expect(chips.map((c) => [c.key, c.href])).toEqual([["waiting", "/roadmap"]]);
    expect(buildRadarChips({ electivesAwaiting: 0, coursesAwaitingSchool: 2, journey: null, tickets: [], today: TODAY })[0]!.href).toBe("/high-school");
  });
});

describe("high-school routes for degree students", () => {
  const prog = (...kinds: string[]) => ({ programs: kinds.map((kind, i) => ({ kind, id: String(i), title: kind, status: "active", current: true })) }) as never;
  it("a degree-only student is redirected to the degree equivalents", () => {
    const k = programKinds(prog("university_degree"));
    expect(highSchoolRouteRedirect(HIGH_SCHOOL_PATH, k)).toBe("/roadmap");
    expect(highSchoolRouteRedirect(HIGH_SCHOOL_FLIGHT_DECK_PATH, k)).toBe("/flight-deck");
    expect(highSchoolRouteRedirect("/high-school/", k)).toBe("/roadmap");
    expect(highSchoolRouteRedirect("/high-school?log=english-3", k)).toBe("/roadmap");
    expect(highSchoolRouteRedirect("/documents", k)).toBeNull();
  });
  it("high-school and both-program students keep every page; a student with no program keeps the neutral empty state", () => {
    for (const k of [programKinds(prog("high_school")), programKinds(prog("high_school", "university_degree")), programKinds(prog()), programKinds(undefined)]) {
      expect(highSchoolRouteRedirect(HIGH_SCHOOL_PATH, k)).toBeNull();
      expect(highSchoolRouteRedirect(HIGH_SCHOOL_FLIGHT_DECK_PATH, k)).toBeNull();
    }
  });
  it("the no-program empty states do not assume high school, in either language", () => {
    for (const lang of ["en", "fr"] as const) {
      const text = ["cockpit.state.noEnrollment.title", "cockpit.state.noEnrollment.body", "hs.noEnrollment.title", "hs.noEnrollment.body"].map((k) => translate(lang, k as never)).join(" ");
      expect(text).not.toMatch(/high school|lycée|secondaires?/i);
    }
  });
});
