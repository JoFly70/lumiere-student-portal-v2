import { describe, expect, it } from "vitest";
import { HS_SUBJECT_AREAS, formatHalfUnits } from "../shared/high-school-contract";
import {
  barPercent,
  canReportTask,
  claimStatusView,
  courseStatusView,
  creditsLabel,
  creditsOfLabel,
  daysUntil,
  dueLabel,
  financialClearanceView,
  guardianSharingLabel,
  guardianStandingView,
  nextStep,
  orderedSubjects,
  paceView,
  parseReportedScore,
  reviewStatusView,
  scoreLines,
  sortedCourses,
  supportKeyFor,
  tabFromHash,
  targetProgress,
  taskStatusView,
  transcriptRequestState,
} from "../client/src/pages/high-school-presentation";
import { formatShortDate } from "../client/src/pages/student-roadmap-presentation";
import {
  GUARDIANS_ALL,
  HS_AWAITING_REVIEW,
  HS_ELIGIBLE,
  HS_GRADUATED,
  HS_MID_WAY,
  HS_NEARLY_DONE,
  HS_NEW_STUDENT,
  HS_NO_ROADMAP,
  HS_SHUFFLED_SUBJECTS,
  HS_TENNESSEE,
  HS_TODAY,
} from "./helpers/s11-hs-ui-fixtures";

describe("S11 fixtures are internally consistent (half-units)", () => {
  it("mid-way: 10.5 of 21 official credits, 1 awaiting, core 9/16 and elective 1.5/5", () => {
    const c = HS_MID_WAY.credits;
    expect(formatHalfUnits(c.earnedHalfUnits)).toBe("10.5");
    expect(formatHalfUnits(c.requiredHalfUnits)).toBe("21");
    expect(formatHalfUnits(c.remainingHalfUnits)).toBe("10.5");
    expect(formatHalfUnits(c.awaitingConfirmationHalfUnits)).toBe("1");
    expect(c.core.earnedHalfUnits + c.elective.earnedHalfUnits).toBe(c.earnedHalfUnits);
    expect(formatHalfUnits(c.core.requiredHalfUnits)).toBe("16");
    expect(formatHalfUnits(c.elective.requiredHalfUnits)).toBe("5");
  });
  it("nearly done: 20.5 earned, 0.5 awaiting; Tennessee requires 22 with 4 math", () => {
    expect(formatHalfUnits(HS_NEARLY_DONE.credits.earnedHalfUnits)).toBe("20.5");
    expect(formatHalfUnits(HS_NEARLY_DONE.credits.awaitingConfirmationHalfUnits)).toBe("0.5");
    expect(formatHalfUnits(HS_TENNESSEE.credits.requiredHalfUnits)).toBe("22");
    const math = HS_TENNESSEE.subjects.find((s) => s.subject === "mathematics")!;
    expect(formatHalfUnits(math.requiredHalfUnits)).toBe("4");
  });
});

describe("S11 credit wording", () => {
  it("formats exact half-units without float division", () => {
    expect(creditsOfLabel(21, 42)).toBe("10.5 of 21 credits");
    expect(creditsOfLabel(1, 42)).toBe("0.5 of 21 credits");
    expect(creditsLabel(2)).toBe("1 credit");
    expect(creditsLabel(1)).toBe("0.5 credits");
    expect(barPercent(83, 84)).toBe(98); // floored, never 100 early
  });
});

describe("S11 subjects", () => {
  it("orders subjects by the contract whatever order the server sent", () => {
    const order = orderedSubjects(HS_SHUFFLED_SUBJECTS.subjects).map((s) => s.subject);
    expect(order).toEqual([...HS_SUBJECT_AREAS]);
    expect(orderedSubjects(HS_SHUFFLED_SUBJECTS.subjects)[3].label).toBe("Social Studies");
  });
  it("sorts active courses first and replaced courses last, keeping them", () => {
    const math = HS_MID_WAY.subjects.find((s) => s.subject === "mathematics")!;
    const sorted = sortedCourses(math.courses);
    expect(sorted.length).toBe(math.courses.length);
    expect(sorted[sorted.length - 1].status).toBe("replaced");
    expect(courseStatusView("replaced").label).toBe("Replaced in your updated plan");
    expect(courseStatusView("transfer_credit").label).toBe("Transfer credit (accepted by the school)");
  });
});

describe("S11 status language", () => {
  it("separates pending review from official and never colours alone", () => {
    expect(taskStatusView("pending_review")).toEqual({ key: "submitted", label: "Pending school review" });
    expect(taskStatusView("official_passed").label).toMatch(/^Official/);
    expect(taskStatusView("retake_required").key).toBe("attention");
    expect(courseStatusView("awaiting_school").label).toBe("Awaiting school confirmation");
  });
  it("official results are locked; others can be reported", () => {
    expect(canReportTask({ status: "official_passed" }, "in_progress")).toBe(false);
    expect(canReportTask({ status: "in_progress" }, "in_progress")).toBe(true);
    expect(canReportTask({ status: "not_started" }, "replaced")).toBe(false);
  });
  it("labels reported and official grades distinctly", () => {
    const lines = scoreLines({ officialScorePercent: 88, reportedScorePercent: 91 });
    expect(lines.map((l) => l.label)).toEqual(["Official (confirmed by the school): 88%", "You reported: 91%"]);
    expect(scoreLines({ officialScorePercent: null, reportedScorePercent: null })).toEqual([]);
  });
  it("parses the optional grade strictly", () => {
    expect(parseReportedScore("")).toBeNull();
    expect(parseReportedScore(" 87 ")).toBe(87);
    expect(parseReportedScore("100")).toBe(100);
    expect(parseReportedScore("101")).toBeUndefined();
    expect(parseReportedScore("-3")).toBeUndefined();
    expect(parseReportedScore("8.5")).toBeUndefined();
    expect(parseReportedScore("abc")).toBeUndefined();
  });
});

describe("S11 pace and target wording", () => {
  it("never promises: it says target", () => {
    for (const status of ["on_track", "behind", "ahead", "not_configured"] as const) {
      const p = paceView({ weeklyTargetHalfUnits: 1, expectedByNowHalfUnits: null, status, nextMilestone: null });
      expect(`${p.label} ${p.detail}`).not.toMatch(/guarantee/i);
    }
    expect(paceView(HS_MID_WAY.pace).label).toBe("Behind target");
    expect(paceView(HS_NEW_STUDENT.pace).label).toBe("Target not set yet");
  });
  it("estimates progress toward the planned date without promising it", () => {
    const t = targetProgress(HS_MID_WAY, HS_TODAY);
    expect(t.timePercent).toBeGreaterThan(0);
    expect(t.timePercent).toBeLessThan(100);
    expect(t.detail).toMatch(/target, not a guarantee/);
    expect(t.creditPercent).toBe(50);
    expect(targetProgress(HS_AWAITING_REVIEW, HS_TODAY).headline).toBe("All required credits are official");
    expect(targetProgress({ ...HS_MID_WAY, enrollment: { ...HS_MID_WAY.enrollment, targetCompletionDate: null } }, HS_TODAY).headline).toBe("No completion target set yet");
  });
  it("date helpers", () => {
    expect(daysUntil("2026-10-28", "2026-10-26")).toBe(2);
    expect(dueLabel("2026-10-19", HS_TODAY, formatShortDate)).toBe("Target was Oct 19, 2026");
    expect(dueLabel("2026-10-27", HS_TODAY, formatShortDate)).toBe("Target tomorrow (Oct 27, 2026)");
    expect(dueLabel(null, HS_TODAY, formatShortDate)).toBeNull();
  });
});

describe("S11 next step", () => {
  const next = (v: typeof HS_MID_WAY) => nextStep(v, HS_TODAY, formatShortDate);
  it("points at the next task with its target date", () => {
    const s = next(HS_MID_WAY);
    expect(s.tone).toBe("task");
    expect(s.title).toContain("research paper");
    expect(s.detail).toContain("English 3");
    expect(s.action?.tab).toBe("subjects");
  });
  it("handles no roadmap, eligibility, graduation and review waits", () => {
    expect(next(HS_NO_ROADMAP).tone).toBe("plan");
    expect(next(HS_ELIGIBLE).tone).toBe("graduation");
    expect(next(HS_AWAITING_REVIEW).title).toBe("All required credits are official");
    expect(next(HS_GRADUATED).tone).toBe("done");
    expect(next(HS_NEARLY_DONE).tone).toBe("review");
  });
});

describe("S11 graduation", () => {
  it("transcript request is enabled only after eligibility is confirmed", () => {
    expect(transcriptRequestState(HS_MID_WAY.graduation).enabled).toBe(false);
    expect(transcriptRequestState(HS_AWAITING_REVIEW.graduation).enabled).toBe(false);
    expect(transcriptRequestState(HS_AWAITING_REVIEW.graduation).reason).toMatch(/once your school confirms/);
    expect(transcriptRequestState(HS_ELIGIBLE.graduation).enabled).toBe(true);
    // already requested or delivered: not enabled again
    expect(transcriptRequestState(HS_GRADUATED.graduation).enabled).toBe(false);
  });
  it("completion review states", () => {
    expect(reviewStatusView(HS_MID_WAY.graduation).label).toBe("Not ready for review yet");
    expect(reviewStatusView(HS_AWAITING_REVIEW.graduation).label).toBe("Review by the school pending");
    expect(reviewStatusView(HS_ELIGIBLE.graduation).label).toBe("Eligibility confirmed by the school");
    expect(reviewStatusView(HS_GRADUATED.graduation).label).toBe("Diploma conferred");
  });
  it("financial clearance only speaks when a value is known", () => {
    expect(financialClearanceView(null).detail).toBe("Not available here. Ask Lumière.");
    expect(financialClearanceView("cleared").label).toBe("Cleared");
    expect(financialClearanceView("hold").key).toBe("attention");
  });
});

describe("S11 guardians and claims", () => {
  it("labels standings as specified", () => {
    const labels = GUARDIANS_ALL.map((g) => guardianStandingView(g.standing).label);
    expect(labels).toEqual(["Verified guardian", "Listed parent", "Guardian — awaiting verification", "No longer authorized"]);
  });
  it("sharing wording follows permissions", () => {
    expect(guardianSharingLabel(GUARDIANS_ALL[0])).toBe("Lumière may discuss grades and progress with this person.");
    expect(guardianSharingLabel(GUARDIANS_ALL[1])).toBe("Lumière does not discuss grades or billing with this person.");
  });
  it("transfer claims are never credit until the school accepts", () => {
    expect(claimStatusView("claimed").label).toBe("Under review by the school");
    expect(claimStatusView("submitted_to_school").label).toBe("Under review by the school");
    expect(claimStatusView("accepted").label).toBe("Accepted by the school");
    expect(claimStatusView("declined").key).toBe("attention");
  });
});

describe("S11 misc", () => {
  it("tab hash parsing and support keys", () => {
    expect(tabFromHash("#subjects")).toBe("subjects");
    expect(tabFromHash("#nope")).toBeNull();
    expect(tabFromHash(null)).toBeNull();
    expect(supportKeyFor("english-3", "abc")).toMatch(/^[A-Za-z0-9_-]{16,100}$/);
  });
});
