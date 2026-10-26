import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { FlightDeckView } from "../client/src/components/student-progress/flight-deck-view";
import { RoadmapView } from "../client/src/components/student-progress/roadmap-view";
import {
  PlanNotReady,
  ProgressError,
  ProgressSkeleton,
} from "../client/src/components/student-progress/states";
import {
  COMPOSED,
  COMPOSED_NO_TOTALS,
  NO_ACTIVE_PROGRAM,
  UNDER_REVIEW,
} from "./helpers/student-progress-ui-fixtures";

// vitest transforms .tsx with the classic JSX runtime (tsconfig uses "preserve"),
// so shadcn components that rely on a global React need it provided.
(globalThis as any).React = React;

// wouter links need a router context when rendered outside a browser.
const html = (el: React.ReactElement) =>
  renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" }, el));
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

const enrollments = [
  { id: "e1", courseCode: "BUS200", title: "Intro Marketing", credits: 3, status: "in_progress", provider: { name: "Sophia" } },
];

describe("S04 Flight Deck view", () => {
  it("renders the composed cockpit with canonical figures and an accessible ring", () => {
    const markup = html(React.createElement(FlightDeckView, { view: COMPOSED }));
    const t = text(markup);
    expect(t).toContain("Bachelor of Business Administration");
    expect(t).toContain("October 26, 2026");
    expect(markup).toContain('aria-label="36.5 of 120 required credits applied; 83.5 remaining."');
    expect(t).toContain("Verified credits on record");
    expect(t).toContain("Awaiting verification");
    expect(t).toContain("1 of 4");
    expect(t).toContain("Your next step");
    expect(markup).toContain('href="/documents"');
    expect(t).toContain("Lumière staff is reviewing");
    expect(t).toContain("Action for you");
    expect(markup).toContain('href="/roadmap"');
    expect(markup).toContain('data-testid="milestone-track"');
    expect((markup.match(/data-testid="milestone-segment"/g) ?? []).length).toBe(2);
    expect(markup).toContain('data-reached="true"');
    // Hero next step is not repeated in the attention list; the other student item is a link.
    expect(markup).toContain('data-testid="attention-link"');
    expect(t.match(/Upload your capstone plan/g)?.length).toBe(1);
  });

  it("shows every requirement as a row in strip order with a matching legend", () => {
    const markup = html(React.createElement(FlightDeckView, { view: COMPOSED }));
    const t = text(markup);
    for (const id of ["r1", "r2", "r3", "r4"]) expect(markup).toContain(`glance-row-${id}`);
    expect(markup.indexOf("glance-row-r1")).toBeLessThan(markup.indexOf("glance-row-r2"));
    expect((markup.match(/<span class="h-full flex-1 rounded-full/g) ?? []).length).toBe(4);
    expect(t).toContain("1 satisfied");
    expect(t).toContain("1 in progress");
    expect(t).toContain("1 outstanding");
    expect(t).toContain("1 under review");
  });

  it("hides milestones when totals are null or state is not COMPOSED", () => {
    for (const v of [COMPOSED_NO_TOTALS, UNDER_REVIEW, NO_ACTIVE_PROGRAM]) {
      expect(html(React.createElement(FlightDeckView, { view: v }))).not.toContain("milestone-track");
    }
  });

  it("does not say staff is reviewing for a missing program", () => {
    const t = text(html(React.createElement(FlightDeckView, { view: NO_ACTIVE_PROGRAM })));
    expect(t).toContain("Your advisor acts next");
    expect(t).not.toContain("Lumi\u00e8re staff is reviewing Program not assigned");
  });

  it("does not render legacy estimates", () => {
    const t = text(html(React.createElement(FlightDeckView, { view: COMPOSED })));
    for (const word of ["pace", "Pace", "projection", "Projected", "Cost", "graduation date"]) {
      expect(t).not.toContain(word);
    }
  });

  it("renders no numbers at all for UNDER_REVIEW", () => {
    const markup = html(React.createElement(FlightDeckView, { view: UNDER_REVIEW }));
    const t = text(markup);
    expect(markup).toContain('data-testid="under-review-state"');
    expect(t).toContain("Lumière staff is reviewing your academic record");
    expect(markup).not.toContain('data-testid="progress-ring"');
    expect(markup).not.toContain('data-testid="milestone-track"');
    expect(markup).not.toContain("figure-applied");
    // Only the page chrome date; strip it and assert no digits remain in body copy.
    const withoutDate = t.replace("Record as of October 26, 2026", "");
    expect(withoutDate).not.toMatch(/\d/);
    expect(t).toContain("Sit tight");
  });

  it("renders the no-active-program state", () => {
    const markup = html(React.createElement(FlightDeckView, { view: NO_ACTIVE_PROGRAM }));
    expect(markup).toContain('data-testid="no-program-state"');
    expect(markup).toContain('href="/support"');
    expect(markup).not.toContain('data-testid="progress-ring"');
  });

  it("explains missing totals without hero numbers", () => {
    const markup = html(React.createElement(FlightDeckView, { view: COMPOSED_NO_TOTALS }));
    expect(markup).toContain("Totals will appear once every requirement has a confirmed credit amount.");
    expect(markup).not.toContain('data-testid="progress-ring"');
    expect(markup).not.toContain("figure-applied");
    expect(markup).toContain('data-testid="requirements-glance"');
  });

  it("renders loading, error and plan-not-ready states", () => {
    expect(html(React.createElement(ProgressSkeleton))).toContain("progress-skeleton");
    const err = html(React.createElement(ProgressError, { onRetry: () => undefined }));
    expect(err).toContain("button-retry");
    expect(html(React.createElement(PlanNotReady))).toContain("flight-deck-incomplete-state");
  });
});

describe("S04 Roadmap view", () => {
  it("renders requirements in order with statuses, amounts and applied courses", () => {
    const markup = html(React.createElement(RoadmapView, { view: COMPOSED, enrollments }));
    const t = text(markup);
    expect(markup.indexOf("English Composition")).toBeLessThan(markup.indexOf("Quantitative Reasoning"));
    expect(markup.indexOf("Quantitative Reasoning")).toBeLessThan(markup.indexOf("Business Core"));
    expect(t).toContain("Satisfied");
    expect(t).toContain("In progress");
    expect(t).toContain("Outstanding");
    expect(t).toContain("Under staff review");
    expect(t).toContain("13.5 credits");
    expect(t).toContain("Courses applied");
    expect(t).toContain("ENG101 · College Writing");
  });

  it("separates verified, awaiting and not-accepted credits and marks preliminary ones", () => {
    const markup = html(React.createElement(RoadmapView, { view: COMPOSED, enrollments }));
    const t = text(markup);
    expect(markup).toContain('data-testid="credit-group-verified"');
    expect(markup).toContain('data-testid="credit-group-awaiting"');
    expect(markup).toContain('data-testid="credit-group-not-accepted"');
    expect(markup).toContain('data-testid="mark-verified"');
    expect(markup).toContain('data-testid="mark-preliminary"');
    expect(t).toContain("verified but not currently applied to a requirement");
    expect(t).toContain("3.5 credits (reported)");
    expect(t).toContain("Credit sources & transfer credit");
    expect(t).toContain("Awaiting verification");
  });

  it("labels self-reported enrollments and offers no Completed option or canonical edit controls", () => {
    const markup = html(React.createElement(RoadmapView, { view: COMPOSED, enrollments }));
    const t = text(markup);
    expect(t).toContain("Your planned & in-progress courses");
    expect(t).toContain("self-reported — not yet part of your verified record");
    expect(markup).not.toContain("button-edit-");
    expect(t).not.toContain("N/A");
    const noCode = html(React.createElement(RoadmapView, { view: COMPOSED, enrollments: [{ id: "e2", title: "Public Speaking", credits: 3, status: "todo" }] }));
    expect(noCode).not.toContain("N/A");
    expect(noCode).not.toContain("text-course-code-e2");
    expect(noCode).toContain("Public Speaking");
    const withHandlers = html(
      React.createElement(RoadmapView, {
        view: COMPOSED,
        enrollments,
        onEditEnrollment: () => undefined,
        onDeleteEnrollment: () => undefined,
      }),
    );
    expect(withHandlers).toContain("button-delete-e1");
    expect(withHandlers).not.toContain('value="completed"');
  });

  it("handles under review, no program and missing totals", () => {
    const review = text(html(React.createElement(RoadmapView, { view: UNDER_REVIEW })));
    expect(review).toContain("Lumière staff is reviewing your academic record");
    expect(review).not.toContain("Your degree roadmap");
    const none = html(React.createElement(RoadmapView, { view: NO_ACTIVE_PROGRAM }));
    expect(none).toContain('data-testid="no-program-state"');
    const noTotals = text(html(React.createElement(RoadmapView, { view: COMPOSED_NO_TOTALS })));
    expect(noTotals).toContain("Totals will appear once every requirement has a confirmed credit amount.");
    expect(noTotals).toContain("English Composition");
  });
});
