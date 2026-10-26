/**
 * Flight Deck: the student's cockpit, rendered purely from the canonical
 * degree-progress view. Pure and prop-driven so it can be rendered from fixtures.
 */
import React from "react";
import { Link } from "wouter";
import { ArrowRight, Compass, Hourglass, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  StudentAttentionItem,
  StudentDegreeProgressView,
  StudentMilestone,
  StudentNextStep,
  StudentRequirementView,
} from "@shared/student-degree-progress-view";
import {
  attentionOwnerLabel,
  countRequirementsByTone,
  formatAsOf,
  formatDecimal,
  keyFigures,
  milestoneThresholdLabel,
  NO_PROGRAM_COPY,
  NO_TOTALS_COPY,
  nextStepActionLabel,
  primaryNextStep,
  progressMode,
  requirementAmounts,
  requirementStatusPresentation,
  ringAltText,
  safeInternalHref,
  sortRequirements,
  UNDER_REVIEW_COPY,
  visibleTotals,
} from "@/pages/student-progress-presentation";
import { ProgressRing, SectionHeading, SlimBar, StatusChip } from "./parts";

export interface FlightDeckViewProps {
  view: StudentDegreeProgressView;
}

export function FlightDeckView({ view }: FlightDeckViewProps) {
  const mode = progressMode(view);
  const totals = visibleTotals(view);
  const nextStep = primaryNextStep(view);
  const asOf = formatAsOf(view.asOf);
  const programName = view.program?.programName ?? "Your degree program";
  const meta = [
    view.program?.institutionName,
    view.program?.versionLabel,
    view.program?.cohortLabel,
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-10 px-4 py-6 sm:px-6 sm:py-10" data-testid="flight-deck" data-mode={mode}>
      <header className="space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gold-strong">
          Flight Deck
        </p>
        <h1
          className="font-serif text-3xl leading-tight tracking-tight text-foreground sm:text-5xl"
          data-testid="text-page-title"
        >
          {programName}
        </h1>
        <p className="text-sm text-muted-foreground" data-testid="text-as-of">
          {[...meta, asOf ? `Record as of ${asOf}` : null].filter(Boolean).join(" · ")}
        </p>
      </header>

      {mode === "under-review" && <UnderReviewHero nextStep={nextStep} />}
      {mode === "no-program" && <NoProgramHero nextStep={nextStep} />}

      {(mode === "composed" || mode === "composed-without-totals") && (
        <section aria-labelledby="fd-position" className="grid gap-6 lg:grid-cols-5">
          <h2 id="fd-position" className="sr-only">
            Your academic position
          </h2>
          <div className="rounded-2xl border border-card-border bg-card p-6 shadow-sm sm:p-8 lg:col-span-2">
            {totals ? (
              <div className="space-y-5">
                <ProgressRing
                  applied={totals.appliedCredits}
                  required={totals.requiredCredits}
                  appliedLabel={formatDecimal(totals.appliedCredits) ?? ""}
                  requiredLabel={formatDecimal(totals.requiredCredits) ?? ""}
                  altText={ringAltText(totals)}
                />
                <p className="text-center text-sm text-muted-foreground" data-testid="text-ring-remaining">
                  <span className="font-medium text-foreground">
                    {formatDecimal(totals.remainingCredits)}
                  </span>{" "}
                  credits remaining
                </p>
              </div>
            ) : (
              <div className="space-y-3 py-6 text-center" data-testid="no-totals-note">
                <Compass className="mx-auto h-8 w-8 text-gold" aria-hidden="true" />
                <p className="font-serif text-xl text-foreground">Totals are on their way</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{NO_TOTALS_COPY}</p>
              </div>
            )}
          </div>
          <div className="lg:col-span-3">
            <NextStepPanel step={nextStep} />
          </div>
        </section>
      )}

      {totals && (
        <section aria-labelledby="fd-figures" className="space-y-4">
          <SectionHeading id="fd-figures" eyebrow="At a glance" title="Key figures" />
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-card-border bg-border lg:grid-cols-4">
            {keyFigures(view).map((figure) => (
              <div key={figure.id} className="bg-card p-5 sm:p-6" data-testid={`figure-${figure.id}`}>
                <dt className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {figure.label}
                </dt>
                <dd className="mt-2 font-serif text-3xl tracking-tight text-foreground sm:text-4xl">
                  {figure.value}
                </dd>
                <dd className="mt-1 text-xs text-muted-foreground">{figure.caption}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <AttentionSection items={view.attention} />

      {mode !== "under-review" && mode !== "no-program" && view.milestones.length > 0 && (
        <MilestoneTrack milestones={view.milestones} />
      )}

      {(mode === "composed" || mode === "composed-without-totals") && (
        <RequirementsGlance requirements={view.requirements} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function StepLink({ step, className }: { step: StudentNextStep; className?: string }) {
  const href = safeInternalHref(step.href);
  if (!href) return null;
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-2 rounded-full bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      data-testid="link-next-step"
    >
      {nextStepActionLabel(step)}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

export function NextStepPanel({ step }: { step: StudentNextStep | null }) {
  return (
    <section
      aria-labelledby="fd-next-step"
      className="flex h-full flex-col justify-between gap-6 rounded-2xl border border-gold/40 bg-gold-soft p-6 sm:p-8"
      data-testid="next-step-panel"
    >
      <div className="space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gold-strong">
          Your next step
        </p>
        <h2 id="fd-next-step" className="font-serif text-2xl leading-snug tracking-tight text-foreground sm:text-3xl">
          {step ? step.title : "Nothing needed from you right now"}
        </h2>
        <p className="max-w-xl text-sm leading-relaxed text-foreground/80 sm:text-base">
          {step
            ? step.detail
            : "Your record is up to date. We will let you know here if anything changes."}
        </p>
      </div>
      {step && <StepLink step={step} className="self-start" />}
    </section>
  );
}

function UnderReviewHero({ nextStep }: { nextStep: StudentNextStep | null }) {
  return (
    <section
      aria-labelledby="fd-review"
      className="grid gap-6 lg:grid-cols-5"
      data-testid="under-review-state"
    >
      <div className="space-y-4 rounded-2xl border border-card-border bg-card p-6 shadow-sm sm:p-8 lg:col-span-3">
        <Hourglass className="h-7 w-7 text-gold" aria-hidden="true" />
        <h2 id="fd-review" className="font-serif text-2xl leading-snug tracking-tight sm:text-3xl">
          {UNDER_REVIEW_COPY.headline}
        </h2>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {UNDER_REVIEW_COPY.body}
        </p>
      </div>
      <div className="lg:col-span-2">
        <NextStepPanel step={nextStep} />
      </div>
    </section>
  );
}

function NoProgramHero({ nextStep }: { nextStep: StudentNextStep | null }) {
  return (
    <section
      aria-labelledby="fd-no-program"
      className="grid gap-6 lg:grid-cols-5"
      data-testid="no-program-state"
    >
      <div className="space-y-4 rounded-2xl border border-card-border bg-card p-6 shadow-sm sm:p-8 lg:col-span-3">
        <Compass className="h-7 w-7 text-gold" aria-hidden="true" />
        <h2 id="fd-no-program" className="font-serif text-2xl leading-snug tracking-tight sm:text-3xl">
          {NO_PROGRAM_COPY.headline}
        </h2>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {NO_PROGRAM_COPY.body}
        </p>
      </div>
      <div className="lg:col-span-2">
        <NextStepPanel step={nextStep} />
      </div>
    </section>
  );
}

export function AttentionSection({ items }: { items: readonly StudentAttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="fd-attention" className="space-y-4" data-testid="attention-section">
      <SectionHeading
        id="fd-attention"
        eyebrow="Worth a look"
        title="Needs attention"
        description="Each item says who acts next. Verified academic facts are only ever changed by Lumière staff."
      />
      <ul className="space-y-3">
        {items.map((item, index) => {
          const staff = item.owner === "staff";
          return (
            <li
              key={`${item.kind}-${item.requirementId ?? item.creditRecordId ?? item.sourceId ?? index}`}
              className={cn(
                "flex gap-4 rounded-xl border p-4 sm:p-5",
                staff
                  ? "border-card-border bg-card"
                  : "border-attention/40 bg-attention-soft",
              )}
              data-owner={item.owner}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  staff ? "bg-muted text-muted-foreground" : "bg-attention/15 text-attention",
                )}
                aria-hidden="true"
              >
                {staff ? <Hourglass className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
              </span>
              <div className="min-w-0 space-y-1">
                <p
                  className={cn(
                    "text-[11px] font-medium uppercase tracking-[0.14em]",
                    staff ? "text-muted-foreground" : "text-attention",
                  )}
                >
                  {attentionOwnerLabel(item.owner)}
                </p>
                <p className="font-medium text-foreground">{item.title}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{item.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function MilestoneTrack({ milestones }: { milestones: readonly StudentMilestone[] }) {
  return (
    <section aria-labelledby="fd-milestones" className="space-y-5" data-testid="milestone-track">
      <SectionHeading id="fd-milestones" eyebrow="The journey" title="Milestones" />
      <ol className="grid gap-0 sm:grid-flow-col sm:auto-cols-fr">
        {milestones.map((milestone, index) => {
          const threshold = milestoneThresholdLabel(milestone.thresholdCredits);
          const last = index === milestones.length - 1;
          return (
            <li
              key={milestone.id}
              className="relative flex gap-4 pb-6 sm:flex-col sm:gap-3 sm:pb-0 sm:pr-4"
              data-reached={milestone.reached}
            >
              <div className="relative flex shrink-0 flex-col items-center sm:flex-row sm:items-center">
                <span
                  className={cn(
                    "relative z-10 h-4 w-4 rounded-full",
                    milestone.reached
                      ? "bg-gold ring-4 ring-gold/20"
                      : "border-2 border-dashed border-muted-foreground/50 bg-background",
                  )}
                  aria-hidden="true"
                />
                {!last && (
                  <span
                    className={cn(
                      "absolute left-1/2 top-4 h-[calc(100%+1.5rem)] w-px -translate-x-1/2 sm:left-4 sm:top-1/2 sm:h-px sm:w-[calc(100%+1rem)] sm:translate-x-0 sm:-translate-y-1/2",
                      milestone.reached ? "bg-gold/60" : "bg-border",
                    )}
                    aria-hidden="true"
                  />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground">{milestone.label}</p>
                <p className="text-xs text-muted-foreground">
                  {milestone.reached ? "Reached" : "Ahead"}
                  {threshold ? ` · ${threshold}` : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function RequirementsGlance({
  requirements,
}: {
  requirements: readonly StudentRequirementView[];
}) {
  const ordered = sortRequirements(requirements);
  const counts = countRequirementsByTone(ordered);
  const open = ordered.filter((r) => r.status !== "SATISFIED");
  const shown = open.slice(0, 5);
  return (
    <section aria-labelledby="fd-requirements" className="space-y-5" data-testid="requirements-glance">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading id="fd-requirements" eyebrow="Your degree" title="Requirements at a glance" />
        <Link
          href="/roadmap"
          className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-gold-strong underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-md"
          data-testid="link-roadmap"
        >
          Open your full roadmap
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Your requirements will appear here once they are loaded for your program.
        </p>
      ) : (
        <>
          <div
            className="flex h-2 gap-1"
            role="img"
            aria-label={`${counts.satisfied} satisfied, ${counts.progress} in progress, ${counts.outstanding} outstanding, ${counts.review} under staff review, out of ${ordered.length} requirements`}
          >
            {ordered.map((req) => {
              const tone = requirementStatusPresentation(req.status).tone;
              return (
                <span
                  key={req.requirementId}
                  className={cn(
                    "h-full flex-1 rounded-full",
                    tone === "satisfied" && "bg-gold",
                    tone === "progress" && "bg-gold/40",
                    tone === "outstanding" && "bg-muted",
                    tone === "review" && "bg-attention/50",
                  )}
                />
              );
            })}
          </div>
          <ul className="divide-y divide-border rounded-2xl border border-card-border bg-card">
            {shown.map((req) => {
              const status = requirementStatusPresentation(req.status);
              const amounts = requirementAmounts(req);
              return (
                <li key={req.requirementId} className="space-y-2 p-4 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-foreground">{req.title}</p>
                    <StatusChip tone={status.tone} label={status.label} />
                  </div>
                  {amounts.required && amounts.applied && (
                    <>
                      <SlimBar
                        applied={req.appliedAmount}
                        required={req.requiredAmount}
                        tone={status.tone}
                        label={`${amounts.applied} of ${amounts.required} applied`}
                      />
                      <p className="text-xs text-muted-foreground">
                        {amounts.applied} of {amounts.required} applied
                      </p>
                    </>
                  )}
                </li>
              );
            })}
            {shown.length === 0 && (
              <li className="p-4 text-sm text-muted-foreground sm:px-6">
                Every requirement is satisfied.
              </li>
            )}
          </ul>
          {open.length > shown.length && (
            <p className="text-sm text-muted-foreground">
              And {open.length - shown.length} more open{" "}
              {open.length - shown.length === 1 ? "requirement" : "requirements"} in your roadmap.
            </p>
          )}
        </>
      )}
    </section>
  );
}
