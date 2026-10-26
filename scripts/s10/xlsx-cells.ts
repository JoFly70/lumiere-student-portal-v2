/**
 * Minimal, dependency-free .xlsx cell reader used by the S10 independent
 * reconciliation. It deliberately shares NO code with the importer's reader
 * (server/services/roadmap-import/reader.ts, ExcelJS) so a count made with it is an
 * independent check. It is namespace-prefix agnostic (`<x:c>` and `<c>` both work),
 * ignores drawings, and reads cached formula values (never formula text).
 *
 * Node built-ins only (zlib). Returns plain data; callers must not commit cell text.
 */
import fs from "node:fs";
import zlib from "node:zlib";

export type Cell = string | number | null;
export interface RawSheet {
  name: string;
  hidden: boolean;
  /** rows[0] = spreadsheet row 1; cells 0-based; numbers that are dates (by number format) are returned as ISO strings. */
  rows: Cell[][];
  /** parallel to rows: true when the cell is a formula cell */
  formulas: boolean[][];
}

function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip");
  const n = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let k = 0; k < n; k++) {
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nlen).toString("utf8");
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const data = buf.subarray(lho + 30 + lnlen + lelen, lho + 30 + lnlen + lelen + csize);
    out.set(name, method === 0 ? data : zlib.inflateRawSync(data));
    off += 46 + nlen + elen + clen;
  }
  return out;
}

const decode = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`(?:^|\\s)(?:\\w+:)?${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1]!) : null;
};

function textOf(xml: string): string {
  // concatenate every <t> (rich text runs included), skipping phonetic runs
  const noPh = xml.replace(/<(?:\w+:)?rPh[\s\S]*?<\/(?:\w+:)?rPh>/g, "");
  let s = "";
  for (const m of noPh.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) s += decode(m[1]!);
  return s;
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const BUILTIN_DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function excelSerialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

export function readXlsxCells(file: string): RawSheet[] {
  const files = unzip(fs.readFileSync(file));
  const get = (p: string): string | null => {
    const b = files.get(p.replace(/^\//, ""));
    return b ? b.toString("utf8") : null;
  };
  const wbXml = get("xl/workbook.xml");
  if (!wbXml) throw new Error("no workbook.xml");
  const rels = new Map<string, string>();
  for (const m of (get("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<(?:\w+:)?Relationship\s[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const shared: string[] = [];
  const sst = get("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<(?:\w+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?si>/g)) shared.push(textOf(m[1]!));

  // date-ness per cellXfs index
  const dateXf: boolean[] = [];
  const styles = get("xl/styles.xml");
  if (styles) {
    const custom = new Map<number, string>();
    for (const m of styles.matchAll(/<(?:\w+:)?numFmt\s[^>]*>/g)) {
      const id = Number(attr(m[0], "numFmtId"));
      custom.set(id, attr(m[0], "formatCode") ?? "");
    }
    const cx = /<(?:\w+:)?cellXfs[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(styles);
    if (cx) {
      for (const m of cx[1]!.matchAll(/<(?:\w+:)?xf\s[^>]*?\/?>/g)) {
        const id = Number(attr(m[0], "numFmtId") ?? 0);
        const code = custom.get(id);
        const isDate = BUILTIN_DATE_IDS.has(id) || (code !== undefined && /[dmy]/i.test(code.replace(/\[[^\]]*\]|"[^"]*"|\\./g, "")) && !/^general$/i.test(code));
        dateXf.push(isDate);
      }
    }
  }

  const sheets: RawSheet[] = [];
  for (const m of wbXml.matchAll(/<(?:\w+:)?sheet\s[^>]*>/g)) {
    const name = attr(m[0], "name") ?? "";
    const rid = attr(m[0], "id");
    const state = attr(m[0], "state");
    const target = rid ? rels.get(rid) : undefined;
    const xml = target ? get(target) : null;
    const rows: Cell[][] = [];
    const formulas: boolean[][] = [];
    if (xml) {
      for (const rm of xml.matchAll(/<(?:\w+:)?row\s([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
        const rnum = Number(attr(rm[1]!, "r"));
        const body = rm[2] ?? "";
        const row: Cell[] = [];
        const frow: boolean[] = [];
        for (const cm of body.matchAll(/<(?:\w+:)?c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
          const ref = attr(cm[1]!, "r") ?? "";
          const t = attr(cm[1]!, "t");
          const s = Number(attr(cm[1]!, "s") ?? 0);
          const inner = cm[2] ?? "";
          const v = /<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner);
          let val: Cell = null;
          if (t === "s" && v) val = shared[Number(v[1])] ?? null;
          else if (t === "inlineStr") val = textOf(inner);
          else if (t === "str" && v) val = decode(v[1]!);
          else if (t === "b" && v) val = v[1] === "1" ? "TRUE" : "FALSE";
          else if (t === "e") val = null;
          else if (v && v[1] !== "") {
            const num = Number(v[1]);
            val = Number.isFinite(num) ? (dateXf[s] && num > 20000 && num < 80000 ? excelSerialToIso(num) : num) : decode(v[1]!);
          }
          const ci = colIndex(ref);
          while (row.length < ci) {
            row.push(null);
            frow.push(false);
          }
          row[ci] = val;
          frow[ci] = /<(?:\w+:)?f[\s>/]/.test(inner);
        }
        while (rows.length < rnum - 1) {
          rows.push([]);
          formulas.push([]);
        }
        rows[rnum - 1] = row;
        formulas[rnum - 1] = frow;
      }
    }
    sheets.push({ name, hidden: state === "hidden" || state === "veryHidden", rows, formulas });
  }
  return sheets;
}
