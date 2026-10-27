/**
 * S18 billing ledger: pure computation rules. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import {
  addDiscountSchema,
  formatMoney,
  recordReceiptSchema,
  setInstallmentsSchema,
  setObligationSchema,
  type BillingLedgerData,
} from "../shared/billing-contract";
import { allocateReceipts, assertCents, computeStaffBilling, computeStudentBilling, installmentStatus } from "../shared/billing-ledger";

const TODAY = "2026-10-27";
const EMPTY: BillingLedgerData = { obligation: null, discounts: [], installments: [], receipts: [], evidence: [] };

let n = 0;
const id = () => `id-${++n}`;
const ob = (agreedCents: number, currency = "USD") => ({ agreedCents, currency, note: null });
const disc = (amountCents: number) => ({ id: id(), amountCents, reason: "Approved scholarship", approvedBy: "staff-1", approvedAt: "2026-09-01T00:00:00.000Z" });
const inst = (dueDate: string, amountCents: number, sortOrder = 0) => ({ id: id(), dueDate, amountCents, label: null, sortOrder });
const rcpt = (amountCents: number, receivedDate = "2026-09-15", evidenceId: string | null = null) => ({
  id: id(), amountCents, receivedDate, methodLabel: "Bank transfer", reference: null, note: null, confirmedBy: "staff-1",
  confirmedAt: `${receivedDate}T10:00:00.000Z`, evidenceId,
});
const evid = (status: "awaiting_review" | "confirmed" | "rejected" = "awaiting_review") => ({
  id: id(), documentId: "doc-1", status, note: null, submittedAt: "2026-10-01T00:00:00.000Z",
  reviewedBy: null, reviewedAt: null, rejectReason: null, receiptId: null,
});
const ledger = (p: Partial<BillingLedgerData>): BillingLedgerData => ({ ...EMPTY, ...p });

describe("not configured", () => {
  it("has no numbers at all, not zeros", () => {
    const v = computeStudentBilling(EMPTY, TODAY);
    expect(v.state).toBe("not_configured");
    for (const k of ["currency", "agreedCents", "discountCents", "netObligationCents", "paidCents", "remainingCents", "overpaid", "creditCents", "nextDue"] as const) {
      expect(v[k]).toBeNull();
    }
    expect(v.installments).toEqual([]);
    expect(v.receipts).toEqual([]);
  });

  it("ignores schedule, discounts and receipts that exist without an obligation", () => {
    const v = computeStudentBilling(ledger({ discounts: [disc(500)], installments: [inst("2026-11-01", 1000)], receipts: [rcpt(1000)] }), TODAY);
    expect(v.state).toBe("not_configured");
    expect(v.paidCents).toBeNull();
    expect(v.installments).toEqual([]);
  });

  it("still lists evidence awaiting review, without any amount", () => {
    const v = computeStudentBilling(ledger({ evidence: [evid()] }), TODAY);
    expect(v.evidenceAwaitingReview).toHaveLength(1);
    expect(Object.keys(v.evidenceAwaitingReview[0]!).sort()).toEqual(["documentId", "id", "submittedAt"]);
  });
});

describe("obligation, discounts and totals", () => {
  it("net = agreed - discounts, remaining = net - paid", () => {
    const v = computeStudentBilling(ledger({ obligation: ob(1_000_000), discounts: [disc(100_000), disc(50_000)], receipts: [rcpt(200_000), rcpt(100_000)] }), TODAY);
    expect(v).toMatchObject({ state: "configured", agreedCents: 1_000_000, discountCents: 150_000, netObligationCents: 850_000, paidCents: 300_000, remainingCents: 550_000, overpaid: false, creditCents: 0, currency: "USD" });
  });

  it("a fresh obligation with nothing paid owes the full net (a real 0 paid, not null)", () => {
    const v = computeStudentBilling(ledger({ obligation: ob(500_00) }), TODAY);
    expect(v).toMatchObject({ state: "configured", paidCents: 0, remainingCents: 500_00, nextDue: null });
  });

  it("discounts larger than the price floor net at 0", () => {
    const v = computeStudentBilling(ledger({ obligation: ob(1000), discounts: [disc(1500)] }), TODAY);
    expect(v).toMatchObject({ netObligationCents: 0, remainingCents: 0 });
  });

  it("overpayment floors remaining at 0 and reports credit", () => {
    const v = computeStudentBilling(ledger({ obligation: ob(1000), receipts: [rcpt(1000), rcpt(250)] }), TODAY);
    expect(v).toMatchObject({ remainingCents: 0, overpaid: true, creditCents: 250, paidCents: 1250, nextDue: null });
  });

  it("exactly paid is not overpaid", () => {
    const v = computeStudentBilling(ledger({ obligation: ob(1000), receipts: [rcpt(1000)] }), TODAY);
    expect(v).toMatchObject({ overpaid: false, creditCents: 0, remainingCents: 0 });
  });
});

describe("the schedule is not extra debt", () => {
  it("installments summing to more or less than the net never change remaining", () => {
    const base = { obligation: ob(900_00), receipts: [rcpt(100_00)] };
    const exact = computeStudentBilling(ledger({ ...base, installments: [inst("2026-11-01", 450_00), inst("2026-12-01", 450_00)] }), TODAY);
    const over = computeStudentBilling(ledger({ ...base, installments: [inst("2026-11-01", 900_00), inst("2026-12-01", 900_00)] }), TODAY);
    const none = computeStudentBilling(ledger({ ...base }), TODAY);
    for (const v of [exact, over, none]) expect(v).toMatchObject({ netObligationCents: 900_00, remainingCents: 800_00, paidCents: 100_00 });
  });

  it("staff view flags a schedule that does not allocate the net obligation", () => {
    const ok = computeStaffBilling(ledger({ obligation: ob(1000), installments: [inst("2026-11-01", 400), inst("2026-12-01", 600)] }), TODAY);
    expect(ok.scheduleMismatchCents).toBe(0);
    const high = computeStaffBilling(ledger({ obligation: ob(1000), installments: [inst("2026-11-01", 1500)] }), TODAY);
    expect(high.scheduleMismatchCents).toBe(500);
    expect(high.student.remainingCents).toBe(1000);
    const discounted = computeStaffBilling(ledger({ obligation: ob(1000), discounts: [disc(100)], installments: [inst("2026-11-01", 900)] }), TODAY);
    expect(discounted.scheduleMismatchCents).toBe(0);
    expect(computeStaffBilling(ledger({ obligation: ob(1000) }), TODAY).scheduleMismatchCents).toBe(0);
  });
});

describe("evidence is never money", () => {
  it("evidence in any status leaves paid/remaining untouched", () => {
    const base = { obligation: ob(1000), installments: [inst("2026-10-01", 1000)] };
    const without = computeStudentBilling(ledger(base), TODAY);
    const withEvidence = computeStudentBilling(ledger({ ...base, evidence: [evid("awaiting_review"), evid("rejected"), evid("confirmed")] }), TODAY);
    expect(withEvidence.paidCents).toBe(0);
    expect(withEvidence.remainingCents).toBe(1000);
    expect(withEvidence.installments).toEqual(without.installments);
    expect(withEvidence.nextDue).toEqual(without.nextDue);
    expect(withEvidence.receipts).toEqual([]);
  });

  it("only awaiting_review evidence is listed for the student", () => {
    const a = evid("awaiting_review");
    const v = computeStudentBilling(ledger({ obligation: ob(1000), evidence: [a, evid("rejected"), evid("confirmed")] }), TODAY);
    expect(v.evidenceAwaitingReview.map((e) => e.id)).toEqual([a.id]);
  });

  it("once staff confirm it as a receipt, it counts", () => {
    const v = computeStudentBilling(ledger({ obligation: ob(1000), evidence: [evid("confirmed")], receipts: [rcpt(400, "2026-10-02", "ev")] }), TODAY);
    expect(v.paidCents).toBe(400);
    expect(v.remainingCents).toBe(600);
  });
});

describe("allocation and status", () => {
  const schedule = [inst("2026-09-01", 300), inst("2026-10-01", 300), inst("2026-11-01", 300), inst("2026-12-01", 300)];

  it("allocates receipts oldest installment first, regardless of input order", () => {
    const shuffled = [schedule[3]!, schedule[0]!, schedule[2]!, schedule[1]!];
    const out = allocateReceipts(shuffled, 700, TODAY);
    expect(out.map((i) => i.dueDate)).toEqual(["2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01"]);
    expect(out.map((i) => i.allocatedCents)).toEqual([300, 300, 100, 0]);
  });

  it("a partial payment leaves the first installment partially covered; next due is the unpaid remainder", () => {
    const v = computeStudentBilling(ledger({ obligation: ob(1200), installments: schedule, receipts: [rcpt(100)] }), "2026-08-15");
    expect(v.installments[0]).toMatchObject({ allocatedCents: 100, status: "partially_paid" });
    expect(v.nextDue).toMatchObject({ dueDate: "2026-09-01", amountCents: 200, status: "partially_paid" });
  });

  it("many receipts accumulate across installments", () => {
    const v = computeStudentBilling(ledger({ obligation: ob(1200), installments: schedule, receipts: [rcpt(150), rcpt(150), rcpt(100)] }), "2026-08-15");
    expect(v.installments.map((i) => i.status)).toEqual(["paid", "partially_paid", "upcoming", "upcoming"]);
    expect(v.nextDue).toMatchObject({ dueDate: "2026-10-01", amountCents: 200 });
  });

  it("next due is the earliest installment not fully covered (skips paid ones)", () => {
    const v = computeStudentBilling(ledger({ obligation: ob(1200), installments: schedule, receipts: [rcpt(600)] }), TODAY);
    expect(v.nextDue).toMatchObject({ dueDate: "2026-11-01", amountCents: 300, status: "upcoming" });
  });

  it("everything covered means no next due", () => {
    const v = computeStudentBilling(ledger({ obligation: ob(1200), installments: schedule, receipts: [rcpt(1200)] }), TODAY);
    expect(v.nextDue).toBeNull();
    expect(v.installments.every((i) => i.status === "paid")).toBe(true);
  });

  it("an overpayment beyond the schedule is not allocated twice", () => {
    const out = allocateReceipts(schedule, 5000, TODAY);
    expect(out.reduce((a, i) => a + i.allocatedCents, 0)).toBe(1200);
  });

  it("when the net is covered nothing is due even if the schedule was larger", () => {
    const v = computeStudentBilling(ledger({ obligation: ob(500), installments: [inst("2026-10-01", 900)], receipts: [rcpt(500)] }), TODAY);
    expect(v.remainingCents).toBe(0);
    expect(v.nextDue).toBeNull();
  });

  it("overdue is decided by date only", () => {
    expect(installmentStatus("2026-10-26", 100, 0, TODAY)).toBe("overdue");
    expect(installmentStatus("2026-10-27", 100, 0, TODAY)).toBe("due");
    expect(installmentStatus("2026-10-28", 100, 0, TODAY)).toBe("upcoming");
    expect(installmentStatus("2026-10-28", 100, 40, TODAY)).toBe("partially_paid");
    expect(installmentStatus("2026-10-26", 100, 40, TODAY)).toBe("overdue");
    expect(installmentStatus("2026-10-26", 100, 100, TODAY)).toBe("paid");
    expect(installmentStatus("2026-12-26", 100, 100, TODAY)).toBe("paid");
  });

  it("moving today forward turns upcoming into due and overdue without touching money", () => {
    const l = ledger({ obligation: ob(1200), installments: schedule });
    const early = computeStudentBilling(l, "2026-08-31");
    const late = computeStudentBilling(l, "2026-10-15");
    expect(early.installments.map((i) => i.status)).toEqual(["upcoming", "upcoming", "upcoming", "upcoming"]);
    expect(late.installments.map((i) => i.status)).toEqual(["overdue", "overdue", "upcoming", "upcoming"]);
    expect(late.nextDue).toMatchObject({ dueDate: "2026-09-01", status: "overdue" });
    expect(late.remainingCents).toBe(early.remainingCents);
  });

  it("payment history is newest first", () => {
    const v = computeStudentBilling(ledger({ obligation: ob(1000), receipts: [rcpt(100, "2026-09-01"), rcpt(200, "2026-10-01"), rcpt(300, "2026-09-20")] }), TODAY);
    expect(v.receipts.map((r) => r.receivedDate)).toEqual(["2026-10-01", "2026-09-20", "2026-09-01"]);
  });
});

describe("student projection is an allow-list", () => {
  it("carries no staff fields", () => {
    const v = computeStudentBilling(ledger({ obligation: { agreedCents: 1000, currency: "USD", note: "STAFF NOTE" }, discounts: [disc(100)], receipts: [{ ...rcpt(100), reference: "REF-SECRET", note: "internal" }], evidence: [evid()] }), TODAY);
    const json = JSON.stringify(v);
    for (const secret of ["STAFF NOTE", "REF-SECRET", "internal", "staff-1", "Approved scholarship", "confirmedBy", "approvedBy"]) expect(json).not.toContain(secret);
  });
});

describe("integer cents only", () => {
  it("assertCents rejects floats, negatives, NaN and unsafe numbers", () => {
    for (const bad of [10.5, -1, NaN, Infinity, 2 ** 60, "100", null, undefined]) expect(() => assertCents(bad, "x")).toThrow(TypeError);
    expect(() => assertCents(0, "x")).not.toThrow();
    expect(() => assertCents(12345, "x")).not.toThrow();
  });

  it("the ledger refuses stored float amounts instead of rounding them", () => {
    expect(() => computeStudentBilling(ledger({ obligation: ob(100.5) }), TODAY)).toThrow(TypeError);
    expect(() => computeStudentBilling(ledger({ obligation: ob(1000), receipts: [rcpt(0.1)] }), TODAY)).toThrow(TypeError);
    expect(() => computeStudentBilling(ledger({ obligation: ob(1000), installments: [inst("2026-11-01", 33.3)] }), TODAY)).toThrow(TypeError);
  });

  it("0.1 + 0.2 style drift cannot happen: sums are exact integers", () => {
    const v = computeStudentBilling(ledger({ obligation: ob(30), receipts: [rcpt(10), rcpt(20)] }), TODAY);
    expect(v.paidCents).toBe(30);
    expect(v.remainingCents).toBe(0);
  });

  it("staff schemas reject floats, zero, negatives, strings and unknown keys", () => {
    const ok = { agreedCents: 100000, currency: "usd" };
    expect(setObligationSchema.parse(ok).currency).toBe("USD");
    for (const bad of [{ ...ok, agreedCents: 1000.5 }, { ...ok, agreedCents: 0 }, { ...ok, agreedCents: -5 }, { ...ok, agreedCents: "1000" }, { ...ok, currency: "US" }, { ...ok, studentId: "x" }, { ...ok, paid: 5 }]) {
      expect(setObligationSchema.safeParse(bad).success).toBe(false);
    }
    expect(addDiscountSchema.safeParse({ amountCents: 12.3, reason: "x" }).success).toBe(false);
    expect(addDiscountSchema.safeParse({ amountCents: 100, reason: "  " }).success).toBe(false);
    expect(recordReceiptSchema.safeParse({ amountCents: 100.01, receivedDate: "2026-10-01", methodLabel: "Cash" }).success).toBe(false);
    expect(recordReceiptSchema.safeParse({ amountCents: 100, receivedDate: "2026-02-30", methodLabel: "Cash" }).success).toBe(false);
    expect(recordReceiptSchema.safeParse({ amountCents: 100, receivedDate: "10/01/2026", methodLabel: "Cash" }).success).toBe(false);
    expect(recordReceiptSchema.safeParse({ amountCents: 100, receivedDate: "2026-10-01", methodLabel: "Cash" }).success).toBe(true);
    expect(setInstallmentsSchema.safeParse({ installments: [{ dueDate: "2026-11-01", amountCents: 50.5 }] }).success).toBe(false);
    expect(setInstallmentsSchema.safeParse({ installments: [{ dueDate: "2026-11-01", amountCents: 50 }] }).success).toBe(true);
  });

  it("the receipt schema accepts no card or gateway fields", () => {
    for (const extra of [{ cardNumber: "4242" }, { stripePaymentIntent: "pi_1" }, { token: "t" }]) {
      expect(recordReceiptSchema.safeParse({ amountCents: 100, receivedDate: "2026-10-01", methodLabel: "Cash", ...extra }).success).toBe(false);
    }
  });

  it("formats minor units for display", () => {
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
    expect(formatMoney(5, "USD")).toBe("$0.05");
    expect(formatMoney(1500, "JPY")).toBe("¥1,500");
  });
});
