/**
 * Data access for the Lumière-assigned roadmap (S05).
 *
 * The roadmap view is the single source for Flight Deck and Roadmap. A progress
 * update returns the authoritative view, which replaces the cached query data.
 * React-free apart from the types so the contract is unit testable.
 */
import type { StudentProgressUpdate, StudentRoadmapView } from "@shared/student-roadmap-contract";
import { currentLanguage } from "@/i18n";
import { djTranslate, type DjKey } from "@/components/degree-journey/i18n";
import { getAuthToken, freshCsrfToken } from "@/lib/api";

export const STUDENT_ROADMAP_QUERY_KEY = ["/api/student/roadmap"] as const;
export const STUDENT_ROADMAP_PROGRESS_URL = "/api/student/roadmap/progress";

export const STUDENT_ROADMAP_QUERY_OPTIONS = {
  retry: 1,
  staleTime: 30_000,
  refetchOnMount: "always",
  refetchOnWindowFocus: true,
} as const;

/** Error carrying the contract's { error: { code, message } } envelope. */
export class RoadmapApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "RoadmapApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseError(response: Response): Promise<RoadmapApiError> {
  let code: string | null = null;
  let message = `Request failed (${response.status})`;
  try {
    const body = await response.json();
    const err = body?.error;
    if (err && typeof err === "object") {
      code = typeof err.code === "string" ? err.code : null;
      if (typeof err.message === "string") message = err.message;
    } else if (typeof err === "string") {
      message = err;
    }
  } catch {
    /* keep default message */
  }
  return new RoadmapApiError(response.status, code, message);
}

async function authHeaders(json: boolean): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) {
    headers["Content-Type"] = "application/json";
    const csrf = await freshCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  return headers;
}

export async function fetchStudentRoadmap(): Promise<StudentRoadmapView> {
  const response = await fetch(STUDENT_ROADMAP_QUERY_KEY[0], {
    credentials: "include",
    headers: await authHeaders(false),
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as StudentRoadmapView;
}

export async function postStudentProgress(update: StudentProgressUpdate): Promise<StudentRoadmapView> {
  const response = await fetch(STUDENT_ROADMAP_PROGRESS_URL, {
    method: "POST",
    credentials: "include",
    headers: await authHeaders(true),
    body: JSON.stringify(update),
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as StudentRoadmapView;
}

/** A 404 that is not about the roadmap itself means no student record exists yet. */
export function isRoadmapMissingRecord(error: unknown): boolean {
  if (!(error instanceof RoadmapApiError)) return false;
  return error.status === 404 && (error.code === null || error.code === "ROADMAP_STUDENT_NOT_FOUND");
}

export type ProgressFailure =
  | { readonly kind: "conflict"; readonly message: string; readonly refetch: true }
  | { readonly kind: "error"; readonly message: string; readonly refetch: false };

const msg = (key: DjKey) => djTranslate(currentLanguage(), key);

/** Pure mapping of a failed update to what the UI should do. */
export function interpretProgressError(error: unknown): ProgressFailure {
  if (error instanceof RoadmapApiError) {
    if (error.status === 409 && error.code === "ROADMAP_PROGRESS_CONFLICT") {
      return {
        kind: "conflict",
        refetch: true,
        message: msg("dj.save.err.conflict"),
      };
    }
    if (error.code === "ROADMAP_ITEM_NOT_FOUND") {
      return {
        kind: "conflict",
        refetch: true,
        message: msg("dj.save.err.itemChanged"),
      };
    }
    if (error.code === "ROADMAP_ITEM_NOT_REPORTABLE") {
      return { kind: "error", refetch: false, message: msg("dj.save.err.notReportable") };
    }
    return { kind: "error", refetch: false, message: error.message };
  }
  return {
    kind: "error",
    refetch: false,
    message: error instanceof Error ? error.message : msg("dj.save.err.generic"),
  };
}
