/** Roadmap-specific states: not yet published. */
import React from "react";
import { Link } from "wouter";
import { ArrowRight, Hourglass } from "lucide-react";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
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
  return (
    <div className="space-y-8" data-testid="roadmap-not-published">
      <section aria-labelledby="not-published-title" id="section-today" className={`${cardClass} scroll-mt-28 space-y-3 sm:p-8`}>
        <Hourglass className="h-7 w-7 text-student-gold-ink" aria-hidden="true" />
        <Eyebrow>Almost there</Eyebrow>
        <h2 id="not-published-title" className="font-serif text-2xl text-student-ink sm:text-3xl">
          Lumière is preparing your roadmap
        </h2>
        <p className="max-w-xl text-sm leading-relaxed text-student-muted">
          Your advisor is building your personalised route to graduation. It will appear here as soon as it is
          published, and you do not need to do anything until then. Your starting point is already on record.
        </p>
        {foundationLink && (
          <Link href={FOUNDATION_HREF} className={buttonClass.link} data-testid="link-foundation">
            See your starting point on the Flight Deck <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </section>
      {showFoundation && <FoundationSection foundation={view.foundation} requirementDetails={requirementDetails} />}
    </div>
  );
}
