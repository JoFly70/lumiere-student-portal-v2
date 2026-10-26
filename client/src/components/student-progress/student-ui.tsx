/**
 * Student-facing primitives (S05): the gold / ivory / charcoal surface and the
 * small building blocks the roadmap sections share. Tokens live in index.css
 * under .student-surface so admin pages are unaffected.
 */
import React, { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

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
      className={cn("student-surface -m-6 min-h-full p-4 sm:p-6 md:-m-8 md:p-8", className)}
      data-testid={testId}
    >
      {children}
    </div>
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
      {eyebrow && (
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-student-gold-ink">{eyebrow}</p>
      )}
      <Tag id={id} className="font-serif text-2xl tracking-tight text-student-ink sm:text-3xl">
        {title}
      </Tag>
      {description && <p className="max-w-2xl text-sm leading-relaxed text-student-muted">{description}</p>}
    </div>
  );
}

export const cardClass =
  "rounded-2xl border border-student-line bg-student-card p-4 shadow-sm sm:p-6";

export const buttonClass = {
  outline:
    "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-student-line-strong bg-student-card px-4 text-sm font-medium text-student-ink hover:bg-student-gold-soft disabled:cursor-not-allowed disabled:opacity-60",
  solid:
    "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-student-seal px-4 text-sm font-medium text-student-seal-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60",
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

export function Pill({
  children,
  tone = "neutral",
  className,
  icon,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "gold" | "attn" | "seal" | "dashed";
  className?: string;
  icon?: React.ReactNode;
}) {
  const tones = {
    neutral: "border-student-line-strong text-student-muted",
    gold: "border-student-gold bg-student-gold-soft text-student-gold-ink",
    attn: "border-student-attn bg-student-attn-soft text-student-attn",
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
    >
      {icon}
      {children}
    </span>
  );
}
