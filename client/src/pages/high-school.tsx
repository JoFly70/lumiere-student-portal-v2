/**
 * High School Pathway: the student's "Your Roadmap". S27: log-first view (RoadmapLog). The earlier four-tab page
 * (journey, subjects, graduation, family) stays reachable at /high-school?view=details.
 * Data: GET /api/student/high-school (404 HS_NO_ENROLLMENT when not set up) + GET /api/student/journey (optional).
 * Credits are official only when the awarding school confirmed them.
 */
import React from "react";
import { HighSchoolPageView } from "@/components/high-school/high-school-view";
import { HsActionsProvider } from "@/components/high-school/hs-actions";
import { HsError, HsNoEnrollment, HsNoRoadmap, HsSkeleton } from "@/components/high-school/states";
import { StudentSurface } from "@/components/student-progress/student-ui";
import { RoadmapLog, type LogSubmit, type LogResult } from "@/components/s27/roadmap-log";
import { useStudentProfile } from "@/hooks/use-student-profile";
import { useToast } from "@/hooks/use-toast";
import { useSearch } from "wouter";
import { isNoEnrollment, useHighSchoolView } from "@/lib/high-school-queries";
import { useStudentJourney } from "@/lib/s27/journey-queries";
import { describeLogFailure, useLogHsProgress } from "@/lib/s27/log-progress";
import { useS27T } from "@/lib/s27/i18n-util";
import { todayIso } from "@/pages/high-school-presentation";
import type { TranslationKey } from "@/i18n";

function LogRoadmap({ view }: { view: NonNullable<ReturnType<typeof useHighSchoolView>["data"]> }) {
  const { t } = useS27T();
  const { toast } = useToast();
  const journey = useStudentJourney();
  const mutation = useLogHsProgress();
  const params = new URLSearchParams(useSearch());
  const onLog = async (input: LogSubmit): Promise<LogResult> => {
    try {
      await mutation.mutateAsync({ body: input.body, kind: input.kind });
      toast({
        title: t("s27.log.toast.saved"),
        description: input.mode === "graded" && input.body.reportedScorePercent !== null
          ? t("s27.log.toast.graded", { item: input.label, score: input.body.reportedScorePercent })
          : t("s27.log.toast.sent", { item: input.label }),
      });
      return { ok: true };
    } catch (error) {
      const f = describeLogFailure(error);
      const key: TranslationKey = f.kind === "conflict" ? "s27.log.err.conflict" : f.kind === "changed" ? "s27.log.err.changed" : f.kind === "locked" ? "s27.log.err.locked" : "s27.log.err.generic";
      const message = f.kind === "generic" && f.message ? f.message : t(key);
      toast({ title: f.refetch ? t("s27.log.toast.conflict") : t("s27.log.toast.failed"), description: message, variant: "destructive" });
      return { ok: false, message };
    }
  };
  return (
    <RoadmapLog view={view} journey={journey.journey} today={todayIso()} initialLog={params.get("log")} onLog={onLog} detailsHref="/high-school?view=details" />
  );
}

export default function HighSchool() {
  const { data, isLoading, error, refetch } = useHighSchoolView();
  const { data: profile } = useStudentProfile();
  const search = new URLSearchParams(useSearch());
  const course = search.get("course");
  const details = search.get("view") === "details" || !!course;
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
  if (!details && data.roadmap) {
    return <HsActionsProvider><LogRoadmap view={data} /></HsActionsProvider>;
  }
  return (
    <HsActionsProvider>
      <HighSchoolPageView view={data} welcome={welcome} initialTab="roadmap" defaultOpenCourse={course} />
    </HsActionsProvider>
  );
}
