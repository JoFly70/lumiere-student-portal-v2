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

/** What the storage server actually accepts (server/lib/document-storage.ts). DOC/XLS pass the legacy check above but are refused at upload-url. */
export const STAFF_UPLOAD_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";
const SERVER_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
};
export const STAFF_UPLOAD_MIMES: readonly string[] = ["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"];

/** MIME type to send for a file: the browser's when it is allowed, otherwise derived from a PDF/PNG/JPG/WebP extension; null = not uploadable. */
export function staffUploadMime(file: Pick<File, "name" | "type">): string | null {
  if (STAFF_UPLOAD_MIMES.includes(file.type)) return file.type;
  return SERVER_MIME_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

export function validateStaffUploadFile(file: Pick<File, "name" | "size" | "type">): UploadFileValidation {
  if (file.size <= 0) return { valid: false, message: "Choose a non-empty file." };
  if (file.size > STAFF_DOCUMENT_MAX_BYTES) return { valid: false, message: "Files must be 10 MB or smaller." };
  if (!staffUploadMime(file)) return { valid: false, message: "Choose a PDF, PNG, JPG, or WebP file." };
  return { valid: true };
}
