/**
 * Route component for /flight-deck (S18): picks the High School Flight Deck for high-school-only students and
 * the existing university Flight Deck for everyone else. Waits for the programs lookup so the wrong deck never flashes.
 */
import FlightDeck from "@/pages/flight-deck";
import HighSchoolFlightDeck from "@/pages/high-school-flight-deck";
import { StudentSurface } from "@/components/student-progress/student-ui";
import { flightDeckVariant, useStudentPrograms } from "@/lib/student-programs";
import { useT } from "@/i18n";

export { HighSchoolFlightDeck };

export default function FlightDeckRouter() {
  const access = useStudentPrograms();
  const { t } = useT();
  if (access.isLoading) {
    return (
      <StudentSurface>
        <div className="min-h-[40vh]" aria-busy="true" data-testid="programs-loading" />
      </StudentSurface>
    );
  }
  // S34: a failed lookup must never fall back to the university deck (a high-school student would see the wrong deck).
  if (access.lookupFailed) {
    return (
      <StudentSurface>
        <div className="min-h-[40vh] flex flex-col items-center justify-center gap-3 text-center" role="alert" data-testid="programs-load-error">
          <p className="font-medium">{t("auth.programs.loadError.title")}</p>
          <p className="text-sm text-muted-foreground">{t("auth.programs.loadError.body")}</p>
          <button type="button" className="rounded-md border px-4 py-2 text-sm" onClick={access.retry} data-testid="programs-retry">
            {t("auth.programs.loadError.retry")}
          </button>
        </div>
      </StudentSurface>
    );
  }
  return flightDeckVariant(access) === "high_school" ? <HighSchoolFlightDeck /> : <FlightDeck />;
}
