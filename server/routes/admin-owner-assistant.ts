/**
 * S26 — Lumière Owner AI routes (mounted under /api/admin).
 *
 * GET  /students/:studentId/owner-assistant/status   availability only (no model call)
 * POST /students/:studentId/owner-assistant          { question, language, task } -> OwnerAssistantAnswer
 *
 * Admin only (staff/coach are refused: their narrower desk scope is not widened by AI). Runs as the
 * authenticated admin; never uses a student session. Read-only: no record is written except the
 * access audit event, which stores no question or answer text.
 */
import { Router, type Request, type Response, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { HS_ERROR_CODES } from "@shared/high-school-contract";
import { requireAuth } from "../middleware/auth";
import { requireCsrf } from "../middleware/csrf";
import { createRateLimitStore } from "../lib/rate-limit-store";
import { createAuditLog, type AuditLogEntry } from "../lib/audit";
import { logger } from "../lib/logger";
import { loadAssistantConfig } from "../services/academic-assistant/config";
import { PgBudgetStore } from "../services/academic-assistant/budget";
import { HsError } from "../services/high-school-service";
import {
  askOwnerAssistant,
  ownerLiveDecision,
  OwnerStudentNotFoundError,
  OWNER_MAX_QUESTION_CHARS,
  type OwnerAssistantDeps,
} from "../services/owner-assistant/service";
import type { OwnerContextInput } from "../services/owner-assistant/context";
import { emitAccessDenied } from "./high-school-audit";
import { guardRoles } from "./high-school-http";

const studentIdSchema = z.string().trim().min(1).max(128);
const bodySchema = z.object({
  question: z.string().trim().min(1).max(OWNER_MAX_QUESTION_CHARS),
  language: z.enum(["en", "fr"]),
  task: z.enum(["answer", "draft_reply"]).default("answer"),
}).strict();

export interface OwnerAssistantRouterOptions {
  deps?: OwnerAssistantDeps;
  auth?: RequestHandler;
  csrf?: RequestHandler;
  audit?: (entry: AuditLogEntry) => Promise<void>;
  rateLimitPerMinute?: number;
}

export async function defaultLoadOwnerContext(studentId: string): Promise<OwnerContextInput | null> {
  const { getStudent } = await import("../services/student-service");
  const student = await getStudent(studentId);
  if (!student) return null;
  const { defaultHighSchoolService: hs } = await import("../services/high-school-service.default");
  let highSchool: OwnerContextInput["highSchool"] = null;
  let reviewQueue: OwnerContextInput["reviewQueue"] = [];
  try {
    highSchool = await hs.getStudentView(studentId);
    reviewQueue = (await hs.getStaffState(studentId)).current?.reviewQueue ?? [];
  } catch (error) {
    if (!(error instanceof HsError && (error.code === HS_ERROR_CODES.NO_ENROLLMENT || error.code === HS_ERROR_CODES.NO_PUBLISHED_ROADMAP))) throw error;
  }
  const { listStudentDocuments } = await import("../services/document-service");
  const documents = (await listStudentDocuments(studentId)).filter((d) => d.doc_type !== "chat_attachment");
  let tickets: OwnerContextInput["tickets"] = [];
  if (student.user_id) {
    const { supabaseAdmin } = await import("../lib/supabase");
    const { data, error } = await supabaseAdmin
      .from("support_tickets")
      .select("id,subject,status,category,priority,updated_at")
      .eq("reporter_id", student.user_id)
      .order("updated_at", { ascending: false })
      .limit(10);
    if (error) logger.warn("Owner assistant ticket lookup failed", { code: error.code });
    else tickets = data ?? [];
  }
  let billing: OwnerContextInput["billing"] = null;
  try {
    const { defaultBillingService } = await import("../services/billing-service.default");
    const v = await defaultBillingService.getStaffView(studentId);
    const s = v.student;
    const last = [...v.receipts].sort((a, b) => b.receivedDate.localeCompare(a.receivedDate))[0];
    billing = s.state === "configured"
      ? { state: "configured", currency: s.currency, agreedCents: s.agreedCents, discountCents: s.discountCents, paidCents: s.paidCents, remainingCents: s.remainingCents,
          nextDue: s.nextDue ? { dueDate: s.nextDue.dueDate, amountCents: s.nextDue.amountCents, status: s.nextDue.status } : null,
          lastReceipt: last ? { receivedDate: last.receivedDate, amountCents: last.amountCents, methodLabel: last.methodLabel } : null,
          evidenceAwaiting: v.evidence.filter((e) => e.status === "awaiting_review").length,
          schedule: s.installments.map((i) => ({ dueDate: i.dueDate, amountCents: i.amountCents, status: i.status })) }
      : { state: "not_configured" };
  } catch (error) {
    logger.warn("Owner assistant billing lookup failed", { error: error instanceof Error ? error.message : String(error) });
  }
  // S27: program journey (agreement, checkpoints, pace) and staff notes. Admin-only route, so note bodies are included (scrubbed).
  let program: OwnerContextInput["program"] = null;
  try {
    const { defaultProgramJourneyService: journey } = await import("../services/program-journey/service.default");
    const notes = await journey.listNotes(studentId);
    program = { journey: await journey.getJourney(studentId), notesCount: notes.length, noteBodies: notes.slice(0, 5).map((n) => n.body) };
  } catch (error) {
    logger.warn("Owner assistant program lookup failed", { error: error instanceof Error ? error.message : String(error) });
  }
  return { student, highSchool, reviewQueue, documents, tickets, billing, program };
}

export function createAdminOwnerAssistantRouter(opts: OwnerAssistantRouterOptions = {}): Router {
  const router = Router();
  const deps: OwnerAssistantDeps = opts.deps ?? { loadContext: defaultLoadOwnerContext, budget: new PgBudgetStore() };
  const audit = opts.audit ?? createAuditLog;
  const adminOnly = [opts.auth ?? requireAuth, guardRoles(["admin"], emitAccessDenied)];
  const throttle = rateLimit({
    store: opts.deps ? undefined : createRateLimitStore("rl:owner-assistant:"),
    windowMs: 60_000,
    max: opts.rateLimitPerMinute ?? loadAssistantConfig().rateLimitPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `u:${req.user?.id ?? "anon"}`,
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, res) => { res.status(429).json({ error: { code: "THROTTLED", message: "Too many requests. Please wait a moment." } }); },
  });

  router.get("/students/:studentId/owner-assistant/status", ...adminOnly, (req: Request, res: Response) => {
    const decision = ownerLiveDecision({ id: req.user!.id, role: req.user!.role }, (deps.config ?? loadAssistantConfig)());
    res.setHeader("Cache-Control", "no-store");
    res.json(decision.live ? { mode: "live" } : { mode: "unavailable", reason: decision.reason });
  });

  router.post("/students/:studentId/owner-assistant", ...adminOnly, opts.csrf ?? requireCsrf, throttle, async (req: Request, res: Response) => {
    const id = studentIdSchema.safeParse(req.params.studentId);
    const body = bodySchema.safeParse(req.body);
    if (!id.success || !body.success) return res.status(400).json({ error: { code: HS_ERROR_CODES.VALIDATION, message: "Invalid request" } });
    res.setHeader("Cache-Control", "no-store");
    try {
      const answer = await askOwnerAssistant({ id: req.user!.id, role: req.user!.role }, { studentId: id.data, ...body.data }, deps);
      void Promise.resolve(audit({
        eventType: "profile.viewed",
        severity: "info",
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        actorIp: req.ip,
        actorUserAgent: req.get?.("user-agent") ?? undefined,
        targetResourceType: "student",
        targetResourceId: id.data,
        actionDescription: "Owner AI read the student's records (read-only)",
        metadata: { surface: "owner_ai", task: body.data.task, mode: answer.mode, reason: answer.reason ?? null, citedRecords: answer.citations.length },
        isEducationalRecord: true,
      })).catch((error: unknown) => logger.warn("Owner assistant audit failed", { error: error instanceof Error ? error.message : String(error) }));
      return res.json(answer);
    } catch (error) {
      if (error instanceof OwnerStudentNotFoundError) return res.status(404).json({ error: { code: "STUDENT_NOT_FOUND", message: "Student not found" } });
      logger.error("Owner assistant failed", { error: error instanceof Error ? error.message : String(error) });
      return res.status(503).json({ error: { code: "UNAVAILABLE", message: "The owner assistant is unavailable right now." } });
    }
  });

  return router;
}

export default createAdminOwnerAssistantRouter();
