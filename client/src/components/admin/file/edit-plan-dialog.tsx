/**
 * "Edit plan" dialog (S27): add/remove instalments, split the remaining amount evenly, live sum vs the net obligation,
 * paid instalments locked. Saving replaces the whole schedule through the existing billing endpoint.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney, type StudentInstallment } from "@shared/billing-contract";
import { StaffNotice, staffBtn, staffField } from "@/components/staff/staff-ui";
import { useT } from "@/i18n";
import { centsToInput } from "@/components/admin/billing/money";
import { addMonthsIso } from "@/components/admin/billing/schedule-editor";
import { planPayload, splitRemainingEvenly, validatePlan, planTotalCents, localeOf, type PlanRow } from "@/lib/owner-presentation";
import { cn } from "@/lib/utils";

let counter = 0;
const nextKey = () => `row-${++counter}`;

export function rowsFromInstallments(list: readonly StudentInstallment[], currency: string): PlanRow[] {
  return list.map((i) => ({ key: nextKey(), dueDate: i.dueDate, amount: centsToInput(i.amountCents, currency), label: i.label ?? "", locked: i.status === "paid" }));
}

export function EditPlanDialog({ open, onOpenChange, personName, currency, netCents, installments, pending, error, onSubmit }: {
  open: boolean; onOpenChange: (o: boolean) => void; personName: string; currency: string; netCents: number;
  installments: readonly StudentInstallment[]; pending: boolean; error?: Error | null;
  onSubmit: (rows: { dueDate: string; amountCents: number; label?: string }[]) => void;
}) {
  const { t, language } = useT();
  const locale = localeOf(language);
  const [rows, setRows] = useState<PlanRow[]>([]);
  useEffect(() => { if (open) setRows(rowsFromInstallments(installments, currency)); }, [open, installments, currency]);
  const v = useMemo(() => validatePlan(rows, netCents, currency), [rows, netCents, currency]);
  const set = (key: string, patch: Partial<PlanRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => {
    const last = [...rs].sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1))[0];
    const due = last && /^\d{4}-\d{2}-\d{2}$/.test(last.dueDate) ? addMonthsIso(last.dueDate, 1) : new Date().toISOString().slice(0, 10);
    return [...rs, { key: nextKey(), dueDate: due, amount: "", label: "", locked: false }];
  });
  const money = (c: number) => formatMoney(c, currency, locale);
  const badRow = (i: number, code: "bad_date" | "bad_amount") => v.problems.some((p) => p.code === code && "row" in p && p.row === i);
  const matches = v.problems.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto" data-testid="dialog-edit-plan">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">{t("owner.plan.title", { name: personName })}</DialogTitle>
          <DialogDescription>{t("owner.plan.desc", { net: money(netCents) })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2" role="group" aria-label={t("owner.plan.rows")}>
          <p className="text-sm font-medium text-student-ink">{t("owner.plan.rowsHelp", { currency })}</p>
          {rows.length === 0 ? <p className="text-sm text-student-muted">{t("owner.plan.none")}</p> : null}
          {rows.map((r, i) => (
            <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2" data-testid={`plan-row-${i}`} data-locked={r.locked ? "true" : "false"}>
              <input type="date" aria-label={t("owner.plan.dueN", { n: i + 1 })} className={staffField} value={r.dueDate} disabled={r.locked} aria-invalid={badRow(i, "bad_date")} onChange={(e) => set(r.key, { dueDate: e.target.value })} />
              <input inputMode="decimal" aria-label={t("owner.plan.amountN", { n: i + 1 })} className={cn(staffField, "tabular-nums")} value={r.amount} disabled={r.locked} aria-invalid={badRow(i, "bad_amount")} onChange={(e) => set(r.key, { amount: e.target.value })} />
              {r.locked ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-st-applied/40 bg-st-applied-soft px-2.5 py-1 text-xs font-medium text-st-applied"><Lock className="h-3 w-3" aria-hidden="true" />{t("owner.plan.paid")}</span>
              ) : (
                <button type="button" className={cn(staffBtn.ghost, "text-student-gold-ink")} aria-label={t("owner.plan.removeN", { n: i + 1 })} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}><Trash2 className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">{t("owner.plan.remove")}</span></button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className={cn(staffBtn.outline, "border")} onClick={add} data-testid="plan-add"><Plus className="h-4 w-4" aria-hidden="true" />{t("owner.plan.add")}</button>
            <button type="button" className={cn(staffBtn.outline, "border")} onClick={() => setRows((rs) => splitRemainingEvenly(rs, netCents, currency))} data-testid="plan-split">{t("owner.plan.split")}</button>
          </div>
        </div>

        <p role="status" aria-live="polite" className={cn("text-sm tabular-nums", matches ? "text-st-applied" : "text-st-attention")} data-testid="plan-sum" data-ok={matches ? "true" : "false"}>
          {matches ? t("owner.plan.sumOk", { total: money(planTotalCents(rows, currency)) }) : t("owner.plan.sumBad", { total: money(planTotalCents(rows, currency)), net: money(netCents), diff: money(Math.abs(v.diffCents)), dir: t(v.diffCents > 0 ? "owner.plan.over" : "owner.plan.under") })}
        </p>
        <p className="text-xs text-student-muted">{t("owner.plan.note")}</p>
        {error ? <StaffNotice tone="urgent" role="alert">{error.message}</StaffNotice> : null}

        <DialogFooter>
          <button type="button" className={cn(staffBtn.outline, "border")} onClick={() => onOpenChange(false)} disabled={pending}>{t("owner.cancel")}</button>
          <button type="button" className={staffBtn.seal} disabled={!v.ok || pending} onClick={() => onSubmit(planPayload(rows, currency))} data-testid="plan-save">{pending ? t("owner.saving") : t("owner.save")}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
