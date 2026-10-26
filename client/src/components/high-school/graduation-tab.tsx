/** "My Graduation": requirements, the school's completion review, transcript and diploma. */
import React from "react";
import { Link } from "wouter";
import { ArrowRight, Check, Circle, FileText, GraduationCap, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatShortDate } from "@/pages/student-roadmap-presentation";
import {
  creditRequirementRows,
  creditsOfLabel,
  deliveryLabel,
  diplomaDeliveryLabel,
  financialClearanceView,
  reviewStatusView,
  transcriptRequestState,
} from "@/pages/high-school-presentation";
import { StatusPill, buttonClass } from "@/components/student-progress/student-ui";
import { useHsActions } from "./hs-actions";
import { Meter, Panel } from "./hs-ui";
import type { TabProps } from "./journey-tab";

function Row({ done, label, value, testId }: { done: boolean; label: string; value: React.ReactNode; testId?: string }) {
  const Icon = done ? Check : Circle;
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0" data-testid={testId} data-done={done}>
      <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border", done ? "border-st-applied bg-st-applied text-student-card" : "border-dashed border-student-line-strong text-student-muted")}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-student-ink">{label}</p>
        <div className="text-sm text-student-muted">{value}</div>
      </div>
      <span className="sr-only">{done ? "Complete" : "Not complete yet"}</span>
    </li>
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
  return (
    <div className="space-y-4 sm:space-y-6" data-testid="tab-graduation">
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
        <Panel title="What you need to graduate" headingId="hs-grad-reqs" testId="graduation-requirements" className="lg:col-span-3">
          <ul className="divide-y divide-student-line">
            {requirements.map((r) => (
              <Row
                key={r.id}
                done={r.satisfied}
                label={r.label}
                testId={`req-${r.id}`}
                value={
                  <div className="mt-1 space-y-1.5">
                    <span className="text-student-ink">{creditsOfLabel(r.earned, r.required)} (official)</span>
                    <Meter value={r.earned} total={r.required} label={`${r.label} official credits`} />
                  </div>
                }
              />
            ))}
            <Row done={g.outstandingExams === 0} label="Exams" testId="req-exams" value={g.outstandingExams === 0 ? "All required exams are official." : `${g.outstandingExams} ${g.outstandingExams === 1 ? "exam is" : "exams are"} still outstanding.`} />
            <Row done={g.outstandingProjects === 0} label="Written projects" testId="req-projects" value={g.outstandingProjects === 0 ? "All required projects are official." : `${g.outstandingProjects} ${g.outstandingProjects === 1 ? "project is" : "projects are"} still outstanding.`} />
          </ul>
        </Panel>

        <div className="space-y-4 sm:space-y-6 lg:col-span-2">
          <Panel title="Completion review" headingId="hs-grad-review" testId="completion-review">
            <StatusPill status={review.key} label={review.label} data-testid="review-status" />
            <p className="text-sm leading-relaxed text-student-muted">{review.detail}</p>
            {confirmed && <p className="text-sm text-student-ink">Confirmed on {confirmed}.</p>}
          </Panel>

          <Panel title="Financial clearance" headingId="hs-grad-fin" testId="financial-clearance">
            {fin === null ? (
              <p className="text-sm text-student-muted" data-testid="financial-unavailable">
                Not available here — ask Lumière.{" "}
                <Link href="/support" className="inline-flex min-h-[44px] items-center font-medium text-student-gold-ink underline underline-offset-4">Contact Support</Link>
              </p>
            ) : (
              <>
                <StatusPill status={fin.key} label={fin.label} data-testid="financial-status" />
                <p className="text-sm text-student-muted">{fin.detail}</p>
              </>
            )}
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <Panel title="Official transcript" headingId="hs-grad-transcript" testId="transcript-card">
          <p className="flex items-center gap-2 text-sm text-student-ink" data-testid="transcript-status">
            <ScrollText className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
            {transcript.statusLabel}
          </p>
          {g.transcript.status === "not_requested" ? (
          <button
              type="button"
              className={buttonClass.primary}
              disabled={!transcript.enabled || actions.transcriptPending}
              aria-describedby="hs-transcript-reason"
              onClick={() => void actions.requestTranscript()}
              data-testid="button-request-transcript"
            >
              {actions.transcriptPending ? "Sending…" : "Request my transcript"}
            </button>
          ) : null}
          <p id="hs-transcript-reason" className="text-sm text-student-muted" data-testid="transcript-reason">{transcript.reason}</p>
        </Panel>

        <Panel title="Diploma" headingId="hs-grad-diploma" testId="diploma-card">
          <p className="flex items-center gap-2 text-sm font-medium text-student-ink" data-testid="diploma-status">
            <GraduationCap className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
            {diplomaDeliveryLabel(g.diploma)}
          </p>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs uppercase tracking-[0.1em] text-student-muted">Conferred</dt><dd className="font-medium text-student-ink">{conferredOn ?? "Not yet"}</dd></div>
            <div><dt className="text-xs uppercase tracking-[0.1em] text-student-muted">Delivery</dt><dd className="font-medium text-student-ink">{deliveryLabel(g.diploma.status)}</dd></div>
          </dl>
          <p className="text-sm text-student-muted">Only your school can issue your diploma. Lumière will tell you here when it moves forward.</p>
        </Panel>
      </div>

      <Panel title="Official files" headingId="hs-grad-docs" testId="official-files">
        <p className="text-sm text-student-muted">
          Your diploma and transcript files live in Documents, the same place as the rest of your records. {conferred || g.transcript.documentId || g.diploma.documentId ? "Look for the files the school issued." : "They appear there once the school issues them."}
        </p>
        <Link href="/documents" className={buttonClass.outline} data-testid="link-documents">
          <FileText className="h-4 w-4" aria-hidden="true" />
          Open Documents
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </Panel>
    </div>
  );
}
