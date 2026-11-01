/**
 * S30 Phase B security fixes (pure / file-level): CSV row cap counts only non-empty rows and refuses instead of
 * truncating; "__proto__" headers are plain columns; .xlsx parts are really inflated under a hard cap (a lying header
 * cannot expand past it); the import path streams and refuses more rows than the cap; parser errors return a fixed
 * client message. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { parseCsv, readTable } from "../server/services/s30/imports/parse";
import { readXlsxRows, verifyZipBudget, XlsxBudgetError, XLSX_LIMITS } from "../server/services/s30/imports/xlsx-stream";
import { IMPORT_MAX_ROWS } from "../shared/s30-contract";

/** One-entry zip whose headers DECLARE `declared` bytes but whose data inflates to `actual` zero bytes. */
function lyingZip(actual: number, declared: number): Buffer {
  const data = deflateRawSync(Buffer.alloc(actual));
  const name = Buffer.from("xl/worksheets/sheet1.xml");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(declared, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0, 8); cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(declared, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
  const cdOffset = local.length + name.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cd.length + name.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, name, data, cd, name, eocd]);
}

describe("CSV row cap", () => {
  it("blank lines do not count and can never cut real rows off", async () => {
    const lines = ["Code,Course,Score"];
    for (let i = 0; i < IMPORT_MAX_ROWS; i++) lines.push(`SYN-${i},C,50`, "", "");
    const t = await readTable(Buffer.from(lines.join("\n")));
    expect(t.rows).toHaveLength(IMPORT_MAX_ROWS);
    expect(t.rows.at(-1)!.cells.Code).toBe(`SYN-${IMPORT_MAX_ROWS - 1}`);
  });
  it("one row over the cap is refused, not silently truncated", async () => {
    const lines = ["Code,Course,Score", ...Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `SYN-${i},C,50`)];
    await expect(readTable(Buffer.from(lines.join("\n")))).rejects.toMatchObject({ reason: "too_many_rows" });
    expect(() => parseCsv(["a,b", ...Array.from({ length: IMPORT_MAX_ROWS + 20 }, () => "x,y")].join("\n"))).toThrow(/At most/);
  });
  it("a __proto__ or constructor header is just a column", async () => {
    const t = await readTable(Buffer.from("__proto__,constructor,Course\nSYN-1,x,English 9\n"));
    expect(Object.getPrototypeOf(t.rows[0]!.cells)).toBeNull();
    expect(t.rows[0]!.cells["__proto__"]).toBe("SYN-1");
    expect(t.rows[0]!.cells.constructor).toBe("x");
  });
});

describe("XLSX budget and streaming", () => {
  it("measures real inflated sizes: a part that lies about its size is refused", () => {
    expect(() => verifyZipBudget(lyingZip(XLSX_LIMITS.perPartBytes + 1024, 100))).toThrow(XlsxBudgetError);
    expect(verifyZipBudget(lyingZip(1000, 1000))).toMatchObject({ entries: 1, expandedBytes: 1000 });
    expect(() => verifyZipBudget(lyingZip(2 * 1024 * 1024, 10), { maxEntries: 10, perPartBytes: 10 * 1024 * 1024, totalBytes: 1024 * 1024 })).toThrow(/too large/);
  });
  it("refuses a part whose local header disagrees with the directory, and only verified parts reach the reader", async () => {
    const { rebuildStoredZip } = await import("../server/services/s30/imports/xlsx-stream");
    const z = rebuildStoredZip([{ name: "xl/sharedStrings.xml", data: Buffer.from("<sst/>") }]);
    expect(verifyZipBudget(z).parts.map((p) => p.name)).toEqual(["xl/sharedStrings.xml"]);
    const forged = Buffer.from(z);
    forged.writeUInt16LE(8, 8); // local header now claims "deflate" while the directory says "stored"
    expect(() => verifyZipBudget(forged)).toThrow(/inconsistent/);
  });
  it("a zip bomb upload gets a fixed client message (no parser text)", async () => {
    await expect(readTable(lyingZip(XLSX_LIMITS.perPartBytes + 1024, 100))).rejects.toMatchObject({ reason: "unreadable", message: "The workbook is too large when expanded or is not a valid .xlsx file." });
    const notWorkbook = lyingZip(1000, 1000);
    await expect(readTable(notWorkbook)).rejects.toMatchObject({ reason: expect.stringMatching(/unreadable|no_header/) });
  });
  it("streams rows and refuses a sheet with more rows than the cap", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Big");
    ws.addRow(["Code", "Course", "Score"]);
    for (let i = 0; i < IMPORT_MAX_ROWS + 1; i++) ws.addRow([`SYN-${i}`, "C", 50]);
    const big = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(readTable(big)).rejects.toMatchObject({ reason: "too_many_rows" });
    const r = await readXlsxRows(big, 50);
    expect(r).toMatchObject({ sheetName: "Big", truncated: true });
    expect(r.rows.length).toBeLessThanOrEqual(50);
  });
  it("keeps spreadsheet row numbers across blank rows and skips leading empty sheets", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Notes");
    const ws = wb.addWorksheet("Data");
    ws.getCell("A2").value = "Code"; ws.getCell("B2").value = "Course";
    ws.getCell("A5").value = "SYN-1"; ws.getCell("B5").value = "English 9";
    const t = await readTable(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(t.sheetName).toBe("Data");
    expect(t.rows).toEqual([{ rowNumber: 5, cells: expect.objectContaining({ Code: "SYN-1", Course: "English 9" }) }]);
  });
});
