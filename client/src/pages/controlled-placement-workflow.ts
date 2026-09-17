import type {
  WorkspaceLabels,
  WorkspaceRecord,
} from "./admin-student-workspace-presentation";

const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;

export type PlacementOperation = "create" | "supersede" | "revoke";

export interface CanonicalLabelOption {
  readonly id: string;
  readonly label: string;
}

export type PlacementWorkflowErrorKind =
  | "stale"
  | "snapshot-unavailable"
  | "conflict"
  | "unexpected";

export interface PlacementWorkflowError {
  readonly kind: PlacementWorkflowErrorKind;
  readonly message: string;
}

export interface PlacementMutationOutcome {
  readonly refetchCanonicalWorkspace: boolean;
  readonly retryAutomatically: false;
  readonly resetDialog: boolean;
  readonly optimisticPatch: false;
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

export function validSnapshotFingerprint(value: unknown): value is string {
  return typeof value === "string" && FINGERPRINT_PATTERN.test(value);
}

export function placementWritesEnabled(
  fingerprint: unknown,
  snapshotUnavailable = false,
  workspaceRefreshing = false,
): fingerprint is string {
  return validSnapshotFingerprint(fingerprint)
    && !snapshotUnavailable
    && !workspaceRefreshing;
}

export function canonicalLabelOptions(
  labels: WorkspaceLabels["requirements"] | WorkspaceLabels["academicRules"],
): readonly CanonicalLabelOption[] {
  return Object.entries(labels)
    .filter(([id, entry]) => {
      const label = entry.label.trim();
      return label.length > 0 && entry.source !== "id-fallback" && label !== id;
    })
    .map(([id, entry]) => ({ id, label: entry.label.trim() }))
    .sort((left, right) =>
      left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

export function placementEndpoint(
  studentId: string,
  operation: PlacementOperation,
  placementId?: string,
): string {
  const base = `/api/admin/students/${encodeURIComponent(studentId)}/placements`;
  if (operation === "create") return base;
  if (!placementId) throw new Error("placementId is required");
  return `${base}/${encodeURIComponent(placementId)}/${operation === "supersede" ? "supersede" : "revoke"}`;
}

export function createPlacementBody(input: {
  expectedSnapshotFingerprint: string;
  studentCreditDecisionId: string;
  requirementId: string;
  academicRuleId?: string | null;
  rationale: string;
}) {
  return {
    expectedSnapshotFingerprint: input.expectedSnapshotFingerprint,
    studentCreditDecisionId: input.studentCreditDecisionId,
    requirementId: input.requirementId,
    academicRuleId: input.academicRuleId ?? null,
    rationale: input.rationale,
  };
}

export function supersedePlacementBody(input: {
  expectedSnapshotFingerprint: string;
  requirementId: string;
  academicRuleId?: string | null;
  rationale: string;
}) {
  return {
    expectedSnapshotFingerprint: input.expectedSnapshotFingerprint,
    requirementId: input.requirementId,
    academicRuleId: input.academicRuleId ?? null,
    rationale: input.rationale,
  };
}

export function revokePlacementBody(input: {
  expectedSnapshotFingerprint: string;
  rationale: string;
}) {
  return {
    expectedSnapshotFingerprint: input.expectedSnapshotFingerprint,
    rationale: input.rationale,
  };
}

export function canCreatePlacement(decision: WorkspaceRecord | undefined): boolean {
  return decision?.action === "accepted" && asString(decision.id) !== undefined;
}

export function canSupersedePlacement(
  placement: WorkspaceRecord,
  latestDecision: WorkspaceRecord | undefined,
): boolean {
  return placement.status === "active"
    && canCreatePlacement(latestDecision)
    && asString(placement.studentCreditDecisionId) === asString(latestDecision?.id);
}

export function canRevokePlacement(placement: WorkspaceRecord): boolean {
  return placement.status === "active" && asString(placement.id) !== undefined;
}

export function classifyPlacementWorkflowError(
  status: number,
  payload: unknown,
): PlacementWorkflowError {
  const error = payload && typeof payload === "object"
    ? (payload as { error?: unknown }).error
    : undefined;
  const detail = error && typeof error === "object"
    ? error as { code?: unknown; message?: unknown }
    : {};
  const code = asString(detail.code);
  const message = asString(detail.message);
  if (status === 409 && code === "PLACEMENT_WORKFLOW_STALE_SNAPSHOT") {
    return {
      kind: "stale",
      message: "The workspace changed. Review the refreshed canonical workspace before trying again.",
    };
  }
  if (status === 500 && code === "PLACEMENT_WORKFLOW_SNAPSHOT_UNAVAILABLE") {
    return {
      kind: "snapshot-unavailable",
      message: "The canonical snapshot is unavailable. Placement writes remain disabled until it refreshes.",
    };
  }
  if (status === 409) {
    return {
      kind: "conflict",
      message: message ?? "The placement could not be changed because the canonical record is in conflict.",
    };
  }
  return {
    kind: "unexpected",
    message: "The placement request could not be completed. No changes were applied.",
  };
}

export function placementMutationOutcome(
  result: "success" | PlacementWorkflowErrorKind,
): PlacementMutationOutcome {
  return {
    refetchCanonicalWorkspace: result === "success" || result === "stale",
    retryAutomatically: false,
    resetDialog: result === "success" || result === "stale",
    optimisticPatch: false,
  };
}