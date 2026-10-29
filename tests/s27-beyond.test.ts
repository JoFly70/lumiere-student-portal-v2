import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({ Link: ({ href, children, ...rest }: any) => createElement("a", { href, ...rest }, children) }));
import { I18nProvider } from "../client/src/i18n";
import { BeyondPage, type BeyondProps } from "../client/src/components/s27/beyond";
import {
  artForIndex, buildChecklist, buildTimeline, candidateSlots, careersFor, intakeYear, normaliseRegion, prepPayload, prepQuestions, sessionsLeft,
} from "../client/src/lib/s27/beyond-model";
import { s27HsView, s27Journey, S27_TODAY } from "./helpers/s27-fixtures";

const journey = s27Journey();
const goal = journey.agreement!.goal!;

describe("S27 Beyond model", () => {
  it("postcard art is chosen by index and cycles through three scenes", () => {
    expect([0, 1, 2, 3, 4].map(artForIndex)).toEqual(["lake", "city", "mount", "lake", "city"]);
  });
  it("intake year: a finish in July or later rolls to next year", () => {
    expect(intakeYear("2026-12-21", S27_TODAY)).toBe(2027);
    expect(intakeYear("2027-03-01", S27_TODAY)).toBe(2027);
    expect(intakeYear(null, "2026-10-29")).toBe(2027);
  });
  it("future-self timeline has six nodes from today to the first role", () => {
    const n = buildTimeline({ kind: "diploma", finishOn: "2026-12-21", week: 8 });
    expect(n.map((x) => x.id)).toEqual(["today", "finish", "apply", "begins", "degree", "role"]);
    expect(n[0]).toMatchObject({ tone: "now", week: 8 });
    expect(n[1]!.on).toBe("2026-12-21");
    expect(n.at(-1)!.tone).toBe("goal");
  });
  it("sessions left = included - used, never negative; none without an agreement", () => {
    expect(sessionsLeft(journey.agreement)).toBe(1);
    expect(sessionsLeft({ orientationSessionsIncluded: 2, orientationSessionsUsed: 5 })).toBe(0);
    expect(sessionsLeft(null)).toBe(0);
  });
  it("candidate slots: weekdays only, lead time respected, already requested slots excluded", () => {
    const now = new Date(2026, 9, 29, 18, 30); // Thursday
    const slots = candidateSlots(now);
    expect(slots).toHaveLength(6);
    expect(slots.every((s) => s.getDay() !== 0 && s.getDay() !== 6)).toBe(true);
    expect(slots[0]!.getTime()).toBeGreaterThan(new Date(2026, 9, 31).getTime());
    const without = candidateSlots(now, [slots[0]!.toISOString()]);
    expect(without.map((s) => s.getTime())).not.toContain(slots[0]!.getTime());
  });
  it("prep questions come from the goal; the payload respects the contract limits", () => {
    const q = prepQuestions(goal);
    expect(q.map((x) => x.id)).toEqual(["fields", "language", "place"]);
    expect(prepQuestions(null).map((x) => x.id)).toEqual(["language"]);
    const payload = prepPayload({ fields: ["a".repeat(80), "b"], empty: [] });
    expect(payload).toEqual({ fields: ["a".repeat(60), "b"] });
    const many = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`q${i}`, ["x"]]));
    expect(Object.keys(prepPayload(many))).toHaveLength(6);
  });
  it("careers: configured for communication, none for an unknown field, none without a goal", () => {
    expect(careersFor(goal).length).toBe(5);
    expect(careersFor({ ...goal, field: "Marine biology", interests: ["Oceans"] })).toEqual([]);
    expect(careersFor(null)).toEqual([]);
  });
  it("checklist: language follows the deadline, later items are locked", () => {
    const items = buildChecklist({ agreement: journey.agreement, sessions: journey.sessions, checkpoints: journey.checkpoints, transcriptStatus: "not_requested" });
    expect(items.map((i) => [i.id, i.state])).toEqual([["program", "part"], ["language", "done"], ["transcript", "lock"], ["profile", "lock"], ["dates", "lock"]]);
  });
  it("region paths are matched accent-insensitively", () => {
    expect(normaliseRegion(" Québec ")).toBe("quebec");
  });
});

describe("S27 Beyond page", () => {
  const base = (over: Partial<BeyondProps> = {}): BeyondProps => ({
    kind: "diploma", hs: s27HsView(), journey, journeyState: "ready", today: S27_TODAY, now: new Date(2026, 9, 29, 18, 30), whatsapp: null,
    onBook: async () => ({ ok: true }), onService: async () => ({ ok: true, ticketNumber: "SUP-1" }), notify: () => {}, ...over,
  });
  const render = (props: BeyondProps, lang: "en" | "fr" = "en") => renderToStaticMarkup(createElement(I18nProvider, { initialLanguage: lang }, createElement(BeyondPage, props)));

  it("renders postcards from the goal targets, the timeline, sessions counter and services", () => {
    const html = render(base());
    expect(html).toContain("Beyond the Diploma");
    for (const u of goal.targets) expect(html).toContain(u.name);
    expect(html).toContain('data-testid="beyond-future-timeline"');
    expect(html).toContain('data-testid="bd-sessions-left">1<');
    expect(html).toContain("You&#x27;re never alone. We are the light.");
    expect(html).toContain("Ask about this");
    expect(html).not.toContain("wa.me");
  });
  it("without a goal: designed empty state, no invented universities or careers", () => {
    const html = render(base({ journey: { ...journey, agreement: { ...journey.agreement!, goal: null } } }));
    expect(html).toContain('data-testid="beyond-empty"');
    expect(html).toContain("Your orientation study will appear here once Lumière prepares it");
    expect(html).not.toContain('data-testid="beyond-postcards"');
    expect(html).not.toContain('data-testid="beyond-careers"');
  });
  it("journey unavailable (404): empty state, booking explained, page still renders", () => {
    const html = render(base({ journey: null, journeyState: "unavailable" }));
    expect(html).toContain('data-testid="beyond-empty"');
    expect(html).toContain('data-testid="bd-sessions-unavailable"');
  });
  it("degree students: Beyond the Bachelor's with master's copy", () => {
    const html = render(base({ kind: "bachelor", hs: null, journey: null, journeyState: "unavailable" }));
    expect(html).toContain("Beyond the Bachelor&#x27;s");
    expect(html).toContain("master&#x27;s");
    expect(html).toContain("Master&#x27;s degree");
  });
  it("is translated to French", () => {
    const html = render(base(), "fr");
    expect(html).toContain("Au-delà du diplôme");
    expect(html).toContain("En savoir plus");
  });
  it("shows the WhatsApp request only when a number is configured", () => {
    expect(render(base({ whatsapp: "https://wa.me/15551234567" }))).toContain("https://wa.me/15551234567");
  });
});
