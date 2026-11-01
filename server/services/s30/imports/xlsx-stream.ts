/**
 * S30 imports — bounded .xlsx reading for the Import Center (Phase B security fix).
 *
 * The S05 roadmap reader (roadmap-import/reader.ts) trusts the sizes a zip DECLARES and builds the whole workbook in
 * memory. For untrusted academic imports this module:
 *   1. verifyZipBudget(): walks the central directory and actually inflates every part with a hard output cap
 *      (zlib maxOutputLength), so a lying header cannot expand past PER_PART_BYTES per part or TOTAL_BYTES overall.
 *      Only "stored" and "deflate" parts are accepted; zip64, encrypted and other methods are refused.
 *   2. readXlsxRows(): parses with ExcelJS's STREAMING WorkbookReader (rows are produced one at a time) and stops
 *      as soon as the first non-empty sheet exceeds the row cap, instead of materialising every sheet.
 * The roadmap reader is unchanged.
 */
import { Readable } from "node:stream";
import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import type { CellValue } from "../../roadmap-import/types";
import { normalizeCell } from "../../roadmap-import/reader";
import { MAX_COLUMNS } from "../../roadmap-import/util";

export const XLSX_LIMITS = { maxEntries: 300, perPartBytes: 10 * 1024 * 1024, totalBytes: 25 * 1024 * 1024 } as const;

export class XlsxBudgetError extends Error {
  constructor(message: string) { super(message); this.name = "XlsxBudgetError"; }
}

/** Inflates every part with a hard cap; throws XlsxBudgetError when the archive is malformed or too large expanded. */
export function verifyZipBudget(buffer: Buffer, limits: { maxEntries: number; perPartBytes: number; totalBytes: number } = XLSX_LIMITS): { entries: number; expandedBytes: number } {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65_535); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxBudgetError("not a zip archive");
  const entries = buffer.readUInt16LE(eocd + 10);
  let cd = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cd === 0xffffffff) throw new XlsxBudgetError("zip64 archives are not accepted");
  if (entries > limits.maxEntries) throw new XlsxBudgetError("too many parts");
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (cd + 46 > buffer.length || buffer.readUInt32LE(cd) !== 0x02014b50) throw new XlsxBudgetError("bad central directory");
    const flags = buffer.readUInt16LE(cd + 8);
    const method = buffer.readUInt16LE(cd + 10);
    const compressed = buffer.readUInt32LE(cd + 20);
    const nameLen = buffer.readUInt16LE(cd + 28);
    const extraLen = buffer.readUInt16LE(cd + 30);
    const commentLen = buffer.readUInt16LE(cd + 32);
    const local = buffer.readUInt32LE(cd + 42);
    if (flags & 0x1) throw new XlsxBudgetError("encrypted parts are not accepted");
    if (compressed === 0xffffffff || local === 0xffffffff) throw new XlsxBudgetError("zip64 parts are not accepted");
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) throw new XlsxBudgetError("bad local header");
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + compressed > buffer.length) throw new XlsxBudgetError("truncated part");
    const data = buffer.subarray(start, start + compressed);
    let size: number;
    if (method === 0) size = compressed;
    else if (method === 8) {
      try {
        size = inflateRawSync(data, { maxOutputLength: limits.perPartBytes }).length;
      } catch (error) {
        throw new XlsxBudgetError((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError ? "a part is too large when expanded" : "a part could not be decompressed");
      }
    } else throw new XlsxBudgetError("unsupported compression method");
    if (size > limits.perPartBytes) throw new XlsxBudgetError("a part is too large when expanded");
    total += size;
    if (total > limits.totalBytes) throw new XlsxBudgetError("the workbook is too large when expanded");
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, expandedBytes: total };
}

export interface XlsxRows {
  readonly sheetName: string | null;
  /** rows[0] is spreadsheet row 1 (missing rows are empty arrays). */
  readonly rows: CellValue[][];
  /** More than maxRows non-empty rows were present (reading stopped). */
  readonly truncated: boolean;
}

const hasTwoValues = (cells: readonly CellValue[]) => cells.filter((c) => c !== null && String(c).trim() !== "").length >= 2;

/**
 * Streams the workbook and returns the first sheet that has a header-like row in its first 10 rows. Reading stops
 * once `maxRows` non-empty rows (header search rows included) were collected from that sheet.
 */
export async function readXlsxRows(buffer: Buffer, maxRows: number): Promise<XlsxRows> {
  verifyZipBudget(buffer);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    sharedStrings: "cache", hyperlinks: "ignore", styles: "cache", worksheets: "emit", entries: "emit",
  } as ExcelJS.stream.xlsx.WorkbookStreamReaderOptions);
  let sheets = 0;
  for await (const ws of reader as AsyncIterable<AsyncIterable<ExcelJS.Row> & { name?: string }>) {
    if (++sheets > 30) break;
    const rows: CellValue[][] = [];
    let nonEmpty = 0;
    let truncated = false;
    for await (const row of ws) {
      const values = (row.values ?? []) as unknown[];
      const cells: CellValue[] = [];
      for (let c = 1; c < Math.min(values.length, MAX_COLUMNS + 1); c++) cells.push(normalizeCell(values[c]));
      if (!cells.some((c) => c !== null && String(c).trim() !== "")) continue;
      nonEmpty += 1;
      if (nonEmpty > maxRows) { truncated = true; break; }
      // Rows keep their spreadsheet numbers (blank rows become []); refuse absurd gaps instead of padding them.
      if (row.number - 1 - rows.length > 1000) throw new XlsxBudgetError("the sheet has very large gaps between rows");
      while (rows.length < row.number - 1) rows.push([]);
      rows.push(cells);
    }
    if (rows.slice(0, 10).some(hasTwoValues)) return { sheetName: ws.name ?? null, rows, truncated };
  }
  return { sheetName: null, rows: [], truncated: false };
}
