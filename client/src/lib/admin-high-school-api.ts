/**
 * S11 — staff High School Pathway API client. Every mutation returns the
 * refreshed StaffHighSchoolState (contract), which replaces the query cache.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HsCurriculumTemplate, StaffHighSchoolState } from "@shared/high-school-contract";
import { getAuthToken, freshCsrfToken } from "./api";
import { HS_STAFF_QUERY_KEY, classifyHsFailure, hsStaffPaths, type HsFailure } from "./admin-high-school-logic";

export class HsApiError extends Error {
  readonly failure: HsFailure;
  constructor(failure: HsFailure) {
    super(failure.message);
    this.name = "HsApiError";
    this.failure = failure;
  }
}

async function send<T>(method: "GET" | "POST" | "PUT" | "PATCH", url: string, data?: unknown): Promise<T> {
  const headers = new Headers();
  const token = getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (method !== "GET") {
    const csrf = await freshCsrfToken();
    if (csrf) headers.set("X-CSRF-Token", csrf);
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { method, headers, credentials: "include", body: data === undefined ? undefined : JSON.stringify(data) });
  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    throw new HsApiError(classifyHsFailure(res.status, parsed));
  }
  return (await res.json()) as T;
}

export const adminHighSchoolApi = {
  get: (studentId: string) => send<StaffHighSchoolState>("GET", hsStaffPaths.state(studentId)),
  templates: () => send<{ templates: HsCurriculumTemplate[] }>("GET", hsStaffPaths.templates()),
  createEnrollment: (studentId: string, body: unknown) => send<StaffHighSchoolState>("POST", hsStaffPaths.createEnrollment(studentId), body),
  updateEnrollment: (studentId: string, eid: string, body: unknown) => send<StaffHighSchoolState>("PATCH", hsStaffPaths.enrollment(studentId, eid), body),
  recordPriorEducation: (studentId: string, eid: string, body: unknown) => send<StaffHighSchoolState>("POST", hsStaffPaths.sub(studentId, eid, "prior-education"), body),
  addClaim: (studentId: string, eid: string, body: unknown) => send<StaffHighSchoolState>("POST", hsStaffPaths.sub(studentId, eid, "transfer-claims"), body),
  resolveClaim: (studentId: string, eid: string, claimId: string, body: unknown) =>
    send<StaffHighSchoolState>("POST", hsStaffPaths.sub(studentId, eid, `transfer-claims/${encodeURIComponent(claimId)}/resolve`), body),
  draftFromTemplate: (studentId: string, eid: string, body: unknown) => send<StaffHighSchoolState>("POST", hsStaffPaths.sub(studentId, eid, "roadmap/draft/from-template"), body),
  saveDraft: (studentId: string, eid: string, body: unknown) => send<StaffHighSchoolState>("PUT", hsStaffPaths.sub(studentId, eid, "roadmap/draft"), body),
  publish: (studentId: string, eid: string, body: unknown) => send<StaffHighSchoolState>("POST", hsStaffPaths.sub(studentId, eid, "roadmap/publish"), body),
  taskResult: (studentId: string, eid: string, body: unknown) => send<StaffHighSchoolState>("POST", hsStaffPaths.sub(studentId, eid, "results/task"), body),
  courseResult: (studentId: string, eid: string, body: unknown) => send<StaffHighSchoolState>("POST", hsStaffPaths.sub(studentId, eid, "results/course"), body),
  transferAward: (studentId: string, eid: string, body: unknown) => send<StaffHighSchoolState>("POST", hsStaffPaths.sub(studentId, eid, "awards/transfer"), body),
  voidAward: (studentId: string, eid: string, awardId: string, body: unknown) =>
    send<StaffHighSchoolState>("POST", hsStaffPaths.sub(studentId, eid, `awards/${encodeURIComponent(awardId)}/void`), body),
  graduation: (studentId: string, eid: string, body: unknown) => send<StaffHighSchoolState>("POST", hsStaffPaths.sub(studentId, eid, "graduation"), body),
  guardianNote: (studentId: string, eid: string, body: unknown) => send<StaffHighSchoolState>("POST", hsStaffPaths.sub(studentId, eid, "guardian-notes"), body),
  historicalGraduate: (studentId: string, body: unknown) => send<StaffHighSchoolState>("POST", hsStaffPaths.historicalGraduate(studentId), body),
};

export function useHsState(studentId: string) {
  return useQuery<StaffHighSchoolState>({
    queryKey: HS_STAFF_QUERY_KEY(studentId),
    queryFn: () => adminHighSchoolApi.get(studentId),
    staleTime: Infinity,
    enabled: studentId.length > 0,
  });
}

export function useHsTemplates() {
  return useQuery<{ templates: HsCurriculumTemplate[] }>({ queryKey: ["admin-high-school-templates"], queryFn: () => adminHighSchoolApi.templates(), staleTime: 60_000 });
}

/**
 * Runs one staff mutation. On success the returned state replaces the cache;
 * on a revision conflict the authoritative state is re-fetched.
 */
export function useHsMutation<V>(studentId: string, fn: (vars: V) => Promise<StaffHighSchoolState>) {
  const queryClient = useQueryClient();
  return useMutation<StaffHighSchoolState, HsApiError, V>({
    mutationFn: fn,
    onSuccess: (next) => {
      queryClient.setQueryData(HS_STAFF_QUERY_KEY(studentId), next);
    },
    onError: async (err) => {
      if (err instanceof HsApiError && (err.failure.kind === "conflict" || err.failure.kind === "locked")) {
        await queryClient.invalidateQueries({ queryKey: HS_STAFF_QUERY_KEY(studentId) });
      }
    },
  });
}
