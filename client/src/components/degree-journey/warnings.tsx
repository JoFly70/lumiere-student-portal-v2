/**
 * "Good to know": the plan's holds, approvals and canonical checks in plain language.
 * Sentences come from buildWarnings (keys + params); policy codes, caps and staff notes never reach here.
 */
import React, { useId, useState } from "react";
import { ChevronDown, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { cardClass } from "@/components/student-progress/student-ui";
import type { DegreeWarning } from "./model";
import { useDj } from "./i18n";

const VISIBLE = 3;

export function WarningsCard({ warnings }: { warnings: readonly DegreeWarning[] }) {
  const { t } = useDj();
  const id = useId();
  const [open, setOpen] = useState(false);
  if (warnings.length === 0) return null;
  const head = warnings.slice(0, VISIBLE);
  const rest = warnings.slice(VISIBLE);
  const row = (w: DegreeWarning) => (
    <li key={w.id} className="flex items-start gap-2.5 py-2 text-sm text-student-ink" data-testid="warning-row" data-tone={w.tone}>
      {w.tone === "attention" ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-st-attention" aria-hidden="true" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-student-muted" aria-hidden="true" />}
      <span className="min-w-0 break-words">{t(w.key, w.params as Record<string, string | number>)}</span>
    </li>
  );
  return (
    <section className={cn(cardClass, "min-w-0 space-y-1")} aria-labelledby={`${id}-h`} data-testid="degree-warnings">
      <h2 id={`${id}-h`} className="font-serif text-xl tracking-tight text-student-ink">{t("dj.warn.title")}</h2>
      <ul className="divide-y divide-student-line">{head.map(row)}</ul>
      {rest.length > 0 && (
        <>
          <ul id={`${id}-more`} hidden={!open} className="divide-y divide-student-line border-t border-student-line">{rest.map(row)}</ul>
          <button type="button" aria-expanded={open} aria-controls={`${id}-more`} onClick={() => setOpen((o) => !o)} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-student-gold-ink" data-testid="button-warnings-more">
            {open ? t("dj.done.hide") : t("dj.warn.more", { n: rest.length })}
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </button>
        </>
      )}
    </section>
  );
}
