/**
 * Staff billing (S19/S26): /admin/students/:studentId/billing, admin + staff.
 * The whole owner journey on one page: agreed price, adjustments, schedule, payments, evidence, history.
 * Uses the S18 ledger API; every action returns the refreshed view. No gateway, no card data.
 */
import React from "react";
import { useCallback } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KpiTile, StaffNotice, StaffPage, StaffPageHeader, StaffPill, staffBtn } from "@/components/staff/staff-ui";
import { useAuth } from "@/lib/auth";
import { useDocuments } from "@/hooks/use-documents";
import { formatBillingDate, useStaffBilling, useStaffBillingAction, type StaffBillingCall } from "@/lib/billing-queries";
import { formatMoney } from "@shared/billing-contract";
import { BalanceSummary, DiscountPanel, EvidencePanel, HistoryPanel, ObligationPanel, ReceiptsPanel, SchedulePanel, type PanelProps } from "@/components/admin/billing/billing-panels";
import { BILLING_STATUS_LABEL, BILLING_STATUS_TONE, summarizeBilling } from "@/components/admin/billing/billing-summary";

void React;

export default function AdminStudentBilling() {
  const { studentId = "" } = useParams<{ studentId: string }>();
  const query = useStaffBilling(studentId || null);
  const action = useStaffBillingAction(studentId);
  const documents = useDocuments(studentId || null);
  const student = useQuery<{ first_name?: string | null; last_name?: string | null; preferred_name?: string | null; student_code?: string | null }>({
    queryKey: [`/api/students/${encodeURIComponent(studentId)}`],
    enabled: !!studentId,
    retry: false,
  });
  const run = useCallback((call: StaffBillingCall, onDone?: () => void) => {
    action.mutate(call, { onSuccess: () => onDone?.() });
  }, [action]);

  const { user } = useAuth();
  const isAdmin = user?.role === "admin"; // the student workspace is admin-only; staff return to the billing lookup
  const who = student.data ? [student.data.preferred_name || student.data.first_name, student.data.last_name].filter(Boolean).join(" ") : "";
  const back = (
    <Link href={isAdmin ? `/admin/students/${encodeURIComponent(studentId)}` : "/staff/billing"} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline" data-testid="link-back-workspace">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />{isAdmin ? "Student file" : "Student billing"}
    </Link>
  );
  const header = (extra?: React.ReactNode) => (
    <StaffPageHeader back={back} eyebrow="Billing" title={who ? `Billing · ${who}` : "Student billing"}
      description="The agreed price, adjustments, schedule and confirmed payments. Only payments you confirm count as paid."
      actions={extra} testId="billing-header" />
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
  const sum = summarizeBilling(view);
  const props: PanelProps = {
    studentId, view, documents: documents.data ?? [], pending: action.isPending, error: action.error,
    errorPath: action.error ? action.variables?.path ?? null : null, run, resetError: action.reset,
  };

  return (
    <StaffPage testId="admin-student-billing" width="wide">
      {header(sum.configured ? <StaffPill tone={BILLING_STATUS_TONE[sum.status]}>{BILLING_STATUS_LABEL[sum.status]}</StaffPill> : undefined)}
      {s.state === "configured" && s.nextDue ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="billing-next">
          <KpiTile label="Next due" value={formatBillingDate(s.nextDue.dueDate, "en-US")} tone={s.nextDue.status === "overdue" ? "urgent" : "default"} hint={`${formatMoney(s.nextDue.amountCents, s.currency)}${s.nextDue.status === "overdue" ? " · overdue" : ""}`} />
          <KpiTile label="Remaining" value={formatMoney(sum.remainingCents, s.currency)} hint="left on the amount due" />
        </div>
      ) : null}
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] 2xl:items-start">
        <div className="min-w-0 space-y-6">
          {s.state === "configured" ? <BalanceSummary view={view} /> : null}
          <ObligationPanel {...props} />
          {s.state === "configured" ? (
            <>
              <ReceiptsPanel {...props} />
              <EvidencePanel {...props} />
            </>
          ) : null}
        </div>
        {s.state === "configured" ? (
          <div className="min-w-0 space-y-6">
            <DiscountPanel {...props} />
            <SchedulePanel {...props} />
            <HistoryPanel view={view} />
          </div>
        ) : null}
      </div>
    </StaffPage>
  );
}
