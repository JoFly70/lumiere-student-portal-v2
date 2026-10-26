/**
 * S05 roadmap import: Excel workbooks and AI packages -> draft RoadmapContent + review exceptions.
 *
 * Adding another Lumière spreadsheet format:
 *   1. Write a `WorkbookAdapter` ({ id, detect(workbook) -> score 0..1, convert(workbook, ctx) -> ConversionResult }).
 *      `convert` must be deterministic and must end with `finalizeContent(raw, exceptions)` so the output passes
 *      roadmapContentSchema and validateRoadmapContent like every other source.
 *   2. Register it with `registerWorkbookAdapter(adapter)`. The highest score >= MIN_DETECT_SCORE wins
 *      (ties: earlier registration).
 */
import type { ConversionResult } from "@shared/student-roadmap-contract";
import { convertImportPackage } from "./ai-package";
import { lumiereRoadmapV1Adapter } from "./lumiere-v1";
import { readWorkbook } from "./reader";
import { ExceptionCollector, MIN_DETECT_SCORE, type WorkbookAdapter, type WorkbookData } from "./types";

export { convertImportPackage, AI_PACKAGE_TEMPLATE_ID } from "./ai-package";
export { finalizeContent } from "./finalize";
export { lumiereRoadmapV1Adapter } from "./lumiere-v1";
export type { WorkbookAdapter, WorkbookData, SheetData, CellValue, AdapterContext } from "./types";

const adapters: WorkbookAdapter[] = [lumiereRoadmapV1Adapter];

export function registerWorkbookAdapter(adapter: WorkbookAdapter): void {
  const existing = adapters.findIndex((a) => a.id === adapter.id);
  if (existing >= 0) adapters[existing] = adapter;
  else adapters.push(adapter);
}

export function listWorkbookAdapters(): readonly WorkbookAdapter[] {
  return adapters;
}

/** Convert already-read workbook data with the best-matching adapter. */
export function convertWorkbookData(workbook: WorkbookData, opts: { fileName: string | null }): ConversionResult {
  let best: { adapter: WorkbookAdapter; score: number } | null = null;
  for (const adapter of adapters) {
    const score = adapter.detect(workbook);
    if (score >= MIN_DETECT_SCORE && (!best || score > best.score)) best = { adapter, score };
  }
  if (!best) return unknown(opts.fileName, workbook.sheets.map((s) => s.name), "No known Lumière roadmap template matched this workbook. Start from docs/templates/lumiere-roadmap-v1.xlsx.");
  return best.adapter.convert(workbook, { fileName: opts.fileName });
}

export async function convertWorkbook(buffer: Buffer, opts: { fileName: string | null }): Promise<ConversionResult> {
  let workbook: WorkbookData;
  try {
    workbook = await readWorkbook(buffer);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unreadable";
    return unknown(opts.fileName, [], `The workbook could not be read: ${reason}`);
  }
  return convertWorkbookData(workbook, opts);
}

function unknown(fileName: string | null, sheets: string[], message: string): ConversionResult {
  const ex = new ExceptionCollector();
  ex.add("UNKNOWN_TEMPLATE", "blocking", message, { sheet: sheets[0] ?? "(workbook)" });
  return {
    templateId: "unknown",
    content: null,
    exceptions: ex.list,
    summary: { kind: "workbook", fileName, sheetsRead: [], rowsRead: 0, rowsConverted: 0, rowsSkipped: 0, generator: null },
  };
}
