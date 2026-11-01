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

/** Rows are kept at their spreadsheet numbers; bound the padding so sparse sheets cannot allocate millions of rows. */
const MAX_SHEET_ROW = 20_000;

export class XlsxBudgetError extends Error {
  constructor(message: string) { super(message); this.name = "XlsxBudgetError"; }
}

/** Inflates every part with a hard cap; throws XlsxBudgetError when the archive is malformed or too large expanded. */
export function verifyZipBudget(buffer: Buffer, limits: { maxEntries: number; perPartBytes: number; totalBytes: number } = XLSX_LIMITS): { entries: number; expandedBytes: number; parts: Array<{ name: string; data: Buffer }> } {
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
  const parts: Array<{ name: string; data: Buffer }> = [];
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
    // The local header must agree with the central directory (a streaming unzipper trusts the LOCAL header).
    if (buffer.readUInt16LE(local + 8) !== method || (buffer.readUInt16LE(local + 6) & 0x1)) throw new XlsxBudgetError("inconsistent part headers");
    const name = buffer.subarray(cd + 46, cd + 46 + nameLen).toString("utf8");
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + compressed > buffer.length) throw new XlsxBudgetError("truncated part");
    const data = buffer.subarray(start, start + compressed);
    let out: Buffer;
    if (method === 0) out = data;
    else if (method === 8) {
      try {
        out = inflateRawSync(data, { maxOutputLength: limits.perPartBytes });
      } catch (error) {
        throw new XlsxBudgetError((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError ? "a part is too large when expanded" : "a part could not be decompressed");
      }
    } else throw new XlsxBudgetError("unsupported compression method");
    const size = out.length;
    if (size > limits.perPartBytes) throw new XlsxBudgetError("a part is too large when expanded");
    total += size;
    if (!name.endsWith("/")) parts.push({ name, data: out });
    if (total > limits.totalBytes) throw new XlsxBudgetError("the workbook is too large when expanded");
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, expandedBytes: total, parts };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Rebuilds a plain "stored" zip from parts that verifyZipBudget already inflated within budget. The streaming
 * reader only ever sees this archive, so parts that are unlisted, mislabelled or hidden in the original never reach it.
 */
export function rebuildStoredZip(input: ReadonlyArray<{ name: string; data: Buffer }>): Buffer {
  // The streaming reader needs the workbook, its relationships, shared strings and styles before any worksheet.
  const rank = (n: string) => (/^xl\/worksheets\//.test(n) ? 2 : /^(\[Content_Types\]\.xml|_rels\/|xl\/workbook\.xml|xl\/_rels\/|xl\/sharedStrings\.xml|xl\/styles\.xml)/.test(n) ? 0 : 1);
  const parts = [...input].sort((a, b) => rank(a.name) - rank(b.name));
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const p of parts) {
    const name = Buffer.from(p.name, "utf8");
    const crc = crc32(p.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(p.data.length, 18); local.writeUInt32LE(p.data.length, 22); local.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(0, 10);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(p.data.length, 20); cd.writeUInt32LE(p.data.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    chunks.push(local, name, p.data);
    central.push(cd, name);
    offset += 30 + name.length + p.data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10); end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, end]);
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
  const clean = rebuildStoredZip(verifyZipBudget(buffer).parts);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(clean), {
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
      if (row.number > MAX_SHEET_ROW) throw new XlsxBudgetError("the sheet has very large gaps between rows");
      while (rows.length < row.number - 1) rows.push([]);
      rows.push(cells);
    }
    if (rows.slice(0, 10).some(hasTwoValues)) return { sheetName: ws.name ?? null, rows, truncated };
  }
  return { sheetName: null, rows: [], truncated: false };
}
