/**
 * Prop-driven page views for the student's roadmap (S05). The pages feed them
 * data; actions come from RoadmapActionsContext so these render from fixtures.
 */
import React, { useEffect, useState } from "react";
import { ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import { BRAND_NAME, ROADMAP_SECTIONS, isPublished, primaryObjectiveTitle } from "@/pages/student-roadmap-presentation";
import { formatAsOf } from "@/pages/student-progress-presentation";
import { StudentSurface } from "./student-ui";
import { ProgressSummary } from "./progress-summary";
import { NowStrip, TodaySection } from "./today-section";
import { RoadmapJourney } from "./roadmap-journey";
import { FoundationSection, FoundationSummary } from "./foundation-section";
import { HorizonSection, HorizonSummary } from "./horizon-section";
import { RoadmapNotPublished } from "./roadmap-states";

function PageHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string | null }) {
  return (
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-student-gold-ink">{eyebrow}</p>
      <h1 className="font-serif text-3xl leading-tight tracking-tight text-student-ink sm:text-5xl" data-testid="text-page-title">
        {title}
      </h1>
      {subtitle && <p className="text-sm text-student-muted">{subtitle}</p>}
    </header>
  );
}

function planSubtitle(view: StudentRoadmapView): string | null {
  if (!view.plan) return null;
  const published = formatAsOf(view.plan.publishedAt);
  return [`Plan version ${view.plan.versionNumber}`, published ? `published ${published}` : null].filter(Boolean).join(" · ");
}

/** Sticky section navigation with the section in view highlighted. */
export function SectionNav({ sections }: { sections: readonly { id: string; label: string }[] }) {
  const [active, setActive] = useState<string>(sections[0]?.id ?? "");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        const best = [...visible.entries()].sort((a, b) => b[1] - a[1])[0];
        if (best && best[1] > 0) setActive(best[0]);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.1, 0.5, 1] },
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);
  return (
    <nav
      aria-label="Roadmap sections"
      className="[contain:inline-size] md:sticky md:top-0 z-30 -mx-4 border-b border-student-line bg-student-bg px-4 shadow-sm sm:-mx-6 sm:px-6 md:-mx-8 md:px-8"
      data-testid="section-nav"
    >
      <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto py-1.5">
        {sections.map((s) => (
          <li key={s.id} className="shrink-0">
            <a
              href={`#${s.id}`}
              aria-current={active === s.id ? "location" : undefined}
              className={cn(
                "inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-sm font-medium",
                active === s.id ? "border-2 border-student-gold-ink bg-student-gold-soft text-student-gold-ink" : "border-2 border-transparent text-student-muted hover:text-student-ink",
              )}
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Mobile only: one compact floating "Jump to" menu, so no second sticky bar covers titles. */
export function JumpMenu({ sections }: { sections: readonly { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="student-surface fixed bottom-4 right-4 z-40 md:hidden" data-testid="jump-menu">
      {open && (
        <ul className="mb-2 overflow-hidden rounded-xl border border-student-line bg-student-card shadow-lg" aria-label="Jump to section">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={() => setOpen(false)}
                className="flex min-h-[44px] items-center px-4 text-sm font-medium text-student-ink hover:bg-student-gold-soft"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="ml-auto flex min-h-[44px] items-center gap-2 rounded-full bg-student-seal px-4 text-sm font-semibold text-student-seal-ink shadow-lg"
      >
        Jump to
        <ChevronUp className={cn("h-4 w-4 transition-transform", !open && "rotate-180")} aria-hidden="true" />
      </button>
    </div>
  );
}

export function RoadmapPageView({
  view,
  requirementDetails,
}: {
  view: StudentRoadmapView;
  requirementDetails?: React.ReactNode;
}) {
  const [targetItemKey, setTargetItemKey] = useState<string | null>(null);
  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash.startsWith("#item-")) setTargetItemKey(decodeURIComponent(hash.slice("#item-".length)));
  }, []);

  if (!isPublished(view)) {
    return (
      <StudentSurface testId="roadmap-page">
        <div data-state="NOT_PUBLISHED">
          <div className="mx-auto w-full max-w-6xl pb-6">
            <PageHeader eyebrow={BRAND_NAME} title="Your roadmap" />
          </div>
          <SectionNav sections={[ROADMAP_SECTIONS[0], ROADMAP_SECTIONS[2]]} />
          <div className="mx-auto mt-6 w-full max-w-6xl">
            <RoadmapNotPublished view={view} requirementDetails={requirementDetails} />
          </div>
        </div>
      </StudentSurface>
    );
  }

  const firstFocus = view.today.focusItemKeys[0] ?? null;
  return (
    <StudentSurface testId="roadmap-page">
      <div data-state="PUBLISHED">
        <div className="mx-auto w-full max-w-6xl pb-6">
          <PageHeader eyebrow={BRAND_NAME} title={primaryObjectiveTitle(view) ?? view.plan!.title} subtitle={planSubtitle(view)} />
        </div>
        <SectionNav sections={ROADMAP_SECTIONS} />
        <JumpMenu sections={ROADMAP_SECTIONS} />
        <div className="mx-auto mt-6 w-full max-w-6xl space-y-8">
          <NowStrip view={view} onJump={(key) => setTargetItemKey(key)} />
          <ProgressSummary view={view} variant="roadmap" />
          <RoadmapJourney view={view} targetItemKey={targetItemKey} defaultOpenKey={firstFocus} />
          <FoundationSection foundation={view.foundation} requirementDetails={requirementDetails} />
          <HorizonSection view={view} />
        </div>
      </div>
    </StudentSurface>
  );
}

export function FlightDeckRoadmapView({ view }: { view: StudentRoadmapView }) {
  if (!isPublished(view)) {
    return (
      <StudentSurface testId="flight-deck">
        <div className="mx-auto w-full max-w-6xl space-y-8" data-state="NOT_PUBLISHED">
          <PageHeader eyebrow={BRAND_NAME} title="Your Flight Deck" />
          <RoadmapNotPublished view={view} showFoundation={false} />
          <FoundationSummary foundation={view.foundation} />
        </div>
      </StudentSurface>
    );
  }
  return (
    <StudentSurface testId="flight-deck">
      <div className="mx-auto w-full max-w-6xl space-y-8" data-state="PUBLISHED">
        <PageHeader eyebrow={BRAND_NAME} title="Your Flight Deck" subtitle={primaryObjectiveTitle(view)} />
        <TodaySection view={view} />
        <ProgressSummary view={view} showRoadmapLink />
        <div className="grid gap-6 md:grid-cols-2">
          <FoundationSummary foundation={view.foundation} />
          <HorizonSummary view={view} />
        </div>
      </div>
    </StudentSurface>
  );
}
