/**
 * YOUR FOUNDATION: prior credentials and the credit ladder. All credit numbers
 * come from view.foundation.ladder (the canonical record). The Flight Deck owns
 * this section in full; the Roadmap links to it.
 *
 * Colour language (same everywhere): Verified = official charcoal, Earned (applied) =
 * green, Waiting for verification = teal hatched, Planned = blue dashed. The
 * Verified bar is ALWAYS charcoal; surplus is the hatched end of it, never a
 * colour change.
 */
import React from "react";
import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentFoundationView } from "@shared/student-roadmap-contract";
import {
  barFraction,
  hasPositive,
  ladderScale,
  stillToPlan,
} from "@/pages/student-roadmap-presentation";
import { formatDecimal } from "@/pages/student-progress-presentation";
import { useS27T } from "@/lib/s27/i18n-util";
import type { TranslationKey } from "@/i18n";
import { Disclosure, SectionHeading, StatusPill, cardClass } from "./student-ui";


type Ladder = StudentFoundationView["ladder"];

/** Translated text helpers (the English presentation helpers stay for tests; the screen renders from keys). */
function useFoundationText() {
  const { t, lang, pl } = useS27T();
  const k = (key: string, vars?: Record<string, string | number>) => t(`s32.fnd.${key}` as TranslationKey, vars);
  const dec = (v: string | null | undefined): string | null => {
    const d = formatDecimal(v);
    return d === null ? null : lang === "fr" ? d.replace(".", ",") : d;
  };
  const num = (v: string | null | undefined) => Number.parseFloat(String(v));
  const credits = (v: string | null | undefined): string | null => {
    const d = dec(v);
    return d === null ? null : pl("s32.fnd.credit", num(v), { n: d });
  };
  const date = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(d);
  };
  const hund = (v: string | null): number | null => (v === null || !/^\d+(\.\d+)?$/.test(v) ? null : Math.round(Number(v) * 100));
  const fromH = (n: number) => dec(String(n / 100)) ?? String(n / 100);
  return { t, k, lang, pl, dec, credits, date, hund, fromH };
}
type FText = ReturnType<typeof useFoundationText>;

function ladderRows(f: FText, ladder: Ladder) {
  const { k } = f;
  const base = [
    { key: "reported" as const, label: k("rung.reported"), value: ladder.reported, help: k("rung.reported.help") },
    { key: "provisional" as const, label: k("rung.provisional"), value: ladder.provisional, help: k("rung.provisional.help") },
    { key: "verified" as const, label: k("rung.verified"), value: ladder.verified, help: k("rung.verified.help") },
    { key: "applied" as const, label: k("rung.applied"), value: ladder.applied, help: ladder.applied === null ? k("rung.applied.none") : k("rung.applied.help") },
  ];
  const still = stillToPlan(ladder);
  return [
    ...base,
    { key: "planned" as const, label: k("rung.planned"), value: ladder.planned, help: k("rung.planned.help") },
    ...(still ? [{ key: "still" as const, label: k("rung.still"), value: still, help: k("rung.still.help") }] : []),
  ];
}

function totalsSentence(f: FText, ladder: Ladder): string {
  return f.k("totals", { rep: f.credits(ladder.reported) ?? f.credits("0")!, ver: f.dec(ladder.verified) ?? "0", wait: f.dec(ladder.provisional) ?? "0" });
}

function otherCreditNote(f: FText, fnd: StudentFoundationView): string | null {
  const { hund, fromH, pl, k } = f;
  const sum = (xs: (string | null)[]) => xs.reduce<number>((n, v) => n + (hund(v) ?? 0), 0);
  const verifiedListed = sum(fnd.credentials.filter((c) => c.standing === "VERIFIED_APPLIED" || c.standing === "VERIFIED_NOT_APPLIED").map((c) => c.awardedCredits));
  const waitingListed = sum(fnd.credentials.filter((c) => c.standing === "PENDING_VERIFICATION" || c.standing === "NEEDS_REVIEW").map((c) => c.reportedCredits));
  const verifiedOther = (hund(fnd.ladder.verified) ?? 0) - verifiedListed;
  const waitingOther = (hund(fnd.ladder.provisional) ?? 0) - waitingListed;
  const parts: string[] = [];
  if (verifiedOther > 0) parts.push(pl("s32.fnd.other.verified", verifiedOther / 100, { n: fromH(verifiedOther) }));
  if (waitingOther > 0) parts.push(pl("s32.fnd.other.waiting", waitingOther / 100, { n: fromH(waitingOther) }));
  return parts.length ? k("other.note", { parts: parts.join(k("other.and")) }) : null;
}

function stateNote(f: FText, fnd: StudentFoundationView): string | null {
  if (fnd.degreeState === "UNDER_REVIEW") return f.k("note.review");
  if (fnd.degreeState === "NO_ACTIVE_PROGRAM") return f.k("note.noProgram");
  return null;
}

const HATCH = (c: string) => `repeating-linear-gradient(135deg, transparent 0 4px, hsl(var(${c}) / 0.8) 4px 6px)`;
const SEG: Record<string, React.CSSProperties> = {
  reported: { boxShadow: "inset 0 0 0 1.5px hsl(var(--s-line-strong))", background: "transparent" },
  waiting: { background: HATCH("--st-submitted"), boxShadow: "inset 0 0 0 1.5px hsl(var(--st-submitted))" },
  verified: { background: "hsl(var(--st-official))" },
  applied: { background: "hsl(var(--st-applied))" },
  surplus: { background: HATCH("--st-official"), boxShadow: "inset 0 0 0 1.5px hsl(var(--st-official))" },
  planned: { border: "1.5px dashed hsl(var(--st-progress))", background: "transparent" },
  still: { border: "1.5px dotted hsl(var(--s-line-strong))", background: "transparent" },
};

/** Each bar is drawn as the segments it is made of, so "cumulative" is visible. */
function barSegments(key: string, ladder: Ladder, scale: number): { style: string; start: number; width: number }[] {
  const f = (v: string | null) => barFraction(v, scale);
  const verified = f(ladder.verified);
  const waiting = f(ladder.provisional);
  const applied = f(ladder.applied);
  const surplus = f(ladder.surplus);
  if (key === "reported" && hasPositive(ladder.verified) && hasPositive(ladder.provisional)) {
    return [
      { style: "verified", start: 0, width: verified },
      { style: "waiting", start: verified, width: waiting },
    ];
  }
  if (key === "verified" && hasPositive(ladder.applied) && hasPositive(ladder.surplus)) {
    // Same charcoal hue either way: the solid part is applied, the hatched end is surplus.
    return [
      { style: "verified", start: 0, width: applied },
      { style: "surplus", start: applied, width: surplus },
    ];
  }
  if (key === "planned" || key === "still") {
    // Planned starts where Applied ends; "Still to plan" follows it up to what the degree requires.
    const base = applied;
    const planned = f(ladder.planned);
    const start = key === "planned" ? base : Math.min(1, base + planned);
    const width = key === "planned" ? planned : f(stillToPlan(ladder));
    return [{ style: key, start, width: Math.min(width, Math.max(0, 1 - start)) }];
  }
  const single: Record<string, [string, number]> = {
    reported: ["reported", f(ladder.reported)],
    provisional: ["waiting", waiting],
    verified: ["verified", verified],
    applied: ["applied", applied],
    planned: ["planned", f(ladder.planned)],
  };
  const [style, width] = single[key] ?? ["reported", 0];
  return [{ style, start: 0, width }];
}

function Swatch({ kind }: { kind: string }) {
  return <span aria-hidden="true" className="inline-block h-3 w-4 shrink-0 rounded-sm" style={SEG[kind]} />;
}

const SWATCH_FOR: Record<string, string> = {
  reported: "reported",
  provisional: "waiting",
  verified: "verified",
  applied: "applied",
  planned: "planned",
  still: "still",
};

/** Credit ladder: cumulative. Bars share one scale; a tick marks what the degree requires. */
export function CreditLadder({ ladder }: { ladder: Ladder }) {
  const f = useFoundationText();
  const { k, dec, credits } = f;
  const scale = ladderScale(ladder);
  const requiredAt = barFraction(ladder.required, scale);
  const rows = ladderRows(f, ladder);
  const ariaText = [
    ...rows.filter((r) => r.key !== "planned" && r.key !== "still" && r.value !== null).map((r) => `${r.label} ${credits(r.value)}`),
    ...(ladder.required ? [k("ladder.requires", { c: credits(ladder.required) ?? "" })] : []),
  ].join(", ");
  return (
    <div data-testid="credit-ladder" role="group" aria-label={k("ladder.aria", { text: ariaText })}>
      <p className="mb-3 text-sm font-medium text-student-ink" data-testid="ladder-totals">{totalsSentence(f, ladder)}</p>
      <ol className="space-y-3">
        {rows.map((r) => (
          <li key={r.key} data-rung={r.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 font-medium text-student-ink">
                <Swatch kind={SWATCH_FOR[r.key]} />
                {r.label}
              </span>
              <span className="font-serif text-lg text-student-ink" data-testid={`rung-${r.key}`}>
                {r.value === null ? <span className="font-sans text-sm text-student-muted">{k("underReview")}</span> : (dec(r.value) ?? r.value)}
              </span>
            </div>
            <div className="relative mt-1 h-3 w-full rounded-full bg-student-line/60" aria-hidden="true">
              {barSegments(r.key, ladder, scale).map((seg, i) => (
                <span
                  key={i}
                  className="absolute inset-y-0"
                  data-bar={r.key}
                  data-seg={seg.style}
                  style={{
                    left: `${Math.round(seg.start * 1000) / 10}%`,
                    width: `${Math.round(seg.width * 1000) / 10}%`,
                    borderRadius: i === 0 ? "9999px 0 0 9999px" : "0 9999px 9999px 0",
                    ...SEG[seg.style],
                  }}
                />
              ))}
              {ladder.required && (
                <span
                  className="absolute -top-1 bottom-[-4px] w-0.5 bg-student-ink"
                  style={{ left: `calc(${requiredAt * 100}% - 1px)` }}
                />
              )}
            </div>
            <p className="mt-1 text-xs text-student-muted">{r.help}</p>
            {r.key === "verified" && hasPositive(ladder.surplus) && hasPositive(ladder.applied) && (
              <p className="mt-0.5 text-xs font-medium text-student-ink" data-testid="verified-split">
                {k("split", { a: credits(ladder.applied) ?? "", s: credits(ladder.surplus) ?? "" })}
              </p>
            )}
          </li>
        ))}
      </ol>
      {ladder.required && (
        <p className="mt-2 flex items-center gap-2 text-xs text-student-muted">
          <span className="inline-block h-3 w-0.5 bg-student-ink" aria-hidden="true" />
          {k("requires", { c: credits(ladder.required) ?? "" })}
        </p>
      )}
      {hasPositive(ladder.surplus) && (
        <p className="mt-3 rounded-lg bg-st-official-soft px-3 py-2.5 text-sm text-student-ink" data-testid="surplus-note">
          <strong className="font-semibold">{k("surplus", { c: credits(ladder.surplus) ?? "" })}</strong>{k("surplus.tail", { text: k("expl.surplus") })}
        </p>
      )}
    </div>
  );
}

/** One sentence and two numbers: applied of required, and what is still pending. The full ladder sits behind a disclosure. */
function LadderLead({ ladder }: { ladder: Ladder }) {
  const f = useFoundationText();
  const { k, dec, credits } = f;
  const applied = dec(ladder.applied);
  const required = dec(ladder.required);
  const pending: string[] = [];
  if (hasPositive(ladder.provisional)) pending.push(k("lead.waiting", { credits: credits(ladder.provisional) ?? "" }));
  if (hasPositive(ladder.planned)) pending.push(k("lead.planned", { credits: credits(ladder.planned) ?? "" }));
  const lead = applied !== null && required !== null ? k("lead", { a: applied, r: required }) : totalsSentence(f, ladder);
  return (
    <div data-testid="ladder-lead">
      <p className="font-serif text-xl text-student-ink" data-testid="ladder-lead-sentence">{lead}</p>
      {applied !== null && required !== null && (
        <div className="relative mt-2 h-2.5 w-full rounded-full bg-student-line/60" aria-hidden="true">
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ ...SEG.applied, width: `${Math.round(barFraction(ladder.applied, Math.max(Number(formatDecimal(ladder.required)), 1)) * 1000) / 10}%` }} />
        </div>
      )}
      {pending.length > 0 && <p className="mt-2 text-sm text-student-muted" data-testid="ladder-pending">{pending.join(" · ")}</p>}
    </div>
  );
}

export function CredentialsList({ foundation }: { foundation: StudentFoundationView }) {
  const f = useFoundationText();
  const { k, credits, date } = f;
  if (foundation.credentials.length === 0) return null;
  return (
    <ul className="divide-y divide-student-line" aria-label={k("cred.aria")} data-testid="credentials-list">
      {foundation.credentials.map((c) => {
        const standing = c.standing === "VERIFIED_APPLIED" || c.standing === "VERIFIED_NOT_APPLIED"
          ? { label: k("st.verified"), status: "official" as const }
          : c.standing === "NOT_ACCEPTED" ? { label: k("st.notAccepted"), status: "attention" as const } : { label: k("st.waiting"), status: "submitted" as const };
        const amount = c.awardedCredits ?? c.reportedCredits;
        const done = date(c.completedOn);
        return (
          <li key={c.creditRecordId} className="flex flex-wrap items-start justify-between gap-2 py-3" data-testid="credential">
            <div className="flex min-w-0 items-start gap-3">
              <GraduationCap className="mt-0.5 h-5 w-5 shrink-0 text-student-gold-ink" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-student-ink">{c.title}</p>
                <p className="text-sm text-student-muted">
                  {[done ? k("cred.completed", { date: done }) : null, c.sourceTitle].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {amount && <span className="text-sm text-student-muted">{k(c.awardedCredits ? "cred.awarded" : "cred.reported", { credits: credits(amount) ?? "" })}</span>}
              <StatusPill status={standing.status} label={standing.label} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function FoundationSection({
  foundation,
  requirementDetails,
}: {
  foundation: StudentFoundationView;
  requirementDetails?: React.ReactNode;
}) {
  const f = useFoundationText();
  const { k, pl } = f;
  const note = stateNote(f, foundation);
  const other = otherCreditNote(f, foundation);
  const n = foundation.credentials.length;
  const headline = n === 0 ? k("head.none") : pl("s32.fnd.head", n);
  return (
    <section aria-labelledby="foundation-title" id="section-foundation" className="scroll-mt-20 space-y-4" data-testid="foundation-section">
      <SectionHeading
        id="foundation-title"
        eyebrow={k("eyebrow")}
        title={headline}
        description={k("desc")}
      />
      <div className="grid items-start gap-4 lg:grid-cols-5">
        {foundation.credentials.length > 0 && (
          <div className={cn(cardClass, "lg:col-span-3")}>
            <h3 className="mb-1 text-sm font-semibold text-student-ink">{k("cred.title")}</h3>
            <CredentialsList foundation={foundation} />
            {other && (
              <p className="mt-2 border-t border-student-line pt-3 text-sm text-student-muted" data-testid="other-credit-note">
                {other}
              </p>
            )}
          </div>
        )}
        <div className={cn(cardClass, foundation.credentials.length > 0 ? "lg:col-span-2" : "lg:col-span-5")}>
          <h3 className="mb-2 text-sm font-semibold text-student-ink">{k("credits.title")}</h3>
          <LadderLead ladder={foundation.ladder} />
          <Disclosure label={k("ladder.show")} className="mt-1 border-t border-student-line" testId="ladder-full">
            <div className="pt-2">
              <CreditLadder ladder={foundation.ladder} />
            </div>
          </Disclosure>
          {note && <p className="mt-3 text-sm text-student-muted" data-testid="foundation-note">{note}</p>}
          <Disclosure label={k("help.show")} className="mt-2 border-t border-student-line" testId="ladder-help">
            <div className="space-y-2 pb-2 text-sm text-student-muted">
              <p>{k("expl.earned")}</p>
              <p><strong className="font-medium text-student-ink">{k("help.planned")}</strong> {k("expl.planned")}</p>
            </div>
          </Disclosure>
        </div>
      </div>
      {requirementDetails && (
        <div className={cardClass}>
          <Disclosure label={k("req.show")} lazy testId="requirement-details">
            {requirementDetails}
          </Disclosure>
        </div>
      )}
    </section>
  );
}
