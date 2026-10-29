import { describe, expect, it } from "vitest";
import { documentStorage } from "../server/lib/document-storage";
const { ALLOWED_MIME_TYPES, MAX_FILE_SIZE } = documentStorage as any;
import { DOCUMENT_ALLOWED_MIME_TYPES, DOCUMENT_MAX_BYTES, DOCUMENT_ACCEPT_ATTR, checkDocumentFile } from "../client/src/lib/document-upload-policy";
import { en } from "../client/src/i18n/en";
import { fr } from "../client/src/i18n/fr";

describe("student document upload policy parity", () => {
  it("client mirrors the server allow-list and limit", () => {
    expect([...DOCUMENT_ALLOWED_MIME_TYPES].sort()).toEqual([...ALLOWED_MIME_TYPES].sort());
    expect(DOCUMENT_MAX_BYTES).toBe(MAX_FILE_SIZE);
    expect(DOCUMENT_ACCEPT_ATTR).not.toMatch(/doc|xls/);
  });
  it("rejects office files and oversize files, accepts pdf/images", () => {
    expect(checkDocumentFile({ name: "a.docx", size: 10, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe("badType");
    expect(checkDocumentFile({ name: "a.pdf", size: DOCUMENT_MAX_BYTES + 1, type: "application/pdf" })).toBe("tooLarge");
    expect(checkDocumentFile({ name: "a.pdf", size: 10, type: "application/pdf" })).toBeNull();
    expect(checkDocumentFile({ name: "a.webp", size: 10, type: "" })).toBeNull();
  });
  it("copy no longer advertises office formats", () => {
    for (const d of [en, fr] as Record<string, string>[]) {
      expect(d["documents.accepted"]).not.toMatch(/DOCX?|XLSX?/);
      expect(d["documents.accepted"]).toMatch(/WEBP/);
    }
  });
});
