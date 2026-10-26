/** Sections E (assessments) and G (credits). */
import React from "react";
import { HelpCircle } from "lucide-react";
import type { StudentGraduateProgramView } from "@shared/graduate-program-contract";
import { cn } from "@/lib/utils";
import { Pill, SectionHeading, cardClass } from "@/components/student-progress/student-ui";
import { FinishedSection } from "./graduate-ui";
import { SECTION_IDS, conditionalLabel, creditAmountLabel, creditIsUnknown, isUnconfirmedBasis, studentBasis, visibleCreditLayers } from "./graduate-presentation";

type Program = StudentGraduateProgramView;

const norm = (v: string) => v.trim().replace(/[.\s]+$/, "").toLowerCase();
const sameText = (a: string, b: string) => norm(a) === norm(b);

export function AssessmentSection({ assessment, summary }: { assessment: Program["assessment"]; summary?: string | null }) {
  const unconfirmed = isUnconfirmedBasis(assessment.basis);
  const body = (
    <div className={cn(cardClass, "space-y-3")}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-serif text-lg text-student-ink" data-testid="assessment-mode">{assessment.mode}</h3>
          {unconfirmed && <Pill tone="attn" icon={<HelpCircle className="h-3 w-3" aria-hidden="true" />} data-testid="assessment-unconfirmed">Not confirmed by the university</Pill>}
        </div>
        {!sameText(assessment.description, assessment.mode) && (
          <p className="text-sm leading-relaxed text-student-ink" data-testid="assessment-description">{assessment.description}</p>
        )}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-student-muted">Passing mark</dt>
            <dd className="font-medium text-student-ink" data-testid="assessment-passing">{assessment.passing ?? "To be confirmed"}</dd>
          </div>
          <div>
            <dt className="text-student-muted">Where this rule comes from</dt>
            <dd className="text-student-ink" data-testid="assessment-basis">{studentBasis(assessment.basis)}</dd>
          </div>
        </dl>
      </div>
  );
  if (summary) {
    return (
      <FinishedSection id="graduate-assessment-title" sectionId={SECTION_IDS.assessment} title="How you are assessed" summary={summary} testId="graduate-assessment">
        {body}
      </FinishedSection>
    );
  }
  return (
    <section aria-labelledby="graduate-assessment-title" id={SECTION_IDS.assessment} className="scroll-mt-24 space-y-4" data-testid="graduate-assessment">
      <SectionHeading id="graduate-assessment-title" title="How you are assessed" description="This is the rule for your own cohort only." />
      {body}
    </section>
  );
}

export function CreditsSection({ program }: { program: Program }) {
  const layers = visibleCreditLayers(program);
  return (
    <section aria-labelledby="graduate-credits-title" id={SECTION_IDS.credits} className="scroll-mt-24 space-y-4" data-testid="graduate-credits">
      <SectionHeading
        id="graduate-credits-title"
        title="Where your credits stand"
        description="Each line comes from a different institution. They are never added together, because they do not mean the same thing."
      />
      <ul className={cn(cardClass, "divide-y divide-student-line")}>
        {layers.map((c) => (
          <li key={c.authority} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6" data-testid="credit-layer" data-state={c.state}>
            <div className="min-w-0 sm:max-w-[60%]">
              <p className="font-medium text-student-ink">{c.label}</p>
              <p className="text-xs leading-relaxed text-student-muted">{c.explanation}</p>
            </div>
            <div className="shrink-0 sm:text-right">
              <p className={cn("flex items-center gap-1.5 text-base font-semibold sm:justify-end", creditIsUnknown(c) ? "text-student-muted" : "text-student-ink")} data-testid="credit-amount">
                {creditIsUnknown(c) && <HelpCircle className="h-4 w-4" aria-hidden="true" />}
                <span>{creditAmountLabel(c)}</span>
                {conditionalLabel(c) && <span className="text-sm font-medium text-st-attention" data-testid="credit-conditional">&middot; {conditionalLabel(c)}</span>}
              </p>
              {conditionalLabel(c) && (
                <a href={`#${SECTION_IDS.learning}`} className="text-xs font-medium text-student-gold-ink underline underline-offset-4" data-testid="credit-conditions-link">See the conditions in Previous learning</a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
