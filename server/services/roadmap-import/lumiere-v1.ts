import {
  ROADMAP_CONTENT_VERSION,
  ROADMAP_TEMPLATE_V1_ID,
  type ConversionResult,
  type RoadmapException,
} from "@shared/student-roadmap-contract";
import { finalizeContent } from "./finalize";
import { ExceptionCollector, type AdapterContext, type CellValue, type SheetData, type WorkbookAdapter, type WorkbookData } from "./types";
import { clip, cellText, columnLetter, explicitKey, isBlank, MAX_ROWS, norm, parseCredits, parseDateCell, slug, splitList } from "./util";

// ── header aliases ───────────────────────────────────────────────────────────

type PlanField =
  | "phase" | "objective" | "seq" | "code" | "title" | "provider" | "institution" | "credits" | "start" | "end"
  | "dependsOn" | "status" | "holdReason" | "approval" | "alternativeFor" | "challenges" | "milestones"
  | "touchstones" | "papers" | "quizzes" | "exams" | "assignments" | "tasks" | "kind" | "studentNote"
  | "staffNote" | "planKey" | "condition";

const PLAN_ALIASES: Record<PlanField, readonly string[]> = {
  phase: ["Phase", "Stage", "Term", "Block"],
  objective: ["Objective", "Degree", "Goal", "Track"],
  seq: ["Seq", "Order", "#", "Sequence"],
  code: ["Code", "Course Code", "Course #", "Course Number"],
  title: ["Title", "Course", "Course Title", "Course Name", "Item"],
  provider: ["Provider", "Source", "Platform"],
  institution: ["Institution", "Credit To", "School"],
  credits: ["Credits", "Credit", "Cr", "Credit Hours", "SH"],
  start: ["Start", "Start Date", "Planned Start"],
  end: ["End", "End Date", "Target", "Target End", "Due", "Planned End"],
  dependsOn: ["Depends On", "Prereq", "Prerequisites", "Prerequisite"],
  status: ["Status", "Plan Status"],
  holdReason: ["Hold Reason"],
  approval: ["Approval"],
  alternativeFor: ["Alternative For", "Alternative Of"],
  challenges: ["Challenges"],
  milestones: ["Milestones"],
  touchstones: ["Touchstones"],
  papers: ["Papers"],
  quizzes: ["Quizzes"],
  exams: ["Exams"],
  assignments: ["Assignments"],
  tasks: ["Tasks"],
  kind: ["Kind", "Type"],
  studentNote: ["Student Note", "Notes", "Note"],
  staffNote: ["Staff Note", "Internal Note"],
  planKey: ["Plan Key", "Key", "ID"],
  condition: ["Condition", "Conditions"],
};

function buildAliasMap<T extends string>(table: Record<T, readonly string[]>): Map<string, T> {
  const map = new Map<string, T>();
  for (const field of Object.keys(table) as T[]) for (const a of table[field]) map.set(norm(a), field);
  return map;
}
const PLAN_MAP = buildAliasMap(PLAN_ALIASES);

type ObjField = "key" | "title" | "kind" | "institution" | "credential" | "status" | "note";
const OBJ_MAP = buildAliasMap<ObjField>({
  key: ["Key", "ID"], title: ["Title", "Objective", "Name", "Degree"], kind: ["Kind", "Type"],
  institution: ["Institution", "School"], credential: ["Credential", "Credential Label"], status: ["Status"], note: ["Note", "Notes"],
});
type MsField = "key" | "title" | "kind" | "date" | "objective" | "after";
const MS_MAP = buildAliasMap<MsField>({
  key: ["Key", "ID"], title: ["Title", "Milestone", "Name"], kind: ["Kind", "Type"],
  date: ["Target Date", "Date", "Target"], objective: ["Objective", "Degree"], after: ["After", "After Items", "Requires"],
});

// ── sheet helpers ────────────────────────────────────────────────────────────

interface HeaderInfo<F extends string> {
  readonly headerRow: number; // 0-based index into rows
  readonly columns: Map<F, number>;
  readonly unmapped: { col: number; header: string }[];
  readonly recognized: number;
  readonly duplicates: { col: number; header: string }[];
}

function readHeader<F extends string>(sheet: SheetData, map: Map<string, F>, maxScan = 10): HeaderInfo<F> | null {
  let best: HeaderInfo<F> | null = null;
  for (let r = 0; r < Math.min(sheet.rows.length, maxScan); r++) {
    const row = sheet.rows[r] ?? [];
    const columns = new Map<F, number>();
    const unmapped: { col: number; header: string }[] = [];
    const duplicates: { col: number; header: string }[] = [];
    let recognized = 0;
    row.forEach((cell, c) => {
      const text = cellText(cell);
      if (!text) return;
      const field = map.get(norm(text));
      if (!field) {
        unmapped.push({ col: c, header: text });
      } else if (columns.has(field)) {
        duplicates.push({ col: c, header: text });
      } else {
        columns.set(field, c);
        recognized++;
      }
    });
    if (recognized > 0 && (!best || recognized > best.recognized)) {
      best = { headerRow: r, columns, unmapped, recognized, duplicates };
    }
  }
  return best;
}

function findSheet(wb: WorkbookData, names: readonly string[]): SheetData | undefined {
  return wb.sheets.find((s) => names.includes(norm(s.name)));
}
function planSheetOf(wb: WorkbookData): SheetData | undefined {
  return findSheet(wb, ["plan", "roadmap"]) ?? wb.sheets[0];
}

// ── detection ────────────────────────────────────────────────────────────────

function detect(wb: WorkbookData): number {
  const sheet = planSheetOf(wb);
  if (!sheet) return 0;
  const h = readHeader(sheet, PLAN_MAP);
  if (!h || !h.columns.has("title") || h.recognized < 2) return 0;
  const total = h.recognized + h.unmapped.length;
  const named = norm(sheet.name) === "plan" || norm(sheet.name) === "roadmap" ? 0.1 : 0;
  return Math.min(1, 0.4 + 0.5 * (h.recognized / total) + named + (h.columns.has("phase") ? 0.1 : 0));
}

// ── conversion ───────────────────────────────────────────────────────────────

const TASK_COUNT_COLUMNS: readonly { field: PlanField; kind: "challenge" | "milestone" | "touchstone" | "paper" | "quiz" | "exam" | "assignment"; label: string }[] = [
  { field: "challenges", kind: "challenge", label: "Challenge" },
  { field: "milestones", kind: "milestone", label: "Milestone" },
  { field: "touchstones", kind: "touchstone", label: "Touchstone" },
  { field: "papers", kind: "paper", label: "Paper" },
  { field: "quizzes", kind: "quiz", label: "Quiz" },
  { field: "exams", kind: "exam", label: "Exam" },
  { field: "assignments", kind: "assignment", label: "Assignment" },
];
const MAX_TASKS_PER_ITEM = 100;
const MAX_ITEMS = 500;

function taskKindOf(title: string): "challenge" | "milestone" | "touchstone" | "paper" | "quiz" | "exam" | "assignment" | "other" {
  const t = title.toLowerCase();
  if (/touchstone/.test(t)) return "touchstone";
  if (/challenge/.test(t)) return "challenge";
  if (/milestone/.test(t)) return "milestone";
  if (/paper|essay/.test(t)) return "paper";
  if (/quiz/.test(t)) return "quiz";
  if (/exam|final|midterm/.test(t)) return "exam";
  if (/assign|homework|project/.test(t)) return "assignment";
  return "other";
}

interface PendingIssue {
  code: Parameters<ExceptionCollector["add"]>[0];
  severity: Parameters<ExceptionCollector["add"]>[1];
  message: string;
  column?: string;
}

interface RowRec {
  rowNumber: number; // 1-based spreadsheet row
  cells: readonly CellValue[];
  get(field: PlanField): CellValue | undefined;
  issues: PendingIssue[];
  explicitKey: string | null;
  title: string;
  code: string | null;
  phaseTitle: string;
  objectiveText: string;
  key: string;
}

type ObjectiveRec = {
  key: string; title: string; kind: "primary" | "secondary" | "parallel" | "prerequisite";
  institution: string | null; credentialLabel: string | null; status: "active" | "completed" | "changed" | "alternative";
  note: string | null; linkedToProgramAssignment: boolean;
};

function parseObjectiveKind(s: string): ObjectiveRec["kind"] | null {
  const n = norm(s);
  if (n === "primary") return "primary";
  if (n === "secondary") return "secondary";
  if (n === "parallel" || n === "concurrent") return "parallel";
  if (n === "prerequisite" || n === "prereq") return "prerequisite";
  return null;
}
function parseObjectiveStatus(s: string): ObjectiveRec["status"] {
  const n = norm(s);
  if (n === "completed" || n === "complete") return "completed";
  if (n === "changed") return "changed";
  if (n === "alternative") return "alternative";
  return "active";
}

function aboutValues(wb: WorkbookData): Map<string, string> {
  const out = new Map<string, string>();
  const sheet = findSheet(wb, ["about"]);
  if (!sheet) return out;
  for (const row of sheet.rows) {
    const label = norm(cellText(row[0]));
    const value = cellText(row[1]);
    if (label && value && !label.startsWith("#") && !out.has(label)) out.set(label, value);
  }
  return out;
}

function convert(wb: WorkbookData, ctx: AdapterContext): ConversionResult {
  const ex = new ExceptionCollector();
  const sheet = planSheetOf(wb);
  const base = (): ConversionResult["summary"] => ({
    kind: "workbook", fileName: ctx.fileName, sheetsRead: [], rowsRead: 0, rowsConverted: 0, rowsSkipped: 0, generator: null,
  });
  const header = sheet ? readHeader(sheet, PLAN_MAP) : null;
  if (!sheet || !header) {
    ex.add("UNKNOWN_TEMPLATE", "blocking", "No roadmap sheet with recognisable column headers was found.", { sheet: sheet?.name ?? "(none)" });
    return { templateId: ROADMAP_TEMPLATE_V1_ID, content: null, exceptions: ex.list, summary: base() };
  }
  const sheetsRead: string[] = [sheet.name];
  const planName = sheet.name;

  for (const required of ["title", "phase"] as const) {
    if (!header.columns.has(required)) {
      ex.add("MISSING_REQUIRED_COLUMN", "blocking", `The ${planName} sheet has no "${required === "title" ? "Title" : "Phase"}" column (aliases: ${PLAN_ALIASES[required].join(", ")}).`, { sheet: planName, column: required === "title" ? "Title" : "Phase" });
    }
  }
  if (!header.columns.has("title") || !header.columns.has("phase")) {
    return { templateId: ROADMAP_TEMPLATE_V1_ID, content: null, exceptions: ex.list, summary: { ...base(), sheetsRead } };
  }
  for (const u of header.unmapped) {
    ex.add("UNMAPPED_COLUMN", "info", `Column "${u.header}" (${columnLetter(u.col)}) is not part of the template and was ignored.`, { sheet: planName, column: columnLetter(u.col) });
  }
  for (const d of header.duplicates) {
    ex.add("UNMAPPED_COLUMN", "info", `Column "${d.header}" (${columnLetter(d.col)}) repeats an earlier column and was ignored.`, { sheet: planName, column: columnLetter(d.col) });
  }
  if (sheet.truncatedRows) {
    ex.add("ROW_SKIPPED", "blocking", `The ${planName} sheet has more than ${MAX_ROWS} rows; rows beyond ${MAX_ROWS} were not read.`, { sheet: planName, row: MAX_ROWS + 1 });
  }

  // ── Plan rows → records ───────────────────────────────────────────────────
  const col = header.columns;

  const recs: RowRec[] = [];
  let rowsRead = 0;
  let rowsSkipped = 0;
  for (let r = header.headerRow + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] ?? [];
    const rowNumber = r + 1;
    if (cells.every((c) => isBlank(c))) continue;
    const firstText = cellText(cells[0]);
    if (firstText.startsWith("#")) continue; // comment row
    rowsRead++;
    const get = (f: PlanField): CellValue | undefined => (col.has(f) ? cells[col.get(f)!] : undefined);
    // repeated header row
    let headerLike = 0;
    for (const c of col.values()) if (norm(cellText(cells[c])) === norm(cellText(sheet.rows[header.headerRow]![c])) && !isBlank(cells[c])) headerLike++;
    if (headerLike >= 2) {
      rowsSkipped++;
      ex.add("ROW_SKIPPED", "info", `Row ${rowNumber} repeats the column headers and was skipped.`, { sheet: planName, row: rowNumber });
      continue;
    }
    const title = cellText(get("title"));
    const code = cellText(get("code"));
    if (!title && !code) {
      rowsSkipped++;
      ex.add("ROW_SKIPPED", "info", `Row ${rowNumber} has no Title or Code and was skipped.`, { sheet: planName, row: rowNumber });
      continue;
    }
    if (recs.length >= MAX_ITEMS) {
      rowsSkipped++;
      ex.add("ROW_SKIPPED", "blocking", `A roadmap holds at most ${MAX_ITEMS} items; row ${rowNumber} and later rows were not converted.`, { sheet: planName, row: rowNumber });
      continue;
    }
    const issues: PendingIssue[] = [];
    if (!title) issues.push({ code: "MISSING_TITLE", severity: "warning", message: `Row ${rowNumber} has a Code ("${code}") but no Title; the code was used as the title.`, column: "Title" });
    const rawKey = cellText(get("planKey"));
    const ek = rawKey ? explicitKey(rawKey) : "";
    recs.push({
      rowNumber, cells, get, issues,
      explicitKey: ek || null,
      title: clip(title || code, 200) ?? code,
      code: clip(code, 40),
      phaseTitle: cellText(get("phase")),
      objectiveText: cellText(get("objective")),
      key: "",
    });
  }

  // ── Objectives ────────────────────────────────────────────────────────────
  const about = aboutValues(wb);
  const objectives: ObjectiveRec[] = [];
  const objByKey = new Map<string, ObjectiveRec>();
  const objByTitle = new Map<string, ObjectiveRec>();
  const addObjective = (o: ObjectiveRec) => {
    objectives.push(o);
    if (!objByKey.has(o.key)) objByKey.set(o.key, o);
    if (!objByTitle.has(norm(o.title))) objByTitle.set(norm(o.title), o);
  };
  const objSheet = findSheet(wb, ["objectives"]);
  if (objSheet) {
    const oh = readHeader(objSheet, OBJ_MAP, 5);
    if (oh && oh.columns.has("title")) {
      sheetsRead.push(objSheet.name);
      for (let r = oh.headerRow + 1; r < objSheet.rows.length && objectives.length < 10; r++) {
        const cells = objSheet.rows[r] ?? [];
        if (cells.every((c) => isBlank(c)) || cellText(cells[0]).startsWith("#")) continue;
        const g = (f: ObjField) => (oh.columns.has(f) ? cells[oh.columns.get(f)!] : undefined);
        const title = cellText(g("title"));
        if (!title) {
          ex.add("ROW_SKIPPED", "info", `Objectives row ${r + 1} has no Title and was skipped.`, { sheet: objSheet.name, row: r + 1 });
          continue;
        }
        const keyText = cellText(g("key"));
        const key = (keyText ? explicitKey(keyText) : slug(title)) || `objective-${objectives.length + 1}`;
        const kindText = cellText(g("kind"));
        let kind = parseObjectiveKind(kindText);
        if (!kind) kind = objectives.length === 0 && !kindText ? "primary" : "secondary";
        addObjective({
          key, title: clip(title, 200)!, kind, institution: clip(cellText(g("institution")), 200),
          credentialLabel: clip(cellText(g("credential")), 120), status: parseObjectiveStatus(cellText(g("status"))),
          note: clip(cellText(g("note")), 1000), linkedToProgramAssignment: false,
        });
      }
    }
  }
  const hasObjectivesSheet = objectives.length > 0;
  const ensureObjective = (text: string, firstRow: number): ObjectiveRec => {
    const hit = objByKey.get(slug(text)) ?? objByKey.get(explicitKey(text)) ?? objByTitle.get(norm(text));
    if (hit) return hit;
    const key = slug(text) || `objective-${objectives.length + 1}`;
    const o: ObjectiveRec = {
      key, title: clip(text, 200)!, kind: objectives.length === 0 ? "primary" : "secondary", institution: null,
      credentialLabel: null, status: "active", note: null, linkedToProgramAssignment: false,
    };
    addObjective(o);
    ex.add(
      "OBJECTIVE_CREATED_FROM_ROW", "warning",
      `Objective "${o.title}" was created from the Plan sheet (row ${firstRow}) as ${o.kind}; confirm it is a real objective and its kind.`,
      { sheet: planName, row: firstRow, path: `objectives.${o.key}` }, o.key,
    );
    return o;
  };
  if (!hasObjectivesSheet) {
    const hasColumnValues = recs.some((r) => r.objectiveText);
    if (!hasColumnValues) {
      const title = about.get("primarydegree") ?? about.get("plantitle") ?? "Primary degree";
      addObjective({
        key: "primary", title: clip(title, 200)!, kind: "primary", institution: clip(about.get("institution"), 200),
        credentialLabel: null, status: "active", note: null, linkedToProgramAssignment: false,
      });
    }
  }
  // Resolve each row's objective (creating from rows in order of first appearance).
  const rowObjective = new Map<number, ObjectiveRec>();
  for (const rec of recs) {
    if (rec.objectiveText) rowObjective.set(rec.rowNumber, ensureObjective(rec.objectiveText, rec.rowNumber));
  }
  if (objectives.length === 0) {
    addObjective({ key: "primary", title: clip(about.get("primarydegree") ?? about.get("plantitle") ?? "Primary degree", 200)!, kind: "primary", institution: null, credentialLabel: null, status: "active", note: null, linkedToProgramAssignment: false });
  }
  const firstPrimary = objectives.find((o) => o.kind === "primary");
  if (firstPrimary) firstPrimary.linkedToProgramAssignment = true;
  const defaultObjective = firstPrimary ?? objectives[0]!;

  // ── Phases (first appearance) ─────────────────────────────────────────────
  const phases: { key: string; title: string; sequence: number }[] = [];
  const phaseByKey = new Map<string, string>();
  const rowPhaseKey = new Map<number, string>();
  for (const rec of recs) {
    let title = rec.phaseTitle;
    let key = slug(title);
    if (!title || !key) {
      title = "Unassigned";
      key = "unassigned";
      ex.add("PHASE_CREATED_FROM_ROW", "warning", `Row ${rec.rowNumber} has no Phase; it was placed in an "Unassigned" phase. Assign a phase before publishing.`, { sheet: planName, row: rec.rowNumber, column: "Phase" });
    }
    if (!phaseByKey.has(key)) {
      phaseByKey.set(key, title);
      phases.push({ key, title: clip(title, 200)!, sequence: phases.length + 1 });
    }
    rowPhaseKey.set(rec.rowNumber, key);
  }
  if (phases.length > 50) {
    ex.add("ROW_SKIPPED", "blocking", `A roadmap holds at most 50 phases; found ${phases.length}.`, { sheet: planName });
  }

  // ── Item keys: explicit first, then generated in row order ────────────────
  const reserved = new Set<string>();
  for (const rec of recs) if (rec.explicitKey) reserved.add(rec.explicitKey);
  const generatedUsed = new Set<string>();
  for (const rec of recs) {
    if (rec.explicitKey) {
      rec.key = rec.explicitKey;
      continue;
    }
    const obj = rowObjective.get(rec.rowNumber) ?? defaultObjective;
    const basis = slug(`${obj.key}-${rec.code || rec.title}`, 76) || "item";
    let candidate = basis;
    let n = 1;
    while (reserved.has(candidate) || generatedUsed.has(candidate)) {
      n++;
      candidate = `${basis}-${n}`;
    }
    generatedUsed.add(candidate);
    rec.key = candidate;
    if (n > 1) {
      rec.issues.push({
        code: "GENERATED_ITEM_KEY", severity: "warning", column: "Plan Key",
        message: `Row ${rec.rowNumber} has no Plan Key and its generated key "${basis}" was already taken; "${candidate}" was used. If rows are reordered later, student progress could attach to the wrong row. Add a Plan Key to fix the identity.`,
      });
    } else {
      rec.issues.push({
        code: "GENERATED_ITEM_KEY", severity: "info", column: "Plan Key",
        message: `Row ${rec.rowNumber} has no Plan Key; the key "${candidate}" was generated from the objective and ${rec.code ? "code" : "title"}. Add a Plan Key to keep identity stable if the title changes.`,
      });
    }
  }

  // Lookups for dependency / alternative resolution.
  const keySet = new Set(recs.map((r) => r.key));
  const byCode = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const rec of recs) {
    if (rec.code && !byCode.has(norm(rec.code))) byCode.set(norm(rec.code), rec.key);
    if (!byTitle.has(norm(rec.title))) byTitle.set(norm(rec.title), rec.key);
  }
  const resolveRef = (token: string): string =>
    (keySet.has(explicitKey(token)) ? explicitKey(token) : undefined) ?? byCode.get(norm(token)) ?? byTitle.get(norm(token)) ?? (explicitKey(token) || slug(token) || "unknown");

  // ── Items ─────────────────────────────────────────────────────────────────
  const items: Record<string, unknown>[] = [];
  let seqCounter = 0;
  for (const rec of recs) {
    seqCounter++;
    const g = rec.get;
    const push = (i: PendingIssue) => rec.issues.push(i);
    const obj = rowObjective.get(rec.rowNumber) ?? defaultObjective;

    const seqText = cellText(g("seq"));
    const seqNum = /^\d+$/.test(seqText) ? Math.min(Number(seqText), 10_000) : seqCounter;

    const kindText = norm(cellText(g("kind")));
    const kind = (["course", "exam", "application", "task"] as const).find((k) => k === kindText) ?? "course";

    const credits = parseCredits(g("credits"));
    if (credits.invalid) push({ code: "INVALID_CREDITS", severity: "warning", column: "Credits", message: `Row ${rec.rowNumber}: credits "${cellText(g("credits"))}" is not a valid amount (max 2 decimals); left blank.` });
    const start = parseDateCell(g("start"));
    if (start.invalid) push({ code: "INVALID_DATE", severity: "warning", column: "Start", message: `Row ${rec.rowNumber}: start date "${cellText(g("start"))}" could not be read; left blank.` });
    const end = parseDateCell(g("end"));
    if (end.invalid) push({ code: "INVALID_DATE", severity: "warning", column: "End", message: `Row ${rec.rowNumber}: end date "${cellText(g("end"))}" could not be read; left blank.` });

    // status
    const statusText = norm(cellText(g("status")));
    let planStatus: "planned" | "hold" | "alternative" | "dropped" = "planned";
    if (statusText) {
      const hit = (["planned", "hold", "alternative", "dropped"] as const).find((s) => s === statusText || (s === "hold" && statusText === "onhold") || (s === "dropped" && statusText === "drop"));
      if (hit) planStatus = hit;
      else push({ code: "UNMAPPED_COLUMN", severity: "warning", column: "Status", message: `Row ${rec.rowNumber}: status "${cellText(g("status"))}" is not Planned/Hold/Alternative/Dropped; treated as Planned.` });
    }
    const holdReason = clip(cellText(g("holdReason")), 500);

    // approval
    const approvalText = norm(cellText(g("approval")));
    let approval: { required: boolean; status: "pending" | "approved" | "not_required" } | null = null;
    if (approvalText) {
      if (approvalText === "required" || approvalText === "pending") approval = { required: true, status: "pending" };
      else if (approvalText === "approved") approval = { required: true, status: "approved" };
      else approval = { required: false, status: "not_required" };
    }

    // tasks
    const tasks: { key: string; kind: string; title: string; sequence: number }[] = [];
    const taskKeys = new Set<string>();
    const addTask = (key: string, kindName: string, title: string) => {
      if (tasks.length >= MAX_TASKS_PER_ITEM) return false;
      let k = key || "task";
      let n = 1;
      while (taskKeys.has(k)) k = `${key || "task"}-${++n}`;
      taskKeys.add(k);
      tasks.push({ key: k, kind: kindName, title: clip(title, 200) ?? k, sequence: tasks.length + 1 });
      return true;
    };
    for (const tc of TASK_COUNT_COLUMNS) {
      const v = g(tc.field);
      if (isBlank(v)) continue;
      const text = cellText(v);
      const n = Number(text);
      if (!/^\d+(\.0+)?$/.test(text) || !Number.isFinite(n) || n > MAX_TASKS_PER_ITEM) {
        push({ code: "INVALID_TASK_COUNT", severity: "warning", column: tc.label + "s", message: `Row ${rec.rowNumber}: ${tc.label} count "${text}" is not a whole number from 0 to ${MAX_TASKS_PER_ITEM}; no ${tc.label.toLowerCase()} tasks were generated.` });
        continue;
      }
      for (let i = 1; i <= n; i++) {
        if (!addTask(`${tc.kind}-${i}`, tc.kind, `${tc.label} ${i}`)) {
          push({ code: "INVALID_TASK_COUNT", severity: "warning", column: tc.label + "s", message: `Row ${rec.rowNumber}: more than ${MAX_TASKS_PER_ITEM} tasks; extra tasks were not generated.` });
          break;
        }
      }
    }
    const listed = cellText(g("tasks"));
    if (listed) {
      for (const part of listed.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean)) {
        if (!addTask(slug(part, 76) || "task", taskKindOf(part), part)) {
          push({ code: "INVALID_TASK_COUNT", severity: "warning", column: "Tasks", message: `Row ${rec.rowNumber}: more than ${MAX_TASKS_PER_ITEM} tasks; extra tasks were not added.` });
          break;
        }
      }
    }

    // condition
    const condition = clip(cellText(g("condition")), 500);
    if (condition) {
      push({ code: "CONDITIONAL_ALLOCATION", severity: "warning", column: "Condition", message: `"${rec.title}" has a condition ("${condition}"). Conditional credit allocation is not modelled; confirm the plan is right and note the condition for the student.` });
    }
    const staffNoteBase = clip(cellText(g("staffNote")), 2000);
    const staffNote = condition ? clip([staffNoteBase, `Condition: ${condition}`].filter(Boolean).join("\n"), 2000) : staffNoteBase;

    const dependsOn = [...new Set(splitList(cellText(g("dependsOn"))).map(resolveRef))].slice(0, 50);
    const altText = cellText(g("alternativeFor"));
    const alternativeOf = altText ? resolveRef(splitList(altText)[0] ?? altText) : null;

    items.push({
      key: rec.key,
      phaseKey: rowPhaseKey.get(rec.rowNumber)!,
      objectiveKey: obj.key,
      sequence: seqNum,
      kind,
      code: rec.code,
      title: rec.title,
      provider: clip(cellText(g("provider")), 120),
      institution: clip(cellText(g("institution")), 200),
      credits: credits.value,
      plannedStart: start.value,
      plannedEnd: end.value,
      dependsOn,
      planStatus,
      hold: planStatus === "hold" && holdReason ? { reason: holdReason } : null,
      approval,
      alternativeOf,
      tasks,
      studentNote: clip(cellText(g("studentNote")), 1000),
      staffNote,
    });

    for (const i of rec.issues) {
      ex.add(i.code, i.severity, i.message, { sheet: planName, row: rec.rowNumber, itemKey: rec.key, ...(i.column ? { column: i.column } : {}) });
    }
  }

  // ── Milestones ────────────────────────────────────────────────────────────
  const milestones: Record<string, unknown>[] = [];
  const msSheet = findSheet(wb, ["milestones"]);
  if (msSheet) {
    const mh = readHeader(msSheet, MS_MAP, 5);
    if (mh && mh.columns.has("title")) {
      sheetsRead.push(msSheet.name);
      const used = new Set<string>();
      for (let r = mh.headerRow + 1; r < msSheet.rows.length && milestones.length < 100; r++) {
        const cells = msSheet.rows[r] ?? [];
        if (cells.every((c) => isBlank(c)) || cellText(cells[0]).startsWith("#")) continue;
        const g = (f: MsField) => (mh.columns.has(f) ? cells[mh.columns.get(f)!] : undefined);
        const title = cellText(g("title"));
        if (!title) {
          ex.add("ROW_SKIPPED", "info", `Milestones row ${r + 1} has no Title and was skipped.`, { sheet: msSheet.name, row: r + 1 });
          continue;
        }
        const keyText = cellText(g("key"));
        let key = (keyText ? explicitKey(keyText) : slug(title)) || `milestone-${milestones.length + 1}`;
        if (!keyText) {
          const b = key;
          let n = 1;
          while (used.has(key)) key = `${b.slice(0, 76)}-${++n}`;
        }
        used.add(key);
        const kn = norm(cellText(g("kind")));
        const kind = kn === "application" ? "application" : kn === "objectivecomplete" || kn === "objective" ? "objective_complete" : kn === "graduation" ? "graduation" : "checkpoint";
        const date = parseDateCell(g("date"));
        if (date.invalid) ex.add("INVALID_DATE", "warning", `Milestones row ${r + 1}: target date "${cellText(g("date"))}" could not be read; left blank.`, { sheet: msSheet.name, row: r + 1, column: "Target Date" });
        const objText = cellText(g("objective"));
        const objHit = objText ? (objByKey.get(slug(objText)) ?? objByKey.get(explicitKey(objText)) ?? objByTitle.get(norm(objText))) : undefined;
        milestones.push({
          key, title: clip(title, 200), kind, targetDate: date.value,
          objectiveKey: objText ? (objHit?.key ?? (slug(objText) || null)) : null,
          afterItemKeys: [...new Set(splitList(cellText(g("after"))).map(resolveRef))].slice(0, 200),
        });
      }
    }
  }

  const raw = {
    contentVersion: ROADMAP_CONTENT_VERSION,
    title: clip(about.get("plantitle"), 200) ?? clip(ctx.fileName ? ctx.fileName.replace(/\.[^.]+$/, "") : null, 200) ?? "Student roadmap",
    summary: clip(about.get("summary"), 2000),
    objectives: objectives.slice(0, 10).map((o) => ({ ...o })),
    phases: phases.slice(0, 50),
    items,
    milestones,
  };
  if (about.size > 0) sheetsRead.push(findSheet(wb, ["about"])!.name);

  const finalized = finalizeContent(raw, ex.list);
  return {
    templateId: ROADMAP_TEMPLATE_V1_ID,
    content: finalized.content,
    exceptions: finalized.exceptions,
    summary: {
      kind: "workbook", fileName: ctx.fileName, sheetsRead, rowsRead, rowsConverted: items.length,
      rowsSkipped: Math.max(rowsSkipped, rowsRead - items.length), generator: null,
    },
  };
}

export const lumiereRoadmapV1Adapter: WorkbookAdapter = {
  id: ROADMAP_TEMPLATE_V1_ID,
  detect,
  convert,
};
