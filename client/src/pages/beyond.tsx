/**
 * Beyond the Diploma (high-school students) / Beyond the Bachelor's (everyone else): orientation study, future-self
 * timeline, careers, preparation checklist, orientation sessions and à la carte services.
 * Data: StudentJourneyView (GET /api/student/journey; 404/503 = designed empty state) and the student's high school view.
 */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { STUDENT_ROADMAP_QUERY_KEY, STUDENT_ROADMAP_QUERY_OPTIONS, fetchStudentRoadmap } from "@/lib/student-roadmap-queries";
import { degreePlanDates } from "@/lib/s27/degree-cockpit-model";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import { StudentSurface } from "@/components/student-progress/student-ui";
import { Skeleton } from "@/components/ui/skeleton";
import { BeyondPage, type BookResult, type ServiceResult } from "@/components/s27/beyond";
import { LUMIERE_WHATSAPP_URL } from "@/components/support/whatsapp-contact";
import { useToast } from "@/hooks/use-toast";
import { useHighSchoolView } from "@/lib/high-school-queries";
import { SERVICES, type ServiceId } from "@/lib/s27/beyond-model";
import { useS27T } from "@/lib/s27/i18n-util";
import { interpretSessionError, useRequestOrientationSession, useStudentJourney } from "@/lib/s27/journey-queries";
import { useSupportRequest } from "@/lib/s27/use-support-request";
import { useStudentPrograms } from "@/lib/student-programs";
import { todayIso } from "@/pages/high-school-presentation";

export default function Beyond() {
  const { t } = useS27T();
  const { toast } = useToast();
  const programs = useStudentPrograms();
  const hs = useHighSchoolView(programs.hasHighSchool);
  const journey = useStudentJourney();
  // Degree-only students have no high-school finish date: read the degree roadmap's graduation milestone (same endpoint
  // and cache as /roadmap). Optional: any failure just leaves the intake year based on today.
  const degreeRoadmap = useQuery<StudentRoadmapView>({
    queryKey: [...STUDENT_ROADMAP_QUERY_KEY],
    queryFn: fetchStudentRoadmap,
    ...STUDENT_ROADMAP_QUERY_OPTIONS,
    retry: false,
    enabled: !programs.isLoading && !programs.hasHighSchool,
  });
  const graduationOn = degreeRoadmap.data ? degreePlanDates(degreeRoadmap.data).graduationOn : null;
  const booking = useRequestOrientationSession();
  const support = useSupportRequest();

  if (programs.isLoading) {
    return (
      <StudentSurface testId="beyond-loading">
        <div role="status" aria-label={t("s27.bd.loading")}><Skeleton className="h-96 w-full rounded-2xl" /></div>
      </StudentSurface>
    );
  }

  const onBook = async (slot: Date, prep: Record<string, string[]>): Promise<BookResult> => {
    try {
      await booking.mutateAsync({ slotAt: slot.toISOString(), prep, channel: "portal" });
      return { ok: true };
    } catch (error) {
      return { ok: false, kind: interpretSessionError(error).kind };
    }
  };
  const onService = async (id: ServiceId, title: string): Promise<ServiceResult> => {
    const svc = SERVICES.find((s) => s.id === id)!;
    const res = await support.request({ topic: svc.topic, subject: t("s27.bd.svc.reqSubject", { service: title }), description: t("s27.bd.svc.reqBody", { service: title }) });
    return res.ok ? { ok: true, ticketNumber: res.ticketNumber } : { ok: false, message: res.message };
  };
  const state = journey.isLoading ? "loading" : journey.unavailable ? "unavailable" : journey.failed ? "failed" : "ready";
  return (
    <BeyondPage
      kind={programs.hasHighSchool ? "diploma" : "bachelor"}
      hs={hs.data ?? null}
      journey={journey.journey}
      journeyState={state}
      graduationOn={graduationOn}
      today={todayIso()}
      now={new Date()}
      whatsapp={LUMIERE_WHATSAPP_URL}
      onBook={onBook}
      onService={onService}
      notify={(title, description, destructive) => toast({ title, description, variant: destructive ? "destructive" : undefined })}
    />
  );
}
