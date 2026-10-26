/** Section C: previous learning. Requested credits are never shown as recognized. */
import React from "react";
import { Check, Circle, CircleDot } from "lucide-react";
import type { StudentGraduateProgramView } from "@shared/graduate-program-contract";
import { cn } from "@/lib/utils";
import { SectionHeading, StatusPill, cardClass } from "@/components/student-progress/student-ui";
import { SECTION_IDS, formatCount, formatDate, isNotRecognized, recognitionItemStatus } from "./graduate-presentation";
import { DecisionPill, FinishedSection } from "./graduate-ui";

type Learning = NonNullable<StudentGraduateProgramView["previousLearning"]>;

const STEPS: { key: Learning["requestState"]; label: string }[] = [
  { key: "requested", label: "Requested" },
  { key: "under_review", label: "Under review" },
  { key: "decided", label: "Decided" },
];

/** Only completed steps get a tick. Before any request there is no current step at all. */
export function RequestSteps({ state }: { state: Learning["requestState"] }) {
  const current = STEPS.findIndex((s) => s.key === state);
  return (
    <ol className="grid grid-cols-3 gap-3" aria-label="Recognition request steps" data-testid="request-steps">
      {STEPS.map((s, i) => {
        const done = current >= 0 && (i < current || (state === "decided" && i === current));
        const isCurrent = i === current && !done;
        const reached = i <= current;
        return (
          <li key={s.key} className="min-w-0" aria-current={isCurrent ? "step" : undefined} data-reached={reached} data-done={done}>
            <span aria-hidden="true" className={cn("mb-2 block h-1.5 rounded-full", reached ? "bg-student-gold" : "border border-dashed border-student-line-strong")} />
            <p className={cn("flex items-center gap-1.5 text-sm", isCurrent ? "font-semibold text-student-ink" : done ? "text-student-ink" : "text-student-muted")}>
              {done ? <Check className="h-3.5 w-3.5 text-student-gold-ink" aria-hidden="true" /> : isCurrent ? <CircleDot className="h-3.5 w-3.5 text-student-gold-ink" aria-hidden="true" /> : <Circle className="h-3.5 w-3.5" aria-hidden="true" />}
              {s.label}
              {isCurrent && <span className="sr-only"> (current step)</span>}
              {done && <span className="sr-only"> (done)</span>}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

export function PreviousLearningSection({ learning, summary }: { learning: Learning; summary?: string | null }) {
  const d = learning.decision;
  const body = (
    <div className={cn(cardClass, "space-y-5")}>
      <p className="text-sm text-student-ink">
        ENEB modules completed: <strong data-testid="eneb-modules-completed">{learning.enebModulesCompleted}</strong>
      </p>
      <div className="space-y-2">
        <RequestSteps state={learning.requestState} />
        <p className="text-sm font-medium text-student-ink" data-testid="request-state-label">{learning.requestStateLabel}</p>
      </div>
      {d && (
        <div className="space-y-3 rounded-xl border border-student-line bg-student-bg p-4" data-testid="recognition-decision">
          <div className="flex flex-wrap items-center gap-2">
            {d.outcome === "none" ? (
              <DecisionPill label={d.outcomeLabel} data-testid="decision-outcome" />
            ) : (
              <StatusPill status={d.outcome === "full" ? "official" : "attention"} label={d.outcomeLabel} data-testid="decision-outcome" />
            )}
            {formatDate(d.decisionDate) && (
              <span className="text-xs text-student-muted">
                University decision of <time dateTime={d.decisionDate ?? undefined}>{formatDate(d.decisionDate)}</time>
              </span>
            )}
          </div>
          {d.items.length > 0 && (
            <ul className="divide-y divide-student-line" aria-label="What the university decided, item by item">
              {d.items.map((it, i) => (
                <li key={`${it.label}-${i}`} className="space-y-1 py-3 first:pt-0 last:pb-0" data-testid="decision-item">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-student-ink">{it.label}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-sm text-student-ink">{formatCount(it.amount)} {it.unit}</span>
                      {isNotRecognized(it.outcome) ? (
                        <DecisionPill label={it.outcome} data-testid="decision-item-outcome" />
                      ) : (
                        <StatusPill status={recognitionItemStatus(it.outcome)} label={it.outcome} data-testid="decision-item-outcome" />
                      )}
                    </span>
                  </div>
                  {it.conditions && (
                    <p className="rounded-md border border-st-attention bg-student-attn-soft px-3 py-2 text-sm text-student-ink" data-testid="decision-conditions">
                      <span className="font-semibold">Condition: </span>
                      {it.conditions}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {learning.outstanding.length > 0 && (
        <div data-testid="outstanding">
          <h3 className="text-sm font-semibold text-student-ink">Still to complete</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-student-ink">
            {learning.outstanding.map((o) => <li key={o}>{o}</li>)}
          </ul>
        </div>
      )}
      <p className="text-sm text-student-muted" data-testid="learning-note">{learning.note}</p>
    </div>
  );
  if (summary) {
    return (
      <FinishedSection id="graduate-learning-title" sectionId={SECTION_IDS.learning} title="Previous learning" summary={summary} testId="graduate-learning">
        {body}
      </FinishedSection>
    );
  }
  return (
    <section aria-labelledby="graduate-learning-title" id={SECTION_IDS.learning} className="scroll-mt-24 space-y-4" data-testid="graduate-learning">
      <SectionHeading
        id="graduate-learning-title"
        title="Previous learning"
        description="Whether the university recognizes your completed ENEB subjects is the university's decision, not ENEB's and not ours."
      />
      {body}
    </section>
  );
}
