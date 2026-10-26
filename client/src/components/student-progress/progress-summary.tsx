/**
 * The ONE overall progress presentation: a stacked count bar plus four counts of
 * ROADMAP COURSES, then the prior-credit baseline as a separate, labelled figure.
 * Counts only; there is no weighted percentage and no estimate.
 */
import React from "react";
import { CheckCheck } from "lucide-react";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import {
  COUNT_SCOPE_NOTE,
  awaitingGradingSentence,
  countSegments,
  countsSentence,
  priorCreditBaseline,
  primaryObjectiveTitle,
  segmentFraction,
} from "@/pages/student-roadmap-presentation";
import { Eyebrow, STATUS_STYLE, StatusGlyph, cardClass } from "./student-ui";
import { cn } from "@/lib/utils";

/** Bar styles per segment. Colour is always paired with a pattern: solid, ridged, hatched or outlined. */
const SEGMENT_STYLE: Record<string, React.CSSProperties> = {
  accepted: { background: "hsl(var(--st-official))" },
  provider: {
    background: "repeating-linear-gradient(90deg, hsl(var(--st-provider)) 0 6px, hsl(var(--st-provider) / 0.78) 6px 8px)",
  },
  progress: {
    background:
      "repeating-linear-gradient(135deg, hsl(var(--st-progress-soft)) 0 5px, hsl(var(--st-progress) / 0.7) 5px 7px)",
    boxShadow: "inset 0 0 0 1.5px hsl(var(--st-progress))",
  },
  not_started: { background: "transparent", boxShadow: "inset 0 0 0 1.5px hsl(var(--s-line-strong))" },
};

export function ProgressSummary({ view }: { view: StudentRoadmapView }) {
  const segments = countSegments(view.counts);
  const baseline = priorCreditBaseline(view.foundation);
  const awaiting = awaitingGradingSentence(view);
  const noun = view.counts.itemsTotal === 1 ? "roadmap course" : "roadmap courses";
  return (
    <section aria-labelledby="progress-summary-title" id="section-progress" className={cn(cardClass, "scroll-mt-20")} data-testid="progress-summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>Your progress</Eyebrow>
          <h2 id="progress-summary-title" className="mt-1 font-serif text-xl text-student-ink sm:text-2xl">
            {primaryObjectiveTitle(view) ?? "Your roadmap"}
          </h2>
          <p className="mt-0.5 text-sm text-student-muted" data-testid="summary-scope">
            Roadmap courses across all phases: {view.counts.itemsTotal} {noun}.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div
            role="img"
            aria-label={countsSentence(view.counts)}
            className="flex h-4 w-full gap-1"
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

          <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4" data-testid="count-legend" aria-label="Roadmap courses by stage">
            {segments.map((s) => (
              <li key={s.key} className="flex items-start gap-2" data-count={s.key} data-status={s.status}>
                <p className="min-w-0">
                  <span className="block font-serif text-3xl leading-none text-student-ink">{s.value}</span>
                  <span className={cn("mt-1.5 flex items-start gap-1.5 text-xs font-medium leading-snug", STATUS_STYLE[s.status].text)}>
                    <StatusGlyph status={s.status} className="mt-px" />
                    <span>{s.label}</span>
                  </span>
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-student-muted" data-testid="count-scope-note">{COUNT_SCOPE_NOTE}</p>
          {awaiting && (
            <p className={cn("mt-3 flex items-center gap-2 text-sm font-medium", STATUS_STYLE.submitted.text)} data-testid="awaiting-grading">
              <StatusGlyph status="submitted" className="h-4 w-4" />
              {awaiting}
            </p>
          )}
        </div>

        <div
          className="rounded-xl border border-student-line bg-student-bg p-4 lg:col-span-2"
          data-testid="credit-baseline"
          role="group"
          aria-label="Prior-credit baseline, separate from roadmap courses"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-student-muted">Prior-credit baseline</p>
          <p className="mt-1 flex items-start gap-2">
            <CheckCheck className={cn("mt-1 h-5 w-5 shrink-0", STATUS_STYLE.applied.text)} aria-hidden="true" />
            <span className="font-serif text-2xl leading-tight text-student-ink" data-testid="baseline-figure">{baseline.headline}</span>
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-student-muted">{baseline.detail}</p>
        </div>
      </div>
    </section>
  );
}
