/**
 * Staff API for the High School Pathway (S11), mounted under /api/admin.
 * See the HTTP surface comment in shared/high-school-contract.ts.
 *
 * Middleware is applied per route (not router-wide) so mounting at /api/admin
 * never intercepts other /api/admin paths. Staff + admin may do everything
 * except the "(A)" actions: publish, void an award, confer a diploma, create a
 * template, record a historical graduate (admin only). A refused request is
 * audited as high_school.access_denied (non-blocking).
 */
import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import {
  createEnrollmentSchema,
  graduationActionSchema,
  guardianNoteSchema,
  historicalGraduateSchema,
  publishDraftSchema,
  recordCourseResultSchema,
  recordPriorEducationSchema,
  recordTaskResultSchema,
  recordTransferAwardSchema,
  resolveTransferClaimSchema,
  saveDraftSchema,
  transferClaimSchema,
  updateEnrollmentSchema,
  voidAwardSchema,
  type HsCurriculumTemplate,
} from "@shared/high-school-contract";
import { hsCurriculumTemplateSchema } from "@shared/high-school-projection";
import { requireAuth } from "../middleware/auth";
import type { HighSchoolService } from "../services/high-school-service";
import { emitAccessDenied, emitHighSchoolAudit, type HsAuditSink } from "./high-school-audit";
import { guardRoles, parseBody, sendHsError, sendZodError, studentIdNotAccepted, validationFailure } from "./high-school-http";

type Svc = HighSchoolService;
export interface AdminHighSchoolRouterDeps {
  readonly service: Pick<
    Svc,
    | "listTemplates"
    | "createTemplate"
    | "getStaffState"
    | "createEnrollment"
    | "updateEnrollment"
    | "recordPriorEducation"
    | "createTransferClaim"
    | "resolveTransferClaim"
    | "draftFromTemplate"
    | "saveDraft"
    | "publish"
    | "recordTaskResult"
    | "recordCourseResult"
    | "recordTransferAward"
    | "voidAward"
    | "graduationAction"
    | "historicalGraduate"
    | "addGuardianNote"
  >;
  readonly audit?: HsAuditSink;
  readonly onAccessDenied?: (req: Request) => void;
}

const studentIdSchema = z.string().trim().min(1).max(128);
const fromTemplateBody = z.object({ expectedDraftRevision: z.number().int().min(0).optional() }).strict();

export function createAdminHighSchoolRouter(deps: AdminHighSchoolRouterDeps) {
  const router = Router();
  const audit = deps.audit ?? emitHighSchoolAudit;
  const denied = deps.onAccessDenied ?? emitAccessDenied;
  const staffOrAdmin = [requireAuth, guardRoles(["staff", "admin"], denied)];
  const adminOnly = [requireAuth, guardRoles(["admin"], denied)];

  /** Resolves :studentId (rejecting a query-string studentId) and runs the handler. */
  const withStudent =
    (handler: (req: Request, res: Response, studentId: string) => Promise<unknown>, context: string): RequestHandler =>
    async (req, res) => {
      const parsed = studentIdSchema.safeParse(req.params.studentId);
      if (!parsed.success) return validationFailure(res, "studentId must be a non-empty string of at most 128 characters");
      if (Object.prototype.hasOwnProperty.call(req.query, "studentId")) return studentIdNotAccepted(res);
      try {
        await handler(req, res, parsed.data);
      } catch (error) {
        sendHsError(res, error, context);
      }
    };

  const respond = (req: Request, res: Response, out: { result: unknown; audits: Parameters<HsAuditSink>[1] }) => {
    audit(req, out.audits);
    return res.json(out.result);
  };

  // ── templates ──────────────────────────────────────────────────────────────
  router.get("/high-school/templates", ...staffOrAdmin, async (_req, res) => {
    try {
      return res.json({ templates: await deps.service.listTemplates() });
    } catch (error) {
      return sendHsError(res, error, "templates");
    }
  });

  router.post("/high-school/templates", ...adminOnly, async (req, res) => {
    try {
      const body = parseBody(hsCurriculumTemplateSchema, req, res);
      if (!body) return;
      const out = await deps.service.createTemplate(req.user!.id, body as HsCurriculumTemplate);
      return res.status(201).json({ template: out.result });
    } catch (error) {
      return sendHsError(res, error, "template create");
    }
  });

  // ── state ──────────────────────────────────────────────────────────────────
  router.get(
    "/students/:studentId/high-school",
    ...staffOrAdmin,
    withStudent(async (_req, res, studentId) => res.json(await deps.service.getStaffState(studentId)), "state"),
  );

  router.post(
    "/students/:studentId/high-school/enrollments",
    ...staffOrAdmin,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(createEnrollmentSchema, req, res);
      if (!body) return;
      const out = await deps.service.createEnrollment(studentId, req.user!.id, body);
      audit(req, out.audits);
      return res.status(201).json(out.result);
    }, "enrollment create"),
  );

  const E = "/students/:studentId/high-school/enrollments/:eid";

  router.patch(
    E,
    ...staffOrAdmin,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(updateEnrollmentSchema, req, res);
      if (!body) return;
      return respond(req, res, await deps.service.updateEnrollment(studentId, req.params.eid, req.user!.id, body));
    }, "enrollment update"),
  );

  router.post(
    `${E}/prior-education`,
    ...staffOrAdmin,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(recordPriorEducationSchema, req, res);
      if (!body) return;
      return respond(req, res, await deps.service.recordPriorEducation(studentId, req.params.eid, req.user!.id, body));
    }, "prior education"),
  );

  router.post(
    `${E}/transfer-claims`,
    ...staffOrAdmin,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(transferClaimSchema, req, res);
      if (!body) return;
      return respond(req, res, await deps.service.createTransferClaim(studentId, req.params.eid, req.user!.id, body));
    }, "transfer claim"),
  );

  router.post(
    `${E}/transfer-claims/:claimId/resolve`,
    ...staffOrAdmin,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(resolveTransferClaimSchema, req, res);
      if (!body) return;
      return respond(req, res, await deps.service.resolveTransferClaim(studentId, req.params.eid, req.params.claimId, req.user!.id, body));
    }, "transfer claim resolve"),
  );

  // ── roadmap ────────────────────────────────────────────────────────────────
  router.post(
    `${E}/roadmap/draft/from-template`,
    ...staffOrAdmin,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(fromTemplateBody, req, res);
      if (!body) return;
      return respond(req, res, await deps.service.draftFromTemplate(studentId, req.params.eid, req.user!.id, body.expectedDraftRevision));
    }, "draft from template"),
  );

  router.put(
    `${E}/roadmap/draft`,
    ...staffOrAdmin,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(saveDraftSchema, req, res);
      if (!body) return;
      return respond(req, res, await deps.service.saveDraft(studentId, req.params.eid, req.user!.id, body));
    }, "draft save"),
  );

  router.post(
    `${E}/roadmap/publish`,
    ...adminOnly,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(publishDraftSchema, req, res);
      if (!body) return;
      return respond(req, res, await deps.service.publish(studentId, req.params.eid, req.user!.id, body));
    }, "publish"),
  );

  // ── official results and credit ────────────────────────────────────────────
  router.post(
    `${E}/results/task`,
    ...staffOrAdmin,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(recordTaskResultSchema, req, res);
      if (!body) return;
      return respond(req, res, await deps.service.recordTaskResult(studentId, req.params.eid, req.user!.id, body));
    }, "task result"),
  );

  router.post(
    `${E}/results/course`,
    ...staffOrAdmin,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(recordCourseResultSchema, req, res);
      if (!body) return;
      return respond(req, res, await deps.service.recordCourseResult(studentId, req.params.eid, req.user!.id, body));
    }, "course result"),
  );

  router.post(
    `${E}/awards/transfer`,
    ...staffOrAdmin,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(recordTransferAwardSchema, req, res);
      if (!body) return;
      return respond(req, res, await deps.service.recordTransferAward(studentId, req.params.eid, req.user!.id, body));
    }, "transfer award"),
  );

  router.post(
    `${E}/awards/:awardId/void`,
    ...adminOnly,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(voidAwardSchema, req, res);
      if (!body) return;
      return respond(req, res, await deps.service.voidAward(studentId, req.params.eid, req.params.awardId, req.user!.id, body.reason));
    }, "void award"),
  );

  // ── graduation and guardians ───────────────────────────────────────────────
  router.post(
    `${E}/graduation`,
    ...staffOrAdmin,
    withStudent(async (req, res, studentId) => {
      const parsed = graduationActionSchema.safeParse(req.body ?? {});
      if (!parsed.success) return sendZodError(res, parsed.error, req.body);
      if (parsed.data.action === "confer_diploma" && req.user!.role !== "admin") {
        denied(req);
        return res.status(403).json({ error: "Insufficient permissions", required: ["admin"], current: req.user!.role });
      }
      return respond(req, res, await deps.service.graduationAction(studentId, req.params.eid, req.user!.id, parsed.data));
    }, "graduation"),
  );

  router.post(
    `${E}/guardian-notes`,
    ...staffOrAdmin,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(guardianNoteSchema, req, res);
      if (!body) return;
      return respond(req, res, await deps.service.addGuardianNote(studentId, req.params.eid, req.user!.id, body));
    }, "guardian note"),
  );

  router.post(
    "/students/:studentId/high-school/historical-graduate",
    ...adminOnly,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(historicalGraduateSchema, req, res);
      if (!body) return;
      const out = await deps.service.historicalGraduate(studentId, req.user!.id, body);
      audit(req, out.audits);
      return res.status(201).json(out.result);
    }, "historical graduate"),
  );

  return router;
}

export function createDefaultAdminHighSchoolRouter() {
  const load = async () => (await import("../services/high-school-service.default")).defaultHighSchoolService;
  const lazy =
    <K extends keyof AdminHighSchoolRouterDeps["service"]>(name: K) =>
    async (...args: Parameters<AdminHighSchoolRouterDeps["service"][K]>) =>
      ((await load())[name] as (...a: unknown[]) => unknown)(...args);
  const names = [
    "listTemplates", "createTemplate", "getStaffState", "createEnrollment", "updateEnrollment", "recordPriorEducation",
    "createTransferClaim", "resolveTransferClaim", "draftFromTemplate", "saveDraft", "publish", "recordTaskResult",
    "recordCourseResult", "recordTransferAward", "voidAward", "graduationAction", "historicalGraduate", "addGuardianNote",
  ] as const;
  const service = Object.fromEntries(names.map((n) => [n, lazy(n)])) as unknown as AdminHighSchoolRouterDeps["service"];
  return createAdminHighSchoolRouter({ service });
}

export default createDefaultAdminHighSchoolRouter();
