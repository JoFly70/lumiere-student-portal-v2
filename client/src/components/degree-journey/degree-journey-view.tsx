/**
 * The degree student's simplified Roadmap: credits by source, courses to log (Now / Up next /
 * Completed) and the Log progress sheet. The staff degree plan is a different, fuller view of the same plan.
 * Prop driven: the page feeds it the roadmap and (optionally) canonical degree progress.
 */
import React, { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Plus } from "lucide-react";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import type { StudentDegreeProgressView } from "@shared/student-degree-progress-view";
import { primaryObjectiveTitle, FLIGHT_DECK_PATH, itemsByKey } from "@/pages/student-roadmap-presentation";
import { Eyebrow, StudentSurface, buttonClass } from "@/components/student-progress/student-ui";
import { buildCreditsBySource, buildWarnings, splitCourses } from "./model";
import { WarningsCard } from "./warnings";
import { CreditsCard } from "./credits-card";
import { CompletedSection, NowSection, UpNextSection, WaitingSection } from "./courses";
import { RequirementsCard } from "./requirements-card";
import { LogSheet } from "./log-sheet";
import { useDj } from "./i18n";

export function DegreeJourneyView({ roadmap, progress }: { roadmap: StudentRoadmapView; progress: StudentDegreeProgressView | null }) {
  const { t } = useDj();
  const buckets = useMemo(() => splitCourses(roadmap), [roadmap]);
  const credits = useMemo(() => buildCreditsBySource(roadmap, progress), [roadmap, progress]);
  const warnings = useMemo(() => buildWarnings(roadmap, progress), [roadmap, progress]);
  const byKey = useMemo(() => itemsByKey(roadmap), [roadmap]);
  // Work all in (graded or sent): shown as "waiting", not as something to act on.
  const waiting = useMemo(() => buckets.now.filter((i) => i.taskCounts.total > 0 && i.taskCounts.graded + i.taskCounts.submitted === i.taskCounts.total), [buckets]);
  const actNow = useMemo(() => buckets.now.filter((i) => !waiting.includes(i)), [buckets, waiting]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  // Everything the student can still report on: Now first, then Up next.
  const loggable = useMemo(() => [...buckets.now, ...buckets.upNext].filter((i) => i.canReport), [buckets]);
  const openLog = (key: string | null, el: HTMLElement | null) => {
    trigger.current = el;
    setSelected(key ?? loggable[0]?.key ?? null);
    setSheetOpen(true);
  };

  const title = primaryObjectiveTitle(roadmap) ?? roadmap.plan?.title ?? t("dj.title");
  return (
    <StudentSurface testId="roadmap-page">
      <div className="mx-auto w-full max-w-6xl space-y-8" data-state="PUBLISHED" data-view="degree-journey">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 max-w-2xl space-y-2">
            <Eyebrow>{title}</Eyebrow>
            <h1 className="break-words font-serif text-3xl leading-tight tracking-tight text-student-ink sm:text-5xl" data-testid="text-page-title">{t("dj.eyebrow")}</h1>
            <p className="text-sm text-student-muted">{t("dj.subtitle")}</p>
            <p className="text-sm text-student-muted">
              {t("dj.flightDeck")}{" "}
              <Link href={FLIGHT_DECK_PATH} className="font-medium text-student-gold-ink underline underline-offset-4" data-testid="link-flight-deck">{t("dj.flightDeckLink")}</Link>
              <ArrowRight className="ml-1 inline h-3.5 w-3.5 text-student-gold-ink" aria-hidden="true" />
            </p>
          </div>
          <button type="button" className={buttonClass.primary} onClick={(e) => openLog(null, e.currentTarget)} data-testid="button-log-progress">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("dj.logProgress")}
          </button>
        </header>

        <CreditsCard data={credits} />
        <RequirementsCard progress={progress} />
        <WarningsCard warnings={warnings} />
        <NowSection items={actNow} onLog={(key, el) => openLog(key, el)} />
        <WaitingSection items={waiting} />
        <UpNextSection items={buckets.upNext} startNumber={actNow.length + 1} titleOf={(k) => byKey.get(k)?.title ?? null} />
        <CompletedSection items={buckets.completed} />
      </div>

      <LogSheet open={sheetOpen} onOpenChange={setSheetOpen} items={loggable} selectedKey={selected} onSelect={setSelected} returnFocusTo={trigger.current} />
    </StudentSurface>
  );
}
