/**
 * S29 — Fleet AI copilot (admin). Portfolio questions answered deterministically from the Needs attention store,
 * with [A#] references linking to dossiers, provenance labels, drafts for human review (never sent), and an optional
 * AI summary that only ever receives anonymous totals (the server enforces this).
 */
import React, { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, Copy, Loader2, Sparkles } from "lucide-react";
import { useT, type TranslationKey } from "@/i18n";
import type { FleetAnswer } from "@shared/s29-contract";
import { useFleetAsk } from "@/lib/s29-core-queries";
import { LumiereOrb } from "@/components/s27/lumiere-orb";
import "@/styles/student-s27.css";
import "@/styles/owner-cockpit.css";
import "@/components/s29/core/core.css";

const CHIPS: TranslationKey[] = ["s29.core.fleet.chip.today", "s29.core.fleet.chip.progress", "s29.core.fleet.chip.deadlines", "s29.core.fleet.chip.pace", "s29.core.fleet.chip.documents", "s29.core.fleet.chip.week", "s29.core.fleet.chip.support", "s29.core.fleet.chip.drafts"];

function CopyButton({ text }: { text: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="link" onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => undefined); }} data-testid="fleet-copy">
      {done ? <Check className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />}{done ? t("s29.core.fleet.copied") : t("s29.core.fleet.copy")}
    </button>
  );
}

function Answer({ a }: { a: FleetAnswer }) {
  const { t } = useT();
  const byRef = new Map(a.references.map((r) => [r.ref, r] as const));
  return (
    <div className="s29-answer" data-testid="fleet-answer" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold" style={{ color: "var(--t-heading)" }}>{t("s29.core.fleet.answer")}</h3>
        <span className="s29-tag">{t("s29.core.fleet.notAi")}</span>
      </div>
      <p>{a.summary}</p>
      {a.lines.length ? (
        <ol>
          {a.lines.map((l, i) => (
            <li key={i}>{l.text} {l.refs.map((r) => { const ref = byRef.get(r); return ref ? <Link key={r} href={ref.href} className="link" aria-label={`${r}: ${ref.label}`}>[{r}]</Link> : null; })}</li>
          ))}
        </ol>
      ) : null}
      {a.references.length ? (
        <details>
          <summary>{t("s29.core.fleet.sources")} ({a.references.length})</summary>
          <div className="s29-refs mt-2">
            {a.references.map((r) => (
              <div key={r.ref} className="s29-ref" data-testid="fleet-ref">
                <code>[{r.ref}]</code><span>{r.label}</span>
                <span className="s29-tag">{t(`s29.core.fleet.prov.${r.provenance}` as TranslationKey)}</span>
                <Link href={r.href} className="link">{t("s29.core.fleet.open")} <ArrowRight className="inline h-3 w-3" aria-hidden="true" /></Link>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {a.drafts.length ? (
        <div className="grid gap-2" data-testid="fleet-drafts">
          <h4 className="font-semibold" style={{ color: "var(--t-heading)" }}>{t("s29.core.fleet.drafts")}</h4>
          <p className="s29-help">{t("s29.core.fleet.draftNote")}</p>
          {a.drafts.map((d) => (
            <div key={`${d.studentId}-${d.subject}`} className="s29-draft" data-testid="fleet-draft">
              <div className="flex flex-wrap items-center justify-between gap-2"><b>{d.studentName} — {d.subject}</b><CopyButton text={`${d.subject}\n\n${d.body}`} /></div>
              <pre>{d.body}</pre>
            </div>
          ))}
        </div>
      ) : null}
      {a.ai.mode === "live" && a.ai.text ? (
        <div className="s29-draft" data-testid="fleet-ai"><b><Sparkles className="mr-1 inline h-4 w-4" aria-hidden="true" />{t("s29.core.fleet.ai")}</b><pre>{a.ai.text}</pre></div>
      ) : a.ai.mode === "unavailable" ? <p className="s29-help" data-testid="fleet-ai-unavailable">{t("s29.core.fleet.aiUnavailable", { reason: ["not_configured", "disabled", "budget_exhausted", "provider_error"].includes(a.ai.reason ?? "") ? t(`s29.core.fleet.aiReason.${a.ai.reason}` as TranslationKey) : t("s29.core.fleet.aiReason.provider_error") })}</p> : null}
      <p className="s29-help">{a.privacy}</p>
    </div>
  );
}

export function FleetCopilot() {
  const { t, language } = useT();
  const ask = useFleetAsk();
  const [q, setQ] = useState("");
  const [useAi, setUseAi] = useState(false);
  const [includeDemo, setIncludeDemo] = useState(false);
  const submit = (question: string) => {
    const text = question.trim();
    if (!text) return;
    setQ(text);
    ask.mutate({ question: text, language, includeDemo, useAi });
  };
  return (
    <div className="s27 occ">
      <section className="card s29-fleet" aria-labelledby="fleet-h" data-testid="fleet-copilot">
        <div className="ai-head flex items-center gap-3">
          <LumiereOrb size={42} />
          <div className="min-w-0">
            <span className="eyebrow">{t("s29.core.fleet.eyebrow")}</span>
            <h2 id="fleet-h">{t("s29.core.fleet.title")}</h2>
          </div>
        </div>
        <p className="s29-help">{t("s29.core.fleet.sub")}</p>
        <form className="s29-ask" onSubmit={(e) => { e.preventDefault(); submit(q); }}>
          <label htmlFor="fleet-q" className="sr-only">{t("s29.core.fleet.placeholder")}</label>
          <textarea id="fleet-q" value={q} maxLength={600} onChange={(e) => setQ(e.target.value)} placeholder={t("s29.core.fleet.placeholder")} data-testid="fleet-question" />
          <div className="s29-chips" aria-label={t("s29.core.fleet.title")}>
            {CHIPS.map((k) => <button key={k} type="button" onClick={() => submit(t(k))} data-testid="fleet-chip">{t(k)}</button>)}
          </div>
          <div className="s29-filters">
            <label><input type="checkbox" style={{ accentColor: "var(--t-accent)" }} checked={useAi} onChange={(e) => setUseAi(e.target.checked)} data-testid="fleet-use-ai" />{t("s29.core.fleet.useAi")}</label>
            <label><input type="checkbox" style={{ accentColor: "var(--t-accent)" }} checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} data-testid="fleet-include-demo" />{t("s29.core.fleet.includeDemo")}</label>
            <button type="submit" className="b1 ml-auto" disabled={ask.isPending || !q.trim()} data-testid="fleet-ask">
              {ask.isPending ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t("s29.core.fleet.asking")}</> : t("s29.core.fleet.ask")}
            </button>
          </div>
        </form>
        {ask.isError ? <p role="alert" className="notice">{t("s29.core.fleet.error")}</p> : null}
        {ask.data ? <Answer a={ask.data} /> : null}
        <p className="s29-help">{t("s29.core.fleet.oneStudent")}</p>
      </section>
    </div>
  );
}
