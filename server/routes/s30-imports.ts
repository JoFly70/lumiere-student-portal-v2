/**
 * S30 Phase B — Academic Data Import Center routes (mounted under /api/admin; per-route role checks).
 *
 *   GET    /imports                               admin, staff          history (latest 50)
 *   POST   /imports                               admin, staff (CSRF)   multipart: file (.csv / .xlsx ≤ 5 MB), sourceKind,
 *                                                                       providerLabel?, mappingId?   -> ImportBatchDetail
 *   GET    /imports/mappings                      admin, staff          saved column mappings
 *   GET    /imports/template.csv                  admin, staff          blank template (formula-safe)
 *   GET    /imports/:id                           admin, staff          batch + preview rows + differences
 *   POST   /imports/:id/map                       admin, staff (CSRF)   { columns, saveAs? } -> validate
 *   POST   /imports/:id/discard                   admin, staff (CSRF)   abandon a draft
 *   POST   /imports/:id/approve                   admin (CSRF)
 *   POST   /imports/:id/commit                    admin (CSRF)          writes REPORTED records only (never credit)
 *   POST   /imports/:id/rollback                  admin (CSRF)          { reason }
 *   GET    /students/:studentId/reported-records  admin, staff
 *   PATCH  /students/:studentId/reported-records/:recordId   admin (CSRF)  { reviewState }
 * Coaches and students have no access. Every write is audited (ids, statuses and counts; never row contents).
 * The uploaded file is parsed in memory and never stored; only its SHA-256 is kept.
 */
import { Router, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  IMPORT_MAX_BYTES,
  S30_AUDIT_EVENTS,
  S30_ERROR_CODES as E,
  importMapSchema,
  importRollbackSchema,
  importUploadMetaSchema,
  reviewReportedRecordSchema,
} from "@shared/s30-contract";
import { requireAuth } from "../middleware/auth";
import { requireCsrf } from "../middleware/csrf";
import { createRateLimitStore } from "../lib/rate-limit-store";
import { createAuditLog, type AuditEventType } from "../lib/audit";
import { logger } from "../lib/logger";
import { guardRoles } from "./high-school-http";
import { S30Error, isMissingTable, type TxDb } from "../services/s30/db-util";
import { ImportFileError, IMPORT_TEMPLATE_CSV } from "../services/s30/imports/parse";
import {
  approveBatch, commitBatch, discardBatch, getBatch, listBatches, listMappings, listReportedRecords, rollbackBatch, setReviewState, uploadBatch, validateBatch,
} from "../services/s30/imports/service";

export interface ImportRouteDeps {
  readonly db: TxDb;
  readonly now?: () => Date;
  readonly auth?: RequestHandler;
  readonly csrf?: RequestHandler;
  readonly audit?: (entry: Parameters<typeof createAuditLog>[0]) => Promise<void>;
  readonly noRateLimit?: boolean;
}

const uuid = z.string().uuid();
const studentIdSchema = z.string().trim().min(1).max(128);

function sendError(res: Response, error: unknown, context: string) {
  if (error instanceof S30Error) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  if (error instanceof ImportFileError) return res.status(400).json({ error: { code: E.FILE_REJECTED, reason: error.reason, message: error.message } });
  if (isMissingTable(error)) {
    logger.warn(`Imports ${context} unavailable (schema not applied)`);
    return res.status(503).json({ error: { code: E.UNAVAILABLE, message: "The Import Center is not switched on for this deployment yet" } });
  }
  for (let e: any = error, i = 0; e && i < 4; e = e.cause, i++) {
    const code = typeof e.code === "string" ? e.code : "";
    if (code.startsWith("08") || ["57P01", "57P03", "53300", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "CONNECT_TIMEOUT"].includes(code)) {
      return res.status(503).json({ error: { code: E.UNAVAILABLE, message: "Temporarily unavailable" } });
    }
  }
  // Never log the message: a wrapped query error carries its parameters (row contents).
  const e = error as { name?: unknown; code?: unknown } | null;
  logger.error(`Imports ${context} failed`, { name: typeof e?.name === "string" ? e.name : typeof error, code: typeof e?.code === "string" ? e.code : undefined });
  return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
}
const validation = (res: Response, error: z.ZodError) =>
  res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid request", details: { issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } } });

export function createImportsRouter(deps: ImportRouteDeps): Router {
  const router = Router();
  const now = () => deps.now?.() ?? new Date();
  const auth = deps.auth ?? requireAuth;
  const csrf = deps.csrf ?? requireCsrf;
  const write = deps.audit ?? createAuditLog;
  const audit = (req: Request, eventType: AuditEventType, description: string, metadata: Record<string, string | number | boolean | null>, studentId?: string | null, severity: "info" | "warning" = "info") => {
    void Promise.resolve(write({
      eventType, severity, actorUserId: req.user?.id, actorRole: req.user?.role, actorIp: req.ip, actorUserAgent: req.get?.("user-agent") ?? undefined,
      targetResourceType: studentId ? "student" : "academic_import", targetResourceId: studentId ?? (typeof req.params?.id === "string" ? req.params.id : undefined),
      actionDescription: description, metadata, isEducationalRecord: true,
    })).catch((error: unknown) => logger.warn("Import audit failed", { eventType, error: error instanceof Error ? error.message : String(error) }));
  };
  const denied = (req: Request) => audit(req, S30_AUDIT_EVENTS.importAccessDenied, "Refused access to an Import Center endpoint",
    { method: req.method, path: (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "", role: req.user?.role ?? null }, null, "warning");
  const readers = [auth, guardRoles(["admin", "staff"], denied)];
  const staffWrite = [...readers, csrf];
  const adminWrite = [auth, guardRoles(["admin"], denied), csrf];

  const wrap = (context: string, fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try { await fn(req, res); } catch (error) { sendError(res, error, context); }
  }) as RequestHandler;
  const batchId = (req: Request, res: Response): string | null => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) { res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid import id" } }); return null; }
    return id.data;
  };

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMPORT_MAX_BYTES, files: 1, fields: 10, fieldSize: 1024 } });
  const uploadLimit: RequestHandler = deps.noRateLimit ? ((_req, _res, next) => next()) : rateLimit({
    store: createRateLimitStore("rl:imports-upload:"), windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => `u:${req.user?.id ?? "anon"}`, validate: { keyGeneratorIpFallback: false },
    handler: (_req, res) => { res.status(429).json({ error: { code: E.THROTTLED, message: "Too many uploads. Please wait a moment." } }); },
  });
  const receiveFile: RequestHandler = (req, res, next) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        const reason = err.code === "LIMIT_FILE_SIZE" ? "too_large" : "unreadable";
        return res.status(400).json({ error: { code: E.FILE_REJECTED, reason, message: err.code === "LIMIT_FILE_SIZE" ? `Files are limited to ${Math.round(IMPORT_MAX_BYTES / 1024 / 1024)} MB.` : "The upload could not be read." } });
      }
      if (err) return next(err);
      next();
    });
  };

  router.get("/imports", ...readers, wrap("list", async (_req, res) => res.json({ batches: await listBatches(deps.db) })));
  router.get("/imports/mappings", ...readers, wrap("mappings", async (_req, res) => res.json({ mappings: await listMappings(deps.db) })));
  router.get("/imports/template.csv", ...readers, (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="lumiere-academic-import-template.csv"');
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(IMPORT_TEMPLATE_CSV);
  });

  router.post("/imports", ...staffWrite, uploadLimit, receiveFile, wrap("upload", async (req, res) => {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) return res.status(400).json({ error: { code: E.FILE_REJECTED, reason: "empty", message: "Choose a .csv or .xlsx file." } });
    const meta = importUploadMetaSchema.safeParse({
      sourceKind: req.body?.sourceKind, ...(req.body?.providerLabel ? { providerLabel: req.body.providerLabel } : {}), ...(req.body?.mappingId ? { mappingId: req.body.mappingId } : {}),
    });
    if (!meta.success) return validation(res, meta.error);
    const detail = await uploadBatch(deps.db, { buffer: file.buffer, fileName: file.originalname ?? null, sourceKind: meta.data.sourceKind, providerLabel: meta.data.providerLabel ?? null, mappingId: meta.data.mappingId ?? null }, req.user!.id, now());
    audit(req, S30_AUDIT_EVENTS.importUploaded, "Academic import uploaded", { batchId: detail.id, sourceKind: detail.sourceKind, format: detail.fileFormat, rows: detail.counts.total ?? 0, bytes: detail.fileBytes, autoMapped: detail.mapping !== null });
    return res.status(201).json(detail);
  }));

  router.get("/imports/:id", ...readers, wrap("detail", async (req, res) => {
    const id = batchId(req, res); if (!id) return;
    return res.json(await getBatch(deps.db, id));
  }));

  router.post("/imports/:id/map", ...staffWrite, wrap("map", async (req, res) => {
    const id = batchId(req, res); if (!id) return;
    const body = importMapSchema.safeParse(req.body ?? {});
    if (!body.success) return validation(res, body.error);
    const out = await validateBatch(deps.db, id, body.data.columns, body.data.saveAs ?? null, req.user!.id, now());
    const detail = await getBatch(deps.db, id);
    audit(req, S30_AUDIT_EVENTS.importValidated, "Academic import mapped and validated", { batchId: id, valid: detail.counts.valid ?? 0, warning: detail.counts.warning ?? 0, invalid: detail.counts.invalid ?? 0, new: detail.counts.new ?? 0, changed: detail.counts.changed ?? 0 });
    if (out.mappingSaved) audit(req, S30_AUDIT_EVENTS.mappingSaved, "Import column mapping saved", { batchId: id });
    return res.json(detail);
  }));

  router.post("/imports/:id/discard", ...staffWrite, wrap("discard", async (req, res) => {
    const id = batchId(req, res); if (!id) return;
    await discardBatch(deps.db, id, req.user!.id);
    audit(req, S30_AUDIT_EVENTS.importDiscarded, "Academic import draft discarded", { batchId: id });
    return res.json(await getBatch(deps.db, id));
  }));

  router.post("/imports/:id/approve", ...adminWrite, wrap("approve", async (req, res) => {
    const id = batchId(req, res); if (!id) return;
    await approveBatch(deps.db, id, req.user!.id);
    audit(req, S30_AUDIT_EVENTS.importApproved, "Academic import approved", { batchId: id });
    return res.json(await getBatch(deps.db, id));
  }));

  router.post("/imports/:id/commit", ...adminWrite, wrap("commit", async (req, res) => {
    const id = batchId(req, res); if (!id) return;
    const out = await commitBatch(deps.db, id, req.user!.id, now());
    audit(req, S30_AUDIT_EVENTS.importCommitted, "Academic import committed as reported (not verified) records", { batchId: id, inserted: out.inserted, superseded: out.superseded, needsReview: out.needsReview, students: out.students.length });
    return res.json({ result: { inserted: out.inserted, superseded: out.superseded, needsReview: out.needsReview, students: out.students.length }, batch: await getBatch(deps.db, id) });
  }));

  router.post("/imports/:id/rollback", ...adminWrite, wrap("rollback", async (req, res) => {
    const id = batchId(req, res); if (!id) return;
    const body = importRollbackSchema.safeParse(req.body ?? {});
    if (!body.success) return validation(res, body.error);
    const out = await rollbackBatch(deps.db, id, body.data.reason, req.user!.id, now());
    audit(req, S30_AUDIT_EVENTS.importRolledBack, "Academic import rolled back", { batchId: id, withdrawn: out.withdrawn, restored: out.restored }, null, "warning");
    return res.json({ result: out, batch: await getBatch(deps.db, id) });
  }));

  router.get("/students/:studentId/reported-records", ...readers, wrap("reported records", async (req, res) => {
    const sid = studentIdSchema.safeParse(req.params.studentId);
    if (!sid.success) return res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid student id" } });
    return res.json({ records: await listReportedRecords(deps.db, sid.data) });
  }));

  router.patch("/students/:studentId/reported-records/:recordId", ...adminWrite, wrap("record review", async (req, res) => {
    const sid = studentIdSchema.safeParse(req.params.studentId);
    const rid = uuid.safeParse(req.params.recordId);
    const body = reviewReportedRecordSchema.safeParse(req.body ?? {});
    if (!sid.success || !rid.success) return res.status(400).json({ error: { code: E.VALIDATION, message: "Invalid id" } });
    if (!body.success) return validation(res, body.error);
    if (!(await setReviewState(deps.db, sid.data, rid.data, body.data.reviewState, req.user!.id))) return res.status(404).json({ error: { code: E.NOT_FOUND, message: "Record not found, not active, or not awaiting review" } });
    audit(req, S30_AUDIT_EVENTS.reportedRecordReviewed, "Imported record review state changed (no credit is recorded)", { recordId: rid.data, reviewState: body.data.reviewState }, sid.data);
    return res.json({ id: rid.data, reviewState: body.data.reviewState });
  }));

  return router;
}

export async function createDefaultImportsRouter(): Promise<Router> {
  const { db } = await import("../lib/db");
  return createImportsRouter({ db: db as unknown as TxDb });
}
