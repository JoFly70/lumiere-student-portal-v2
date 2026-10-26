import { describe, expect, it } from "vitest";
import {
  GUARD_CODES,
  GUARD_MESSAGES,
  OFFICIAL_RECORD_KINDS,
  RECORD_KINDS,
  REQUIRED_ISSUERS,
  UNIVERSITY_RECORD_KINDS,
  buildStaffGraduateProgramView,
  buildStudentGraduateProgramView,
  createCreditEntrySchema,
  createOfferingSchema,
  createRuleSetSchema,
  enrollProgramSchema,
  evaluateCreditEntry,
  evaluateOfficialChange,
  findRule,
  isOfficialKind,
  legalizationRequirements,
  recordSubjectResultSchema,
  trackRecordSchema,
  verifyRecordSchema,
  type GraduateRecord,
  type GuardActorRole,
  type RecordKind,
  type VerifyRecord,
} from "../shared/graduate-program-contract";
import { RULE_SET_2025, RULE_SET_2026, credit, journeyA, journeyB, record, verified } from "./helpers/s12-graduate-fixtures";

const verifyBody = (over: Partial<VerifyRecord> = {}): VerifyRecord =>
  verifyRecordSchema.parse({ decision: "verified", note: "Checked the document", ...over });

const ctx = (bundle: ReturnType<typeof journeyB>, role: GuardActorRole, existing: GraduateRecord | null = null, document: { studentId: string; status: string } | null = null) => ({
  actorRole: role,
  program: bundle.program,
  existing,
  siblings: bundle.records,
  document,
});

const full = (kind: RecordKind, issuer: VerifyRecord["issuingInstitution"], over: Partial<VerifyRecord> = {}) =>
  verifyBody({ issuingInstitution: issuer, documentTypeLabel: "Official document", documentReference: "REF-1", decisionDate: "2026-09-01", ...over });

describe("S12 evidence guard", () => {
  it("every guard code has a plain-language message", () => {
    for (const c of GUARD_CODES) expect(GUARD_MESSAGES[c]).toMatch(/\S/);
  });

  it("only staff and admin can change an official status; student and coach cannot", () => {
    const b = journeyB("admitted");
    for (const role of ["student", "coach"] as const) {
      const r = evaluateOfficialChange("university_registration", full("university_registration", "unimarconi"), ctx(b, role));
      expect(r).toEqual({ allowed: false, missing: ["STAFF_ONLY"] });
    }
  });

  it("verified needs issuer, document type, reference-or-document, and a decision date", () => {
    const b = journeyB("eligibility");
    const r = evaluateOfficialChange("eligibility_review", verifyBody({ outcome: "eligible" }), ctx(b, "staff"));
    expect(r.allowed).toBe(false);
    expect(r.missing).toEqual(expect.arrayContaining(["ISSUER_REQUIRED", "DOCUMENT_TYPE_REQUIRED", "DOCUMENT_REFERENCE_REQUIRED", "DECISION_DATE_REQUIRED"]));
    const ok = evaluateOfficialChange("eligibility_review", full("eligibility_review", "lumiere", { outcome: "eligible" }), ctx(b, "staff"));
    expect(ok).toEqual({ allowed: true, missing: [] });
  });

  it("a document from the wrong institution cannot establish a university status", () => {
    const b = journeyB("admitted");
    for (const issuer of ["eneb", "lumiere", "ui1", "other"] as const) {
      const r = evaluateOfficialChange("university_admission", full("university_admission", issuer, { outcome: "admitted" }), ctx(b, "staff"));
      expect(r.missing).toContain("WRONG_ISSUER");
    }
    expect(evaluateOfficialChange("university_admission", full("university_admission", "unimarconi", { outcome: "admitted" }), ctx(b, "staff")).allowed).toBe(true);
  });

  it("every university official kind rejects every non-listed issuer", () => {
    const b = journeyB("complete");
    for (const kind of OFFICIAL_RECORD_KINDS) {
      for (const issuer of ["eneb", "unimarconi", "ui1", "lumiere", "verification_service", "other"] as const) {
        const r = evaluateOfficialChange(kind, full(kind, issuer), ctx(b, "admin"));
        const listed = (REQUIRED_ISSUERS[kind] as readonly string[]).includes(issuer);
        expect(r.missing.includes("WRONG_ISSUER")).toBe(!listed);
      }
    }
  });

  it("ENEB-only programmes cannot carry any university official change", () => {
    const a = journeyA();
    const universityOfficial = OFFICIAL_RECORD_KINDS.filter((k) => (UNIVERSITY_RECORD_KINDS as readonly string[]).includes(k));
    expect(universityOfficial.length).toBeGreaterThan(5);
    for (const kind of universityOfficial) {
      const r = evaluateOfficialChange(kind, full(kind, "unimarconi"), { actorRole: "admin", program: a.program, existing: null, siblings: a.records, document: null });
      expect(r).toEqual({ allowed: false, missing: ["ROUTE_HAS_NO_UNIVERSITY"] });
    }
    // ENEB records on an ENEB-only programme are fine.
    expect(evaluateOfficialChange("eneb_certificate", full("eneb_certificate", "eneb"), { actorRole: "staff", program: a.program, existing: null, siblings: a.records, document: null }).allowed).toBe(true);
  });

  it("registration needs the matricola and a verified admission first (not just tracked)", () => {
    const eligibility = journeyB("eligibility");
    const r = evaluateOfficialChange("university_registration", full("university_registration", "unimarconi"), ctx(eligibility, "staff"));
    expect(r.missing).toEqual(expect.arrayContaining(["MATRICOLA_REQUIRED", "ADMISSION_NOT_VERIFIED"]));
    const admitted = journeyB("admitted");
    const ok = evaluateOfficialChange("university_registration", full("university_registration", "unimarconi", { details: { matricola: "SYN1" } }), ctx(admitted, "staff"));
    expect(ok.allowed).toBe(true);
    // a refused admission does not unlock registration
    const refused = { ...admitted, records: admitted.records.map((x) => (x.kind === "university_admission" ? { ...x, outcome: "refused" } : x)) };
    expect(evaluateOfficialChange("university_registration", full("university_registration", "unimarconi", { details: { matricola: "SYN1" } }), ctx(refused, "staff")).missing).toContain("ADMISSION_NOT_VERIFIED");
  });

  it("recognition decision, transcript and diploma need verified registration", () => {
    const admitted = journeyB("admitted");
    for (const kind of ["recognition_decision", "official_transcript", "diploma_issued"] as const) {
      const r = evaluateOfficialChange(kind, full(kind, "unimarconi", kind === "recognition_decision" ? { outcome: "partial" } : {}), ctx(admitted, "staff"));
      expect(r.missing).toContain("REGISTRATION_NOT_VERIFIED");
    }
    const reg = journeyB("registered");
    expect(evaluateOfficialChange("recognition_decision", full("recognition_decision", "unimarconi", { outcome: "partial" }), ctx(reg, "staff")).allowed).toBe(true);
  });

  it("outcomes are validated per kind; a null outcome is never invented", () => {
    const reg = journeyB("registered");
    expect(evaluateOfficialChange("recognition_decision", full("recognition_decision", "unimarconi"), ctx(reg, "staff")).missing).toContain("OUTCOME_REQUIRED");
    expect(evaluateOfficialChange("recognition_decision", full("recognition_decision", "unimarconi", { outcome: "maybe" }), ctx(reg, "staff")).missing).toContain("OUTCOME_INVALID");
    expect(evaluateOfficialChange("official_transcript", full("official_transcript", "unimarconi", { outcome: "full" }), ctx(reg, "staff")).missing).toContain("OUTCOME_INVALID");
  });

  it("award conferral is admin-only and needs the conferral date from the document (never the ceremony)", () => {
    const b = journeyB("procedure_done");
    expect(b.records.find((r) => r.kind === "graduation_procedure")?.details.ceremonyDate).toBe("2026-10-15");
    const staff = evaluateOfficialChange("award_conferral", full("award_conferral", "unimarconi", { outcome: "conferred", effectiveDate: "2026-10-18" }), ctx(b, "staff"));
    expect(staff.missing).toContain("ADMIN_ONLY");
    const noDate = evaluateOfficialChange("award_conferral", full("award_conferral", "unimarconi", { outcome: "conferred" }), ctx(b, "admin"));
    expect(noDate.missing).toContain("CONFERRAL_DATE_REQUIRED");
    // supplying a ceremony date inside details does not satisfy the conferral date
    const ceremonyOnly = evaluateOfficialChange("award_conferral", full("award_conferral", "unimarconi", { outcome: "conferred", details: { ceremonyDate: "2026-10-15" } }), ctx(b, "admin"));
    expect(ceremonyOnly.missing).toContain("CONFERRAL_DATE_REQUIRED");
    const ok = evaluateOfficialChange("award_conferral", full("award_conferral", "unimarconi", { outcome: "conferred", effectiveDate: "2026-10-18" }), ctx(b, "admin"));
    expect(ok).toEqual({ allowed: true, missing: [] });
  });

  it("undergraduate documents: issuing country required; attached document must be the student's own and verified", () => {
    const b = journeyB("eligibility");
    const bare = full("undergraduate_documents", "lumiere");
    const existing = { ...record(b.program.id, b.program.studentId, "undergraduate_documents"), details: {} } as GraduateRecord;
    expect(evaluateOfficialChange("undergraduate_documents", bare, ctx(b, "staff", existing)).missing).toContain("ISSUING_COUNTRY_REQUIRED");
    const withCountry = full("undergraduate_documents", "lumiere", { details: { issuingCountry: "NG" }, documentId: "doc-1" });
    expect(evaluateOfficialChange("undergraduate_documents", withCountry, ctx(b, "staff", existing, { studentId: b.program.studentId, status: "pending" })).missing).toContain("DOCUMENT_NOT_VERIFIED");
    expect(evaluateOfficialChange("undergraduate_documents", withCountry, ctx(b, "staff", existing, { studentId: "someone-else", status: "verified" })).missing).toContain("DOCUMENT_NOT_OWNED");
    expect(evaluateOfficialChange("undergraduate_documents", withCountry, ctx(b, "staff", existing, null)).missing).toContain("DOCUMENT_NOT_OWNED");
    expect(evaluateOfficialChange("undergraduate_documents", withCountry, ctx(b, "staff", existing, { studentId: b.program.studentId, status: "verified" })).allowed).toBe(true);
  });

  it("rejected / conflicting / evidence_received are lighter but still staff-only; conflicting needs detail", () => {
    const b = journeyB("admitted");
    expect(evaluateOfficialChange("university_registration", verifyBody({ decision: "evidence_received" }), ctx(b, "staff")).allowed).toBe(true);
    expect(evaluateOfficialChange("university_registration", verifyBody({ decision: "rejected" }), ctx(b, "staff")).allowed).toBe(true);
    expect(evaluateOfficialChange("university_registration", verifyBody({ decision: "conflicting" }), ctx(b, "staff")).missing).toEqual(["CONFLICT_DETAIL_REQUIRED"]);
    expect(evaluateOfficialChange("university_registration", verifyBody({ decision: "evidence_received" }), ctx(b, "student")).allowed).toBe(false);
  });

  it("tracking-only kinds cannot be verified", () => {
    const b = journeyB("registered");
    for (const kind of RECORD_KINDS.filter((k) => !isOfficialKind(k))) {
      expect(evaluateOfficialChange(kind, full(kind, "unimarconi"), ctx(b, "admin")).missing).toEqual(["NOT_AN_OFFICIAL_KIND"]);
    }
  });

  it("track schema has no way to set verification, outcome or dates", () => {
    expect(trackRecordSchema.safeParse({ verificationStatus: "verified" }).success).toBe(false);
    expect(trackRecordSchema.safeParse({ outcome: "admitted" }).success).toBe(false);
    expect(trackRecordSchema.safeParse({ decisionDate: "2026-01-01" }).success).toBe(false);
    expect(trackRecordSchema.safeParse({ effectiveDate: "2026-01-01" }).success).toBe(false);
    expect(trackRecordSchema.safeParse({ trackingStatus: "completed", note: "ok" }).success).toBe(true);
  });
});

describe("S12 credit layers (never summed across authorities)", () => {
  const base = journeyB("partial_recognition");
  const dec = base.records.find((r) => r.kind === "recognition_decision")!;
  const req = base.records.find((r) => r.kind === "recognition_request")!;
  const enebTranscript = base.records.find((r) => r.kind === "eneb_transcript")!;

  it("recognized credits need a verified university decision as backing", () => {
    expect(evaluateCreditEntry({ authority: "university_recognized", recognitionOutcome: "recognized" }, { actorRole: "staff", route: "eneb_unimarconi", backing: dec }).allowed).toBe(true);
    expect(evaluateCreditEntry({ authority: "university_recognized", recognitionOutcome: "recognized" }, { actorRole: "staff", route: "eneb_unimarconi", backing: req }).missing).toContain("BACKING_RECORD_REQUIRED");
    expect(evaluateCreditEntry({ authority: "university_recognized", recognitionOutcome: "recognized" }, { actorRole: "staff", route: "eneb_unimarconi", backing: enebTranscript }).missing).toContain("BACKING_RECORD_REQUIRED");
    expect(evaluateCreditEntry({ authority: "university_recognized", recognitionOutcome: "recognized" }, { actorRole: "staff", route: "eneb_unimarconi", backing: null }).missing).toContain("BACKING_RECORD_REQUIRED");
    const unverified = { ...dec, verificationStatus: "evidence_received" } as GraduateRecord;
    expect(evaluateCreditEntry({ authority: "university_recognized", recognitionOutcome: "recognized" }, { actorRole: "staff", route: "eneb_unimarconi", backing: unverified }).missing).toContain("BACKING_RECORD_NOT_VERIFIED");
    expect(evaluateCreditEntry({ authority: "university_recognized", recognitionOutcome: null }, { actorRole: "staff", route: "eneb_unimarconi", backing: dec }).missing).toContain("OUTCOME_REQUIRED");
  });

  it("ENEB-stated credits are backed only by ENEB records; a request is not a recognition", () => {
    expect(evaluateCreditEntry({ authority: "eneb_stated", recognitionOutcome: null }, { actorRole: "staff", route: "eneb_unimarconi", backing: enebTranscript }).allowed).toBe(true);
    expect(evaluateCreditEntry({ authority: "eneb_stated", recognitionOutcome: null }, { actorRole: "staff", route: "eneb_unimarconi", backing: dec }).missing).toContain("BACKING_RECORD_REQUIRED");
    expect(evaluateCreditEntry({ authority: "recognition_requested", recognitionOutcome: null }, { actorRole: "staff", route: "eneb_unimarconi", backing: req }).allowed).toBe(true);
    expect(evaluateCreditEntry({ authority: "recognition_requested", recognitionOutcome: "recognized" }, { actorRole: "staff", route: "eneb_unimarconi", backing: req }).missing).toContain("OUTCOME_INVALID");
  });

  it("university credits are impossible on an ENEB-only programme; students cannot create credits", () => {
    const a = journeyA();
    const t = a.records.find((r) => r.kind === "eneb_transcript")!;
    expect(evaluateCreditEntry({ authority: "university_awarded", recognitionOutcome: null }, { actorRole: "admin", route: "eneb_only", backing: t }).missing).toEqual(["ROUTE_HAS_NO_UNIVERSITY"]);
    expect(evaluateCreditEntry({ authority: "eneb_stated", recognitionOutcome: null }, { actorRole: "student", route: "eneb_only", backing: t }).missing).toEqual(["STAFF_ONLY"]);
  });

  it("conditional recognition must state its conditions", () => {
    const base = { authority: "university_recognized", recordId: "r", label: "Block", amount: 6, unit: "ECTS" };
    expect(createCreditEntrySchema.safeParse({ ...base, recognitionOutcome: "recognized_with_conditions" }).success).toBe(false);
    expect(createCreditEntrySchema.safeParse({ ...base, recognitionOutcome: "recognized_with_conditions", conditions: "Pass Research Methods" }).success).toBe(true);
  });

  it("projection: layers stay separate, partial decision keeps its conditions, missing decision is unknown not zero", () => {
    const v = buildStudentGraduateProgramView(base);
    const layer = (a: string) => v.credits.find((c) => c.authority === a)!;
    expect(layer("eneb_stated")).toMatchObject({ amount: 32, state: "recorded" });
    expect(layer("recognition_requested")).toMatchObject({ amount: 32 });
    // 18 + 6 recognized (the not_recognized 6 is excluded) and never added to the ENEB figure
    expect(layer("university_recognized")).toMatchObject({ amount: 24, state: "recorded" });
    expect(layer("university_awarded")).toMatchObject({ amount: null, state: "unknown" });
    const items = v.previousLearning!.decision!.items;
    expect(items.find((i) => i.conditions)).toMatchObject({ outcome: "Recognized with conditions", conditions: "Valid only if the Research Methods exam is passed." });
    expect(items.some((i) => i.outcome === "Not recognized")).toBe(true);

    const early = buildStudentGraduateProgramView(journeyB("recognition_requested"));
    const rec = early.credits.find((c) => c.authority === "university_recognized")!;
    expect(rec.amount).toBeNull();
    expect(rec.state).toBe("unknown");
    expect(rec.explanation).toMatch(/not zero and not a refusal/);
    expect(early.previousLearning?.requestState).toBe("under_review");
    expect(early.previousLearning?.decision).toBeNull();
  });

  it("a verified 'none' decision is a real zero and is distinguishable from unknown", () => {
    const b = journeyB("partial_recognition");
    const records = b.records.map((r) => (r.kind === "recognition_decision" ? { ...r, outcome: "none" } : r));
    const v = buildStudentGraduateProgramView({ ...b, records, credits: b.credits.filter((c) => c.authority !== "university_recognized") });
    expect(v.credits.find((c) => c.authority === "university_recognized")).toMatchObject({ amount: 0, state: "recorded" });
  });

  it("credit entries of different authorities are never combined in one layer", () => {
    const b = journeyB("partial_recognition");
    const extra = credit(b.program.id, "x", { authority: "ui1_certified", label: "UI1 certificate", amount: 60 });
    const v = buildStudentGraduateProgramView({ ...b, credits: [...b.credits, extra] });
    expect(v.credits.find((c) => c.authority === "ui1_certified")?.amount).toBe(60);
    expect(v.credits.find((c) => c.authority === "eneb_stated")?.amount).toBe(32);
  });
});

describe("S12 legalization is keyed on the issuing country", () => {
  const rule = findRule(RULE_SET_2026.rules, "undergraduate_document_legalization")!.value;
  it("non-EU issuing country needs apostille; EU does not; unknown country is unknown", () => {
    expect(legalizationRequirements(rule, "NG")).toEqual({ status: "resolved", requirements: ["apostille"] });
    expect(legalizationRequirements(rule, "ng").requirements).toEqual(["apostille"]);
    expect(legalizationRequirements(rule, "IT")).toEqual({ status: "resolved", requirements: [] });
    expect(legalizationRequirements(rule, "US").requirements).toEqual(["apostille"]);
    expect(legalizationRequirements(rule, null)).toEqual({ status: "unknown_country", requirements: [] });
    expect(legalizationRequirements(null, "NG").status).toBe("no_rule");
  });
  it("is configurable per rule set", () => {
    const strict = { euIssued: ["sworn_translation"], nonEuIssued: ["apostille", "declaration_of_value"] } as const;
    expect(legalizationRequirements({ ...strict, euIssued: [...strict.euIssued], nonEuIssued: [...strict.nonEuIssued] }, "FR").requirements).toEqual(["sworn_translation"]);
  });
  it("student pending-document prompt follows the issuing country, not anything about residence", () => {
    const eligible = journeyB("eligibility");
    const nonEu = buildStudentGraduateProgramView(eligible);
    expect(nonEu.pendingDocuments.map((d) => d.key)).toContain("document_legalization");
    const eu = buildStudentGraduateProgramView({ ...eligible, records: eligible.records.map((r) => (r.kind === "undergraduate_documents" ? { ...r, details: { issuingCountry: "ES" } } : r)) });
    expect(eu.pendingDocuments.map((d) => d.key)).not.toContain("document_legalization");
  });
});

describe("S12 projection principles", () => {
  it("ENEB-only graduate: qualification confirmed, no university layer, no graduation block (R01/R10 shape)", () => {
    const v = buildStudentGraduateProgramView(journeyA());
    expect(v.route).toBe("eneb_only");
    expect(v.enebQualification).toMatchObject({ state: "completed_verified", certificateIssued: true });
    expect(v.registration.state).toBe("not_applicable");
    expect(v.graduation).toBeNull();
    expect(v.previousLearning).toBeNull();
    expect(v.titleNote).toBeNull();
    expect(v.universityRelationship).toMatch(/not a university degree/);
    expect(v.credits.filter((c) => c.state === "not_applicable").map((c) => c.authority)).toEqual(["recognition_requested", "university_recognized", "university_awarded"]);
    expect(v.progress).toMatchObject({ enebSubjectsPassed: 18, enebSubjectsTotal: 18 });
  });

  it("completed academic work does not confer an award; only a verified conferral does (R10)", () => {
    const done = buildStudentGraduateProgramView(journeyB("procedure_done"));
    expect(done.graduation?.academicWorkComplete).toBe(true);
    expect(done.graduation?.awardConferred).toBe(false);
    expect(done.graduation?.conferredOn).toBeNull();
    expect(done.graduation?.explanation).toMatch(/only when the university formally confers/);
    expect(done.nextStep.title).toMatch(/confer your degree/);
    const conferred = buildStudentGraduateProgramView(journeyB("conferred"));
    expect(conferred.graduation).toMatchObject({ awardConferred: true, conferredOn: "2026-10-18" });
  });

  it("ceremony date is shown as ceremony, and is not the conferral date (R11)", () => {
    const v = buildStudentGraduateProgramView(journeyB("conferred"));
    const proc = v.graduation!.milestones.find((m) => m.key === "procedure")!;
    const conf = v.graduation!.milestones.find((m) => m.key === "conferral")!;
    expect(proc.date).toBe("2026-10-15");
    expect(conf.date).toBe("2026-10-18");
    expect(proc.official).toBe(false);
    expect(conf.official).toBe(true);
    const before = buildStudentGraduateProgramView(journeyB("procedure_done")).graduation!.milestones.find((m) => m.key === "conferral")!;
    expect(before.date).toBeNull();
    expect(before.state).toBe("waiting");
  });

  it("diploma order is distinct from issuance (R12)", () => {
    const ordered = buildStudentGraduateProgramView(journeyB("conferred")).graduation!.milestones.find((m) => m.key === "diploma")!;
    expect(ordered.official).toBe(false);
    expect(ordered.detail).toMatch(/order is not an issued diploma/i);
    const issued = buildStudentGraduateProgramView(journeyB("complete")).graduation!.milestones.find((m) => m.key === "diploma")!;
    expect(issued).toMatchObject({ official: true, state: "done" });
  });

  it("a submitted thesis is not a passed thesis (R09)", () => {
    const sub = buildStudentGraduateProgramView(journeyB("thesis_submitted"));
    expect(sub.thesis).toMatchObject({ gradingStatus: "submitted", result: null });
    expect(sub.nextStep.title).toMatch(/being graded/);
    const milestone = sub.graduation!.milestones.find((m) => m.key === "thesis")!;
    expect(milestone.state).toBe("not_started");
    expect(milestone.detail).toMatch(/Submitting is not the same as passing/);
    const passed = buildStudentGraduateProgramView(journeyB("thesis_passed"));
    expect(passed.thesis).toMatchObject({ gradingStatus: "graded", result: { outcome: "passed", official: true } });
  });

  it("an unverified thesis result is not shown as graded", () => {
    const b = journeyB("thesis_passed");
    const records = b.records.map((r) => (r.kind === "thesis_result" ? { ...r, verificationStatus: "evidence_received" as const } : r));
    const v = buildStudentGraduateProgramView({ ...b, records });
    expect(v.thesis?.result).toBeNull();
    expect(v.graduation?.academicWorkComplete).toBe(false);
  });

  it("subject exams and thesis are tracked independently (R08)", () => {
    const b = journeyB("assessments");
    const v = buildStudentGraduateProgramView(b);
    expect(v.progress.universitySubjectsPassed).toBe(3);
    expect(v.thesis?.gradingStatus).toBe("not_submitted");
    expect(v.graduation?.academicWorkComplete).toBe(false);
    const subs = b.subjects.map((s) => ({ ...s, resultStatus: "none" as const }));
    const noSubjects = buildStudentGraduateProgramView({ ...b, subjects: subs, records: journeyB("thesis_passed").records });
    expect(noSubjects.thesis?.gradingStatus).toBe("graded");
    expect(noSubjects.graduation?.academicWorkComplete).toBe(false);
  });

  it("different cohorts carry different examination requirements; a pinned rule set does not follow a newer version (R07)", () => {
    const a = buildStudentGraduateProgramView(journeyB("registered", { ruleSet: RULE_SET_2025 }));
    const b = buildStudentGraduateProgramView(journeyB("registered", { ruleSet: RULE_SET_2026 }));
    expect(a.assessment.mode).toBe("Comprehensive final exam");
    expect(a.assessment.basis).toMatch(/not confirmed|Reported by an earlier participant/);
    expect(b.assessment.mode).toBe("An exam for each subject");
    expect(a.cohortLabel).toBe("2025 intake");
    expect(b.cohortLabel).toBe("2026 intake");
    const staff = buildStaffGraduateProgramView(journeyB("registered", { ruleSet: RULE_SET_2025 }), RULE_SET_2026.id, "staff");
    expect(staff.ruleSetIsCurrent).toBe(false);
    expect(staff.ruleSet.id).toBe("rs-2025");
  });

  it("rule values are validated, and every rule carries a source and basis", () => {
    const bad = createRuleSetSchema.safeParse({ cohortLabel: "x", effectiveFrom: "2026-01-01", rules: [{ key: "thesis", value: { required: "yes" }, source: { title: "s" }, basis: "unverified", verifiedAt: null }] });
    expect(bad.success).toBe(false);
    for (const r of RULE_SET_2026.rules) {
      expect(r.source.title).toMatch(/\S/);
      expect(r.basis).toMatch(/\S/);
    }
    const dup = createRuleSetSchema.safeParse({
      cohortLabel: "x", effectiveFrom: "2026-01-01",
      rules: [RULE_SET_2026.rules[0], RULE_SET_2026.rules[0]],
    });
    expect(dup.success).toBe(false);
  });

  it("the university-approved module list is unknown, so the student sees no verified-requirement total", () => {
    const v = buildStudentGraduateProgramView(journeyB("assessments"));
    expect(findRule(RULE_SET_2026.rules, "curriculum")!.value.modules).toBeNull();
    expect(v.progress.verifiedRequirements).toBeNull();
    expect(v.progress.statement).toMatch(/still being confirmed/);
  });

  it("an unverified university title is described as pending, a verified one is shown", () => {
    const b = journeyB("registered");
    expect(buildStudentGraduateProgramView(b).titleNote).toMatch(/still being confirmed/);
    const verifiedOffering = { ...b.offering, universityLegalTitle: "Synthetic Official Master Title", universityLegalTitleStatus: "verified" as const };
    expect(buildStudentGraduateProgramView({ ...b, offering: verifiedOffering }).titleNote).toBe("University title: Synthetic Official Master Title");
  });

  it("student next step never claims university status before evidence", () => {
    expect(buildStudentGraduateProgramView(journeyB("eligibility")).registration.state).toBe("not_started");
    const admitted = buildStudentGraduateProgramView(journeyB("admitted"));
    expect(admitted.registration.state).toBe("in_progress");
    expect(admitted.registration.matricola).toBeNull();
    expect(buildStudentGraduateProgramView(journeyB("registered")).registration).toMatchObject({ state: "verified", matricola: "SYN000123" });
  });

  it("staff projection: blockers explain what is missing for every unverified official record", () => {
    const v = buildStaffGraduateProgramView(journeyB("admitted"), "rs-2026", "staff");
    const reg = v.records.find((r) => r.kind === "university_registration")!;
    expect(reg.official).toBe(true);
    expect(reg.blockers).toEqual(expect.arrayContaining(["ISSUER_REQUIRED", "MATRICOLA_REQUIRED"]));
    const verifiedRecordView = v.records.find((r) => r.kind === "university_admission")!;
    expect(verifiedRecordView.blockers).toEqual([]);
    expect(v.records.find((r) => r.kind === "thesis_topic")!.official).toBe(false);
    expect(v.openQuestions.length).toBe(1);
    expect(buildStaffGraduateProgramView(journeyB("registered"), "rs-2026", "staff").openQuestions.length).toBe(0);
        const admin = buildStaffGraduateProgramView(journeyB("procedure_done"), "rs-2026", "staff");
    expect(admin.studentView.nextStep.title).toMatch(/confer/);
  });

  it("verified ENEB certificate stays an ENEB item: no university record or credit is created", () => {
    const a = journeyA();
    expect(a.records.some((r) => (UNIVERSITY_RECORD_KINDS as readonly string[]).includes(r.kind))).toBe(false);
    expect(a.credits.every((c) => c.authority === "eneb_stated")).toBe(true);
  });
});

describe("S12 input schemas", () => {
  it("enroll accepts only offering + rule set + cohort and no subjects/credits", () => {
    expect(enrollProgramSchema.safeParse({ offeringId: "o", ruleSetId: "r", cohortLabel: "2026", enrolledAt: "2026-10-26" }).success).toBe(true);
    expect(enrollProgramSchema.safeParse({ offeringId: "o", ruleSetId: "r", cohortLabel: "2026", enrolledAt: "2026-10-26", subjects: [] }).success).toBe(false);
  });
  it("student-reported or institution-stated results cannot carry 'rejected' or 'unknown' states", () => {
    const base = { resultStatus: "passed", gradeValue: 8, gradeScale: 10, gradeDisplay: "8/10", issuingInstitution: "eneb" };
    expect(recordSubjectResultSchema.safeParse({ ...base, verificationStatus: "student_reported" }).success).toBe(false);
    expect(recordSubjectResultSchema.safeParse({ ...base, verificationStatus: "verified" }).success).toBe(true);
  });
  it("a verified university title needs the title", () => {
    const o = { key: "abc-master", category: "mba", route: "eneb_unimarconi", marketingTitle: "X", awardingInstitution: "unimarconi", programVersion: "1" };
    expect(createOfferingSchema.safeParse({ ...o, universityLegalTitleStatus: "verified" }).success).toBe(false);
    expect(createOfferingSchema.safeParse({ ...o, universityLegalTitleStatus: "verified", universityLegalTitle: "Official title" }).success).toBe(true);
  });
  it("verified fixture records satisfy their own guard (fixtures are consistent)", () => {
    const b = journeyB("complete");
    for (const r of b.records.filter((x) => x.verificationStatus === "verified" && isOfficialKind(x.kind) && x.kind !== "award_conferral")) {
      expect(REQUIRED_ISSUERS[r.kind as keyof typeof REQUIRED_ISSUERS]).toContain(r.issuingInstitution);
    }
    expect(verified("p", "s", "eneb_certificate", "eneb").verificationStatus).toBe("verified");
  });
});
