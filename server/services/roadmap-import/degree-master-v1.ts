/**
 * `lumiere-degree-master-v1` — Lumière's master degree-planning workbook family.
 *
 * Layouts recognised by sheet/header DISCOVERY (never by file or sheet name):
 *  - ledger sheets: one row per requirement/course with Course, Provider,
 *    Credits and Completed/Remaining or Status columns, preceded by title and
 *    note rows (General Education, Business Core, Accounting AOS, Electives,
 *    TECEP / Coopersmith / External / TESU provider views, Completed Credits);
 *  - a sequence sheet ("Execution Order"): Phase, Step, Course / action, ...;
 *  - a licensing audit sheet (Subject, Course / source, In 24-count?);
 *  - tracker sheets (Course, Challenges, Milestones / Content Ch., Papers),
 *    the provider is read from the sheet title;
 *  - optional Terms (registration windows) and Prior education sheets.
 *
 * Doctrine: completed / existing work and stated credit totals are recorded as
 * staff-only `reportedHistory` and NEVER become credit or plan items. Provider
 * views of the same course collapse into one item (no duplicates).
 */
import {
  ROADMAP_CONTENT_VERSION,
  type ConversionResult,
  type RoadmapReportedHistory,
} from "@shared/student-roadmap-contract";
import { finalizeContent } from "./finalize";
import { ExceptionCollector, type AdapterContext, type CellValue, type SheetData, type WorkbookAdapter, type WorkbookData } from "./types";
import { cellText, explicitKey, norm, parseCredits, parseDateCell, slug } from "./util";
import {
  CONDITIONAL_MAPPING,
  CONDITION_TEXT,
  baseItemKey,
  cell,
  clipText,
  headText,
  isDash,
  labelValue,
  locateHeader,
  parseCourseText,
  parseProvider,
  rowIsBlank,
  sentenceMatching,
  type Located,
  type ParsedCourse,
  type ParsedProvider,
} from "./s07-shared";

export const DEGREE_MASTER_V1_ID = "lumiere-degree-master-v1";

// ── layouts ──────────────────────────────────────────────────────────────────

const LEDGER_SPEC = {
  seq: ["Seq", "#"],
  block: ["Requirement Block", "Block"],
  requirement: ["TESU Requirement", "Requirement"],
  course: ["Course", "Course Title", "Course Name"],
  provider: ["Provider", "Source", "Platform"],
  credits: ["Credits", "Credit", "Cr"],
  level: ["Level"],
  doneRem: ["Completed / Remaining"],
  burden: ["Writing / Assignment Burden"],
  examType: ["Exam Type"],
  seqNote: ["Prerequisite / Sequence Note", "Sequence Note"],
  cpaAcc: ["CPA Accounting?"],
  cpaBus: ["CPA Business?"],
  status: ["Status"],
  notes: ["Notes", "Note"],
  start: ["Planned Start", "Start", "Start Date"],
  end: ["Planned End", "End", "End Date", "Exam Date", "Target"],
  term: ["Term", "Registration Term", "TESU Term"],
  gate: ["Registration Gate", "Gate"],
  gateEvidence: ["Gate Evidence", "Evidence"],
  planKey: ["Plan Key", "Key", "ID"],
  alternativeFor: ["Alternative For", "Alternative Of", "Fallback For"],
} as const;
type LedgerField = keyof typeof LEDGER_SPEC;

const SEQUENCE_SPEC = {
  seq: ["Seq"],
  phase: ["Phase"],
  step: ["Step"],
  action: ["Course / action", "Course / Activity", "Action"],
  provider: ["Provider"],
  credits: ["Credits"],
  why: ["Why this order"],
  status: ["Status"],
  notes: ["Notes"],
  start: ["Planned Start", "Start", "Start Date"],
  end: ["Planned End", "End", "Target Date", "Due"],
} as const;
type SequenceField = keyof typeof SEQUENCE_SPEC;

const CPA_SPEC = {
  subject: ["Subject"],
  source: ["Course / source"],
  credits: ["Credits"],
  provider: ["Provider"],
  status: ["Status"],
  block: ["Degree block"],
  counted: ["In 24-count?", "In count?"],
} as const;
type CpaField = keyof typeof CPA_SPEC;

const TRACKER_SPEC = {
  course: ["Course"],
  challenges: ["Challenges"],
  milestones: ["Milestones"],
  contentCh: ["Content Ch.", "Content Chapters"],
  papers: ["Papers", "Assignments"],
  touchstones: ["Touchstones"],
  credits: ["Credits", "Cr"],
  target: ["Finish Target", "Target"],
} as const;
type TrackerField = keyof typeof TRACKER_SPEC;

const TERMS_SPEC = {
  term: ["Term", "Term Label"],
  start: ["Term Start", "Classes Start", "Starts", "Start Date", "Start"],
  deadline: ["Registration Deadline", "Reg Deadline", "Registration Closes"],
  finalExam: ["Final Exam Date", "Final Exam", "Last Exam Date"],
} as const;
type TermsField = keyof typeof TERMS_SPEC;

const PRIOR_SPEC = {
  credential: ["Credential", "Qualification", "Prior Credential", "Prior Learning", "Prior Work"],
  kind: ["Kind", "Type"],
  institution: ["Institution", "School"],
  provider: ["Provider"],
  credits: ["Credits", "Credits Reported"],
  status: ["Status"],
  date: ["Conferred", "Conferred On", "Completed On", "Date"],
  note: ["Note", "Notes"],
} as const;
type PriorField = keyof typeof PRIOR_SPEC;

type Classified =
  | { kind: "ledger"; sheet: SheetData; loc: Located<LedgerField> }
  | { kind: "sequence"; sheet: SheetData; loc: Located<SequenceField> }
  | { kind: "cpa"; sheet: SheetData; loc: Located<CpaField> }
  | { kind: "tracker"; sheet: SheetData; loc: Located<TrackerField>; provider: string | null }
  | { kind: "terms"; sheet: SheetData; loc: Located<TermsField> }
  | { kind: "prior"; sheet: SheetData; loc: Located<PriorField> }
  | { kind: "other"; sheet: SheetData };

export function isLedgerSheet(sheet: SheetData): boolean {
  return locateHeader(sheet, LEDGER_SPEC, ["course", "provider", "credits", ["doneRem", "status"], ["requirement", "block", "doneRem"]]) !== null;
}

function trackerProvider(sheet: SheetData): string | null {
  const t = headText(sheet, 4);
  if (/study\.?\s?com/i.test(t)) return "Study.com";
  if (/sophia/i.test(t)) return "Sophia";
  if (/tecep/i.test(t)) return "TESU TECEP";
  return null;
}

function classify(sheet: SheetData): Classified {
  const ledger = locateHeader(sheet, LEDGER_SPEC, ["course", "provider", "credits", ["doneRem", "status"], ["requirement", "block", "doneRem"]]);
  if (ledger) return { kind: "ledger", sheet, loc: ledger };
  const sequence = locateHeader(sheet, SEQUENCE_SPEC, ["phase", "action", ["provider", "credits"]]);
  if (sequence) return { kind: "sequence", sheet, loc: sequence };
  const cpa = locateHeader(sheet, CPA_SPEC, ["subject", "source"]);
  if (cpa) return { kind: "cpa", sheet, loc: cpa };
  const tracker = locateHeader(sheet, TRACKER_SPEC, ["course", ["challenges", "contentCh", "papers", "touchstones"]]);
  if (tracker) return { kind: "tracker", sheet, loc: tracker, provider: trackerProvider(sheet) };
  const terms = locateHeader(sheet, TERMS_SPEC, ["term", ["deadline", "finalExam"]], 10);
  if (terms) return { kind: "terms", sheet, loc: terms };
  const prior = locateHeader(sheet, PRIOR_SPEC, ["credential", ["institution", "credits", "status"]], 10);
  if (prior) return { kind: "prior", sheet, loc: prior };
  return { kind: "other", sheet };
}

// ── detection ────────────────────────────────────────────────────────────────

function detect(wb: WorkbookData): number {
  let ledgers = 0;
  let trackers = 0;
  for (const sheet of wb.sheets) {
    const c = classify(sheet);
    if (c.kind === "ledger") ledgers++;
    else if (c.kind === "tracker") trackers++;
  }
  if (ledgers >= 1) return Math.min(1, 0.85 + 0.02 * Math.min(ledgers, 5));
  if (trackers >= 1) return 0.75;
  return 0;
}

// ── candidate rows ───────────────────────────────────────────────────────────

type PlanStatus = "planned" | "hold" | "dropped" | "alternative";
const STRICT: Record<PlanStatus, number> = { planned: 0, alternative: 1, hold: 2, dropped: 3 };

interface Src {
  readonly sheet: string;
  readonly row: number;
}

interface Cand {
  srcs: Src[];
  ids: Set<string>;
  parsed: ParsedCourse;
  provider: ParsedProvider;
  explicitKey: string | null;
  credits: string | null;
  creditsRaw: string;
  level: string;
  block: string | null;
  requirement: string | null;
  phaseTitle: string | null;
  /** Sheet-order index within sequence rows, else null. */
  seqOrder: number | null;
  ledgerOrder: number;
  completed: boolean;
  watch: boolean;
  status: PlanStatus;
  statusUnmapped: string | null;
  notes: string[];
  seqNote: string;
  burden: string;
  examType: string;
  cpa: boolean;
  licensingOnly: boolean;
  start: string | null;
  end: string | null;
  datesInvalid: string[];
  term: string | null;
  gateText: string | null;
  gateDocumented: boolean;
  alternativeFor: string | null;
  tasksFromCounts: { kind: "challenge" | "milestone" | "touchstone" | "assignment" | "quiz" | "exam"; n: number }[];
  /** Sequence-only row with no credit: a milestone, not a course. */
  fromSequenceOnly: boolean;
  trackerProvider: string | null;
}

const yes = (v: CellValue | undefined): boolean => /^(y|yes|true|1)$/i.test(cellText(v));

function statusOf(text: string, doneRem: string): { completed: boolean; watch: boolean; status: PlanStatus; unmapped: string | null } {
  const s = norm(text);
  const dr = norm(doneRem);
  const completedByCol = dr === "completed" || dr === "complete";
  if (s === "done" || s === "complete" || s === "completed") return { completed: true, watch: false, status: "planned", unmapped: null };
  if (s === "watch") return { completed: true, watch: true, status: "planned", unmapped: null };
  if (s === "hold" || s === "onhold") return { completed: false, watch: false, status: "hold", unmapped: null };
  if (s === "donottake" || s === "dropped" || s === "drop" || s === "removed") return { completed: false, watch: false, status: "dropped", unmapped: null };
  if (s === "alternative" || s === "fallback" || s === "backup") return { completed: false, watch: false, status: "alternative", unmapped: null };
  if (s === "" || s === "totake" || s === "planned" || s === "remaining" || s === "todo" || s === "notstarted") {
    return { completed: completedByCol, watch: false, status: "planned", unmapped: null };
  }
  return { completed: completedByCol, watch: false, status: "planned", unmapped: text };
}

const TASK_WORDS = "assignments?|papers?|touchstones?|milestones?|challenges?|quizzes|quiz|exams?";
function countsFromText(text: string): Cand["tasksFromCounts"] {
  const out: Cand["tasksFromCounts"] = [];
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,3})\\s+(?:required\\s+)?(${TASK_WORDS})\\b`, "gi"))) {
    const word = m[2]!.toLowerCase();
    const kind = word.startsWith("touchstone")
      ? "touchstone"
      : word.startsWith("milestone")
        ? "milestone"
        : word.startsWith("challenge")
          ? "challenge"
          : word.startsWith("quiz")
            ? "quiz"
            : word.startsWith("exam")
              ? "exam"
              : "assignment";
    out.push({ kind, n: Number(m[1]) });
  }
  return out;
}

function newCand(args: {
  src: Src;
  courseText: string;
  codeColumn?: string | null;
  providerText: string;
  ledgerOrder: number;
}): Cand {
  const parsed = parseCourseText(args.courseText, args.codeColumn);
  const qualifierNote = parsed.qualifier ? [parsed.qualifier.slice(0, 500)] : [];
  return {
    srcs: [args.src],
    ids: new Set(parsed.ids),
    parsed,
    provider: parseProvider(args.providerText),
    explicitKey: null,
    credits: null,
    creditsRaw: "",
    level: "",
    block: null,
    requirement: null,
    phaseTitle: null,
    seqOrder: null,
    ledgerOrder: args.ledgerOrder,
    completed: false,
    watch: false,
    status: parsed.qualifier && /^(HOLD|DO NOT BUY)/.test(parsed.qualifier) ? "hold" : "planned",
    statusUnmapped: null,
    notes: qualifierNote,
    seqNote: "",
    burden: "",
    examType: "",
    cpa: false,
    licensingOnly: false,
    start: null,
    end: null,
    datesInvalid: [],
    term: null,
    gateText: null,
    gateDocumented: false,
    alternativeFor: null,
    tasksFromCounts: [],
    fromSequenceOnly: false,
    trackerProvider: null,
  };
}

// ── conversion ───────────────────────────────────────────────────────────────

const MAX_ITEMS = 500;
const MAX_TASKS = 100;
const BASELINE_CLAIM = /(\d{1,3})\s+(?:credits?\s+)?(?:already\s+)?(?:earned|completed)\b/i;

function convert(wb: WorkbookData, ctx: AdapterContext): ConversionResult {
  const ex = new ExceptionCollector();
  const classified = wb.sheets.map(classify);
  const sheetsRead: string[] = [];
  let rowsRead = 0;
  const file = ctx.fileName ? ctx.fileName.slice(0, 200) : null;
  const prov = (s: Src) => ({ file, sheet: s.sheet.slice(0, 120), row: s.row, role: "master" as const });

  const cands: Cand[] = [];
  const byId = new Map<string, Cand>();
  const register = (cand: Cand): void => {
    for (const id of cand.ids) if (!byId.has(id)) byId.set(id, cand);
  };
  const findExisting = (ids: Iterable<string>): Cand | undefined => {
    for (const id of ids) {
      const hit = byId.get(id);
      if (hit) return hit;
    }
    return undefined;
  };
  let ledgerCounter = 0;

  const mergeInto = (target: Cand, incoming: Cand): void => {
    target.srcs.push(...incoming.srcs);
    for (const id of incoming.ids) target.ids.add(id);
    register(target);
    if (STRICT[incoming.status] > STRICT[target.status]) target.status = incoming.status;
    target.completed = target.completed && incoming.completed;
    target.watch = target.watch || incoming.watch;
    target.cpa = target.cpa || incoming.cpa;
    target.licensingOnly = target.licensingOnly && incoming.licensingOnly;
    target.fromSequenceOnly = target.fromSequenceOnly && incoming.fromSequenceOnly;
    target.explicitKey ??= incoming.explicitKey;
    if (!target.credits && incoming.credits) {
      target.credits = incoming.credits;
      target.creditsRaw = incoming.creditsRaw;
    }
    target.level ||= incoming.level;
    target.block ??= incoming.block;
    target.requirement ??= incoming.requirement;
    target.phaseTitle ??= incoming.phaseTitle;
    target.seqOrder ??= incoming.seqOrder;
    for (const n of incoming.notes) if (!target.notes.includes(n)) target.notes.push(n);
    target.seqNote ||= incoming.seqNote;
    target.burden ||= incoming.burden;
    target.examType ||= incoming.examType;
    target.start ??= incoming.start;
    target.end ??= incoming.end;
    target.datesInvalid.push(...incoming.datesInvalid);
    target.term ??= incoming.term;
    target.gateText ??= incoming.gateText;
    target.gateDocumented = target.gateDocumented || incoming.gateDocumented;
    target.alternativeFor ??= incoming.alternativeFor;
    target.statusUnmapped ??= incoming.statusUnmapped;
    if (target.tasksFromCounts.length === 0) target.tasksFromCounts = incoming.tasksFromCounts;
    target.trackerProvider ??= incoming.trackerProvider;
    if (!target.provider.provider && incoming.provider.provider) target.provider = incoming.provider;
    else if (incoming.provider.hold && !target.provider.hold) target.provider = { ...target.provider, hold: true };
  };
  const addCand = (cand: Cand): void => {
    if (cands.length >= MAX_ITEMS + 300) return;
    const existing = findExisting(cand.ids);
    if (existing) mergeInto(existing, cand);
    else {
      cands.push(cand);
      register(cand);
    }
  };

  // Terms (registration windows)
  const terms = new Map<string, { termLabel: string; termStart: string | null; registrationDeadline: string | null; finalExamDate: string | null }>();
  for (const c of classified) {
    if (c.kind !== "terms") continue;
    sheetsRead.push(c.sheet.name);
    for (let r = c.loc.headerRow + 1; r < c.sheet.rows.length; r++) {
      const cells = c.sheet.rows[r] ?? [];
      const label = cellText(cell(c.loc, cells, "term"));
      if (!label || rowIsBlank(cells)) continue;
      rowsRead++;
      const d = (f: TermsField, header: string) => {
        const p = parseDateCell(cell(c.loc, cells, f));
        if (p.invalid) ex.add("INVALID_DATE", "warning", `${c.sheet.name} row ${r + 1}: ${header} "${cellText(cell(c.loc, cells, f))}" could not be read; left blank.`, { sheet: c.sheet.name, row: r + 1, column: header });
        return p.value;
      };
      terms.set(norm(label), {
        termLabel: label.slice(0, 80),
        termStart: d("start", "Term Start"),
        registrationDeadline: d("deadline", "Registration Deadline"),
        finalExamDate: d("finalExam", "Final Exam Date"),
      });
    }
  }

  // Ledger sheets first, then sequence sheets, trackers, others.
  for (const c of classified) {
    if (c.kind !== "ledger") continue;
    sheetsRead.push(c.sheet.name);
    const sheet = c.sheet;
    for (let r = c.loc.headerRow + 1; r < sheet.rows.length; r++) {
      const cells = sheet.rows[r] ?? [];
      if (rowIsBlank(cells)) continue;
      const g = (f: LedgerField) => cell(c.loc, cells, f);
      const courseText = cellText(g("course"));
      if (!courseText) continue; // totals, notes, footers
      rowsRead++;
      const src: Src = { sheet: sheet.name, row: r + 1 };
      const cand = newCand({ src, courseText, providerText: cellText(g("provider")), ledgerOrder: ledgerCounter++ });
      const st = statusOf(cellText(g("status")), cellText(g("doneRem")));
      cand.completed = st.completed;
      cand.watch = st.watch;
      cand.status = st.status;
      cand.statusUnmapped = st.unmapped;
      if (cand.provider.dropped && cand.status === "planned") cand.status = "dropped";
      if (cand.provider.hold && cand.status === "planned") cand.status = "hold";
      const credits = parseCredits(g("credits"));
      cand.credits = credits.value;
      cand.creditsRaw = cellText(g("credits"));
      if (credits.invalid) ex.add("INVALID_CREDITS", "warning", `${sheet.name} row ${r + 1}: credits "${cand.creditsRaw}" is not a valid amount; left blank.`, { sheet: sheet.name, row: r + 1, column: "Credits" });
      cand.level = cellText(g("level"));
      cand.block = clipText(cellText(g("block")), 120);
      cand.requirement = clipText(cellText(g("requirement")), 200);
      const note = clipText(cellText(g("notes")), 500);
      if (note) cand.notes.push(note);
      cand.seqNote = cellText(g("seqNote"));
      cand.burden = cellText(g("burden"));
      cand.examType = cellText(g("examType"));
      cand.cpa = yes(g("cpaAcc")) || yes(g("cpaBus"));
      cand.licensingOnly = !!cand.block && /cpa|licens/i.test(cand.block);
      for (const [f, label] of [["start", "Planned Start"], ["end", "Planned End"]] as const) {
        const p = parseDateCell(g(f));
        if (p.invalid) {
          cand.datesInvalid.push(label);
          ex.add("INVALID_DATE", "warning", `${sheet.name} row ${r + 1}: ${label} "${cellText(g(f))}" could not be read; left blank.`, { sheet: sheet.name, row: r + 1, column: label });
        } else if (f === "start") cand.start = p.value;
        else cand.end = p.value;
      }
      cand.term = clipText(cellText(g("term")), 80);
      cand.gateText = clipText(cellText(g("gate")), 500);
      cand.gateDocumented = /^documented$/i.test(cellText(g("gateEvidence")));
      const ek = cellText(g("planKey"));
      cand.explicitKey = ek ? explicitKey(ek) || null : null;
      cand.alternativeFor = clipText(cellText(g("alternativeFor")), 200);
      cand.tasksFromCounts = countsFromText(cand.burden);
      addCand(cand);
    }
  }

  // Sequence sheets (execution order)
  const phaseFirstSeen: string[] = [];
  let seqCounter = 0;
  for (const c of classified) {
    if (c.kind !== "sequence") continue;
    sheetsRead.push(c.sheet.name);
    for (let r = c.loc.headerRow + 1; r < c.sheet.rows.length; r++) {
      const cells = c.sheet.rows[r] ?? [];
      if (rowIsBlank(cells)) continue;
      const g = (f: SequenceField) => cell(c.loc, cells, f);
      const action = cellText(g("action"));
      const phase = cellText(g("phase"));
      if (!action || !phase) continue; // totals / footers
      rowsRead++;
      const src: Src = { sheet: c.sheet.name, row: r + 1 };
      const cand = newCand({ src, courseText: action, providerText: cellText(g("provider")), ledgerOrder: 100_000 + seqCounter });
      cand.phaseTitle = clipText(phase, 200);
      if (cand.phaseTitle && !phaseFirstSeen.includes(cand.phaseTitle)) phaseFirstSeen.push(cand.phaseTitle);
      cand.seqOrder = seqCounter++;
      const st = statusOf(cellText(g("status")), "");
      cand.completed = st.completed;
      cand.status = st.status;
      if (cand.provider.dropped && cand.status === "planned") cand.status = "dropped";
      if (cand.provider.hold && cand.status === "planned") cand.status = "hold";
      const credits = parseCredits(g("credits"));
      cand.credits = credits.value;
      cand.seqNote = cellText(g("why"));
      const note = clipText(cellText(g("notes")), 500);
      if (note) cand.notes.push(note);
      for (const [f, label] of [["start", "Planned Start"], ["end", "Planned End"]] as const) {
        const p = parseDateCell(g(f));
        if (!p.invalid) {
          if (f === "start") cand.start = p.value;
          else cand.end = p.value;
        }
      }
      cand.fromSequenceOnly = true;
      addCand(cand);
    }
  }

  // Trackers (course + counters; the Done / score columns are student progress and are ignored)
  for (const c of classified) {
    if (c.kind !== "tracker") continue;
    sheetsRead.push(c.sheet.name);
    for (let r = c.loc.headerRow + 1; r < c.sheet.rows.length; r++) {
      const cells = c.sheet.rows[r] ?? [];
      if (rowIsBlank(cells)) continue;
      const g = (f: TrackerField) => cell(c.loc, cells, f);
      const courseText = cellText(g("course"));
      if (!courseText || /total|^course$/i.test(courseText)) continue;
      rowsRead++;
      const src: Src = { sheet: c.sheet.name, row: r + 1 };
      const cand = newCand({ src, courseText, providerText: c.provider ?? "", ledgerOrder: ledgerCounter++ });
      cand.trackerProvider = c.provider;
      cand.block = c.provider ? `${c.provider} courses` : null;
      const credits = parseCredits(g("credits"));
      cand.credits = credits.value;
      const counts: Cand["tasksFromCounts"] = [];
      for (const [f, kind] of [["challenges", "challenge"], ["milestones", "milestone"], ["touchstones", "touchstone"], ["papers", "assignment"]] as const) {
        const raw = cellText(g(f));
        if (/^\d{1,3}$/.test(raw) && Number(raw) > 0) counts.push({ kind, n: Number(raw) });
      }
      cand.tasksFromCounts = counts;
      const target = parseDateCell(g("target"));
      if (!target.invalid) cand.end = target.value;
      addCand(cand);
    }
  }

  // Licensing audit: flag matching degree items; unmatched rows stay out of the plan.
  let cpaMatched = 0;
  let cpaUnmatched = 0;
  let hasCpaSheet = false;
  for (const c of classified) {
    if (c.kind !== "cpa") continue;
    hasCpaSheet = true;
    sheetsRead.push(c.sheet.name);
    for (let r = c.loc.headerRow + 1; r < c.sheet.rows.length; r++) {
      const cells = c.sheet.rows[r] ?? [];
      const source = cellText(cell(c.loc, cells, "source"));
      if (!source) continue;
      rowsRead++;
      if (!/^(y|yes)$/i.test(cellText(cell(c.loc, cells, "counted")))) continue;
      const hit = findExisting(parseCourseText(source).ids);
      if (hit) {
        hit.cpa = true;
        hit.srcs.push({ sheet: c.sheet.name, row: r + 1 });
        cpaMatched++;
      } else cpaUnmatched++;
    }
  }
  if (hasCpaSheet) {
    ex.add(
      "SHEET_NOT_RECOGNISED",
      "info",
      `Licensing audit sheet read as planning context only: ${cpaMatched} course(s) flagged as also relevant to licensing, ${cpaUnmatched} row(s) without a plan item were not added. Licensing qualification is decided by the licensing board, never by degree credit.`,
      { path: "licensing-audit" },
      "cpa",
    );
  }

  // Prior education sheet(s) and the stated credit baseline → reportedHistory
  const history: RoadmapReportedHistory[] = [];
  const historyKeys = new Set<string>();
  const addHistory = (h: Omit<RoadmapReportedHistory, "key" | "provenance"> & { keyBasis: string; provenance: Src[] }): RoadmapReportedHistory | null => {
    if (history.length >= 300) return null;
    const base = slug(h.keyBasis, 76) || "history";
    let key = base;
    let n = 1;
    while (historyKeys.has(key)) key = `${base}-${++n}`;
    historyKeys.add(key);
    const { keyBasis: _k, provenance, ...rest } = h;
    const entry: RoadmapReportedHistory = { ...rest, key, provenance: provenance.slice(0, 10).map(prov) };
    history.push(entry);
    return entry;
  };
  const historyDedupe = new Set<string>();
  for (const c of classified) {
    if (c.kind !== "prior") continue;
    sheetsRead.push(c.sheet.name);
    for (let r = c.loc.headerRow + 1; r < c.sheet.rows.length; r++) {
      const cells = c.sheet.rows[r] ?? [];
      if (rowIsBlank(cells)) continue;
      const g = (f: PriorField) => cell(c.loc, cells, f);
      const title = cellText(g("credential"));
      if (!title) continue;
      rowsRead++;
      const kindText = norm(cellText(g("kind")));
      const kind: RoadmapReportedHistory["kind"] =
        kindText === "credential" || kindText === "exam" || kindText === "course" || kindText === "transfer"
          ? kindText
          : kindText.includes("baseline")
            ? "credit_baseline"
            : /degree|diploma|certificate|associate|bachelor|master|licen[cs]e/i.test(title)
              ? "credential"
              : "transfer";
      const st = norm(cellText(g("status")));
      const reportedStatus: RoadmapReportedHistory["reportedStatus"] =
        st === "conferred" ? "conferred" : st === "completed" || st === "complete" || st === "done" ? "completed" : st === "inprogress" ? "in_progress" : "reported";
      const credits = parseCredits(g("credits"));
      if (credits.invalid) ex.add("INVALID_CREDITS", "warning", `${c.sheet.name} row ${r + 1}: credits "${cellText(g("credits"))}" is not a valid amount; left blank.`, { sheet: c.sheet.name, row: r + 1, column: "Credits" });
      const completedOn = parseDateCell(g("date"));
      const entry = addHistory({
        keyBasis: title,
        kind,
        title: title.slice(0, 200),
        institution: clipText(cellText(g("institution")), 200),
        provider: clipText(cellText(g("provider")), 120),
        reportedCredits: credits.value,
        reportedStatus,
        completedOn: completedOn.invalid ? null : completedOn.value,
        note: clipText(cellText(g("note")), 1000),
        provenance: [{ sheet: c.sheet.name, row: r + 1 }],
      });
      historyDedupe.add(norm(title));
      if (entry && (kind === "credential" || kind === "credit_baseline" || kind === "transfer") && credits.value) {
        ex.add(
          "REPORTED_HISTORY_NOT_CREDIT",
          "warning",
          `The workbook reports "${entry.title}"${credits.value ? ` (${credits.value} credits)` : ""}. It is recorded as staff-only reported history and is NOT credit: the canonical student record, once verified, is the only credit authority.`,
          { sheet: c.sheet.name, row: r + 1, path: `reportedHistory.${entry.key}` },
          entry.key,
        );
      }
    }
  }

  // Stated baseline ("51 credits already earned")
  for (const sheet of wb.sheets) {
    const m = BASELINE_CLAIM.exec(headText(sheet, 6));
    if (!m) continue;
    const entry = addHistory({
      keyBasis: "credit-baseline-reported",
      kind: "credit_baseline",
      title: "Credits reported as already earned",
      institution: null,
      provider: null,
      reportedCredits: String(Number(m[1])),
      reportedStatus: "reported",
      completedOn: null,
      note: `Stated in the workbook (sheet "${sheet.name}"). Not verified.`,
      provenance: [{ sheet: sheet.name, row: 1 }],
    });
    if (entry) {
      ex.add(
        "REPORTED_HISTORY_NOT_CREDIT",
        "warning",
        `The workbook states ${m[1]} credits already earned. This is recorded as reported history only; it does not add credit. Verify it against the student's canonical record.`,
        { sheet: sheet.name, row: 1, path: `reportedHistory.${entry.key}` },
        entry.key,
      );
    }
    break;
  }

  // Objectives
  const degreeTitle = clipText(labelValue(wb.sheets, "Primary degree"), 200) ?? clipText(ctx.fileName ? ctx.fileName.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ") : null, 200) ?? "Primary degree";
  const institutionGuess = /^([A-Z]{2,8})\b/.exec(degreeTitle)?.[1] ?? null;
  const primaryKey = slug(degreeTitle, 60) || "primary";
  const jurisdiction = clipText(labelValue(wb.sheets, "CPA jurisdiction"), 80);
  const wantsLicensing = hasCpaSheet || !!jurisdiction || cands.some((cd) => cd.cpa || cd.licensingOnly);
  const licensingKey = "licensing-planning";
  const objectives: Record<string, unknown>[] = [
    { key: primaryKey, title: degreeTitle, kind: "primary", institution: institutionGuess, credentialLabel: null, linkedToProgramAssignment: true, status: "active", note: null },
  ];
  if (wantsLicensing) {
    objectives.push({
      key: licensingKey,
      title: `${jurisdiction ? `${jurisdiction} ` : ""}CPA licensing planning`.slice(0, 200),
      kind: "secondary",
      institution: null,
      credentialLabel: null,
      linkedToProgramAssignment: false,
      status: "active",
      note: "Planning only. Whether coursework qualifies for licensure is decided by the licensing board; it is never counted as degree credit.",
    });
    ex.add("OBJECTIVE_CREATED_FROM_ROW", "info", `A separate secondary objective "${objectives[1]!.title as string}" was created for licensing planning; it carries no degree credit.`, { path: `objectives.${licensingKey}` }, licensingKey);
  }

  // Milestones from sequence-only rows with no credit; items from the rest
  const milestones: Record<string, unknown>[] = [];
  const milestoneKeys = new Set<string>();
  const items: Cand[] = [];
  for (const cd of cands) {
    if (cd.completed) continue;
    const credits = cd.credits ? Number(cd.credits) : 0;
    if (cd.fromSequenceOnly && credits === 0) {
      const title = cd.parsed.title;
      let key = slug(title, 76) || `milestone-${milestones.length + 1}`;
      let n = 1;
      while (milestoneKeys.has(key)) key = `${slug(title, 70)}-${++n}`;
      milestoneKeys.add(key);
      const licensing = /cpa|licens|board/i.test(`${title} ${cd.provider.provider ?? ""}`);
      const kind = /conferr/i.test(title) ? "graduation" : /apply|application|filing/i.test(title) ? "application" : /graduat/i.test(title) ? "graduation" : "checkpoint";
      milestones.push({
        key,
        title: title.slice(0, 200),
        kind,
        targetDate: cd.end ?? cd.start,
        objectiveKey: licensing && wantsLicensing ? licensingKey : primaryKey,
        afterItemKeys: [],
      });
      continue;
    }
    items.push(cd);
  }

  // History from completed candidates
  let completedCourses = 0;
  for (const cd of cands) {
    if (!cd.completed) continue;
    if (historyDedupe.has(norm(cd.parsed.title) + norm(cd.provider.provider ?? ""))) continue;
    historyDedupe.add(norm(cd.parsed.title) + norm(cd.provider.provider ?? ""));
    const family = cd.provider.family;
    const kind: RoadmapReportedHistory["kind"] = family === "tecep" ? "exam" : family === "collegiate" ? "transfer" : "course";
    const note = cd.watch ? clipText(["Completed but awaiting institutional coding.", ...cd.notes].join(" "), 1000) : clipText(cd.notes.join(" "), 1000);
    const entry = addHistory({
      keyBasis: `${cd.parsed.title}-${cd.provider.provider ?? ""}`,
      kind,
      title: [cd.parsed.code, cd.parsed.title].filter(Boolean).join(" ").slice(0, 200),
      institution: family === "collegiate" ? cd.provider.provider : null,
      provider: cd.provider.provider,
      reportedCredits: cd.credits,
      reportedStatus: cd.watch ? "reported" : "completed",
      completedOn: null,
      note,
      provenance: cd.srcs,
    });
    if (entry) completedCourses++;
  }
  if (completedCourses > 0) {
    ex.add(
      "REPORTED_HISTORY_NOT_CREDIT",
      "info",
      `${completedCourses} completed course/exam row(s) were recorded as staff-only reported history, not as plan items and not as credit. The canonical student record remains the only credit authority.`,
      { path: "reportedHistory" },
      "completed-courses",
    );
  }

  // Phases
  const phaseTitleOf = (cd: Cand): string => cd.phaseTitle ?? cd.block ?? "Plan";
  const usedPhaseTitles = new Set(items.map(phaseTitleOf));
  const phaseOrder: string[] = phaseFirstSeen.filter((t) => usedPhaseTitles.has(t));
  for (const cd of [...items].sort((a, b) => a.ledgerOrder - b.ledgerOrder)) {
    const t = phaseTitleOf(cd);
    if (!phaseOrder.includes(t)) phaseOrder.push(t);
  }
  if (phaseOrder.length === 0) phaseOrder.push("Plan");
  const phases = phaseOrder.slice(0, 50).map((title, i) => ({ key: slug(title, 80) || `phase-${i + 1}`, title: title.slice(0, 200), sequence: i + 1 }));
  const phaseKeyOf = (cd: Cand): string => {
    const t = phaseTitleOf(cd);
    const i = phaseOrder.indexOf(t);
    return (phases[Math.min(i < 0 ? 0 : i, phases.length - 1)] ?? phases[0]!).key;
  };

  // Item keys
  items.sort((a, b) => phaseOrder.indexOf(phaseTitleOf(a)) - phaseOrder.indexOf(phaseTitleOf(b)) || (a.seqOrder ?? 1e6 + a.ledgerOrder) - (b.seqOrder ?? 1e6 + b.ledgerOrder));
  const usedKeys = new Set<string>(items.map((i) => i.explicitKey).filter((k): k is string => !!k));
  const keyOf = new Map<Cand, string>();
  for (const cd of items) {
    if (cd.explicitKey) {
      keyOf.set(cd, cd.explicitKey);
      continue;
    }
    const base = baseItemKey(cd.parsed.code, cd.parsed.title);
    let key = base;
    if (usedKeys.has(key) && cd.provider.provider) key = slug(`${base}-${cd.provider.provider}`, 80);
    let n = 1;
    const collided = usedKeys.has(key);
    while (usedKeys.has(key)) key = `${slug(base, 74)}-${++n}`;
    usedKeys.add(key);
    keyOf.set(cd, key);
    if (collided) {
      ex.add("GENERATED_ITEM_KEY", "warning", `Two different courses derive the key "${base}"; "${key}" was used for "${cd.parsed.title}". Keys stay stable only while the order of the workbook rows is unchanged; add a Plan Key column to fix identities.`, { sheet: cd.srcs[0]!.sheet, row: cd.srcs[0]!.row, itemKey: key });
    }
  }

  // Resolve a free-text reference to an item key
  const idToKey = new Map<string, string>();
  for (const cd of items) for (const id of cd.ids) if (!idToKey.has(id)) idToKey.set(id, keyOf.get(cd)!);
  for (const cd of items) {
    const reqCode = cd.requirement ? /^([A-Z]{2,4}[- ]\d{3,4})\b/.exec(cd.requirement)?.[1] : undefined;
    if (reqCode && !idToKey.has(norm(reqCode))) idToKey.set(norm(reqCode), keyOf.get(cd)!);
  }
  const resolveRef = (text: string): string | null => {
    const cleaned = text.replace(/\b(preferred|first|is posted|are posted|if available|before purchase|before taking)\b.*$/i, "").trim();
    const parsed = parseCourseText(cleaned);
    for (const id of parsed.ids) {
      const hit = idToKey.get(id);
      if (hit) return hit;
    }
    const n = norm(cleaned);
    if (n.length >= 5) {
      const matches = new Set<string>();
      for (const [id, key] of idToKey) if (id.length >= 5 && (id === n || id.includes(n) && id.length <= n.length + 14)) matches.add(key);
      if (matches.size === 1) return [...matches][0]!;
    }
    return null;
  };
  const reaches = (from: string, to: string, deps: Map<string, string[]>, seen = new Set<string>()): boolean => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (deps.get(from) ?? []).some((d) => reaches(d, to, deps, seen));
  };

  // Items
  const depMap = new Map<string, string[]>();
  const rawItems: Record<string, unknown>[] = [];
  let sequence = 0;
  for (const cd of items) {
    if (rawItems.length >= MAX_ITEMS) {
      ex.add("ROW_SKIPPED", "blocking", `A roadmap holds at most ${MAX_ITEMS} items; later rows were not converted.`, { sheet: cd.srcs[0]!.sheet, row: cd.srcs[0]!.row });
      break;
    }
    sequence++;
    const key = keyOf.get(cd)!;
    const first = cd.srcs[0]!;
    const refBase = { sheet: first.sheet, row: first.row, itemKey: key };
    const allNotes = [...cd.notes, cd.seqNote].filter((s) => s && !isDash(s));
    const noteText = allNotes.join(" ");
    const family = cd.provider.family;
    const isCapstone = /capstone/i.test(`${cd.parsed.title} ${cd.requirement ?? ""} ${cd.parsed.code ?? ""}`);

    let planStatus: PlanStatus = cd.status;
    if (cd.statusUnmapped) ex.add("UNMAPPED_COLUMN", "warning", `${first.sheet} row ${first.row}: status "${cd.statusUnmapped}" is not a known status; treated as Planned.`, { ...refBase, column: "Status" }, "status");

    // alternatives
    let alternativeOf: string | null = null;
    const altText = cd.alternativeFor ?? /(?:alternative|fallback)\s+(?:for|to|of)\s+(.+?)(?:\s+if\b|[;.]|$)/i.exec(noteText)?.[1] ?? null;
    if (planStatus === "alternative" || altText) {
      const target = altText ? resolveRef(altText) : null;
      if (target && target !== key) {
        alternativeOf = target;
        planStatus = "alternative";
      } else if (planStatus === "alternative") planStatus = "planned";
    }

    // condition / equivalency / approval
    const condition = CONDITION_TEXT.test(noteText) || planStatus === "hold" ? clipText(sentenceMatching(noteText, CONDITION_TEXT) || noteText, 500) : null;
    const conditionalMap = family !== "tecep" && family !== "tesu" && CONDITIONAL_MAPPING.test(`${noteText} ${cd.burden}`);
    const equivalency = conditionalMap
      ? {
          status: "conditional" as const,
          mapsTo: cd.requirement && cd.requirement !== cd.parsed.code ? cd.requirement.slice(0, 200) : null,
          note: clipText(sentenceMatching(noteText, CONDITIONAL_MAPPING), 500),
        }
      : null;
    const needsApproval = /preapprov/i.test(noteText) && family !== "tecep";
    const approval = needsApproval ? { required: true, status: "pending" as const, note: clipText(sentenceMatching(noteText, /preapprov/i), 500) } : null;
    if (planStatus === "hold" || (cd.provider.hold && planStatus !== "dropped")) planStatus = planStatus === "alternative" ? "alternative" : "hold";
    if (condition || equivalency) {
      ex.add(
        "CONDITIONAL_ALLOCATION",
        "warning",
        `"${cd.parsed.title}" is conditional in the workbook${equivalency ? " (the transfer mapping is not confirmed)" : ""}: ${(condition ?? equivalency?.note ?? "see source note").replace(/[.;\s]+$/, "")}. Confirm the plan and what the student is told.`,
        refBase,
        "condition",
      );
    }

    // tasks
    const tasks: { key: string; kind: string; title: string; sequence: number }[] = [];
    const taskKeys = new Set<string>();
    const addTask = (k: string, kind: string, title: string): boolean => {
      if (tasks.length >= MAX_TASKS || taskKeys.has(k)) return tasks.length < MAX_TASKS;
      taskKeys.add(k);
      tasks.push({ key: k, kind, title, sequence: tasks.length + 1 });
      return true;
    };
    const LABEL: Record<string, string> = { challenge: "Challenge", milestone: "Milestone", touchstone: "Touchstone", assignment: "Assignment", quiz: "Quiz", exam: "Exam" };
    for (const t of cd.tasksFromCounts) {
      for (let i = 1; i <= Math.min(t.n, MAX_TASKS); i++) if (!addTask(`${t.kind}-${i}`, t.kind, `${LABEL[t.kind]} ${i}`)) break;
    }
    const exam = cd.examType && !isDash(cd.examType) ? cd.examType : "";
    if (exam) {
      if (/tecep/i.test(exam)) addTask("final-exam", "exam", "TECEP exam");
      else if (/final/i.test(exam)) addTask("final-exam", "exam", "Final exam");
      else if (/assessment/i.test(exam)) addTask("final-exam", "exam", "Provider assessment");
    }

    // dependencies
    const deps: string[] = [];
    for (const m of noteText.matchAll(/\bafter\s+([^;.,]+)/gi)) {
      const target = resolveRef(m[1]!);
      if (target && target !== key && !deps.includes(target) && !reaches(target, key, depMap)) deps.push(target);
    }
    depMap.set(key, deps);

    // registration (term) and gate
    const term = cd.term ? terms.get(norm(cd.term)) ?? { termLabel: cd.term, termStart: null, registrationDeadline: null, finalExamDate: null } : null;
    const gate = isCapstone
      ? {
          requirement: clipText(cd.gateText ?? (cd.seqNote && !isDash(cd.seqNote) ? cd.seqNote : "Capstone registration prerequisites (credits applied, advisor confirmation)"), 500)!,
          evidence: cd.gateDocumented ? ("documented" as const) : ("not_documented" as const),
        }
      : cd.gateText
        ? { requirement: cd.gateText, evidence: cd.gateDocumented ? ("documented" as const) : ("not_documented" as const) }
        : null;

    const creditUse = cd.licensingOnly ? ("licensing" as const) : cd.cpa ? ("degree_and_licensing" as const) : null;
    const holdReason = planStatus === "hold" ? clipText(noteText || `Held in the source plan${cd.provider.hold ? " (provider marked HOLD / do not buy)" : ""}.`, 500) : null;

    rawItems.push({
      key,
      phaseKey: phaseKeyOf(cd),
      objectiveKey: cd.licensingOnly && wantsLicensing ? licensingKey : primaryKey,
      sequence,
      kind: family === "tecep" ? "exam" : "course",
      code: cd.parsed.code,
      title: cd.parsed.title,
      provider: cd.provider.provider,
      institution: institutionGuess,
      credits: cd.credits,
      plannedStart: cd.start,
      plannedEnd: cd.end,
      dependsOn: deps,
      planStatus,
      hold: holdReason ? { reason: holdReason } : null,
      approval,
      alternativeOf,
      condition,
      registration: term,
      registrationGate: gate,
      creditUse,
      equivalency,
      provenance: cd.srcs.slice(0, 10).map(prov),
      tasks,
      studentNote: null,
      staffNote: clipText(noteText, 2000),
    });
  }

  // Unrecognised sheets
  for (const c of classified) {
    if (c.kind === "other") {
      ex.add("SHEET_NOT_RECOGNISED", "info", `Sheet "${c.sheet.name}" has no course table that this importer recognises (summary, validation or narrative sheets are not read as plan data).`, { sheet: c.sheet.name }, "sheet");
    }
    if (c.sheet.truncatedRows) ex.add("ROW_SKIPPED", "blocking", `Sheet "${c.sheet.name}" has more rows than can be read; later rows were not converted.`, { sheet: c.sheet.name });
  }

  if (rawItems.length === 0) {
    ex.add("UNKNOWN_TEMPLATE", "blocking", "No planned (not yet completed) courses were found in the recognised sheets.", { sheet: wb.sheets[0]?.name ?? "(workbook)" });
  }

  const raw = {
    contentVersion: ROADMAP_CONTENT_VERSION,
    title: `${degreeTitle} roadmap`.slice(0, 200),
    summary: null,
    objectives,
    phases,
    items: rawItems,
    milestones,
    reportedHistory: history,
    schedule: null,
  };
  const finalized = finalizeContent(raw, ex.list);
  return {
    templateId: DEGREE_MASTER_V1_ID,
    content: rawItems.length === 0 ? null : finalized.content,
    exceptions: finalized.exceptions,
    summary: {
      kind: "workbook",
      fileName: ctx.fileName,
      sheetsRead: [...new Set(sheetsRead)],
      rowsRead,
      rowsConverted: rawItems.length,
      rowsSkipped: Math.max(0, rowsRead - rawItems.length - milestones.length - completedCourses),
      generator: null,
    },
  };
}

export const degreeMasterV1Adapter: WorkbookAdapter = {
  id: DEGREE_MASTER_V1_ID,
  detect,
  convert,
};
