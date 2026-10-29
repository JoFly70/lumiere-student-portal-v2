/**
 * S27 — program journey routes.
 *
 * Student (mounted under /api/student; student role only; the student is resolved from the session, a studentId in
 * the query or body is rejected with 400):
 *   GET  /journey                          -> StudentJourneyView
 *   POST /orientation-sessions             -> OrientationSessionView   (CSRF; 409 S27_NO_SESSIONS_LEFT)
 *
 * Staff (mounted under /api/admin; per-route role checks, so mounting never intercepts other admin paths):
 *   GET   /students/:id/agreement                       admin, staff
 *   PUT   /students/:id/agreement                       admin           (CSRF)
 *   GET   /students/:id/journey                         admin, staff
 *   POST  /students/:id/checkpoints/:key                admin           (CSRF; complete)
 *   PUT   /students/:id/checkpoints/:key                admin           (CSRF; plan)
 *   GET   /students/:id/orientation-sessions            admin, staff
 *   POST  /students/:id/orientation-sessions            admin           (CSRF)
 *   PATCH /students/:id/orientation-sessions/:sid       admin           (CSRF)
 *   GET   /students/:id/notes                           admin, staff
 *   POST  /students/:id/notes                           admin, staff    (CSRF)
 *   GET   /control-center                               admin, staff
 * Coaches have no access. Every write is audited with identifiers, keys and counts only (never note bodies).
 */
import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import {
  CHECKPOINT_KEYS,
  S27_ERROR_CODES as E,
  completeCheckpointSchema,
  createSessionByStaffSchema,
  createStaffNoteSchema,
  planCheckpointSchema,
  requestSessionSchema,
  updateAgreementSchema,
  updateSessionSchema,
  type CheckpointKey,
  type ControlCenterView,
} from "@shared/s27-contract";
import { requireAuth } from "../middleware/auth";
import { requireCsrf } from "../middleware/csrf";
import { requireRole } from "../middleware/rbac";
import { createAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";
import { getStudentByUserId } from "../repositories/student-academic-repo";
import { JourneyError, type ProgramAuditRecord, type ProgramJourneyService } from "../services/program-journey/service";
import { guardRoles, mentionsStudentId } from "./high-school-http";

export type ProgramAuditSink = (req: Request, records: readonly ProgramAuditRecord[]) => void;

export const emitProgramAudit: ProgramAuditSink = (req, records) => {
  for (const r of records) {
    try {
      void Promise.resolve(createAuditLog({
        eventType: r.event,
        severity: "info",
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        actorIp: req.ip,
        actorUserAgent: req.get?.("user-agent") ?? undefined,
        targetResourceType: "student",
        targetResourceId: r.studentId,
        actionDescription: r.description,
        metadata: { ...r.metadata },
        isEducationalRecord: true,
      })).catch((error: unknown) => logger.warn("Program audit emit failed", { eventType: r.event, error: error instanceof Error ? error.message : String(error) }));
    } catch (error) {
      logger.warn("Program audit emit failed", { eventType: r.event, error: error instanceof Error ? error.message : String(error) });
    }
  }
};

export function emitProgramAccessDenied(req: Request): void {
  void Promise.resolve(createAuditLog({
    eventType: "program.access_denied",
    severity: "warning",
    actorUserId: req.user?.id,
    actorRole: req.user?.role,
    actorIp: req.ip,
    actorUserAgent: req.get?.("user-agent") ?? undefined,
    targetResourceType: "student",
    targetResourceId: typeof req.params?.studentId === "string" ? req.params.studentId : undefined,
    actionDescription: "Refused access to a program journey endpoint",
    metadata: { method: req.method, path: (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "", role: req.user?.role ?? null },
    isEducationalRecord: true,
  })).catch((error: unknown) => logger.warn("Program access-denied audit failed", { error: error instanceof Error ? error.message : String(error) }));
}

/** Postgres SQLSTATE / driver codes meaning "the store or its schema is not there" (migration not applied yet). */
const INFRA_CODES = new Set(["42P01", "3D000", "57P01", "57P03", "53300", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_DESTROYED"]);
function sendError(res: Response, error: unknown, context: string) {
  if (error instanceof JourneyError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  for (let e: any = error, i = 0; e && i < 4; e = e.cause, i++) {
    const code = typeof e.code === "string" ? e.code : "";
    if (INFRA_CODES.has(code) || code.startsWith("08")) {
      logger.warn(`Program journey ${context} unavailable`, { code });
      return res.status(503).json({ error: { code: "S27_UNAVAILABLE", message: "Program records are temporarily unavailable" } });
    }
  }
  logger.error(`Program journey ${context} failed`, { error: error instanceof Error ? error.message : String(error) });
  return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
}
const validation = (res: Response, error: z.ZodError) =>
  res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid request", details: { issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } } });

const idSchema = z.string().trim().min(1).max(128);
const checkpointKeySchema = z.enum(CHECKPOINT_KEYS);

// ── student ──────────────────────────────────────────────────────────────────

export interface StudentJourneyRouterDeps {
  readonly getStudentByUserId: (userId: string) => Promise<{ readonly id: string } | null>;
  readonly service: Pick<ProgramJourneyService, "getJourney" | "requestSession">;
  readonly audit?: ProgramAuditSink;
  readonly auth?: RequestHandler;
  readonly csrf?: RequestHandler;
}

export function createStudentJourneyRouter(deps: StudentJourneyRouterDeps) {
  const router = Router();
  const audit = deps.audit ?? emitProgramAudit;
  const studentOnly = [deps.auth ?? requireAuth, requireRole(["student"])];
  const csrf = deps.csrf ?? requireCsrf;

  const resolveStudent = async (req: Request, res: Response): Promise<string | null> => {
    if (mentionsStudentId(req)) {
      res.status(400).json({ error: { code: E.VALIDATION, message: "studentId is not accepted; the student is resolved from your login" } });
      return null;
    }
    const student = await deps.getStudentByUserId(req.user!.id);
    if (!student) {
      res.status(404).json({ error: { code: E.NOT_FOUND, message: "No student profile found for this account" } });
      return null;
    }
    return student.id;
  };

  router.get("/journey", ...studentOnly, (async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const studentId = await resolveStudent(req, res);
      if (!studentId) return;
      return res.json(await deps.service.getJourney(studentId));
    } catch (error) {
      return sendError(res, error, "student journey");
    }
  }) as RequestHandler);

  router.post("/orientation-sessions", ...studentOnly, csrf, (async (req: Request, res: Response) => {
    try {
      if (mentionsStudentId(req)) return res.status(400).json({ error: { code: E.VALIDATION, message: "studentId is not accepted; the student is resolved from your login" } });
      const body = requestSessionSchema.safeParse(req.body ?? {});
      if (!body.success) return validation(res, body.error);
      const studentId = await resolveStudent(req, res);
      if (!studentId) return;
      const out = await deps.service.requestSession(studentId, req.user!.id, body.data);
      audit(req, out.audits);
      return res.status(201).json(out.result);
    } catch (error) {
      return sendError(res, error, "session request");
    }
  }) as RequestHandler);

  return router;
}

export function createDefaultStudentJourneyRouter() {
  const load = async () => (await import("../services/program-journey/service.default")).defaultProgramJourneyService;
  return createStudentJourneyRouter({
    getStudentByUserId: (userId) => getStudentByUserId(userId),
    service: {
      getJourney: async (...a) => (await load()).getJourney(...a),
      requestSession: async (...a) => (await load()).requestSession(...a),
    },
  });
}

// ── staff ────────────────────────────────────────────────────────────────────

export interface AdminJourneyRouterDeps {
  readonly service: Pick<
    ProgramJourneyService,
    "getAgreementView" | "updateAgreement" | "getStaffJourney" | "completeCheckpoint" | "planCheckpoint" | "listStudentSessions" |
    "createSessionForStudent" | "updateSession" | "listNotes" | "addNote"
  >;
  readonly controlCenter: () => Promise<ControlCenterView>;
  readonly audit?: ProgramAuditSink;
  readonly onAccessDenied?: (req: Request) => void;
  readonly auth?: RequestHandler;
  readonly csrf?: RequestHandler;
}

export function createAdminJourneyRouter(deps: AdminJourneyRouterDeps) {
  const router = Router();
  const audit = deps.audit ?? emitProgramAudit;
  const denied = deps.onAccessDenied ?? emitProgramAccessDenied;
  const auth = deps.auth ?? requireAuth;
  const csrf = deps.csrf ?? requireCsrf;
  const readers = [auth, guardRoles(["admin", "staff"], denied)];
  const adminWrite = [auth, guardRoles(["admin"], denied), csrf];
  const staffWrite = [auth, guardRoles(["admin", "staff"], denied), csrf];
  const base = "/students/:studentId";

  /** Resolves :studentId (path only), then runs the handler; maps service errors. */
  const handle = (context: string, fn: (req: Request, res: Response, studentId: string) => Promise<unknown>): RequestHandler => (async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const sid = idSchema.safeParse(req.params.studentId);
    if (!sid.success) return res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid student id" } });
    if (Object.prototype.hasOwnProperty.call(req.query, "studentId")) return res.status(400).json({ error: { code: E.VALIDATION, message: "studentId belongs in the path only" } });
    try {
      await fn(req, res, sid.data);
    } catch (error) {
      sendError(res, error, context);
    }
  }) as RequestHandler;

  router.get(`${base}/agreement`, ...readers, handle("agreement read", async (_req, res, id) => res.json({ agreement: await deps.service.getAgreementView(id) })));

  router.put(`${base}/agreement`, ...adminWrite, handle("agreement update", async (req, res, id) => {
    const body = updateAgreementSchema.safeParse(req.body ?? {});
    if (!body.success) return validation(res, body.error);
    const out = await deps.service.updateAgreement(id, req.user!.id, body.data);
    audit(req, out.audits);
    return res.json({ agreement: out.result });
  }));

  router.get(`${base}/journey`, ...readers, handle("staff journey", async (_req, res, id) => res.json(await deps.service.getStaffJourney(id))));

  const keyOf = (req: Request, res: Response): CheckpointKey | null => {
    const k = checkpointKeySchema.safeParse(req.params.key);
    if (!k.success) { res.status(400).json({ error: { code: E.VALIDATION, message: "Unknown checkpoint" } }); return null; }
    return k.data;
  };
  router.post(`${base}/checkpoints/:key`, ...adminWrite, handle("checkpoint complete", async (req, res, id) => {
    const key = keyOf(req, res); if (!key) return;
    const body = completeCheckpointSchema.safeParse(req.body ?? {});
    if (!body.success) return validation(res, body.error);
    const out = await deps.service.completeCheckpoint(id, key, req.user!.id, body.data);
    audit(req, out.audits);
    return res.json(out.result);
  }));
  router.put(`${base}/checkpoints/:key`, ...adminWrite, handle("checkpoint plan", async (req, res, id) => {
    const key = keyOf(req, res); if (!key) return;
    const body = planCheckpointSchema.safeParse(req.body ?? {});
    if (!body.success) return validation(res, body.error);
    const out = await deps.service.planCheckpoint(id, key, req.user!.id, body.data.plannedOn);
    audit(req, out.audits);
    return res.json(out.result);
  }));

  router.get(`${base}/orientation-sessions`, ...readers, handle("sessions list", async (_req, res, id) => res.json({ sessions: await deps.service.listStudentSessions(id) })));
  router.post(`${base}/orientation-sessions`, ...adminWrite, handle("session create", async (req, res, id) => {
    const body = createSessionByStaffSchema.safeParse(req.body ?? {});
    if (!body.success) return validation(res, body.error);
    const out = await deps.service.createSessionForStudent(id, req.user!.id, body.data);
    audit(req, out.audits);
    return res.status(201).json(out.result);
  }));
  router.patch(`${base}/orientation-sessions/:sessionId`, ...adminWrite, handle("session update", async (req, res, id) => {
    const sid = idSchema.safeParse(req.params.sessionId);
    const body = updateSessionSchema.safeParse(req.body ?? {});
    if (!sid.success || !body.success) return body.success ? res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid session id" } }) : validation(res, body.error);
    const out = await deps.service.updateSession(id, sid.data, req.user!.id, body.data);
    audit(req, out.audits);
    return res.json(out.result);
  }));

  router.get(`${base}/notes`, ...readers, handle("notes list", async (_req, res, id) => res.json({ notes: await deps.service.listNotes(id) })));
  router.post(`${base}/notes`, ...staffWrite, handle("note add", async (req, res, id) => {
    const body = createStaffNoteSchema.safeParse(req.body ?? {});
    if (!body.success) return validation(res, body.error);
    const out = await deps.service.addNote(id, req.user!.id, body.data.body);
    audit(req, out.audits);
    return res.status(201).json(out.result);
  }));

  router.get("/control-center", ...readers, (async (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      return res.json(await deps.controlCenter());
    } catch (error) {
      return sendError(res, error, "control center");
    }
  }) as RequestHandler);

  return router;
}

export function createDefaultAdminJourneyRouter() {
  const load = async () => await import("../services/program-journey/service.default");
  const svc = async () => (await load()).defaultProgramJourneyService;
  return createAdminJourneyRouter({
    service: {
      getAgreementView: async (...a) => (await svc()).getAgreementView(...a),
      updateAgreement: async (...a) => (await svc()).updateAgreement(...a),
      getStaffJourney: async (...a) => (await svc()).getStaffJourney(...a),
      completeCheckpoint: async (...a) => (await svc()).completeCheckpoint(...a),
      planCheckpoint: async (...a) => (await svc()).planCheckpoint(...a),
      listStudentSessions: async (...a) => (await svc()).listStudentSessions(...a),
      createSessionForStudent: async (...a) => (await svc()).createSessionForStudent(...a),
      updateSession: async (...a) => (await svc()).updateSession(...a),
      listNotes: async (...a) => (await svc()).listNotes(...a),
      addNote: async (...a) => (await svc()).addNote(...a),
    },
    controlCenter: async () => (await load()).defaultControlCenter(),
  });
}

export const studentJourneyRouter = createDefaultStudentJourneyRouter();
export default createDefaultAdminJourneyRouter();
