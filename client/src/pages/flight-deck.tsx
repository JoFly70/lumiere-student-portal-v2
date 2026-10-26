/**
 * Flight Deck page: data fetching only. The student's academic position comes
 * from the canonical degree-progress endpoint; see FlightDeckView for the UI.
 *
 * The legacy /api/flight-deck estimates (pace, timeline, cost) are not part of
 * the academic record and are intentionally no longer shown here.
 */
import { useQuery } from "@tanstack/react-query";
import type { StudentDegreeProgressView } from "@shared/student-degree-progress-view";
import { getAuthToken } from "@/lib/api";
import {
  DEGREE_PROGRESS_QUERY_KEY,
  DEGREE_PROGRESS_QUERY_OPTIONS,
  FLIGHT_DECK_READINESS_QUERY_OPTIONS,
  type StudentRecordStatus,
} from "@/lib/student-progress-queries";
import { FlightDeckView } from "@/components/student-progress/flight-deck-view";
import { PlanNotReady, ProgressError, ProgressSkeleton } from "@/components/student-progress/states";
import { isMissingRecordError } from "@/pages/student-progress-presentation";

async function fetchStudentRecordStatus(): Promise<StudentRecordStatus> {
  const token = getAuthToken();
  const headers: Record<string, string> = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch("/api/students/me", {
    credentials: "include",
    headers,
  });

  if (response.status === 404) {
    return "missing";
  }

  if (!response.ok) {
    throw new Error(`Failed to check student profile: ${response.status}`);
  }

  return "ready";
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

  const { data, isLoading, error, refetch } = useQuery<StudentDegreeProgressView>({
    queryKey: [...DEGREE_PROGRESS_QUERY_KEY],
    ...DEGREE_PROGRESS_QUERY_OPTIONS,
    enabled: studentRecordStatus === "ready",
  });

  if (studentRecordLoading) return <ProgressSkeleton />;

  if (studentRecordError) {
    return (
      <div data-testid="flight-deck-profile-error">
        <ProgressError
          message={studentRecordError instanceof Error ? studentRecordError.message : undefined}
          onRetry={() => refetchStudentRecord()}
        />
      </div>
    );
  }

  if (studentRecordStatus === "missing" || isMissingRecordError(error)) {
    return <PlanNotReady />;
  }

  if (isLoading) return <ProgressSkeleton />;

  if (error) {
    return (
      <ProgressError
        message={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  if (!data) return null;

  return <FlightDeckView view={data} />;
}
