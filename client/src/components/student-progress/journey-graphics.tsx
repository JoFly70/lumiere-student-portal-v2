/**
 * Information-bearing graphics for the roadmap: the six-step stage track, the
 * task ring, the phase marker and the journey strip. Each carries data (counts
 * and stages only); none is decoration. No percentages, estimates or credits are
 * invented here.
 */
import React from "react";
import { Check, Flag, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentItemStage, StudentRoadmapPhaseView, StudentRoadmapView } from "@shared/student-roadmap-contract";
import {
  PHASE_STATE_LABEL,
  STAGES,
  formatShortDate,
  horizonMilestones,
  phaseStateHelp,
  sortedPhases,
  stageAriaLabel,
  stageIndex,
  stageStatus,
  priorCreditBaseline,
  STATUS_META,
  type StatusKey,
} from "@/pages/student-roadmap-presentation";
import { STATUS_STYLE } from "./student-ui";

const GOLD = "hsl(var(--s-gold))";
const LINE = "hsl(var(--s-line-strong))";
const CARD = "hsl(var(--s-card))";

/** One step of the stage track. Colour comes from the item's own status via currentColor. */
function StageMarker({ index, current }: { index: number; current: number }) {
  const reached = index <= current;
  const isOfficial = index === STAGES.length - 1;
  const size = 20;
  if (isOfficial) {
    // Diamond seal: visibly different from the round markers because it is Lumière's decision.
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" className="shrink-0" data-marker="official" data-reached={reached}>
        <path
          d="M9 1.5 16.5 9 9 16.5 1.5 9Z"
          fill={reached ? "currentColor" : CARD}
          stroke={reached ? "currentColor" : LINE}
          strokeWidth="1.5"
          strokeDasharray={reached ? undefined : "2.5 2"}
        />
        {reached && <path d="m6 9 2.2 2.2L12.2 7" fill="none" stroke={CARD} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    );
  }
  if (index < current) {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" className="shrink-0" data-marker="done">
        <circle cx="9" cy="9" r="8" fill="currentColor" />
        <path d="m5.2 9.2 2.6 2.6 5-5.4" fill="none" stroke={CARD} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (index === current) {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" className="shrink-0" data-marker="current">
        <circle cx="9" cy="9" r="8" fill={CARD} stroke="currentColor" strokeWidth="2" />
        <circle cx="9" cy="9" r="4" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" className="shrink-0" data-marker="todo">
      <circle cx="9" cy="9" r="7.5" fill={CARD} stroke={LINE} strokeWidth="1.5" strokeDasharray="3 2.5" />
    </svg>
  );
}

/**
 * Six-step stage track. EVERY step is labelled with visible text (short labels
 * so six fit a phone); the full name and the state of each step are also in the
 * accessible text. The last step (official acceptance) is Lumière's decision.
 */
export function StageTrack({ stage }: { stage: StudentItemStage; label?: string }) {
  const current = stageIndex(stage);
  const status = stageStatus(stage);
  return (
    <div className="w-full" data-testid="stage-track" data-stage={stage}>
      <ol className={cn("grid grid-cols-6", STATUS_STYLE[status].text)} aria-label={stageAriaLabel(stage)}>
        {STAGES.map((s, i) => {
          const reached = i <= current;
          const state = i < current ? "done" : i === current ? "current step" : "not reached yet";
          return (
            <li
              key={s.stage}
              className="relative flex min-w-0 flex-col items-center px-0.5 text-center"
              aria-current={i === current ? "step" : undefined}
              data-step={s.stage}
              data-step-state={i < current ? "done" : i === current ? "current" : "todo"}
            >
              {i < STAGES.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-[9px] h-0.5 w-full"
                  style={{
                    background:
                      i < current
                        ? "currentColor"
                        : i === STAGES.length - 2
                          ? `repeating-linear-gradient(90deg, ${LINE} 0 4px, transparent 4px 8px)`
                          : LINE,
                    opacity: i < current ? 1 : 0.55,
                  }}
                />
              )}
              <span className="relative z-10 bg-student-card px-0.5">
                <StageMarker index={i} current={current} />
              </span>
              <span
                className={cn(
                  "mt-1 block text-xs leading-tight tracking-tight [overflow-wrap:anywhere]",
                  i === current ? "font-semibold text-student-ink" : reached ? "text-student-ink" : "text-student-muted",
                )}
              >
                <span aria-hidden="true">{s.short}</span>
                <span className="sr-only">
                  {s.label}, {state}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Small ring: arc = tasks done / tasks total. The label beside it states the counts. */
export function TaskRing({ done, total, size = 40 }: { done: number; total: number; size?: number }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0 text-st-progress" data-testid="task-ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--s-line))" strokeWidth={stroke} />
      {frac > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.3}
        fontWeight="600"
        fill="hsl(var(--s-ink))"
      >
        {done}/{total}
      </text>
    </svg>
  );
}

/**
 * Marker on the journey rail for a phase. Gold ring = "you are here" (brand).
 * Complete is neutral ink: a phase is not a credit status.
 */
export function PhaseMarker({ state, size = 32 }: { state: StudentRoadmapPhaseView["state"]; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" data-marker={state}>
      {state === "current" && (
        <>
          <circle cx="16" cy="16" r="15" fill={GOLD} opacity="0.18" />
          <circle cx="16" cy="16" r="12" fill={CARD} stroke={GOLD} strokeWidth="2.5" />
          <circle cx="16" cy="16" r="6" fill={GOLD} />
        </>
      )}
      {state === "also_active" && (
        <>
          <circle cx="16" cy="16" r="12" fill={CARD} stroke={GOLD} strokeWidth="2.5" strokeDasharray="5 3" />
          <circle cx="16" cy="16" r="4" fill="none" stroke={GOLD} strokeWidth="2.5" />
        </>
      )}
      {state === "complete" && (
        <>
          <circle cx="16" cy="16" r="12" fill="hsl(var(--s-ink))" />
          <path d="m10.5 16.4 3.9 3.9 7.2-8" fill="none" stroke={CARD} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {state === "upcoming" && <circle cx="16" cy="16" r="11" fill={CARD} stroke={LINE} strokeWidth="2" strokeDasharray="4 3" />}
    </svg>
  );
}

export function CheckBadge({ className }: { className?: string }) {
  return (
    <span className={cn("flex h-4 w-4 items-center justify-center rounded-full bg-student-gold text-student-card", className)}>
      <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
    </span>
  );
}

// ── Journey strip (Flight Deck) ─────────────────────────────────────────────

const PIP_ORDER: StatusKey[] = ["official", "provider", "progress", "notstarted"];

function activeItems(phase: StudentRoadmapPhaseView) {
  return phase.items.filter((i) => i.planStatus === "planned" || i.planStatus === "hold");
}

export function phasePipSummary(phase: StudentRoadmapPhaseView): string {
  const items = activeItems(phase);
  const by = (k: StatusKey) => items.filter((i) => stageStatus(i.stage) === k).length;
  const finished = by("official") + by("provider");
  const parts = [`${finished} of ${items.length} ${items.length === 1 ? "course" : "courses"} finished`];
  if (by("progress") > 0) parts.push(`${by("progress")} in progress`);
  if (by("notstarted") > 0) parts.push(`${by("notstarted")} not started`);
  return `${phase.title}: ${parts.join(", ")}`;
}

/** One pip per active course, coloured by its stage. Counts only, no percentages. */
export function PhasePips({ phase }: { phase: StudentRoadmapPhaseView }) {
  const items = activeItems(phase);
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => PIP_ORDER.indexOf(stageStatus(a.stage)) - PIP_ORDER.indexOf(stageStatus(b.stage)));
  return (
    <span role="img" aria-label={phasePipSummary(phase)} className="flex flex-wrap gap-1" data-testid="phase-pips">
      {sorted.map((i) => {
        const st = stageStatus(i.stage);
        return (
          <span
            key={i.key}
            data-pip={st}
            className={cn("h-2 w-5 rounded-full border", st === "notstarted" ? "border-dashed bg-transparent" : STATUS_STYLE[st].fill, STATUS_STYLE[st].border)}
          />
        );
      })}
    </span>
  );
}

/**
 * The journey at a glance: starting point, each phase (with one pip per course)
 * and graduation. Horizontal from md, a vertical rail on phones.
 */
export function JourneyStrip({ view }: { view: StudentRoadmapView }) {
  const allPhases = sortedPhases(view);
  // Long journeys: show the next upcoming phase, then one grouped row for the rest (no wall of identical rows).
  const upcomingAll = allPhases.filter((p) => p.state === "upcoming");
  const grouped = upcomingAll.length > 2 ? upcomingAll.slice(1) : [];
  const phases = allPhases.filter((p) => !grouped.includes(p));
  const groupedCourses = grouped.reduce((n, p) => n + activeItems(p).length, 0);
  const grad = horizonMilestones(view).find((m) => m.kind === "graduation");
  const baseline = priorCreditBaseline(view.foundation);
  return (
    <div data-testid="journey-strip">
      <ol className="relative grid gap-5 md:auto-cols-fr md:grid-flow-col md:gap-3" aria-label="Your journey, start to graduation">
        <li className="relative flex gap-3 pb-1 md:flex-col md:gap-2" data-strip="start">
          <Rail />
          <span className="relative z-10 shrink-0">
            <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
              <path d="M16 3 29 16 16 29 3 16Z" fill="hsl(var(--s-seal))" stroke={GOLD} strokeWidth="2" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="font-serif text-base leading-snug text-student-ink">Your starting point</p>
            <p className="text-sm text-student-muted">
              {baseline.applied ? `${baseline.applied} credits applied` : "Record under review"}
            </p>
          </div>
        </li>
        {phases.map((p) => {
          const help = phaseStateHelp(p.state);
          return (
            <li key={p.key} className="relative flex gap-3 pb-1 md:flex-col md:gap-2" data-strip="phase" data-phase-state={p.state}>
              <Rail />
              <span className="relative z-10 shrink-0">
                <PhaseMarker state={p.state} />
              </span>
              <div className="min-w-0 space-y-1.5">
                <p className="font-serif text-base leading-snug text-student-ink">{p.title}</p>
                <p className={cn("text-xs font-semibold uppercase tracking-wider", p.state === "current" ? "text-student-gold-ink" : "text-student-muted")}>
                  {PHASE_STATE_LABEL[p.state]}
                </p>
                <PhasePips phase={p} />
                <p className="text-sm text-student-muted">
                  {(() => {
                    const items = activeItems(p);
                    const finished = items.filter((i) => i.stage === "officially_accepted" || i.stage === "provider_complete").length;
                    return `${finished} of ${items.length} ${items.length === 1 ? "course" : "courses"} finished`;
                  })()}
                </p>
                {help && <p className="text-xs text-student-muted">{help}</p>}
              </div>
            </li>
          );
        })}
        {grouped.length > 0 && (
          <li className="relative flex gap-3 pb-1 md:flex-col md:gap-2" data-strip="more" data-testid="strip-more-phases">
            <Rail />
            <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-student-line-strong bg-student-card text-xs font-semibold text-student-muted" aria-hidden="true">
              +{grouped.length}
            </span>
            <div className="min-w-0 space-y-1">
              <p className="font-serif text-base leading-snug text-student-ink">{grouped.length} more phases</p>
              <p className="text-sm text-student-muted">
                {groupedCourses} {groupedCourses === 1 ? "course" : "courses"}, not started. Details under The horizon.
              </p>
            </div>
          </li>
        )}
        <li className="relative flex gap-3 md:flex-col md:gap-2" data-strip="end">
          <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-student-gold-ink bg-student-card text-student-gold-ink" aria-hidden="true">
            {grad ? <GraduationCap className="h-4 w-4" /> : <Flag className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <p className="font-serif text-base leading-snug text-student-ink">Graduation</p>
            <p className="text-sm text-student-muted">
              {grad?.reached ? "Reached" : grad?.targetDate ? `Target ${formatShortDate(grad.targetDate)}` : "Date to be set by Lumière"}
            </p>
          </div>
        </li>
      </ol>
      <PipLegend />
    </div>
  );
}

/** Visible key for the course pips, so their colours never carry meaning alone. */
function PipLegend() {
  return (
    <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-student-muted" aria-label="Key to the course markers" data-testid="pip-legend">
      {PIP_ORDER.map((st) => (
        <li key={st} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn("h-2 w-5 rounded-full border", st === "notstarted" ? "border-dashed bg-transparent" : STATUS_STYLE[st].fill, STATUS_STYLE[st].border)}
          />
          {STATUS_META[st].label}
        </li>
      ))}
    </ul>
  );
}

/** Connector to the next node: vertical down the rail on phones, horizontal from md. */
function Rail() {
  return (
    <>
      <span aria-hidden="true" className="absolute bottom-[-1.25rem] left-4 top-8 -translate-x-px border-l-2 border-dashed border-student-line-strong md:hidden" />
      <span aria-hidden="true" className="absolute left-9 right-[-0.75rem] top-4 hidden -translate-y-px border-t-2 border-dashed border-student-line-strong md:block" />
    </>
  );
}
