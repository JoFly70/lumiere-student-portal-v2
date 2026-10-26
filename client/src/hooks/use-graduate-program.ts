/**
 * Data layer for the student "My Master's" page (S12): the read model query and
 * the two student mutations. A mutation resolves only after a 2xx; its
 * response (a fresh StudentGraduateView) replaces the cached view.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StudentGraduateView, StudentProgress, StudentThesisPlan } from "@shared/graduate-program-contract";
import { getAuthToken, getCsrfToken } from "@/lib/api";
import type { GraduateActions } from "@/components/graduate/graduate-actions";

export const GRADUATE_QUERY_KEY = ["/api/student/graduate"] as const;

export class GraduateApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "GraduateApiError";
    this.status = status;
    this.code = code;
  }
}

/** Older servers omit `evaluations`; treat that as none. */
function normalizeView(v: StudentGraduateView): StudentGraduateView {
  return { ...v, evaluations: v.evaluations ?? [] };
}

async function graduateRequest(method: string, url: string, body?: unknown): Promise<StudentGraduateView> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method !== "GET") {
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const err = data?.error;
    const message = (typeof err === "object" && err?.message) || (typeof err === "string" && err) || data?.message || `Request failed (${res.status})`;
    throw new GraduateApiError(String(message), res.status, typeof err === "object" ? err?.code : undefined);
  }
  return normalizeView((await res.json()) as StudentGraduateView);
}

/** GET /api/student/graduate. */
export function useGraduateProgram() {
  return useQuery<StudentGraduateView>({
    queryKey: GRADUATE_QUERY_KEY,
    queryFn: () => graduateRequest("GET", GRADUATE_QUERY_KEY[0]),
    retry: false,
    staleTime: 60_000,
  });
}

/**
 * For navigation: true only once the query has succeeded with at least one
 * programme. Loading and error both read as false, so the entry never flashes
 * and a failing endpoint never breaks the sidebar.
 */
export function useHasGraduatePrograms(enabled: boolean): boolean {
  const q = useQuery<StudentGraduateView>({
    queryKey: GRADUATE_QUERY_KEY,
    queryFn: () => graduateRequest("GET", GRADUATE_QUERY_KEY[0]),
    retry: false,
    staleTime: 60_000,
    enabled,
  });
  return enabled && q.isSuccess && q.data.programs.length > 0;
}

/** Live GraduateActions. Each call resolves after a 2xx and rejects with the server's message. */
export function useLiveGraduateActions(): GraduateActions {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: (job: () => Promise<StudentGraduateView>) => job(),
    onSuccess: (view) => {
      qc.setQueryData(GRADUATE_QUERY_KEY, view);
      void qc.invalidateQueries({ queryKey: GRADUATE_QUERY_KEY });
    },
  });
  return useMemo<GraduateActions>(() => {
    const base = (programId: string) => `/api/student/graduate/programs/${encodeURIComponent(programId)}`;
    return {
      setSubjectProgress: async (programId: string, subjectId: string, progress: StudentProgress) => {
        await run.mutateAsync(() => graduateRequest("POST", `${base(programId)}/subjects/${encodeURIComponent(subjectId)}/progress`, { progress }));
      },
      saveThesisPlan: async (programId: string, plan: StudentThesisPlan) => {
        await run.mutateAsync(() => graduateRequest("PUT", `${base(programId)}/thesis`, plan));
      },
    };
  }, [run.mutateAsync]);
}
