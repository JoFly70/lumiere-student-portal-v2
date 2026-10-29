/** Staff billing sections (S19/S26). Every action returns the refreshed view, so the page never computes money itself. */
import React from "react";
import { useRef, useState } from "react";
import { AlertTriangle, ExternalLink, FileUp, Pencil, Plus, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney, type BillingEvidenceRow, type StaffBillingView } from "@shared/billing-contract";
import type { StudentDocument } from "@shared/schema";
import { StaffCard, StaffEmpty, StaffNotice, StaffPill, StaffSectionHeader, staffBtn, staffField, staffLabel, staffTable } from "@/components/staff/staff-ui";
import { formatBillingDate, paidPercent, type StaffBillingCall } from "@/lib/billing-queries";
import { fetchDocumentWithDownloadUrl, useCreateDocument, useGenerateUploadUrl } from "@/hooks/use-documents";
import { STAFF_UPLOAD_ACCEPT, staffUploadMime, validateStaffUploadFile } from "@/components/admin/student-documents-upload-logic";
import { ErrorLine, ReasonDialog, ReceiptDialog } from "./billing-dialogs";
import { InstallmentEditDialog, ScheduleDialog } from "./schedule-editor";
import { centsToInput, parseMoneyToCents } from "./money";
import { BILLING_STATUS_LABEL, BILLING_STATUS_TONE, billingHistory, obligationFormProblem, summarizeBilling, type BillingHistoryKind } from "./billing-summary";

void React;

export interface PanelProps {
  readonly studentId: string;
  readonly view: StaffBillingView;
  readonly documents: readonly StudentDocument[];
  readonly pending: boolean;
  readonly error: Error | null;
  /** Path of the call that produced `error` (e.g. "/receipts"), so each panel shows only its own failure. */
  readonly errorPath: string | null;
  readonly run: (call: StaffBillingCall, onDone?: () => void) => void;
  readonly resetError: () => void;
}
const fmt = (iso: string) => formatBillingDate(iso, "en-US");
const stamp = (iso: string) => iso.slice(0, 10);
/** The failure of the last action, only when it belongs to the panel that owns `prefix`. */
const mine = (p: Pick<PanelProps, "error" | "errorPath">, prefix: string): Error | null => (p.errorPath?.startsWith(prefix) ? p.error : null);

const INSTALLMENT_TONE = { paid: "gold", partially_paid: "neutral", upcoming: "dashed", due: "attention", overdue: "urgent" } as const;
const INSTALLMENT_LABEL = { paid: "Paid", partially_paid: "Part paid", upcoming: "Upcoming", due: "Due today", overdue: "Overdue" } as const;

/** Balance statement: original agreed, adjustments, net, paid, remaining, status. */
export function BalanceSummary({ view }: { view: StaffBillingView }) {
  const sum = summarizeBilling(view);
  const s = view.student;
  if (!sum.configured || s.state !== "configured") return null;
  const m = (c: number) => formatMoney(c, s.currency);
  const pct = paidPercent(sum.paidCents, sum.netCents);
  const rows: { label: string; value: string; strong?: boolean; hint?: string; testId: string }[] = [
    { label: "Original agreed price", value: m(sum.agreedCents), testId: "bal-agreed" },
    { label: "Adjustments (approved discounts)", value: sum.adjustmentsCents > 0 ? `− ${m(sum.adjustmentsCents)}` : m(0), testId: "bal-adjustments" },
    { label: "Net amount due", value: m(sum.netCents), strong: true, testId: "bal-net" },
    { label: "Paid (confirmed payments only)", value: m(sum.paidCents), hint: `${s.receipts.length} payment${s.receipts.length === 1 ? "" : "s"}`, testId: "bal-paid" },
    { label: sum.creditCents > 0 ? "Credit (paid above the amount due)" : "Remaining", value: m(sum.creditCents > 0 ? sum.creditCents : sum.remainingCents), strong: true, testId: "bal-remaining" },
  ];
  return (
    <StaffCard data-testid="billing-summary" className="space-y-4">
      <StaffSectionHeader level={3} className="mb-0" title="Balance" description="Everything below is computed from confirmed entries. Evidence a student submitted counts only once you confirm it."
        actions={<StaffPill tone={BILLING_STATUS_TONE[sum.status]} testId="billing-status-pill">{BILLING_STATUS_LABEL[sum.status]}</StaffPill>} />
      <dl className="divide-y divide-student-line">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
            <dt className={`text-sm ${r.strong ? "font-semibold text-student-ink" : "text-student-muted"}`}>{r.label}{r.hint ? <span className="ml-2 text-xs text-student-muted">{r.hint}</span> : null}</dt>
            <dd className={`tabular-nums ${r.strong ? "font-serif text-2xl text-student-ink" : "text-base text-student-ink"}`} data-testid={r.testId}>{r.value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <div role="img" aria-label={`${pct}% of the amount due is paid`} className="h-2 overflow-hidden rounded-full bg-student-line"><div className="h-full rounded-full bg-student-gold-ink" style={{ width: `${pct}%` }} /></div>
        <p className="mt-1.5 text-xs text-student-muted">{pct}% paid{s.nextDue ? ` · next due ${fmt(s.nextDue.dueDate)} (${m(s.nextDue.amountCents)})${s.nextDue.status === "overdue" ? ", overdue" : ""}` : ""}</p>
      </div>
    </StaffCard>
  );
}

/** First setup, and later edits of the agreed price, currency and note. */
export function ObligationPanel(props: PanelProps) {
  const { view, pending, run } = props;
  const s = view.student;
  const configured = s.state === "configured";
  const fromView = () => ({ amount: configured ? centsToInput(s.agreedCents, s.currency) : "", currency: configured ? s.currency : "USD", note: view.obligationNote ?? "" });
  const [editing, setEditing] = useState(!configured);
  const [amount, setAmount] = useState(fromView().amount);
  const [currency, setCurrency] = useState(fromView().currency);
  const [note, setNote] = useState(fromView().note);
  const [submitted, setSubmitted] = useState(false);
  const cur = currency.trim().toUpperCase();
  const cents = /^[A-Za-z]{3}$/.test(cur) ? parseMoneyToCents(amount, cur) : null;
  const problem = obligationFormProblem({ amountText: amount, currency, cents, discountCents: configured ? s.discountCents : 0 });
  const showProblem = problem && (submitted || amount !== "");
  const locked = configured && (view.receipts.length > 0 || view.discounts.length > 0 || view.voidedReceipts.length > 0);
  const startEdit = () => { const v = fromView(); setAmount(v.amount); setCurrency(v.currency); setNote(v.note); setSubmitted(false); props.resetError(); setEditing(true); };
  return (
    <StaffCard data-testid="billing-obligation">
      <StaffSectionHeader level={3} title="Agreed program price"
        description={configured ? "What the student agreed to pay before any adjustment." : "Start here: set the agreed price. Adjustments, the schedule and payments follow."}
        actions={configured && !editing ? <Button type="button" className={staffBtn.outline} variant="outline" onClick={startEdit} data-testid="button-edit-obligation"><Pencil className="h-4 w-4" />Edit</Button> : undefined} />
      {configured && !editing ? (
        <div className="space-y-1">
          <p className="font-serif text-3xl tabular-nums text-student-ink" data-testid="text-agreed">{formatMoney(s.agreedCents, s.currency)}</p>
          <p className="break-words text-sm text-student-muted" data-testid="text-obligation-note">{view.obligationNote ? view.obligationNote : "No note."}</p>
        </div>
      ) : (
        <form className="space-y-3" noValidate onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          if (problem || cents === null) return;
          run({ path: "/obligation", body: { agreedCents: cents, currency: cur, ...(note.trim() ? { note: note.trim() } : {}) } }, () => setEditing(false));
        }}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
            <label className="text-sm"><span className={staffLabel}>Amount</span>
              <input className={`${staffField} mt-1`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12000.00" data-testid="input-agreed" aria-invalid={!!showProblem} aria-describedby="obl-problem" /></label>
            <label className="text-sm"><span className={staffLabel}>Currency</span>
              <input className={`${staffField} mt-1 uppercase`} maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={locked} data-testid="input-currency" /></label>
          </div>
          {locked ? <p className="text-xs text-student-muted">The currency is fixed once payments or adjustments exist.</p> : null}
          <label className="block text-sm"><span className={staffLabel}>Note (internal, optional)</span>
            <input className={`${staffField} mt-1`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Contract signed 12 Oct, price per agreement v2" data-testid="input-obligation-note" /></label>
          <p id="obl-problem" role={showProblem ? "alert" : undefined} className="min-h-5 text-xs text-st-urgent">{showProblem ? problem : ""}</p>
          <ErrorLine error={mine(props, "/obligation")} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className={staffBtn.seal} disabled={pending} data-testid="button-save-obligation">{pending ? "Saving…" : configured ? "Save price" : "Set agreed price"}</Button>
            {configured && <Button type="button" className={staffBtn.ghost} variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
          </div>
        </form>
      )}
    </StaffCard>
  );
}

export function DiscountPanel(props: PanelProps) {
  const { view, pending, error, run, resetError } = props;
  const s = view.student;
  const currency = s.state === "configured" ? s.currency : "USD";
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const cents = parseMoneyToCents(amount, currency);
  const room = s.state === "configured" ? s.agreedCents - s.discountCents : 0;
  const problem = amount.trim() === "" ? "Enter the adjustment amount."
    : cents === null ? "Enter a positive amount, for example 500.00."
    : cents > room ? `This would exceed the agreed price. At most ${formatMoney(room, currency)} can still be adjusted.`
    : !reason.trim() ? "A reason is required and is kept in the audit trail." : null;
  return (
    <StaffCard data-testid="billing-discounts">
      <StaffSectionHeader level={3} title="Adjustments and discounts" description="Approved reductions of the agreed price. Each one needs a reason. Voiding keeps the entry in the history." />
      {view.discounts.length === 0 ? <p className="mb-4 text-sm text-student-muted">No adjustments.</p> : (
        <ul className="mb-4 divide-y divide-student-line">
          {view.discounts.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 text-sm">
              <span className="min-w-0 flex-1 basis-48"><span className="font-medium tabular-nums">− {formatMoney(d.amountCents, currency)}</span> <span className="break-words text-student-muted">· {d.reason} · {fmt(stamp(d.approvedAt))}</span></span>
              <Button type="button" className={staffBtn.ghost} variant="ghost" onClick={() => { resetError(); setRemoving(d.id); }} data-testid={`button-void-discount-${d.id}`}><Undo2 className="h-4 w-4" />Void</Button>
            </li>
          ))}
        </ul>
      )}
      <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); setSubmitted(true); if (problem || cents === null) return; run({ path: "/discounts", body: { amountCents: cents, reason: reason.trim() } }, () => { setAmount(""); setReason(""); setSubmitted(false); }); }}>
        <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <label className="text-sm"><span className={staffLabel}>Amount ({currency})</span><input className={`${staffField} mt-1`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-discount-amount" aria-invalid={submitted && !!problem} /></label>
          <label className="text-sm"><span className={staffLabel}>Reason</span><input className={`${staffField} mt-1`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Early enrollment, sibling discount" data-testid="input-discount-reason" aria-invalid={submitted && !!problem} /></label>
        </div>
        <p role={submitted && problem ? "alert" : undefined} className="min-h-5 text-xs text-st-urgent">{submitted && problem ? problem : ""}</p>
        <ErrorLine error={mine(props, "/discounts")} />
        <Button type="submit" className={staffBtn.outline} variant="outline" disabled={pending} data-testid="button-add-discount"><Plus className="h-4 w-4" />Add adjustment</Button>
      </form>
      <ReasonDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)} testId="dialog-remove-discount" title="Void this adjustment"
        description="The adjustment stops reducing the amount due. It is never deleted: it stays in the history with your reason." confirmLabel="Void adjustment" pending={pending} error={error}
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
      {s.installments.length === 0 ? <div className="p-5 pt-0 text-sm text-student-muted">No schedule yet. Create one to spread the amount due over dates.</div> : (
        <>
          <div className="relative hidden overflow-x-auto md:block">
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
          <ul className="divide-y divide-student-line px-4 pb-2 md:hidden" data-testid="schedule-cards">
            {s.installments.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div className="min-w-0"><p className="font-medium tabular-nums">{fmt(i.dueDate)} · {formatMoney(i.amountCents, s.currency)}</p><p className="text-xs text-student-muted">{i.label ?? "Installment"} · covered {formatMoney(i.allocatedCents, s.currency)}</p></div>
                <div className="flex items-center gap-1"><StaffPill tone={INSTALLMENT_TONE[i.status]}>{INSTALLMENT_LABEL[i.status]}</StaffPill><Button type="button" className={staffBtn.ghost} variant="ghost" aria-label={`Edit installment due ${i.dueDate}`} onClick={() => { resetError(); setEditId(i.id); }}><Pencil className="h-4 w-4" /></Button></div>
              </li>
            ))}
          </ul>
        </>
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
      {view.receipts.length === 0 ? <div className="p-5 pt-0 text-sm text-student-muted" data-testid="receipts-empty">No payments confirmed yet. Record one when money is received, or confirm uploaded evidence.</div> : (
        <>
          <div className="relative hidden overflow-x-auto md:block">
            <table className={staffTable.table}>
              <thead><tr><th className={staffTable.th}>Received</th><th className={staffTable.th}>Method</th><th className={staffTable.th}>Reference</th><th className={`${staffTable.th} text-right`}>Amount</th><th className={staffTable.th}><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {view.receipts.map((r) => (
                  <tr key={r.id} className={staffTable.tr}>
                    <td className={`${staffTable.td} tabular-nums`}>{fmt(r.receivedDate)}</td>
                    <td className={staffTable.td}>{r.methodLabel}{r.evidenceId ? <span className="ml-2 text-xs text-student-muted">from evidence</span> : null}{r.note ? <span className="block text-xs text-student-muted">{r.note}</span> : null}</td>
                    <td className={`${staffTable.td} break-all text-student-muted`}>{r.reference ?? "·"}</td>
                    <td className={`${staffTable.td} text-right tabular-nums`}>{formatMoney(r.amountCents, s.currency)}</td>
                    <td className={`${staffTable.td} text-right`}><Button type="button" className={staffBtn.ghost} variant="ghost" onClick={() => { resetError(); setVoiding(r.id); }} data-testid={`button-void-${r.id}`}><Undo2 className="h-4 w-4" />Void</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-student-line px-4 pb-2 md:hidden" data-testid="receipt-cards">
            {view.receipts.map((r) => (
              <li key={r.id} className="space-y-1 py-3 text-sm">
                <div className="flex items-baseline justify-between gap-2"><span className="font-medium tabular-nums">{formatMoney(r.amountCents, s.currency)}</span><span className="text-xs tabular-nums text-student-muted">{fmt(r.receivedDate)}</span></div>
                <p className="break-words text-xs text-student-muted">{r.methodLabel}{r.reference ? ` · ref. ${r.reference}` : ""}{r.evidenceId ? " · from evidence" : ""}{r.note ? ` · ${r.note}` : ""}</p>
                <Button type="button" className={staffBtn.ghost} variant="ghost" onClick={() => { resetError(); setVoiding(r.id); }} data-testid={`button-void-${r.id}-m`}><Undo2 className="h-4 w-4" />Void payment</Button>
              </li>
            ))}
          </ul>
        </>
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

const EVIDENCE_LABEL = { awaiting_review: "Awaiting review", confirmed: "Confirmed", rejected: "Rejected" } as const;
const EVIDENCE_TONE = { awaiting_review: "attention", confirmed: "seal", rejected: "urgent" } as const;

/** Upload a supporting file for the student (same storage flow as staff document upload), then register it as evidence. */
function EvidenceUpload(props: PanelProps) {
  const { studentId, pending, run } = props;
  const generateUploadUrl = useGenerateUploadUrl(studentId);
  const createDocument = useCreateDocument(studentId);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<{ id: string; name: string } | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const choose = (f: File | null) => {
    setOk(null);
    if (!f) { setFile(null); setProblem(null); return; }
    const v = validateStaffUploadFile(f);
    setFile(v.valid ? f : null);
    setProblem(v.valid ? null : v.message);
    if (!v.valid && input.current) input.current.value = "";
  };
  const register = (docId: string, name: string) => {
    run({ path: "/evidence", body: { documentId: docId, ...(note.trim() ? { note: note.trim() } : {}) } }, () => {
      setUploaded(null); setFile(null); setNote(""); setOk(`"${name}" is registered and waiting for your review.`);
      if (input.current) input.current.value = "";
    });
  };
  const submit = async () => {
    if (uploaded) return register(uploaded.id, uploaded.name);
    if (!file || busy) return;
    setBusy(true); setProblem(null); setOk(null);
    try {
      const mime = staffUploadMime(file) ?? file.type;
      const signed = await generateUploadUrl.mutateAsync({ doc_type: "other", file_name: file.name, file_size: file.size, mime_type: mime });
      const put = await fetch(signed.upload_url, { method: "PUT", body: file, headers: { "Content-Type": mime } });
      if (!put.ok) throw new Error("The file could not be stored. Please try again.");
      const doc = await createDocument.mutateAsync({ doc_type: "other", file_name: file.name, storage_path: signed.storage_path, notes: "Payment evidence registered in Billing" });
      setUploaded({ id: doc.id, name: file.name });
      register(doc.id, file.name);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const working = busy || pending;
  return (
    <div className="space-y-3 rounded-xl border border-dashed border-student-line-strong bg-student-gold-soft/30 p-4" data-testid="evidence-upload">
      <p className={staffLabel}>Register supporting evidence</p>
      <p className="text-sm text-student-muted">Upload a bank slip, receipt or screenshot (PDF, PNG, JPG or WebP, up to 10 MB). The file is stored on the student's documents as pending review.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm"><span className={staffLabel}>File</span>
          <input ref={input} type="file" accept={STAFF_UPLOAD_ACCEPT} disabled={working || !!uploaded} className={`${staffField} mt-1 py-1.5`} data-testid="input-evidence-file" onChange={(e) => choose(e.currentTarget.files?.[0] ?? null)} /></label>
        <label className="text-sm"><span className={staffLabel}>Note (optional)</span>
          <input className={`${staffField} mt-1`} maxLength={500} value={note} disabled={working} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Wire confirmation sent by the family" data-testid="input-evidence-note" /></label>
      </div>
      {problem ? <p role="alert" className="text-xs text-st-urgent" data-testid="evidence-upload-problem">{problem}</p> : null}
      <ErrorLine error={mine(props, "/evidence")} />
      {uploaded ? <p className="text-xs text-student-muted">"{uploaded.name}" is uploaded but not registered yet. Register it to continue.</p> : null}
      {ok ? <p role="status" className="text-sm text-student-ink">{ok}</p> : null}
      <Button type="button" className={staffBtn.seal} disabled={(!file && !uploaded) || working} onClick={() => void submit()} data-testid="button-register-evidence">
        <FileUp className="h-4 w-4" aria-hidden="true" />{busy ? "Uploading…" : pending ? "Registering…" : uploaded ? "Register uploaded file" : "Upload and register"}
      </Button>
    </div>
  );
}

export function EvidencePanel(props: PanelProps) {
  const { view, documents, pending, error, run, resetError } = props;
  const s = view.student;
  const [confirming, setConfirming] = useState<BillingEvidenceRow | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [openError, setOpenError] = useState<Error | null>(null);
  if (s.state !== "configured") return null;
  const waiting = view.evidence.filter((e) => e.status === "awaiting_review");
  const sorted = [...view.evidence].sort((a, b) => (a.status === "awaiting_review" ? 0 : 1) - (b.status === "awaiting_review" ? 0 : 1) || b.submittedAt.localeCompare(a.submittedAt));
  const nameOf = (id: string) => documents.find((d) => d.id === id)?.file_name ?? "Uploaded file";
  return (
    <StaffCard data-testid="billing-evidence" className="space-y-4">
      <StaffSectionHeader level={3} className="mb-0" title="Supporting evidence" description="Proof of payment. It does not change the balance until you confirm it as a payment." actions={waiting.length ? <StaffPill tone="attention">{waiting.length} to review</StaffPill> : undefined} />
      <EvidenceUpload {...props} />
      {sorted.length === 0 ? <p className="text-sm text-student-muted" data-testid="evidence-empty">No evidence registered yet.</p> : (
        <ul className="divide-y divide-student-line" data-testid="evidence-list">
          {sorted.map((e) => (
            <li key={e.id} className="space-y-2 py-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0 break-words font-medium text-student-ink">{nameOf(e.documentId)}</span>
                <StaffPill tone={EVIDENCE_TONE[e.status]}>{EVIDENCE_LABEL[e.status]}</StaffPill>
              </div>
              <p className="break-words text-xs text-student-muted">Registered {fmt(stamp(e.submittedAt))}{e.note ? ` · ${e.note}` : ""}{e.status === "rejected" && e.rejectReason ? ` · Rejected: ${e.rejectReason}` : ""}{e.status === "confirmed" ? " · counted as a payment" : ""}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" className={staffBtn.outline} variant="outline" onClick={() => openDocument(e.documentId).then(() => setOpenError(null)).catch((err: Error) => setOpenError(err))}><ExternalLink className="h-4 w-4" />View file</Button>
                {e.status === "awaiting_review" ? (
                  <>
                    <Button type="button" className={staffBtn.seal} onClick={() => { resetError(); setConfirming(e); }} data-testid={`button-confirm-evidence-${e.id}`}>Confirm as payment</Button>
                    <Button type="button" className={staffBtn.outline} variant="outline" onClick={() => { resetError(); setRejecting(e.id); }} data-testid={`button-reject-evidence-${e.id}`}>Reject</Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {openError && <ErrorLine error={openError} />}
      <ReceiptDialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)} currency={s.currency} pending={pending} error={error} title="Confirm as payment"
        description="Enter what you verified on the evidence. This counts as paid and cannot be confirmed twice." submitLabel="Confirm payment"
        onSubmit={(v) => confirming && run({ path: `/evidence/${confirming.id}/confirm`, body: v }, () => setConfirming(null))} />
      <ReasonDialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)} testId="dialog-reject-evidence" title="Reject evidence"
        description="The balance does not change. The reason is kept in the audit trail." confirmLabel="Reject evidence" pending={pending} error={error}
        onConfirm={(r) => rejecting && run({ path: `/evidence/${rejecting}/reject`, body: { reason: r } }, () => setRejecting(null))} />
    </StaffCard>
  );
}

const HISTORY_TONE: Record<BillingHistoryKind, "gold" | "seal" | "urgent" | "neutral" | "attention"> = {
  payment: "seal", payment_voided: "urgent", adjustment: "gold", adjustment_voided: "urgent",
  evidence_submitted: "neutral", evidence_confirmed: "seal", evidence_rejected: "attention",
};

/** Everything staff did on the ledger, newest first. Voided entries remain visible. */
export function HistoryPanel({ view }: { view: StaffBillingView }) {
  const [all, setAll] = useState(false);
  const entries = billingHistory(view);
  const s = view.student;
  const currency = s.state === "configured" ? s.currency : "USD";
  const shown = all ? entries : entries.slice(0, 8);
  return (
    <StaffCard data-testid="billing-history">
      <StaffSectionHeader level={3} title="History" description="Payments, adjustments and evidence in date order. Corrections are added here, never erased." />
      {entries.length === 0 ? <p className="text-sm text-student-muted">No activity yet.</p> : (
        <>
          <ul className="divide-y divide-student-line">
            {shown.map((h) => (
              <li key={h.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5 text-sm" data-testid="history-item">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-student-ink">{h.title}<StaffPill tone={HISTORY_TONE[h.kind]}>{stamp(h.at)}</StaffPill></p>
                  <p className="break-words text-xs text-student-muted">{h.detail}</p>
                </div>
                {h.amountCents !== null ? <span className={`tabular-nums ${h.kind.endsWith("voided") ? "text-student-muted line-through" : "text-student-ink"}`}>{formatMoney(h.amountCents, currency)}</span> : null}
              </li>
            ))}
          </ul>
          {entries.length > 8 ? <Button type="button" variant="ghost" className={`${staffBtn.ghost} mt-2`} onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${entries.length}`}</Button> : null}
        </>
      )}
    </StaffCard>
  );
}

export { StaffEmpty };
