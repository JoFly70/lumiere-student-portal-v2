/**
 * S29 — "Needs attention" operating queue inside the owner Control Center (admin + staff).
 * Each item shows: what, who/which workflow, why (recorded facts), when it arose, priority, next action, direct link.
 * Filter (workflow, priority, demo, dismissed), sort, resolve / dismiss / snooze / reopen with an optional audit note.
 * Demo students are labelled and hidden by default; counts are real students only (computed by the server).
 */
import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertCircle, ArrowRight, CheckCircle2, Clock, Flag, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useT, type TranslationKey } from "@/i18n";
import { ATTENTION_WORKFLOWS, type AttentionItemView, type AttentionPriority, type AttentionWorkflow } from "@shared/s29-contract";
import { useAuth } from "@/lib/auth";
import { queueActionHref } from "@/lib/owner-presentation";
import { isS29Unavailable, useAttention, useAttentionAction, useAttentionSync } from "@/lib/s29-core-queries";
import { cn } from "@/lib/utils";
import "@/components/s29/core/core.css";

const PRIORITY_RANK: Record<AttentionPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const LIMIT = 8;

export type AttentionSort = "priority" | "oldest" | "newest";
export function filterAndSortAttention(items: readonly AttentionItemView[], f: { workflow: AttentionWorkflow | "all"; priority: AttentionPriority | "all"; demo: boolean; dismissed: boolean; sort: AttentionSort }): AttentionItemView[] {
  const at = (i: AttentionItemView) => i.arisenAt ?? i.detectedAt;
  return items
    .filter((i) => (f.demo || !i.isDemo) && (f.dismissed || i.status === "open") && (f.workflow === "all" || i.workflow === f.workflow) && (f.priority === "all" || i.priority === f.priority))
    .sort((a, b) => f.sort === "oldest" ? at(a).localeCompare(at(b)) : f.sort === "newest" ? at(b).localeCompare(at(a)) : PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || at(a).localeCompare(at(b)));
}

function fmtDate(iso: string | null, lang: string): string {
  if (!iso) return "—";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  try {
    return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", dateOnly ? { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(dateOnly ? `${iso}T12:00:00Z` : iso));
  } catch { return iso.slice(0, 10); }
}

/** Translated "why" line from the recorded facts. */
export function useWhy() {
  const { t, language } = useT();
  return (i: AttentionItemView): string => {
    const f = i.reason.facts;
    const parts: string[] = [];
    if (typeof f.count === "number") parts.push(t("s29.core.fact.count", { n: f.count }));
    if (typeof f.dueOn === "string") parts.push(t("s29.core.fact.dueOn", { date: fmtDate(f.dueOn, language) }));
    if (typeof f.plannedOn === "string") parts.push(t("s29.core.fact.dueOn", { date: fmtDate(f.plannedOn, language) }));
    if (typeof f.daysLeft === "number") parts.push(f.daysLeft < 0 ? t("s29.core.fact.overdueDays", { n: -f.daysLeft }) : t("s29.core.fact.daysLeft", { n: f.daysLeft }));
    if (typeof f.since === "string") parts.push(t("s29.core.fact.since", { date: fmtDate(f.since, language) }));
    if (typeof f.hoursWaiting === "number") parts.push(t("s29.core.fact.hoursWaiting", { n: f.hoursWaiting }));
    if (typeof f.slotAt === "string") parts.push(t("s29.core.fact.slotAt", { date: fmtDate(f.slotAt, language) }));
    if (i.kind === "import_verification") parts.push(t("s29.core.fact.providerReported"));
    else if (f.studentReported === true || i.kind === "low_grade") parts.push(t("s29.core.fact.studentReported"));
    return parts.length ? parts.join(" · ") : i.detail;
  };
}

function Row({ item, role }: { item: AttentionItemView; role: string | undefined }) {
  const { t, language } = useT();
  const why = useWhy();
  const act = useAttentionAction();
  const [note, setNote] = useState("");
  const [error, setError] = useState(false);
  const run = (action: "resolve" | "dismiss" | "reopen", snoozeDays?: number) => {
    setError(false);
    act.mutate({ key: item.key, input: { action, ...(note.trim() ? { note: note.trim() } : {}), ...(snoozeDays ? { snoozeDays } : {}) } }, { onError: () => setError(true) });
  };
  const Icon = item.priority === "urgent" ? AlertCircle : item.priority === "high" ? Flag : Clock;
  return (
    <li className="s29-item" data-priority={item.priority} data-status={item.status} data-demo={item.isDemo ? "true" : "false"} data-testid="attention-item">
      <div className="s29-item-top">
        <span className="s29-item-what"><Icon className="mr-1.5 inline h-4 w-4" aria-hidden="true" />{t(`s29.core.kind.${item.kind}` as TranslationKey)}</span>
        <span className="flex flex-wrap gap-1.5">
          <span className={cn("s29-tag", item.priority === "urgent" && "is-urgent")} data-testid="attention-priority">{t(`s29.core.attn.pri.${item.priority}` as TranslationKey)}</span>
          <span className="s29-tag">{t(`s29.core.attn.wf.${item.workflow}` as TranslationKey)}</span>
          {item.isDemo ? <span className="s29-tag is-demo">{t("s29.core.attn.demo")}</span> : null}
          {item.status === "dismissed" ? <span className="s29-tag">{t("s29.core.attn.dismissed")}</span> : null}
        </span>
      </div>
      <p className="s29-item-who">{item.studentName ?? t("s29.core.attn.operations")}{item.studentCode ? <span className="occ-mono"> · {item.studentCode}</span> : null}</p>
      <p className="s29-item-why"><b>{t("s29.core.attn.why")}:</b> {why(item)}</p>
      <p className="s29-item-meta">
        {item.arisenAt ? <span>{t("s29.core.attn.since", { date: fmtDate(item.arisenAt, language) })}</span> : null}
        <span>{t("s29.core.attn.detected", { date: fmtDate(item.detectedAt, language) })}</span>
        <span><b>{t("s29.core.attn.next")}:</b> {t(`s29.core.action.${item.action}` as TranslationKey)}</span>
      </p>
      <div className="s29-item-acts">
        <Link href={queueActionHref(item.href, role)} className="b2 b-sm occ-btn" data-testid="attention-open">{t(`s29.core.action.${item.action}` as TranslationKey)} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
        {item.status === "open" ? (
          <>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t("s29.core.attn.notePlaceholder")} aria-label={t("s29.core.attn.notePlaceholder")} />
            <button type="button" className="link" disabled={act.isPending} onClick={() => run("resolve")} data-testid="attention-resolve">{t("s29.core.attn.resolve")}</button>
            <button type="button" className="link" disabled={act.isPending} onClick={() => run("dismiss", 7)} data-testid="attention-snooze">{t("s29.core.attn.snooze")}</button>
            <button type="button" className="link" disabled={act.isPending} onClick={() => run("dismiss")} data-testid="attention-dismiss">{t("s29.core.attn.dismiss")}</button>
          </>
        ) : (
          <button type="button" className="link" disabled={act.isPending} onClick={() => run("reopen")} data-testid="attention-reopen"><RotateCcw className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{t("s29.core.attn.reopen")}</button>
        )}
        {act.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {error ? <span role="alert" className="s29-help">{t("s29.core.attn.actionFailed")}</span> : null}
      </div>
    </li>
  );
}

/** Renders the queue. `fallback` is shown when S29 is not reachable (e.g. the S27 "Needs you" card). */
export function NeedsAttention({ fallback }: { fallback?: React.ReactNode }) {
  const { t, language } = useT();
  const { user } = useAuth();
  const role = user?.role;
  const q = useAttention();
  const sync = useAttentionSync();
  const [workflow, setWorkflow] = useState<AttentionWorkflow | "all">("all");
  const [priority, setPriority] = useState<AttentionPriority | "all">("all");
  const [demo, setDemo] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [sort, setSort] = useState<AttentionSort>("priority");
  const [all, setAll] = useState(false);
  const items = useMemo(() => filterAndSortAttention(q.data?.items ?? [], { workflow, priority, demo, dismissed, sort }), [q.data, workflow, priority, demo, dismissed, sort]);

  if (q.isError) return <>{fallback ?? (isS29Unavailable(q.error) ? null : <p role="alert" className="notice">{t("s29.core.attn.actionFailed")}</p>)}</>;
  if (q.isLoading || !q.data) return <section className="card" aria-busy="true"><div className="occ-skel" style={{ height: 180 }} /></section>;
  const d = q.data;
  const shown = all ? items : items.slice(0, LIMIT);
  const closed = d.recentlyClosed.filter((i) => demo || !i.isDemo).slice(0, 6);

  return (
    <section className="card s29-attn" aria-labelledby="cc-attn-h" data-testid="needs-attention" id="cc-attention">
      <div className="ch">
        <div className="min-w-0">
          <span className="eyebrow">{t("s29.core.attn.eyebrow")}</span>
          <h2 id="cc-attn-h">{t("s29.core.attn.title")}</h2>
        </div>
        <span className="small">
          {t("s29.core.attn.open", { n: d.counts.open })}
          {d.lastSyncAt ? <> · {t("s29.core.attn.synced", { time: fmtDate(d.lastSyncAt, language) })}</> : null}
          {role === "admin" && d.source === "store" ? (
            <button type="button" className="link ml-2" onClick={() => sync.mutate()} disabled={sync.isPending} data-testid="attention-sync">
              {sync.isPending ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />}{t("s29.core.attn.runRules")}
            </button>
          ) : null}
        </span>
      </div>
      <p className="s29-help">{t("s29.core.attn.sub")}</p>
      {d.source === "live" ? <p className="notice" data-testid="attention-live">{t("s29.core.attn.live")}</p> : null}
      {d.truncated ? <p className="notice warn">{t("s29.core.attn.truncated")}</p> : null}
      <div className="s29-attn-kpis">
        <div className="s29-kpi is-urgent" data-testid="attention-kpi-urgent"><b>{d.counts.urgent}</b><span>{t("s29.core.attn.kpi.urgent")}</span></div>
        <div className="s29-kpi"><b>{d.counts.high}</b><span>{t("s29.core.attn.kpi.high")}</span></div>
        <div className="s29-kpi"><b>{d.counts.dueThisWeek}</b><span>{t("s29.core.attn.kpi.week")}</span></div>
        <div className="s29-kpi"><b>{d.counts.closed7d}</b><span>{t("s29.core.attn.kpi.closed")}</span></div>
      </div>
      <div className="s29-filters">
        <label>{t("s29.core.attn.filter.workflow")}
          <select value={workflow} onChange={(e) => setWorkflow(e.target.value as AttentionWorkflow | "all")} data-testid="attention-filter-workflow">
            <option value="all">{t("s29.core.attn.filter.all")}</option>
            {ATTENTION_WORKFLOWS.map((w) => <option key={w} value={w}>{t(`s29.core.attn.wf.${w}` as TranslationKey)}</option>)}
          </select>
        </label>
        <label>{t("s29.core.attn.filter.priority")}
          <select value={priority} onChange={(e) => setPriority(e.target.value as AttentionPriority | "all")} data-testid="attention-filter-priority">
            <option value="all">{t("s29.core.attn.filter.all")}</option>
            {(["urgent", "high", "normal", "low"] as const).map((p) => <option key={p} value={p}>{t(`s29.core.attn.pri.${p}` as TranslationKey)}</option>)}
          </select>
        </label>
        <label>{t("s29.core.attn.sort")}
          <select value={sort} onChange={(e) => setSort(e.target.value as AttentionSort)} data-testid="attention-sort">
            <option value="priority">{t("s29.core.attn.sort.priority")}</option>
            <option value="oldest">{t("s29.core.attn.sort.oldest")}</option>
            <option value="newest">{t("s29.core.attn.sort.newest")}</option>
          </select>
        </label>
        <label><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} data-testid="attention-filter-demo" />{t("s29.core.attn.filter.demo")}</label>
        {d.source === "store" ? <label><input type="checkbox" checked={dismissed} onChange={(e) => setDismissed(e.target.checked)} data-testid="attention-filter-dismissed" />{t("s29.core.attn.filter.dismissed")}</label> : null}
      </div>
      {items.length === 0 ? (
        <div className="occ-empty" data-testid="attention-empty"><CheckCircle2 className="h-6 w-6" style={{ color: "var(--occ-sage)" }} aria-hidden="true" /><p>{(d.items.length ? t("s29.core.attn.emptyFiltered") : t("s29.core.attn.empty"))}</p></div>
      ) : (
        <ul className="s29-items" data-testid="attention-list">{shown.map((i) => <Row key={i.key} item={i} role={role} />)}</ul>
      )}
      {items.length > LIMIT ? <button type="button" className="link" aria-expanded={all} onClick={() => setAll((v) => !v)} data-testid="attention-toggle">{all ? t("s29.core.attn.showLess") : t("s29.core.attn.showAll", { n: items.length })}</button> : null}
      {closed.length ? (
        <details className="s29-closed" data-testid="attention-closed">
          <summary>{t("s29.core.attn.recent")} ({closed.length})</summary>
          <ul>
            {closed.map((i) => (
              <li key={i.key}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                <span>{t(`s29.core.kind.${i.kind}` as TranslationKey)} · {i.studentName ?? t("s29.core.attn.operations")}</span>
                <span className="s29-help">{fmtDate(i.resolvedAt, language)} · {i.resolvedBy === "system" ? t("s29.core.attn.closedBySystem") : t("s29.core.attn.closedBy")}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
