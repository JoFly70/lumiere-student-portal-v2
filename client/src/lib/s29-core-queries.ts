/**
 * S29 core data access: student inbox + preferences, Needs Attention, Fleet copilot. Written against
 * shared/s29-contract.ts. 503 S29_UNAVAILABLE (schema not applied yet) is a designed state, not an error page.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import {
  S29_API,
  type AttentionActionInput, type AttentionQueueView, type FleetAnswer, type FleetQuestionInput, type InboxView, type NotificationPreferences,
} from "@shared/s29-contract";

export function isS29Unavailable(error: unknown): boolean {
  return error instanceof ApiError && ([501, 502, 503].includes(error.status) || error.code === "S29_UNAVAILABLE");
}
const noRetryOnClientError = (count: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && !isS29Unavailable(error) && count < 1;

export const INBOX_KEY = [S29_API.inbox] as const;
export function useInbox(enabled = true) {
  return useQuery<InboxView>({ queryKey: [...INBOX_KEY], queryFn: () => api.get<InboxView>(S29_API.inbox), enabled, retry: noRetryOnClientError, staleTime: 30_000, refetchInterval: 120_000, refetchOnWindowFocus: true });
}
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[] } | { all: true }) => api.post<{ updated: number }>(S29_API.inboxRead, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...INBOX_KEY] }),
  });
}
export const PREFS_KEY = [S29_API.preferences] as const;
export function usePreferences() {
  return useQuery<NotificationPreferences>({ queryKey: [...PREFS_KEY], queryFn: () => api.get<NotificationPreferences>(S29_API.preferences), retry: noRetryOnClientError });
}
export function useSavePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: NotificationPreferences) => api.put<NotificationPreferences>(S29_API.preferences, p),
    onSuccess: (data) => qc.setQueryData([...PREFS_KEY], data),
  });
}

export const ATTENTION_KEY = [S29_API.attention] as const;
export function useAttention() {
  return useQuery<AttentionQueueView>({ queryKey: [...ATTENTION_KEY], queryFn: () => api.get<AttentionQueueView>(S29_API.attention), retry: noRetryOnClientError, staleTime: 30_000, refetchOnWindowFocus: true });
}
export function useAttentionAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, input }: { key: string; input: AttentionActionInput }) => api.post<{ key: string; status: string }>(S29_API.attentionAction(key), input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...ATTENTION_KEY] }),
  });
}
export function useAttentionSync() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.post(S29_API.attentionSync, {}), onSuccess: () => void qc.invalidateQueries({ queryKey: [...ATTENTION_KEY] }) });
}
export function useFleetAsk() {
  return useMutation({ mutationFn: (input: FleetQuestionInput & { useAi: boolean }) => api.post<FleetAnswer>(S29_API.fleetAsk, input) });
}
