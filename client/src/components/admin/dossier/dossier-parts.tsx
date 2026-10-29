/**
 * Shared parts of the owner's unified student dossier (used by the university workspace and the high-school file):
 * the "Experience as student" primary action, the "Next step" banner a novice owner follows, the inline Billing tab
 * and the Activity tab. Pure presentation over existing records; nothing here writes academic or financial data.
 */
import React, { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Activity, CreditCard, Eye, Loader2, MonitorPlay, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StaffCard, StaffEmpty, StaffNotice, StaffPill, StaffSectionHeader, staffBtn } from "@/components/staff/staff-ui";
import { BillingSummaryCard } from "@/components/admin/billing/billing-summary-card";
import { openStudentExperience } from "@/lib/demo-experience";
import { apiRequest } from "@/lib/api";
import { formatMoney, type StaffBillingView } from "@shared/billing-contract";
import { relativeTime, sentence } from "@/components/admin/directory/directory-data";
import { cn } from "@/lib/utils";

const LINK = `${staffBtn.outline} inline-flex items-center justify-center border`;

// ---------------------------------------------------------------------------
// Experience as student (primary action)
// ---------------------------------------------------------------------------

export function useExperienceAction(studentId: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setPending(true);
    setError(null);
    try {
      const r = await openStudentExperience(studentId);
      if (!r.ok) setError(r.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The student experience could not be opened.");
    } finally {
      setPending(false);
    }
  };
  return { pending, error, run, dismiss: () => setError(null) };
}

/** The one primary call to action on the dossier. Gold, first in the toolbar. */
export function ExperienceButton({ action }: { action: ReturnType<typeof useExperienceAction> }) {
  return (
    <Button type="button" className={cn(staffBtn.primary, "min-h-11 max-sm:col-span-2")} onClick={() => void action.run()} disabled={action.pending} data-testid="button-experience-as-student">
      {action.pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MonitorPlay className="h-4 w-4" aria-hidden="true" />}
      {action.pending ? "Opening…" : "Experience as student"}
    </Button>
  );
}

export function ViewAsStudentLink({ studentId }: { studentId: string }) {
  return (
    <Link href={`/admin/students/${encodeURIComponent(studentId)}/view-as-student`} className={cn(LINK, "max-sm:col-span-2")} data-testid="link-view-as-student">
      <Eye className="h-4 w-4" aria-hidden="true" />View as student (read-only preview)
    </Link>
  );
}

export function ExperienceError({ action }: { action: ReturnType<typeof useExperienceAction> }) {
  if (!action.error) return null;
  return <StaffNotice tone="urgent" role="alert" action={<Button type="button" size="sm" variant="outline" className={staffBtn.outline} onClick={action.dismiss}>Dismiss</Button>}>{action.error}</StaffNotice>;
}

// ---------------------------------------------------------------------------
// Next step
// ---------------------------------------------------------------------------

export interface NextStepInput {
  status: string;
  profileDecisions: number;
  docsPending: number;
  supportAwaiting: number;
  /** undefined while unknown: nothing is claimed until the record is loaded. */
  hasProgram?: boolean;
  billingConfigured?: boolean;
  /** Admin who may activate a lead. */
  canActivate?: boolean;
}
export interface NextStep { key: string; title: string; detail: string; tab?: string; href?: string; cta: string }

/** One clear first action for the owner, from stored counts only. Order = what blocks the student most. */
export function nextStep(i: NextStepInput, studentId: string): NextStep {
  const base = `/admin/students/${encodeURIComponent(studentId)}`;
  if (i.profileDecisions > 0) return { key: "guardian", title: `Decide ${i.profileDecisions} identity or guardian ${i.profileDecisions === 1 ? "request" : "requests"}`, detail: "The family is waiting on a verification decision.", tab: "profile", cta: "Review decisions" };
  if (i.docsPending > 0) return { key: "documents", title: `Review ${i.docsPending} uploaded ${i.docsPending === 1 ? "document" : "documents"}`, detail: "Verify, reject or ask for a new upload. The student sees your reason.", tab: "documents", cta: "Open documents" };
  if (i.supportAwaiting > 0) return { key: "support", title: `Reply to ${i.supportAwaiting} support ${i.supportAwaiting === 1 ? "request" : "requests"}`, detail: "The student is waiting for Lumière.", tab: "support", cta: "Open conversations" };
  if (i.hasProgram === false) return { key: "program", title: "Set up the high-school program", detail: "A short guided setup: program, credits, pace and approvals.", href: `${base}/high-school`, cta: "Start setup" };
  if (i.billingConfigured === false) return { key: "billing", title: "Record the agreed fee", detail: "Add the agreed price and payment schedule so the balance is tracked.", tab: "billing", cta: "Open billing" };
  if (i.status === "lead") return { key: "gates", title: "Follow the pre-enrollment checklist", detail: i.canActivate ? "Activate the student once the agreement is signed and payment is confirmed." : "Pending items are listed on the Overview.", tab: "overview", cta: "See the checklist" };
  return { key: "clear", title: "Everything is up to date", detail: "Nothing is waiting on you for this student. Experience the portal as the student to see what they see.", cta: "" };
}

export function NextStepBanner({ step, onTab, experience }: { step: NextStep; onTab: (tab: string) => void; experience: ReturnType<typeof useExperienceAction> }) {
  const clear = step.key === "clear";
  return (
    <StaffNotice tone={clear ? "success" : "gold"} testId="next-step" role="status"
      action={clear
        ? <Button type="button" size="sm" className={staffBtn.seal} onClick={() => void experience.run()} disabled={experience.pending}><MonitorPlay className="h-4 w-4" aria-hidden="true" />Experience as student</Button>
        : step.href
          ? <Link href={step.href} className={cn(staffBtn.seal, "inline-flex items-center justify-center")}>{step.cta}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          : <Button type="button" size="sm" className={staffBtn.seal} onClick={() => step.tab && onTab(step.tab)}>{step.cta}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-student-gold-ink">{clear ? "All clear" : "Next step"}</p>
      <p className="font-medium">{step.title}</p>
      <p className="text-sm text-student-muted">{step.detail}</p>
    </StaffNotice>
  );
}

// ---------------------------------------------------------------------------
// Billing tab (inline)
// ---------------------------------------------------------------------------

const INSTALLMENT_TONE = { paid: "seal", upcoming: "neutral", partial: "gold", overdue: "urgent" } as const;

export function DossierBilling({ studentId, billing, loading, error }: { studentId: string; billing?: StaffBillingView; loading?: boolean; error?: boolean }) {
  const href = `/admin/students/${encodeURIComponent(studentId)}/billing`;
  const s = billing?.student;
  const configured = s?.state === "configured" ? s : null;
  return (
    <div className="space-y-5" data-testid="dossier-billing">
      <BillingSummaryCard studentId={studentId} billing={billing} loading={loading} error={error} />
      {configured ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <StaffCard aria-labelledby="dossier-installments">
            <StaffSectionHeader id="dossier-installments" level={3} title="Payment schedule" icon={<CreditCard className="h-4 w-4" />} className="mb-2" />
            {configured.installments.length === 0 ? <p className="text-sm text-student-muted">No installments scheduled yet.</p> : (
              <ul className="divide-y divide-student-line">
                {configured.installments.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span className="min-w-0"><span className="block truncate text-sm font-medium text-student-ink">{i.label ?? "Installment"}</span><span className="block text-xs text-student-muted">Due {i.dueDate}</span></span>
                    <span className="flex items-center gap-2"><span className="text-sm tabular-nums text-student-ink">{formatMoney(i.amountCents, configured.currency)}</span><StaffPill tone={INSTALLMENT_TONE[i.status as keyof typeof INSTALLMENT_TONE] ?? "neutral"}>{sentence(i.status)}</StaffPill></span>
                  </li>
                ))}
              </ul>
            )}
          </StaffCard>
          <StaffCard aria-labelledby="dossier-receipts">
            <StaffSectionHeader id="dossier-receipts" level={3} title="Payments received" icon={<Receipt className="h-4 w-4" />} className="mb-2" />
            {configured.receipts.length === 0 ? <p className="text-sm text-student-muted">No confirmed payment yet.</p> : (
              <ul className="divide-y divide-student-line">
                {configured.receipts.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span className="min-w-0"><span className="block truncate text-sm font-medium text-student-ink">{r.methodLabel}</span><span className="block text-xs text-student-muted">{r.receivedDate}</span></span>
                    <span className="text-sm font-medium tabular-nums text-student-ink">{formatMoney(r.amountCents, configured.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </StaffCard>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href} className={cn(staffBtn.primary, "inline-flex items-center justify-center")} data-testid="link-billing-manage">Manage fee, payments and evidence<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        <p className="text-sm text-student-muted">Edit the agreed fee, schedule or adjustment, record a payment with its evidence, or void with a reason.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity tab
// ---------------------------------------------------------------------------

export interface ActivityEvent { id: string; eventType: string; severity: string; description: string; actorRole: string | null; createdAt: string | null }

export function ActivityList({ events }: { events: readonly ActivityEvent[] }) {
  return (
    <ol className="relative space-y-4 border-l border-student-line pl-5" data-testid="activity-list">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className={cn("absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-student-card", e.severity === "critical" || e.severity === "error" ? "bg-st-urgent" : e.severity === "warning" ? "bg-st-attention" : "bg-student-gold-ink")} aria-hidden="true" />
          <p className="text-sm leading-snug text-student-ink">{e.description || sentence(e.eventType)}</p>
          <p className="mt-0.5 text-xs text-student-muted"><time dateTime={e.createdAt ?? undefined} title={e.createdAt ? new Date(e.createdAt).toLocaleString() : undefined}>{relativeTime(e.createdAt)}</time>{e.actorRole ? ` · ${sentence(e.actorRole)}` : ""} · {sentence(e.eventType)}</p>
        </li>
      ))}
    </ol>
  );
}

export function DossierActivity({ studentId }: { studentId: string }) {
  const q = useQuery<{ events: ActivityEvent[] }>({ queryKey: [`/api/admin/students/${encodeURIComponent(studentId)}/activity`], queryFn: () => apiRequest(`/api/admin/students/${encodeURIComponent(studentId)}/activity`), retry: false });
  return (
    <section aria-labelledby="dossier-activity-heading" className="space-y-4" data-testid="dossier-activity">
      <StaffSectionHeader id="dossier-activity-heading" icon={<Activity className="h-5 w-5" />} title="Activity" description="The last 50 audited actions about this student: who changed what, and when." />
      {q.isLoading ? <p role="status" className="text-sm text-student-muted">Loading activity…</p>
        : q.isError ? <StaffNotice tone="attention" role="alert" action={<Button type="button" size="sm" variant="outline" className={staffBtn.outline} onClick={() => void q.refetch()}>Retry</Button>}>Activity could not be loaded. It is visible to the owner only.</StaffNotice>
        : !q.data?.events.length ? <StaffEmpty icon={<Activity className="h-6 w-6" />} title="No activity recorded yet">Changes to this student's file, documents, billing and roadmap will appear here.</StaffEmpty>
        : <StaffCard><ActivityList events={q.data.events} /></StaffCard>}
    </section>
  );
}
