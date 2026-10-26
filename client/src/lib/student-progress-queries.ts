/**
 * Query options for the student's canonical academic experience (S04).
 *
 * Kept free of React so the caching contract can be unit tested.
 */

/** How often a "missing" student record is re-checked while the page stays open. */
export const STUDENT_RECORD_MISSING_POLL_MS = 60_000;

export type StudentRecordStatus = "ready" | "missing";

/**
 * The global QueryClient default is `staleTime: Infinity`, which would pin a
 * cached "missing" answer until a hard reload. Readiness is therefore always
 * treated as stale, re-checked on mount and on focus, and polled at a modest
 * interval only while the record is still missing.
 */
export const FLIGHT_DECK_READINESS_QUERY_OPTIONS = {
  retry: false,
  staleTime: 0,
  refetchOnMount: "always",
  refetchOnWindowFocus: true,
  refetchInterval: (query: { state: { data?: StudentRecordStatus } }) =>
    query.state.data === "missing" ? STUDENT_RECORD_MISSING_POLL_MS : false,
} as const;

export const DEGREE_PROGRESS_QUERY_KEY = ["/api/student/degree-progress"] as const;

/** Canonical progress can change when staff verify records; keep it fresh. */
export const DEGREE_PROGRESS_QUERY_OPTIONS = {
  retry: 1,
  staleTime: 30_000,
  refetchOnMount: "always",
  refetchOnWindowFocus: true,
} as const;
