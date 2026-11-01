import React, { useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { ownerBtn } from "@/components/admin/control/owner-ui";
import { queueActionHref, queueItemMeta } from "@/lib/owner-presentation";
import { useT } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useOpsExceptions, useUpdateException } from "@/lib/s30-ops-queries";
import { EXCEPTION_STATES, type ExceptionState, type OpsExceptionView } from "@shared/s30-contract";
import { cn } from "@/lib/utils";
import { exceptionsInState, formatWhen, isKnownQueueKind, kindKey } from "./ops-helpers";
import { useOpsT } from "./use-ops-t";
import { OpsCard, SectionLoading, SectionState, SeverityBadge } from "./ops-ui";

const SNOOZE_DAYS = [1, 3, 7] as const;
const btn = cn(ownerBtn.outline, "min-h-[36px] px-3 py-1.5 text-[0.8rem]");

function ExceptionRow({ ex, isAdmin, role, busy, onChange }: {
  ex: OpsExceptionView; isAdmin: boolean; role: string | undefined; busy: boolean;
  onChange: (state: ExceptionState, snoozeDays?: number) => void;
}) {
  const { t, locale } = useOpsT();
  const { t: tCore } = useT();
  const meta = queueItemMeta(ex);
  const kind = isKnownQueueKind(ex.kind) ? t(kindKey(ex.kind)) : String(ex.kind);
  return (
    <li className="grid gap-2 border-t py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4" style={{ borderColor: "var(--t-line-2)" }} data-testid="ops-exception-row" data-state={ex.state} data-severity={ex.severity} data-kind={ex.kind}>
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={ex.severity} />
          <span className="text-[0.82rem] font-semibold" style={{ color: "var(--t-text)" }} data-testid="ops-exception-kind">{kind}</span>
        </div>
        <p className="m-0 break-words text-[0.9rem] font-medium" style={{ color: "var(--t-text)" }}>{ex.studentName}</p>
        {ex.detail ? <p className="m-0 break-words text-[0.84rem]" style={{ color: "var(--t-text-2)" }} data-testid="ops-exception-detail">{ex.detail}</p> : null}
        <p className="small m-0">
          {ex.at ? <time dateTime={ex.at}>{formatWhen(ex.at, locale)}</time> : null}
          {ex.state === "snoozed" && ex.snoozedUntil ? <>{ex.at ? " · " : ""}{t("ops.exc.snoozedUntil", { date: formatWhen(ex.snoozedUntil, locale) })}</> : null}
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-2 sm:max-w-[320px] sm:justify-end" role="group" aria-label={t("ops.exc.actionsFor", { name: ex.studentName })}>
        <Link href={queueActionHref(ex.href, role)} className={cn(ownerBtn.seal, "min-h-[36px] gap-1.5 px-3 py-1.5 text-[0.8rem]")} data-testid="ops-exception-action">
          {tCore(meta.actionKey)}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
        {isAdmin && ex.state === "open" ? <button type="button" className={btn} disabled={busy} onClick={() => onChange("acknowledged")} data-testid="ops-exception-ack">{t("ops.exc.ack")}</button> : null}
        {isAdmin && ex.state !== "snoozed" ? SNOOZE_DAYS.map((d) => (
          <button key={d} type="button" className={btn} disabled={busy} onClick={() => onChange("snoozed", d)}
            aria-label={t("ops.exc.snoozeFor", { label: t(`ops.exc.snooze.${d}`) })} data-testid={`ops-exception-snooze-${d}`}>
            {t("ops.exc.snooze")} {t(`ops.exc.snooze.${d}`)}
          </button>
        )) : null}
        {isAdmin && ex.state !== "open" ? <button type="button" className={btn} disabled={busy} onClick={() => onChange("open")} data-testid="ops-exception-reopen">{t("ops.exc.reopen")}</button> : null}
      </div>
    </li>
  );
}

export function ExceptionsPanel({ isAdmin, role }: { isAdmin: boolean; role: string | undefined }) {
  const { t } = useOpsT();
  const q = useOpsExceptions();
  const update = useUpdateException();
  const [tab, setTab] = useState<ExceptionState>("open");
  const [message, setMessage] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const change = (ex: OpsExceptionView, state: ExceptionState, snoozeDays?: number) => {
    setMessage(null);
    setPendingId(ex.id);
    update.mutate({ id: ex.id, state, snoozeDays }, {
      onError: (e) => setMessage(e instanceof ApiError && e.status === 404 ? t("ops.exc.gone") : e instanceof ApiError && e.status === 403 ? t("ops.exc.forbidden") : t("ops.exc.failed")),
      onSettled: () => setPendingId(null),
    });
  };

  let body: React.ReactNode;
  if (q.isLoading) body = <SectionLoading label={t("ops.loading")} />;
  else if (q.isError || !q.data) body = <SectionState error={q.error} onRetry={() => void q.refetch()} testId="ops-exceptions" />;
  else {
    const d = q.data;
    const rows = exceptionsInState(d.exceptions, tab);
    body = (
      <>
        <div role="tablist" aria-label={t("ops.exc.tabs")} className="mb-2 flex flex-wrap gap-2">
          {EXCEPTION_STATES.map((s) => {
            const active = s === tab;
            return (
              <button key={s} type="button" role="tab" id={`ops-tab-${s}`} aria-selected={active} aria-controls="ops-exceptions-list" tabIndex={active ? 0 : -1}
                onClick={() => setTab(s)} data-testid={`ops-tab-${s}`} data-active={active}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                  const i = EXCEPTION_STATES.indexOf(s); const next = EXCEPTION_STATES[(i + (e.key === "ArrowRight" ? 1 : EXCEPTION_STATES.length - 1)) % EXCEPTION_STATES.length]!;
                  setTab(next); requestAnimationFrame(() => document.getElementById(`ops-tab-${next}`)?.focus());
                }}
                className={cn(ownerBtn.outline, "min-h-[36px] gap-2 px-3 py-1.5 text-[0.82rem]", active && "border-[var(--t-accent)] bg-[var(--t-accent-dim)] font-semibold")}>
                {t(`ops.exc.tab.${s}`)}<span className="small tabular-nums" data-testid={`ops-count-${s}`}>{d.counts[s]}</span>
              </button>
            );
          })}
        </div>
        {d.truncated ? <p className="notice warn" role="status" data-testid="ops-truncated">{t("ops.exc.truncated")}</p> : null}
        {message ? <p className="notice warn" role="alert" data-testid="ops-exception-error">{message}</p> : null}
        <div id="ops-exceptions-list" role="tabpanel" aria-labelledby={`ops-tab-${tab}`}>
          {rows.length === 0 ? <p className="small py-4 text-center" data-testid="ops-exceptions-empty">{t(`ops.exc.empty.${tab}`)}</p> : (
            <ul>{rows.map((ex) => <ExceptionRow key={ex.id} ex={ex} isAdmin={isAdmin} role={role} busy={update.isPending && pendingId === ex.id} onChange={(s, days) => change(ex, s, days)} />)}</ul>
          )}
        </div>
      </>
    );
  }
  return <OpsCard id="ops-exceptions-h" title={t("ops.exc.title")} testId="ops-exceptions">{body}</OpsCard>;
}
