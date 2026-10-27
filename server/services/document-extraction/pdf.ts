/**
 * Best-effort text extraction for machine-readable PDFs (no OCR, no dependencies).
 *
 * Handles: classic and compressed (ObjStm) objects, FlateDecode / unfiltered content streams, page order
 * from the page tree (falls back to object order), and the Tj / TJ / ' / " text operators with literal
 * and hex strings in single-byte encodings (WinAnsi approximated by windows-1252).
 *
 * NOT handled (result is 'stored_only'): scanned/image-only PDFs, CID/Type0 fonts without readable
 * strings (no ToUnicode CMap support), other filters (LZW, ASCII85, JBIG2...), encrypted PDFs.
 */
import zlib from 'node:zlib';
import type { ExtractionLimits, RawExtraction, Segment } from './types';

const MAX_STREAM_BYTES = 24 * 1024 * 1024;
const MAX_TOTAL_DECODED = 64 * 1024 * 1024;
const MAX_OBJECTS = 200_000;

interface PdfObject {
  num: number;
  dict: string;
  /** Raw stream bytes (undecoded) or null. */
  stream: Buffer | null;
}

const winAnsi = new TextDecoder('windows-1252');

function inflateBounded(data: Buffer, budget: { left: number }): Buffer | null {
  const cap = Math.min(MAX_STREAM_BYTES, budget.left);
  if (cap <= 0) return null;
  try {
    const out = zlib.inflateSync(data, { maxOutputLength: cap, finishFlush: zlib.constants.Z_SYNC_FLUSH });
    budget.left -= out.length;
    return out;
  } catch {
    return null;
  }
}

function decodeStream(obj: PdfObject, budget: { left: number }): Buffer | null {
  if (!obj.stream) return null;
  const filterMatch = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(obj.dict);
  if (!filterMatch) return obj.stream;
  const filters = (filterMatch[1].match(/\/\w+/g) ?? []).map((f) => f.slice(1));
  if (filters.length === 1 && (filters[0] === 'FlateDecode' || filters[0] === 'Fl')) {
    if (/\/DecodeParms[\s\S]*\/Predictor\s+(?!1\b)\d+/.test(obj.dict)) return null;
    return inflateBounded(obj.stream, budget);
  }
  return null;
}

function parseObjects(latin1: string, buf: Buffer, check: () => void): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const re = /(\d{1,9})\s+(\d{1,5})\s+obj\b/g;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(latin1))) {
    if ((++count & 0x3ff) === 0) check();
    if (count > MAX_OBJECTS) break;
    const bodyStart = m.index + m[0].length;
    const endObj = latin1.indexOf('endobj', bodyStart);
    const streamKw = latin1.indexOf('stream', bodyStart);
    let obj: PdfObject;
    if (streamKw >= 0 && (endObj < 0 || streamKw < endObj)) {
      let dataStart = streamKw + 6;
      if (latin1[dataStart] === '\r' && latin1[dataStart + 1] === '\n') dataStart += 2;
      else if (latin1[dataStart] === '\n' || latin1[dataStart] === '\r') dataStart += 1;
      let dataEnd = latin1.indexOf('endstream', dataStart);
      if (dataEnd < 0) dataEnd = endObj >= 0 ? endObj : buf.length;
      // Trim the single EOL that precedes "endstream".
      let trimmedEnd = dataEnd;
      if (latin1[trimmedEnd - 1] === '\n') trimmedEnd--;
      if (latin1[trimmedEnd - 1] === '\r') trimmedEnd--;
      obj = { num: Number(m[1]), dict: latin1.slice(bodyStart, streamKw), stream: buf.subarray(dataStart, trimmedEnd) };
      re.lastIndex = Math.max(dataEnd, bodyStart);
    } else {
      obj = { num: Number(m[1]), dict: latin1.slice(bodyStart, endObj >= 0 ? endObj : bodyStart + 4096), stream: null };
      if (endObj >= 0) re.lastIndex = endObj;
    }
    if (!objects.has(obj.num)) objects.set(obj.num, obj);
  }
  return objects;
}

/** Expand /Type /ObjStm streams into plain objects (PDF 1.5+). */
function expandObjectStreams(objects: Map<number, PdfObject>, budget: { left: number }, check: () => void): void {
  for (const obj of Array.from(objects.values())) {
    if (!/\/Type\s*\/ObjStm\b/.test(obj.dict)) continue;
    check();
    const n = Number(/\/N\s+(\d+)/.exec(obj.dict)?.[1] ?? 0);
    const first = Number(/\/First\s+(\d+)/.exec(obj.dict)?.[1] ?? 0);
    if (!n || !first || n > 100_000) continue;
    const data = decodeStream(obj, budget);
    if (!data) continue;
    const text = data.toString('latin1');
    const header = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = header[i * 2];
      const off = header[i * 2 + 1];
      if (!Number.isFinite(num) || !Number.isFinite(off)) break;
      const end = i + 1 < n ? header[(i + 1) * 2 + 1] : text.length - first;
      if (!objects.has(num)) objects.set(num, { num, dict: text.slice(first + off, first + end), stream: null });
    }
  }
}

function refs(s: string): number[] {
  return Array.from(s.matchAll(/(\d+)\s+\d+\s+R/g), (m) => Number(m[1]));
}

function pageOrder(objects: Map<number, PdfObject>): number[] {
  const pages: number[] = [];
  const seen = new Set<number>();
  const root = Array.from(objects.values()).find((o) => /\/Type\s*\/Catalog\b/.test(o.dict));
  const rootPages = root ? Number(/\/Pages\s+(\d+)\s+\d+\s+R/.exec(root.dict)?.[1]) : NaN;
  const walk = (num: number, depth: number) => {
    if (depth > 40 || seen.has(num)) return;
    seen.add(num);
    const o = objects.get(num);
    if (!o) return;
    if (/\/Type\s*\/Pages\b/.test(o.dict) || /\/Kids\b/.test(o.dict)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict);
      if (kids) for (const k of refs(kids[1])) walk(k, depth + 1);
    } else if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push(num);
  };
  if (Number.isFinite(rootPages)) walk(rootPages, 0);
  if (pages.length === 0) {
    for (const o of Array.from(objects.values()).sort((a, b) => a.num - b.num)) {
      if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push(o.num);
    }
  }
  return pages;
}

function decodeLiteral(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') {
      bytes.push(s.charCodeAt(i) & 0xff);
      continue;
    }
    const n = s[++i];
    if (n === undefined) break;
    if (n === 'n') bytes.push(10);
    else if (n === 'r') bytes.push(13);
    else if (n === 't') bytes.push(9);
    else if (n === 'b') bytes.push(8);
    else if (n === 'f') bytes.push(12);
    else if (n >= '0' && n <= '7') {
      let oct = n;
      while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
      bytes.push(parseInt(oct, 8) & 0xff);
    } else if (n === '\n' || n === '\r') {
      if (n === '\r' && s[i + 1] === '\n') i++;
    } else bytes.push(n.charCodeAt(0) & 0xff);
  }
  return bytesToText(Buffer.from(bytes));
}

function bytesToText(b: Buffer): string {
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return Buffer.from(b.subarray(2)).swap16().toString('utf16le');
  return winAnsi.decode(b);
}

function decodeHex(h: string): string {
  const clean = h.replace(/[^0-9a-fA-F]/g, '');
  const padded = clean.length % 2 ? clean + '0' : clean;
  return bytesToText(Buffer.from(padded, 'hex'));
}

/** Pull text out of one decoded page content stream. */
export function textFromContentStream(content: string, check: () => void): string {
  let out = '';
  // Tokens: literal string, hex string, array start/end, operator, number/name.
  const re = /\((?:\\[\s\S]|[^\\()]|\((?:\\[\s\S]|[^\\()])*\))*\)|<[0-9A-Fa-f\s]*>|\[|\]|[A-Za-z'"*]+|-?\d*\.?\d+|\/[^\s/<>\[\]()]+/g;
  let pendingStrings: string[] = [];
  let inArray = false;
  let m: RegExpExecArray | null;
  let steps = 0;
  const num: number[] = [];
  while ((m = re.exec(content))) {
    if ((++steps & 0xfff) === 0) check();
    const tok = m[0];
    const c = tok[0];
    if (c === '(') pendingStrings.push(decodeLiteral(tok.slice(1, -1)));
    else if (c === '<' && tok.length >= 2 && tok[1] !== '<') pendingStrings.push(decodeHex(tok.slice(1, -1)));
    else if (c === '[') {
      inArray = true;
      pendingStrings = [];
    } else if (c === ']') inArray = false;
    else if (/^-?\d*\.?\d+$/.test(tok)) {
      if (inArray && Number(tok) < -200) pendingStrings.push(' ');
      num.push(Number(tok));
      if (num.length > 6) num.shift();
    } else if (/^[A-Za-z'"*]+$/.test(tok)) {
      switch (tok) {
        case 'Tj':
        case 'TJ':
          out += pendingStrings.join('');
          pendingStrings = [];
          break;
        case "'":
        case '"':
          out += '\n' + pendingStrings.join('');
          pendingStrings = [];
          break;
        case 'Td':
        case 'TD':
          if (num.length >= 1 && Math.abs(num[num.length - 1]) > 0.01) out += '\n';
          else out += ' ';
          pendingStrings = [];
          break;
        case 'T*':
        case 'ET':
          out += '\n';
          pendingStrings = [];
          break;
        case 'Tm':
          out += '\n';
          pendingStrings = [];
          break;
        default:
          pendingStrings = [];
      }
      num.length = 0;
    }
  }
  return out;
}

const READABLE = /[\p{L}\p{N}\p{P}\p{Zs}\s$+<=>^`|~]/u;

/** Share of characters that look like real text; guards against CID / binary garbage. */
export function readableRatio(s: string): number {
  if (s.length === 0) return 0;
  let ok = 0;
  for (const ch of s) if (READABLE.test(ch)) ok++;
  return ok / Array.from(s).length;
}

export function extractPdf(buf: Buffer, check: () => void, limits: ExtractionLimits): RawExtraction {
  const latin1 = buf.toString('latin1');
  const objects = parseObjects(latin1, buf, check);
  const budget = { left: MAX_TOTAL_DECODED };
  expandObjectStreams(objects, budget, check);

  const pageNums = pageOrder(objects);
  const segments: Segment[] = [];
  let truncated = false;

  const emitPage = (pageNo: number, streams: PdfObject[]) => {
    let text = '';
    for (const s of streams) {
      check();
      const data = decodeStream(s, budget);
      if (!data) continue;
      text += textFromContentStream(data.toString('latin1'), check) + '\n';
    }
    text = text.replace(/[ \t]+/g, ' ').replace(/\n[ \t]*/g, '\n').trim();
    if (text.length >= 2 && readableRatio(text) >= 0.85) segments.push({ group: `page ${pageNo}`, n: 1, text });
  };

  if (pageNums.length > 0) {
    let pageNo = 0;
    for (const num of pageNums) {
      if (++pageNo > limits.maxPdfPages) {
        truncated = true;
        break;
      }
      const page = objects.get(num)!;
      const contentsMatch = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(page.dict);
      const streams = contentsMatch ? refs(contentsMatch[1]).map((r) => objects.get(r)).filter((o): o is PdfObject => !!o && !!o.stream) : [];
      emitPage(pageNo, streams);
    }
  } else {
    // No page tree: treat every stream that contains a text object as one page.
    let pageNo = 0;
    for (const obj of Array.from(objects.values()).sort((a, b) => a.num - b.num)) {
      if (!obj.stream || /\/Type\s*\/(?:XObject|ObjStm|XRef|Metadata)\b|\/Subtype\s*\/Image\b/.test(obj.dict)) continue;
      const data = decodeStream(obj, budget);
      if (!data || !data.includes('BT')) continue;
      if (++pageNo > limits.maxPdfPages) {
        truncated = true;
        break;
      }
      emitPage(pageNo, [obj]);
    }
  }
  return { segments, unitLabel: null, truncated };
}
