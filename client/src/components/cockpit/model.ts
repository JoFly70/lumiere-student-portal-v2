/**
 * Pure view-model for the High School cockpit (S19). No React, no I/O.
 * Credit figures come from the AcademicProjection (program configuration); nothing here is a constant total.
 * Verified (official) credit is never merged with awaiting / in progress / planned.
 */
import type { AcademicCourse, AcademicNextAction, AcademicProjection } from "@shared/academic-projection-contract";
import type { StudentBillingView } from "@shared/billing-contract";
import { formatMoney } from "@shared/billing-contract";
import {
  CREDIT_STATUSES,
  deckState,
  tallyOf,
  shownHalfUnits,
  subjectTally,
  type CreditStatus,
  type DeckState,
  type Tally,
  type ViewMode,
} from "@/lib/academic-flight-deck-presentation";
import type { TranslationKey } from "@/i18n";

export type T = (key: TranslationKey, vars?: Record<string, string | number>) => string;
export type FormatCredits = (half: number) => string;

// ---------------------------------------------------------------------------------------------- operational sources

export type OpsSource<D> =
  | { readonly state: "loading" }
  | { readonly state: "unavailable" }
  | { readonly state: "not_set_up" }
  | { readonly state: "ready"; readonly data: D };

export interface DocumentsSummary { readonly needAction: number; readonly underReview: number; readonly total: number }
export interface SupportSummary { readonly open: number; readonly waitingOnStudent: number }
export interface PaymentSummary {
  readonly currency: string;
  readonly remainingCents: number;
  readonly nextDue: { readonly dueDate: string; readonly amountCents: number } | null;
  readonly overdue: boolean;
  readonly evidenceUnderReview: number;
}

export interface CockpitOps {
  readonly documents: OpsSource<DocumentsSummary>;
  readonly support: OpsSource<SupportSummary>;
  readonly payments: OpsSource<PaymentSummary>;
}

export const OPS_LOADING: CockpitOps = { documents: { state: "loading" }, support: { state: "loading" }, payments: { state: "loading" } };

export function summarizeDocuments(docs: ReadonlyArray<{ status?: string | null }>): DocumentsSummary {
  const count = (...s: string[]) => docs.filter((d) => s.includes(String(d.status))).length;
  return { needAction: count("rejected", "resubmit_requested"), underReview: count("pending"), total: docs.length };
}

export function summarizeTickets(tickets: ReadonlyArray<{ status?: string | null }>): SupportSummary {
  const open = tickets.filter((x) => x.status !== "resolved" && x.status !== "closed");
  return { open: open.length, waitingOnStudent: open.filter((x) => x.status === "waiting_on_student").length };
}

/** `today` is a YYYY-MM-DD calendar date. */
export function summarizeBilling(view: StudentBillingView, today: string): OpsSource<PaymentSummary> {
  if (view.state === "not_configured") return { state: "not_set_up" };
  const nd = view.nextDue;
  return {
    state: "ready",
    data: {
      currency: view.currency,
      remainingCents: view.remainingCents,
      nextDue: nd ? { dueDate: nd.dueDate, amountCents: nd.amountCents } : null,
      overdue: !!nd && nd.dueDate < today,
      evidenceUnderReview: view.evidenceAwaitingReview.length,
    },
  };
}

// ---------------------------------------------------------------------------------------------- standing

export type StandingTone = "good" | "info" | "warn" | "neutral";
export interface Standing { readonly label: string; readonly detail: string | null; readonly tone: StandingTone }

/** Honest standing: only the server's pace comparison against the published plan. No graduation prediction. */
export function buildStanding(p: AcademicProjection, t: T, formatCredits: FormatCredits): Standing {
  const state = deckState(p);
  if (state === "complete") return { label: t("cockpit.standing.complete"), detail: null, tone: "good" };
  const { status, expectedByNowHalfUnits } = p.pace;
  if (status === "not_configured" || expectedByNowHalfUnits === null) {
    return { label: state === "zero_progress" ? t("cockpit.standing.start") : t("cockpit.standing.noPace"), detail: null, tone: "neutral" };
  }
  const key = status === "behind" ? "cockpit.standing.behind" : status === "ahead" ? "cockpit.standing.ahead" : "cockpit.standing.onTrack";
  return {
    label: t(key),
    detail: t("cockpit.standing.detail", { expected: formatCredits(expectedByNowHalfUnits), official: formatCredits(p.credits.total.officialHalfUnits) }),
    tone: status === "behind" ? "warn" : "good",
  };
}

// ---------------------------------------------------------------------------------------------- hero + coverage

export interface HeroModel {
  readonly state: DeckState;
  readonly mode: ViewMode;
  readonly tally: Tally;
  readonly shown: number;
  readonly figure: string;
  readonly of: string;
  readonly percent: number;
  readonly leftText: string;
  readonly caption: string;
  readonly segments: ReadonlyArray<{ status: Exclude<CreditStatus, "open">; from: number; to: number; halfUnits: number; visible: boolean }>;
  readonly legend: ReadonlyArray<{ status: CreditStatus; label: string; value: string; dim: boolean }>;
  readonly config: string;
  readonly aria: string;
}

const DRAWN = ["official", "awaiting_school", "in_progress", "planned"] as const;

export function buildHero(p: AcademicProjection, mode: ViewMode, t: T, fc: FormatCredits): HeroModel {
  const tally = tallyOf(p.credits.total);
  let cursor = 0;
  const segments = DRAWN.map((status) => {
    const from = cursor;
    cursor += tally[status];
    return { status, from, to: cursor, halfUnits: tally[status], visible: mode === "projected" || status === "official" };
  });
  const shown = shownHalfUnits(tally, mode);
  const notOfficial = Math.max(0, tally.required - tally.official);
  const legend = CREDIT_STATUSES.map((status) => ({
    status,
    label: t(`cockpit.status.${status}`),
    value: fc(tally[status]),
    dim: status !== "open" && mode === "verified" && status !== "official",
  }));
  const config = t("cockpit.hero.config", {
    total: fc(p.credits.total.requiredHalfUnits),
    core: fc(p.credits.core.requiredHalfUnits),
    elective: fc(p.credits.elective.requiredHalfUnits),
  });
  return {
    state: deckState(p),
    mode,
    tally,
    shown,
    figure: fc(shown),
    of: t("cockpit.hero.of", { total: fc(tally.required) }),
    percent: p.credits.total.officialPercent,
    // required - official = every credit that is not official yet (awaiting school, in progress, planned, AND not started).
    leftText: t(notOfficial > 0 && notOfficial <= 2 ? "cockpit.hero.leftOne" : "cockpit.hero.left", { n: fc(notOfficial) }),
    caption: mode === "verified" ? t("cockpit.hero.captionVerified") : t("cockpit.hero.captionProjected"),
    segments,
    legend,
    config,
    aria: t("cockpit.hero.aria", { total: fc(tally.required), parts: legend.map((l) => `${l.value} ${l.label}`).join(", ") }),
  };
}

export interface CoverageBar {
  readonly key: "core" | "elective";
  readonly label: string;
  readonly text: string;
  readonly tally: Tally;
}

export function buildCoverageBars(p: AcademicProjection, mode: ViewMode, t: T, fc: FormatCredits): CoverageBar[] {
  return (["core", "elective"] as const).map((key) => {
    const tally = tallyOf(p.credits[key]);
    return {
      key,
      label: t(`cockpit.coverage.${key}`),
      tally,
      text: t("cockpit.coverage.of", { n: fc(shownHalfUnits(tally, mode)), total: fc(tally.required) }),
    };
  });
}

export interface SubjectBar {
  readonly subject: string;
  readonly label: string;
  readonly tally: Tally;
  readonly text: string;
  readonly aria: string;
}

export function buildSubjectBars(p: AcademicProjection, mode: ViewMode, t: T, fc: FormatCredits): SubjectBar[] {
  return p.subjects.map((s) => {
    const tally = subjectTally(p, s);
    return {
      subject: s.subject,
      label: s.label,
      tally,
      text: t("cockpit.coverage.of", { n: fc(shownHalfUnits(tally, mode)), total: fc(tally.required) }),
      aria: t("cockpit.subjects.aria", { label: s.label, official: fc(tally.official), required: fc(tally.required) }),
    };
  });
}

export function coursesByBasis(p: AcademicProjection, basis: AcademicCourse["basis"]): AcademicCourse[] {
  return p.subjects.flatMap((s) => s.courses).filter((c) => c.basis === basis);
}

// ---------------------------------------------------------------------------------------------- milestones

export interface CockpitMilestone { readonly month: string; readonly credits: string; readonly state: "done" | "current" | "upcoming"; readonly gap: string | null }

export function buildCockpitMilestones(p: AcademicProjection, fc: FormatCredits): CockpitMilestone[] {
  const sorted = [...p.milestones].sort((a, b) => a.month.localeCompare(b.month));
  const firstOpen = sorted.findIndex((m) => !m.reached);
  const official = p.credits.total.officialHalfUnits;
  return sorted.map((m, i) => ({
    month: m.month,
    credits: fc(m.cumulativeHalfUnits),
    state: m.reached ? "done" : i === firstOpen ? "current" : "upcoming",
    gap: m.reached ? null : fc(Math.max(0, m.cumulativeHalfUnits - official)),
  }));
}

// ---------------------------------------------------------------------------------------------- next actions

export interface CockpitAction {
  readonly key: string;
  readonly kindLabel: string;
  readonly message: string;
  readonly href: string;
  readonly attention: boolean;
  readonly due: string | null;
  readonly waitingOnLumiere: boolean;
}

const PROJECTION_HREF: Record<AcademicNextAction["kind"], string> = {
  next_task: "/high-school",
  overdue_task: "/high-school",
  behind_pace: "/high-school",
  retake_required: "/high-school",
  not_passed: "/high-school",
  documents_requested: "/documents",
  support_open: "/support",
};
const ATTENTION = new Set<AcademicNextAction["kind"]>(["overdue_task", "behind_pace", "retake_required", "not_passed", "documents_requested"]);

export interface ActionFormat { readonly date: (iso: string) => string; readonly money: (cents: number, currency: string) => string }

/** Top actions, most urgent first: attention items, operational items, then plain next tasks. Max `limit`. */
export function buildCockpitActions(p: AcademicProjection, ops: CockpitOps, t: T, fmt: ActionFormat, limit = 3): CockpitAction[] {
  const fromProjection: CockpitAction[] = p.nextActions.map((a, i) => ({
    key: `${a.kind}-${a.courseKey ?? "x"}-${a.taskKey ?? i}`,
    kindLabel: t(`cockpit.actions.kind.${a.kind}`),
    message: a.message,
    href: PROJECTION_HREF[a.kind],
    attention: ATTENTION.has(a.kind),
    due: a.dueDate ? t("cockpit.actions.due", { date: fmt.date(a.dueDate) }) : null,
    waitingOnLumiere: a.owner === "lumiere",
  }));
  const hasDocsAction = p.nextActions.some((a) => a.kind === "documents_requested");
  const hasSupportAction = p.nextActions.some((a) => a.kind === "support_open");
  const operational: CockpitAction[] = [];
  if (ops.documents.state === "ready" && ops.documents.data.needAction > 0 && !hasDocsAction) {
    operational.push({ key: "ops-docs", kindLabel: t("cockpit.actions.docsKind"), message: t("cockpit.actions.docs", { n: ops.documents.data.needAction }), href: "/documents", attention: true, due: null, waitingOnLumiere: false });
  }
  if (ops.support.state === "ready" && ops.support.data.waitingOnStudent > 0 && !hasSupportAction) {
    operational.push({ key: "ops-support", kindLabel: t("cockpit.actions.kind.support_open"), message: t("cockpit.actions.support", { n: ops.support.data.waitingOnStudent }), href: "/support", attention: true, due: null, waitingOnLumiere: false });
  }
  if (ops.payments.state === "ready" && ops.payments.data.nextDue) {
    const d = ops.payments.data;
    operational.push({
      key: "ops-pay",
      kindLabel: t("cockpit.actions.payKind"),
      message: t("cockpit.actions.pay", { amount: fmt.money(d.nextDue!.amountCents, d.currency), date: fmt.date(d.nextDue!.dueDate) }),
      href: "/billing",
      attention: d.overdue,
      due: null,
      waitingOnLumiere: false,
    });
  }
  const all = [...fromProjection, ...operational];
  const rank = (a: CockpitAction) => (a.attention ? 0 : a.key.startsWith("ops-") ? 1 : 2);
  return all
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
    .slice(0, limit)
    .map((x) => x.a);
}

export function formatMoneyLocale(cents: number, currency: string, language: string): string {
  return formatMoney(cents, currency, language);
}
