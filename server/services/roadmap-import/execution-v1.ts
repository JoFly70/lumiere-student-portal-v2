/**
 * `lumiere-execution-v1` — Lumière's weekly execution-schedule workbook family.
 *
 * Recognised by header discovery:
 *  - course cards: Wk, Provider, Course, Code, Cr, ..., Challenges / Chapters,
 *    Milestones / Final, Assignments, How to finish (task counts and dated
 *    hints such as "A1 due 20 Sep; final 30 Sep");
 *  - lane grids: Wk, Dates ("Tue 1 Sep - Mon 7 Sep"), per-provider lane
 *    columns, "Paper due" and "SDC exam" columns (dated deliverables);
 *  - activity lists: Week, Week Of, Course, Provider, Task, Due, Type
 *    (one row per scheduled deliverable, including non-course milestones);
 *  - milestone lists: Date + Milestone.
 *
 * `parseExecution` is shared by the companion merge (execution workbook merged
 * into a master conversion) and by the standalone adapter (execution workbook
 * uploaded alone: a degraded draft with a warning, since degree structure,
 * credit placement and prior history are missing).
 */
import { ROADMAP_CONTENT_VERSION, type ConversionResult, type RoadmapException, type RoadmapExceptionCode, type RoadmapExceptionSeverity, type RoadmapExceptionRef } from "@shared/student-roadmap-contract";
import { isLedgerSheet } from "./degree-master-v1";
import { finalizeContent } from "./finalize";
import { ExceptionCollector, type AdapterContext, type CellValue, type SheetData, type WorkbookAdapter, type WorkbookData } from "./types";
import { cellText, norm, parseCredits, parseDateCell, slug } from "./util";
import {
  addDaysIso,
  baseItemKey,
  cell,
  clipText,
  datesInText,
  dateRange,
  headText,
  locateHeader,
  looseCourseIds,
  parseCourseText,
  parseProvider,
  rowIsBlank,
  subjectKey,
  wordsOf,
  type Located,
} from "./s07-shared";

export const EXECUTION_V1_ID = "lumiere-execution-v1";

const CARDS_SPEC = {
  wk: ["Wk", "Week"],
  provider: ["Provider"],
  course: ["Course", "Course Title"],
  code: ["Code"],
  credits: ["Cr", "Credits"],
  slot: ["Slot"],
  level: ["Level"],
  challenges: ["Challenges / Chapters", "Challenges"],
  milestones: ["Milestones / Final", "Milestones"],
  assignments: ["Assignments", "Papers"],
  how: ["How to finish this course", "How to finish", "Plan"],
} as const;
type CardsField = keyof typeof CARDS_SPEC;

const GRID_SPEC = {
  wk: ["Wk", "Week"],
  dates: ["Dates"],
  due: ["Paper due", "Due this week", "Due"],
  exam: ["SDC exam", "Exam"],
} as const;
type GridField = keyof typeof GRID_SPEC;

const ACTIVITY_SPEC = {
  wk: ["Week", "Wk"],
  weekOf: ["Week Of", "Week Start", "Week Starting", "Starts"],
  course: ["Course", "Course / Activity", "Activity", "Course / action"],
  provider: ["Provider"],
  task: ["Task", "Deliverable", "Assessment"],
  due: ["Due", "Due Date"],
  type: ["Type", "Kind"],
} as const;
type ActivityField = keyof typeof ACTIVITY_SPEC;

const MILESTONE_SPEC = {
  date: ["Date", "When", "Target Date", "Value"],
  title: ["Milestone", "Event", "Gate", "Constant", "Checkpoint"],
  kind: ["Type", "Kind"],
} as const;
type MilestoneField = keyof typeof MILESTONE_SPEC;

/** Provider tracker tables: one row per course with counters (several tables may share a sheet). */
const TRACKER_SPEC = {
  course: ["Course"],
  credits: ["Cr", "Credits"],
  format: ["Format"],
  challenges: ["Challenges"],
  milestones: ["Milestones", "Milestones (timed tests)"],
  touchstones: ["Touchstones"],
  papers: ["Papers", "Assignments"],
  hasFinal: ["Has final?"],
  finish: ["Finish target", "Final / Finish Target", "Finish Target"],
  examDate: ["Exam date", "Exam / paper date"],
  status: ["Status"],
} as const;
type TrackerField = keyof typeof TRACKER_SPEC;

/** Dated assignment lists: Due, Course, Assignment. */
const ASSIGN_SPEC = {
  due: ["Due", "Due Date"],
  course: ["Course"],
  assignment: ["Assignment", "Deliverable"],
} as const;
type AssignField = keyof typeof ASSIGN_SPEC;

// ── model ────────────────────────────────────────────────────────────────────

export interface ExecTask {
  key: string;
  kind: "challenge" | "milestone" | "touchstone" | "paper" | "quiz" | "exam" | "assignment" | "other";
  title: string;
  dueDate: string | null;
  week: number | null;
  row: number;
}

export interface ExecCourse {
  sheet: string;
  row: number;
  rows: { sheet: string; row: number }[];
  provider: string | null;
  code: string | null;
  title: string;
  ids: string[];
  credits: string | null;
  weekFrom: number | null;
  weekTo: number | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  tasks: ExecTask[];
  /** Conditional lane text ("only if ... confirms; otherwise a replacement"), or null. */
  condition: string | null;
}

export interface ExecMilestone {
  title: string;
  date: string | null;
  kind: "checkpoint" | "application" | "graduation";
  sheet: string;
  row: number;
}

export interface ExecConflict {
  readonly course: ExecCourse;
  readonly what: string;
  readonly a: string;
  readonly b: string;
  readonly sheet: string;
  readonly row: number;
}

export interface ExecData {
  courses: ExecCourse[];
  milestones: ExecMilestone[];
  conflicts: ExecConflict[];
  schedule: { preparedOn: string | null; startsOn: string | null; weeks: number | null; label: string | null };
  sheetsRead: string[];
  rowsRead: number;
  /** Conversion findings raised while reading the execution workbook. */
  exceptions: RoadmapException[];
}

const MILESTONE_WORDS = /orientation|graduat|conferr|apply for|commencement|transcript request/i;
const TASK_KIND: [RegExp, ExecTask["kind"]][] = [
  [/touchstone/i, "touchstone"],
  [/challenge/i, "challenge"],
  [/milestone/i, "milestone"],
  [/\b(paper|essay)\b/i, "assignment"],
  [/quiz/i, "quiz"],
  [/exam|final|midterm|tecep/i, "exam"],
  [/assign|homework|project|\bA\d\b/i, "assignment"],
];
const kindOfTaskText = (t: string): ExecTask["kind"] => TASK_KIND.find(([re]) => re.test(t))?.[1] ?? "other";

export function executionSheets(wb: WorkbookData) {
  return wb.sheets.map((sheet) => {
    if (isLedgerSheet(sheet)) return { kind: "ledger" as const, sheet };
    const cards = locateHeader(sheet, CARDS_SPEC, ["provider", "course", ["challenges", "milestones", "assignments", "how"]]);
    if (cards) return { kind: "cards" as const, sheet, loc: cards };
    const grid = locateHeader(sheet, GRID_SPEC, ["wk", "dates", ["due", "exam"]]);
    if (grid) return { kind: "grid" as const, sheet, loc: grid };
    const activity = locateHeader(sheet, ACTIVITY_SPEC, ["wk", "course", ["task", "due"]]);
    if (activity) return { kind: "activity" as const, sheet, loc: activity };
    const ms = locateHeader(sheet, MILESTONE_SPEC, ["date", "title"], 10);
    if (ms) return { kind: "milestones" as const, sheet, loc: ms };
    return { kind: "other" as const, sheet };
  });
}

function detect(wb: WorkbookData): number {
  const kinds = executionSheets(wb).map((s) => s.kind);
  if (kinds.includes("ledger")) return 0;
  if (kinds.includes("cards")) return 0.85;
  if (kinds.includes("grid") || kinds.includes("activity")) return 0.8;
  return 0;
}

// ── parsing ──────────────────────────────────────────────────────────────────

const numOf = (v: CellValue | undefined): number | null => {
  const t = cellText(v);
  return /^\d{1,3}$/.test(t) ? Number(t) : null;
};

function weekRange(v: CellValue | undefined): { from: number; to: number } | null {
  const t = cellText(v);
  const m = /^(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?$/.exec(t);
  if (!m) return null;
  return { from: Number(m[1]), to: Number(m[2] ?? m[1]) };
}


// ── table scanning (several tables may share one sheet) ──────────────────────

interface TableAt<F extends string> {
  readonly sheet: SheetData;
  readonly headerRow: number;
  readonly endRow: number;
  readonly columns: Map<F, number>;
}

function lookupOf<F extends string>(spec: Record<F, readonly string[]>): Map<string, F> {
  const lookup = new Map<string, F>();
  for (const field of Object.keys(spec) as F[]) for (const alias of spec[field]) lookup.set(norm(alias), field);
  return lookup;
}

/** Every header row of a table in `sheet` (not only the best one), with the rows it spans (to the next blank row). */
function findTables<F extends string>(sheet: SheetData, spec: Record<F, readonly string[]>, required: readonly (F | readonly F[])[]): TableAt<F>[] {
  const lookup = lookupOf(spec);
  const tables: TableAt<F>[] = [];
  for (let r = 0; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    const columns = new Map<F, number>();
    row.forEach((v, c) => {
      const text = cellText(v);
      if (!text) return;
      const field = lookup.get(norm(text));
      if (field && !columns.has(field)) columns.set(field, c);
    });
    const ok = required.every((req) => (Array.isArray(req) ? (req as readonly F[]).some((f) => columns.has(f)) : columns.has(req as F)));
    if (!ok) continue;
    // spacer rows (up to 3) may separate a header from its first data row
    let end = r + 1;
    let spacers = 0;
    while (end < sheet.rows.length && rowIsBlank(sheet.rows[end] ?? []) && spacers < 3) {
      end++;
      spacers++;
    }
    while (end < sheet.rows.length && !rowIsBlank(sheet.rows[end] ?? [])) end++;
    tables.push({ sheet, headerRow: r, endRow: end, columns });
    r = end - 1;
  }
  return tables;
}

const PROVIDER_HINT = /^(sophia|study\.?\s?com|csm(?:\s+learn)?|tecep|tesu)\b/i;
function canonicalProvider(raw: string): string {
  const t = raw.toLowerCase();
  if (t.startsWith("sophia")) return "Sophia";
  if (t.startsWith("study")) return "Study.com";
  if (t.startsWith("csm")) return "CSM Learn";
  if (t.startsWith("tecep")) return "TESU TECEP";
  return "TESU Online";
}
function firstCellText(cells: readonly CellValue[] | undefined): string {
  for (const c of cells ?? []) {
    const t = cellText(c);
    if (t) return t;
  }
  return "";
}
/** Provider of a tracker table: a section title just above it, else the sheet title. */
function providerNear(sheet: SheetData, headerRow: number): string | null {
  for (let r = headerRow - 1; r >= Math.max(0, headerRow - 3); r--) {
    const m = PROVIDER_HINT.exec(firstCellText(sheet.rows[r]));
    if (m) return canonicalProvider(m[1]!);
  }
  const m = /\b(sophia|study\.?\s?com|tecep|csm learn)\b/i.exec(headText(sheet, 3));
  return m ? canonicalProvider(m[1]!) : null;
}
/** "13 COURSES / 39 CREDITS" -> 3 (only when it divides evenly: the workbook's own stated arithmetic). */
function statedCreditsPerCourse(sheet: SheetData): string | null {
  const m = /(\d{1,3})\s+courses?\s*[·/•-]\s*(\d{1,4})\s+(?:upper-level\s+)?credits/i.exec(headText(sheet, 4));
  if (!m) return null;
  const n = Number(m[1]);
  const total = Number(m[2]);
  return n > 0 && total % n === 0 ? String(total / n) : null;
}
const isNumber = (v: CellValue | undefined): boolean => typeof v === "number" && Number.isFinite(v);
const COMPLETED_SHEET = /completed|already earned|read only/i;

// ── lane scanning ────────────────────────────────────────────────────────────

const LANE_HEADER = /^(course\s+[a-z]|lane\s*\d?)$|^(sophia|study\.?\s?com|csm(?:\s+learn)?|tecep|tesu)\b.*\b(this week|finish|lane)\b/i;
const LANE_PREFIX = /^([A-Za-z][A-Za-z\-/ ]{0,24}?) · (.*)$/s;
const NON_WORK_PREFIX = /^(closed|admin|prep only)\b/i;
const WORK_PREFIX = /^(quiz|stretch quiz|paper|high-load paper|paper \/ wrap|exam|exam prep|speech|tesu-write|unlock)\b/i;
const LEADING_NOISE: readonly (readonly string[])[] = [["u", "s"], ["introduction", "to"], ["intro", "to"]];
const ADMIN_VERB = /^(send|request|message|register|confirm|buy|screenshot|map|chase|paste|order)\b/i;
/** "Keep a second quiz course alive", "Light second quiz only", "Second quiz course." — capacity placeholders, not courses. */
const GENERIC_LANE = /^(?:keep a |light |another |a )?(?:second|extra|other) (?:quiz|paper)(?: course)?(?: alive| only)?\.?$|^(?:keep a )?second quiz(?: course)?\.?(?: do not start .*)?$/i;

/** Word sequences that identify a course in free lane text ("Acc 201", "Soc 305", "Intro to IT", "Government"). */
function aliasSeqs(c: ExecCourse): string[][] {
  const seqs: string[][] = [];
  const seen = new Set<string>();
  const add = (w: string[]): void => {
    if (!(w.length >= 2 || (w.length === 1 && w[0]!.length >= 6))) return;
    const k = w.join(" ");
    if (seen.has(k)) return;
    seen.add(k);
    seqs.push(w);
  };
  const codeLike = c.code ?? (/^(.+?)\s+(\d{2,4})$/.exec(c.title)?.[0] ?? null);
  const cm = codeLike ? /^(.+?)[\s-]+(\d{2,4})$/.exec(codeLike) : null;
  if (cm) {
    const subj = wordsOf(cm[1]!);
    const num = cm[2]!;
    add([...subj, num]);
    if (subj.length === 1) {
      const w = subj[0]!;
      for (const k of [3, 4, 5]) if (w.length > k) add([w.slice(0, k), num]);
      add([subjectKey(w), num]);
    } else if (subj.length > 1) add([subj.map((w) => w[0]).join(""), num]);
  }
  for (const part of c.title.split(/\s*[\/—–:]\s*/)) {
    let words = wordsOf(part.replace(/\([^)]*\)/g, " "));
    if (words.length === 0) continue;
    add(words);
    for (const lead of LEADING_NOISE) {
      if (words.length > lead.length && lead.every((w, i) => words[i] === w)) {
        words = words.slice(lead.length);
        add(words);
        if (lead[0] === "introduction" || lead[0] === "intro") {
          if (words.length >= 2) add(["intro", "to", words.map((w) => w[0]).join("")]);
          add(["intro", "to", ...words]);
        }
        break;
      }
    }
  }
  return seqs;
}

function seqIndex(words: readonly string[], seq: readonly string[]): number {
  for (let i = 0; i + seq.length <= words.length; i++) {
    let ok = true;
    for (let j = 0; j < seq.length; j++) {
      if (words[i + j] !== seq[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

export function parseExecution(wb: WorkbookData): ExecData {
  const sheets = executionSheets(wb);
  const exceptions = new ExceptionCollector();
  const out: ExecData = {
    courses: [],
    milestones: [],
    conflicts: [],
    schedule: { preparedOn: null, startsOn: null, weeks: null, label: null },
    sheetsRead: [],
    rowsRead: 0,
    exceptions: [],
  };
  const warn = (code: RoadmapExceptionCode, severity: RoadmapExceptionSeverity, message: string, ref: RoadmapExceptionRef, extra?: string) =>
    exceptions.add(code, severity, message, ref, extra);

  // schedule year / preparation date
  const allHead = wb.sheets.map((s) => headText(s, 8)).join(" | ");
  for (const s of wb.sheets) {
    const text = headText(s, 8);
    const m = /\b(prepared|version|rebaselined|updated|as of)\b/i.exec(text);
    if (!m) continue;
    const hit = datesInText(text.slice(m.index, m.index + 90), null).find((d) => d.hadYear);
    if (hit) {
      out.schedule.preparedOn = hit.iso;
      break;
    }
  }
  if (!out.schedule.preparedOn) {
    // version / review lines usually sit in the footer ("Version 2.0 · 2026-09-09", "Reviewed Aug 28, 2026")
    for (const sh of wb.sheets) {
      const tail = sh.rows.slice(-8).map((r) => (r ?? []).map(cellText).filter(Boolean).join(" ")).join(" | ");
      let hit: { iso: string } | undefined;
      for (const m of tail.matchAll(/\b(version|prepared|updated|reviewed)\b/gi)) {
        hit = datesInText(tail.slice(m.index!, m.index! + 90), null).find((d) => d.hadYear);
        if (hit) break;
      }
      if (hit) {
        out.schedule.preparedOn = hit.iso;
        break;
      }
    }
  }
  const yearFrom = (text: string): number | null => {
    const m = /\b(20\d{2})\b/.exec(text);
    return m ? Number(m[1]) : null;
  };

  const byIds = new Map<string, ExecCourse>();
  const findCourse = (ids: readonly string[]): ExecCourse | undefined => {
    for (const id of ids) {
      const hit = byIds.get(id);
      if (hit) return hit;
    }
    return undefined;
  };
  const indexCourse = (c: ExecCourse): void => {
    for (const id of c.ids) if (!byIds.has(id)) byIds.set(id, c);
  };
  const upsertCourse = (init: Omit<ExecCourse, "ids" | "tasks" | "rows" | "condition"> & { ids: string[] }): ExecCourse => {
    const existing = findCourse(init.ids);
    if (existing) {
      for (const id of init.ids) if (!existing.ids.includes(id)) existing.ids.push(id);
      indexCourse(existing);
      existing.rows.push({ sheet: init.sheet, row: init.row });
      existing.provider ??= init.provider;
      existing.code ??= init.code;
      existing.credits ??= init.credits;
      existing.weekFrom ??= init.weekFrom;
      existing.weekTo ??= init.weekTo;
      return existing;
    }
    const c: ExecCourse = { ...init, rows: [{ sheet: init.sheet, row: init.row }], tasks: [], condition: null };
    out.courses.push(c);
    indexCourse(c);
    return c;
  };
  const setTask = (course: ExecCourse, t: Omit<ExecTask, "row"> & { row: number }, sheet: string): void => {
    const existing = course.tasks.find((x) => x.key === t.key);
    if (!existing) {
      if (course.tasks.length < 100) course.tasks.push({ ...t });
      return;
    }
    if (existing.dueDate && t.dueDate && existing.dueDate !== t.dueDate) {
      out.conflicts.push({ course, what: `"${existing.title}"`, a: existing.dueDate, b: t.dueDate, sheet, row: t.row });
      return;
    }
    existing.dueDate ??= t.dueDate;
    existing.week ??= t.week;
  };
  /** Courses whose planned end comes from a stated date (finish target, final, due date), not from lane weeks. */
  const hardEnd = new Set<ExecCourse>();
  const widen = (c: ExecCourse, start: string | null, end: string | null, hard = false): void => {
    if (start && (!c.plannedStart || start < c.plannedStart)) c.plannedStart = start;
    if (end && hard && !hardEnd.has(c)) {
      hardEnd.add(c);
      c.plannedEnd = end;
    } else if (end && (!c.plannedEnd || end > c.plannedEnd) && (hard || !hardEnd.has(c))) c.plannedEnd = end;
  };
  const addMilestone = (title: string, date: string | null, sheet: string, row: number): void => {
    const kind = /conferr/i.test(title) ? "graduation" : /apply|application|filing|register/i.test(title) ? "application" : /graduat/i.test(title) ? "graduation" : "checkpoint";
    if (!out.milestones.some((m) => norm(m.title) === norm(title) && m.date === date)) out.milestones.push({ title: title.slice(0, 200), date, kind, sheet, row });
  };

  // 1) lane grid: week windows first (course cards use them), then dated deliverables
  const weekStart = new Map<number, string>();
  const weekEnd = new Map<number, string>();
  const gridSheet = sheets.find((s) => s.kind === "grid");
  const gridYear = gridSheet ? yearFrom(headText(gridSheet.sheet, 6)) ?? yearFrom(allHead) : yearFrom(allHead);
  let scheduleLabel: string | null = null;
  if (gridSheet && gridSheet.kind === "grid") {
    out.sheetsRead.push(gridSheet.sheet.name);
    scheduleLabel = clipText(firstText(gridSheet.sheet), 200);
    let prev: string | null = null;
    for (let r = gridSheet.loc.headerRow + 1; r < gridSheet.sheet.rows.length; r++) {
      const cells = gridSheet.sheet.rows[r] ?? [];
      const wk = numOf(cell(gridSheet.loc, cells, "wk"));
      if (wk === null) continue;
      out.rowsRead++;
      const datesText = cellText(cell(gridSheet.loc, cells, "dates"));
      const range = dateRange(datesText, prev ?? gridYear);
      if (!range) {
        warn("INVALID_DATE", "warning", `${gridSheet.sheet.name} row ${r + 1}: the week dates "${datesText}" could not be read (a year is needed somewhere in the sheet header).`, { sheet: gridSheet.sheet.name, row: r + 1, column: "Dates" });
        continue;
      }
      weekStart.set(wk, range.start);
      weekEnd.set(wk, range.end);
      prev = range.start;
      out.schedule.weeks = Math.max(out.schedule.weeks ?? 0, wk);
    }
  }

  // 2) course cards
  for (const c of sheets) {
    if (c.kind !== "cards") continue;
    out.sheetsRead.push(c.sheet.name);
    const base = weekStart.get(1) ?? (gridYear ?? yearFrom(allHead));
    for (let r = c.loc.headerRow + 1; r < c.sheet.rows.length; r++) {
      const cells = c.sheet.rows[r] ?? [];
      if (rowIsBlank(cells)) continue;
      const g = (f: CardsField) => cell(c.loc, cells, f);
      const courseText = cellText(g("course"));
      if (!courseText) continue;
      out.rowsRead++;
      const parsed = parseCourseText(courseText, cellText(g("code")));
      const provider = parseProvider(cellText(g("provider")));
      const credits = parseCredits(g("credits"));
      const wr = weekRange(g("wk"));
      const course = upsertCourse({
        sheet: c.sheet.name,
        row: r + 1,
        provider: provider.provider,
        code: parsed.code,
        title: parsed.title,
        ids: [...parsed.ids, ...looseCourseIds(courseText)],
        credits: credits.value,
        weekFrom: wr?.from ?? null,
        weekTo: wr?.to ?? null,
        plannedStart: null,
        plannedEnd: null,
      });
      const mk = (kind: ExecTask["kind"], n: number, label: string) => {
        for (let i = 1; i <= Math.min(n, 100); i++) setTask(course, { key: `${kind}-${i}`, kind, title: `${label} ${i}`, dueDate: null, week: null, row: r + 1 }, c.sheet.name);
      };
      const ch = /(\d{1,3})\s*challenges?/i.exec(cellText(g("challenges")));
      if (ch) mk("challenge", Number(ch[1]), "Challenge");
      const msText = cellText(g("milestones"));
      const ms = /(\d{1,3})\s*milestones?/i.exec(msText) ?? /(\d{1,3})\s*unit/i.exec(msText);
      if (ms) mk("milestone", Number(ms[1]), "Milestone");
      const asText = cellText(g("assignments"));
      const as = /(\d{1,3})\s*(touchstones?|papers?|assignments?)?/i.exec(asText);
      if (as && Number(as[1]) > 0) mk(/touchstone/i.test(as[2] ?? "") ? "touchstone" : "assignment", Number(as[1]), /touchstone/i.test(as[2] ?? "") ? "Touchstone" : "Assignment");
      if (/^chapter tests/i.test(msText) && /final/i.test(msText) && !/no final/i.test(msText)) {
        setTask(course, { key: "final-exam", kind: "exam", title: "Final exam", dueDate: null, week: null, row: r + 1 }, c.sheet.name);
      }
      // dated hints in "How to finish"
      const how = cellText(g("how"));
      const hint = datesInText(how, base);
      for (const m of how.matchAll(/\bA(\d)\b[^.;]*?\bdue\s+/gi)) {
        const after = datesInText(how.slice(m.index! + m[0].length, m.index! + m[0].length + 24), base)[0];
        if (after) setTask(course, { key: `assignment-${m[1]}`, kind: "assignment", title: `Assignment ${m[1]}`, dueDate: after.iso, week: null, row: r + 1 }, c.sheet.name);
      }
      for (const m of how.matchAll(/\bAssignment (\d)\s+on\s+/gi)) {
        const after = datesInText(how.slice(m.index! + m[0].length, m.index! + m[0].length + 24), base)[0];
        if (after) setTask(course, { key: `assignment-${m[1]}`, kind: "assignment", title: `Assignment ${m[1]}`, dueDate: after.iso, week: null, row: r + 1 }, c.sheet.name);
      }
      const fin = /\b(?:take\s+)?final\s+(?:on\s+)?/i.exec(how);
      if (fin) {
        const after = datesInText(how.slice(fin.index + fin[0].length, fin.index + fin[0].length + 24), base)[0];
        if (after && after.index === 0) setTask(course, { key: "final-exam", kind: "exam", title: "Final exam", dueDate: after.iso, week: null, row: r + 1 }, c.sheet.name);
      }
      const dates = hint.map((h) => h.iso).sort();
      if (dates.length > 0) widen(course, dates[0]!, dates[dates.length - 1]!, true);
      else if (wr && weekStart.has(wr.from)) widen(course, weekStart.get(wr.from)!, weekEnd.get(wr.to) ?? weekEnd.get(wr.from) ?? null);
    }
  }

  // 2b) tracker tables (EXTERNAL / TECEP / residency / provider trackers): course identity, credits,
  //     counters, finish targets. Header-content discovery; several tables may share a sheet.
  const planYear = weekStart.get(1) ?? gridYear ?? yearFrom(allHead);
  const weekOf = (iso: string): number | null => {
    for (const [w, st] of weekStart) {
      const en = weekEnd.get(w);
      if (en && iso >= st && iso <= en) return w;
    }
    return null;
  };
  for (const sh of wb.sheets) {
    if (isLedgerSheet(sh) || COMPLETED_SHEET.test(headText(sh, 3))) continue;
    for (const t of findTables<TrackerField>(sh, TRACKER_SPEC, ["course", ["credits", "challenges", "milestones", "touchstones", "papers"]])) {
      const colOf = (f: TrackerField): number | undefined => t.columns.get(f);
      const statusCol = colOf("status");
      if (statusCol !== undefined) {
        const statuses = sh.rows.slice(t.headerRow + 1, t.endRow).map((row) => cellText((row ?? [])[statusCol])).filter(Boolean);
        // a table whose statuses are mostly "Done" is history, not a plan
        if (statuses.length >= 3 && statuses.filter((x) => /^done$/i.test(x)).length / statuses.length >= 0.5) continue;
      }
      const sectionProvider = providerNear(sh, t.headerRow);
      const stated = statedCreditsPerCourse(sh);
      const finishHead = colOf("finish") !== undefined ? cellText((sh.rows[t.headerRow] ?? [])[colOf("finish")!]) : "";
      for (let r = t.headerRow + 1; r < t.endRow; r++) {
        const cells = sh.rows[r] ?? [];
        const g = (f: TrackerField): CellValue | undefined => {
          const c = colOf(f);
          return c === undefined ? undefined : cells[c];
        };
        const courseText = cellText(g("course"));
        if (!courseText || /\bblock\b|\btotal\b|^course$/i.test(courseText)) continue;
        const counts = (["challenges", "milestones", "touchstones", "papers"] as const).map((f) => ({ f, n: isNumber(g(f)) ? Number(g(f)) : 0 }));
        if (!isNumber(g("credits")) && !counts.some((c) => c.n > 0)) continue;
        out.rowsRead++;
        const clean = courseText.replace(/\s*\((?:\d+\s+)?(?:papers?|assignments?)[^)]*\)\s*$/i, "").replace(/\s+·\s+.*$/, "").trim();
        const parsed = parseCourseText(clean);
        const fmt = cellText(g("format"));
        const providerText = /e-?pack/i.test(fmt) ? "TESU e-Pack" : /tesu/i.test(fmt) ? "TESU Online" : sectionProvider;
        const provider = parseProvider(providerText ?? "");
        const credits = isNumber(g("credits")) ? parseCredits(g("credits")).value : stated;
        const course = upsertCourse({
          sheet: sh.name,
          row: r + 1,
          provider: provider.provider,
          code: parsed.code,
          title: parsed.title,
          ids: [...parsed.ids, ...looseCourseIds(clean)],
          credits,
          weekFrom: null,
          weekTo: null,
          plannedStart: null,
          plannedEnd: null,
        });
        const labels = { challenges: ["challenge", "Challenge"], milestones: ["milestone", "Milestone"], touchstones: ["touchstone", "Touchstone"], papers: ["assignment", "Assignment"] } as const;
        for (const { f, n } of counts) {
          const [kind, label] = labels[f];
          for (let i = 1; i <= Math.min(n, 100); i++) setTask(course, { key: `${kind}-${i}`, kind, title: `${label} ${i}`, dueDate: null, week: null, row: r + 1 }, sh.name);
        }
        const finishText = cellText(g("finish"));
        const finishDate = finishText ? datesInText(finishText, planYear)[0]?.iso ?? null : null;
        if (finishDate) {
          widen(course, null, finishDate, true);
          if (/final/i.test(finishHead) && !/no final/i.test(finishText)) {
            setTask(course, { key: "final-exam", kind: "exam", title: "Final exam", dueDate: finishDate, week: weekOf(finishDate), row: r + 1 }, sh.name);
          }
        }
        if (/^(y|yes)/i.test(cellText(g("hasFinal")))) setTask(course, { key: "final-exam", kind: "exam", title: "Final exam", dueDate: null, week: null, row: r + 1 }, sh.name);
        if (colOf("examDate") !== undefined && /tecep|e-?pack/i.test(providerText ?? "")) {
          const examText = cellText(g("examDate"));
          const examDate = examText ? parseDateCell(g("examDate")).value ?? datesInText(examText, planYear)[0]?.iso ?? null : null;
          setTask(course, { key: "final-exam", kind: "exam", title: /tecep/i.test(providerText ?? "") ? "TECEP exam" : "e-Pack exam", dueDate: examDate, week: examDate ? weekOf(examDate) : null, row: r + 1 }, sh.name);
          if (examDate) widen(course, null, examDate, true);
        }
      }
      if (!out.sheetsRead.includes(sh.name)) out.sheetsRead.push(sh.name);
    }

    // 2c) dated assignment lists (Due, Course, Assignment)
    for (const t of findTables<AssignField>(sh, ASSIGN_SPEC, ["due", "course", "assignment"])) {
      for (let r = t.headerRow + 1; r < t.endRow; r++) {
        const cells = sh.rows[r] ?? [];
        const g = (f: AssignField): CellValue | undefined => cells[t.columns.get(f)!];
        const a = cellText(g("assignment"));
        const cText = cellText(g("course"));
        const hit = datesInText(cellText(g("due")), planYear)[0];
        if (!a || !cText || !hit) continue;
        out.rowsRead++;
        const course = findCourse([...parseCourseText(cText).ids, ...looseCourseIds(cText)]);
        if (!course) {
          warn("COMPANION_ROW_UNMATCHED", "warning", `${sh.name} row ${r + 1}: the dated assignment "${a.slice(0, 80)}" names a course ("${cText.slice(0, 80)}") that is not in this workbook's course tables. It was NOT added to the plan.`, { sheet: sh.name, row: r + 1 });
          continue;
        }
        const n = /(\d{1,2})/.exec(a)?.[1] ?? "1";
        setTask(course, { key: `assignment-${n}`, kind: "assignment", title: a.slice(0, 200), dueDate: hit.iso, week: weekOf(hit.iso), row: r + 1 }, sh.name);
        widen(course, null, hit.iso, true);
        if (!out.sheetsRead.includes(sh.name)) out.sheetsRead.push(sh.name);
      }
    }
  }

  // 3) lane grid: dated deliverables, then the work lanes
  if (gridSheet && gridSheet.kind === "grid") {
    const loc = gridSheet.loc as Located<GridField>;
    const gridName = gridSheet.sheet.name;
    const resolve = (label: string): ExecCourse | undefined => findCourse(looseCourseIds(label));
    for (let r = loc.headerRow + 1; r < gridSheet.sheet.rows.length; r++) {
      const cells = gridSheet.sheet.rows[r] ?? [];
      const wk = numOf(cell(loc, cells, "wk"));
      if (wk === null) continue;
      const start = weekStart.get(wk) ?? null;
      for (const part of cellText(cell(loc, cells, "due")).split(/[;\n]+/)) {
        const m = /^(.*?)\s+(?:A(\d)|(final|midterm))\b(.*)$/i.exec(part.trim());
        if (!m) continue;
        const date = datesInText(m[4]!, start)[0]?.iso ?? null;
        const course = resolve(m[1]!);
        if (!course || !date) continue;
        const key = m[2] ? `assignment-${m[2]}` : /midterm/i.test(m[3]!) ? "midterm-exam" : "final-exam";
        setTask(course, { key, kind: m[2] ? "assignment" : "exam", title: m[2] ? `Assignment ${m[2]}` : key === "midterm-exam" ? "Midterm exam" : "Final exam", dueDate: date, week: wk, row: r + 1 }, gridName);
        widen(course, null, date, true);
      }
      for (const part of cellText(cell(loc, cells, "exam")).split(/[;\n]+/)) {
        const m = /^(.*?)\s*[—–-]\s*(.+)$/.exec(part.trim());
        if (!m || /no final/i.test(part)) continue;
        const date = datesInText(m[2]!, start)[0]?.iso ?? null;
        const course = m[1]!.trim() ? resolve(m[1]!) : undefined;
        if (!course || !date) continue;
        setTask(course, { key: "final-exam", kind: "exam", title: "Final exam", dueDate: date, week: wk, row: r + 1 }, gridName);
        widen(course, null, date, true);
      }
      // tasks seen in a week inherit the week number when still unset
      for (const course of out.courses) for (const t of course.tasks) if (t.dueDate && t.week === null && start && weekEnd.has(wk) && t.dueDate >= start && t.dueDate <= weekEnd.get(wk)!) t.week = wk;
    }

    // work lanes ("Course A/B/C", "Sophia — finish this week", ...): free text per week and lane
    const headerCells = gridSheet.sheet.rows[loc.headerRow] ?? [];
    const laneCols: number[] = [];
    headerCells.forEach((h, i) => {
      if (LANE_HEADER.test(cellText(h))) laneCols.push(i);
    });
    const phaseCol = headerCells.findIndex((h) => /^phase$/i.test(cellText(h)));
    if (laneCols.length > 0 && out.courses.length > 0) {
      const aliases = out.courses.map((c) => ({ c, seqs: aliasSeqs(c) }));
      // collective references: "e-Pack quizzes", "CSM", "SOS" (only when they name one course or a whole kind)
      const providerCount = new Map<string, number>();
      const prefixCount = new Map<string, number>();
      for (const c of out.courses) {
        providerCount.set(c.provider ?? "", (providerCount.get(c.provider ?? "") ?? 0) + 1);
        const pre = /^([A-Z]{3})-\d{4}$/.exec(c.code ?? "")?.[1];
        if (pre) prefixCount.set(pre, (prefixCount.get(pre) ?? 0) + 1);
      }
      for (const a of aliases) {
        const pv = a.c.provider ?? "";
        if (/e-?pack/i.test(pv)) a.seqs.push(["e", "pack"], ["e", "packs"], ["epack"], ["epacks"]);
        if (/^csm/i.test(pv) && providerCount.get(pv) === 1) a.seqs.push(["csm"]);
        const pre = /^([A-Z]{3})-\d{4}$/.exec(a.c.code ?? "")?.[1];
        if (pre && prefixCount.get(pre) === 1 && /^tesu online$/i.test(pv)) a.seqs.push([pre.toLowerCase()]);
      }
      const weeksOf = new Map<ExecCourse, Set<number>>();
      const genericLane: { row: number; lane: string }[] = [];
      const deriveTasks = (c: ExecCourse, sentence: string, prefix: string, wk: number, row: number): void => {
        const put = (key: string, kind: ExecTask["kind"], title: string, laterWins = false): void => {
          const existing = c.tasks.find((x) => x.key === key);
          if (existing && laterWins) {
            if (existing.week === null || wk > existing.week) existing.week = wk;
            return;
          }
          setTask(c, { key, kind, title, dueDate: null, week: wk, row }, gridName);
        };
        for (const m of sentence.matchAll(/\bAssignments?\s+(\d)(?:\s*[–-]\s*(\d))?/gi)) {
          for (let n = Number(m[1]); n <= Math.min(Number(m[2] ?? m[1]), Number(m[1]) + 9); n++) put(`assignment-${n}`, "assignment", `Assignment ${n}`);
        }
        for (const m of sentence.matchAll(/\bSpeech\s+(\d)\b/gi)) put(`assignment-${m[1]}`, "assignment", `Speech ${m[1]}`);
        if (/\bfinal[\s-]project\b/i.test(sentence)) put("final-project", "assignment", "Final project");
        else if (/\bfinal\b/i.test(sentence) && !/\bfinal(?:s)?\s+(?:grade|posted)/i.test(sentence)) put("final-exam", "exam", "Final exam", true);
        if (/\bmidterm\b/i.test(sentence)) put("midterm-exam", "exam", "Midterm exam", true);
        if (/^exam$/i.test(prefix) && !c.tasks.some((x) => x.key === "final-exam")) put("final-exam", "exam", "Exam", true);
      };
      for (let r = loc.headerRow + 1; r < gridSheet.sheet.rows.length; r++) {
        const cells = gridSheet.sheet.rows[r] ?? [];
        const wk = numOf(cell(loc, cells, "wk"));
        if (wk === null) continue;
        if (phaseCol >= 0 && /^admin/i.test(cellText(cells[phaseCol]))) continue; // registration / transcript weeks are not coursework
        for (const lc of laneCols) {
          const raw = cellText(cells[lc]);
          if (!raw) continue;
          const pm = LANE_PREFIX.exec(raw);
          const prefix = pm ? pm[1]!.trim() : "";
          const body = pm ? pm[2]! : raw;
          if (prefix && NON_WORK_PREFIX.test(prefix)) continue;
          const hitsInCell = new Set<ExecCourse>();
          for (const sentence of body.split(/(?<=[.!?])\s+/).filter(Boolean)) {
            if (!prefix && ADMIN_VERB.test(sentence.trim())) continue;
            const words = wordsOf(sentence);
            const hits: { c: ExecCourse; at: number }[] = [];
            for (const { c, seqs } of aliases) {
              let at = -1;
              for (const q of seqs) {
                const i = seqIndex(words, q);
                if (i < 0) continue;
                // a bare 3-letter subject ("bus") followed by a number is another course ("Bus 103"), not this one
                if (q.length === 1 && q[0]!.length <= 3 && /^\d/.test(words[i + 1] ?? "")) continue;
                at = at < 0 ? i : Math.min(at, i);
              }
              if (at >= 0) hits.push({ c, at });
            }
            hits.sort((a, b) => a.at - b.at);
            hits.forEach(({ c }, idx) => {
              hitsInCell.add(c);
              if (idx === 0) deriveTasks(c, sentence, prefix, wk, r + 1); // the sentence's subject course owns its tasks
              if (!prefix && /\b(only if|unless|otherwise|replacement)\b/i.test(sentence)) c.condition ??= clipText(sentence, 300);
            });
          }
          for (const c of hitsInCell) {
            const set = weeksOf.get(c) ?? new Set<number>();
            set.add(wk);
            weeksOf.set(c, set);
          }
          const meaningful = prefix
            ? WORK_PREFIX.test(prefix)
            : /\b(open|finish|chapters?|final|assignment|submit)\b/i.test(body) && !/^(no new|confirm|do not)/i.test(body.trim());
          if (hitsInCell.size === 0 && meaningful && GENERIC_LANE.test(body.trim())) {
            genericLane.push({ row: r + 1, lane: cellText(headerCells[lc]).slice(0, 60) });
          } else if (hitsInCell.size === 0 && meaningful) {
            warn(
              "COMPANION_ROW_UNMATCHED",
              "warning",
              `${gridName} row ${r + 1}, lane "${cellText(headerCells[lc])}": scheduled work ("${raw.slice(0, 90)}") names no course found in this workbook's course tables. It was NOT added to the plan; confirm whether a course is missing.`,
              { sheet: gridName, row: r + 1, column: cellText(headerCells[lc]).slice(0, 60) },
              `lane-${lc}`,
            );
          }
        }
      }
      if (genericLane.length > 0) {
        warn(
          "COMPANION_ROW_UNMATCHED",
          "info",
          `${genericLane.length} lane entr${genericLane.length === 1 ? "y" : "ies"} in ${gridName} (first at row ${genericLane[0]!.row}, lane "${genericLane[0]!.lane}") are generic capacity placeholders ("second quiz course", "light second quiz") that name no course. They were not imported as plan items.`,
          { sheet: gridName, row: genericLane[0]!.row, column: genericLane[0]!.lane },
          "generic-lane",
        );
      }
      for (const [c, weeks] of weeksOf) {
        const lo = Math.min(...weeks);
        const hi = Math.max(...weeks);
        c.weekFrom = Math.min(c.weekFrom ?? lo, lo);
        c.weekTo = Math.max(c.weekTo ?? hi, hi);
        widen(c, weekStart.get(lo) ?? null, weekEnd.get(hi) ?? null);
      }
    }
  }

  // 4) activity lists
  for (const c of sheets) {
    if (c.kind !== "activity") continue;
    out.sheetsRead.push(c.sheet.name);
    if (!scheduleLabel) scheduleLabel = clipText(firstText(c.sheet), 200);
    const counters = new Map<string, number>();
    for (let r = c.loc.headerRow + 1; r < c.sheet.rows.length; r++) {
      const cells = c.sheet.rows[r] ?? [];
      if (rowIsBlank(cells)) continue;
      const g = (f: ActivityField) => cell(c.loc, cells, f);
      const wk = numOf(g("wk"));
      const courseText = cellText(g("course"));
      if (wk === null || !courseText) continue;
      out.rowsRead++;
      const ref = { sheet: c.sheet.name, row: r + 1 };
      const wo = parseDateCell(g("weekOf"));
      if (wo.invalid) warn("INVALID_DATE", "warning", `${c.sheet.name} row ${r + 1}: "Week Of" ${JSON.stringify(cellText(g("weekOf")))} could not be read.`, { ...ref, column: "Week Of" });
      const due = parseDateCell(g("due"));
      if (due.invalid) warn("INVALID_DATE", "warning", `${c.sheet.name} row ${r + 1}: Due ${JSON.stringify(cellText(g("due")))} could not be read.`, { ...ref, column: "Due" });
      if (wo.value && !weekStart.has(wk)) {
        weekStart.set(wk, wo.value);
        weekEnd.set(wk, addDaysIso(wo.value, 6));
      }
      out.schedule.weeks = Math.max(out.schedule.weeks ?? 0, wk);
      const typeText = cellText(g("type"));
      if (MILESTONE_WORDS.test(courseText) || /milestone|gate/i.test(typeText)) {
        addMilestone(courseText, due.value ?? wo.value, c.sheet.name, r + 1);
        continue;
      }
      const parsed = parseCourseText(courseText);
      const provider = parseProvider(cellText(g("provider")));
      const course = upsertCourse({
        sheet: c.sheet.name,
        row: r + 1,
        provider: provider.provider,
        code: parsed.code,
        title: parsed.title,
        ids: [...parsed.ids, ...looseCourseIds(courseText)],
        credits: null,
        weekFrom: wk,
        weekTo: wk,
        plannedStart: null,
        plannedEnd: null,
      });
      course.weekFrom = Math.min(course.weekFrom ?? wk, wk);
      course.weekTo = Math.max(course.weekTo ?? wk, wk);
      const taskText = cellText(g("task"));
      if (taskText && !/^(study|work|prep)\b/i.test(typeText)) {
        const kind = kindOfTaskText(typeText || taskText) === "other" ? kindOfTaskText(taskText) : kindOfTaskText(typeText);
        const num = /(\d{1,3})/.exec(taskText)?.[1];
        const counterKey = `${course.ids[0]}|${kind}`;
        if (!num) counters.set(counterKey, (counters.get(counterKey) ?? 0) + 1);
        const idx = num ? Number(num) : counters.get(counterKey)!;
        const key = kind === "exam" ? (/midterm/i.test(taskText) ? "midterm-exam" : "final-exam") : `${kind}-${idx}`;
        setTask(course, { key, kind, title: taskText.slice(0, 200), dueDate: due.value, week: wk, row: r + 1 }, c.sheet.name);
      }
      widen(course, wo.value, due.value ?? (wo.value ? addDaysIso(wo.value, 6) : null));
    }
  }

  // 5) milestone lists and date constants ("Constant | Value", "Checkpoint | When", "Date | Milestone")
  for (const sh of wb.sheets) {
    if (isLedgerSheet(sh)) continue;
    for (const t of findTables<MilestoneField>(sh, MILESTONE_SPEC, ["date", "title"])) {
      for (let r = t.headerRow + 1; r < t.endRow; r++) {
        const cells = sh.rows[r] ?? [];
        const title = cellText(cells[t.columns.get("title")!]);
        if (!title) continue;
        out.rowsRead++;
        const rawDate = cells[t.columns.get("date")!];
        const parsed = parseDateCell(rawDate);
        let date = parsed.value;
        if (!date && cellText(rawDate)) date = datesInText(cellText(rawDate), planYear)[0]?.iso ?? null;
        if (!date && cellText(rawDate)) {
          warn("INVALID_DATE", "warning", `${sh.name} row ${r + 1}: date ${JSON.stringify(cellText(rawDate))} could not be read.`, { sheet: sh.name, row: r + 1, column: "Date" });
        }
        addMilestone(title, date, sh.name, r + 1);
        if (!out.sheetsRead.includes(sh.name)) out.sheetsRead.push(sh.name);
      }
    }
  }

  // schedule metadata
  if (weekStart.size > 0) out.schedule.startsOn = [...weekStart.entries()].sort((a, b) => a[0] - b[0])[0]![1];
  out.schedule.label = scheduleLabel;
  out.exceptions = exceptions.list;
  return out;
}

function firstText(sheet: SheetData): string {
  for (let r = 0; r < Math.min(3, sheet.rows.length); r++) {
    for (const c of sheet.rows[r] ?? []) {
      const t = cellText(c);
      if (t) return t;
    }
  }
  return "";
}

// ── standalone adapter ───────────────────────────────────────────────────────

function convertStandalone(wb: WorkbookData, ctx: AdapterContext): ConversionResult {
  const exec = parseExecution(wb);
  const ex = new ExceptionCollector();
  ex.addAll(exec.exceptions);
  ex.add(
    "UNKNOWN_TEMPLATE",
    "warning",
    "Only an execution workbook was uploaded. The draft holds the scheduled courses, but degree requirements, credit placement, prior history and conditions come from the master academic workbook. Upload it together with this file when possible.",
    { sheet: exec.sheetsRead[0] ?? "(workbook)" },
    "execution-only",
  );
  const file = ctx.fileName ? ctx.fileName.slice(0, 200) : null;
  const used = new Set<string>();
  const items = exec.courses.map((c, i) => {
    let key = baseItemKey(c.code, c.title);
    let n = 1;
    while (used.has(key)) key = `${slug(key, 74)}-${++n}`;
    used.add(key);
    return {
      key,
      phaseKey: "execution-schedule",
      objectiveKey: "primary",
      sequence: i + 1,
      kind: "course",
      code: c.code,
      title: c.title,
      provider: c.provider,
      institution: null,
      credits: c.credits,
      plannedStart: c.plannedStart,
      plannedEnd: c.plannedEnd,
      dependsOn: [],
      planStatus: "planned",
      condition: c.condition ? c.condition.slice(0, 500) : null,
      provenance: c.rows.slice(0, 10).map((r) => ({ file, sheet: r.sheet.slice(0, 120), row: r.row, role: "execution" as const })),
      tasks: c.tasks.map((t, k) => ({ key: t.key, kind: t.kind, title: t.title, sequence: k + 1, dueDate: t.dueDate, week: t.week })),
    };
  });
  const base = ctx.fileName ? ctx.fileName.replace(/\.[^.]+$/, "").replace(/_+/g, " ") : "Execution schedule";
  const raw = {
    contentVersion: ROADMAP_CONTENT_VERSION,
    title: base.slice(0, 200),
    objectives: [{ key: "primary", title: "Primary degree (confirm from the master workbook)", kind: "primary", linkedToProgramAssignment: true, status: "active" }],
    phases: [{ key: "execution-schedule", title: "Execution schedule", sequence: 1 }],
    items,
    milestones: exec.milestones.map((m, i) => ({ key: slug(m.title, 70) || `milestone-${i + 1}`, title: m.title, kind: m.kind, targetDate: m.date, objectiveKey: "primary", afterItemKeys: [] })),
    reportedHistory: [],
    schedule: exec.schedule,
  };
  const finalized = finalizeContent(raw, ex.list);
  return {
    templateId: EXECUTION_V1_ID,
    content: items.length === 0 ? null : finalized.content,
    exceptions: items.length === 0 ? [...finalized.exceptions, ...unknownEx(wb)] : finalized.exceptions,
    summary: { kind: "workbook", fileName: ctx.fileName, sheetsRead: exec.sheetsRead, rowsRead: exec.rowsRead, rowsConverted: items.length, rowsSkipped: 0, generator: null },
  };
}

function unknownEx(wb: WorkbookData): RoadmapException[] {
  const c = new ExceptionCollector();
  c.add("UNKNOWN_TEMPLATE", "blocking", "No scheduled courses were found in the execution workbook.", { sheet: wb.sheets[0]?.name ?? "(workbook)" }, "no-courses");
  return c.list;
}

export const executionV1Adapter: WorkbookAdapter = {
  id: EXECUTION_V1_ID,
  detect,
  convert: convertStandalone,
};
