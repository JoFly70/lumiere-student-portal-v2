import { describe, expect, it } from "vitest";
import {
  canCreatePlacement,
  canRevokePlacement,
  canSupersedePlacement,
  canonicalLabelOptions,
  classifyPlacementWorkflowError,
  createPlacementBody,
  placementEndpoint,
  placementMutationOutcome,
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

  it("refreshes without retry or optimistic patch after success or stale", () => {
    expect(placementMutationOutcome("success")).toEqual({
      refetchCanonicalWorkspace: true,
      retryAutomatically: false,
      resetDialog: true,
      optimisticPatch: false,
    });
    expect(placementMutationOutcome("stale")).toEqual({
      refetchCanonicalWorkspace: true,
      retryAutomatically: false,
      resetDialog: true,
      optimisticPatch: false,
    });
    expect(placementMutationOutcome("conflict")).toMatchObject({
      refetchCanonicalWorkspace: false,
      retryAutomatically: false,
      optimisticPatch: false,
    });
  });
});