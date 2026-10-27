/**
 * Chat attachment service. Reuses the Documents system: same bucket, same student_documents rows
 * (source = 'chat', doc_type = 'chat_attachment'), same signed-URL download route. Adds real content
 * validation, a per-student storage quota, SHA-256 de-duplication and bounded local text indexing.
 */
import { createHash } from 'node:crypto';
import { documentStorage } from '../../lib/document-storage';
import {
  ATTACHMENT_STORAGE_DOC_TYPE,
  AttachmentPolicyError,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_BYTES_PER_MESSAGE,
  checkDeclaredMime,
  defaultQuotaBytes,
  policyTable,
  sanitizeAttachmentName,
  specForExt,
  storageSafeName,
  validateAttachmentContent,
} from '../../lib/attachment-policy';
import { logger } from '../../lib/logger';
import { extractDocumentText } from '../document-extraction';
import {
  AttachmentError,
  type AttachableDocument,
  type AttachmentRepo,
  type AttachmentStorage,
  type StudentRef,
} from './types';

export interface AttachmentServiceDeps {
  repo: AttachmentRepo;
  storage: AttachmentStorage;
  /** Default quota in bytes (env STUDENT_STORAGE_QUOTA_MB, 250 MB). */
  defaultQuotaBytes?: () => number;
}

function fromPolicy(err: unknown): never {
  if (err instanceof AttachmentPolicyError) throw new AttachmentError(err.code, err.message);
  throw err;
}

export function createAttachmentService(deps: AttachmentServiceDeps) {
  const { repo, storage } = deps;
  const defaultQuota = deps.defaultQuotaBytes ?? (() => defaultQuotaBytes());

  async function quotaFor(studentId: string): Promise<number> {
    return (await repo.quotaOverride(studentId)) ?? defaultQuota();
  }

  async function policy(student: StudentRef) {
    const [quotaBytes, usedBytes] = await Promise.all([quotaFor(student.id), repo.usedBytes(student.id)]);
    return {
      types: policyTable(),
      maxPerMessage: MAX_ATTACHMENTS_PER_MESSAGE,
      maxBytesPerMessage: MAX_BYTES_PER_MESSAGE,
      quotaBytes,
      usedBytes,
    };
  }

  async function createUploadUrl(student: StudentRef, input: { fileName: unknown; sizeBytes: number; mimeType: unknown }) {
    let name;
    let spec;
    try {
      name = sanitizeAttachmentName(input.fileName);
      spec = specForExt(name.ext)!;
      checkDeclaredMime(spec, input.mimeType);
    } catch (err) {
      fromPolicy(err);
    }
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) throw new AttachmentError('empty_file', 'File is empty');
    if (input.sizeBytes > spec.maxBytes) {
      throw new AttachmentError('too_large', `File exceeds the ${Math.round(spec.maxBytes / 1048576)} MB limit for .${spec.ext}`);
    }
    const [quota, used] = await Promise.all([quotaFor(student.id), repo.usedBytes(student.id)]);
    if (used + input.sizeBytes > quota) throw new AttachmentError('quota_exceeded', 'Your storage quota is full. Delete some files first.');

    let upload;
    try {
      upload = await storage.createSignedUpload(student.student_code, storageSafeName(name.fileName, name.ext));
    } catch (err) {
      logger.error('Attachment upload URL failed', { studentId: student.id, error: (err as Error).message });
      throw new AttachmentError('storage_unavailable', 'File storage is temporarily unavailable');
    }
    return upload;
  }

  async function discard(storagePath: string): Promise<void> {
    try {
      await storage.remove(storagePath);
    } catch (err) {
      logger.warn('Could not delete rejected attachment object', { storagePath, error: (err as Error).message });
    }
  }

  async function finalize(student: StudentRef, input: { storagePath: string; fileName: string }): Promise<{ document: AttachableDocument; deduplicated: boolean }> {
    const { storagePath } = input;
    // 1. The path must be one this server issued for THIS student's chat attachments.
    if (!documentStorage.isStoragePathForStudent(storagePath, student.student_code, [ATTACHMENT_STORAGE_DOC_TYPE])) {
      throw new AttachmentError('invalid_storage_path', 'storagePath was not issued for this student');
    }
    let name;
    try {
      name = sanitizeAttachmentName(input.fileName);
    } catch (err) {
      fromPolicy(err);
    }
    const objectName = storagePath.slice(storagePath.lastIndexOf('/') + 1);
    if (!objectName.toLowerCase().endsWith(`.${name.ext}`)) {
      throw new AttachmentError('invalid_storage_path', 'storagePath does not match the file name');
    }

    // Idempotent retry of a finalize that already succeeded.
    const existingForPath = await repo.findByStoragePath(student.id, storagePath);
    if (existingForPath) return { document: existingForPath, deduplicated: true };

    // 2. The object must really exist; bound its size BEFORE downloading it.
    let stat;
    try {
      stat = await storage.stat(storagePath);
    } catch (err) {
      logger.error('Attachment stat failed', { studentId: student.id, error: (err as Error).message });
      throw new AttachmentError('storage_unavailable', 'File storage is temporarily unavailable');
    }
    if (!stat) throw new AttachmentError('not_uploaded', 'The file has not been uploaded');

    try {
      const spec = specForExt(name.ext)!;
      if (stat.size !== null && stat.size > Math.min(spec.maxBytes, MAX_ATTACHMENT_BYTES)) {
        throw new AttachmentError('too_large', `File exceeds the ${Math.round(spec.maxBytes / 1048576)} MB limit for .${spec.ext}`);
      }
      let bytes: Buffer;
      try {
        bytes = await storage.download(storagePath);
      } catch (err) {
        logger.error('Attachment download failed', { studentId: student.id, error: (err as Error).message });
        throw new AttachmentError('storage_unavailable', 'File storage is temporarily unavailable');
      }

      // 3. Real content validation (magic bytes, size, encryption, bombs).
      let validated;
      try {
        validated = validateAttachmentContent(name.ext, bytes);
      } catch (err) {
        fromPolicy(err);
      }

      // 4. Quota + de-duplication are decided inside the insert transaction (serialised per student).
      const quota = await quotaFor(student.id);
      const sha256 = createHash('sha256').update(bytes).digest('hex');

      // 5. Bounded local extraction. Never fails the upload.
      const extraction = extractDocumentText(name.ext, bytes);
      if (extraction.status !== 'indexed') {
        logger.info('Attachment stored without text index', { studentId: student.id, ext: name.ext, reason: extraction.reason });
      }

      const result = await repo.insertWithChunks({
        studentId: student.id,
        fileName: name.fileName,
        storagePath,
        url: storage.publicUrl(storagePath),
        mimeType: validated.mime,
        sizeBytes: bytes.length,
        sha256,
        extractionStatus: extraction.status,
        chunks: extraction.chunks,
        quotaBytes: quota,
      });
      if (result.deduplicated && result.document.id) {
        // Identical content already stored for this student: drop the redundant object.
        await discard(storagePath);
      }
      return result;
    } catch (err) {
      if (!(err instanceof AttachmentError) || err.code !== 'storage_unavailable') await discard(storagePath);
      if (err instanceof AttachmentError) throw err;
      logger.error('Attachment finalize failed', { studentId: student.id, error: (err as Error).message });
      throw err;
    }
  }

  return {
    policy,
    createUploadUrl,
    finalize,
    listSelectable: (student: StudentRef) => repo.listSelectable(student.id),
  };
}

export type AttachmentService = ReturnType<typeof createAttachmentService>;
