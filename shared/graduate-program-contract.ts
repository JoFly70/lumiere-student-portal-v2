/**
 * S12 — Graduate programs contract (ENEB, Unimarconi-linked route).
 *
 * Single source of truth for the postgraduate pathway: vocabulary, cohort rule
 * sets, the evidence guard that decides which OFFICIAL status changes are
 * allowed, and the read models the student and staff screens render.
 *
 * Governing principles (docs/s12/S12-graduate-programs.md):
 *  - ENEB records and Unimarconi records are different things. Nothing in the
 *    ENEB column ever creates, implies or fills anything in the university
 *    column. ENEB enrollment is not university registration; ENEB grades are
 *    not recognized university credits; ENEB completion is not a university
 *    award.
 *  - Credit authorities are kept apart and never summed across authorities.
 *  - A missing university decision is UNKNOWN, never zero and never a refusal.
 *  - Official university states (admission, registration, recognition,
 *    conferral, transcript, diploma issued, credential verification) can only
 *    be set by staff, from a document of the correct issuing institution, with
 *    its reference and decision date. Ordinary tracking is never blocked.
 *  - Cohort rules are versioned. An enrollment keeps the rule-set version it
 *    accepted; later terms are never applied retrospectively.
 *  - Research findings are evidence, not binding university policy; each rule
 *    carries its source, basis and verification date.
 *
 * No tuition, invoicing or payment concepts live here (ClientDesk owns them).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const INSTITUTIONS = ["eneb", "unimarconi", "ui1", "lumiere", "verification_service", "other"] as const;
export type Institution = (typeof INSTITUTIONS)[number];

export const INSTITUTION_LABEL: Record<Institution, string> = {
  eneb: "ENEB",
  unimarconi: "Università degli Studi Guglielmo Marconi",
  ui1: "Universidad Isabel I",
  lumiere: "Lumière",
  verification_service: "Credential verification service",
  other: "Other institution",
};

export const ROUTES = ["eneb_only", "eneb_unimarconi"] as const;
export type GraduateRoute = (typeof ROUTES)[number];

export const OFFERING_CATEGORIES = ["mba", "big_data_bi", "sales_marketing", "hr_talent", "other"] as const;
export type OfferingCategory = (typeof OFFERING_CATEGORIES)[number];

export const QUALIFICATION_CLASSIFICATIONS = [
  "eneb_private_qualification",
  "university_first_level_master",
  "unknown",
] as const;
export type QualificationClassification = (typeof QUALIFICATION_CLASSIFICATIONS)[number];

/**
 * Verification of a claim or record. Only `verified` is official. `unknown`
 * means no evidence either way (never "zero" or "refused").
 */
export const VERIFICATION_STATUSES = [
  "unknown",
  "student_reported",
  "institution_stated",
  "evidence_received",
  "verified",
  "rejected",
  "conflicting",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** How strong the basis for a cohort rule is. Research is evidence, not policy. */
export const RULE_BASES = [
  "verified_university_policy",
  "contractual_term",
  "research_finding",
  "participant_testimony",
  "unverified",
] as const;
export type RuleBasis = (typeof RULE_BASES)[number];

export const RULE_BASIS_LABEL: Record<RuleBasis, string> = {
  verified_university_policy: "Verified university policy",
  contractual_term: "Term in the enrollment contract",
  research_finding: "Research finding, not confirmed by the university",
  participant_testimony: "Reported by an earlier participant, not confirmed",
  unverified: "Not yet verified",
};

// ---------------------------------------------------------------------------
// Cohort rule sets (versioned, immutable once created)
// ---------------------------------------------------------------------------

export const RULE_KEYS = [
  "curriculum",
  "examination_structure",
  "passing_threshold",
  "thesis",
  "academic_period",
  "extension",
  "graduation_procedure",
  "recognition_mechanism",
  "undergraduate_document_legalization",
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

const ruleSourceSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    reference: z.string().trim().max(300).nullable().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .strict();

const scoreSchema = z.object({ value: z.number().min(0), scale: z.number().positive() }).strict();

export const LEGALIZATION_REQUIREMENTS = ["apostille", "legalization", "sworn_translation", "declaration_of_value"] as const;
export type LegalizationRequirement = (typeof LEGALIZATION_REQUIREMENTS)[number];

export const ruleValueSchemas = {
  /** `modules: null` = the university-approved module structure is not authenticated. Never invent codes or credits. */
  curriculum: z
    .object({
      modules: z
        .array(
          z
            .object({
              title: z.string().trim().min(1).max(200),
              moduleCode: z.string().trim().max(60).nullable(),
              credits: z.number().min(0).nullable(),
            })
            .strict(),
        )
        .nullable(),
      creditUnit: z.enum(["ECTS", "CFU"]).nullable(),
    })
    .strict(),
  examination_structure: z
    .object({
      mode: z.enum(["subject_exams", "comprehensive_final", "unknown"]),
      description: z.string().trim().max(1000),
      approxQuestionCount: z.number().int().positive().nullable().optional(),
    })
    .strict(),
  passing_threshold: scoreSchema.nullable(),
  thesis: z
    .object({
      required: z.boolean().nullable(),
      minWords: z.number().int().positive().nullable(),
      passingThreshold: scoreSchema.nullable(),
      /** Informational only. The portal never invoices; ClientDesk does. */
      resubmissionFee: z.object({ amount: z.number().min(0), currency: z.string().length(3) }).strict().nullable(),
      originalityCheck: z.boolean().nullable(),
      notes: z.string().trim().max(1000).nullable().optional(),
    })
    .strict(),
  academic_period: z
    .object({
      minMonths: z.number().int().positive().nullable(),
      maxMonths: z.number().int().positive().nullable(),
      description: z.string().trim().max(1000),
    })
    .strict(),
  extension: z.object({ available: z.boolean().nullable(), description: z.string().trim().max(1000) }).strict(),
  graduation_procedure: z.object({ description: z.string().trim().max(1000), inPerson: z.boolean().nullable() }).strict(),
  recognition_mechanism: z
    .object({
      mechanism: z.enum(["university_decision_required", "eneb_internal_recognition", "unknown"]),
      description: z.string().trim().max(1000),
    })
    .strict(),
  /**
   * Keyed on WHERE THE DOCUMENT WAS ISSUED, never on where the student lives.
   */
  undergraduate_document_legalization: z
    .object({
      euIssued: z.array(z.enum(LEGALIZATION_REQUIREMENTS)),
      nonEuIssued: z.array(z.enum(LEGALIZATION_REQUIREMENTS)),
      notes: z.string().trim().max(1000).nullable().optional(),
    })
    .strict(),
} as const;

export type RuleValue<K extends RuleKey> = z.infer<(typeof ruleValueSchemas)[K]>;

export const cohortRuleSchema = z
  .object({
    key: z.enum(RULE_KEYS),
    value: z.unknown(),
    source: ruleSourceSchema,
    basis: z.enum(RULE_BASES),
    verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    const parsed = ruleValueSchemas[rule.key].safeParse(rule.value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: ["value", ...issue.path] });
    }
  });
export type CohortRule = {
  [K in RuleKey]: {
    key: K;
    value: RuleValue<K>;
    source: z.infer<typeof ruleSourceSchema>;
    basis: RuleBasis;
    verifiedAt: string | null;
  };
}[RuleKey];

export const createRuleSetSchema = z
  .object({
    cohortLabel: z.string().trim().min(1).max(120),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rules: z.array(cohortRuleSchema).max(RULE_KEYS.length),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .refine((v) => new Set(v.rules.map((r) => r.key)).size === v.rules.length, { message: "Each rule key may appear once" });
export type CreateRuleSet = z.infer<typeof createRuleSetSchema>;

export interface RuleSetRecord {
  readonly id: string;
  readonly offeringId: string;
  readonly cohortLabel: string;
  readonly version: number;
  readonly effectiveFrom: string;
  readonly rules: readonly CohortRule[];
  readonly status: "active" | "superseded";
  readonly supersedesId: string | null;
  readonly note: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

export function findRule<K extends RuleKey>(rules: readonly CohortRule[] | null | undefined, key: K): Extract<CohortRule, { key: K }> | null {
  return ((rules ?? []).find((r) => r.key === key) as Extract<CohortRule, { key: K }> | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Offerings
// ---------------------------------------------------------------------------

export const createOfferingSchema = z
  .object({
    key: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{2,63}$/),
    category: z.enum(OFFERING_CATEGORIES),
    route: z.enum(ROUTES),
    marketingTitle: z.string().trim().min(1).max(200),
    alternativeMarketingTitles: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
    universityLegalTitle: z.string().trim().max(300).nullable().default(null),
    universityLegalTitleStatus: z.enum(VERIFICATION_STATUSES).default("unknown"),
    awardingInstitution: z.enum(INSTITUTIONS),
    qualificationClassification: z.enum(QUALIFICATION_CLASSIFICATIONS).default("unknown"),
    classificationStatus: z.enum(VERIFICATION_STATUSES).default("unknown"),
    programVersion: z.string().trim().min(1).max(60),
    publishedDurationMonths: z.number().int().positive().nullable().default(null),
    publishedEcts: z.number().min(0).nullable().default(null),
    evidenceNote: z.string().trim().max(2000).nullable().default(null),
  })
  .strict()
  .refine((v) => v.universityLegalTitleStatus !== "verified" || !!v.universityLegalTitle, {
    message: "A verified university title needs the title itself",
    path: ["universityLegalTitle"],
  });
export type CreateOffering = z.infer<typeof createOfferingSchema>;

export interface OfferingRecord {
  readonly id: string;
  readonly key: string;
  readonly category: OfferingCategory;
  readonly route: GraduateRoute;
  readonly marketingTitle: string;
  readonly alternativeMarketingTitles: readonly string[];
  readonly universityLegalTitle: string | null;
  readonly universityLegalTitleStatus: VerificationStatus;
  readonly awardingInstitution: Institution;
  readonly qualificationClassification: QualificationClassification;
  readonly classificationStatus: VerificationStatus;
  readonly programVersion: string;
  readonly publishedDurationMonths: number | null;
  readonly publishedEcts: number | null;
  readonly evidenceNote: string | null;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Student graduate programs (enrollments; a student may have several over time)
// ---------------------------------------------------------------------------

export const ENEB_STATUSES = ["enrolled", "in_progress", "coursework_complete", "completed", "withdrawn"] as const;
export type EnebStatus = (typeof ENEB_STATUSES)[number];

export const PRIOR_BACHELOR_SOURCES = ["lumiere", "external", "unknown"] as const;

export const enrollProgramSchema = z
  .object({
    offeringId: z.string().min(1),
    ruleSetId: z.string().min(1),
    cohortLabel: z.string().trim().min(1).max(120),
    enrollmentContractTitle: z.string().trim().max(300).nullable().default(null),
    enrolledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    priorBachelorSource: z.enum(PRIOR_BACHELOR_SOURCES).default("unknown"),
  })
  .strict();
export type EnrollProgram = z.infer<typeof enrollProgramSchema>;

export const updateProgramSchema = z
  .object({
    enebStatus: z.enum(ENEB_STATUSES),
    enrollmentContractTitle: z.string().trim().max(300).nullable(),
    priorBachelorSource: z.enum(PRIOR_BACHELOR_SOURCES),
    note: z.string().trim().max(1000).nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type UpdateProgram = z.infer<typeof updateProgramSchema>;

export interface GraduateProgramRecord {
  readonly id: string;
  readonly studentId: string;
  readonly offeringId: string;
  /** The rule-set version accepted at enrollment. Never re-pointed retrospectively. */
  readonly ruleSetId: string;
  readonly route: GraduateRoute;
  readonly cohortLabel: string;
  readonly enrollmentContractTitle: string | null;
  readonly enrolledAt: string;
  readonly enebStatus: EnebStatus;
  readonly priorBachelorSource: (typeof PRIOR_BACHELOR_SOURCES)[number];
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Subjects (ENEB subjects and university subjects are separate rows)
// ---------------------------------------------------------------------------

export const SUBJECT_AUTHORITIES = ["eneb", "unimarconi"] as const;
export type SubjectAuthority = (typeof SUBJECT_AUTHORITIES)[number];
export const ASSESSMENT_TYPES = ["subject_exam", "comprehensive_exam", "assignment", "project", "other", "unknown"] as const;
export const STUDENT_PROGRESS = ["not_started", "in_progress", "submitted"] as const;
export type StudentProgress = (typeof STUDENT_PROGRESS)[number];
export const RESULT_STATUSES = ["none", "passed", "failed", "reassessment_required"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export const createSubjectSchema = z
  .object({
    authority: z.enum(SUBJECT_AUTHORITIES),
    title: z.string().trim().min(1).max(200),
    /** Only a code printed on an issued document. Never invented. */
    moduleCode: z.string().trim().max(60).nullable().default(null),
    /** Credits as STATED by `authority`; null when not stated. */
    statedCredits: z.number().min(0).nullable().default(null),
    creditUnit: z.enum(["ECTS", "CFU"]).nullable().default(null),
    assessmentType: z.enum(ASSESSMENT_TYPES).default("unknown"),
    sortOrder: z.number().int().min(0).max(999).default(0),
  })
  .strict();
export type CreateSubject = z.infer<typeof createSubjectSchema>;

export const recordSubjectResultSchema = z
  .object({
    resultStatus: z.enum(RESULT_STATUSES),
    gradeValue: z.number().min(0).nullable(),
    gradeScale: z.number().positive().nullable(),
    /** The grade exactly as the issuing document prints it, e.g. "8.9/10" or "27/30". */
    gradeDisplay: z.string().trim().max(40).nullable(),
    issuingInstitution: z.enum(INSTITUTIONS),
    verificationStatus: z.enum(["institution_stated", "evidence_received", "verified"]),
    documentId: z.string().min(1).nullable().default(null),
    documentReference: z.string().trim().max(200).nullable().default(null),
    /** A correction of an already recorded result, or a reassessment attempt. */
    kind: z.enum(["initial", "reassessment", "correction"]).default("initial"),
    note: z.string().trim().max(1000).nullable().default(null),
  })
  .strict();
export type RecordSubjectResult = z.infer<typeof recordSubjectResultSchema>;

export const studentSubjectProgressSchema = z.object({ progress: z.enum(STUDENT_PROGRESS) }).strict();

export interface SubjectRecord {
  readonly id: string;
  readonly programId: string;
  readonly authority: SubjectAuthority;
  readonly title: string;
  readonly moduleCode: string | null;
  readonly statedCredits: number | null;
  readonly creditUnit: "ECTS" | "CFU" | null;
  readonly assessmentType: (typeof ASSESSMENT_TYPES)[number];
  readonly sortOrder: number;
  readonly studentProgress: StudentProgress;
  readonly resultStatus: ResultStatus;
  readonly gradeValue: number | null;
  readonly gradeScale: number | null;
  readonly gradeDisplay: string | null;
  readonly issuingInstitution: Institution | null;
  readonly verificationStatus: VerificationStatus;
  readonly documentId: string | null;
  readonly documentReference: string | null;
  readonly reassessmentCount: number;
  readonly correctionCount: number;
  readonly recordedBy: string | null;
  readonly recordedAt: string | null;
}

// ---------------------------------------------------------------------------
// Records: academic events and evidence (one table, one kind per event)
// ---------------------------------------------------------------------------

export const ENEB_RECORD_KINDS = ["eneb_completion", "eneb_certificate", "eneb_transcript", "ui1_ects_certification"] as const;
export const UNIVERSITY_RECORD_KINDS = [
  "eligibility_review",
  "undergraduate_documents",
  "document_legalization",
  "university_application",
  "university_admission",
  "university_registration",
  "recognition_request",
  "recognition_decision",
  "thesis_topic",
  "thesis_submission",
  "thesis_result",
  "time_requirement",
  "graduation_procedure",
  "award_conferral",
  "official_transcript",
  "diploma_ordered",
  "diploma_issued",
  "diploma_delivered",
  "credential_verification",
] as const;
export const OPERATIONS_RECORD_KINDS = ["institutional_question"] as const;
export const RECORD_KINDS = [...ENEB_RECORD_KINDS, ...UNIVERSITY_RECORD_KINDS, ...OPERATIONS_RECORD_KINDS] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const RECORD_KIND_LABEL: Record<RecordKind, string> = {
  eneb_completion: "ENEB programme completion",
  eneb_certificate: "ENEB certificate",
  eneb_transcript: "ENEB transcript",
  ui1_ects_certification: "Universidad Isabel I ECTS certification",
  eligibility_review: "Degree eligibility review",
  undergraduate_documents: "Undergraduate degree documents",
  document_legalization: "Apostille / legalization",
  university_application: "University application",
  university_admission: "University admission",
  university_registration: "University registration (matricola)",
  recognition_request: "Prior-learning recognition request",
  recognition_decision: "University recognition decision",
  thesis_topic: "Thesis topic",
  thesis_submission: "Thesis submission",
  thesis_result: "Thesis result",
  time_requirement: "Minimum academic period",
  graduation_procedure: "Graduation procedure / ceremony",
  award_conferral: "Formal university conferral",
  official_transcript: "Official university transcript",
  diploma_ordered: "Diploma ordered",
  diploma_issued: "Diploma issued",
  diploma_delivered: "Diploma delivered",
  credential_verification: "Credential verification",
  institutional_question: "Open institutional question",
};

/** Records whose `verified` state is an OFFICIAL status and must pass the evidence guard. */
export const OFFICIAL_RECORD_KINDS = [
  "eneb_completion",
  "eneb_certificate",
  "ui1_ects_certification",
  "eligibility_review",
  "undergraduate_documents",
  "document_legalization",
  "university_admission",
  "university_registration",
  "recognition_decision",
  "thesis_result",
  "award_conferral",
  "official_transcript",
  "diploma_issued",
  "credential_verification",
] as const satisfies readonly RecordKind[];
export type OfficialRecordKind = (typeof OFFICIAL_RECORD_KINDS)[number];

export function isOfficialKind(kind: RecordKind): kind is OfficialRecordKind {
  return (OFFICIAL_RECORD_KINDS as readonly string[]).includes(kind);
}

/** Which institution's document can establish each official record. */
export const REQUIRED_ISSUERS: Record<OfficialRecordKind, readonly Institution[]> = {
  eneb_completion: ["eneb"],
  eneb_certificate: ["eneb"],
  ui1_ects_certification: ["ui1"],
  // The bachelor's degree is issued by whoever awarded it; Lumière staff verify the document.
  eligibility_review: ["lumiere", "unimarconi"],
  undergraduate_documents: ["lumiere", "other"],
  document_legalization: ["other"],
  university_admission: ["unimarconi"],
  university_registration: ["unimarconi"],
  recognition_decision: ["unimarconi"],
  // Who grades the thesis on this route is not authenticated; accept ENEB or the university, never a student.
  thesis_result: ["eneb", "unimarconi"],
  award_conferral: ["unimarconi"],
  official_transcript: ["unimarconi"],
  diploma_issued: ["unimarconi"],
  credential_verification: ["unimarconi", "verification_service"],
};

/** Outcomes per kind. `null` outcome = not decided / unknown. */
export const RECORD_OUTCOMES: Partial<Record<RecordKind, readonly string[]>> = {
  eligibility_review: ["eligible", "conditionally_eligible", "not_eligible"],
  university_admission: ["admitted", "conditionally_admitted", "refused"],
  recognition_decision: ["full", "partial", "none"],
  thesis_topic: ["approved", "changes_requested", "rejected"],
  thesis_result: ["passed", "failed", "resubmission_required"],
  credential_verification: ["confirmed", "not_confirmed"],
  eneb_completion: ["completed"],
  award_conferral: ["conferred"],
};

export const TRACKING_STATUSES = ["not_started", "in_progress", "submitted", "completed", "blocked", "withdrawn", "not_applicable"] as const;
export type TrackingStatus = (typeof TRACKING_STATUSES)[number];

/** Kind-specific details. Free-form but bounded; known keys are typed below. */
export const recordDetailsSchema = z
  .object({
    matricola: z.string().trim().max(40).optional(),
    issuingCountry: z.string().trim().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2").optional(),
    degreeTitle: z.string().trim().max(200).optional(),
    topic: z.string().trim().max(300).optional(),
    supervisor: z.string().trim().max(160).optional(),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    wordCount: z.number().int().positive().optional(),
    milestones: z
      .array(z.object({ label: z.string().trim().min(1).max(120), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), done: z.boolean() }).strict())
      .max(12)
      .optional(),
    originalityConfirmed: z.boolean().optional(),
    grade: z.string().trim().max(40).optional(),
    ceremonyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    carrier: z.string().trim().max(80).optional(),
    question: z.string().trim().max(1000).optional(),
    owner: z.string().trim().max(120).optional(),
  })
  .strict();
export type RecordDetails = z.infer<typeof recordDetailsSchema>;

/** Create or update a record WITHOUT changing its official status. Always allowed for staff. */
export const trackRecordSchema = z
  .object({
    kind: z.enum(RECORD_KINDS),
    trackingStatus: z.enum(TRACKING_STATUSES),
    issuingInstitution: z.enum(INSTITUTIONS).nullable(),
    documentTypeLabel: z.string().trim().max(200).nullable(),
    documentReference: z.string().trim().max(200).nullable(),
    documentId: z.string().min(1).nullable(),
    academicConsequence: z.string().trim().max(1000).nullable(),
    conflictingEvidence: z.string().trim().max(1000).nullable(),
    details: recordDetailsSchema,
    note: z.string().trim().max(1000).nullable(),
  })
  .partial()
  .strict();
export type TrackRecord = z.infer<typeof trackRecordSchema>;

/** The only way to set an official status. Guarded by evaluateOfficialChange(). */
export const verifyRecordSchema = z
  .object({
    decision: z.enum(["verified", "rejected", "conflicting", "evidence_received"]),
    outcome: z.string().trim().max(60).nullable().default(null),
    issuingInstitution: z.enum(INSTITUTIONS).nullable().default(null),
    documentTypeLabel: z.string().trim().max(200).nullable().default(null),
    documentReference: z.string().trim().max(200).nullable().default(null),
    documentId: z.string().min(1).nullable().default(null),
    /** Date printed on the authoritative document. */
    decisionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    /** For conferral: the conferral date on the university document. Never inferred from a ceremony. */
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    effectiveCohort: z.string().trim().max(120).nullable().default(null),
    academicConsequence: z.string().trim().max(1000).nullable().default(null),
    conflictingEvidence: z.string().trim().max(1000).nullable().default(null),
    details: recordDetailsSchema.default({}),
    note: z.string().trim().min(3).max(1000),
  })
  .strict();
export type VerifyRecord = z.infer<typeof verifyRecordSchema>;

export interface GraduateRecord {
  readonly id: string;
  readonly programId: string;
  readonly studentId: string;
  readonly kind: RecordKind;
  readonly trackingStatus: TrackingStatus;
  readonly verificationStatus: VerificationStatus;
  readonly outcome: string | null;
  readonly issuingInstitution: Institution | null;
  readonly documentTypeLabel: string | null;
  readonly documentReference: string | null;
  readonly documentId: string | null;
  readonly decisionDate: string | null;
  readonly effectiveDate: string | null;
  readonly effectiveCohort: string | null;
  readonly academicConsequence: string | null;
  readonly conflictingEvidence: string | null;
  readonly details: RecordDetails;
  readonly reviewerUserId: string | null;
  readonly reviewedAt: string | null;
  readonly note: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Credit authority (never summed across authorities)
// ---------------------------------------------------------------------------

export const CREDIT_AUTHORITIES = [
  "eneb_stated",
  "ui1_certified",
  "recognition_requested",
  "university_recognized",
  "university_awarded",
] as const;
export type CreditAuthority = (typeof CREDIT_AUTHORITIES)[number];

export const CREDIT_AUTHORITY_LABEL: Record<CreditAuthority, string> = {
  eneb_stated: "ECTS stated by ENEB",
  ui1_certified: "ECTS certified by Universidad Isabel I",
  recognition_requested: "Credits requested for recognition",
  university_recognized: "Recognized by the university",
  university_awarded: "Awarded by the university",
};

/** Which record must back each credit authority, and which institution issued it. */
export const CREDIT_BACKING: Record<CreditAuthority, { kinds: readonly RecordKind[]; issuer: readonly Institution[]; requiresVerified: boolean }> = {
  eneb_stated: { kinds: ["eneb_transcript", "eneb_certificate", "eneb_completion"], issuer: ["eneb"], requiresVerified: false },
  ui1_certified: { kinds: ["ui1_ects_certification"], issuer: ["ui1"], requiresVerified: true },
  recognition_requested: { kinds: ["recognition_request"], issuer: ["eneb", "lumiere", "unimarconi", "other"], requiresVerified: false },
  university_recognized: { kinds: ["recognition_decision"], issuer: ["unimarconi"], requiresVerified: true },
  university_awarded: { kinds: ["official_transcript", "award_conferral"], issuer: ["unimarconi"], requiresVerified: true },
};

export const RECOGNITION_OUTCOMES = ["recognized", "recognized_with_conditions", "not_recognized"] as const;

export const createCreditEntrySchema = z
  .object({
    authority: z.enum(CREDIT_AUTHORITIES),
    /** The record (decision, certificate, transcript) this entry comes from. */
    recordId: z.string().min(1),
    subjectId: z.string().min(1).nullable().default(null),
    label: z.string().trim().min(1).max(200),
    amount: z.number().min(0).max(120),
    unit: z.enum(["ECTS", "CFU"]),
    recognitionOutcome: z.enum(RECOGNITION_OUTCOMES).nullable().default(null),
    conditions: z.string().trim().max(1000).nullable().default(null),
    note: z.string().trim().max(1000).nullable().default(null),
  })
  .strict()
  .refine((v) => v.recognitionOutcome !== "recognized_with_conditions" || !!v.conditions, {
    message: "Conditional recognition must state its conditions",
    path: ["conditions"],
  });
export type CreateCreditEntry = z.infer<typeof createCreditEntrySchema>;

export interface CreditEntryRecord {
  readonly id: string;
  readonly programId: string;
  readonly authority: CreditAuthority;
  readonly recordId: string;
  readonly subjectId: string | null;
  readonly label: string;
  readonly amount: number;
  readonly unit: "ECTS" | "CFU";
  readonly recognitionOutcome: (typeof RECOGNITION_OUTCOMES)[number] | null;
  readonly conditions: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Evidence guard: the only gate for OFFICIAL changes (pure; server enforces)
// ---------------------------------------------------------------------------

export type GuardActorRole = "student" | "coach" | "staff" | "admin";

export interface GuardContext {
  readonly actorRole: GuardActorRole;
  readonly program: Pick<GraduateProgramRecord, "route" | "studentId">;
  readonly existing: GraduateRecord | null;
  /** Every record on the same program (to check prerequisites). */
  readonly siblings: readonly GraduateRecord[];
  /** The referenced student document, when documentId is given. */
  readonly document: { readonly studentId: string; readonly status: string; readonly country?: string | null } | null;
}

export interface GuardResult {
  readonly allowed: boolean;
  /** Stable codes; the UI turns them into plain language via GUARD_MESSAGES. */
  readonly missing: readonly GuardCode[];
}

export const GUARD_CODES = [
  "STAFF_ONLY",
  "ADMIN_ONLY",
  "ROUTE_HAS_NO_UNIVERSITY",
  "WRONG_ISSUER",
  "ISSUER_REQUIRED",
  "DOCUMENT_TYPE_REQUIRED",
  "DOCUMENT_REFERENCE_REQUIRED",
  "DECISION_DATE_REQUIRED",
  "OUTCOME_REQUIRED",
  "OUTCOME_INVALID",
  "MATRICOLA_REQUIRED",
  "CONFERRAL_DATE_REQUIRED",
  "REGISTRATION_NOT_VERIFIED",
  "ADMISSION_NOT_VERIFIED",
  "DOCUMENT_NOT_OWNED",
  "DOCUMENT_NOT_VERIFIED",
  "ISSUING_COUNTRY_REQUIRED",
  "CONFLICT_DETAIL_REQUIRED",
  "NOT_AN_OFFICIAL_KIND",
  "BACKING_RECORD_REQUIRED",
  "BACKING_RECORD_NOT_VERIFIED",
] as const;
export type GuardCode = (typeof GUARD_CODES)[number];

export const GUARD_MESSAGES: Record<GuardCode, string> = {
  STAFF_ONLY: "Only Lumière staff can record an official status.",
  ADMIN_ONLY: "A formal university award can only be confirmed by a Lumière administrator.",
  ROUTE_HAS_NO_UNIVERSITY: "This is an ENEB-only programme; it has no university record to verify.",
  WRONG_ISSUER: "This status can only come from a document issued by the institution that decides it.",
  ISSUER_REQUIRED: "Name the institution that issued the evidence.",
  DOCUMENT_TYPE_REQUIRED: "Name the exact type of document.",
  DOCUMENT_REFERENCE_REQUIRED: "Give the document's reference or attach it from Documents.",
  DECISION_DATE_REQUIRED: "Enter the date printed on the document.",
  OUTCOME_REQUIRED: "Record the outcome the document states.",
  OUTCOME_INVALID: "That outcome does not apply to this kind of record.",
  MATRICOLA_REQUIRED: "University registration needs the matricola from the university's document.",
  CONFERRAL_DATE_REQUIRED: "Enter the conferral date shown on the university's document.",
  REGISTRATION_NOT_VERIFIED: "Verify the student's university registration first.",
  ADMISSION_NOT_VERIFIED: "Verify the university admission first.",
  DOCUMENT_NOT_OWNED: "That document belongs to a different student.",
  DOCUMENT_NOT_VERIFIED: "Verify the attached document in Documents first.",
  ISSUING_COUNTRY_REQUIRED: "Record the country that issued the undergraduate degree.",
  CONFLICT_DETAIL_REQUIRED: "Describe the conflicting evidence.",
  NOT_AN_OFFICIAL_KIND: "This record has no official status; update its tracking instead.",
  BACKING_RECORD_REQUIRED: "Credits must come from the matching decision, certificate or transcript record.",
  BACKING_RECORD_NOT_VERIFIED: "Verify the decision, certificate or transcript behind these credits first.",
};

const isVerified = (records: readonly GraduateRecord[], kind: RecordKind, outcomes?: readonly string[]) =>
  records.some((r) => r.kind === kind && r.verificationStatus === "verified" && (!outcomes || (r.outcome !== null && outcomes.includes(r.outcome))));

/**
 * Decides whether an official status change is allowed. `verified` is the only
 * state that needs full evidence; `rejected` and `conflicting` still need staff
 * and a reason; `evidence_received` only needs staff.
 */
export function evaluateOfficialChange(kind: RecordKind, change: VerifyRecord, ctx: GuardContext): GuardResult {
  const missing: GuardCode[] = [];
  const isStaff = ctx.actorRole === "staff" || ctx.actorRole === "admin";
  if (!isStaff) return { allowed: false, missing: ["STAFF_ONLY"] };
  if (!isOfficialKind(kind)) return { allowed: false, missing: ["NOT_AN_OFFICIAL_KIND"] };
  const universityKind = (UNIVERSITY_RECORD_KINDS as readonly string[]).includes(kind);
  if (universityKind && ctx.program.route === "eneb_only") return { allowed: false, missing: ["ROUTE_HAS_NO_UNIVERSITY"] };

  if (change.decision === "conflicting" && !change.conflictingEvidence) missing.push("CONFLICT_DETAIL_REQUIRED");
  if (change.documentId && ctx.document && ctx.document.studentId !== ctx.program.studentId) missing.push("DOCUMENT_NOT_OWNED");
  if (change.documentId && !ctx.document) missing.push("DOCUMENT_NOT_OWNED");

  if (change.decision === "verified") {
    const issuers = REQUIRED_ISSUERS[kind];
    if (!change.issuingInstitution) missing.push("ISSUER_REQUIRED");
    else if (!issuers.includes(change.issuingInstitution)) missing.push("WRONG_ISSUER");
    if (!change.documentTypeLabel) missing.push("DOCUMENT_TYPE_REQUIRED");
    if (!change.documentReference && !change.documentId) missing.push("DOCUMENT_REFERENCE_REQUIRED");
    if (!change.decisionDate) missing.push("DECISION_DATE_REQUIRED");

    const outcomes = RECORD_OUTCOMES[kind];
    if (outcomes) {
      if (!change.outcome) missing.push("OUTCOME_REQUIRED");
      else if (!outcomes.includes(change.outcome)) missing.push("OUTCOME_INVALID");
    } else if (change.outcome) {
      missing.push("OUTCOME_INVALID");
    }

    if ((kind === "undergraduate_documents" || kind === "eligibility_review") && change.documentId && ctx.document && ctx.document.status !== "verified") {
      missing.push("DOCUMENT_NOT_VERIFIED");
    }
    if (kind === "undergraduate_documents" && !change.details.issuingCountry && !ctx.existing?.details.issuingCountry) {
      missing.push("ISSUING_COUNTRY_REQUIRED");
    }
    if (kind === "university_registration") {
      if (!change.details.matricola) missing.push("MATRICOLA_REQUIRED");
      if (!isVerified(ctx.siblings, "university_admission", ["admitted", "conditionally_admitted"])) missing.push("ADMISSION_NOT_VERIFIED");
    }
    if (kind === "recognition_decision" || kind === "official_transcript" || kind === "diploma_issued") {
      if (!isVerified(ctx.siblings, "university_registration")) missing.push("REGISTRATION_NOT_VERIFIED");
    }
    if (kind === "award_conferral") {
      if (ctx.actorRole !== "admin") missing.push("ADMIN_ONLY");
      if (!change.effectiveDate) missing.push("CONFERRAL_DATE_REQUIRED");
      if (!isVerified(ctx.siblings, "university_registration")) missing.push("REGISTRATION_NOT_VERIFIED");
      // The conferral date is never derived from the graduation ceremony: it must be supplied from the document.
    }
  }
  return { allowed: missing.length === 0, missing };
}

/** Credit entries: who may create which authority, backed by which record. */
export function evaluateCreditEntry(
  entry: Pick<CreateCreditEntry, "authority" | "recognitionOutcome">,
  ctx: { actorRole: GuardActorRole; route: GraduateRoute; backing: GraduateRecord | null },
): GuardResult {
  const missing: GuardCode[] = [];
  if (ctx.actorRole !== "staff" && ctx.actorRole !== "admin") return { allowed: false, missing: ["STAFF_ONLY"] };
  const rule = CREDIT_BACKING[entry.authority];
  const universityAuthority = entry.authority === "university_recognized" || entry.authority === "university_awarded" || entry.authority === "recognition_requested";
  if (universityAuthority && ctx.route === "eneb_only") return { allowed: false, missing: ["ROUTE_HAS_NO_UNIVERSITY"] };
  const b = ctx.backing;
  if (!b || !rule.kinds.includes(b.kind)) missing.push("BACKING_RECORD_REQUIRED");
  else {
    if (!b.issuingInstitution || !rule.issuer.includes(b.issuingInstitution)) missing.push("WRONG_ISSUER");
    if (rule.requiresVerified && b.verificationStatus !== "verified") {
      missing.push("BACKING_RECORD_NOT_VERIFIED");
    }
    if (entry.authority === "university_recognized" && b.outcome === "none" && entry.recognitionOutcome !== "not_recognized") missing.push("OUTCOME_INVALID");
  }
  if (entry.authority === "university_recognized" && !entry.recognitionOutcome) missing.push("OUTCOME_REQUIRED");
  if (entry.authority !== "university_recognized" && entry.recognitionOutcome) missing.push("OUTCOME_INVALID");
  return { allowed: missing.length === 0, missing: Array.from(new Set(missing)) };
}

/** Apostille/legalization needs, from the ISSUING country of the degree (never residence). */
export const EU_COUNTRY_CODES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
  "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
] as const;

export function legalizationRequirements(
  rule: RuleValue<"undergraduate_document_legalization"> | null,
  issuingCountry: string | null | undefined,
): { readonly status: "unknown_country" | "no_rule" | "resolved"; readonly requirements: readonly LegalizationRequirement[] } {
  if (!issuingCountry) return { status: "unknown_country", requirements: [] };
  if (!rule) return { status: "no_rule", requirements: [] };
  const eu = (EU_COUNTRY_CODES as readonly string[]).includes(issuingCountry.toUpperCase());
  return { status: "resolved", requirements: eu ? rule.euIssued : rule.nonEuIssued };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const GRADUATE_ERROR_CODES = [
  "GRADUATE_VALIDATION_ERROR",
  "GRADUATE_NOT_FOUND",
  "GRADUATE_FORBIDDEN",
  "GRADUATE_EVIDENCE_REQUIRED",
  "GRADUATE_CONFLICT",
  "GRADUATE_RULE_SET_MISMATCH",
  "GRADUATE_THESIS_TOPIC_LOCKED",
  "STUDENT_PROFILE_NOT_FOUND",
] as const;
export type GraduateErrorCode = (typeof GRADUATE_ERROR_CODES)[number];

export interface GraduateErrorBody {
  readonly error: { readonly code: GraduateErrorCode; readonly message: string; readonly missing?: readonly GuardCode[]; readonly details?: unknown };
}

// ---------------------------------------------------------------------------
// Student self-service
// ---------------------------------------------------------------------------

export const studentThesisPlanSchema = z
  .object({
    topic: z.string().trim().min(5).max(300).optional(),
    milestones: z
      .array(z.object({ label: z.string().trim().min(1).max(120), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), done: z.boolean() }).strict())
      .max(12)
      .optional(),
  })
  .strict()
  .refine((v) => v.topic !== undefined || v.milestones !== undefined, { message: "Nothing to update" });
export type StudentThesisPlan = z.infer<typeof studentThesisPlanSchema>;

/** Kinds a student may attach one of their own Documents to (as evidence awaiting review). */
export const STUDENT_EVIDENCE_KINDS = ["undergraduate_documents", "document_legalization", "thesis_submission", "university_application"] as const satisfies readonly RecordKind[];
export const studentAttachEvidenceSchema = z.object({ documentId: z.string().min(1) }).strict();

// ---------------------------------------------------------------------------
// API surface (documented here, implemented in server/routes/graduate-programs.ts)
// ---------------------------------------------------------------------------

export const GRADUATE_API = {
  student: {
    view: "GET /api/student/graduate",
    subjectProgress: "POST /api/student/graduate/programs/:programId/subjects/:subjectId/progress",
    thesisPlan: "PUT /api/student/graduate/programs/:programId/thesis",
    attachEvidence: "POST /api/student/graduate/programs/:programId/records/:recordId/evidence",
  },
  staff: {
    offerings: "GET /api/admin/graduate/offerings",
    createOffering: "POST /api/admin/graduate/offerings (admin)",
    createRuleSet: "POST /api/admin/graduate/offerings/:offeringId/rule-sets (admin; new version, supersedes the active one)",
    workspace: "GET /api/admin/students/:studentId/graduate",
    enroll: "POST /api/admin/students/:studentId/graduate/programs",
    updateProgram: "PATCH /api/admin/graduate/programs/:programId",
    createSubject: "POST /api/admin/graduate/programs/:programId/subjects",
    recordResult: "POST /api/admin/graduate/subjects/:subjectId/result",
    createRecord: "POST /api/admin/graduate/programs/:programId/records",
    trackRecord: "PATCH /api/admin/graduate/records/:recordId",
    verifyRecord: "POST /api/admin/graduate/records/:recordId/verify",
    createCredit: "POST /api/admin/graduate/programs/:programId/credits",
    history: "GET /api/admin/graduate/programs/:programId/events",
  },
} as const;

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface GraduateProgramBundle {
  readonly program: GraduateProgramRecord;
  readonly offering: OfferingRecord;
  readonly ruleSet: RuleSetRecord;
  readonly subjects: readonly SubjectRecord[];
  readonly records: readonly GraduateRecord[];
  readonly credits: readonly CreditEntryRecord[];
  /** Student documents referenced by records (id, type, status only). */
  readonly documents: readonly { readonly id: string; readonly fileName: string; readonly status: string }[];
}

export type MilestoneState = "done" | "in_progress" | "waiting" | "not_started" | "attention" | "not_applicable";

export interface MilestoneView {
  readonly key: string;
  readonly label: string;
  readonly state: MilestoneState;
  readonly detail: string;
  /** True only when backed by a verified official record. */
  readonly official: boolean;
  readonly date: string | null;
}

export interface CreditLayerView {
  readonly authority: CreditAuthority;
  readonly label: string;
  /** null = unknown (no decision/record). Never coerced to 0. */
  readonly amount: number | null;
  readonly unit: "ECTS" | "CFU" | null;
  readonly state: "recorded" | "unknown" | "not_applicable";
  readonly explanation: string;
}

export interface ModuleView {
  readonly id: string;
  readonly title: string;
  readonly authority: SubjectAuthority;
  readonly authorityLabel: string;
  readonly moduleCode: string | null;
  readonly assessment: string;
  readonly progress: StudentProgress;
  readonly result: ResultStatus;
  readonly resultLabel: string;
  readonly grade: string | null;
  readonly reassessed: boolean;
  readonly corrected: boolean;
  readonly hasEvidence: boolean;
  readonly verification: VerificationStatus;
  readonly verificationLabel: string;
  readonly canReportProgress: boolean;
}

export interface StudentGraduateProgramView {
  readonly programId: string;
  readonly route: GraduateRoute;
  readonly title: string;
  readonly titleNote: string | null;
  readonly universityRelationship: string;
  readonly enebStatus: EnebStatus;
  readonly enebStatusLabel: string;
  readonly cohortLabel: string;
  readonly academicPeriod: string;
  readonly registration: { readonly state: "not_applicable" | "not_started" | "in_progress" | "verified"; readonly label: string; readonly matricola: string | null };
  readonly nextStep: { readonly title: string; readonly detail: string; readonly href: string | null };
  readonly pendingDocuments: readonly { readonly key: string; readonly label: string; readonly detail: string; readonly recordId: string | null }[];
  readonly progress: {
    readonly enebSubjectsPassed: number;
    readonly enebSubjectsTotal: number;
    readonly universitySubjectsPassed: number;
    readonly universitySubjectsTotal: number;
    /** null when the university-approved module structure is not authenticated. */
    readonly verifiedRequirements: { readonly done: number; readonly total: number } | null;
    readonly statement: string;
  };
  readonly credits: readonly CreditLayerView[];
  readonly modules: readonly ModuleView[];
  readonly previousLearning: null | {
    readonly enebModulesCompleted: number;
    readonly requestState: "not_requested" | "requested" | "under_review" | "decided";
    readonly requestStateLabel: string;
    readonly decision: null | {
      readonly outcome: "full" | "partial" | "none";
      readonly outcomeLabel: string;
      readonly decisionDate: string | null;
      readonly items: readonly { readonly label: string; readonly amount: number; readonly unit: string; readonly outcome: string; readonly conditions: string | null }[];
    };
    readonly outstanding: readonly string[];
    readonly note: string;
  };
  readonly thesis: null | {
    readonly topic: string | null;
    readonly topicApproval: "not_proposed" | "proposed" | "approved" | "changes_requested" | "rejected";
    readonly supervisor: string | null;
    readonly minWords: number | null;
    readonly minWordsBasis: string | null;
    readonly milestones: readonly { readonly label: string; readonly due: string | null; readonly done: boolean }[];
    readonly deadline: string | null;
    readonly originality: string;
    readonly submittedOn: string | null;
    readonly gradingStatus: "not_submitted" | "submitted" | "graded";
    readonly result: null | { readonly outcome: string; readonly grade: string | null; readonly official: boolean };
    readonly resubmission: string | null;
    /** Milestones stay tickable until the thesis is officially graded. */
    readonly canEditPlan: boolean;
    /** The topic locks once approved (server returns 409 GRADUATE_THESIS_TOPIC_LOCKED). */
    readonly canEditTopic: boolean;
  };
  readonly assessment: { readonly mode: string; readonly description: string; readonly basis: string; readonly passing: string | null };
  readonly enebQualification: { readonly state: "in_progress" | "completed_reported" | "completed_verified"; readonly label: string; readonly certificateIssued: boolean };
  readonly graduation: null | {
    readonly milestones: readonly MilestoneView[];
    readonly academicWorkComplete: boolean;
    readonly awardConferred: boolean;
    readonly conferredOn: string | null;
    readonly explanation: string;
  };
}

export interface StudentGraduateView {
  readonly programs: readonly StudentGraduateProgramView[];
}

// ---------------------------------------------------------------------------
// Projection (pure)
// ---------------------------------------------------------------------------

const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  unknown: "Not yet known",
  student_reported: "Reported by you",
  institution_stated: "Stated by the institution, not yet checked",
  evidence_received: "Evidence received, being checked",
  verified: "Verified by Lumière",
  rejected: "Not accepted",
  conflicting: "Conflicting evidence, under review",
};
export const verificationLabel = (v: VerificationStatus) => VERIFICATION_LABEL[v];

const ENEB_STATUS_LABEL: Record<EnebStatus, string> = {
  enrolled: "Enrolled with ENEB",
  in_progress: "Studying",
  coursework_complete: "ENEB coursework complete",
  completed: "ENEB programme completed",
  withdrawn: "Withdrawn",
};

const RESULT_LABEL: Record<ResultStatus, string> = {
  none: "No result yet",
  passed: "Passed",
  failed: "Not passed",
  reassessment_required: "Reassessment required",
};

const ASSESSMENT_LABEL: Record<(typeof ASSESSMENT_TYPES)[number], string> = {
  subject_exam: "Subject exam",
  comprehensive_exam: "Comprehensive exam",
  assignment: "Assignment",
  project: "Project",
  other: "Assessment",
  unknown: "Assessment to be confirmed",
};

function latest(records: readonly GraduateRecord[], kind: RecordKind): GraduateRecord | null {
  const list = records.filter((r) => r.kind === kind);
  if (!list.length) return null;
  return [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))[0];
}

const verifiedRecord = (records: readonly GraduateRecord[], kind: RecordKind) => {
  const r = latest(records, kind);
  return r && r.verificationStatus === "verified" ? r : null;
};

function sumCredits(entries: readonly CreditEntryRecord[], authority: CreditAuthority, filter?: (e: CreditEntryRecord) => boolean) {
  const list = entries.filter((e) => e.authority === authority && (!filter || filter(e)));
  if (!list.length) return null;
  const units = new Set(list.map((e) => e.unit));
  return { amount: list.reduce((n, e) => n + e.amount, 0), unit: units.size === 1 ? list[0].unit : null };
}

function formatScore(s: { value: number; scale: number } | null | undefined): string | null {
  return s ? `${s.value}/${s.scale}` : null;
}

function creditLayers(bundle: GraduateProgramBundle): CreditLayerView[] {
  const uni = bundle.program.route === "eneb_unimarconi";
  const decision = latest(bundle.records, "recognition_decision");
  const layer = (authority: CreditAuthority, filter?: (e: CreditEntryRecord) => boolean): CreditLayerView => {
    const s = sumCredits(bundle.credits, authority, filter);
    const universityLayer = authority === "recognition_requested" || authority === "university_recognized" || authority === "university_awarded";
    if (universityLayer && !uni) {
      return { authority, label: CREDIT_AUTHORITY_LABEL[authority], amount: null, unit: null, state: "not_applicable", explanation: "Not part of an ENEB-only programme." };
    }
    if (s) {
      return { authority, label: CREDIT_AUTHORITY_LABEL[authority], amount: s.amount, unit: s.unit, state: "recorded", explanation: CREDIT_EXPLANATION[authority] };
    }
    let explanation = "Nothing recorded yet.";
    if (authority === "university_recognized") {
      explanation = decision && decision.verificationStatus === "verified" && decision.outcome === "none"
        ? "The university decided not to recognize earlier learning."
        : "Unknown until the university issues its recognition decision. This is not zero and not a refusal.";
      if (decision && decision.verificationStatus === "verified" && decision.outcome === "none") {
        return { authority, label: CREDIT_AUTHORITY_LABEL[authority], amount: 0, unit: null, state: "recorded", explanation };
      }
    }
    if (authority === "university_awarded") explanation = "Shown only from the university's official transcript.";
    return { authority, label: CREDIT_AUTHORITY_LABEL[authority], amount: null, unit: null, state: "unknown", explanation };
  };
  return [
    layer("eneb_stated"),
    layer("ui1_certified"),
    layer("recognition_requested"),
    layer("university_recognized", (e) => e.recognitionOutcome !== "not_recognized"),
    layer("university_awarded"),
  ];
}

const CREDIT_EXPLANATION: Record<CreditAuthority, string> = {
  eneb_stated: "As printed on ENEB documents. These are not university credits.",
  ui1_certified: "From a Universidad Isabel I certificate. Separate from any Unimarconi decision.",
  recognition_requested: "What was asked for. A request is not an approval.",
  university_recognized: "From the university's written recognition decision.",
  university_awarded: "From the university's official transcript.",
};

function thesisView(bundle: GraduateProgramBundle): StudentGraduateProgramView["thesis"] {
  const rule = findRule(bundle.ruleSet.rules, "thesis");
  if (rule && rule.value.required === false) return null;
  const topic = latest(bundle.records, "thesis_topic");
  const submission = latest(bundle.records, "thesis_submission");
  const result = latest(bundle.records, "thesis_result");
  const approval: NonNullable<StudentGraduateProgramView["thesis"]>["topicApproval"] = !topic?.details.topic
    ? "not_proposed"
    : topic.outcome === "approved" || topic.outcome === "changes_requested" || topic.outcome === "rejected"
      ? (topic.outcome as "approved" | "changes_requested" | "rejected")
      : "proposed";
  const submitted = submission && (submission.trackingStatus === "submitted" || submission.trackingStatus === "completed");
  const resultOfficial = !!result && result.verificationStatus === "verified" && !!result.outcome;
  const fee = rule?.value.resubmissionFee;
  const passing = formatScore(rule?.value.passingThreshold ?? null);
  return {
    topic: topic?.details.topic ?? null,
    topicApproval: approval,
    supervisor: topic?.details.supervisor ?? null,
    minWords: rule?.value.minWords ?? null,
    minWordsBasis: rule ? `${RULE_BASIS_LABEL[rule.basis]} · ${rule.source.title}` : null,
    milestones: topic?.details.milestones ?? [],
    deadline: submission?.details.deadline ?? topic?.details.deadline ?? null,
    originality:
      rule?.value.originalityCheck === true
        ? "Your thesis must be your own work, with every source cited. It will be checked for originality."
        : "Your thesis must be your own work, with every source cited.",
    submittedOn: submitted ? submission!.decisionDate ?? submission!.updatedAt.slice(0, 10) : null,
    gradingStatus: resultOfficial ? "graded" : submitted ? "submitted" : "not_submitted",
    result: resultOfficial ? { outcome: result!.outcome!, grade: result!.details.grade ?? null, official: true } : null,
    resubmission:
      rule && (fee || passing)
        ? [passing ? `Pass mark ${passing}.` : null, fee ? `A further submission costs ${fee.amount} ${fee.currency} under your cohort's terms (billed by Lumière's billing team, not here).` : null]
            .filter(Boolean)
            .join(" ")
        : null,
    canEditPlan: !resultOfficial,
    canEditTopic: approval !== "approved" && !resultOfficial,
  };
}

function graduationView(bundle: GraduateProgramBundle, subjectsDone: boolean): StudentGraduateProgramView["graduation"] {
  if (bundle.program.route !== "eneb_unimarconi") return null;
  const r = bundle.records;
  const thesisResult = verifiedRecord(r, "thesis_result");
  const thesisRequired = findRule(bundle.ruleSet.rules, "thesis")?.value.required !== false;
  const time = latest(r, "time_requirement");
  const procedure = latest(r, "graduation_procedure");
  const conferral = verifiedRecord(r, "award_conferral");
  const transcript = verifiedRecord(r, "official_transcript");
  const ordered = latest(r, "diploma_ordered");
  const issued = verifiedRecord(r, "diploma_issued");
  const delivered = latest(r, "diploma_delivered");
  const credential = verifiedRecord(r, "credential_verification");

  const m = (key: string, label: string, state: MilestoneState, detail: string, official: boolean, date: string | null = null): MilestoneView => ({ key, label, state, detail, official, date });
  const tracked = (rec: GraduateRecord | null): MilestoneState =>
    !rec ? "not_started" : rec.trackingStatus === "completed" ? "done" : rec.trackingStatus === "blocked" ? "attention" : rec.trackingStatus === "not_started" ? "not_started" : "in_progress";

  const milestones: MilestoneView[] = [
    m("assessments", "All subject assessments complete", subjectsDone ? "done" : "in_progress", subjectsDone ? "Every required subject has a pass recorded." : "Some subjects still need a result.", false),
    thesisRequired
      ? m(
          "thesis",
          "Thesis passed",
          thesisResult?.outcome === "passed" ? "done" : thesisResult ? "attention" : "not_started",
          thesisResult?.outcome === "passed" ? "Pass confirmed from the grading record." : thesisResult ? "The thesis needs another submission." : "Not graded yet. Submitting is not the same as passing.",
          !!thesisResult,
          thesisResult?.decisionDate ?? null,
        )
      : m("thesis", "Thesis passed", "not_applicable", "Your cohort's terms do not include a thesis.", false),
    m("time", "Minimum academic period satisfied", tracked(time), time?.trackingStatus === "completed" ? "The required study period has passed." : "Counted from your verified registration date.", false, time?.effectiveDate ?? null),
    m("procedure", "Graduation procedure completed", tracked(procedure), procedure?.trackingStatus === "completed" ? "Formalities done. This does not by itself award the degree." : "Final formalities set by the university.", false, procedure?.details.ceremonyDate ?? null),
    m(
      "conferral",
      "University degree formally conferred",
      conferral ? "done" : "waiting",
      conferral ? "Confirmed from the university's conferral document." : "Only the university can confer the degree. Lumière records it once we hold the university's document.",
      !!conferral,
      conferral?.effectiveDate ?? null,
    ),
    m("transcript", "Official university transcript issued", transcript ? "done" : "waiting", transcript ? "Issued by the university." : "Issued by the university after conferral.", !!transcript, transcript?.decisionDate ?? null),
    m(
      "diploma",
      "Diploma issued and delivered",
      issued && delivered?.trackingStatus === "completed" ? "done" : issued ? "in_progress" : ordered ? "in_progress" : "waiting",
      issued
        ? delivered?.trackingStatus === "completed" ? "Issued by the university and delivered to you." : "Issued by the university; delivery in progress."
        : ordered ? "Ordered. An order is not an issued diploma." : "Requested after conferral.",
      !!issued,
      issued?.decisionDate ?? null,
    ),
    m("verification", "Credential verification completed", credential ? "done" : "waiting", credential ? "The award was confirmed with the issuing university." : "A final check with the university that the award is genuine.", !!credential, credential?.decisionDate ?? null),
  ];
  const academicWorkComplete = subjectsDone && (!thesisRequired || thesisResult?.outcome === "passed");
  return {
    milestones,
    academicWorkComplete,
    awardConferred: !!conferral,
    conferredOn: conferral?.effectiveDate ?? null,
    explanation: conferral
      ? "Your university degree has been formally conferred."
      : academicWorkComplete
        ? "Your academic work is finished. The degree is awarded only when the university formally confers it."
        : "Finishing your coursework and thesis comes first. The university then confers the degree.",
  };
}

function nextStep(bundle: GraduateProgramBundle, v: Omit<StudentGraduateProgramView, "nextStep">): StudentGraduateProgramView["nextStep"] {
  const r = bundle.records;
  if (bundle.program.enebStatus === "withdrawn") return { title: "This programme is closed", detail: "Contact Support if you think this is wrong.", href: "/support" };
  if (v.pendingDocuments.length) return { title: `Send ${v.pendingDocuments[0].label.toLowerCase()}`, detail: v.pendingDocuments[0].detail, href: "/documents" };
  if (bundle.program.route === "eneb_unimarconi") {
    const admission = latest(r, "university_admission");
    if (!verifiedRecord(r, "university_registration")) {
      if (!admission || admission.verificationStatus !== "verified") return { title: "Waiting for the university's admission decision", detail: "Lumière is following up with the university. You don't need to do anything yet.", href: null };
      return { title: "Waiting for your university registration", detail: "Once the university registers you, Lumière confirms it here with your matricola.", href: null };
    }
  }
  const openModule = v.modules.find((m) => m.result !== "passed" && m.progress !== "submitted");
  if (openModule) return { title: `Continue ${openModule.title}`, detail: `${openModule.assessment}. Mark it submitted when you hand it in.`, href: "#graduate-modules" };
  if (v.thesis && v.thesis.topicApproval === "not_proposed") return { title: "Propose your thesis topic", detail: "Add a working title so your topic can be approved.", href: "#graduate-thesis" };
  if (v.thesis && v.thesis.gradingStatus === "not_submitted") return { title: "Finish and submit your thesis", detail: v.thesis.minWords ? `At least ${v.thesis.minWords.toLocaleString("en-US")} words under your cohort's terms.` : "Check the word count with your academic contact.", href: "#graduate-thesis" };
  if (v.thesis && v.thesis.gradingStatus === "submitted") return { title: "Your thesis is being graded", detail: "Submitted is not passed yet. You'll see the result here.", href: null };
  if (v.graduation && !v.graduation.awardConferred) return { title: "Waiting for the university to confer your degree", detail: v.graduation.explanation, href: "#graduate-graduation" };
  if (v.graduation) {
    const open = v.graduation.milestones.find((m) => m.state !== "done" && m.state !== "not_applicable");
    if (open) return { title: open.label, detail: open.detail, href: "#graduate-graduation" };
    return { title: "Everything is complete", detail: "Your university degree is conferred and verified.", href: null };
  }
  if (v.enebQualification.state !== "completed_verified") return { title: "Waiting for ENEB to confirm completion", detail: "Lumière will record your ENEB certificate when it arrives.", href: null };
  return { title: "Your ENEB programme is complete", detail: "Your ENEB qualification is recorded.", href: null };
}

export function buildStudentGraduateProgramView(bundle: GraduateProgramBundle): StudentGraduateProgramView {
  const { program, offering, ruleSet } = bundle;
  const uni = program.route === "eneb_unimarconi";
  const r = bundle.records;
  const subjects = [...bundle.subjects].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  const enebSubjects = subjects.filter((s) => s.authority === "eneb");
  const uniSubjects = subjects.filter((s) => s.authority === "unimarconi");
  const passed = (list: readonly SubjectRecord[]) => list.filter((s) => s.resultStatus === "passed").length;

  const modules: ModuleView[] = subjects.map((s) => ({
    id: s.id,
    title: s.title,
    authority: s.authority,
    authorityLabel: s.authority === "eneb" ? "ENEB subject" : "University subject",
    moduleCode: s.moduleCode,
    assessment: ASSESSMENT_LABEL[s.assessmentType],
    progress: s.studentProgress,
    result: s.resultStatus,
    resultLabel: RESULT_LABEL[s.resultStatus],
    grade: s.resultStatus === "none" ? null : s.gradeDisplay,
    reassessed: s.reassessmentCount > 0,
    corrected: s.correctionCount > 0,
    hasEvidence: !!(s.documentId || s.documentReference),
    verification: s.verificationStatus,
    verificationLabel: VERIFICATION_LABEL[s.verificationStatus],
    canReportProgress: s.resultStatus !== "passed" && program.enebStatus !== "withdrawn",
  }));

  const registration = verifiedRecord(r, "university_registration");
  const regTracking = latest(r, "university_registration") ?? latest(r, "university_application");
  const reg: StudentGraduateProgramView["registration"] = !uni
    ? { state: "not_applicable", label: "No university registration on this programme", matricola: null }
    : registration
      ? { state: "verified", label: "Registered with the university", matricola: registration.details.matricola ?? null }
      : regTracking && regTracking.trackingStatus !== "not_started"
        ? { state: "in_progress", label: "Registration in progress, not yet confirmed by the university", matricola: null }
        : { state: "not_started", label: "Not registered with the university yet", matricola: null };

  // Documents still needed: records the student can supply that are not yet verified.
  const pendingDocuments: StudentGraduateProgramView["pendingDocuments"][number][] = [];
  if (uni) {
    const ug = latest(r, "undergraduate_documents");
    if (ug && ug.verificationStatus !== "verified" && !ug.documentId && ug.trackingStatus !== "not_applicable") {
      pendingDocuments.push({ key: "undergraduate_documents", label: "Bachelor's degree documents", detail: "Upload your degree certificate and transcript in Documents.", recordId: ug.id });
    }
    const leg = latest(r, "document_legalization");
    const legRule = findRule(ruleSet.rules, "undergraduate_document_legalization");
    const country = ug?.details.issuingCountry ?? null;
    const needs = legalizationRequirements(legRule?.value ?? null, country);
    if (needs.status === "resolved" && needs.requirements.length && (!leg || (leg.verificationStatus !== "verified" && !leg.documentId && leg.trackingStatus !== "not_applicable"))) {
      pendingDocuments.push({
        key: "document_legalization",
        label: needs.requirements.includes("apostille") ? "Apostille for your degree" : "Legalized degree documents",
        detail: `Required for degrees issued in ${country} under your cohort's terms.`,
        recordId: leg?.id ?? null,
      });
    }
  }

  const curriculum = findRule(ruleSet.rules, "curriculum");
  const authenticatedModules = curriculum?.value.modules ?? null;
  const requirementSubjects = uni ? uniSubjects : enebSubjects;
  const verifiedDone = requirementSubjects.filter((s) => s.resultStatus === "passed" && s.verificationStatus === "verified").length;
  const verifiedRequirements = authenticatedModules ? { done: verifiedDone, total: authenticatedModules.length } : null;

  const enebAllPassed = enebSubjects.length > 0 && passed(enebSubjects) === enebSubjects.length;
  const uniAllPassed = uniSubjects.length > 0 && passed(uniSubjects) === uniSubjects.length;
  const subjectsDone = uni ? uniAllPassed : enebAllPassed;

  const statement = uni
    ? verifiedRequirements
      ? `${verifiedRequirements.done} of ${verifiedRequirements.total} university-approved requirements verified.`
      : uniSubjects.length
        ? `${passed(uniSubjects)} of ${uniSubjects.length} remaining university subjects passed. The full university module list is still being confirmed.`
        : "Your remaining university subjects will be listed once the university confirms them."
    : enebSubjects.length
      ? `${passed(enebSubjects)} of ${enebSubjects.length} ENEB subjects passed.`
      : "Your ENEB subjects will appear here once enrolled.";

  // Previous learning (university route only).
  let previousLearning: StudentGraduateProgramView["previousLearning"] = null;
  if (uni) {
    const request = latest(r, "recognition_request");
    const decision = latest(r, "recognition_decision");
    const decided = decision && decision.verificationStatus === "verified" && decision.outcome ? decision : null;
    const requestState: NonNullable<StudentGraduateProgramView["previousLearning"]>["requestState"] = decided
      ? "decided"
      : decision || (request && (request.trackingStatus === "submitted" || request.trackingStatus === "completed"))
        ? "under_review"
        : request
          ? "requested"
          : "not_requested";
    const items = decided
      ? bundle.credits
          .filter((c) => c.authority === "university_recognized" && c.recordId === decided.id)
          .map((c) => ({
            label: c.label,
            amount: c.amount,
            unit: c.unit,
            outcome: c.recognitionOutcome === "recognized_with_conditions" ? "Recognized with conditions" : c.recognitionOutcome === "not_recognized" ? "Not recognized" : "Recognized",
            conditions: c.conditions,
          }))
      : [];
    previousLearning = {
      enebModulesCompleted: passed(enebSubjects),
      requestState,
      requestStateLabel: {
        not_requested: "Not requested yet",
        requested: "Request being prepared",
        under_review: "With the university for a decision",
        decided: "University decision received",
      }[requestState],
      decision: decided
        ? {
            outcome: decided.outcome as "full" | "partial" | "none",
            outcomeLabel: { full: "Fully recognized", partial: "Partly recognized", none: "Not recognized" }[decided.outcome as "full" | "partial" | "none"],
            decisionDate: decided.decisionDate,
            items,
          }
        : null,
      outstanding: uniSubjects.filter((s) => s.resultStatus !== "passed").map((s) => s.title),
      note: decided
        ? "Only what the university's decision lists counts toward the university degree."
        : "Your completed ENEB subjects may be relevant, but nothing counts toward the university degree until the university decides.",
    };
  }

  const exam = findRule(ruleSet.rules, "examination_structure");
  const pass = findRule(ruleSet.rules, "passing_threshold");
  const enebCompletion = latest(r, "eneb_completion");
  const enebCertificate = verifiedRecord(r, "eneb_certificate");
  const enebState: StudentGraduateProgramView["enebQualification"]["state"] =
    enebCompletion?.verificationStatus === "verified"
      ? "completed_verified"
      : program.enebStatus === "completed" || program.enebStatus === "coursework_complete"
        ? "completed_reported"
        : "in_progress";
  const period = findRule(ruleSet.rules, "academic_period");

  const base: Omit<StudentGraduateProgramView, "nextStep"> = {
    programId: program.id,
    route: program.route,
    title: program.enrollmentContractTitle ?? offering.marketingTitle,
    titleNote:
      uni
        ? offering.universityLegalTitleStatus === "verified" && offering.universityLegalTitle
          ? `University title: ${offering.universityLegalTitle}`
          : "The university's official title for this master's is still being confirmed."
        : null,
    universityRelationship: uni
      ? "ENEB programme with a university route at Università degli Studi Guglielmo Marconi. ENEB and the university keep separate records."
      : "ENEB programme. It leads to an ENEB qualification, not a university degree.",
    enebStatus: program.enebStatus,
    enebStatusLabel: ENEB_STATUS_LABEL[program.enebStatus],
    cohortLabel: program.cohortLabel,
    academicPeriod: period?.value.description ?? "To be confirmed",
    registration: reg,
    pendingDocuments,
    progress: {
      enebSubjectsPassed: passed(enebSubjects),
      enebSubjectsTotal: enebSubjects.length,
      universitySubjectsPassed: passed(uniSubjects),
      universitySubjectsTotal: uniSubjects.length,
      verifiedRequirements,
      statement,
    },
    credits: creditLayers(bundle),
    modules,
    previousLearning,
    thesis: thesisView(bundle),
    assessment: {
      mode: exam?.value.mode === "comprehensive_final" ? "Comprehensive final exam" : exam?.value.mode === "subject_exams" ? "An exam for each subject" : "To be confirmed",
      description: exam?.value.description ?? "Your assessment arrangements are being confirmed for your cohort.",
      basis: exam ? `${RULE_BASIS_LABEL[exam.basis]} · ${exam.source.title}` : "No rule recorded for your cohort yet",
      passing: formatScore(pass?.value ?? null),
    },
    enebQualification: {
      state: enebState,
      label:
        enebState === "completed_verified"
          ? "ENEB qualification confirmed"
          : enebState === "completed_reported"
            ? "ENEB coursework complete, confirmation pending"
            : "ENEB qualification in progress",
      certificateIssued: !!enebCertificate,
    },
    graduation: null,
  };
  const withGraduation = { ...base, graduation: graduationView(bundle, subjectsDone) };
  return { ...withGraduation, nextStep: nextStep(bundle, withGraduation) };
}

// ---------------------------------------------------------------------------
// Staff read model
// ---------------------------------------------------------------------------

export interface StaffRecordView extends GraduateRecord {
  readonly label: string;
  readonly official: boolean;
  /** What would still block `verified`, evaluated with an empty change (guidance only). */
  readonly blockers: readonly GuardCode[];
}

export interface StaffGraduateProgramView {
  readonly program: GraduateProgramRecord;
  readonly offering: OfferingRecord;
  readonly ruleSet: RuleSetRecord;
  readonly ruleSetIsCurrent: boolean;
  readonly subjects: readonly SubjectRecord[];
  readonly records: readonly StaffRecordView[];
  readonly credits: readonly CreditEntryRecord[];
  readonly creditLayers: readonly CreditLayerView[];
  readonly openQuestions: readonly GraduateRecord[];
  /** The same projection the student sees, for "what the student sees" previews. */
  readonly studentView: StudentGraduateProgramView;
}

export interface StaffGraduateWorkspace {
  readonly studentId: string;
  readonly programs: readonly StaffGraduateProgramView[];
  readonly offerings: readonly OfferingRecord[];
  readonly ruleSets: readonly RuleSetRecord[];
}

export function buildStaffGraduateProgramView(bundle: GraduateProgramBundle, currentRuleSetId: string | null, actorRole: GuardActorRole): StaffGraduateProgramView {
  const records: StaffRecordView[] = bundle.records.map((rec) => {
    const official = isOfficialKind(rec.kind);
    const blockers = official && rec.verificationStatus !== "verified"
      ? evaluateOfficialChange(
          rec.kind,
          {
            decision: "verified",
            outcome: rec.outcome,
            issuingInstitution: rec.issuingInstitution,
            documentTypeLabel: rec.documentTypeLabel,
            documentReference: rec.documentReference,
            documentId: null,
            decisionDate: rec.decisionDate,
            effectiveDate: rec.effectiveDate,
            effectiveCohort: rec.effectiveCohort,
            academicConsequence: rec.academicConsequence,
            conflictingEvidence: rec.conflictingEvidence,
            details: rec.details,
            note: "guidance",
          },
          { actorRole, program: bundle.program, existing: rec, siblings: bundle.records, document: null },
        ).missing
      : [];
    return { ...rec, label: RECORD_KIND_LABEL[rec.kind], official, blockers };
  });
  return {
    program: bundle.program,
    offering: bundle.offering,
    ruleSet: bundle.ruleSet,
    ruleSetIsCurrent: currentRuleSetId === bundle.ruleSet.id,
    subjects: bundle.subjects,
    records,
    credits: bundle.credits,
    creditLayers: creditLayers(bundle),
    openQuestions: bundle.records.filter((r) => r.kind === "institutional_question" && r.trackingStatus !== "completed"),
    studentView: buildStudentGraduateProgramView(bundle),
  };
}
