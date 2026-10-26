import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { EVALUATION_FRAMING, buildEvaluationView, buildStudentGraduateProgramView, type CredentialEvaluationRecord, type StudentGraduateView } from "../shared/graduate-program-contract";
import { GraduateEmptyState, GraduateErrorState, GraduatePageView, GraduateSkeleton } from "../client/src/components/graduate/graduate-page-view";
import { buildThenList, buildTrackModel, completeActions, milestoneDisplay, creditAmountLabel, formatDate, isUnconfirmedBasis, validateTopic, visibleCreditLayers } from "../client/src/components/graduate/graduate-presentation";
import { conditionalLabel, studentBasis, waitingHint } from "../client/src/components/graduate/graduate-presentation";
import { JOURNEY_B_STAGES, RULE_SET_2025, journeyA, journeyB } from "./helpers/s12-graduate-fixtures";

(globalThis as any).React = React;

const html = (el: React.ReactElement) =>
  renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(Router, { ssrPath: "/graduate" }, el)));
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const count = (m: string, needle: string) => m.split(needle).length - 1;
type Bundle = Parameters<typeof buildStudentGraduateProgramView>[0];
const viewOf = (bundles: Bundle[], evaluations: StudentGraduateView["evaluations"] = []): StudentGraduateView => ({ programs: bundles.map(buildStudentGraduateProgramView), evaluations });
const render = (...bundles: Bundle[]) => renderWith([], ...bundles);
const renderWith = (evaluations: StudentGraduateView["evaluations"], ...bundles: Bundle[]) => {
  const markup = html(React.createElement(GraduatePageView, { view: viewOf(bundles, evaluations) }));
  return { markup, t: text(markup) };
};

describe("S12 student graduate: Journey A (ENEB-only)", () => {
  const { markup, t } = render(journeyA());

  it("shows the ENEB qualification confirmed and 18 of 18 ENEB subjects", () => {
    expect(t).toContain("ENEB qualification confirmed");
    expect(t).toContain("18 of 18 ENEB subjects passed.");
    expect(markup).toContain('data-testid="track-eneb"');
  });

  it("has no university track, registration, recognition, thesis or conferral content", () => {
    expect(markup).not.toContain('data-testid="track-university"');
    for (const w of [/registration/i, /matricola/i, /recognition/i, /recognized/i, /conferr/i, /university track/i, /graduation/i, /thesis/i, /unimarconi/i]) {
      expect(t).not.toMatch(w);
    }
    expect(markup).not.toContain('data-testid="graduate-graduation"');
    expect(markup).not.toContain('data-testid="graduate-learning"');
    expect(markup).not.toContain('data-testid="graduate-thesis"');
    expect(t).toContain("This programme does not lead to a university degree.");
  });

  it("shows only the ENEB credit layer and never 60/60", () => {
    expect(count(markup, 'data-testid="credit-layer"')).toBe(1);
    expect(t).toContain("ECTS stated by ENEB");
    expect(t).not.toContain("60/60");
    expect(t).not.toMatch(/\d+\s*%/);
  });

  it("has exactly one h1 and passed modules have no progress control", () => {
    expect(count(markup, "<h1")).toBe(1);
    expect(markup).not.toContain('data-testid="progress-control"');
    expect(count(markup, 'data-testid="module-row"')).toBe(18);
    expect(markup).toContain('data-testid="passed-eneb-summary"');
  });
});

describe("S12 student graduate: Journey B stages", () => {
  it("eligibility: pending documents, Not known yet for recognized credits, not 0", () => {
    const { markup, t } = render(journeyB("eligibility"));
    expect(markup).toContain('data-testid="pending-documents"');
    expect(markup).toContain('href="/documents"');
    expect(t).toContain("Bachelor's degree documents");
    const recognized = markup.split('data-testid="credit-layer"').find((c) => c.includes("Recognized by the university"))!;
    expect(text(recognized)).toContain("Not known yet");
    expect(text(recognized)).not.toMatch(/\b0 (ECTS|CFU|credits)/);
    expect(t).toContain("The university-approved module list is still being confirmed");
    expect(t).not.toContain("60/60");
    expect(t).not.toMatch(/Matricola/);
  });

  it("partial_recognition: partial decision with conditions, not-recognized item, requested vs recognized apart", () => {
    const { markup, t } = render(journeyB("partial_recognition"));
    expect(t).toContain("Partly recognized");
    expect(t).toContain("Recognized with conditions");
    expect(t).toContain("Condition: Valid only if the Research Methods exam is passed.");
    expect(t).toContain("Marketing Management");
    expect(t).toContain("Not recognized");
    expect(t).toContain("Credits requested for recognition");
    expect(t).toContain("Recognized by the university");
    const requested = markup.split('data-testid="credit-layer"').find((c) => c.includes("Credits requested"))!;
    const recognized = markup.split('data-testid="credit-layer"').find((c) => c.includes("Recognized by the university"))!;
    expect(text(requested)).toContain("32 ECTS");
    expect(text(recognized)).toContain("24 ECTS"); // 18 + 6, the not-recognized item is excluded by the contract
    expect(count(markup, 'data-testid="request-steps"')).toBe(1);
    expect(t).toContain("Only what the university's decision lists counts toward the university degree.");
  });

  it("thesis_submitted: submitted but not passed", () => {
    const { markup, t } = render(journeyB("thesis_submitted"));
    expect(markup).toContain('data-testid="thesis-submitted"');
    expect(t).toContain("Submitted, not graded yet");
    expect(t).toContain("Submitted is not passed");
    expect(markup).not.toContain('data-testid="thesis-result"');
    expect(t).not.toContain("Result: Passed");
  });

  it("procedure_done: academic work finished, degree NOT conferred", () => {
    const { markup, t } = render(journeyB("procedure_done"));
    expect(t).toContain("Academic work finished");
    expect(t).toContain("Degree not yet conferred");
    expect(t).not.toMatch(/Degree conferred on/);
    expect(markup).toContain('data-testid="work-vs-degree"');
    const conferral = markup.split('data-testid="milestone"').find((c) => c.includes('data-key="conferral"'))!;
    expect(conferral).not.toContain("official-marker");
    expect(conferral).toContain('data-state="waiting"');
  });

  it("conferred: shows the conferral date 18 Oct 2026, not the ceremony date as the degree date", () => {
    const { markup, t } = render(journeyB("conferred"));
    expect(t).toContain("Degree conferred on 18 Oct 2026");
    const conferral = markup.split('data-testid="milestone"').find((c) => c.includes('data-key="conferral"'))!;
    expect(conferral).toContain('dateTime="2026-10-18"');
    expect(conferral).not.toContain("2026-10-15");
    expect(text(conferral)).toContain("Confirmed from university document");
    const procedure = markup.split('data-testid="milestone"').find((c) => c.includes('data-key="procedure"'))!;
    expect(text(procedure)).toContain("Ceremony 15 Oct 2026");
    expect(procedure).not.toContain("Confirmed from university document");
  });

  it("complete: all 8 milestones done", () => {
    const { markup } = render(journeyB("complete"));
    expect(count(markup, 'data-testid="milestone"')).toBe(8);
    expect(count(markup, 'data-state="done"')).toBe(8);
    expect(count(markup, 'data-official="true"')).toBe(5); // thesis result + conferral, transcript, diploma, verification
  });

  it("official marker only where official is true, at every stage", () => {
    for (const stage of JOURNEY_B_STAGES) {
      const { markup } = render(journeyB(stage));
      expect(count(markup, 'data-testid="official-marker"')).toBe(count(markup, 'data-official="true"'));
    }
  });

  it("never renders 60/60 for a student with only ENEB subjects done, and never sums credit layers", () => {
    for (const stage of JOURNEY_B_STAGES.slice(0, 5)) {
      const { t } = render(journeyB(stage));
      expect(t).not.toContain("60/60");
      expect(t).not.toMatch(/\b60 of 60\b/);
    }
  });

  it("registered stage shows the matricola only when verified", () => {
    expect(render(journeyB("admitted")).t).not.toContain("SYN000123");
    expect(render(journeyB("registered")).t).toContain("Matricola SYN000123");
  });

  it("assessments stage: progress controls absent for passed modules, present for the rest", () => {
    const early = render(journeyB("partial_recognition"));
    expect(count(early.markup, 'data-testid="progress-control"')).toBe(11 - 8); // 3 university subjects; 8 ENEB subjects passed
    const done = render(journeyB("assessments"));
    expect(done.markup).not.toContain('data-testid="progress-control"');
    expect(done.t).toContain("Reassessed");
  });

  it("header: one h1, the one next step, university relationship sentence", () => {
    const { markup, t } = render(journeyB("registered"));
    expect(count(markup, "<h1")).toBe(1);
    expect(count(markup, 'data-testid="graduate-next-step"')).toBe(1);
    expect(t).toContain("Università degli Studi Guglielmo Marconi");
    expect(markup).toContain('data-testid="track-university"');
  });
});

describe("S12 student graduate: cohort rule sets", () => {
  it("2025 and 2026 cohorts render different assessment text; 2025 never shows the 12,000-word rule", () => {
    const a = render(journeyB("thesis_submitted", { ruleSet: RULE_SET_2025 }));
    const b = render(journeyB("thesis_submitted"));
    const assess = (m: string) => text(m.slice(m.indexOf('data-testid="graduate-assessment"'), m.indexOf('data-testid="graduate-graduation"')));
    expect(assess(a.markup)).toContain("Comprehensive final exam");
    expect(assess(a.markup)).toContain("roughly 135 questions");
    expect(assess(b.markup)).toContain("An exam for each subject");
    expect(count(assess(b.markup), "An exam for each subject")).toBe(1);
    expect(assess(a.markup)).not.toEqual(assess(b.markup));
    expect(a.t).not.toContain("12,000");
    expect(b.t).toContain("12,000 words");
    expect(b.t).toContain("Term in the enrollment contract");
    expect(b.t).toContain("6/10");
  });

  it("labels testimony-based rules as not confirmed by the university; contract terms are not so labelled", () => {
    expect(render(journeyB("registered", { ruleSet: RULE_SET_2025 })).markup).toContain('data-testid="assessment-unconfirmed"');
    expect(render(journeyB("registered")).markup).not.toContain('data-testid="assessment-unconfirmed"');
  });
});

describe("S12 student graduate: thesis plan editing", () => {
  it("locks the topic once approved but keeps milestones tickable until the thesis is graded", () => {
    const open = render(journeyB("partial_recognition"));
    expect(open.markup).toContain('data-testid="thesis-edit-topic"');
    expect(open.markup).toMatch(/<input[^>]*type="checkbox"/);
    const approved = render(journeyB("assessments"));
    expect(approved.markup).not.toContain('data-testid="thesis-edit-topic"');
    expect(approved.markup).toContain('data-testid="topic-locked"');
    expect(approved.markup).toMatch(/<input[^>]*type="checkbox"/);
    expect(approved.t).toContain("Topic approved");
    const graded = render(journeyB("thesis_passed"));
    expect(graded.markup).not.toMatch(/<input[^>]*type="checkbox"/);
  });
  it("validates the topic locally", () => {
    expect(validateTopic("abc")).toMatch(/at least 5/);
    expect(validateTopic("A real topic")).toBeNull();
    expect(validateTopic("x".repeat(301))).toMatch(/300/);
  });
});

describe("S12 student graduate: multiple programmes, states, helpers", () => {
  it("shows a switcher only with more than one programme", () => {
    expect(render(journeyA()).markup).not.toContain('data-testid="program-switcher"');
    const multi = render(journeyB("registered"), journeyA());
    expect(multi.markup).toContain('data-testid="program-switcher"');
    expect(count(multi.markup, 'role="tab"')).toBe(2);
    expect(count(multi.markup, "<h1")).toBe(1);
  });

  it("empty, loading and error states have one h1 or a status and a Support link / retry", () => {
    const empty = html(React.createElement(GraduatePageView, { view: { programs: [], evaluations: [] } }));
    expect(empty).toContain("No graduate programme on record");
    expect(empty).toContain('href="/support"');
    expect(count(html(React.createElement(GraduateEmptyState)), "<h1")).toBe(1);
    expect(html(React.createElement(GraduateSkeleton))).toContain('aria-busy="true"');
    const err = html(React.createElement(GraduateErrorState, { onRetry: () => undefined }));
    expect(err).toContain('data-testid="button-retry-graduate"');
    expect(count(err, "<h1")).toBe(1);
  });

  it("links to Documents, Profile and Support", () => {
    const { markup } = render(journeyB("registered"));
    expect(markup).toContain('href="/documents"');
    expect(markup).toContain('href="/profile"');
    expect(markup).toContain('href="/support"');
  });

  it("helpers: dates, credits, bases, tracks", () => {
    expect(formatDate("2026-10-18")).toBe("18 Oct 2026");
    expect(formatDate(null)).toBeNull();
    const eligibility = buildStudentGraduateProgramView(journeyB("eligibility"));
    const rec = eligibility.credits.find((c) => c.authority === "university_recognized")!;
    expect(creditAmountLabel(rec)).toBe("Not known yet");
    expect(visibleCreditLayers(buildStudentGraduateProgramView(journeyA())).map((c) => c.authority)).toEqual(["eneb_stated"]);
    expect(isUnconfirmedBasis("Reported by an earlier participant, not confirmed · x")).toBe(true);
    expect(isUnconfirmedBasis("Term in the enrollment contract · x")).toBe(false);
    expect(buildTrackModel(buildStudentGraduateProgramView(journeyA())).university).toBeNull();
    const nodes = buildTrackModel(buildStudentGraduateProgramView(journeyB("conferred"))).university!;
    expect(nodes.find((n) => n.key === "uni-conferral")!.status).toBe("official");
    expect(nodes.find((n) => n.key === "uni-documents")!.status).toBe("progress") // diploma ordered;
  });
});

const ev = (o: Partial<CredentialEvaluationRecord>): CredentialEvaluationRecord => ({
  id: "ev1", studentId: "s1", programId: null, evaluator: "wes_us", evaluatorName: null, destinationCountry: "US",
  qualificationEvaluated: "Synthetic Master universitario di primo livello", awardingInstitution: "unimarconi",
  intendedUse: "further_study", evaluationType: "completed_report", status: "completed", reportDate: "2026-10-20",
  reportReference: null, documentId: null, conclusion: "masters_equivalent", conclusionText: "Equivalent to a U.S. master's degree (synthetic).",
  verificationStatus: "verified", conflictingEvidence: null, reviewerUserId: null, reviewedAt: null, note: null, createdBy: null, createdAt: "2026-10-20", updatedAt: "2026-10-20", ...o,
} as CredentialEvaluationRecord);

describe("S12 student graduate: review fixes", () => {
  it("unverified passes are not shown as verified", () => {
    const { markup, t } = render(journeyB("complete"));
    const summary = markup.slice(markup.indexOf('data-testid="passed-eneb-summary"'));
    expect(text(summary.slice(0, 600))).toContain("8 of 8 passed");
    expect(text(summary.slice(0, 900))).toContain("stated by ENEB, not yet checked");
    expect(t).toContain("Progress on your requirements");
    expect(t).not.toContain("Progress within verified requirements");
    expect(markup).toContain('data-testid="progress-legend"');
    expect(markup).toContain('data-segment="stated"');
    const eneb = markup.split('data-testid="progress-bar"').find((c) => c.includes("ENEB subjects passed"))!;
    expect(text(eneb)).toContain("0 checked");
    expect(text(eneb)).toContain("8 stated, not yet checked");
    // ENEB subjects node must not use the "applied" (verified) status
    const nodes = buildTrackModel(buildStudentGraduateProgramView(journeyB("complete"))).eneb;
    expect(nodes[0].status).toBe("provider");
    expect(nodes[0].glyph).toBe("stated");
  });

  it("ENEB passed subjects are collapsed by default with an accessible disclosure", () => {
    const { markup } = render(journeyB("complete"));
    const i = markup.indexOf('data-testid="passed-eneb-summary"');
    const chunk = markup.slice(i, i + 1500);
    expect(chunk).toContain('aria-expanded="false"');
    expect(chunk).toMatch(/aria-controls="[^"]+"/);
    expect(chunk).toMatch(/<div id="[^"]+" hidden/);
  });

  it("conferred header chip states the outcome with 18 Oct 2026 and does not lead with registration", () => {
    const { markup, t } = render(journeyB("conferred"));
    const chip = markup.slice(markup.indexOf('data-testid="degree-conferred-chip"'));
    expect(text(chip.slice(0, 1500))).toContain("University degree conferred · 18 Oct 2026");
    expect(t).not.toContain("Registered with the university");
    expect(markup.indexOf('data-testid="degree-conferred-chip"')).toBeLessThan(markup.indexOf('data-testid="graduate-relationship"'));
    expect(render(journeyB("registered")).markup).not.toContain('data-testid="degree-conferred-chip"');
  });

  it("b-complete: ENEB record is presented as separate, not as a blocker", () => {
    const { markup, t } = render(journeyB("complete"));
    expect(t).toContain("Your university degree is complete");
    expect(markup).toContain('data-testid="eneb-record"');
    expect(t).toContain("Separate ENEB record:");
    expect(t).toContain("It does not hold up your university degree.");
  });

  it("Recognition node names the outcome", () => {
    const model = buildTrackModel(buildStudentGraduateProgramView(journeyB("partial_recognition")));
    expect(model.university!.find((n) => n.key === "uni-recognition")!.stateLabel).toBe("Partly recognized");
    const { markup } = render(journeyB("partial_recognition"));
    expect(text(markup.slice(markup.indexOf('data-testid="track-university"'), markup.indexOf('data-testid="graduate-section-nav"')))).toContain("Partly recognized");
  });

  it("recognized credits show the conditional part and link to Previous learning", () => {
    const { markup, t } = render(journeyB("partial_recognition"));
    expect(t).toContain("24 ECTS · 6 conditional");
    expect(markup).toContain('data-testid="credit-conditions-link"');
    expect(markup).toContain('href="#graduate-learning"');
    const view = buildStudentGraduateProgramView(journeyB("partial_recognition"));
    expect(conditionalLabel(view.credits.find((c) => c.authority === "university_recognized")!)).toBe("6 conditional");
  });

  it("no internal provenance reaches the student", () => {
    for (const stage of JOURNEY_B_STAGES) {
      for (const opts of [{}, { ruleSet: RULE_SET_2025 }]) {
        const { t } = render(journeyB(stage, opts));
        expect(t).not.toMatch(/owner's research audit/i);
        expect(t).not.toMatch(/as summarized in/i);
      }
    }
    expect(studentBasis("Term in the enrollment contract · ENEB Terms, August 2026 (as summarized in the owner's research audit)")).toBe("Term in the enrollment contract · ENEB Terms, August 2026");
    expect(studentBasis("Not yet verified · Plain title")).toBe("Not yet verified · Plain title");
  });

  it("later milestones read After conferral, neutral and dashed", () => {
    const { markup, t } = render(journeyB("procedure_done"));
    const early = render(journeyB("registered")).t;
    const later = markup.split('data-testid="milestone"').filter((c) => c.includes('data-state="later"'));
    expect(later.length).toBeGreaterThan(0);
    for (const c of later) {
      expect(text(c)).toContain("After conferral");
      expect(c).toContain('data-status="notstarted"');
      expect(c).not.toContain("Waiting for the university");
    }
    expect(early).toContain("Counting from your university registration");
    expect(t).not.toContain("Waiting for the university conferral");
  });

  it("no check icon on unknown or unchecked states; only completed recognition steps are ticked", () => {
    const eligibility = render(journeyB("eligibility"));
    const rec = eligibility.markup.split('data-testid="credit-layer"').find((c) => c.includes("Recognized by the university"))!;
    expect(rec).toContain("lucide-circle-help");
    expect(rec).not.toContain("lucide-check");
    const row = render(journeyB("complete")).markup.split('data-testid="module-row"').find((c) => c.includes('data-result="passed"'))!;
    const pill = row.slice(row.indexOf('data-testid="module-result"') - 300, row.indexOf('data-testid="module-result"') + 700);
    expect(pill).toContain("lucide-circle");
    expect(pill).not.toContain("lucide-clipboard-check");
    // not_requested: no tick at all, nothing marked current
    const steps = (m: string) => m.slice(m.indexOf('data-testid="request-steps"'), m.indexOf('data-testid="request-state-label"'));
    const none = steps(eligibility.markup);
    expect(none).not.toContain("lucide-check");
    expect(none).not.toContain("aria-current");
    const mid = steps(render(journeyB("recognition_requested")).markup);
    expect(mid).toContain("aria-current");
    const decided = steps(render(journeyB("partial_recognition")).markup);
    expect((decided.match(/lucide-check/g) ?? []).length).toBe(3);
  });

  it("repeats the MY MASTER'S eyebrow only once", () => {
    const { t } = render(journeyB("complete"));
    expect((t.match(/My Master's/g) ?? []).filter(() => true).length).toBeGreaterThan(0);
    const { markup } = render(journeyB("complete"));
    expect(count(markup, "uppercase tracking-[0.16em]")).toBe(2); // header eyebrow + "Your next step"
  });

  it("waiting steps give a what-you-can-do-now hint; done steps do not", () => {
    expect(render(journeyB("admitted")).markup).toContain('data-testid="next-step-hint"');
    expect(render(journeyB("complete")).markup).not.toContain('data-testid="next-step-hint"');
    expect(waitingHint({ title: "Your university degree is complete", detail: "", href: null })).toBeNull();
  });
});

describe("S12 student graduate: international recognition", () => {
  const prelim = buildEvaluationView(ev({ id: "p1", evaluationType: "preliminary_tool", status: "completed", verificationStatus: "unverified", conclusion: "masters_equivalent", conclusionText: "Tool says: master's equivalent (synthetic).", reportDate: null }));
  const wesUs = buildEvaluationView(ev({ id: "w1" }));
  const wesCa = buildEvaluationView(ev({ id: "w2", evaluator: "wes_canada", destinationCountry: "CA", conclusion: "bachelors_equivalent", conclusionText: "Bachelor's-level (synthetic).", intendedUse: "immigration" }));

  it("shows framing once, with preliminary vs verified treatments", () => {
    const { markup, t } = renderWith([prelim, wesUs], journeyB("complete"));
    expect(markup).toContain('id="graduate-evaluations"');
    expect(count(t, EVALUATION_FRAMING)).toBe(1);
    const cards = markup.split('data-testid="evaluation"').slice(1);
    const p = cards.find((c) => c.includes('data-kind="preliminary"'))!;
    const v = cards.find((c) => c.includes('data-kind="confirmed"'))!;
    expect(text(p)).toContain("Preliminary — not an evaluation report");
    expect(text(p)).not.toContain("Verified evaluation report");
    expect(text(v)).toContain("Verified evaluation report");
    expect(text(v)).toContain("20 Oct 2026");
    expect(text(v)).toContain("“Equivalent to a U.S. master's degree (synthetic).”");
    expect(text(v)).toContain("only"); // caveat is scoped to evaluator, country and purpose
    expect(count(markup, 'data-kind="confirmed"')).toBe(1);
    expect(t).not.toMatch(/guarantee/i);
  });

  it("renders WES U.S. and WES Canada as distinct evaluators", () => {
    const { t, markup } = renderWith([wesUs, wesCa], journeyB("complete"));
    expect(t).toContain("WES (United States)");
    expect(t).toContain("WES Canada");
    expect(text(markup.split('data-testid="evaluation"').find((c) => c.includes("WES Canada"))!)).toContain("Canada");
    expect(text(markup.split('data-testid="evaluation"').find((c) => c.includes("WES Canada"))!)).toContain("Bachelor's-level equivalent");
  });

  it("university route with none: calm empty state linking to Support; ENEB-only with none: no section", () => {
    const uni = render(journeyB("complete"));
    expect(uni.markup).toContain('data-testid="evaluations-empty"');
    expect(uni.markup).toContain('data-testid="evaluations-support-link"');
    expect(uni.t).toContain("Results differ by evaluator and country");
    const only = render(journeyA());
    expect(only.markup).not.toContain('id="graduate-evaluations"');
    expect(only.t).not.toContain("International recognition");
    expect(renderWith([wesUs], journeyA()).markup).toContain('id="graduate-evaluations"');
  });

  it("sits after Graduation and before Credits; missing evaluations default to none", () => {
    const { markup } = render(journeyB("complete"));
    const i = (id: string) => markup.indexOf(`id="${id}"`);
    expect(i("graduate-graduation")).toBeLessThan(i("graduate-evaluations"));
    expect(i("graduate-evaluations")).toBeLessThan(i("graduate-credits"));
    const legacy = html(React.createElement(GraduatePageView, { view: { programs: [buildStudentGraduateProgramView(journeyB("complete"))] } as unknown as StudentGraduateView }));
    expect(legacy).toContain('data-testid="evaluations-empty"');
  });
});

describe("S12 student graduate: polish round (next-step Then list, chips, collapsing)", () => {
  const wesCaRequested = buildEvaluationView(ev({ id: "w3", evaluator: "wes_canada", destinationCountry: "CA", evaluationType: "completed_report", status: "requested", reportDate: null, conclusion: null, conclusionText: null, verificationStatus: "unverified", intendedUse: "immigration" }));

  it("next step shows a Then list of upcoming items that excludes the current step", () => {
    for (const stage of ["eligibility", "registered", "partial_recognition", "thesis_submitted", "procedure_done", "conferred"] as const) {
      const program = buildStudentGraduateProgramView(journeyB(stage));
      const then = buildThenList(program);
      expect(then.length).toBeLessThanOrEqual(3);
      for (const item of then) expect(item.label.toLowerCase()).not.toBe(program.nextStep.title.toLowerCase());
    }
    const early = render(journeyB("partial_recognition"));
    const card = early.markup.slice(early.markup.indexOf('data-testid="graduate-next-step"'), early.markup.indexOf('data-testid="graduate-progress"'));
    expect(card).toContain('data-testid="next-then"');
    expect(count(card, 'data-testid="then-item"')).toBeGreaterThanOrEqual(2);
    expect(text(card)).toContain("Continue Advanced Data Governance");
    expect(text(card.slice(card.indexOf('data-testid="next-then"')))).not.toContain("Continue Advanced Data Governance");
  });

  it("complete state offers verification-letter and international-evaluation actions, no Then list", () => {
    const { markup } = render(journeyB("complete"));
    expect(markup).toContain('data-testid="complete-actions"');
    expect(markup).not.toContain('data-testid="next-then"');
    expect(markup).toContain('data-testid="complete-action-verification-letter"');
    expect(markup).toContain('data-testid="complete-action-international-evaluation"');
    expect(text(markup)).toContain("Ask Support for a verification letter");
    expect(text(markup)).toContain("Ask about an international evaluation");
    expect(completeActions(buildStudentGraduateProgramView(journeyB("registered")), 0)).toEqual([]);
  });

  it("does not repeat the Documents CTA when the next step already goes there", () => {
    const { markup } = render(journeyB("eligibility"));
    expect(count(markup, 'href="/documents"')).toBe(2); // next-step button + the page-end help links
    expect(markup).not.toContain('data-testid="pending-documents-link"');
    expect(markup).toContain('data-testid="pending-documents"');
  });

  it("Not recognized is a solid decision chip, never the dashed pending style", () => {
    const { markup } = render(journeyB("partial_recognition"));
    const row = markup.split('data-testid="decision-item"').slice(1).find((c) => c.includes("Marketing Management"))!;
    const el = row.slice(row.lastIndexOf("<span", row.indexOf('data-testid="decision-item-outcome"')), row.indexOf("</span>", row.indexOf('data-testid="decision-item-outcome"')));
    expect(text(el)).toContain("Not recognized");
    expect(el).not.toContain("border-dashed");
    expect(el).toContain('data-status="decision"');
  });

  it("milestone wording: Not graded yet, After your academic work, After conferral, Ordered not issued", () => {
    const early = render(journeyB("registered"));
    const ms = (m: string, key: string) => text(m.split('data-testid="milestone"').find((c) => c.includes(`data-key="${key}"`))!);
    expect(ms(early.markup, "thesis")).toContain("Not graded yet");
    expect(ms(early.markup, "conferral")).toContain("After your academic work");
    expect(ms(early.markup, "conferral")).not.toContain("After conferral");
    expect(ms(early.markup, "transcript")).toContain("After conferral");
    expect(ms(early.markup, "diploma")).toContain("After conferral");
    expect(ms(early.markup, "verification")).toContain("After conferral");
    const conferred = render(journeyB("conferred"));
    expect(ms(conferred.markup, "diploma")).toContain("Ordered, not issued");
    expect(milestoneDisplay({ state: "in_progress", official: false, key: "diploma", detail: "Ordered. An order is not an issued diploma." }).label).toBe("Ordered, not issued");
  });

  it("an empty university subjects bar reads Not started, not a zero bar", () => {
    const { markup } = render(journeyB("eligibility"));
    const bar = markup.split('data-testid="progress-bar"').find((c) => c.includes("University subjects passed"))!;
    expect(text(bar.slice(0, 400))).toContain("Not started");
    expect(bar.slice(0, 400)).not.toContain('data-segment');
    expect(text(bar.slice(0, 300))).not.toContain("0 of 3");
  });

  it("confirmed milestones show 'Confirmed from university document' exactly once, with no extra Confirmed chip", () => {
    const { markup } = render(journeyB("complete"));
    const items = markup.split('data-testid="milestone"').filter((c) => c.includes('data-official="true"') && c.includes('data-state="done"'));
    expect(items.length).toBe(5);
    for (const c of items) {
      const t = text(c);
      expect(count(t, "Confirmed from university document")).toBe(1);
      expect(count(c, "data-status=")).toBe(1); // a single chip, no second "Confirmed" pill
    }
  });

  it("header has a single merged ENEB chip and a legend appears once on the two-track card", () => {
    const { markup } = render(journeyB("complete"));
    expect(count(markup, 'data-testid="eneb-qualification"')).toBe(1);
    expect(markup).not.toContain('data-testid="eneb-status"');
    expect(text(markup.slice(markup.indexOf('data-testid="eneb-qualification"'), markup.indexOf('data-testid="eneb-qualification"') + 500))).toContain("ENEB status:");
    expect(count(markup, 'data-testid="track-legend"')).toBe(1);
    expect(markup.indexOf('data-testid="track-legend"')).toBeGreaterThan(markup.indexOf('data-testid="two-track"'));
  });

  it("b-complete collapses finished sections behind disclosures; Graduation, International recognition and Credits stay open", () => {
    const { markup, t } = render(journeyB("complete"));
    for (const id of ["graduate-modules", "graduate-learning", "graduate-thesis", "graduate-assessment"]) {
      const sec = markup.slice(markup.indexOf(`data-testid="${id}"`));
      expect(sec.slice(0, 200)).toContain('data-collapsed="true"');
      const btn = sec.slice(sec.indexOf("<button"), sec.indexOf("<button") + 250);
      expect(btn).toContain('aria-expanded="false"');
      expect(btn).toMatch(/aria-controls="[^"]+"/);
    }
    expect(t).toContain("11 of 11 subjects passed");
    for (const id of ["graduate-graduation", "graduate-evaluations", "graduate-credits"]) {
      const sec = markup.slice(markup.indexOf(`data-testid="${id}"`), markup.indexOf(`data-testid="${id}"`) + 300);
      expect(sec).not.toContain("data-collapsed");
    }
    // unfinished journeys stay fully open
    expect(render(journeyB("thesis_submitted")).markup).not.toContain("data-collapsed");
  });

  it("a requested WES Canada report is labelled as requested, not issued", () => {
    const { t } = renderWith([wesCaRequested], journeyB("complete"));
    expect(t).toContain("Official evaluation report (requested, not yet issued)");
    expect(t).toContain("WES Canada");
    expect(t).toContain("Canada");
  });
});
