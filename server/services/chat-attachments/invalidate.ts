import { sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import { logger } from '../../lib/logger';

/**
 * Remove a document's extracted text and mark it unindexed. Called from the document-service delete paths.
 * Best-effort by design: a failure is logged and never blocks the delete (retrieval also joins
 * student_documents.soft_deleted = false, so stale chunks of a deleted document are never served).
 */
export async function invalidateDocumentIndex(documentId: string): Promise<void> {
  try {
    await db.execute(sql`DELETE FROM student_document_text WHERE document_id = ${documentId}`);
    await db.execute(sql`UPDATE student_documents SET extraction_status = 'stored_only' WHERE id = ${documentId} AND extraction_status IS NOT NULL`);
  } catch (err) {
    logger.warn('Document index invalidation failed', { documentId, error: (err as Error).message });
  }
}
