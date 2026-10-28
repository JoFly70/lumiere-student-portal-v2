export const STAFF_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const STAFF_DOCUMENT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx";
const allowedExtensions = new Set(["pdf", "png", "jpg", "jpeg", "doc", "docx", "xls", "xlsx"]);

export type UploadFileValidation =
  | { valid: true }
  | { valid: false; message: string };

export function canActivateLeadForRole(role: string | undefined, status: string): boolean {
  return role === "admin" && status.toLowerCase() === "lead";
}

export function canUploadDocumentOnBehalfForRole(role: string | undefined): boolean {
  return role === "admin" || role === "staff";
}

export function validateStaffDocumentFile(file: Pick<File, "name" | "size">): UploadFileValidation {
  if (file.size <= 0) return { valid: false, message: "Choose a non-empty file." };
  if (file.size > STAFF_DOCUMENT_MAX_BYTES) return { valid: false, message: "Files must be 10 MB or smaller." };
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!allowedExtensions.has(extension)) return { valid: false, message: "Choose a PDF, PNG, JPG, DOC, DOCX, XLS, or XLSX file." };
  return { valid: true };
}
