/** Staff billing sections (S19). Every action returns the refreshed view, so the page never computes money itself. */
import { useState } from "react";
import { AlertTriangle, ExternalLink, Pencil, Plus, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney, type BillingEvidenceRow, type StaffBillingView } from "@shared/billing-contract";
import { StaffCard, StaffEmpty, StaffNotice, StaffPill, StaffSectionHeader, staffBtn, staffField, staffLabel, staffTable } from "@/components/staff/staff-ui";
import { formatBillingDate, type StaffBillingCall } from "@/lib/billing-queries";
import { fetchDocumentWithDownloadUrl } from "@/hooks/use-documents";
import { ErrorLine, ReasonDialog, ReceiptDialog } from "./billing-dialogs";
import { InstallmentEditDialog, ScheduleDialog } from "./schedule-editor";
import { centsToInput, parseMoneyToCents } from "./money";

export interface PanelProps {
  readonly view: StaffBillingView;
  readonly pending: boolean;
  readonly error: Error | null;
  readonly run: (call: StaffBillingCall, onDone?: () => void) => void;
  readonly resetError: () => void;
}
const fmt = (iso: string) => formatBillingDate(iso, "en-US");
const stamp = (iso: string) => iso.slice(0, 10);

const INSTALLMENT_TONE = { paid: "gold", partially_paid: "neutral", upcoming: "dashed", due: "attention", overdue: "urgent" } as const;
const INSTALLMENT_LABEL = { paid: "Paid", partially_paid: "Part paid", upcoming: "Upcoming", due: "Due today", overdue: "Overdue" } as const;

/** First setup, and later edits of the agreed price. */
export function ObligationPanel({ view, pending, run }: PanelProps) {
  const s = view.student;
  const configured = s.state === "configured";
  const [editing, setEditing] = useState(!configured);
  const [amount, setAmount] = useState(configured ? centsToInput(s.agreedCents, s.currency) : "");
  const [currency, setCurrency] = useState(configured ? s.currency : "USD");
  const cur = currency.trim().toUpperCase();
  const cents = /^[A-Za-z]{3}$/.test(cur) ? parseMoneyToCents(amount, cur) : null;
  return (
    <StaffCard data-testid="billing-obligation">
      <StaffSectionHeader level={3} title="Agreed program price"
        description={configured ? "What the student agreed to pay before discounts." : "Set the agreed price first. Discounts, schedule and payments follow."}
        actions={configured && !editing ? <Button type="button" className={staffBtn.outline} variant="outline" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit</Button> : undefined} />
      {configured && !editing ? (
        <p className="font-serif text-3xl tabular-nums text-student-ink" data-testid="text-agreed">{formatMoney(s.agreedCents, s.currency)}</p>
      ) : (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (cents !== null) run({ path: "/obligation", body: { agreedCents: cents, currency: cur } }, () => setEditing(false)); }}>
          <label className="text-sm"><span className={staffLabel}>Amount</span>
            <input className={`${staffField} mt-1 w-48`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12000.00" data-testid="input-agreed" aria-invalid={amount !== "" && cents === null} /></label>
          <label className="text-sm"><span className={staffLabel}>Currency</span>
            <input className={`${staffField} mt-1 w-24 uppercase`} maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={configured && (view.receipts.length > 0 || view.discounts.length > 0 || view.voidedReceipts.length > 0)} /></label>
          <Button type="submit" className={staffBtn.seal} disabled={cents === null || pending} data-testid="button-save-obligation">{pending ? "Saving…" : configured ? "Save price" : "Set agreed price"}</Button>
          {configured && <Button type="button" className={staffBtn.ghost} variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
        </form>
      )}
    </StaffCard>
  );
}

export function DiscountPanel({ view, pending, error, run, resetError }: PanelProps) {
  const s = view.student;
  const currency = s.state === "configured" ? s.currency : "USD";
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const cents = parseMoneyToCents(amount, currency);
  return (
    <StaffCard data-testid="billing-discounts">
      <StaffSectionHeader level={3} title="Approved discounts" description="Only discounts already approved. Each one reduces what is owed." />
      {view.discounts.length === 0 ? <p className="mb-3 text-sm text-student-muted">No discounts.</p> : (
        <ul className="mb-4 divide-y divide-student-line">
          {view.discounts.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0"><span className="font-medium tabular-nums">{formatMoney(d.amountCents, currency)}</span> <span className="text-student-muted">· {d.reason} · {stamp(d.approvedAt)}</span></span>
              <Button type="button" className={staffBtn.ghost} variant="ghost" onClick={() => { resetError(); setRemoving(d.id); }}><Undo2 className="h-4 w-4" />Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (cents !== null && reason.trim()) run({ path: "/discounts", body: { amountCents: cents, reason: reason.trim() } }, () => { setAmount(""); setReason(""); }); }}>
        <label className="text-sm"><span className={staffLabel}>Amount</span><input className={`${staffField} mt-1 w-36`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-discount-amount" /></label>
        <label className="min-w-48 flex-1 text-sm"><span className={staffLabel}>Reason</span><input className={`${staffField} mt-1`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="input-discount-reason" /></label>
        <Button type="submit" className={staffBtn.outline} variant="outline" disabled={cents === null || !reason.trim() || pending}><Plus className="h-4 w-4" />Add discount</Button>
      </form>
      <ReasonDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)} testId="dialog-remove-discount" title="Remove discount"
        description="The discount stops reducing the obligation. The entry stays in the history with your reason." confirmLabel="Remove discount" pending={pending} error={error}
        onConfirm={(r) => removing && run({ path: `/discounts/${removing}/void`, body: { reason: r } }, () => setRemoving(null))} />
    </StaffCard>
  );
}

export function SchedulePanel({ view, pending, error, run, resetError }: PanelProps) {
  const s = view.student;
  const [replace, setReplace] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  if (s.state !== "configured") return null;
  const edit = s.installments.find((i) => i.id === editId) ?? null;
  return (
    <StaffCard data-testid="billing-schedule" padded={false}>
      <div className="p-4 pb-0 sm:p-5 sm:pb-0">
        <StaffSectionHeader level={3} title="Installment schedule" description="Spreads the net obligation over dates. Payments are applied to the oldest installment first."
          actions={<Button type="button" className={staffBtn.outline} variant="outline" onClick={() => { resetError(); setReplace(true); }} data-testid="button-edit-schedule"><Pencil className="h-4 w-4" />{s.installments.length ? "Replace schedule" : "Create schedule"}</Button>} />
        {view.scheduleMismatchCents !== 0 && s.installments.length > 0 && (
          <StaffNotice tone="attention" icon={<AlertTriangle className="h-4 w-4" />} className="mb-3" testId="schedule-mismatch">
            The schedule totals {formatMoney(view.scheduledCents, s.currency)}, which is {formatMoney(Math.abs(view.scheduleMismatchCents), s.currency)} {view.scheduleMismatchCents > 0 ? "more" : "less"} than the net obligation. Adjust an installment.
          </StaffNotice>
        )}
      </div>
      {s.installments.length === 0 ? <div className="p-5 pt-0 text-sm text-student-muted">No schedule yet.</div> : (
        <div className="overflow-x-auto">
          <table className={staffTable.table}>
            <thead><tr><th className={staffTable.th}>Due</th><th className={staffTable.th}>Label</th><th className={`${staffTable.th} text-right`}>Amount</th><th className={`${staffTable.th} text-right`}>Covered</th><th className={staffTable.th}>Status</th><th className={staffTable.th}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {s.installments.map((i) => (
                <tr key={i.id} className={staffTable.tr}>
                  <td className={`${staffTable.td} tabular-nums`}>{fmt(i.dueDate)}</td>
                  <td className={`${staffTable.td} text-student-muted`}>{i.label ?? "·"}</td>
                  <td className={`${staffTable.td} text-right tabular-nums`}>{formatMoney(i.amountCents, s.currency)}</td>
                  <td className={`${staffTable.td} text-right tabular-nums`}>{formatMoney(i.allocatedCents, s.currency)}</td>
                  <td className={staffTable.td}><StaffPill tone={INSTALLMENT_TONE[i.status]}>{INSTALLMENT_LABEL[i.status]}</StaffPill></td>
                  <td className={`${staffTable.td} text-right`}><Button type="button" className={staffBtn.ghost} variant="ghost" aria-label={`Edit installment due ${i.dueDate}`} onClick={() => { resetError(); setEditId(i.id); }}><Pencil className="h-4 w-4" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ScheduleDialog open={replace} onOpenChange={setReplace} currency={s.currency} netCents={s.netObligationCents} pending={pending} error={error}
        initial={s.installments.map((i) => ({ dueDate: i.dueDate, amountCents: i.amountCents, label: i.label }))}
        onSubmit={(rows) => run({ path: "/installments", body: { installments: rows } }, () => setReplace(false))} />
      <InstallmentEditDialog open={!!edit} onOpenChange={(o) => !o && setEditId(null)} currency={s.currency} installment={edit} pending={pending} error={error}
        onSubmit={(patch) => editId && run({ path: `/installments/${editId}`, body: patch }, () => setEditId(null))} />
    </StaffCard>
  );
}

export function ReceiptsPanel({ view, pending, error, run, resetError }: PanelProps) {
  const s = view.student;
  const [recording, setRecording] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  if (s.state !== "configured") return null;
  return (
    <StaffCard data-testid="billing-receipts" padded={false}>
      <div className="p-4 pb-0 sm:p-5 sm:pb-0">
        <StaffSectionHeader level={3} title="Confirmed payments" description="Only payments staff have confirmed count as paid."
          actions={<Button type="button" className={staffBtn.seal} onClick={() => { resetError(); setRecording(true); }} data-testid="button-record-payment"><Plus className="h-4 w-4" />Record payment</Button>} />
      </div>
      {view.receipts.length === 0 ? <div className="p-5 pt-0 text-sm text-student-muted">No payments confirmed yet.</div> : (
        <div className="overflow-x-auto">
          <table className={staffTable.table}>
            <thead><tr><th className={staffTable.th}>Received</th><th className={staffTable.th}>Method</th><th className={staffTable.th}>Reference</th><th className={`${staffTable.th} text-right`}>Amount</th><th className={staffTable.th}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {view.receipts.map((r) => (
                <tr key={r.id} className={staffTable.tr}>
                  <td className={`${staffTable.td} tabular-nums`}>{fmt(r.receivedDate)}</td>
                  <td className={staffTable.td}>{r.methodLabel}{r.evidenceId ? <span className="ml-2 text-xs text-student-muted">from evidence</span> : null}</td>
                  <td className={`${staffTable.td} text-student-muted`}>{r.reference ?? "·"}</td>
                  <td className={`${staffTable.td} text-right tabular-nums`}>{formatMoney(r.amountCents, s.currency)}</td>
                  <td className={`${staffTable.td} text-right`}><Button type="button" className={staffBtn.ghost} variant="ghost" onClick={() => { resetError(); setVoiding(r.id); }} data-testid={`button-void-${r.id}`}><Undo2 className="h-4 w-4" />Void</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(view.voidedReceipts.length > 0 || view.voidedDiscounts.length > 0) && (
        <details className="border-t border-student-line px-5 py-3 text-sm" data-testid="billing-voided">
          <summary className="cursor-pointer text-student-muted">Voided entries ({view.voidedReceipts.length + view.voidedDiscounts.length}), kept for the audit trail</summary>
          <ul className="mt-2 space-y-1 text-student-muted">
            {view.voidedReceipts.map((r) => <li key={r.id}><span className="line-through tabular-nums">{formatMoney(r.amountCents, s.currency)}</span> receipt of {r.receivedDate}, voided {stamp(r.voidedAt)}: {r.voidReason}</li>)}
            {view.voidedDiscounts.map((d) => <li key={d.id}><span className="line-through tabular-nums">{formatMoney(d.amountCents, s.currency)}</span> discount, removed {stamp(d.voidedAt)}: {d.voidReason}</li>)}
          </ul>
        </details>
      )}
      <ReceiptDialog open={recording} onOpenChange={setRecording} currency={s.currency} pending={pending} error={error} title="Record a payment"
        description="Money you have received. It counts as paid immediately." submitLabel="Confirm payment"
        onSubmit={(v) => run({ path: "/receipts", body: v }, () => setRecording(false))} />
      <ReasonDialog open={voiding !== null} onOpenChange={(o) => !o && setVoiding(null)} testId="dialog-void-receipt" title="Void this payment"
        description="The payment stops counting as paid. It is never deleted: it stays in the history with your name and reason." confirmLabel="Void payment" pending={pending} error={error}
        onConfirm={(r) => voiding && run({ path: `/receipts/${voiding}/void`, body: { reason: r } }, () => setVoiding(null))} />
    </StaffCard>
  );
}

async function openDocument(documentId: string) {
  const doc = await fetchDocumentWithDownloadUrl(documentId);
  window.open(doc.download_url, "_blank", "noopener,noreferrer");
}

export function EvidencePanel({ view, pending, error, run, resetError }: PanelProps) {
  const s = view.student;
  const [confirming, setConfirming] = useState<BillingEvidenceRow | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [openError, setOpenError] = useState<Error | null>(null);
  if (s.state !== "configured") return null;
  const waiting = view.evidence.filter((e) => e.status === "awaiting_review");
  const reviewed = view.evidence.filter((e) => e.status !== "awaiting_review");
  return (
    <StaffCard data-testid="billing-evidence">
      <StaffSectionHeader level={3} title="Payment evidence to review" description="Proof the student uploaded. It does not change the balance until you confirm it as a payment." actions={waiting.length ? <StaffPill tone="attention">{waiting.length} waiting</StaffPill> : undefined} />
      {waiting.length === 0 ? <p className="text-sm text-student-muted">Nothing waiting.</p> : (
        <ul className="divide-y divide-student-line">
          {waiting.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <span className="min-w-0">Submitted {stamp(e.submittedAt)}{e.note ? <span className="text-student-muted"> · {e.note}</span> : null}</span>
              <span className="flex flex-wrap gap-2">
                <Button type="button" className={staffBtn.outline} variant="outline" onClick={() => openDocument(e.documentId).catch((err: Error) => setOpenError(err))}><ExternalLink className="h-4 w-4" />View file</Button>
                <Button type="button" className={staffBtn.seal} onClick={() => { resetError(); setConfirming(e); }} data-testid={`button-confirm-evidence-${e.id}`}>Confirm as payment</Button>
                <Button type="button" className={staffBtn.outline} variant="outline" onClick={() => { resetError(); setRejecting(e.id); }}>Reject</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {openError && <div className="mt-3"><ErrorLine error={openError} /></div>}
      {reviewed.length > 0 && <p className="mt-3 text-xs text-student-muted">{reviewed.length} reviewed ({reviewed.filter((e) => e.status === "confirmed").length} confirmed, {reviewed.filter((e) => e.status === "rejected").length} rejected).</p>}
      <ReceiptDialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)} currency={s.currency} pending={pending} error={error} title="Confirm as payment"
        description="Enter what you verified on the evidence. This counts as paid and cannot be confirmed twice." submitLabel="Confirm payment"
        onSubmit={(v) => confirming && run({ path: `/evidence/${confirming.id}/confirm`, body: v }, () => setConfirming(null))} />
      <ReasonDialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)} testId="dialog-reject-evidence" title="Reject evidence"
        description="The balance does not change. The reason is kept in the audit trail." confirmLabel="Reject evidence" pending={pending} error={error}
        onConfirm={(r) => rejecting && run({ path: `/evidence/${rejecting}/reject`, body: { reason: r } }, () => setRejecting(null))} />
    </StaffCard>
  );
}

export { StaffEmpty };
