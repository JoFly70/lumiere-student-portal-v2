/**
 * High School Pathway (S11): the student's separate high school program.
 * Data: GET /api/student/high-school (404 HS_NO_ENROLLMENT when not set up).
 * Credits are official only when the awarding school confirmed them.
 */
import React from "react";
import { HighSchoolPageView } from "@/components/high-school/high-school-view";
import { HsActionsProvider } from "@/components/high-school/hs-actions";
import { HsError, HsNoEnrollment, HsSkeleton } from "@/components/high-school/states";
import { StudentSurface } from "@/components/student-progress/student-ui";
import { useStudentProfile } from "@/hooks/use-student-profile";
import { useSearch } from "wouter";
import { isNoEnrollment, useHighSchoolView } from "@/lib/high-school-queries";

export default function HighSchool() {
  const { data, isLoading, error, refetch } = useHighSchoolView();
  const { data: profile } = useStudentProfile();
  const course = new URLSearchParams(useSearch()).get("course");
  const identity = profile?.identity;
  const name = identity ? (identity.preferredName?.trim() || identity.firstName) : "";
  const welcome = identity && name ? { name, photoUrl: identity.photoUrl ?? null } : null;

  if (isLoading) return <StudentSurface><HsSkeleton /></StudentSurface>;
  if (isNoEnrollment(error)) return <StudentSurface><HsNoEnrollment /></StudentSurface>;
  if (error || !data) {
    return (
      <StudentSurface>
        <HsError message={error instanceof Error ? error.message : undefined} onRetry={() => void refetch()} />
      </StudentSurface>
    );
  }
  return (
    <HsActionsProvider>
      <HighSchoolPageView view={data} welcome={welcome} initialTab="roadmap" defaultOpenCourse={course} />
    </HsActionsProvider>
  );
}
