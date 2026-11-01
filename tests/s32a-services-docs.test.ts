import { describe, expect, it } from "vitest";
import { presentDocumentForViewer } from "../server/lib/document-presenter";
import { documentsTabFromSearch, resolveUploadDocType, reviewMessageOf, uploadTypeOptions, ALL_TAB_DOC_TYPES } from "../client/src/lib/s32-services-docs";
import { docTypeEnum } from "../shared/schema";

describe("S32 F10 upload type mapping", () => {
  it("All tab never files as a high-school transcript by default, for any program", () => {
    expect(resolveUploadDocType({ tab: "all", hasHighSchool: true })).toBe("other");
    expect(resolveUploadDocType({ tab: "all", hasHighSchool: false })).toBe("other");
  });
  it("a student choice on the All tab is honoured; unknown choices fall back to other", () => {
    expect(resolveUploadDocType({ tab: "all", selected: "college_transcript", hasHighSchool: false })).toBe("college_transcript");
    expect(resolveUploadDocType({ tab: "all", selected: "chat_attachment", hasHighSchool: false })).toBe("other");
  });
  it("Academic tab defaults to hs_transcript only for high-school students", () => {
    expect(resolveUploadDocType({ tab: "academic", hasHighSchool: true })).toBe("hs_transcript");
    expect(resolveUploadDocType({ tab: "academic", hasHighSchool: false })).toBe("other");
  });
  it("fixed tabs and replacements keep their types", () => {
    expect(resolveUploadDocType({ tab: "identity", hasHighSchool: false })).toBe("id_gov");
    expect(resolveUploadDocType({ tab: "financial", hasHighSchool: false })).toBe("other");
    expect(resolveUploadDocType({ tab: "all", override: "id_gov", hasHighSchool: false })).toBe("id_gov");
    expect(uploadTypeOptions("identity")).toBeNull();
  });
  it("every offered type is accepted by the server enum", () => {
    for (const t of ALL_TAB_DOC_TYPES) expect(docTypeEnum.safeParse(t).success).toBe(true);
  });
});

describe("S32 ?tab= on /documents", () => {
  it("reads known tab ids and ignores others", () => {
    expect(documentsTabFromSearch("?tab=financial")).toBe("financial");
    expect(documentsTabFromSearch("?tab=academic")).toBe("academic");
    expect(documentsTabFromSearch("?tab=all")).toBe("all");
    expect(documentsTabFromSearch("?tab=nope")).toBe("all");
    expect(documentsTabFromSearch("")).toBe("all");
  });
});

describe("S32 F09 library reads the presenter's review_message", () => {
  const row = { id: "d1", status: "rejected", doc_type: "hs_transcript", file_name: "a.pdf", student_message: "Scan is unreadable", admin_notes: "internal" };
  it("real presenter output shows the reason; student_message is stripped", () => {
    const out = presentDocumentForViewer({ role: "student" }, row) as any;
    expect(out.student_message).toBeUndefined();
    expect(reviewMessageOf(out)).toBe("Scan is unreadable");
    expect(JSON.stringify(out)).not.toContain("internal");
  });
  it("no reason for verified/pending, and null when empty", () => {
    expect(reviewMessageOf({ status: "verified", review_message: "x" })).toBeNull();
    expect(reviewMessageOf({ status: "resubmit_requested", review_message: null })).toBeNull();
    expect(reviewMessageOf({ status: "rejected", student_message: "legacy" })).toBe("legacy");
  });
});
