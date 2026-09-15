import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  assembleDegreeEvaluationSnapshot,
  DEGREE_EVALUATION_SNAPSHOT_CONTRACT_VERSION,
  DEGREE_EVALUATION_SNAPSHOT_SCHEMA_VERSION,
  type DegreeEvaluationRawBundle,
} from "../shared/degree-evaluation-snapshot";
import {
  degreeEvaluationSnapshotRepository,
  deriveDegreeEvaluationConflictFacts,
} from "../server/repositories/degree-evaluation-snapshot-repo";
import { readDegreeEvaluationSnapshot } from "../server/services/degree-evaluation-snapshot-service";

describe("bounded degree-evaluation snapshot reader", () => {
  const context = {
    studentId: "student-1",
    programAssignmentId: "assignment-1",
    programVersionId: "program-version-1",
  } as const;
  const asOf = "2025-01-01T00:00:00.000Z";
  const baseFacts = (): DegreeEvaluationRawBundle => ({
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
        kind: "minimum",
        unit: "credits",
        requiredAmount: "3",
        academicRuleId: null,
      },
    }],
    claimEvidence: [{
      claimVersionId: "claim-version-1", evidenceExcerptId: "excerpt-1",
      relationshipType: "supports",
    }],
    evidenceExcerpts: [{
      id: "excerpt-1", evidenceSourceId: "source-1", excerptText: "three credits",
    }],
    evidenceSources: [{ id: "source-1", title: "catalog" }],
    academicRules: [],
    conflicts: [],
    creditRecords: [],
    verificationEvents: [],
    decisions: [],
    placements: [],
    exceptions: [],
  });
  const assemble = (facts = baseFacts(), extraContext = context, date = asOf) =>
    assembleDegreeEvaluationSnapshot({ context: extraContext, asOf: date, facts });

  it("exposes the canonical reader, assembler, and version constants", () => {
    expect(DEGREE_EVALUATION_SNAPSHOT_CONTRACT_VERSION).toBeTypeOf("string");
    expect(DEGREE_EVALUATION_SNAPSHOT_SCHEMA_VERSION).toBeTypeOf("string");
    expect(assembleDegreeEvaluationSnapshot).toBeTypeOf("function");
    expect(degreeEvaluationSnapshotRepository).toBeDefined();
    expect(readDegreeEvaluationSnapshot).toBeTypeOf("function");
  });

  it("accepts the exact empty-credit composition boundary", () => {
    const output = assemble();
    expect(output.status).toBe("ACCEPTED");
    if (output.status === "ACCEPTED") {
      expect(output.compositionInput.creditRecords).toHaveLength(0);
      expect(output.compositionInput).toMatchObject({
        context,
        requirements: [{
          requirementId: "requirement-1",
          requiredAmount: "3",
          academicRuleId: null,
        }],
      });
    }
  });

  it("retains all verification, decision, placement, and exception history", () => {
    const facts = baseFacts();
    facts.creditRecords = [{
      id: "credit-1", studentId: "student-1", sourceId: "academic-source-1",
      status: "verified",
    }];
    facts.academicSources = [{ id: "academic-source-1", studentId: "student-1" }];
    facts.verificationEvents = [
      { id: "verification-1", creditRecordId: "credit-1", seq: 1, action: "submitted" },
      { id: "verification-2", creditRecordId: "credit-1", seq: 2, action: "verified" },
    ];
    facts.decisions = [
      {
        id: "decision-1", creditRecordId: "credit-1",
        programAssignmentId: "assignment-1", seq: 1, action: "rejected",
        creditsAwarded: null, basisClaimVersionId: null,
        equivalencyId: null, targetInstitutionCourseVersionId: null,
      },
      {
        id: "decision-2", creditRecordId: "credit-1",
        programAssignmentId: "assignment-1", seq: 2, action: "accepted",
        creditsAwarded: "3", basisClaimVersionId: null,
        equivalencyId: null, targetInstitutionCourseVersionId: null,
      },
    ];
    facts.placements = [{
      id: "placement-1", studentCreditDecisionId: "decision-2",
      programAssignmentId: "assignment-1", requirementId: "requirement-1",
      academicRuleId: null, status: "active",
    }, {
      id: "placement-2", studentCreditDecisionId: "decision-2",
      programAssignmentId: "assignment-1", requirementId: "requirement-1",
      academicRuleId: null, status: "revoked",
    }];
    facts.exceptions = [{
      id: "exception-1", studentId: "student-1",
      programAssignmentId: "assignment-1", exceptionType: "other",
      status: "revoked", requirementId: "requirement-1", academicRuleId: null,
      creditRecordId: null, supersedesExceptionId: null, approvedBy: null,
      rationale: "recorded", effectiveFrom: null, effectiveTo: null,
      metadata: {}, createdAt: new Date(asOf),
    }];
    const output = assemble(facts);
    expect(output.status).toBe("ACCEPTED");
    if (output.status === "ACCEPTED") {
      expect(output.compositionInput.verificationEvents).toHaveLength(2);
      expect(output.compositionInput.decisions).toHaveLength(2);
      expect(output.compositionInput.placements).toHaveLength(1);
      expect(output.occurrences.filter((item) => item.occurrenceKind === "studentCreditPlacement")).toHaveLength(2);
      expect(output.occurrences.filter((item) => item.occurrenceKind === "exception")).toHaveLength(1);
    }
  });

  it("rejects zero active assignments", () => {
    const facts = baseFacts();
    facts.assignments = [];
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
  });

  it("rejects multiple active assignments", () => {
    const facts = baseFacts();
    facts.assignments = [...facts.assignments, {
      id: "assignment-2", studentId: "student-1",
      programVersionId: "program-version-1", status: "active",
    }];
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
  });

  it("rejects requested assignment mismatch", () => {
    expect(assemble(baseFacts(), { ...context, programAssignmentId: "other" }).status)
      .toBe("MANUAL_REVIEW");
  });

  it("rejects assignment cross-student and cross-program facts", () => {
    const facts = baseFacts();
    facts.assignments = [{
      id: "assignment-1", studentId: "student-2",
      programVersionId: "program-version-2", status: "active",
    }];
    const output = assemble(facts);
    expect(output.status).toBe("MANUAL_REVIEW");
    if (output.status === "MANUAL_REVIEW") {
      expect(output.diagnostics.map((item) => item.reason)).toContain("ASSIGNMENT_CONTEXT_MISMATCH");
    }
  });

  it("rejects missing, non-current, and empty requirement provenance", () => {
    const facts = baseFacts();
    facts.requirementProvenance = [];
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
    facts.requirementProvenance = [{
      requirementId: "requirement-1", claimId: "claim-1",
      claimVersionId: "claim-version-1", sourceId: "source-1",
    }];
    facts.claims = facts.claims.map((claim) => ({ ...claim, currentVersionId: "old" }));
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
  });

  it("rejects invalid and duplicate provenance identities", () => {
    const facts = baseFacts();
    facts.requirementProvenance = [
      ...facts.requirementProvenance,
      { ...facts.requirementProvenance[0] },
    ];
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
    facts.requirementProvenance = [{
      requirementId: "requirement-1", claimId: "claim-1",
      claimVersionId: "claim-version-1", sourceId: "source-1",
    }];
    facts.claims = facts.claims.map((claim) => ({ ...claim, status: "open" }));
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
  });

  it("rejects duplicate registry identities", () => {
    const facts = baseFacts();
    facts.requirements = [...facts.requirements, { ...facts.requirements[0] }];
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
    facts.requirements = baseFacts().requirements;
    facts.claims = [...facts.claims, { ...facts.claims[0] }];
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
  });

  it("includes open conflict occurrences and composition conflicts", () => {
    const facts = baseFacts();
    facts.claimVersions = [
      ...facts.claimVersions,
      {
        id: "claim-version-2", claimId: "claim-1", status: "superseded",
        normalizedValue: {
          projectionKind: "QUANTITATIVE_REQUIREMENT", kind: "minimum",
          unit: "credits", requiredAmount: "3", academicRuleId: null,
        },
      },
    ];
    facts.conflicts = [{
      id: "conflict-1", status: "open", requirementId: "requirement-1",
      academicRuleId: null, claimVersionAId: "claim-version-1",
      claimVersionBId: "claim-version-2", sourceIds: ["source-1"],
      claimVersionIds: ["claim-version-1", "claim-version-2"],
    }];
    facts.claimEvidence = [
      ...facts.claimEvidence!,
      { claimVersionId: "claim-version-2", evidenceExcerptId: "excerpt-1", relationshipType: "supports" },
    ];
    facts.conflictProvenance = [
      {
        id: "conflict-1:A:claim-version-1:source-1", conflictId: "conflict-1",
        side: "A", claimVersionId: "claim-version-1", sourceId: "source-1",
      },
      {
        id: "conflict-1:B:claim-version-2:source-1", conflictId: "conflict-1",
        side: "B", claimVersionId: "claim-version-2", sourceId: "source-1",
      },
    ];
    const output = assemble(facts);
    expect(output.status).toBe("ACCEPTED");
    if (output.status === "ACCEPTED") {
      expect(output.compositionInput.unresolvedConflicts[0].conflictId).toBe("conflict-1");
    }
  });

  it("maps only active valid placements to Phase 3 associations", () => {
    const facts = baseFacts();
    facts.creditRecords = [{
      id: "credit-1", studentId: "student-1", sourceId: "academic-source-1",
      status: "verified",
    }];
    facts.verificationEvents = [{
      id: "verification-1", creditRecordId: "credit-1", seq: 1, action: "verified",
    }];
    facts.decisions = [{
      id: "decision-1", creditRecordId: "credit-1",
      programAssignmentId: "assignment-1", seq: 1, action: "accepted",
      creditsAwarded: "3", basisClaimVersionId: null,
      equivalencyId: null, targetInstitutionCourseVersionId: null,
    }];
    facts.placements = [{
      id: "placement-active", studentCreditDecisionId: "decision-1",
      programAssignmentId: "assignment-1", requirementId: "requirement-1",
      academicRuleId: null, status: "active",
    }, {
      id: "placement-old", studentCreditDecisionId: "decision-1",
      programAssignmentId: "assignment-1", requirementId: "requirement-1",
      academicRuleId: null, status: "superseded",
    }];
    const output = assemble(facts);
    expect(output.status).toBe("ACCEPTED");
    if (output.status === "ACCEPTED") {
      expect(output.compositionInput.associations).toHaveLength(1);
      expect(output.compositionInput.associations[0].decisionId).toBe("decision-1");
    }
  });

  it("rejects exact duplicate active placements", () => {
    const facts = baseFacts();
    facts.placements = [{
      id: "placement-1", studentCreditDecisionId: "decision-1",
      programAssignmentId: "assignment-1", requirementId: "requirement-1",
      academicRuleId: null, status: "active",
    }, {
      id: "placement-2", studentCreditDecisionId: "decision-1",
      programAssignmentId: "assignment-1", requirementId: "requirement-1",
      academicRuleId: null, status: "active",
    }];
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
  });

  it("copies exception targets and never infers exception evidence", () => {
    const facts = baseFacts();
    facts.exceptions = [{
      id: "exception-1", studentId: "student-1",
      programAssignmentId: "assignment-1", exceptionType: "course_substitution",
      status: "active", requirementId: "requirement-1", academicRuleId: null,
      creditRecordId: null, supersedesExceptionId: null, approvedBy: null,
      rationale: "recorded", effectiveFrom: null, effectiveTo: null,
      metadata: {}, createdAt: new Date(asOf),
    }];
    const output = assemble(facts);
    expect(output.status).toBe("ACCEPTED");
    if (output.status === "ACCEPTED") {
      expect(output.compositionInput.placements[0]).toMatchObject({
        exceptionId: "exception-1", requirementId: "requirement-1", evidenceId: null,
      });
    }
  });

  it("rejects missing, null/global, and mismatched referenced rules", () => {
    const makeRuleBundle = () => {
      const facts = baseFacts();
      facts.placements = [{
        id: "placement-1", studentCreditDecisionId: "decision-1",
        programAssignmentId: "assignment-1", requirementId: "requirement-1",
        academicRuleId: "rule-1", status: "active",
      }];
      return facts;
    };
    const missing = assemble(makeRuleBundle());
    expect(missing.status).toBe("MANUAL_REVIEW");
    if (missing.status === "MANUAL_REVIEW") {
      expect(missing.diagnostics.map((diagnostic) => diagnostic.reason))
        .toContain("MISSING_REFERENCED_RULE");
    }
    const global = makeRuleBundle();
    global.academicRules = [{ id: "rule-1", programVersionId: null }];
    const globalOutput = assemble(global);
    expect(globalOutput.status).toBe("MANUAL_REVIEW");
    if (globalOutput.status === "MANUAL_REVIEW") {
      expect(globalOutput.diagnostics.map((diagnostic) => diagnostic.reason))
        .toContain("REFERENCED_RULE_PROGRAM_VERSION_MISMATCH");
    }
    const mismatch = makeRuleBundle();
    mismatch.academicRules = [{ id: "rule-1", programVersionId: "other-program" }];
    expect(assemble(mismatch).status).toBe("MANUAL_REVIEW");
  });

  it("is shuffle-equivalent and fingerprints canonical content", () => {
    const facts = baseFacts();
    facts.claims = [...facts.claims].reverse();
    facts.requirements = [...facts.requirements].reverse();
    const left = assemble(baseFacts());
    const right = assemble(facts);
    expect(right).toEqual(left);
  });

  it("changes fingerprint for relevant content but not asOf", () => {
    const first = assemble();
    const changedFacts = baseFacts();
    changedFacts.evidenceSources = [{ id: "source-1", title: "different catalog" }];
    const second = assemble(changedFacts, context, "2026-01-01T00:00:00.000Z");
    expect(first.status).toBe("ACCEPTED");
    expect(second.status).toBe("ACCEPTED");
    if (first.status === "ACCEPTED" && second.status === "ACCEPTED") {
      expect(first.academicSnapshot.snapshotFingerprint)
        .not.toBe(second.academicSnapshot.snapshotFingerprint);
    }
  });

  it("keeps the fingerprint stable when only asOf changes", () => {
    const first = assemble();
    const second = assemble(baseFacts(), context, "2026-01-01T00:00:00.000Z");
    expect(first.status).toBe("ACCEPTED");
    expect(second.status).toBe("ACCEPTED");
    if (first.status === "ACCEPTED" && second.status === "ACCEPTED") {
      expect(first.academicSnapshot.snapshotFingerprint)
        .toBe(second.academicSnapshot.snapshotFingerprint);
      expect(first.asOf).not.toBe(second.asOf);
    }
  });

  it("sorts and freezes diagnostics", () => {
    const facts = baseFacts();
    facts.assignments = [];
    const output = assemble(facts);
    expect(output.status).toBe("MANUAL_REVIEW");
    expect(Object.isFrozen(output)).toBe(true);
    if (output.status === "MANUAL_REVIEW") {
      expect(Object.isFrozen(output.diagnostics)).toBe(true);
      expect(output.diagnostics.map((item) => item.reason))
        .toEqual([...output.diagnostics.map((item) => item.reason)].sort());
    }
  });

  it("does not mutate caller facts", () => {
    const facts = baseFacts();
    const before = JSON.stringify(facts);
    assemble(facts);
    expect(JSON.stringify(facts)).toBe(before);
  });

  it("retains opaque metadata as canonical JSON occurrences", () => {
    const facts = baseFacts();
    facts.requirements = [{ ...facts.requirements[0], metadata: { z: 1, a: "x" } }];
    const output = assemble(facts);
    expect(output.status).toBe("ACCEPTED");
    if (output.status === "ACCEPTED") {
      const requirement = output.occurrences.find((item) => item.occurrenceKind === "requirement");
      expect(requirement?.value).toMatchObject({ metadata: { a: "x", z: 1 } });
    }
  });

  it("fails closed on malformed non-JSON metadata", () => {
    const facts = baseFacts();
    facts.requirements = [{
      ...facts.requirements[0], metadata: { invalid: BigInt(1) },
    }];
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
  });

  it("does not infer academic result or status from recorded actions", () => {
    const facts = baseFacts();
    facts.creditRecords = [{
      id: "credit-1", studentId: "student-1", sourceId: "source-1",
      status: "rejected",
    }];
    facts.verificationEvents = [{
      id: "verification-1", creditRecordId: "credit-1", seq: 1, action: "rejected",
    }];
    facts.decisions = [{
      id: "decision-1", creditRecordId: "credit-1",
      programAssignmentId: "assignment-1", seq: 1, action: "rejected",
      creditsAwarded: null, basisClaimVersionId: null,
      equivalencyId: null, targetInstitutionCourseVersionId: null,
    }];
    const output = assemble(facts);
    expect(output.status).toBe("ACCEPTED");
    if (output.status === "ACCEPTED") {
      expect(output.compositionInput.decisions[0].action).toBe("rejected");
    }
  });

  it("uses the exact injected transaction for timestamp and every repository read", async () => {
    const tx = {
      execute: vi.fn(async () => ({ rows: [{ asOf }] })),
    };
    const repository = {
      readFacts: vi.fn(async (_context: unknown, receivedTx: unknown) => {
        expect(receivedTx).toBe(tx);
        return baseFacts();
      }),
    };
    const output = await readDegreeEvaluationSnapshot({
      context,
      repository,
      transaction: async (_config, callback) => callback(tx as never),
    });
    expect(repository.readFacts).toHaveBeenCalledTimes(1);
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(output.asOf).toBe(asOf);
  });

  it("ignores valid historical non-active assignments", () => {
    const facts = baseFacts();
    facts.assignments = [
      ...facts.assignments,
      {
        id: "assignment-history", studentId: "student-1",
        programVersionId: "old-program", status: "completed",
      },
    ];
    expect(assemble(facts).status).toBe("ACCEPTED");
  });

  it("does not admit an exception from a historical assignment", () => {
    const facts = baseFacts();
    facts.exceptions = [{
      id: "exception-history", studentId: "student-1",
      programAssignmentId: "assignment-history", exceptionType: "other",
      status: "active", requirementId: "requirement-1", academicRuleId: null,
      creditRecordId: null, supersedesExceptionId: null, approvedBy: null,
      rationale: "historical", effectiveFrom: null, effectiveTo: null,
      metadata: {}, createdAt: new Date(asOf),
    }];
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
  });

  it("requires the confirmed current claim to carry a narrow normalized projection", () => {
    const facts = baseFacts();
    expect(assemble(facts).status).toBe("ACCEPTED");
    facts.claimVersions = facts.claimVersions.map((version) => ({
      ...version,
      normalizedValue: { projectionKind: "WRONG", requiredAmount: "3" },
    }));
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
  });

  it("rejects a normalized projection whose amount disagrees with requirementsV2", () => {
    const facts = baseFacts();
    facts.claimVersions = facts.claimVersions.map((version) => ({
      ...version,
      normalizedValue: {
        projectionKind: "QUANTITATIVE_REQUIREMENT",
        kind: "minimum",
        unit: "credits",
        requiredAmount: "4",
        academicRuleId: null,
      },
    }));
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
  });

  it("requires two-sided open conflict provenance and retains its raw history", () => {
    const facts = baseFacts();
    facts.claimVersions = [
      ...facts.claimVersions,
      {
        id: "claim-version-2", claimId: "claim-1", status: "superseded",
        normalizedValue: {
          projectionKind: "QUANTITATIVE_REQUIREMENT", kind: "minimum",
          unit: "credits", requiredAmount: "3", academicRuleId: null,
        },
      },
    ];
    facts.conflicts = [{
      id: "conflict-1", status: "open", requirementId: "requirement-1",
      academicRuleId: null, claimVersionAId: "claim-version-1",
      claimVersionBId: "claim-version-2",
      sourceIds: ["source-1"], claimVersionIds: ["claim-version-1"],
    }];
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
    facts.conflicts = [{
      ...facts.conflicts[0],
      sourceIds: ["source-1", "source-2"],
      claimVersionIds: ["claim-version-1", "claim-version-2"],
    }];
    facts.evidenceSources = [
      ...facts.evidenceSources,
      { id: "source-2", title: "other catalog" },
    ];
    facts.evidenceExcerpts = [
      ...facts.evidenceExcerpts!,
      { id: "excerpt-2", evidenceSourceId: "source-2", excerptText: "other" },
    ];
    facts.claimEvidence = [
      ...facts.claimEvidence!,
      { claimVersionId: "claim-version-2", evidenceExcerptId: "excerpt-2", relationshipType: "supports" },
    ];
    facts.conflictProvenance = [
      {
        conflictId: "conflict-1", side: "A",
        claimVersionId: "claim-version-1", sourceId: "source-1",
      },
      {
        conflictId: "conflict-1", side: "B",
        claimVersionId: "claim-version-2", sourceId: "source-2",
      },
    ];
    const accepted = assemble(facts);
    expect(accepted.status).toBe("ACCEPTED");
    if (accepted.status === "ACCEPTED") {
      expect(accepted.occurrences.some((item) => item.occurrenceKind === "claimVersion"
        && item.occurrenceId === "claim-version-2")).toBe(true);
    }
  });

  it("retains claimEvidence, evidenceExcerpt, and source occurrences", () => {
    const facts = baseFacts() as DegreeEvaluationRawBundle & Record<string, unknown>;
    facts.claimEvidence = [{
      claimVersionId: "claim-version-1", evidenceExcerptId: "excerpt-1",
      relationshipType: "supports",
    }];
    facts.evidenceExcerpts = [{
      id: "excerpt-1", evidenceSourceId: "source-1", excerptText: "three credits",
    }];
    const output = assemble(facts);
    expect(output.status).toBe("ACCEPTED");
    if (output.status === "ACCEPTED") {
      expect(output.occurrences.map((item) => item.occurrenceKind)).toEqual(
        expect.arrayContaining(["claimEvidence", "evidenceExcerpt", "evidenceSource"]),
      );
    }
  });

  it("freezes recursively nested canonical metadata", () => {
    const facts = baseFacts();
    facts.requirements = [{
      ...facts.requirements[0],
      metadata: { nested: { values: [{ deep: true }] } },
    }];
    const output = assemble(facts);
    expect(output.status).toBe("ACCEPTED");
    if (output.status === "ACCEPTED") {
      const item = output.occurrences.find((entry) => entry.occurrenceKind === "requirement");
      expect(Object.isFrozen(item?.value)).toBe(true);
      expect(Object.isFrozen((item?.value as any)?.metadata?.nested?.values)).toBe(true);
    }
  });

  it("scopes production reads and enforces transaction-only access", () => {
    const repository = readFileSync(
      "server/repositories/degree-evaluation-snapshot-repo.ts",
      "utf8",
    );
    const service = readFileSync(
      "server/services/degree-evaluation-snapshot-service.ts",
      "utf8",
    );
    expect(repository).toMatch(/studentProgramAssignments\.status.*active|status.*active[\s\S]*studentProgramAssignments/);
    expect(repository).toMatch(/studentAcademicExceptions[\s\S]*programAssignmentId/);
    expect(repository).toMatch(/knowledgeConflicts[\s\S]*status.*open/);
    expect(repository).toMatch(/claimVersionBId/);
    expect(repository).toMatch(/closureVersionIds[\s\S]*claimVersions/);
    expect(repository).toMatch(/side[\s\S]*claimVersionId[\s\S]*sourceId/);
    expect(repository).toMatch(/claimKey/);
    expect(repository).toMatch(/versionNumber[\s\S]*statement/);
    expect(repository).toMatch(/relationshipType[\s\S]*notes[\s\S]*createdAt/);
    expect(repository).toMatch(/locator[\s\S]*pageNumber[\s\S]*section/);
    expect(repository).toMatch(/sourceType[\s\S]*contentHash[\s\S]*authorityLevel/);
    expect(repository).toMatch(/academicRulesTable[\s\S]*eq\(academicRulesTable\.programVersionId, context\.programVersionId\)/);
    expect(repository).toMatch(/programVersions[\s\S]*eq\(programVersions\.id, context\.programVersionId\)/);
    expect(repository).not.toMatch(/isNull/);
    expect(repository).not.toMatch(/degree_programs|program_courses|legacy.*courses/);
    expect(repository).not.toMatch(/typeof db/);
    expect(service).toMatch(/REPEATABLE READ READ ONLY/);
    expect(service).toMatch(/transaction_timestamp\(\)/);
  });

  it("uses only the exact current claim version for composition provenance", () => {
    const facts = baseFacts();
    facts.claimVersions = [
      ...facts.claimVersions,
      {
        id: "claim-version-history", claimId: "claim-1", status: "superseded",
        normalizedValue: {
          projectionKind: "QUANTITATIVE_REQUIREMENT", kind: "minimum",
          unit: "credits", requiredAmount: "3", academicRuleId: null,
        },
      },
    ];
    facts.evidenceSources = [
      ...facts.evidenceSources,
      { id: "source-history", title: "old catalog" },
    ];
    facts.evidenceExcerpts = [
      ...facts.evidenceExcerpts!,
      { id: "excerpt-history", evidenceSourceId: "source-history", excerptText: "old" },
    ];
    facts.claimEvidence = [
      ...facts.claimEvidence!,
      {
        claimVersionId: "claim-version-history",
        evidenceExcerptId: "excerpt-history",
        relationshipType: "supports",
      },
    ];
    facts.requirementProvenance = [
      ...facts.requirementProvenance,
      {
        requirementId: "requirement-1", claimId: "claim-1",
        claimVersionId: "claim-version-history", sourceId: "source-history",
      },
    ];
    const output = assemble(facts);
    const reversed = {
      ...facts,
      claimVersions: [...facts.claimVersions].reverse(),
      claimEvidence: [...facts.claimEvidence!].reverse(),
      evidenceExcerpts: [...facts.evidenceExcerpts!].reverse(),
      evidenceSources: [...facts.evidenceSources].reverse(),
      requirementProvenance: [...facts.requirementProvenance].reverse(),
    };
    const reversedOutput = assemble(reversed);
    expect(output.status).toBe("ACCEPTED");
    expect(reversedOutput).toEqual(output);
    if (output.status === "ACCEPTED") {
      expect(output.compositionInput.requirements[0].claimVersionIds)
        .toEqual(["claim-version-1"]);
      expect(output.compositionInput.requirements[0].sourceIds)
        .toEqual(["source-1"]);
      expect(output.occurrences.some((item) => item.occurrenceId === "claim-version-history"))
        .toBe(true);
    }
  });

  it("requires normalizedValue on the current claim version and never claim fallback", () => {
    const facts = baseFacts();
    facts.claims = facts.claims.map((claim) => ({
      ...claim,
      normalizedValue: {
        projectionKind: "QUANTITATIVE_REQUIREMENT", kind: "minimum",
        unit: "credits", requiredAmount: "3", academicRuleId: null,
      },
    }));
    facts.claimVersions = facts.claimVersions.map((version) => {
      const copy = { ...version } as Record<string, unknown>;
      delete copy.normalizedValue;
      return copy;
    });
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
  });

  it("keeps natural occurrence identities stable when raw arrays reverse", () => {
    const facts = baseFacts();
    facts.exceptions = [{
      id: "exception-1", studentId: "student-1",
      programAssignmentId: "assignment-1", exceptionType: "other",
      status: "revoked", requirementId: "requirement-1", academicRuleId: null,
      creditRecordId: null, supersedesExceptionId: null, approvedBy: null,
      rationale: "one", effectiveFrom: null, effectiveTo: null,
      metadata: {}, createdAt: new Date(asOf),
    }, {
      id: "exception-2", studentId: "student-1",
      programAssignmentId: "assignment-1", exceptionType: "other",
      status: "revoked", requirementId: "requirement-1", academicRuleId: null,
      creditRecordId: null, supersedesExceptionId: null, approvedBy: null,
      rationale: "two", effectiveFrom: null, effectiveTo: null,
      metadata: {}, createdAt: new Date(asOf),
    }];
    const reversed = { ...facts, exceptions: [...facts.exceptions].reverse() };
    const first = assemble(facts);
    const second = assemble(reversed);
    expect(first.status).toBe("ACCEPTED");
    expect(second.status).toBe("ACCEPTED");
    if (first.status === "ACCEPTED" && second.status === "ACCEPTED") {
      expect(first.occurrences).toEqual(second.occurrences);
      expect(first.academicSnapshot.snapshotFingerprint)
        .toBe(second.academicSnapshot.snapshotFingerprint);
    }
  });

  it("rejects extra requirement provenance rows with no parent requirement", () => {
    const facts = baseFacts();
    facts.requirementProvenance = [
      ...facts.requirementProvenance,
      {
        requirementId: "orphan-requirement", claimId: "claim-1",
        claimVersionId: "claim-version-1", sourceId: "source-1",
      },
    ];
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
  });

  it("requires side-specific complete evidence for both conflict versions", () => {
    const facts = baseFacts();
    facts.claimVersions = [
      ...facts.claimVersions,
      {
        id: "claim-version-b", claimId: "claim-1", status: "superseded",
        normalizedValue: {
          projectionKind: "QUANTITATIVE_REQUIREMENT", kind: "minimum",
          unit: "credits", requiredAmount: "3", academicRuleId: null,
        },
      },
    ];
    facts.conflicts = [{
      id: "conflict-1", status: "open", requirementId: "requirement-1",
      academicRuleId: null, claimVersionAId: "claim-version-1",
      claimVersionBId: "claim-version-b",
      claimVersionIds: ["claim-version-1", "claim-version-b"],
      sourceIds: ["source-1"],
    }];
    facts.conflictProvenance = [{
      id: "conflict-1:A:claim-version-1:source-1",
      conflictId: "conflict-1", side: "A",
      claimVersionId: "claim-version-1", sourceId: "source-1",
    }] as never;
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
  });

  it("allows distinct current excerpts from one source", () => {
    const facts = baseFacts();
    facts.evidenceExcerpts = [
      ...facts.evidenceExcerpts!,
      { id: "excerpt-2", evidenceSourceId: "source-1", excerptText: "another line" },
    ];
    facts.claimEvidence = [
      ...facts.claimEvidence!,
      { claimVersionId: "claim-version-1", evidenceExcerptId: "excerpt-2", relationshipType: "supports" },
    ];
    facts.requirementProvenance = [
      ...facts.requirementProvenance,
      {
        requirementId: "requirement-1", claimId: "claim-1",
        claimVersionId: "claim-version-1", sourceId: "source-1",
        evidenceExcerptId: "excerpt-2",
      },
    ] as never;
    expect(assemble(facts).status).toBe("ACCEPTED");
  });

  it("does not map an academic-rule claim subject directly to a requirement", () => {
    const facts = baseFacts();
    facts.claims = [{
      id: "rule-claim", claimType: "academic_rule",
      subjectType: "academic_rule", subjectId: "requirement-1",
      currentVersionId: "rule-version", status: "confirmed",
    }, ...facts.claims];
    facts.claimVersions = [{
      id: "rule-version", claimId: "rule-claim", status: "confirmed",
      normalizedValue: { projectionKind: "RULE", expression: "x" },
    }, ...facts.claimVersions];
    facts.academicRules = [{
      id: "rule-1", programVersionId: "program-version-1",
      claimVersionId: "rule-version",
    }];
    facts.conflicts = [{
      id: "rule-conflict", status: "open", requirementId: "requirement-1",
      academicRuleId: "rule-1", claimVersionAId: "rule-version",
      claimVersionBId: "claim-version-1",
      sourceIds: ["source-1"], claimVersionIds: ["rule-version", "claim-version-1"],
    }];
    facts.conflictProvenance = [{
      conflictId: "rule-conflict", side: "A",
      claimVersionId: "rule-version", sourceId: "source-1",
    }, {
      conflictId: "rule-conflict", side: "B",
      claimVersionId: "claim-version-1", sourceId: "source-1",
    }];
    expect(assemble(facts).status).toBe("MANUAL_REVIEW");
  });

  it("maps a rule conflict through the exact requirement projection", () => {
    const facts = baseFacts();
    facts.claims = [{
      id: "rule-claim", claimType: "academic_rule",
      subjectType: "academic_rule", subjectId: "rule-1",
      currentVersionId: "rule-version", status: "confirmed",
    }, ...facts.claims];
    facts.claimVersions = [{
      id: "rule-version", claimId: "rule-claim", status: "confirmed",
      normalizedValue: { projectionKind: "RULE", expression: "x" },
    }, ...facts.claimVersions];
    facts.claimVersions = facts.claimVersions.map((version) => (
      version.id === "claim-version-1"
        ? {
          ...version,
          normalizedValue: {
            projectionKind: "QUANTITATIVE_REQUIREMENT", kind: "minimum",
            unit: "credits", requiredAmount: "3", academicRuleId: "rule-1",
          },
        }
        : version
    ));
    facts.academicRules = [{
      id: "rule-1", programVersionId: "program-version-1",
      claimVersionId: "rule-version",
    }];
    facts.claimEvidence = [
      ...facts.claimEvidence!,
      { claimVersionId: "rule-version", evidenceExcerptId: "excerpt-1", relationshipType: "supports" },
    ];
    facts.conflicts = [{
      id: "rule-conflict", status: "open", requirementId: "requirement-1",
      academicRuleId: "rule-1", claimVersionAId: "rule-version",
      claimVersionBId: "claim-version-1",
      sourceIds: ["source-1"], claimVersionIds: ["rule-version", "claim-version-1"],
    }];
    facts.conflictProvenance = [{
      conflictId: "rule-conflict", side: "A",
      claimVersionId: "rule-version", sourceId: "source-1",
    }, {
      conflictId: "rule-conflict", side: "B",
      claimVersionId: "claim-version-1", sourceId: "source-1",
    }];
    expect(assemble(facts).status).toBe("ACCEPTED");
  });

  it("includes rule claim versions declared by current requirement projections in production closure", () => {
    const repository = readFileSync(
      "server/repositories/degree-evaluation-snapshot-repo.ts",
      "utf8",
    );
    expect(repository).toMatch(/normalizedValue/);
    expect(repository).toMatch(/academicRuleId/);
    expect(repository).toMatch(/claimVersionId/);
    expect(repository).toMatch(/closureVersionIds/);
    expect(repository).toMatch(/referencedRuleIds[\s\S]*canonicalRequirementProjection[\s\S]*academicRuleId/);
  });

  it("retains complete canonical provenance fields in raw occurrences", () => {
    const facts = baseFacts() as DegreeEvaluationRawBundle & Record<string, unknown>;
    facts.claims = facts.claims.map((claim) => ({
      ...claim,
      claimKey: "requirement-key",
      createdAt: new Date(asOf),
      createdBy: "reviewer-1",
    })) as never;
    const first = assemble(facts);
    const secondFacts = structuredClone(facts);
    secondFacts.claims = (secondFacts.claims as Array<Record<string, unknown>>)
      .map((claim) => ({ ...claim, claimKey: "changed-key" })) as never;
    const second = assemble(secondFacts);
    expect(first.status).toBe("ACCEPTED");
    expect(second.status).toBe("ACCEPTED");
    if (first.status === "ACCEPTED" && second.status === "ACCEPTED") {
      expect(first.compositionInput).toEqual(second.compositionInput);
      expect(first.academicSnapshot.snapshotFingerprint)
        .not.toBe(second.academicSnapshot.snapshotFingerprint);
    }
  });

  it("requires exactly one requested program-version row", () => {
    const missingFacts = baseFacts();
    missingFacts.programVersions = [];
    const missing = assemble(missingFacts);
    expect(missing.status).toBe("MANUAL_REVIEW");
    const wrong = baseFacts();
    wrong.programVersions = [{ id: "other-program-version" }];
    expect(assemble(wrong).status).toBe("MANUAL_REVIEW");
    const duplicate = baseFacts();
    duplicate.programVersions = [
      { id: "program-version-1" },
      { id: "program-version-1" },
    ];
    expect(assemble(duplicate).status).toBe("MANUAL_REVIEW");
  });

  it("uses runtime canonical projection extraction in repository closure", () => {
    const repository = readFileSync(
      "server/repositories/degree-evaluation-snapshot-repo.ts",
      "utf8",
    );
    expect(repository).toMatch(/import \{[\s\S]*canonicalRequirementProjection/);
    expect(repository).not.toMatch(/import type \{[^}]*canonicalRequirementProjection/);
  });

  it("passes repeatable-read/read-only config to every transaction runner", async () => {
    const tx = {
      execute: vi.fn(async () => ({ rows: [{ asOf }] })),
    };
    const repository = {
      readFacts: vi.fn(async () => baseFacts()),
    };
    const runner = vi.fn(async (
      config: unknown,
      callback: (receivedTx: unknown) => Promise<unknown>,
    ) => callback(tx));
    const output = await readDegreeEvaluationSnapshot({
      context,
      repository,
      transaction: runner as never,
    });
    expect(output.status).toBe("ACCEPTED");
    expect(runner).toHaveBeenCalledWith(
      { isolationLevel: "repeatable read", accessMode: "read only" },
      expect.any(Function),
    );
    expect(repository.readFacts).toHaveBeenCalledWith(context, tx);
  });

  it("uses stable excerpt-inclusive provenance occurrence IDs", () => {
    const facts = baseFacts();
    facts.requirementProvenance = [{
      requirementId: "requirement-1", claimId: "claim-1",
      claimVersionId: "claim-version-1", evidenceExcerptId: "excerpt-1",
      sourceId: "source-1",
    }];
    const output = assemble(facts);
    expect(output.status).toBe("ACCEPTED");
    if (output.status === "ACCEPTED") {
      expect(output.occurrences.some((item) => (
        item.occurrenceKind === "requirementProvenance"
        && item.occurrenceId === "requirement-1:claim-version-1:excerpt-1:source-1"
      ))).toBe(true);
    }
  });

  it("does not freeze caller metadata or caller exception placements", () => {
    const facts = baseFacts();
    const metadata = { nested: { value: "before" } };
    facts.exceptions = [{
      id: "exception-1", studentId: "student-1",
      programAssignmentId: "assignment-1", exceptionType: "other",
      status: "active", requirementId: "requirement-1", academicRuleId: null,
      creditRecordId: null, supersedesExceptionId: null, approvedBy: null,
      rationale: "test", effectiveFrom: null, effectiveTo: null,
      metadata,
      createdAt: new Date(asOf),
    }];
    const placement = {
      exceptionId: "exception-1", requirementId: "requirement-1",
      academicRuleId: null, creditRecordId: null, evidenceId: null,
      metadata: { nested: { value: "placement" } },
    };
    facts.exceptionPlacements = [placement] as never;
    const output = assemble(facts);
    expect(output.status).toBe("ACCEPTED");
    expect(Object.isFrozen(metadata)).toBe(false);
    expect(Object.isFrozen(metadata.nested)).toBe(false);
    expect(Object.isFrozen(placement.metadata)).toBe(false);
    if (output.status === "ACCEPTED") {
      expect(() => {
        (output.compositionInput.exceptions[0].metadata as Record<string, unknown>).nested = {};
      }).toThrow();
      expect(metadata.nested.value).toBe("before");
      expect(placement.metadata.nested.value).toBe("placement");
    }
  });

  it("derives a requirement-declared rule conflict through the repository path", () => {
    const sourceFacts = baseFacts();
    const ruleClaim = {
      id: "rule-claim", claimType: "academic_rule",
      subjectType: "academic_rule", subjectId: "rule-1",
      currentVersionId: "rule-version", status: "confirmed",
    };
    const ruleVersion = {
      id: "rule-version", claimId: "rule-claim", status: "confirmed",
      normalizedValue: { projectionKind: "RULE", expression: "x" },
    };
    const requirementVersion = {
      ...sourceFacts.claimVersions[0],
      normalizedValue: {
        projectionKind: "QUANTITATIVE_REQUIREMENT", kind: "minimum",
        unit: "credits", requiredAmount: "3", academicRuleId: "rule-1",
      },
    };
    const conflict = {
      id: "rule-conflict", status: "open", claimVersionAId: "rule-version",
      claimVersionBId: "claim-version-1", conflictType: "contradiction",
      description: "rule conflict", resolutionNotes: null, resolvedBy: null,
      resolvedAt: null, createdAt: new Date(asOf),
      requirementId: null, academicRuleId: null,
    };
    const derived = deriveDegreeEvaluationConflictFacts({
      requirements: sourceFacts.requirements,
      claims: [ruleClaim, ...sourceFacts.claims],
      claimVersions: [ruleVersion, requirementVersion],
      claimEvidence: [
        ...sourceFacts.claimEvidence!,
        { claimVersionId: "rule-version", evidenceExcerptId: "excerpt-1", relationshipType: "supports" },
      ],
      evidenceExcerpts: sourceFacts.evidenceExcerpts!,
      evidenceSources: sourceFacts.evidenceSources,
      academicRules: [{
        id: "rule-1", programVersionId: "program-version-1",
        claimVersionId: "rule-version",
      }],
      placements: [],
      exceptions: [],
      conflicts: [conflict],
    });
    expect(derived.conflicts[0].requirementId).toBe("requirement-1");
    const output = assemble({
      ...sourceFacts,
      claims: [ruleClaim, ...sourceFacts.claims],
      claimVersions: [ruleVersion, requirementVersion],
      claimEvidence: [
        ...sourceFacts.claimEvidence!,
        { claimVersionId: "rule-version", evidenceExcerptId: "excerpt-1", relationshipType: "supports" },
      ],
      academicRules: [{
        id: "rule-1", programVersionId: "program-version-1",
        claimVersionId: "rule-version",
      }],
      requirementProvenance: derived.requirementProvenance,
      conflicts: derived.conflicts,
      conflictProvenance: derived.conflictProvenance,
    });
    expect(output.status).toBe("ACCEPTED");
  });
});