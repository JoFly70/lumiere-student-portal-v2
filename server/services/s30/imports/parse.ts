/**
 * S30 — Academic Data Import Center: file reading, layout detection, mapping suggestion and row normalisation (pure
 * except readTable, which reuses the S05 bounded .xlsx reader).
 *
 * Safety:
 *  - Size: IMPORT_MAX_BYTES; rows: IMPORT_MAX_ROWS; columns and cell text bounded by the S05 limits.
 *  - Format by content (magic bytes), not by name: .xlsx or UTF-8 text CSV. .xlsx parts are actually inflated with a
 *    hard cap before parsing and the workbook is STREAMED with a row cap (xlsx-stream.ts); a CSV is refused (not
 *    truncated) when it has more non-empty rows than the cap.
 *    Legacy .xls, PDF, images and binary files are refused.
 *  - Formulas: .xlsx formulas are replaced by their cached result (never the formula text); any cell whose text
 *    starts like a formula (= + - @ tab CR) is flagged "formula_text" and never used as a value.
 *  - Students are matched by student code only (never by name), so a typo cannot attach data to the wrong person.
 */
import { createHash } from "node:crypto";
import {
  IMPORT_FIELDS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  type ImportColumnMapping,
  type ImportField,
  type ImportIssue,
  type ImportNormalizedRow,
} from "@shared/s30-contract";
import { logger } from "../../../lib/logger";
import { readXlsxRows, XlsxBudgetError } from "./xlsx-stream";
import { MAX_CELL_TEXT, MAX_COLUMNS, norm } from "../../roadmap-import/util";

export class ImportFileError extends Error {
  constructor(readonly reason: "too_large" | "empty" | "unsupported_format" | "unreadable" | "no_header" | "too_many_rows", message: string) {
    super(message);
    this.name = "ImportFileError";
  }
}

export interface ImportTable {
  readonly format: "csv" | "xlsx";
  readonly sheetName: string | null;
  readonly headers: readonly string[];
  /** Data rows (after the header) as header -> text. rowNumber is the 1-based spreadsheet row. */
  readonly rows: ReadonlyArray<{ readonly rowNumber: number; readonly cells: Readonly<Record<string, string>> }>;
  readonly sha256: string;
  readonly bytes: number;
}

export function detectFormat(buffer: Buffer): "csv" | "xlsx" {
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return "xlsx";
  // OLE2 (.xls), PDF, PNG/JPEG/GIF and anything with NUL bytes is not a CSV.
  const head = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (head.includes(0)) throw new ImportFileError("unsupported_format", "Only .csv and .xlsx files are accepted.");
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") throw new ImportFileError("unsupported_format", "PDF documents cannot be imported reliably; export the results as CSV or XLSX.");
  const text = buffer.toString("utf8");
  if (text.includes("�")) throw new ImportFileError("unsupported_format", "The CSV file must be UTF-8 text.");
  return "csv";
}

/** RFC 4180 CSV with delimiter detection (comma, semicolon, tab). Quoted fields may contain delimiters and newlines. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n/) === -1 ? src.length : src.search(/\r?\n/));
  const count = (d: string) => firstLine.split(d).length - 1;
  const delim = [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0]!;
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let nonEmpty = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") { quoted = true; continue; }
    if (ch === delim) { row.push(cell); cell = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); out.push(row); row = []; cell = "";
      // Only non-empty rows count; blank lines can never cut the file short. Header search allows 10 leading rows.
      if (out[out.length - 1]!.some((c) => c.trim() !== "") && ++nonEmpty > IMPORT_MAX_ROWS + 10) {
        throw new ImportFileError("too_many_rows", `At most ${IMPORT_MAX_ROWS} data rows per file.`);
      }
      continue;
    }
    cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); out.push(row); }
  return out.map((r) => r.slice(0, MAX_COLUMNS).map((c) => (c.length > MAX_CELL_TEXT ? c.slice(0, MAX_CELL_TEXT) : c)));
}

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  return String(v).trim();
};

function tableFromGrid(grid: readonly (readonly unknown[])[], format: "csv" | "xlsx", sheetName: string | null, sha256: string, bytes: number): ImportTable {
  // Header: the first of the first 10 rows with at least two non-empty cells.
  const headerIdx = grid.slice(0, 10).findIndex((r) => r.filter((c) => cellText(c) !== "").length >= 2);
  if (headerIdx < 0) throw new ImportFileError("no_header", "No header row was found (expected column names in the first rows).");
  const seen = new Map<string, number>();
  const headers = grid[headerIdx]!.map((c, i) => {
    const h = cellText(c).replace(/\s+/g, " ").slice(0, 120) || `Column ${i + 1}`;
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h} (${n})`;
  });
  const dataRows: { rowNumber: number; cells: Record<string, string> }[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i]!;
    if (!r.some((c) => cellText(c) !== "")) continue;
    if (dataRows.length >= IMPORT_MAX_ROWS) throw new ImportFileError("too_many_rows", `At most ${IMPORT_MAX_ROWS} data rows per file.`);
    // Null prototype: a header named "__proto__" (or "constructor") is just a column name.
    const cells: Record<string, string> = Object.create(null) as Record<string, string>;
    headers.forEach((h, j) => { cells[h] = cellText(r[j]); });
    dataRows.push({ rowNumber: i + 1, cells });
  }
  return { format, sheetName, headers, rows: dataRows, sha256, bytes };
}

export async function readTable(buffer: Buffer): Promise<ImportTable> {
  if (buffer.length === 0) throw new ImportFileError("empty", "The file is empty.");
  if (buffer.length > IMPORT_MAX_BYTES) throw new ImportFileError("too_large", `Files are limited to ${Math.round(IMPORT_MAX_BYTES / 1024 / 1024)} MB.`);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const format = detectFormat(buffer);
  if (format === "csv") return tableFromGrid(parseCsv(buffer.toString("utf8")), "csv", null, sha256, buffer.length);
  let sheet;
  try {
    // Header (within the first 10 rows) + the data cap: one more non-empty row than that means "too many".
    sheet = await readXlsxRows(buffer, IMPORT_MAX_ROWS + 10);
  } catch (error) {
    // Fixed client message; the parser's own text (which may echo file content) is only logged, without content.
    logger.warn("Import workbook rejected", { kind: error instanceof XlsxBudgetError ? "budget" : "parse", name: error instanceof Error ? error.name : typeof error });
    throw new ImportFileError("unreadable", error instanceof XlsxBudgetError ? "The workbook is too large when expanded or is not a valid .xlsx file." : "The workbook could not be read. Save it again as .xlsx (or export CSV) and retry.");
  }
  if (!sheet.rows.length) throw new ImportFileError("no_header", "No sheet with a header row was found.");
  if (sheet.truncated) throw new ImportFileError("too_many_rows", `At most ${IMPORT_MAX_ROWS} data rows per file.`);
  return tableFromGrid(sheet.rows, "xlsx", sheet.sheetName, sha256, buffer.length);
}

// ── mapping ──────────────────────────────────────────────────────────────────

const SYNONYMS: Record<ImportField, readonly string[]> = {
  student_code: ["studentcode", "code", "studentid", "learnerid", "matricule", "codeeleve", "codeetudiant", "codeetudiante", "student", "eleve", "lumierecode", "id"],
  course: ["course", "coursetitle", "coursename", "cours", "titreducours", "subject", "matiere", "module", "class", "coursecode"],
  task: ["task", "assignment", "lesson", "unit", "item", "exam", "evaluation", "devoir", "lecon", "unite", "activity", "activite"],
  progress_status: ["status", "statut", "completionstatus", "state", "etat", "progressstatus"],
  percent_complete: ["progress", "percentcomplete", "completion", "progression", "complete", "percent", "pourcentage", "avancement", "completionpercent"],
  score_percent: ["score", "grade", "note", "result", "resultat", "mark", "scorepercent", "finalgrade", "finalscore", "notefinale"],
  credits_reported: ["credits", "credithours", "credit", "units", "unites", "creditsearned"],
  reported_on: ["date", "completedon", "completiondate", "reportedon", "lastactivity", "datecompletion", "updated", "dateofcompletion", "datedefin", "completed"],
};

/** Suggests header -> field by normalised synonyms (exact first, then prefix). Each header is used at most once. */
export function suggestMapping(headers: readonly string[]): ImportColumnMapping {
  const used = new Set<string>();
  const out: ImportColumnMapping = {};
  for (const pass of ["exact", "prefix"] as const) {
    for (const field of IMPORT_FIELDS) {
      if (out[field]) continue;
      const hit = headers.find((h) => {
        if (used.has(h)) return false;
        const n = norm(h).replace(/#/g, "");
        return SYNONYMS[field].some((s) => (pass === "exact" ? n === s : n.startsWith(s) && s.length >= 4));
      });
      if (hit) { out[field] = hit; used.add(hit); }
    }
  }
  return out;
}

export function validateMapping(mapping: ImportColumnMapping, headers: readonly string[]): string[] {
  const errors: string[] = [];
  if (!mapping.student_code) errors.push("student_code is required");
  if (!mapping.course) errors.push("course is required");
  const values = Object.values(mapping).filter(Boolean) as string[];
  for (const h of values) if (!headers.includes(h)) errors.push(`unknown column: ${h}`);
  if (new Set(values).size !== values.length) errors.push("a column is mapped to more than one field");
  if (!mapping.progress_status && !mapping.percent_complete && !mapping.score_percent && !mapping.credits_reported) errors.push("map at least one measure (status, percent complete, score or credits)");
  return errors;
}

// ── normalisation ────────────────────────────────────────────────────────────

export const looksLikeFormula = (s: string) => /^[=+@\t\r]/.test(s) || /^-[^\d.\s]/.test(s);

const STATUS_WORDS: Record<NonNullable<ImportNormalizedRow["progressStatus"]>, readonly string[]> = {
  completed: ["completed", "complete", "done", "finished", "passed", "pass", "termine", "terminee", "fini", "reussi", "reussie", "acheve", "achevee", "100"],
  in_progress: ["inprogress", "started", "ongoing", "enrolled", "active", "encours", "commence", "commencee", "partial"],
  not_started: ["notstarted", "notyetstarted", "pending", "todo", "pascommence", "nondebute", "afaire", "notbegun"],
};
export function parseStatus(s: string): ImportNormalizedRow["progressStatus"] | "invalid" | null {
  const n = norm(s).replace(/#/g, "");
  if (!n) return null;
  for (const [k, words] of Object.entries(STATUS_WORDS)) if (words.includes(n)) return k as NonNullable<ImportNormalizedRow["progressStatus"]>;
  return "invalid";
}

/** "85", "85%", "85,5", "0.85" (a fraction when ≤ 1 with decimals). Returns null when empty, NaN when invalid. */
export function parsePercent(s: string): number | null {
  const t = s.replace(/\s/g, "").replace(/%$/, "").replace(",", ".");
  if (!t) return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return Number.NaN;
  let n = Number(t);
  if (n <= 1 && t.includes(".")) n *= 100;
  return n;
}

export function parseNumber(s: string): number | null {
  const t = s.replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

/** ISO date, dd/mm/yyyy or mm/dd/yyyy when unambiguous, or an Excel serial. Returns null (empty) or "invalid". */
export function parseDate(s: string): string | null | "invalid" {
  const t = s.trim();
  if (!t) return null;
  let y: number, m: number, d: number;
  let mt: RegExpMatchArray | null;
  if ((mt = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/))) { y = +mt[1]!; m = +mt[2]!; d = +mt[3]!; }
  else if ((mt = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/))) {
    const a = +mt[1]!, b = +mt[2]!;
    y = +mt[3]!;
    if (a > 12 && b <= 12) { d = a; m = b; } else if (b > 12 && a <= 12) { m = a; d = b; } else if (a === b) { d = a; m = b; } else return "invalid";
  } else if (/^\d{5}$/.test(t)) {
    const serial = Number(t);
    if (serial < 20000 || serial > 80000) return "invalid";
    return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
  } else return "invalid";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 2000 || y > 2100) return "invalid";
  return dt.toISOString().slice(0, 10);
}

export interface PlanCourseRef { readonly key: string; readonly title: string }

/** Matches a course cell to the student's plan by key, full title, or the title before " — ". */
export function matchCourse(value: string, plan: readonly PlanCourseRef[]): PlanCourseRef | null {
  const n = norm(value);
  if (!n) return null;
  return plan.find((c) => norm(c.key) === n) ?? plan.find((c) => norm(c.title) === n) ?? plan.find((c) => norm(c.title.split(" — ")[0]!) === n) ?? null;
}

export interface NormalizeContext {
  readonly today: string;
  /** Student code (upper case) -> student. */
  readonly students: ReadonlyMap<string, { readonly id: string; readonly name: string; readonly isDemo: boolean }>;
  /** Student id -> planned courses (published high-school plan), when known. */
  readonly plans: ReadonlyMap<string, readonly PlanCourseRef[]>;
}

export interface NormalizedOutcome {
  readonly normalized: ImportNormalizedRow | null;
  readonly studentId: string | null;
  readonly studentName: string | null;
  readonly issues: ImportIssue[];
  readonly outcome: "valid" | "warning" | "invalid";
  readonly needsReview: boolean;
}

export function normalizeRow(cells: Readonly<Record<string, string>>, mapping: ImportColumnMapping, ctx: NormalizeContext, tier: "provider_reported" | "institution_reported"): NormalizedOutcome {
  const issues: ImportIssue[] = [];
  const err = (code: ImportIssue["code"], field: ImportField | null) => issues.push({ code, field, severity: "error" });
  const warn = (code: ImportIssue["code"], field: ImportField | null) => issues.push({ code, field, severity: "warning" });
  const info = (code: ImportIssue["code"], field: ImportField | null) => issues.push({ code, field, severity: "info" });
  const get = (f: ImportField): string => {
    const h = mapping[f];
    const v = h ? (cells[h] ?? "").trim() : "";
    if (v && looksLikeFormula(v)) { err("formula_text", f); return ""; }
    return v;
  };

  const code = get("student_code").toUpperCase();
  const courseRaw = get("course").replace(/\s+/g, " ").slice(0, 200);
  const taskRaw = get("task").replace(/\s+/g, " ").slice(0, 200);
  let student: { id: string; name: string; isDemo: boolean } | null = null;
  if (!code) err("student_missing", "student_code");
  else {
    student = ctx.students.get(code) ?? null;
    if (!student) err("student_not_found", "student_code");
    else if (student.isDemo) info("demo_student", "student_code");
  }
  if (!courseRaw) err("course_missing", "course");
  let courseKey: string | null = null;
  if (student && courseRaw) {
    const plan = ctx.plans.get(student.id);
    const hit = plan ? matchCourse(courseRaw, plan) : null;
    if (hit) courseKey = hit.key;
    else warn("course_not_on_plan", "course");
  }

  const statusRaw = get("progress_status");
  let progressStatus: ImportNormalizedRow["progressStatus"] = null;
  if (statusRaw) { const s = parseStatus(statusRaw); if (s === "invalid") err("bad_status", "progress_status"); else progressStatus = s; }
  let percentComplete: number | null = null;
  const pRaw = get("percent_complete");
  if (pRaw) { const p = parsePercent(pRaw); if (p === null || Number.isNaN(p) || p < 0 || p > 100) err("bad_percent", "percent_complete"); else percentComplete = Math.round(p); }
  let scorePercent: number | null = null;
  const sRaw = get("score_percent");
  if (sRaw) { const s = parsePercent(sRaw); if (s === null || Number.isNaN(s) || s < 0 || s > 100) err("bad_score", "score_percent"); else scorePercent = Math.round(s * 100) / 100; }
  let creditsReported: number | null = null;
  const cRaw = get("credits_reported");
  if (cRaw) { const c = parseNumber(cRaw); if (c === null || Number.isNaN(c) || c < 0 || c > 60) err("bad_credits", "credits_reported"); else { creditsReported = Math.round(c * 100) / 100; info("credits_informational", "credits_reported"); } }
  let reportedOn: string | null = null;
  const dRaw = get("reported_on");
  if (dRaw) { const d = parseDate(dRaw); if (d === "invalid") err("bad_date", "reported_on"); else if (d && d > ctx.today) err("future_date", "reported_on"); else reportedOn = d; }

  if (progressStatus === null && percentComplete === null && scorePercent === null && creditsReported === null && !issues.some((i) => ["bad_status", "bad_percent", "bad_score", "bad_credits", "formula_text"].includes(i.code))) err("no_measure", null);
  if (percentComplete === 100 && progressStatus === null) progressStatus = "completed";
  const needsReview = progressStatus === "completed" || (tier === "institution_reported" && scorePercent !== null);
  if (needsReview) info("completion_needs_review", progressStatus === "completed" ? "progress_status" : "score_percent");

  const outcome = issues.some((i) => i.severity === "error") ? "invalid" : issues.some((i) => i.severity === "warning") ? "warning" : "valid";
  return {
    normalized: { studentCode: code || null, course: courseRaw || null, courseKey, task: taskRaw || null, progressStatus, percentComplete, scorePercent, creditsReported, reportedOn },
    studentId: student?.id ?? null, studentName: student?.name ?? null, issues, outcome, needsReview,
  };
}

/** Identity of a reported record: one active record per (student, tier, course, task). */
export function identityKey(tier: string, row: ImportNormalizedRow): string {
  return `${tier}|${row.courseKey ?? norm(row.course ?? "")}|${norm(row.task ?? "")}`.slice(0, 400);
}
export function fingerprint(tier: string, providerLabel: string | null, row: ImportNormalizedRow): string {
  const parts = [identityKey(tier, row), row.progressStatus ?? "", row.percentComplete ?? "", row.scorePercent ?? "", row.creditsReported ?? "", row.reportedOn ?? "", providerLabel ?? ""];
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

/** Neutralises spreadsheet-formula injection when a value is written back to CSV (template, exports). */
export function csvSafe(value: string): string {
  const v = looksLikeFormula(value) ? `'${value}` : value;
  return /[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export const IMPORT_TEMPLATE_CSV = [
  ["student_code", "course", "task", "status", "percent_complete", "score", "credits", "date"].join(","),
  ["LCA-0000-0000", "English 9", "Unit 1 exam", "completed", "100", "82", "", "2026-10-15"].join(","),
].join("\r\n") + "\r\n";
