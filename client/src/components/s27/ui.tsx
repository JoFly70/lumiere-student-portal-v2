/**
 * Shared building blocks of the S27 student screens. Styling lives in styles/student-s27.css (scoped under .s27,
 * driven by the theme tokens, so light, dark and every other theme work).
 */
import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { StudentSurface } from "@/components/student-progress/student-ui";
import { cn } from "@/lib/utils";
import "@/styles/student-s27.css";
import "@/styles/student-s27-extra.css";

/** Page frame: the existing student surface, then the S27 scope. */
export function S27Page({ children, testId, className }: { children: React.ReactNode; testId?: string; className?: string }) {
  return (
    <StudentSurface testId={testId}>
      <div className={cn("s27", className)}>
        <div className="inner">{children}</div>
      </div>
    </StudentSurface>
  );
}

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("eyebrow", className)}>{children}</span>;
}

/** Countdown ring: `fraction` of the circle is filled with `color`. Decorative; the number beside it is the content. */
export function Ring({ fraction, color, size = 64 }: { fraction: number; color: string; size?: number }) {
  const r = 27;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--t-panel-3)" strokeWidth="5" />
      <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(c * Math.max(0.02, Math.min(1, fraction))).toFixed(1)} ${c.toFixed(1)}`} />
    </svg>
  );
}

export const SEVERITY_COLOR = {
  crit: "var(--t-red)",
  warn: "var(--t-amber)",
  info: "var(--t-accent)",
  ok: "var(--t-green)",
} as const;

/**
 * Modal sheet (Log progress). Radix Dialog gives the focus trap, Escape and focus return; the content is
 * portalled, so it carries its own .s27 scope.
 */
export function S27Sheet({
  open, onOpenChange, title, closeLabel, children, testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeLabel: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <div className="s27">
          <DialogPrimitive.Overlay className="sheet-bg" />
          <DialogPrimitive.Content className="sheet" aria-describedby={undefined} data-testid={testId}>
            <div className="sh-top">
              <DialogPrimitive.Title asChild><h2>{title}</h2></DialogPrimitive.Title>
              <DialogPrimitive.Close className="chat-x" aria-label={closeLabel}><X size={18} aria-hidden="true" /></DialogPrimitive.Close>
            </div>
            {children}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
