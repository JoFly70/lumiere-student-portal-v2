/** Installment schedule editor (S19): replace the whole schedule, with an even-split helper. Integer cents only. */
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney } from "@shared/billing-contract";
import { staffBtn, staffField } from "@/components/staff/staff-ui";
import { ErrorLine, todayIso } from "./billing-dialogs";
import { centsToInput, parseMoneyToCents } from "./money";

export interface DraftInstallment { dueDate: string; amount: string; label: string }

/** Splits `totalCents` into `count` parts; the remainder cents go to the LAST installment so the sum is exact. */
export function splitEvenly(totalCents: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 1) return [];
  const base = Math.floor(totalCents / count);
  const parts = Array<number>(count).fill(base);
  parts[count - 1]! += totalCents - base * count;
  return parts;
}

export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function ScheduleDialog({ open, onOpenChange, currency, netCents, initial, pending, error, onSubmit }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  netCents: number;
  initial: readonly { dueDate: string; amountCents: number; label: string | null }[];
  pending: boolean;
  error?: Error | null;
  onSubmit: (rows: { dueDate: string; amountCents: number; label?: string }[]) => void;
}) {
  const [rows, setRows] = useState<DraftInstallment[]>([]);
  const [count, setCount] = useState("4");
  const [first, setFirst] = useState(todayIso());
  useEffect(() => {
    if (open) setRows(initial.map((i) => ({ dueDate: i.dueDate, amount: centsToInput(i.amountCents, currency), label: i.label ?? "" })));
  }, [open, initial, currency]);

  const parsed = rows.map((r) => ({ dueDate: r.dueDate, cents: parseMoneyToCents(r.amount, currency), label: r.label.trim() }));
  const allValid = parsed.every((r) => r.cents !== null && /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate));
  const total = parsed.reduce((a, r) => a + (r.cents ?? 0), 0);
  const diff = total - netCents;

  const generate = () => {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 36 || !/^\d{4}-\d{2}-\d{2}$/.test(first)) return;
    setRows(splitEvenly(netCents, n).map((c, i) => ({ dueDate: addMonthsIso(first, i), amount: centsToInput(c, currency), label: "" })));
  };
  const set = (i: number, patch: Partial<DraftInstallment>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="dialog-schedule">
        <DialogHeader>
          <DialogTitle>Installment schedule</DialogTitle>
          <DialogDescription>
            The schedule only spreads the net obligation ({formatMoney(netCents, currency)}) over dates. It never adds to what is owed. Saving replaces the current schedule.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-student-line bg-student-gold-soft/40 p-3">
          <label className="text-xs text-student-muted">Number
            <input className={`${staffField} mt-1 w-20`} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} aria-label="Number of installments" />
          </label>
          <label className="text-xs text-student-muted">First due date
            <input type="date" className={`${staffField} mt-1 w-44`} value={first} onChange={(e) => setFirst(e.target.value)} />
          </label>
          <Button type="button" className={staffBtn.outline} variant="outline" onClick={generate}>Split net obligation evenly</Button>
        </div>
        <div className="space-y-2">
          {rows.length === 0 && <p className="text-sm text-student-muted">No installments. Split evenly above or add one.</p>}
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-student-line p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:border-0 sm:p-0" data-testid={`schedule-row-${i}`}>
              <input type="date" aria-label={`Due date ${i + 1}`} className={staffField} value={r.dueDate} onChange={(e) => set(i, { dueDate: e.target.value })} />
              <input aria-label={`Amount ${i + 1}`} inputMode="decimal" className={staffField} value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} aria-invalid={parseMoneyToCents(r.amount, currency) === null} />
              <input aria-label={`Label ${i + 1}`} className={`${staffField} col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto`} placeholder="Label (optional)" maxLength={120} value={r.label} onChange={(e) => set(i, { label: e.target.value })} />
              <Button type="button" variant="ghost" size="icon" className="row-span-1 sm:row-auto" aria-label={`Remove installment ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button type="button" className={staffBtn.ghost} variant="ghost" onClick={() => setRows((rs) => [...rs, { dueDate: todayIso(), amount: "", label: "" }])}><Plus className="h-4 w-4" />Add installment</Button>
        </div>
        <p className={`text-sm tabular-nums ${diff === 0 ? "text-student-muted" : "text-st-attention"}`} data-testid="schedule-total">
          Scheduled {formatMoney(total, currency)} of {formatMoney(netCents, currency)}
          {rows.length > 0 && diff !== 0 ? ` (${diff > 0 ? "over" : "under"} by ${formatMoney(Math.abs(diff), currency)}; allowed, flagged on the page)` : ""}
        </p>
        <ErrorLine error={error} />
        <DialogFooter>
          <Button type="button" className={staffBtn.outline} variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="button" className={staffBtn.seal} disabled={!allValid || pending} data-testid="button-save-schedule"
            onClick={() => onSubmit(parsed.map((r) => ({ dueDate: r.dueDate, amountCents: r.cents!, ...(r.label ? { label: r.label } : {}) })))}>
            {pending ? "Saving…" : "Replace schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Edit one installment (date, amount, label). */
export function InstallmentEditDialog({ open, onOpenChange, currency, installment, pending, error, onSubmit }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  installment: { dueDate: string; amountCents: number; label: string | null } | null;
  pending: boolean;
  error?: Error | null;
  onSubmit: (patch: { dueDate: string; amountCents: number; label: string | null }) => void;
}) {
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (open && installment) { setDate(installment.dueDate); setAmount(centsToInput(installment.amountCents, currency)); setLabel(installment.label ?? ""); }
  }, [open, installment, currency]);
  const cents = parseMoneyToCents(amount, currency);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-installment-edit">
        <DialogHeader><DialogTitle>Edit installment</DialogTitle><DialogDescription>Changes the schedule only, never the amount owed.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">Due date<input type="date" className={`${staffField} mt-1`} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="text-sm">Amount ({currency})<input inputMode="decimal" className={`${staffField} mt-1`} value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={cents === null} /></label>
          <label className="text-sm">Label<input className={`${staffField} mt-1`} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} /></label>
        </div>
        <ErrorLine error={error} />
        <DialogFooter>
          <Button type="button" className={staffBtn.outline} variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="button" className={staffBtn.seal} disabled={cents === null || !date || pending} onClick={() => cents !== null && onSubmit({ dueDate: date, amountCents: cents, label: label.trim() || null })}>
            {pending ? "Saving…" : "Save installment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
