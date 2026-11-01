import React from "react";
import { Play } from "lucide-react";
import { ownerBtn } from "@/components/admin/control/owner-ui";
import { ApiError } from "@/lib/api";
import { useOpsDiagnostics, useRunConcierge } from "@/lib/s30-ops-queries";
import { DIAGNOSTIC_SUBSYSTEMS, type DiagnosticCheck } from "@shared/s30-contract";
import { cn } from "@/lib/utils";
import { diagCodeText, diagFactLabel, diagFactValue, formatWhen, shortSha } from "./ops-helpers";
import { useOpsT } from "./use-ops-t";
import { OpsCard, SectionLoading, SectionState, Spinner, STATUS_ICON, STATUS_PILL, STATUS_RANK } from "./ops-ui";

function StatusPill({ status }: { status: DiagnosticCheck["status"] }) {
  const { t } = useOpsT();
  const Icon = STATUS_ICON[status] ?? STATUS_ICON.off;
  return <span className={cn("pill", STATUS_PILL[status] ?? "plan")} data-status={status}><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t(`ops.diag.status.${status}`)}</span>;
}

function Tile({ check }: { check: DiagnosticCheck }) {
  const { t, locale } = useOpsT();
  const facts = Object.entries(check.facts ?? {}).filter(([, v]) => v !== null && v !== "");
  const name = t(`ops.diag.name.${check.key}`);
  return (
    <li className="min-w-0 rounded-xl border p-3" style={{ borderColor: "var(--t-line-2)", background: "var(--t-panel)" }} data-testid="ops-diag-tile" data-check={check.key} data-status={check.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-[0.92rem] font-semibold" style={{ color: "var(--t-text)" }}>{name}</h3>
        <StatusPill status={check.status} />
      </div>
      <p className="mb-0 mt-2 break-words text-[0.82rem]" style={{ color: "var(--t-text-2)" }} data-testid="ops-diag-code" data-code={check.code}>{diagCodeText(t, check.code)}</p>
      {facts.length ? (
        <dl className="m-0 mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[0.76rem]">
          {facts.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt style={{ color: "var(--t-muted)" }} className="min-w-0 break-words">{diagFactLabel(t, k)}</dt>
              <dd className="m-0 min-w-0 break-words text-right tabular-nums" style={{ color: "var(--t-text)" }}>{diagFactValue(t, v, locale)}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}
    </li>
  );
}

function ConciergeRun() {
  const { t } = useOpsT();
  const run = useRunConcierge();
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4" style={{ borderColor: "var(--t-line-2)" }} data-testid="ops-concierge">
      <div className="min-w-0 flex-1" style={{ flexBasis: 220 }}>
        <h3 className="m-0 text-[0.92rem] font-semibold" style={{ color: "var(--t-text)" }}>{t("ops.run.title")}</h3>
        <p className="small m-0 mt-1">{t("ops.run.hint")}</p>
      </div>
      <button type="button" className={cn(ownerBtn.primary, "min-h-[40px] gap-2 px-4")} disabled={run.isPending} onClick={() => run.mutate()} data-testid="ops-run-concierge">
        {run.isPending ? <><Spinner />{t("ops.run.running")}</> : <><Play className="h-4 w-4" aria-hidden="true" />{t("ops.run.button")}</>}
      </button>
      <div className="basis-full" aria-live="polite">
        {run.isSuccess ? <p className="notice m-0" data-testid="ops-run-result">{t("ops.run.done", { planned: run.data.planned ?? 0, created: run.data.created ?? 0, emailed: run.data.emailed ?? 0, students: run.data.students ?? 0 })}</p> : null}
        {run.isError ? <p className="notice warn m-0" role="alert" data-testid="ops-run-error">{run.error instanceof ApiError && run.error.status === 503 ? t("ops.unavailable.body") : t("ops.run.failed")}</p> : null}
      </div>
    </div>
  );
}

export function DiagnosticsPanel() {
  const { t, locale } = useOpsT();
  const q = useOpsDiagnostics(true);
  let body: React.ReactNode;
  if (q.isLoading) body = <SectionLoading label={t("ops.loading")} />;
  else if (q.isError || !q.data) body = <SectionState error={q.error} onRetry={() => void q.refetch()} testId="ops-diagnostics" />;
  else {
    const d = q.data;
    const order = new Map<string, number>(DIAGNOSTIC_SUBSYSTEMS.map((k, i) => [k, i]));
    const checks = [...d.checks].sort((a, b) => (STATUS_RANK[a.status] ?? 4) - (STATUS_RANK[b.status] ?? 4) || (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
    const sha = shortSha(d.release);
    body = (
      <>
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="ops-diag-overall">
          <span className="small">{t("ops.diag.overall")}</span>
          <StatusPill status={d.overall} />
          <span className="small" data-testid="ops-diag-release">{sha ? t("ops.diag.release", { sha }) : t("ops.diag.releaseUnknown")}</span>
          <span className="small"><time dateTime={d.generatedAt}>{t("ops.diag.checked", { time: formatWhen(d.generatedAt, locale, true) })}</time></span>
        </div>
        <ul className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 240px), 1fr))" }}>
          {checks.map((c) => <Tile key={c.key} check={c} />)}
        </ul>
      </>
    );
  }
  return (
    <OpsCard id="ops-diagnostics-h" title={t("ops.diag.title")} testId="ops-diagnostics">
      {body}
      <ConciergeRun />
    </OpsCard>
  );
}
