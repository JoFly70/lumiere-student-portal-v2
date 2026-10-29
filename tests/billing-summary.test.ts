import { describe, expect, it } from "vitest";
import { computeStaffBilling } from "../shared/billing-ledger";
import type { BillingLedgerData } from "../shared/billing-contract";
import { billingHistory, billingStatusOf, obligationFormProblem, summarizeBilling } from "../client/src/components/admin/billing/billing-summary";
import { parseMoneyToCents } from "../client/src/components/admin/billing/money";

const base: BillingLedgerData = {
  obligation: { agreedCents: 1_200_000, currency: "USD", note: "Contract v2" },
  discounts: [{ id: "d1", amountCents: 100_000, reason: "Early enrollment", approvedBy: "u1", approvedAt: "2026-09-02T10:00:00Z" }],
  installments: [],
  receipts: [{ id: "r1", amountCents: 400_000, receivedDate: "2026-09-10", methodLabel: "Bank transfer", reference: "REF1", note: null, confirmedBy: "u1", confirmedAt: "2026-09-10T09:00:00Z", evidenceId: null }],
  evidence: [{ id: "e1", documentId: "doc1", status: "rejected", note: "Blurry", submittedAt: "2026-09-11T08:00:00Z", reviewedBy: "u1", reviewedAt: "2026-09-11T12:00:00Z", rejectReason: "Unreadable", receiptId: null }],
  voidedReceipts: [{ id: "r0", amountCents: 50_000, receivedDate: "2026-09-05", methodLabel: "Cash", reference: null, note: null, confirmedBy: "u1", confirmedAt: "2026-09-05T09:00:00Z", evidenceId: null, voidedAt: "2026-09-06T09:00:00Z", voidedBy: "u1", voidReason: "Entered twice" }],
  voidedDiscounts: [],
};

describe("billing summary math", () => {
  it("agreed - adjustments = net; net - paid = remaining; status partially paid", () => {
    const s = summarizeBilling(computeStaffBilling(base, "2026-10-01"));
    expect(s).toMatchObject({ configured: true, currency: "USD", agreedCents: 1_200_000, adjustmentsCents: 100_000, netCents: 1_100_000, paidCents: 400_000, remainingCents: 700_000, creditCents: 0, status: "partially_paid" });
  });
  it("voided receipts never count as paid", () => {
    expect(summarizeBilling(computeStaffBilling(base, "2026-10-01")).paidCents).toBe(400_000);
  });
  it("unpaid, paid in full, overpaid", () => {
    expect(billingStatusOf(1000, 0)).toBe("unpaid");
    expect(billingStatusOf(1000, 999)).toBe("partially_paid");
    expect(billingStatusOf(1000, 1000)).toBe("paid");
    expect(billingStatusOf(1000, 1500)).toBe("overpaid");
    const over = summarizeBilling(computeStaffBilling({ ...base, receipts: [{ ...base.receipts[0]!, amountCents: 1_300_000 }] }, "2026-10-01"));
    expect(over).toMatchObject({ remainingCents: 0, creditCents: 200_000, status: "overpaid" });
  });
  it("no obligation is 'not configured' and carries no numbers", () => {
    const s = summarizeBilling(computeStaffBilling({ ...base, obligation: null, discounts: [], receipts: [], voidedReceipts: [], evidence: [] }, "2026-10-01"));
    expect(s).toMatchObject({ configured: false, status: "not_configured", netCents: 0, remainingCents: 0 });
    expect(summarizeBilling(undefined).configured).toBe(false);
  });
  it("the staff view carries the obligation note for round-trip edits", () => {
    expect(computeStaffBilling(base, "2026-10-01").obligationNote).toBe("Contract v2");
  });
});

describe("billing history", () => {
  it("lists payments, voids, adjustments and evidence newest first, keeping voided entries", () => {
    const h = billingHistory(computeStaffBilling(base, "2026-10-01"));
    expect(h.map((x) => x.kind)).toEqual(["evidence_rejected", "evidence_submitted", "payment", "payment_voided", "payment", "adjustment"]);
    expect(h.find((x) => x.kind === "payment_voided")?.detail).toBe("Entered twice");
    expect(h.find((x) => x.kind === "evidence_rejected")?.detail).toBe("Unreadable");
  });
});

describe("agreed price form checks", () => {
  const f = (amountText: string, currency = "USD", discountCents = 0) => obligationFormProblem({ amountText, currency, cents: parseMoneyToCents(amountText, currency), discountCents });
  it("accepts a valid amount and explains each failure", () => {
    expect(f("12,000.00")).toBeNull();
    expect(f("")).toMatch(/Enter the agreed/);
    expect(f("12x")).toMatch(/positive amount/);
    expect(f("0")).toMatch(/positive amount/);
    expect(f("10", "US")).toMatch(/3-letter/);
    expect(f("500", "USD", 100_000)).toMatch(/lower than the discounts/);
  });
});
