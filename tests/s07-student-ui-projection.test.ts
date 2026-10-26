/** S07 projection: one current phase, Today focus without submitted tasks, planned credit. */
import { describe, expect, it } from "vitest";
import { projectStudentRoadmap } from "../shared/student-roadmap-projection";
import {
  ROADMAP_CONTENT_VERSION,
  roadmapContentSchema,
  type RoadmapContent,
  type RoadmapProgressRecord,
} from "../shared/student-roadmap-contract";

function content(items: unknown[]): RoadmapContent {
  return roadmapContentSchema.parse({
    contentVersion: ROADMAP_CONTENT_VERSION,
    title: "Plan",
    objectives: [{ key: "ba", title: "BA", kind: "primary" }],
    phases: [
      { key: "p1", title: "Phase 1", sequence: 1 },
      { key: "p2", title: "Phase 2", sequence: 2 },
    ],
    items,
    milestones: [],
  });
}

const progress = (itemKey: string, taskKey: string, status: string): RoadmapProgressRecord => ({
  itemKey, taskKey, status: status as RoadmapProgressRecord["status"], revision: 1, updatedAt: "2026-10-01T00:00:00.000Z",
});

function project(c: RoadmapContent, rows: RoadmapProgressRecord[] = []) {
  return projectStudentRoadmap({
    content: c, versionNumber: 1, publishedAt: "2026-10-01T00:00:00.000Z", preview: false,
    progress: rows, degreeProgress: null, previousVersions: [],
  });
}

const A = {
  key: "a", phaseKey: "p1", objectiveKey: "ba", sequence: 1, title: "A", credits: "3",
  tasks: [
    { key: "t1", kind: "challenge", title: "C1", sequence: 1 },
    { key: "t2", kind: "touchstone", title: "T2", sequence: 2 },
  ],
};
const B = { key: "b", phaseKey: "p2", objectiveKey: "ba", sequence: 1, title: "B", credits: "3" };

describe("S07 phases: exactly one current", () => {
  it("first unfinished phase with activity is current; another active phase is also_active", () => {
    const view = project(content([A, B]), [progress("a", "t1", "in_progress"), progress("b", "__item__", "in_progress")]);
    expect(view.phases.map((p) => p.state)).toEqual(["current", "also_active"]);
  });
  it("prefers the phase where work started over an untouched earlier phase", () => {
    const view = project(content([A, B]), [progress("b", "__item__", "in_progress")]);
    expect(view.phases.map((p) => p.state)).toEqual(["upcoming", "current"]);
  });
  it("never yields two current phases, whatever the activity", () => {
    const rows = [progress("a", "t1", "graded"), progress("b", "__item__", "in_progress")];
    const view = project(content([A, B]), rows);
    expect(view.phases.filter((p) => p.state === "current")).toHaveLength(1);
  });
});

describe("S07 Today: submitted tasks await grading", () => {
  it("excludes an item whose every task is submitted or done from focus", () => {
    const view = project(content([A, B]), [progress("a", "t1", "graded"), progress("a", "t2", "submitted")]);
    expect(view.today.focusItemKeys).not.toContain("a");
    expect(view.counts.tasksSubmitted).toBe(1);
  });
  it("remaining count excludes submitted tasks and mentions grading", () => {
    const view = project(content([A, B]), [progress("a", "t1", "in_progress"), progress("a", "t2", "submitted")]);
    expect(view.today.focusItemKeys[0]).toBe("a");
    expect(view.today.detail).toBe("1 task remaining, 1 submitted and awaiting grading.");
  });
  it("says everything is submitted when only grading is left", () => {
    const c = content([{ key: "a", phaseKey: "p1", objectiveKey: "ba", sequence: 1, title: "A", tasks: [{ key: "t1", kind: "paper", title: "P", sequence: 1 }] }]);
    const view = project(c, [progress("a", "t1", "submitted")]);
    expect(view.today.focusItemKeys).toEqual([]);
    expect(view.today.headline).toBe("Everything you can do is submitted");
  });
  it("passes task due dates through", () => {
    const c = content([{ key: "a", phaseKey: "p1", objectiveKey: "ba", sequence: 1, title: "A", tasks: [{ key: "t1", kind: "paper", title: "P", sequence: 1, dueDate: "2026-11-03" }] }]);
    expect(project(c).phases[0].items[0].tasks[0].dueDate).toBe("2026-11-03");
  });
});

describe("S07 planned credit", () => {
  const lic = { key: "lic", phaseKey: "p2", objectiveKey: "ba", sequence: 2, title: "Lic", credits: "4", creditUse: "licensing" };
  const dl = { key: "dl", phaseKey: "p2", objectiveKey: "ba", sequence: 2, title: "DL", credits: "4", creditUse: "degree_and_licensing" };
  it("skips licensing-only items", () => {
    expect(project(content([A, B, lic])).foundation.ladder.planned).toBe("6.00");
  });
  it("still counts degree_and_licensing", () => {
    expect(project(content([A, B, dl])).foundation.ladder.planned).toBe("10.00");
  });
});
