/**
 * S18 billing contract: a small, Portal-owned, staff-entered ledger.
 *
 * Rules (enforced by shared/billing-ledger.ts and the staff schemas below):
 *  - Money is an INTEGER number of minor units (cents) plus an ISO 4217 currency. No floats anywhere.
 *  - The obligation is the agreed program price. Approved discounts reduce it.
 *  - Installments are a SCHEDULE that allocates the obligation. They are never extra debt.
 *  - Only staff-confirmed receipts count as paid.
 *  - Evidence a student submitted (a document id) never counts as paid until staff
 *    confirms it as a receipt.
 *  - A student with no obligation is "not_configured": the view carries NO numbers.
 *
 * There is no payment gateway and no card handling anywhere in this ledger.
 */
import { z } from "zod";

// ── primitives ──────────────────────────────────────────────────────────────

/** Largest single amount accepted (1 billion major units). Keeps sums inside Number.MAX_SAFE_INTEGER. */
export const MAX_CENTS = 100_000_000_000;

export const centsSchema = z
  .number({ error: "Amount must be a whole number of cents" })
  .int("Amount must be a whole number of cents")
  .positive("Amount must be greater than zero")
  .max(MAX_CENTS);

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code");

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isoDateSchema = z
  .string()
  .regex(ISO_DATE_RE, "Date must be YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Not a real calendar date");

const shortText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();

// ── staff inputs (strict: unknown keys, including studentId, are rejected) ──

export const setObligationSchema = z
  .object({ agreedCents: centsSchema, currency: currencySchema, note: optionalText(500) })
  .strict();

export const addDiscountSchema = z
  .object({ amountCents: centsSchema, reason: shortText(300) })
  .strict();

export const setInstallmentsSchema = z
  .object({
    installments: z
      .array(z.object({ dueDate: isoDateSchema, amountCents: centsSchema, label: optionalText(120) }).strict())
      .max(120),
  })
  .strict();

export const recordReceiptSchema = z
  .object({
    amountCents: centsSchema,
    receivedDate: isoDateSchema,
    /** Free text such as "Bank transfer" or "Cheque". Not a payment instrument. */
    methodLabel: shortText(80),
    reference: optionalText(120),
    note: optionalText(500),
  })
  .strict();

export const registerEvidenceSchema = z
  .object({ documentId: shortText(128), note: optionalText(500) })
  .strict();

/** S19 corrections: never delete; a reason is always required. */
export const voidEntrySchema = z.object({ reason: shortText(300) }).strict();
export const updateInstallmentSchema = z
  .object({ dueDate: isoDateSchema.optional(), amountCents: centsSchema.optional(), label: z.string().trim().max(120).nullable().optional() })
  .strict()
  .refine((v) => v.dueDate !== undefined || v.amountCents !== undefined || v.label !== undefined, "Nothing to change");

export const rejectEvidenceSchema = z.object({ reason: shortText(300) }).strict();

export type SetObligationInput = z.infer<typeof setObligationSchema>;
export type AddDiscountInput = z.infer<typeof addDiscountSchema>;
export type SetInstallmentsInput = z.infer<typeof setInstallmentsSchema>;
export type RecordReceiptInput = z.infer<typeof recordReceiptSchema>;
export type RegisterEvidenceInput = z.infer<typeof registerEvidenceSchema>;
export type VoidEntryInput = z.infer<typeof voidEntrySchema>;
export type UpdateInstallmentInput = z.infer<typeof updateInstallmentSchema>;
export type RejectEvidenceInput = z.infer<typeof rejectEvidenceSchema>;

// ── stored ledger rows (what the repository returns) ────────────────────────

export interface BillingObligation {
  readonly agreedCents: number;
  readonly currency: string;
  readonly note: string | null;
}
export interface BillingDiscount {
  readonly id: string;
  readonly amountCents: number;
  readonly reason: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
}
export interface BillingInstallmentRow {
  readonly id: string;
  readonly dueDate: string;
  readonly amountCents: number;
  readonly label: string | null;
  readonly sortOrder: number;
}
export interface BillingReceiptRow {
  readonly id: string;
  readonly amountCents: number;
  readonly receivedDate: string;
  readonly methodLabel: string;
  readonly reference: string | null;
  readonly note: string | null;
  readonly confirmedBy: string;
  readonly confirmedAt: string;
  readonly evidenceId: string | null;
}
export interface VoidInfo {
  readonly voidedAt: string;
  readonly voidedBy: string;
  readonly voidReason: string;
}
export type BillingVoidedReceipt = BillingReceiptRow & VoidInfo;
export type BillingVoidedDiscount = BillingDiscount & VoidInfo;
export type BillingEvidenceStatus = "awaiting_review" | "confirmed" | "rejected";
export interface BillingEvidenceRow {
  readonly id: string;
  readonly documentId: string;
  readonly status: BillingEvidenceStatus;
  readonly note: string | null;
  readonly submittedAt: string;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly rejectReason: string | null;
  readonly receiptId: string | null;
}
export interface BillingLedgerData {
  readonly obligation: BillingObligation | null;
  readonly discounts: readonly BillingDiscount[];
  readonly installments: readonly BillingInstallmentRow[];
  readonly receipts: readonly BillingReceiptRow[];
  readonly evidence: readonly BillingEvidenceRow[];
  /** S19: voided entries are kept for the audit trail and never counted. */
  readonly voidedReceipts?: readonly BillingVoidedReceipt[];
  readonly voidedDiscounts?: readonly BillingVoidedDiscount[];
}

// ── derived views ───────────────────────────────────────────────────────────

export type InstallmentStatus = "paid" | "partially_paid" | "due" | "overdue" | "upcoming";

export interface StudentInstallment {
  readonly id: string;
  readonly dueDate: string;
  readonly amountCents: number;
  readonly label: string | null;
  /** How much of this installment is covered by receipts (oldest installment first). */
  readonly allocatedCents: number;
  readonly status: InstallmentStatus;
}
export interface StudentReceipt {
  readonly id: string;
  readonly amountCents: number;
  readonly receivedDate: string;
  readonly methodLabel: string;
}
/** Evidence a student submitted. Deliberately carries no amount: it is not money received. */
export interface StudentEvidenceItem {
  readonly id: string;
  readonly documentId: string;
  readonly submittedAt: string;
}
export interface NextDue {
  readonly installmentId: string;
  readonly dueDate: string;
  /** Unpaid part of that installment. */
  readonly amountCents: number;
  readonly status: InstallmentStatus;
}

export interface StudentBillingNotConfigured {
  readonly state: "not_configured";
  readonly currency: null;
  readonly agreedCents: null;
  readonly discountCents: null;
  readonly netObligationCents: null;
  readonly paidCents: null;
  readonly remainingCents: null;
  readonly overpaid: null;
  readonly creditCents: null;
  readonly nextDue: null;
  readonly installments: readonly [];
  readonly receipts: readonly [];
  readonly evidenceAwaitingReview: readonly StudentEvidenceItem[];
}
export interface StudentBillingConfigured {
  readonly state: "configured";
  readonly currency: string;
  readonly agreedCents: number;
  readonly discountCents: number;
  readonly netObligationCents: number;
  readonly paidCents: number;
  /** max(0, net - paid). */
  readonly remainingCents: number;
  readonly overpaid: boolean;
  /** paid - net when overpaid, else 0. */
  readonly creditCents: number;
  readonly nextDue: NextDue | null;
  readonly installments: readonly StudentInstallment[];
  /** Payment history, newest first. */
  readonly receipts: readonly StudentReceipt[];
  readonly evidenceAwaitingReview: readonly StudentEvidenceItem[];
}
export type StudentBillingView = StudentBillingNotConfigured | StudentBillingConfigured;

export interface StaffBillingView {
  readonly student: StudentBillingView;
  readonly discounts: readonly BillingDiscount[];
  readonly receipts: readonly BillingReceiptRow[];
  readonly evidence: readonly BillingEvidenceRow[];
  readonly voidedReceipts: readonly BillingVoidedReceipt[];
  readonly voidedDiscounts: readonly BillingVoidedDiscount[];
  /** Sum of scheduled installments. */
  readonly scheduledCents: number;
  /** scheduled - net obligation. 0 when the schedule allocates the obligation exactly; staff-visible flag otherwise. */
  readonly scheduleMismatchCents: number;
}

// ── errors ──────────────────────────────────────────────────────────────────

export const BILLING_ERROR_CODES = {
  VALIDATION: "BILLING_VALIDATION_FAILED",
  STUDENT_ID_NOT_ACCEPTED: "BILLING_STUDENT_ID_NOT_ACCEPTED",
  NOT_CONFIGURED: "BILLING_NOT_CONFIGURED",
  STUDENT_NOT_FOUND: "BILLING_STUDENT_NOT_FOUND",
  EVIDENCE_NOT_FOUND: "BILLING_EVIDENCE_NOT_FOUND",
  EVIDENCE_ALREADY_REVIEWED: "BILLING_EVIDENCE_ALREADY_REVIEWED",
  DISCOUNT_EXCEEDS_OBLIGATION: "BILLING_DISCOUNT_EXCEEDS_OBLIGATION",
  RECEIPT_NOT_FOUND: "BILLING_RECEIPT_NOT_FOUND",
  DISCOUNT_NOT_FOUND: "BILLING_DISCOUNT_NOT_FOUND",
  INSTALLMENT_NOT_FOUND: "BILLING_INSTALLMENT_NOT_FOUND",
  ALREADY_VOIDED: "BILLING_ALREADY_VOIDED",
  UNAVAILABLE: "BILLING_UNAVAILABLE",
} as const;
export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES];

// ── money formatting (pure; shared by server logs and the UI) ───────────────

/** Minor-unit exponent of a currency (2 for USD/EUR, 0 for JPY). */
export function currencyExponent(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function formatMoney(cents: number, currency: string, locale = "en-US"): string {
  const exp = currencyExponent(currency);
  const major = cents / 10 ** exp;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(major);
  } catch {
    return `${major.toFixed(exp)} ${currency}`;
  }
}
