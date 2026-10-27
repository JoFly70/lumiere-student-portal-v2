/**
 * Lumière brand (S19). The crest is the approved Lumière crest, tight-cropped (aspect 0.973) exactly as
 * ClientDesk presents it; derived from the master by scripts/s19/gen-brand-assets.py.
 * Wordmark type: Cormorant Garamond 500 (ClientDesk's wordmark face) via the `font-display` utility /
 * `--font-display` token; tagline in the UI sans, tracked caps.
 */
import React from "react";
import { cn } from "@/lib/utils";

void React; // classic JSX runtime when rendered under vitest/esbuild
import crest96 from "@/assets/brand/crest-96.webp";
import crest192 from "@/assets/brand/crest-192.webp";
import crest480 from "@/assets/brand/crest-480.webp";

export const BRAND = { name: "Lumière", tagline: "Student Portal" } as const;

/** Intrinsic aspect ratio (w/h) of the cropped crest. */
const ASPECT = 1083 / 1113;

export function LumiereCrest({
  size = 40,
  className,
  decorative = true,
}: {
  /** Rendered height in px (width follows the aspect ratio). */
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  const height = size;
  const width = Math.round(size * ASPECT);
  return (
    <img
      src={crest192}
      srcSet={`${crest96} ${Math.round(96 * ASPECT)}w, ${crest192} ${Math.round(192 * ASPECT)}w, ${crest480} ${Math.round(480 * ASPECT)}w`}
      sizes={`${width}px`}
      width={width}
      height={height}
      alt={decorative ? "" : `${BRAND.name} crest`}
      aria-hidden={decorative ? true : undefined}
      decoding="async"
      draggable={false}
      className={cn("shrink-0 select-none object-contain", className)}
      data-testid="img-lumiere-crest"
    />
  );
}

type Tone = "auto" | "on-dark" | "on-light";

const NAME_COLOR: Record<Tone, string | undefined> = {
  auto: undefined,
  "on-dark": "var(--t-rail-head, #f4efe4)",
  "on-light": "var(--t-heading, #10141c)",
};
const TAG_COLOR: Record<Tone, string | undefined> = {
  auto: undefined,
  "on-dark": "var(--t-rail-sub, var(--t-rail-act, #c9b27f))",
  "on-light": "var(--t-accent-text, #74561b)",
};

export function LumiereWordmark({
  variant = "full",
  tone = "auto",
  className,
}: {
  variant?: "full" | "compact" | "stacked";
  tone?: Tone;
  className?: string;
}) {
  const stacked = variant === "stacked";
  const compact = variant === "compact";
  return (
    <span
      className={cn("inline-flex items-center", stacked ? "flex-col gap-3 text-center" : "gap-3", className)}
      role="img"
      aria-label={compact ? BRAND.name : `${BRAND.name} ${BRAND.tagline}`}
      data-testid="lumiere-wordmark"
      data-variant={variant}
    >
      <LumiereCrest size={stacked ? 96 : compact ? 32 : 40} />
      <span className={cn("min-w-0", stacked ? "text-center" : "text-left")} aria-hidden="true">
        <span
          className={cn("block font-display font-medium leading-none tracking-[0.01em]", stacked ? "text-[40px]" : compact ? "text-[22px]" : "text-[26px]")}
          style={{ color: NAME_COLOR[tone] }}
        >
          {BRAND.name}
        </span>
        {!compact && (
          <span
            className={cn(
              "block font-sans font-semibold uppercase leading-none",
              stacked ? "mt-3 text-[11px] tracking-[0.34em] pl-[0.34em]" : "mt-1.5 text-[10px] tracking-[0.2em]",
              tone === "auto" && "opacity-75",
            )}
            style={{ color: TAG_COLOR[tone] }}
          >
            {BRAND.tagline}
          </span>
        )}
      </span>
    </span>
  );
}
