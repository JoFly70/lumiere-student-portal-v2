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
  HS_TWO_FINALS,
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
    expect(markup.match(/role="tab"/g)?.length).toBe(4);
    expect(markup.match(/role="tabpanel"/g)?.length).toBe(4);
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
  const j = panel(markup, "journey");
  const t = text(j);
  it("shows OFFICIAL credits only in the ring; reported work is one small text line", () => {
    expect(t).toContain("10.5 of 21 credits");
    expect(t).toContain("10.5 credits"); // remaining
    expect(t).toContain("1 course fully sent (1 credit) — waiting for the school");
    expect(t.match(/10\.5 of 21/g)?.length).toBe(1); // the ring says it once; no side label, no pace restatement
    expect(t).not.toMatch(/Official credits/i);
    expect(t).toContain("Still to earn");
    expect(markup).toContain('aria-label="10.5 of 21 credits official"');
    expect(markup).not.toMatch(/aria-label="[^"]*awaiting/);
    expect(markup).not.toContain("--st-submitted"); // no second arc in the ring
    const ring = j.slice(j.indexOf('data-testid="credit-ring"'), j.indexOf("</svg>", j.indexOf('data-testid="credit-ring"')));
    expect(ring.match(/stroke-dasharray/g)?.length).toBe(1); // only the official arc
    expect(t).not.toMatch(/10\.5000|\bNaN\b/);
  });
  it("renders 20.5 and 0.5 exactly", () => {
    const n = text(panel(page(HS_NEARLY_DONE), "journey"));
    expect(n).toContain("20.5 of 21 credits");
    expect(n).toContain("1 course fully sent (0.5 credits) — waiting for the school");
  });
  it("never says Pending school review anywhere on the page", () => {
    for (const v of [HS_MID_WAY, HS_NEARLY_DONE, HS_TENNESSEE, HS_TWO_FINALS]) {
      for (const tab of ["journey", "subjects", "graduation"] as const) {
        expect(text(page(v, { initialTab: tab }))).not.toMatch(/pending school review|awaiting school confirmation|awaiting confirmation/i);
      }
    }
    expect(text(page(HS_MID_WAY, { initialTab: "subjects", defaultOpenSubject: "science", defaultOpenCourse: "science-biology" }))).toContain("You marked this submitted");
  });
  it("shows the next task with a target date, folded together with attention", () => {
    expect(t).toContain("Written project: research paper");
    expect(t).toContain("English 3");
    expect(t).toMatch(/Target was Oct 19, 2026/);
    const next = j.slice(j.indexOf('data-testid="next-step"'), j.indexOf('data-testid="credits-card"'));
    expect(next).toContain('data-testid="attention-card"');
    expect(text(next)).toContain("Needs attention");
    expect(text(next)).not.toContain("Needs Lumière's attention");
    expect(text(next)).toContain("Your school needs your previous transcript");
    expect(next).toMatch(/data-testid="attention-action" href="\/documents"/);
    expect(text(next)).toContain("Upload in Documents");
    expect(next).not.toMatch(/text-st-attention[^"]*"[^>]*>Your school needs/); // no alarming red text inside the amber card
  });
  it("lists the waiting tasks in the student's words", () => {
    expect(t).toContain("Waiting for your school");
    expect(t).toContain("Tasks you marked submitted — your school has not graded them yet.");
    expect(t).toContain("Final exam");
  });
  it("has one pace card with a single measure and the target caveat, nothing else about time", () => {
    expect(t).toContain("Behind target");
    expect(j).toContain('data-testid="pace-tick"');
    expect(t).toContain("The plan expected 13 credits by now");
    expect(text(j.slice(j.indexOf('data-testid="pace-card"'), j.indexOf('data-testid="awaiting-grade"')))).not.toMatch(/10\.5|of 21/);
    expect(j).toContain('data-testid="pace-tick-label"'); // its own row, not absolutely positioned over text
    expect(j).toMatch(/aria-label="10.5 of 21 credits official; the plan expected 13 by now"/);
    expect(t).toContain("The date is a target, not a guarantee.");
    expect(t).not.toMatch(/Time to your target date|weeks to your target date/);
    expect(j.match(/data-testid="pace-card"/g)?.length).toBe(1);
    expect(j.match(/Behind target/g)?.length).toBe(1);
  });
  it("aligns the Journey cards at the top (no vertically centred card, no stretched dead space)", () => {
    expect(j).toContain("items-start");
    expect(j).not.toContain("justify-center\" data-testid=\"credits-card");
    const credits = j.slice(j.indexOf('data-testid="credits-card"'), j.indexOf('data-testid="pace-card"'));
    expect(credits).not.toMatch(/^[^>]*justify-center/);
    expect(text(credits)).toContain("Core 9 of 16 credits");
    expect(text(credits)).toContain("Elective 1.5 of 5 credits");
  });
  it("is restructured: no projects card, no earlier schooling or family on this tab", () => {
    expect(t).not.toContain("Required written projects");
    expect(j).not.toContain('data-testid="prior-education"');
    expect(j).not.toContain('data-testid="family-card"');
  });
  it("has at most one 'Open this course' button and never repeats a task", () => {
    expect(j.match(/Open this course/g)?.length ?? 0).toBeLessThanOrEqual(1);
    const titles = [...j.matchAll(/class="block text-sm font-medium text-student-ink[^"]*">([^<]+)</g)].map((m) => m[1]);
    expect(new Set(titles).size).toBe(titles.length);
    // the next task is not repeated in the waiting list
    const waiting = text(j.slice(j.indexOf('data-testid="awaiting-grade"')));
    expect(waiting).not.toContain("Written project: research paper");
  });
  it("caps attention at 3 with an 'and N more' disclosure", () => {
    const many = { ...HS_MID_WAY, attention: Array.from({ length: 5 }, (_, i) => ({ kind: "documents_requested" as const, message: `Document ${i + 1} needed`, courseKey: null, taskKey: null })) };
    const m = text(panel(page(many), "journey"));
    expect(m).toContain("and 2 more");
    expect(text(m)).toContain("Your school asked for a document");
    expect(m).toContain("Document 5 needed");
  });
  it("tells apart two waiting tasks that share a title", () => {
    const m = text(panel(page(HS_TWO_FINALS), "journey"));
    expect(m).toContain("Final exam (Biology)");
    expect(m).toContain("Final exam (English 3: Analyzing Texts and Building Compositions)");
  });
  it("shows roadmap version and staff message", () => {
    expect(t).toContain("Roadmap version 2");
    expect(t).toContain("We moved one math course to January");
  });
  it("new student: no pace configured, welcome copy", () => {
    const n = text(panel(page(HS_NEW_STUDENT), "journey"));
    expect(n).toContain("Target not set yet");
    expect(n).toContain("0 of 21 credits");
    expect(n).toContain("Nothing needs attention right now");
    expect(panel(page(HS_NEW_STUDENT), "journey")).not.toContain('data-testid="pace-tick"');
  });
});

describe("S11 header", () => {
  it("is title, one school line and one trust line with a What's official? disclosure", () => {
    const m = page(HS_MID_WAY);
    expect(m).toMatch(/data-testid="button-whats-official"[^>]*>/);
    expect(m).toMatch(/aria-expanded="false"[^>]*aria-controls="hs-official-explainer"/);
    expect(m).toMatch(/id="hs-official-explainer" hidden/);
    expect(text(m)).toContain("Only your school confirms grades, credits and your diploma.");
  });
  it("meta line has separators only from sm up, so mobile never ends a line with a stray dot", () => {
    const m = page(HS_MID_WAY);
    const line = m.slice(m.lastIndexOf("<p", m.indexOf('data-testid="school-line"')), m.indexOf('data-testid="governance-note"'));
    const seps = line.match(/<span aria-hidden="true" class="hidden sm:inline">·<\/span>/g) ?? [];
    expect(seps.length).toBe(2);
    expect(line.replace(/<span aria-hidden="true" class="hidden sm:inline">·<\/span>/g, "").replace(/<[^>]+>/g, "")).not.toContain("·");
    expect(line).toContain("flex-col");
  });
  it("program title matches the credit total", () => {
    for (const v of [HS_MID_WAY, HS_TENNESSEE, HS_GRADUATED]) {
      expect(v.enrollment.programTitle).toContain(`(${v.credits.requiredHalfUnits / 2} credits)`);
      expect(text(page(v))).toContain(v.enrollment.programTitle);
    }
  });
  it("does not restate the governance message in Subjects or Graduation", () => {
    for (const tab of ["subjects", "graduation"] as const) {
      const p = text(panel(page(HS_MID_WAY, { initialTab: tab }), tab));
      expect(p).not.toMatch(/confirms grades, credits/);
      expect(p).not.toMatch(/your own report and helps/);
    }
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
  it("states who confirms what, once, with the longer explanation on demand", () => {
    const t = text(page(HS_MID_WAY));
    expect(t.match(/Only your school confirms grades, credits and your diploma/g)?.length).toBe(1);
    expect(t).toContain("Lumière plans and supports you.");
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
  it("opens only the subject that holds the current course", () => {
    const open = sub.match(/aria-expanded="true"[^>]*data-testid="subject-toggle"/g) ?? [];
    expect(open.length).toBe(1);
    const eng = sub.slice(sub.indexOf('data-subject="english"'), sub.indexOf('data-subject="mathematics"'));
    expect(eng).toMatch(/aria-expanded="true"[^>]*data-testid="subject-toggle"/);
  });
  it("orders courses in progress, not started, then a collapsed Done group", () => {
    const eng = sub.slice(sub.indexOf('data-subject="english"'), sub.indexOf('data-subject="mathematics"'));
    const iProg = eng.indexOf('data-course-status="in_progress"');
    const iNot = eng.indexOf('data-course-status="not_started"');
    const iDoneBtn = eng.indexOf('data-testid="button-done-courses"');
    const iDone = eng.indexOf('data-course-status="official_complete"');
    expect(iProg).toBeGreaterThan(-1);
    expect(iProg).toBeLessThan(iNot);
    expect(iNot).toBeLessThan(iDoneBtn);
    expect(iDoneBtn).toBeLessThan(iDone);
    expect(text(eng)).toContain("Done (2)");
    expect(eng).toMatch(/aria-expanded="false"[^>]*aria-controls="[^"]+"[^>]*data-testid="button-done-courses"/);
    expect(sub).toMatch(/data-testid="filter-projects"/);
  });
  it("names the project filter for what it does and exposes pressed state", () => {
    expect(t).toContain("Show my 2 written projects");
    expect(t).not.toContain("Written projects (2)");
    expect(sub).toMatch(/aria-pressed="false"[^>]*data-testid="filter-projects"/);
  });
  it("uses realistic course titles in fixtures, not plan placeholders", () => {
    expect(t).not.toContain("updated plan)");
    expect(t).toContain("Geometry");
  });
  it("shows earned and required credits per subject, labelled official", () => {
    expect(t).toContain("2 of 4 credits (official)"); // English
    expect(t).toContain("2 of 3 credits (official)"); // Mathematics
    expect(t).toContain("1.5 of 5 credits (official)"); // Electives: 0.5 + 1 transfer
  });
  it("keeps replaced courses available in a collapsed 'Earlier plan' group", () => {
    expect(sub).toContain('data-course-status="replaced"');
    expect(sub).toContain('data-testid="earlier-plan"');
    expect(sub).toMatch(/aria-expanded="false"[^>]*aria-controls="[^"]+"[^>]*data-testid="button-earlier-plan"/);
    expect(t).toContain("Earlier plan (1)");
    expect(t).toContain("Replaced in your updated plan");
    expect(t).toContain("Lumière kept this course and your work on it for your records");
    // the replaced course is inside the Earlier plan group, after the current courses
    const math = sub.slice(sub.indexOf('data-subject="mathematics"'), sub.indexOf('data-subject="science"'));
    expect(math.indexOf('data-testid="earlier-plan"')).toBeLessThan(math.indexOf('data-course-status="replaced"'));
    expect(math.indexOf('data-course-status="not_started"')).toBeLessThan(math.indexOf('data-testid="earlier-plan"'));
  });
  it("shows template placeholder titles plainly with a small 'Course to be confirmed' note", () => {
    const tn = page(HS_MID_WAY, { initialTab: "subjects" });
    expect(text(tn)).toContain("Social Studies course 2");
    expect(text(tn)).not.toContain("(confirmed per enrollment)");
    expect(tn).toContain('data-testid="course-tbc"');
    expect(text(tn)).toContain("Course to be confirmed");
  });
  it("uses singular credit wording", () => {
    expect(t).toMatch(/\b1 credit\b(?!s)/);
    expect(text(page(HS_NEW_STUDENT, { initialTab: "subjects" }))).not.toMatch(/\b1 credits\b/);
  });
  it("has a written-projects indicator and filter, and no awaiting slice in subject bars", () => {
    expect(sub).toContain('data-testid="filter-projects"');
    expect(sub).toContain('data-testid="project-indicator"');
    expect(sub).not.toContain("bg-st-submitted/50");
    expect(t).not.toMatch(/awaiting school confirmation/);
  });
  it("shows Save only when the progress form is dirty (never a faded disabled button)", () => {
    const m = page(HS_MID_WAY, { initialTab: "subjects", defaultOpenSubject: "english", defaultOpenCourse: "english-3" });
    expect(m).toContain('data-testid="task-report"');
    expect(m).not.toContain('data-testid="button-save-task"');
    expect(m).not.toMatch(/<button[^>]*disabled=""/);
  });
  it("labels transfer-credit courses", () => {
    expect(sub).toContain('data-course-status="transfer_credit"');
    expect(t).toContain("Transfer credit (accepted by the school)");
  });
  it("tasks show official vs reported grades with separate labels", () => {
    const open = text(page(HS_MID_WAY, { initialTab: "subjects", defaultOpenSubject: "science", defaultOpenCourse: "science-biology" }));
    expect(open).toContain("You reported: 91%");
    expect(open).toContain("Official (confirmed by the school): 88%");
    expect(open).toContain("You marked this submitted");
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
  it("before eligibility: no transcript button, just the explanation", () => {
    const m = panel(page(HS_AWAITING_REVIEW, { initialTab: "graduation" }), "graduation");
    expect(m).not.toContain('data-testid="button-request-transcript"');
    expect(m).not.toMatch(/<button[^>]*disabled=""/);
    expect(text(m)).toContain("once your school confirms you are eligible to graduate");
    expect(text(m)).toContain("Review by the school pending");
  });
  it("after eligibility: transcript button is present and enabled", () => {
    const m = panel(page(HS_ELIGIBLE, { initialTab: "graduation" }), "graduation");
    expect(m).toMatch(/<button[^>]*data-testid="button-request-transcript"/);
    expect(m).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="button-request-transcript"/);
    expect(text(m)).toContain("Eligibility confirmed by the school");
    expect(text(m)).toContain("Eligibility confirmed on Oct 20, 2026.");
    expect(text(m)).toContain("On hold");
  });
  it("hides the Financial clearance row entirely when the value is null", () => {
    const m = panel(page(HS_MID_WAY, { initialTab: "graduation" }), "graduation");
    expect(m).not.toContain('data-testid="financial-clearance"');
    expect(text(m)).not.toMatch(/Financial clearance|Not available here|Cleared|On hold/);
    expect(panel(page(HS_AWAITING_REVIEW), "graduation")).toContain('data-testid="financial-status"');
  });
  it("separates core and elective credits and phrases outstanding work encouragingly", () => {
    const m = text(panel(page(HS_MID_WAY), "graduation"));
    expect(m).toContain("Core credits");
    expect(m).toContain("9 of 16 credits (official)");
    expect(m).toContain("Elective credits");
    expect(m).toContain("1.5 of 5 credits (official)");
    expect(m).toMatch(/\d+ exams? and \d+ projects? left in your plan/);
    expect(m).not.toMatch(/still outstanding/);
  });
  it("after the diploma: no 'will tell you here', no duplicated 'Issued by the school', distinct dates", () => {
    const g = panel(page(HS_GRADUATED, { initialTab: "graduation" }), "graduation");
    const t = text(g);
    expect(t).not.toContain("will tell you here");
    expect(t.match(/Issued by the school/g)?.length ?? 0).toBeLessThanOrEqual(2); // transcript + diploma, once each
    expect(text(g.slice(g.indexOf('data-testid="diploma-card"')))).toMatch(/Diploma conferred on Oct 10, 2026/);
    expect(t).toContain("Eligibility confirmed on Oct 1, 2026.");
    expect(g.match(/Issued by the school/g)?.length ?? 0).toBeLessThanOrEqual(2);
    // diploma status is said once on this tab (Diploma card); the banner is the other place
    expect(t.match(/Diploma conferred/g)?.length).toBe(1);
    expect(t).not.toContain("Your school conferred your diploma");
    expect(text(g.slice(g.indexOf('data-testid="completion-review"'), g.indexOf('data-testid="transcript-card"')))).not.toMatch(/conferred/i);
    expect(g).not.toContain('data-testid="review-status"');
  });
  it("holds 'Your file': earlier schooling and family live on the Graduation tab", () => {
    const g = panel(page(HS_MID_WAY), "graduation");
    expect(g).toContain('data-testid="your-file"');
    expect(text(g)).toContain("Your file");
    expect(g).toContain('data-testid="prior-education"');
    expect(g).toContain('data-testid="family-card"');
  });
  it("folds the Documents link into the Transcript and Diploma cards (no separate Official files card)", () => {
    const g = panel(page(HS_GRADUATED), "graduation");
    expect(g).toContain('href="/documents"');
    expect(g).not.toContain('data-testid="official-files"');
    const tr = g.slice(g.indexOf('data-testid="transcript-card"'), g.indexOf('data-testid="diploma-card"'));
    const di = g.slice(g.indexOf('data-testid="diploma-card"'), g.indexOf('data-testid="your-file"'));
    expect(tr).toContain('data-testid="link-documents-transcript"');
    expect(di).toContain('data-testid="link-documents-diploma"');
    expect(panel(page(HS_MID_WAY), "graduation")).not.toContain('href="/documents"');
  });
  it("uses one two-column grid and progress badges instead of empty radio-like circles", () => {
    const g = panel(page(HS_MID_WAY), "graduation");
    expect(g).not.toContain("lg:grid-cols-5");
    expect(g).not.toContain("border-dashed border-student-line-strong");
    expect(g).toContain('data-testid="req-core-badge"');
    expect(text(g.slice(g.indexOf('data-testid="req-core-badge"'), g.indexOf('data-testid="req-core-badge"') + 80))).toContain("9 of 16");
    expect(text(g.slice(g.indexOf('data-testid="req-work-badge"'), g.indexOf('data-testid="req-work-badge"') + 80))).toMatch(/\d+ left/);
    expect(text(panel(page(HS_GRADUATED), "graduation"))).toContain("Done");
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
    expect(t).toContain("Nobody on this list can sign in to your account.");
    expect(t.match(/Nobody on this list can sign in/g)?.length).toBe(1);
    expect(t).not.toContain("No portal access");
    expect(t).toContain("discusses grades or billing only with verified guardians who have that permission");
    expect(m.match(/data-testid="no-portal-access"/g)?.length).toBe(1);
  });
  it("links to the existing contacts section instead of duplicating the editor", () => {
    expect(m).toContain('href="/profile#section-contacts"');
    expect(m).not.toContain("<input");
  });
  it("transfer claims are never credit and never use the official badge unless recorded", () => {
    const g = panel(page(HS_MID_WAY), "graduation");
    const t = text(g);
    expect(t).toContain("Courses you took before can sometimes transfer. They count as credit only after your school accepts them.");
    expect(t).toContain("Not sent to the school yet");
    expect(t).toContain("Under review by the school");
    expect(t).toContain("Accepted by the school — credit not recorded yet"); // Chemistry 1
    expect(t).toContain("Transfer credit recorded"); // Spanish 1 appears as a transfer_credit course
    expect(t).toContain("Accepted: 0.5 of 1 credit");
    const claims = [...g.matchAll(/data-testid="claim-row"[\s\S]*?<\/li>/g)].map((m) => m[0]);
    expect(claims).toHaveLength(4);
    for (const c of claims) {
      const official = /data-status="official"/.test(c);
      expect(official).toBe(/Transfer credit recorded/.test(c));
    }
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

describe("S13 student understanding fixes", () => {
  it("a new student sees a worded empty pace state and empty waiting state, not an empty bar", () => {
    const j = text(panel(page(HS_NEW_STUDENT), "journey"));
    const m = panel(page(HS_NEW_STUDENT), "journey");
    expect(m).toContain('data-testid="pace-empty"');
    expect(m).not.toContain('data-testid="target-progress"');
    expect(j).toContain("No official credit yet.");
    expect(j).toContain("Nothing is waiting for a grade. When you mark a task as submitted");
    expect(j).not.toContain("Tasks you marked submitted — your school has not graded them yet.");
  });
  it("after graduation the requirements panel is not titled as a to-do", () => {
    const g = text(panel(page(HS_GRADUATED), "graduation"));
    expect(g).toContain("Your graduation requirements");
    expect(g).not.toContain("What you need to graduate");
    expect(text(panel(page(HS_MID_WAY), "graduation"))).toContain("What you need to graduate");
  });
  it("the journey and subjects tabs link to Documents (evidence) and Support (help)", () => {
    const j = panel(page(HS_MID_WAY), "journey");
    expect(j).toMatch(/data-testid="link-upload-evidence"[^>]*href="\/documents"|href="\/documents"[^>]*data-testid="link-upload-evidence"/);
    expect(j).toMatch(/data-testid="link-ask-help"[^>]*href="\/support"/);
    expect(panel(page(HS_MID_WAY), "subjects")).toMatch(/data-testid="link-upload-evidence"[^>]*href="\/documents"|href="\/documents"[^>]*data-testid="link-upload-evidence"/);
  });
});
