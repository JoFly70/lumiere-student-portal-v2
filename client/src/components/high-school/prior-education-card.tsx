/** Prior education and transfer-credit claims. A claim is never credit; only the school's decision counts. */
import React from "react";
import { History } from "lucide-react";
import type { StudentHighSchoolView } from "@shared/high-school-contract";
import { creditsLabel, claimStatusView, priorEducationStatusLabel } from "@/pages/high-school-presentation";
import { StatusPill } from "@/components/student-progress/student-ui";
import { Panel } from "./hs-ui";

export function PriorEducationCard({ items }: { items: StudentHighSchoolView["priorEducation"] }) {
  return (
    <Panel title="Earlier schooling" headingId="hs-prior" testId="prior-education">
      <p className="flex items-start gap-2 text-sm leading-relaxed text-student-muted">
        <History className="mt-0.5 h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />
        <span>Courses you took before can sometimes transfer. They count as credit only after your school accepts them.</span>
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-student-muted" data-testid="prior-empty">No earlier schooling has been reported. Tell Lumière if you studied somewhere else before.</p>
      ) : (
        <ul className="space-y-3" data-testid="prior-list">
          {items.map((p) => (
            <li key={p.id} className="space-y-2 rounded-xl border border-student-line p-3">
              <p className="text-sm font-semibold text-student-ink">{p.schoolLabel}</p>
              <p className="text-xs text-student-muted">{priorEducationStatusLabel(p.status)}</p>
              {p.claims.length > 0 && (
                <ul className="divide-y divide-student-line" aria-label={`Courses claimed from ${p.schoolLabel}`}>
                  {p.claims.map((c) => {
                    const st = claimStatusView(c.status);
                    return (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2" data-testid="claim-row" data-claim-status={c.status}>
                        <span className="text-sm text-student-ink">
                          {c.courseTitle} <span className="text-student-muted">· claimed {creditsLabel(c.claimedHalfUnits)}</span>
                        </span>
                        <StatusPill status={st.key} label={st.label} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
