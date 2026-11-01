/** Roadmap-specific states: not yet published. */
import React from "react";
import { Link } from "wouter";
import { ArrowRight, Hourglass } from "lucide-react";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import { useT } from "@/i18n";
import { FOUNDATION_HREF } from "@/pages/student-roadmap-presentation";
import { FoundationSection } from "./foundation-section";
import { Eyebrow, buttonClass, cardClass } from "./student-ui";

/**
 * "Preparing your roadmap". On the Flight Deck the foundation (which Lumière
 * already holds) is shown in full below it; on the Roadmap page it is a link,
 * because the Flight Deck owns that detail.
 */
export function RoadmapNotPublished({
  view,
  requirementDetails,
  showFoundation = true,
  foundationLink = false,
}: {
  view: StudentRoadmapView;
  requirementDetails?: React.ReactNode;
  showFoundation?: boolean;
  foundationLink?: boolean;
}) {
  const { t } = useT();
  return (
    <div className="space-y-8" data-testid="roadmap-not-published">
      <section aria-labelledby="not-published-title" id="section-today" className={`${cardClass} scroll-mt-28 space-y-3 sm:p-8`}>
        <Hourglass className="h-7 w-7 text-student-gold-ink" aria-hidden="true" />
        <Eyebrow>{t("s32.state.notReady.eyebrow")}</Eyebrow>
        <h2 id="not-published-title" className="font-serif text-2xl text-student-ink sm:text-3xl">
          {t("s32.state.notPublished.title")}
        </h2>
        <p className="max-w-xl text-sm leading-relaxed text-student-muted">
          {t("s32.state.notPublished.body")}
        </p>
        {foundationLink && (
          <Link href={FOUNDATION_HREF} className={buttonClass.link} data-testid="link-foundation">
            {t("s32.state.notPublished.foundation")} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </section>
      {showFoundation && <FoundationSection foundation={view.foundation} requirementDetails={requirementDetails} />}
    </div>
  );
}
