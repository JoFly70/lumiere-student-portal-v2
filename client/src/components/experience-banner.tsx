import { useLayoutEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { useAuth, leaveExperienceTab } from "@/lib/auth";
import { useT } from "@/i18n";
import { banner } from "@/lib/experience-session";

/**
 * Persistent, unmistakable banner shown in the owner's "Experience as student" tab. Fixed; layout offsets via --exp-h.
 * The text wraps and the "Back to staff portal" button is always visible (never clipped); the real banner height is
 * measured and published as --exp-h so the app below it is offset exactly.
 */
export function ExperienceBanner() {
  const { experience, logout } = useAuth();
  const { language } = useT();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const apply = () => document.body.style.setProperty("--exp-h", `${el.offsetHeight}px`);
    apply();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); document.body.style.removeProperty("--exp-h"); };
  }, [experience]);
  if (!experience) return null;
  const copy = banner(language, experience.label);
  return (
    <div
      ref={ref}
      role="status"
      data-testid="experience-banner"
      className="fixed inset-x-0 top-0 z-40 flex min-h-[var(--exp-h)] flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b-2 border-[var(--t-accent)] bg-[var(--t-heading)] px-3 py-2 text-[var(--t-bg)] shadow sm:px-4"
    >
      <p className="min-w-0 flex-1 basis-60 text-[12px] font-semibold leading-snug sm:text-sm">{copy.text}</p>
      <button
        type="button"
        onClick={() => { void logout().catch(() => leaveExperienceTab()); }}
        className="inline-flex min-h-[36px] shrink-0 items-center gap-2 rounded-md border border-[var(--t-accent)] bg-[var(--t-accent)] px-3 text-sm font-semibold text-[var(--t-accent-ink)] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-accent)]"
        data-testid="button-exit-experience"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {copy.exit}
      </button>
    </div>
  );
}
