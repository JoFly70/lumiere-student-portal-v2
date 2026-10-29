/**
 * Student file, Overview tab (S27): journey arc with phase stops, four facts, "Needs a decision", Lumière summary,
 * Lumière checkpoints (mark done / plan a date) and the agreement card with its editor.
 */
import React, { useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Check, Loader2, Pencil, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { formatHalfUnits, type StaffHighSchoolState } from "@shared/high-school-contract";
import { formatMoney, type StaffBillingView } from "@shared/billing-contract";
import type { AgreementDeadlineView, CheckpointView, ProgramAgreementView, StudentJourneyView } from "@shared/s27-contract";
import { StaffNotice, staffBtn, staffField } from "@/components/staff/staff-ui";
import { OwnerAnswerView, type OwnerAnswer } from "@/components/owner-assistant/owner-assistant-panel";
import { useT } from "@/i18n";
import { addDaysIso, creditsFraction, daysLeftTone, formatArrival, formatDay, localeOf, todayIsoLocal, type FileTab, type ProgramKind } from "@/lib/owner-presentation";
import { buildDecisions, type Decision } from "@/lib/file-decisions";
import { summarizeBilling } from "@/components/admin/billing/billing-summary";
import { errorText, useCheckpointAction } from "@/lib/s27-queries";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FlightArc } from "@/components/admin/control/owner-ui";
import { AgreementDialog } from "./agreement-dialog";
import { KeyValue, Panel, Unavailable } from "./file-parts";
import type { Query } from "./types";

export interface OverviewProps {
  studentId: string;
  studentLabel: string;
  kind: ProgramKind;
  isAdmin: boolean;
  hs?: StaffHighSchoolState | null;
  degreeCreditsConfirmed?: number | null;
  documentsPending: number;
  billing?: StaffBillingView | null;
  journey: Query<StudentJourneyView>;
  agreement: Query<ProgramAgreementView | null>;
  go: (tab: FileTab, extra?: Record<string, string>) => void;
}

// ── journey ─────────────────────────────────────────────────────────────────

function JourneyCard({ p, journey }: { p: OverviewProps; journey?: StudentJourneyView }) {
  const { t, language } = useT();
  const locale = localeOf(language);
  const today = todayIsoLocal();
  const cur = p.hs?.current;
  const earned = cur ? cur.credits.earnedHalfUnits / 2 : p.degreeCreditsConfirmed ?? 0;
  const required = cur ? cur.credits.requiredHalfUnits / 2 : null;
  const fraction = creditsFraction(earned, required);
  const milestones = cur?.published?.content.pacing.milestones ?? [];
  const stops = required
    ? milestones.map((m) => ({ at: m.cumulativeHalfUnits / 2 / required, label: formatDay(`${m.month}-01`, locale, { month: "short" }) })).filter((s) => s.at > 0 && s.at < 1).slice(0, 4)
    : [];
  const pace = journey?.pace;
  const arrival = formatArrival(pace?.estimatedFinishOn ?? cur?.enrollment.targetCompletionDate ?? null, today, locale);
  const supportLeft = journey?.agreement?.supportMonthsLeft ?? p.agreement.data?.supportMonthsLeft ?? null;
  const fmt = (n: number) => String(Math.round(n * 10) / 10).replace(".", language === "fr" ? "," : ".");
  const facts: { value: string; label: string; testId: string }[] = [
    { value: required ? `${fmt(earned)} / ${fmt(required)}` : fmt(earned), label: t("owner.fact.credits"), testId: "fact-credits" },
    { value: pace?.creditsPerWeek != null ? `${fmt(pace.creditsPerWeek)} ${t("owner.fact.perWeek")}` : "·", label: t("owner.fact.pace"), testId: "fact-pace" },
    { value: arrival ?? "·", label: pace?.estimatedFinishOn ? t("owner.fact.arrival") : t("owner.fact.target"), testId: "fact-arrival" },
    { value: supportLeft === null ? "·" : t(supportLeft === 1 ? "owner.months.short.one" : "owner.months.short.other", { n: supportLeft }), label: t("owner.fact.support"), testId: "fact-support" },
  ];
  return (
    <Panel id="ov-journey" title={t("owner.journey.title")} aside={required ? t("owner.journey.confirmed", { a: fmt(earned), b: fmt(required) }) : undefined} testId="ov-journey">
      <div className="px-1 pt-6">
        <FlightArc large width={560} height={130} fraction={fraction} stops={stops} title={t("owner.journey.alt", { pct: Math.round(fraction * 100) })} />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-y-4 border-t border-student-line pt-4 sm:grid-cols-4">
        {facts.map((f, i) => (
          <div key={f.testId} className={cn("min-w-0 px-0 sm:px-4", i > 0 && "sm:border-l sm:border-student-line", i === 0 && "sm:pl-0")} data-testid={f.testId}>
            <dd className="font-serif text-2xl tabular-nums text-student-ink">{f.value}</dd>
            <dt className="text-xs text-student-muted">{f.label}</dt>
          </div>
        ))}
      </dl>
      {pace?.stale ? <p className="mt-3 text-xs text-st-attention">{t("owner.journey.stale")}</p> : null}
    </Panel>
  );
}

// ── decisions ───────────────────────────────────────────────────────────────

function DecisionsCard({ p, decisions }: { p: OverviewProps; decisions: Decision[] }) {
  const { t } = useT();
  return (
    <Panel id="ov-decisions" title={t("owner.dec.title")} testId="ov-decisions">
      {decisions.length === 0 ? <p className="rounded-xl border border-student-line bg-student-gold-soft/40 px-4 py-3 text-sm text-student-muted" data-testid="decisions-empty">{t("owner.dec.none")}</p> : (
        <ul className="space-y-3">
          {decisions.map((d) => (
            <li key={d.id} className={cn("flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between", d.tone === "urgent" ? "border-st-urgent/50 bg-st-urgent-soft" : "border-student-gold bg-student-gold-soft/60")} data-testid="decision-item" data-kind={d.kind}>
              <p className="min-w-0 text-sm leading-snug text-student-ink">{t(d.key, d.vars)}</p>
              <button type="button" className={cn(d.kind === "school_result" ? staffBtn.seal : cn(staffBtn.outline, "border"), "shrink-0")} onClick={() => p.go(d.tab, d.courseKey ? { record: d.courseKey } : undefined)}>
                {d.kind === "school_result" ? t("owner.dec.act.record") : t("owner.dec.act.review")}<ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── Lumière summary (on demand; owner assistant is per student) ─────────────

function SummaryCard({ studentId, studentLabel, isAdmin }: { studentId: string; studentLabel: string; isAdmin: boolean }) {
  const { t, language } = useT();
  const base = `/api/admin/students/${encodeURIComponent(studentId)}/owner-assistant`;
  const ask = useMutation<OwnerAnswer, Error, void>({
    mutationFn: () => api.post<OwnerAnswer>(base, { question: t("owner.sum.question", { name: studentLabel }), language, task: "answer" }),
  });
  return (
    <Panel id="ov-summary" title={t("owner.sum.title")} aside={t("owner.sum.aside")} testId="ov-summary">
      {ask.data ? <OwnerAnswerView answer={ask.data} /> : (
        <p className="text-sm leading-relaxed text-student-muted">{isAdmin ? t("owner.sum.hint") : t("owner.sum.adminOnly")}</p>
      )}
      {ask.isError ? <StaffNotice tone="urgent" role="alert" className="mt-3">{errorText(ask.error, t("owner.sum.error"))}</StaffNotice> : null}
      {isAdmin ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={cn(staffBtn.outline, "border")} disabled={ask.isPending} onClick={() => ask.mutate()} data-testid="summary-generate">
            {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}{ask.data ? t("owner.sum.again") : t("owner.sum.generate")}
          </button>
          <Link href={`/admin/assistant?studentId=${encodeURIComponent(studentId)}`} className="text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline">{t("owner.sum.openAi")}</Link>
        </div>
      ) : null}
    </Panel>
  );
}

// ── checkpoints ─────────────────────────────────────────────────────────────

function CheckpointRow({ c, studentId, canEdit }: { c: CheckpointView; studentId: string; canEdit: boolean }) {
  const { t, language } = useT();
  const locale = localeOf(language);
  const { toast } = useToast();
  const act = useCheckpointAction(studentId);
  const [planning, setPlanning] = useState(false);
  const [date, setDate] = useState(c.plannedOn ?? "");
  const done = c.status === "done";
  const run = (v: Parameters<typeof act.mutate>[0], msg: string) => act.mutate(v, { onSuccess: () => { toast({ title: msg }); setPlanning(false); }, onError: (e) => toast({ title: t("owner.cp.failed"), description: errorText(e, ""), variant: "destructive" }) });
  return (
    <li className="border-t border-student-line py-2.5 first:border-t-0 first:pt-0" data-testid="checkpoint" data-status={c.status}>
      <div className="flex items-center gap-3 text-sm">
        <span aria-hidden="true" className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border-2", done ? "border-st-applied bg-st-applied text-student-card" : c.status === "next" ? "border-student-gold" : "border-student-line-strong")}>{done ? <Check className="h-3.5 w-3.5" /> : null}</span>
        <span className="min-w-0 flex-1 text-student-ink">{c.label}<span className="sr-only"> ({t(`owner.cp.${c.status}`)})</span></span>
        <span className="flex shrink-0 items-center gap-2 text-student-muted">
          {c.status === "next" && canEdit ? (
            <>
              <button type="button" className="min-h-8 rounded px-1.5 font-semibold text-student-gold-ink underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-student-gold-ink" onClick={() => run({ key: c.key, action: "complete" }, t("owner.cp.marked", { label: c.label }))} disabled={act.isPending} data-testid="checkpoint-done">{t("owner.cp.markDone")}</button>
              <button type="button" className="min-h-8 rounded px-1.5 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-student-gold-ink" onClick={() => setPlanning((v) => !v)} aria-expanded={planning}>{c.plannedOn ? formatDay(c.plannedOn, locale, { weekday: "short", day: "numeric", month: "short" }) : t("owner.cp.plan")}</button>
            </>
          ) : done ? <span>{c.doneOn ? formatDay(c.doneOn, locale) : ""}</span> : <span>{c.plannedOn ? formatDay(c.plannedOn, locale) : "·"}</span>}
        </span>
      </div>
      {planning ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-9">
          <label className="sr-only" htmlFor={`cp-${c.key}`}>{t("owner.cp.planFor", { label: c.label })}</label>
          <input id={`cp-${c.key}`} type="date" className={cn(staffField, "w-44")} value={date} onChange={(e) => setDate(e.target.value)} />
          <button type="button" className={staffBtn.seal} disabled={!date || act.isPending} onClick={() => run({ key: c.key, action: "plan", plannedOn: date }, t("owner.cp.planned"))}>{t("owner.save")}</button>
        </div>
      ) : null}
    </li>
  );
}

function CheckpointsCard({ p }: { p: OverviewProps }) {
  const { t } = useT();
  const j = p.journey;
  return (
    <Panel id="ov-checkpoints" title={t("owner.cp.title")} aside={t("owner.cp.aside")} testId="ov-checkpoints">
      {j.isLoading ? <p role="status" className="text-sm text-student-muted">{t("owner.loading")}</p>
        : j.isError || !j.data ? <Unavailable error={j.error} what={t("owner.cp.what")} onRetry={() => void j.refetch()} testId="checkpoints-unavailable" />
        : j.data.checkpoints.length === 0 ? <p className="text-sm text-student-muted">{t("owner.cp.empty")}</p>
        : <ol>{j.data.checkpoints.map((c) => <CheckpointRow key={c.key} c={c} studentId={p.studentId} canEdit={p.isAdmin} />)}</ol>}
    </Panel>
  );
}

// ── agreement ───────────────────────────────────────────────────────────────

function deadlineValue(d: AgreementDeadlineView, locale: string, t: ReturnType<typeof useT>["t"]) {
  if (d.status === "done") return { text: [t("owner.agr.status.done"), d.detail].filter(Boolean).join(" · "), tone: "ok" as const };
  if (d.status === "waived") return { text: t("owner.agr.status.waived"), tone: undefined };
  if (!d.dueOn) return { text: t("owner.agr.notStarted"), tone: undefined };
  const tone = d.daysLeft !== null ? daysLeftTone(d.daysLeft) : "neutral";
  return { text: t("owner.agr.due", { date: formatDay(d.dueOn, locale) }), tone: tone === "urgent" ? ("urgent" as const) : tone === "attention" ? ("attention" as const) : undefined };
}

function AgreementCard({ p }: { p: OverviewProps }) {
  const { t, language } = useT();
  const locale = localeOf(language);
  const [editing, setEditing] = useState(false);
  const a = p.agreement;
  const ag = a.data ?? null;
  const bill = summarizeBilling(p.billing);
  const money = (c: number) => (bill.currency ? formatMoney(c, bill.currency, locale) : String(c / 100));
  const date = (iso: string | null) => (iso ? formatDay(iso, locale, { day: "numeric", month: "short", year: "numeric" }) : "·");
  return (
    <>
      <Panel id="ov-agreement" title={t("owner.agr.card")} aside={t("owner.agr.staffView")} testId="ov-agreement"
        actions={p.isAdmin && !a.isError ? <button type="button" className={cn(staffBtn.outline, "border")} onClick={() => setEditing(true)} disabled={a.isLoading} data-testid="agreement-edit"><Pencil className="h-4 w-4" aria-hidden="true" />{t("owner.agr.edit")}</button> : undefined}>
        {a.isLoading ? <p role="status" className="text-sm text-student-muted">{t("owner.loading")}</p>
          : a.isError ? <Unavailable error={a.error} what={t("owner.agr.what")} onRetry={() => void a.refetch()} testId="agreement-unavailable" />
          : (
            <dl>
              <KeyValue label={t("owner.agr.signed")}>{date(ag?.signedOn ?? null)}</KeyValue>
              <KeyValue label={t("owner.agr.payment")}>{bill.configured ? (bill.status === "paid" ? t("owner.agr.paidFull") : `${money(bill.paidCents)} / ${money(bill.netCents)}`) : t("owner.agr.noFee")}</KeyValue>
              <KeyValue label={t("owner.agr.activated")}>{date(ag?.activatedOn ?? null)}</KeyValue>
              <KeyValue label={t("owner.agr.supportUntil")}>{date(ag?.supportEndsOn ?? null)}</KeyValue>
              <KeyValue label={t("owner.agr.accessUntil")}>{ag?.accessEndsOn ? formatDay(ag.accessEndsOn, locale, { month: "short", year: "numeric" }) : "·"}</KeyValue>
              {(ag?.deadlines ?? []).map((d) => {
                const v = deadlineValue(d, locale, t);
                return <KeyValue key={d.key} label={`${d.label} (${d.rule})`} tone={v.tone} testId={`deadline-${d.key}`}>{v.text}</KeyValue>;
              })}
              <KeyValue label={t("owner.agr.sessionsUsed")}>{t("owner.agr.sessionsOf", { a: ag?.orientationSessionsUsed ?? 0, b: ag?.orientationSessionsIncluded ?? 0 })}</KeyValue>
              {ag?.goal ? (
                <div className="border-t border-student-line pt-3 text-sm" data-testid="agreement-goal">
                  <p className="font-medium text-student-ink">{t("owner.agr.goalLine", { field: ag.goal.field, region: ag.goal.region })}</p>
                  {ag.goal.targets.length ? <p className="text-student-muted">{ag.goal.targets.map((x) => `${x.name} (${x.city})`).join(" · ")}</p> : null}
                </div>
              ) : null}
            </dl>
          )}
      </Panel>
      {p.isAdmin ? <AgreementDialog open={editing} onOpenChange={setEditing} studentId={p.studentId} agreement={ag} /> : null}
    </>
  );
}

export function OverviewTab(p: OverviewProps) {
  const decisions = buildDecisions({
    hs: p.hs, documentsPending: p.documentsPending, billing: p.billing, sessions: p.journey.data?.sessions, deadlines: p.agreement.data?.deadlines ?? p.journey.data?.agreement?.deadlines,
  });
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start" data-testid="tab-overview-body">
      <div className="min-w-0 space-y-6">
        <JourneyCard p={p} journey={p.journey.data} />
        <DecisionsCard p={p} decisions={decisions} />
        <SummaryCard studentId={p.studentId} studentLabel={p.studentLabel} isAdmin={p.isAdmin} />
      </div>
      <div className="min-w-0 space-y-6">
        <CheckpointsCard p={p} />
        <AgreementCard p={p} />
      </div>
    </div>
  );
}

export { formatHalfUnits };
