import { describe, expect, it } from "vitest";

import {
  projectRecordedStudentCreditFacts,
  type RecordedCreditProjectionInput,
} from "@shared/recorded-credit-projection";

const requirement = (
  id: string,
  academicRuleId: string | null = `rule-${id}`,
): RecordedCreditProjectionInput["requirements"][number] => ({
  requirementId: id,
  academicRuleId,
  kind: "minimum",
  unit: "credits",
  requiredAmount: "3",
  sourceIds: [`source-requirement-${id}`],
  claimVersionIds: [`claim-requirement-${id}`],
});

const record = (
  id: string,
  overrides: Partial<RecordedCreditProjectionInput["creditRecords"][number]> = {},
): RecordedCreditProjectionInput["creditRecords"][number] => ({
  id,
  studentId: "student-1",
  sourceId: `source-${id}`,
  status: "verified",
  ...overrides,
});

const verification = (
  id: string,
  creditRecordId: string,
  overrides: Partial<
    RecordedCreditProjectionInput["verificationEvents"][number]
  > = {},
): RecordedCreditProjectionInput["verificationEvents"][number] => ({
  id,
  creditRecordId,
  seq: 1,
  action: "verified",
  ...overrides,
});

const decision = (
  id: string,
  creditRecordId: string,
  overrides: Partial<RecordedCreditProjectionInput["decisions"][number]> = {},
): RecordedCreditProjectionInput["decisions"][number] => ({
  id,
  creditRecordId,
  programAssignmentId: "assignment-1",
  seq: 1,
  action: "accepted",
  creditsAwarded: "3.00",
  basisClaimVersionId: `claim-${id}`,
  equivalencyId: `equivalency-${id}`,
  targetInstitutionCourseVersionId: `target-${id}`,
  ...overrides,
});

const association = (
  decisionId: string,
  requirementId = "req-1",
  academicRuleId: string | null = `rule-${requirementId}`,
): RecordedCreditProjectionInput["associations"][number] => ({
  decisionId,
  requirementId,
  academicRuleId,
});

const validInput = (): RecordedCreditProjectionInput => ({
  context: {
    studentId: "student-1",
    programAssignmentId: "assignment-1",
  },
  requirements: [requirement("req-1")],
  unresolvedConflicts: [],
  creditRecords: [record("record-1")],
  verificationEvents: [verification("verification-1", "record-1")],
  decisions: [decision("decision-1", "record-1")],
  associations: [association("decision-1")],
});

describe("projectRecordedStudentCreditFacts", () => {
  it("projects an exact verified accepted fact into Chunk 3 and the evaluator", () => {
    const output = projectRecordedStudentCreditFacts(validInput());

    expect(output.diagnostics).toEqual([]);
    expect(output.evidence).toHaveLength(1);
    expect(output.evidence[0]).toMatchObject({
      evidenceId: "decision-1",
      studentCreditRecordId: "record-1",
      requirementId: "req-1",
      academicRuleId: "rule-req-1",
      kind: "accepted_credit",
      unit: "credits",
      amount: "3.00",
      verificationEventId: "verification-1",
      decisionId: "decision-1",
      exceptionIds: [],
      sourceIds: ["source-record-1"],
      claimVersionIds: ["claim-decision-1"],
    });
    expect(output.normalization.contributions[0]).toMatchObject({
      canonicalFactIds: ["decision-1"],
      studentCreditRecordId: "record-1",
      verificationEventId: "verification-1",
      decisionId: "decision-1",
    });
    expect(output.results[0]).toMatchObject({
      projectionKind: "INFORMATIONAL_ONLY",
      requirementId: "req-1",
      status: "SATISFIED",
      appliedAmount: "3",
      remainingAmount: "0",
    });
    expect(output.recordedProvenance).toEqual({
      studentIds: ["student-1"],
      programAssignmentIds: ["assignment-1"],
      studentCreditRecordIds: ["record-1"],
      verificationEventIds: ["verification-1"],
      decisionIds: ["decision-1"],
      requirementIds: ["req-1"],
      academicRuleIds: ["rule-req-1"],
      sourceIds: ["source-record-1"],
      claimVersionIds: ["claim-decision-1"],
      equivalencyIds: ["equivalency-decision-1"],
      targetInstitutionCourseVersionIds: ["target-decision-1"],
    });
    expect(output.evidence[0].recordedProvenance).toEqual(
      output.recordedProvenance,
    );
    expect(Object.isFrozen(output.evidence[0].recordedProvenance)).toBe(true);
  });

  it("returns byte-equivalent output for shuffled equivalent recorded facts", () => {
    const input: RecordedCreditProjectionInput = {
      ...validInput(),
      requirements: [requirement("req-b"), requirement("req-a")],
      creditRecords: [record("record-b"), record("record-a")],
      verificationEvents: [
        verification("verification-b", "record-b"),
        verification("verification-a", "record-a"),
      ],
      decisions: [
        decision("decision-b", "record-b"),
        decision("decision-a", "record-a"),
      ],
      associations: [
        association("decision-b", "req-b"),
        association("decision-a", "req-a"),
      ],
    };
    const shuffled: RecordedCreditProjectionInput = {
      ...input,
      requirements: [...input.requirements].reverse(),
      creditRecords: [...input.creditRecords].reverse(),
      verificationEvents: [...input.verificationEvents].reverse(),
      decisions: [...input.decisions].reverse(),
      associations: [...input.associations].reverse(),
    };

    expect(projectRecordedStudentCreditFacts(input)).toEqual(
      projectRecordedStudentCreditFacts(shuffled),
    );
  });

  it.each([
    ["record-event link", {
      verificationEvents: [verification("verification-1", "other")],
    }, [
      "MISSING_RECORDED_CREDIT_VERIFICATION",
      "ORPHAN_RECORDED_CREDIT_VERIFICATION",
    ]],
    ["record-decision link", {
      decisions: [decision("decision-1", "other")],
    }, [
      "MISSING_RECORDED_CREDIT_RECORD",
      "ORPHAN_RECORDED_CREDIT_RECORD",
    ]],
    ["student context", {
      creditRecords: [record("record-1", { studentId: "student-other" })],
    }, ["RECORDED_CREDIT_STUDENT_MISMATCH"]],
    ["program context", {
      decisions: [decision("decision-1", "record-1", {
        programAssignmentId: "assignment-other",
      })],
    }, ["RECORDED_CREDIT_PROGRAM_MISMATCH"]],
    ["missing record", {
      creditRecords: [],
    }, ["MISSING_RECORDED_CREDIT_RECORD"]],
    ["missing verification", {
      verificationEvents: [],
    }, ["MISSING_RECORDED_CREDIT_VERIFICATION"]],
    ["missing decision", {
      decisions: [],
    }, [
      "MISSING_RECORDED_CREDIT_DECISION",
      "ORPHAN_RECORDED_CREDIT_RECORD",
    ]],
    ["missing association", {
      associations: [],
    }, ["MISSING_RECORDED_CREDIT_ASSOCIATION"]],
  ] as const)("fails closed for %s", (_label, patch, reasons) => {
    const output = projectRecordedStudentCreditFacts({
      ...validInput(),
      ...patch,
    });

    expect(output.evidence).toEqual([]);
    expect(output.normalization.contributions).toEqual([]);
    expect(output.diagnostics).toHaveLength(reasons.length);
    expect(output.diagnostics.map((item) => item.reason)).toEqual(
      expect.arrayContaining([...reasons]),
    );
    expect(output.diagnostics.every(
      (item) => item.status === "MANUAL_REVIEW",
    )).toBe(true);
  });

  it.each([
    ["duplicate record identity", {
      creditRecords: [record("record-1"), record("record-1")],
    }, "AMBIGUOUS_RECORDED_CREDIT_RECORD"],
    ["duplicate verification identity", {
      verificationEvents: [
        verification("verification-1", "record-1"),
        verification("verification-1", "record-1"),
      ],
    }, "AMBIGUOUS_RECORDED_CREDIT_VERIFICATION"],
    ["multiple verification events", {
      verificationEvents: [
        verification("verification-1", "record-1"),
        verification("verification-2", "record-1", { seq: 2 }),
      ],
    }, "AMBIGUOUS_RECORDED_CREDIT_VERIFICATION"],
    ["duplicate decision identity", {
      decisions: [
        decision("decision-1", "record-1"),
        decision("decision-1", "record-1"),
      ],
    }, "AMBIGUOUS_RECORDED_CREDIT_DECISION"],
    ["multiple decisions", {
      decisions: [
        decision("decision-1", "record-1"),
        decision("decision-2", "record-1", { seq: 2 }),
      ],
    }, "AMBIGUOUS_RECORDED_CREDIT_DECISION"],
    ["multiple associations", {
      associations: [
        association("decision-1"),
        association("decision-1", "req-other", "rule-other"),
      ],
    }, "AMBIGUOUS_RECORDED_CREDIT_ASSOCIATION"],
  ] as const)("does not choose a latest fact for %s", (
    _label,
    patch,
    reason,
  ) => {
    const input = { ...validInput(), ...patch };
    const first = projectRecordedStudentCreditFacts(input);
    const shuffled = projectRecordedStudentCreditFacts({
      ...input,
      creditRecords: [...input.creditRecords].reverse(),
      verificationEvents: [...input.verificationEvents].reverse(),
      decisions: [...input.decisions].reverse(),
      associations: [...input.associations].reverse(),
    });

    expect(first).toEqual(shuffled);
    expect(first.evidence).toEqual([]);
    expect(first.diagnostics).toEqual([
      expect.objectContaining({ status: "MANUAL_REVIEW", reason }),
    ]);
  });

  it.each([
    ["non-verified record", {
      creditRecords: [record("record-1", { status: "needs_review" })],
    }, "UNSUPPORTED_RECORDED_CREDIT_STATUS"],
    ["non-verified event", {
      verificationEvents: [verification("verification-1", "record-1", {
        action: "corrected",
      })],
    }, "UNSUPPORTED_RECORDED_VERIFICATION_ACTION"],
    ["non-accepted decision", {
      decisions: [decision("decision-1", "record-1", {
        action: "revoked",
        creditsAwarded: "0",
      })],
    }, "UNSUPPORTED_RECORDED_DECISION_ACTION"],
  ] as const)("does not reinterpret %s", (_label, patch, reason) => {
    const output = projectRecordedStudentCreditFacts({
      ...validInput(),
      ...patch,
    });

    expect(output.evidence).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({ status: "MANUAL_REVIEW", reason }),
    ]);
  });

  it.each([
    null,
    "",
    "0",
    "-1",
    "1.234",
    "10000",
    "NaN",
  ])("fails closed for invalid accepted awarded credit %j", (creditsAwarded) => {
    const output = projectRecordedStudentCreditFacts({
      ...validInput(),
      decisions: [decision("decision-1", "record-1", { creditsAwarded })],
    });

    expect(output.evidence).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        status: "MANUAL_REVIEW",
        reason: "INVALID_RECORDED_AWARDED_CREDIT",
      }),
    ]);
  });

  it("delegates exact rule mismatch to the canonical normalizer", () => {
    const output = projectRecordedStudentCreditFacts({
      ...validInput(),
      associations: [association("decision-1", "req-1", null)],
    });

    expect(output.evidence).toEqual([]);
    expect(output.normalization.contributions).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        status: "MANUAL_REVIEW",
        reason: "RECORDED_CREDIT_PLACEMENT_MISMATCH",
      }),
    ]);
  });

  it("does not emit evidence for an unmatched requirement placement", () => {
    const output = projectRecordedStudentCreditFacts({
      ...validInput(),
      associations: [association("decision-1", "unknown", "rule-unknown")],
    });

    expect(output.evidence).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        status: "MANUAL_REVIEW",
        reason: "RECORDED_CREDIT_PLACEMENT_MISMATCH",
      }),
    ]);
  });

  it.each([
    ["orphan record", {
      decisions: [],
      associations: [],
      verificationEvents: [],
    }, "ORPHAN_RECORDED_CREDIT_RECORD"],
    ["orphan verification", {
      creditRecords: [],
      decisions: [],
      associations: [],
    }, "ORPHAN_RECORDED_CREDIT_VERIFICATION"],
  ] as const)("accounts for every supplied %s", (_label, patch, reason) => {
    const output = projectRecordedStudentCreditFacts({
      ...validInput(),
      ...patch,
    });

    expect(output.evidence).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({ status: "MANUAL_REVIEW", reason }),
    ]);
  });

  it("includes the complete linked cohort in an ambiguity diagnostic", () => {
    const output = projectRecordedStudentCreditFacts({
      ...validInput(),
      creditRecords: [record("record-1"), record("record-1")],
    });

    expect(output.evidence).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        reason: "AMBIGUOUS_RECORDED_CREDIT_RECORD",
        provenance: expect.objectContaining({
          studentCreditRecordIds: ["record-1"],
          verificationEventIds: ["verification-1"],
          decisionIds: ["decision-1"],
          requirementIds: ["req-1"],
          academicRuleIds: ["rule-req-1"],
        }),
      }),
    ]);
  });

  it("quarantines a verification identity reused across complete records", () => {
    const input: RecordedCreditProjectionInput = {
      ...validInput(),
      requirements: [requirement("req-a"), requirement("req-b")],
      creditRecords: [record("record-a"), record("record-b")],
      verificationEvents: [
        verification("verification-shared", "record-a"),
        verification("verification-shared", "record-b"),
      ],
      decisions: [
        decision("decision-a", "record-a"),
        decision("decision-b", "record-b"),
      ],
      associations: [
        association("decision-a", "req-a"),
        association("decision-b", "req-b"),
      ],
    };
    const output = projectRecordedStudentCreditFacts(input);
    const shuffled = projectRecordedStudentCreditFacts({
      ...input,
      requirements: [...input.requirements].reverse(),
      creditRecords: [...input.creditRecords].reverse(),
      verificationEvents: [...input.verificationEvents].reverse(),
      decisions: [...input.decisions].reverse(),
      associations: [...input.associations].reverse(),
    });

    expect(output).toEqual(shuffled);
    expect(output.evidence).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        reason: "AMBIGUOUS_RECORDED_CREDIT_VERIFICATION",
        provenance: expect.objectContaining({
          studentCreditRecordIds: ["record-a", "record-b"],
          verificationEventIds: ["verification-shared"],
          decisionIds: ["decision-a", "decision-b"],
        }),
      }),
    ]);
  });

  it("fails closed for blank identities and provenance", () => {
    const output = projectRecordedStudentCreditFacts({
      ...validInput(),
      context: { studentId: " ", programAssignmentId: "assignment-1" },
      creditRecords: [record("record-1", { sourceId: "" })],
    });

    expect(output.evidence).toEqual([]);
    expect(output.diagnostics[0]).toMatchObject({
      status: "MANUAL_REVIEW",
      reason: "INVALID_RECORDED_PROJECTION_CONTEXT",
    });
  });

  it.each([
    ["source", {
      creditRecords: [record("record-1", { sourceId: " " })],
    }],
    ["basis claim", {
      decisions: [decision("decision-1", "record-1", {
        basisClaimVersionId: "",
      })],
    }],
    ["equivalency", {
      decisions: [decision("decision-1", "record-1", {
        equivalencyId: " ",
      })],
    }],
    ["target course", {
      decisions: [decision("decision-1", "record-1", {
        targetInstitutionCourseVersionId: "",
      })],
    }],
  ] as const)("fails closed for blank %s provenance", (_label, patch) => {
    const output = projectRecordedStudentCreditFacts({
      ...validInput(),
      ...patch,
    });

    expect(output.evidence).toEqual([]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        status: "MANUAL_REVIEW",
        reason: "INVALID_RECORDED_CREDIT_PROVENANCE",
      }),
    ]);
  });

  it("deeply freezes output and does not mutate caller input", () => {
    const input = validInput();
    const before = structuredClone(input);
    const output = projectRecordedStudentCreditFacts(input);

    expect(input).toEqual(before);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.evidence)).toBe(true);
    expect(Object.isFrozen(output.evidence[0])).toBe(true);
    expect(Object.isFrozen(output.recordedProvenance)).toBe(true);
    for (const value of Object.values(output.recordedProvenance)) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(Object.isFrozen(output.results)).toBe(true);
  });
});