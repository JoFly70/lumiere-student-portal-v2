/** Compact billing summary for the student file Overview. Links to the full billing page. */
import React from "react";
import { Link } from "wouter";
import { ArrowRight, CreditCard } from "lucide-react";
import { formatMoney, type StaffBillingView } from "@shared/billing-contract";
import { StaffCard, StaffEmpty, StaffPill, StaffSectionHeader, staffBtn, staffLabel } from "@/components/staff/staff-ui";
import { BILLING_STATUS_LABEL, BILLING_STATUS_TONE, summarizeBilling } from "./billing-summary";

void React;

const LINK = `${staffBtn.outline} inline-flex items-center justify-center border`;

export function BillingSummaryCard({ studentId, billing, loading, error }: { studentId: string; billing?: StaffBillingView; loading?: boolean; error?: boolean }) {
  const href = `/admin/students/${encodeURIComponent(studentId)}/billing`;
  const sum = summarizeBilling(billing);
  const money = (c: number) => formatMoney(c, sum.currency ?? "USD");
  return (
    <section aria-label="Billing summary" className="space-y-3" data-testid="billing-summary-card">
      <StaffSectionHeader
        icon={<CreditCard className="h-5 w-5" />}
        title="Billing summary"
        description="Agreed price, adjustments and confirmed payments. Only payments staff confirmed count as paid."
        actions={sum.configured ? <StaffPill tone={BILLING_STATUS_TONE[sum.status]} testId="billing-status-pill">{BILLING_STATUS_LABEL[sum.status]}</StaffPill> : undefined}
      />
      {loading ? <StaffCard as="div"><p role="status" className="text-sm text-student-muted">Loading billing…</p></StaffCard>
        : error ? <StaffCard as="div" tone="attention"><p role="alert" className="text-sm">Billing could not be loaded. Open the billing page to retry.</p></StaffCard>
        : !sum.configured ? (
          <StaffEmpty title="No agreed amount yet" testId="billing-summary-empty" action={<Link href={href} className={LINK}>Set up billing<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}>
            Set the agreed program price on the billing page to start tracking adjustments and payments.
          </StaffEmpty>
        ) : (
          <StaffCard as="div" className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-4">
              <Money label="Agreed" value={money(sum.agreedCents)} testId="bs-agreed" />
              <Money label="Adjustments" value={sum.adjustmentsCents > 0 ? `− ${money(sum.adjustmentsCents)}` : money(0)} testId="bs-adjustments" />
              <Money label="Paid" value={money(sum.paidCents)} testId="bs-paid" />
              <Money label={sum.creditCents > 0 ? "Credit" : "Remaining"} value={money(sum.creditCents > 0 ? sum.creditCents : sum.remainingCents)} testId="bs-remaining" />
            </dl>
            <Link href={href} className={LINK} data-testid="link-billing-summary">Open billing<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </StaffCard>
        )}
    </section>
  );
}

function Money({ label, value, testId }: { label: string; value: string; testId: string }) {
  return <div className="min-w-0"><dt className={staffLabel}>{label}</dt><dd className="mt-1 break-words font-serif text-xl tabular-nums text-student-ink sm:text-2xl" data-testid={testId}>{value}</dd></div>;
}
