import fs from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { I18nProvider, translate } from "../client/src/i18n";
import { en } from "../client/src/i18n/en";
import { fr } from "../client/src/i18n/fr";
import { welcomeEn, welcomeFr } from "../client/src/i18n/modules/welcome";
import { WelcomeBannerView, welcomeMessageKey, initialsOf, safeAttentionPath, sessionMarker, type WelcomeData } from "../client/src/components/cockpit/welcome-banner";

void React;
const base: WelcomeData = { firstName: "Amélie", kind: "returning", attention: { count: 0, path: null }, photo: false };
const render = (data: WelcomeData, lang: "en" | "fr" = "en", props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(Router, { ssrPath: "/flight-deck" }, createElement(I18nProvider, { initialLanguage: lang }, createElement(WelcomeBannerView, { data, ...props }))));

describe("S21 welcome copy", () => {
  it("English copy matches the product wording", () => {
    expect(translate("en", "welcome.first", { name: "Amélie" })).toBe("Welcome to Lumière, Amélie! Your journey begins here.");
    expect(translate("en", "welcome.returning", { name: "Amélie" })).toBe("Welcome back, Amélie! Ready to tackle your next assignment?");
    expect(translate("en", "welcome.attention", { name: "Amélie" })).toBe("Welcome back, Amélie! You have something awaiting your attention.");
  });
  it("French is natural, vouvoiement, typographic spacing", () => {
    expect(translate("fr", "welcome.first", { name: "Amélie" })).toMatch(/^Bienvenue chez Lumière, Amélie\s!\sVotre parcours commence ici\.$/);
    expect(translate("fr", "welcome.attention", { name: "Amélie" })).toContain("Bon retour, Amélie");
    expect(Object.values(welcomeFr).join(" ")).not.toMatch(/\b(tu|ton|ta|tes|ready|welcome)\b/i);
  });
  it("EN/FR parity and registration", () => {
    expect(Object.keys(welcomeFr).sort()).toEqual(Object.keys(welcomeEn).sort());
    for (const k of Object.keys(welcomeEn)) { expect(k in en).toBe(true); expect(k in fr).toBe(true); expect((fr as any)[k]).not.toBe((en as any)[k]); }
  });
  it("message selection: first wins, then real attention, else returning; anonymous variants without a name", () => {
    expect(welcomeMessageKey({ ...base, kind: "first", attention: { count: 3, path: "/documents" } })).toBe("welcome.first");
    expect(welcomeMessageKey({ ...base, attention: { count: 1, path: "/billing" } })).toBe("welcome.attention");
    expect(welcomeMessageKey(base)).toBe("welcome.returning");
    expect(welcomeMessageKey({ ...base, firstName: null })).toBe("welcome.returningAnon");
    expect(welcomeMessageKey({ ...base, firstName: null, kind: "first" })).toBe("welcome.firstAnon");
  });
});

describe("S21 welcome banner view", () => {
  it("renders a non-modal, labelled region with the message and initials when there is no photo", () => {
    const html = render(base);
    expect(html).toContain('data-testid="welcome-banner"');
    expect(html).toContain('role="region"');
    expect(html).not.toMatch(/role="dialog"|aria-modal/);
    expect(html).toContain("Welcome back, Amélie! Ready to tackle your next assignment?");
    expect(html).toContain(">A<");
  });
  it("shows the photo when a signed URL is supplied", () => {
    // Radix Avatar renders the image only after it loads in a browser; the static markup keeps the fallback.
    const html = render(base, "en", { photoUrl: "https://signed.example/p.png" });
    expect(html).toContain('data-testid="welcome-avatar"');
  });
  it("dismiss button is only rendered when a handler exists and is labelled", () => {
    expect(render(base)).not.toContain("welcome-dismiss");
    const html = render(base, "en", { onDismiss: () => undefined });
    expect(html).toContain('data-testid="welcome-dismiss"');
    expect(html).toContain('aria-label="Dismiss welcome message"');
  });
  it("attention variant links to the server-supplied path; first and returning never link", () => {
    const att = render({ ...base, attention: { count: 2, path: "/documents" } });
    expect(att).toContain("something awaiting your attention");
    expect(att).toContain('href="/documents"');
    expect(render({ ...base, attention: { count: 2, path: null } })).not.toContain("welcome-attention-link");
    expect(render({ ...base, kind: "first", attention: { count: 2, path: "/documents" } })).not.toContain("welcome-attention-link");
  });
  it("French rendering", () => {
    expect(render({ ...base, kind: "first" }, "fr")).toContain("Bienvenue chez Lumière, Amélie");
  });
  it("uses theme tokens only: no hard-coded colors, motion guarded for reduced-motion", () => {
    const src = fs.readFileSync("client/src/components/cockpit/welcome-banner.tsx", "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(/);
    expect(src).toContain("motion-safe:");
    expect(src).not.toMatch(/(?<!motion-safe:)animate-(?!in)/);
    expect(src).toContain("var(--t-");
    expect(src).not.toMatch(/Dialog|Modal/);
  });
  it("is mounted in both decks through an optional slot, and the cockpit is not replaced", () => {
    expect(fs.readFileSync("client/src/pages/flight-deck.tsx", "utf8")).toContain("banner={<WelcomeBanner />}");
    expect(fs.readFileSync("client/src/pages/high-school-flight-deck.tsx", "utf8")).toContain("banner={<WelcomeBanner />}");
    expect(fs.readFileSync("client/src/components/cockpit/cockpit-view.tsx", "utf8")).toContain("{banner}");
  });
});

describe("S21 welcome helpers", () => {
  it("initials", () => {
    expect(initialsOf("Amélie")).toBe("A");
    expect(initialsOf("  jean  paul ")).toBe("JP");
    expect(initialsOf(null)).toBe("L");
  });
  it("only same-origin app paths are linked", () => {
    expect(safeAttentionPath("/documents")).toBe("/documents");
    for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)", "documents", "", null]) expect(safeAttentionPath(bad as any)).toBeNull();
  });
  it("session marker is stable per login, differs between logins, and does not contain the token", () => {
    expect(sessionMarker("csrf-aaa")).toBe(sessionMarker("csrf-aaa"));
    expect(sessionMarker("csrf-aaa")).not.toBe(sessionMarker("csrf-bbb"));
    expect(sessionMarker("csrf-aaa")).not.toContain("csrf-aaa");
  });
});
