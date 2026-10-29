/** "Edit agreement" dialog (S27): dates, support/access months, rule days, language test, prior-schooling proof and the post-secondary goal. */
import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEADLINE_STATUSES, type ProgramAgreementView } from "@shared/s27-contract";
import { staffBtn, staffField, StaffNotice } from "@/components/staff/staff-ui";
import { useT, type TranslationKey } from "@/i18n";
import { EMPTY_TARGET, agreementToForm, formToUpdate, type AgreementForm, type TargetForm } from "@/lib/agreement-form";
import { errorText, useUpdateAgreement } from "@/lib/s27-queries";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ownerBtn } from "@/components/admin/control/owner-ui";
import { FieldLabel } from "./file-parts";

const STATUS_LABEL: Record<(typeof DEADLINE_STATUSES)[number], TranslationKey> = { open: "owner.agr.status.open", done: "owner.agr.status.done", waived: "owner.agr.status.waived" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-student-line p-4">
      <legend className="px-1 font-serif text-lg text-student-ink">{title}</legend>
      {children}
    </fieldset>
  );
}

export function AgreementDialog({ open, onOpenChange, studentId, agreement }: { open: boolean; onOpenChange: (o: boolean) => void; studentId: string; agreement: ProgramAgreementView | null }) {
  const { t } = useT();
  const { toast } = useToast();
  const initial = useMemo(() => agreementToForm(agreement), [agreement]);
  const [form, setForm] = useState<AgreementForm>(initial);
  const update = useUpdateAgreement(studentId);
  useEffect(() => { if (open) { setForm(initial); update.reset(); } }, [open, initial]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof AgreementForm>(k: K, v: AgreementForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setGoal = (patch: Partial<AgreementForm["goal"]>) => setForm((f) => ({ ...f, goal: { ...f.goal, ...patch } }));
  const setTarget = (i: number, patch: Partial<TargetForm>) => setForm((f) => ({ ...f, goal: { ...f.goal, targets: f.goal.targets.map((x, j) => (j === i ? { ...x, ...patch } : x)) } }));
  const result = useMemo(() => formToUpdate(initial, form), [initial, form]);

  const submit = () => {
    if (!result.changed || result.errors.length) return;
    update.mutate(result.input, { onSuccess: () => { toast({ title: t("owner.agr.saved") }); onOpenChange(false); } });
  };
  const input = (id: string, k: keyof AgreementForm, type = "text", extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={id} type={type} className={staffField} value={String(form[k] ?? "")} onChange={(e) => set(k, e.target.value as never)} {...extra} />
  );
  const statusSelect = (id: string, k: "ltStatus" | "psStatus") => (
    <select id={id} className={staffField} value={form[k]} onChange={(e) => set(k, e.target.value as AgreementForm[typeof k])}>
      {DEADLINE_STATUSES.map((s) => <option key={s} value={s}>{t(STATUS_LABEL[s])}</option>)}
    </select>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto" data-testid="dialog-agreement">
        <DialogHeader sticky>
          <DialogTitle className="font-serif text-2xl">{t("owner.agr.title")}</DialogTitle>
          <DialogDescription>{t("owner.agr.desc")}</DialogDescription>
        </DialogHeader>

        <Section title={t("owner.agr.sec.terms")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><FieldLabel htmlFor="ag-signed">{t("owner.agr.signedOn")}</FieldLabel>{input("ag-signed", "signedOn", "date")}</div>
            <div><FieldLabel htmlFor="ag-activated">{t("owner.agr.activatedOn")}</FieldLabel>{input("ag-activated", "activatedOn", "date")}</div>
            <div><FieldLabel htmlFor="ag-support">{t("owner.agr.supportMonths")}</FieldLabel>{input("ag-support", "supportMonths", "number", { min: 1, max: 60, inputMode: "numeric" })}</div>
            <div><FieldLabel htmlFor="ag-access">{t("owner.agr.accessMonths")}</FieldLabel>{input("ag-access", "accessMonths", "number", { min: 1, max: 120, inputMode: "numeric" })}</div>
            <div><FieldLabel htmlFor="ag-ltdays" hint={t("owner.agr.ruleHint")}>{t("owner.agr.ltDays")}</FieldLabel>{input("ag-ltdays", "languageTestDays", "number", { min: 1, max: 365, inputMode: "numeric" })}</div>
            <div><FieldLabel htmlFor="ag-psdays" hint={t("owner.agr.ruleHint")}>{t("owner.agr.psDays")}</FieldLabel>{input("ag-psdays", "priorSchoolingDays", "number", { min: 1, max: 365, inputMode: "numeric" })}</div>
            <div><FieldLabel htmlFor="ag-sessions">{t("owner.agr.sessions")}</FieldLabel>{input("ag-sessions", "sessionsIncluded", "number", { min: 0, max: 10, inputMode: "numeric" })}</div>
          </div>
        </Section>

        <Section title={t("owner.agr.sec.lang")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><FieldLabel htmlFor="ag-lt-status">{t("owner.agr.status")}</FieldLabel>{statusSelect("ag-lt-status", "ltStatus")}</div>
            <div><FieldLabel htmlFor="ag-lt-done">{t("owner.agr.doneOn")}</FieldLabel>{input("ag-lt-done", "ltDoneOn", "date")}</div>
            <div><FieldLabel htmlFor="ag-lt-score">{t("owner.agr.score")}</FieldLabel>{input("ag-lt-score", "ltScore", "number", { min: 0, max: 200, inputMode: "numeric" })}</div>
            <div><FieldLabel htmlFor="ag-lt-target">{t("owner.agr.target")}</FieldLabel>{input("ag-lt-target", "ltTarget", "text", { maxLength: 40, placeholder: "105–115" })}</div>
          </div>
        </Section>

        <Section title={t("owner.agr.sec.proof")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><FieldLabel htmlFor="ag-ps-status">{t("owner.agr.status")}</FieldLabel>{statusSelect("ag-ps-status", "psStatus")}</div>
            <div><FieldLabel htmlFor="ag-ps-done">{t("owner.agr.doneOn")}</FieldLabel>{input("ag-ps-done", "psDoneOn", "date")}</div>
          </div>
        </Section>

        <Section title={t("owner.agr.sec.goal")}>
          <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-student-ink">
            <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--s-ink))]" checked={form.hasGoal} onChange={(e) => set("hasGoal", e.target.checked)} data-testid="ag-has-goal" />
            {t("owner.agr.goal.enable")}
          </label>
          {form.hasGoal ? (
            <div className="space-y-3" data-testid="goal-editor">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><FieldLabel htmlFor="ag-g-field">{t("owner.agr.goal.field")}</FieldLabel><input id="ag-g-field" className={staffField} maxLength={80} value={form.goal.field} onChange={(e) => setGoal({ field: e.target.value })} /></div>
                <div><FieldLabel htmlFor="ag-g-region">{t("owner.agr.goal.region")}</FieldLabel><input id="ag-g-region" className={staffField} maxLength={80} value={form.goal.region} onChange={(e) => setGoal({ region: e.target.value })} /></div>
                <div><FieldLabel htmlFor="ag-g-interests" hint={t("owner.agr.goal.interestsHint")}>{t("owner.agr.goal.interests")}</FieldLabel><input id="ag-g-interests" className={staffField} value={form.goal.interests} onChange={(e) => setGoal({ interests: e.target.value })} /></div>
                <div><FieldLabel htmlFor="ag-g-study">{t("owner.agr.goal.studyOn")}</FieldLabel><input id="ag-g-study" type="date" className={staffField} value={form.goal.studyOn} onChange={(e) => setGoal({ studyOn: e.target.value })} /></div>
              </div>
              <div><FieldLabel htmlFor="ag-g-also" hint={t("owner.agr.goal.alsoHint")}>{t("owner.agr.goal.also")}</FieldLabel><textarea id="ag-g-also" rows={2} className={cn(staffField, "py-2")} value={form.goal.alsoReviewed} onChange={(e) => setGoal({ alsoReviewed: e.target.value })} /></div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-student-ink">{t("owner.agr.goal.targets")}</p>
                {form.goal.targets.map((tg, i) => (
                  <div key={i} className="space-y-2 rounded-lg border border-student-line bg-student-gold-soft/30 p-3" data-testid={`goal-target-${i}`}>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {([["name", "owner.agr.t.name"], ["city", "owner.agr.t.city"], ["track", "owner.agr.t.track"], ["program", "owner.agr.t.program"]] as [keyof TargetForm, TranslationKey][]).map(([k, label]) => (
                        <div key={k}><FieldLabel htmlFor={`tg-${i}-${k}`}>{t(label)}</FieldLabel><input id={`tg-${i}-${k}`} className={staffField} value={tg[k]} onChange={(e) => setTarget(i, { [k]: e.target.value })} /></div>
                      ))}
                    </div>
                    <div><FieldLabel htmlFor={`tg-${i}-why`}>{t("owner.agr.t.why")}</FieldLabel><input id={`tg-${i}-why`} className={staffField} maxLength={400} value={tg.why} onChange={(e) => setTarget(i, { why: e.target.value })} /></div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div><FieldLabel htmlFor={`tg-${i}-adm`}>{t("owner.agr.t.admission")}</FieldLabel><input id={`tg-${i}-adm`} className={staffField} maxLength={500} value={tg.admission} onChange={(e) => setTarget(i, { admission: e.target.value })} /></div>
                      <div><FieldLabel htmlFor={`tg-${i}-url`}>{t("owner.agr.t.url")}</FieldLabel><input id={`tg-${i}-url`} type="url" className={staffField} placeholder="https://" value={tg.url} onChange={(e) => setTarget(i, { url: e.target.value })} /></div>
                    </div>
                    <button type="button" className={cn(ownerBtn.ghost, "text-st-urgent")} onClick={() => setForm((f) => ({ ...f, goal: { ...f.goal, targets: f.goal.targets.filter((_, j) => j !== i) } }))}><Trash2 className="h-4 w-4" aria-hidden="true" />{t("owner.agr.t.remove")}</button>
                  </div>
                ))}
                {form.goal.targets.length < 6 ? (
                  <button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => setForm((f) => ({ ...f, goal: { ...f.goal, targets: [...f.goal.targets, { ...EMPTY_TARGET }] } }))}><Plus className="h-4 w-4" aria-hidden="true" />{t("owner.agr.t.add")}</button>
                ) : null}
              </div>
            </div>
          ) : initial.hasGoal ? <p className="text-sm text-st-attention">{t("owner.agr.goal.willRemove")}</p> : null}
        </Section>

        {result.errors.length > 0 ? (
          <StaffNotice tone="attention" role="alert" testId="agreement-errors">
            <p className="font-medium">{t("owner.agr.fix")}</p>
            <ul className="list-disc pl-5 text-sm">{result.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>
          </StaffNotice>
        ) : null}
        {update.isError ? <StaffNotice tone="urgent" role="alert">{errorText(update.error, t("owner.agr.saveFailed"))}</StaffNotice> : null}

        <DialogFooter sticky>
          <button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => onOpenChange(false)} disabled={update.isPending}>{t("owner.cancel")}</button>
          <button type="button" className={ownerBtn.seal} onClick={submit} disabled={!result.changed || result.errors.length > 0 || update.isPending} data-testid="agreement-save">{update.isPending ? t("owner.saving") : t("owner.save")}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
