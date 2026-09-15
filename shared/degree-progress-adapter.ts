/**
 * Phase 4D integration boundary.  This module only translates and
 * cross-validates the already canonical 4C snapshot.  It never evaluates a
 * requirement, resolves a conflict, or composes a degree.
 */

import { types as nodeTypes } from "node:util";
import type {
  DegreeEvaluationSnapshotOccurrence,
  DegreeEvaluationSnapshotOutput,
} from "./degree-evaluation-snapshot";
import {
  DEGREE_EVALUATION_SNAPSHOT_CONTRACT_VERSION,
  DEGREE_EVALUATION_SNAPSHOT_SCHEMA_VERSION,
} from "./degree-evaluation-snapshot";
import {
  createInformationalAcademicSnapshot,
  type InformationalAcademicSnapshotOutput,
} from "./informational-academic-snapshot";
import type {
  DegreeProgressCompositionInput,
} from "./degree-progress-composition";

export const DEGREE_PROGRESS_ADAPTER_CONTRACT_VERSION = "4D.1";
export const DEGREE_PROGRESS_ADAPTER_SCHEMA_VERSION = "4D.canonical-integration.1";
export const DEGREE_PROGRESS_CONTRACT_VERSION = DEGREE_PROGRESS_ADAPTER_CONTRACT_VERSION;
export const DEGREE_PROGRESS_SCHEMA_VERSION = DEGREE_PROGRESS_ADAPTER_SCHEMA_VERSION;

export interface DegreeProgressIntegrationDiagnostic {
  readonly stage: "INTEGRATION";
  readonly reason: string;
  readonly code: string;
  readonly ids: readonly string[];
  readonly occurrences: readonly DegreeEvaluationSnapshotOccurrence[];
}

export interface DegreeProgressSnapshotMetadata {
  readonly fingerprint: string | null;
  readonly asOf: string;
  readonly contractVersion: string;
  readonly schemaVersion: string;
  readonly context: {
    readonly studentId: string;
    readonly programAssignmentId: string;
    readonly programVersionId: string;
  };
  readonly occurrences: readonly DegreeEvaluationSnapshotOccurrence[];
}

export interface DegreeProgressAdapted {
  readonly status: "ADAPTED";
  readonly compositionInput: DegreeProgressCompositionInput;
  readonly integrationDiagnostics: readonly DegreeProgressIntegrationDiagnostic[];
  readonly diagnostics: readonly DegreeProgressIntegrationDiagnostic[];
  readonly snapshot: DegreeProgressSnapshotMetadata;
}

export interface DegreeProgressIntegrationManualReview {
  readonly status: "MANUAL_REVIEW";
  readonly integrationDiagnostics: readonly DegreeProgressIntegrationDiagnostic[];
  readonly diagnostics: readonly DegreeProgressIntegrationDiagnostic[];
  readonly snapshot: DegreeProgressSnapshotMetadata | null;
}

export type DegreeProgressAdapterOutput =
  | DegreeProgressAdapted
  | DegreeProgressIntegrationManualReview;

type PlainRecord = Record<string, unknown>;

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function meaningful(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isProxy(value: unknown): boolean {
  try {
    return nodeTypes.isProxy(value);
  } catch {
    return true;
  }
}

/**
 * Clone through descriptors, rather than property reads.  Apart from keeping
 * callers untouched, this makes a cast object with an accessor, proxy, cycle,
 * or non-JSON value fail closed before any integration decision is made.
 */
function cloneSafe(
  value: unknown,
  ancestors = new Set<object>(),
): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite number");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "object" && value !== null && isProxy(value)) {
    throw new TypeError("proxy value");
  }
  if (value instanceof Date) {
    const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) throw new TypeError("invalid date property");
      throw new TypeError("custom date property");
    }
    if (!Number.isFinite(value.getTime())) throw new TypeError("invalid date");
    return new Date(value.getTime());
  }
  if (
    typeof value !== "object"
    || typeof value === "undefined"
    || typeof value === "function"
    || typeof value === "symbol"
    || typeof value === "bigint"
  ) {
    throw new TypeError("non-canonical value");
  }
  if (ancestors.has(value)) throw new TypeError("cycle");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError("non-canonical array");
      }
      const length = Object.getOwnPropertyDescriptor(value, "length");
      if (!length || !("value" in length)
        || !Number.isSafeInteger(length.value) || length.value < 0) {
        throw new TypeError("invalid array");
      }
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key !== "string")) throw new TypeError("symbol key");
      if (keys.length !== length.value + 1) throw new TypeError("sparse array");
      const result: unknown[] = [];
      for (let index = 0; index < length.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError("accessor array");
        }
        result.push(cloneSafe(descriptor.value, ancestors));
      }
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("non-plain object");
    }
    const result: PlainRecord = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError("symbol key");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("accessor property");
      }
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: cloneSafe(descriptor.value, ancestors),
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function stable(value: unknown): string {
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as PlainRecord).sort(compare)
      .map((key) => `${JSON.stringify(key)}:${stable((value as PlainRecord)[key])}`)
      .join(",")}}`;
  }
  return "";
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

function idsOf(rows: readonly unknown[]): readonly string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const [key, value] of Object.entries(row as PlainRecord)) {
      if ((key === "id" || key.endsWith("Id")) && meaningful(value)) ids.add(value);
    }
  }
  return Object.freeze([...ids].sort(compare));
}

function occurrenceFor(
  all: readonly DegreeEvaluationSnapshotOccurrence[],
  kinds: readonly string[],
  predicate: (value: PlainRecord, occurrence: DegreeEvaluationSnapshotOccurrence) => boolean,
): readonly DegreeEvaluationSnapshotOccurrence[] {
  return all.filter((item) => kinds.includes(item.occurrenceKind)
    && item.value !== null
    && typeof item.value === "object"
    && !Array.isArray(item.value)
    && predicate(item.value as PlainRecord, item));
}

function diagnostic(
  reason: string,
  rows: readonly unknown[],
  occurrences: readonly DegreeEvaluationSnapshotOccurrence[],
): DegreeProgressIntegrationDiagnostic {
  return {
    stage: "INTEGRATION",
    reason,
    code: reason,
    ids: idsOf(rows),
    occurrences: sortedOccurrences(occurrences),
  };
}

function metadata(
  snapshot: {
    readonly context: DegreeProgressSnapshotMetadata["context"];
    readonly asOf: string;
    readonly contractVersion: string;
    readonly schemaVersion: string;
    readonly occurrences: readonly DegreeEvaluationSnapshotOccurrence[];
    readonly fingerprint?: string | null;
  },
): DegreeProgressSnapshotMetadata {
  return {
    context: snapshot.context,
    asOf: snapshot.asOf,
    contractVersion: snapshot.contractVersion,
    schemaVersion: snapshot.schemaVersion,
    fingerprint: snapshot.fingerprint ?? null,
    occurrences: snapshot.occurrences,
  };
}

function isRecord(value: unknown): value is PlainRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decimalAmount(value: unknown): string | null {
  const candidate = typeof value === "number"
    ? (Number.isFinite(value) && value >= 0 ? String(value) : null)
    : typeof value === "string" ? value : null;
  if (
    candidate === null
    || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(candidate)
  ) return null;
  return candidate;
}

function canonicalAsOf(value: unknown): value is string {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function exactKeys(value: unknown, keys: readonly string[]): value is PlainRecord {
  if (!isRecord(value)) return false;
  const own = Object.keys(value).sort(compare);
  const expected = [...keys].sort(compare);
  return own.length === expected.length
    && own.every((key, index) => key === expected[index]);
}

function jsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || value instanceof Date || isProxy(value)) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.every((item) => jsonValue(item, seen));
    if (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null) return false;
    return Object.keys(value).every((key) => jsonValue(value[key], seen));
  } finally {
    seen.delete(value);
  }
}

const SNAPSHOT_KEYS = [
  "status", "context", "asOf", "contractVersion", "schemaVersion",
  "compositionInput", "academicSnapshot", "occurrences",
] as const;
const CONTEXT_KEYS = ["studentId", "programAssignmentId", "programVersionId"] as const;
const ACADEMIC_KEYS = [
  "projectionKind", "status", "context", "contractVersion", "schemaVersion",
  "asOf", "inputAccounting", "snapshotFingerprint",
] as const;
const ACCOUNTING_KEYS = ["projectionKind", "occurrences"] as const;
const OCCURRENCE_KEYS = ["occurrenceKind", "occurrenceId", "value"] as const;
const COMPOSITION_KEYS = [
  "context", "programAssignmentRegistry", "requirements", "academicRules",
  "unresolvedConflicts", "creditRecords", "verificationEvents", "decisions",
  "associations", "exceptions", "placements",
] as const;

function exactContext(left: unknown, right: unknown): boolean {
  return isRecord(left) && isRecord(right)
    && left.studentId === right.studentId
    && left.programAssignmentId === right.programAssignmentId
    && left.programVersionId === right.programVersionId;
}

function sortedOccurrences(
  occurrences: readonly DegreeEvaluationSnapshotOccurrence[],
): readonly DegreeEvaluationSnapshotOccurrence[] {
  return occurrences
    .map((item) => ({
      occurrenceKind: item.occurrenceKind,
      occurrenceId: item.occurrenceId,
      value: item.value,
    }))
    .sort((left, right) => (
      compare(left.occurrenceKind, right.occurrenceKind)
      || compare(left.occurrenceId, right.occurrenceId)
      || compare(stable(left.value), stable(right.value))
    ));
}

function structurallyValidOccurrences(value: unknown): value is readonly DegreeEvaluationSnapshotOccurrence[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => (
    exactKeys(item, OCCURRENCE_KEYS)
    && meaningful(item.occurrenceKind)
    && meaningful(item.occurrenceId)
    && jsonValue(item.value)
  ));
}

function structurallyValidContext(value: unknown): boolean {
  return exactKeys(value, CONTEXT_KEYS)
    && meaningful(value.studentId)
    && meaningful(value.programAssignmentId)
    && meaningful(value.programVersionId);
}

function readContext(value: unknown): DegreeProgressSnapshotMetadata["context"] | null {
  if (!structurallyValidContext(value)) return null;
  const row = value as PlainRecord;
  return {
    studentId: row.studentId as string,
    programAssignmentId: row.programAssignmentId as string,
    programVersionId: row.programVersionId as string,
  };
}

function isAcceptedAcademicSnapshot(
  value: unknown,
): value is Extract<InformationalAcademicSnapshotOutput, { status: "ACCEPTED" }> {
  return isRecord(value)
    && value.projectionKind === "INFORMATIONAL_ONLY"
    && value.status === "ACCEPTED"
    && "snapshotFingerprint" in value
    && typeof value.snapshotFingerprint === "string";
}

function sameOccurrences(
  left: readonly DegreeEvaluationSnapshotOccurrence[],
  right: readonly DegreeEvaluationSnapshotOccurrence[],
): boolean {
  const sortedLeft = sortedOccurrences(left);
  const sortedRight = sortedOccurrences(right);
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((item, index) => stable(item) === stable(sortedRight[index]));
}

function manual(
  diagnostics: readonly DegreeProgressIntegrationDiagnostic[],
  snapshot: DegreeProgressSnapshotMetadata | null,
): DegreeProgressIntegrationManualReview {
  const sorted = [...diagnostics].sort((left, right) => (
    compare(left.reason, right.reason) || compare(stable(left), stable(right))
  ));
  return deepFreeze({
    status: "MANUAL_REVIEW" as const,
    integrationDiagnostics: sorted,
    diagnostics: sorted,
    snapshot,
  });
}

function adaptDegreeEvaluationSnapshotUnsafe(
  input: DegreeEvaluationSnapshotOutput,
): DegreeProgressAdapterOutput {
  let snapshot: DegreeEvaluationSnapshotOutput;
  try {
    snapshot = cloneSafe(input) as DegreeEvaluationSnapshotOutput;
  } catch {
    return manual([diagnostic("MALFORMED_SNAPSHOT_INPUT", [], [])], null);
  }

  const all = Array.isArray((snapshot as { occurrences?: unknown }).occurrences)
    ? (snapshot as { occurrences: readonly DegreeEvaluationSnapshotOccurrence[] }).occurrences
    : [];
  const snapshotRecord = isRecord(snapshot) ? snapshot : null;
  const snapshotAcademicRecord = snapshotRecord && isRecord(snapshotRecord.academicSnapshot)
    ? snapshotRecord.academicSnapshot : null;
  const snapshotContext = snapshotRecord ? readContext(snapshotRecord.context) : null;
  const snapshotAsOf = snapshotRecord?.asOf;
  const snapshotContractVersion = snapshotRecord?.contractVersion;
  const snapshotSchemaVersion = snapshotRecord?.schemaVersion;
  const snapshotMetadata = snapshotRecord
    && snapshotContext
    && canonicalAsOf(snapshotAsOf)
    && meaningful(snapshotContractVersion)
    && meaningful(snapshotSchemaVersion)
    ? metadata({
      context: snapshotContext,
      asOf: snapshotAsOf,
      contractVersion: snapshotContractVersion,
      schemaVersion: snapshotSchemaVersion,
      fingerprint: snapshotAcademicRecord
        && meaningful(snapshotAcademicRecord.snapshotFingerprint)
        ? snapshotAcademicRecord.snapshotFingerprint : null,
      occurrences: sortedOccurrences(all),
    }) : null;

  const manualSnapshot = isRecord(snapshot) && snapshot.status === "MANUAL_REVIEW";
  const validManualShape = manualSnapshot
    && exactKeys(snapshot, [
      "status", "context", "asOf", "contractVersion", "schemaVersion",
      "diagnostics", "occurrences",
    ])
    && structurallyValidContext(snapshot.context)
    && snapshot.contractVersion === DEGREE_EVALUATION_SNAPSHOT_CONTRACT_VERSION
    && snapshot.schemaVersion === DEGREE_EVALUATION_SNAPSHOT_SCHEMA_VERSION
    && canonicalAsOf(snapshot.asOf)
    && structurallyValidOccurrences(snapshot.occurrences)
    && Array.isArray(snapshot.diagnostics);
  if (validManualShape) {
    const source = isRecord(snapshot) && Array.isArray(all) ? all : [];
    const rawDiagnostics = isRecord(snapshot) && Array.isArray(snapshot.diagnostics)
      ? snapshot.diagnostics : [];
    const diagnostics = rawDiagnostics.map((item) => {
      const row = isRecord(item) ? item : {};
      const reason = typeof row.reason === "string" ? row.reason : "MALFORMED_SNAPSHOT_DIAGNOSTIC";
      const ids = Array.isArray(row.ids)
        && row.ids.every((id) => typeof id === "string")
        ? [...row.ids] as string[]
        : idsOf(isRecord(row) ? [row] : []);
      return {
        stage: "INTEGRATION" as const,
        reason,
        code: reason,
        ids: Object.freeze(ids),
        occurrences: sortedOccurrences(source),
      };
    });
    if (diagnostics.length === 0) diagnostics.push(diagnostic("INVALID_SNAPSHOT_STATUS", [], source));
    return manual(diagnostics, snapshotMetadata);
  }
  const acceptedShape = isRecord(snapshot)
    && snapshot.status === "ACCEPTED"
    && exactKeys(snapshot, SNAPSHOT_KEYS)
    && structurallyValidContext(snapshot.context)
    && canonicalAsOf(snapshot.asOf)
    && snapshot.contractVersion === DEGREE_EVALUATION_SNAPSHOT_CONTRACT_VERSION
    && snapshot.schemaVersion === DEGREE_EVALUATION_SNAPSHOT_SCHEMA_VERSION
    && structurallyValidOccurrences(snapshot.occurrences)
    && isAcceptedAcademicSnapshot(snapshot.academicSnapshot)
    && exactKeys(snapshot.academicSnapshot, ACADEMIC_KEYS)
    && structurallyValidContext(snapshot.academicSnapshot.context)
    && snapshot.academicSnapshot.contractVersion === DEGREE_EVALUATION_SNAPSHOT_CONTRACT_VERSION
    && snapshot.academicSnapshot.schemaVersion === DEGREE_EVALUATION_SNAPSHOT_SCHEMA_VERSION
    && snapshot.academicSnapshot.asOf === snapshot.asOf
    && meaningful(snapshot.academicSnapshot.snapshotFingerprint)
    && exactKeys(snapshot.academicSnapshot.inputAccounting, ACCOUNTING_KEYS)
    && snapshot.academicSnapshot.inputAccounting.projectionKind === "INFORMATIONAL_ONLY"
    && structurallyValidOccurrences(snapshot.academicSnapshot.inputAccounting.occurrences);
  if (!acceptedShape) {
    const source = isRecord(snapshot) && Array.isArray(all) ? all : [];
    const invalidReason = manualSnapshot
      && snapshot.contractVersion !== DEGREE_EVALUATION_SNAPSHOT_CONTRACT_VERSION
      ? "INVALID_SNAPSHOT_CONTRACT_VERSION"
      : manualSnapshot
        && snapshot.schemaVersion !== DEGREE_EVALUATION_SNAPSHOT_SCHEMA_VERSION
        ? "INVALID_SNAPSHOT_SCHEMA_VERSION"
        : manualSnapshot && !canonicalAsOf(snapshot.asOf)
          ? "INVALID_SNAPSHOT_AS_OF"
          : manualSnapshot
            ? "INVALID_SNAPSHOT_MANUAL_REVIEW_SHAPE"
            : "INVALID_SNAPSHOT_STATUS";
    return manual([diagnostic(
      invalidReason,
      [snapshot],
      source,
    )], snapshotMetadata);
  }

  const accepted = snapshot as Extract<DegreeEvaluationSnapshotOutput, { status: "ACCEPTED" }>;
  const composition = accepted.compositionInput;
  const failures: DegreeProgressIntegrationDiagnostic[] = [];
  const fail = (reason: string, rows: readonly unknown[], relevant = all) => {
    failures.push(diagnostic(reason, rows, relevant));
  };
  const academic = accepted.academicSnapshot;
  if (!isAcceptedAcademicSnapshot(academic)
    || !exactContext(academic.context, accepted.context)
    || academic.asOf !== accepted.asOf
    || academic.contractVersion !== accepted.contractVersion
    || academic.schemaVersion !== accepted.schemaVersion) {
    fail("SNAPSHOT_METADATA_MISMATCH", [accepted]);
  }
  if (
    !isAcceptedAcademicSnapshot(academic)
    || !sameOccurrences(accepted.occurrences, academic.inputAccounting.occurrences)
  ) {
    fail("SNAPSHOT_OCCURRENCE_ACCOUNTING_MISMATCH", [accepted], all);
  }
  const expectedAcademic = createInformationalAcademicSnapshot({
    context: accepted.context,
    contractVersion: accepted.contractVersion,
    schemaVersion: accepted.schemaVersion,
    asOf: accepted.asOf,
    occurrences: accepted.occurrences,
  });
  const expectedFingerprint = expectedAcademic.projectionKind === "INFORMATIONAL_ONLY"
    && expectedAcademic.status === "ACCEPTED"
    && "snapshotFingerprint" in expectedAcademic
    ? expectedAcademic.snapshotFingerprint
    : null;
  if (expectedFingerprint === null
    || !isAcceptedAcademicSnapshot(academic)
    || academic.snapshotFingerprint !== expectedFingerprint) {
    fail("ACADEMIC_SNAPSHOT_FINGERPRINT_MISMATCH", [accepted], all);
  }
  if (!exactKeys(composition, COMPOSITION_KEYS)
    || !structurallyValidContext(composition.context)
    || !exactContext(composition.context, accepted.context)
    || !Array.isArray(composition.requirements)
    || !Array.isArray(composition.associations)
    || !Array.isArray(composition.programAssignmentRegistry)
    || !Array.isArray(composition.academicRules)
    || !Array.isArray(composition.creditRecords)
    || !Array.isArray(composition.verificationEvents)
    || !Array.isArray(composition.decisions)
    || !Array.isArray(composition.exceptions)
    || !Array.isArray(composition.placements)
    || !Array.isArray(composition.unresolvedConflicts)) {
    fail("MALFORMED_COMPOSITION_INPUT", [composition]);
  } else {
    const requirements = composition.requirements as readonly PlainRecord[];
    const requirementIds = new Set<string>();
    const requirementOccurrences = all.filter((item) => item.occurrenceKind === "requirement");
    const activeRequirementOccurrences = requirementOccurrences.filter((item) => (
      isRecord(item.value) && item.value.active === true
    ));
    const canonicalRequirementIds = new Set<string>();
    for (const item of requirementOccurrences) {
      const raw = isRecord(item.value) ? item.value : null;
      const id = raw?.requirementId ?? raw?.id;
      if (
        !raw
        || raw.active !== true
        || !meaningful(id)
        || item.occurrenceId !== id
        || canonicalRequirementIds.has(id)
        || raw.programVersionId !== accepted.context.programVersionId
        || raw.kind !== "minimum"
        || raw.unit !== "credits"
        || decimalAmount(raw.creditsRequired) === null
      ) {
        fail("INVALID_CANONICAL_REQUIREMENT_OCCURRENCE", raw ? [raw] : [item], [item]);
      } else {
        canonicalRequirementIds.add(id);
      }
    }
    for (const requirement of requirements) {
      const idValue = requirement.requirementId;
      const id = meaningful(idValue) ? idValue : null;
      const claimVersionIds = stringArray(requirement.claimVersionIds)
        ? requirement.claimVersionIds : null;
      const sourceIds = stringArray(requirement.sourceIds)
        ? requirement.sourceIds : null;
      const matches = requirementOccurrences.filter((item) => (
        item.occurrenceId === id
      ));
      if (id === null || requirementIds.has(id)) {
        fail("DUPLICATE_OR_INVALID_REQUIREMENT_IDENTITY", [requirement], matches);
        continue;
      }
      requirementIds.add(id);
      if (claimVersionIds === null || sourceIds === null) {
        fail("MALFORMED_REQUIREMENT_PROVENANCE", [requirement], matches);
        continue;
      }
      if (matches.length !== 1) {
        fail(matches.length === 0 ? "MISSING_REQUIREMENT_OCCURRENCE" : "AMBIGUOUS_REQUIREMENT_OCCURRENCE", [requirement], matches);
        continue;
      }
      const raw = matches[0].value;
      if (!isRecord(raw)
        || (raw.requirementId ?? raw.id) !== id
        || raw.active !== true
        || raw.programVersionId !== accepted.context.programVersionId
        || requirement.programVersionId !== accepted.context.programVersionId
        || raw.kind !== "minimum"
        || raw.unit !== "credits"
        || requirement.kind !== "minimum"
        || requirement.unit !== "credits"
        || decimalAmount(raw.creditsRequired) !== requirement.requiredAmount
        || typeof requirement.requiredAmount !== "string"
        || decimalAmount(requirement.requiredAmount) !== requirement.requiredAmount) {
        fail("INVALID_CANONICAL_REQUIREMENT_SEMANTICS", [requirement, raw], matches);
        continue;
      }
      const claims = occurrenceFor(all, ["claim"], (claim) => (
        claim.claimType === "requirement"
        && claim.subjectType === "requirement"
        && claim.subjectId === id
        && claim.status === "confirmed"
      ));
      if (claims.length !== 1 || !meaningful(claims[0]?.value && (claims[0].value as PlainRecord).currentVersionId)) {
        fail("MISSING_OR_AMBIGUOUS_CURRENT_REQUIREMENT_CLAIM", [requirement], claims);
        continue;
      }
      const claim = claims[0].value as PlainRecord;
      const currentVersionId = claim.currentVersionId as string;
      if (!claimVersionIds.includes(currentVersionId)
        || claimVersionIds.length === 0) {
        fail("MISSING_CURRENT_REQUIREMENT_PROVENANCE", [requirement, claim], claims);
        continue;
      }
      const versions = occurrenceFor(all, ["claimVersion"], (version) => (
        version.id === currentVersionId
        && version.claimId === claim.id
        && version.status === "confirmed"
      ));
      const version = versions[0]?.value as PlainRecord | undefined;
      const projection = version?.normalizedValue;
      if (versions.length !== 1 || !isRecord(projection)
        || projection.projectionKind !== "QUANTITATIVE_REQUIREMENT"
        || projection.kind !== "minimum"
        || projection.unit !== "credits"
        || projection.requiredAmount !== requirement.requiredAmount
        || projection.academicRuleId !== requirement.academicRuleId) {
        fail("INVALID_CURRENT_REQUIREMENT_CLAIM_VERSION", [requirement, claim, version], versions);
        continue;
      }
      if (sourceIds.length === 0
        || claimVersionIds.some((versionId) => (
          !all.some((item) => item.occurrenceKind === "claimVersion"
            && isRecord(item.value) && item.occurrenceId === versionId
            && (item.value as PlainRecord).id === versionId)
        ))
        || sourceIds.some((sourceId) => (
          !all.some((item) => item.occurrenceKind === "evidenceSource"
            && item.occurrenceId === sourceId)
        ))) {
        fail("MISSING_REQUIREMENT_PROVENANCE", [requirement], claims);
      }
      const provenance = occurrenceFor(all, ["requirementProvenance"], (row) => (
        row.requirementId === id
        && row.claimId === claim.id
        && row.claimVersionId === currentVersionId
        && meaningful(row.sourceId)
        && sourceIds.includes(row.sourceId as string)
      ));
      if (provenance.length === 0
        || sourceIds.some((sourceId) => (
          !provenance.some((link) => (link.value as PlainRecord).sourceId === sourceId)
        ))) {
        fail("MISSING_REQUIREMENT_PROVENANCE", [requirement], matches);
      }
      if (requirement.academicRuleId !== null) {
        const ruleMatches = occurrenceFor(all, ["academicRule"], (row) => (
          row.id === requirement.academicRuleId
          && row.programVersionId === accepted.context.programVersionId
        ));
        if (ruleMatches.length !== 1
          || !composition.academicRules.some((rule) => (
            rule.id === requirement.academicRuleId
            && rule.programVersionId === accepted.context.programVersionId
          ))) {
          fail("INVALID_SCOPED_ACADEMIC_RULE", [requirement], ruleMatches);
        }
      }
    }
    for (const item of activeRequirementOccurrences) {
      const raw = item.value as PlainRecord;
      const id = raw.requirementId ?? raw.id;
      const matches = requirements.filter((requirement) => requirement.requirementId === id);
      if (!meaningful(id) || matches.length !== 1) {
        fail("ACTIVE_REQUIREMENT_MAPPING_MISMATCH", [raw], [item]);
      }
    }

    const activePlacements = all.filter((item) => item.occurrenceKind === "studentCreditPlacement"
      && isRecord(item.value) && item.value.status === "active");
    const placementIdentity = (row: PlainRecord) => [
      row.studentCreditDecisionId, row.programAssignmentId,
      row.requirementId, row.academicRuleId ?? "",
    ].join("\u0000");
    const activeKeys = new Set<string>();
    for (const item of activePlacements) {
      const row = item.value as PlainRecord;
      const key = placementIdentity(row);
      if (activeKeys.has(key)) fail("DUPLICATE_ACTIVE_PLACEMENT_IDENTITY", [row], [item]);
      activeKeys.add(key);
    }
    const associations = composition.associations as readonly PlainRecord[];
    const compositionDecisions = composition.decisions as readonly PlainRecord[];
    const compositionRequirements = composition.requirements as readonly PlainRecord[];
    const compositionRules = composition.academicRules as readonly PlainRecord[];
    const associationIdentity = (row: PlainRecord) => [
      row.decisionId, row.requirementId, row.academicRuleId ?? "",
    ].join("\u0000");
    const associationCounts = new Map<string, number>();
    const decisionOccurrences = all.filter((item) => item.occurrenceKind === "decision");
    for (const item of activePlacements) {
      const row = item.value as PlainRecord;
      const decisions = decisionOccurrences.filter((candidate) => (
        isRecord(candidate.value)
        && (candidate.value as PlainRecord).id === row.studentCreditDecisionId
      ));
      if (decisions.length !== 1
        || (decisions[0].value as PlainRecord).programAssignmentId !== row.programAssignmentId) {
        fail("PLACEMENT_DECISION_BINDING_MISMATCH", [row], [item, ...decisions]);
      }
    }
    for (const association of associations) {
      const associationKey = associationIdentity(association);
      associationCounts.set(associationKey, (associationCounts.get(associationKey) ?? 0) + 1);
      const key = placementIdentity({
        studentCreditDecisionId: association.decisionId,
        programAssignmentId: accepted.context.programAssignmentId,
        requirementId: association.requirementId,
        academicRuleId: association.academicRuleId,
      });
      const matches = activePlacements.filter((item) => {
        const row = item.value as PlainRecord;
        return row.studentCreditDecisionId === association.decisionId
          && row.programAssignmentId === accepted.context.programAssignmentId
          && row.requirementId === association.requirementId
          && row.academicRuleId === association.academicRuleId;
      });
      const decisionMatches = compositionDecisions.filter((decision) => (
        decision.id === association.decisionId
        && decision.programAssignmentId === accepted.context.programAssignmentId
      ));
      const requirementMatches = compositionRequirements.filter((requirement) => (
        requirement.requirementId === association.requirementId
        && requirement.academicRuleId === association.academicRuleId
      ));
      const ruleMatches = association.academicRuleId === null
        ? []
        : compositionRules.filter((rule) => (
          rule.id === association.academicRuleId
          && rule.programVersionId === accepted.context.programVersionId
        ));
      if (matches.length !== 1
        || activeKeys.has(key) === false
        || decisionMatches.length !== 1
        || requirementMatches.length !== 1
        || (association.academicRuleId !== null && ruleMatches.length !== 1)) {
        fail("ASSOCIATION_PLACEMENT_MISMATCH", [association], matches);
      }
    }
    for (const [key, count] of associationCounts) {
      if (count > 1) fail("DUPLICATE_ASSOCIATION_IDENTITY", [key], []);
    }
    const associationKeys = new Set(associations.map(associationIdentity));
    for (const item of activePlacements) {
      const row = item.value as PlainRecord;
      const key = [
        row.studentCreditDecisionId, row.requirementId, row.academicRuleId ?? "",
      ].join("\u0000");
      if (!associationKeys.has(key)) {
        fail("MISSING_ACTIVE_PLACEMENT_ASSOCIATION", [item.value], [item]);
      }
    }
  }

  if (failures.length > 0) return manual(failures, snapshotMetadata);
  const canonicalInput = cloneSafe(composition) as DegreeProgressCompositionInput;
  const canonicalContext = readContext(accepted.context);
  const canonicalAsOfValue = canonicalAsOf(accepted.asOf) ? accepted.asOf : null;
  const canonicalContractVersion = meaningful(accepted.contractVersion)
    ? accepted.contractVersion : null;
  const canonicalSchemaVersion = meaningful(accepted.schemaVersion)
    ? accepted.schemaVersion : null;
  const canonicalAcademic = isAcceptedAcademicSnapshot(accepted.academicSnapshot)
    ? accepted.academicSnapshot : null;
  if (
    !canonicalContext
    || canonicalAsOfValue === null
    || canonicalContractVersion === null
    || canonicalSchemaVersion === null
    || canonicalAcademic === null
  ) {
    return manual(
      [diagnostic("INVALID_SNAPSHOT_METADATA", [accepted], all)],
      snapshotMetadata,
    );
  }
  const canonicalMetadata = metadata({
    context: canonicalContext,
    asOf: canonicalAsOfValue,
    contractVersion: canonicalContractVersion,
    schemaVersion: canonicalSchemaVersion,
    occurrences: sortedOccurrences(all),
    fingerprint: canonicalAcademic.snapshotFingerprint,
  });
  const empty = Object.freeze([]) as readonly DegreeProgressIntegrationDiagnostic[];
  return deepFreeze({
    status: "ADAPTED" as const,
    compositionInput: canonicalInput,
    integrationDiagnostics: empty,
    diagnostics: empty,
    snapshot: canonicalMetadata,
  });
}

export function adaptDegreeEvaluationSnapshot(
  input: DegreeEvaluationSnapshotOutput,
): DegreeProgressAdapterOutput {
  try {
    return adaptDegreeEvaluationSnapshotUnsafe(input);
  } catch {
    return manual([diagnostic("MALFORMED_SNAPSHOT_INPUT", [], [])], null);
  }
}
