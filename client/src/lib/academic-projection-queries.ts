/**
 * Data access for the real Academic Flight Deck (S18): GET /api/student/academic-projection.
 * Read-only. Same fetch/auth/ApiError pattern as student-programs.ts and high-school-queries.ts.
 */
import { useQuery } from "@tanstack/react-query";
import { HS_ERROR_CODES } from "@shared/high-school-contract";
import { ACADEMIC_PROJECTION_API, type AcademicProjection } from "@shared/academic-projection-contract";
import { ApiError, getAuthToken } from "@/lib/api";

export const ACADEMIC_PROJECTION_QUERY_KEY = [ACADEMIC_PROJECTION_API] as const;

/** Understands both `{ code, error }` (flat) and `{ error: { code, message } }` bodies. */
export async function fetchAcademicProjection(): Promise<AcademicProjection> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(ACADEMIC_PROJECTION_API, { credentials: "include", headers });
  if (!response.ok) {
    let code: string | undefined;
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      const err = body?.error;
      if (err && typeof err === "object") {
        if (typeof err.code === "string") code = err.code;
        if (typeof err.message === "string") message = err.message;
      } else {
        if (typeof err === "string") message = err;
        if (typeof body?.code === "string") code = body.code;
      }
    } catch {
      /* keep defaults */
    }
    throw new ApiError(message, response.status, code);
  }
  return (await response.json()) as AcademicProjection;
}

/** 404 HS_NO_ENROLLMENT: the student has no high school program. Not an error to retry. */
export function isNoHighSchoolEnrollment(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === HS_ERROR_CODES.NO_ENROLLMENT;
}

export const ACADEMIC_PROJECTION_QUERY_OPTIONS = {
  retry: (count: number, error: unknown) => !isNoHighSchoolEnrollment(error) && count < 1,
  staleTime: 30_000,
  refetchOnMount: "always",
  refetchOnWindowFocus: true,
} as const;

export function useAcademicProjection(enabled = true) {
  return useQuery<AcademicProjection>({
    queryKey: [...ACADEMIC_PROJECTION_QUERY_KEY],
    queryFn: fetchAcademicProjection,
    enabled,
    ...ACADEMIC_PROJECTION_QUERY_OPTIONS,
  });
}
