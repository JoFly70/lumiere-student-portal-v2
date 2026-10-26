/** THE HORIZON: milestones with target dates and the phases still ahead. */
import React from "react";
import { Link } from "wouter";
import { ArrowRight, Flag, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentRoadmapMilestoneView, StudentRoadmapView } from "@shared/student-roadmap-contract";
import {
  dateRangeLabel,
  formatShortDate,
  horizonMilestones,
  milestoneKindLabel,
  milestoneStatusLine,
  nextMilestone,
  upcomingPhases,
} from "@/pages/student-roadmap-presentation";
import { Pill, SectionHeading, buttonClass, cardClass } from "./student-ui";

function MilestoneMarker({ m }: { m: StudentRoadmapMilestoneView }) {
  const Icon = m.kind === "graduation" ? GraduationCap : Flag;
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2",
        m.reached ? "border-student-gold bg-student-gold text-student-card" : "border-student-line-strong bg-student-card text-student-gold-ink",
        m.kind === "graduation" && !m.reached && "border-student-gold-ink",
      )}
      aria-hidden="true"
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

export function HorizonSection({ view }: { view: StudentRoadmapView }) {
  const milestones = horizonMilestones(view);
  const next = nextMilestone(view);
  const phases = upcomingPhases(view);
  if (milestones.length === 0 && phases.length === 0) return null;
  return (
    <section aria-labelledby="horizon-title" id="section-horizon" className="scroll-mt-28 space-y-4" data-testid="horizon-section">
      <SectionHeading
        id="horizon-title"
        eyebrow="The horizon"
        title="What is ahead"
        description="Target dates are Lumière's plan. They can move if your plan changes."
      />
      <div className="grid gap-4 lg:grid-cols-5">
        {milestones.length > 0 && (
          <div className={cn(cardClass, "lg:col-span-3")}>
            <h3 className="mb-3 text-sm font-semibold text-student-ink">Milestones</h3>
            <ol className="relative space-y-4" data-testid="milestone-list">
              {milestones.map((m, i) => (
                <li key={m.key} className="relative flex gap-3" data-testid="milestone" data-reached={m.reached} data-next={next?.key === m.key}>
                  {i < milestones.length - 1 && (
                    <span aria-hidden="true" className="absolute left-4 top-8 -bottom-4 w-0.5 -translate-x-1/2 border-l-2 border-dashed border-student-line-strong" />
                  )}
                  <MilestoneMarker m={m} />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-student-ink">
                      {m.title}
                      {next?.key === m.key && <Pill tone="gold">Next</Pill>}
                    </p>
                    <p className="text-sm text-student-muted">
                      {[milestoneKindLabel(m.kind), formatShortDate(m.targetDate) ? `Target ${formatShortDate(m.targetDate)}` : "Date to be set", milestoneStatusLine(m, view)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
        {phases.length > 0 && (
          <div className={cn(cardClass, milestones.length > 0 ? "lg:col-span-2" : "lg:col-span-5")}>
            <h3 className="mb-3 text-sm font-semibold text-student-ink">Phases still to come</h3>
            <ul className="space-y-3" data-testid="upcoming-phases">
              {phases.map((p) => (
                <li key={p.key} className="text-sm">
                  <p className="font-medium text-student-ink">{p.title}</p>
                  <p className="text-student-muted">
                    {[dateRangeLabel(p.startDate, p.endDate), `${p.counts.itemsTotal} ${p.counts.itemsTotal === 1 ? "item" : "items"}`].filter(Boolean).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/** Flight Deck: the next few milestones. */
export function HorizonSummary({ view }: { view: StudentRoadmapView }) {
  const next = nextMilestone(view);
  if (!next) return null;
  const upcoming = horizonMilestones(view).filter((m) => !m.reached).slice(0, 3);
  return (
    <section aria-labelledby="horizon-summary-title" className={cardClass} data-testid="horizon-summary">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-student-gold-ink">The horizon</p>
      <h2 id="horizon-summary-title" className="font-serif text-xl text-student-ink">What is next</h2>
      <ol className="mt-3 space-y-3">
        {upcoming.map((m) => (
          <li key={m.key} className="flex gap-3" data-testid="horizon-milestone">
            <MilestoneMarker m={m} />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-student-ink">
                {m.title}
                {m.key === next.key && <Pill tone="gold">Next</Pill>}
              </p>
              <p className="text-sm text-student-muted">
                {[milestoneKindLabel(m.kind), formatShortDate(m.targetDate) ? `Target ${formatShortDate(m.targetDate)}` : "Date to be set", milestoneStatusLine(m, view)].filter(Boolean).join(" · ")}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <Link href="/roadmap#section-horizon" className={`${buttonClass.link} mt-2`} data-testid="link-horizon">
        See what is ahead <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}
