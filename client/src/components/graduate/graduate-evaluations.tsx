/**
 * International recognition: foreign credential evaluations. Kept apart from the
 * Italian award. A preliminary tool result is visibly lighter and never called an
 * evaluation; only a verified completed report gets the confirmed treatment.
 * Nothing here implies a guaranteed equivalency.
 */
import React from "react";
import { Link } from "wouter";
import { Globe2, ShieldCheck, Sparkles } from "lucide-react";
import { EVALUATION_FRAMING, type EvaluationView } from "@shared/graduate-program-contract";
import { cn } from "@/lib/utils";
import { Pill, SectionHeading, StatusPill, buttonClass, cardClass } from "@/components/student-progress/student-ui";
import { SECTION_IDS, formatDate } from "./graduate-presentation";
import { StatePill } from "./graduate-ui";

export function countryName(code: string): string {
  try {
    const n = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    return n && n !== code ? n : code;
  } catch {
    return code;
  }
}

const capital = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);

function EvaluationCard({ e }: { e: EvaluationView }) {
  const date = formatDate(e.reportDate);
  const kind = e.isOfficialOutcome ? "confirmed" : e.isPreliminary ? "preliminary" : "pending";
  return (
    <li
      className={cn(
        "space-y-3 rounded-2xl border p-4 sm:p-5",
        kind === "confirmed" && "border-student-gold bg-student-card",
        kind === "preliminary" && "border-dashed border-student-line-strong bg-student-bg",
        kind === "pending" && "border-student-line bg-student-card",
      )}
      data-testid="evaluation"
      data-kind={kind}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-serif text-lg text-student-ink" data-testid="evaluation-evaluator">{e.evaluatorLabel}</h3>
          <p className="text-sm text-student-muted">
            For use in <span className="font-medium text-student-ink" data-testid="evaluation-country">{countryName(e.destinationCountry)}</span>
            {" · "}
            <span data-testid="evaluation-use">{capital(e.intendedUse)}</span>
          </p>
        </div>
        {kind === "confirmed" ? (
          <StatusPill status="official" label="Verified evaluation report" data-testid="evaluation-badge" />
        ) : kind === "preliminary" ? (
          <Pill tone="dashed" icon={<Sparkles className="h-3 w-3" aria-hidden="true" />} data-testid="evaluation-badge">Preliminary &mdash; not an evaluation report</Pill>
        ) : (
          <StatePill status="notstarted" label={capital(e.status)} data-testid="evaluation-badge" />
        )}
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-student-muted">Qualification evaluated</dt>
          <dd className="break-words font-medium text-student-ink">{e.qualificationEvaluated}</dd>
        </div>
        <div>
          <dt className="text-student-muted">Type</dt>
          <dd className="text-student-ink">{e.typeLabel}</dd>
        </div>
        <div>
          <dt className="text-student-muted">Report date</dt>
          <dd className="text-student-ink">{date ? <time dateTime={e.reportDate ?? undefined}>{date}</time> : "No report date yet"}</dd>
        </div>
      </dl>

      <div className={cn("space-y-2 rounded-xl border p-3", kind === "preliminary" ? "border-dashed border-student-line-strong" : "border-student-line bg-student-bg")}>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-student-muted">{kind === "preliminary" ? "Indication only" : "Evaluator's conclusion"}</p>
        <p className="text-sm font-medium text-student-ink" data-testid="evaluation-conclusion">{e.conclusionLabel}</p>
        {e.conclusionText && (
          <blockquote className="border-l-2 border-student-gold pl-3 text-sm italic leading-relaxed text-student-ink" data-testid="evaluation-quote">
            &ldquo;{e.conclusionText}&rdquo;
          </blockquote>
        )}
      </div>

      <p className="flex flex-wrap items-center gap-1.5 text-xs text-student-muted" data-testid="evaluation-verification">
        {kind === "confirmed" && <ShieldCheck className="h-3.5 w-3.5 text-student-gold-ink" aria-hidden="true" />}
        {e.verificationLabel}
      </p>
      <p className="text-sm text-student-muted" data-testid="evaluation-caveat">{e.caveat}</p>
    </li>
  );
}

export function EvaluationsSection({ evaluations, university }: { evaluations: readonly EvaluationView[]; university: boolean }) {
  return (
    <section aria-labelledby="graduate-evaluations-title" id={SECTION_IDS.evaluations} className="scroll-mt-24 space-y-4" data-testid="graduate-evaluations">
      <SectionHeading id="graduate-evaluations-title" title="International recognition of your degree" />
      <p className="flex max-w-2xl items-start gap-2 text-sm leading-relaxed text-student-muted" data-testid="evaluation-framing">
        <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />
        {EVALUATION_FRAMING}
      </p>
      {evaluations.length > 0 ? (
        <ul className="space-y-4">
          {evaluations.map((e) => <EvaluationCard key={e.id} e={e} />)}
        </ul>
      ) : (
        university && (
          <div className={cn(cardClass, "space-y-3")} data-testid="evaluations-empty">
            <p className="text-sm leading-relaxed text-student-ink">
              No evaluation is recorded yet. You can ask for one for a specific country and purpose through Support. Results differ by evaluator and country.
            </p>
            <Link href="/support" className={buttonClass.outline} data-testid="evaluations-support-link">Ask Support about an evaluation</Link>
          </div>
        )
      )}
    </section>
  );
}
