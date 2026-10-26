import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLACEMENT_OUTCOME_UNKNOWN_MESSAGE,
  unknownPlacementOutcome,
  canCreatePlacement,
  canRevokePlacement,
  canSupersedePlacement,
  canonicalLabelOptions,
  classifyPlacementWorkflowError,
  createPlacementBody,
  placementActionCopy,
  placementDialogLocked,
  placementEndpoint,
  placementMutationOutcome,
  placementRequirementLabel,
  placementSuccessMessage,
  placementWritesEnabled,
  revokePlacementBody,
  supersedePlacementBody,
  validSnapshotFingerprint,
} from "@/pages/controlled-placement-workflow";

const fingerprint = `sha256:${"a".repeat(64)}`;

describe("Phase 5C.2 controlled placement UI safety helpers", () => {
  it("builds only the authoritative create endpoint and allowed body fields", () => {
    expect(placementEndpoint("student / 1", "create")).toBe(
      "/api/admin/students/student%20%2F%201/placements",
    );
    expect(createPlacementBody({
      expectedSnapshotFingerprint: fingerprint,
      studentCreditDecisionId: "decision-1",
      requirementId: "requirement-1",
      academicRuleId: null,
      rationale: "Operator rationale",
      actor: "forbidden",
      studentId: "forbidden",
      programAssignmentId: "forbidden",
      metadata: {},
      provenance: {},
    } as any)).toEqual({
      expectedSnapshotFingerprint: fingerprint,
      studentCreditDecisionId: "decision-1",
      requirementId: "requirement-1",
      academicRuleId: null,
      rationale: "Operator rationale",
    });
  });

  it("builds only the authoritative supersede endpoint and allowed body fields", () => {
    expect(placementEndpoint("student-1", "supersede", "placement / 1")).toBe(
      "/api/admin/students/student-1/placements/placement%20%2F%201/supersede",
    );
    expect(supersedePlacementBody({
      expectedSnapshotFingerprint: fingerprint,
      requirementId: "requirement-2",
      academicRuleId: "rule-1",
      rationale: "Move placement",
      actor: "forbidden",
      studentId: "forbidden",
      programAssignmentId: "forbidden",
      metadata: {},
      provenance: {},
    } as any)).toEqual({
      expectedSnapshotFingerprint: fingerprint,
      requirementId: "requirement-2",
      academicRuleId: "rule-1",
      rationale: "Move placement",
    });
  });

  it("builds only the authoritative revoke endpoint and allowed body fields", () => {
    expect(placementEndpoint("student-1", "revoke", "placement-1")).toBe(
      "/api/admin/students/student-1/placements/placement-1/revoke",
    );
    expect(revokePlacementBody({
      expectedSnapshotFingerprint: fingerprint,
      rationale: "No longer applicable",
      actor: "forbidden",
      requirementId: "forbidden",
      metadata: {},
    } as any)).toEqual({
      expectedSnapshotFingerprint: fingerprint,
      rationale: "No longer applicable",
    });
  });

  it("enables writes only for a canonical fingerprint", () => {
    expect(validSnapshotFingerprint(fingerprint)).toBe(true);
    expect(placementWritesEnabled(fingerprint)).toBe(true);
    expect(placementWritesEnabled(fingerprint, true)).toBe(false);
    expect(placementWritesEnabled(fingerprint, false, true)).toBe(false);
    expect(placementWritesEnabled(undefined)).toBe(false);
    expect(validSnapshotFingerprint(undefined)).toBe(false);
    expect(validSnapshotFingerprint("sha256:not-valid")).toBe(false);
    expect(validSnapshotFingerprint(`SHA256:${"a".repeat(64)}`)).toBe(false);
  });

  it("locks an open dialog immediately when writes lock, a request is pending, or a stale draft is retained", () => {
    expect(placementDialogLocked(false, false, false)).toBe(false);
    expect(placementDialogLocked(true, false, false)).toBe(true);
    expect(placementDialogLocked(false, true, false)).toBe(true);
    expect(placementDialogLocked(false, false, true)).toBe(true);
  });

  it("uses plain placement action language", () => {
    expect(placementActionCopy("supersede")).toEqual({
      trigger: "Replace this placement",
      confirm: "Replace placement",
      completed: "Placement replaced.",
    });
    expect(placementActionCopy("revoke").trigger).toBe("Revoke placement");
  });

  it("claims workspace refresh only after a valid refreshed snapshot", () => {
    expect(placementSuccessMessage("create", true)).toBe(
      "Placement added. The student workspace was refreshed.",
    );
    expect(placementSuccessMessage("create", false)).toBe(
      "Placement added. The workspace could not be refreshed. Review the latest student record before making another change.",
    );
  });

  it("uses human labels, excludes id fallbacks, and sorts by label then id", () => {
    expect(canonicalLabelOptions({
      "requirement-z": { label: "Writing", source: "canonical" },
      "requirement-b": { label: "Quantitative reasoning", source: "canonical" },
      "requirement-a": { label: "Quantitative reasoning", source: "canonical" },
      "requirement-id": { label: "requirement-id", source: "id-fallback" },
    })).toEqual([
      { id: "requirement-a", label: "Quantitative reasoning" },
      { id: "requirement-b", label: "Quantitative reasoning" },
      { id: "requirement-z", label: "Writing" },
    ]);
  });

  it("keeps the placement requirement record-specific when a display label is missing", () => {
    const labels = {
      requirements: {},
      academicRules: {},
      programs: {},
      programVersions: {},
    };
    expect(placementRequirementLabel(
      { requirementId: "requirement-42" },
      labels,
    )).toBe("Requirement requirement-42");
    expect(placementRequirementLabel(
      { requirementId: null, academicRuleId: "rule-7" },
      labels,
    )).toBe("Academic rule rule-7");
    expect(placementRequirementLabel({}, labels)).toBe("Requirement unavailable");
  });

  it("offers create only for a latest accepted decision with an id", () => {
    expect(canCreatePlacement({ id: "decision-1", action: "accepted" })).toBe(true);
    expect(canCreatePlacement({ id: "decision-1", action: "rejected" })).toBe(false);
    expect(canCreatePlacement({ action: "accepted" })).toBe(false);
  });

  it("gates supersede to active placements tied to the latest accepted decision", () => {
    const decision = { id: "decision-1", action: "accepted" };
    expect(canSupersedePlacement({
      id: "placement-1",
      status: "active",
      studentCreditDecisionId: "decision-1",
    }, decision)).toBe(true);
    expect(canSupersedePlacement({
      id: "placement-1",
      status: "superseded",
      studentCreditDecisionId: "decision-1",
    }, decision)).toBe(false);
    expect(canSupersedePlacement({
      id: "placement-1",
      status: "active",
      studentCreditDecisionId: "decision-older",
    }, decision)).toBe(false);
  });

  it("offers revoke for any active placement with an id", () => {
    expect(canRevokePlacement({ id: "placement-1", status: "active" })).toBe(true);
    expect(canRevokePlacement({ id: "placement-1", status: "revoked" })).toBe(false);
    expect(canRevokePlacement({ status: "active" })).toBe(false);
  });

  it("classifies exact stale and unavailable workflow errors distinctly", () => {
    expect(classifyPlacementWorkflowError(409, {
      error: { code: "PLACEMENT_WORKFLOW_STALE_SNAPSHOT", message: "server stale" },
    }).kind).toBe("stale");
    expect(classifyPlacementWorkflowError(409, {
      error: { code: "STUDENT_ACADEMIC_INVALID_STATE", message: "Safe conflict" },
    })).toEqual({ kind: "conflict", message: "Safe conflict" });
    expect(classifyPlacementWorkflowError(500, {
      error: { code: "PLACEMENT_WORKFLOW_SNAPSHOT_UNAVAILABLE" },
    }).kind).toBe("snapshot-unavailable");
  });

  it("treats unexpected, 5xx, unparseable and unknown-status responses as an unknown outcome", () => {
    const cases: Array<[number, unknown]> = [
      [500, { error: { code: "INTERNAL_ERROR", message: "Internal Server Error" } }],
      [502, null],
      [503, "<html>"],
      [418, { error: { code: "SOMETHING" } }],
      [409, { error: "no code" }],
      [401, { error: { code: "UNAUTHORIZED" } }],
    ];
    for (const [status, payload] of cases) {
      const result = classifyPlacementWorkflowError(status, payload);
      expect(result.kind).toBe("unexpected");
      expect(result.message).toBe(PLACEMENT_OUTCOME_UNKNOWN_MESSAGE);
      expect(result.message).not.toMatch(/no change|not saved|nothing/i);
    }
    expect(unknownPlacementOutcome().message).toContain("could not be confirmed");
    expect(placementMutationOutcome("unexpected").refetchCanonicalWorkspace).toBe(true);
  });

  it("only claims no change for server-defined pre-write rejections", () => {
    const validation = classifyPlacementWorkflowError(400, {
      error: { code: "STUDENT_ACADEMIC_VALIDATION_ERROR", message: "rationale required" },
    });
    expect(validation.kind).toBe("rejected");
    expect(validation.message).toContain("No changes were applied.");
    expect(classifyPlacementWorkflowError(404, {
      error: { code: "PLACEMENT_WORKFLOW_CONTEXT_NOT_FOUND" },
    }).kind).toBe("rejected");
    expect(placementMutationOutcome("rejected").refetchCanonicalWorkspace).toBe(false);
  });

  it("dialog never asserts no change on network/parse failures and refetches", async () => {
    const source = readFileSync(
      resolve(__dirname, "../client/src/components/placement-action-dialog.tsx"), "utf8");
    expect(source).not.toMatch(/No changes were applied/);
    expect(source.match(/unknownPlacementOutcome\(\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("refreshes without retry or optimistic patch and preserves stale drafts", () => {
    expect(placementMutationOutcome("success")).toEqual({
      refetchCanonicalWorkspace: true,
      retryAutomatically: false,
      resetDialog: true,
      optimisticPatch: false,
    });
    expect(placementMutationOutcome("stale")).toEqual({
      refetchCanonicalWorkspace: true,
      retryAutomatically: false,
      resetDialog: false,
      optimisticPatch: false,
    });
    expect(placementMutationOutcome("conflict")).toMatchObject({
      refetchCanonicalWorkspace: false,
      retryAutomatically: false,
      optimisticPatch: false,
    });
  });
});