/**
 * S27 data access for the owner Control Center and the Student file. Written against shared/s27-contract.ts.
 * The S27 routes are mounted in server/routes.ts; when the S27 tables are not applied the server answers
 * 503 S27_UNAVAILABLE, which becomes a designed "not available yet" state (`isUnavailable`) instead of an error page.
 *
 * ASSUMPTIONS beyond the contract (kept in this one file so they are cheap to change):
 *  - GET agreement -> ProgramAgreementView (or { agreement }); PUT agreement returns the same (or anything: we refetch).
 *  - Complete a checkpoint: POST   S27_API.checkpoint(...)               with completeCheckpointSchema.
 *    Plan a checkpoint:     PUT    S27_API.checkpoint(...)               with planCheckpointSchema.
 *  - GET sessions -> OrientationSessionView[] (or { sessions }); PATCH session with updateSessionSchema.
 *  - GET notes -> StaffNoteView[] (or { notes }); POST notes -> StaffNoteView (or { note }).
 *  - GET staffJourney -> StudentJourneyView.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiRequest, ApiError } from "@/lib/api";
import {
  S27_API,
  type CheckpointKey,
  type ControlCenterView,
  type OrientationSessionView,
  type ProgramAgreementView,
  type StaffNoteView,
  type StudentJourneyView,
  type UpdateAgreementInput,
} from "@shared/s27-contract";

/** True when the service is down or the S27 tables are not applied yet: show the designed unavailable state.
 *  A 404 means the student or record does not exist and is shown as an error, not as "not switched on". */
export function isUnavailable(error: unknown): boolean {
  return error instanceof ApiError && ([501, 502, 503].includes(error.status) || error.code === "S27_UNAVAILABLE");
}

export function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && typeof error.message === "string" && error.message && error.message !== "[object Object]") return error.message;
  return fallback;
}

const noRetryOnClientError = (count: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && count < 1;

function listOf<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  const inner = data && typeof data === "object" ? (data as Record<string, unknown>)[key] : undefined;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

// ── Control Center ───────────────────────────────────────────────────────────

export const CONTROL_CENTER_KEY = [S27_API.controlCenter] as const;
export function useControlCenter() {
  return useQuery<ControlCenterView>({
    queryKey: [...CONTROL_CENTER_KEY],
    queryFn: () => api.get<ControlCenterView>(S27_API.controlCenter),
    retry: noRetryOnClientError,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

// ── agreement ────────────────────────────────────────────────────────────────

export const agreementKey = (studentId: string) => [S27_API.agreement(studentId)] as const;
export function useAgreement(studentId: string | null) {
  return useQuery<ProgramAgreementView | null>({
    queryKey: studentId ? [...agreementKey(studentId)] : ["s27-agreement-disabled"],
    enabled: !!studentId,
    queryFn: async () => {
      const data = await api.get<ProgramAgreementView | { agreement: ProgramAgreementView | null } | null>(S27_API.agreement(studentId!));
      if (data && typeof data === "object" && "agreement" in data) return data.agreement;
      return (data as ProgramAgreementView | null) ?? null;
    },
    retry: noRetryOnClientError,
  });
}

export function useUpdateAgreement(studentId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, UpdateAgreementInput>({
    mutationFn: (body) => api.put(S27_API.agreement(studentId), body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [...agreementKey(studentId)] });
      void qc.invalidateQueries({ queryKey: [...journeyKey(studentId)] });
      void qc.invalidateQueries({ queryKey: [...CONTROL_CENTER_KEY] });
    },
  });
}

// ── journey (agreement + checkpoints + sessions + pace) ──────────────────────

export const journeyKey = (studentId: string) => [S27_API.staffJourney(studentId)] as const;
export function useStaffJourney(studentId: string | null) {
  return useQuery<StudentJourneyView>({
    queryKey: studentId ? [...journeyKey(studentId)] : ["s27-journey-disabled"],
    enabled: !!studentId,
    queryFn: () => api.get<StudentJourneyView>(S27_API.staffJourney(studentId!)),
    retry: noRetryOnClientError,
  });
}

export function useCheckpointAction(studentId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { key: CheckpointKey; action: "complete" | "plan"; doneOn?: string; plannedOn?: string | null }>({
    mutationFn: (v) =>
      v.action === "complete"
        ? api.post(S27_API.checkpoint(studentId, v.key), v.doneOn ? { doneOn: v.doneOn } : {})
        : api.put(S27_API.checkpoint(studentId, v.key), { plannedOn: v.plannedOn ?? null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...journeyKey(studentId)] });
      void qc.invalidateQueries({ queryKey: [...CONTROL_CENTER_KEY] });
    },
  });
}

// ── orientation sessions ─────────────────────────────────────────────────────

export const sessionsKey = (studentId: string) => [S27_API.sessions(studentId)] as const;
export function useStaffSessions(studentId: string | null) {
  return useQuery<OrientationSessionView[]>({
    queryKey: studentId ? [...sessionsKey(studentId)] : ["s27-sessions-disabled"],
    enabled: !!studentId,
    queryFn: async () => listOf<OrientationSessionView>(await api.get(S27_API.sessions(studentId!)), "sessions"),
    retry: noRetryOnClientError,
  });
}

export function useUpdateSession(studentId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string; status?: OrientationSessionView["status"]; slotAt?: string; notes?: string | null }>({
    mutationFn: ({ id, ...body }) => apiRequest(S27_API.session(studentId, id), { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...sessionsKey(studentId)] });
      void qc.invalidateQueries({ queryKey: [...journeyKey(studentId)] });
      void qc.invalidateQueries({ queryKey: [...CONTROL_CENTER_KEY] });
    },
  });
}

// ── staff notes ──────────────────────────────────────────────────────────────

export const notesKey = (studentId: string) => [S27_API.notes(studentId)] as const;
export function useStaffNotes(studentId: string | null) {
  return useQuery<StaffNoteView[]>({
    queryKey: studentId ? [...notesKey(studentId)] : ["s27-notes-disabled"],
    enabled: !!studentId,
    queryFn: async () => listOf<StaffNoteView>(await api.get(S27_API.notes(studentId!)), "notes"),
    retry: noRetryOnClientError,
  });
}

export function useAddStaffNote(studentId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (body) => api.post(S27_API.notes(studentId), { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...notesKey(studentId)] }),
  });
}
