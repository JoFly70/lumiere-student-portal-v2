/**
 * Pure billing summary math for the staff screens (student file card and billing page).
 * Everything is derived from the server's StaffBillingView; nothing is recomputed from floats.
 *   original agreed - adjustments (approved discounts) = net obligation
 *   net - paid (confirmed receipts only) = remaining (never negative; extra paid is credit)
 */
import type { StaffBillingView } from "@shared/billing-contract";

export type BillingStatus = "not_configured" | "unpaid" | "partially_paid" | "paid" | "overpaid";

export interface BillingSummary {
  readonly configured: boolean;
  readonly currency: string | null;
  readonly agreedCents: number;
  readonly adjustmentsCents: number;
  readonly netCents: number;
  readonly paidCents: number;
  readonly remainingCents: number;
  readonly creditCents: number;
  readonly status: BillingStatus;
}

export const BILLING_STATUS_LABEL: Readonly<Record<BillingStatus, string>> = {
  not_configured: "No amount set",
  unpaid: "Unpaid",
  partially_paid: "Partially paid",
  paid: "Paid in full",
  overpaid: "Overpaid",
};

export function billingStatusOf(netCents: number, paidCents: number): BillingStatus {
  if (paidCents <= 0) return netCents > 0 ? "unpaid" : "paid";
  if (paidCents < netCents) return "partially_paid";
  return paidCents > netCents ? "overpaid" : "paid";
}

export function summarizeBilling(view: StaffBillingView | undefined | null): BillingSummary {
  const s = view?.student;
  if (!s || s.state !== "configured") {
    return { configured: false, currency: null, agreedCents: 0, adjustmentsCents: 0, netCents: 0, paidCents: 0, remainingCents: 0, creditCents: 0, status: "not_configured" };
  }
  return {
    configured: true,
    currency: s.currency,
    agreedCents: s.agreedCents,
    adjustmentsCents: s.discountCents,
    netCents: s.netObligationCents,
    paidCents: s.paidCents,
    remainingCents: Math.max(0, s.netObligationCents - s.paidCents),
    creditCents: Math.max(0, s.paidCents - s.netObligationCents),
    status: billingStatusOf(s.netObligationCents, s.paidCents),
  };
}

export const BILLING_STATUS_TONE: Readonly<Record<BillingStatus, "neutral" | "attention" | "seal" | "gold" | "dashed">> = {
  not_configured: "dashed",
  unpaid: "attention",
  partially_paid: "gold",
  paid: "seal",
  overpaid: "attention",
};
