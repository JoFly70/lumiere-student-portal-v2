/**
 * Pure normalization of caller-supplied canonical snapshot facts into
 * evaluator-ready inputs. This module performs no discovery, inference, I/O,
 * persistence, or academic decision-making.
 */

import type {
  QuantitativeConflictInput,
  QuantitativeContributionInput,
  QuantitativeRequirementInput,
} from "./requirements-status-engine";

export interface CanonicalRequirementSnapshotInput {
  readonly requirementId: string;
  readonly academicRuleId: string | null;
  readonly kind: string;
  readonly unit: string;
  readonly requiredAmount: string | null;
  readonly sourceIds: readonly string[];
  readonly claimVersionIds: readonly string[];
}

export interface CanonicalStudentCreditEvidenceInput {
  readonly evidenceId: string;
  readonly studentCreditRecordId: string;
  readonly requirementId: string;
  readonly academicRuleId: string | null;
  readonly kind: string;
  readonly unit: string;
  readonly amount: string | null;
  readonly verificationEventId: string | null;
  readonly decisionId: string | null;
  readonly exceptionIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly claimVersionIds: readonly string[];
}

export interface CanonicalUnresolvedConflictInput {
  readonly conflictId: string;
  readonly requirementId: string;
  readonly academicRuleId: string | null;
  readonly status: string;
  readonly sourceIds: readonly string[];
  readonly claimVersionIds: readonly string[];
}

export interface CanonicalEvidenceNormalizationInput {
  readonly requirements: readonly CanonicalRequirementSnapshotInput[];
  readonly studentCreditEvidence: readonly CanonicalStudentCreditEvidenceInput[];
  readonly unresolvedConflicts: readonly CanonicalUnresolvedConflictInput[];
}

export interface CanonicalNormalizationProvenance {
  readonly canonicalFactIds: readonly string[];
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

export interface CanonicalNormalizationDiagnostic {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly status: "MANUAL_REVIEW";
  readonly reason: string;
  readonly provenance: CanonicalNormalizationProvenance;
}

export interface NormalizedQuantitativeContributionInput
  extends QuantitativeContributionInput {
  readonly canonicalFactIds: readonly string[];
}

export interface CanonicalEvidenceNormalizationOutput {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly requirements: readonly QuantitativeRequirementInput[];
  readonly contributions: readonly NormalizedQuantitativeContributionInput[];
  readonly conflicts: readonly QuantitativeConflictInput[];
  readonly diagnostics: readonly CanonicalNormalizationDiagnostic[];
}

const QUANTITY_PATTERN = /^\d+(?:\.\d+)?$/;
const MAX_QUANTITY_INPUT_LENGTH = 16;
const MAX_QUANTITY_INTEGER_DIGITS = 4;
const MAX_QUANTITY_FRACTIONAL_DIGITS = 2;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isMeaningfulIdentifier(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSupportedQuantity(value: string | null): value is string {
  if (
    typeof value !== "string"
    || value.length > MAX_QUANTITY_INPUT_LENGTH
    || !QUANTITY_PATTERN.test(value)
  ) {
    return false;
  }
  const [whole, fraction = ""] = value.split(".");
  const significantWhole = whole.replace(/^0+/, "") || "0";
  return significantWhole.length <= MAX_QUANTITY_INTEGER_DIGITS
    && fraction.length <= MAX_QUANTITY_FRACTIONAL_DIGITS;
}

function hasInvalidIdentifier(
  values: readonly (string | null)[],
): boolean {
  return values.some((value) => !isMeaningfulIdentifier(value));
}

function sortedUnique(values: readonly (string | null)[]): readonly string[] {
  return Object.freeze(
    [...new Set(values.filter(isMeaningfulIdentifier))].sort(compareStrings),
  );
}

function groupByIdentity<T>(
  facts: readonly T[],
  identity: (fact: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const fact of facts) {
    const key = identity(fact);
    const group = groups.get(key) ?? [];
    group.push(fact);
    groups.set(key, group);
  }
  return groups;
}

function provenanceFor(
  requirements: readonly CanonicalRequirementSnapshotInput[] = [],
  credits: readonly CanonicalStudentCreditEvidenceInput[] = [],
  conflicts: readonly CanonicalUnresolvedConflictInput[] = [],
): CanonicalNormalizationProvenance {
  return Object.freeze({
    canonicalFactIds: sortedUnique([
      ...requirements.map((item) => item.requirementId),
      ...credits.map((item) => item.evidenceId),
      ...conflicts.map((item) => item.conflictId),
    ]),
    studentCreditRecordIds: sortedUnique(
      credits.map((item) => item.studentCreditRecordId),
    ),
    requirementIds: sortedUnique([
      ...requirements.map((item) => item.requirementId),
      ...credits.map((item) => item.requirementId),
      ...conflicts.map((item) => item.requirementId),
    ]),
    academicRuleIds: sortedUnique([
      ...requirements.map((item) => item.academicRuleId),
      ...credits.map((item) => item.academicRuleId),
      ...conflicts.map((item) => item.academicRuleId),
    ]),
    verificationEventIds: sortedUnique(
      credits.map((item) => item.verificationEventId),
    ),
    decisionIds: sortedUnique(credits.map((item) => item.decisionId)),
    exceptionIds: sortedUnique(credits.flatMap((item) => item.exceptionIds)),
    conflictIds: sortedUnique(conflicts.map((item) => item.conflictId)),
    sourceIds: sortedUnique([
      ...requirements.flatMap((item) => item.sourceIds),
      ...credits.flatMap((item) => item.sourceIds),
      ...conflicts.flatMap((item) => item.sourceIds),
    ]),
    claimVersionIds: sortedUnique([
      ...requirements.flatMap((item) => item.claimVersionIds),
      ...credits.flatMap((item) => item.claimVersionIds),
      ...conflicts.flatMap((item) => item.claimVersionIds),
    ]),
  });
}

function diagnostic(
  reason: string,
  requirements: readonly CanonicalRequirementSnapshotInput[] = [],
  credits: readonly CanonicalStudentCreditEvidenceInput[] = [],
  conflicts: readonly CanonicalUnresolvedConflictInput[] = [],
): CanonicalNormalizationDiagnostic {
  return Object.freeze({
    projectionKind: "INFORMATIONAL_ONLY",
    status: "MANUAL_REVIEW",
    reason,
    provenance: provenanceFor(requirements, credits, conflicts),
  });
}

function frozenRequirement(
  fact: CanonicalRequirementSnapshotInput,
): QuantitativeRequirementInput {
  return Object.freeze({
    requirementId: fact.requirementId,
    academicRuleId: fact.academicRuleId,
    kind: fact.kind,
    unit: fact.unit,
    requiredAmount: fact.requiredAmount,
    sourceIds: sortedUnique(fact.sourceIds),
    claimVersionIds: sortedUnique(fact.claimVersionIds),
  });
}

function frozenContribution(
  fact: CanonicalStudentCreditEvidenceInput,
): NormalizedQuantitativeContributionInput {
  return Object.freeze({
    canonicalFactIds: sortedUnique([fact.evidenceId]),
    requirementId: fact.requirementId,
    studentCreditRecordId: fact.studentCreditRecordId,
    amount: fact.amount,
    verificationEventId: fact.verificationEventId,
    decisionId: fact.decisionId,
    exceptionIds: sortedUnique(fact.exceptionIds),
    sourceIds: sortedUnique(fact.sourceIds),
    claimVersionIds: sortedUnique(fact.claimVersionIds),
  });
}

function frozenConflict(
  fact: CanonicalUnresolvedConflictInput,
): QuantitativeConflictInput {
  return Object.freeze({
    conflictId: fact.conflictId,
    requirementId: fact.requirementId,
    academicRuleId: fact.academicRuleId,
    sourceIds: sortedUnique(fact.sourceIds),
    claimVersionIds: sortedUnique(fact.claimVersionIds),
  });
}

export function normalizeCanonicalRequirementEvidence(
  input: CanonicalEvidenceNormalizationInput,
): CanonicalEvidenceNormalizationOutput {
  const requirements: QuantitativeRequirementInput[] = [];
  const contributions: NormalizedQuantitativeContributionInput[] = [];
  const normalizedCreditFacts: CanonicalStudentCreditEvidenceInput[] = [];
  const normalizedRequirementFacts =
    new Map<string, CanonicalRequirementSnapshotInput>();
  const conflicts: QuantitativeConflictInput[] = [];
  const diagnostics: CanonicalNormalizationDiagnostic[] = [];

  const requirementGroups = groupByIdentity(
    input.requirements,
    (fact) => fact.requirementId,
  );
  for (const [requirementId, group] of requirementGroups) {
    if (!isMeaningfulIdentifier(requirementId)) {
      diagnostics.push(diagnostic(
        "INVALID_CANONICAL_REQUIREMENT_IDENTITY",
        group,
      ));
      continue;
    }
    if (group.length > 1) {
      diagnostics.push(diagnostic(
        "AMBIGUOUS_CANONICAL_REQUIREMENT_IDENTITY",
        group,
      ));
      continue;
    }
    const fact = group[0];
    if (
      fact.academicRuleId !== null
      && !isMeaningfulIdentifier(fact.academicRuleId)
    ) {
      diagnostics.push(diagnostic(
        "INVALID_CANONICAL_REQUIREMENT_RULE_IDENTITY",
        group,
      ));
    } else if (fact.kind !== "minimum") {
      diagnostics.push(diagnostic(
        "UNSUPPORTED_CANONICAL_REQUIREMENT_KIND",
        group,
      ));
    } else if (fact.unit !== "credits") {
      diagnostics.push(diagnostic(
        "UNSUPPORTED_CANONICAL_REQUIREMENT_UNIT",
        group,
      ));
    } else if (!isSupportedQuantity(fact.requiredAmount)) {
      diagnostics.push(diagnostic(
        "INCOMPLETE_CANONICAL_REQUIREMENT_QUANTITY",
        group,
      ));
    } else if (
      hasInvalidIdentifier(fact.sourceIds)
      || hasInvalidIdentifier(fact.claimVersionIds)
    ) {
      diagnostics.push(diagnostic(
        "INVALID_CANONICAL_REQUIREMENT_PROVENANCE",
        group,
      ));
    } else {
      requirements.push(frozenRequirement(fact));
      normalizedRequirementFacts.set(fact.requirementId, fact);
    }
  }

  const normalizedRequirements = new Map(
    requirements.map((fact) => [fact.requirementId, fact]),
  );
  const quarantinedCreditFacts =
    new Set<CanonicalStudentCreditEvidenceInput>();
  const studentRecordGroups = groupByIdentity(
    input.studentCreditEvidence.filter(
      (fact) => isMeaningfulIdentifier(fact.studentCreditRecordId),
    ),
    (fact) => fact.studentCreditRecordId,
  );
  for (const group of studentRecordGroups.values()) {
    if (group.length > 1) {
      diagnostics.push(diagnostic(
        "AMBIGUOUS_CANONICAL_CREDIT_MAPPING",
        [],
        group,
      ));
      for (const fact of group) {
        quarantinedCreditFacts.add(fact);
      }
    }
  }
  const creditGroups = groupByIdentity(
    input.studentCreditEvidence,
    (fact) => fact.evidenceId,
  );
  for (const [evidenceId, group] of creditGroups) {
    if (group.every((fact) => quarantinedCreditFacts.has(fact))) {
      continue;
    }
    const fact = group[0];
    if (!isMeaningfulIdentifier(evidenceId)) {
      diagnostics.push(diagnostic(
        "INVALID_CANONICAL_CREDIT_EVIDENCE_IDENTITY",
        [],
        group,
      ));
      continue;
    }
    if (group.length > 1) {
      diagnostics.push(diagnostic(
        "AMBIGUOUS_CANONICAL_CREDIT_EVIDENCE_IDENTITY",
        [],
        group,
      ));
      continue;
    }
    if (
      !isMeaningfulIdentifier(fact.studentCreditRecordId)
      || !isMeaningfulIdentifier(fact.requirementId)
      || (
        fact.academicRuleId !== null
        && !isMeaningfulIdentifier(fact.academicRuleId)
      )
    ) {
      diagnostics.push(diagnostic(
        "INVALID_CANONICAL_CREDIT_EVIDENCE_IDENTITY",
        [],
        group,
      ));
      continue;
    }
    if (fact.kind !== "accepted_credit") {
      diagnostics.push(diagnostic(
        "UNSUPPORTED_CANONICAL_CREDIT_KIND",
        [],
        group,
      ));
      continue;
    }
    if (fact.unit !== "credits") {
      diagnostics.push(diagnostic(
        "UNSUPPORTED_CANONICAL_CREDIT_UNIT",
        [],
        group,
      ));
      continue;
    }
    if (!isSupportedQuantity(fact.amount)) {
      diagnostics.push(diagnostic(
        "INCOMPLETE_CANONICAL_CREDIT_QUANTITY",
        [],
        group,
      ));
      continue;
    }
    if (
      hasInvalidIdentifier(fact.sourceIds)
      || hasInvalidIdentifier(fact.claimVersionIds)
      || hasInvalidIdentifier(fact.exceptionIds)
      || (
        fact.verificationEventId !== null
        && !isMeaningfulIdentifier(fact.verificationEventId)
      )
      || (
        fact.decisionId !== null
        && !isMeaningfulIdentifier(fact.decisionId)
      )
    ) {
      diagnostics.push(diagnostic(
        "INVALID_CANONICAL_CREDIT_PROVENANCE",
        [],
        group,
      ));
      continue;
    }
    const matchedRequirement = normalizedRequirements.get(fact.requirementId);
    if (matchedRequirement === undefined) {
      diagnostics.push(diagnostic(
        "UNMATCHED_CANONICAL_CREDIT_ASSOCIATION",
        [],
        group,
      ));
      continue;
    }
    if (
      fact.academicRuleId !== matchedRequirement.academicRuleId
    ) {
      diagnostics.push(diagnostic(
        "CANONICAL_ASSOCIATION_RULE_MISMATCH",
        [normalizedRequirementFacts.get(fact.requirementId)!],
        group,
      ));
      continue;
    }
    normalizedCreditFacts.push(fact);
  }

  const contributionIdentityGroups = groupByIdentity(
    normalizedCreditFacts,
    (fact) => fact.studentCreditRecordId,
  );
  for (const group of contributionIdentityGroups.values()) {
    if (group.length > 1) {
      diagnostics.push(diagnostic(
        "AMBIGUOUS_CANONICAL_CREDIT_MAPPING",
        [],
        group,
      ));
    } else {
      contributions.push(frozenContribution(group[0]));
    }
  }

  const conflictGroups = groupByIdentity(
    input.unresolvedConflicts,
    (fact) => fact.conflictId,
  );
  for (const [conflictId, group] of conflictGroups) {
    const fact = group[0];
    if (!isMeaningfulIdentifier(conflictId)) {
      diagnostics.push(diagnostic(
        "INVALID_CANONICAL_CONFLICT_IDENTITY",
        [],
        [],
        group,
      ));
      continue;
    }
    if (group.length > 1) {
      diagnostics.push(diagnostic(
        "AMBIGUOUS_CANONICAL_CONFLICT_IDENTITY",
        [],
        [],
        group,
      ));
      continue;
    }
    if (
      !isMeaningfulIdentifier(fact.requirementId)
      || (
        fact.academicRuleId !== null
        && !isMeaningfulIdentifier(fact.academicRuleId)
      )
    ) {
      diagnostics.push(diagnostic(
        "INVALID_CANONICAL_CONFLICT_IDENTITY",
        [],
        [],
        group,
      ));
      continue;
    }
    if (fact.status !== "open") {
      diagnostics.push(diagnostic(
        "UNSUPPORTED_CANONICAL_CONFLICT_STATUS",
        [],
        [],
        group,
      ));
      continue;
    }
    if (
      hasInvalidIdentifier(fact.sourceIds)
      || hasInvalidIdentifier(fact.claimVersionIds)
    ) {
      diagnostics.push(diagnostic(
        "INVALID_CANONICAL_CONFLICT_PROVENANCE",
        [],
        [],
        group,
      ));
      continue;
    }
    const matchedRequirement = normalizedRequirements.get(fact.requirementId);
    if (matchedRequirement === undefined) {
      diagnostics.push(diagnostic(
        "UNMATCHED_CANONICAL_CONFLICT_ASSOCIATION",
        [],
        [],
        group,
      ));
      continue;
    }
    if (
      fact.academicRuleId !== matchedRequirement.academicRuleId
    ) {
      diagnostics.push(diagnostic(
        "CANONICAL_CONFLICT_RULE_MISMATCH",
        [normalizedRequirementFacts.get(fact.requirementId)!],
        [],
        group,
      ));
      continue;
    }
    conflicts.push(frozenConflict(fact));
  }

  requirements.sort((left, right) => (
    compareStrings(left.requirementId, right.requirementId)
    || compareStrings(left.academicRuleId ?? "", right.academicRuleId ?? "")
  ));
  contributions.sort((left, right) => (
    compareStrings(left.requirementId, right.requirementId)
    || compareStrings(
      left.studentCreditRecordId,
      right.studentCreditRecordId,
    )
  ));
  conflicts.sort((left, right) => (
    compareStrings(left.conflictId, right.conflictId)
    || compareStrings(left.requirementId, right.requirementId)
  ));
  diagnostics.sort((left, right) => (
    compareStrings(left.reason, right.reason)
    || compareStrings(
      JSON.stringify(left.provenance),
      JSON.stringify(right.provenance),
    )
  ));

  return Object.freeze({
    projectionKind: "INFORMATIONAL_ONLY",
    requirements: Object.freeze(requirements),
    contributions: Object.freeze(contributions),
    conflicts: Object.freeze(conflicts),
    diagnostics: Object.freeze(diagnostics),
  });
}