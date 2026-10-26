/**
 * S10 de-identified workbook builders: layouts VERIFIED against the original EPH / RUT workbooks.
 *
 * Student labels "Student EPH-2" / "Student RUT-2"; invented rows; public catalog course names only. Nothing here is copied
 * from a real file. What mirrors a real layout (verified from the originals) is listed in README.md under "S10".
 */
import ExcelJS from "exceljs";
import { crc32 as zlibCrc32 } from "node:zlib";
import { newWorkbook, toBuffer, type WorkbookFile } from "./builders";

const d = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

const MASTER_HEADERS = [
  "Seq", "Requirement Block", "TESU Requirement", "Course", "Provider", "Credits", "Level", "Completed / Remaining", "Degree Placement",
  "Writing / Assignment Burden", "Exam Type", "Prerequisite / Sequence Note", "CPA Accounting?", "CPA Business?", "Status", "Notes",
];
interface MOpts {
  done?: boolean;
  burden?: string;
  exam?: string;
  seqNote?: string;
  notes?: string;
  cpaAcc?: boolean;
  cpaBus?: boolean;
}
/** one ledger row without the Seq column */
const mrow = (block: string, req: string, course: string, provider: string, status: string, o: MOpts = {}): (string | number)[] => [
  block, req, course, provider, 3, "LL", o.done ? "Completed" : "Remaining", block, o.burden ?? "", o.exam ?? "—", o.seqNote ?? "", o.cpaAcc ? "Yes" : "No", o.cpaBus ? "Yes" : "No", status, o.notes ?? "",
];

/** Ledger sheet in the real layout: title + note row, header on row 4, TOTAL / control-note / footer rows MERGED across columns. */
function mergedLedger(wb: ExcelJS.Workbook, name: string, title: string, rows: (string | number)[][], totalLabel: string): void {
  const ws = wb.addWorksheet(name);
  ws.addRow([title]);
  ws.addRow(["Control note: a sentence that spans the whole sheet width."]);
  ws.addRow([]);
  ws.addRow(MASTER_HEADERS);
  rows.forEach((r, i) => ws.addRow([i + 1, ...r]));
  const totalRow = ws.rowCount + 2;
  ws.getRow(totalRow).getCell(1).value = totalLabel;
  ws.mergeCells(totalRow, 1, totalRow, 5); // real TOTAL rows: label merged over Seq..Provider
  ws.getRow(totalRow).getCell(6).value = rows.length * 3;
  const noteRow = totalRow + 2;
  ws.getRow(noteRow).getCell(1).value = "CONTROL: a merged sentence under the table. Do not retake any course on this sheet.";
  ws.mergeCells(noteRow, 1, noteRow, 16);
  const footRow = noteRow + 2;
  ws.getRow(footRow).getCell(1).value = "Prepared exclusively for Student EPH-2 by Lumière · Confidential";
  ws.mergeCells(footRow, 1, footRow, 16);
}

/**
 * "Locked master" family (real: 14 sheets, packaged with an `x:` namespace prefix): summary sheet, completed ledger,
 * degree-block ledgers, a 0-credit "Do not take" backup, execution order. Variant 2 swaps Business 103 for Business 308.
 */
export async function buildS10LockedMaster(variant: 1 | 2 = 1): Promise<WorkbookFile> {
  const wb = newWorkbook();
  const sm = wb.addWorksheet("Master Plan");
  sm.addRow([null, "STUDENT EPH-2 · TESU BSBA IN ACCOUNTING · WASHINGTON CPA"]);
  sm.addRow([null, "PREFERRED PATH · 12 earned · 27 remaining · 39 total"]);
  sm.addRow([]);
  sm.addRow([null, "Primary degree", "TESU BSBA in Accounting"]);
  sm.addRow([null, "CPA jurisdiction", "Washington State"]);
  const done = { done: true } as const;
  mergedLedger(wb, "Completed Credits", "COMPLETED CREDITS · 12 CREDITS ALREADY EARNED", [
    mrow("General Education", "Written Communication I", "English Composition I", "Sophia", "Done", done),
    mrow("General Education", "Quantitative Literacy", "College Algebra", "Sophia", "Done", done),
    mrow("Professional Business", "Principles of Finance", "Principles of Finance", "Sophia", "Watch", { ...done, notes: "WATCH — confirm placement" }),
    mrow("Professional Business", "Macroeconomics", "Macroeconomics", "Dallas College", "Done", done),
  ], "COMPLETED TOTAL (must equal 12)");
  const bus = variant === 1 ? "Business 103 — Business Law" : "Business 308 — International Management";
  const busReq = variant === 1 ? "Business Law" : "International Management";
  mergedLedger(wb, "General Education", "GENERAL EDUCATION · 9 CREDITS", [
    mrow("General Education", "Civic & Global Leadership", "U.S. Government / American Government", "Sophia", "To take", { exam: "Sophia milestones", burden: "Sophia milestones; confirm live shell" }),
    mrow("General Education", "Oral Communication", "COM-2090 Public Speaking", "TESU TECEP", "To take", { exam: "TECEP exam", burden: "Exam-based TECEP" }),
    mrow("General Education", "Information Literacy", "SOS-1100 Fact, Fiction, or Fake?", "TESU Online", "To take", { exam: "TESU course", burden: "Writing-heavy TESU course (discussions + papers)" }),
  ], "GENERAL EDUCATION TOTAL");
  mergedLedger(wb, "Business Core", "PROFESSIONAL BUSINESS · 15 CREDITS", [
    mrow("Professional Business", "Computer Concepts", "Introduction to Information Technology", "Sophia", "To take", { burden: "1 Touchstone in current Sophia shell", exam: "Sophia milestones/final", cpaBus: true }),
    mrow("Professional Business", busReq, bus, "Study.com", "To take", { burden: "Study.com chapter tests + 1 required assignment", exam: "Open-book chapter tests / final", cpaBus: true }),
    mrow("Professional Business", "Principles of Management", "MAN-2100 Principles of Management", "TESU e-Pack", "To take", { exam: "e-Pack final (CR/NC)", cpaBus: true }),
    mrow("Professional Business", "Quantitative Skills for Business", "CSM Learn — Quantitative Skills for Business", "CSM Learn", "Working", { seqNote: "WORKING — strong route", notes: "Keep TESU BUS-2100 only as fallback if the advisor declines placement.", cpaBus: true }),
    mrow("Professional Business", "Managerial Communications", "Business Communication", "Sophia", "To take", { burden: "Verify current Touchstones", exam: "Sophia milestones/final", cpaBus: true }),
  ], "BUSINESS CORE TOTAL");
  mergedLedger(wb, "Accounting AOS", "ACCOUNTING AREA OF STUDY · 9 CREDITS", [
    mrow("Accounting AOS", "ACC-2010 Intermediate Accounting I", "Accounting 201 — Intermediate Financial Accounting I", "Study.com", "To take", { burden: "1 required assignment + chapter tests", exam: "Open-book, unproctored final", cpaAcc: true }),
    mrow("Accounting AOS", "ACC-4210 Federal Income Taxation", "ACC-4210 Federal Income Taxation", "TESU TECEP", "To take", { exam: "TECEP exam", cpaAcc: true }),
    mrow("Accounting AOS", "ACC-4110 Auditing", "ACC-4110 Auditing", "TESU Online", "To take", { exam: "TESU course", cpaAcc: true, seqNote: "Counts toward the TESU residency block." }),
  ], "ACCOUNTING AOS TOTAL");
  mergedLedger(wb, "Coopersmith Plan", "COOPERSMITH · 0 CREDITS · NOT USED IN CURRENT DEFAULT", [
    ["Accounting AOS", "ACC-4210 Federal Income Taxation", "ACC-352 Federal Taxation of Business Entities", "Coopersmith", 0, "—", "Remaining", "Backup only", "Not in current plan", "—", "Replaced by TESU ACC-4210 TECEP.", "No", "No", "Do not take", "Removed from default."],
  ], "COOPERSMITH TOTAL (must equal 0)");
  const ws = wb.addWorksheet("Execution Order");
  ws.addRow(["EXECUTION ORDER · FOLLOW THIS SEQUENCE"]);
  ws.addRow(["Control note."]);
  ws.addRow([]);
  ws.addRow(["Seq", "Phase", "Step", "Course / action", "Provider", "Credits", "Why this order", "Status", "Notes", "Done?"]);
  const order: [string, string, number, string][] = [
    ["Phase 1 — External", "U.S. Government / American Government", 3, "Sophia"],
    ["Phase 1 — External", "Introduction to Information Technology", 3, "Sophia"],
    ["Phase 1 — External", "Business Communication", 3, "Sophia"],
    ["Phase 1 — External", bus, 3, "Study.com"],
    ["Phase 1 — External", "Accounting 201 — Intermediate Financial Accounting I", 3, "Study.com"],
    ["Phase 1 — External", "CSM Learn — Quantitative Skills for Business", 3, "CSM Learn"],
    ["Phase 2 — TECEP", "COM-2090 Public Speaking", 3, "TESU TECEP"],
    ["Phase 2 — TECEP", "ACC-4210 Federal Income Taxation", 3, "TESU TECEP"],
    ["Phase 3 — TESU residency", "SOS-1100 Fact, Fiction, or Fake?", 3, "TESU Online"],
    ["Phase 3 — TESU residency", "MAN-2100 Principles of Management", 3, "TESU e-Pack"],
    ["Phase 3 — TESU residency", "ACC-4110 Auditing", 3, "TESU Online"],
    ["Phase 4 — Finish", "TESU graduation filing / conferral", 0, "TESU"],
  ];
  order.forEach((o, i) => ws.addRow([i + 1, o[0], i + 1, o[1], o[3], o[2], "", "To take", "", "No"]));
  return { fileName: `s10-locked-master-v${variant}.xlsx`, buffer: await toBuffer(wb) };
}

/**
 * Execution workbook in the REAL EPH layout (9 sheets in the original): a weekly lane grid (Wk, Dates "Sep 14–Sep 20, 2026",
 * Phase, Course A/B/C, Due this week, Hours, Status, Checkpoint) whose lanes hold free text "Kind · work"; provider trackers
 * with several tables per sheet (section titles above, spacer rows between a header and its first row, "Finish target"
 * dates); a completed-credits sheet that must NOT be imported; a residency sheet with blank "paste live dates" mini-tables;
 * a hub with "Constant | Value" and "Checkpoint | When" tables. Variant 2 moves one Study.com finish target and the
 * ACC-4210 exam date.
 */
export async function buildS10EphExecution(variant: 1 | 2 = 1): Promise<WorkbookFile> {
  const wb = newWorkbook();
  wb.addWorksheet("COCKPIT").addRows([[], [null, "COCKPIT · THE WHOLE PICTURE"], [], [null, "EARNED", null, "LEFT TO EARN"], [null, 12, null, 27]]);
  const wk = wb.addWorksheet("WEEK BY WEEK");
  wk.addRow([]);
  wk.addRow(["WEEK BY WEEK · FOLLOW THIS SEQUENCE"]);
  wk.addRow(["Always two live courses. Plan start Sep 14, 2026."]);
  wk.addRow(["Wk", "Dates", "Phase", "Course A", "Course B", "Course C", "Due this week", "Hours", "Status", "Checkpoint"]);
  const weeks: [string, string, string, string, string, string, string][] = [
    ["Sep 14–Sep 20, 2026", "External · start", "Quiz · Sophia U.S. Government — open Challenges (required first).", "Stretch quiz · Sophia Intro to IT — add only if Government is moving.", "Paper · Study.com Business 103 Ch. 1–7. No TESU application.", "Gov + Bus 103 open.", ""],
    ["Sep 21–Sep 27, 2026", "External · GE", "Quiz · Finish Government Challenges / Milestones.", "Quiz · Intro to IT — now a full course, not a stretch.", "Paper · Business 103 remaining chapters.", "Gov Touchstone", ""],
    ["Sep 28–Oct 4, 2026", "External · GE", "Quiz · Government posted 70%+ or Waiting on grade.", "Quiz · Intro to IT Touchstone.", "Paper · Finish Business 103 + final.", "Government posted · Bus 103 grade", "Checkpoint 1"],
    ["Oct 5–Oct 11, 2026", "External · systems", "Quiz · Open CSM Learn — Quantitative Skills.", "Quiz · Second quiz course.", "Paper · Open Acc 201. Chapters 1–5.", "", ""],
    ["Oct 12–Oct 18, 2026", "External · systems", "Quiz · CSM Learn continue.", "Quiz · Second quiz course only.", "Paper · Accounting 201 Intermediate I — Assignment 1.", "Acc 201 Assignment 1", ""],
    ["Oct 19–Oct 25, 2026", "External · systems", "Exam · COM-2090 Public Speaking — sit when ready.", "Paper · Finish Acc 201 assignment + final.", "Closed · Do not open Acc 202 until Acc 201 shows Done.", "Acc 201 final / Waiting on grade", ""],
    ["Oct 26–Nov 1, 2026", "External · systems", "Quiz · Open Sophia Business Communication (Touchstones).", "Paper · Open Business 777 chapters.", "Admin · Send transcripts.", "", ""],
    ["Dec 28–Jan 3, 2027", "TESU W1", "TESU-write · SOS-1100 orientation + Discussion 1.", "Quiz · e-Pack quizzes.", "TESU-write · ACC-4110 module 1 + midterm window — schedule now.", "SOS D1", ""],
    ["Jan 4–Jan 10, 2027", "TESU W2", "TESU-write · SOS-1100 final project submit.", "Exam · Take MAN-2100 e-Pack if ready.", "TESU-write · ACC-4110 final.", "Audit final", ""],
    ["Jan 11–Jan 17, 2027", "Admin", "Send official Sophia, CSM transcripts.", "Request MyProgress rerun.", "No new courses.", "Transcripts sent", "Checkpoint 2"],
  ];
  weeks.forEach((w, i) => wk.addRow([i + 1, w[0], w[1], w[2], w[3], w[4], w[5], "20–24", "Not Started", w[6]]));
  wk.addRow([]);
  wk.addRow(["Footer note."]);

  const ext = wb.addWorksheet("EXTERNAL TRACKER");
  ext.addRow([]);
  ext.addRow(["EXTERNAL TRACKER · SOPHIA + STUDY.COM + CSM"]);
  ext.addRow(["One tab for all non-TESU remaining courses."]);
  ext.addRow([]);
  ext.addRow(["SOPHIA · 3 COURSES · 9 NEW CREDITS"]);
  ext.addRow(["Course", "Load", "TESU / CPA", "Cr", "Challenges", "Done", "Milestones", "Done", "Touchstones", "Done", "Score %", "Status", "Link", "Target %"]);
  ext.addRow(["U.S. Government", "Paper if Touchstone open, else Quiz", "GE Civic · POS-1100", 3, 17, null, 5, null, 2, null, null, null, "Open", 70]);
  ext.addRow(["Intro to Information Technology", "Paper if Touchstone open, else Quiz", "PBR CIS-1070 · CPA Business", 3, 15, null, 5, null, 1, null, null, null, "Open", 70]);
  ext.addRow(["Business Communication", "Paper", "PBR COM-2020 · CPA Business", 3, 12, null, 5, null, 2, null, null, null, "Open", 70]);
  ext.addRow(["Sophia block"]);
  ext.addRow([]);
  ext.addRow(["STUDY.COM · 2 COURSES · 6 CREDITS"]);
  ext.addRow(["Course", "Load", "TESU / CPA", "Cr", "Ch.", "Ch. done", "Papers", "Papers done", "Has final?", "Grade posted?", null, "Status", "Link", "Finish target"]);
  ext.addRow([]);
  ext.addRow([]);
  ext.addRow(["Business 103 — Business Law", "Paper if assignment exists, else Quiz", "LAW-2010 · CPA Business", 3, 14, null, 1, null, "Yes", "No", null, null, "Open", variant === 1 ? "Oct 4, 2026" : "Oct 11, 2026"]);
  ext.addRow(["Accounting 201 — Intermediate I", "Paper", "ACC-2010 AOS · CPA Accounting", 3, 12, null, 1, null, "Yes", "No", null, null, "Open", "Nov 1, 2026"]);
  ext.addRow(["Study.com block"]);
  ext.addRow([]);
  ext.addRow(["CSM LEARN · BUS-2100 WORKING ROUTE · QUIZ SLOT"]);
  ext.addRow(["Course", "Load", "TESU / CPA", "Cr", "Preplan sent?", "Started?", "Certificate?", "Credit posted?", null, null, null, "Status", "Link"]);
  ext.addRow(["CSM Learn — Quantitative Skills", "Quiz", "BUS-2100 PBR · CPA Business", 3, "No", "No", "No", "No", null, null, null, null, "Open CSM"]);

  const tec = wb.addWorksheet("TECEP TRACKER");
  tec.addRow([]);
  tec.addRow(["TECEP TRACKER · 6 CREDITS · FIRST EXAM WEEK = NOV 2"]);
  tec.addRow(["No TESU course registration until November TECEPs."]);
  tec.addRow(["Course", "Load", "Lvl", "Cr", "TESU / CPA", "Registered?", "Studying?", "Exam date", "Taken?", "Score", "Credit posted?", "Status", "Link"]);
  tec.addRow(["COM-2090 Public Speaking", "Speech", "LL", 3, "GE Oral", "No", "No", null, "No", null, "No", null, "TESU page"]);
  tec.addRow(["ACC-4210 Federal Income Taxation · LAST", "Exam", "UL", 3, "AOS Tax · CPA Accounting", "No", "No", d(variant === 1 ? "2027-01-12" : "2027-01-19"), "No", null, "No", null, "TESU page"]);
  tec.addRow([]);
  tec.addRow(["TECEP TOTAL"]);

  const res = wb.addWorksheet("TESU RESIDENCY");
  res.addRow([]);
  res.addRow(["TESU RESIDENCY · 9 CREDITS · JAN 2027 TERM"]);
  res.addRow(["Register all three before the term."]);
  res.addRow(["Course", "Format", "Cr", "TESU / CPA", "Registered?", "Studying?", "Exam / paper date", "Result", "Credit posted?", "Status", "Workload", "Link"]);
  res.addRow(["SOS-1100 Fact, Fiction, or Fake?", "TESU Online", 3, "GE Information Literacy", "No", "No", null, null, "No", "Not Started", "TESU-write", "TESU"]);
  res.addRow(["MAN-2100 Principles of Management", "e-Pack", 3, "PBR Management · CPA Business", "No", "No", null, null, "No", "Not Started", "Quiz + proctored exam", "TESU"]);
  res.addRow(["ACC-4110 Auditing", "TESU Online", 3, "AOS Audit · CPA Accounting", "No", "No", null, null, "No", "Not Started", "HIGH-LOAD TESU-write + exams", "TESU"]);
  res.addRow([]);
  res.addRow(["SOS-1100 · PASTE LIVE DATES"]);
  res.addRow(["#", "Type", "Title", "Due", "Submitted?", "Score", "Status", "Notes"]);
  res.addRow(["D1", "Discussion", null, null, "No"]);
  res.addRow(["W1", "Written", null, null, "No"]);

  const comp = wb.addWorksheet("COMPLETED CREDITS");
  comp.addRow([]);
  comp.addRow(["COMPLETED CREDITS · 12 ALREADY EARNED · READ ONLY"]);
  comp.addRow(["These courses are done. Do not retake."]);
  comp.addRow(["#", "Course", "Provider", "Cr", "TESU bucket", "CPA tag", "Status", "Note"]);
  comp.addRow([1, "English Composition I", "Sophia", 3, "GE Written 1", "—", "Done", ""]);
  comp.addRow([2, "College Algebra", "Sophia", 3, "GE Quantitative", "—", "Done", ""]);
  comp.addRow([3, "Principles of Finance", "Sophia", 3, "PBR Finance", "CPA Business", "Done", "WATCH"]);
  comp.addRow([4, "Macroeconomics", "Dallas College", 3, "PBR ECO-1110", "CPA Business", "Done", ""]);

  const hub = wb.addWorksheet("LUMIÈRE HUB");
  hub.addRow([]);
  hub.addRow([null, "LUMIÈRE HUB · DATES, SCOREBOARD, CHECKPOINTS"]);
  hub.addRow([]);
  hub.addRow([null, "DATES · LUMIÈRE ADJUSTS THE YELLOW CELLS"]);
  hub.addRow([null, "Constant", "Value", "Note"]);
  hub.addRow([null, "Plan start (Week 1 Monday)", "2026-09-14", "External work begins"]);
  hub.addRow([null, "TECEP gate", "2026-11-02", "No TECEP before this Monday"]);
  hub.addRow([null, "TESU term start", "2027-01-04", "January term"]);
  hub.addRow([null, "Working conferral", "2027-05-01", "Next cycle — confirm"]);
  hub.addRow([]);
  hub.addRow([null, "COACHING CHECKPOINTS"]);
  hub.addRow([null, "Checkpoint", "When", "Success looks like", "Share with Lumière", "Status"]);
  hub.addRow([null, "1 · Pre-TECEP", "End of Week 7 (Nov 1)", "Government and History moving or done.", "Tracker screenshot", "Open"]);
  hub.addRow([null, "2 · Term end", "Jan 31, 2027", "Residency complete.", "Transcript", "Open"]);
  hub.addRow([]);
  hub.addRow([null, "Student EPH-2 · Lumière · Version 2.0 · 2026-09-09"]);
  return { fileName: `s10-eph-execution-v${variant}.xlsx`, buffer: await toBuffer(wb) };
}

/**
 * RUT-style 3-month tracker workbook (the real RUT files have NO degree-architecture sheet): START HERE, WEEK BY WEEK
 * ("Week", "Dates" like "Sep 1–7" with no year, lanes "Sophia — finish this week" / "Study.com — this week", newline-separated
 * "Due this week" such as "Psych 310 final — Sep 15"), SOPHIA TRACKER and STUDY.COM TRACKER with a second "Due | Course |
 * Assignment" table, and a DASHBOARD of chart data (ignored). Variant 2: one more Physics milestone, a moved finish target
 * and a moved assignment date.
 */
export async function buildS10RutTracker(variant: 1 | 2 = 1): Promise<WorkbookFile> {
  const wb = newWorkbook();
  const sh = wb.addWorksheet("START HERE");
  sh.addRow([null, "STUDENT RUT-2 — 3-MONTH DEGREE COMPLETION PLAN"]);
  sh.addRow([null, "Start September 1, 2026 • Finish transfer work by November 30"]);
  sh.addRow([]);
  sh.addRow([null, "5 SIMPLE RULES"]);
  sh.addRow([null, 1, "Follow WEEK BY WEEK in order."]);
  const wk = wb.addWorksheet("WEEK BY WEEK");
  wk.addRow(["WEEK BY WEEK — FOLLOW THIS IN ORDER"]);
  wk.addRow(["This page tells you what to do now."]);
  wk.addRow([]);
  wk.addRow(["Week", "Dates", "Sophia — finish this week", "Study.com — this week", "Due this week", "Hours", "Status"]);
  wk.addRow([1, "Sep 1–7", "Introduction to Statistics", "Psych 310: Chapters 1–6.", "—", "22–26", "Not Started"]);
  wk.addRow([2, "Sep 8–14", "Macroeconomics", "Psych 310: Chapters 7–11. Open Soc 305 after Psych 310 A1.", "Psych 310 A1 — Sep 12", "20–24", "Not Started"]);
  wk.addRow([3, "Sep 15–21", "Introduction to Physics only if Lumière confirms it; otherwise use Lumière's replacement.", "Psych 310 final. Soc 305: Chapters 3–7.", variant === 1 ? "Psych 310 final — Sep 15\nSoc 305 A1 — Sep 20" : "Psych 310 final — Sep 16\nSoc 305 A1 — Sep 20", "22–26", "Not Started"]);
  wk.addRow([4, "Sep 22–28", "No new Sophia course.", "Finish Soc 305.", variant === 1 ? "Soc 305 A2 — Sep 26" : "Soc 305 A2 — Sep 27", "20–24", "Not Started"]);
  const so = wb.addWorksheet("SOPHIA TRACKER");
  so.addRow(["SOPHIA TRACKER — 3 COURSES / 9 CREDITS"]);
  so.addRow(["ZERO PAPERS TO WRITE • ZERO TOUCHSTONES"]);
  so.addRow(["Enter only the yellow cells."]);
  so.addRow([]);
  so.addRow(["Course", "Challenges", "Done", "Milestones (timed tests)", "Done", "Overall Score %", "Status"]);
  so.addRow(["Introduction to Statistics", 20, null, 6, null, null, "Not Started"]);
  so.addRow(["Macroeconomics", 10, null, 5, null, null, "Not Started"]);
  so.addRow(["Introduction to Physics", 18, null, variant === 1 ? 7 : 8, null, null, "Not Started"]);
  so.addRow([]);
  so.addRow(["SPECIAL NOTES: Do not start Physics unless Lumière confirms it."]);
  const st = wb.addWorksheet("STUDY.COM TRACKER");
  st.addRow(["STUDY.COM TRACKER — 2 COURSES / 6 UPPER-LEVEL CREDITS"]);
  st.addRow(["3 WRITTEN ASSIGNMENTS TOTAL"]);
  st.addRow(["Enter only the yellow cells."]);
  st.addRow([]);
  st.addRow(["Course", "Chapters", "Done", "Papers", "Done", "Final / Finish Target", "Status"]);
  st.addRow(["Psychology 310", 11, null, 1, null, variant === 1 ? "Sep 15" : "Sep 16", "Not Started"]);
  st.addRow(["Sociology 305", 10, null, 2, null, "Sep 30", "Not Started"]);
  st.addRow([]);
  st.addRow(["ASSIGNMENTS — COMPLETE IN THIS ORDER", null, null, null, null, "FINALS / FINISH DATES"]);
  st.addRow(["Due", "Course", "Assignment", "Done?", null, "Course", "Target"]);
  st.addRow(["Sep 12", "Psychology 310", "Assignment 1", null, null, "Psychology 310", variant === 1 ? "Sep 15" : "Sep 16"]);
  st.addRow(["Sep 20", "Sociology 305", "Assignment 1", null, null, "Sociology 305", "Sep 30"]);
  st.addRow([variant === 1 ? "Sep 26" : "Sep 27", "Sociology 305", "Assignment 2"]);
  const db = wb.addWorksheet("DASHBOARD");
  db.addRow(["PROGRESS DASHBOARD", null, null, null, null, "DASHBOARD DATA"]);
  db.addRow([null, null, null, null, null, "Program Start", "2026-09-01"]);
  db.addRow([null, null, null, null, null, "Program End", "2026-11-30"]);
  db.addRow([]);
  db.addRow(["Prepared exclusively for Student RUT-2 by Lumière · Confidential · Version 3.5 · Reviewed Aug 28, 2026"]);
  return { fileName: `s10-rut-tracker-v${variant}.xlsx`, buffer: await toBuffer(wb) };
}

// ── a package written with a namespace PREFIX (`<x:workbook>`), as the real locked master is ────────────────────────────

function zipStored(entries: [string, string][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const c = zlibCrc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(c, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(c, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const colName = (i: number): string => String.fromCharCode(65 + i);

/** An .xlsx whose parts all use the `x:` namespace prefix, with shared strings (ExcelJS cannot load these). */
export function buildS10PrefixedWorkbook(sheets: { name: string; rows: (string | number | null)[][] }[]): Buffer {
  const strings: string[] = [];
  const sid = (t: string): number => {
    const i = strings.indexOf(t);
    if (i >= 0) return i;
    strings.push(t);
    return strings.length - 1;
  };
  const NS = 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const sheetXml = sheets.map((s) => {
    const rows = s.rows
      .map((r, ri) => {
        const cells = r
          .map((v, ci) => {
            if (v === null) return "";
            const ref = `${colName(ci)}${ri + 1}`;
            return typeof v === "number" ? `<x:c r="${ref}"><x:v>${v}</x:v></x:c>` : `<x:c r="${ref}" t="s"><x:v>${sid(v)}</x:v></x:c>`;
          })
          .join("");
        return `<x:row r="${ri + 1}">${cells}</x:row>`;
      })
      .join("");
    return `<?xml version="1.0" encoding="utf-8"?><x:worksheet ${NS}><x:sheetData>${rows}</x:sheetData></x:worksheet>`;
  });
  const entries: [string, string][] = [
    ["[Content_Types].xml", '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>'],
    ["_rels/.rels", '<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml" Id="R1"/></Relationships>'],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="utf-8"?><x:workbook ${NS}><x:sheets>${sheets.map((s, i) => `<x:sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>`).join("")}</x:sheets></x:workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml" Id="rId${i + 1}"/>`).join("")}</Relationships>`],
    ...sheetXml.map((x, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, x]),
  ];
  entries.push(["xl/sharedStrings.xml", `<?xml version="1.0" encoding="utf-8"?><x:sst ${NS}>${strings.map((t) => `<x:si><x:t xml:space="preserve">${esc(t)}</x:t></x:si>`).join("")}</x:sst>`]);
  return zipStored(entries);
}

export async function buildAllS10(): Promise<WorkbookFile[]> {
  return [
    await buildS10LockedMaster(1),
    await buildS10LockedMaster(2),
    await buildS10EphExecution(1),
    await buildS10EphExecution(2),
    await buildS10RutTracker(1),
    await buildS10RutTracker(2),
  ];
}
