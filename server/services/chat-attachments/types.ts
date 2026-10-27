export type ExtractionStatusValue = 'indexed' | 'stored_only' | 'failed' | 'pending';

export interface AttachableDocument {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  docType: string;
  source: 'documents' | 'chat';
  status: string;
  uploadedAt: string;
  extractionStatus: ExtractionStatusValue | null;
}

export interface StudentRef {
  id: string;
  student_code: string;
}

export interface DocumentChunkInput {
  chunkIndex: number;
  location: string;
  content: string;
}

export interface InsertAttachmentInput {
  studentId: string;
  fileName: string;
  storagePath: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  extractionStatus: ExtractionStatusValue;
  chunks: DocumentChunkInput[];
  quotaBytes: number;
}

export interface InsertAttachmentResult {
  document: AttachableDocument;
  /** True when an identical (same sha256) non-deleted document already existed and was returned instead. */
  deduplicated: boolean;
}

/** Persistence boundary (default: drizzle over DATABASE_URL). Injectable for tests. */
export interface AttachmentRepo {
  usedBytes(studentId: string): Promise<number>;
  quotaOverride(studentId: string): Promise<number | null>;
  findByStoragePath(studentId: string, storagePath: string): Promise<AttachableDocument | null>;
  /**
   * One transaction, serialised per student (advisory lock): re-checks duplicate sha256 and quota, inserts
   * the student_documents row (source 'chat') and its student_document_text chunks.
   * Throws AttachmentError('quota_exceeded') when the quota would be exceeded.
   */
  insertWithChunks(input: InsertAttachmentInput): Promise<InsertAttachmentResult>;
  listSelectable(studentId: string): Promise<AttachableDocument[]>;
}

/** Storage boundary (default: Supabase `student-documents` bucket). */
export interface AttachmentStorage {
  createSignedUpload(studentCode: string, safeFileName: string): Promise<{ uploadUrl: string; uploadToken: string; storagePath: string; expiresIn: number }>;
  /** Size in bytes (null when the store does not report one) or null when the object does not exist. Throws when storage is unavailable. */
  stat(storagePath: string): Promise<{ size: number | null } | null>;
  /** Download the object. Callers must have bounded the size with stat() first. */
  download(storagePath: string): Promise<Buffer>;
  remove(storagePath: string): Promise<void>;
  publicUrl(storagePath: string): string;
}

export type AttachmentErrorCode =
  | 'invalid_request'
  | 'invalid_file_name'
  | 'invalid_storage_path'
  | 'unsupported_type'
  | 'mime_mismatch'
  | 'content_mismatch'
  | 'encrypted'
  | 'malformed'
  | 'zip_bomb'
  | 'empty_file'
  | 'too_large'
  | 'quota_exceeded'
  | 'not_uploaded'
  | 'not_found'
  | 'storage_unavailable';

const STATUS: Record<AttachmentErrorCode, number> = {
  invalid_request: 400,
  invalid_file_name: 400,
  invalid_storage_path: 400,
  unsupported_type: 415,
  mime_mismatch: 415,
  content_mismatch: 415,
  encrypted: 415,
  malformed: 415,
  zip_bomb: 415,
  empty_file: 400,
  too_large: 413,
  quota_exceeded: 413,
  not_uploaded: 400,
  not_found: 404,
  storage_unavailable: 503,
};

export class AttachmentError extends Error {
  readonly status: number;
  constructor(readonly code: AttachmentErrorCode, message: string) {
    super(message);
    this.name = 'AttachmentError';
    this.status = STATUS[code];
  }
}
