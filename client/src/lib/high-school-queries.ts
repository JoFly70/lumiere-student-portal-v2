/**
 * Data access for the student High School Pathway (S11).
 *
 * Every mutation returns the authoritative StudentHighSchoolView, which replaces
 * the cached query data. Error interpretation is pure so it is unit testable.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HS_API, HS_ERROR_CODES, type HsStudentProgressInput, type StudentHighSchoolView } from "@shared/high-school-contract";
import { ApiError, getAuthToken, freshCsrfToken } from "@/lib/api";

/** fetch that understands the contract's `{ error: { code, message } }` envelope (and the flat legacy shape). */
export async function hsRequest<T>(url: string, init: { method?: string; body?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    const csrf = await freshCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  const response = await fetch(url, { method: init.method ?? "GET", credentials: "include", headers, body: init.body });
  if (!response.ok) {
    let code: string | undefined;
    let message = `Request failed (${response.status})`;
    let details: unknown;
    try {
      const body = await response.json();
      const err = body?.error;
      if (err && typeof err === "object") {
        if (typeof err.code === "string") code = err.code;
        if (typeof err.message === "string") message = err.message;
        details = err.details;
      } else if (typeof err === "string") {
        message = err;
        if (typeof body.code === "string") code = body.code;
      }
    } catch {
      /* keep defaults */
    }
    throw new ApiError(message, response.status, code, details);
  }
  return (await response.json()) as T;
}

export const HS_QUERY_KEY = [HS_API.student] as const;

export const HS_QUERY_OPTIONS = {
  retry: (count: number, error: unknown) => !isNoEnrollment(error) && count < 1,
  staleTime: 30_000,
  refetchOnMount: "always",
  refetchOnWindowFocus: true,
} as const;

export function isNoEnrollment(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === HS_ERROR_CODES.NO_ENROLLMENT;
}

export type HsProgressFailure =
  | { readonly kind: "conflict"; readonly message: string; readonly refetch: true }
  | { readonly kind: "error"; readonly message: string; readonly refetch: false };

/** Pure mapping of a failed update to what the UI should do. */
export function interpretProgressError(error: unknown): HsProgressFailure {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.code === HS_ERROR_CODES.REVISION_CONFLICT) {
      return { kind: "conflict", refetch: true, message: "This was updated elsewhere. We refreshed your plan, so please check it and try again." };
    }
    if (error.code === HS_ERROR_CODES.UNKNOWN_COURSE_OR_TASK) {
      return { kind: "conflict", refetch: true, message: "Lumière updated your plan and this item changed. We refreshed it for you." };
    }
    if (error.code === HS_ERROR_CODES.OFFICIAL_RECORD_LOCKED) {
      return { kind: "conflict", refetch: true, message: "The school already confirmed this result, so it can no longer be changed here." };
    }
    return { kind: "error", refetch: false, message: error.message };
  }
  return { kind: "error", refetch: false, message: error instanceof Error ? error.message : "Your update could not be saved." };
}

export function useHighSchoolView(enabled = true) {
  return useQuery<StudentHighSchoolView>({
    enabled,
    queryKey: [...HS_QUERY_KEY],
    queryFn: () => hsRequest<StudentHighSchoolView>(HS_API.student),
    ...HS_QUERY_OPTIONS,
  });
}

export function useReportHsProgress() {
  const queryClient = useQueryClient();
  return useMutation<StudentHighSchoolView, unknown, HsStudentProgressInput>({
    mutationFn: (input) => hsRequest<StudentHighSchoolView>(HS_API.studentProgress, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (view) => {
      queryClient.setQueryData([...HS_QUERY_KEY], view);
    },
  });
}

export function useRequestTranscript() {
  const queryClient = useQueryClient();
  return useMutation<StudentHighSchoolView, unknown, { note?: string } | void>({
    mutationFn: (input) =>
      hsRequest<StudentHighSchoolView>(HS_API.studentTranscriptRequest, { method: "POST", body: JSON.stringify(input ?? {}) }),
    onSuccess: (view) => {
      queryClient.setQueryData([...HS_QUERY_KEY], view);
    },
  });
}
