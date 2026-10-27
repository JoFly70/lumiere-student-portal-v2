import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_TYPES,
  AttachmentPolicyError,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_BYTES_PER_MESSAGE,
  checkDeclaredMime,
  defaultQuotaBytes,
  policyTable,
  sanitizeAttachmentName,
  specForExt,
  storageSafeName,
  validateAttachmentContent,
} from "../server/lib/attachment-policy";
import { openZip, ZipError } from "../server/services/document-extraction/zip-reader";
import {
  EXE_BYTES, JPEG_BYTES, PNG_BYTES, WEBP_BYTES, buildDocx, buildPdf, buildXlsx, buildZip,
} from "./helpers/s21-attachment-fixtures";

const MB = 1024 * 1024;
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof AttachmentPolicyError ? e.code : e instanceof ZipError ? `zip:${e.code}` : `other:${(e as Error).message}`;
  }
  return "ok";
};

describe("S21 attachment policy table", () => {
  it("has the specified limits", () => {
    const max = (ext: string) => specForExt(ext)!.maxBytes / MB;
    expect([max("pdf"), max("docx"), max("xlsx")]).toEqual([20, 20, 20]);
    expect(max("csv")).toBe(10);
    expect(max("txt")).toBe(5);
    for (const e of ["jpg", "jpeg", "png", "webp"]) expect(max(e)).toBe(10);
    expect(MAX_ATTACHMENTS_PER_MESSAGE).toBe(5);
    expect(MAX_BYTES_PER_MESSAGE).toBe(50 * MB);
    expect(policyTable()).toHaveLength(ATTACHMENT_TYPES.length);
    expect(policyTable().every((t) => t.ext && t.mime && t.maxBytes > 0)).toBe(true);
  });

  it("default quota is 250 MB and configurable by STUDENT_STORAGE_QUOTA_MB", () => {
    expect(defaultQuotaBytes({} as NodeJS.ProcessEnv)).toBe(250 * MB);
    expect(defaultQuotaBytes({ STUDENT_STORAGE_QUOTA_MB: "100" } as unknown as NodeJS.ProcessEnv)).toBe(100 * MB);
    expect(defaultQuotaBytes({ STUDENT_STORAGE_QUOTA_MB: "abc" } as unknown as NodeJS.ProcessEnv)).toBe(250 * MB);
    expect(defaultQuotaBytes({ STUDENT_STORAGE_QUOTA_MB: "-5" } as unknown as NodeJS.ProcessEnv)).toBe(250 * MB);
  });
});

describe("S21 accepts every supported format (by real content)", () => {
  const cases: [string, Buffer][] = [
    ["pdf", buildPdf([["Hello world from a PDF"]])],
    ["docx", buildDocx([{ kind: "p", text: "hello" }])],
    ["xlsx", buildXlsx([{ name: "S", rows: [["a", 1]] }])],
    ["csv", Buffer.from("a,b\n1,2\n")],
    ["txt", Buffer.from("héllo wörld\n")],
    ["png", PNG_BYTES],
    ["jpg", JPEG_BYTES],
    ["jpeg", JPEG_BYTES],
    ["webp", WEBP_BYTES],
  ];
  it.each(cases)("%s", (ext, bytes) => {
    expect(validateAttachmentContent(ext, bytes).ext).toBe(ext);
  });
  it("accepts UTF-8 with BOM for csv", () => {
    expect(code(() => validateAttachmentContent("csv", Buffer.from("﻿a,b\n")))).toBe("ok");
  });
});

describe("S21 size limits", () => {
  it.each([
    ["pdf", 20], ["docx", 20], ["xlsx", 20], ["csv", 10], ["txt", 5], ["png", 10], ["jpg", 10], ["jpeg", 10], ["webp", 10],
  ])("%s rejects just over %i MB", (ext, mb) => {
    const spec = specForExt(ext)!;
    // Content is irrelevant: the size check runs before sniffing.
    expect(code(() => validateAttachmentContent(ext, Buffer.alloc(mb * MB + 1, 0x41)))).toBe("too_large");
    expect(spec.maxBytes).toBe(mb * MB);
  });
  it("accepts a txt exactly at the limit and rejects empty files", () => {
    expect(code(() => validateAttachmentContent("txt", Buffer.alloc(5 * MB, 0x41)))).toBe("ok");
    expect(code(() => validateAttachmentContent("txt", Buffer.alloc(0)))).toBe("empty_file");
  });
});

describe("S21 extension / content mismatch", () => {
  it("an .exe renamed .pdf is rejected", () => {
    expect(code(() => validateAttachmentContent("pdf", EXE_BYTES))).toBe("content_mismatch");
  });
  it("a PNG named .docx is rejected", () => {
    expect(code(() => validateAttachmentContent("docx", PNG_BYTES))).toBe("content_mismatch");
  });
  it("a PDF named .png / a JPEG named .webp / PNG named .jpg are rejected", () => {
    expect(code(() => validateAttachmentContent("png", buildPdf([["x"]])))).toBe("content_mismatch");
    expect(code(() => validateAttachmentContent("webp", JPEG_BYTES))).toBe("content_mismatch");
    expect(code(() => validateAttachmentContent("jpg", PNG_BYTES))).toBe("content_mismatch");
  });
  it("a DOCX named .xlsx (and vice versa) is rejected", () => {
    expect(code(() => validateAttachmentContent("xlsx", buildDocx([{ kind: "p", text: "x" }])))).toBe("content_mismatch");
    expect(code(() => validateAttachmentContent("docx", buildXlsx([{ name: "S", rows: [["a"]] }])))).toBe("content_mismatch");
  });
  it("a generic ZIP named .docx is rejected", () => {
    expect(code(() => validateAttachmentContent("docx", buildZip([{ name: "a.txt", data: "x" }])))).toBe("content_mismatch");
  });
  it("macro-enabled packages are rejected", () => {
    const withMacro = buildDocx([{ kind: "p", text: "x" }], [{ name: "word/vbaProject.bin", data: Buffer.alloc(16, 1) }]);
    expect(code(() => validateAttachmentContent("docx", withMacro))).toBe("content_mismatch");
  });
  it("declared mime must match the extension", () => {
    const pdf = specForExt("pdf")!;
    expect(code(() => checkDeclaredMime(pdf, "application/pdf"))).toBe("ok");
    expect(code(() => checkDeclaredMime(pdf, "image/png"))).toBe("mime_mismatch");
    expect(code(() => checkDeclaredMime(pdf, ""))).toBe("mime_mismatch");
    expect(code(() => checkDeclaredMime(specForExt("csv")!, "application/vnd.ms-excel"))).toBe("ok");
    expect(code(() => checkDeclaredMime(specForExt("txt")!, ""))).toBe("ok");
  });
});

describe("S21 file names", () => {
  it.each([
    "../../etc/passwd.pdf", "..\\secret.pdf", "a/b.pdf", "a\\b.pdf", "/abs.pdf", ".hidden.pdf", "bad\u0000name.pdf", "bad\nname.pdf",
    "x‮fdp.exe.pdf", "name.pdf.", "con<>.pdf", "..pdf", "", "   ",
  ])("rejects %j", (name) => {
    expect(code(() => sanitizeAttachmentName(name))).toBe("invalid_file_name");
  });
  it.each(["report.pdf.exe", "setup.exe", "run.bat", "page.html", "image.svg", "archive.zip", "noextension", "script.js"])(
    "rejects executable / unsupported %j",
    (name) => {
      expect(["unsupported_type", "invalid_file_name"]).toContain(code(() => sanitizeAttachmentName(name)));
    },
  );
  it.each(["invoice.exe.pdf", "photo.png.jpg", "notes.txt.pdf", "a.php.docx", "x.js.png"])("rejects double extension %j", (name) => {
    expect(code(() => sanitizeAttachmentName(name))).toBe("invalid_file_name");
  });
  it("accepts ordinary names, including accents and dots in the stem", () => {
    expect(sanitizeAttachmentName("Relevé de notes 2025.PDF")).toEqual({ fileName: "Relevé de notes 2025.PDF", ext: "pdf" });
    expect(sanitizeAttachmentName("budget v1.2.xlsx").ext).toBe("xlsx");
    expect(code(() => sanitizeAttachmentName(42))).toBe("invalid_file_name");
  });
  it("produces an ASCII storage name", () => {
    expect(storageSafeName("Relevé de notes 2025.pdf", "pdf")).toBe("Releve_de_notes_2025.pdf");
    expect(storageSafeName("日本語.pdf", "pdf")).toBe("file.pdf");
  });
});

describe("S21 encrypted and hostile containers", () => {
  it("rejects an encrypted PDF", () => {
    expect(code(() => validateAttachmentContent("pdf", buildPdf([["secret"]], { encrypted: true })))).toBe("encrypted");
  });
  it("rejects legacy / password-protected OLE office files named .docx", () => {
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
    expect(code(() => validateAttachmentContent("docx", ole))).toBe("encrypted");
  });
  it("rejects a ZIP entry flagged as encrypted", () => {
    const enc = buildZip([{ name: "[Content_Types].xml", data: "x", encrypted: true }]);
    expect(code(() => validateAttachmentContent("docx", enc))).toBe("encrypted");
  });
  it("rejects a decompression bomb by compression ratio", () => {
    const bomb = buildDocx([{ kind: "p", text: "x" }], [{ name: "word/media/blob.bin", data: Buffer.alloc(30 * MB, 0) }]);
    expect(bomb.length).toBeLessThan(200 * 1024);
    expect(code(() => validateAttachmentContent("docx", bomb))).toBe("zip_bomb");
  });
  it("rejects a ZIP with too many entries", () => {
    const many = buildZip(Array.from({ length: 1500 }, (_, i) => ({ name: `f${i}.txt`, data: "x", method: "store" as const })));
    expect(code(() => validateAttachmentContent("xlsx", many))).toBe("zip_bomb");
  });
  it("never allocates beyond a lying declared size", () => {
    const real = Buffer.alloc(5 * MB, 0);
    const lying = buildZip([{ name: "a.bin", data: real, declaredSize: 1000 }]);
    const zip = openZip(lying);
    expect(() => zip.read("a.bin")).toThrowError(ZipError);
  });
  it("enforces the total-uncompressed cap and the per-entry cap", () => {
    const big = buildZip([{ name: "a.bin", data: randomBytes(3 * MB) }, { name: "b.bin", data: randomBytes(3 * MB) }]);
    expect(() => openZip(big, { maxTotalUncompressed: 4 * MB })).toThrowError(/archive expands/);
    expect(() => openZip(big, { maxEntryBytes: 2 * MB })).toThrowError(/too large/);
  });
  it("rejects zip-slip style entry names", () => {
    const evil = buildZip([{ name: "../../evil.txt", data: "x" }]);
    expect(() => openZip(evil)).toThrowError(ZipError);
  });
  it("rejects a malformed DOCX (truncated archive and corrupt deflate data)", () => {
    const good = buildDocx([{ kind: "p", text: "hello" }]);
    expect(code(() => validateAttachmentContent("docx", good.subarray(0, good.length - 30)))).toMatch(/content_mismatch|malformed/);
    const corrupt = Buffer.from(good);
    const at = corrupt.indexOf("word/document.xml") + "word/document.xml".length + 4;
    for (let i = 0; i < 20; i++) corrupt[at + i] = 0xff;
    expect(["malformed", "content_mismatch"]).toContain(code(() => validateAttachmentContent("docx", corrupt)));
  });
  it("rejects a DOCX without word/document.xml as malformed", () => {
    const noMain = buildZip([{ name: "[Content_Types].xml", data: "<Types/>" }]);
    expect(code(() => validateAttachmentContent("docx", noMain))).toBe("malformed");
  });
});

describe("S21 text files", () => {
  it("rejects NUL bytes in csv and txt", () => {
    expect(code(() => validateAttachmentContent("csv", Buffer.from("a,b\0\n1,2")))).toBe("content_mismatch");
    expect(code(() => validateAttachmentContent("txt", Buffer.from("hello\0world")))).toBe("content_mismatch");
  });
  it("rejects invalid UTF-8 and binary control characters", () => {
    expect(code(() => validateAttachmentContent("txt", Buffer.from([0x68, 0xff, 0xfe, 0x69])))).toBe("content_mismatch");
    expect(code(() => validateAttachmentContent("csv", Buffer.from("a,b\u0001\n")))).toBe("content_mismatch");
  });
  it("a PDF named .txt is rejected (binary stream bytes)", () => {
    const pdf = buildPdf([["hello"]]);
    expect(code(() => validateAttachmentContent("txt", pdf))).toBe("content_mismatch");
  });
});
