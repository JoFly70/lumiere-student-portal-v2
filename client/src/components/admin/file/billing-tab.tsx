/**
 * Student file, Billing tab (S27): KPI tiles, evidence banners (approve & issue receipt / reject), payment plan with
 * installment management (Edit plan, Add adjustment, Record a payment, void a receipt), history and the
 * "What the student sees" preview. Everything goes through the existing staff billing endpoints; the server
 * returns the refreshed view after every action and allocates receipts oldest-first.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Undo2 } from "lucide-react";
import type { StaffBillingView, BillingEvidenceRow } from "@shared/billing-contract";
import type { StudentDocument } from "@shared/schema";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StaffNotice, StaffEmpty, staffBtn, staffField, staffTable } from "@/components/staff/staff-ui";
import { useT, type TranslationKey } from "@/i18n";
import { useStaffBilling, useStaffBillingAction, type StaffBillingCall } from "@/lib/billing-queries";
import { fetchDocumentWithDownloadUrl } from "@/hooks/use-documents";
import { useToast } from "@/hooks/use-toast";
import { ErrorLine, ReasonDialog, todayIso } from "@/components/admin/billing/billing-dialogs";
import { EvidencePanel, ObligationPanel, type PanelProps } from "@/components/admin/billing/billing-panels";
import { billingHistory, summarizeBilling, type BillingHistoryKind } from "@/components/admin/billing/billing-summary";
import { centsToInput, parseMoneyToCents } from "@/components/admin/billing/money";
import { formatDay, formatMoneyCompact, installmentStatusMeta, instalmentProgress, localeOf, todayIsoLocal } from "@/lib/owner-presentation";
import { TonePill, ownerBtn } from "@/components/admin/control/owner-ui";
import { cn } from "@/lib/utils";
import { KeyValue, Panel } from "./file-parts";
import { EditPlanDialog } from "./edit-plan-dialog";

const HISTORY_KEY: Record<BillingHistoryKind, TranslationKey> = {
  payment: "owner.bill.h.payment", payment_voided: "owner.bill.h.paymentVoided", adjustment: "owner.bill.h.adjustment", adjustment_voided: "owner.bill.h.adjustmentVoided",
  evidence_submitted: "owner.bill.h.evidence", evidence_confirmed: "owner.bill.h.evidenceOk", evidence_rejected: "owner.bill.h.evidenceNo",
};

// ── dialogs ─────────────────────────────────────────────────────────────────

/** Echoes the parsed amount so a mistyped separator is visible before anything is recorded. */
function AmountEcho({ cents, currency }: { cents: number | null; currency: string }) {
  const { t, language } = useT();
  if (cents === null) return null;
  let text: string;
  try {
    const nf = new Intl.NumberFormat(localeOf(language), { style: "currency", currency });
    text = nf.format(cents / 10 ** (nf.resolvedOptions().maximumFractionDigits ?? 2));
  } catch { text = `${centsToInput(cents, currency)} ${currency}`; }
  return <p className="text-sm text-student-ink" aria-live="polite" data-testid="amount-echo">{t("owner.bill.pay.echo", { amount: text })}</p>;
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><label htmlFor={id} className="block text-sm font-medium text-student-ink">{label}</label>{children}</div>;
}

export function PaymentDialog({ open, onOpenChange, currency, initialCents, title, submitLabel, pending, error, onSubmit }: {
  open: boolean; onOpenChange: (o: boolean) => void; currency: string; initialCents: number | null; title: string; submitLabel: string; pending: boolean; error?: Error | null;
  onSubmit: (v: { amountCents: number; receivedDate: string; methodLabel: string; reference?: string; note?: string }) => void;
}) {
  const { t } = useT();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [method, setMethod] = useState("Bank transfer");
  const [reference, setReference] = useState("");
  useEffect(() => { if (open) { setAmount(initialCents ? centsToInput(initialCents, currency) : ""); setDate(todayIso()); setMethod("Bank transfer"); setReference(""); } }, [open, initialCents, currency]);
  const cents = parseMoneyToCents(amount, currency);
  const valid = cents !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) && method.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-payment">
        <DialogHeader><DialogTitle className="font-serif text-2xl">{title}</DialogTitle><DialogDescription>{t("owner.bill.pay.desc")}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pay-amount" label={t("owner.bill.pay.amount", { currency })}><input id="pay-amount" inputMode="decimal" className={staffField} value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={amount !== "" && cents === null} placeholder="0.00" /></Field>
          <Field id="pay-date" label={t("owner.bill.pay.date")}><input id="pay-date" type="date" className={staffField} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field id="pay-method" label={t("owner.bill.pay.method")}><input id="pay-method" className={staffField} maxLength={80} value={method} onChange={(e) => setMethod(e.target.value)} /></Field>
          <Field id="pay-ref" label={t("owner.bill.pay.ref")}><input id="pay-ref" className={staffField} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        </div>
        <AmountEcho cents={cents} currency={currency} />
        <p className="text-xs text-student-muted">{t("owner.bill.pay.oldest")}</p>
        <ErrorLine error={error} />
        <DialogFooter>
          <button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => onOpenChange(false)} disabled={pending}>{t("owner.cancel")}</button>
          <button type="button" className={ownerBtn.seal} disabled={!valid || pending} data-testid="payment-submit" onClick={() => cents !== null && onSubmit({ amountCents: cents, receivedDate: date, methodLabel: method.trim(), ...(reference.trim() ? { reference: reference.trim() } : {}) })}>{pending ? t("owner.saving") : submitLabel}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustmentDialog({ open, onOpenChange, currency, pending, error, onSubmit }: {
  open: boolean; onOpenChange: (o: boolean) => void; currency: string; pending: boolean; error?: Error | null; onSubmit: (v: { amountCents: number; reason: string }) => void;
}) {
  const { t } = useT();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) { setAmount(""); setReason(""); } }, [open]);
  const cents = parseMoneyToCents(amount, currency);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-adjustment">
        <DialogHeader><DialogTitle className="font-serif text-2xl">{t("owner.bill.adj.title")}</DialogTitle><DialogDescription>{t("owner.bill.adj.desc")}</DialogDescription></DialogHeader>
        <Field id="adj-amount" label={t("owner.bill.adj.amount", { currency })}><input id="adj-amount" inputMode="decimal" className={staffField} value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={amount !== "" && cents === null} /></Field>
        <AmountEcho cents={cents} currency={currency} />
        <Field id="adj-reason" label={t("owner.bill.adj.reason")}><textarea id="adj-reason" rows={3} maxLength={300} className={cn(staffField, "py-2")} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <ErrorLine error={error} />
        <DialogFooter>
          <button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => onOpenChange(false)} disabled={pending}>{t("owner.cancel")}</button>
          <button type="button" className={ownerBtn.seal} disabled={cents === null || !reason.trim() || pending} onClick={() => cents !== null && onSubmit({ amountCents: cents, reason: reason.trim() })} data-testid="adjustment-submit">{pending ? t("owner.saving") : t("owner.bill.adj.submit")}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── evidence banner ─────────────────────────────────────────────────────────

function EvidenceBanner({ e, docs, currency, view, call, pending, error, resetError, personName }: {
  e: BillingEvidenceRow; docs: readonly StudentDocument[]; currency: string; view: StaffBillingView; call: (c: StaffBillingCall, done?: () => void) => void; pending: boolean; error: Error | null; resetError: () => void; personName: string;
}) {
  const { t, language } = useT();
  const locale = localeOf(language);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [openError, setOpenError] = useState<Error | null>(null);
  const name = docs.find((d) => d.id === e.documentId)?.file_name ?? t("owner.bill.ev.file");
  const open = () => fetchDocumentWithDownloadUrl(e.documentId).then((d) => { window.open(d.download_url, "_blank", "noopener,noreferrer"); setOpenError(null); }).catch((err: Error) => setOpenError(err));
  const next = view.student.state === "configured" ? view.student.nextDue : null;
  return (
    <div className="rounded-xl border border-student-gold bg-student-gold-soft/70 px-4 py-3" role="status" data-testid="evidence-banner">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-sm leading-snug text-student-ink"><strong>{t("owner.bill.ev.uploaded", { name: personName })}</strong> · <span className="break-all">{name}</span> · {formatDay(e.submittedAt.slice(0, 10), locale)}{e.note ? ` · ${e.note}` : ""}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => void open()}><ExternalLink className="h-4 w-4" aria-hidden="true" />{t("owner.bill.ev.view")}</button>
          <button type="button" className={ownerBtn.seal} onClick={() => { resetError(); setApproving(true); }} data-testid="evidence-approve">{t("owner.bill.ev.approve")}</button>
          <button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => { resetError(); setRejecting(true); }} data-testid="evidence-reject">{t("owner.bill.ev.reject")}</button>
        </div>
      </div>
      {openError ? <ErrorLine error={openError} /> : null}
      <PaymentDialog open={approving} onOpenChange={setApproving} currency={currency} initialCents={next?.amountCents ?? null} title={t("owner.bill.ev.approveTitle")} submitLabel={t("owner.bill.ev.approveSubmit")} pending={pending} error={error}
        onSubmit={(v) => call({ path: `/evidence/${e.id}/confirm`, body: v }, () => setApproving(false))} />
      <ReasonDialog open={rejecting} onOpenChange={setRejecting} testId="dialog-reject-evidence" title={t("owner.bill.ev.rejectTitle")} description={t("owner.bill.ev.rejectDesc")} confirmLabel={t("owner.bill.ev.reject")} pending={pending} error={error}
        onConfirm={(r) => call({ path: `/evidence/${e.id}/reject`, body: { reason: r } }, () => setRejecting(false))} />
    </div>
  );
}

// ── tab ─────────────────────────────────────────────────────────────────────

export function BillingTab({ studentId, personName, documents }: { studentId: string; personName: string; documents: readonly StudentDocument[] }) {
  const { t, language } = useT();
  const locale = localeOf(language);
  const { toast } = useToast();
  const query = useStaffBilling(studentId);
  const action = useStaffBillingAction(studentId);
  const [dialog, setDialog] = useState<null | { kind: "plan" } | { kind: "adjust" } | { kind: "pay"; cents: number | null } | { kind: "void"; id: string } | { kind: "voidAdj"; id: string }>(null);
  const close = () => setDialog(null);
  const run = useCallback((c: StaffBillingCall, done?: () => void) => {
    action.mutate(c, { onSuccess: () => { done?.(); toast({ title: t("owner.bill.saved") }); } });
  }, [action, toast, t]);

  if (query.isLoading) return <div role="status" className="h-48 animate-pulse rounded-2xl bg-student-gold-soft/40"><span className="sr-only">{t("owner.loading")}</span></div>;
  if (query.isError || !query.data) {
    return <StaffNotice tone="urgent" role="alert" action={<button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => void query.refetch()}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t("owner.retry")}</button>}>{query.error?.message ?? t("owner.bill.error")}</StaffNotice>;
  }
  const view = query.data;
  const s = view.student;
  const props: PanelProps = { studentId, view, documents, pending: action.isPending, error: action.error, errorPath: action.error ? action.variables?.path ?? null : null, run, resetError: action.reset };

  if (s.state !== "configured") {
    return (
      <div className="space-y-6" data-testid="billing-not-configured">
        <StaffEmpty title={t("owner.bill.none.title")}>{t("owner.bill.none.body")}</StaffEmpty>
        <ObligationPanel {...props} />
      </div>
    );
  }

  const sum = summarizeBilling(view);
  const cur = s.currency;
  const money = (c: number) => formatMoneyCompact(c, cur, locale);
  const today = todayIsoLocal();
  const prog = instalmentProgress(s.installments);
  const awaiting = view.evidence.filter((e) => e.status === "awaiting_review");
  const history = billingHistory(view);
  const err = action.error;
  const nextDue = s.nextDue;

  return (
    <div className="space-y-6" data-testid="billing-tab">
      <section aria-label={t("owner.bill.kpis")} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { id: "agreed", label: t("owner.bill.k.agreed"), value: money(sum.netCents), hint: sum.adjustmentsCents > 0 ? t("owner.bill.k.adjusted", { amount: money(sum.adjustmentsCents) }) : t("owner.bill.k.noAdj"), cls: "" },
          { id: "paid", label: t("owner.bill.k.paid"), value: money(sum.paidCents), hint: t("owner.bill.k.ofInst", { a: prog.paid, b: prog.total }), cls: "text-st-applied" },
          { id: "remaining", label: t("owner.bill.k.remaining"), value: money(sum.remainingCents), hint: sum.creditCents > 0 ? t("owner.bill.k.credit", { amount: money(sum.creditCents) }) : t("owner.bill.k.toCollect"), cls: "" },
          { id: "next", label: t("owner.bill.k.next"), value: nextDue ? formatDay(nextDue.dueDate, locale) : "·", hint: nextDue ? money(nextDue.amountCents) : t("owner.bill.k.none"), cls: nextDue?.status === "overdue" ? "text-st-urgent" : "" },
        ].map((k, i) => (
          <div key={k.id} className={cn("flex min-h-[104px] min-w-0 flex-col justify-between gap-2 rounded-2xl border p-4", i === 3 ? "border-student-gold bg-gradient-to-br from-student-gold-soft to-student-card" : "border-student-line bg-student-card")} data-testid={`bill-kpi-${k.id}`}>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-student-muted">{k.label}</span>
            <span className={cn("font-serif text-3xl leading-none tabular-nums text-student-ink sm:text-4xl", k.cls)}>{k.value}</span>
            <span className="text-xs text-student-muted">{k.hint}</span>
          </div>
        ))}
      </section>

      {awaiting.map((e) => <EvidenceBanner key={e.id} e={e} docs={documents} currency={cur} view={view} call={run} pending={action.isPending} error={err} resetError={action.reset} personName={personName} />)}

      <Panel id="bill-plan" title={t("owner.bill.plan.title", { n: s.installments.length })} testId="bill-plan"
        actions={<div className="flex flex-wrap gap-2">
          <button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => { action.reset(); setDialog({ kind: "plan" }); }} data-testid="plan-edit">{t("owner.bill.plan.edit")}</button>
          <button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => { action.reset(); setDialog({ kind: "adjust" }); }} data-testid="adjust-open">{t("owner.bill.plan.adjust")}</button>
          <button type="button" className={ownerBtn.seal} onClick={() => { action.reset(); setDialog({ kind: "pay", cents: null }); }} data-testid="pay-open">{t("owner.bill.plan.record")}</button>
        </div>}>
        {view.scheduleMismatchCents !== 0 && s.installments.length > 0 ? (
          <StaffNotice tone="attention" role="status" className="mb-3" testId="schedule-mismatch">{t("owner.bill.mismatch", { total: money(view.scheduledCents), diff: money(Math.abs(view.scheduleMismatchCents)), dir: t(view.scheduleMismatchCents > 0 ? "owner.plan.over" : "owner.plan.under") })}</StaffNotice>
        ) : null}
        {s.installments.length === 0 ? <p className="text-sm text-student-muted">{t("owner.bill.plan.empty")}</p> : (
          <div className="relative -mx-4 overflow-x-auto sm:-mx-5" tabIndex={0} role="region" aria-label={t("owner.bill.plan.table")}>
            <table className={cn(staffTable.table, "min-w-[40rem]")} data-testid="schedule-table">
              <caption className="sr-only">{t("owner.bill.plan.table")}</caption>
              <thead><tr className="text-left">{(["#", "owner.bill.c.due", "owner.bill.c.amount", "owner.bill.c.paid", "owner.bill.c.status"] as const).map((k, i) => <th key={k} scope="col" className={cn("px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-student-muted", i === 0 && "pl-5")}>{k === "#" ? "#" : t(k)}</th>)}<th scope="col" className="px-4 py-2 pr-5"><span className="sr-only">{t("owner.col.actions")}</span></th></tr></thead>
              <tbody>
                {s.installments.map((i, idx) => {
                  const m = installmentStatusMeta(i.status, i.dueDate, today);
                  const unpaid = Math.max(0, i.amountCents - i.allocatedCents);
                  return (
                    <tr key={i.id} className="border-t border-student-line" data-testid="schedule-row" data-status={i.status}>
                      <td className="px-4 py-3 pl-5 tabular-nums">{idx + 1}</td>
                      <td className="px-4 py-3 tabular-nums">{formatDay(i.dueDate, locale)}{i.label ? <span className="block text-xs text-student-muted">{i.label}</span> : null}</td>
                      <td className="px-4 py-3 font-semibold tabular-nums">{money(i.amountCents)}</td>
                      <td className="px-4 py-3 tabular-nums">{money(i.allocatedCents)}</td>
                      <td className="px-4 py-3"><TonePill tone={m.tone}>{t(m.key, m.key === "owner.bill.st.due" ? { date: formatDay(i.dueDate, locale) } : m.vars)}</TonePill></td>
                      <td className="px-4 py-3 pr-5 text-right">{i.status !== "paid" ? <button type="button" className={cn(ownerBtn.seal, "min-h-9")} onClick={() => { action.reset(); setDialog({ kind: "pay", cents: unpaid }); }} aria-label={t("owner.bill.recordRow", { n: idx + 1 })}>{t("owner.bill.recordShort")}</button> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-student-muted">{t("owner.bill.plan.foot")}</p>
      </Panel>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0 space-y-6">
          <Panel id="bill-receipts" title={t("owner.bill.rc.title")} aside={t("owner.bill.rc.sub")} testId="bill-receipts">
            {view.receipts.length === 0 ? <p className="text-sm text-student-muted">{t("owner.bill.rc.empty")}</p> : (
              <ul>
                {view.receipts.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-student-line py-2.5 text-sm first:border-t-0 first:pt-0" data-testid="receipt-row">
                    <span className="min-w-0"><span className="block font-medium tabular-nums text-student-ink">{money(r.amountCents)} · {formatDay(r.receivedDate, locale)}</span><span className="block break-words text-xs text-student-muted">{r.methodLabel}{r.reference ? ` · ${t("owner.bill.ref", { ref: r.reference })}` : ""}{r.evidenceId ? ` · ${t("owner.bill.fromEvidence")}` : ""}</span></span>
                    <button type="button" className="inline-flex min-h-9 items-center gap-1 rounded px-2 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-student-gold-ink" onClick={() => { action.reset(); setDialog({ kind: "void", id: r.id }); }} data-testid="receipt-void"><Undo2 className="h-3.5 w-3.5" aria-hidden="true" />{t("owner.bill.void")}</button>
                  </li>
                ))}
              </ul>
            )}
            {view.discounts.length > 0 ? (
              <div className="mt-4 border-t border-student-line pt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-student-muted">{t("owner.bill.adj.list")}</p>
                <ul>
                  {view.discounts.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm" data-testid="discount-row">
                      <span className="min-w-0 break-words"><span className="font-medium tabular-nums">− {money(d.amountCents)}</span> · <span className="text-student-muted">{d.reason}</span></span>
                      <button type="button" className="min-h-9 rounded px-2 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline" onClick={() => { action.reset(); setDialog({ kind: "voidAdj", id: d.id }); }}>{t("owner.bill.void")}</button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Panel>

          <Panel id="bill-history" title={t("owner.bill.hist.title")} testId="bill-history">
            {history.length === 0 ? <p className="text-sm text-student-muted">{t("owner.bill.hist.empty")}</p> : (
              <ul>
                {history.slice(0, 12).map((h) => (
                  <li key={h.id} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 border-t border-student-line py-2.5 text-sm first:border-t-0 first:pt-0" data-testid="history-item">
                    <time className="text-xs text-student-muted" dateTime={h.at}>{formatDay(h.at.slice(0, 10), locale)}</time>
                    <p className="min-w-0 break-words text-student-ink">{t(HISTORY_KEY[h.kind])}{h.amountCents !== null ? ` · ${money(h.amountCents)}` : ""}<span className="block text-xs text-student-muted">{h.detail}</span></p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel id="bill-sees" title={t("owner.bill.sees.title", { name: personName })} testId="bill-student-view">
          <dl>
            <KeyValue label={t("owner.bill.k.agreed")}>{money(s.netObligationCents)}</KeyValue>
            <KeyValue label={t("owner.bill.k.paid")}>{money(s.paidCents)}</KeyValue>
            <KeyValue label={t("owner.bill.sees.next")}>{s.nextDue ? `${money(s.nextDue.amountCents)} · ${formatDay(s.nextDue.dueDate, locale)}` : "·"}</KeyValue>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-student-muted">{t("owner.bill.sees.note")}</p>
        </Panel>
      </div>

      <details className="group rounded-2xl border border-student-line bg-student-card" data-testid="billing-advanced">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-5 py-3 font-serif text-lg text-student-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-student-gold-ink">{t("owner.bill.adv.title")}<span className="text-xs font-sans text-student-muted">{t("owner.bill.adv.sub")}</span></summary>
        <div className="space-y-6 border-t border-student-line p-4 sm:p-5">
          <ObligationPanel {...props} />
          <EvidencePanel {...props} />
        </div>
      </details>

      <EditPlanDialog open={dialog?.kind === "plan"} onOpenChange={(o) => !o && close()} personName={personName} currency={cur} netCents={s.netObligationCents} installments={s.installments} pending={action.isPending} error={err}
        onSubmit={(rows) => run({ path: "/installments", body: { installments: rows } }, close)} />
      <AdjustmentDialog open={dialog?.kind === "adjust"} onOpenChange={(o) => !o && close()} currency={cur} pending={action.isPending} error={err}
        onSubmit={(v) => run({ path: "/discounts", body: v }, close)} />
      <PaymentDialog open={dialog?.kind === "pay"} onOpenChange={(o) => !o && close()} currency={cur} initialCents={dialog?.kind === "pay" ? dialog.cents : null} title={t("owner.bill.plan.record")} submitLabel={t("owner.bill.pay.submit")} pending={action.isPending} error={err}
        onSubmit={(v) => run({ path: "/receipts", body: v }, close)} />
      <ReasonDialog open={dialog?.kind === "void"} onOpenChange={(o) => !o && close()} testId="dialog-void-receipt" title={t("owner.bill.void.title")} description={t("owner.bill.void.desc")} confirmLabel={t("owner.bill.void")} pending={action.isPending} error={err}
        onConfirm={(r) => dialog?.kind === "void" && run({ path: `/receipts/${dialog.id}/void`, body: { reason: r } }, close)} />
      <ReasonDialog open={dialog?.kind === "voidAdj"} onOpenChange={(o) => !o && close()} testId="dialog-void-adjustment" title={t("owner.bill.voidAdj.title")} description={t("owner.bill.voidAdj.desc")} confirmLabel={t("owner.bill.void")} pending={action.isPending} error={err}
        onConfirm={(r) => dialog?.kind === "voidAdj" && run({ path: `/discounts/${dialog.id}/void`, body: { reason: r } }, close)} />
    </div>
  );
}
