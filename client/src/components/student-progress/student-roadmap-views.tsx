/**
 * Prop-driven page views for the student's roadmap (S05, reorganised in S07).
 * The pages feed them data; actions come from RoadmapActionsContext so these
 * render from fixtures.
 *
 * Page ownership: the Flight Deck owns "where you stand" in full (today,
 * journey at a glance, progress, foundation, horizon). The Roadmap owns the
 * journey itself (phases, courses, tasks). Each links to the other's detail
 * instead of repeating it.
 */
import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import {
  BRAND_NAME,
  FLIGHT_DECK_PATH,
  FLIGHT_DECK_SECTIONS,
  ROADMAP_PATH,
  isPublished,
  primaryObjectiveTitle,
} from "@/pages/student-roadmap-presentation";
import { formatAsOf } from "@/pages/student-progress-presentation";
import { Eyebrow, SectionHeading, StudentSurface, buttonClass, cardClass } from "./student-ui";
import { ProgressSummary } from "./progress-summary";
import { NowStrip, TodaySection } from "./today-section";
import { RoadmapJourney } from "./roadmap-journey";
import { FoundationSection } from "./foundation-section";
import { HorizonSection } from "./horizon-section";
import { JourneyStrip } from "./journey-graphics";
import { RoadmapNotPublished } from "./roadmap-states";

/** Roadmap page sections. "Phases" (not "Journey"): the Flight Deck's "Journey" is the overview strip. */
const ROADMAP_NAV = [
  { id: "section-today", label: "Now" },
  { id: "section-roadmap", label: "Phases" },
] as const;

function PageHeader({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle?: string | null; children?: React.ReactNode }) {
  return (
    <header className="space-y-2">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="font-serif text-3xl leading-tight tracking-tight text-student-ink sm:text-5xl" data-testid="text-page-title">
        {title}
      </h1>
      {subtitle && <p className="text-sm text-student-muted">{subtitle}</p>}
      {children}
    </header>
  );
}

function planSubtitle(view: StudentRoadmapView): string | null {
  if (!view.plan) return null;
  const published = formatAsOf(view.plan.publishedAt);
  return [`Plan version ${view.plan.versionNumber}`, published ? `published ${published}` : null].filter(Boolean).join(" · ");
}

/**
 * Sticky section navigation (every width). It is a real nav with in-page links, so
 * it never floats over content: it takes its own row at the top of the page and
 * every section scrolls to just below it.
 */
export function SectionNav({ sections, label = "Page sections" }: { sections: readonly { id: string; label: string }[]; label?: string }) {
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
      aria-label={label}
      className="[contain:inline-size] relative z-30 md:sticky md:top-0 -mx-4 border-b border-student-line bg-student-bg/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 md:-mx-8 md:px-8"
      data-testid="section-nav"
    >
      <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto py-1.5">
        {sections.map((s) => (
          <li key={s.id} className="shrink-0">
            <a
              href={`#${s.id}`}
              aria-current={active === s.id ? "location" : undefined}
              className={cn(
                "inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 text-sm font-medium",
                active === s.id
                  ? "border-2 border-student-gold-ink bg-student-gold-soft text-student-gold-ink"
                  : "border-2 border-transparent text-student-muted hover:text-student-ink",
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

export function RoadmapPageView({
  view,
}: {
  view: StudentRoadmapView;
  /** Kept for call-site compatibility: requirement detail now lives on the Flight Deck. */
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
          <div className="mx-auto mt-6 w-full max-w-6xl">
            <RoadmapNotPublished view={view} showFoundation={false} foundationLink />
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
          <PageHeader eyebrow={BRAND_NAME} title={primaryObjectiveTitle(view) ?? view.plan!.title} subtitle={planSubtitle(view)}>
            <p className="text-sm text-student-muted">
              Your overall progress, foundation and horizon are on your{" "}
              <Link href={FLIGHT_DECK_PATH} className="font-medium text-student-gold-ink underline underline-offset-4" data-testid="link-flight-deck">
                Flight Deck
              </Link>
              .
            </p>
          </PageHeader>
        </div>
        <SectionNav sections={ROADMAP_NAV} label="Roadmap sections" />
        <div className="mx-auto mt-6 w-full max-w-6xl space-y-10">
          <NowStrip view={view} onJump={(key) => setTargetItemKey(key)} />
          <RoadmapJourney view={view} targetItemKey={targetItemKey} defaultOpenKey={firstFocus} />
        </div>
      </div>
    </StudentSurface>
  );
}

export function FlightDeckRoadmapView({
  view,
  requirementDetails,
}: {
  view: StudentRoadmapView;
  requirementDetails?: React.ReactNode;
}) {
  if (!isPublished(view)) {
    return (
      <StudentSurface testId="flight-deck">
        <div className="mx-auto w-full max-w-6xl space-y-8" data-state="NOT_PUBLISHED">
          <PageHeader eyebrow={BRAND_NAME} title="Your Flight Deck" />
          <RoadmapNotPublished view={view} requirementDetails={requirementDetails} />
        </div>
      </StudentSurface>
    );
  }
  return (
    <StudentSurface testId="flight-deck">
      <div data-state="PUBLISHED">
        <div className="mx-auto w-full max-w-6xl pb-6">
          <PageHeader eyebrow={BRAND_NAME} title="Your Flight Deck" subtitle={primaryObjectiveTitle(view)} />
        </div>
        <SectionNav sections={FLIGHT_DECK_SECTIONS} label="Flight Deck sections" />
        <div className="mx-auto mt-6 w-full max-w-6xl space-y-10">
          <TodaySection view={view} />
          <section aria-labelledby="journey-title" id="section-journey" className="scroll-mt-20 space-y-4" data-testid="journey-section">
            <SectionHeading
              id="journey-title"
              eyebrow="Your journey"
              title="From your starting point to graduation"
              description="Each bar shows one course in the phase. The full list of courses and tasks is on your roadmap."
            />
            <div className={cn(cardClass, "space-y-5")}>
              <JourneyStrip view={view} />
              <Link href={ROADMAP_PATH} className={buttonClass.link} data-testid="link-full-roadmap">
                Open your full roadmap <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </section>
          <ProgressSummary view={view} />
          <FoundationSection foundation={view.foundation} requirementDetails={requirementDetails} />
          <HorizonSection view={view} />
        </div>
      </div>
    </StudentSurface>
  );
}
