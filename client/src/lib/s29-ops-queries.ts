/**
 * S29 ops data access (Diagnostics Studio and Notification Center). Written against shared/s29-contract.ts.
 * A 503 / S29_UNAVAILABLE answer becomes the designed "not switched on yet" state via `isOpsUnavailable`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import {
  S29_API,
  S29_ERROR_CODES,
  type ConciergeSettings,
  type DiagnosticCheckKey,
  type DiagnosticCheckResult,
  type DiagnosticsView,
  type EmailState,
  type IncidentView,
  type OutboxView,
} from "@shared/s29-contract";
import type { IncidentAction } from "@/lib/s29-ops-presentation";

export function isOpsUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (error.code === S29_ERROR_CODES.UNAVAILABLE || [501, 502, 503].includes(error.status));
}

export function opsErrorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message && error.message !== "[object Object]" && !/^HTTP \d+/.test(error.message)) return error.message;
  return fallback;
}

const retryServerOnly = (count: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && count < 1;

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ── diagnostics ─────────────────────────────────────────────────────────────

export const DIAGNOSTICS_KEY = [S29_API.diagnostics] as const;
export function useDiagnostics() {
  return useQuery<DiagnosticsView>({
    queryKey: [...DIAGNOSTICS_KEY],
    queryFn: () => api.get<DiagnosticsView>(S29_API.diagnostics),
    retry: retryServerOnly,
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useIncidents(search: string, status: string) {
  return useQuery<IncidentView[]>({
    queryKey: [S29_API.incidents, search, status],
    queryFn: async () => {
      const data = await api.get<{ incidents?: IncidentView[] } | IncidentView[]>(S29_API.incidents + qs({ search: search.trim() || undefined, status: status === "all" ? undefined : status }));
      return Array.isArray(data) ? data : data?.incidents ?? [];
    },
    retry: retryServerOnly,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}

export function useIncidentAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: IncidentAction }) => api.post<{ incident: IncidentView }>(S29_API.incident(id), { action }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [S29_API.incidents] });
      void qc.invalidateQueries({ queryKey: [...DIAGNOSTICS_KEY] });
    },
  });
}

export function useRunCheck() {
  return useMutation({ mutationFn: (key: DiagnosticCheckKey) => api.post<DiagnosticCheckResult>(S29_API.diagnosticCheck(key), {}) });
}

export function useRunScheduler() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ result: Record<string, unknown> }>(S29_API.schedulerRun, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...DIAGNOSTICS_KEY] });
      void qc.invalidateQueries({ queryKey: [S29_API.outbox] });
    },
  });
}

// ── outbox ──────────────────────────────────────────────────────────────────

export function useOutbox(state: EmailState | "all", studentId: string | null) {
  return useQuery<OutboxView>({
    queryKey: [S29_API.outbox, state, studentId ?? ""],
    queryFn: () => api.get<OutboxView>(S29_API.outbox + qs({ state: state === "all" ? undefined : state, studentId: studentId ?? undefined })),
    retry: retryServerOnly,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useOutboxRetry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ retried: boolean }>(S29_API.outboxRetry(id), {}),
    onSettled: () => void qc.invalidateQueries({ queryKey: [S29_API.outbox] }),
  });
}

// ── concierge settings ──────────────────────────────────────────────────────

export function useConciergeSettings(enabled: boolean) {
  return useQuery<ConciergeSettings>({
    queryKey: [S29_API.conciergeSettings],
    queryFn: async () => {
      const data = await api.get<ConciergeSettings | { settings: ConciergeSettings }>(S29_API.conciergeSettings);
      return data && typeof data === "object" && "settings" in data ? (data as { settings: ConciergeSettings }).settings : (data as ConciergeSettings);
    },
    enabled,
    retry: retryServerOnly,
    staleTime: 30_000,
  });
}

export function useSaveConciergeSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (value: ConciergeSettings) => {
      const data = await api.put<ConciergeSettings | { settings: ConciergeSettings }>(S29_API.conciergeSettings, value);
      return data && typeof data === "object" && "settings" in data ? (data as { settings: ConciergeSettings }).settings : (data as ConciergeSettings);
    },
    onSuccess: (saved) => qc.setQueryData([S29_API.conciergeSettings], saved),
  });
}
