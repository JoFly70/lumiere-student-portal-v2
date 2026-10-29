import React from "react";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../client/src/i18n";
import { SubjectsTab } from "../client/src/components/high-school/subjects-tab";
import { HsActionsProvider } from "../client/src/components/high-school/hs-actions";
import { HS_MID_WAY, HS_TODAY } from "./helpers/s11-hs-ui-fixtures";
import { buildElectiveChangeTicket, electiveAwaitsApproval, electiveShortTitle, isElectiveChangeSubject, ELECTIVE_STATUS_LINE } from "../client/src/lib/elective-change";

const view = {
  ...HS_MID_WAY,
  subjects: HS_MID_WAY.subjects.map((s) =>
    s.subject === "electives" ? { ...s, courses: s.courses.map((c, i) => (i === 0 ? { ...c, title: "Introduction to Psychology (PROPOSED)" } : c)) } : s,
  ),
};

function render(withProvider: boolean, lang: "en" | "fr" = "en") {
  const tab = React.createElement(SubjectsTab, { view, today: HS_TODAY, defaultOpenSubject: "electives" });
  const inner = withProvider ? React.createElement(HsActionsProvider, null, tab) : tab;
  return renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(I18nProvider, { initialLanguage: lang }, React.createElement(Router, { ssrPath: "/high-school" }, inner))),
  );
}

describe("elective change request UI", () => {
  it("shows credit, approval pill and an enabled Request button inside the actions provider", () => {
    const html = render(true);
    expect(html).toContain('data-testid="elective-credit"');
    expect(html).toContain("Awaiting school approval");
    const btn = html.match(/<button[^>]*data-testid="button-request-elective-change"[^>]*>/)?.[0] ?? "";
    expect(btn).not.toBe("");
    expect(btn).toContain('aria-disabled="false"');
    expect(html).toContain("Request a change");
  });
  it("is French when the language is French", () => {
    expect(render(true, "fr")).toContain("En attente d&#x27;approbation de l&#x27;école");
  });
  it("renders the button disabled without the provider (admin read-only preview)", () => {
    const btn = render(false).match(/<button[^>]*data-testid="button-request-elective-change"[^>]*>/)?.[0] ?? "";
    expect(btn).toContain('aria-disabled="true"');
  });
});

describe("elective change ticket builder", () => {
  it("builds the subject and description", () => {
    const t = buildElectiveChangeTicket({ courseKey: "elective-x", courseTitle: "Intro Psychology (PROPOSED)", alternate: " Sociology ", reason: "Better fit" });
    expect(t.subject).toBe("Elective change request: Intro Psychology → Sociology");
    expect(isElectiveChangeSubject(t.subject)).toBe(true);
    expect(t.description).toContain("Intro Psychology (PROPOSED) (key: elective-x)");
    expect(t.description).toContain("Preferred alternate: Sociology");
    expect(t.description).toContain("Reason: Better fit");
    expect(t.description.endsWith(ELECTIVE_STATUS_LINE)).toBe(true);
  });
  it("detects pending approval only from the title", () => {
    expect(electiveAwaitsApproval("Art - TEST ONLY")).toBe(true);
    expect(electiveAwaitsApproval("Art (approval pending)")).toBe(true);
    expect(electiveAwaitsApproval("Personal Finance")).toBe(false);
    expect(electiveShortTitle("Art — PROPOSED")).toBe("Art");
  });
});
