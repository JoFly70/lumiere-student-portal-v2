/**
 * YOUR FOUNDATION: prior credentials and the credit ladder. All credit numbers
 * come from view.foundation.ladder (the canonical record). The Flight Deck owns
 * this section in full; the Roadmap links to it.
 *
 * Colour language (same everywhere): Verified = official charcoal, Applied =
 * green, Waiting for verification = teal hatched, Planned = blue dashed. The
 * Verified bar is ALWAYS charcoal; surplus is the hatched end of it, never a
 * colour change.
 */
import React from "react";
import { GraduationCap } from "lucide-react";
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
  ladderTotalsSentence,
  credentialStandingLabel,
  stillToPlan,
  otherCreditNote,
} from "@/pages/student-roadmap-presentation";
import { formatAsOf, formatDecimal } from "@/pages/student-progress-presentation";
import { Disclosure, SectionHeading, StatusPill, cardClass } from "./student-ui";

type Ladder = StudentFoundationView["ladder"];

const HATCH = (c: string) => `repeating-linear-gradient(135deg, transparent 0 4px, hsl(var(${c}) / 0.8) 4px 6px)`;
const SEG: Record<string, React.CSSProperties> = {
  reported: { boxShadow: "inset 0 0 0 1.5px hsl(var(--s-line-strong))", background: "transparent" },
  waiting: { background: HATCH("--st-submitted"), boxShadow: "inset 0 0 0 1.5px hsl(var(--st-submitted))" },
  verified: { background: "hsl(var(--st-official))" },
  applied: { background: "hsl(var(--st-applied))" },
  surplus: { background: HATCH("--st-official"), boxShadow: "inset 0 0 0 1.5px hsl(var(--st-official))" },
  planned: { border: "1.5px dashed hsl(var(--st-progress))", background: "transparent" },
  still: { border: "1.5px dotted hsl(var(--s-line-strong))", background: "transparent" },
};

/** Each bar is drawn as the segments it is made of, so "cumulative" is visible. */
function barSegments(key: string, ladder: Ladder, scale: number): { style: string; start: number; width: number }[] {
  const f = (v: string | null) => barFraction(v, scale);
  const verified = f(ladder.verified);
  const waiting = f(ladder.provisional);
  const applied = f(ladder.applied);
  const surplus = f(ladder.surplus);
  if (key === "reported" && hasPositive(ladder.verified) && hasPositive(ladder.provisional)) {
    return [
      { style: "verified", start: 0, width: verified },
      { style: "waiting", start: verified, width: waiting },
    ];
  }
  if (key === "verified" && hasPositive(ladder.applied) && hasPositive(ladder.surplus)) {
    // Same charcoal hue either way: the solid part is applied, the hatched end is surplus.
    return [
      { style: "verified", start: 0, width: applied },
      { style: "surplus", start: applied, width: surplus },
    ];
  }
  if (key === "planned" || key === "still") {
    // Planned starts where Applied ends; "Still to plan" follows it up to what the degree requires.
    const base = applied;
    const planned = f(ladder.planned);
    const start = key === "planned" ? base : Math.min(1, base + planned);
    const width = key === "planned" ? planned : f(stillToPlan(ladder));
    return [{ style: key, start, width: Math.min(width, Math.max(0, 1 - start)) }];
  }
  const single: Record<string, [string, number]> = {
    reported: ["reported", f(ladder.reported)],
    provisional: ["waiting", waiting],
    verified: ["verified", verified],
    applied: ["applied", applied],
    planned: ["planned", f(ladder.planned)],
  };
  const [style, width] = single[key] ?? ["reported", 0];
  return [{ style, start: 0, width }];
}

function Swatch({ kind }: { kind: string }) {
  return <span aria-hidden="true" className="inline-block h-3 w-4 shrink-0 rounded-sm" style={SEG[kind]} />;
}

const SWATCH_FOR: Record<string, string> = {
  reported: "reported",
  provisional: "waiting",
  verified: "verified",
  applied: "applied",
  planned: "planned",
  still: "still",
};

/** Credit ladder: cumulative. Bars share one scale; a tick marks what the degree requires. */
export function CreditLadder({ ladder }: { ladder: Ladder }) {
  const scale = ladderScale(ladder);
  const rungs = ladderRungs(ladder);
  const requiredAt = barFraction(ladder.required, scale);
  const rows = [
    ...rungs.map((r) => ({ ...r })),
    { key: "planned" as const, label: "Planned (not credit yet)", value: ladder.planned, help: "On your roadmap, not yet accepted. It starts where Applied ends and is not part of the total above." },
    ...(stillToPlan(ladder)
      ? [{ key: "still" as const, label: "Still to plan", value: stillToPlan(ladder), help: "What your degree still needs that no roadmap item covers yet. Lumière may add items." }]
      : []),
  ];
  return (
    <div data-testid="credit-ladder" role="group" aria-label={`Credit ladder: ${ladderAriaLabel(ladder)}`}>
      <p className="mb-3 text-sm font-medium text-student-ink" data-testid="ladder-totals">{ladderTotalsSentence(ladder)}</p>
      <ol className="space-y-3">
        {rows.map((r) => (
          <li key={r.key} data-rung={r.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 font-medium text-student-ink">
                <Swatch kind={SWATCH_FOR[r.key]} />
                {r.label}
              </span>
              <span className="font-serif text-lg text-student-ink" data-testid={`rung-${r.key}`}>
                {r.value === null ? <span className="font-sans text-sm text-student-muted">Under review</span> : (formatDecimal(r.value) ?? r.value)}
              </span>
            </div>
            <div className="relative mt-1 h-3 w-full rounded-full bg-student-line/60" aria-hidden="true">
              {barSegments(r.key, ladder, scale).map((seg, i) => (
                <span
                  key={i}
                  className="absolute inset-y-0"
                  data-bar={r.key}
                  data-seg={seg.style}
                  style={{
                    left: `${Math.round(seg.start * 1000) / 10}%`,
                    width: `${Math.round(seg.width * 1000) / 10}%`,
                    borderRadius: i === 0 ? "9999px 0 0 9999px" : "0 9999px 9999px 0",
                    ...SEG[seg.style],
                  }}
                />
              ))}
              {ladder.required && (
                <span
                  className="absolute -top-1 bottom-[-4px] w-0.5 bg-student-ink"
                  style={{ left: `calc(${requiredAt * 100}% - 1px)` }}
                />
              )}
            </div>
            <p className="mt-1 text-xs text-student-muted">{r.help}</p>
            {r.key === "verified" && hasPositive(ladder.surplus) && hasPositive(ladder.applied) && (
              <p className="mt-0.5 text-xs font-medium text-student-ink" data-testid="verified-split">
                {creditsText(ladder.applied)} applied (solid) + {creditsText(ladder.surplus)} surplus (hatched)
              </p>
            )}
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
        <p className="mt-3 rounded-lg bg-st-official-soft px-3 py-2.5 text-sm text-student-ink" data-testid="surplus-note">
          <strong className="font-semibold">Surplus: {creditsText(ladder.surplus)}</strong> (the hatched end of the Verified bar). {SURPLUS_EXPLANATION}
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
        const standing = credentialStandingLabel(c.standing);
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
              <StatusPill status={standing.status} label={standing.label} />
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
    <section aria-labelledby="foundation-title" id="section-foundation" className="scroll-mt-20 space-y-4" data-testid="foundation-section">
      <SectionHeading
        id="foundation-title"
        eyebrow="Your foundation"
        title={foundationHeadline(foundation)}
        description="Where you begin: the degrees and credit you already hold. Only Lumière staff can verify credit and apply it to your degree."
      />
      <div className="grid items-start gap-4 lg:grid-cols-5">
        {foundation.credentials.length > 0 && (
          <div className={cn(cardClass, "lg:col-span-3")}>
            <h3 className="mb-1 text-sm font-semibold text-student-ink">Prior degrees and credentials</h3>
            <CredentialsList foundation={foundation} />
            {otherCreditNote(foundation) && (
              <p className="mt-2 border-t border-student-line pt-3 text-sm text-student-muted" data-testid="other-credit-note">
                {otherCreditNote(foundation)}
              </p>
            )}
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
