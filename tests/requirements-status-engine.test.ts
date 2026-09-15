import { describe, expect, it } from "vitest";

import {
  evaluateQuantitativeRequirements,
  type QuantitativeRequirementsInput,
} from "@shared/requirements-status-engine";

const requirement = (
  requirementId: string,
  requiredAmount: string | null,
  overrides: Partial<QuantitativeRequirementsInput["requirements"][number]> = {},
): QuantitativeRequirementsInput["requirements"][number] => ({
  requirementId,
  academicRuleId: `rule-${requirementId}`,
  kind: "minimum",
  unit: "credits",
  requiredAmount,
  sourceIds: [`source-requirement-${requirementId}`],
  claimVersionIds: [`claim-requirement-${requirementId}`],
  ...overrides,
});

const contribution = (
  requirementId: string,
  studentCreditRecordId: string,
  amount: string | null,
  suffix: string,
): QuantitativeRequirementsInput["contributions"][number] => ({
  requirementId,
  studentCreditRecordId,
  amount,
  verificationEventId: `verification-${suffix}`,
  decisionId: `decision-${suffix}`,
  exceptionIds: [`exception-${suffix}`],
  sourceIds: [`source-credit-${suffix}`],
  claimVersionIds: [`claim-credit-${suffix}`],
});

const conflict = (
  conflictId: string,
  requirementId: string,
  academicRuleId: string | null,
  suffix: string,
) => ({
  conflictId,
  requirementId,
  academicRuleId,
  sourceIds: [`source-conflict-${suffix}`],
  claimVersionIds: [`claim-conflict-${suffix}`],
});

describe("evaluateQuantitativeRequirements", () => {
  it("evaluates decimal quantities without floating-point drift", () => {
    const input: QuantitativeRequirementsInput = {
      requirements: [
        requirement("satisfied", "0.3"),
        requirement("partial", "1.00"),
        requirement("missing", "3"),
      ],
      contributions: [
        contribution("satisfied", "credit-2", "0.2", "2"),
        contribution("partial", "credit-3", "0.25", "3"),
        contribution("satisfied", "credit-1", "0.1", "1"),
      ],
    };

    expect(evaluateQuantitativeRequirements(input).map((result) => ({
      requirementId: result.requirementId,
      status: result.status,
      requiredAmount: result.requiredAmount,
      appliedAmount: result.appliedAmount,
      remainingAmount: result.remainingAmount,
    }))).toEqual([
      {
        requirementId: "missing",
        status: "MISSING",
        requiredAmount: "3",
        appliedAmount: "0",
        remainingAmount: "3",
      },
      {
        requirementId: "partial",
        status: "PARTIAL",
        requiredAmount: "1",
        appliedAmount: "0.25",
        remainingAmount: "0.75",
      },
      {
        requirementId: "satisfied",
        status: "SATISFIED",
        requiredAmount: "0.3",
        appliedAmount: "0.3",
        remainingAmount: "0",
      },
    ]);
  });

  it.each([
    ["unknown requirement kind", requirement("review", "3", { kind: "future-kind" })],
    ["unknown unit", requirement("review", "3", { unit: "hours" })],
    ["missing required amount", requirement("review", null)],
    ["invalid required amount", requirement("review", "three")],
    ["negative required amount", requirement("review", "-1")],
  ])("fails closed for %s", (_label, unsafeRequirement) => {
    const results = evaluateQuantitativeRequirements({
      requirements: [unsafeRequirement],
      contributions: [],
    });

    expect(results[0].status).toBe("MANUAL_REVIEW");
    expect(results[0].reason).toBeDefined();
  });

  it.each([null, "", "NaN", "-0.1"])(
    "fails closed for an unusable contribution amount %j",
    (amount) => {
      const results = evaluateQuantitativeRequirements({
        requirements: [requirement("review", "3")],
        contributions: [contribution("review", "credit-1", amount, "1")],
      });

      expect(results[0].status).toBe("MANUAL_REVIEW");
    },
  );

  it("preserves complete, sorted provenance on every result", () => {
    const results = evaluateQuantitativeRequirements({
      requirements: [requirement("req-1", "2")],
      contributions: [
        contribution("req-1", "credit-z", "1", "z"),
        contribution("req-1", "credit-a", "1", "a"),
      ],
    });

    expect(results[0].provenance).toEqual({
      studentCreditRecordIds: ["credit-a", "credit-z"],
      requirementIds: ["req-1"],
      academicRuleIds: ["rule-req-1"],
      verificationEventIds: ["verification-a", "verification-z"],
      decisionIds: ["decision-a", "decision-z"],
      exceptionIds: ["exception-a", "exception-z"],
      conflictIds: [],
      sourceIds: [
        "source-credit-a",
        "source-credit-z",
        "source-requirement-req-1",
      ],
      claimVersionIds: [
        "claim-credit-a",
        "claim-credit-z",
        "claim-requirement-req-1",
      ],
    });
  });

  it("is deterministic for shuffled equivalent inputs and does not mutate them", () => {
    const requirements = [
      requirement("req-b", "2"),
      requirement("req-a", "0.3"),
    ];
    const contributions = [
      contribution("req-b", "credit-b", "1", "b"),
      contribution("req-a", "credit-a2", "0.2", "a2"),
      contribution("req-a", "credit-a1", "0.1", "a1"),
    ];
    const input = { requirements, contributions } as const;
    const before = structuredClone(input);

    const first = evaluateQuantitativeRequirements(input);
    const shuffled = evaluateQuantitativeRequirements({
      requirements: [...requirements].reverse(),
      contributions: [contributions[2], contributions[0], contributions[1]],
    });

    expect(first).toEqual(shuffled);
    expect(input).toEqual(before);
    expect(first.map((result) => result.requirementId)).toEqual(["req-a", "req-b"]);
  });

  it("fails closed deterministically for ambiguous duplicate requirement identities", () => {
    const firstRequirement = requirement("duplicate", "3", {
      sourceIds: ["source-requirement-a"],
      claimVersionIds: ["claim-requirement-a"],
    });
    const secondRequirement = requirement("duplicate", "4", {
      sourceIds: ["source-requirement-b"],
      claimVersionIds: ["claim-requirement-b"],
    });
    const contributions = [
      contribution("duplicate", "credit-b", "2", "b"),
      contribution("duplicate", "credit-a", "1", "a"),
    ];

    const first = evaluateQuantitativeRequirements({
      requirements: [firstRequirement, secondRequirement],
      contributions,
    });
    const shuffled = evaluateQuantitativeRequirements({
      requirements: [secondRequirement, firstRequirement],
      contributions: [...contributions].reverse(),
    });

    expect(first).toEqual(shuffled);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      requirementId: "duplicate",
      academicRuleId: "rule-duplicate",
      status: "MANUAL_REVIEW",
      reason: "AMBIGUOUS_REQUIREMENT_IDENTITY",
      requiredAmount: null,
      appliedAmount: null,
      remainingAmount: null,
    });
    expect(first[0].provenance).toMatchObject({
      studentCreditRecordIds: ["credit-a", "credit-b"],
      requirementIds: ["duplicate"],
      academicRuleIds: ["rule-duplicate"],
      sourceIds: [
        "source-credit-a",
        "source-credit-b",
        "source-requirement-a",
        "source-requirement-b",
      ],
      claimVersionIds: [
        "claim-credit-a",
        "claim-credit-b",
        "claim-requirement-a",
        "claim-requirement-b",
      ],
    });
  });

  it("fails closed when a duplicate requirement identity has different rule identities", () => {
    const firstRequirement = requirement("duplicate", "3", {
      academicRuleId: "rule-b",
      sourceIds: ["source-requirement-b"],
      claimVersionIds: ["claim-requirement-b"],
    });
    const secondRequirement = requirement("duplicate", "4", {
      academicRuleId: "rule-a",
      sourceIds: ["source-requirement-a"],
      claimVersionIds: ["claim-requirement-a"],
    });
    const contributions = [
      contribution("duplicate", "credit-b", "2", "b"),
      contribution("duplicate", "credit-a", "1", "a"),
    ];

    const first = evaluateQuantitativeRequirements({
      requirements: [firstRequirement, secondRequirement],
      contributions,
    });
    const shuffled = evaluateQuantitativeRequirements({
      requirements: [secondRequirement, firstRequirement],
      contributions: [...contributions].reverse(),
    });

    expect(first).toEqual(shuffled);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      requirementId: "duplicate",
      academicRuleId: null,
      status: "MANUAL_REVIEW",
      reason: "AMBIGUOUS_REQUIREMENT_IDENTITY",
    });
    expect(first[0].provenance).toMatchObject({
      studentCreditRecordIds: ["credit-a", "credit-b"],
      requirementIds: ["duplicate"],
      academicRuleIds: ["rule-a", "rule-b"],
      sourceIds: [
        "source-credit-a",
        "source-credit-b",
        "source-requirement-a",
        "source-requirement-b",
      ],
      claimVersionIds: [
        "claim-credit-a",
        "claim-credit-b",
        "claim-requirement-a",
        "claim-requirement-b",
      ],
    });
  });

  it("keeps an ambiguous duplicate unattributed when rule identity is null versus non-null", () => {
    const withoutRule = requirement("duplicate", "3", {
      academicRuleId: null,
      sourceIds: ["source-requirement-without-rule"],
      claimVersionIds: ["claim-requirement-without-rule"],
    });
    const withRule = requirement("duplicate", "4", {
      academicRuleId: "rule-a",
      sourceIds: ["source-requirement-with-rule"],
      claimVersionIds: ["claim-requirement-with-rule"],
    });

    const first = evaluateQuantitativeRequirements({
      requirements: [withoutRule, withRule],
      contributions: [],
    });
    const shuffled = evaluateQuantitativeRequirements({
      requirements: [withRule, withoutRule],
      contributions: [],
    });

    expect(first).toEqual(shuffled);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      requirementId: "duplicate",
      academicRuleId: null,
      status: "MANUAL_REVIEW",
      reason: "AMBIGUOUS_REQUIREMENT_IDENTITY",
    });
    expect(first[0].provenance).toMatchObject({
      requirementIds: ["duplicate"],
      academicRuleIds: ["rule-a"],
      sourceIds: [
        "source-requirement-with-rule",
        "source-requirement-without-rule",
      ],
      claimVersionIds: [
        "claim-requirement-with-rule",
        "claim-requirement-without-rule",
      ],
    });
  });

  it("freezes the complete returned result structure", () => {
    const results = evaluateQuantitativeRequirements({
      requirements: [requirement("req-1", "3")],
      contributions: [contribution("req-1", "credit-1", "1", "1")],
    });

    expect(Object.isFrozen(results)).toBe(true);
    expect(Object.isFrozen(results[0])).toBe(true);
    expect(Object.isFrozen(results[0].provenance)).toBe(true);
    for (const references of Object.values(results[0].provenance)) {
      expect(Object.isFrozen(references)).toBe(true);
    }
  });

  it.each([
    ["identical", "1"],
    ["conflicting", "2"],
  ])(
    "fails closed deterministically for %s duplicate credit contributions",
    (_label, secondAmount) => {
      const firstContribution = contribution("req-1", "credit-1", "1", "a");
      const secondContribution = {
        ...contribution("req-1", "credit-1", secondAmount, "b"),
        studentCreditRecordId: "credit-1",
      };

      const first = evaluateQuantitativeRequirements({
        requirements: [requirement("req-1", "2")],
        contributions: [firstContribution, secondContribution],
      });
      const shuffled = evaluateQuantitativeRequirements({
        requirements: [requirement("req-1", "2")],
        contributions: [secondContribution, firstContribution],
      });

      expect(first).toEqual(shuffled);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({
        requirementId: "req-1",
        status: "MANUAL_REVIEW",
        reason: "AMBIGUOUS_CONTRIBUTION_IDENTITY",
        requiredAmount: null,
        appliedAmount: null,
        remainingAmount: null,
      });
      expect(first[0].provenance).toMatchObject({
        studentCreditRecordIds: ["credit-1"],
        verificationEventIds: ["verification-a", "verification-b"],
        decisionIds: ["decision-a", "decision-b"],
        exceptionIds: ["exception-a", "exception-b"],
        sourceIds: [
          "source-credit-a",
          "source-credit-b",
          "source-requirement-req-1",
        ],
        claimVersionIds: [
          "claim-credit-a",
          "claim-credit-b",
          "claim-requirement-req-1",
        ],
      });
    },
  );

  it.each([
    ["alongside a supplied requirement", [requirement("known", "3")]],
    ["with an empty requirements set", []],
  ])(
    "preserves unmatched contributions %s in a deterministic fail-closed result",
    (_label, requirements) => {
      const unmatchedA = contribution("unknown-b", "credit-b", "2", "b");
      const unmatchedB = contribution("unknown-a", "credit-a", "1", "a");

      const first = evaluateQuantitativeRequirements({
        requirements,
        contributions: [unmatchedA, unmatchedB],
      });
      const shuffled = evaluateQuantitativeRequirements({
        requirements: [...requirements].reverse(),
        contributions: [unmatchedB, unmatchedA],
      });
      const unmatchedResult = first.find(
        (result) => result.reason === "UNMATCHED_CONTRIBUTION_REQUIREMENT",
      );

      expect(first).toEqual(shuffled);
      expect(unmatchedResult).toMatchObject({
        requirementId: null,
        academicRuleId: null,
        status: "MANUAL_REVIEW",
        requiredAmount: null,
        appliedAmount: null,
        remainingAmount: null,
      });
      expect(unmatchedResult?.provenance).toMatchObject({
        studentCreditRecordIds: ["credit-a", "credit-b"],
        requirementIds: ["unknown-a", "unknown-b"],
        academicRuleIds: [],
        verificationEventIds: ["verification-a", "verification-b"],
        decisionIds: ["decision-a", "decision-b"],
        exceptionIds: ["exception-a", "exception-b"],
        sourceIds: ["source-credit-a", "source-credit-b"],
        claimVersionIds: ["claim-credit-a", "claim-credit-b"],
      });
    },
  );

  it("fails closed deterministically for empty and whitespace requirement identities", () => {
    const emptyRequirement = requirement("", "1", {
      academicRuleId: "rule-empty",
      sourceIds: ["source-requirement-empty"],
      claimVersionIds: ["claim-requirement-empty"],
    });
    const whitespaceRequirement = requirement("   ", "1", {
      academicRuleId: "rule-whitespace",
      sourceIds: ["source-requirement-whitespace"],
      claimVersionIds: ["claim-requirement-whitespace"],
    });
    const contributions = [
      contribution("", "credit-empty-target", "1", "empty-target"),
      contribution("   ", "credit-whitespace-target", "1", "whitespace-target"),
    ];

    const first = evaluateQuantitativeRequirements({
      requirements: [emptyRequirement, whitespaceRequirement],
      contributions,
    });
    const shuffled = evaluateQuantitativeRequirements({
      requirements: [whitespaceRequirement, emptyRequirement],
      contributions: [...contributions].reverse(),
    });

    expect(first).toEqual(shuffled);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      requirementId: null,
      academicRuleId: null,
      status: "MANUAL_REVIEW",
      reason: "INVALID_REQUIREMENT_IDENTITY",
    });
    expect(first[0].provenance).toMatchObject({
      studentCreditRecordIds: [
        "credit-empty-target",
        "credit-whitespace-target",
      ],
      requirementIds: [],
      academicRuleIds: ["rule-empty", "rule-whitespace"],
      sourceIds: [
        "source-credit-empty-target",
        "source-credit-whitespace-target",
        "source-requirement-empty",
        "source-requirement-whitespace",
      ],
      claimVersionIds: [
        "claim-credit-empty-target",
        "claim-credit-whitespace-target",
        "claim-requirement-empty",
        "claim-requirement-whitespace",
      ],
    });
  });

  it("fails closed deterministically for empty and whitespace credit-record identities", () => {
    const contributions = [
      contribution("req-1", "", "1", "empty-credit"),
      contribution("req-1", "   ", "1", "whitespace-credit"),
    ];

    const first = evaluateQuantitativeRequirements({
      requirements: [requirement("req-1", "2")],
      contributions,
    });
    const shuffled = evaluateQuantitativeRequirements({
      requirements: [requirement("req-1", "2")],
      contributions: [...contributions].reverse(),
    });

    expect(first).toEqual(shuffled);
    expect(first[0]).toMatchObject({
      requirementId: "req-1",
      status: "MANUAL_REVIEW",
      reason: "INVALID_STUDENT_CREDIT_RECORD_IDENTITY",
    });
    expect(first[0].provenance).toMatchObject({
      studentCreditRecordIds: [],
      verificationEventIds: [
        "verification-empty-credit",
        "verification-whitespace-credit",
      ],
      decisionIds: ["decision-empty-credit", "decision-whitespace-credit"],
      sourceIds: [
        "source-credit-empty-credit",
        "source-credit-whitespace-credit",
        "source-requirement-req-1",
      ],
    });
  });

  it.each(["", "   "])(
    "fails closed for an invalid non-null rule identity %j",
    (academicRuleId) => {
      const results = evaluateQuantitativeRequirements({
        requirements: [requirement("req-1", "1", { academicRuleId })],
        contributions: [contribution("req-1", "credit-1", "1", "1")],
      });

      expect(results[0]).toMatchObject({
        requirementId: "req-1",
        academicRuleId: null,
        status: "MANUAL_REVIEW",
        reason: "INVALID_ACADEMIC_RULE_IDENTITY",
      });
      expect(results[0].provenance).toMatchObject({
        requirementIds: ["req-1"],
        academicRuleIds: [],
        studentCreditRecordIds: ["credit-1"],
      });
    },
  );

  it.each([
    ["excessive magnitude", "10000"],
    ["excessive serialized length", "00000000000000001"],
    ["excessive fractional precision", "1.001"],
  ])("fails closed for a required amount with %s", (_label, requiredAmount) => {
    const results = evaluateQuantitativeRequirements({
      requirements: [requirement("req-1", requiredAmount)],
      contributions: [],
    });

    expect(results[0]).toMatchObject({
      status: "MANUAL_REVIEW",
      reason: "UNUSABLE_REQUIRED_AMOUNT",
    });
  });

  it.each([
    ["excessive magnitude", "10000"],
    ["excessive serialized length", "00000000000000001"],
    ["excessive fractional precision", "1.001"],
  ])("fails closed for a contribution amount with %s", (_label, amount) => {
    const results = evaluateQuantitativeRequirements({
      requirements: [requirement("req-1", "3")],
      contributions: [contribution("req-1", "credit-1", amount, "1")],
    });

    expect(results[0]).toMatchObject({
      status: "MANUAL_REVIEW",
      reason: "UNUSABLE_CONTRIBUTION_AMOUNT",
    });
  });

  describe("unresolved conflict projection", () => {
    it("projects valid caller-associated conflicts with complete deterministic provenance", () => {
      const input: QuantitativeRequirementsInput = {
        requirements: [requirement("req-1", "3")],
        contributions: [contribution("req-1", "credit-1", "3", "credit")],
        conflicts: [
          conflict("conflict-z", "req-1", "rule-req-1", "z"),
          conflict("conflict-a", "req-1", null, "a"),
        ],
      };

      const result = evaluateQuantitativeRequirements(input)[0];

      expect(result).toMatchObject({
        projectionKind: "INFORMATIONAL_ONLY",
        requirementId: "req-1",
        academicRuleId: "rule-req-1",
        status: "CONFLICT",
        requiredAmount: null,
        appliedAmount: null,
        remainingAmount: null,
        reason: "UNRESOLVED_CANONICAL_CONFLICT",
      });
      expect(result.provenance).toEqual({
        studentCreditRecordIds: ["credit-1"],
        requirementIds: ["req-1"],
        academicRuleIds: ["rule-req-1"],
        verificationEventIds: ["verification-credit"],
        decisionIds: ["decision-credit"],
        exceptionIds: ["exception-credit"],
        conflictIds: ["conflict-a", "conflict-z"],
        sourceIds: [
          "source-conflict-a",
          "source-conflict-z",
          "source-credit-credit",
          "source-requirement-req-1",
        ],
        claimVersionIds: [
          "claim-conflict-a",
          "claim-conflict-z",
          "claim-credit-credit",
          "claim-requirement-req-1",
        ],
      });
    });

    it("leaves existing quantitative output byte-equivalent when conflicts are empty", () => {
      const base = {
        requirements: [requirement("req-1", "3")],
        contributions: [contribution("req-1", "credit-1", "1", "credit")],
      };

      expect(evaluateQuantitativeRequirements({
        ...base,
        conflicts: [],
      })).toEqual(evaluateQuantitativeRequirements(base));
    });

    it("is deterministic for shuffled conflicts and does not mutate or return mutable output", () => {
      const input: QuantitativeRequirementsInput = {
        requirements: [
          requirement("req-b", "3"),
          requirement("req-a", "3"),
        ],
        contributions: [
          contribution("req-b", "credit-b", "1", "b"),
          contribution("req-a", "credit-a", "1", "a"),
        ],
        conflicts: [
          conflict("conflict-b", "req-b", "rule-req-b", "b"),
          conflict("conflict-a", "req-a", "rule-req-a", "a"),
        ],
      };
      const before = structuredClone(input);

      const first = evaluateQuantitativeRequirements(input);
      const shuffled = evaluateQuantitativeRequirements({
        requirements: [...input.requirements].reverse(),
        contributions: [...input.contributions].reverse(),
        conflicts: [...input.conflicts].reverse(),
      });

      expect(first).toEqual(shuffled);
      expect(input).toEqual(before);
      expect(Object.isFrozen(first)).toBe(true);
      for (const result of first) {
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.provenance)).toBe(true);
        for (const values of Object.values(result.provenance)) {
          expect(Object.isFrozen(values)).toBe(true);
        }
      }
    });

    it.each(["", "   "])(
      "fails closed for an invalid conflict identity %j",
      (conflictId) => {
        const result = evaluateQuantitativeRequirements({
          requirements: [requirement("req-1", "1")],
          contributions: [contribution("req-1", "credit-1", "1", "credit")],
          conflicts: [
            conflict(conflictId, "req-1", "rule-req-1", "invalid"),
          ],
        })[0];

        expect(result).toMatchObject({
          requirementId: "req-1",
          status: "MANUAL_REVIEW",
          reason: "INVALID_CONFLICT_IDENTITY",
        });
        expect(result.provenance).toMatchObject({
          conflictIds: [],
          sourceIds: [
            "source-conflict-invalid",
            "source-credit-credit",
            "source-requirement-req-1",
          ],
          claimVersionIds: [
            "claim-conflict-invalid",
            "claim-credit-credit",
            "claim-requirement-req-1",
          ],
        });
      },
    );

    it("fails closed deterministically for invalid and unmatched conflict targets", () => {
      const conflicts = [
        conflict("conflict-empty", "", null, "empty"),
        conflict("conflict-whitespace", "   ", null, "whitespace"),
        conflict("conflict-unmatched", "unknown", null, "unmatched"),
      ];

      const first = evaluateQuantitativeRequirements({
        requirements: [requirement("req-1", "1")],
        contributions: [],
        conflicts,
      });
      const shuffled = evaluateQuantitativeRequirements({
        requirements: [requirement("req-1", "1")],
        contributions: [],
        conflicts: [...conflicts].reverse(),
      });

      expect(first).toEqual(shuffled);
      expect(first.filter((result) => result.requirementId === null)).toEqual([
        expect.objectContaining({
          status: "MANUAL_REVIEW",
          reason: "INVALID_CONFLICT_REQUIREMENT_IDENTITY",
        }),
        expect.objectContaining({
          status: "MANUAL_REVIEW",
          reason: "UNMATCHED_CONFLICT_REQUIREMENT",
        }),
      ]);
      expect(first.find(
        (result) => result.reason === "UNMATCHED_CONFLICT_REQUIREMENT",
      )?.provenance.requirementIds).toEqual(["unknown"]);
      expect(first.flatMap((result) => result.provenance.conflictIds)).toEqual([
        "conflict-empty",
        "conflict-whitespace",
        "conflict-unmatched",
      ]);
    });

    it("fails closed when a conflict rule identity disagrees with its requirement", () => {
      const result = evaluateQuantitativeRequirements({
        requirements: [requirement("req-1", "1")],
        contributions: [contribution("req-1", "credit-1", "1", "credit")],
        conflicts: [
          conflict("conflict-1", "req-1", "rule-other", "mismatch"),
        ],
      })[0];

      expect(result).toMatchObject({
        requirementId: "req-1",
        status: "MANUAL_REVIEW",
        reason: "CONFLICT_RULE_IDENTITY_MISMATCH",
      });
      expect(result.provenance).toMatchObject({
        conflictIds: ["conflict-1"],
        academicRuleIds: ["rule-other", "rule-req-1"],
      });
    });

    it("does not let a conflict bypass an invalid requirement rule identity", () => {
      const result = evaluateQuantitativeRequirements({
        requirements: [
          requirement("req-1", "1", { academicRuleId: "   " }),
        ],
        contributions: [],
        conflicts: [conflict("conflict-1", "req-1", null, "conflict")],
      })[0];

      expect(result).toMatchObject({
        requirementId: "req-1",
        academicRuleId: null,
        status: "MANUAL_REVIEW",
        reason: "INVALID_ACADEMIC_RULE_IDENTITY",
      });
      expect(result.provenance).toMatchObject({
        conflictIds: ["conflict-1"],
        academicRuleIds: [],
        sourceIds: [
          "source-conflict-conflict",
          "source-requirement-req-1",
        ],
      });
    });

    it("fails closed for identical duplicate conflict identities", () => {
      const duplicate = conflict(
        "conflict-1",
        "req-1",
        "rule-req-1",
        "duplicate",
      );
      const result = evaluateQuantitativeRequirements({
        requirements: [requirement("req-1", "1")],
        contributions: [],
        conflicts: [duplicate, { ...duplicate }],
      })[0];

      expect(result).toMatchObject({
        requirementId: "req-1",
        status: "MANUAL_REVIEW",
        reason: "AMBIGUOUS_CONFLICT_IDENTITY",
      });
      expect(result.provenance.conflictIds).toEqual(["conflict-1"]);
    });

    it("fails closed for one conflict identity inconsistently targeting two requirements", () => {
      const input: QuantitativeRequirementsInput = {
        requirements: [
          requirement("req-a", "1"),
          requirement("req-b", "1"),
        ],
        contributions: [],
        conflicts: [
          conflict("conflict-1", "req-b", "rule-req-b", "b"),
          conflict("conflict-1", "req-a", "rule-req-a", "a"),
        ],
      };

      const first = evaluateQuantitativeRequirements(input);
      const shuffled = evaluateQuantitativeRequirements({
        requirements: [...input.requirements].reverse(),
        contributions: [],
        conflicts: [...input.conflicts].reverse(),
      });

      expect(first).toEqual(shuffled);
      expect(first).toHaveLength(2);
      expect(first.map((result) => ({
        requirementId: result.requirementId,
        status: result.status,
        reason: result.reason,
      }))).toEqual([
        {
          requirementId: "req-a",
          status: "MANUAL_REVIEW",
          reason: "AMBIGUOUS_CONFLICT_IDENTITY",
        },
        {
          requirementId: "req-b",
          status: "MANUAL_REVIEW",
          reason: "AMBIGUOUS_CONFLICT_IDENTITY",
        },
      ]);
      for (const result of first) {
        expect(result.provenance).toMatchObject({
          conflictIds: ["conflict-1"],
          requirementIds: ["req-a", "req-b"],
          academicRuleIds: ["rule-req-a", "rule-req-b"],
          sourceIds: [
            "source-conflict-a",
            "source-conflict-b",
            `source-requirement-${result.requirementId}`,
          ],
          claimVersionIds: [
            "claim-conflict-a",
            "claim-conflict-b",
            `claim-requirement-${result.requirementId}`,
          ],
        });
      }
    });

    it("consumes one duplicate conflict cohort spanning supplied and unmatched targets", () => {
      const conflicts = [
        conflict("conflict-1", "req-a", "rule-req-a", "supplied"),
        conflict("conflict-1", "unknown", "rule-unknown", "unmatched"),
      ];
      const first = evaluateQuantitativeRequirements({
        requirements: [requirement("req-a", "1")],
        contributions: [],
        conflicts,
      });
      const shuffled = evaluateQuantitativeRequirements({
        requirements: [requirement("req-a", "1")],
        contributions: [],
        conflicts: [...conflicts].reverse(),
      });

      expect(first).toEqual(shuffled);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({
        requirementId: "req-a",
        status: "MANUAL_REVIEW",
        reason: "AMBIGUOUS_CONFLICT_IDENTITY",
      });
      expect(first[0].provenance).toMatchObject({
        conflictIds: ["conflict-1"],
        requirementIds: ["req-a", "unknown"],
        academicRuleIds: ["rule-req-a", "rule-unknown"],
        sourceIds: [
          "source-conflict-supplied",
          "source-conflict-unmatched",
          "source-requirement-req-a",
        ],
        claimVersionIds: [
          "claim-conflict-supplied",
          "claim-conflict-unmatched",
          "claim-requirement-req-a",
        ],
      });
    });

    it("consumes one unmatched duplicate cohort before per-fact rule validation", () => {
      const conflicts = [
        conflict("conflict-1", "unknown-b", "   ", "invalid-rule"),
        conflict("conflict-1", "unknown-a", "rule-valid", "valid-rule"),
      ];
      const first = evaluateQuantitativeRequirements({
        requirements: [],
        contributions: [],
        conflicts,
      });
      const shuffled = evaluateQuantitativeRequirements({
        requirements: [],
        contributions: [],
        conflicts: [...conflicts].reverse(),
      });

      expect(first).toEqual(shuffled);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({
        requirementId: null,
        academicRuleId: null,
        status: "MANUAL_REVIEW",
        reason: "AMBIGUOUS_CONFLICT_IDENTITY",
      });
      expect(first[0].provenance).toMatchObject({
        conflictIds: ["conflict-1"],
        requirementIds: ["unknown-a", "unknown-b"],
        academicRuleIds: ["rule-valid"],
        sourceIds: [
          "source-conflict-invalid-rule",
          "source-conflict-valid-rule",
        ],
        claimVersionIds: [
          "claim-conflict-invalid-rule",
          "claim-conflict-valid-rule",
        ],
      });
    });
  });
});