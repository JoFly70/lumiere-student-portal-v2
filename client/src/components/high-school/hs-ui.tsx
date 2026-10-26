/**
 * Small building blocks for the High School Pathway page (S11). They reuse the
 * student surface tokens and the shared status language; nothing here defines
 * new colours.
 */
import React from "react";
import { cn } from "@/lib/utils";
import { formatHalfUnits, type HalfUnits } from "@shared/high-school-contract";
import { barPercent, creditsOfLabel } from "@/pages/high-school-presentation";
import { cardClass } from "@/components/student-progress/student-ui";

/** Section card with an optional heading. */
export function Panel({
  title,
  eyebrow,
  children,
  className,
  testId,
  headingId,
  as: Tag = "section",
}: {
  title?: React.ReactNode;
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
  testId?: string;
  headingId?: string;
  as?: "section" | "div";
}) {
  return (
    <Tag className={cn(cardClass, "min-w-0 space-y-3", className)} data-testid={testId} aria-labelledby={title && headingId ? headingId : undefined}>
      {(title || eyebrow) && (
        <header className="space-y-0.5">
          {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.14em] text-student-muted">{eyebrow}</p>}
          {title && (
            <h3 id={headingId} className="font-serif text-xl tracking-tight text-student-ink">
              {title}
            </h3>
          )}
        </header>
      )}
      {children}
    </Tag>
  );
}

/**
 * Credit ring: OFFICIAL credit only, as one solid arc. Work the student reported
 * but the school has not confirmed is never drawn here. Text carries the exact
 * numbers (formatHalfUnits); the arc only sizes the graphic.
 */
export function CreditRing({
  earned,
  required,
  size = 148,
  className,
}: {
  earned: HalfUnits;
  required: HalfUnits;
  size?: number;
  className?: string;
}) {
  const stroke = 13;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const earnedFrac = required > 0 ? Math.min(1, earned / required) : 0;
  const label = `${creditsOfLabel(earned, required)} official`;
  return (
    <div className={cn("relative mx-auto shrink-0", className)} style={{ width: size, height: size }} role="img" aria-label={label} data-testid="credit-ring" data-percent={barPercent(earned, required)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--s-line))" strokeWidth={stroke} />
        {earnedFrac > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="hsl(var(--s-gold))"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * earnedFrac} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center" aria-hidden="true">
        <span className="font-serif text-4xl leading-none tracking-tight text-student-ink">{formatHalfUnits(earned)}</span>
        <span className="mt-1 text-xs text-student-muted">of {formatHalfUnits(required)} {required === 2 ? "credit" : "credits"}</span>
      </div>
    </div>
  );
}

/** Horizontal meter of OFFICIAL credit. Numbers are always shown beside it by the caller. */
export function Meter({
  value,
  total,
  label,
  className,
  tone = "gold",
}: {
  value: HalfUnits;
  total: HalfUnits;
  label: string;
  className?: string;
  tone?: "gold" | "ink";
}) {
  const a = barPercent(value, total);
  return (
    <div
      className={cn("flex h-2.5 w-full overflow-hidden rounded-full bg-student-line", className)}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.min(value, total)}
      aria-valuetext={creditsOfLabel(value, total)}
    >
      <div className={cn("h-full", tone === "gold" ? "bg-student-gold" : "bg-student-seal")} style={{ width: `${a}%` }} />
    </div>
  );
}

/**
 * The single pace measure: official credits as a bar, with a tick where the plan expected the student to be by now.
 * The tick's label sits on its own row under the bar and is clamped at both edges so it never overflows or crowds text.
 */
export function PaceMeter({ officialPercent, expectedPercent, ariaLabel }: { officialPercent: number; expectedPercent: number | null; ariaLabel: string }) {
  const edge = expectedPercent === null ? "middle" : expectedPercent < 15 ? "start" : expectedPercent > 85 ? "end" : "middle";
  return (
    <div className="pt-1" data-testid="pace-meter">
      <div className="relative">
        <div className="h-3 w-full overflow-hidden rounded-full bg-student-line" role="img" aria-label={ariaLabel}>
          <div className="h-full bg-student-gold" style={{ width: `${officialPercent}%` }} />
        </div>
        {expectedPercent !== null && (
          <div className="pointer-events-none absolute -top-1 h-5 w-0.5 -translate-x-1/2 rounded bg-student-ink" style={{ left: `${expectedPercent}%` }} data-testid="pace-tick" aria-hidden="true" />
        )}
      </div>
      {expectedPercent !== null && (
        <div className="relative mb-2 mt-2 h-4" aria-hidden="true" data-testid="pace-tick-label" data-edge={edge}>
          <span
            className={cn("absolute top-0 whitespace-nowrap text-xs leading-4 text-student-muted", edge === "start" && "left-0", edge === "end" && "right-0", edge === "middle" && "-translate-x-1/2")}
            style={edge === "middle" ? { left: `${expectedPercent}%` } : undefined}
          >
            Expected by now
          </span>
        </div>
      )}
    </div>
  );
}

/** Shows the first `max` items and tucks the rest behind a native "and N more" disclosure. */
export function MoreList<T>({ items, max, render, label, testId, listClass, ariaLabel }: { items: readonly T[]; max: number; render: (item: T, i: number) => React.ReactNode; label?: string; testId?: string; listClass?: string; ariaLabel?: string }) {
  const head = items.slice(0, max);
  const rest = items.slice(max);
  return (
    <div data-testid={testId}>
      <ul className={listClass} aria-label={ariaLabel}>{head.map((t, i) => render(t, i))}</ul>
      {rest.length > 0 && (
        <details className="group" data-testid={testId ? `${testId}-more` : undefined}>
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-student-gold-ink underline underline-offset-4 [&::-webkit-details-marker]:hidden">
            {label ?? `and ${rest.length} more`}
          </summary>
          <ul className={listClass} aria-label={ariaLabel ? `${ariaLabel}, more` : undefined}>{rest.map((t, i) => render(t, head.length + i))}</ul>
        </details>
      )}
    </div>
  );
}

/** Label / value pair used in dense facts lists. */
export function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs font-medium uppercase tracking-[0.1em] text-student-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-student-ink">{children}</dd>
    </div>
  );
}

export const linkButton =
  "inline-flex min-h-[44px] items-center gap-1.5 rounded-md text-sm font-medium text-student-gold-ink underline underline-offset-4 hover:no-underline";

/** Full-contrast action buttons: a pending state keeps the colour (aria-disabled), never a faded 2:1 look. */
export const solidButton = "disabled:opacity-100 aria-disabled:cursor-wait";
