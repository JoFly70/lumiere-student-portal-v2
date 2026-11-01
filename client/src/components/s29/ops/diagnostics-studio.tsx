/**
 * S29 Owner Operations & Diagnostics Studio (/admin/diagnostics, admin only).
 * An operational summary first, technical detail on demand. States come from recorded evidence; nothing is assumed
 * healthy, an unknown state reads "Unknown / Unverified", and a release is "live" only when both SHAs are known and equal.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Play } from "lucide-react";
import { useT } from "@/i18n";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  DIAGNOSTIC_CHECKS,
  type DiagnosticCheckKey,
  type DiagnosticCheckResult,
  type FeatureReadinessView,
  type IncidentView,
  type JobView,
  type SubsystemView,
} from "@shared/s29-contract";
import { useDiagnostics, useIncidentAction, useIncidents, useRunCheck, useRunScheduler } from "@/lib/s29-ops-queries";
import {
  RELEASE_VERDICT, checkQuestionKey, featureLabelKey, formatDateTime, formatDuration, formatInterval, formatRelativeAge, healthPresentation,
  humanize, incidentActions, incidentStatusPresentation, opsKeyOrNull, releaseVerdict, severityPresentation, shortSha, sortBySeverity, stepPresentation, summarize,
  type OpsKey,
} from "@/lib/s29-ops-presentation";
import { CopyValue, LoadingBlock, OpsGlyph, PageHead, QueryProblem, RefreshButton, Section, StateChip, useNow } from "./ops-ui";

function useFormat() {
  const { t, language } = useT();
  const now = useNow();
  return {
    t, language, now, colon: language === "fr" ? "\u00A0: " : ": ",
    ago: (iso: string | null | undefined) => formatRelativeAge(iso, now, language),
    when: (iso: string | null | undefined) => formatDateTime(iso, language),
  };
}

/** Absolute time with the relative age underneath (never blank). */
function Stamp({ iso }: { iso: string | null | undefined }) {
  const { t, ago, when } = useFormat();
  const abs = when(iso);
  if (!abs) return <>{t("s29.ops.notReported")}</>;
  return <>{abs}<small>{ago(iso)}</small></>;
}

// ── summary ─────────────────────────────────────────────────────────────────

function SummaryBand({ view, refetch, busy }: { view: NonNullable<ReturnType<typeof useDiagnostics>["data"]>; refetch: () => void; busy: boolean }) {
  const { t, ago, when } = useFormat();
  const s = summarize(view);
  const p = healthPresentation(s.state);
  const failing = Math.max(view.summary.failingSubsystems, view.subsystems.filter((x) => x.state === "failed" || x.state === "degraded").length);
  const open = Math.max(view.summary.openIncidents, view.incidents.filter((i) => i.status === "open").length);
  return (
    <section className="card ops-summary" data-testid="diag-summary" data-state={s.state} aria-labelledby="diag-summary-h">
      <div className={`ops-seal ${p.tone}`}><OpsGlyph icon={p.icon} /></div>
      <div className="min-w-0">
        <h2 id="diag-summary-h" className="ops-headline" data-testid="diag-headline">{t(s.headlineKey)}</h2>
        <div className="ops-meta">
          <StateChip tone={p.tone} icon={p.icon} label={t(p.labelKey)} />
          <span title={when(view.generatedAt) ?? undefined}>{t("s29.ops.diag.generated", { when: ago(view.generatedAt) ?? t("s29.ops.notReported") })}</span>
        </div>
      </div>
      <div className="ops-sum-act"><RefreshButton onClick={refetch} busy={busy} /></div>
      <div className="ops-counts">
        <div className={cn("ops-count", open > 0 && "attn")}><b>{open}</b><span>{t("s29.ops.diag.openIncidents")}</span></div>
        <div className={cn("ops-count", failing > 0 && "attn")}><b>{failing}</b><span>{t("s29.ops.diag.failing")}</span></div>
        <div className="ops-count"><b>{s.unverified}</b><span>{t("s29.ops.diag.unverified")}</span></div>
        <div className="ops-count"><b>{s.notConfigured}</b><span>{t("s29.ops.diag.notConfigured")}</span></div>
      </div>
      <p className="ops-legend">{t("s29.ops.legend")}</p>
    </section>
  );
}

// ── A. release ──────────────────────────────────────────────────────────────

function ReleaseCard({ r }: { r: NonNullable<ReturnType<typeof useDiagnostics>["data"]>["release"] }) {
  const { t, ago } = useFormat();
  const verdict = releaseVerdict(r);
  const v = RELEASE_VERDICT[verdict];
  const dom = healthPresentation(r.customDomain.state);
  const age = ago(r.releaseFileWrittenAt ?? r.processStartedAt);
  const copy = (label: OpsKey, sha: string | null, testId: string) => sha
    ? <CopyValue value={sha} short={shortSha(sha) ?? sha} label={t(label)} testId={testId} />
    : <>{t("s29.ops.notReported")}</>;
  return (
    <Section id="diag-release" testId="diag-release" title={t("s29.ops.release.title")} sub={t("s29.ops.release.sub")}>
      <div className={cn("ops-verdict", v.tone)} data-verdict={verdict} data-testid="diag-release-verdict" role="status">
        <OpsGlyph icon={v.icon} />
        <b>{t(v.titleKey)}</b>
        <p>{t(v.bodyKey)}</p>
      </div>
      <dl className="ops-dl">
        <div className="wide"><dt>{t("s29.ops.release.appUrl")}</dt><dd>{r.appUrl ? <a href={r.appUrl} target="_blank" rel="noreferrer noopener" className="ops-mono">{r.appUrl}</a> : t("s29.ops.notReported")}</dd></div>
        <div><dt>{t("s29.ops.release.environment")}</dt><dd>{r.environment || t("s29.ops.notReported")}</dd></div>
        <div><dt>{t("s29.ops.release.running")}</dt><dd>{copy("s29.ops.release.running", r.runningSha, "diag-sha-running")}</dd></div>
        <div><dt>{t("s29.ops.release.marker")}</dt><dd>{copy("s29.ops.release.marker", r.markerSha, "diag-sha-marker")}{r.markerCheckedAt ? <small>{t("s29.ops.release.markerChecked", { when: ago(r.markerCheckedAt) ?? "" })}</small> : null}</dd></div>
        <div><dt>{t("s29.ops.release.processStarted")}</dt><dd><Stamp iso={r.processStartedAt} /></dd></div>
        <div><dt>{t("s29.ops.release.age")}</dt><dd>{age ?? t("s29.ops.notReported")}</dd></div>
        <div><dt>{t("s29.ops.release.fileWritten")}</dt><dd><Stamp iso={r.releaseFileWrittenAt} /></dd></div>
        <div className="wide">
          <dt>{t("s29.ops.release.domain")}</dt>
          <dd><span className="ops-mono">{r.customDomain.host}</span>{" "}<StateChip tone={dom.tone} icon={dom.icon} label={t(dom.labelKey)} testId="diag-domain-state" /><small>{r.customDomain.evidence}</small></dd>
        </div>
      </dl>
    </Section>
  );
}

// ── B. subsystems ───────────────────────────────────────────────────────────

function EvidenceToggle({ lines, label }: { lines: readonly string[]; label: string }) {
  const [open, setOpen] = useState(false);
  const { t } = useT();
  if (lines.length === 0) return <p className="ops-note">{t("s29.ops.sub.noEvidence")}</p>;
  return (
    <>
      <button type="button" className="ops-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}<ChevronDown aria-hidden="true" />
      </button>
      {open ? <ul className="ops-ev">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
    </>
  );
}

function SubsystemTile({ s }: { s: SubsystemView }) {
  const { t, ago, when } = useFormat();
  const p = healthPresentation(s.state);
  const nameKey = opsKeyOrNull("s29.ops.sub.", s.key);
  return (
    <li className="ops-tile" data-testid="diag-subsystem" data-key={s.key} data-state={s.state} data-tone={p.tone}>
      <div className="ops-tile-h">
        <b>{nameKey ? t(nameKey) : humanize(s.key)}</b>
        <StateChip tone={p.tone} icon={p.icon} label={t(p.labelKey)} />
      </div>
      <div className="ops-tile-m">
        <span title={when(s.checkedAt) ?? undefined}>{t("s29.ops.checkedAgo", { when: ago(s.checkedAt) ?? t("s29.ops.notReported") })}</span>
        {s.latencyMs !== null && s.latencyMs !== undefined ? <span>{s.latencyMs} ms</span> : null}
      </div>
      <EvidenceToggle lines={s.evidence} label={t("s29.ops.sub.evidence", { n: s.evidence.length })} />
    </li>
  );
}

// ── C. incidents ────────────────────────────────────────────────────────────

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(id); }, [value, ms]);
  return v;
}

function IncidentExplorer() {
  const { t, ago, when, colon } = useFormat();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const debounced = useDebounced(search, 300);
  const q = useIncidents(debounced, status);
  const act = useIncidentAction();
  const rows = q.data ?? [];
  const pendingId = act.isPending ? act.variables?.id : null;

  return (
    <Section id="diag-incidents" testId="diag-incidents" title={t("s29.ops.inc.title")} sub={t("s29.ops.inc.sub")}>
      <div className="ops-filters">
        <label className="ops-field grow"><span>{t("s29.ops.inc.search")}</span>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("s29.ops.inc.searchPlaceholder")} data-testid="diag-incident-search" /></label>
        <label className="ops-field"><span>{t("s29.ops.inc.filter")}</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="diag-incident-status">
            {(["all", "open", "acknowledged", "resolved"] as const).map((s) => <option key={s} value={s}>{t(`s29.ops.inc.filter.${s}` as OpsKey)}</option>)}
          </select></label>
      </div>
      {act.isError ? <p className="ops-fb err" role="alert">{t("s29.ops.inc.actionFailed")}</p> : null}
      {q.isLoading ? <div className="occ-skel" style={{ height: 120 }} role="status" aria-label={t("s29.ops.loading")} /> : q.isError ? (
        <QueryProblem error={q.error} onRetry={() => void q.refetch()} testId="diag-incidents" />
      ) : rows.length === 0 ? <p className="ops-empty" data-testid="diag-incidents-empty">{t("s29.ops.inc.empty")}</p> : (
        <div className="ops-tablewrap">
          <table className="ops-table">
            <colgroup><col style={{ width: "12%" }} /><col style={{ width: "13%" }} /><col style={{ width: "15%" }} /><col style={{ width: "11%" }} /><col style={{ width: "12%" }} /><col /><col style={{ width: "156px" }} /></colgroup>
            <thead><tr>
              <th>{t("s29.ops.inc.col.first")}</th><th>{t("s29.ops.inc.col.subsystem")}</th><th>{t("s29.ops.inc.col.severity")}</th><th>{t("s29.ops.inc.col.request")}</th>
              <th>{t("s29.ops.inc.col.count")}</th><th>{t("s29.ops.inc.col.cause")}</th><th>{t("s29.ops.inc.col.actions")}</th>
            </tr></thead>
            <tbody>
              {rows.map((i: IncidentView) => {
                const st = incidentStatusPresentation(i.status);
                const sev = severityPresentation(i.severity);
                const subKey = opsKeyOrNull("s29.ops.sub.", i.subsystem);
                return (
                  <tr key={i.id} data-testid="diag-incident" data-status={i.status} data-severity={i.severity}>
                    <td data-label={t("s29.ops.inc.col.first")}><div className="ops-stack"><span className="ops-strong">{when(i.firstSeenAt)}</span><span className="ops-note">{ago(i.firstSeenAt)}</span></div></td>
                    <td data-label={t("s29.ops.inc.col.subsystem")}><div className="ops-stack"><span className="ops-strong">{subKey ? t(subKey) : humanize(i.subsystem)}</span><span className="ops-note">{humanize(i.category)}</span></div></td>
                    <td data-label={t("s29.ops.inc.col.severity")}><div className="ops-stack">
                      <StateChip tone={sev.tone} icon={sev.icon} label={t(sev.labelKey)} />
                      <StateChip tone={st.tone} icon={st.icon} label={t(st.labelKey)} />
                      {i.acknowledgedBy ? <span className="ops-note">{t("s29.ops.inc.acknowledgedBy", { who: i.acknowledgedBy })}</span> : null}
                    </div></td>
                    <td data-label={t("s29.ops.inc.col.request")}>{i.lastRequestId ? <span className="ops-mono">{i.lastRequestId}</span> : t("s29.ops.notReported")}</td>
                    <td data-label={t("s29.ops.inc.col.count")}><div className="ops-stack"><span className="ops-strong">{t("s29.ops.inc.times", { n: i.occurrences })}</span><span className="ops-note">{t("s29.ops.inc.col.last")}{colon}{ago(i.lastSeenAt)}</span></div></td>
                    <td className="full" data-label={t("s29.ops.inc.col.cause")}><div className="ops-stack">
                      <span>{i.likelyCause ?? t("s29.ops.inc.notDetermined")}</span>
                      <span className="ops-note"><b>{t("s29.ops.inc.col.next")}{colon}</b>{" "}{i.nextAction ?? t("s29.ops.inc.notDetermined")}</span>
                    </div></td>
                    <td className="acts" data-label={t("s29.ops.inc.col.actions")}>
                      <div className="ops-acts">
                        {incidentActions(i.status).map((a) => (
                          <button key={a} type="button" className="b2 ops-btn" disabled={pendingId === i.id} data-testid={`diag-incident-${a}`}
                            onClick={() => act.mutate({ id: i.id, action: a })}>
                            {pendingId === i.id ? <Loader2 className="ops-spin" aria-hidden="true" /> : null}{t(`s29.ops.inc.${a}` as OpsKey)}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ── D. features ─────────────────────────────────────────────────────────────

function FeatureMatrix({ features }: { features: readonly FeatureReadinessView[] }) {
  const { t } = useT();
  const sorted = useMemo(() => sortBySeverity(features), [features]);
  return (
    <Section id="diag-features" title={t("s29.ops.feat.title")} sub={t("s29.ops.feat.sub")}>
      {sorted.length === 0 ? <p className="ops-empty">{t("s29.ops.feat.empty")}</p> : (
        <ul className="ops-grid">
          {sorted.map((f) => {
            const p = healthPresentation(f.state);
            const nameKey = opsKeyOrNull("s29.ops.feature.", f.key);
            return (
              <li key={f.key} className="ops-tile" data-testid="diag-feature" data-key={f.key} data-state={f.state} data-tone={p.tone}>
                <div className="ops-tile-h">
                  <b>{nameKey ? t(nameKey) : humanize(f.key)}</b>
                  <StateChip tone={p.tone} icon={p.icon} label={t(featureLabelKey(f.state))} />
                </div>
                <EvidenceToggle lines={f.evidence} label={t("s29.ops.sub.evidence", { n: f.evidence.length })} />
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ── E. one-click checks ─────────────────────────────────────────────────────

function CheckResult({ r }: { r: DiagnosticCheckResult }) {
  const { t, ago, when } = useFormat();
  const p = healthPresentation(r.state);
  const q = checkQuestionKey(r.key);
  return (
    <div className="ops-result" data-testid={`diag-check-result-${r.key}`} data-state={r.state}>
      <div className="ops-tile-h">
        <h3>{t(q)}</h3>
        <StateChip tone={p.tone} icon={p.icon} label={t(p.labelKey)} />
      </div>
      <p className="ops-note" title={when(r.ranAt) ?? undefined}>{t("s29.ops.check.ranAt", { when: ago(r.ranAt) ?? "" })} · {t("s29.ops.check.duration", { t: formatDuration(r.durationMs) })}</p>
      <ol className="ops-steps" style={{ listStyle: "none", padding: 0 }}>
        {r.steps.map((s, i) => {
          const sp = stepPresentation(s.ok);
          return (
            <li key={i} data-testid="diag-check-step" data-ok={String(s.ok)}>
              <OpsGlyph icon={sp.icon} className={sp.tone} />
              <b>{s.label} <span className="ops-note">({t(sp.labelKey)})</span></b>
              {s.detail ? <span className="d">{s.detail}</span> : null}
            </li>
          );
        })}
      </ol>
      <div className="ops-conc">
        <div><span className="ops-lbl">{t("s29.ops.check.conclusion")}</span><p>{r.conclusion}</p></div>
        <div><span className="ops-lbl">{t("s29.ops.check.next")}</span><p>{r.nextAction ?? t("s29.ops.check.none")}</p></div>
      </div>
    </div>
  );
}

function ChecksPanel() {
  const { t } = useT();
  const run = useRunCheck();
  const [results, setResults] = useState<Partial<Record<DiagnosticCheckKey, DiagnosticCheckResult>>>({});
  const [order, setOrder] = useState<DiagnosticCheckKey[]>([]);
  const [failedKey, setFailedKey] = useState<DiagnosticCheckKey | null>(null);
  const go = (key: DiagnosticCheckKey) => {
    setFailedKey(null);
    run.mutate(key, {
      onSuccess: (r) => { setResults((m) => ({ ...m, [key]: r })); setOrder((o) => [key, ...o.filter((k) => k !== key)]); },
      onError: () => setFailedKey(key),
    });
  };
  const running = run.isPending ? run.variables : null;
  return (
    <Section id="diag-checks" testId="diag-checks" title={t("s29.ops.checks.title")} sub={t("s29.ops.checks.sub")}>
      <p className="ops-ro" data-testid="diag-checks-readonly">{t("s29.ops.checks.readonly")}</p>
      <div className="ops-checks">
        {DIAGNOSTIC_CHECKS.map((key) => {
          const last = results[key];
          const lp = last ? healthPresentation(last.state) : null;
          return (
            <button key={key} type="button" className="ops-check" disabled={running === key} onClick={() => go(key)} data-testid={`diag-check-${key}`}>
              <span>{t(checkQuestionKey(key))}</span>
              <span className="go">{running === key ? <><Loader2 className="ops-spin" aria-hidden="true" />{t("s29.ops.check.running")}</> : <><Play aria-hidden="true" />{t("s29.ops.check.run")}</>}</span>
              {lp && last ? <StateChip tone={lp.tone} icon={lp.icon} label={t(lp.labelKey)} /> : null}
            </button>
          );
        })}
      </div>
      {failedKey ? <p className="ops-fb err" role="alert">{t("s29.ops.check.failed")}</p> : null}
      {order.map((k) => results[k] ? <CheckResult key={k} r={results[k]!} /> : null)}
    </Section>
  );
}

// ── F. jobs ─────────────────────────────────────────────────────────────────

function flatten(obj: unknown, prefix = "", out: [string, string][] = []): [string, string][] {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else out.push([prefix || "result", Array.isArray(obj) ? obj.map(String).join(", ") : String(obj ?? "—")]);
  return out;
}

function JobsPanel({ jobs, isAdmin }: { jobs: readonly JobView[]; isAdmin: boolean }) {
  const { t, ago, when, colon } = useFormat();
  const run = useRunScheduler();
  const sorted = useMemo(() => sortBySeverity(jobs.map((j) => ({ ...j, key: j.name }))), [jobs]);
  const kv = run.data ? flatten(run.data.result) : [];
  return (
    <Section id="diag-jobs" testId="diag-jobs" title={t("s29.ops.jobs.title")} sub={t("s29.ops.jobs.sub")} defaultOpen={false}
      aside={isAdmin ? (
        <button type="button" className="b1 ops-btn" onClick={() => run.mutate()} disabled={run.isPending} data-testid="diag-run-scheduler" title={t("s29.ops.jobs.runHint")}>
          {run.isPending ? <Loader2 className="ops-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}{run.isPending ? t("s29.ops.jobs.running") : t("s29.ops.jobs.runNow")}
        </button>
      ) : null}>
      {run.isError ? <p className="ops-fb err" role="alert">{t("s29.ops.jobs.runFailed")}</p> : null}
      {run.isSuccess ? (
        <div className="ops-result" data-testid="diag-scheduler-result" role="status">
          <p className="ops-strong">{t("s29.ops.jobs.ran")}</p>
          <dl className="ops-kv">{kv.map(([k, v]) => <React.Fragment key={k}><dt>{humanize(k)}</dt><dd>{v}</dd></React.Fragment>)}</dl>
        </div>
      ) : null}
      {sorted.length === 0 ? <p className="ops-empty">{t("s29.ops.jobs.empty")}</p> : (
        <div className="ops-tablewrap">
          <table className="ops-table">
            <colgroup><col /><col style={{ width: "11%" }} /><col style={{ width: "17%" }} /><col style={{ width: "17%" }} /><col style={{ width: "11%" }} /><col style={{ width: "15%" }} /></colgroup>
            <thead><tr>
              <th>{t("s29.ops.jobs.col.name")}</th><th>{t("s29.ops.jobs.col.interval")}</th><th>{t("s29.ops.jobs.col.started")}</th>
              <th>{t("s29.ops.jobs.col.success")}</th><th>{t("s29.ops.jobs.col.failures")}</th><th>{t("s29.ops.jobs.col.state")}</th>
            </tr></thead>
            <tbody>
              {sorted.map((j) => {
                const p = healthPresentation(j.state);
                const nk = opsKeyOrNull("s29.ops.job.", j.name);
                return (
                  <tr key={j.name} data-testid="diag-job" data-state={j.state}>
                    <td className="full" data-label={t("s29.ops.jobs.col.name")}><div className="ops-stack">
                      <span className="ops-strong">{nk ? t(nk) : humanize(j.name)}</span>
                      <span className="ops-note">{t("s29.ops.jobs.runs", { n: j.runs })}</span>
                      {j.lastError ? <span className="ops-note"><b>{t("s29.ops.jobs.lastError")}{colon}</b>{" "}{j.lastError}</span> : null}
                    </div></td>
                    <td data-label={t("s29.ops.jobs.col.interval")}>{formatInterval(j.intervalSeconds)}</td>
                    <td data-label={t("s29.ops.jobs.col.started")}><div className="ops-stack"><span title={when(j.lastStartedAt) ?? undefined}>{ago(j.lastStartedAt) ?? t("s29.ops.never")}</span></div></td>
                    <td data-label={t("s29.ops.jobs.col.success")}><div className="ops-stack"><span title={when(j.lastSuccessAt) ?? undefined}>{ago(j.lastSuccessAt) ?? t("s29.ops.never")}</span></div></td>
                    <td data-label={t("s29.ops.jobs.col.failures")}><span className={cn("ops-strong", j.consecutiveFailures > 0 && "occ-strong-umber")}>{j.consecutiveFailures}</span></td>
                    <td data-label={t("s29.ops.jobs.col.state")}><StateChip tone={p.tone} icon={p.icon} label={t(p.labelKey)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

export function DiagnosticsStudio() {
  const { t } = useT();
  const { user } = useAuth();
  const q = useDiagnostics();
  const isAdmin = user?.role === "admin";

  const head = <PageHead eyebrow={t("s29.ops.diag.eyebrow")} title={t("s29.ops.diag.title")} sub={t("s29.ops.diag.sub")} testId="diag-head" />;
  if (q.isLoading) return <LoadingBlock testId="diag-loading" />;
  if (q.isError || !q.data) {
    return <div className="s27 occ" data-testid="diag-root">{head}<QueryProblem error={q.error} onRetry={() => void q.refetch()} testId="diag" /></div>;
  }
  const d = q.data;
  const subs = sortBySeverity(d.subsystems);
  return (
    <div className="s27 occ" data-testid="diag-root">
      {head}
      <SummaryBand view={d} refetch={() => void q.refetch()} busy={q.isFetching} />
      <ReleaseCard r={d.release} />
      <Section id="diag-subsystems" testId="diag-subsystems" title={t("s29.ops.subs.title")} sub={t("s29.ops.subs.sub")}>
        {subs.length === 0 ? <p className="ops-empty">{t("s29.ops.sub.empty")}</p> : <ul className="ops-grid">{subs.map((s) => <SubsystemTile key={s.key} s={s} />)}</ul>}
      </Section>
      <IncidentExplorer />
      <FeatureMatrix features={d.features} />
      <ChecksPanel />
      <JobsPanel jobs={d.jobs} isAdmin={isAdmin} />
    </div>
  );
}
