// @vitest-environment node
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
(globalThis as { React?: unknown }).React = React;
import { I18nProvider } from "../client/src/i18n";
import { FlightDeckRoadmapView, RoadmapPageView } from "../client/src/components/student-progress/student-roadmap-views";
import { NOT_PUBLISHED, RICH_MID_JOURNEY } from "./helpers/student-roadmap-ui-fixtures";

const plain = (h: string) => h.replace(/[  ]/g, " ");
const render = (el: React.ReactElement, lang: "en" | "fr") =>
  plain(renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Router, { ssrPath: "/flight-deck" }, createElement(I18nProvider, { initialLanguage: lang }, el)))));
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const ENGLISH = [
  "Your foundation", "Your starting point", "Your credits", "Planned (not credit yet)", "Still to plan", "Waiting for verification",
  "Under review", "preparing your roadmap", "Almost there", "Your Flight Deck", "Your roadmap", "credits applied", "reported in total",
  "What these words mean", "full credit ladder", "Prior degrees", "Surplus", "Completed ", "Reported", "Verified",
];

describe("S32-A unpublished degree plan renders in French without English", () => {
  const view = { ...NOT_PUBLISHED, foundation: RICH_MID_JOURNEY.foundation };
  for (const [name, el] of [["Flight Deck", FlightDeckRoadmapView], ["Roadmap", RoadmapPageView]] as const) {
    it(`${name}: no English strings`, () => {
      const t = text(render(createElement(el as never, { view, requirementDetails: undefined }), "fr"));
      expect(t).toContain("Lumière prépare votre feuille de route");
      for (const w of ENGLISH) expect(t, w).not.toContain(w);
    });
  }
  it("Flight Deck foundation uses Acquis / Prévus / Encore ouverts and French decimals", () => {
    const html = render(createElement(FlightDeckRoadmapView as never, { view }), "fr");
    const t = text(html);
    expect(t).toContain("Votre base");
    expect(t).toContain("Acquis");
    expect(t).toContain("Prévus (comptent une fois acceptés par l’université)");
    expect(t).toContain("Vos crédits");
    expect(html).toContain('data-testid="credit-ladder"');
  });
  it("EN keeps the earned vocabulary", () => {
    const t = text(render(createElement(FlightDeckRoadmapView as never, { view }), "en"));
    expect(t).toContain("Earned");
    expect(t).toContain("Planned (counts once the university accepts it)");
    expect(t).not.toContain("credits applied");
    expect(t).not.toContain("not credit yet");
  });
});
