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
/** The Flight Deck path. High-school-only students get the High School Flight Deck here; everyone else the university one. */
export const FLIGHT_DECK_PATH = "/flight-deck";
/** Extra route for the High School Flight Deck, reachable by students who hold both programs (they keep the university deck at /flight-deck). */
export const HIGH_SCHOOL_FLIGHT_DECK_PATH = "/high-school/flight-deck";
/** The university roadmap exists only for university programs. A high school student's "roadmap" is /high-school. */
export const UNIVERSITY_ONLY_PATHS: readonly string[] = ["/roadmap"];
/** Nav entries hidden for high-school-only students. Billing is now shown to everyone (it has an honest not-connected state). */
export const HIGH_SCHOOL_ONLY_HIDDEN_PATHS: readonly string[] = [];

export type FlightDeckVariant = "high_school" | "university";

/** Which Flight Deck /flight-deck shows. Unknown access (loading is handled by the caller) means the university deck. */
export function flightDeckVariant(access: ProgramAccess): FlightDeckVariant {
  return access.highSchoolOnly ? "high_school" : "university";
}

/** Where a student lands after sign-in: always the Flight Deck; the variant decides which one. */
export function studentLandingPath(_access: ProgramAccess): string {
  return FLIGHT_DECK_PATH;
}

/**
 * Applies program awareness to a list of student nav entries (anything with a `url`):
 * High School appears only with a high school program; Roadmap is hidden for high-school-only students.
 * Flight Deck stays for everyone (its content depends on `flightDeckVariant`). For high-school-only students
 * the order is Flight Deck, High School, then the rest. Order is otherwise kept.
 */
export function filterStudentNav<T extends { readonly url: string }>(items: readonly T[], access: ProgramAccess): T[] {
  const kept = items.filter((i) => {
    if (i.url === HIGH_SCHOOL_PATH) return access.hasHighSchool;
    if (UNIVERSITY_ONLY_PATHS.includes(i.url) || HIGH_SCHOOL_ONLY_HIDDEN_PATHS.includes(i.url)) return !access.highSchoolOnly;
    return true;
  });
  if (!access.highSchoolOnly) return kept;
  const lead = [FLIGHT_DECK_PATH, HIGH_SCHOOL_PATH];
  return [
    ...lead.flatMap((u) => kept.filter((i) => i.url === u)),
    ...kept.filter((i) => !lead.includes(i.url)),
  ];
}
