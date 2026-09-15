/**
 * Phase 4E orchestration boundary.  This service performs one snapshot read,
 * one pure integration adaptation, and at most one composition call.  It
 * never persists or retries a result.
 */

import { types as nodeTypes } from "node:util";
import {
  adaptDegreeEvaluationSnapshot,
  DEGREE_PROGRESS_ADAPTER_CONTRACT_VERSION,
  DEGREE_PROGRESS_ADAPTER_SCHEMA_VERSION,
  type DegreeProgressAdapterOutput,
  type DegreeProgressIntegrationDiagnostic,
  type DegreeProgressSnapshotMetadata,
} from "@shared/degree-progress-adapter";
import type {
  DegreeEvaluationSnapshotContext,
  DegreeEvaluationSnapshotOutput,
} from "@shared/degree-evaluation-snapshot";
import { readDegreeEvaluationSnapshot } from "./degree-evaluation-snapshot-service";
import {
  composeDegreeProgress,
  type DegreeProgressCompositionInput,
  type DegreeProgressCompositionOutput,
} from "@shared/degree-progress-composition";

export interface DegreeProgressServiceOptions {
  readonly snapshotReader?: (
    request: DegreeEvaluationSnapshotContext,
  ) => Promise<DegreeEvaluationSnapshotOutput>;
  readonly composer?: (
    input: DegreeProgressCompositionInput,
  ) => Promise<DegreeProgressCompositionOutput> | DegreeProgressCompositionOutput;
  readonly adapter?: (
    snapshot: DegreeEvaluationSnapshotOutput,
  ) => DegreeProgressAdapterOutput;
}

export interface DegreeProgressManualReviewReport {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly status: "MANUAL_REVIEW";
  readonly contractVersion: string;
  readonly schemaVersion: string;
  readonly context: DegreeEvaluationSnapshotContext;
  readonly snapshot: DegreeProgressSnapshotMetadata | null;
  readonly integrationDiagnostics: readonly DegreeProgressIntegrationDiagnostic[];
  readonly phase3Output: DegreeProgressCompositionOutput | null;
}

export interface DegreeProgressComposedReport {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly status: "COMPOSED";
  readonly contractVersion: string;
  readonly schemaVersion: string;
  readonly context: DegreeEvaluationSnapshotContext;
  readonly snapshot: DegreeProgressSnapshotMetadata;
  readonly integrationDiagnostics: readonly DegreeProgressIntegrationDiagnostic[];
  readonly phase3Output: DegreeProgressCompositionOutput;
}

export type DegreeProgressReport =
  | DegreeProgressManualReviewReport
  | DegreeProgressComposedReport;

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isProxy(value: unknown): boolean {
  try {
    return nodeTypes.isProxy(value);
  } catch {
    return true;
  }
}

function cloneOutput<T>(value: T, ancestors = new Set<object>()): T {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value as T;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite output");
    return (Object.is(value, -0) ? 0 : value) as T;
  }
  if (typeof value === "object" && value !== null && isProxy(value)) {
    throw new TypeError("proxy dependency output");
  }
  if (value instanceof Date) {
    const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) throw new TypeError("invalid dependency date property");
      throw new TypeError("custom dependency date property");
    }
    return new Date(value.getTime()) as T;
  }
  if (
    typeof value !== "object"
    || typeof value === "undefined"
    || typeof value === "function"
    || typeof value === "symbol"
    || typeof value === "bigint"
    || isProxy(value)
  ) throw new TypeError("invalid dependency output");
  if (ancestors.has(value)) throw new TypeError("cyclic dependency output");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const length = Object.getOwnPropertyDescriptor(value, "length");
      if (!length || !("value" in length) || !Number.isSafeInteger(length.value)) {
        throw new TypeError("invalid dependency array");
      }
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key !== "string")) {
        throw new TypeError("symbol dependency output");
      }
      if (keys.length !== length.value + 1) throw new TypeError("sparse dependency array");
      const result: unknown[] = [];
      for (let index = 0; index < length.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError("accessor dependency array");
        }
        result.push(cloneOutput(descriptor.value, ancestors));
      }
      return result as T;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("non-plain dependency output");
    }
    const result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError("symbol dependency output");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("accessor dependency output");
      }
      const stringKey: string = key;
      result[stringKey] = cloneOutput(descriptor.value, ancestors);
    }
    return result as T;
  } finally {
    ancestors.delete(value);
  }
}

function snapshotContext(value: unknown): DegreeEvaluationSnapshotContext | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 3 || keys.some((key) => typeof key !== "string")) return null;
    const output: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      output[key] = descriptor.value;
    }
    if (
      typeof output.studentId !== "string"
      || typeof output.programAssignmentId !== "string"
      || typeof output.programVersionId !== "string"
    ) return null;
    return {
      studentId: output.studentId,
      programAssignmentId: output.programAssignmentId,
      programVersionId: output.programVersionId,
    };
  } catch {
    return null;
  }
}

function returnedSnapshotContext(value: unknown): DegreeEvaluationSnapshotContext | null {
  try {
    if (value === null || typeof value !== "object" || isProxy(value) || Array.isArray(value)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, "context");
    if (!descriptor || !("value" in descriptor)) return null;
    return snapshotContext(descriptor.value);
  } catch {
    return null;
  }
}

function readOwnData(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort(compare);
  const sortedExpected = [...expected].sort(compare);
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}

function validJson(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
   if (typeof value !== "object" || isProxy(value) || value instanceof Date) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.every((item) => validJson(item, seen));
    if (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null) return false;
    const record = value as Record<string, unknown>;
    return Object.keys(record).every((key) => validJson(record[key], seen));
  } finally {
    seen.delete(value);
  }
}

function validOccurrence(value: unknown): boolean {
  if (!exactKeys(value, ["occurrenceKind", "occurrenceId", "value"])) return false;
  return typeof value.occurrenceKind === "string"
    && value.occurrenceKind.trim().length > 0
    && typeof value.occurrenceId === "string"
    && value.occurrenceId.trim().length > 0
    && validJson(value.value);
}

function validIntegrationDiagnostic(value: unknown): boolean {
  if (!exactKeys(value, ["stage", "reason", "code", "ids", "occurrences"])) return false;
  return value.stage === "INTEGRATION"
    && typeof value.reason === "string"
    && typeof value.code === "string"
    && Array.isArray(value.ids)
    && value.ids.every((id) => typeof id === "string")
    && Array.isArray(value.occurrences)
    && value.occurrences.every(validOccurrence);
}

function validSnapshotMetadata(value: unknown): value is DegreeProgressSnapshotMetadata {
  if (!exactKeys(value, [
    "fingerprint", "asOf", "contractVersion", "schemaVersion", "context", "occurrences",
  ])) return false;
  return (value.fingerprint === null || typeof value.fingerprint === "string")
    && canonicalAsOf(value.asOf)
    && typeof value.contractVersion === "string"
    && typeof value.schemaVersion === "string"
    && snapshotContext(value.context) !== null
    && Array.isArray(value.occurrences)
    && value.occurrences.every(validOccurrence);
}

function validCompositionInput(value: unknown): value is DegreeProgressCompositionInput {
  if (!exactKeys(value, [
    "context", "programAssignmentRegistry", "requirements", "academicRules",
    "unresolvedConflicts", "creditRecords", "verificationEvents", "decisions",
    "associations", "exceptions", "placements",
  ])) return false;
  return snapshotContext(value.context) !== null
    && Array.isArray(value.programAssignmentRegistry)
    && Array.isArray(value.requirements)
    && Array.isArray(value.academicRules)
    && Array.isArray(value.unresolvedConflicts)
    && Array.isArray(value.creditRecords)
    && Array.isArray(value.verificationEvents)
    && Array.isArray(value.decisions)
    && Array.isArray(value.associations)
    && Array.isArray(value.exceptions)
    && Array.isArray(value.placements);
}

function validStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validProvenance(value: unknown, keys: readonly string[]): boolean {
  if (!exactKeys(value, keys)) return false;
  return keys.every((key) => {
    const ids = value[key];
    return Array.isArray(ids)
      && ids.every((item) => typeof item === "string" && item.trim().length > 0);
  });
}

function validOptionalString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function validAmount(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) return false;
  return value === "0" || !value.startsWith("0");
}

function validId(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function validStringList(value: unknown): boolean {
  return Array.isArray(value)
    && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function validCreditEvidence(value: unknown): boolean {
  return exactKeys(value, [
    "evidenceId", "studentCreditRecordId", "requirementId", "academicRuleId", "kind", "unit",
    "amount", "verificationEventId", "decisionId", "exceptionIds", "sourceIds", "claimVersionIds",
    "recordedProvenance",
  ])
    && validId(value.evidenceId)
    && validId(value.studentCreditRecordId)
    && validId(value.requirementId)
    && validOptionalString(value.academicRuleId)
    && validId(value.kind)
    && validId(value.unit)
    && validAmount(value.amount)
    && validOptionalString(value.verificationEventId)
    && validOptionalString(value.decisionId)
    && validStringList(value.exceptionIds)
    && validStringList(value.sourceIds)
    && validStringList(value.claimVersionIds)
    && validProvenance(value.recordedProvenance, [
      "studentIds", "programAssignmentIds", "studentCreditRecordIds", "verificationEventIds",
      "decisionIds", "requirementIds", "academicRuleIds", "sourceIds", "claimVersionIds",
      "equivalencyIds", "targetInstitutionCourseVersionIds",
    ]);
}

function validCompositionOccurrence(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== "string" || ![
    "programAssignment", "requirement", "academicRule", "creditRecord",
    "verificationEvent", "decision", "association", "unresolvedConflict",
    "exception", "placement",
  ].includes(kind)) return false;
  const required: Record<string, readonly string[]> = {
    programAssignment: ["id", "studentId", "programVersionId", "status"],
    requirement: ["requirementId", "academicRuleId", "programVersionId"],
    academicRule: ["id", "programVersionId"],
    creditRecord: ["id", "studentId", "sourceId", "status"],
    verificationEvent: ["id", "creditRecordId", "seq", "action"],
    decision: ["id", "creditRecordId", "programAssignmentId", "seq", "action",
      "basisClaimVersionId", "equivalencyId", "targetInstitutionCourseVersionId"],
    association: ["decisionId", "requirementId", "academicRuleId"],
    unresolvedConflict: ["conflictId", "requirementId", "academicRuleId", "status"],
    exception: ["id", "studentId", "programAssignmentId", "exceptionType", "status",
      "requirementId", "academicRuleId", "creditRecordId", "supersedesExceptionId", "approvedBy"],
    placement: ["exceptionId", "requirementId", "academicRuleId", "creditRecordId", "evidenceId"],
  };
  if (!exactKeys(record, ["kind", ...required[kind]])) return false;
  const nullableByKind: Record<string, readonly string[]> = {
    requirement: ["academicRuleId"],
    decision: ["basisClaimVersionId", "equivalencyId", "targetInstitutionCourseVersionId"],
    association: ["academicRuleId"],
    unresolvedConflict: ["academicRuleId"],
    exception: [
      "requirementId", "academicRuleId", "creditRecordId", "supersedesExceptionId", "approvedBy",
    ],
    placement: ["academicRuleId", "creditRecordId", "evidenceId"],
  };
  const nullable = new Set(nullableByKind[kind] ?? []);
  return required[kind].every((key) => (
    key === "seq" ? Number.isSafeInteger(record[key])
      : nullable.has(key) ? validOptionalString(record[key])
        : typeof record[key] === "string" && record[key].trim().length > 0
  ));
}

function validCompositionProvenance(value: unknown): boolean {
  const keys = [
    "studentIds", "programAssignmentIds", "programVersionIds", "requirementIds",
    "academicRuleIds", "studentCreditRecordIds", "verificationEventIds", "decisionIds",
    "conflictIds", "exceptionIds", "supersededExceptionIds", "evidenceIds", "sourceIds",
    "claimVersionIds", "equivalencyIds", "targetInstitutionCourseVersionIds",
    "approvedByIds", "occurrences",
  ];
  return exactKeys(value, keys)
    && keys.slice(0, -1).every((key) => {
      const identifiers = value[key];
      return Array.isArray(identifiers)
        && identifiers.every((item) => (
          typeof item === "string" && item.trim().length > 0
        ));
    })
    && Array.isArray(value.occurrences)
    && value.occurrences.every(validCompositionOccurrence);
}

function validRequirementInput(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, [
    "requirementId", "academicRuleId", "kind", "unit", "requiredAmount", "sourceIds", "claimVersionIds",
  ])
    && validId(record.requirementId)
    && validOptionalString(record.academicRuleId)
    && validId(record.kind)
    && validId(record.unit)
    && validAmount(record.requiredAmount)
    && validStringList(record.sourceIds)
    && validStringList(record.claimVersionIds);
}

function validContributionInput(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return validId(record.requirementId)
    && validId(record.studentCreditRecordId)
    && validAmount(record.amount)
    && validOptionalString(record.verificationEventId)
    && validOptionalString(record.decisionId)
    && validStringList(record.exceptionIds)
    && validStringList(record.sourceIds)
    && validStringList(record.claimVersionIds);
}

function validResult(value: unknown): boolean {
  return exactKeys(value, [
    "projectionKind", "requirementId", "academicRuleId", "status", "requiredAmount",
    "appliedAmount", "remainingAmount", "reason", "provenance",
  ])
    && value.projectionKind === "INFORMATIONAL_ONLY"
    && validOptionalString(value.requirementId)
    && validOptionalString(value.academicRuleId)
    && typeof value.status === "string"
    && ["SATISFIED", "PARTIAL", "MISSING", "CONFLICT", "MANUAL_REVIEW"].includes(value.status)
    && validAmount(value.requiredAmount)
    && validAmount(value.appliedAmount)
    && validAmount(value.remainingAmount)
    && validOptionalString(value.reason)
    && validProvenance(value.provenance, [
      "studentCreditRecordIds", "requirementIds", "academicRuleIds", "verificationEventIds",
      "decisionIds", "exceptionIds", "conflictIds", "sourceIds", "claimVersionIds",
    ]);
}

function stableValue(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean"
    || typeof value === "number") return JSON.stringify(value) ?? "";
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort(compare)
      .map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`).join(",")}}`;
  }
  return "";
}

function validNormalization(value: unknown): boolean {
  return exactKeys(value, ["projectionKind", "requirements", "contributions", "conflicts", "diagnostics"])
    && value.projectionKind === "INFORMATIONAL_ONLY"
    && Array.isArray(value.requirements)
    && value.requirements.every(validRequirementInput)
    && Array.isArray(value.contributions)
    && value.contributions.every((item) => (
      validContributionInput(item)
      && exactKeys(item, [
        "requirementId", "studentCreditRecordId", "amount", "verificationEventId", "decisionId",
        "exceptionIds", "sourceIds", "claimVersionIds", "canonicalFactIds",
      ])
      && validStringArray(item.canonicalFactIds)
    ))
    && Array.isArray(value.conflicts)
    && value.conflicts.every((item) => (
      exactKeys(item, ["conflictId", "requirementId", "academicRuleId", "sourceIds", "claimVersionIds"])
      && typeof item.conflictId === "string"
      && typeof item.requirementId === "string"
      && validOptionalString(item.academicRuleId)
      && validStringArray(item.sourceIds)
      && validStringArray(item.claimVersionIds)
    ))
    && Array.isArray(value.diagnostics)
    && value.diagnostics.every((item) => (
      exactKeys(item, ["projectionKind", "status", "reason", "provenance"])
      && item.projectionKind === "INFORMATIONAL_ONLY"
      && item.status === "MANUAL_REVIEW"
      && typeof item.reason === "string"
      && item.reason.trim().length > 0
      && validProvenance(item.provenance, [
        "canonicalFactIds", "studentCreditRecordIds", "requirementIds", "academicRuleIds",
        "verificationEventIds", "decisionIds", "exceptionIds", "conflictIds", "sourceIds",
        "claimVersionIds",
      ])
    ));
}

function validRecordedCreditProjection(value: unknown): boolean {
  if (!exactKeys(value, [
    "projectionKind", "evidence", "diagnostics", "recordedProvenance", "normalization", "results",
  ])) return false;
  return value.projectionKind === "INFORMATIONAL_ONLY"
    && Array.isArray(value.evidence)
    && value.evidence.every(validCreditEvidence)
    && Array.isArray(value.diagnostics)
    && value.diagnostics.every((item) => exactKeys(item, [
      "projectionKind", "status", "reason", "provenance",
    ])
      && item.projectionKind === "INFORMATIONAL_ONLY"
      && item.status === "MANUAL_REVIEW"
      && typeof item.reason === "string"
      && item.reason.trim().length > 0
      && validProvenance(item.provenance, [
        "studentIds", "programAssignmentIds", "studentCreditRecordIds", "verificationEventIds",
        "decisionIds", "requirementIds", "academicRuleIds", "sourceIds", "claimVersionIds",
        "equivalencyIds", "targetInstitutionCourseVersionIds",
      ]))
    && validProvenance(value.recordedProvenance, [
      "studentIds", "programAssignmentIds", "studentCreditRecordIds", "verificationEventIds",
      "decisionIds", "requirementIds", "academicRuleIds", "sourceIds", "claimVersionIds",
      "equivalencyIds", "targetInstitutionCourseVersionIds",
    ])
    && validNormalization(value.normalization)
    && Array.isArray(value.results)
    && value.results.every(validResult);
}

function validRecordedExceptionProjection(value: unknown): boolean {
  if (!exactKeys(value, [
    "projectionKind", "observations", "diagnostics", "evidence", "normalization", "results",
  ])) return false;
  return value.projectionKind === "INFORMATIONAL_ONLY"
    && Array.isArray(value.observations)
    && value.observations.every((item) => exactKeys(item, [
      "projectionKind", "status", "reason", "exceptionId", "exceptionType",
      "exceptionStatus", "rationale", "effectiveFrom", "effectiveTo", "createdAt",
      "metadata", "provenance",
    ])
      && item.projectionKind === "INFORMATIONAL_ONLY"
      && item.status === "MANUAL_REVIEW"
      && item.reason === "RECORDED_EXCEPTION_EFFECT_UNDEFINED"
      && typeof item.exceptionId === "string"
      && typeof item.exceptionType === "string"
      && item.exceptionStatus === "active"
      && typeof item.rationale === "string"
      && validOptionalString(item.effectiveFrom)
      && validOptionalString(item.effectiveTo)
      && typeof item.createdAt === "string"
      && validJson(item.metadata)
      && validProvenance(item.provenance, [
        "studentIds", "programAssignmentIds", "studentCreditRecordIds", "verificationEventIds",
        "decisionIds", "requirementIds", "academicRuleIds", "sourceIds", "claimVersionIds",
        "equivalencyIds", "targetInstitutionCourseVersionIds", "exceptionIds",
        "supersededExceptionIds", "evidenceIds", "approvedByIds",
      ]))
    && Array.isArray(value.diagnostics)
    && value.diagnostics.every((item) => exactKeys(item, [
      "projectionKind", "status", "reason", "provenance",
    ])
      && item.projectionKind === "INFORMATIONAL_ONLY"
      && item.status === "MANUAL_REVIEW"
      && typeof item.reason === "string"
      && item.reason.trim().length > 0
      && validProvenance(item.provenance, [
        "studentIds", "programAssignmentIds", "studentCreditRecordIds", "verificationEventIds",
        "decisionIds", "requirementIds", "academicRuleIds", "sourceIds", "claimVersionIds",
        "equivalencyIds", "targetInstitutionCourseVersionIds", "exceptionIds",
        "supersededExceptionIds", "evidenceIds", "approvedByIds",
      ]))
    && Array.isArray(value.evidence)
    && value.evidence.every(validCreditEvidence)
    && validNormalization(value.normalization)
    && Array.isArray(value.results)
    && value.results.every(validResult);
}

function validInputAccounting(value: unknown): boolean {
  return exactKeys(value, ["projectionKind", "occurrences"])
    && value.projectionKind === "INFORMATIONAL_ONLY"
    && Array.isArray(value.occurrences)
    && value.occurrences.every(validCompositionOccurrence);
}

const ADAPTED_KEYS = [
  "status", "compositionInput", "integrationDiagnostics", "diagnostics", "snapshot",
] as const;
const MANUAL_ADAPTER_KEYS = ["status", "integrationDiagnostics", "diagnostics", "snapshot"] as const;

function validAdapterOutput(value: unknown): value is DegreeProgressAdapterOutput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.status === "ADAPTED") {
    return exactKeys(record, ADAPTED_KEYS)
      && validCompositionInput(record.compositionInput)
      && Array.isArray(record.integrationDiagnostics)
      && record.integrationDiagnostics.every(validIntegrationDiagnostic)
      && Array.isArray(record.diagnostics)
      && record.diagnostics.every(validIntegrationDiagnostic)
      && validSnapshotMetadata(record.snapshot);
  }
  if (record.status === "MANUAL_REVIEW") {
    return exactKeys(record, MANUAL_ADAPTER_KEYS)
      && Array.isArray(record.integrationDiagnostics)
      && record.integrationDiagnostics.length > 0
      && record.integrationDiagnostics.every(validIntegrationDiagnostic)
      && Array.isArray(record.diagnostics)
      && record.diagnostics.length > 0
      && record.diagnostics.every(validIntegrationDiagnostic)
      && (record.snapshot === null || validSnapshotMetadata(record.snapshot));
  }
  return false;
}

function canonicalAsOf(value: unknown): value is string {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validCompositionDiagnostic(value: unknown): boolean {
  return exactKeys(value, ["stage", "projectionKind", "status", "reason", "provenance"])
    && typeof value.stage === "string"
    && ["COMPOSITION", "RECORDED_CREDIT", "CANONICAL_NORMALIZATION", "RECORDED_EXCEPTION"]
      .includes(value.stage)
    && value.projectionKind === "INFORMATIONAL_ONLY"
    && value.status === "MANUAL_REVIEW"
    && typeof value.reason === "string"
    && value.reason.trim().length > 0
    && validCompositionProvenance(value.provenance);
}

function validCompositionOutput(value: unknown): value is DegreeProgressCompositionOutput {
  if (!exactKeys(value, ["projectionKind", "compositionKind", "status", "context", "diagnostics"])) {
    if (!exactKeys(value, [
      "projectionKind", "compositionKind", "context", "diagnostics",
      "recordedCreditProjection", "recordedExceptionProjection", "inputAccounting",
      "evidence", "normalization", "results", "observations",
    ])) return false;
    return value.projectionKind === "INFORMATIONAL_ONLY"
      && value.compositionKind === "COMPOSED"
      && snapshotContext(value.context) !== null
      && Array.isArray(value.diagnostics)
      && value.diagnostics.every(validCompositionDiagnostic)
      && value.recordedCreditProjection !== null
      && validRecordedCreditProjection(value.recordedCreditProjection)
      && value.recordedExceptionProjection !== null
      && validRecordedExceptionProjection(value.recordedExceptionProjection)
      && validInputAccounting(value.inputAccounting)
      && Array.isArray(value.evidence)
      && value.normalization !== null
      && typeof value.normalization === "object"
      && Array.isArray(value.results)
      && Array.isArray(value.observations)
      && stableValue(value.evidence)
        === stableValue(readOwnData(value.recordedExceptionProjection, "evidence"))
      && stableValue(value.normalization)
        === stableValue(readOwnData(value.recordedExceptionProjection, "normalization"))
      && stableValue(value.results)
        === stableValue(readOwnData(value.recordedExceptionProjection, "results"))
      && stableValue(value.observations)
        === stableValue(readOwnData(value.recordedExceptionProjection, "observations"));
  }
  return value.projectionKind === "INFORMATIONAL_ONLY"
    && value.compositionKind === "INFORMATIONAL_ONLY"
    && value.status === "MANUAL_REVIEW"
    && snapshotContext(value.context) !== null
    && Array.isArray(value.diagnostics)
    && value.diagnostics.every(validCompositionDiagnostic);
}

function sameContext(
  left: DegreeEvaluationSnapshotContext,
  right: DegreeEvaluationSnapshotContext | null,
): boolean {
  return right !== null
    && left.studentId === right.studentId
    && left.programAssignmentId === right.programAssignmentId
    && left.programVersionId === right.programVersionId;
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

function opaqueDiagnostic(
  reason: string,
  context: DegreeEvaluationSnapshotContext,
): DegreeProgressIntegrationDiagnostic {
  return {
    stage: "INTEGRATION",
    reason,
    code: reason,
    ids: Object.freeze([
      context.studentId,
      context.programAssignmentId,
      context.programVersionId,
    ].filter((item) => item.length > 0).sort(compare)),
    occurrences: Object.freeze([]),
  };
}

function reportManual(
  context: DegreeEvaluationSnapshotContext,
  snapshot: DegreeProgressSnapshotMetadata | null,
  integrationDiagnostics: readonly DegreeProgressIntegrationDiagnostic[],
  phase3Output: DegreeProgressCompositionOutput | null,
): DegreeProgressManualReviewReport {
  return deepFreeze({
    projectionKind: "INFORMATIONAL_ONLY" as const,
    status: "MANUAL_REVIEW" as const,
    contractVersion: DEGREE_PROGRESS_ADAPTER_CONTRACT_VERSION,
    schemaVersion: DEGREE_PROGRESS_ADAPTER_SCHEMA_VERSION,
    context: cloneOutput(context),
    snapshot: snapshot === null ? null : cloneOutput(snapshot),
    integrationDiagnostics: cloneOutput(integrationDiagnostics),
    phase3Output: phase3Output === null ? null : cloneOutput(phase3Output),
  });
}

export async function getDegreeProgress(
  request: DegreeEvaluationSnapshotContext,
  options: DegreeProgressServiceOptions = {},
): Promise<DegreeProgressReport> {
  const snapshotReader = options.snapshotReader
    ?? ((context: DegreeEvaluationSnapshotContext) => readDegreeEvaluationSnapshot(context));
  let snapshot: DegreeEvaluationSnapshotOutput;
  try {
    snapshot = await snapshotReader(request);
  } catch {
    return reportManual(request, null, [opaqueDiagnostic("SNAPSHOT_READER_FAILED", request)], null);
  }
  try {
    snapshot = cloneOutput(snapshot);
  } catch {
    return reportManual(request, null, [opaqueDiagnostic("INVALID_SNAPSHOT_OUTPUT", request)], null);
  }

  const returnedContext = returnedSnapshotContext(snapshot);
  if (!sameContext(request, returnedContext)) {
    return reportManual(
      request,
      null,
      [opaqueDiagnostic("SNAPSHOT_CONTEXT_MISMATCH", request)],
      null,
    );
  }
  let adaptedDependency: unknown;
  try {
    adaptedDependency = (options.adapter ?? adaptDegreeEvaluationSnapshot)(snapshot);
  } catch {
    return reportManual(request, null, [opaqueDiagnostic("INTEGRATION_ADAPTER_FAILED", request)], null);
  }
  let adapted: DegreeProgressAdapterOutput;
  try {
    const cloned = cloneOutput(adaptedDependency);
    if (!validAdapterOutput(cloned)) {
      return reportManual(request, null, [opaqueDiagnostic("INVALID_ADAPTER_OUTPUT", request)], null);
    }
    adapted = cloned;
    if (
      (adapted.status === "ADAPTED"
        && (!sameContext(request, snapshotContext(adapted.compositionInput.context))
          || !sameContext(request, snapshotContext(adapted.snapshot.context))))
      || (adapted.status === "MANUAL_REVIEW"
        && adapted.snapshot !== null
        && !sameContext(request, snapshotContext(adapted.snapshot.context)))
    ) {
      return reportManual(request, null, [opaqueDiagnostic("INVALID_ADAPTER_OUTPUT", request)], null);
    }
  } catch {
    return reportManual(request, null, [opaqueDiagnostic("INVALID_ADAPTER_OUTPUT", request)], null);
  }
  if (adapted.status === "MANUAL_REVIEW") {
    return reportManual(
      request,
      adapted.snapshot,
      adapted.integrationDiagnostics,
      null,
    );
  }

  const composer = options.composer
    ?? ((input: DegreeProgressCompositionInput) => composeDegreeProgress(input));
  const compositionInput = readOwnData(adaptedDependency, "compositionInput");
  if (!validCompositionInput(compositionInput)) {
    return reportManual(request, adapted.snapshot, [
      opaqueDiagnostic("INVALID_ADAPTER_OUTPUT", request),
    ], null);
  }
  let phase3Dependency: unknown;
  try {
    phase3Dependency = await composer(compositionInput);
  } catch {
    return reportManual(
      request,
      adapted.snapshot,
      [opaqueDiagnostic("COMPOSER_FAILED", request)],
      null,
    );
  }
  let copiedPhase3: DegreeProgressCompositionOutput;
  try {
    const cloned = cloneOutput(phase3Dependency);
    if (!validCompositionOutput(cloned)
      || !sameContext(request, snapshotContext(cloned.context))) {
      return reportManual(request, adapted.snapshot, [
        opaqueDiagnostic("INVALID_COMPOSITION_OUTPUT", request),
      ], null);
    }
    copiedPhase3 = cloned;
  } catch {
    return reportManual(request, adapted.snapshot, [
      opaqueDiagnostic("INVALID_COMPOSITION_OUTPUT", request),
    ], null);
  }
  if (
    copiedPhase3.compositionKind === "INFORMATIONAL_ONLY"
    && copiedPhase3.status === "MANUAL_REVIEW"
  ) {
    return reportManual(request, adapted.snapshot, adapted.integrationDiagnostics, copiedPhase3);
  }
  return deepFreeze({
    projectionKind: "INFORMATIONAL_ONLY" as const,
    status: "COMPOSED" as const,
    contractVersion: DEGREE_PROGRESS_ADAPTER_CONTRACT_VERSION,
    schemaVersion: DEGREE_PROGRESS_ADAPTER_SCHEMA_VERSION,
    context: cloneOutput(request),
    snapshot: cloneOutput(adapted.snapshot),
    integrationDiagnostics: cloneOutput(adapted.integrationDiagnostics),
    phase3Output: copiedPhase3,
  });
}

export const readDegreeProgress = getDegreeProgress;
