import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { FlightDeckRoadmapView, RoadmapPageView } from "../client/src/components/student-progress/student-roadmap-views";
import { CreditLadder } from "../client/src/components/student-progress/foundation-section";
import { StageTrack } from "../client/src/components/student-progress/journey-graphics";
import { ItemCard } from "../client/src/components/student-progress/item-card";
import { TaskRow } from "../client/src/components/student-progress/task-controls";
import { itemsByKey } from "../client/src/pages/student-roadmap-presentation";
import { COMPLETED, NOT_PUBLISHED, RICH_MID_JOURNEY as V } from "./helpers/student-roadmap-ui-fixtures";

(globalThis as any).React = React;

const html = (el: React.ReactElement) =>
  renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(Router, { ssrPath: "/" }, el)),
  );
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const count = (m: string, needle: string) => m.split(needle).length - 1;

describe("S05 Roadmap page", () => {
  const markup = html(React.createElement(RoadmapPageView, { view: V }));
  const t = text(markup);

  it("shows the four sections with sticky navigation", () => {
    expect(markup).toContain('data-testid="section-nav"');
    for (const id of ["section-today", "section-roadmap", "section-foundation", "section-horizon"]) {
      expect(markup).toContain(`id="${id}"`);
      expect(markup).toContain(`href="#${id}"`);
    }
    expect(t).toContain("Lumière Higher-Ed Pathways");
  });

  it("draws overall progress exactly once, as counts", () => {
    expect(count(markup, 'data-testid="progress-summary"')).toBe(1);
    expect(count(markup, 'data-testid="count-bar"')).toBe(1);
    expect(t).toContain("Officially accepted");
    expect(t).toContain("Complete at provider");
    expect(t).not.toMatch(/\d\s?%/);
  });

  it("keeps ONE compact Now strip on the roadmap; task lists live on the Flight Deck", () => {
    expect(count(markup, 'data-testid="now-strip"')).toBe(1);
    expect(count(markup, 'data-testid="focus-item"')).toBe(0);
    expect(count(markup, 'data-testid="now-jump"')).toBe(1);
    expect(count(t, "Finish your Marketing challenges, then submit Touchstone 3")).toBe(1);
    expect(count(t, "Next up")).toBe(0);
    expect(count(t.toLowerCase(), "your roadmap")).toBeLessThanOrEqual(3);
  });
  it("states the scope of every count and the cumulative ladder", () => {
    expect(markup).toContain('data-testid="summary-scope"');
    expect(t).toContain("Counts for your whole plan, all phases: 9 items");
    expect(t).toContain("In this phase:");
    expect(t).toContain("69 credits reported in total: 60 of them verified, 9 waiting for Lumière to verify.");
    expect(t).not.toContain("Preliminary");
    expect(t).toContain("Waiting for verification");
  });
  it("never offers 'Graded' as a student action", () => {
    expect(t).not.toMatch(/\bGraded\b/);
  });

  it("renders phases with the current one expanded and others collapsed", () => {
    expect(count(markup, 'data-testid="phase"')).toBe(4);
    const toggles = markup.match(/<button[^>]*data-testid="phase-toggle"/g)!;
    expect(toggles.filter((b) => b.includes('aria-expanded="true"'))).toHaveLength(1);
    expect(toggles.filter((b) => b.includes('aria-expanded="false"'))).toHaveLength(3);
    expect(markup).toContain('data-phase-state="current"');
  });

  it("distinguishes primary and prerequisite objectives and offers a lane filter", () => {
    expect(markup).toContain('data-testid="lane-filter"');
    expect(t).toContain("Primary degree");
    expect(t).toContain("Prerequisite track");
    expect(markup).toContain('aria-pressed="true"');
  });

  it("shows holds, pending approvals, dependencies and alternative routes", () => {
    expect(markup).toContain('data-testid="badge-hold"');
    expect(markup).toContain('data-testid="badge-approval"');
    expect(t).toContain("Waiting on Principles of Marketing");
    expect(markup).toContain('data-testid="alternative-card"');
    expect(t).toContain("Alternative route to Corporate Finance");
    const alt = markup.slice(markup.indexOf('data-testid="alternative-card"'));
    const altCard = alt.slice(0, alt.indexOf("</article>"));
    expect(altCard).not.toContain("<input");
    expect(altCard).not.toContain("<button");
  });

  it("states official acceptance as a Lumière decision", () => {
    expect(markup).toContain('data-testid="official-note"');
    expect(t).toContain("Only Lumière staff can make this decision");
  });

  it("explains the foundation credit ladder in plain language", () => {
    expect(markup).toContain('data-testid="credit-ladder"');
    expect(t).toContain("Verified credits beyond what any requirement needs; they're on your record but don't move you closer to graduation.");
    expect(t).toContain("Part of the reported total that Lumière has checked and accepted");
    expect(t).toContain("Applied means that credit is counted toward a degree requirement");
    for (const r of ["reported", "provisional", "verified", "applied", "planned"]) expect(markup).toContain(`data-rung="${r}"`);
  });

  it("lists upcoming phases and milestones with target dates on the horizon", () => {
    expect(t).toContain("Nursing school application");
    expect(t).toContain("Target May 15, 2027");
    expect(markup).toContain('data-testid="upcoming-phases"');
  });

  it("offers no course add/edit/delete controls", () => {
    expect(t).not.toMatch(/Add course|Edit course|Delete course|Assign course|Add a course/i);
    expect(markup).not.toContain("button-add-course");
  });

  it("uses real, labelled controls with aria-expanded disclosures", () => {
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('type="radio"');
    expect(markup).toMatch(/<button[^>]*aria-expanded="false"[^>]*data-testid="item-toggle"/);
    expect(markup).toContain('data-testid="task-list"');
  });
});

describe("S05 Flight Deck", () => {
  const markup = html(React.createElement(FlightDeckRoadmapView, { view: V }));
  const t = text(markup);
  it("puts Today first, then one progress presentation, foundation and horizon", () => {
    expect(markup.indexOf("today-section")).toBeLessThan(markup.indexOf("progress-summary"));
    expect(count(markup, 'data-testid="progress-summary"')).toBe(1);
    expect(markup).toContain('data-testid="foundation-summary"');
    expect(markup).toContain('data-testid="horizon-summary"');
    expect(count(markup, 'data-testid="horizon-milestone"')).toBe(3);
    expect(count(markup, 'data-testid="now-strip"')).toBe(0);
    expect(markup).toContain('href="/roadmap"');
    expect(t).toContain("Current phase: Business Core");
  });
  it("takes credit numbers from the ladder only", () => {
    expect(markup).toContain('data-testid="rung-verified"');
    expect(t).toMatch(/Verified 60/);
    expect(t).toMatch(/Applied 57/);
    expect(t).toContain("Surplus: 3 credits");
  });
  it("does not repeat the headline", () => {
    expect(count(t, "Finish your Marketing challenges")).toBe(1);
  });
});

describe("S05 states", () => {
  it("shows preparing copy and keeps the foundation visible when not published", () => {
    for (const el of [RoadmapPageView, FlightDeckRoadmapView]) {
      const m = html(React.createElement(el as any, { view: NOT_PUBLISHED }));
      expect(text(m)).toContain("Lumière is preparing your roadmap");
      expect(m).toContain('data-testid="credit-ladder"');
      expect(m).not.toContain('data-testid="journey"');
    }
  });
  it("renders a completed journey without focus items", () => {
    const m = html(React.createElement(RoadmapPageView, { view: COMPLETED }));
    expect(count(m, 'data-testid="focus-item"')).toBe(0);
    expect(text(m)).toContain("Your roadmap is complete");
    expect(m).toContain('data-reached="true"');
  });
});

describe("S05 building blocks", () => {
  it("StageTrack names the stage and marks official acceptance distinctly", () => {
    const m = html(React.createElement(StageTrack, { stage: "submitted" }));
    expect(m).toContain('aria-label="Stage 3 of 6: Submitted"');
    expect(m).toContain('data-marker="official"');
    expect(m).toContain('data-reached="false"');
    expect(html(React.createElement(StageTrack, { stage: "officially_accepted" }))).toContain('data-reached="true"');
  });
  it("ItemCard disables nothing for reportable items and hides item actions for accepted ones", () => {
    const items = itemsByKey(V);
    const open = html(React.createElement(ItemCard, { item: items.get("bba-mkt300")!, defaultOpen: true }));
    expect(open).toContain('data-testid="button-provider-complete"');
    expect(text(open)).toContain("Lumière will review it. Telling us you finished does not award credit.");
    expect(text(open)).toContain("I finished this at the provider");
    expect(text(open)).toContain("6 done · show");
    const accepted = html(React.createElement(ItemCard, { item: items.get("bba-eng101")!, defaultOpen: true }));
    expect(accepted).not.toContain('data-testid="button-provider-complete"');
    expect(accepted).toContain("disabled");
    const undo = html(React.createElement(ItemCard, { item: items.get("bba-stat200")!, defaultOpen: true }));
    expect(undo).toContain('data-testid="button-undo-provider-complete"');
  });
  it("TaskRow renders a checkbox for challenges and a status group for touchstones", () => {
    const item = itemsByKey(V).get("bba-mkt300")!;
    const challenge = html(React.createElement("ul", null, React.createElement(TaskRow, { item, task: item.tasks[5] })));
    expect(challenge).toContain('type="checkbox"');
    const ts = item.tasks.find((x) => x.kind === "touchstone")!;
    const seg = html(React.createElement("ul", null, React.createElement(TaskRow, { item, task: ts })));
    expect(count(seg, 'type="radio"')).toBe(4);
    expect(seg).toContain("<legend");
    expect(text(seg)).toContain("Done");
    expect(text(seg)).not.toContain("Graded");
    const started = html(React.createElement("ul", null, React.createElement(TaskRow, { item, task: item.tasks[6] })));
    expect(text(started)).toContain("Mark started");
    expect(text(started)).not.toMatch(/In progress/);
  });
  it("CreditLadder shows Under review for a withheld applied figure", () => {
    const m = html(React.createElement(CreditLadder, { ladder: { ...V.foundation.ladder, applied: null, surplus: null } }));
    expect(text(m)).toContain("Under review");
    expect(m).not.toContain('data-testid="surplus-note"');
  });
});
