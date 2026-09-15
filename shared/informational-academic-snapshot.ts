import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";

export type InformationalAcademicJsonPrimitive =
  | null
  | boolean
  | number
  | string;

export type InformationalAcademicJsonValue =
  | InformationalAcademicJsonPrimitive
  | readonly InformationalAcademicJsonValue[]
  | { readonly [key: string]: InformationalAcademicJsonValue };

export interface InformationalAcademicSnapshotContext {
  readonly studentId: string;
  readonly programAssignmentId: string;
  readonly programVersionId: string;
}

export interface InformationalAcademicSnapshotOccurrenceInput {
  readonly occurrenceKind: string;
  readonly occurrenceId: string;
  readonly value: unknown;
}

export interface InformationalAcademicSnapshotInput {
  readonly context: InformationalAcademicSnapshotContext;
  readonly contractVersion: string;
  readonly schemaVersion: string;
  readonly asOf: string;
  readonly occurrences: readonly InformationalAcademicSnapshotOccurrenceInput[];
}

export interface InformationalAcademicSnapshotOccurrence {
  readonly occurrenceKind: string;
  readonly occurrenceId: string;
  readonly value: InformationalAcademicJsonValue;
}

export interface InformationalAcademicSnapshotInputAccounting {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly occurrences: readonly InformationalAcademicSnapshotOccurrence[];
}

export interface InformationalAcademicSnapshotStructuralOccurrence {
  readonly occurrenceKind?: string;
  readonly occurrenceId?: string;
}

export interface InformationalAcademicSnapshotDiagnostic {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly status: "MANUAL_REVIEW";
  readonly reason: string;
  readonly inputAccounting: InformationalAcademicSnapshotStructuralAccounting;
}

export interface InformationalAcademicSnapshotStructuralAccounting {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly occurrences: readonly InformationalAcademicSnapshotStructuralOccurrence[];
}

export interface InformationalAcademicSnapshotSuccess {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly status: "ACCEPTED";
  readonly context: InformationalAcademicSnapshotContext;
  readonly contractVersion: string;
  readonly schemaVersion: string;
  readonly asOf: string;
  readonly inputAccounting: InformationalAcademicSnapshotInputAccounting;
  readonly snapshotFingerprint: string;
}

export interface InformationalAcademicSnapshotRejection {
  readonly projectionKind: "INFORMATIONAL_ONLY";
  readonly status: "MANUAL_REVIEW";
  readonly diagnostics: readonly InformationalAcademicSnapshotDiagnostic[];
  readonly inputAccounting: InformationalAcademicSnapshotStructuralAccounting;
}

export type InformationalAcademicSnapshotOutput =
  | InformationalAcademicSnapshotSuccess
  | InformationalAcademicSnapshotRejection;

type RecordView = {
  readonly keys: readonly string[];
  readonly descriptors: Readonly<Record<string, PropertyDescriptor>>;
};

type OccurrenceArrayInspection = {
  readonly valid: boolean;
  readonly reason: string | undefined;
  readonly values: readonly unknown[];
};

type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

const projectionKind = "INFORMATIONAL_ONLY" as const;
const manualReview = "MANUAL_REVIEW" as const;
const inputKeys = [
  "context",
  "contractVersion",
  "schemaVersion",
  "asOf",
  "occurrences",
] as const;
const contextKeys = [
  "studentId",
  "programAssignmentId",
  "programVersionId",
] as const;
const occurrenceKeys = ["occurrenceKind", "occurrenceId", "value"] as const;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function meaningful(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isProxy(value: unknown): boolean {
  try {
    return nodeTypes.isProxy(value);
  } catch {
    return true;
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
  for (const key of Reflect.ownKeys(value as object)) {
    const descriptor = Object.getOwnPropertyDescriptor(value as object, key);
    if (descriptor && "value" in descriptor) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function inspectRecord(
  value: unknown,
  requiredKeys?: readonly string[],
): ParseResult<RecordView> {
  if (
    isProxy(value)
    || value === null
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    return { ok: false, reason: "MALFORMED_INPUT" };
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return { ok: false, reason: "MALFORMED_INPUT" };
    }
    const ownKeys = Reflect.ownKeys(value);
    const keys: string[] = [];
    const descriptors: Record<string, PropertyDescriptor> = Object.create(null);
    for (const key of ownKeys) {
      if (typeof key !== "string") {
        return { ok: false, reason: "MALFORMED_INPUT" };
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return { ok: false, reason: "MALFORMED_INPUT" };
      }
      keys.push(key);
      descriptors[key] = descriptor;
    }
    if (
      requiredKeys
      && (
        keys.length !== requiredKeys.length
        || requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(descriptors, key))
      )
    ) {
      return { ok: false, reason: "MALFORMED_INPUT" };
    }
    return { ok: true, value: { keys, descriptors } };
  } catch {
    return { ok: false, reason: "MALFORMED_INPUT" };
  }
}

function inspectOccurrenceArray(value: unknown): OccurrenceArrayInspection {
  const invalid = (values: readonly unknown[] = []): OccurrenceArrayInspection => ({
    valid: false,
    reason: "INVALID_OCCURRENCES",
    values,
  });
  if (isProxy(value) || !Array.isArray(value)) {
    return invalid();
  }
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      return invalid();
    }
    const ownKeys = Reflect.ownKeys(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor
      || !("value" in lengthDescriptor)
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
    ) {
      return invalid();
    }
    const length = lengthDescriptor.value;
    if (ownKeys.length !== length + 1) {
      return invalid();
    }
    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor
        || !descriptor.enumerable
        || !("value" in descriptor)
      ) {
        return invalid(values);
      }
      values.push(descriptor.value);
    }
    for (const key of ownKeys) {
      if (
        typeof key !== "string"
        || (key !== "length"
          && (
            !/^(0|[1-9]\d*)$/.test(key)
            || Number(key) >= length
          ))
      ) {
        return invalid(values);
      }
    }
    return { valid: true, reason: undefined, values };
  } catch {
    return invalid();
  }
}

function descriptorValue(view: RecordView, key: string): unknown {
  const descriptor = view.descriptors[key];
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function hasOwn(view: RecordView, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(view.descriptors, key);
}

function canonicalJson(value: InformationalAcademicJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Object.is(value, -0) ? "0" : JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const object = value as { readonly [key: string]: InformationalAcademicJsonValue };
  const keys = Object.keys(object).sort(compareStrings);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function jsonRecord(
  entries: readonly (readonly [string, InformationalAcademicJsonValue])[],
): InformationalAcademicJsonValue {
  const record: Record<string, InformationalAcademicJsonValue> = Object.create(null);
  for (const [key, value] of entries) {
    Object.defineProperty(record, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    });
  }
  return record;
}

function validateJson(
  value: unknown,
  ancestors = new Set<object>(),
): ParseResult<InformationalAcademicJsonValue> {
  if (value === null) return { ok: true, value };
  if (typeof value === "string" || typeof value === "boolean") {
    return { ok: true, value };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { ok: false, reason: "INVALID_JSON_VALUE" };
    return { ok: true, value: Object.is(value, -0) ? 0 : value };
  }
  if (
    typeof value === "undefined"
    || typeof value === "function"
    || typeof value === "symbol"
    || typeof value === "bigint"
    || typeof value !== "object"
  ) {
    return { ok: false, reason: "INVALID_JSON_VALUE" };
  }
  if (isProxy(value)) return { ok: false, reason: "INVALID_JSON_VALUE" };
  if (ancestors.has(value)) return { ok: false, reason: "INVALID_JSON_VALUE" };
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        return { ok: false, reason: "INVALID_JSON_VALUE" };
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor)) {
        return { ok: false, reason: "INVALID_JSON_VALUE" };
      }
      const length = lengthDescriptor.value;
      if (!Number.isSafeInteger(length) || length < 0) {
        return { ok: false, reason: "INVALID_JSON_VALUE" };
      }
      const ownKeys = Reflect.ownKeys(value);
      for (const key of ownKeys) {
        if (typeof key !== "string") {
          return { ok: false, reason: "INVALID_JSON_VALUE" };
        }
        if (key === "length") continue;
        if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length) {
          return { ok: false, reason: "INVALID_JSON_VALUE" };
        }
      }
      const output: InformationalAcademicJsonValue[] = [];
      for (let index = 0; index < length; index += 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          return { ok: false, reason: "INVALID_JSON_VALUE" };
        }
        const child = validateJson(descriptor.value, ancestors);
        if (!child.ok) return child;
        output.push(child.value);
      }
      return { ok: true, value: output };
    }

    const record = inspectRecord(value);
    if (!record.ok) return { ok: false, reason: "INVALID_JSON_VALUE" };
    const output: Record<string, InformationalAcademicJsonValue> = Object.create(null);
    const orderedKeys = [...record.value.keys].sort(compareStrings);
    for (const key of orderedKeys) {
      const child = validateJson(descriptorValue(record.value, key), ancestors);
      if (!child.ok) return child;
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: child.value,
      });
    }
    return { ok: true, value: output };
  } catch {
    return { ok: false, reason: "INVALID_JSON_VALUE" };
  } finally {
    ancestors.delete(value);
  }
}

function readStructuralOccurrence(value: unknown): InformationalAcademicSnapshotStructuralOccurrence {
  const result: Record<string, string> = Object.create(null);
  if (isProxy(value) || value === null || typeof value !== "object") return result;
  try {
    const ownKeys = Reflect.ownKeys(value);
    for (const key of ["occurrenceKind", "occurrenceId"] as const) {
      if (!ownKeys.includes(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && descriptor.enumerable && "value" in descriptor
        && typeof descriptor.value === "string") {
        result[key] = descriptor.value;
      }
    }
  } catch {
    return Object.create(null);
  }
  return result;
}

function structuralAccounting(
  occurrences: unknown,
): InformationalAcademicSnapshotStructuralAccounting {
  const entries: InformationalAcademicSnapshotStructuralOccurrence[] = [];
  const inspected = inspectOccurrenceArray(occurrences);
  for (const value of inspected.values) {
    entries.push(readStructuralOccurrence(value));
  }
  entries.sort((left, right) => compareStrings(
    canonicalStructuralOccurrence(left),
    canonicalStructuralOccurrence(right),
  ));
  return {
    projectionKind,
    occurrences: entries,
  };
}

function rejection(
  reasons: readonly string[],
  occurrences: unknown,
): InformationalAcademicSnapshotRejection {
  const inputAccounting = structuralAccounting(occurrences);
  const uniqueReasons = [...new Set(reasons)].sort(compareStrings);
  const diagnostics = uniqueReasons.map((reason) => ({
    projectionKind,
    status: manualReview,
    reason,
    inputAccounting,
  }));
  return deepFreeze({
    projectionKind,
    status: manualReview,
    diagnostics,
    inputAccounting,
  });
}

function canonicalOccurrence(
  occurrence: InformationalAcademicSnapshotOccurrence,
): string {
  return canonicalJson(jsonRecord([
    ["occurrenceKind", occurrence.occurrenceKind],
    ["occurrenceId", occurrence.occurrenceId],
    ["value", occurrence.value],
  ]));
}

function canonicalStructuralOccurrence(
  occurrence: InformationalAcademicSnapshotStructuralOccurrence,
): string {
  const entries: [string, InformationalAcademicJsonValue][] = [];
  if (typeof occurrence.occurrenceKind === "string") {
    entries.push(["occurrenceKind", occurrence.occurrenceKind]);
  }
  if (typeof occurrence.occurrenceId === "string") {
    entries.push(["occurrenceId", occurrence.occurrenceId]);
  }
  return canonicalJson(jsonRecord(entries));
}

function validAsOf(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function parseOccurrence(
  value: unknown,
): ParseResult<InformationalAcademicSnapshotOccurrence> {
  const view = inspectRecord(value, occurrenceKeys);
  if (!view.ok) return { ok: false, reason: "INVALID_OCCURRENCE_IDENTITY" };
  const occurrenceKind = descriptorValue(view.value, "occurrenceKind");
  const occurrenceId = descriptorValue(view.value, "occurrenceId");
  if (!meaningful(occurrenceKind) || !meaningful(occurrenceId)) {
    return { ok: false, reason: "INVALID_OCCURRENCE_IDENTITY" };
  }
  const json = validateJson(descriptorValue(view.value, "value"));
  if (!json.ok) return json;
  return {
    ok: true,
    value: {
      occurrenceKind,
      occurrenceId,
      value: json.value,
    },
  };
}

export function createInformationalAcademicSnapshot(
  input: InformationalAcademicSnapshotInput,
): InformationalAcademicSnapshotOutput {
  try {
    const reasons: string[] = [];
    const inputView = inspectRecord(input, inputKeys);
    if (!inputView.ok) return rejection([inputView.reason], undefined);

    const contextView = inspectRecord(
      descriptorValue(inputView.value, "context"),
      contextKeys,
    );
    let context: InformationalAcademicSnapshotContext | undefined;
    if (contextView.ok) {
      const studentId = descriptorValue(contextView.value, "studentId");
      const programAssignmentId = descriptorValue(
        contextView.value,
        "programAssignmentId",
      );
      const programVersionId = descriptorValue(contextView.value, "programVersionId");
      if (
        meaningful(studentId)
        && meaningful(programAssignmentId)
        && meaningful(programVersionId)
      ) {
        context = { studentId, programAssignmentId, programVersionId };
      }
    }
    if (!context) {
      reasons.push("INVALID_CONTEXT_IDENTITY");
    }

    const contractVersionValue = descriptorValue(inputView.value, "contractVersion");
    const schemaVersionValue = descriptorValue(inputView.value, "schemaVersion");
    const contractVersion = meaningful(contractVersionValue)
      ? contractVersionValue
      : undefined;
    const schemaVersion = meaningful(schemaVersionValue)
      ? schemaVersionValue
      : undefined;
    if (!contractVersion || !schemaVersion) {
      reasons.push("INVALID_VERSION");
    }

    const asOf = descriptorValue(inputView.value, "asOf");
    const normalizedAsOf = validAsOf(asOf) ? asOf : undefined;
    if (!normalizedAsOf) reasons.push("INVALID_AS_OF");

    const occurrences = descriptorValue(inputView.value, "occurrences");
    const occurrenceArray = inspectOccurrenceArray(occurrences);
    const normalized: InformationalAcademicSnapshotOccurrence[] = [];
    if (!occurrenceArray.valid) {
      reasons.push(occurrenceArray.reason ?? "INVALID_OCCURRENCES");
    } else {
      for (const item of occurrenceArray.values) {
        const parsed = parseOccurrence(item);
        if (!parsed.ok) reasons.push(parsed.reason);
        else normalized.push(parsed.value);
      }
    }

    if (reasons.length > 0) return rejection(reasons, occurrences);
    if (
      !context
      || !contractVersion
      || !schemaVersion
      || !normalizedAsOf
      || !occurrenceArray.valid
    ) {
      return rejection(["MALFORMED_INPUT"], occurrences);
    }

    normalized.sort((left, right) => (
      compareStrings(canonicalOccurrence(left), canonicalOccurrence(right))
    ));
    const frozenOccurrences = normalized.map((item) => ({
      occurrenceKind: item.occurrenceKind,
      occurrenceId: item.occurrenceId,
      value: item.value,
    }));
    const fingerprintOccurrences = frozenOccurrences.map((item) => jsonRecord([
      ["occurrenceKind", item.occurrenceKind],
      ["occurrenceId", item.occurrenceId],
      ["value", item.value],
    ]));
    const fingerprintContent = jsonRecord([
      ["context", jsonRecord([
        ["studentId", context.studentId],
        ["programAssignmentId", context.programAssignmentId],
        ["programVersionId", context.programVersionId],
      ])],
      ["contractVersion", contractVersion],
      ["schemaVersion", schemaVersion],
      ["occurrences", fingerprintOccurrences],
    ]);
    const snapshotFingerprint = `sha256:${createHash("sha256")
      .update(canonicalJson(fingerprintContent))
      .digest("hex")}`;
    return deepFreeze({
      projectionKind,
      status: "ACCEPTED" as const,
      context,
      contractVersion,
      schemaVersion,
      asOf: normalizedAsOf,
      inputAccounting: {
        projectionKind,
        occurrences: frozenOccurrences,
      },
      snapshotFingerprint,
    });
  } catch {
    return rejection(["MALFORMED_INPUT"], undefined);
  }
}