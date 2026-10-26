/** S07 presentation rules: due dates, status language, baseline, phases, inline blocked reasons. */
import { describe, expect, it } from "vitest";
import {
  PHASE_STATE_LABEL,
  STATUS_META,
  alsoActivePhases,
  awaitingGradingSentence,
  awaitingGradingTasks,
  blockedReasonInline,
  credentialStandingLabel,
  currentPhase,
  dueInfo,
  itemsByKey,
  nextDue,
  priorCreditBaseline,
  stageStatus,
  taskStatusKey,
} from "../client/src/pages/student-roadmap-presentation";
import { RICH_MID_JOURNEY as V } from "./helpers/student-roadmap-ui-fixtures";

const task = (over: Partial<{ dueDate: string | null; status: "not_started" | "in_progress" | "submitted" | "graded" }>) =>
  ({ key: "t", kind: "challenge", title: "T", dueDate: null, status: "not_started", revision: 0, updatedAt: null, ...over }) as any;

describe("S07 due dates", () => {
  const today = "2026-10-26";
  it("words overdue, today, soon and later", () => {
    expect(dueInfo(task({ dueDate: "2026-10-22" }), today)).toMatchObject({ tone: "overdue", text: "Overdue since Oct 22" });
    expect(dueInfo(task({ dueDate: "2026-10-26" }), today)).toMatchObject({ tone: "soon", text: "Due today" });
    expect(dueInfo(task({ dueDate: "2026-10-27" }), today)).toMatchObject({ tone: "soon", text: "Due in 1 day (Oct 27)" });
    expect(dueInfo(task({ dueDate: "2026-11-20" }), today)).toMatchObject({ tone: "later", text: "Due Nov 20" });
    expect(dueInfo(task({ dueDate: "2027-01-05" }), today)!.text).toBe("Due Jan 5, 2027");
  });
  it("shows nothing without a date or once the task is submitted or done", () => {
    expect(dueInfo(task({}), today)).toBeNull();
    expect(dueInfo(task({ dueDate: "2026-10-22", status: "graded" }), today)).toBeNull();
    expect(dueInfo(task({ dueDate: "2026-10-22", status: "submitted" }), today)).toBeNull();
  });
  it("nextDue picks the earliest open date", () => {
    const mkt = itemsByKey(V).get("bba-mkt300")!;
    expect(nextDue(mkt, today)).toMatchObject({ iso: "2026-10-30" });
  });
});

describe("S07 status language", () => {
  it("maps each stage to one of seven statuses, with gold never a status", () => {
    expect(Object.keys(STATUS_META).sort()).toEqual(["applied", "attention", "notstarted", "official", "progress", "provider", "submitted"]);
    expect(stageStatus("officially_accepted")).toBe("official");
    expect(stageStatus("provider_complete")).toBe("provider");
    expect(stageStatus("submitted")).toBe("submitted");
    expect(stageStatus("graded")).toBe("progress");
    expect(stageStatus("in_progress")).toBe("progress");
    expect(stageStatus("not_started")).toBe("notstarted");
    expect(taskStatusKey("submitted")).toBe("submitted");
    expect(Object.keys(STATUS_META)).not.toContain("gold");
  });
  it("complete-at-provider and verified credit use different statuses", () => {
    expect(stageStatus("provider_complete")).not.toBe(credentialStandingLabel("VERIFIED_APPLIED").status);
  });
});

describe("S07 baseline, phases, submitted tasks, blocked reasons", () => {
  it("states the applied prior credit separately, or that it is under review", () => {
    expect(priorCreditBaseline(V.foundation)).toMatchObject({ applied: "63", required: "120", headline: "63 of 120 credits applied" });
    const review = priorCreditBaseline({ ...V.foundation, ladder: { ...V.foundation.ladder, applied: null } });
    expect(review.applied).toBeNull();
    expect(review.headline).toBe("Under review");
  });
  it("has one current phase; the other active one is labelled Also active", () => {
    expect(currentPhase(V)!.key).toBe("business-core");
    expect(alsoActivePhases(V).map((p) => p.key)).toEqual(["nursing-prerequisites"]);
    expect(PHASE_STATE_LABEL.also_active).toBe("Also active");
    expect(V.phases.filter((p) => p.state === "current")).toHaveLength(1);
  });
  it("lists submitted tasks separately and counts them", () => {
    const mkt = itemsByKey(V).get("bba-mkt300")!;
    expect(awaitingGradingTasks(mkt).map((t) => t.key)).toEqual(["touchstone-2"]);
    expect(awaitingGradingSentence(V)).toBe(`${V.counts.tasksSubmitted} task submitted, awaiting grading`);
  });
  it("gives a visible sentence for approval and hold, none for open items", () => {
    const items = itemsByKey(V);
    expect(blockedReasonInline(items.get("bba-mgmt320")!)).toBe("Your advisor must approve this course before you can start it.");
    expect(blockedReasonInline(items.get("bba-fin330")!)).toContain("paused");
    expect(blockedReasonInline(items.get("bba-mkt300")!)).toBeNull();
  });
});
