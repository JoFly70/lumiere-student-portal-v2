import { describe, expect, it } from "vitest";
import { projectAcademic } from "../shared/academic-projection";
import { ACADEMIC_PROJECTION_CONTRACT } from "../shared/academic-projection-contract";
import { award, makeView, META, TEMPLATE, withTask } from "./helpers/s18-academic-fixtures";

const prog = (courseKey: string, taskKey: string, status: "in_progress" | "submitted") => ({
  courseKey, taskKey, status, reportedScorePercent: null, note: null, revision: 1, updatedAt: "2026-10-20T00:00:00.000Z",
});

describe("S18 projectAcademic", () => {
  it("reads 21 credits = 16 core (32 half) + 5 elective (10 half) from template us-hs-diploma-21 v2", () => {
    expect(TEMPLATE.templateKey).toBe("us-hs-diploma-21");
    expect(TEMPLATE.version).toBe(2);
    const p = projectAcademic(makeView(), META);
    expect(p.contract).toBe(ACADEMIC_PROJECTION_CONTRACT);
    expect(p.program.templateKey).toBe("us-hs-diploma-21");
    expect(p.program.templateVersion).toBe(2);
    expect(p.credits.total.requiredHalfUnits).toBe(42);
    expect(p.credits.core.requiredHalfUnits).toBe(32);
    expect(p.credits.elective.requiredHalfUnits).toBe(10);
    expect(p.credits.core.requiredHalfUnits + p.credits.elective.requiredHalfUnits).toBe(p.credits.total.requiredHalfUnits);
    expect(p.credits.byArea.reduce((n, a) => n + a.requiredHalfUnits, 0)).toBe(42);
    expect(p.provenance.officialBoundary).toBe("school_confirmed_only");
  });

  it("not_configured when nothing is published; zero progress when published", () => {
    const none = projectAcademic(makeView({ published: false }), META);
    expect(none.dataState).toBe("not_configured");
    expect(none.credits.total.requiredHalfUnits).toBe(42);
    expect(none.provenance.planVersion).toBeNull();
    const zero = projectAcademic(makeView(), META);
    expect(zero.dataState).toBe("plan_published");
    expect(zero.credits.total.officialHalfUnits).toBe(0);
    expect(zero.credits.total.officialPercent).toBe(0);
    expect(zero.credits.total.plannedHalfUnits).toBeGreaterThan(0);
  });

  it("a 0.5-credit course is one half-unit", () => {
    const p = projectAcademic(makeView(), META);
    const c = p.subjects.flatMap((s) => s.courses).find((x) => x.key === "startup-personal-growth")!;
    expect(c.halfUnits).toBe(1);
    expect(c.basis).toBe("planned");
    const area = p.credits.byArea.find((a) => a.key === "startup")!;
    expect(area.plannedHalfUnits).toBe(2);
  });

  it("in-progress does not raise official; awaiting_school is separate", () => {
    const view = makeView({
      mutate: (c) => withTask(withTask(c, "english-1"), "english-2"),
      progress: [prog("english-1", "t1", "in_progress"), prog("english-2", "t1", "submitted")],
    });
    const p = projectAcademic(view, META);
    expect(p.credits.total.officialHalfUnits).toBe(0);
    expect(p.credits.total.inProgressHalfUnits).toBe(2);
    expect(p.credits.total.awaitingSchoolHalfUnits).toBe(2);
    expect(p.credits.total.awaitingSchoolHalfUnits).toBe(view.credits.awaitingConfirmationHalfUnits);
    const byKey = Object.fromEntries(p.subjects.flatMap((s) => s.courses).map((c) => [c.key, c.basis]));
    expect(byKey["english-1"]).toBe("in_progress");
    expect(byKey["english-2"]).toBe("awaiting_school");
    expect(p.credits.byArea.find((a) => a.key === "english")).toMatchObject({ inProgressHalfUnits: 2, awaitingSchoolHalfUnits: 2, officialHalfUnits: 0 });
  });

  it("official credit comes only from active awards and is capped per area", () => {
    const view = makeView({
      awards: [award("english-1", "english", 2), award("x1", "startup", 2, "a2"), award("x2", "startup", 2, "a3")],
      courseResults: [{ courseKey: "english-1", outcome: "completed", recordedAt: "2026-10-01T00:00:00.000Z" }],
    });
    const p = projectAcademic(view, META);
    const startup = p.credits.byArea.find((a) => a.key === "startup")!;
    expect(startup.requiredHalfUnits).toBe(2);
    expect(startup.officialHalfUnits).toBe(2); // 4 earned, capped at 2
    expect(p.credits.total.officialHalfUnits).toBe(4);
    expect(p.credits.core.officialHalfUnits).toBe(4);
    expect(p.credits.total.remainingHalfUnits).toBe(38);
    expect(p.credits.total.officialPercent).toBe(9);
    expect(p.subjects.flatMap((s) => s.courses).find((c) => c.key === "english-1")!.basis).toBe("official");
  });

  it("replaced courses are excluded from planned sums", () => {
    const view = makeView({
      mutate: (c) => ({ ...c, courses: c.courses.map((x) => (x.key === "english-4" ? { ...x, status: "replaced" as const } : x)) }),
    });
    const p = projectAcademic(view, META);
    const planned = projectAcademic(makeView(), META).credits.total.plannedHalfUnits;
    expect(p.credits.total.plannedHalfUnits).toBe(planned - 2);
    expect(p.subjects.flatMap((s) => s.courses).find((c) => c.key === "english-4")!.basis).toBe("not_counted");
  });

  it("next actions, milestones and pace come from the view/meta", () => {
    const view = makeView({ mutate: (c) => withTask(c, "english-1", "t1", "2026-10-01") });
    const p = projectAcademic(view, { ...META, milestones: [{ month: "2027-06", cumulativeHalfUnits: 20 }, { month: "2026-12", cumulativeHalfUnits: 0 }] });
    expect(p.nextActions[0]).toMatchObject({ kind: "next_task", owner: "student", courseKey: "english-1", taskKey: "t1", dueDate: "2026-10-01" });
    expect(p.nextActions.some((a) => a.kind === "overdue_task" && a.dueDate === "2026-10-01")).toBe(true);
    expect(p.milestones.map((m) => [m.month, m.reached])).toEqual([["2026-12", true], ["2027-06", false]]);
    expect(p.pace.status).toBe("not_configured");
    expect(p.graduation.creditsSatisfied).toBe(false);
  });
});
