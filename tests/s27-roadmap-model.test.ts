import { describe, expect, it } from "vitest";
import { ApiError } from "../client/src/lib/api";
import { describeLogFailure } from "../client/src/lib/s27/log-progress";
import {
  applyOptimisticProgress, buildDots, groupRoadmap, logGuidance, loggableCourses, nextTaskOf, parseScore, passedCount, planOrder, progressPayload, shortCourseName,
} from "../client/src/lib/s27/roadmap-model";
import { s27HsView } from "./helpers/s27-fixtures";

const view = s27HsView();
const course = (key: string) => view.subjects.flatMap((s) => s.courses).find((c) => c.key === key)!;

describe("S27 roadmap grouping", () => {
  const g = groupRoadmap(view);
  it("splits the plan into now / up next / electives awaiting approval / completed", () => {
    expect(g.now.map((c) => c.key).sort()).toEqual(["english-3", "science-biology", "science-physical", "social-2"]);
    expect(g.completed).toHaveLength(9);
    expect(g.electives.length).toBe(6);
    expect(g.upNext.map((x) => x.course.key)).toContain("english-4");
    expect(g.totalCourses).toBe(g.now.length + g.upNext.length + g.electives.length + g.completed.length);
  });
  it("numbers up-next courses after the completed ones, in plan order", () => {
    expect(Math.min(...g.upNext.map((x) => x.no))).toBeGreaterThan(g.completed.length);
  });
  it("plan order puts finished courses first and skips replaced ones", () => {
    const order = planOrder(view);
    expect(order[0]!.status).toBe("official_complete");
  });
  it("short course names keep the numbered title", () => {
    expect(shortCourseName("English 3: Analyzing Texts and Building Compositions")).toBe("English 3");
    expect(shortCourseName("Biology")).toBe("Biology");
  });
});

describe("S27 assessment dots", () => {
  it("maps tasks: passed -> done, submitted -> sub, retake -> fail 'R', first open -> next, project -> square 'P'", () => {
    const dots = buildDots(course("english-3"));
    expect(dots.map((d) => d.state)).toEqual(["done", "sub", "next", "todo"]);
    expect(dots.find((d) => d.project)?.label).toBe("P");
    const phys = buildDots(course("science-physical"));
    expect(phys.map((d) => d.state)).toEqual(["done", "sub", "fail"]);
    expect(phys[2]!.label).toBe("R");
  });
  it("never offers two 'next' rings", () => {
    const d = buildDots(course("english-4"));
    expect(d.filter((x) => x.state === "next")).toHaveLength(1);
    expect(d[0]!.state).toBe("next");
  });
  it("next task prefers a retake, counts passed and waiting items", () => {
    expect(nextTaskOf(course("science-physical"))?.status).toBe("retake_required");
    expect(passedCount(course("english-3"))).toMatchObject({ done: 1, total: 4, pct: 25, waiting: 1 });
  });
});

describe("S27 log sheet", () => {
  it("offers open work only and pre-selects the course's next task", () => {
    const options = loggableCourses(view);
    const e3 = options.find((o) => o.key === "english-3")!;
    expect(e3.defaultItemKey).toBe(nextTaskOf(course("english-3"))!.key);
    expect(e3.items.map((i) => i.submitted)).toContain(true);
    expect(options.find((o) => o.key.startsWith("elective-"))).toBeUndefined();
    expect(options.every((o) => !o.items.some((i) => i.title === ""))).toBe(true);
  });
  it("guidance: below 65 -> retake guidance by kind; at or above -> passed; project -> pending note", () => {
    expect(logGuidance({ mode: "graded", scoreRaw: "61", kind: "exam" }).key).toBe("below_exam");
    expect(logGuidance({ mode: "graded", scoreRaw: "61", kind: "project" }).key).toBe("below_project");
    expect(logGuidance({ mode: "graded", scoreRaw: "65", kind: "exam" })).toMatchObject({ key: "passed", tone: "good" });
    expect(logGuidance({ mode: "graded", scoreRaw: "64", kind: "lesson" }).key).toBe("below_generic");
    expect(logGuidance({ mode: "submitted", scoreRaw: "", kind: "project" }).key).toBe("project_pending");
    expect(logGuidance({ mode: "graded", scoreRaw: "101", kind: "exam" })).toMatchObject({ key: "scoreRange", tone: "bad" });
    expect(logGuidance({ mode: "graded", scoreRaw: "", kind: "exam" }).key).toBe("none");
  });
  it("a configured policy overrides the pass mark and adds its note", () => {
    const g = logGuidance({ mode: "graded", scoreRaw: "70", kind: "exam", policy: { passingPercent: 75, retakeNote: "One retake in 30 days." } });
    expect(g).toMatchObject({ key: "below_exam", note: "One retake in 30 days." });
  });
  it("parses the score box strictly", () => {
    expect(parseScore("")).toBeNull();
    expect(parseScore(" 84 ")).toBe(84);
    expect(parseScore("8x")).toBe("invalid");
    expect(parseScore("-1")).toBe("invalid");
    expect(parseScore("100")).toBe(100);
    expect(parseScore("101")).toBe("invalid");
  });
  it("POST body: Submitted sends no score, Graded needs one; expectedRevision is always carried", () => {
    expect(progressPayload({ courseKey: "c", taskKey: "t", mode: "submitted", scoreRaw: "", expectedRevision: 3 })).toEqual({
      ok: true, body: { courseKey: "c", taskKey: "t", status: "submitted", expectedRevision: 3 },
    });
    expect(progressPayload({ courseKey: "c", taskKey: "t", mode: "graded", scoreRaw: "84", expectedRevision: 0 })).toMatchObject({ ok: true, body: { reportedScorePercent: 84, expectedRevision: 0 } });
    expect(progressPayload({ courseKey: "c", taskKey: "t", mode: "graded", scoreRaw: "", expectedRevision: 0 })).toEqual({ ok: false, reason: "score" });
  });
  it("optimistic update shows the task waiting for a grade and leaves the rest alone", () => {
    const task = course("english-3").tasks.find((t) => t.status === "not_started")!;
    const next = applyOptimisticProgress(view, { courseKey: "english-3", taskKey: task.key, reportedScorePercent: 88 });
    const updated = next.subjects.flatMap((s) => s.courses).find((c) => c.key === "english-3")!.tasks.find((t) => t.key === task.key)!;
    expect(updated).toMatchObject({ status: "pending_review", reportedScorePercent: 88, progressRevision: task.progressRevision + 1 });
    expect(next.credits).toEqual(view.credits);
    expect(view.subjects.flatMap((s) => s.courses).find((c) => c.key === "english-3")!.tasks.find((t) => t.key === task.key)!.status).toBe("not_started");
  });
  it("re-logging as Submitted keeps a score already reported (no null is sent)", () => {
    const body = progressPayload({ courseKey: "c", taskKey: "t", mode: "submitted", scoreRaw: "", expectedRevision: 2 });
    expect(body.ok && "reportedScorePercent" in body.body).toBe(false);
    const task = course("english-3").tasks.find((t) => t.status === "not_started")!;
    const scored = applyOptimisticProgress(view, { courseKey: "english-3", taskKey: task.key, reportedScorePercent: 82 });
    const again = applyOptimisticProgress(scored, { courseKey: "english-3", taskKey: task.key });
    expect(again.subjects.flatMap((s) => s.courses).find((c) => c.key === "english-3")!.tasks.find((t) => t.key === task.key)!.reportedScorePercent).toBe(82);
  });
  it("failures: a 409 revision conflict refetches and tells the student; locked and changed-plan too; others do not refetch", () => {
    expect(describeLogFailure(new ApiError("x", 409, "HS_REVISION_CONFLICT"))).toMatchObject({ kind: "conflict", refetch: true });
    expect(describeLogFailure(new ApiError("x", 404, "HS_UNKNOWN_COURSE_OR_TASK"))).toMatchObject({ kind: "changed", refetch: true });
    expect(describeLogFailure(new ApiError("x", 409, "HS_OFFICIAL_RECORD_LOCKED"))).toMatchObject({ kind: "locked", refetch: true });
    expect(describeLogFailure(new ApiError("Server said no", 500))).toMatchObject({ kind: "generic", refetch: false, message: "Server said no" });
    expect(describeLogFailure(new Error("net"))).toMatchObject({ kind: "generic", refetch: false });
  });
});
