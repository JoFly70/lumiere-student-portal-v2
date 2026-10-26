/** Roadmap tab parts: pacing target, optional policies, version history. */
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatHalfUnits, type HsPolicies, type HsRoadmapContent, type HsVersionStatus } from "@shared/high-school-contract";
import {
  NOT_CONFIGURED_TEXT, POLICY_LABELS, addMilestone, configuredPolicyCount, formatDate, policyDisplay, removeMilestone, setPacing, setPolicy,
} from "@/lib/admin-high-school-logic";
import { FIELD_CLASS, Field, Notice, Pill } from "./shared";

export function PacingCard({ content, onChange }: { content: HsRoadmapContent; onChange: (c: HsRoadmapContent) => void }) {
  const [month, setMonth] = useState("");
  const [credits, setCredits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const p = content.pacing;
  return (
    <Card data-testid="pacing-card">
      <CardHeader>
        <CardTitle className="text-base">Target schedule</CardTitle>
        <CardDescription>The completion date is a target, not a guarantee. The student sees it that way.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pace-target" label="Target completion date"><Input id="pace-target" type="date" value={p.targetCompletionDate ?? ""} onChange={(e) => onChange(setPacing(content, { targetCompletionDate: e.target.value || null }))} /></Field>
          <Field id="pace-weekly" label="Weekly target (credits)" hint="Blank = no weekly target.">
            <select id="pace-weekly" aria-describedby="pace-weekly-hint" className={FIELD_CLASS} value={p.weeklyTargetHalfUnits ?? ""} onChange={(e) => onChange(setPacing(content, { weeklyTargetHalfUnits: e.target.value === "" ? null : Number(e.target.value) }))}>
              <option value="">Not set</option>
              {[1, 2, 3, 4].map((h) => <option key={h} value={h}>{formatHalfUnits(h)} per week</option>)}
            </select>
          </Field>
        </div>
        <div>
          <h3 className="text-sm font-medium">Monthly milestones (cumulative credits)</h3>
          {p.milestones.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">No milestones. The student sees no pace comparison.</p> : (
            <ul className="mt-2 divide-y rounded-md border">
              {p.milestones.map((m) => (
                <li key={m.month} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>By <span className="font-medium">{m.month}</span>: {formatHalfUnits(m.cumulativeHalfUnits)} credits</span>
                  <Button type="button" variant="ghost" size="sm" aria-label={`Remove milestone ${m.month}`} onClick={() => onChange(removeMilestone(content, m.month))}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Field id="ms-month" label="Month"><Input id="ms-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
            <Field id="ms-credits" label="Cumulative credits"><Input id="ms-credits" inputMode="decimal" value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="e.g. 3.5" /></Field>
            <Button type="button" variant="outline" className="min-h-10" onClick={() => {
              const next = addMilestone(content, month, credits);
              if (typeof next === "string") setError(next); else { setError(null); setMonth(""); setCredits(""); onChange(next); }
            }}>Add milestone</Button>
          </div>
          {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function PoliciesCard({ content, onChange }: { content: HsRoadmapContent; onChange: (c: HsRoadmapContent) => void }) {
  const keys = Object.keys(POLICY_LABELS) as (keyof HsPolicies)[];
  const [raw, setRaw] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, policyDisplay(k, content.policies[k])])));
  const n = configuredPolicyCount(content.policies);
  return (
    <Card data-testid="policies-card">
      <CardHeader>
        <CardTitle className="text-base">Optional policies</CardTitle>
        <CardDescription>Off by default. Nothing is enforced unless you set it here for this student; otherwise the school's own rules apply.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {keys.map((k) => {
            const meta = POLICY_LABELS[k];
            const text = raw[k] ?? "";
            const invalid = text.trim() !== "" && content.policies[k] === null;
            return (
              <Field key={k} id={`policy-${k}`} label={`${meta.label} (${meta.unit})`} hint={invalid ? "Enter a whole number (credits in steps of 0.5)." : content.policies[k] === null ? NOT_CONFIGURED_TEXT : meta.hint}>
                <Input id={`policy-${k}`} inputMode="decimal" aria-describedby={`policy-${k}-hint`} aria-invalid={invalid} placeholder={NOT_CONFIGURED_TEXT} value={text}
                  onChange={(e) => { setRaw({ ...raw, [k]: e.target.value }); onChange(setPolicy(content, k, e.target.value)); }} />
              </Field>
            );
          })}
        </div>
        <Notice tone="info">{n === 0 ? "No policies are configured. Failed exam attempts are recorded without limit and no pace rule is enforced." : `${n} ${n === 1 ? "policy is" : "policies are"} configured for this student; the others stay unconfigured.`}</Notice>
      </CardContent>
    </Card>
  );
}

const STATUS_TONE: Record<HsVersionStatus, "good" | "warn" | "neutral" | "bad"> = { published: "good", draft: "warn", superseded: "neutral", discarded: "bad" };

export function VersionHistory({ history }: { history: readonly { versionId: string; versionNumber: number; status: HsVersionStatus; publishedAt: string | null }[] }) {
  return (
    <Card data-testid="version-history">
      <CardHeader>
        <CardTitle className="text-base">Version history</CardTitle>
        <CardDescription>Published versions are immutable. Each change creates a new version; earlier progress and official results are kept.</CardDescription>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? <p className="text-sm text-muted-foreground">Nothing has been created yet.</p> : (
          <ol className="divide-y rounded-md border">
            {history.map((v) => (
              <li key={v.versionId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                <span className="font-medium">Version {v.versionNumber}</span>
                <span className="flex items-center gap-2 text-muted-foreground">{v.publishedAt ? `Published ${formatDate(v.publishedAt)}` : "Not published"}<Pill tone={STATUS_TONE[v.status]}>{v.status}</Pill></span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
