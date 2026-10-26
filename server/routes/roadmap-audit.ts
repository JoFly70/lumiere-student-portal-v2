/**
 * Audit trail for staff roadmap actions (S07), on top of the existing audit
 * infrastructure (server/lib/audit.ts -> audit_logs). Each route calls ONE
 * helper below, after the service call succeeded (or, for publish, was refused).
 *
 * Guarantees:
 *   - never throws and never delays the response (fire-and-forget; createAuditLog
 *     already swallows errors and no-ops when Supabase is not configured);
 *   - metadata is identifiers and counts only (RoadmapAuditMetadata): no workbook
 *     content, file names, notes or student personal data;
 *   - the student is recorded as targetResourceType/Id (students.id), NOT as
 *     targetUserId, because audit_logs.target_user_id is a FK to users.id.
 */
import type { Request } from "express";
import type { AdminRoadmapState } from "@shared/student-roadmap-contract";
import { createAuditLog, type AuditEventType, type RoadmapAuditMetadata } from "../lib/audit";
import { logger } from "../lib/logger";

type RoadmapEvent = Extract<AuditEventType, `roadmap.${string}`>;

function emit(
  req: Request,
  eventType: RoadmapEvent,
  description: string,
  metadata: RoadmapAuditMetadata,
  severity: "info" | "warning" = "info",
): void {
  try {
    void Promise.resolve(
      createAuditLog({
        eventType,
        severity,
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        actorIp: req.ip,
        actorUserAgent: req.get?.("user-agent") ?? undefined,
        targetResourceType: "student_roadmap",
        targetResourceId: metadata.studentId,
        actionDescription: description,
        metadata: { ...metadata },
        isEducationalRecord: true,
        requestId: (req.res?.getHeader("X-Request-ID") as string | undefined) ?? undefined,
      }),
    ).catch((error: unknown) => {
      logger.warn("Roadmap audit emit failed", { eventType, error: error instanceof Error ? error.message : String(error) });
    });
  } catch (error) {
    logger.warn("Roadmap audit emit failed", { eventType, error: error instanceof Error ? error.message : String(error) });
  }
}

function countExceptions(state: AdminRoadmapState) {
  const counts = { blocking: 0, warning: 0, info: 0 };
  for (const e of state.draft?.exceptions ?? []) counts[e.severity] += 1;
  return counts;
}

function draftMeta(studentId: string, state: AdminRoadmapState): RoadmapAuditMetadata {
  const d = state.draft;
  return {
    studentId,
    versionId: d?.versionId ?? null,
    versionNumber: d?.versionNumber ?? null,
    baseVersionId: d?.baseVersionId ?? null,
    draftRevision: d?.draftRevision ?? null,
    importId: d?.import?.importId ?? null,
    importSha256: d?.import?.fileSha256 ?? null,
    templateId: d?.import?.templateId ?? null,
    exceptionCounts: countExceptions(state),
  };
}

export const roadmapAudit = {
  imported(req: Request, studentId: string, outcome: { state: AdminRoadmapState; replay: boolean }, replacedDraft = false) {
    emit(
      req,
      outcome.replay ? "roadmap.import_replayed" : "roadmap.import_created",
      outcome.replay ? "Roadmap import replayed (identical file)" : "Roadmap draft created from import",
      { ...draftMeta(studentId, outcome.state), replacedDraft },
    );
  },
  draftUpdated(req: Request, studentId: string, state: AdminRoadmapState) {
    emit(req, "roadmap.draft_updated", "Roadmap draft edited", draftMeta(studentId, state));
  },
  acknowledged(req: Request, studentId: string, state: AdminRoadmapState, acknowledgedCount: number) {
    emit(req, "roadmap.exceptions_acknowledged", "Roadmap exceptions acknowledged", { ...draftMeta(studentId, state), acknowledgedCount });
  },
  discarded(req: Request, studentId: string, expectedDraftRevision: number) {
    emit(req, "roadmap.draft_discarded", "Roadmap draft discarded", { studentId, draftRevision: expectedDraftRevision });
  },
  openedFromPublished(req: Request, studentId: string, state: AdminRoadmapState) {
    emit(req, "roadmap.draft_opened_from_published", "Roadmap draft opened from published version", draftMeta(studentId, state));
  },
  published(req: Request, studentId: string, state: AdminRoadmapState, expectedDraftRevision: number) {
    emit(req, "roadmap.published", "Roadmap version published", {
      studentId,
      versionId: state.published?.versionId ?? null,
      versionNumber: state.published?.versionNumber ?? null,
      draftRevision: expectedDraftRevision,
      importId: state.published?.importId ?? null,
    });
  },
  /** Stale draft/base (409) or not publishable (422); other failures are not audited here. */
  publishRejected(req: Request, studentId: string, expectedDraftRevision: number, error: unknown) {
    const e = error as { code?: unknown; status?: unknown } | null;
    const code = typeof e?.code === "string" ? e.code : "";
    if (code !== "ROADMAP_STALE_DRAFT" && code !== "ROADMAP_NOT_PUBLISHABLE") return;
    emit(
      req,
      "roadmap.publish_rejected",
      "Roadmap publish rejected",
      {
        studentId,
        draftRevision: expectedDraftRevision,
        rejectionCode: code,
        httpStatus: typeof e?.status === "number" ? e.status : undefined,
      },
      "warning",
    );
  },
};
