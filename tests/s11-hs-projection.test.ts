/**
 * S11 — pure projection / validation unit tests (no database).
 * Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_TEMPLATES,
  GENERIC_SCHOOL_DESCRIPTION,
  TEMPLATE_STANDARD_21,
  TEMPLATE_TN_22,
  creditsToHalfUnits,
  formatHalfUnits,
  hsRoadmapContentSchema,
  validateTemplate,
  type HsRoadmapContent,
} from "../shared/high-school-contract";
import {
  computeCreditSummary,
  computePace,
  computeReviewQueue,
  contentFromTemplate,
  courseDisplayStatus,
  creditBlockers,
  effectivePolicies,
  hsCurriculumTemplateSchema,
  projectStudentView,
  schoolDisplayNameFor,
  taskDisplayStatus,
  toGuardianView,
  validateRoadmapContent,
  type HsAwardRecord,
  type HsProjectionInput,
} from "../shared/high-school-projection";

const NOW = "2026-10-26T12:00:00.000Z";
const award = (id: string, areaKey: string, halfUnits: number, status: "active" | "voided" = "active"): HsAwardRecord => ({
  id,
  source: "course_completion",
  courseKey: id,
  areaKey,
  halfUnits,
  status,
});

describe("half-unit credit arithmetic", () => {
  it("built-in templates are structurally valid and total 21 / 22 credits (16+5 and 17+5)", () => {
    for (const t of BUILT_IN_TEMPLATES) expect(validateTemplate(t)).toEqual([]);
    expect(TEMPLATE_STANDARD_21.totalRequiredHalfUnits).toBe(42);
    const core = TEMPLATE_STANDARD_21.areas.filter((a) => a.kind === "core").reduce((n, a) => n + a.requiredHalfUnits, 0);
    const elective = TEMPLATE_STANDARD_21.areas.filter((a) => a.kind === "elective").reduce((n, a) => n + a.requiredHalfUnits, 0);
    expect([core, elective]).toEqual([32, 10]);
    expect(TEMPLATE_TN_22.totalRequiredHalfUnits).toBe(44);
  });

  it("never uses floats: 41 half-units is exactly 20.5, 1 is 0.5", () => {
    expect(formatHalfUnits(41)).toBe("20.5");
    expect(formatHalfUnits(1)).toBe("0.5");
    expect(creditsToHalfUnits(20.5)).toBe(41);
    expect(() => creditsToHalfUnits(0.3)).toThrow(RangeError);
  });

  it("counts ACTIVE awards only, caps per area, and keeps core and elective apart", () => {
    const areas = TEMPLATE_STANDARD_21.areas;
    const awards = [
      award("a", "english", 6), // 3 credits
      award("b", "english", 4), // 2 more -> 5 earned, 4 required
      award("c", "electives", 3),
      award("d", "math", 2, "voided"),
    ];
    const s = computeCreditSummary(areas, 42, awards);
    expect(s.earnedHalfUnits).toBe(13); // voided excluded
    const english = s.byArea.find((a) => a.key === "english")!;
    expect([english.earnedHalfUnits, english.countedHalfUnits]).toEqual([10, 8]);
    expect(s.byArea.find((a) => a.key === "math")!.earnedHalfUnits).toBe(0);
    expect(s.core).toEqual({ requiredHalfUnits: 32, earnedHalfUnits: 8 });
    expect(s.elective).toEqual({ requiredHalfUnits: 10, earnedHalfUnits: 3 });
    expect(s.remainingHalfUnits).toBe(29);
    expect(s.percentComplete).toBe(30);
  });

  it("the total is configurable: 44 half-units (22 credits) is respected, never capped at 42", () => {
    const content = contentFromTemplate(TEMPLATE_STANDARD_21, 44, null);
    expect(content.error).toBeNull();
    expect(content.content.areas.find((a) => a.key === "electives")!.requiredHalfUnits).toBe(12);
    const s = computeCreditSummary(content.content.areas, 44, [award("x", "electives", 12)]);
    expect(s.requiredHalfUnits).toBe(44);
    expect(contentFromTemplate(TEMPLATE_STANDARD_21, 20, null).error).toMatch(/cannot be reached/);
  });

  it("blockers name the total shortfall and each unmet area; a met elective area does not block", () => {
    const s = computeCreditSummary(TEMPLATE_STANDARD_21.areas, 42, [award("a", "electives", 10)]);
    const blockers = creditBlockers(s);
    expect(blockers[0]).toBe("Earned 5 of 21 required credits");
    expect(blockers.some((b) => b.startsWith("Core area English"))).toBe(true);
    expect(blockers.some((b) => b.includes("Electives"))).toBe(false);
  });

  it("surplus core credit never fills an elective shortfall", () => {
    // 16 core + 1 extra English credit = 21 total, but only 4 of 5 elective credits.
    const core = TEMPLATE_STANDARD_21.areas.filter((a) => a.kind === "core").map((a) => award(`c-${a.key}`, a.key, a.requiredHalfUnits));
    const s = computeCreditSummary(TEMPLATE_STANDARD_21.areas, 42, [...core, award("extra-english", "english", 2), award("el", "electives", 8)]);
    expect(s.earnedHalfUnits).toBe(42);
    expect(creditBlockers(s)).toEqual(["Elective area Electives: 4 of 5 credits"]);
  });
});

describe("reported vs official", () => {
  const rep = (status: "not_started" | "in_progress" | "submitted", score: number | null, at = "2026-10-20T00:00:00.000Z") => ({ status, reportedScorePercent: score, updatedAt: at });
  it("a student report never becomes official", () => {
    expect(taskDisplayStatus(null, null)).toBe("not_started");
    expect(taskDisplayStatus(rep("in_progress", null), null)).toBe("in_progress");
    expect(taskDisplayStatus(rep("submitted", null), null)).toBe("pending_review");
    expect(taskDisplayStatus(rep("in_progress", 95), null)).toBe("pending_review");
  });
  it("official results win, except that a newer student report after a failure is pending again", () => {
    const failed = { outcome: "failed" as const, recordedAt: "2026-10-21T00:00:00.000Z" };
    expect(taskDisplayStatus(rep("submitted", null, "2026-10-20T00:00:00.000Z"), failed)).toBe("official_failed");
    expect(taskDisplayStatus(rep("submitted", null, "2026-10-22T00:00:00.000Z"), failed)).toBe("pending_review");
    expect(taskDisplayStatus(rep("submitted", null, "2026-10-22T00:00:00.000Z"), { outcome: "passed", recordedAt: "2026-10-21T00:00:00.000Z" })).toBe("official_passed");
    expect(taskDisplayStatus(null, { outcome: "retake_required", recordedAt: "2026-10-21T00:00:00.000Z" })).toBe("retake_required");
  });
  it("course status: awaiting_school only when every task is reported/official and no course result", () => {
    const t = (status: string) => ({ status }) as never;
    expect(courseDisplayStatus("planned", [t("pending_review"), t("pending_review")], null)).toBe("awaiting_school");
    expect(courseDisplayStatus("planned", [t("pending_review"), t("in_progress")], null)).toBe("in_progress");
    expect(courseDisplayStatus("planned", [], null)).toBe("not_started");
    expect(courseDisplayStatus("planned", [t("pending_review")], { outcome: "completed" })).toBe("official_complete");
    expect(courseDisplayStatus("planned", [t("not_started")], { outcome: "not_passed" })).toBe("not_passed");
    expect(courseDisplayStatus("replaced", [t("pending_review")], null)).toBe("replaced");
    expect(courseDisplayStatus("removed", [], null)).toBe("replaced");
    expect(courseDisplayStatus("replaced", [], { outcome: "completed" })).toBe("official_complete");
  });
});

describe("pace", () => {
  const content = (milestones: { month: string; cumulativeHalfUnits: number }[], weekly: number | null = null): HsRoadmapContent =>
    ({ ...contentFromTemplate(TEMPLATE_STANDARD_21, 42, "2027-06-30").content, pacing: { targetCompletionDate: "2027-06-30", weeklyTargetHalfUnits: weekly, milestones } });
  it("not_configured without milestones", () => {
    expect(computePace(null, 0, NOW)).toEqual({ weeklyTargetHalfUnits: null, expectedByNowHalfUnits: null, status: "not_configured", nextMilestone: null });
    expect(computePace(content([]), 5, NOW).status).toBe("not_configured");
  });
  it("compares earned to the latest milestone of a finished month", () => {
    const c = content([{ month: "2026-09", cumulativeHalfUnits: 4 }, { month: "2026-12", cumulativeHalfUnits: 10 }], 1);
    expect(computePace(c, 3, NOW)).toMatchObject({ status: "behind", expectedByNowHalfUnits: 4, weeklyTargetHalfUnits: 1, nextMilestone: { month: "2026-12", cumulativeHalfUnits: 10 } });
    expect(computePace(c, 4, NOW).status).toBe("on_track");
    expect(computePace(c, 5, NOW).status).toBe("ahead");
    // before the first milestone month ends nothing is expected yet
    expect(computePace(c, 0, "2026-08-10T00:00:00.000Z")).toMatchObject({ status: "on_track", expectedByNowHalfUnits: 0, nextMilestone: { month: "2026-09" } });
    // the current month's milestone is the NEXT one, not yet due
    expect(computePace(c, 4, "2026-12-05T00:00:00.000Z").nextMilestone).toEqual({ month: "2026-12", cumulativeHalfUnits: 10 });
  });
});

describe("policies are off unless configured", () => {
  it("absent roadmap or null fields mean no enforcement", () => {
    expect(effectivePolicies(null)).toEqual({ maxExamAttempts: null, minDaysBetweenExams: null, maxTransferHalfUnits: null, passingPercent: null });
    expect(TEMPLATE_STANDARD_21.policies).toEqual(effectivePolicies(undefined));
    expect(TEMPLATE_TN_22.policies.maxExamAttempts).toBeNull();
  });
});

describe("roadmap content validation", () => {
  const base = () => contentFromTemplate(TEMPLATE_STANDARD_21, 42, null).content;
  it("the template-derived draft is valid and passes the strict zod schema", () => {
    expect(hsRoadmapContentSchema.safeParse(base()).success).toBe(true);
    expect(validateRoadmapContent(base(), TEMPLATE_STANDARD_21, { expectedTotalHalfUnits: 42 })).toEqual([]);
  });
  it("reports total/area mismatch, unknown area, duplicates, bad replaces, dates and pacing", () => {
    const c = base();
    c.areas = c.areas.map((a) => (a.key === "math" ? { ...a, requiredHalfUnits: 8 } : a));
    c.courses = [
      ...c.courses,
      { ...c.courses[0] },
      { ...c.courses[1], key: "ghost-area", areaKey: "ghost" },
      { ...c.courses[2], key: "bad-replace", replacesCourseKey: "missing" },
      { ...c.courses[3], key: "bad-dates", plannedStart: "2026-12-01", plannedEnd: "2026-11-01", tasks: [{ key: "t", kind: "lesson", title: "a", dueDate: null }, { key: "t", kind: "exam", title: "b", dueDate: null }] },
    ];
    c.pacing.milestones = [{ month: "2026-11", cumulativeHalfUnits: 10 }, { month: "2026-12", cumulativeHalfUnits: 4 }, { month: "2026-12", cumulativeHalfUnits: 4 }];
    const errors = validateRoadmapContent(c, TEMPLATE_STANDARD_21, { expectedTotalHalfUnits: 44 }).join(" | ");
    for (const re of [/must equal the total/, /must match the enrollment/, /Duplicate course key/, /unknown area ghost/, /replaces unknown course missing/, /ends before it starts/, /Duplicate task key t/, /must not decrease/, /Duplicate pacing milestone/]) {
      expect(errors).toMatch(re);
    }
  });
  it("areas must follow the template keys and kinds; protected keys cannot be deleted", () => {
    const c = base();
    c.areas = c.areas.filter((a) => a.key !== "health_pe").map((a) => (a.key === "electives" ? { ...a, kind: "core" as const } : a));
    const errors = validateRoadmapContent(c, TEMPLATE_STANDARD_21, {}).join(" | ");
    expect(errors).toMatch(/health_pe from the template is missing/);
    expect(errors).toMatch(/electives must stay elective/);
    const d = base();
    d.courses = d.courses.filter((x) => x.key !== "english-1");
    expect(validateRoadmapContent(d, TEMPLATE_STANDARD_21, { protectedCourseKeys: new Set(["english-1"]) }).join(" ")).toMatch(/english-1 has recorded/);
    const e = base();
    e.courses = e.courses.map((x) => (x.key === "english-1" ? { ...x, status: "replaced" as const } : x));
    expect(validateRoadmapContent(e, TEMPLATE_STANDARD_21, { protectedCourseKeys: new Set(["english-1"]) })).toEqual([]);
  });
  it("template request schema is strict and validateTemplate catches inconsistent totals", () => {
    expect(hsCurriculumTemplateSchema.safeParse({ ...TEMPLATE_TN_22, templateKey: "BAD KEY" }).success).toBe(false);
    expect(hsCurriculumTemplateSchema.safeParse({ ...TEMPLATE_STANDARD_21 }).success).toBe(true);
    expect(hsCurriculumTemplateSchema.safeParse({ ...TEMPLATE_STANDARD_21, extra: 1 }).success).toBe(false);
    expect(validateTemplate({ ...TEMPLATE_STANDARD_21, totalRequiredHalfUnits: 40 }).join(" ")).toMatch(/must equal total/);
  });
});

describe("guardian standing from S09 authority", () => {
  const c = (type: string, authority: string | null, scopes: string[]) => ({ id: `c-${type}-${authority}`, type, full_name: "Mira Fischer", relationship: "Mother", scopes, authority_status: authority });
  it("parent+listed => listed_parent; guardian/pending => guardian_unverified; verified; revoked", () => {
    expect(toGuardianView(c("parent", "listed", ["emergency"]))).toMatchObject({ standing: "listed_parent", mayDiscussAcademics: false, hasPortalAccess: false });
    expect(toGuardianView(c("parent", "pending_verification", ["academic"]))).toMatchObject({ standing: "guardian_unverified", mayDiscussAcademics: false });
    expect(toGuardianView(c("guardian", "listed", []))?.standing).toBe("guardian_unverified");
    expect(toGuardianView(c("representative", "pending_verification", ["financial"]))?.standing).toBe("guardian_unverified");
    expect(toGuardianView(c("guardian", "verified", ["academic"]))).toMatchObject({ standing: "verified_guardian", mayDiscussAcademics: true, mayDiscussFinances: false });
    expect(toGuardianView(c("representative", "verified", ["financial", "academic"]))).toMatchObject({ mayDiscussAcademics: true, mayDiscussFinances: true });
    expect(toGuardianView(c("guardian", "verified", ["emergency"]))).toMatchObject({ mayDiscussAcademics: false, mayDiscussFinances: false });
    expect(toGuardianView(c("guardian", "revoked", ["academic"]))).toMatchObject({ standing: "revoked", mayDiscussAcademics: false });
    expect(toGuardianView(c("emergency", "listed", ["emergency"]))).toBeNull();
    expect(toGuardianView(c("spouse", "listed", []))).toBeNull();
  });
});

describe("student projection", () => {
  const roadmap = (): HsRoadmapContent => {
    const c = contentFromTemplate(TEMPLATE_STANDARD_21, 42, "2027-06-30").content;
    c.courses = c.courses.map((x) =>
      x.key === "english-1"
        ? { ...x, tasks: [{ key: "t1", kind: "lesson" as const, title: "Lesson", dueDate: "2026-10-01" }, { key: "ex", kind: "exam" as const, title: "Exam", dueDate: null }, { key: "pr", kind: "project" as const, title: "Project", dueDate: null }] }
        : x,
    );
    return c;
  };
  const input = (over: Partial<HsProjectionInput> = {}): HsProjectionInput => ({
    enrollment: { id: "e1", status: "active", programTitle: TEMPLATE_STANDARD_21.title, startedOn: "2026-09-01", targetCompletionDate: "2027-06-30", institutionDisclosed: false, awardingSchoolName: "Hidden Valley Online School", totalRequiredHalfUnits: 42 },
    fallbackAreas: TEMPLATE_STANDARD_21.areas,
    roadmap: { versionNumber: 1, publishedAt: NOW, content: roadmap() },
    progress: [],
    taskResults: [],
    courseResults: [],
    awards: [],
    priorEducation: [],
    graduation: null,
    guardians: [],
    nowIso: NOW,
    ...over,
  });

  it("without a roadmap: template areas, no courses, no pace", () => {
    const v = projectStudentView(input({ roadmap: null }));
    expect(v.roadmap).toBeNull();
    expect(v.subjects.map((s) => s.subject)).toEqual(["humanities_digital", "english", "mathematics", "science", "social_studies", "health_pe", "electives"]);
    expect(v.credits.requiredHalfUnits).toBe(42);
    expect(v.pace.status).toBe("not_configured");
    expect(v.current).toEqual({ course: null, nextTask: null });
  });

  it("a course waiting on the school never hides work the student can start elsewhere", () => {
    const content = roadmap();
    content.courses = content.courses.map((x) =>
      x.key === "english-2" ? { ...x, tasks: [{ key: "l1", kind: "lesson" as const, title: "Unit 1", dueDate: null }] } : x,
    );
    const submitted = (taskKey: string) => ({ courseKey: "english-1", taskKey, status: "submitted" as const, reportedScorePercent: null, note: null, revision: 1, updatedAt: "2026-10-20T00:00:00.000Z" });
    const v = projectStudentView(input({ roadmap: { versionNumber: 1, publishedAt: NOW, content }, progress: ["t1", "ex", "pr"].map(submitted) }));
    expect(v.current.course?.key).toBe("english-1");
    expect(v.current.course?.status).toBe("awaiting_school");
    expect(v.current.nextTask).toMatchObject({ courseKey: "english-2", key: "l1" });
  });

  it("overdue, current course, next task, awaiting grade and attention items", () => {
    const v = projectStudentView(
      input({
        progress: [
          { courseKey: "english-1", taskKey: "ex", status: "submitted", reportedScorePercent: 77, note: null, revision: 1, updatedAt: "2026-10-20T00:00:00.000Z" },
          { courseKey: "english-1", taskKey: "t1", status: "in_progress", reportedScorePercent: null, note: null, revision: 2, updatedAt: "2026-10-20T00:00:00.000Z" },
        ],
        taskResults: [{ courseKey: "english-1", taskKey: "pr", outcome: "retake_required", scorePercent: 50, recordedAt: "2026-10-21T00:00:00.000Z" }],
        courseResults: [{ courseKey: "english-2", outcome: "not_passed", recordedAt: NOW }],
        priorEducation: [{ id: "p1", schoolName: "Synthetic Prep", status: "documents_requested", claims: [] }],
      }),
    );
    expect(v.current.course?.key).toBe("english-1");
    expect(v.current.nextTask?.key).toBe("t1");
    expect(v.awaitingGrade.map((t) => t.key)).toEqual(["ex"]);
    expect(v.attention.map((a) => a.kind).sort()).toEqual(["documents_requested", "not_passed", "overdue_task", "retake_required"].sort());
    expect(v.graduation.outstandingExams).toBe(1);
    expect(v.graduation.outstandingProjects).toBe(1);
  });

  it("institution disclosure needs the flag, a name AND an active/completed enrollment", () => {
    const e = { institutionDisclosed: true, awardingSchoolName: "Hidden Valley Online School" };
    expect(schoolDisplayNameFor({ ...e, status: "planned" })).toEqual({ name: GENERIC_SCHOOL_DESCRIPTION, disclosed: false });
    expect(schoolDisplayNameFor({ ...e, status: "on_hold" }).disclosed).toBe(false);
    expect(schoolDisplayNameFor({ ...e, status: "withdrawn" }).disclosed).toBe(false);
    expect(schoolDisplayNameFor({ ...e, status: "active" })).toEqual({ name: "Hidden Valley Online School", disclosed: true });
    expect(schoolDisplayNameFor({ ...e, status: "completed" }).disclosed).toBe(true);
    expect(schoolDisplayNameFor({ institutionDisclosed: true, awardingSchoolName: null, status: "active" }).disclosed).toBe(false);
    expect(schoolDisplayNameFor({ institutionDisclosed: false, awardingSchoolName: "Hidden Valley Online School", status: "active" }).disclosed).toBe(false);
  });

  it("the view never exposes template notes, template keys, the school name or document ids", () => {
    const v = projectStudentView(input({ graduation: { status: "in_progress", eligibilityConfirmedAt: null, eligibilityEvidenceDocumentId: "doc-secret", conferredOn: null, diplomaEvidenceDocumentId: null, transcriptEvidenceDocumentId: null, transcriptStatus: "not_requested", diplomaDeliveryStatus: "not_requested", financialClearance: "unknown" } }));
    const json = JSON.stringify(v);
    for (const secret of ["Hidden Valley", "us-hs-diploma", "sourceNote", "public student catalog", "doc-secret", "schoolStudentRef"]) expect(json).not.toContain(secret);
    expect(v.enrollment.schoolDisplayName).toBe(GENERIC_SCHOOL_DESCRIPTION);
    expect(v.graduation.financialClearance).toBeNull();
  });

  it("review queue contains reported tasks without a newer official result, oldest first", () => {
    const queue = computeReviewQueue(
      roadmap(),
      [
        { courseKey: "english-1", taskKey: "ex", status: "submitted", reportedScorePercent: null, note: "done", revision: 1, updatedAt: "2026-10-22T00:00:00.000Z" },
        { courseKey: "english-1", taskKey: "pr", status: "submitted", reportedScorePercent: null, note: null, revision: 1, updatedAt: "2026-10-20T00:00:00.000Z" },
        { courseKey: "english-1", taskKey: "t1", status: "submitted", reportedScorePercent: null, note: null, revision: 1, updatedAt: "2026-10-19T00:00:00.000Z" },
      ],
      [{ courseKey: "english-1", taskKey: "t1", outcome: "passed", scorePercent: 90, recordedAt: "2026-10-23T00:00:00.000Z" }],
    );
    expect(queue.map((q) => q.taskKey)).toEqual(["pr", "ex"]);
    expect(queue[1]).toMatchObject({ note: "done", kind: "exam", reportedStatus: "submitted" });
    expect(computeReviewQueue(null, [], [])).toEqual([]);
  });
});
