/**
 * S07 de-identified workbook builders.
 *
 * Scenario EPH ("Student EPH-1"): TESU-style BSBA Accounting + a state CPA
 *   licensing plan. Master degree workbook (ledger layout) + 42-week execution
 *   workbook (activity-list layout). v2 revises the pair.
 * Scenario RUT ("Student RUT-1"): TESU-style BA Liberal Studies, conferred
 *   associate degree. Master (tracker + prior education layout) + execution
 *   workbook in the course-card + lane-grid layout.
 *
 * Everything here is SYNTHETIC: invented student labels, no personal data.
 * Public catalog names (TESU/Sophia/Study.com course titles, "TECEP") only.
 * See README.md for what mirrors a real layout and what is reconstructed.
 */
import ExcelJS from "exceljs";

const d = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
export const addDays = (iso: string, n: number): string => new Date(d(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);

export function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date(Date.UTC(2026, 9, 26));
  wb.modified = new Date(Date.UTC(2026, 9, 26));
  return wb;
}
export async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ═══════════════════════════ Scenario EPH ═══════════════════════════════════

type Block = "General Education" | "Professional Business" | "Accounting Area of Study" | "Electives";
interface Course {
  block: Block;
  req: string;
  course: string;
  provider: string;
  credits?: number;
  level?: string;
  done?: boolean;
  status?: string; // Done | To take | Hold | Watch | Do not take | Alternative
  burden?: string;
  exam?: string;
  seqNote?: string;
  cpaAcc?: boolean;
  cpaBus?: boolean;
  notes?: string;
  examDate?: string;
  term?: string;
  phase?: string;
  /** week in the 42-week execution schedule where the course starts, and its task plan */
  plan?: { week: number; weeks: number; tasks: { text: string; type: string; offset: number }[]; dueShiftWeeks?: number };
}

const TERM = "TESU Spring 2027";
const P1 = "Phase 1 — External";
const P2 = "Phase 2 — Coopersmith";
const P3 = "Phase 3 — TECEP";
const P4 = "Phase 4 — TESU term";

const sophiaDone = (req: string, course: string, block: Block = "General Education", extra: Partial<Course> = {}): Course => ({
  block, req, course, provider: "Sophia", level: "LL", done: true, status: "Done", burden: "Already completed", exam: "—", seqNote: "Do not retake", notes: "Existing credit", ...extra,
});

function ephCourses(version: 1 | 2): Course[] {
  const list: Course[] = [
    sophiaDone("Written Communication I", "English Composition I"),
    sophiaDone("Written Communication II", "English Composition II", "General Education", { seqNote: "Transcript/update control" }),
    sophiaDone("Quantitative Literacy", "College Algebra"),
    sophiaDone("Civic & Global Leadership", "Introduction to Ethics"),
    sophiaDone("Civic & Global Leadership", "Introduction to Sociology"),
    sophiaDone("Scientific Knowledge", "Human Biology"),
    sophiaDone("Scientific Knowledge", "Introduction to Nutrition"),
    sophiaDone("Knowledge of Human Cultures", "Lifespan Development"),
    sophiaDone("Statistics", "Introduction to Statistics", "Professional Business", { cpaBus: true }),
    sophiaDone("Microeconomics", "Microeconomics", "Professional Business", { cpaBus: true }),
    sophiaDone("Principles of Finance", "Principles of Finance", "Professional Business", { cpaBus: true, status: "Watch", notes: "EVALUATION-WATCH: completed, but TESU has not been shown to post it as FIN-3010." }),
    sophiaDone("Financial Accounting", "Financial Accounting", "Professional Business", { cpaAcc: true, cpaBus: true }),
    sophiaDone("Managerial Accounting", "Managerial Accounting", "Professional Business", { cpaAcc: true, cpaBus: true }),
    sophiaDone("Elective", "Introduction to Business", "Electives", { cpaBus: true }),
    sophiaDone("Elective", "Conflict Resolution", "Electives"),
    sophiaDone("Elective", "Environmental Science", "Electives"),
    { block: "Professional Business", req: "Macroeconomics", course: "Macroeconomics", provider: "Dallas College", level: "LL", done: true, status: "Done", burden: "Already completed — grade B", exam: "—", seqNote: "Do NOT take Sophia Macroeconomics", cpaBus: true, notes: "CONTROL: Dallas College replaces planned Sophia Macro" },
  ];

  const tecep = (block: Block, req: string, course: string, level: string, examDate: string, week: number, extra: Partial<Course> = {}): Course => ({
    block, req, course, provider: "TESU TECEP", level, status: "To take", burden: "Exam-based TECEP", exam: "TECEP exam", seqNote: "Confirm TECEP available in registration window", notes: "Exact TECEP set", examDate, term: TERM, phase: P3,
    cpaBus: block === "Professional Business",
    plan: { week, weeks: 1, tasks: [{ text: "TECEP exam", type: "Exam", offset: 0 }] },
    ...extra,
  });
  const sophia = (block: Block, req: string, course: string, week: number, seqNote = "Phase 1 external", extra: Partial<Course> = {}): Course => ({
    block, req, course, provider: "Sophia", level: "LL", status: "To take", burden: "Sophia milestones; confirm live shell", exam: "Sophia milestones", seqNote, notes: "New Sophia", phase: P1,
    plan: { week, weeks: 2, tasks: [{ text: "Milestone 1", type: "Assignment", offset: 0 }, { text: "Milestone 2", type: "Assignment", offset: 1 }] },
    ...extra,
  });
  const study = (block: Block, req: string, course: string, week: number, burden: string, extra: Partial<Course> = {}): Course => ({
    block, req, course, provider: "Study.com", level: "LL", status: "To take", burden, exam: "Open-book, unproctored final", seqNote: "Phase 1 external", notes: "New Study.com", phase: P1,
    plan: { week, weeks: 3, tasks: [{ text: "Assignment 1", type: "Assignment", offset: 1 }, { text: "Final exam", type: "Exam", offset: 2 }] },
    ...extra,
  });

  list.push(
    tecep("General Education", "Oral Communication", "COM-2090 Public Speaking", "LL", "2027-02-09", 24),
    { block: "General Education", req: "Information Literacy", course: "SOS-1100 Fact, Fiction, or Fake?", provider: "TESU Online", level: "LL", status: "To take", burden: "Writing-heavy TESU course (discussions + papers)", exam: "TESU course", seqNote: "One of two actual TESU courses; Edison Accelerate if available", notes: "Actual TESU course — not a TECEP", term: TERM, phase: P4, plan: { week: 28, weeks: 8, tasks: [{ text: "Assignment 1", type: "Assignment", offset: 3 }, { text: "Assignment 2", type: "Assignment", offset: 6 }] } },
    sophia("General Education", "Civic & Global Leadership", "U.S. Government / American Government", 1, "Phase 1 external"),
    sophia("General Education", "Knowledge of Human Cultures", "U.S. History I", 3),
    sophia("General Education", "Knowledge of Human Cultures", "U.S. History II", 5, "Phase 1 external after History I preferred"),
    tecep("General Education", "Knowledge of Human Cultures", "PSY-3500 Abnormal Psychology", "UL", "2027-02-12", 24),
    tecep("General Education", "Knowledge of Human Cultures", "PHI-1300 Critical Reasoning", "LL", "2027-02-16", 25),
    tecep("Professional Business", "Computer Concepts", "CIS-1070 Computer Concepts", "LL", "2027-02-12", 24),
    study("Professional Business", "Business Law", "Business 103 — Business Law", 7, "Study.com chapter tests + assignments (confirm live shell)", { cpaBus: true, plan: { week: 7, weeks: 3, tasks: [{ text: "Assignment 1", type: "Assignment", offset: 1 }, { text: "Final exam", type: "Exam", offset: 2 }] } }),
    study("Professional Business", "Principles of Management", "Business 101 — Principles of Management", 9, "Study.com chapter tests + assignments (confirm live shell)", { cpaBus: true }),
    tecep("Professional Business", "Principles of Marketing", "MKT-2010 Introduction to Marketing", "LL", "2027-02-18", 25),
    {
      block: "Professional Business", req: "Quantitative Skills for Business", course: "Quantitative Skills for Business — NO VALIDATED MAP", provider: "CSM Learn — HOLD", level: "LL", status: "Hold", burden: "No-paper preference", exam: "CSM assessment",
      seqNote: "DO NOT BUY until TESU confirms this fills BUS-2100.", cpaBus: true, notes: "HOLD. Not a validated TESU map. Keep the 3-credit hole visible.", phase: P1,
    },
    tecep("Professional Business", "Managerial Communications", "MAN-3730 Managerial Communications", "UL", "2027-02-23", 26, { seqNote: "Default TESU-side fill.", notes: "Fallback: Study.com Business 324 if the TECEP is not passed by March." }),
    {
      block: "Professional Business", req: "Business Administration Capstone", course: "BUS-4210 Business Administration Capstone", provider: "TESU Online", level: "UL", status: "To take", burden: "Writing-heavy TESU capstone", exam: "TESU course",
      seqNote: "LAST actual TESU course. After SOS-1100 and all transfer/TECEP credit is posted.", cpaBus: true, notes: "Actual TESU course — Edison Accelerate if available", phase: P4, term: TERM,
      plan: { week: 32, weeks: 8, tasks: [{ text: "Assignment 1", type: "Assignment", offset: 3 }, { text: "Assignment 2", type: "Assignment", offset: 7 }] },
    },
    study("Accounting Area of Study", "ACC-2010 Intermediate Accounting I", "Accounting 201 — Intermediate Financial Accounting I", 12, "1 required assignment + chapter tests", { level: "LL", cpaAcc: true, notes: "PROVISIONAL required AOS.", seqNote: "Preferred validated-map route; verify current TESU posting before enrollment" }),
    study("Accounting Area of Study", "ACC-2020 Intermediate Accounting II", "Accounting 202 — Intermediate Financial Accounting II", 15, "Current validated-map Study.com route", { level: "LL", cpaAcc: true, notes: "PROVISIONAL required AOS.", seqNote: "After ACC-2010; verify current TESU posting before enrollment" }),
    study("Accounting Area of Study", "ACC-3030 Cost Accounting", "Accounting 303 — Cost Accounting", 18, "3 required assignments", { level: "UL", cpaAcc: true, notes: "PROVISIONAL named select.", seqNote: "Verify current TESU posting before enrollment", plan: { week: 18, weeks: 4, tasks: [{ text: "Assignment 1", type: "Assignment", offset: 1 }, { text: "Assignment 2", type: "Assignment", offset: 2 }, { text: "Assignment 3", type: "Assignment", offset: 3 }, { text: "Final exam", type: "Exam", offset: 3 }] } }),
    study("Accounting Area of Study", "ACC-4010 Advanced Accounting I", "Accounting 302 — Advanced Financial Accounting II", 22, "3 required assignments + chapter tests", { level: "UL", cpaAcc: true, notes: "PROVISIONAL named select. Not Coopersmith ACC-400.", seqNote: "Validated-map strongest current route; after intermediate sequence" }),
    {
      block: "Accounting Area of Study", req: "ACC-4210 Federal Income Taxation", course: "ACC-352 Federal Taxation of Business Entities", provider: "Coopersmith", level: "UL", status: "Hold", burden: "Coopersmith assessment", exam: "Coopersmith assessment",
      seqNote: "PREAPPROVE / verify current TESU posting before taking", cpaAcc: true, notes: "HOLD — preapprove ACC-352 as ACC-4210 before purchase.", phase: P2,
    },
    {
      block: "Accounting Area of Study", req: "ACC-4110 Auditing", course: "ACC-375 Auditing of Financial Statements", provider: "Coopersmith", level: "UL", status: "Hold", burden: "Coopersmith assessment", exam: "Coopersmith assessment",
      seqNote: "PREAPPROVE / verify current TESU posting before taking", cpaAcc: true, notes: "HOLD — preapprove ACC-375 as ACC-4110 before purchase.", phase: P2,
    },
    {
      block: "Accounting Area of Study", req: "ACC-2010 Intermediate Accounting I", course: "ACC-301 Intermediate Accounting I", provider: "Coopersmith", level: "LL", status: "Alternative", burden: "Coopersmith assessment", exam: "Coopersmith assessment",
      seqNote: "Historical advisor map only", cpaAcc: true, notes: "Alternative for Accounting 201 if the Study.com mapping is not confirmed.", phase: P2,
    },
    tecep("Electives", "Elective", "FIN-3310 Financial Institutions & Markets", "UL", "2027-02-25", 26, { cpaBus: true }),
  );
  if (version === 1) {
    list.push(
      study("Professional Business", "International Management", "Business 308 — International Management", 10, "Assignments; verify current TESU equivalency", { level: "UL", cpaBus: true, seqNote: "Phase 1 external; verify equivalency before enrollment" }),
      tecep("Electives", "Elective", "OPM-3010 Operations Management", "UL", "2027-02-26", 26, { cpaBus: true }),
    );
  } else {
    list.push(
      // replaced course
      study("Professional Business", "International Management", "Business 324 — Managerial Communication", 10, "1 required assignment", { level: "UL", cpaBus: true, seqNote: "Phase 1 external", notes: "Replaces Business 308 in the revised plan." }),
      // added course
      sophia("Electives", "Elective", "Introduction to Chemistry", 4, "Phase 1 external", { cpaBus: false }),
    );
  }
  // v2 reschedules Business 103 two weeks later (same course, new dates)
  if (version === 2) {
    const b103 = list.find((c) => c.course.startsWith("Business 103"))!;
    b103.plan = { ...b103.plan!, week: 9, dueShiftWeeks: 2 };
  }
  return list;
}

const LEDGER_HEADERS = [
  "Seq", "Requirement Block", "TESU Requirement", "Course", "Provider", "Credits", "Level", "Completed / Remaining", "Degree Placement",
  "Writing / Assignment Burden", "Exam Type", "Prerequisite / Sequence Note", "CPA Accounting?", "CPA Business?", "Status", "Notes", "Exam Date", "Term",
];

function ledgerSheet(wb: ExcelJS.Workbook, name: string, title: string, note: string, rows: Course[], totalLabel: string): void {
  const ws = wb.addWorksheet(name);
  ws.addRow([title]);
  ws.addRow([note]);
  ws.addRow(LEDGER_HEADERS);
  rows.forEach((c, i) => {
    ws.addRow([
      i + 1, c.block, c.req, c.course, c.provider, c.credits ?? 3, c.level ?? "LL", c.done ? "Completed" : "Remaining", c.block,
      c.burden ?? "", c.exam ?? "—", c.seqNote ?? "", c.cpaAcc ? "Yes" : "No", c.cpaBus ? "Yes" : "No", c.status ?? "To take", c.notes ?? "",
      c.examDate ? d(c.examDate) : null, c.term ?? null,
    ]);
  });
  const total = rows.reduce((s, c) => s + (c.credits ?? 3), 0);
  ws.addRow([totalLabel, null, null, null, null, total]);
  ws.addRow(["Prepared exclusively for Student EPH-1 by Lumière · Confidential"]);
}

export interface WorkbookFile {
  readonly fileName: string;
  readonly buffer: Buffer;
}

export async function buildEphMaster(version: 1 | 2): Promise<WorkbookFile> {
  const courses = ephCourses(version);
  const wb = newWorkbook();
  const ms = wb.addWorksheet("Master Plan");
  ms.addRow(["Master Plan", "STUDENT EPH-1 · TESU BSBA IN ACCOUNTING · WASHINGTON CPA"]);
  ms.addRow([null, "CORRECTED PATH · 51 earned · 69 remaining · 120 at conferral · CONDITIONAL — TESU evaluation and Coopersmith preapproval still control"]);
  ms.addRow([null, "EXECUTIVE DECISION", null, null, null, null, null, "LIVE VALIDATION"]);
  ms.addRow([null, "Primary degree", "TESU BSBA in Accounting"]);
  ms.addRow([null, "CPA jurisdiction", "Washington State"]);
  ms.addRow([null, "Lumière recommendation", "PRIMARY PATH — CONDITIONAL"]);

  const done = courses.filter((c) => c.done);
  ledgerSheet(wb, "Completed Credits", "COMPLETED CREDITS · 51 CREDITS ALREADY EARNED", "48 Sophia + 3 Dallas College Macroeconomics. Do not retake any course on this sheet.", done, "COMPLETED TOTAL (must equal 51)");
  const blocks: [Block, string, string][] = [
    ["General Education", "General Education", "GENERAL EDUCATION · 45 CREDITS REQUIRED"],
    ["Professional Business", "Business Core", "PROFESSIONAL BUSINESS REQUIREMENTS · 42 CREDITS REQUIRED"],
    ["Accounting Area of Study", "Accounting AOS", "ACCOUNTING AREA OF STUDY · 18 CREDITS · VALIDATED MAP PLAN"],
    ["Electives", "Electives", "ELECTIVES · 15 CREDITS REQUIRED"],
  ];
  for (const [block, sheetName, title] of blocks) {
    ledgerSheet(wb, sheetName, title, "Yellow Status cells are the only student inputs.", courses.filter((c) => c.block === block), `${block.toUpperCase()} TOTAL`);
  }
  const remaining = courses.filter((c) => !c.done && c.status !== "Alternative");
  ledgerSheet(wb, "TECEP Plan", "TECEP SET · TESU CREDITS", "TECEPs are TESU credit but do not replace actual-course residency.", remaining.filter((c) => c.provider === "TESU TECEP"), "TECEP TOTAL");
  ledgerSheet(wb, "Coopersmith Plan", "COOPERSMITH · TAX + AUDIT ONLY", "Default path is ACC-352 Tax and ACC-375 Auditing after TESU preapproval.", courses.filter((c) => c.provider === "Coopersmith" && c.status !== "Alternative"), "COOPERSMITH TOTAL");
  ledgerSheet(wb, "External Courses", "NEW EXTERNAL CREDIT BLOCK", "Study.com maps are PROVISIONAL partner maps. CSM Learn is HOLD.", remaining.filter((c) => /sophia|study\.com|csm/i.test(c.provider)), "NEW EXTERNAL TOTAL");
  ledgerSheet(wb, "TESU Courses", "ACTUAL TESU COURSES", "These are the only actual TESU courses. BUS-4210 is last.", remaining.filter((c) => c.provider === "TESU Online"), "ACTUAL TESU COURSE TOTAL");

  // Registration terms (reconstructed layout: not present in the real master)
  const terms = wb.addWorksheet("TESU Terms");
  terms.addRow(["TESU TERMS USED BY THIS PLAN"]);
  terms.addRow(["Term", "Term Start", "Registration Deadline", "Final Exam Date"]);
  terms.addRow([TERM, d("2027-01-11"), d("2026-12-28"), d("2027-01-31")]);

  const cpa = wb.addWorksheet("CPA Audit");
  cpa.addRow(["WASHINGTON CPA EDUCATION AUDIT · PLANNING ONLY"]);
  cpa.addRow(["This sheet is a Lumière planning audit. It is not an official determination."]);
  cpa.addRow(["#", "Subject", "Course / source", "Credits", "Provider", "Status", "Degree block", "In 24-count?", "Notes"]);
  courses.filter((c) => c.cpaAcc).forEach((c, i) => cpa.addRow([i + 1, "Accounting", c.course, 3, c.provider, c.status, c.block, "Yes", ""]));
  cpa.addRow(["ACCOUNTING TOTAL", null, null, courses.filter((c) => c.cpaAcc).length * 3, null, "PASS"]);

  const seq = wb.addWorksheet("Execution Order");
  seq.addRow(["EXECUTION ORDER · FOLLOW THIS SEQUENCE"]);
  seq.addRow(["Obtain TESU preapproval for conditional Coopersmith mappings before purchase. BUS-4210 stays last."]);
  seq.addRow(["Seq", "Phase", "Step", "Course / action", "Provider", "Credits", "Why this order", "Status", "Notes", "Done?"]);
  let n = 0;
  for (const phase of [P1, P2, P3, P4]) {
    let step = 0;
    for (const c of courses.filter((x) => !x.done && x.phase === phase)) {
      seq.addRow([++n, phase, ++step, c.course, c.provider, c.credits ?? 3, c.seqNote ?? "", c.status ?? "To take", c.notes ?? "", "No"]);
    }
  }
  seq.addRow([++n, "Phase 5 — Finish", 1, "TESU graduation filing / conferral", "TESU", 0, "After zero unmet requirements", "To take", "Official evaluation controls", "No"]);
  seq.addRow([++n, "Phase 5 — CPA", 2, "Order official TESU transcript + Washington CPA education evaluation", "WA Board / CPAES / NIES", 0, "After conferral", "To take", "Planning audit is not Board approval", "No"]);

  const val = wb.addWorksheet("Validation");
  val.addRow(["VALIDATION · AUTOMATIC RECONCILIATION"]);
  val.addRow(["#", "Test", "Target", "Actual", "Result"]);
  val.addRow([1, "Degree total = 120", 120, 120, "PASS"]);
  return { fileName: `eph-master-v${version}.xlsx`, buffer: await toBuffer(wb) };
}

const WEEK1 = "2026-08-31";
const weekStart = (wk: number): string => addDays(WEEK1, (wk - 1) * 7);

export async function buildEphExecution(version: 1 | 2): Promise<WorkbookFile> {
  const courses = ephCourses(version).filter((c) => c.plan);
  const wb = newWorkbook();
  const cover = wb.addWorksheet("Cover");
  cover.addRow(["42-WEEK EXECUTION SCHEDULE · STUDENT EPH-1"]);
  cover.addRow([version === 1 ? "Prepared 2026-08-24 · Week 1 starts 2026-08-31" : "Prepared 2026-08-24 · Rebaselined for revision 2"]);
  const ws = wb.addWorksheet("Weekly Plan");
  ws.addRow(["42-WEEK EXECUTION PLAN · WEEKS 1–42 · Prepared 2026-08-24"]);
  ws.addRow(["One row per scheduled deliverable. Week 1 starts Monday 31 Aug 2026."]);
  ws.addRow(["Week", "Week Of", "Course / Activity", "Provider", "Task", "Due", "Type", "Status"]);
  const rows: { wk: number; course: string; provider: string; task: string; due: string | null; type: string }[] = [];
  const emit = (wk: number, course: string, provider: string, task: string, due: string | null, type: string) => rows.push({ wk, course, provider, task, due, type });
  for (const c of courses) {
    const plan = c.plan!;
    const shift = plan.dueShiftWeeks ?? 0;
    const firstWeek = plan.week + 0;
    emit(firstWeek, c.course.replace(/ — NO VALIDATED MAP$/, ""), c.provider.replace(/ — HOLD$/, ""), "", null, "Study");
    for (const t of plan.tasks) {
      const wk = firstWeek + t.offset;
      let due = addDays(weekStart(wk), 4);
      // TECEP exam dates come from the master (Exam Date); the execution plan books them on the same day,
      // except CIS-1070 which the execution plan puts a week later (a deliberate conflict).
      if (c.examDate && t.type === "Exam") due = c.course.startsWith("CIS-1070") ? addDays(c.examDate, 7) : c.examDate;
      if (shift) due = addDays(due, 0);
      emit(wk, c.course, c.provider, t.text, due, t.type);
    }
  }
  // an execution-only course that the master does not contain (must NOT become a plan item)
  emit(14, "Business 205 — Business Statistics", "Study.com", "Assignment 1", addDays(weekStart(14), 4), "Assignment");
  // two rows that disagree on the same deadline
  emit(16, "Accounting 202 — Intermediate Financial Accounting II", "Study.com", "Final exam", addDays(weekStart(16), 6), "Exam");
  // non-course milestones
  emit(1, "Orientation", "Lumière", "Orientation session", addDays(weekStart(1), 2), "Milestone");
  emit(36, "Apply for graduation", "TESU", "Submit graduation application", addDays(weekStart(36), 1), "Milestone");
  emit(42, "Degree conferral", "TESU", "Conferral", addDays(weekStart(42), 4), "Milestone");
  rows.sort((a, b) => a.wk - b.wk);
  for (const r of rows) {
    ws.addRow([r.wk, d(weekStart(r.wk)), r.course, r.provider, r.task || null, r.due ? d(r.due) : null, r.type, "Planned"]);
  }
  return { fileName: `eph-execution-v${version}.xlsx`, buffer: await toBuffer(wb) };
}

// ═══════════════════════════ Scenario RUT ═══════════════════════════════════

const RUT_SOPHIA: { course: string; challenges: number; milestones: number }[] = [
  { course: "Introduction to Statistics", challenges: 20, milestones: 6 },
  { course: "Macroeconomics", challenges: 10, milestones: 5 },
  { course: "Introduction to Chemistry", challenges: 12, milestones: 4 },
  { course: "Microeconomics", challenges: 12, milestones: 4 },
  { course: "Precalculus", challenges: 17, milestones: 6 },
  { course: "Financial Accounting", challenges: 9, milestones: 5 },
  { course: "Managerial Accounting", challenges: 14, milestones: 5 },
  { course: "Anatomy & Physiology I", challenges: 17, milestones: 5 },
  { course: "Anatomy & Physiology II", challenges: 13, milestones: 4 },
  { course: "Intro to Relational Databases", challenges: 19, milestones: 6 },
  { course: "Microbiology", challenges: 19, milestones: 6 },
  { course: "Principles of Finance", challenges: 15, milestones: 5 },
  { course: "Introduction to Physics", challenges: 18, milestones: 7 },
];
const RUT_STUDY: { course: string; code: string; assignments: number; start: string; plan: string; weeks: [number, number] }[] = [
  { course: "Psychology 310 — Psychology of Personality", code: "SDCM-0180", assignments: 1, start: "2026-09-01", plan: "Ch 1–6 Week 1. Submit Assignment 1 on 12 Sep. Finish remaining chapter tests and take final 15 Sep.", weeks: [1, 3] },
  { course: "Sociology 305 — Sociology of Work", code: "SDCM-0186", assignments: 2, start: "2026-09-12", plan: "Start 12 Sep. A1 due 20 Sep; A2 due 26 Sep; final 30 Sep.", weeks: [2, 5] },
  { course: "Criminal Justice 305 — The Juvenile Justice System", code: "SDCM-0128", assignments: 2, start: "2026-09-28", plan: "Start 28 Sep. A1 due 10 Oct; A2 due 13 Oct; final 16 Oct.", weeks: [4, 7] },
  { course: "Psychology 312 — History & Systems of Psychology", code: "SDCM-0135", assignments: 2, start: "2026-10-12", plan: "Start 12 Oct. A1 (750–1,000 words) due 25 Oct; A2 (2,000–3,000 words) due 30 Oct; final 3 Nov.", weeks: [6, 10] },
  { course: "Business 310 — Advanced Business Ethics", code: "SDCM-0118", assignments: 2, start: "2026-10-30", plan: "Start 30 Oct. A1 due 15 Nov; A2 due 19 Nov; complete chapter tests and confirm final course grade by 23 Nov.", weeks: [9, 12] },
];

export async function buildRutMaster(): Promise<WorkbookFile> {
  const wb = newWorkbook();
  const start = wb.addWorksheet("START HERE");
  start.addRow([null, "STUDENT RUT-1 · 3-MONTH DEGREE COMPLETION PLAN"]);
  start.addRow([null, "September 1 → November 30, 2026 · 54 transfer credits · January 2027 TESU target"]);
  start.addRow([null, "Primary degree", "TESU BA in Liberal Studies"]);

  // Reconstructed layout: not present in the real degree workbook.
  const prior = wb.addWorksheet("Prior Education");
  prior.addRow(["PRIOR EDUCATION AND TRANSFER STRATEGY · 60 CREDITS REPORTED"]);
  prior.addRow(["Credential", "Kind", "Institution", "Credits", "Status", "Conferred", "Note"]);
  prior.addRow(["Associate degree (NJ transfer pathway)", "credential", "Community College A", 60, "Conferred", d("2025-05-20"), "Official conferred transcript must be sent to TESU. Not verified here."]);
  prior.addRow(["Existing credit recognition", "credit baseline", "Community College A", 60, "Reported", null, "Transfer strategy assumes the full 60 credits are recognised."]);

  const soph = wb.addWorksheet("SOPHIA TRACKER");
  soph.addRow(["SOPHIA TRACKER · 13 COURSES · 39 CREDITS"]);
  soph.addRow(["Zero papers · Zero Touchstones · Challenges → Milestones → 70%+ overall → Done. Yellow cells only."]);
  soph.addRow(["Course", "Challenges", "Done", "Milestones", "Done", "Score %", "Status", "% Work Complete"]);
  for (const s of RUT_SOPHIA) soph.addRow([s.course, s.challenges, 0, s.milestones, 0, null, "Not started", 0]);

  const sdc = wb.addWorksheet("STUDY.COM TRACKER");
  sdc.addRow(["STUDY.COM TRACKER · 5 COURSES · 15 UPPER-LEVEL CREDITS"]);
  sdc.addRow(["9 written assignments · Business 310 currently has no required final · Yellow cells only."]);
  sdc.addRow(["Course", "Content Ch.", "Done", "Papers", "Papers Done", "Finish Target", "Status"]);
  for (const s of RUT_STUDY) sdc.addRow([s.course, 11, 0, s.assignments, 0, null, "Not started"]);

  // Reconstructed: the real degree workbook has no per-course credit/condition sheet.
  const arch = wb.addWorksheet("Degree Architecture");
  arch.addRow(["DEGREE ARCHITECTURE · 120 CREDITS · UPPER-LEVEL RULE UNDER REVIEW"]);
  arch.addRow(["At least 15 upper-level credits are needed inside the Liberal Studies block; placement of external upper-level credit is not confirmed."]);
  arch.addRow(["Seq", "Requirement Block", "TESU Requirement", "Course", "Provider", "Credits", "Level", "Completed / Remaining", "Status", "Notes"]);
  RUT_STUDY.forEach((s, i) =>
    arch.addRow([i + 1, "Liberal Studies AOS", "Upper-level Liberal Studies credit", s.course, "Study.com", 3, "UL", "Remaining", "To take", "PROVISIONAL upper-level credit; verify current TESU posting before relying on it."]),
  );
  arch.addRow([6, "Liberal Studies AOS", "Elective", "Introduction to Physics", "Sophia", 3, "LL", "Remaining", "To take", "Substitutable: if TESU placement is not green-lit, use an approved zero-Touchstone Sophia elective."]);
  arch.addRow([7, "Liberal Studies AOS", "Capstone", "Liberal Arts Capstone", "TESU Online", 3, "UL", "Remaining", "To take", "Applicable capstone code is assigned by the advisor."]);
  arch.addRow([8, "Liberal Studies AOS", "Information Literacy", "SOS-1100 Fact, Fiction, or Fake?", "TESU Online", 3, "LL", "Remaining", "To take", "Edison Accelerate if available."]);
  return { fileName: "rut-master.xlsx", buffer: await toBuffer(wb) };
}

export async function buildRutExecution(): Promise<WorkbookFile> {
  const wb = newWorkbook();
  const cover = wb.addWorksheet("00_COVER");
  cover.addRow([null, "STUDENT RUT-1 — 3-MONTH EXECUTION PLAN — FINAL"]);
  cover.addRow([null, "Sophia + Study.com active | 54 transfer credits | January 2027 TESU target"]);
  cover.addRow([null, "CURRENT STATUS — FINAL EXECUTION VERSION — 25 AUG 2026"]);

  const cards = wb.addWorksheet("02_COURSES");
  cards.addRow(["LOCKED COURSE CARDS — 18 COURSES / 54 CREDITS"]);
  cards.addRow(["Final execution version: 13 Sophia + 5 Study.com."]);
  cards.addRow(["Wk", "Provider", "Course", "Code", "Cr", "Slot", "Level", "Challenges / Chapters", "Milestones / Final", "Assignments", "How to finish this course", "Done when"]);
  RUT_SOPHIA.forEach((s, i) =>
    cards.addRow([i + 1, "Sophia", s.course, `SOPH-${String(i + 5).padStart(4, "0")}`, 3, "Elective", "LL", `${s.challenges} Challenges`, `${s.milestones} Milestones (incl. Final)`, "0 Touchstones", "Full 7-day block.", "70% posted"]),
  );
  RUT_STUDY.forEach((s) =>
    cards.addRow([`${s.weeks[0]}–${s.weeks[1]}`, "Study.com", s.course, s.code, 3, "AOS UL", "UL — NCCRS", "11 content chapters + assignment chapter", s.course.startsWith("Business 310") ? "Chapter tests; no final in current grading structure" : "Chapter tests + final", `${s.assignments} ${s.assignments === 1 ? "paper" : "papers"}`, s.plan, "Written TESU mapping confirms UL + AOS fit"]),
  );

  const weekly = wb.addWorksheet("03_WEEKLY");
  weekly.addRow(["13-WEEK EXECUTION | 1 SEP – 30 NOV 2026 | SOPHIA + STUDY.COM ACTIVE"]);
  weekly.addRow(["One Sophia course at a time + maximum two Study.com courses."]);
  weekly.addRow(["Wk", "Dates", "Sophia course — this week’s order", "Sophia target", "Study.com focus", "Study.com this week — exact work", "Paper due", "SDC exam", "Hours", "Status"]);
  const paperDue: Record<number, string> = { 2: "Psych 310 A1 — 12 Sep", 3: "Soc 305 A1 — 20 Sep", 4: "Soc 305 A2 — 26 Sep", 6: "CJ 305 A1 — 10 Oct", 7: "CJ 305 A2 — 13 Oct", 8: "Psych 312 A1 — 25 Oct", 9: "Psych 312 A2 — 30 Oct", 11: "Business 310 A1 — 15 Nov", 12: "Business 310 A2 — 19 Nov" };
  const sdcExam: Record<number, string> = { 3: "Psych 310 — 15 Sep", 5: "Soc 305 — 30 Sep", 7: "CJ 305 — 16 Oct", 10: "Psych 312 — 3 Nov", 11: "No final", 12: "No final — grade post by 23 Nov" };
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = (iso: string, dow: string) => `${dow} ${Number(iso.slice(8))} ${monthName[Number(iso.slice(5, 7)) - 1]}`;
  for (let wk = 1; wk <= 13; wk++) {
    const s = addDays("2026-09-01", (wk - 1) * 7);
    weekly.addRow([wk, `${fmt(s, "Tue")} – ${fmt(addDays(s, 6), "Mon")}`, `OPEN ${RUT_SOPHIA[wk - 1]!.course}.`, "Finish by Monday.", "Study.com lane", "Chapters as you go.", paperDue[wk] ?? "—", sdcExam[wk] ?? "—", "22–26", "PLANNED"]);
  }

  // Reconstructed sheet: key dates (orientation, graduation application, conferral).
  const dates = wb.addWorksheet("Key Dates");
  dates.addRow(["KEY DATES"]);
  dates.addRow(["Date", "Milestone", "Type"]);
  dates.addRow([d("2026-08-31"), "Orientation", "Milestone"]);
  dates.addRow([d("2027-03-15"), "Apply for graduation", "Milestone"]);
  dates.addRow([d("2027-04-30"), "Degree conferral", "Milestone"]);
  return { fileName: "rut-execution.xlsx", buffer: await toBuffer(wb) };
}

export async function buildAllS07(): Promise<WorkbookFile[]> {
  return [
    await buildEphMaster(1),
    await buildEphExecution(1),
    await buildEphMaster(2),
    await buildEphExecution(2),
    await buildRutMaster(),
    await buildRutExecution(),
  ];
}
