/**
 * S25: owner "View as Student" (mounted under /api/admin). See shared/view-as-student-contract.ts.
 *
 * Admin only. Read-only: one GET, no student session, token or password is used, and the payload is the
 * same projection the student's own endpoints return. Every successful view is audited (profile.viewed);
 * refused access is audited as high_school.access_denied.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { projectAcademic, type AcademicProjectionMeta } from "@shared/academic-projection";
import { HS_ERROR_CODES, type StaffHighSchoolState, type StudentHighSchoolView } from "@shared/high-school-contract";
import { summarizeForPreview, VIEW_AS_STUDENT_MODE, type ViewAsStudentResponse } from "@shared/view-as-student-contract";
import { requireAuth } from "../middleware/auth";
import { createAuditLog, type AuditLogEntry } from "../lib/audit";
import { logger } from "../lib/logger";
import { getStudent } from "../repositories/student-academic-repo";
import { HsError, toHsUnavailable } from "../services/high-school-service";
import { emitAccessDenied } from "./high-school-audit";
import { pgLanguagePreferenceStore, type PortalLanguage } from "./student-preferences";
import { guardRoles, sendHsError } from "./high-school-http";
import { loadAssistantConfig } from "../services/academic-assistant/config";
import { decideLive } from "../services/academic-assistant/service";
import { SUGGESTIONS } from "../data/academic-assistant/knowledge";

/** The assistant status a student session would receive (policy only: no budget I/O, no model call). */
export function studentAssistantPresentation(): NonNullable<ViewAsStudentResponse["assistant"]> {
  const decision = decideLive({ id: "preview", role: "student" }, loadAssistantConfig());
  return {
    enabled: true,
    liveModel: decision.live,
    mode: decision.live ? "live" : "local",
    ...(decision.live ? {} : { reason: decision.reason }),
    suggestions: SUGGESTIONS.map(({ id, en, fr }) => ({ id, en, fr })),
  };
}

const studentIdSchema = z.string().trim().min(1).max(128);

export interface PreviewStudentRecord {
  readonly id: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly preferred_name?: string | null;
  readonly status: string;
  readonly user_id?: string | null;
}

export interface AdminViewAsStudentRouterDeps {
  readonly getStudent: (studentId: string) => Promise<PreviewStudentRecord | null>;
  readonly service: {
    getStudentAcademicSource: (studentId: string) => Promise<{ view: StudentHighSchoolView; meta: AcademicProjectionMeta }>;
    getStaffState: (studentId: string) => Promise<StaffHighSchoolState>;
  };
  /** The student's saved portal language by auth user id; a failure reads as null. */
  readonly getLanguage?: (userId: string) => Promise<PortalLanguage | null>;
  readonly audit?: (entry: AuditLogEntry) => Promise<void>;
  readonly onDenied?: (req: Request) => void;
}

const isNoEnrollment = (error: unknown) => error instanceof HsError && error.code === HS_ERROR_CODES.NO_ENROLLMENT;

export function createAdminViewAsStudentRouter(deps: AdminViewAsStudentRouterDeps) {
  const router = Router();
  const audit = deps.audit ?? createAuditLog;
  const adminOnly = [requireAuth, guardRoles(["admin"], deps.onDenied ?? emitAccessDenied)];

  router.get("/students/:studentId/view-as-student", ...adminOnly, async (req: Request, res: Response) => {
    const parsed = studentIdSchema.safeParse(req.params.studentId);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: HS_ERROR_CODES.VALIDATION, message: "studentId must be a non-empty string of at most 128 characters" } });
    }
    const studentId = parsed.data;
    res.setHeader("Cache-Control", "no-store");
    try {
      const student = await deps.getStudent(studentId);
      if (!student) return res.status(404).json({ error: { code: "STUDENT_NOT_FOUND", message: "Student not found" } });

      let source: { view: StudentHighSchoolView; meta: AcademicProjectionMeta } | null = null;
      try {
        source = await deps.service.getStudentAcademicSource(studentId);
      } catch (error) {
        if (!isNoEnrollment(error)) throw error;
      }
      let summary: ViewAsStudentResponse["summary"] = null;
      if (source) {
        const staff = await deps.service.getStaffState(studentId);
        summary = summarizeForPreview(source.view, staff.current?.reviewQueue ?? [], staff.events[0]?.createdAt ?? null);
      }

      const getLanguage = deps.getLanguage ?? ((userId: string) => pgLanguagePreferenceStore.get(userId));
      const preferredLanguage = student.user_id ? await getLanguage(student.user_id).catch(() => null) : null;

      void Promise.resolve(
        audit({
          eventType: "profile.viewed",
          severity: "info",
          actorUserId: req.user?.id,
          actorRole: req.user?.role,
          actorIp: req.ip,
          actorUserAgent: req.get?.("user-agent") ?? undefined,
          targetResourceType: "student",
          targetResourceId: studentId,
          actionDescription: "Viewed the student-facing portal as a read-only preview",
          metadata: { surface: "view_as_student", hasHighSchool: source !== null },
          isEducationalRecord: true,
        }),
      ).catch((error: unknown) => {
        logger.warn("View-as-student audit failed", { error: error instanceof Error ? error.message : String(error) });
      });

      const body: ViewAsStudentResponse = {
        mode: VIEW_AS_STUDENT_MODE,
        student: {
          id: student.id,
          displayName: `${student.preferred_name || student.first_name} ${student.last_name}`.trim(),
          status: student.status,
          hasPortalAccount: !!student.user_id,
          preferredLanguage,
        },
        highSchool: source?.view ?? null,
        academicProjection: source ? projectAcademic(source.view, source.meta) : null,
        summary,
        assistant: studentAssistantPresentation(),
        generatedAt: new Date().toISOString(),
      };
      return res.json(body);
    } catch (error) {
      return sendHsError(res, toHsUnavailable(error), "view as student");
    }
  });

  return router;
}

export function createDefaultAdminViewAsStudentRouter() {
  const service = async () => (await import("../services/high-school-service.default")).defaultHighSchoolService;
  return createAdminViewAsStudentRouter({
    getStudent: (studentId) => getStudent(studentId),
    service: {
      getStudentAcademicSource: async (studentId) => (await service()).getStudentAcademicSource(studentId),
      getStaffState: async (studentId) => (await service()).getStaffState(studentId),
    },
  });
}

export default createDefaultAdminViewAsStudentRouter();
