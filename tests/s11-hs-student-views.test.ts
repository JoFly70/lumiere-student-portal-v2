import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { HighSchoolPageView } from "../client/src/components/high-school/high-school-view";
import { FamilyCard } from "../client/src/components/high-school/family-card";
import { HsError, HsNoEnrollment, HsSkeleton } from "../client/src/components/high-school/states";
import { interpretProgressError, isNoEnrollment } from "../client/src/lib/high-school-queries";
import { ApiError } from "../client/src/lib/api";
import {
  GUARDIANS_ALL,
  HS_AWAITING_REVIEW,
  HS_DISCLOSED_MID_WAY,
  HS_ELIGIBLE,
  HS_GRADUATED,
  HS_MID_WAY,
  HS_NEARLY_DONE,
  HS_NEW_STUDENT,
  HS_NO_ROADMAP,
  HS_SHUFFLED_SUBJECTS,
  HS_TENNESSEE,
  HS_TODAY,
} from "./helpers/s11-hs-ui-fixtures";
import type { StudentHighSchoolView } from "../shared/high-school-contract";

(globalThis as any).React = React;

const html = (el: React.ReactElement) =>
  renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(Router, { ssrPath: "/high-school" }, el)));
const page = (view: StudentHighSchoolView, extra: Record<string, unknown> = {}) => html(React.createElement(HighSchoolPageView, { view, today: HS_TODAY, ...extra }));
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&ldquo;|&rdquo;/g, '"').replace(/\s+/g, " ");
const panel = (m: string, id: string) => {
  const start = m.indexOf(`id="hs-panel-${id}"`);
  const next = m.indexOf('role="tabpanel"', start + 10);
  return m.slice(start, next === -1 ? undefined : next);
};

describe("S11 page structure and accessibility", () => {
  const markup = page(HS_MID_WAY);
  it("has an accessible tab list with three tabs and matching panels", () => {
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="High school sections"');
    expect(markup.match(/role="tab"/g)?.length).toBe(3);
    expect(markup.match(/role="tabpanel"/g)?.length).toBe(3);
    expect(markup).toContain('id="hs-tab-journey"');
    expect(markup).toContain('aria-controls="hs-panel-subjects"');
    expect(markup).toMatch(/id="hs-tab-journey"[^>]*aria-selected="true"/);
    expect(markup).toMatch(/aria-selected="false"[^>]*tabindex="-1"/);
    expect(markup).toMatch(/id="hs-panel-subjects"[^>]*hidden/);
  });
  it("has one h1 and labelled landmarks", () => {
    expect(markup.match(/<h1/g)?.length).toBe(1);
    expect(markup).toContain('role="note"');
    expect(markup).toContain('role="img"');
    expect(markup).toMatch(/role="meter"[^>]*aria-label="[^"]+"/);
  });
  it("subject and course toggles are buttons with aria-expanded/controls", () => {
    const subjects = panel(markup, "subjects");
    expect(subjects.match(/data-testid="subject-toggle"/g)?.length).toBe(7);
    expect(subjects.match(/aria-expanded="false"/g)?.length).toBeGreaterThanOrEqual(7);
    expect(subjects).toMatch(/aria-controls="[^"]+"/);
  });
  it("never uses the word guarantee as a promise", () => {
    for (const v of [HS_NEW_STUDENT, HS_MID_WAY, HS_NEARLY_DONE, HS_AWAITING_REVIEW, HS_ELIGIBLE, HS_GRADUATED, HS_TENNESSEE]) {
      const t = text(page(v));
      expect(t).not.toMatch(/guaranteed|we guarantee|will graduate/i);
      expect(t.replace(/not a guarantee/gi, "")).not.toMatch(/guarantee/i);
    }
  });
});

describe("S11 journey tab", () => {
  const markup = page(HS_MID_WAY);
  const t = text(panel(markup, "journey"));
  it("shows credits from half-units: 10.5 of 21, with awaiting figure separate", () => {
    expect(t).toContain("10.5 of 21 credits");
    expect(t).toContain("10.5 credits"); // remaining
    expect(t).toContain("1 credit awaiting school confirmation");
    expect(markup).toContain('aria-label="10.5 of 21 credits official, plus 1 credit awaiting school confirmation"');
    expect(t).not.toMatch(/10\.5000|\bNaN\b/);
  });
  it("renders 20.5 and 0.5 exactly", () => {
    const n = text(panel(page(HS_NEARLY_DONE), "journey"));
    expect(n).toContain("20.5 of 21 credits");
    expect(n).toContain("0.5 credits awaiting school confirmation");
  });
  it("shows the next task with a target date, not a deadline guarantee", () => {
    expect(t).toContain("Written project: research paper");
    expect(t).toContain("English 3");
    expect(t).toMatch(/Target was Oct 19, 2026/);
  });
  it("shows pace as a target, attention items, awaiting grade and written projects", () => {
    expect(t).toContain("Behind target");
    expect(t).toContain("Needs Lumière's attention");
    expect(t).toContain("Your English 3 research paper is past its target date.");
    expect(t).toContain("Waiting for a grade");
    expect(t).toContain("Pending school review");
    expect(t).toContain("Required written projects");
    expect(t).toContain("About 36 weeks to your target date");
  });
  it("shows roadmap version and staff message", () => {
    expect(t).toContain("Roadmap version 2");
    expect(t).toContain("We moved one math course to January");
  });
  it("keeps the official figure and the pending figure as separate statements", () => {
    expect(t).toContain("10.5 of 21 credits");
    expect(t).toContain("Not counted until the school confirms it.");
  });
  it("new student: no pace configured, welcome copy", () => {
    const n = text(panel(page(HS_NEW_STUDENT), "journey"));
    expect(n).toContain("Target not set yet");
    expect(n).toContain("0 of 21 credits");
    expect(n).toContain("Nothing needs attention right now");
  });
});

describe("S11 school line and governance", () => {
  it("shows a generic description when the institution is not disclosed", () => {
    const m = page(HS_MID_WAY);
    expect(m).toMatch(/data-testid="school-name">An accredited U\.S\. online high school</);
    expect(text(m)).not.toContain("Meridian");
  });
  it("shows the confirmed school name only when disclosed", () => {
    expect(page(HS_DISCLOSED_MID_WAY)).toMatch(/data-testid="school-name">Meridian Online Academy</);
  });
  it("states who confirms what", () => {
    expect(text(page(HS_MID_WAY))).toContain("Your school confirms grades, credits and your diploma. Lumière plans and supports.");
  });
});

describe("S11 subjects tab", () => {
  const markup = page(HS_MID_WAY, { initialTab: "subjects" });
  const sub = panel(markup, "subjects");
  const t = text(sub);
  it("lists the seven groups in the required order, even if the server order differs", () => {
    const order = ["English", "Mathematics", "Science", "Social Studies", "Humanities and Digital Literacy", "Health and Physical Education", "Electives"];
    for (const m of [markup, page(HS_SHUFFLED_SUBJECTS)]) {
      const s = panel(m, "subjects");
      const idx = order.map((o) => s.indexOf(`>${o}</span>`));
      expect(idx.every((i) => i > -1)).toBe(true);
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    }
  });
  it("shows earned and required credits per subject, labelled official", () => {
    expect(t).toContain("2 of 4 credits (official)"); // English
    expect(t).toContain("2 of 3 credits (official)"); // Mathematics
    expect(t).toContain("1.5 of 5 credits (official)"); // Electives: 0.5 + 1 transfer
  });
  it("keeps the replaced course visible and muted with its history", () => {
    expect(sub).toContain('data-course-status="replaced"');
    expect(t).toContain("Replaced in your updated plan");
    expect(t).toContain("Lumière kept this course and your work on it for your records");
  });
  it("labels transfer-credit courses", () => {
    expect(sub).toContain('data-course-status="transfer_credit"');
    expect(t).toContain("Transfer credit (accepted by the school)");
  });
  it("tasks show official vs reported grades with separate labels", () => {
    const open = text(page(HS_MID_WAY, { initialTab: "subjects", defaultOpenSubject: "science", defaultOpenCourse: "science-biology" }));
    expect(open).toContain("You reported: 91%");
    expect(open).toContain("Official (confirmed by the school): 88%");
    expect(open).toContain("Pending school review");
  });
  it("offers progress controls for open tasks and locks official ones", () => {
    const m = page(HS_MID_WAY, { initialTab: "subjects", defaultOpenSubject: "english", defaultOpenCourse: "english-3" });
    expect(m).toContain('data-testid="select-task-status"');
    expect(m).toContain("Submitted to the school");
    expect(m).toContain("Grade you saw, 0 to 100 (optional)");
    expect(text(m)).toContain("Confirmed by the school, so it is locked here.");
  });
  it("offers a course support request that goes through the Support Center", () => {
    const m = page(HS_MID_WAY, { initialTab: "subjects" });
    expect(m).toContain('data-testid="button-request-support"');
    expect(m).toContain('aria-label="Ask Lumière for help with English 3: Analyzing Texts and Building Compositions"');
    expect(m).toContain('href="/support"');
  });
});

describe("S11 graduation tab", () => {
  it("before eligibility: transcript button is disabled and explains why", () => {
    const m = panel(page(HS_AWAITING_REVIEW, { initialTab: "graduation" }), "graduation");
    expect(m).toMatch(/<button[^>]*disabled=""[^>]*data-testid="button-request-transcript"/);
    expect(m).toContain('aria-describedby="hs-transcript-reason"');
    expect(text(m)).toContain("once your school confirms you are eligible to graduate");
    expect(text(m)).toContain("Review by the school pending");
  });
  it("after eligibility: transcript button is enabled", () => {
    const m = panel(page(HS_ELIGIBLE, { initialTab: "graduation" }), "graduation");
    expect(m).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="button-request-transcript"/);
    expect(text(m)).toContain("Eligibility confirmed by the school");
    expect(text(m)).toContain("On hold");
  });
  it("shows no financial status when the value is null", () => {
    const m = text(panel(page(HS_MID_WAY, { initialTab: "graduation" }), "graduation"));
    expect(m).toContain("Not available here — ask Lumière.");
    expect(m).not.toMatch(/Cleared|On hold/);
    expect(panel(page(HS_AWAITING_REVIEW), "graduation")).toContain('data-testid="financial-status"');
  });
  it("separates core and elective credits and outstanding work", () => {
    const m = text(panel(page(HS_MID_WAY), "graduation"));
    expect(m).toContain("Core credits");
    expect(m).toContain("9 of 16 credits (official)");
    expect(m).toContain("Elective credits");
    expect(m).toContain("1.5 of 5 credits (official)");
    expect(m).toMatch(/\d+ exams? (is|are) still outstanding/);
    expect(m).toMatch(/\d+ projects? (is|are) still outstanding/);
  });
  it("links to the existing Documents page for official files", () => {
    expect(panel(page(HS_GRADUATED), "graduation")).toContain('href="/documents"');
  });
  it("graduated: celebratory banner, diploma conferred date", () => {
    const m = page(HS_GRADUATED);
    expect(m).toContain('data-testid="graduated-banner"');
    expect(text(m)).toContain("Congratulations, you graduated");
    expect(text(panel(m, "graduation"))).toContain("Oct 10, 2026");
    expect(page(HS_MID_WAY)).not.toContain("graduated-banner");
  });
});

describe("S11 family and prior education", () => {
  const m = html(React.createElement(FamilyCard, { guardians: GUARDIANS_ALL }));
  it("shows each standing label", () => {
    const t = text(m);
    expect(t).toContain("Verified guardian");
    expect(t).toContain("Listed parent");
    expect(t).toContain("Guardian — awaiting verification");
    expect(m.match(/data-testid="guardian-row"/g)?.length).toBe(4);
  });
  it("explains that verification is not portal access", () => {
    const t = text(m);
    expect(t).toContain("Verification does not give anyone access to your portal account");
    expect(t).toContain("discusses grades or billing only with verified guardians who have that permission");
    expect(m.match(/No portal access\./g)?.length).toBe(4);
  });
  it("links to the existing contacts section instead of duplicating the editor", () => {
    expect(m).toContain('href="/profile#section-contacts"');
    expect(m).not.toContain("<input");
  });
  it("transfer claims are under review, never credit", () => {
    const t = text(panel(page(HS_MID_WAY), "journey"));
    expect(t).toContain("Under review by the school");
    expect(t).toContain("Courses you took before can sometimes transfer. They count as credit only after your school accepts them.");
  });
});

describe("S11 states", () => {
  it("no roadmap: dedicated state, no tabs", () => {
    const m = page(HS_NO_ROADMAP);
    expect(m).toContain('data-testid="hs-no-roadmap"');
    expect(m).not.toContain('role="tablist"');
  });
  it("skeleton, error with retry, no enrollment with support link", () => {
    expect(html(React.createElement(HsSkeleton))).toContain('role="status"');
    const err = html(React.createElement(HsError, { onRetry: () => {} }));
    expect(err).toContain('role="alert"');
    expect(err).toContain("Try again");
    const none = html(React.createElement(HsNoEnrollment));
    expect(none).toContain("Your high school plan isn&#x27;t set up yet");
    expect(none).toContain('href="/support"');
  });
  it("maps API errors", () => {
    expect(isNoEnrollment(new ApiError("none", 404, "HS_NO_ENROLLMENT"))).toBe(true);
    expect(isNoEnrollment(new ApiError("none", 404, "OTHER"))).toBe(false);
    const c = interpretProgressError(new ApiError("stale", 409, "HS_REVISION_CONFLICT"));
    expect(c).toMatchObject({ kind: "conflict", refetch: true });
    expect(interpretProgressError(new ApiError("boom", 500, "X"))).toMatchObject({ kind: "error", refetch: false, message: "boom" });
  });
});
