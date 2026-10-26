/**
 * S12 — synthetic graduate-program fixtures. SYNTHETIC DATA ONLY.
 *
 * Nobody here is a real student. Journey A is a de-identified ENEB-only
 * graduate modelled on the historical case (MBA + Master in Big Data and
 * Business Intelligence, 18 ENEB subjects, 8.9/10 average) with NO university
 * records. Journey B is a synthetic Unimarconi-route student at several stages.
 * Subject titles are generic placeholders, not ENEB's authenticated module list.
 */
import type {
  CohortRule,
  CreditEntryRecord,
  GraduateProgramBundle,
  GraduateProgramRecord,
  GraduateRecord,
  OfferingRecord,
  RecordKind,
  RuleSetRecord,
  SubjectRecord,
} from "../../shared/graduate-program-contract";

const T0 = "2026-10-26T12:00:00.000Z";

// ---------------------------------------------------------------- offerings
const offering = (o: Partial<OfferingRecord> & Pick<OfferingRecord, "id" | "key" | "category" | "route" | "marketingTitle" | "awardingInstitution">): OfferingRecord => ({
  alternativeMarketingTitles: [],
  universityLegalTitle: null,
  universityLegalTitleStatus: "unknown",
  qualificationClassification: "unknown",
  classificationStatus: "unknown",
  programVersion: "2026.1",
  publishedDurationMonths: null,
  publishedEcts: 60,
  evidenceNote: "Advertised as 60 ECTS in ENEB's August 2026 terms (Art. 19). Module allocation not authenticated.",
  createdAt: T0,
  ...o,
});

/** The four university-linked categories from ENEB's August 2026 terms (titles as advertised, unverified). */
export const OFFERINGS: readonly OfferingRecord[] = [
  offering({ id: "off-mba-uni", key: "unimarconi-mba", category: "mba", route: "eneb_unimarconi", marketingTitle: "MBA — Master of Business Administration", awardingInstitution: "unimarconi", qualificationClassification: "university_first_level_master", classificationStatus: "institution_stated" }),
  offering({ id: "off-bdbi-uni", key: "unimarconi-big-data-bi", category: "big_data_bi", route: "eneb_unimarconi", marketingTitle: "Master in Big Data and Business Intelligence", alternativeMarketingTitles: ["Máster en Big Data & Business Intelligence"], awardingInstitution: "unimarconi", qualificationClassification: "university_first_level_master", classificationStatus: "institution_stated" }),
  offering({ id: "off-smm-uni", key: "unimarconi-sales-marketing", category: "sales_marketing", route: "eneb_unimarconi", marketingTitle: "Master in Sales Management and Marketing", awardingInstitution: "unimarconi", qualificationClassification: "university_first_level_master", classificationStatus: "institution_stated" }),
  offering({ id: "off-hr-uni", key: "unimarconi-hr-talent", category: "hr_talent", route: "eneb_unimarconi", marketingTitle: "Master in Human Resources Management and Talent Management", awardingInstitution: "unimarconi", qualificationClassification: "university_first_level_master", classificationStatus: "institution_stated" }),
  offering({ id: "off-mba-bdbi-eneb", key: "eneb-mba-big-data-bi", category: "mba", route: "eneb_only", marketingTitle: "MBA + Master in Big Data and Business Intelligence", awardingInstitution: "eneb", qualificationClassification: "eneb_private_qualification", classificationStatus: "institution_stated", publishedEcts: null, evidenceNote: "ENEB private qualification. No university award." }),
];

// ---------------------------------------------------------------- rule sets
const SRC_TERMS_2026 = { title: "ENEB Terms and Conditions, August 2026 (as summarized in the owner's research audit of 26 Oct 2026)", reference: "Art. 19", date: "2026-08-01" };
const SRC_TESTIMONY = { title: "Earlier participant account (owner's research audit, 26 Oct 2026)", reference: null, date: null };
const SRC_AUDIT = { title: "ENEB → Unimarconi independent audit, 26 Oct 2026", reference: null, date: "2026-10-26" };

const COMMON_RULES: CohortRule[] = [
  { key: "curriculum", value: { modules: null, creditUnit: "ECTS" }, source: SRC_AUDIT, basis: "unverified", verifiedAt: null },
  { key: "recognition_mechanism", value: { mechanism: "university_decision_required", description: "ENEB's own Art. 12 recognition does not apply. Only a written university decision recognizes earlier learning." }, source: SRC_AUDIT, basis: "research_finding", verifiedAt: null },
  { key: "undergraduate_document_legalization", value: { euIssued: [], nonEuIssued: ["apostille"], notes: "Configurable. Confirm with the university for each issuing country." }, source: SRC_AUDIT, basis: "unverified", verifiedAt: null },
  { key: "graduation_procedure", value: { description: "Final formalities as set by the university. Details to be confirmed.", inPerson: null }, source: SRC_AUDIT, basis: "unverified", verifiedAt: null },
  { key: "extension", value: { available: null, description: "Extension rules to be confirmed for this cohort." }, source: SRC_AUDIT, basis: "unverified", verifiedAt: null },
];

export const RULE_SET_2025: RuleSetRecord = {
  id: "rs-2025",
  offeringId: "off-bdbi-uni",
  cohortLabel: "2025 intake",
  version: 1,
  effectiveFrom: "2025-01-01",
  status: "active",
  supersedesId: null,
  note: "Historical arrangement. Comprehensive final exam reported by a participant; not confirmed.",
  createdBy: "admin-1",
  createdAt: T0,
  rules: [
    ...COMMON_RULES,
    { key: "examination_structure", value: { mode: "comprehensive_final", description: "One comprehensive final exam of roughly 135 questions, as reported by an earlier participant.", approxQuestionCount: 135 }, source: SRC_TESTIMONY, basis: "participant_testimony", verifiedAt: null },
    { key: "academic_period", value: { minMonths: null, maxMonths: null, description: "Academic period to be confirmed for the 2025 intake." }, source: SRC_AUDIT, basis: "unverified", verifiedAt: null },
    { key: "thesis", value: { required: true, minWords: null, passingThreshold: null, resubmissionFee: null, originalityCheck: null, notes: "Thesis rules for 2025 not confirmed." }, source: SRC_AUDIT, basis: "unverified", verifiedAt: null },
  ],
};

export const RULE_SET_2026: RuleSetRecord = {
  id: "rs-2026",
  offeringId: "off-bdbi-uni",
  cohortLabel: "2026 intake",
  version: 2,
  effectiveFrom: "2026-08-01",
  status: "active",
  supersedesId: null,
  note: "From ENEB's August 2026 terms. Contractual research findings, not confirmed university policy.",
  createdBy: "admin-1",
  createdAt: T0,
  rules: [
    ...COMMON_RULES,
    { key: "examination_structure", value: { mode: "subject_exams", description: "An exam for each subject.", approxQuestionCount: null }, source: SRC_TERMS_2026, basis: "contractual_term", verifiedAt: null },
    { key: "passing_threshold", value: { value: 6, scale: 10 }, source: SRC_TERMS_2026, basis: "contractual_term", verifiedAt: null },
    { key: "academic_period", value: { minMonths: null, maxMonths: null, description: "12 months as advertised; university minimum period to be confirmed." }, source: SRC_TERMS_2026, basis: "contractual_term", verifiedAt: null },
    { key: "thesis", value: { required: true, minWords: 12000, passingThreshold: { value: 6, scale: 10 }, resubmissionFee: { amount: 99, currency: "EUR" }, originalityCheck: true, notes: null }, source: SRC_TERMS_2026, basis: "contractual_term", verifiedAt: null },
  ],
};

export const RULE_SET_ENEB_ONLY: RuleSetRecord = {
  id: "rs-eneb",
  offeringId: "off-mba-bdbi-eneb",
  cohortLabel: "2024 intake",
  version: 1,
  effectiveFrom: "2024-01-01",
  status: "active",
  supersedesId: null,
  note: null,
  createdBy: "admin-1",
  createdAt: T0,
  rules: [
    { key: "examination_structure", value: { mode: "subject_exams", description: "Assessment for each ENEB subject.", approxQuestionCount: null }, source: { title: "Synthetic ENEB enrollment terms", reference: null, date: null }, basis: "contractual_term", verifiedAt: null },
    { key: "passing_threshold", value: { value: 5, scale: 10 }, source: { title: "Synthetic ENEB enrollment terms", reference: null, date: null }, basis: "contractual_term", verifiedAt: null },
    { key: "academic_period", value: { minMonths: null, maxMonths: null, description: "Self-paced within the ENEB enrollment period." }, source: { title: "Synthetic ENEB enrollment terms", reference: null, date: null }, basis: "contractual_term", verifiedAt: null },
    { key: "thesis", value: { required: false, minWords: null, passingThreshold: null, resubmissionFee: null, originalityCheck: null, notes: null }, source: { title: "Synthetic ENEB enrollment terms", reference: null, date: null }, basis: "contractual_term", verifiedAt: null },
  ],
};

export const RULE_SETS: readonly RuleSetRecord[] = [RULE_SET_2025, RULE_SET_2026, RULE_SET_ENEB_ONLY];

// ---------------------------------------------------------------- builders
let seq = 0;
const id = (p: string) => `${p}-${++seq}`;

export function subject(programId: string, s: Partial<SubjectRecord> & Pick<SubjectRecord, "title" | "authority">): SubjectRecord {
  return {
    id: id("sub"),
    programId,
    moduleCode: null,
    statedCredits: null,
    creditUnit: null,
    assessmentType: "subject_exam",
    sortOrder: 0,
    studentProgress: "not_started",
    resultStatus: "none",
    gradeValue: null,
    gradeScale: null,
    gradeDisplay: null,
    issuingInstitution: null,
    verificationStatus: "unknown",
    documentId: null,
    documentReference: null,
    reassessmentCount: 0,
    correctionCount: 0,
    recordedBy: null,
    recordedAt: null,
    ...s,
  };
}

export function record(programId: string, studentId: string, kind: RecordKind, r: Partial<GraduateRecord> = {}): GraduateRecord {
  return {
    id: id("rec"),
    programId,
    studentId,
    kind,
    trackingStatus: "in_progress",
    verificationStatus: "unknown",
    outcome: null,
    issuingInstitution: null,
    documentTypeLabel: null,
    documentReference: null,
    documentId: null,
    decisionDate: null,
    effectiveDate: null,
    effectiveCohort: null,
    academicConsequence: null,
    conflictingEvidence: null,
    details: {},
    reviewerUserId: null,
    reviewedAt: null,
    note: null,
    createdBy: "staff-1",
    createdAt: T0,
    updatedAt: T0,
    ...r,
  };
}

/** A verified official record with full evidence. */
export function verified(programId: string, studentId: string, kind: RecordKind, issuer: GraduateRecord["issuingInstitution"], r: Partial<GraduateRecord> = {}): GraduateRecord {
  return record(programId, studentId, kind, {
    trackingStatus: "completed",
    verificationStatus: "verified",
    issuingInstitution: issuer,
    documentTypeLabel: "Synthetic official document",
    documentReference: `SYN-${kind.toUpperCase()}`,
    decisionDate: "2026-09-01",
    reviewerUserId: "staff-1",
    reviewedAt: T0,
    ...r,
  });
}

export function credit(programId: string, recordId: string, c: Partial<CreditEntryRecord> & Pick<CreditEntryRecord, "authority" | "label" | "amount">): CreditEntryRecord {
  return { id: id("cr"), programId, recordId, subjectId: null, unit: "ECTS", recognitionOutcome: null, conditions: null, createdBy: "staff-1", createdAt: T0, ...c };
}

const program = (p: Partial<GraduateProgramRecord> & Pick<GraduateProgramRecord, "id" | "offeringId" | "ruleSetId" | "route" | "cohortLabel">): GraduateProgramRecord => ({
  studentId: "stu-syn-1",
  enrollmentContractTitle: null,
  enrolledAt: "2026-01-15",
  enebStatus: "in_progress",
  priorBachelorSource: "unknown",
  createdBy: "staff-1",
  createdAt: T0,
  updatedAt: T0,
  ...p,
});

const GENERIC_TITLES = [
  "Strategic Management", "Financial Accounting", "Marketing Management", "Operations Management", "Organizational Behaviour",
  "Corporate Finance", "Leadership", "Business Analytics", "Data Warehousing", "Data Visualization", "Machine Learning for Business",
  "Big Data Architecture", "Business Intelligence Tools", "Statistics for Managers", "Project Management", "Digital Transformation",
  "Entrepreneurship", "Business Ethics",
];

// ---------------------------------------------------------------- Journey A: ENEB-only graduate (de-identified)
export function journeyA(): GraduateProgramBundle {
  const p = program({ id: "prog-a", studentId: "stu-syn-a", offeringId: "off-mba-bdbi-eneb", ruleSetId: "rs-eneb", route: "eneb_only", cohortLabel: "2024 intake", enebStatus: "completed", enrollmentContractTitle: "MBA + Master in Big Data and Business Intelligence", priorBachelorSource: "lumiere", enrolledAt: "2024-02-01" });
  // 18 subjects averaging 8.9/10.
  const grades = [9.2, 8.8, 9.0, 8.5, 9.1, 8.7, 9.3, 8.6, 9.0, 8.9, 8.8, 9.0, 8.7, 9.1, 8.9, 8.8, 9.0, 8.8];
  const subjects = GENERIC_TITLES.map((title, i) =>
    subject(p.id, {
      title,
      authority: "eneb",
      sortOrder: i,
      studentProgress: "submitted",
      resultStatus: "passed",
      gradeValue: grades[i],
      gradeScale: 10,
      gradeDisplay: `${grades[i].toFixed(1)}/10`,
      issuingInstitution: "eneb",
      verificationStatus: "verified",
      documentReference: "SYN-ENEB-TRANSCRIPT",
      recordedBy: "staff-1",
      recordedAt: T0,
    }),
  );
  const transcript = verified(p.id, p.studentId, "eneb_transcript", "eneb", { details: { grade: "8.9/10 average" } });
  const records = [
    transcript,
    verified(p.id, p.studentId, "eneb_completion", "eneb", { outcome: "completed", decisionDate: "2025-06-30" }),
    verified(p.id, p.studentId, "eneb_certificate", "eneb", { decisionDate: "2025-07-15", details: { degreeTitle: "MBA + Master in Big Data and Business Intelligence (ENEB)" } }),
    record(p.id, p.studentId, "institutional_question", { trackingStatus: "completed", details: { question: "Separate specialization certificate recorded as an ENEB document only." } }),
  ];
  return {
    program: p,
    offering: OFFERINGS.find((o) => o.id === p.offeringId)!,
    ruleSet: RULE_SET_ENEB_ONLY,
    subjects,
    records,
    credits: [credit(p.id, transcript.id, { authority: "eneb_stated", label: "ENEB transcript total (as stated by ENEB)", amount: 60 })],
    documents: [],
  };
}

// ---------------------------------------------------------------- Journey B: Unimarconi route, staged
export type JourneyBStage = "eligibility" | "admitted" | "registered" | "recognition_requested" | "partial_recognition" | "assessments" | "thesis_submitted" | "thesis_passed" | "procedure_done" | "conferred" | "complete";

export const JOURNEY_B_STAGES: readonly JourneyBStage[] = ["eligibility", "admitted", "registered", "recognition_requested", "partial_recognition", "assessments", "thesis_submitted", "thesis_passed", "procedure_done", "conferred", "complete"];

export function journeyB(stage: JourneyBStage, opts: { ruleSet?: RuleSetRecord } = {}): GraduateProgramBundle {
  const at = (s: JourneyBStage) => JOURNEY_B_STAGES.indexOf(stage) >= JOURNEY_B_STAGES.indexOf(s);
  const ruleSet = opts.ruleSet ?? RULE_SET_2026;
  const p = program({ id: "prog-b", studentId: "stu-syn-b", offeringId: "off-bdbi-uni", ruleSetId: ruleSet.id, route: "eneb_unimarconi", cohortLabel: ruleSet.cohortLabel, enrollmentContractTitle: "Master in Big Data and Business Intelligence", enebStatus: "coursework_complete", priorBachelorSource: "external" });
  const sid = p.studentId;
  const records: GraduateRecord[] = [];
  const credits: CreditEntryRecord[] = [];

  records.push(verified(p.id, sid, "eligibility_review", "lumiere", { outcome: "eligible", decisionDate: "2026-02-01" }));
  records.push(
    at("admitted")
      ? verified(p.id, sid, "undergraduate_documents", "other", { documentId: "doc-degree", details: { issuingCountry: "NG", degreeTitle: "Synthetic BSc Business" } })
      : record(p.id, sid, "undergraduate_documents", { trackingStatus: "in_progress", details: { issuingCountry: "NG" } }),
  );
  if (at("admitted")) {
    records.push(verified(p.id, sid, "document_legalization", "other", { documentTypeLabel: "Apostille", documentId: "doc-apostille" }));
    records.push(record(p.id, sid, "university_application", { trackingStatus: "completed" }));
    records.push(verified(p.id, sid, "university_admission", "unimarconi", { outcome: "admitted", decisionDate: "2026-03-10" }));
  }
  records.push(
    at("registered")
      ? verified(p.id, sid, "university_registration", "unimarconi", { decisionDate: "2026-03-20", details: { matricola: "SYN000123" } })
      : record(p.id, sid, "university_registration", { trackingStatus: at("admitted") ? "in_progress" : "not_started" }),
  );

  const enebSubjects = GENERIC_TITLES.slice(0, 8).map((title, i) =>
    subject(p.id, { title, authority: "eneb", sortOrder: i, studentProgress: "submitted", resultStatus: "passed", gradeValue: 8, gradeScale: 10, gradeDisplay: "8/10", issuingInstitution: "eneb", verificationStatus: "institution_stated", documentReference: "SYN-ENEB-TRANSCRIPT" }),
  );
  const uniTitles = ["Advanced Data Governance", "Business Intelligence Strategy", "Research Methods"];
  const uniSubjects = uniTitles.map((title, i) =>
    subject(p.id, {
      title,
      authority: "unimarconi",
      sortOrder: 100 + i,
      studentProgress: at("assessments") ? "submitted" : i === 0 && at("partial_recognition") ? "in_progress" : "not_started",
      resultStatus: at("assessments") ? "passed" : "none",
      gradeValue: at("assessments") ? 27 : null,
      gradeScale: at("assessments") ? 30 : null,
      gradeDisplay: at("assessments") ? "27/30" : null,
      issuingInstitution: at("assessments") ? "unimarconi" : null,
      verificationStatus: at("assessments") ? "verified" : "unknown",
      documentReference: at("assessments") ? "SYN-UNI-EXAM" : null,
      reassessmentCount: at("assessments") && i === 2 ? 1 : 0,
    }),
  );

  const enebTranscript = verified(p.id, sid, "eneb_transcript", "eneb", { trackingStatus: "completed", verificationStatus: "institution_stated" });
  records.push(enebTranscript);
  credits.push(credit(p.id, enebTranscript.id, { authority: "eneb_stated", label: "ENEB subjects completed (as stated by ENEB)", amount: 32 }));

  if (at("recognition_requested")) {
    const req = record(p.id, sid, "recognition_request", { trackingStatus: "submitted", issuingInstitution: "lumiere" });
    records.push(req);
    credits.push(credit(p.id, req.id, { authority: "recognition_requested", label: "ENEB subjects submitted for recognition", amount: 32 }));
  }
  if (at("partial_recognition")) {
    const dec = verified(p.id, sid, "recognition_decision", "unimarconi", { outcome: "partial", decisionDate: "2026-05-02", documentTypeLabel: "University recognition decision (synthetic)", academicConsequence: "Three university subjects and the thesis remain." });
    records.push(dec);
    credits.push(credit(p.id, dec.id, { authority: "university_recognized", label: "Business analytics block", amount: 18, recognitionOutcome: "recognized" }));
    credits.push(credit(p.id, dec.id, { authority: "university_recognized", label: "Management block", amount: 6, recognitionOutcome: "recognized_with_conditions", conditions: "Valid only if the Research Methods exam is passed." }));
    credits.push(credit(p.id, dec.id, { authority: "university_recognized", label: "Marketing Management", amount: 6, recognitionOutcome: "not_recognized" }));
  }

  records.push(
    record(p.id, sid, "thesis_topic", {
      trackingStatus: at("assessments") ? "completed" : "in_progress",
      outcome: at("assessments") ? "approved" : null,
      details: {
        topic: "Data governance maturity in mid-sized European retailers",
        supervisor: at("assessments") ? "Synthetic academic contact" : undefined,
        milestones: [
          { label: "Outline", due: "2026-06-01", done: at("assessments") },
          { label: "Literature review", due: "2026-07-15", done: at("thesis_submitted") },
          { label: "Full draft", due: "2026-09-01", done: at("thesis_submitted") },
        ],
      },
    }),
  );
  if (at("thesis_submitted")) records.push(record(p.id, sid, "thesis_submission", { trackingStatus: "submitted", decisionDate: "2026-09-20", details: { wordCount: 12850, originalityConfirmed: true, deadline: "2026-09-30" } }));
  if (at("thesis_passed")) records.push(verified(p.id, sid, "thesis_result", "unimarconi", { outcome: "passed", decisionDate: "2026-10-05", details: { grade: "8/10" } }));
  if (at("procedure_done")) {
    records.push(record(p.id, sid, "time_requirement", { trackingStatus: "completed", effectiveDate: "2026-10-01" }));
    records.push(record(p.id, sid, "graduation_procedure", { trackingStatus: "completed", details: { ceremonyDate: "2026-10-15" } }));
  }
  if (at("conferred")) {
    const conferral = verified(p.id, sid, "award_conferral", "unimarconi", { outcome: "conferred", decisionDate: "2026-10-20", effectiveDate: "2026-10-18", reviewerUserId: "admin-1" });
    records.push(conferral);
    records.push(record(p.id, sid, "diploma_ordered", { trackingStatus: "completed" }));
  }
  if (at("complete")) {
    const transcript = verified(p.id, sid, "official_transcript", "unimarconi", { decisionDate: "2026-10-22" });
    records.push(transcript);
    credits.push(credit(p.id, transcript.id, { authority: "university_awarded", label: "Official university transcript total", amount: 60 }));
    records.push(verified(p.id, sid, "diploma_issued", "unimarconi", { decisionDate: "2026-10-24" }));
    records.push(record(p.id, sid, "diploma_delivered", { trackingStatus: "completed" }));
    records.push(verified(p.id, sid, "credential_verification", "unimarconi", { outcome: "confirmed", decisionDate: "2026-10-25" }));
  }
  if (!at("registered")) records.push(record(p.id, sid, "institutional_question", { trackingStatus: "in_progress", details: { question: "Confirm the university-approved module list for this cohort.", owner: "Admissions" } }));

  return {
    program: p,
    offering: OFFERINGS.find((o) => o.id === p.offeringId)!,
    ruleSet,
    subjects: [...enebSubjects, ...uniSubjects],
    records,
    credits,
    documents: [
      { id: "doc-degree", fileName: "bachelor-degree-certificate.pdf", status: "verified" },
      { id: "doc-apostille", fileName: "apostille.pdf", status: "verified" },
    ],
  };
}

// ---------------------------------------------------------------- foreign credential evaluations (synthetic)
import type { CredentialEvaluationRecord } from "../../shared/graduate-program-contract";

/**
 * SYNTHETIC evaluations for screens and tests. The wording says so explicitly: these are
 * not real evaluator outcomes and must never be read as evidence about the pathway.
 */
export function syntheticEvaluations(studentId = "stu-syn-b", programId: string | null = "prog-b"): CredentialEvaluationRecord[] {
  const base = {
    studentId,
    programId,
    evaluatorName: null,
    qualificationEvaluated: "Master universitario di primo livello in Big Data and Business Intelligence (synthetic)",
    awardingInstitution: "unimarconi" as const,
    documentId: null,
    conflictingEvidence: null,
    note: null,
    createdBy: "staff-1",
    createdAt: T0,
    updatedAt: T0,
  };
  return [
    {
      ...base,
      id: "ev-wes-us-tool",
      evaluator: "wes_us",
      destinationCountry: "US",
      intendedUse: "employment",
      evaluationType: "preliminary_tool",
      status: "completed",
      reportDate: "2026-10-20",
      reportReference: "Tool screenshot (synthetic)",
      conclusion: "masters_equivalent",
      conclusionText: "SYNTHETIC FIXTURE: tool indicated a master's-level equivalent. Not a real result.",
      verificationStatus: "evidence_received",
      reviewerUserId: null,
      reviewedAt: null,
    },
    {
      ...base,
      id: "ev-wes-ca-report",
      evaluator: "wes_canada",
      destinationCountry: "CA",
      intendedUse: "immigration",
      evaluationType: "completed_report",
      status: "in_progress",
      reportDate: null,
      reportReference: null,
      conclusion: "not_yet_known",
      conclusionText: null,
      verificationStatus: "unknown",
      reviewerUserId: null,
      reviewedAt: null,
    },
  ];
}
