import { describe, expect, it } from "vitest";
import { HS_SUBJECT_AREAS, formatHalfUnits } from "../shared/high-school-contract";
import {
  barPercent,
  canReportTask,
  claimAcceptedLabel,
  claimStatusView,
  cleanCourseTitle,
  courseTitleView,
  journeyAttention,
  outstandingWorkLabel,
  paceBar,
  recordedTransferTitles,
  reportedWaitingLabel,
  fullySentCourseCount,
  attentionView,
  groupCourses,
  currentSubject,
  guardianSharingShort,
  targetDateLine,
  taskListTitles,
  uniqueTasks,
  hasOpenProject,
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
    expect(creditsOfLabel(0, 2)).toBe("0 of 1 credit");
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
    expect(taskStatusView("pending_review")).toEqual({ key: "submitted", label: "You marked this submitted" });
    expect(taskStatusView("official_passed").label).toMatch(/^Official/);
    expect(taskStatusView("retake_required").key).toBe("attention");
    expect(courseStatusView("awaiting_school").label).toBe("All work sent — waiting for the school");
    for (const st of ["not_started", "in_progress", "pending_review", "official_passed", "official_failed", "retake_required"] as const) {
      expect(taskStatusView(st).label).not.toMatch(/pending school review/i);
    }
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
  it("shows ONE pace measure: official credits against the expected-by-now tick", () => {
    const bar = paceBar(HS_MID_WAY);
    expect(bar.officialPercent).toBe(50);
    expect(bar.expectedPercent).toBe(61); // 13 of 21, floored
    expect(bar.summary).toBe("The plan expected 13 credits by now"); // the bar carries the official total
    expect(bar.ariaLabel).toBe("10.5 of 21 credits official; the plan expected 13 by now");
    expect(paceBar(HS_NEW_STUDENT).summary).toBeNull();
    expect(paceBar(HS_NEW_STUDENT).expectedPercent).toBeNull();
    expect(Object.keys(bar)).not.toContain("timePercent");
  });
  it("keeps the target-not-a-guarantee wording and never promises", () => {
    const line = targetDateLine(HS_MID_WAY, formatShortDate);
    expect(line).toContain("Jun 30, 2027");
    expect(line).toMatch(/target, not a guarantee/);
    expect(targetDateLine({ ...HS_MID_WAY, enrollment: { ...HS_MID_WAY.enrollment, targetCompletionDate: null } }, formatShortDate)).toMatch(/Lumière will set/);
    expect(targetDateLine(HS_AWAITING_REVIEW, formatShortDate)).toMatch(/All required credits are official/);
  });
  it("shows one pace measure: no weekly figure next to milestones", () => {
    const withMilestones = paceView({ weeklyTargetHalfUnits: 1, expectedByNowHalfUnits: 26, status: "behind", nextMilestone: { month: "2026-12", cumulativeHalfUnits: 28 } });
    expect(withMilestones.detail).not.toMatch(/Weekly target/);
    const weeklyOnly = paceView({ weeklyTargetHalfUnits: 1, expectedByNowHalfUnits: null, status: "on_track", nextMilestone: null });
    expect(weeklyOnly.detail).toMatch(/Weekly target: 0.5 credits/);
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
  it("phrases outstanding work encouragingly", () => {
    expect(outstandingWorkLabel({ outstandingExams: 11, outstandingProjects: 4 })).toBe("11 exams and 4 projects left in your plan");
    expect(outstandingWorkLabel({ outstandingExams: 1, outstandingProjects: 0 })).toBe("1 exam left in your plan");
    expect(outstandingWorkLabel({ outstandingExams: 0, outstandingProjects: 0 })).toBeNull();
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
    expect(claimStatusView("claimed").label).toBe("Not sent to the school yet");
    expect(claimStatusView("submitted_to_school").label).toBe("Under review by the school");
    expect(claimStatusView("accepted").label).toBe("Accepted by the school — credit not recorded yet");
    expect(claimStatusView("partially_accepted").label).toBe("Accepted by the school — credit not recorded yet");
    expect(claimStatusView("declined").key).toBe("attention");
  });
  it("claims never use the official status key unless the credit is recorded as transfer_credit", () => {
    for (const st of ["claimed", "submitted_to_school", "accepted", "partially_accepted", "declined"] as const) {
      expect(claimStatusView(st).key).not.toBe("official");
      expect(claimStatusView(st, false).key).not.toBe("official");
    }
    expect(claimStatusView("accepted", true)).toEqual({ key: "official", label: "Transfer credit recorded" });
    const recorded = recordedTransferTitles(HS_MID_WAY.subjects);
    expect(recorded.has("spanish 1")).toBe(true);
    expect(recorded.has("chemistry 1")).toBe(false);
  });
  it("shows the accepted amount when the school provided it", () => {
    expect(claimAcceptedLabel({ status: "partially_accepted", courseTitle: "x", claimedHalfUnits: 2, acceptedHalfUnits: 1 })).toBe("Accepted: 0.5 of 1 credit");
    expect(claimAcceptedLabel({ status: "accepted", courseTitle: "x", claimedHalfUnits: 2 })).toBeNull();
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

describe("S11 titles and lists", () => {
  it("shows template placeholders as plain titles with a to-be-confirmed flag", () => {
    expect(courseTitleView("Mathematics course 3 (confirmed per enrollment)")).toEqual({ title: "Mathematics course 3", toBeConfirmed: true });
    expect(courseTitleView("English 3")).toEqual({ title: "English 3", toBeConfirmed: false });
    expect(cleanCourseTitle("Social Studies course 2 (confirmed per enrollment)")).toBe("Social Studies course 2");
  });
  it("suffixes a repeated task title with its course and de-duplicates tasks", () => {
    const a = { key: "e", courseKey: "c1", courseTitle: "Biology", title: "Final exam" };
    const b = { key: "e", courseKey: "c2", courseTitle: "Math course 3 (confirmed per enrollment)", title: "Final exam" };
    const c = { key: "l", courseKey: "c1", courseTitle: "Biology", title: "Lessons" };
    const t = taskListTitles([a, b, c]);
    expect(t.get("c1:e")).toBe("Final exam (Biology)");
    expect(t.get("c2:e")).toBe("Final exam (Math course 3)");
    expect(t.get("c1:l")).toBe("Lessons");
    expect(uniqueTasks([a, a, b])).toHaveLength(2);
  });
  it("Journey attention drops what other cards already say (next task, pace)", () => {
    const kinds = journeyAttention(HS_MID_WAY).map((a) => a.kind);
    expect(kinds).toEqual(["documents_requested"]);
  });
  it("reported-but-unconfirmed work is plain text, never credit", () => {
    expect(reportedWaitingLabel(2, 1)).toBe("1 course fully sent (1 credit) — waiting for the school");
    expect(reportedWaitingLabel(3, 2)).toBe("2 courses fully sent (1.5 credits) — waiting for the school");
    expect(fullySentCourseCount(HS_MID_WAY.subjects)).toBe(1);
    expect(reportedWaitingLabel(0)).toBeNull();
  });
  it("gives every attention kind an owner and an action", () => {
    expect(attentionView({ kind: "documents_requested", message: "The school asked for your previous school's transcript." })).toEqual({ title: "Your school needs your previous transcript", detail: null, action: { kind: "documents", label: "Upload in Documents" } });
    expect(attentionView({ kind: "overdue_task", message: "x" }).action?.kind).toBe("course");
    const pace = attentionView({ kind: "behind_pace", message: "x" });
    expect(pace.title).toBe("Lumière can adjust your plan");
    expect(pace.action?.kind).toBe("support");
    expect(attentionView({ kind: "documents_requested", message: "Bank letter" }).title).toBe("Your school asked for a document");
  });
  it("flags courses with a written project still open", () => {
    const all = HS_MID_WAY.subjects.flatMap((s) => s.courses);
    expect(all.filter(hasOpenProject).map((c) => c.key)).toEqual(expect.arrayContaining(["english-3"]));
    expect(hasOpenProject(all.find((c) => c.status === "replaced")!)).toBe(false);
  });
});

describe("S11 subject grouping", () => {
  it("puts in-progress first, then not started; done and replaced get their own groups", () => {
    const eng = HS_MID_WAY.subjects.find((s) => s.subject === "english")!;
    const g = groupCourses(eng.courses);
    expect(g.active.map((c) => c.status)).toEqual(["in_progress", "not_started"]);
    expect(g.done.map((c) => c.status)).toEqual(["official_complete", "official_complete"]);
    const math = groupCourses(HS_MID_WAY.subjects.find((s) => s.subject === "mathematics")!.courses);
    expect(math.earlier).toHaveLength(1);
    expect(math.active.map((c) => c.title)).toEqual(["Geometry"]);
    const el = groupCourses(HS_MID_WAY.subjects.find((s) => s.subject === "electives")!.courses);
    expect(el.done.map((c) => c.status)).toContain("transfer_credit");
  });
  it("finds the subject holding the current course", () => {
    expect(currentSubject(HS_MID_WAY)).toBe("english");
    expect(currentSubject(HS_GRADUATED)).toBeNull();
  });
  it("shortens guardian lines", () => {
    expect(guardianSharingShort(GUARDIANS_ALL[0])).toBe("Lumière may discuss grades and progress.");
    expect(guardianSharingShort(GUARDIANS_ALL[1])).toBe("Lumière does not discuss grades or billing.");
  });
});

describe("S11 fixture dates are consistent on every screen (today = 2026-10-26)", () => {
  const all = { HS_NEW_STUDENT, HS_MID_WAY, HS_TENNESSEE, HS_NEARLY_DONE, HS_AWAITING_REVIEW, HS_ELIGIBLE, HS_GRADUATED };
  for (const [name, v] of Object.entries(all)) {
    it(`${name}: started <= roadmap published <= every open task target and planned window`, () => {
      const started = v.enrollment.startedOn!;
      const published = v.roadmap!.publishedAt.slice(0, 10);
      expect(started <= published).toBe(true);
      expect(published <= HS_TODAY).toBe(true);
      for (const c of v.subjects.flatMap((s) => s.courses)) {
        if (c.plannedStart) expect(c.plannedStart >= published).toBe(true);
        if (c.plannedStart && c.plannedEnd) expect(c.plannedStart <= c.plannedEnd).toBe(true);
        for (const t of c.tasks) if (t.dueDate) expect(t.dueDate >= published).toBe(true);
      }
      expect(v.enrollment.programTitle).toContain(`(${v.credits.requiredHalfUnits / 2} credits)`);
    });
  }
  it("new student: started Oct 19, published Oct 20, first target after that", () => {
    expect(HS_NEW_STUDENT.enrollment.startedOn).toBe("2026-10-19");
    expect(HS_NEW_STUDENT.roadmap!.publishedAt.startsWith("2026-10-20")).toBe(true);
    const dues = HS_NEW_STUDENT.subjects.flatMap((s) => s.courses).flatMap((c) => c.tasks).map((t) => t.dueDate).filter((d): d is string => !!d);
    expect(dues.length).toBeGreaterThan(0);
    expect(dues.every((d) => d >= "2026-10-20")).toBe(true);
  });
  it("graduated: plausible span, started Sep 2025 and conferred Oct 2026", () => {
    expect(HS_GRADUATED.enrollment.startedOn).toBe("2025-09-02");
    expect(HS_GRADUATED.graduation.diploma.conferredOn).toBe("2026-10-10");
    expect(HS_GRADUATED.graduation.eligibilityConfirmedAt! >= "2026-09-01").toBe(true);
  });
});

describe("S13 presentation", () => {
  it("an accepted-but-unrecorded claim never uses the check styles", () => {
    for (const st of ["accepted", "partially_accepted"] as const) {
      expect(["applied", "official"]).not.toContain(claimStatusView(st).key);
    }
  });
});
