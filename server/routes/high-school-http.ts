/**
 * Shared HTTP helpers for the S11 high school routers: error mapping,
 * request validation and the staff role guard that audits denied access.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodError, ZodTypeAny, z } from "zod";
import { HS_ERROR_CODES } from "@shared/high-school-contract";
import { logger } from "../lib/logger";
import { HsError } from "../services/high-school-service";

/** { error: { code, message, details? } }; DB and unexpected errors become a generic 500 (nothing leaked). */
export function sendHsError(res: Response, error: unknown, context: string) {
  if (error instanceof HsError) {
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    });
  }
  // Drizzle wraps driver failures with SQL and bound values. Log safe diagnostic
  // identifiers instead of discarding the cause or exposing query/student data.
  const diagnostic: Record<string, string> = {};
  let cause: unknown = error;
  for (let depth = 0; cause && typeof cause === "object" && depth < 5; depth++) {
    const detail = cause as { code?: unknown; routine?: unknown; column?: unknown; message?: unknown; cause?: unknown };
    for (const key of ["code", "routine", "column"] as const) {
      const value = detail[key];
      if (typeof value === "string" && /^[A-Za-z0-9_.]+$/.test(value)) diagnostic[key] = value;
    }
    if (typeof detail.message === "string") {
      if (/max.?clients|clients.*pool_size|too many clients/i.test(detail.message)) diagnostic.reason = "SESSION_POOL_CAPACITY";
      else if (/prepared statement/i.test(detail.message)) diagnostic.reason = "PREPARED_STATEMENT";
    }
    cause = detail.cause;
  }
  logger.error(`High school ${context} failed`, diagnostic);
  return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
}

export function validationFailure(res: Response, message: string, details?: Record<string, unknown>) {
  return res.status(400).json({ error: { code: HS_ERROR_CODES.VALIDATION, message, ...(details ? { details } : {}) } });
}

export function studentIdNotAccepted(res: Response) {
  return res.status(400).json({
    error: { code: HS_ERROR_CODES.STUDENT_ID_NOT_ACCEPTED, message: "studentId is not accepted; the student is resolved from your login" },
  });
}

const has = (o: unknown, key: string) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, key);
export const mentionsStudentId = (req: Request): boolean => has(req.query, "studentId") || has(req.body, "studentId");

function valueAt(body: unknown, path: readonly PropertyKey[]): unknown {
  let cur: any = body;
  for (const p of path) cur = cur == null ? undefined : cur[p as any];
  return cur;
}

/** A missing/empty evidence document id is HS_EVIDENCE_REQUIRED (400); every other schema problem is HS_VALIDATION_FAILED. */
export function sendZodError(res: Response, error: ZodError, body: unknown) {
  const issues = error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  const evidenceMissing = error.issues.some((i) => {
    const last = String(i.path[i.path.length - 1] ?? "");
    if (!/^(evidenceDocumentId|diplomaEvidenceDocumentId|transcriptEvidenceDocumentId)$/.test(last)) return false;
    const v = valueAt(body, i.path);
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  });
  return res.status(400).json({
    error: {
      code: evidenceMissing ? HS_ERROR_CODES.EVIDENCE_REQUIRED : HS_ERROR_CODES.VALIDATION,
      message: evidenceMissing ? "Evidence from a verified document is required" : "Invalid request",
      details: { issues },
    },
  });
}

export function parseBody<T extends ZodTypeAny>(schema: T, req: Request, res: Response): z.infer<T> | null {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendZodError(res, parsed.error, req.body);
    return null;
  }
  return parsed.data;
}

/**
 * Role guard with the same 401/403 shape as requireRole, plus a non-blocking
 * `onDenied` hook so refused access can be audited (high_school.access_denied).
 */
export function guardRoles(
  allowed: readonly string[],
  onDenied: (req: Request) => void,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "Authentication required" });
    if (!allowed.includes(user.role)) {
      try {
        onDenied(req);
      } catch (error) {
        logger.warn("High school access-denied audit failed", { error: error instanceof Error ? error.message : String(error) });
      }
      return res.status(403).json({ error: "Insufficient permissions", required: allowed, current: user.role });
    }
    return next();
  };
}
