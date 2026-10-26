import ExcelJS from "exceljs";
import type { CellValue, SheetData, WorkbookData } from "./types";
import { MAX_CELL_TEXT, MAX_COLUMNS, MAX_FILE_BYTES, MAX_ROWS } from "./util";

const MAX_SHEETS = 30;

/** Normalise one exceljs cell value: formulas -> cached result, rich text -> text, links -> text only. */
export function normalizeCell(raw: unknown, depth = 0): CellValue {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") return raw.length > MAX_CELL_TEXT ? raw.slice(0, MAX_CELL_TEXT) : raw;
  if (typeof raw === "object" && depth < 3) {
    const o = raw as Record<string, unknown>;
    if ("formula" in o || "sharedFormula" in o) return normalizeCell(o.result, depth + 1); // never the formula text
    if (Array.isArray(o.richText)) {
      const text = (o.richText as { text?: unknown }[]).map((r) => (typeof r.text === "string" ? r.text : "")).join("");
      return normalizeCell(text, depth + 1);
    }
    if ("error" in o) return null;
    if ("text" in o) return normalizeCell(o.text, depth + 1); // hyperlink: keep the label, never the target
  }
  return null;
}

const MAX_ZIP_ENTRIES = 300;
const MAX_UNCOMPRESSED_BYTES = 120 * 1024 * 1024;

/** Reject zip bombs before inflating: sum the declared sizes in the central directory. */
function checkZipBudget(buffer: Buffer): void {
  const minEocd = 22;
  let eocd = -1;
  for (let i = buffer.length - minEocd; i >= Math.max(0, buffer.length - minEocd - 65_535); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("The file is not a valid .xlsx archive.");
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (entries > MAX_ZIP_ENTRIES) throw new Error("The workbook archive has too many parts.");
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("The file is not a valid .xlsx archive.");
    total += buffer.readUInt32LE(offset + 24);
    if (total > MAX_UNCOMPRESSED_BYTES) throw new Error("The workbook is too large when expanded.");
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}

/**
 * Read an .xlsx into plain data. Bounded: archive size/expanded size checks, at
 * most MAX_ROWS rows and MAX_COLUMNS columns per sheet, MAX_SHEETS sheets.
 * Formulas yield their cached result; hyperlink targets are never read.
 * Throws on unreadable input (the caller turns that into a blocking exception).
 */
export async function readWorkbook(buffer: Buffer): Promise<WorkbookData> {
  if (buffer.length === 0) throw new Error("The file is empty.");
  if (buffer.length > MAX_FILE_BYTES) throw new Error(`The file is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB.`);
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error("The file is not an .xlsx workbook.");
  checkZipBudget(buffer);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const sheets: SheetData[] = [];
  for (const ws of wb.worksheets.slice(0, MAX_SHEETS)) {
    const rows: CellValue[][] = [];
    const last = Math.min(ws.rowCount, MAX_ROWS);
    for (let r = 1; r <= last; r++) {
      const values = ws.getRow(r).values as unknown[];
      const cells: CellValue[] = [];
      const limit = Math.min(values.length - 1, MAX_COLUMNS);
      for (let c = 1; c <= limit; c++) cells.push(normalizeCell(values[c]));
      rows.push(cells);
    }
    sheets.push({ name: ws.name, rows, truncatedRows: ws.rowCount > MAX_ROWS });
  }
  return { sheets };
}
