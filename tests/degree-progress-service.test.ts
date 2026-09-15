import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  adaptDegreeEvaluationSnapshot,
  DEGREE_PROGRESS_ADAPTER_CONTRACT_VERSION,
  DEGREE_PROGRESS_ADAPTER_SCHEMA_VERSION,
} from "../shared/degree-progress-adapter";
import {
  getDegreeProgress,
  type DegreeProgressServiceOptions,
} from "../server/services/degree-progress-service";
import {
  assembleDegreeEvaluationSnapshot,
  type DegreeEvaluationRawBundle,
  type DegreeEvaluationSnapshotOutput,
} from "../shared/degree-evaluation-snapshot";
import { createInformationalAcademicSnapshot } from "../shared/informational-academic-snapshot";
import { composeDegreeProgress } from "../shared/degree-progress-composition";

const context = {
  studentId: "student-1",
  programAssignmentId: "assignment-1",
  programVersionId: "program-version-1",
} as const;
const asOf = "2025-01-01T00:00:00.000Z";

function rawFacts(): DegreeEvaluationRawBundle {
  return {
    assignments: [{
      id: "assignment-1", studentId: "student-1",
      programVersionId: "program-version-1", status: "active",
    }],
    programVersions: [{ id: "program-version-1" }],
    requirements: [{
      id: "requirement-1", programVersionId: "program-version-1",
      active: true, creditsRequired: 3, kind: "minimum", unit: "credits",
    }],
    requirementProvenance: [{
      requirementId: "requirement-1", claimId: "claim-1",
      claimVersionId: "claim-version-1", sourceId: "source-1",
    }],
    claims: [{
      id: "claim-1", claimType: "requirement", subjectType: "requirement",
      subjectId: "requirement-1", currentVersionId: "claim-version-1",
      status: "confirmed",
    }],
    claimVersions: [{
      id: "claim-version-1", claimId: "claim-1", status: "confirmed",
      normalizedValue: {
        projectionKind: "QUANTITATIVE_REQUIREMENT",
        kind: "minimum", unit: "credits", requiredAmount: "3",
        academicRuleId: null,
      },
    }],
    claimEvidence: [{
      claimVersionId: "claim-version-1", evidenceExcerptId: "excerpt-1",
      relationshipType: "supports",
    }],
    evidenceExcerpts: [{
      id: "excerpt-1", evidenceSourceId: "source-1",
      excerptText: "three credits",
    }],
    evidenceSources: [{ id: "source-1", title: "catalog" }],
    academicRules: [],
    conflicts: [],
    creditRecords: [{
      id: "credit-1", studentId: "student-1",
      sourceId: "academic-source-1", status: "verified",
    }],
    academicSources: [{ id: "academic-source-1", studentId: "student-1" }],
    verificationEvents: [{
      id: "verification-1", creditRecordId: "credit-1", seq: 1, action: "verified",
    }],
    decisions: [{
      id: "decision-1", creditRecordId: "credit-1",
      programAssignmentId: "assignment-1", seq: 1, action: "accepted",
      creditsAwarded: "3", basisClaimVersionId: null,
      equivalencyId: null, targetInstitutionCourseVersionId: null,
    }],
    placements: [{
      id: "placement-1", studentCreditDecisionId: "decision-1",
      programAssignmentId: "assignment-1", requirementId: "requirement-1",
      academicRuleId: null, status: "active",
    }, {
      id: "placement-old", studentCreditDecisionId: "decision-1",
      programAssignmentId: "assignment-1", requirementId: "requirement-1",
      academicRuleId: null, status: "revoked",
    }],
    exceptions: [],
  };
}

function accepted(): Extract<DegreeEvaluationSnapshotOutput, { status: "ACCEPTED" }> {
  const output = assembleDegreeEvaluationSnapshot({ context, asOf, facts: rawFacts() });
  expect(output.status).toBe("ACCEPTED");
  if (output.status !== "ACCEPTED") throw new Error("fixture was not accepted");
  return output;
}

function acceptedWithAmount(amount: number | string) {
  const facts = rawFacts();
  facts.requirements = [{ ...facts.requirements[0], creditsRequired: amount }];
  facts.claimVersions = [{
    ...facts.claimVersions[0],
    normalizedValue: {
      projectionKind: "QUANTITATIVE_REQUIREMENT",
      kind: "minimum", unit: "credits", requiredAmount: String(amount),
      academicRuleId: null,
    },
  }];
  return assembleDegreeEvaluationSnapshot({ context, asOf, facts }) as Extract<
    DegreeEvaluationSnapshotOutput, { status: "ACCEPTED" }
  >;
}

function adapted(snapshot = accepted()) {
  return adaptDegreeEvaluationSnapshot(snapshot);
}

function realComposed(snapshot = accepted()) {
  const output = adapted(snapshot);
  expect(output.status).toBe("ADAPTED");
  if (output.status !== "ADAPTED") throw new Error("fixture was not adapted");
  const composed = composeDegreeProgress(output.compositionInput);
  expect(composed.compositionKind).toBe("COMPOSED");
  return composed;
}

function freezeFixture<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const key of Reflect.ownKeys(value as object)) {
    const descriptor = Object.getOwnPropertyDescriptor(value as object, key);
    if (descriptor && "value" in descriptor) freezeFixture(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function occurrence(snapshot: Extract<DegreeEvaluationSnapshotOutput, { status: "ACCEPTED" }>, kind: string) {
  return snapshot.occurrences.find((item) => item.occurrenceKind === kind);
}

function resealOccurrences(
  snapshot: Extract<DegreeEvaluationSnapshotOutput, { status: "ACCEPTED" }>,
  occurrences: readonly (typeof snapshot.occurrences[number])[],
): Extract<DegreeEvaluationSnapshotOutput, { status: "ACCEPTED" }> {
  const academic = createInformationalAcademicSnapshot({
    context: snapshot.context,
    contractVersion: snapshot.contractVersion,
    schemaVersion: snapshot.schemaVersion,
    asOf: snapshot.asOf,
    occurrences,
  });
  expect(academic.status).toBe("ACCEPTED");
  if (academic.status !== "ACCEPTED") throw new Error("fixture was not accepted");
  return { ...snapshot, occurrences, academicSnapshot: academic };
}

function withOccurrence(
  snapshot: Extract<DegreeEvaluationSnapshotOutput, { status: "ACCEPTED" }>,
  kind: string,
  value: unknown,
) {
  const target = occurrence(snapshot, kind);
  if (!target) throw new Error(`missing ${kind}`);
  return resealOccurrences(snapshot, snapshot.occurrences.map((item) => (
      item === target ? { ...item, value } : item
    )));
}

describe("Phase 4D/4E degree progress integration", () => {
  it("exports adapter contract versions and adapts the exact 4C boundary", () => {
    const result = adapted();
    expect(DEGREE_PROGRESS_ADAPTER_CONTRACT_VERSION).toBeTypeOf("string");
    expect(DEGREE_PROGRESS_ADAPTER_SCHEMA_VERSION).toBeTypeOf("string");
    expect(result.status).toBe("ADAPTED");
    if (result.status === "ADAPTED") {
      expect(result.compositionInput.context).toEqual(context);
      expect(result.snapshot.fingerprint).toBe(accepted().academicSnapshot.snapshotFingerprint);
    }
  });

  it("preserves canonical occurrences and every Phase 3 array", () => {
    const result = adapted();
    expect(result.status).toBe("ADAPTED");
    if (result.status === "ADAPTED") {
      expect(result.snapshot.occurrences).toHaveLength(accepted().occurrences.length);
      expect(result.compositionInput.verificationEvents).toHaveLength(1);
      expect(result.compositionInput.decisions).toHaveLength(1);
      expect(result.compositionInput.associations).toEqual([{
        decisionId: "decision-1", requirementId: "requirement-1", academicRuleId: null,
      }]);
    }
  });

  it("accepts exact supported minimum-credit requirements", () => {
    expect(adapted().status).toBe("ADAPTED");
  });

  it.each([3.5, 0.25, "3.5", "0.25"])("accepts canonical fractional amount %s", (amount) => {
    expect(adapted(acceptedWithAmount(amount)).status).toBe("ADAPTED");
  });

  it.each([
    ["negative", -1],
    ["exponent", "3e0"],
    ["whitespace", " 3"],
    ["too many fractional digits", 3.141],
    ["infinity", Number.POSITIVE_INFINITY],
    ["NaN", Number.NaN],
    ["string mismatch", "03"],
  ])("rejects malformed requirement amount: %s", (_name, amount) => {
    const snapshot = accepted();
    const occurrences = snapshot.occurrences.map((item) => (
      item.occurrenceKind === "requirement"
        ? { ...item, value: { ...(item.value as object), creditsRequired: amount } }
        : item
    ));
    const result = Number.isFinite(amount)
      ? adaptDegreeEvaluationSnapshot(resealOccurrences(snapshot, occurrences))
      : adaptDegreeEvaluationSnapshot({ ...snapshot, occurrences });
    expect(result.status).toBe("MANUAL_REVIEW");
  });

  it.each([
    ["kind", { kind: "maximum", unit: "credits" }],
    ["unit", { kind: "minimum", unit: "hours" }],
  ])("rejects unsupported requirement %s", (_name, change) => {
    const snapshot = accepted();
    const result = adaptDegreeEvaluationSnapshot(resealOccurrences(snapshot,
      snapshot.occurrences.map((item) => (
        item.occurrenceKind === "requirement"
          ? { ...item, value: { ...(item.value as object), ...change } }
          : item
      )),
    ));
    expect(result.status).toBe("MANUAL_REVIEW");
    if (result.status === "MANUAL_REVIEW") {
      expect(result.integrationDiagnostics[0].reason).toBe("INVALID_CANONICAL_REQUIREMENT_OCCURRENCE");
      expect(result.integrationDiagnostics[0].code).toBe("INVALID_CANONICAL_REQUIREMENT_OCCURRENCE");
    }
  });

  it("rejects missing current claim provenance", () => {
    const snapshot = accepted();
    const result = withOccurrence(snapshot, "claim", {
      ...(occurrence(snapshot, "claim")!.value as object), currentVersionId: null,
    });
    expect(adaptDegreeEvaluationSnapshot(result).status).toBe("MANUAL_REVIEW");
  });

  it("rejects missing and duplicate canonical requirement occurrences", () => {
    const snapshot = accepted();
    const missing = {
      ...snapshot,
      occurrences: snapshot.occurrences.filter((item) => item.occurrenceKind !== "requirement"),
    };
    const missingResult = adaptDegreeEvaluationSnapshot(resealOccurrences(
      snapshot, missing.occurrences,
    ));
    expect(missingResult.status).toBe("MANUAL_REVIEW");
    if (missingResult.status === "MANUAL_REVIEW") {
      expect(missingResult.integrationDiagnostics[0].reason).toBe("MISSING_REQUIREMENT_OCCURRENCE");
    }
    const req = occurrence(snapshot, "requirement")!;
    const duplicateResult = adaptDegreeEvaluationSnapshot(resealOccurrences(
      snapshot, [...snapshot.occurrences, req],
    ));
    expect(duplicateResult.status).toBe("MANUAL_REVIEW");
    if (duplicateResult.status === "MANUAL_REVIEW") {
      expect(duplicateResult.integrationDiagnostics[0].reason).toBe("AMBIGUOUS_REQUIREMENT_OCCURRENCE");
    }
  });

  it("cross-checks active placement association identity exactly", () => {
    const snapshot = accepted();
    const result = adapted();
    expect(result.status).toBe("ADAPTED");
    if (result.status === "ADAPTED") {
      expect(result.compositionInput.associations[0]).toEqual({
        decisionId: "decision-1", requirementId: "requirement-1", academicRuleId: null,
      });
    }
    const placement = occurrence(snapshot, "studentCreditPlacement")!;
    const inconsistent = adaptDegreeEvaluationSnapshot(resealOccurrences(snapshot,
      snapshot.occurrences.map((item) => (
        item === placement
          ? { ...item, value: { ...(item.value as object), requirementId: "other" } }
          : item
      )),
    ));
    expect(inconsistent.status).toBe("MANUAL_REVIEW");
    if (inconsistent.status === "MANUAL_REVIEW") {
      expect(inconsistent.integrationDiagnostics[0].reason).toBe("ASSOCIATION_PLACEMENT_MISMATCH");
    }
  });

  it("rejects inactive, missing, inconsistent, and duplicate active associations", () => {
    const snapshot = accepted();
    const placement = occurrence(snapshot, "studentCreditPlacement")!;
    const inactive = {
      ...snapshot,
      compositionInput: {
        ...snapshot.compositionInput,
        associations: [],
      },
    };
    const inactiveResult = adaptDegreeEvaluationSnapshot(inactive);
    expect(inactiveResult.status).toBe("MANUAL_REVIEW");
    if (inactiveResult.status === "MANUAL_REVIEW") {
      expect(inactiveResult.integrationDiagnostics[0].reason).toBe("MISSING_ACTIVE_PLACEMENT_ASSOCIATION");
    }
    const missing = adaptDegreeEvaluationSnapshot(resealOccurrences(
      snapshot, snapshot.occurrences.filter((item) => item !== placement),
    ));
    expect(missing.status).toBe("MANUAL_REVIEW");
    if (missing.status === "MANUAL_REVIEW") {
      expect(missing.integrationDiagnostics[0].reason).toBe("ASSOCIATION_PLACEMENT_MISMATCH");
    }
    const duplicate = adaptDegreeEvaluationSnapshot({
      ...snapshot,
      compositionInput: {
        ...snapshot.compositionInput,
        associations: [
          ...snapshot.compositionInput.associations,
          snapshot.compositionInput.associations[0],
        ],
      },
    });
    expect(duplicate.status).toBe("MANUAL_REVIEW");
    if (duplicate.status === "MANUAL_REVIEW") {
      expect(duplicate.integrationDiagnostics[0].reason).toBe("DUPLICATE_ASSOCIATION_IDENTITY");
    }
  });

  it("preserves verification and decision history multiplicity", () => {
    const snapshot = accepted();
    const input = {
      ...snapshot.compositionInput,
      verificationEvents: [
        ...snapshot.compositionInput.verificationEvents,
        { ...snapshot.compositionInput.verificationEvents[0], id: "verification-history" },
      ],
      decisions: [
        ...snapshot.compositionInput.decisions,
        { ...snapshot.compositionInput.decisions[0], id: "decision-history", seq: 2 },
      ],
    };
    const result = adaptDegreeEvaluationSnapshot({ ...snapshot, compositionInput: input });
    expect(result.status).toBe("ADAPTED");
    if (result.status === "ADAPTED") {
      expect(result.compositionInput.verificationEvents).toHaveLength(2);
      expect(result.compositionInput.decisions).toHaveLength(2);
    }
  });

  it("preserves nontrivial Phase 3 array and nested array order exactly", () => {
    const snapshot = accepted();
    const input = {
      ...snapshot.compositionInput,
      verificationEvents: [
        { ...snapshot.compositionInput.verificationEvents[0], id: "verification-z" },
        { ...snapshot.compositionInput.verificationEvents[0], id: "verification-a" },
      ],
      decisions: [
        { ...snapshot.compositionInput.decisions[0], id: "decision-z" },
        { ...snapshot.compositionInput.decisions[0], id: "decision-1" },
      ],
      unresolvedConflicts: [{
        conflictId: "conflict-z", requirementId: "requirement-1", academicRuleId: null,
        status: "open", sourceIds: ["source-z", "source-a"],
        claimVersionIds: ["version-z", "version-a"],
      }],
      exceptions: [{
        id: "exception-z", studentId: "student-1", programAssignmentId: "assignment-1",
        exceptionType: "other", status: "revoked", requirementId: null, academicRuleId: null,
        creditRecordId: null, supersedesExceptionId: null, approvedBy: null,
        rationale: "recorded", effectiveFrom: null, effectiveTo: null,
        metadata: { nested: ["z", "a"] }, createdAt: new Date(asOf),
      }],
    };
    const result = adaptDegreeEvaluationSnapshot({ ...snapshot, compositionInput: input });
    expect(result.status).toBe("ADAPTED");
    if (result.status === "ADAPTED") {
      expect(result.compositionInput.verificationEvents.map((row) => row.id))
        .toEqual(["verification-z", "verification-a"]);
      expect(result.compositionInput.decisions.map((row) => row.id))
        .toEqual(["decision-z", "decision-1"]);
      expect(result.compositionInput.unresolvedConflicts[0].sourceIds)
        .toEqual(["source-z", "source-a"]);
      expect((result.compositionInput.exceptions[0].metadata as { nested: string[] }).nested)
        .toEqual(["z", "a"]);
    }
  });

  it("preserves unresolved conflicts without selecting a winner", () => {
    const snapshot = accepted();
    const conflict = {
      conflictId: "conflict-1", requirementId: "requirement-1",
      academicRuleId: null, status: "open",
      sourceIds: ["source-1"], claimVersionIds: ["claim-version-1", "claim-version-2"],
    };
    const result = adapted({
      ...snapshot,
      compositionInput: {
        ...snapshot.compositionInput, unresolvedConflicts: [conflict],
      },
    });
    expect(result.status).toBe("ADAPTED");
    if (result.status === "ADAPTED") {
      expect(result.compositionInput.unresolvedConflicts).toEqual([conflict]);
    }
  });

  it("passes exceptions and exception placements through without effects", () => {
    const snapshot = accepted();
    const exception = {
      id: "exception-1", studentId: "student-1",
      programAssignmentId: "assignment-1", exceptionType: "other",
      status: "active", requirementId: "requirement-1", academicRuleId: null,
      creditRecordId: null, supersedesExceptionId: null, approvedBy: null,
      rationale: "recorded", effectiveFrom: null, effectiveTo: null,
      metadata: {}, createdAt: new Date(asOf),
    } as const;
    const placement = {
      exceptionId: "exception-1", requirementId: "requirement-1",
      academicRuleId: null, creditRecordId: null, evidenceId: null,
    } as const;
    const result = adapted({
      ...snapshot,
      compositionInput: { ...snapshot.compositionInput, exceptions: [exception], placements: [placement] },
    });
    expect(result.status).toBe("ADAPTED");
    if (result.status === "ADAPTED") {
      expect(result.compositionInput.exceptions).toEqual([exception]);
      expect(result.compositionInput.placements).toEqual([placement]);
    }
  });

  it("returns snapshot manual review without composing", () => {
    const snapshot = accepted();
    const manual = {
      ...snapshot, status: "MANUAL_REVIEW" as const,
      diagnostics: [{
        status: "MANUAL_REVIEW" as const, reason: "BAD_SNAPSHOT",
        ids: ["requirement-1"], occurrences: snapshot.occurrences,
      }],
    } as DegreeEvaluationSnapshotOutput;
    const composer = vi.fn();
    const result = getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => manual),
      composer,
    });
    return result.then((report) => {
      expect(composer).not.toHaveBeenCalled();
      expect(report.status).toBe("MANUAL_REVIEW");
    });
  });

  it("requires exact accepted status, versions, and all three context boundaries", () => {
    const snapshot = accepted();
    expect(adaptDegreeEvaluationSnapshot({ ...snapshot, status: "OTHER" } as never).status)
      .toBe("MANUAL_REVIEW");
    expect(adaptDegreeEvaluationSnapshot({
      ...snapshot, contractVersion: "wrong",
      academicSnapshot: { ...snapshot.academicSnapshot, contractVersion: "wrong" },
    }).status).toBe("MANUAL_REVIEW");
    expect(adaptDegreeEvaluationSnapshot({
      ...snapshot,
      compositionInput: {
        ...snapshot.compositionInput,
        context: { ...context, studentId: "other-student" },
      },
    }).status).toBe("MANUAL_REVIEW");
  });

  it("requires outer occurrences to exactly match academic accounting and fingerprint", () => {
    const snapshot = accepted();
    const requirement = occurrence(snapshot, "requirement")!;
    const tamperedOuter = adaptDegreeEvaluationSnapshot({
      ...snapshot,
      occurrences: snapshot.occurrences.map((item) => (
        item === requirement
          ? { ...item, value: { ...(item.value as object), creditsRequired: 4 } }
          : item
      )),
    });
    expect(tamperedOuter.status).toBe("MANUAL_REVIEW");
    const tamperedFingerprint = adaptDegreeEvaluationSnapshot({
      ...snapshot,
      academicSnapshot: {
        ...snapshot.academicSnapshot,
        snapshotFingerprint: "sha256:forged",
      },
    });
    expect(tamperedFingerprint.status).toBe("MANUAL_REVIEW");
  });

  it("rejects duplicate occurrence multiplicity even when academic accounting is duplicated", () => {
    const snapshot = accepted();
    const duplicate = snapshot.occurrences[0];
    const occurrences = [...snapshot.occurrences, duplicate];
    const tampered = {
      ...snapshot,
      occurrences,
      academicSnapshot: {
        ...snapshot.academicSnapshot,
        inputAccounting: {
          ...snapshot.academicSnapshot.inputAccounting,
          occurrences,
        },
      },
    };
    expect(adaptDegreeEvaluationSnapshot(tampered).status).toBe("MANUAL_REVIEW");
  });

  it.each([
    ["contractVersion", "wrong"],
    ["schemaVersion", "wrong"],
    ["asOf", "not-an-iso-date"],
  ])("rejects invalid manual-review snapshot %s", (field, value) => {
    const snapshot = accepted();
    const manual = {
      status: "MANUAL_REVIEW" as const,
      context,
      asOf,
      contractVersion: snapshot.contractVersion,
      schemaVersion: snapshot.schemaVersion,
      diagnostics: [{ reason: "BAD_SNAPSHOT", ids: [], occurrences: snapshot.occurrences }],
      occurrences: snapshot.occurrences,
      [field]: value,
    };
    expect(adaptDegreeEvaluationSnapshot(manual as DegreeEvaluationSnapshotOutput).status)
      .toBe("MANUAL_REVIEW");
  });

  it("rejects an extra inactive canonical requirement occurrence", () => {
    const snapshot = accepted();
    const requirement = occurrence(snapshot, "requirement")!;
    const result = adaptDegreeEvaluationSnapshot({
      ...resealOccurrences(snapshot, [...snapshot.occurrences, {
        ...requirement,
        occurrenceId: "requirement-inactive",
        value: { ...(requirement.value as object), id: "requirement-inactive", active: false },
      }]),
    });
    expect(result.status).toBe("MANUAL_REVIEW");
    if (result.status === "MANUAL_REVIEW") {
      expect(result.integrationDiagnostics[0].reason).toBe("INVALID_CANONICAL_REQUIREMENT_OCCURRENCE");
    }
  });

  it("rejects an extra active canonical requirement occurrence omitted from Phase 3", () => {
    const snapshot = accepted();
    const requirement = occurrence(snapshot, "requirement")!;
    const result = adaptDegreeEvaluationSnapshot(resealOccurrences(snapshot, [
      ...snapshot.occurrences, {
        ...requirement,
        occurrenceId: "requirement-extra",
        value: { ...(requirement.value as object), id: "requirement-extra" },
      },
    ]));
    expect(result.status).toBe("MANUAL_REVIEW");
    if (result.status === "MANUAL_REVIEW") {
      expect(result.integrationDiagnostics[0].reason).toBe("ACTIVE_REQUIREMENT_MAPPING_MISMATCH");
    }
  });

  it("composes exactly once and passes the adapter object exactly", async () => {
    const snapshot = accepted();
    const reader = vi.fn(async () => snapshot);
    const composed = realComposed(snapshot);
    const composer = vi.fn(async () => composed);
    const result = await getDegreeProgress(context, { snapshotReader: reader, composer });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(composer).toHaveBeenCalledTimes(1);
    expect(composer.mock.calls[0][0]).toEqual(
      (await Promise.resolve(adapted())).status === "ADAPTED"
        ? (await Promise.resolve(adapted())).compositionInput : undefined,
    );
    expect(result.status).toBe("COMPOSED");
  });

  it("returns composition manual review without retry or fallback", async () => {
    const composer = vi.fn(async () => ({
      projectionKind: "INFORMATIONAL_ONLY" as const,
      compositionKind: "INFORMATIONAL_ONLY" as const,
      status: "MANUAL_REVIEW" as const, context,
      diagnostics: [{ stage: "COMPOSITION" as const, projectionKind: "INFORMATIONAL_ONLY" as const,
        status: "MANUAL_REVIEW" as const, reason: "NOPE", provenance: {} }],
    }));
    const result = await getDegreeProgress(context, { snapshotReader: vi.fn(async () => accepted()), composer });
    expect(composer).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("MANUAL_REVIEW");
  });

  it("converts reader and composer throws to one opaque manual review", async () => {
    const reader = vi.fn(async () => { throw new Error("secret detail"); });
    const result = await getDegreeProgress(context, { snapshotReader: reader });
    expect(result.status).toBe("MANUAL_REVIEW");
    expect(JSON.stringify(result)).not.toContain("secret detail");
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("converts a valid composer throw to one opaque manual review without retry", async () => {
    const composer = vi.fn(() => {
      throw new Error("composer secret");
    });
    const report = await getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => accepted()),
      composer,
    });
    expect(composer).toHaveBeenCalledTimes(1);
    expect(report.status).toBe("MANUAL_REVIEW");
    expect(JSON.stringify(report)).not.toContain("composer secret");
  });

  it("keeps reader, adapter, and composer exactly once and preserves injected identity", async () => {
    const snapshot = accepted();
    const adaptedOutput = adapted(snapshot);
    const reader = vi.fn(async () => snapshot);
    const adapter = vi.fn(() => adaptedOutput);
    const composed = realComposed(snapshot);
    const composer = vi.fn(async () => composed);
    await getDegreeProgress(context, { snapshotReader: reader, adapter, composer });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(composer).toHaveBeenCalledTimes(1);
    expect(composer.mock.calls[0][0]).toBe(adaptedOutput.status === "ADAPTED"
      ? adaptedOutput.compositionInput : undefined);
  });

  it("rejects malformed or accessor adapter output without invoking accessors or composing", async () => {
    let accessed = 0;
    const malformed: Record<string, unknown> = {};
    Object.defineProperty(malformed, "status", {
      enumerable: true,
      get: () => {
        accessed += 1;
        throw new Error("adapter accessor");
      },
    });
    const adapter = vi.fn(() => malformed);
    const composer = vi.fn();
    const report = await getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => accepted()),
      adapter: adapter as DegreeProgressServiceOptions["adapter"],
      composer,
    });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(accessed).toBe(0);
    expect(composer).not.toHaveBeenCalled();
    expect(report.status).toBe("MANUAL_REVIEW");
    expect(report.integrationDiagnostics[0].reason).toBe("INVALID_ADAPTER_OUTPUT");
  });

  it.each([
    {},
    { status: "ADAPTED" },
    { status: "MANUAL_REVIEW", integrationDiagnostics: [], diagnostics: [], snapshot: null, extra: true },
  ])("rejects malformed adapter output shape %j", async (value) => {
    const adapter = vi.fn(() => value);
    const composer = vi.fn();
    const report = await getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => accepted()),
      adapter: adapter as DegreeProgressServiceOptions["adapter"],
      composer,
    });
    expect(report.status).toBe("MANUAL_REVIEW");
    expect(report.integrationDiagnostics[0].reason).toBe("INVALID_ADAPTER_OUTPUT");
    expect(composer).not.toHaveBeenCalled();
  });

  it("rejects proxy adapter output before any proxy trap can run", async () => {
    let traps = 0;
    const proxyDate = new Proxy(new Date(asOf), {
      get: () => {
        traps += 1;
        throw new Error("proxy get");
      },
      getPrototypeOf: () => {
        traps += 1;
        throw new Error("proxy prototype");
      },
    });
    let adapterCalls = 0;
    const adapter = () => {
      adapterCalls += 1;
      return proxyDate;
    };
    const composer = vi.fn();
    const report = await getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => accepted()),
      adapter: adapter as DegreeProgressServiceOptions["adapter"],
      composer,
    });
    expect(adapterCalls).toBe(1);
    expect(traps).toBe(0);
    expect(report.integrationDiagnostics[0].reason).toBe("INVALID_ADAPTER_OUTPUT");
    expect(composer).not.toHaveBeenCalled();
  });

  it("rejects symbol keys at the adapter output boundary", async () => {
    const symbol = Symbol("adapter");
    const malformed = { [symbol]: true };
    const adapter = () => malformed;
    const composer = vi.fn();
    const report = await getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => accepted()),
      adapter: adapter as DegreeProgressServiceOptions["adapter"],
      composer,
    });
    expect(report.integrationDiagnostics[0].reason).toBe("INVALID_ADAPTER_OUTPUT");
    expect(composer).not.toHaveBeenCalled();
  });

  it("rejects malformed or accessor composer output without retrying", async () => {
    let accessed = 0;
    const malformed: Record<string, unknown> = {};
    Object.defineProperty(malformed, "status", {
      enumerable: true,
      get: () => {
        accessed += 1;
        throw new Error("composer accessor");
      },
    });
    const composer = vi.fn(() => malformed);
    const report = await getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => accepted()),
      composer: composer as DegreeProgressServiceOptions["composer"],
    });
    expect(composer).toHaveBeenCalledTimes(1);
    expect(accessed).toBe(0);
    expect(report.status).toBe("MANUAL_REVIEW");
    expect(report.integrationDiagnostics[0].reason).toBe("INVALID_COMPOSITION_OUTPUT");
  });

  it("rejects symbol keys nested in a real composer projection", async () => {
    const composed = realComposed();
    const symbol = Symbol("nested");
    const malformed = {
      ...composed,
      recordedCreditProjection: {
        ...composed.recordedCreditProjection,
        [symbol]: true,
      },
    };
    const composer = vi.fn(async () => malformed);
    const report = await getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => accepted()),
      composer,
    });
    expect(composer).toHaveBeenCalledTimes(1);
    expect(report.integrationDiagnostics[0].reason).toBe("INVALID_COMPOSITION_OUTPUT");
  });

  it("rejects a proxy composer output before any proxy trap", async () => {
    let traps = 0;
    const proxy = new Proxy(realComposed(), {
      getPrototypeOf: () => {
        traps += 1;
        throw new Error("composer prototype");
      },
      getOwnPropertyDescriptor: () => {
        traps += 1;
        throw new Error("composer descriptor");
      },
    });
    let calls = 0;
    const composer = () => {
      calls += 1;
      return proxy;
    };
    const report = await getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => accepted()),
      composer: composer as DegreeProgressServiceOptions["composer"],
    });
    expect(calls).toBe(1);
    expect(traps).toBe(0);
    expect(report.integrationDiagnostics[0].reason).toBe("INVALID_COMPOSITION_OUTPUT");
  });

  it.each([
    ["credit projection", (output: ReturnType<typeof realComposed>) => ({
      ...output, recordedCreditProjection: {},
    })],
    ["exception projection", (output: ReturnType<typeof realComposed>) => ({
      ...output, recordedExceptionProjection: {},
    })],
    ["input accounting", (output: ReturnType<typeof realComposed>) => ({
      ...output, inputAccounting: {},
    })],
  ])("rejects malformed nested %s contracts", async (_name, mutate) => {
    const malformed = mutate(realComposed());
    const composer = vi.fn(async () => malformed);
    const report = await getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => accepted()),
      composer,
    });
    expect(composer).toHaveBeenCalledTimes(1);
    expect(report.integrationDiagnostics[0].reason).toBe("INVALID_COMPOSITION_OUTPUT");
  });

  it.each([
    ["input accounting occurrence", (output: ReturnType<typeof realComposed>) => ({
      ...output,
      inputAccounting: { ...output.inputAccounting, occurrences: [{}] },
    })],
    ["credit result", (output: ReturnType<typeof realComposed>) => ({
      ...output,
      recordedCreditProjection: { ...output.recordedCreditProjection, results: [{}] },
    })],
    ["credit evidence", (output: ReturnType<typeof realComposed>) => ({
      ...output,
      recordedCreditProjection: { ...output.recordedCreditProjection, evidence: [{}] },
    })],
    ["exception evidence", (output: ReturnType<typeof realComposed>) => ({
      ...output,
      recordedExceptionProjection: { ...output.recordedExceptionProjection, evidence: [{}] },
    })],
    ["exception normalization", (output: ReturnType<typeof realComposed>) => ({
      ...output,
      recordedExceptionProjection: {
        ...output.recordedExceptionProjection,
        normalization: { ...output.recordedExceptionProjection.normalization, requirements: [{}] },
      },
    })],
    ["exception result", (output: ReturnType<typeof realComposed>) => ({
      ...output,
      recordedExceptionProjection: { ...output.recordedExceptionProjection, results: [{}] },
    })],
    ["exception observation", (output: ReturnType<typeof realComposed>) => ({
      ...output,
      recordedExceptionProjection: { ...output.recordedExceptionProjection, observations: [{}] },
    })],
    ["malformed diagnostic provenance", (output: ReturnType<typeof realComposed>) => ({
      ...output,
      recordedCreditProjection: {
        ...output.recordedCreditProjection,
        diagnostics: [{
          projectionKind: "INFORMATIONAL_ONLY",
          status: "MANUAL_REVIEW",
          reason: "BAD",
          provenance: {},
        }],
      },
    })],
  ])("rejects real-output nested mutation: %s", async (_name, mutate) => {
    const malformed = mutate(structuredClone(realComposed()));
    const composer = vi.fn(async () => malformed);
    const report = await getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => accepted()),
      composer,
    });
    expect(composer).toHaveBeenCalledTimes(1);
    expect(report.status).toBe("MANUAL_REVIEW");
    expect(report.integrationDiagnostics[0].reason).toBe("INVALID_COMPOSITION_OUTPUT");
  });

  it("rejects wrong composer discriminators and contexts as opaque invalid output", async () => {
    const composer = vi.fn(async () => ({
      projectionKind: "INFORMATIONAL_ONLY" as const,
      compositionKind: "COMPOSED" as const,
      context: { ...context, studentId: "other" },
      diagnostics: [],
    }));
    const report = await getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => accepted()),
      composer,
    });
    expect(composer).toHaveBeenCalledTimes(1);
    expect(report.status).toBe("MANUAL_REVIEW");
    expect(report.integrationDiagnostics[0].reason).toBe("INVALID_COMPOSITION_OUTPUT");
  });

  it("rejects returned snapshot context mismatch before adapter and composer", async () => {
    const snapshot = accepted();
    const reader = vi.fn(async () => ({
      ...snapshot, context: { ...context, studentId: "other-student" },
    }));
    const adapter = vi.fn(() => adapted(snapshot));
    const composer = vi.fn();
    const result = await getDegreeProgress(context, { snapshotReader: reader, adapter, composer });
    expect(result.status).toBe("MANUAL_REVIEW");
    expect(adapter).not.toHaveBeenCalled();
    expect(composer).not.toHaveBeenCalled();
  });

  it("rejects a proxy reader snapshot before any proxy trap or dependency call", async () => {
    let traps = 0;
    const proxy = new Proxy(accepted(), {
      getPrototypeOf: () => {
        traps += 1;
        throw new Error("reader prototype");
      },
      getOwnPropertyDescriptor: () => {
        traps += 1;
        throw new Error("reader descriptor");
      },
    });
    const adapter = vi.fn();
    const composer = vi.fn();
    const report = await getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => proxy),
      adapter: adapter as DegreeProgressServiceOptions["adapter"],
      composer,
    });
    expect(traps).toBe(0);
    expect(report.integrationDiagnostics[0].reason).toBe("INVALID_SNAPSHOT_OUTPUT");
    expect(adapter).not.toHaveBeenCalled();
    expect(composer).not.toHaveBeenCalled();
  });

  it("clones the complete reader output before touching nested proxy or symbol data", async () => {
    let traps = 0;
    const nestedProxy = new Proxy(context, {
      ownKeys: () => {
        traps += 1;
        throw new Error("context keys");
      },
      getOwnPropertyDescriptor: () => {
        traps += 1;
        throw new Error("context descriptor");
      },
      getPrototypeOf: () => {
        traps += 1;
        throw new Error("context prototype");
      },
    });
    const raw = {
      ...accepted(),
      context: nestedProxy,
      occurrences: [...accepted().occurrences, { [Symbol("nested")]: true }],
    };
    const reader = vi.fn(async () => raw);
    const adapter = vi.fn();
    const composer = vi.fn();
    const report = await getDegreeProgress(context, {
      snapshotReader: reader,
      adapter: adapter as DegreeProgressServiceOptions["adapter"],
      composer,
    });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(traps).toBe(0);
    expect(report.integrationDiagnostics[0].reason).toBe("INVALID_SNAPSHOT_OUTPUT");
    expect(adapter).not.toHaveBeenCalled();
    expect(composer).not.toHaveBeenCalled();
  });

  it("rejects a proxy direct adapter snapshot before any proxy trap", () => {
    let traps = 0;
    const proxy = new Proxy(accepted(), {
      getPrototypeOf: () => {
        traps += 1;
        throw new Error("snapshot prototype");
      },
      getOwnPropertyDescriptor: () => {
        traps += 1;
        throw new Error("snapshot descriptor");
      },
    });
    const result = adaptDegreeEvaluationSnapshot(proxy);
    expect(traps).toBe(0);
    expect(result.status).toBe("MANUAL_REVIEW");
  });

  it.each([
    ["requirement occurrence null identity", (output: ReturnType<typeof realComposed>) => ({
      ...output,
      inputAccounting: {
        ...output.inputAccounting,
        occurrences: output.inputAccounting.occurrences.map((item) => (
          item.kind === "requirement" ? { ...item, requirementId: null } : item
        )),
      },
    })],
    ["input occurrence extra key", (output: ReturnType<typeof realComposed>) => ({
      ...output,
      inputAccounting: {
        ...output.inputAccounting,
        occurrences: [{ ...output.inputAccounting.occurrences[0], extra: true }],
      },
    })],
    ["credit result provenance-only", (output: ReturnType<typeof realComposed>) => ({
      ...output,
      recordedCreditProjection: {
        ...output.recordedCreditProjection,
        results: [{ provenance: output.recordedCreditProjection.results[0].provenance }],
      },
    })],
    ["exception evidence provenance-only", (output: ReturnType<typeof realComposed>) => ({
      ...output,
      recordedExceptionProjection: {
        ...output.recordedExceptionProjection,
        evidence: [{
          recordedProvenance: output.recordedExceptionProjection.evidence[0].recordedProvenance,
        }],
      },
    })],
    ["top diagnostic empty provenance", (output: ReturnType<typeof realComposed>) => ({
      ...output,
      diagnostics: [{
        stage: "COMPOSITION",
        projectionKind: "INFORMATIONAL_ONLY",
        status: "MANUAL_REVIEW",
        reason: "BAD",
        provenance: {},
      }],
    })],
  ])("rejects frozen minimally dressed nested mutation: %s", async (_name, mutate) => {
    const malformed = freezeFixture(mutate(structuredClone(realComposed())));
    const composer = vi.fn(async () => malformed);
    const report = await getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => accepted()),
      composer,
    });
    expect(composer).toHaveBeenCalledTimes(1);
    expect(report.integrationDiagnostics[0].reason).toBe("INVALID_COMPOSITION_OUTPUT");
  });

  it("rejects consistently aliased but minimally dressed exception arrays", async () => {
    const output = structuredClone(realComposed());
    const provenance = output.recordedExceptionProjection.evidence[0].recordedProvenance;
    const malformed = {
      ...output,
      evidence: [{ recordedProvenance: provenance }],
      recordedExceptionProjection: {
        ...output.recordedExceptionProjection,
        evidence: [{ recordedProvenance: provenance }],
        normalization: {
          ...output.recordedExceptionProjection.normalization,
          requirements: [{ requirementId: "requirement-1" }],
        },
        results: [{ provenance: output.recordedExceptionProjection.results[0].provenance }],
        observations: [{ provenance }],
      },
      normalization: {
        ...output.normalization,
        requirements: [{ requirementId: "requirement-1" }],
      },
      results: [{ provenance: output.results[0].provenance }],
      observations: [{ provenance }],
    };
    const composer = vi.fn(async () => freezeFixture(malformed));
    const report = await getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => accepted()),
      composer,
    });
    expect(composer).toHaveBeenCalledTimes(1);
    expect(report.integrationDiagnostics[0].reason).toBe("INVALID_COMPOSITION_OUTPUT");
  });

  it("rejects symbol-bearing nested Date values in adapter and composer outputs", async () => {
    const date = new Date(asOf);
    Object.defineProperty(date, Symbol("metadata"), { value: true });
    let traps = 0;
    const proxyDate = new Proxy(date, {
      ownKeys: () => {
        traps += 1;
        throw new Error("date keys");
      },
      getOwnPropertyDescriptor: () => {
        traps += 1;
        throw new Error("date descriptor");
      },
      getPrototypeOf: () => {
        traps += 1;
        throw new Error("date prototype");
      },
    });
    const adaptedOutput = adapted();
    expect(adaptedOutput.status).toBe("ADAPTED");
    if (adaptedOutput.status !== "ADAPTED") throw new Error("fixture was not adapted");
    const adapter = vi.fn(() => ({
      ...adaptedOutput,
      compositionInput: {
        ...adaptedOutput.compositionInput,
        exceptions: [{ metadata: proxyDate }],
      },
    }));
    const adapterReport = await getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => accepted()),
      adapter: adapter as DegreeProgressServiceOptions["adapter"],
      composer: vi.fn(),
    });
    expect(adapterReport.integrationDiagnostics[0].reason).toBe("INVALID_ADAPTER_OUTPUT");
    expect(traps).toBe(0);

    const composed = structuredClone(realComposed());
    const composer = vi.fn(async () => ({
      ...composed,
      recordedExceptionProjection: {
        ...composed.recordedExceptionProjection,
        observations: [{
          ...(composed.recordedExceptionProjection.observations[0] ?? {
            projectionKind: "INFORMATIONAL_ONLY",
            status: "MANUAL_REVIEW",
            reason: "RECORDED_EXCEPTION_EFFECT_UNDEFINED",
            exceptionId: "exception-1",
            exceptionType: "other",
            exceptionStatus: "active",
            rationale: "recorded",
            effectiveFrom: null,
            effectiveTo: null,
            createdAt: asOf,
            provenance: composed.recordedCreditProjection.recordedProvenance,
          }),
          metadata: date,
        }],
      },
    }));
    const composerReport = await getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => accepted()),
      composer,
    });
    expect(composerReport.integrationDiagnostics[0].reason).toBe("INVALID_COMPOSITION_OUTPUT");
  });

  it("turns an injected adapter throw into opaque manual review without compose", async () => {
    const adapter = vi.fn(() => { throw new Error("adapter secret"); });
    const composer = vi.fn();
    const result = await getDegreeProgress(context, {
      snapshotReader: vi.fn(async () => accepted()), adapter, composer,
    });
    expect(result.status).toBe("MANUAL_REVIEW");
    expect(JSON.stringify(result)).not.toContain("adapter secret");
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(composer).not.toHaveBeenCalled();
  });

  it("preserves fingerprint, asOf, and snapshot metadata", async () => {
    const result = await getDegreeProgress(context, { snapshotReader: vi.fn(async () => accepted()) });
    expect(result).toMatchObject({
      status: "COMPOSED",
      context, snapshot: { asOf, contractVersion: expect.any(String), schemaVersion: expect.any(String) },
    });
  });

  it("is deterministic under source occurrence shuffles", () => {
    const snapshot = accepted();
    const shuffled = { ...snapshot, occurrences: [...snapshot.occurrences].reverse() };
    expect(adaptDegreeEvaluationSnapshot(shuffled)).toEqual(adaptDegreeEvaluationSnapshot(snapshot));
  });

  it("does not mutate or freeze caller-owned input", () => {
    const snapshot = JSON.parse(JSON.stringify(accepted())) as Extract<
      DegreeEvaluationSnapshotOutput, { status: "ACCEPTED" }
    >;
    const before = JSON.stringify(snapshot.compositionInput);
    const result = adaptDegreeEvaluationSnapshot(snapshot);
    expect(JSON.stringify(snapshot.compositionInput)).toBe(before);
    expect(Object.isFrozen(snapshot.compositionInput)).toBe(false);
    expect(Object.isFrozen(snapshot.compositionInput.placements)).toBe(false);
    expect(result.status).toBe("ADAPTED");
  });

  it("rejects title/articulation-only changes and never infers a placement", () => {
    const snapshot = accepted();
    const target = occurrence(snapshot, "claimVersion")!;
    const changedOccurrences = snapshot.occurrences.map((item) => item === target ? {
      ...item,
      value: { ...(target.value as object), statement: "a title that sounds equivalent" },
    } : item);
    const academic = createInformationalAcademicSnapshot({
      context: snapshot.context,
      contractVersion: snapshot.contractVersion,
      schemaVersion: snapshot.schemaVersion,
      asOf: snapshot.asOf,
      occurrences: changedOccurrences,
    });
    expect(academic.status).toBe("ACCEPTED");
    if (academic.status !== "ACCEPTED") throw new Error("fixture was not accepted");
    const changed = { ...snapshot, occurrences: changedOccurrences, academicSnapshot: academic };
    expect(adaptDegreeEvaluationSnapshot(changed).status).toBe("ADAPTED");
    const noPlacement = {
      ...snapshot,
      compositionInput: { ...snapshot.compositionInput, associations: [] },
    };
    expect(adaptDegreeEvaluationSnapshot(noPlacement).status).toBe("MANUAL_REVIEW");
  });

  it("returns deeply immutable adapted output and report", async () => {
    const adaptedOutput = adapted();
    expect(Object.isFrozen(adaptedOutput)).toBe(true);
    const report = await getDegreeProgress(context, { snapshotReader: vi.fn(async () => accepted()) });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.snapshot)).toBe(true);
  });

  it("sorts cloned diagnostic occurrences independent of malformed input order", () => {
    const snapshot = accepted();
    const malformed = {
      ...snapshot,
      occurrences: [...snapshot.occurrences].reverse().map((item) => (
        item.occurrenceKind === "requirement"
          ? { ...item, value: { ...(item.value as object), creditsRequired: -1 } }
          : item
      )),
    };
    const left = adaptDegreeEvaluationSnapshot(malformed);
    const right = adaptDegreeEvaluationSnapshot({
      ...malformed, occurrences: [...malformed.occurrences].reverse(),
    });
    expect(left).toEqual(right);
  });

  it("does not import persistence, legacy, API, or route modules", () => {
    const adapter = readFileSync("shared/degree-progress-adapter.ts", "utf8");
    const service = readFileSync("server/services/degree-progress-service.ts", "utf8");
    const source = `${adapter}\n${service}`;
    expect(source).not.toMatch(/from\s+["'][^"']*(?:drizzle|repository|persistence|routes?|api|legacy|dotenv|env)[^"']*["']/i);
    expect(source).not.toMatch(/\b(?:writeFile|unlink|mkdir|insert|update|fetch)\s*\(|process\.env/);
  });
});