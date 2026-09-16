export const ADMIN_STUDENT_WORKSPACE_QUERY_KEY = (studentId: string) =>
  [`/api/admin/students/${encodeURIComponent(studentId)}/workspace`] as const;
export const adminStudentWorkspacePath = (studentId: string) =>
  `/admin/students/${encodeURIComponent(studentId)}`;

export type WorkspaceRecord = Record<string, unknown>;
export type AttentionStatus = "MANUAL_REVIEW" | "CONFLICT" | "MISSING" | "PARTIAL";
export type AttentionGroupName = "manualReview" | "missing" | "partial" | "conflict";
export interface WorkspaceAttentionItem extends WorkspaceRecord {
  status?: AttentionStatus | string;
  requirementId?: string;
  academicRuleId?: string;
  reason?: string;
}
export interface DiagnosticAttentionItem {
  readonly kind: "diagnostic" | "integration-diagnostic";
  readonly diagnostic: unknown;
  readonly status: "MANUAL_REVIEW";
}
export type VisibleAttentionItem = WorkspaceAttentionItem | DiagnosticAttentionItem;
export interface WorkspaceViewModel {
  readonly student?: unknown;
  readonly assignment?: unknown;
  readonly program?: unknown;
  readonly programVersion?: unknown;
  readonly snapshot?: unknown;
  readonly asOf?: unknown;
  readonly snapshotFingerprint?: unknown;
  readonly report?: WorkspaceRecord;
  readonly labels: WorkspaceLabels;
  readonly attention: {
    readonly total: number;
    readonly items: readonly VisibleAttentionItem[];
    readonly grouped: Readonly<Record<AttentionStatus, readonly WorkspaceAttentionItem[]>>;
    readonly hasAttention: boolean;
  };
  readonly provenance: {
    readonly evidence: readonly unknown[];
    readonly reasons: readonly string[];
    readonly diagnostics: readonly unknown[];
    readonly integrationDiagnostics: readonly unknown[];
    readonly reportStatus?: string;
  };
}
export interface WorkspaceLabels {
  readonly requirements: Record<string, { label: string; source: string }>;
  readonly academicRules: Record<string, { label: string; source: string }>;
  readonly [key: string]: unknown;
}

const statuses: readonly AttentionStatus[] = ["MANUAL_REVIEW", "CONFLICT", "MISSING", "PARTIAL"];
const groupNames: readonly AttentionGroupName[] = ["manualReview", "missing", "partial", "conflict"];
const isRecord = (value: unknown): value is WorkspaceRecord =>
  !!value && typeof value === "object" && !Array.isArray(value);
const asArray = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];
const asString = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
const asItem = (value: unknown): WorkspaceAttentionItem =>
  isRecord(value) ? value as WorkspaceAttentionItem : { value };
const statusForGroup = (group: AttentionGroupName): AttentionStatus =>
  group === "manualReview" ? "MANUAL_REVIEW" : group.toUpperCase() as AttentionStatus;

export function attentionItemStatus(viewModel: WorkspaceViewModel, item: WorkspaceAttentionItem): AttentionStatus | string {
  for (const status of statuses) {
    if (viewModel.attention.grouped[status].includes(item)) return status;
  }
  return item.status ?? "MANUAL_REVIEW";
}

export function attentionItemLabel(labels: WorkspaceLabels, item: WorkspaceAttentionItem): string {
  const requirementId = asString(item.requirementId);
  if (requirementId) return labels.requirements[requirementId]?.label ?? requirementId;
  const academicRuleId = asString(item.academicRuleId);
  if (academicRuleId) return labels.academicRules[academicRuleId]?.label ?? academicRuleId;
  return "Report review";
}

function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableKey(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function uniquePush(items: VisibleAttentionItem[], seen: Set<string>, item: VisibleAttentionItem): void {
  const identity = item.kind
    ? `${item.kind}:${stableKey(item.diagnostic)}`
    : `${item.status ?? "UNKNOWN"}:${stableKey(item)}`;
  if (seen.has(identity)) return;
  seen.add(identity);
  items.push(item);
}

export function toWorkspaceViewModel(workspace: WorkspaceRecord): WorkspaceViewModel {
  const report = isRecord(workspace.report) ? workspace.report : {};
  const rawNeeds = isRecord(workspace.needsAttention) ? workspace.needsAttention : {};
  const rawGroups = isRecord(rawNeeds.groups) ? rawNeeds.groups : {};
  const grouped: Record<AttentionStatus, WorkspaceAttentionItem[]> = {
    MANUAL_REVIEW: [], CONFLICT: [], MISSING: [], PARTIAL: [],
  };
  const items: VisibleAttentionItem[] = [];
  const seen = new Set<string>();
  for (const group of groupNames) {
    for (const raw of asArray(rawGroups[group])) {
      const item = asItem(raw);
      // Group membership is authoritative. Keep the server item untouched;
      // callers can use attentionItemStatus for a display-only group badge.
      grouped[statusForGroup(group)].push(item);
      uniquePush(items, seen, item);
    }
  }

  const diagnostics = asArray(rawNeeds.diagnostics);
  const authoritativeIntegrationDiagnostics = asArray(rawNeeds.integrationDiagnostics);
  // The sidecar is authoritative whenever present, including when it is an
  // empty array. Never concatenate report-level provenance diagnostics.
  const integrationDiagnostics = authoritativeIntegrationDiagnostics;
  const provenanceIntegrationDiagnostics = authoritativeIntegrationDiagnostics;
  for (const diagnostic of diagnostics) {
    uniquePush(items, seen, { kind: "diagnostic", diagnostic, status: "MANUAL_REVIEW" });
  }
  for (const diagnostic of integrationDiagnostics) {
    uniquePush(items, seen, { kind: "integration-diagnostic", diagnostic, status: "MANUAL_REVIEW" });
  }

  const labelsRecord = isRecord(workspace.displayLabels) ? workspace.displayLabels : {};
  const requirements: Record<string, { label: string; source: string }> = {};
  if (isRecord(labelsRecord.requirements)) {
    for (const [id, value] of Object.entries(labelsRecord.requirements)) {
      if (typeof value === "string") requirements[id] = { label: value, source: "canonical" };
      else if (isRecord(value) && typeof value.label === "string") requirements[id] = {
        label: value.label, source: typeof value.source === "string" ? value.source : "canonical",
      };
    }
  }
  const academicRules: Record<string, { label: string; source: string }> = {};
  if (isRecord(labelsRecord.academicRules)) {
    for (const [id, value] of Object.entries(labelsRecord.academicRules)) {
      if (typeof value === "string") academicRules[id] = { label: value, source: "canonical" };
      else if (isRecord(value) && typeof value.label === "string") academicRules[id] = {
        label: value.label, source: typeof value.source === "string" ? value.source : "canonical",
      };
    }
  }
  for (const item of items) {
    if ("kind" in item) continue;
    const id = item.requirementId;
    if (id && !requirements[id]) requirements[id] = { label: id, source: "id-fallback" };
  }
  const reasons = asArray(rawNeeds.reasons).filter((reason): reason is string => typeof reason === "string");
  const evidence = items.filter((item): item is WorkspaceAttentionItem => !("kind" in item))
    .map((item) => item.evidence).filter((item) => item !== undefined);
  return {
    student: workspace.student, assignment: workspace.assignment, program: workspace.program,
    programVersion: workspace.programVersion, snapshot: workspace.snapshot,
    asOf: workspace.asOf, snapshotFingerprint: workspace.snapshotFingerprint, report,
    labels: { ...labelsRecord, requirements, academicRules },
    attention: {
      total: items.length,
      items,
      grouped,
      hasAttention: items.length > 0,
    },
    provenance: {
      evidence, reasons,
      diagnostics, integrationDiagnostics: provenanceIntegrationDiagnostics,
      reportStatus: asString(report.status),
    },
  };
}

export type WorkspaceQueryState = {
  isLoading?: boolean;
  isError?: boolean;
  data?: unknown;
  error?: unknown;
};
export type WorkspaceQueryErrorKind = "not-found" | "error";

export function classifyWorkspaceQueryError(error: unknown): WorkspaceQueryErrorKind {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const statusMatch = message.match(/^\s*(\d{3})(?::|\s|$)/);
  return statusMatch?.[1] === "404" ? "not-found" : "error";
}

export function selectWorkspaceState(query: WorkspaceQueryState):
  | { kind: "loading"; role: "status"; ariaLive: "polite" }
  | { kind: "error"; error?: unknown }
  | { kind: "empty"; reason?: "not-found" }
  | { kind: "ready"; viewModel: WorkspaceViewModel } {
  if (query.isLoading) return { kind: "loading", role: "status", ariaLive: "polite" };
  if (query.isError) {
    return classifyWorkspaceQueryError(query.error) === "not-found"
      ? { kind: "empty", reason: "not-found" }
      : { kind: "error", error: query.error };
  }
  if (!isRecord(query.data)) return { kind: "empty" };
  return { kind: "ready", viewModel: toWorkspaceViewModel(query.data) };
}