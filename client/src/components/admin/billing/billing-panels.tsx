/**
 * Staff billing sections rendered inside the Billing tab's "Advanced" area (S19/S26/S32-B): the agreed price and the
 * supporting-evidence panel. Every action returns the refreshed view, so the page never computes money itself.
 * Proof of payment can be registered from a document the student already uploaded (no second copy) or from a new file.
 */
import React from "react";
import { useRef, useState } from "react";
import { ExternalLink, FileUp, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney, type BillingEvidenceRow, type StaffBillingView } from "@shared/billing-contract";
import type { StudentDocument } from "@shared/schema";
import { StaffCard, StaffPill, StaffSectionHeader, staffBtn, staffField, staffLabel } from "@/components/staff/staff-ui";
import { formatBillingDate, type StaffBillingCall } from "@/lib/billing-queries";
import { fetchDocumentWithDownloadUrl, useCreateDocument, useGenerateUploadUrl } from "@/hooks/use-documents";
import { STAFF_UPLOAD_ACCEPT, staffUploadMime, validateStaffUploadFile } from "@/components/admin/student-documents-upload-logic";
import { useT, type TranslationKey } from "@/i18n";
import { localeOf } from "@/lib/owner-presentation";
import { ErrorLine, ReasonDialog, ReceiptDialog } from "./billing-dialogs";
import { centsToInput, parseMoneyToCents } from "./money";
import { obligationFormProblemKind, type ObligationProblemKind } from "./billing-summary";

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
const stamp = (iso: string) => iso.slice(0, 10);
/** The failure of the last action, only when it belongs to the panel that owns `prefix`. */
const mine = (p: Pick<PanelProps, "error" | "errorPath">, prefix: string): Error | null => (p.errorPath?.startsWith(prefix) ? p.error : null);

const PROBLEM_KEY: Record<ObligationProblemKind, TranslationKey> = {
  currency: "s32.bill.ob.problem.currency",
  amountEmpty: "s32.bill.ob.problem.amountEmpty",
  amountInvalid: "s32.bill.ob.problem.amountInvalid",
  belowDiscounts: "s32.bill.ob.problem.belowDiscounts",
};

export function ObligationPanel(props: PanelProps) {
  const { t } = useT();
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
  const problemKind = obligationFormProblemKind({ amountText: amount, currency, cents, discountCents: configured ? s.discountCents : 0 });
  const showProblem = problemKind && (submitted || amount !== "");
  const locked = configured && (view.receipts.length > 0 || view.discounts.length > 0 || view.voidedReceipts.length > 0);
  const startEdit = () => { const v = fromView(); setAmount(v.amount); setCurrency(v.currency); setNote(v.note); setSubmitted(false); props.resetError(); setEditing(true); };
  return (
    <StaffCard data-testid="billing-obligation">
      <StaffSectionHeader level={3} title={t("s32.bill.ob.title")}
        description={configured ? t("s32.bill.ob.descSet") : t("s32.bill.ob.descNew")}
        actions={configured && !editing ? <Button type="button" className={staffBtn.outline} variant="outline" onClick={startEdit} data-testid="button-edit-obligation"><Pencil className="h-4 w-4" />{t("s32.bill.ob.edit")}</Button> : undefined} />
      {configured && !editing ? (
        <div className="space-y-1">
          <p className="font-serif text-3xl tabular-nums text-student-ink" data-testid="text-agreed">{formatMoney(s.agreedCents, s.currency)}</p>
          <p className="break-words text-sm text-student-muted" data-testid="text-obligation-note">{view.obligationNote ? view.obligationNote : t("s32.bill.ob.noNote")}</p>
        </div>
      ) : (
        <form className="space-y-3" noValidate onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          if (problemKind || cents === null) return;
          run({ path: "/obligation", body: { agreedCents: cents, currency: cur, ...(note.trim() ? { note: note.trim() } : {}) } }, () => setEditing(false));
        }}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
            <label className="text-sm"><span className={staffLabel}>{t("s32.bill.ob.amount")}</span>
              <input className={`${staffField} mt-1`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12000.00" data-testid="input-agreed" aria-invalid={!!showProblem} aria-describedby="obl-problem" /></label>
            <label className="text-sm"><span className={staffLabel}>{t("s32.bill.ob.currency")}</span>
              <input className={`${staffField} mt-1 uppercase`} maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={locked} data-testid="input-currency" /></label>
          </div>
          {locked ? <p className="text-xs text-student-muted">{t("s32.bill.ob.locked")}</p> : null}
          <label className="block text-sm"><span className={staffLabel}>{t("s32.bill.ob.note")}</span>
            <input className={`${staffField} mt-1`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("s32.bill.ob.notePlaceholder")} data-testid="input-obligation-note" /></label>
          <p id="obl-problem" role={showProblem ? "alert" : undefined} className="min-h-5 text-xs text-st-urgent">{showProblem && problemKind ? t(PROBLEM_KEY[problemKind]) : ""}</p>
          <ErrorLine error={mine(props, "/obligation")} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className={staffBtn.seal} disabled={pending} data-testid="button-save-obligation">{pending ? t("s32.bill.saving") : configured ? t("s32.bill.ob.save") : t("s32.bill.ob.set")}</Button>
            {configured && <Button type="button" className={staffBtn.ghost} variant="ghost" onClick={() => setEditing(false)}>{t("s32.bill.cancel")}</Button>}
          </div>
        </form>
      )}
    </StaffCard>
  );
}

async function openDocument(documentId: string) {
  const doc = await fetchDocumentWithDownloadUrl(documentId);
  window.open(doc.download_url, "_blank", "noopener,noreferrer");
}

const EVIDENCE_LABEL: Record<BillingEvidenceRow["status"], TranslationKey> = { awaiting_review: "s32.bill.ev.st.awaiting", confirmed: "s32.bill.ev.st.confirmed", rejected: "s32.bill.ev.st.rejected" };
const EVIDENCE_TONE = { awaiting_review: "attention", confirmed: "seal", rejected: "urgent" } as const;
const DOC_STATUS_KEY: Record<string, TranslationKey> = {
  pending: "s32.bill.ev.doc.pending", verified: "s32.bill.ev.doc.verified", rejected: "s32.bill.ev.doc.rejected", resubmit_requested: "s32.bill.ev.doc.resubmit",
};

/**
 * Documents the student already uploaded that can back a payment: not yet registered as live evidence, pending
 * review ones first (that is where a transfer slip usually sits), then by name.
 */
export function selectableEvidenceDocuments(documents: readonly StudentDocument[], evidence: readonly BillingEvidenceRow[]): StudentDocument[] {
  const taken = new Set(evidence.filter((e) => e.status !== "rejected").map((e) => e.documentId));
  return documents
    .filter((d) => !taken.has(d.id))
    .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || a.file_name.localeCompare(b.file_name));
}

/** Register proof from a document the student already uploaded (no copy is made), or upload a new file and register it. */
function EvidenceUpload(props: PanelProps) {
  const { t } = useT();
  const { studentId, pending, run, documents, view } = props;
  const generateUploadUrl = useGenerateUploadUrl(studentId);
  const createDocument = useCreateDocument(studentId);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [existingId, setExistingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<{ id: string; name: string } | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const candidates = selectableEvidenceDocuments(documents, view.evidence);

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
      setUploaded(null); setFile(null); setNote(""); setExistingId(""); setOk(t("s32.bill.ev.registered", { name }));
      if (input.current) input.current.value = "";
    });
  };
  const registerExisting = () => {
    const doc = candidates.find((d) => d.id === existingId);
    if (doc) register(doc.id, doc.file_name);
  };
  const submit = async () => {
    if (uploaded) return register(uploaded.id, uploaded.name);
    if (!file || busy) return;
    setBusy(true); setProblem(null); setOk(null);
    try {
      const mime = staffUploadMime(file) ?? file.type;
      const signed = await generateUploadUrl.mutateAsync({ doc_type: "other", file_name: file.name, file_size: file.size, mime_type: mime });
      const put = await fetch(signed.upload_url, { method: "PUT", body: file, headers: { "Content-Type": mime } });
      if (!put.ok) throw new Error(t("s32.bill.ev.storeFailed"));
      const doc = await createDocument.mutateAsync({ doc_type: "other", file_name: file.name, storage_path: signed.storage_path, notes: "Payment evidence registered in Billing" });
      setUploaded({ id: doc.id, name: file.name });
      register(doc.id, file.name);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : t("s32.bill.ev.uploadFailed"));
    } finally {
      setBusy(false);
    }
  };
  const working = busy || pending;
  return (
    <div className="space-y-4 rounded-xl border border-dashed border-student-line-strong bg-student-gold-soft/30 p-4" data-testid="evidence-upload">
      <p className={staffLabel}>{t("s32.bill.ev.register")}</p>
      <label className="block text-sm"><span className={staffLabel}>{t("s32.bill.ev.note")}</span>
        <input className={`${staffField} mt-1`} maxLength={500} value={note} disabled={working} onChange={(e) => setNote(e.target.value)} placeholder={t("s32.bill.ev.notePlaceholder")} data-testid="input-evidence-note" /></label>

      <div className="space-y-2" data-testid="evidence-existing">
        <p className="text-sm font-medium text-student-ink">{t("s32.bill.ev.existingTitle")}</p>
        {candidates.length === 0 ? <p className="text-sm text-student-muted" data-testid="evidence-existing-empty">{t("s32.bill.ev.existingNone")}</p> : (
          <>
            <p className="text-sm text-student-muted">{t("s32.bill.ev.existingHelp")}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select className={`${staffField} min-w-0 flex-1`} value={existingId} disabled={working} onChange={(e) => { setExistingId(e.target.value); setOk(null); }} aria-label={t("s32.bill.ev.existingTitle")} data-testid="select-evidence-document">
                <option value="">{t("s32.bill.ev.existingChoose")}</option>
                {candidates.map((d) => <option key={d.id} value={d.id}>{d.file_name} · {DOC_STATUS_KEY[d.status] ? t(DOC_STATUS_KEY[d.status]!) : d.status}</option>)}
              </select>
              <Button type="button" className={staffBtn.seal} disabled={!existingId || working} onClick={registerExisting} data-testid="button-register-existing-evidence">
                {pending ? t("s32.bill.ev.registering") : t("s32.bill.ev.useExisting")}
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="space-y-2 border-t border-student-line pt-3">
        <p className="text-sm font-medium text-student-ink">{t("s32.bill.ev.newTitle")}</p>
        <p className="text-sm text-student-muted">{t("s32.bill.ev.newHelp")}</p>
        <label className="block text-sm"><span className={staffLabel}>{t("s32.bill.ev.file")}</span>
          <input ref={input} type="file" accept={STAFF_UPLOAD_ACCEPT} disabled={working || !!uploaded} className={`${staffField} mt-1 py-1.5`} data-testid="input-evidence-file" onChange={(e) => choose(e.currentTarget.files?.[0] ?? null)} /></label>
        {problem ? <p role="alert" className="text-xs text-st-urgent" data-testid="evidence-upload-problem">{problem}</p> : null}
        {uploaded ? <p className="text-xs text-student-muted">{t("s32.bill.ev.uploadedNotRegistered", { name: uploaded.name })}</p> : null}
        <Button type="button" className={staffBtn.seal} disabled={(!file && !uploaded) || working} onClick={() => void submit()} data-testid="button-register-evidence">
          <FileUp className="h-4 w-4" aria-hidden="true" />{busy ? t("s32.bill.ev.uploading") : pending ? t("s32.bill.ev.registering") : uploaded ? t("s32.bill.ev.registerUploaded") : t("s32.bill.ev.uploadRegister")}
        </Button>
      </div>
      <ErrorLine error={mine(props, "/evidence")} />
      {ok ? <p role="status" className="text-sm text-student-ink" data-testid="evidence-ok">{ok}</p> : null}
    </div>
  );
}

export function EvidencePanel(props: PanelProps) {
  const { t, language } = useT();
  const fmt = (iso: string) => formatBillingDate(iso, localeOf(language));
  const { view, documents, pending, error, run, resetError } = props;
  const s = view.student;
  const [confirming, setConfirming] = useState<BillingEvidenceRow | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [openError, setOpenError] = useState<Error | null>(null);
  if (s.state !== "configured") return null;
  const waiting = view.evidence.filter((e) => e.status === "awaiting_review");
  const sorted = [...view.evidence].sort((a, b) => (a.status === "awaiting_review" ? 0 : 1) - (b.status === "awaiting_review" ? 0 : 1) || b.submittedAt.localeCompare(a.submittedAt));
  const nameOf = (id: string) => documents.find((d) => d.id === id)?.file_name ?? t("s32.bill.ev.uploadedFile");
  return (
    <StaffCard data-testid="billing-evidence" className="space-y-4">
      <StaffSectionHeader level={3} className="mb-0" title={t("s32.bill.ev.title")} description={t("s32.bill.ev.desc")} actions={waiting.length ? <StaffPill tone="attention">{t("s32.bill.ev.toReview", { n: waiting.length })}</StaffPill> : undefined} />
      <EvidenceUpload {...props} />
      {sorted.length === 0 ? <p className="text-sm text-student-muted" data-testid="evidence-empty">{t("s32.bill.ev.empty")}</p> : (
        <ul className="divide-y divide-student-line" data-testid="evidence-list">
          {sorted.map((e) => (
            <li key={e.id} className="space-y-2 py-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0 break-words font-medium text-student-ink">{nameOf(e.documentId)}</span>
                <StaffPill tone={EVIDENCE_TONE[e.status]}>{t(EVIDENCE_LABEL[e.status])}</StaffPill>
              </div>
              <p className="break-words text-xs text-student-muted">{t("s32.bill.ev.registeredOn", { date: fmt(stamp(e.submittedAt)) })}{e.note ? ` · ${e.note}` : ""}{e.status === "rejected" && e.rejectReason ? ` · ${t("s32.bill.ev.rejectedReason", { reason: e.rejectReason })}` : ""}{e.status === "confirmed" ? ` · ${t("s32.bill.ev.counted")}` : ""}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" className={staffBtn.outline} variant="outline" onClick={() => openDocument(e.documentId).then(() => setOpenError(null)).catch((err: Error) => setOpenError(err))}><ExternalLink className="h-4 w-4" />{t("s32.bill.ev.viewFile")}</Button>
                {e.status === "awaiting_review" ? (
                  <>
                    <Button type="button" className={staffBtn.seal} onClick={() => { resetError(); setConfirming(e); }} data-testid={`button-confirm-evidence-${e.id}`}>{t("s32.bill.ev.confirm")}</Button>
                    <Button type="button" className={staffBtn.outline} variant="outline" onClick={() => { resetError(); setRejecting(e.id); }} data-testid={`button-reject-evidence-${e.id}`}>{t("s32.bill.ev.reject")}</Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {openError && <ErrorLine error={openError} />}
      <ReceiptDialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)} currency={s.currency} pending={pending} error={error} title={t("s32.bill.ev.confirm")}
        description={t("s32.bill.ev.confirmDesc")} submitLabel={t("s32.bill.ev.confirmSubmit")}
        onSubmit={(v) => confirming && run({ path: `/evidence/${confirming.id}/confirm`, body: v }, () => setConfirming(null))} />
      <ReasonDialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)} testId="dialog-reject-evidence" title={t("s32.bill.ev.rejectTitle")}
        description={t("s32.bill.ev.rejectDesc")} confirmLabel={t("s32.bill.ev.rejectTitle")} pending={pending} error={error}
        onConfirm={(r) => rejecting && run({ path: `/evidence/${rejecting}/reject`, body: { reason: r } }, () => setRejecting(null))} />
    </StaffCard>
  );
}
