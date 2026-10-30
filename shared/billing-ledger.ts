/**
 * S18 billing ledger: pure computation, no I/O. See shared/billing-contract.ts for the rules.
 *
 * Allocation: confirmed receipts are pooled and applied to installments oldest due date first
 * (ties by sortOrder, then id). Receipts beyond the schedule are unallocated; they still count
 * as paid against the obligation. The schedule never changes what is owed.
 *
 * Installment status, by date only (today is a YYYY-MM-DD string, never read from a clock here):
 *   paid            fully covered
 *   overdue         not fully covered and dueDate < today (a partial payment keeps it overdue)
 *   due             not fully covered and dueDate == today
 *   partially_paid  partly covered and dueDate > today
 *   upcoming        uncovered and dueDate > today
 */
import {
  MAX_CENTS,
  formatMoney,
  type BillingEvidenceRow,
  type BillingLedgerData,
  type InstallmentStatus,
  type NextDue,
  type StaffBillingView,
  type StudentBillingView,
  type StudentInstallment,
} from "./billing-contract";

export function assertCents(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_CENTS) {
    throw new TypeError(`${label} must be a non-negative integer number of cents`);
  }
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

export function installmentStatus(dueDate: string, amountCents: number, allocatedCents: number, today: string): InstallmentStatus {
  if (allocatedCents >= amountCents) return "paid";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "due";
  return allocatedCents > 0 ? "partially_paid" : "upcoming";
}

export function allocateReceipts(
  installments: BillingLedgerData["installments"],
  paidCents: number,
  today: string,
): StudentInstallment[] {
  const ordered = [...installments].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  );
  let pool = paidCents;
  return ordered.map((i) => {
    const allocated = Math.min(pool, i.amountCents);
    pool -= allocated;
    return {
      id: i.id,
      dueDate: i.dueDate,
      amountCents: i.amountCents,
      label: i.label,
      allocatedCents: allocated,
      status: installmentStatus(i.dueDate, i.amountCents, allocated, today),
    };
  });
}

/** Money for server messages (English locale). */
export const formatMoneyPlain = (cents: number, currency: string): string => formatMoney(cents, currency, "en-US");

/** Net obligation (agreed minus active discounts, never negative), or null when no price is set. */
export function netObligationCents(data: Pick<BillingLedgerData, "obligation" | "discounts">): number | null {
  if (!data.obligation) return null;
  return Math.max(0, data.obligation.agreedCents - sum(data.discounts.map((d) => d.amountCents)));
}

export type ScheduleProblem =
  | { readonly code: "sum_mismatch"; readonly scheduledCents: number; readonly netCents: number }
  | { readonly code: "paid_row_changed"; readonly installmentId: string };

/**
 * Server-side rules for replacing a schedule. The schedule must allocate the net obligation exactly (an empty
 * schedule is allowed), and rows already fully covered by receipts must stay the earliest rows with the same due
 * date and amount, so replacing the schedule never moves money from a paid row to another one.
 */
export function validateReplacementSchedule(
  data: BillingLedgerData,
  next: readonly { dueDate: string; amountCents: number }[],
  today: string,
): ScheduleProblem | null {
  const net = netObligationCents(data) ?? 0;
  const scheduled = sum(next.map((i) => i.amountCents));
  if (next.length > 0 && scheduled !== net) return { code: "sum_mismatch", scheduledCents: scheduled, netCents: net };
  const paid = sum(data.receipts.map((r) => r.amountCents));
  const paidRows = allocateReceipts(data.installments, paid, today).filter((i) => i.amountCents > 0 && i.allocatedCents >= i.amountCents);
  const ordered = next.map((r, i) => ({ r, i })).sort((a, b) => a.r.dueDate.localeCompare(b.r.dueDate) || a.i - b.i).map(({ r }) => r);
  for (let k = 0; k < paidRows.length; k++) {
    const was = paidRows[k]!;
    const now = ordered[k];
    if (!now || now.dueDate !== was.dueDate || now.amountCents !== was.amountCents) return { code: "paid_row_changed", installmentId: was.id };
  }
  return null;
}

/** True when the installment is fully covered by receipts (oldest due date first). */
export function isInstallmentPaid(data: BillingLedgerData, installmentId: string, today: string): boolean {
  const paid = sum(data.receipts.map((r) => r.amountCents));
  const row = allocateReceipts(data.installments, paid, today).find((i) => i.id === installmentId);
  return !!row && row.amountCents > 0 && row.allocatedCents >= row.amountCents;
}

export function computeStudentBilling(data: BillingLedgerData, today: string): StudentBillingView {
  const awaiting = data.evidence
    .filter((e: BillingEvidenceRow) => e.status === "awaiting_review")
    .map((e) => ({ id: e.id, documentId: e.documentId, submittedAt: e.submittedAt }));

  if (!data.obligation) {
    return {
      state: "not_configured",
      currency: null,
      agreedCents: null,
      discountCents: null,
      netObligationCents: null,
      paidCents: null,
      remainingCents: null,
      overpaid: null,
      creditCents: null,
      nextDue: null,
      installments: [],
      receipts: [],
      evidenceAwaitingReview: awaiting,
    };
  }

  const agreed = data.obligation.agreedCents;
  assertCents(agreed, "agreedCents");
  data.discounts.forEach((d) => assertCents(d.amountCents, "discount"));
  data.receipts.forEach((r) => assertCents(r.amountCents, "receipt"));
  data.installments.forEach((i) => assertCents(i.amountCents, "installment"));

  const discount = sum(data.discounts.map((d) => d.amountCents));
  const net = Math.max(0, agreed - discount);
  const paid = sum(data.receipts.map((r) => r.amountCents));
  const remaining = Math.max(0, net - paid);
  const installments = allocateReceipts(data.installments, paid, today);

  const open = installments.find((i) => i.status !== "paid");
  const nextDue: NextDue | null =
    open && remaining > 0
      ? { installmentId: open.id, dueDate: open.dueDate, amountCents: open.amountCents - open.allocatedCents, status: open.status }
      : null;

  const receipts = [...data.receipts]
    .sort((a, b) => b.receivedDate.localeCompare(a.receivedDate) || b.confirmedAt.localeCompare(a.confirmedAt))
    .map((r) => ({ id: r.id, amountCents: r.amountCents, receivedDate: r.receivedDate, methodLabel: r.methodLabel }));

  return {
    state: "configured",
    currency: data.obligation.currency,
    agreedCents: agreed,
    discountCents: discount,
    netObligationCents: net,
    paidCents: paid,
    remainingCents: remaining,
    overpaid: paid > net,
    creditCents: Math.max(0, paid - net),
    nextDue,
    installments,
    receipts,
    evidenceAwaitingReview: awaiting,
  };
}

export function computeStaffBilling(data: BillingLedgerData, today: string): StaffBillingView {
  const student = computeStudentBilling(data, today);
  const scheduled = sum(data.installments.map((i) => i.amountCents));
  const net = student.state === "configured" ? student.netObligationCents : null;
  return {
    student,
    obligationNote: data.obligation?.note ?? null,
    discounts: data.discounts,
    receipts: [...data.receipts].sort((a, b) => b.receivedDate.localeCompare(a.receivedDate)),
    evidence: data.evidence,
    voidedReceipts: data.voidedReceipts ?? [],
    voidedDiscounts: data.voidedDiscounts ?? [],
    scheduledCents: scheduled,
    scheduleMismatchCents: net !== null && data.installments.length > 0 ? scheduled - net : 0,
  };
}
