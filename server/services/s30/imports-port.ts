/**
 * S30 Phase B — Import Center -> S29 operational layer: the ONE seam between academic imports and S29's event store,
 * notification outbox and exception queue. The Import Center stores no events, notifications or exceptions itself.
 *
 * Integration (S26): call setImportOperationsPort() once at startup with an adapter onto S29's services. S29's
 * exception queue reads the "needs review" state through importReviewSummary() (imports/service.ts), a pull model like
 * calendarHealth(), so a committed or rolled-back import changes the queue on its next read.
 * The default port is a no-op ("not_wired"): nothing is lost (the records are in the database) and nothing is sent twice.
 */
import type { PortResult } from "./calendar-port";

export type ImportOpsEventKind = "academic.import_committed" | "academic.import_rolled_back" | "academic.progress_reported" | "academic.review_required";
export interface ImportOpsEvent {
  readonly kind: ImportOpsEventKind;
  /** null for the batch-level event. */
  readonly studentId: string | null;
  readonly batchId: string;
  /** Counts and the evidence tier only (never row contents). */
  readonly data: Readonly<{ records?: number; inserted?: number; superseded?: number; needsReview?: number; students?: number; withdrawn?: number; restored?: number; tier?: string }>;
  readonly actorId: string | null;
  readonly dedupeKey: string;
}

export type ImportNotificationKind = "import.committed" | "import.review_required" | "import.rolled_back";
export interface ImportNotification {
  readonly recipientUserId: string;
  readonly kind: ImportNotificationKind;
  readonly params: Readonly<{ date: string; records: number; students: number }>;
  /** Portal path (always starts with "/"). */
  readonly href: string;
  readonly dedupeKey: string;
}

export interface ImportOperationsPort {
  recordEvent(event: ImportOpsEvent): Promise<PortResult>;
  enqueueNotification(notification: ImportNotification): Promise<PortResult>;
}

const notWired: ImportOperationsPort = { recordEvent: async () => "not_wired", enqueueNotification: async () => "not_wired" };
let current: ImportOperationsPort = notWired;
export function setImportOperationsPort(port: ImportOperationsPort | null): void { current = port ?? notWired; }
export function importOperationsPort(): ImportOperationsPort { return current; }
export const importPortWired = () => current !== notWired;
