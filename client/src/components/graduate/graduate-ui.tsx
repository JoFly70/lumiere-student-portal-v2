/**
 * Graduate-page status primitives. Same status language as the student shell, but
 * the icon can be overridden so "not yet checked", "not known" and "after
 * conferral" never wear a check mark. Colour, icon and label always travel together.
 */
import React from "react";
import { Circle, Clock, HelpCircle, XCircle } from "lucide-react";
import { Disclosure, SectionHeading, StatusGlyph, StatusPill, STATUS_STYLE } from "@/components/student-progress/student-ui";
import type { StatusKey } from "@/pages/student-roadmap-presentation";
import { cn } from "@/lib/utils";
import type { GlyphKind } from "./graduate-presentation";

const ICONS: Record<GlyphKind, React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>> = {
  stated: Circle,
  unknown: HelpCircle,
  later: Clock,
};

export function GlyphIcon({ status, glyph, className }: { status: StatusKey; glyph?: GlyphKind; className?: string }) {
  if (!glyph) return <StatusGlyph status={status} className={className} />;
  const Icon = ICONS[glyph];
  return <Icon className={cn("h-3.5 w-3.5 shrink-0", STATUS_STYLE[status].text, className)} aria-hidden="true" />;
}

export function StatePill({ status, label, glyph, className, "data-testid": testId }: { status: StatusKey; label: string; glyph?: GlyphKind; className?: string; "data-testid"?: string }) {
  if (!glyph) return <StatusPill status={status} label={label} className={className} data-testid={testId} />;
  return (
    <span
      className={cn("inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", STATUS_STYLE[status].pill, glyph === "later" && "border-dashed", glyph === "stated" && "bg-transparent", className)}
      data-status={status}
      data-testid={testId}
    >
      <GlyphIcon status={status} glyph={glyph} className="text-current" />
      {label}
    </span>
  );
}

/** A negative decision (e.g. "Not recognized"): solid and decided, never the dashed "pending" look. */
export function DecisionPill({ label, className, "data-testid": testId }: { label: string; className?: string; "data-testid"?: string }) {
  return (
    <span
      className={cn("inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", STATUS_STYLE.attention.pill, className)}
      data-status="decision"
      data-testid={testId}
    >
      <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Hatched = stated by the institution, not yet checked. One definition for bars and legend. */
export const HATCHED_STYLE: React.CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, hsl(var(--s-gold)) 0 2px, transparent 2px 6px)",
  backgroundColor: "hsl(var(--s-gold-soft))",
};

/**
 * A finished section: heading stays visible, the body sits behind an accessible
 * disclosure whose label is a one-line summary of the outcome.
 */
export function FinishedSection({ id, sectionId, title, summary, testId, children }: { id: string; sectionId: string; title: string; summary: string; testId: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} id={sectionId} className="scroll-mt-24 space-y-3" data-testid={testId} data-collapsed="true">
      <SectionHeading id={id} title={title} />
      <Disclosure
        testId={`${testId}-disclosure`}
        className="rounded-2xl border border-student-line bg-student-card px-4"
        buttonClassName="text-student-ink"
        label={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold">{summary}</span>
            <span className="text-xs font-medium text-student-gold-ink">Show details</span>
          </span>
        }
      >
        <div className="space-y-4 pb-3 pt-2">{children}</div>
      </Disclosure>
    </section>
  );
}
