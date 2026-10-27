/**
 * Student billing API (S18), mounted under /api/student. READ ONLY.
 *
 *   GET /api/student/billing -> StudentBillingView
 *
 * The student is resolved ONLY from the authenticated user. A studentId in the
 * query or body is rejected with 400 before any data access. There is no write route.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { getStudentByUserId } from "../repositories/student-academic-repo";
import { BILLING_ERROR_CODES as E } from "@shared/billing-contract";
import { toBillingUnavailable, type BillingService } from "../services/billing-service";
import { mentionsStudentId, sendBillingError } from "./billing-http";

export interface StudentBillingRouterDeps {
  readonly getStudentByUserId: (userId: string) => Promise<{ readonly id: string } | null>;
  readonly service: Pick<BillingService, "getStudentView">;
}

export function createStudentBillingRouter(deps: StudentBillingRouterDeps) {
  const router = Router();

  router.get("/billing", requireAuth, requireRole(["student"]), async (req: Request, res: Response) => {
    try {
      if (mentionsStudentId(req)) {
        return res.status(400).json({ error: { code: E.STUDENT_ID_NOT_ACCEPTED, message: "studentId is not accepted; the student is resolved from your login" } });
      }
      const student = await deps.getStudentByUserId(req.user!.id);
      if (!student) return res.status(404).json({ error: { code: E.STUDENT_NOT_FOUND, message: "No student profile found for this account" } });
      res.setHeader("Cache-Control", "no-store");
      return res.json(await deps.service.getStudentView(student.id));
    } catch (error) {
      return sendBillingError(res, toBillingUnavailable(error), "student view");
    }
  });

  return router;
}

export function createDefaultStudentBillingRouter() {
  return createStudentBillingRouter({
    getStudentByUserId: (userId) => getStudentByUserId(userId),
    service: { getStudentView: async (id) => (await import("../services/billing-service.default")).defaultBillingService.getStudentView(id) },
  });
}

export default createDefaultStudentBillingRouter();
