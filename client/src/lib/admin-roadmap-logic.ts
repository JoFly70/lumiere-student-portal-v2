/**
 * Pure presentation/workflow logic for the staff roadmap page (no React, no I/O),
 * so it can be unit-tested. All server responses are authoritative: callers
 * replace their state with the returned AdminRoadmapState.
 */
import type {
  AdminRoadmapDraftView,
  RoadmapContent,
  RoadmapException,
  RoadmapExceptionAcknowledgement,
  RoadmapExceptionSeverity,
  RoadmapItem,
  RoadmapDiff,
} from "@shared/student-roadmap-contract";

export const ADMIN_ROADMAP_QUERY_KEY = (studentId: string) => ["admin-roadmap", studentId] as const;

export function roadmapEndpoint(
  studentId: string,
  sub: "" | "imports" | "draft" | "draft/acknowledge" | "draft/preview" | "draft/publish" | "draft/discard" | "draft/from-published" = "",
  query?: { replaceDraft?: boolean },
): string {
  const base = `/api/admin/students/${encodeURIComponent(studentId)}/roadmap`;
  const path = sub ? `${base}/${sub}` : base;
  return query?.replaceDraft ? `${path}?replaceDraft=true` : path;
}

// ── errors ───────────────────────────────────────────────────────────────────

export type RoadmapFailureKind = "draft_exists" | "stale" | "not_publishable" | "forbidden" | "unreadable" | "other";

export interface RoadmapFailure {
  readonly kind: RoadmapFailureKind;
  readonly status: number;
  readonly code: string | null;
  readonly message: string;
}

/** Classify a failed response using the contract error shape { error: { code, message } }. */
export function classifyRoadmapFailure(status: number, body: unknown): RoadmapFailure {
  const err = (body as { error?: { code?: unknown; message?: unknown } | string } | null)?.error;
  const code = err && typeof err === "object" && typeof err.code === "string" ? err.code : null;
  const serverMessage = err && typeof err === "object" && typeof err.message === "string" ? err.message : typeof err === "string" ? err : null;
  if (status === 409 && code === "ROADMAP_DRAFT_EXISTS") {
    return { kind: "draft_exists", status, code, message: "An open draft already exists for this student." };
  }
  if (status === 409) {
    return { kind: "stale", status, code, message: "The roadmap changed since you loaded it. It has been reloaded; review the latest version and try again." };
  }
  if (status === 422 && code === "ROADMAP_NOT_PUBLISHABLE") {
    return { kind: "not_publishable", status, code, message: serverMessage ?? "This draft cannot be published yet: fix blocking exceptions and acknowledge every warning." };
  }
  if (status === 403) return { kind: "forbidden", status, code, message: "Only an administrator can do this." };
  if (code === "ROADMAP_IMPORT_UNREADABLE") return { kind: "unreadable", status, code, message: serverMessage ?? "The file could not be read." };
  return { kind: "other", status, code, message: serverMessage ?? `Request failed (${status}).` };
}

// ── exceptions ───────────────────────────────────────────────────────────────

export interface GroupedExceptions {
  readonly blocking: RoadmapException[];
  readonly warning: RoadmapException[];
  readonly info: RoadmapException[];
}

export function groupExceptions(exceptions: readonly RoadmapException[]): GroupedExceptions {
  const out: GroupedExceptions = { blocking: [], warning: [], info: [] };
  for (const e of exceptions) out[e.severity as RoadmapExceptionSeverity].push(e);
  return out;
}

export function acknowledgedKeys(acks: readonly RoadmapExceptionAcknowledgement[]): Set<string> {
  return new Set(acks.map((a) => a.exceptionKey));
}

export function unacknowledgedWarnings(exceptions: readonly RoadmapException[], acks: readonly RoadmapExceptionAcknowledgement[]): RoadmapException[] {
  const done = acknowledgedKeys(acks);
  return exceptions.filter((e) => e.severity === "warning" && !done.has(e.key));
}

export function exceptionLocation(e: RoadmapException): string {
  const parts: string[] = [];
  if (e.ref.sheet) parts.push(e.ref.row ? `${e.ref.sheet} row ${e.ref.row}` : e.ref.sheet);
  if (e.ref.itemKey) parts.push(`item ${e.ref.itemKey}`);
  if (e.ref.taskKey) parts.push(`task ${e.ref.taskKey}`);
  if (e.ref.column) parts.push(`column ${e.ref.column}`);
  if (parts.length === 0 && e.ref.path) parts.push(e.ref.path);
  return parts.join(" · ");
}

// ── publish gate ─────────────────────────────────────────────────────────────

export interface PublishGate {
  readonly enabled: boolean;
  /** Always explains why when disabled; null when enabled. */
  readonly reason: string | null;
}

export function publishGate(draft: AdminRoadmapDraftView | null, isAdmin: boolean, busy = false): PublishGate {
  if (!draft) return { enabled: false, reason: "There is no draft to publish." };
  if (!isAdmin) return { enabled: false, reason: "Only an administrator can publish a roadmap. Staff can prepare and review the draft." };
  const groups = groupExceptions(draft.exceptions);
  if (groups.blocking.length > 0) {
    return { enabled: false, reason: `Fix ${groups.blocking.length} blocking exception${groups.blocking.length === 1 ? "" : "s"} first.` };
  }
  const open = unacknowledgedWarnings(draft.exceptions, draft.acknowledgements).length;
  if (open > 0) return { enabled: false, reason: `Acknowledge ${open} warning${open === 1 ? "" : "s"} first.` };
  if (!draft.publishable) return { enabled: false, reason: "The server reports this draft is not publishable yet." };
  if (busy) return { enabled: false, reason: "Another action is in progress." };
  return { enabled: true, reason: null };
}

// ── request bodies ───────────────────────────────────────────────────────────

export function acknowledgeBody(expectedDraftRevision: number, exceptionKeys: readonly string[], note: string) {
  const trimmed = note.trim();
  return { expectedDraftRevision, exceptionKeys: [...exceptionKeys], ...(trimmed ? { note: trimmed } : {}) };
}
export function publishBody(expectedDraftRevision: number, expectedPublishedVersionId: string | null) {
  return { expectedDraftRevision, expectedPublishedVersionId };
}
export function discardBody(expectedDraftRevision: number) {
  return { expectedDraftRevision };
}
export function saveDraftBody(expectedDraftRevision: number, content: RoadmapContent) {
  return { expectedDraftRevision, content };
}

/** Wrap pasted AI JSON text; throws a readable Error when it is not JSON. */
export function parsePastedPackage(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Paste the AI package JSON first.");
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error("That text is not valid JSON.");
  }
}

// ── diff presentation ────────────────────────────────────────────────────────

export function diffHeadline(diff: RoadmapDiff): string {
  if (diff.baseVersionNumber === null) return "First roadmap for this student (nothing published to compare with).";
  const harmless = diff.changed.filter((c) => c.rescheduleOnly).length;
  const parts = [
    `${diff.added.length} added`,
    `${diff.removed.length} removed`,
    `${diff.changed.length} changed${harmless ? ` (${harmless} reschedule only)` : ""}`,
    `${diff.unchangedCount} unchanged`,
  ];
  return `Compared with published version ${diff.baseVersionNumber}: ${parts.join(", ")}.`;
}

// ── draft editing ────────────────────────────────────────────────────────────

export interface ItemFormValues {
  title: string;
  code: string;
  phaseKey: string;
  objectiveKey: string;
  plannedStart: string;
  plannedEnd: string;
  planStatus: RoadmapItem["planStatus"];
  holdReason: string;
  dependsOn: string;
}

export function itemToForm(item: RoadmapItem): ItemFormValues {
  return {
    title: item.title,
    code: item.code ?? "",
    phaseKey: item.phaseKey,
    objectiveKey: item.objectiveKey,
    plannedStart: item.plannedStart ?? "",
    plannedEnd: item.plannedEnd ?? "",
    planStatus: item.planStatus,
    holdReason: item.hold?.reason ?? "",
    dependsOn: item.dependsOn.join(", "),
  };
}

export function parseKeyList(text: string): string[] {
  return [...new Set(text.split(/[,\s;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

/** Returns a new content with the item replaced (keys and tasks are never changed by the form). */
export function applyItemForm(content: RoadmapContent, itemKey: string, form: ItemFormValues): RoadmapContent {
  return {
    ...content,
    items: content.items.map((item) =>
      item.key !== itemKey
        ? item
        : {
            ...item,
            title: form.title.trim() || item.title,
            code: form.code.trim() || null,
            phaseKey: form.phaseKey,
            objectiveKey: form.objectiveKey,
            plannedStart: form.plannedStart || null,
            plannedEnd: form.plannedEnd || null,
            planStatus: form.planStatus,
            hold: form.planStatus === "hold" ? { reason: form.holdReason.trim() } : null,
            dependsOn: parseKeyList(form.dependsOn),
          },
    ),
  };
}

export function removeItemFromContent(content: RoadmapContent, itemKey: string): RoadmapContent {
  return { ...content, items: content.items.filter((i) => i.key !== itemKey) };
}

/** Items with at least one blocking/warning exception, keyed by item key. */
export function exceptionsByItem(exceptions: readonly RoadmapException[]): Map<string, RoadmapException[]> {
  const map = new Map<string, RoadmapException[]>();
  for (const e of exceptions) {
    if (!e.ref.itemKey || e.severity === "info") continue;
    const list = map.get(e.ref.itemKey) ?? [];
    list.push(e);
    map.set(e.ref.itemKey, list);
  }
  return map;
}
