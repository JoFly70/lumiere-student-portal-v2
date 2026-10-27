/** Billing audit emitter (S18). Non-blocking; identifiers and integer amounts only. */
import type { Request } from "express";
import { createAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";
import type { BillingAuditRecord } from "../services/billing-service";

export type BillingAuditSink = (req: Request, records: readonly BillingAuditRecord[]) => void;

export const emitBillingAudit: BillingAuditSink = (req, records) => {
  for (const r of records) {
    try {
      void Promise.resolve(
        createAuditLog({
          eventType: r.event,
          severity: "info",
          actorUserId: req.user?.id,
          actorRole: req.user?.role,
          actorIp: req.ip,
          actorUserAgent: req.get?.("user-agent") ?? undefined,
          targetResourceType: "billing",
          targetResourceId: r.studentId,
          actionDescription: r.description,
          metadata: { ...r.metadata },
          isFinancialRecord: true,
        }),
      ).catch((error: unknown) => logger.warn("Billing audit emit failed", { eventType: r.event, error: error instanceof Error ? error.message : String(error) }));
    } catch (error) {
      logger.warn("Billing audit emit failed", { eventType: r.event, error: error instanceof Error ? error.message : String(error) });
    }
  }
};

export function emitBillingAccessDenied(req: Request): void {
  void Promise.resolve(
    createAuditLog({
      eventType: "billing.access_denied",
      severity: "warning",
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      actorIp: req.ip,
      targetResourceType: "billing",
      targetResourceId: typeof req.params?.studentId === "string" ? req.params.studentId : undefined,
      actionDescription: "Refused access to a billing staff endpoint",
      metadata: { method: req.method, path: (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "", role: req.user?.role ?? null },
      isFinancialRecord: true,
    }),
  ).catch((error: unknown) => logger.warn("Billing access-denied audit failed", { error: error instanceof Error ? error.message : String(error) }));
}
