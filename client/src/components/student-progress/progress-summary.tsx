/**
 * The ONE overall progress presentation: a stacked count bar plus four counts of
 * ROADMAP COURSES. Credit is NOT repeated here: the single applied-credit summary
 * lives in "Your foundation". Counts only; no weighted percentage, no estimate.
 */
import React from "react";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import {
  COUNT_SCOPE_NOTE,
  awaitingGradingSentence,
  countSegments,
  countsSentence,
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

      <div className="mt-5">
        <div>
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
          <p className="mt-3 text-xs text-student-muted" data-testid="count-scope-note">{COUNT_SCOPE_NOTE}{" "}
            "Complete at provider" is what you reported; only Lumière can accept it as official credit.{" "}
            <a href="#section-foundation" className="font-medium text-student-gold-ink underline underline-offset-4" data-testid="link-your-credits">See your credits</a>
          </p>
          {awaiting && (
            <p className={cn("mt-3 flex items-center gap-2 text-sm font-medium", STATUS_STYLE.submitted.text)} data-testid="awaiting-grading">
              <StatusGlyph status="submitted" className="h-4 w-4" />
              {awaiting}
            </p>
          )}
        </div>

      </div>
    </section>
  );
}
