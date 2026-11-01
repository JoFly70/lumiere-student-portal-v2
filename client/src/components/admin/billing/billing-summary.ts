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

// ── history ─────────────────────────────────────────────────────────────────

export type BillingHistoryKind =
  | "payment" | "payment_voided" | "adjustment" | "adjustment_voided"
  | "evidence_submitted" | "evidence_confirmed" | "evidence_rejected";

export interface BillingHistoryEntry {
  readonly id: string;
  readonly at: string;
  readonly kind: BillingHistoryKind;
  readonly title: string;
  readonly detail: string;
  /** Minor units, when the entry concerns money. */
  readonly amountCents: number | null;
  /** S32-B: id of the staff member behind the entry (null when the ledger does not record one). Resolve with StaffBillingView.actorNames. */
  readonly actorId: string | null;
  /** S32-B: how `detail` should be rendered. "free" is staff-written text shown as is; the others are localized by the screen. */
  readonly detailKind: "free" | "payment" | "evidenceSupporting" | "evidenceCounted" | "evidenceNoReason";
  /** For detailKind "payment": the pieces of the English `detail`. */
  readonly payment?: { readonly methodLabel: string; readonly reference: string | null; readonly receivedDate: string };
}

/** One chronological audit list (newest first) of everything staff did on the ledger. Voided entries stay visible. */
export function billingHistory(view: StaffBillingView): BillingHistoryEntry[] {
  const out: BillingHistoryEntry[] = [];
  const pay = (r: { methodLabel: string; reference: string | null; receivedDate: string }) =>
    `${r.methodLabel}${r.reference ? ` · ref. ${r.reference}` : ""} · received ${r.receivedDate}`;
  const payment = (r: { id: string; methodLabel: string; reference: string | null; receivedDate: string; confirmedAt: string; confirmedBy: string; amountCents: number }): BillingHistoryEntry => ({
    id: `r-${r.id}`, at: r.confirmedAt, kind: "payment", title: "Payment confirmed", detail: pay(r), amountCents: r.amountCents, actorId: r.confirmedBy || null, detailKind: "payment",
    payment: { methodLabel: r.methodLabel, reference: r.reference, receivedDate: r.receivedDate },
  });
  const adjustment = (d: { id: string; approvedAt: string; approvedBy: string; reason: string; amountCents: number }): BillingHistoryEntry =>
    ({ id: `d-${d.id}`, at: d.approvedAt, kind: "adjustment", title: "Adjustment approved", detail: d.reason, amountCents: d.amountCents, actorId: d.approvedBy || null, detailKind: "free" });
  for (const r of view.receipts) out.push(payment(r));
  for (const r of view.voidedReceipts) {
    out.push(payment(r));
    out.push({ id: `rv-${r.id}`, at: r.voidedAt, kind: "payment_voided", title: "Payment voided", detail: r.voidReason, amountCents: r.amountCents, actorId: r.voidedBy || null, detailKind: "free" });
  }
  for (const d of view.discounts) out.push(adjustment(d));
  for (const d of view.voidedDiscounts) {
    out.push(adjustment(d));
    out.push({ id: `dv-${d.id}`, at: d.voidedAt, kind: "adjustment_voided", title: "Adjustment voided", detail: d.voidReason, amountCents: d.amountCents, actorId: d.voidedBy || null, detailKind: "free" });
  }
  for (const e of view.evidence) {
    out.push({ id: `e-${e.id}`, at: e.submittedAt, kind: "evidence_submitted", title: "Evidence registered", detail: e.note ?? "Supporting file attached for review", amountCents: null, actorId: null, detailKind: e.note ? "free" : "evidenceSupporting" });
    if (e.status === "confirmed" && e.reviewedAt) out.push({ id: `ec-${e.id}`, at: e.reviewedAt, kind: "evidence_confirmed", title: "Evidence confirmed as a payment", detail: "Counted as paid", amountCents: null, actorId: e.reviewedBy, detailKind: "evidenceCounted" });
    if (e.status === "rejected" && e.reviewedAt) out.push({ id: `ex-${e.id}`, at: e.reviewedAt, kind: "evidence_rejected", title: "Evidence rejected", detail: e.rejectReason ?? "No reason recorded", amountCents: null, actorId: e.reviewedBy, detailKind: e.rejectReason ? "free" : "evidenceNoReason" });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
}

export type ObligationProblemKind = "currency" | "amountEmpty" | "amountInvalid" | "belowDiscounts";

/** Field-level check for the agreed-price form, as a code the screen can localize. Null when valid. */
export function obligationFormProblemKind(f: { amountText: string; currency: string; cents: number | null; discountCents: number }): ObligationProblemKind | null {
  if (!/^[A-Za-z]{3}$/.test(f.currency.trim())) return "currency";
  if (f.amountText.trim() === "") return "amountEmpty";
  if (f.cents === null) return "amountInvalid";
  if (f.cents < f.discountCents) return "belowDiscounts";
  return null;
}

const OBLIGATION_PROBLEM_TEXT: Record<ObligationProblemKind, string> = {
  currency: "Currency must be a 3-letter code such as USD or EUR.",
  amountEmpty: "Enter the agreed program price.",
  amountInvalid: "Enter a positive amount, for example 12000.00.",
  belowDiscounts: "The agreed price cannot be lower than the discounts already approved.",
};

/** Field-level checks for the agreed-price form (English text). Returns a message, or null when valid. `cents` is the parsed amount (null when unparseable). */
export function obligationFormProblem(f: { amountText: string; currency: string; cents: number | null; discountCents: number }): string | null {
  const kind = obligationFormProblemKind(f);
  return kind ? OBLIGATION_PROBLEM_TEXT[kind] : null;
}
