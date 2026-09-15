/**
 * Pure projection of caller-supplied recorded student credit facts.
 * No latest-record selection, inference, I/O, or academic decision-making.
 */

import type {
  StudentCreditDecision,
  StudentCreditRecord,
  StudentCreditVerificationEvent,
} from "./student-academic-schema";
import {
  normalizeCanonicalRequirementEvidence,
  type CanonicalEvidenceNormalizationOutput,
  type CanonicalRequirementSnapshotInput,
  type CanonicalStudentCreditEvidenceInput,
  type CanonicalUnresolvedConflictInput,
} from "./requirements-evidence-normalizer";
import {
  evaluateQuantitativeRequirements,
  type QuantitativeRequirementResult,
} from "./requirements-status-engine";

export type RecordedCreditRecordFact = Readonly<Pick<
  StudentCreditRecord,
  "id" | "studentId" | "sourceId" | "status"
>>;

export type RecordedCreditVerificationFact = Readonly<Pick<
  StudentCreditVerificationEvent,
  "id" | "creditRecordId" | "seq" | "action"
>>;

export type RecordedCreditDecisionFact = Readonly<Pick<
  StudentCreditDecision,
  | "id"
  | "creditRecordId"
  | "programAssignmentId"
  | "seq"
  | "action"
  | "creditsAwarded"
  | "basisClaimVersionId"
  | "equivalencyId"
  | "targetInstitutionCourseVersionId"
>>;

export interface RecordedDecisionRequirementAssociation {
  readonly decisionId: string;
  readonly requirementId: string;
  readonly academicRuleId: string | null;
}

export interface RecordedCreditProjectionContext {
  readonly studentId: string;
  readonly programAssignmentId: string;
}

export interface RecordedCreditProjectionInput {
  readonly context: RecordedCreditProjectionContext;
  readonly requirements: readonly CanonicalRequirementSnapshotInput[];
  readonly unresolvedConflicts: readonly CanonicalUnresolvedConflictInput[];
  readonly creditRecords: readonly RecordedCreditRecordFact[];
  readonly verificationEvents: readonly RecordedCreditVerificationFact[];
  readonly decisions: readonly RecordedCreditDecisionFact[];
  readonly associations: readonly RecordedDecisionRequirementAssociation[];
}

export interface RecordedCreditProvenance {
  readonly studentIds: readonly string[];
  readonly programAssignmentIds: readonly string[];
  readonly studentCreditRecordIds: readonly string[];
  readonly verificationEventIds: readonly string[];
  readonly decisionIds: readonly string[];
  readonly requirementIds: readonly string[];
  readonly academicRuleIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly claimVersionIds: readonly string[];
  readonly equivalencyIds: readonly string[];
  readonly targetInstitutionCourseVersionIds: readonly string[];
}

export interface RecordedCreditProjectionDiagnostic {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly status: "MANUAL_REVIEW";
  readonly reason: string;
  readonly provenance: RecordedCreditProvenance;
}

export interface ProjectedRecordedCreditEvidence
  extends CanonicalStudentCreditEvidenceInput {
  readonly recordedProvenance: RecordedCreditProvenance;
}

export interface RecordedCreditProjectionOutput {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly evidence: readonly ProjectedRecordedCreditEvidence[];
  readonly diagnostics: readonly RecordedCreditProjectionDiagnostic[];
  readonly recordedProvenance: RecordedCreditProvenance;
  readonly normalization: CanonicalEvidenceNormalizationOutput;
  readonly results: readonly QuantitativeRequirementResult[];
}

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function meaningful(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function unique(values: readonly (string | null)[]): readonly string[] {
  return Object.freeze(
    [...new Set(values.filter(meaningful))].sort(compareStrings),
  );
}

function validPositiveCredit(value: string | null): value is string {
  if (
    typeof value !== "string"
    || value.length > 16
    || !DECIMAL_PATTERN.test(value)
  ) {
    return false;
  }
  const [whole, fraction = ""] = value.split(".");
  const significantWhole = whole.replace(/^0+/, "") || "0";
  if (significantWhole.length > 4 || fraction.length > 2) {
    return false;
  }
  return BigInt(`${whole}${fraction}`) > 0n;
}

function groupBy<T>(
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

interface ProvenanceParts {
  readonly records?: readonly RecordedCreditRecordFact[];
  readonly verifications?: readonly RecordedCreditVerificationFact[];
  readonly decisions?: readonly RecordedCreditDecisionFact[];
  readonly associations?: readonly RecordedDecisionRequirementAssociation[];
  readonly context?: RecordedCreditProjectionContext;
}

function provenance(parts: ProvenanceParts): RecordedCreditProvenance {
  const records = parts.records ?? [];
  const verifications = parts.verifications ?? [];
  const decisions = parts.decisions ?? [];
  const associations = parts.associations ?? [];
  return Object.freeze({
    studentIds: unique([
      ...(parts.context ? [parts.context.studentId] : []),
      ...records.map((fact) => fact.studentId),
    ]),
    programAssignmentIds: unique([
      ...(parts.context ? [parts.context.programAssignmentId] : []),
      ...decisions.map((fact) => fact.programAssignmentId),
    ]),
    studentCreditRecordIds: unique([
      ...records.map((fact) => fact.id),
      ...verifications.map((fact) => fact.creditRecordId),
      ...decisions.map((fact) => fact.creditRecordId),
    ]),
    verificationEventIds: unique(verifications.map((fact) => fact.id)),
    decisionIds: unique([
      ...decisions.map((fact) => fact.id),
      ...associations.map((fact) => fact.decisionId),
    ]),
    requirementIds: unique(associations.map((fact) => fact.requirementId)),
    academicRuleIds: unique(associations.map((fact) => fact.academicRuleId)),
    sourceIds: unique(records.map((fact) => fact.sourceId)),
    claimVersionIds: unique(
      decisions.map((fact) => fact.basisClaimVersionId),
    ),
    equivalencyIds: unique(decisions.map((fact) => fact.equivalencyId)),
    targetInstitutionCourseVersionIds: unique(
      decisions.map((fact) => fact.targetInstitutionCourseVersionId),
    ),
  });
}

function diagnostic(
  reason: string,
  parts: ProvenanceParts,
): RecordedCreditProjectionDiagnostic {
  return Object.freeze({
    projectionKind: "INFORMATIONAL_ONLY",
    status: "MANUAL_REVIEW",
    reason,
    provenance: provenance(parts),
  });
}

function freezeEvidence(
  evidence: CanonicalStudentCreditEvidenceInput,
  recordedProvenance: RecordedCreditProvenance,
): ProjectedRecordedCreditEvidence {
  return Object.freeze({
    ...evidence,
    exceptionIds: Object.freeze([...evidence.exceptionIds]),
    sourceIds: Object.freeze([...evidence.sourceIds]),
    claimVersionIds: Object.freeze([...evidence.claimVersionIds]),
    recordedProvenance,
  });
}

export function projectRecordedStudentCreditFacts(
  input: RecordedCreditProjectionInput,
): RecordedCreditProjectionOutput {
  const evidence: ProjectedRecordedCreditEvidence[] = [];
  const diagnostics: RecordedCreditProjectionDiagnostic[] = [];
  const allParts: ProvenanceParts = {
    context: input.context,
    records: input.creditRecords,
    verifications: input.verificationEvents,
    decisions: input.decisions,
    associations: input.associations,
  };

  const finish = (): RecordedCreditProjectionOutput => {
    evidence.sort((left, right) => compareStrings(
      left.evidenceId,
      right.evidenceId,
    ));
    diagnostics.sort((left, right) => (
      compareStrings(left.reason, right.reason)
      || compareStrings(
        JSON.stringify(left.provenance),
        JSON.stringify(right.provenance),
      )
    ));
    const frozenEvidence = Object.freeze(evidence);
    const normalization = normalizeCanonicalRequirementEvidence({
      requirements: input.requirements,
      studentCreditEvidence: frozenEvidence,
      unresolvedConflicts: input.unresolvedConflicts,
    });
    const results = evaluateQuantitativeRequirements({
      requirements: normalization.requirements,
      contributions: normalization.contributions,
      conflicts: normalization.conflicts,
    });
    return Object.freeze({
      projectionKind: "INFORMATIONAL_ONLY",
      evidence: frozenEvidence,
      diagnostics: Object.freeze(diagnostics),
      recordedProvenance: provenance(allParts),
      normalization,
      results,
    });
  };

  if (
    !meaningful(input.context.studentId)
    || !meaningful(input.context.programAssignmentId)
  ) {
    diagnostics.push(diagnostic(
      "INVALID_RECORDED_PROJECTION_CONTEXT",
      allParts,
    ));
    return finish();
  }

  type FactNode =
    | { readonly kind: "record"; readonly fact: RecordedCreditRecordFact }
    | {
      readonly kind: "verification";
      readonly fact: RecordedCreditVerificationFact;
    }
    | { readonly kind: "decision"; readonly fact: RecordedCreditDecisionFact }
    | {
      readonly kind: "association";
      readonly fact: RecordedDecisionRequirementAssociation;
    };

  const nodes: FactNode[] = [
    ...input.creditRecords.map((fact) => ({ kind: "record" as const, fact })),
    ...input.verificationEvents.map((fact) => ({
      kind: "verification" as const,
      fact,
    })),
    ...input.decisions.map((fact) => ({ kind: "decision" as const, fact })),
    ...input.associations.map((fact) => ({
      kind: "association" as const,
      fact,
    })),
  ];
  const parent = nodes.map((_node, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) {
      root = parent[root];
    }
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
    }
  };
  const recordLinks = new Map<string, number[]>();
  const verificationLinks = new Map<string, number[]>();
  const decisionLinks = new Map<string, number[]>();
  nodes.forEach((node, index) => {
    let recordId: string | undefined;
    let decisionId: string | undefined;
    if (node.kind === "record") {
      recordId = node.fact.id;
    } else if (node.kind === "verification") {
      recordId = node.fact.creditRecordId;
    } else if (node.kind === "decision") {
      recordId = node.fact.creditRecordId;
      decisionId = node.fact.id;
    } else {
      decisionId = node.fact.decisionId;
    }
    if (recordId !== undefined) {
      const linked = recordLinks.get(recordId) ?? [];
      linked.push(index);
      recordLinks.set(recordId, linked);
    }
    if (node.kind === "verification" && meaningful(node.fact.id)) {
      const linked = verificationLinks.get(node.fact.id) ?? [];
      linked.push(index);
      verificationLinks.set(node.fact.id, linked);
    }
    if (decisionId !== undefined) {
      const linked = decisionLinks.get(decisionId) ?? [];
      linked.push(index);
      decisionLinks.set(decisionId, linked);
    }
  });
  for (const linked of [
    ...recordLinks.values(),
    ...verificationLinks.values(),
    ...decisionLinks.values(),
  ]) {
    for (let index = 1; index < linked.length; index += 1) {
      union(linked[0], linked[index]);
    }
  }

  const componentNodes = new Map<number, FactNode[]>();
  nodes.forEach((node, index) => {
    const root = find(index);
    const component = componentNodes.get(root) ?? [];
    component.push(node);
    componentNodes.set(root, component);
  });
  const components = [...componentNodes.values()].map((component) => {
    const parts: ProvenanceParts = {
      context: input.context,
      records: component
        .filter((node) => node.kind === "record")
        .map((node) => node.fact),
      verifications: component
        .filter((node) => node.kind === "verification")
        .map((node) => node.fact),
      decisions: component
        .filter((node) => node.kind === "decision")
        .map((node) => node.fact),
      associations: component
        .filter((node) => node.kind === "association")
        .map((node) => node.fact),
    };
    return parts;
  }).sort((left, right) => compareStrings(
    JSON.stringify(provenance(left)),
    JSON.stringify(provenance(right)),
  ));

  for (const parts of components) {
    const records = parts.records ?? [];
    const verifications = parts.verifications ?? [];
    const decisions = parts.decisions ?? [];
    const associations = parts.associations ?? [];
    const invalidIdentity = (
      records.some((fact) => (
        !meaningful(fact.id) || !meaningful(fact.studentId)
      ))
      || verifications.some((fact) => (
        !meaningful(fact.id) || !meaningful(fact.creditRecordId)
      ))
      || decisions.some((fact) => (
        !meaningful(fact.id)
        || !meaningful(fact.creditRecordId)
        || !meaningful(fact.programAssignmentId)
      ))
      || associations.some((fact) => (
        !meaningful(fact.decisionId)
        || !meaningful(fact.requirementId)
        || (
          fact.academicRuleId !== null
          && !meaningful(fact.academicRuleId)
        )
      ))
    );
    if (invalidIdentity) {
      diagnostics.push(diagnostic("INVALID_RECORDED_CREDIT_IDENTITY", parts));
      continue;
    }
    if (
      records.some((fact) => !meaningful(fact.sourceId))
      || decisions.some((fact) => (
        (
          fact.basisClaimVersionId !== null
          && !meaningful(fact.basisClaimVersionId)
        )
        || (
          fact.equivalencyId !== null
          && !meaningful(fact.equivalencyId)
        )
        || (
          fact.targetInstitutionCourseVersionId !== null
          && !meaningful(fact.targetInstitutionCourseVersionId)
        )
      ))
    ) {
      diagnostics.push(diagnostic("INVALID_RECORDED_CREDIT_PROVENANCE", parts));
      continue;
    }
    if (decisions.length === 0 && associations.length === 0) {
      diagnostics.push(diagnostic(
        records.length > 0
          ? "ORPHAN_RECORDED_CREDIT_RECORD"
          : "ORPHAN_RECORDED_CREDIT_VERIFICATION",
        parts,
      ));
      continue;
    }
    if (decisions.length === 0) {
      diagnostics.push(diagnostic(
        "MISSING_RECORDED_CREDIT_DECISION",
        parts,
      ));
      continue;
    }
    if (records.length === 0) {
      diagnostics.push(diagnostic("MISSING_RECORDED_CREDIT_RECORD", parts));
      continue;
    }
    const duplicateRecordIdentity = [
      ...groupBy(records, (fact) => fact.id).values(),
    ].some((group) => group.length > 1);
    if (duplicateRecordIdentity) {
      diagnostics.push(diagnostic("AMBIGUOUS_RECORDED_CREDIT_RECORD", parts));
      continue;
    }
    if (verifications.length === 0) {
      diagnostics.push(diagnostic(
        "MISSING_RECORDED_CREDIT_VERIFICATION",
        parts,
      ));
      continue;
    }
    const duplicateVerificationIdentity = [
      ...groupBy(verifications, (fact) => fact.id).values(),
    ].some((group) => group.length > 1);
    const multipleVerificationsForRecord = [
      ...groupBy(verifications, (fact) => fact.creditRecordId).values(),
    ].some((group) => group.length > 1);
    if (duplicateVerificationIdentity || multipleVerificationsForRecord) {
      diagnostics.push(diagnostic(
        "AMBIGUOUS_RECORDED_CREDIT_VERIFICATION",
        parts,
      ));
      continue;
    }
    const duplicateDecisionIdentity = [
      ...groupBy(decisions, (fact) => fact.id).values(),
    ].some((group) => group.length > 1);
    const multipleDecisionsForRecord = [
      ...groupBy(decisions, (fact) => fact.creditRecordId).values(),
    ].some((group) => group.length > 1);
    if (duplicateDecisionIdentity || multipleDecisionsForRecord) {
      diagnostics.push(diagnostic(
        "AMBIGUOUS_RECORDED_CREDIT_DECISION",
        parts,
      ));
      continue;
    }
    if (associations.length === 0) {
      diagnostics.push(diagnostic(
        "MISSING_RECORDED_CREDIT_ASSOCIATION",
        parts,
      ));
      continue;
    }
    const multipleAssociationsForDecision = [
      ...groupBy(associations, (fact) => fact.decisionId).values(),
    ].some((group) => group.length > 1);
    if (multipleAssociationsForDecision) {
      diagnostics.push(diagnostic(
        "AMBIGUOUS_RECORDED_CREDIT_ASSOCIATION",
        parts,
      ));
      continue;
    }

    const recordFact = records[0];
    const verificationFact = verifications[0];
    const decisionFact = decisions[0];
    const associationFact = associations[0];
    if (recordFact.studentId !== input.context.studentId) {
      diagnostics.push(diagnostic("RECORDED_CREDIT_STUDENT_MISMATCH", parts));
      continue;
    }
    if (
      decisionFact.programAssignmentId
      !== input.context.programAssignmentId
    ) {
      diagnostics.push(diagnostic("RECORDED_CREDIT_PROGRAM_MISMATCH", parts));
      continue;
    }
    if (recordFact.status !== "verified") {
      diagnostics.push(diagnostic(
        "UNSUPPORTED_RECORDED_CREDIT_STATUS",
        parts,
      ));
      continue;
    }
    if (verificationFact.action !== "verified") {
      diagnostics.push(diagnostic(
        "UNSUPPORTED_RECORDED_VERIFICATION_ACTION",
        parts,
      ));
      continue;
    }
    if (decisionFact.action !== "accepted") {
      diagnostics.push(diagnostic(
        "UNSUPPORTED_RECORDED_DECISION_ACTION",
        parts,
      ));
      continue;
    }
    if (!validPositiveCredit(decisionFact.creditsAwarded)) {
      diagnostics.push(diagnostic(
        "INVALID_RECORDED_AWARDED_CREDIT",
        parts,
      ));
      continue;
    }
    const requirementMatches = input.requirements.filter((requirement) => (
      requirement.requirementId === associationFact.requirementId
    ));
    if (
      requirementMatches.length !== 1
      || requirementMatches[0].academicRuleId
        !== associationFact.academicRuleId
    ) {
      diagnostics.push(diagnostic(
        "RECORDED_CREDIT_PLACEMENT_MISMATCH",
        parts,
      ));
      continue;
    }

    evidence.push(freezeEvidence({
      evidenceId: decisionFact.id,
      studentCreditRecordId: recordFact.id,
      requirementId: associationFact.requirementId,
      academicRuleId: associationFact.academicRuleId,
      kind: "accepted_credit",
      unit: "credits",
      amount: decisionFact.creditsAwarded,
      verificationEventId: verificationFact.id,
      decisionId: decisionFact.id,
      exceptionIds: [],
      sourceIds: [recordFact.sourceId],
      claimVersionIds: decisionFact.basisClaimVersionId === null
        ? []
        : [decisionFact.basisClaimVersionId],
    }, provenance(parts)));
  }

  return finish();
}