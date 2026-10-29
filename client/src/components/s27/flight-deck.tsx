/**
 * S27 Flight Deck cockpit for high-school students. Prop-driven (the container below feeds it from the real hooks), so it
 * renders from fixtures. Reads: StudentHighSchoolView (official credits, plan), StudentJourneyView (agreement deadlines,
 * checkpoints, logged pace; may be null when the endpoint is not ready), documents, tickets and billing summaries.
 * Read-only apart from "Ask Lumière to plan this pace", which creates an ordinary Support request.
 */
import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import type { StudentHighSchoolView } from "@shared/high-school-contract";
import type { CheckpointKey, StudentJourneyView } from "@shared/s27-contract";
import type { StudentBillingView } from "@shared/billing-contract";
import { formatMoney } from "@shared/billing-contract";
import { useToast } from "@/hooks/use-toast";
import { askAssistant } from "@/components/academic-assistant/logic";
import { buildDegreeMap, buildPhaseBands, isAcceleratedPlan, openTasks, findCourse } from "@/lib/degree-map";
import { docTypeLabel } from "@/lib/document-type-labels";
import { subjectLabel } from "@/pages/high-school-presentation";
import { courseName } from "@/lib/s27/roadmap-model";
import {
  PACE_MAX, PACE_MIN, PACE_PRESETS, PACE_STEP, actualPace, buildAlertCards, buildFlightStops, buildRadarChips, checkpointProgress, clampPace,
  creditFigures, deadlinesToWatch, estimatedArrival, plannerOutputs, presetValue, roundPace, scheduleDelta, stopEstimate, toCredits, weekAgenda, weekOfProgram,
  type AlertCard, type RadarChip, type TicketLike,
} from "@/lib/s27/cockpit-model";
import { dayPart, daysBetween, formatDay } from "@/lib/s27/dates";
import { useS27T } from "@/lib/s27/i18n-util";
import { useSupportRequest } from "@/lib/s27/use-support-request";
import type { TranslationKey } from "@/i18n";
import { S27Page, Eyebrow, Ring, SEVERITY_COLOR } from "./ui";
import { LumiereOrb } from "./lumiere-orb";
import { FlightInstrument, type GhostRun, type InstrumentStop } from "./flight-instrument";

export type JourneyState = "ready" | "loading" | "unavailable" | "failed";
export interface DeckDoc { readonly id: string; readonly doc_type: string; readonly file_name: string; readonly status: string }
export type DeckBilling = StudentBillingView | "unavailable" | "loading" | null;

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

  const hello = t(`s27.fd.hello.${dayPart(hour)}` as TranslationKey);

  return (
    <S27Page testId="hs-flight-deck">
      <section className="deck-head">
        <div>
          <Eyebrow>{t("s27.fd.eyebrow")}</Eyebrow>
          <h1 data-testid="fd-greeting">{firstName ? <>{hello}, <em>{firstName}</em>.</> : <>{hello}.</>}</h1>
        </div>
        <div className="status" data-testid="fd-status">
          {watch > 0 && <span className="pill warn"><i />{pl("s27.fd.pill.deadline", watch)}</span>}
          {paceKey && <span className={`pill ${view.pace.status === "behind" ? "warn" : "ok"}`}><i />{t(paceKey)}</span>}
          {week && <span className="pill">{t("s27.fd.pill.week", { week: week.week, total: week.total })}</span>}
        </div>
      </section>

      {journeyState === "unavailable" && <p className="notice" data-testid="fd-journey-pending">{t("s27.fd.journeyPending")}</p>}
      {journeyState === "failed" && <p className="notice warn" role="status" data-testid="fd-journey-error">{t("s27.fd.journeyError")}</p>}

      {cards.length > 0 && (
        <section aria-label={t("s27.fd.countdowns")} className="alerts" data-testid="fd-alerts">
          {cards.map((c) => <AlertCardView key={c.key} card={c} credits={nextCourse ? toCredits(nextCourse.halfUnits) : null} accessMonths={agreement?.accessMonths ?? null} />)}
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
            <UpNextCard task={nextTask} course={nextCourse} today={today} />
            <WeekCard open={open} today={today} />
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

// ── countdown cards ─────────────────────────────────────────────────────────

function AlertCardView({ card, credits, accessMonths }: { card: AlertCard; credits: number | null; accessMonths: number | null }) {
  const { t, lang, pl, num } = useS27T();
  const color = SEVERITY_COLOR[card.severity];
  const due = card.dueOn ? t("s27.alert.due", { date: formatDay(card.dueOn, lang, "weekday") }) : "";
  let title = "";
  let text = "";
  let action: { href: string; label: string } = { href: "/high-school", label: t("s27.act.roadmap") };
  if (card.kind === "task") {
    title = `${card.subtitle} · ${card.title}`;
    const credit = credits !== null ? pl("s27.alert.task.credit", credits, { n: num(credits) }) : "";
    text = [t("s27.alert.task.d", { credit }).trim(), card.dueOn ? due : t("s27.alert.noDate")].join(" ");
    action = { href: `/high-school?log=${encodeURIComponent(card.courseKey ?? "")}`, label: t("s27.act.roadmap") };
  } else if (card.kind === "deadline") {
    title = card.title ?? "";
    const base = card.detail ?? card.subtitle ?? "";
    text = card.done ? base : [base, due].filter(Boolean).join(" ");
    action = card.done ? { href: "/documents", label: t("s27.act.result") } : { href: "/documents", label: t("s27.act.upload") };
  } else {
    title = pl("s27.alert.support.t", card.big ?? 0);
    text = [card.dueOn ? t("s27.alert.support.d", { date: formatDay(card.dueOn, lang, "short") }) : "", accessMonths ? t("s27.alert.support.access", { n: accessMonths }) : ""].filter(Boolean).join(" ");
    action = { href: "/profile", label: t("s27.act.included") };
  }
  const unit = card.unit === "months" ? ((card.big ?? 0) === 1 ? t("s27.unit.month") : t("s27.unit.months")) : card.unit === "overdue" ? t("s27.unit.late") : card.unit === "days" ? ((card.big ?? 0) === 1 ? t("s27.unit.day") : t("s27.unit.days")) : "";
  return (
    <article className="alert" style={{ "--sev": color } as React.CSSProperties} data-testid={`alert-${card.key}`} data-done={card.done ? "true" : "false"} data-severity={card.severity}>
      <div className="rg">
        <Ring fraction={card.done ? 1 : card.fraction} color={color} />
        {card.done ? <b><span aria-hidden="true">✓</span><small>{t("s27.unit.done")}</small></b> : <b>{card.big ?? "–"}<small>{unit}</small></b>}
      </div>
      <span className="t">{title}</span>
      <span className="d">{text}</span>
      <span className="a"><Link className="link" href={action.href}>{action.label} →</Link></span>
    </article>
  );
}

function RadarChipView({ chip, journey }: { chip: RadarChip; journey: StudentJourneyView | null }) {
  const { t, lang, pl } = useS27T();
  const color = chip.tone === "warn" ? "var(--t-amber)" : chip.tone === "ok" ? "var(--t-green)" : "var(--t-accent)";
  let text = "";
  switch (chip.key) {
    case "electives": text = pl("s27.radar.electives", chip.n); break;
    case "checkpoint": {
      const next = journey?.checkpoints.find((c) => c.status === "next");
      const label = next ? t(`s27.cp.${next.key}` as TranslationKey) : "";
      text = chip.on ? t("s27.radar.checkpoint", { label, date: formatDay(chip.on, lang, "weekday") }) : t("s27.radar.checkpointNoDate", { label });
      break;
    }
    case "waiting": text = pl("s27.radar.waiting", chip.n); break;
    case "support": text = pl("s27.radar.support", chip.n); break;
    case "logged": text = chip.n < 0 ? t("s27.radar.logged.never") : chip.n === 0 ? t("s27.radar.logged.today") : chip.n === 1 ? t("s27.radar.logged.yesterday") : t("s27.radar.logged.ago", { n: chip.n }); break;
  }
  return (
    <Link href={chip.href} className="chipbtn" style={{ "--sev": color } as React.CSSProperties} data-testid={`radar-${chip.key}`}>
      <i /><span>{text}</span>
    </Link>
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

// ── up next, week, ask ──────────────────────────────────────────────────────

function UpNextCard({ task, course, today }: { task: ReturnType<typeof openTasks>[number] | null; course: ReturnType<typeof findCourse>; today: string }) {
  const { t, lang, pl, num } = useS27T();
  if (!task) {
    return (
      <section className="card next" aria-labelledby="nx-h" data-testid="fd-next">
        <Eyebrow>{t("s27.next.eyebrow")}</Eyebrow>
        <h3 id="nx-h">{t("s27.next.none")}</h3>
        <p>{t("s27.next.noneText")}</p>
      </section>
    );
  }
  const name = courseName(task.courseTitle);
  const credit = course ? pl("s27.next.credit", toCredits(course.halfUnits), { n: num(toCredits(course.halfUnits)) }) : "";
  void today;
  return (
    <section className="card next" aria-labelledby="nx-h" data-testid="fd-next">
      <Eyebrow>{t("s27.next.eyebrowCourse", { course: name })}</Eyebrow>
      <h3 id="nx-h">{task.title}</h3>
      <p>{task.dueDate ? t("s27.next.text", { date: formatDay(task.dueDate, lang, "long"), course: name, credit }) : t("s27.next.textNoDate", { course: name, credit })}</p>
      <div className="btns">
        <Link className="b1" href={`/high-school?log=${encodeURIComponent(task.courseKey)}`} data-testid="fd-next-log">{t("s27.next.open")}</Link>
        <Link className="b2" href="/high-school">{t("s27.next.roadmap")}</Link>
      </div>
    </section>
  );
}

function WeekCard({ open, today }: { open: ReturnType<typeof openTasks>; today: string }) {
  const { t, lang } = useS27T();
  const items = weekAgenda(open.map((o) => ({ courseKey: o.courseKey, courseTitle: o.courseTitle, key: o.key, title: o.title, dueDate: o.dueDate, overdue: o.overdue })), today);
  return (
    <section className="card" aria-labelledby="wk-h" data-testid="fd-week">
      <div className="ch"><h2 id="wk-h">{t("s27.week.title")}</h2><span className="mono">{t("s27.week.count", { n: items.length })}</span></div>
      <div className="agenda">
        {items.length === 0 && <p className="small">{t("s27.week.empty")}</p>}
        {items.map((it, i) => {
          const d = it.dueDate ? daysBetween(today, it.dueDate) : null;
          const pill = it.overdue ? { cls: "crit", text: t("s27.week.late") } : i === 0 ? { cls: "wait", text: t("s27.week.next") } : d === 0 ? { cls: "wait", text: t("s27.week.today") } : { cls: "plan", text: t("s27.week.in", { n: d ?? 0 }) };
          return (
            <div key={`${it.courseKey}:${it.key}`} className={`ag${d === 0 ? " today" : ""}`}>
              <span className="dt">{it.dueDate ? formatDay(it.dueDate, lang, "weekday").split(" ")[0] : ""}<b>{it.dueDate ? it.dueDate.slice(8, 10).replace(/^0/, "") : "–"}</b></span>
              <span className="w">{it.title}<span>{courseName(it.courseTitle)}</span></span>
              <span className={`pill ${pill.cls}`}>{pill.text}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AskCard() {
  const { t } = useS27T();
  const [q, setQ] = useState("");
  const chips = [t("s27.ai.q.credits"), t("s27.ai.q.urgent"), t("s27.ai.q.track")];
  return (
    <section className="card ai-card" aria-labelledby="ai-h" data-testid="fd-ask">
      <div className="ai-head"><LumiereOrb size={52} /><div><h2 id="ai-h">{t("s27.ai.title")}</h2><span>{t("s27.ai.sub")}</span></div></div>
      <div className="qs">{chips.map((c) => <button key={c} type="button" className="q" onClick={() => askAssistant(c)}>{c}</button>)}</div>
      <p className="ans">{t("s27.ai.note")}</p>
      <form className="askmini" onSubmit={(e) => { e.preventDefault(); const v = q.trim(); if (v) { askAssistant(v); setQ(""); } }}>
        <label htmlFor="fd-q" className="sr-only">{t("s27.ai.label")}</label>
        <input id="fd-q" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("s27.ai.placeholder")} maxLength={2000} />
        <button className="b1" type="submit">{t("s27.ai.ask")}</button>
      </form>
    </section>
  );
}

// ── right column ────────────────────────────────────────────────────────────

function CreditsCard({ view, figures }: { view: StudentHighSchoolView; figures: ReturnType<typeof creditFigures> }) {
  const { t, lang, num } = useS27T();
  const r = 50;
  const c = 2 * Math.PI * r;
  const f = (n: number) => (figures.required > 0 ? Math.min(1, n / figures.required) : 0);
  const rows = view.subjects.filter((s) => s.requiredHalfUnits > 0).map((s) => {
    const waiting = s.courses.filter((x) => x.status === "awaiting_school").reduce((n, x) => n + x.halfUnits, 0);
    const req = s.requiredHalfUnits;
    const done = Math.min(req, s.earnedHalfUnits);
    return { key: s.subject, label: subjectLabel(s.subject, lang), req, done, wait: Math.min(req - done, waiting) };
  });
  return (
    <section className="card" aria-labelledby="cr-h" data-testid="fd-credits">
      <div className="ch"><h2 id="cr-h">{t("s27.cr.title")}</h2><Link className="link" href="/high-school">{t("s27.cr.roadmap")} →</Link></div>
      <div className="gauge-wrap">
        <div className="gauge" role="img" aria-label={t("s27.cr.aria", { c: num(figures.confirmed), r: num(figures.required), w: num(figures.waiting) })}>
          <svg viewBox="0 0 118 118" aria-hidden="true">
            <circle cx="59" cy="59" r={r} fill="none" stroke="var(--t-panel-3)" strokeWidth="10" />
            <circle cx="59" cy="59" r={r} fill="none" stroke="var(--t-accent-line)" strokeWidth="10" strokeDasharray={`${(c * f(figures.confirmed + figures.waiting)).toFixed(1)} ${c.toFixed(1)}`} />
            <circle cx="59" cy="59" r={r} fill="none" stroke="var(--t-accent)" strokeWidth="10" strokeDasharray={`${(c * f(figures.confirmed)).toFixed(1)} ${c.toFixed(1)}`} />
          </svg>
          <b>{num(figures.confirmed)}<small>{t("s27.cr.of", { n: num(figures.required) })}</small></b>
        </div>
        <div className="subj">
          {rows.map((s) => (
            <div key={s.key}>
              <span>{s.label}</span>
              <span className="bar"><i style={{ width: `${(s.done / s.req) * 100}%` }} /><u style={{ width: `${(s.wait / s.req) * 100}%` }} /></span>
              <span className="n">{num(s.done / 2)}/{num(s.req / 2)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="legend"><span><i />{t("s27.cr.confirmed")}</span><span><i className="w" />{t("s27.cr.waiting")}</span><span><i className="p" />{t("s27.cr.toEarn")}</span></div>
    </section>
  );
}

function CheckpointsCard({ journey, journeyState }: { journey: StudentJourneyView | null; journeyState: JourneyState }) {
  const { t, lang } = useS27T();
  const cps = journey?.checkpoints ?? [];
  const prog = checkpointProgress(cps);
  return (
    <section className="card" aria-labelledby="lc-h" data-testid="fd-checkpoints">
      <div className="ch"><h2 id="lc-h">{t("s27.cp.title")}</h2>{cps.length > 0 && <span className="mono">{t("s27.cp.count", { d: prog.done, n: prog.total })}</span>}</div>
      {cps.length === 0 ? (
        <p className="small">{journeyState === "loading" ? t("s27.common.loading") : t("s27.cp.empty")}</p>
      ) : (
        <div className="lines cps">
          {cps.map((c) => (
            <div key={c.key} className={c.status === "next" ? "nx" : ""}>
              <span>{c.status === "done" ? "✓ " : ""}{t(`s27.cp.${c.key as CheckpointKey}` as TranslationKey)}</span>
              <span>{c.status === "done" ? formatDay(c.doneOn, lang) : c.plannedOn ? formatDay(c.plannedOn, lang, c.status === "next" ? "weekday" : "short") : t("s27.cp.later")}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DocumentsCard({ documents: docsIn, agreement, today }: { documents: readonly DeckDoc[] | null | "loading"; agreement: StudentJourneyView["agreement"]; today: string }) {
  const { t, lang } = useS27T();
  void today;
  const documents = docsIn === "loading" ? null : docsIn;
  const needs = (documents ?? []).filter((d) => d.status === "rejected" || d.status === "resubmit_requested");
  const approved = (documents ?? []).filter((d) => d.status === "verified").length;
  const review = (documents ?? []).filter((d) => d.status === "pending").length;
  const total = documents?.length ?? 0;
  const open = (agreement?.deadlines ?? []).filter((d) => d.status === "open" && d.dueOn);
  return (
    <section className="card" aria-labelledby="dc-h" data-testid="fd-documents">
      <div className="ch"><h2 id="dc-h">{t("s27.dc.title")}</h2><Link className="link" href="/documents">{t("s27.common.open")} →</Link></div>
      {docsIn === "loading" ? <p className="small">{t("s27.common.loading")}</p> : documents === null ? <p className="small">{t("s27.dc.unavailable")}</p> : (
        <>
          <div className="stat"><b>{approved}</b><span>{total > 0 ? t("s27.dc.of", { n: total }) : t("s27.dc.none")}</span></div>
          <div className="meter" aria-hidden="true"><i style={{ width: `${total ? (approved / total) * 100 : 0}%` }} /></div>
          <div className="lines">
            {needs.slice(0, 2).map((d) => <div key={d.id}><span>{docTypeLabel(d.doc_type)}</span><span style={{ color: "var(--t-amber)" }}>{t("s27.dc.needs")}</span></div>)}
            {open.slice(0, 2).map((d) => <div key={d.key}><span>{d.label}</span><span style={{ color: "var(--t-amber)" }}>{t("s27.dc.due", { date: formatDay(d.dueOn, lang) })}</span></div>)}
            {review > 0 && <div><span>{t("s27.dc.review")}</span><span>{review}</span></div>}
            {approved > 0 && <div><span>{t("s27.dc.approved")}</span><span style={{ color: "var(--t-green)" }}>{approved}</span></div>}
          </div>
        </>
      )}
    </section>
  );
}

function BillingCard({ billing }: { billing: DeckBilling }) {
  const { t, lang, pl } = useS27T();
  const locale = lang === "fr" ? "fr-CA" : "en-US";
  let body: React.ReactNode;
  if (billing === "loading") body = <p className="small">{t("s27.common.loading")}</p>;
  else if (billing === "unavailable") body = <p className="small">{t("s27.bl.unavailable")}</p>;
  else if (billing === null || billing.state === "not_configured") body = <><div className="stat"><b>{t("s27.bl.notSet")}</b></div><p className="small">{t("s27.bl.notSetText")}</p></>;
  else if (billing.remainingCents === 0) {
    const last = billing.receipts[0];
    body = (
      <>
        <div className="stat"><b style={{ color: "var(--t-green)" }}>{billing.paidCents > 0 ? t("s27.bl.paid") : t("s27.bl.nothing")}</b></div>
        {last && <div className="lines"><div><span>{formatMoney(last.amountCents, billing.currency, locale)}</span><span>{t("s27.bl.received", { date: formatDay(last.receivedDate, lang) })}</span></div></div>}
      </>
    );
  } else {
    const nd = billing.nextDue;
    body = (
      <>
        <div className="stat"><b>{nd ? t("s27.bl.next", { amount: formatMoney(nd.amountCents, billing.currency, locale) }) : formatMoney(billing.remainingCents, billing.currency, locale)}</b></div>
        <div className="lines">
          {nd && <div><span>{nd.status === "overdue" ? t("s27.bl.overdue", { date: formatDay(nd.dueDate, lang) }) : t("s27.bl.dueOn", { date: formatDay(nd.dueDate, lang) })}</span><span style={nd.status === "overdue" ? { color: "var(--t-red)" } : undefined}>{formatMoney(nd.amountCents, billing.currency, locale)}</span></div>}
          <div><span>{t("s27.bl.remaining")}</span><span>{formatMoney(billing.remainingCents, billing.currency, locale)}</span></div>
          {billing.evidenceAwaitingReview.length > 0 && <div><span>{pl("s27.bl.awaiting", billing.evidenceAwaitingReview.length)}</span><span /></div>}
        </div>
      </>
    );
  }
  return (
    <section className="card" aria-labelledby="bl-h" data-testid="fd-billing">
      <div className="ch"><h2 id="bl-h">{t("s27.bl.title")}</h2><Link className="link" href="/billing">{t("s27.common.open")} →</Link></div>
      {body}
    </section>
  );
}
