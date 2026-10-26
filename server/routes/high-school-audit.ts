/**
 * Audit trail for high school actions (S11), on top of server/lib/audit.ts.
 *
 * Never throws and never delays the response. Metadata is identifiers and
 * counts only: no notes, school names, document contents or personal data.
 * The student is recorded as targetResourceId (students.id), not targetUserId.
 */
import type { Request } from "express";
import { createAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";
import type { HsAuditRecord } from "../services/high-school-service";

export type HsAuditSink = (req: Request, records: readonly HsAuditRecord[]) => void;

export const emitHighSchoolAudit: HsAuditSink = (req, records) => {
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
          targetResourceType: "high_school",
          targetResourceId: r.studentId,
          actionDescription: r.description,
          metadata: { ...r.metadata },
          isEducationalRecord: true,
          requestId: (req.res?.getHeader("X-Request-ID") as string | undefined) ?? undefined,
        }),
      ).catch((error: unknown) => {
        logger.warn("High school audit emit failed", { eventType: r.event, error: error instanceof Error ? error.message : String(error) });
      });
    } catch (error) {
      logger.warn("High school audit emit failed", { eventType: r.event, error: error instanceof Error ? error.message : String(error) });
    }
  }
};

/** A refused request to a staff route (e.g. a student calling an admin endpoint). */
export function emitAccessDenied(req: Request): void {
  const pathOnly = (req.originalUrl ?? req.url ?? "").split("?")[0];
  void Promise.resolve(
    createAuditLog({
      eventType: "high_school.access_denied",
      severity: "warning",
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      actorIp: req.ip,
      actorUserAgent: req.get?.("user-agent") ?? undefined,
      targetResourceType: "high_school",
      targetResourceId: typeof req.params?.studentId === "string" ? req.params.studentId : undefined,
      actionDescription: "Refused access to a high school staff endpoint",
      metadata: { method: req.method, path: pathOnly, role: req.user?.role ?? null },
      isEducationalRecord: true,
    }),
  ).catch((error: unknown) => {
    logger.warn("High school access-denied audit failed", { error: error instanceof Error ? error.message : String(error) });
  });
}
