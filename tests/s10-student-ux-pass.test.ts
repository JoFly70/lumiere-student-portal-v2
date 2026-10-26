/**
 * S10 student UX pass: one authoritative cache for Flight Deck and Roadmap, one
 * canonical applied-credit summary, reported completion never presented as
 * official, readable stage labels, and phone-length collapses.
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { FlightDeckRoadmapView, RoadmapPageView } from "../client/src/components/student-progress/student-roadmap-views";
import { StageTrack, phaseFinishedLine } from "../client/src/components/student-progress/journey-graphics";
import { applyAuthoritativeView } from "../client/src/components/student-progress/roadmap-actions";
import { STUDENT_ROADMAP_QUERY_KEY } from "../client/src/lib/student-roadmap-queries";
import { RICH_MID_JOURNEY as V } from "./helpers/student-roadmap-ui-fixtures";

(globalThis as any).React = React;

const html = (el: React.ReactElement) =>
  renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(Router, { ssrPath: "/" }, el)),
  );
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const count = (m: string, needle: string) => m.split(needle).length - 1;
const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("S10 UX pass: one authoritative roadmap view", () => {
  it("Flight Deck and Roadmap read the same query key and the same write path", () => {
    for (const page of ["client/src/pages/flight-deck.tsx", "client/src/pages/roadmap.tsx"]) {
      const src = read(page);
      expect(src).toMatch(/queryKey: \[\.\.\.STUDENT_ROADMAP_QUERY_KEY\]/);
      expect(src).toContain("RoadmapActionsProvider");
    }
    expect(read("client/src/components/student-progress/roadmap-actions.tsx")).toContain("applyAuthoritativeView(queryClient, view)");
  });

  it("a write made from either page reaches the other without a reload", () => {
    const client = new QueryClient();
    const flightDeck = new QueryObserver<typeof V>(client, { queryKey: [...STUDENT_ROADMAP_QUERY_KEY], queryFn: async () => V, staleTime: Infinity });
    const roadmap = new QueryObserver<typeof V>(client, { queryKey: [...STUDENT_ROADMAP_QUERY_KEY], queryFn: async () => V, staleTime: Infinity });
    const seenByFlightDeck: number[] = [];
    const seenByRoadmap: number[] = [];
    const unsubA = flightDeck.subscribe((r) => seenByFlightDeck.push(r.data?.counts.itemsInProgress ?? -1));
    const unsubB = roadmap.subscribe((r) => seenByRoadmap.push(r.data?.counts.itemsInProgress ?? -1));
    const written = { ...V, counts: { ...V.counts, itemsInProgress: V.counts.itemsInProgress + 1 } };
    applyAuthoritativeView(client, written); // the Roadmap writes ...
    expect(flightDeck.getCurrentResult().data?.counts.itemsInProgress).toBe(written.counts.itemsInProgress); // ... Flight Deck sees it
    const back = { ...written, counts: { ...written.counts, itemsInProgress: written.counts.itemsInProgress + 1 } };
    applyAuthoritativeView(client, back); // the Flight Deck writes ...
    expect(roadmap.getCurrentResult().data?.counts.itemsInProgress).toBe(back.counts.itemsInProgress); // ... Roadmap sees it
    expect(seenByFlightDeck).toContain(back.counts.itemsInProgress);
    expect(seenByRoadmap).toContain(written.counts.itemsInProgress);
    unsubA();
    unsubB();
  });
});

describe("S10 UX pass: credit display", () => {
  const fd = html(React.createElement(FlightDeckRoadmapView, { view: V }));
  const rm = html(React.createElement(RoadmapPageView, { view: V }));

  it("Flight Deck states the applied-of-required summary once, from foundation.ladder", () => {
    expect(count(text(fd), "63 of 120 credits applied")).toBe(1);
    expect(V.foundation.ladder.applied).toBe("63.00");
    expect(V.foundation.ladder.required).toBe("120.00");
  });

  it("Roadmap's starting point uses the same applied field and names it applied", () => {
    expect(text(rm)).toContain("63 credits already applied to your degree");
  });

  it("labels each credential amount as awarded or reported, never bare", () => {
    expect(text(fd)).toMatch(/60 credits awarded/);
    expect(text(fd)).toMatch(/9 credits reported/);
  });

  it("names reported completion as awaiting Lumière, never as official", () => {
    const view = structuredClone(V) as typeof V;
    const phase = view.phases.find((p) => p.items.some((i) => i.planStatus === "planned"))!;
    const item = phase.items.find((i) => i.planStatus === "planned")!;
    item.stage = "provider_complete";
    expect(phaseFinishedLine(phase)).toContain("awaiting Lumière's acceptance");
    expect(text(html(React.createElement(FlightDeckRoadmapView, { view })))).toContain("awaiting Lumière's acceptance");
  });
});

describe("S10 UX pass: naming and labels", () => {
  const fd = html(React.createElement(FlightDeckRoadmapView, { view: V }));
  const rm = html(React.createElement(RoadmapPageView, { view: V }));

  it("'Journey' means the overview on the Flight Deck only; the Roadmap section is 'Phases'", () => {
    expect(fd).toContain('href="#section-journey"');
    expect(rm).not.toContain('href="#section-journey"');
    expect(rm).toMatch(/href="#section-roadmap"[^>]*>Phases</);
    expect(text(rm)).toContain("Your phases");
    expect(text(rm)).not.toContain("Your journey");
  });

  it("stage track never uses sub-12px text; below sm it shows a step summary and keeps the full list for assistive tech", () => {
    const m = html(React.createElement(StageTrack, { stage: "in_progress" }));
    expect(m).not.toMatch(/text-\[(9|10|11)px\]/);
    expect(m).toContain('data-testid="stage-track-summary"');
    expect(text(m)).toContain("Step 2 of 6: In progress");
    expect(text(m)).toContain("Next: Submitted");
    for (const label of ["Not started", "In progress", "Submitted", "All tasks done", "Complete at provider", "Officially accepted"]) {
      expect(m).toContain(label);
    }
  });
});

describe("S10 UX pass: phone length", () => {
  const fd = html(React.createElement(FlightDeckRoadmapView, { view: V }));
  it("journey strip collapses completed and upcoming phases on phones but keeps the current phase", () => {
    expect(fd).toContain('data-testid="strip-toggle-other"');
    const strip = fd.slice(fd.indexOf('data-testid="journey-strip"'));
    const li = (state: string) => strip.match(new RegExp(`<li[^>]*data-strip="phase" data-phase-state="${state}"`))?.[0] ?? "";
    expect(li("current")).not.toBe("");
    expect(li("current")).not.toContain("max-md:hidden");
    expect(li("complete")).toContain("max-md:hidden");
    expect(li("upcoming")).toContain("max-md:hidden");
  });
  it("other in-progress courses sit behind a counted disclosure but remain in the page", () => {
    expect(fd).toContain('data-testid="also-in-progress"');
    expect(text(fd)).toMatch(/Show \d+ more courses? in progress/);
    expect(count(fd, 'data-testid="focus-item"')).toBeGreaterThan(1);
  });
});
