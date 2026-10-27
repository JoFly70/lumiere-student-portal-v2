/**
 * Billing ledger service (S18). Small on purpose: staff enter the ledger, the
 * student reads a derived projection. All arithmetic lives in shared/billing-ledger.ts.
 *
 * Every mutation runs in ONE transaction and returns the refreshed staff view plus
 * audit records (identifiers and integer amounts only, never notes or references).
 */
import {
  BILLING_ERROR_CODES as E,
  type AddDiscountInput,
  type BillingErrorCode,
  type BillingEvidenceRow,
  type BillingLedgerData,
  type BillingReceiptRow,
  type RecordReceiptInput,
  type RegisterEvidenceInput,
  type SetInstallmentsInput,
  type SetObligationInput,
  type StaffBillingView,
  type StudentBillingView,
} from "@shared/billing-contract";
import { computeStaffBilling, computeStudentBilling } from "@shared/billing-ledger";

export class BillingError extends Error {
  constructor(
    readonly code: BillingErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

/** Postgres SQLSTATE / driver codes meaning "the store or its schema is not there". */
const INFRA_CODES = new Set(["42P01", "3D000", "57P01", "57P03", "53300", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_DESTROYED"]);
export function toBillingUnavailable(error: unknown): unknown {
  if (error instanceof BillingError) return error;
  for (let e: any = error, i = 0; e && i < 4; e = e.cause, i++) {
    const code = typeof e.code === "string" ? e.code : "";
    if (INFRA_CODES.has(code) || code.startsWith("08")) {
      return new BillingError(E.UNAVAILABLE, 503, "Billing records are temporarily unavailable");
    }
  }
  return error;
}

export type BillingAuditEvent = "billing.ledger_updated" | "billing.receipt_recorded" | "billing.evidence_reviewed";
export interface BillingAuditRecord {
  readonly event: BillingAuditEvent;
  readonly description: string;
  readonly studentId: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}
export interface BillingMutation<T> {
  readonly result: T;
  readonly audits: readonly BillingAuditRecord[];
}

/** Data access only. `Tx` is opaque to the service. */
export interface BillingRepository<Tx = unknown> {
  studentExists(tx: Tx, studentId: string): Promise<boolean>;
  documentBelongsToStudent(tx: Tx, studentId: string, documentId: string): Promise<boolean>;
  /** Locks the student's obligation row (or nothing) so concurrent writers serialize. */
  loadLedger(tx: Tx, studentId: string, opts?: { lock?: boolean }): Promise<BillingLedgerData>;
  upsertObligation(tx: Tx, studentId: string, actorId: string, input: SetObligationInput, at: Date): Promise<void>;
  insertDiscount(tx: Tx, studentId: string, actorId: string, input: AddDiscountInput, at: Date): Promise<void>;
  replaceInstallments(tx: Tx, studentId: string, actorId: string, input: SetInstallmentsInput, at: Date): Promise<void>;
  insertReceipt(tx: Tx, studentId: string, actorId: string, input: RecordReceiptInput, evidenceId: string | null, at: Date): Promise<BillingReceiptRow>;
  insertEvidence(tx: Tx, studentId: string, actorId: string, input: RegisterEvidenceInput, at: Date): Promise<BillingEvidenceRow>;
  findEvidence(tx: Tx, studentId: string, evidenceId: string): Promise<BillingEvidenceRow | null>;
  reviewEvidence(
    tx: Tx,
    evidenceId: string,
    review: { status: "confirmed" | "rejected"; actorId: string; at: Date; rejectReason: string | null; receiptId: string | null },
  ): Promise<void>;
}

export interface BillingServiceDeps<Tx = unknown> {
  readonly repo: BillingRepository<Tx>;
  readonly transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  readonly readTx: Tx;
  readonly now: () => Date;
}

const todayOf = (d: Date) => d.toISOString().slice(0, 10);

export function createBillingService<Tx>(deps: BillingServiceDeps<Tx>) {
  const { repo } = deps;

  async function requireStudent(tx: Tx, studentId: string) {
    if (!(await repo.studentExists(tx, studentId))) throw new BillingError(E.STUDENT_NOT_FOUND, 404, "Student not found");
  }
  async function requireConfigured(tx: Tx, studentId: string): Promise<BillingLedgerData> {
    const ledger = await repo.loadLedger(tx, studentId, { lock: true });
    if (!ledger.obligation) throw new BillingError(E.NOT_CONFIGURED, 409, "Set the agreed program price before recording anything else");
    return ledger;
  }
  const staffView = async (tx: Tx, studentId: string): Promise<StaffBillingView> =>
    computeStaffBilling(await repo.loadLedger(tx, studentId), todayOf(deps.now()));

  /** Run a mutation in one transaction, then return the refreshed staff view. */
  async function mutate(
    studentId: string,
    body: (tx: Tx, at: Date) => Promise<BillingAuditRecord[]>,
  ): Promise<BillingMutation<StaffBillingView>> {
    return deps.transaction(async (tx) => {
      await requireStudent(tx, studentId);
      const audits = await body(tx, deps.now());
      return { result: await staffView(tx, studentId), audits };
    });
  }

  return {
    /** The ONLY student read. Derived from the ledger; carries no staff fields. */
    async getStudentView(studentId: string): Promise<StudentBillingView> {
      return computeStudentBilling(await repo.loadLedger(deps.readTx, studentId), todayOf(deps.now()));
    },

    async getStaffView(studentId: string): Promise<StaffBillingView> {
      await requireStudent(deps.readTx, studentId);
      return staffView(deps.readTx, studentId);
    },

    setObligation(studentId: string, actorId: string, input: SetObligationInput) {
      return mutate(studentId, async (tx, at) => {
        const before = await repo.loadLedger(tx, studentId, { lock: true });
        if (before.obligation && before.obligation.currency !== input.currency && (before.receipts.length > 0 || before.discounts.length > 0)) {
          throw new BillingError(E.VALIDATION, 400, "Currency cannot change after receipts or discounts exist");
        }
        await repo.upsertObligation(tx, studentId, actorId, input, at);
        return [{ event: "billing.ledger_updated", description: "Agreed program price set", studentId, metadata: { change: "obligation", agreedCents: input.agreedCents, currency: input.currency } }];
      });
    },

    addDiscount(studentId: string, actorId: string, input: AddDiscountInput) {
      return mutate(studentId, async (tx, at) => {
        const ledger = await requireConfigured(tx, studentId);
        const existing = ledger.discounts.reduce((a, d) => a + d.amountCents, 0);
        if (existing + input.amountCents > ledger.obligation!.agreedCents) {
          throw new BillingError(E.DISCOUNT_EXCEEDS_OBLIGATION, 400, "Discounts cannot exceed the agreed program price");
        }
        await repo.insertDiscount(tx, studentId, actorId, input, at);
        return [{ event: "billing.ledger_updated", description: "Approved discount added", studentId, metadata: { change: "discount", amountCents: input.amountCents } }];
      });
    },

    setInstallments(studentId: string, actorId: string, input: SetInstallmentsInput) {
      return mutate(studentId, async (tx, at) => {
        await requireConfigured(tx, studentId);
        await repo.replaceInstallments(tx, studentId, actorId, input, at);
        return [{ event: "billing.ledger_updated", description: "Installment schedule replaced", studentId, metadata: { change: "installments", count: input.installments.length } }];
      });
    },

    recordReceipt(studentId: string, actorId: string, input: RecordReceiptInput) {
      return mutate(studentId, async (tx, at) => {
        await requireConfigured(tx, studentId);
        const receipt = await repo.insertReceipt(tx, studentId, actorId, input, null, at);
        return [{ event: "billing.receipt_recorded", description: "Receipt confirmed by staff", studentId, metadata: { receiptId: receipt.id, amountCents: input.amountCents, fromEvidence: false } }];
      });
    },

    /** Staff log that the student uploaded proof (a document id). Counts as nothing until confirmed. */
    registerEvidence(studentId: string, actorId: string, input: RegisterEvidenceInput) {
      return mutate(studentId, async (tx, at) => {
        if (!(await repo.documentBelongsToStudent(tx, studentId, input.documentId))) {
          throw new BillingError(E.VALIDATION, 400, "That document does not belong to this student");
        }
        const row = await repo.insertEvidence(tx, studentId, actorId, input, at);
        return [{ event: "billing.evidence_reviewed", description: "Payment evidence logged for review", studentId, metadata: { evidenceId: row.id, status: "awaiting_review" } }];
      });
    },

    confirmEvidence(studentId: string, actorId: string, evidenceId: string, input: RecordReceiptInput) {
      return mutate(studentId, async (tx, at) => {
        await requireConfigured(tx, studentId);
        const evidence = await repo.findEvidence(tx, studentId, evidenceId);
        if (!evidence) throw new BillingError(E.EVIDENCE_NOT_FOUND, 404, "Evidence not found");
        if (evidence.status !== "awaiting_review") throw new BillingError(E.EVIDENCE_ALREADY_REVIEWED, 409, "Evidence was already reviewed");
        const receipt = await repo.insertReceipt(tx, studentId, actorId, input, evidenceId, at);
        await repo.reviewEvidence(tx, evidenceId, { status: "confirmed", actorId, at, rejectReason: null, receiptId: receipt.id });
        const audits: BillingAuditRecord[] = [
          { event: "billing.receipt_recorded", description: "Receipt confirmed by staff from evidence", studentId, metadata: { receiptId: receipt.id, amountCents: input.amountCents, fromEvidence: true } },
          { event: "billing.evidence_reviewed", description: "Payment evidence confirmed", studentId, metadata: { evidenceId, status: "confirmed" } },
        ];
        return audits;
      });
    },

    rejectEvidence(studentId: string, actorId: string, evidenceId: string, reason: string) {
      return mutate(studentId, async (tx, at) => {
        const evidence = await repo.findEvidence(tx, studentId, evidenceId);
        if (!evidence) throw new BillingError(E.EVIDENCE_NOT_FOUND, 404, "Evidence not found");
        if (evidence.status !== "awaiting_review") throw new BillingError(E.EVIDENCE_ALREADY_REVIEWED, 409, "Evidence was already reviewed");
        await repo.reviewEvidence(tx, evidenceId, { status: "rejected", actorId, at, rejectReason: reason, receiptId: null });
        return [{ event: "billing.evidence_reviewed", description: "Payment evidence rejected", studentId, metadata: { evidenceId, status: "rejected" } }];
      });
    },
  };
}

export type BillingService = ReturnType<typeof createBillingService>;
