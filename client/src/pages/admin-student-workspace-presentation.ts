export const ADMIN_STUDENT_WORKSPACE_QUERY_KEY = (studentId: string) =>
  [`/api/admin/students/${encodeURIComponent(studentId)}/workspace`] as const;
export const ADMIN_STUDENT_WORKSPACE_QUERY_OPTIONS = {
  staleTime: 0,
  refetchOnMount: true,
} as const;
export const adminStudentWorkspacePath = (studentId: string) =>
  `/admin/students/${encodeURIComponent(studentId)}`;
export const ADMIN_TABS = ["overview", "users", "students", "programs", "logs"] as const;
export type AdminTab = typeof ADMIN_TABS[number];
export const ADMIN_STUDENTS_PATH = "/admin?tab=students";

export function adminTabFromSearch(search: string): AdminTab {
  const tab = new URLSearchParams(search).get("tab");
  return ADMIN_TABS.includes(tab as AdminTab) ? tab as AdminTab : "overview";
}

export function adminTabPath(tab: AdminTab): string {
  return tab === "overview" ? "/admin" : `/admin?tab=${tab}`;
}

export type WorkspaceRecord = Record<string, unknown>;
export type AttentionStatus = "MANUAL_REVIEW" | "CONFLICT" | "MISSING" | "PARTIAL";
export type AttentionGroupName = "manualReview" | "missing" | "partial" | "conflict";
export interface WorkspaceAttentionItem extends WorkspaceRecord {
  status?: AttentionStatus | string;
  requirementId?: string;
  academicRuleId?: string;
  reason?: string;
}
const diagnosticItemMarker = Symbol("admin-student-workspace-diagnostic");
export interface DiagnosticAttentionItem {
  readonly kind: "diagnostic" | "integration-diagnostic";
  readonly diagnostic: unknown;
  readonly [diagnosticItemMarker]: true;
}
export type VisibleAttentionItem = WorkspaceAttentionItem | DiagnosticAttentionItem;

export function isDiagnosticAttentionItem(item: VisibleAttentionItem): item is DiagnosticAttentionItem {
  return (item as DiagnosticAttentionItem)[diagnosticItemMarker] === true;
}

function diagnosticItem(
  kind: DiagnosticAttentionItem["kind"],
  diagnostic: unknown,
): DiagnosticAttentionItem {
  const item = { kind, diagnostic } as DiagnosticAttentionItem;
  Object.defineProperty(item, diagnosticItemMarker, { value: true });
  return item;
}
export interface WorkspaceViewModel {
  readonly student?: unknown;
  readonly assignment?: unknown;
  readonly program?: unknown;
  readonly programVersion?: unknown;
  readonly snapshot?: unknown;
  readonly asOf?: unknown;
  readonly snapshotFingerprint?: unknown;
  readonly report?: WorkspaceRecord;
  readonly academicDetail: WorkspaceAcademicDetailViewModel;
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
export interface WorkspaceAcademicDetailViewModel {
  readonly academicSources: readonly WorkspaceRecord[];
  readonly creditRecords: readonly WorkspaceRecord[];
  readonly latestVerifications: Readonly<Record<string, WorkspaceRecord>>;
  readonly latestDecisions: Readonly<Record<string, WorkspaceRecord>>;
  readonly placements: readonly WorkspaceRecord[];
}
export interface WorkspaceAcademicCreditRow {
  readonly creditRecord: WorkspaceRecord;
  readonly source?: WorkspaceRecord;
  readonly latestVerification?: WorkspaceRecord;
  readonly latestDecision?: WorkspaceRecord;
  readonly placements: readonly WorkspaceRecord[];
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
const asRecords = (value: unknown): readonly WorkspaceRecord[] =>
  asArray(value).filter(isRecord);
const asRecordMap = (value: unknown): Readonly<Record<string, WorkspaceRecord>> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, WorkspaceRecord] =>
    isRecord(entry[1])));
};
const statusForGroup = (group: AttentionGroupName): AttentionStatus =>
  group === "manualReview" ? "MANUAL_REVIEW" : group.toUpperCase() as AttentionStatus;

export function attentionItemStatus(viewModel: WorkspaceViewModel, item: WorkspaceAttentionItem): AttentionStatus | string | undefined {
  for (const status of statuses) {
    if (viewModel.attention.grouped[status].includes(item)) return status;
  }
  return item.status;
}

export function diagnosticItemStatus(item: DiagnosticAttentionItem): string | undefined {
  return isRecord(item.diagnostic) ? asString(item.diagnostic.status) : undefined;
}

export function attentionItemLabel(labels: WorkspaceLabels, item: WorkspaceAttentionItem): string {
  const requirementId = asString(item.requirementId);
  if (requirementId) return labels.requirements[requirementId]?.label ?? requirementId;
  const academicRuleId = asString(item.academicRuleId);
  if (academicRuleId) return labels.academicRules[academicRuleId]?.label ?? academicRuleId;
  return "Report review";
}

export function toWorkspaceViewModel(workspace: WorkspaceRecord): WorkspaceViewModel {
  const report = isRecord(workspace.report) ? workspace.report : {};
  const rawNeeds = isRecord(workspace.needsAttention) ? workspace.needsAttention : {};
  const rawGroups = isRecord(rawNeeds.groups) ? rawNeeds.groups : {};
  const grouped: Record<AttentionStatus, WorkspaceAttentionItem[]> = {
    MANUAL_REVIEW: [], CONFLICT: [], MISSING: [], PARTIAL: [],
  };
  const items: VisibleAttentionItem[] = [];
  for (const group of groupNames) {
    for (const raw of asArray(rawGroups[group])) {
      const item = asItem(raw);
      // Group membership is authoritative. Keep the server item untouched;
      // callers can use attentionItemStatus for a display-only group badge.
      grouped[statusForGroup(group)].push(item);
      items.push(item);
    }
  }

  const diagnostics = asArray(rawNeeds.diagnostics);
  const authoritativeIntegrationDiagnostics = asArray(rawNeeds.integrationDiagnostics);
  // The sidecar is authoritative whenever present, including when it is an
  // empty array. Never concatenate report-level provenance diagnostics.
  const integrationDiagnostics = authoritativeIntegrationDiagnostics;
  const provenanceIntegrationDiagnostics = authoritativeIntegrationDiagnostics;
  for (const diagnostic of diagnostics) {
    items.push(diagnosticItem("diagnostic", diagnostic));
  }
  for (const diagnostic of integrationDiagnostics) {
    items.push(diagnosticItem("integration-diagnostic", diagnostic));
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
    if (isDiagnosticAttentionItem(item)) continue;
    const id = item.requirementId;
    if (id && !requirements[id]) requirements[id] = { label: id, source: "id-fallback" };
  }
  const reasons = asArray(rawNeeds.reasons).filter((reason): reason is string => typeof reason === "string");
  const evidence = items.filter((item): item is WorkspaceAttentionItem => !isDiagnosticAttentionItem(item))
    .map((item) => item.evidence).filter((item) => item !== undefined);
  const rawAcademicDetail = isRecord(workspace.academicDetail) ? workspace.academicDetail : {};
  const academicDetail: WorkspaceAcademicDetailViewModel = {
    academicSources: asRecords(rawAcademicDetail.academicSources),
    creditRecords: asRecords(rawAcademicDetail.creditRecords),
    latestVerifications: asRecordMap(rawAcademicDetail.latestVerifications),
    latestDecisions: asRecordMap(rawAcademicDetail.latestDecisions),
    placements: asRecords(rawAcademicDetail.placements),
  };
  return {
    student: workspace.student, assignment: workspace.assignment, program: workspace.program,
    programVersion: workspace.programVersion, snapshot: workspace.snapshot,
    asOf: workspace.asOf, snapshotFingerprint: workspace.snapshotFingerprint, report,
    academicDetail,
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

export function academicCreditRows(
  detail: WorkspaceAcademicDetailViewModel,
): readonly WorkspaceAcademicCreditRow[] {
  const sources = new Map(detail.academicSources.map((source) => [asString(source.id), source]));
  const placementsByDecision = new Map<string, WorkspaceRecord[]>();
  for (const placement of detail.placements) {
    const decisionId = asString(placement.studentCreditDecisionId);
    if (!decisionId) continue;
    const group = placementsByDecision.get(decisionId) ?? [];
    group.push(placement);
    placementsByDecision.set(decisionId, group);
  }
  return detail.creditRecords.map((creditRecord) => {
    const creditRecordId = asString(creditRecord.id);
    const latestDecision = creditRecordId ? detail.latestDecisions[creditRecordId] : undefined;
    const decisionId = latestDecision ? asString(latestDecision.id) : undefined;
    return {
      creditRecord,
      source: sources.get(asString(creditRecord.sourceId)),
      latestVerification: creditRecordId
        ? detail.latestVerifications[creditRecordId]
        : undefined,
      latestDecision,
      placements: decisionId ? placementsByDecision.get(decisionId) ?? [] : [],
    };
  });
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