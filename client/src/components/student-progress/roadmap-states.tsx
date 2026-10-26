/** Roadmap-specific states: not yet published, and the skeleton for the new layout. */
import React from "react";
import { Hourglass } from "lucide-react";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import { FoundationSection } from "./foundation-section";
import { cardClass } from "./student-ui";

export function RoadmapNotPublished({
  view,
  requirementDetails,
  showFoundation = true,
}: {
  view: StudentRoadmapView;
  requirementDetails?: React.ReactNode;
  showFoundation?: boolean;
}) {
  return (
    <div className="space-y-8" data-testid="roadmap-not-published">
      <section aria-labelledby="not-published-title" id="section-today" className={`${cardClass} scroll-mt-28 space-y-3 sm:p-8`}>
        <Hourglass className="h-7 w-7 text-student-gold-ink" aria-hidden="true" />
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-student-gold-ink">Almost there</p>
        <h2 id="not-published-title" className="font-serif text-2xl text-student-ink sm:text-3xl">
          Lumière is preparing your roadmap
        </h2>
        <p className="max-w-xl text-sm leading-relaxed text-student-muted">
          Your advisor is building your personalised route to graduation. It will appear here as soon as it is
          published, and you do not need to do anything until then. Your starting point is already on record below.
        </p>
      </section>
      {showFoundation && <FoundationSection foundation={view.foundation} requirementDetails={requirementDetails} />}
    </div>
  );
}
