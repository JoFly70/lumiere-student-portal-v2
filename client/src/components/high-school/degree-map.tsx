/**
 * Roadmap as a degree map (high school): outcome cards, a timeline band, then subject groups with grouped progress
 * bars and individual course rows. 21 credits = 16 core + 5 electives. Clicking a course opens the course drawer.
 * Planned / Student reported / Officially verified are always three different things.
 */
import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, Check, ChevronRight, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HsCourseView, StudentHighSchoolView } from "@shared/high-school-contract";
import { useT, type TranslationKey } from "@/i18n";
import { StatusPill } from "@/components/student-progress/student-ui";
import { formatShortDate } from "@/pages/student-roadmap-presentation";
import { attentionView, courseTitleView, creditsLabel, subjectLabel } from "@/pages/high-school-presentation";
import { electiveAwaitsApproval } from "@/lib/elective-change";
import {
  buildDegreeMap, buildMonthBand, buildPhaseBands, courseBasis, isAcceleratedPlan,
  type CreditBasis, type MapGroup, type MapTotals, displayTitle } from "@/lib/degree-map";
import { BASIS_PILL, CourseDrawer, plannedWindowText } from "./course-drawer";

const BASIS_ORDER: readonly CreditBasis[] = ["verified", "reported", "planned"];
const BASIS_FILL: Record<CreditBasis, string> = {
  verified: "bg-st-official",
  reported: "bg-st-submitted",
  planned: "",
};
/** Planned credit is hatched so it never reads as an empty track. */
const PLANNED_HATCH = "repeating-linear-gradient(135deg, hsl(var(--st-notstarted) / 0.6) 0 3px, hsl(var(--st-notstarted) / 0.22) 3px 6px)";
const BASIS_DOT: Record<CreditBasis, string> = {
  verified: "bg-st-official",
  reported: "bg-st-submitted",
  planned: "border border-dashed border-st-notstarted bg-st-notstarted-soft",
};

function Swatch({ basis }: { basis: CreditBasis }) {
  return <i aria-hidden="true" className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", BASIS_DOT[basis])} />;
}

/** Stacked bar: verified | reported | planned, scaled to `total`. Text always sits beside it. */
export function CreditBar({ verified, reported, planned, total, label, className }: { verified: number; reported: number; planned: number; total: number; label: string; className?: string }) {
  const pct = (n: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0);
  return (
    <div className={cn("flex h-2.5 w-full overflow-hidden rounded-full bg-student-line", className)} role="img" aria-label={label}>
      {BASIS_ORDER.map((b) => {
        const v = b === "verified" ? verified : b === "reported" ? reported : planned;
        return v > 0 ? <i key={b} className={cn("block h-full", BASIS_FILL[b])} style={{ width: `${pct(v)}%`, ...(b === "planned" ? { background: PLANNED_HATCH } : {}) }} data-basis={b} /> : null;
      })}
    </div>
  );
}

function OutcomeCards({ totals }: { totals: MapTotals }) {
  const { t, formatCredits: fc } = useT();
  const cards: { id: string; label: string; value: string; sub: string; tone?: CreditBasis | "neutral" }[] = [
    { id: "required", label: t("ux.map.card.required"), value: fc(totals.required), sub: t("ux.map.card.requiredSub", { core: fc(totals.coreRequired), elective: fc(totals.electiveRequired) }), tone: "neutral" },
    { id: "verified", label: t("ux.map.card.verified"), value: fc(totals.verified), sub: t("ux.map.card.verifiedSub"), tone: "verified" },
    { id: "reported", label: t("ux.map.card.reported"), value: fc(totals.reported), sub: t("ux.map.card.reportedSub"), tone: "reported" },
    { id: "planned", label: t("ux.map.card.planned"), value: fc(totals.planned), sub: t("ux.map.card.plannedSub"), tone: "planned" },
    { id: "remaining", label: t("ux.map.card.remaining"), value: fc(totals.remaining), sub: t("ux.map.card.remainingSub", { n: fc(totals.required) }), tone: "neutral" },
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="outcome-cards" aria-label={t("ux.map.cardsAria")}>
      {cards.map((c, i) => (
        <li key={c.id} className={cn("min-w-0 rounded-2xl border border-student-line bg-student-card p-4 shadow-[0_1px_2px_hsl(var(--s-ink)/0.04)]", i === 0 && "col-span-2 sm:col-span-1")} data-testid={`outcome-${c.id}`}>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-student-muted">
            {c.tone && c.tone !== "neutral" && <Swatch basis={c.tone} />}
            <span className="min-w-0 break-words">{c.label}</span>
          </p>
          <p className="mt-1.5 font-serif text-3xl leading-none tracking-tight text-student-ink tnum">{c.value}</p>
          <p className="mt-1.5 text-xs leading-snug text-student-muted">{c.sub}</p>
        </li>
      ))}
    </ul>
  );
}

function Legend() {
  const { t } = useT();
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-student-ink" data-testid="status-legend" aria-label={t("ux.map.legendAria")}>
      {BASIS_ORDER.map((b) => (
        <li key={b} className="inline-flex items-center gap-2"><Swatch basis={b} />{t(`ux.status.${b}` as TranslationKey)}</li>
      ))}
    </ul>
  );
}

function shortMonth(ym: string, lang: "en" | "fr"): string {
  const t = Date.parse(`${ym}-01T00:00:00Z`);
  if (Number.isNaN(t)) return ym;
  return new Date(t).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function Timeline({ view, groups, today }: { view: StudentHighSchoolView; groups: readonly MapGroup[]; today: string }) {
  const { t, language, formatCredits: fc } = useT();
  const lang = language === "fr" ? "fr" : "en";
  const accelerated = useMemo(() => isAcceleratedPlan(groups), [groups]);
  const bands = useMemo(() => (accelerated ? buildPhaseBands(groups) : []), [accelerated, groups]);
  const months = useMemo(() => (accelerated ? [] : buildMonthBand(view, today)), [accelerated, view, today]);
  if (!accelerated && months.length === 0) return null;
  return (
    <section className="rounded-2xl border border-student-line bg-student-card p-4 sm:p-5" aria-labelledby="map-timeline" data-testid="timeline-band" data-mode={accelerated ? "accelerated" : "months"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="map-timeline" className="font-serif text-xl tracking-tight text-student-ink">{accelerated ? t("ux.timeline.accelerated") : t("ux.timeline.months")}</h3>
        <p className="text-xs text-student-muted">{accelerated ? t("ux.timeline.note") : t("ux.timeline.monthsNote")}</p>
      </div>
      {accelerated ? (
        <ol className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {bands.map((b, i) => (
            <li key={b.id} className="min-w-0 rounded-xl border border-student-line bg-student-bg p-3" data-testid={`band-${b.id}`}>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-student-gold-ink">{t("ux.timeline.weeks", { from: b.from, to: b.to })}</p>
              <p className="mt-1 font-serif text-2xl leading-none text-student-ink tnum" data-testid={`band-${b.id}-cumulative`}>{fc(b.cumulative)}<span className="ml-1 text-sm font-sans text-student-muted">{t("ux.timeline.cumulative")}</span></p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-student-line" aria-hidden="true"><i className="block h-full bg-student-gold" style={{ width: `${view.credits.requiredHalfUnits > 0 ? Math.min(100, (b.cumulative / view.credits.requiredHalfUnits) * 100) : 0}%` }} /></div>
              <p className="mt-2 text-xs leading-snug text-student-muted">
                {b.courses.length === 0 ? "—" : b.courses.slice(0, 3).map((c) => displayTitle(c.title)).join(", ")}
                {b.courses.length > 3 ? ` +${b.courses.length - 3}` : ""}
              </p>
              {i === bands.length - 1 && <span className="sr-only">{t("ux.timeline.final")}</span>}
            </li>
          ))}
        </ol>
      ) : (
        <ol className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-12" data-testid="month-cells">
          {months.map((m) => (
            <li key={m.month} className={cn("min-w-0 rounded-xl border p-2 text-center", m.state === "current" ? "border-student-gold bg-student-gold-soft" : m.state === "missed" ? "border-st-attention bg-st-attention-soft" : "border-student-line bg-student-bg")} data-state={m.state}>
              <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-student-muted">{shortMonth(m.month, lang)}</p>
              <p className="mt-0.5 font-serif text-xl leading-none text-student-ink tnum">{fc(m.cumulativeHalfUnits)}</p>
              <p className="mt-1 flex items-center justify-center gap-1 text-[11px] text-student-muted">
                {m.state === "reached" && <Check className="h-3 w-3 text-st-official" aria-hidden="true" />}
                {m.state === "missed" && <AlertTriangle className="h-3 w-3 text-st-attention" aria-hidden="true" />}
                {m.state === "current" && <Clock className="h-3 w-3 text-student-gold-ink" aria-hidden="true" />}
                {t(`ux.month.${m.state}` as TranslationKey)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function CourseRow({ course, onOpen }: { course: HsCourseView; onOpen: (key: string) => void }) {
  const { t, language } = useT();
  const basis = courseBasis(course) ?? "planned";
  const lang = language === "fr" ? "fr" : "en";
  const window = plannedWindowText(course, lang, t);
  const awaits = course.kind === "elective" && electiveAwaitsApproval(course.title);
  const title = displayTitle(course.title);
  const inProgress = course.status === "in_progress";
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(course.key)}
        aria-label={t("ux.map.open", { title })}
        className="group flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-transparent px-2 py-2 text-left hover:border-student-line hover:bg-student-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink"
        data-testid="map-course" data-course-key={course.key} data-basis={basis}
      >
        <span aria-hidden="true" className={cn("h-9 w-1 shrink-0 rounded-full", basis === "verified" ? "bg-st-official" : basis === "reported" ? "bg-st-submitted" : inProgress ? "bg-st-progress" : "bg-st-notstarted/40")} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-snug text-student-ink">{title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusPill status={inProgress ? "progress" : BASIS_PILL[basis]} label={inProgress ? t("ux.status.inProgress") : t(`ux.status.${basis}` as TranslationKey)} className="px-2 py-0.5 text-[11px]" />
            {awaits && <StatusPill status="attention" label={t("ux.map.approval.pending")} className="px-2 py-0.5 text-[11px]" />}
            <span className="text-xs text-student-muted">{window ?? t("ux.map.course.noWindow")}</span>
          </span>
        </span>
        <span className="shrink-0 text-right text-xs leading-snug text-student-muted">
          <span className="block font-semibold text-student-ink tnum">{creditsLabel(course.halfUnits, language)}</span>
          {course.tasksTotal > 0 && <span className="block tnum">{t("ux.map.course.tasksShort", { done: course.tasksDone, total: course.tasksTotal })}</span>}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-student-gold-ink transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </button>
    </li>
  );
}

function GroupCard({ group, onOpen, filter }: { group: MapGroup; onOpen: (key: string) => void; filter: CreditBasis | "all" }) {
  const { t, language, formatCredits: fc } = useT();
  const label = subjectLabel(group.subject, language);
  const courses = group.courses.filter((c) => filter === "all" || courseBasis(c) === filter);
  if (courses.length === 0 && filter !== "all") return null;
  const total = group.requiredHalfUnits || group.verified + group.reported + group.planned;
  return (
    <section className="min-w-0 rounded-2xl border border-student-line bg-student-card p-4 shadow-[0_1px_2px_hsl(var(--s-ink)/0.04)] sm:p-5" aria-labelledby={`grp-${group.subject}`} data-testid="map-group" data-subject={group.subject}>
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <h3 id={`grp-${group.subject}`} className="font-serif text-xl leading-tight tracking-tight text-student-ink">{label}</h3>
          <p className="text-sm font-semibold text-student-ink tnum" data-testid="group-credits">{t("ux.map.group.progress", { verified: fc(group.verified), total: fc(total) })}</p>
        </div>
        <CreditBar verified={group.verified} reported={group.reported} planned={group.planned} total={total} label={t("ux.map.group.barAria", { label, verified: fc(group.verified), reported: fc(group.reported), planned: fc(group.planned), total: fc(total) })} />
        <p className="text-xs text-student-muted">
          {group.kind === "elective" ? t("ux.map.group.elective") : t("ux.map.group.core")}
          {group.tasksTotal > 0 ? ` · ${t("ux.map.group.tasks", { done: group.tasksDone, total: group.tasksTotal })}` : ""}
        </p>
      </header>
      {courses.length === 0 ? (
        <p className="mt-3 text-sm text-student-muted">{group.subject === "electives" ? t("hs.subjects.electivesPending") : t("hs.subjects.noCourses")}</p>
      ) : (
        <ul className="mt-3 space-y-1" aria-label={t("hs.subjects.coursesAria", { label })}>
          {courses.map((c) => <CourseRow key={c.key} course={c} onOpen={onOpen} />)}
        </ul>
      )}
    </section>
  );
}

export function DegreeMapView({ view, today, initialCourse = null }: { view: StudentHighSchoolView; today: string; initialCourse?: string | null }) {
  const { t, language, formatCredits: fc } = useT();
  const { totals, groups } = useMemo(() => buildDegreeMap(view), [view]);
  const [filter, setFilter] = useState<CreditBasis | "all">("all");
  const [open, setOpen] = useState<string | null>(initialCourse);
  const course = useMemo(() => groups.flatMap((g) => g.courses).find((c) => c.key === open) ?? null, [groups, open]);
  const alerts = view.attention.slice(0, 3);
  const filters: { id: CreditBasis | "all"; label: string }[] = [
    { id: "all", label: t("ux.map.filter.all") },
    ...BASIS_ORDER.slice().reverse().map((b) => ({ id: b, label: t(`ux.status.${b}` as TranslationKey) })),
  ];
  return (
    <div className="space-y-5" data-testid="degree-map">
      <div className="space-y-1">
        <h2 className="font-serif text-2xl tracking-tight text-student-ink sm:text-3xl">{t("ux.map.title")}</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-student-muted">{t("ux.map.intro", { total: fc(totals.required), core: fc(totals.coreRequired), elective: fc(totals.electiveRequired) })}</p>
      </div>

      <OutcomeCards totals={totals} />

      <section className="rounded-2xl border border-student-line bg-student-card p-4 sm:p-5" aria-label={t("ux.map.overallAria")} data-testid="overall-bar">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm font-semibold text-student-ink tnum">{t("ux.map.overall", { verified: fc(totals.verified), total: fc(totals.required) })}</p>
          <Legend />
        </div>
        <CreditBar className="mt-2.5 h-3" verified={totals.verified} reported={totals.reported} planned={totals.planned} total={totals.required} label={t("ux.map.overallBarAria", { verified: fc(totals.verified), reported: fc(totals.reported), planned: fc(totals.planned), total: fc(totals.required) })} />
        <p className="mt-2 text-xs text-student-muted">{t("ux.map.officialNote", { school: view.enrollment.schoolDisplayName })}</p>
      </section>

      {alerts.length > 0 && (
        <ul className="space-y-2" data-testid="map-warnings" aria-label={t("hs.journey.needsAttention")}>
          {alerts.map((a, i) => {
            const v = attentionView(a, language);
            return (
              <li key={`${a.kind}-${i}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-st-attention bg-st-attention-soft px-4 py-2.5 text-sm text-student-ink">
                <span className="flex min-w-0 items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-st-attention" aria-hidden="true" /><span><b>{v.title}.</b>{v.detail ? ` ${v.detail}` : ""}</span></span>
                {a.courseKey && <button type="button" className="inline-flex min-h-[36px] items-center gap-1 font-medium text-student-gold-ink underline underline-offset-4" onClick={() => setOpen(a.courseKey)}>{t("ux.map.openCourse")}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>}
              </li>
            );
          })}
        </ul>
      )}

      <Timeline view={view} groups={groups} today={today} />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2" role="group" aria-label={t("ux.map.filterAria")}>
        <h3 className="font-serif text-xl tracking-tight text-student-ink">{t("ux.map.courses", { n: totals.courseCount })}</h3>
        <div className="flex flex-wrap gap-2" data-testid="map-filters">
          {filters.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={cn("inline-flex min-h-[40px] items-center rounded-full border px-3.5 text-sm font-medium", filter === f.id ? "border-student-seal bg-student-seal text-student-seal-ink" : "border-student-line-strong bg-student-card text-student-ink hover:bg-student-gold-soft")} data-testid={`filter-${f.id}`}>{f.label}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2" data-testid="map-groups">
        {groups.map((g) => <GroupCard key={g.subject} group={g} onOpen={setOpen} filter={filter} />)}
      </div>

      <p className="text-xs leading-relaxed text-student-muted" data-testid="map-sources">
        {t("ux.map.sources", { version: view.roadmap?.versionNumber ?? 0, date: formatShortDate(view.roadmap?.publishedAt?.slice(0, 10) ?? null, language) ?? "" })}{" "}
        <Link href="/library" className="font-medium text-student-gold-ink underline underline-offset-4">{t("ux.map.libraryLink")}</Link>
      </p>

      <CourseDrawer course={course} schoolLine={view.enrollment.schoolDisplayName} today={today} onClose={() => setOpen(null)} />
    </div>
  );
}
