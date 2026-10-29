/**
 * S27 Profile: "Your agreement" card (dates and deadlines from the student journey). Rendered only when the journey
 * has an agreement; there are no notification switches because no preference API exists for them.
 */
import React from "react";
import type { StudentJourneyView } from "@shared/s27-contract";
import { useS27T } from "@/lib/s27/i18n-util";
import "@/styles/student-s27.css";
import "@/styles/student-s27-extra.css";

export function AgreementCard({ journey }: { journey: StudentJourneyView | null }) {
  const { t, lang } = useS27T();
  const a = journey?.agreement;
  if (!a) return null;
  const day = (iso: string | null) => (iso ? formatFull(iso, lang) : t("s27.prof.notSet"));
  return (
    <div className="s27" data-testid="profile-agreement">
      <div className="inner">
        <section className="card" aria-labelledby="agr-h">
          <h2 id="agr-h" className="h2s">{t("s27.prof.agreement")}</h2>
          <div className="lines">
            <div><span>{t("s27.prof.signed")}</span><span>{day(a.signedOn)}</span></div>
            <div><span>{t("s27.prof.activated")}</span><span>{day(a.activatedOn)}</span></div>
            <div><span>{t("s27.prof.supportUntil")}</span><span>{a.supportEndsOn ? t("s27.prof.supportMonths", { date: formatFull(a.supportEndsOn, lang), n: a.supportMonths }) : t("s27.prof.notSet")}</span></div>
            <div><span>{t("s27.prof.accessUntil")}</span><span>{a.accessEndsOn ? t("s27.prof.accessMonths", { date: formatFull(a.accessEndsOn, lang), n: a.accessMonths }) : t("s27.prof.notSet")}</span></div>
            {a.deadlines.map((d) => (
              <div key={d.key}>
                <span>{d.label}</span>
                <span>
                  {d.status === "done" ? t("s27.prof.deadline.done", { rule: d.rule })
                    : d.status === "waived" ? t("s27.prof.deadline.waived", { rule: d.rule })
                    : d.dueOn ? t("s27.prof.deadline.open", { rule: d.rule, date: formatFull(d.dueOn, lang) }) : d.rule}
                </span>
              </div>
            ))}
            <div><span>{t("s27.prof.sessions")}</span><span>{t("s27.prof.sessionsVal", { used: a.orientationSessionsUsed, n: a.orientationSessionsIncluded })}</span></div>
            {a.goal && <div><span>{t("s27.prof.goal")}</span><span>{a.goal.field} · {a.goal.region}</span></div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function formatFull(iso: string, lang: "en" | "fr"): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}
