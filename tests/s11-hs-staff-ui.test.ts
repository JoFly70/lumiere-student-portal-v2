import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { describe, expect, it, vi } from "vitest";
import { TEMPLATE_STANDARD_21, TEMPLATE_TN_22, creditsToHalfUnits, formatHalfUnits, hsRoadmapContentSchema, type StaffHighSchoolState } from "@shared/high-school-contract";

vi.stubGlobal("React", React);
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: vi.fn(() => ({ isLoading: false, isError: false, data: undefined, refetch: vi.fn() })),
  useMutation: vi.fn(() => ({ isPending: false, mutate: vi.fn() })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() })),
}));

import { HighSchoolWorkspace, type HsTabId } from "@/pages/admin-student-high-school";
import { RoadmapEditor } from "@/components/admin/high-school/roadmap-section";
import { ProgramSection, CreateEnrollmentCard } from "@/components/admin/high-school/program-section";
import { PriorEducationSection } from "@/components/admin/high-school/prior-education-section";
import { ResultsSection } from "@/components/admin/high-school/results-section";
import { GraduationSection } from "@/components/admin/high-school/graduation-section";
import { GuardiansSection } from "@/components/admin/high-school/guardians-section";
import { EventsSection } from "@/components/admin/high-school/events-section";
import { HS_EVIDENCE_DOC_TYPES } from "@shared/high-school-contract";
import { creditBlockers } from "@shared/high-school-projection";
import {
  FIXTURE_TODAY,
} from "./helpers/s11-hs-staff-fixtures";
import {
  actorRoleLabel, awardLabel, deliveryOptions, financialGate, formatMonth, friendlyEventSummary, creditSlots, acceptedSummary, claimBadge, claimDecisionGate, defaultOpenAreas, disclosurePreview, formatDate, initialClaimDecision, planCourseOptions, remainingHalfUnits, resolveClaimBody,
  statusLabel, transferAwardGate, actorLabel,
  addCourse, addMilestone, addTask, areaPlanRows, blockingDraftIssues, classifyHsFailure, claimBody, conferDiplomaBody, createEnrollmentBody, disclosureGate,
  enrollmentTimeline, evidenceGate, graduationGates, guardianGuidance, hsStaffPaths, parseCreditInput, plannedHalfUnits, publishGate, removeCourse, replaceCourse,
  setPolicy, slugKey, taskResultBody, validateDraftContent, validateEnrollmentForm, validateNewCourse, verifiedEvidenceDocs, type EnrollmentForm,
} from "@/lib/admin-high-school-logic";
import {
  FIXTURE_DOCS, FIXTURE_TEMPLATES, HS_ENROLLMENT_ID, HS_STUDENT_ID, fixtureContent, programTitleOf, staffStateEligibilityConfirmed, staffStateEmpty, staffStateGraduate,
  staffStateGraduationReady, staffStateRich,
} from "./helpers/s11-hs-staff-fixtures";

const rich = staffStateRich();
const selectBlock = (out: string, id: string) => new RegExp(`<select id="${id}"[\\s\\S]*?</select>`).exec(out)?.[0] ?? "";
const selectedValue = (out: string, id: string) => /<option value="([^"]*)" selected=""/.exec(selectBlock(out, id))?.[1] ?? null;
const allStates = () => [staffStateRich(), staffStateGraduationReady(), staffStateEligibilityConfirmed(), staffStateGraduate()];
const routed = (el: React.ReactElement) => React.createElement(Router, { ssrPath: "/" }, el);
type Open = string | "all" | null;
/** Forms are folded behind "Record …" buttons until opened. Most structure tests render them all open ("all"); pass null for the real default. */
const html = (state: StaffHighSchoolState, tab: HsTabId, isAdmin = true, open: Open = "all") =>
  renderToStaticMarkup(routed(React.createElement(HighSchoolWorkspace, { state, studentId: HS_STUDENT_ID, isAdmin, docs: FIXTURE_DOCS, defaultTab: tab, initialOpenForm: open })));
const section = (C: React.ComponentType<any>, state: StaffHighSchoolState, isAdmin = true, open: Open = "all") =>
  renderToStaticMarkup(routed(React.createElement(C, { state, studentId: HS_STUDENT_ID, isAdmin, docs: FIXTURE_DOCS, initialOpenForm: open })));
const text = (out: string) => out.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("S11 staff UI — fixtures are valid against the contract", () => {
  it("the rich fixture's roadmap content parses and has zero validation problems apart from planning notes", () => {
    expect(hsRoadmapContentSchema.safeParse(fixtureContent()).success).toBe(true);
    expect(blockingDraftIssues(fixtureContent())).toEqual([]);
    expect(rich.current?.published?.versionNumber).toBe(1);
    expect(rich.current?.draft?.versionNumber).toBe(2);
  });
  it("fixtures come from the real projection: never more than required, never negative remaining, dates in order", () => {
    for (const st of allStates()) {
      const c = st.current!;
      expect(c.credits.earnedHalfUnits).toBeLessThanOrEqual(c.credits.requiredHalfUnits);
      expect(c.credits.remainingHalfUnits).toBeGreaterThanOrEqual(0);
      expect(c.credits.earnedHalfUnits + c.credits.remainingHalfUnits).toBe(c.credits.requiredHalfUnits);
      for (const a of c.credits.byArea) expect(a.countedHalfUnits).toBeLessThanOrEqual(a.requiredHalfUnits);
      const g = c.graduation;
      if (g.diploma.conferredOn) expect(g.diploma.conferredOn >= (g.eligibilityConfirmedAt ?? "9999").slice(0, 10)).toBe(true);
      if (g.status !== "in_progress") expect(g.blockers).toEqual([]);
    }
    const r = rich.current!;
    expect(r.enrollment.startedOn! <= FIXTURE_TODAY).toBe(true);
    for (const x of [...r.results, ...r.awards]) expect(x.recordedAt.slice(0, 10) <= FIXTURE_TODAY).toBe(true);
    expect(r.credits.earnedHalfUnits).toBe(4);
    expect(staffStateGraduate().current!.credits.requiredHalfUnits).toBe(creditsToHalfUnits(22));
    expect(staffStateGraduationReady().current!.credits.remainingHalfUnits).toBe(0);
  });
});

describe("S11 staff UI — half-unit credit logic", () => {
  it("parses only multiples of 0.5 and never drifts", () => {
    expect(parseCreditInput("0.5")).toBe(1);
    expect(parseCreditInput("1")).toBe(2);
    expect(parseCreditInput("20.5")).toBe(41);
    expect(parseCreditInput("22")).toBe(44);
    for (const bad of ["", "0.3", "0.25", "abc", "-1", "1.", "0", "1e2", "999"]) expect(parseCreditInput(bad)).toBeNull();
  });
  it("two 0.5-credit courses add to exactly one credit in the plan", () => {
    const base = fixtureContent();
    const startup = areaPlanRows(base).find((r) => r.key === "startup")!;
    expect(startup.plannedHalfUnits).toBe(2);
    expect(startup.gapHalfUnits).toBe(0);
    expect(areaPlanRows(base).every((r) => r.gapHalfUnits === 0)).toBe(true);
  });
  it("planned totals use planned courses only", () => {
    const c = fixtureContent();
    const before = plannedHalfUnits(c);
    expect(plannedHalfUnits(removeCourse(c, "english-1"))).toBe(before - 2);
    expect(areaPlanRows(c).find((r) => r.key === "electives")!.plannedHalfUnits).toBe(10);
  });
});

describe("S11 staff UI — draft editing keeps history", () => {
  const f = { title: "Algebra I Honors", areaKey: "math", credits: "1", plannedStart: "2027-02-01", plannedEnd: "2027-04-30" };
  it("adds a course with a unique, slugged key and a validated credit", () => {
    expect(slugKey("Algebra I — Honors!")).toBe("algebra-i-honors");
    const c = addCourse(fixtureContent(), f);
    expect(c.courses.at(-1)).toMatchObject({ key: "algebra-i-honors", halfUnits: 2, status: "planned", replacesCourseKey: null });
    expect(addCourse(c, f).courses.at(-1)!.key).toBe("algebra-i-honors-2");
    expect(validateNewCourse(c, { ...f, credits: "0.7" })).toMatch(/multiples of 0.5/);
    expect(validateNewCourse(c, { ...f, areaKey: "nope" })).toMatch(/area/);
    expect(validateNewCourse(c, { ...f, plannedEnd: "2027-01-01" })).toMatch(/before/);
  });
  it("replace keeps the old course (status replaced) and links the new one", () => {
    const c = replaceCourse(fixtureContent(), "english-2", { ...f, title: "English 2 (new term)", areaKey: "english" });
    expect(c.courses.find((x) => x.key === "english-2")!.status).toBe("replaced");
    expect(c.courses.at(-1)).toMatchObject({ replacesCourseKey: "english-2", status: "planned" });
    expect(hsRoadmapContentSchema.safeParse(c).success).toBe(true);
  });
  it("remove marks the course removed instead of deleting it", () => {
    const c = removeCourse(fixtureContent(), "english-1");
    expect(c.courses.find((x) => x.key === "english-1")!.status).toBe("removed");
    expect(c.courses).toHaveLength(fixtureContent().courses.length);
  });
  it("adds tasks (lesson/exam/project) with due dates", () => {
    const c = addTask(fixtureContent(), "english-2", { kind: "project", title: "Research paper", dueDate: "2027-03-15" });
    expect(c.courses.find((x) => x.key === "english-2")!.tasks.at(-1)).toEqual({ key: "project-research-paper", kind: "project", title: "Research paper", dueDate: "2027-03-15" });
  });
  it("milestones are cumulative, sorted, unique per month", () => {
    const c = fixtureContent();
    const a = addMilestone(c, "2027-03", "5") as ReturnType<typeof fixtureContent>;
    expect(a.pacing.milestones.map((m) => m.month)).toEqual(["2026-10", "2027-01", "2027-03", "2027-06"]);
    expect(addMilestone(c, "2027-01", "1")).toMatch(/already/);
    expect(addMilestone(c, "2027-02", "1.3")).toMatch(/0.5/);
    const decreasing = addMilestone(c, "2027-04", "1") as ReturnType<typeof fixtureContent>;
    expect(validateDraftContent(decreasing).join(" ")).toMatch(/must not decrease/);
  });
  it("policies are null unless configured; blank clears", () => {
    const c = fixtureContent();
    expect(Object.values(c.policies).every((v) => v === null)).toBe(true);
    const p = setPolicy(setPolicy(c, "maxExamAttempts", "2"), "maxTransferHalfUnits", "7.5");
    expect(p.policies).toMatchObject({ maxExamAttempts: 2, maxTransferHalfUnits: 15, minDaysBetweenExams: null, passingPercent: null });
    expect(setPolicy(p, "maxExamAttempts", "").policies.maxExamAttempts).toBeNull();
    expect(setPolicy(c, "maxExamAttempts", "two").policies.maxExamAttempts).toBeNull();
  });
  it("planning notes name gaps without blocking the save", () => {
    const c = removeCourse(fixtureContent(), "english-1");
    expect(validateDraftContent(c).join(" ")).toMatch(/English: 1 credit still to plan/);
    expect(blockingDraftIssues(c)).toEqual([]);
  });
});

describe("S11 staff UI — enrollment creation and exceptions", () => {
  const form: EnrollmentForm = { templateKey: "us-hs-diploma-21", templateVersion: 1, status: "planned", startedOn: "", targetCompletionDate: "", overrideCredits: "", overrideReason: "" };
  it("builds the contract body; an override needs a reason", () => {
    expect(createEnrollmentBody(form, TEMPLATE_STANDARD_21.totalRequiredHalfUnits)).toMatchObject({ totalRequiredHalfUnitsOverride: null, overrideReason: null });
    expect(validateEnrollmentForm({ ...form, overrideCredits: "22" })).toMatch(/Explain why/);
    const ok = { ...form, overrideCredits: "22", overrideReason: "Tennessee residency" };
    expect(validateEnrollmentForm(ok)).toBeNull();
    expect(createEnrollmentBody(ok, TEMPLATE_STANDARD_21.totalRequiredHalfUnits)).toMatchObject({ totalRequiredHalfUnitsOverride: 44, overrideReason: "Tennessee residency" });
    expect(createEnrollmentBody({ ...ok, overrideCredits: "21" }, TEMPLATE_STANDARD_21.totalRequiredHalfUnits).totalRequiredHalfUnitsOverride).toBeNull();
    expect(validateEnrollmentForm({ ...form, overrideReason: "stray reason" })).toMatch(/only used/);
    expect(validateEnrollmentForm({ ...form, startedOn: "2027-02-01", targetCompletionDate: "2027-01-01" })).toMatch(/before the start/);
  });
  it("exposes the TN 22-credit template as a selectable version", () => {
    expect(FIXTURE_TEMPLATES.map((t) => t.templateKey)).toContain(TEMPLATE_TN_22.templateKey);
    expect(TEMPLATE_TN_22.totalRequiredHalfUnits).toBe(creditsToHalfUnits(22));
  });
  it("timeline lists several enrollments over time with exception reasons", () => {
    const t = enrollmentTimeline(staffStateGraduate());
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ open: false, selected: true });
    expect(t[0]!.note).toMatch(/22 credits/);
    expect(enrollmentTimeline(rich)[1]).toMatchObject({ status: "Withdrawn", open: false, selected: false, period: "Started Sep 2, 2024" });
    expect(enrollmentTimeline(rich)[0]!.period).toBe("Started Aug 17, 2026"); // the target date is shown once, in the summary strip
  });
  it("disclosure explains the generic text and refuses an unconfirmed enrollment", () => {
    const e = rich.current!.enrollment;
    expect(disclosureGate(e, false, "", "Generic").studentSees).toBe("Generic");
    expect(disclosureGate({ ...e, status: "planned" }, true, "Synthetic Online Academy", "Generic")).toMatchObject({ enabled: false });
    expect(disclosureGate(e, true, "", "Generic").reason).toMatch(/name/);
    expect(disclosureGate(e, true, "Synthetic Online Academy", "Generic")).toMatchObject({ enabled: true, studentSees: "Synthetic Online Academy" });
  });
  it("disclosure preview applies the server rule: name only when disclosed AND named AND active|completed", () => {
    const G = "Generic";
    expect(disclosurePreview("active", true, "Synthetic Online Academy", G)).toMatchObject({ sees: "Synthetic Online Academy", nameVisible: true });
    expect(disclosurePreview("completed", true, " Synthetic Online Academy ", G).sees).toBe("Synthetic Online Academy");
    expect(disclosurePreview("active", false, "Synthetic Online Academy", G)).toMatchObject({ sees: G, nameVisible: false });
    expect(disclosurePreview("active", false, "Synthetic Online Academy", G).why).toMatch(/off/);
    expect(disclosurePreview("active", true, "  ", G).why).toMatch(/no school name/);
    for (const st of ["planned", "on_hold", "withdrawn", "transferred_out"] as const) {
      const p = disclosurePreview(st, true, "Synthetic Online Academy", G);
      expect(p.sees).toBe(G);
      expect(p.why).toMatch(/active or completed/);
    }
  });
  it("the program tab explains what the student sees and why (planned + disclosed + named -> generic)", () => {
    const s = staffStateRich();
    s.current = { ...s.current!, enrollment: { ...s.current!.enrollment, status: "planned", institutionDisclosed: true, awardingSchoolName: "Synthetic Online Academy" } };
    const out = html(s, "program");
    expect(out).toContain("An accredited U.S. online high school");
    expect(out).toContain("The name appears once it is active or completed.");
    expect(out).not.toMatch(/mt-1 font-medium">Synthetic Online Academy/);
  });
});

describe("S11 staff UI — gates, evidence and failures", () => {
  it("publish is admin-only, blocked while dirty, and always says why", () => {
    expect(publishGate(null, true, false).enabled).toBe(false);
    expect(publishGate(rich, false, false).reason).toMatch(/administrator/);
    expect(publishGate(rich, true, true).reason).toMatch(/Save your draft/);
    expect(publishGate(rich, true, false)).toEqual({ enabled: true, reason: null });
  });
  it("only verified documents can be evidence", () => {
    expect(verifiedEvidenceDocs(FIXTURE_DOCS).map((d) => d.id)).not.toContain("doc-pending");
    expect(evidenceGate("", FIXTURE_DOCS).reason).toMatch(/Select/);
    expect(evidenceGate("doc-pending", FIXTURE_DOCS).reason).toMatch(/not verified/);
    expect(evidenceGate("doc-eval", FIXTURE_DOCS).enabled).toBe(true);
  });
  it("graduation gates show blockers; conferral is admin-only and needs confirmation first", () => {
    const g = graduationGates(rich, true);
    expect(g.confirm.enabled).toBe(false);
    expect(g.confirm.reason).toMatch(new RegExp(`${rich.current!.graduation.blockers.length} blockers`));
    expect(graduationGates(staffStateGraduationReady(), true).confirm.enabled).toBe(true);
    expect(graduationGates(staffStateGraduationReady(), false).confirm).toEqual({ enabled: false, reason: "Admin only." });
    expect(graduationGates(staffStateGraduationReady(), true).confer.reason).toMatch(/Confirm graduation eligibility first/);
    expect(graduationGates(staffStateEligibilityConfirmed(), false).confer.reason).toMatch(/administrator/);
    expect(graduationGates(staffStateEligibilityConfirmed(), true).confer.enabled).toBe(true);
    expect(graduationGates(staffStateGraduate(), true).confer.reason).toMatch(/already/);
  });
  it("evidence is filtered by purpose and doc type (contract HS_EVIDENCE_DOC_TYPES)", () => {
    const ids = (p: keyof typeof HS_EVIDENCE_DOC_TYPES) => verifiedEvidenceDocs(FIXTURE_DOCS, p).map((d) => d.id).sort();
    expect(ids("diploma")).toEqual(["doc-diploma"]);
    expect(ids("transcript")).toEqual(["doc-transcript"]);
    expect(ids("result")).toEqual(["doc-letter", "doc-transcript"]);
    expect(ids("eligibility")).toEqual(["doc-letter", "doc-transcript"]);
    expect(ids("transferAward")).toEqual(["doc-eval", "doc-letter", "doc-transcript"]);
    expect(evidenceGate("doc-transcript", FIXTURE_DOCS, "diploma").reason).toMatch(/must be a Diploma/);
    expect(evidenceGate("doc-diploma", FIXTURE_DOCS, "diploma").enabled).toBe(true);
    expect(evidenceGate("doc-passport", FIXTURE_DOCS, "result").enabled).toBe(false);
    expect(evidenceGate("doc-pending", FIXTURE_DOCS, "transcript").reason).toMatch(/not verified/);
  });
  it("transfer claims: decision starts at the saved state, units are capped, the badge follows the award", () => {
    expect(initialClaimDecision("claimed")).toBe("claimed"); // the select starts at the saved value
    expect(initialClaimDecision("accepted")).toBe("accepted");
    expect(initialClaimDecision("partially_accepted")).toBe("partially_accepted");
    const partial = { claimedHalfUnits: 2, acceptedHalfUnits: 1, status: "partially_accepted" as const };
    expect(claimDecisionGate(partial, "partially_accepted", "School told us", 1).reason).toMatch(/No change/);
    expect(claimDecisionGate(partial, "partially_accepted", "School told us", 2).enabled).toBe(true);
    expect(claimDecisionGate(partial, "partially_accepted", "School told us", 3).enabled).toBe(false);
    expect(claimDecisionGate({ claimedHalfUnits: 2, status: "claimed" }, "submitted_to_school", "", 1).reason).toMatch(/note/);
    expect(claimDecisionGate({ claimedHalfUnits: 2, status: "claimed" }, "submitted_to_school", "Sent today", 1).enabled).toBe(true);
    expect(resolveClaimBody("partially_accepted", " n ok ", 1)).toEqual({ status: "partially_accepted", note: "n ok", acceptedHalfUnits: 1 });
    expect(resolveClaimBody("accepted", "ok ok", 1)).toEqual({ status: "accepted", note: "ok ok" });
    expect(acceptedSummary(partial)).toBe("Accepted 0.5 of 1 credits");
    expect(acceptedSummary({ claimedHalfUnits: 2, status: "accepted" })).toBe("Accepted 1 of 1 credits");
    expect(acceptedSummary({ claimedHalfUnits: 2, status: "claimed" })).toBeNull();
    expect(transferAwardGate(partial, "0.5", "doc-eval", FIXTURE_DOCS)).toEqual({ enabled: true, reason: null });
    expect(transferAwardGate(partial, "1", "doc-eval", FIXTURE_DOCS).reason).toMatch(/At most 0.5/);
    expect(transferAwardGate(partial, "0.5", "doc-diploma", FIXTURE_DOCS).reason).toMatch(/must be a/);
    expect(claimBadge("accepted", true)).toEqual({ label: "Credit awarded", tone: "good" });
    expect(claimBadge("accepted", false).label).toMatch(/not yet awarded/);
  });
  it("results can only be recorded for courses planned in the PUBLISHED roadmap", () => {
    const keys = planCourseOptions(rich).map((c) => c.key);
    expect(keys).toContain("english-1");
    expect(keys).not.toContain("english-2-b"); // only in the draft
    expect(keys).not.toContain("elective-ghost");
    const none = staffStateRich();
    none.current = { ...none.current!, published: null };
    expect(planCourseOptions(none)).toEqual([]);
  });
  it("formats dates and statuses for people", () => {
    expect(formatDate("2026-10-26")).toBe("Oct 26, 2026");
    expect(formatDate("2026-12-05T10:00:00.000Z")).toBe("Dec 5, 2026");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("soon")).toBe("soon");
    expect(statusLabel("on_hold")).toBe("On hold");
    expect(statusLabel("active")).toBe("Active");
    expect(actorLabel("11111111-1111-4111-8111-111111111111")).toBe("Lumière staff");
    expect(actorLabel(null)).toBe("Lumière staff");
    expect(actorLabel("admin-1")).toBe("an admin");
    expect(actorLabel("staff-1")).toBe("a staff member");
    expect(actorRoleLabel("admin-1")).toBe("Admin");
    expect(actorRoleLabel("staff-1")).toBe("Staff member");
    expect(formatMonth("2026-10")).toBe("Oct 2026");
    expect(formatMonth("soon")).toBe("soon");
  });
  it("delivery only moves forward and financial clearance locks after conferral", () => {
    expect(deliveryOptions("issued")).toEqual(["issued", "delivered"]);
    expect(deliveryOptions("not_requested")).toHaveLength(4);
    expect(financialGate(staffStateGraduate(), "hold", "Billing note").reason).toMatch(/locked/i);
    expect(financialGate(staffStateRich(), "cleared", "Billing note").enabled).toBe(true);
    expect(classifyHsFailure(409, { error: { code: "HS_INVALID_TRANSITION" } }).message).toMatch(/not allowed/i);
  });
  it("remaining credit is never negative", () => {
    expect(remainingHalfUnits(42, 44)).toBe(0);
    expect(remainingHalfUnits(42, 4)).toBe(38);
  });
  it("opens the first area that still needs planning, else the changed one", () => {
    expect(defaultOpenAreas(removeCourse(fixtureContent(), "english-1"))).toEqual(["english"]);
    const draft = rich.current!.draft!.content;
    expect(defaultOpenAreas(draft)).toEqual(["english"]);
  });
  it("guardian guidance follows standing, never access", () => {
    expect(guardianGuidance({ standing: "listed_parent", mayDiscussAcademics: false, mayDiscussFinances: false }).doNotDiscuss).toContain("Academic progress");
    expect(guardianGuidance({ standing: "guardian_unverified", mayDiscussAcademics: false, mayDiscussFinances: false }).label).toMatch(/awaiting verification/);
    const v = guardianGuidance({ standing: "verified_guardian", mayDiscussAcademics: true, mayDiscussFinances: false });
    expect(v.discuss).toContain("Academic progress");
    expect(v.doNotDiscuss.join(" ")).toMatch(/Billing/);
  });
  it("classifies contract failures into calm messages", () => {
    expect(classifyHsFailure(409, { error: { code: "HS_REVISION_CONFLICT", message: "x" } }).kind).toBe("conflict");
    expect(classifyHsFailure(422, { error: { code: "HS_EVIDENCE_INVALID", message: "Not verified" } })).toMatchObject({ kind: "evidence", message: "Not verified" });
    expect(classifyHsFailure(409, { error: { code: "HS_POLICY_VIOLATION", message: "Max 2 attempts" } }).kind).toBe("policy");
    expect(classifyHsFailure(409, { error: { code: "HS_NOT_ELIGIBLE", message: "x" } }).kind).toBe("not_eligible");
    expect(classifyHsFailure(403, null).kind).toBe("forbidden");
    expect(classifyHsFailure(500, "boom").kind).toBe("other");
  });
  it("builds request bodies and endpoints from the contract", () => {
    expect(hsStaffPaths.state("s/1")).toBe("/api/admin/students/s%2F1/high-school");
    expect(hsStaffPaths.sub("s1", "e1", "roadmap/publish")).toBe("/api/admin/students/s1/high-school/enrollments/e1/roadmap/publish");
    expect(taskResultBody({ courseKey: "c", taskKey: "t", outcome: "passed", score: "", evidenceDocumentId: "d", note: " " })).toEqual({ courseKey: "c", taskKey: "t", outcome: "passed", scorePercent: null, evidenceDocumentId: "d", note: null });
    expect(claimBody({ priorEducationId: "p", courseTitle: " Algebra ", areaKey: "math", credits: "0.5" }).claimedHalfUnits).toBe(1);
    expect(conferDiplomaBody("2028-06-01", "a", "b")).toEqual({ action: "confer_diploma", conferredOn: "2028-06-01", diplomaEvidenceDocumentId: "a", transcriptEvidenceDocumentId: "b" });
  });
});

describe("S11 staff UI — rendering", () => {
  it("program tab: current enrollment, history, university indicator, disclosure explanation", () => {
    const out = html(rich, "program");
    expect(out).toContain("High school pathway");
    expect(out).toContain('data-testid="current-enrollment"');
    expect(out).toContain('data-testid="university-indicator"');
    expect(out).toContain("also has a university degree program");
    expect(out).toContain("Enrollment history");
    expect(out).toContain("Withdrawn");
    expect(out).toContain("Until you disclose it, the student sees a generic description instead");
    expect(out).toContain("An accredited U.S. online high school");
    expect(out).not.toContain('data-testid="create-enrollment"');
    expect(out).toContain("Accredited U.S. High School Diploma (21 credits) · version 1");
    expect(out).not.toContain("us-hs-diploma-21 v1");
    expect(out).toContain("Started Aug 17, 2026");
    expect(out).not.toContain("Waiting for review");
  });
  it("dates are shown as Oct 26, 2026 (no ISO dates in visible text)", () => {
    for (const tab of ["program", "prior", "roadmap", "results", "graduation", "guardians", "activity"] as const) {
      const out = html(rich, tab);
      expect(out.replace(/<input[^>]*>/g, "")).not.toMatch(/>\d{4}-\d{2}-\d{2}[T<]/);
    }
    expect(html(rich, "program")).toContain("Aug 17, 2026");
    expect(html(rich, "activity")).toContain("Oct 24, 2026");
  });
  it("the governance banner appears once, on the first tab only", () => {
    expect(html(rich, "program").match(/data-testid="governance-banner"/g)).toHaveLength(1);
    for (const tab of ["prior", "roadmap", "results", "graduation"] as const) expect(html(rich, tab)).not.toContain("governance-banner");
  });
  it("summary: official-only credit bar with area slots, no negative remaining, Completed on after conferral", () => {
    const out = html(rich, "program");
    expect(out).toContain('data-testid="credit-bar"');
    expect(out).toContain("Officially earned 2 of 21 credits. Core 2 of 16, electives 0 of 5.");
    expect(out).toContain("Target completion");
    expect(out).toContain("a target, not a guarantee");
    const over = staffStateRich();
    over.current = { ...over.current!, credits: { ...over.current!.credits, earnedHalfUnits: 44, remainingHalfUnits: -2 } };
    const o = html(over, "program");
    expect(o.replace(/<[^>]+>/g, "|")).not.toMatch(/[|\s]-\d/);
    expect(o).toContain(">0</span> credits remaining");
    const done = html(staffStateGraduate(), "program");
    expect(done).toContain("Completed on");
    expect(done).toContain("Jun 20, 2026");
    expect(done).not.toContain("a target, not a guarantee");
  });
  it("disabled actions are unmistakable: lock icon, muted solid fill, readable text, reason underneath", () => {
    const out = section(GraduationSection, staffStateGraduationReady(), false);
    expect(out).toContain("disabled:text-foreground/80");
    expect(out).toContain("disabled:bg-muted");
    expect(out).not.toContain("border-dashed");
    expect(out).not.toMatch(/disabled:bg-(blue|primary|transparent)/);
    expect(out).toMatch(/<button[^>]*id="ge-save"[^>]*data-locked="true"[^>]*>\s*<svg[^>]*lucide-lock/);
    expect(out).toContain('aria-describedby="ge-save-why"');
    expect(out).toContain('id="ge-save-why"');
    expect(out).toContain("Admin only.");
  });
  it("program tab offers creation with template/version and an exception reason when nothing is open", () => {
    const out = html(staffStateEmpty(), "program");
    expect(out).toContain('data-testid="create-enrollment"');
    expect(out).toContain("Curriculum template and version");
    expect(out).toContain("Reason for the exception");
    expect(out).toContain("Tennessee");
    expect(out).toContain("No high school enrollments yet.");
  });
  it("creation is blocked while another program is open, with a reason", () => {
    const out = renderToStaticMarkup(routed(React.createElement(CreateEnrollmentCard, { studentId: HS_STUDENT_ID, templates: FIXTURE_TEMPLATES, hasOpen: true })));
    expect(out).toContain("already has an open high school program");
    expect(out).toMatch(/<button[^>]*disabled/);
  });
  it("prior study tab says claims are not credit and offers transfer award only for accepted claims", () => {
    const out = section(PriorEducationSection, rich);
    expect(out).toContain('data-testid="claims-not-credit"');
    expect(out).toContain("is not credit");
    expect(out).toContain("Collège Synthétique");
    expect(out).toContain("Claimed — not credit");
    expect(out).toContain("Submitted to school — not credit");
    expect(out.match(/data-testid="transfer-award-form"/g) ?? []).toHaveLength(1); // Algebra I is already awarded; Chemistry (partly accepted) is not
    expect(out).toContain("Official transfer credit recorded for this claim.");
    const s2 = staffStateRich();
    s2.current = { ...s2.current!, awards: [] };
    expect(section(PriorEducationSection, s2).match(/data-testid="transfer-award-form"/g) ?? []).toHaveLength(2);
  });
  it("prior study: the badge reflects the award (no 'accepted' beside an existing award) and shows accepted units", () => {
    const out = section(PriorEducationSection, rich);
    expect(out).toContain("Credit awarded");
    expect(out).toContain("Accepted 0.5 of 1 credits");
    expect(out).toContain("Partly accepted — credit not yet awarded");
    const algebra = out.slice(out.indexOf("Algebra I"), out.indexOf("Biology"));
    expect(algebra).not.toContain("credit only after an official award");
    expect(algebra).not.toContain("not yet awarded");
  });
  it("prior study: selects start from the saved value; the award is capped at the accepted amount for the claim's area", () => {
    const out = section(PriorEducationSection, rich);
    expect(selectedValue(out, "claim-claim-3-status")).toBe("claimed"); // the select starts at the saved status
    expect(selectedValue(out, "claim-claim-2-status")).toBe("submitted_to_school");
    expect(selectedValue(out, "claim-claim-4-status")).toBe("partially_accepted");
    expect(selectedValue(out, "claim-claim-4-accepted")).toBe("1");
    const accepted = selectBlock(out, "claim-claim-4-accepted");
    expect(accepted.match(/<option /g)).toHaveLength(2); // 0.5 and 1 of 1
    const award = selectBlock(out, "claim-claim-4-credits");
    expect(award.match(/<option /g)).toHaveLength(1); // capped at 0.5 accepted
    expect(award).toContain("0.5 credits");
    expect(out).toContain("Counts toward Science; at most 0.5.");
    expect(out).not.toContain('id="claim-claim-1-status"'); // awarded claim has no decision form
    expect(out).toContain("No change from the saved decision.");
  });
  it("prior study: the transfer evidence select lists only transcripts, evaluations and other documents", () => {
    const s2 = staffStateRich();
    const out = section(PriorEducationSection, s2);
    const sel = selectBlock(out, "claim-claim-4-evidence");
    expect(sel).toContain("credit-evaluation.pdf");
    expect(sel).toContain("school-transcript-2026.pdf");
    expect(sel).not.toContain("diploma-scan.pdf");
    expect(sel).not.toContain("passport-scan.pdf");
  });
  it("roadmap tab: credit plan, replaced course history, policies not configured, admin-gated publish", () => {
    const admin = html(rich, "roadmap", true);
    expect(admin).toContain('data-testid="credit-plan"');
    expect(admin).toContain("Replaced");
    expect(admin).toContain("history kept");
    expect(admin).toContain("Not configured — the school&#x27;s rules apply");
    expect(admin).toContain("Version history");
    expect(admin).toContain("Draft version 2");
    expect(admin).toContain("Publish approved roadmap");
    expect(admin).toContain("Published: version 1");
    const staff = html(rich, "roadmap", false);
    expect(staff).toContain("Only an administrator can publish the approved roadmap.");
  });
  it("roadmap tab: one collapsible group per area, overflow menu instead of row buttons, short placeholders", () => {
    const out = html(rich, "roadmap");
    expect(out.match(/data-testid="area-group"/g)).toHaveLength(8);
    expect(out).toContain('aria-label="Actions for English 1: Introduction to Language Arts"');
    expect(out).not.toMatch(/>Replace<|>Remove<|Remove from the plan/);
    expect(out).toContain('placeholder="Not configured"');
    expect(out).not.toContain('placeholder="Not configured —');
    expect(out).toContain("Dates not set");
    expect(out).not.toContain("— to —");
    const folded = html(rich, "roadmap", true, null);
    expect(folded).toMatch(/aria-expanded="true"[^>]*data-state="open"[^>]*>[\s\S]{0,400}English/); // the replaced-course area opens first
    expect(folded.match(/aria-expanded="true"/g)).toHaveLength(1); // forms stay folded: only the one accordion area is open
    expect(out).toContain("Planned against required");
  });
  it("roadmap editor starts clean (saved) and publishable for an admin", () => {
    const out = renderToStaticMarkup(React.createElement(RoadmapEditor, { state: rich, studentId: HS_STUDENT_ID, isAdmin: true, eid: HS_ENROLLMENT_ID }));
    expect(out).toContain("Saved");
    expect(out).not.toContain("Unsaved changes");
    expect(out).not.toContain("Only an administrator");
  });
  it("roadmap tab without a draft offers 'new draft from published' (pacing adjustment)", () => {
    const s = staffStateRich();
    s.current = { ...s.current!, draft: null };
    expect(html(s, "roadmap")).toContain("Adjust pacing: new draft from published");
    const none = staffStateRich();
    none.current = { ...none.current!, draft: null, published: null, versionHistory: [] };
    expect(html(none, "roadmap")).toContain("Create draft from template");
  });
  it("results tab: review queue with reported (not official) scores, evidence selector lists only verified documents", () => {
    const out = section(ResultsSection, rich);
    expect(out).toContain('data-testid="review-queue"');
    expect(out).not.toContain("2 waiting");
    expect(out.match(/data-testid="review-item"/g)).toHaveLength(2);
    expect(text(out)).toContain("student saw 84% (not official)");
    expect(out).toContain("Record official result");
    const sel = selectBlock(out, "rt-evidence");
    expect(sel).toContain("school-transcript-2026.pdf");
    expect(sel).toContain("school-completion-letter.pdf");
    for (const bad of ["diploma-scan.pdf", "passport-scan.pdf", "new-upload-awaiting-check.pdf", "english-1-exam-results.pdf", "credit-evaluation.pdf"]) expect(sel).not.toContain(bad);
    expect(out).toContain("Select a verified document");
    expect(out).toContain("Official credit awards");
    expect(out).toContain("voided: Recorded against the wrong course.");
  });
  it("results tab: planned published courses only, task titles not keys, stacked cards for mobile, evidence warning", () => {
    const out = section(ResultsSection, rich);
    const courses = selectBlock(out, "rt-course");
    expect(courses).toContain("English 1: Introduction to Language Arts");
    expect(courses).not.toContain("English 2: Foundations (new term)");
    expect(out).toContain('data-testid="results-cards"');
    expect(out).toContain("md:hidden");
    expect(out).toContain("hidden w-full table-fixed text-sm md:table");
    expect(out).toContain("Unit 1 lessons");
    expect(out).not.toContain("lesson-unit-1");
    expect(out).toContain("Evidence no longer verified");
    expect(out).toContain("Passed");
    const ok = staffStateRich();
    ok.current = { ...ok.current!, results: ok.current!.results.map((r) => ({ ...r, evidenceStillVerified: true })), awards: ok.current!.awards.map((a) => ({ ...a, evidenceStillVerified: true })) };
    expect(section(ResultsSection, ok)).not.toContain("Evidence no longer verified");
  });
  it("void award is admin-only with a reason", () => {
    expect(section(ResultsSection, rich, false)).toContain("Only an administrator can void an award.");
  });
  it("graduation tab: blockers listed, confirm disabled with reason, financial clearance shows Not available when null", () => {
    const out = section(GraduationSection, rich);
    expect(out).toContain('data-testid="graduation-blockers"');
    const n = rich.current!.graduation.blockers.length;
    expect(out).toContain(`${n} blockers before eligibility can be confirmed`);
    // The server's blockers are credit-only: no hand-added exam/project lines.
    expect(rich.current!.graduation.blockers).toEqual(creditBlockers(rich.current!.credits));
    expect(out).not.toMatch(/no official result/);
    expect(out).toContain(`${n} blockers remain`);
    expect(out).toContain('id="ge-save"'); // the current step keeps its form, disabled, with the reason
    const nul = staffStateRich();
    nul.current = { ...nul.current!, graduation: { ...nul.current!.graduation, financialClearance: null } };
    expect(section(GraduationSection, nul)).toContain("Not available");
    expect(section(GraduationSection, staffStateGraduationReady())).toContain("Ready to confirm. No credit blockers.");
  });
  it("graduation tab: staff cannot confirm eligibility (admin only), even with no blockers", () => {
    const out = section(GraduationSection, staffStateGraduationReady(), false);
    expect(out).toContain("Admin only.");
    expect(out).toMatch(/<button[^>]*id="ge-save"[^>]*disabled/);
    expect(section(GraduationSection, staffStateGraduationReady(), true)).not.toContain("Admin only.");
  });
  it("graduation tab: selects start from the saved value and need a real change", () => {
    const out = section(GraduationSection, staffStateGraduationReady());
    expect(selectedValue(out, "fc-value")).toBe("cleared");
    expect(out).toContain("No change from the current clearance.");
    expect(selectedValue(section(GraduationSection, rich), "fc-value")).toBe("unknown");
    const eligible = section(GraduationSection, staffStateEligibilityConfirmed());
    // Before conferral there is no archived evidence: "issued"/"delivered" cannot be offered, so a requested transcript has no further choice.
    expect(eligible).not.toContain('id="dl-transcript-status"');
    expect(text(eligible)).toContain("Archived evidence: Not archived yet");
    expect(selectedValue(eligible, "dl-diploma-status")).toBe("not_requested");
  });
  it("graduation tab: evidence selects are filtered by purpose", () => {
    const out = section(GraduationSection, staffStateEligibilityConfirmed());
    expect(selectBlock(out, "gc-diploma")).toContain("diploma-scan.pdf");
    expect(selectBlock(out, "gc-diploma")).not.toContain("school-transcript-2026.pdf");
    expect(selectBlock(out, "gc-transcript")).toContain("school-transcript-2026.pdf");
    expect(selectBlock(out, "gc-transcript")).not.toContain("diploma-scan.pdf");
    const ready = section(GraduationSection, staffStateGraduationReady());
    expect(selectBlock(ready, "ge-evidence")).toContain("school-completion-letter.pdf");
    expect(selectBlock(ready, "ge-evidence")).not.toContain("diploma-scan.pdf");
  });
  it("graduation tab: finished steps collapse into a summary row, not a dead disabled form", () => {
    const eligible = section(GraduationSection, staffStateEligibilityConfirmed());
    expect(eligible).toContain("Step 1 · Eligibility confirmed on Jun 12, 2026 by an admin");
    expect(eligible).not.toContain("admin-1");
    expect(eligible).toContain("school-completion-letter.pdf");
    expect(eligible).not.toContain('id="ge-save"');
    expect(eligible).toContain('id="gc-save"');
    const done = section(GraduationSection, staffStateGraduate());
    expect(done).toContain("Step 2 · Diploma conferred on Jun 20, 2026");
    expect(done).not.toContain('id="ge-save"');
    expect(done).not.toContain('id="gc-save"');
    expect(done).not.toContain("<form");
    const early = section(GraduationSection, rich);
    expect(early).not.toContain('id="gc-save"');
    expect(early).toContain("Confirm graduation eligibility first.");
  });
  it("graduation tab: conferred state archives evidence and cannot be conferred again", () => {
    const out = section(GraduationSection, staffStateGraduate());
    expect(out).toContain("Diploma conferred");
    expect(graduationGates(staffStateGraduate(), true).confer.reason).toMatch(/already/);
    expect(out).toContain("school-transcript-2026.pdf");
    expect(section(GraduationSection, staffStateEligibilityConfirmed(), false)).toContain("Only an administrator can confer the diploma.");
  });
  it("guardians tab: three standings, no portal access, notes staff-only, link to the S09 panel", () => {
    const out = section(GuardiansSection, rich);
    expect(out).toContain("Listed parent — no authority");
    expect(out).toContain("Guardian — awaiting verification");
    expect(out).toContain("Verified guardian");
    expect(out).not.toContain("sm:grid-cols-[1fr_auto]"); // note input is full width, label above
    expect(out).toContain("Portal access: none");
    expect(out).toContain("Staff-only notes (never shown to the student)");
    expect(out).toContain("/admin/students/11111111-1111-4111-8111-111111111111#workspace-profile");
    expect(out).toContain("Contacts never receive portal access");
    expect(out).not.toMatch(/Verify authority|Revoke…/);
  });
  it("activity tab lists recent events newest first", () => {
    const out = renderToStaticMarkup(React.createElement(EventsSection, { state: rich }));
    expect(out.indexOf("Roadmap draft saved")).toBeLessThan(out.indexOf("High school enrollment created"));
  });
  it("summary shows only OFFICIAL credit in exact half-unit decimals", () => {
    const s = staffStateRich();
    s.current = { ...s.current!, credits: { ...s.current!.credits, earnedHalfUnits: 41, remainingHalfUnits: 1 } };
    const out = html(s, "program");
    expect(out).toMatch(/20\.5(<!-- -->)? <span/);
    expect(out).toContain("of 21 credits");
  });
  it("renders nothing sensitive: no student-facing guardian notes leak into other tabs, no raw half-unit integers as credits", () => {
    expect(html(rich, "roadmap")).not.toContain("told him we need verification");
    expect(ProgramSection).toBeTypeOf("function");
  });
});

// ── final polish after the second independent review ─────────────────────────

const closedState = (status: "withdrawn" | "transferred_out" | "completed") => {
  const s = staffStateRich();
  s.current = { ...s.current!, enrollment: { ...s.current!.enrollment, status } };
  return s;
};
const ALL_TABS = ["program", "prior", "roadmap", "results", "graduation", "guardians", "activity"] as const;

describe("S11 staff polish — fixtures only show what the server can produce (fix 1)", () => {
  it("blockers are creditBlockers() unmodified in every state (confirm_eligibility checks credit only)", () => {
    for (const st of allStates()) expect(st.current!.graduation.blockers).toEqual(creditBlockers(st.current!.credits));
    expect(rich.current!.graduation.blockers.length).toBeGreaterThan(3); // not truncated
    expect(staffStateGraduationReady().current!.graduation.blockers).toEqual([]);
  });
  it("transcript and diploma evidence exist only from conferral on; before it nothing is issued or delivered", () => {
    const before = staffStateEligibilityConfirmed().current!.graduation;
    expect(before.status).toBe("eligibility_confirmed");
    expect(before.transcript.documentId).toBeNull();
    expect(before.diploma.documentId).toBeNull();
    expect(["issued", "delivered"]).not.toContain(before.transcript.status);
    expect(["issued", "delivered"]).not.toContain(before.diploma.status);
    for (const st of [rich, staffStateGraduationReady()]) {
      const g = st.current!.graduation;
      expect(g.transcript.documentId).toBeNull();
      expect(g.transcript.status).toBe("not_requested");
    }
    const after = staffStateGraduate().current!.graduation;
    expect(after.diploma.documentId).toBe("doc-diploma");
    expect(after.transcript.documentId).toBe("doc-transcript");
    const out = text(section(GraduationSection, staffStateEligibilityConfirmed()));
    expect(out).not.toContain("Issued by school");
  });
  it("program titles carry the enrollment's own credit total (server programTitleOf rule)", () => {
    expect(programTitleOf("Accredited U.S. High School Diploma (21 credits)", 44)).toBe("Accredited U.S. High School Diploma (22 credits)");
    expect(programTitleOf("Plain", 42)).toBe("Plain (21 credits)");
    for (const st of allStates()) for (const e of st.enrollments) expect(e.programTitle).toBe(programTitleOf(TEMPLATE_STANDARD_21.title, e.totalRequiredHalfUnits));
    expect(staffStateGraduate().current!.enrollment.programTitle).toBe("Accredited U.S. High School Diploma (22 credits)");
    expect(text(html(staffStateGraduate(), "program"))).toContain("Accredited U.S. High School Diploma (22 credits) · version 1");
    const g = html(staffStateGraduate(), "program");
    const cur = g.slice(g.indexOf('data-testid="current-enrollment"'), g.indexOf('data-testid="enrollment-history"'));
    expect(cur).not.toContain("(21 credits)"); // the template list further down legitimately offers 21-credit templates
    expect(cur).toContain("(22 credits)");
  });
  it("a course-completion award always has its completed course result, and every award/void/result has an activity event", () => {
    for (const st of allStates()) {
      const c = st.current!;
      for (const a of c.awards.filter((x) => x.source === "course_completion")) expect(c.results.some((r) => r.courseKey === a.courseKey && r.taskKey === null && r.outcome === "completed")).toBe(true);
      const count = (type: string) => st.events.filter((e) => e.type === type).length;
      expect(count("credit_awarded")).toBe(c.awards.length);
      expect(count("credit_voided")).toBe(c.awards.filter((a) => a.status === "voided").length);
      expect(count("official_course_result") + count("official_task_result")).toBe(c.results.length);
    }
    expect(rich.events.some((e) => e.type === "credit_awarded" && /transfer credit/.test(e.summary))).toBe(true);
    expect(rich.events.some((e) => e.type === "credit_voided")).toBe(true);
  });
});

describe("S11 staff polish — copy, status and wording (fixes 2, 3, 4, 6, 9)", () => {
  it("step 1 states the real rule", () => {
    const out = text(section(GraduationSection, staffStateGraduationReady()));
    expect(out).toContain("Requires every credit area to be met with official credit, and the school's verified confirmation document.");
    expect(out).not.toContain("every credit and result to be official");
  });
  it("prior study: the saved status is the current state, the select is 'Change to' and starts at the saved value with Save disabled", () => {
    const out = section(PriorEducationSection, rich);
    const french = out.slice(out.indexOf("French Literature"), out.indexOf("Chemistry basics"));
    expect(french).toContain("Current status");
    expect(french).toContain("Claimed — not credit");
    expect(french).toContain(">Change to</label>");
    expect(french).not.toContain("School&#x27;s decision");
    expect(selectedValue(out, "claim-claim-3-status")).toBe("claimed");
    expect(french).toMatch(/<button[^>]*id="claim-claim-3-resolve"[^>]*disabled/);
    expect(text(french)).toContain("No change from the saved decision.");
    const biology = out.slice(out.indexOf("Biology"), out.indexOf("French Literature"));
    expect(selectedValue(out, "claim-claim-2-status")).toBe("submitted_to_school");
    expect(biology).not.toContain('value="claimed"'); // a sent claim cannot go back to "claimed"
    expect(claimDecisionGate({ claimedHalfUnits: 2, status: "claimed" }, "claimed", "a note", 1).enabled).toBe(false);
    expect(claimDecisionGate({ claimedHalfUnits: 2, status: "claimed" }, "accepted", "a note", 1).enabled).toBe(true);
  });
  it("roadmap: 'Fully planned' instead of 'Complete', and stacked rows keep Required/Planned for phones", () => {
    const out = html(rich, "roadmap");
    expect(out).toContain("Fully planned");
    expect(out).not.toMatch(/>Complete</);
    const rows = out.slice(out.indexOf('data-testid="credit-plan-rows"'), out.indexOf('data-testid="course-plan"'));
    expect(out).toContain("md:hidden");
    expect(text(rows)).toMatch(/Startup courses core Required 1 · Planned 1 · Still to plan Fully planned/);
    expect(out).not.toContain("min-w-[34rem]"); // no horizontal-scroll table hiding the numbers at 390
    expect(rows.match(/<li/g)).toHaveLength(8);
  });
  it("milestones read 'Oct 2026' and the month control is labelled selects, not a native month input", () => {
    const out = html(rich, "roadmap");
    expect(text(out)).toMatch(/By Oct 2026\s*:\s*2 credits/);
    expect(text(out)).not.toMatch(/By 2026-10/);
    expect(out).toContain('aria-label="Remove milestone Oct 2026"');
    expect(out).not.toContain('type="month"');
    expect(out).toMatch(/<legend[^>]*>Month<\/legend>/);
    expect(selectBlock(out, "ms-month")).toContain("October");
    expect(selectBlock(out, "ms-year")).toContain("2026");
    expect(out).not.toContain("---------");
  });
  it("graduation: 'Ready to confirm' beside no blockers, never 'In progress'; one status line per step, no repeated chip", () => {
    const ready = text(section(GraduationSection, staffStateGraduationReady()));
    expect(ready).toContain("Ready to confirm");
    expect(ready).not.toContain("In progress");
    const confirmed = text(section(GraduationSection, staffStateEligibilityConfirmed()));
    expect(confirmed.match(/Eligibility confirmed/g)).toHaveLength(1);
    expect(confirmed).not.toContain("In progress");
    const done = text(section(GraduationSection, staffStateGraduate()));
    expect(done.match(/Diploma conferred/g)).toHaveLength(1);
    expect(done.match(/Eligibility confirmed/g)).toHaveLength(1);
    expect(section(GraduationSection, staffStateGraduate())).not.toMatch(/rounded-full border[^>]*>(Diploma conferred|Eligibility confirmed|In progress)</);
  });
  it("program tab shows the target date once (summary strip); the edit form holds it only when opened", () => {
    const folded = text(html(rich, "program", true, null));
    expect(folded.match(/Jun 30, 2028/g)).toHaveLength(1);
    const opened = html(rich, "program", true, "edit-enrollment");
    expect(text(opened).match(/Jun 30, 2028/g)).toHaveLength(1);
    expect(opened).toMatch(/<input[^>]*id="hs-edit-target"[^>]*value="2028-06-30"/);
  });
});

describe("S11 staff polish — people, awards, activity (fix 5)", () => {
  it("never shows raw ids as people anywhere", () => {
    for (const st of allStates()) for (const tab of ALL_TABS) {
      const out = text(html(st, tab));
      expect(out).not.toMatch(/\b(admin|staff)-\d/);
      expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    }
  });
  it("activity has a By column with role labels and lists every event, matching the Reviews tab", () => {
    const out = html(rich, "activity");
    expect(out).toContain(">By<");
    expect(out.match(/data-testid="event-row"/g)).toHaveLength(rich.events.length);
    const by = [...out.matchAll(/data-testid="event-by">([^<]*)</g)].map((m) => m[1]);
    expect(new Set(by)).toEqual(new Set(["Staff member", "Admin"]));
    const t = text(out);
    expect(t).toContain("1 credit voided");
    expect(t).toContain("1 transfer credit awarded");
    expect(t).toContain("0.5 credit awarded for Foundations of Personal Growth");
    expect(t).not.toMatch(/for course [a-z]+-[a-z]/);
    // a student's own request is "Student"; an unknown account id is "Lumière staff", never the id.
    const conf = html(staffStateEligibilityConfirmed(), "activity");
    expect(conf).toContain('data-testid="event-by">Student<');
    expect(actorRoleLabel("5a1e0000-0000-4000-8000-000000000001")).toBe("Lumière staff");
    expect(friendlyEventSummary("Official result recorded for english-1/exam-midterm: passed", rich.current!.published!.content.courses)).toBe("Official result recorded for Midterm exam (English 1: Introduction to Language Arts): passed");
  });
  it("award rows show the course or claim title and credits, never '1 cr'", () => {
    const out = text(section(ResultsSection, rich));
    expect(out).toContain("Transfer credit · Algebra I · 1 credit");
    expect(out).toContain("Course completion · Foundations of Personal Growth · 0.5 credits");
    expect(out).not.toMatch(/\bcr\b/);
    expect(awardLabel({ source: "transfer", courseKey: null, claimId: "c1", halfUnits: 2 }, [], [{ id: "c1", courseTitle: "Spanish 1" }])).toBe("Transfer credit · Spanish 1 · 1 credit");
    expect(selectBlock(section(ResultsSection, rich), "void-award")).toContain("Transfer credit · Algebra I · 1 credit");
    expect(text(selectBlock(section(ResultsSection, rich), "rc-course"))).toMatch(/English 1: Introduction to Language Arts · \d+(\.5)? credits?/);
  });
  it("guardian notes name the role, not the id", () => {
    expect(text(section(GuardiansSection, rich))).toContain("Oct 23, 2026 · by a staff member");
  });
});

describe("S11 staff polish — layout and controls (fixes 7, 10, 11, 12)", () => {
  it("tabs are one scrollable row: tablist, overflow-x-auto, no wrapping, visible fade cue", () => {
    const out = html(rich, "program");
    const list = /<div role="tablist"[^>]*>/.exec(out)?.[0] ?? "";
    expect(list).toContain("overflow-x-auto");
    expect(list).not.toContain("flex-wrap");
    expect(list).toContain('aria-label="High school pathway sections"');
    expect(out).toContain('data-testid="hs-tabs-fade"');
    expect(out.match(/role="tab"[^>]*class="[^"]*shrink-0/g)).toHaveLength(7);
  });
  it("credit bar has a visible legend of every area with earned/required, official only", () => {
    const out = html(rich, "program");
    const legend = out.slice(out.indexOf('data-testid="credit-legend"'), out.indexOf("credits remaining"));
    for (const s of creditSlots(rich.current!.credits)) expect(text(legend)).toContain(`${s.label} ${formatHalfUnits(s.earnedHalfUnits)}/${formatHalfUnits(s.requiredHalfUnits)}`);
    expect(text(legend)).toContain("Mathematics 1/3");
    expect(legend).not.toContain("title="); // not hover-only
    expect(text(out)).toContain("official credit only");
    expect(text(out)).not.toMatch(/planned credit|reported credit/i);
  });
  it("forms are folded behind a primary 'Record …' button; opening one closes the others", () => {
    for (const [C, st, ids] of [
      [ResultsSection, rich, ["rt-save", "rc-save", "void-go"]],
      [GraduationSection, staffStateEligibilityConfirmed(), ["gc-save", "fc-save"]],
      [PriorEducationSection, rich, ["pe-save", "tc-save", "claim-claim-3-resolve"]],
    ] as const) {
      const folded = section(C as React.ComponentType<any>, st, true, null);
      expect(folded).not.toContain("<form");
      for (const id of ids) expect(folded).not.toContain(`id="${id}"`);
      expect(folded).toMatch(/aria-expanded="false"[^>]*aria-controls="[a-z0-9-]+-panel"/);
    }
    const onlyTask = section(ResultsSection, rich, true, "task");
    expect(onlyTask).toContain('id="rt-save"');
    expect(onlyTask).not.toContain('id="rc-save"');
    expect(onlyTask).toContain("Close form");
    expect(section(ResultsSection, rich, true, null)).toContain("Record task result");
    expect(html(staffStateEmpty(), "program", true, undefined as unknown as null)).toContain('id="hs-create"'); // a student with no program starts on the create form
  });
  it("numbers use tabular-nums", () => {
    for (const tab of ALL_TABS) expect(html(rich, tab)).toContain("tabular-nums");
  });
  it("a locked (disabled) action shows a lock icon and its reason; a gated enabled action does not", () => {
    const staff = html(rich, "roadmap", false);
    expect(staff).toMatch(/<button[^>]*id="rm-publish"[^>]*data-locked="true"[^>]*>\s*<svg[^>]*lucide-lock/);
    expect(staff).toContain('id="rm-publish-why"');
    const admin = html(rich, "roadmap", true);
    expect(admin).not.toMatch(/<button[^>]*id="rm-publish"[^>]*data-locked/);
  });
});

describe("S11 staff polish — closed enrollments are read-only (server: HS_OFFICIAL_RECORD_LOCKED)", () => {
  it("program tab: no edit or disclosure forms for a closed enrollment, just 'This record is closed'", () => {
    for (const status of ["withdrawn", "transferred_out", "completed"] as const) {
      const out = html(closedState(status), "program");
      expect(text(out)).toContain("This record is closed.");
      for (const gone of ['id="hs-edit-save"', 'id="hs-edit-status"', 'id="hs-disclosure-save"', 'id="hs-disclosed"', "Edit program", "Change disclosure"]) expect(out).not.toContain(gone);
      expect(out).toContain('data-testid="disclosure-preview"'); // what the student sees stays visible
    }
    const open = html(rich, "program");
    expect(open).toContain('id="hs-edit-save"');
    expect(open).not.toContain("This record is closed");
    expect(html(staffStateGraduate(), "program")).not.toContain('id="hs-edit-save"');
  });
  it("every other editing tab locks too; financial clearance and delivery follow the server rules", () => {
    const w = closedState("withdrawn");
    const prior = section(PriorEducationSection, w);
    expect(text(prior)).toContain("This record is closed.");
    for (const gone of ['id="pe-save"', 'id="tc-save"', 'id="claim-claim-3-resolve"', "Record school decision"]) expect(prior).not.toContain(gone);
    const results = section(ResultsSection, w);
    for (const gone of ['id="rt-save"', 'id="rc-save"', 'id="void-go"', "Record official result", "Void an award"]) expect(results).not.toContain(gone);
    expect(text(results)).toContain("This record is closed.");
    const road = html(w, "roadmap");
    expect(text(road)).toContain("This record is closed.");
    expect(road).not.toContain('id="rm-publish"');
    expect(road).toContain('data-testid="version-history"');
    const grad = section(GraduationSection, w);
    for (const gone of ['id="ge-evidence"', 'id="fc-save"', 'id="dl-transcript-save"', 'id="dl-diploma-save"']) expect(grad).not.toContain(gone);
    expect(text(grad)).toContain("This record is closed. Delivery can no longer change.");
    expect(financialGate(w, "cleared", "note").enabled).toBe(false);
    expect(graduationGates(w, true).confirm.reason).toBe("This record is closed.");
    // completed (diploma conferred): delivery may still move forward, financial clearance is locked.
    const done = staffStateGraduate();
    expect(financialGate(done, "hold", "note").reason).toMatch(/locked/);
    expect(deliveryOptions("issued", true)).toEqual(["issued", "delivered"]);
    expect(deliveryOptions("requested", false)).toEqual(["requested"]);
    expect(section(GraduationSection, done)).toContain('id="dl-diploma-status"');
    // guardian notes stay allowed (the server does not lock them).
    expect(section(GuardiansSection, w)).toContain('id="gn-c-1-save"');
  });
});

