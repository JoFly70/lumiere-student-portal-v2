/**
 * S30 Phase B — Import Center pure units: format detection (by content), CSV parsing, XLSX reading (formulas -> cached
 * values), formula-injection flags, mapping suggestion and validation, value normalisation, row outcomes, identity and
 * fingerprints. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  ImportFileError, csvSafe, detectFormat, fingerprint, identityKey, looksLikeFormula, matchCourse, normalizeRow, parseCsv, parseDate, parsePercent, parseStatus,
  readTable, suggestMapping, validateMapping, type NormalizeContext,
} from "../server/services/s30/imports/parse";
import { IMPORT_MAX_BYTES } from "../shared/s30-contract";

const ctx: NormalizeContext = {
  today: "2026-11-10",
  students: new Map([["SYN-001", { id: "s-a", name: "Ada Synthetic", isDemo: false }], ["SYN-DEMO", { id: "s-d", name: "Demo", isDemo: true }]]),
  plans: new Map([["s-a", [{ key: "eng-9", title: "English 9 — Core" }, { key: "alg-1", title: "Algebra I" }]]]),
};
const mapping = { student_code: "Code", course: "Course", task: "Task", progress_status: "Status", percent_complete: "Progress", score_percent: "Score", credits_reported: "Credits", reported_on: "Date" };
const row = (o: Record<string, string>) => ({ Code: "SYN-001", Course: "English 9", Task: "", Status: "", Progress: "", Score: "", Credits: "", Date: "", ...o });

describe("file detection and reading", () => {
  it("detects by content: xlsx zip, UTF-8 CSV; refuses PDF, legacy .xls, images, binary and non-UTF-8", () => {
    expect(detectFormat(Buffer.from("a,b\n1,2"))).toBe("csv");
    expect(detectFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBe("xlsx");
    expect(() => detectFormat(Buffer.from("%PDF-1.7\n..."))).toThrow(ImportFileError);
    expect(() => detectFormat(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]))).toThrow(/Only \.csv and \.xlsx/);
    expect(() => detectFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toThrow(ImportFileError);
    expect(() => detectFormat(Buffer.from([0x61, 0xff, 0xfe, 0x62]))).toThrow(/UTF-8/);
  });
  it("refuses empty and oversized files before parsing", async () => {
    await expect(readTable(Buffer.alloc(0))).rejects.toMatchObject({ reason: "empty" });
    await expect(readTable(Buffer.alloc(IMPORT_MAX_BYTES + 1, 0x61))).rejects.toMatchObject({ reason: "too_large" });
  });
  it("parses RFC 4180 CSV: BOM, quotes, embedded delimiters/newlines, semicolon delimiter, blank rows skipped", async () => {
    expect(parseCsv('﻿a,b\n"x, y","he said ""hi"""\n"multi\nline",2')).toEqual([["a", "b"], ["x, y", 'he said "hi"'], ["multi\nline", "2"]]);
    expect(parseCsv("Code;Course\r\nSYN-001;English 9\r\n")).toEqual([["Code", "Course"], ["SYN-001", "English 9"]]);
    const t = await readTable(Buffer.from("Title row\nCode,Course,Score\nSYN-001,English 9,88\n,,\nSYN-001,Algebra I,91\n"));
    expect(t.format).toBe("csv");
    expect(t.headers).toEqual(["Code", "Course", "Score"]);
    expect(t.rows.map((r) => r.rowNumber)).toEqual([3, 5]);
    expect(t.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("refuses a file without a header row and one with too many rows", async () => {
    await expect(readTable(Buffer.from("only\none\ncolumn\n"))).rejects.toMatchObject({ reason: "no_header" });
    const big = "Code,Course\n" + Array.from({ length: 2001 }, (_, i) => `SYN-${i},C`).join("\n");
    await expect(readTable(Buffer.from(big))).rejects.toMatchObject({ reason: "too_many_rows" });
  });
  it("reads XLSX: formulas give their cached value (never the formula text), dates become ISO", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Progress");
    ws.addRow(["Code", "Course", "Score", "Date"]);
    ws.addRow(["SYN-001", "English 9", { formula: "40+48", result: 88 }, new Date(Date.UTC(2026, 9, 15))]);
    ws.addRow(["SYN-001", "Algebra I", { formula: 'HYPERLINK("http://evil.example","x")', result: "x" }, null]);
    const t = await readTable(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(t.format).toBe("xlsx");
    expect(t.sheetName).toBe("Progress");
    expect(t.rows[0]!.cells).toMatchObject({ Score: "88", Date: "2026-10-15" });
    expect(JSON.stringify(t.rows)).not.toContain("HYPERLINK");
    expect(JSON.stringify(t.rows)).not.toContain("evil.example");
  });
});

describe("mapping", () => {
  it("suggests fields from EN/FR headers, each header used once", () => {
    expect(suggestMapping(["Code élève", "Cours", "Statut", "Progression (%)", "Note", "Crédits", "Date de fin"])).toEqual({
      student_code: "Code élève", course: "Cours", progress_status: "Statut", percent_complete: "Progression (%)", score_percent: "Note", credits_reported: "Crédits", reported_on: "Date de fin",
    });
    expect(suggestMapping(["Student ID", "Course Title", "Assignment", "Completion Status", "Final Grade"])).toMatchObject({ student_code: "Student ID", course: "Course Title", task: "Assignment", progress_status: "Completion Status", score_percent: "Final Grade" });
  });
  it("validates required fields, unknown and doubly-used columns, and the need for a measure", () => {
    expect(validateMapping({ student_code: "Code" }, ["Code"])).toEqual(expect.arrayContaining(["course is required", "map at least one measure (status, percent complete, score or credits)"]));
    expect(validateMapping({ student_code: "Code", course: "Code", score_percent: "Nope" }, ["Code"])).toEqual(expect.arrayContaining(["unknown column: Nope", "a column is mapped to more than one field"]));
    expect(validateMapping(mapping, Object.values(mapping))).toEqual([]);
  });
});

describe("normalisation", () => {
  it("parses statuses, percents (85%, 85,5, 0.85), dates (ISO, unambiguous d/m or m/d, Excel serial)", () => {
    expect(parseStatus("Terminé")).toBe("completed");
    expect(parseStatus("In progress")).toBe("in_progress");
    expect(parseStatus("pas commencé")).toBe("not_started");
    expect(parseStatus("maybe")).toBe("invalid");
    expect(parsePercent("85%")).toBe(85);
    expect(parsePercent("85,5")).toBe(85.5);
    expect(parsePercent("0.85")).toBeCloseTo(85);
    expect(parsePercent("-5")).toBeNaN();
    expect(parseDate("2026-10-15")).toBe("2026-10-15");
    expect(parseDate("15/10/2026")).toBe("2026-10-15");
    expect(parseDate("10/15/2026")).toBe("2026-10-15");
    expect(parseDate("03/04/2026")).toBe("invalid"); // ambiguous
    expect(parseDate("31/02/2026")).toBe("invalid");
    expect(parseDate("46310")).toBe("2026-10-15");
  });
  it("flags formula-like text and never uses it as a value; csvSafe neutralises it on output", () => {
    for (const v of ["=1+1", "+cmd", "@SUM(A1)", "-HYPERLINK(1)", "\t=x"]) expect(looksLikeFormula(v)).toBe(true);
    for (const v of ["-5", "Algebra I", "85%"]) expect(looksLikeFormula(v)).toBe(false);
    const out = normalizeRow(row({ Course: '=HYPERLINK("http://x")', Score: "90" }), mapping, ctx, "provider_reported");
    expect(out.outcome).toBe("invalid");
    expect(out.issues).toContainEqual({ code: "formula_text", field: "course", severity: "error" });
    expect(out.normalized?.course).toBeNull();
    expect(csvSafe("=1+1")).toBe("'=1+1");
    expect(csvSafe('a,"b"')).toBe('"a,""b"""');
  });
  it("matches students by code only and courses by key or title; unknown students are invalid, unplanned courses a warning", () => {
    expect(matchCourse("ENGLISH 9", [{ key: "eng-9", title: "English 9 — Core" }])?.key).toBe("eng-9");
    expect(normalizeRow(row({ Code: "syn-001", Score: "88" }), mapping, ctx, "provider_reported")).toMatchObject({ studentId: "s-a", outcome: "valid", normalized: { courseKey: "eng-9", scorePercent: 88 } });
    expect(normalizeRow(row({ Code: "Ada Synthetic", Score: "88" }), mapping, ctx, "provider_reported")).toMatchObject({ studentId: null, outcome: "invalid" });
    expect(normalizeRow(row({ Course: "Chemistry", Score: "70" }), mapping, ctx, "provider_reported").issues).toContainEqual({ code: "course_not_on_plan", field: "course", severity: "warning" });
    expect(normalizeRow(row({ Code: "SYN-DEMO", Score: "70" }), mapping, ctx, "provider_reported").issues).toContainEqual({ code: "demo_student", field: "student_code", severity: "info" });
  });
  it("rejects bad values, future dates and rows without any measure; flags completion for review; credits are informational", () => {
    const bad = normalizeRow(row({ Status: "maybe", Progress: "120", Score: "abc", Credits: "99", Date: "2027-01-01" }), mapping, ctx, "provider_reported");
    expect(bad.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["bad_status", "bad_percent", "bad_score", "bad_credits", "future_date"]));
    expect(normalizeRow(row({}), mapping, ctx, "provider_reported").issues.map((i) => i.code)).toContain("no_measure");
    const done = normalizeRow(row({ Progress: "100", Credits: "1" }), mapping, ctx, "provider_reported");
    expect(done).toMatchObject({ needsReview: true, normalized: { progressStatus: "completed", percentComplete: 100, creditsReported: 1 } });
    expect(done.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["completion_needs_review", "credits_informational"]));
    // a school-reported score always needs review (it is not an official result until recorded with evidence)
    expect(normalizeRow(row({ Score: "75" }), mapping, ctx, "institution_reported").needsReview).toBe(true);
    expect(normalizeRow(row({ Score: "75" }), mapping, ctx, "provider_reported").needsReview).toBe(false);
  });
  it("identity ignores values; fingerprint changes when any reported value changes", () => {
    const a = normalizeRow(row({ Score: "88" }), mapping, ctx, "provider_reported").normalized!;
    const b = normalizeRow(row({ Score: "89" }), mapping, ctx, "provider_reported").normalized!;
    expect(identityKey("provider_reported", a)).toBe(identityKey("provider_reported", b));
    expect(identityKey("provider_reported", a)).not.toBe(identityKey("institution_reported", a));
    expect(fingerprint("provider_reported", "Prov", a)).not.toBe(fingerprint("provider_reported", "Prov", b));
    expect(fingerprint("provider_reported", "Prov", a)).toBe(fingerprint("provider_reported", "Prov", { ...a }));
  });
});
