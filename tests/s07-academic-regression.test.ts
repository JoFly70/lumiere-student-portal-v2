/**
 * S07 — academic regression: plan review (shared/student-roadmap-plan-review.ts),
 * its wiring into the roadmap service `evaluate()`, and real-Postgres checks.
 *
 * Reuses S05/S06 coverage (see docs/recovery/s07-evidence/academic/regression-matrix.md)
 * and adds only the cases that were missing. All data is synthetic; the
 * rules are independent research candidates, not approved policy.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ROADMAP_CONTENT_VERSION,
  type ConversionResult,
  type RoadmapContent,
  type RoadmapException,
} from "../shared/student-roadmap-contract";
import { reviewRoadmapPlan, STALE_SCHEDULE_DAYS } from "../shared/student-roadmap-plan-review";
import { projectStudentRoadmap } from "../shared/student-roadmap-projection";
import { diffRoadmapContent, validateRoadmapContent } from "../shared/student-roadmap-validation";
import type { StudentCreditView, StudentDegreeProgressView } from "../shared/student-degree-progress-view";
import { createStudentRoadmapService, RoadmapError } from "../server/services/student-roadmap-service";
import { createFakeRoadmapStore } from "./helpers/fake-roadmap-repo";
import {
  PG_BINARIES_AVAILABLE,
  s05MigrationExists,
  seedAcademicRecord,
  seedStudent,
  seedUser,
  startLocalPg,
  type LocalPg,
  type SeededUser,
} from "./helpers/s05-local-pg";
import { bootRoadmapStack, snapshotCanonical, type RoadmapStack } from "./helpers/s05-roadmap-stack";

// ── builders ────────────────────────────────────────────────────────────────

const TODAY = "2026-10-26";

function plan(items: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): RoadmapContent {
  return {
    contentVersion: ROADMAP_CONTENT_VERSION,
    title: "Synthetic plan",
    objectives: [{ key: "ba", title: "BS Accounting", kind: "primary", linkedToProgramAssignment: true, status: "active" }],
    phases: [{ key: "p1", title: "Phase 1", sequence: 1 }],
    items: items.map((i, idx) => ({
      phaseKey: "p1", objectiveKey: "ba", sequence: idx + 1, kind: "course", dependsOn: [], planStatus: "planned",
      tasks: [], provenance: [], ...i,
    })),
    milestones: [],
    reportedHistory: [],
    ...extra,
  } as unknown as RoadmapContent;
}

function credit(over: Partial<StudentCreditView> & { creditRecordId: string }): StudentCreditView {
  return {
    courseCode: null, title: "Credit", term: null, completedOn: null, recordType: "course",
    reportedCredits: "3.00", awardedCredits: "3.00", standing: "VERIFIED_APPLIED", sourceId: null,
    appliedToRequirementIds: [], ...over,
  };
}

function foundation(credits: StudentCreditView[], state: StudentDegreeProgressView["state"] = "COMPOSED"): StudentDegreeProgressView {
  return {
    contractVersion: "student-degree-progress/1", state, asOf: null, program: null,
    totals: state === "COMPOSED"
      ? { unit: "credit", requiredCredits: "120.00", appliedCredits: "0.00", remainingCredits: "120.00", verifiedCreditsOnRecord: "0.00", requirementsSatisfied: 0, requirementsTotal: 1 }
      : null,
    requirements: [], credits, sources: [], attention: [], milestones: [], nextSteps: [],
  };
}

const review = (content: RoadmapContent, over: Partial<Parameters<typeof reviewRoadmapPlan>[1]> = {}) =>
  reviewRoadmapPlan(content, { today: TODAY, foundation: null, progressKeys: new Map(), ...over });
const codes = (ex: RoadmapException[]) => ex.map((e) => e.code);

// ── 1. plan review rules (pure) ─────────────────────────────────────────────

describe("S07 plan review — rules", () => {
  it("a clean plan raises nothing and every finding is a warning", () => {
    expect(review(plan([{ key: "a", title: "Intro", plannedStart: "2026-11-01", plannedEnd: "2026-12-01" }]))).toEqual([]);
  });

  it("TECEP exam planned after its term's final exam date (item and task level); in-term is clean", () => {
    const reg = { termLabel: "Nov 2026", termStart: "2026-11-01", registrationDeadline: "2026-10-28", finalExamDate: "2027-01-23" };
    const late = review(plan([
      { key: "tecep-acc", kind: "exam", title: "TECEP Financial Accounting", code: "ACC-101-TE", plannedStart: "2026-10-27", plannedEnd: "2027-02-10", registration: reg },
      { key: "course-x", title: "Course", registration: reg, tasks: [{ key: "final-exam", kind: "exam", title: "Final", sequence: 1, dueDate: "2027-02-01" }] },
    ]));
    expect(late.map((e) => e.key).sort()).toEqual([
      "EXAM_AFTER_TERM_DEADLINE:course-x:final-exam",
      "EXAM_AFTER_TERM_DEADLINE:tecep-acc",
    ]);
    expect(late.every((e) => e.severity === "warning")).toBe(true);
    const ok = review(plan([{ key: "t", kind: "exam", title: "TECEP", plannedStart: "2026-10-27", plannedEnd: "2027-01-23", registration: reg }]));
    expect(ok).toEqual([]);
  });

  it("a non-exam item ending after the exam date is not an exam finding; start after the registration deadline is flagged", () => {
    const reg = { termLabel: "Nov 2026", registrationDeadline: "2026-10-28", finalExamDate: "2027-01-23" };
    const ex = review(plan([{ key: "c", title: "Course", plannedStart: "2026-11-05", plannedEnd: "2027-03-01", registration: reg }]));
    expect(codes(ex)).toEqual(["REGISTRATION_AFTER_DEADLINE"]);
  });

  it("capstone planned before its prerequisites are documented; documented evidence clears it; dropped items are ignored", () => {
    const gate = (evidence: "not_documented" | "documented", planStatus = "planned") => plan([{
      key: "capstone", title: "Capstone", planStatus, registrationGate: { requirement: "Institution registration prerequisites", evidence },
    }]);
    expect(review(gate("not_documented")).map((e) => e.key)).toEqual(["REGISTRATION_GATE_UNDOCUMENTED:capstone"]);
    expect(review(gate("documented"))).toEqual([]);
    expect(review(gate("not_documented", "dropped"))).toEqual([]);
  });

  it("reported starting credits: unsupported when the foundation is missing, under review, or lower; supported when verified covers them; never adjusts any figure", () => {
    const hist = (credits: string) => plan([], {
      reportedHistory: [{ key: "baseline", kind: "credit_baseline", title: "Starting credits", reportedCredits: credits, reportedStatus: "reported", provenance: [] }],
    });
    const verified = foundation([credit({ creditRecordId: "r1", awardedCredits: "60.00" }), credit({ creditRecordId: "r2", awardedCredits: "30.00", standing: "VERIFIED_NOT_APPLIED" })]);
    const pending = foundation([credit({ creditRecordId: "r3", awardedCredits: null, standing: "PENDING_VERIFICATION", reportedCredits: "90.00" })]);
    expect(codes(review(hist("90.00"), { foundation: null }))).toEqual(["STARTING_CREDITS_UNVERIFIED"]);
    expect(codes(review(hist("90.00"), { foundation: foundation([], "UNDER_REVIEW") }))).toEqual(["STARTING_CREDITS_UNVERIFIED"]);
    expect(codes(review(hist("90.00"), { foundation: pending }))).toEqual(["STARTING_CREDITS_UNVERIFIED"]);
    expect(codes(review(hist("100.00"), { foundation: verified }))).toEqual(["STARTING_CREDITS_UNVERIFIED"]);
    expect(review(hist("90.00"), { foundation: verified })).toEqual([]);
    const before = JSON.stringify(verified);
    review(hist("100.00"), { foundation: verified });
    expect(JSON.stringify(verified)).toBe(before);
  });

  it("reported completed course is checked against the matching verified credit record", () => {
    const content = plan([], {
      reportedHistory: [{ key: "acc101", kind: "course", title: "Financial Accounting", reportedCredits: "3.00", reportedStatus: "completed", provenance: [] }],
    });
    expect(codes(review(content, { foundation: foundation([credit({ creditRecordId: "x", title: "Financial Accounting" })]) }))).toEqual([]);
    expect(codes(review(content, { foundation: foundation([credit({ creditRecordId: "x", title: "Financial Accounting", awardedCredits: null, standing: "NEEDS_REVIEW" })]) }))).toEqual(["STARTING_CREDITS_UNVERIFIED"]);
  });

  it("conditional equivalency warns; staff_reviewed does not", () => {
    const mk = (status: string) => plan([{ key: "sophia-acc", title: "Sophia ACC", equivalency: { status, mapsTo: "ACC-101" } }]);
    expect(codes(review(mk("conditional")))).toEqual(["EQUIVALENCY_CONDITIONAL"]);
    expect(review(mk("staff_reviewed"))).toEqual([]);
  });

  it("licensing credit use and licensing objectives warn that licensing qualification is a separate determination", () => {
    const ex = review(plan(
      [
        { key: "lic", title: "Ethics for licensure", creditUse: "licensing" },
        { key: "both", title: "Audit", creditUse: "degree_and_licensing" },
        { key: "deg", title: "Statistics", creditUse: "degree" },
      ],
      { objectives: [
        { key: "ba", title: "BS Accounting", kind: "primary", linkedToProgramAssignment: true, status: "active" },
        { key: "cpa", title: "CPA licensing plan", kind: "secondary", status: "active" },
      ] },
    ));
    expect(ex.map((e) => e.key).sort()).toEqual([
      "LICENSING_CREDIT_SEPARATE:both",
      "LICENSING_CREDIT_SEPARATE:lic",
      "LICENSING_CREDIT_SEPARATE:objective:cpa",
    ]);
    expect(ex.every((e) => /separate/i.test(e.message))).toBe(true);
  });

  describe("stale execution schedule", () => {
    const old = plan(
      [{ key: "a", title: "A", plannedStart: "2026-08-03", plannedEnd: "2026-08-30" }, { key: "b", title: "B", plannedStart: "2026-09-01", plannedEnd: "2026-09-27" }],
      { schedule: { preparedOn: "2026-08-01", startsOn: "2026-08-03", weeks: 8 } },
    );
    it("outdated with past-due items and no recorded progress -> SCHEDULE_STALE", () => {
      expect(review(old).map((e) => e.key)).toEqual(["SCHEDULE_STALE:plan"]);
    });
    it("any recorded progress on a planned item, a fresh schedule, or nothing past due suppresses it", () => {
      expect(review(old, { progressKeys: new Map([["a", new Set(["__item__"])]]) })).toEqual([]);
      expect(review({ ...old, schedule: { preparedOn: "2026-10-20" } } as RoadmapContent)).toEqual([]);
      const future = plan([{ key: "a", title: "A", plannedStart: "2026-12-01", plannedEnd: "2026-12-20" }], { schedule: { preparedOn: "2026-08-01" } });
      expect(review(future)).toEqual([]);
    });
    it("uses the earliest planned date when preparedOn is absent, and the threshold is exclusive", () => {
      const noMeta = plan([{ key: "a", title: "A", plannedStart: "2026-08-03", plannedEnd: "2026-08-30" }]);
      expect(codes(review(noMeta))).toEqual(["SCHEDULE_STALE"]);
      const edge = (d: number) => {
        const prepared = new Date(Date.UTC(2026, 9, 26 - d)).toISOString().slice(0, 10);
        return plan([{ key: "a", title: "A", plannedEnd: "2026-10-01" }], { schedule: { preparedOn: prepared } });
      };
      expect(review(edge(STALE_SCHEDULE_DAYS))).toEqual([]);
      expect(codes(review(edge(STALE_SCHEDULE_DAYS + 1)))).toEqual(["SCHEDULE_STALE"]);
    });
  });

  describe("duplicate credit (course substitution)", () => {
    it("two active items with the same code, or the same title and institution", () => {
      const ex = review(plan([
        { key: "acc-a", title: "Financial Accounting", code: "ACC-101", institution: "State U" },
        { key: "acc-b", title: "Intro Accounting", code: "acc 101", institution: "Other U" },
        { key: "stat-a", title: "Statistics", institution: "State U" },
        { key: "stat-b", title: "STATISTICS", institution: "state u" },
      ]));
      expect(ex.map((e) => e.key).sort()).toEqual(["DUPLICATE_CREDIT_RISK:acc-a+acc-b", "DUPLICATE_CREDIT_RISK:stat-a+stat-b"]);
    });
    it("an alternative or dropped duplicate is a legitimate substitution and does not warn", () => {
      const ex = review(plan([
        { key: "acc-a", title: "Financial Accounting", code: "ACC-101" },
        { key: "acc-b", title: "Financial Accounting", code: "ACC-101", planStatus: "alternative", alternativeOf: "acc-a" },
        { key: "acc-c", title: "Financial Accounting", code: "ACC-101", planStatus: "dropped" },
      ]));
      expect(ex).toEqual([]);
    });
    it("an active item matching reported completed work or a canonical record warns; a staff link to that record does not", () => {
      const content = plan(
        [{ key: "eng", title: "English Composition I", code: "ENC-1010" }],
        { reportedHistory: [{ key: "h-eng", kind: "course", title: "English Composition I", reportedStatus: "completed", reportedCredits: "3.00", provenance: [] }] },
      );
      const supportsHistory = foundation([credit({ creditRecordId: "rec-0", title: "English Composition I", courseCode: "ENC-1010" })]);
      expect(review(content, { foundation: supportsHistory }).map((e) => e.key))
        .toEqual(["DUPLICATE_CREDIT_RISK:eng:history:h-eng", "DUPLICATE_CREDIT_RISK:eng:record:rec-0"]);
      expect(review(content).map((e) => e.key)).toEqual(["STARTING_CREDITS_UNVERIFIED:h-eng", "DUPLICATE_CREDIT_RISK:eng:history:h-eng"]);
      const f = foundation([credit({ creditRecordId: "rec-1", title: "English Composition I", courseCode: "ENC-1010" })]);
      expect(review(plan([{ key: "eng", title: "English Composition I", code: "ENC-1010" }]), { foundation: f }).map((e) => e.key))
        .toEqual(["DUPLICATE_CREDIT_RISK:eng:record:rec-1"]);
      const linkedId = "11111111-1111-4111-8111-111111111111";
      const f2 = foundation([credit({ creditRecordId: linkedId, title: "English Composition I", courseCode: "ENC-1010" })]);
      expect(review(plan([{ key: "eng", title: "English Composition I", code: "ENC-1010", linkedCreditRecordId: linkedId }]), { foundation: f2 })).toEqual([]);
      const rejected = foundation([credit({ creditRecordId: "rec-2", title: "English Composition I", standing: "NOT_ACCEPTED", awardedCredits: null })]);
      expect(review(plan([{ key: "eng", title: "English Composition I" }]), { foundation: rejected })).toEqual([]);
    });
  });

  it("conflicting deadlines from two workbooks surface as plan-level warnings (importer DEADLINE_CONFLICT is tested with the importer)", () => {
    // Master says the exam is booked in the Nov term; the execution schedule dates it after the term ends.
    const ex = review(plan([{
      key: "tecep", kind: "exam", title: "TECEP", plannedStart: "2026-11-03", plannedEnd: "2027-02-14",
      registration: { termLabel: "Nov 2026", registrationDeadline: "2026-10-28", finalExamDate: "2027-01-23" },
      provenance: [{ role: "master", file: "master.xlsx" }, { role: "execution", file: "exec.xlsx" }],
    }]));
    expect(codes(ex)).toEqual(["EXAM_AFTER_TERM_DEADLINE", "REGISTRATION_AFTER_DEADLINE"]);
  });

  it("is deterministic and key-stable across calls and content order of identical findings", () => {
    const content = plan([
      { key: "x", title: "X", equivalency: { status: "conditional" }, creditUse: "licensing" },
      { key: "y", title: "Y", registrationGate: { requirement: "r", evidence: "not_documented" } },
    ]);
    expect(review(content)).toEqual(review(structuredClone(content)));
    expect(new Set(review(content).map((e) => e.key)).size).toBe(review(content).length);
  });
});

// ── 2. licensing never becomes degree credit ───────────────────────────────

describe("S07 licensing credit never adds to degree figures", () => {
  const f = foundation([credit({ creditRecordId: "r1", awardedCredits: "30.00", reportedCredits: "30.00" })]);
  const view = (items: Array<Record<string, unknown>>) =>
    projectStudentRoadmap({ content: plan(items), versionNumber: 1, publishedAt: null, preview: false, progress: [], degreeProgress: f, previousVersions: [] });

  it("reported, verified, applied and required are canonical-only: planned licensing items cannot move them", () => {
    const degreeOnly = view([{ key: "d", title: "Degree course", credits: "3.00" }]).foundation.ladder;
    const withLicensing = view([
      { key: "d", title: "Degree course", credits: "3.00" },
      { key: "l", title: "Licensing ethics", credits: "3.00", creditUse: "licensing" },
    ]).foundation.ladder;
    for (const k of ["reported", "provisional", "verified", "applied", "surplus", "required"] as const) {
      expect(withLicensing[k]).toBe(degreeOnly[k]);
    }
  });

  // KNOWN GAP (reported to the lead, projection is outside this change's ownership):
  // `planned` currently sums item.credits regardless of creditUse, so a licensing-only item inflates
  // the student's "planned toward the degree" figure. `it.fails` pins the desired behaviour and will
  // start failing (forcing removal of `.fails`) once the projection excludes creditUse "licensing".
  it.fails("planned (degree) credit excludes licensing-only items", () => {
    const degreeOnly = view([{ key: "d", title: "Degree course", credits: "3.00" }]).foundation.ladder.planned;
    const withLicensing = view([
      { key: "d", title: "Degree course", credits: "3.00" },
      { key: "l", title: "Licensing ethics", credits: "3.00", creditUse: "licensing" },
    ]).foundation.ladder.planned;
    expect(withLicensing).toBe(degreeOnly);
  });
});

// ── 3. service wiring (in-memory repo) ─────────────────────────────────────

const STUDENT = "stu-1";
const STAFF = "staff-1";
const ADMIN = "admin-1";
const STUDENT_USER = "user-1";

function conversion(content: RoadmapContent): ConversionResult {
  return {
    templateId: "lumiere-roadmap-v1", content, exceptions: [],
    summary: { kind: "workbook", fileName: "p.xlsx", sheetsRead: ["Plan"], rowsRead: 2, rowsConverted: 2, rowsSkipped: 0, generator: null },
  };
}

function setup(opts: { foundation?: StudentDegreeProgressView | null; today?: Date; failLoader?: boolean } = {}) {
  const store = createFakeRoadmapStore([STUDENT]);
  let tick = 0;
  const base = opts.today ?? new Date(Date.UTC(2026, 9, 26, 12, 0, 0));
  let foundationNow = opts.foundation ?? null;
  const service = createStudentRoadmapService({
    repo: store.repo,
    transaction: store.transaction,
    readTx: store.tx,
    loadDegreeProgress: async () => {
      if (opts.failLoader) throw new Error("loader down");
      return foundationNow;
    },
    validate: validateRoadmapContent,
    diff: diffRoadmapContent,
    now: () => new Date(base.getTime() + 1000 * tick++),
  });
  let n = 0;
  const importDraft = (content: RoadmapContent, replaceDraft = false) =>
    service.createDraftFromConversion(STUDENT, STAFF, { conversion: conversion(content), fileSha256: `sha-${n++}`, fileName: "p.xlsx" }, { replaceDraft });
  return { store, service, importDraft, setFoundation: (f: StudentDegreeProgressView | null) => { foundationNow = f; } };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return "OK"; } catch (e) { return e instanceof RoadmapError ? e.code : `ERR:${(e as Error).message}`; }
}

const REG = { termLabel: "Nov 2026", termStart: "2026-11-01", registrationDeadline: "2026-10-28", finalExamDate: "2027-01-23" };

describe("S07 plan review — service wiring", () => {
  it("draft carries review warnings, publish is refused (422) until each is acknowledged, then succeeds", async () => {
    const { service, importDraft } = setup();
    const imported = await importDraft(plan([
      { key: "tecep", kind: "exam", title: "TECEP", plannedStart: "2026-11-03", plannedEnd: "2027-02-14", registration: REG },
      { key: "capstone", title: "Capstone", registrationGate: { requirement: "Catalog prerequisites", evidence: "not_documented" } },
    ]));
    const draft = imported.state.draft!;
    expect(draft.exceptions.map((e) => e.code).sort()).toEqual(["EXAM_AFTER_TERM_DEADLINE", "REGISTRATION_AFTER_DEADLINE", "REGISTRATION_GATE_UNDOCUMENTED"]);
    expect(draft.exceptions.every((e) => e.severity === "warning")).toBe(true);
    expect(draft.publishable).toBe(false);
    expect(await codeOf(service.publish(STUDENT, ADMIN, draft.draftRevision, null))).toBe("ROADMAP_NOT_PUBLISHABLE");
    const acked = await service.acknowledge(STUDENT, STAFF, draft.draftRevision, draft.exceptions.map((e) => e.key), "reviewed");
    expect(acked.draft!.publishable).toBe(true);
    const published = await service.publish(STUDENT, ADMIN, acked.draft!.draftRevision, null);
    expect(published.published?.versionNumber).toBe(1);
  });

  it("review findings are re-derived (not stored as conversion findings): fixing the data drops the finding and its acknowledgement", async () => {
    const { service, importDraft } = setup();
    const content = plan([{ key: "tecep", kind: "exam", title: "TECEP", plannedStart: "2026-11-03", plannedEnd: "2027-02-14", registration: { ...REG, registrationDeadline: "2026-11-30" } }]);
    const { state } = await importDraft(content);
    const key = "EXAM_AFTER_TERM_DEADLINE:tecep";
    expect(state.draft!.exceptions.map((e) => e.key)).toEqual([key]);
    const acked = await service.acknowledge(STUDENT, STAFF, state.draft!.draftRevision, [key]);
    expect(acked.draft!.acknowledgements.map((a) => a.exceptionKey)).toEqual([key]);
    const fixed = await service.updateDraft(STUDENT, STAFF, acked.draft!.draftRevision, { ...content, items: [{ ...content.items[0], plannedEnd: "2027-01-20" }] });
    expect(fixed.draft!.exceptions).toEqual([]);
    expect(fixed.draft!.acknowledgements).toEqual([]);
    expect(fixed.draft!.publishable).toBe(true);
  });

  it("the canonical foundation drives STARTING_CREDITS_UNVERIFIED; a loader failure degrades to unverified, never throws", async () => {
    const hist = plan([], { reportedHistory: [{ key: "baseline", kind: "credit_baseline", title: "Starting credits", reportedCredits: "60.00", reportedStatus: "reported", provenance: [] }] });
    const supported = setup({ foundation: foundation([credit({ creditRecordId: "r", awardedCredits: "60.00" })]) });
    expect((await supported.importDraft(hist)).state.draft!.exceptions).toEqual([]);
    const missing = setup({ foundation: null });
    expect((await missing.importDraft(hist)).state.draft!.exceptions.map((e) => e.code)).toEqual(["STARTING_CREDITS_UNVERIFIED"]);
    const failing = setup({ failLoader: true });
    expect((await failing.importDraft(hist)).state.draft!.exceptions.map((e) => e.code)).toEqual(["STARTING_CREDITS_UNVERIFIED"]);
  });

  it("`today` comes from deps.now: the same stale schedule is clean 'today' and stale a month later", async () => {
    const content = plan([{ key: "a", title: "A", plannedStart: "2026-10-01", plannedEnd: "2026-10-10" }], { schedule: { preparedOn: "2026-10-01" } });
    const early = setup({ today: new Date(Date.UTC(2026, 9, 12, 12)) });
    expect((await early.importDraft(content)).state.draft!.exceptions).toEqual([]);
    const late = setup({ today: new Date(Date.UTC(2026, 10, 20, 12)) });
    expect((await late.importDraft(content)).state.draft!.exceptions.map((e) => e.code)).toEqual(["SCHEDULE_STALE"]);
  });

  it("recorded student progress suppresses SCHEDULE_STALE on the next evaluation", async () => {
    const { service, importDraft } = setup({ today: new Date(Date.UTC(2026, 10, 20, 12)) });
    const v1 = plan([{ key: "a", title: "A", plannedStart: "2026-10-01", plannedEnd: "2026-10-10" }], { schedule: { preparedOn: "2026-10-01" } });
    // Published v1 with a stale schedule (acknowledged), then the student reports activity.
    const first = (await importDraft(v1)).state.draft!;
    expect(first.exceptions.map((e) => e.code)).toEqual(["SCHEDULE_STALE"]);
    const acked = await service.acknowledge(STUDENT, STAFF, first.draftRevision, first.exceptions.map((e) => e.key));
    await service.publish(STUDENT, ADMIN, acked.draft!.draftRevision, null);
    await service.reportProgress(STUDENT, STUDENT_USER, { itemKey: "a", taskKey: null, status: "in_progress", expectedRevision: 0 });
    const next = await service.draftFromPublished(STUDENT, STAFF);
    expect(next.draft!.exceptions.map((e) => e.code)).not.toContain("SCHEDULE_STALE");
  });

  it("rescheduling keeps student activity and resolves the review warning; a replacement item inherits none", async () => {
    const { service, importDraft } = setup();
    const v1 = plan([
      { key: "tecep", kind: "exam", title: "TECEP", plannedStart: "2026-11-03", plannedEnd: "2027-02-14", registration: { ...REG, registrationDeadline: "2026-11-30" } },
      { key: "acc", title: "Accounting", code: "ACC-201", plannedStart: "2026-11-03", plannedEnd: "2027-01-10" },
    ]);
    const d1 = (await importDraft(v1)).state.draft!;
    const a1 = await service.acknowledge(STUDENT, STAFF, d1.draftRevision, d1.exceptions.map((e) => e.key));
    await service.publish(STUDENT, ADMIN, a1.draft!.draftRevision, null);
    await service.reportProgress(STUDENT, STUDENT_USER, { itemKey: "tecep", taskKey: null, status: "in_progress", expectedRevision: 0 });
    await service.reportProgress(STUDENT, STUDENT_USER, { itemKey: "acc", taskKey: null, status: "in_progress", expectedRevision: 0 });

    // v2: tecep re-dated into the term (same key); acc replaced by a different item key.
    const v2 = plan([
      { ...v1.items[0], plannedEnd: "2027-01-20" },
      { key: "acc-new", title: "Accounting (replacement)", code: "ACC-202", plannedStart: "2026-11-03", plannedEnd: "2027-01-10" },
    ]);
    const published = (await service.getAdminState(STUDENT)).published!;
    const d2 = (await importDraft(v2)).state.draft!;
    expect(d2.exceptions.map((e) => e.code)).not.toContain("EXAM_AFTER_TERM_DEADLINE");
    expect(d2.exceptions.map((e) => e.code)).toContain("PROGRESS_ON_REMOVED_ITEM");
    expect(d2.diff.changed.find((c) => c.itemKey === "tecep")?.rescheduleOnly).toBe(true);
    const a2 = await service.acknowledge(STUDENT, STAFF, d2.draftRevision, d2.exceptions.filter((e) => e.severity === "warning").map((e) => e.key));
    await service.publish(STUDENT, ADMIN, a2.draft!.draftRevision, published.versionId);
    const view = await service.getStudentView(STUDENT);
    const items = view.phases.flatMap((p) => p.items);
    expect(items.find((i) => i.key === "tecep")?.itemStatus).toBe("in_progress");
    expect(items.find((i) => i.key === "acc-new")?.itemStatus).toBe("not_started");
    expect(view.history.retiredProgress.map((r) => r.itemKey)).toEqual(["acc"]);
  });

  it("completed at the provider is not official acceptance, and the canonical foundation is untouched by the report", async () => {
    const pending = foundation([credit({ creditRecordId: "11111111-1111-4111-8111-111111111111", title: "Accounting", standing: "PENDING_VERIFICATION", awardedCredits: null, reportedCredits: "3.00" })]);
    const frozen = JSON.stringify(pending);
    const { service, importDraft } = setup({ foundation: pending });
    const d = (await importDraft(plan([{ key: "acc", title: "Accounting", credits: "3.00", linkedCreditRecordId: "11111111-1111-4111-8111-111111111111" }]))).state.draft!;
    await service.publish(STUDENT, ADMIN, d.draftRevision, null);
    const view = await service.reportProgress(STUDENT, STUDENT_USER, { itemKey: "acc", taskKey: null, status: "provider_complete", expectedRevision: 0 });
    const item = view.phases.flatMap((p) => p.items).find((i) => i.key === "acc")!;
    expect(item.stage).toBe("provider_complete");
    expect(item.stage).not.toBe("officially_accepted");
    expect(view.foundation.ladder.verified).toBe("0.00");
    expect(view.foundation.ladder.provisional).toBe("3.00");
    expect(JSON.stringify(pending)).toBe(frozen);
  });

  it("the student cannot report official acceptance", async () => {
    const { service, importDraft } = setup();
    const d = (await importDraft(plan([{ key: "acc", title: "Accounting" }]))).state.draft!;
    await service.publish(STUDENT, ADMIN, d.draftRevision, null);
    const bad = service.reportProgress(STUDENT, STUDENT_USER, { itemKey: "acc", taskKey: null, status: "officially_accepted" as never, expectedRevision: 0 });
    expect(await codeOf(bad)).toBe("ROADMAP_VALIDATION_ERROR");
  });

  it("substitution that duplicates credit warns on the draft and the alternative route does not", async () => {
    const { importDraft } = setup();
    const dup = (await importDraft(plan([
      { key: "acc-a", title: "Financial Accounting", code: "ACC-101" },
      { key: "acc-b", title: "Financial Accounting (Sophia)", code: "ACC-101" },
    ]))).state.draft!;
    expect(dup.exceptions.map((e) => e.code)).toEqual(["DUPLICATE_CREDIT_RISK"]);
    const alt = setup();
    const ok = (await alt.importDraft(plan([
      { key: "acc-a", title: "Financial Accounting", code: "ACC-101" },
      { key: "acc-b", title: "Financial Accounting (Sophia)", code: "ACC-101", planStatus: "alternative", alternativeOf: "acc-a" },
    ]))).state.draft!;
    expect(ok.exceptions).toEqual([]);
  });

  it("old stored content without S07 fields still evaluates", async () => {
    const { importDraft } = setup();
    const legacy = plan([{ key: "a", title: "A" }]) as unknown as Record<string, unknown>;
    delete legacy.reportedHistory;
    const out = await importDraft(legacy as unknown as RoadmapContent);
    expect(out.state.draft!.exceptions).toEqual([]);
  });
});

// ── 4. real Postgres ───────────────────────────────────────────────────────

const ready = PG_BINARIES_AVAILABLE && s05MigrationExists();

describe.skipIf(!ready)("S07 academic regression — real Postgres", () => {
  let pg: LocalPg;
  let stack: RoadmapStack;
  let staff: SeededUser;
  let admin: SeededUser;

  beforeAll(async () => {
    pg = await startLocalPg();
    stack = await bootRoadmapStack(pg);
    staff = await seedUser(pg, "staff");
    admin = await seedUser(pg, "admin");
  }, 300_000);

  afterAll(async () => {
    await pg?.stop();
  }, 60_000);

  const newStudent = async () => {
    const user = await seedUser(pg, "student");
    const student = await seedStudent(pg, { userId: user.id });
    return { user, student };
  };

  const draftOf = (content: RoadmapContent, sha: string, studentId: string) =>
    stack.service.createDraftFromConversion(studentId, staff.id, { conversion: conversion(content), fileSha256: sha, fileName: "p.xlsx" }, { replaceDraft: false });

  it("review warnings persist across a real transaction, gate publish (422), and are keyed deterministically", async () => {
    const { student } = await newStudent();
    const content = plan([{ key: "capstone", title: "Capstone", registrationGate: { requirement: "Prerequisites", evidence: "not_documented" } }]);
    const out = await draftOf(content, "s07-gate", student.id);
    expect(out.state.draft!.exceptions.map((e) => e.key)).toEqual(["REGISTRATION_GATE_UNDOCUMENTED:capstone"]);
    expect((await stack.service.getAdminState(student.id)).draft!.exceptions.map((e) => e.key)).toEqual(["REGISTRATION_GATE_UNDOCUMENTED:capstone"]);
    expect(await codeOf(stack.service.publish(student.id, admin.id, out.state.draft!.draftRevision, null))).toBe("ROADMAP_NOT_PUBLISHABLE");
    await stack.ackAll(student.id, staff.id);
    expect((await stack.publishOpenDraft(student.id, admin.id)).published?.versionNumber).toBe(1);
  });

  it("concurrent staff publication of an acknowledged-warning draft: exactly one wins, the loser is rejected as stale", async () => {
    const { student } = await newStudent();
    const content = plan([{ key: "eq", title: "Sophia ACC", equivalency: { status: "conditional" } }]);
    await draftOf(content, "s07-conc", student.id);
    const rev = (await stack.ackAll(student.id, staff.id)).draft!.draftRevision;
    const settled = await Promise.allSettled([
      stack.service.publish(student.id, admin.id, rev, null),
      stack.service.publish(student.id, admin.id, rev, null),
    ]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const lost = settled.find((s): s is PromiseRejectedResult => s.status === "rejected")!;
    expect(["ROADMAP_STALE_DRAFT", "ROADMAP_NO_DRAFT"]).toContain((lost.reason as RoadmapError).code);
    const n = await pg.sql(`select count(*)::int as n from student_roadmap_versions v join student_roadmap_plans p on p.id = v.plan_id where p.student_id = '${student.id}' and v.status = 'published'`);
    expect(n[0].n).toBe(1);
  });

  it("REAL canonical loader: a pending-acceptance student report leaves canonical credit tables byte-identical, and reported credits above the verified record are flagged", async () => {
    const { user, student } = await newStudent();
    const acad = await seedAcademicRecord(pg, student.id, { staffUserId: staff.id, awardedCredits: "3.00", courseTitle: "Synthetic Composition" });
    const content = plan(
      [
        // Planned course the student will complete at the provider; NOT linked, so never "officially accepted".
        { key: "acc", title: "Accounting I", code: "ACC-101", credits: "3.00" },
        // Unlinked duplicate of work already on the canonical record.
        { key: "comp", title: "Synthetic Composition", credits: "3.00" },
      ],
      { reportedHistory: [{ key: "baseline", kind: "credit_baseline", title: "Starting credits", reportedCredits: "60.00", reportedStatus: "reported", provenance: [] }] },
    );
    const before = await snapshotCanonical(pg);
    const imported = await draftOf(content, "s07-canon", student.id);
    expect(imported.state.draft!.exceptions.map((e) => e.key).sort()).toEqual([
      "DUPLICATE_CREDIT_RISK:comp:record:" + acad.creditRecordId,
      "STARTING_CREDITS_UNVERIFIED:baseline",
    ].sort());
    await stack.ackAll(student.id, staff.id);
    await stack.publishOpenDraft(student.id, admin.id);
    const view = await stack.service.reportProgress(student.id, user.id, { itemKey: "acc", taskKey: null, status: "provider_complete", expectedRevision: 0 });
    const acc = view.phases.flatMap((p) => p.items).find((i) => i.key === "acc")!;
    expect(acc.stage).toBe("provider_complete");
    expect(Number(view.foundation.ladder.verified)).toBe(3);
    expect(await snapshotCanonical(pg)).toEqual(before);
  });
});
