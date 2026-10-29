import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, computeCheckpoints, computeDeadlines, computePace, computeSupport, daysBetween, mondayOf, monthsLeft, type AgreementTerms, type PaceInput,
} from "../server/services/program-journey/math";
import { buildControlCenter, type ControlCenterFacts } from "../server/services/program-journey/control-center";
import { TEMPLATE_STANDARD_21_V3, TEMPLATE_STANDARD_21_V2, validateTemplate, sumHalfUnits } from "../shared/high-school-contract";
import { contentFromTemplate } from "../shared/high-school-projection";
import { makeContractPlan, makeDemoPlan } from "../scripts/s26/demo-plan.mjs";

const terms = (o: Partial<AgreementTerms> = {}): AgreementTerms => ({
  signedOn: "2026-11-02", activatedOn: "2026-11-09", supportMonths: 9, accessMonths: 36, languageTestDays: 30, priorSchoolingDays: 90,
  languageTestStatus: "open", languageTestDoneOn: null, languageTestScore: null, languageTestTarget: null,
  priorSchoolingStatus: "open", priorSchoolingDoneOn: null, ...o,
});

describe("S27 date and deadline math", () => {
  it("adds days and months with end-of-month clamping", () => {
    expect(addDays("2026-11-02", 30)).toBe("2026-12-02");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-09", 9)).toBe("2027-08-09");
    expect(daysBetween("2026-11-02", "2026-11-01")).toBe(-1);
    expect(mondayOf("2026-11-01")).toBe("2026-10-26"); // Sunday -> previous Monday
    expect(mondayOf("2026-10-26")).toBe("2026-10-26");
  });
  it("language test is signedOn + 30; prior schooling is activatedOn + 90; null without anchors", () => {
    const [lt, ps] = computeDeadlines(terms(), "2026-11-10");
    expect(lt!.dueOn).toBe("2026-12-02");
    expect(lt!.daysLeft).toBe(22);
    expect(ps!.dueOn).toBe("2027-02-07");
    const none = computeDeadlines(terms({ signedOn: null, activatedOn: null }), "2026-11-10");
    expect(none.map((d) => d.dueOn)).toEqual([null, null]);
    expect(none.map((d) => d.daysLeft)).toEqual([null, null]);
  });
  it("overdue is negative, done/waived have no daysLeft, score detail is rendered", () => {
    const [lt] = computeDeadlines(terms({ languageTestStatus: "open" }), "2026-12-05");
    expect(lt!.daysLeft).toBe(-3);
    const [done] = computeDeadlines(terms({ languageTestStatus: "done", languageTestDoneOn: "2026-11-20", languageTestScore: 112, languageTestTarget: "105–115" }), "2026-12-05");
    expect(done!.daysLeft).toBeNull();
    expect(done!.doneOn).toBe("2026-11-20");
    expect(done!.detail).toBe("Score 112 (target 105–115)");
  });
  it("support and access end dates and months left (rounded up)", () => {
    const s = computeSupport(terms(), "2026-11-09");
    expect(s).toEqual({ supportEndsOn: "2027-08-09", accessEndsOn: "2029-11-09", supportMonthsLeft: 9 });
    expect(monthsLeft("2027-07-15", "2027-08-09")).toBe(1);
    expect(monthsLeft("2027-08-09", "2027-08-09")).toBe(0);
    expect(computeSupport(terms({ activatedOn: null }), "2026-11-09").supportMonthsLeft).toBeNull();
  });
});

describe("S27 checkpoints", () => {
  it("first not-done is next, the rest upcoming; language_test auto-done from the deadline", () => {
    const cps = computeCheckpoints([{ key: "file_opened", plannedOn: null, doneOn: "2026-10-30" }], { status: "open", doneOn: null });
    expect(cps.map((c) => c.status)).toEqual(["done", "next", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
    const auto = computeCheckpoints([{ key: "file_opened", plannedOn: null, doneOn: "2026-10-30" }], { status: "done", doneOn: "2026-11-20" });
    const lt = auto.find((c) => c.key === "language_test")!;
    expect(lt.status).toBe("done");
    expect(lt.doneOn).toBe("2026-11-20");
    expect(auto.find((c) => c.status === "next")!.key).toBe("program_activated");
  });
});

describe("S27 logged pace", () => {
  const courses = [
    { key: "a", halfUnits: 2, tasks: new Map<string, "lesson" | "exam" | "project">([["a-1", "exam"], ["a-2", "exam"], ["a-3", "exam"], ["a-4", "exam"]]) },
    { key: "b", halfUnits: 2, tasks: new Map<string, "lesson" | "exam" | "project">([["b-1", "exam"], ["b-2", "exam"]]) },
  ];
  const base = (o: Partial<PaceInput> = {}): PaceInput => ({
    today: "2026-11-11", requiredHalfUnits: 4, courses, logged: [], awardedCourseKeys: new Set(), otherAwardedHalfUnits: 0, weeklyExamLimit: 15, ...o,
  });
  it("is zero and stale with nothing logged", () => {
    const p = computePace(base());
    expect(p).toMatchObject({ creditsPerWeek: 0, itemsLogged28d: 0, lastLoggedOn: null, stale: true, estimatedFinishOn: null, examsThisWeek: 0, weeklyExamLimit: 15 });
  });
  it("converts logged tasks to credit-equivalents over 28 days and estimates the finish", () => {
    // 2 tasks of course a (0.25 each) + 1 task of b (0.5) = 1.0 credit in 28 days -> 0.25/week
    const p = computePace(base({ logged: [
      { courseKey: "a", taskKey: "a-1", at: "2026-11-10T09:00:00Z" }, { courseKey: "a", taskKey: "a-2", at: "2026-11-02T09:00:00Z" }, { courseKey: "b", taskKey: "b-1", at: "2026-10-20T09:00:00Z" },
    ] }));
    expect(p.creditsPerWeek).toBe(0.25);
    expect(p.itemsLogged28d).toBe(3);
    expect(p.lastLoggedOn).toBe("2026-11-10");
    expect(p.stale).toBe(false);
    // remaining = 2 - 1.0 logged = 1.0 -> 4 weeks
    expect(p.estimatedFinishOn).toBe("2026-12-09");
  });
  it("ignores unknown tasks and items older than 28 days; stale after 7 days", () => {
    const p = computePace(base({ logged: [
      { courseKey: "a", taskKey: "zzz", at: "2026-11-10T00:00:00Z" }, { courseKey: "a", taskKey: "a-1", at: "2026-09-01T00:00:00Z" },
    ] }));
    expect(p.itemsLogged28d).toBe(0);
    expect(p.stale).toBe(true);
    expect(computePace(base({ logged: [{ courseKey: "a", taskKey: "a-1", at: "2026-11-04T00:00:00Z" }] })).stale).toBe(true);
    expect(computePace(base({ logged: [{ courseKey: "a", taskKey: "a-1", at: "2026-11-05T00:00:00Z" }] })).stale).toBe(false);
  });
  it("counts exams since Monday and does not double-count official credit", () => {
    const p = computePace(base({
      today: "2026-11-11", // Wednesday; Monday = 2026-11-09
      logged: [
        { courseKey: "a", taskKey: "a-1", at: "2026-11-09T10:00:00Z" }, { courseKey: "a", taskKey: "a-2", at: "2026-11-08T10:00:00Z" }, { courseKey: "b", taskKey: "b-1", at: "2026-11-10T10:00:00Z" },
      ],
      awardedCourseKeys: new Set(["b"]),
    }));
    expect(p.examsThisWeek).toBe(2);
    // official b (1) + logged a (0.5) of 2 required -> remaining 0.5 at 0.25/week
    expect(p.estimatedFinishOn).toBe("2026-11-25");
  });
  it("leaves the finish empty when the pace would project more than three years out", () => {
    // 0.25 credit/week against 42 credits required -> ~164 weeks: not a meaningful date
    const p = computePace(base({ requiredHalfUnits: 84, logged: [{ courseKey: "a", taskKey: "a-1", at: "2026-11-10T10:00:00Z" }, { courseKey: "a", taskKey: "a-2", at: "2026-11-09T10:00:00Z" }, { courseKey: "b", taskKey: "b-1", at: "2026-11-08T10:00:00Z" }] }));
    expect(p.creditsPerWeek).toBe(0.25);
    expect(p.estimatedFinishOn).toBeNull();
  });
  it("finish is today when nothing remains", () => {
    expect(computePace(base({ awardedCourseKeys: new Set(["a", "b"]) })).estimatedFinishOn).toBe("2026-11-11");
  });
});

describe("S27 template v3", () => {
  const t = TEMPLATE_STANDARD_21_V3;
  it("is a new version, valid, 42 half-units, v2 untouched", () => {
    expect(t.templateKey).toBe("us-hs-diploma-21");
    expect(t.version).toBe(3);
    expect(validateTemplate(t)).toEqual([]);
    expect(sumHalfUnits(t.courses.map((c) => c.halfUnits))).toBe(42);
    expect(TEMPLATE_STANDARD_21_V2.courses).toHaveLength(17);
    expect(TEMPLATE_STANDARD_21_V2.courses.every((c) => !c.assessments)).toBe(true);
  });
  it("has the contracted course order, assessment counts and policies", () => {
    expect(t.courses.map((c) => c.title)).toEqual([
      "Foundations of Personal Growth", "Learning Success through Technology", "English 1", "General Math I", "English 2", "General Math II", "Digital Literacy",
      "Earth Science", "World History", "Health and Nutrition", "Biology", "English 3", "Physical Science", "U.S. History", "English 4", "Personal Finance",
      "U.S. Government and Economics", "Microsoft Word & Excel", "Business Math", "English Communications", "Human Relations", "Reading Skills",
    ]);
    expect(t.courses.map((c) => c.assessments?.exams)).toEqual([7, 8, 10, 6, 5, 4, 6, 6, 6, 5, 6, 5, 6, 6, 5, 5, 6, 2, 3, 3, 3, 3]);
    expect(t.courses.filter((c) => c.assessments?.projectAfterExam === 3).map((c) => c.key)).toEqual(["english-2", "english-3", "english-4"]);
    expect(t.policies).toMatchObject({ passingPercent: 65, weeklyExamLimit: 15 });
    expect(t.policies.retakeNote).toMatch(/one retake within 30 days.*capped at 65%/);
    expect(JSON.stringify(t)).not.toMatch(/penn|foster|pfhs/i);
  });
  it("draft generates exam/project tasks; plan builders accept it", () => {
    const { content } = contentFromTemplate(t, 42, null);
    expect(content.courses.find((c) => c.key === "english-2")!.tasks.map((x) => x.key)).toEqual(["english-2-exam-1", "english-2-exam-2", "english-2-exam-3", "english-2-project", "english-2-exam-4", "english-2-exam-5"]);
    expect(content.courses.find((c) => c.key === "english-1")!.tasks).toHaveLength(10);
    const demo = makeDemoPlan(content);
    expect(demo.courses).toHaveLength(22);
    expect(demo.courses.every((c) => c.plannedStart && c.tasks.every((x) => x.dueDate))).toBe(true);
    const contract = makeContractPlan(content);
    expect(contract.courses.map((c) => c.key).slice(0, 4)).toEqual(["startup-personal-growth", "startup-learning-tech", "english-1", "math-general-1"]);
    expect(contract.courses.every((c) => c.plannedStart === null)).toBe(true);
  });
});

describe("S27 control center aggregate (pure)", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const facts = (): ControlCenterFacts => ({
    students: [
      { id: "s1", code: "C1", name: "Real One", preferredName: null, userId: "u1" },
      { id: "d1", code: "D1", name: "DEMO One", preferredName: "DEMO-X", userId: "ud" },
    ],
    enrollments: [], progress: [], awards: [], results: [],
    agreements: [
      { studentId: "s1", signedOn: "2026-10-20", activatedOn: null, supportMonths: 9, accessMonths: 36, languageTestDays: 30, priorSchoolingDays: 90, languageTestStatus: "open", languageTestDoneOn: null, priorSchoolingStatus: "open", priorSchoolingDoneOn: null },
      { studentId: "d1", signedOn: "2026-10-20", activatedOn: null, supportMonths: 9, accessMonths: 36, languageTestDays: 30, priorSchoolingDays: 90, languageTestStatus: "open", languageTestDoneOn: null, priorSchoolingStatus: "open", priorSchoolingDoneOn: null },
    ],
    pendingDocuments: [{ studentId: "s1", count: 2 }, { studentId: "d1", count: 5 }], evidenceAwaiting: [{ studentId: "s1", count: 1 }],
    billing: [], receiptsThisMonth: [], tickets: [], sessionRequests: [],
  });
  it("builds queue items with hrefs, excludes demo from queue and counts but lists the row", () => {
    const v = buildControlCenter(facts(), now);
    const kinds = v.queue.map((q) => q.kind).sort();
    expect(kinds).toEqual(["deadline_soon", "document_review", "payment_evidence", "payment_missing"]);
    expect(v.queue.every((q) => q.studentId === "s1")).toBe(true);
    expect(v.queue.find((q) => q.kind === "document_review")!.href).toBe("/admin/students/s1?tab=documents");
    expect(v.queue.find((q) => q.kind === "payment_evidence")!.href).toBe("/admin/students/s1?tab=billing");
    expect(v.students.map((r) => [r.studentId, r.isDemo])).toEqual([["s1", false], ["d1", true]]);
    expect(v.payments.signedNotPaid).toBe(1);
    expect(v.counts.needsYou).toBe(1);
    expect(v.counts.deadlines14d).toBe(1); // language test due 2026-11-19 (8 days)
    expect(v.counts.preEnrollment).toBe(1);
    expect(v.deadlines).toHaveLength(1);
  });
});
