/**
 * S10 independent cell counts of the original workbooks (no importer code, no ExcelJS).
 *
 *   npx tsx scripts/s10/count-originals.ts --eph-locked F --eph-final F --eph-exec F --rut-a F --rut-b F --out DIR
 *
 * Reads cells with scripts/s10/xlsx-cells.ts (zlib + regex) and counts courses, credits, execution
 * weeks, dated deliverables, completed credits, conditional rows and placeholders using exact header
 * names. Writes DIR/counts.json (contains course text: SCRATCH ONLY) and prints a de-identified
 * JSON (counts only) to stdout. The reconciliation (scripts/s10/reconcile-originals.ts) compares
 * these counts with the importer's output.
 */
import fs from "node:fs";
import path from "node:path";
import { readXlsxCells, type RawSheet } from "./xlsx-cells";

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const text = (c: unknown): string => (c === null || c === undefined ? "" : String(c).replace(/\s+/g, " ").trim());
const normId = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const iso = (y: number, m: number, d: number): string => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** "Sep 14–Sep 20, 2026" | "Sep 1–7" (year from `yearHint`) -> [start,end] */
export function parseWeekRange(s: string, yearHint: number | null): [string, string] | null {
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\s*[–-]\s*(?:([A-Za-z]{3})[a-z]*\.?\s+)?(\d{1,2})(?:,\s*(\d{4}))?$/.exec(s.trim());
  if (!m) return null;
  const y = m[5] ? Number(m[5]) : yearHint;
  if (!y) return null;
  const m1 = MONTHS[m[1]!.toLowerCase()];
  const m2 = m[3] ? MONTHS[m[3].toLowerCase()] : m1;
  if (!m1 || !m2) return null;
  const startY = m1 > m2 && !m[5] ? y : m1 > m2 ? y - 1 : y;
  return [iso(startY, m1, Number(m[2])), iso(y, m2, Number(m[4]))];
}

function findHeader(sheet: RawSheet, must: string[]): { row: number; col: Map<string, number> } | null {
  for (let r = 0; r < Math.min(sheet.rows.length, 20); r++) {
    const row = sheet.rows[r] ?? [];
    const col = new Map<string, number>();
    row.forEach((c, i) => {
      const t = text(c);
      if (t && !col.has(t)) col.set(t, i);
    });
    if (must.every((m) => col.has(m))) return { row: r, col };
  }
  return null;
}

const byName = (sheets: RawSheet[], n: string): RawSheet | undefined => sheets.find((s) => s.name === n);

interface LedgerRow {
  sheet: string;
  row: number;
  seq: number;
  course: string;
  provider: string;
  credits: number | null;
  status: string;
  notes: string;
  tesuReq: string;
  placement: string;
  completedCol: string;
}

function ledger(sheet: RawSheet | undefined): LedgerRow[] {
  if (!sheet) return [];
  const h = findHeader(sheet, ["Seq", "Course", "Provider", "Credits"]);
  if (!h) return [];
  const out: LedgerRow[] = [];
  for (let r = h.row + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] ?? [];
    const seq = cells[h.col.get("Seq")!];
    if (typeof seq !== "number" || !Number.isInteger(seq)) continue;
    const course = text(cells[h.col.get("Course")!]);
    if (!course) continue;
    const cr = cells[h.col.get("Credits")!];
    out.push({
      sheet: sheet.name,
      row: r + 1,
      seq,
      course,
      provider: text(cells[h.col.get("Provider")!]),
      credits: typeof cr === "number" ? cr : null,
      status: text(cells[h.col.get("Status") ?? -1]),
      notes: text(cells[h.col.get("Notes") ?? -1]) + " " + text(cells[h.col.get("Prerequisite / Sequence Note") ?? -1]),
      tesuReq: text(cells[h.col.get("TESU Requirement") ?? -1]),
      placement: text(cells[h.col.get("Requirement Block") ?? -1]),
      completedCol: text(cells[h.col.get("Completed / Remaining") ?? -1]),
    });
  }
  return out;
}

/** identity tokens: code(s) + normalised title + title after an em dash */
export function identityTokens(s: string): string[] {
  const t = new Set<string>();
  const clean = s.replace(/\s+/g, " ").trim();
  t.add(normId(clean));
  const code = /\b([A-Z]{2,4})-(\d{4})\b/.exec(clean);
  if (code) {
    t.add(normId(code[0]));
    t.add(normId(clean.replace(code[0], "")));
  }
  const dash = clean.split(/\s+[—–]\s+/);
  if (dash.length > 1) {
    t.add(normId(dash[0]!));
    t.add(normId(dash.slice(1).join(" ")));
  }
  const prov = /^([A-Z][a-z]+(?:\.com)?) (\d{2,3})\b/.exec(clean);
  if (prov) t.add(normId(prov[0]));
  const stripped = clean.replace(/^(CSM Learn|Sophia|Study\.com)\s*[—–-]\s*/i, "");
  if (stripped !== clean) t.add(normId(stripped));
  t.delete("");
  return [...t].filter((x) => x.length >= 4);
}

function dedupeIdentity(rows: LedgerRow[]): LedgerRow[][] {
  const groups: { tokens: Set<string>; rows: LedgerRow[] }[] = [];
  for (const r of rows) {
    const tk = identityTokens(r.course);
    const hit = groups.find((g) => tk.some((x) => g.tokens.has(x)));
    if (hit) {
      hit.rows.push(r);
      tk.forEach((x) => hit.tokens.add(x));
    } else groups.push({ tokens: new Set(tk), rows: [r] });
  }
  return groups.map((g) => g.rows);
}

const BLOCK_SHEETS = ["General Education", "Business Core", "Accounting AOS", "Electives"];
const VIEW_SHEETS = ["TECEP Plan", "Coopersmith Plan", "External Courses", "TESU Courses"];
const CONDITIONAL = /provisional|working|preapprov|fallback|verify|watch|only after|if tesu|hold/i;

function countBy<T>(xs: T[], f: (x: T) => string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of xs) m[f(x)] = (m[f(x)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(m).sort());
}

export function countMaster(file: string) {
  const sheets = readXlsxCells(file);
  const completed = ledger(byName(sheets, "Completed Credits"));
  const blocks = BLOCK_SHEETS.flatMap((n) => ledger(byName(sheets, n)));
  const views = VIEW_SHEETS.flatMap((n) => ledger(byName(sheets, n)));
  const order = ((): { row: number; course: string; provider: string; credits: number | null; phase: string }[] => {
    const sh = byName(sheets, "Execution Order");
    if (!sh) return [];
    const h = findHeader(sh, ["Seq", "Phase", "Course / action"]);
    if (!h) return [];
    const out = [];
    for (let r = h.row + 1; r < sh.rows.length; r++) {
      const c = sh.rows[r] ?? [];
      if (typeof c[h.col.get("Seq")!] !== "number") continue;
      const cr = c[h.col.get("Credits")!];
      out.push({ row: r + 1, course: text(c[h.col.get("Course / action")!]), provider: text(c[h.col.get("Provider")!]), credits: typeof cr === "number" ? cr : null, phase: text(c[h.col.get("Phase")!]) });
    }
    return out;
  })();
  const remainingBlockRows = blocks.filter((r) => r.completedCol !== "Completed" && !/do not take/i.test(r.status) && (r.credits ?? 0) > 0);
  const planGroups = dedupeIdentity(remainingBlockRows);
  const viewRemaining = views.filter((r) => r.completedCol !== "Completed" && !/do not take/i.test(r.status) && (r.credits ?? 0) > 0);
  const viewGroups = dedupeIdentity(viewRemaining);
  const zero = views.filter((r) => (r.credits ?? 0) === 0 || /do not take/i.test(r.status));
  return {
    sheets: sheets.map((s) => s.name),
    completed: { rows: completed.length, credits: completed.reduce((n, r) => n + (r.credits ?? 0), 0), byProvider: countBy(completed, (r) => r.provider) },
    degreeBlockRows: blocks.length,
    degreeBlockRemainingRows: remainingBlockRows.length,
    planCourses: planGroups.length,
    planCredits: planGroups.reduce((n, g) => n + (g[0]!.credits ?? 0), 0),
    planByProvider: countBy(planGroups, (g) => g[0]!.provider),
    planByStatus: countBy(planGroups, (g) => g[0]!.status),
    providerViewRemainingRows: viewRemaining.length,
    providerViewCourses: viewGroups.length,
    providerViewOnlyCourses: viewGroups.filter((g) => !planGroups.some((p) => identityTokens(p[0]!.course).some((t) => identityTokens(g[0]!.course).includes(t)))).length,
    zeroCreditOrDoNotTakeRows: zero.length,
    executionOrderRows: order.length,
    executionOrderCourses: order.filter((o) => (o.credits ?? 0) > 0).length,
    executionOrderZeroCredit: order.filter((o) => (o.credits ?? 0) === 0).length,
    conditionalPlanCourses: planGroups.filter((g) => g.some((r) => CONDITIONAL.test(r.notes) || CONDITIONAL.test(r.status))).length,
    repeatedAcrossSheets: planGroups.filter((g) => g.length > 1).length,
    completedAlsoInBlocks: blocks.filter((r) => r.completedCol === "Completed").length,
    _detail: {
      completed: completed.map((r) => ({ sheet: r.sheet, row: r.row, course: r.course, provider: r.provider, credits: r.credits })),
      plan: planGroups.map((g) => ({ course: g[0]!.course, provider: g[0]!.provider, credits: g[0]!.credits, status: g[0]!.status, refs: g.map((r) => `${r.sheet}#${r.row}`), tesuReq: g[0]!.tesuReq })),
      order,
    },
  };
}

interface Lane {
  wk: number;
  row: number;
  start: string | null;
  end: string | null;
  phase: string;
  lanes: string[];
  due: string;
  checkpoint: string;
}

export function countExecEph(file: string) {
  const sheets = readXlsxCells(file);
  const wk = byName(sheets, "WEEK BY WEEK");
  const weeks: Lane[] = [];
  if (wk) {
    const h = findHeader(wk, ["Wk", "Dates", "Course A", "Course B", "Course C", "Due this week"]);
    if (h) {
      for (let r = h.row + 1; r < wk.rows.length; r++) {
        const c = wk.rows[r] ?? [];
        const n = c[h.col.get("Wk")!];
        if (typeof n !== "number") continue;
        const range = parseWeekRange(text(c[h.col.get("Dates")!]), null);
        weeks.push({
          wk: n,
          row: r + 1,
          start: range?.[0] ?? null,
          end: range?.[1] ?? null,
          phase: text(c[h.col.get("Phase")!]),
          lanes: ["Course A", "Course B", "Course C"].map((k) => text(c[h.col.get(k)!])),
          due: text(c[h.col.get("Due this week")!]),
          checkpoint: text(c[h.col.get("Checkpoint")!]),
        });
      }
    }
  }
  const laneCells = weeks.flatMap((w) => w.lanes.filter(Boolean));
  const kind = (s: string) => /^([A-Za-z\- /]+?) · /.exec(s)?.[1] ?? "(no kind prefix)";
  // trackers
  const tracker = (name: string, must: string[]) => {
    const sh = byName(sheets, name);
    if (!sh) return [] as { row: number; course: string; cr: number; cols: Record<string, string> }[];
    const out: { row: number; course: string; cr: number; cols: Record<string, string> }[] = [];
    let h: { row: number; col: Map<string, number> } | null = null;
    for (let r = 0; r < sh.rows.length; r++) {
      const row = sh.rows[r] ?? [];
      const col = new Map<string, number>();
      row.forEach((c, i) => {
        const t = text(c);
        if (t && !col.has(t)) col.set(t, i);
      });
      if (must.every((m) => col.has(m))) {
        h = { row: r, col };
        continue;
      }
      if (!h) continue;
      const cr = row[h.col.get("Cr")!];
      const course = text(row[h.col.get("Course")!]);
      if (typeof cr === "number" && course) {
        const cols: Record<string, string> = {};
        h.col.forEach((i, k) => (cols[k] = text(row[i])));
        out.push({ row: r + 1, course, cr, cols });
      }
    }
    return out;
  };
  const external = tracker("EXTERNAL TRACKER", ["Course", "Cr"]);
  const tecep = tracker("TECEP TRACKER", ["Course", "Cr"]);
  const residency = tracker("TESU RESIDENCY", ["Course", "Cr"]);
  const sections = (() => {
    const sh = byName(sheets, "EXTERNAL TRACKER");
    return sh ? sh.rows.map((r) => text(r[0])).filter((t) => /^(SOPHIA|STUDY\.COM|CSM LEARN)\b/.test(t)).length : 0;
  })();
  const finishDates = external.filter((e) => /\b[A-Z][a-z]{2} \d{1,2}, \d{4}\b/.test(Object.values(e.cols).join(" "))).length;
  const resHeaderPlaceholders = (() => {
    const sh = byName(sheets, "TESU RESIDENCY");
    if (!sh) return 0;
    let n = 0;
    for (const r of sh.rows) if (/^(D\d|W\d|FP|CS|MT|FN)$/.test(text(r[0])) && !text(r[3])) n++;
    return n;
  })();
  const completed = (() => {
    const sh = byName(sheets, "COMPLETED CREDITS");
    if (!sh) return { rows: 0, credits: 0 };
    const h = findHeader(sh, ["#", "Course", "Cr"]);
    if (!h) return { rows: 0, credits: 0 };
    let rows = 0;
    let credits = 0;
    for (let r = h.row + 1; r < sh.rows.length; r++) {
      const c = sh.rows[r] ?? [];
      if (typeof c[h.col.get("#")!] === "number" && typeof c[h.col.get("Cr")!] === "number") {
        rows++;
        credits += c[h.col.get("Cr")!] as number;
      }
    }
    return { rows, credits };
  })();
  return {
    sheets: sheets.map((s) => s.name),
    weeks: weeks.length,
    firstWeekStart: weeks[0]?.start ?? null,
    lastWeekEnd: weeks[weeks.length - 1]?.end ?? null,
    weeksWithUnparsedDates: weeks.filter((w) => !w.start).length,
    laneCells: laneCells.length,
    laneCellsByKind: countBy(laneCells, kind),
    weeksWithDueText: weeks.filter((w) => w.due).length,
    checkpoints: weeks.filter((w) => w.checkpoint).length,
    externalCourses: external.length,
    externalSections: sections,
    externalWithFinishTargetDate: finishDates,
    tecepCourses: tecep.length,
    tecepWithExamDate: tecep.filter((t) => t.cols["Exam date"]).length,
    residencyCourses: residency.length,
    residencyDatePlaceholdersEmpty: resHeaderPlaceholders,
    completed,
    _detail: {
      external: external.map((e) => ({ row: e.row, course: e.course, cr: e.cr, finish: e.cols["Finish target"] ?? "" })),
      tecep: tecep.map((e) => ({ row: e.row, course: e.course, cr: e.cr })),
      residency: residency.map((e) => ({ row: e.row, course: e.course, cr: e.cr })),
      weeks,
    },
  };
}

export function countRut(file: string) {
  const sheets = readXlsxCells(file);
  const yearHint = (() => {
    for (const s of sheets) for (const r of s.rows) for (const c of r) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(c));
      if (m) return Number(m[1]);
    }
    return null;
  })();
  const wk = byName(sheets, "WEEK BY WEEK");
  const weeks: { wk: number; row: number; start: string | null; end: string | null; sophia: string; study: string; due: string }[] = [];
  if (wk) {
    const h = findHeader(wk, ["Week", "Dates"]);
    if (h) {
      const sophiaCol = [...h.col.keys()].find((k) => k.startsWith("Sophia"))!;
      const studyCol = [...h.col.keys()].find((k) => k.startsWith("Study.com"))!;
      for (let r = h.row + 1; r < wk.rows.length; r++) {
        const c = wk.rows[r] ?? [];
        const n = c[h.col.get("Week")!];
        if (typeof n !== "number") continue;
        const range = parseWeekRange(text(c[h.col.get("Dates")!]), yearHint);
        weeks.push({ wk: n, row: r + 1, start: range?.[0] ?? null, end: range?.[1] ?? null, sophia: text(c[h.col.get(sophiaCol)!]), study: text(c[h.col.get(studyCol)!]), due: text(c[h.col.get("Due this week")!]) });
      }
    }
  }
  const sop = byName(sheets, "SOPHIA TRACKER");
  const sophia: { row: number; course: string; challenges: number; milestones: number }[] = [];
  if (sop) {
    const h = findHeader(sop, ["Course", "Challenges"]);
    if (h) {
      const msCol = [...h.col.keys()].find((k) => k.startsWith("Milestones"))!;
      for (let r = h.row + 1; r < sop.rows.length; r++) {
        const c = sop.rows[r] ?? [];
        const ch = c[h.col.get("Challenges")!];
        const ms = c[h.col.get(msCol)!];
        if (typeof ch === "number" && text(c[h.col.get("Course")!])) sophia.push({ row: r + 1, course: text(c[h.col.get("Course")!]), challenges: ch, milestones: typeof ms === "number" ? ms : 0 });
      }
    }
  }
  const study = byName(sheets, "STUDY.COM TRACKER");
  const studyCourses: { row: number; course: string; chapters: number; papers: number; target: string }[] = [];
  const assignments: { row: number; due: string; course: string; assignment: string }[] = [];
  if (study) {
    const h = findHeader(study, ["Course", "Papers"]);
    if (h) {
      const chCol = [...h.col.keys()].find((k) => /^(Chapters|Content Ch\.)$/.test(k))!;
      const tgCol = [...h.col.keys()].find((k) => /Target/.test(k))!;
      for (let r = h.row + 1; r < study.rows.length; r++) {
        const c = study.rows[r] ?? [];
        const p = c[h.col.get("Papers")!];
        if (typeof p === "number") studyCourses.push({ row: r + 1, course: text(c[h.col.get("Course")!]), chapters: Number(c[h.col.get(chCol)!]) || 0, papers: p, target: text(c[h.col.get(tgCol)!]) });
      }
    }
    const ah = findHeader(study, ["Due", "Course", "Assignment"]);
    if (ah) {
      for (let r = ah.row + 1; r < study.rows.length; r++) {
        const c = study.rows[r] ?? [];
        const a = text(c[ah.col.get("Assignment")!]);
        if (a && text(c[ah.col.get("Due")!])) assignments.push({ row: r + 1, due: text(c[ah.col.get("Due")!]), course: text(c[ah.col.get("Course")!]), assignment: a });
      }
    }
  }
  const dueTokens = weeks.flatMap((w) => w.due.split(/(?<=\d)\s+(?=[A-Z])/).filter((t) => /—\s*[A-Z][a-z]{2} \d/.test(t)));
  return {
    sheets: sheets.map((s) => s.name),
    yearFromWorkbook: yearHint,
    weeks: weeks.length,
    firstWeekStart: weeks[0]?.start ?? null,
    lastWeekEnd: weeks[weeks.length - 1]?.end ?? null,
    weeksWithUnparsedDates: weeks.filter((w) => !w.start).length,
    sophiaCourses: sophia.length,
    sophiaChallenges: sophia.reduce((n, s) => n + s.challenges, 0),
    sophiaMilestones: sophia.reduce((n, s) => n + s.milestones, 0),
    studyComCourses: studyCourses.length,
    studyComChapters: studyCourses.reduce((n, s) => n + s.chapters, 0),
    studyComPapers: studyCourses.reduce((n, s) => n + s.papers, 0),
    studyComFinishTargets: studyCourses.filter((s) => /[A-Z][a-z]{2} \d/.test(s.target)).length,
    studyComNoFinal: studyCourses.filter((s) => /NO FINAL|no required final/i.test(s.target)).length,
    assignmentRowsWithDueDate: assignments.length,
    weeklyDueTokens: dueTokens.length,
    weeksWithConditionalLane: weeks.filter((w) => /only if|otherwise|replacement/i.test(w.sophia + " " + w.study)).length,
    totalCredits: (sophia.length + studyCourses.length) * 3,
    _detail: { weeks, sophia, studyCourses, assignments, dueTokens },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = opt("out");
  const files = { ephLocked: opt("eph-locked"), ephFinal: opt("eph-final"), ephExec: opt("eph-exec"), rutA: opt("rut-a"), rutB: opt("rut-b") };
  if (!out || Object.values(files).some((f) => !f)) {
    console.error("usage: --eph-locked F --eph-final F --eph-exec F --rut-a F --rut-b F --out DIR");
    process.exit(2);
  }
  const all = {
    ephLocked: countMaster(files.ephLocked!),
    ephFinal: countMaster(files.ephFinal!),
    ephExec: countExecEph(files.ephExec!),
    rutA: countRut(files.rutA!),
    rutB: countRut(files.rutB!),
  };
  fs.mkdirSync(out!, { recursive: true });
  fs.writeFileSync(path.join(out!, "counts.json"), JSON.stringify(all, null, 2));
  const strip = (o: unknown): unknown => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== "_detail").map(([k, v]) => [k, strip(v)])) : o);
  console.log(JSON.stringify(strip(all), null, 2));
}
