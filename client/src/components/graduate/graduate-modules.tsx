/**
 * Section B: modules grouped by who decides them. Students change only their
 * own progress; results and grades are read-only.
 */
import React, { useState } from "react";
import { BadgeCheck, FileCheck2, RotateCcw, PencilLine } from "lucide-react";
import type { ModuleView, StudentGraduateProgramView, StudentProgress } from "@shared/graduate-program-contract";
import { cn } from "@/lib/utils";
import { Disclosure, Pill, SectionHeading, cardClass } from "@/components/student-progress/student-ui";
import { useGraduateActions } from "./graduate-actions";
import { FinishedSection, StatePill } from "./graduate-ui";
import { PROGRESS_OPTIONS, SECTION_IDS, progressDisplay, resultDisplay } from "./graduate-presentation";

type Program = StudentGraduateProgramView;

function errorMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "We could not save that. Please try again.";
}

/** Compact three-way control. Shows the new value as saved only after the server accepted it. */
export function ProgressControl({ programId, module }: { programId: string; module: ModuleView }) {
  const actions = useGraduateActions();
  const [pending, setPending] = useState<StudentProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const shown = pending ?? module.progress;
  const name = `progress-${module.id}`;

  const choose = async (next: StudentProgress) => {
    if (next === module.progress || pending) return;
    setPending(next);
    setError(null);
    setSaved(false);
    try {
      await actions.setSubjectProgress(programId, module.id, next);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-1.5" data-testid="progress-control">
      <fieldset className="min-w-0">
        <legend className="mb-1 text-xs font-medium text-student-muted">Your progress</legend>
        <div className="inline-flex max-w-full overflow-hidden rounded-lg border border-student-line-strong bg-student-card" role="radiogroup" aria-label={`Your progress on ${module.title}`}>
          {PROGRESS_OPTIONS.map((o) => (
            <label
              key={o.value}
              className={cn(
                "relative flex min-h-[44px] cursor-pointer items-center px-3 text-sm font-medium focus-within:outline focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-student-gold-ink",
                "border-l border-student-line first:border-l-0",
                shown === o.value ? "bg-student-seal text-student-seal-ink" : "text-student-ink hover:bg-student-gold-soft",
                pending && "cursor-wait opacity-80",
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={shown === o.value}
                disabled={!!pending}
                onChange={() => void choose(o.value)}
                className="sr-only"
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="min-h-[1rem] text-xs" role="status" aria-live="polite">
        {pending ? <span className="text-student-muted">Saving...</span> : saved ? <span className="text-st-applied">Saved.</span> : null}
      </p>
      {error && (
        <p className="text-xs font-medium text-student-attn" role="alert" data-testid="progress-error">{error}</p>
      )}
      {shown === "submitted" && (
        <p className="text-xs text-student-muted">Submitted means you handed it in. It is not a result.</p>
      )}
    </div>
  );
}

export function ModuleRow({ programId, module }: { programId: string; module: ModuleView }) {
  const result = resultDisplay(module);
  const progress = progressDisplay(module.progress);
  return (
    <li className="space-y-3 py-4 first:pt-0 last:pb-0" data-testid="module-row" data-module-id={module.id} data-result={module.result}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="break-words font-medium text-student-ink" data-testid="module-title">{module.title}</p>
          <p className="text-xs text-student-muted">
            {module.assessment}
            {module.moduleCode ? ` · ${module.moduleCode}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatePill status={result.status} label={result.label} glyph={result.glyph} data-testid="module-result" />
          {module.grade && <span className="text-sm font-semibold text-student-ink" data-testid="module-grade">{module.grade}</span>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {module.reassessed && <Pill tone="neutral" icon={<RotateCcw className="h-3 w-3" aria-hidden="true" />}>Reassessed</Pill>}
        {module.corrected && <Pill tone="neutral" icon={<PencilLine className="h-3 w-3" aria-hidden="true" />}>Corrected</Pill>}
        {module.hasEvidence && <Pill tone="neutral" icon={<FileCheck2 className="h-3 w-3" aria-hidden="true" />}>Evidence on file</Pill>}
        <span className="inline-flex items-center gap-1 text-xs text-student-muted" data-testid="module-verification">
          <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {module.verificationLabel}
        </span>
      </div>
      {module.canReportProgress ? (
        <ProgressControl programId={programId} module={module} />
      ) : (
        module.result !== "passed" && <p className="text-xs text-student-muted" data-testid="progress-readonly">Progress: {progress.label}.</p>
      )}
    </li>
  );
}

function Group({ title, note, programId, modules, collapsePassed = false }: { title: string; note: string; programId: string; modules: readonly ModuleView[]; collapsePassed?: boolean }) {
  if (!modules.length) return null;
  const headingId = `modules-${title.replace(/\W+/g, "-").toLowerCase()}`;
  const passed = collapsePassed ? modules.filter((m) => m.result === "passed") : [];
  const rest = collapsePassed ? modules.filter((m) => m.result !== "passed") : modules;
  const verified = passed.filter((m) => m.verification === "verified").length;
  const provenance =
    verified === passed.length ? "checked by Lumière against ENEB documents" : verified === 0 ? "stated by ENEB, not yet checked" : `${verified} checked, ${passed.length - verified} stated by ENEB and not yet checked`;
  return (
    <section aria-labelledby={headingId} className={cn(cardClass, "space-y-3")} data-testid="module-group">
      <div>
        <h3 id={headingId} className="font-serif text-lg text-student-ink">{title}</h3>
        <p className="text-xs text-student-muted">{note}</p>
      </div>
      {rest.length > 0 && (
        <ul className="divide-y divide-student-line">
          {rest.map((m) => <ModuleRow key={m.id} programId={programId} module={m} />)}
        </ul>
      )}
      {passed.length > 0 && (
        <Disclosure
          testId="passed-eneb-summary"
          className="rounded-xl border border-student-line bg-student-bg px-3"
          buttonClassName="text-student-ink"
          label={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-semibold">{passed.length} of {modules.length} passed</span>
              <span className="text-student-muted">&middot; {provenance}</span>
              <span className="text-xs font-medium text-student-gold-ink">Show subjects</span>
            </span>
          }
        >
          <ul className="divide-y divide-student-line pb-2">
            {passed.map((m) => <ModuleRow key={m.id} programId={programId} module={m} />)}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}

export function ModulesSection({ program, summary }: { program: Program; summary?: string | null }) {
  const eneb = program.modules.filter((m) => m.authority === "eneb");
  const uni = program.modules.filter((m) => m.authority === "unimarconi");
  const body = (
    <div className="space-y-4">
      <Group title="ENEB subjects" note="Assessed by ENEB. These count toward your ENEB qualification." programId={program.programId} modules={eneb} collapsePassed />
      <Group title="University subjects" note="Assessed by the university. Only the university's results count toward the university degree." programId={program.programId} modules={uni} />
    </div>
  );
  if (summary && program.modules.length > 0) {
    return (
      <FinishedSection id="graduate-modules-title" sectionId={SECTION_IDS.modules} title="My modules" summary={summary} testId="graduate-modules">
        {body}
      </FinishedSection>
    );
  }
  return (
    <section aria-labelledby="graduate-modules-title" id={SECTION_IDS.modules} className="scroll-mt-24 space-y-4" data-testid="graduate-modules">
      <SectionHeading
        id="graduate-modules-title"
        title="My modules"
        description="You can mark your own progress. Results and grades are recorded by Lumière from official documents and cannot be edited here."
      />
      {program.modules.length === 0 ? <p className={cn(cardClass, "text-sm text-student-muted")}>No modules are listed for this programme yet.</p> : body}
    </section>
  );
}
