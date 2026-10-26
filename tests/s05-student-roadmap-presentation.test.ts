import { describe, expect, it } from "vitest";
import {
  ALL_LANES,
  APPLIED_VS_VERIFIED,
  PROVIDER_COMPLETE_CONFIRM,
  ROADMAP_SECTIONS,
  SURPLUS_EXPLANATION,
  canMarkProviderComplete,
  canUndoProviderComplete,
  controlsEnabled,
  countSegments,
  countsSentence,
  currentPhase,
  dateRangeLabel,
  doneToggleTarget,
  focusItems,
  horizonMilestones,
  itemCreditsLabel,
  itemUpdate,
  itemsByKey,
  laneOptions,
  ladderRungs,
  ladderScale,
  ladderTotalsSentence,
  credentialStandingLabel,
  taskSavedLabel,
  phaseSummaryLine,
  TASK_STATUS_OPTIONS,
  nowTarget,
  barFraction,
  nextMilestone,
  nextTasks,
  phaseItems,
  requirementLine,
  rowKey,
  stageAriaLabel,
  stageIndex,
  STAGES,
  taskControlKind,
  taskProgressPhrase,
  taskUpdate,
} from "../client/src/pages/student-roadmap-presentation";
import {
  RoadmapApiError,
  interpretProgressError,
  isRoadmapMissingRecord,
} from "../client/src/lib/student-roadmap-queries";
import { COMPLETED, NOT_PUBLISHED, RICH_MID_JOURNEY as V } from "./helpers/student-roadmap-ui-fixtures";

const item = (key: string) => itemsByKey(V).get(key)!;

describe("S05 roadmap presentation: stages", () => {
  it("orders six stages with official acceptance last", () => {
    expect(STAGES.map((s) => s.stage)).toEqual([
      "not_started", "in_progress", "submitted", "graded", "provider_complete", "officially_accepted",
    ]);
    expect(stageIndex("officially_accepted")).toBe(5);
    expect(stageAriaLabel("submitted")).toBe("Stage 3 of 6: Submitted");
  });
});

describe("S05 roadmap presentation: tasks", () => {
  it("chooses toggle for challenges/quizzes/exams and a segmented control for touchstones/papers/milestones", () => {
    for (const k of ["challenge", "quiz", "exam", "assignment", "other"] as const) expect(taskControlKind(k)).toBe("toggle");
    for (const k of ["touchstone", "paper", "milestone"] as const) expect(taskControlKind(k)).toBe("segmented");
  });

  it("phrases task counts by kind, falling back to tasks for mixed kinds", () => {
    expect(taskProgressPhrase(item("bba-mkt300"))).toBe("6 of 12 tasks done");
    expect(taskProgressPhrase(item("bba-fin330"))).toBe("0 of 3 challenges done");
    expect(taskProgressPhrase(item("bba-fin330-alt"))).toBeNull();
  });

  it("lists the next three tasks that are not graded, in plan order", () => {
    expect(nextTasks(item("bba-mkt300")).map((t) => t.key)).toEqual(["challenge-6", "challenge-7", "challenge-8"]);
  });

  it("toggles graded <-> not_started", () => {
    const t = item("bba-mkt300").tasks;
    expect(doneToggleTarget(t[0])).toBe("not_started");
    expect(doneToggleTarget(t[5])).toBe("graded");
  });

  it("builds updates with the revision the view carries", () => {
    const i = item("bba-mkt300");
    const task = i.tasks[5];
    expect(taskUpdate(i, task, "graded")).toEqual({ itemKey: "bba-mkt300", taskKey: "challenge-6", status: "graded", expectedRevision: task.revision });
    expect(itemUpdate(i, "provider_complete")).toEqual({ itemKey: "bba-mkt300", taskKey: null, status: "provider_complete", expectedRevision: i.itemRevision });
    expect(rowKey("a", null)).toBe("a:__item__");
  });
});

describe("S05 roadmap presentation: reporting rules", () => {
  it("never lets the student act on alternatives or officially accepted items", () => {
    expect(controlsEnabled(item("bba-fin330-alt"))).toBe(false);
    expect(controlsEnabled(item("bba-eng101"))).toBe(false);
    expect(controlsEnabled(item("bba-mkt300"))).toBe(true);
    expect(canMarkProviderComplete(item("bba-eng101"))).toBe(false);
    expect(canMarkProviderComplete(item("bba-mkt300"))).toBe(true);
  });
  it("offers undo only for provider-complete items", () => {
    expect(canUndoProviderComplete(item("bba-stat200"))).toBe(true);
    expect(canUndoProviderComplete(item("bba-mkt300"))).toBe(false);
  });
  it("confirmation says it does not award credit", () => {
    expect(PROVIDER_COMPLETE_CONFIRM.body).toMatch(/does not award credit/);
  });
  it("planned credits are labelled planned; awarded only when officially accepted", () => {
    expect(itemCreditsLabel(item("bba-mkt300"))).toBe("3 credits planned");
    expect(itemCreditsLabel(item("bba-eng101"))).toBe("3 credits awarded by Lumière");
  });
});

describe("S05 roadmap presentation: counts", () => {
  it("returns plain counts and no percentage", () => {
    const segs = countSegments(V.counts);
    expect(segs.map((s) => s.label)).toEqual(["Officially accepted", "Complete at provider", "In progress", "Not started"]);
    expect(countsSentence(V.counts)).not.toMatch(/%/);
    expect(countsSentence(V.counts)).toContain("Across your whole plan, 9 items");
  });
});

describe("S05 roadmap presentation: journey", () => {
  it("finds the current phase, focus items and next milestone", () => {
    expect(currentPhase(V)!.key).toBe("business-core");
    expect(focusItems(V).map((i) => i.key)).toEqual(["bba-mkt300", "bba-acct210", "rn-anat"]);
    expect(nextMilestone(V)!.key).toBe("ms-core");
    expect(horizonMilestones(V).map((m) => m.key)).toEqual(["ms-core", "ms-app", "ms-bba", "ms-grad"]);
  });
  it("falls back sensibly when complete or unpublished", () => {
    expect(currentPhase(COMPLETED)!.state).toBe("complete");
    expect(nextMilestone(COMPLETED)).toBeNull();
    expect(currentPhase(NOT_PUBLISHED)).toBeNull();
  });
  it("offers lane filters only with more than one objective", () => {
    expect(laneOptions(V).map((l) => l.key)).toEqual([ALL_LANES, "bba", "rn-prereq"]);
    expect(laneOptions(COMPLETED)).toEqual([]);
  });
  it("splits alternatives from reportable items and filters by lane", () => {
    const core = V.phases.find((p) => p.key === "business-core")!;
    const all = phaseItems(core);
    expect(all.main).toHaveLength(4);
    expect(all.alternatives.map((i) => i.key)).toEqual(["bba-fin330-alt"]);
    expect(phaseItems(core, "rn-prereq").main).toHaveLength(0);
  });
  it("formats dates", () => {
    expect(dateRangeLabel("2026-09-14", "2026-11-27")).toBe("Sep 14, 2026 to Nov 27, 2026");
    expect(dateRangeLabel(null, "2026-11-27")).toBe("Target Nov 27, 2026");
    expect(dateRangeLabel(null, null)).toBeNull();
  });
  it("exposes the four sections in order", () => {
    expect(ROADMAP_SECTIONS.map((s) => s.label)).toEqual(["Today", "Roadmap", "Foundation", "Horizon"]);
  });
});

describe("S05 roadmap presentation: credit ladder", () => {
  it("lists reported -> provisional -> verified -> applied from the ladder only", () => {
    const rungs = ladderRungs(V.foundation.ladder);
    expect(rungs.map((r) => [r.key, r.value])).toEqual([
      ["reported", "69.00"], ["provisional", "9.00"], ["verified", "60.00"], ["applied", "57.00"],
    ]);
  });
  it("keeps applied null while under review", () => {
    const r = ladderRungs({ ...V.foundation.ladder, applied: null }).find((x) => x.key === "applied")!;
    expect(r.value).toBeNull();
    expect(r.help).toMatch(/finishes reviewing/);
  });
  it("sizes bars against one scale and explains the terms in plain language", () => {
    const scale = ladderScale(V.foundation.ladder);
    expect(scale).toBe(120);
    expect(ladderTotalsSentence(V.foundation.ladder)).toBe("69 credits reported in total: 60 of them verified, 9 waiting for Lumière to verify.");
    expect(barFraction("60.00", scale)).toBe(0.5);
    expect(barFraction(null, scale)).toBe(0);
    expect(SURPLUS_EXPLANATION).toMatch(/don't move you closer to graduation/);
    expect(APPLIED_VS_VERIFIED).toMatch(/Applied means/);
  });
  it("never shows applied above required: the extra is stated as surplus", () => {
    const line = requirementLine({
      requirementId: "r", code: null, title: "Core", sequence: 1, status: "SATISFIED", unit: "credit",
      requiredAmount: "6.00", appliedAmount: "6.50", remainingAmount: "0.00", appliedCreditRecordIds: [],
    } as any)!;
    expect(line.text).toBe("6 of 6 credits");
    expect(line.surplusNote).toMatch(/0\.5 more verified/);
    const partial = requirementLine({ requirementId: "r", code: null, title: "x", sequence: 1, status: "PARTIAL", unit: "credit", requiredAmount: "30.00", appliedAmount: "13.50", remainingAmount: "16.50", appliedCreditRecordIds: [] } as any)!;
    expect(partial.text).toBe("13.5 of 30 credits");
    expect(partial.surplusNote).toBeNull();
  });
});

describe("S05 progress error handling", () => {
  it("treats ROADMAP_PROGRESS_CONFLICT as a refetch with a gentle message", () => {
    const f = interpretProgressError(new RoadmapApiError(409, "ROADMAP_PROGRESS_CONFLICT", "stale"));
    expect(f.kind).toBe("conflict");
    expect(f.refetch).toBe(true);
    expect(f.message).toMatch(/refreshed/);
  });
  it("surfaces other errors without refetching", () => {
    const f = interpretProgressError(new RoadmapApiError(422, "ROADMAP_ITEM_NOT_REPORTABLE", "x"));
    expect(f).toMatchObject({ kind: "error", refetch: false });
    expect(interpretProgressError(new Error("boom"))).toMatchObject({ kind: "error", message: "boom" });
  });
  it("recognises a missing student record", () => {
    expect(isRoadmapMissingRecord(new RoadmapApiError(404, "ROADMAP_STUDENT_NOT_FOUND", "no"))).toBe(true);
    expect(isRoadmapMissingRecord(new RoadmapApiError(404, "ROADMAP_NOT_FOUND", "no"))).toBe(false);
    expect(isRoadmapMissingRecord(new Error("404"))).toBe(false);
  });
});

describe("S05 student wording: the student never grades", () => {
  it("labels the segmented statuses without 'Graded' and the stage track 'All tasks done'", () => {
    expect(TASK_STATUS_OPTIONS.map((o) => o.label)).toEqual(["Not started", "Started", "Submitted", "Done"]);
    expect(TASK_STATUS_OPTIONS.map((o) => o.label).join(" ")).not.toMatch(/Graded/);
    expect(STAGES.find((s) => s.stage === "graded")!.label).toBe("All tasks done");
  });
  it("words save confirmations as what the student reported", () => {
    const i = item("bba-mkt300");
    expect(taskSavedLabel(i.tasks[5], "graded")).toBe("you reported Challenge 6 done");
    expect(taskSavedLabel(i.tasks[5], "in_progress")).toBe("you reported Challenge 6 started");
  });
  it("scopes phase counts and uses one word for preliminary credit", () => {
    expect(phaseSummaryLine(V.phases[1])).toMatch(/^In this phase:/);
    expect(credentialStandingLabel("PENDING_VERIFICATION").label).toBe("Waiting for verification");
    expect(credentialStandingLabel("NEEDS_REVIEW").label).toBe("Waiting for verification");
    expect(credentialStandingLabel("VERIFIED_APPLIED").label).toBe("Verified");
  });
  it("jumps to the first focus item from the Now strip", () => {
    expect(nowTarget(V)!.key).toBe("bba-mkt300");
    expect(nowTarget(NOT_PUBLISHED)).toBeNull();
  });
});
