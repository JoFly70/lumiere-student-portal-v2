/** Shared building blocks of the S27 Student file tabs: serif-titled panel, key/value rows, field label, unavailable state. */
import React from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { StaffCard, StaffEmpty, StaffNotice, staffBtn } from "@/components/staff/staff-ui";
import { useT } from "@/i18n";
import { isUnavailable } from "@/lib/s27-queries";
import { cn } from "@/lib/utils";

export function Panel({ title, aside, description, actions, children, className, testId, id }: {
  title: React.ReactNode; aside?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; testId?: string; id: string;
  /** A sentence under the heading (use instead of `aside` when it explains the section). */
  description?: React.ReactNode;
}) {
  return (
    <StaffCard aria-labelledby={id} className={className} data-testid={testId}>
      <div className={cn("flex flex-wrap justify-between gap-x-3 gap-y-2", description ? "mb-5 items-start" : "mb-3 items-baseline")}>
        <div className="min-w-0 space-y-1">
          <h2 id={id} className="font-serif text-xl tracking-tight text-student-ink sm:text-2xl">{title}</h2>
          {description ? <p className="max-w-2xl text-sm leading-relaxed text-student-muted">{description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {aside ? <p className="text-xs text-student-muted">{aside}</p> : null}
          {actions}
        </div>
      </div>
      {children}
    </StaffCard>
  );
}

export function KeyValue({ label, children, tone, testId }: { label: React.ReactNode; children: React.ReactNode; tone?: "attention" | "urgent" | "ok"; testId?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-t border-student-line py-2.5 first:border-t-0 first:pt-0 text-sm" data-testid={testId}>
      <dt className="text-student-ink">{label}</dt>
      <dd className={cn("text-right font-medium tabular-nums", tone === "attention" ? "text-st-attention" : tone === "urgent" ? "text-st-urgent" : tone === "ok" ? "text-st-applied" : "text-student-ink")}>{children}</dd>
    </div>
  );
}

export function FieldLabel({ htmlFor, children, hint }: { htmlFor?: string; children: React.ReactNode; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-student-ink">
      {children}
      {hint ? <span className="mt-0.5 block text-xs font-normal text-student-muted">{hint}</span> : null}
    </label>
  );
}

/** The designed state for an S27 route that is not available (yet): never an error page. */
export function Unavailable({ error, what, onRetry, testId }: { error: unknown; what: string; onRetry?: () => void; testId?: string }) {
  const { t } = useT();
  const missing = isUnavailable(error);
  return (
    <StaffNotice tone="attention" role="status" icon={<CloudOff className="h-4 w-4" />} testId={testId ?? "s27-unavailable"}
      action={onRetry ? <button type="button" className={cn(staffBtn.outline, "border")} onClick={onRetry}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t("owner.retry")}</button> : undefined}>
      <p className="font-medium">{missing ? t("owner.s27.unavailable.title", { what }) : t("owner.s27.error.title", { what })}</p>
      <p className="text-student-muted">{missing ? t("owner.s27.unavailable.body") : t("owner.s27.error.body")}</p>
    </StaffNotice>
  );
}

export { StaffEmpty };
