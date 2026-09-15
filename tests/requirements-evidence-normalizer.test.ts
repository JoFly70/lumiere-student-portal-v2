import { describe, expect, it } from "vitest";

import {
  normalizeCanonicalRequirementEvidence,
  type CanonicalEvidenceNormalizationInput,
} from "@shared/requirements-evidence-normalizer";
import { evaluateQuantitativeRequirements } from "@shared/requirements-status-engine";

const requirement = (
  requirementId: string,
  overrides: Partial<
    CanonicalEvidenceNormalizationInput["requirements"][number]
  > = {},
): CanonicalEvidenceNormalizationInput["requirements"][number] => ({
  requirementId,
  academicRuleId: `rule-${requirementId}`,
  kind: "minimum",
  unit: "credits",
  requiredAmount: "3",
  sourceIds: [`source-requirement-${requirementId}`],
  claimVersionIds: [`claim-requirement-${requirementId}`],
  ...overrides,
});

const creditEvidence = (
  evidenceId: string,
  requirementId: string,
  overrides: Partial<
    CanonicalEvidenceNormalizationInput["studentCreditEvidence"][number]
  > = {},
): CanonicalEvidenceNormalizationInput["studentCreditEvidence"][number] => ({
  evidenceId,
  studentCreditRecordId: `credit-${evidenceId}`,
  requirementId,
  academicRuleId: `rule-${requirementId}`,
  kind: "accepted_credit",
  unit: "credits",
  amount: "1.5",
  verificationEventId: `verification-${evidenceId}`,
  decisionId: `decision-${evidenceId}`,
  exceptionIds: [`exception-${evidenceId}`],
  sourceIds: [`source-credit-${evidenceId}`],
  claimVersionIds: [`claim-credit-${evidenceId}`],
  ...overrides,
});

const conflictEvidence = (
  conflictId: string,
  requirementId: string,
  overrides: Partial<
    CanonicalEvidenceNormalizationInput["unresolvedConflicts"][number]
  > = {},
): CanonicalEvidenceNormalizationInput["unresolvedConflicts"][number] => ({
  conflictId,
  requirementId,
  academicRuleId: `rule-${requirementId}`,
  status: "open",
  sourceIds: [`source-conflict-${conflictId}`],
  claimVersionIds: [`claim-conflict-${conflictId}`],
  ...overrides,
});

describe("normalizeCanonicalRequirementEvidence", () => {
  it("normalizes explicitly associated requirements, credits, and conflicts", () => {
    const output = normalizeCanonicalRequirementEvidence({
      requirements: [requirement("req-1")],
      studentCreditEvidence: [creditEvidence("evidence-1", "req-1")],
      unresolvedConflicts: [conflictEvidence("conflict-1", "req-1")],
    });

    expect(output).toEqual({
      projectionKind: "INFORMATIONAL_ONLY",
      requirements: [{
        requirementId: "req-1",
        academicRuleId: "rule-req-1",
        kind: "minimum",
        unit: "credits",
        requiredAmount: "3",
        sourceIds: ["source-requirement-req-1"],
        claimVersionIds: ["claim-requirement-req-1"],
      }],
      contributions: [{
        canonicalFactIds: ["evidence-1"],
        requirementId: "req-1",
        studentCreditRecordId: "credit-evidence-1",
        amount: "1.5",
        verificationEventId: "verification-evidence-1",
        decisionId: "decision-evidence-1",
        exceptionIds: ["exception-evidence-1"],
        sourceIds: ["source-credit-evidence-1"],
        claimVersionIds: ["claim-credit-evidence-1"],
      }],
      conflicts: [{
        conflictId: "conflict-1",
        requirementId: "req-1",
        academicRuleId: "rule-req-1",
        sourceIds: ["source-conflict-conflict-1"],
        claimVersionIds: ["claim-conflict-conflict-1"],
      }],
      diagnostics: [],
    });
  });

  it("returns byte-equivalent output for shuffled equivalent canonical facts", () => {
    const input: CanonicalEvidenceNormalizationInput = {
      requirements: [requirement("req-b"), requirement("req-a")],
      studentCreditEvidence: [
        creditEvidence("evidence-b", "req-b"),
        creditEvidence("evidence-a", "req-a"),
      ],
      unresolvedConflicts: [
        conflictEvidence("conflict-b", "req-b"),
        conflictEvidence("conflict-a", "req-a"),
      ],
    };

    const first = normalizeCanonicalRequirementEvidence(input);
    const shuffled = normalizeCanonicalRequirementEvidence({
      requirements: [...input.requirements].reverse(),
      studentCreditEvidence: [...input.studentCreditEvidence].reverse(),
      unresolvedConflicts: [...input.unresolvedConflicts].reverse(),
    });

    expect(first).toEqual(shuffled);
    expect(first.requirements.map((item) => item.requirementId)).toEqual([
      "req-a",
      "req-b",
    ]);
    expect(first.contributions.map((item) => item.studentCreditRecordId)).toEqual([
      "credit-evidence-a",
      "credit-evidence-b",
    ]);
    expect(first.conflicts.map((item) => item.conflictId)).toEqual([
      "conflict-a",
      "conflict-b",
    ]);
  });

  it.each([
    ["requirement", {
      requirements: [requirement("req-1"), requirement("req-1")],
      studentCreditEvidence: [],
      unresolvedConflicts: [],
    }, "AMBIGUOUS_CANONICAL_REQUIREMENT_IDENTITY"],
    ["credit evidence", {
      requirements: [requirement("req-1")],
      studentCreditEvidence: [
        creditEvidence("evidence-1", "req-1"),
        creditEvidence("evidence-1", "req-1", {
          studentCreditRecordId: "credit-other",
        }),
      ],
      unresolvedConflicts: [],
    }, "AMBIGUOUS_CANONICAL_CREDIT_EVIDENCE_IDENTITY"],
    ["conflict", {
      requirements: [requirement("req-1")],
      studentCreditEvidence: [],
      unresolvedConflicts: [
        conflictEvidence("conflict-1", "req-1"),
        conflictEvidence("conflict-1", "req-1"),
      ],
    }, "AMBIGUOUS_CANONICAL_CONFLICT_IDENTITY"],
  ] as const)("fails closed for duplicate canonical %s identities", (
    _label,
    input,
    reason,
  ) => {
    const output = normalizeCanonicalRequirementEvidence(input);

    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        status: "MANUAL_REVIEW",
        reason,
      }),
    ]);
  });

  it("fails closed with complete provenance for contradictory credit associations", () => {
    const output = normalizeCanonicalRequirementEvidence({
      requirements: [requirement("req-a"), requirement("req-b")],
      studentCreditEvidence: [
        creditEvidence("evidence-1", "req-a", {
          sourceIds: ["source-a"],
          claimVersionIds: ["claim-a"],
        }),
        creditEvidence("evidence-1", "req-b", {
          studentCreditRecordId: "credit-other",
          sourceIds: ["source-b"],
          claimVersionIds: ["claim-b"],
        }),
      ],
      unresolvedConflicts: [],
    });

    expect(output.contributions).toEqual([]);
    expect(output.diagnostics[0]).toMatchObject({
      status: "MANUAL_REVIEW",
      reason: "AMBIGUOUS_CANONICAL_CREDIT_EVIDENCE_IDENTITY",
      provenance: {
        canonicalFactIds: ["evidence-1"],
        studentCreditRecordIds: ["credit-evidence-1", "credit-other"],
        requirementIds: ["req-a", "req-b"],
        academicRuleIds: ["rule-req-a", "rule-req-b"],
        sourceIds: ["source-a", "source-b"],
        claimVersionIds: ["claim-a", "claim-b"],
      },
    });
  });

  it("classifies duplicate canonical identities independently of malformed member order", () => {
    const duplicateCredits = [
      creditEvidence("evidence-1", "req-1"),
      creditEvidence("evidence-1", "req-1", {
        studentCreditRecordId: "   ",
      }),
    ];
    const duplicateConflicts = [
      conflictEvidence("conflict-1", "req-1"),
      conflictEvidence("conflict-1", "   "),
    ];
    const first = normalizeCanonicalRequirementEvidence({
      requirements: [requirement("req-1")],
      studentCreditEvidence: duplicateCredits,
      unresolvedConflicts: duplicateConflicts,
    });
    const shuffled = normalizeCanonicalRequirementEvidence({
      requirements: [requirement("req-1")],
      studentCreditEvidence: [...duplicateCredits].reverse(),
      unresolvedConflicts: [...duplicateConflicts].reverse(),
    });

    expect(first).toEqual(shuffled);
    expect(first.diagnostics.map((item) => item.reason)).toEqual([
      "AMBIGUOUS_CANONICAL_CONFLICT_IDENTITY",
      "AMBIGUOUS_CANONICAL_CREDIT_EVIDENCE_IDENTITY",
    ]);
  });

  it("fails closed when distinct evidence facts map to one evaluator contribution identity", () => {
    const evidence = [
      creditEvidence("evidence-a", "req-1", {
        studentCreditRecordId: "credit-1",
        sourceIds: ["source-a"],
      }),
      creditEvidence("evidence-b", "req-1", {
        studentCreditRecordId: "credit-1",
        sourceIds: ["source-b"],
      }),
    ];
    const first = normalizeCanonicalRequirementEvidence({
      requirements: [requirement("req-1")],
      studentCreditEvidence: evidence,
      unresolvedConflicts: [],
    });
    const shuffled = normalizeCanonicalRequirementEvidence({
      requirements: [requirement("req-1")],
      studentCreditEvidence: [...evidence].reverse(),
      unresolvedConflicts: [],
    });

    expect(first).toEqual(shuffled);
    expect(first.contributions).toEqual([]);
    expect(first.diagnostics).toEqual([
      expect.objectContaining({
        status: "MANUAL_REVIEW",
        reason: "AMBIGUOUS_CANONICAL_CREDIT_MAPPING",
        provenance: expect.objectContaining({
          canonicalFactIds: ["evidence-a", "evidence-b"],
          studentCreditRecordIds: ["credit-1"],
          requirementIds: ["req-1"],
          sourceIds: ["source-a", "source-b"],
        }),
      }),
    ]);
  });

  it("fails closed atomically when one student record maps to multiple requirements", () => {
    const evidence = [
      creditEvidence("evidence-a", "req-a", {
        studentCreditRecordId: "credit-shared",
        sourceIds: ["source-a"],
        claimVersionIds: ["claim-a"],
      }),
      creditEvidence("evidence-b", "req-b", {
        studentCreditRecordId: "credit-shared",
        sourceIds: ["source-b"],
        claimVersionIds: ["claim-b"],
      }),
    ];
    const requirements = [requirement("req-a"), requirement("req-b")];
    const first = normalizeCanonicalRequirementEvidence({
      requirements,
      studentCreditEvidence: evidence,
      unresolvedConflicts: [],
    });
    const shuffled = normalizeCanonicalRequirementEvidence({
      requirements: [...requirements].reverse(),
      studentCreditEvidence: [...evidence].reverse(),
      unresolvedConflicts: [],
    });

    expect(first).toEqual(shuffled);
    expect(first.contributions).toEqual([]);
    expect(first.diagnostics).toEqual([
      expect.objectContaining({
        status: "MANUAL_REVIEW",
        reason: "AMBIGUOUS_CANONICAL_CREDIT_MAPPING",
        provenance: expect.objectContaining({
          canonicalFactIds: ["evidence-a", "evidence-b"],
          studentCreditRecordIds: ["credit-shared"],
          requirementIds: ["req-a", "req-b"],
          academicRuleIds: ["rule-req-a", "rule-req-b"],
          sourceIds: ["source-a", "source-b"],
          claimVersionIds: ["claim-a", "claim-b"],
        }),
      }),
    ]);
  });

  it.each([
    ["malformed same-requirement member", [
      creditEvidence("evidence-valid", "req-a", {
        studentCreditRecordId: "credit-shared",
        sourceIds: ["source-valid"],
        claimVersionIds: ["claim-valid"],
      }),
      creditEvidence("evidence-other", "   ", {
        studentCreditRecordId: "credit-shared",
        sourceIds: ["source-other"],
        claimVersionIds: ["claim-other"],
      }),
    ]],
    ["unsupported same-requirement member", [
      creditEvidence("evidence-valid", "req-a", {
        studentCreditRecordId: "credit-shared",
        sourceIds: ["source-valid"],
        claimVersionIds: ["claim-valid"],
      }),
      creditEvidence("evidence-other", "req-a", {
        studentCreditRecordId: "credit-shared",
        kind: "rejected_credit",
        sourceIds: ["source-other"],
        claimVersionIds: ["claim-other"],
      }),
    ]],
    ["unmatched cross-requirement member", [
      creditEvidence("evidence-valid", "req-a", {
        studentCreditRecordId: "credit-shared",
        sourceIds: ["source-valid"],
        claimVersionIds: ["claim-valid"],
      }),
      creditEvidence("evidence-other", "unknown", {
        studentCreditRecordId: "credit-shared",
        sourceIds: ["source-other"],
        claimVersionIds: ["claim-other"],
      }),
    ]],
    ["rule-mismatched cross-requirement member", [
      creditEvidence("evidence-valid", "req-a", {
        studentCreditRecordId: "credit-shared",
        sourceIds: ["source-valid"],
        claimVersionIds: ["claim-valid"],
      }),
      creditEvidence("evidence-other", "req-b", {
        studentCreditRecordId: "credit-shared",
        academicRuleId: "rule-other",
        sourceIds: ["source-other"],
        claimVersionIds: ["claim-other"],
      }),
    ]],
    ["duplicate canonical evidence identity", [
      creditEvidence("evidence-shared", "req-a", {
        studentCreditRecordId: "credit-shared",
        sourceIds: ["source-valid"],
        claimVersionIds: ["claim-valid"],
      }),
      creditEvidence("evidence-shared", "req-b", {
        studentCreditRecordId: "credit-shared",
        sourceIds: ["source-other"],
        claimVersionIds: ["claim-other"],
      }),
    ]],
  ] as const)("quarantines a repeated student record before filtering: %s", (
    _label,
    evidence,
  ) => {
    const requirements = [requirement("req-a"), requirement("req-b")];
    const first = normalizeCanonicalRequirementEvidence({
      requirements,
      studentCreditEvidence: evidence,
      unresolvedConflicts: [],
    });
    const shuffled = normalizeCanonicalRequirementEvidence({
      requirements: [...requirements].reverse(),
      studentCreditEvidence: [...evidence].reverse(),
      unresolvedConflicts: [],
    });

    expect(first).toEqual(shuffled);
    expect(first.contributions).toEqual([]);
    expect(first.diagnostics).toEqual([
      expect.objectContaining({
        status: "MANUAL_REVIEW",
        reason: "AMBIGUOUS_CANONICAL_CREDIT_MAPPING",
        provenance: expect.objectContaining({
          canonicalFactIds: evidence[0].evidenceId === evidence[1].evidenceId
            ? [evidence[0].evidenceId]
            : ["evidence-other", "evidence-valid"],
          studentCreditRecordIds: ["credit-shared"],
          sourceIds: ["source-other", "source-valid"],
          claimVersionIds: ["claim-other", "claim-valid"],
        }),
      }),
    ]);
  });

  it.each([
    ["null/null", null, null, true],
    ["equal non-null", "rule-req-1", "rule-req-1", true],
    ["null/non-null", "rule-req-1", null, false],
    ["non-null/null", null, "rule-other", false],
    ["unequal non-null", "rule-req-1", "rule-other", false],
  ] as const)("matches credit rule identities exactly for %s", (
    _label,
    requirementRuleId,
    evidenceRuleId,
    accepted,
  ) => {
    const output = normalizeCanonicalRequirementEvidence({
      requirements: [
        requirement("req-1", { academicRuleId: requirementRuleId }),
      ],
      studentCreditEvidence: [
        creditEvidence("evidence-1", "req-1", {
          academicRuleId: evidenceRuleId,
        }),
      ],
      unresolvedConflicts: [],
    });

    expect(output.contributions).toHaveLength(accepted ? 1 : 0);
    expect(output.diagnostics.map((item) => item.reason)).toEqual(
      accepted ? [] : ["CANONICAL_ASSOCIATION_RULE_MISMATCH"],
    );
  });

  it.each([
    ["null/null", null, null, true],
    ["equal non-null", "rule-req-1", "rule-req-1", true],
    ["null/non-null", "rule-req-1", null, false],
    ["non-null/null", null, "rule-other", false],
    ["unequal non-null", "rule-req-1", "rule-other", false],
  ] as const)("matches conflict rule identities exactly for %s", (
    _label,
    requirementRuleId,
    conflictRuleId,
    accepted,
  ) => {
    const output = normalizeCanonicalRequirementEvidence({
      requirements: [
        requirement("req-1", { academicRuleId: requirementRuleId }),
      ],
      studentCreditEvidence: [],
      unresolvedConflicts: [
        conflictEvidence("conflict-1", "req-1", {
          academicRuleId: conflictRuleId,
        }),
      ],
    });

    expect(output.conflicts).toHaveLength(accepted ? 1 : 0);
    expect(output.diagnostics.map((item) => item.reason)).toEqual(
      accepted ? [] : ["CANONICAL_CONFLICT_RULE_MISMATCH"],
    );
  });

  it("preserves immutable canonical evidence identity while remaining evaluator-compatible", () => {
    const normalized = normalizeCanonicalRequirementEvidence({
      requirements: [requirement("req-1")],
      studentCreditEvidence: [creditEvidence("evidence-1", "req-1")],
      unresolvedConflicts: [],
    });

    expect(normalized.contributions[0].canonicalFactIds).toEqual([
      "evidence-1",
    ]);
    expect(Object.isFrozen(normalized.contributions[0].canonicalFactIds)).toBe(
      true,
    );
    expect(evaluateQuantitativeRequirements({
      requirements: normalized.requirements,
      contributions: normalized.contributions,
      conflicts: normalized.conflicts,
    })[0]).toMatchObject({
      requirementId: "req-1",
      status: "PARTIAL",
    });
  });

  it.each([
    ["blank requirement identity", {
      requirements: [requirement("   ")],
      studentCreditEvidence: [],
      unresolvedConflicts: [],
    }, "INVALID_CANONICAL_REQUIREMENT_IDENTITY"],
    ["blank credit-record identity", {
      requirements: [requirement("req-1")],
      studentCreditEvidence: [
        creditEvidence("evidence-1", "req-1", {
          studentCreditRecordId: "",
        }),
      ],
      unresolvedConflicts: [],
    }, "INVALID_CANONICAL_CREDIT_EVIDENCE_IDENTITY"],
    ["blank conflict identity", {
      requirements: [requirement("req-1")],
      studentCreditEvidence: [],
      unresolvedConflicts: [conflictEvidence("   ", "req-1")],
    }, "INVALID_CANONICAL_CONFLICT_IDENTITY"],
  ] as const)("fails closed for %s", (_label, input, reason) => {
    const output = normalizeCanonicalRequirementEvidence(input);

    expect(output.diagnostics).toEqual([
      expect.objectContaining({ status: "MANUAL_REVIEW", reason }),
    ]);
  });

  it.each([
    ["unsupported requirement kind", requirement("req-1", { kind: "choice" })],
    ["unsupported requirement unit", requirement("req-1", { unit: "hours" })],
    ["missing requirement quantity", requirement("req-1", {
      requiredAmount: null,
    })],
    ["unsupported credit kind", requirement("req-1")],
  ])("fails closed for %s", (label, canonicalRequirement) => {
    const input: CanonicalEvidenceNormalizationInput = {
      requirements: [canonicalRequirement],
      studentCreditEvidence: label === "unsupported credit kind"
        ? [creditEvidence("evidence-1", "req-1", { kind: "rejected_credit" })]
        : [],
      unresolvedConflicts: [],
    };
    const output = normalizeCanonicalRequirementEvidence(input);

    expect(output.diagnostics).toHaveLength(1);
    expect(output.diagnostics[0].status).toBe("MANUAL_REVIEW");
  });

  it("does not guess unmatched or rule-mismatched explicit associations", () => {
    const output = normalizeCanonicalRequirementEvidence({
      requirements: [requirement("req-1")],
      studentCreditEvidence: [
        creditEvidence("evidence-unmatched", "unknown"),
        creditEvidence("evidence-mismatch", "req-1", {
          academicRuleId: "rule-other",
        }),
      ],
      unresolvedConflicts: [
        conflictEvidence("conflict-unmatched", "unknown"),
        conflictEvidence("conflict-mismatch", "req-1", {
          academicRuleId: "rule-other",
        }),
      ],
    });

    expect(output.contributions).toEqual([]);
    expect(output.conflicts).toEqual([]);
    expect(output.diagnostics.map((item) => item.reason)).toEqual([
      "CANONICAL_ASSOCIATION_RULE_MISMATCH",
      "CANONICAL_CONFLICT_RULE_MISMATCH",
      "UNMATCHED_CANONICAL_CONFLICT_ASSOCIATION",
      "UNMATCHED_CANONICAL_CREDIT_ASSOCIATION",
    ]);
    expect(output.diagnostics[0].provenance).toMatchObject({
      academicRuleIds: ["rule-other", "rule-req-1"],
      requirementIds: ["req-1"],
      sourceIds: [
        "source-credit-evidence-mismatch",
        "source-requirement-req-1",
      ],
      claimVersionIds: [
        "claim-credit-evidence-mismatch",
        "claim-requirement-req-1",
      ],
    });
    expect(output.diagnostics[1].provenance).toMatchObject({
      academicRuleIds: ["rule-other", "rule-req-1"],
      requirementIds: ["req-1"],
      sourceIds: [
        "source-conflict-conflict-mismatch",
        "source-requirement-req-1",
      ],
      claimVersionIds: [
        "claim-conflict-conflict-mismatch",
        "claim-requirement-req-1",
      ],
    });
  });

  it("fails closed for unsupported or incomplete credit and conflict facts", () => {
    const output = normalizeCanonicalRequirementEvidence({
      requirements: [requirement("req-1")],
      studentCreditEvidence: [
        creditEvidence("evidence-unit", "req-1", { unit: "hours" }),
        creditEvidence("evidence-amount", "req-1", { amount: null }),
      ],
      unresolvedConflicts: [
        conflictEvidence("conflict-resolved", "req-1", {
          status: "resolved",
        }),
      ],
    });

    expect(output.contributions).toEqual([]);
    expect(output.conflicts).toEqual([]);
    expect(output.diagnostics.map((item) => item.reason)).toEqual([
      "INCOMPLETE_CANONICAL_CREDIT_QUANTITY",
      "UNSUPPORTED_CANONICAL_CONFLICT_STATUS",
      "UNSUPPORTED_CANONICAL_CREDIT_UNIT",
    ]);
  });

  it("fails closed without silently dropping malformed supplied provenance", () => {
    const credits = [
      creditEvidence("evidence-blank-verification", "req-valid", {
        verificationEventId: " ",
      }),
      creditEvidence("evidence-blank-decision", "req-valid", {
        decisionId: "",
      }),
    ];
    const conflicts = [
      conflictEvidence("conflict-blank-source", "req-valid", {
        sourceIds: ["source-valid", "   "],
      }),
    ];
    const first = normalizeCanonicalRequirementEvidence({
      requirements: [
        requirement("req-invalid", {
          claimVersionIds: ["claim-valid", ""],
        }),
        requirement("req-valid"),
      ],
      studentCreditEvidence: credits,
      unresolvedConflicts: conflicts,
    });
    const shuffled = normalizeCanonicalRequirementEvidence({
      requirements: [
        requirement("req-valid"),
        requirement("req-invalid", {
          claimVersionIds: ["", "claim-valid"],
        }),
      ],
      studentCreditEvidence: [...credits].reverse(),
      unresolvedConflicts: [...conflicts].reverse(),
    });

    expect(first).toEqual(shuffled);
    expect(first.requirements.map((item) => item.requirementId)).toEqual([
      "req-valid",
    ]);
    expect(first.contributions).toEqual([]);
    expect(first.conflicts).toEqual([]);
    expect(first.diagnostics.map((item) => item.reason)).toEqual([
      "INVALID_CANONICAL_CONFLICT_PROVENANCE",
      "INVALID_CANONICAL_CREDIT_PROVENANCE",
      "INVALID_CANONICAL_CREDIT_PROVENANCE",
      "INVALID_CANONICAL_REQUIREMENT_PROVENANCE",
    ]);
  });

  it("deeply freezes output and does not mutate caller input", () => {
    const input: CanonicalEvidenceNormalizationInput = {
      requirements: [requirement("req-1")],
      studentCreditEvidence: [creditEvidence("evidence-1", "req-1")],
      unresolvedConflicts: [conflictEvidence("conflict-1", "req-1")],
    };
    const before = structuredClone(input);
    const output = normalizeCanonicalRequirementEvidence(input);

    expect(input).toEqual(before);
    expect(Object.isFrozen(output)).toBe(true);
    for (const collection of [
      output.requirements,
      output.contributions,
      output.conflicts,
      output.diagnostics,
    ]) {
      expect(Object.isFrozen(collection)).toBe(true);
      for (const item of collection) {
        expect(Object.isFrozen(item)).toBe(true);
      }
    }
    const diagnosticOutput = normalizeCanonicalRequirementEvidence({
      requirements: [requirement("req-1")],
      studentCreditEvidence: [creditEvidence("evidence-1", "unknown")],
      unresolvedConflicts: [],
    });
    expect(Object.isFrozen(diagnosticOutput.diagnostics[0].provenance)).toBe(
      true,
    );
    for (const value of Object.values(
      diagnosticOutput.diagnostics[0].provenance,
    )) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    for (const item of [
      ...output.requirements,
      ...output.contributions,
      ...output.conflicts,
    ]) {
      for (const value of Object.values(item)) {
        if (Array.isArray(value)) {
          expect(Object.isFrozen(value)).toBe(true);
        }
      }
    }
  });
});