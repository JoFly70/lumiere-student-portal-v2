import { describe, expect, it } from "vitest";
import { extractDocumentText } from "../server/services/document-extraction";
import { chunkSegments } from "../server/services/document-extraction/chunker";
import { buildCidPdf, buildDocx, buildPdf, buildXlsx, buildZip, PNG_BYTES } from "./helpers/s21-attachment-fixtures";

const all = (r: ReturnType<typeof extractDocumentText>) => r.chunks.map((c) => c.content).join("\n");

describe("S21 extraction: DOCX", () => {
  it("extracts paragraphs, headings and tables with locations", () => {
    const docx = buildDocx([
      { kind: "h1", text: "Transfer plan" },
      { kind: "p", text: "Maria & Co <test> paragraph" },
      { kind: "table", rows: [["Course", "Credits"], ["ENG101", "3"]] },
      { kind: "h2", text: "Notes" },
    ]);
    const r = extractDocumentText("docx", docx);
    expect(r.status).toBe("indexed");
    const text = all(r);
    expect(text).toContain("# Transfer plan");
    expect(text).toContain("Maria & Co <test> paragraph");
    expect(text).toContain("Course | Credits");
    expect(text).toContain("ENG101 | 3");
    expect(text).toContain("## Notes");
    expect(r.chunks[0].location).toBe("paragraphs 1-5");
    expect(r.chunks[0].chunkIndex).toBe(0);
  });
  it("splits long documents into ~1500 char chunks with increasing paragraph ranges", () => {
    const blocks = Array.from({ length: 60 }, (_, i) => ({ kind: "p" as const, text: `Paragraph ${i + 1} ` + "lorem ipsum dolor ".repeat(8) }));
    const r = extractDocumentText("docx", buildDocx(blocks));
    expect(r.status).toBe("indexed");
    expect(r.chunks.length).toBeGreaterThan(3);
    for (const c of r.chunks) expect(c.content.length).toBeLessThanOrEqual(1500);
    expect(r.chunks.map((c) => c.chunkIndex)).toEqual(r.chunks.map((_, i) => i));
    expect(r.chunks[1].location).toMatch(/^paragraphs \d+-\d+$/);
  });
});

describe("S21 extraction: XLSX", () => {
  it("reads shared strings, numbers and several sheets with sheet/row locations", () => {
    const xlsx = buildXlsx([
      { name: "Grades", rows: [["Course", "Grade"], ["MATH101", 95], ["ENG101", 88]] },
      { name: "Plan", rows: [["Term", null, "Credits"], ["Fall", null, 12]] },
    ]);
    const r = extractDocumentText("xlsx", xlsx);
    expect(r.status).toBe("indexed");
    const locs = r.chunks.map((c) => c.location);
    expect(locs).toContain("Grades rows 1-3");
    expect(locs).toContain("Plan rows 1-2");
    expect(all(r)).toContain("MATH101 | 95");
    expect(all(r)).toContain("Fall | | 12");
  });
  it("caps rows per sheet", () => {
    const rows = Array.from({ length: 300 }, (_, i) => [`r${i}`, i]);
    const r = extractDocumentText("xlsx", buildXlsx([{ name: "Big", rows }]), { maxSheetRows: 50 });
    expect(r.truncated).toBe(true);
    expect(all(r)).toContain("r49 | 49");
    expect(all(r)).not.toContain("r50 |");
  });
});

describe("S21 extraction: CSV and TXT", () => {
  it("parses quoted fields, other delimiters, and caps rows/cols", () => {
    const csv = Buffer.from('name,notes\n"Doe, Jane","said ""hi"""\nSmith,plain\n');
    const r = extractDocumentText("csv", csv);
    expect(r.status).toBe("indexed");
    expect(all(r)).toContain('Doe, Jane | said "hi"');
    expect(r.chunks[0].location).toBe("rows 1-3");
    const semi = extractDocumentText("csv", Buffer.from("a;b;c\n1;2;3\n"));
    expect(all(semi)).toContain("1 | 2 | 3");
    const wide = extractDocumentText("csv", Buffer.from(Array.from({ length: 100 }, (_, i) => `c${i}`).join(",")), { maxCsvCols: 5 });
    expect(all(wide)).toBe("c0 | c1 | c2 | c3 | c4");
    expect(wide.truncated).toBe(true);
    const longCsv = Buffer.from(Array.from({ length: 200 }, (_, i) => `${i},x`).join("\n"));
    const capped = extractDocumentText("csv", longCsv, { maxCsvRows: 20 });
    expect(capped.truncated).toBe(true);
    expect(all(capped)).not.toContain("50 | x");
  });
  it("indexes TXT by line numbers and caps total characters", () => {
    const r = extractDocumentText("txt", Buffer.from("first line\n\nthird line\n"));
    expect(r.chunks[0].location).toBe("lines 1-3");
    const huge = Buffer.from("x".repeat(100) + "\n").toString();
    const big = extractDocumentText("txt", Buffer.from(huge.repeat(5000)), { maxTotalChars: 10_000 });
    expect(big.truncated).toBe(true);
    expect(big.chunks.reduce((n, c) => n + c.content.length, 0)).toBeLessThanOrEqual(10_100);
  });
  it("strips NUL and control characters from stored text", () => {
    const r = extractDocumentText("txt", Buffer.from("ok\u0007text​here"));
    expect(all(r)).toBe("oktexthere");
  });
  it("splits a single huge line", () => {
    const r = extractDocumentText("txt", Buffer.from("word ".repeat(2000)));
    expect(r.chunks.length).toBeGreaterThan(5);
    expect(r.chunks.every((c) => c.content.length <= 1500)).toBe(true);
  });
});

describe("S21 extraction: PDF (machine-readable, best effort)", () => {
  it("extracts text per page with page locations (Flate, Tj)", () => {
    const pdf = buildPdf([["Official transcript", "Student: Jane Doe (ID 42)"], ["Second page line one"]]);
    const r = extractDocumentText("pdf", pdf);
    expect(r.status).toBe("indexed");
    expect(r.chunks.map((c) => c.location)).toEqual(["page 1", "page 2"]);
    expect(r.chunks[0].content).toContain("Official transcript");
    expect(r.chunks[0].content).toContain("Student: Jane Doe (ID 42)");
    expect(r.chunks[1].content).toBe("Second page line one");
  });
  it("handles TJ arrays and uncompressed streams", () => {
    const r = extractDocumentText("pdf", buildPdf([["Hello kerned world"]], { tj: true, plain: true }));
    expect(all(r).replace(/\s+/g, "")).toContain("Hellokernedworld");
  });
  it("decodes escaped parentheses and octal escapes", () => {
    const r = extractDocumentText("pdf", buildPdf([["Credits (3) \\ done"]]));
    expect(all(r)).toContain("Credits (3) \\ done");
  });
  it("returns stored_only (not an error) for scanned/unreadable and CID-font PDFs", () => {
    const empty = extractDocumentText("pdf", buildPdf([[""]]));
    expect(empty.status).toBe("stored_only");
    const cid = extractDocumentText("pdf", buildCidPdf());
    expect(cid.status).toBe("stored_only");
    const junk = extractDocumentText("pdf", Buffer.from("%PDF-1.4\nnot really a pdf\n%%EOF"));
    expect(junk.status).toBe("stored_only");
  });
  it("caps pages", () => {
    const pages = Array.from({ length: 12 }, (_, i) => [`Page text number ${i + 1}`]);
    const r = extractDocumentText("pdf", buildPdf(pages), { maxPdfPages: 5 });
    expect(r.truncated).toBe(true);
    expect(r.chunks).toHaveLength(5);
  });
});

describe("S21 extraction: images, failures, caps", () => {
  it("images are stored_only without OCR", () => {
    for (const ext of ["png", "jpg", "jpeg", "webp"]) {
      const r = extractDocumentText(ext, PNG_BYTES);
      expect(r).toMatchObject({ status: "stored_only", chunks: [] });
    }
  });
  it("a broken OOXML reports failed (not a thrown error)", () => {
    const r = extractDocumentText("docx", buildZip([{ name: "[Content_Types].xml", data: "<Types/>" }]));
    expect(r.status).toBe("failed");
  });
  it("honours maxChunks and total chars in the chunker", () => {
    const segments = Array.from({ length: 100 }, (_, i) => ({ group: null, n: i + 1, text: "y".repeat(1400) }));
    const r = chunkSegments({ segments, unitLabel: "paragraphs", truncated: false }, { maxTotalChars: 200_000, maxChunks: 10, chunkChars: 1500, timeBudgetMs: 1000, maxCsvRows: 1, maxCsvCols: 1, maxSheets: 1, maxSheetRows: 1, maxSheetCols: 1, maxPdfPages: 1 });
    expect(r.chunks).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });
});
