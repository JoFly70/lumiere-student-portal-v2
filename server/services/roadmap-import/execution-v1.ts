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
  date: ["Date", "When", "Target Date"],
  title: ["Milestone", "Event", "Gate"],
  kind: ["Type", "Kind"],
} as const;
type MilestoneField = keyof typeof MILESTONE_SPEC;

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
  const upsertCourse = (init: Omit<ExecCourse, "ids" | "tasks" | "rows"> & { ids: string[] }): ExecCourse => {
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
    const c: ExecCourse = { ...init, rows: [{ sheet: init.sheet, row: init.row }], tasks: [] };
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
  const widen = (c: ExecCourse, start: string | null, end: string | null): void => {
    if (start && (!c.plannedStart || start < c.plannedStart)) c.plannedStart = start;
    if (end && (!c.plannedEnd || end > c.plannedEnd)) c.plannedEnd = end;
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
      if (dates.length > 0) widen(course, dates[0]!, dates[dates.length - 1]!);
      else if (wr && weekStart.has(wr.from)) widen(course, weekStart.get(wr.from)!, weekEnd.get(wr.to) ?? weekEnd.get(wr.from) ?? null);
    }
  }

  // 3) lane grid deliverables
  if (gridSheet && gridSheet.kind === "grid") {
    const loc = gridSheet.loc as Located<GridField>;
    for (let r = loc.headerRow + 1; r < gridSheet.sheet.rows.length; r++) {
      const cells = gridSheet.sheet.rows[r] ?? [];
      const wk = numOf(cell(loc, cells, "wk"));
      if (wk === null) continue;
      const start = weekStart.get(wk) ?? null;
      const resolve = (label: string): ExecCourse | undefined => findCourse(looseCourseIds(label));
      for (const part of cellText(cell(loc, cells, "due")).split(/[;\n]+/)) {
        const m = /^(.*?)\s+A(\d)\b(.*)$/i.exec(part.trim());
        if (!m) continue;
        const date = datesInText(m[3]!, start)[0]?.iso ?? null;
        const course = resolve(m[1]!);
        if (!course || !date) continue;
        setTask(course, { key: `assignment-${m[2]}`, kind: "assignment", title: `Assignment ${m[2]}`, dueDate: date, week: wk, row: r + 1 }, gridSheet.sheet.name);
        widen(course, null, date);
      }
      for (const part of cellText(cell(loc, cells, "exam")).split(/[;\n]+/)) {
        const m = /^(.*?)\s*[—–-]\s*(.+)$/.exec(part.trim());
        if (!m || /no final/i.test(part)) continue;
        const date = datesInText(m[2]!, start)[0]?.iso ?? null;
        const course = m[1]!.trim() ? resolve(m[1]!) : undefined;
        if (!course || !date) continue;
        setTask(course, { key: "final-exam", kind: "exam", title: "Final exam", dueDate: date, week: wk, row: r + 1 }, gridSheet.sheet.name);
        widen(course, null, date);
      }
      // tasks seen in a week inherit the week number when still unset
      for (const course of out.courses) for (const t of course.tasks) if (t.dueDate && t.week === null && start && weekEnd.has(wk) && t.dueDate >= start && t.dueDate <= weekEnd.get(wk)!) t.week = wk;
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

  // 5) milestone lists
  for (const c of sheets) {
    if (c.kind !== "milestones") continue;
    out.sheetsRead.push(c.sheet.name);
    for (let r = c.loc.headerRow + 1; r < c.sheet.rows.length; r++) {
      const cells = c.sheet.rows[r] ?? [];
      if (rowIsBlank(cells)) continue;
      const title = cellText(cell(c.loc, cells, "title"));
      if (!title) continue;
      out.rowsRead++;
      const d = parseDateCell(cell(c.loc, cells, "date"));
      if (d.invalid) warn("INVALID_DATE", "warning", `${c.sheet.name} row ${r + 1}: date ${JSON.stringify(cellText(cell(c.loc, cells, "date")))} could not be read.`, { sheet: c.sheet.name, row: r + 1, column: "Date" });
      addMilestone(title, d.value, c.sheet.name, r + 1);
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
