/**
 * Academic progress & degree roadmap. Canonical sections are read-only; the
 * student's self-reported enrollments are clearly separated and marked preliminary.
 */
import React from "react";
import { Edit, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  StudentCreditSourceView,
  StudentCreditView,
  StudentDegreeProgressView,
  StudentRequirementView,
} from "@shared/student-degree-progress-view";
import {
  attentionOwnerLabel,
  creditAmountDisplay,
  creditsAppliedToRequirement,
  creditStandingPresentation,
  creditTitleLine,
  formatAsOf,
  groupCredits,
  NO_PROGRAM_COPY,
  NO_TOTALS_COPY,
  PLANNED_COURSES_COPY,
  progressMode,
  requirementAmounts,
  requirementStatusPresentation,
  safeInternalHref,
  sortRequirements,
  sourceStatusPresentation,
  sourceTypeLabel,
  UNDER_REVIEW_COPY,
} from "@/pages/student-progress-presentation";
import { PreliminaryMark, SectionHeading, SlimBar, StatusChip, VerifiedMark } from "./parts";
import { AttentionSection } from "./flight-deck-view";

/** Minimal shape of an enrollment as the roadmap displays it. */
export interface PlannedEnrollment {
  id: string;
  courseCode?: string | null;
  title: string;
  credits?: number | null;
  status: string;
  courseUrl?: string | null;
  notes?: string | null;
  provider?: { key?: string; name?: string } | null;
}

export interface RoadmapViewProps {
  view: StudentDegreeProgressView;
  enrollments?: readonly PlannedEnrollment[];
  enrollmentsLoading?: boolean;
  /** Omit to hide the edit/delete controls (e.g. fixture rendering). */
  onEditEnrollment?: (enrollment: PlannedEnrollment) => void;
  onDeleteEnrollment?: (enrollment: PlannedEnrollment) => void;
  deletingEnrollment?: boolean;
  /** Slot for the existing add-course dialogs and similar self-service actions. */
  enrollmentActions?: React.ReactNode;
  /** Slot for the existing study hours widget. */
  extras?: React.ReactNode;
}

export function RoadmapHeader({ view }: { view: StudentDegreeProgressView | null }) {
  const asOf = view ? formatAsOf(view.asOf) : null;
  return (
    <header className="space-y-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gold-strong">
        Academic progress
      </p>
      <h1
        className="font-serif text-3xl leading-tight tracking-tight text-foreground sm:text-5xl"
        data-testid="text-page-title"
      >
        Degree Roadmap
      </h1>
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {view?.program?.programName ? `${view.program.programName}. ` : ""}
        Every requirement, in order, with the courses that count toward it.
        {asOf ? ` Record as of ${asOf}.` : ""} This record is read-only; Lumi&egrave;re staff
        maintain it.
      </p>
    </header>
  );
}

export function RoadmapView({
  view,
  enrollments = [],
  enrollmentsLoading,
  onEditEnrollment,
  onDeleteEnrollment,
  deletingEnrollment,
  enrollmentActions,
  extras,
}: RoadmapViewProps) {
  const mode = progressMode(view);
  const composed = mode === "composed" || mode === "composed-without-totals";
  return (
    <div className="mx-auto w-full max-w-5xl space-y-12 px-4 py-6 sm:px-6 sm:py-10" data-testid="roadmap" data-mode={mode}>
      <RoadmapHeader view={view} />

      {mode === "under-review" && (
        <section className="space-y-3 rounded-2xl border border-card-border bg-card p-6 shadow-sm sm:p-8" data-testid="under-review-state">
          <h2 className="font-serif text-2xl tracking-tight sm:text-3xl">{UNDER_REVIEW_COPY.headline}</h2>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {UNDER_REVIEW_COPY.body}
          </p>
        </section>
      )}
      {mode === "no-program" && (
        <section className="space-y-3 rounded-2xl border border-card-border bg-card p-6 shadow-sm sm:p-8" data-testid="no-program-state">
          <h2 className="font-serif text-2xl tracking-tight sm:text-3xl">{NO_PROGRAM_COPY.headline}</h2>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {NO_PROGRAM_COPY.body}
          </p>
        </section>
      )}

      {mode !== "no-program" && <AttentionSection items={view.attention} />}

      {composed && (
        <RequirementRoadmap
          requirements={view.requirements}
          credits={view.credits}
          showTotalsNote={mode === "composed-without-totals"}
        />
      )}

      {mode !== "no-program" && <CreditsSection credits={view.credits} />}
      {mode !== "no-program" && <SourcesSection sources={view.sources} />}

      <PlannedCoursesSection
        enrollments={enrollments}
        loading={enrollmentsLoading}
        onEdit={onEditEnrollment}
        onDelete={onDeleteEnrollment}
        deleting={deletingEnrollment}
        actions={enrollmentActions}
      />
      {extras}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RequirementRoadmap({
  requirements,
  credits,
  showTotalsNote,
}: {
  requirements: readonly StudentRequirementView[];
  credits: readonly StudentCreditView[];
  showTotalsNote: boolean;
}) {
  const ordered = sortRequirements(requirements);
  return (
    <section aria-labelledby="rm-requirements" className="space-y-5" data-testid="requirement-roadmap">
      <SectionHeading
        id="rm-requirements"
        eyebrow="Requirement by requirement"
        title="Your degree roadmap"
        description={showTotalsNote ? NO_TOTALS_COPY : undefined}
      />
      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No requirements are loaded for your program yet.</p>
      ) : (
        <ol className="space-y-4">
          {ordered.map((req, index) => (
            <RequirementCard
              key={req.requirementId}
              index={index + 1}
              requirement={req}
              applied={creditsAppliedToRequirement(req, credits)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function RequirementCard({
  index,
  requirement,
  applied,
}: {
  index: number;
  requirement: StudentRequirementView;
  applied: StudentCreditView[];
}) {
  const status = requirementStatusPresentation(requirement.status);
  const amounts = requirementAmounts(requirement);
  const hasAmounts = amounts.required !== null && amounts.applied !== null;
  return (
    <li
      className={cn(
        "space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6",
        status.tone === "review" ? "border-attention/40" : "border-card-border",
      )}
      data-testid={`requirement-${requirement.requirementId}`}
      data-status={requirement.status}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground">
            <span className="font-serif text-gold-strong">{String(index).padStart(2, "0")}</span>
            {requirement.code ? ` · ${requirement.code}` : ""}
          </p>
          <h3 className="font-serif text-xl tracking-tight text-foreground">{requirement.title}</h3>
        </div>
        <StatusChip tone={status.tone} label={status.label} />
      </div>

      {hasAmounts ? (
        <div className="space-y-2">
          <SlimBar
            applied={requirement.appliedAmount}
            required={requirement.requiredAmount}
            tone={status.tone}
            label={`${amounts.applied} of ${amounts.required} applied`}
          />
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Required</dt>
              <dd className="font-medium">{amounts.required}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Applied</dt>
              <dd className="font-medium">{amounts.applied}</dd>
            </div>
            {amounts.remaining && (
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">Remaining</dt>
                <dd className="font-medium">{amounts.remaining}</dd>
              </div>
            )}
          </dl>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{status.hint}</p>
      )}

      {applied.length > 0 && (
        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Courses applied
          </p>
          <ul className="space-y-1.5">
            {applied.map((credit) => {
              const amount = creditAmountDisplay(credit);
              return (
                <li key={credit.creditRecordId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 text-foreground">{creditTitleLine(credit)}</span>
                  {amount.text && <span className="text-muted-foreground">{amount.text}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
}

function CreditRow({ credit }: { credit: StudentCreditView }) {
  const standing = creditStandingPresentation(credit.standing);
  const amount = creditAmountDisplay(credit);
  const preliminary = !standing.verified && credit.standing !== "NOT_ACCEPTED";
  return (
    <li
      className={cn(
        "flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6",
        preliminary && "border-l-2 border-dashed border-l-muted-foreground/40",
      )}
      data-standing={credit.standing}
    >
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-foreground">{creditTitleLine(credit)}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {[credit.term, credit.completedOn ? `Completed ${formatAsOf(credit.completedOn) ?? credit.completedOn}` : null]
            .filter(Boolean)
            .join(" · ")}
          {[credit.term, credit.completedOn].some(Boolean) ? " · " : ""}
          {standing.explanation}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {amount.text && (
          <span className="text-sm text-foreground">
            {amount.text}
            {amount.basis === "reported" && (
              <span className="text-muted-foreground"> (reported)</span>
            )}
          </span>
        )}
        {standing.verified ? (
          <VerifiedMark />
        ) : credit.standing === "NOT_ACCEPTED" ? (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            Not accepted
          </span>
        ) : (
          <PreliminaryMark />
        )}
      </div>
    </li>
  );
}

function CreditGroup({
  id,
  title,
  description,
  credits,
}: {
  id: string;
  title: string;
  description: string;
  credits: StudentCreditView[];
}) {
  if (credits.length === 0) return null;
  return (
    <div className="space-y-3" data-testid={`credit-group-${id}`}>
      <div>
        <h3 id={`rm-${id}`} className="font-serif text-lg tracking-tight">
          {title}
        </h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <ul
        aria-labelledby={`rm-${id}`}
        className="divide-y divide-border overflow-hidden rounded-2xl border border-card-border bg-card"
      >
        {credits.map((credit) => (
          <CreditRow key={credit.creditRecordId} credit={credit} />
        ))}
      </ul>
    </div>
  );
}

export function CreditsSection({ credits }: { credits: readonly StudentCreditView[] }) {
  const grouped = groupCredits(credits);
  return (
    <section aria-labelledby="rm-credits" className="space-y-6" data-testid="credits-section">
      <SectionHeading
        id="rm-credits"
        eyebrow="Your record"
        title="Your courses and credits"
        description="A solid gold check means Lumi&egrave;re staff verified it. A dashed outline means it is preliminary and does not count yet."
      />
      {credits.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No credits are on your record yet. Upload transcripts or certificates in Documents to get started.
        </p>
      )}
      <CreditGroup
        id="verified"
        title="Completed & verified"
        description="Verified credits that make up your academic record. Some are verified but not currently applied to a requirement."
        credits={grouped.verified}
      />
      <CreditGroup
        id="awaiting"
        title="Awaiting verification"
        description="Preliminary and self-reported. These are not part of your verified record until staff confirm them."
        credits={grouped.awaiting}
      />
      <CreditGroup
        id="not-accepted"
        title="Not accepted"
        description="These records were reviewed and do not count toward your degree."
        credits={grouped.notAccepted}
      />
    </section>
  );
}

function SourceRow({ source }: { source: StudentCreditSourceView }) {
  const status = sourceStatusPresentation(source.status);
  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="min-w-0">
        <p className="font-medium text-foreground">{source.title}</p>
        <p className="text-xs text-muted-foreground">
          {sourceTypeLabel(source.sourceType)}
          {formatAsOf(source.sourceDate) ? ` · ${formatAsOf(source.sourceDate)}` : ""}
          {` · ${source.creditRecordCount} ${source.creditRecordCount === 1 ? "record" : "records"}`}
        </p>
      </div>
      {status.tone === "verified" ? (
        <VerifiedMark />
      ) : status.tone === "preliminary" ? (
        <PreliminaryMark label={status.label} />
      ) : (
        <span className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {status.label}
        </span>
      )}
    </li>
  );
}

export function SourcesSection({ sources }: { sources: readonly StudentCreditSourceView[] }) {
  return (
    <section aria-labelledby="rm-sources" className="space-y-4" data-testid="sources-section">
      <SectionHeading
        id="rm-sources"
        eyebrow="Where credit comes from"
        title="Credit sources & transfer credit"
        description="Transcripts, certificates and other documents behind your credits."
      />
      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No credit sources yet. Documents you upload will be listed here.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-card-border bg-card">
          {sources.map((source) => (
            <SourceRow key={source.sourceId} source={source} />
          ))}
        </ul>
      )}
    </section>
  );
}

const ENROLLMENT_STATUS_LABEL: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  completed: "Completed",
  dropped: "Dropped",
};

export function PlannedCoursesSection({
  enrollments,
  loading,
  onEdit,
  onDelete,
  deleting,
  actions,
}: {
  enrollments: readonly PlannedEnrollment[];
  loading?: boolean;
  onEdit?: (enrollment: PlannedEnrollment) => void;
  onDelete?: (enrollment: PlannedEnrollment) => void;
  deleting?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="rm-planned"
      className="space-y-5 rounded-2xl border border-dashed border-muted-foreground/40 p-5 sm:p-8"
      data-testid="planned-courses"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <PreliminaryMark label="Self-reported" />
          <h2 id="rm-planned" className="font-serif text-xl tracking-tight sm:text-2xl">
            {PLANNED_COURSES_COPY.title}{" "}
            <span className="block text-base font-normal text-muted-foreground sm:inline">
              ({PLANNED_COURSES_COPY.qualifier})
            </span>
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Use this list to plan your own study. It does not change your verified credits or your
            requirements above; staff record completed courses once documents are verified.
          </p>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground" role="status">Loading your planned courses...</p>
      ) : enrollments.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="planned-empty">
          No planned courses yet. Add a course to start planning.
        </p>
      ) : (
        <ul className="space-y-3">
          {enrollments.map((course) => (
            <li
              key={course.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-4"
              data-testid={`card-course-${course.id}`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-sm font-semibold" data-testid={`text-course-code-${course.id}`}>
                    {course.courseCode || "N/A"}
                  </code>
                  <span className="rounded-full border border-dashed border-muted-foreground/50 px-2 py-0.5 text-xs text-muted-foreground">
                    {ENROLLMENT_STATUS_LABEL[course.status] ?? course.status}
                  </span>
                  {course.provider?.name && (
                    <span className="text-xs text-muted-foreground">{course.provider.name}</span>
                  )}
                </div>
                <h3 className="font-medium" data-testid={`text-course-title-${course.id}`}>
                  {course.title}
                </h3>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span data-testid={`text-credits-${course.id}`}>{course.credits} credits (self-reported)</span>
                  {course.courseUrl && (
                    <a
                      href={course.courseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center gap-1 text-gold-strong hover:underline"
                      data-testid={`link-course-url-${course.id}`}
                    >
                      Course Link
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </div>
                {course.notes && (
                  <p className="text-sm text-muted-foreground" data-testid={`text-notes-${course.id}`}>
                    {course.notes}
                  </p>
                )}
              </div>
              {(onEdit || onDelete) && (
                <div className="flex shrink-0">
                  {onEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11"
                      onClick={() => onEdit(course)}
                      aria-label={`Edit ${course.title}`}
                      data-testid={`button-edit-${course.id}`}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                  )}
                  {onDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 text-destructive hover:bg-destructive/10"
                      onClick={() => onDelete(course)}
                      disabled={deleting}
                      aria-label={`Delete ${course.title}`}
                      data-testid={`button-delete-${course.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
