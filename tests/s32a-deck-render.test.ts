// @vitest-environment node
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The real banner needs the auth + query providers and the network; the deck only has to mount it.
vi.mock("../client/src/components/cockpit/welcome-banner", () => ({
  WelcomeBanner: () => createElement("section", { "data-testid": "welcome-banner-stub" }, "welcome"),
}));

import { I18nProvider } from "../client/src/i18n";
import { FlightDeckS27 } from "../client/src/components/s27/flight-deck";
import { DegreeFlightDeck } from "../client/src/components/s27/degree-flight-deck";
import { s27HsView, s27Journey, S27_TODAY } from "./helpers/s27-fixtures";

/** French typography uses (narrow) no-break spaces before « : » and similar; compare with plain spaces. */
const plain = (html: string) => html.replace(/[\u00a0\u202f]/g, " ");
const wrap = (node: React.ReactElement, lang: "en" | "fr") =>
  plain(renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Router, { ssrPath: "/flight-deck" }, createElement(I18nProvider, { initialLanguage: lang }, node)))));

const hsProps = () => ({
  view: s27HsView(), journey: s27Journey(), journeyState: "ready" as const, firstName: "Noa", documents: [], tickets: [], billing: null,
  today: S27_TODAY, hour: 9,
});

describe("S32-A F12 welcome banner mounted on the decks", () => {
  it("the high-school deck renders the welcome banner above the cards, once", () => {
    const html = wrap(createElement(FlightDeckS27, hsProps()), "en");
    expect(html.split("welcome-banner-stub").length - 1).toBe(1);
    expect(html.indexOf("fd-welcome")).toBeLessThan(html.indexOf("fd-alerts"));
  });
});

describe("S32-A F08 deadline cards in French", () => {
  it("shows translated labels, rules and details on the HS deck, no English server text", () => {
    const html = wrap(createElement(FlightDeckS27, hsProps()), "fr");
    expect(html).toContain("Preuve de scolarité antérieure");
    expect(html).toContain("90 jours après l’activation");
    expect(html).toContain("Résultat : 112 (cible : 105–115)");
    expect(html).not.toContain("Proof of prior schooling");
    expect(html).not.toContain("days after activation");
    expect(html).not.toContain("Score 112");
    // F28: no doubled full stop after an abbreviated month
    expect(html).not.toContain("..");
    expect(html).toContain("90 jours après l’activation. Échéance : dim. 6 déc.");
  });
  it("keeps the English wording in English", () => {
    const html = wrap(createElement(FlightDeckS27, hsProps()), "en");
    expect(html).toContain("Proof of prior schooling");
    expect(html).toContain("90 days after activation");
  });
});

describe("S32-A F15 pace pill on the HS deck", () => {
  const withPace = (status: "behind" | "ahead", earned: number, awaiting: number, expected: number) => {
    const v = s27HsView();
    return { ...hsProps(), view: { ...v, pace: { ...v.pace, status, expectedByNowHalfUnits: expected }, credits: { ...v.credits, earnedHalfUnits: earned, awaitingConfirmationHalfUnits: awaiting } } };
  };
  it("behind but confirmed + awaiting meets the milestone: calm wording", () => {
    const html = wrap(createElement(FlightDeckS27, withPace("behind", 10, 6, 14)), "en");
    expect(html).toContain("On pace once pending results arrive");
    expect(html).not.toContain("Behind plan");
    expect(wrap(createElement(FlightDeckS27, withPace("behind", 10, 6, 14)), "fr")).toContain("Dans les temps une fois les résultats en attente reçus");
  });
  it("behind and still short with awaiting credit: stays Behind", () => {
    expect(wrap(createElement(FlightDeckS27, withPace("behind", 10, 2, 14)), "en")).toContain("Behind plan");
  });
});

describe("S32-A F31 graduated student sees the banner on the deck", () => {
  it("diploma conferred shows the graduation banner; in progress does not", () => {
    const v = s27HsView();
    const graduated = { ...hsProps(), view: { ...v, graduation: { ...v.graduation, status: "diploma_conferred" as const, diploma: { ...v.graduation.diploma, conferredOn: "2026-12-20" } } } };
    expect(wrap(createElement(FlightDeckS27, graduated), "en")).toContain("fd-graduated");
    expect(wrap(createElement(FlightDeckS27, graduated), "fr")).toContain("Félicitations");
    expect(wrap(createElement(FlightDeckS27, hsProps()), "en")).not.toContain("fd-graduated");
  });
});

void DegreeFlightDeck;
