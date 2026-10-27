/**
 * SYNTHETIC billing fixtures for the S18 screenshots and UI checks. Invented student, invented
 * amounts, no real person or account. Views are computed with the real ledger (shared/billing-ledger)
 * from a fixed "today", so every number on screen is internally consistent.
 */
import type { BillingLedgerData, StudentBillingView } from "../../shared/billing-contract";
import { computeStudentBilling } from "../../shared/billing-ledger";

export const BILLING_FIXTURE_TODAY = "2026-10-27";
export const BILLING_FIXTURE_LABEL = "SYNTHETIC FIXTURE: invented student and amounts";

const base: BillingLedgerData = {
  obligation: { agreedCents: 1_200_000, currency: "USD", note: null },
  discounts: [{ id: "d1", amountCents: 120_000, reason: "Synthetic early enrollment", approvedBy: "staff", approvedAt: "2026-08-20T00:00:00.000Z" }],
  installments: [
    { id: "i1", dueDate: "2026-09-01", amountCents: 270_000, label: "Deposit", sortOrder: 0 },
    { id: "i2", dueDate: "2026-10-01", amountCents: 270_000, label: null, sortOrder: 1 },
    { id: "i3", dueDate: "2026-11-15", amountCents: 270_000, label: null, sortOrder: 2 },
    { id: "i4", dueDate: "2027-01-15", amountCents: 270_000, label: null, sortOrder: 3 },
  ],
  receipts: [
    { id: "r1", amountCents: 270_000, receivedDate: "2026-08-28", methodLabel: "Bank transfer", reference: null, note: null, confirmedBy: "staff", confirmedAt: "2026-08-29T09:00:00.000Z", evidenceId: null },
    { id: "r2", amountCents: 135_000, receivedDate: "2026-10-04", methodLabel: "Bank transfer", reference: null, note: null, confirmedBy: "staff", confirmedAt: "2026-10-05T09:00:00.000Z", evidenceId: "e0" },
  ],
  evidence: [
    { id: "e1", documentId: "doc-synthetic-1", status: "awaiting_review", note: null, submittedAt: "2026-10-25T12:00:00.000Z", reviewedBy: null, reviewedAt: null, rejectReason: null, receiptId: null },
  ],
};

/** Partly paid, one installment overdue, one receipt awaiting review. */
export const BILLING_CONFIGURED: StudentBillingView = computeStudentBilling(base, BILLING_FIXTURE_TODAY);
/** No ledger yet: the view carries no numbers. */
export const BILLING_NOT_CONFIGURED: StudentBillingView = computeStudentBilling({ obligation: null, discounts: [], installments: [], receipts: [], evidence: [] }, BILLING_FIXTURE_TODAY);
