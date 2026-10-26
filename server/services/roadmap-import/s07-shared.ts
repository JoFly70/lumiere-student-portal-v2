/**
 * S07 shared helpers for the real-world workbook adapters (degree master +
 * execution schedule): header discovery, course identity, provider
 * classification, loose date parsing. Pure and deterministic.
 */
import type { RoadmapExceptionCode } from "@shared/student-roadmap-contract";
import type { CellValue, SheetData } from "./types";
import { cellText, norm, slug } from "./util";

// ── header discovery ─────────────────────────────────────────────────────────

export type FieldSpec<F extends string> = Record<F, readonly string[]>;

export interface Located<F extends string> {
  /** 0-based row index of the header row. */
  readonly headerRow: number;
  readonly columns: Map<F, number>;
}

/**
 * Finds the header row of a table inside `sheet`: the row (within the first
 * `maxScan` rows) matching the most logical fields, provided every `required`
 * field is present. Header text is compared with `norm` (case/space/punctuation
 * insensitive), so layouts survive cosmetic changes. Title and note rows above
 * the header are skipped naturally.
 */
export function locateHeader<F extends string>(
  sheet: SheetData,
  spec: FieldSpec<F>,
  required: readonly (F | readonly F[])[],
  maxScan = 15,
): Located<F> | null {
  const lookup = new Map<string, F>();
  for (const field of Object.keys(spec) as F[]) for (const alias of spec[field]) lookup.set(norm(alias), field);
  let best: (Located<F> & { score: number }) | null = null;
  for (let r = 0; r < Math.min(sheet.rows.length, maxScan); r++) {
    const row = sheet.rows[r] ?? [];
    const columns = new Map<F, number>();
    row.forEach((cell, c) => {
      const text = cellText(cell);
      if (!text) return;
      const field = lookup.get(norm(text));
      if (field && !columns.has(field)) columns.set(field, c);
    });
    const ok = required.every((req) => (Array.isArray(req) ? (req as readonly F[]).some((f) => columns.has(f)) : columns.has(req as F)));
    if (ok && (!best || columns.size > best.score)) best = { headerRow: r, columns, score: columns.size };
  }
  return best ? { headerRow: best.headerRow, columns: best.columns } : null;
}

export function cell<F extends string>(loc: Located<F>, cells: readonly CellValue[], field: F): CellValue | undefined {
  const c = loc.columns.get(field);
  return c === undefined ? undefined : cells[c];
}

export function rowIsBlank(cells: readonly CellValue[]): boolean {
  return cells.every((c) => cellText(c) === "");
}

/** Concatenated text of the first `n` rows (titles, notes, KPI blocks). */
export function headText(sheet: SheetData, n = 8): string {
  const parts: string[] = [];
  for (let r = 0; r < Math.min(n, sheet.rows.length); r++) {
    for (const c of sheet.rows[r] ?? []) {
      const t = cellText(c);
      if (t) parts.push(t);
    }
  }
  return parts.join(" | ");
}

/** Value to the right of a label cell (e.g. "Primary degree" -> "TESU BSBA in Accounting"). */
export function labelValue(wb: readonly SheetData[], label: string, maxRows = 40): string | null {
  const want = norm(label);
  for (const sheet of wb) {
    for (let r = 0; r < Math.min(maxRows, sheet.rows.length); r++) {
      const row = sheet.rows[r] ?? [];
      for (let c = 0; c < row.length - 1; c++) {
        if (norm(cellText(row[c])) !== want) continue;
        for (let k = c + 1; k < Math.min(row.length, c + 4); k++) {
          const v = cellText(row[k]);
          if (v) return v;
        }
      }
    }
  }
  return null;
}

// ── course identity ──────────────────────────────────────────────────────────

/** "COM-2090 Public Speaking", "SOS-1100 Fact, Fiction, or Fake?" */
const TESU_CODE = /^([A-Z]{2,4})[- ](\d{3,4})\b\s*[—–:-]?\s*(.*)$/;
/** "Business 103 — Business Law", "Political Science 102: American Government" */
const PROVIDER_CODE = /^([A-Z][A-Za-z.&]*(?: [A-Z][A-Za-z.&]*){0,2}) (\d{2,3})\s*[—–:-]\s*(.+)$/;

export interface ParsedCourse {
  readonly code: string | null;
  readonly title: string;
  /** Trailing status qualifier removed from the title ("— HOLD", "— NO VALIDATED MAP"). */
  readonly qualifier: string | null;
  /** Normalised identity tokens (code, title, subject+number). */
  readonly ids: readonly string[];
}

const SUBJECT_ALIASES: Record<string, string> = {
  psych: "psychology",
  psy: "psychology",
  soc: "sociology",
  cj: "criminaljustice",
  crim: "criminaljustice",
  bus: "business",
  acc: "accounting",
  econ: "economics",
  comm: "communications",
  com: "communications",
  polisci: "politicalscience",
  pols: "politicalscience",
  hist: "history",
  math: "mathematics",
};

const PROVIDER_PREFIX = /^(sophia|study\.?\s?com|csm(?:\s+learn)?|tecep|coopersmith|tesu)\s*[:—–-]\s*/i;

export function stripProviderPrefix(s: string): string {
  return s.replace(PROVIDER_PREFIX, "").trim();
}

function subjectKey(subject: string): string {
  const n = norm(subject);
  return SUBJECT_ALIASES[n] ?? n;
}

/** Splits a course cell into code/title and builds the normalised identity tokens. */
const QUALIFIER = /\s+[—–-]\s+((?:HOLD|DO NOT BUY|NO VALIDATED MAP|REMOVED FROM DEFAULT|PROVISIONAL|CONDITIONAL|WATCH)\b.*)$/;

export function parseCourseText(raw: string, codeColumn?: string | null): ParsedCourse {
  let text = stripProviderPrefix(raw.replace(/\s+/g, " ").trim());
  const q = QUALIFIER.exec(text);
  if (q) text = text.slice(0, q.index).trim();
  let code: string | null = null;
  let title = text;
  const tesu = TESU_CODE.exec(text);
  const prov = tesu ? null : PROVIDER_CODE.exec(text);
  if (tesu) {
    code = `${tesu[1]}-${tesu[2]}`;
    title = tesu[3]!.trim() || code;
  } else if (prov) {
    code = `${prov[1]} ${prov[2]}`;
    title = prov[3]!.trim();
  }
  const extra = (codeColumn ?? "").trim();
  if (!code && extra) code = extra;
  const ids = new Set<string>();
  const add = (s: string | null | undefined) => {
    const n = s ? norm(s) : "";
    if (n.length >= 4) ids.add(n);
  };
  add(code);
  add(extra);
  add(title);
  add(text);
  if (prov) ids.add(`${subjectKey(prov[1]!)}${prov[2]}`);
  if (tesu) ids.add(`${norm(tesu[1]!)}${tesu[2]}`);
  return { code: code ? code.slice(0, 40) : null, title: title.slice(0, 200), qualifier: q ? q[1]!.trim() : null, ids: [...ids] };
}

/** Identity tokens for loose schedule text such as "Psych 310 A1" or "Soc 305". */
export function looseCourseIds(text: string): string[] {
  const out = new Set<string>();
  const m = /([A-Za-z][A-Za-z.&]*(?:\s[A-Za-z][A-Za-z.&]*)?)\s+(\d{2,4})\b/.exec(text);
  if (m) out.add(`${subjectKey(m[1]!)}${m[2]}`);
  const t = norm(text);
  if (t.length >= 4) out.add(t);
  return [...out];
}

/** Stable item key: slug of the code, else of the title. */
export function baseItemKey(code: string | null, title: string): string {
  return slug(code || title, 76) || "item";
}

// ── providers ────────────────────────────────────────────────────────────────

export type ProviderFamily = "sophia" | "studycom" | "tecep" | "tesu" | "csm" | "other_ace" | "collegiate" | "other";

export interface ParsedProvider {
  readonly provider: string | null;
  readonly family: ProviderFamily;
  readonly hold: boolean;
  readonly dropped: boolean;
}

/** "CSM Learn — HOLD" -> provider "CSM Learn", hold; "Do not take" -> dropped. */
export function parseProvider(raw: string): ParsedProvider {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return { provider: null, family: "other", hold: false, dropped: false };
  if (/^do not take$/i.test(text) || /^n\/?a$/i.test(text) || text === "—") {
    return { provider: null, family: "other", hold: false, dropped: /^do not take$/i.test(text) };
  }
  const [head, ...rest] = text.split(/\s+[—–]\s+/);
  const tail = rest.join(" ");
  const provider = (head ?? text).trim().slice(0, 120);
  const hold = /hold|do not buy/i.test(tail);
  return { provider, family: familyOf(provider), hold, dropped: false };
}

export function familyOf(provider: string | null | undefined): ProviderFamily {
  const p = (provider ?? "").toLowerCase();
  if (!p) return "other";
  if (/tecep/.test(p)) return "tecep";
  if (/sophia/.test(p)) return "sophia";
  if (/study\.?\s?com/.test(p)) return "studycom";
  if (/csm/.test(p)) return "csm";
  if (/tesu|thomas edison|residency/.test(p)) return "tesu";
  if (/coopersmith|saylor|straighterline|ace\b|nccrs/.test(p)) return "other_ace";
  if (/college|university|community|bergen|dallas/.test(p)) return "collegiate";
  return "other";
}

// ── text classification ──────────────────────────────────────────────────────

export const isDash = (s: string): boolean => /^[—–-]?$/.test(s.trim()) || /^n\/?a$/i.test(s.trim());

/** True when the text signals an unconfirmed transfer mapping. */
export const CONDITIONAL_MAPPING = /preapprov|provisional|conditional|verify (?:current )?(?:tesu )?(?:posting|evaluation|equivalency)|no validated map|assumed|evaluation-watch/i;
export const CONDITION_TEXT = /fallback|conditional|only after|unless|if tesu|do not buy until|hold until|preapprov/i;

export function clipText(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

export function sentenceMatching(text: string, re: RegExp): string {
  const parts = text.split(/(?<=[.;])\s+/);
  const hit = parts.find((p) => re.test(p));
  return (hit ?? text).trim();
}

// ── loose dates ──────────────────────────────────────────────────────────────

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_RE = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
export function isoOf(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (y < 1990 || y > 2200 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export interface DateMention {
  readonly iso: string;
  readonly index: number;
  readonly hadYear: boolean;
}

/**
 * Every calendar date mentioned in free text ("12 Sep", "Sep 12", "3 Nov 2026",
 * "2026-11-03"). A mention without a year takes the year of `base` (an ISO date
 * or year), moving to the next year when that would put it more than ~4 months
 * before `base` (schedules that cross New Year).
 */
export function datesInText(text: string, base: string | number | null): DateMention[] {
  const out: DateMention[] = [];
  const baseYear = typeof base === "number" ? base : base ? Number(base.slice(0, 4)) : null;
  const baseIso = typeof base === "string" ? base : null;
  const resolve = (y: number | null, m: number, d: number): { iso: string; hadYear: boolean } | null => {
    if (y !== null) {
      const iso = isoOf(y, m, d);
      return iso ? { iso, hadYear: true } : null;
    }
    if (baseYear === null) return null;
    let iso = isoOf(baseYear, m, d);
    if (iso && baseIso && dayNumber(iso) < dayNumber(baseIso) - 120) iso = isoOf(baseYear + 1, m, d);
    return iso ? { iso, hadYear: false } : null;
  };
  const taken: [number, number][] = [];
  const push = (index: number, len: number, hit: { iso: string; hadYear: boolean } | null) => {
    if (!hit) return;
    if (taken.some(([a, b]) => index < b && index + len > a)) return;
    taken.push([index, index + len]);
    out.push({ iso: hit.iso, index, hadYear: hit.hadYear });
  };
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m.index!, m[0].length, resolve(Number(m[1]), Number(m[2]), Number(m[3])));
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\b\\.?(?:,?\\s+(\\d{4}))?`, "gi"))) {
    push(m.index!, m[0].length, resolve(m[3] ? Number(m[3]) : null, MONTH_INDEX[m[2]!.slice(0, 3).toLowerCase()]!, Number(m[1])));
  }
  for (const m of text.matchAll(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "gi"))) {
    push(m.index!, m[0].length, resolve(m[3] ? Number(m[3]) : null, MONTH_INDEX[m[1]!.slice(0, 3).toLowerCase()]!, Number(m[2])));
  }
  return out.sort((a, b) => a.index - b.index);
}

/** A range like "Tue 1 Sep – Mon 7 Sep" -> [start, end]. */
export function dateRange(text: string, base: string | number | null): { start: string; end: string } | null {
  const first = datesInText(text, base);
  if (first.length === 0) return null;
  const start = first[0]!.iso;
  if (first.length === 1) return { start, end: start };
  const second = datesInText(text, start).find((m) => m.index === first[1]!.index);
  return { start, end: second?.iso ?? first[1]!.iso };
}

// ── exception codes produced by conversion (kept across draft edits) ─────────

export const S07_CONVERSION_CODES: readonly RoadmapExceptionCode[] = [
  "COMPANION_ROW_UNMATCHED",
  "COMPANION_ITEM_MERGED",
  "DEADLINE_CONFLICT",
  "REPORTED_HISTORY_NOT_CREDIT",
  "SHEET_NOT_RECOGNISED",
];

/** Codes a conversion (as opposed to content validation) may emit; used when re-finalizing a merged result. */
export const CONVERSION_ONLY_CODES: ReadonlySet<RoadmapExceptionCode> = new Set<RoadmapExceptionCode>([
  "UNKNOWN_TEMPLATE",
  "MISSING_REQUIRED_COLUMN",
  "UNMAPPED_COLUMN",
  "ROW_SKIPPED",
  "MISSING_TITLE",
  "INVALID_DATE",
  "INVALID_CREDITS",
  "INVALID_TASK_COUNT",
  "PHASE_CREATED_FROM_ROW",
  "OBJECTIVE_CREATED_FROM_ROW",
  "GENERATED_ITEM_KEY",
  "AI_LOW_CONFIDENCE",
  "AI_CREDIT_CLAIM_IGNORED",
  "CONDITIONAL_ALLOCATION",
  "PACKAGE_INVALID",
  ...S07_CONVERSION_CODES,
]);
