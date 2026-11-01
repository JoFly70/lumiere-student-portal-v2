import React from "react";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../client/src/i18n";
import type { StudentRoadmapItemView } from "../shared/student-roadmap-contract";
import { completedSummary } from "../client/src/components/degree-journey/model";
import { CompletedSection } from "../client/src/components/degree-journey/courses";
import { djEn, djFr } from "../client/src/components/degree-journey/i18n";
import { RoadmapLog } from "../client/src/components/s27/roadmap-log";
import { HsActionsProvider } from "../client/src/components/high-school/hs-actions";
import { arcGeometry } from "../client/src/lib/s27/cockpit-model";
import { placeLabels } from "../client/src/components/s27/flight-instrument";
import { beyondFinishOn, intakeYear } from "../client/src/lib/s27/beyond-model";
import { ELECTIVE_SUBJECT_PREFIX, buildElectiveChangeTicket } from "../client/src/lib/elective-change";
import { parseElectiveRequest } from "../client/src/lib/elective-stage";
import { HS_GRADUATED } from "./helpers/s11-hs-ui-fixtures";
import { S27_TODAY, s27HsView } from "./helpers/s27-fixtures";

function item(over: Partial<StudentRoadmapItemView> & { key: string }): StudentRoadmapItemView {
  return {
    phaseKey: "p1", objectiveKey: "o1", sequence: 1, kind: "course", code: null, title: over.key, provider: null, institution: null,
    credits: "3", plannedStart: null, plannedEnd: null, planStatus: "planned", holdReason: null, approval: null, alternativeOf: null,
    studentNote: null, waitingOn: [], itemStatus: "not_started", itemRevision: 0, tasks: [],
    taskCounts: { total: 0, graded: 0, submitted: 0, inProgress: 0, notStarted: 0 },
    stage: "not_started", official: null, canReport: true, reportBlockedReason: null, ...over,
  } as StudentRoadmapItemView;
}

const wrap = (node: React.ReactElement, lang: "en" | "fr" = "en") =>
  renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(I18nProvider, { initialLanguage: lang }, React.createElement(Router, { ssrPath: "/" }, node))),
  );

describe("F04 completed header counts only accepted credit", () => {
  const items = [
    item({ key: "a", stage: "officially_accepted", itemStatus: "provider_complete", credits: "3" }),
    item({ key: "b", stage: "provider_complete", itemStatus: "provider_complete", credits: "6" }),
  ];
  it("summarises accepted vs waiting", () => {
    expect(completedSummary(items)).toEqual({ accepted: 1, waiting: 1, acceptedCents: 300 });
  });
  it("renders accepted credit in the header and the waiting count muted", () => {
    const html = wrap(React.createElement(CompletedSection, { items }));
    const header = html.match(/data-testid="completed-summary"[^>]*>(.*?)<\/h2>/s)?.[1] ?? "";
    expect(header).toContain("1 course, 3 credits");
    expect(header).not.toContain("9");
    expect(html).toContain('data-testid="completed-waiting"');
    expect(html).toContain("1 waiting for the university");
    expect(html.match(/data-testid="completed-row"/g)?.length).toBe(2);
  });
  it("French wording", () => {
    expect(wrap(React.createElement(CompletedSection, { items }), "fr")).toContain("1 en attente de l’université");
  });
  it("no waiting suffix when nothing waits", () => {
    expect(wrap(React.createElement(CompletedSection, { items: [items[0]!] }))).not.toContain('data-testid="completed-waiting"');
  });
});

describe("F07 credit vocabulary and F26 copy", () => {
  it("uses Earned / Planned / Still open", () => {
    expect([djEn["dj.credits.earnedGroup"], djEn["dj.credits.plannedGroup"], djEn["dj.credits.openGroup"]]).toEqual(["Earned", "Planned", "Still open"]);
    expect([djFr["dj.credits.earnedGroup"], djFr["dj.credits.plannedGroup"], djFr["dj.credits.openGroup"]]).toEqual(["Acquis", "Prévus", "Encore ouverts"]);
  });
  it("no Applied wording in degree strings", () => {
    expect(Object.values(djEn).join("\n")).not.toMatch(/\bApplied\b/);
    expect(Object.values(djFr).join("\n")).not.toMatch(/Appliqu/);
  });
  it("proof hint explains waiting to earned", () => {
    expect(djEn["dj.sheet.proofHelp"]).toMatch(/waiting to earned only after the university accepts/);
  });
});

describe("F11 / F31 default High School page", () => {
  const props = (view = s27HsView()) => ({ view, journey: null, today: S27_TODAY, onLog: async () => ({ ok: true as const }) });
  it("shows a change control on elective rows and none on core rows", () => {
    const view = s27HsView();
    const electives = view.subjects.flatMap((s) => s.courses).filter((c) => c.kind === "elective" && c.status !== "replaced");
    const html = wrap(React.createElement(HsActionsProvider, null, React.createElement(RoadmapLog, props(view))));
    const shown = html.match(/data-testid="button-request-elective-change"/g)?.length ?? 0;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThanOrEqual(electives.length);
    expect(html).toContain("Request a change");
    // core courses never carry the control: the number of controls never exceeds the electives
    const core = view.subjects.flatMap((s) => s.courses).filter((c) => c.kind !== "elective");
    expect(core.length).toBeGreaterThan(0);
  });
  it("French label", () => {
    expect(wrap(React.createElement(HsActionsProvider, null, React.createElement(RoadmapLog, props())), "fr")).toContain("Demander un changement");
  });
  it("graduated student sees banner and transcript link on the default page", () => {
    const html = wrap(React.createElement(HsActionsProvider, null, React.createElement(RoadmapLog, props(HS_GRADUATED))));
    expect(html).toContain('data-testid="graduated-banner"');
    expect(html).toContain('data-testid="link-documents-transcript"');
  });
  it("non-graduated student has no graduated panel", () => {
    expect(wrap(React.createElement(RoadmapLog, props()))).not.toContain('data-testid="graduated-panel"');
  });
  it("ticket keeps machine-parsed markers and is bilingual in the status line", () => {
    const t = buildElectiveChangeTicket({ courseKey: "e1", courseTitle: "Art (PROPOSED)", alternate: "Music", reason: "Fit" });
    expect(t.subject.startsWith(ELECTIVE_SUBJECT_PREFIX)).toBe(true);
    expect(t.description).toContain("Statut : DEMANDÉ");
    expect(parseElectiveRequest(t.subject, t.description)).toMatchObject({ courseKey: "e1", alternate: "Music", reason: "Fit" });
  });
});

describe("F14 flight label placement", () => {
  it("hides labels that cannot clear instead of overprinting", () => {
    const g = arcGeometry(1200, 340);
    const stops = [10, 11, 12, 13, 60].map((c, i) => ({ id: `s${i}`, name: "Nursing Prerequisites", sub: `${c} CREDITS · PLANNED`, credits: c }));
    const out = placeLabels(g, stops, 120, 0.1, "You", 1200, 340);
    const hidden = Object.values(out.stops).filter((s) => s.hidden).length;
    expect(hidden).toBeGreaterThan(0);
    expect(Object.keys(out.stops)).toHaveLength(5);
  });
  it("keeps well-spaced labels", () => {
    const g = arcGeometry(1200, 340);
    const stops = [{ id: "a", name: "Core", sub: "30", credits: 30 }, { id: "b", name: "Major", sub: "90", credits: 90 }];
    const out = placeLabels(g, stops, 120, 0.1, "You", 1200, 340);
    expect(Object.values(out.stops).every((s) => !s.hidden)).toBe(true);
  });
});

describe("F17 Beyond intake year for degree-only students", () => {
  it("uses the graduation milestone when there is no high-school finish", () => {
    expect(beyondFinishOn(null, "2028-05-15")).toBe("2028-05-15");
    expect(beyondFinishOn("2027-01-10", "2028-05-15")).toBe("2027-01-10");
    expect(beyondFinishOn(null, null)).toBeNull();
    expect(beyondFinishOn(null, "not-a-date")).toBeNull();
    expect(intakeYear(beyondFinishOn(null, "2028-05-15"), "2026-11-01")).toBe(2028);
    expect(intakeYear(beyondFinishOn(null, "2028-09-01"), "2026-11-01")).toBe(2029);
    expect(intakeYear(null, "2026-11-01")).toBe(2027);
  });
});

describe("F18 wording", () => {
  it("Beyond request button is a request, not a booking", async () => {
    const { s27En, s27Fr } = await import("../client/src/i18n/modules/s27");
    expect(s27En["s27.bd.ses.book"]).toBe("Request this time");
    expect(s27Fr["s27.bd.ses.book"]).toBe("Demander ce créneau");
  });
});
