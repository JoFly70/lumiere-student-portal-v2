/**
 * Lumière AI avatar: a gold conic orb with a dark core, glowing eyes that blink and a dashed ring.
 * States: idle (breathing), think (fast spin, eyes look side to side), talk (mouth moves).
 * Motion is CSS only and switched off under prefers-reduced-motion (the orb is then a static portrait).
 * Decorative by default (aria-hidden): the control or heading next to it carries the name.
 */
import React from "react";
import { cn } from "@/lib/utils";
import "@/styles/student-s27.css";

export type OrbState = "idle" | "think" | "talk";

export function LumiereOrb({
  size = 44,
  state = "idle",
  className,
  label,
}: {
  size?: number;
  state?: OrbState;
  className?: string;
  /** Pass a label only when the orb stands alone (no text beside it). */
  label?: string;
}) {
  return (
    <span
      className={cn("lm-orb", state !== "idle" && state, className)}
      style={{ "--s": `${size}px` } as React.CSSProperties}
      data-state={state}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <i className="l" />
      <i className="r" />
      <b />
    </span>
  );
}
