/**
 * S30 Phase A routes: operational layer + academic calendar + notifications + iCalendar feeds.
 *
 * Admin (mounted under /api/admin; per-route role checks so mounting never intercepts other admin paths):
 *   GET   /operations/exceptions            admin, staff     Control Center queue + owner state
 *   PATCH /operations/exceptions/:id        admin (CSRF)     acknowledge / snooze / reopen
 *   GET   /operations/events                admin, staff     operational event timeline (?studentId, ?before)
 *   GET   /operations/diagnostics           admin            subsystem health
 *   POST  /operations/concierge/run         admin (CSRF)     run the reminder sweep now
 *   GET   /calendar                         admin, staff     ?from&to[&studentId][&includeDemo=1]
 *   POST  /calendar/events                  admin, staff (CSRF)  schedule
 *   PATCH /calendar/events/:id              admin, staff (CSRF)  reschedule / cancel
 *   GET   /calendar/export.ics              admin, staff     download (same query as /calendar)
 *   GET|POST /calendar/subscriptions, DELETE /calendar/subscriptions/:id   admin, staff (CSRF on writes)
 * Student (mounted under /api/student; the student is resolved from the session, a studentId anywhere is refused):
 *   GET /calendar, GET /calendar/export.ics, GET|POST /calendar/subscriptions, DELETE /calendar/subscriptions/:id
 * Any signed-in user (mounted under /api/notifications): GET /, POST /:id/read, POST /read-all (own rows only).
 * Public (mounted at /calendar/feed): GET /:token.ics  — revocable token, owner's role re-checked on every fetch.
 * Coaches have no access to operations or calendar. Errors never log query parameters or record text.
 */
import { Router, type Request, type RequestHandler, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  S30_AUDIT_EVENTS,
  S30_ERROR_CODES as E,
  calendarRangeSchema,
  createCalendarEventSchema,
  createSubscriptionSchema,
  updateCalendarEventSchema,
  updateExceptionSchema,
  type CalendarView,
  type DiagnosticsView,
  type OpsExceptionsView,
} from "@shared/s30-contract";
import { requireAuth } from "../middleware/auth";
import { requireCsrf } from "../middleware/csrf";
import { createRateLimitStore } from "../lib/rate-limit-store";
import { createAuditLog, type AuditEventType } from "../lib/audit";
import { logger } from "../lib/logger";
import { guardRoles, mentionsStudentId } from "./high-school-http";
import { OpsError, isMissingTable, listEvents, listNotifications, markNotificationRead, notify, setExceptionState, type EmailSender, type TxDb } from "../services/s30/ops";
import {
  createCalendarEvent,
  createSubscription,
  getCalendarView,
  listSubscriptions,
  resolveFeedToken,
  revokeSubscription,
  updateCalendarEvent,
  type CalendarMutationResult,
} from "../services/s30/calendar";
import { buildIcs, type IcsLang } from "../services/s30/ics";
import { runConcierge, createEmailSender } from "../services/s30/concierge";
import { computeDiagnostics } from "../services/s30/diagnostics";
import { sql } from "drizzle-orm";

export interface S30Deps {
  readonly db: TxDb;
  readonly now?: () => Date;
  readonly loadExceptions: (now: Date) => Promise<{ view: OpsExceptionsView }>;
  readonly getStudentByUserId: (userId: string) => Promise<{ readonly id: string } | null>;
  readonly email?: EmailSender;
  readonly release?: string | null;
  readonly auth?: RequestHandler;
  readonly csrf?: RequestHandler;
  readonly audit?: (entry: Parameters<typeof createAuditLog>[0]) => Promise<void>;
  readonly appUrl?: string | null;
  /** Disable rate limiting in tests. */
  readonly noRateLimit?: boolean;
}

const idSchema = z.string().trim().min(1).max(300);
const uuidSchema = z.string().uuid();

function sendError(res: Response, error: unknown, context: string) {
  if (error instanceof OpsError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  if (isMissingTable(error)) {
    logger.warn(`S30 ${context} unavailable (schema not applied)`);
    return res.status(503).json({ error: { code: E.UNAVAILABLE, message: "This feature is not switched on for this deployment yet" } });
  }
  for (let e: any = error, i = 0; e && i < 4; e = e.cause, i++) {
    const code = typeof e.code === "string" ? e.code : "";
    if (code.startsWith("08") || ["57P01", "57P03", "53300", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "CONNECT_TIMEOUT"].includes(code)) {
      return res.status(503).json({ error: { code: E.UNAVAILABLE, message: "Temporarily unavailable" } });
    }
  }
  const e = error as { name?: unknown; code?: unknown } | null;
  logger.error(`S30 ${context} failed`, { name: typeof e?.name === "string" ? e.name : typeof error, code: typeof e?.code === "string" ? e.code : undefined });
  return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
}
const validation = (res: Response, error: z.ZodError) =>
  res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid request", details: { issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } } });

function auditFn(deps: S30Deps) {
  const write = deps.audit ?? createAuditLog;
  return (req: Request, eventType: AuditEventType, description: string, metadata: Record<string, string | number | boolean | null>, studentId?: string | null, severity: "info" | "warning" = "info") => {
    void Promise.resolve(write({
      eventType, severity, actorUserId: req.user?.id, actorRole: req.user?.role, actorIp: req.ip, actorUserAgent: req.get?.("user-agent") ?? undefined,
      targetResourceType: studentId ? "student" : "operations", targetResourceId: studentId ?? undefined, actionDescription: description, metadata, isEducationalRecord: !!studentId,
    })).catch((error: unknown) => logger.warn("S30 audit failed", { eventType, error: error instanceof Error ? error.message : String(error) }));
  };
}

const deniedFn = (deps: S30Deps) => (req: Request) => auditFn(deps)(req, S30_AUDIT_EVENTS.accessDenied as AuditEventType, "Refused access to an operations or calendar endpoint",
  { method: req.method, path: (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "", role: req.user?.role ?? null }, null, "warning");

const wrap = (context: string, fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  try { await fn(req, res); } catch (error) { sendError(res, error, context); }
}) as RequestHandler;

const ICS_HEADERS = (res: Response, filename: string) => {
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
};
const todayPlus = (now: Date, days: number) => new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);

async function userLanguage(db: TxDb, userId: string): Promise<IcsLang> {
  try {
    const r = Array.from((await db.execute(sql`SELECT language FROM user_language_preference WHERE user_id = ${userId}`)) as unknown as Array<{ language?: string }>)[0];
    return r?.language === "fr" ? "fr" : "en";
  } catch { return "en"; }
}

/** Notifies the student (in-app + email when configured) when a visible appointment is scheduled, moved or cancelled. */
async function notifyCalendarChange(deps: S30Deps, m: CalendarMutationResult, notifyRequested: boolean) {
  if (!notifyRequested || !m.visibleToStudent || !m.studentUserId || m.change === "updated") return;
  await notify(deps.db, {
    recipientUserId: m.studentUserId, kind: "calendar.event_changed", params: { date: m.startsAt, change: m.change, itemKind: m.kind }, href: "/calendar",
    dedupeKey: `calendar:${m.id}:${m.change}:${m.startsAt}`,
  }, deps.email ?? createEmailSender(deps.db));
}

// ── admin router ─────────────────────────────────────────────────────────────

export function createS30AdminRouter(deps: S30Deps): Router {
  const router = Router();
  const now = () => deps.now?.() ?? new Date();
  const auth = deps.auth ?? requireAuth;
  const csrf = deps.csrf ?? requireCsrf;
  const denied = deniedFn(deps);
  const audit = auditFn(deps);
  const readers = [auth, guardRoles(["admin", "staff"], denied)];
  const adminOnly = [auth, guardRoles(["admin"], denied)];
  const adminWrite = [...adminOnly, csrf];
  const staffWrite = [...readers, csrf];

  router.get("/operations/exceptions", ...readers, wrap("exceptions", async (_req, res) => res.json((await deps.loadExceptions(now())).view)));

  router.patch("/operations/exceptions/:id", ...adminWrite, wrap("exception update", async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    const body = updateExceptionSchema.safeParse(req.body ?? {});
    if (!id.success) return res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid exception id" } });
    if (!body.success) return validation(res, body.error);
    const { view } = await deps.loadExceptions(now());
    const ex = view.exceptions.find((e) => e.id === id.data);
    if (!ex) return res.status(404).json({ error: { code: E.NOT_FOUND, message: "This exception is no longer open" } });
    await setExceptionState(deps.db, id.data, body.data.state, body.data.snoozeDays, req.user!.id, now());
    audit(req, S30_AUDIT_EVENTS.exceptionUpdated as AuditEventType, "Owner changed the state of an operational exception", { kind: ex.kind, state: body.data.state, snoozeDays: body.data.snoozeDays ?? null }, ex.studentId);
    return res.json({ ...ex, state: body.data.state, snoozedUntil: body.data.state === "snoozed" ? new Date(now().getTime() + (body.data.snoozeDays ?? 1) * 86_400_000).toISOString() : null });
  }));

  router.get("/operations/events", ...readers, wrap("events", async (req, res) => {
    const q = z.object({ studentId: z.string().trim().min(1).max(128).optional(), before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).strict().safeParse(req.query);
    if (!q.success) return validation(res, q.error);
    return res.json({ events: await listEvents(deps.db, { studentId: q.data.studentId ?? null, beforeSeq: q.data.before ?? null, limit: q.data.limit ?? 50 }) });
  }));

  router.get("/operations/diagnostics", ...adminOnly, wrap("diagnostics", async (_req, res) => {
    const view: DiagnosticsView = await computeDiagnostics(deps.db, now(), deps.release ?? null, {
      exceptionsOpen: async () => (await deps.loadExceptions(now())).view.counts.open,
    });
    return res.json(view);
  }));

  router.post("/operations/concierge/run", ...adminWrite, wrap("concierge run", async (req, res) => {
    const result = await runConcierge(deps.db, now(), { email: deps.email });
    return res.json(result);
  }));

  // ── calendar
  const rangeOf = (req: Request, res: Response) => {
    const q = calendarRangeSchema.safeParse({ from: req.query.from, to: req.query.to, ...(req.query.studentId ? { studentId: req.query.studentId } : {}), ...(req.query.includeDemo ? { includeDemo: req.query.includeDemo } : {}) });
    if (!q.success) { validation(res, q.error); return null; }
    return q.data;
  };
  router.get("/calendar", ...readers, wrap("calendar", async (req, res) => {
    const r = rangeOf(req, res); if (!r) return;
    const view: CalendarView = await getCalendarView(deps.db, { role: req.user!.role as "admin" | "staff" }, { from: r.from, to: r.to, studentId: r.studentId, includeDemo: r.includeDemo === "1" }, now());
    return res.json(view);
  }));
  router.get("/calendar/export.ics", ...readers, wrap("calendar export", async (req, res) => {
    const r = rangeOf(req, res); if (!r) return;
    const view = await getCalendarView(deps.db, { role: req.user!.role as "admin" | "staff" }, { from: r.from, to: r.to, studentId: r.studentId, includeDemo: r.includeDemo === "1" }, now());
    const lang = await userLanguage(deps.db, req.user!.id);
    ICS_HEADERS(res, "lumiere-calendar.ics");
    return res.send(buildIcs(view.items, { calendarName: lang === "fr" ? "Lumière — calendrier du personnel" : "Lumière — staff calendar", lang, privacy: "detailed", baseUrl: deps.appUrl ?? null, audience: "staff", now: now() }));
  }));
  router.post("/calendar/events", ...staffWrite, wrap("calendar create", async (req, res) => {
    const body = createCalendarEventSchema.safeParse(req.body ?? {});
    if (!body.success) return validation(res, body.error);
    const out = await createCalendarEvent(deps.db, body.data, req.user!.id);
    audit(req, S30_AUDIT_EVENTS.calendarEventChanged as AuditEventType, "Calendar event scheduled", { eventId: out.id, kind: out.kind, change: out.change }, out.studentId);
    await notifyCalendarChange(deps, out, body.data.notify).catch(() => undefined);
    return res.status(201).json(out);
  }));
  router.patch("/calendar/events/:id", ...staffWrite, wrap("calendar update", async (req, res) => {
    const id = uuidSchema.safeParse(req.params.id);
    const body = updateCalendarEventSchema.safeParse(req.body ?? {});
    if (!id.success) return res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid event id" } });
    if (!body.success) return validation(res, body.error);
    const out = await updateCalendarEvent(deps.db, id.data, body.data, req.user!.id);
    audit(req, S30_AUDIT_EVENTS.calendarEventChanged as AuditEventType, `Calendar event ${out.change}`, { eventId: out.id, kind: out.kind, change: out.change }, out.studentId);
    await notifyCalendarChange(deps, out, body.data.notify).catch(() => undefined);
    return res.json(out);
  }));
  subscriptionRoutes(router, deps, readers, staffWrite, "staff");
  return router;
}

function subscriptionRoutes(router: Router, deps: S30Deps, readers: RequestHandler[], writers: RequestHandler[], scope: "staff" | "student", guard?: (req: Request, res: Response) => Promise<boolean>) {
  const audit = auditFn(deps);
  const ok = async (req: Request, res: Response) => (guard ? guard(req, res) : true);
  router.get("/calendar/subscriptions", ...readers, wrap("subscriptions", async (req, res) => {
    if (!(await ok(req, res))) return;
    return res.json({ subscriptions: (await listSubscriptions(deps.db, req.user!.id)).filter((s) => s.scope === scope) });
  }));
  router.post("/calendar/subscriptions", ...writers, wrap("subscription create", async (req, res) => {
    if (!(await ok(req, res))) return;
    const body = createSubscriptionSchema.safeParse(req.body ?? {});
    if (!body.success) return validation(res, body.error);
    const sub = await createSubscription(deps.db, req.user!.id, scope, body.data.privacy, body.data.label ?? null);
    audit(req, S30_AUDIT_EVENTS.calendarSubscriptionChanged as AuditEventType, "Calendar subscription link created", { subscriptionId: sub.id, scope, privacy: sub.privacy });
    return res.status(201).json(sub);
  }));
  router.delete("/calendar/subscriptions/:id", ...writers, wrap("subscription revoke", async (req, res) => {
    if (!(await ok(req, res))) return;
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid subscription id" } });
    if (!(await revokeSubscription(deps.db, req.user!.id, id.data))) return res.status(404).json({ error: { code: E.NOT_FOUND, message: "Subscription not found" } });
    audit(req, S30_AUDIT_EVENTS.calendarSubscriptionChanged as AuditEventType, "Calendar subscription link revoked", { subscriptionId: id.data, scope });
    return res.status(204).end();
  }));
}

// ── student router ───────────────────────────────────────────────────────────

export function createS30StudentRouter(deps: S30Deps): Router {
  const router = Router();
  const now = () => deps.now?.() ?? new Date();
  const auth = deps.auth ?? requireAuth;
  const csrf = deps.csrf ?? requireCsrf;
  const studentOnly = [auth, guardRoles(["student"], deniedFn(deps))];
  const resolve = async (req: Request, res: Response): Promise<string | null> => {
    if (mentionsStudentId(req)) { res.status(400).json({ error: { code: E.VALIDATION, message: "studentId is not accepted; the student is resolved from your login" } }); return null; }
    const s = await deps.getStudentByUserId(req.user!.id);
    if (!s) { res.status(404).json({ error: { code: E.NOT_FOUND, message: "No student profile found for this account" } }); return null; }
    return s.id;
  };
  const range = (req: Request, res: Response) => {
    const q = calendarRangeSchema.safeParse({ from: req.query.from, to: req.query.to });
    if (!q.success) { validation(res, q.error); return null; }
    return q.data;
  };
  router.get("/calendar", ...studentOnly, wrap("student calendar", async (req, res) => {
    const id = await resolve(req, res); if (!id) return;
    const r = range(req, res); if (!r) return;
    return res.json(await getCalendarView(deps.db, { role: "student", studentId: id }, { from: r.from, to: r.to }, now()));
  }));
  router.get("/calendar/export.ics", ...studentOnly, wrap("student calendar export", async (req, res) => {
    const id = await resolve(req, res); if (!id) return;
    const r = range(req, res); if (!r) return;
    const view = await getCalendarView(deps.db, { role: "student", studentId: id }, { from: r.from, to: r.to }, now());
    const lang = await userLanguage(deps.db, req.user!.id);
    ICS_HEADERS(res, "lumiere-calendar.ics");
    return res.send(buildIcs(view.items, { calendarName: lang === "fr" ? "Lumière — mon calendrier" : "Lumière — my calendar", lang, privacy: "detailed", baseUrl: deps.appUrl ?? null, audience: "student", now: now() }));
  }));
  subscriptionRoutes(router, deps, studentOnly, [...studentOnly, csrf], "student", async (req, res) => (await resolve(req, res)) !== null);
  return router;
}

// ── notifications router ─────────────────────────────────────────────────────

export function createNotificationsRouter(deps: S30Deps): Router {
  const router = Router();
  const auth = deps.auth ?? requireAuth;
  const csrf = deps.csrf ?? requireCsrf;
  router.get("/", auth, wrap("notifications", async (req, res) => res.json(await listNotifications(deps.db, req.user!.id))));
  router.post("/read-all", auth, csrf, wrap("notifications read", async (req, res) => res.json({ updated: await markNotificationRead(deps.db, req.user!.id, null) })));
  router.post("/:id/read", auth, csrf, wrap("notification read", async (req, res) => {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid notification id" } });
    return res.json({ updated: await markNotificationRead(deps.db, req.user!.id, id.data) });
  }));
  return router;
}

// ── public feed ──────────────────────────────────────────────────────────────

export function createCalendarFeedRouter(deps: S30Deps): Router {
  const router = Router();
  const now = () => deps.now?.() ?? new Date();
  if (!deps.noRateLimit) {
    router.use(rateLimit({
      store: createRateLimitStore("rl:calendar-feed:"), windowMs: 15 * 60_000, max: 60, standardHeaders: true, legacyHeaders: false,
      handler: (_req, res) => { res.status(429).type("text/plain").send("Too many requests"); },
    }));
  }
  router.get("/:file", (async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    const m = /^([A-Za-z0-9_-]{43})\.ics$/.exec(String(req.params.file ?? ""));
    if (!m) return res.status(404).type("text/plain").send("Not found");
    try {
      const sub = await resolveFeedToken(deps.db, m[1]!);
      if (!sub) return res.status(404).type("text/plain").send("Not found");
      const viewer = sub.scope === "student" ? { role: "student" as const, studentId: sub.studentId! } : { role: sub.role as "admin" | "staff" };
      const range = { from: todayPlus(now(), -30), to: todayPlus(now(), 89) };
      const view = await getCalendarView(deps.db, viewer, range, now());
      const lang = await userLanguage(deps.db, sub.userId);
      ICS_HEADERS(res, "lumiere.ics");
      return res.send(buildIcs(view.items, {
        calendarName: sub.scope === "staff" ? (lang === "fr" ? "Lumière — personnel" : "Lumière — staff") : "Lumière",
        lang, privacy: sub.privacy, baseUrl: deps.appUrl ?? null, audience: sub.scope, now: now(),
      }));
    } catch (error) {
      if (isMissingTable(error)) return res.status(404).type("text/plain").send("Not found");
      logger.error("Calendar feed failed", { name: (error as Error)?.name });
      return res.status(500).type("text/plain").send("Unavailable");
    }
  }) as RequestHandler);
  return router;
}

// ── production wiring ────────────────────────────────────────────────────────

export async function createDefaultS30Deps(release: string | null): Promise<S30Deps> {
  const { s30Db, loadExceptions } = await import("../services/s30/default");
  const { getStudentByUserId } = await import("../repositories/student-academic-repo");
  return { db: s30Db, loadExceptions, getStudentByUserId, release, appUrl: process.env.APP_URL ?? null };
}
