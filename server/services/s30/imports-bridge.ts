/**
 * S30 imports -> S29 operational layer: implements ImportOperationsPort (imports-port.ts) on S29's services, the same
 * way server/services/s29/calendar-bridge.ts implements the calendar port.
 *
 *   recordEvent          -> audit log entry 'import.batch_committed' / 'import.batch_rolled_back' for batch-level events.
 *                           Per-student events are not duplicated: the review state is read live through
 *                           importReviewSummary() (S29 attention rules and the Fleet copilot).
 *   enqueueNotification  -> s29_notifications (staff audience, in-app + email per S29 preferences), idempotent on the
 *                           port's dedupe key; templates import.committed / import.review_required / import.rolled_back.
 * Wired once at startup by wireS30Imports() (server/routes.ts).
 */
import { sql } from "drizzle-orm";
import { createAuditLog } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { errorCode, rows, s29Schema, type SqlExecutor, type Tx } from "../s29/db";
import { enqueue } from "../s29/outbox";
import { formatDate, type Lang } from "../s29/templates";
import { setImportOperationsPort, type ImportOperationsPort } from "./imports-port";

const TEMPLATES = new Set(["import.committed", "import.review_required", "import.rolled_back"]);

async function defaultDb(): Promise<Tx> {
  const { db } = await import("../../lib/db");
  return db as unknown as Tx;
}

export function createImportsOpsAdapter(getDb: () => Promise<SqlExecutor> = defaultDb, now: () => Date = () => new Date()): ImportOperationsPort {
  return {
    async recordEvent(e) {
      // Batch-level events become audit entries; per-student events are covered by the live review summary.
      if (e.kind !== "academic.import_committed" && e.kind !== "academic.import_rolled_back") return "accepted";
      try {
        await createAuditLog({
          eventType: e.kind === "academic.import_committed" ? "import.batch_committed" : "import.batch_rolled_back", severity: "info",
          actorUserId: e.actorId ?? undefined, targetResourceType: "academic_import", targetResourceId: e.batchId,
          actionDescription: e.kind === "academic.import_committed" ? "Academic import committed (operational event)" : "Academic import rolled back (operational event)",
          isEducationalRecord: true, metadata: { ...e.data, dedupeKey: e.dedupeKey.slice(0, 200), source: "s30_imports_bridge" },
        });
        return "accepted";
      } catch (error) {
        logger.warn("S30 imports bridge recordEvent failed", { code: errorCode(error) });
        return "failed";
      }
    },
    async enqueueNotification(n) {
      try {
        if (!TEMPLATES.has(n.kind) || !n.href.startsWith("/")) return "failed";
        const db = await getDb();
        if (!(await s29Schema(db)).present) return "not_wired";
        const u = rows(await db.execute(sql`SELECT u.id, u.email, u.role, l.language FROM users u LEFT JOIN user_language_preference l ON l.user_id = u.id WHERE u.id = ${n.recipientUserId}`))[0];
        if (!u || u.role !== "admin") return "failed";
        const lang: Lang = u.language === "fr" ? "fr" : "en";
        const res = await enqueue(db, {
          dedupeKey: `s30:${n.dedupeKey}:${n.recipientUserId}`.slice(0, 300), audience: "staff", template: n.kind, source: "imports",
          params: { records: n.params.records, students: n.params.students, whenEn: formatDate(n.params.date, "en", "UTC", true), whenFr: formatDate(n.params.date, "fr", "UTC", true), href: n.href },
          staff: { userId: String(u.id), email: u.email ? String(u.email) : null, language: lang }, now: now(),
        });
        return res.created ? "accepted" : "duplicate";
      } catch (error) {
        logger.warn("S30 imports bridge enqueue failed", { kind: n.kind, code: errorCode(error) });
        return "failed";
      }
    },
  };
}

export function wireS30Imports(opts: { getDb?: () => Promise<SqlExecutor> } = {}): void {
  setImportOperationsPort(createImportsOpsAdapter(opts.getDb));
}
