/**
 * S27 Flight Deck cockpit for high-school students. Prop-driven (the container below feeds it from the real hooks), so it
 * renders from fixtures. Reads: StudentHighSchoolView (official credits, plan), StudentJourneyView (agreement deadlines,
 * checkpoints, logged pace; may be null when the endpoint is not ready), documents, tickets and billing summaries.
 * Read-only apart from "Ask Lumière to plan this pace", which creates an ordinary Support request.
 */
import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import type { StudentHighSchoolView } from "@shared/high-school-contract";
import type { StudentJourneyView } from "@shared/s27-contract";
import { useToast } from "@/hooks/use-toast";
import { buildDegreeMap, buildPhaseBands, isAcceleratedPlan, openTasks, findCourse } from "@/lib/degree-map";
import { subjectLabel } from "@/pages/high-school-presentation";
import { courseName } from "@/lib/s27/roadmap-model";
import {
  PACE_MAX, PACE_MIN, PACE_PRESETS, PACE_STEP, actualPace, buildAlertCards, buildFlightStops, buildRadarChips, clampPace,
  creditFigures, deadlinesToWatch, estimatedArrival, plannerOutputs, presetValue, roundPace, scheduleDelta, stopEstimate, toCredits, weekOfProgram,
  type TicketLike,
} from "@/lib/s27/cockpit-model";
import { daysBetween, formatDay } from "@/lib/s27/dates";
import { useS27T } from "@/lib/s27/i18n-util";
import { useSupportRequest } from "@/lib/s27/use-support-request";
import type { TranslationKey } from "@/i18n";
import { S27Page, Eyebrow } from "./ui";
import {
  AlertCardView, AskCard, BillingCard, CheckpointsCard, CreditsGaugeCard, DeckHead, DocumentsCard, HS_DECK_LINKS, RadarChipView, UpNextCard, WeekCard,
  type CreditRow, type DeckBilling, type DeckDoc, type JourneyState, type NextItem,
} from "./deck-parts";
import { FlightInstrument, type GhostRun, type InstrumentStop } from "./flight-instrument";

export type { DeckBilling, DeckDoc, JourneyState };

export interface FlightDeckProps {
  readonly view: StudentHighSchoolView;
  readonly journey: StudentJourneyView | null;
  readonly journeyState: JourneyState;
  readonly firstName: string | null;
  readonly documents: readonly DeckDoc[] | null | "loading";
  readonly tickets: readonly TicketLike[] | null;
  readonly billing: DeckBilling;
  readonly today: string;
  /** Local hour (0-23) for the greeting. */
  readonly hour: number;
}

export function FlightDeckS27(props: FlightDeckProps) {
  const { view, journey, journeyState, firstName, documents, tickets, billing, today, hour } = props;
  const { t, lang, pl, num } = useS27T();
  const figures = useMemo(() => creditFigures(view), [view]);
  const agreement = journey?.agreement ?? null;
  const day = (iso: string | null | undefined, style: "short" | "weekday" | "long" = "short") => formatDay(iso, lang, style);

  const open = useMemo(() => openTasks(view), [view]);
  const nextTask = useMemo(() => {
    const overdue = open.find((x) => x.overdue);
    return overdue ?? view.current.nextTask ?? open[0] ?? null;
  }, [open, view.current.nextTask]);
  const nextCourse = nextTask ? findCourse(view, nextTask.courseKey) : null;

  const cards = useMemo(
    () => buildAlertCards({
      nextTask: nextTask ? { title: nextTask.title, courseKey: nextTask.courseKey, courseTitle: courseName(nextTask.courseTitle), dueDate: nextTask.dueDate } : null,
      agreement, today,
    }),
    [nextTask, agreement, today],
  );

  const electivesAwaiting = useMemo(() => view.subjects.flatMap((s) => s.courses).filter((c) => /TEST ONLY|APPROVAL PENDING|PROPOSED/i.test(c.title) && c.status !== "replaced").length, [view]);
  const radar = useMemo(
    () => buildRadarChips({
      electivesAwaiting,
      coursesAwaitingSchool: view.subjects.flatMap((s) => s.courses).filter((c) => c.status === "awaiting_school").length,
      journey, tickets, today,
    }),
    [electivesAwaiting, view.subjects, journey, tickets, today],
  );

  const week = weekOfProgram(view.enrollment.startedOn, view.enrollment.targetCompletionDate, today);
  const watch = deadlinesToWatch(agreement);
  const paceKey = view.pace.status === "not_configured" ? null : (`s27.fd.pill.${view.pace.status}` as TranslationKey);

  const nextItem: NextItem | null = nextTask
    ? { title: nextTask.title, courseName: courseName(nextTask.courseTitle), credits: nextCourse ? toCredits(nextCourse.halfUnits) : null, dueDate: nextTask.dueDate, courseKey: nextTask.courseKey }
    : null;
  const agenda = useMemo(() => open.map((o) => ({ courseKey: o.courseKey, courseTitle: courseName(o.courseTitle), key: o.key, title: o.title, dueDate: o.dueDate, overdue: o.overdue })), [open]);

  return (
    <S27Page testId="hs-flight-deck">
      <DeckHead firstName={firstName} hour={hour}>
        {watch > 0 && <span className="pill warn"><i />{pl("s27.fd.pill.deadline", watch)}</span>}
        {paceKey && <span className={`pill ${view.pace.status === "behind" ? "warn" : "ok"}`}><i />{t(paceKey)}</span>}
        {week && <span className="pill">{t("s27.fd.pill.week", { week: week.week, total: week.total })}</span>}
      </DeckHead>

      {journeyState === "unavailable" && <p className="notice" data-testid="fd-journey-pending">{t("s27.fd.journeyPending")}</p>}
      {journeyState === "failed" && <p className="notice warn" role="status" data-testid="fd-journey-error">{t("s27.fd.journeyError")}</p>}

      {cards.length > 0 && (
        <section aria-label={t("s27.fd.countdowns")} className="alerts" data-testid="fd-alerts">
          {cards.map((c) => <AlertCardView key={c.key} card={c} credits={nextCourse ? toCredits(nextCourse.halfUnits) : null} accessMonths={agreement?.accessMonths ?? null} links={HS_DECK_LINKS} />)}
        </section>
      )}

      {radar.length > 0 && (
        <div className="radar" data-testid="fd-radar">
          <span className="lbl">{t("s27.radar.label")}</span>
          {radar.map((c) => <RadarChipView key={c.key} chip={c} journey={journey} />)}
        </div>
      )}

      <div className="deck-grid">
        <div className="colst">
          <FlightCard {...props} figures={figures} />
          <div className="pair">
            <UpNextCard item={nextItem} links={HS_DECK_LINKS} />
            <WeekCard open={agenda} today={today} />
          </div>
          <AskCard />
        </div>
        <div className="colst">
          <CreditsCard view={view} figures={figures} />
          <CheckpointsCard journey={journey} journeyState={journeyState} />
          <DocumentsCard documents={documents} agreement={agreement} today={today} />
          <BillingCard billing={billing} />
        </div>
      </div>
      <p className="small">{t("s27.fd.footer")}</p>
    </S27Page>
  );
}

// ── flight card with the planner ────────────────────────────────────────────

function FlightCard(props: FlightDeckProps & { figures: ReturnType<typeof creditFigures> }) {
  const { view, journey, today, figures } = props;
  const { t, lang, pl, num } = useS27T();
  const { toast } = useToast();
  const support = useSupportRequest();
  const actual = actualPace(journey);
  const [scenario, setScenario] = useState<number | null>(null);
  const [planner, setPlanner] = useState(false);
  const [ghost, setGhost] = useState<GhostRun | null>(null);
  const [runs, setRuns] = useState(0);
  const slider = scenario ?? actual ?? 1.2;
  const shownPace = scenario ?? actual;
  const onActual = scenario === null;
  const fly = (pace: number) => { setRuns((r) => r + 1); setGhost({ runId: runs + 1, pace }); };
  const choose = (pace: number | null, play = true) => {
    const next = pace === null || (actual !== null && Math.abs(pace - actual) < 0.05) ? null : clampPace(pace);
    setScenario(next);
    if (play) fly(next ?? actual ?? 1.2);
  };

  const arrivalInfo = estimatedArrival(journey, view);
  const out = plannerOutputs({ today, startedOn: view.enrollment.startedOn, targetOn: view.enrollment.targetCompletionDate, remaining: figures.remaining, pace: slider });
  const infoArrival = shownPace ? plannerOutputs({ today, startedOn: null, targetOn: null, remaining: figures.remaining, pace: shownPace }).arrival : arrivalInfo.on;
  const delta = scheduleDelta(view);

  const stale = journey?.pace?.stale === true;
  const lastLogged = journey?.pace?.lastLoggedOn ?? null;
  const staleDays = lastLogged ? daysBetween(lastLogged, today) : null;

  // stops from the plan
  const { groups } = useMemo(() => buildDegreeMap(view), [view]);
  const bands = useMemo(() => (isAcceleratedPlan(groups) ? buildPhaseBands(groups) : null), [groups]);
  const stops = useMemo(() => buildFlightStops({
    required: figures.required, confirmed: figures.confirmed,
    bands: bands ? bands.map((b) => ({ from: b.from, to: b.to, cumulativeHalfUnits: b.cumulative })) : null,
    milestones: view.milestones ?? null,
  }), [figures.required, figures.confirmed, bands, view.milestones]);
  const bandCourses = (i: number) => (bands && bands[i] ? bands[i]!.courses.map((c) => courseName(c.title)).join(", ") : "");

  const instrumentStops: InstrumentStop[] = stops.map((s, i) => {
    const est = stopEstimate(today, figures.confirmed, s.credits, shownPace);
    const sub = s.reached ? t("s27.fi.stop.reached", { n: num(s.credits) }) : est ? t("s27.fi.stop.est", { n: num(s.credits), date: formatDay(est, lang) }) : t("s27.fi.stop.planned", { n: num(s.credits) });
    const plan = s.weeks ? t("s27.fi.stop.weeks", { from: s.weeks.from, to: s.weeks.to }) : s.month ? t("s27.fi.stop.month", { month: formatDay(`${s.month}-01`, lang, "monthYear") }) : "";
    return { id: s.id, credits: s.credits, reached: s.reached, name: t(`s27.fi.stop.${s.id}` as TranslationKey), sub, tipBody: [plan, bandCourses(i)].filter(Boolean).join(" · ") };
  });

  const arrivalOf = (pace: number) => plannerOutputs({ today, startedOn: null, targetOn: null, remaining: figures.remaining, pace }).arrival;
  const diplomaSub = infoArrival
    ? t(arrivalInfo.basis === "plan" && !shownPace ? "s27.fi.diplomaSubPlan" : "s27.fi.diplomaSub", { n: num(figures.required), date: formatDay(infoArrival, lang) })
    : t("s27.fi.diplomaSubNone", { n: num(figures.required) });

  const propose = async () => {
    const pace = slider;
    const arrival = out.arrival ? formatDay(out.arrival, lang, "long") : "";
    const res = await support.request({
      topic: "roadmap_question",
      subject: t("s27.pl.req.subject", { pace: num(pace) }),
      description: t("s27.pl.req.body", { pace: num(pace), left: num(figures.remaining), date: arrival, actual: actual ? num(actual) : t("s27.pl.req.actualNone") }),
    });
    if (res.ok) toast({ title: t("s27.pl.req.sent"), description: t("s27.pl.req.sentDetail", { n: res.ticketNumber }) });
    else toast({ title: t("s27.pl.req.failed"), description: res.message, variant: "destructive" });
  };

  const delta4 = out.weeksVsTarget;
  const target = view.enrollment.targetCompletionDate;
  const deltaText = delta4 === null || !target ? t("s27.pl.noTarget")
    : delta4 > 0 ? pl("s27.pl.before", delta4, { date: formatDay(target, lang) })
    : delta4 < 0 ? pl("s27.pl.after", -delta4, { date: formatDay(target, lang) })
    : t("s27.pl.on", { date: formatDay(target, lang) });

  const spanText = out.wholeProgram
    ? out.wholeProgram.months && out.wholeProgram.weeks ? t("s27.pl.span", { m: out.wholeProgram.months, w: out.wholeProgram.weeks })
      : out.wholeProgram.months ? t("s27.pl.spanM", { m: out.wholeProgram.months }) : t("s27.pl.spanW", { w: out.wholeProgram.weeks })
    : "–";

  return (
    <section className="card flight" aria-labelledby="fl-h" data-testid="fd-flight">
      <div className="ch">
        <div style={{ display: "grid", gap: 4 }}><Eyebrow>{t("s27.fi.eyebrow")}</Eyebrow><h2 id="fl-h">{t("s27.fi.title")}</h2></div>
        <Link className="link" href="/beyond">{t("s27.fi.beyond")} →</Link>
      </div>
      <FlightInstrument
        required={figures.required} confirmed={figures.confirmed} stops={instrumentStops} beadPace={shownPace} today={today}
        ariaLabel={instrumentStops.length ? t("s27.fi.aria", { n: instrumentStops.length }) : t("s27.fi.ariaNoStops")}
        enrolledLabel={t("s27.fi.enrolled")} enrolledDate={formatDay(view.enrollment.startedOn, lang)}
        diplomaTitle={t("s27.fi.diploma")} diplomaSub={diplomaSub}
        youLabel={t("s27.fi.you", { c: num(figures.confirmed), r: num(figures.required) })}
        formatDay={(iso) => formatDay(iso, lang)} beadLabel={(d) => t("s27.fi.bead", { date: d })}
        ghost={ghost} ghostLabel={(d, c) => t("s27.fi.ghost.cr", { date: d, n: c })} landLabel={(d) => t("s27.fi.ghost.land", { date: d })}
        arrivalOf={arrivalOf}
      />
      <div className="info" data-testid="fd-info">
        <div><span className="k">{t("s27.fi.flown")}</span><span className="v">{num(figures.confirmed)}<small>{t("s27.fi.flownVal", { r: num(figures.required) })}</small></span></div>
        <div>
          <span className="k">{t("s27.fi.schedule")}</span>
          {delta === null
            ? <span className="v"><small style={{ marginLeft: 0 }}>{t("s27.fi.scheduleNone")}</small></span>
            : <span className={`v ${delta >= 0 ? "good" : ""}`}>{delta >= 0 ? "+" : "−"}{num(Math.abs(delta))}<small>{delta >= 0 ? t("s27.fi.scheduleAhead") : t("s27.fi.scheduleBehind")}</small></span>}
        </div>
        <div>
          <span className="k">{onActual ? t("s27.fi.pace") : t("s27.fi.paceScenario")}</span>
          {shownPace ? <span className="v">{num(shownPace)}<small>{t("s27.fi.paceUnit")}</small></span> : <span className="v"><small style={{ marginLeft: 0 }}>{t("s27.fi.paceNone")}</small></span>}
        </div>
        <div>
          <span className="k">{t("s27.fi.arrival")}</span>
          {infoArrival ? <span className="v">{formatDay(infoArrival, lang)}<small>{!onActual ? t("s27.fi.arrivalScenario") : arrivalInfo.basis === "pace" ? t("s27.fi.arrivalPace") : t("s27.fi.arrivalPlan")}</small></span> : <span className="v">–</span>}
        </div>
      </div>
      <div className="planner-toggle">
        <span className={`actual-line ${stale || !actual ? "stale" : ""}`} data-testid="fd-actual-line">
          {actual && !stale
            ? t("s27.fi.actual", { pace: num(actual), n: journey?.pace?.itemsLogged28d ?? 0 })
            : stale && staleDays !== null ? t("s27.fi.stale", { n: staleDays }) : t("s27.fi.staleNever")}
        </span>
        <button className="b2" type="button" aria-expanded={planner} aria-controls="fd-studio" onClick={() => setPlanner((v) => !v)} data-testid="fd-planner-toggle">
          {planner ? t("s27.pl.close") : t("s27.pl.open")}
        </button>
      </div>
      {planner && (
        <div className="studio" id="fd-studio" data-testid="fd-planner">
          <div className="studio-l">
            <h3>{t("s27.pl.title")}</h3>
            <div className="presets" role="group" aria-label={t("s27.pl.presets")}>
              {PACE_PRESETS.map((p) => {
                const v = presetValue(p.id, actual);
                const pressed = v !== null && Math.abs(v - slider) < 0.05 && (p.id === "actual" ? onActual : !(onActual && actual !== null && Math.abs(v - actual) < 0.05));
                const arr = v ? arrivalOf(v) : null;
                return (
                  <button key={p.id} type="button" className="preset" aria-pressed={pressed} disabled={v === null} onClick={() => v !== null && choose(p.id === "actual" ? null : v)} data-testid={`preset-${p.id}`}>
                    <b>{t(`s27.pl.preset.${p.id}` as TranslationKey)}</b>
                    <span>{v === null ? t("s27.pl.preset.actualNone") : t("s27.pl.perWeek", { pace: num(v) })}</span>
                    {arr && <span>{t("s27.pl.arrives", { date: formatDay(arr, lang) })}</span>}
                  </button>
                );
              })}
            </div>
            <div className="slider">
              <label htmlFor="fd-pace">{t("s27.pl.slider")} <b>{t("s27.pl.sliderOut", { pace: num(slider) })}</b></label>
              <input
                id="fd-pace" type="range" min={PACE_MIN} max={PACE_MAX} step={PACE_STEP} value={clampPace(slider)}
                style={{ "--fill": `${((clampPace(slider) - PACE_MIN) / (PACE_MAX - PACE_MIN)) * 100}%` } as React.CSSProperties}
                onChange={(e) => { setGhost(null); choose(roundPace(Number(e.target.value)), false); }}
                onMouseUp={() => fly(slider)} onTouchEnd={() => fly(slider)} onKeyUp={() => fly(slider)}
                data-testid="fd-pace-slider"
              />
              <div className="scale"><span>{t("s27.pl.relaxed")}</span><span>2.0</span><span>{t("s27.pl.intensive")}</span></div>
            </div>
          </div>
          <div className="studio-r">
            <div className="out">
              <span className="k">{t("s27.pl.youArrive")}</span>
              <span className="big" data-testid="fd-out-arrival">{out.arrival ? formatDay(out.arrival, lang, "weekday") : t("s27.pl.noPace")}</span>
              <span className={`sub ${delta4 !== null && delta4 < 0 ? "late" : ""}`}>{deltaText}</span>
            </div>
            <div className="outs">
              <div><span className="k">{t("s27.pl.whole")}</span><span className="mv">{spanText}</span></div>
              <div><span className="k">{t("s27.pl.left")}</span><span className="mv">{num(out.creditsLeft)}</span></div>
              <div><span className="k">{t("s27.pl.toGo")}</span><span className="mv">{out.weeksToGo === null ? "–" : t("s27.pl.weeks", { n: out.weeksToGo })}</span></div>
            </div>
            <div className="btns">
              <button className="b1" type="button" onClick={() => void propose()} disabled={support.pending || !out.arrival} data-testid="fd-propose">{t("s27.pl.propose")}</button>
              <button className="b2" type="button" onClick={() => fly(slider)} data-testid="fd-replay">{t("s27.pl.replay")}</button>
              {!onActual && <button className="b2" type="button" onClick={() => { choose(null, false); if (actual) fly(actual); else setGhost(null); }} data-testid="fd-reset">{t("s27.pl.reset")}</button>}
            </div>
            <p className="small">{t("s27.pl.note")}</p>
          </div>
        </div>
      )}
    </section>
  );
}

// ── right column ────────────────────────────────────────────────────────────

function CreditsCard({ view, figures }: { view: StudentHighSchoolView; figures: ReturnType<typeof creditFigures> }) {
  const { t, lang, num } = useS27T();
  const rows: CreditRow[] = view.subjects.filter((s) => s.requiredHalfUnits > 0).map((s) => {
    const waiting = s.courses.filter((x) => x.status === "awaiting_school").reduce((n, x) => n + x.halfUnits, 0);
    const req = s.requiredHalfUnits;
    const done = Math.min(req, s.earnedHalfUnits);
    return { key: s.subject, label: subjectLabel(s.subject, lang), req, done, wait: Math.min(req - done, waiting), figure: `${num(done / 2)}/${num(req / 2)}` };
  });
  return (
    <CreditsGaugeCard
      title={t("s27.cr.title")} linkHref="/high-school" linkLabel={t("s27.cr.roadmap")}
      confirmed={figures.confirmed} secondary={figures.waiting} required={figures.required}
      ariaLabel={t("s27.cr.aria", { c: num(figures.confirmed), r: num(figures.required), w: num(figures.waiting) })}
      rows={rows}
      legend={[t("s27.cr.confirmed"), t("s27.cr.waiting"), t("s27.cr.toEarn")]}
    />
  );
}
