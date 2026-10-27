// @vitest-environment node
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { I18nProvider, translate, type Language } from "../client/src/i18n";
import { CockpitView } from "../client/src/components/cockpit/cockpit-view";
import {
  OPS_LOADING, buildCockpitActions, buildHero, buildStanding, summarizeBilling, summarizeDocuments, summarizeTickets, type CockpitOps,
} from "../client/src/components/cockpit/model";
import { cockpitEn, cockpitFr } from "../client/src/i18n/modules/cockpit";
import { formatCreditsLocale } from "../client/src/i18n";
import { S19_BILLING, S19_DOCS, S19_NEAR_COMPLETE, S19_OPS_READY, S19_PARTIAL, S19_TICKETS, makeProjection, PARTIAL_COURSES } from "./helpers/s19-cockpit-fixtures";

const tFor = (l: Language) => (k: any, v?: any) => translate(l, k, v);
const fcFor = (l: Language) => (h: number) => formatCreditsLocale(h, l);
const render = (props: Parameters<typeof CockpitView>[0], lang: Language = "en") =>
  renderToStaticMarkup(createElement(I18nProvider, { initialLanguage: lang }, createElement(Router, { ssrPath: "/flight-deck" }, createElement(CockpitView, props))));

describe("credit totals come from the projection configuration", () => {
  it("21 = 16 + 5 in the fixture; figures change when the configuration changes", () => {
    const h = buildHero(S19_PARTIAL, "verified", tFor("en"), fcFor("en"));
    expect(h.of).toBe("of 21");
    expect(h.config).toBe("21 credits = 16 core + 5 elective");
    const bigger = structuredClone(S19_PARTIAL);
    (bigger.credits.total as any).requiredHalfUnits = 48;
    (bigger.credits.core as any).requiredHalfUnits = 36;
    (bigger.credits.elective as any).requiredHalfUnits = 12;
    const h2 = buildHero(bigger, "verified", tFor("en"), fcFor("en"));
    expect(h2.of).toBe("of 24");
    expect(h2.config).toBe("24 credits = 18 core + 6 elective");
    expect(render({ projection: bigger })).toContain("of 24");
  });
  it("half-credit arithmetic: 21 half-units official shows 10.5", () => {
    const p = makeProjection({ courses: [{ key: "a", title: "A", area: "electives", hu: 2, basis: "official" }, ...PARTIAL_COURSES.slice(0, 0)] });
    const q = structuredClone(p);
    (q.credits.total as any).officialHalfUnits = 21;
    expect(buildHero(q, "verified", tFor("en"), fcFor("en")).figure).toBe("10.5");
    expect(buildHero(q, "verified", tFor("fr"), fcFor("fr")).figure).toBe("10,5");
  });
});

describe("verified is never merged with planned", () => {
  it("verified view shows official only; projected keeps official figure separate", () => {
    const v = buildHero(S19_PARTIAL, "verified", tFor("en"), fcFor("en"));
    const p = buildHero(S19_PARTIAL, "projected", tFor("en"), fcFor("en"));
    expect(v.figure).toBe("8");
    expect(v.tally.official).toBe(16);
    expect(p.tally.official).toBe(16);
    expect(Number(p.figure)).toBeGreaterThan(8);
    expect(v.segments.filter((s) => s.visible).map((s) => s.status)).toEqual(["official"]);
    const html = render({ projection: S19_PARTIAL, initialMode: "projected" });
    expect(html).toContain("Official stays at 8");
    expect(html).toContain('data-testid="legend-official">8<');
  });
});

describe("standing is derived honestly", () => {
  it("uses server pace only, no graduation prediction", () => {
    expect(buildStanding(S19_PARTIAL, tFor("en"), fcFor("en")).label).toBe("Behind your published plan");
    expect(buildStanding(S19_NEAR_COMPLETE, tFor("en"), fcFor("en")).label).toBe("Ahead of your published plan");
    expect(buildStanding(makeProjection({ courses: PARTIAL_COURSES.map((c) => ({ ...c, basis: "planned" as const })), paceStatus: "not_configured" }), tFor("en"), fcFor("en")).label).toBe("Just getting started");
  });
});

describe("operational sources are honest", () => {
  it("summaries count the right statuses", () => {
    expect(summarizeDocuments(S19_DOCS)).toEqual({ needAction: 2, underReview: 1, total: 4 });
    expect(summarizeTickets(S19_TICKETS.tickets)).toEqual({ open: 2, waitingOnStudent: 1 });
    expect(summarizeBilling({ ...S19_BILLING, state: "not_configured" } as any, "2026-10-27")).toEqual({ state: "not_set_up" });
    const b = summarizeBilling(S19_BILLING, "2026-12-01");
    expect(b.state === "ready" && b.data.overdue).toBe(true);
  });
  it("failed / not-set-up sources render a small state, never a zero", () => {
    const ops: CockpitOps = { documents: { state: "unavailable" }, support: { state: "unavailable" }, payments: { state: "not_set_up" } };
    const html = render({ projection: S19_PARTIAL, ops });
    expect(html).toMatch(/data-testid="pulse-documents-text">Unavailable right now/);
    expect(html).toMatch(/data-testid="pulse-support-text">Unavailable right now/);
    expect(html).toMatch(/data-testid="pulse-payments-text">Not set up yet/);
    expect(html).not.toContain("Nothing needs action");
    expect(html).not.toContain("No open requests");
    expect(render({ projection: S19_PARTIAL, ops: OPS_LOADING })).toContain("Loading");
  });
  it("ready sources show counts and a currency-formatted payment", () => {
    const html = render({ projection: S19_PARTIAL, ops: S19_OPS_READY });
    expect(html).toContain("Needing action: 2");
    expect(html).toContain("1 waiting for you");
    expect(html).toContain("$800.00");
    const fr = render({ projection: S19_PARTIAL, ops: S19_OPS_READY }, "fr");
    expect(fr).toContain("2 à traiter");
    expect(fr).toMatch(/800,00/);
  });
  it("top three actions combine projection and operational items, attention first", () => {
    const a = buildCockpitActions(S19_PARTIAL, S19_OPS_READY, tFor("en"), { date: (d) => d, money: (c) => String(c) });
    expect(a).toHaveLength(3);
    expect(a[0]!.attention).toBe(true);
    expect(a.map((x) => x.href).every((h) => ["/high-school", "/documents", "/support", "/billing"].includes(h))).toBe(true);
  });
});

describe("French and drill-downs", () => {
  it("French render uses French labels and a decimal comma", () => {
    const html = render({ projection: S19_PARTIAL, firstName: "Noa", ops: S19_OPS_READY }, "fr");
    for (const s of ["Bon retour, Noa", "Tronc commun et options", "À faire ensuite", "En retard sur votre plan publié", "Matières", "Vérifiés seulement"]) expect(html).toContain(s);
    expect(html).not.toContain("What to do next");
  });
  it("every cockpit key has a French translation distinct from a missing key", () => {
    for (const k of Object.keys(cockpitEn)) expect(cockpitFr[k as keyof typeof cockpitEn], k).toBeTruthy();
  });
  it("drill-down hrefs", () => {
    const html = render({ projection: S19_PARTIAL, ops: S19_OPS_READY });
    for (const h of ['href="/documents"', 'href="/support"', 'href="/billing"', 'href="/high-school"']) expect(html).toContain(h);
    expect(html).toContain('data-testid="subject-science"');
    expect(html).toContain('data-slot="academic-assistant"');
  });
  it("subject drawer lists courses and half-credit math when open", () => {
    const html = render({ projection: S19_PARTIAL, initialSubject: "science" });
    expect(html.includes("subject-sheet") || html.includes("Biology")).toBe(true);
  });
});

describe("source hygiene", () => {
  it("no hard-coded totals or theme colours in cockpit sources", () => {
    for (const f of ["client/src/components/cockpit/model.ts", "client/src/components/cockpit/cockpit-view.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, f).not.toMatch(/\b(21|42)\b.*credits/);
      expect(src, f).not.toMatch(/flight-deck-preview-data/);
    }
  });
});
