/**
 * Builds docs/templates/lumiere-roadmap-v1.xlsx — the reference workbook staff fill in.
 * Run: npx tsx scripts/s05/build-roadmap-template.ts
 * Example rows start with "#"; the importer treats such rows as comments (delete the "#" to use a row).
 */
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, "../../docs/templates/lumiere-roadmap-v1.xlsx");

const wb = new ExcelJS.Workbook();
wb.creator = "Lumière";
wb.created = new Date(Date.UTC(2026, 0, 1));
wb.modified = new Date(Date.UTC(2026, 0, 1));

function styleHeader(ws: ExcelJS.Worksheet, requiredCols: number[]) {
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.eachCell((cell, col) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: requiredCols.includes(col) ? "FFFDE9B8" : "FFE8EEF5" } };
    cell.border = { bottom: { style: "thin" } };
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
}
function styleComment(ws: ExcelJS.Worksheet, rowNumber: number) {
  ws.getRow(rowNumber).font = { italic: true, color: { argb: "FF7A7A7A" } };
}

// How to use
const how = wb.addWorksheet("How to use");
how.columns = [{ width: 110 }];
[
  "Lumière roadmap workbook — template lumiere-roadmap-v1",
  "",
  "1. Fill the Plan sheet: one row per roadmap item (course, exam, application). Required columns are shaded gold: Phase and Title.",
  "2. Rows whose first cell starts with # are comments and are ignored. Delete the # from an example row to use it.",
  "3. Phases come from the Phase column, in order of first appearance. Give every item a Plan Key (e.g. bio-101) so progress stays attached if you rename or reorder rows.",
  "4. Task counts (Challenges, Touchstones, Papers, Quizzes, Exams, Assignments, Milestones) generate tasks such as challenge-1 .. challenge-N.",
  "5. Dates: Excel dates, YYYY-MM-DD, M/D/YYYY or \"Mon YYYY\" (first of the month).",
  "6. Objectives, Milestones and About sheets are optional. Without an Objectives sheet the plan has one primary degree objective.",
  "7. Upload the file in Admin > Student > Roadmap. Nothing is published automatically: you review exceptions, preview, then publish.",
  "",
  "Credit and acceptance are never taken from this workbook. They come only from the student's verified academic record.",
  "Column names are not case sensitive and common aliases are accepted (see lumiere-roadmap-v1.md).",
].forEach((line, i) => {
  const r = how.addRow([line]);
  if (i === 0) r.font = { bold: true, size: 14 };
  r.alignment = { wrapText: true, vertical: "top" };
});

// Plan
const plan = wb.addWorksheet("Plan");
const planHeaders = [
  "Phase", "Objective", "Seq", "Plan Key", "Code", "Title", "Provider", "Institution", "Credits", "Start", "End",
  "Depends On", "Status", "Hold Reason", "Approval", "Alternative For", "Challenges", "Milestones", "Touchstones",
  "Papers", "Quizzes", "Exams", "Assignments", "Tasks", "Kind", "Student Note", "Staff Note", "Condition",
];
plan.addRow(planHeaders);
plan.addRow(["# Phase 1 - Foundation", "BS Biology", 1, "bio-101", "BIO 101", "Introduction to Biology", "Sophia", "Example University", 3, new Date(Date.UTC(2026, 0, 12)), new Date(Date.UTC(2026, 1, 20)), "", "Planned", "", "", "", 5, "", 3, "", "", 1, "", "", "Course", "Start with the first challenge.", "Example row - delete the # to use", ""]);
styleHeader(plan, [1, 6]);
styleComment(plan, 2);
plan.columns = planHeaders.map((h) => ({ width: Math.max(12, h.length + 4) }));
plan.getColumn(6).width = 36;
plan.getColumn(10).numFmt = "yyyy-mm-dd";
plan.getColumn(11).numFmt = "yyyy-mm-dd";

// Objectives
const obj = wb.addWorksheet("Objectives");
const objHeaders = ["Key", "Title", "Kind", "Institution", "Credential", "Status", "Note"];
obj.addRow(objHeaders);
obj.addRow(["# bs-biology", "BS Biology", "Primary", "Example University", "Bachelor of Science", "Active", "Example row - the first Primary objective is the assigned degree"]);
styleHeader(obj, [2]);
styleComment(obj, 2);
obj.columns = objHeaders.map((h) => ({ width: Math.max(16, h.length + 6) }));

// Milestones
const ms = wb.addWorksheet("Milestones");
const msHeaders = ["Key", "Title", "Kind", "Target Date", "Objective", "After"];
ms.addRow(msHeaders);
ms.addRow(["# foundation-done", "Foundation complete", "Checkpoint", new Date(Date.UTC(2026, 5, 30)), "bs-biology", "bio-101"]);
styleHeader(ms, [2]);
styleComment(ms, 2);
ms.columns = msHeaders.map((h) => ({ width: Math.max(16, h.length + 8) }));
ms.getColumn(4).numFmt = "yyyy-mm-dd";

// About
const about = wb.addWorksheet("About");
about.addRow(["Label", "Value"]);
about.addRow(["# Plan Title", "Example: Roadmap for Jane Doe"]);
about.addRow(["# Summary", "Short text shown to the student at the top of the roadmap."]);
about.addRow(["# Primary Degree", "BS Biology"]);
about.addRow(["# Institution", "Example University"]);
styleHeader(about, []);
for (let r = 2; r <= 5; r++) styleComment(about, r);
about.columns = [{ width: 24 }, { width: 80 }];

mkdirSync(dirname(outFile), { recursive: true });
await wb.xlsx.writeFile(outFile);
console.log(`wrote ${outFile}`);
