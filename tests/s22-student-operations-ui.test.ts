import { describe, expect, it } from "vitest";
import { canActivateLeadForRole, canUploadDocumentOnBehalfForRole, STAFF_DOCUMENT_MAX_BYTES, validateStaffDocumentFile } from "../client/src/components/admin/student-documents-upload-logic";

describe("staff student-document upload validation", () => {
  it("accepts established formats up to 10 MB", () => {
    for (const name of ["record.pdf", "scan.JPG", "transcript.docx"]) {
      expect(validateStaffDocumentFile({ name, size: STAFF_DOCUMENT_MAX_BYTES })).toEqual({ valid: true });
    }
  });
  it("rejects empty, oversized, and unsupported files", () => {
    expect(validateStaffDocumentFile({ name: "record.pdf", size: 0 }).valid).toBe(false);
    expect(validateStaffDocumentFile({ name: "record.pdf", size: STAFF_DOCUMENT_MAX_BYTES + 1 }).valid).toBe(false);
    expect(validateStaffDocumentFile({ name: "script.exe", size: 25 }).valid).toBe(false);
  });
  it("allows only admins to activate leads", () => {
    expect(canActivateLeadForRole("admin", "lead")).toBe(true);
    for (const role of ["staff", "student", "coach", undefined]) expect(canActivateLeadForRole(role, "lead")).toBe(false);
    expect(canActivateLeadForRole("admin", "active")).toBe(false);
  });
  it("allows only existing staff/admin policy to upload on behalf", () => {
    for (const role of ["admin", "staff"]) expect(canUploadDocumentOnBehalfForRole(role)).toBe(true);
    for (const role of ["student", "coach", undefined]) expect(canUploadDocumentOnBehalfForRole(role)).toBe(false);
  });
});
