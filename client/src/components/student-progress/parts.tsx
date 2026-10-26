/**
 * Small presentation primitives shared by the Flight Deck and Roadmap views.
 * Verified facts use solid gold; preliminary information uses dashed outlines.
 */
import React from "react";
import { Check, CircleDashed, Clock, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ratioForGraphic,
  type StatusTone,
} from "@/pages/student-progress-presentation";

export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  className,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      {eyebrow && (
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gold-strong">
          {eyebrow}
        </p>
      )}
      <h2 id={id} className="font-serif text-xl sm:text-2xl tracking-tight text-foreground">
        {title}
      </h2>
      {description && (
        <p className="text-sm leading-relaxed text-muted-foreground max-w-2xl">{description}</p>
      )}
    </div>
  );
}

/** Solid gold check + "Verified": an academic fact confirmed by staff. */
export function VerifiedMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-gold-soft px-2.5 py-1 text-xs font-medium text-gold-strong ring-1 ring-inset ring-gold/40",
        className,
      )}
      data-testid="mark-verified"
    >
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gold text-white dark:text-background">
        <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
      </span>
      Verified
    </span>
  );
}

/** Dashed outline + "Preliminary": information not yet part of the verified record. */
export function PreliminaryMark({
  label = "Preliminary",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-dashed border-muted-foreground/60 px-2.5 py-1 text-xs font-medium text-muted-foreground",
        className,
      )}
      data-testid="mark-preliminary"
    >
      <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

const TONE_CHIP: Record<StatusTone, string> = {
  satisfied: "bg-gold-soft text-gold-strong ring-gold/40",
  progress: "bg-transparent text-gold-strong ring-gold/60",
  outstanding: "bg-muted text-muted-foreground ring-border",
  review: "bg-attention-soft text-attention ring-attention/40",
};

export function StatusChip({
  tone,
  label,
  className,
}: {
  tone: StatusTone;
  label: string;
  className?: string;
}) {
  const Icon =
    tone === "satisfied" ? Check : tone === "review" ? Eye : tone === "progress" ? Clock : CircleDashed;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset whitespace-nowrap",
        TONE_CHIP[tone],
        className,
      )}
      data-tone={tone}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={tone === "satisfied" ? 3 : 2} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Slim gold bar. Width encodes applied/required; the label carries the real numbers. */
export function SlimBar({
  applied,
  required,
  label,
  tone = "progress",
}: {
  applied: string | null;
  required: string | null;
  label: string;
  tone?: StatusTone;
}) {
  const ratio = ratioForGraphic(applied, required);
  return (
    <div
      role="img"
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          "h-full rounded-full",
          tone === "review" ? "bg-attention/60" : "bg-gradient-to-r from-gold/70 to-gold",
        )}
        style={{ width: `${Math.round(ratio * 1000) / 10}%` }}
      />
    </div>
  );
}

/**
 * Gold progress ring. Arc length = applied / required. The centre and the
 * accessible name carry the exact figures from the API.
 */
export function ProgressRing({
  applied,
  required,
  appliedLabel,
  requiredLabel,
  altText,
}: {
  applied: string;
  required: string;
  appliedLabel: string;
  requiredLabel: string;
  altText: string;
}) {
  const size = 220;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = ratioForGraphic(applied, required);
  const arc = Math.round(circumference * ratio * 100) / 100;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[220px]">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={altText}
        className="h-full w-full"
        data-testid="progress-ring"
      >
        <defs>
          <linearGradient id="lum-ring-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--gold))" stopOpacity="0.75" />
            <stop offset="100%" stopColor="hsl(var(--gold))" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={stroke}
        />
        {arc > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="url(#lum-ring-gold)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"
        aria-hidden="true"
      >
        <span className="font-serif text-5xl leading-none tracking-tight text-foreground">
          {appliedLabel}
        </span>
        <span className="mt-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
          of {requiredLabel} credits
        </span>
      </div>
    </div>
  );
}
