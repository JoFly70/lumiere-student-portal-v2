/**
 * S27/S28 owner Control Center (/admin/support-center, the staff landing; /staff/control-center for staff).
 * One call (GET /api/admin/control-center) feeds the whole page, laid out as the owner's cockpit in the visual
 * language of the student Flight Deck (styles/student-s27.css scope + styles/owner-cockpit.css):
 * greeting, four countdown-ring widgets, the radar chips, the "All flights" fleet instrument, the "Needs you" queue,
 * the next 14 days, payments, Ask Lumière (admin), the All students roster (mini flight arcs; cards on narrow
 * screens) and the support windows. Demo students are always labelled "Demo" and never counted in the real numbers.
 */
import React, { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Eye, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useT, type TranslationKey } from "@/i18n";
import type { ControlCenterView, ControlQueueItem, ControlStudentRow } from "@shared/s27-contract";
import { StaffEmpty } from "@/components/staff/staff-ui";
import { useExperienceAction } from "@/components/admin/dossier/dossier-parts";
import { StudentPhoto } from "@/components/admin/directory/directory-data";
import { FlightArc, IconBadge, ownerBtn } from "@/components/admin/control/owner-ui";
import { FleetInstrument } from "@/components/admin/control/fleet-instrument";
import { Ring } from "@/components/s27/ui";
import { LumiereOrb } from "@/components/s27/lumiere-orb";
import { errorText, isUnavailable, useControlCenter } from "@/lib/s27-queries";
import {
  creditsFraction, daysLeftTone, formatMoneyCompact, filterStudentRows, formatArrival, formatDay, greetingKey, isoParts, localeOf, monthProgress, plausibleArrival,
  programLabelKey, queueActionHref, queueItemMeta, queueSeverityCounts, sortQueue, supportWindowTone, todayIsoLocal, type StudentFilter, type Tone,
} from "@/lib/owner-presentation";
import { cn } from "@/lib/utils";
import "@/styles/student-s27.css";
import "@/styles/student-s27-extra.css";
import "@/styles/owner-cockpit.css";

const FILTERS: { key: StudentFilter; label: TranslationKey }[] = [
  { key: "all", label: "owner.filter.all" },
  { key: "diploma", label: "owner.filter.diploma" },
  { key: "bachelor", label: "owner.filter.bachelor" },
  { key: "attention", label: "owner.filter.attention" },
];

/** Owner tones -> the student cockpit's pill classes and colours. */
const PILL: Record<Tone, string> = { urgent: "crit", attention: "warn", ok: "ok", gold: "wait", neutral: "plan" };
const COLOR: Record<Tone, string> = { urgent: "var(--t-red)", attention: "var(--t-amber)", ok: "var(--t-green)", gold: "var(--t-accent)", neutral: "var(--t-line-3)" };
const statusTone = (tone: ControlStudentRow["status"]["tone"]): Tone => (tone === "critical" ? "urgent" : tone === "warning" ? "attention" : tone === "ok" ? "ok" : tone === "gold" ? "gold" : "neutral");
const LIST_LIMIT = 6;
const DASH = "—";

function Pill({ tone, children, testId }: { tone: Tone; children: React.ReactNode; testId?: string }) {
  return <span className={cn("pill", PILL[tone])} data-tone={tone} data-testid={testId}><i aria-hidden="true" />{children}</span>;
}

/** i18n for "3 days" / "1 day" / "2 days overdue". */
function useDaysText() {
  const { t } = useT();
  return (n: number) => (n < 0 ? t("owner.days.overdue", { n: Math.abs(n) }) : n === 0 ? t("owner.days.today") : n === 1 ? t("owner.days.one") : t("owner.days.other", { n }));
}

function Card({ title, aside, children, className, testId, labelId, eyebrow }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string; testId?: string; labelId: string; eyebrow?: string }) {
  return (
    <section className={cn("card", className)} aria-labelledby={labelId} data-testid={testId} id={labelId.replace(/-h$/, "")}>
      <div className="ch">
        <div className="min-w-0">
          {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
          <h2 id={labelId}>{title}</h2>
        </div>
        {aside ? <span className="small">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

// ── headline ────────────────────────────────────────────────────────────────

function Headline({ count, demoCount, total, locale }: { count: number; demoCount: number; total: number; locale: string }) {
  const { t } = useT();
  const now = new Date();
  const hello = t(greetingKey(now.getHours()));
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(now);
  return (
    <header className="deck-head" data-testid="cc-headline">
      <div className="min-w-0">
        <span className="eyebrow">{t("owner.cc.eyebrow")}</span>
        <h1 data-testid="text-page-title">
          {count === 0 ? t("owner.cc.nothing", { hello }) : (
            <>
              {hello}{" "}
              <em>{t(count === 1 ? "owner.cc.things.one" : "owner.cc.things.other", { n: count })}</em>{" "}
              {t(count === 1 ? "owner.cc.needs.one" : "owner.cc.needs.other")}
            </>
          )}
        </h1>
      </div>
      <div className="status">
        <span className="pill"><i aria-hidden="true" />{date}</span>
        <span className="pill ok"><i aria-hidden="true" />{t(total === 1 ? "owner.cc.students.one" : "owner.cc.students.other", { n: total })}</span>
        {demoCount > 0 ? <span className="pill warn" data-testid="cc-demo-count"><i aria-hidden="true" />{t("owner.cc.demoNote", { n: demoCount })}</span> : null}
      </div>
    </header>
  );
}

// ── countdown-ring widgets ──────────────────────────────────────────────────

/** Donut split by severity (critical / warning / info), like the student credit gauge. Decorative. */
function SegRing({ parts, size = 64 }: { parts: { n: number; color: string }[]; size?: number }) {
  const r = 27;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((s, p) => s + p.n, 0);
  let offset = 0;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--t-panel-3)" strokeWidth="5" />
      {total > 0 && parts.filter((p) => p.n > 0).map((p, i) => {
        const len = (p.n / total) * c;
        const gap = parts.filter((x) => x.n > 0).length > 1 ? 2.5 : 0;
        const el = <circle key={i} cx="32" cy="32" r={r} fill="none" stroke={p.color} strokeWidth="5" strokeDasharray={`${Math.max(0.5, len - gap).toFixed(1)} ${c.toFixed(1)}`} strokeDashoffset={(-offset).toFixed(1)} />;
        offset += len;
        return el;
      })}
    </svg>
  );
}

function Widget({ testId, sev, ring, big, unit, title, text, action }: { testId: string; sev: string; ring: React.ReactNode; big: React.ReactNode; unit: string; title: React.ReactNode; text: React.ReactNode; action?: { href: string; label: string } }) {
  return (
    <article className="alert" style={{ "--sev": sev } as React.CSSProperties} data-testid={testId}>
      <div className="rg">{ring}<b>{big}<small>{unit}</small></b></div>
      <span className="t">{title}</span>
      <span className="d">{text}</span>
      {action ? <span className="a"><a className="link" href={action.href}>{action.label} →</a></span> : null}
    </article>
  );
}

function Widgets({ d, today, locale, demoIds }: { d: ControlCenterView; today: string; locale: string; demoIds: ReadonlySet<string> }) {
  const { t } = useT();
  const daysText = useDaysText();
  const sev = queueSeverityCounts(d.queue, demoIds);
  const worst: Tone = sev.critical > 0 ? "urgent" : sev.warning > 0 ? "attention" : d.counts.needsYou > 0 ? "gold" : "ok";

  const realDeadlines = d.deadlines.filter((x) => !demoIds.has(x.studentId));
  const soonest = [...realDeadlines].sort((a, b) => a.daysLeft - b.daysLeft)[0] ?? null;
  const dlTone: Tone = soonest ? daysLeftTone(soonest.daysLeft) : "ok";

  const month = monthProgress(today);
  const monthName = new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date());
  const p = d.payments;
  const received = p.currency && p.receivedThisMonthCents > 0 ? formatMoneyCompact(p.receivedThisMonthCents, p.currency, locale) : null;
  const payTone: Tone = p.overdueInstallments > 0 ? "urgent" : p.signedNotPaid > 0 ? "attention" : "ok";

  const pipeline = d.counts.preEnrollment + d.counts.flying;

  return (
    <section aria-label={t("owner.kpi.label")} className="alerts occ-alerts">
      <Widget testId="kpi-needs" sev={COLOR[worst]}
        ring={<SegRing parts={[{ n: sev.critical, color: "var(--t-red)" }, { n: sev.warning, color: "var(--t-amber)" }, { n: sev.info, color: "var(--t-accent)" }]} />}
        big={d.counts.needsYou} unit={t(d.counts.needsYou === 1 ? "owner.unit.action" : "owner.unit.actions")}
        title={t("owner.kpi.needs")}
        text={d.counts.needsYou === 0 ? t("owner.ring.needs.none") : t("owner.ring.needs.d", { c: sev.critical, w: sev.warning, i: sev.info })}
        action={{ href: "#cc-queue", label: t("owner.ring.needs.act") }} />
      <Widget testId="kpi-deadlines" sev={COLOR[dlTone]}
        ring={<Ring fraction={soonest ? Math.min(1, Math.max(0.04, (14 - Math.max(0, soonest.daysLeft)) / 14)) : 0} color={COLOR[dlTone]} />}
        big={d.counts.deadlines14d} unit={t("owner.unit.due")}
        title={t("owner.ring.deadlines.t")}
        text={soonest ? t("owner.ring.deadlines.d", { label: soonest.label, name: soonest.studentName, when: daysText(soonest.daysLeft) }) : t("owner.next.empty")}
        action={{ href: "#cc-deadlines", label: t("owner.ring.deadlines.act") }} />
      <Widget testId="kpi-payments" sev={COLOR[payTone]}
        ring={<Ring fraction={month ? month.day / month.days : 0} color="var(--t-accent)" />}
        big={month ? month.left : DASH} unit={t(month?.left === 1 ? "owner.unit.dayLeft" : "owner.unit.daysLeft")}
        title={received ? <><span data-testid="kpi-payments-value">{received}</span> {t("owner.kpi.paymentsHint", { month: monthName })}</> : t("owner.ring.pay.none", { month: monthName })}
        text={t("owner.ring.pay.d", { s: p.signedNotPaid, o: p.overdueInstallments })}
        action={{ href: "#cc-payments", label: t("owner.ring.pay.act") }} />
      <Widget testId="kpi-pre" sev="var(--t-accent)"
        ring={<Ring fraction={pipeline > 0 ? d.counts.preEnrollment / pipeline : 0} color="var(--t-accent)" />}
        big={d.counts.preEnrollment} unit={t(d.counts.preEnrollment === 1 ? "owner.unit.student" : "owner.unit.students")}
        title={t("owner.kpi.pre")}
        text={t("owner.ring.pre.d", { n: d.counts.flying })}
        action={{ href: "#cc-students", label: t("owner.ring.pre.act") }} />
    </section>
  );
}

function Radar({ d }: { d: ControlCenterView }) {
  const { t } = useT();
  const real = d.students.filter((s) => !s.isDemo);
  const endingSoon = d.supportWindows.filter((w) => w.monthsLeft <= 1 && !d.students.find((s) => s.studentId === w.studentId)?.isDemo).length;
  const critical = real.filter((s) => s.status.tone === "critical").length;
  const chips: { key: string; text: string; color: string; href: string; testId?: string }[] = [
    { key: "flying", text: t(d.counts.flying === 1 ? "owner.radar.flying.one" : "owner.radar.flying.other", { n: d.counts.flying }), color: "var(--t-green)", href: "#cc-fleet", testId: "kpi-flying" },
  ];
  if (critical > 0) chips.push({ key: "critical", text: t(critical === 1 ? "owner.radar.critical.one" : "owner.radar.critical.other", { n: critical }), color: "var(--t-red)", href: "#cc-students" });
  if (d.payments.overdueInstallments > 0) chips.push({ key: "overdue", text: t(d.payments.overdueInstallments === 1 ? "owner.radar.overdue.one" : "owner.radar.overdue.other", { n: d.payments.overdueInstallments }), color: "var(--t-red)", href: "#cc-payments" });
  if (d.payments.signedNotPaid > 0) chips.push({ key: "signed", text: t(d.payments.signedNotPaid === 1 ? "owner.radar.signed.one" : "owner.radar.signed.other", { n: d.payments.signedNotPaid }), color: "var(--t-amber)", href: "#cc-payments" });
  if (endingSoon > 0) chips.push({ key: "support", text: t(endingSoon === 1 ? "owner.radar.support.one" : "owner.radar.support.other", { n: endingSoon }), color: "var(--t-amber)", href: "#cc-support" });
  return (
    <div className="radar" data-testid="cc-radar">
      <span className="lbl">{t("owner.radar.label")}</span>
      {chips.map((c) => (
        <a key={c.key} href={c.href} className="chipbtn" style={{ "--sev": c.color } as React.CSSProperties} data-testid={c.testId ?? `radar-${c.key}`}><i aria-hidden="true" /><span>{c.text}</span></a>
      ))}
    </div>
  );
}

// ── queue ───────────────────────────────────────────────────────────────────

function QueueRow({ item, role, isDemo }: { item: ControlQueueItem; role: string | undefined; isDemo: boolean }) {
  const { t } = useT();
  const [, navigate] = useLocation();
  const meta = queueItemMeta(item);
  const href = queueActionHref(item.href, role);
  return (
    <li className="occ-q" style={{ "--sev": COLOR[meta.tone] } as React.CSSProperties} data-testid="queue-item" data-kind={item.kind} data-severity={item.severity}>
      <IconBadge icon={meta.icon} tone={meta.tone} />
      <div className="occ-q-body">
        <p className="occ-q-t">
          {item.title}
          {isDemo ? <span className="occ-demo">{t("owner.demo")}</span> : null}
          <span className="sr-only"> ({t(`owner.severity.${item.severity}` as TranslationKey)})</span>
        </p>
        <p className="occ-q-d">{item.detail}</p>
      </div>
      <button type="button" className="b1 occ-q-act" onClick={() => navigate(href)} data-testid="queue-action">
        {t(meta.actionKey)}<ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  );
}

function QueueCard({ queue, role, demoIds }: { queue: readonly ControlQueueItem[]; role: string | undefined; demoIds: ReadonlySet<string> }) {
  const { t } = useT();
  const [all, setAll] = useState(false);
  const shown = all ? queue : queue.slice(0, LIST_LIMIT);
  return (
    <Card title={t("owner.queue.title")} labelId="cc-queue-h" testId="cc-queue" aside={t("owner.queue.open", { n: queue.length })} className="occ-queue">
      {queue.length === 0 ? (
        <div className="occ-empty" data-testid="queue-empty">
          <Ring fraction={1} color="var(--t-green)" size={40} />
          <p>{t("owner.queue.empty")}</p>
        </div>
      ) : (
        <ul className="occ-qlist">{shown.map((item) => <QueueRow key={item.id} item={item} role={role} isDemo={demoIds.has(item.studentId)} />)}</ul>
      )}
      {queue.length > LIST_LIMIT || role === "admin" ? <div className="occ-foot">
        {queue.length > LIST_LIMIT ? (
          <button type="button" className="link" onClick={() => setAll((v) => !v)} aria-expanded={all} data-testid="queue-toggle">
            {all ? t("owner.list.showLess") : t("owner.list.showAll", { n: queue.length })}
          </button>
        ) : <span />}
        {role === "admin" ? <Link href="/admin/elective-requests" className="link">{t("owner.queue.electives")} →</Link> : null}
      </div> : null}
    </Card>
  );
}

// ── next 14 days ────────────────────────────────────────────────────────────

function DeadlinesCard({ d, locale, demoIds }: { d: ControlCenterView; locale: string; demoIds: ReadonlySet<string> }) {
  const { t } = useT();
  const daysText = useDaysText();
  const [all, setAll] = useState(false);
  const list = all ? d.deadlines : d.deadlines.slice(0, LIST_LIMIT);
  return (
    <Card title={t("owner.next.title")} labelId="cc-deadlines-h" testId="cc-deadlines" aside={t("owner.next.sub")}>
      {d.deadlines.length === 0 ? (
        <div className="occ-empty"><Ring fraction={1} color="var(--t-green)" size={40} /><p>{t("owner.next.empty")}</p></div>
      ) : (
        <div className="agenda">
          {list.map((x, i) => {
            const p = isoParts(x.dueOn);
            return (
              <div key={`${x.studentId}-${x.label}-${i}`} className={cn("ag", x.daysLeft <= 0 && "today")} data-testid="deadline-item">
                <span className="dt">{formatDay(x.dueOn, locale, { weekday: "short" })}<b>{p?.day ?? DASH}</b></span>
                <span className="w"><span className="occ-ag-t">{x.label}</span><span>{x.studentName}{demoIds.has(x.studentId) ? ` · ${t("owner.demo")}` : ""}</span></span>
                <Pill tone={daysLeftTone(x.daysLeft)}>{daysText(x.daysLeft)}</Pill>
              </div>
            );
          })}
        </div>
      )}
      {d.deadlines.length > LIST_LIMIT ? (
        <button type="button" className="link" onClick={() => setAll((v) => !v)} aria-expanded={all}>{all ? t("owner.list.showLess") : t("owner.list.showAll", { n: d.deadlines.length })}</button>
      ) : null}
    </Card>
  );
}

// ── payments ────────────────────────────────────────────────────────────────

function PaymentsCard({ data, locale, today }: { data: ControlCenterView; locale: string; today: string }) {
  const { t } = useT();
  const p = data.payments;
  const month = monthProgress(today);
  const monthName = new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date());
  const money = p.currency ? formatMoneyCompact(p.receivedThisMonthCents, p.currency, locale) : String(p.receivedThisMonthCents / 100);
  return (
    <Card title={t("owner.pay.title")} labelId="cc-payments-h" testId="cc-payments" aside={monthName}>
      <div className="stat"><b data-testid="pay-received">{money}</b><span>{t("owner.pay.received")}</span></div>
      {month ? (
        <div className="occ-month">
          <div className="meter" aria-hidden="true"><i style={{ width: `${(month.day / month.days) * 100}%` }} /></div>
          <span className="small">{t("owner.pay.month", { d: month.day, n: month.days })}</span>
        </div>
      ) : null}
      <div className="occ-paylines">
        <div><span className="occ-dot" style={{ background: p.signedNotPaid > 0 ? "var(--t-amber)" : "var(--t-line-3)" }} aria-hidden="true" /><span>{t("owner.pay.signed")}</span><b data-testid="pay-signed">{p.signedNotPaid}</b></div>
        <div><span className="occ-dot" style={{ background: p.overdueInstallments > 0 ? "var(--t-red)" : "var(--t-line-3)" }} aria-hidden="true" /><span>{t("owner.pay.overdue")}</span><b data-testid="pay-overdue" className={p.overdueInstallments > 0 ? "occ-red" : undefined}>{p.overdueInstallments}</b></div>
      </div>
    </Card>
  );
}

// ── Ask Lumière ─────────────────────────────────────────────────────────────

const ASSISTANT_CHIPS: TranslationKey[] = ["owner.ai.chip.risk", "owner.ai.chip.review", "owner.ai.chip.finish"];

function AssistantCard() {
  const { t } = useT();
  return (
    <section className="card occ-ai" aria-labelledby="cc-ai-h" data-testid="cc-assistant">
      <div className="ai-head">
        <LumiereOrb size={46} />
        <div className="min-w-0">
          <h2 id="cc-ai-h">{t("owner.ai.title")}</h2>
          <span>{t("owner.ai.sub")}</span>
        </div>
      </div>
      <p className="occ-ai-body">{t("owner.ai.body")}</p>
      <ul className="qs" aria-label={t("owner.ai.chips")}>
        {ASSISTANT_CHIPS.map((k) => (
          <li key={k}><Link href={`/admin/assistant?q=${encodeURIComponent(t(k))}`} className="q">{t(k)}</Link></li>
        ))}
      </ul>
      <div className="btns"><Link href="/admin/assistant" className="b2 occ-btn" data-testid="cc-assistant-open"><Sparkles className="h-4 w-4" aria-hidden="true" />{t("owner.ai.open")}</Link></div>
    </section>
  );
}

// ── roster ──────────────────────────────────────────────────────────────────

function ViewAsButton({ studentId, name }: { studentId: string; name: string }) {
  const { t } = useT();
  const action = useExperienceAction(studentId);
  return (
    <span className="occ-viewas">
      <button type="button" onClick={() => void action.run()} disabled={action.pending} className="link occ-viewas-btn" aria-label={t("owner.row.viewAsNamed", { name })}>
        {action.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}{t("owner.row.viewAs")}
      </button>
      {action.error ? <span role="alert" className="occ-err">{action.error}</span> : null}
    </span>
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
  const col = (k: TranslationKey) => t(k);
  return (
    <section className="card occ-roster" aria-labelledby="cc-students-h" data-testid="cc-students" id="cc-students">
      <div className="ch">
        <div className="min-w-0">
          <span className="eyebrow">{t("owner.students.eyebrow")}</span>
          <h2 id="cc-students-h">{t("owner.students.title")}</h2>
        </div>
        <div role="group" aria-label={t("owner.filter.label")} className="occ-filters">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} data-testid={`filter-${f.key}`} className="occ-filter">{t(f.label)}</button>
          ))}
          <span className="small occ-count">{t("owner.students.count", { n: shown.length })}</span>
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="occ-empty" data-testid="cc-students-empty"><p>{t("owner.students.empty")}</p></div>
      ) : (
        <div className="occ-tablewrap" role="region" aria-label={t("owner.students.title")}>
          <table className="occ-table">
            <caption className="sr-only">{t("owner.students.title")}</caption>
            <colgroup>
              <col className="c-student" /><col className="c-flight" /><col className="c-arrival" /><col className="c-status" /><col className="c-next" /><col className="c-support" /><col className="c-actions" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">{col("owner.col.student")}</th>
                <th scope="col">{col("owner.col.journey")}</th>
                <th scope="col">{col("owner.col.arrival")}</th>
                <th scope="col">{col("owner.col.status")}</th>
                <th scope="col">{col("owner.col.next")}</th>
                <th scope="col">{col("owner.col.support")}</th>
                <th scope="col"><span className="sr-only">{col("owner.col.actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const nameParts = r.name.split(" ");
                const fraction = creditsFraction(r.creditsConfirmed, r.creditsRequired);
                const finish = plausibleArrival(r.estimatedFinishOn, today);
                const arrival = finish ? formatArrival(finish, today, locale) : null;
                return (
                  <tr key={r.studentId} data-testid="student-row" data-demo={r.isDemo ? "true" : "false"}>
                    <td className="occ-td-student">
                      <div className="occ-who">
                        <span className="occ-photo"><StudentPhoto student={{ first_name: nameParts[0] ?? r.name, last_name: nameParts.slice(1).join(" "), preferred_name: null, email: null, photo_url: null }} size="md" /></span>
                        <div className="min-w-0">
                          <p className="occ-name">{r.name}{r.isDemo ? <span className="occ-demo" data-testid="demo-pill">{t("owner.demo")}</span> : null}</p>
                          <p className="occ-sub"><span className="occ-mono">{r.code ?? DASH}</span> · {t(programLabelKey(r.program))}</p>
                        </div>
                      </div>
                    </td>
                    <td data-label={col("owner.col.journey")}>
                      <div className="occ-flight">
                        <FlightArc fraction={fraction} width={96} height={30} />
                        <span className="occ-credits"><b>{r.creditsConfirmed}</b> / {r.creditsRequired ?? DASH}</span>
                        <span className="occ-sub" data-testid="row-pace">{r.paceLabel ?? DASH}</span>
                      </div>
                    </td>
                    <td data-label={col("owner.col.arrival")}>
                      <p className="occ-strong" data-testid="row-arrival">{arrival ?? DASH}</p>
                      <p className="occ-sub">{arrival ? t("owner.row.atPace") : t("owner.row.tooEarly")}</p>
                    </td>
                    <td data-label={col("owner.col.status")}>
                      <Pill tone={statusTone(r.status.tone)}>{r.status.label}</Pill>
                      <p className="occ-sub occ-gap">{r.lastActivityOn ? t("owner.row.lastActive", { date: formatDay(r.lastActivityOn, locale) }) : t("owner.row.noActivity")}</p>
                    </td>
                    <td data-label={col("owner.col.next")}>
                      {r.nextDeadline ? (
                        <>
                          <p className="occ-ink">{r.nextDeadline.label}</p>
                          <p className="occ-sub">{formatDay(r.nextDeadline.dueOn, locale)} · <span className={cn("occ-days", `t-${daysLeftTone(r.nextDeadline.daysLeft)}`)}>{daysText(r.nextDeadline.daysLeft)}</span></p>
                        </>
                      ) : <span className="occ-muted">{DASH}</span>}
                    </td>
                    <td data-label={col("owner.col.support")}>
                      {r.supportMonthsLeft === null ? <span className="occ-sub">{t("owner.row.afterPayment")}</span> : <span className="occ-ink">{t(r.supportMonthsLeft === 1 ? "owner.months.one" : "owner.months.other", { n: r.supportMonthsLeft })}</span>}
                    </td>
                    <td className="occ-td-actions">
                      <Link href={studentOpenHref(r, role)} className="b2 occ-open" aria-label={t("owner.row.openNamed", { name: r.name })} data-testid="open-file">{t("owner.row.open")}</Link>
                      {role === "admin" ? <ViewAsButton studentId={r.studentId} name={r.name} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── support windows ─────────────────────────────────────────────────────────

function SupportCard({ data, className, limit }: { data: ControlCenterView; className?: string; limit?: number }) {
  const { t } = useT();
  const [all, setAll] = useState(false);
  const byId = new Map(data.students.map((s) => [s.studentId, s]));
  const sorted = [...data.supportWindows].sort((a, b) => a.monthsLeft - b.monthsLeft);
  const windows = limit && !all ? sorted.slice(0, limit) : sorted;
  const longest = Math.max(1, ...sorted.map((w) => w.monthsLeft));
  return (
    <Card title={t("owner.support.title")} labelId="cc-support-h" testId="cc-support" aside={t("owner.support.sub")} className={cn("occ-support", className)}>
      {windows.length === 0 ? <div className="occ-empty"><p>{t("owner.support.empty")}</p></div> : (
        <ul className="occ-tiles">
          {windows.map((w) => {
            const row = byId.get(w.studentId);
            const tone = supportWindowTone(w.monthsLeft);
            return (
              <li key={w.studentId} className="occ-tile" data-testid="support-window">
                <div className="occ-minirg">
                  <Ring fraction={w.monthsLeft / longest} color={COLOR[tone]} size={52} />
                  <b>{w.monthsLeft}<small>{t("owner.unit.mo")}</small></b>
                </div>
                <div className="min-w-0">
                  <p className="occ-name">{w.studentName}{row?.isDemo ? <span className="occ-demo">{t("owner.demo")}</span> : null}</p>
                  {row ? <p className="occ-sub">{t(programLabelKey(row.program))} · {t("owner.support.credits", { a: row.creditsConfirmed, b: row.creditsRequired ?? DASH })}</p> : null}
                  <Pill tone={tone}>{t(tone === "ok" ? "owner.support.onTime" : "owner.support.ending")}</Pill>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {limit && sorted.length > limit ? (
        <button type="button" className="link" onClick={() => setAll((v) => !v)} aria-expanded={all}>{all ? t("owner.list.showLess") : t("owner.list.showAll", { n: sorted.length })}</button>
      ) : null}
    </Card>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

export function ControlCenter() {
  const { t, language } = useT();
  const { user } = useAuth();
  const locale = localeOf(language);
  const query = useControlCenter();
  const today = todayIsoLocal();
  const role = user?.role;
  const isAdmin = role === "admin";

  if (query.isLoading) {
    return (
      <div className="s27 occ" role="status" aria-live="polite" data-testid="cc-loading">
        <span className="sr-only">{t("owner.cc.loading")}</span>
        <div className="occ-skel" style={{ height: 56, width: "60%" }} />
        <div className="alerts occ-alerts">{[0, 1, 2, 3].map((i) => <div key={i} className="occ-skel" style={{ height: 112 }} />)}</div>
        <div className="occ-skel" style={{ height: 320 }} />
      </div>
    );
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
  const demoIds = new Set(d.students.filter((s) => s.isDemo).map((s) => s.studentId));
  const demoCount = demoIds.size;

  return (
    <div className="s27 occ" data-testid="control-center">
      <Headline count={d.counts.needsYou} demoCount={demoCount} total={d.students.length} locale={locale} />
      {d.truncated ? <p className="notice warn" role="status" data-testid="cc-truncated">{t("owner.cc.truncated")}</p> : null}
      <Widgets d={d} today={today} locale={locale} demoIds={demoIds} />
      <Radar d={d} />

      {/* Admin: the assistant closes the right column. Staff have no assistant, so the support windows take its place. */}
      <div className={cn("occ-grid", isAdmin && "has-ai")}>
        <div className="colst">
          <FleetInstrument rows={d.students} hrefOf={(r) => studentOpenHref(r, role)} />
          <QueueCard queue={queue} role={role} demoIds={demoIds} />
        </div>
        <div className="colst">
          <DeadlinesCard d={d} locale={locale} demoIds={demoIds} />
          <PaymentsCard data={d} locale={locale} today={today} />
          {isAdmin ? <AssistantCard /> : <SupportCard data={d} className="occ-support-side" limit={4} />}
        </div>
      </div>

      <StudentsTable rows={d.students} role={role} today={today} locale={locale} />
      {isAdmin ? <SupportCard data={d} /> : null}
      {demoCount > 0 ? <p className="notice" data-testid="cc-demo-note">{t("owner.cc.demoFooter")}</p> : null}
    </div>
  );
}
