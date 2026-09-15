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

export interface QuantitativeRequirementsInput {
  readonly requirements: readonly QuantitativeRequirementInput[];
  readonly contributions: readonly QuantitativeContributionInput[];
}

export interface RequirementResultProvenance {
  readonly studentCreditRecordIds: readonly string[];
  readonly requirementIds: readonly string[];
  readonly academicRuleIds: readonly string[];
  readonly verificationEventIds: readonly string[];
  readonly decisionIds: readonly string[];
  readonly exceptionIds: readonly string[];
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
): RequirementResultProvenance {
  return Object.freeze({
    studentCreditRecordIds: sortedUnique(
      contributions.map((item) => item.studentCreditRecordId),
    ),
    requirementIds: sortedUnique([
      ...requirements.map((requirement) => requirement.requirementId),
      ...contributions.map((contribution) => contribution.requirementId),
    ]),
    academicRuleIds: sortedUnique(
      requirements.map((requirement) => requirement.academicRuleId),
    ),
    verificationEventIds: sortedUnique(
      contributions.map((item) => item.verificationEventId),
    ),
    decisionIds: sortedUnique(contributions.map((item) => item.decisionId)),
    exceptionIds: sortedUnique(
      contributions.flatMap((item) => item.exceptionIds),
    ),
    sourceIds: sortedUnique([
      ...requirements.flatMap((requirement) => requirement.sourceIds),
      ...contributions.flatMap((item) => item.sourceIds),
    ]),
    claimVersionIds: sortedUnique([
      ...requirements.flatMap((requirement) => requirement.claimVersionIds),
      ...contributions.flatMap((item) => item.claimVersionIds),
    ]),
  });
}

function manualReviewResult(
  requirements: readonly QuantitativeRequirementInput[],
  contributions: readonly QuantitativeContributionInput[],
  reason: string,
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
    provenance: provenanceFor(requirements, contributions),
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
    results.push(manualReviewResult(
      invalidRequirements,
      associatedContributions,
      "INVALID_REQUIREMENT_IDENTITY",
    ));
  }

  results.push(...[...requirementsByIdentity.values()].map((requirements) => {
    const requirement = requirements[0];
    const contributions = input.contributions.filter(
      (contribution) => contribution.requirementId === requirement.requirementId,
    );
    if (requirements.length > 1) {
      return manualReviewResult(
        requirements,
        contributions,
        "AMBIGUOUS_REQUIREMENT_IDENTITY",
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
      );
    }
    const creditRecordIds = new Set<string>();
    for (const contribution of contributions) {
      if (creditRecordIds.has(contribution.studentCreditRecordId)) {
        return manualReviewResult(
          requirements,
          contributions,
          "AMBIGUOUS_CONTRIBUTION_IDENTITY",
        );
      }
      creditRecordIds.add(contribution.studentCreditRecordId);
    }
    return evaluateRequirement(requirement, contributions);
  }));

  const unmatchedContributions = input.contributions.filter(
    (contribution) => !suppliedRequirementIds.has(contribution.requirementId),
  );
  if (unmatchedContributions.length > 0) {
    results.push(unmatchedContributionsResult(unmatchedContributions));
  }

  return Object.freeze(results.sort((left, right) => (
    compareStrings(left.requirementId ?? "", right.requirementId ?? "")
    || compareStrings(left.academicRuleId ?? "", right.academicRuleId ?? "")
    || compareStrings(left.reason ?? "", right.reason ?? "")
  )));
}