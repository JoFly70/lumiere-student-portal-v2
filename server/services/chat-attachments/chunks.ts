/**
 * Read API for indexed attachment text (used by the private-retrieval layer).
 * Always joins student_documents so soft-deleted documents never surface, and always filters by owner.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../lib/db';

export interface DocumentChunk {
  documentId: string;
  fileName: string;
  chunkIndex: number;
  location: string | null;
  content: string;
}

export async function getDocumentChunks(studentId: string, documentId: string, limit = 50): Promise<DocumentChunk[]> {
  const rows = (await db.execute(sql`
    SELECT t.document_id, d.file_name, t.chunk_index, t.location, t.content
    FROM student_document_text t
    JOIN student_documents d ON d.id = t.document_id
    WHERE t.student_id = ${studentId} AND d.student_id = ${studentId} AND d.id = ${documentId} AND d.soft_deleted = false
    ORDER BY t.chunk_index ASC
    LIMIT ${Math.max(1, Math.min(limit, 400))}`)) as unknown as Array<Record<string, unknown>>;
  return Array.from(rows).map(toChunk);
}

/** Full-text search (simple config, matches the generated search_vector) across the student's own documents. */
export async function searchDocumentChunks(studentId: string, query: string, limit = 10, onlyDocumentIds?: readonly string[]): Promise<Array<DocumentChunk & { rank: number }>> {
  const q = query.trim().slice(0, 200);
  if (!q) return [];
  const filter = onlyDocumentIds && onlyDocumentIds.length > 0
    ? sql`AND d.id IN (${sql.join(onlyDocumentIds.map((id) => sql`${id}`), sql`, `)})`
    : sql``;
  const rows = (await db.execute(sql`
    SELECT t.document_id, d.file_name, t.chunk_index, t.location, t.content,
           ts_rank(t.search_vector, plainto_tsquery('simple', ${q})) AS rank
    FROM student_document_text t
    JOIN student_documents d ON d.id = t.document_id
    WHERE t.student_id = ${studentId} AND d.student_id = ${studentId} AND d.soft_deleted = false
      AND t.search_vector @@ plainto_tsquery('simple', ${q}) ${filter}
    ORDER BY rank DESC, t.chunk_index ASC
    LIMIT ${Math.max(1, Math.min(limit, 50))}`)) as unknown as Array<Record<string, unknown>>;
  return Array.from(rows).map((r) => ({ ...toChunk(r), rank: Number(r.rank) || 0 }));
}

function toChunk(r: Record<string, unknown>): DocumentChunk {
  return {
    documentId: String(r.document_id),
    fileName: String(r.file_name),
    chunkIndex: Number(r.chunk_index),
    location: (r.location as string | null) ?? null,
    content: String(r.content),
  };
}
