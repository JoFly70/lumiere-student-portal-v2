import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  buildStaffGraduateProgramView,
  type StaffGraduateWorkspace,
  type StaffRecordView,
} from "@shared/graduate-program-contract";
import { OFFERINGS, RULE_SET_2025, RULE_SET_2026, RULE_SET_ENEB_ONLY, journeyA, journeyB, record } from "./helpers/s12-graduate-fixtures";

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
} from "@/components/admin/graduate-program-review-logic";

const staffView = (bundle = journeyB("registered"), current: string | null = bundle.ruleSet.id) => buildStaffGraduateProgramView(bundle, current, "staff");
const rec = (v: ReturnType<typeof staffView>, kind: string) => v.records.find((r) => r.kind === kind) as StaffRecordView;
const workspace = (programs: ReturnType<typeof staffView>[]): StaffGraduateWorkspace => ({ studentId: "stu-syn-b", programs, offerings: OFFERINGS, ruleSets: [RULE_SET_2025, RULE_SET_2026, RULE_SET_ENEB_ONLY] });
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
    expect(out).toContain("Recognized by the university: Unknown");
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
    const out = html({ studentId: "s", programs: [], offerings: OFFERINGS, ruleSets: [] });
    expect(out).toContain("not enrolled in a graduate programme");
    expect(out).toContain("Enroll in a programme");
    expect(renderToStaticMarkup(React.createElement(GraduateProgramReviewView, { workspace: { studentId: "s", programs: [], offerings: [], ruleSets: [] }, canEdit: false }))).not.toContain("Enroll in a programme");
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
