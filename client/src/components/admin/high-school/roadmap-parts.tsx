/** Roadmap tab parts: pacing target, optional policies, version history. */
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatHalfUnits, type HsRoadmapContent, type HsVersionStatus } from "@shared/high-school-contract";
import {
  MONTH_NAMES, NOT_CONFIGURED_TEXT, POLICY_LABELS, type PolicyNumberKey, addMilestone, configuredPolicyCount, formatDate, formatMonth, policyDisplay, statusLabel, removeMilestone, setPacing, setPolicy,
} from "@/lib/admin-high-school-logic";
import { FIELD_CLASS, Field, FormPanel, Notice, Pill, RecordButton, SectionCard, type OpenForm } from "./shared";

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
  const [msYear, setMsYear] = useState("");
  const [msMonth, setMsMonth] = useState("");
  const [credits, setCredits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const p = content.pacing;
  const month = msYear && msMonth ? `${msYear}-${msMonth}` : "";
  return (
    <SectionCard testId="pacing-card" title="Target schedule" description="The completion date is a target, not a guarantee. The student sees it that way.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pace-target" label="Target completion date"><Input id="pace-target" type="date" value={p.targetCompletionDate ?? ""} onChange={(e) => onChange(setPacing(content, { targetCompletionDate: e.target.value || null }))} /></Field>
        <Field id="pace-weekly" label="Weekly target (credits)" hint="Blank = no weekly target.">
          <select id="pace-weekly" aria-describedby="pace-weekly-hint" className={FIELD_CLASS} value={p.weeklyTargetHalfUnits ?? ""} onChange={(e) => onChange(setPacing(content, { weeklyTargetHalfUnits: e.target.value === "" ? null : Number(e.target.value) }))}>
            <option value="">Not set</option>
            {[1, 2, 3, 4].map((h) => <option key={h} value={h}>{formatHalfUnits(h)} per week</option>)}
          </select>
        </Field>
      </div>
      <div className="space-y-3 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-medium">Monthly milestones (cumulative credits)</h4>
          <RecordButton form={form} id="milestone" variant="outline" size="sm">Add a milestone</RecordButton>
        </div>
        {p.milestones.length === 0 ? <p className="text-sm text-muted-foreground">No milestones. The student sees no pace comparison.</p> : (
          <ul className="divide-y rounded-md border">
            {p.milestones.map((m) => (
              <li key={m.month} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>By <span className="font-medium">{formatMonth(m.month)}</span>: <span className="tabular-nums">{formatHalfUnits(m.cumulativeHalfUnits)} credits</span></span>
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove milestone ${formatMonth(m.month)}`} onClick={() => onChange(removeMilestone(content, m.month))}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
              </li>
            ))}
          </ul>
        )}
        <FormPanel form={form} id="milestone" className="grid items-end gap-3 sm:grid-cols-[auto_1fr_auto]">
          <fieldset className="min-w-0">
            <legend className="text-sm font-medium">Month</legend>
            <div className="mt-1.5 flex gap-2">
              <select id="ms-month" aria-label="Month" className={FIELD_CLASS} value={msMonth} onChange={(e) => setMsMonth(e.target.value)}>
                <option value="">Month</option>
                {MONTH_NAMES.map((n, i) => <option key={n} value={String(i + 1).padStart(2, "0")}>{n}</option>)}
              </select>
              <select id="ms-year" aria-label="Year" className={FIELD_CLASS} value={msYear} onChange={(e) => setMsYear(e.target.value)}>
                <option value="">Year</option>
                {yearOptions(content).map((y) => <option key={y} value={String(y)}>{y}</option>)}
              </select>
            </div>
          </fieldset>
          <Field id="ms-credits" label="Cumulative credits" hint="Total earned by the end of that month, e.g. 3.5."><Input id="ms-credits" inputMode="decimal" aria-describedby="ms-credits-hint" value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="e.g. 3.5" /></Field>
          <Button type="button" className="min-h-10" onClick={() => {
            const next = addMilestone(content, month, credits);
            if (typeof next === "string") setError(next); else { setError(null); setMsYear(""); setMsMonth(""); setCredits(""); onChange(next); form.close(); }
          }}>Add milestone</Button>
        </FormPanel>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div>
    </SectionCard>
  );
}

export function PoliciesCard({ content, onChange, form }: { content: HsRoadmapContent; onChange: (c: HsRoadmapContent) => void; form: OpenForm }) {
  const keys = Object.keys(POLICY_LABELS) as PolicyNumberKey[];
  const [raw, setRaw] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, policyDisplay(k, content.policies[k])])));
  const n = configuredPolicyCount(content.policies);
  return (
    <SectionCard testId="policies-card" title="Optional policies" description="Off by default. Nothing is enforced unless you set it here for this student."
      action={<RecordButton form={form} id="policies" variant="outline">Set policies</RecordButton>}>
      <Notice tone="info"><span className="block font-medium">{NOT_CONFIGURED_TEXT}</span>{n === 0 ? "No policies are configured. Failed exam attempts are recorded without limit and no pace rule is enforced." : `${n} ${n === 1 ? "policy is" : "policies are"} configured for this student; the others stay unconfigured.`}</Notice>
      <FormPanel form={form} id="policies">
        <div className="grid gap-4 sm:grid-cols-2">
          {keys.map((k) => {
            const meta = POLICY_LABELS[k];
            const text = raw[k] ?? "";
            const invalid = text.trim() !== "" && content.policies[k] === null;
            return (
              <Field key={k} id={`policy-${k}`} label={`${meta.label} (${meta.unit})`} hint={invalid ? "Enter a whole number (credits in steps of 0.5)." : meta.hint}>
                <Input id={`policy-${k}`} inputMode="decimal" aria-describedby={`policy-${k}-hint`} aria-invalid={invalid} placeholder="Not configured" value={text}
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
  return (
    <SectionCard testId="version-history" title="Version history" description="Published versions are immutable. Each change creates a new version; earlier progress and official results are kept.">
      {history.length === 0 ? <p className="text-sm text-muted-foreground">Nothing has been created yet.</p> : (
        <ol className="divide-y rounded-md border">
          {history.map((v) => (
            <li key={v.versionId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <span className="font-medium">Version {v.versionNumber}</span>
              <span className="flex items-center gap-2 text-muted-foreground">{v.publishedAt ? `Published ${formatDate(v.publishedAt)}` : "Not published"}<Pill tone={STATUS_TONE[v.status]}>{statusLabel(v.status)}</Pill></span>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
