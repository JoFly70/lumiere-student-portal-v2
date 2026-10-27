import { sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import { specForExt } from '../../lib/attachment-policy';
import {
  AttachmentError,
  type AttachableDocument,
  type AttachmentRepo,
  type ExtractionStatusValue,
  type InsertAttachmentInput,
  type InsertAttachmentResult,
} from './types';

type Row = Record<string, unknown>;

const rowsOf = (res: unknown): Row[] => Array.from(res as unknown as Row[]);

const DOC_COLUMNS = sql`id::text AS id, file_name, mime_type, size_bytes, doc_type::text AS doc_type, source, status::text AS status,
  uploaded_at, extraction_status`;

export function toAttachable(r: Row): AttachableDocument {
  const fileName = String(r.file_name ?? '');
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1) : '';
  const uploaded = r.uploaded_at instanceof Date ? r.uploaded_at : new Date(String(r.uploaded_at));
  return {
    id: String(r.id),
    fileName,
    mimeType: typeof r.mime_type === 'string' && r.mime_type ? r.mime_type : specForExt(ext)?.mime ?? 'application/octet-stream',
    sizeBytes: Number(r.size_bytes ?? 0) || 0,
    docType: String(r.doc_type),
    source: r.source === 'chat' ? 'chat' : 'documents',
    status: String(r.status),
    uploadedAt: Number.isNaN(uploaded.getTime()) ? new Date(0).toISOString() : uploaded.toISOString(),
    extractionStatus: (r.extraction_status as ExtractionStatusValue | null) ?? null,
  };
}

export const drizzleAttachmentRepo: AttachmentRepo = {
  async usedBytes(studentId) {
    const rows = rowsOf(
      await db.execute(sql`SELECT COALESCE(SUM(size_bytes), 0)::text AS used FROM student_documents WHERE student_id = ${studentId} AND soft_deleted = false`),
    );
    return Number(rows[0]?.used ?? 0) || 0;
  },

  async quotaOverride(studentId) {
    const rows = rowsOf(await db.execute(sql`SELECT quota_bytes::text AS q FROM student_storage_quota WHERE student_id = ${studentId}`));
    return rows[0] ? Number(rows[0].q) : null;
  },

  async findByStoragePath(studentId, storagePath) {
    const rows = rowsOf(
      await db.execute(
        sql`SELECT ${DOC_COLUMNS} FROM student_documents WHERE student_id = ${studentId} AND storage_path = ${storagePath} AND soft_deleted = false LIMIT 1`,
      ),
    );
    return rows[0] ? toAttachable(rows[0]) : null;
  },

  async insertWithChunks(input: InsertAttachmentInput): Promise<InsertAttachmentResult> {
    return db.transaction(async (tx) => {
      // Serialise finalizes per student so quota and de-duplication cannot race.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'s21-attach:' + input.studentId}))`);

      const dup = rowsOf(
        await tx.execute(
          sql`SELECT ${DOC_COLUMNS} FROM student_documents
              WHERE student_id = ${input.studentId} AND content_sha256 = ${input.sha256} AND soft_deleted = false
              ORDER BY uploaded_at ASC LIMIT 1`,
        ),
      );
      if (dup[0]) return { document: toAttachable(dup[0]), deduplicated: true };

      const used = rowsOf(
        await tx.execute(sql`SELECT COALESCE(SUM(size_bytes), 0)::text AS used FROM student_documents WHERE student_id = ${input.studentId} AND soft_deleted = false`),
      );
      if ((Number(used[0]?.used ?? 0) || 0) + input.sizeBytes > input.quotaBytes) {
        throw new AttachmentError('quota_exceeded', 'Your storage quota is full. Delete some files first.');
      }

      const inserted = rowsOf(
        await tx.execute(sql`
          INSERT INTO student_documents
            (student_id, doc_type, file_name, url, storage_path, visibility, required_for_enrollment, status, verified, soft_deleted,
             source, mime_type, size_bytes, content_sha256, extraction_status)
          VALUES
            (${input.studentId}, 'chat_attachment', ${input.fileName}, ${input.url}, ${input.storagePath}, 'student_staff', false, 'pending', false, false,
             'chat', ${input.mimeType}, ${input.sizeBytes}, ${input.sha256}, ${input.extractionStatus})
          RETURNING ${DOC_COLUMNS}`),
      );
      const doc = toAttachable(inserted[0]);

      // Batched insert of chunks (parameter limit safe: 4 params per row, <= 400 rows).
      if (input.chunks.length > 0) {
        const values = input.chunks.map((c) => sql`(${doc.id}, ${input.studentId}, ${c.chunkIndex}, ${c.location}, ${c.content})`);
        await tx.execute(sql`INSERT INTO student_document_text (document_id, student_id, chunk_index, location, content) VALUES ${sql.join(values, sql`, `)}`);
      }
      return { document: doc, deduplicated: false };
    });
  },

  async listSelectable(studentId) {
    const rows = rowsOf(
      await db.execute(
        sql`SELECT ${DOC_COLUMNS} FROM student_documents
            WHERE student_id = ${studentId} AND soft_deleted = false AND visibility::text <> 'staff_only'
            ORDER BY uploaded_at DESC, created_at DESC LIMIT 200`,
      ),
    );
    return rows.map(toAttachable);
  },
};
