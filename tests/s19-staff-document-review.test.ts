import { describe, expect, it } from "vitest";
import { presentDocumentForViewer } from "../server/lib/document-presenter";
import { buildDocumentReviewPayload } from "../client/src/components/admin/document-review-dialog";

const row = { id: "d1", student_id: "s1", status: "rejected", admin_notes: "INTERNAL: forged?", student_message: "Please upload a clearer scan", ocr_text: "x", storage_path: "p", url: "u" };

describe("S19 staff document review", () => {
  it("dialog payload keeps the student reason and the internal note in separate fields, reason required", () => {
    expect(buildDocumentReviewPayload("   ", "internal")).toBeNull();
    expect(buildDocumentReviewPayload(" Blurry ", " looks edited ")).toEqual({ student_message: "Blurry", admin_notes: "looks edited" });
    expect(buildDocumentReviewPayload("Blurry", "")).toEqual({ student_message: "Blurry" });
  });
  it("students never receive the internal note, only the student-facing reason", () => {
    for (const status of ["rejected", "resubmit_requested"]) {
      const out = presentDocumentForViewer({ role: "student" }, { ...row, status });
      expect(out.review_message).toBe("Please upload a clearer scan");
      expect(JSON.stringify(out)).not.toMatch(/INTERNAL|admin_notes|student_message/);
    }
    expect(presentDocumentForViewer({ role: "student" }, { ...row, status: "verified" }).review_message).toBeNull();
  });
  it("staff see both texts", () => {
    expect(presentDocumentForViewer({ role: "staff" }, row)).toMatchObject({ admin_notes: "INTERNAL: forged?", student_message: "Please upload a clearer scan" });
  });
});
