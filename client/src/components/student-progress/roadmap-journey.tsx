/**
 * YOUR ROADMAP: the journey from your starting point through phases to
 * graduation. Phases are collapsible (current one open); items are cards.
 */
import React, { useEffect, useId, useState } from "react";
import { Check, ChevronDown, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentRoadmapPhaseView, StudentRoadmapView } from "@shared/student-roadmap-contract";
import {
  ALL_LANES,
  alternativeTargetTitle,
  dateRangeLabel,
  formatShortDate,
  horizonMilestones,
  laneOptions,
  objectiveFor,
  objectiveKindHelp,
  phaseItems,
  phaseSummaryLine,
  sortedPhases,
} from "@/pages/student-roadmap-presentation";
import { Pill, SectionHeading } from "./student-ui";
import { PhaseMarker } from "./journey-graphics";
import { AlternativeCard, ItemCard } from "./item-card";

const STATE_LABEL = { complete: "Complete", current: "Current phase", upcoming: "Upcoming" } as const;

function PhaseBlock({
  phase,
  view,
  lane,
  openOverride,
  targetItemKey,
  defaultOpenKey,
  last,
}: {
  phase: StudentRoadmapPhaseView;
  view: StudentRoadmapView;
  lane: string;
  openOverride: boolean;
  targetItemKey: string | null;
  defaultOpenKey: string | null;
  last: boolean;
}) {
  const [open, setOpen] = useState(phase.state === "current");
  const panelId = useId();
  const { main, alternatives } = phaseItems(phase, lane);
  const showLane = view.objectives.length > 1;
  useEffect(() => {
    if (openOverride) setOpen(true);
  }, [openOverride]);
  const isOpen = open;
  const dates = dateRangeLabel(phase.startDate, phase.endDate);
  return (
    <li className="relative pl-12 sm:pl-14" data-testid="phase" data-phase-state={phase.state} data-phase-key={phase.key}>
      <span className="absolute left-0 top-0" aria-hidden="true">
        <PhaseMarker state={phase.state} />
      </span>
      {!last && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-4 top-8 -bottom-2 w-0 -translate-x-px border-l-2",
            phase.state === "complete" ? "border-student-gold" : "border-dashed border-student-line-strong",
          )}
        />
      )}
      <div className="pb-6">
        <h3 className="text-lg font-semibold text-student-ink">
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={panelId}
            onClick={() => setOpen(!isOpen)}
            className="flex min-h-[44px] w-full items-start justify-between gap-3 rounded-lg text-left"
            data-testid="phase-toggle"
          >
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-serif text-xl">{phase.title}</span>
                <Pill tone={phase.state === "current" ? "gold" : phase.state === "complete" ? "neutral" : "dashed"}>
                  {STATE_LABEL[phase.state]}
                </Pill>
              </span>
              <span className="mt-1 block text-sm font-normal text-student-muted">
                {[dates, phaseSummaryLine(phase)].filter(Boolean).join(" · ")}
              </span>
            </span>
            <ChevronDown className={cn("mt-2 h-5 w-5 shrink-0 text-student-gold-ink transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
          </button>
        </h3>
        <div id={panelId} hidden={!isOpen} className="mt-2 space-y-3">
          {phase.description && <p className="text-sm text-student-muted">{phase.description}</p>}
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 xl:grid-cols-2">
          {main.map((item) => (
            <ItemCard
              key={item.key}
              item={item}
              objective={objectiveFor(view, item.objectiveKey)}
              showLane={showLane}
              defaultOpen={targetItemKey === item.key || (!targetItemKey && defaultOpenKey === item.key)}
            />
          ))}
          </div>
          {alternatives.length > 0 && (
            <div className="space-y-3" data-testid="alternatives">
              {alternatives.map((item) => (
                <AlternativeCard key={item.key} item={item} targetTitle={alternativeTargetTitle(view, item)} />
              ))}
            </div>
          )}
          {main.length === 0 && alternatives.length === 0 && (
            <p className="text-sm text-student-muted">Nothing in this phase for the selected objective.</p>
          )}
        </div>
      </div>
    </li>
  );
}

export function RoadmapJourney({ view, targetItemKey = null, defaultOpenKey = null }: { view: StudentRoadmapView; targetItemKey?: string | null; defaultOpenKey?: string | null }) {
  const [lane, setLane] = useState<string>(ALL_LANES);
  const lanes = laneOptions(view);
  const phases = sortedPhases(view).filter((p) => lane === ALL_LANES || phaseItems(p, lane).main.length + phaseItems(p, lane).alternatives.length > 0);
  const graduation = horizonMilestones(view).find((m) => m.kind === "graduation");
  const activeObjective = lane === ALL_LANES ? undefined : objectiveFor(view, lane);

  useEffect(() => {
    if (!targetItemKey) return;
    const t = setTimeout(() => document.getElementById(`item-${targetItemKey}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
    return () => clearTimeout(t);
  }, [targetItemKey]);

  const targetPhaseKey = targetItemKey
    ? view.phases.find((p) => p.items.some((i) => i.key === targetItemKey))?.key ?? null
    : null;

  return (
    <section aria-labelledby="roadmap-title" id="section-roadmap" className="scroll-mt-20 space-y-5" data-testid="roadmap-journey">
      <SectionHeading
        id="roadmap-title"
        eyebrow="Your roadmap"
        title="Your journey"
        description={view.plan?.summary ?? "Lumière plans your route. You follow it and report your progress."}
      />

      {lanes.length > 0 && (
        <div className="space-y-2">
          <div role="group" aria-label="Show objective" className="flex flex-wrap gap-2" data-testid="lane-filter">
            {lanes.map((l) => (
              <button
                key={l.key}
                type="button"
                aria-pressed={lane === l.key}
                onClick={() => setLane(l.key)}
                className={cn(
                  "inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-sm font-medium",
                  lane === l.key
                    ? "border-2 border-student-gold-ink bg-student-gold-soft font-semibold text-student-gold-ink"
                    : "border-student-line-strong bg-student-card text-student-muted hover:bg-student-gold-soft",
                )}
              >
                {lane === l.key && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
                {l.label}
                {l.kindLabel && <span className="ml-1.5 text-xs font-normal">({l.kindLabel})</span>}
              </button>
            ))}
          </div>
          {activeObjective && (
            <p className="text-sm text-student-muted" data-testid="lane-help">
              {objectiveKindHelp(activeObjective.kind)}
              {activeObjective.note ? ` ${activeObjective.note}` : ""}
            </p>
          )}
        </div>
      )}

      <ol className="relative" data-testid="journey">
        <li className="relative pl-12 pb-6 sm:pl-14" data-testid="journey-start">
          <span className="absolute left-0 top-0" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 32 32"><path d="M16 3 29 16 16 29 3 16Z" fill="hsl(var(--s-seal))" stroke="hsl(var(--s-gold))" strokeWidth="2" /></svg>
          </span>
          <span aria-hidden="true" className="absolute left-4 top-8 -bottom-2 w-0 -translate-x-px border-l-2 border-student-gold" />
          <p className="font-serif text-xl text-student-ink">Your starting point</p>
          <p className="text-sm text-student-muted">
            {view.foundation.credentials.length > 0
              ? `${view.foundation.credentials.length} prior ${view.foundation.credentials.length === 1 ? "credential" : "credentials"} on record. `
              : "Where your journey begins. "}
            <a href="#section-foundation" className="font-medium text-student-gold-ink underline underline-offset-4">See your foundation</a>
          </p>
        </li>
        {phases.map((p, i) => (
          <PhaseBlock
            key={p.key}
            phase={p}
            view={view}
            lane={lane}
            openOverride={targetPhaseKey === p.key}
            targetItemKey={targetItemKey}
            defaultOpenKey={defaultOpenKey}
            last={false}
          />
        ))}
        <li className="relative pl-12 sm:pl-14" data-testid="journey-end">
          <span className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-student-gold-ink bg-student-card text-student-gold-ink" aria-hidden="true">
            <GraduationCap className="h-4 w-4" />
          </span>
          <p className="font-serif text-xl text-student-ink">Graduation</p>
          <p className="text-sm text-student-muted">
            {graduation?.targetDate ? `Target ${formatShortDate(graduation.targetDate)}` : "Date to be set by Lumière"}
            {graduation?.reached ? " · Reached" : ""}
          </p>
        </li>
      </ol>
    </section>
  );
}
