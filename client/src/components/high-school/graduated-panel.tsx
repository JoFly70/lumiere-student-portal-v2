/**
 * Graduated state for the default course page (and reusable on the Flight Deck): the existing congratulations banner
 * plus the existing transcript request / link, so a graduate does not need the ?view=details page. Reuses the same
 * presentation helper, action context and keys as the Graduation tab; adds no new flow.
 */
import React from "react";
import { Link } from "wouter";
import { ArrowRight, FileText, ScrollText } from "lucide-react";
import type { StudentHighSchoolView } from "@shared/high-school-contract";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { buttonClass } from "@/components/student-progress/student-ui";
import { transcriptRequestState } from "@/pages/high-school-presentation";
import { useHsActions } from "./hs-actions";
import { GraduatedBanner } from "./high-school-view";

export function isHsGraduated(view: Pick<StudentHighSchoolView, "graduation">): boolean {
  return view.graduation.status === "diploma_conferred";
}

export function GraduatedPanel({ view }: { view: StudentHighSchoolView }) {
  const { t, language } = useT();
  const actions = useHsActions();
  const g = view.graduation;
  if (!isHsGraduated(view)) return null;
  const transcript = transcriptRequestState(g, language);
  return (
    <div className="space-y-3" data-testid="graduated-panel">
      <GraduatedBanner view={view} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-student-line bg-student-card px-4 py-3" data-testid="graduated-transcript">
        <p className="flex items-center gap-2 text-sm text-student-ink" data-testid="graduated-transcript-status">
          <ScrollText className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
          <span className="font-semibold">{t("hs.grad.transcript")}</span> · {transcript.statusLabel}
        </p>
        {transcript.enabled && (
          <button type="button" className={cn(buttonClass.primary, "disabled:opacity-100")} aria-disabled={actions.transcriptPending} onClick={() => { if (!actions.transcriptPending) void actions.requestTranscript(); }} data-testid="button-request-transcript">
            {actions.transcriptPending ? t("hs.grad.sending") : t("hs.grad.requestTranscript")}
          </button>
        )}
        {g.transcript.documentId && (
          <Link href="/documents" className={buttonClass.outline} data-testid="link-documents-transcript">
            <FileText className="h-4 w-4" aria-hidden="true" />
            {t("hs.grad.openTranscript")}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
        {!transcript.enabled && <p className="basis-full text-sm text-student-muted" data-testid="graduated-transcript-reason">{transcript.reason}</p>}
      </div>
    </div>
  );
}
