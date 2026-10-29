/**
 * "Requirements": one calm row per degree requirement (name, applied / required credits, bar, open credits).
 * Source of truth is the canonical degree progress view only (progress.requirements); nothing is estimated, and a
 * requirement whose amounts the engine did not produce shows its status word instead of a number.
 */
import React from "react";
import { CheckCircle2, CircleDashed, Clock } from "lucide-react";
import type { StudentDegreeProgressView, StudentRequirementView } from "@shared/student-degree-progress-view";
import { cn } from "@/lib/utils";
import { cardClass } from "@/components/student-progress/student-ui";
import { formatCents, toCents } from "./model";
import { useDj } from "./i18n";

function RequirementRow({ r }: { r: StudentRequirementView }) {
  const { t, language } = useDj();
  const required = toCents(r.requiredAmount);
  const applied = toCents(r.appliedAmount);
  const remaining = toCents(r.remainingAmount);
  const known = r.unit === "credit" && required !== null && required > 0 && applied !== null;
  const pct = known ? Math.max(0, Math.min(100, Math.round((applied! / required!) * 100))) : 0;
  const done = r.status === "SATISFIED";
  const review = r.status === "MANUAL_REVIEW" || r.status === "CONFLICT";
  const Icon = done ? CheckCircle2 : review ? Clock : CircleDashed;
  return (
    <li className="min-w-0 space-y-1.5" data-testid="requirement-row" data-status={r.status}>
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-start gap-2 text-sm font-medium text-student-ink">
          <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", done ? "text-st-applied" : review ? "text-st-attention" : "text-student-muted")} aria-hidden="true" />
          <span className="min-w-0 break-words">{r.title}</span>
        </span>
        <span className="shrink-0 text-sm tabular-nums text-student-ink">
          {known ? t("dj.req.progress", { done: formatCents(applied!, language), total: formatCents(required!, language) }) : review ? t("dj.req.review") : done ? t("dj.req.done") : ""}
        </span>
      </div>
      {known && (
        <div className="h-2 overflow-hidden rounded-full bg-student-line" role="img" aria-label={t("dj.req.progress", { done: formatCents(applied!, language), total: formatCents(required!, language) })}>
          <span className={cn("block h-full rounded-full", done ? "bg-st-applied" : "bg-student-gold")} style={{ width: `${pct}%` }} />
        </div>
      )}
      {known && !done && remaining !== null && remaining > 0 && <p className="text-xs text-student-muted">{t("dj.req.open", { n: formatCents(remaining, language) })}</p>}
    </li>
  );
}

export function RequirementsCard({ progress }: { progress: StudentDegreeProgressView | null }) {
  const { t } = useDj();
  if (!progress || progress.state !== "COMPOSED" || progress.requirements.length === 0) return null;
  const met = progress.requirements.filter((r) => r.status === "SATISFIED").length;
  return (
    <section className={cn(cardClass, "min-w-0 space-y-4")} aria-labelledby="dj-req-title" data-testid="requirements-card">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="dj-req-title" className="font-serif text-2xl tracking-tight text-student-ink">{t("dj.req.title")}</h2>
        <p className="text-sm text-student-muted">{t("dj.req.summary", { met, total: progress.requirements.length })}</p>
      </header>
      <ul className="grid gap-x-8 gap-y-4 md:grid-cols-2">
        {progress.requirements.map((r) => <RequirementRow key={r.requirementId} r={r} />)}
      </ul>
    </section>
  );
}
