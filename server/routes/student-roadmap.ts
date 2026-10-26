/**
 * Student API for the published roadmap (S05), mounted under /api/student.
 *
 *   GET  /api/student/roadmap            -> StudentRoadmapView (current published version only)
 *   POST /api/student/roadmap/progress   -> StudentRoadmapView (authoritative, after the write)
 *
 * The student is resolved ONLY from the authenticated user. Any studentId in
 * the query or body is rejected with 400 before data access. Students report
 * coursework activity only: they never edit the plan, pick degrees, award
 * credit or publish.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { getStudentByUserId } from "../repositories/student-academic-repo";
import { studentProgressUpdateSchema } from "@shared/student-roadmap-contract";
import type { StudentRoadmapService } from "../services/student-roadmap-service";
import { sendRoadmapError, validationFailure } from "./roadmap-http";

export interface StudentRoadmapRouterDeps {
  readonly getStudentByUserId: (userId: string) => Promise<{ readonly id: string } | null>;
  readonly service: Pick<StudentRoadmapService, "getStudentView" | "reportProgress">;
}

function mentionsStudentId(req: Request): boolean {
  const has = (o: unknown) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, "studentId");
  return has(req.query) || has(req.body);
}

export function createStudentRoadmapRouter(deps: StudentRoadmapRouterDeps) {
  const router = Router();

  const resolveStudent = async (req: Request, res: Response): Promise<string | null> => {
    if (mentionsStudentId(req)) {
      validationFailure(res, "studentId is not accepted");
      return null;
    }
    const student = await deps.getStudentByUserId(req.user!.id);
    if (!student) {
      res.status(404).json({
        error: { code: "STUDENT_PROFILE_NOT_FOUND", message: "No student profile found for this account" },
      });
      return null;
    }
    return student.id;
  };

  router.get("/roadmap", requireAuth, requireRole(["student"]), async (req, res) => {
    try {
      const studentId = await resolveStudent(req, res);
      if (!studentId) return;
      return res.json(await deps.service.getStudentView(studentId));
    } catch (error) {
      return sendRoadmapError(res, error, "student view");
    }
  });

  router.post("/roadmap/progress", requireAuth, requireRole(["student"]), async (req, res) => {
    try {
      if (mentionsStudentId(req)) return validationFailure(res, "studentId is not accepted");
      const parsed = studentProgressUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return validationFailure(res, "Invalid progress update", {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      const studentId = await resolveStudent(req, res);
      if (!studentId) return;
      return res.json(await deps.service.reportProgress(studentId, req.user!.id, parsed.data));
    } catch (error) {
      return sendRoadmapError(res, error, "progress report");
    }
  });

  return router;
}

export function createDefaultStudentRoadmapRouter() {
  const loadService = async () => (await import("../services/student-roadmap-service.default")).defaultStudentRoadmapService;
  return createStudentRoadmapRouter({
    getStudentByUserId: (userId) => getStudentByUserId(userId),
    service: {
      getStudentView: async (...a) => (await loadService()).getStudentView(...a),
      reportProgress: async (...a) => (await loadService()).reportProgress(...a),
    },
  });
}

export default createDefaultStudentRoadmapRouter();
