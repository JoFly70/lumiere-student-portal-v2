/** Shared dialogs for the staff billing page (S19): a reason-required confirmation and the receipt form. */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { staffBtn, staffField, StaffNotice } from "@/components/staff/staff-ui";
import { parseMoneyToCents } from "./money";

/** Today's date in the staff member's own time zone (a UTC date would be tomorrow on an Americas evening). */
export const todayIso = () => { const d = new Date(); const pad = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export function ErrorLine({ error }: { error: Error | null | undefined }) {
  if (!error) return null;
  return <StaffNotice tone="urgent" role="alert">{error.message}</StaffNotice>;
}

/** Destructive action that needs a written reason (void receipt, remove discount, reject evidence). */
export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, pending, error, onConfirm, testId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  error?: Error | null;
  onConfirm: (reason: string) => void;
  testId: string;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  const clean = reason.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`${testId}-reason`}>Reason (kept in the audit trail)</Label>
          <textarea id={`${testId}-reason`} className={`${staffField} py-2`} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <ErrorLine error={error} />
        <DialogFooter>
          <Button type="button" className={staffBtn.outline} variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="button" className={staffBtn.danger} disabled={!clean || pending} onClick={() => onConfirm(clean)} data-testid={`${testId}-confirm`}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ReceiptFormValue {
  amountCents: number;
  receivedDate: string;
  methodLabel: string;
  reference?: string;
  note?: string;
}

/** Record a payment, or confirm uploaded evidence as a payment (same fields). */
export function ReceiptDialog({ open, onOpenChange, title, description, currency, pending, error, onSubmit, submitLabel }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  currency: string;
  pending: boolean;
  error?: Error | null;
  onSubmit: (value: ReceiptFormValue) => void;
  submitLabel: string;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [method, setMethod] = useState("Bank transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { if (open) { setAmount(""); setDate(todayIso()); setMethod("Bank transfer"); setReference(""); setNote(""); } }, [open]);
  const cents = parseMoneyToCents(amount, currency);
  const valid = cents !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) && method.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-receipt">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rc-amount">Amount received ({currency})</Label>
            <input id="rc-amount" inputMode="decimal" className={staffField} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" aria-invalid={amount !== "" && cents === null} data-testid="input-receipt-amount" />
            {amount !== "" && cents === null && <p className="text-xs text-st-urgent">Enter a positive amount, e.g. 1250.50</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rc-date">Date received</Label>
            <input id="rc-date" type="date" className={staffField} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rc-method">Method</Label>
            <input id="rc-method" className={staffField} value={method} maxLength={80} onChange={(e) => setMethod(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rc-ref">Reference (optional)</Label>
            <input id="rc-ref" className={staffField} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rc-note">Internal note (optional)</Label>
            <input id="rc-note" className={staffField} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <ErrorLine error={error} />
        <DialogFooter>
          <Button type="button" className={staffBtn.outline} variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="button" className={staffBtn.seal} disabled={!valid || pending} data-testid="button-submit-receipt"
            onClick={() => cents !== null && onSubmit({ amountCents: cents, receivedDate: date, methodLabel: method.trim(), reference: reference.trim() || undefined, note: note.trim() || undefined })}>
            {pending ? "Saving…" : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
