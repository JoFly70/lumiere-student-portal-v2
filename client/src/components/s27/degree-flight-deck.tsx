/**
 * S27 Flight Deck cockpit for degree (bachelor's) students: the SAME cockpit as the high-school deck (greeting, countdown
 * rings, radar chips, flight path, credits card, Up next / Next 7 days, checkpoints, documents, billing, Ask Lumière),
 * fed from the degree APIs instead:
 *   - GET /api/student/roadmap         StudentRoadmapView            (next course task, Next 7 days, stops, graduation target)
 *   - GET /api/student/degree-progress StudentDegreeProgressView     (applied / required credits, requirement groups, notes)
 *   - the program-agnostic journey, documents, tickets and billing feeds (shared with the high-school deck).
 * Prop-driven, so it renders from fixtures. Read-only. The old Today / Journey / Progress / Foundation / Horizon tabs are
 * gone: Today = Up next + countdown, Journey = flight path, Progress = requirement groups in the credits card,
 * Foundation = "Where your credits come from", Horizon = the "Beyond the Bachelor's" link. All mapping lives in
 * lib/s27/degree-cockpit-model.ts.
 */
import React, { useMemo } from "react";
import { Link } from "wouter";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import type { StudentDegreeProgressView } from "@shared/student-degree-progress-view";
import type { StudentJourneyView } from "@shared/s27-contract";
import { buildAlertCards, buildRadarChips, deadlinesToWatch, weekOfProgram, type TicketLike } from "@/lib/s27/cockpit-model";
import {
  buildDegreeStops, degreeFigures, degreeNextTask, degreeNotes, degreeOpenTasks, degreePlanDates, degreeRequirementRows,
  type DegreeFigures, type DegreeStop,
} from "@/lib/s27/degree-cockpit-model";
import { formatCents, type CreditSegment } from "@/components/degree-journey/model";
import { djTranslate, useDj, type DjKey } from "@/components/degree-journey/i18n";
import { formatDay } from "@/lib/s27/dates";
import { useS27T } from "@/lib/s27/i18n-util";
import { S27Page, Eyebrow } from "./ui";
import {
  AlertCardView, AskCard, BillingCard, CheckpointsCard, CreditsGaugeCard, DeckHead, DocumentsCard, RadarChipView, UpNextCard, WeekCard,
  type CreditRow, type DeckBilling, type DeckDoc, type DeckLinks, type JourneyState, type NextItem,
} from "./deck-parts";
import { FlightInstrument, type InstrumentStop } from "./flight-instrument";
import "@/styles/student-s27-degree.css";

export const DEGREE_ROADMAP_PATH = "/roadmap";
export const DEGREE_BEYOND_PATH = "/beyond";
export const DEGREE_DECK_LINKS: DeckLinks = { roadmap: DEGREE_ROADMAP_PATH, log: () => DEGREE_ROADMAP_PATH };

export interface DegreeFlightDeckProps {
  readonly roadmap: StudentRoadmapView;
  readonly progress: StudentDegreeProgressView | null;
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

export function DegreeFlightDeck(props: DegreeFlightDeckProps) {
  const { roadmap, progress, journey, journeyState, firstName, documents, tickets, billing, today, hour } = props;
  const { t, pl } = useS27T();
  const figures = useMemo(() => degreeFigures(roadmap, progress), [roadmap, progress]);
  const dates = useMemo(() => degreePlanDates(roadmap), [roadmap]);
  const agreement = journey?.agreement ?? null;

  const open = useMemo(() => degreeOpenTasks(roadmap, today), [roadmap, today]);
  const next = useMemo(() => degreeNextTask(open), [open]);
  const taskTitle = (o: { title: string; courseLevel: boolean }) => (o.courseLevel ? t("s27.dg.finishCourse") : o.title);

  const cards = useMemo(
    () => buildAlertCards({
      nextTask: next ? { title: next.courseLevel ? t("s27.dg.finishCourse") : next.title, courseKey: next.courseKey, courseTitle: next.courseTitle, dueDate: next.dueDate } : null,
      agreement, today,
    }),
    [next, agreement, today, t],
  );

  const waitingCourses = useMemo(
    () => roadmap.phases.flatMap((p) => p.items).filter((i) => (i.planStatus === "planned") && i.stage !== "officially_accepted" && i.taskCounts.total > 0 && i.taskCounts.graded + i.taskCounts.submitted === i.taskCounts.total).length,
    [roadmap],
  );
  const radar = useMemo(
    // A degree student logs no high-school pace, so the "last logged" chip never applies.
    () => buildRadarChips({ electivesAwaiting: 0, coursesAwaitingSchool: waitingCourses, journey: journey ? { ...journey, pace: null } : null, tickets, today, roadmapHref: DEGREE_ROADMAP_PATH }),
    [waitingCourses, journey, tickets, today],
  );

  const week = weekOfProgram(dates.startsOn, dates.graduationOn, today);
  const watch = deadlinesToWatch(agreement);

  const nextItem: NextItem | null = next ? { title: taskTitle(next), courseName: next.courseTitle, credits: next.credits, dueDate: next.dueDate, courseKey: next.courseKey } : null;
  const agenda = useMemo(() => open.map((o) => ({ courseKey: o.courseKey, courseTitle: o.courseTitle, key: o.key, title: o.courseLevel ? t("s27.dg.finishCourse") : o.title, dueDate: o.dueDate, overdue: o.overdue })), [open, t]);

  return (
    <S27Page testId="degree-flight-deck">
      <DeckHead firstName={firstName} hour={hour}>
        {watch > 0 && <span className="pill warn"><i />{pl("s27.fd.pill.deadline", watch)}</span>}
        {week && <span className="pill">{t("s27.fd.pill.week", { week: week.week, total: week.total })}</span>}
      </DeckHead>

      {journeyState === "failed" && <p className="notice warn" role="status" data-testid="fd-journey-error">{t("s27.fd.journeyError")}</p>}

      {cards.length > 0 && (
        <section aria-label={t("s27.fd.countdowns")} className="alerts" data-testid="fd-alerts">
          {cards.map((c) => <AlertCardView key={c.key} card={c} credits={next?.credits ?? null} accessMonths={agreement?.accessMonths ?? null} links={DEGREE_DECK_LINKS} />)}
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
          <DegreeFlightCard roadmap={roadmap} figures={figures} startsOn={dates.startsOn} graduationOn={dates.graduationOn} today={today} />
          <div className="pair">
            <UpNextCard item={nextItem} links={DEGREE_DECK_LINKS} />
            <WeekCard open={agenda} today={today} />
          </div>
          <CreditSourcesCard figures={figures} />
          <AskCard />
        </div>
        <div className="colst">
          <DegreeCreditsCard figures={figures} progress={progress} roadmap={roadmap} />
          <CheckpointsCard journey={journey} journeyState={journeyState} />
          <DocumentsCard documents={documents} agreement={agreement} today={today} />
          <BillingCard billing={billing} />
        </div>
      </div>
      <p className="small">{t("s27.fd.footer")}</p>
    </S27Page>
  );
}

// ── flight path ─────────────────────────────────────────────────────────────

function DegreeFlightCard({ roadmap, figures, startsOn, graduationOn, today }: { roadmap: StudentRoadmapView; figures: DegreeFigures; startsOn: string | null; graduationOn: string | null; today: string }) {
  const { t, lang, num } = useS27T();
  const stops: DegreeStop[] = useMemo(() => buildDegreeStops(roadmap, figures), [roadmap, figures]);
  const instrumentStops: InstrumentStop[] = stops.map((s) => ({
    id: s.id,
    credits: s.credits,
    reached: false,
    name: s.name,
    sub: t("s27.fi.stop.planned", { n: num(s.credits) }),
    tipBody: s.targetOn ? t("s27.fi.stop.month", { month: formatDay(s.targetOn, lang, "monthYear") }) : "",
  }));
  return (
    <section className="card flight" aria-labelledby="fl-h" data-testid="fd-flight">
      <div className="ch">
        <div style={{ display: "grid", gap: 4 }}><Eyebrow>{t("s27.fi.eyebrow")}</Eyebrow><h2 id="fl-h">{t("s27.dg.title")}</h2></div>
        <Link className="link" href={DEGREE_BEYOND_PATH} data-testid="fd-beyond-link">{t("s27.nav.beyondBachelor")} →</Link>
      </div>
      {figures.known ? (
        <FlightInstrument
          required={figures.required} confirmed={figures.confirmed} stops={instrumentStops} beadPace={null} today={today}
          ariaLabel={instrumentStops.length ? t("s27.dg.aria", { n: instrumentStops.length }) : t("s27.dg.ariaNoStops")}
          enrolledLabel={t("s27.dg.start")} enrolledDate={startsOn ? formatDay(startsOn, lang) : ""}
          diplomaTitle={t("s27.dg.degree")}
          diplomaSub={graduationOn ? t("s27.fi.diplomaSubPlan", { n: num(figures.required), date: formatDay(graduationOn, lang) }) : t("s27.fi.diplomaSubNone", { n: num(figures.required) })}
          youLabel={t("s27.fi.you", { c: num(figures.confirmed), r: num(figures.required) })}
          formatDay={(iso) => formatDay(iso, lang)} beadLabel={(d) => t("s27.fi.bead", { date: d })}
          ghost={null} ghostLabel={(d, c) => `${d} ${c}`} landLabel={(d) => d}
          arrivalOf={() => null}
        />
      ) : (
        <p className="small" data-testid="fd-flight-unavailable">{t("s27.dg.unavailable")}</p>
      )}
      <div className="info" data-testid="fd-info">
        <div><span className="k">{t("s27.dg.info.applied")}</span><span className="v">{num(figures.confirmed)}<small>{t("s27.dg.info.appliedVal", { r: num(figures.required) })}</small></span></div>
        <div><span className="k">{t("s27.dg.info.planned")}</span><span className="v">{num(figures.planned)}<small>{t("s27.dg.info.plannedVal")}</small></span></div>
        <div>
          <span className="k">{t("s27.dg.info.open")}</span>
          {figures.source.openCents === null ? <span className="v">–</span> : <span className="v">{num(figures.source.openCents / 100)}<small>{t("s27.dg.info.openVal")}</small></span>}
        </div>
        <div>
          <span className="k">{t("s27.dg.info.target")}</span>
          {graduationOn ? <span className="v">{formatDay(graduationOn, lang)}<small>{t("s27.dg.info.targetSub")}</small></span> : <span className="v"><small style={{ marginLeft: 0 }}>{t("s27.dg.info.targetNone")}</small></span>}
        </div>
      </div>
    </section>
  );
}

// ── credits: requirement groups + residency / notes ─────────────────────────

function DegreeCreditsCard({ figures, progress, roadmap }: { figures: DegreeFigures; progress: StudentDegreeProgressView | null; roadmap: StudentRoadmapView }) {
  const { t, num } = useS27T();
  const rows: CreditRow[] = degreeRequirementRows(progress).map((r) => {
    const known = r.required !== null && r.applied !== null;
    return {
      key: r.id,
      label: r.label,
      req: known ? r.required! : 1,
      done: known ? Math.min(r.required!, r.applied!) : r.done ? 1 : 0,
      wait: 0,
      figure: known ? `${num(r.applied!)}/${num(r.required!)}` : r.review ? t("s27.dg.cr.review") : r.done ? t("s27.dg.cr.done") : "",
    };
  });
  const notes = degreeNotes(roadmap, progress);
  return (
    <>
      <CreditsGaugeCard
        title={t("s27.cr.title")} linkHref={DEGREE_ROADMAP_PATH} linkLabel={t("s27.cr.roadmap")}
        confirmed={figures.confirmed} secondary={Math.min(figures.planned, Math.max(0, figures.required - figures.confirmed))} required={figures.required}
        ariaLabel={t("s27.dg.cr.aria", { c: num(figures.confirmed), r: num(figures.required), w: num(figures.planned) })}
        rows={rows}
        legend={[t("s27.dg.cr.applied"), t("s27.dg.cr.planned"), t("s27.cr.toEarn")]}
        wideRows
      />
      {notes.length > 0 && <NotesCard notes={notes} />}
    </>
  );
}

function NotesCard({ notes }: { notes: ReturnType<typeof degreeNotes> }) {
  const { t, lang } = useS27T();
  return (
    <section className="card" aria-labelledby="gk-h" data-testid="fd-notes">
      <div className="ch"><h2 id="gk-h">{t("s27.dg.notes")}</h2></div>
      <ul className="dgnotes">
        {notes.map((w) => (
          <li key={w.id} data-tone={w.tone} data-testid={w.id.startsWith("res:") ? "fd-note-residency" : "fd-note"}>
            <i aria-hidden="true" />
            <span>{djTranslate(lang, w.key, w.params as Record<string, string | number>)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── "Where your credits come from" ──────────────────────────────────────────

function CreditSourcesCard({ figures }: { figures: DegreeFigures }) {
  const { t, language } = useDj();
  const data = figures.source;
  const fc = (c: number) => formatCents(c, language);
  const n = (c: number) => (c === 100 ? t("dj.credits.n1") : t("dj.credits.n", { n: fc(c) }));
  if (data.state === "unavailable" || data.requiredCents === null) {
    return (
      <section className="card" aria-labelledby="src-h" data-testid="fd-sources" data-state="unavailable">
        <div className="ch"><h2 id="src-h">{t("dj.credits.titleUnknown")}</h2></div>
        <p className="small">{t("dj.credits.unavailable")}</p>
      </section>
    );
  }
  const required = data.requiredCents;
  const scale = Math.max(required, data.earnedCents + data.plannedCents, 1);
  let plannedIndex = -1;
  const rows = data.segments.map((seg) => {
    if (seg.group === "planned") plannedIndex += 1;
    return { seg, cls: segmentClass(seg, plannedIndex) };
  });
  const label = (seg: CreditSegment): string => {
    if (seg.group === "earned") return t(`dj.credits.src.${seg.sourceKind ?? "other"}` as DjKey);
    if (seg.group === "planned") return seg.providerName ?? t("dj.credits.planned.unassigned");
    return t("dj.credits.open");
  };
  const groups = [
    { id: "earned", title: t("dj.credits.earnedGroup"), total: data.earnedCents, show: data.earnedKnown },
    { id: "planned", title: t("dj.credits.plannedGroup"), total: data.plannedCents, show: data.plannedCents > 0 },
    { id: "open", title: t("dj.credits.openGroup"), total: data.openCents ?? 0, show: data.openCents !== null && data.openCents > 0 },
  ] as const;
  return (
    <section className="card" aria-labelledby="src-h" data-testid="fd-sources" data-state="ready">
      <div className="ch">
        <h2 id="src-h">{t("dj.credits.title", { total: fc(required) })}</h2>
        {data.earnedKnown && <span className="mono" data-testid="fd-sources-total">{fc(data.earnedCents)} / {fc(required)}</span>}
      </div>
      <div
        className="srcbar" role="img" data-testid="fd-sources-bar"
        aria-label={t("dj.credits.aria", { earned: fc(data.earnedCents), planned: fc(data.plannedCents), open: fc(data.openCents ?? 0), total: fc(required) })}
      >
        {rows.map(({ seg, cls }) => <span key={seg.id} className={cls} style={{ flexGrow: seg.cents, flexBasis: `${(seg.cents / scale) * 100}%` }} data-segment={seg.id} />)}
      </div>
      <div className="srcgroups">
        {groups.filter((g) => g.show).map((g) => (
          <div key={g.id} data-testid={`fd-sources-${g.id}`}>
            <h3><span>{g.title}</span><b>{fc(g.total)}</b></h3>
            <ul>
              {rows.filter((r) => r.seg.group === g.id).map(({ seg, cls }) => (
                <li key={seg.id}>
                  <i className={cls} aria-hidden="true" />
                  <span>
                    {label(seg)}
                    {seg.group === "planned" && !!seg.startedCents && seg.startedCents > 0 && <small>{t("dj.credits.inProgress", { n: fc(seg.startedCents) })}</small>}
                    {seg.group === "open" && <small>{t("dj.credits.open.help")}</small>}
                  </span>
                  <b>{n(seg.cents)}</b>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="small" data-testid="fd-sources-note">{t("dj.credits.note")}{data.overPlanned ? ` ${t("dj.credits.overPlanned")}` : ""}</p>
    </section>
  );
}

function segmentClass(seg: CreditSegment, plannedIndex: number): string {
  if (seg.group === "earned") return `sg e-${seg.sourceKind ?? "other"}`;
  if (seg.group === "planned") return `sg p p${Math.min(plannedIndex, 3)}`;
  return "sg o";
}
