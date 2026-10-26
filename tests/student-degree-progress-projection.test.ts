import { describe, expect, it } from "vitest";
import {
  projectStudentDegreeProgress,
  type ProjectionAcademicRecord,
  type ProjectionReport,
  type ProjectionRequirementResult,
} from "../shared/student-degree-progress-projection";
import {
  composedCompleteView,
  composedMidProgressInput,
  composedMidProgressView,
  composedWithConflictView,
  noActiveProgramView,
  underReviewView,
} from "./fixtures/student-degree-progress-fixtures";

const labels = {
  r1: { code: "A", title: "Alpha", sequence: 1 },
  r2: { code: "B", title: "Beta", sequence: 2 },
  r3: { code: "C", title: "Gamma", sequence: 2 },
};
const res = (
  id: string | null, status: string, req: string | null, app: string | null,
  rem: string | null, credits: string[] = [],
): ProjectionRequirementResult => ({
  requirementId: id, status, requiredAmount: req, appliedAmount: app,
  remainingAmount: rem, provenance: { studentCreditRecordIds: credits },
});
const composed = (results: ProjectionRequirementResult[]): ProjectionReport => ({
  status: "COMPOSED", snapshot: { asOf: "2025-01-01T00:00:00.000Z" },
  phase3Output: { results },
});
const credit = (id: string, status = "verified", sourceId = "s1") => ({
  id, sourceId, recordType: "course", status, rawTitle: `Course ${id}`,
  rawCredits: "3.00",
});
const record = (over: Partial<ProjectionAcademicRecord> = {}): ProjectionAcademicRecord => ({
  activeProgramAssignment: { cohortLabel: null },
  programVersion: {
    version: { versionLabel: "v1" }, program: { name: "Prog", code: "P" },
    institution: { name: "Inst" },
  },
  academicSources: [{ id: "s1", sourceType: "transcript", status: "verified", title: "T" }],
  creditRecords: [], latestVerifications: {}, latestDecisions: {}, ...over,
});

describe("projectStudentDegreeProgress", () => {
  it("states: NO_ACTIVE_PROGRAM, UNDER_REVIEW, COMPOSED", () => {
    expect(noActiveProgramView.state).toBe("NO_ACTIVE_PROGRAM");
    expect(noActiveProgramView.program).toBeNull();
    expect(noActiveProgramView.totals).toBeNull();
    expect(noActiveProgramView.attention.map((a) => a.kind)).toEqual(["NO_ACTIVE_PROGRAM"]);
    expect(noActiveProgramView.nextSteps.map((n) => n.kind)).toEqual(["CONTACT_ADVISOR"]);

    expect(underReviewView.state).toBe("UNDER_REVIEW");
    expect(underReviewView.totals).toBeNull();
    expect(underReviewView.requirements).toEqual([]);
    expect(underReviewView.milestones).toEqual([]);
    expect(underReviewView.attention[0]).toMatchObject({ kind: "PROGRESS_UNDER_REVIEW", owner: "staff" });
    expect(underReviewView.nextSteps.map((n) => n.kind)).toContain("CONTACT_ADVISOR");

    expect(composedMidProgressView.state).toBe("COMPOSED");
    expect(composedMidProgressView.asOf).toBe("2025-10-01T12:00:00.000Z");
  });

  it("only treats status COMPOSED as composed", () => {
    const view = projectStudentDegreeProgress({
      report: { status: "MANUAL_REVIEW", phase3Output: { results: [res("r1", "SATISFIED", "3", "3", "0")] } },
      record: record(), requirementLabels: labels,
    });
    expect(view.state).toBe("UNDER_REVIEW");
    expect(view.requirements).toEqual([]);
    expect(view.totals).toBeNull();
  });

  it("computes exact decimal totals and orders requirements by sequence, code, id", () => {
    const view = projectStudentDegreeProgress({
      report: composed([
        res("r3", "PARTIAL", "3.50", "1.25", "2.25", ["c1"]),
        res("r2", "SATISFIED", "2.10", "2.10", "0", ["c2"]),
        res("r1", "MISSING", "0.20", "0", "0.20"),
      ]),
      record: record(), requirementLabels: labels,
    });
    expect(view.requirements.map((r) => r.requirementId)).toEqual(["r1", "r2", "r3"]);
    expect(view.totals).toEqual({
      unit: "credit", requiredCredits: "5.8", appliedCredits: "3.35",
      remainingCredits: "2.45", verifiedCreditsOnRecord: "0",
      requirementsSatisfied: 1, requirementsTotal: 3,
    });
    expect(view.requirements.find((r) => r.requirementId === "r3")).toMatchObject({
      unit: "credits", requiredAmount: "3.5", appliedAmount: "1.25", remainingAmount: "2.25",
    });
    // 0.1 + 0.2 style sums stay exact.
    const exact = projectStudentDegreeProgress({
      report: composed([res("r1", "PARTIAL", "0.10", "0.10", "0"), res("r2", "PARTIAL", "0.20", "0.20", "0")]),
      record: record(), requirementLabels: labels,
    });
    expect(exact.totals?.requiredCredits).toBe("0.3");
  });

  it("never reports a negative remaining total", () => {
    const view = projectStudentDegreeProgress({
      report: composed([res("r1", "SATISFIED", "3", "5", "0")]),
      record: record(), requirementLabels: labels,
    });
    expect(view.totals?.remainingCredits).toBe("0");
  });

  it("sets totals=null when any requirement has no engine amount", () => {
    expect(composedWithConflictView.state).toBe("COMPOSED");
    expect(composedWithConflictView.totals).toBeNull();
    const conflict = composedWithConflictView.requirements.find((r) => r.status === "CONFLICT")!;
    expect(conflict).toMatchObject({ requiredAmount: null, appliedAmount: null, remainingAmount: null });
    expect(composedWithConflictView.attention.some((a) => a.kind === "REQUIREMENT_REVIEW"
      && a.owner === "staff" && a.requirementId === conflict.requirementId)).toBe(true);
    const unattributed = projectStudentDegreeProgress({
      report: composed([res("r1", "SATISFIED", "3", "3", "0"), res(null, "MANUAL_REVIEW", null, null, null)]),
      record: record(), requirementLabels: labels,
    });
    expect(unattributed.totals).toBeNull();
    expect(unattributed.requirements).toHaveLength(1);
    expect(unattributed.attention.some((a) => a.kind === "REQUIREMENT_REVIEW")).toBe(true);
  });

  it("classifies each credit standing and excludes superseded records", () => {
    const view = projectStudentDegreeProgress({
      report: composed([res("r1", "PARTIAL", "9", "3", "6", ["va"])]),
      record: record({
        creditRecords: [
          credit("va"), credit("vn"), credit("rej-dec"), credit("rej-ver"),
          credit("nr-ver"), credit("nr-dec"), credit("nr-rec", "needs_review"),
          credit("pend", "extracted"), credit("sup", "superseded"),
          credit("ver-only"), credit("revoked"),
        ],
        latestVerifications: {
          va: { action: "verified" }, vn: { action: "verified" },
          "rej-dec": { action: "verified" }, "rej-ver": { action: "rejected" },
          "nr-ver": { action: "needs_review" }, "nr-dec": { action: "verified" },
          pend: { action: "submitted" }, "ver-only": { action: "verified" },
          revoked: { action: "verified" },
        },
        latestDecisions: {
          va: { action: "accepted", creditsAwarded: "3.00" },
          vn: { action: "accepted", creditsAwarded: "2.50" },
          "rej-dec": { action: "rejected" },
          "nr-dec": { action: "needs_review" },
          revoked: { action: "revoked" },
        },
      }),
      requirementLabels: labels,
    });
    const standing = Object.fromEntries(view.credits.map((c) => [c.creditRecordId, c.standing]));
    expect(standing).toEqual({
      va: "VERIFIED_APPLIED", vn: "VERIFIED_NOT_APPLIED", "rej-dec": "NOT_ACCEPTED",
      "rej-ver": "NOT_ACCEPTED", "nr-ver": "NEEDS_REVIEW", "nr-dec": "NEEDS_REVIEW",
      "nr-rec": "NEEDS_REVIEW", pend: "PENDING_VERIFICATION", "ver-only": "PENDING_VERIFICATION",
      revoked: "NOT_ACCEPTED",
    });
    expect(view.credits.find((c) => c.creditRecordId === "va")).toMatchObject({
      awardedCredits: "3", reportedCredits: "3", appliedToRequirementIds: ["r1"],
    });
    expect(view.credits.find((c) => c.creditRecordId === "pend")?.awardedCredits).toBeNull();
    expect(view.totals?.verifiedCreditsOnRecord).toBe("5.5");
    expect(view.sources[0].creditRecordCount).toBe(10);
    // Pending / needs review produce staff-owned attention.
    const kinds = view.attention.map((a) => a.kind);
    expect(kinds).toContain("CREDIT_PENDING_VERIFICATION");
    expect(kinds).toContain("CREDIT_NEEDS_REVIEW");
    expect(view.attention.every((a) => a.owner === "staff")).toBe(true);
  });

  it("lists non-superseded sources only, flagging received/extracted ones", () => {
    const view = projectStudentDegreeProgress({
      report: composed([res("r1", "SATISFIED", "3", "3", "0")]),
      record: record({
        academicSources: [
          { id: "a", sourceType: "transcript", status: "received", title: "A", receivedAt: new Date("2025-01-02T00:00:00Z") },
          { id: "b", sourceType: "transcript", status: "extracted", title: "B" },
          { id: "c", sourceType: "transcript", status: "verified", title: "C" },
          { id: "d", sourceType: "transcript", status: "rejected", title: "D" },
          { id: "e", sourceType: "transcript", status: "superseded", title: "E" },
        ],
      }),
      requirementLabels: labels,
    });
    expect(view.sources.map((s) => s.sourceId).sort()).toEqual(["a", "b", "c", "d"]);
    expect(view.sources.find((s) => s.sourceId === "a")?.receivedAt).toBe("2025-01-02T00:00:00.000Z");
    expect(view.attention.filter((a) => a.kind === "SOURCE_PENDING_REVIEW").map((a) => a.sourceId).sort())
      .toEqual(["a", "b"]);
  });

  it("derives milestones from exact thresholds", () => {
    const view = projectStudentDegreeProgress({
      report: composed([res("r1", "PARTIAL", "10.50", "5.25", "5.25")]),
      record: record(), requirementLabels: labels,
    });
    expect(view.milestones).toEqual([
      { id: "credits-25", label: "25% of required credits", thresholdCredits: "2.63", reached: true },
      { id: "credits-50", label: "50% of required credits", thresholdCredits: "5.25", reached: true },
      { id: "credits-75", label: "75% of required credits", thresholdCredits: "7.88", reached: false },
      { id: "credits-100", label: "100% of required credits", thresholdCredits: "10.5", reached: false },
      { id: "all-requirements", label: "All requirements satisfied", thresholdCredits: null, reached: false },
    ]);
    expect(composedCompleteView.milestones.every((m) => m.reached)).toBe(true);
    expect(underReviewView.milestones).toEqual([]);
  });

  it("orders next steps by fixed priority", () => {
    // No sources or credits at all -> upload first.
    const empty = projectStudentDegreeProgress({
      report: composed([res("r1", "MISSING", "3", "0", "3")]),
      record: record({ academicSources: [] }), requirementLabels: labels,
    });
    expect(empty.nextSteps.map((n) => n.kind)).toEqual(["UPLOAD_DOCUMENTS", "COMPLETE_REQUIREMENT"]);
    expect(empty.nextSteps[0].href).toBe("/documents");
    // Pending items -> await verification (no href).
    const kinds = composedMidProgressView.nextSteps.map((n) => n.kind);
    expect(kinds).toEqual(["AWAIT_VERIFICATION", "COMPLETE_REQUIREMENT", "COMPLETE_REQUIREMENT", "COMPLETE_REQUIREMENT"]);
    expect(composedMidProgressView.nextSteps[0].href).toBeNull();
    expect(composedMidProgressView.nextSteps[1].href).toBe("/roadmap");
    // At most three outstanding requirements.
    const many = projectStudentDegreeProgress({
      report: composed([
        res("r1", "MISSING", "3", "0", "3"), res("r2", "PARTIAL", "3", "1", "2"),
        res("r3", "MISSING", "3", "0", "3"), res("r4", "MISSING", "3", "0", "3"),
      ]),
      record: record(), requirementLabels: labels,
    });
    expect(many.nextSteps.filter((n) => n.kind === "COMPLETE_REQUIREMENT")).toHaveLength(3);
    expect(composedCompleteView.nextSteps.map((n) => n.kind)).toEqual(["DEGREE_REQUIREMENTS_MET"]);
    expect(underReviewView.nextSteps.map((n) => n.kind)).toEqual(["AWAIT_VERIFICATION", "CONTACT_ADVISOR"]);
  });

  it("is deterministic and does not mutate its input", () => {
    const before = JSON.stringify(composedMidProgressInput);
    const a = projectStudentDegreeProgress(composedMidProgressInput);
    const b = projectStudentDegreeProgress(composedMidProgressInput);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(composedMidProgressInput)).toBe(before);
  });

  it("leaks no diagnostics, fingerprints, provenance internals or canonical ids", () => {
    const dirty: ProjectionReport = {
      ...composed([res("r1", "PARTIAL", "3", "1", "2", ["c1"])]),
      ...({
        integrationDiagnostics: [{ code: "SECRET_DIAG" }],
        snapshot: { asOf: "2025-01-01T00:00:00.000Z", fingerprint: "sha256:abc" },
      } as object),
    };
    const json = JSON.stringify(projectStudentDegreeProgress({
      report: dirty, record: record({ creditRecords: [credit("c1")] }), requirementLabels: labels,
    }));
    for (const forbidden of [
      "fingerprint", "sha256", "SECRET_DIAG", "diagnostic", "provenance",
      "claimVersion", "academicRule", "decisionId", "verificationEvent", "sourceIds",
      "reviewer", "approvedBy", "rationale",
    ]) expect(json).not.toContain(forbidden);
    for (const view of [composedMidProgressView, composedWithConflictView, underReviewView, noActiveProgramView]) {
      const text = JSON.stringify(view);
      for (const forbidden of ["fingerprint", "diagnostic", "provenance", "claimVersion", "academicRule"]) {
        expect(text).not.toContain(forbidden);
      }
    }
  });
});

describe("totals never let surplus on one requirement hide another's shortfall", () => {
  it("caps each requirement's applied credits at its required amount", async () => {
    const { projectStudentDegreeProgress } = await import("../shared/student-degree-progress-projection");
    const { composedMidProgressInput } = await import("./fixtures/student-degree-progress-fixtures");
    const base = composedMidProgressInput.report as any;
    const results = [
      { ...base.phase3Output.results[0], requirementId: base.phase3Output.results[0].requirementId,
        status: "SATISFIED", requiredAmount: "6", appliedAmount: "12", remainingAmount: "0" },
      { ...base.phase3Output.results[1], requirementId: base.phase3Output.results[1].requirementId,
        status: "MISSING", requiredAmount: "6", appliedAmount: "0", remainingAmount: "6" },
    ];
    const view = projectStudentDegreeProgress({
      ...composedMidProgressInput,
      report: { ...base, phase3Output: { ...base.phase3Output, results } },
    } as any);
    expect(view.totals).not.toBeNull();
    expect(view.totals!.requiredCredits).toBe("12");
    expect(view.totals!.appliedCredits).toBe("6");
    expect(view.totals!.remainingCredits).toBe("6");
    // Per-requirement amounts are still shown exactly as the engine produced them.
    expect(view.requirements.map((r) => r.appliedAmount)).toEqual(expect.arrayContaining(["12", "0"]));
  });
});
