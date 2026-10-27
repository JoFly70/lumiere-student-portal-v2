/**
 * Student API for the High School Pathway (S11), mounted under /api/student.
 *
 *   GET  /api/student/high-school                       -> StudentHighSchoolView
 *   POST /api/student/high-school/progress              -> StudentHighSchoolView
 *   POST /api/student/high-school/transcript-request    -> StudentHighSchoolView
 *   GET  /api/student/programs                          -> StudentProgramsView
 *
 * The student is resolved ONLY from the authenticated user; a studentId in the
 * query or body is rejected with 400 before any data access. Students report
 * activity only: official results and credit are recorded by staff.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { getStudentByUserId } from "../repositories/student-academic-repo";
import { hsStudentProgressSchema, transcriptRequestSchema } from "@shared/high-school-contract";
import type { HighSchoolService } from "../services/high-school-service";
import { emitHighSchoolAudit, type HsAuditSink } from "./high-school-audit";
import { parseBody, sendHsError, studentIdNotAccepted, mentionsStudentId } from "./high-school-http";

export interface StudentHighSchoolRouterDeps {
  readonly getStudentByUserId: (userId: string) => Promise<{ readonly id: string } | null>;
  readonly service: Pick<HighSchoolService, "getStudentView" | "getStudentPrograms" | "reportProgress" | "requestTranscript">;
  readonly audit?: HsAuditSink;
}

export function createStudentHighSchoolRouter(deps: StudentHighSchoolRouterDeps) {
  const router = Router();
  const audit = deps.audit ?? emitHighSchoolAudit;
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

  router.get("/high-school", ...studentOnly, async (req, res) => {
    try {
      const studentId = await resolveStudent(req, res);
      if (!studentId) return;
      return res.json(await deps.service.getStudentView(studentId));
    } catch (error) {
      return sendHsError(res, error, "student view");
    }
  });

  router.post("/high-school/progress", ...studentOnly, async (req, res) => {
    try {
      if (mentionsStudentId(req)) return studentIdNotAccepted(res);
      const body = parseBody(hsStudentProgressSchema, req, res);
      if (!body) return;
      const studentId = await resolveStudent(req, res);
      if (!studentId) return;
      const out = await deps.service.reportProgress(studentId, req.user!.id, body);
      audit(req, out.audits);
      return res.json(out.result);
    } catch (error) {
      return sendHsError(res, error, "progress report");
    }
  });

  router.post("/high-school/transcript-request", ...studentOnly, async (req, res) => {
    try {
      if (mentionsStudentId(req)) return studentIdNotAccepted(res);
      const body = parseBody(transcriptRequestSchema, req, res);
      if (!body) return;
      const studentId = await resolveStudent(req, res);
      if (!studentId) return;
      const out = await deps.service.requestTranscript(studentId, req.user!.id, body.note);
      audit(req, out.audits);
      return res.json(out.result);
    } catch (error) {
      return sendHsError(res, error, "transcript request");
    }
  });

  router.get("/programs", ...studentOnly, async (req, res) => {
    try {
      const studentId = await resolveStudent(req, res);
      if (!studentId) return;
      return res.json(await deps.service.getStudentPrograms(studentId));
    } catch (error) {
      return sendHsError(res, error, "programs");
    }
  });

  return router;
}

export function createDefaultStudentHighSchoolRouter() {
  const load = async () => (await import("../services/high-school-service.default")).defaultHighSchoolService;
  return createStudentHighSchoolRouter({
    getStudentByUserId: (userId) => getStudentByUserId(userId),
    service: {
      getStudentView: async (...a) => (await load()).getStudentView(...a),
      getStudentPrograms: async (...a) => (await load()).getStudentPrograms(...a),
      reportProgress: async (...a) => (await load()).reportProgress(...a),
      requestTranscript: async (...a) => (await load()).requestTranscript(...a),
    },
  });
}

export default createDefaultStudentHighSchoolRouter();
