/**
 * Support Center routes (S08).
 *
 * Contract: docs/s08/S08-support-api-spec.md and shared/support-contract.ts.
 * Built as `createTicketsRouter(deps)` so every collaborator is injectable;
 * the default export wires the production dependencies.
 *
 * Access model (enforced here, never by the client):
 *  - student: own tickets only; anything else is a 404 (no existence leak)
 *  - coach:   only tickets assigned to them
 *  - admin/staff: all tickets
 * Support records never touch academic tables; only the four support tables
 * plus read-only people lookups on `users` are used.
 */
import { Router, type RequestHandler } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { supabaseAdmin, isSupabaseConfigured } from "../lib/supabase";
import { logger } from "../lib/logger";
import { createAuditLog, type AuditLogEntry } from "../lib/audit";
import { resolveStudentUserId as defaultResolveStudentUserId } from "../lib/resource-ownership";
import { getAccountStatus as defaultGetAccountStatus, type AccountStatus } from "../lib/account-status";
import { createSupportNotifier, type SupportNotifier } from "../lib/support-notifications";
import { listContextOptions, verifyRoadmapContext } from "../lib/support-context";
import {
  presentAttachment,
  presentComment,
  presentDetail,
  presentSummary,
  viewerCanAccessTicket,
  type SupportViewer,
} from "../lib/support-presenter";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import {
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_TOPIC_INFO,
  STAFF_STATUS_TRANSITIONS,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  attachmentTypeAllowed,
  awaitingFor,
  canStaffTransition,
  createCommentInputSchema,
  createTicketInputSchema,
  isOverdue,
  isSupportManager,
  isSupportStaffRole,
  statusAfterStudentReply,
  topicForTicket,
  updateTicketInputSchema,
  type SupportContext,
  type SupportErrorCode,
  type SupportPerson,
  type SupportStatsResponse,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from "@shared/support-contract";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/** Minimal supabase surface (see the spec's builder subset). */
export interface SupportSupabase {
  from(table: string): any;
  storage: { from(bucket: string): any };
}

export interface TicketsRouterDeps {
  supabase: SupportSupabase;
  isConfigured: () => boolean;
  authenticate: RequestHandler;
  getAccountStatus: (userId: string) => Promise<AccountStatus>;
  resolveStudentUserId: (studentId: string) => Promise<string | null>;
  getStudentByUserId: (userId: string) => Promise<{ id: string } | null>;
  loadPublishedRoadmap: (studentId: string) => Promise<StudentRoadmapView>;
  audit: (entry: AuditLogEntry) => Promise<void>;
  notify: SupportNotifier;
  now: () => Date;
}

export function defaultTicketsRouterDeps(): TicketsRouterDeps {
  return {
    supabase: supabaseAdmin as unknown as SupportSupabase,
    isConfigured: () => isSupabaseConfigured,
    authenticate: requireAuth,
    getAccountStatus: defaultGetAccountStatus,
    resolveStudentUserId: (id) => defaultResolveStudentUserId(id),
    getStudentByUserId: async (userId) => {
      const repo = await import("../repositories/student-academic-repo");
      const row = await repo.getStudentByUserId(userId);
      return row ? { id: row.id } : null;
    },
    loadPublishedRoadmap: async (studentId) => {
      const mod = await import("../services/student-roadmap-service.default");
      return mod.defaultStudentRoadmapService.getStudentView(studentId);
    },
    audit: (entry) => createAuditLog(entry),
    notify: createSupportNotifier(),
    now: () => new Date(),
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const BUCKET = "documents";
const SIGNED_URL_SECONDS = 300;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
const STAFF_ROLES = ["admin", "staff", "coach"];
const ACTIVE_STATUSES: TicketStatus[] = ["open", "in_progress", "waiting_on_student"];
const MAX_OVERDUE_SCAN = 1000;

type Row = Record<string, any>;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function sanitizeSearch(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[%_,()\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

function isMissingTable(err: any): boolean {
  if (!err) return false;
  if (["42P01", "PGRST205", "PGRST200"].includes(String(err.code))) return true;
  return /does not exist|schema cache|could not find the table/i.test(String(err.message ?? ""));
}

const firstRow = (data: unknown): Row | null => (Array.isArray(data) ? ((data[0] as Row) ?? null) : ((data as Row) ?? null));

function metaOf(ticket: Row): Record<string, unknown> {
  return ticket.metadata && typeof ticket.metadata === "object" && !Array.isArray(ticket.metadata)
    ? { ...(ticket.metadata as Record<string, unknown>) }
    : {};
}

export function createTicketsRouter(deps: TicketsRouterDeps): Router {
  const router = Router();
  const db = () => deps.supabase;

  const fail = (res: any, status: number, code: SupportErrorCode, error: string, details?: unknown) =>
    res.status(status).json(details === undefined ? { error, code } : { error, code, details });

  const dbFail = (res: any, what: string, err: any) => {
    logger.error(`Support: ${what}`, { error: err?.message ?? String(err) });
    return fail(res, 500, "SUPPORT_UNAVAILABLE", "Support is temporarily unavailable");
  };

  const parse = <T extends z.ZodTypeAny>(schema: T, body: unknown, res: any): z.infer<T> | null => {
    const r = schema.safeParse(body ?? {});
    if (!r.success) {
      fail(res, 400, "VALIDATION_FAILED", "Validation failed", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
      return null;
    }
    return r.data;
  };

  const viewerOf = (req: any): SupportViewer => ({ id: String(req.user.id), role: String(req.user.role) });

  const safeAudit = async (entry: AuditLogEntry) => {
    try {
      await deps.audit(entry);
    } catch (e: any) {
      logger.warn("Support audit failed", { error: e?.message });
    }
  };

  const auditTicket = (
    req: any,
    eventType: AuditLogEntry["eventType"],
    ticket: Row,
    description: string,
    metadata: Record<string, unknown> = {},
    severity: AuditLogEntry["severity"] = "info",
  ) =>
    safeAudit({
      eventType,
      severity,
      actorUserId: req.user.id,
      actorRole: req.user.role,
      targetUserId: ticket.reporter_id,
      targetResourceType: "support_ticket",
      targetResourceId: ticket.id,
      actionDescription: description,
      metadata: { ticketNumber: ticket.ticket_number, ...metadata },
    });

  /** Fire-and-forget: never awaited by the request, failures are only logged. */
  const fire = (label: string, fn: () => Promise<boolean>) => {
    try {
      Promise.resolve(fn()).catch((e: any) => logger.warn(`Support notification failed: ${label}`, { error: e?.message }));
    } catch (e: any) {
      logger.warn(`Support notification failed: ${label}`, { error: e?.message });
    }
  };

  // ---- data access ---------------------------------------------------------

  async function loadTicket(id: string): Promise<{ ticket: Row | null; error?: any }> {
    if (!ID_PATTERN.test(id)) return { ticket: null };
    const { data, error } = await db().from("support_tickets").select("*").eq("id", id).maybeSingle();
    if (error) {
      if (error.code === "22P02") return { ticket: null }; // malformed uuid
      return { ticket: null, error };
    }
    return { ticket: (data as Row) ?? null };
  }

  async function loadComments(ticketIds: string[]): Promise<{ rows: Row[]; error?: any }> {
    if (!ticketIds.length) return { rows: [] };
    const { data, error } = await db()
      .from("ticket_comments")
      .select("*")
      .in("ticket_id", ticketIds)
      .order("created_at", { ascending: true });
    return error ? { rows: [], error } : { rows: (data as Row[]) ?? [] };
  }

  /** Tolerant: a missing optional table (production lineage) yields an empty list. */
  async function loadOptional(table: "ticket_attachments" | "ticket_status_history", ticketIds: string[]): Promise<Row[]> {
    if (!ticketIds.length) return [];
    try {
      const { data, error } = await db()
        .from(table)
        .select("*")
        .in("ticket_id", ticketIds)
        .order("created_at", { ascending: true });
      if (error) {
        logger.warn(`Support: ${table} unavailable, returning empty`, { error: error.message, missing: isMissingTable(error) });
        return [];
      }
      return (data as Row[]) ?? [];
    } catch (e: any) {
      logger.warn(`Support: ${table} read failed, returning empty`, { error: e?.message });
      return [];
    }
  }

  async function loadPeople(ids: string[]): Promise<Map<string, { name: string; role: string }>> {
    const out = new Map<string, { name: string; role: string }>();
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (!unique.length) return out;
    try {
      const { data, error } = await db().from("users").select("id, name, role").in("id", unique);
      if (error) {
        logger.warn("Support: people lookup failed", { error: error.message });
        return out;
      }
      for (const u of (data as Row[]) ?? []) out.set(String(u.id), { name: u.name, role: u.role });
    } catch (e: any) {
      logger.warn("Support: people lookup failed", { error: e?.message });
    }
    return out;
  }

  async function updateTicketRow(id: string, patch: Row, guardStatus?: TicketStatus): Promise<{ row: Row | null; error?: any }> {
    let q = db().from("support_tickets").update(patch).eq("id", id);
    if (guardStatus) q = q.eq("status", guardStatus);
    const { data, error } = await q.select("*");
    if (error) return { row: null, error };
    return { row: firstRow(data) };
  }

  async function recordHistory(ticket: Row, to: TicketStatus, userId: string, reason: string) {
    try {
      const { error } = await db().from("ticket_status_history").insert({
        ticket_id: ticket.id,
        old_status: ticket.status,
        new_status: to,
        changed_by: userId,
        change_reason: reason,
      });
      if (error) logger.warn("Support: status history not recorded", { error: error.message });
    } catch (e: any) {
      logger.warn("Support: status history not recorded", { error: e?.message });
    }
  }

  async function detailFor(ticket: Row, viewer: SupportViewer) {
    const comments = await loadComments([ticket.id]);
    if (comments.error) throw comments.error;
    const [attachments, history, people] = await Promise.all([
      loadOptional("ticket_attachments", [ticket.id]),
      loadOptional("ticket_status_history", [ticket.id]),
      loadPeople(ticket.assigned_to ? [String(ticket.assigned_to)] : []),
    ]);
    return presentDetail({ ticket, comments: comments.rows, attachments, history, people, viewer, now: deps.now() });
  }

  async function summaryFor(ticket: Row, viewer: SupportViewer) {
    const comments = await loadComments([ticket.id]);
    if (comments.error) throw comments.error;
    const [attachments, people] = await Promise.all([
      loadOptional("ticket_attachments", [ticket.id]),
      loadPeople(ticket.assigned_to ? [String(ticket.assigned_to)] : []),
    ]);
    return presentSummary({ ticket, comments: comments.rows, attachments, people, viewer, now: deps.now() });
  }

  /** Load a ticket the caller may access; sends 404 (and audits a denial) otherwise. */
  async function accessibleTicket(req: any, res: any, action: string): Promise<Row | null> {
    const { ticket, error } = await loadTicket(String(req.params.id));
    if (error) {
      dbFail(res, "ticket lookup failed", error);
      return null;
    }
    if (!ticket || !viewerCanAccessTicket(viewerOf(req), ticket)) {
      if (ticket) {
        void auditTicket(req, "support.access_denied", ticket, "Support ticket access denied", { action }, "warning");
      }
      fail(res, 404, "NOT_FOUND", "Ticket not found");
      return null;
    }
    return ticket;
  }

  // ---- shared status transition logic -----------------------------------

  type TransitionCheck =
    | { ok: true; patch: Row }
    | { ok: false; status: number; code: SupportErrorCode; error: string };

  function planStaffTransition(role: string, userId: string, ticket: Row, to: TicketStatus, notes: string | undefined): TransitionCheck {
    const from = ticket.status as TicketStatus;
    if (to === from || !STAFF_STATUS_TRANSITIONS[from].includes(to)) {
      return { ok: false, status: 409, code: "INVALID_TRANSITION", error: `Cannot move a ticket from ${from} to ${to}` };
    }
    if (!canStaffTransition(role, from, to)) {
      return { ok: false, status: 403, code: "FORBIDDEN", error: "Only admin or staff can close or reopen a closed ticket" };
    }
    if (to === "resolved" && !(notes && notes.trim())) {
      return { ok: false, status: 400, code: "RESOLUTION_REQUIRED", error: "Resolution notes are required to resolve a ticket" };
    }
    const now = deps.now().toISOString();
    const patch: Row = { status: to, metadata: { ...metaOf(ticket), awaiting_since: now } };
    if (to === "resolved") {
      patch.resolved_at = now;
      patch.resolved_by = userId;
    } else if (to !== "closed") {
      patch.resolved_at = null;
      patch.resolved_by = null;
    }
    if (notes && notes.trim()) patch.resolution_notes = notes.trim();
    return { ok: true, patch };
  }

  // =========================================================================
  // Middleware: authenticate first, then availability and role sanity
  // =========================================================================

  router.use(deps.authenticate);
  router.use(async (req: any, res, next) => {
    try {
      if (!deps.isConfigured()) return fail(res, 503, "SUPPORT_UNAVAILABLE", "Support is not available right now");
      const role = req.user?.role;
      if (!req.user?.id || !(role === "student" || isSupportStaffRole(role))) {
        return fail(res, 403, "FORBIDDEN", "Access denied");
      }
      next();
    } catch (e) {
      next(e);
    }
  });

  const wrap = (fn: (req: any, res: any) => Promise<any>): RequestHandler => (req, res, next) => {
    Promise.resolve(fn(req, res)).catch((e) => {
      logger.error("Support route error", { path: req.path, error: e?.message ?? String(e) });
      if (!res.headersSent) fail(res, 500, "SUPPORT_UNAVAILABLE", "Support is temporarily unavailable");
      else next(e);
    });
  };

  // =========================================================================
  // GET /  — list
  // =========================================================================

  router.get("/", wrap(async (req, res) => {
    const viewer = viewerOf(req);
    const q = req.query as Record<string, unknown>;
    const manager = isSupportManager(viewer.role);

    const enumOf = <T extends readonly string[]>(value: unknown, list: T): T[number] | undefined | "invalid" =>
      value === undefined || value === "" ? undefined : (list as readonly string[]).includes(String(value)) ? String(value) : "invalid";
    const status = enumOf(q.status, TICKET_STATUSES);
    const category = enumOf(q.category, TICKET_CATEGORIES);
    const priority = enumOf(q.priority, TICKET_PRIORITIES);
    const view = enumOf(q.view, ["active", "resolved"] as const);
    const awaiting = enumOf(q.awaiting, ["staff", "student"] as const);
    if ([status, category, priority, view, awaiting].includes("invalid")) {
      return fail(res, 400, "VALIDATION_FAILED", "Invalid filter value");
    }

    const limit = Math.min(100, Math.max(1, Number.parseInt(String(q.limit ?? "50"), 10) || 50));
    const offset = Math.max(0, Number.parseInt(String(q.offset ?? "0"), 10) || 0);

    let reporterFilter: string | null = null;
    if (q.studentId) {
      // Phase 5D rule kept: only the admin student workspace filters by student.
      if (viewer.role !== "admin") return fail(res, 403, "FORBIDDEN", "Student ticket filtering is admin-only");
      reporterFilter = await deps.resolveStudentUserId(String(q.studentId));
      if (!reporterFilter) return res.json({ tickets: [], pagination: { total: 0, limit, offset } });
    }

    // Allowed status set from status / view / awaiting
    let allowed: TicketStatus[] = [...TICKET_STATUSES];
    if (view === "active") allowed = allowed.filter((s) => ACTIVE_STATUSES.includes(s));
    if (view === "resolved") allowed = allowed.filter((s) => !ACTIVE_STATUSES.includes(s));
    if (awaiting === "staff") allowed = allowed.filter((s) => awaitingFor(s) === "staff");
    if (awaiting === "student") allowed = allowed.filter((s) => awaitingFor(s) === "student");
    if (status) allowed = allowed.filter((s) => s === status);
    const wantsOverdue = manager || viewer.role === "coach" ? String(q.overdue) === "true" : false;
    if (wantsOverdue) allowed = allowed.filter((s) => awaitingFor(s) === "staff");
    if (!allowed.length) return res.json({ tickets: [], pagination: { total: 0, limit, offset } });

    let query = db().from("support_tickets").select("*", { count: "exact" });
    if (allowed.length < TICKET_STATUSES.length) query = query.in("status", allowed);
    if (category) query = query.eq("category", category);
    if (priority) query = query.eq("priority", priority);

    if (viewer.role === "student") query = query.eq("reporter_id", viewer.id);
    else if (viewer.role === "coach") query = query.eq("assigned_to", viewer.id);
    else {
      if (reporterFilter) query = query.eq("reporter_id", reporterFilter);
      const assignedTo = typeof q.assignedTo === "string" ? q.assignedTo : "";
      if (assignedTo === "unassigned") query = query.is("assigned_to", null);
      else if (assignedTo === "me") query = query.eq("assigned_to", viewer.id);
      else if (assignedTo && ID_PATTERN.test(assignedTo)) query = query.eq("assigned_to", assignedTo);
    }

    const search = sanitizeSearch(q.search);
    if (search) query = query.ilike("subject", `%${search}%`);

    query = query.order("created_at", { ascending: false });
    query = wantsOverdue ? query.limit(MAX_OVERDUE_SCAN) : query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) return dbFail(res, "ticket list failed", error);
    let rows = (data as Row[]) ?? [];
    let total = count ?? rows.length;

    const now = deps.now();
    if (wantsOverdue) {
      rows = rows.filter((t) =>
        isOverdue({ status: t.status, priority: t.priority, awaitingSince: String(metaOf(t).awaiting_since ?? t.updated_at ?? t.created_at) }, now),
      );
      total = rows.length;
      rows = rows.slice(offset, offset + limit);
    }

    const ids = rows.map((r) => String(r.id));
    const comments = await loadComments(ids);
    if (comments.error) return dbFail(res, "comment counts failed", comments.error);
    const [attachments, people] = await Promise.all([
      loadOptional("ticket_attachments", ids),
      loadPeople(rows.map((r) => String(r.assigned_to ?? "")).filter(Boolean)),
    ]);
    const byTicket = <T extends Row>(list: T[], id: string) => list.filter((x) => x.ticket_id === id);
    const tickets = rows.map((ticket) =>
      presentSummary({
        ticket,
        comments: byTicket(comments.rows, ticket.id),
        attachments: byTicket(attachments, ticket.id),
        people,
        viewer,
        now,
      }),
    );
    res.json({ tickets, pagination: { total, limit, offset } });
  }));

  // =========================================================================
  // GET /stats/summary  (registered before /:id)
  // =========================================================================

  router.get("/stats/summary", wrap(async (req, res) => {
    const viewer = viewerOf(req);
    if (!isSupportStaffRole(viewer.role)) return fail(res, 403, "FORBIDDEN", "Access denied");
    let query = db()
      .from("support_tickets")
      .select("id, status, category, priority, assigned_to, created_at, updated_at, resolved_at, metadata");
    if (viewer.role === "coach") query = query.eq("assigned_to", viewer.id);
    const { data, error } = await query.limit(5000);
    if (error) return dbFail(res, "stats failed", error);
    const rows = (data as Row[]) ?? [];
    const now = deps.now();

    const byStatus = Object.fromEntries(TICKET_STATUSES.map((s) => [s, 0])) as Record<TicketStatus, number>;
    const byCategory: Record<string, number> = {};
    let awaitingStaff = 0, awaitingStudent = 0, overdue = 0, unassigned = 0, resolvedLast30 = 0;
    let resolutionHoursTotal = 0, resolutionCount = 0;
    for (const t of rows) {
      const st = t.status as TicketStatus;
      if (st in byStatus) byStatus[st] += 1;
      byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
      const aw = awaitingFor(st);
      if (aw === "staff") {
        awaitingStaff += 1;
        if (!t.assigned_to) unassigned += 1;
        if (isOverdue({ status: st, priority: t.priority as TicketPriority, awaitingSince: String(metaOf(t).awaiting_since ?? t.updated_at ?? t.created_at) }, now)) overdue += 1;
      } else if (aw === "student") awaitingStudent += 1;
      if (t.resolved_at) {
        const ms = new Date(t.resolved_at).getTime() - new Date(t.created_at).getTime();
        if (Number.isFinite(ms) && ms >= 0) {
          resolutionHoursTotal += ms / 3_600_000;
          resolutionCount += 1;
        }
        if (now.getTime() - new Date(t.resolved_at).getTime() <= 30 * 86_400_000) resolvedLast30 += 1;
      }
    }
    const body: SupportStatsResponse = {
      stats: {
        byStatus,
        byCategory,
        awaitingStaff,
        awaitingStudent,
        overdue,
        unassigned,
        avgResolutionHours: resolutionCount ? Math.round((resolutionHoursTotal / resolutionCount) * 10) / 10 : 0,
        resolvedLast30Days: resolvedLast30,
      },
    };
    res.json(body);
  }));

  // =========================================================================
  // GET /staff-directory
  // =========================================================================

  router.get("/staff-directory", wrap(async (req, res) => {
    if (!isSupportManager(req.user.role)) return fail(res, 403, "FORBIDDEN", "Access denied");
    const { data, error } = await db().from("users").select("id, name, role").in("role", STAFF_ROLES);
    if (error) return dbFail(res, "staff directory failed", error);
    const rows = (data as Row[]) ?? [];
    const statuses = await Promise.all(rows.map((u) => deps.getAccountStatus(String(u.id)).catch(() => "unknown" as AccountStatus)));
    const staff: SupportPerson[] = rows
      .filter((_, i) => statuses[i] === "active")
      .map((u) => ({ id: String(u.id), name: u.name, role: u.role }));
    res.json({ staff });
  }));

  // =========================================================================
  // GET /context-options (student)
  // =========================================================================

  router.get("/context-options", wrap(async (req, res) => {
    if (req.user.role !== "student") return fail(res, 403, "FORBIDDEN", "Only students have academic context");
    try {
      const student = await deps.getStudentByUserId(req.user.id);
      if (!student) return res.json({ available: false, planVersion: null, items: [] });
      const view = await deps.loadPublishedRoadmap(student.id);
      return res.json(listContextOptions(view));
    } catch (e: any) {
      logger.warn("Support: context options unavailable", { error: e?.message });
      return fail(res, 503, "CONTEXT_UNAVAILABLE", "Your roadmap is temporarily unavailable");
    }
  }));

  // =========================================================================
  // POST /  — create (students only)
  // =========================================================================

  router.post("/", wrap(async (req, res) => {
    const viewer = viewerOf(req);
    if (viewer.role !== "student") {
      return fail(res, 403, "FORBIDDEN", "Support tickets are opened by students");
    }
    const input = parse(createTicketInputSchema, req.body, res);
    if (!input) return;

    // Optional verified academic context. Never silently dropped.
    let context: SupportContext | null = null;
    if (input.context) {
      let view: StudentRoadmapView;
      try {
        const student = await deps.getStudentByUserId(viewer.id);
        if (!student) return fail(res, 400, "CONTEXT_NOT_IN_PLAN", "That item is not in your current plan");
        view = await deps.loadPublishedRoadmap(student.id);
      } catch (e: any) {
        logger.warn("Support: context verification unavailable", { error: e?.message });
        return fail(res, 503, "CONTEXT_UNAVAILABLE", "Your roadmap is temporarily unavailable; try again without context or later");
      }
      context = verifyRoadmapContext(view, input.context.roadmapItemKey, deps.now());
      if (!context) return fail(res, 400, "CONTEXT_NOT_IN_PLAN", "That item is not in your current plan");
    }

    const topic = input.topic ?? topicForTicket(undefined, input.category as TicketCategory);
    const category = input.topic ? SUPPORT_TOPIC_INFO[input.topic].category : (input.category as TicketCategory);

    // Reporter identity comes from the session, never the body.
    let reporterName = String(req.user.name ?? "");
    let reporterEmail = String(req.user.email ?? "");
    try {
      const { data } = await db().from("users").select("name, email").eq("id", viewer.id).maybeSingle();
      if (data) {
        reporterName = (data as Row).name || reporterName;
        reporterEmail = (data as Row).email || reporterEmail;
      }
    } catch { /* fall back to session values */ }

    const nowIso = deps.now().toISOString();
    const metadata: Record<string, unknown> = { topic, awaiting_since: nowIso };
    if (context) metadata.context = context;

    const { data: created, error } = await db()
      .from("support_tickets")
      .insert({
        reporter_id: viewer.id,
        reporter_name: reporterName || "Student",
        reporter_email: reporterEmail,
        subject: input.subject,
        description: input.description,
        category,
        priority: "medium",
        status: "open",
        metadata,
      })
      .select("*")
      .single();
    if (error || !created) return dbFail(res, "ticket create failed", error);
    const ticket = created as Row;

    const { error: commentError } = await db().from("ticket_comments").insert({
      ticket_id: ticket.id,
      author_id: viewer.id,
      author_name: reporterName || "Student",
      author_role: "student",
      content: input.description,
      is_internal: false,
    });
    if (commentError) logger.warn("Support: opening message not recorded", { error: commentError.message });

    await auditTicket(req, "support.ticket_created", ticket, "Support ticket created", {
      category,
      topic,
      hasContext: !!context,
    });
    fire("ticketCreated", () =>
      deps.notify.ticketCreated({
        ticketNumber: ticket.ticket_number,
        subject: ticket.subject,
        studentName: reporterName,
        studentEmail: reporterEmail,
        topicLabel: SUPPORT_TOPIC_INFO[topic].label,
      }),
    );

    res.status(201).json({ ticket: await detailFor(ticket, viewer) });
  }));

  // =========================================================================
  // GET /:id
  // =========================================================================

  router.get("/:id", wrap(async (req, res) => {
    const ticket = await accessibleTicket(req, res, "read");
    if (!ticket) return;
    res.json({ ticket: await detailFor(ticket, viewerOf(req)) });
  }));

  // =========================================================================
  // PATCH /:id
  // =========================================================================

  router.patch("/:id", wrap(async (req, res) => {
    const viewer = viewerOf(req);
    const input = parse(updateTicketInputSchema, req.body, res);
    if (!input) return;
    if (Object.keys(input).length === 0) return fail(res, 400, "VALIDATION_FAILED", "No changes supplied");
    const ticket = await accessibleTicket(req, res, "update");
    if (!ticket) return;

    const manager = isSupportManager(viewer.role);
    const patch: Row = {};
    const changed: string[] = [];
    let statusChange: { from: TicketStatus; to: TicketStatus } | null = null;
    let assignmentChange: { from: string | null; to: string | null } | null = null;
    let priorityChange: { from: string; to: string } | null = null;

    if (viewer.role === "student") {
      if (input.status !== undefined || input.priority !== undefined || input.assignedTo !== undefined || input.resolutionNotes !== undefined) {
        return fail(res, 403, "FORBIDDEN", "Students cannot change status, priority, assignment or resolution");
      }
      if (ticket.status !== "open" || ticket.assigned_to) {
        return fail(res, 403, "FORBIDDEN", "This ticket can no longer be edited");
      }
      const comments = await loadComments([ticket.id]);
      if (comments.error) return dbFail(res, "comment lookup failed", comments.error);
      if (comments.rows.some((c) => c.author_role !== "student")) {
        return fail(res, 403, "FORBIDDEN", "This ticket can no longer be edited after a staff reply");
      }
      if (input.subject !== undefined) { patch.subject = input.subject; changed.push("subject"); }
      if (input.description !== undefined) { patch.description = input.description; changed.push("description"); }
    } else {
      if (input.subject !== undefined || input.description !== undefined) {
        return fail(res, 403, "FORBIDDEN", "Staff do not edit the student's subject or description");
      }
      if (input.assignedTo !== undefined) {
        if (!manager) return fail(res, 403, "FORBIDDEN", "Only admin or staff can assign tickets");
        const target = input.assignedTo;
        if (target !== (ticket.assigned_to ?? null)) {
          if (target !== null) {
            const { data: assignee, error } = await db().from("users").select("id, role").eq("id", target).maybeSingle();
            if (error) return dbFail(res, "assignee lookup failed", error);
            const ok =
              !!assignee && STAFF_ROLES.includes(String((assignee as Row).role)) && (await deps.getAccountStatus(target)) === "active";
            if (!ok) return fail(res, 400, "INVALID_ASSIGNEE", "Assignee must be an active admin, staff or coach account");
          }
          patch.assigned_to = target;
          patch.assigned_at = target ? deps.now().toISOString() : null;
          assignmentChange = { from: ticket.assigned_to ?? null, to: target };
          changed.push("assignedTo");
        }
      }
      if (input.priority !== undefined && input.priority !== ticket.priority) {
        // admin/staff, or the assigned coach (access already guarantees assignment)
        patch.priority = input.priority;
        priorityChange = { from: ticket.priority, to: input.priority };
        changed.push("priority");
      }
      if (input.status !== undefined) {
        const plan = planStaffTransition(viewer.role, viewer.id, ticket, input.status, input.resolutionNotes);
        if (!plan.ok) return fail(res, plan.status, plan.code, plan.error);
        Object.assign(patch, plan.patch);
        statusChange = { from: ticket.status, to: input.status };
        changed.push("status");
      } else if (input.resolutionNotes !== undefined) {
        patch.resolution_notes = input.resolutionNotes;
        changed.push("resolutionNotes");
      }
    }

    if (Object.keys(patch).length === 0) {
      return res.json({ ticket: await detailFor(ticket, viewer) });
    }

    const { row, error } = await updateTicketRow(ticket.id, patch, statusChange ? statusChange.from : undefined);
    if (error) return dbFail(res, "ticket update failed", error);
    if (!row) return fail(res, 409, "INVALID_TRANSITION", "The ticket changed while you were editing it; reload and retry");

    if (statusChange) {
      await recordHistory(ticket, statusChange.to, viewer.id, "Status changed by staff");
      await auditTicket(req, "support.status_changed", row, "Support ticket status changed", { from: statusChange.from, to: statusChange.to });
      if (ticket.reporter_email) {
        fire("statusChanged", () =>
          deps.notify.statusChanged({
            ticketNumber: row.ticket_number,
            subject: row.subject,
            studentEmail: ticket.reporter_email,
            studentName: ticket.reporter_name,
            status: statusChange!.to,
          }),
        );
      }
    }
    if (assignmentChange) {
      await auditTicket(req, "support.assignment_changed", row, "Support ticket assignment changed", {
        from: assignmentChange.from,
        to: assignmentChange.to,
      });
    }
    if (priorityChange) {
      await auditTicket(req, "support.priority_changed", row, "Support ticket priority changed", priorityChange);
    }
    if (!statusChange && !assignmentChange && !priorityChange) {
      await auditTicket(req, "support.ticket_updated", row, "Support ticket updated", { fields: changed });
    }

    res.json({ ticket: await detailFor(row, viewer) });
  }));

  // =========================================================================
  // POST /:id/comments
  // =========================================================================

  router.post("/:id/comments", wrap(async (req, res) => {
    const viewer = viewerOf(req);
    const input = parse(createCommentInputSchema, req.body, res);
    if (!input) return;
    const ticket = await accessibleTicket(req, res, "comment");
    if (!ticket) return;

    const now = deps.now();
    const student = viewer.role === "student";
    let patch: Row | null = null;
    let nextStatus: TicketStatus | null = null;
    let historyReason = "";

    if (student) {
      if (input.isInternal || input.nextStatus) {
        return fail(res, 403, "FORBIDDEN", "Students cannot post internal notes or change status");
      }
      const r = statusAfterStudentReply(ticket.status, ticket.resolved_at, now);
      if (!r.ok) {
        return fail(
          res,
          409,
          r.code,
          r.code === "TICKET_CLOSED" ? "This ticket is closed" : "This ticket was resolved too long ago to reopen; please open a new ticket",
        );
      }
      patch = { metadata: { ...metaOf(ticket), awaiting_since: now.toISOString() } };
      if (r.next) {
        nextStatus = r.next;
        patch.status = r.next;
        if (ticket.status === "resolved") {
          patch.resolved_at = null;
          patch.resolved_by = null;
        }
        historyReason = "Student replied";
      }
    } else if (input.isInternal) {
      if (input.nextStatus) return fail(res, 400, "VALIDATION_FAILED", "Internal notes cannot change the ticket status");
    } else {
      if (ticket.status === "closed" && !input.nextStatus) {
        return fail(res, 409, "TICKET_CLOSED", "This ticket is closed; reopen it before replying");
      }
      const target: TicketStatus | undefined = input.nextStatus ?? (ticket.status === "open" ? "in_progress" : undefined);
      if (target) {
        const plan = planStaffTransition(viewer.role, viewer.id, ticket, target, input.nextStatus === "resolved" ? input.content.slice(0, 2000) : undefined);
        if (!plan.ok) {
          if (!input.nextStatus) {
            /* implicit open -> in_progress cannot fail; ignore defensively */
          } else return fail(res, plan.status, plan.code, plan.error);
        } else {
          patch = plan.patch;
          nextStatus = target;
          historyReason = "Status changed with a staff reply";
        }
      }
    }

    // requireAuth carries no display name; resolve it from the stored user row.
    const authorName = student
      ? String(ticket.reporter_name || "Student")
      : (await loadPeople([viewer.id])).get(viewer.id)?.name || "Lumière team";

    const { data: created, error } = await db()
      .from("ticket_comments")
      .insert({
        ticket_id: ticket.id,
        author_id: viewer.id,
        author_name: authorName,
        author_role: viewer.role,
        content: input.content,
        is_internal: !!input.isInternal,
      })
      .select("*")
      .single();
    if (error || !created) return dbFail(res, "comment create failed", error);
    const comment = created as Row;

    let current = ticket;
    if (patch) {
      const { row, error: upErr } = await updateTicketRow(ticket.id, patch, nextStatus ? (ticket.status as TicketStatus) : undefined);
      if (upErr) logger.error("Support: ticket not updated after comment", { error: upErr.message });
      else if (row) current = row;
      if (row && nextStatus) {
        await recordHistory(ticket, nextStatus, viewer.id, historyReason);
        await auditTicket(req, "support.status_changed", current, "Support ticket status changed", { from: ticket.status, to: nextStatus, viaReply: true });
      }
    }

    await auditTicket(
      req,
      comment.is_internal ? "support.internal_note_added" : "support.comment_added",
      current,
      comment.is_internal ? "Internal note added to support ticket" : "Comment added to support ticket",
      { commentId: comment.id, authorKind: student ? "student" : "staff" },
    );

    // Notifications: never for internal notes; never back to the author.
    if (!comment.is_internal) {
      const excerpt = input.content;
      if (student) {
        let assigneeEmail: string | null = null;
        if (current.assigned_to) {
          try {
            const { data } = await db().from("users").select("email").eq("id", current.assigned_to).maybeSingle();
            assigneeEmail = (data as Row | null)?.email ?? null;
          } catch { /* falls back to the support inbox */ }
        }
        fire("studentReplied", () =>
          deps.notify.studentReplied({
            ticketNumber: current.ticket_number,
            subject: current.subject,
            studentName: current.reporter_name,
            assigneeEmail,
            excerpt,
          }),
        );
      } else if (ticket.reporter_email) {
        fire("staffReplied", () =>
          deps.notify.staffReplied({
            ticketNumber: current.ticket_number,
            subject: current.subject,
            studentEmail: ticket.reporter_email,
            studentName: ticket.reporter_name,
            staffName: authorName,
            excerpt,
            newStatus: nextStatus && nextStatus !== ticket.status ? nextStatus : undefined,
          }),
        );
      }
    }

    res.status(201).json({
      comment: presentComment(viewer, comment),
      ticket: await summaryFor(current, viewer),
    });
  }));

  // =========================================================================
  // Attachments
  // =========================================================================

  const fileFields = {
    file_name: z.string().trim().min(1).max(255).refine((n) => !/[\\/\u0000-\u001f]/.test(n), "invalid file name"),
    file_size: z.number().int().positive(),
    file_type: z.string().trim().min(1).max(100),
  };
  const uploadUrlSchema = z.object(fileFields);
  const registerSchema = z.object({
    ...fileFields,
    storage_path: z.string().min(1).max(512),
    comment_id: z.string().min(1).max(64).nullable().optional(),
  });

  const extOf = (name: string): string => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

  function checkFile(body: { file_name: string; file_size: number; file_type: string }, res: any): boolean {
    if (body.file_size > SUPPORT_ATTACHMENT_MAX_BYTES) {
      fail(res, 400, "VALIDATION_FAILED", "File is larger than 10 MB");
      return false;
    }
    if (!attachmentTypeAllowed(body.file_name, body.file_type)) {
      fail(res, 400, "ATTACHMENT_TYPE_NOT_ALLOWED", "This file type is not allowed");
      return false;
    }
    return true;
  }

  router.post("/:id/attachments/upload-url", wrap(async (req, res) => {
    const body = parse(uploadUrlSchema, req.body, res);
    if (!body) return;
    const ticket = await accessibleTicket(req, res, "attachment_upload_url");
    if (!ticket) return;
    if (ticket.status === "closed") return fail(res, 409, "TICKET_CLOSED", "This ticket is closed");
    if (!checkFile(body, res)) return;

    const path = `tickets/${ticket.id}/${req.user.id}/${deps.now().getTime()}-${randomBytes(6).toString("hex")}.${extOf(body.file_name)}`;
    const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      logger.error("Support: signed upload url failed", { error: error?.message });
      return fail(res, 503, "STORAGE_UNAVAILABLE", "File storage is temporarily unavailable");
    }
    res.json({ uploadUrl: data.signedUrl, token: data.token, storagePath: path });
  }));

  router.post("/:id/attachments", wrap(async (req, res) => {
    const viewer = viewerOf(req);
    const body = parse(registerSchema, req.body, res);
    if (!body) return;
    const ticket = await accessibleTicket(req, res, "attachment_register");
    if (!ticket) return;
    if (ticket.status === "closed") return fail(res, 409, "TICKET_CLOSED", "This ticket is closed");
    if (!checkFile(body, res)) return;

    // Path pinned to this ticket and this caller; strict shape.
    const ext = escapeRegExp(extOf(body.file_name));
    const pathRe = new RegExp(`^tickets/${escapeRegExp(String(ticket.id))}/${escapeRegExp(viewer.id)}/\\d{10,16}-[a-z0-9]{4,24}\\.${ext}$`);
    if (!pathRe.test(body.storage_path)) {
      return fail(res, 400, "ATTACHMENT_PATH_INVALID", "Invalid storage path");
    }

    // comment_id must belong to this ticket (students: their own public comment).
    let commentId: string | null = null;
    if (body.comment_id) {
      let cq = db().from("ticket_comments").select("*").eq("id", body.comment_id).eq("ticket_id", ticket.id);
      const { data: c, error: cErr } = await cq.maybeSingle();
      if (cErr && cErr.code !== "22P02") return dbFail(res, "comment lookup failed", cErr);
      const comment = (c as Row | null) ?? null;
      const ok = !!comment && (viewer.role !== "student" || (comment.author_id === viewer.id && !comment.is_internal));
      if (!ok) return fail(res, 400, "VALIDATION_FAILED", "comment_id does not refer to a comment you can attach to");
      commentId = String(comment!.id);
    }

    // The object must really exist in storage.
    const folder = `tickets/${ticket.id}/${viewer.id}`;
    const fileName = body.storage_path.slice(folder.length + 1);
    const { data: listed, error: listErr } = await db().storage.from(BUCKET).list(folder, { search: fileName });
    if (listErr) {
      logger.error("Support: storage list failed", { error: listErr.message });
      return fail(res, 503, "STORAGE_UNAVAILABLE", "File storage is temporarily unavailable");
    }
    if (!Array.isArray(listed) || !listed.some((o: Row) => o?.name === fileName)) {
      return fail(res, 400, "ATTACHMENT_PATH_INVALID", "The file has not been uploaded");
    }

    // One registration per object.
    const { data: dup, error: dupErr } = await db().from("ticket_attachments").select("id").eq("storage_path", body.storage_path).limit(1);
    if (dupErr) {
      if (isMissingTable(dupErr)) return fail(res, 503, "SUPPORT_UNAVAILABLE", "Attachments are not available");
      return dbFail(res, "attachment lookup failed", dupErr);
    }
    if (Array.isArray(dup) && dup.length) return fail(res, 400, "ATTACHMENT_PATH_INVALID", "This file is already attached");

    const { data: created, error } = await db()
      .from("ticket_attachments")
      .insert({
        ticket_id: ticket.id,
        comment_id: commentId,
        file_name: body.file_name,
        file_size: body.file_size,
        file_type: body.file_type,
        storage_path: body.storage_path,
        uploaded_by: viewer.id,
      })
      .select("*")
      .single();
    if (error || !created) {
      if (isMissingTable(error)) return fail(res, 503, "SUPPORT_UNAVAILABLE", "Attachments are not available");
      return dbFail(res, "attachment create failed", error);
    }

    await auditTicket(req, "support.attachment_added", ticket, "Attachment added to support ticket", {
      attachmentId: (created as Row).id,
      fileType: body.file_type,
      fileSize: body.file_size,
    });
    res.status(201).json({ attachment: presentAttachment(viewer, ticket, created as Row) });
  }));

  router.get("/:id/attachments/:attachmentId/download-url", wrap(async (req, res) => {
    const viewer = viewerOf(req);
    const ticket = await accessibleTicket(req, res, "attachment_download");
    if (!ticket) return;
    const attachmentId = String(req.params.attachmentId);
    if (!ID_PATTERN.test(attachmentId)) return fail(res, 404, "NOT_FOUND", "Attachment not found");

    const { data, error } = await db()
      .from("ticket_attachments")
      .select("*")
      .eq("id", attachmentId)
      .eq("ticket_id", ticket.id)
      .maybeSingle();
    if (error) {
      if (error.code === "22P02") return fail(res, 404, "NOT_FOUND", "Attachment not found");
      if (isMissingTable(error)) return fail(res, 404, "NOT_FOUND", "Attachment not found");
      return dbFail(res, "attachment lookup failed", error);
    }
    const attachment = (data as Row | null) ?? null;
    if (!attachment) return fail(res, 404, "NOT_FOUND", "Attachment not found");

    // Only objects under this ticket's own prefix are ever signed.
    if (typeof attachment.storage_path !== "string" || !attachment.storage_path.startsWith(`tickets/${ticket.id}/`) || attachment.storage_path.includes("..")) {
      logger.warn("Support: attachment path outside ticket prefix", { ticketId: ticket.id, attachmentId });
      return fail(res, 404, "NOT_FOUND", "Attachment not found");
    }

    if (viewer.role === "student" && attachment.comment_id) {
      const { data: c } = await db().from("ticket_comments").select("*").eq("id", attachment.comment_id).eq("ticket_id", ticket.id).maybeSingle();
      if (!c || (c as Row).is_internal) return fail(res, 404, "NOT_FOUND", "Attachment not found");
    }

    const { data: signed, error: signErr } = await db().storage.from(BUCKET).createSignedUrl(attachment.storage_path, SIGNED_URL_SECONDS);
    if (signErr || !signed) {
      logger.error("Support: signed download url failed", { error: signErr?.message });
      return fail(res, 503, "STORAGE_UNAVAILABLE", "File storage is temporarily unavailable");
    }
    await auditTicket(req, "support.attachment_downloaded", ticket, "Support attachment downloaded", { attachmentId });
    res.json({ downloadUrl: signed.signedUrl, fileName: attachment.file_name, expiresInSeconds: SIGNED_URL_SECONDS });
  }));

  return router;
}

export default createTicketsRouter(defaultTicketsRouterDeps());
