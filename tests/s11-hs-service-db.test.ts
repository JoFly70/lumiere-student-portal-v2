/**
 * S11 — High School Pathway service against a REAL disposable PostgreSQL 16.
 * Real: migration chain (incl. 20261029100000 / 20261029110000), repository,
 * service, Express routers with real requireAuth (smoke section at the end).
 * Mocked (external services only): the Supabase account-status lookup and client.
 * Synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  PG_BINARIES_AVAILABLE,
  S05_PG_SKIP_MESSAGE,
  type LocalPg,
} from "./helpers/s05-local-pg";
import {
  authHeader,
  bootHighSchoolApp,
  seedContact,
  seedStaff,
  seedStudent,
  seedUniversityProgram,
  seedVerifiedDocument,
  snapshotUniversity,
  startHighSchoolPg,
  type HighSchoolApp,
  type SeededHsStaff,
  type SeededHsStudent,
} from "./helpers/s11-hs-stack";
import {
  createEnrollmentSchema,
  graduationActionSchema,
  recordCourseResultSchema,
  recordPriorEducationSchema,
  recordTaskResultSchema,
  recordTransferAwardSchema,
  resolveTransferClaimSchema,
  transferClaimSchema,
  updateEnrollmentSchema,
  historicalGraduateSchema,
  GENERIC_SCHOOL_DESCRIPTION,
  formatHalfUnits,
  type HsRoadmapContent,
} from "../shared/high-school-contract";

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const STD = { templateKey: "us-hs-diploma-21", templateVersion: 1 };
const TN = { templateKey: "us-hs-diploma-tn-22", templateVersion: 1 };

describe.skipIf(!PG_BINARIES_AVAILABLE)("S11 high school pathway — service on real Postgres", () => {
  let pg: LocalPg;
  let hs: HighSchoolApp;
  let staff: SeededHsStaff;
  let admin: SeededHsStaff;
  let coach: SeededHsStaff;

  const svc = () => hs.service;

  beforeAll(async () => {
    pg = await startHighSchoolPg();
    hs = await bootHighSchoolApp(pg);
    staff = await seedStaff(pg, "staff");
    admin = await seedStaff(pg, "admin");
    coach = await seedStaff(pg, "coach");
  }, 300_000);

  afterAll(async () => {
    await hs?.close();
    await pg?.stop();
  }, 60_000);

  it("both S11 migrations are idempotent on re-run and add every audit event", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(import.meta.dirname, "..", "supabase", "migrations");
    const [a, b] = ["20261029100000_s11_high_school_pathway.sql", "20261029110000_s11_high_school_audit_event_types.sql"].map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
    const fp = async () => JSON.stringify(await pg.sql(`select table_name, column_name, data_type from information_schema.columns where table_name like 'hs\\_%' order by 1, 2`));
    const before = await fp();
    await pg.sql(a);
    await pg.sql(b);
    expect(await fp()).toBe(before);
    expect(before).toContain("hs_credit_awards");
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  interface Scenario {
    st: SeededHsStudent;
    eid: string;
    doc: string;
  }

  async function enroll(
    name: string,
    over: Partial<{ templateKey: string; templateVersion: number; status: "planned" | "active"; totalRequiredHalfUnitsOverride: number | null; overrideReason: string | null; targetCompletionDate: string | null }> = {},
  ): Promise<Scenario> {
    const st = await seedStudent(pg, { name });
    const doc = await seedVerifiedDocument(pg, st.studentId, "hs_transcript");
    const out = await svc().createEnrollment(st.studentId, staff.userId, createEnrollmentSchema.parse({ ...STD, status: "active", ...over }));
    return { st, eid: out.result.current!.enrollment.id, doc };
  }

  /** Draft from template (or published), apply `mutate`, save, publish as admin. */
  async function publishPlan(s: Scenario, mutate: (c: HsRoadmapContent) => HsRoadmapContent) {
    let state = (await svc().draftFromTemplate(s.st.studentId, s.eid, staff.userId, undefined)).result;
    const draft = state.current!.draft!;
    const content = mutate(structuredClone(draft.content) as HsRoadmapContent);
    state = (await svc().saveDraft(s.st.studentId, s.eid, staff.userId, { expectedDraftRevision: draft.draftRevision, content })).result;
    return svc().publish(s.st.studentId, s.eid, admin.userId, {
      expectedDraftRevision: state.current!.draft!.draftRevision,
      expectedPublishedVersionId: state.current!.published?.versionId ?? null,
    });
  }

  const ELECTIVES = ["e1", "e2", "e3", "e4", "e5"];
  const withElectives = (c: HsRoadmapContent): HsRoadmapContent => ({
    ...c,
    courses: [
      ...c.courses,
      ...ELECTIVES.map((k) => ({
        key: k,
        title: `Elective ${k}`,
        areaKey: "electives",
        halfUnits: 2,
        status: "planned" as const,
        replacesCourseKey: null,
        plannedStart: null,
        plannedEnd: null,
        tasks: [],
      })),
    ],
  });
  const withTasks = (c: HsRoadmapContent): HsRoadmapContent => ({
    ...c,
    courses: c.courses.map((course) =>
      course.key === "english-1"
        ? {
            ...course,
            tasks: [
              { key: "lesson-1", kind: "lesson" as const, title: "Lesson 1", dueDate: "2026-10-01" },
              { key: "exam-1", kind: "exam" as const, title: "Unit exam", dueDate: null },
              { key: "essay-1", kind: "project" as const, title: "Written project", dueDate: null },
            ],
          }
        : course,
    ),
  });
  const withPolicies = (p: Partial<HsRoadmapContent["policies"]>) => (c: HsRoadmapContent): HsRoadmapContent => ({
    ...c,
    policies: { ...c.policies, ...p },
  });
  const compose = (...fns: ((c: HsRoadmapContent) => HsRoadmapContent)[]) => (c: HsRoadmapContent) => fns.reduce((acc, f) => f(acc), c);

  const completeCourse = (s: Scenario, courseKey: string) =>
    svc().recordCourseResult(s.st.studentId, s.eid, staff.userId, recordCourseResultSchema.parse({ courseKey, outcome: "completed", evidenceDocumentId: s.doc }));
  const taskResult = (s: Scenario, taskKey: string, outcome: "passed" | "failed" | "retake_required", extra: Record<string, unknown> = {}) =>
    svc().recordTaskResult(
      s.st.studentId,
      s.eid,
      staff.userId,
      recordTaskResultSchema.parse({ courseKey: "english-1", taskKey, outcome, scorePercent: null, evidenceDocumentId: s.doc, ...extra }),
    );
  const report = (s: Scenario, taskKey: string, status: "in_progress" | "submitted" | "not_started", expectedRevision: number, extra: Record<string, unknown> = {}) =>
    svc().reportProgress(s.st.studentId, s.st.userId, { courseKey: "english-1", taskKey, status, expectedRevision, ...extra } as never);
  const state = (s: Scenario) => svc().getStaffState(s.st.studentId);
  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      const err = e as { code?: string; status?: number; details?: Record<string, unknown> };
      return { code: err.code, status: err.status, details: err.details };
    }
  };

  /** Completes every core template course plus the 5 electives except `skip`. */
  async function completeAll(s: Scenario, skip: string[] = []) {
    const st = await state(s);
    for (const c of st.current!.published!.content.courses) {
      if (skip.includes(c.key)) continue;
      await completeCourse(s, c.key);
    }
  }

  // ── Rule 1: half-unit credits ──────────────────────────────────────────────

  describe("R1 credits in half-units", () => {
    it("16 core + 5 elective = 21 credits; 41 half-units displays 20.5; the cap is never a hard 21", async () => {
      const s = await enroll("Noa Fischer");
      await publishPlan(s, withElectives);
      await completeAll(s, ["startup-learning-tech"]);
      const credits = (await state(s)).current!.credits;
      expect(credits.requiredHalfUnits).toBe(42);
      expect(credits.earnedHalfUnits).toBe(41);
      expect(formatHalfUnits(credits.earnedHalfUnits)).toBe("20.5");
      expect(credits.core).toEqual({ requiredHalfUnits: 32, earnedHalfUnits: 31 });
      expect(credits.elective).toEqual({ requiredHalfUnits: 10, earnedHalfUnits: 10 });
      expect(credits.remainingHalfUnits).toBe(1);
      expect(credits.percentComplete).toBe(97);
      await completeCourse(s, "startup-learning-tech");
      const done = (await state(s)).current!.credits;
      expect(done.earnedHalfUnits).toBe(42);
      expect(done.remainingHalfUnits).toBe(0);
      expect(done.percentComplete).toBe(100);
    });

    it("per-area counted is min(earned, required); surplus in one area never fills another", async () => {
      const s = await enroll("Lior Katz");
      // an extra English course (5th english credit) beyond the 4 required
      await publishPlan(s, (c) => ({
        ...c,
        courses: [...c.courses, { key: "english-5", title: "English 5", areaKey: "english", halfUnits: 2, status: "planned", replacesCourseKey: null, plannedStart: null, plannedEnd: null, tasks: [] }],
      }));
      for (const k of ["english-1", "english-2", "english-3", "english-4", "english-5"]) await completeCourse(s, k);
      const credits = (await state(s)).current!.credits;
      const english = credits.byArea.find((a) => a.key === "english")!;
      expect(english).toMatchObject({ requiredHalfUnits: 8, earnedHalfUnits: 10, countedHalfUnits: 8 });
      expect(credits.core.earnedHalfUnits).toBe(8);
      expect(credits.byArea.find((a) => a.key === "math")!.countedHalfUnits).toBe(0);
    });

    it("the 22-credit Tennessee template and a staff override both work (total is configurable)", async () => {
      const tn = await enroll("Eli Barak", TN);
      const tnState = await state(tn);
      expect(tnState.current!.enrollment.totalRequiredHalfUnits).toBe(44);
      expect(tnState.current!.enrollment.jurisdiction).toBe("US-TN");
      const tnDraft = (await svc().draftFromTemplate(tn.st.studentId, tn.eid, staff.userId, undefined)).result.current!.draft!;
      expect(tnDraft.validationErrors).toEqual([]);
      expect(tnDraft.content.areas.find((a) => a.key === "math")!.requiredHalfUnits).toBe(8);

      const ov = await enroll("Dana Levi", { totalRequiredHalfUnitsOverride: 44, overrideReason: "State exception approved by the school" });
      const ovState = await state(ov);
      expect(ovState.current!.enrollment.totalRequiredHalfUnits).toBe(44);
      expect(ovState.current!.enrollment.requiredOverrideReason).toMatch(/State exception/);
      const ovDraft = (await svc().draftFromTemplate(ov.st.studentId, ov.eid, staff.userId, undefined)).result.current!.draft!;
      expect(ovDraft.content.totalRequiredHalfUnits).toBe(44);
      expect(ovDraft.content.areas.find((a) => a.key === "electives")!.requiredHalfUnits).toBe(12);
      expect(ovDraft.validationErrors).toEqual([]);
    });

    it("an override needs a reason (422) and an unreachable total is refused", async () => {
      const st = await seedStudent(pg, { name: "Tal Amir" });
      const noReason = await codeOf(svc().createEnrollment(st.studentId, staff.userId, createEnrollmentSchema.parse({ ...STD, totalRequiredHalfUnitsOverride: 44 })));
      expect(noReason).toMatchObject({ code: "HS_VALIDATION_FAILED", status: 422 });
      const tooLow = await codeOf(
        svc().createEnrollment(st.studentId, staff.userId, createEnrollmentSchema.parse({ ...STD, totalRequiredHalfUnitsOverride: 20, overrideReason: "below the core requirement" })),
      );
      expect(tooLow).toMatchObject({ code: "HS_TEMPLATE_INVALID", status: 422 });
    });
  });

  // ── Rule 2: prior education and claims never add credit ────────────────────

  describe("R2 prior education and transfer claims", () => {
    it("prior education and even an accepted claim add no credit until an evidence-backed award", async () => {
      const s = await enroll("Yael Peretz");
      await publishPlan(s, withElectives);
      const prior = (await svc().recordPriorEducation(s.st.studentId, s.eid, staff.userId, recordPriorEducationSchema.parse({ schoolName: "Synthetic Prep", country: "Canada", evidenceDocumentId: s.doc }))).result;
      const priorId = prior.current!.priorEducation[0].id;
      expect(prior.current!.credits.earnedHalfUnits).toBe(0);
      const claimState = (await svc().createTransferClaim(s.st.studentId, s.eid, staff.userId, transferClaimSchema.parse({ priorEducationId: priorId, courseTitle: "Algebra", areaKey: "math", claimedHalfUnits: 2 }))).result;
      const claimId = claimState.current!.priorEducation[0].claims[0].id;
      expect(claimState.current!.credits.earnedHalfUnits).toBe(0);

      // not accepted -> 409
      expect(await codeOf(svc().recordTransferAward(s.st.studentId, s.eid, staff.userId, recordTransferAwardSchema.parse({ claimId, areaKey: "math", halfUnits: 2, evidenceDocumentId: s.doc })))).toMatchObject({ code: "HS_CLAIM_NOT_ACCEPTED", status: 409 });

      const accepted = (await svc().resolveTransferClaim(s.st.studentId, s.eid, claimId, staff.userId, resolveTransferClaimSchema.parse({ status: "accepted", note: "School evaluation received" }))).result;
      expect(accepted.current!.credits.earnedHalfUnits).toBe(0); // accepted still awards nothing
      expect(accepted.current!.studentPreview!.credits.earnedHalfUnits).toBe(0);

      const awarded = (await svc().recordTransferAward(s.st.studentId, s.eid, staff.userId, recordTransferAwardSchema.parse({ claimId, areaKey: "math", halfUnits: 2, evidenceDocumentId: s.doc }))).result;
      expect(awarded.current!.credits.earnedHalfUnits).toBe(2);
      expect(awarded.current!.awards[0]).toMatchObject({ source: "transfer", claimId, halfUnits: 2, status: "active" });
      // cannot award more than claimed
      expect(await codeOf(svc().recordTransferAward(s.st.studentId, s.eid, staff.userId, recordTransferAwardSchema.parse({ claimId, areaKey: "math", halfUnits: 1, evidenceDocumentId: s.doc })))).toMatchObject({ status: 422 });
    });

    it("maxTransferHalfUnits is enforced only when configured", async () => {
      const unconfigured = await enroll("Ben Sasson");
      await publishPlan(unconfigured, (c) => c);
      const configured = await enroll("Gal Mor");
      await publishPlan(configured, withPolicies({ maxTransferHalfUnits: 3 }));
      const claimOf = async (s: Scenario, half: number) => {
        const p = (await svc().recordPriorEducation(s.st.studentId, s.eid, staff.userId, recordPriorEducationSchema.parse({ schoolName: "Synthetic Prep", country: "Canada" }))).result;
        const priorId = p.current!.priorEducation.at(-1)!.id;
        const c = (await svc().createTransferClaim(s.st.studentId, s.eid, staff.userId, transferClaimSchema.parse({ priorEducationId: priorId, courseTitle: "Biology", areaKey: "science", claimedHalfUnits: half }))).result;
        const claimId = c.current!.priorEducation.at(-1)!.claims.at(-1)!.id;
        await svc().resolveTransferClaim(s.st.studentId, s.eid, claimId, staff.userId, resolveTransferClaimSchema.parse({ status: "accepted", note: "accepted by the school" }));
        return claimId;
      };
      const big = await claimOf(unconfigured, 20);
      const ok = await svc().recordTransferAward(unconfigured.st.studentId, unconfigured.eid, staff.userId, recordTransferAwardSchema.parse({ claimId: big, areaKey: "science", halfUnits: 20, evidenceDocumentId: unconfigured.doc }));
      expect(ok.result.current!.credits.earnedHalfUnits).toBe(20);
      const c2 = await claimOf(configured, 4);
      expect(await codeOf(svc().recordTransferAward(configured.st.studentId, configured.eid, staff.userId, recordTransferAwardSchema.parse({ claimId: c2, areaKey: "science", halfUnits: 4, evidenceDocumentId: configured.doc })))).toMatchObject({ code: "HS_POLICY_VIOLATION", status: 409 });
    });
  });

  // ── Rule 3: student progress never becomes official ────────────────────────

  describe("R3 reported vs official", () => {
    it("submitted / a reported score is pending_review, queued for staff, never credit; course awaits the school", async () => {
      const s = await enroll("Maya Stern");
      await publishPlan(s, compose(withElectives, withTasks));

      let v = await svc().getStudentView(s.st.studentId);
      expect(v.awaitingGrade).toEqual([]);
      const r1 = await report(s, "lesson-1", "in_progress", 0);
      expect(r1.result.subjects.flatMap((x) => x.courses).find((c) => c.key === "english-1")!.status).toBe("in_progress");

      // a reported score alone => pending_review
      await report(s, "exam-1", "in_progress", 0, { reportedScorePercent: 91 });
      v = await svc().getStudentView(s.st.studentId);
      expect(v.awaitingGrade.map((t) => t.key)).toEqual(["exam-1"]);
      expect(v.awaitingGrade[0]).toMatchObject({ status: "pending_review", reportedScorePercent: 91, officialScorePercent: null });

      await report(s, "lesson-1", "submitted", 1);
      await report(s, "essay-1", "submitted", 0);
      v = await svc().getStudentView(s.st.studentId);
      const course = v.subjects.flatMap((x) => x.courses).find((c) => c.key === "english-1")!;
      expect(course.status).toBe("awaiting_school");
      expect(v.awaitingGrade.map((t) => t.key).sort()).toEqual(["essay-1", "exam-1", "lesson-1"]);
      expect(v.writtenProjects.map((t) => t.key)).toEqual(["essay-1"]);
      expect(v.credits.earnedHalfUnits).toBe(0);
      expect(v.credits.awaitingConfirmationHalfUnits).toBe(2);
      expect(v.graduation.creditsSatisfied).toBe(false);

      const st = await state(s);
      expect(st.current!.reviewQueue.map((q) => q.taskKey).sort()).toEqual(["essay-1", "exam-1", "lesson-1"]);
      expect(st.current!.credits.earnedHalfUnits).toBe(0);

      // staff record the official result: queue shrinks, the task becomes official, still no course credit
      const after = (await taskResult(s, "exam-1", "passed", { scorePercent: 88 })).result;
      expect(after.current!.reviewQueue.map((q) => q.taskKey)).not.toContain("exam-1");
      const task = after.current!.studentPreview!.subjects.flatMap((x) => x.courses).find((c) => c.key === "english-1")!.tasks.find((t) => t.key === "exam-1")!;
      expect(task).toMatchObject({ status: "official_passed", officialScorePercent: 88 });
      expect(after.current!.credits.earnedHalfUnits).toBe(0);
    });

    it("the student cannot report against an unknown or replaced course/task (422), nor with a stale revision (409)", async () => {
      const s = await enroll("Roni Ben-David");
      await publishPlan(s, withTasks);
      expect(await codeOf(svc().reportProgress(s.st.studentId, s.st.userId, { courseKey: "nope", taskKey: "x", status: "submitted", expectedRevision: 0 }))).toMatchObject({ code: "HS_UNKNOWN_COURSE_OR_TASK", status: 422 });
      expect(await codeOf(report(s, "no-such-task", "submitted", 0))).toMatchObject({ code: "HS_UNKNOWN_COURSE_OR_TASK", status: 422 });
      await report(s, "lesson-1", "in_progress", 0);
      expect(await codeOf(report(s, "lesson-1", "submitted", 0))).toMatchObject({ code: "HS_REVISION_CONFLICT", status: 409, details: { currentRevision: 1 } });
    });

    it("reporting before a roadmap is published is refused (409 HS_NO_PUBLISHED_ROADMAP)", async () => {
      const s = await enroll("Omer Haim");
      expect(await codeOf(report(s, "lesson-1", "submitted", 0))).toMatchObject({ code: "HS_NO_PUBLISHED_ROADMAP", status: 409 });
    });
  });

  // ── Rule 4: policies only when configured ──────────────────────────────────

  describe("R4 retake and pace policies", () => {
    it("null policies enforce nothing: five failed exam attempts are recorded", async () => {
      const s = await enroll("Shir Golan");
      await publishPlan(s, withTasks);
      for (let i = 0; i < 5; i += 1) await taskResult(s, "exam-1", "failed", { scorePercent: 40 });
      const results = (await state(s)).current!.results.filter((r) => r.taskKey === "exam-1");
      expect(results).toHaveLength(5);
    });

    it("maxExamAttempts=2 rejects a third failed attempt with 409 HS_POLICY_VIOLATION (a pass is still recorded)", async () => {
      const s = await enroll("Itai Rosen");
      await publishPlan(s, compose(withTasks, withPolicies({ maxExamAttempts: 2 })));
      await taskResult(s, "exam-1", "failed");
      await taskResult(s, "exam-1", "failed");
      expect(await codeOf(taskResult(s, "exam-1", "failed"))).toMatchObject({ code: "HS_POLICY_VIOLATION", status: 409, details: { policy: "maxExamAttempts", limit: 2 } });
      expect(await codeOf(taskResult(s, "exam-1", "retake_required"))).toMatchObject({ code: "HS_POLICY_VIOLATION" });
      const passed = (await taskResult(s, "exam-1", "passed", { scorePercent: 70 })).result;
      expect(passed.current!.results.filter((r) => r.taskKey === "exam-1")).toHaveLength(3);
      // non-exam tasks are not subject to the exam attempt limit
      for (let i = 0; i < 3; i += 1) await taskResult(s, "lesson-1", "failed");
    });

    it("minDaysBetweenExams applies only when configured and uses the injected clock", async () => {
      const s = await enroll("Noy Ariel");
      await publishPlan(s, compose(withTasks, withPolicies({ minDaysBetweenExams: 7 })));
      hs.clock.set("2026-10-26T12:00:00.000Z");
      await taskResult(s, "exam-1", "failed");
      hs.clock.set("2026-10-29T12:00:00.000Z");
      expect(await codeOf(taskResult(s, "exam-1", "failed"))).toMatchObject({ code: "HS_POLICY_VIOLATION", details: { policy: "minDaysBetweenExams", limit: 7 } });
      hs.clock.set("2026-11-03T12:00:00.000Z");
      await taskResult(s, "exam-1", "failed");
      hs.clock.set("2026-10-26T12:00:00.000Z");
    });
  });

  // ── Rule 5: publishing and immutability ────────────────────────────────────

  describe("R5 immutable versions, preserved progress", () => {
    it("publishing is immutable; a new draft starts from the published content; republishing keeps progress, results and events", async () => {
      const s = await enroll("Adi Navon");
      const first = (await publishPlan(s, compose(withElectives, withTasks))).result;
      const v1 = first.current!.published!;
      expect(v1.versionNumber).toBe(1);
      expect(v1.status).toBe("published");

      await report(s, "lesson-1", "submitted", 0, { reportedScorePercent: 80 });
      await taskResult(s, "exam-1", "passed", { scorePercent: 90 });
      await completeCourse(s, "english-2");
      const eventsBefore = await pg.sql(`select count(*)::int as n from hs_task_progress_events where enrollment_id = '${s.eid}'`);

      // direct tampering with a published version is refused by the database
      await expect(pg.sql(`update hs_roadmap_versions set content = '{}'::jsonb where id = '${v1.versionId}'`)).rejects.toThrow(/immutable/);

      // new draft starts from the published content
      const draft = (await svc().draftFromTemplate(s.st.studentId, s.eid, staff.userId, undefined)).result.current!.draft!;
      expect(draft.versionNumber).toBe(2);
      expect(draft.content).toEqual(v1.content);

      // reschedule english-1 and replace it with english-1b; english-1 is KEPT, marked replaced
      const content = structuredClone(draft.content) as HsRoadmapContent;
      content.courses = content.courses.map((c) => (c.key === "english-1" ? { ...c, status: "replaced" as const, plannedEnd: "2026-12-01" } : c));
      content.courses.push({
        key: "english-1b",
        title: "English 1 (new section)",
        areaKey: "english",
        halfUnits: 2,
        status: "planned",
        replacesCourseKey: "english-1",
        plannedStart: "2026-11-01",
        plannedEnd: "2027-01-31",
        tasks: [{ key: "lesson-1", kind: "lesson", title: "Lesson 1", dueDate: null }],
      });
      const saved = (await svc().saveDraft(s.st.studentId, s.eid, staff.userId, { expectedDraftRevision: draft.draftRevision, content })).result;
      const second = (await svc().publish(s.st.studentId, s.eid, admin.userId, { expectedDraftRevision: saved.current!.draft!.draftRevision, expectedPublishedVersionId: v1.versionId })).result;
      expect(second.current!.published!.versionNumber).toBe(2);
      expect(second.current!.versionHistory.map((v) => v.status)).toEqual(["published", "superseded"]);

      // progress rows/events, results and awards survive
      const prog = await pg.sql(`select course_key, task_key, status from hs_task_progress where enrollment_id = '${s.eid}'`);
      expect(prog).toHaveLength(1);
      const eventsAfter = await pg.sql(`select count(*)::int as n from hs_task_progress_events where enrollment_id = '${s.eid}'`);
      expect(eventsAfter[0].n).toBe(eventsBefore[0].n);
      expect(second.current!.results.map((r) => r.courseKey)).toEqual(expect.arrayContaining(["english-1", "english-2"]));
      expect(second.current!.awards.filter((a) => a.status === "active")).toHaveLength(1);

      // the old course key stays visible as "replaced"; the new one is separate
      const courses = second.current!.studentPreview!.subjects.flatMap((x) => x.courses);
      expect(courses.find((c) => c.key === "english-1")!.status).toBe("replaced");
      expect(courses.find((c) => c.key === "english-1b")!).toMatchObject({ status: "not_started", replacesCourseKey: "english-1" });
      // the student can no longer report against the replaced course
      expect(await codeOf(report(s, "lesson-1", "submitted", 1))).toMatchObject({ code: "HS_UNKNOWN_COURSE_OR_TASK" });
    });

    it("deleting a course or task that has activity is refused at publish (422 HS_ROADMAP_INVALID); the draft saves with errors", async () => {
      const s = await enroll("Hila Segal");
      await publishPlan(s, withTasks);
      await report(s, "lesson-1", "in_progress", 0);
      const draft = (await svc().draftFromTemplate(s.st.studentId, s.eid, staff.userId, undefined)).result.current!.draft!;
      const content = structuredClone(draft.content) as HsRoadmapContent;
      content.courses = content.courses.filter((c) => c.key !== "english-1");
      const saved = (await svc().saveDraft(s.st.studentId, s.eid, staff.userId, { expectedDraftRevision: draft.draftRevision, content })).result;
      expect(saved.current!.draft!.validationErrors.join(" ")).toMatch(/english-1/);
      const err = await codeOf(svc().publish(s.st.studentId, s.eid, admin.userId, { expectedDraftRevision: saved.current!.draft!.draftRevision, expectedPublishedVersionId: saved.current!.published!.versionId }));
      expect(err).toMatchObject({ code: "HS_ROADMAP_INVALID", status: 422 });
    });

    it("structural errors block publishing: area totals, unknown area, duplicate keys", async () => {
      const s = await enroll("Keren Dahan");
      const draft = (await svc().draftFromTemplate(s.st.studentId, s.eid, staff.userId, undefined)).result.current!.draft!;
      const content = structuredClone(draft.content) as HsRoadmapContent;
      content.areas = content.areas.map((a) => (a.key === "math" ? { ...a, requiredHalfUnits: 4 } : a));
      content.courses.push({ ...content.courses[0], areaKey: "ghost" });
      const saved = (await svc().saveDraft(s.st.studentId, s.eid, staff.userId, { expectedDraftRevision: draft.draftRevision, content })).result;
      const errors = saved.current!.draft!.validationErrors.join(" | ");
      expect(errors).toMatch(/must equal the total/);
      expect(errors).toMatch(/Duplicate course key/);
      expect(errors).toMatch(/unknown area ghost/);
      expect(await codeOf(svc().publish(s.st.studentId, s.eid, admin.userId, { expectedDraftRevision: saved.current!.draft!.draftRevision, expectedPublishedVersionId: null }))).toMatchObject({ code: "HS_ROADMAP_INVALID", status: 422 });
    });

    it("stale draft revision or published version id -> 409 HS_REVISION_CONFLICT", async () => {
      const s = await enroll("Lea Mizrahi");
      const draft = (await svc().draftFromTemplate(s.st.studentId, s.eid, staff.userId, undefined)).result.current!.draft!;
      expect(await codeOf(svc().saveDraft(s.st.studentId, s.eid, staff.userId, { expectedDraftRevision: 9, content: draft.content }))).toMatchObject({ code: "HS_REVISION_CONFLICT", status: 409 });
      expect(await codeOf(svc().publish(s.st.studentId, s.eid, admin.userId, { expectedDraftRevision: 0, expectedPublishedVersionId: "6f1c2b0e-0000-4000-8000-000000000000" }))).toMatchObject({ code: "HS_REVISION_CONFLICT" });
      // opening a draft twice is idempotent and never discards edits
      const again = (await svc().draftFromTemplate(s.st.studentId, s.eid, staff.userId, 0)).result.current!.draft!;
      expect(again.versionId).toBe(draft.versionId);
      expect(await codeOf(svc().draftFromTemplate(s.st.studentId, s.eid, staff.userId, 5))).toMatchObject({ code: "HS_REVISION_CONFLICT" });
    });
  });

  // ── Rule 6/7: graduation ───────────────────────────────────────────────────

  describe("R6/R7 graduation", () => {
    it("confirm_eligibility needs credits AND every core area; a SAMPLE document is rejected; confer needs eligibility + both documents; no university credit is created", async () => {
      const s = await enroll("Tamar Oren");
      const uni = await seedUniversityProgram(pg, s.st.studentId, staff.userId);
      const before = await snapshotUniversity(pg);
      await publishPlan(s, withElectives);
      const sample = await seedVerifiedDocument(pg, s.st.studentId, "hs_diploma", { status: "pending" });
      const diploma = await seedVerifiedDocument(pg, s.st.studentId, "hs_diploma");

      // nothing earned -> blockers
      let err = await codeOf(svc().graduationAction(s.st.studentId, s.eid, staff.userId, graduationActionSchema.parse({ action: "confirm_eligibility", evidenceDocumentId: s.doc })));
      expect(err).toMatchObject({ code: "HS_NOT_ELIGIBLE", status: 409 });
      expect((err!.details!.blockers as string[]).join(" ")).toMatch(/Earned 0 of 21/);

      // surplus electives reach 21 total while English is short: still blocked by the core area
      await completeAll(s, ["english-4", "startup-learning-tech"]);
      const extra = await seedVerifiedDocument(pg, s.st.studentId, "hs_transcript");
      for (const k of ["x1", "x2"]) {
        const cur = (await state(s)).current!;
        const draft = (await svc().draftFromTemplate(s.st.studentId, s.eid, staff.userId, undefined)).result.current!.draft!;
        const content = structuredClone(draft.content) as HsRoadmapContent;
        content.courses.push({ key: k, title: `Extra ${k}`, areaKey: "electives", halfUnits: k === "x1" ? 4 : 2, status: "planned", replacesCourseKey: null, plannedStart: null, plannedEnd: null, tasks: [] });
        const saved = (await svc().saveDraft(s.st.studentId, s.eid, staff.userId, { expectedDraftRevision: draft.draftRevision, content })).result;
        await svc().publish(s.st.studentId, s.eid, admin.userId, { expectedDraftRevision: saved.current!.draft!.draftRevision, expectedPublishedVersionId: cur.published!.versionId });
        await svc().recordCourseResult(s.st.studentId, s.eid, staff.userId, recordCourseResultSchema.parse({ courseKey: k, outcome: "completed", evidenceDocumentId: extra }));
      }
      const mid = (await state(s)).current!;
      expect(mid.credits.earnedHalfUnits).toBeGreaterThanOrEqual(mid.credits.requiredHalfUnits - 1);
      err = await codeOf(svc().graduationAction(s.st.studentId, s.eid, staff.userId, graduationActionSchema.parse({ action: "confirm_eligibility", evidenceDocumentId: s.doc })));
      expect(err).toMatchObject({ code: "HS_NOT_ELIGIBLE" });
      expect((err!.details!.blockers as string[]).join(" ")).toMatch(/Core area English/);

      await completeCourse(s, "english-4");
      await completeCourse(s, "startup-learning-tech");
      const ready = (await state(s)).current!;
      expect(ready.credits.earnedHalfUnits).toBeGreaterThanOrEqual(42);
      expect(ready.graduation.blockers).toEqual([]);

      // sample/unverified document -> 422
      expect(await codeOf(svc().graduationAction(s.st.studentId, s.eid, staff.userId, graduationActionSchema.parse({ action: "confirm_eligibility", evidenceDocumentId: sample })))).toMatchObject({ code: "HS_EVIDENCE_INVALID", status: 422 });
      // another student's verified document -> 422
      const other = await seedStudent(pg, { name: "Not Mine" });
      const foreign = await seedVerifiedDocument(pg, other.studentId, "hs_transcript");
      expect(await codeOf(svc().graduationAction(s.st.studentId, s.eid, staff.userId, graduationActionSchema.parse({ action: "confirm_eligibility", evidenceDocumentId: foreign })))).toMatchObject({ code: "HS_EVIDENCE_INVALID" });

      // cannot confer before eligibility
      expect(await codeOf(svc().graduationAction(s.st.studentId, s.eid, admin.userId, graduationActionSchema.parse({ action: "confer_diploma", conferredOn: "2026-10-20", diplomaEvidenceDocumentId: diploma, transcriptEvidenceDocumentId: s.doc })))).toMatchObject({ code: "HS_NOT_ELIGIBLE" });

      const confirmed = (await svc().graduationAction(s.st.studentId, s.eid, staff.userId, graduationActionSchema.parse({ action: "confirm_eligibility", evidenceDocumentId: s.doc }))).result;
      expect(confirmed.current!.graduation.status).toBe("eligibility_confirmed");
      expect(confirmed.current!.graduation.eligibilityEvidenceDocumentId).toBe(s.doc);

      // diploma and transcript must both be verified evidence
      expect(await codeOf(svc().graduationAction(s.st.studentId, s.eid, admin.userId, graduationActionSchema.parse({ action: "confer_diploma", conferredOn: "2026-10-20", diplomaEvidenceDocumentId: sample, transcriptEvidenceDocumentId: s.doc })))).toMatchObject({ code: "HS_EVIDENCE_INVALID" });
      expect(await codeOf(svc().graduationAction(s.st.studentId, s.eid, admin.userId, graduationActionSchema.parse({ action: "confer_diploma", conferredOn: "2026-10-20", diplomaEvidenceDocumentId: diploma, transcriptEvidenceDocumentId: sample })))).toMatchObject({ code: "HS_EVIDENCE_INVALID" });

      const conferred = (await svc().graduationAction(s.st.studentId, s.eid, admin.userId, graduationActionSchema.parse({ action: "confer_diploma", conferredOn: "2026-10-20", diplomaEvidenceDocumentId: diploma, transcriptEvidenceDocumentId: s.doc }))).result;
      expect(conferred.current!.enrollment.status).toBe("completed");
      expect(conferred.current!.graduation).toMatchObject({ status: "diploma_conferred", diploma: { conferredOn: "2026-10-20", documentId: diploma }, transcript: { documentId: s.doc } });
      const sv = await svc().getStudentView(s.st.studentId);
      expect(sv.graduation.status).toBe("diploma_conferred");
      expect(sv.enrollment.status).toBe("completed");

      // university tables untouched; no university credit created
      expect(await snapshotUniversity(pg)).toEqual(before);
      const [{ n }] = await pg.sql(`select count(*)::int as n from student_credit_records where student_id = '${s.st.studentId}'`);
      expect(n).toBe(1); // the seeded university record only
      expect(uni.assignmentId).toBeTruthy();

      // a completed enrollment is locked
      expect(await codeOf(completeCourse(s, "e1"))).toMatchObject({ code: "HS_OFFICIAL_RECORD_LOCKED", status: 409 });
    });

    it("voiding credit withdraws a confirmed eligibility", async () => {
      const s = await enroll("Sivan Tal");
      await publishPlan(s, withElectives);
      await completeAll(s);
      await svc().graduationAction(s.st.studentId, s.eid, staff.userId, graduationActionSchema.parse({ action: "confirm_eligibility", evidenceDocumentId: s.doc }));
      const awards = (await state(s)).current!.awards;
      const voided = (await svc().voidAward(s.st.studentId, s.eid, awards[0].id, admin.userId, "Issued in error by the school")).result;
      expect(voided.current!.graduation.status).toBe("in_progress");
      expect(awards[0].halfUnits).toBe(1); // startup course, 0.5 credit
      expect(voided.current!.credits.earnedHalfUnits).toBe(41);
      expect(voided.current!.awards.find((a) => a.id === awards[0].id)).toMatchObject({ status: "voided", voidReason: "Issued in error by the school" });
      // the course result was voided too, so it can be re-recorded
      await completeCourse(s, awards[0].courseKey!);
      expect((await state(s)).current!.credits.earnedHalfUnits).toBe(42);
      expect(await codeOf(svc().voidAward(s.st.studentId, s.eid, awards[0].id, admin.userId, "again, already voided"))).toMatchObject({ code: "HS_ALREADY_RECORDED" });
    });

    it("historical graduate: completed + is_historical from verified evidence only, no credit invented", async () => {
      const st = await seedStudent(pg, { name: "Uri Hadad" });
      const diploma = await seedVerifiedDocument(pg, st.studentId, "hs_diploma");
      const transcript = await seedVerifiedDocument(pg, st.studentId, "hs_transcript");
      const unverified = await seedVerifiedDocument(pg, st.studentId, "hs_diploma", { status: "rejected" });
      const before = await snapshotUniversity(pg);
      const bad = await codeOf(svc().historicalGraduate(st.studentId, admin.userId, historicalGraduateSchema.parse({ ...STD, conferredOn: "2019-06-15", awardingSchoolName: "Synthetic Academy", diplomaEvidenceDocumentId: unverified, transcriptEvidenceDocumentId: transcript, note: "imported record" })));
      expect(bad).toMatchObject({ code: "HS_EVIDENCE_INVALID", status: 422 });
      const out = (await svc().historicalGraduate(st.studentId, admin.userId, historicalGraduateSchema.parse({ ...STD, conferredOn: "2019-06-15", awardingSchoolName: "Synthetic Academy", diplomaEvidenceDocumentId: diploma, transcriptEvidenceDocumentId: transcript, note: "imported record" }))).result;
      expect(out.current!.enrollment).toMatchObject({ status: "completed", isHistorical: true });
      expect(out.current!.graduation).toMatchObject({ status: "diploma_conferred", diploma: { conferredOn: "2019-06-15" } });
      expect(out.current!.credits.earnedHalfUnits).toBe(0);
      expect(await snapshotUniversity(pg)).toEqual(before);
      expect(await codeOf(svc().historicalGraduate(st.studentId, admin.userId, historicalGraduateSchema.parse({ ...STD, conferredOn: "2019-06-15", awardingSchoolName: "Synthetic Academy", diplomaEvidenceDocumentId: diploma, transcriptEvidenceDocumentId: transcript, note: "imported again" })))).toMatchObject({ code: "HS_ALREADY_RECORDED" });
    });

    it("financial clearance is null for the student until staff set it; transcript request flows through", async () => {
      const s = await enroll("Dor Eliyahu");
      expect((await svc().getStudentView(s.st.studentId)).graduation.financialClearance).toBeNull();
      await svc().graduationAction(s.st.studentId, s.eid, staff.userId, graduationActionSchema.parse({ action: "set_financial_clearance", value: "cleared", note: "Account in good standing" }));
      expect((await svc().getStudentView(s.st.studentId)).graduation.financialClearance).toBe("cleared");
      const req = await svc().requestTranscript(s.st.studentId, s.st.userId, "Please send it");
      expect(req.result.graduation.transcript.status).toBe("requested");
      expect(await codeOf(svc().graduationAction(s.st.studentId, s.eid, staff.userId, graduationActionSchema.parse({ action: "set_transcript_status", value: "issued" })))).toMatchObject({ code: "HS_EVIDENCE_REQUIRED" });
    });
  });

  // ── Rule 9: disclosure ─────────────────────────────────────────────────────

  describe("R9 institutional disclosure and student-view hygiene", () => {
    it("shows the generic description until disclosed AND active/completed; never leaks internals", async () => {
      const s = await enroll("Rina Alon", { status: "planned" });
      await publishPlan(s, withTasks);
      const rev0 = (await state(s)).current!.enrollment.revision;
      const patch = (over: Record<string, unknown>, rev: number) =>
        svc().updateEnrollment(s.st.studentId, s.eid, staff.userId, updateEnrollmentSchema.parse({ expectedRevision: rev, note: "disclosure review", ...over }));

      await patch({ awardingSchoolName: "Hidden Valley Online School", schoolStudentRef: "SCH-99123" }, rev0);
      expect((await svc().getStudentView(s.st.studentId)).enrollment.schoolDisplayName).toBe(GENERIC_SCHOOL_DESCRIPTION);
      // disclosed flag but still planned -> generic
      await patch({ institutionDisclosed: true }, rev0 + 1);
      expect((await svc().getStudentView(s.st.studentId)).enrollment).toMatchObject({ schoolDisplayName: GENERIC_SCHOOL_DESCRIPTION, institutionDisclosed: false });
      // active + disclosed -> name
      await patch({ status: "active" }, rev0 + 2);
      const shown = await svc().getStudentView(s.st.studentId);
      expect(shown.enrollment).toMatchObject({ schoolDisplayName: "Hidden Valley Online School", institutionDisclosed: true });
      // staff withdraws disclosure -> generic again
      await patch({ institutionDisclosed: false }, rev0 + 3);
      const hidden = await svc().getStudentView(s.st.studentId);
      expect(hidden.enrollment.schoolDisplayName).toBe(GENERIC_SCHOOL_DESCRIPTION);

      await svc().addGuardianNote(s.st.studentId, s.eid, staff.userId, { contactId: await seedContact(pg, s.st.studentId, { type: "parent" }), note: "Call after 5pm about pacing" });
      const json = JSON.stringify(hidden) + JSON.stringify(await svc().getStudentView(s.st.studentId));
      for (const secret of ["Hidden Valley", "SCH-99123", "us-hs-diploma-21", "sourceNote", "schoolStudentRef", "Call after 5pm", "public catalog"]) {
        expect(json).not.toContain(secret);
      }
      expect(json).not.toContain(s.doc);
    });
  });

  // ── Rule 10: pace ──────────────────────────────────────────────────────────

  describe("R10 pace", () => {
    it("on_track / behind / ahead / not_configured from milestones vs the injected today", async () => {
      const s = await enroll("Gili Ron", { targetCompletionDate: "2027-06-30" });
      await publishPlan(s, (c) => ({ ...c, pacing: { ...c.pacing, weeklyTargetHalfUnits: 1, milestones: [] } }));
      expect((await svc().getStudentView(s.st.studentId)).pace.status).toBe("not_configured");
      expect((await svc().getStudentView(s.st.studentId)).enrollment.targetCompletionDate).toBe("2027-06-30");

      await publishPlan(s, (c) => ({ ...c, pacing: { ...c.pacing, weeklyTargetHalfUnits: 1, milestones: [{ month: "2026-09", cumulativeHalfUnits: 4 }, { month: "2026-12", cumulativeHalfUnits: 10 }] } }));
      hs.clock.set("2026-10-26T12:00:00.000Z");
      let v = await svc().getStudentView(s.st.studentId);
      expect(v.pace).toMatchObject({ status: "behind", expectedByNowHalfUnits: 4, weeklyTargetHalfUnits: 1, nextMilestone: { month: "2026-12", cumulativeHalfUnits: 10 } });
      expect(v.attention.some((a) => a.kind === "behind_pace")).toBe(true);
      await completeCourse(s, "english-1");
      await completeCourse(s, "english-2");
      v = await svc().getStudentView(s.st.studentId);
      expect(v.pace.status).toBe("on_track");
      await completeCourse(s, "english-3");
      v = await svc().getStudentView(s.st.studentId);
      expect(v.pace.status).toBe("ahead");
      hs.clock.set("2026-10-26T12:00:00.000Z");
    });
  });

  // ── Rules 8/11: isolation, failure paths, history, audit ───────────────────

  describe("R8/R11 isolation, failures, history", () => {
    it("an enrollment id of another student is 404 for every staff mutation", async () => {
      const a = await enroll("Student A");
      const b = await enroll("Student B");
      await publishPlan(b, withTasks);
      const call = (p: Promise<unknown>) => codeOf(p);
      expect(await call(svc().updateEnrollment(a.st.studentId, b.eid, staff.userId, updateEnrollmentSchema.parse({ expectedRevision: 0, note: "cross student" })))).toMatchObject({ code: "HS_NO_ENROLLMENT", status: 404 });
      expect(await call(svc().draftFromTemplate(a.st.studentId, b.eid, staff.userId, undefined))).toMatchObject({ status: 404 });
      expect(await call(svc().recordCourseResult(a.st.studentId, b.eid, staff.userId, recordCourseResultSchema.parse({ courseKey: "english-1", outcome: "completed", evidenceDocumentId: a.doc })))).toMatchObject({ status: 404 });
      expect(await call(svc().recordTaskResult(a.st.studentId, "not-a-uuid", staff.userId, recordTaskResultSchema.parse({ courseKey: "english-1", taskKey: "lesson-1", outcome: "passed", scorePercent: null, evidenceDocumentId: a.doc })))).toMatchObject({ status: 404 });
      expect(await call(svc().getStaffState("no-such-student"))).toMatchObject({ code: "HS_STUDENT_NOT_FOUND", status: 404 });
      // student A sees nothing of B
      const view = await svc().getStudentView(a.st.studentId);
      expect(view.enrollment.id).toBe(a.eid);
      expect(JSON.stringify(view)).not.toContain(b.eid);
    });

    it("evidence of another student or an unknown id is 422; duplicate official course record is 409; unknown course/task is 422", async () => {
      const s = await enroll("Mati Zur");
      await publishPlan(s, withTasks);
      const stranger = await seedStudent(pg, { name: "Other Person" });
      const foreign = await seedVerifiedDocument(pg, stranger.studentId, "hs_transcript");
      expect(await codeOf(svc().recordCourseResult(s.st.studentId, s.eid, staff.userId, recordCourseResultSchema.parse({ courseKey: "english-1", outcome: "completed", evidenceDocumentId: foreign })))).toMatchObject({ code: "HS_EVIDENCE_INVALID", status: 422 });
      expect(await codeOf(svc().recordCourseResult(s.st.studentId, s.eid, staff.userId, recordCourseResultSchema.parse({ courseKey: "english-1", outcome: "completed", evidenceDocumentId: "does-not-exist" })))).toMatchObject({ code: "HS_EVIDENCE_INVALID" });
      const pendingDoc = await seedVerifiedDocument(pg, s.st.studentId, "other", { status: "pending" });
      expect(await codeOf(svc().recordCourseResult(s.st.studentId, s.eid, staff.userId, recordCourseResultSchema.parse({ courseKey: "english-1", outcome: "completed", evidenceDocumentId: pendingDoc })))).toMatchObject({ code: "HS_EVIDENCE_INVALID" });
      const softDeleted = await seedVerifiedDocument(pg, s.st.studentId, "other", { softDeleted: true });
      expect(await codeOf(svc().recordCourseResult(s.st.studentId, s.eid, staff.userId, recordCourseResultSchema.parse({ courseKey: "english-1", outcome: "completed", evidenceDocumentId: softDeleted })))).toMatchObject({ code: "HS_EVIDENCE_INVALID" });

      await completeCourse(s, "english-1");
      expect(await codeOf(completeCourse(s, "english-1"))).toMatchObject({ code: "HS_ALREADY_RECORDED", status: 409 });
      expect(await codeOf(completeCourse(s, "no-such-course"))).toMatchObject({ code: "HS_UNKNOWN_COURSE_OR_TASK", status: 422 });
      expect(await codeOf(taskResult(s, "no-such-task", "passed"))).toMatchObject({ code: "HS_UNKNOWN_COURSE_OR_TASK", status: 422 });
      // not_passed does not award credit
      const failed = (await svc().recordCourseResult(s.st.studentId, s.eid, staff.userId, recordCourseResultSchema.parse({ courseKey: "english-2", outcome: "not_passed", evidenceDocumentId: s.doc }))).result;
      expect(failed.current!.credits.earnedHalfUnits).toBe(2);
      expect(failed.current!.studentPreview!.subjects.flatMap((x) => x.courses).find((c) => c.key === "english-2")!.status).toBe("not_passed");
    });

    it("one open enrollment per student; successive enrollments allowed; terminal states are final; revision conflicts are 409", async () => {
      const s = await enroll("Zohar Peled");
      expect(await codeOf(svc().createEnrollment(s.st.studentId, staff.userId, createEnrollmentSchema.parse({ ...STD })))).toMatchObject({ code: "HS_ENROLLMENT_ALREADY_OPEN", status: 409 });
      expect(await codeOf(svc().updateEnrollment(s.st.studentId, s.eid, staff.userId, updateEnrollmentSchema.parse({ expectedRevision: 7, status: "on_hold", note: "stale write" })))).toMatchObject({ code: "HS_REVISION_CONFLICT", status: 409 });
      expect(await codeOf(svc().updateEnrollment(s.st.studentId, s.eid, staff.userId, updateEnrollmentSchema.parse({ expectedRevision: 0, status: "completed", note: "try to skip" })))).toMatchObject({ code: "HS_VALIDATION_FAILED", status: 422 });
      await svc().updateEnrollment(s.st.studentId, s.eid, staff.userId, updateEnrollmentSchema.parse({ expectedRevision: 0, status: "withdrawn", note: "student left" }));
      expect(await codeOf(svc().updateEnrollment(s.st.studentId, s.eid, staff.userId, updateEnrollmentSchema.parse({ expectedRevision: 1, status: "active", note: "reopen" })))).toMatchObject({ code: "HS_INVALID_TRANSITION", status: 409 });
      const next = await svc().createEnrollment(s.st.studentId, staff.userId, createEnrollmentSchema.parse({ ...TN }));
      expect(next.result.enrollments).toHaveLength(2);
      expect(next.result.enrollments.map((e) => e.status)).toEqual(["planned", "withdrawn"]);
      expect(next.result.current!.enrollment.templateKey).toBe("us-hs-diploma-tn-22");
    });

    it("every mutation writes hs_events and returns audit records without notes or PII", async () => {
      const s = await enroll("Ofir Katz");
      const contact = await seedContact(pg, s.st.studentId, { type: "guardian", fullName: "Rotem Katz", authorityStatus: "pending_verification" });
      const noted = await svc().addGuardianNote(s.st.studentId, s.eid, staff.userId, { contactId: contact, note: "SECRET-NOTE call the guardian tomorrow" });
      const updated = await svc().updateEnrollment(s.st.studentId, s.eid, staff.userId, updateEnrollmentSchema.parse({ expectedRevision: 0, note: "SECRET-NOTE internal reason", targetCompletionDate: "2027-05-01" }));
      const events = await pg.sql(`select event_type, summary, detail from hs_events where student_id = '${s.st.studentId}' order by created_at`);
      expect(events.map((e) => e.event_type)).toEqual(["enrollment_created", "guardian_note", "enrollment_updated"]);
      const st = await state(s);
      expect(st.guardians[0].notes[0].note).toMatch(/SECRET-NOTE/);
      expect(st.events.map((e) => e.type)).toContain("guardian_note");
      // pathway history is append-only
      await expect(pg.sql(`delete from hs_events where student_id = '${s.st.studentId}'`)).rejects.toThrow(/append-only/);
      await expect(pg.sql(`update hs_events set summary = 'x' where student_id = '${s.st.studentId}'`)).rejects.toThrow(/append-only/);
      // audits from this test: identifiers only
      const mine = [...noted.audits, ...updated.audits];
      expect(mine.map((a) => a.event)).toEqual(["high_school.guardian_note_added", "high_school.enrollment_updated"]);
      expect(JSON.stringify(mine)).not.toMatch(/SECRET-NOTE|Rotem|Katz/);
      // the audit enum accepts every S11 event (the migration added them)
      const labels = (await pg.sql(`select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'audit_event_type'`)).map((r) => r.enumlabel);
      for (const e of ["enrollment_created", "enrollment_updated", "prior_education_recorded", "transfer_claim_changed", "roadmap_draft_saved", "roadmap_published", "progress_reported", "official_result_recorded", "credit_awarded", "credit_voided", "graduation_updated", "guardian_note_added", "access_denied"]) {
        expect(labels).toContain(`high_school.${e}`);
      }
    });

    it("ledger and progress are tamper-proof at the database level", async () => {
      const s = await enroll("Nitzan Gur");
      await publishPlan(s, withTasks);
      await report(s, "lesson-1", "submitted", 0);
      await completeCourse(s, "english-1");
      await expect(pg.sql(`delete from hs_task_progress where enrollment_id = '${s.eid}'`)).rejects.toThrow(/cannot be deleted/);
      await expect(pg.sql(`update hs_task_progress_events set to_status = 'x' where enrollment_id = '${s.eid}'`)).rejects.toThrow(/append-only/);
      await expect(pg.sql(`delete from hs_credit_awards where enrollment_id = '${s.eid}'`)).rejects.toThrow(/cannot be deleted/);
      await expect(pg.sql(`update hs_credit_awards set half_units = 99 where enrollment_id = '${s.eid}'`)).rejects.toThrow(/immutable/);
      await expect(pg.sql(`update hs_official_results set outcome = 'not_passed' where enrollment_id = '${s.eid}'`)).rejects.toThrow(/immutable/);
      await expect(pg.sql(`delete from hs_official_results where enrollment_id = '${s.eid}'`)).rejects.toThrow(/cannot be deleted/);
      await expect(pg.sql(`update hs_curriculum_templates set title = 'x'`)).rejects.toThrow(/append-only/);
      await expect(pg.sql(`insert into hs_credit_awards (enrollment_id, student_id, source, course_key, area_key, half_units, evidence_document_id) values ('${s.eid}', '${s.st.studentId}', 'course_completion', 'zz', 'math', 0, 'd')`)).rejects.toThrow();
      await expect(pg.sql(`insert into hs_credit_awards (enrollment_id, student_id, source, course_key, area_key, half_units, evidence_document_id) values ('${s.eid}', '${s.st.studentId}', 'transfer', null, 'math', 2, 'd')`)).rejects.toThrow();
    });
  });

  // ── Rule 12 + guardians ────────────────────────────────────────────────────

  describe("R12 programs and guardian standing", () => {
    it("lists simultaneous and successive programs: high school (current + past) plus the university degree, read-only", async () => {
      const s = await enroll("Hadar Ofer");
      await seedUniversityProgram(pg, s.st.studentId, staff.userId);
      const before = await snapshotUniversity(pg);
      const programs = (await svc().getStudentPrograms(s.st.studentId)).programs;
      expect(programs.map((p) => p.kind).sort()).toEqual(["high_school", "university_degree"]);
      expect(programs.find((p) => p.kind === "high_school")).toMatchObject({ current: true, status: "active", title: "Accredited U.S. High School Diploma (21 credits)" });
      expect(programs.find((p) => p.kind === "university_degree")).toMatchObject({ current: true, status: "active" });
      await svc().updateEnrollment(s.st.studentId, s.eid, staff.userId, updateEnrollmentSchema.parse({ expectedRevision: 0, status: "transferred_out", note: "moved schools" }));
      await svc().createEnrollment(s.st.studentId, staff.userId, createEnrollmentSchema.parse({ ...TN }));
      const later = (await svc().getStudentPrograms(s.st.studentId)).programs.filter((p) => p.kind === "high_school");
      expect(later.map((p) => [p.status, p.current])).toEqual([["planned", true], ["transferred_out", false]]);
      expect(await snapshotUniversity(pg)).toEqual(before);
      expect((await state(s)).hasUniversityProgram).toBe(true);
    });

    it("maps S09 contact authority to HS standing; no portal access; scopes gate what may be discussed", async () => {
      const s = await enroll("Carmel Avni");
      const listed = await seedContact(pg, s.st.studentId, { type: "parent", fullName: "Parent Listed", scopes: ["emergency"], authorityStatus: "listed" });
      const unverifiedGuardian = await seedContact(pg, s.st.studentId, { type: "guardian", fullName: "Guardian Pending", scopes: ["academic"], authorityStatus: "pending_verification" });
      const verified = await seedContact(pg, s.st.studentId, { type: "guardian", fullName: "Guardian Verified", scopes: ["academic"], authorityStatus: "verified" });
      const verifiedFin = await seedContact(pg, s.st.studentId, { type: "representative", fullName: "Rep Financial", scopes: ["academic", "financial"], authorityStatus: "verified" });
      const revoked = await seedContact(pg, s.st.studentId, { type: "guardian", fullName: "Guardian Revoked", scopes: ["academic"], authorityStatus: "revoked" });
      await seedContact(pg, s.st.studentId, { type: "emergency", fullName: "Emergency Only", scopes: ["emergency"] });
      const g = (await state(s)).guardians;
      const by = (id: string) => g.find((x) => x.contactId === id)!;
      expect(g).toHaveLength(5); // emergency contacts are not guardians
      expect(by(listed)).toMatchObject({ standing: "listed_parent", mayDiscussAcademics: false, mayDiscussFinances: false, hasPortalAccess: false });
      expect(by(unverifiedGuardian)).toMatchObject({ standing: "guardian_unverified", mayDiscussAcademics: false });
      expect(by(verified)).toMatchObject({ standing: "verified_guardian", mayDiscussAcademics: true, mayDiscussFinances: false, hasPortalAccess: false });
      expect(by(verifiedFin)).toMatchObject({ standing: "verified_guardian", mayDiscussAcademics: true, mayDiscussFinances: true });
      expect(by(revoked)).toMatchObject({ standing: "revoked", mayDiscussAcademics: false });
      const sv = (await svc().getStudentView(s.st.studentId)).guardians;
      expect(sv).toHaveLength(5);
      expect(sv.every((x) => x.hasPortalAccess === false)).toBe(true);
      expect(await codeOf(svc().addGuardianNote(s.st.studentId, s.eid, staff.userId, { contactId: "00000000-0000-0000-0000-000000000000", note: "unknown contact" }))).toMatchObject({ code: "HS_CONTACT_NOT_FOUND", status: 404 });
    });
  });

  // ── HTTP smoke through the real routers and requireAuth ────────────────────

  describe("HTTP smoke (real routers + requireAuth)", () => {
    it("student routes: resolves from the login, rejects studentId, blocks staff/coach, 404 without an enrollment", async () => {
      const none = await seedStudent(pg, { name: "No Enrollment" });
      const r404 = await request(hs.app).get("/api/student/high-school").set(authHeader(none.token));
      expect(r404.status).toBe(404);
      expect(r404.body.error.code).toBe("HS_NO_ENROLLMENT");

      const s = await enroll("Smoke Student");
      await publishPlan(s, withTasks);
      const ok = await request(hs.app).get("/api/student/high-school").set(authHeader(s.st.token));
      expect(ok.status).toBe(200);
      expect(ok.body.enrollment.id).toBe(s.eid);

      for (const res of [
        await request(hs.app).get("/api/student/high-school?studentId=abc").set(authHeader(s.st.token)),
        await request(hs.app).post("/api/student/high-school/progress").set(authHeader(s.st.token)).send({ studentId: s.st.studentId, courseKey: "english-1", taskKey: "lesson-1", status: "submitted", expectedRevision: 0 }),
        await request(hs.app).get("/api/student/programs?studentId=abc").set(authHeader(s.st.token)),
      ]) {
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("HS_STUDENT_ID_NOT_ACCEPTED");
      }
      const prog = await request(hs.app).post("/api/student/high-school/progress").set(authHeader(s.st.token)).send({ courseKey: "english-1", taskKey: "lesson-1", status: "submitted", expectedRevision: 0 });
      expect(prog.status).toBe(200);
      expect(prog.body.awaitingGrade[0].key).toBe("lesson-1");
      const stale = await request(hs.app).post("/api/student/high-school/progress").set(authHeader(s.st.token)).send({ courseKey: "english-1", taskKey: "lesson-1", status: "submitted", expectedRevision: 0 });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe("HS_REVISION_CONFLICT");
      const bad = await request(hs.app).post("/api/student/high-school/progress").set(authHeader(s.st.token)).send({ courseKey: "english-1", taskKey: "lesson-1", status: "graded", expectedRevision: 0 });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe("HS_VALIDATION_FAILED");
      expect((await request(hs.app).get("/api/student/programs").set(authHeader(s.st.token))).body.programs).toHaveLength(1);

      for (const who of [staff, admin, coach]) {
        expect((await request(hs.app).get("/api/student/high-school").set(authHeader(who.token))).status).toBe(403);
      }
      expect((await request(hs.app).get("/api/student/high-school")).status).toBe(401);
    });

    it("staff routes: students and coaches get 403 (student attempts audited), staff cannot publish/void/confer, admin can; missing evidence is 400", async () => {
      const s = await enroll("Smoke Staff");
      const base = `/api/admin/students/${s.st.studentId}/high-school`;
      const deniedBefore = hs.denied.length;

      const asStudent = await request(hs.app).get(base).set(authHeader(s.st.token));
      expect(asStudent.status).toBe(403);
      expect(hs.denied.length).toBe(deniedBefore + 1);
      expect(hs.denied.at(-1)).toMatchObject({ method: "GET", role: "student" });
      expect((await request(hs.app).get(base).set(authHeader(coach.token))).status).toBe(403);
      expect((await request(hs.app).get("/api/admin/high-school/templates").set(authHeader(s.st.token))).status).toBe(403);

      const state200 = await request(hs.app).get(base).set(authHeader(staff.token));
      expect(state200.status).toBe(200);
      expect(state200.body.current.enrollment.id).toBe(s.eid);
      expect((await request(hs.app).get("/api/admin/high-school/templates").set(authHeader(staff.token))).body.templates.map((t: { templateKey: string }) => t.templateKey)).toEqual(["us-hs-diploma-21", "us-hs-diploma-tn-22"]);

      const enr = `${base}/enrollments/${s.eid}`;
      const draft = await request(hs.app).post(`${enr}/roadmap/draft/from-template`).set(authHeader(staff.token)).send({});
      expect(draft.status).toBe(200);
      const rev = draft.body.current.draft.draftRevision;
      const publishBody = { expectedDraftRevision: rev, expectedPublishedVersionId: null };
      const asStaffPublish = await request(hs.app).post(`${enr}/roadmap/publish`).set(authHeader(staff.token)).send(publishBody);
      expect(asStaffPublish.status).toBe(403);
      const asAdminPublish = await request(hs.app).post(`${enr}/roadmap/publish`).set(authHeader(admin.token)).send(publishBody);
      expect(asAdminPublish.status).toBe(200);
      expect(asAdminPublish.body.current.published.versionNumber).toBe(1);

      const noEvidence = await request(hs.app).post(`${enr}/results/course`).set(authHeader(staff.token)).send({ courseKey: "english-1", outcome: "completed" });
      expect(noEvidence.status).toBe(400);
      expect(noEvidence.body.error.code).toBe("HS_EVIDENCE_REQUIRED");
      const badEvidence = await request(hs.app).post(`${enr}/results/course`).set(authHeader(staff.token)).send({ courseKey: "english-1", outcome: "completed", evidenceDocumentId: "nope" });
      expect(badEvidence.status).toBe(422);
      expect(badEvidence.body.error.code).toBe("HS_EVIDENCE_INVALID");
      const auditsBefore = hs.audits.length;
      const good = await request(hs.app).post(`${enr}/results/course`).set(authHeader(staff.token)).send({ courseKey: "english-1", outcome: "completed", evidenceDocumentId: s.doc });
      expect(good.status).toBe(200);
      expect(good.body.current.credits.earnedHalfUnits).toBe(2);
      expect(hs.audits.slice(auditsBefore).map((a) => a.event)).toEqual(["high_school.official_result_recorded", "high_school.credit_awarded"]);

      const awardId = good.body.current.awards[0].id;
      expect((await request(hs.app).post(`${enr}/awards/${awardId}/void`).set(authHeader(staff.token)).send({ reason: "voided by staff?" })).status).toBe(403);
      expect((await request(hs.app).post(`${enr}/awards/${awardId}/void`).set(authHeader(admin.token)).send({ reason: "Issued in error" })).status).toBe(200);

      const confer = { action: "confer_diploma", conferredOn: "2026-10-26", diplomaEvidenceDocumentId: s.doc, transcriptEvidenceDocumentId: s.doc };
      expect((await request(hs.app).post(`${enr}/graduation`).set(authHeader(staff.token)).send(confer)).status).toBe(403);
      const adminConfer = await request(hs.app).post(`${enr}/graduation`).set(authHeader(admin.token)).send(confer);
      expect(adminConfer.status).toBe(409);
      expect(adminConfer.body.error.code).toBe("HS_NOT_ELIGIBLE");

      expect((await request(hs.app).post("/api/admin/high-school/templates").set(authHeader(staff.token)).send({})).status).toBe(403);
      expect((await request(hs.app).get(`${base}?studentId=x`).set(authHeader(staff.token))).status).toBe(400);
      expect((await request(hs.app).get(`/api/admin/students/does-not-exist/high-school`).set(authHeader(staff.token))).status).toBe(404);
      expect((await request(hs.app).get(`${enr}`).set(authHeader(staff.token))).status).toBe(404); // no GET on the enrollment itself
    });

    it("a database failure returns 500 without leaking internals", async () => {
      const s = await enroll("Smoke Failure");
      await pg.sql(`alter table hs_graduation_records rename to hs_graduation_records_tmp`);
      try {
        const res = await request(hs.app).get(`/api/admin/students/${s.st.studentId}/high-school`).set(authHeader(staff.token));
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
        expect(JSON.stringify(res.body)).not.toMatch(/hs_graduation|relation|select/i);
      } finally {
        await pg.sql(`alter table hs_graduation_records_tmp rename to hs_graduation_records`);
      }
    });

    it("an inactive account is refused by requireAuth", async () => {
      const s = await enroll("Smoke Inactive");
      hs.inactiveUsers.add(s.st.userId);
      const res = await request(hs.app).get("/api/student/high-school").set(authHeader(s.st.token));
      expect([401, 403]).toContain(res.status);
      hs.inactiveUsers.delete(s.st.userId);
    });
  });
});
