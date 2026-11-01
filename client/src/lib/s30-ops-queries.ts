/**
 * S30 Phase A data access: Operations Center + notifications. Written against shared/s30-contract.ts and
 * server/routes/s30-ops.ts. 503 S30_UNAVAILABLE ("not switched on yet") is a designed calm state (`isS30Unavailable`).
 *
 * ASSUMPTIONS: GET events -> { events } ordered newest first, paged with ?before=<lowest seq>; a page shorter than the
 * page size means there is nothing older. PATCH exception answers the updated exception (we refetch anyway).
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiRequest, ApiError } from "@/lib/api";
import {
  S30_API,
  type DiagnosticsView,
  type ExceptionState,
  type NotificationsView,
  type OpsEventView,
  type OpsExceptionsView,
} from "@shared/s30-contract";

export const EVENTS_PAGE_SIZE = 50;

export function isS30Unavailable(error: unknown): boolean {
  return error instanceof ApiError && ([501, 502, 503].includes(error.status) || error.code === "S30_UNAVAILABLE");
}
const noRetryOnClientError = (count: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && count < 1;

export const OPS_EXCEPTIONS_KEY = [S30_API.exceptions] as const;
export const OPS_EVENTS_KEY = [S30_API.events] as const;
export const OPS_DIAGNOSTICS_KEY = [S30_API.diagnostics] as const;
export const NOTIFICATIONS_KEY = [S30_API.notifications] as const;

export function useOpsExceptions() {
  return useQuery<OpsExceptionsView>({
    queryKey: [...OPS_EXCEPTIONS_KEY],
    queryFn: () => api.get<OpsExceptionsView>(S30_API.exceptions),
    retry: noRetryOnClientError,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useUpdateException() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string; state: ExceptionState; snoozeDays?: number }>({
    mutationFn: ({ id, state, snoozeDays }) =>
      apiRequest(S30_API.exception(id), { method: "PATCH", body: JSON.stringify(state === "snoozed" ? { state, snoozeDays } : { state }) }),
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: [...OPS_EXCEPTIONS_KEY] }),
        qc.invalidateQueries({ queryKey: [...OPS_EVENTS_KEY] }),
        qc.invalidateQueries({ queryKey: [...OPS_DIAGNOSTICS_KEY] }),
      ]);
    },
  });
}

export function useOpsEvents() {
  return useInfiniteQuery<readonly OpsEventView[], Error, { pages: readonly (readonly OpsEventView[])[] }, readonly unknown[], number | null>({
    queryKey: [...OPS_EVENTS_KEY],
    initialPageParam: null,
    queryFn: async ({ pageParam }) => {
      const qs = pageParam ? `?before=${encodeURIComponent(String(pageParam))}` : "";
      const out = await api.get<{ events?: OpsEventView[] }>(`${S30_API.events}${qs}`);
      return Array.isArray(out?.events) ? out.events : [];
    },
    getNextPageParam: (last) => (last.length >= EVENTS_PAGE_SIZE ? Math.min(...last.map((e) => e.seq)) : undefined),
    retry: noRetryOnClientError,
    staleTime: 30_000,
  });
}

export function useOpsDiagnostics(enabled: boolean) {
  return useQuery<DiagnosticsView>({
    queryKey: [...OPS_DIAGNOSTICS_KEY],
    queryFn: () => api.get<DiagnosticsView>(S30_API.diagnostics),
    enabled,
    retry: noRetryOnClientError,
    staleTime: 30_000,
  });
}

export interface ConciergeRunResult { planned: number; created: number; emailed: number; students: number }
export function useRunConcierge() {
  const qc = useQueryClient();
  return useMutation<ConciergeRunResult, Error, void>({
    mutationFn: () => apiRequest<ConciergeRunResult>(S30_API.conciergeRun, { method: "POST" }),
    onSettled: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: [...OPS_DIAGNOSTICS_KEY] }), qc.invalidateQueries({ queryKey: [...OPS_EVENTS_KEY] })]);
    },
  });
}

export function useNotifications(enabled = true) {
  return useQuery<NotificationsView>({
    queryKey: [...NOTIFICATIONS_KEY],
    queryFn: () => api.get<NotificationsView>(S30_API.notifications),
    enabled,
    retry: noRetryOnClientError,
    staleTime: 20_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (id) => apiRequest(S30_API.notificationRead(id), { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: [...NOTIFICATIONS_KEY] }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, void>({
    mutationFn: () => apiRequest(S30_API.notificationsReadAll, { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: [...NOTIFICATIONS_KEY] }),
  });
}
