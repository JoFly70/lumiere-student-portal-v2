/**
 * S18: GET /api/student/academic-projection (mounted under /api/student).
 * Student only; the student is resolved from the authenticated user, never from an id.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { getStudentByUserId } from "../repositories/student-academic-repo";
import { projectAcademic, type AcademicProjectionMeta } from "@shared/academic-projection";
import type { StudentHighSchoolView } from "@shared/high-school-contract";
import { toHsUnavailable } from "../services/high-school-service";
import { sendHsError as sendHsErrorBase, studentIdNotAccepted, mentionsStudentId } from "./high-school-http";

export interface StudentAcademicProjectionRouterDeps {
  readonly getStudentByUserId: (userId: string) => Promise<{ readonly id: string } | null>;
  readonly service: {
    getStudentAcademicSource: (studentId: string) => Promise<{ view: StudentHighSchoolView; meta: AcademicProjectionMeta }>;
  };
}

export function createStudentAcademicProjectionRouter(deps: StudentAcademicProjectionRouterDeps) {
  const router = Router();
  const studentOnly = [requireAuth, requireRole(["student"])];

  const resolveStudent = async (req: Request, res: Response): Promise<string | null> => {
    if (mentionsStudentId(req)) {
      studentIdNotAccepted(res);
      return null;
    }
    const student = await deps.getStudentByUserId(req.user!.id);
    if (!student) {
      res.status(404).json({ error: { code: "STUDENT_PROFILE_NOT_FOUND", message: "No student profile found for this account" } });
      return null;
    }
    return student.id;
  };

  router.get("/academic-projection", ...studentOnly, async (req, res) => {
    try {
      const studentId = await resolveStudent(req, res);
      if (!studentId) return;
      const { view, meta } = await deps.service.getStudentAcademicSource(studentId);
      return res.json(projectAcademic(view, meta));
    } catch (error) {
      return sendHsErrorBase(res, toHsUnavailable(error), "academic projection");
    }
  });

  return router;
}

export function createDefaultStudentAcademicProjectionRouter() {
  return createStudentAcademicProjectionRouter({
    getStudentByUserId: (userId) => getStudentByUserId(userId),
    service: {
      getStudentAcademicSource: async (studentId) =>
        (await import("../services/high-school-service.default")).defaultHighSchoolService.getStudentAcademicSource(studentId),
    },
  });
}

export default createDefaultStudentAcademicProjectionRouter();
