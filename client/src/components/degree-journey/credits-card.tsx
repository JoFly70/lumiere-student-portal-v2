/**
 * "Where your N credits come from": one stacked bar of the program's required credits.
 * Earned (by source) | in progress or planned (by provider) | still open, with a legend that carries
 * every number, so colour is never the only carrier. Earned is canonical; planned is only a plan.
 */
import React from "react";
import { cn } from "@/lib/utils";
import { cardClass } from "@/components/student-progress/student-ui";
import { formatCents, type CreditSegment, type CreditsBySource } from "./model";
import { useDj, type DjKey } from "./i18n";

const EARNED_FILL: Record<NonNullable<CreditSegment["sourceKind"]>, string> = {
  transfer: "bg-st-applied",
  workplace: "bg-st-submitted",
  exam: "bg-st-provider",
  provider: "bg-st-official",
  other: "bg-st-notstarted",
};
const PLANNED_FILLS = ["bg-st-progress", "bg-st-progress/70", "bg-st-progress/50", "bg-st-progress/35"] as const;
const OPEN_FILL = "border border-dashed border-student-line-strong bg-student-card";

function fillFor(seg: CreditSegment, plannedIndex: number): string {
  if (seg.group === "earned") return EARNED_FILL[seg.sourceKind ?? "other"];
  if (seg.group === "planned") return PLANNED_FILLS[Math.min(plannedIndex, PLANNED_FILLS.length - 1)];
  return OPEN_FILL;
}

export function CreditsCard({ data }: { data: CreditsBySource }) {
  const { t, language } = useDj();
  const fc = (c: number) => formatCents(c, language);
  const n = (c: number) => (c === 100 ? t("dj.credits.n1") : t("dj.credits.n", { n: fc(c) }));

  if (data.state === "unavailable" || data.requiredCents === null) {
    return (
      <section className={cn(cardClass, "min-w-0")} aria-labelledby="dj-credits-title" data-testid="credits-by-source" data-state="unavailable">
        <h2 id="dj-credits-title" className="font-serif text-2xl tracking-tight text-student-ink">{t("dj.credits.titleUnknown")}</h2>
        <p className="mt-2 text-sm text-student-muted">{t("dj.credits.unavailable")}</p>
      </section>
    );
  }

  const required = data.requiredCents;
  const scale = Math.max(required, data.earnedCents + data.plannedCents);
  let plannedIndex = -1;
  const rows = data.segments.map((seg) => {
    if (seg.group === "planned") plannedIndex += 1;
    return { seg, fill: fillFor(seg, plannedIndex) };
  });
  const label = (seg: CreditSegment): string => {
    if (seg.group === "earned") return t(`dj.credits.src.${seg.sourceKind ?? "other"}` as DjKey);
    if (seg.group === "planned") return seg.providerName ?? t("dj.credits.planned.unassigned");
    return t("dj.credits.open");
  };
  const groups = [
    { id: "earned", title: t("dj.credits.earnedGroup"), total: data.earnedCents, show: data.earnedKnown },
    { id: "planned", title: t("dj.credits.plannedGroup"), total: data.plannedCents, show: data.plannedCents > 0 },
    { id: "open", title: t("dj.credits.openGroup"), total: data.openCents ?? 0, show: data.openCents !== null && data.openCents > 0 },
  ] as const;

  return (
    <section className={cn(cardClass, "min-w-0 space-y-4")} aria-labelledby="dj-credits-title" data-testid="credits-by-source" data-state="ready">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="dj-credits-title" className="font-serif text-2xl tracking-tight text-student-ink">{t("dj.credits.title", { total: fc(required) })}</h2>
        {data.earnedKnown && (
          <p className="text-sm text-student-muted" data-testid="credits-earned-total">
            <span className="font-serif text-2xl text-student-ink">{fc(data.earnedCents)}</span> / {fc(required)}
          </p>
        )}
      </header>

      <div
        className="flex h-4 w-full overflow-hidden rounded-full bg-student-line"
        role="img"
        aria-label={t("dj.credits.aria", { earned: fc(data.earnedCents), planned: fc(data.plannedCents), open: fc(data.openCents ?? 0), total: fc(required) })}
        data-testid="credits-bar"
      >
        {rows.map(({ seg, fill }) => (
          <span key={seg.id} className={cn("h-full min-w-[3px] border-r-2 border-student-card last:border-r-0", fill)} style={{ flexGrow: seg.cents, flexBasis: `${(seg.cents / scale) * 100}%`, flexShrink: 1 }} data-segment={seg.id} />
        ))}
      </div>

      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.filter((g) => g.show).map((g) => (
          <div key={g.id} className="min-w-0" data-testid={`credits-group-${g.id}`}>
            <h3 className="flex items-baseline justify-between gap-2 border-b border-student-line pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-student-muted">
              <span>{g.title}</span>
              <span className="text-student-ink">{fc(g.total)}</span>
            </h3>
            <ul className="mt-1.5 space-y-1.5">
              {rows.filter((r) => r.seg.group === g.id).map(({ seg, fill }) => (
                <li key={seg.id} className="flex items-start gap-2 text-sm" data-testid="credits-legend-row">
                  <i aria-hidden="true" className={cn("mt-1 h-3 w-3 shrink-0 rounded-sm", fill)} />
                  <span className="min-w-0 flex-1 break-words text-student-ink">
                    {label(seg)}
                    {seg.group === "planned" && !!seg.startedCents && seg.startedCents > 0 && (
                      <span className="block text-xs text-student-muted">{t("dj.credits.inProgress", { n: fc(seg.startedCents) })}</span>
                    )}
                    {seg.group === "open" && <span className="block text-xs text-student-muted">{t("dj.credits.open.help")}</span>}
                  </span>
                  <span className="shrink-0 font-medium text-student-ink tabular-nums">{n(seg.cents)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="text-xs leading-snug text-student-muted" data-testid="credits-note">
        {t("dj.credits.note")}
        {data.overPlanned ? ` ${t("dj.credits.overPlanned")}` : ""}
      </p>
    </section>
  );
}
