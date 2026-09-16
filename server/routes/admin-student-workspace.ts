import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  loadAdminStudentWorkspace,
  WorkspaceNotFoundError,
  type WorkspaceDependencies,
} from "../services/admin-student-workspace-service";
import { getDegreeProgress } from "../services/degree-progress-service";
import { studentAcademicService } from "../services/student-academic-service";
import { listPlacementsForAssignment } from "../repositories/student-credit-placement-repo";

const studentIdSchema = z.string().trim().min(1).max(128);

function validationError(res: Response) {
  return res.status(400).json({
    error: {
      code: "ADMIN_STUDENT_WORKSPACE_VALIDATION_ERROR",
      message: "studentId must be a non-empty string of at most 128 characters",
    },
  });
}

export function createAdminStudentWorkspaceRouter(dependencies: WorkspaceDependencies) {
  const router = Router();
  router.use(requireAuth);
  router.use(requireRole(["admin"]));

  const handleGet = async (req: Request, res: Response) => {
    const rawStudentId = req.params.studentId;
    if (
      typeof rawStudentId !== "string"
      || Object.prototype.hasOwnProperty.call(req.query, "studentId")
    ) return validationError(res);
    const parsed = studentIdSchema.safeParse(rawStudentId);
    if (!parsed.success) return validationError(res);
    try {
      const workspace = await loadAdminStudentWorkspace(parsed.data, dependencies);
      return res.json(workspace);
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return res.status(404).json({
          error: { code: error.code, message: error.message },
        });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  };

  router.get("/students/:studentId/workspace", handleGet);
  // Keep a missing path parameter on the same phase-specific validation
  // contract as the existing admin degree-progress boundary.
  router.get("/students/workspace", handleGet);
  return router;
}

export default createAdminStudentWorkspaceRouter({
  getProgress: getDegreeProgress,
  getAcademicRecord: (studentId) => studentAcademicService.getStudentAcademicRecord(studentId),
  listPlacementsForAssignment,
});