/**
 * Phone-only disclosure. From the md breakpoint the content is always shown and
 * the toggle is hidden; on phones the content starts collapsed behind a button
 * that states how much is inside. The content stays in the DOM (display:none
 * when collapsed), so nothing is removed, only made reachable.
 */
import React, { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function MobileCollapse({
  label,
  openLabel,
  children,
  className,
  testId,
}: {
  /** What the button says while collapsed, e.g. "Show 2 more courses in progress". */
  label: string;
  /** What the button says while open; defaults to "Hide". */
  openLabel?: string;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className} data-testid={testId}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl border border-student-line bg-student-card px-4 text-left text-sm font-medium text-student-ink md:hidden"
        data-testid={testId ? `${testId}-toggle` : undefined}
      >
        <span>{open ? (openLabel ?? "Hide") : label}</span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-student-gold-ink transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      <div id={id} className={cn(!open && "max-md:hidden", open && "max-md:mt-4")}>
        {children}
      </div>
    </div>
  );
}
