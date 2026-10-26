/**
 * Shared building blocks for the staff High School Pathway workspace.
 * Admin pages use the default shadcn shell (not the student gold surface).
 */
import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { evidenceLabel, evidenceTypesText, verifiedEvidenceDocs, type EvidenceDoc, type Gate } from "@/lib/admin-high-school-logic";
import type { HsEvidencePurpose, StaffHighSchoolState } from "@shared/high-school-contract";

export interface SectionProps {
  readonly state: StaffHighSchoolState;
  readonly studentId: string;
  readonly isAdmin: boolean;
  readonly docs: readonly EvidenceDoc[];
}

export const FIELD_CLASS =
  "flex min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

export function Field({ id, label, hint, children, className }: { id: string; label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {hint ? <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function SectionHeading({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="text-lg font-semibold tracking-tight">{title}</h2>
      {children ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{children}</p> : null}
    </div>
  );
}

const NOTICE_TONE = {
  info: { cls: "border-border bg-muted/40", Icon: Info },
  warn: { cls: "border-amber-600/40 bg-amber-500/10", Icon: AlertCircle },
  error: { cls: "border-destructive/40 bg-destructive/5", Icon: AlertCircle },
  success: { cls: "border-green-700/30 bg-green-600/5", Icon: CheckCircle2 },
  official: { cls: "border-foreground/30 bg-muted/60", Icon: ShieldCheck },
} as const;

export function Notice({ tone = "info", children, testId }: { tone?: keyof typeof NOTICE_TONE; children: ReactNode; testId?: string }) {
  const { cls, Icon } = NOTICE_TONE[tone];
  return (
    <div role={tone === "error" ? "alert" : tone === "success" ? "status" : undefined} data-testid={testId} className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm ${cls}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A disabled action must always say why. */
/** Disabled = muted outline with readable text (never a pale fill with white text). */
export const DISABLED_CLASS = "disabled:pointer-events-none disabled:border disabled:border-dashed disabled:border-border disabled:bg-transparent disabled:text-foreground/75 disabled:opacity-100 disabled:shadow-none";

export function GatedButton({ gate, id, children, onClick, pending, variant, type = "button", size }: {
  gate: Gate; id: string; children: ReactNode; onClick?: () => void; pending?: boolean;
  variant?: "default" | "outline" | "destructive" | "secondary"; type?: "button" | "submit"; size?: "sm" | "default";
}) {
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button id={id} type={type} variant={variant} size={size} disabled={!gate.enabled || pending} onClick={onClick} aria-describedby={gate.reason ? `${id}-why` : undefined} className={`min-h-10 ${DISABLED_CLASS} ${!variant || variant === "default" ? "dark:bg-blue-700 dark:text-white dark:hover:bg-blue-800" : ""}`}>
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {children}
      </Button>
      {gate.reason ? <p id={`${id}-why`} className="max-w-sm text-xs text-muted-foreground">{gate.reason}</p> : null}
    </div>
  );
}

export function EvidenceSelect({ id, value, onChange, docs, purpose, label = "Evidence (verified document)" }: {
  id: string; value: string; onChange: (v: string) => void; docs: readonly EvidenceDoc[]; purpose: HsEvidencePurpose; label?: string;
}) {
  const verified = verifiedEvidenceDocs(docs, purpose);
  return (
    <Field id={id} label={label} hint={verified.length === 0 ? `No verified ${evidenceTypesText(purpose)} yet. Verify it in Documents first.` : `Verified documents of this student only: ${evidenceTypesText(purpose)}.`}>
      <select id={id} className={FIELD_CLASS} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-hint`}>
        <option value="">Select a verified document…</option>
        {verified.map((d) => <option key={d.id} value={d.id}>{evidenceLabel(d)}</option>)}
      </select>
    </Field>
  );
}

export function ActionMessage({ message }: { message: { tone: "success" | "error"; text: string } | null }) {
  if (!message) return null;
  return <Notice tone={message.tone}>{message.text}</Notice>;
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "official" }) {
  const cls = {
    neutral: "border-border bg-muted/50 text-foreground",
    good: "border-green-700/40 bg-green-600/10 text-green-900 dark:text-green-200",
    warn: "border-amber-700/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
    bad: "border-destructive/50 bg-destructive/10 text-destructive",
    official: "border-foreground/40 bg-foreground/5 text-foreground",
  }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

/** Small horizontal bar for "planned/earned of required" per area. Decorative: the numbers are always shown as text next to it. */
export function MiniBar({ value, max, over = false, className = "" }: { value: number; max: number; over?: boolean; className?: string }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value * 100) / max));
  return (
    <span aria-hidden="true" className={`block h-1.5 w-full overflow-hidden rounded-full bg-muted ${className}`}>
      <span className={`block h-full rounded-full ${over ? "bg-amber-600" : value >= max && max > 0 ? "bg-green-700 dark:bg-green-500" : "bg-blue-600 dark:bg-blue-400"}`} style={{ width: `${pct}%` }} />
    </span>
  );
}
