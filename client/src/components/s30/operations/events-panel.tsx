import React, { useMemo } from "react";
import { Link } from "wouter";
import { ownerBtn } from "@/components/admin/control/owner-ui";
import { useOpsEvents } from "@/lib/s30-ops-queries";
import { cn } from "@/lib/utils";
import { SEVERITY_ICON, DemoBadge, OpsCard, SectionLoading, SectionState, Spinner } from "./ops-ui";
import { eventKey, formatWhen, mergeEventPages, relativeTime, SEVERITY_META } from "./ops-helpers";
import { useOpsT } from "./use-ops-t";

export function EventsPanel() {
  const { t, locale } = useOpsT();
  const q = useOpsEvents();
  const events = useMemo(() => mergeEventPages(q.data?.pages ?? []), [q.data]);
  const now = new Date();

  let body: React.ReactNode;
  if (q.isLoading) body = <SectionLoading label={t("ops.loading")} />;
  else if (q.isError && !q.data) body = <SectionState error={q.error} onRetry={() => void q.refetch()} testId="ops-events" />;
  else if (events.length === 0) body = <p className="small py-4 text-center" data-testid="ops-events-empty">{t("ops.events.empty")}</p>;
  else {
    body = (
      <>
        <ol className="m-0 list-none p-0">
          {events.map((e) => {
            const sev = SEVERITY_META[e.severity] ?? SEVERITY_META.info;
            const Icon = SEVERITY_ICON[sev.icon];
            return (
              <li key={e.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-t py-3 first:border-t-0" style={{ borderColor: "var(--t-line-2)" }} data-testid="ops-event-row" data-kind={e.kind}>
                <span className={cn("pill", sev.pill)} style={{ padding: 6 }} title={t(sev.labelKey)}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">{t(sev.labelKey)}</span>
                </span>
                <div className="min-w-0">
                  <p className="m-0 break-words text-[0.9rem] font-medium" style={{ color: "var(--t-text)" }}>{t(eventKey(e.kind)) === eventKey(e.kind) ? e.kind : t(eventKey(e.kind))}</p>
                  <p className="small m-0 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>{e.studentName ?? t("ops.events.system")}</span>
                    {e.isDemo ? <DemoBadge /> : null}
                    <time dateTime={e.createdAt} title={formatWhen(e.createdAt, locale, true)}>{relativeTime(e.createdAt, now, locale)} · {formatWhen(e.createdAt, locale, true)}</time>
                    {e.href ? <Link href={e.href} className="link" data-testid="ops-event-link">{t("ops.events.open")} →</Link> : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex justify-center">
          {q.hasNextPage ? (
            <button type="button" className={cn(ownerBtn.outline, "min-h-[40px] gap-2")} disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()} data-testid="ops-events-older">
              {q.isFetchingNextPage ? <><Spinner />{t("ops.events.loading")}</> : t("ops.events.loadOlder")}
            </button>
          ) : <p className="small m-0" data-testid="ops-events-end">{t("ops.events.end")}</p>}
        </div>
      </>
    );
  }
  return <OpsCard id="ops-events-h" title={t("ops.events.title")} testId="ops-events">{body}</OpsCard>;
}
