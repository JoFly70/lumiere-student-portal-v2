import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  EVALUATION_FRAMING,
  buildEvaluationView,
  buildStaffGraduateProgramView,
  evaluationConsistency,
  evaluateEvaluationVerification,
  type CredentialEvaluationRecord,
  type StaffGraduateWorkspace,
  type StaffRecordView,
} from "@shared/graduate-program-contract";
import { OFFERINGS, RULE_SET_2025, RULE_SET_2026, RULE_SET_ENEB_ONLY, credit, journeyA, journeyB, record } from "./helpers/s12-graduate-fixtures";

vi.stubGlobal("React", React);
vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ isLoading: false, isError: false, data: undefined, refetch: vi.fn() })),
  useMutation: vi.fn(() => ({ isPending: false, mutate: vi.fn() })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "staff" } }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));

import { GraduateProgramReviewView } from "@/components/admin/graduate-program-review";
import {
  STAFF_GRADUATE_PATHS,
  buildCreditBody,
  buildEnrollBody,
  buildResultBody,
  buildTrackBody,
  buildVerifyBody,
  canOfferVerify,
  creditGate,
  emptyCreditForm,
  emptyResultForm,
  emptyTrackForm,
  enrollGate,
  failureSummary,
  legalizationLine,
  parseApiFailure,
  recordTriad,
  resultGate,
  titleLines,
  verifyFormDefaults,
  verifyGate,
  verifySubmitGate,
  activeRuleSets,
  sectionsForRoute,
  buildActionQueue,
  buildEvaluationBody,
  buildEvaluationUpdateBody,
  buildEvaluationVerifyBody,
  creditGroups,
  emptyEvaluationForm,
  evaluationFormGate,
  evaluationRow,
  evaluationUpdateDefaults,
  fieldErrors,
  outcomeLabel,
  programSummary,
  recordActions,
  setEvaluator,
  studentProgressText,
  subjectNeedsVerification,
  trackSummary,
  trustBadge,
  unlinkedEvaluationQueue,
} from "@/components/admin/graduate-program-review-logic";

const staffView = (bundle = journeyB("registered"), current: string | null = bundle.ruleSet.id) => buildStaffGraduateProgramView(bundle, current, "staff");
const rec = (v: ReturnType<typeof staffView>, kind: string) => v.records.find((r) => r.kind === kind) as StaffRecordView;
const workspace = (programs: ReturnType<typeof staffView>[]): StaffGraduateWorkspace => ({ studentId: "stu-syn-b", viewerRole: "staff", programs, offerings: OFFERINGS, ruleSets: [RULE_SET_2025, RULE_SET_2026, RULE_SET_ENEB_ONLY] });
const html = (w: StaffGraduateWorkspace, role: "staff" | "admin" = "staff") => renderToStaticMarkup(React.createElement(GraduateProgramReviewView, { workspace: w, role }));

describe("S12 staff graduate panel logic", () => {
  it("separates marketing, contract and university titles and never shows an unverified university title as verified", () => {
    const v = staffView();
    const t = titleLines(v);
    expect(t.marketing).toBe("Master in Big Data and Business Intelligence");
    expect(t.universityTitle.verified).toBe(false);
    expect(t.universityTitle.text).toMatch(/Not confirmed/);
    const a = titleLines(staffView(journeyA(), "rs-eneb"));
    expect(a.universityTitle.text).toMatch(/ENEB-only/);
    expect(a.contract).toBeNull(); // contract title equals marketing title
  });

  it("triad: verified shows issuer/document/date/reviewer; unverified shows claimed + blockers", () => {
    const v = staffView(journeyB("registered"));
    const reg = recordTriad(rec(v, "university_registration"));
    expect(reg.verified?.issuer).toMatch(/Marconi/);
    expect(reg.verified?.decisionDate).toBe("2026-03-20");
    expect(reg.verified?.reviewer).toBe("staff-1");
    expect(reg.action).toEqual([]);

    const pending = staffView(journeyB("admitted"));
    const r = rec(pending, "university_registration");
    const t = recordTriad(r);
    expect(t.verified).toBeNull();
    expect(t.action.length).toBeGreaterThan(0);
    expect(t.action.join(" ")).toMatch(/matricola|issued the evidence|Name the institution/i);
    expect(canOfferVerify(r)).toBe(true);
  });

  it("a stated matricola is shown as CLAIMED, never as verified", () => {
    const bundle = journeyB("admitted");
    const idx = bundle.records.findIndex((r) => r.kind === "university_registration");
    const records = [...bundle.records];
    records[idx] = record(bundle.program.id, bundle.program.studentId, "university_registration", { trackingStatus: "in_progress", details: { matricola: "STATED1" } });
    const v = staffView({ ...bundle, records });
    const t = recordTriad(rec(v, "university_registration"));
    expect(t.verified).toBeNull();
    expect(t.claimed.join(" ")).toContain("Matricola stated: STATED1");
  });

  it("award conferral verify is gated to admins with a plain reason", () => {
    const v = staffView(journeyB("procedure_done"), "rs-2026");
    const conferral = record("prog-b", "stu-syn-b", "award_conferral", {});
    const view = { ...conferral, label: "x", official: true, blockers: [] } as StaffRecordView;
    expect(verifyGate(view, "staff").enabled).toBe(false);
    expect(verifyGate(view, "staff").reason).toMatch(/administrator/);
    expect(verifyGate(view, "admin").enabled).toBe(true);
    expect(v.records.length).toBeGreaterThan(0);
  });

  it("legalization is computed from the issuing country, not residence", () => {
    const ng = legalizationLine(staffView(journeyB("eligibility")));
    expect(ng?.country).toBe("NG");
    expect(ng?.requirements).toEqual(["apostille"]);
    expect(ng?.text).toMatch(/issued in NG/);

    const bundle = journeyB("eligibility");
    const records = bundle.records.map((r) => (r.kind === "undergraduate_documents" ? { ...r, details: { issuingCountry: "DE" } } : r));
    const de = legalizationLine(staffView({ ...bundle, records }));
    expect(de?.requirements).toEqual([]);
    expect(de?.text).toMatch(/no apostille/);

    const none = legalizationLine(staffView({ ...bundle, records: bundle.records.map((r) => (r.kind === "undergraduate_documents" ? { ...r, details: {} } : r)) }));
    expect(none?.status).toBe("unknown_country");
    expect(legalizationLine(staffView(journeyA(), "rs-eneb"))).toBeNull();
  });

  it("verify body: empty strings become null, conferral date is only what staff typed, other kinds never send effectiveDate", () => {
    const v = staffView(journeyB("admitted"));
    const r = rec(v, "university_registration");
    const f = { ...verifyFormDefaults(r), issuingInstitution: "unimarconi", documentTypeLabel: "Registration certificate", documentReference: "REG-1", decisionDate: "2026-03-20", matricola: "SYN9", effectiveDate: "2026-04-01", note: "Checked the certificate" };
    const body = buildVerifyBody("university_registration", f);
    expect(body.effectiveDate).toBeNull();
    expect(body.details).toEqual({ matricola: "SYN9" });
    expect(body.outcome).toBeNull();
    expect(body.documentId).toBeNull();
    const conf = buildVerifyBody("award_conferral", { ...f, effectiveDate: "" });
    expect(conf.effectiveDate).toBeNull(); // never inferred
    expect(buildVerifyBody("award_conferral", { ...f, effectiveDate: "2026-10-18" }).effectiveDate).toBe("2026-10-18");
    expect(verifySubmitGate({ ...f, note: "ab" }).ok).toBe(false);
    expect(verifySubmitGate(f).ok).toBe(true);
  });

  it("parses a 422 into a plain-language missing list and does not call it success", () => {
    const err = new Error(`422: ${JSON.stringify({ error: { code: "GRADUATE_EVIDENCE_REQUIRED", message: "Evidence required", missing: ["MATRICOLA_REQUIRED", "ADMISSION_NOT_VERIFIED", "BOGUS"] } })}`);
    const f = parseApiFailure(err);
    expect(f.status).toBe(422);
    expect(f.missing).toEqual(["MATRICOLA_REQUIRED", "ADMISSION_NOT_VERIFIED"]);
    const s = failureSummary(f);
    expect(s.headline).toMatch(/Not saved/);
    expect(s.items.join(" ")).toMatch(/matricola/);
    expect(parseApiFailure(new Error("Network down")).status).toBe(0);
    expect(failureSummary(parseApiFailure(new Error("500: {\"error\":\"Internal server error\"}"))).items).toEqual([]);
  });

  it("tracking body never carries official fields and merges existing details", () => {
    const f = { ...emptyTrackForm("university_registration"), matricola: "M1", note: "Waiting" };
    const body = buildTrackBody(f, { issuingCountry: "NG" }, true) as Record<string, unknown>;
    expect(body).not.toHaveProperty("verificationStatus");
    expect(body).not.toHaveProperty("outcome");
    expect(body).not.toHaveProperty("decisionDate");
    expect(body.kind).toBe("university_registration");
    expect(body.details).toEqual({ issuingCountry: "NG", matricola: "M1" });
    expect(buildTrackBody({ ...f, matricola: "" }, { matricola: "OLD" }).details).toEqual({});
  });

  it("enroll gate requires a rule set of the chosen offering and builds the pinned body", () => {
    const sets = [RULE_SET_2025, RULE_SET_2026, RULE_SET_ENEB_ONLY];
    const base = { offeringId: "off-bdbi-uni", ruleSetId: "", enrollmentContractTitle: "", enrolledAt: "2026-10-26", priorBachelorSource: "external" };
    expect(enrollGate(base, sets).ok).toBe(false);
    expect(enrollGate({ ...base, ruleSetId: "rs-eneb" }, sets).reason).toMatch(/different offering/);
    expect(enrollGate({ ...base, ruleSetId: "rs-2026" }, sets).ok).toBe(true);
    expect(buildEnrollBody({ ...base, ruleSetId: "rs-2026" }, sets)).toMatchObject({ ruleSetId: "rs-2026", cohortLabel: "2026 intake", enrollmentContractTitle: null });
    expect(activeRuleSets(sets, "off-bdbi-uni").map((r) => r.id)).toEqual(["rs-2025", "rs-2026"]);
  });

  it("result and credit forms: verified result needs its authority and reference; conditional recognition needs conditions", () => {
    const f = { ...emptyResultForm("unimarconi"), verificationStatus: "verified" };
    expect(resultGate(f, "unimarconi").ok).toBe(false);
    expect(resultGate({ ...f, documentReference: "EX-1" }, "unimarconi").ok).toBe(true);
    expect(resultGate({ ...f, documentReference: "EX-1", issuingInstitution: "eneb" }, "unimarconi").ok).toBe(false);
    expect(buildResultBody({ ...f, gradeValue: "27", gradeScale: "30", documentReference: "EX-1" })).toMatchObject({ gradeValue: 27, gradeScale: 30, documentId: null });
    expect(buildResultBody(emptyResultForm("eneb")).gradeValue).toBeNull();

    const c = { ...emptyCreditForm("rec-1"), label: "Block", amount: "6", recognitionOutcome: "recognized_with_conditions" };
    expect(creditGate(c).ok).toBe(false);
    expect(creditGate({ ...c, conditions: "Pass Research Methods" }).ok).toBe(true);
    expect(buildCreditBody({ ...c, authority: "eneb_stated" }).recognitionOutcome).toBeNull();
    expect(creditGate({ ...c, amount: "" }).ok).toBe(false);
  });

  it("section layout hides university sections on an ENEB-only programme", () => {
    expect(sectionsForRoute("eneb_only").map((s) => s.key)).toEqual(["eneb", "questions"]);
    expect(sectionsForRoute("eneb_unimarconi").length).toBeGreaterThan(5);
  });

  it("paths are encoded", () => {
    expect(STAFF_GRADUATE_PATHS.workspace("a/b")).toBe("/api/admin/students/a%2Fb/graduate");
  });
});

describe("S12 staff graduate panel render", () => {
  it("renders the three-column triad, the unknown credit layer and the student preview", () => {
    const out = html(workspace([staffView(journeyB("recognition_requested"))]));
    expect(out).toContain("Graduate programmes");
    expect(out).toContain("Verified");
    expect(out).toContain("Claimed / reported");
    expect(out).toContain("Action required");
    expect(out).toContain("What the student sees");
    expect(out).toContain("Unknown"); // recognized credits unknown, not zero
    expect(out).toMatch(/Recognized by the university<\/span><span[^>]*>Unknown/);
    expect(out).toContain("(current)");
    expect(out).toMatch(/Degree issued in NG: apostille required/);
  });

  it("flags a superseded rule set and keeps the pinned terms visible", () => {
    const out = html(workspace([staffView(journeyB("registered", { ruleSet: RULE_SET_2025 }), "rs-2026")]));
    expect(out).toContain("superseded");
    expect(out).toContain("keeps its pinned terms");
  });

  it("renders an ENEB-only programme with no university records, title or registration", () => {
    const out = html(workspace([staffView(journeyA(), "rs-eneb")]));
    expect(out).toContain("ENEB only");
    expect(out).toContain("None. ENEB-only programme");
    expect(out).toContain("No university registration on this programme");
    expect(out).not.toContain("Recognition of earlier learning");
    expect(out).toContain("Not applicable");
  });

  it("shows the empty state and the enroll action", () => {
    const out = html({ studentId: "s", viewerRole: "staff", programs: [], offerings: OFFERINGS, ruleSets: [] });
    expect(out).toContain("not enrolled in a graduate programme");
    expect(out).toContain("Enroll in a programme");
    expect(renderToStaticMarkup(React.createElement(GraduateProgramReviewView, { workspace: { studentId: "s", viewerRole: "staff", programs: [], offerings: [], ruleSets: [] }, canEdit: false }))).not.toContain("Enroll in a programme");
  });

  it("verified records show reviewer and decision date; admin-only reason appears for staff on conferral", () => {
    const bundle = journeyB("procedure_done");
    bundle.records.push(record("prog-b", "stu-syn-b", "award_conferral", { trackingStatus: "in_progress" }));
    const out = html(workspace([staffView(bundle, "rs-2026")]));
    expect(out).toContain("Reviewed by staff-1");
    expect(out).toContain("administrator");
    const adminOut = html(workspace([buildStaffGraduateProgramView(bundle, "rs-2026", "admin")]), "admin");
    expect(adminOut).not.toContain("can only be confirmed by a Lumière administrator");
  });
});

describe("S12 staff topic decision", () => {
  it("builds a PATCH outcome body and the panel offers approve / request changes on thesis topics", async () => {
    const { buildTopicDecisionBody, canDecideTopic } = await import("@/components/admin/graduate-program-review-logic");
    expect(buildTopicDecisionBody("approved")).toEqual({ outcome: "approved" });
    expect(canDecideTopic({ kind: "thesis_topic" })).toBe(true);
    expect(canDecideTopic({ kind: "thesis_result" })).toBe(false);
    const out = html(workspace([staffView(journeyB("assessments"), "rs-2026")]));
    expect(out).toContain("Approve topic");
    expect(out).toContain("Request changes");
  });
});


// ---------------------------------------------------------------------------
// Synthetic evaluation fixtures
// ---------------------------------------------------------------------------

type EvalRow = StaffGraduateWorkspace["evaluations"][number];
function evaluation(over: Partial<CredentialEvaluationRecord> = {}, blockers: EvalRow["blockers"] = []): EvalRow {
  const base: CredentialEvaluationRecord = {
    id: "ev-1", studentId: "stu-syn-b", programId: "prog-b", evaluator: "wes_us", evaluatorName: null, destinationCountry: "US",
    qualificationEvaluated: "Master in Big Data and Business Intelligence", awardingInstitution: "unimarconi", intendedUse: "employment",
    evaluationType: "completed_report", status: "completed", reportDate: "2026-10-20", reportReference: "SYN-WES-1", documentId: null,
    conclusion: "masters_equivalent", conclusionText: "Synthetic: equivalent to a master's degree in the United States.",
    verificationStatus: "institution_stated", conflictingEvidence: null, reviewerUserId: null, reviewedAt: null, note: null,
    createdBy: "staff-1", createdAt: "2026-10-26T12:00:00.000Z", updatedAt: "2026-10-26T12:00:00.000Z", ...over,
  };
  return { ...base, view: buildEvaluationView(base), blockers };
}
const wsWith = (programs: ReturnType<typeof staffView>[], evaluations: EvalRow[], role: "staff" | "admin" = "staff"): StaffGraduateWorkspace => ({ ...workspace(programs), viewerRole: role, evaluations });

describe("S12 staff action queue (Needs a decision)", () => {
  const cats = (q: ReturnType<typeof buildActionQueue>) => q.map((i) => i.category);

  it("lists blocked official records with what is missing and a verify action", () => {
    const q = buildActionQueue(staffView(journeyB("admitted")));
    const reg = q.find((i) => i.title.startsWith("University registration"))!;
    expect(reg.category).toBe("record_blocked");
    expect(reg.detail).toMatch(/Missing before it can be verified/);
    expect(reg.detail).toMatch(/matricola|institution/i);
    expect(reg.target).toMatchObject({ t: "verify-record" });
    expect(reg.actionLabel).toBe("Verify…");
  });

  it("unverified subject results produce one grouped action per authority", () => {
    const q = buildActionQueue(staffView(journeyB("registered")));
    const subj = q.find((i) => i.category === "subjects_unverified")!;
    expect(subj.title).toBe("8 ENEB results stated by ENEB, not yet checked");
    expect(subj.detail).toBe("Verify against the ENEB transcript.");
    expect(subj.target).toMatchObject({ t: "anchor", anchor: "subjects", authority: "eneb" });
  });

  it("orders blocked records, subjects, tracking, conditional credit, questions, evaluations", () => {
    const bundle = journeyB("partial_recognition");
    bundle.records.push(record("prog-b", "stu-syn-b", "institutional_question", { trackingStatus: "in_progress", details: { question: "Which exam session?", owner: "Admissions" } }));
    bundle.records.push(record("prog-b", "stu-syn-b", "university_registration", { trackingStatus: "in_progress" }));
    const v = staffView(bundle);
    const q = buildActionQueue(v, [evaluation()]);
    const order = cats(q);
    const idx = (c: string) => order.indexOf(c as never);
    expect(idx("subjects_unverified")).toBeGreaterThan(-1);
    expect(idx("tracking")).toBeGreaterThan(idx("subjects_unverified"));
    expect(idx("conditional_credit")).toBeGreaterThan(idx("tracking"));
    expect(idx("question")).toBeGreaterThan(idx("conditional_credit"));
    expect(idx("evaluation")).toBe(order.length - 1);
    const rank = ["record_blocked", "record_ready", "record_claimed", "subjects_unverified", "tracking", "conditional_credit", "question", "evaluation"];
    expect(order.map((c) => rank.indexOf(c))).toEqual([...order.map((c) => rank.indexOf(c))].sort((a, b) => a - b));
    expect(q.find((i) => i.category === "conditional_credit")!.detail).toMatch(/Waiting on: Valid only if the Research Methods exam is passed/);
    expect(q.find((i) => i.category === "question")!.title).toMatch(/Which exam session/);
  });

  it("includes evaluations awaiting verification only when completed and unverified; unlinked ones are queued separately", () => {
    const v = staffView(journeyB("registered"));
    const linked = evaluation({ id: "ev-linked" });
    const planned = evaluation({ id: "ev-planned", status: "planned" });
    const done = evaluation({ id: "ev-done", verificationStatus: "verified", reviewerUserId: "staff-1", reviewedAt: "2026-10-26T12:00:00.000Z" });
    const loose = evaluation({ id: "ev-loose", programId: null });
    const q = buildActionQueue(v, [linked, planned, done, loose]);
    expect(q.filter((i) => i.category === "evaluation").map((i) => i.key)).toEqual(["ev-ev-linked"]);
    expect(unlinkedEvaluationQueue([linked, planned, done, loose], ["prog-b"]).map((i) => i.key)).toEqual(["ev-ev-loose"]);
    expect(q.find((i) => i.category === "evaluation")!.target).toEqual({ t: "verify-evaluation", evaluationId: "ev-linked" });
  });

  it("conferral verification is enabled only for admins", () => {
    const bundle = journeyB("procedure_done");
    bundle.records.push(record("prog-b", "stu-syn-b", "award_conferral", { trackingStatus: "in_progress" }));
    const staffItem = buildActionQueue(buildStaffGraduateProgramView(bundle, "rs-2026", "staff"), [], "staff").find((i) => i.title.includes("conferral"))!;
    const adminItem = buildActionQueue(buildStaffGraduateProgramView(bundle, "rs-2026", "admin"), [], "admin").find((i) => i.title.includes("conferral"))!;
    expect(staffItem.disabledReason).toMatch(/administrator/);
    expect(adminItem.disabledReason).toBeNull();
    const staffHtml = html(workspace([buildStaffGraduateProgramView(bundle, "rs-2026", "staff")]));
    expect(staffHtml).toMatch(/disabled=""[^>]*>Verify…/);
    const adminHtml = html(workspace([buildStaffGraduateProgramView(bundle, "rs-2026", "admin")]), "admin");
    expect(adminHtml).not.toContain("can only be confirmed by a Lumière administrator");
  });

  it("renders the block with its count and action buttons, and says so when nothing waits", () => {
    const out = html(workspace([staffView(journeyB("admitted"))]));
    expect(out).toContain('data-testid="needs-decision"');
    expect(out).toContain("Needs a decision");
    expect(out).toContain("8 ENEB results stated by ENEB, not yet checked");
    expect(out).toContain("Review results");
    const quiet = html(workspace([staffView(journeyA(), "rs-eneb")]));
    expect(quiet).toContain('data-testid="needs-decision-empty"');
  });
});

describe("S12 staff claimed-but-unverified items always carry an action", () => {
  it("every claimed record has a non-empty action, never an empty one", () => {
    for (const status of ["institution_stated", "evidence_received", "student_reported"] as const) {
      const bundle = journeyB("registered");
      const records = bundle.records.map((r) => (r.kind === "university_registration" ? { ...r, verificationStatus: status, issuingInstitution: "unimarconi" as const, trackingStatus: "in_progress" as const } : r));
      const r = staffView({ ...bundle, records }).records.find((x) => x.kind === "university_registration")!;
      expect(recordActions(r).length).toBeGreaterThan(0);
      expect(recordTriad(r).action.length).toBeGreaterThan(0);
    }
  });

  it("an official record with complete evidence still says to verify it against the document", () => {
    const bundle = journeyB("registered");
    const records = bundle.records.map((r) => (r.kind === "eligibility_review" ? { ...r, verificationStatus: "evidence_received" as const, reviewerUserId: null } : r));
    const r = staffView({ ...bundle, records }).records.find((x) => x.kind === "eligibility_review")!;
    expect(r.blockers).toEqual([]);
    expect(recordActions(r)[0]).toMatch(/^Verify against the/);
  });

  it("a stated ENEB transcript (tracking record) gets a check action and shows no 'nothing' text", () => {
    const v = staffView(journeyB("registered"));
    const t = rec(v, "eneb_transcript");
    expect(t.verificationStatus).toBe("institution_stated");
    expect(recordTriad(t).action.join(" ")).toMatch(/Check against the ENEB/);
  });

  it("unverified subject results are flagged with the right source document", () => {
    const v = staffView(journeyB("registered"));
    const s = v.subjects.find((x) => x.authority === "eneb")!;
    expect(subjectNeedsVerification(s)).toBe(true);
    const out = html(workspace([v]));
    expect(out).toContain("Action: Verify against the ENEB transcript.");
    expect(out).toContain("Verify result…");
  });

  it("the summary counts records and subjects, not only records", () => {
    const sum = programSummary(staffView(journeyB("registered")));
    expect(sum.subjectsAwaiting).toBe(8);
    expect(sum.needAction).toBe(sum.recordsAwaiting + 8);
    expect(sum.needAction).toBeGreaterThan(0);
    const out = html(workspace([staffView(journeyB("registered"))]));
    expect(out).not.toContain("0 in progress without verification");
    expect(out).toMatch(/9 awaiting verification|\d+ awaiting verification/);
    const verifiedOnly = programSummary(staffView(journeyA(), "rs-eneb"));
    expect(verifiedOnly.needAction).toBe(0);
  });
});

describe("S12 staff labels, collapsing and credits", () => {
  it("maps raw values to labels", () => {
    expect(outcomeLabel("partial")).toBe("Partly recognised");
    expect(outcomeLabel("full")).toBe("Fully recognised");
    expect(outcomeLabel("none")).toBe("Not recognised");
    expect(outcomeLabel("conditionally_admitted")).toBe("Conditionally admitted");
    expect(outcomeLabel(null)).toBe("No outcome recorded");
    expect(studentProgressText("submitted")).toBe("Student says: submitted");
    expect(trustBadge("verified")).toEqual({ label: "Verified", tone: "verified" });
    expect(trustBadge("institution_stated").tone).toBe("pending");
    expect(trustBadge("conflicting").tone).toBe("problem");
    const out = html(workspace([staffView(journeyB("partial_recognition"))]));
    expect(out).toContain("Partly recognised");
    expect(out).not.toContain("Outcome: partial");
    expect(out).not.toContain("student reports");
    expect(out).toContain("Student says: submitted");
  });

  it("collapses verified records to one line with an expand for detail", () => {
    const out = html(workspace([staffView(journeyB("partial_recognition"))]));
    expect(out).toContain('data-collapsed="true"');
    expect(out).toContain('data-testid="record-oneline"');
    expect(out).toMatch(/<details[^>]*>\s*<summary[^>]*data-testid="record-oneline"/);
    expect(out).toContain("Reviewed by staff-1"); // detail is in the expandable body
    expect(out).toMatch(/Università degli Studi Guglielmo Marconi · University recognition decision \(synthetic\) · ref\. SYN-RECOGNITION_DECISION · 2026-05-02 · reviewed by staff-1/);
    // Unverified records stay expanded as cards.
    expect(out).toMatch(/data-kind="university_registration"/);
  });

  it("lists credit entries once, grouped by authority, with conditions visible", () => {
    const v = staffView(journeyB("partial_recognition"));
    const groups = creditGroups(v);
    const recognized = groups.find((g) => g.authority === "university_recognized")!;
    expect(recognized.entries).toHaveLength(3);
    expect(recognized.conditionalText).toMatch(/6 ECTS of this only counts if its conditions are met/);
    const out = html(workspace([v]));
    expect(out.split(">Management block, 6 ECTS<").length - 1).toBe(1); // the entry is listed once; the queue only points at it
    expect(out).toContain("Condition: Valid only if the Research Methods exam is passed.");
    expect(out).toContain("Recognised with conditions");
    expect(out.split('data-testid="credit-entry"').length - 1).toBe(v.credits.length);
  });

  it("hides the UI1 tile when nothing is recorded and shows it when something is", () => {
    const v = staffView(journeyB("registered"));
    expect(creditGroups(v).map((g) => g.authority)).not.toContain("ui1_certified");
    expect(html(workspace([v]))).not.toContain("Universidad Isabel I");
    const bundle = journeyB("registered");
    const cert = record("prog-b", "stu-syn-b", "ui1_ects_certification", { verificationStatus: "verified", issuingInstitution: "ui1" });
    const withUi1 = staffView({ ...bundle, records: [...bundle.records, cert], credits: [...bundle.credits, credit("prog-b", cert.id, { authority: "ui1_certified", label: "UI1 block", amount: 12 })] });
    expect(creditGroups(withUi1).map((g) => g.authority)).toContain("ui1_certified");
  });
});

describe("S12 staff two-track summary", () => {
  it("shows ENEB and university tracks with real state", () => {
    const t = trackSummary(staffView(journeyB("partial_recognition")));
    expect(t.eneb.find((n) => n.key === "subjects")).toMatchObject({ state: "active", detail: "8 of 8 passed · 0 checked" });
    const uni = t.university!;
    expect(uni.find((n) => n.key === "registration")).toMatchObject({ state: "done" });
    expect(uni.find((n) => n.key === "recognition")!.detail).toContain("Partly recognised");
    expect(uni.find((n) => n.key === "conferral")!.state).toBe("todo");
    const out = html(workspace([staffView(journeyB("partial_recognition"))]));
    expect(out).toContain('data-testid="track-eneb"');
    expect(out).toContain('data-testid="track-university"');
  });

  it("marks the university track not applicable on an ENEB-only programme", () => {
    expect(trackSummary(staffView(journeyA(), "rs-eneb")).university).toBeNull();
    expect(html(workspace([staffView(journeyA(), "rs-eneb")]))).toMatch(/Not applicable\. This ENEB-only programme/);
  });
});

describe("S12 staff 422 dialog field marking", () => {
  it("maps guard codes to dialog fields and leaves non-field codes in the summary", () => {
    const e = fieldErrors(["DOCUMENT_REFERENCE_REQUIRED", "DECISION_DATE_REQUIRED", "MATRICOLA_REQUIRED", "ADMISSION_NOT_VERIFIED", "WRONG_ISSUER"]);
    expect(Object.keys(e).sort()).toEqual(["v-date", "v-docref", "v-issuer", "v-matricola"]);
    expect(e["v-matricola"][0]).toMatch(/matricola/);
    expect(fieldErrors(["REPORT_DATE_REQUIRED", "CONCLUSION_TEXT_REQUIRED", "STAFF_ONLY"], "evaluation")).toMatchObject({ "ev-date": expect.any(Array), "ev-conclusion-text": expect.any(Array) });
  });

  it("parses evaluation guard codes from a 422 (they are not record guard codes)", () => {
    const err = new Error(`422: ${JSON.stringify({ error: { code: "GRADUATE_EVIDENCE_REQUIRED", message: "x", missing: ["REPORT_DATE_REQUIRED", "NOT_COMPLETED", "BOGUS"] } })}`);
    const f = parseApiFailure(err);
    expect(f.missing).toEqual(["REPORT_DATE_REQUIRED", "NOT_COMPLETED"]);
    expect(failureSummary(f, "evaluation").items.join(" ")).toMatch(/date on the evaluation/);
  });
});

describe("S12 staff international credential evaluations block", () => {
  const wes = evaluation({ id: "ev-us" });
  const can = evaluation({ id: "ev-ca", evaluator: "wes_canada", destinationCountry: "CA", evaluationType: "preliminary_tool", status: "completed", conclusion: "other", conclusionText: "Synthetic tool wording." });
  const adv = evaluation({ id: "ev-adv", evaluator: "other", evaluatorName: "Synthetic Advisers", destinationCountry: "GB", evaluationType: "advisory_statement", status: "submitted", verificationStatus: "unknown", conclusion: "not_yet_known", conclusionText: null, reportDate: null, reportReference: null });

  it("treats a missing workspace.evaluations as empty and shows the framing and the never-changes note", () => {
    const w = { ...workspace([staffView()]) } as StaffGraduateWorkspace;
    const out = html(w);
    expect(out).toContain("International credential evaluations");
    expect(out).toContain(EVALUATION_FRAMING);
    expect(out).toContain("never changes ENEB or university rules, credits, recognition or graduation");
    expect(out).toContain("No foreign credential evaluation recorded");
    expect(out).toContain("Record evaluation…");
  });

  it("is placed after the programmes", () => {
    const out = html(wsWith([staffView()], [wes]));
    expect(out.indexOf('data-testid="graduate-program"')).toBeLessThan(out.indexOf('data-testid="evaluations-block"'));
  });

  it("labels preliminary vs completed and keeps WES U.S. and WES Canada distinct", () => {
    const out = html(wsWith([staffView()], [wes, can, adv]));
    expect(out).toContain("Preliminary — not an evaluation report");
    expect(out).toContain("Completed evaluation report");
    expect(out).toContain("Advisory statement — not an evaluation report");
    expect(out).toContain("WES U.S. (World Education Services, United States)");
    expect(out).toContain("WES Canada (World Education Services, Canada)");
    expect(out).toContain("Synthetic Advisers");
    expect(out).toMatch(/data-evaluator="wes_us"[^>]*data-preliminary="false"/);
    expect(out).toMatch(/data-evaluator="wes_canada"[^>]*data-preliminary="true"/);
    expect(out).toContain("United States (US)");
    expect(out).toContain("Canada (CA)");
    expect(evaluationRow(wes).evaluator).not.toBe(evaluationRow(can).evaluator);
  });

  it("shows qualification, use, status, date, conclusion with the evaluator's wording and the triad", () => {
    const out = html(wsWith([staffView()], [wes]));
    expect(out).toContain("Qualification evaluated: </dt><dd class=\"inline\">Master in Big Data and Business Intelligence");
    expect(out).toContain("Employment");
    expect(out).toContain("2026-10-20");
    expect(out).toContain("Master&#x27;s-level equivalent");
    expect(out).toContain("Synthetic: equivalent to a master&#x27;s degree in the United States.");
    expect(out).toContain("Stated, not yet checked");
    expect(out).toContain("Compare with the evaluator&#x27;s own report, then verify.");
  });

  it("shows blockers with EVALUATION_GUARD_MESSAGES and a Verify action only for completed unverified evaluations", () => {
    const blocked = evaluation({ id: "ev-b", reportDate: null, conclusionText: null }, ["REPORT_DATE_REQUIRED", "CONCLUSION_TEXT_REQUIRED"]);
    const r = evaluationRow(blocked);
    expect(r.action).toEqual(["Enter the date on the evaluation or tool result.", "Copy the evaluator's exact wording of the conclusion."]);
    expect(r.canVerify).toBe(true);
    expect(evaluationRow(adv).canVerify).toBe(false);
    const verified = evaluationRow(evaluation({ verificationStatus: "verified", reviewerUserId: "staff-1", reviewedAt: "2026-10-26T12:00:00.000Z" }));
    expect(verified.verified?.reviewer).toBe("staff-1");
    expect(verified.canVerify).toBe(false);
    expect(verified.action).toEqual([]);
  });

  it("queues unlinked evaluations awaiting verification in the evaluations block", () => {
    const out = html(wsWith([staffView()], [evaluation({ programId: null })]));
    expect(out).toMatch(/evaluation awaiting verification/);
  });

  it("presets and locks the destination country for fixed-country evaluators", () => {
    const f0 = emptyEvaluationForm();
    expect(setEvaluator({ ...f0, destinationCountry: "GB" }, "wes_canada").destinationCountry).toBe("CA");
    expect(setEvaluator(f0, "nuffic").destinationCountry).toBe("NL");
    expect(setEvaluator({ ...f0, destinationCountry: "GB" }, "ece").destinationCountry).toBe("GB"); // free
    const forced = buildEvaluationBody({ ...f0, evaluator: "wes_us", destinationCountry: "GB", qualificationEvaluated: "Master in Data" });
    expect(forced.destinationCountry).toBe("US");
    expect(evaluationConsistency({ evaluator: "wes_us", destinationCountry: forced.destinationCountry as string })).toEqual([]);
  });

  it("record form validates with the shared schema, and the update body of a verified evaluation carries only note and status", () => {
    const base = { ...emptyEvaluationForm(staffView()), qualificationEvaluated: "Master in Big Data and Business Intelligence" };
    expect(evaluationFormGate(base).ok).toBe(true);
    expect(evaluationFormGate({ ...base, qualificationEvaluated: "ab" }).ok).toBe(false);
    expect(evaluationFormGate({ ...base, evaluator: "other", evaluatorName: "" })).toMatchObject({ ok: false, reason: "Name the evaluator." });
    expect(buildEvaluationBody({ ...base, programId: "prog-b" }).programId).toBe("prog-b");
    const upd = evaluationUpdateDefaults(wes);
    expect(Object.keys(buildEvaluationUpdateBody(upd, true)).sort()).toEqual(["note", "status"]);
    expect(Object.keys(buildEvaluationUpdateBody(upd, false))).toContain("conclusionText");
    expect(buildEvaluationVerifyBody({ decision: "verified", conflictingEvidence: "ignored", note: " Checked report " })).toEqual({ decision: "verified", conflictingEvidence: null, note: "Checked report" });
    expect(evaluateEvaluationVerification(wes, { decision: "verified", conflictingEvidence: null, note: "ok" }, "staff").allowed).toBe(true);
  });

  it("paths for the evaluation endpoints are encoded", () => {
    expect(STAFF_GRADUATE_PATHS.recordEvaluation("a/b")).toBe("/api/admin/students/a%2Fb/graduate/evaluations");
    expect(STAFF_GRADUATE_PATHS.verifyEvaluation("e 1")).toBe("/api/admin/graduate/evaluations/e%201/verify");
  });
});
