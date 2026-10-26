import { describe, expect, it } from "vitest";
import {
  roadmapContentSchema,
  type RoadmapContent,
} from "@shared/student-roadmap-contract";
import {
  diffRoadmapContent,
  parseRoadmapContent,
  validateRoadmapContent,
} from "@shared/student-roadmap-validation";

function make(overrides: Partial<Record<string, unknown>> = {}): RoadmapContent {
  return roadmapContentSchema.parse({
    contentVersion: "roadmap-content/1",
    title: "Plan",
    objectives: [{ key: "bs", title: "BS Biology", kind: "primary", linkedToProgramAssignment: true }],
    phases: [{ key: "p1", title: "Phase 1", sequence: 1 }],
    items: [
      { key: "a", phaseKey: "p1", objectiveKey: "bs", sequence: 1, title: "A", tasks: [{ key: "challenge-1", kind: "challenge", title: "C1", sequence: 1 }] },
      { key: "b", phaseKey: "p1", objectiveKey: "bs", sequence: 2, title: "B", dependsOn: ["a"] },
    ],
    ...overrides,
  });
}
const codes = (c: RoadmapContent) => validateRoadmapContent(c).map((e) => e.code);

describe("validateRoadmapContent", () => {
  it("accepts a clean document", () => {
    expect(validateRoadmapContent(make())).toEqual([]);
  });

  it("flags duplicate keys as blocking", () => {
    const c = make({
      objectives: [
        { key: "bs", title: "x", kind: "primary" },
        { key: "bs", title: "y", kind: "secondary" },
      ],
      phases: [
        { key: "p1", title: "x", sequence: 1 },
        { key: "p1", title: "y", sequence: 2 },
      ],
      items: [
        { key: "a", phaseKey: "p1", objectiveKey: "bs", sequence: 1, title: "A", tasks: [{ key: "t", kind: "other", title: "T", sequence: 1 }, { key: "t", kind: "other", title: "T2", sequence: 2 }] },
        { key: "a", phaseKey: "p1", objectiveKey: "bs", sequence: 2, title: "A2" },
      ],
    });
    const ex = validateRoadmapContent(c);
    for (const code of ["DUPLICATE_OBJECTIVE_KEY", "DUPLICATE_PHASE_KEY", "DUPLICATE_ITEM_KEY", "DUPLICATE_TASK_KEY"]) {
      const hit = ex.find((e) => e.code === code);
      expect(hit?.severity, code).toBe("blocking");
    }
  });

  it("flags unknown phase/objective/dependency/alternative/milestone refs", () => {
    const c = make({
      items: [
        { key: "a", phaseKey: "nope", objectiveKey: "nope", sequence: 1, title: "A", dependsOn: ["ghost"], alternativeOf: "ghost" },
      ],
      milestones: [{ key: "m", title: "M", kind: "checkpoint", afterItemKeys: ["ghost"], objectiveKey: "zzz" }],
    });
    const found = codes(c);
    expect(found).toEqual(
      expect.arrayContaining(["UNKNOWN_PHASE", "UNKNOWN_OBJECTIVE", "UNKNOWN_DEPENDENCY", "ALTERNATIVE_UNKNOWN_TARGET", "UNKNOWN_MILESTONE_ITEM"]),
    );
    expect(validateRoadmapContent(c).every((e) => e.severity === "blocking")).toBe(true);
  });

  it("detects dependency cycles and self dependencies once per cycle", () => {
    const c = make({
      items: [
        { key: "a", phaseKey: "p1", objectiveKey: "bs", sequence: 1, title: "A", dependsOn: ["c"] },
        { key: "b", phaseKey: "p1", objectiveKey: "bs", sequence: 2, title: "B", dependsOn: ["a"] },
        { key: "c", phaseKey: "p1", objectiveKey: "bs", sequence: 3, title: "C", dependsOn: ["b"] },
        { key: "d", phaseKey: "p1", objectiveKey: "bs", sequence: 4, title: "D", dependsOn: ["d"] },
        { key: "e", phaseKey: "p1", objectiveKey: "bs", sequence: 5, title: "E", dependsOn: ["a"] },
      ],
    });
    const cycles = validateRoadmapContent(c).filter((e) => e.code === "DEPENDENCY_CYCLE");
    expect(cycles.map((e) => e.key)).toEqual(["DEPENDENCY_CYCLE:a", "DEPENDENCY_CYCLE:d"]);
  });

  it("checks the primary objective count", () => {
    expect(codes(make({ objectives: [{ key: "bs", title: "x", kind: "secondary" }] }))).toContain("NO_PRIMARY_OBJECTIVE");
    expect(
      codes(make({ objectives: [{ key: "bs", title: "x", kind: "primary" }, { key: "ms", title: "y", kind: "primary" }] })),
    ).toContain("MULTIPLE_PRIMARY_OBJECTIVES");
  });

  it("DATE_ORDER is a warning for items and phases; hold without reason is blocking", () => {
    const c = make({
      phases: [{ key: "p1", title: "P", sequence: 1, startDate: "2026-05-01", endDate: "2026-04-01" }],
      items: [
        { key: "a", phaseKey: "p1", objectiveKey: "bs", sequence: 1, title: "A", plannedStart: "2026-03-01", plannedEnd: "2026-02-01" },
        { key: "h", phaseKey: "p1", objectiveKey: "bs", sequence: 2, title: "H", planStatus: "hold" },
      ],
    });
    const ex = validateRoadmapContent(c);
    expect(ex.filter((e) => e.code === "DATE_ORDER").map((e) => [e.key, e.severity])).toEqual([
      ["DATE_ORDER:phase:p1", "warning"],
      ["DATE_ORDER:a", "warning"],
    ]);
    expect(ex.find((e) => e.code === "HOLD_WITHOUT_REASON")).toMatchObject({ key: "HOLD_WITHOUT_REASON:h", severity: "blocking" });
  });

  it("rejects impossible calendar dates and has unique, deterministic keys", () => {
    const c = make({
      items: [{ key: "a", phaseKey: "p1", objectiveKey: "bs", sequence: 1, title: "A", plannedStart: "2026-02-31" }],
    });
    const first = validateRoadmapContent(c);
    expect(first.map((e) => e.code)).toEqual(["INVALID_DATE"]);
    expect(validateRoadmapContent(c)).toEqual(first);
    const keys = first.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("parseRoadmapContent", () => {
  it("returns content for valid input and path exceptions otherwise", () => {
    expect(parseRoadmapContent(make()).content).not.toBeNull();
    const bad = parseRoadmapContent({ contentVersion: "roadmap-content/1", title: "", objectives: [], phases: [], items: [] });
    expect(bad.content).toBeNull();
    expect(bad.exceptions.length).toBeGreaterThan(0);
    expect(bad.exceptions.every((e) => e.severity === "blocking" && !!e.ref.path)).toBe(true);
    expect(bad.exceptions.map((e) => e.ref.path)).toContain("title");
  });
});

describe("diffRoadmapContent", () => {
  const none = new Map<string, ReadonlySet<string>>();

  it("treats a first import as all added", () => {
    const { diff, exceptions } = diffRoadmapContent(null, make(), none, null);
    expect(diff.added.map((a) => a.itemKey)).toEqual(["a", "b"]);
    expect(exceptions).toEqual([]);
  });

  it("separates reschedule-only changes from substantive ones", () => {
    const prev = make();
    const next = make({
      items: [
        { key: "a", phaseKey: "p1", objectiveKey: "bs", sequence: 1, title: "A", plannedStart: "2026-02-01", tasks: [{ key: "challenge-1", kind: "challenge", title: "C1", sequence: 1 }] },
        { key: "b", phaseKey: "p1", objectiveKey: "bs", sequence: 2, title: "B renamed", dependsOn: ["a"] },
        { key: "n", phaseKey: "p1", objectiveKey: "bs", sequence: 3, title: "New" },
      ],
    });
    const { diff } = diffRoadmapContent(prev, next, none, 3);
    expect(diff.baseVersionNumber).toBe(3);
    expect(diff.added).toEqual([{ itemKey: "n", title: "New" }]);
    expect(diff.changed).toEqual([
      { itemKey: "a", title: "A", fields: ["plannedStart"], rescheduleOnly: true },
      { itemKey: "b", title: "B renamed", fields: ["title"], rescheduleOnly: false },
    ]);
    expect(diff.unchangedCount).toBe(0);
  });

  it("flags removed items with progress and removed tasks with progress", () => {
    const prev = make();
    const next = make({
      items: [{ key: "a", phaseKey: "p1", objectiveKey: "bs", sequence: 1, title: "A" }],
    });
    const progress = new Map<string, ReadonlySet<string>>([
      ["a", new Set(["challenge-1"])],
      ["b", new Set(["__item__"])],
    ]);
    const { diff, exceptions } = diffRoadmapContent(prev, next, progress, 1);
    expect(diff.removed).toEqual([{ itemKey: "b", title: "B", hasProgress: true }]);
    expect(exceptions.map((e) => [e.code, e.severity, e.key])).toEqual([
      ["PROGRESS_ON_REMOVED_TASK", "warning", "PROGRESS_ON_REMOVED_TASK:a/challenge-1"],
      ["PROGRESS_ON_REMOVED_ITEM", "warning", "PROGRESS_ON_REMOVED_ITEM:b"],
    ]);
    expect(exceptions[1]!.message).toMatch(/NOT transferred/);
  });

  it("removed items without progress produce no exception", () => {
    const next = make({ items: [{ key: "a", phaseKey: "p1", objectiveKey: "bs", sequence: 1, title: "A", tasks: [{ key: "challenge-1", kind: "challenge", title: "C1", sequence: 1 }] }] });
    const { diff, exceptions } = diffRoadmapContent(make(), next, none, 1);
    expect(diff.removed).toEqual([{ itemKey: "b", title: "B", hasProgress: false }]);
    expect(exceptions).toEqual([]);
  });

  it("flags a changed primary objective and reports objective/phase/milestone changes", () => {
    const next = make({
      objectives: [{ key: "bs", title: "BS Chemistry", kind: "primary", linkedToProgramAssignment: true }, { key: "mba", title: "MBA", kind: "secondary" }],
      phases: [{ key: "p1", title: "Renamed", sequence: 1 }],
      milestones: [{ key: "m", title: "M", kind: "checkpoint" }],
    });
    const { diff, exceptions } = diffRoadmapContent(make(), next, none, 1);
    expect(exceptions.map((e) => e.code)).toEqual(["OBJECTIVE_CHANGED"]);
    expect(diff.objectivesAdded).toEqual(["mba"]);
    expect(diff.objectivesChanged).toEqual(["bs"]);
    expect(diff.objectivesRemoved).toEqual([]);
    expect(diff.phasesChanged).toBe(true);
    expect(diff.milestonesChanged).toBe(true);
  });

  it("counts identical items as unchanged", () => {
    const { diff } = diffRoadmapContent(make(), make(), none, 1);
    expect(diff.unchangedCount).toBe(2);
    expect(diff.changed).toEqual([]);
  });
});
