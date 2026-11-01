/** Roadmap tab parts: pacing target, optional policies, version history. */
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatHalfUnits, type HsRoadmapContent, type HsVersionStatus } from "@shared/high-school-contract";
import {
  MONTH_NAMES, NOT_CONFIGURED_TEXT, POLICY_LABELS, type PolicyNumberKey, addMilestone, configuredPolicyCount, policyDisplay, statusLabel, removeMilestone, setPacing, setPolicy,
} from "@/lib/admin-high-school-logic";
import { FIELD_CLASS, Field, FormPanel, Notice, Pill, RecordButton, SectionCard, type OpenForm } from "./shared";
import { hsMonthName, useHs } from "./hs-i18n";

/** Year choices for the milestone month: a window around today and every year already used by the plan. */
function yearOptions(content: HsRoadmapContent): number[] {
  const now = new Date().getFullYear();
  const used = [content.pacing.targetCompletionDate, ...content.pacing.milestones.map((m) => m.month), ...content.courses.flatMap((c) => [c.plannedStart, c.plannedEnd])]
    .map((v) => Number((v ?? "").slice(0, 4))).filter((y) => y >= 2000 && y <= 2100);
  const lo = Math.min(now, ...used);
  const hi = Math.max(now + 4, ...used);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

export function PacingCard({ content, onChange, form }: { content: HsRoadmapContent; onChange: (c: HsRoadmapContent) => void; form: OpenForm }) {
  const { t, x, fc, credits: creditsText, month: monthText, language } = useHs();
  const [msYear, setMsYear] = useState("");
  const [msMonth, setMsMonth] = useState("");
  const [credits, setCredits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const p = content.pacing;
  const month = msYear && msMonth ? `${msYear}-${msMonth}` : "";
  return (
    <SectionCard testId="pacing-card" title={t("s32dir.hs.rm.pace.title")} description={t("s32dir.hs.rm.pace.desc")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pace-target" label={t("s32dir.hs.p.targetDate")}><Input id="pace-target" type="date" value={p.targetCompletionDate ?? ""} onChange={(e) => onChange(setPacing(content, { targetCompletionDate: e.target.value || null }))} /></Field>
        <Field id="pace-weekly" label={t("s32dir.hs.rm.weekly")} hint={t("s32dir.hs.rm.weekly.hint")}>
          <select id="pace-weekly" aria-describedby="pace-weekly-hint" className={FIELD_CLASS} value={p.weeklyTargetHalfUnits ?? ""} onChange={(e) => onChange(setPacing(content, { weeklyTargetHalfUnits: e.target.value === "" ? null : Number(e.target.value) }))}>
            <option value="">{t("s32dir.hs.rm.notSet")}</option>
            {[1, 2, 3, 4].map((h) => <option key={h} value={h}>{t("s32dir.hs.rm.perWeek", { n: fc(h) })}</option>)}
          </select>
        </Field>
      </div>
      <div className="space-y-3 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-medium">{t("s32dir.hs.rm.milestones")}</h4>
          <RecordButton form={form} id="milestone" variant="outline" size="sm">{t("s32dir.hs.rm.addMilestoneBtn")}</RecordButton>
        </div>
        {p.milestones.length === 0 ? <p className="text-sm text-muted-foreground">{t("s32dir.hs.rm.noMilestones")}</p> : (
          <ul className="divide-y rounded-md border">
            {p.milestones.map((m) => (
              <li key={m.month} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>{t("s32dir.hs.rm.by")}<span className="font-medium">{monthText(m.month)}</span>{t("s32dir.hs.rm.colon")}<span className="tabular-nums">{fc(m.cumulativeHalfUnits)} {language === "fr" ? "crédits" : "credits"}</span></span>
                <Button type="button" variant="ghost" size="sm" aria-label={t("s32dir.hs.rm.removeMilestone", { m: monthText(m.month) })} onClick={() => onChange(removeMilestone(content, m.month))}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
              </li>
            ))}
          </ul>
        )}
        <FormPanel form={form} id="milestone" className="grid items-end gap-3 sm:grid-cols-[auto_1fr_auto]">
          <fieldset className="min-w-0">
            <legend className="text-sm font-medium">{t("s32dir.hs.rm.month")}</legend>
            <div className="mt-1.5 flex gap-2">
              <select id="ms-month" aria-label={t("s32dir.hs.rm.month")} className={FIELD_CLASS} value={msMonth} onChange={(e) => setMsMonth(e.target.value)}>
                <option value="">{t("s32dir.hs.rm.month")}</option>
                {MONTH_NAMES.map((n, i) => <option key={n} value={String(i + 1).padStart(2, "0")}>{hsMonthName(language, i, n)}</option>)}
              </select>
              <select id="ms-year" aria-label={t("s32dir.hs.rm.year")} className={FIELD_CLASS} value={msYear} onChange={(e) => setMsYear(e.target.value)}>
                <option value="">{t("s32dir.hs.rm.year")}</option>
                {yearOptions(content).map((y) => <option key={y} value={String(y)}>{y}</option>)}
              </select>
            </div>
          </fieldset>
          <Field id="ms-credits" label={t("s32dir.hs.rm.cumulative")} hint={t("s32dir.hs.rm.cumulative.hint")}><Input id="ms-credits" inputMode="decimal" aria-describedby="ms-credits-hint" value={credits} onChange={(e) => setCredits(e.target.value)} placeholder={t("s32dir.hs.rm.cumulative.ph")} /></Field>
          <Button type="button" className="min-h-10" onClick={() => {
            const next = addMilestone(content, month, credits);
            if (typeof next === "string") setError(next); else { setError(null); setMsYear(""); setMsMonth(""); setCredits(""); onChange(next); form.close(); }
          }}>{t("s32dir.hs.rm.addMilestone")}</Button>
        </FormPanel>
        {error ? <p role="alert" className="text-sm text-destructive">{x(error)}</p> : null}
      </div>
    </SectionCard>
  );
}

export function PoliciesCard({ content, onChange, form }: { content: HsRoadmapContent; onChange: (c: HsRoadmapContent) => void; form: OpenForm }) {
  const { t, x } = useHs();
  const keys = Object.keys(POLICY_LABELS) as PolicyNumberKey[];
  const [raw, setRaw] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, policyDisplay(k, content.policies[k])])));
  const n = configuredPolicyCount(content.policies);
  return (
    <SectionCard testId="policies-card" title={t("s32dir.hs.rm.pol.title")} description={t("s32dir.hs.rm.pol.desc")}
      action={<RecordButton form={form} id="policies" variant="outline">{t("s32dir.hs.rm.pol.set")}</RecordButton>}>
      <Notice tone="info"><span className="block font-medium">{x(NOT_CONFIGURED_TEXT)}</span>{n === 0 ? t("s32dir.hs.rm.pol.none") : t(n === 1 ? "s32dir.hs.rm.pol.one" : "s32dir.hs.rm.pol.other", { n })}</Notice>
      <FormPanel form={form} id="policies">
        <div className="grid gap-4 sm:grid-cols-2">
          {keys.map((k) => {
            const meta = POLICY_LABELS[k];
            const text = raw[k] ?? "";
            const invalid = text.trim() !== "" && content.policies[k] === null;
            return (
              <Field key={k} id={`policy-${k}`} label={`${x(meta.label)} (${x(meta.unit)})`} hint={invalid ? t("s32dir.hs.rm.pol.invalid") : x(meta.hint)}>
                <Input id={`policy-${k}`} inputMode="decimal" aria-describedby={`policy-${k}-hint`} aria-invalid={invalid} placeholder={t("s32dir.hs.rm.pol.ph")} value={text}
                  onChange={(e) => { setRaw({ ...raw, [k]: e.target.value }); onChange(setPolicy(content, k, e.target.value)); }} />
              </Field>
            );
          })}
        </div>
      </FormPanel>
    </SectionCard>
  );
}

const STATUS_TONE: Record<HsVersionStatus, "good" | "warn" | "neutral" | "bad"> = { published: "good", draft: "warn", superseded: "neutral", discarded: "bad" };

export function VersionHistory({ history }: { history: readonly { versionId: string; versionNumber: number; status: HsVersionStatus; publishedAt: string | null }[] }) {
  const { t, x, date } = useHs();
  return (
    <SectionCard testId="version-history" title={t("s32dir.hs.rm.ver.title")} description={t("s32dir.hs.rm.ver.desc")}>
      {history.length === 0 ? <p className="text-sm text-muted-foreground">{t("s32dir.hs.rm.ver.empty")}</p> : (
        <ol className="divide-y rounded-md border">
          {history.map((v) => (
            <li key={v.versionId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <span className="font-medium">{t("s32dir.hs.sum.version", { n: v.versionNumber })}</span>
              <span className="flex items-center gap-2 text-muted-foreground">{v.publishedAt ? t("s32dir.hs.rm.ver.published", { date: date(v.publishedAt) }) : t("s32dir.hs.sum.notPublished")}<Pill tone={STATUS_TONE[v.status]}>{x(statusLabel(v.status))}</Pill></span>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
