/** "My Graduation": requirements, the school's completion review, transcript and diploma. */
import React from "react";
import { Link } from "wouter";
import { ArrowRight, Check, FileText, GraduationCap, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatHalfUnits } from "@shared/high-school-contract";
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
import { StatusPill, buttonClass } from "@/components/student-progress/student-ui";
import { useHsActions } from "./hs-actions";
import { Meter, Panel } from "./hs-ui";
import type { TabProps } from "./journey-tab";
import { FamilyCard } from "./family-card";
import { PriorEducationCard } from "./prior-education-card";

/** A requirement row: a small progress badge ("9 of 16", "13 left") or a check, never an empty circle that looks like a radio. */
function Row({ done, label, badge, value, testId }: { done: boolean; label: string; badge: string; value: React.ReactNode; testId?: string }) {
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
      <span className="sr-only">{done ? "Complete" : "Not complete yet"}</span>
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
  const g = view.graduation;
  const actions = useHsActions();
  const review = reviewStatusView(g);
  const requirements = creditRequirementRows(view);
  const transcript = transcriptRequestState(g);
  const fin = g.financialClearance === null ? null : financialClearanceView(g.financialClearance);
  const conferred = g.status === "diploma_conferred";
  const confirmed = formatShortDate(g.eligibilityConfirmedAt ? g.eligibilityConfirmedAt.slice(0, 10) : null);
  const conferredOn = formatShortDate(g.diploma.conferredOn);
  const outstanding = outstandingWorkLabel(g);
  return (
    <div className="space-y-4 sm:space-y-6" data-testid="tab-graduation">
      <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-2">
        <Panel title={requirementsTitle(conferred)} headingId="hs-grad-reqs" testId="graduation-requirements">
          <ul className="divide-y divide-student-line">
            {requirements.map((r) => (
              <Row
                key={r.id}
                done={r.satisfied}
                label={r.label}
                testId={`req-${r.id}`}
                badge={r.satisfied ? "Done" : `${formatHalfUnits(r.earned)} of ${formatHalfUnits(r.required)}`}
                value={
                  <div className="mt-1 space-y-1.5">
                    <span className="text-student-ink">{creditsOfLabel(r.earned, r.required)} (official)</span>
                    <Meter value={r.earned} total={r.required} label={`${r.label} official credits`} />
                  </div>
                }
              />
            ))}
            <Row done={outstanding === null} label="Exams and written projects" testId="req-work" badge={outstanding === null ? "Done" : `${g.outstandingExams + g.outstandingProjects} left`} value={outstanding === null ? "All required exams and projects are official." : `${outstanding}.`} />
          </ul>
        </Panel>

        <Panel title="Completion review" headingId="hs-grad-review" testId="completion-review">
          {conferred ? (
            <p className="text-sm text-student-ink" data-testid="eligibility-date">{confirmed ? `Eligibility confirmed on ${confirmed}.` : "Eligibility confirmed by your school."}</p>
          ) : (
            <>
              <StatusPill status={review.key} label={review.label} data-testid="review-status" />
              <p className="text-sm leading-relaxed text-student-muted">{review.detail}</p>
              {confirmed && <p className="text-sm text-student-ink" data-testid="eligibility-date">Eligibility confirmed on {confirmed}.</p>}
            </>
          )}
          {fin !== null && (
            <div className="space-y-1.5 border-t border-student-line pt-3" data-testid="financial-clearance">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-student-muted">Financial clearance</p>
              <StatusPill status={fin.key} label={fin.label} data-testid="financial-status" />
              <p className="text-sm text-student-muted">{fin.detail}</p>
            </div>
          )}
        </Panel>

        <Panel title="Official transcript" headingId="hs-grad-transcript" testId="transcript-card">
          <p className="flex items-center gap-2 text-sm text-student-ink" data-testid="transcript-status">
            <ScrollText className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
            {transcript.statusLabel}
          </p>
          {transcript.enabled && (
            <button type="button" className={cn(buttonClass.primary, "disabled:opacity-100")} aria-disabled={actions.transcriptPending} aria-describedby="hs-transcript-reason" onClick={() => { if (!actions.transcriptPending) void actions.requestTranscript(); }} data-testid="button-request-transcript">
              {actions.transcriptPending ? "Sending…" : "Request my transcript"}
            </button>
          )}
          <p id="hs-transcript-reason" className="text-sm text-student-muted" data-testid="transcript-reason">{transcript.reason}</p>
          {g.transcript.documentId && <DocumentsLink testId="link-documents-transcript" label="Open transcript in Documents" />}
        </Panel>

        <Panel title="Diploma" headingId="hs-grad-diploma" testId="diploma-card">
          {conferred ? (
            <>
              <p className="flex items-center gap-2 text-sm font-medium text-student-ink" data-testid="diploma-status">
                <GraduationCap className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
                Diploma conferred{conferredOn ? ` on ${conferredOn}` : ""}
              </p>
              <p className="text-sm text-student-muted" data-testid="diploma-delivery">{deliveryLabel(g.diploma.status)}</p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm font-medium text-student-ink" data-testid="diploma-status">
                <GraduationCap className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
                {diplomaDeliveryLabel(g.diploma)}
              </p>
              <p className="text-sm text-student-muted">Only your school can issue your diploma. Lumière will tell you here when it moves forward.</p>
            </>
          )}
          {g.diploma.documentId && <DocumentsLink testId="link-documents-diploma" label="Open diploma in Documents" />}
        </Panel>
      </div>

      <section className="space-y-3 pt-2 sm:space-y-4" aria-labelledby="hs-your-file" data-testid="your-file">
        <h3 id="hs-your-file" className="font-serif text-2xl tracking-tight text-student-ink">Your file</h3>
        <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-2">
          <PriorEducationCard items={view.priorEducation} subjects={view.subjects} />
          <FamilyCard guardians={view.guardians} />
        </div>
      </section>
    </div>
  );
}
