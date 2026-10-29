/**
 * S27 — Lumière web research routes (mounted under /api/admin). Admin and staff only.
 *
 * GET  /web-research/status   availability only (no model call)
 * POST /web-research          { question, language } -> WebResearchAnswer
 *
 * Only the typed question is sent to the provider (never a student record). Questions with contact data
 * or student codes are refused (400 WEB_RESEARCH_PERSONAL_DATA). The audit event never stores the text.
 */
import { Router, type Request, type Response, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requireCsrf } from "../middleware/csrf";
import { createRateLimitStore } from "../lib/rate-limit-store";
import { createAuditLog, type AuditLogEntry } from "../lib/audit";
import { logger } from "../lib/logger";
import { loadAssistantConfig } from "../services/academic-assistant/config";
import { PgBudgetStore } from "../services/academic-assistant/budget";
import {
  askWebResearch,
  webResearchDecision,
  WebResearchRejectedError,
  WEB_RESEARCH_MAX_QUESTION_CHARS,
  WEB_RESEARCH_ROLES,
  type WebResearchDeps,
} from "../services/web-research/service";
import { emitAccessDenied } from "./high-school-audit";
import { guardRoles } from "./high-school-http";

const bodySchema = z.object({
  question: z.string().trim().min(3).max(WEB_RESEARCH_MAX_QUESTION_CHARS),
  language: z.enum(["en", "fr"]),
}).strict();

export interface WebResearchRouterOptions {
  deps?: WebResearchDeps;
  auth?: RequestHandler;
  csrf?: RequestHandler;
  audit?: (entry: AuditLogEntry) => Promise<void>;
  rateLimitPerMinute?: number;
}

export function createAdminWebResearchRouter(opts: WebResearchRouterOptions = {}): Router {
  const router = Router();
  const deps: WebResearchDeps = opts.deps ?? { budget: new PgBudgetStore() };
  const audit = opts.audit ?? createAuditLog;
  const staffOnly = [opts.auth ?? requireAuth, guardRoles([...WEB_RESEARCH_ROLES], emitAccessDenied)];
  const throttle = rateLimit({
    store: opts.deps ? undefined : createRateLimitStore("rl:web-research:"),
    windowMs: 60_000,
    max: opts.rateLimitPerMinute ?? Math.min(loadAssistantConfig().rateLimitPerMinute, 4),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `u:${req.user?.id ?? "anon"}`,
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, res) => { res.status(429).json({ error: { code: "THROTTLED", message: "Too many searches. Please wait a moment." } }); },
  });

  router.get("/web-research/status", ...staffOnly, (req: Request, res: Response) => {
    const decision = webResearchDecision(req.user!.role, (deps.config ?? loadAssistantConfig)(), deps.env);
    res.setHeader("Cache-Control", "no-store");
    res.json(decision.live ? { mode: "live" } : { mode: "unavailable", reason: decision.reason });
  });

  router.post("/web-research", ...staffOnly, opts.csrf ?? requireCsrf, throttle, async (req: Request, res: Response) => {
    const body = bodySchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: { code: "VALIDATION_FAILED", message: "Ask a question of 3 to 600 characters." } });
    res.setHeader("Cache-Control", "no-store");
    try {
      const answer = await askWebResearch({ id: req.user!.id, role: req.user!.role }, body.data, deps);
      void Promise.resolve(audit({
        eventType: "admin.data_export",
        severity: "info",
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        actorIp: req.ip,
        actorUserAgent: req.get?.("user-agent") ?? undefined,
        targetResourceType: "web_research",
        actionDescription: "Web research question sent to the search provider (question text not stored)",
        metadata: { surface: "web_research", language: body.data.language, mode: answer.mode, reason: answer.reason ?? null, searched: answer.searched, sources: answer.sources.length },
        isEducationalRecord: false,
      })).catch((error: unknown) => logger.warn("Web research audit failed", { error: error instanceof Error ? error.message : String(error) }));
      return res.json(answer);
    } catch (error) {
      if (error instanceof WebResearchRejectedError) {
        return res.status(400).json({ error: { code: error.code, message: "Remove email addresses, phone numbers and student codes: only general questions go to the web." } });
      }
      logger.error("Web research failed", { error: error instanceof Error ? error.message : String(error) });
      return res.status(503).json({ error: { code: "UNAVAILABLE", message: "Web research is unavailable right now." } });
    }
  });

  return router;
}

export default createAdminWebResearchRouter();
