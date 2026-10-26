import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  assembleDegreeEvaluationSnapshot,
  type DegreeEvaluationRawBundle,
} from "../shared/degree-evaluation-snapshot";
import { readDegreeEvaluationSnapshotFacts } from "../server/repositories/degree-evaluation-snapshot-repo";
import { composeDegreeProgress } from "../shared/degree-progress-composition";
import {
  requirementsV2,
  programVersions,
} from "@shared/knowledge-schema";
import {
  studentAcademicExceptions,
  studentProgramAssignments,
} from "@shared/student-academic-schema";
import { studentCreditPlacements } from "@shared/student-credit-placement-schema";

const context = {
  studentId: "student-1",
  programAssignmentId: "assignment-1",
  programVersionId: "program-version-1",
} as const;
const asOf = "2025-01-01T00:00:00.000Z";
// Fingerprint of this exact baseline fixture computed on commit 8f97ae9,
// before the inactive-referenced-requirement change.
const BASELINE_FINGERPRINT =
  "sha256:9a18519ccf281cae9d5d398677c49dfc302f5ed5c3d68c66dd817e08c7378cd6";

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
      projectionKind: "QUANTITATIVE_REQUIREMENT", kind: "minimum",
      unit: "credits", requiredAmount: "3", academicRuleId: null,
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
  creditRecords: [{
    id: "credit-1", studentId: "student-1", sourceId: "academic-source-1",
    status: "verified",
  }],
  academicSources: [{ id: "academic-source-1", studentId: "student-1" }],
  verificationEvents: [
    { id: "verification-1", creditRecordId: "credit-1", seq: 1, action: "verified" },
  ],
  decisions: [{
    id: "decision-1", creditRecordId: "credit-1",
    programAssignmentId: "assignment-1", seq: 1, action: "accepted",
    creditsAwarded: "3", basisClaimVersionId: null,
    equivalencyId: null, targetInstitutionCourseVersionId: null,
  }],
  placements: [],
  exceptions: [],
});

const withInactive = (facts: DegreeEvaluationRawBundle): DegreeEvaluationRawBundle => ({
  ...facts,
  inactiveReferencedRequirements: [{
    id: "requirement-old", programVersionId: "program-version-1",
    active: false, creditsRequired: 3, kind: "minimum", unit: "credits",
  }],
});
const placement = (id: string, requirementId: string, status: string) => ({
  id, studentCreditDecisionId: "decision-1", programAssignmentId: "assignment-1",
  requirementId, academicRuleId: null, status,
});
const exception = (id: string, requirementId: string, status: string) => ({
  id, studentId: "student-1", programAssignmentId: "assignment-1",
  exceptionType: "other", status, requirementId, academicRuleId: null,
  creditRecordId: null, supersedesExceptionId: null, approvedBy: null,
  rationale: "recorded", effectiveFrom: null, effectiveTo: null,
  metadata: {}, createdAt: new Date(asOf),
});
const assemble = (facts: DegreeEvaluationRawBundle) =>
  assembleDegreeEvaluationSnapshot({ context, asOf, facts });
const reasons = (output: ReturnType<typeof assemble>) =>
  output.status === "MANUAL_REVIEW" ? output.diagnostics.map((d) => d.reason) : [];

describe("deactivated requirements in the degree evaluation snapshot", () => {
  it.each(["revoked", "superseded"])(
    "composes when a %s placement is bound to a deactivated requirement and retains it",
    async (status) => {
      const facts = withInactive(baseFacts());
      facts.placements.push(placement("placement-old", "requirement-old", status) as never);
      const output = assemble(facts);
      expect(output.status).toBe("ACCEPTED");
      if (output.status !== "ACCEPTED") return;
      expect(output.occurrences.filter((o) => o.occurrenceKind === "studentCreditPlacement")
        .map((o) => o.occurrenceId)).toEqual(["placement-old"]);
      expect(output.occurrences.filter((o) => o.occurrenceKind === "inactiveReferencedRequirement")
        .map((o) => o.occurrenceId)).toEqual(["requirement-old"]);
      expect(output.compositionInput.requirements.map((r) => r.requirementId))
        .toEqual(["requirement-1"]);
      expect(output.compositionInput.associations).toHaveLength(0);
      const composed = composeDegreeProgress(output.compositionInput) as { compositionKind: string; status?: string };
      expect(composed.compositionKind).toBe("COMPOSED");
      expect(composed.status).toBeUndefined();
    },
  );

  it("fails closed with a specific code for an active placement on a deactivated requirement", () => {
    const facts = withInactive(baseFacts());
    facts.placements.push(placement("placement-old", "requirement-old", "active") as never);
    const output = assemble(facts);
    expect(output.status).toBe("MANUAL_REVIEW");
    expect(reasons(output)).toEqual(["PLACEMENT_BOUND_TO_INACTIVE_REQUIREMENT"]);
  });

  it.each(["revoked", "superseded"])(
    "composes with a %s exception targeting a deactivated requirement",
    async (status) => {
      const facts = withInactive(baseFacts());
      facts.exceptions.push(exception("exception-old", "requirement-old", status) as never);
      const output = assemble(facts);
      expect(output.status).toBe("ACCEPTED");
      if (output.status !== "ACCEPTED") return;
      expect(output.occurrences.filter((o) => o.occurrenceKind === "exception")
        .map((o) => o.occurrenceId)).toEqual(["exception-old"]);
      const composed = composeDegreeProgress(output.compositionInput) as { compositionKind: string; status?: string };
      expect(composed.compositionKind).toBe("COMPOSED");
      expect(composed.status).toBeUndefined();
    },
  );

  it("fails closed with a specific code for an active exception on a deactivated requirement", () => {
    const facts = withInactive(baseFacts());
    facts.exceptions.push(exception("exception-old", "requirement-old", "active") as never);
    const output = assemble(facts);
    expect(output.status).toBe("MANUAL_REVIEW");
    expect(reasons(output)).toEqual(["EXCEPTION_BOUND_TO_INACTIVE_REQUIREMENT"]);
  });

  it("still fails with the existing codes for unknown requirement ids", () => {
    const placementFacts = withInactive(baseFacts());
    placementFacts.placements.push(placement("p", "requirement-unknown", "revoked") as never);
    expect(reasons(assemble(placementFacts))).toEqual(["INVALID_PLACEMENT_BINDING"]);
    const exceptionFacts = withInactive(baseFacts());
    exceptionFacts.exceptions.push(exception("e", "requirement-unknown", "revoked") as never);
    expect(reasons(assemble(exceptionFacts))).toEqual(["INVALID_EXCEPTION_TARGET"]);
    // Without the inactive collection a deactivated id is unknown too.
    const bare = baseFacts();
    bare.placements.push(placement("p", "requirement-old", "revoked") as never);
    expect(reasons(assemble(bare))).toEqual(["INVALID_PLACEMENT_BINDING"]);
  });

  it("rejects inactive reference rows from another program version or marked active", () => {
    const foreign = baseFacts();
    foreign.inactiveReferencedRequirements = [{
      id: "requirement-old", programVersionId: "other-version",
      active: false, creditsRequired: 3,
    }];
    foreign.placements.push(placement("p", "requirement-old", "revoked") as never);
    expect(reasons(assemble(foreign))).toContain("INVALID_INACTIVE_REQUIREMENT_FACT");
    const activeRow = baseFacts();
    activeRow.inactiveReferencedRequirements = [{
      id: "requirement-old", programVersionId: "program-version-1",
      active: true, creditsRequired: 3,
    }];
    expect(reasons(assemble(activeRow))).toContain("INVALID_INACTIVE_REQUIREMENT_FACT");
  });

  it("keeps the fingerprint byte-identical when there are no inactive references", () => {
    const output = assemble(baseFacts());
    const withEmpty = assemble({ ...baseFacts(), inactiveReferencedRequirements: [] });
    expect(output.status).toBe("ACCEPTED");
    if (output.status !== "ACCEPTED" || withEmpty.status !== "ACCEPTED") return;
    expect(JSON.stringify(withEmpty)).toBe(JSON.stringify(output));
    // Baseline fixture without credits (computed on 8f97ae9).
    const bare = baseFacts();
    bare.creditRecords = []; bare.academicSources = [];
    bare.verificationEvents = []; bare.decisions = [];
    const baseline = assemble(bare);
    if (baseline.status !== "ACCEPTED") throw new Error("baseline not accepted");
    expect(baseline.academicSnapshot.snapshotFingerprint).toBe(BASELINE_FINGERPRINT);
  });

  it("includes inactive referenced rows in the fingerprint inputs", () => {
    const plain = assemble(baseFacts());
    const facts = withInactive(baseFacts());
    facts.placements.push(placement("placement-old", "requirement-old", "revoked") as never);
    const historical = assemble(facts);
    if (plain.status !== "ACCEPTED" || historical.status !== "ACCEPTED") throw new Error("x");
    expect(historical.academicSnapshot.snapshotFingerprint)
      .not.toBe(plain.academicSnapshot.snapshotFingerprint);
    // Verified credit facts are untouched.
    expect(historical.compositionInput.creditRecords).toEqual(plain.compositionInput.creditRecords);
    expect(historical.compositionInput.decisions).toEqual(plain.compositionInput.decisions);
    expect(historical.compositionInput.verificationEvents)
      .toEqual(plain.compositionInput.verificationEvents);
  });
});

describe("repository loading of inactive referenced requirements", () => {
  const reqRow = (id: string, active: boolean, programVersionId = context.programVersionId) => ({
    id, programVersionId, code: id, title: id, description: null, creditsRequired: 3,
    levelRequirement: null, sequence: 1, ruleExpression: null, active, metadata: {},
  });
  const run = async (opts: {
    requirements: ReturnType<typeof reqRow>[];
    placements?: Array<Record<string, unknown>>;
    exceptions?: Array<Record<string, unknown>>;
  }) => {
    const calls: Array<{ params: unknown[] }> = [];
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(async (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
            const query = new PgDialect().sqlToQuery(condition);
            if (table === requirementsV2) {
              calls.push({ params: query.params });
              const pv = query.params[0];
              const onlyActive = query.params.length === 2 && query.params[1] === true;
              const inactiveQuery = query.params.includes(false);
              const ids = new Set(query.params.filter((p) => typeof p === "string"));
              return opts.requirements.filter((r) => r.programVersionId === pv
                && (onlyActive ? r.active
                  : inactiveQuery ? !r.active && ids.has(r.id) : true));
            }
            if (table === programVersions) return [{ id: context.programVersionId }];
            if (table === studentProgramAssignments) return [{
              id: context.programAssignmentId, studentId: context.studentId,
              programVersionId: context.programVersionId, status: "active",
            }];
            if (table === studentCreditPlacements) return opts.placements ?? [];
            if (table === studentAcademicExceptions) return opts.exceptions ?? [];
            return [];
          }),
        })),
      })),
    };
    const facts = await readDegreeEvaluationSnapshotFacts(context, tx as never);
    return { facts, calls };
  };

  it("does not query inactive rows when nothing references them", async () => {
    const { facts, calls } = await run({
      requirements: [reqRow("r-active", true), reqRow("r-old", false)],
    });
    expect(calls).toHaveLength(1);
    expect(facts.inactiveReferencedRequirements).toBeUndefined();
  });

  it("loads only referenced inactive rows of the same program version", async () => {
    const { facts, calls } = await run({
      requirements: [
        reqRow("r-active", true), reqRow("r-old", false), reqRow("r-unreferenced", false),
        reqRow("r-foreign", false, "other-version"),
      ],
      placements: [
        { id: "p1", requirementId: "r-old", status: "revoked", studentCreditDecisionId: "d" },
        { id: "p2", requirementId: "r-active", status: "active", studentCreditDecisionId: "d" },
      ],
      exceptions: [{ id: "e1", requirementId: "r-foreign", status: "revoked" }],
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].params).toContain(context.programVersionId);
    expect(calls[1].params).toContain(false);
    expect(calls[1].params).not.toContain("r-active");
    expect(facts.inactiveReferencedRequirements?.map((r) => r.id)).toEqual(["r-old"]);
    expect(facts.requirements.map((r) => r.id)).toEqual(["r-active"]);
  });
});
