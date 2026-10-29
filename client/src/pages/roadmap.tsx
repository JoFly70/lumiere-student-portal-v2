/**
 * Roadmap page (S05, redesigned in S27): the degree student's calm view of the Lumière-assigned plan.
 * Credits by source, courses to log (Now / Up next / Completed), and plain-language warnings.
 * Students follow the plan and report activity; they never add, edit or delete courses.
 * Staff keep the full degree plan elsewhere: this is the second view of the same plan.
 *
 * Reads (existing endpoints): GET /api/student/roadmap, GET /api/student/degree-progress.
 * Writes: POST /api/student/roadmap/progress through RoadmapActionsProvider.
 */
import { useQuery } from "@tanstack/react-query";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import type { StudentDegreeProgressView } from "@shared/student-degree-progress-view";
import {
  STUDENT_ROADMAP_QUERY_KEY,
  STUDENT_ROADMAP_QUERY_OPTIONS,
  fetchStudentRoadmap,
  isRoadmapMissingRecord,
} from "@/lib/student-roadmap-queries";
import { DEGREE_PROGRESS_QUERY_KEY, DEGREE_PROGRESS_QUERY_OPTIONS } from "@/lib/student-progress-queries";
import { RoadmapPageView } from "@/components/student-progress/student-roadmap-views";
import { RoadmapActionsProvider } from "@/components/student-progress/roadmap-actions";
import { PlanNotReady, ProgressError, ProgressSkeleton } from "@/components/student-progress/states";
import { StudentSurface } from "@/components/student-progress/student-ui";
import { DegreeJourneyView } from "@/components/degree-journey/degree-journey-view";
import { isPublished } from "@/pages/student-roadmap-presentation";

export default function Roadmap() {
  const { data, isLoading, error, refetch } = useQuery<StudentRoadmapView>({
    queryKey: [...STUDENT_ROADMAP_QUERY_KEY],
    queryFn: fetchStudentRoadmap,
    ...STUDENT_ROADMAP_QUERY_OPTIONS,
  });
  // Canonical progress only sharpens the credit breakdown and warnings; the page works without it.
  const progress = useQuery<StudentDegreeProgressView>({
    queryKey: [...DEGREE_PROGRESS_QUERY_KEY],
    ...DEGREE_PROGRESS_QUERY_OPTIONS,
    enabled: Boolean(data && isPublished(data)),
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
  if (!isPublished(data)) return <RoadmapPageView view={data} />;

  return (
    <RoadmapActionsProvider>
      <DegreeJourneyView roadmap={data} progress={progress.data ?? null} />
    </RoadmapActionsProvider>
  );
}
