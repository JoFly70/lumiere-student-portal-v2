import React, { useState } from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { ImportBatchView } from "@shared/s30-contract";
import { ApiError } from "@/lib/api";
import { useApproveImport, useCommitImport, useDiscardImport, useRollbackImport } from "@/lib/s30-import-queries";
import { actionsFor, rollbackReasonValid } from "./import-helpers";
import { BTN_PRIMARY, BTN_SECONDARY, DIALOG_STYLE, FIELD_CLASS, FIELD_STYLE, LABEL_CLASS, LABEL_STYLE, useImpT } from "./imports-parts";

type Dlg = null | "discard" | "commit" | "rollback";

export function ActionsCard({ batch, role, onDiscarded }: { batch: ImportBatchView; role: string | undefined; onDiscarded?: () => void }) {
  const { tt } = useImpT();
  const id = batch.id;
  const a = actionsFor(role, batch.status);
  const approve = useApproveImport(id);
  const commit = useCommitImport(id);
  const rollback = useRollbackImport(id);
  const discard = useDiscardImport(id);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const fail = (e: unknown) => {
    const message = e instanceof Error ? e.message : "";
    setMsg(e instanceof ApiError && e.code === "S30_INVALID_TRANSITION" ? tt("imp.msg.invalidTransition", { message }) : tt("imp.msg.failed", { message }));
    setDlg(null);
  };
  const close = () => { setDlg(null); setReason(""); };
  const counts = batch.counts;
  const nothingToCommit = (counts.valid ?? 0) + (counts.warning ?? 0) === 0;
  const anyAction = a.validate || a.discard || a.approve || a.commit || a.rollback;
  const staffOnly = role === "staff" && (batch.status === "validated" || batch.status === "approved" || batch.status === "committed");

  return (
    <section className="card" aria-labelledby="imp-act-h" data-testid="imp-actions">
      <h2 id="imp-act-h" className="text-lg">{tt("imp.act.title")}</h2>
      <div className="flex flex-wrap gap-2">
        {a.approve && <button type="button" className={BTN_PRIMARY} disabled={approve.isPending || nothingToCommit} data-testid="imp-approve"
          onClick={() => { setMsg(null); approve.mutate(undefined, { onSuccess: () => setMsg(tt("imp.msg.approved")), onError: fail }); }}>{tt("imp.act.approve")}</button>}
        {a.commit && <button type="button" className={BTN_PRIMARY} disabled={commit.isPending} data-testid="imp-commit" onClick={() => { setMsg(null); setDlg("commit"); }}>{tt("imp.act.commit")}</button>}
        {a.rollback && <button type="button" className={BTN_SECONDARY} data-testid="imp-rollback" onClick={() => { setMsg(null); setDlg("rollback"); }}>{tt("imp.act.rollback")}</button>}
        {a.discard && <button type="button" className={BTN_SECONDARY} data-testid="imp-discard" onClick={() => { setMsg(null); setDlg("discard"); }}>{tt("imp.act.discard")}</button>}
      </div>
      {a.approve && <p className="small">{tt("imp.approve.hint")}</p>}
      {a.approve && nothingToCommit && <p className="small">{tt("imp.act.blocked")}</p>}
      {staffOnly && <p className="small" data-testid="imp-staff-note">{tt("imp.act.staffNote")}</p>}
      {!anyAction && !staffOnly && <p className="small">{tt(`imp.status.${batch.status}`)}</p>}
      <p role="status" aria-live="polite" className="text-sm" data-testid="imp-msg">{msg ?? ""}</p>

      <AlertDialog open={dlg === "discard"} onOpenChange={(o) => { if (!o) close(); }}>
        <AlertDialogContent className="s27 occ" style={DIALOG_STYLE} data-testid="imp-discard-dialog">
          <AlertDialogHeader><AlertDialogTitle style={{ color: "var(--t-heading)" }}>{tt("imp.discard.title")}</AlertDialogTitle><AlertDialogDescription style={{ color: "var(--t-muted)" }}>{tt("imp.discard.desc")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={BTN_SECONDARY}>{tt("imp.act.cancel")}</AlertDialogCancel>
            <button type="button" className={BTN_PRIMARY} disabled={discard.isPending} data-testid="imp-discard-confirm"
              onClick={() => discard.mutate(undefined, { onSuccess: () => { close(); setMsg(tt("imp.msg.discarded")); onDiscarded?.(); }, onError: fail })}>{tt("imp.discard.confirm")}</button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dlg === "commit"} onOpenChange={(o) => { if (!o) close(); }}>
        <AlertDialogContent className="s27 occ" style={DIALOG_STYLE} data-testid="imp-commit-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: "var(--t-heading)" }}>{tt("imp.commit.title")}</AlertDialogTitle>
            <AlertDialogDescription style={{ color: "var(--t-muted)" }}>{tt("imp.commit.desc", { new: counts.new ?? 0, changed: counts.changed ?? 0, review: counts.needsReview ?? 0 })}</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm">{tt("imp.integrity.short")}</p>
          <AlertDialogFooter>
            <AlertDialogCancel className={BTN_SECONDARY}>{tt("imp.act.cancel")}</AlertDialogCancel>
            <button type="button" className={BTN_PRIMARY} disabled={commit.isPending} data-testid="imp-commit-confirm"
              onClick={() => commit.mutate(undefined, { onSuccess: (r) => { close(); setMsg(tt("imp.msg.committed", { inserted: r.result.inserted, needsReview: r.result.needsReview })); }, onError: fail })}>{tt("imp.commit.confirm")}</button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dlg === "rollback"} onOpenChange={(o) => { if (!o) close(); }}>
        <AlertDialogContent className="s27 occ" style={DIALOG_STYLE} data-testid="imp-rollback-dialog">
          <AlertDialogHeader><AlertDialogTitle style={{ color: "var(--t-heading)" }}>{tt("imp.rollback.title")}</AlertDialogTitle><AlertDialogDescription style={{ color: "var(--t-muted)" }}>{tt("imp.rollback.desc")}</AlertDialogDescription></AlertDialogHeader>
          <div>
            <label className={LABEL_CLASS} style={LABEL_STYLE} htmlFor="imp-rollback-reason">{tt("imp.rollback.reason")}</label>
            <textarea id="imp-rollback-reason" className={FIELD_CLASS} style={FIELD_STYLE} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby="imp-rollback-hint" data-testid="imp-rollback-reason" />
            <p id="imp-rollback-hint" className="small mt-1">{tt("imp.rollback.reasonHint")}</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className={BTN_SECONDARY}>{tt("imp.act.cancel")}</AlertDialogCancel>
            <button type="button" className={BTN_PRIMARY} disabled={rollback.isPending || !rollbackReasonValid(reason)} data-testid="imp-rollback-confirm"
              onClick={() => rollback.mutate({ reason: reason.trim() }, { onSuccess: () => { close(); setMsg(tt("imp.msg.rolledBack")); }, onError: fail })}>{tt("imp.rollback.confirm")}</button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
