import type {
  ConversionResult,
  RoadmapException,
  RoadmapExceptionCode,
  RoadmapExceptionRef,
  RoadmapExceptionSeverity,
} from "@shared/student-roadmap-contract";

/** A normalised cell: formulas are already replaced by their cached result. */
export type CellValue = string | number | boolean | Date | null;

export interface SheetData {
  readonly name: string;
  /** rows[0] is spreadsheet row 1. Missing rows are empty arrays; cells are 0-based (column A = 0). */
  readonly rows: readonly (readonly CellValue[])[];
  /** True when the sheet had more rows than MAX_ROWS (the rest were not read). */
  readonly truncatedRows: boolean;
}

export interface WorkbookData {
  readonly sheets: readonly SheetData[];
}

export interface AdapterContext {
  readonly fileName: string | null;
}

/**
 * A workbook adapter recognises one Lumière spreadsheet layout and converts it.
 * `detect` returns a score in [0, 1]; 0 means "not mine". The registry picks the
 * highest score at or above MIN_DETECT_SCORE (ties: first registered wins).
 */
export interface WorkbookAdapter {
  readonly id: string;
  detect(workbook: WorkbookData): number;
  convert(workbook: WorkbookData, ctx: AdapterContext): ConversionResult;
}

export const MIN_DETECT_SCORE = 0.5;

/** Collects exceptions with deterministic, de-duplicated keys. */
export class ExceptionCollector {
  private readonly seen = new Set<string>();
  readonly list: RoadmapException[] = [];

  add(
    code: RoadmapExceptionCode,
    severity: RoadmapExceptionSeverity,
    message: string,
    ref: RoadmapExceptionRef = {},
    keyExtra?: string,
  ): void {
    const key = exceptionKey(code, ref, keyExtra);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push({ key, code, severity, message, ref });
  }

  addAll(exceptions: readonly RoadmapException[]): void {
    for (const e of exceptions) {
      if (this.seen.has(e.key)) continue;
      this.seen.add(e.key);
      this.list.push(e);
    }
  }
}

export function exceptionKey(code: RoadmapExceptionCode, ref: RoadmapExceptionRef, extra?: string): string {
  let base: string;
  if (ref.itemKey) {
    base = ref.itemKey;
    if (ref.taskKey) base += `/${ref.taskKey}`;
  } else if (ref.sheet) {
    base = `${ref.sheet}!${ref.row ?? ref.column ?? ""}`;
  } else {
    base = ref.path ?? "";
  }
  if (ref.column && (ref.itemKey || ref.row !== undefined)) base += `:${ref.column}`;
  if (extra) base += `:${extra}`;
  return `${code}:${base}`;
}
