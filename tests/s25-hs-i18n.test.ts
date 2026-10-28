import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { HighSchoolPageView } from "../client/src/components/high-school/high-school-view";
import { I18nProvider, type Language } from "../client/src/i18n";
import { highSchoolEn, highSchoolFr } from "../client/src/i18n/modules/high-school";
import { courseStatusView, creditsLabel, creditsOfLabel, governanceCopy, nextStep } from "../client/src/pages/high-school-presentation";
import { HS_MID_WAY, HS_TODAY } from "./helpers/s11-hs-ui-fixtures";

(globalThis as any).React = React;

const render = (lang: Language) =>
  renderToStaticMarkup(
    React.createElement(I18nProvider, { initialLanguage: lang },
      React.createElement(QueryClientProvider, { client: new QueryClient() },
        React.createElement(Router, { ssrPath: "/high-school" }, React.createElement(HighSchoolPageView, { view: HS_MID_WAY, today: HS_TODAY })))),
  );
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("S25 High School page in French", () => {
  it("renders French chrome from the React context while data stays as delivered", () => {
    const markup = render("fr");
    const t = text(markup);
    expect(t).toContain("Mon parcours au lycée");
    expect(t).toContain("Votre prochaine étape");
    expect(t).toContain("Seule votre école confirme les notes, les crédits et votre diplôme.");
    expect(markup).toContain('aria-label="Sections du parcours lycée"');
    expect(markup).toContain('data-testid="tab-journey"');
    expect(t).not.toContain("My High School Journey");
    expect(t).not.toContain("Your next step");
    expect(t).toContain(HS_MID_WAY.enrollment.schoolDisplayName);
  });

  it("keeps English unchanged by default", () => {
    expect(text(render("en"))).toContain("My High School Journey");
  });

  it("formats credits with a decimal comma and French plural rules", () => {
    expect(creditsLabel(3, "fr")).toBe("1,5 crédit");
    expect(creditsLabel(21, "fr")).toBe("10,5 crédits");
    expect(creditsOfLabel(21, 42, "fr")).toBe("10,5 sur 21 crédits");
    expect(creditsOfLabel(21, 42)).toBe("10.5 of 21 credits");
  });

  it("translates pure helpers when given a language, English otherwise", () => {
    expect(courseStatusView("official_complete", "fr").label).toBe("Officiel\u00A0: terminé");
    expect(courseStatusView("official_complete").label).toBe("Official: completed");
    expect(governanceCopy("fr").headline).toContain("Seule votre école");
    expect(nextStep(HS_MID_WAY, HS_TODAY, () => null, "fr").action?.label).toBeTruthy();
  });

  it("has a French value for every English key", () => {
    expect(Object.keys(highSchoolFr).sort()).toEqual(Object.keys(highSchoolEn).sort());
  });
});
