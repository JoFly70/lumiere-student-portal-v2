/**
 * Data access for the S27 student journey (shared/s27-contract.ts).
 *   GET  /api/student/journey              -> StudentJourneyView
 *   POST /api/student/orientation-sessions -> request an orientation session
 *
 * The journey endpoint is built in parallel with this UI. A 404 / 501 / 503 never breaks a page: it becomes the
 * designed "not available yet" state (`journeyUnavailable`), and every consumer renders without the journey.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { S27_API, S27_ERROR_CODES, type OrientationSessionView, type StudentJourneyView } from "@shared/s27-contract";
import { ApiError } from "@/lib/api";
import { hsRequest } from "@/lib/high-school-queries";

export const JOURNEY_QUERY_KEY = [S27_API.studentJourney] as const;

/** True when the endpoint is missing or not ready: show the designed empty state, not an error. */
export function journeyUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 501 || error.status === 503);
}

export function useStudentJourney(enabled = true) {
  const query = useQuery<StudentJourneyView>({
    queryKey: [...JOURNEY_QUERY_KEY],
    queryFn: () => hsRequest<StudentJourneyView>(S27_API.studentJourney),
    enabled,
    retry: (count, error) => !journeyUnavailable(error) && !(error instanceof ApiError && error.status < 500) && count < 1,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  return {
    journey: query.data ?? null,
    isLoading: enabled && query.isLoading,
    /** The endpoint answered 404 / 501 / 503: nothing prepared yet (or not deployed). */
    unavailable: query.isError && journeyUnavailable(query.error),
    /** A real failure (network, 500). */
    failed: query.isError && !journeyUnavailable(query.error),
    refetch: query.refetch,
  };
}

export interface RequestSessionInput {
  readonly slotAt: string;
  readonly prep: Readonly<Record<string, readonly string[]>>;
  readonly channel?: "portal" | "whatsapp";
}

export type SessionFailure = "none_left" | "unavailable" | "error";

export function interpretSessionError(error: unknown): { kind: SessionFailure; message: string } {
  if (error instanceof ApiError) {
    if (error.code === S27_ERROR_CODES.NO_SESSIONS_LEFT) return { kind: "none_left", message: error.message };
    if (journeyUnavailable(error)) return { kind: "unavailable", message: error.message };
    return { kind: "error", message: error.message };
  }
  return { kind: "error", message: error instanceof Error ? error.message : "" };
}

export function useRequestOrientationSession() {
  const queryClient = useQueryClient();
  return useMutation<OrientationSessionView | { session: OrientationSessionView } | null, unknown, RequestSessionInput>({
    mutationFn: (input) =>
      hsRequest<OrientationSessionView | { session: OrientationSessionView } | null>(S27_API.studentSessions, {
        method: "POST",
        body: JSON.stringify({ slotAt: input.slotAt, prep: input.prep, channel: input.channel ?? "portal" }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...JOURNEY_QUERY_KEY] });
    },
  });
}
