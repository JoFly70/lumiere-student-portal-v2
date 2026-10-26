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
  const fd = html(React.createElement(FlightDeckRoadmapView, { view: V }));
  const fdt = text(fd);

  it("owns the journey only: Now and Journey sections, with links to the Flight Deck for foundation and horizon", () => {
    expect(markup).toContain('data-testid="section-nav"');
    for (const id of ["section-today", "section-roadmap"]) {
      expect(markup).toContain(`id="${id}"`);
      expect(markup).toContain(`href="#${id}"`);
    }
    expect(markup).not.toContain('id="section-foundation"');
    expect(markup).not.toContain('id="section-horizon"');
    expect(markup).not.toContain('data-testid="credit-ladder"');
    expect(markup).not.toContain('data-testid="horizon-section"');
    expect(markup).toContain('href="/flight-deck#section-foundation"');
    expect(markup).toContain('href="/flight-deck#section-horizon"');
    expect(t).toContain("Lumière Higher-Ed Pathways");
  });

  it("draws overall progress once, on the Flight Deck, as scoped counts", () => {
    expect(count(markup, 'data-testid="progress-summary"')).toBe(0);
    expect(count(fd, 'data-testid="progress-summary"')).toBe(1);
    expect(count(fd, 'data-testid="count-bar"')).toBe(1);
    expect(fdt).toContain("Roadmap courses officially accepted");
    expect(fdt).toContain("Complete at provider");
    expect(fdt).not.toMatch(/\d\s?%/);
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
    expect(fd).toContain('data-testid="summary-scope"');
    expect(fdt).toContain("Roadmap courses across all phases: 9 roadmap courses");
    expect(fdt).toContain("These counts cover roadmap courses only");
    expect(t).toContain("In this phase:");
    expect(fdt).toContain("75 credits reported in total: 66 of them verified, 9 waiting for Lumière to verify.");
    expect(fdt).not.toContain("Preliminary");
    expect(fdt).toContain("Waiting for verification");
  });
  it("shows the prior-credit baseline as a separate, labelled figure", () => {
    expect(fd).toContain('data-testid="credit-baseline"');
    expect(fdt).toContain("Prior-credit baseline");
    expect(fdt).toContain("63 of 120 credits applied");
    expect(fdt).toContain("separate from the roadmap courses");
    // The baseline sits outside the count legend, so 0 accepted can never be read as 0 credit.
    const legend = fd.slice(fd.indexOf('data-testid="count-legend"'), fd.indexOf('data-testid="credit-baseline"'));
    expect(text(legend)).not.toContain("63");
  });
  it("shows exactly one 'Current phase' and labels the other active phase 'Also active'", () => {
    expect(count(text(markup), "Current phase")).toBe(1);
    expect(count(text(markup), "Also active")).toBeGreaterThanOrEqual(1);
    expect(count(fdt, "Current phase")).toBe(1);
    expect(fdt).toContain("Also active");
    expect(markup).toContain('data-phase-state="also_active"');
  });
  it("titles the page by the primary program, not the staff plan title", () => {
    expect(text(markup)).toContain("Bachelor of Business Administration");
    expect(markup).toMatch(/<h1[^>]*>Bachelor of Business Administration<\/h1>/);
    expect(markup).not.toMatch(/<h1[^>]*>Bachelor of Business Administration pathway/);
  });
  it("has a single Now target for the Today nav and no separate Today block", () => {
    expect(markup).toContain('id="section-today"');
    expect(count(markup, 'id="section-today"')).toBe(1);
    expect(markup).not.toContain('data-testid="today-section"');
    expect(markup).not.toContain('data-testid="jump-menu"');
    expect(markup).not.toContain('data-testid="current-phase-line"');
  });
  it("accounts for credit outside listed credentials and shows still-to-plan", () => {
    expect(fd).toContain('data-testid="other-credit-note"');
    expect(fdt).toContain("Plus 6 more verified credits from other courses on your record.");
    expect(fd).toContain('data-rung="still"');
    expect(fdt).toContain("63 credits applied (solid) + 3 credits surplus (hatched)");
  });
  it("keeps the Verified bar one colour whether or not there is surplus", () => {
    const withSurplus = html(React.createElement(CreditLadder, { ladder: V.foundation.ladder }));
    const noSurplus = html(React.createElement(CreditLadder, { ladder: { ...V.foundation.ladder, surplus: "0.00", applied: "66.00" } }));
    for (const m of [withSurplus, noSurplus]) {
      const bar = m.slice(m.indexOf('data-bar="verified"'));
      expect(bar.slice(0, 400)).toContain("--st-official");
      expect(bar.slice(0, 400)).not.toContain("--st-applied");
    }
  });
  it("never offers 'Graded' as a student action", () => {
    expect(t).not.toMatch(/\bGraded\b/);
  });

  it("renders phases with the current one expanded and others collapsed", () => {
    expect(count(markup, 'data-testid="phase"')).toBe(4);
    const toggles = markup.match(/<button[^>]*data-testid="phase-toggle"/g)!;
    // Business Core and Nursing Prerequisites are both current (activity in each); the rest are collapsed.
    expect(toggles.filter((b) => b.includes('aria-expanded="true"'))).toHaveLength(2);
    expect(toggles.filter((b) => b.includes('aria-expanded="false"'))).toHaveLength(2);
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
    expect(fd).toContain('data-testid="credit-ladder"');
    expect(fdt).toContain("Verified credits beyond what any requirement needs; they're on your record but don't move you closer to graduation.");
    expect(fdt).toContain("Part of the reported total that Lumière has checked and accepted");
    expect(fdt).toContain("Applied means that credit is counted toward a degree requirement");
    for (const r of ["reported", "provisional", "verified", "applied", "planned"]) expect(fd).toContain(`data-rung="${r}"`);
  });

  it("lists upcoming phases and milestones with target dates on the Flight Deck horizon", () => {
    expect(fdt).toContain("Nursing school application");
    expect(fdt).toContain("Target May 15, 2027");
    expect(fd).toContain('data-testid="upcoming-phases"');
  });

  it("explains 'Awaiting approval' and 'On hold' inline on collapsed rows, not only on hover", () => {
    const collapsed = html(React.createElement(ItemCard, { item: itemsByKey(V).get("bba-mgmt320")! }));
    const before = collapsed.slice(0, collapsed.indexOf('data-testid="item-panel"'));
    expect(text(before)).toContain("Awaiting approval");
    expect(text(before)).toContain("Your advisor must approve this course before you can start it.");
    expect(before).not.toContain("title=");
    const hold = html(React.createElement(ItemCard, { item: itemsByKey(V).get("bba-fin330")! }));
    expect(text(hold.slice(0, hold.indexOf('data-testid="item-panel"')))).toContain("Lumière has paused this course.");
  });

  it("labels every step of the stage track with visible text", () => {
    const m = html(React.createElement(StageTrack, { stage: "in_progress" }));
    for (const short of ["Not started", "Started", "Submitted", "All done", "At provider", "Official"]) expect(m).toContain(`>${short}</span>`);
    expect(count(m, "<li")).toBe(6);
    expect(m).toContain('aria-current="step"');
  });

  it("offers no course add/edit/delete controls", () => {
    expect(t).not.toMatch(/Add course|Edit course|Delete course|Assign course|Add a course/i);
    expect(markup).not.toContain("button-add-course");
  });

  it("uses real, labelled controls with aria-expanded disclosures", () => {
    expect(markup).toContain("<select");
    expect(markup).not.toContain('type="checkbox"');
    expect(markup).toContain("Change status");
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
    expect(markup).toContain('data-testid="foundation-section"');
    expect(markup).toContain('data-testid="horizon-section"');
    expect(count(markup, 'data-testid="milestone"')).toBe(4);
    expect(count(markup, 'data-testid="now-strip"')).toBe(0);
    expect(markup).toContain('href="/roadmap"');
    expect(markup).toContain('data-testid="journey-strip"');
    expect(count(t, "Current phase")).toBe(1);
  });
  it("has one obvious primary action to the first focus course", () => {
    expect(count(markup, 'data-testid="primary-cta"')).toBe(1);
    expect(markup).toMatch(/data-testid="primary-cta"[^>]*>|href="\/roadmap#item-bba-mkt300"[^>]*data-testid="primary-cta"/);
    expect(t).toContain("Continue Principles of Marketing");
  });
  it("Next up lists only actionable tasks; submitted tasks are listed as Awaiting grading", () => {
    const hero = markup.slice(markup.indexOf('data-hero="true"'));
    const nextUp = hero.slice(hero.indexOf("Next up"), hero.indexOf("Awaiting grading"));
    expect(nextUp).not.toContain("Touchstone 2");
    expect(nextUp).toContain("Challenge 6");
    expect(text(hero)).toContain("Awaiting grading (1)");
    expect(text(hero.slice(hero.indexOf("Awaiting grading")))).toContain("Touchstone 2");
    expect(t).toContain("1 task submitted, awaiting grading");
  });
  it("shows task due dates and flags overdue ones in words", () => {
    expect(markup).toContain('data-testid="task-due"');
    // Wording depends on today's date; the exact rules are unit-tested in s07-student-ui-presentation.
    expect(t).toMatch(/(Due |Overdue since )/);
  });
  it("takes credit numbers from the ladder only", () => {
    expect(markup).toContain('data-testid="rung-verified"');
    expect(t).toMatch(/Verified 66/);
    expect(t).toMatch(/Applied 63/);
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
      if (el === FlightDeckRoadmapView) expect(m).toContain('data-testid="credit-ladder"');
      else expect(m).toContain('href="/flight-deck#section-foundation"');
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
  it("ItemCard: reportable items keep their controls; gated and accepted ones show none", () => {
    const items = itemsByKey(V);
    const open = html(React.createElement(ItemCard, { item: items.get("bba-mkt300")!, defaultOpen: true }));
    expect(open).toContain('data-testid="button-provider-complete"');
    expect(text(open)).toContain("Lumière will review it. Telling us you finished does not award credit.");
    expect(text(open)).toContain("I finished this at the provider");
    expect(text(open)).toContain("6 done · show");
    const accepted = html(React.createElement(ItemCard, { item: items.get("bba-eng101")!, defaultOpen: true }));
    expect(accepted).not.toContain('data-testid="button-provider-complete"');
    expect(accepted).not.toContain("<select");
    expect(accepted).toContain('data-testid="status-readout"');
    for (const key of ["bba-fin330", "bba-mgmt320"]) {
      const gated = html(React.createElement(ItemCard, { item: items.get(key)!, defaultOpen: true }));
      expect(gated).not.toContain("<select");
      expect(gated).not.toContain('data-testid="button-provider-complete"');
      expect(gated).not.toContain("Mark started");
      expect(gated).toContain('data-testid="status-readout"');
    }
    expect(text(html(React.createElement(ItemCard, { item: items.get("bba-fin330")!, defaultOpen: true })))).toContain("Reporting reopens when Lumière lifts the hold.");
    expect(text(html(React.createElement(ItemCard, { item: items.get("bba-mgmt320")!, defaultOpen: true })))).toContain("Waiting for advisor approval before you start.");
    const undo = html(React.createElement(ItemCard, { item: items.get("bba-stat200")!, defaultOpen: true }));
    expect(undo).toContain('data-testid="button-undo-provider-complete"');
  });
  it("TaskRow uses one labelled status menu for every task kind", () => {
    const item = itemsByKey(V).get("bba-mkt300")!;
    const challenge = html(React.createElement("ul", null, React.createElement(TaskRow, { item, task: item.tasks[5] })));
    expect(challenge).toContain('aria-label="Challenge 6: status Started. Change status"');
    expect(count(challenge, "<select")).toBe(1);
    expect(challenge).not.toContain('type="checkbox"');
    expect(challenge).not.toContain("Mark started");
    const ts = item.tasks.find((x) => x.kind === "touchstone")!;
    const seg = html(React.createElement("ul", null, React.createElement(TaskRow, { item, task: ts })));
    expect(count(seg, "<select")).toBe(1);
    expect(count(seg, "<option")).toBe(4);
    expect(text(seg)).toContain("Done");
    expect(text(seg)).not.toContain("Graded");
  });
  it("CreditLadder shows Under review for a withheld applied figure", () => {
    const m = html(React.createElement(CreditLadder, { ladder: { ...V.foundation.ladder, applied: null, surplus: null } }));
    expect(text(m)).toContain("Under review");
    expect(m).not.toContain('data-testid="surplus-note"');
  });
});
