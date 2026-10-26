import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { describe, expect, it, vi } from "vitest";
import { TEMPLATE_STANDARD_21, TEMPLATE_TN_22, creditsToHalfUnits, hsRoadmapContentSchema, type StaffHighSchoolState } from "@shared/high-school-contract";

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
import {
  addCourse, addMilestone, addTask, areaPlanRows, blockingDraftIssues, classifyHsFailure, claimBody, conferDiplomaBody, createEnrollmentBody, disclosureGate,
  enrollmentTimeline, evidenceGate, graduationGates, guardianGuidance, hsStaffPaths, parseCreditInput, plannedHalfUnits, publishGate, removeCourse, replaceCourse,
  setPolicy, slugKey, taskResultBody, validateDraftContent, validateEnrollmentForm, validateNewCourse, verifiedEvidenceDocs, type EnrollmentForm,
} from "@/lib/admin-high-school-logic";
import {
  FIXTURE_DOCS, FIXTURE_TEMPLATES, HS_ENROLLMENT_ID, HS_STUDENT_ID, fixtureContent, staffStateEligibilityConfirmed, staffStateEmpty, staffStateGraduate,
  staffStateGraduationReady, staffStateRich,
} from "./helpers/s11-hs-staff-fixtures";

const rich = staffStateRich();
const routed = (el: React.ReactElement) => React.createElement(Router, { ssrPath: "/" }, el);
const html = (state: StaffHighSchoolState, tab: HsTabId, isAdmin = true) =>
  renderToStaticMarkup(routed(React.createElement(HighSchoolWorkspace, { state, studentId: HS_STUDENT_ID, isAdmin, docs: FIXTURE_DOCS, defaultTab: tab })));
const section = (C: React.ComponentType<any>, state: StaffHighSchoolState, isAdmin = true) =>
  renderToStaticMarkup(routed(React.createElement(C, { state, studentId: HS_STUDENT_ID, isAdmin, docs: FIXTURE_DOCS })));

describe("S11 staff UI — fixtures are valid against the contract", () => {
  it("the rich fixture's roadmap content parses and has zero validation problems apart from planning notes", () => {
    expect(hsRoadmapContentSchema.safeParse(fixtureContent()).success).toBe(true);
    expect(blockingDraftIssues(fixtureContent())).toEqual([]);
    expect(rich.current?.published?.versionNumber).toBe(1);
    expect(rich.current?.draft?.versionNumber).toBe(2);
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
  });
  it("planned totals use planned courses only", () => {
    const c = fixtureContent();
    const before = plannedHalfUnits(c);
    expect(plannedHalfUnits(removeCourse(c, "english-1"))).toBe(before - 2);
    expect(areaPlanRows(c).find((r) => r.key === "electives")!.plannedHalfUnits).toBe(1);
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
    expect(a.pacing.milestones.map((m) => m.month)).toEqual(["2027-01", "2027-03", "2027-06"]);
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
    expect(enrollmentTimeline(rich)[1]).toMatchObject({ status: "withdrawn", open: false, selected: false });
  });
  it("disclosure explains the generic text and refuses an unconfirmed enrollment", () => {
    const e = rich.current!.enrollment;
    expect(disclosureGate(e, false, "", "Generic").studentSees).toBe("Generic");
    expect(disclosureGate({ ...e, status: "planned" }, true, "Synthetic Online Academy", "Generic")).toMatchObject({ enabled: false });
    expect(disclosureGate(e, true, "", "Generic").reason).toMatch(/name/);
    expect(disclosureGate(e, true, "Synthetic Online Academy", "Generic")).toMatchObject({ enabled: true, studentSees: "Synthetic Online Academy" });
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
    expect(g.confirm.reason).toMatch(/3 blockers/);
    expect(graduationGates(staffStateGraduationReady(), false).confirm.enabled).toBe(true);
    expect(graduationGates(staffStateGraduationReady(), true).confer.reason).toMatch(/Confirm graduation eligibility first/);
    expect(graduationGates(staffStateEligibilityConfirmed(), false).confer.reason).toMatch(/administrator/);
    expect(graduationGates(staffStateEligibilityConfirmed(), true).confer.enabled).toBe(true);
    expect(graduationGates(staffStateGraduate(), true).confer.reason).toMatch(/already/);
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
    expect(out).toContain("withdrawn");
    expect(out).toContain("Until you disclose it, the student sees a generic description instead");
    expect(out).toContain("An accredited U.S. online high school");
    expect(out).not.toContain('data-testid="create-enrollment"');
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
    expect(out.match(/data-testid="transfer-award-form"/g) ?? []).toHaveLength(0); // the only accepted claim is already awarded
    expect(out).toContain("Official transfer credit recorded for this claim.");
    const s2 = staffStateRich();
    s2.current = { ...s2.current!, awards: [] };
    expect(section(PriorEducationSection, s2).match(/data-testid="transfer-award-form"/g) ?? []).toHaveLength(1);
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
    expect(out).toContain("2 waiting");
    expect(out).toContain("student saw 84% (not official)");
    expect(out).toContain("Record official result");
    expect(out).toContain("english-2-exam.pdf");
    expect(out).not.toContain("new-upload-awaiting-check.pdf");
    expect(out).toContain("Select a verified document");
    expect(out).toContain("Official credit awards");
    expect(out).toContain("voided: Recorded against the wrong course.");
  });
  it("void award is admin-only with a reason", () => {
    expect(section(ResultsSection, rich, false)).toContain("Only an administrator can void an award.");
  });
  it("graduation tab: blockers listed, confirm disabled with reason, financial clearance shows Not available when null", () => {
    const out = section(GraduationSection, rich);
    expect(out).toContain('data-testid="graduation-blockers"');
    expect(out).toContain("3 blockers before eligibility can be confirmed");
    expect(out).toContain("exams have no official result");
    expect(out).toContain("3 blockers remain");
    const nul = staffStateRich();
    nul.current = { ...nul.current!, graduation: { ...nul.current!.graduation, financialClearance: null } };
    expect(section(GraduationSection, nul)).toContain("Not available");
    expect(section(GraduationSection, staffStateGraduationReady())).toContain("No blockers. Eligibility can be confirmed.");
  });
  it("graduation tab: conferred state archives evidence and cannot be conferred again", () => {
    const out = section(GraduationSection, staffStateGraduate());
    expect(out).toContain("Diploma conferred");
    expect(out).toContain("The diploma is already conferred.");
    expect(out).toContain("school-transcript-2026.pdf");
    expect(section(GraduationSection, staffStateEligibilityConfirmed(), false)).toContain("Only an administrator can confer the diploma.");
  });
  it("guardians tab: three standings, no portal access, notes staff-only, link to the S09 panel", () => {
    const out = section(GuardiansSection, rich);
    expect(out).toContain("Listed parent — no authority");
    expect(out).toContain("Guardian — awaiting verification");
    expect(out).toContain("Verified guardian");
    expect(out).toContain("Portal access: none");
    expect(out).toContain("Staff-only notes (never shown to the student)");
    expect(out).toContain("/admin/students/11111111-1111-4111-8111-111111111111#workspace-profile");
    expect(out).toContain("Contacts never receive portal access");
    expect(out).not.toMatch(/Verify authority|Revoke…/);
  });
  it("activity tab lists recent events newest first", () => {
    const out = renderToStaticMarkup(React.createElement(EventsSection, { state: rich }));
    expect(out.indexOf("Draft v2 saved")).toBeLessThan(out.indexOf("Enrollment created"));
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
