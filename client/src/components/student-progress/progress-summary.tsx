/**
 * The ONE overall progress presentation: a stacked count bar plus four counts.
 * Counts only; there is no weighted percentage and no credit figure here.
 */
import React from "react";
import { Link } from "wouter";
import { ArrowRight, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import {
  countSegments,
  countsSentence,
  currentPhase,
  phaseSummaryLine,
  segmentFraction,
} from "@/pages/student-roadmap-presentation";
import { buttonClass, cardClass } from "./student-ui";

const SEGMENT_STYLE: Record<string, React.CSSProperties> = {
  accepted: { background: "hsl(var(--s-seal))" },
  provider: { background: "hsl(var(--s-gold-fill))" },
  progress: {
    background:
      "repeating-linear-gradient(135deg, hsl(var(--s-gold-soft)) 0 5px, hsl(var(--s-gold) / 0.55) 5px 7px)",
    boxShadow: "inset 0 0 0 1.5px hsl(var(--s-gold))",
  },
  not_started: { background: "transparent", boxShadow: "inset 0 0 0 1.5px hsl(var(--s-line-strong))" },
};

function Swatch({ kind }: { kind: string }) {
  return <span aria-hidden="true" className="inline-block h-3.5 w-3.5 rounded-sm" style={SEGMENT_STYLE[kind]} />;
}

export function ProgressSummary({
  view,
  showRoadmapLink = false,
  variant = "flight-deck",
}: {
  view: StudentRoadmapView;
  showRoadmapLink?: boolean;
  variant?: "flight-deck" | "roadmap";
}) {
  const segments = countSegments(view.counts);
  const phase = currentPhase(view);
  return (
    <section aria-labelledby="progress-summary-title" className={cardClass} data-testid="progress-summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {variant === "flight-deck" && (
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-student-gold-ink">Your roadmap</p>
          )}
          <h2 id="progress-summary-title" className="font-serif text-xl text-student-ink sm:text-2xl">
            {variant === "flight-deck" ? (view.plan?.title ?? "Your roadmap") : "Where you are"}
          </h2>
          <p className="mt-0.5 text-sm text-student-muted" data-testid="summary-scope">
            Counts for your whole plan, all phases: {view.counts.itemsTotal} {view.counts.itemsTotal === 1 ? "item" : "items"}.
          </p>
        </div>
        {showRoadmapLink && (
          <Link href="/roadmap" className={buttonClass.link} data-testid="link-full-roadmap">
            Open your full roadmap <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </div>

      <div
        role="img"
        aria-label={countsSentence(view.counts)}
        className="mt-4 flex h-4 w-full gap-1"
        data-testid="count-bar"
      >
        {segments.map((s) =>
          s.value > 0 ? (
            <span
              key={s.key}
              className="h-full rounded-full"
              style={{ ...SEGMENT_STYLE[s.key], flexGrow: segmentFraction(s.value, view.counts), flexBasis: 0, minWidth: 10 }}
              data-segment={s.key}
            />
          ) : null,
        )}
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4" data-testid="count-legend">
        {segments.map((s) => (
          <li key={s.key} className="flex items-start gap-2" data-count={s.key}>
            <Swatch kind={s.key} />
            <p className="-mt-0.5">
              <span className="block font-serif text-2xl leading-none text-student-ink">{s.value}</span>
              <span className="mt-1 block text-xs text-student-muted">{s.label}</span>
            </p>
          </li>
        ))}
      </ul>

      {phase && (
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-student-line pt-3 text-sm text-student-muted" data-testid="current-phase-line">
          <MapPin className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
          <span>
            {phase.state === "current" ? "Current phase" : phase.state === "complete" ? "Last phase" : "Next phase"}:{" "}
            <strong className="font-semibold text-student-ink">{phase.title}</strong>
          </span>
          <span>· {phaseSummaryLine(phase)}</span>
        </p>
      )}
    </section>
  );
}
