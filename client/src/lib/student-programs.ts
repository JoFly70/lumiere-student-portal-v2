/**
 * Which programs the signed-in student holds (GET /api/student/programs). One shared hook drives the
 * landing page, the sidebar, the mobile bar and the university-only pages, so they always agree.
 */
import { useQuery } from "@tanstack/react-query";
import { HS_API, type StudentProgramsView } from "@shared/high-school-contract";
import { ApiError, getAuthToken } from "@/lib/api";

export interface ProgramAccess {
  /** Any high_school program (current or past). */
  readonly hasHighSchool: boolean;
  /** A high school program and no university degree program. */
  readonly highSchoolOnly: boolean;
}

export const NO_PROGRAM_ACCESS: ProgramAccess = { hasHighSchool: false, highSchoolOnly: false };

export function programAccess(view: StudentProgramsView | null | undefined): ProgramAccess {
  const programs = view?.programs ?? [];
  const hasHighSchool = programs.some((p) => p.kind === "high_school");
  const hasUniversity = programs.some((p) => p.kind === "university_degree");
  return { hasHighSchool, highSchoolOnly: hasHighSchool && !hasUniversity };
}

export const STUDENT_PROGRAMS_QUERY_KEY = [HS_API.studentPrograms] as const;

async function fetchStudentPrograms(): Promise<StudentProgramsView> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(HS_API.studentPrograms, { credentials: "include", headers });
  if (!response.ok) throw new ApiError(`Request failed (${response.status})`, response.status);
  return (await response.json()) as StudentProgramsView;
}

/** `enabled` should be true only for signed-in students (the endpoint is student-only). */
export function useStudentPrograms(enabled = true) {
  const query = useQuery<StudentProgramsView>({
    queryKey: [...STUDENT_PROGRAMS_QUERY_KEY],
    queryFn: fetchStudentPrograms,
    enabled,
    retry: 1,
    staleTime: 60_000,
  });
  const access = programAccess(query.data);
  return {
    ...access,
    /** True until the first answer (or failure) arrives. On failure the access is "no high school", i.e. the university default. */
    isLoading: enabled && query.isLoading,
    isError: query.isError,
  };
}

export const HIGH_SCHOOL_PATH = "/high-school";
export const UNIVERSITY_ONLY_PATHS: readonly string[] = ["/flight-deck", "/roadmap"];

/** Where a student lands after sign-in. Unknown access (loading is handled by the caller) means the university dashboard. */
export function studentLandingPath(access: ProgramAccess): string {
  return access.highSchoolOnly ? HIGH_SCHOOL_PATH : "/flight-deck";
}

/**
 * Applies program awareness to a list of student nav entries (anything with a `url`):
 * High School appears only with a high school program and leads for high-school-only students;
 * Flight Deck and Roadmap are hidden for high-school-only students. Order is otherwise kept.
 */
export function filterStudentNav<T extends { readonly url: string }>(items: readonly T[], access: ProgramAccess): T[] {
  const kept = items.filter((i) => {
    if (i.url === HIGH_SCHOOL_PATH) return access.hasHighSchool;
    if (UNIVERSITY_ONLY_PATHS.includes(i.url)) return !access.highSchoolOnly;
    return true;
  });
  if (!access.highSchoolOnly) return kept;
  return [...kept.filter((i) => i.url === HIGH_SCHOOL_PATH), ...kept.filter((i) => i.url !== HIGH_SCHOOL_PATH)];
}
