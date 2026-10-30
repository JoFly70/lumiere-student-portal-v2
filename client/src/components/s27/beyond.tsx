/**
 * S27 Beyond the Diploma / Beyond the Bachelor's. Prop-driven. University postcards come only from
 * journey.agreement.goal.targets; careers, pathway, services and prep questions are configuration (lib/s27/beyond-model).
 * With no goal the page shows a designed "your orientation study will appear here" state instead of invented content.
 */
import React, { useMemo, useState } from "react";
import { askAssistant } from "@/components/academic-assistant/logic";
import type { StudentHighSchoolView } from "@shared/high-school-contract";
import type { StudentJourneyView, PostSecondaryGoal } from "@shared/s27-contract";
import { creditFigures, estimatedArrival, weekOfProgram } from "@/lib/s27/cockpit-model";
import {
  buildChecklist, buildTimeline, candidateSlots, careersFor, artForIndex, intakeYear, normaliseRegion, prepPayload, prepQuestions, REGION_PATHS, SERVICES, sessionsLeft,
  type BeyondKind, type ServiceId,
} from "@/lib/s27/beyond-model";
import { formatDay, formatSlot, formatSlotLong } from "@/lib/s27/dates";
import { useS27T } from "@/lib/s27/i18n-util";
import type { TranslationKey } from "@/i18n";
import { S27Page, Eyebrow } from "./ui";
import { LumiereOrb } from "./lumiere-orb";
import { BeyondSky, PostcardArt } from "./beyond-art";

export type BookResult = { readonly ok: true } | { readonly ok: false; readonly kind: "none_left" | "unavailable" | "error" };
export type ServiceResult = { readonly ok: true; readonly ticketNumber: string } | { readonly ok: false; readonly message: string };

export interface BeyondProps {
  readonly kind: BeyondKind;
  readonly hs: StudentHighSchoolView | null;
  readonly journey: StudentJourneyView | null;
  readonly journeyState: "ready" | "loading" | "unavailable" | "failed";
  readonly today: string;
  readonly now: Date;
  readonly whatsapp: string | null;
  readonly onBook: (slot: Date, prep: Record<string, string[]>) => Promise<BookResult>;
  readonly onService: (id: ServiceId, title: string) => Promise<ServiceResult>;
  readonly notify: (title: string, description?: string, destructive?: boolean) => void;
}

const SVG_ICON = (d: string) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;

export function BeyondPage(p: BeyondProps) {
  const { t } = useS27T();
  const agreement = p.journey?.agreement ?? null;
  const goal = agreement?.goal ?? null;
  const left = sessionsLeft(agreement);
  const figures = p.hs ? creditFigures(p.hs) : null;
  const finish = p.hs ? estimatedArrival(p.journey, p.hs).on : null;
  const week = p.hs ? weekOfProgram(p.hs.enrollment.startedOn, p.hs.enrollment.targetCompletionDate, p.today)?.week ?? null : null;
  const year = intakeYear(finish, p.today);
  const bachelor = p.kind === "bachelor";
  return (
    <S27Page testId="beyond-page">
      <Hero kind={p.kind} goal={goal} year={year} reviewed={goal ? goal.targets.length + goal.alsoReviewed.length : 0} left={left} hasSessions={!!agreement} />
      {goal ? <Postcards goal={goal} kind={p.kind} /> : <EmptyStudy journeyState={p.journeyState} />}
      <Timeline kind={p.kind} goal={goal} finish={finish} week={week} figures={figures} required={figures?.required ?? null} />
      {goal && <Careers goal={goal} />}
      <div className="bd-two">
        <Pathway kind={p.kind} goal={goal} required={figures?.required ?? null} />
        <Checklist journey={p.journey} transcript={p.hs?.graduation.transcript.status ?? null} bachelor={bachelor} />
      </div>
      <Sessions {...p} agreement={agreement} goal={goal} />
      <Services goal={goal} onService={p.onService} notify={p.notify} bachelor={bachelor} />
      <AskFuture />
      <p className="small">{t("s27.bd.footer")}</p>
    </S27Page>
  );
}

function Hero({ kind, goal, year, reviewed, left, hasSessions }: { kind: BeyondKind; goal: PostSecondaryGoal | null; year: number; reviewed: number; left: number; hasSessions: boolean }) {
  const { t } = useS27T();
  return (
    <section className={`bd-hero${goal || hasSessions ? "" : " bd-hero--compact"}`} aria-labelledby="bd-h" data-testid="beyond-hero">
      {goal || hasSessions ? <BeyondSky /> : null}
      <div className="bd-hero-in">
        <span className="eyebrow bd-eye">{t(`s27.bd.eyebrow.${kind}` as TranslationKey)}</span>
        <h1 id="bd-h">
          {goal ? <>{t("s27.bd.h1.where", { region: goal.region, year })}<br /><em>{t("s27.bd.h1.story", { field: goal.field })}</em></> : <em>{t(`s27.bd.h1.noGoal.${kind}` as TranslationKey)}</em>}
        </h1>
        <p>{t(`s27.bd.intro.${kind}` as TranslationKey)}</p>
        {goal && goal.interests.length > 0 && <div className="goal-chips">{goal.interests.map((i) => <span key={i}>{i}</span>)}</div>}
      </div>
      {(goal || hasSessions) && (
        <aside className="bd-glass" aria-label={t("s27.bd.glass.title")}>
          <span className="k">{t("s27.bd.glass.k")}</span>
          <b>{t("s27.bd.glass.title")}</b>
          <div className="gl-stats">
            <div><strong>{reviewed}</strong><span>{t("s27.bd.glass.reviewed")}</span></div>
            <div><strong>{goal?.targets.length ?? 0}</strong><span>{t("s27.bd.glass.recommended")}</span></div>
            <div><strong data-testid="bd-sessions-left">{left}</strong><span>{t("s27.bd.glass.left")}</span></div>
          </div>
          <a className="b-gold" href="#bd-sessions">{t("s27.bd.glass.cta")}</a>
        </aside>
      )}
    </section>
  );
}

function EmptyStudy({ journeyState }: { journeyState: BeyondProps["journeyState"] }) {
  const { t } = useS27T();
  return (
    <section className="state" data-testid="beyond-empty">
      <h2>{t("s27.bd.empty.title")}</h2>
      <p>{journeyState === "unavailable" || journeyState === "failed" ? t("s27.bd.empty.journey") : t("s27.bd.empty.text")}</p>
      <button type="button" className="b2" onClick={() => askAssistant(t("s27.bd.ask.q1"))} data-testid="beyond-empty-ask">{t("s27.bd.empty.ask")}</button>
    </section>
  );
}

function Postcards({ goal, kind }: { goal: PostSecondaryGoal; kind: BeyondKind }) {
  const { t } = useS27T();
  if (goal.targets.length === 0) return <EmptyStudy journeyState="ready" />;
  return (
    <section className="bd-sec" aria-labelledby="pc-h" data-testid="beyond-postcards">
      <div className="bd-sh">
        <Eyebrow>{t("s27.bd.pc.eyebrow")}</Eyebrow>
        <h2 id="pc-h">{t(`s27.bd.pc.title.${kind}` as TranslationKey)}</h2>
        <p>{t("s27.bd.pc.intro", { n: goal.targets.length + goal.alsoReviewed.length, m: goal.targets.length })}</p>
      </div>
      <div className="postcards">
        {goal.targets.map((u, i) => (
          <article className="pcard" key={`${u.name}-${i}`}>
            <div className="pc-art">
              <PostcardArt kind={artForIndex(i)} id={`pc${i}`} />
              <span className="pc-rank">{t("s27.bd.pc.priority", { n: i + 1, track: u.track })}</span>
              <span className="pc-city"><small>{t("s27.bd.pc.of", { i: i + 1, n: goal.targets.length })}</small>{u.city}</span>
            </div>
            <div className="pc-body">
              <h3>{u.name}</h3>
              <span className="pc-prog">{u.program}</span>
              <p>{u.why}</p>
              <p className="adm">{u.admission}</p>
              {u.url && /^https?:\/\//i.test(u.url) && <a className="link" href={u.url} target="_blank" rel="noopener noreferrer">{t("s27.bd.pc.see")} →</a>}
            </div>
          </article>
        ))}
      </div>
      {goal.alsoReviewed.length > 0 && <p className="also">{t("s27.bd.pc.also")} <b>{goal.alsoReviewed.join(" · ")}</b></p>}
    </section>
  );
}

function Timeline({ kind, goal, finish, week, figures, required }: { kind: BeyondKind; goal: PostSecondaryGoal | null; finish: string | null; week: number | null; figures: ReturnType<typeof creditFigures> | null; required: number | null }) {
  const { t, lang, num } = useS27T();
  const nodes = buildTimeline({ kind, finishOn: finish, week });
  const field = goal?.field ?? null;
  const text = (id: string): { when: string; title: string; sub: string } => {
    switch (id) {
      case "today": return {
        when: week ? t("s27.bd.tl.today", { n: week }) : t("s27.bd.tl.todayNoWeek"),
        title: figures ? t("s27.bd.tl.flying") : t("s27.bd.tl.studying"),
        sub: figures ? t("s27.bd.tl.credits", { c: num(figures.confirmed), r: num(figures.required) }) : "",
      };
      case "finish": return {
        when: finish ? t("s27.bd.tl.finishEst", { date: formatDay(finish, lang) }) : t("s27.bd.tl.afterFinish"),
        title: t(`s27.bd.tl.finish.${kind === "bachelor" ? "bachelor" : "diploma"}` as TranslationKey),
        sub: kind === "bachelor" ? t("s27.bd.tl.finishSub.bachelor") : t("s27.bd.tl.finishSub.diploma", { n: required ? num(required) : "" }),
      };
      case "apply": return { when: t("s27.bd.tl.afterFinish"), title: t("s27.bd.tl.apply"), sub: t("s27.bd.tl.applySub") };
      case "begins": return { when: t("s27.bd.tl.nextIntake"), title: kind === "bachelor" ? t("s27.bd.tl.beginsBachelor") : t("s27.bd.tl.begins"), sub: t("s27.bd.tl.beginsSub") };
      case "degree": return {
        when: t("s27.bd.tl.during"),
        title: t(`s27.bd.tl.degree.${kind === "bachelor" ? "bachelor" : "diploma"}` as TranslationKey),
        sub: field && goal ? t("s27.bd.tl.degreeSub", { field, region: goal.region }) : t("s27.bd.tl.degreeSubNone"),
      };
      default: return { when: t("s27.bd.tl.then"), title: t("s27.bd.tl.role"), sub: field ? t("s27.bd.tl.roleSub", { field }) : t("s27.bd.tl.roleSubNone") };
    }
  };
  return (
    <section className="bd-sec" aria-labelledby="tl-h" data-testid="beyond-timeline">
      <div className="bd-sh"><Eyebrow>{t("s27.bd.tl.eyebrow")}</Eyebrow><h2 id="tl-h">{t("s27.bd.tl.title")}</h2><p>{t(kind === "bachelor" ? "s27.bd.tl.introBachelor" : "s27.bd.tl.intro")}</p></div>
      <div className="tl" data-testid="beyond-future-timeline">
        {nodes.map((n) => {
          const x = text(n.id);
          return <div key={n.id} className={`tl-n ${n.tone}`}><span className="dot" /><span className="when">{x.when}</span><b>{x.title}</b>{x.sub && <span>{x.sub}</span>}</div>;
        })}
      </div>
    </section>
  );
}

function Careers({ goal }: { goal: PostSecondaryGoal }) {
  const { t } = useS27T();
  const cards = careersFor(goal);
  if (cards.length === 0) return null;
  return (
    <section className="bd-sec" aria-labelledby="cg-h" data-testid="beyond-careers">
      <div className="bd-sh"><Eyebrow>{t("s27.bd.car.eyebrow", { field: goal.field })}</Eyebrow><h2 id="cg-h">{t("s27.bd.car.title")}</h2></div>
      <div className="careers">
        {cards.map((c) => (
          <article className="career" key={c.id}>
            <span className="ci">{SVG_ICON(c.icon)}</span>
            <h3>{t(`s27.bd.car.${c.id}.t` as TranslationKey)}</h3>
            <p>{t(`s27.bd.car.${c.id}.d` as TranslationKey)}</p>
            <span className="wh">{t(`s27.bd.car.${c.id}.w` as TranslationKey)}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function Pathway({ kind, goal, required }: { kind: BeyondKind; goal: PostSecondaryGoal | null; required: number | null }) {
  const { t, num } = useS27T();
  const region = goal ? REGION_PATHS[normaliseRegion(goal.region)] : undefined;
  const key = goal ? normaliseRegion(goal.region) : "";
  const arrow = <i aria-hidden="true" />;
  return (
    <section className="card" aria-labelledby="pw-h" data-testid="beyond-pathway">
      <Eyebrow>{t("s27.bd.pw.eyebrow")}</Eyebrow>
      <h2 id="pw-h" className="h2s">{t(kind === "bachelor" ? "s27.bd.pw.titleBachelor" : "s27.bd.pw.title")}</h2>
      {region && kind === "diploma" && goal && (
        <div className="path"><span className="k">{t("s27.bd.pw.usual", { region: goal.region })}</span>
          <div className="steps">
            {region.usual.map((s, i) => <React.Fragment key={s}>{i > 0 && arrow}<span>{t(`s27.bd.pw.${key}.${s}` as TranslationKey)}<small>{t(`s27.bd.pw.${key}.${s}Sub` as TranslationKey)}</small></span></React.Fragment>)}
          </div>
        </div>
      )}
      <div className="path you"><span className="k">{t("s27.bd.pw.yours")}</span>
        <div className="steps">
          {region && kind === "diploma" ? (
            <><span className="dark">{t("s27.bd.pw.quebec.yourDiploma")}<small>{t("s27.bd.pw.quebec.yourDiplomaSub")}</small></span>{arrow}<span className="gold">{t("s27.bd.pw.quebec.yourUni")}<small>{t("s27.bd.pw.quebec.yourUniSub")}</small></span></>
          ) : kind === "bachelor" ? (
            <><span className="dark">{t("s27.bd.pw.bachelor.from")}</span>{arrow}<span className="gold">{t("s27.bd.pw.bachelor.to")}<small>{t("s27.bd.pw.bachelor.toSub")}</small></span></>
          ) : (
            <><span className="dark">{t("s27.bd.pw.generic.from")}{required ? <small>{t("s27.bd.pw.generic.fromSub", { n: num(required) })}</small> : null}</span>{arrow}<span className="gold">{t("s27.bd.pw.generic.to")}<small>{t("s27.bd.pw.generic.toSub")}</small></span></>
          )}
        </div>
      </div>
      <p className="pnote">{t("s27.bd.pw.note")}</p>
    </section>
  );
}

function Checklist({ journey, transcript, bachelor }: { journey: StudentJourneyView | null; transcript: string | null; bachelor: boolean }) {
  const { t, lang } = useS27T();
  const items = buildChecklist({ agreement: journey?.agreement ?? null, sessions: journey?.sessions ?? [], checkpoints: journey?.checkpoints ?? [], transcriptStatus: transcript });
  const chip = (i: (typeof items)[number]): { text: string; cls: string } => {
    switch (i.id) {
      case "program": return i.state === "part" ? { text: t("s27.bd.ck.chip.inProgress"), cls: "wait" } : { text: t("s27.bd.ck.chip.notStarted"), cls: "plan" };
      case "language": return i.state === "done" ? { text: t("s27.bd.ck.chip.done"), cls: "ok" } : i.detail.on ? { text: t("s27.bd.ck.chip.due", { date: formatDay(i.detail.on, lang) }), cls: "wait" } : { text: t("s27.bd.ck.chip.notStarted"), cls: "plan" };
      case "transcript": return i.state === "done" ? { text: t("s27.bd.ck.chip.ready"), cls: "ok" } : { text: t(bachelor ? "s27.bd.ck.chip.afterBachelor" : "s27.bd.ck.chip.afterDiploma"), cls: "plan" };
      case "profile": return { text: t(bachelor ? "s27.bd.ck.chip.afterBachelor" : "s27.bd.ck.chip.afterDiploma"), cls: "plan" };
      default: return i.detail.on ? { text: t("s27.bd.ck.chip.on", { date: formatDay(i.detail.on, lang) }), cls: "wait" } : { text: t(bachelor ? "s27.bd.ck.chip.soonBachelor" : "s27.bd.ck.chip.soon"), cls: "plan" };
    }
  };
  return (
    <section className="card" aria-labelledby="ck-h" data-testid="beyond-checklist">
      <Eyebrow>{t("s27.bd.ck.eyebrow")}</Eyebrow>
      <h2 id="ck-h" className="h2s">{t("s27.bd.ck.title")}</h2>
      <div className="check">
        {items.map((i) => {
          const c = chip(i);
          return (
            <div key={i.id} className={`ck ${i.state}`}>
              <span className="ic" aria-hidden="true">{i.state === "done" ? <svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10" /></svg> : i.state === "lock" ? <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg> : <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="currentColor" /></svg>}</span>
              <span><b>{t(`s27.bd.ck.${i.id}` as TranslationKey)}</b><span>{bachelor && i.id === "dates" ? t("s27.bd.ck.datesTextBachelor") : t(`s27.bd.ck.${i.id}Text` as TranslationKey)}</span></span>
              <span className={`pill ${c.cls}`}>{c.text}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Sessions(p: BeyondProps & { agreement: StudentJourneyView["agreement"]; goal: PostSecondaryGoal | null }) {
  const { t, lang, pl } = useS27T();
  const a = p.agreement;
  const sessions = p.journey?.sessions ?? [];
  const live = sessions.filter((s) => s.status !== "cancelled");
  const slots = useMemo(() => candidateSlots(p.now, live.map((s) => s.slotAt)), [p.now, live.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pick, setPick] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const left = sessionsLeft(a);
  const questions = prepQuestions(p.goal);
  const toggle = (q: string, option: string, multi: boolean) =>
    setAnswers((cur) => {
      const have = cur[q] ?? [];
      const next = have.includes(option) ? have.filter((x) => x !== option) : multi ? [...have, option] : [option];
      return { ...cur, [q]: next };
    });
  const book = async () => {
    if (pick === null || busy) return;
    const slot = slots[pick]!;
    setBusy(true);
    const res = await p.onBook(slot, prepPayload(answers));
    setBusy(false);
    if (res.ok) {
      p.notify(t("s27.bd.ses.toast"), t("s27.bd.ses.toastText", { when: formatSlotLong(slot.toISOString(), lang) }));
      setPick(null);
    } else p.notify(t("s27.bd.ses.toast"), t(`s27.bd.ses.err.${res.kind}` as TranslationKey), true);
  };
  const optLabel = (q: string, id: string, label?: string) => label ?? t(`s27.bd.ses.o.${id}` as TranslationKey);
  return (
    <section className="card sessions" id="bd-sessions" aria-labelledby="ss-h" data-testid="beyond-sessions">
      <div className="ses-head">
        <div>
          <Eyebrow>{t("s27.bd.ses.eyebrow")}</Eyebrow>
          <h2 id="ss-h" className="h2s">{a ? pl("s27.bd.ses.title", a.orientationSessionsIncluded) : t("s27.bd.ses.none")}</h2>
          <p className="small">{t("s27.bd.ses.sub")}</p>
        </div>
        {a && <div className="ses-count"><b data-testid="bd-sessions-used">{a.orientationSessionsUsed}</b><span>{t("s27.bd.ses.counter", { n: a.orientationSessionsIncluded })}</span></div>}
      </div>
      {!a ? (
        <p className="notice" data-testid="bd-sessions-unavailable">{t("s27.bd.ses.unavailable")}</p>
      ) : (
        <div className="ses-grid">
          <div className="ses-col">
            <span className="k">{t("s27.bd.ses.pick")}</span>
            <div className="slots" role="group" aria-label={t("s27.bd.ses.pick")}>
              {slots.map((s, i) => {
                const f = formatSlot(s.toISOString(), lang);
                return <button type="button" key={s.toISOString()} className="slot" aria-pressed={pick === i} disabled={left === 0} onClick={() => setPick(i)} data-testid={`slot-${i}`}><b>{f.day}</b>{f.time}</button>;
              })}
            </div>
            {pick === null && left > 0 && <p className="small hint" data-testid="bd-book-hint">{t("s27.bd.ses.pickHint")}</p>}
            <div className="btns">
              <button type="button" className="b1" disabled={pick === null || left === 0 || busy} onClick={() => void book()} data-testid="bd-book">
                {left === 0 ? t("s27.bd.ses.allBooked") : busy ? t("s27.bd.ses.booking") : t("s27.bd.ses.book", { n: a.orientationSessionsUsed + 1 })}
              </button>
              {p.whatsapp && <a className="b2" href={p.whatsapp} target="_blank" rel="noopener noreferrer">{t("s27.bd.ses.whatsapp")}</a>}
            </div>
          </div>
          <div className="ses-col">
            <span className="k">{t("s27.bd.ses.prep")}</span>
            <div>
              {questions.map((q) => (
                <div className="pq" key={q.id} role="group" aria-label={t(`s27.bd.ses.q.${q.id}` as TranslationKey)}>
                  <span>{t(`s27.bd.ses.q.${q.id}` as TranslationKey)}</span>
                  <div className="opts">
                    {q.options.map((o) => {
                      const label = optLabel(q.id, o.id, o.label);
                      return <button type="button" key={o.id} aria-pressed={(answers[q.id] ?? []).includes(label)} onClick={() => toggle(q.id, label, q.multi)}>{label}</button>;
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="ses-col">
            <span className="k">{t("s27.bd.ses.after")}</span>
            <div className="notes" data-testid="bd-notes">
              {sessions.length === 0 ? <p>{t("s27.bd.ses.afterEmpty")}</p> : sessions.map((s, i) => (
                <p key={s.id}>
                  <b>{t("s27.bd.ses.row", { n: i + 1, when: formatSlotLong(s.slotAt, lang) })}</b><br />
                  {t(`s27.bd.ses.status.${s.status}` as TranslationKey)}
                  {s.notes ? <><br />{s.notes}</> : s.status === "completed" ? null : <><br />{t("s27.bd.ses.noNotes")}</>}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Services({ goal, onService, notify, bachelor }: { goal: PostSecondaryGoal | null; onService: BeyondProps["onService"]; notify: BeyondProps["notify"]; bachelor: boolean }) {
  const { t } = useS27T();
  const [busy, setBusy] = useState<ServiceId | null>(null);
  const title = (id: ServiceId) => (id === "relocation" ? (goal ? t("s27.bd.svc.relocation.region", { region: goal.region }) : t("s27.bd.svc.relocation")) : t(`s27.bd.svc.${id}` as TranslationKey));
  const ask = async (id: ServiceId) => {
    setBusy(id);
    const res = await onService(id, title(id));
    setBusy(null);
    if (res.ok) notify(t("s27.bd.svc.sent"), t("s27.bd.svc.sentText", { n: res.ticketNumber }));
    else notify(t("s27.bd.svc.failed"), res.message, true);
  };
  return (
    <section className="alacarte" aria-labelledby="ac-h2" data-testid="beyond-services">
      <div className="ac-head">
        <LumiereOrb size={56} />
        <div><span className="eyebrow bd-eye">{t("s27.bd.svc.eyebrow")}</span><h2 id="ac-h2">{t("s27.bd.svc.title")}</h2><p>{t("s27.bd.svc.text")}</p></div>
      </div>
      <div className="services">
        {SERVICES.map((s) => (
          <article className="svc" key={s.id}>
            <span className="si">{SVG_ICON(s.icon)}</span>
            <h3>{title(s.id)}</h3>
            <ul>{[1, 2, 3].map((n) => <li key={n}>{t(`s27.bd.svc.${s.id}.${n}` as TranslationKey)}</li>)}</ul>
            <span className="lockl"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>{t(bachelor ? "s27.bd.svc.lockBachelor" : "s27.bd.svc.lock")}</span>
            <button type="button" className="b2l" disabled={busy !== null} onClick={() => void ask(s.id)} data-testid={`svc-${s.id}`}>{t("s27.bd.svc.ask")}</button>
          </article>
        ))}
      </div>
      <p className="ac-foot">{t(bachelor ? "s27.bd.svc.footBachelor" : "s27.bd.svc.foot")}</p>
    </section>
  );
}

function AskFuture() {
  const { t } = useS27T();
  return (
    <section className="card askfuture" data-testid="beyond-ask">
      <div className="ai-head"><LumiereOrb size={44} /><div><h2>{t("s27.bd.ask.title")}</h2><span>{t("s27.bd.ask.sub")}</span></div></div>
      <div className="qs">{[t("s27.bd.ask.q1"), t("s27.bd.ask.q2"), t("s27.bd.ask.q3")].map((q) => <button key={q} type="button" className="q" onClick={() => askAssistant(q)}>{q}</button>)}</div>
    </section>
  );
}
