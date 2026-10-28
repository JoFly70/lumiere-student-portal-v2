/** "My Graduation": requirements, the school's completion review, transcript and diploma. */
import React from "react";
import { Link } from "wouter";
import { ArrowRight, Check, FileText, GraduationCap, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatShortDate } from "@/pages/student-roadmap-presentation";
import {
  creditRequirementRows,
  creditsOfLabel,
  deliveryLabel,
  diplomaDeliveryLabel,
  financialClearanceView,
  outstandingWorkLabel,
  requirementsTitle,
  reviewStatusView,
  transcriptRequestState,
} from "@/pages/high-school-presentation";
import { useT } from "@/i18n";
import { StatusPill, buttonClass } from "@/components/student-progress/student-ui";
import { useHsActions } from "./hs-actions";
import { Meter, Panel } from "./hs-ui";
import type { TabProps } from "./journey-tab";
import { FamilyCard } from "./family-card";
import { PriorEducationCard } from "./prior-education-card";

/** A requirement row: a small progress badge ("9 of 16", "13 left") or a check, never an empty circle that looks like a radio. */
function Row({ done, label, badge, value, testId }: { done: boolean; label: string; badge: string; value: React.ReactNode; testId?: string }) {
  const { t } = useT();
  return (
    <li className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0" data-testid={testId} data-done={done}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-student-ink">{label}</p>
        <div className="text-sm text-student-muted">{value}</div>
      </div>
      <span
        className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums", done ? "bg-st-applied-soft text-st-applied" : "bg-student-bg text-student-ink ring-1 ring-inset ring-student-line-strong")}
        data-testid={testId ? `${testId}-badge` : undefined}
      >
        {done && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
        {badge}
      </span>
      <span className="sr-only">{done ? t("hs.grad.complete") : t("hs.grad.incomplete")}</span>
    </li>
  );
}

function DocumentsLink({ testId, label }: { testId: string; label: string }) {
  return (
    <Link href="/documents" className={buttonClass.outline} data-testid={testId}>
      <FileText className="h-4 w-4" aria-hidden="true" />
      {label}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

export function GraduationTab({ view }: TabProps) {
  const { t, language, formatCredits } = useT();
  const g = view.graduation;
  const actions = useHsActions();
  const review = reviewStatusView(g, language);
  const requirements = creditRequirementRows(view, language);
  const transcript = transcriptRequestState(g, language);
  const fin = g.financialClearance === null ? null : financialClearanceView(g.financialClearance, language);
  const conferred = g.status === "diploma_conferred";
  const confirmed = formatShortDate(g.eligibilityConfirmedAt ? g.eligibilityConfirmedAt.slice(0, 10) : null, language);
  const conferredOn = formatShortDate(g.diploma.conferredOn, language);
  const outstanding = outstandingWorkLabel(g, language);
  return (
    <div className="space-y-4 sm:space-y-6" data-testid="tab-graduation">
      <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-2">
        <Panel title={requirementsTitle(conferred, language)} headingId="hs-grad-reqs" testId="graduation-requirements">
          <ul className="divide-y divide-student-line">
            {requirements.map((r) => (
              <Row
                key={r.id}
                done={r.satisfied}
                label={r.label}
                testId={`req-${r.id}`}
                badge={r.satisfied ? t("hs.grad.done") : t("hs.grad.badgeOf", { earned: formatCredits(r.earned), required: formatCredits(r.required) })}
                value={
                  <div className="mt-1 space-y-1.5">
                    <span className="text-student-ink">{t("hs.grad.officialSuffix", { label: creditsOfLabel(r.earned, r.required, language) })}</span>
                    <Meter value={r.earned} total={r.required} label={t("hs.subjects.officialCredits", { label: r.label })} />
                  </div>
                }
              />
            ))}
            <Row done={outstanding === null} label={t("hs.grad.examsProjects")} testId="req-work" badge={outstanding === null ? t("hs.grad.done") : t("hs.grad.left", { n: g.outstandingExams + g.outstandingProjects })} value={outstanding === null ? t("hs.grad.allWorkOfficial") : `${outstanding}.`} />
          </ul>
        </Panel>

        <Panel title={t("hs.grad.review")} headingId="hs-grad-review" testId="completion-review">
          {conferred ? (
            <p className="text-sm text-student-ink" data-testid="eligibility-date">{confirmed ? t("hs.grad.eligibleOn", { date: confirmed }) : t("hs.grad.eligible")}</p>
          ) : (
            <>
              <StatusPill status={review.key} label={review.label} data-testid="review-status" />
              <p className="text-sm leading-relaxed text-student-muted">{review.detail}</p>
              {confirmed && <p className="text-sm text-student-ink" data-testid="eligibility-date">{t("hs.grad.eligibleOn", { date: confirmed })}</p>}
            </>
          )}
          {fin !== null && (
            <div className="space-y-1.5 border-t border-student-line pt-3" data-testid="financial-clearance">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-student-muted">{t("hs.grad.financial")}</p>
              <StatusPill status={fin.key} label={fin.label} data-testid="financial-status" />
              <p className="text-sm text-student-muted">{fin.detail}</p>
            </div>
          )}
        </Panel>

        <Panel title={t("hs.grad.transcript")} headingId="hs-grad-transcript" testId="transcript-card">
          <p className="flex items-center gap-2 text-sm text-student-ink" data-testid="transcript-status">
            <ScrollText className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
            {transcript.statusLabel}
          </p>
          {transcript.enabled && (
            <button type="button" className={cn(buttonClass.primary, "disabled:opacity-100")} aria-disabled={actions.transcriptPending} aria-describedby="hs-transcript-reason" onClick={() => { if (!actions.transcriptPending) void actions.requestTranscript(); }} data-testid="button-request-transcript">
              {actions.transcriptPending ? t("hs.grad.sending") : t("hs.grad.requestTranscript")}
            </button>
          )}
          <p id="hs-transcript-reason" className="text-sm text-student-muted" data-testid="transcript-reason">{transcript.reason}</p>
          {g.transcript.documentId && <DocumentsLink testId="link-documents-transcript" label={t("hs.grad.openTranscript")} />}
        </Panel>

        <Panel title={t("hs.grad.diploma")} headingId="hs-grad-diploma" testId="diploma-card">
          {conferred ? (
            <>
              <p className="flex items-center gap-2 text-sm font-medium text-student-ink" data-testid="diploma-status">
                <GraduationCap className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
                {conferredOn ? t("hs.grad.diplomaOn", { date: conferredOn }) : t("hs.grad.diplomaConferred")}
              </p>
              <p className="text-sm text-student-muted" data-testid="diploma-delivery">{deliveryLabel(g.diploma.status, language)}</p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm font-medium text-student-ink" data-testid="diploma-status">
                <GraduationCap className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
                {diplomaDeliveryLabel(g.diploma, language)}
              </p>
              <p className="text-sm text-student-muted">{t("hs.grad.onlySchool")}</p>
            </>
          )}
          {g.diploma.documentId && <DocumentsLink testId="link-documents-diploma" label={t("hs.grad.openDiploma")} />}
        </Panel>
      </div>

      <section className="space-y-3 pt-2 sm:space-y-4" aria-labelledby="hs-your-file" data-testid="your-file">
        <h3 id="hs-your-file" className="font-serif text-2xl tracking-tight text-student-ink">{t("hs.grad.yourFile")}</h3>
        <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-2">
          <PriorEducationCard items={view.priorEducation} subjects={view.subjects} />
          <FamilyCard guardians={view.guardians} />
        </div>
      </section>
    </div>
  );
}
