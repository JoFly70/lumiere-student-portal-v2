/**
 * Staff billing API (S18), mounted under /api/admin. Staff + admin only (server-side
 * role check on every route; a refused request is audited as billing.access_denied).
 *
 *   GET  /api/admin/students/:studentId/billing
 *   POST /api/admin/students/:studentId/billing/obligation
 *   POST /api/admin/students/:studentId/billing/discounts
 *   POST /api/admin/students/:studentId/billing/installments      (replaces the schedule)
 *   POST /api/admin/students/:studentId/billing/receipts
 *   POST /api/admin/students/:studentId/billing/evidence          (log student-submitted proof)
 *   POST /api/admin/students/:studentId/billing/evidence/:evidenceId/confirm  (body = receipt)
 *   POST /api/admin/students/:studentId/billing/evidence/:evidenceId/reject
 *
 * Per-route middleware, so mounting at /api/admin never intercepts other admin paths.
 */
import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import {
  BILLING_ERROR_CODES as E,
  addDiscountSchema,
  recordReceiptSchema,
  registerEvidenceSchema,
  rejectEvidenceSchema,
  setInstallmentsSchema,
  setObligationSchema,
} from "@shared/billing-contract";
import { requireAuth } from "../middleware/auth";
import { toBillingUnavailable, type BillingAuditRecord, type BillingService } from "../services/billing-service";
import { emitBillingAccessDenied, emitBillingAudit, type BillingAuditSink } from "./billing-audit";
import { parseBillingBody, sendBillingError } from "./billing-http";
import { guardRoles } from "./high-school-http";

export interface AdminBillingRouterDeps {
  readonly service: Pick<
    BillingService,
    "getStaffView" | "setObligation" | "addDiscount" | "setInstallments" | "recordReceipt" | "registerEvidence" | "confirmEvidence" | "rejectEvidence"
  >;
  readonly audit?: BillingAuditSink;
  readonly onAccessDenied?: (req: Request) => void;
}

const idSchema = z.string().trim().min(1).max(128);

export function createAdminBillingRouter(deps: AdminBillingRouterDeps) {
  const router = Router();
  const audit = deps.audit ?? emitBillingAudit;
  const staffOrAdmin = [requireAuth, guardRoles(["staff", "admin"], deps.onAccessDenied ?? emitBillingAccessDenied)];
  const base = "/students/:studentId/billing";

  router.get(base, ...staffOrAdmin, (async (req: Request, res: Response) => {
    const sid = idSchema.safeParse(req.params.studentId);
    if (!sid.success) return res.status(400).json({ error: { code: E.VALIDATION, message: "studentId must be a non-empty string of at most 128 characters" } });
    if (Object.prototype.hasOwnProperty.call(req.query, "studentId")) {
      return res.status(400).json({ error: { code: E.STUDENT_ID_NOT_ACCEPTED, message: "studentId belongs in the path only" } });
    }
    try {
      return res.json(await deps.service.getStaffView(sid.data));
    } catch (error) {
      return sendBillingError(res, toBillingUnavailable(error), "staff view");
    }
  }) as RequestHandler);

  const post = (path: string, context: string, schema: z.ZodTypeAny, call: (studentId: string, actorId: string, body: any, req: Request) => Promise<unknown>) =>
    router.post(`${base}${path}`, ...staffOrAdmin, (async (req: Request, res: Response) => {
      const sid = idSchema.safeParse(req.params.studentId);
      if (!sid.success) return res.status(400).json({ error: { code: E.VALIDATION, message: "studentId must be a non-empty string of at most 128 characters" } });
      if (Object.prototype.hasOwnProperty.call(req.query, "studentId")) {
        return res.status(400).json({ error: { code: E.STUDENT_ID_NOT_ACCEPTED, message: "studentId belongs in the path only" } });
      }
      const body = parseBillingBody(schema, req, res);
      if (!body) return;
      try {
        const out = (await call(sid.data, req.user!.id, body, req)) as { result: unknown; audits: readonly BillingAuditRecord[] };
        audit(req, out.audits);
        return res.status(200).json(out.result);
      } catch (error) {
        return sendBillingError(res, toBillingUnavailable(error), context);
      }
    }) as RequestHandler);

  post("/obligation", "obligation", setObligationSchema, (sid, actor, b) => deps.service.setObligation(sid, actor, b));
  post("/discounts", "discount", addDiscountSchema, (sid, actor, b) => deps.service.addDiscount(sid, actor, b));
  post("/installments", "installments", setInstallmentsSchema, (sid, actor, b) => deps.service.setInstallments(sid, actor, b));
  post("/receipts", "receipt", recordReceiptSchema, (sid, actor, b) => deps.service.recordReceipt(sid, actor, b));
  post("/evidence", "evidence", registerEvidenceSchema, (sid, actor, b) => deps.service.registerEvidence(sid, actor, b));
  post("/evidence/:evidenceId/confirm", "evidence confirm", recordReceiptSchema, (sid, actor, b, req) =>
    deps.service.confirmEvidence(sid, actor, String(req.params.evidenceId), b));
  post("/evidence/:evidenceId/reject", "evidence reject", rejectEvidenceSchema, (sid, actor, b, req) =>
    deps.service.rejectEvidence(sid, actor, String(req.params.evidenceId), b.reason));

  return router;
}

export function createDefaultAdminBillingRouter() {
  const load = async () => (await import("../services/billing-service.default")).defaultBillingService;
  const lazy =
    <K extends keyof AdminBillingRouterDeps["service"]>(name: K) =>
    async (...args: Parameters<AdminBillingRouterDeps["service"][K]>) =>
      ((await load())[name] as (...a: unknown[]) => unknown)(...args);
  const names = ["getStaffView", "setObligation", "addDiscount", "setInstallments", "recordReceipt", "registerEvidence", "confirmEvidence", "rejectEvidence"] as const;
  const service = Object.fromEntries(names.map((n) => [n, lazy(n)])) as unknown as AdminBillingRouterDeps["service"];
  return createAdminBillingRouter({ service });
}

export default createDefaultAdminBillingRouter();
