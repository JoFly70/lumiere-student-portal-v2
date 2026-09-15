/**
 * Pure informational projection of caller-supplied academic exception rows.
 * Exception types are recorded observations only: this module never infers or
 * applies waiver, substitution, credit, level, residency, or temporal effects.
 */

import type { AcademicRule } from "./knowledge-schema";
import type {
  StudentAcademicException,
  StudentCreditRecord,
} from "./student-academic-schema";
import type {
  CanonicalRequirementSnapshotInput,
  CanonicalUnresolvedConflictInput,
} from "./requirements-evidence-normalizer";
import type { QuantitativeRequirementResult } from "./requirements-status-engine";
import type {
  ProjectedRecordedCreditEvidence,
  RecordedCreditProjectionContext,
  RecordedCreditProjectionOutput,
  RecordedCreditProvenance,
} from "./recorded-credit-projection";

export type RecordedAcademicExceptionFact = Readonly<Pick<
  StudentAcademicException,
  | "id"
  | "studentId"
  | "programAssignmentId"
  | "exceptionType"
  | "status"
  | "requirementId"
  | "academicRuleId"
  | "creditRecordId"
  | "supersedesExceptionId"
  | "approvedBy"
  | "rationale"
  | "effectiveFrom"
  | "effectiveTo"
  | "metadata"
  | "createdAt"
>>;

export interface RecordedAcademicExceptionPlacement {
  readonly exceptionId: string;
  readonly requirementId: string | null;
  readonly academicRuleId: string | null;
  readonly creditRecordId: string | null;
  readonly evidenceId: string | null;
}

export type RecordedExceptionAcademicRuleTarget = Readonly<Pick<
  AcademicRule,
  "id"
>>;

export type RecordedExceptionCreditRecordTarget = Readonly<Pick<
  StudentCreditRecord,
  "id" | "studentId"
>>;

export interface RecordedAcademicExceptionProjectionInput {
  readonly context: RecordedCreditProjectionContext;
  readonly exceptions: readonly RecordedAcademicExceptionFact[];
  readonly placements: readonly RecordedAcademicExceptionPlacement[];
  readonly requirements: readonly CanonicalRequirementSnapshotInput[];
  readonly academicRules: readonly RecordedExceptionAcademicRuleTarget[];
  readonly creditRecords: readonly RecordedExceptionCreditRecordTarget[];
  readonly unresolvedConflicts: readonly CanonicalUnresolvedConflictInput[];
  readonly recordedCreditProjection: RecordedCreditProjectionOutput;
}

export interface RecordedAcademicExceptionProvenance
  extends RecordedCreditProvenance {
  readonly exceptionIds: readonly string[];
  readonly supersededExceptionIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly approvedByIds: readonly string[];
}

export interface RecordedAcademicExceptionObservation {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly status: "MANUAL_REVIEW";
  readonly reason: "RECORDED_EXCEPTION_EFFECT_UNDEFINED";
  readonly exceptionId: string;
  readonly exceptionType: RecordedAcademicExceptionFact["exceptionType"];
  readonly exceptionStatus: "active";
  readonly rationale: string;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly createdAt: string;
  readonly metadata: unknown;
  readonly provenance: RecordedAcademicExceptionProvenance;
}

export interface RecordedAcademicExceptionDiagnostic {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly status: "MANUAL_REVIEW";
  readonly reason: string;
  readonly provenance: RecordedAcademicExceptionProvenance;
}

export interface RecordedAcademicExceptionProjectionOutput {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly observations: readonly RecordedAcademicExceptionObservation[];
  readonly diagnostics: readonly RecordedAcademicExceptionDiagnostic[];
  readonly evidence: readonly ProjectedRecordedCreditEvidence[];
  readonly normalization: RecordedCreditProjectionOutput["normalization"];
  readonly results: readonly QuantitativeRequirementResult[];
}

const EXCEPTION_TYPES = new Set<string>([
  "requirement_waiver",
  "course_substitution",
  "credit_override",
  "level_override",
  "residency_override",
  "other",
]);

const EXCEPTION_STATUSES = new Set<string>([
  "active",
  "revoked",
  "superseded",
]);

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function meaningful(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sortedUnique(values: readonly (string | null)[]): readonly string[] {
  return Object.freeze(
    [...new Set(values.filter(meaningful))].sort(compareStrings),
  );
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function cloneOpaqueJson(value: unknown, seen = new Set<object>()): unknown {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Opaque metadata contains a non-finite number");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError("Opaque metadata contains a cycle");
    }
    seen.add(value);
    const clone = Object.freeze(value.map((item) => cloneOpaqueJson(item, seen)));
    seen.delete(value);
    return clone;
  }
  if (
    typeof value === "object"
    && Object.getPrototypeOf(value) === Object.prototype
  ) {
    if (seen.has(value)) {
      throw new TypeError("Opaque metadata contains a cycle");
    }
    seen.add(value);
    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort(
      compareStrings,
    )) {
      Object.defineProperty(clone, key, {
        value: cloneOpaqueJson(
          (value as Record<string, unknown>)[key],
          seen,
        ),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    seen.delete(value);
    return Object.freeze(clone);
  }
  throw new TypeError("Opaque metadata is not JSON-compatible");
}

function stableJson(value: unknown): string {
  return JSON.stringify(cloneOpaqueJson(value));
}

interface ExceptionComponentParts {
  readonly exceptions: readonly RecordedAcademicExceptionFact[];
  readonly placements: readonly RecordedAcademicExceptionPlacement[];
  readonly evidence: readonly ProjectedRecordedCreditEvidence[];
  readonly recordedProvenance?: RecordedCreditProvenance;
}

function provenance(
  context: RecordedCreditProjectionContext,
  parts: ExceptionComponentParts,
): RecordedAcademicExceptionProvenance {
  const recorded = [
    ...(parts.recordedProvenance === undefined
      ? []
      : [parts.recordedProvenance]),
    ...parts.evidence.map((item) => item.recordedProvenance),
  ];
  return Object.freeze({
    studentIds: sortedUnique([
      context.studentId,
      ...parts.exceptions.map((item) => item.studentId),
      ...recorded.flatMap((item) => item.studentIds),
    ]),
    programAssignmentIds: sortedUnique([
      context.programAssignmentId,
      ...parts.exceptions.map((item) => item.programAssignmentId),
      ...recorded.flatMap((item) => item.programAssignmentIds),
    ]),
    studentCreditRecordIds: sortedUnique([
      ...parts.exceptions.map((item) => item.creditRecordId),
      ...parts.placements.map((item) => item.creditRecordId),
      ...recorded.flatMap((item) => item.studentCreditRecordIds),
    ]),
    verificationEventIds: sortedUnique(
      recorded.flatMap((item) => item.verificationEventIds),
    ),
    decisionIds: sortedUnique(recorded.flatMap((item) => item.decisionIds)),
    requirementIds: sortedUnique([
      ...parts.exceptions.map((item) => item.requirementId),
      ...parts.placements.map((item) => item.requirementId),
      ...recorded.flatMap((item) => item.requirementIds),
    ]),
    academicRuleIds: sortedUnique([
      ...parts.exceptions.map((item) => item.academicRuleId),
      ...parts.placements.map((item) => item.academicRuleId),
      ...recorded.flatMap((item) => item.academicRuleIds),
    ]),
    sourceIds: sortedUnique(recorded.flatMap((item) => item.sourceIds)),
    claimVersionIds: sortedUnique(
      recorded.flatMap((item) => item.claimVersionIds),
    ),
    equivalencyIds: sortedUnique(
      recorded.flatMap((item) => item.equivalencyIds),
    ),
    targetInstitutionCourseVersionIds: sortedUnique(
      recorded.flatMap((item) => item.targetInstitutionCourseVersionIds),
    ),
    exceptionIds: sortedUnique([
      ...parts.exceptions.map((item) => item.id),
      ...parts.placements.map((item) => item.exceptionId),
    ]),
    supersededExceptionIds: sortedUnique(
      parts.exceptions.map((item) => item.supersedesExceptionId),
    ),
    evidenceIds: sortedUnique(
      parts.placements.map((item) => item.evidenceId),
    ),
    approvedByIds: sortedUnique(
      parts.exceptions.map((item) => item.approvedBy),
    ),
  });
}

function diagnostic(
  reason: string,
  context: RecordedCreditProjectionContext,
  parts: ExceptionComponentParts,
): RecordedAcademicExceptionDiagnostic {
  return Object.freeze({
    projectionKind: "INFORMATIONAL_ONLY",
    status: "MANUAL_REVIEW",
    reason,
    provenance: provenance(context, parts),
  });
}

function frozenEvidence(
  evidence: ProjectedRecordedCreditEvidence,
  exceptionIds: readonly string[],
): ProjectedRecordedCreditEvidence {
  const recordedProvenance = Object.freeze({
    studentIds: Object.freeze([...evidence.recordedProvenance.studentIds]),
    programAssignmentIds: Object.freeze([
      ...evidence.recordedProvenance.programAssignmentIds,
    ]),
    studentCreditRecordIds: Object.freeze([
      ...evidence.recordedProvenance.studentCreditRecordIds,
    ]),
    verificationEventIds: Object.freeze([
      ...evidence.recordedProvenance.verificationEventIds,
    ]),
    decisionIds: Object.freeze([...evidence.recordedProvenance.decisionIds]),
    requirementIds: Object.freeze([
      ...evidence.recordedProvenance.requirementIds,
    ]),
    academicRuleIds: Object.freeze([
      ...evidence.recordedProvenance.academicRuleIds,
    ]),
    sourceIds: Object.freeze([...evidence.recordedProvenance.sourceIds]),
    claimVersionIds: Object.freeze([
      ...evidence.recordedProvenance.claimVersionIds,
    ]),
    equivalencyIds: Object.freeze([
      ...evidence.recordedProvenance.equivalencyIds,
    ]),
    targetInstitutionCourseVersionIds: Object.freeze([
      ...evidence.recordedProvenance.targetInstitutionCourseVersionIds,
    ]),
  });
  return Object.freeze({
    ...evidence,
    exceptionIds: sortedUnique(exceptionIds),
    sourceIds: Object.freeze([...evidence.sourceIds]),
    claimVersionIds: Object.freeze([...evidence.claimVersionIds]),
    recordedProvenance,
  });
}

function hasCycle(
  exceptions: readonly RecordedAcademicExceptionFact[],
): boolean {
  const parents = new Map(
    exceptions.map((item) => [item.id, item.supersedesExceptionId]),
  );
  for (const item of exceptions) {
    const visited = new Set<string>();
    let current: string | null = item.id;
    while (current !== null && parents.has(current)) {
      if (visited.has(current)) {
        return true;
      }
      visited.add(current);
      current = parents.get(current) ?? null;
    }
  }
  return false;
}

export function projectRecordedAcademicExceptions(
  input: RecordedAcademicExceptionProjectionInput,
): RecordedAcademicExceptionProjectionOutput {
  const observations: RecordedAcademicExceptionObservation[] = [];
  const diagnostics: RecordedAcademicExceptionDiagnostic[] = [];
  const associatedExceptionIds = new Map<string, string[]>();

  const finish = (): RecordedAcademicExceptionProjectionOutput => {
    observations.sort((left, right) => (
      compareStrings(left.exceptionId, right.exceptionId)
    ));
    diagnostics.sort((left, right) => (
      compareStrings(left.reason, right.reason)
      || compareStrings(
        JSON.stringify(left.provenance),
        JSON.stringify(right.provenance),
      )
    ));
    const evidence = Object.freeze(
      [...input.recordedCreditProjection.evidence]
        .sort((left, right) => compareStrings(
          left.evidenceId,
          right.evidenceId,
        ) || compareStrings(stableJson(left), stableJson(right)))
        .map((item) => frozenEvidence(item, [
          ...item.exceptionIds,
          ...(associatedExceptionIds.get(item.evidenceId) ?? []),
        ])),
    );
    const normalization = cloneOpaqueJson(
      input.recordedCreditProjection.normalization,
    ) as RecordedCreditProjectionOutput["normalization"];
    const results = cloneOpaqueJson(
      input.recordedCreditProjection.results,
    ) as readonly QuantitativeRequirementResult[];
    return Object.freeze({
      projectionKind: "INFORMATIONAL_ONLY",
      observations: Object.freeze(observations),
      diagnostics: Object.freeze(diagnostics),
      evidence,
      normalization,
      results,
    });
  };

  if (
    !meaningful(input.context.studentId)
    || !meaningful(input.context.programAssignmentId)
  ) {
    diagnostics.push(diagnostic(
      "INVALID_RECORDED_EXCEPTION_CONTEXT",
      input.context,
      {
        exceptions: input.exceptions,
        placements: input.placements,
        evidence: input.recordedCreditProjection.evidence,
      },
    ));
    return finish();
  }
  const recordedContext = input.recordedCreditProjection.recordedProvenance;
  if (
    recordedContext.studentIds.length !== 1
    || recordedContext.studentIds[0] !== input.context.studentId
    || recordedContext.programAssignmentIds.length !== 1
    || recordedContext.programAssignmentIds[0]
      !== input.context.programAssignmentId
  ) {
    diagnostics.push(diagnostic(
      "INVALID_RECORDED_CREDIT_PROJECTION_CONTEXT",
      input.context,
      {
        exceptions: input.exceptions,
        placements: input.placements,
        evidence: input.recordedCreditProjection.evidence,
        recordedProvenance: recordedContext,
      },
    ));
    return finish();
  }

  type Node =
    | { readonly kind: "exception"; readonly fact: RecordedAcademicExceptionFact }
    | {
      readonly kind: "placement";
      readonly fact: RecordedAcademicExceptionPlacement;
    };
  const nodes: Node[] = [
    ...input.exceptions.map((fact) => ({ kind: "exception" as const, fact })),
    ...input.placements.map((fact) => ({ kind: "placement" as const, fact })),
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
  const linkGroups = new Map<string, number[]>();
  const addLink = (key: string, index: number): void => {
    const group = linkGroups.get(key) ?? [];
    group.push(index);
    linkGroups.set(key, group);
  };
  nodes.forEach((node, index) => {
    if (node.kind === "exception") {
      addLink(`exception:${node.fact.id}`, index);
      if (node.fact.supersedesExceptionId !== null) {
        addLink(`exception:${node.fact.supersedesExceptionId}`, index);
      }
      if (
        node.fact.status !== "revoked"
        && node.fact.status !== "superseded"
      ) {
        for (const [kind, value] of [
          ["requirement", node.fact.requirementId],
          ["rule", node.fact.academicRuleId],
          ["record", node.fact.creditRecordId],
        ] as const) {
          if (meaningful(value)) {
            addLink(`active-target:${kind}:${value}`, index);
          }
        }
      }
    } else {
      addLink(`exception:${node.fact.exceptionId}`, index);
      if (meaningful(node.fact.evidenceId)) {
        addLink(`evidence:${node.fact.evidenceId}`, index);
      }
      const matchingPotentiallyActive = input.exceptions.some((item) => (
        item.id === node.fact.exceptionId
        && item.status !== "revoked"
        && item.status !== "superseded"
      ));
      if (matchingPotentiallyActive) {
        for (const [kind, value] of [
          ["requirement", node.fact.requirementId],
          ["rule", node.fact.academicRuleId],
          ["record", node.fact.creditRecordId],
        ] as const) {
          if (meaningful(value)) {
            addLink(`active-target:${kind}:${value}`, index);
          }
        }
      }
    }
  });
  for (const group of linkGroups.values()) {
    for (let index = 1; index < group.length; index += 1) {
      union(group[0], group[index]);
    }
  }

  const componentNodes = new Map<number, Node[]>();
  nodes.forEach((node, index) => {
    const root = find(index);
    const component = componentNodes.get(root) ?? [];
    component.push(node);
    componentNodes.set(root, component);
  });
  const evidenceById = new Map<string, ProjectedRecordedCreditEvidence[]>();
  for (const item of input.recordedCreditProjection.evidence) {
    const group = evidenceById.get(item.evidenceId) ?? [];
    group.push(item);
    evidenceById.set(item.evidenceId, group);
  }
  const components: ExceptionComponentParts[] = [
    ...componentNodes.values(),
  ].map((component) => {
    const exceptions = component
      .filter((node) => node.kind === "exception")
      .map((node) => node.fact);
    const placements = component
      .filter((node) => node.kind === "placement")
      .map((node) => node.fact);
    const evidence = sortedUnique(
      placements.map((item) => item.evidenceId),
    ).flatMap((id) => evidenceById.get(id) ?? []);
    return { exceptions, placements, evidence };
  }).sort((left, right) => compareStrings(
    JSON.stringify(provenance(input.context, left)),
    JSON.stringify(provenance(input.context, right)),
  ));

  const allExceptionIds = new Set(input.exceptions.map((item) => item.id));
  for (const parts of components) {
    const { exceptions, placements } = parts;
    const invalidIdentity = (
      exceptions.some((item) => (
        !meaningful(item.id)
        || !meaningful(item.studentId)
        || !meaningful(item.programAssignmentId)
        || !meaningful(item.rationale)
        || (
          item.requirementId !== null && !meaningful(item.requirementId)
        )
        || (
          item.academicRuleId !== null && !meaningful(item.academicRuleId)
        )
        || (
          item.creditRecordId !== null && !meaningful(item.creditRecordId)
        )
        || (
          item.supersedesExceptionId !== null
          && !meaningful(item.supersedesExceptionId)
        )
        || (item.approvedBy !== null && !meaningful(item.approvedBy))
      ))
      || placements.some((item) => (
        !meaningful(item.exceptionId)
        || (
          item.requirementId !== null && !meaningful(item.requirementId)
        )
        || (
          item.academicRuleId !== null && !meaningful(item.academicRuleId)
        )
        || (
          item.creditRecordId !== null && !meaningful(item.creditRecordId)
        )
        || (item.evidenceId !== null && !meaningful(item.evidenceId))
      ))
    );
    if (invalidIdentity) {
      diagnostics.push(diagnostic(
        "INVALID_RECORDED_EXCEPTION_IDENTITY",
        input.context,
        parts,
      ));
      continue;
    }
    let metadataValid = true;
    try {
      exceptions.forEach((item) => cloneOpaqueJson(item.metadata));
    } catch {
      metadataValid = false;
    }
    if (
      !metadataValid
      || exceptions.some((item) => (
        !EXCEPTION_TYPES.has(item.exceptionType)
        || !EXCEPTION_STATUSES.has(item.status)
        || !validDate(item.createdAt)
        || (item.effectiveFrom !== null && !validDate(item.effectiveFrom))
        || (item.effectiveTo !== null && !validDate(item.effectiveTo))
        || (
          item.effectiveFrom !== null
          && item.effectiveTo !== null
          && item.effectiveTo.getTime() < item.effectiveFrom.getTime()
        )
      ))
    ) {
      diagnostics.push(diagnostic(
        "INVALID_RECORDED_EXCEPTION_FACT",
        input.context,
        parts,
      ));
      continue;
    }
    const duplicateIds = [
      ...new Map(
        exceptions.map((item) => [
          item.id,
          exceptions.filter((candidate) => candidate.id === item.id),
        ]),
      ).values(),
    ].some((group) => group.length > 1);
    if (duplicateIds) {
      diagnostics.push(diagnostic(
        "AMBIGUOUS_RECORDED_EXCEPTION_IDENTITY",
        input.context,
        parts,
      ));
      continue;
    }
    if (exceptions.length === 0) {
      diagnostics.push(diagnostic(
        "MISSING_RECORDED_EXCEPTION",
        input.context,
        parts,
      ));
      continue;
    }
    const selfSupersession = exceptions.some((item) => (
      item.supersedesExceptionId === item.id
    ));
    if (selfSupersession || hasCycle(exceptions)) {
      diagnostics.push(diagnostic(
        "INVALID_RECORDED_EXCEPTION_SUPERSESSION",
        input.context,
        parts,
      ));
      continue;
    }
    const missingSupersession = exceptions.some((item) => (
      item.supersedesExceptionId !== null
      && !allExceptionIds.has(item.supersedesExceptionId)
    ));
    if (missingSupersession) {
      diagnostics.push(diagnostic(
        "MISSING_RECORDED_EXCEPTION_SUPERSESSION",
        input.context,
        parts,
      ));
      continue;
    }
    const childrenByParent = new Map<string, number>();
    for (const item of exceptions) {
      if (item.supersedesExceptionId !== null) {
        childrenByParent.set(
          item.supersedesExceptionId,
          (childrenByParent.get(item.supersedesExceptionId) ?? 0) + 1,
        );
      }
    }
    if ([...childrenByParent.values()].some((count) => count > 1)) {
      diagnostics.push(diagnostic(
        "AMBIGUOUS_RECORDED_EXCEPTION_SUPERSESSION",
        input.context,
        parts,
      ));
      continue;
    }
    const placementsByException = new Map<string, number>();
    for (const item of placements) {
      placementsByException.set(
        item.exceptionId,
        (placementsByException.get(item.exceptionId) ?? 0) + 1,
      );
    }
    if ([...placementsByException.values()].some((count) => count > 1)) {
      diagnostics.push(diagnostic(
        "AMBIGUOUS_RECORDED_EXCEPTION_PLACEMENT",
        input.context,
        parts,
      ));
      continue;
    }
    const evidenceAssociations = new Map<string, number>();
    for (const item of placements) {
      if (item.evidenceId !== null) {
        evidenceAssociations.set(
          item.evidenceId,
          (evidenceAssociations.get(item.evidenceId) ?? 0) + 1,
        );
      }
    }
    if ([...evidenceAssociations.values()].some((count) => count > 1)) {
      diagnostics.push(diagnostic(
        "AMBIGUOUS_RECORDED_EXCEPTION_EVIDENCE_ASSOCIATION",
        input.context,
        parts,
      ));
      continue;
    }
    const activeExceptions = exceptions.filter((item) => (
      item.status === "active"
    ));
    const activeTargetCounts = new Map<string, number>();
    for (const item of activeExceptions) {
      const placement = placements.find((candidate) => (
        candidate.exceptionId === item.id
      ));
      for (const [kind, value] of [
        ["requirement", placement?.requirementId ?? item.requirementId],
        ["rule", placement?.academicRuleId ?? item.academicRuleId],
        ["record", placement?.creditRecordId ?? item.creditRecordId],
      ] as const) {
        if (value !== null && value !== undefined) {
          const key = `${kind}:${value}`;
          activeTargetCounts.set(key, (activeTargetCounts.get(key) ?? 0) + 1);
        }
      }
    }
    if ([...activeTargetCounts.values()].some((count) => count > 1)) {
      diagnostics.push(diagnostic(
        "AMBIGUOUS_RECORDED_EXCEPTION_TARGET",
        input.context,
        parts,
      ));
      continue;
    }
    const members = [...exceptions].sort((left, right) => (
      compareStrings(left.id, right.id)
    )).map((exception) => {
      const matchingPlacements = placements.filter((item) => (
        item.exceptionId === exception.id
      ));
      const placement = matchingPlacements[0];
      const requirementMatches = exception.requirementId === null
        ? []
        : input.requirements.filter((item) => (
          item.requirementId === exception.requirementId
        ));
      const ruleMatches = exception.academicRuleId === null
        ? []
        : input.academicRules.filter((item) => (
          item.id === exception.academicRuleId
        ));
      const recordMatches = exception.creditRecordId === null
        ? []
        : input.creditRecords.filter((item) => (
          item.id === exception.creditRecordId
        ));
      const evidenceMatches = placement?.evidenceId === null
        || placement?.evidenceId === undefined
        ? []
        : evidenceById.get(placement.evidenceId) ?? [];
      return {
        exception,
        placement,
        requirementMatches,
        ruleMatches,
        recordMatches,
        evidenceMatches,
      };
    });

    let memberFailure: string | null = null;
    if (members.some((item) => item.placement === undefined)) {
      memberFailure = "MISSING_RECORDED_EXCEPTION_PLACEMENT";
    } else if (members.some(({ exception, placement }) => (
      placement !== undefined
      && (
        exception.requirementId !== placement.requirementId
        || exception.academicRuleId !== placement.academicRuleId
        || exception.creditRecordId !== placement.creditRecordId
      )
    ))) {
      memberFailure = "RECORDED_EXCEPTION_TARGET_MISMATCH";
    } else if (members.some(({ exception }) => (
      exception.exceptionType !== "other"
      && exception.requirementId === null
      && exception.academicRuleId === null
      && exception.creditRecordId === null
    ))) {
      memberFailure = "MISSING_RECORDED_EXCEPTION_TARGET";
    } else if (members.some((item) => (
      item.requirementMatches.length > 1
      || item.ruleMatches.length > 1
      || item.recordMatches.length > 1
    ))) {
      memberFailure = "AMBIGUOUS_RECORDED_EXCEPTION_TARGET";
    } else if (members.some(({ exception, requirementMatches, ruleMatches, recordMatches }) => (
      (exception.requirementId !== null && requirementMatches.length === 0)
      || (exception.academicRuleId !== null && ruleMatches.length === 0)
      || (exception.creditRecordId !== null && recordMatches.length === 0)
    ))) {
      memberFailure = "MISSING_RECORDED_EXCEPTION_TARGET";
    } else if (members.some(({ exception, requirementMatches }) => (
      requirementMatches.length === 1
      && exception.academicRuleId !== requirementMatches[0].academicRuleId
    ))) {
      memberFailure = "RECORDED_EXCEPTION_TARGET_MISMATCH";
    } else if (members.some(({ exception, recordMatches }) => (
      exception.studentId !== input.context.studentId
      || recordMatches.some((item) => (
        item.studentId !== input.context.studentId
      ))
    ))) {
      memberFailure = "RECORDED_EXCEPTION_STUDENT_MISMATCH";
    } else if (members.some(({ exception }) => (
      exception.programAssignmentId !== input.context.programAssignmentId
    ))) {
      memberFailure = "RECORDED_EXCEPTION_PROGRAM_MISMATCH";
    } else if (members.some(({ placement, evidenceMatches }) => (
      placement?.evidenceId !== null
      && placement?.evidenceId !== undefined
      && evidenceMatches.length > 1
    ))) {
      memberFailure = "AMBIGUOUS_RECORDED_EXCEPTION_EVIDENCE_ASSOCIATION";
    } else if (members.some(({ placement, evidenceMatches }) => (
      placement?.evidenceId !== null
      && placement?.evidenceId !== undefined
      && evidenceMatches.length === 0
    ))) {
      memberFailure = "MISSING_RECORDED_EXCEPTION_EVIDENCE";
    } else if (members.some(({ exception, evidenceMatches }) => {
      const evidence = evidenceMatches[0];
      return evidence !== undefined && (
        evidence.requirementId !== exception.requirementId
        || evidence.academicRuleId !== exception.academicRuleId
        || evidence.studentCreditRecordId !== exception.creditRecordId
        || evidence.recordedProvenance.studentIds.length !== 1
        || evidence.recordedProvenance.studentIds[0] !== input.context.studentId
        || evidence.recordedProvenance.programAssignmentIds.length !== 1
        || evidence.recordedProvenance.programAssignmentIds[0]
          !== input.context.programAssignmentId
      );
    })) {
      memberFailure = "RECORDED_EXCEPTION_EVIDENCE_MISMATCH";
    }
    if (memberFailure !== null) {
      diagnostics.push(diagnostic(memberFailure, input.context, parts));
      continue;
    }
    if (exceptions.length > 1) {
      diagnostics.push(diagnostic(
        "RECORDED_EXCEPTION_SUPERSESSION_REQUIRES_REVIEW",
        input.context,
        parts,
      ));
      continue;
    }

    const member = members[0];
    const exception = member.exception;
    const placement = member.placement!;
    const evidence = member.evidenceMatches[0];
    if (exception.status === "revoked") {
      diagnostics.push(diagnostic(
        "RECORDED_EXCEPTION_REVOKED",
        input.context,
        parts,
      ));
      continue;
    }
    if (exception.status === "superseded") {
      diagnostics.push(diagnostic(
        "RECORDED_EXCEPTION_SUPERSEDED",
        input.context,
        parts,
      ));
      continue;
    }

    if (evidence !== undefined) {
      const ids = associatedExceptionIds.get(evidence.evidenceId) ?? [];
      ids.push(exception.id);
      associatedExceptionIds.set(evidence.evidenceId, ids);
    }
    observations.push(Object.freeze({
      projectionKind: "INFORMATIONAL_ONLY",
      status: "MANUAL_REVIEW",
      reason: "RECORDED_EXCEPTION_EFFECT_UNDEFINED",
      exceptionId: exception.id,
      exceptionType: exception.exceptionType,
      exceptionStatus: "active",
      rationale: exception.rationale,
      effectiveFrom: exception.effectiveFrom?.toISOString() ?? null,
      effectiveTo: exception.effectiveTo?.toISOString() ?? null,
      createdAt: exception.createdAt.toISOString(),
      metadata: cloneOpaqueJson(exception.metadata),
      provenance: provenance(input.context, parts),
    }));
  }

  return finish();
}