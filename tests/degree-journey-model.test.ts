import { describe, expect, it } from "vitest";
import type { StudentRoadmapItemView, StudentRoadmapView } from "../shared/student-roadmap-contract";
import type { StudentDegreeProgressView } from "../shared/student-degree-progress-view";
import {
  buildCreditsBySource,
  buildWarnings,
  classifyCreditSource,
  cleanRequirementName,
  distribute,
  formatCents,
  safeProviderUrl,
  splitCourses,
  taskDots,
  toCents,
} from "../client/src/components/degree-journey/model";
import { roadmapItemSchema } from "../shared/student-roadmap-contract";
import { djEn, djFr, djTranslate } from "../client/src/components/degree-journey/i18n";

function task(key: string, status: "not_started" | "in_progress" | "submitted" | "graded") {
  return { key, kind: "exam" as const, title: key, dueDate: null, status, revision: 0, updatedAt: null };
}

function item(over: Partial<StudentRoadmapItemView> & { key: string }): StudentRoadmapItemView {
  return {
    phaseKey: "p1", objectiveKey: "o1", sequence: 1, kind: "course", code: null, title: over.key, provider: null, institution: null,
    credits: "3", plannedStart: null, plannedEnd: null, planStatus: "planned", holdReason: null, approval: null, alternativeOf: null,
    studentNote: null, waitingOn: [], itemStatus: "not_started", itemRevision: 0, tasks: [],
    taskCounts: { total: 0, graded: 0, submitted: 0, inProgress: 0, notStarted: 0 },
    stage: "not_started", official: null, canReport: true, reportBlockedReason: null, ...over,
  } as StudentRoadmapItemView;
}

function roadmap(items: StudentRoadmapItemView[], focus: string[] = [], ladder: Partial<StudentRoadmapView["foundation"]["ladder"]> = {}): StudentRoadmapView {
  return {
    contractVersion: "student-roadmap/1", state: "PUBLISHED", preview: false,
    plan: { title: "Plan", summary: null, versionNumber: 1, publishedAt: null },
    objectives: [],
    phases: [{ key: "p1", title: "P1", sequence: 1, objectiveKey: null, startDate: null, endDate: null, description: null, items, counts: {} as never, state: "current" }],
    milestones: [], counts: {} as never,
    today: { focusItemKeys: focus, headline: "", detail: "", nextMilestoneKey: null },
    foundation: { credentials: [], sources: [], degreeState: "COMPOSED", ladder: { reported: "0", provisional: "0", verified: "0", applied: "60", surplus: null, planned: "0", required: "120", ...ladder } },
    history: { previousVersions: [], retiredProgress: [] },
  } as StudentRoadmapView;
}

function progress(over: Partial<StudentDegreeProgressView> = {}): StudentDegreeProgressView {
  return {
    contractVersion: "student-degree-progress/1", state: "COMPOSED", asOf: null, program: null,
    totals: { unit: "credit", requiredCredits: "120", appliedCredits: "60", remainingCredits: "60", verifiedCreditsOnRecord: "60", requirementsSatisfied: 0, requirementsTotal: 0 },
    requirements: [], attention: [], milestones: [], nextSteps: [],
    sources: [
      { sourceId: "s1", title: "State College transcript", sourceType: "transcript", status: "verified", sourceDate: null, receivedAt: null, creditRecordCount: 1 },
      { sourceId: "s2", title: "ACE workplace review", sourceType: "provider_record", status: "verified", sourceDate: null, receivedAt: null, creditRecordCount: 1 },
      { sourceId: "s3", title: "Score report", sourceType: "exam_score", status: "verified", sourceDate: null, receivedAt: null, creditRecordCount: 1 },
    ],
    credits: [
      { creditRecordId: "c1", courseCode: null, title: "Intro", term: null, completedOn: null, recordType: "course", reportedCredits: "30", awardedCredits: "30", standing: "VERIFIED_APPLIED", sourceId: "s1", appliedToRequirementIds: [] },
      { creditRecordId: "c2", courseCode: null, title: "Leadership", term: null, completedOn: null, recordType: "course", reportedCredits: "15", awardedCredits: "15", standing: "VERIFIED_APPLIED", sourceId: "s2", appliedToRequirementIds: [] },
      { creditRecordId: "c3", courseCode: null, title: "Exam", term: null, completedOn: null, recordType: "exam", reportedCredits: "15", awardedCredits: "15", standing: "VERIFIED_APPLIED", sourceId: "s3", appliedToRequirementIds: [] },
      { creditRecordId: "c4", courseCode: null, title: "Pending", term: null, completedOn: null, recordType: "course", reportedCredits: "9", awardedCredits: null, standing: "PENDING_VERIFICATION", sourceId: "s1", appliedToRequirementIds: [] },
    ],
    ...over,
  } as StudentDegreeProgressView;
}

describe("decimal helpers", () => {
  it("parses and formats without floats", () => {
    expect(toCents("120")).toBe(12000);
    expect(toCents("7.5")).toBe(750);
    expect(toCents("0.25")).toBe(25);
    expect(toCents(null)).toBeNull();
    expect(toCents("abc")).toBeNull();
    expect(formatCents(12000)).toBe("120");
    expect(formatCents(750)).toBe("7.5");
    expect(formatCents(750, "fr")).toBe("7,5");
    expect(formatCents(25)).toBe("0.25");
  });
  it("distribute always sums to the total", () => {
    const parts = distribute(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(distribute(10, [0, 0])).toEqual([0, 0]);
  });
});

describe("credits by source", () => {
  it("classifies sources", () => {
    const sources = new Map([
      ["s1", { sourceType: "transcript", title: "x" }],
      ["s2", { sourceType: "provider_record", title: "ACE review" }],
      ["s3", { sourceType: "provider_record", title: "Course vendor" }],
    ]);
    expect(classifyCreditSource({ sourceId: "s1", recordType: "course", title: "" }, sources)).toBe("transfer");
    expect(classifyCreditSource({ sourceId: "s2", recordType: "course", title: "" }, sources)).toBe("workplace");
    expect(classifyCreditSource({ sourceId: "s3", recordType: "course", title: "" }, sources)).toBe("provider");
    expect(classifyCreditSource({ sourceId: "s3", recordType: "exam", title: "" }, sources)).toBe("exam");
    expect(classifyCreditSource({ sourceId: null, recordType: "course", title: "" }, sources)).toBe("other");
  });

  it("stacks earned by source, planned by provider and open, summing to the required credits", () => {
    const r = roadmap([
      item({ key: "a", provider: "Provider A", credits: "3", stage: "in_progress" }),
      item({ key: "b", provider: "Provider A", credits: "3" }),
      item({ key: "c", provider: "Provider B", credits: "6" }),
      item({ key: "d", provider: "Provider B", credits: "3", stage: "officially_accepted" }),
      item({ key: "e", provider: "Provider B", credits: "3", planStatus: "dropped" }),
    ]);
    const c = buildCreditsBySource(r, progress());
    expect(c.state).toBe("ready");
    expect(c.requiredCents).toBe(12000);
    expect(c.earnedCents).toBe(6000);
    const earned = c.segments.filter((s) => s.group === "earned");
    expect(earned.map((s) => [s.sourceKind, s.cents])).toEqual([["transfer", 3000], ["workplace", 1500], ["exam", 1500]]);
    const planned = c.segments.filter((s) => s.group === "planned");
    expect(planned.map((s) => [s.providerName, s.cents, s.startedCents])).toEqual([["Provider A", 600, 300], ["Provider B", 600, 0]]);
    expect(c.openCents).toBe(12000 - 6000 - 1200);
    expect(c.segments.reduce((a, s) => a + s.cents, 0)).toBe(12000);
    expect(c.overPlanned).toBe(false);
  });

  it("scales earned sources to the canonical applied total", () => {
    const p = progress({ totals: { ...progress().totals!, appliedCredits: "30" } });
    const c = buildCreditsBySource(roadmap([]), p);
    expect(c.segments.filter((s) => s.group === "earned").reduce((a, s) => a + s.cents, 0)).toBe(3000);
  });

  it("falls back to the roadmap ladder when degree progress is unavailable, and hides open when earned is unknown", () => {
    const c = buildCreditsBySource(roadmap([]), null);
    expect(c.earnedCents).toBe(6000);
    expect(c.segments[0]).toMatchObject({ group: "earned", sourceKind: "other" });
    const unknown = buildCreditsBySource(roadmap([], [], { applied: null, required: null }), null);
    expect(unknown.state).toBe("unavailable");
    expect(unknown.openCents).toBeNull();
  });

  it("flags a plan that covers more than needed and never goes negative", () => {
    const c = buildCreditsBySource(roadmap([item({ key: "x", credits: "90" })]), progress());
    expect(c.overPlanned).toBe(true);
    expect(c.openCents).toBe(0);
  });
});

describe("courses split and dots", () => {
  it("buckets now / up next / completed", () => {
    const r = roadmap(
      [
        item({ key: "started", sequence: 1, stage: "in_progress" }),
        item({ key: "focus", sequence: 2 }),
        item({ key: "later", sequence: 3 }),
        item({ key: "held", sequence: 4, planStatus: "hold", canReport: false, reportBlockedReason: "on_hold" }),
        item({ key: "done", sequence: 5, stage: "provider_complete" }),
        item({ key: "alt", sequence: 6, planStatus: "alternative" }),
      ],
      ["focus", "held"],
    );
    const b = splitCourses(r);
    expect(b.now.map((i) => i.key)).toEqual(["started", "focus"]);
    expect(b.upNext.map((i) => i.key)).toEqual(["later", "held"]);
    expect(b.completed.map((i) => i.key)).toEqual(["done"]);
  });

  it("maps task status to dots and caps them", () => {
    const tasks = [task("t1", "graded"), task("t2", "submitted"), task("t3", "in_progress"), task("t4", "not_started")];
    const { dots, hidden } = taskDots({ tasks });
    expect(dots.map((d) => d.state)).toEqual(["passed", "submitted", "started", "todo"]);
    expect(dots[3].n).toBe(4);
    expect(hidden).toBe(0);
    const many = taskDots({ tasks: Array.from({ length: 15 }, (_, i) => task(`t${i}`, "not_started")) });
    expect(many.dots).toHaveLength(12);
    expect(many.hidden).toBe(3);
  });

  it("accepts only https links", () => {
    expect(safeProviderUrl("https://example.org/c")).toBe("https://example.org/c");
    expect(safeProviderUrl("http://example.org")).toBeNull();
    expect(safeProviderUrl("javascript:alert(1)")).toBeNull();
    expect(safeProviderUrl(undefined)).toBeNull();
  });
});

describe("warnings in plain language", () => {
  it("translates approvals, holds, grades and residency without codes or caps", () => {
    const r = roadmap([
      item({ key: "sci", code: "SCI110", title: "Science", canReport: false, reportBlockedReason: "approval_pending", approval: { required: true, status: "pending" } }),
      item({ key: "held", code: "HIS101", planStatus: "hold", canReport: false, reportBlockedReason: "on_hold", holdReason: "POLICY-77 cap 15" }),
      item({ key: "g", code: "ENG101", stage: "graded" }),
      item({ key: "f", code: "BUS101", stage: "provider_complete", official: { standing: "PENDING_VERIFICATION", awardedCredits: null } }),
    ]);
    const p = progress({
      requirements: [
        { requirementId: "r1", code: "RES-15", title: "Residency: credits taken at the university", sequence: 1, status: "PARTIAL", unit: "credit", requiredAmount: "15", appliedAmount: "0", remainingAmount: "15", appliedCreditRecordIds: [] },
        { requirementId: "r2", code: "GEN-1", title: "GEN-1 Humanities", sequence: 2, status: "CONFLICT", unit: "credit", requiredAmount: "6", appliedAmount: "3", remainingAmount: "3", appliedCreditRecordIds: [] },
        { requirementId: "r3", code: "X", title: "Electives", sequence: 3, status: "MISSING", unit: "credit", requiredAmount: "9", appliedAmount: "0", remainingAmount: "9", appliedCreditRecordIds: [] },
      ],
      attention: [{ kind: "CREDIT_PENDING_VERIFICATION", owner: "staff", title: "RAW TITLE", detail: "RAW DETAIL", creditRecordId: "c4" }],
    });
    const w = buildWarnings(r, p);
    const text = w.map((x) => djTranslate("en", x.key, x.params as Record<string, string | number>)).join("\n");
    expect(text).toContain("Waiting for the university to approve SCI110.");
    expect(text).toContain("HIS101 is on hold.");
    expect(text).toContain("ENG101: grade posted. The university still has to confirm it.");
    expect(text).toContain("15 credits must be taken at the university itself.");
    expect(text).toContain("The university is still checking BUS101.");
    expect(text).toContain("one part of your degree: Humanities");
    expect(text).toContain("waiting for the university to verify it");
    for (const bad of ["POLICY", "cap 15", "RES-15", "GEN-1", "RAW"]) expect(text).not.toContain(bad);
    expect(text).not.toContain("Electives"); // open credit is not a warning
    expect(w[0].tone).toBe("attention");
  });

  it("is empty for a clean plan", () => {
    expect(buildWarnings(roadmap([item({ key: "a" })]), progress())).toEqual([]);
  });

  it("strips requirement codes from names", () => {
    expect(cleanRequirementName("GEN-101: Humanities", "GEN-101")).toBe("Humanities");
    expect(cleanRequirementName("Humanities", null)).toBe("Humanities");
  });
});

describe("i18n", () => {
  it("has every English key in French with the same placeholders", () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of Object.keys(djEn) as (keyof typeof djEn)[]) {
      expect(djFr[k], k).toBeTruthy();
      expect(ph(djFr[k]), k).toBe(ph(djEn[k]));
    }
    expect(Object.keys(djFr).length).toBe(Object.keys(djEn).length);
  });
});

describe("providerUrl schema", () => {
  const base = { key: "a", phaseKey: "p", objectiveKey: "o", sequence: 0, title: "T" };
  const parse = (providerUrl: unknown) => roadmapItemSchema.safeParse({ ...base, providerUrl }).success;
  it("accepts plain https and absent/null", () => {
    expect(parse("https://example.org/course/1")).toBe(true);
    expect(parse(null)).toBe(true);
    expect(parse(undefined)).toBe(true);
  });
  it("rejects javascript:, data:, http: and userinfo", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "http://example.org", "https://user:pw@example.org", "https://user@example.org", "https:// spaced.org"]) {
      expect(parse(bad), bad).toBe(false);
    }
  });
});

describe("credits bar guard", () => {
  it("treats zero required credits as unavailable (no NaN)", () => {
    const c = buildCreditsBySource(roadmap([], [], { required: "0", applied: "0" }), null);
    expect(c.state).toBe("unavailable");
    expect(c.requiredCents).toBeNull();
  });
});
