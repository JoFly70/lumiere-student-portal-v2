import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@shared/recorded-credit-projection", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@shared/recorded-credit-projection")
  >();
  return {
    ...actual,
    projectRecordedStudentCreditFacts: vi.fn(
      actual.projectRecordedStudentCreditFacts,
    ),
  };
});

vi.mock("@shared/recorded-academic-exception-projection", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@shared/recorded-academic-exception-projection")
  >();
  return {
    ...actual,
    projectRecordedAcademicExceptions: vi.fn(
      actual.projectRecordedAcademicExceptions,
    ),
  };
});

import {
  composeDegreeProgress,
  type DegreeProgressCompositionInput,
} from "@shared/degree-progress-composition";
import * as degreeProgressComposition from "@shared/degree-progress-composition";
import {
  projectRecordedAcademicExceptions,
} from "@shared/recorded-academic-exception-projection";
import {
  projectRecordedStudentCreditFacts,
} from "@shared/recorded-credit-projection";
const publicCompositionModule =
  degreeProgressComposition as unknown as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
});

const requirement = (
  id = "req-1",
  requiredAmount = "3",
  academicRuleId: string | null = "rule-1",
) => ({
  requirementId: id,
  academicRuleId,
  kind: "minimum",
  unit: "credits",
  requiredAmount,
  programVersionId: "program-version-1",
  sourceIds: [`requirement-source-${id}`],
  claimVersionIds: [`requirement-claim-${id}`],
});

const validInput = (): DegreeProgressCompositionInput => ({
  context: {
    studentId: "student-1",
    programAssignmentId: "assignment-1",
    programVersionId: "program-version-1",
  },
  programAssignmentRegistry: [{
    id: "assignment-1",
    studentId: "student-1",
    programVersionId: "program-version-1",
    status: "active",
  }],
  requirements: [requirement()],
  academicRules: [{
    id: "rule-1",
    programVersionId: "program-version-1",
  }],
  unresolvedConflicts: [],
  creditRecords: [{
    id: "record-1",
    studentId: "student-1",
    sourceId: "source-1",
    status: "verified",
  }],
  verificationEvents: [{
    id: "verification-1",
    creditRecordId: "record-1",
    seq: 1,
    action: "verified",
  }],
  decisions: [{
    id: "decision-1",
    creditRecordId: "record-1",
    programAssignmentId: "assignment-1",
    seq: 1,
    action: "accepted",
    creditsAwarded: "3",
    basisClaimVersionId: "basis-1",
    equivalencyId: "equivalency-1",
    targetInstitutionCourseVersionId: "target-1",
  }],
  associations: [{
    decisionId: "decision-1",
    requirementId: "req-1",
    academicRuleId: "rule-1",
  }],
  exceptions: [],
  placements: [],
});

describe("composeDegreeProgress", () => {
  it("exposes one exact composer entry point and derives exception targets", () => {
    expect(publicCompositionModule.composeDegreeProgressReport).toBeUndefined();
    expect(publicCompositionModule.composeDegreeProgressComposition).toBeUndefined();
    expect(publicCompositionModule.composeDegreeProgressAudit).toBeUndefined();

    const base = validInput();
    const input = {
      ...base,
      exceptions: [{
        id: "exception-target",
        studentId: "student-1",
        programAssignmentId: "assignment-1",
        exceptionType: "other" as const,
        status: "active" as const,
        requirementId: null,
        academicRuleId: null,
        creditRecordId: "record-1",
        supersedesExceptionId: null,
        approvedBy: null,
        rationale: "synthetic observation",
        effectiveFrom: null,
        effectiveTo: null,
        metadata: {},
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      }],
      placements: [{
        exceptionId: "exception-target",
        requirementId: null,
        academicRuleId: null,
        creditRecordId: "record-1",
        evidenceId: null,
      }],
    };
    const output = composeDegreeProgress(input);

    expect(output.compositionKind).toBe("COMPOSED");
    if (output.compositionKind === "COMPOSED") {
      expect(output.observations).toHaveLength(1);
    }
  });

  it.each([
    ["extra unrelated row", [{
      id: "assignment-extra",
      studentId: "student-1",
      programVersionId: "program-version-1",
      status: "active",
    }]],
    ["blank student", [{
      id: "assignment-1",
      studentId: " ",
      programVersionId: "program-version-1",
      status: "active",
    }]],
    ["blank program version", [{
      id: "assignment-1",
      studentId: "student-1",
      programVersionId: " ",
      status: "active",
    }]],
    ["inactive assignment", [{
      id: "assignment-1",
      studentId: "student-1",
      programVersionId: "program-version-1",
      status: "completed",
    }]],
  ] as const)("rejects %s in the exact assignment registry", (_label, rows) => {
    const output = composeDegreeProgress({
      ...validInput(),
      programAssignmentRegistry: rows,
    });

    expect(output.compositionKind).toBe("INFORMATIONAL_ONLY");
  });

  it("requires exactly one matching assignment registry row", () => {
    const base = validInput();
    const output = composeDegreeProgress({
      ...base,
      programAssignmentRegistry: [
        base.programAssignmentRegistry![0],
        { ...base.programAssignmentRegistry![0] },
      ],
    });

    expect(output.compositionKind).toBe("INFORMATIONAL_ONLY");
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        reason: "AMBIGUOUS_PROGRAM_ASSIGNMENT_IDENTITY",
      }),
    ]);
  });

  it.each([
    ["unreferenced", [{
      id: "rule-unused",
      programVersionId: "program-version-1",
    }]],
    ["blank", [{
      id: " ",
      programVersionId: "program-version-1",
    }]],
    ["null scope", [{
      id: "rule-1",
      programVersionId: null,
    }]],
    ["wrong scope", [{
      id: "rule-1",
      programVersionId: "program-version-other",
    }]],
  ] as const)("rejects %s supplied rule occurrence", (_label, rules) => {
    const output = composeDegreeProgress({
      ...validInput(),
      academicRules: _label === "unreferenced"
        ? rules
        : rules,
    });

    expect(output.compositionKind).toBe("INFORMATIONAL_ONLY");
  });

  it("preflights an exception-only referenced rule", () => {
    const base = validInput();
    const output = composeDegreeProgress({
      ...base,
      requirements: [requirement("req-1", "3", null)],
      academicRules: [{ id: "rule-exception-only", programVersionId: null }],
      exceptions: [{
        id: "exception-rule",
        studentId: "student-1",
        programAssignmentId: "assignment-1",
        exceptionType: "other",
        status: "active",
        requirementId: null,
        academicRuleId: "rule-exception-only",
        creditRecordId: null,
        supersedesExceptionId: null,
        approvedBy: null,
        rationale: "synthetic observation",
        effectiveFrom: null,
        effectiveTo: null,
        metadata: {},
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      }],
      placements: [{
        exceptionId: "exception-rule",
        requirementId: null,
        academicRuleId: "rule-exception-only",
        creditRecordId: null,
        evidenceId: null,
      }],
    });

    expect(output.compositionKind).toBe("INFORMATIONAL_ONLY");
  });

  it("composes the exact final Chunk 5 evidence and results", () => {
    const input = validInput();
    const before = structuredClone(input);
    const output = composeDegreeProgress(input);

    expect(output.compositionKind).toBe("COMPOSED");
    if (output.compositionKind !== "COMPOSED") return;
    expect(output.context).toEqual(input.context);
    expect(output.evidence[0]).toMatchObject({
      evidenceId: "decision-1",
      exceptionIds: [],
    });
    expect(output.results[0]).toMatchObject({
      requirementId: "req-1",
      status: "SATISFIED",
    });
    expect(output.recordedCreditProjection).toEqual(
      output.recordedExceptionProjection.results.length > 0
        ? expect.objectContaining({
          results: output.results,
        })
        : output.recordedCreditProjection,
    );
    expect(input).toEqual(before);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.context)).toBe(true);
    expect(Object.isFrozen(output.evidence)).toBe(true);
    expect(Object.isFrozen(output.diagnostics)).toBe(true);
  });

  it.each([
    ["SATISFIED", "3", "SATISFIED"],
    ["PARTIAL", "1", "PARTIAL"],
    ["MISSING", null, "MISSING"],
  ] as const)("preserves %s quantitative result", (_label, credits, status) => {
    const base = validInput();
    const input: DegreeProgressCompositionInput = {
      ...base,
      decisions: credits === null
        ? []
        : [{ ...base.decisions[0], creditsAwarded: credits }],
      creditRecords: credits === null ? [] : base.creditRecords,
      verificationEvents: credits === null ? [] : base.verificationEvents,
      associations: credits === null ? [] : base.associations,
    };
    const output = composeDegreeProgress(input);

    expect(output.compositionKind).toBe("COMPOSED");
    if (output.compositionKind === "COMPOSED") {
      expect(output.results[0].status).toBe(status);
    }
  });

  it("rejects coordinated assignment and program-version mismatches before stages", () => {
    const base = validInput();
    const input: DegreeProgressCompositionInput = {
      ...base,
      context: {
        ...base.context,
      studentId: "student-other",
      programVersionId: "program-version-other",
      },
      requirements: [requirement("req-1", "3", "rule-1")],
    };
    const output = composeDegreeProgress(input);

    expect(output).toMatchObject({
      compositionKind: "INFORMATIONAL_ONLY",
      status: "MANUAL_REVIEW",
    });
    expect(output.diagnostics.map((item) => item.reason)).toEqual([
      "PROGRAM_ASSIGNMENT_PROGRAM_VERSION_MISMATCH",
      "PROGRAM_ASSIGNMENT_STUDENT_MISMATCH",
      "REFERENCED_RULE_PROGRAM_VERSION_MISMATCH",
      "REQUIREMENT_PROGRAM_VERSION_MISMATCH",
    ]);
  });

  it.each([
    ["missing", []],
    ["duplicate", [
      {
        id: "assignment-1",
        studentId: "student-1",
        programVersionId: "program-version-1",
        status: "active",
      },
    ]],
  ] as const)("rejects %s assignment binding", (_label, extra) => {
    const base = validInput();
    const input: DegreeProgressCompositionInput = {
      ...base,
      programAssignmentRegistry: extra.length === 0
        ? extra
        : [...base.programAssignmentRegistry!, ...extra],
    };
    const output = composeDegreeProgress(input);

    expect(output.compositionKind).toBe("INFORMATIONAL_ONLY");
    expect(output.diagnostics.some((item) => (
      item.reason.includes("PROGRAM_ASSIGNMENT")
    ))).toBe(true);
  });

  it("rejects null-scoped referenced rules instead of treating them as global", () => {
    const input: DegreeProgressCompositionInput = {
      ...validInput(),
      academicRules: [{ id: "rule-1", programVersionId: null }],
    };
    const output = composeDegreeProgress(input);

    expect(output.compositionKind).toBe("INFORMATIONAL_ONLY");
    expect(output.diagnostics).toEqual([
      expect.objectContaining({ reason: "NULL_SCOPED_REFERENCED_RULE" }),
    ]);
  });

  it("keeps exception observations informational and changes only evidence association", () => {
    const base = validInput();
    const input: DegreeProgressCompositionInput = {
      ...base,
      exceptions: [{
      id: "exception-1",
      studentId: "student-1",
      programAssignmentId: "assignment-1",
      exceptionType: "credit_override",
       status: "active",
      requirementId: "req-1",
      academicRuleId: "rule-1",
      creditRecordId: "record-1",
      supersedesExceptionId: null,
      approvedBy: "approver-1",
      rationale: "synthetic observation",
      effectiveFrom: null,
      effectiveTo: null,
      metadata: { opaque: true },
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      }],
      placements: [{
      exceptionId: "exception-1",
      requirementId: "req-1",
      academicRuleId: "rule-1",
      creditRecordId: "record-1",
      evidenceId: "decision-1",
      }],
    };
    const output = composeDegreeProgress(input);

    expect(output.compositionKind).toBe("COMPOSED");
    if (output.compositionKind !== "COMPOSED") return;
    expect(output.observations[0].status).toBe("MANUAL_REVIEW");
    expect(output.results).toEqual(
      output.recordedCreditProjection.results,
    );
    expect(output.evidence[0].exceptionIds).toEqual(["exception-1"]);
    expect(output.results[0].provenance.exceptionIds).toEqual([]);
  });

  it.each([
    "requirement_waiver",
    "course_substitution",
    "credit_override",
    "level_override",
    "residency_override",
    "other",
  ] as const)("keeps %s informational only", (exceptionType) => {
    const base = validInput();
    const target = exceptionType === "other"
      ? {
        requirementId: null,
        academicRuleId: null,
        creditRecordId: null,
      }
      : {
        requirementId: "req-1",
        academicRuleId: "rule-1",
        creditRecordId: null,
      };
    const input: DegreeProgressCompositionInput = {
      ...base,
      exceptions: [{
        id: `exception-${exceptionType}`,
        studentId: "student-1",
        programAssignmentId: "assignment-1",
        exceptionType,
        status: "active",
        ...target,
        supersedesExceptionId: null,
        approvedBy: "approver-1",
        rationale: "synthetic observation",
        effectiveFrom: null,
        effectiveTo: null,
        metadata: {},
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      }],
      placements: [{
        exceptionId: `exception-${exceptionType}`,
        ...target,
        evidenceId: null,
      }],
    };
    const output = composeDegreeProgress(input);

    expect(output.compositionKind).toBe("COMPOSED");
    if (output.compositionKind === "COMPOSED") {
      expect(output.results[0].status).toBe("SATISFIED");
      expect(output.observations[0]).toMatchObject({
        exceptionType,
        status: "MANUAL_REVIEW",
      });
    }
  });

  it("retains conflict precedence without applying exception effects", () => {
    const input: DegreeProgressCompositionInput = {
      ...validInput(),
      unresolvedConflicts: [{
        conflictId: "conflict-1",
        requirementId: "req-1",
        academicRuleId: "rule-1",
        status: "open",
        sourceIds: ["conflict-source-1"],
        claimVersionIds: ["conflict-claim-1"],
      }],
    };
    const output = composeDegreeProgress(input);

    expect(output.compositionKind).toBe("COMPOSED");
    if (output.compositionKind === "COMPOSED") {
      expect(output.results[0]).toMatchObject({
        status: "CONFLICT",
        reason: "UNRESOLVED_CANONICAL_CONFLICT",
      });
    }
  });

  it.each([
    ["duplicate", "AMBIGUOUS_RECORDED_EXCEPTION_IDENTITY"],
    ["shared target", "AMBIGUOUS_RECORDED_EXCEPTION_TARGET"],
    ["reused evidence", "AMBIGUOUS_RECORDED_EXCEPTION_EVIDENCE_ASSOCIATION"],
  ] as const)("keeps %s exception cohorts from changing results", (
    label,
    reason,
  ) => {
    const base = validInput();
    const exception = (id: string) => ({
      id,
      studentId: "student-1",
      programAssignmentId: "assignment-1",
      exceptionType: "requirement_waiver" as const,
      status: "active" as const,
      requirementId: "req-1",
      academicRuleId: "rule-1",
      creditRecordId: label === "reused evidence" ? "record-1" : null,
      supersedesExceptionId: null,
      approvedBy: "approver-1",
      rationale: "synthetic observation",
      effectiveFrom: null,
      effectiveTo: null,
      metadata: {},
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    const ids = label === "duplicate" ? ["exception-a", "exception-a"]
      : ["exception-a", "exception-b"];
    const exceptions = ids.map(exception);
    const placements = exceptions.map((item) => ({
      exceptionId: item.id,
      requirementId: "req-1",
      academicRuleId: "rule-1",
      creditRecordId: label === "reused evidence" ? "record-1" : null,
      evidenceId: label === "reused evidence" ? "decision-1" : null,
    }));
    const output = composeDegreeProgress({
      ...base,
      exceptions,
      placements,
    });

    expect(output.compositionKind).toBe("COMPOSED");
    if (output.compositionKind === "COMPOSED") {
      expect(output.results).toEqual(
        output.recordedCreditProjection.results,
      );
      expect(output.diagnostics).toContainEqual(
        expect.objectContaining({ stage: "RECORDED_EXCEPTION", reason }),
      );
    }
  });

  it.each([
    ["self", [
      ["exception-1", "exception-1"],
    ], "INVALID_RECORDED_EXCEPTION_SUPERSESSION"],
    ["cycle", [
      ["exception-a", "exception-b"],
      ["exception-b", "exception-a"],
    ], "INVALID_RECORDED_EXCEPTION_SUPERSESSION"],
    ["missing parent", [
      ["exception-1", "exception-missing"],
    ], "MISSING_RECORDED_EXCEPTION_SUPERSESSION"],
    ["multiple children", [
      ["exception-parent", null],
      ["exception-a", "exception-parent"],
      ["exception-b", "exception-parent"],
    ], "AMBIGUOUS_RECORDED_EXCEPTION_SUPERSESSION"],
    ["valid chain", [
      ["exception-old", null],
      ["exception-new", "exception-old"],
    ], "RECORDED_EXCEPTION_SUPERSESSION_REQUIRES_REVIEW"],
  ] as const)("keeps %s supersession review-only", (
    _label,
    links,
    reason,
  ) => {
    const base = validInput();
    const exceptions = links.map(([id, supersedesExceptionId], index) => ({
      id,
      studentId: "student-1",
      programAssignmentId: "assignment-1",
      exceptionType: "other" as const,
      status: index === 0 && id === "exception-old"
        ? "superseded" as const
        : "active" as const,
      requirementId: null,
      academicRuleId: null,
      creditRecordId: null,
      supersedesExceptionId,
      approvedBy: null,
      rationale: "synthetic observation",
      effectiveFrom: null,
      effectiveTo: null,
      metadata: {},
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    }));
    const output = composeDegreeProgress({
      ...base,
      exceptions,
      placements: exceptions.map((item) => ({
        exceptionId: item.id,
        requirementId: null,
        academicRuleId: null,
        creditRecordId: null,
        evidenceId: null,
      })),
    });

    expect(output.compositionKind).toBe("COMPOSED");
    if (output.compositionKind === "COMPOSED") {
      expect(output.results).toEqual(
        output.recordedCreditProjection.results,
      );
      expect(output.diagnostics).toContainEqual(
        expect.objectContaining({
          stage: "RECORDED_EXCEPTION",
          reason,
        }),
      );
    }
  });

  it("retains all three stage diagnostic streams without rewriting them", () => {
    const base = validInput();
    const input: DegreeProgressCompositionInput = {
      ...base,
      requirements: [requirement("req-1", "not-a-number")],
      decisions: [{
        ...base.decisions[0],
        basisClaimVersionId: "",
      }],
      exceptions: [{
        id: "exception-revoked",
        studentId: "student-1",
        programAssignmentId: "assignment-1",
        exceptionType: "other",
        status: "revoked",
        requirementId: null,
        academicRuleId: null,
        creditRecordId: null,
        supersedesExceptionId: null,
        approvedBy: null,
        rationale: "synthetic observation",
        effectiveFrom: null,
        effectiveTo: null,
        metadata: {},
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      }],
      placements: [{
        exceptionId: "exception-revoked",
        requirementId: null,
        academicRuleId: null,
        creditRecordId: null,
        evidenceId: null,
      }],
    };
    const output = composeDegreeProgress(input);

    expect(output.compositionKind).toBe("COMPOSED");
    if (output.compositionKind === "COMPOSED") {
      expect(output.diagnostics.map((item) => item.stage)).toEqual([
        "RECORDED_CREDIT",
        "CANONICAL_NORMALIZATION",
        "RECORDED_EXCEPTION",
      ]);
      expect(output.diagnostics.map((item) => item.reason)).toEqual([
        "INVALID_RECORDED_CREDIT_PROVENANCE",
        "INCOMPLETE_CANONICAL_REQUIREMENT_QUANTITY",
        "RECORDED_EXCEPTION_REVOKED",
      ]);
    }
  });

  it("matches independently invoked Chunk 4 and Chunk 5 outputs exactly", () => {
    const input = validInput();
    const requirements = input.requirements.map((item) => ({
      requirementId: item.requirementId,
      academicRuleId: item.academicRuleId,
      kind: item.kind,
      unit: item.unit,
      requiredAmount: item.requiredAmount,
      sourceIds: item.sourceIds,
      claimVersionIds: item.claimVersionIds,
    }));
    const credit = projectRecordedStudentCreditFacts({
      context: {
        studentId: input.context.studentId,
        programAssignmentId: input.context.programAssignmentId,
      },
      requirements,
      unresolvedConflicts: input.unresolvedConflicts,
      creditRecords: input.creditRecords,
      verificationEvents: input.verificationEvents,
      decisions: input.decisions,
      associations: input.associations,
    });
    const exceptions = projectRecordedAcademicExceptions({
      context: {
        studentId: input.context.studentId,
        programAssignmentId: input.context.programAssignmentId,
      },
      exceptions: input.exceptions,
      placements: input.placements,
      requirements,
      academicRules: input.academicRules.map((item) => ({ id: item.id })),
      creditRecords: input.creditRecords,
      unresolvedConflicts: input.unresolvedConflicts,
      recordedCreditProjection: credit,
    });
    const output = composeDegreeProgress(input);

    expect(output.compositionKind).toBe("COMPOSED");
    if (output.compositionKind === "COMPOSED") {
      expect(output.recordedCreditProjection).toEqual(credit);
      expect(output.recordedExceptionProjection).toEqual(exceptions);
      expect(output.evidence).toEqual(exceptions.evidence);
      expect(output.normalization).toEqual(exceptions.normalization);
      expect(output.results).toEqual(exceptions.results);
      expect(output.observations).toEqual(exceptions.observations);
    }
  });

  it("retains complete structural provenance for composition rejection", () => {
    const base = validInput();
    const input: DegreeProgressCompositionInput = {
      ...base,
      context: {
        ...base.context,
        studentId: " ",
      },
      programAssignmentRegistry: [{
        ...base.programAssignmentRegistry[0],
        studentId: "student-2",
      }],
      unresolvedConflicts: [{
        conflictId: "conflict-1",
        requirementId: "req-1",
        academicRuleId: "rule-1",
        status: "open",
        sourceIds: ["conflict-source"],
        claimVersionIds: ["conflict-claim"],
      }],
      exceptions: [{
        id: "exception-1",
        studentId: "student-2",
        programAssignmentId: "assignment-1",
        exceptionType: "other",
        status: "active",
        requirementId: null,
        academicRuleId: "rule-1",
        creditRecordId: "record-1",
        supersedesExceptionId: "exception-old",
        approvedBy: null,
        rationale: "synthetic observation",
        effectiveFrom: null,
        effectiveTo: null,
        metadata: {},
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      }],
      placements: [{
        exceptionId: "exception-1",
        requirementId: null,
        academicRuleId: "rule-1",
        creditRecordId: "record-1",
        evidenceId: "decision-1",
      }],
    };
    const output = composeDegreeProgress(input);
    const provenance = output.diagnostics[0].provenance as Record<string, string[]>;

    expect(provenance.studentIds).toEqual(["student-1", "student-2"]);
    expect(provenance.programAssignmentIds).toEqual(["assignment-1"]);
    expect(provenance.requirementIds).toEqual(["req-1"]);
    expect(provenance.academicRuleIds).toEqual(["rule-1"]);
    expect(provenance.studentCreditRecordIds).toEqual(["record-1"]);
    expect(provenance.verificationEventIds).toEqual(["verification-1"]);
    expect(provenance.decisionIds).toEqual(["decision-1"]);
    expect(provenance.conflictIds).toEqual(["conflict-1"]);
    expect(provenance.exceptionIds).toEqual(["exception-1"]);
    expect(provenance.supersededExceptionIds).toEqual(["exception-old"]);
    expect(provenance.evidenceIds).toEqual(["decision-1"]);
    expect(provenance.sourceIds).toEqual([
      "conflict-source",
      "requirement-source-req-1",
      "source-1",
    ]);
    expect(provenance.claimVersionIds).toEqual([
      "basis-1",
      "conflict-claim",
      "requirement-claim-req-1",
    ]);
    expect(provenance.equivalencyIds).toEqual(["equivalency-1"]);
    expect(provenance.targetInstitutionCourseVersionIds).toEqual(["target-1"]);
  });

  it("is deeply immutable and safe for prototype-sensitive exception metadata", () => {
    const metadata = JSON.parse(
      '{"__proto__":{"polluted":true},"nested":{"value":"opaque"}}',
    );
    const input: DegreeProgressCompositionInput = {
      ...validInput(),
      exceptions: [{
        id: "exception-meta",
        studentId: "student-1",
        programAssignmentId: "assignment-1",
        exceptionType: "other",
        status: "active",
        requirementId: null,
        academicRuleId: null,
        creditRecordId: null,
        supersedesExceptionId: null,
        approvedBy: null,
        rationale: "synthetic observation",
        effectiveFrom: null,
        effectiveTo: null,
        metadata,
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      }],
      placements: [{
        exceptionId: "exception-meta",
        requirementId: null,
        academicRuleId: null,
        creditRecordId: null,
        evidenceId: null,
      }],
    };
    const before = structuredClone(input);
    const output = composeDegreeProgress(input);

    const visit = (value: unknown, seen = new Set<object>()): void => {
      if (value === null || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      expect(Object.isFrozen(value)).toBe(true);
      for (const child of Object.values(value)) visit(child, seen);
    };
    expect(output.compositionKind).toBe("COMPOSED");
    if (output.compositionKind === "COMPOSED") {
      const projected = output.observations[0].metadata as Record<string, unknown>;
      expect(Object.hasOwn(projected, "__proto__")).toBe(true);
      expect(Object.isFrozen(projected["__proto__"])).toBe(true);
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
      visit(output);
    }
    expect(input).toEqual(before);
  });

  it("is equal for equivalent shuffles of every supplied input array", () => {
    const input = validInput();
    const shuffled: DegreeProgressCompositionInput = {
      ...input,
      programAssignmentRegistry: [...input.programAssignmentRegistry].reverse(),
      requirements: [...input.requirements].reverse(),
      academicRules: [...input.academicRules].reverse(),
      unresolvedConflicts: [...input.unresolvedConflicts].reverse(),
      creditRecords: [...input.creditRecords].reverse(),
      verificationEvents: [...input.verificationEvents].reverse(),
      decisions: [...input.decisions].reverse(),
      associations: [...input.associations].reverse(),
      exceptions: [...input.exceptions].reverse(),
      placements: [...input.placements].reverse(),
    };

    expect(composeDegreeProgress(input)).toEqual(
      composeDegreeProgress(shuffled),
    );
  });

  it("retains duplicate structural occurrences and approved-by provenance", () => {
    const base = validInput();
    const duplicateException = {
      id: "exception-duplicate",
      studentId: "student-1",
      programAssignmentId: "assignment-1",
      exceptionType: "other" as const,
      status: "active" as const,
      requirementId: null,
      academicRuleId: null,
      creditRecordId: null,
      supersedesExceptionId: null,
      approvedBy: "approver-duplicate",
      rationale: "synthetic observation",
      effectiveFrom: null,
      effectiveTo: null,
      metadata: {},
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    };
    const input: DegreeProgressCompositionInput = {
      ...base,
      programAssignmentRegistry: [
        ...base.programAssignmentRegistry,
        { ...base.programAssignmentRegistry[0] },
      ],
      exceptions: [duplicateException, { ...duplicateException }],
      placements: [
        {
          exceptionId: "exception-duplicate",
          requirementId: null,
          academicRuleId: null,
          creditRecordId: null,
          evidenceId: null,
        },
        {
          exceptionId: "exception-duplicate",
          requirementId: null,
          academicRuleId: null,
          creditRecordId: null,
          evidenceId: null,
        },
      ],
    };
    const output = composeDegreeProgress(input);
    const provenance = output.diagnostics[0].provenance as {
      readonly approvedByIds: readonly string[];
      readonly occurrences: readonly Record<string, unknown>[];
    };

    expect(output.compositionKind).toBe("INFORMATIONAL_ONLY");
    expect(provenance.approvedByIds).toEqual([
      "approver-duplicate",
    ]);
    expect(provenance.occurrences.filter((item) => (
      item.kind === "programAssignment"
    ))).toHaveLength(2);
    expect(provenance.occurrences.filter((item) => (
      item.kind === "exception"
    ))).toHaveLength(2);
    expect(provenance.occurrences.filter((item) => (
      item.kind === "placement"
    ))).toHaveLength(2);
    expect(Object.isFrozen(provenance.occurrences)).toBe(true);
    expect(provenance.occurrences.every((item) => Object.isFrozen(item))).toBe(true);
  });

  it("is equal for a genuine multi-row accepted shuffle", () => {
    const base = validInput();
    const input: DegreeProgressCompositionInput = {
      ...base,
      requirements: [
        requirement("req-1", "3", "rule-1"),
        requirement("req-2", "4", "rule-2"),
      ],
      academicRules: [
        { id: "rule-1", programVersionId: "program-version-1" },
        { id: "rule-2", programVersionId: "program-version-1" },
      ],
      creditRecords: [
        base.creditRecords[0],
        {
          id: "record-2",
          studentId: "student-1",
          sourceId: "source-2",
          status: "verified",
        },
      ],
      verificationEvents: [
        base.verificationEvents[0],
        {
          id: "verification-2",
          creditRecordId: "record-2",
          seq: 1,
          action: "verified",
        },
      ],
      decisions: [
        base.decisions[0],
        {
          ...base.decisions[0],
          id: "decision-2",
          creditRecordId: "record-2",
          creditsAwarded: "4",
          basisClaimVersionId: "basis-2",
          equivalencyId: "equivalency-2",
          targetInstitutionCourseVersionId: "target-2",
        },
      ],
      associations: [
        base.associations[0],
        {
          decisionId: "decision-2",
          requirementId: "req-2",
          academicRuleId: "rule-2",
        },
      ],
      exceptions: [
        {
          id: "exception-1",
          studentId: "student-1",
          programAssignmentId: "assignment-1",
          exceptionType: "requirement_waiver",
          status: "active",
          requirementId: "req-1",
          academicRuleId: "rule-1",
          creditRecordId: null,
          supersedesExceptionId: null,
          approvedBy: "approver-1",
          rationale: "synthetic observation",
          effectiveFrom: null,
          effectiveTo: null,
          metadata: {},
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
        },
        {
          id: "exception-2",
          studentId: "student-1",
          programAssignmentId: "assignment-1",
          exceptionType: "course_substitution",
          status: "active",
          requirementId: "req-2",
          academicRuleId: "rule-2",
          creditRecordId: null,
          supersedesExceptionId: null,
          approvedBy: "approver-2",
          rationale: "synthetic observation",
          effectiveFrom: null,
          effectiveTo: null,
          metadata: {},
          createdAt: new Date("2025-01-02T00:00:00.000Z"),
        },
      ],
      placements: [
        {
          exceptionId: "exception-1",
          requirementId: "req-1",
          academicRuleId: "rule-1",
          creditRecordId: null,
          evidenceId: null,
        },
        {
          exceptionId: "exception-2",
          requirementId: "req-2",
          academicRuleId: "rule-2",
          creditRecordId: null,
          evidenceId: null,
        },
      ],
    };
    const reversed: DegreeProgressCompositionInput = {
      ...input,
      requirements: [...input.requirements].reverse(),
      academicRules: [...input.academicRules].reverse(),
      creditRecords: [...input.creditRecords].reverse(),
      verificationEvents: [...input.verificationEvents].reverse(),
      decisions: [...input.decisions].reverse(),
      associations: [...input.associations].reverse(),
      exceptions: [...input.exceptions].reverse(),
      placements: [...input.placements].reverse(),
    };

    const first = composeDegreeProgress(input);
    const second = composeDegreeProgress(reversed);
    expect(first).toEqual(second);
    expect(first.compositionKind).toBe("COMPOSED");
    if (first.compositionKind === "COMPOSED") {
      expect(first.results.map((item) => item.status)).toEqual([
        "SATISFIED",
        "SATISFIED",
      ]);
      expect(first.observations).toHaveLength(2);
    }
  });

  it("is equal for a genuine multi-row rejected shuffle and retains all rows", () => {
    const base = validInput();
    const input: DegreeProgressCompositionInput = {
      ...base,
      programAssignmentRegistry: [
        ...base.programAssignmentRegistry,
        {
          id: "assignment-extra",
          studentId: "student-1",
          programVersionId: "program-version-1",
          status: "active",
        },
      ],
      requirements: [
        requirement("req-1", "3", "rule-1"),
        requirement("req-2", "4", "rule-2"),
      ],
      academicRules: [
        { id: "rule-1", programVersionId: "program-version-1" },
        { id: "rule-2", programVersionId: "program-version-1" },
      ],
    };
    const reversed: DegreeProgressCompositionInput = {
      ...input,
      programAssignmentRegistry: [...input.programAssignmentRegistry].reverse(),
      requirements: [...input.requirements].reverse(),
      academicRules: [...input.academicRules].reverse(),
      creditRecords: [...input.creditRecords].reverse(),
      verificationEvents: [...input.verificationEvents].reverse(),
      decisions: [...input.decisions].reverse(),
      associations: [...input.associations].reverse(),
      unresolvedConflicts: [...input.unresolvedConflicts].reverse(),
      exceptions: [...input.exceptions].reverse(),
      placements: [...input.placements].reverse(),
    };
    const first = composeDegreeProgress(input);
    const second = composeDegreeProgress(reversed);
    const provenance = first.diagnostics[0].provenance as {
      readonly occurrences: readonly Record<string, unknown>[];
    };

    expect(first).toEqual(second);
    expect(first.compositionKind).toBe("INFORMATIONAL_ONLY");
    expect(provenance.occurrences.filter((item) => (
      item.kind === "requirement"
    ))).toHaveLength(2);
    expect(provenance.occurrences.filter((item) => (
      item.kind === "academicRule"
    ))).toHaveLength(2);
    expect(provenance.occurrences.filter((item) => (
      item.kind === "programAssignment"
    ))).toHaveLength(2);
  });

  it.each([
    ["missing", []],
    ["duplicate", [
      { id: "rule-1", programVersionId: "program-version-1" },
    ]],
    ["mismatched", [
      { id: "rule-1", programVersionId: "program-version-other" },
    ]],
  ] as const)("rejects %s referenced rule", (_label, rules) => {
    const base = validInput();
    const academicRules = _label === "missing"
      ? []
      : _label === "duplicate"
        ? [...base.academicRules!, ...rules]
        : rules;
    const output = composeDegreeProgress({
      ...base,
      academicRules,
    });

    expect(output.compositionKind).toBe("INFORMATIONAL_ONLY");
    expect(output.diagnostics.some((item) => (
      item.reason.includes("REFERENCED_RULE")
      || item.reason.includes("REFERENCED")
    ))).toBe(true);
  });

  it("orders diagnostics by fixed stage, reason, and provenance", () => {
    const base = validInput();
    const input: DegreeProgressCompositionInput = {
      ...base,
      creditRecords: base.creditRecords,
      verificationEvents: [],
      decisions: [],
      associations: [],
      exceptions: [{
      id: "exception-1",
      studentId: "student-1",
      programAssignmentId: "assignment-1",
      exceptionType: "other",
       status: "revoked",
      requirementId: null,
      academicRuleId: null,
      creditRecordId: null,
      supersedesExceptionId: null,
      approvedBy: null,
      rationale: "synthetic observation",
      effectiveFrom: null,
      effectiveTo: null,
      metadata: {},
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      }],
      placements: [{
      exceptionId: "exception-1",
      requirementId: null,
      academicRuleId: null,
      creditRecordId: null,
      evidenceId: null,
      }],
    };
    const output = composeDegreeProgress(input);

    expect(output.compositionKind).toBe("COMPOSED");
    if (output.compositionKind === "COMPOSED") {
      expect(output.diagnostics.map((item) => item.stage)).toEqual([
        "RECORDED_CREDIT",
        "RECORDED_EXCEPTION",
      ]);
    }
  });

  it.each([
    ["missing target", []],
    ["duplicate target", [
      { id: "association-only-rule", programVersionId: "program-version-1" },
      { id: "association-only-rule", programVersionId: "program-version-1" },
    ]],
    ["null-scoped target", [
      { id: "association-only-rule", programVersionId: null },
    ]],
    ["mismatched-program target", [
      { id: "association-only-rule", programVersionId: "program-version-other" },
    ]],
  ] as const)(
    "preflights association-only rule references for %s",
    (_label, academicRules) => {
      const base = validInput();
      const output = composeDegreeProgress({
        ...base,
        requirements: [requirement("req-1", "3", null)],
        academicRules,
        associations: [{
          decisionId: "decision-1",
          requirementId: "req-1",
          academicRuleId: "association-only-rule",
        }],
      });

      expect(output.compositionKind).toBe("INFORMATIONAL_ONLY");
      expect(output.diagnostics.some((item) => (
        item.reason === (
          _label === "missing target"
            ? "MISSING_REFERENCED_RULE"
            : _label === "duplicate target"
              ? "AMBIGUOUS_REFERENCED_RULE"
              : _label === "null-scoped target"
                ? "NULL_SCOPED_REFERENCED_RULE"
                : "REFERENCED_RULE_PROGRAM_VERSION_MISMATCH"
        )
      ))).toBe(true);
    },
  );

  it.each([
    ["missing target", []],
    ["duplicate target", [
      { id: "conflict-only-rule", programVersionId: "program-version-1" },
      { id: "conflict-only-rule", programVersionId: "program-version-1" },
    ]],
    ["null-scoped target", [
      { id: "conflict-only-rule", programVersionId: null },
    ]],
    ["mismatched-program target", [
      { id: "conflict-only-rule", programVersionId: "program-version-other" },
    ]],
  ] as const)(
    "preflights conflict-only rule references for %s",
    (_label, academicRules) => {
      const base = validInput();
      const output = composeDegreeProgress({
        ...base,
        requirements: [requirement("req-1", "3", null)],
        academicRules,
        associations: [],
        unresolvedConflicts: [{
          conflictId: "conflict-only",
          requirementId: "req-1",
          academicRuleId: "conflict-only-rule",
          status: "open",
          sourceIds: ["conflict-source"],
          claimVersionIds: ["conflict-claim"],
        }],
      });

      expect(output.compositionKind).toBe("INFORMATIONAL_ONLY");
      expect(output.diagnostics.some((item) => (
        item.reason === (
          _label === "missing target"
            ? "MISSING_REFERENCED_RULE"
            : _label === "duplicate target"
              ? "AMBIGUOUS_REFERENCED_RULE"
              : _label === "null-scoped target"
                ? "NULL_SCOPED_REFERENCED_RULE"
                : "REFERENCED_RULE_PROGRAM_VERSION_MISMATCH"
        )
      ))).toBe(true);
    },
  );

  it("does not orchestrate stages after preflight rejection", () => {
    const output = composeDegreeProgress({
      ...validInput(),
      academicRules: [],
    });

    expect(output.compositionKind).toBe("INFORMATIONAL_ONLY");
    expect(projectRecordedStudentCreditFacts).not.toHaveBeenCalled();
    expect(projectRecordedAcademicExceptions).not.toHaveBeenCalled();
  });

  it("orchestrates exactly once and passes the credit projection by identity", () => {
    const output = composeDegreeProgress(validInput());

    expect(output.compositionKind).toBe("COMPOSED");
    expect(projectRecordedStudentCreditFacts).toHaveBeenCalledTimes(1);
    expect(projectRecordedAcademicExceptions).toHaveBeenCalledTimes(1);
    const creditProjection = vi.mocked(projectRecordedStudentCreditFacts)
      .mock.results[0]?.value;
    const exceptionInput = vi.mocked(projectRecordedAcademicExceptions)
      .mock.calls[0]?.[0];
    expect(
      vi.mocked(projectRecordedStudentCreditFacts).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(projectRecordedAcademicExceptions).mock.invocationCallOrder[0],
    );
    expect(exceptionInput?.recordedCreditProjection).toBe(creditProjection);
  });

  it("accounts for quarantined duplicate occurrences without provenance attribution", () => {
    const base = validInput();
    const input: DegreeProgressCompositionInput = {
      ...base,
      creditRecords: [
        ...base.creditRecords,
        { ...base.creditRecords[0] },
      ],
    };
    const shuffled: DegreeProgressCompositionInput = {
      ...input,
      creditRecords: [...input.creditRecords].reverse(),
    };
    const output = composeDegreeProgress(input);
    const shuffledOutput = composeDegreeProgress(shuffled);

    expect(output.compositionKind).toBe("COMPOSED");
    expect(output).toEqual(shuffledOutput);
    if (output.compositionKind !== "COMPOSED") return;
    expect(output.diagnostics).toContainEqual(expect.objectContaining({
      stage: "RECORDED_CREDIT",
      reason: "AMBIGUOUS_RECORDED_CREDIT_RECORD",
    }));
    expect(output.inputAccounting.projectionKind).toBe("INFORMATIONAL_ONLY");
    expect(output.inputAccounting.occurrences.filter((item) => (
      item.kind === "creditRecord"
    ))).toHaveLength(2);
    expect(Object.isFrozen(output.inputAccounting)).toBe(true);
    expect(Object.isFrozen(output.inputAccounting.occurrences)).toBe(true);
    expect(output.inputAccounting.occurrences.every((item) => (
      Object.isFrozen(item)
    ))).toBe(true);
    expect(output.recordedCreditProjection).not.toHaveProperty("inputAccounting");
    expect(output.results[0]).not.toHaveProperty("inputAccounting");
  });
});