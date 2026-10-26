/**
 * Student-facing primitives (S05): the gold / ivory / charcoal surface and the
 * small building blocks the roadmap sections share. Tokens live in index.css
 * under .student-surface so admin pages are unaffected.
 */
import React, { useId, useState } from "react";
import { ChevronDown, CheckCheck, CircleDashed, CircleDot, ClipboardCheck, Send, ShieldCheck, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_META, type StatusKey } from "@/pages/student-roadmap-presentation";

/**
 * The status language (see index.css --st-*): colour + icon + label, always together.
 * Class names are written out in full so Tailwind can see them.
 */
export const STATUS_STYLE: Record<StatusKey, { text: string; soft: string; border: string; fill: string; pill: string }> = {
  official: { text: "text-st-official", soft: "bg-st-official-soft", border: "border-st-official", fill: "bg-st-official", pill: "border-st-official bg-st-official text-student-seal-ink" },
  applied: { text: "text-st-applied", soft: "bg-st-applied-soft", border: "border-st-applied", fill: "bg-st-applied", pill: "border-st-applied bg-st-applied-soft text-st-applied" },
  provider: { text: "text-st-provider", soft: "bg-st-provider-soft", border: "border-st-provider", fill: "bg-st-provider", pill: "border-st-provider bg-st-provider-soft text-st-provider" },
  progress: { text: "text-st-progress", soft: "bg-st-progress-soft", border: "border-st-progress", fill: "bg-st-progress", pill: "border-st-progress bg-st-progress-soft text-st-progress" },
  submitted: { text: "text-st-submitted", soft: "bg-st-submitted-soft", border: "border-st-submitted", fill: "bg-st-submitted", pill: "border-st-submitted bg-st-submitted-soft text-st-submitted" },
  notstarted: { text: "text-st-notstarted", soft: "bg-st-notstarted-soft", border: "border-st-notstarted", fill: "bg-st-notstarted", pill: "border-dashed border-st-notstarted bg-st-notstarted-soft text-st-notstarted" },
  attention: { text: "text-st-attention", soft: "bg-st-attention-soft", border: "border-st-attention", fill: "bg-st-attention", pill: "border-st-attention bg-st-attention-soft text-st-attention" },
};

const STATUS_ICON: Record<StatusKey, React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>> = {
  official: ShieldCheck,
  applied: CheckCheck,
  provider: ClipboardCheck,
  progress: CircleDot,
  submitted: Send,
  notstarted: CircleDashed,
  attention: TriangleAlert,
};

export function StatusGlyph({ status, className }: { status: StatusKey; className?: string }) {
  const Icon = STATUS_ICON[status];
  return <Icon className={cn("h-3.5 w-3.5 shrink-0", STATUS_STYLE[status].text, className)} aria-hidden="true" />;
}

/** Status pill: icon + label, in the status colour. `label` overrides the default wording. */
export function StatusPill({
  status,
  label,
  className,
  "data-testid": testId,
}: {
  status: StatusKey;
  label?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        STATUS_STYLE[status].pill,
        className,
      )}
      data-status={status}
      data-testid={testId}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {label ?? STATUS_META[status].label}
    </span>
  );
}

export function StudentSurface({
  children,
  className,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  // The app shell pads <main>; negative margins let the ivory surface fill it.
  return (
    <div
      className={cn("student-surface -m-6 min-h-[calc(100vh-70px)] p-4 pb-28 sm:p-6 sm:pb-28 md:-m-8 md:p-8 md:pb-12", className)}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/** Small-caps brand eyebrow with a short gold rule. Gold here is brand, not status. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-student-gold-ink", className)}>
      <span aria-hidden="true" className="h-px w-6 bg-student-gold" />
      {children}
    </p>
  );
}

export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  as: Tag = "h2",
}: {
  id: string;
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <div className="space-y-1">
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <Tag id={id} className="font-serif text-2xl tracking-tight text-student-ink sm:text-3xl">
        {title}
      </Tag>
      {description && <p className="max-w-2xl text-sm leading-relaxed text-student-muted">{description}</p>}
    </div>
  );
}

export const cardClass =
  "rounded-2xl border border-student-line bg-student-card p-4 shadow-[0_1px_2px_hsl(var(--s-ink)/0.04),0_8px_24px_-12px_hsl(var(--s-ink)/0.10)] sm:p-6";

export const buttonClass = {
  outline:
    "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-student-line-strong bg-student-card px-4 text-sm font-medium text-student-ink hover:bg-student-gold-soft disabled:cursor-not-allowed disabled:opacity-60",
  solid:
    "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-student-seal px-4 text-sm font-medium text-student-seal-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60",
  /** The one primary call to action: Lumière gold with charcoal ink. */
  primary:
    "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-student-gold-bright px-5 text-base font-semibold text-student-gold-bright-ink shadow-[0_6px_18px_-8px_hsl(var(--s-gold)/0.9)] hover:brightness-105 focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-60",
  link:
    "inline-flex min-h-[44px] items-center gap-1.5 rounded-md text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline",
} as const;

/** Accessible disclosure: a real button with aria-expanded controlling a region. */
export function Disclosure({
  label,
  children,
  defaultOpen = false,
  lazy = false,
  className,
  buttonClassName,
  testId,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Mount children only once opened (used for content that fetches data). */
  lazy?: boolean;
  className?: string;
  buttonClassName?: string;
  testId?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [everOpened, setEverOpened] = useState(defaultOpen);
  return (
    <div className={className} data-testid={testId}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen((o) => !o);
          setEverOpened(true);
        }}
        className={cn(
          "flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg text-left text-sm font-medium text-student-gold-ink",
          buttonClassName,
        )}
      >
        <span>{label}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      <div id={id} hidden={!open}>
        {lazy && !everOpened ? null : children}
      </div>
    </div>
  );
}

/**
 * Generic pill for NON-status labels (brand highlight, neutral tags). Progress and
 * credit states use <StatusPill>. `gold` marks Lumière-highlighted things such as
 * "Next" or the primary degree; it never encodes a progress state.
 */
export function Pill({
  children,
  tone = "neutral",
  className,
  icon,
  "data-testid": testId,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "gold" | "attn" | "seal" | "dashed";
  className?: string;
  icon?: React.ReactNode;
  "data-testid"?: string;
}) {
  const tones = {
    neutral: "border-student-line-strong text-student-muted",
    gold: "border-student-gold bg-student-gold-soft text-student-gold-ink",
    attn: "border-st-attention bg-st-attention-soft text-st-attention",
    seal: "border-student-seal bg-student-seal text-student-seal-ink",
    dashed: "border-dashed border-student-line-strong text-student-muted",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        tones[tone],
        className,
      )}
      data-testid={testId}
    >
      {icon}
      {children}
    </span>
  );
}
