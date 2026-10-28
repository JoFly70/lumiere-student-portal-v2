/** Prior education and transfer-credit claims. A claim is never credit; only the school's decision counts. */
import React from "react";
import { History } from "lucide-react";
import type { StudentHighSchoolView } from "@shared/high-school-contract";
import { claimAcceptedLabel, claimStatusView, cleanCourseTitle, creditsLabel, priorEducationStatusLabel, recordedTransferTitles, type ClaimView } from "@/pages/high-school-presentation";
import { useT } from "@/i18n";
import { StatusPill } from "@/components/student-progress/student-ui";
import { Panel } from "./hs-ui";

export function PriorEducationCard({ items, subjects = [] }: { items: StudentHighSchoolView["priorEducation"]; subjects?: StudentHighSchoolView["subjects"] }) {
  const { t, language } = useT();
  const recorded = recordedTransferTitles(subjects);
  return (
    <Panel title={t("hs.priorCard.title")} headingId="hs-prior" testId="prior-education">
      <p className="flex items-start gap-2 text-sm leading-relaxed text-student-muted">
        <History className="mt-0.5 h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />
        <span>{t("hs.priorCard.intro")}</span>
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-student-muted" data-testid="prior-empty">{t("hs.priorCard.empty")}</p>
      ) : (
        <ul className="space-y-3" data-testid="prior-list">
          {items.map((p) => (
            <li key={p.id} className="space-y-2 rounded-xl border border-student-line p-3">
              <p className="text-sm font-semibold text-student-ink">{p.schoolLabel}</p>
              <p className="text-xs text-student-muted">{priorEducationStatusLabel(p.status, language)}</p>
              {p.claims.length > 0 && (
                <ul className="divide-y divide-student-line" aria-label={t("hs.priorCard.claimedFrom", { school: p.schoolLabel })}>
                  {p.claims.map((c) => {
                    const claim: ClaimView = c;
                    const isRecorded = recorded.has(cleanCourseTitle(c.courseTitle).toLowerCase());
                    const st = claimStatusView(c.status, isRecorded, language);
                    const accepted = claimAcceptedLabel(claim, language);
                    return (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2" data-testid="claim-row" data-claim-status={c.status}>
                        <span className="min-w-0 text-sm text-student-ink">
                          {c.courseTitle} <span className="text-student-muted">· {t("hs.priorCard.claimed", { credits: creditsLabel(c.claimedHalfUnits, language) })}</span>
                          {accepted && <span className="block text-xs text-student-muted" data-testid="claim-accepted">{accepted}</span>}
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
