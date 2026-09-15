/**
 * Phase 3, Chunk 6: deterministic composition of the recorded-credit and
 * recorded-exception projections.  This module deliberately does not perform
 * another normalization or evaluation pass.
 */

import type {
  CanonicalRequirementSnapshotInput,
  CanonicalUnresolvedConflictInput,
} from "./requirements-evidence-normalizer";
import {
  projectRecordedAcademicExceptions,
  type RecordedAcademicExceptionFact,
  type RecordedAcademicExceptionPlacement,
  type RecordedAcademicExceptionProjectionOutput,
  type RecordedExceptionAcademicRuleTarget,
} from "./recorded-academic-exception-projection";
import {
  projectRecordedStudentCreditFacts,
  type RecordedCreditProjectionContext,
  type RecordedCreditProjectionOutput,
  type RecordedCreditRecordFact,
  type RecordedCreditVerificationFact,
  type RecordedCreditDecisionFact,
  type RecordedDecisionRequirementAssociation,
} from "./recorded-credit-projection";

export interface DegreeProgressCompositionContext
  extends RecordedCreditProjectionContext {
  readonly programVersionId: string;
}

export interface ProgramAssignmentRegistryEntry {
  readonly id: string;
  readonly studentId: string;
  readonly programVersionId: string;
  readonly status: "active" | "completed" | "withdrawn" | "superseded";
}

export interface ProgramBoundRequirementSnapshotInput
  extends CanonicalRequirementSnapshotInput {
  readonly programVersionId: string;
}

export interface ProgramBoundAcademicRuleTarget
  extends RecordedExceptionAcademicRuleTarget {
  readonly programVersionId: string | null;
}

export interface DegreeProgressCompositionInput {
  readonly context: DegreeProgressCompositionContext;
  readonly programAssignmentRegistry: readonly ProgramAssignmentRegistryEntry[];
  readonly requirements: readonly ProgramBoundRequirementSnapshotInput[];
  readonly academicRules: readonly ProgramBoundAcademicRuleTarget[];
  readonly unresolvedConflicts: readonly CanonicalUnresolvedConflictInput[];
  readonly creditRecords: readonly RecordedCreditRecordFact[];
  readonly verificationEvents: readonly RecordedCreditVerificationFact[];
  readonly decisions: readonly RecordedCreditDecisionFact[];
  readonly associations: readonly RecordedDecisionRequirementAssociation[];
  readonly exceptions: readonly RecordedAcademicExceptionFact[];
  readonly placements: readonly RecordedAcademicExceptionPlacement[];
}

export type DegreeProgressDiagnosticStage =
  | "COMPOSITION"
  | "RECORDED_CREDIT"
  | "CANONICAL_NORMALIZATION"
  | "RECORDED_EXCEPTION";

export interface DegreeProgressCompositionOccurrence {
  readonly kind:
    | "programAssignment"
    | "requirement"
    | "academicRule"
    | "creditRecord"
    | "verificationEvent"
    | "decision"
    | "association"
    | "unresolvedConflict"
    | "exception"
    | "placement";
  readonly [field: string]: unknown;
}

export interface DegreeProgressCompositionProvenance {
  readonly studentIds: readonly string[];
  readonly programAssignmentIds: readonly string[];
  readonly programVersionIds: readonly string[];
  readonly requirementIds: readonly string[];
  readonly academicRuleIds: readonly string[];
  readonly studentCreditRecordIds: readonly string[];
  readonly verificationEventIds: readonly string[];
  readonly decisionIds: readonly string[];
  readonly conflictIds: readonly string[];
  readonly exceptionIds: readonly string[];
  readonly supersededExceptionIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly claimVersionIds: readonly string[];
  readonly equivalencyIds: readonly string[];
  readonly targetInstitutionCourseVersionIds: readonly string[];
  readonly approvedByIds: readonly string[];
  readonly occurrences: readonly DegreeProgressCompositionOccurrence[];
}

export interface DegreeProgressCompositionInputAccounting {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly occurrences: readonly DegreeProgressCompositionOccurrence[];
}

export interface DegreeProgressCompositionDiagnostic {
  readonly stage: DegreeProgressDiagnosticStage;
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly status: "MANUAL_REVIEW";
  readonly reason: string;
  readonly provenance: unknown;
}

export interface DegreeProgressInformationalEnvelope {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly compositionKind: "INFORMATIONAL_ONLY";
  readonly status: "MANUAL_REVIEW";
  readonly context: DegreeProgressCompositionContext;
  readonly diagnostics: readonly DegreeProgressCompositionDiagnostic[];
}

export interface DegreeProgressComposedReport {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly compositionKind: "COMPOSED";
  readonly context: DegreeProgressCompositionContext;
  readonly diagnostics: readonly DegreeProgressCompositionDiagnostic[];
  readonly recordedCreditProjection: RecordedCreditProjectionOutput;
  readonly recordedExceptionProjection: RecordedAcademicExceptionProjectionOutput;
  readonly inputAccounting: DegreeProgressCompositionInputAccounting;
  readonly evidence: RecordedAcademicExceptionProjectionOutput["evidence"];
  readonly normalization: RecordedAcademicExceptionProjectionOutput["normalization"];
  readonly results: RecordedAcademicExceptionProjectionOutput["results"];
  readonly observations: RecordedAcademicExceptionProjectionOutput["observations"];
}

export type DegreeProgressCompositionOutput =
  | DegreeProgressInformationalEnvelope
  | DegreeProgressComposedReport;

function meaningful(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values: readonly (string | null | undefined)[]): readonly string[] {
  return Object.freeze(
    [...new Set(values.filter(meaningful))].sort(compareStrings),
  );
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (
    value === null
    || (typeof value !== "object" && typeof value !== "function")
    || seen.has(value as object)
  ) {
    return value;
  }
  seen.add(value as object);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

function contextCopy(
  context: DegreeProgressCompositionContext,
): DegreeProgressCompositionContext {
  return Object.freeze({
    studentId: context.studentId,
    programAssignmentId: context.programAssignmentId,
    programVersionId: context.programVersionId,
  });
}

function compositionProvenance(
  input: DegreeProgressCompositionInput,
  requirements = input.requirements,
  rules = input.academicRules,
): DegreeProgressCompositionProvenance {
  const occurrences: DegreeProgressCompositionOccurrence[] = [
    ...input.programAssignmentRegistry.map((item) => ({
      kind: "programAssignment" as const,
      id: item.id,
      studentId: item.studentId,
      programVersionId: item.programVersionId,
      status: item.status,
    })),
    ...requirements.map((item) => ({
      kind: "requirement" as const,
      requirementId: item.requirementId,
      academicRuleId: item.academicRuleId,
      programVersionId: item.programVersionId,
    })),
    ...rules.map((item) => ({
      kind: "academicRule" as const,
      id: item.id,
      programVersionId: item.programVersionId,
    })),
    ...input.creditRecords.map((item) => ({
      kind: "creditRecord" as const,
      id: item.id,
      studentId: item.studentId,
      sourceId: item.sourceId,
      status: item.status,
    })),
    ...input.verificationEvents.map((item) => ({
      kind: "verificationEvent" as const,
      id: item.id,
      creditRecordId: item.creditRecordId,
      seq: item.seq,
      action: item.action,
    })),
    ...input.decisions.map((item) => ({
      kind: "decision" as const,
      id: item.id,
      creditRecordId: item.creditRecordId,
      programAssignmentId: item.programAssignmentId,
      seq: item.seq,
      action: item.action,
      basisClaimVersionId: item.basisClaimVersionId,
      equivalencyId: item.equivalencyId,
      targetInstitutionCourseVersionId: item.targetInstitutionCourseVersionId,
    })),
    ...input.associations.map((item) => ({
      kind: "association" as const,
      decisionId: item.decisionId,
      requirementId: item.requirementId,
      academicRuleId: item.academicRuleId,
    })),
    ...input.unresolvedConflicts.map((item) => ({
      kind: "unresolvedConflict" as const,
      conflictId: item.conflictId,
      requirementId: item.requirementId,
      academicRuleId: item.academicRuleId,
      status: item.status,
    })),
    ...input.exceptions.map((item) => ({
      kind: "exception" as const,
      id: item.id,
      studentId: item.studentId,
      programAssignmentId: item.programAssignmentId,
      exceptionType: item.exceptionType,
      status: item.status,
      requirementId: item.requirementId,
      academicRuleId: item.academicRuleId,
      creditRecordId: item.creditRecordId,
      supersedesExceptionId: item.supersedesExceptionId,
      approvedBy: item.approvedBy,
    })),
    ...input.placements.map((item) => ({
      kind: "placement" as const,
      exceptionId: item.exceptionId,
      requirementId: item.requirementId,
      academicRuleId: item.academicRuleId,
      creditRecordId: item.creditRecordId,
      evidenceId: item.evidenceId,
    })),
  ];
  occurrences.sort((left, right) => (
    compareStrings(stableJson(left), stableJson(right))
  ));
  return Object.freeze({
    studentIds: sortedUnique([
      input.context.studentId,
      ...input.programAssignmentRegistry.map((item) => item.studentId),
      ...input.creditRecords.map((item) => item.studentId),
      ...input.exceptions.map((item) => item.studentId),
    ]),
    programAssignmentIds: sortedUnique([
      input.context.programAssignmentId,
      ...input.programAssignmentRegistry.map((item) => item.id),
      ...input.decisions.map((item) => item.programAssignmentId),
      ...input.exceptions.map((item) => item.programAssignmentId),
    ]),
    programVersionIds: sortedUnique([
      input.context.programVersionId,
      ...input.programAssignmentRegistry.map((item) => item.programVersionId),
      ...requirements.map((item) => item.programVersionId),
      ...rules.map((item) => item.programVersionId),
    ]),
    requirementIds: sortedUnique([
      ...requirements.map((item) => item.requirementId),
      ...input.associations.map((item) => item.requirementId),
      ...input.unresolvedConflicts.map((item) => item.requirementId),
      ...input.exceptions.map((item) => item.requirementId),
      ...input.placements.map((item) => item.requirementId),
    ]),
    academicRuleIds: sortedUnique([
      ...requirements.map((item) => item.academicRuleId),
      ...rules.map((item) => item.id),
      ...input.associations.map((item) => item.academicRuleId),
      ...input.unresolvedConflicts.map((item) => item.academicRuleId),
      ...input.exceptions.map((item) => item.academicRuleId),
      ...input.placements.map((item) => item.academicRuleId),
    ]),
    studentCreditRecordIds: sortedUnique([
      ...input.creditRecords.map((item) => item.id),
      ...input.verificationEvents.map((item) => item.creditRecordId),
      ...input.decisions.map((item) => item.creditRecordId),
      ...input.exceptions.map((item) => item.creditRecordId),
      ...input.placements.map((item) => item.creditRecordId),
    ]),
    verificationEventIds: sortedUnique(
      input.verificationEvents.map((item) => item.id),
    ),
    decisionIds: sortedUnique([
      ...input.decisions.map((item) => item.id),
      ...input.associations.map((item) => item.decisionId),
    ]),
    conflictIds: sortedUnique(input.unresolvedConflicts.map((item) => item.conflictId)),
    exceptionIds: sortedUnique([
      ...input.exceptions.map((item) => item.id),
      ...input.placements.map((item) => item.exceptionId),
    ]),
    supersededExceptionIds: sortedUnique(
      input.exceptions.map((item) => item.supersedesExceptionId),
    ),
    evidenceIds: sortedUnique(input.placements.map((item) => item.evidenceId)),
    sourceIds: sortedUnique([
      ...input.creditRecords.map((item) => item.sourceId),
      ...requirements.flatMap((item) => item.sourceIds),
      ...input.unresolvedConflicts.flatMap((item) => item.sourceIds),
    ]),
    claimVersionIds: sortedUnique([
      ...requirements.flatMap((item) => item.claimVersionIds),
      ...input.unresolvedConflicts.flatMap((item) => item.claimVersionIds),
      ...input.decisions.map((item) => item.basisClaimVersionId),
    ]),
    equivalencyIds: sortedUnique(
      input.decisions.map((item) => item.equivalencyId),
    ),
    targetInstitutionCourseVersionIds: sortedUnique(
      input.decisions.map((item) => item.targetInstitutionCourseVersionId),
    ),
    approvedByIds: sortedUnique(
      input.exceptions.map((item) => item.approvedBy),
    ),
    occurrences: Object.freeze(
      occurrences.map((item) => Object.freeze(item)),
    ),
  });
}

function compositionDiagnostic(
  reason: string,
  input: DegreeProgressCompositionInput,
): DegreeProgressCompositionDiagnostic {
  return Object.freeze({
    stage: "COMPOSITION",
    projectionKind: "INFORMATIONAL_ONLY",
    status: "MANUAL_REVIEW",
    reason,
    provenance: compositionProvenance(input),
  });
}

function preflight(
  input: DegreeProgressCompositionInput,
): readonly DegreeProgressCompositionDiagnostic[] {
  const diagnostics: DegreeProgressCompositionDiagnostic[] = [];
  const registry = input.programAssignmentRegistry;
  const rules = input.academicRules;
  const context = input.context;

  if (
    !meaningful(context?.studentId)
    || !meaningful(context?.programAssignmentId)
    || !meaningful(context?.programVersionId)
  ) {
    diagnostics.push(compositionDiagnostic("INVALID_COMPOSITION_CONTEXT", input));
  }

  if (registry.some((item) => (
    !meaningful(item.id)
    || !meaningful(item.studentId)
    || !meaningful(item.programVersionId)
  ))) {
    diagnostics.push(compositionDiagnostic(
      "INVALID_PROGRAM_ASSIGNMENT_IDENTITY",
      input,
    ));
  }

  const assignmentsById = new Map<string, ProgramAssignmentRegistryEntry[]>();
  for (const item of registry) {
    if (!meaningful(item.id)) continue;
    const group = assignmentsById.get(item.id) ?? [];
    group.push(item);
    assignmentsById.set(item.id, group);
  }
  const hasDuplicateAssignmentIdentity = [...assignmentsById.values()]
    .some((group) => group.length > 1);
  if (hasDuplicateAssignmentIdentity) {
    diagnostics.push(compositionDiagnostic(
      "AMBIGUOUS_PROGRAM_ASSIGNMENT_IDENTITY",
      input,
    ));
  }
  if (registry.length === 0) {
    diagnostics.push(compositionDiagnostic("MISSING_PROGRAM_ASSIGNMENT", input));
  } else {
    if (registry.length > 1 && !hasDuplicateAssignmentIdentity) {
      diagnostics.push(compositionDiagnostic(
        "AMBIGUOUS_PROGRAM_ASSIGNMENT_BINDING",
        input,
      ));
    }
    const assignments = assignmentsById.get(context.programAssignmentId) ?? [];
    const assignment = assignments[0];
    if (assignments.length === 0) {
      diagnostics.push(compositionDiagnostic(
        "MISSING_PROGRAM_ASSIGNMENT",
        input,
      ));
    }
    if (
      registry.length !== 1
      || assignments.length !== 1
      || !meaningful(assignment?.id)
      || !meaningful(assignment?.studentId)
      || !meaningful(assignment?.programVersionId)
    ) {
      // Cardinality and identity diagnostics above account for every row.
    } else {
      if (assignment.studentId !== context.studentId) {
        diagnostics.push(compositionDiagnostic(
          "PROGRAM_ASSIGNMENT_STUDENT_MISMATCH",
          input,
        ));
      }
      if (assignment.programVersionId !== context.programVersionId) {
        diagnostics.push(compositionDiagnostic(
          "PROGRAM_ASSIGNMENT_PROGRAM_VERSION_MISMATCH",
          input,
        ));
      }
      if (assignment.status !== "active") {
        diagnostics.push(compositionDiagnostic(
          "INACTIVE_PROGRAM_ASSIGNMENT",
          input,
        ));
      }
    }
  }

  const requirementsById = new Map<string, ProgramBoundRequirementSnapshotInput[]>();
  for (const requirement of input.requirements) {
    if (!meaningful(requirement.requirementId)) continue;
    const group = requirementsById.get(requirement.requirementId) ?? [];
    group.push(requirement);
    requirementsById.set(requirement.requirementId, group);
  }
  if (input.requirements.some((item) => !meaningful(item.requirementId))) {
    diagnostics.push(compositionDiagnostic(
      "INVALID_REQUIREMENT_IDENTITY",
      input,
    ));
  }
  if ([...requirementsById.values()].some((group) => group.length > 1)) {
    diagnostics.push(compositionDiagnostic(
      "AMBIGUOUS_REQUIREMENT_IDENTITY",
      input,
    ));
  }
  if (input.requirements.some((item) => (
    !meaningful(item.programVersionId)
  ))) {
    diagnostics.push(compositionDiagnostic(
      "INVALID_REQUIREMENT_PROGRAM_VERSION",
      input,
    ));
  } else if (input.requirements.some((item) => (
    item.programVersionId !== context.programVersionId
  ))) {
    diagnostics.push(compositionDiagnostic(
      "REQUIREMENT_PROGRAM_VERSION_MISMATCH",
      input,
    ));
  }

  const referencedRuleValues = [
    ...input.requirements.map((item) => item.academicRuleId),
    ...input.associations.map((item) => item.academicRuleId),
    ...input.unresolvedConflicts.map((item) => item.academicRuleId),
    ...input.exceptions.map((item) => item.academicRuleId),
    ...input.placements.map((item) => item.academicRuleId),
  ];
  if (referencedRuleValues.some((value) => (
    value !== null && !meaningful(value)
  ))) {
    diagnostics.push(compositionDiagnostic(
      "INVALID_REFERENCED_RULE_IDENTITY",
      input,
    ));
  }
  const referencedRuleIds = referencedRuleValues.filter(meaningful);
  const ruleGroups = new Map<string, ProgramBoundAcademicRuleTarget[]>();
  for (const rule of rules) {
    if (!meaningful(rule.id)) continue;
    const group = ruleGroups.get(rule.id) ?? [];
    group.push(rule);
    ruleGroups.set(rule.id, group);
  }
  const referenced = new Set(referencedRuleIds);
  if (rules.some((rule) => (
    !meaningful(rule.id)
    || (
      (rule.programVersionId === null || !meaningful(rule.programVersionId))
      && !referenced.has(rule.id)
    )
  ))) {
    diagnostics.push(compositionDiagnostic(
      "INVALID_ACADEMIC_RULE_IDENTITY",
      input,
    ));
  }
  const duplicateRuleIds = new Set(
    [...ruleGroups.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([id]) => id),
  );
  if ([...duplicateRuleIds].some((id) => !referenced.has(id))) {
    diagnostics.push(compositionDiagnostic(
      "AMBIGUOUS_ACADEMIC_RULE_IDENTITY",
      input,
    ));
  }
  if ([...ruleGroups.keys()].some((id) => !referenced.has(id))) {
    diagnostics.push(compositionDiagnostic(
      "UNREFERENCED_ACADEMIC_RULE",
      input,
    ));
  }
  if (rules.some((rule) => (
    rule.programVersionId !== null
    && meaningful(rule.programVersionId)
    && !referenced.has(rule.id)
    && rule.programVersionId !== context.programVersionId
  ))) {
    diagnostics.push(compositionDiagnostic(
      "ACADEMIC_RULE_PROGRAM_VERSION_MISMATCH",
      input,
    ));
  }
  for (const ruleId of [...referenced].sort(compareStrings)) {
    const group = ruleGroups.get(ruleId) ?? [];
    if (group.length === 0) {
      diagnostics.push(compositionDiagnostic("MISSING_REFERENCED_RULE", input));
      continue;
    }
    if (group.length > 1) {
      diagnostics.push(compositionDiagnostic(
        "AMBIGUOUS_REFERENCED_RULE",
        input,
      ));
      continue;
    }
    const rule = group[0];
    if (
      rule.programVersionId === null
      || !meaningful(rule.programVersionId)
    ) {
      diagnostics.push(compositionDiagnostic(
        "NULL_SCOPED_REFERENCED_RULE",
        input,
      ));
    } else if (rule.programVersionId !== context.programVersionId) {
      diagnostics.push(compositionDiagnostic(
        "REFERENCED_RULE_PROGRAM_VERSION_MISMATCH",
        input,
      ));
    }
  }

  return Object.freeze(diagnostics.sort((left, right) => (
    compareStrings(left.reason, right.reason)
    || compareStrings(stableJson(left.provenance), stableJson(right.provenance))
  )));
}

function stageDiagnostics(
  stage: DegreeProgressDiagnosticStage,
  diagnostics: readonly {
    readonly projectionKind: "INFORMATIONAL_ONLY";
    readonly status: "MANUAL_REVIEW";
    readonly reason: string;
    readonly provenance: unknown;
  }[],
): readonly DegreeProgressCompositionDiagnostic[] {
  return diagnostics.map((diagnostic) => Object.freeze({
    ...diagnostic,
    stage,
  }));
}

function allDiagnostics(
  credit: RecordedCreditProjectionOutput,
  exceptions: RecordedAcademicExceptionProjectionOutput,
): readonly DegreeProgressCompositionDiagnostic[] {
  const diagnostics = [
    ...stageDiagnostics("RECORDED_CREDIT", credit.diagnostics),
    ...stageDiagnostics(
      "CANONICAL_NORMALIZATION",
      credit.normalization.diagnostics,
    ),
    ...stageDiagnostics("RECORDED_EXCEPTION", exceptions.diagnostics),
  ];
  const stageOrder: Record<DegreeProgressDiagnosticStage, number> = {
    COMPOSITION: 0,
    RECORDED_CREDIT: 1,
    CANONICAL_NORMALIZATION: 2,
    RECORDED_EXCEPTION: 3,
  };
  return Object.freeze(diagnostics.sort((left, right) => (
    stageOrder[left.stage] - stageOrder[right.stage]
    || compareStrings(left.reason, right.reason)
    || compareStrings(stableJson(left.provenance), stableJson(right.provenance))
  )));
}

function strippedRequirements(
  requirements: readonly ProgramBoundRequirementSnapshotInput[],
): readonly CanonicalRequirementSnapshotInput[] {
  return Object.freeze(requirements.map((requirement) => Object.freeze({
    requirementId: requirement.requirementId,
    academicRuleId: requirement.academicRuleId,
    kind: requirement.kind,
    unit: requirement.unit,
    requiredAmount: requirement.requiredAmount,
    sourceIds: requirement.sourceIds,
    claimVersionIds: requirement.claimVersionIds,
  })));
}

export function composeDegreeProgress(
  input: DegreeProgressCompositionInput,
): DegreeProgressCompositionOutput {
  const rejectedDiagnostics = preflight(input);
  const context = contextCopy(input.context);
  if (rejectedDiagnostics.length > 0) {
    return deepFreeze({
      projectionKind: "INFORMATIONAL_ONLY" as const,
      compositionKind: "INFORMATIONAL_ONLY" as const,
      status: "MANUAL_REVIEW" as const,
      context,
      diagnostics: rejectedDiagnostics,
    });
  }

  const requirements = strippedRequirements(input.requirements);
  const stageContext: RecordedCreditProjectionContext = Object.freeze({
    studentId: input.context.studentId,
    programAssignmentId: input.context.programAssignmentId,
  });
  const credit = projectRecordedStudentCreditFacts({
    context: stageContext,
    requirements,
    unresolvedConflicts: input.unresolvedConflicts,
    creditRecords: input.creditRecords,
    verificationEvents: input.verificationEvents,
    decisions: input.decisions,
    associations: input.associations,
  });
  const exceptions = projectRecordedAcademicExceptions({
    context: stageContext,
    exceptions: input.exceptions,
    placements: input.placements,
    requirements,
    academicRules: input.academicRules.map((rule) => Object.freeze({ id: rule.id })),
    creditRecords: input.creditRecords,
    unresolvedConflicts: input.unresolvedConflicts,
    recordedCreditProjection: credit,
  });
  const inputAccounting = compositionProvenance(input);
  return deepFreeze({
    projectionKind: "INFORMATIONAL_ONLY" as const,
    compositionKind: "COMPOSED" as const,
    context,
    diagnostics: allDiagnostics(credit, exceptions),
    recordedCreditProjection: credit,
    recordedExceptionProjection: exceptions,
    inputAccounting: {
      projectionKind: "INFORMATIONAL_ONLY" as const,
      occurrences: inputAccounting.occurrences,
    },
    evidence: exceptions.evidence,
    normalization: exceptions.normalization,
    results: exceptions.results,
    observations: exceptions.observations,
  });
}