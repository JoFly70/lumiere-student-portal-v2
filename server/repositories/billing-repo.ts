/**
 * Billing ledger repository (S18): raw SQL, data access only, no business rules.
 * Tables: supabase/migrations/20261030100000_s18_billing_ledger.sql.
 */
import { sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db } from "../lib/db";
import type {
  BillingDiscount,
  BillingEvidenceRow,
  BillingEvidenceStatus,
  BillingInstallmentRow,
  BillingLedgerData,
  BillingReceiptRow,
  BillingVoidedDiscount,
  BillingVoidedReceipt,
} from "@shared/billing-contract";
import type { BillingRepository } from "../services/billing-service";

export type Tx = PgTransaction<any, any, any> | typeof db;

type Row = Record<string, unknown>;
const rows = (r: unknown): Row[] => Array.from(r as Row[]);
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const dateOnly = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const int = (v: unknown): number => Number(v);

const toReceipt = (r: Row): BillingReceiptRow => ({
  id: String(r.id),
  amountCents: int(r.amount_cents),
  receivedDate: dateOnly(r.received_date),
  methodLabel: String(r.method_label),
  reference: (r.reference as string | null) ?? null,
  note: (r.note as string | null) ?? null,
  confirmedBy: String(r.confirmed_by),
  confirmedAt: iso(r.confirmed_at),
  evidenceId: r.evidence_id ? String(r.evidence_id) : null,
});
const toEvidence = (r: Row): BillingEvidenceRow => ({
  id: String(r.id),
  documentId: String(r.document_id),
  status: String(r.status) as BillingEvidenceStatus,
  note: (r.note as string | null) ?? null,
  submittedAt: iso(r.submitted_at),
  reviewedBy: r.reviewed_by ? String(r.reviewed_by) : null,
  reviewedAt: r.reviewed_at ? iso(r.reviewed_at) : null,
  rejectReason: (r.reject_reason as string | null) ?? null,
  receiptId: r.receipt_id ? String(r.receipt_id) : null,
});

async function voidRow(tx: Tx, table: "student_billing_receipts" | "student_billing_discounts", studentId: string, id: string, actorId: string, reason: string, at: Date) {
  const t = sql.raw(table);
  const [r] = rows(await tx.execute(sql`SELECT voided_at FROM ${t} WHERE student_id = ${studentId} AND id::text = ${id} FOR UPDATE`));
  if (!r) return "not_found" as const;
  if (r.voided_at) return "already_voided" as const;
  await tx.execute(sql`UPDATE ${t} SET voided_at = ${at.toISOString()}::timestamptz, voided_by = ${actorId}, void_reason = ${reason} WHERE student_id = ${studentId} AND id::text = ${id} AND voided_at IS NULL`);
  return "voided" as const;
}

export const billingRepository: BillingRepository<Tx> = {
  async studentExists(tx, studentId) {
    return rows(await tx.execute(sql`SELECT 1 AS ok FROM students WHERE id = ${studentId} LIMIT 1`)).length > 0;
  },

  async documentBelongsToStudent(tx, studentId, documentId) {
    return (
      rows(
        await tx.execute(sql`SELECT 1 AS ok FROM student_documents WHERE id::text = ${documentId} AND student_id = ${studentId} AND soft_deleted = false LIMIT 1`),
      ).length > 0
    );
  },

  async loadLedger(tx, studentId, opts): Promise<BillingLedgerData> {
    if (opts?.lock) await tx.execute(sql`SELECT id FROM students WHERE id = ${studentId} FOR UPDATE`);
    const [ob] = rows(await tx.execute(sql`SELECT agreed_cents, currency, note FROM student_billing_obligations WHERE student_id = ${studentId}`));
    const discounts = rows(
      await tx.execute(sql`SELECT id, amount_cents, reason, approved_by, approved_at FROM student_billing_discounts WHERE student_id = ${studentId} AND voided_at IS NULL ORDER BY approved_at, id`),
    ).map((r): BillingDiscount => ({ id: String(r.id), amountCents: int(r.amount_cents), reason: String(r.reason), approvedBy: String(r.approved_by), approvedAt: iso(r.approved_at) }));
    const installments = rows(
      await tx.execute(sql`SELECT id, due_date, amount_cents, label, sort_order FROM student_billing_installments WHERE student_id = ${studentId} ORDER BY due_date, sort_order, id`),
    ).map((r): BillingInstallmentRow => ({ id: String(r.id), dueDate: dateOnly(r.due_date), amountCents: int(r.amount_cents), label: (r.label as string | null) ?? null, sortOrder: int(r.sort_order) }));
    const receipts = rows(
      await tx.execute(sql`SELECT id, amount_cents, received_date, method_label, reference, note, evidence_id, confirmed_by, confirmed_at FROM student_billing_receipts WHERE student_id = ${studentId} AND voided_at IS NULL ORDER BY received_date, confirmed_at, id`),
    ).map(toReceipt);
    const voidedReceipts = rows(
      await tx.execute(sql`SELECT id, amount_cents, received_date, method_label, reference, note, evidence_id, confirmed_by, confirmed_at, voided_at, voided_by, void_reason FROM student_billing_receipts WHERE student_id = ${studentId} AND voided_at IS NOT NULL ORDER BY voided_at, id`),
    ).map((r): BillingVoidedReceipt => ({ ...toReceipt(r), voidedAt: iso(r.voided_at), voidedBy: String(r.voided_by), voidReason: String(r.void_reason) }));
    const voidedDiscounts = rows(
      await tx.execute(sql`SELECT id, amount_cents, reason, approved_by, approved_at, voided_at, voided_by, void_reason FROM student_billing_discounts WHERE student_id = ${studentId} AND voided_at IS NOT NULL ORDER BY voided_at, id`),
    ).map((r): BillingVoidedDiscount => ({ id: String(r.id), amountCents: int(r.amount_cents), reason: String(r.reason), approvedBy: String(r.approved_by), approvedAt: iso(r.approved_at), voidedAt: iso(r.voided_at), voidedBy: String(r.voided_by), voidReason: String(r.void_reason) }));
    const evidence = rows(
      await tx.execute(sql`SELECT id, document_id, status, note, submitted_at, reviewed_by, reviewed_at, reject_reason, receipt_id FROM student_billing_evidence WHERE student_id = ${studentId} ORDER BY submitted_at, id`),
    ).map(toEvidence);
    return {
      obligation: ob ? { agreedCents: int(ob.agreed_cents), currency: String(ob.currency), note: (ob.note as string | null) ?? null } : null,
      discounts,
      installments,
      receipts,
      evidence,
      voidedReceipts,
      voidedDiscounts,
    };
  },

  async upsertObligation(tx, studentId, actorId, input, at) {
    await tx.execute(sql`
      INSERT INTO student_billing_obligations (student_id, agreed_cents, currency, note, created_by, created_at, updated_by, updated_at)
      VALUES (${studentId}, ${input.agreedCents}, ${input.currency}, ${input.note ?? null}, ${actorId}, ${at.toISOString()}::timestamptz, ${actorId}, ${at.toISOString()}::timestamptz)
      ON CONFLICT (student_id) DO UPDATE SET agreed_cents = EXCLUDED.agreed_cents, currency = EXCLUDED.currency,
        note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`);
  },

  async insertDiscount(tx, studentId, actorId, input, at) {
    await tx.execute(sql`
      INSERT INTO student_billing_discounts (student_id, amount_cents, reason, approved_by, approved_at, created_by, created_at)
      VALUES (${studentId}, ${input.amountCents}, ${input.reason}, ${actorId}, ${at.toISOString()}::timestamptz, ${actorId}, ${at.toISOString()}::timestamptz)`);
  },

  async replaceInstallments(tx, studentId, actorId, input, at) {
    await tx.execute(sql`DELETE FROM student_billing_installments WHERE student_id = ${studentId}`);
    let order = 0;
    for (const i of input.installments) {
      await tx.execute(sql`
        INSERT INTO student_billing_installments (student_id, due_date, amount_cents, label, sort_order, created_by, created_at)
        VALUES (${studentId}, ${i.dueDate}::date, ${i.amountCents}, ${i.label ?? null}, ${order++}, ${actorId}, ${at.toISOString()}::timestamptz)`);
    }
  },

  async insertReceipt(tx, studentId, actorId, input, evidenceId, at) {
    const [r] = rows(
      await tx.execute(sql`
        INSERT INTO student_billing_receipts (student_id, amount_cents, received_date, method_label, reference, note, evidence_id, confirmed_by, confirmed_at)
        VALUES (${studentId}, ${input.amountCents}, ${input.receivedDate}::date, ${input.methodLabel}, ${input.reference ?? null}, ${input.note ?? null}, ${evidenceId}, ${actorId}, ${at.toISOString()}::timestamptz)
        RETURNING id, amount_cents, received_date, method_label, reference, note, evidence_id, confirmed_by, confirmed_at`),
    );
    return toReceipt(r!);
  },

  async voidReceipt(tx, studentId, receiptId, actorId, reason, at) {
    return voidRow(tx, "student_billing_receipts", studentId, receiptId, actorId, reason, at);
  },

  async voidDiscount(tx, studentId, discountId, actorId, reason, at) {
    return voidRow(tx, "student_billing_discounts", studentId, discountId, actorId, reason, at);
  },

  async updateInstallment(tx, studentId, installmentId, patch) {
    const found = rows(await tx.execute(sql`SELECT id FROM student_billing_installments WHERE student_id = ${studentId} AND id::text = ${installmentId} FOR UPDATE`));
    if (!found.length) return false;
    await tx.execute(sql`
      UPDATE student_billing_installments SET
        due_date = COALESCE(${patch.dueDate ?? null}::date, due_date),
        amount_cents = COALESCE(${patch.amountCents ?? null}::bigint, amount_cents),
        label = CASE WHEN ${patch.label !== undefined} THEN ${patch.label ?? null} ELSE label END
      WHERE student_id = ${studentId} AND id::text = ${installmentId}`);
    return true;
  },

  async insertEvidence(tx, studentId, actorId, input, at) {
    const [r] = rows(
      await tx.execute(sql`
        INSERT INTO student_billing_evidence (student_id, document_id, note, submitted_at, created_by)
        VALUES (${studentId}, ${input.documentId}, ${input.note ?? null}, ${at.toISOString()}::timestamptz, ${actorId})
        RETURNING id, document_id, status, note, submitted_at, reviewed_by, reviewed_at, reject_reason, receipt_id`),
    );
    return toEvidence(r!);
  },

  async findEvidence(tx, studentId, evidenceId) {
    const [r] = rows(
      await tx.execute(sql`
        SELECT id, document_id, status, note, submitted_at, reviewed_by, reviewed_at, reject_reason, receipt_id
        FROM student_billing_evidence WHERE student_id = ${studentId} AND id::text = ${evidenceId} FOR UPDATE`),
    );
    return r ? toEvidence(r) : null;
  },

  async reviewEvidence(tx, evidenceId, review) {
    await tx.execute(sql`
      UPDATE student_billing_evidence
      SET status = ${review.status}, reviewed_by = ${review.actorId}, reviewed_at = ${review.at.toISOString()}::timestamptz,
          reject_reason = ${review.rejectReason}, receipt_id = ${review.receiptId}::uuid
      WHERE id::text = ${evidenceId}`);
  },
};
