/**
 * S30 Phase A — Academic Calendar routes.
 *
 * Staff (mounted under /api/admin; per-route role checks, so mounting never intercepts other admin paths):
 *   GET    /calendar                         admin, staff          ?from&to[&studentId][&includeDemo=1]  (≤ 120 days)
 *   POST   /calendar/events                  admin, staff (CSRF)   schedule
 *   PATCH  /calendar/events/:id              admin, staff (CSRF)   reschedule / update / cancel
 *   GET    /calendar/export.ics              admin, staff          download (same query as /calendar)
 *   GET    /calendar/subscriptions           admin, staff          own feed links
 *   POST   /calendar/subscriptions           admin, staff (CSRF)   create (token shown once)
 *   DELETE /calendar/subscriptions/:id       admin, staff (CSRF)   revoke own link
 * Student (mounted under /api/student; the student is resolved from the session, a studentId anywhere is refused):
 *   GET /calendar, GET /calendar/export.ics, GET|POST /calendar/subscriptions, DELETE /calendar/subscriptions/:id
 * Public (mounted at /calendar/feed): GET /:token.ics — revocable token, the owner's role re-checked on every fetch.
 *
 * Coaches have no access. Writes are audited (ids, kinds, counts only). Timeline events and the student's change
 * notification go to the S29 operational layer through calendar-port.ts. Errors never log query text or record text.
 */
import { Router, type Request, type RequestHandler, type Response } from "express";
import rateLimit from "express-rate-limit";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  S30_AUDIT_EVENTS,
  S30_ERROR_CODES as E,
  calendarRangeSchema,
  createCalendarEventSchema,
  createSubscriptionSchema,
  updateCalendarEventSchema,
  type CalendarView,
} from "@shared/s30-contract";
import { requireAuth } from "../middleware/auth";
import { requireCsrf } from "../middleware/csrf";
import { createRateLimitStore } from "../lib/rate-limit-store";
import { createAuditLog, type AuditEventType } from "../lib/audit";
import { logger } from "../lib/logger";
import { guardRoles, mentionsStudentId } from "./high-school-http";
import { CalendarError, isMissingTable, type TxDb } from "../services/s30/db-util";
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
import { calendarOperationsPort, type CalendarOperationsPort } from "../services/s30/calendar-port";

export interface CalendarRouteDeps {
  readonly db: TxDb;
  readonly now?: () => Date;
  readonly getStudentByUserId: (userId: string) => Promise<{ readonly id: string } | null>;
  /** Defaults to the process-wide port (wired to S29 at integration). */
  readonly port?: () => CalendarOperationsPort;
  readonly auth?: RequestHandler;
  readonly csrf?: RequestHandler;
  readonly audit?: (entry: Parameters<typeof createAuditLog>[0]) => Promise<void>;
  readonly appUrl?: string | null;
  readonly noRateLimit?: boolean;
}

const uuidSchema = z.string().uuid();

function sendError(res: Response, error: unknown, context: string) {
  if (error instanceof CalendarError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  if (isMissingTable(error)) {
    logger.warn(`Calendar ${context} unavailable (schema not applied)`);
    return res.status(503).json({ error: { code: E.UNAVAILABLE, message: "The calendar is not switched on for this deployment yet" } });
  }
  for (let e: any = error, i = 0; e && i < 4; e = e.cause, i++) {
    const code = typeof e.code === "string" ? e.code : "";
    if (code.startsWith("08") || ["57P01", "57P03", "53300", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "CONNECT_TIMEOUT"].includes(code)) {
      return res.status(503).json({ error: { code: E.UNAVAILABLE, message: "Temporarily unavailable" } });
    }
  }
  const e = error as { name?: unknown; code?: unknown } | null;
  logger.error(`Calendar ${context} failed`, { name: typeof e?.name === "string" ? e.name : typeof error, code: typeof e?.code === "string" ? e.code : undefined });
  return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
}
const validation = (res: Response, error: z.ZodError) =>
  res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid request", details: { issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } } });

function auditFn(deps: CalendarRouteDeps) {
  const write = deps.audit ?? createAuditLog;
  return (req: Request, eventType: AuditEventType, description: string, metadata: Record<string, string | number | boolean | null>, studentId?: string | null, severity: "info" | "warning" = "info") => {
    void Promise.resolve(write({
      eventType, severity, actorUserId: req.user?.id, actorRole: req.user?.role, actorIp: req.ip, actorUserAgent: req.get?.("user-agent") ?? undefined,
      targetResourceType: studentId ? "student" : "calendar", targetResourceId: studentId ?? undefined, actionDescription: description, metadata, isEducationalRecord: !!studentId,
    })).catch((error: unknown) => logger.warn("Calendar audit failed", { eventType, error: error instanceof Error ? error.message : String(error) }));
  };
}
const deniedFn = (deps: CalendarRouteDeps) => (req: Request) => auditFn(deps)(req, S30_AUDIT_EVENTS.calendarAccessDenied, "Refused access to a calendar endpoint",
  { method: req.method, path: (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "", role: req.user?.role ?? null }, null, "warning");

const wrap = (context: string, fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  try { await fn(req, res); } catch (error) { sendError(res, error, context); }
}) as RequestHandler;

const icsHeaders = (res: Response, filename: string) => {
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

/** Hands the change to the operational layer: a timeline event, and (when visible) a notification for the student. */
async function publishChange(deps: CalendarRouteDeps, m: CalendarMutationResult, actorId: string, notifyStudent: boolean): Promise<void> {
  if (m.change === "updated") return;
  const port = (deps.port ?? calendarOperationsPort)();
  const key = `calendar:${m.id}:${m.sequence}:${m.change}`;
  await port.recordEvent({
    kind: m.change === "cancelled" ? "calendar.event_cancelled" : m.change === "rescheduled" ? "calendar.event_rescheduled" : "calendar.event_scheduled",
    studentId: m.studentId, calendarEventId: m.id, eventKind: m.kind, startsAt: m.startsAt, actorId, dedupeKey: key,
  }).catch(() => "failed");
  if (notifyStudent && m.visibleToStudent && m.studentUserId) {
    await port.enqueueNotification({
      recipientUserId: m.studentUserId, audience: "student", kind: "calendar.event_changed",
      params: { date: m.startsAt, itemKind: m.kind, change: m.change }, href: "/calendar", allowEmail: true, dedupeKey: key,
    }).catch(() => "failed");
  }
}

// ── staff ────────────────────────────────────────────────────────────────────

export function createStaffCalendarRouter(deps: CalendarRouteDeps): Router {
  const router = Router();
  const now = () => deps.now?.() ?? new Date();
  const auth = deps.auth ?? requireAuth;
  const csrf = deps.csrf ?? requireCsrf;
  const audit = auditFn(deps);
  const readers = [auth, guardRoles(["admin", "staff"], deniedFn(deps))];
  const writers = [...readers, csrf];

  const rangeOf = (req: Request, res: Response) => {
    const q = calendarRangeSchema.safeParse({ from: req.query.from, to: req.query.to, ...(req.query.studentId ? { studentId: req.query.studentId } : {}), ...(req.query.includeDemo ? { includeDemo: req.query.includeDemo } : {}) });
    if (!q.success) { validation(res, q.error); return null; }
    return q.data;
  };
  const viewFor = (req: Request, r: NonNullable<ReturnType<typeof rangeOf>>) =>
    getCalendarView(deps.db, { role: req.user!.role as "admin" | "staff" }, { from: r.from, to: r.to, studentId: r.studentId, includeDemo: r.includeDemo === "1" }, now());

  router.get("/calendar", ...readers, wrap("staff calendar", async (req, res) => {
    const r = rangeOf(req, res); if (!r) return;
    const view: CalendarView = await viewFor(req, r);
    return res.json(view);
  }));
  router.get("/calendar/export.ics", ...readers, wrap("staff calendar export", async (req, res) => {
    const r = rangeOf(req, res); if (!r) return;
    const view = await viewFor(req, r);
    const lang = await userLanguage(deps.db, req.user!.id);
    icsHeaders(res, "lumiere-calendar.ics");
    return res.send(buildIcs(view.items, { calendarName: lang === "fr" ? "Lumière — calendrier du personnel" : "Lumière — staff calendar", lang, privacy: "detailed", baseUrl: deps.appUrl ?? null, audience: "staff", now: now() }));
  }));
  router.post("/calendar/events", ...writers, wrap("calendar create", async (req, res) => {
    const body = createCalendarEventSchema.safeParse(req.body ?? {});
    if (!body.success) return validation(res, body.error);
    const out = await createCalendarEvent(deps.db, body.data, req.user!.id);
    audit(req, S30_AUDIT_EVENTS.calendarEventChanged, "Calendar event scheduled", { eventId: out.id, kind: out.kind, change: out.change }, out.studentId);
    await publishChange(deps, out, req.user!.id, body.data.notify);
    return res.status(201).json(out);
  }));
  router.patch("/calendar/events/:id", ...writers, wrap("calendar update", async (req, res) => {
    const id = uuidSchema.safeParse(req.params.id);
    const body = updateCalendarEventSchema.safeParse(req.body ?? {});
    if (!id.success) return res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid event id" } });
    if (!body.success) return validation(res, body.error);
    const out = await updateCalendarEvent(deps.db, id.data, body.data, req.user!.id);
    audit(req, S30_AUDIT_EVENTS.calendarEventChanged, `Calendar event ${out.change}`, { eventId: out.id, kind: out.kind, change: out.change }, out.studentId);
    await publishChange(deps, out, req.user!.id, body.data.notify);
    return res.json(out);
  }));
  subscriptionRoutes(router, deps, readers, writers, "staff");
  return router;
}

function subscriptionRoutes(router: Router, deps: CalendarRouteDeps, readers: RequestHandler[], writers: RequestHandler[], scope: "staff" | "student", guard?: (req: Request, res: Response) => Promise<boolean>) {
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
    audit(req, S30_AUDIT_EVENTS.calendarSubscriptionChanged, "Calendar subscription link created", { subscriptionId: sub.id, scope, privacy: sub.privacy });
    return res.status(201).json(sub);
  }));
  router.delete("/calendar/subscriptions/:id", ...writers, wrap("subscription revoke", async (req, res) => {
    if (!(await ok(req, res))) return;
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid subscription id" } });
    if (!(await revokeSubscription(deps.db, req.user!.id, id.data))) return res.status(404).json({ error: { code: E.NOT_FOUND, message: "Subscription not found" } });
    audit(req, S30_AUDIT_EVENTS.calendarSubscriptionChanged, "Calendar subscription link revoked", { subscriptionId: id.data, scope });
    return res.status(204).end();
  }));
}

// ── student ──────────────────────────────────────────────────────────────────

export function createStudentCalendarRouter(deps: CalendarRouteDeps): Router {
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
    return { from: q.data.from, to: q.data.to };
  };
  router.get("/calendar", ...studentOnly, wrap("student calendar", async (req, res) => {
    const id = await resolve(req, res); if (!id) return;
    const r = range(req, res); if (!r) return;
    return res.json(await getCalendarView(deps.db, { role: "student", studentId: id }, r, now()));
  }));
  router.get("/calendar/export.ics", ...studentOnly, wrap("student calendar export", async (req, res) => {
    const id = await resolve(req, res); if (!id) return;
    const r = range(req, res); if (!r) return;
    const view = await getCalendarView(deps.db, { role: "student", studentId: id }, r, now());
    const lang = await userLanguage(deps.db, req.user!.id);
    icsHeaders(res, "lumiere-calendar.ics");
    return res.send(buildIcs(view.items, { calendarName: lang === "fr" ? "Lumière — mon calendrier" : "Lumière — my calendar", lang, privacy: "detailed", baseUrl: deps.appUrl ?? null, audience: "student", now: now() }));
  }));
  subscriptionRoutes(router, deps, studentOnly, [...studentOnly, csrf], "student", async (req, res) => (await resolve(req, res)) !== null);
  return router;
}

// ── public feed ──────────────────────────────────────────────────────────────

export function createCalendarFeedRouter(deps: CalendarRouteDeps): Router {
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
    res.setHeader("Referrer-Policy", "no-referrer");
    const m = /^([A-Za-z0-9_-]{43})\.ics$/.exec(String(req.params.file ?? ""));
    if (!m) return res.status(404).type("text/plain").send("Not found");
    try {
      const sub = await resolveFeedToken(deps.db, m[1]!);
      if (!sub) return res.status(404).type("text/plain").send("Not found");
      const viewer = sub.scope === "student" ? { role: "student" as const, studentId: sub.studentId! } : { role: sub.role as "admin" | "staff" };
      const view = await getCalendarView(deps.db, viewer, { from: todayPlus(now(), -30), to: todayPlus(now(), 89) }, now());
      const lang = await userLanguage(deps.db, sub.userId);
      icsHeaders(res, "lumiere.ics");
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

export async function createDefaultCalendarDeps(): Promise<CalendarRouteDeps> {
  const { db } = await import("../lib/db");
  const { getStudentByUserId } = await import("../repositories/student-academic-repo");
  return { db: db as unknown as TxDb, getStudentByUserId, appUrl: process.env.APP_URL ?? null };
}
