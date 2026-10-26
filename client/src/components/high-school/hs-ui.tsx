/**
 * Small building blocks for the High School Pathway page (S11). They reuse the
 * student surface tokens and the shared status language; nothing here defines
 * new colours.
 */
import React from "react";
import { cn } from "@/lib/utils";
import { formatHalfUnits, type HalfUnits } from "@shared/high-school-contract";
import { barPercent, creditsLabel, creditsOfLabel } from "@/pages/high-school-presentation";
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
 * Credit ring: official credit as a solid arc, credit awaiting school
 * confirmation as a separate dashed, lighter arc after it. Text carries the
 * exact numbers (formatHalfUnits), the arcs only size the graphic.
 */
export function CreditRing({
  earned,
  required,
  awaiting,
  size = 176,
  className,
}: {
  earned: HalfUnits;
  required: HalfUnits;
  awaiting: HalfUnits;
  size?: number;
  className?: string;
}) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const earnedFrac = required > 0 ? Math.min(1, earned / required) : 0;
  const awaitFrac = required > 0 ? Math.min(1 - earnedFrac, awaiting / required) : 0;
  const label = `${creditsOfLabel(earned, required)} official${awaiting > 0 ? `, plus ${creditsLabel(awaiting)} awaiting school confirmation` : ""}`;
  return (
    <div className={cn("relative mx-auto shrink-0", className)} style={{ width: size, height: size }} role="img" aria-label={label} data-testid="credit-ring" data-percent={barPercent(earned, required)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--s-line))" strokeWidth={stroke} />
        {awaitFrac > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="hsl(var(--st-submitted))"
            strokeOpacity="0.55"
            strokeWidth={stroke - 4}
            strokeDasharray={`${c * awaitFrac - 3} ${c}`}
            strokeDashoffset={-c * earnedFrac}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
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
        <span className="font-serif text-5xl leading-none tracking-tight text-student-ink">{formatHalfUnits(earned)}</span>
        <span className="mt-1 text-sm text-student-muted">of {formatHalfUnits(required)} credits</span>
      </div>
    </div>
  );
}

/** Horizontal meter with an optional second (awaiting) segment. Numbers are always shown beside it by the caller. */
export function Meter({
  value,
  total,
  extra = 0,
  label,
  className,
  tone = "gold",
}: {
  value: HalfUnits;
  total: HalfUnits;
  extra?: HalfUnits;
  label: string;
  className?: string;
  tone?: "gold" | "ink";
}) {
  const a = barPercent(value, total);
  const b = Math.min(100 - a, barPercent(extra, total));
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
      {b > 0 && <div className="h-full bg-st-submitted/50" style={{ width: `${b}%` }} />}
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
