/**
 * Route component for /flight-deck (S18): picks the High School Flight Deck for high-school-only students and
 * the existing university Flight Deck for everyone else. Waits for the programs lookup so the wrong deck never flashes.
 */
import FlightDeck from "@/pages/flight-deck";
import HighSchoolFlightDeck from "@/pages/high-school-flight-deck";
import { StudentSurface } from "@/components/student-progress/student-ui";
import { flightDeckVariant, useStudentPrograms } from "@/lib/student-programs";

export { HighSchoolFlightDeck };

export default function FlightDeckRouter() {
  const access = useStudentPrograms();
  if (access.isLoading) {
    return (
      <StudentSurface>
        <div className="min-h-[40vh]" aria-busy="true" data-testid="programs-loading" />
      </StudentSurface>
    );
  }
  return flightDeckVariant(access) === "high_school" ? <HighSchoolFlightDeck /> : <FlightDeck />;
}
