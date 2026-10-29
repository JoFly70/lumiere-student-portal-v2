/**
 * Admin student activity feed (mounted under /api/admin): the last 50 audit_logs rows about one student.
 * Admin only, read-only, no-store. Matches the audit target (target_resource_id = student id) or the
 * student's linked portal account (target_user_id = students.user_id). Metadata is NOT returned.
 */
import { Router, type Request, type RequestHandler, type Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { emitAccessDenied } from "./high-school-audit";
import { guardRoles } from "./high-school-http";

export interface StudentActivityItem {
  id: string;
  eventType: string;
  severity: string;
  description: string;
  actorRole: string | null;
  createdAt: string | null;
}

export interface StudentActivityDeps {
  list: (studentId: string) => Promise<StudentActivityItem[]>;
  auth?: RequestHandler;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAdminStudentActivityRouter(deps: StudentActivityDeps) {
  const router = Router();
  const auth: RequestHandler = deps.auth ?? (requireAuth as unknown as RequestHandler);
  router.get("/students/:id/activity", auth, guardRoles(["admin"], emitAccessDenied), async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const id = String(req.params.id ?? "");
    if (!UUID.test(id)) return res.status(400).json({ error: "Invalid student id" });
    try {
      return res.json({ events: await deps.list(id) });
    } catch (error) {
      logger.error("Student activity failed", { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: "Student activity unavailable" });
    }
  });
  return router;
}

async function listActivity(studentId: string): Promise<StudentActivityItem[]> {
  const { db } = await import("../lib/db");
  const res = await db.execute(sql`
    SELECT a.id::text AS id, a.event_type::text AS event_type, a.severity::text AS severity,
           a.action_description, a.actor_role::text AS actor_role, a.created_at
      FROM audit_logs a
     WHERE a.target_resource_id::text = ${studentId}
        OR a.target_user_id::text = (SELECT s.user_id::text FROM students s WHERE s.id::text = ${studentId})
     ORDER BY a.created_at DESC
     LIMIT 50`);
  const rows = Array.from(res as unknown as Array<Record<string, unknown>>);
  return rows.map((r) => ({
    id: String(r.id),
    eventType: String(r.event_type ?? ""),
    severity: String(r.severity ?? "info"),
    description: String(r.action_description ?? ""),
    actorRole: r.actor_role ? String(r.actor_role) : null,
    createdAt: r.created_at ? (r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)) : null,
  }));
}

export default createAdminStudentActivityRouter({ list: listActivity });
