/**
 * Staff billing (S19): /admin/students/:studentId/billing, admin + staff.
 * Uses the S18 ledger API; every action returns the refreshed view. No gateway, no card data.
 */
import { useCallback } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@shared/billing-contract";
import { KpiTile, StaffNotice, StaffPage, StaffPageHeader, StaffPill, staffBtn } from "@/components/staff/staff-ui";
import { formatBillingDate, paidPercent, useStaffBilling, useStaffBillingAction, type StaffBillingCall } from "@/lib/billing-queries";
import { DiscountPanel, EvidencePanel, ObligationPanel, ReceiptsPanel, SchedulePanel, type PanelProps } from "@/components/admin/billing/billing-panels";

export default function AdminStudentBilling() {
  const { studentId = "" } = useParams<{ studentId: string }>();
  const query = useStaffBilling(studentId || null);
  const action = useStaffBillingAction(studentId);
  const run = useCallback((call: StaffBillingCall, onDone?: () => void) => {
    action.mutate(call, { onSuccess: () => onDone?.() });
  }, [action]);

  const back = (
    <Link href={`/admin/students/${encodeURIComponent(studentId)}`} className="inline-flex items-center gap-1.5 text-sm text-student-muted hover:text-student-ink" data-testid="link-back-workspace">
      <ArrowLeft className="h-4 w-4" />Student workspace
    </Link>
  );
  const header = (extra?: React.ReactNode) => (
    <StaffPageHeader back={back} eyebrow="Billing" title="Student billing" description="The agreed price, discounts, schedule and confirmed payments. Only confirmed payments count as paid." actions={extra} testId="billing-header" />
  );

  if (query.isLoading) return <StaffPage>{header()}<div role="status" className="h-48 animate-pulse rounded-2xl bg-student-gold-soft/40"><span className="sr-only">Loading billing</span></div></StaffPage>;
  if (query.isError || !query.data) {
    return (
      <StaffPage>{header()}
        <StaffNotice tone="urgent" role="alert" action={<Button type="button" className={staffBtn.outline} variant="outline" onClick={() => void query.refetch()}><RefreshCw className="h-4 w-4" />Retry</Button>}>
          {query.error?.message ?? "Billing could not be loaded."}
        </StaffNotice>
      </StaffPage>
    );
  }

  const view = query.data;
  const s = view.student;
  const props: PanelProps = { view, pending: action.isPending, error: action.error, run, resetError: action.reset };
  const money = (c: number | null) => (s.state === "configured" && c !== null ? formatMoney(c, s.currency) : "·");

  return (
    <StaffPage testId="admin-student-billing">
      {header(s.state === "configured" ? <StaffPill tone={s.overpaid ? "attention" : s.remainingCents === 0 ? "gold" : "neutral"}>{s.overpaid ? "Overpaid" : s.remainingCents === 0 ? "Settled" : `${paidPercent(s.paidCents, s.netObligationCents)}% paid`}</StaffPill> : undefined)}
      {s.state === "configured" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="billing-summary">
          <KpiTile label="Net obligation" value={money(s.netObligationCents)} hint={s.discountCents > 0 ? `${money(s.agreedCents)} less ${money(s.discountCents)} discounts` : "No discounts"} />
          <KpiTile label="Paid" value={money(s.paidCents)} hint={`${s.receipts.length} confirmed payment${s.receipts.length === 1 ? "" : "s"}`} />
          <KpiTile label="Outstanding" value={money(s.remainingCents)} tone={s.nextDue?.status === "overdue" ? "urgent" : "default"} hint={s.overpaid ? `Credit ${money(s.creditCents)}` : "Left on the net obligation"} />
          <KpiTile label="Next due" value={s.nextDue ? formatBillingDate(s.nextDue.dueDate, "en-US") : "·"} hint={s.nextDue ? `${money(s.nextDue.amountCents)}${s.nextDue.status === "overdue" ? " · overdue" : ""}` : "Nothing scheduled"} />
        </div>
      )}
      {action.error && <StaffNotice tone="urgent" role="alert" testId="billing-action-error">{action.error.message}</StaffNotice>}
      <ObligationPanel {...props} />
      {s.state === "configured" && (
        <>
          <EvidencePanel {...props} />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="space-y-6"><ReceiptsPanel {...props} /><SchedulePanel {...props} /></div>
            <div className="space-y-6"><DiscountPanel {...props} /></div>
          </div>
        </>
      )}
    </StaffPage>
  );
}
