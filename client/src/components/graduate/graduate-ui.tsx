/**
 * Graduate-page status primitives. Same status language as the student shell, but
 * the icon can be overridden so "not yet checked", "not known" and "after
 * conferral" never wear a check mark. Colour, icon and label always travel together.
 */
import React from "react";
import { Circle, Clock, HelpCircle } from "lucide-react";
import { StatusGlyph, StatusPill, STATUS_STYLE } from "@/components/student-progress/student-ui";
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
      className={cn("inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", STATUS_STYLE[status].pill, glyph === "later" && "border-dashed", className)}
      data-status={status}
      data-testid={testId}
    >
      <GlyphIcon status={status} glyph={glyph} className="text-current" />
      {label}
    </span>
  );
}
