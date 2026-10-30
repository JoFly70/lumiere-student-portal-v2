/**
 * Flight Deck page for degree (bachelor's) students. Since the shared-cockpit change it renders the same S27 cockpit as
 * the high-school deck (components/s27/degree-flight-deck.tsx), fed from GET /api/student/roadmap and
 * GET /api/student/degree-progress, with no Today / Journey / Progress / Foundation / Horizon tabs. A roadmap Lumière has
 * not published yet keeps the existing "plan is being prepared" view.
 */
import { useQuery } from "@tanstack/react-query";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import { getAuthToken } from "@/lib/api";
import type { StudentDegreeProgressView } from "@shared/student-degree-progress-view";
import {
  DEGREE_PROGRESS_QUERY_KEY, DEGREE_PROGRESS_QUERY_OPTIONS, FLIGHT_DECK_READINESS_QUERY_OPTIONS, type StudentRecordStatus,
} from "@/lib/student-progress-queries";
import {
  STUDENT_ROADMAP_QUERY_KEY,
  STUDENT_ROADMAP_QUERY_OPTIONS,
  fetchStudentRoadmap,
  isRoadmapMissingRecord,
} from "@/lib/student-roadmap-queries";
import { WelcomeBanner } from "@/components/cockpit/welcome-banner";
import { DegreeFlightDeck } from "@/components/s27/degree-flight-deck";
import type { DeckBilling, DeckDoc, JourneyState } from "@/components/s27/deck-parts";
import { FlightDeckRoadmapView } from "@/components/student-progress/student-roadmap-views";
import { RequirementDetails } from "@/components/student-progress/requirement-details";
import { PlanNotReady, ProgressError, ProgressSkeleton } from "@/components/student-progress/states";
import { StudentSurface } from "@/components/student-progress/student-ui";
import { isPublished } from "@/pages/student-roadmap-presentation";
import { useMyProfile, useDocuments } from "@/hooks/use-documents";
import { useStudentProfile } from "@/hooks/use-student-profile";
import { useTickets } from "@/hooks/use-tickets";
import { useStudentBilling } from "@/lib/billing-queries";
import { useStudentJourney } from "@/lib/s27/journey-queries";
import { ApiError } from "@/lib/api";
import { todayIso } from "@/pages/high-school-presentation";

async function fetchStudentRecordStatus(): Promise<StudentRecordStatus> {
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch("/api/students/me", { credentials: "include", headers });
  if (response.status === 404) return "missing";
  if (!response.ok) throw new Error(`Failed to check student profile: ${response.status}`);
  return "ready";
}

/** The degree cockpit: the roadmap is published; everything else (progress, journey, documents, billing) is optional and degrades to a designed empty state. */
function DegreeDeckContainer({ roadmap }: { roadmap: StudentRoadmapView }) {
  const progress = useQuery<StudentDegreeProgressView>({ queryKey: [...DEGREE_PROGRESS_QUERY_KEY], ...DEGREE_PROGRESS_QUERY_OPTIONS });
  const { data: profile } = useStudentProfile();
  const journey = useStudentJourney();
  const me = useMyProfile();
  const docs = useDocuments(me.data?.id ?? null);
  const tickets = useTickets({ limit: 100 });
  const billing = useStudentBilling();
  const identity = profile?.identity;
  const name = identity ? (identity.preferredName?.trim() || identity.firstName) : null;
  const journeyState: JourneyState = journey.isLoading ? "loading" : journey.unavailable ? "unavailable" : journey.failed ? "failed" : "ready";
  const documents: readonly DeckDoc[] | null | "loading" = me.isLoading || (me.data && docs.isLoading) ? "loading" : docs.data ? (docs.data as unknown as readonly DeckDoc[]) : null;
  const deckBilling: DeckBilling = billing.isLoading ? "loading" : billing.data ?? (billing.error instanceof ApiError && billing.error.status === 404 ? null : "unavailable");
  return (
    <DegreeFlightDeck
      roadmap={roadmap}
      progress={progress.data ?? null}
      journey={journey.journey}
      journeyState={journeyState}
      firstName={name}
      documents={documents}
      tickets={tickets.data?.tickets ?? null}
      billing={deckBilling}
      today={todayIso()}
      hour={new Date().getHours()}
    />
  );
}

export default function FlightDeck() {
  const {
    data: studentRecordStatus,
    isLoading: studentRecordLoading,
    error: studentRecordError,
    refetch: refetchStudentRecord,
  } = useQuery<StudentRecordStatus>({
    queryKey: ["/api/students/me", "flight-deck-readiness"],
    queryFn: fetchStudentRecordStatus,
    ...FLIGHT_DECK_READINESS_QUERY_OPTIONS,
  });

  const { data, isLoading, error, refetch } = useQuery<StudentRoadmapView>({
    queryKey: [...STUDENT_ROADMAP_QUERY_KEY],
    queryFn: fetchStudentRoadmap,
    ...STUDENT_ROADMAP_QUERY_OPTIONS,
    enabled: studentRecordStatus === "ready",
  });

  const wrap = (node: React.ReactNode) => <StudentSurface>{node}</StudentSurface>;

  if (studentRecordLoading) return wrap(<ProgressSkeleton />);

  if (studentRecordError) {
    return wrap(
      <div data-testid="flight-deck-profile-error">
        <ProgressError
          message={studentRecordError instanceof Error ? studentRecordError.message : undefined}
          onRetry={() => refetchStudentRecord()}
        />
      </div>,
    );
  }

  if (studentRecordStatus === "missing" || isRoadmapMissingRecord(error)) return wrap(<PlanNotReady />);
  if (isLoading) return wrap(<ProgressSkeleton />);
  if (error) {
    return wrap(
      <ProgressError message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />,
    );
  }
  if (!data) return null;

  // Not published yet: the existing "your plan is being prepared" view (it has no tabs).
  if (!isPublished(data)) return <FlightDeckRoadmapView view={data} requirementDetails={<RequirementDetails />} banner={<WelcomeBanner />} />;
  return <DegreeDeckContainer roadmap={data} />;
}
