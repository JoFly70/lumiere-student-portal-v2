/**
 * Roadmap page (S05): the Lumière-assigned journey. Students follow it and
 * report activity; they never add, edit or delete courses or change the plan.
 */
import { useQuery } from "@tanstack/react-query";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import {
  STUDENT_ROADMAP_QUERY_KEY,
  STUDENT_ROADMAP_QUERY_OPTIONS,
  fetchStudentRoadmap,
  isRoadmapMissingRecord,
} from "@/lib/student-roadmap-queries";
import { RoadmapPageView } from "@/components/student-progress/student-roadmap-views";
import { RoadmapActionsProvider } from "@/components/student-progress/roadmap-actions";
import { PlanNotReady, ProgressError, ProgressSkeleton } from "@/components/student-progress/states";
import { StudentSurface } from "@/components/student-progress/student-ui";

export default function Roadmap() {
  const { data, isLoading, error, refetch } = useQuery<StudentRoadmapView>({
    queryKey: [...STUDENT_ROADMAP_QUERY_KEY],
    queryFn: fetchStudentRoadmap,
    ...STUDENT_ROADMAP_QUERY_OPTIONS,
  });

  if (isLoading) return <StudentSurface><ProgressSkeleton /></StudentSurface>;
  if (isRoadmapMissingRecord(error)) return <StudentSurface><PlanNotReady /></StudentSurface>;
  if (error || !data) {
    return (
      <StudentSurface>
        <ProgressError message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
      </StudentSurface>
    );
  }

  return (
    <RoadmapActionsProvider>
      <RoadmapPageView view={data} />
    </RoadmapActionsProvider>
  );
}
