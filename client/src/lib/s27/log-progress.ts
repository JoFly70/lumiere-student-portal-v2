/**
 * "Log progress" mutation: POST /api/student/high-school/progress (hsStudentProgressSchema) with `expectedRevision`.
 * Optimistic: the task shows as "waiting for the grade" immediately and rolls back if the server refuses.
 * A 409 revision conflict (or a changed plan / locked result) refetches the plan and tells the student.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HS_API, HS_ERROR_CODES, type HsTaskKind, type StudentHighSchoolView } from "@shared/high-school-contract";
import type { StudentJourneyView } from "@shared/s27-contract";
import { ApiError } from "@/lib/api";
import { HS_QUERY_KEY, hsRequest } from "@/lib/high-school-queries";
import { JOURNEY_QUERY_KEY } from "./journey-queries";
import { applyOptimisticProgress } from "./roadmap-model";

export interface LogBody {
  readonly courseKey: string;
  readonly taskKey: string;
  readonly status: "submitted";
  /** Absent = keep any score already reported. */
  readonly reportedScorePercent?: number;
  readonly expectedRevision: number;
}
export interface LogVars { readonly body: LogBody; readonly kind: HsTaskKind }

export type LogFailureKind = "conflict" | "changed" | "locked" | "generic";
export interface LogFailure { readonly kind: LogFailureKind; readonly refetch: boolean; readonly message: string | null }

/** Pure: what the UI does with a failed log. `message` is the server's text for a generic failure (shown as is). */
export function describeLogFailure(error: unknown): LogFailure {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.code === HS_ERROR_CODES.REVISION_CONFLICT) return { kind: "conflict", refetch: true, message: null };
    if (error.code === HS_ERROR_CODES.UNKNOWN_COURSE_OR_TASK) return { kind: "changed", refetch: true, message: null };
    if (error.code === HS_ERROR_CODES.OFFICIAL_RECORD_LOCKED) return { kind: "locked", refetch: true, message: null };
    return { kind: "generic", refetch: false, message: error.message || null };
  }
  return { kind: "generic", refetch: false, message: null };
}

export function useLogHsProgress() {
  const queryClient = useQueryClient();
  return useMutation<StudentHighSchoolView, unknown, LogVars, { previous: StudentHighSchoolView | undefined; previousJourney: StudentJourneyView | undefined }>({
    mutationFn: ({ body }) => hsRequest<StudentHighSchoolView>(HS_API.studentProgress, { method: "POST", body: JSON.stringify(body) }),
    onMutate: async ({ body, kind }) => {
      await queryClient.cancelQueries({ queryKey: [...HS_QUERY_KEY] });
      const previous = queryClient.getQueryData<StudentHighSchoolView>([...HS_QUERY_KEY]);
      const previousJourney = queryClient.getQueryData<StudentJourneyView>([...JOURNEY_QUERY_KEY]);
      if (previous) queryClient.setQueryData([...HS_QUERY_KEY], applyOptimisticProgress(previous, body));
      if (previousJourney?.pace && kind === "exam") {
        queryClient.setQueryData<StudentJourneyView>([...JOURNEY_QUERY_KEY], { ...previousJourney, pace: { ...previousJourney.pace, examsThisWeek: previousJourney.pace.examsThisWeek + 1 } });
      }
      return { previous, previousJourney };
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData([...HS_QUERY_KEY], ctx.previous);
      if (ctx?.previousJourney) queryClient.setQueryData([...JOURNEY_QUERY_KEY], ctx.previousJourney);
      if (describeLogFailure(error).refetch) void queryClient.invalidateQueries({ queryKey: [...HS_QUERY_KEY] });
    },
    onSuccess: (view) => {
      queryClient.setQueryData([...HS_QUERY_KEY], view);
      // The pace is computed from the logs: refresh it.
      void queryClient.invalidateQueries({ queryKey: [...JOURNEY_QUERY_KEY] });
    },
  });
}
