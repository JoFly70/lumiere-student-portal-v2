/**
 * S30 owner Operations Center (/admin/operations). Admin sees exceptions, events, diagnostics and the reminder control;
 * staff see exceptions and events only (no state changes, no health checks).
 */
import React from "react";
import { RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useIsFetching } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { ownerBtn } from "@/components/admin/control/owner-ui";
import { OPS_DIAGNOSTICS_KEY, OPS_EVENTS_KEY, OPS_EXCEPTIONS_KEY } from "@/lib/s30-ops-queries";
import { ExceptionsPanel } from "@/components/s30/operations/exceptions-panel";
import { EventsPanel } from "@/components/s30/operations/events-panel";
import { DiagnosticsPanel } from "@/components/s30/operations/diagnostics-panel";
import { Spinner } from "@/components/s30/operations/ops-ui";
import { useOpsT } from "@/components/s30/operations/use-ops-t";
import { cn } from "@/lib/utils";
import "@/styles/student-s27.css";
import "@/styles/student-s27-extra.css";
import "@/styles/owner-cockpit.css";

export default function AdminOperations() {
  const { t } = useOpsT();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === "admin";
  const fetching = useIsFetching({ predicate: (q) => [OPS_EXCEPTIONS_KEY, OPS_EVENTS_KEY, OPS_DIAGNOSTICS_KEY].some((k) => q.queryKey[0] === k[0]) }) > 0;

  const refresh = () => {
    for (const k of [OPS_EXCEPTIONS_KEY, OPS_EVENTS_KEY, ...(isAdmin ? [OPS_DIAGNOSTICS_KEY] : [])]) void qc.invalidateQueries({ queryKey: [...k] });
  };

  return (
    <div className="s27 occ" data-testid="admin-operations">
      <header className="deck-head">
        <div className="min-w-0">
          <span className="eyebrow">{t("ops.eyebrow")}</span>
          <h1 data-testid="text-page-title">{t("ops.title")}</h1>
          <p className="small m-0 mt-2 max-w-xl">{t("ops.subtitle")}</p>
        </div>
        <div className="status">
          <button type="button" className={cn(ownerBtn.outline, "min-h-[40px] gap-2 px-4")} onClick={refresh} disabled={fetching} aria-label={t("ops.refresh")} data-testid="ops-refresh">
            {fetching ? <Spinner /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {fetching ? t("ops.refreshing") : t("ops.refresh")}
          </button>
        </div>
      </header>
      {!isAdmin ? <p className="notice" role="note" data-testid="ops-staff-note">{t("ops.staffNote")}</p> : null}
      <ExceptionsPanel isAdmin={isAdmin} role={user?.role} />
      <EventsPanel />
      {isAdmin ? <DiagnosticsPanel /> : null}
    </div>
  );
}
