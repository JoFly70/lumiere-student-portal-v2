/**
 * Student document upload policy. MUST mirror server/lib/document-storage.ts
 * (ALLOWED_MIME_TYPES, MAX_FILE_SIZE); tests/student-documents-policy.test.ts enforces parity.
 */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
] as const;
export const DOCUMENT_ACCEPT_ATTR = ".pdf,.png,.jpg,.jpeg,.webp";

const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Resolve the MIME type the server will see (browser type, falling back to the extension). */
export function resolveDocumentMime(file: { name: string; type?: string }): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_MIME[ext] ?? "application/octet-stream";
}

export type DocumentFileProblem = "tooLarge" | "badType" | null;

export function checkDocumentFile(file: { name: string; size: number; type?: string }): DocumentFileProblem {
  if (file.size > DOCUMENT_MAX_BYTES) return "tooLarge";
  if (!(DOCUMENT_ALLOWED_MIME_TYPES as readonly string[]).includes(resolveDocumentMime(file))) return "badType";
  return null;
}
