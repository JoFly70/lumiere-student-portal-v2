/**
 * High School cockpit (S19): one-page overview of the student's academic journey.
 * Pure presentation: takes the AcademicProjection plus the already-resolved operational sources (documents, support,
 * payments) as props, so it can be rendered in tests and screenshots without a network. All strings via useT().
 */
import React, { useMemo, useState } from "react";
import { Link } from "wouter";
void React;
import { AlertTriangle, ArrowRight, Check, ChevronDown, CreditCard, FileText, LifeBuoy } from "lucide-react";
import type { AcademicProjection, AcademicSubject } from "@shared/academic-projection-contract";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import { MODE_OPTIONS, tallyOf, subjectTally, CREDIT_STATUSES, type CreditStatus, type Tally, type ViewMode } from "@/lib/academic-flight-deck-presentation";
import {
  OPS_LOADING,
  buildCockpitActions,
  buildCockpitMilestones,
  buildCoverageBars,
  buildHero,
  buildStanding,
  buildSubjectBars,
  coursesByBasis,
  formatMoneyLocale,
  type CockpitAction,
  type CockpitOps,
  type HeroModel,
  type OpsSource,
  type T,
} from "./model";

function useFormatters() {
  const { t, language, formatCredits } = useT();
  const date = useMemo(() => new Intl.DateTimeFormat(language, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }), [language]);
  const month = useMemo(() => new Intl.DateTimeFormat(language, { month: "short", year: "numeric", timeZone: "UTC" }), [language]);
  return {
    t,
    language,
    fc: formatCredits,
    day: (iso: string) => {
      const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
      return Number.isNaN(d.getTime()) ? iso : date.format(d);
    },
    month: (ym: string) => {
      const d = new Date(`${ym}-01T00:00:00Z`);
      return Number.isNaN(d.getTime()) ? ym : month.format(d);
    },
    money: (cents: number, currency: string) => formatMoneyLocale(cents, currency, language),
  };
}

// ---------------------------------------------------------------------------------------------- gauge

const SIZE = 240, C = 120, R = 98, START = 135, SWEEP = 270, GAP = 1.2;
const pt = (a: number, r = R): [number, number] => [C + r * Math.cos((a * Math.PI) / 180), C + r * Math.sin((a * Math.PI) / 180)];
const arcPath = (from: number, to: number, r = R) => {
  const [x0, y0] = pt(from, r), [x1, y1] = pt(to, r);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
const SEG: Record<string, { stroke: string; dash?: string; opacity?: number; width: number }> = {
  official: { stroke: "var(--t-green)", width: 16 },
  awaiting_school: { stroke: "var(--t-amber)", dash: "2 2.5", width: 16 },
  in_progress: { stroke: "var(--t-blue)", width: 16 },
  planned: { stroke: "var(--t-text-2)", dash: "5 3", opacity: 0.6, width: 16 },
};

export function CockpitGauge({ hero }: { hero: HeroModel }) {
  const total = hero.tally.required;
  const ang = (n: number) => START + (SWEEP * n) / total;
  const ticks = Array.from({ length: Math.floor(total / 2) + 1 }, (_, i) => ang(i * 2));
  return (
    <div className="ck-gauge" data-testid="credit-gauge">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={hero.aria}>
        <path d={arcPath(START, START + SWEEP)} className="ck-track" strokeWidth={16} />
        {ticks.map((a, i) => {
          const [x0, y0] = pt(a, R - 15), [x1, y1] = pt(a, R - 20);
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} className="ck-tick" />;
        })}
        {hero.segments.map((s) =>
          s.halfUnits > 0 && s.visible ? (
            <path key={s.status} data-segment={s.status} d={arcPath(ang(s.from) + GAP / 2, ang(s.to) - GAP / 2)} fill="none" stroke={SEG[s.status]!.stroke} strokeWidth={SEG[s.status]!.width} strokeDasharray={SEG[s.status]!.dash} opacity={SEG[s.status]!.opacity} />
          ) : null,
        )}
      </svg>
      <div className="ck-gauge-center">
        <div className="ck-figure" data-testid="gauge-value">{hero.figure}</div>
        <div className="ck-of" data-testid="gauge-of">{hero.of}</div>
        <div className="ck-cap">{hero.caption}</div>
      </div>
    </div>
  );
}

function Swatch({ status }: { status: CreditStatus }) {
  return <i className="fdp-swatch" data-s={status} aria-hidden="true" />;
}

function StackBar({ tally, mode, label }: { tally: Tally; mode: ViewMode; label: string }) {
  const parts = CREDIT_STATUSES.filter((s) => s !== "open" && tally[s] > 0 && (mode === "projected" || s === "official"));
  return (
    <div className="fdp-bar ck-bar" role="img" aria-label={label}>
      {parts.map((s) => <i key={s} className="fdp-cell" data-s={s} style={{ width: `${(tally[s] / tally.required) * 100}%` }} />)}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- collapsible (mobile only)

function Section({ id, title, note, children, className = "", collapsibleOnMobile = true, defaultOpen = false }: { id: string; title: string; note?: React.ReactNode; children: React.ReactNode; className?: string; collapsibleOnMobile?: boolean; defaultOpen?: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`ck-card ${className}`} data-open={open} data-collapsible={collapsibleOnMobile} aria-labelledby={`ck-${id}`} data-testid={`section-${id}`}>
      <header className="ck-card-head">
        <h2 id={`ck-${id}`} className="ck-card-title">{title}</h2>
        {note && <span className="ck-card-note">{note}</span>}
        {collapsibleOnMobile && (
          <button type="button" className="ck-toggle" aria-expanded={open} aria-controls={`ck-body-${id}`} onClick={() => setOpen(!open)} aria-label={t(open ? "cockpit.section.hide" : "cockpit.section.show", { title })} data-testid={`toggle-${id}`}>
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="ck-card-body" id={`ck-body-${id}`}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- pulse

function PulseCell({ href, icon, title, source, testId, render }: { href: string; icon: React.ReactNode; title: string; source: OpsSource<any>; testId: string; render: (data: any) => { text: string; attention: boolean; sub?: string } }) {
  const { t } = useT();
  let text: string, attention = false, sub: string | undefined, state: string = source.state;
  if (source.state === "ready") ({ text, attention, sub } = render(source.data));
  else if (source.state === "not_set_up") text = t("cockpit.ops.notSetUp");
  else if (source.state === "unavailable") text = t("cockpit.ops.unavailable");
  else text = t("cockpit.ops.loading");
  return (
    <Link href={href} className="ck-pulse" data-attention={attention} data-source={state} data-testid={testId}>
      <span className="ck-pulse-icon" aria-hidden="true">{attention ? <AlertTriangle className="h-4 w-4" /> : icon}</span>
      <span className="ck-pulse-main">
        <span className="ck-pulse-title">{title}</span>
        <span className="ck-pulse-text" data-testid={`${testId}-text`}>{text}</span>
        {sub && <span className="ck-pulse-sub">{sub}</span>}
      </span>
      <ArrowRight className="h-4 w-4 ck-pulse-go" aria-hidden="true" />
    </Link>
  );
}

function Pulse({ ops }: { ops: CockpitOps }) {
  const { t, day, money } = useFormatters();
  return (
    <div className="ck-pulse-row" role="group" aria-label={t("cockpit.pulse.title")} data-testid="pulse-row">
      <PulseCell href="/documents" icon={<FileText className="h-4 w-4" />} title={t("cockpit.pulse.documents")} source={ops.documents} testId="pulse-documents"
        render={(d) => d.needAction > 0 ? { text: t("cockpit.docs.needAction", { n: d.needAction }), attention: true, sub: d.underReview > 0 ? t("cockpit.docs.review", { n: d.underReview }) : undefined }
          : d.underReview > 0 ? { text: t("cockpit.docs.review", { n: d.underReview }), attention: false }
          : { text: d.total === 0 ? t("cockpit.docs.none") : t("cockpit.docs.clear"), attention: false }} />
      <PulseCell href="/support" icon={<LifeBuoy className="h-4 w-4" />} title={t("cockpit.pulse.support")} source={ops.support} testId="pulse-support"
        render={(d) => d.waitingOnStudent > 0 ? { text: t("cockpit.support.waiting", { n: d.waitingOnStudent }), attention: true, sub: t("cockpit.support.open", { n: d.open }) }
          : d.open > 0 ? { text: t("cockpit.support.open", { n: d.open }), attention: false } : { text: t("cockpit.support.none"), attention: false }} />
      <PulseCell href="/billing" icon={<CreditCard className="h-4 w-4" />} title={t("cockpit.pulse.payments")} source={ops.payments} testId="pulse-payments"
        render={(d) => d.nextDue
          ? { text: t("cockpit.pay.next", { amount: money(d.nextDue.amountCents, d.currency), date: day(d.nextDue.dueDate) }), attention: d.overdue, sub: d.overdue ? t("cockpit.pay.overdue") : t("cockpit.pay.balance", { amount: money(d.remainingCents, d.currency) }) }
          : { text: t("cockpit.pay.none"), attention: false, sub: d.evidenceUnderReview > 0 ? t("cockpit.pay.review", { n: d.evidenceUnderReview }) : undefined }} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- actions

function Actions({ actions }: { actions: CockpitAction[] }) {
  const { t } = useT();
  if (actions.length === 0) return <p className="ck-empty" data-testid="actions-empty">{t("cockpit.actions.empty")}</p>;
  return (
    <ol className="ck-actions" data-testid="next-actions">
      {actions.map((a, i) => (
        <li key={a.key}>
          <Link href={a.href} className="ck-action" data-attention={a.attention} data-testid={`action-${i}`}>
            <span className="ck-action-n tnum" aria-hidden="true">{i + 1}</span>
            <span className="ck-action-main">
              <span className="ck-action-msg">{a.message}</span>
              <span className="ck-action-meta">{a.kindLabel}{a.due ? ` · ${a.due}` : ""}{a.waitingOnLumiere ? ` · ${t("cockpit.actions.owner.lumiere")}` : ""}</span>
            </span>
            <ArrowRight className="h-4 w-4 ck-pulse-go" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------------------------- subject drawer

function SubjectSheet({ projection, subject, onClose }: { projection: AcademicProjection; subject: AcademicSubject | null; onClose: () => void }) {
  const { t, fc, day } = useFormatters();
  const tally = subject ? subjectTally(projection, subject) : null;
  const hu = (n: number) => t(n === 1 ? "cockpit.sheet.halfUnit" : "cockpit.sheet.halfUnits", { n });
  const areas = subject ? projection.credits.byArea.filter((a) => a.subject === subject.subject) : [];
  const allElective = areas.length > 0 && areas.every((a) => a.kind === "elective");
  return (
    <Sheet open={!!subject} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="fdp-sheet" data-testid="subject-sheet">
        {subject && tally && (
          <>
            <SheetHeader className="fdp-sheet-head space-y-0 text-left">
              <SheetTitle className="fdp-sheet-title">{subject.label}</SheetTitle>
              <SheetDescription className="fdp-sheet-sub">
                {t(allElective ? "cockpit.sheet.kind.elective" : "cockpit.sheet.kind.core")} · {t("cockpit.sheet.credits", { n: fc(tally.required) })} ({hu(tally.required)})
              </SheetDescription>
            </SheetHeader>
            <div className="fdp-sheet-body">
              <section>
                <h3>{t("cockpit.sheet.courses")}</h3>
                {subject.courses.length === 0 ? (
                  <p className="fdp-sheet-note" data-testid="sheet-no-courses">{t("cockpit.sheet.noCourses")}</p>
                ) : (
                  <ul data-testid="sheet-courses">
                    {subject.courses.map((c) => {
                      const st: CreditStatus = c.basis === "not_counted" ? "open" : c.basis;
                      return (
                        <li key={c.key} className="fdl-course" data-basis={st} data-testid="sheet-course">
                          <div className="fdp-course" style={{ borderTop: 0 }}>
                            <Swatch status={st} />
                            <div>
                              <div className="fdp-course-title">{c.title}</div>
                              <div className="fdp-course-status">{t(`cockpit.status.${st}`)}</div>
                              <div className="fdp-course-status">{c.tasksTotal > 0 ? t("cockpit.sheet.tasks", { done: c.tasksDone, total: c.tasksTotal }) : t("cockpit.sheet.noTasks")}</div>
                            </div>
                            <div className="fdp-course-hu tnum">{hu(c.halfUnits)}<small>{t("cockpit.sheet.credits", { n: fc(c.halfUnits) })}</small></div>
                          </div>
                          {c.tasks.length > 0 && (
                            <div className="fdl-tasks"><ul>
                              {c.tasks.map((k) => (
                                <li key={k.key} data-testid="sheet-task" data-overdue={k.overdue}>
                                  <span>{k.title}</span>
                                  <span className="fdl-task-state">{k.dueDate ? day(k.dueDate) : ""}{k.overdue ? ` · ${t("cockpit.sheet.overdue")}` : ""}</span>
                                </li>
                              ))}
                            </ul></div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <Link href="/high-school" className="fdl-sheet-link" data-testid="sheet-link-high-school">{t("cockpit.link.openHighSchool")}</Link>
              </section>
              <section>
                <h3>{t("cockpit.sheet.math")}</h3>
                <div className="fdp-math tnum" data-testid="subject-math">
                  {CREDIT_STATUSES.map((s) => (
                    <div key={s} className="fdp-math-row" data-status={s}><span><Swatch status={s} />{t(`cockpit.status.${s}`)}</span><span>{hu(tally[s])}</span></div>
                  ))}
                  <div className="fdp-math-row total"><span>{t("cockpit.sheet.required")}</span><span>{hu(tally.required)} = {t("cockpit.sheet.credits", { n: fc(tally.required) })}</span></div>
                </div>
              </section>
              <p className="fdp-sheet-note">{t("cockpit.sheet.note")}</p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------- view

export interface CockpitViewProps {
  projection: AcademicProjection;
  firstName?: string | null;
  ops?: CockpitOps;
  initialMode?: ViewMode;
  initialSubject?: string | null;
}

const STANDING_ICON: Record<string, string> = { good: "good", warn: "warn", info: "info", neutral: "neutral" };

export function CockpitView({ projection, firstName, ops = OPS_LOADING, initialMode = "verified", initialSubject = null }: CockpitViewProps) {
  const f = useFormatters();
  const { t, fc } = f;
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [openSubject, setOpenSubject] = useState<string | null>(initialSubject);
  const hero = useMemo(() => buildHero(projection, mode, t as T, fc), [projection, mode, t, fc]);
  const standing = useMemo(() => buildStanding(projection, t as T, fc), [projection, t, fc]);
  const coverage = useMemo(() => buildCoverageBars(projection, mode, t as T, fc), [projection, mode, t, fc]);
  const subjects = useMemo(() => buildSubjectBars(projection, mode, t as T, fc), [projection, mode, t, fc]);
  const milestones = useMemo(() => buildCockpitMilestones(projection, fc), [projection, fc]);
  const actions = useMemo(() => buildCockpitActions(projection, ops, t as T, { date: f.day, money: f.money }), [projection, ops, t, f.language]); // eslint-disable-line react-hooks/exhaustive-deps
  const inProgress = coursesByBasis(projection, "in_progress");
  const awaiting = coursesByBasis(projection, "awaiting_school");
  const subject = projection.subjects.find((s) => s.subject === openSubject) ?? null;
  const school = projection.program.schoolDisplayName;
  const nextMilestone = milestones.find((m) => m.state === "current");
  const top = actions[0];

  return (
    <div className="ck" data-testid="high-school-flight-deck" data-deck-state={hero.state} data-mode={mode}>
      {/* RESERVED SLOT: future text assistant (data-slot="academic-assistant"). Empty, invisible, not interactive. */}
      <div className="fdl-assistant-slot" data-slot="academic-assistant" data-testid="academic-assistant-slot" aria-hidden="true" />

      <header className="ck-top">
        <div className="ck-top-main">
          <p className="ck-eyebrow">{t("cockpit.eyebrow")}</p>
          <h1 className="ck-h1" data-testid="greeting">{firstName ? t("cockpit.greeting", { name: firstName }) : t("cockpit.greetingAnon")}</h1>
          <p className="ck-program" data-testid="program-line">{projection.program.title} · {school}</p>
        </div>
        <div className="ck-top-side">
          <p className="ck-standing" data-tone={STANDING_ICON[standing.tone]} data-testid="standing">
            <i className="ck-dot" aria-hidden="true" />
            <span><b>{standing.label}</b>{standing.detail && <small>{standing.detail}</small>}</span>
          </p>
          <div className="fdp-seg ck-seg" role="radiogroup" aria-label={t("cockpit.mode.label")} data-testid="mode-toggle">
            {MODE_OPTIONS.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)} data-testid={`mode-${m.id}`}>
                {t(m.id === "verified" ? "cockpit.mode.verified" : "cockpit.mode.projected")}
              </button>
            ))}
          </div>
        </div>
      </header>

      {top && (
        <Link href={top.href} className="ck-next" data-attention={top.attention} data-testid="next-item">
          <span className="ck-next-kind">{top.kindLabel}</span>
          <span className="ck-next-msg">{top.message}</span>
          {top.due && <span className="ck-next-due">{top.due}</span>}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}

      <div className="ck-grid">
        <section className="ck-card ck-hero" aria-labelledby="ck-hero-title" data-testid="hero">
          <h2 id="ck-hero-title" className="sr-only">{t("cockpit.coverage.title")}</h2>
          <CockpitGauge hero={hero} />
          <div className="ck-hero-side">
            <p className="ck-percent tnum" data-testid="hero-percent">{t("cockpit.hero.percent", { pct: hero.percent })}</p>
            <p className="ck-left tnum" data-testid="hero-left">{hero.leftText}</p>
            <ul className="ck-legend" data-testid="status-legend">
              {hero.legend.map((l) => (
                <li key={l.status} data-dim={l.dim} data-status={l.status}>
                  <Swatch status={l.status} /><span>{l.label}</span><b className="tnum" data-testid={`legend-${l.status}`}>{l.value}</b>
                </li>
              ))}
            </ul>
            {mode === "projected" && <p className="ck-note" data-testid="projected-note">{t("cockpit.hero.projectedNote", { official: fc(hero.tally.official) })}</p>}
          </div>
        </section>

        <section className="ck-card ck-cover" aria-labelledby="ck-cover-title" data-testid="coverage">
          <header className="ck-card-head"><h2 id="ck-cover-title" className="ck-card-title">{t("cockpit.coverage.title")}</h2></header>
          <div className="ck-card-body ck-open">
            {coverage.map((b) => (
              <div key={b.key} data-testid={`coverage-${b.key}`}>
                <div className="fdp-bar-top"><span className="fdp-bar-name">{b.label}</span><span className="fdp-bar-val tnum">{b.text}</span></div>
                <StackBar tally={b.tally} mode={mode} label={`${b.label}: ${b.text}`} />
              </div>
            ))}
            <p className="ck-config" data-testid="program-config">{hero.config}</p>
            <div className="ck-ms" data-testid="next-milestone">
              <span className="ck-ms-label">{milestones.length === 0 ? t("cockpit.milestones.title") : nextMilestone ? t("cockpit.milestone.next") : t("cockpit.milestones.title")}</span>
              {milestones.length === 0 ? <span>{t("cockpit.milestones.empty")}</span>
                : nextMilestone ? <span><b className="tnum">{t("cockpit.milestone.title", { credits: nextMilestone.credits, month: f.month(nextMilestone.month) })}</b><small className="tnum">{t("cockpit.milestone.gap", { n: nextMilestone.gap ?? "" })}</small></span>
                : <span className="ck-ms-done"><Check className="h-3 w-3" aria-hidden="true" />{t("cockpit.milestones.allReached")}</span>}
            </div>
            <Link href="/high-school" className="ck-more" data-testid="link-plan">{t("cockpit.link.plan")}<ArrowRight className="h-3 w-3" aria-hidden="true" /></Link>
          </div>
        </section>

        <section className="ck-card ck-todo" aria-labelledby="ck-todo-title" data-testid="actions">
          <header className="ck-card-head"><h2 id="ck-todo-title" className="ck-card-title">{t("cockpit.actions.title")}</h2></header>
          <div className="ck-card-body ck-open"><Actions actions={actions} /></div>
        </section>
      </div>

      <Pulse ops={ops} />

      <div className="ck-grid ck-grid-2">
        <Section id="subjects" title={t("cockpit.subjects.title")} note={t("cockpit.subjects.hint")} className="ck-subjects">
          {subjects.length === 0 ? <p className="ck-empty" data-testid="subjects-empty">{t("cockpit.subjects.empty")}</p> : (
            <div className="ck-subj-list" data-testid="subject-strips">
              {subjects.map((s) => (
                <button key={s.subject} type="button" className="ck-subj" onClick={() => setOpenSubject(s.subject)} aria-label={s.aria} data-testid={`subject-${s.subject}`}>
                  <span className="ck-subj-label">{s.label}</span>
                  <span className="ck-subj-val tnum">{s.text}</span>
                  <StackBar tally={s.tally} mode={mode} label={s.text} />
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section id="in-progress" title={t("cockpit.inProgress.title")} className="ck-inprog">
          {inProgress.length === 0 ? <p className="ck-empty" data-testid="inprogress-empty">{t("cockpit.inProgress.empty")}</p> : (
            <ul className="ck-courses" data-testid="in-progress-list">
              {inProgress.map((c) => (
                <li key={c.key}><Swatch status="in_progress" /><span className="ck-c-title">{c.title}</span>
                  <small className="tnum">{c.tasksTotal > 0 ? t("cockpit.inProgress.tasks", { done: c.tasksDone, total: c.tasksTotal }) : fc(c.halfUnits)}</small></li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="awaiting" title={t("cockpit.awaiting.title")} className="ck-await">
          {awaiting.length === 0 ? <p className="ck-empty" data-testid="awaiting-empty">{t("cockpit.awaiting.empty")}</p> : (
            <>
              <ul className="ck-courses" data-testid="awaiting-list">
                {awaiting.map((c) => <li key={c.key}><Swatch status="awaiting_school" /><span className="ck-c-title">{c.title}</span><small className="tnum">{fc(c.halfUnits)}</small></li>)}
              </ul>
              <p className="ck-note">{t("cockpit.awaiting.note")}</p>
            </>
          )}
        </Section>
      </div>

      <footer className="ck-foot" data-testid="provenance">
        <p>
          {projection.provenance.planVersion === null
            ? t("cockpit.footer.noPlan", { school, date: f.day(projection.generatedAt) })
            : t("cockpit.footer.provenance", { school, version: projection.provenance.planVersion, date: f.day(projection.generatedAt) })}
        </p>
        <p>{t("cockpit.footer.official", { school })}</p>
      </footer>

      <SubjectSheet projection={projection} subject={subject} onClose={() => setOpenSubject(null)} />
    </div>
  );
}
