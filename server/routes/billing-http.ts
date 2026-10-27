/** Shared HTTP helpers for the S18 billing routers. */
import type { Request, Response } from "express";
import type { ZodTypeAny, z } from "zod";
import { BILLING_ERROR_CODES as E } from "@shared/billing-contract";
import { logger } from "../lib/logger";
import { BillingError } from "../services/billing-service";

export function sendBillingError(res: Response, error: unknown, context: string) {
  if (error instanceof BillingError) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  }
  logger.error(`Billing ${context} failed`, { error: error instanceof Error ? error.message : String(error) });
  return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
}

const has = (o: unknown, key: string) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, key);
export const mentionsStudentId = (req: Request): boolean => has(req.query, "studentId") || has(req.body, "studentId");

export function parseBillingBody<T extends ZodTypeAny>(schema: T, req: Request, res: Response): z.infer<T> | null {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: E.VALIDATION,
        message: "Invalid request",
        details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      },
    });
    return null;
  }
  return parsed.data;
}
