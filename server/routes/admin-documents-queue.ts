/**
 * Admin documents review queue (mounted under /api/admin): documents awaiting staff review
 * across all students. Admin/staff only, read-only, newest-first, capped at 50.
 */
import { Router, type Request, type RequestHandler, type Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { emitAccessDenied } from "./high-school-audit";
import { guardRoles } from "./high-school-http";

export interface DocumentQueueItem {
  documentId: string;
  studentId: string;
  studentName: string;
  docType: string;
  uploadedAt: string | null;
}

export interface DocumentsQueueDeps {
  list: () => Promise<DocumentQueueItem[]>;
  auth?: RequestHandler;
}

export function createAdminDocumentsQueueRouter(deps: DocumentsQueueDeps) {
  const router = Router();
  const auth: RequestHandler = deps.auth ?? (requireAuth as unknown as RequestHandler);
  router.get("/documents/queue", auth, guardRoles(["admin", "staff"], emitAccessDenied), async (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      return res.json({ documents: await deps.list() });
    } catch (error) {
      logger.error("Documents queue failed", { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: "Documents queue unavailable" });
    }
  });
  return router;
}

async function listPending(): Promise<DocumentQueueItem[]> {
  const { db } = await import("../lib/db");
  const res = await db.execute(sql`
    SELECT d.id::text AS id, d.student_id::text AS student_id, d.doc_type::text AS doc_type, d.uploaded_at,
           s.first_name, s.last_name, s.preferred_name
      FROM student_documents d JOIN students s ON s.id = d.student_id
     WHERE d.status::text IN ('pending', 'resubmit_requested')
       AND NOT d.soft_deleted
       AND d.doc_type::text <> 'chat_attachment'
     ORDER BY d.uploaded_at DESC NULLS LAST
     LIMIT 50`);
  const rows = Array.from(res as unknown as Array<Record<string, unknown>>);
  return rows.map((r) => ({
    documentId: String(r.id),
    studentId: String(r.student_id),
    studentName: `${(r.preferred_name as string) || (r.first_name as string) || ""} ${(r.last_name as string) || ""}`.trim(),
    docType: String(r.doc_type),
    uploadedAt: r.uploaded_at ? (r.uploaded_at instanceof Date ? r.uploaded_at.toISOString() : String(r.uploaded_at)) : null,
  }));
}

export default createAdminDocumentsQueueRouter({ list: listPending });
