/**
 * Guards the university-only student pages (Flight Deck, Roadmap). A student whose only program is the
 * high school diploma gets a short, truthful notice and a link to their own page, not an empty university dashboard.
 */
import React from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { StudentSurface, buttonClass } from "@/components/student-progress/student-ui";
import { HIGH_SCHOOL_PATH, useStudentPrograms } from "@/lib/student-programs";

export function UniversityOnly({ children }: { children: React.ReactNode }) {
  const { highSchoolOnly, isLoading } = useStudentPrograms();
  // Wait for the answer so the university page never flashes for a high school student.
  if (isLoading) return <StudentSurface><div className="min-h-[40vh]" aria-busy="true" data-testid="programs-loading" /></StudentSurface>;
  if (!highSchoolOnly) return <>{children}</>;
  return (
    <StudentSurface testId="university-only-notice">
      <div className="mx-auto max-w-xl space-y-4 py-8">
        <h1 className="font-serif text-3xl tracking-tight text-student-ink">This page is for university programs</h1>
        <p className="text-base leading-relaxed text-student-muted">
          You are enrolled in the high school diploma program, so there is no university roadmap or credit plan to show here. Your courses, credits and graduation steps are on your High School page.
        </p>
        <Link href={HIGH_SCHOOL_PATH} className={buttonClass.primary} data-testid="link-go-high-school">
          Go to my High School page
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </StudentSurface>
  );
}
