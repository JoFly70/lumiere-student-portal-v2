/** Shared presentation for the Import Center: translator, pills, stepper, integrity banner. Theme tokens only. */
import React from "react";
import { Check, CircleAlert, Info, ShieldAlert, TriangleAlert } from "lucide-react";
import type { ImportIssue, ImportStatus } from "@shared/s30-contract";
import { useT, type TranslationKey } from "@/i18n";
import { STEP_KEYS, stepStates } from "./import-helpers";

export type Tt = (key: string, vars?: Record<string, string | number>) => string;
/** Strings live in i18n/modules/s30-imports.ts and are merged by the lead; keys are plain strings here. */
export function useImpT() {
  const { t, language } = useT();
  const tt = React.useCallback<Tt>((key, vars) => t(key as TranslationKey, vars), [t]);
  const when = React.useCallback((iso: string | null | undefined) => {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(language, { dateStyle: "medium", timeStyle: "short" });
  }, [language]);
  const day = React.useCallback((iso: string | null | undefined) => {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(language, { dateStyle: "medium" });
  }, [language]);
  return { tt, language, when, day };
}

export const BTN_PRIMARY = "b1 inline-flex min-h-10 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_SECONDARY = "b2 inline-flex min-h-10 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50";
export const FIELD_CLASS = "min-h-10 w-full rounded-lg border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-60";
export const FIELD_STYLE: React.CSSProperties = { background: "var(--t-panel)", borderColor: "var(--t-line-2)", color: "var(--t-text)", outlineColor: "var(--t-accent)" };
export const LABEL_CLASS = "mb-1 block text-xs font-semibold uppercase tracking-wider";
export const LABEL_STYLE: React.CSSProperties = { color: "var(--t-muted)" };
export const DIALOG_STYLE: React.CSSProperties = { background: "var(--t-panel)", borderColor: "var(--t-line)", color: "var(--t-text)" };

const STATUS_PILL: Record<ImportStatus, string> = { uploaded: "wait", validated: "wait", approved: "ok", committed: "ok", rolled_back: "warn", discarded: "plan" };
export function StatusPill({ status }: { status: ImportStatus }) {
  const { tt } = useImpT();
  return <span className={`pill ${STATUS_PILL[status]}`} data-status={status}><i aria-hidden="true" />{tt(`imp.status.${status}`)}</span>;
}
export function TierPill({ tier }: { tier: "provider_reported" | "institution_reported" }) {
  const { tt } = useImpT();
  return <span style={{ whiteSpace: "nowrap" }} className={`pill ${tier === "provider_reported" ? "wait" : "warn"}`} data-tier={tier}><i aria-hidden="true" />{tt(`imp.tier.${tier}`)}</span>;
}

const SEV_ICON = { error: CircleAlert, warning: TriangleAlert, info: Info } as const;
const SEV_COLOR = { error: "var(--occ-umber)", warning: "var(--occ-umber)", info: "var(--t-muted)" } as const;
export function IssueLine({ issue }: { issue: ImportIssue }) {
  const { tt } = useImpT();
  const Icon = SEV_ICON[issue.severity];
  return (
    <li className="flex items-start gap-1.5 text-xs" data-severity={issue.severity} data-code={issue.code}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: SEV_COLOR[issue.severity] }} aria-hidden="true" />
      <span>
        <strong className="font-semibold" style={{ color: SEV_COLOR[issue.severity] }}>{tt(`imp.sev.${issue.severity}`)}.</strong>{" "}
        <span style={{ color: "var(--t-text-2)" }}>{tt(`imp.issue.${issue.code}`)}</span>
      </span>
    </li>
  );
}

export function Stepper({ status }: { status: ImportStatus | null }) {
  const { tt } = useImpT();
  const { steps, terminal } = stepStates(status);
  return (
    <div className="card !gap-3" data-testid="imp-stepper">
      <ol className="grid gap-2 sm:grid-cols-5" aria-label={tt("imp.step.aria")}>
        {STEP_KEYS.map((k, i) => {
          const s = steps[k];
          return (
            <li key={k} aria-current={s === "current" ? "step" : undefined} data-step={k} data-state={s}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: s === "current" ? "var(--t-accent)" : "var(--t-line-2)", background: s === "current" ? "var(--t-accent-dim)" : "var(--t-panel)", color: s === "todo" ? "var(--t-muted)" : "var(--t-text)" }}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
                style={{ borderColor: s === "done" ? "var(--occ-sage)" : "var(--t-line-2)", color: s === "done" ? "var(--occ-sage)" : "inherit" }} aria-hidden="true">
                {s === "done" ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="min-w-0 break-words">{tt(`imp.step.${k}`)}<span className="sr-only"> ({tt(`imp.step.${s}`)})</span></span>
            </li>
          );
        })}
      </ol>
      {terminal && <p className="small" role="status" data-testid="imp-terminal">{tt(`imp.step.terminal.${terminal}`)}</p>}
    </div>
  );
}

export function IntegrityBanner({ compact = false }: { compact?: boolean }) {
  const { tt } = useImpT();
  return (
    <div role="note" data-testid="imp-integrity" className="flex items-start gap-3 rounded-xl border px-4 py-3"
      style={{ background: "var(--occ-umber-dim)", borderColor: "var(--occ-umber-line, var(--t-line-2))", color: "var(--t-text)" }}>
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "var(--occ-umber)" }} aria-hidden="true" />
      {compact ? <p className="text-sm">{tt("imp.integrity.short")}</p> : (
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--t-heading)" }}>{tt("imp.integrity.title")}</p>
          <p className="text-sm">{tt("imp.integrity.body")}</p>
        </div>
      )}
    </div>
  );
}

export function UnavailableCard({ testId = "imp-unavailable" }: { testId?: string }) {
  const { tt } = useImpT();
  return (
    <div className="card" role="status" data-testid={testId}>
      <h2 className="text-lg">{tt("imp.unavailable.title")}</h2>
      <p className="small">{tt("imp.unavailable.body")}</p>
    </div>
  );
}
export function ErrorCard({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { tt } = useImpT();
  return (
    <div className="card" role="alert" data-testid="imp-error">
      <h2 className="text-lg">{tt("imp.error.title")}</h2>
      {message && <p className="small">{message}</p>}
      {onRetry && <button type="button" className={BTN_SECONDARY + " justify-self-start"} onClick={onRetry}>{tt("imp.error.retry")}</button>}
    </div>
  );
}
