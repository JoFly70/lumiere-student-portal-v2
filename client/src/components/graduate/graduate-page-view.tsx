/**
 * Prop-driven "My Master's" page. Pages feed it a StudentGraduateView; edits go
 * through GraduateActionsContext, so it renders from fixtures with no network.
 */
import React, { useState } from "react";
import { Link } from "wouter";
import { AlertCircle, GraduationCap, LifeBuoy } from "lucide-react";
import type { EvaluationView, StudentGraduateProgramView, StudentGraduateView } from "@shared/graduate-program-contract";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { StudentSurface, buttonClass, cardClass } from "@/components/student-progress/student-ui";
import { GraduateHeader, GraduateSectionNav } from "./graduate-header";
import { ModulesSection } from "./graduate-modules";
import { PreviousLearningSection } from "./graduate-learning";
import { ThesisSection } from "./graduate-thesis";
import { AssessmentSection, CreditsSection } from "./graduate-assessment-credits";
import { GraduationSection } from "./graduate-graduation";
import { EvaluationsSection } from "./graduate-evaluations";
import { showEvaluations } from "./graduate-presentation";

export function ProgramSwitcher({ programs, selectedId, onSelect }: { programs: readonly StudentGraduateProgramView[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <div role="tablist" aria-label="Your graduate programmes" className="flex flex-wrap gap-2" data-testid="program-switcher">
      {programs.map((p) => {
        const selected = p.programId === selectedId;
        return (
          <button
            key={p.programId}
            type="button"
            role="tab"
            id={`tab-${p.programId}`}
            aria-selected={selected}
            aria-controls={`panel-${p.programId}`}
            onClick={() => onSelect(p.programId)}
            className={cn(
              "inline-flex min-h-[44px] max-w-full items-center rounded-full border px-4 text-left text-sm font-medium",
              selected ? "border-student-seal bg-student-seal text-student-seal-ink" : "border-student-line-strong bg-student-card text-student-ink hover:bg-student-gold-soft",
            )}
          >
            <span className="truncate">{p.title}</span>
            <span className="ml-2 shrink-0 text-xs opacity-75">{p.cohortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

export function GraduateProgramPanel({ program, evaluations = [] }: { program: StudentGraduateProgramView; evaluations?: readonly EvaluationView[] }) {
  const evals = showEvaluations(program, evaluations);
  return (
    <div className="space-y-8 sm:space-y-10" data-testid="graduate-program" data-route={program.route}>
      <GraduateHeader program={program} />
      <GraduateSectionNav program={program} evaluationsShown={evals} />
      <ModulesSection program={program} />
      {program.previousLearning && <PreviousLearningSection learning={program.previousLearning} />}
      {program.thesis && <ThesisSection programId={program.programId} thesis={program.thesis} />}
      <AssessmentSection assessment={program.assessment} />
      {program.graduation && <GraduationSection graduation={program.graduation} />}
      {evals && <EvaluationsSection evaluations={evaluations} university={program.route === "eneb_unimarconi"} />}
      <CreditsSection program={program} />
      <aside className={cn(cardClass, "flex flex-wrap items-center justify-between gap-3")} data-testid="graduate-help">
        <p className="flex items-center gap-2 text-sm text-student-ink">
          <LifeBuoy className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
          Need to send a document or change your details?
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/documents" className={buttonClass.outline}>Documents</Link>
          <Link href="/profile" className={buttonClass.outline}>My profile</Link>
          <Link href="/support" className={buttonClass.outline} data-testid="support-link">Ask about my Master's</Link>
        </div>
      </aside>
    </div>
  );
}

export function GraduatePageView({ view }: { view: StudentGraduateView }) {
  const [selected, setSelected] = useState<string | null>(null);
  if (view.programs.length === 0) return <GraduateEmptyState />;
  const program = view.programs.find((p) => p.programId === selected) ?? view.programs[0];
  return (
    <StudentSurface testId="page-student-graduate">
      <div className="mx-auto max-w-5xl space-y-6 pb-6 pt-2 sm:pt-4">
        {view.programs.length > 1 && <ProgramSwitcher programs={view.programs} selectedId={program.programId} onSelect={setSelected} />}
        <div role={view.programs.length > 1 ? "tabpanel" : undefined} id={`panel-${program.programId}`} aria-labelledby={view.programs.length > 1 ? `tab-${program.programId}` : undefined}>
          <GraduateProgramPanel key={program.programId} program={program} evaluations={view.evaluations ?? []} />
        </div>
      </div>
    </StudentSurface>
  );
}

// ---------------------------------------------------------------------------
// Page states
// ---------------------------------------------------------------------------

export function GraduateEmptyState() {
  return (
    <StudentSurface testId="graduate-empty">
      <div className="mx-auto max-w-md space-y-3 py-16 text-center">
        <GraduationCap className="mx-auto h-10 w-10 text-student-muted" aria-hidden="true" />
        <h1 className="font-serif text-2xl text-student-ink">No graduate programme on record</h1>
        <p className="text-sm text-student-muted">If you are enrolled in a master's programme with ENEB, Support can check why it is not showing here.</p>
        <Link href="/support" className={buttonClass.outline}>Contact Support</Link>
      </div>
    </StudentSurface>
  );
}

export function GraduateSkeleton() {
  return (
    <StudentSurface testId="graduate-loading">
      <div className="mx-auto max-w-5xl space-y-6" role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">Loading your master's programme...</span>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-12 w-3/4 max-w-xl" />
        <Skeleton className="h-5 w-full max-w-2xl" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-44 rounded-2xl" />
        </div>
        <Skeleton className="h-56 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </StudentSurface>
  );
}

export function GraduateErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <StudentSurface testId="graduate-error">
      <div className="mx-auto max-w-md space-y-3 py-16 text-center" role="alert">
        <AlertCircle className="mx-auto h-10 w-10 text-student-attn" aria-hidden="true" />
        <h1 className="font-serif text-2xl text-student-ink">Your master's programme could not be loaded</h1>
        <p className="text-sm text-student-muted">This is a system problem, not a missing record. Nothing has changed.</p>
        <button type="button" className={buttonClass.solid} onClick={onRetry} data-testid="button-retry-graduate">Try again</button>
      </div>
    </StudentSurface>
  );
}
