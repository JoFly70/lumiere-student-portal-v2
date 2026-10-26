import type { CellValue } from "./types";

export const MAX_ROWS = 2000;
export const MAX_COLUMNS = 80;
export const MAX_CELL_TEXT = 2000;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Header normalisation: case/space/punctuation-insensitive; keeps "#" as a meaningful header. */
export function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9#]/g, "");
}

/** Lowercase slug with "-" separators, max `max` chars, never starting/ending with "-". */
export function slug(s: string, max = 80): string {
  const out = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return out;
}

/** Key from an explicit author-supplied value: keeps "." and "_" and "-". */
export function explicitKey(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80)
    .replace(/[-.]+$/g, "");
}

export function columnLetter(index0: number): string {
  let n = index0 + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function clip(s: string | null | undefined, max: number): string | null {
  if (s === null || s === undefined) return null;
  const t = s.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function cellText(v: CellValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return v.replace(/\u00a0/g, " ").trim();
}

export function isBlank(v: CellValue | undefined): boolean {
  return cellText(v) === "";
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2200) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function iso(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

export interface ParsedDate {
  /** ISO date, or null when empty or invalid. */
  readonly value: string | null;
  readonly invalid: boolean;
}

/** Excel date cells, serial numbers, YYYY-MM-DD, M/D/YYYY, "Mon YYYY" (1st of month), "Mon D, YYYY". */
export function parseDateCell(v: CellValue | undefined): ParsedDate {
  if (v === null || v === undefined) return { value: null, invalid: false };
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { value: null, invalid: true };
    const y = v.getUTCFullYear();
    return isRealDate(y, v.getUTCMonth() + 1, v.getUTCDate())
      ? { value: iso(y, v.getUTCMonth() + 1, v.getUTCDate()), invalid: false }
      : { value: null, invalid: true };
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 20000 || v > 80000) return { value: null, invalid: true };
    const ms = Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000;
    return parseDateCell(new Date(ms));
  }
  if (typeof v === "boolean") return { value: null, invalid: true };
  const s = v.trim();
  if (!s) return { value: null, invalid: false };
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isRealDate(y, mo, d) ? { value: iso(y, mo, d), invalid: false } : { value: null, invalid: true };
  }
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) {
    const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isRealDate(y, mo, d) ? { value: iso(y, mo, d), invalid: false } : { value: null, invalid: true };
  }
  m = /^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    const y = Number(m[2]);
    return mo && isRealDate(y, mo, 1) ? { value: iso(y, mo, 1), invalid: false } : { value: null, invalid: true };
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    const [d, y] = [Number(m[2]), Number(m[3])];
    return mo && isRealDate(y, mo, d) ? { value: iso(y, mo, d), invalid: false } : { value: null, invalid: true };
  }
  return { value: null, invalid: true };
}

/** Credits as a canonical decimal string (max 2 decimals), or invalid. */
export function parseCredits(v: CellValue | undefined): { value: string | null; invalid: boolean } {
  const raw = cellText(v);
  if (!raw) return { value: null, invalid: false };
  if (!/^\d{1,4}(\.\d+)?$/.test(raw)) return { value: null, invalid: true };
  const n = Number(raw);
  if (!Number.isFinite(n) || n > 9999.99) return { value: null, invalid: true };
  // More than 2 decimals is not representable as a credit amount.
  const frac = raw.split(".")[1];
  if (frac && frac.replace(/0+$/, "").length > 2) return { value: null, invalid: true };
  let out = n.toFixed(2);
  out = out.replace(/\.?0+$/, "");
  return { value: out, invalid: false };
}

export function splitList(s: string): string[] {
  return s
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}
