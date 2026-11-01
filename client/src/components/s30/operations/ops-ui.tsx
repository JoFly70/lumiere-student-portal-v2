import React from "react";
import { AlertTriangle, CircleCheck, CircleSlash, Info, Loader2, OctagonAlert, Hourglass } from "lucide-react";
import { StaffEmpty } from "@/components/staff/staff-ui";
import { ownerBtn } from "@/components/admin/control/owner-ui";
import { isS30Unavailable } from "@/lib/s30-ops-queries";
import { cn } from "@/lib/utils";
import type { DiagnosticStatus, OpsSeverity } from "@shared/s30-contract";
import { SEVERITY_META } from "./ops-helpers";
import { useOpsT } from "./use-ops-t";

/** Severity and status are always icon + wording (never colour alone); colours are the cockpit umber / sage / gold tokens. */
export const SEVERITY_ICON = { critical: OctagonAlert, warning: AlertTriangle, info: Info } as const;
export const STATUS_ICON: Record<DiagnosticStatus, typeof Info> = { ok: CircleCheck, warning: AlertTriangle, error: OctagonAlert, off: CircleSlash };
export const STATUS_PILL: Record<DiagnosticStatus, string> = { ok: "ok", warning: "warn", error: "crit", off: "plan" };
export const STATUS_RANK: Record<DiagnosticStatus, number> = { error: 0, warning: 1, off: 2, ok: 3 };

export function SeverityBadge({ severity }: { severity: OpsSeverity }) {
  const { t } = useOpsT();
  const meta = SEVERITY_META[severity] ?? SEVERITY_META.info;
  const Icon = SEVERITY_ICON[meta.icon];
  return (
    <span className={cn("pill", meta.pill)} data-severity={severity} data-testid="ops-severity">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {t(meta.labelKey)}
    </span>
  );
}

export function DemoBadge() {
  const { t } = useOpsT();
  return <span className="pill wait" data-testid="ops-demo-badge">{t("ops.demo")}</span>;
}

/** Calm designed state for a 503 "not switched on yet"; otherwise a quiet error with retry. */
export function SectionState({ error, onRetry, testId }: { error: unknown; onRetry: () => void; testId: string }) {
  const { t } = useOpsT();
  const unavailable = isS30Unavailable(error);
  return (
    <StaffEmpty
      testId={unavailable ? `${testId}-unavailable` : `${testId}-error`}
      icon={unavailable ? <Hourglass className="h-6 w-6" /> : <Info className="h-6 w-6" />}
      title={unavailable ? t("ops.unavailable.title") : t("ops.error.title")}
      action={unavailable ? undefined : <button type="button" className={cn(ownerBtn.outline, "mt-2")} onClick={onRetry}>{t("ops.retry")}</button>}
    >
      {unavailable ? t("ops.unavailable.body") : t("ops.error.body")}
    </StaffEmpty>
  );
}

export function SectionLoading({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="grid gap-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="occ-skel" style={{ height: 56 }} />)}
    </div>
  );
}

export function Spinner() { return <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />; }

export function OpsCard({ id, title, aside, children, testId }: { id: string; title: string; aside?: React.ReactNode; children: React.ReactNode; testId: string }) {
  return (
    <section className="card" aria-labelledby={id} data-testid={testId}>
      <div className="ch">
        <h2 id={id} className="min-w-0">{title}</h2>
        {aside ? <span className="small">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}
