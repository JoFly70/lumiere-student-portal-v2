/**
 * Program-agnostic building blocks of the S27 Flight Deck cockpit, shared by the high-school deck (flight-deck.tsx) and
 * the degree deck (degree-flight-deck.tsx): greeting + status pills, countdown cards, radar chips, Up next, Next 7 days,
 * the Ask Lumière card, checkpoints, documents and billing. Everything here is prop-driven and renders only what it is
 * given; the two decks decide which data to pass and which routes the links point to.
 */
import React, { useState } from "react";
import { Link } from "wouter";
import type { CheckpointKey, StudentJourneyView } from "@shared/s27-contract";
import type { StudentBillingView } from "@shared/billing-contract";
import { formatMoney } from "@shared/billing-contract";
import { askAssistant } from "@/components/academic-assistant/logic";
import { docTypeLabel } from "@/lib/document-type-labels";
import { checkpointProgress, weekAgenda, type AgendaTask, type AlertCard, type RadarChip } from "@/lib/s27/cockpit-model";
import { dayPart, daysBetween, formatDay } from "@/lib/s27/dates";
import { useS27T } from "@/lib/s27/i18n-util";
import type { TranslationKey } from "@/i18n";
import { Eyebrow, Ring, SEVERITY_COLOR } from "./ui";
import { LumiereOrb } from "./lumiere-orb";

export type JourneyState = "ready" | "loading" | "unavailable" | "failed";
export interface DeckDoc { readonly id: string; readonly doc_type: string; readonly file_name: string; readonly status: string }
export type DeckBilling = StudentBillingView | "unavailable" | "loading" | null;

/** Where a deck's task links go: the program's own roadmap page. */
export interface DeckLinks {
  readonly roadmap: string;
  readonly log: (courseKey: string) => string;
}
export const HS_DECK_LINKS: DeckLinks = { roadmap: "/high-school", log: (k) => `/high-school?log=${encodeURIComponent(k)}` };

/** Greeting row: eyebrow, "Good morning, Name." and the status pills (passed in, since each deck has its own). */
export function DeckHead({ firstName, hour, children }: { firstName: string | null; hour: number; children?: React.ReactNode }) {
  const { t } = useS27T();
  const hello = t(`s27.fd.hello.${dayPart(hour)}` as TranslationKey);
  return (
    <section className="deck-head">
      <div>
        <Eyebrow>{t("s27.fd.eyebrow")}</Eyebrow>
        <h1 data-testid="fd-greeting">{firstName ? <>{hello}, <em>{firstName}</em>.</> : <>{hello}.</>}</h1>
      </div>
      <div className="status" data-testid="fd-status">{children}</div>
    </section>
  );
}

// ── countdown cards ─────────────────────────────────────────────────────────

export function AlertCardView({ card, credits, accessMonths, links }: { card: AlertCard; credits: number | null; accessMonths: number | null; links: DeckLinks }) {
  const { t, lang, pl, num } = useS27T();
  const color = SEVERITY_COLOR[card.severity];
  const due = card.dueOn ? t("s27.alert.due", { date: formatDay(card.dueOn, lang, "weekday") }) : "";
  let title = "";
  let text = "";
  let action: { href: string; label: string } = { href: links.roadmap, label: t("s27.act.roadmap") };
  if (card.kind === "task") {
    title = `${card.subtitle} · ${card.title}`;
    const credit = credits !== null ? pl("s27.alert.task.credit", credits, { n: num(credits) }) : "";
    text = [t("s27.alert.task.d", { credit }).trim(), card.dueOn ? due : t("s27.alert.noDate")].join(" ");
    action = { href: links.log(card.courseKey ?? ""), label: t("s27.act.roadmap") };
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

export function RadarChipView({ chip, journey }: { chip: RadarChip; journey: StudentJourneyView | null }) {
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


// ── up next, next 7 days ────────────────────────────────────────────────────

export interface NextItem {
  readonly title: string;
  /** Display name of the course (already shortened). */
  readonly courseName: string;
  /** Credits the course counts for, or null when unknown. */
  readonly credits: number | null;
  readonly dueDate: string | null;
  readonly courseKey: string;
}

export function UpNextCard({ item, links }: { item: NextItem | null; links: DeckLinks }) {
  const { t, lang, pl, num } = useS27T();
  if (!item) {
    return (
      <section className="card next" aria-labelledby="nx-h" data-testid="fd-next">
        <Eyebrow>{t("s27.next.eyebrow")}</Eyebrow>
        <h3 id="nx-h">{t("s27.next.none")}</h3>
        <p>{t("s27.next.noneText")}</p>
      </section>
    );
  }
  const name = item.courseName;
  const credit = item.credits !== null ? pl("s27.next.credit", item.credits, { n: num(item.credits) }) : "";
  return (
    <section className="card next" aria-labelledby="nx-h" data-testid="fd-next">
      <Eyebrow>{t("s27.next.eyebrowCourse", { course: name })}</Eyebrow>
      <h3 id="nx-h">{item.title}</h3>
      <p>{item.dueDate ? t("s27.next.text", { date: formatDay(item.dueDate, lang, "long"), course: name, credit }) : t("s27.next.textNoDate", { course: name, credit })}</p>
      <div className="btns">
        <Link className="b1" href={links.log(item.courseKey)} data-testid="fd-next-log">{t("s27.next.open")}</Link>
        <Link className="b2" href={links.roadmap}>{t("s27.next.roadmap")}</Link>
      </div>
    </section>
  );
}

/** `open` carries display-ready course names in `courseTitle`. */
export function WeekCard({ open, today }: { open: readonly AgendaTask[]; today: string }) {
  const { t, lang } = useS27T();
  const all = open;
  const week = weekAgenda(all, today);
  // Nothing due this week: show the nearest dated item after it so the card still answers "what next".
  const later = week.length === 0
    ? all.filter((o) => o.dueDate && o.dueDate > today).sort((x, y) => String(x.dueDate).localeCompare(String(y.dueDate)))[0]
    : undefined;
  const items = week.length ? week : later ? [later] : [];
  return (
    <section className="card wk-card" aria-labelledby="wk-h" data-testid="fd-week">
      <div className="ch"><h2 id="wk-h">{t("s27.week.title")}</h2><span className="meta">{t("s27.week.count", { n: week.length })}</span></div>
      <div className="agenda">
        {week.length === 0 && <p className="small">{t("s27.week.empty")}</p>}
        {items.map((it, i) => {
          const d = it.dueDate ? daysBetween(today, it.dueDate) : null;
          const pill = it.overdue ? { cls: "crit", text: t("s27.week.late") } : i === 0 ? { cls: "wait", text: t("s27.week.next") } : d === 0 ? { cls: "wait", text: t("s27.week.today") } : { cls: "plan", text: t("s27.week.in", { n: d ?? 0 }) };
          return (
            <div key={`${it.courseKey}:${it.key}`} className={`ag${d === 0 ? " today" : ""}`}>
              <span className="dt">{it.dueDate ? formatDay(it.dueDate, lang, "weekday").split(" ")[0] : ""}<b>{it.dueDate ? it.dueDate.slice(8, 10).replace(/^0/, "") : "–"}</b></span>
              <span className="w">{it.title}<span>{it.courseTitle}</span></span>
              <span className={`pill ${pill.cls}`}>{pill.text}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function AskCard() {
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

export function CheckpointsCard({ journey, journeyState }: { journey: StudentJourneyView | null; journeyState: JourneyState }) {
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

export function DocumentsCard({ documents: docsIn, agreement, today }: { documents: readonly DeckDoc[] | null | "loading"; agreement: StudentJourneyView["agreement"]; today: string }) {
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

export function BillingCard({ billing }: { billing: DeckBilling }) {
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

export interface CreditRow {
  readonly key: string;
  readonly label: string;
  /** Required and done, in any one unit; only their ratio is drawn. */
  readonly req: number;
  readonly done: number;
  /** Share of `req` that is waiting / planned (hatched segment). */
  readonly wait: number;
  /** Text at the end of the row, e.g. "36/36". */
  readonly figure: string;
}

/** Credits card: a ring of confirmed (solid) and secondary (waiting / planned, light) credits plus one bar per requirement. */
export function CreditsGaugeCard(p: {
  title: string; linkHref: string; linkLabel: string;
  confirmed: number; secondary: number; required: number;
  ariaLabel: string; rows: readonly CreditRow[];
  /** [confirmed, secondary, still to earn] legend labels. */
  legend: readonly [string, string, string];
  /** Extra content under the legend (e.g. a residency note). */
  footer?: React.ReactNode;
  wideRows?: boolean;
}) {
  const { t, num } = useS27T();
  const r = 50;
  const c = 2 * Math.PI * r;
  const f = (n: number) => (p.required > 0 ? Math.min(1, n / p.required) : 0);
  return (
    <section className="card" aria-labelledby="cr-h" data-testid="fd-credits">
      <div className="ch"><h2 id="cr-h">{p.title}</h2><Link className="link" href={p.linkHref}>{p.linkLabel} →</Link></div>
      <div className="gauge-wrap">
        <div className="gauge" role="img" aria-label={p.ariaLabel}>
          <svg viewBox="0 0 118 118" aria-hidden="true">
            <circle cx="59" cy="59" r={r} fill="none" stroke="var(--t-panel-3)" strokeWidth="10" />
            <circle cx="59" cy="59" r={r} fill="none" stroke="var(--t-accent-line)" strokeWidth="10" strokeDasharray={`${(c * f(p.confirmed + p.secondary)).toFixed(1)} ${c.toFixed(1)}`} />
            <circle cx="59" cy="59" r={r} fill="none" stroke="var(--t-accent)" strokeWidth="10" strokeDasharray={`${(c * f(p.confirmed)).toFixed(1)} ${c.toFixed(1)}`} />
          </svg>
          <b>{num(p.confirmed)}<small>{t("s27.cr.of", { n: num(p.required) })}</small></b>
        </div>
        <div className={p.wideRows ? "subj wide" : "subj"}>
          {p.rows.map((s) => (
            <div key={s.key} data-testid={`fd-credit-row-${s.key}`}>
              <span>{s.label}</span>
              <span className="bar"><i style={{ width: `${(s.done / s.req) * 100}%` }} /><u style={{ width: `${(s.wait / s.req) * 100}%` }} /></span>
              <span className="n">{s.figure}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="legend"><span><i />{p.legend[0]}</span><span><i className="w" />{p.legend[1]}</span><span><i className="p" />{p.legend[2]}</span></div>
      {p.footer}
    </section>
  );
}
