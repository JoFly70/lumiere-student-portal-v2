/**
 * S29 Staff Notification Center (/admin/notifications; admin + staff). Delivery overview, outbox history with retry
 * (admin), and the Proactive Concierge settings (admin). "Accepted" means the email provider accepted the message,
 * never "delivered". When email is not configured the page says so; it never shows fake success.
 */
import React, { useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Loader2, Mail, RotateCw, X } from "lucide-react";
import { useT } from "@/i18n";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { EmailState, OutboxRowView } from "@shared/s29-contract";
import { useOutbox, useOutboxRetry } from "@/lib/s29-ops-queries";
import {
  EMAIL_OVERVIEW_ORDER, canRetry, emailPresentation, formatDateTime, formatRelativeAge, isEmailState, opsKeyOrNull, shortError, suppressedReasonKey, humanize,
  type OpsKey,
} from "@/lib/s29-ops-presentation";
import { ConciergeSettingsCard } from "./concierge-settings";
import { LoadingBlock, OpsGlyph, PageHead, QueryProblem, RefreshButton, Section, StateChip, useNow } from "./ops-ui";

function Overview({ counts, emailConfigured, scheduler, active, onPick }: {
  counts: Partial<Record<EmailState, number>>; emailConfigured: boolean; scheduler: { lastTickAt: string | null; lastDeliverySuccessAt: string | null };
  active: EmailState | "all"; onPick: (s: EmailState | "all") => void;
}) {
  const { t, language } = useT();
  const now = useNow();
  const stamp = (iso: string | null, none: OpsKey) => {
    const abs = formatDateTime(iso, language);
    return abs ? <>{abs}<span className="ops-note"> · {formatRelativeAge(iso, now, language)}</span></> : <span className="ops-note">{t(none)}</span>;
  };
  return (
    <Section id="outbox-overview" testId="outbox-overview" title={t("s29.ops.n.overview")} sub={t("s29.ops.n.overview.hint")}>
      {!emailConfigured ? (
        <div className="ops-banner" role="status" data-testid="outbox-not-configured">
          <Mail aria-hidden="true" />
          <b>{t("s29.ops.n.notConfigured.title")}</b>
          <p>{t("s29.ops.n.notConfigured.body")}</p>
        </div>
      ) : null}
      <div className="ops-states">
        {EMAIL_OVERVIEW_ORDER.map((s) => {
          const p = emailPresentation(s);
          const n = counts[s] ?? 0;
          return (
            <button key={s} type="button" className="ops-state" data-tone={p.tone} data-zero={n === 0} aria-pressed={active === s} data-testid={`outbox-count-${s}`}
              onClick={() => onPick(active === s ? "all" : s)}>
              <StateChip tone={p.tone} icon={p.icon} label={t(p.labelKey)} />
              <b>{n}</b>
              <span className="def">{t(p.defKey)}</span>
            </button>
          );
        })}
      </div>
      <div className="ops-sched" data-testid="outbox-scheduler">
        <div><span className="ops-lbl">{t("s29.ops.n.lastTick")}</span><span>{stamp(scheduler.lastTickAt, "s29.ops.n.noTick")}</span></div>
        <div><span className="ops-lbl">{t("s29.ops.n.lastDelivery")}</span><span>{stamp(scheduler.lastDeliverySuccessAt, "s29.ops.n.noDelivery")}</span></div>
      </div>
    </Section>
  );
}

function RowFeedback({ kind }: { kind: "ok" | "no" | "err" }) {
  const { t } = useT();
  return <span className={cn("ops-fb", kind !== "ok" && "err")} role="status">{t(kind === "ok" ? "s29.ops.n.retried" : kind === "no" ? "s29.ops.n.notRetried" : "s29.ops.n.retryFailed")}</span>;
}

export function NotificationsCenter() {
  const { t, language } = useT();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const now = useNow();
  const search = useSearch();
  const [location, setLocation] = useLocation();
  const studentId = useMemo(() => new URLSearchParams(search).get("student")?.trim() || null, [search]);
  const [state, setState] = useState<EmailState | "all">("all");
  const q = useOutbox(state, studentId);
  const retry = useOutboxRetry();
  const [fb, setFb] = useState<Record<string, "ok" | "no" | "err">>({});

  const doRetry = (id: string) => retry.mutate(id, {
    onSuccess: (r) => setFb((m) => ({ ...m, [id]: r.retried ? "ok" : "no" })),
    onError: () => setFb((m) => ({ ...m, [id]: "err" })),
  });
  const absolute = (iso: string | null) => formatDateTime(iso, language);
  const age = (iso: string | null) => formatRelativeAge(iso, now, language);
  const pendingId = retry.isPending ? retry.variables : null;

  const head = <PageHead eyebrow={t("s29.ops.n.eyebrow")} title={t("s29.ops.n.title")} sub={t("s29.ops.n.sub")} testId="outbox-head"
    actions={<RefreshButton onClick={() => void q.refetch()} busy={q.isFetching} />} />;

  if (q.isLoading) return <LoadingBlock testId="outbox-loading" />;
  if (q.isError || !q.data) return <div className="s27 occ" data-testid="outbox-root">{head}<QueryProblem error={q.error} onRetry={() => void q.refetch()} testId="outbox" /></div>;
  const d = q.data;

  return (
    <div className="s27 occ" data-testid="outbox-root">
      {head}
      <Overview counts={d.counts} emailConfigured={d.emailConfigured} scheduler={d.scheduler} active={state} onPick={setState} />

      <Section id="outbox-history" testId="outbox-history" title={t("s29.ops.n.history")}>
        <div className="ops-filters">
          <label className="ops-field"><span>{t("s29.ops.n.filter.state")}</span>
            <select value={state} onChange={(e) => setState(isEmailState(e.target.value) ? e.target.value : "all")} data-testid="outbox-filter-state">
              <option value="all">{t("s29.ops.n.filter.all")}</option>
              {EMAIL_OVERVIEW_ORDER.map((s) => <option key={s} value={s}>{t(emailPresentation(s).labelKey)}</option>)}
            </select>
          </label>
          {studentId ? (
            <div className="ops-field">
              <span>{t("s29.ops.n.filter.student")}</span>
              <button type="button" className="b2 ops-btn" data-testid="outbox-filter-student" onClick={() => setLocation(location)}>
                <X aria-hidden="true" />{t("s29.ops.n.filter.clear")}
              </button>
            </div>
          ) : null}
        </div>
        {studentId ? <p className="ops-note" data-testid="outbox-student-active">{t("s29.ops.n.filter.studentActive")}</p> : null}

        {d.rows.length === 0 ? <p className="ops-empty" data-testid="outbox-empty">{t("s29.ops.n.empty")}</p> : (
          <div className="ops-tablewrap">
            <table className="ops-table">
              <colgroup><col style={{ width: "11%" }} /><col style={{ width: "12%" }} /><col style={{ width: "16%" }} /><col style={{ width: "16%" }} /><col style={{ width: "10%" }} /><col /><col style={{ width: "8%" }} />{isAdmin ? <col style={{ width: "148px" }} /> : null}</colgroup>
              <thead><tr>
                <th>{t("s29.ops.n.col.created")}</th><th>{t("s29.ops.n.col.student")}</th><th>{t("s29.ops.n.col.category")}</th><th>{t("s29.ops.n.col.email")}</th>
                <th>{t("s29.ops.n.col.attempts")}</th><th>{t("s29.ops.n.col.error")}</th><th>{t("s29.ops.n.col.read")}</th>{isAdmin ? <th>{t("s29.ops.n.col.actions")}</th> : null}
              </tr></thead>
              <tbody>
                {d.rows.map((r: OutboxRowView) => {
                  const p = emailPresentation(r.emailState);
                  const reason = suppressedReasonKey(r.suppressedReason);
                  const catKey = opsKeyOrNull("s29.ops.cat.", r.category);
                  const err = shortError(r.lastError);
                  const showRetry = canRetry(r, isAdmin);
                  return (
                    <tr key={r.id} data-testid="outbox-row" data-state={r.emailState} data-demo={r.isDemo}>
                      <td data-label={t("s29.ops.n.col.created")}><div className="ops-stack"><span className="ops-strong">{absolute(r.createdAt)}</span><span className="ops-note">{age(r.createdAt)}</span></div></td>
                      <td data-label={t("s29.ops.n.col.student")}>
                        <div className="ops-stack">
                          {r.studentId ? (
                            isAdmin ? <Link href={`/admin/students/${encodeURIComponent(r.studentId)}`} className="link ops-strong">{r.studentName ?? "—"}</Link>
                              : <span className="ops-strong">{r.studentName ?? "—"}</span>
                          ) : <span className="ops-strong">{t("s29.ops.n.staffAudience")}</span>}
                          {r.isDemo ? <span className="occ-demo ops-demo" data-testid="outbox-demo">{t("s29.ops.demo")}</span> : null}
                        </div>
                      </td>
                      <td data-label={t("s29.ops.n.col.category")}><div className="ops-stack">
                        <span className="ops-strong">{catKey ? t(catKey) : humanize(r.category)}</span>
                        <span className="ops-note ops-mono">{r.template}</span>
                        <span className="ops-note">{t("s29.ops.n.col.source")}{language === "fr" ? "\u00A0: " : ": "}{r.source}</span>
                      </div></td>
                      <td data-label={t("s29.ops.n.col.email")}><div className="ops-stack">
                        <StateChip tone={p.tone} icon={p.icon} label={t(p.labelKey)} title={t(p.defKey)} testId="outbox-email-state" />
                        {r.emailState === "suppressed" && r.suppressedReason ? <span className="ops-note" data-testid="outbox-suppressed">{reason ? t(r.audience === "staff" && reason === "s29.ops.suppressed.preference_off" ? "s29.ops.suppressed.preference_off_staff" : reason) : t("s29.ops.suppressed.other", { reason: r.suppressedReason })}</span> : null}
                        {r.emailState === "accepted" && r.sentAt ? <span className="ops-note">{t("s29.ops.n.sentAt", { when: age(r.sentAt) ?? "" })}</span> : null}
                      </div></td>
                      <td data-label={t("s29.ops.n.col.attempts")}><div className="ops-stack">
                        <span className="ops-strong">{r.attempts}</span>
                        {r.nextAttemptAt ? <span className="ops-note">{t("s29.ops.n.col.next")}{language === "fr" ? "\u00A0: " : ": "}{absolute(r.nextAttemptAt)}</span> : null}
                      </div></td>
                      <td className="full" data-label={t("s29.ops.n.col.error")}>{err ? <span title={r.lastError ?? undefined}>{err}</span> : <span className="ops-note">—</span>}</td>
                      <td data-label={t("s29.ops.n.col.read")}>
                        <span className="ops-note" style={{ display: "inline-flex", gap: 5, alignItems: "center", whiteSpace: "nowrap" }}>
                          <OpsGlyph icon={r.readAt ? "check" : "clock"} />{r.readAt ? t("s29.ops.n.read") : t("s29.ops.n.unread")}
                        </span>
                      </td>
                      {isAdmin ? (
                        <td className="acts" data-label={t("s29.ops.n.col.actions")}>
                          {showRetry ? (
                            <div className="ops-acts">
                              <button type="button" className="b2 ops-btn" disabled={pendingId === r.id} onClick={() => doRetry(r.id)} data-testid="outbox-retry">
                                {pendingId === r.id ? <Loader2 className="ops-spin" aria-hidden="true" /> : <RotateCw aria-hidden="true" />}
                                {pendingId === r.id ? t("s29.ops.n.retrying") : t("s29.ops.n.retry")}
                              </button>
                              {fb[r.id] ? <RowFeedback kind={fb[r.id]!} /> : null}
                            </div>
                          ) : fb[r.id] === "ok" ? <RowFeedback kind="ok" /> : <span className="ops-note">—</span>}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {isAdmin ? <ConciergeSettingsCard /> : null}
    </div>
  );
}
