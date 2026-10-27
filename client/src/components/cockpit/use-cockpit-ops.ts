/**
 * Operational sources for the cockpit. Reuses the existing react-query hooks (same query keys as the Documents,
 * Support and Billing pages) so nothing is fetched twice. A failing source becomes "unavailable"; billing that is
 * not set up becomes "not_set_up". Nothing is ever shown as zero or success when the source did not answer.
 */
import { useMemo } from "react";
import { ApiError } from "@/lib/api";
import { useDocuments, useMyProfile } from "@/hooks/use-documents";
import { useTickets } from "@/hooks/use-tickets";
import { useStudentBilling } from "@/lib/billing-queries";
import { summarizeBilling, summarizeDocuments, summarizeTickets, type CockpitOps, type OpsSource } from "./model";

export function useCockpitOps(): { ops: CockpitOps; firstName: string | null } {
  const profile = useMyProfile();
  const docs = useDocuments(profile.data?.id ?? null);
  const tickets = useTickets({ limit: 100 });
  const billing = useStudentBilling();
  const first = (profile.data as { first_name?: string } | null | undefined)?.first_name ?? null;

  const ops = useMemo<CockpitOps>(() => {
    let documents: OpsSource<ReturnType<typeof summarizeDocuments>>;
    if (profile.isLoading || (profile.data && docs.isLoading)) documents = { state: "loading" };
    else if (!profile.data || docs.error || !docs.data) documents = { state: "unavailable" };
    else documents = { state: "ready", data: summarizeDocuments(docs.data) };

    const support: CockpitOps["support"] = tickets.isLoading ? { state: "loading" } : tickets.error || !tickets.data ? { state: "unavailable" } : { state: "ready", data: summarizeTickets(tickets.data.tickets) };

    let payments: CockpitOps["payments"];
    if (billing.isLoading) payments = { state: "loading" };
    else if (billing.error) payments = billing.error instanceof ApiError && billing.error.status === 404 ? { state: "not_set_up" } : { state: "unavailable" };
    else if (!billing.data) payments = { state: "unavailable" };
    else payments = summarizeBilling(billing.data, new Date().toISOString().slice(0, 10));
    return { documents, support, payments };
  }, [profile.isLoading, profile.data, docs.isLoading, docs.error, docs.data, tickets.isLoading, tickets.error, tickets.data, billing.isLoading, billing.error, billing.data]);

  return { ops, firstName: first };
}
