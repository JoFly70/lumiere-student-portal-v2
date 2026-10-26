/**
 * Fallback .xlsx reader (zlib + a tolerant XML scan), used only when ExcelJS cannot load a
 * package. S10 found two real Lumière workbooks ExcelJS rejects:
 *  - a package whose parts use a namespace prefix (`<x:workbook>`, `<x:worksheet>`), which
 *    ExcelJS does not parse (it fails with "Cannot read properties of undefined (reading 'sheets')");
 *  - a package with chart / drawing parts ExcelJS cannot place (fails reading 'anchors').
 * Cell data is all the importer needs, so this reader ignores drawings, charts and media and is
 * prefix-agnostic. Same contract and limits as `readWorkbook`: bounded rows / columns / sheets /
 * text, cached formula results only (never formula text), hyperlink targets never read, only the
 * parts it needs are inflated (with an output cap), merged-cell slaves are empty by construction.
 */
import zlib from "node:zlib";
import type { CellValue, SheetData, WorkbookData } from "./types";
import { MAX_CELL_TEXT, MAX_COLUMNS, MAX_ROWS } from "./util";

const MAX_SHEETS = 30;
const MAX_PART_BYTES = 40 * 1024 * 1024;

interface ZipEntry {
  readonly method: number;
  readonly compressedSize: number;
  readonly localHeaderOffset: number;
}

function centralDirectory(buffer: Buffer): Map<string, ZipEntry> {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65_535); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("The file is not a valid .xlsx archive.");
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const out = new Map<string, ZipEntry>();
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("The file is not a valid .xlsx archive.");
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    out.set(name.replace(/^\//, ""), {
      method: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      localHeaderOffset: buffer.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function entryText(buffer: Buffer, dir: Map<string, ZipEntry>, name: string): string | null {
  const e = dir.get(name);
  if (!e) return null;
  const lh = e.localHeaderOffset;
  if (lh + 30 > buffer.length || buffer.readUInt32LE(lh) !== 0x04034b50) throw new Error("The file is not a valid .xlsx archive.");
  const start = lh + 30 + buffer.readUInt16LE(lh + 26) + buffer.readUInt16LE(lh + 28);
  const data = buffer.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data.toString("utf8");
  if (e.method !== 8) throw new Error("The workbook uses an unsupported compression method.");
  return zlib.inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES }).toString("utf8");
}

const decode = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");

function safeCodePoint(n: number): string {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`(?:^|\\s)(?:\\w+:)?${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1]!) : null;
};

function textOf(xml: string): string {
  const noPhonetic = xml.replace(/<(?:\w+:)?rPh[\s\S]*?<\/(?:\w+:)?rPh>/g, "");
  let s = "";
  for (const m of noPhonetic.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) s += decode(m[1]!);
  return s;
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function dateStyles(styles: string | null): boolean[] {
  const flags: boolean[] = [];
  if (!styles) return flags;
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<(?:\w+:)?numFmt\s[^>]*>/g)) custom.set(Number(attr(m[0], "numFmtId")), attr(m[0], "formatCode") ?? "");
  const xfs = /<(?:\w+:)?cellXfs[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(styles);
  if (!xfs) return flags;
  for (const m of xfs[1]!.matchAll(/<(?:\w+:)?xf\s[^>]*?\/?>/g)) {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    const code = custom.get(id);
    const stripped = code ? code.replace(/\[[^\]]*\]|"[^"]*"|\\./g, "") : "";
    flags.push(BUILTIN_DATE_FORMATS.has(id) || (code !== undefined && /[dmy]/i.test(stripped) && !/^general$/i.test(code)));
  }
  return flags;
}

function clip(s: string): string {
  return s.length > MAX_CELL_TEXT ? s.slice(0, MAX_CELL_TEXT) : s;
}

export function readWorkbookFallback(buffer: Buffer): WorkbookData {
  const dir = centralDirectory(buffer);
  const workbookXml = entryText(buffer, dir, "xl/workbook.xml");
  if (!workbookXml) throw new Error("The workbook has no workbook part.");
  const rels = new Map<string, string>();
  for (const m of (entryText(buffer, dir, "xl/_rels/workbook.xml.rels") ?? "").matchAll(/<(?:\w+:)?Relationship\s[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const shared: string[] = [];
  const sst = entryText(buffer, dir, "xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<(?:\w+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?si>/g)) shared.push(textOf(m[1]!));
  const isDate = dateStyles(entryText(buffer, dir, "xl/styles.xml"));

  const sheets: SheetData[] = [];
  for (const m of workbookXml.matchAll(/<(?:\w+:)?sheet\s[^>]*>/g)) {
    if (sheets.length >= MAX_SHEETS) break;
    const name = attr(m[0], "name") ?? `Sheet${sheets.length + 1}`;
    const rid = attr(m[0], "id");
    const target = rid ? rels.get(rid) : undefined;
    const xml = target ? entryText(buffer, dir, target) : null;
    const rows: CellValue[][] = [];
    let truncated = false;
    if (xml) {
      for (const rm of xml.matchAll(/<(?:\w+:)?row\s([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
        const rowNumber = Number(attr(rm[1]!, "r"));
        if (!Number.isInteger(rowNumber) || rowNumber < 1) continue;
        if (rowNumber > MAX_ROWS) {
          truncated = true;
          break;
        }
        const cells: CellValue[] = [];
        for (const cm of (rm[2] ?? "").matchAll(/<(?:\w+:)?c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
          const ref = attr(cm[1]!, "r") ?? "";
          const col = columnIndex(ref);
          if (col < 0 || col >= MAX_COLUMNS) continue;
          const type = attr(cm[1]!, "t");
          const style = Number(attr(cm[1]!, "s") ?? 0);
          const inner = cm[2] ?? "";
          const v = /<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner);
          let value: CellValue = null;
          if (type === "s" && v) value = clip(shared[Number(v[1])] ?? "") || null;
          else if (type === "inlineStr") value = clip(textOf(inner)) || null;
          else if (type === "str" && v) value = clip(decode(v[1]!)) || null;
          else if (type === "b" && v) value = v[1] === "1";
          else if (type === "e") value = null;
          else if (v && v[1] !== "") {
            const n = Number(v[1]);
            if (Number.isFinite(n)) value = isDate[style] && n > 20_000 && n < 80_000 ? new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000) : n;
          }
          while (cells.length < col) cells.push(null);
          cells[col] = value;
        }
        while (rows.length < rowNumber - 1) rows.push([]);
        rows[rowNumber - 1] = cells;
      }
    }
    sheets.push({ name, rows, truncatedRows: truncated });
  }
  if (sheets.length === 0) throw new Error("The workbook has no readable sheets.");
  return { sheets };
}
