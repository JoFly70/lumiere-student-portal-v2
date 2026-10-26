/**
 * Degree roadmap page: data fetching and the existing self-service enrollment
 * actions. Canonical progress is read-only (see RoadmapView).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Enrollment } from "@shared/schema";
import type { StudentDegreeProgressView } from "@shared/student-degree-progress-view";
import { CourseEntryDialog } from "@/components/course-entry-dialog";
import { CourseEditDialog } from "@/components/course-edit-dialog";
import { CourseAssignmentDialog } from "@/components/course-assignment-dialog";
import { StudyHoursWidget } from "@/components/study-hours-widget";
import { PlanNotReady, ProgressError, ProgressSkeleton } from "@/components/student-progress/states";
import {
  PlannedCoursesSection,
  RoadmapView,
  type PlannedEnrollment,
} from "@/components/student-progress/roadmap-view";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  DEGREE_PROGRESS_QUERY_KEY,
  DEGREE_PROGRESS_QUERY_OPTIONS,
} from "@/lib/student-progress-queries";
import { isMissingRecordError } from "@/pages/student-progress-presentation";

export default function Roadmap() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingEnrollment, setEditingEnrollment] = useState<Enrollment | null>(null);

  const { data: enrollments, isLoading: enrollmentsLoading } = useQuery<Enrollment[]>({
    queryKey: ["/api/enrollments"],
  });

  const {
    data: progress,
    isLoading: progressLoading,
    error: progressError,
    refetch: refetchProgress,
  } = useQuery<StudentDegreeProgressView>({
    queryKey: [...DEGREE_PROGRESS_QUERY_KEY],
    ...DEGREE_PROGRESS_QUERY_OPTIONS,
  });

  const deleteMutation = useMutation({
    mutationFn: async (enrollmentId: string) => {
      return await apiRequest("DELETE", `/api/enrollments/${enrollmentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/enrollments"] });
      toast({
        title: "Course deleted",
        description: "The course has been removed from your roadmap.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete course",
        variant: "destructive",
      });
    },
  });

  const handleDelete = (enrollment: PlannedEnrollment) => {
    if (confirm(`Are you sure you want to delete "${enrollment.title}"?`)) {
      deleteMutation.mutate(enrollment.id);
    }
  };

  const planned = (enrollments ?? []) as unknown as PlannedEnrollment[];
  const actions = (
    <>
      <CourseAssignmentDialog />
      <CourseEntryDialog />
    </>
  );

  const editDialog = editingEnrollment && (
    <CourseEditDialog
      enrollment={editingEnrollment}
      open={!!editingEnrollment}
      onOpenChange={(open) => !open && setEditingEnrollment(null)}
    />
  );

  if (progressLoading) return <ProgressSkeleton />;

  if (isMissingRecordError(progressError)) return <PlanNotReady />;

  if (progressError || !progress) {
    return (
      <div className="space-y-8">
        <ProgressError
          message={progressError instanceof Error ? progressError.message : undefined}
          onRetry={() => refetchProgress()}
        />
        <div className="mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6">
          <PlannedCoursesSection
            enrollments={planned}
            loading={enrollmentsLoading}
            onEdit={(e) => setEditingEnrollment(e as unknown as Enrollment)}
            onDelete={handleDelete}
            deleting={deleteMutation.isPending}
            actions={actions}
          />
        </div>
        {editDialog}
      </div>
    );
  }

  return (
    <>
      <RoadmapView
        view={progress}
        enrollments={planned}
        enrollmentsLoading={enrollmentsLoading}
        onEditEnrollment={(e) => setEditingEnrollment(e as unknown as Enrollment)}
        onDeleteEnrollment={handleDelete}
        deletingEnrollment={deleteMutation.isPending}
        enrollmentActions={actions}
        extras={<StudyHoursWidget />}
      />
      {editDialog}
    </>
  );
}
