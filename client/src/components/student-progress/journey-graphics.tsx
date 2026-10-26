/**
 * Information-bearing graphics for the roadmap: the six-stage track, the task
 * ring and the phase marker. Each carries data; none is decoration.
 */
import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentItemStage, StudentRoadmapPhaseView } from "@shared/student-roadmap-contract";
import { STAGES, stageAriaLabel, stageIndex } from "@/pages/student-roadmap-presentation";

const GOLD = "hsl(var(--s-gold))";
const LINE = "hsl(var(--s-line-strong))";
const SEAL = "hsl(var(--s-seal))";
const SEAL_INK = "hsl(var(--s-seal-ink))";
const CARD = "hsl(var(--s-card))";

function StageMarker({ index, current }: { index: number; current: number }) {
  const reached = index <= current;
  const isOfficial = index === STAGES.length - 1;
  const size = 18;
  if (isOfficial) {
    // Diamond seal: visibly different from the round markers because it is Lumière's decision.
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" className="shrink-0" data-marker="official" data-reached={reached}>
        <path
          d="M9 1.5 16.5 9 9 16.5 1.5 9Z"
          fill={reached ? SEAL : CARD}
          stroke={reached ? GOLD : LINE}
          strokeWidth="1.5"
          strokeDasharray={reached ? undefined : "2.5 2"}
        />
        {reached && <path d="m6 9 2.2 2.2L12.2 7" fill="none" stroke={GOLD} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    );
  }
  if (index < current) {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" className="shrink-0" data-marker="done">
        <circle cx="9" cy="9" r="8" fill={GOLD} />
        <path d="m5.2 9.2 2.6 2.6 5-5.4" fill="none" stroke={CARD} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (index === current) {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" className="shrink-0" data-marker="current">
        <circle cx="9" cy="9" r="8" fill={CARD} stroke={GOLD} strokeWidth="2" />
        <circle cx="9" cy="9" r="4" fill={GOLD} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" className="shrink-0" data-marker="todo">
      <circle cx="9" cy="9" r="7.5" fill={CARD} stroke={LINE} strokeWidth="1.5" />
    </svg>
  );
}

/** Six-stage track. The last stage (official acceptance) is a diamond seal reached only by Lumière. */
export function StageTrack({ stage, label }: { stage: StudentItemStage; label?: string }) {
  const current = stageIndex(stage);
  return (
    <div role="img" aria-label={stageAriaLabel(stage)} className="w-full" data-testid="stage-track" data-stage={stage}>
      <ol className="flex items-start" aria-hidden="true">
        {STAGES.map((s, i) => (
          <li key={s.stage} className={cn("flex min-w-0 items-start", i < STAGES.length - 1 && "flex-1")}>
            <div className="flex w-[18px] shrink-0 flex-col items-center sm:w-[18px]">
              <StageMarker index={i} current={current} />
            </div>
            {i < STAGES.length - 1 && (
              <span
                className="mt-[8px] h-0.5 flex-1"
                style={{
                  background:
                    i < current
                      ? GOLD
                      : i === STAGES.length - 2
                        ? `repeating-linear-gradient(90deg, ${LINE} 0 4px, transparent 4px 8px)`
                        : LINE,
                  opacity: i < current ? 1 : 0.7,
                }}
              />
            )}
          </li>
        ))}
      </ol>
      <p className="mt-1.5 text-xs font-medium text-student-ink" aria-hidden="true">
        {label ?? STAGES[current].label}
      </p>
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
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0" data-testid="task-ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--s-line))" strokeWidth={stroke} />
      {frac > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={GOLD}
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

/** Marker on the journey rail for a phase. */
export function PhaseMarker({ state }: { state: StudentRoadmapPhaseView["state"] }) {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" data-marker={state}>
      {state === "current" && (
        <circle cx="16" cy="16" r="15" fill={GOLD} opacity="0.18" />
      )}
      {state === "complete" && (
        <>
          <circle cx="16" cy="16" r="12" fill={GOLD} />
          <path d="m10.5 16.4 3.9 3.9 7.2-8" fill="none" stroke={CARD} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {state === "current" && (
        <>
          <circle cx="16" cy="16" r="12" fill={CARD} stroke={GOLD} strokeWidth="2.5" />
          <circle cx="16" cy="16" r="6" fill={GOLD} />
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
