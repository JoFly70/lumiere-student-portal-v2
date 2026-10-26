/**
 * YOUR FOUNDATION: prior credentials and the credit ladder. All credit numbers
 * come from view.foundation.ladder. Requirement-level detail is an optional,
 * lazily loaded expansion supplied by the page.
 */
import React from "react";
import { Link } from "wouter";
import { ArrowRight, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentFoundationView } from "@shared/student-roadmap-contract";
import {
  APPLIED_VS_VERIFIED,
  PLANNED_EXPLANATION,
  SURPLUS_EXPLANATION,
  barFraction,
  creditsText,
  foundationHeadline,
  foundationStateNote,
  hasPositive,
  ladderAriaLabel,
  ladderRungs,
  ladderScale,
} from "@/pages/student-roadmap-presentation";
import { creditStandingPresentation, formatAsOf, formatDecimal } from "@/pages/student-progress-presentation";
import { Disclosure, Pill, SectionHeading, buttonClass, cardClass } from "./student-ui";

type Ladder = StudentFoundationView["ladder"];

const RUNG_BAR: Record<string, React.CSSProperties> = {
  reported: { boxShadow: "inset 0 0 0 1.5px hsl(var(--s-line-strong))", background: "transparent" },
  provisional: {
    background: "repeating-linear-gradient(135deg, hsl(var(--s-gold-soft)) 0 5px, hsl(var(--s-gold) / 0.55) 5px 7px)",
    boxShadow: "inset 0 0 0 1.5px hsl(var(--s-gold))",
  },
  verified: { background: "hsl(var(--s-gold))" },
  applied: { background: "hsl(var(--s-seal))" },
  planned: { border: "1.5px dashed hsl(var(--s-gold-ink))", background: "transparent" },
};

/** Credit ladder: bars share one scale; a tick marks what the degree requires. */
export function CreditLadder({ ladder, compact = false }: { ladder: Ladder; compact?: boolean }) {
  const scale = ladderScale(ladder);
  const rungs = ladderRungs(ladder).filter((r) => !compact || r.key === "verified" || r.key === "applied");
  const requiredAt = barFraction(ladder.required, scale);
  const rows = [
    ...rungs.map((r) => ({ ...r })),
    ...(!compact
      ? [{ key: "planned" as const, label: "Planned", value: ladder.planned, help: "On your roadmap, not yet accepted." }]
      : []),
  ];
  return (
    <div data-testid="credit-ladder" role="group" aria-label={`Credit ladder: ${ladderAriaLabel(ladder)}`}>
      <ol className="space-y-3">
        {rows.map((r) => (
          <li key={r.key} data-rung={r.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-student-ink">{r.label}</span>
              <span className="font-serif text-lg text-student-ink" data-testid={`rung-${r.key}`}>
                {r.value === null ? <span className="font-sans text-sm text-student-muted">Under review</span> : (formatDecimal(r.value) ?? r.value)}
              </span>
            </div>
            <div className="relative mt-1 h-3 w-full rounded-full bg-student-line/60" aria-hidden="true">
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${Math.round(barFraction(r.value, scale) * 1000) / 10}%`, ...RUNG_BAR[r.key] }}
              />
              {ladder.required && (
                <span
                  className="absolute -top-1 bottom-[-4px] w-0.5 bg-student-ink"
                  style={{ left: `calc(${requiredAt * 100}% - 1px)` }}
                />
              )}
            </div>
            {!compact && <p className="mt-1 text-xs text-student-muted">{r.help}</p>}
          </li>
        ))}
      </ol>
      {ladder.required && (
        <p className="mt-2 flex items-center gap-2 text-xs text-student-muted">
          <span className="inline-block h-3 w-0.5 bg-student-ink" aria-hidden="true" />
          Your degree requires {creditsText(ladder.required)}
        </p>
      )}
      {hasPositive(ladder.surplus) && (
        <p className="mt-3 rounded-lg bg-student-gold-soft px-3 py-2.5 text-sm text-student-ink" data-testid="surplus-note">
          <strong className="font-semibold">Surplus: {creditsText(ladder.surplus)}.</strong> {SURPLUS_EXPLANATION}
        </p>
      )}
    </div>
  );
}

export function CredentialsList({ foundation }: { foundation: StudentFoundationView }) {
  if (foundation.credentials.length === 0) return null;
  return (
    <ul className="divide-y divide-student-line" aria-label="Prior degrees and credentials" data-testid="credentials-list">
      {foundation.credentials.map((c) => {
        const standing = creditStandingPresentation(c.standing);
        const amount = c.awardedCredits ?? c.reportedCredits;
        const done = formatAsOf(c.completedOn);
        return (
          <li key={c.creditRecordId} className="flex flex-wrap items-start justify-between gap-2 py-3" data-testid="credential">
            <div className="flex min-w-0 items-start gap-3">
              <GraduationCap className="mt-0.5 h-5 w-5 shrink-0 text-student-gold-ink" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-student-ink">{c.title}</p>
                <p className="text-sm text-student-muted">
                  {[done ? `Completed ${done}` : null, c.sourceTitle].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {amount && <span className="text-sm text-student-muted">{creditsText(amount)}</span>}
              <Pill tone={standing.verified ? "gold" : "dashed"}>{standing.label}</Pill>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function FoundationSection({
  foundation,
  requirementDetails,
}: {
  foundation: StudentFoundationView;
  requirementDetails?: React.ReactNode;
}) {
  const note = foundationStateNote(foundation);
  return (
    <section aria-labelledby="foundation-title" id="section-foundation" className="scroll-mt-28 space-y-4" data-testid="foundation-section">
      <SectionHeading
        id="foundation-title"
        eyebrow="Your foundation"
        title={foundationHeadline(foundation)}
        description="Where you begin: the degrees and credit you already hold. Only Lumière staff can verify credit and apply it to your degree."
      />
      <div className="grid gap-4 lg:grid-cols-5">
        {foundation.credentials.length > 0 && (
          <div className={cn(cardClass, "lg:col-span-3")}>
            <h3 className="mb-1 text-sm font-semibold text-student-ink">Prior degrees and credentials</h3>
            <CredentialsList foundation={foundation} />
          </div>
        )}
        <div className={cn(cardClass, foundation.credentials.length > 0 ? "lg:col-span-2" : "lg:col-span-5")}>
          <h3 className="mb-3 text-sm font-semibold text-student-ink">Your credit ladder</h3>
          <CreditLadder ladder={foundation.ladder} />
          {note && <p className="mt-3 text-sm text-student-muted" data-testid="foundation-note">{note}</p>}
          <Disclosure label="What these words mean" className="mt-2 border-t border-student-line" testId="ladder-help">
            <div className="space-y-2 pb-2 text-sm text-student-muted">
              <p>{APPLIED_VS_VERIFIED}</p>
              <p><strong className="font-medium text-student-ink">Planned.</strong> {PLANNED_EXPLANATION}</p>
            </div>
          </Disclosure>
        </div>
      </div>
      {requirementDetails && (
        <div className={cardClass}>
          <Disclosure label="How your credit applies to each requirement" lazy testId="requirement-details">
            {requirementDetails}
          </Disclosure>
        </div>
      )}
    </section>
  );
}

/** Compact version for Flight Deck. */
export function FoundationSummary({ foundation }: { foundation: StudentFoundationView }) {
  return (
    <section aria-labelledby="foundation-summary-title" className={cardClass} data-testid="foundation-summary">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-student-gold-ink">Your foundation</p>
      <h2 id="foundation-summary-title" className="font-serif text-xl text-student-ink">{foundationHeadline(foundation)}</h2>
      <div className="mt-4">
        <CreditLadder ladder={foundation.ladder} compact />
      </div>
      <Link href="/roadmap#section-foundation" className={`${buttonClass.link} mt-2`} data-testid="link-foundation">
        See your full foundation <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}
