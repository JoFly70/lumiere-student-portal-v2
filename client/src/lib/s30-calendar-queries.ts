/**
 * S30 Academic Calendar data access (staff + student). Written against shared/s30-contract.ts.
 * The student UI never sends a studentId; the student routes resolve the student from the session.
 * 503 S30_UNAVAILABLE (tables not applied) becomes the calm "not switched on yet" state through `isCalendarUnavailable`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiRequest, ApiError, getAuthToken } from "@/lib/api";
import {
  S30_API,
  type CalendarItem,
  type CalendarSubscriptionView,
  type CalendarView,
  type CreateCalendarEventInput,
  type UpdateCalendarEventInput,
} from "@shared/s30-contract";
import { S27_API } from "@shared/s27-contract";

export type CalendarScope = "staff" | "student";

export interface CalendarQuery {
  readonly from: string;
  readonly to: string;
  /** Staff only. */
  readonly studentId?: string | null;
  readonly includeDemo?: boolean;
}

export function isCalendarUnavailable(error: unknown): boolean {
  return error instanceof ApiError && ([501, 502, 503].includes(error.status) || error.code === "S30_UNAVAILABLE");
}
export function calendarErrorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

const noRetryOnClientError = (count: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && count < 1;

export function calendarQueryString(scope: CalendarScope, q: CalendarQuery): string {
  const p = new URLSearchParams({ from: q.from, to: q.to });
  if (scope === "staff") {
    if (q.studentId) p.set("studentId", q.studentId);
    if (q.includeDemo) p.set("includeDemo", "1");
  }
  return p.toString();
}
const calendarPath = (scope: CalendarScope) => (scope === "staff" ? S30_API.staffCalendar : S30_API.studentCalendar);
const icsPath = (scope: CalendarScope) => (scope === "staff" ? S30_API.staffCalendarIcs : S30_API.studentCalendarIcs);
const subsPath = (scope: CalendarScope) => (scope === "staff" ? S30_API.staffSubscriptions : S30_API.studentSubscriptions);

export const calendarKey = (scope: CalendarScope, q: CalendarQuery) => ["s30-calendar", scope, q.from, q.to, scope === "staff" ? q.studentId ?? "" : "", scope === "staff" ? !!q.includeDemo : false] as const;

export function useCalendar(scope: CalendarScope, q: CalendarQuery) {
  return useQuery<CalendarView>({
    queryKey: [...calendarKey(scope, q)],
    queryFn: () => api.get<CalendarView>(`${calendarPath(scope)}?${calendarQueryString(scope, q)}`),
    retry: noRetryOnClientError,
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });
}

/** Every schedule change refreshes every cached range (cheap: ranges are small). */
function useInvalidateCalendar() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["s30-calendar"] });
}

// ── staff: schedule, reschedule, cancel ──────────────────────────────────────

export function useCreateCalendarEvent() {
  const invalidate = useInvalidateCalendar();
  return useMutation<unknown, Error, CreateCalendarEventInput>({
    mutationFn: (body) => api.post(S30_API.staffCalendarEvents, body),
    onSuccess: invalidate,
  });
}
export function useUpdateCalendarEvent() {
  const invalidate = useInvalidateCalendar();
  return useMutation<unknown, Error, { id: string; body: Partial<UpdateCalendarEventInput> }>({
    mutationFn: ({ id, body }) => apiRequest(S30_API.staffCalendarEvent(id), { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: invalidate,
  });
}
/** Orientation sessions are owned by S27: reschedule/cancel through its endpoint. */
export function useUpdateOrientationSession() {
  const invalidate = useInvalidateCalendar();
  return useMutation<unknown, Error, { studentId: string; sessionId: string; body: { slotAt?: string; status?: "cancelled" } }>({
    mutationFn: ({ studentId, sessionId, body }) => apiRequest(S27_API.session(studentId, sessionId), { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: invalidate,
  });
}

/** Reschedule or cancel an item through the right endpoint for its source. */
export type ItemChange =
  | { kind: "reschedule"; startsAt: string; endsAt: string | null; allDay: boolean; timeZone: string; notify: boolean }
  | { kind: "cancel"; notify: boolean };

export function useChangeCalendarItem() {
  const event = useUpdateCalendarEvent();
  const session = useUpdateOrientationSession();
  return {
    isPending: event.isPending || session.isPending,
    error: event.error ?? session.error,
    reset: () => { event.reset(); session.reset(); },
    mutateAsync: async (item: CalendarItem, change: ItemChange) => {
      if (item.source === "calendar_event") {
        const body: Partial<UpdateCalendarEventInput> = change.kind === "cancel"
          ? { status: "cancelled", notify: change.notify }
          : { startsAt: change.startsAt, endsAt: change.endsAt, allDay: change.allDay, timeZone: change.timeZone, notify: change.notify };
        return event.mutateAsync({ id: item.recordId, body });
      }
      if (item.source === "orientation") {
        return session.mutateAsync({
          studentId: item.studentId,
          sessionId: item.recordId,
          body: change.kind === "cancel" ? { status: "cancelled" } : { slotAt: change.startsAt },
        });
      }
      throw new Error("This item cannot be changed from the calendar.");
    },
  };
}

// ── subscriptions ────────────────────────────────────────────────────────────

export const subscriptionsKey = (scope: CalendarScope) => ["s30-calendar-subscriptions", scope] as const;

export function useCalendarSubscriptions(scope: CalendarScope, enabled = true) {
  return useQuery<CalendarSubscriptionView[]>({
    queryKey: [...subscriptionsKey(scope)],
    enabled,
    queryFn: async () => {
      const data = await api.get<CalendarSubscriptionView[] | { subscriptions: CalendarSubscriptionView[] }>(subsPath(scope));
      return Array.isArray(data) ? data : data?.subscriptions ?? [];
    },
    retry: noRetryOnClientError,
  });
}
export function useCreateSubscription(scope: CalendarScope) {
  const qc = useQueryClient();
  return useMutation<CalendarSubscriptionView, Error, { privacy: "minimal" | "detailed"; label?: string }>({
    mutationFn: async (body) => {
      const data = await api.post<CalendarSubscriptionView | { subscription: CalendarSubscriptionView }>(subsPath(scope), body);
      return data && typeof data === "object" && "subscription" in data ? data.subscription : (data as CalendarSubscriptionView);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...subscriptionsKey(scope)] }),
  });
}
export function useRevokeSubscription(scope: CalendarScope) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (id) => api.delete(scope === "staff" ? S30_API.staffSubscription(id) : S30_API.studentSubscription(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...subscriptionsKey(scope)] }),
  });
}

// ── .ics download ────────────────────────────────────────────────────────────

/** Downloads the .ics for a range with the session's credentials (a plain link cannot send the bearer token). */
export async function downloadCalendarIcs(scope: CalendarScope, q: CalendarQuery): Promise<void> {
  const headers = new Headers();
  const token = getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${icsPath(scope)}?${calendarQueryString(scope, q)}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const nested = body?.error && typeof body.error === "object" ? body.error : null;
    throw new ApiError(String(nested?.message ?? body?.error ?? `HTTP ${res.status}`), res.status, nested?.code ?? body?.code);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lumiere-calendar.ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Absolute feed URL and its webcal:// twin for a `feedPath` (shown once, at creation). */
export function feedUrls(feedPath: string, origin: string = typeof window !== "undefined" ? window.location.origin : ""): { https: string; webcal: string } {
  const https = `${origin}${feedPath}`;
  return { https, webcal: https.replace(/^https?:/i, "webcal:") };
}
