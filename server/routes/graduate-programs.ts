/**
 * Graduate programmes API (S12): ENEB programmes and the Unimarconi-linked route.
 *
 * Student (mounted at /api/student):
 *   GET  /graduate
 *   POST /graduate/programs/:programId/subjects/:subjectId/progress
 *   PUT  /graduate/programs/:programId/thesis
 *   POST /graduate/programs/:programId/records/:recordId/evidence
 *
 * Staff (mounted at /api/admin, BEFORE the admin-only router-wide guards):
 *   POST  /students/:studentId/graduate/evaluations
 *   PATCH /graduate/evaluations/:evaluationId
 *   POST  /graduate/evaluations/:evaluationId/verify
 *   GET   /graduate/offerings
 *   POST  /graduate/offerings                                (admin)
 *   POST  /graduate/offerings/:offeringId/rule-sets          (admin)
 *   GET   /students/:studentId/graduate
 *   POST  /students/:studentId/graduate/programs
 *   PATCH /graduate/programs/:programId
 *   POST  /graduate/programs/:programId/subjects
 *   POST  /graduate/subjects/:subjectId/result
 *   POST  /graduate/programs/:programId/records
 *   PATCH /graduate/records/:recordId
 *   POST  /graduate/records/:recordId/verify
 *   POST  /graduate/programs/:programId/credits
 *   GET   /graduate/programs/:programId/events
 *
 * Middleware is applied per route (not router-wide), so mounting at /api/admin
 * does not intercept other /api/admin paths. The student is resolved ONLY from
 * the authenticated user; any studentId in a student route's query or body is
 * rejected with 400. Students have no other write path.
 */
import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import {
  createCreditEntrySchema,
  createOfferingSchema,
  createRuleSetSchema,
  createSubjectSchema,
  enrollProgramSchema,
  recordEvaluationSchema,
  recordSubjectResultSchema,
  studentAttachEvidenceSchema,
  studentSubjectProgressSchema,
  studentThesisPlanSchema,
  trackRecordSchema,
  updateEvaluationSchema,
  updateProgramSchema,
  verifyEvaluationSchema,
  verifyRecordSchema,
  type GraduateErrorBody,
  type GuardActorRole,
} from "@shared/graduate-program-contract";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { getStudentByUserId } from "../repositories/student-academic-repo";
import { logger } from "../lib/logger";
import { GraduateError, getDefaultGraduateProgramService, type GraduateActor, type GraduateProgramService } from "../services/graduate-program-service";

const idSchema = z.string().trim().min(1).max(128);

function sendGraduateError(res: Response, error: unknown, context: string) {
  if (error instanceof GraduateError) {
    const body: GraduateErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.missing ? { missing: error.missing as GraduateErrorBody["error"]["missing"] } : {}),
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    };
    return res.status(error.status).json(body);
  }
  logger.error(`Graduate ${context} failed`, { error: error instanceof Error ? error.message : String(error) });
  return res.status(500).json({ error: "Internal server error" });
}

function validationFailure(res: Response, message: string, details?: Record<string, unknown>) {
  const body: GraduateErrorBody = { error: { code: "GRADUATE_VALIDATION_ERROR", message, ...(details ? { details } : {}) } };
  return res.status(400).json(body);
}

function parseBody<T extends z.ZodTypeAny>(schema: T, req: Request, res: Response): z.infer<T> | null {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    validationFailure(res, "Invalid request body", {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return null;
  }
  return parsed.data;
}

/** Parses the named path parameters; answers 400 and returns null when any is not a sane id. */
function parseParams<K extends string>(req: Request, res: Response, keys: readonly K[]): Record<K, string> | null {
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const parsed = idSchema.safeParse(req.params[key]);
    if (!parsed.success) {
      validationFailure(res, `${key} must be a non-empty string of at most 128 characters`);
      return null;
    }
    out[key] = parsed.data;
  }
  return out;
}

const actorOf = (req: Request): GraduateActor => ({ id: req.user!.id, role: req.user!.role as GuardActorRole });

// ---------------------------------------------------------------------------
// Student router
// ---------------------------------------------------------------------------

export interface StudentGraduateRouterDeps {
  readonly getStudentByUserId: (userId: string) => Promise<{ readonly id: string } | null>;
  readonly service: Pick<GraduateProgramService, "getStudentView" | "reportSubjectProgress" | "saveThesisPlan" | "attachEvidence">;
}

function mentionsStudentId(req: Request): boolean {
  const has = (o: unknown) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, "studentId");
  return has(req.query) || has(req.body);
}

export function createStudentGraduateRouter(deps: StudentGraduateRouterDeps) {
  const router = Router();
  const studentOnly = [requireAuth, requireRole(["student"])];

  /** Runs `handler` with the student resolved from the authenticated user only. */
  const withStudent =
    (handler: (req: Request, res: Response, studentId: string) => Promise<unknown>, context: string): RequestHandler =>
    async (req, res) => {
      try {
        if (mentionsStudentId(req)) return validationFailure(res, "studentId is not accepted");
        const student = await deps.getStudentByUserId(req.user!.id);
        if (!student) {
          const body: GraduateErrorBody = { error: { code: "STUDENT_PROFILE_NOT_FOUND", message: "No student profile found for this account" } };
          return res.status(404).json(body);
        }
        await handler(req, res, student.id);
      } catch (error) {
        sendGraduateError(res, error, context);
      }
    };

  router.get(
    "/graduate",
    ...studentOnly,
    withStudent(async (_req, res, studentId) => res.json(await deps.service.getStudentView(studentId)), "student view"),
  );

  router.post(
    "/graduate/programs/:programId/subjects/:subjectId/progress",
    ...studentOnly,
    withStudent(async (req, res, studentId) => {
      const params = parseParams(req, res, ["programId", "subjectId"] as const);
      if (!params) return;
      const body = parseBody(studentSubjectProgressSchema, req, res);
      if (!body) return;
      return res.json(await deps.service.reportSubjectProgress(actorOf(req), studentId, params.programId, params.subjectId, body.progress));
    }, "subject progress"),
  );

  router.put(
    "/graduate/programs/:programId/thesis",
    ...studentOnly,
    withStudent(async (req, res, studentId) => {
      const params = parseParams(req, res, ["programId"] as const);
      if (!params) return;
      const body = parseBody(studentThesisPlanSchema, req, res);
      if (!body) return;
      return res.json(await deps.service.saveThesisPlan(actorOf(req), studentId, params.programId, body));
    }, "thesis plan"),
  );

  router.post(
    "/graduate/programs/:programId/records/:recordId/evidence",
    ...studentOnly,
    withStudent(async (req, res, studentId) => {
      const params = parseParams(req, res, ["programId", "recordId"] as const);
      if (!params) return;
      const body = parseBody(studentAttachEvidenceSchema, req, res);
      if (!body) return;
      return res.json(await deps.service.attachEvidence(actorOf(req), studentId, params.programId, params.recordId, body.documentId));
    }, "attach evidence"),
  );

  return router;
}

// ---------------------------------------------------------------------------
// Staff router
// ---------------------------------------------------------------------------

export interface StaffGraduateRouterDeps {
  readonly service: Pick<
    GraduateProgramService,
    | "listOfferings"
    | "createOffering"
    | "createRuleSet"
    | "getWorkspace"
    | "enroll"
    | "updateProgram"
    | "createSubject"
    | "recordSubjectResult"
    | "createRecord"
    | "trackRecord"
    | "verifyRecord"
    | "createCreditEntry"
    | "recordEvaluation"
    | "updateEvaluation"
    | "verifyEvaluation"
    | "listEvents"
  >;
}

export function createStaffGraduateRouter(deps: StaffGraduateRouterDeps) {
  const router = Router();
  const staffOrAdmin = [requireAuth, requireRole(["staff", "admin"])];
  const adminOnly = [requireAuth, requireRole(["admin"])];

  const guarded =
    (handler: (req: Request, res: Response) => Promise<unknown>, context: string): RequestHandler =>
    async (req, res) => {
      try {
        await handler(req, res);
      } catch (error) {
        sendGraduateError(res, error, context);
      }
    };

  router.get(
    "/graduate/offerings",
    ...staffOrAdmin,
    guarded(async (_req, res) => res.json(await deps.service.listOfferings()), "offerings"),
  );

  router.post(
    "/graduate/offerings",
    ...adminOnly,
    guarded(async (req, res) => {
      const body = parseBody(createOfferingSchema, req, res);
      if (!body) return;
      return res.status(201).json({ offering: await deps.service.createOffering(actorOf(req), body) });
    }, "create offering"),
  );

  router.post(
    "/graduate/offerings/:offeringId/rule-sets",
    ...adminOnly,
    guarded(async (req, res) => {
      const params = parseParams(req, res, ["offeringId"] as const);
      if (!params) return;
      const body = parseBody(createRuleSetSchema, req, res);
      if (!body) return;
      return res.status(201).json({ ruleSet: await deps.service.createRuleSet(actorOf(req), params.offeringId, body) });
    }, "create rule set"),
  );

  router.get(
    "/students/:studentId/graduate",
    ...staffOrAdmin,
    guarded(async (req, res) => {
      const params = parseParams(req, res, ["studentId"] as const);
      if (!params) return;
      return res.json(await deps.service.getWorkspace(actorOf(req).role, params.studentId));
    }, "workspace"),
  );

  router.post(
    "/students/:studentId/graduate/programs",
    ...staffOrAdmin,
    guarded(async (req, res) => {
      const params = parseParams(req, res, ["studentId"] as const);
      if (!params) return;
      const body = parseBody(enrollProgramSchema, req, res);
      if (!body) return;
      return res.status(201).json(await deps.service.enroll(actorOf(req), params.studentId, body));
    }, "enroll"),
  );

  router.patch(
    "/graduate/programs/:programId",
    ...staffOrAdmin,
    guarded(async (req, res) => {
      const params = parseParams(req, res, ["programId"] as const);
      if (!params) return;
      const body = parseBody(updateProgramSchema, req, res);
      if (!body) return;
      return res.json({ program: await deps.service.updateProgram(actorOf(req), params.programId, body) });
    }, "update program"),
  );

  router.post(
    "/graduate/programs/:programId/subjects",
    ...staffOrAdmin,
    guarded(async (req, res) => {
      const params = parseParams(req, res, ["programId"] as const);
      if (!params) return;
      const body = parseBody(createSubjectSchema, req, res);
      if (!body) return;
      return res.status(201).json(await deps.service.createSubject(actorOf(req), params.programId, body));
    }, "create subject"),
  );

  router.post(
    "/graduate/subjects/:subjectId/result",
    ...staffOrAdmin,
    guarded(async (req, res) => {
      const params = parseParams(req, res, ["subjectId"] as const);
      if (!params) return;
      const body = parseBody(recordSubjectResultSchema, req, res);
      if (!body) return;
      return res.json({ program: await deps.service.recordSubjectResult(actorOf(req), params.subjectId, body) });
    }, "record result"),
  );

  router.post(
    "/graduate/programs/:programId/records",
    ...staffOrAdmin,
    guarded(async (req, res) => {
      const params = parseParams(req, res, ["programId"] as const);
      if (!params) return;
      const body = parseBody(trackRecordSchema, req, res);
      if (!body) return;
      if (!body.kind) return validationFailure(res, "kind is required");
      return res.status(201).json(await deps.service.createRecord(actorOf(req), params.programId, body));
    }, "create record"),
  );

  router.patch(
    "/graduate/records/:recordId",
    ...staffOrAdmin,
    guarded(async (req, res) => {
      const params = parseParams(req, res, ["recordId"] as const);
      if (!params) return;
      const body = parseBody(trackRecordSchema, req, res);
      if (!body) return;
      if (body.kind !== undefined) return validationFailure(res, "A record's kind cannot be changed");
      if (Object.values(body).every((v) => v === undefined)) return validationFailure(res, "Nothing to update");
      return res.json({ program: await deps.service.trackRecord(actorOf(req), params.recordId, body) });
    }, "track record"),
  );

  router.post(
    "/graduate/records/:recordId/verify",
    ...staffOrAdmin,
    guarded(async (req, res) => {
      const params = parseParams(req, res, ["recordId"] as const);
      if (!params) return;
      const body = parseBody(verifyRecordSchema, req, res);
      if (!body) return;
      return res.json({ program: await deps.service.verifyRecord(actorOf(req), params.recordId, body) });
    }, "verify record"),
  );

  router.post(
    "/graduate/programs/:programId/credits",
    ...staffOrAdmin,
    guarded(async (req, res) => {
      const params = parseParams(req, res, ["programId"] as const);
      if (!params) return;
      const body = parseBody(createCreditEntrySchema, req, res);
      if (!body) return;
      return res.status(201).json(await deps.service.createCreditEntry(actorOf(req), params.programId, body));
    }, "create credit"),
  );

  router.post(
    "/students/:studentId/graduate/evaluations",
    ...staffOrAdmin,
    guarded(async (req, res) => {
      const params = parseParams(req, res, ["studentId"] as const);
      if (!params) return;
      const body = parseBody(recordEvaluationSchema, req, res);
      if (!body) return;
      return res.status(201).json(await deps.service.recordEvaluation(actorOf(req), params.studentId, body));
    }, "record evaluation"),
  );

  router.patch(
    "/graduate/evaluations/:evaluationId",
    ...staffOrAdmin,
    guarded(async (req, res) => {
      const params = parseParams(req, res, ["evaluationId"] as const);
      if (!params) return;
      const body = parseBody(updateEvaluationSchema, req, res);
      if (!body) return;
      return res.json({ workspace: await deps.service.updateEvaluation(actorOf(req), params.evaluationId, body) });
    }, "update evaluation"),
  );

  router.post(
    "/graduate/evaluations/:evaluationId/verify",
    ...staffOrAdmin,
    guarded(async (req, res) => {
      const params = parseParams(req, res, ["evaluationId"] as const);
      if (!params) return;
      const body = parseBody(verifyEvaluationSchema, req, res);
      if (!body) return;
      return res.json({ workspace: await deps.service.verifyEvaluation(actorOf(req), params.evaluationId, body) });
    }, "verify evaluation"),
  );

  router.get(
    "/graduate/programs/:programId/events",
    ...staffOrAdmin,
    guarded(async (req, res) => {
      const params = parseParams(req, res, ["programId"] as const);
      if (!params) return;
      return res.json({ events: await deps.service.listEvents(params.programId) });
    }, "events"),
  );

  return router;
}

// ---------------------------------------------------------------------------
// Production wiring (the service and its database handle load lazily on first request)
// ---------------------------------------------------------------------------

type ServiceArgs<K extends keyof GraduateProgramService> = Parameters<GraduateProgramService[K]>;
const lazy =
  <K extends keyof GraduateProgramService>(key: K) =>
  async (...args: ServiceArgs<K>): Promise<Awaited<ReturnType<GraduateProgramService[K]>>> => {
    const service = (await getDefaultGraduateProgramService()) as unknown as Record<K, (...a: ServiceArgs<K>) => Promise<Awaited<ReturnType<GraduateProgramService[K]>>>>;
    return service[key](...args);
  };

export function createDefaultStudentGraduateRouter() {
  return createStudentGraduateRouter({
    getStudentByUserId: (userId) => getStudentByUserId(userId),
    service: {
      getStudentView: lazy("getStudentView"),
      reportSubjectProgress: lazy("reportSubjectProgress"),
      saveThesisPlan: lazy("saveThesisPlan"),
      attachEvidence: lazy("attachEvidence"),
    },
  });
}

export function createDefaultStaffGraduateRouter() {
  return createStaffGraduateRouter({
    service: {
      listOfferings: lazy("listOfferings"),
      createOffering: lazy("createOffering"),
      createRuleSet: lazy("createRuleSet"),
      getWorkspace: lazy("getWorkspace"),
      enroll: lazy("enroll"),
      updateProgram: lazy("updateProgram"),
      createSubject: lazy("createSubject"),
      recordSubjectResult: lazy("recordSubjectResult"),
      createRecord: lazy("createRecord"),
      trackRecord: lazy("trackRecord"),
      verifyRecord: lazy("verifyRecord"),
      createCreditEntry: lazy("createCreditEntry"),
      recordEvaluation: lazy("recordEvaluation"),
      updateEvaluation: lazy("updateEvaluation"),
      verifyEvaluation: lazy("verifyEvaluation"),
      listEvents: lazy("listEvents"),
    },
  });
}

export const studentGraduateRouter = createDefaultStudentGraduateRouter();
export const staffGraduateRouter = createDefaultStaffGraduateRouter();

export default staffGraduateRouter;
