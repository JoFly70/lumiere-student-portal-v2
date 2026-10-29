/**
 * S27 owner Control Center (/admin/support-center, the staff landing). One call (GET /api/admin/control-center)
 * feeds the whole page: headline, five KPI tiles, "Needs you today" queue, next-14-days deadlines, the assistant
 * card, the All students table with flight arcs, Payments and Support windows. Demo students are labelled "Demo".
 */
import React, { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Eye, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useT, type TranslationKey } from "@/i18n";
import type { ControlCenterView, ControlQueueItem, ControlStudentRow } from "@shared/s27-contract";
import { StaffCard, StaffEmpty, StaffNotice, StaffPill, staffBtn, staffTable } from "@/components/staff/staff-ui";
import { useExperienceAction } from "@/components/admin/dossier/dossier-parts";
import { StudentPhoto } from "@/components/admin/directory/directory-data";
import { FlightArc, DateBadge, IconBadge, Orb, TonePill, ownerBtn } from "@/components/admin/control/owner-ui";
import { errorText, isUnavailable, useControlCenter } from "@/lib/s27-queries";
import {
  creditsFraction, daysLeftTone, formatMoneyCompact, filterStudentRows, formatArrival, formatDay, greetingKey, localeOf, programLabelKey, queueActionHref, queueItemMeta,
  sortQueue, supportWindowTone, todayIsoLocal, type StudentFilter, type Tone,
} from "@/lib/owner-presentation";
import { cn } from "@/lib/utils";

const FILTERS: { key: StudentFilter; label: TranslationKey }[] = [
  { key: "all", label: "owner.filter.all" },
  { key: "diploma", label: "owner.filter.diploma" },
  { key: "bachelor", label: "owner.filter.bachelor" },
  { key: "attention", label: "owner.filter.attention" },
];

const TONE_TEXT: Record<Tone, string> = { urgent: "text-st-urgent", attention: "text-st-attention", ok: "text-st-applied", gold: "text-student-gold-ink", neutral: "text-student-muted" };

/** i18n for "3 days" / "1 day" / "2 days overdue". */
function useDaysText() {
  const { t } = useT();
  return (n: number) => (n < 0 ? t("owner.days.overdue", { n: Math.abs(n) }) : n === 0 ? t("owner.days.today") : n === 1 ? t("owner.days.one") : t("owner.days.other", { n }));
}

function Card({ title, aside, children, className, testId, labelId }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string; testId?: string; labelId: string }) {
  return (
    <StaffCard aria-labelledby={labelId} className={className} data-testid={testId}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={labelId} className="font-serif text-xl tracking-tight text-student-ink sm:text-2xl">{title}</h2>
        {aside ? <p className="text-xs text-student-muted">{aside}</p> : null}
      </div>
      {children}
    </StaffCard>
  );
}

// ── headline ────────────────────────────────────────────────────────────────

function Headline({ count, demoCount, total, locale }: { count: number; demoCount: number; total: number; locale: string }) {
  const { t } = useT();
  const now = new Date();
  const hello = t(greetingKey(now.getHours()));
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(now);
  return (
    <header className="space-y-2" data-testid="cc-headline">
      <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-student-gold-ink"><span aria-hidden="true" className="h-px w-6 bg-student-gold" />{t("owner.cc.eyebrow")}</p>
      <h1 className="font-serif text-3xl leading-tight tracking-tight text-student-ink sm:text-4xl lg:text-[2.6rem]" data-testid="text-page-title">
        {count === 0 ? t("owner.cc.nothing", { hello }) : (
          <>
            {hello}{" "}
            <em className="text-student-gold-ink">{t(count === 1 ? "owner.cc.things.one" : "owner.cc.things.other", { n: count })}</em>{" "}
            {t(count === 1 ? "owner.cc.needs.one" : "owner.cc.needs.other")}
          </>
        )}
      </h1>
      <p className="text-sm text-student-muted">
        {date} · {t(total === 1 ? "owner.cc.students.one" : "owner.cc.students.other", { n: total })}
        {demoCount > 0 ? ` · ${t("owner.cc.demoNote", { n: demoCount })}` : ""}
      </p>
    </header>
  );
}

// ── KPI tiles ───────────────────────────────────────────────────────────────

function Kpi({ label, value, hint, featured, testId }: { label: string; value: React.ReactNode; hint: string; featured?: boolean; testId: string }) {
  return (
    <div className={cn("flex min-h-[104px] min-w-0 flex-col justify-between gap-2 rounded-2xl border p-4", featured ? "border-student-gold bg-gradient-to-br from-student-gold-soft to-student-card" : "border-student-line bg-student-card")} data-testid={testId}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-student-muted">{label}</span>
      <span className="font-serif text-3xl leading-none tabular-nums text-student-ink sm:text-4xl">{value}</span>
      <span className="text-xs text-student-muted">{hint}</span>
    </div>
  );
}

// ── queue ───────────────────────────────────────────────────────────────────

function QueueRow({ item, role }: { item: ControlQueueItem; role: string | undefined }) {
  const { t } = useT();
  const [, navigate] = useLocation();
  const meta = queueItemMeta(item);
  const href = queueActionHref(item.href, role);
  return (
    <li className="flex flex-col gap-3 border-t border-student-line py-3.5 first:border-t-0 first:pt-0 sm:flex-row sm:items-center" data-testid="queue-item" data-kind={item.kind} data-severity={item.severity}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <IconBadge icon={meta.icon} tone={meta.tone} />
        <div className="min-w-0">
          <p className="font-medium leading-snug text-student-ink">
            {item.title}
            <span className="sr-only"> ({t(`owner.severity.${item.severity}` as TranslationKey)})</span>
          </p>
          <p className="mt-0.5 break-words text-sm leading-snug text-student-muted">{item.studentName ? `${item.studentName} · ` : ""}{item.detail}</p>
        </div>
      </div>
      <div className="shrink-0 pl-[3.25rem] sm:pl-0">
        <button type="button" className={cn(ownerBtn.seal, "w-full sm:w-auto")} onClick={() => navigate(href)} data-testid="queue-action">
          {t(meta.actionKey)}<ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

// ── table ───────────────────────────────────────────────────────────────────

function ViewAsButton({ studentId, name }: { studentId: string; name: string }) {
  const { t } = useT();
  const action = useExperienceAction(studentId);
  return (
    <div className="flex flex-col items-end">
      <button type="button" onClick={() => void action.run()} disabled={action.pending} className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-student-gold-ink disabled:opacity-60" aria-label={t("owner.row.viewAsNamed", { name })}>
        {action.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}{t("owner.row.viewAs")}
      </button>
      {action.error ? <span role="alert" className="max-w-[12rem] text-right text-xs text-st-urgent">{action.error}</span> : null}
    </div>
  );
}

export function studentOpenHref(row: Pick<ControlStudentRow, "studentId" | "program">, role: string | undefined): string {
  const id = encodeURIComponent(row.studentId);
  if (role === "admin") return `/admin/students/${id}`;
  return row.program === "high_school" ? `/admin/students/${id}/high-school` : `/admin/students/${id}/billing`;
}

function StudentsTable({ rows, role, today, locale }: { rows: readonly ControlStudentRow[]; role: string | undefined; today: string; locale: string }) {
  const { t } = useT();
  const daysText = useDaysText();
  const [filter, setFilter] = useState<StudentFilter>("all");
  const shown = useMemo(() => filterStudentRows(rows, filter), [rows, filter]);
  return (
    <Card title={t("owner.students.title")} labelId="cc-students-h" testId="cc-students" aside={t("owner.students.count", { n: shown.length })}>
      <div role="group" aria-label={t("owner.filter.label")} className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} data-testid={`filter-${f.key}`}
            className={cn("min-h-9 rounded-full border px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink", filter === f.key ? "border-student-seal bg-student-seal text-student-seal-ink" : "border-student-line-strong bg-student-card text-student-ink hover:bg-student-gold-soft")}>
            {t(f.label)}
          </button>
        ))}
      </div>
      {shown.length === 0 ? <p className="py-6 text-center text-sm text-student-muted" data-testid="cc-students-empty">{t("owner.students.empty")}</p> : (
        <div className="relative -mx-4 overflow-x-auto sm:-mx-5" tabIndex={0} role="region" aria-label={t("owner.students.title")}>
          <table className={cn(staffTable.table, "min-w-[70rem]")}>
            <caption className="sr-only">{t("owner.students.title")}</caption>
            <thead>
              <tr className="text-left">
                {(["owner.col.student", "owner.col.journey", "owner.col.credits", "owner.col.arrival", "owner.col.status", "owner.col.next", "owner.col.support"] as TranslationKey[]).map((k) => (
                  <th key={k} scope="col" className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-student-muted first:pl-5">{t(k)}</th>
                ))}
                <th scope="col" className="px-4 py-2 pr-5"><span className="sr-only">{t("owner.col.actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const nameParts = r.name.split(" ");
                const fraction = creditsFraction(r.creditsConfirmed, r.creditsRequired);
                const arrival = formatArrival(r.estimatedFinishOn, today, locale);
                return (
                  <tr key={r.studentId} className="border-t border-student-line align-middle hover:bg-student-gold-soft/30" data-testid="student-row">
                    <td className="px-4 py-3 pl-5">
                      <div className="flex items-center gap-3">
                        <StudentPhoto student={{ first_name: nameParts[0] ?? r.name, last_name: nameParts.slice(1).join(" "), preferred_name: null, email: null, photo_url: null }} size="md" />
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 font-medium text-student-ink"><span className="truncate">{r.name}</span>{r.isDemo ? <StaffPill tone="attention" className="shrink-0 uppercase tracking-wide" testId="demo-pill">{t("owner.demo")}</StaffPill> : null}</p>
                          <p className="text-xs text-student-muted"><span className="font-mono">{r.code ?? "·"}</span> · {t(programLabelKey(r.program))}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><FlightArc fraction={fraction} /></td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums"><span className="font-semibold text-student-ink">{r.creditsConfirmed}</span><span className="text-student-muted"> / {r.creditsRequired ?? "·"}</span></td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <p className="font-semibold tabular-nums text-student-ink">{arrival ?? "·"}</p>
                      <p className="text-xs text-student-muted">{r.paceLabel ?? "·"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <TonePill tone={r.status.tone === "critical" ? "urgent" : r.status.tone === "warning" ? "attention" : r.status.tone === "ok" ? "ok" : r.status.tone === "gold" ? "gold" : "neutral"}>{r.status.label}</TonePill>
                      <p className="mt-1 text-xs text-student-muted">{r.lastActivityOn ? t("owner.row.lastActive", { date: formatDay(r.lastActivityOn, locale) }) : t("owner.row.noActivity")}</p>
                    </td>
                    <td className="px-4 py-3">
                      {r.nextDeadline ? (
                        <>
                          <p className="text-student-ink">{r.nextDeadline.label}</p>
                          <p className="whitespace-nowrap text-xs"><span className="text-student-muted">{formatDay(r.nextDeadline.dueOn, locale)} · </span><span className={cn("font-semibold", TONE_TEXT[daysLeftTone(r.nextDeadline.daysLeft)])}>{daysText(r.nextDeadline.daysLeft)}</span></p>
                        </>
                      ) : <span className="text-student-muted">·</span>}
                    </td>
                    <td className="px-4 py-3 text-student-ink">{r.supportMonthsLeft === null ? <span className="text-xs text-student-muted">{t("owner.row.afterPayment")}</span> : t(r.supportMonthsLeft === 1 ? "owner.months.one" : "owner.months.other", { n: r.supportMonthsLeft })}</td>
                    <td className="px-4 py-3 pr-5">
                      <div className="flex flex-col items-end gap-0.5">
                        <Link href={studentOpenHref(r, role)} className={cn(ownerBtn.outline, "inline-flex items-center justify-center border")} aria-label={t("owner.row.openNamed", { name: r.name })} data-testid="open-file">{t("owner.row.open")}</Link>
                        {role === "admin" ? <ViewAsButton studentId={r.studentId} name={r.name} /> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── side cards ──────────────────────────────────────────────────────────────

const ASSISTANT_CHIPS: TranslationKey[] = ["owner.ai.chip.risk", "owner.ai.chip.review", "owner.ai.chip.finish"];

function AssistantCard() {
  const { t } = useT();
  return (
    <StaffCard aria-labelledby="cc-ai-h" data-testid="cc-assistant">
      <div className="flex items-center gap-3">
        <Orb />
        <div className="min-w-0">
          <h2 id="cc-ai-h" className="font-serif text-xl tracking-tight text-student-ink">{t("owner.ai.title")}</h2>
          <p className="text-xs text-student-muted">{t("owner.ai.sub")}</p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-student-muted">{t("owner.ai.body")}</p>
      <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("owner.ai.chips")}>
        {ASSISTANT_CHIPS.map((k) => (
          <li key={k}>
            <Link href={`/admin/assistant?q=${encodeURIComponent(t(k))}`} className="inline-flex min-h-9 items-center rounded-full border border-student-line-strong bg-student-card px-3 text-sm text-student-ink hover:bg-student-gold-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-student-gold-ink">{t(k)}</Link>
          </li>
        ))}
      </ul>
      <Link href="/admin/assistant" className={cn(ownerBtn.outline, "mt-4 inline-flex items-center border")} data-testid="cc-assistant-open"><Sparkles className="h-4 w-4" aria-hidden="true" />{t("owner.ai.open")}</Link>
    </StaffCard>
  );
}

function PaymentsCard({ data, locale }: { data: ControlCenterView; locale: string }) {
  const { t } = useT();
  const p = data.payments;
  const month = new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date());
  const money = p.currency ? formatMoneyCompact(p.receivedThisMonthCents, p.currency, locale) : String(p.receivedThisMonthCents / 100);
  return (
    <Card title={t("owner.pay.title")} labelId="cc-pay-h" testId="cc-payments" aside={month}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-3">
        <div><dd className="font-serif text-3xl tabular-nums text-student-ink" data-testid="pay-received">{money}</dd><dt className="mt-1 text-xs text-student-muted">{t("owner.pay.received")}</dt></div>
        <div><dd className="font-serif text-3xl tabular-nums text-student-ink" data-testid="pay-signed">{p.signedNotPaid}</dd><dt className="mt-1 text-xs text-student-muted">{t("owner.pay.signed")}</dt></div>
        <div><dd className={cn("font-serif text-3xl tabular-nums", p.overdueInstallments > 0 ? "text-st-urgent" : "text-student-ink")} data-testid="pay-overdue">{p.overdueInstallments}</dd><dt className="mt-1 text-xs text-student-muted">{t("owner.pay.overdue")}</dt></div>
      </dl>
    </Card>
  );
}

function SupportCard({ data }: { data: ControlCenterView }) {
  const { t } = useT();
  const byId = new Map(data.students.map((s) => [s.studentId, s]));
  return (
    <Card title={t("owner.support.title")} labelId="cc-support-h" testId="cc-support" aside={t("owner.support.sub")}>
      {data.supportWindows.length === 0 ? <p className="text-sm text-student-muted">{t("owner.support.empty")}</p> : (
        <ul>
          {[...data.supportWindows].sort((a, b) => a.monthsLeft - b.monthsLeft).map((w) => {
            const row = byId.get(w.studentId);
            const tone = supportWindowTone(w.monthsLeft);
            return (
              <li key={w.studentId} className="flex items-center gap-3 border-t border-student-line py-2.5 first:border-t-0 first:pt-0" data-testid="support-window">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-student-line text-center leading-none"><span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-student-muted">{t("owner.support.left")}</span><span className="font-serif text-lg tabular-nums text-student-ink">{w.monthsLeft}</span></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-student-ink">{w.studentName}</p>
                  {row ? <p className="truncate text-xs text-student-muted">{t(programLabelKey(row.program))} · {t("owner.support.credits", { a: row.creditsConfirmed, b: row.creditsRequired ?? "·" })}</p> : null}
                </div>
                <TonePill tone={tone}>{t(tone === "ok" ? "owner.support.onTime" : "owner.support.ending")}</TonePill>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

export function ControlCenter() {
  const { t, language } = useT();
  const { user } = useAuth();
  const locale = localeOf(language);
  const query = useControlCenter();
  const daysText = useDaysText();
  const today = todayIsoLocal();

  if (query.isLoading) {
    return <div role="status" aria-live="polite" className="space-y-4" data-testid="cc-loading"><span className="sr-only">{t("owner.cc.loading")}</span><div className="h-12 w-2/3 animate-pulse rounded bg-student-line" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[104px] animate-pulse rounded-2xl bg-student-line" />)}</div><div className="h-64 animate-pulse rounded-2xl bg-student-line" /></div>;
  }
  if (query.isError || !query.data) {
    const unavailable = isUnavailable(query.error);
    return (
      <div className="space-y-6">
        <StaffEmpty testId={unavailable ? "cc-unavailable" : "cc-error"} title={unavailable ? t("owner.cc.unavailable.title") : t("owner.cc.error.title")}
          action={<button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => void query.refetch()}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t("owner.retry")}</button>}>
          {unavailable ? t("owner.cc.unavailable.body") : errorText(query.error, t("owner.cc.error.body"))}
        </StaffEmpty>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/students" className={cn(ownerBtn.outline, "border")}>{t("owner.cc.goStudents")}</Link>
          <Link href="/support" className={cn(ownerBtn.outline, "border")}>{t("owner.cc.goSupport")}</Link>
        </div>
      </div>
    );
  }

  const d = query.data;
  const queue = sortQueue(d.queue);
  const demoCount = d.students.filter((s) => s.isDemo).length;
  const monthName = new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date());
  const received = d.payments.currency ? formatMoneyCompact(d.payments.receivedThisMonthCents, d.payments.currency, locale) : "·";

  return (
    <div className="space-y-6" data-testid="control-center">
      <Headline count={d.counts.needsYou} demoCount={demoCount} total={d.students.length} locale={locale} />

      <section aria-label={t("owner.kpi.label")} className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi featured testId="kpi-needs" label={t("owner.kpi.needs")} value={d.counts.needsYou} hint={t("owner.kpi.needsHint")} />
        <Kpi testId="kpi-flying" label={t("owner.kpi.flying")} value={d.counts.flying} hint={t("owner.kpi.flyingHint")} />
        <Kpi testId="kpi-deadlines" label={t("owner.kpi.deadlines")} value={d.counts.deadlines14d} hint={t("owner.kpi.deadlinesHint")} />
        <Kpi testId="kpi-payments" label={t("owner.kpi.payments")} value={received} hint={t("owner.kpi.paymentsHint", { month: monthName })} />
        <Kpi testId="kpi-pre" label={t("owner.kpi.pre")} value={d.counts.preEnrollment} hint={t("owner.kpi.preHint")} />
      </section>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] lg:items-start">
        <Card title={t("owner.queue.title")} labelId="cc-queue-h" testId="cc-queue" aside={t("owner.queue.open", { n: queue.length })}>
          {queue.length === 0 ? <p className="py-4 text-sm text-student-muted" data-testid="queue-empty">{t("owner.queue.empty")}</p> : (
            <ul>{queue.map((item) => <QueueRow key={item.id} item={item} role={user?.role} />)}</ul>
          )}
          {user?.role === "admin" ? <p className="mt-4 border-t border-student-line pt-3 text-sm"><Link href="/admin/elective-requests" className="font-medium text-student-gold-ink underline underline-offset-4">{t("owner.queue.electives")}</Link></p> : null}
        </Card>
        <div className="space-y-6">
          <Card title={t("owner.next.title")} labelId="cc-next-h" testId="cc-deadlines" aside={t("owner.next.sub")}>
            {d.deadlines.length === 0 ? <p className="text-sm text-student-muted">{t("owner.next.empty")}</p> : (
              <ul>
                {d.deadlines.map((x, i) => (
                  <li key={`${x.studentId}-${x.label}-${i}`} className="flex items-center gap-3 border-t border-student-line py-2.5 first:border-t-0 first:pt-0" data-testid="deadline-item">
                    <DateBadge iso={x.dueOn} locale={locale} />
                    <div className="min-w-0 flex-1"><p className="truncate font-medium text-student-ink">{x.label}</p><p className="truncate text-xs text-student-muted">{x.studentName}</p></div>
                    <TonePill tone={daysLeftTone(x.daysLeft)} dot={false} className="font-semibold">{daysText(x.daysLeft)}</TonePill>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {user?.role === "admin" ? <AssistantCard /> : null}
        </div>
      </div>

      <StudentsTable rows={d.students} role={user?.role} today={today} locale={locale} />

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <PaymentsCard data={d} locale={locale} />
        <SupportCard data={d} />
      </div>
      {demoCount > 0 ? <StaffNotice tone="attention" testId="cc-demo-note">{t("owner.cc.demoFooter")}</StaffNotice> : null}
    </div>
  );
}
