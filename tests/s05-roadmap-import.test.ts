import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { convertImportPackage, convertWorkbook } from "../server/services/roadmap-import";

type Sheets = Record<string, unknown[][]>;

async function book(sheets: Sheets): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    for (const r of rows) ws.addRow(r as ExcelJS.CellValue[]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const byCode = (r: { exceptions: readonly { code: string }[] }, code: string) => r.exceptions.filter((e) => e.code === code);

describe("lumiere-roadmap-v1 workbook adapter", () => {
  it("converts a basic plan with header aliases, phases by first appearance and default objective", async () => {
    const buf = await book({
      Roadmap: [
        ["STAGE", "Course Code", "course-title", "Cr", "Order", "Key"],
        ["Foundation", "BIO 101", "Intro Biology", "3.0", 1, "bio-101"],
        ["Foundation", "CHM 101", "Intro Chemistry", 4, 2, "chm-101"],
        ["Advanced", "BIO 301", "Genetics", "3", 3, "bio-301"],
      ],
    });
    const r = await convertWorkbook(buf, { fileName: "plan.xlsx" });
    expect(r.templateId).toBe("lumiere-roadmap-v1");
    expect(r.content).not.toBeNull();
    const c = r.content!;
    expect(c.phases.map((p) => [p.key, p.sequence])).toEqual([["foundation", 1], ["advanced", 2]]);
    expect(c.objectives).toHaveLength(1);
    expect(c.objectives[0]).toMatchObject({ key: "primary", kind: "primary", linkedToProgramAssignment: true });
    expect(c.items.map((i) => [i.key, i.code, i.credits, i.phaseKey, i.objectiveKey])).toEqual([
      ["bio-101", "BIO 101", "3", "foundation", "primary"],
      ["chm-101", "CHM 101", "4", "foundation", "primary"],
      ["bio-301", "BIO 301", "3", "advanced", "primary"],
    ]);
    expect(r.exceptions.filter((e) => e.severity === "blocking")).toEqual([]);
    expect(r.summary).toMatchObject({ kind: "workbook", fileName: "plan.xlsx", rowsRead: 3, rowsConverted: 3, rowsSkipped: 0 });
  });

  it("reads dates in every supported format", async () => {
    const buf = await book({
      Plan: [
        ["Phase", "Title", "Plan Key", "Start", "End"],
        ["P", "Excel date", "d1", new Date(Date.UTC(2026, 0, 12)), "2026-02-20"],
        ["P", "Serial", "d2", 46034, "3/9/2026"], // 46034 = 2026-01-12
        ["P", "Month", "d3", "Mar 2026", "September 2026"],
        ["P", "Bad", "d4", "soon", "2026-13-40"],
      ],
    });
    const r = await convertWorkbook(buf, { fileName: null });
    const items = r.content!.items;
    expect(items.map((i) => [i.plannedStart, i.plannedEnd])).toEqual([
      ["2026-01-12", "2026-02-20"],
      ["2026-01-12", "2026-03-09"],
      ["2026-03-01", "2026-09-01"],
      [null, null],
    ]);
    const invalid = byCode(r, "INVALID_DATE");
    expect(invalid).toHaveLength(2);
    expect(invalid.every((e) => e.severity === "warning" && e.ref.itemKey === "d4")).toBe(true);
    expect(new Set(r.exceptions.map((e) => e.key)).size).toBe(r.exceptions.length);
  });

  it("generates tasks from count columns and the Tasks list with deterministic keys", async () => {
    const buf = await book({
      Plan: [
        ["Phase", "Title", "Plan Key", "Challenges", "Touchstones", "Exams", "Tasks", "Papers"],
        ["P", "Course", "c1", 3, "2", 1, "Final Exam; Reflection paper; Touchstone 1", "x"],
      ],
    });
    const r = await convertWorkbook(buf, { fileName: null });
    const tasks = r.content!.items[0]!.tasks;
    expect(tasks.map((t) => t.key)).toEqual([
      "challenge-1", "challenge-2", "challenge-3", "touchstone-1", "touchstone-2", "exam-1",
      "final-exam", "reflection-paper", "touchstone-1-2",
    ]);
    expect(tasks.find((t) => t.key === "final-exam")?.kind).toBe("exam");
    expect(tasks.find((t) => t.key === "reflection-paper")?.kind).toBe("paper");
    expect(tasks.map((t) => t.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(byCode(r, "INVALID_TASK_COUNT")).toHaveLength(1);
  });

  it("generates item keys when Plan Key is absent and disambiguates duplicates", async () => {
    const buf = await book({
      Plan: [
        ["Phase", "Code", "Title"],
        ["P", "BIO 101", "Biology"],
        ["P", "BIO 101", "Biology again"],
        ["P", "", "Capstone Project"],
      ],
    });
    const r = await convertWorkbook(buf, { fileName: null });
    expect(r.content!.items.map((i) => i.key)).toEqual(["primary-bio-101", "primary-bio-101-2", "primary-capstone-project"]);
    const gen = byCode(r, "GENERATED_ITEM_KEY");
    expect(gen.map((e) => [e.ref.itemKey, e.severity])).toEqual([
      ["primary-bio-101", "info"],
      ["primary-bio-101-2", "warning"],
      ["primary-capstone-project", "info"],
    ]);
  });

  it("duplicate explicit Plan Keys stay blocking", async () => {
    const buf = await book({ Plan: [["Phase", "Title", "Plan Key"], ["P", "A", "same"], ["P", "B", "same"]] });
    const r = await convertWorkbook(buf, { fileName: null });
    expect(byCode(r, "DUPLICATE_ITEM_KEY")[0]).toMatchObject({ severity: "blocking" });
  });

  it("handles objectives, milestones, about, dependencies by code, status, hold, approval, conditions, unmapped columns", async () => {
    const buf = await book({
      "How to use": [["ignore me"]],
      Plan: [
        ["Phase", "Objective", "Plan Key", "Code", "Title", "Depends On", "Status", "Hold Reason", "Approval", "Alternative For", "Condition", "Reviewer Mood"],
        ["# example", "", "", "", "ignored comment row"],
        ["P1", "BS Biology", "bio", "BIO 101", "Biology", "", "Planned", "", "required", "", "", "ok"],
        ["P1", "MBA", "mba1", "MBA 500", "Mgmt", "BIO 101", "Hold", "Awaiting admission", "approved", "", "Only if admitted", "meh"],
        ["P2", "BS Biology", "alt", "BIO 102", "Alt Biology", "", "Alternative", "", "n/a", "bio", "", ""],
        ["", "", "", "", ""],
        ["P2", "Nursing prereqs", "", "", "Anatomy", "", "", "", "", "", "", ""],
        ["P2", "", "", "", "", "", "", "", "", "", "", "stray note"],
      ],
      Objectives: [
        ["Key", "Title", "Kind", "Institution"],
        ["bs-bio", "BS Biology", "Primary", "State U"],
        ["mba", "MBA", "Parallel", "Biz School"],
      ],
      Milestones: [
        ["Key", "Title", "Kind", "Target Date", "Objective", "After"],
        ["m1", "Foundation done", "Checkpoint", "2026-06-30", "BS Biology", "bio, BIO 102"],
      ],
      About: [["Plan Title", "Jane's roadmap"], ["Summary", "Hello"]],
    });
    const r = await convertWorkbook(buf, { fileName: "x.xlsx" });
    const c = r.content!;
    expect(c.title).toBe("Jane's roadmap");
    expect(c.summary).toBe("Hello");
    expect(c.objectives.map((o) => [o.key, o.kind, o.linkedToProgramAssignment])).toEqual([["bs-bio", "primary", true], ["mba", "parallel", false], ["nursing-prereqs", "secondary", false]]);
    const mba = c.items.find((i) => i.key === "mba1")!;
    expect(mba).toMatchObject({ planStatus: "hold", hold: { reason: "Awaiting admission" }, dependsOn: ["bio"], objectiveKey: "mba" });
    expect(mba.approval).toEqual({ required: true, status: "approved" });
    expect(c.items.find((i) => i.key === "bio")!.approval).toMatchObject({ required: true, status: "pending" });
    const alt = c.items.find((i) => i.key === "alt")!;
    expect(alt).toMatchObject({ planStatus: "alternative", alternativeOf: "bio", approval: { required: false, status: "not_required" } });
    expect(c.milestones[0]).toMatchObject({ key: "m1", kind: "checkpoint", targetDate: "2026-06-30", objectiveKey: "bs-bio", afterItemKeys: ["bio", "alt"] });
    expect(byCode(r, "CONDITIONAL_ALLOCATION")).toHaveLength(1);
    expect(byCode(r, "CONDITIONAL_ALLOCATION")[0]).toMatchObject({ severity: "warning", ref: { itemKey: "mba1" } });
    expect(byCode(r, "UNMAPPED_COLUMN").map((e) => e.severity)).toEqual(["info"]);
    expect(byCode(r, "OBJECTIVE_CREATED_FROM_ROW").map((e) => e.severity)).toEqual(["warning"]);
    expect(c.items).toHaveLength(4); // comment + blank rows skipped silently
    expect(byCode(r, "ROW_SKIPPED").map((e) => e.severity)).toEqual(["info"]); // stray note row
    expect(c.objectives.map((o) => o.key)).toContain("nursing-prereqs");
    expect(r.summary.sheetsRead).toEqual(["Plan", "Objectives", "Milestones", "About"]);
  });

  it("flags missing hold reasons and unknown dependencies from the shared validation", async () => {
    const buf = await book({
      Plan: [["Phase", "Title", "Plan Key", "Status", "Depends On"], ["P", "A", "a", "Hold", "ghost"]],
    });
    const r = await convertWorkbook(buf, { fileName: null });
    expect(byCode(r, "HOLD_WITHOUT_REASON")[0]).toMatchObject({ severity: "blocking" });
    expect(byCode(r, "UNKNOWN_DEPENDENCY")[0]).toMatchObject({ severity: "blocking" });
  });

  it("blocks when the Phase column is missing", async () => {
    const buf = await book({ Plan: [["Title", "Credits"], ["A", 3]] });
    const r = await convertWorkbook(buf, { fileName: null });
    expect(r.content).toBeNull();
    expect(byCode(r, "MISSING_REQUIRED_COLUMN")[0]).toMatchObject({ severity: "blocking" });
  });

  it("is deterministic: identical bytes give identical output", async () => {
    const buf = await book({
      Plan: [
        ["Phase", "Code", "Title", "Challenges", "Start", "Mystery"],
        ["A", "X1", "One", 2, "Jan 2026", "?"],
        ["B", "X1", "One", 1, "2026-02-01", "?"],
      ],
    });
    const a = await convertWorkbook(buf, { fileName: "f.xlsx" });
    const b = await convertWorkbook(Buffer.from(buf), { fileName: "f.xlsx" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.content).not.toBeNull();
  });

  it("returns UNKNOWN_TEMPLATE (blocking, content null) for foreign or unreadable files", async () => {
    const foreign = await convertWorkbook(await book({ Sheet1: [["Name", "Amount"], ["x", 1]] }), { fileName: "a.xlsx" });
    expect(foreign.content).toBeNull();
    expect(foreign.exceptions[0]).toMatchObject({ code: "UNKNOWN_TEMPLATE", severity: "blocking" });
    const junk = await convertWorkbook(Buffer.from("not a workbook at all"), { fileName: "b.xlsx" });
    expect(junk.content).toBeNull();
    expect(junk.exceptions[0]).toMatchObject({ code: "UNKNOWN_TEMPLATE", severity: "blocking" });
    const empty = await convertWorkbook(Buffer.alloc(0), { fileName: null });
    expect(empty.content).toBeNull();
  });

  it("recognises the shipped reference template and treats its example rows as comments", async () => {
    const buf = readFileSync(resolve(__dirname, "../docs/templates/lumiere-roadmap-v1.xlsx"));
    const r = await convertWorkbook(buf, { fileName: "lumiere-roadmap-v1.xlsx" });
    expect(r.templateId).toBe("lumiere-roadmap-v1");
    expect(r.exceptions.some((e) => e.code === "UNKNOWN_TEMPLATE")).toBe(false);
    expect(r.summary.rowsRead).toBe(0);
    expect(r.summary.sheetsRead).toContain("Plan");
  });

  it("caps hostile sizes: row limit, item limit, long cell text, formulas use cached values", async () => {
    const rows: unknown[][] = [["Phase", "Title", "Plan Key", "Student Note"]];
    for (let i = 1; i <= 2600; i++) rows.push(["P", `Item ${i}`, `k-${i}`, i === 1 ? "x".repeat(50_000) : ""]);
    const big = await convertWorkbook(await book({ Plan: rows, Second: [["a"]] }), { fileName: null });
    expect(big.content!.items.length).toBe(500);
    expect(byCode(big, "ROW_SKIPPED").some((e) => e.severity === "blocking")).toBe(true);
    expect(big.content!.items[0]!.studentNote!.length).toBeLessThanOrEqual(1000);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Plan");
    ws.addRow(["Phase", "Title", "Plan Key", "Credits"]);
    ws.addRow(["P", { formula: 'HYPERLINK("http://evil.example","x")', result: "Cached title" }, "f1", { formula: "1+2", result: 3 }]);
    ws.getCell("A3").value = { text: "Linked", hyperlink: "http://evil.example" };
    ws.getCell("B3").value = "With link";
    ws.getCell("C3").value = "f2";
    const r = await convertWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), { fileName: null });
    expect(r.content!.items[0]).toMatchObject({ title: "Cached title", credits: "3" });
    expect(r.content!.phases.map((p) => p.title)).toEqual(["P", "Linked"]);
    expect(JSON.stringify(r)).not.toContain("evil.example");
  });
});

const goodContent = {
  contentVersion: "roadmap-content/1",
  title: "AI plan",
  objectives: [{ key: "bs", title: "BS", kind: "primary", linkedToProgramAssignment: true }],
  phases: [{ key: "p1", title: "P1", sequence: 1 }],
  items: [
    { key: "a", phaseKey: "p1", objectiveKey: "bs", sequence: 1, title: "A", linkedCreditRecordId: "8f14e45f-ceea-4e6a-9d3a-1b2c3d4e5f60", approval: { required: true, status: "approved" } },
    { key: "b", phaseKey: "p1", objectiveKey: "bs", sequence: 2, title: "B" },
  ],
};
const pkg = (over: Record<string, unknown> = {}) => ({
  format: "lumiere-roadmap-package/1",
  generator: { name: "ChatGPT", model: "gpt-x" },
  content: goodContent,
  itemAnnotations: [
    { itemKey: "a", confidence: "low", needsReview: false, rationale: "guessed the course" },
    { itemKey: "b", confidence: "high", needsReview: true, conditionalAllocation: "counts only if admitted" },
    { itemKey: "zzz", confidence: "low" },
  ],
  creditClaims: [{ description: "BIO 101 is fully accepted for 3 credits" }],
  ...over,
});

describe("AI package adapter", () => {
  it("converts, flags low confidence, conditional allocation and ignores credit claims", () => {
    const r = convertImportPackage(pkg());
    expect(r.templateId).toBe("ai-package-v1");
    expect(r.content).not.toBeNull();
    expect(r.summary).toMatchObject({ kind: "package", generator: "ChatGPT (gpt-x)", rowsConverted: 2 });
    expect(byCode(r, "AI_LOW_CONFIDENCE").map((e) => [e.ref.itemKey, e.severity])).toEqual([["a", "warning"], ["b", "warning"]]);
    expect(byCode(r, "CONDITIONAL_ALLOCATION")).toHaveLength(1);
    const claims = byCode(r, "AI_CREDIT_CLAIM_IGNORED");
    expect(claims.length).toBe(3); // link, approval, creditClaims[0]
    expect(claims.every((e) => e.severity === "warning")).toBe(true);
    const a = r.content!.items.find((i) => i.key === "a")!;
    expect(a.linkedCreditRecordId).toBeNull();
    expect(a.approval?.status).toBe("pending");
    expect(new Set(r.exceptions.map((e) => e.key)).size).toBe(r.exceptions.length);
    expect(JSON.stringify(convertImportPackage(pkg()))).toBe(JSON.stringify(r));
  });

  it("accepts a JSON string and rejects bad packages with PACKAGE_INVALID", () => {
    expect(convertImportPackage(JSON.stringify(pkg())).content).not.toBeNull();
    const wrong = convertImportPackage({ format: "nope" });
    expect(wrong.content).toBeNull();
    expect(wrong.exceptions[0]).toMatchObject({ code: "PACKAGE_INVALID", severity: "blocking" });
    expect(convertImportPackage("{bad json").content).toBeNull();
    const badContent = convertImportPackage(pkg({ content: { title: 5 } }));
    expect(badContent.content).toBeNull();
    expect(badContent.exceptions.filter((e) => e.severity === "blocking").every((e) => e.code === "PACKAGE_INVALID")).toBe(true);
  });

  it("runs semantic validation on package content", () => {
    const content = { ...goodContent, items: [{ ...goodContent.items[1]!, dependsOn: ["ghost"] }] };
    const r = convertImportPackage(pkg({ content, itemAnnotations: [], creditClaims: [] }));
    expect(r.content).not.toBeNull();
    expect(byCode(r, "UNKNOWN_DEPENDENCY")[0]).toMatchObject({ severity: "blocking" });
  });
});
