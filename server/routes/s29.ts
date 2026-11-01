/**
 * S29 — Student Intelligence & Operations routes (Phase A).
 *
 * Staff router (mounted under /api/admin/s29; per-route role checks; coaches have no access):
 *   GET  /attention                     admin, staff   Needs Attention queue (persisted; live fallback without schema)
 *   POST /attention/:key/action         admin, staff   dismiss | resolve | reopen (CSRF, audited)
 *   POST /attention/sync                admin          run the rules + concierge now (CSRF)
 *   GET  /concierge/settings            admin          PUT (CSRF, audited)
 *   GET  /notifications                 admin, staff   outbox / delivery history
 *   POST /notifications/:id/retry       admin          (CSRF, audited)
 *   POST /fleet/ask                     admin          Fleet AI copilot (CSRF, rate limited, audited without text)
 *   GET  /diagnostics                   admin          Diagnostics Studio data
 *   POST /diagnostics/checks/:key       admin          read-only one-click check (CSRF, audited)
 *   GET  /diagnostics/incidents         admin
 *   POST /diagnostics/incidents/:id     admin          acknowledge | resolve | reopen (CSRF, audited)
 *   POST /diagnostics/scheduler/run     admin          run due jobs now (CSRF)
 * Student router (mounted under /api/student/s29; student role; resolved from the session):
 *   GET  /notifications                 inbox          POST /notifications/read { ids?: string[], all?: true } (CSRF)
 *   GET  /notifications/preferences     PUT (CSRF)
 * Ops router (mounted under /api/ops):
 *   POST /scheduler/tick                header X-S29-Cron-Secret = S29_CRON_SECRET (constant-time compare); 404 when unset
 * Audit metadata holds identifiers, keys and counts only — never notes, questions, answers or message bodies.
 */
import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  DIAGNOSTIC_CHECKS, EMAIL_STATES, S29_ERROR_CODES as E,
  attentionActionSchema, conciergeSettingsSchema, fleetQuestionSchema, notificationPreferencesSchema,
  type AttentionQueueView, type DiagnosticCheckKey, type EmailState,
} from "@shared/s29-contract";
import { requireAuth } from "../middleware/auth";
import { requireCsrf } from "../middleware/csrf";
import { createAuditLog, type AuditEventType } from "../lib/audit";
import { logger } from "../lib/logger";
import { createRateLimitStore } from "../lib/rate-limit-store";
import { guardRoles, mentionsStudentId } from "./high-school-http";
import { errorCode, isInfraError, s29Schema, S29Error, type Tx } from "../services/s29/db";

async function defaultDb(): Promise<Tx> {
  const { db } = await import("../lib/db");
  return db as unknown as Tx;
}

export function emitS29Audit(req: Request, eventType: AuditEventType, description: string, metadata: Record<string, unknown>, target?: { type: string; id: string | null }): void {
  void Promise.resolve(createAuditLog({
    eventType, severity: "info", actorUserId: req.user?.id, actorRole: req.user?.role, actorIp: req.ip, actorUserAgent: req.get?.("user-agent") ?? undefined,
    targetResourceType: target?.type, targetResourceId: target?.id ?? undefined, actionDescription: description, metadata,
    requestId: (req.res?.getHeader("X-Request-ID") as string | undefined) ?? undefined,
  })).catch((error: unknown) => logger.warn("S29 audit emit failed", { eventType, code: errorCode(error) }));
}

export function emitS29AccessDenied(req: Request): void {
  emitS29Audit(req, "s29.access_denied", "Refused access to an S29 endpoint", { method: req.method, path: (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "", role: req.user?.role ?? null });
}

export function sendS29Error(res: Response, error: unknown, context: string) {
  if (error instanceof S29Error) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  if ((error as { code?: unknown })?.code === E.VALIDATION) return res.status(400).json({ error: { code: E.VALIDATION, message: (error as Error).message } });
  if (isInfraError(error)) {
    logger.warn(`S29 ${context} unavailable`, { code: errorCode(error) });
    return res.status(503).json({ error: { code: E.UNAVAILABLE, message: "This feature is temporarily unavailable" } });
  }
  logger.error(`S29 ${context} failed`, { code: errorCode(error) });
  return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
}

const validation = (res: Response, error: z.ZodError) =>
  res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid request", details: { issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } } });

const requireSchema = async (db: Tx, res: Response): Promise<boolean> => {
  if ((await s29Schema(db)).present) return true;
  res.status(503).json({ error: { code: E.UNAVAILABLE, message: "S29 is not switched on yet (schema not applied)" } });
  return false;
};

export interface S29RouterDeps { readonly db?: () => Promise<Tx>; readonly auth?: RequestHandler; readonly csrf?: RequestHandler; readonly now?: () => Date; readonly fetchImpl?: typeof fetch; readonly rateLimitStore?: boolean }

const attentionKey = z.string().trim().min(1).max(300);
const uuid = z.string().uuid();

export function createS29AdminRouter(deps: S29RouterDeps = {}): Router {
  const router = Router();
  const getDb = deps.db ?? defaultDb;
  const now = deps.now ?? (() => new Date());
  const auth = deps.auth ?? requireAuth;
  const csrf = deps.csrf ?? requireCsrf;
  const staff = [auth, guardRoles(["admin", "staff"], emitS29AccessDenied)];
  const admin = [auth, guardRoles(["admin"], emitS29AccessDenied)];
  const fleetLimit = rateLimit({
    store: deps.rateLimitStore === false ? undefined : createRateLimitStore("rl:s29-fleet:"), windowMs: 60_000, max: 6, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => `u:${req.user?.id ?? "anon"}`, validate: { keyGeneratorIpFallback: false },
    handler: (_req, res) => { res.status(429).json({ error: { code: "THROTTLED", message: "Too many requests. Please wait a moment." } }); },
  });

  // ── Needs Attention ──
  router.get("/attention", ...staff, (async (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const db = await getDb();
      const at = now();
      const { loadSettings, readAttentionQueue, liveAttentionQueue } = await import("../services/s29/attention-store");
      if (!(await s29Schema(db)).present) {
        const { computeAttention } = await import("../services/s29/rules");
        const { DEFAULT_CONCIERGE_SETTINGS } = await import("@shared/s29-contract");
        const out = await computeAttention(db, at, DEFAULT_CONCIERGE_SETTINGS, false);
        return res.json(liveAttentionQueue(out.items, at, out.truncated) satisfies AttentionQueueView);
      }
      const { readJobs } = await import("../services/s29/scheduler");
      const job = (await readJobs(db, at)).find((j) => j.name === "rules.sync");
      // First use (or stale store): compute and persist synchronously so the queue is never empty by accident.
      if (!job?.lastSuccessAt || at.getTime() - Date.parse(job.lastSuccessAt) > 30 * 60_000) {
        const { computeAttention } = await import("../services/s29/rules");
        const { syncAttention } = await import("../services/s29/attention-store");
        const out = await computeAttention(db, at, await loadSettings(db), true);
        await syncAttention(db, out.items, at);
        return res.json(await readAttentionQueue(db, at, at.toISOString(), out.truncated));
      }
      return res.json(await readAttentionQueue(db, at, job.lastSuccessAt));
    } catch (error) {
      return sendS29Error(res, error, "attention read");
    }
  }) as RequestHandler);

  router.post("/attention/sync", ...admin, csrf, (async (req: Request, res: Response) => {
    try {
      const db = await getDb();
      if (!(await requireSchema(db, res))) return;
      const at = now();
      const { computeAttention } = await import("../services/s29/rules");
      const { loadSettings, syncAttention } = await import("../services/s29/attention-store");
      const { runConcierge } = await import("../services/s29/concierge");
      const settings = await loadSettings(db);
      const out = await computeAttention(db, at, settings, true);
      const sync = await syncAttention(db, out.items, at);
      const concierge = await runConcierge(db, out.items, out.facts, settings, at);
      emitS29Audit(req, "s29.attention_updated", "Rules engine run on demand", { ...sync, conciergeCreated: concierge.created });
      return res.json({ result: { ...sync, concierge } });
    } catch (error) {
      return sendS29Error(res, error, "attention sync");
    }
  }) as RequestHandler);

  router.post("/attention/:key/action", ...staff, csrf, (async (req: Request, res: Response) => {
    const key = attentionKey.safeParse(req.params.key);
    const body = attentionActionSchema.safeParse(req.body ?? {});
    if (!key.success) return res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid key" } });
    if (!body.success) return validation(res, body.error);
    try {
      const db = await getDb();
      if (!(await requireSchema(db, res))) return;
      const { actOnAttention } = await import("../services/s29/attention-store");
      const out = await actOnAttention(db, key.data, body.data, req.user!.id, now());
      emitS29Audit(req, "s29.attention_updated", `Attention item ${body.data.action}`, { key: key.data, from: out.before, to: out.after, snoozeDays: body.data.snoozeDays ?? null, hasNote: !!body.data.note }, { type: "attention_item", id: key.data });
      return res.json({ key: key.data, status: out.after });
    } catch (error) {
      return sendS29Error(res, error, "attention action");
    }
  }) as RequestHandler);

  // ── concierge settings ──
  router.get("/concierge/settings", ...admin, (async (_req: Request, res: Response) => {
    try {
      const { loadSettings } = await import("../services/s29/attention-store");
      return res.json(await loadSettings(await getDb()));
    } catch (error) {
      return sendS29Error(res, error, "settings read");
    }
  }) as RequestHandler);
  router.put("/concierge/settings", ...admin, csrf, (async (req: Request, res: Response) => {
    const body = conciergeSettingsSchema.safeParse(req.body ?? {});
    if (!body.success) return validation(res, body.error);
    try {
      const db = await getDb();
      if (!(await requireSchema(db, res))) return;
      const { saveSettings } = await import("../services/s29/attention-store");
      const saved = await saveSettings(db, body.data, req.user!.id);
      emitS29Audit(req, "s29.settings_updated", "Concierge settings updated", { ...saved });
      return res.json(saved);
    } catch (error) {
      return sendS29Error(res, error, "settings update");
    }
  }) as RequestHandler);

  // ── outbox ──
  router.get("/notifications", ...staff, (async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const state = typeof req.query.state === "string" && (EMAIL_STATES as readonly string[]).includes(req.query.state) ? (req.query.state as EmailState) : undefined;
    const studentId = typeof req.query.studentId === "string" && req.query.studentId.length <= 128 ? req.query.studentId : undefined;
    try {
      const db = await getDb();
      if (!(await requireSchema(db, res))) return;
      const { readOutbox } = await import("../services/s29/outbox");
      const { readJobs, schedulerState } = await import("../services/s29/scheduler");
      const job = (await readJobs(db, now())).find((j) => j.name === "outbox.deliver");
      return res.json(await readOutbox(db, { state, studentId }, { lastTickAt: schedulerState().lastTickAt ?? job?.lastStartedAt ?? null, lastDeliverySuccessAt: job?.lastSuccessAt ?? null }));
    } catch (error) {
      return sendS29Error(res, error, "outbox read");
    }
  }) as RequestHandler);
  router.post("/notifications/:id/retry", ...admin, csrf, (async (req: Request, res: Response) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid id" } });
    try {
      const db = await getDb();
      if (!(await requireSchema(db, res))) return;
      const { retryNotification } = await import("../services/s29/outbox");
      const retried = await retryNotification(db, id.data);
      if (retried) emitS29Audit(req, "s29.notification_retried", "Notification email re-queued", { notificationId: id.data }, { type: "notification", id: id.data });
      return res.json({ retried });
    } catch (error) {
      return sendS29Error(res, error, "notification retry");
    }
  }) as RequestHandler);

  // ── Fleet AI copilot ──
  router.post("/fleet/ask", ...admin, csrf, fleetLimit, (async (req: Request, res: Response) => {
    const body = fleetQuestionSchema.extend({ useAi: z.boolean().default(false) }).strict().safeParse(req.body ?? {});
    if (!body.success) return validation(res, body.error);
    res.setHeader("Cache-Control", "no-store");
    try {
      const db = await getDb();
      const at = now();
      const { answerFleet } = await import("../services/s29/fleet");
      const { PgBudgetStore } = await import("../services/academic-assistant/budget");
      let items: AttentionQueueView["items"];
      if ((await s29Schema(db)).present) {
        const { readAttentionQueue } = await import("../services/s29/attention-store");
        items = (await readAttentionQueue(db, at, null)).items;
      } else {
        const { computeAttention } = await import("../services/s29/rules");
        const { liveAttentionQueue } = await import("../services/s29/attention-store");
        const { DEFAULT_CONCIERGE_SETTINGS } = await import("@shared/s29-contract");
        const out = await computeAttention(db, at, DEFAULT_CONCIERGE_SETTINGS, false);
        items = liveAttentionQueue(out.items, at, out.truncated).items;
      }
      const answer = await answerFleet({ question: body.data.question, language: body.data.language, includeDemo: body.data.includeDemo }, items, { budget: new PgBudgetStore(), now: () => at, useAi: body.data.useAi, fetchImpl: deps.fetchImpl as never });
      emitS29Audit(req, "s29.fleet_query", "Fleet copilot question answered", { intent: answer.intent, references: answer.references.length, drafts: answer.drafts.length, ai: answer.ai.mode, language: body.data.language, includeDemo: body.data.includeDemo });
      return res.json(answer);
    } catch (error) {
      return sendS29Error(res, error, "fleet copilot");
    }
  }) as RequestHandler);

  // ── diagnostics ──
  router.get("/diagnostics", ...admin, (async (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const db = await getDb();
      const { buildDiagnostics } = await import("../services/s29/diagnostics");
      const { loadSettings } = await import("../services/s29/attention-store");
      const settings = (await s29Schema(db).catch(() => ({ present: false }))).present ? await loadSettings(db) : { enabled: true };
      return res.json(await buildDiagnostics(db, now(), settings.enabled));
    } catch (error) {
      return sendS29Error(res, error, "diagnostics");
    }
  }) as RequestHandler);
  router.post("/diagnostics/checks/:key", ...admin, csrf, (async (req: Request, res: Response) => {
    const key = z.enum(DIAGNOSTIC_CHECKS).safeParse(req.params.key);
    if (!key.success) return res.status(400).json({ error: { code: E.VALIDATION, message: "Unknown check" } });
    try {
      const { runCheck } = await import("../services/s29/diagnostics");
      const out = await runCheck(await getDb(), key.data as DiagnosticCheckKey, { id: req.user!.id }, now());
      emitS29Audit(req, "s29.diagnostic_run", "Diagnostic check run", { check: key.data, state: out.state, durationMs: out.durationMs });
      return res.json(out);
    } catch (error) {
      return sendS29Error(res, error, "diagnostic check");
    }
  }) as RequestHandler);
  router.get("/diagnostics/incidents", ...admin, (async (req: Request, res: Response) => {
    try {
      const db = await getDb();
      if (!(await requireSchema(db, res))) return;
      const { listIncidents } = await import("../services/s29/incidents");
      const search = typeof req.query.search === "string" ? req.query.search.slice(0, 60) : undefined;
      const status = typeof req.query.status === "string" && ["open", "acknowledged", "resolved"].includes(req.query.status) ? req.query.status : undefined;
      return res.json({ incidents: await listIncidents(db, { search, status }) });
    } catch (error) {
      return sendS29Error(res, error, "incidents");
    }
  }) as RequestHandler);
  router.post("/diagnostics/incidents/:id", ...admin, csrf, (async (req: Request, res: Response) => {
    const id = uuid.safeParse(req.params.id);
    const body = z.object({ action: z.enum(["acknowledge", "resolve", "reopen"]) }).strict().safeParse(req.body ?? {});
    if (!id.success) return res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid id" } });
    if (!body.success) return validation(res, body.error);
    try {
      const db = await getDb();
      if (!(await requireSchema(db, res))) return;
      const { updateIncident } = await import("../services/s29/incidents");
      const incident = await updateIncident(db, id.data, body.data.action, req.user!.id);
      if (!incident) return res.status(404).json({ error: { code: E.NOT_FOUND, message: "Incident not found" } });
      emitS29Audit(req, "s29.incident_updated", `Incident ${body.data.action}`, { incidentId: id.data, action: body.data.action }, { type: "incident", id: id.data });
      return res.json({ incident });
    } catch (error) {
      return sendS29Error(res, error, "incident update");
    }
  }) as RequestHandler);
  router.post("/diagnostics/scheduler/run", ...admin, csrf, (async (_req: Request, res: Response) => {
    try {
      const { tick } = await import("../services/s29/scheduler");
      return res.json({ result: await tick(await getDb(), now()) });
    } catch (error) {
      return sendS29Error(res, error, "scheduler run");
    }
  }) as RequestHandler);

  return router;
}

export function createS29StudentRouter(deps: S29RouterDeps & { getStudentByUserId?: (userId: string) => Promise<{ id: string } | null> } = {}): Router {
  const router = Router();
  const getDb = deps.db ?? defaultDb;
  const auth = deps.auth ?? requireAuth;
  const csrf = deps.csrf ?? requireCsrf;
  const studentOnly = [auth, guardRoles(["student"], emitS29AccessDenied)];
  const noStudentId: RequestHandler = (req, res, next) => (mentionsStudentId(req) ? res.status(400).json({ error: { code: E.VALIDATION, message: "studentId is not accepted; the student is resolved from your login" } }) : next());

  router.get("/notifications", ...studentOnly, noStudentId, (async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const db = await getDb();
      if (!(await requireSchema(db, res))) return;
      const { readInbox } = await import("../services/s29/outbox");
      return res.json(await readInbox(db, req.user!.id));
    } catch (error) {
      return sendS29Error(res, error, "inbox");
    }
  }) as RequestHandler);
  router.post("/notifications/read", ...studentOnly, noStudentId, csrf, (async (req: Request, res: Response) => {
    const body = z.union([z.object({ all: z.literal(true) }).strict(), z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).strict()]).safeParse(req.body ?? {});
    if (!body.success) return validation(res, body.error);
    try {
      const db = await getDb();
      if (!(await requireSchema(db, res))) return;
      const { markRead } = await import("../services/s29/outbox");
      const updated = await markRead(db, req.user!.id, "all" in body.data ? "all" : body.data.ids);
      return res.json({ updated });
    } catch (error) {
      return sendS29Error(res, error, "inbox read");
    }
  }) as RequestHandler);
  router.get("/notifications/preferences", ...studentOnly, noStudentId, (async (req: Request, res: Response) => {
    try {
      const db = await getDb();
      if (!(await requireSchema(db, res))) return;
      const { loadPreferences } = await import("../services/s29/outbox");
      return res.json(await loadPreferences(db, req.user!.id));
    } catch (error) {
      return sendS29Error(res, error, "preferences read");
    }
  }) as RequestHandler);
  router.put("/notifications/preferences", ...studentOnly, noStudentId, csrf, (async (req: Request, res: Response) => {
    const body = notificationPreferencesSchema.safeParse(req.body ?? {});
    if (!body.success) return validation(res, body.error);
    try {
      const db = await getDb();
      if (!(await requireSchema(db, res))) return;
      const { savePreferences } = await import("../services/s29/outbox");
      const saved = await savePreferences(db, req.user!.id, body.data);
      emitS29Audit(req, "s29.preferences_updated", "Notification preferences updated", { emailOff: Object.entries(saved.email).filter(([, v]) => !v).map(([k]) => k), quietHours: saved.quietHours.enabled, maxRemindersPerDay: saved.maxRemindersPerDay }, { type: "user", id: req.user!.id });
      return res.json(saved);
    } catch (error) {
      return sendS29Error(res, error, "preferences update");
    }
  }) as RequestHandler);
  return router;
}

/** Constant-time comparison of the cron secret; false when unset or lengths differ. */
export function cronSecretMatches(provided: unknown, expected: string | undefined): boolean {
  if (!expected || expected.length < 24 || typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createS29OpsRouter(deps: S29RouterDeps & { secret?: () => string | undefined } = {}): Router {
  const router = Router();
  const getDb = deps.db ?? defaultDb;
  const secret = deps.secret ?? (() => process.env.S29_CRON_SECRET);
  router.post("/scheduler/tick", (async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    if (!secret()) return res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
    if (!cronSecretMatches(req.get("x-s29-cron-secret"), secret())) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid scheduler credential" } });
    try {
      const { tick } = await import("../services/s29/scheduler");
      const out = await tick(await getDb(), deps.now?.() ?? new Date());
      // Only job names and counts: never record contents.
      return res.json({ ok: true, ran: Object.keys(out).filter((k) => k !== "skipped"), skipped: (out as { skipped?: string }).skipped ?? null });
    } catch (error) {
      return sendS29Error(res, error, "scheduler tick");
    }
  }) as RequestHandler);
  return router;
}
