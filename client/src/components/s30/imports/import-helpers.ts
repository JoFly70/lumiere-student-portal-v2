/** Pure helpers for the Import Center UI (no React, no network). */
import {
  IMPORT_FIELDS, IMPORT_MAX_BYTES, IMPORT_REQUIRED_FIELDS,
  type ImportBatchView, type ImportColumnMapping, type ImportField, type ImportIssue, type ImportRowView, type ImportStatus,
} from "@shared/s30-contract";

export const STEP_KEYS = ["upload", "map", "review", "approve", "commit"] as const;
export type StepKey = (typeof STEP_KEYS)[number];
export type StepState = "done" | "current" | "todo";

/** Where a batch sits in Upload -> Map -> Review -> Approve -> Commit. Terminal states are reported separately. */
export function stepStates(status: ImportStatus | null): { steps: Record<StepKey, StepState>; terminal: "rolled_back" | "discarded" | null } {
  const make = (current: number): Record<StepKey, StepState> =>
    Object.fromEntries(STEP_KEYS.map((k, i) => [k, i < current ? "done" : i === current ? "current" : "todo"])) as Record<StepKey, StepState>;
  switch (status) {
    case null: return { steps: make(0), terminal: null };
    case "uploaded": return { steps: make(1), terminal: null };
    case "validated": return { steps: make(2), terminal: null };
    case "approved": return { steps: make(4), terminal: null };
    case "committed": return { steps: make(STEP_KEYS.length), terminal: null };
    case "rolled_back": return { steps: make(STEP_KEYS.length), terminal: "rolled_back" };
    case "discarded": return { steps: make(1), terminal: "discarded" };
  }
}

export interface ImportActions { readonly validate: boolean; readonly discard: boolean; readonly approve: boolean; readonly commit: boolean; readonly rollback: boolean }
/** Staff: validate + discard. Admin only: approve, commit, roll back. The server enforces the same matrix. */
export function actionsFor(role: string | undefined, status: ImportStatus | null): ImportActions {
  const none = { validate: false, discard: false, approve: false, commit: false, rollback: false };
  if (!status || (role !== "admin" && role !== "staff")) return none;
  const admin = role === "admin";
  return {
    validate: status === "uploaded" || status === "validated",
    discard: status === "uploaded" || status === "validated",
    approve: admin && status === "validated",
    commit: admin && status === "approved",
    rollback: admin && status === "committed",
  };
}

export const isStaffRole = (role: string | undefined): boolean => role === "admin" || role === "staff";

/** The mapping a batch opens with: the saved one, else the suggestion; only headers present in the file survive. */
export function initialMapping(batch: Pick<ImportBatchView, "mapping" | "suggestedMapping" | "headers">): ImportColumnMapping {
  const source = batch.mapping ?? batch.suggestedMapping ?? {};
  const out: ImportColumnMapping = {};
  for (const f of IMPORT_FIELDS) {
    const h = source[f];
    if (h && batch.headers.includes(h)) out[f] = h;
  }
  return out;
}
export function missingRequired(mapping: ImportColumnMapping): ImportField[] {
  return IMPORT_REQUIRED_FIELDS.filter((f) => !mapping[f]);
}
/** Body for POST map: blank selections dropped. */
export function cleanMapping(mapping: ImportColumnMapping): ImportColumnMapping {
  const out: ImportColumnMapping = {};
  for (const f of IMPORT_FIELDS) {
    const v = mapping[f]?.trim();
    if (v) out[f] = v;
  }
  return out;
}

export const ACCEPTED_EXTENSIONS = [".csv", ".xlsx"] as const;
export type FileProblem = "empty" | "too_large" | "unsupported_format";
/** Client-side pre-check; the server remains the authority. */
export function fileProblem(file: { name: string; size: number }): FileProblem | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((e) => name.endsWith(e))) return "unsupported_format";
  if (file.size <= 0) return "empty";
  if (file.size > IMPORT_MAX_BYTES) return "too_large";
  return null;
}

export type RowFilter = "all" | "needs_attention" | "valid" | "warning" | "invalid" | "new" | "changed" | "unchanged" | "duplicate_in_file";
export const ROW_FILTERS: readonly RowFilter[] = ["all", "needs_attention", "valid", "warning", "invalid", "new", "changed", "unchanged", "duplicate_in_file"];
export const PAGE_SIZE = 50;

export function filterRows<T extends Pick<ImportRowView, "outcome" | "diff">>(rows: readonly T[], filter: RowFilter): T[] {
  switch (filter) {
    case "all": return [...rows];
    case "needs_attention": return rows.filter((r) => r.outcome === "warning" || r.outcome === "invalid");
    case "valid": case "warning": case "invalid": return rows.filter((r) => r.outcome === filter);
    default: return rows.filter((r) => r.diff === filter);
  }
}
export function paginate<T>(rows: readonly T[], page: number, size = PAGE_SIZE): { items: T[]; page: number; pages: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (p - 1) * size;
  const items = rows.slice(start, start + size);
  return { items, page: p, pages, from: rows.length ? start + 1 : 0, to: start + items.length };
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;
export function sortIssues(issues: readonly ImportIssue[]): ImportIssue[] {
  return [...issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function shortHash(hash: string | null | undefined, head = 8, tail = 6): string {
  if (!hash) return "";
  return hash.length <= head + tail + 1 ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
export const rollbackReasonValid = (reason: string): boolean => reason.trim().length >= 3 && reason.trim().length <= 500;

/** A short, locale-neutral rendering of one normalised value ("" when absent). */
export function measureText(v: { percentComplete?: number | null; scorePercent?: number | null; creditsReported?: number | null; progressStatus?: string | null; reportedOn?: string | null } | null | undefined) {
  return {
    percent: v?.percentComplete == null ? null : `${v.percentComplete}%`,
    score: v?.scorePercent == null ? null : `${v.scorePercent}%`,
    credits: v?.creditsReported == null ? null : String(v.creditsReported),
    status: v?.progressStatus ?? null,
    date: v?.reportedOn ?? null,
  };
}

export function uploadReasonKey(reason: unknown): string {
  const r = typeof reason === "string" ? reason : "";
  return ["too_large", "empty", "unsupported_format", "unreadable", "no_header", "too_many_rows"].includes(r) ? `imp.reject.${r}` : "imp.reject.generic";
}
