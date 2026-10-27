/**
 * High School Flight Deck (S18): the real, authenticated Academic Flight Deck for a student with a high school program.
 * Data: GET /api/student/academic-projection (shared/academic-projection-contract.ts). Read-only.
 * Renders inside the normal student shell (the shell provides navigation). No synthetic data is imported here.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { BookOpen, FileText, HelpCircle } from "lucide-react";
import type { AcademicProjection } from "@shared/academic-projection-contract";
import { StudentSurface } from "@/components/student-progress/student-ui";
import { ProgressError } from "@/components/student-progress/states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AcademicCoverage,
  AcademicGauge,
  AcademicLegend,
  AcademicMilestones,
  AcademicNextActions,
  AcademicSubjectSheet,
  AcademicSubjectStrips,
} from "@/components/os/academic-instruments";
import { isNoHighSchoolEnrollment, useAcademicProjection } from "@/lib/academic-projection-queries";
import {
  MODE_OPTIONS,
  buildCoverage,
  buildGauge,
  buildHeadline,
  buildLegend,
  buildMilestones,
  buildNextActions,
  buildProvenance,
  buildSubjectDetail,
  buildSubjectStrips,
  configText,
  creditsText,
  deckState,
  graduationText,
  paceText,
  type ViewMode,
} from "@/lib/academic-flight-deck-presentation";
import "@/styles/flight-deck-preview.css";
import "@/styles/academic-flight-deck.css";

function Shell({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <StudentSurface testId={testId}>
      <div className="fdp fdp-live">{children}</div>
    </StudentSurface>
  );
}

function Loading() {
  return (
    <StudentSurface testId="hs-flight-deck-loading">
      <div className="fdp fdp-live" role="status" aria-label="Loading your Flight Deck" data-testid="hs-flight-deck-skeleton">
        <div className="fdl-skel">
          <Skeleton className="h-8 w-64" />
          <div style={{ height: 280 }} />
          <div style={{ height: 180 }} />
        </div>
      </div>
    </StudentSurface>
  );
}

function NoEnrollment() {
  return (
    <Shell testId="hs-flight-deck-no-enrollment">
      <section className="fdl-state">
        <h1>No high school program yet</h1>
        <p>Your account does not have a high school program, so there is no credit plan to show. If you expected one, your Lumière team can check.</p>
        <div className="fdl-state-actions">
          <Link href="/support" className="fdl-btn" data-primary="true" data-testid="link-support">Ask Lumière</Link>
          <Link href="/profile" className="fdl-btn">Open my profile</Link>
        </div>
      </section>
    </Shell>
  );
}

function NotConfigured({ projection }: { projection: AcademicProjection }) {
  const prov = buildProvenance(projection);
  return (
    <Shell testId="hs-flight-deck-not-configured">
      <section className="fdl-state" data-testid="not-configured">
        <p className="fdp-eyebrow">High School Flight Deck</p>
        <h1>Your plan is being prepared</h1>
        <p>
          {projection.program.title} at {projection.program.schoolDisplayName} is set up, but your course plan and credit requirements are not published yet. We do not
          show a percentage until they are, so there is nothing to measure against.
        </p>
        <p>{prov.officialDefinition}</p>
        {prov.studentMessage && <p className="fdl-message">{prov.studentMessage}</p>}
        <div className="fdl-state-actions">
          <Link href="/high-school" className="fdl-btn" data-primary="true" data-testid="link-high-school">Open My High School</Link>
          <Link href="/support" className="fdl-btn">Ask Lumière</Link>
        </div>
      </section>
    </Shell>
  );
}

export function HighSchoolFlightDeckView({ projection }: { projection: AcademicProjection }) {
  const [mode, setMode] = useState<ViewMode>("verified");
  const [openSubject, setOpenSubject] = useState<string | null>(null);

  const state = deckState(projection);
  const gauge = useMemo(() => buildGauge(projection, mode), [projection, mode]);
  const legend = useMemo(() => buildLegend(projection, mode), [projection, mode]);
  const coverage = useMemo(() => buildCoverage(projection, mode), [projection, mode]);
  const strips = useMemo(() => buildSubjectStrips(projection, mode), [projection, mode]);
  const milestones = useMemo(() => buildMilestones(projection), [projection]);
  const actions = useMemo(() => buildNextActions(projection), [projection]);
  const prov = useMemo(() => buildProvenance(projection), [projection]);
  const subject = projection.subjects.find((s) => s.subject === openSubject) ?? null;
  const detail = subject ? buildSubjectDetail(projection, subject) : null;
  const pace = paceText(projection);
  const officialText = creditsText(gauge.officialHalfUnits);

  return (
    <Shell testId="hs-flight-deck">
      <div className="fdp-page" data-testid="high-school-flight-deck" data-deck-state={state}>
        <div className="fdl-head">
          <div className="fdl-head-main">
            {/*
              RESERVED SLOT: a future text assistant avatar goes here (data-slot="academic-assistant").
              Intentionally empty. No behaviour, no data, no styling beyond hiding itself while empty.
            */}
            <div className="fdl-assistant-slot" data-slot="academic-assistant" data-testid="academic-assistant-slot" />
            <div>
              <p className="fdp-eyebrow">High School Flight Deck</p>
              <h1 className="fdp-h1">Where your credits stand</h1>
              <p className="fdp-sub" data-testid="program-line">
                {projection.program.title} · {projection.program.schoolDisplayName}. Credits are counted in half-units, so a half-credit course is never rounded.
              </p>
            </div>
          </div>
          <div className="fdp-seg" role="radiogroup" aria-label="Which credit to count" data-testid="mode-toggle">
            {MODE_OPTIONS.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)} data-testid={`mode-${m.id}`}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {mode === "projected" && (
          <p className="fdl-mode-note" data-testid="projected-note">
            <b>Including planned</b> adds credit that is awaiting the school, in progress or only planned. It is a projection. Your official credit stays at{" "}
            <b>{officialText}</b>.
          </p>
        )}
        {state === "zero_progress" && (
          <p className="fdl-mode-note" data-testid="zero-progress-note">
            No credit is official yet. That is normal at the start: credit becomes official when {projection.program.schoolDisplayName} confirms a finished course.
          </p>
        )}
        {state === "complete" && (
          <p className="fdl-mode-note" data-testid="complete-note">
            <b>All required credits are official.</b> {graduationText(projection)}
          </p>
        )}

        <div className="fdp-grid">
          <section className="fdp-card fdp-span-8" aria-labelledby="hero-title">
            <div className="fdp-hero">
              <AcademicGauge gauge={gauge} />
              <div className="fdp-hero-copy">
                <h2 id="hero-title" data-testid="hero-headline">{buildHeadline(projection, mode)}</h2>
                <p className="fdl-official-line" data-testid="official-line">Official: {officialText} of {creditsText(gauge.requiredHalfUnits)}</p>
                <AcademicLegend rows={legend} />
                <p className="fdp-config" data-testid="program-config">{configText(projection)}</p>
              </div>
            </div>
          </section>

          <section className="fdp-card fdp-span-4" aria-labelledby="cov-title">
            <div className="fdp-card-head">
              <h2 className="fdp-card-title" id="cov-title">Core and elective coverage</h2>
            </div>
            <div className="fdp-card-body">
              <AcademicCoverage main={coverage.main} areas={coverage.areas} mode={mode} />
            </div>
          </section>

          <section className="fdp-card fdp-span-8" aria-labelledby="subj-title">
            <div className="fdp-card-head" style={{ paddingBottom: 12 }}>
              <h2 className="fdp-card-title" id="subj-title">Subject areas</h2>
              <span className="fdp-card-note">One square = one half-unit. Select a subject for its courses.</span>
            </div>
            {strips.length > 0 ? (
              <AcademicSubjectStrips subjects={strips} onOpen={setOpenSubject} />
            ) : (
              <p className="fdl-empty" data-testid="subjects-empty">No subjects are on your plan yet.</p>
            )}
          </section>

          <section className="fdp-card fdp-span-4" aria-labelledby="ms-title">
            <div className="fdp-card-head">
              <h2 className="fdp-card-title" id="ms-title">Milestones</h2>
              <span className="fdp-card-note">From your published plan</span>
            </div>
            <div className="fdp-card-body">
              {milestones.length > 0 ? <AcademicMilestones milestones={milestones} /> : <p className="fdl-empty" style={{ padding: 0 }} data-testid="milestones-empty">Your plan has no dated milestones.</p>}
            </div>
          </section>

          <section className="fdp-card fdp-span-8" aria-labelledby="next-title">
            <div className="fdp-card-head" style={{ paddingBottom: 8 }}>
              <h2 className="fdp-card-title" id="next-title">Next actions</h2>
              <span className="fdp-card-note">{actions.length === 0 ? "Nothing waiting" : `${actions.length} ${actions.length === 1 ? "item" : "items"}`}</span>
            </div>
            {actions.length > 0 ? (
              <AcademicNextActions actions={actions} />
            ) : (
              <p className="fdl-empty" data-testid="actions-empty">Nothing needs you right now. New tasks and requests appear here.</p>
            )}
          </section>

          <section className="fdp-card fdp-span-4" aria-labelledby="src-title">
            <div className="fdp-card-head" style={{ paddingBottom: 8 }}>
              <h2 className="fdp-card-title" id="src-title">Where this comes from</h2>
            </div>
            <div className="fdp-card-body">
              <div className="fdl-prov" data-testid="provenance">
                <p data-testid="official-definition"><b>{prov.officialDefinition}</b></p>
                <p data-testid="plan-version">{prov.plan}</p>
                <p data-testid="template-line">{prov.template}</p>
                {prov.dates && <p>{prov.dates}.</p>}
                {pace && <p data-testid="pace-line">{pace}</p>}
                <p data-testid="graduation-line">{graduationText(projection)}</p>
                <p>{prov.generated}.</p>
              </div>
              {prov.studentMessage && <p className="fdl-message" data-testid="student-message">{prov.studentMessage}</p>}
            </div>
          </section>
        </div>

        <h2 className="fdp-section-label">Go to</h2>
        <div className="fdp-links" data-testid="quick-links">
          <Link href="/high-school" className="fdp-link" data-testid="quicklink-high-school">
            <span className="fdp-link-top"><BookOpen className="h-5 w-5" aria-hidden="true" /></span>
            <span><span className="fdp-link-title">My High School</span><br /><span className="fdp-link-blurb">Courses, tasks and graduation steps</span></span>
          </Link>
          <Link href="/documents" className="fdp-link" data-testid="quicklink-documents">
            <span className="fdp-link-top"><FileText className="h-5 w-5" aria-hidden="true" /></span>
            <span><span className="fdp-link-title">Documents</span><br /><span className="fdp-link-blurb">Upload and track your files</span></span>
          </Link>
          <Link href="/support" className="fdp-link" data-testid="quicklink-support">
            <span className="fdp-link-top"><HelpCircle className="h-5 w-5" aria-hidden="true" /></span>
            <span><span className="fdp-link-title">Support</span><br /><span className="fdp-link-blurb">Ask Lumière a question</span></span>
          </Link>
        </div>
      </div>

      <AcademicSubjectSheet detail={detail} onClose={() => setOpenSubject(null)} />
    </Shell>
  );
}

export default function HighSchoolFlightDeck() {
  const { data, isLoading, error, refetch } = useAcademicProjection();

  if (isLoading) return <Loading />;
  if (error) {
    if (isNoHighSchoolEnrollment(error)) return <NoEnrollment />;
    return (
      <StudentSurface testId="hs-flight-deck-error">
        <ProgressError message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
      </StudentSurface>
    );
  }
  if (!data) return <Loading />;
  if (deckState(data) === "not_configured") return <NotConfigured projection={data} />;
  return <HighSchoolFlightDeckView projection={data} />;
}
