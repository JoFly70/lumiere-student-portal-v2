/**
 * Beyond the Diploma (high-school students) / Beyond the Bachelor's (everyone else): orientation study, future-self
 * timeline, careers, preparation checklist, orientation sessions and à la carte services.
 * Data: StudentJourneyView (GET /api/student/journey; 404/503 = designed empty state) and the student's high school view.
 */
import React from "react";
import { StudentSurface } from "@/components/student-progress/student-ui";
import { Skeleton } from "@/components/ui/skeleton";
import { BeyondPage, type BookResult, type ServiceResult } from "@/components/s27/beyond";
import { configuredWhatsapp } from "@/components/s27/support-lead";
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
      today={todayIso()}
      now={new Date()}
      whatsapp={configuredWhatsapp()}
      onBook={onBook}
      onService={onService}
      notify={(title, description, destructive) => toast({ title, description, variant: destructive ? "destructive" : undefined })}
    />
  );
}
