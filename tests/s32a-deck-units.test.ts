// @vitest-environment node
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../client/src/components/cockpit/welcome-banner", () => ({
  WelcomeBanner: () => createElement("section", { "data-testid": "welcome-banner-stub" }, "welcome"),
}));

import type { StudentRoadmapItemView, StudentRoadmapPhaseView, StudentRoadmapView } from "../shared/student-roadmap-contract";
import type { StudentDegreeProgressView, StudentRequirementView } from "../shared/student-degree-progress-view";
import { I18nProvider, translate } from "../client/src/i18n";
import { en } from "../client/src/i18n/en";
import { fr } from "../client/src/i18n/fr";
import { formatDay, formatDayInSentence } from "../client/src/lib/s27/dates";
import { isOne, plural } from "../client/src/lib/s27/i18n-util";
import { deadlineDetail, deadlineRule, deadlineTitle, pacePillStatus } from "../client/src/lib/s27/cockpit-model";
import { degreeRequirementRows, requirementShortfalls } from "../client/src/lib/s27/degree-cockpit-model";
import { PlanNotReady, ProgressError, ProgressSkeleton } from "../client/src/components/student-progress/states";
import { RoadmapNotPublished } from "../client/src/components/student-progress/roadmap-states";
import { CheckpointsCard, WeekCard } from "../client/src/components/s27/deck-parts";
import { DegreeFlightDeck } from "../client/src/components/s27/degree-flight-deck";
(globalThis as { React?: unknown }).React = React;
import { s27HsView, s27Journey, S27_TODAY } from "./helpers/s27-fixtures";

const plain = (html: string) => html.replace(/[  ]/g, " ");
const render = (node: React.ReactElement, lang: "en" | "fr") =>
  plain(renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Router, { ssrPath: "/flight-deck" }, createElement(I18nProvider, { initialLanguage: lang }, node)))));
const tFr = (k: string, v?: Record<string, string | number>) => plain(translate("fr", k, v));
const tEn = (k: string, v?: Record<string, string | number>) => translate("en", k, v);

describe("S32-A F06 progress states are translated", () => {
  it("FR: loading, error and plan-not-ready contain the French strings and no English", () => {
    const err = render(createElement(ProgressError, { onRetry: () => undefined }), "fr");
    expect(err).toContain("Nous n’avons pas pu charger votre progression");
    expect(err).toContain("Réessayer");
    expect(err).not.toContain("We could not load");
    expect(err).not.toContain("Try again");
    const nr = render(createElement(PlanNotReady), "fr");
    expect(nr).toContain("Presque prêt");
    expect(nr).toContain("Votre plan Lumière n’est pas encore prêt");
    expect(nr).toContain("Joindre l’assistance");
    expect(nr).not.toMatch(/Almost there|not ready yet|Contact Support/);
    expect(render(createElement(ProgressSkeleton), "fr")).toContain("Chargement de votre progression scolaire");
  });
  it("EN keeps the original wording, and the raw error message is never printed", () => {
    expect(render(createElement(PlanNotReady), "en")).toContain("Your Lumière plan is not ready yet");
    const html = render(createElement(ProgressError as never, { message: "SQL boom 500", onRetry: () => undefined }), "en");
    expect(html).toContain("We could not load your progress");
    expect(html).not.toContain("SQL boom");
  });
  it("FR: the 'roadmap is being prepared' state is translated", () => {
    const view = { foundation: { credentials: [], sources: [], degreeState: "COMPOSED", ladder: {} } } as never;
    const html = render(createElement(RoadmapNotPublished, { view, showFoundation: false, foundationLink: true }), "fr");
    expect(html).toContain("Lumière prépare votre feuille de route");
    expect(html).not.toMatch(/Almost there|is preparing your roadmap/);
  });
});

describe("S32-A F08 deadline text from the key", () => {
  it("translates label, rule (with the day count) and detail; unknown keys fall back to the server text", () => {
    const pl = (base: string, n: number) => plural(tFr as never, "fr", base, n);
    expect(deadlineTitle("language_test", "Language test", tFr as never)).toBe("Test de langue");
    expect(deadlineTitle("other" as never, "Custom", tFr as never)).toBe("Custom");
    expect(deadlineRule("prior_schooling_proof", "90 days after activation", pl)).toBe("90 jours après l’activation");
    expect(deadlineRule("language_test", "30 days after signing", pl)).toBe("30 jours après la signature");
    expect(deadlineRule("language_test", "1 day after signing", pl)).toBe("1 jour après la signature");
    expect(deadlineRule("language_test", "Whenever you like", pl)).toBe("Whenever you like");
    expect(deadlineDetail("Score 112 (target 105–115)", tFr as never)).toBe("Résultat : 112 (cible : 105–115)");
    expect(deadlineDetail("Target 105", tFr as never)).toBe("Cible : 105");
    expect(deadlineDetail("Something else", tFr as never)).toBe("Something else");
    expect(deadlineDetail(null, tFr as never)).toBeNull();
  });
});

describe("S32-A F15 pace pill", () => {
  const v = (status: "behind" | "ahead" | "on_track" | "not_configured", earned: number, awaiting: number, expected: number | null) => {
    const base = s27HsView();
    return { pace: { ...base.pace, status, expectedByNowHalfUnits: expected }, credits: { ...base.credits, earnedHalfUnits: earned, awaitingConfirmationHalfUnits: awaiting } };
  };
  it("behind + awaiting meets the milestone => pending; exactly meeting counts", () => {
    expect(pacePillStatus(v("behind", 10, 4, 14))).toBe("pending");
    expect(pacePillStatus(v("behind", 10, 3, 14))).toBe("behind");
    expect(pacePillStatus(v("behind", 10, 0, 14))).toBe("behind");
  });
  it("other statuses are unchanged; not configured gives null", () => {
    expect(pacePillStatus(v("ahead", 20, 0, 14))).toBe("ahead");
    expect(pacePillStatus(v("on_track", 14, 0, 14))).toBe("on_track");
    expect(pacePillStatus(v("not_configured", 0, 0, null))).toBeNull();
  });
  it("the strings exist in both languages and differ", () => {
    expect(tEn("s32.fd.pill.pending")).toBe("On pace once pending results arrive");
    expect(tFr("s32.fd.pill.pending")).toBe("Dans les temps une fois les résultats en attente reçus");
  });
});

describe("S32-A F28 French formatting", () => {
  it("no doubled full stop after an abbreviated month inside a sentence", () => {
    expect(formatDay("2026-12-16", "fr", "weekday")).toBe("mer. 16 déc.");
    expect(formatDayInSentence("2026-12-16", "fr", "weekday")).toBe("mer. 16 déc");
    expect(tFr("s27.alert.due", { date: formatDayInSentence("2026-12-16", "fr", "weekday") })).toBe("Échéance : mer. 16 déc.");
    expect(formatDayInSentence("2026-12-16", "en", "short")).toBe("16 Dec");
  });
  it("the first of the month is « 1er » in French only", () => {
    expect(formatDay("2026-10-01", "fr")).toBe("1er oct.");
    expect(formatDay("2026-10-01", "fr", "weekday")).toBe("jeu. 1er oct.");
    expect(formatDay("2026-10-11", "fr")).toBe("11 oct.");
    expect(formatDay("2026-10-21", "fr")).toBe("21 oct.");
    expect(formatDay("2026-10-01", "en")).toBe("1 Oct");
    expect(formatDay("2026-10-01", "fr", "monthYear")).toBe("oct. 2026");
  });
  it("plural: French singular below 2, English only for 1", () => {
    expect(isOne(1, "fr")).toBe(true);
    expect(isOne(1.5, "fr")).toBe(true);
    expect(isOne(2, "fr")).toBe(false);
    expect(isOne(1.5, "en")).toBe(false);
    expect(plural(tEn as never, "en", "s32.week.in", 1)).toBe("in 1 day");
    expect(plural(tFr as never, "fr", "s32.week.in", 1)).toBe("dans 1 jour");
    expect(plural(tFr as never, "fr", "s32.week.in", 3)).toBe("dans 3 jours");
  });
  it("Next 7 days pill reads « dans 1 jour » / 'in 1 day'", () => {
    const open = [
      { courseKey: "a", courseTitle: "A", key: "t1", title: "T1", dueDate: "2026-10-29", overdue: false },
      { courseKey: "b", courseTitle: "B", key: "t2", title: "T2", dueDate: "2026-10-30", overdue: false },
    ];
    expect(render(createElement(WeekCard, { open, today: S27_TODAY }), "fr")).toContain("dans 1 jour");
    expect(render(createElement(WeekCard, { open, today: S27_TODAY }), "en")).toContain("in 1 day");
  });
});

describe("S32-A F16 program-aware checkpoints", () => {
  const journey = s27Journey();
  const cps = (program: "hs" | "degree") => {
    return render(createElement(CheckpointsCard, { journey, journeyState: "ready" }), "fr").length && program;
  };
  void cps;
  it("the HS deck keeps the diploma wording", () => {
    const html = render(createElement(CheckpointsCard, { journey, journeyState: "ready" }), "fr");
    expect(html).toContain("Bilan de préparation au diplôme");
    expect(html).toContain("Clôture : relevé de notes et diplôme");
  });
  it("the degree keys read university / baccalauréat in both languages", () => {
    expect(tFr("s32.dg.cp.readiness_check")).toBe("Bilan de préparation à la diplomation");
    expect(tFr("s32.dg.cp.closing")).toBe("Clôture : relevé final et diplôme de baccalauréat");
    expect(tEn("s32.dg.cp.readiness_check")).toBe("Graduation-readiness review");
    expect(tEn("s32.dg.cp.closing")).toBe("Closing: final transcript & degree");
  });
});

// ── degree deck fixtures ────────────────────────────────────────────────────

function item(over: Partial<StudentRoadmapItemView> & { key: string }): StudentRoadmapItemView {
  return {
    phaseKey: "gen", objectiveKey: "o1", sequence: 1, kind: "course", code: null, title: `Course ${over.key}`, provider: "Sophia Learning", institution: null,
    credits: "3", plannedStart: null, plannedEnd: null, planStatus: "planned", holdReason: null, approval: null, alternativeOf: null,
    studentNote: null, waitingOn: [], itemStatus: "not_started", itemRevision: 0, tasks: [],
    taskCounts: { total: 0, graded: 0, submitted: 0, inProgress: 0, notStarted: 0 },
    stage: "not_started", official: null, canReport: true, reportBlockedReason: null, ...over,
  } as StudentRoadmapItemView;
}
const phase = (items: StudentRoadmapItemView[]): StudentRoadmapPhaseView =>
  ({ key: "gen", title: "General education", sequence: 1, objectiveKey: null, startDate: null, endDate: null, description: null, items, counts: {} as never, state: "current" });
const roadmap = (): StudentRoadmapView => ({
  contractVersion: "student-roadmap/1", state: "PUBLISHED", preview: false,
  plan: { title: "Plan", summary: null, versionNumber: 1, publishedAt: null },
  objectives: [], phases: [phase([item({ key: "eng101", title: "English Composition I", plannedEnd: "2026-11-23" })])], milestones: [], counts: {} as never,
  today: { focusItemKeys: [], headline: "", detail: "", nextMilestoneKey: null },
  foundation: { credentials: [], sources: [], degreeState: "COMPOSED", ladder: { reported: "0", provisional: "0", verified: "60", applied: "60", surplus: null, planned: "0", required: "120" } },
  history: { previousVersions: [], retiredProgress: [] },
} as unknown as StudentRoadmapView);
const req = (id: string, title: string, required: string, applied: string, status: StudentRequirementView["status"] = "PARTIAL"): StudentRequirementView => ({
  requirementId: id, code: id.toUpperCase(), title, sequence: 1, status, unit: "credit", requiredAmount: required, appliedAmount: applied,
  remainingAmount: String(Number(required) - Number(applied)), appliedCreditRecordIds: [],
} as StudentRequirementView);
const progress = (requirements: StudentRequirementView[]): StudentDegreeProgressView => ({
  contractVersion: "student-degree-progress/1", state: "COMPOSED", asOf: null, program: null,
  totals: { unit: "credit", requiredCredits: "120", appliedCredits: "60", remainingCredits: "60", verifiedCreditsOnRecord: "60", requirementsSatisfied: 1, requirementsTotal: requirements.length },
  requirements, attention: [], milestones: [], nextSteps: [], sources: [], credits: [],
} as unknown as StudentDegreeProgressView);

describe("S32-A F17 requirement shortfall", () => {
  const rows = degreeRequirementRows(progress([req("res", "Residency", "30", "15"), req("gen", "General education", "30", "27"), req("done", "Capstone", "6", "6", "SATISFIED")]));
  it("lists requirements needing more than the open count, largest first; nothing invented", () => {
    expect(requirementShortfalls(rows, 9)).toEqual([{ id: "res", label: "Residency", remaining: 15 }]);
    expect(requirementShortfalls(rows, 2).map((r) => r.id)).toEqual(["res", "gen"]);
  });
  it("is hidden when the open total is unknown or no requirement exceeds it", () => {
    expect(requirementShortfalls(rows, null)).toEqual([]);
    expect(requirementShortfalls(rows, 60)).toEqual([]);
    expect(requirementShortfalls([], 9)).toEqual([]);
  });
  it("renders beside Still open on the degree deck, in FR", () => {
    const props = {
      roadmap: roadmap(), progress: progress([req("res", "Residency", "90", "15")]), journey: s27Journey(), journeyState: "ready" as const, firstName: "Noa",
      documents: [], tickets: [], billing: null, today: S27_TODAY, hour: 9,
    };
    const html = render(createElement(DegreeFlightDeck, props), "fr");
    expect(html).toContain("Residency : encore 75 crédits requis");
    expect(html).toContain("avec 1 étape.");
    expect(html).toContain("fd-shortfall");
  });
});

describe("S32-A F07 / F16 degree deck vocabulary and wording", () => {
  const props = {
    roadmap: roadmap(), progress: progress([req("res", "Residency", "30", "15")]), journey: s27Journey(), journeyState: "ready" as const, firstName: "Noa",
    documents: [], tickets: [], billing: null, today: S27_TODAY, hour: 9,
  };
  it("FR: Acquis / Prévus / Encore ouverts, no « Appliqués », degree checkpoints and university wording", () => {
    const html = render(createElement(DegreeFlightDeck, props), "fr");
    expect(html).toContain("Acquis");
    expect(html).toContain("Prévus");
    expect(html).toContain("Encore ouverts");
    expect(html).toContain("Acquis (acceptés par l’université)");
    expect(html).not.toMatch(/Appliqu/);
    expect(html).toContain("Bilan de préparation à la diplomation");
    expect(html).toContain("Clôture : relevé final et diplôme de baccalauréat");
    expect(html).not.toContain("Bilan de préparation au diplôme");
    expect(html).not.toContain("Clôture : relevé de notes et diplôme");
    expect(html).toContain("Votre accès à l’université dure jusqu’à 36 mois");
    expect(html).not.toContain("accès à l’école");
    expect(html).toContain("Seule l’université confirme");
    expect(html).toContain("welcome-banner-stub");
  });
  it("EN: Earned wording and degree checkpoints", () => {
    const html = render(createElement(DegreeFlightDeck, props), "en");
    expect(html).toContain("Earned (accepted by the university)");
    expect(html).not.toMatch(/Applied/);
    expect(html).toContain("Graduation-readiness review");
    expect(html).toContain("Closing: final transcript &amp; degree");
    expect(html).toContain("Your university access lasts up to 36 months");
  });
  it("EN and FR key sets of the s32 module match", () => {
    const e = Object.keys(en).filter((k) => k.startsWith("s32.")).sort();
    const f = Object.keys(fr).filter((k) => k.startsWith("s32.")).sort();
    expect(f).toEqual(e);
  });
});
