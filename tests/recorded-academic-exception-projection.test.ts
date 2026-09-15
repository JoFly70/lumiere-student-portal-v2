import { describe, expect, it } from "vitest";

import {
  projectRecordedStudentCreditFacts,
  type RecordedCreditProjectionInput,
} from "@shared/recorded-credit-projection";
import {
  projectRecordedAcademicExceptions,
  type RecordedAcademicExceptionProjectionInput,
} from "@shared/recorded-academic-exception-projection";

const requirement = (
  id = "req-1",
  academicRuleId: string | null = "rule-1",
): RecordedAcademicExceptionProjectionInput["requirements"][number] => ({
  requirementId: id,
  academicRuleId,
  kind: "minimum",
  unit: "credits",
  requiredAmount: "3",
  sourceIds: [`requirement-source-${id}`],
  claimVersionIds: [`requirement-claim-${id}`],
});

const creditInput = (): RecordedCreditProjectionInput => ({
  context: {
    studentId: "student-1",
    programAssignmentId: "assignment-1",
  },
  requirements: [requirement()],
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
    creditsAwarded: "3.00",
    basisClaimVersionId: "basis-claim-1",
    equivalencyId: "equivalency-1",
    targetInstitutionCourseVersionId: "target-course-1",
  }],
  associations: [{
    decisionId: "decision-1",
    requirementId: "req-1",
    academicRuleId: "rule-1",
  }],
});

const exception = (
  id = "exception-1",
  overrides: Partial<
    RecordedAcademicExceptionProjectionInput["exceptions"][number]
  > = {},
): RecordedAcademicExceptionProjectionInput["exceptions"][number] => ({
  id,
  studentId: "student-1",
  programAssignmentId: "assignment-1",
  exceptionType: "requirement_waiver",
  status: "active",
  requirementId: "req-1",
  academicRuleId: "rule-1",
  creditRecordId: null,
  supersedesExceptionId: null,
  approvedBy: "approver-1",
  rationale: "Synthetic recorded exception",
  effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
  effectiveTo: new Date("2025-12-31T00:00:00.000Z"),
  metadata: { opaque: { flag: true }, amount: "do-not-interpret" },
  createdAt: new Date("2025-01-02T00:00:00.000Z"),
  ...overrides,
});

const placement = (
  exceptionId = "exception-1",
  overrides: Partial<
    RecordedAcademicExceptionProjectionInput["placements"][number]
  > = {},
): RecordedAcademicExceptionProjectionInput["placements"][number] => ({
  exceptionId,
  requirementId: "req-1",
  academicRuleId: "rule-1",
  creditRecordId: null,
  evidenceId: null,
  ...overrides,
});

const validInput = (): RecordedAcademicExceptionProjectionInput => ({
  context: {
    studentId: "student-1",
    programAssignmentId: "assignment-1",
  },
  exceptions: [exception()],
  placements: [placement()],
  requirements: [requirement()],
  academicRules: [{ id: "rule-1" }],
  creditRecords: [{
    id: "record-1",
    studentId: "student-1",
  }],
  unresolvedConflicts: [],
  recordedCreditProjection: projectRecordedStudentCreditFacts(creditInput()),
});

describe("projectRecordedAcademicExceptions", () => {
  it.each([
    ["coordinated student mismatch", {
      context: {
        studentId: "student-other",
        programAssignmentId: "assignment-1",
      },
      exceptions: [exception("exception-1", {
        studentId: "student-other",
      })],
    }],
    ["coordinated program mismatch", {
      context: {
        studentId: "student-1",
        programAssignmentId: "assignment-other",
      },
      exceptions: [exception("exception-1", {
        programAssignmentId: "assignment-other",
      })],
    }],
    ["missing Chunk 4 student provenance", {
      recordedProvenance: {
        studentIds: [],
      },
    }],
    ["missing Chunk 4 program provenance", {
      recordedProvenance: {
        programAssignmentIds: [],
      },
    }],
    ["ambiguous Chunk 4 student provenance", {
      recordedProvenance: {
        studentIds: ["student-1", "student-other"],
      },
    }],
    ["ambiguous Chunk 4 program provenance", {
      recordedProvenance: {
        programAssignmentIds: ["assignment-1", "assignment-other"],
      },
    }],
  ] as const)("fails closed for %s before exception processing", (
    _label,
    patch,
  ) => {
    const input = validInput();
    const recordedProvenancePatch = "recordedProvenance" in patch
      ? patch.recordedProvenance
      : {};
    const coordinatedPatch = "recordedProvenance" in patch ? {} : patch;
    const recordedCreditProjection = {
      ...input.recordedCreditProjection,
      recordedProvenance: {
        ...input.recordedCreditProjection.recordedProvenance,
        ...recordedProvenancePatch,
      },
    };
    const coordinatedInput = {
      ...input,
      ...coordinatedPatch,
      recordedCreditProjection,
    };

    const output = projectRecordedAcademicExceptions(coordinatedInput);

    expect(output.observations).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        projectionKind: "INFORMATIONAL_ONLY",
        status: "MANUAL_REVIEW",
        reason: "INVALID_RECORDED_CREDIT_PROJECTION_CONTEXT",
        provenance: expect.objectContaining({
          exceptionIds: ["exception-1"],
          requirementIds: ["req-1"],
          academicRuleIds: ["rule-1"],
        }),
      }),
    ]);
    expect(output.evidence).toEqual(recordedCreditProjection.evidence);
    expect(output.normalization).toEqual(recordedCreditProjection.normalization);
    expect(output.results).toEqual(recordedCreditProjection.results);
  });

  it("quarantines a shuffled cross-context cohort deterministically", () => {
    const input = validInput();
    const exceptions = [
      exception("exception-b", { studentId: "student-other" }),
      exception("exception-a", { studentId: "student-other" }),
    ];
    const placements = [
      placement("exception-b"),
      placement("exception-a"),
    ];
    const firstInput = {
      ...input,
      context: {
        studentId: "student-other",
        programAssignmentId: "assignment-1",
      },
      exceptions,
      placements,
    };
    const shuffledInput = {
      ...firstInput,
      exceptions: [...exceptions].reverse(),
      placements: [...placements].reverse(),
    };

    const first = projectRecordedAcademicExceptions(firstInput);
    const shuffled = projectRecordedAcademicExceptions(shuffledInput);

    expect(first).toEqual(shuffled);
    expect(first.observations).toEqual([]);
    expect(first.diagnostics).toEqual([
      expect.objectContaining({
        status: "MANUAL_REVIEW",
        reason: "INVALID_RECORDED_CREDIT_PROJECTION_CONTEXT",
        provenance: expect.objectContaining({
          studentIds: ["student-1", "student-other"],
          programAssignmentIds: ["assignment-1"],
          exceptionIds: ["exception-a", "exception-b"],
          requirementIds: ["req-1"],
          academicRuleIds: ["rule-1"],
        }),
      }),
    ]);
    expect(first.normalization).toEqual(
      input.recordedCreditProjection.normalization,
    );
    expect(first.results).toEqual(input.recordedCreditProjection.results);
  });

  it.each([
    "requirement_waiver",
    "course_substitution",
    "credit_override",
    "level_override",
    "residency_override",
    "other",
  ] as const)("records %s as undefined-effect manual review only", (
    exceptionType,
  ) => {
    const input = validInput();
    input.exceptions = [exception("exception-1", {
      exceptionType,
      ...(exceptionType === "other"
        ? {
          requirementId: null,
          academicRuleId: null,
          creditRecordId: null,
        }
        : {}),
    })];
    input.placements = [placement("exception-1", exceptionType === "other"
      ? {
        requirementId: null,
        academicRuleId: null,
        creditRecordId: null,
      }
      : {})];

    const output = projectRecordedAcademicExceptions(input);

    expect(output.diagnostics).toEqual([]);
    expect(output.observations).toEqual([
      expect.objectContaining({
        projectionKind: "INFORMATIONAL_ONLY",
        status: "MANUAL_REVIEW",
        reason: "RECORDED_EXCEPTION_EFFECT_UNDEFINED",
        exceptionId: "exception-1",
        exceptionType,
      }),
    ]);
    expect(output.normalization).toEqual(
      input.recordedCreditProjection.normalization,
    );
    expect(output.results).toEqual(input.recordedCreditProjection.results);
    expect(output.evidence).toEqual(input.recordedCreditProjection.evidence);
  });

  it("associates exact existing evidence as provenance only", () => {
    const input = validInput();
    input.exceptions = [exception("exception-1", {
      creditRecordId: "record-1",
    })];
    input.placements = [placement("exception-1", {
      creditRecordId: "record-1",
      evidenceId: "decision-1",
    })];

    const output = projectRecordedAcademicExceptions(input);

    expect(output.evidence[0].amount).toBe("3.00");
    expect(output.evidence[0].exceptionIds).toEqual(["exception-1"]);
    expect(output.results[0]).toMatchObject({
      status: "SATISFIED",
      appliedAmount: "3",
      remainingAmount: "0",
    });
    expect(output.normalization).toEqual(
      input.recordedCreditProjection.normalization,
    );
    expect(output.results).toEqual(input.recordedCreditProjection.results);
    expect(output.results[0].provenance.exceptionIds).toEqual([]);
    expect(output.observations[0].provenance).toMatchObject({
      exceptionIds: ["exception-1"],
      studentIds: ["student-1"],
      programAssignmentIds: ["assignment-1"],
      requirementIds: ["req-1"],
      academicRuleIds: ["rule-1"],
      studentCreditRecordIds: ["record-1"],
      evidenceIds: ["decision-1"],
      verificationEventIds: ["verification-1"],
      decisionIds: ["decision-1"],
      sourceIds: ["source-1"],
      claimVersionIds: ["basis-claim-1"],
      equivalencyIds: ["equivalency-1"],
      targetInstitutionCourseVersionIds: ["target-course-1"],
      approvedByIds: ["approver-1"],
    });
  });

  it.each([
    ["revoked", "RECORDED_EXCEPTION_REVOKED"],
    ["superseded", "RECORDED_EXCEPTION_SUPERSEDED"],
  ] as const)("does not apply a %s exception", (status, reason) => {
    const output = projectRecordedAcademicExceptions({
      ...validInput(),
      exceptions: [exception("exception-1", { status })],
    });

    expect(output.observations).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({ status: "MANUAL_REVIEW", reason }),
    ]);
    expect(output.evidence).toEqual(
      validInput().recordedCreditProjection.evidence,
    );
  });

  it.each([
    ["student context", {
      exceptions: [exception("exception-1", {
        studentId: "student-other",
      })],
    }, "RECORDED_EXCEPTION_STUDENT_MISMATCH"],
    ["program context", {
      exceptions: [exception("exception-1", {
        programAssignmentId: "assignment-other",
      })],
    }, "RECORDED_EXCEPTION_PROGRAM_MISMATCH"],
    ["requirement placement", {
      placements: [placement("exception-1", {
        requirementId: "req-other",
      })],
    }, "RECORDED_EXCEPTION_TARGET_MISMATCH"],
    ["rule placement", {
      placements: [placement("exception-1", {
        academicRuleId: null,
      })],
    }, "RECORDED_EXCEPTION_TARGET_MISMATCH"],
    ["null-to-non-null record placement", {
      placements: [placement("exception-1", {
        creditRecordId: "record-1",
      })],
    }, "RECORDED_EXCEPTION_TARGET_MISMATCH"],
    ["unknown requirement", {
      requirements: [],
    }, "MISSING_RECORDED_EXCEPTION_TARGET"],
    ["unknown rule", {
      academicRules: [],
    }, "MISSING_RECORDED_EXCEPTION_TARGET"],
    ["missing placement", {
      placements: [],
    }, "MISSING_RECORDED_EXCEPTION_PLACEMENT"],
    ["unknown exception type", {
      exceptions: [exception("exception-1", {
        exceptionType: "invented" as "other",
      })],
    }, "INVALID_RECORDED_EXCEPTION_FACT"],
    ["unknown exception status", {
      exceptions: [exception("exception-1", {
        status: "invented" as "active",
      })],
    }, "INVALID_RECORDED_EXCEPTION_FACT"],
  ] as const)("fails closed for %s", (_label, patch, reason) => {
    const output = projectRecordedAcademicExceptions({
      ...validInput(),
      ...patch,
    });

    expect(output.observations).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({ status: "MANUAL_REVIEW", reason }),
    ]);
    expect(output.results).toEqual(
      validInput().recordedCreditProjection.results,
    );
  });

  it.each([
    ["duplicate exception identity", {
      exceptions: [exception(), exception()],
    }, "AMBIGUOUS_RECORDED_EXCEPTION_IDENTITY"],
    ["multiple placements", {
      placements: [placement(), placement()],
    }, "AMBIGUOUS_RECORDED_EXCEPTION_PLACEMENT"],
    ["multiple active exceptions on one target", {
      exceptions: [exception("exception-a"), exception("exception-b")],
      placements: [placement("exception-a"), placement("exception-b")],
    }, "AMBIGUOUS_RECORDED_EXCEPTION_TARGET"],
  ] as const)("quarantines %s atomically", (_label, patch, reason) => {
    const input = { ...validInput(), ...patch };
    const first = projectRecordedAcademicExceptions(input);
    const shuffled = projectRecordedAcademicExceptions({
      ...input,
      exceptions: [...input.exceptions].reverse(),
      placements: [...input.placements].reverse(),
    });

    expect(first).toEqual(shuffled);
    expect(first.observations).toEqual([]);
    expect(first.diagnostics).toEqual([
      expect.objectContaining({ status: "MANUAL_REVIEW", reason }),
    ]);
  });

  it("quarantines a reused evidence association", () => {
    const input = validInput();
    input.exceptions = [
      exception("exception-a", { creditRecordId: "record-1" }),
      exception("exception-b", { creditRecordId: "record-1" }),
    ];
    input.placements = [
      placement("exception-a", {
        creditRecordId: "record-1",
        evidenceId: "decision-1",
      }),
      placement("exception-b", {
        creditRecordId: "record-1",
        evidenceId: "decision-1",
      }),
    ];

    const output = projectRecordedAcademicExceptions(input);

    expect(output.observations).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        reason: "AMBIGUOUS_RECORDED_EXCEPTION_EVIDENCE_ASSOCIATION",
        provenance: expect.objectContaining({
          exceptionIds: ["exception-a", "exception-b"],
          evidenceIds: ["decision-1"],
        }),
      }),
    ]);
    expect(output.evidence).toEqual(input.recordedCreditProjection.evidence);
  });

  it("fails closed for a duplicate existing evidence identity", () => {
    const input = validInput();
    const existing = input.recordedCreditProjection.evidence[0];
    const recordedCreditProjection = {
      ...input.recordedCreditProjection,
      evidence: [existing, { ...existing }],
    };
    const output = projectRecordedAcademicExceptions({
      ...input,
      exceptions: [exception("exception-1", {
        creditRecordId: "record-1",
      })],
      placements: [placement("exception-1", {
        creditRecordId: "record-1",
        evidenceId: "decision-1",
      })],
      recordedCreditProjection,
    });

    expect(output.observations).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        reason: "AMBIGUOUS_RECORDED_EXCEPTION_EVIDENCE_ASSOCIATION",
      }),
    ]);
    expect(output.normalization).toEqual(
      recordedCreditProjection.normalization,
    );
    expect(output.results).toEqual(recordedCreditProjection.results);
  });

  it("fails closed for cross-context existing evidence", () => {
    const input = validInput();
    const existing = input.recordedCreditProjection.evidence[0];
    const recordedCreditProjection = {
      ...input.recordedCreditProjection,
      evidence: [{
        ...existing,
        recordedProvenance: {
          ...existing.recordedProvenance,
          studentIds: ["student-other"],
        },
      }],
    };
    const output = projectRecordedAcademicExceptions({
      ...input,
      exceptions: [exception("exception-1", {
        creditRecordId: "record-1",
      })],
      placements: [placement("exception-1", {
        creditRecordId: "record-1",
        evidenceId: "decision-1",
      })],
      recordedCreditProjection,
    });

    expect(output.observations).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        reason: "RECORDED_EXCEPTION_EVIDENCE_MISMATCH",
      }),
    ]);
    expect(output.results).toEqual(recordedCreditProjection.results);
  });

  it("does not associate recorded-credit evidence to a null record target", () => {
    const input = validInput();
    const output = projectRecordedAcademicExceptions({
      ...input,
      placements: [placement("exception-1", {
        evidenceId: "decision-1",
      })],
    });

    expect(output.observations).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        reason: "RECORDED_EXCEPTION_EVIDENCE_MISMATCH",
      }),
    ]);
    expect(output.evidence).toEqual(input.recordedCreditProjection.evidence);
    expect(output.results).toEqual(input.recordedCreditProjection.results);
  });

  it("quarantines an unknown-status row with an active shared target", () => {
    const input = validInput();
    const output = projectRecordedAcademicExceptions({
      ...input,
      exceptions: [
        exception("exception-active"),
        exception("exception-malformed", {
          status: "invented" as "active",
        }),
      ],
      placements: [
        placement("exception-active"),
        placement("exception-malformed"),
      ],
    });

    expect(output.observations).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        reason: "INVALID_RECORDED_EXCEPTION_FACT",
        provenance: expect.objectContaining({
          exceptionIds: ["exception-active", "exception-malformed"],
        }),
      }),
    ]);
  });

  it("is deterministic for shuffled non-identical duplicate evidence", () => {
    const input = validInput();
    const existing = input.recordedCreditProjection.evidence[0];
    const duplicate = {
      ...existing,
      sourceIds: ["source-z"],
    };
    const firstInput = {
      ...input,
      exceptions: [exception("exception-1", {
        creditRecordId: "record-1",
      })],
      placements: [placement("exception-1", {
        creditRecordId: "record-1",
        evidenceId: "decision-1",
      })],
      recordedCreditProjection: {
        ...input.recordedCreditProjection,
        evidence: [existing, duplicate],
      },
    };
    const shuffledInput = {
      ...firstInput,
      recordedCreditProjection: {
        ...firstInput.recordedCreditProjection,
        evidence: [...firstInput.recordedCreditProjection.evidence].reverse(),
      },
    };

    expect(projectRecordedAcademicExceptions(firstInput)).toEqual(
      projectRecordedAcademicExceptions(shuffledInput),
    );
  });

  it("fails closed for a duplicate canonical target identity", () => {
    const input = validInput();
    const output = projectRecordedAcademicExceptions({
      ...input,
      requirements: [requirement(), requirement()],
    });

    expect(output.observations).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        reason: "AMBIGUOUS_RECORDED_EXCEPTION_TARGET",
      }),
    ]);
    expect(output.results).toEqual(input.recordedCreditProjection.results);
  });

  it.each([
    ["self supersession", [
      exception("exception-1", { supersedesExceptionId: "exception-1" }),
    ], "INVALID_RECORDED_EXCEPTION_SUPERSESSION"],
    ["missing superseded exception", [
      exception("exception-1", { supersedesExceptionId: "missing" }),
    ], "MISSING_RECORDED_EXCEPTION_SUPERSESSION"],
    ["cycle", [
      exception("exception-a", { supersedesExceptionId: "exception-b" }),
      exception("exception-b", { supersedesExceptionId: "exception-a" }),
    ], "INVALID_RECORDED_EXCEPTION_SUPERSESSION"],
    ["multiple children", [
      exception("exception-parent", { status: "superseded" }),
      exception("exception-a", { supersedesExceptionId: "exception-parent" }),
      exception("exception-b", { supersedesExceptionId: "exception-parent" }),
    ], "AMBIGUOUS_RECORDED_EXCEPTION_SUPERSESSION"],
  ] as const)("validates %s without choosing a winner", (
    _label,
    exceptions,
    reason,
  ) => {
    const input = validInput();
    input.exceptions = exceptions;
    input.placements = exceptions.map((fact) => placement(fact.id));

    const output = projectRecordedAcademicExceptions(input);

    expect(output.observations).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({ status: "MANUAL_REVIEW", reason }),
    ]);
  });

  it("records a structurally valid supersession chain without a winner", () => {
    const input = validInput();
    input.exceptions = [
      exception("exception-old", { status: "superseded" }),
      exception("exception-new", {
        supersedesExceptionId: "exception-old",
      }),
    ];
    input.placements = [
      placement("exception-old"),
      placement("exception-new"),
    ];

    const output = projectRecordedAcademicExceptions(input);

    expect(output.observations).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        reason: "RECORDED_EXCEPTION_SUPERSESSION_REQUIRES_REVIEW",
        provenance: expect.objectContaining({
          exceptionIds: ["exception-new", "exception-old"],
          supersededExceptionIds: ["exception-old"],
        }),
      }),
    ]);
  });

  it("validates malformed placement inside a supersession cohort", () => {
    const input = validInput();
    input.exceptions = [
      exception("exception-old", { status: "superseded" }),
      exception("exception-new", {
        supersedesExceptionId: "exception-old",
      }),
    ];
    input.placements = [
      placement("exception-old"),
      placement("exception-new", { academicRuleId: null }),
    ];

    const output = projectRecordedAcademicExceptions(input);

    expect(output.observations).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        reason: "RECORDED_EXCEPTION_TARGET_MISMATCH",
        provenance: expect.objectContaining({
          exceptionIds: ["exception-new", "exception-old"],
        }),
      }),
    ]);
  });

  it("does not interpret effective dates or opaque metadata", () => {
    const output = projectRecordedAcademicExceptions(validInput());

    expect(output.observations[0]).toMatchObject({
      effectiveFrom: "2025-01-01T00:00:00.000Z",
      effectiveTo: "2025-12-31T00:00:00.000Z",
      metadata: {
        opaque: { flag: true },
        amount: "do-not-interpret",
      },
    });
    expect(output.results[0].appliedAmount).toBe("3");
  });

  it("preserves prototype-sensitive opaque JSON keys as frozen own data", () => {
    const metadata = JSON.parse(
      '{"__proto__":{"flag":true},"ordinary":"unchanged"}',
    ) as Record<string, unknown>;
    const input = {
      ...validInput(),
      exceptions: [exception("exception-1", { metadata })],
    };
    const before = structuredClone(input);

    const output = projectRecordedAcademicExceptions(input);
    const projected = output.observations[0].metadata as Record<string, unknown>;

    expect(Object.hasOwn(projected, "__proto__")).toBe(true);
    expect(projected["__proto__"]).toEqual({ flag: true });
    expect(Object.getPrototypeOf(projected)).toBe(Object.prototype);
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected["__proto__"])).toBe(true);
    expect(() => Object.setPrototypeOf(projected, { polluted: true })).toThrow();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(input).toEqual(before);
    expect(Object.hasOwn(metadata, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(metadata)).toBe(Object.prototype);
  });

  it("deeply freezes output and does not mutate input or metadata", () => {
    const input = validInput();
    const before = structuredClone(input);
    const output = projectRecordedAcademicExceptions(input);

    expect(input).toEqual(before);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.observations)).toBe(true);
    expect(Object.isFrozen(output.observations[0])).toBe(true);
    expect(Object.isFrozen(output.observations[0].metadata)).toBe(true);
    expect(Object.isFrozen(
      (output.observations[0].metadata as { opaque: object }).opaque,
    )).toBe(true);
    expect(Object.isFrozen(output.observations[0].provenance)).toBe(true);
    for (const value of Object.values(output.observations[0].provenance)) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(Object.isFrozen(output.evidence)).toBe(true);
    expect(Object.isFrozen(output.normalization)).toBe(true);
    expect(Object.isFrozen(output.results)).toBe(true);
  });
});