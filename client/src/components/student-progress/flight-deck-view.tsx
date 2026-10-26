/**
 * Flight Deck: the student's cockpit, rendered purely from the canonical
 * degree-progress view. Pure and prop-driven so it can be rendered from fixtures.
 */
import React from "react";
import { Link } from "wouter";
import { ArrowRight, ChevronRight, Compass, Hourglass, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  StudentAttentionItem,
  StudentDegreeProgressView,
  StudentMilestone,
  StudentNextStep,
  StudentRequirementView,
} from "@shared/student-degree-progress-view";
import {
  attentionHref,
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
  requirementLegend,
  requirementLegendSummary,
  requirementsGroupedByTone,
  verifiedReconciliation,
  milestoneSegmentFills,
  visibleAttention,
  requirementStatusPresentation,
  ringAltText,
  safeInternalHref,
  sortRequirements,
  UNDER_REVIEW_COPY,
  visibleTotals,
} from "@/pages/student-progress-presentation";
import { ProgressRing, SectionHeading, SlimBar, StatusChip, toneSwatchClass } from "./parts";

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
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-gold-strong">
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

      {mode === "under-review" && <UnderReviewHero nextStep={nextStep} asOf={asOf} />}
      {mode === "no-program" && <NoProgramHero nextStep={nextStep} asOf={asOf} />}

      {(mode === "composed" || mode === "composed-without-totals") && (
        <section aria-labelledby="fd-position" className="grid gap-6 lg:grid-cols-5">
          <h2 id="fd-position" className="sr-only">
            Your academic position
          </h2>
          <div className="order-2 rounded-2xl border border-card-border bg-card p-6 shadow-sm sm:p-8 lg:order-1 lg:col-span-2">
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
                {verifiedReconciliation(view) && (
                  <p className="border-t border-border pt-4 text-center text-sm text-muted-foreground" data-testid="text-reconcile">
                    {verifiedReconciliation(view)!.text}{" "}
                    <Link
                      href="/roadmap#your-credits"
                      className="inline-flex min-h-[44px] items-center rounded-md font-medium text-gold-strong underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                      data-testid="link-your-credits"
                    >
                      See your credits
                    </Link>
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3 py-6 text-center" data-testid="no-totals-note">
                <Hourglass className="mx-auto h-8 w-8 text-gold" aria-hidden="true" />
                <p className="font-serif text-xl text-foreground">Totals are on their way</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{NO_TOTALS_COPY}</p>
              </div>
            )}
          </div>
          <div className="order-1 lg:order-2 lg:col-span-3 [&>section]:h-full">
            <NextStepPanel step={nextStep} asOf={asOf} />
          </div>
        </section>
      )}

      {totals && (
        <section aria-labelledby="fd-figures" className="space-y-4">
          <SectionHeading id="fd-figures" eyebrow="At a glance" title="Key figures" />
          <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-card-border bg-border sm:grid-cols-3">
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

      <AttentionSection items={visibleAttention(view)} view={view} />

      {mode === "composed" && view.state === "COMPOSED" && totals && view.milestones.length > 0 && (
        <MilestoneTrack milestones={view.milestones} appliedCredits={totals.appliedCredits} />
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

export function NextStepPanel({ step, asOf }: { step: StudentNextStep | null; asOf?: string | null }) {
  return (
    <section
      aria-labelledby="fd-next-step"
      className="flex flex-col justify-start gap-6 rounded-2xl border border-gold/40 bg-gold-soft p-6 sm:p-8"
      data-testid="next-step-panel"
    >
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-gold-strong">
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
      <div
        className="mt-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-gold/30 pt-4 text-sm text-foreground/75"
        data-testid="next-step-footer"
      >
        <span>
          Questions?{" "}
          <Link
            href="/support"
            className="inline-flex min-h-[44px] items-center rounded-md font-medium text-gold-strong underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            data-testid="link-support"
          >
            Contact Lumi&egrave;re support
          </Link>
        </span>
        {asOf && <span>Record updated {asOf}</span>}
      </div>
    </section>
  );
}

function UnderReviewHero({ nextStep, asOf }: { nextStep: StudentNextStep | null; asOf?: string | null }) {
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
        <NextStepPanel step={nextStep} asOf={asOf} />
      </div>
    </section>
  );
}

function NoProgramHero({ nextStep, asOf }: { nextStep: StudentNextStep | null; asOf?: string | null }) {
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
        <NextStepPanel step={nextStep} asOf={asOf} />
      </div>
    </section>
  );
}

export function AttentionSection({
  items,
  view,
}: {
  items: readonly StudentAttentionItem[];
  view?: StudentDegreeProgressView;
}) {
  if (items.length === 0) return null;
  const staffItems = items.filter((i) => i.owner === "staff" && i.kind !== "NO_ACTIVE_PROGRAM");
  const groupStaff = staffItems.length >= 3;
  const rest = groupStaff ? items.filter((i) => !staffItems.includes(i)) : items;
  return (
    <section aria-labelledby="fd-attention" className="space-y-4" data-testid="attention-section">
      <SectionHeading
        id="fd-attention"
        eyebrow="Worth a look"
        title="Needs attention"
        description={"Each item says who acts next. Verified academic facts are only ever changed by Lumi\u00e8re staff."}
      />
      <ul className="space-y-3">
        {groupStaff && (
          <li data-owner="staff" data-testid="attention-staff-group">
            <div className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
                  <Hourglass className="h-4 w-4" />
                </span>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {attentionOwnerLabel("staff")} · {staffItems.length} items
                </p>
              </div>
              <ul className="mt-3 divide-y divide-border">
                {staffItems.map((item, i) => (
                  <li key={`${item.kind}-${i}`} className="space-y-0.5 py-3 first:pt-0 last:pb-0 sm:pl-12">
                    <p className="font-medium text-foreground">{item.title}</p>
                    <p className="text-sm leading-relaxed text-muted-foreground">{item.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        )}
        {rest.map((item, index) => {
          const staff = item.owner === "staff";
          const href = attentionHref(item, view);
          const body = (
            <>
              <span
                className={cn(
                  "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  staff ? "bg-muted text-muted-foreground" : "bg-attention/15 text-attention",
                )}
                aria-hidden="true"
              >
                {staff ? <Hourglass className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p
                  className={cn(
                    "text-xs font-medium uppercase tracking-[0.12em]",
                    staff ? "text-muted-foreground" : "text-attention",
                  )}
                >
                  {attentionOwnerLabel(item.owner, item.kind)}
                </p>
                <p className="font-medium text-foreground">{item.title}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{item.detail}</p>
              </div>
              {href && (
                <ChevronRight className="self-center h-5 w-5 shrink-0 text-attention" aria-hidden="true" />
              )}
            </>
          );
          const boxClass = cn(
            "flex gap-4 rounded-xl border p-4 sm:p-5",
            staff ? "border-card-border bg-card" : "border-attention/40 bg-attention-soft",
          );
          return (
            <li
              key={`${item.kind}-${item.requirementId ?? item.creditRecordId ?? item.sourceId ?? index}`}
              data-owner={item.owner}
            >
              {href ? (
                <Link
                  href={href}
                  className={cn(
                    boxClass,
                    "min-h-[44px] transition-colors hover:border-attention hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  )}
                  data-testid="attention-link"
                >
                  {body}
                </Link>
              ) : (
                <div className={boxClass}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function MilestoneTrack({
  milestones,
  appliedCredits,
}: {
  milestones: readonly StudentMilestone[];
  appliedCredits: string | null;
}) {
  const fills = milestoneSegmentFills(milestones, appliedCredits);
  return (
    <section aria-labelledby="fd-milestones" className="space-y-5" data-testid="milestone-track">
      <SectionHeading id="fd-milestones" eyebrow="The journey" title="Milestones" />
      <ol className="grid gap-0 sm:grid-flow-col sm:auto-cols-fr">
        {milestones.map((milestone, index) => {
          const threshold = milestoneThresholdLabel(milestone.thresholdCredits);
          const last = index === milestones.length - 1;
          const fill = Math.round(fills[index] * 1000) / 10;
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
                      : "border-2 border-muted-foreground/60 bg-background",
                  )}
                  aria-hidden="true"
                />
                {!last && (
                  <span
                    className="absolute left-1/2 top-4 h-[calc(100%+1.5rem)] w-px -translate-x-1/2 overflow-hidden bg-border sm:left-4 sm:top-1/2 sm:h-px sm:w-[calc(100%+1rem)] sm:translate-x-0 sm:-translate-y-1/2"
                    aria-hidden="true"
                    data-testid="milestone-segment"
                    data-fill={fill}
                  >
                    <span
                      className="absolute inset-0 hidden bg-gold sm:block origin-left"
                      style={{ transform: `scaleX(${fill / 100})` }}
                    />
                    <span
                      className="absolute inset-0 bg-gold sm:hidden origin-top"
                      style={{ transform: `scaleY(${fill / 100})` }}
                    />
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground">{milestone.label}</p>
                <p className="text-xs text-muted-foreground">
                  {milestone.reached ? "Reached" : "Ahead"}
                  {threshold ? ` \u00b7 ${threshold}` : ""}
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
  const legend = requirementLegend(ordered);
  return (
    <section aria-labelledby="fd-requirements" className="space-y-5" data-testid="requirements-glance">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading id="fd-requirements" eyebrow="Your degree" title="Requirements at a glance" />
        <Link
          href="/roadmap"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-md text-sm font-medium text-gold-strong underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
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
          <div className="flex h-2 gap-1" aria-hidden="true" data-testid="requirements-strip">
            {requirementsGroupedByTone(ordered).map((req) => {
              const tone = requirementStatusPresentation(req.status).tone;
              return (
                <span
                  key={req.requirementId}
                  className={cn("h-full flex-1 rounded-full", toneSwatchClass(tone))}
                />
              );
            })}
          </div>
          <p className="sr-only">{requirementLegendSummary(ordered)}</p>
          <ul
            className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground"
            aria-label={`${ordered.length} requirements by status`}
            data-testid="requirements-legend"
          >
            {legend.map((entry) => (
              <li key={entry.tone} className="inline-flex items-center gap-2">
                <span className={cn("h-3 w-3 rounded-full", toneSwatchClass(entry.tone))} aria-hidden="true" />
                {entry.count} {entry.label}
              </li>
            ))}
          </ul>
          <ol className="divide-y divide-border rounded-2xl border border-card-border bg-card">
            {ordered.map((req) => {
              const status = requirementStatusPresentation(req.status);
              const amounts = requirementAmounts(req);
              const compact = req.status === "SATISFIED";
              return (
                <li
                  key={req.requirementId}
                  className={cn("space-y-2 px-4 sm:px-6", compact ? "py-3" : "py-4")}
                  data-testid={`glance-row-${req.requirementId}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={cn("font-medium", compact ? "text-muted-foreground" : "text-foreground")}>
                      {req.title}
                    </p>
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
          </ol>
        </>
      )}
    </section>
  );
}
