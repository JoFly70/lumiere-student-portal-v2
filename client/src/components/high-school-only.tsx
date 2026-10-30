/**
 * Guards the high-school-only student pages (/high-school, /high-school/flight-deck). A student whose program is a
 * bachelor's degree never lands on a high-school page: they are sent to the degree equivalent (see
 * HIGH_SCHOOL_ONLY_REDIRECTS). A student with no program at all keeps the page (its empty state is program-neutral),
 * and a student with both programs keeps everything.
 */
import React from "react";
import { Redirect } from "wouter";
import { StudentSurface } from "@/components/student-progress/student-ui";
import { highSchoolRouteRedirect, useStudentPrograms } from "@/lib/student-programs";

export function HighSchoolOnly({ path, children }: { path: string; children: React.ReactNode }) {
  const programs = useStudentPrograms();
  // Wait for the answer so a high-school page never flashes for a degree student.
  if (programs.isLoading) return <StudentSurface><div className="min-h-[40vh]" aria-busy="true" data-testid="programs-loading" /></StudentSurface>;
  const to = highSchoolRouteRedirect(path, programs);
  if (to) return <Redirect to={to} replace />;
  return <>{children}</>;
}
