/**
 * Flight Deck page (S05): Today first, a single roadmap summary, a compact
 * foundation and the next milestone. Data comes from GET /api/student/roadmap;
 * progress updates write the authoritative view back into the same cache.
 */
import { useQuery } from "@tanstack/react-query";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import { getAuthToken } from "@/lib/api";
import { FLIGHT_DECK_READINESS_QUERY_OPTIONS, type StudentRecordStatus } from "@/lib/student-progress-queries";
import {
  STUDENT_ROADMAP_QUERY_KEY,
  STUDENT_ROADMAP_QUERY_OPTIONS,
  fetchStudentRoadmap,
  isRoadmapMissingRecord,
} from "@/lib/student-roadmap-queries";
import { FlightDeckRoadmapView } from "@/components/student-progress/student-roadmap-views";
import { RoadmapActionsProvider } from "@/components/student-progress/roadmap-actions";
import { PlanNotReady, ProgressError, ProgressSkeleton } from "@/components/student-progress/states";
import { StudentSurface } from "@/components/student-progress/student-ui";

async function fetchStudentRecordStatus(): Promise<StudentRecordStatus> {
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch("/api/students/me", { credentials: "include", headers });
  if (response.status === 404) return "missing";
  if (!response.ok) throw new Error(`Failed to check student profile: ${response.status}`);
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

  return (
    <RoadmapActionsProvider>
      <FlightDeckRoadmapView view={data} />
    </RoadmapActionsProvider>
  );
}
