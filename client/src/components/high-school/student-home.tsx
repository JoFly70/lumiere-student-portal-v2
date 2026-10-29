/**
 * Student home (high school): who you are, what to do next, how far you are. Short and calm:
 * hero with a prominent "Continue studying" action, 2 to 4 immediate tasks, 21-credit progress
 * (verified / reported / planned), upcoming milestones, latest support reply and a billing chip.
 */
import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, BookOpen, CreditCard, FileText, LifeBuoy, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentHighSchoolView } from "@shared/high-school-contract";
import type { SupportTicketSummary } from "@shared/support-contract";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatusPill } from "@/components/student-progress/student-ui";
import { CockpitOps, formatMoneyLocale } from "@/components/cockpit/model";
import { useT, type TranslationKey } from "@/i18n";
import { formatShortDate } from "@/pages/student-roadmap-presentation";
import { courseTitleView, creditsLabel, dueLabel, taskKindLabel, taskStatusView } from "@/pages/high-school-presentation";
import { buildDegreeMap, buildMonthBand, buildPhaseBands, findCourse, immediateTasks, isAcceleratedPlan, nextOpenTask, type OpenTask, displayTitle } from "@/lib/degree-map";
import { CreditBar } from "./degree-map";
import { CourseDrawer } from "./course-drawer";

export type HomeTicket = Pick<SupportTicketSummary, "id" | "subject" | "ticket_number" | "last_public_reply_by" | "last_public_reply_at">;
export interface HomeIdentity { readonly name: string; readonly photoUrl: string | null }

const PACE_KEY: Record<StudentHighSchoolView["pace"]["status"], TranslationKey | null> = {
  on_track: "ux.home.pace.on_track",
  ahead: "ux.home.pace.ahead",
  behind: "ux.home.pace.behind",
  not_configured: null,
};

function ago(iso: string, language: "en" | "fr", now: number): string {
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  if (!Number.isFinite(days) || days < 1) {
    const hours = Math.max(0, Math.floor((now - Date.parse(iso)) / 3_600_000));
    return Number.isFinite(hours) ? rtf.format(-hours, "hour") : "";
  }
  return rtf.format(-days, "day");
}

function Card({ children, className, label, testId }: { children: React.ReactNode; className?: string; label: string; testId: string }) {
  return (
    <section className={cn("min-w-0 rounded-2xl border border-student-line bg-student-card p-4 shadow-[0_1px_2px_hsl(var(--s-ink)/0.04)] sm:p-5", className)} aria-label={label} data-testid={testId}>
      {children}
    </section>
  );
}
const H = ({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) => (
  <h2 className="mb-3 flex items-center gap-2 font-serif text-xl leading-tight tracking-tight text-student-ink">{icon}{children}</h2>
);

export function StudentHome({
  view, identity, ops, tickets, today, now = Date.now(),
}: {
  view: StudentHighSchoolView;
  identity: HomeIdentity | null;
  ops: CockpitOps;
  tickets: readonly HomeTicket[] | null;
  today: string;
  now?: number;
}) {
  const { t, language, formatCredits: fc } = useT();
  const lang = language === "fr" ? "fr" : "en";
  const [openKey, setOpenKey] = useState<string | null>(null);
  const { totals, groups } = useMemo(() => buildDegreeMap(view), [view]);
  const next = useMemo(() => nextOpenTask(view), [view]);
  const tasks = useMemo(() => immediateTasks(view, 4).filter((k) => !(next && k.courseKey === next.courseKey && k.key === next.key)), [view, next]);
  const course = findCourse(view, openKey);
  const fmt = (iso: string | null) => formatShortDate(iso, lang);
  const paceKey = PACE_KEY[view.pace.status];
  const name = identity?.name ?? "";
  const school = view.enrollment.schoolDisplayName;
  const accelerated = useMemo(() => isAcceleratedPlan(groups), [groups]);

  const milestones = useMemo(() => {
    if (accelerated) {
      return buildPhaseBands(groups).filter((b) => b.halfUnits > 0).slice(0, 4).map((b) => ({
        key: b.id,
        title: t("ux.home.milestone.weeks", { from: b.from, to: b.to }),
        detail: t("ux.home.milestone.cumulative", { n: fc(b.cumulative) }),
        done: totals.verified >= b.cumulative,
      }));
    }
    return buildMonthBand(view, today).filter((m) => m.state !== "reached").slice(0, 3).map((m) => ({
      key: m.month,
      title: new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
      detail: t("ux.home.milestone.cumulative", { n: fc(m.cumulativeHalfUnits) }),
      done: false,
    }));
  }, [accelerated, groups, view, today, totals.verified, fc, t, lang]);

  const latestReply = useMemo(() => {
    const replied = (tickets ?? []).filter((x) => x.last_public_reply_by === "staff" && x.last_public_reply_at).sort((a, b) => (b.last_public_reply_at ?? "").localeCompare(a.last_public_reply_at ?? ""));
    return replied[0] ?? null;
  }, [tickets]);

  const taskLine = (task: OpenTask) => {
    const due = dueLabel(task.dueDate, today, fmt, lang);
    return due;
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5" data-testid="student-home">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="relative overflow-hidden rounded-3xl border border-white/10 p-5 text-[#f2ede3] shadow-lg sm:p-7" style={{ background: "linear-gradient(135deg, #0b1120 0%, #151f36 100%)" }} aria-labelledby="home-hello" data-testid="home-hero">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 shrink-0 border-2 border-[#c8ae76] sm:h-20 sm:w-20" data-testid="home-avatar">
              <AvatarImage src={identity?.photoUrl || undefined} alt="" />
              <AvatarFallback aria-hidden="true" className="bg-[#e6d3a3] font-serif text-2xl text-[#1a1406]">{(name.trim().charAt(0) || "L").toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h1 id="home-hello" className="break-words font-serif text-3xl leading-tight tracking-tight sm:text-4xl" data-testid="home-greeting">{name ? t("ux.home.hello", { name }) : t("ux.home.helloAnon")}</h1>
              <p className="mt-1 break-words text-sm opacity-90" data-testid="home-program">{view.enrollment.programTitle} · {school}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold" data-testid="home-status">
                <span className="rounded-full bg-white/15 px-2.5 py-1">{t(`ux.home.enrollment.${view.enrollment.status}` as TranslationKey)}</span>
                {paceKey && <span className={cn("rounded-full px-2.5 py-1", view.pace.status === "behind" ? "bg-[#b45309] text-white" : "bg-[#e6d3a3] text-[#1a1406]")}>{t(paceKey)}</span>}
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-2xl bg-white/10 p-4 sm:p-5" data-testid="continue-studying">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#c8ae76]">
              <BookOpen className="h-4 w-4" aria-hidden="true" />{next ? t("ux.home.continue") : t("ux.home.nextAction")}
            </p>
            {next ? (
              <>
                <p className="mt-2 break-words font-serif text-2xl leading-snug sm:text-[1.7rem]" data-testid="continue-task">{next.title}</p>
                <p className="mt-1 text-sm opacity-90">
                  {displayTitle(next.courseTitle)}
                  {taskLine(next) ? ` · ${taskLine(next)}` : ""}
                  {next.overdue ? ` · ${t("hs.journey.pastTarget")}` : ""}
                </p>
                <button type="button" onClick={() => setOpenKey(next.courseKey)} className="mt-4 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold text-[#1a1406] shadow-[0_6px_18px_-8px_rgba(200,174,118,0.9)] hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white" style={{ background: "linear-gradient(90deg, #c8ae76, #e6d3a3)" }} data-testid="button-continue">
                  {t("ux.home.continue.cta")}<ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            ) : (
              <>
                <p className="mt-2 font-serif text-2xl leading-snug">{t("ux.home.allCaughtUp")}</p>
                <p className="mt-1 text-sm opacity-90">{t("ux.home.allCaughtUpBody")}</p>
                <Link href="/high-school" className="mt-4 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold text-[#1a1406]" style={{ background: "linear-gradient(90deg, #c8ae76, #e6d3a3)" }} data-testid="link-roadmap">{t("ux.home.openRoadmap")}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              </>
            )}
          </div>
        </section>

        <Card label={t("ux.home.progress")} testId="home-progress">
          <H icon={<Target className="h-5 w-5 text-student-gold-ink" aria-hidden="true" />}>{t("ux.home.progress")}</H>
          <p className="flex items-baseline gap-2 text-student-ink">
            <span className="font-serif text-5xl leading-none tracking-tight tnum" data-testid="home-verified">{fc(totals.verified)}</span>
            <span className="text-sm text-student-muted">{t("ux.home.verifiedOf", { total: fc(totals.required) })}</span>
          </p>
          <CreditBar className="mt-3 h-3" verified={totals.verified} reported={totals.reported} planned={totals.planned} total={totals.required} label={t("ux.map.overallBarAria", { verified: fc(totals.verified), reported: fc(totals.reported), planned: fc(totals.planned), total: fc(totals.required) })} />
          <dl className="mt-4 space-y-2 text-sm" data-testid="home-credit-rows">
            {([
              ["verified", totals.verified, "bg-st-official"],
              ["reported", totals.reported, "bg-st-submitted"],
              ["planned", totals.planned, "border border-dashed border-st-notstarted bg-st-notstarted-soft"],
            ] as const).map(([b, v, dot]) => (
              <div key={b} className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-student-ink"><i aria-hidden="true" className={cn("inline-block h-2.5 w-2.5 rounded-full", dot)} />{t(`ux.status.${b}` as TranslationKey)}</dt>
                <dd className="font-semibold text-student-ink tnum">{creditsLabel(v, language)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-snug text-student-muted">{t("ux.home.coreElective", { core: fc(view.credits.core.earnedHalfUnits), coreTotal: fc(view.credits.core.requiredHalfUnits), elective: fc(view.credits.elective.earnedHalfUnits), electiveTotal: fc(view.credits.elective.requiredHalfUnits) })}</p>
          <Link href="/high-school" className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-student-gold-ink underline underline-offset-4" data-testid="link-roadmap-detail">{t("ux.home.seeRoadmap")}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          <Link href="/high-school/flight-deck?view=credits" className="ml-4 inline-flex min-h-[44px] items-center text-sm text-student-muted underline underline-offset-4" data-testid="link-credit-detail">{t("ux.home.creditDetail")}</Link>
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Card label={t("ux.home.tasks")} testId="home-tasks" className="xl:col-span-1">
          <H>{t("ux.home.tasks")}</H>
          {tasks.length === 0 ? (
            <p className="text-sm text-student-muted">{t("ux.home.tasksEmpty")}</p>
          ) : (
            <ul className="divide-y divide-student-line">
              {tasks.map((k) => {
                const st = taskStatusView(k.status, language);
                const due = taskLine(k);
                return (
                  <li key={`${k.courseKey}:${k.key}`}>
                    <button type="button" onClick={() => setOpenKey(k.courseKey)} className="flex min-h-[56px] w-full items-center gap-3 py-2.5 text-left hover:bg-student-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-student-gold-ink" data-testid="home-task">
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-student-muted">{taskKindLabel(k.kind, language)} · {displayTitle(k.courseTitle)}</span>
                        <span className="block text-sm font-medium text-student-ink">{k.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          <StatusPill status={st.key} label={st.label} className="px-2 py-0.5 text-[11px]" />
                          {due && <span className={cn("text-xs", k.overdue ? "font-semibold text-st-attention" : "text-student-muted")}>{due}</span>}
                        </span>
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card label={t("ux.home.milestones")} testId="home-milestones">
          <H>{accelerated ? t("ux.home.milestones16") : t("ux.home.milestones")}</H>
          {milestones.length === 0 ? (
            <p className="text-sm text-student-muted">{t("ux.home.milestonesEmpty")}</p>
          ) : (
            <ol className="space-y-2.5">
              {milestones.map((m) => (
                <li key={m.key} className="flex items-start gap-3 text-sm" data-testid="home-milestone">
                  <span aria-hidden="true" className={cn("mt-1 h-3 w-3 shrink-0 rounded-full border-2", m.done ? "border-st-official bg-st-official" : "border-student-gold bg-student-card")} />
                  <span><span className="block font-medium text-student-ink">{m.title}</span><span className="block text-xs text-student-muted">{m.detail}{m.done ? ` · ${t("ux.home.milestone.done")}` : ""}</span></span>
                </li>
              ))}
            </ol>
          )}
          {accelerated && <p className="mt-3 text-xs text-student-muted">{t("ux.timeline.note")}</p>}
        </Card>

        <Card label={t("ux.home.support")} testId="home-support" className="md:col-span-2 xl:col-span-1">
          <H icon={<LifeBuoy className="h-5 w-5 text-student-gold-ink" aria-hidden="true" />}>{t("ux.home.support")}</H>
          {latestReply ? (
            <div data-testid="home-latest-reply">
              <p className="text-sm font-medium text-student-ink">{latestReply.subject}</p>
              <p className="mt-1 text-xs text-student-muted">{t("ux.home.support.replied", { when: ago(latestReply.last_public_reply_at!, lang, now) })} · {latestReply.ticket_number}</p>
              <Link href="/support" className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-student-gold-ink underline underline-offset-4">{t("ux.home.support.read")}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </div>
          ) : (
            <div data-testid="home-no-reply">
              <p className="text-sm text-student-muted">{tickets === null ? t("cockpit.ops.unavailable") : t("ux.home.support.none")}</p>
              <Link href="/support" className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-student-gold-ink underline underline-offset-4">{t("ux.home.support.ask")}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </div>
          )}
        </Card>
      </div>

      <ul className="grid gap-3 md:grid-cols-3" data-testid="home-chips" aria-label={t("cockpit.pulse.title")}>
        <Chip href="/billing" testId="chip-billing" icon={<CreditCard className="h-4 w-4" />} title={t("cockpit.pulse.payments")}
          attention={ops.payments.state === "ready" && ops.payments.data.overdue}
          text={ops.payments.state === "ready"
            ? ops.payments.data.nextDue
              ? t("ux.home.billing.next", { amount: formatMoneyLocale(ops.payments.data.nextDue.amountCents, ops.payments.data.currency, language), date: fmt(ops.payments.data.nextDue.dueDate) ?? ops.payments.data.nextDue.dueDate })
              : t("cockpit.pay.none")
            : ops.payments.state === "not_set_up" ? t("cockpit.ops.notSetUp") : ops.payments.state === "loading" ? t("cockpit.ops.loading") : t("cockpit.ops.unavailable")}
          sub={ops.payments.state === "ready" ? (ops.payments.data.overdue ? t("cockpit.pay.overdue") : t("cockpit.pay.balance", { amount: formatMoneyLocale(ops.payments.data.remainingCents, ops.payments.data.currency, language) })) : undefined} />
        <Chip href="/documents" testId="chip-documents" icon={<FileText className="h-4 w-4" />} title={t("cockpit.pulse.documents")}
          attention={ops.documents.state === "ready" && ops.documents.data.needAction > 0}
          text={ops.documents.state === "ready" ? (ops.documents.data.needAction > 0 ? t("cockpit.docs.needAction", { n: ops.documents.data.needAction }) : ops.documents.data.underReview > 0 ? t("cockpit.docs.review", { n: ops.documents.data.underReview }) : ops.documents.data.total === 0 ? t("cockpit.docs.none") : t("cockpit.docs.clear")) : ops.documents.state === "loading" ? t("cockpit.ops.loading") : t("cockpit.ops.unavailable")} />
        <Chip href="/library" testId="chip-library" icon={<BookOpen className="h-4 w-4" />} title={t("ux.nav.library")} text={t("ux.home.library")} />
      </ul>

      <CourseDrawer course={course} schoolLine={school} today={today} onClose={() => setOpenKey(null)} />
    </div>
  );
}

function Chip({ href, icon, title, text, sub, attention, testId }: { href: string; icon: React.ReactNode; title: string; text: string; sub?: string; attention?: boolean; testId: string }) {
  return (
    <li>
      <Link href={href} className={cn("flex min-h-[64px] items-center gap-3 rounded-2xl border bg-student-card px-4 py-3 hover:bg-student-gold-soft", attention ? "border-st-attention bg-st-attention-soft" : "border-student-line")} data-testid={testId}>
        <span aria-hidden="true" className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", attention ? "bg-st-attention text-white" : "bg-student-gold-soft text-student-gold-ink")}>{attention ? <AlertTriangle className="h-4 w-4" /> : icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-student-muted">{title}</span>
          <span className="block break-words text-sm font-semibold text-student-ink">{text}</span>
          {sub && <span className="block text-xs text-student-muted">{sub}</span>}
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />
      </Link>
    </li>
  );
}
