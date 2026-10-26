/**
 * Data layer for the student profile page (S09): one read model query and the
 * mutations behind ProfileActions. Every mutation refetches the profile and
 * the queries other screens rely on.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateIdentityCorrection,
  StudentContactInput,
  StudentProfileView,
  StudentSelfServiceUpdate,
} from "@shared/student-profile-contract";
import { getAuthToken, getCsrfToken } from "@/lib/api";
import type { ProfileActions } from "@/components/profile/profile-actions";

export const PROFILE_QUERY_KEY = ["/api/students/me/profile"] as const;

/** Error carrying the server's stable `code` and any validation `details`. */
export class ProfileApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ProfileApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function firstDetail(details: unknown): string | null {
  if (Array.isArray(details) && details.length > 0) {
    const d = details[0] as { message?: string } | string;
    return typeof d === "string" ? d : (d?.message ?? null);
  }
  if (details && typeof details === "object") {
    const vals = Object.values(details as Record<string, unknown>);
    const f = vals.flat()[0];
    if (typeof f === "string") return f;
  }
  return null;
}

export async function profileRequest<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method !== "GET") {
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const base = (data && (data.message || data.error)) || `Request failed (${res.status})`;
    const detail = res.status === 400 ? firstDetail(data?.details) : null;
    throw new ProfileApiError(detail && detail !== base ? `${base}: ${detail}` : String(base), res.status, data?.code, data?.details);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** GET /api/students/me/profile. Resolves null when the student has no record yet (404). */
export function useStudentProfile() {
  return useQuery<StudentProfileView | null>({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: async () => {
      try {
        return await profileRequest<StudentProfileView>("GET", PROFILE_QUERY_KEY[0]);
      } catch (e) {
        if (e instanceof ProfileApiError && e.status === 404) return null;
        throw e;
      }
    },
    retry: false,
  });
}

/** Live ProfileActions bound to the signed-in student. */
export function useLiveProfileActions(studentId: string | undefined): ProfileActions {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
    void qc.invalidateQueries({ queryKey: ["/api/students/me"] });
    void qc.invalidateQueries({ queryKey: ["/api/me"] });
  };

  const run = useMutation({
    mutationFn: (job: () => Promise<unknown>) => job(),
    onSuccess: refresh,
  });

  return useMemo<ProfileActions>(() => {
    const sid = studentId ? encodeURIComponent(studentId) : "";
    const exec = async (job: () => Promise<unknown>) => {
      if (!sid) throw new Error("Your student record is not loaded yet.");
      await run.mutateAsync(job);
    };
    return {
      saveSelfService: (update: StudentSelfServiceUpdate) => exec(() => profileRequest("PUT", `/api/students/${sid}`, update)),
      submitCorrection: (input: CreateIdentityCorrection) => exec(() => profileRequest("POST", "/api/students/me/identity-corrections", input)),
      withdrawCorrection: (id: string) => exec(() => profileRequest("POST", `/api/students/me/identity-corrections/${encodeURIComponent(id)}/withdraw`)),
      addContact: (input: StudentContactInput) => exec(() => profileRequest("POST", `/api/students/${sid}/contacts`, input)),
      updateContact: (id: string, patch: Partial<StudentContactInput>) => exec(() => profileRequest("PUT", `/api/students/contacts/${encodeURIComponent(id)}`, patch)),
      deleteContact: (id: string) => exec(() => profileRequest("DELETE", `/api/students/contacts/${encodeURIComponent(id)}`)),
      refresh,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, run.mutateAsync]);
}
