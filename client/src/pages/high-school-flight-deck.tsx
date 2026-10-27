/**
 * High School Flight Deck (S19 cockpit): one-page overview of the student's educational journey.
 * Data: GET /api/student/academic-projection (shared/academic-projection-contract.ts) plus the existing documents,
 * support and billing queries for the operational pulse. Read-only. No synthetic data is imported here.
 * Renders inside the normal student shell (the shell provides navigation).
 */
import { Link } from "wouter";
import type { AcademicProjection } from "@shared/academic-projection-contract";
import { StudentSurface } from "@/components/student-progress/student-ui";
import { Skeleton } from "@/components/ui/skeleton";
import { CockpitView } from "@/components/cockpit/cockpit-view";
import { useCockpitOps } from "@/components/cockpit/use-cockpit-ops";
import { useT } from "@/i18n";
import { isNoHighSchoolEnrollment, useAcademicProjection } from "@/lib/academic-projection-queries";
import { deckState } from "@/lib/academic-flight-deck-presentation";
import { WelcomeBanner } from "@/components/cockpit/welcome-banner";
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
  const { t } = useT();
  return (
    <StudentSurface testId="hs-flight-deck-loading">
      <div className="fdp fdp-live" role="status" aria-label={t("cockpit.loading")} data-testid="hs-flight-deck-skeleton">
        <div className="ck">
          <Skeleton className="h-16 w-full max-w-md" />
          <div className="ck-grid" style={{ marginTop: 16 }}>
            <Skeleton className="ck-skel-hero" />
            <Skeleton className="ck-skel-hero" />
            <Skeleton className="ck-skel-hero" />
          </div>
          <Skeleton className="h-16 w-full" style={{ marginTop: 16 }} />
        </div>
      </div>
    </StudentSurface>
  );
}

function NoEnrollment() {
  const { t } = useT();
  return (
    <Shell testId="hs-flight-deck-no-enrollment">
      <section className="fdl-state">
        <h1>{t("cockpit.state.noEnrollment.title")}</h1>
        <p>{t("cockpit.state.noEnrollment.body")}</p>
        <div className="fdl-state-actions">
          <Link href="/support" className="fdl-btn" data-primary="true" data-testid="link-support">{t("cockpit.state.ask")}</Link>
          <Link href="/profile" className="fdl-btn">{t("cockpit.state.profile")}</Link>
        </div>
      </section>
    </Shell>
  );
}

export function CockpitNotConfigured({ projection }: { projection: AcademicProjection }) {
  const { t } = useT();
  const message = projection.provenance.studentMessage;
  return (
    <Shell testId="hs-flight-deck-not-configured">
      <section className="fdl-state" data-testid="not-configured">
        <p className="fdp-eyebrow">{t("cockpit.eyebrow")}</p>
        <h1>{t("cockpit.state.notConfigured.title")}</h1>
        <p>{t("cockpit.state.notConfigured.body", { program: projection.program.title, school: projection.program.schoolDisplayName })}</p>
        {message && <p className="fdl-message">{message}</p>}
        <div className="fdl-state-actions">
          <Link href="/high-school" className="fdl-btn" data-primary="true" data-testid="link-high-school">{t("cockpit.state.openHighSchool")}</Link>
          <Link href="/support" className="fdl-btn">{t("cockpit.state.ask")}</Link>
        </div>
      </section>
    </Shell>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useT();
  return (
    <Shell testId="hs-flight-deck-error">
      <section className="fdl-state" role="alert" data-testid="flight-deck-error">
        <h1>{t("cockpit.state.error.title")}</h1>
        <p>{t("cockpit.state.error.body")}</p>
        <div className="fdl-state-actions">
          <button type="button" className="fdl-btn" data-primary="true" onClick={onRetry} data-testid="button-retry">{t("cockpit.state.retry")}</button>
        </div>
      </section>
    </Shell>
  );
}

export function HighSchoolFlightDeckView({ projection }: { projection: AcademicProjection }) {
  const { ops, firstName } = useCockpitOps();
  return (
    <Shell testId="hs-flight-deck">
      <CockpitView projection={projection} firstName={firstName} ops={ops} banner={<WelcomeBanner />} />
    </Shell>
  );
}

export default function HighSchoolFlightDeck() {
  const { data, isLoading, error, refetch } = useAcademicProjection();
  if (isLoading) return <Loading />;
  if (error) return isNoHighSchoolEnrollment(error) ? <NoEnrollment /> : <LoadError onRetry={() => refetch()} />;
  if (!data) return <Loading />;
  if (deckState(data) === "not_configured") return <CockpitNotConfigured projection={data} />;
  return <HighSchoolFlightDeckView projection={data} />;
}
