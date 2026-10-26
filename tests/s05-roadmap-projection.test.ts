import { describe, expect, it } from "vitest";
import { projectStudentRoadmap, type ProjectStudentRoadmapInput } from "../shared/student-roadmap-projection";
import {
  ROADMAP_CONTENT_VERSION,
  roadmapContentSchema,
  type RoadmapContent,
  type RoadmapProgressRecord,
} from "../shared/student-roadmap-contract";
import type { StudentCreditView, StudentDegreeProgressView } from "../shared/student-degree-progress-view";

const STAFF_SECRET = "STAFF-ONLY-SECRET-NOTE";
const CREDIT_ID = "11111111-1111-4111-8111-111111111111";

function content(overrides: Partial<{ items: unknown[]; milestones: unknown[] }> = {}): RoadmapContent {
  return roadmapContentSchema.parse({
    contentVersion: ROADMAP_CONTENT_VERSION,
    title: "Plan",
    summary: "Summary",
    objectives: [
      { key: "ba", title: "BA", kind: "primary", linkedToProgramAssignment: true },
      { key: "ms", title: "MS", kind: "secondary" },
    ],
    phases: [
      { key: "p1", title: "Phase 1", sequence: 1 },
      { key: "p2", title: "Phase 2", sequence: 2 },
    ],
    items: overrides.items ?? [
      {
        key: "eng101", phaseKey: "p1", objectiveKey: "ba", sequence: 1, title: "English", credits: "3",
        staffNote: STAFF_SECRET, linkedCreditRecordId: CREDIT_ID,
        tasks: [{ key: "t1", kind: "paper", title: "Paper", sequence: 1 }, { key: "t2", kind: "exam", title: "Exam", sequence: 2 }],
      },
      { key: "mat101", phaseKey: "p1", objectiveKey: "ba", sequence: 2, title: "Math", credits: "4.5", dependsOn: ["eng101"] },
      { key: "his101", phaseKey: "p2", objectiveKey: "ba", sequence: 1, title: "History", credits: "3", planStatus: "hold", hold: { reason: "Awaiting approval" } },
      { key: "alt101", phaseKey: "p2", objectiveKey: "ba", sequence: 2, title: "Alt", credits: "3", planStatus: "alternative", alternativeOf: "his101" },
    ],
    milestones: overrides.milestones ?? [
      { key: "m-late", title: "Late", kind: "checkpoint", targetDate: "2027-06-01", afterItemKeys: ["his101"] },
      { key: "m-early", title: "Early", kind: "checkpoint", targetDate: "2027-01-01", afterItemKeys: ["eng101", "mat101"] },
    ],
  });
}

const progress = (itemKey: string, taskKey: string, status: string, revision = 1): RoadmapProgressRecord => ({
  itemKey, taskKey, status: status as RoadmapProgressRecord["status"], revision, updatedAt: "2026-10-01T00:00:00.000Z",
});

function credit(overrides: Partial<StudentCreditView>): StudentCreditView {
  return {
    creditRecordId: CREDIT_ID, courseCode: null, title: "English", term: null, completedOn: null, recordType: "course",
    reportedCredits: "3.00", awardedCredits: null, standing: "PENDING_VERIFICATION", sourceId: null, appliedToRequirementIds: [],
    ...overrides,
  };
}

function degree(credits: StudentCreditView[], extra: Partial<StudentDegreeProgressView> = {}): StudentDegreeProgressView {
  return {
    contractVersion: "student-degree-progress/1", state: "COMPOSED", asOf: null,
    program: { programName: "BA Liberal Studies", programCode: "BA", versionLabel: null, institutionName: null, cohortLabel: null },
    totals: {
      unit: "credit", requiredCredits: "120", appliedCredits: "30", remainingCredits: "90", verifiedCreditsOnRecord: "33",
      requirementsSatisfied: 1, requirementsTotal: 4,
    },
    requirements: [], credits, sources: [], attention: [], milestones: [], nextSteps: [],
    ...extra,
  };
}

function project(over: Partial<ProjectStudentRoadmapInput> = {}) {
  return projectStudentRoadmap({
    content: content(), versionNumber: 2, publishedAt: "2026-10-01T00:00:00.000Z", preview: false,
    progress: [], degreeProgress: null, previousVersions: [], ...over,
  });
}

const item = (view: ReturnType<typeof project>, key: string) =>
  view.phases.flatMap((p) => p.items).find((i) => i.key === key)!;

describe("projectStudentRoadmap", () => {
  it("never outputs staffNote or the linked credit record id", () => {
    const view = project({ degreeProgress: degree([credit({})]) });
    const text = JSON.stringify(view);
    expect(text).not.toContain(STAFF_SECRET);
    expect(text).not.toContain("staffNote");
    expect(text).not.toContain("linkedCreditRecordId");
    expect(item(view, "eng101").official).toEqual({ standing: "PENDING_VERIFICATION", awardedCredits: null });
  });

  it("returns NOT_PUBLISHED with a plain message when there is no content", () => {
    const view = project({ content: null, versionNumber: 0, publishedAt: null });
    expect(view.state).toBe("NOT_PUBLISHED");
    expect(view.plan).toBeNull();
    expect(view.today.headline).toMatch(/being prepared/i);
    expect(view.phases).toEqual([]);
  });

  it("derives item stages", () => {
    const stageOf = (rows: RoadmapProgressRecord[], deg: StudentDegreeProgressView | null = null) =>
      item(project({ progress: rows, degreeProgress: deg }), "eng101").stage;
    expect(stageOf([])).toBe("not_started");
    expect(stageOf([progress("eng101", "__item__", "in_progress")])).toBe("in_progress");
    expect(stageOf([progress("eng101", "t1", "in_progress")])).toBe("in_progress");
    expect(stageOf([progress("eng101", "t1", "graded")])).toBe("in_progress");
    expect(stageOf([progress("eng101", "t1", "submitted"), progress("eng101", "t2", "graded")])).toBe("submitted");
    expect(stageOf([progress("eng101", "t1", "graded"), progress("eng101", "t2", "graded")])).toBe("graded");
    expect(stageOf([progress("eng101", "__item__", "provider_complete")])).toBe("provider_complete");
    expect(stageOf([progress("eng101", "__item__", "provider_complete")], degree([credit({ standing: "VERIFIED_APPLIED", awardedCredits: "3.00" })])))
      .toBe("officially_accepted");
    expect(stageOf([], degree([credit({ standing: "VERIFIED_NOT_APPLIED", awardedCredits: "3.00" })]))).toBe("officially_accepted");
    expect(stageOf([], degree([credit({ standing: "NEEDS_REVIEW" })]))).toBe("not_started");
  });

  it("ignores unknown task keys and invalid statuses for counts", () => {
    const view = project({ progress: [progress("eng101", "ghost", "graded"), progress("eng101", "t1", "provider_complete")] });
    expect(item(view, "eng101").stage).toBe("not_started");
    expect(view.counts.tasksGraded).toBe(0);
  });

  it("computes waitingOn, canReport and counts over active items only", () => {
    const view = project();
    expect(item(view, "mat101").waitingOn).toEqual([{ itemKey: "eng101", title: "English" }]);
    expect(item(view, "his101").canReport).toBe(false);
    expect(item(view, "his101").reportBlockedReason).toBe("on_hold");
    expect(item(view, "alt101").canReport).toBe(false);
    expect(view.counts.itemsTotal).toBe(3);
    expect(view.counts.tasksTotal).toBe(2);
    const done = project({ progress: [progress("eng101", "__item__", "provider_complete")] });
    expect(item(done, "mat101").waitingOn).toEqual([]);
    expect(done.counts.itemsProviderComplete).toBe(1);
    expect(JSON.stringify(view)).not.toMatch(/percent/i);
  });

  it("sets phase state: complete, current, upcoming", () => {
    const view = project({
      content: content({ items: [
        { key: "a", phaseKey: "p1", objectiveKey: "ba", sequence: 1, title: "A" },
        { key: "b", phaseKey: "p2", objectiveKey: "ba", sequence: 1, title: "B" },
      ], milestones: [] }),
      progress: [progress("a", "__item__", "provider_complete")],
    });
    expect(view.phases.map((p) => p.state)).toEqual(["complete", "current"]);
    const none = project();
    expect(none.phases.map((p) => p.state)).toEqual(["current", "upcoming"]);
  });

  it("marks milestones reached and picks the next unreached by date", () => {
    const rows = [progress("eng101", "__item__", "provider_complete"), progress("mat101", "__item__", "provider_complete")];
    const view = project({ progress: rows });
    expect(view.milestones.map((m) => m.key)).toEqual(["m-early", "m-late"]);
    expect(view.milestones[0]).toMatchObject({ reached: true, remainingItems: 0 });
    expect(view.milestones[1]).toMatchObject({ reached: false, remainingItems: 1 });
    expect(view.today.nextMilestoneKey).toBe("m-late");
    expect(project().today.nextMilestoneKey).toBe("m-early");
  });

  it("treats an empty afterItemKeys milestone as reached only when its objective is done", () => {
    const c = content({
      items: [{ key: "a", phaseKey: "p1", objectiveKey: "ba", sequence: 1, title: "A" }],
      milestones: [{ key: "done", title: "Degree", kind: "objective_complete", objectiveKey: "ba", afterItemKeys: [] }],
    });
    expect(project({ content: c }).milestones[0].reached).toBe(false);
    expect(project({ content: c, progress: [progress("a", "__item__", "provider_complete")] }).milestones[0].reached).toBe(true);
  });

  it("builds a Today focus: working items first, then available starts", () => {
    const view = project({ progress: [progress("eng101", "t1", "in_progress")] });
    expect(view.today.focusItemKeys).toEqual(["eng101"]);
    expect(view.today.headline).toBe("Next: Paper in English");
    expect(view.today.detail).toBe("2 tasks remaining.");
    const fresh = project();
    expect(fresh.today.focusItemKeys).toEqual(["eng101"]);
    expect(fresh.today.headline).toBe("Next: Paper in English");
  });

  it("leads Today with the most urgent course (earliest open task due date or planned end)", () => {
    const c = content({
      items: [
        { key: "late", phaseKey: "p1", objectiveKey: "ba", sequence: 1, title: "Later course", plannedEnd: "2027-03-01",
          tasks: [{ key: "t1", kind: "challenge", title: "Challenge 1", sequence: 1, dueDate: "2027-02-01" }] },
        { key: "urgent", phaseKey: "p1", objectiveKey: "ba", sequence: 2, title: "Urgent course", plannedEnd: "2027-04-01",
          tasks: [
            { key: "t1", kind: "challenge", title: "Challenge 1", sequence: 1, dueDate: "2026-10-22" },
            { key: "t2", kind: "challenge", title: "Challenge 2", sequence: 2, dueDate: "2026-11-05" },
          ] },
      ],
    });
    const view = project({ content: c, progress: [progress("late", "t1", "in_progress"), progress("urgent", "t2", "in_progress")] });
    expect(view.today.focusItemKeys).toEqual(["urgent", "late"]);
    expect(view.today.headline).toBe("Next: Challenge 1 in Urgent course");
  });

  it("states completion while awaiting official acceptance", () => {
    const c = content({ items: [{ key: "a", phaseKey: "p1", objectiveKey: "ba", sequence: 1, title: "A" }], milestones: [] });
    const view = project({ content: c, progress: [progress("a", "__item__", "provider_complete")] });
    expect(view.today.headline).toBe("Every planned course is complete");
    expect(view.today.detail).toMatch(/awaiting official acceptance/);
  });

  it("builds the foundation ladder from the canonical view with exact decimals", () => {
    const deg = degree([
      credit({ creditRecordId: "c1", reportedCredits: "0.10", standing: "PENDING_VERIFICATION" }),
      credit({ creditRecordId: "c2", reportedCredits: "0.20", standing: "NEEDS_REVIEW" }),
      credit({ creditRecordId: "c3", reportedCredits: "60.00", awardedCredits: "60.00", standing: "VERIFIED_APPLIED", recordType: "credential_award", sourceId: "s1", title: "AA" }),
      credit({ creditRecordId: "c4", reportedCredits: "3.00", awardedCredits: "3.00", standing: "VERIFIED_NOT_APPLIED" }),
      credit({ creditRecordId: "c5", reportedCredits: "9.00", standing: "NOT_ACCEPTED" }),
    ], {
      sources: [{ sourceId: "s1", title: "Transcript", sourceType: "transcript", status: "verified", sourceDate: null, receivedAt: null, creditRecordCount: 1 }],
      totals: { unit: "credit", requiredCredits: "120", appliedCredits: "60", remainingCredits: "60", verifiedCreditsOnRecord: "63", requirementsSatisfied: 1, requirementsTotal: 2 },
    });
    const view = project({ degreeProgress: deg });
    expect(view.foundation.ladder).toEqual({
      reported: "63.30", provisional: "0.30", verified: "63.00", applied: "60.00", surplus: "3.00", planned: "10.50", required: "120.00",
    });
    expect(view.foundation.credentials).toEqual([
      expect.objectContaining({ creditRecordId: "c3", sourceTitle: "Transcript", sourceType: "transcript", standing: "VERIFIED_APPLIED" }),
    ]);
    expect(view.foundation.degreeState).toBe("COMPOSED");
  });

  it("withholds applied/surplus/required when the engine produced no totals", () => {
    const view = project({ degreeProgress: degree([], { state: "UNDER_REVIEW", totals: null }) });
    expect(view.foundation.ladder).toMatchObject({ applied: null, surplus: null, required: null });
    expect(view.foundation.degreeState).toBe("UNDER_REVIEW");
    expect(project().foundation.degreeState).toBe("NO_ACTIVE_PROGRAM");
  });

  it("excludes officially accepted items from planned credits", () => {
    const view = project({ degreeProgress: degree([credit({ standing: "VERIFIED_APPLIED", awardedCredits: "3.00" })]) });
    expect(view.foundation.ladder.planned).toBe("7.50");
  });

  it("names the canonical program on the linked primary objective only", () => {
    const view = project({ degreeProgress: degree([]) });
    expect(view.objectives.find((o) => o.key === "ba")!.canonicalProgramName).toBe("BA Liberal Studies");
    expect(view.objectives.find((o) => o.key === "ms")!.canonicalProgramName).toBeNull();
    expect(project().objectives[0].canonicalProgramName).toBeNull();
  });

  it("reports progress on items no longer in the plan as retired, grouped per item", () => {
    const view = project({
      progress: [
        progress("gone", "__item__", "in_progress"),
        progress("gone", "t1", "graded"),
        progress("gone", "t2", "submitted"),
      ],
      retiredTitles: { gone: "Old Course" },
    });
    expect(view.history.retiredProgress).toEqual([
      { itemKey: "gone", title: "Old Course", itemStatus: "in_progress", tasksGraded: 1 },
    ]);
    expect(view.counts.itemsInProgress).toBe(0);
  });

  it("carries the preview flag and previous versions", () => {
    const prev = [{ versionNumber: 1, publishedAt: "2026-09-01T00:00:00.000Z", supersededAt: "2026-10-01T00:00:00.000Z" }];
    const view = project({ preview: true, previousVersions: prev });
    expect(view.preview).toBe(true);
    expect(view.history.previousVersions).toEqual(prev);
    expect(view.plan).toMatchObject({ versionNumber: 2, title: "Plan" });
  });
});
