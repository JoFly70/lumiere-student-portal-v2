/**
 * Informational-only deterministic requirements-status projection.
 *
 * This module is pure: it performs no I/O and exposes no persistence path.
 * Callers must supply already-selected canonical Knowledge Core and Student
 * Academic Record facts.
 */

export type QuantitativeRequirementStatus =
  | "SATISFIED"
  | "PARTIAL"
  | "MISSING"
  | "CONFLICT"
  | "MANUAL_REVIEW";

export interface QuantitativeRequirementInput {
  readonly requirementId: string;
  readonly academicRuleId: string | null;
  readonly kind: string;
  readonly unit: string;
  readonly requiredAmount: string | null;
  readonly sourceIds: readonly string[];
  readonly claimVersionIds: readonly string[];
}

export interface QuantitativeContributionInput {
  readonly requirementId: string;
  readonly studentCreditRecordId: string;
  readonly amount: string | null;
  readonly verificationEventId: string | null;
  readonly decisionId: string | null;
  readonly exceptionIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly claimVersionIds: readonly string[];
}

export interface QuantitativeConflictInput {
  readonly conflictId: string;
  readonly requirementId: string;
  readonly academicRuleId: string | null;
  readonly sourceIds: readonly string[];
  readonly claimVersionIds: readonly string[];
}

export interface QuantitativeRequirementsInput {
  readonly requirements: readonly QuantitativeRequirementInput[];
  readonly contributions: readonly QuantitativeContributionInput[];
  readonly conflicts?: readonly QuantitativeConflictInput[];
}

export interface RequirementResultProvenance {
  readonly studentCreditRecordIds: readonly string[];
  readonly requirementIds: readonly string[];
  readonly academicRuleIds: readonly string[];
  readonly verificationEventIds: readonly string[];
  readonly decisionIds: readonly string[];
  readonly exceptionIds: readonly string[];
  readonly conflictIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly claimVersionIds: readonly string[];
}

export interface QuantitativeRequirementResult {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly requirementId: string | null;
  readonly academicRuleId: string | null;
  readonly status: QuantitativeRequirementStatus;
  readonly requiredAmount: string | null;
  readonly appliedAmount: string | null;
  readonly remainingAmount: string | null;
  readonly reason: string | null;
  readonly provenance: RequirementResultProvenance;
}

interface Decimal {
  readonly coefficient: bigint;
  readonly scale: number;
}

/**
 * Canonical academic credit fields use numeric(6,2): at most four integer
 * digits and two fractional digits. The serialized-length cap rejects
 * pathological leading-zero inputs before BigInt parsing.
 */
const MAX_QUANTITY_INPUT_LENGTH = 16;
const MAX_QUANTITY_INTEGER_DIGITS = 4;
const MAX_QUANTITY_FRACTIONAL_DIGITS = 2;
const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

function parseNonnegativeDecimal(value: string | null): Decimal | null {
  if (
    typeof value !== "string"
    || value.length > MAX_QUANTITY_INPUT_LENGTH
    || !DECIMAL_PATTERN.test(value)
  ) {
    return null;
  }

  const [whole, fraction = ""] = value.split(".");
  const significantWhole = whole.replace(/^0+/, "") || "0";
  if (
    significantWhole.length > MAX_QUANTITY_INTEGER_DIGITS
    || fraction.length > MAX_QUANTITY_FRACTIONAL_DIGITS
  ) {
    return null;
  }
  return {
    coefficient: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

function align(left: Decimal, right: Decimal): readonly [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * 10n ** BigInt(scale - left.scale),
    right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  ];
}

function add(left: Decimal, right: Decimal): Decimal {
  const [leftCoefficient, rightCoefficient, scale] = align(left, right);
  return { coefficient: leftCoefficient + rightCoefficient, scale };
}

function compare(left: Decimal, right: Decimal): number {
  const [leftCoefficient, rightCoefficient] = align(left, right);
  return leftCoefficient < rightCoefficient
    ? -1
    : leftCoefficient > rightCoefficient
      ? 1
      : 0;
}

function subtractNonnegative(left: Decimal, right: Decimal): Decimal {
  const [leftCoefficient, rightCoefficient, scale] = align(left, right);
  return {
    coefficient: leftCoefficient > rightCoefficient
      ? leftCoefficient - rightCoefficient
      : 0n,
    scale,
  };
}

function formatDecimal(decimal: Decimal): string {
  if (decimal.scale === 0) {
    return decimal.coefficient.toString();
  }

  const padded = decimal.coefficient
    .toString()
    .padStart(decimal.scale + 1, "0");
  const whole = padded.slice(0, -decimal.scale);
  const fraction = padded.slice(-decimal.scale).replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isMeaningfulIdentifier(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sortedUnique(values: readonly (string | null)[]): readonly string[] {
  return Object.freeze(
    [...new Set(values.filter(isMeaningfulIdentifier))].sort(compareStrings),
  );
}

function provenanceFor(
  requirements: readonly QuantitativeRequirementInput[],
  contributions: readonly QuantitativeContributionInput[],
  conflicts: readonly QuantitativeConflictInput[] = [],
): RequirementResultProvenance {
  return Object.freeze({
    studentCreditRecordIds: sortedUnique(
      contributions.map((item) => item.studentCreditRecordId),
    ),
    requirementIds: sortedUnique([
      ...requirements.map((requirement) => requirement.requirementId),
      ...contributions.map((contribution) => contribution.requirementId),
      ...conflicts.map((conflict) => conflict.requirementId),
    ]),
    academicRuleIds: sortedUnique(
      [
        ...requirements.map((requirement) => requirement.academicRuleId),
        ...conflicts.map((conflict) => conflict.academicRuleId),
      ],
    ),
    verificationEventIds: sortedUnique(
      contributions.map((item) => item.verificationEventId),
    ),
    decisionIds: sortedUnique(contributions.map((item) => item.decisionId)),
    exceptionIds: sortedUnique(
      contributions.flatMap((item) => item.exceptionIds),
    ),
    conflictIds: sortedUnique(conflicts.map((item) => item.conflictId)),
    sourceIds: sortedUnique([
      ...requirements.flatMap((requirement) => requirement.sourceIds),
      ...contributions.flatMap((item) => item.sourceIds),
      ...conflicts.flatMap((item) => item.sourceIds),
    ]),
    claimVersionIds: sortedUnique([
      ...requirements.flatMap((requirement) => requirement.claimVersionIds),
      ...contributions.flatMap((item) => item.claimVersionIds),
      ...conflicts.flatMap((item) => item.claimVersionIds),
    ]),
  });
}

function manualReviewResult(
  requirements: readonly QuantitativeRequirementInput[],
  contributions: readonly QuantitativeContributionInput[],
  reason: string,
  conflicts: readonly QuantitativeConflictInput[] = [],
): QuantitativeRequirementResult {
  const requirement = requirements[0];
  const hasOneRuleIdentity = requirements.every(
    (item) => item.academicRuleId === requirement.academicRuleId,
  );
  const academicRuleId = requirement.academicRuleId === null
    || isMeaningfulIdentifier(requirement.academicRuleId)
    ? requirement.academicRuleId
    : null;
  return Object.freeze({
    projectionKind: "INFORMATIONAL_ONLY",
    requirementId: isMeaningfulIdentifier(requirement.requirementId)
      ? requirement.requirementId
      : null,
    academicRuleId: hasOneRuleIdentity ? academicRuleId : null,
    status: "MANUAL_REVIEW",
    requiredAmount: null,
    appliedAmount: null,
    remainingAmount: null,
    reason,
    provenance: provenanceFor(requirements, contributions, conflicts),
  });
}

function conflictResult(
  requirement: QuantitativeRequirementInput,
  contributions: readonly QuantitativeContributionInput[],
  conflicts: readonly QuantitativeConflictInput[],
): QuantitativeRequirementResult {
  return Object.freeze({
    projectionKind: "INFORMATIONAL_ONLY",
    requirementId: requirement.requirementId,
    academicRuleId: requirement.academicRuleId,
    status: "CONFLICT",
    requiredAmount: null,
    appliedAmount: null,
    remainingAmount: null,
    reason: "UNRESOLVED_CANONICAL_CONFLICT",
    provenance: provenanceFor([requirement], contributions, conflicts),
  });
}

function unmatchedContributionsResult(
  contributions: readonly QuantitativeContributionInput[],
): QuantitativeRequirementResult {
  return Object.freeze({
    projectionKind: "INFORMATIONAL_ONLY",
    requirementId: null,
    academicRuleId: null,
    status: "MANUAL_REVIEW",
    requiredAmount: null,
    appliedAmount: null,
    remainingAmount: null,
    reason: "UNMATCHED_CONTRIBUTION_REQUIREMENT",
    provenance: provenanceFor([], contributions),
  });
}

function unattributedConflictsResult(
  conflicts: readonly QuantitativeConflictInput[],
  reason: string,
): QuantitativeRequirementResult {
  return Object.freeze({
    projectionKind: "INFORMATIONAL_ONLY",
    requirementId: null,
    academicRuleId: null,
    status: "MANUAL_REVIEW",
    requiredAmount: null,
    appliedAmount: null,
    remainingAmount: null,
    reason,
    provenance: provenanceFor([], [], conflicts),
  });
}

function evaluateRequirement(
  requirement: QuantitativeRequirementInput,
  contributions: readonly QuantitativeContributionInput[],
): QuantitativeRequirementResult {
  if (
    requirement.academicRuleId !== null
    && !isMeaningfulIdentifier(requirement.academicRuleId)
  ) {
    return manualReviewResult(
      [requirement],
      contributions,
      "INVALID_ACADEMIC_RULE_IDENTITY",
    );
  }
  if (requirement.kind !== "minimum") {
    return manualReviewResult([requirement], contributions, "UNKNOWN_REQUIREMENT_KIND");
  }
  if (requirement.unit !== "credits") {
    return manualReviewResult([requirement], contributions, "UNKNOWN_QUANTITATIVE_UNIT");
  }

  const required = parseNonnegativeDecimal(requirement.requiredAmount);
  if (required === null) {
    return manualReviewResult([requirement], contributions, "UNUSABLE_REQUIRED_AMOUNT");
  }

  let applied: Decimal = { coefficient: 0n, scale: 0 };
  for (const contribution of contributions) {
    const amount = parseNonnegativeDecimal(contribution.amount);
    if (amount === null) {
      return manualReviewResult(
        [requirement],
        contributions,
        "UNUSABLE_CONTRIBUTION_AMOUNT",
      );
    }
    applied = add(applied, amount);
  }

  const status: QuantitativeRequirementStatus = compare(applied, required) >= 0
    ? "SATISFIED"
    : applied.coefficient > 0n
      ? "PARTIAL"
      : "MISSING";

  return Object.freeze({
    projectionKind: "INFORMATIONAL_ONLY",
    requirementId: requirement.requirementId,
    academicRuleId: requirement.academicRuleId,
    status,
    requiredAmount: formatDecimal(required),
    appliedAmount: formatDecimal(applied),
    remainingAmount: formatDecimal(subtractNonnegative(required, applied)),
    reason: null,
    provenance: provenanceFor([requirement], contributions),
  });
}

export function evaluateQuantitativeRequirements(
  input: QuantitativeRequirementsInput,
): readonly QuantitativeRequirementResult[] {
  const conflicts = input.conflicts ?? [];
  const conflictsByIdentity = new Map<string, QuantitativeConflictInput[]>();
  for (const conflict of conflicts) {
    const matchingConflicts = conflictsByIdentity.get(conflict.conflictId) ?? [];
    matchingConflicts.push(conflict);
    conflictsByIdentity.set(conflict.conflictId, matchingConflicts);
  }
  const withCollisionEvidence = (
    selectedConflicts: readonly QuantitativeConflictInput[],
  ): readonly QuantitativeConflictInput[] => {
    const completeConflicts = new Set(selectedConflicts);
    for (const conflict of selectedConflicts) {
      const identityGroup = conflictsByIdentity.get(conflict.conflictId) ?? [];
      if (identityGroup.length > 1) {
        for (const matchingConflict of identityGroup) {
          completeConflicts.add(matchingConflict);
        }
      }
    }
    return [...completeConflicts];
  };
  const requirementsByIdentity = new Map<string, QuantitativeRequirementInput[]>();
  const invalidRequirements: QuantitativeRequirementInput[] = [];
  const suppliedRequirementIds = new Set<string>();
  for (const requirement of input.requirements) {
    suppliedRequirementIds.add(requirement.requirementId);
    if (!isMeaningfulIdentifier(requirement.requirementId)) {
      invalidRequirements.push(requirement);
      continue;
    }
    const identity = requirement.requirementId;
    const matchingRequirements = requirementsByIdentity.get(identity) ?? [];
    matchingRequirements.push(requirement);
    requirementsByIdentity.set(identity, matchingRequirements);
  }

  const results: QuantitativeRequirementResult[] = [];
  if (invalidRequirements.length > 0) {
    const invalidRequirementIds = new Set(
      invalidRequirements.map((requirement) => requirement.requirementId),
    );
    const associatedContributions = input.contributions.filter(
      (contribution) => invalidRequirementIds.has(contribution.requirementId),
    );
    const associatedConflicts = withCollisionEvidence(
      conflicts.filter(
        (conflict) => invalidRequirementIds.has(conflict.requirementId),
      ),
    );
    results.push(manualReviewResult(
      invalidRequirements,
      associatedContributions,
      "INVALID_REQUIREMENT_IDENTITY",
      associatedConflicts,
    ));
  }

  results.push(...[...requirementsByIdentity.values()].map((requirements) => {
    const requirement = requirements[0];
    const contributions = input.contributions.filter(
      (contribution) => contribution.requirementId === requirement.requirementId,
    );
    const requirementConflicts = withCollisionEvidence(
      conflicts.filter(
        (conflict) => conflict.requirementId === requirement.requirementId,
      ),
    );
    if (requirements.length > 1) {
      return manualReviewResult(
        requirements,
        contributions,
        "AMBIGUOUS_REQUIREMENT_IDENTITY",
        requirementConflicts,
      );
    }
    if (
      contributions.some(
        (contribution) => !isMeaningfulIdentifier(
          contribution.studentCreditRecordId,
        ),
      )
    ) {
      return manualReviewResult(
        requirements,
        contributions,
        "INVALID_STUDENT_CREDIT_RECORD_IDENTITY",
        requirementConflicts,
      );
    }
    const creditRecordIds = new Set<string>();
    for (const contribution of contributions) {
      if (creditRecordIds.has(contribution.studentCreditRecordId)) {
        return manualReviewResult(
          requirements,
          contributions,
          "AMBIGUOUS_CONTRIBUTION_IDENTITY",
          requirementConflicts,
        );
      }
      creditRecordIds.add(contribution.studentCreditRecordId);
    }
    if (
      requirement.academicRuleId !== null
      && !isMeaningfulIdentifier(requirement.academicRuleId)
    ) {
      return manualReviewResult(
        requirements,
        contributions,
        "INVALID_ACADEMIC_RULE_IDENTITY",
        requirementConflicts,
      );
    }
    if (
      requirementConflicts.some(
        (conflict) => !isMeaningfulIdentifier(conflict.conflictId),
      )
    ) {
      return manualReviewResult(
        requirements,
        contributions,
        "INVALID_CONFLICT_IDENTITY",
        requirementConflicts,
      );
    }
    if (
      requirementConflicts.some(
        (conflict) => conflict.academicRuleId !== null
          && !isMeaningfulIdentifier(conflict.academicRuleId),
      )
    ) {
      return manualReviewResult(
        requirements,
        contributions,
        "INVALID_CONFLICT_RULE_IDENTITY",
        requirementConflicts,
      );
    }
    if (
      requirementConflicts.some(
        (conflict) => (conflictsByIdentity.get(conflict.conflictId)?.length ?? 0) > 1,
      )
    ) {
      return manualReviewResult(
        requirements,
        contributions,
        "AMBIGUOUS_CONFLICT_IDENTITY",
        requirementConflicts,
      );
    }
    if (
      requirementConflicts.some(
        (conflict) => conflict.academicRuleId !== null
          && conflict.academicRuleId !== requirement.academicRuleId,
      )
    ) {
      return manualReviewResult(
        requirements,
        contributions,
        "CONFLICT_RULE_IDENTITY_MISMATCH",
        requirementConflicts,
      );
    }
    if (requirementConflicts.length > 0) {
      return conflictResult(requirement, contributions, requirementConflicts);
    }
    return evaluateRequirement(requirement, contributions);
  }));

  const unmatchedContributions = input.contributions.filter(
    (contribution) => !suppliedRequirementIds.has(contribution.requirementId),
  );
  if (unmatchedContributions.length > 0) {
    results.push(unmatchedContributionsResult(unmatchedContributions));
  }

  const duplicateConflictIdsConsumedBySuppliedTargets = new Set<string>();
  for (const [conflictId, identityGroup] of conflictsByIdentity) {
    if (
      identityGroup.length > 1
      && identityGroup.some(
        (conflict) => suppliedRequirementIds.has(conflict.requirementId),
      )
    ) {
      duplicateConflictIdsConsumedBySuppliedTargets.add(conflictId);
    }
  }
  let remainingConflicts = conflicts.filter(
    (conflict) => !suppliedRequirementIds.has(conflict.requirementId)
      && !duplicateConflictIdsConsumedBySuppliedTargets.has(conflict.conflictId),
  );
  const takeConflicts = (
    reason: string,
    predicate: (conflict: QuantitativeConflictInput) => boolean,
  ) => {
    const matching = remainingConflicts.filter(predicate);
    if (matching.length > 0) {
      results.push(unattributedConflictsResult(matching, reason));
      const matchingFacts = new Set(matching);
      remainingConflicts = remainingConflicts.filter(
        (conflict) => !matchingFacts.has(conflict),
      );
    }
  };
  takeConflicts(
    "INVALID_CONFLICT_IDENTITY",
    (conflict) => !isMeaningfulIdentifier(conflict.conflictId),
  );
  takeConflicts(
    "AMBIGUOUS_CONFLICT_IDENTITY",
    (conflict) => isMeaningfulIdentifier(conflict.conflictId)
      && (conflictsByIdentity.get(conflict.conflictId)?.length ?? 0) > 1,
  );
  takeConflicts(
    "INVALID_CONFLICT_RULE_IDENTITY",
    (conflict) => conflict.academicRuleId !== null
      && !isMeaningfulIdentifier(conflict.academicRuleId),
  );
  takeConflicts(
    "INVALID_CONFLICT_REQUIREMENT_IDENTITY",
    (conflict) => !isMeaningfulIdentifier(conflict.requirementId),
  );
  if (remainingConflicts.length > 0) {
    results.push(unattributedConflictsResult(
      remainingConflicts,
      "UNMATCHED_CONFLICT_REQUIREMENT",
    ));
  }

  return Object.freeze(results.sort((left, right) => (
    compareStrings(left.requirementId ?? "", right.requirementId ?? "")
    || compareStrings(left.academicRuleId ?? "", right.academicRuleId ?? "")
    || compareStrings(left.reason ?? "", right.reason ?? "")
  )));
}