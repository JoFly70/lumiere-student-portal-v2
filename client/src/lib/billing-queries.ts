/**
 * Data access for the student Billing page (S18). Read-only: there is no mutation here.
 * GET /api/student/billing -> StudentBillingView (see shared/billing-contract.ts).
 */
import { useQuery } from "@tanstack/react-query";
import type { StudentBillingView } from "@shared/billing-contract";
import { ApiError, getAuthToken } from "@/lib/api";

export const BILLING_API = "/api/student/billing";
export const BILLING_QUERY_KEY = [BILLING_API] as const;

export async function fetchStudentBilling(): Promise<StudentBillingView> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(BILLING_API, { credentials: "include", headers });
  if (!response.ok) {
    let code: string | undefined;
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.error && typeof body.error === "object") {
        if (typeof body.error.code === "string") code = body.error.code;
        if (typeof body.error.message === "string") message = body.error.message;
      }
    } catch {
      /* keep defaults */
    }
    throw new ApiError(message, response.status, code);
  }
  return (await response.json()) as StudentBillingView;
}

export function useStudentBilling() {
  return useQuery<StudentBillingView>({
    queryKey: [...BILLING_QUERY_KEY],
    queryFn: fetchStudentBilling,
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** Calendar date (YYYY-MM-DD) for display; timezone-free so a due date never shifts a day. */
export function formatBillingDate(iso: string, locale: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

/** Share of the net obligation covered by receipts, 0-100, rounded down so "100%" means fully covered. */
export function paidPercent(paidCents: number, netCents: number): number {
  if (netCents <= 0) return paidCents > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.floor((paidCents / netCents) * 100)));
}
