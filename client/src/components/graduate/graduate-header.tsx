/**
 * Section A: programme header, the one next step, pending documents, progress
 * within verified requirements, and the two-track graphic that keeps ENEB and
 * university progress visibly apart.
 */
import React from "react";
import { Link } from "wouter";
import { ArrowRight, Circle, FileText, GraduationCap, Landmark } from "lucide-react";
import type { StudentGraduateProgramView } from "@shared/graduate-program-contract";
import { cn } from "@/lib/utils";
import { Eyebrow, Pill, StatusPill, buttonClass, cardClass, STATUS_STYLE } from "@/components/student-progress/student-ui";
import { PROVENANCE_PLAIN, SECTION_IDS, buildThenList, buildTrackModel, completeActions, formatDate, isInternalPath, nextStepActionLabel, sectionNav, waitingHint, type TrackNode } from "./graduate-presentation";
import { GlyphIcon, HATCHED_STYLE } from "./graduate-ui";

type Program = StudentGraduateProgramView;

export function GraduateSectionNav({ program, evaluationsShown = false }: { program: Program; evaluationsShown?: boolean }) {
  return (
    <nav aria-label="My Master's sections" className="min-w-0" data-testid="graduate-section-nav">
      <ul className="flex flex-wrap gap-2">
        {sectionNav(program, evaluationsShown).map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className="inline-flex min-h-[44px] items-center rounded-full border border-student-line-strong bg-student-card px-4 text-sm font-medium text-student-ink hover:bg-student-gold-soft"
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function TrackSteps({ nodes, label, offset = 0 }: { nodes: readonly TrackNode[]; label: string; offset?: number }) {
  return (
    <ol aria-label={label} className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-flow-col lg:auto-cols-fr">
      {nodes.map((n, i) => (
        <li key={n.key} className="min-w-0" data-testid="track-node" data-status={n.status}>
          <span
            aria-hidden="true"
            className={cn(
              "mb-2 block h-1.5 rounded-full",
              n.status === "notstarted" ? "border border-dashed border-st-notstarted bg-transparent" : n.glyph === "stated" ? "border border-student-gold" : STATUS_STYLE[n.status].fill,
            )}
            style={n.glyph === "stated" ? STATED_STYLE : undefined}
          />
          <p className="flex items-center gap-1.5 text-sm font-semibold text-student-ink">
            <span className="text-xs font-medium text-student-muted">{i + 1 + offset}</span>
            <span className="min-w-0 break-words">{n.label}</span>
          </p>
          <p className={cn("mt-0.5 flex items-center gap-1 text-xs font-medium", STATUS_STYLE[n.status].text)}>
            <GlyphIcon status={n.status} glyph={n.glyph} />
            <span>{n.stateLabel}</span>
          </p>
        </li>
      ))}
    </ol>
  );
}

function TrackLegend() {
  const swatch = "h-2 w-5 shrink-0 rounded-full";
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-student-muted" aria-label="What the bars and colours mean" data-testid="track-legend">
      <li className="flex items-center gap-1.5"><span aria-hidden="true" className={cn(swatch, "bg-st-official")} />Done and checked</li>
      <li className="flex items-center gap-1.5"><span aria-hidden="true" className={cn(swatch, "border border-student-gold")} style={STATED_STYLE} />Stated, not yet checked</li>
      <li className="flex items-center gap-1.5"><span aria-hidden="true" className={cn(swatch, "bg-st-progress")} />In progress or waiting</li>
      <li className="flex items-center gap-1.5"><span aria-hidden="true" className={cn(swatch, "border border-dashed border-st-notstarted")} />Later or not started</li>
    </ul>
  );
}

/** Two tracks, two authorities. The ENEB qualification is never the end of the university track. */
export function TwoTrackGraphic({ program }: { program: Program }) {
  const model = buildTrackModel(program);
  return (
    <section aria-labelledby="graduate-tracks-title" className={cn(cardClass, "space-y-5")} data-testid="two-track">
      <div>
        <h2 id="graduate-tracks-title" className="font-serif text-xl text-student-ink">Where you are on each track</h2>
        <div className="mt-2"><TrackLegend /></div>
      </div>
      <div role="group" aria-label="ENEB track" className="space-y-3" data-testid="track-eneb">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-student-ink">
            <GraduationCap className="h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />
            ENEB track
          </p>
          <p className="text-xs text-student-muted sm:pl-6">Subjects, then your ENEB qualification: a record kept apart from the university degree</p>
        </div>
        <TrackSteps nodes={model.eneb} label="ENEB track steps" />
      </div>
      {model.university ? (
        <div role="group" aria-label="University track" className="space-y-3 border-t border-student-line pt-5" data-testid="track-university">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-student-ink">
              <Landmark className="h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />
              University track
            </p>
            <p className="text-xs text-student-muted sm:pl-6">Decided and recorded by the university</p>
          </div>
          <TrackSteps nodes={model.university} label="University track steps" />
        </div>
      ) : (
        <p className="border-t border-student-line pt-4 text-sm text-student-muted" data-testid="eneb-only-note">
          This programme does not lead to a university degree.
        </p>
      )}
    </section>
  );
}

function CtaLink({ href, children, className, testId }: { href: string; children: React.ReactNode; className?: string; testId?: string }) {
  return isInternalPath(href) ? (
    <Link href={href} className={className} data-testid={testId}>{children}</Link>
  ) : (
    <a href={href} className={className} data-testid={testId}>{children}</a>
  );
}

function NextStepCard({ program, evaluationsCount }: { program: Program; evaluationsCount: number }) {
  const step = program.nextStep;
  const body = (
    <>
      <span>{step.href ? nextStepActionLabel(step.href) : ""}</span>
      <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
    </>
  );
  const hint = waitingHint(step);
  const then = buildThenList(program);
  const actions = completeActions(program, evaluationsCount);
  return (
    <section aria-labelledby="graduate-next-title" className={cn(cardClass, "flex flex-col gap-3 border-student-gold")} data-testid="graduate-next-step">
      <Eyebrow>Your next step</Eyebrow>
      <h2 id="graduate-next-title" className="font-serif text-xl leading-snug text-student-ink sm:text-2xl">{step.title}</h2>
      <p className="text-sm leading-relaxed text-student-muted">{step.detail}</p>
      {step.href && (
        <CtaLink href={step.href} className={cn(buttonClass.primary, "w-full sm:w-fit")} testId="graduate-next-action">
          {body}
        </CtaLink>
      )}
      {hint && (
        <p className="rounded-lg bg-student-gold-soft px-3 py-2 text-sm text-student-ink" data-testid="next-step-hint">
          <span className="font-semibold">What you can do now: </span>
          {hint.replace(/^Nothing is needed from you right now\. /, "Nothing is needed right now. ")}{" "}
          <Link href="/support" className="font-medium text-student-gold-ink underline underline-offset-4">Ask Support</Link>
        </p>
      )}
      {then.length > 0 && (
        <div className="mt-auto border-t border-student-line pt-3" data-testid="next-then">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-student-muted">Then</h3>
          <ol className="mt-2 space-y-2.5">
            {then.map((t) => (
              <li key={t.key} className="flex items-start gap-2.5" data-testid="then-item">
                <Circle className="mt-1 h-3 w-3 shrink-0 text-student-muted" aria-hidden="true" />
                <span className="min-w-0 text-sm">
                  <span className="block font-medium text-student-ink">{t.label}</span>
                  <span className="block text-xs text-student-muted">{t.hint}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {actions.length > 0 && (
        <div className="mt-auto border-t border-student-line pt-3" data-testid="complete-actions">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-student-muted">Useful now</h3>
          <ul className="mt-2 space-y-2">
            {actions.map((a) => (
              <li key={a.key}>
                <CtaLink href={a.href} className={cn(buttonClass.outline, "w-full justify-between sm:w-fit")} testId={`complete-action-${a.key}`}>
                  <span>{a.label}</span>
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </CtaLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const STATED_STYLE = HATCHED_STYLE;

/** Two segments: passes Lumière has checked (solid) and passes only stated by the institution (hatched). */
function Bar({ passed, verified, total, label }: { passed: number; verified: number; total: number; label: string }) {
  const pct = (n: number) => (total > 0 ? Math.min(100, Math.round((n / total) * 100)) : 0);
  const stated = Math.max(0, passed - verified);
  if (passed === 0) {
    return (
      <div data-testid="progress-bar" data-empty="true">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-student-ink">{label}</span>
          <span className="shrink-0 font-medium text-student-muted">Not started</span>
        </div>
        <p className="mt-1 text-xs text-student-muted">{total} to pass</p>
      </div>
    );
  }
  return (
    <div data-testid="progress-bar">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-student-ink">{label}</span>
        <span className="shrink-0 font-medium text-student-ink">{passed} of {total}</span>
      </div>
      <div
        className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-student-line"
        role="img"
        aria-label={`${label}: ${passed} of ${total}. ${verified} checked by Lumière, ${stated} stated and not yet checked.`}
      >
        <div className="h-full bg-st-official" style={{ width: `${pct(verified)}%` }} data-segment="verified" />
        <div className="h-full" style={{ width: `${pct(stated)}%`, ...STATED_STYLE }} data-segment="stated" />
      </div>
      <p className="mt-1 text-xs text-student-muted">
        {verified} checked{stated > 0 ? ` · ${stated} stated, not yet checked` : ""}
      </p>
    </div>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-student-muted" aria-label="How to read the bars" data-testid="progress-legend">
      <li className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-5 rounded-sm bg-st-official" />{PROVENANCE_PLAIN.verified}</li>
      <li className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-5 rounded-sm border border-student-gold" style={STATED_STYLE} />{PROVENANCE_PLAIN.stated}</li>
    </ul>
  );
}

function ProgressCard({ program }: { program: Program }) {
  const p = program.progress;
  const uni = program.route === "eneb_unimarconi";
  return (
    <section aria-labelledby="graduate-progress-title" className={cn(cardClass, "space-y-4")} data-testid="graduate-progress">
      <h2 id="graduate-progress-title" className="font-serif text-xl text-student-ink">Progress on your requirements</h2>
      <p className="text-sm leading-relaxed text-student-ink" data-testid="progress-statement">{p.statement}</p>
      <div className="space-y-3">
        {p.enebSubjectsTotal > 0 && <Bar passed={p.enebSubjectsPassed} verified={p.enebSubjectsVerified} total={p.enebSubjectsTotal} label="ENEB subjects passed" />}
        {uni && p.universitySubjectsTotal > 0 && <Bar passed={p.universitySubjectsPassed} verified={p.universitySubjectsVerified} total={p.universitySubjectsTotal} label="University subjects passed" />}
        {uni && p.verifiedRequirements && <Bar passed={p.verifiedRequirements.done} verified={p.verifiedRequirements.done} total={p.verifiedRequirements.total} label="University-approved requirements" />}
      </div>
      <Legend />
      {uni && !p.verifiedRequirements && (
        <p className="text-xs text-student-muted" data-testid="module-list-pending">
          The university-approved module list is still being confirmed, so no overall university progress is shown yet.
        </p>
      )}
    </section>
  );
}

function PendingDocuments({ items, showLink = true }: { items: Program["pendingDocuments"]; showLink?: boolean }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="graduate-pending-title" className={cn(cardClass, "space-y-3 border-st-attention bg-student-attn-soft")} data-testid="pending-documents">
      <h2 id="graduate-pending-title" className="flex items-center gap-2 font-serif text-xl text-student-ink">
        <FileText className="h-5 w-5 text-student-attn" aria-hidden="true" />
        Documents we still need
      </h2>
      <ul className="space-y-2">
        {items.map((d) => (
          <li key={d.key} className="text-sm">
            <span className="block font-medium text-student-ink">{d.label}</span>
            <span className="block text-student-muted">{d.detail}</span>
          </li>
        ))}
      </ul>
      {showLink && <Link href="/documents" className={buttonClass.outline} data-testid="pending-documents-link">Go to Documents</Link>}
    </section>
  );
}

/** One chip for "ENEB status" and the ENEB qualification, without saying the same thing twice. */
export function mergeEnebLabel(statusLabel: string, qualificationLabel: string): string {
  const n = (v: string) => v.toLowerCase().replace(/[^a-z ]+/g, "").trim();
  if (n(qualificationLabel).includes(n(statusLabel))) return `ENEB status: ${qualificationLabel}`;
  return `ENEB status: ${statusLabel} \u00b7 ${qualificationLabel}`;
}

export function GraduateHeader({ program, evaluationsCount = 0 }: { program: Program; evaluationsCount?: number }) {
  const q = program.enebQualification;
  const reg = program.registration;
  const uni = program.route === "eneb_unimarconi";
  const conferred = program.graduation?.awardConferred ? program.graduation : null;
  const conferredOn = formatDate(conferred?.conferredOn);
  const qStatus = q.state === "completed_verified" ? "official" : q.state === "completed_reported" ? "provider" : "progress";
  const enebChip = mergeEnebLabel(program.enebStatusLabel, q.label);
  return (
    <div className="space-y-5">
      <header id={SECTION_IDS.header} className="space-y-3" data-testid="graduate-header">
        <Eyebrow>My Master's</Eyebrow>
        <h1 className="break-words font-serif text-3xl leading-tight tracking-tight text-student-ink sm:text-5xl" data-testid="graduate-title">
          {program.title}
        </h1>
        {program.titleNote && <p className="text-sm text-student-muted" data-testid="graduate-title-note">{program.titleNote}</p>}
        {conferred && (
          <p
            className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-full border border-st-official bg-st-official px-4 py-2 text-base font-semibold text-student-seal-ink"
            data-testid="degree-conferred-chip"
          >
            <Landmark className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>University degree conferred{conferredOn ? <> &middot; <time dateTime={conferred.conferredOn ?? undefined}>{conferredOn}</time></> : null}</span>
          </p>
        )}
        <p className="max-w-3xl text-base leading-relaxed text-student-ink" data-testid="graduate-relationship">{program.universityRelationship}</p>
        {uni ? (
          <div className="space-y-2">
            {!conferred && reg.state !== "not_applicable" && (
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill
                  status={reg.state === "verified" ? "official" : reg.state === "in_progress" ? "progress" : "notstarted"}
                  label={reg.label}
                  data-testid="registration-status"
                />
                {reg.state === "verified" && reg.matricola && <Pill tone="gold" data-testid="matricola">Matricola {reg.matricola}</Pill>}
              </div>
            )}
            {conferred && reg.state === "verified" && reg.matricola && (
              <p className="text-sm text-student-muted" data-testid="registration-status">Matricola <span data-testid="matricola" className="font-medium text-student-ink">{reg.matricola}</span></p>
            )}
            <div className="flex flex-wrap items-center gap-2 text-sm text-student-muted" data-testid="eneb-record">
              <span className="font-medium text-student-ink">Separate ENEB record:</span>
              <StatusPill status={qStatus} label={enebChip} className="max-w-full text-left" data-testid="eneb-qualification" />
              <span className="text-xs">It does not hold up your university degree.</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={qStatus} label={enebChip} className="max-w-full text-left" data-testid="eneb-qualification" />
          </div>
        )}
        <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <div>
            <dt className="inline text-student-muted">Cohort: </dt>
            <dd className="inline font-medium text-student-ink">{program.cohortLabel}</dd>
          </div>
          <div>
            <dt className="inline text-student-muted">Academic period: </dt>
            <dd className="inline font-medium text-student-ink">{program.academicPeriod}</dd>
          </div>
        </dl>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <NextStepCard program={program} evaluationsCount={evaluationsCount} />
        <ProgressCard program={program} />
      </div>
      <PendingDocuments items={program.pendingDocuments} showLink={program.nextStep.href !== "/documents"} />
      <TwoTrackGraphic program={program} />
    </div>
  );
}
