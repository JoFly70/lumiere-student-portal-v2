/**
 * Phase 4C: a bounded, read-only assembler for the canonical degree
 * evaluation fact snapshot.  This module is deliberately pure.  In
 * particular, it does not evaluate requirements, choose a latest event, or
 * derive an academic result.
 */

import type {
  DegreeProgressCompositionInput,
  ProgramAssignmentRegistryEntry,
  ProgramBoundAcademicRuleTarget,
  ProgramBoundRequirementSnapshotInput,
} from "./degree-progress-composition";
import type {
  RecordedAcademicExceptionFact,
  RecordedAcademicExceptionPlacement,
} from "./recorded-academic-exception-projection";
import type {
  RecordedCreditDecisionFact,
  RecordedCreditRecordFact,
  RecordedCreditVerificationFact,
  RecordedDecisionRequirementAssociation,
} from "./recorded-credit-projection";
import {
  createInformationalAcademicSnapshot,
  type InformationalAcademicSnapshotOutput,
} from "./informational-academic-snapshot";

export const DEGREE_EVALUATION_SNAPSHOT_CONTRACT_VERSION = "4C.1";
export const DEGREE_EVALUATION_SNAPSHOT_SCHEMA_VERSION = "4C.canonical-read-only.1";

export interface DegreeEvaluationSnapshotContext {
  readonly studentId: string;
  readonly programAssignmentId: string;
  readonly programVersionId: string;
}

export interface DegreeEvaluationAssignmentRow extends ProgramAssignmentRegistryEntry {
  readonly metadata?: unknown;
}

export interface DegreeEvaluationProgramVersionRow {
  readonly id: string;
  readonly programId?: string | null;
  readonly status?: string | null;
  readonly metadata?: unknown;
}

export interface DegreeEvaluationRequirementRow {
  readonly id?: string;
  readonly requirementId?: string;
  readonly programVersionId: string;
  readonly active: boolean;
  readonly kind?: string;
  readonly unit?: string;
  readonly creditsRequired: number | string | null;
  readonly metadata?: unknown;
}

export interface DegreeEvaluationRequirementProvenanceRow {
  readonly id?: string;
  readonly requirementId: string;
  readonly claimId: string;
  readonly claimVersionId: string;
  readonly sourceId: string;
  readonly evidenceExcerptId?: string;
}

export interface DegreeEvaluationClaimRow {
  readonly id: string;
  readonly claimKey?: string;
  readonly claimType?: string;
  readonly subjectType: string;
  readonly subjectId: string | null;
  readonly currentVersionId: string | null;
  readonly status: string;
  readonly createdAt?: Date | string | null;
  readonly createdBy?: string | null;
  readonly metadata?: unknown;
}

export interface DegreeEvaluationClaimVersionRow {
  readonly id: string;
  readonly claimId: string;
  readonly versionNumber?: number;
  readonly statement?: string;
  readonly status: string;
  readonly normalizedValue?: unknown;
  readonly confidence?: number;
  readonly effectiveFrom?: Date | string | null;
  readonly effectiveTo?: Date | string | null;
  readonly catalogApplicability?: string | null;
  readonly cohortApplicability?: string | null;
  readonly supersedesVersionId?: string | null;
  readonly createdAt?: Date | string | null;
  readonly createdBy?: string | null;
}

export interface DegreeEvaluationClaimEvidenceRow {
  readonly claimVersionId: string;
  readonly evidenceExcerptId: string;
  readonly relationshipType?: string;
  readonly notes?: string | null;
  readonly createdAt?: Date | string | null;
}

export interface DegreeEvaluationEvidenceExcerptRow {
  readonly id: string;
  readonly evidenceSourceId: string;
  readonly excerptText?: string | null;
  readonly locator?: string | null;
  readonly pageNumber?: number | null;
  readonly section?: string | null;
  readonly metadata?: unknown;
  readonly createdAt?: Date | string | null;
}

export interface DegreeEvaluationEvidenceSourceRow {
  readonly id: string;
  readonly sourceType?: string;
  readonly institutionId?: string | null;
  readonly providerId?: string | null;
  readonly title?: string | null;
  readonly sourceUrl?: string | null;
  readonly externalFileId?: string | null;
  readonly contentHash?: string | null;
  readonly authorityLevel?: string;
  readonly publishedAt?: Date | string | null;
  readonly retrievedAt?: Date | string | null;
  readonly effectiveFrom?: Date | string | null;
  readonly effectiveTo?: Date | string | null;
  readonly metadata?: unknown;
  readonly createdAt?: Date | string | null;
  readonly createdBy?: string | null;
}

export interface DegreeEvaluationAcademicRuleRow {
  readonly id: string;
  readonly programVersionId: string | null;
  readonly claimVersionId?: string | null;
  readonly status?: string | null;
  readonly metadata?: unknown;
}

export interface DegreeEvaluationConflictRow {
  readonly id: string;
  readonly claimVersionAId?: string | null;
  readonly claimVersionBId?: string | null;
  readonly conflictType?: string;
  readonly description?: string;
  readonly status: string;
  readonly resolutionNotes?: string | null;
  readonly resolvedBy?: string | null;
  readonly resolvedAt?: Date | string | null;
  readonly createdAt?: Date | string | null;
  readonly requirementId: string | null;
  readonly academicRuleId: string | null;
  readonly sourceIds?: readonly string[];
  readonly claimVersionIds?: readonly string[];
  readonly metadata?: unknown;
}

export interface DegreeEvaluationConflictProvenanceRow {
  readonly id?: string;
  readonly conflictId: string;
  readonly side: "A" | "B";
  readonly claimVersionId: string;
  readonly sourceId: string;
  readonly evidenceExcerptId?: string;
}

export interface DegreeEvaluationAcademicSourceRow {
  readonly id: string;
  readonly studentId: string;
  readonly metadata?: unknown;
}

export interface DegreeEvaluationCreditRecordRow extends RecordedCreditRecordFact {
  readonly metadata?: unknown;
}

export interface DegreeEvaluationVerificationEventRow
  extends RecordedCreditVerificationFact {
  readonly metadata?: unknown;
}

export interface DegreeEvaluationDecisionRow extends RecordedCreditDecisionFact {
  readonly metadata?: unknown;
}

export interface DegreeEvaluationPlacementRow {
  readonly id: string;
  readonly studentCreditDecisionId: string;
  readonly programAssignmentId: string;
  readonly requirementId: string;
  readonly academicRuleId: string | null;
  readonly status: "active" | "revoked" | "superseded" | string;
  readonly studentId?: string | null;
  readonly programVersionId?: string | null;
  readonly metadata?: unknown;
}

export interface DegreeEvaluationExceptionRow extends RecordedAcademicExceptionFact {
  readonly programVersionId?: string | null;
}

export interface DegreeEvaluationRawBundle {
  readonly assignments: readonly DegreeEvaluationAssignmentRow[];
  readonly programVersions?: readonly DegreeEvaluationProgramVersionRow[];
  readonly requirements: readonly DegreeEvaluationRequirementRow[];
  readonly requirementProvenance: readonly DegreeEvaluationRequirementProvenanceRow[];
  readonly claims: readonly DegreeEvaluationClaimRow[];
  readonly claimVersions: readonly DegreeEvaluationClaimVersionRow[];
  readonly claimEvidence?: readonly DegreeEvaluationClaimEvidenceRow[];
  readonly evidenceExcerpts?: readonly DegreeEvaluationEvidenceExcerptRow[];
  readonly evidenceSources: readonly DegreeEvaluationEvidenceSourceRow[];
  readonly academicRules: readonly DegreeEvaluationAcademicRuleRow[];
  readonly conflicts: readonly DegreeEvaluationConflictRow[];
  readonly conflictProvenance?: readonly DegreeEvaluationConflictProvenanceRow[];
  readonly academicSources?: readonly DegreeEvaluationAcademicSourceRow[];
  readonly creditRecords: readonly DegreeEvaluationCreditRecordRow[];
  readonly verificationEvents: readonly DegreeEvaluationVerificationEventRow[];
  readonly decisions: readonly DegreeEvaluationDecisionRow[];
  readonly placements: readonly DegreeEvaluationPlacementRow[];
  readonly exceptions: readonly DegreeEvaluationExceptionRow[];
  /**
   * Reserved for an explicitly persisted exception-target projection.  The
   * current schema has no such table; exception targets are therefore copied
   * from the exception row and get a null evidence id.
   */
  readonly exceptionPlacements?: readonly RecordedAcademicExceptionPlacement[];
}

export interface DegreeEvaluationSnapshotInput {
  readonly context: DegreeEvaluationSnapshotContext;
  readonly asOf: string;
  readonly facts?: DegreeEvaluationRawBundle;
  readonly bundle?: DegreeEvaluationRawBundle;
  readonly rawBundle?: DegreeEvaluationRawBundle;
}

export interface DegreeEvaluationSnapshotOccurrence {
  readonly occurrenceKind: string;
  readonly occurrenceId: string;
  readonly value: unknown;
}

export interface DegreeEvaluationSnapshotDiagnostic {
  readonly status: "MANUAL_REVIEW";
  readonly reason: string;
  readonly ids: readonly string[];
  readonly occurrences: readonly DegreeEvaluationSnapshotOccurrence[];
}

export interface DegreeEvaluationSnapshotAccepted {
  readonly status: "ACCEPTED";
  readonly context: DegreeEvaluationSnapshotContext;
  readonly asOf: string;
  readonly contractVersion: string;
  readonly schemaVersion: string;
  readonly compositionInput: DegreeProgressCompositionInput;
  readonly academicSnapshot: InformationalAcademicSnapshotOutput;
  readonly occurrences: readonly DegreeEvaluationSnapshotOccurrence[];
}

export interface DegreeEvaluationSnapshotManualReview {
  readonly status: "MANUAL_REVIEW";
  readonly context: DegreeEvaluationSnapshotContext;
  readonly asOf: string;
  readonly contractVersion: string;
  readonly schemaVersion: string;
  readonly diagnostics: readonly DegreeEvaluationSnapshotDiagnostic[];
  readonly occurrences: readonly DegreeEvaluationSnapshotOccurrence[];
}

export type DegreeEvaluationSnapshotOutput =
  | DegreeEvaluationSnapshotAccepted
  | DegreeEvaluationSnapshotManualReview;

const EMPTY_FACTS: DegreeEvaluationRawBundle = {
  assignments: [],
  requirements: [],
  requirementProvenance: [],
  claims: [],
  claimVersions: [],
  evidenceSources: [],
  academicRules: [],
  conflicts: [],
  creditRecords: [],
  verificationEvents: [],
  decisions: [],
  placements: [],
  exceptions: [],
};

function meaningful(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stable(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item) => (
      item instanceof Date ? item.toISOString() : item
    )) ?? "";
  } catch {
    return String(value);
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (
    value === null
    || (typeof value !== "object" && typeof value !== "function")
    || seen.has(value as object)
  ) return value;
  seen.add(value as object);
  for (const key of Reflect.ownKeys(value as object)) {
    const descriptor = Object.getOwnPropertyDescriptor(value as object, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function deepClone<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value === null || typeof value !== "object") return value;
  const objectValue = value as object;
  const prior = seen.get(objectValue);
  if (prior !== undefined) return prior as T;
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    seen.set(objectValue, result);
    for (const item of value) result.push(deepClone(item, seen));
    return result as T;
  }
  const result: Record<string, unknown> = {};
  seen.set(objectValue, result);
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = deepClone(item, seen);
  }
  return result as T;
}

function unique(values: readonly (string | null | undefined)[]): readonly string[] {
  return Object.freeze(
    [...new Set(values.filter(meaningful))].sort(compare),
  );
}

function sortedRows<T>(rows: readonly T[]): readonly T[] {
  return [...rows].sort((left, right) => compare(stable(left), stable(right)));
}

function idsOf(value: unknown): readonly string[] {
  if (!value || typeof value !== "object") return Object.freeze([]);
  const ids: string[] = [];
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "id" && meaningful(item)) ids.push(item);
    else if (key.endsWith("Id") && meaningful(item)) ids.push(item);
  }
  return unique(ids);
}

function duplicateReasons<T>(
  rows: readonly T[],
  getId: (row: T) => string | null | undefined,
  reason: string,
): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = getId(row);
    if (meaningful(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort(([left], [right]) => compare(left, right))
    .map(([id]) => `${reason}:${id}`);
}

function canonicalValue(value: unknown, seen = new Set<object>()): unknown {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : value;
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item, seen));
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort(compare)) {
    result[key] = canonicalValue(
      (value as Record<string, unknown>)[key],
      seen,
    );
  }
  seen.delete(value);
  return result;
}

function occurrence(
  kind: string,
  id: string,
  value: unknown,
): DegreeEvaluationSnapshotOccurrence {
  return {
    occurrenceKind: kind,
    occurrenceId: id,
    value: canonicalValue(deepClone(value)),
  };
}

function allOccurrences(facts: DegreeEvaluationRawBundle): readonly DegreeEvaluationSnapshotOccurrence[] {
  const entries: DegreeEvaluationSnapshotOccurrence[] = [];
  const add = <T>(kind: string, rows: readonly T[], getId: (row: T) => string) => {
    rows.forEach((row) => entries.push(occurrence(kind, getId(row), row)));
  };
  add("programAssignment", facts.assignments, (row) => row.id);
  add("programVersion", facts.programVersions ?? [], (row) => row.id);
  add("requirement", facts.requirements, (row) => row.requirementId ?? row.id ?? "");
  add("requirementProvenance", facts.requirementProvenance, (row) => (
    row.id ?? `${row.requirementId}:${row.claimVersionId}:${row.evidenceExcerptId ?? ""}:${row.sourceId}`
  ));
  add("claim", facts.claims, (row) => row.id);
  add("claimVersion", facts.claimVersions, (row) => row.id);
  add("claimEvidence", facts.claimEvidence ?? [], (row) => (
    `${row.claimVersionId}:${row.evidenceExcerptId}`
  ));
  add("evidenceExcerpt", facts.evidenceExcerpts ?? [], (row) => row.id);
  add("evidenceSource", facts.evidenceSources, (row) => row.id);
  add("academicRule", facts.academicRules, (row) => row.id);
  add("conflict", facts.conflicts, (row) => row.id);
  add("conflictProvenance", facts.conflictProvenance ?? [], (row) => (
    row.id ?? `${row.conflictId}:${row.side}:${row.claimVersionId}:${row.evidenceExcerptId ?? ""}:${row.sourceId}`
  ));
  add("academicSource", facts.academicSources ?? [], (row) => row.id);
  add("creditRecord", facts.creditRecords, (row) => row.id);
  add("verificationEvent", facts.verificationEvents, (row) => row.id);
  add("decision", facts.decisions, (row) => row.id);
  add("studentCreditPlacement", facts.placements, (row) => row.id);
  add("exception", facts.exceptions, (row) => row.id);
  add("exceptionPlacement", facts.exceptionPlacements ?? [], (row) => (
    `${row.exceptionId}:${row.requirementId ?? ""}:${row.academicRuleId ?? ""}:${row.creditRecordId ?? ""}`
  ));
  return Object.freeze(entries.sort((left, right) => (
    compare(left.occurrenceKind, right.occurrenceKind)
    || compare(left.occurrenceId, right.occurrenceId)
    || compare(stable(left.value), stable(right.value))
  )));
}

function diagnostic(
  reason: string,
  rows: readonly unknown[],
  occurrences: readonly DegreeEvaluationSnapshotOccurrence[],
): DegreeEvaluationSnapshotDiagnostic {
  const ids = unique(rows.flatMap((row) => idsOf(row)));
  return Object.freeze({ status: "MANUAL_REVIEW", reason, ids, occurrences });
}

function requestedContext(
  context: DegreeEvaluationSnapshotContext,
): DegreeEvaluationSnapshotContext {
  return Object.freeze({
    studentId: context.studentId,
    programAssignmentId: context.programAssignmentId,
    programVersionId: context.programVersionId,
  });
}

function numericString(value: number | string | null | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) return value;
  return null;
}

const PROJECTION_KEYS = [
  "projectionKind",
  "kind",
  "unit",
  "requiredAmount",
  "academicRuleId",
] as const;

export function canonicalRequirementProjection(
  value: unknown,
): {
  readonly projectionKind: "QUANTITATIVE_REQUIREMENT";
  readonly kind: "minimum";
  readonly unit: "credits";
  readonly requiredAmount: string;
  readonly academicRuleId: string | null;
} | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort(compare);
  if (keys.length !== PROJECTION_KEYS.length
    || PROJECTION_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(record, key))) {
    return null;
  }
  const requiredAmount = record.requiredAmount;
  const academicRuleId = record.academicRuleId;
  if (record.projectionKind !== "QUANTITATIVE_REQUIREMENT"
    || record.kind !== "minimum"
    || record.unit !== "credits"
    || typeof requiredAmount !== "string"
    || numericString(requiredAmount) !== requiredAmount
    || (academicRuleId !== null
      && (typeof academicRuleId !== "string" || !meaningful(academicRuleId)))) {
    return null;
  }
  return {
    projectionKind: "QUANTITATIVE_REQUIREMENT",
    kind: "minimum",
    unit: "credits",
    requiredAmount,
    academicRuleId,
  };
}

function makeExceptionPlacement(
  exception: DegreeEvaluationExceptionRow,
): RecordedAcademicExceptionPlacement {
  return Object.freeze({
    exceptionId: exception.id,
    requirementId: exception.requirementId,
    academicRuleId: exception.academicRuleId,
    creditRecordId: exception.creditRecordId,
    evidenceId: null,
  });
}

function makeExceptionFact(
  row: DegreeEvaluationExceptionRow,
): RecordedAcademicExceptionFact {
  return {
    id: row.id,
    studentId: row.studentId,
    programAssignmentId: row.programAssignmentId,
    exceptionType: row.exceptionType,
    status: row.status,
    requirementId: row.requirementId,
    academicRuleId: row.academicRuleId,
    creditRecordId: row.creditRecordId,
    supersedesExceptionId: row.supersedesExceptionId,
    approvedBy: row.approvedBy,
    rationale: row.rationale,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    metadata: deepClone(row.metadata),
    createdAt: row.createdAt,
  };
}

/**
 * Assemble a snapshot without evaluating the composition.  The returned
 * composition input is the Phase 3 boundary, not an evaluated report.
 */
export function assembleDegreeEvaluationSnapshot(
  input: DegreeEvaluationSnapshotInput,
): DegreeEvaluationSnapshotOutput {
  const facts = input?.facts ?? input?.bundle ?? input?.rawBundle ?? EMPTY_FACTS;
  const context = requestedContext(input?.context ?? {
    studentId: "",
    programAssignmentId: "",
    programVersionId: "",
  });
  const asOf = input?.asOf ?? "";
  const occurrences = allOccurrences(facts);
  const failures: Array<{ reason: string; rows: readonly unknown[] }> = [];
  const fail = (reason: string, rows: readonly unknown[] = []) => {
    failures.push({ reason, rows });
  };

  if (!meaningful(context.studentId)
    || !meaningful(context.programAssignmentId)
    || !meaningful(context.programVersionId)) fail("INVALID_CONTEXT_IDENTITY", [context]);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(asOf ?? "")) {
    fail("INVALID_AS_OF", [asOf]);
  }

  const assignmentActive = facts.assignments.filter((row) => row.status === "active");
  if (assignmentActive.length !== 1) {
    fail(assignmentActive.length === 0
      ? "MISSING_ACTIVE_ASSIGNMENT"
      : "AMBIGUOUS_ACTIVE_ASSIGNMENT", assignmentActive);
  }
  const assignment = assignmentActive[0];
  if (assignment && assignment.id !== context.programAssignmentId) {
    fail("REQUESTED_ASSIGNMENT_MISMATCH", [assignment]);
  }
  if (assignmentActive.some((row) => (
    row.studentId !== context.studentId
    || row.programVersionId !== context.programVersionId
  ))) fail("ASSIGNMENT_CONTEXT_MISMATCH", facts.assignments);
  if (assignment && (
    assignment.studentId !== context.studentId
    || assignment.programVersionId !== context.programVersionId
  )) fail("ACTIVE_ASSIGNMENT_CONTEXT_MISMATCH", [assignment]);
  if (duplicateReasons(facts.assignments, (row) => row.id, "DUPLICATE_ASSIGNMENT").length) {
    fail("DUPLICATE_ASSIGNMENT_IDENTITY", facts.assignments);
  }
  if (duplicateReasons(facts.programVersions ?? [], (row) => row.id, "DUPLICATE_PROGRAM_VERSION").length) {
    fail("DUPLICATE_PROGRAM_VERSION_IDENTITY", facts.programVersions ?? []);
  }
  const programVersionRows = facts.programVersions ?? [];
  if (programVersionRows.length === 0) {
    fail("MISSING_PROGRAM_VERSION", [context.programVersionId]);
  } else if (programVersionRows.length !== 1) {
    fail("AMBIGUOUS_PROGRAM_VERSION", programVersionRows);
  } else if (programVersionRows[0].id !== context.programVersionId) {
    fail("PROGRAM_VERSION_CONTEXT_MISMATCH", programVersionRows);
  }

  const requirementId = (row: DegreeEvaluationRequirementRow) => row.requirementId ?? row.id ?? "";
  const knownRequirementIds = new Set(facts.requirements.map(requirementId));
  const ruleRefs = new Map<string, Set<string>>();
  const explicitRuleRefs = new Set<string>();
  const addRuleRef = (requirement: string | null | undefined, rule: string | null | undefined) => {
    if (!meaningful(requirement)) return;
    const refs = ruleRefs.get(requirement) ?? new Set<string>();
    if (rule !== null && rule !== undefined) refs.add(rule);
    else refs.add("<NULL>");
    ruleRefs.set(requirement, refs);
  };
  for (const row of facts.placements.filter((item) => item.status === "active")) {
    addRuleRef(row.requirementId, row.academicRuleId);
    if (meaningful(row.academicRuleId)) explicitRuleRefs.add(row.academicRuleId);
  }
  for (const row of facts.exceptions.filter((item) => item.status === "active")) {
    addRuleRef(row.requirementId, row.academicRuleId);
    if (meaningful(row.academicRuleId)) explicitRuleRefs.add(row.academicRuleId);
  }

  if (duplicateReasons(facts.requirements, requirementId, "DUPLICATE_REQUIREMENT").length) {
    fail("DUPLICATE_REQUIREMENT_IDENTITY", facts.requirements);
  }
  if (facts.requirements.some((row) => (
    !meaningful(requirementId(row))
    || !row.active
    || row.programVersionId !== context.programVersionId
    || numericString(row.creditsRequired) === null
  ))) fail("INVALID_REQUIREMENT_FACT", facts.requirements);

  const linksByRequirement = new Map<string, DegreeEvaluationRequirementProvenanceRow[]>();
  for (const link of facts.requirementProvenance) {
    const group = linksByRequirement.get(link.requirementId) ?? [];
    group.push(link);
    linksByRequirement.set(link.requirementId, group);
  }
  if (duplicateReasons(
    facts.requirementProvenance,
    (row) => `${row.requirementId}:${row.claimId}:${row.claimVersionId}:${row.evidenceExcerptId ?? ""}:${row.sourceId}`,
    "DUPLICATE_REQUIREMENT_PROVENANCE",
  ).length) fail("DUPLICATE_REQUIREMENT_PROVENANCE", facts.requirementProvenance);
  for (const link of facts.requirementProvenance) {
    if (!knownRequirementIds.has(link.requirementId)
      || !meaningful(link.claimId)
      || !meaningful(link.claimVersionId)
      || !meaningful(link.sourceId)) {
      fail("ORPHAN_REQUIREMENT_PROVENANCE", [link]);
    }
  }
  if (duplicateReasons(
    facts.conflictProvenance ?? [],
    (row) => `${row.conflictId}:${row.side}:${row.claimVersionId}:${row.evidenceExcerptId ?? ""}:${row.sourceId}`,
    "DUPLICATE_CONFLICT_PROVENANCE",
  ).length) {
    fail("DUPLICATE_CONFLICT_PROVENANCE", facts.conflictProvenance ?? []);
  }
  const claims = new Map(facts.claims.map((row) => [row.id, row]));
  const versions = new Map(facts.claimVersions.map((row) => [row.id, row]));
  const sources = new Map(facts.evidenceSources.map((row) => [row.id, row]));
  if (duplicateReasons(facts.claims, (row) => row.id, "DUPLICATE_CLAIM").length) {
    fail("DUPLICATE_CLAIM_IDENTITY", facts.claims);
  }
  if (duplicateReasons(facts.claimVersions, (row) => row.id, "DUPLICATE_CLAIM_VERSION").length) {
    fail("DUPLICATE_CLAIM_VERSION_IDENTITY", facts.claimVersions);
  }
  if (duplicateReasons(facts.evidenceSources, (row) => row.id, "DUPLICATE_SOURCE").length) {
    fail("DUPLICATE_SOURCE_IDENTITY", facts.evidenceSources);
  }
  if (duplicateReasons(facts.academicSources ?? [], (row) => row.id, "DUPLICATE_ACADEMIC_SOURCE").length) {
    fail("DUPLICATE_ACADEMIC_SOURCE_IDENTITY", facts.academicSources ?? []);
  }
  if (duplicateReasons(facts.evidenceExcerpts ?? [], (row) => row.id, "DUPLICATE_EXCERPT").length) {
    fail("DUPLICATE_EVIDENCE_EXCERPT_IDENTITY", facts.evidenceExcerpts ?? []);
  }
  if (duplicateReasons(
    facts.claimEvidence ?? [],
    (row) => `${row.claimVersionId}:${row.evidenceExcerptId}`,
    "DUPLICATE_CLAIM_EVIDENCE",
  ).length) {
    fail("DUPLICATE_CLAIM_EVIDENCE_IDENTITY", facts.claimEvidence ?? []);
  }
  const excerpts = new Map((facts.evidenceExcerpts ?? []).map((row) => [row.id, row]));
  const projectionByRequirement = new Map<string, ReturnType<typeof canonicalRequirementProjection>>();
  const currentVersionByRequirement = new Map<string, string>();
  const currentSourceIdsByRequirement = new Map<string, readonly string[]>();
  for (const link of facts.claimEvidence ?? []) {
    const version = versions.get(link.claimVersionId);
    const excerpt = excerpts.get(link.evidenceExcerptId);
    const source = excerpt ? sources.get(excerpt.evidenceSourceId) : undefined;
    if (!meaningful(link.claimVersionId)
      || !meaningful(link.evidenceExcerptId)
      || !version
      || !excerpt
      || !meaningful(excerpt.excerptText)
      || !source
      || !meaningful(source.title)) {
      fail("ORPHAN_CLAIM_EVIDENCE_LINK", [link]);
    }
  }
  for (const version of facts.claimVersions) {
    if (!claims.has(version.claimId)) fail("ORPHAN_CLAIM_VERSION", [version]);
  }
  const relevantClaimIds = new Set([
    ...facts.claims
      .filter((claim) => claim.subjectType === "requirement"
        && claim.subjectId !== null
        && knownRequirementIds.has(claim.subjectId))
      .map((claim) => claim.id),
    ...facts.academicRules
      .map((rule) => rule.claimVersionId)
      .filter((id): id is string => id !== null)
      .map((id) => versions.get(id)?.claimId)
      .filter((id): id is string => id !== undefined),
  ]);
  for (const claim of facts.claims) {
    if (!relevantClaimIds.has(claim.id)) fail("ORPHAN_CLAIM", [claim]);
  }
  const referencedExcerptIds = new Set((facts.claimEvidence ?? [])
    .map((link) => link.evidenceExcerptId));
  for (const excerpt of facts.evidenceExcerpts ?? []) {
    if (!referencedExcerptIds.has(excerpt.id)) fail("ORPHAN_EVIDENCE_EXCERPT", [excerpt]);
  }
  const referencedSourceIds = new Set((facts.evidenceExcerpts ?? [])
    .map((excerpt) => excerpt.evidenceSourceId));
  for (const source of facts.evidenceSources ?? []) {
    if (!referencedSourceIds.has(source.id)) fail("ORPHAN_EVIDENCE_SOURCE", [source]);
  }
  for (const link of facts.conflictProvenance ?? []) {
    const conflict = facts.conflicts.find((row) => row.id === link.conflictId);
    const sideVersionId = link.side === "A"
      ? conflict?.claimVersionAId
      : conflict?.claimVersionBId;
    if (!conflict || !versions.has(link.claimVersionId)
      || !sources.has(link.sourceId)
      || sideVersionId !== link.claimVersionId) {
      fail("ORPHAN_CONFLICT_PROVENANCE", [link]);
    }
  }
  for (const row of facts.requirements) {
    const id = requirementId(row);
    const exactClaims = facts.claims.filter((claim) => (
      claim.claimType === "requirement"
      && claim.subjectType === "requirement"
      && claim.subjectId === id
      && claim.status === "confirmed"
    ));
    if (exactClaims.length !== 1) {
      fail("AMBIGUOUS_CURRENT_REQUIREMENT_CLAIM", [row, ...exactClaims]);
      continue;
    }
    const claim = exactClaims[0];
    const currentVersion = claim.currentVersionId === null
      ? undefined
      : versions.get(claim.currentVersionId);
    const projection = canonicalRequirementProjection(
      currentVersion?.normalizedValue,
    );
    if (!currentVersion
      || currentVersion.claimId !== claim.id
      || currentVersion.status !== "confirmed"
      || !projection
      || projection.requiredAmount !== numericString(row.creditsRequired)) {
      fail("INVALID_CANONICAL_REQUIREMENT_PROJECTION", [row, claim, currentVersion]);
      continue;
    }
    projectionByRequirement.set(id, projection);
    currentVersionByRequirement.set(id, currentVersion.id);
    addRuleRef(id, projection.academicRuleId);
    if (meaningful(projection.academicRuleId)) explicitRuleRefs.add(projection.academicRuleId);
    const currentEvidence = (facts.claimEvidence ?? []).filter((link) => (
      link.claimVersionId === currentVersion.id
    ));
    if (currentEvidence.length === 0) {
      fail("MISSING_CURRENT_REQUIREMENT_EVIDENCE", [claim, currentVersion]);
    } else if (currentEvidence.some((link) => {
      const excerpt = excerpts.get(link.evidenceExcerptId);
      const source = excerpt ? sources.get(excerpt.evidenceSourceId) : undefined;
      return !excerpt
        || !meaningful(excerpt.excerptText)
        || !source
        || !meaningful(source.title);
    })) {
      fail("INVALID_CURRENT_REQUIREMENT_EVIDENCE", currentEvidence);
    }
    currentSourceIdsByRequirement.set(id, unique(currentEvidence.map((link) => (
      excerpts.get(link.evidenceExcerptId)?.evidenceSourceId ?? null
    ))));
  }
  for (const row of facts.requirements) {
    const id = requirementId(row);
    const links = linksByRequirement.get(id) ?? [];
    if (!meaningful(id) || links.length === 0
      || links.some((link) => {
        const claim = claims.get(link.claimId);
        const version = versions.get(link.claimVersionId);
        const source = sources.get(link.sourceId);
        const exactClaim = facts.claims.find((item) => (
          item.id === link.claimId
          && item.claimType === "requirement"
          && item.subjectType === "requirement"
          && item.subjectId === id
          && item.status === "confirmed"
        ));
        return !claim
          || !exactClaim
          || !version
          || version.claimId !== claim.id
          || !source
          || !meaningful(source.title)
          || !(facts.claimEvidence ?? []).some((evidenceLink) => (
            evidenceLink.claimVersionId === version.id
            && excerpts.get(evidenceLink.evidenceExcerptId)?.evidenceSourceId === link.sourceId
            && (!link.evidenceExcerptId || evidenceLink.evidenceExcerptId === link.evidenceExcerptId)
          ));
      })) {
      fail("INVALID_REQUIREMENT_PROVENANCE", [row, ...links]);
    }
  }

  const conflictLinks = facts.conflictProvenance ?? [];
  const conflictLinkMap = new Map<string, DegreeEvaluationConflictProvenanceRow[]>();
  for (const link of conflictLinks) {
    const group = conflictLinkMap.get(link.conflictId) ?? [];
    group.push(link);
    conflictLinkMap.set(link.conflictId, group);
  }
  if (duplicateReasons(facts.conflicts, (row) => row.id, "DUPLICATE_CONFLICT").length) {
    fail("DUPLICATE_CONFLICT_IDENTITY", facts.conflicts);
  }
  const activeRuleClaimVersionIds = new Set(
    facts.academicRules
      .filter((rule) => facts.placements.some((placement) => (
        placement.status === "active"
        && placement.academicRuleId === rule.id
      )) || facts.exceptions.some((exception) => (
        exception.status === "active"
        && exception.academicRuleId === rule.id
      )))
      .map((rule) => rule.claimVersionId)
      .filter((id): id is string => meaningful(id)),
  );
  for (const row of facts.conflicts) {
    const sideIds = [row.claimVersionAId, row.claimVersionBId]
      .filter((id): id is string => meaningful(id));
    const sideMapsToRequirement = sideIds.some((id) => {
      const claim = versions.get(id) ? claims.get(versions.get(id)!.claimId) : undefined;
      return claim?.subjectType === "requirement"
        && meaningful(claim.subjectId)
        && knownRequirementIds.has(claim.subjectId);
    });
    const relevant = row.status === "open"
      && (sideMapsToRequirement
        || sideIds.some((id) => activeRuleClaimVersionIds.has(id))
        || (meaningful(row.requirementId) && knownRequirementIds.has(row.requirementId)));
    if (!relevant) continue;
    const links = conflictLinkMap.get(row.id) ?? [];
    const sideVersionIds = [row.claimVersionAId, row.claimVersionBId];
    const sideEntries = (["A", "B"] as const).map((side, index) => ({
      side,
      versionId: sideVersionIds[index],
      links: links.filter((link) => link.side === side),
    }));
    const claimVersionIds = sideEntries
      .map((entry) => entry.versionId)
      .filter((id): id is string => meaningful(id));
    const sourceIds = sideEntries.flatMap((entry) => entry.links.map((link) => link.sourceId));
    const sideComplete = sideEntries.every((entry) => (
      meaningful(entry.versionId)
      && versions.has(entry.versionId)
      && entry.links.length > 0
      && entry.links.every((link) => sources.has(link.sourceId)
        && (facts.claimEvidence ?? []).some((candidate) => (
          candidate.claimVersionId === link.claimVersionId
          && excerpts.get(candidate.evidenceExcerptId)?.evidenceSourceId === link.sourceId
          && (!link.evidenceExcerptId || candidate.evidenceExcerptId === link.evidenceExcerptId)
          && meaningful(excerpts.get(candidate.evidenceExcerptId)?.excerptText)
        )))
    ));
    if (!sideComplete || new Set(claimVersionIds).size !== 2
      || sourceIds.some((id) => !sources.has(id))
      || sideEntries.some((entry) => entry.links.some((link) => (
        link.claimVersionId !== entry.versionId
      )))) {
      fail("INVALID_CONFLICT_FACT", [row, ...links]);
    }
    const requirementCandidates = new Set<string>();
    for (const entry of sideEntries) {
      const version = meaningful(entry.versionId) ? versions.get(entry.versionId) : undefined;
      const claim = version ? claims.get(version.claimId) : undefined;
      if (claim?.claimType === "requirement"
        && claim.subjectType === "requirement"
        && meaningful(claim.subjectId)
        && knownRequirementIds.has(claim.subjectId)) {
        requirementCandidates.add(claim.subjectId);
      }
      if (!(claim?.claimType === "requirement" && claim.subjectType === "requirement")) {
        for (const rule of facts.academicRules.filter((candidate) => (
          candidate.claimVersionId === entry.versionId
        ))) {
          for (const [requirementId, projection] of projectionByRequirement) {
            if (projection?.academicRuleId === rule.id) requirementCandidates.add(requirementId);
          }
          for (const placement of facts.placements) {
            const placementRequirementId = placement.requirementId;
            if (placement.status === "active"
              && placement.academicRuleId === rule.id
              && meaningful(placementRequirementId)) {
              requirementCandidates.add(placementRequirementId);
            }
          }
          for (const exception of facts.exceptions) {
            const exceptionRequirementId = exception.requirementId;
            if (exception.status === "active"
              && exception.academicRuleId === rule.id
              && meaningful(exceptionRequirementId)) {
              requirementCandidates.add(exceptionRequirementId);
            }
          }
        }
      }
    }
    if (requirementCandidates.size !== 1
      || row.requirementId !== [...requirementCandidates][0]) {
      fail("AMBIGUOUS_CONFLICT_REQUIREMENT_MAPPING", [row, ...links]);
    }
    if (meaningful(row.academicRuleId)) {
      addRuleRef(row.requirementId, row.academicRuleId);
      explicitRuleRefs.add(row.academicRuleId);
    } else {
      addRuleRef(row.requirementId, null);
    }
  }

  const allRuleRefs = new Set<string>(explicitRuleRefs);
  for (const refs of ruleRefs.values()) {
    for (const ref of refs) {
      if (ref !== "<NULL>") allRuleRefs.add(ref);
    }
  }
  const ruleIdentityCounts = new Map<string, number>();
  for (const rule of facts.academicRules) {
    if (allRuleRefs.has(rule.id)) {
      ruleIdentityCounts.set(rule.id, (ruleIdentityCounts.get(rule.id) ?? 0) + 1);
    }
  }
  if ([...ruleIdentityCounts.values()].some((count) => count > 1)) {
    fail("DUPLICATE_RULE_IDENTITY", facts.academicRules.filter((row) => (
      allRuleRefs.has(row.id)
    )));
  }
  const ruleMap = new Map(facts.academicRules.map((row) => [row.id, row]));
  for (const id of allRuleRefs) {
    const row = ruleMap.get(id);
    if (!row) fail("MISSING_REFERENCED_RULE", [id]);
    else if (!meaningful(row.programVersionId)
      || row.programVersionId !== context.programVersionId) {
      fail("REFERENCED_RULE_PROGRAM_VERSION_MISMATCH", [row]);
    }
  }
  for (const [id, refs] of ruleRefs) {
    if (refs.size > 1) {
      fail("AMBIGUOUS_REQUIREMENT_RULE_REFERENCE", [
        id,
        ...[...refs].sort(compare),
      ]);
    }
  }

  if (duplicateReasons(facts.creditRecords, (row) => row.id, "DUPLICATE_CREDIT_RECORD").length) {
    fail("DUPLICATE_CREDIT_RECORD_IDENTITY", facts.creditRecords);
  }
  if (duplicateReasons(facts.verificationEvents, (row) => row.id, "DUPLICATE_VERIFICATION").length) {
    fail("DUPLICATE_VERIFICATION_IDENTITY", facts.verificationEvents);
  }
  if (new Set(facts.verificationEvents.map((row) => `${row.creditRecordId}:${row.seq}`)).size
    !== facts.verificationEvents.length) {
    fail("DUPLICATE_VERIFICATION_SEQUENCE", facts.verificationEvents);
  }
  if (duplicateReasons(facts.decisions, (row) => row.id, "DUPLICATE_DECISION").length) {
    fail("DUPLICATE_DECISION_IDENTITY", facts.decisions);
  }
  if (new Set(facts.decisions.map((row) => `${row.creditRecordId}:${row.programAssignmentId}:${row.seq}`)).size
    !== facts.decisions.length) {
    fail("DUPLICATE_DECISION_SEQUENCE", facts.decisions);
  }
  if (duplicateReasons(facts.placements, (row) => row.id, "DUPLICATE_PLACEMENT").length) {
    fail("DUPLICATE_PLACEMENT_IDENTITY", facts.placements);
  }
  if (duplicateReasons(facts.exceptions, (row) => row.id, "DUPLICATE_EXCEPTION").length) {
    fail("DUPLICATE_EXCEPTION_IDENTITY", facts.exceptions);
  }
  const creditMap = new Map(facts.creditRecords.map((row) => [row.id, row]));
  const decisionMap = new Map(facts.decisions.map((row) => [row.id, row]));
  const requirementMap = new Map(facts.requirements.map((row) => [requirementId(row), row]));
  const placementExact = new Map<string, number>();
  for (const row of facts.placements) {
    const key = `${row.studentCreditDecisionId}:${row.programAssignmentId}:${row.requirementId}:${row.academicRuleId ?? ""}`;
    placementExact.set(key, (placementExact.get(key) ?? 0) + (row.status === "active" ? 1 : 0));
    if (!["active", "revoked", "superseded"].includes(row.status)
      || !meaningful(row.studentCreditDecisionId)
      || !meaningful(row.programAssignmentId)
      || !meaningful(row.requirementId)
      || (row.academicRuleId !== null && !meaningful(row.academicRuleId))
      || !decisionMap.has(row.studentCreditDecisionId)
      || !requirementMap.has(row.requirementId)
      || (row.academicRuleId !== null && !ruleMap.has(row.academicRuleId))
      || row.programAssignmentId !== context.programAssignmentId
      || (row.studentId !== undefined && row.studentId !== context.studentId)
      || (row.programVersionId !== undefined && row.programVersionId !== context.programVersionId)) {
      fail("INVALID_PLACEMENT_BINDING", [row]);
    }
  }
  if ([...placementExact.values()].some((count) => count > 1)) {
    fail("DUPLICATE_ACTIVE_PLACEMENT", facts.placements);
  }
  const recordsWithVerification = new Set<string>();
  for (const event of facts.verificationEvents) {
    if (!creditMap.has(event.creditRecordId)) fail("VERIFICATION_MISSING_RECORD", [event]);
    else recordsWithVerification.add(event.creditRecordId);
  }
  if (facts.creditRecords.some((row) => !recordsWithVerification.has(row.id))) {
    fail("VERIFICATION_MISSING_EVENT", facts.creditRecords);
  }
  for (const row of facts.decisions) {
    if (!creditMap.has(row.creditRecordId)) fail("DECISION_MISSING_RECORD", [row]);
    if (row.programAssignmentId !== context.programAssignmentId) {
      fail("DECISION_CROSS_ASSIGNMENT", [row]);
    }
    const record = creditMap.get(row.creditRecordId);
    if (record && record.studentId !== context.studentId) {
      fail("DECISION_CROSS_STUDENT", [row, record]);
    }
  }
  if (facts.academicSources?.some((row) => (
    row.studentId !== context.studentId
    || facts.creditRecords.some((credit) => credit.sourceId === row.id
      && credit.studentId !== row.studentId)
  ))) fail("CREDIT_SOURCE_STUDENT_MISMATCH", facts.academicSources);
  if (facts.academicSources && facts.creditRecords.some((credit) => {
    const source = facts.academicSources!.find((item) => item.id === credit.sourceId);
    return !source || source.studentId !== credit.studentId;
  })) fail("CREDIT_SOURCE_REFERENCE_MISMATCH", facts.creditRecords);
  if (facts.creditRecords.some((row) => row.studentId !== context.studentId)) {
    fail("CREDIT_STUDENT_MISMATCH", facts.creditRecords);
  }

  for (const row of facts.exceptions) {
    if (row.studentId !== context.studentId
      || row.programAssignmentId !== context.programAssignmentId
      || (row.programVersionId !== undefined
        && row.programVersionId !== context.programVersionId)
      || (row.requirementId !== null
        && (!requirementMap.has(row.requirementId)
          || requirementMap.get(row.requirementId)!.programVersionId
            !== context.programVersionId))
      || (row.academicRuleId !== null
        && (!ruleMap.has(row.academicRuleId)
          || ruleMap.get(row.academicRuleId)!.programVersionId
            !== context.programVersionId))
      || (row.creditRecordId !== null && !creditMap.has(row.creditRecordId))) {
      fail("INVALID_EXCEPTION_TARGET", [row]);
    }
  }

  const persistedExceptionPlacements = facts.exceptionPlacements;
  if (persistedExceptionPlacements) {
    const exceptionMap = new Map(facts.exceptions.map((row) => [row.id, row]));
    if (duplicateReasons(
      persistedExceptionPlacements,
      (row) => `${row.exceptionId}:${row.requirementId ?? ""}:${row.academicRuleId ?? ""}:${row.creditRecordId ?? ""}`,
      "DUPLICATE_EXCEPTION_PLACEMENT",
    ).length) fail("DUPLICATE_EXCEPTION_PLACEMENT", persistedExceptionPlacements);
    for (const placement of persistedExceptionPlacements) {
      const exception = exceptionMap.get(placement.exceptionId);
      if (!exception
        || exception.requirementId !== placement.requirementId
        || exception.academicRuleId !== placement.academicRuleId
        || exception.creditRecordId !== placement.creditRecordId) {
        fail("EXCEPTION_PLACEMENT_TARGET_MISMATCH", [placement]);
      }
    }
  }

  const requirementInputs: ProgramBoundRequirementSnapshotInput[] = sortedRows(facts.requirements).map((row) => {
    const id = requirementId(row);
    const refs = ruleRefs.get(id) ?? new Set<string>();
    const ruleValues = [...refs];
    const projection = projectionByRequirement.get(id);
    return {
      requirementId: id,
      academicRuleId: ruleValues.length === 1
        && meaningful(ruleValues[0])
        && ruleValues[0] !== "<NULL>"
        ? ruleValues[0]
        : null,
      kind: projection?.kind ?? row.kind ?? "minimum",
      unit: projection?.unit ?? row.unit ?? "credits",
      requiredAmount: projection?.requiredAmount ?? numericString(row.creditsRequired),
      sourceIds: currentSourceIdsByRequirement.get(id) ?? [],
      claimVersionIds: currentVersionByRequirement.has(id)
        ? [currentVersionByRequirement.get(id)!]
        : [],
      programVersionId: row.programVersionId,
    };
  });
  const activePlacements = sortedRows(
    facts.placements.filter((row) => row.status === "active"),
  );
  const associations: RecordedDecisionRequirementAssociation[] = activePlacements.map((row) => ({
    decisionId: row.studentCreditDecisionId,
    requirementId: row.requirementId,
    academicRuleId: row.academicRuleId,
  }));
  const rules: ProgramBoundAcademicRuleTarget[] = [...allRuleRefs]
    .sort(compare)
    .map((id) => ({ id, programVersionId: ruleMap.get(id)?.programVersionId ?? null }));
  const exceptionPlacements = (facts.exceptionPlacements
    ?? facts.exceptions.map(makeExceptionPlacement))
    .map((placement) => deepClone(placement));
  const compositionInput: DegreeProgressCompositionInput = {
    context: {
      studentId: context.studentId,
      programAssignmentId: context.programAssignmentId,
      programVersionId: context.programVersionId,
    },
    programAssignmentRegistry: sortedRows(assignmentActive).map((row) => ({
      id: row.id,
      studentId: row.studentId,
      programVersionId: row.programVersionId,
      status: row.status,
    })),
    requirements: requirementInputs,
    academicRules: rules,
    unresolvedConflicts: sortedRows(facts.conflicts
      .filter((row) => row.status === "open"
        && meaningful(row.requirementId)
        && facts.requirements.some((req) => requirementId(req) === row.requirementId))
      .map((row) => ({
        conflictId: row.id,
        requirementId: row.requirementId ?? "",
        academicRuleId: row.academicRuleId,
        status: row.status,
         sourceIds: unique((conflictLinkMap.get(row.id) ?? []).map((item) => item.sourceId)),
         claimVersionIds: [
           row.claimVersionAId ?? "",
           row.claimVersionBId ?? "",
         ].filter(meaningful),
      }))),
    creditRecords: sortedRows(facts.creditRecords).map((row) => ({
      id: row.id,
      studentId: row.studentId,
      sourceId: row.sourceId,
      status: row.status,
    })),
    verificationEvents: sortedRows(facts.verificationEvents).map((row) => ({
      id: row.id,
      creditRecordId: row.creditRecordId,
      seq: row.seq,
      action: row.action,
    })),
    decisions: sortedRows(facts.decisions).map((row) => ({
      id: row.id,
      creditRecordId: row.creditRecordId,
      programAssignmentId: row.programAssignmentId,
      seq: row.seq,
      action: row.action,
      creditsAwarded: row.creditsAwarded,
      basisClaimVersionId: row.basisClaimVersionId,
      equivalencyId: row.equivalencyId,
      targetInstitutionCourseVersionId: row.targetInstitutionCourseVersionId,
    })),
    associations,
    exceptions: sortedRows(facts.exceptions).map(makeExceptionFact),
    placements: sortedRows(exceptionPlacements),
  };

  const diagnostics = failures
    .sort((left, right) => compare(left.reason, right.reason)
      || compare(stable(left.rows), stable(right.rows)))
    .map((failure) => diagnostic(failure.reason, failure.rows, occurrences));
  if (diagnostics.length > 0) {
    return deepFreeze({
      status: "MANUAL_REVIEW" as const,
      context,
      asOf,
      contractVersion: DEGREE_EVALUATION_SNAPSHOT_CONTRACT_VERSION,
      schemaVersion: DEGREE_EVALUATION_SNAPSHOT_SCHEMA_VERSION,
      diagnostics,
      occurrences,
    });
  }

  const academicSnapshot = createInformationalAcademicSnapshot({
    context,
    contractVersion: DEGREE_EVALUATION_SNAPSHOT_CONTRACT_VERSION,
    schemaVersion: DEGREE_EVALUATION_SNAPSHOT_SCHEMA_VERSION,
    asOf,
    occurrences,
  });
  if (academicSnapshot.status !== "ACCEPTED") {
    return deepFreeze({
      status: "MANUAL_REVIEW" as const,
      context,
      asOf,
      contractVersion: DEGREE_EVALUATION_SNAPSHOT_CONTRACT_VERSION,
      schemaVersion: DEGREE_EVALUATION_SNAPSHOT_SCHEMA_VERSION,
      diagnostics: academicSnapshot.diagnostics.map((item) => ({
        status: "MANUAL_REVIEW" as const,
        reason: item.reason,
        ids: Object.freeze([]),
        occurrences,
      })),
      occurrences,
    });
  }
  return deepFreeze({
    status: "ACCEPTED" as const,
    context,
    asOf,
    contractVersion: DEGREE_EVALUATION_SNAPSHOT_CONTRACT_VERSION,
    schemaVersion: DEGREE_EVALUATION_SNAPSHOT_SCHEMA_VERSION,
    compositionInput,
    academicSnapshot,
    occurrences,
  });
}

export const assembleDegreeEvaluationSnapshotFacts = assembleDegreeEvaluationSnapshot;