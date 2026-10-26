/**
 * S12 — pure presentation logic for the staff graduate-programme workspace.
 * No React, no I/O: unit-tested by tests/s12-staff-graduate-review.test.ts.
 *
 * Central principle: for every record show three things at a glance:
 *   VERIFIED (issuer, document, date, reviewer), CLAIMED / REPORTED (not yet
 *   official) and ACTION (what still blocks `verified`, in plain language).
 */
import {
  CREDIT_AUTHORITY_LABEL,
  EVALUATION_CONCLUSION_LABEL,
  EVALUATION_CONCLUSIONS,
  EVALUATION_GUARD_MESSAGES,
  EVALUATION_STATUSES,
  EVALUATION_TYPES,
  EVALUATION_USES,
  EVALUATORS,
  EVALUATOR_FIXED_COUNTRY,
  EVALUATOR_LABEL,
  GUARD_MESSAGES,
  recordEvaluationSchema,
  INSTITUTION_LABEL,
  INSTITUTIONS,
  OFFICIAL_RECORD_KINDS,
  RECORD_KIND_LABEL,
  RECORD_KINDS,
  RECORD_OUTCOMES,
  ENEB_RECORD_KINDS,
  UNIVERSITY_RECORD_KINDS,
  findRule,
  legalizationRequirements,
  verificationLabel,
  type CreditAuthority,
  type CredentialEvaluationRecord,
  type EvaluationGuardCode,
  type GraduateRoute,
  type GuardCode,
  type StaffGraduateWorkspace,
  type SubjectRecord,
  type TrackingStatus,
  type Institution,
  type LegalizationRequirement,
  type RecordKind,
  type RuleSetRecord,
  type StaffGraduateProgramView,
  type StaffRecordView,
  type VerifyRecord,
  type VerificationStatus,
  type EnrollProgram,
  type TrackRecord,
  type CreateCreditEntry,
  type RecordSubjectResult,
} from "@shared/graduate-program-contract";

export const STAFF_GRADUATE_PATHS = {
  workspace: (studentId: string) => `/api/admin/students/${encodeURIComponent(studentId)}/graduate`,
  enroll: (studentId: string) => `/api/admin/students/${encodeURIComponent(studentId)}/graduate/programs`,
  createSubject: (programId: string) => `/api/admin/graduate/programs/${encodeURIComponent(programId)}/subjects`,
  recordResult: (subjectId: string) => `/api/admin/graduate/subjects/${encodeURIComponent(subjectId)}/result`,
  createRecord: (programId: string) => `/api/admin/graduate/programs/${encodeURIComponent(programId)}/records`,
  trackRecord: (recordId: string) => `/api/admin/graduate/records/${encodeURIComponent(recordId)}`,
  verifyRecord: (recordId: string) => `/api/admin/graduate/records/${encodeURIComponent(recordId)}/verify`,
  createCredit: (programId: string) => `/api/admin/graduate/programs/${encodeURIComponent(programId)}/credits`,
  recordEvaluation: (studentId: string) => `/api/admin/students/${encodeURIComponent(studentId)}/graduate/evaluations`,
  updateEvaluation: (id: string) => `/api/admin/graduate/evaluations/${encodeURIComponent(id)}`,
  verifyEvaluation: (id: string) => `/api/admin/graduate/evaluations/${encodeURIComponent(id)}/verify`,
  history: (programId: string) => `/api/admin/graduate/programs/${encodeURIComponent(programId)}/events`,
} as const;

export const STAFF_GRADUATE_QUERY_KEY = (studentId: string) => ["admin-student-graduate", studentId] as const;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface ApiFailure {
  readonly status: number;
  readonly code: string | null;
  readonly message: string;
  readonly missing: readonly AnyGuardCode[];
}

export type AnyGuardCode = GuardCode | EvaluationGuardCode;
export type GuardScope = "record" | "evaluation";

/** `apiRequest` throws `Error("<status>: <body text>")`. */
export function parseApiFailure(err: unknown): ApiFailure {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const m = /^(\d{3}):\s*([\s\S]*)$/.exec(raw);
  const status = m ? Number(m[1]) : 0;
  let code: string | null = null;
  let message = "";
  let missing: AnyGuardCode[] = [];
  if (m) {
    try {
      const body = JSON.parse(m[2]) as { error?: unknown };
      if (body && typeof body.error === "object" && body.error) {
        const e = body.error as { code?: unknown; message?: unknown; missing?: unknown };
        code = typeof e.code === "string" ? e.code : null;
        message = typeof e.message === "string" ? e.message : "";
        if (Array.isArray(e.missing)) missing = e.missing.filter((x): x is AnyGuardCode => typeof x === "string" && (x in GUARD_MESSAGES || x in EVALUATION_GUARD_MESSAGES));
      } else if (typeof body?.error === "string") {
        message = body.error;
      }
    } catch {
      message = m[2];
    }
  }
  return { status, code, message: message || friendlyStatus(status), missing };
}

function friendlyStatus(status: number): string {
  if (status === 403) return "You do not have permission to do this.";
  if (status === 404) return "That record no longer exists. Refresh and try again.";
  if (status === 409) return "This record changed or is locked. Refresh and try again.";
  if (status === 422) return "The evidence is not complete yet.";
  if (status === 400) return "Some fields are invalid.";
  return "Something went wrong. Nothing was saved.";
}

export function missingMessages(codes: readonly AnyGuardCode[], scope: GuardScope = "record"): string[] {
  const table = scope === "evaluation" ? (EVALUATION_GUARD_MESSAGES as Record<string, string>) : (GUARD_MESSAGES as Record<string, string>);
  const other = scope === "evaluation" ? (GUARD_MESSAGES as Record<string, string>) : (EVALUATION_GUARD_MESSAGES as Record<string, string>);
  return codes.map((c) => table[c] ?? other[c] ?? c);
}

/** Dialog feedback for a failed submit: 422 lists what is missing, others one line. */
export function failureSummary(f: ApiFailure, scope: GuardScope = "record"): { headline: string; items: string[] } {
  if (f.status === 422 && (f.code === "GRADUATE_EVIDENCE_REQUIRED" || (scope === "evaluation" && f.missing.length > 0))) {
    return { headline: "Not saved. The evidence is incomplete:", items: missingMessages(f.missing, scope) };
  }
  if (f.status === 422) return { headline: f.message, items: missingMessages(f.missing, scope) };
  return { headline: f.message, items: [] };
}

// ---------------------------------------------------------------------------
// Programme headline
// ---------------------------------------------------------------------------

export interface TitleLines {
  readonly marketing: string;
  readonly contract: string | null;
  readonly universityTitle: { readonly text: string; readonly verified: boolean };
}

export function titleLines(p: StaffGraduateProgramView): TitleLines {
  const o = p.offering;
  const uni = p.program.route === "eneb_unimarconi";
  const verified = o.universityLegalTitleStatus === "verified" && !!o.universityLegalTitle;
  return {
    marketing: o.marketingTitle,
    contract: p.program.enrollmentContractTitle && p.program.enrollmentContractTitle !== o.marketingTitle ? p.program.enrollmentContractTitle : null,
    universityTitle: !uni
      ? { text: "None. ENEB-only programme: no university title.", verified: false }
      : verified
        ? { text: o.universityLegalTitle!, verified: true }
        : { text: o.universityLegalTitle ? `${o.universityLegalTitle} (not verified)` : "Not confirmed by the university", verified: false },
  };
}

export function classificationLine(p: StaffGraduateProgramView): { text: string; verification: VerificationStatus; verificationText: string } {
  const c = p.offering.qualificationClassification;
  const text = c === "eneb_private_qualification" ? "ENEB private qualification" : c === "university_first_level_master" ? "University first-level master" : "Classification not established";
  return { text, verification: p.offering.classificationStatus, verificationText: verificationLabel(p.offering.classificationStatus).replace("Verified by Lumière", "Verified") };
}

export function ruleSetLine(p: StaffGraduateProgramView): { text: string; current: boolean } {
  const rs = p.ruleSet;
  return {
    text: `${rs.cohortLabel} · version ${rs.version}${p.ruleSetIsCurrent ? " (current)" : " (superseded, this student keeps the terms accepted at enrollment)"}`,
    current: p.ruleSetIsCurrent,
  };
}

// ---------------------------------------------------------------------------
// Verified / claimed / action
// ---------------------------------------------------------------------------

export interface RecordTriad {
  readonly verified: null | {
    readonly issuer: string;
    readonly document: string;
    readonly decisionDate: string | null;
    readonly effectiveDate: string | null;
    readonly outcome: string | null;
    readonly reviewer: string | null;
    readonly reviewedAt: string | null;
  };
  readonly claimed: readonly string[];
  readonly action: readonly string[];
  readonly officialKind: boolean;
}

const date10 = (s: string | null) => (s ? s.slice(0, 10) : null);

// ---------------------------------------------------------------------------
// Labels (raw values never reach the screen)
// ---------------------------------------------------------------------------

const humanize = (s: string) => s.replace(/_/g, " ");
const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const OUTCOME_LABEL: Record<string, string> = {
  eligible: "Eligible",
  conditionally_eligible: "Conditionally eligible",
  not_eligible: "Not eligible",
  admitted: "Admitted",
  conditionally_admitted: "Conditionally admitted",
  refused: "Refused",
  full: "Fully recognised",
  partial: "Partly recognised",
  none: "Not recognised",
  approved: "Approved",
  changes_requested: "Changes requested",
  rejected: "Rejected",
  passed: "Passed",
  failed: "Not passed",
  resubmission_required: "Resubmission required",
  confirmed: "Confirmed",
  not_confirmed: "Not confirmed",
  completed: "Completed",
  conferred: "Conferred",
};

/** "partial" on a recognition decision is "Partly recognised"; "none" there is not "none". */
export function outcomeLabel(outcome: string | null | undefined): string {
  if (!outcome) return "No outcome recorded";
  return OUTCOME_LABEL[outcome] ?? sentence(humanize(outcome));
}

export const TRACKING_LABEL: Record<TrackingStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  completed: "Completed",
  blocked: "Blocked",
  withdrawn: "Withdrawn",
  not_applicable: "Not applicable",
};
export const trackingLabel = (t: string) => TRACKING_LABEL[t as TrackingStatus] ?? sentence(humanize(t));

export const RESULT_LABEL: Record<string, string> = { none: "No result yet", passed: "Passed", failed: "Not passed", reassessment_required: "Reassessment required" };
export const ASSESSMENT_LABEL: Record<string, string> = { subject_exam: "Subject exam", comprehensive_exam: "Comprehensive exam", assignment: "Assignment", project: "Project", other: "Other assessment", unknown: "Assessment to be confirmed" };
export const DECISION_LABEL: Record<string, string> = {
  verified: "Verified: I checked the document",
  evidence_received: "Evidence received, still checking",
  conflicting: "Evidence conflicts",
  rejected: "Not accepted",
};
export const EVIDENCE_LEVEL_LABEL: Record<string, string> = {
  institution_stated: "Stated by the institution, not yet checked",
  evidence_received: "Document received, being checked",
  verified: "Verified against the document",
};
export const RESULT_KIND_LABEL: Record<string, string> = { initial: "First result", reassessment: "Reassessment attempt", correction: "Correction of a recorded result" };
export const studentProgressText = (p: string) => `Student says: ${humanize(p)}`;

export interface TrustBadge {
  readonly label: string;
  readonly tone: "verified" | "reported" | "pending" | "problem";
}

/** Same four tones as the staff profile panel. Only `verified` is the charcoal/gold official treatment. */
export function trustBadge(v: VerificationStatus): TrustBadge {
  switch (v) {
    case "verified":
      return { label: "Verified", tone: "verified" };
    case "evidence_received":
      return { label: "Evidence received, checking", tone: "pending" };
    case "institution_stated":
      return { label: "Stated, not yet checked", tone: "pending" };
    case "student_reported":
      return { label: "Student says, not checked", tone: "reported" };
    case "rejected":
      return { label: "Not accepted", tone: "problem" };
    case "conflicting":
      return { label: "Conflicting evidence", tone: "problem" };
    default:
      return { label: "Not known yet", tone: "reported" };
  }
}

export const CLAIMED_STATUSES: readonly VerificationStatus[] = ["institution_stated", "evidence_received", "student_reported"];
export const isClaimedStatus = (v: VerificationStatus) => CLAIMED_STATUSES.includes(v);

const authorityDoc = (inst: Institution | null | undefined) =>
  inst === "eneb" ? "ENEB transcript or certificate" : inst === "unimarconi" ? "university document" : inst === "ui1" ? "Universidad Isabel I certificate" : inst ? `${INSTITUTION_LABEL[inst]} document` : "issuing institution's document";

export interface RecordTriad {
  readonly verified: null | {
    readonly issuer: string;
    readonly document: string;
    readonly decisionDate: string | null;
    readonly effectiveDate: string | null;
    readonly outcome: string | null;
    readonly reviewer: string | null;
    readonly reviewedAt: string | null;
  };
  readonly claimed: readonly string[];
  readonly action: readonly string[];
  readonly officialKind: boolean;
  /** One line for a collapsed verified record: issuer · doc ref · date · reviewer. */
  readonly oneLine: string | null;
}

export function recordTriad(rec: StaffRecordView): RecordTriad {
  const isVerified = rec.verificationStatus === "verified";
  const verified = isVerified
    ? {
        issuer: rec.issuingInstitution ? INSTITUTION_LABEL[rec.issuingInstitution] : "Issuer not recorded",
        document: [rec.documentTypeLabel, rec.documentReference ? `ref. ${rec.documentReference}` : rec.documentId ? "attached document" : null].filter(Boolean).join(" · ") || "Document not described",
        decisionDate: rec.decisionDate,
        effectiveDate: rec.effectiveDate,
        outcome: rec.outcome ? outcomeLabel(rec.outcome) : null,
        reviewer: rec.reviewerUserId,
        reviewedAt: date10(rec.reviewedAt),
      }
    : null;
  const claimed: string[] = [];
  if (!isVerified) {
    if (rec.verificationStatus !== "unknown") claimed.push(trustBadge(rec.verificationStatus).label);
    if (rec.outcome) claimed.push(`Outcome claimed: ${outcomeLabel(rec.outcome)}`);
    if (rec.issuingInstitution) claimed.push(`Issuer stated: ${INSTITUTION_LABEL[rec.issuingInstitution]}`);
    if (rec.documentReference) claimed.push(`Reference stated: ${rec.documentReference}`);
    if (rec.details.matricola) claimed.push(`Matricola stated: ${rec.details.matricola}`);
    if (rec.details.issuingCountry) claimed.push(`Issued in: ${rec.details.issuingCountry}`);
    if (rec.trackingStatus !== "not_started") claimed.push(`Tracking: ${trackingLabel(rec.trackingStatus).toLowerCase()}`);
  }
  if (rec.conflictingEvidence) claimed.push(`Conflicting evidence: ${rec.conflictingEvidence}`);
  return { verified, claimed, action: isVerified ? [] : recordActions(rec), officialKind: rec.official, oneLine: verified ? [verified.issuer, verified.document, verified.decisionDate, verified.reviewer ? `reviewed by ${verified.reviewer}` : null].filter(Boolean).join(" · ") : null };
}

/**
 * What staff still have to do. A claim that is not verified ALWAYS yields an action,
 * even when the guard has no blocker left ("evidence looks complete, verify it").
 */
export function recordActions(rec: StaffRecordView): string[] {
  if (rec.verificationStatus === "verified") return [];
  const blockers = missingMessages(rec.blockers);
  if (rec.official) {
    if (blockers.length) return blockers;
    if (rec.verificationStatus === "rejected") return ["Not accepted. Record new evidence if the institution reissues the document."];
    if (rec.verificationStatus === "conflicting") return ["Resolve the conflicting evidence, then verify or reject."];
    if (isClaimedStatus(rec.verificationStatus) || (rec.trackingStatus !== "not_started" && rec.trackingStatus !== "not_applicable")) return [`Verify against the ${authorityDoc(rec.issuingInstitution)}.`];
    return [];
  }
  // Non-official records can only be tracked; a claim on them still needs a human check.
  if (isClaimedStatus(rec.verificationStatus)) return [`Check against the ${authorityDoc(rec.issuingInstitution)} and note it in tracking. This record has no official status.`];
  if (rec.trackingStatus === "in_progress" || rec.trackingStatus === "submitted" || rec.trackingStatus === "blocked") return ["Keep tracking until it is complete."];
  return [];
}

/** Whether to show the Verify button: official kind, not already verified. */
export function canOfferVerify(rec: StaffRecordView): boolean {
  return rec.official && rec.verificationStatus !== "verified";
}

/** Award conferral verification is admin-only; staff see the reason, not a dead button. */
export function verifyGate(rec: StaffRecordView, role: "staff" | "admin"): { enabled: boolean; reason: string | null } {
  if (rec.kind === "award_conferral" && role !== "admin") return { enabled: false, reason: GUARD_MESSAGES.ADMIN_ONLY };
  return { enabled: true, reason: null };
}

// ---------------------------------------------------------------------------
// Sections (which records go where)
// ---------------------------------------------------------------------------

export interface RecordSection {
  readonly key: string;
  readonly title: string;
  readonly kinds: readonly RecordKind[];
  readonly route: "both" | "eneb_unimarconi";
}

export const RECORD_SECTIONS: readonly RecordSection[] = [
  { key: "eneb", title: "ENEB qualification", kinds: [...ENEB_RECORD_KINDS], route: "both" },
  { key: "eligibility", title: "Eligibility and admission documents", kinds: ["eligibility_review", "undergraduate_documents", "document_legalization", "university_application", "university_admission"], route: "eneb_unimarconi" },
  { key: "registration", title: "University registration", kinds: ["university_registration"], route: "eneb_unimarconi" },
  { key: "recognition", title: "Recognition of earlier learning", kinds: ["recognition_request", "recognition_decision"], route: "eneb_unimarconi" },
  { key: "thesis", title: "Thesis", kinds: ["thesis_topic", "thesis_submission", "thesis_result"], route: "eneb_unimarconi" },
  { key: "graduation", title: "Graduation and conferral", kinds: ["time_requirement", "graduation_procedure", "award_conferral"], route: "eneb_unimarconi" },
  { key: "documents", title: "Official documents", kinds: ["official_transcript", "diploma_ordered", "diploma_issued", "diploma_delivered", "credential_verification"], route: "eneb_unimarconi" },
  { key: "questions", title: "Open institutional questions", kinds: ["institutional_question"], route: "both" },
];

export function sectionsForRoute(route: GraduateRoute): readonly RecordSection[] {
  return RECORD_SECTIONS.filter((s) => s.route === "both" || route === "eneb_unimarconi");
}

export function kindsForRoute(route: GraduateRoute): readonly RecordKind[] {
  return RECORD_KINDS.filter((k) => route === "eneb_unimarconi" || !(UNIVERSITY_RECORD_KINDS as readonly string[]).includes(k));
}

/** Kinds that may still be added: one record per kind except questions (many). */
export function addableKinds(p: StaffGraduateProgramView): readonly RecordKind[] {
  const have = new Set(p.records.map((r) => r.kind));
  return kindsForRoute(p.program.route).filter((k) => k === "institutional_question" || !have.has(k));
}

export function recordsOfSection(p: StaffGraduateProgramView, section: RecordSection): StaffRecordView[] {
  return p.records.filter((r) => (section.kinds as readonly string[]).includes(r.kind));
}

// ---------------------------------------------------------------------------
// Legalization (issuing country, never residence)
// ---------------------------------------------------------------------------

export interface LegalizationLine {
  readonly country: string | null;
  readonly status: "unknown_country" | "no_rule" | "resolved";
  readonly requirements: readonly LegalizationRequirement[];
  readonly text: string;
}

const LEGAL_LABEL: Record<LegalizationRequirement, string> = {
  apostille: "apostille",
  legalization: "consular legalization",
  sworn_translation: "sworn translation",
  declaration_of_value: "declaration of value",
};

export function legalizationLine(p: StaffGraduateProgramView): LegalizationLine | null {
  if (p.program.route !== "eneb_unimarconi") return null;
  const ug = p.records.find((r) => r.kind === "undergraduate_documents");
  const country = ug?.details.issuingCountry ?? null;
  const rule = findRule(p.ruleSet.rules, "undergraduate_document_legalization");
  const res = legalizationRequirements(rule?.value ?? null, country);
  const text =
    res.status === "unknown_country"
      ? "Record the country that issued the bachelor's degree. Residence does not matter."
      : res.status === "no_rule"
        ? `No legalization rule is set for this cohort. Degree issued in ${country}.`
        : res.requirements.length
          ? `Degree issued in ${country}: ${res.requirements.map((r) => LEGAL_LABEL[r]).join(", ")} required under this cohort's terms.`
          : `Degree issued in ${country}: no apostille or legalization required under this cohort's terms.`;
  return { country, status: res.status, requirements: res.requirements, text };
}

// ---------------------------------------------------------------------------
// Forms -> request bodies
// ---------------------------------------------------------------------------

const blank = (v: string | undefined | null): string | null => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

export interface VerifyForm {
  decision: VerifyRecord["decision"];
  outcome: string;
  issuingInstitution: string;
  documentTypeLabel: string;
  documentReference: string;
  documentId: string;
  decisionDate: string;
  effectiveDate: string;
  academicConsequence: string;
  conflictingEvidence: string;
  matricola: string;
  issuingCountry: string;
  note: string;
}

export function verifyFormDefaults(rec: StaffRecordView): VerifyForm {
  return {
    decision: "verified",
    outcome: rec.outcome ?? "",
    issuingInstitution: rec.issuingInstitution ?? "",
    documentTypeLabel: rec.documentTypeLabel ?? "",
    documentReference: rec.documentReference ?? "",
    documentId: rec.documentId ?? "",
    decisionDate: rec.decisionDate ?? "",
    effectiveDate: rec.effectiveDate ?? "",
    academicConsequence: rec.academicConsequence ?? "",
    conflictingEvidence: rec.conflictingEvidence ?? "",
    matricola: rec.details.matricola ?? "",
    issuingCountry: rec.details.issuingCountry ?? "",
    note: "",
  };
}

/** Which evidence fields the dialog shows for a record kind. */
export function verifyFields(kind: RecordKind): { outcomes: readonly string[]; matricola: boolean; issuingCountry: boolean; effectiveDate: boolean; issuers: readonly Institution[] } {
  return {
    outcomes: RECORD_OUTCOMES[kind] ?? [],
    matricola: kind === "university_registration",
    issuingCountry: kind === "undergraduate_documents",
    effectiveDate: kind === "award_conferral",
    issuers: INSTITUTIONS,
  };
}

/** Builds the verifyRecordSchema body. Empty strings become null; the conferral date is only what staff typed. */
export function buildVerifyBody(kind: RecordKind, f: VerifyForm): Record<string, unknown> {
  const details: Record<string, string> = {};
  if (kind === "university_registration" && blank(f.matricola)) details.matricola = f.matricola.trim();
  if (kind === "undergraduate_documents" && blank(f.issuingCountry)) details.issuingCountry = f.issuingCountry.trim().toUpperCase();
  return {
    decision: f.decision,
    outcome: blank(f.outcome),
    issuingInstitution: blank(f.issuingInstitution),
    documentTypeLabel: blank(f.documentTypeLabel),
    documentReference: blank(f.documentReference),
    documentId: blank(f.documentId),
    decisionDate: blank(f.decisionDate),
    effectiveDate: kind === "award_conferral" ? blank(f.effectiveDate) : null,
    effectiveCohort: null,
    academicConsequence: blank(f.academicConsequence),
    conflictingEvidence: blank(f.conflictingEvidence),
    details,
    note: f.note.trim(),
  };
}

/** The only client-side gate: the note is required by the schema. Everything else is judged by the server. */
export function verifySubmitGate(f: VerifyForm): { ok: boolean; reason: string | null } {
  return f.note.trim().length >= 3 ? { ok: true, reason: null } : { ok: false, reason: "Add a note of at least 3 characters explaining what you checked." };
}

export interface EnrollForm {
  offeringId: string;
  ruleSetId: string;
  enrollmentContractTitle: string;
  enrolledAt: string;
  priorBachelorSource: string;
}

export function activeRuleSets(ruleSets: readonly RuleSetRecord[], offeringId: string): RuleSetRecord[] {
  return ruleSets.filter((r) => r.offeringId === offeringId && r.status === "active");
}

export function enrollGate(f: EnrollForm, ruleSets: readonly RuleSetRecord[]): { ok: boolean; reason: string | null } {
  if (!f.offeringId) return { ok: false, reason: "Choose the offering." };
  const rs = ruleSets.find((r) => r.id === f.ruleSetId);
  if (!rs) return { ok: false, reason: "Choose the cohort rule set." };
  if (rs.offeringId !== f.offeringId) return { ok: false, reason: "That rule set belongs to a different offering." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.enrolledAt)) return { ok: false, reason: "Enter the enrollment date." };
  return { ok: true, reason: null };
}

export function buildEnrollBody(f: EnrollForm, ruleSets: readonly RuleSetRecord[]): EnrollProgram {
  const rs = ruleSets.find((r) => r.id === f.ruleSetId);
  return {
    offeringId: f.offeringId,
    ruleSetId: f.ruleSetId,
    cohortLabel: rs?.cohortLabel ?? "",
    enrollmentContractTitle: blank(f.enrollmentContractTitle),
    enrolledAt: f.enrolledAt,
    priorBachelorSource: (f.priorBachelorSource || "unknown") as EnrollProgram["priorBachelorSource"],
  };
}

export interface TrackForm {
  kind: RecordKind;
  trackingStatus: string;
  issuingInstitution: string;
  documentTypeLabel: string;
  documentReference: string;
  documentId: string;
  matricola: string;
  issuingCountry: string;
  topic: string;
  ceremonyDate: string;
  question: string;
  note: string;
}

export const emptyTrackForm = (kind: RecordKind): TrackForm => ({ kind, trackingStatus: "in_progress", issuingInstitution: "", documentTypeLabel: "", documentReference: "", documentId: "", matricola: "", issuingCountry: "", topic: "", ceremonyDate: "", question: "", note: "" });

export function trackFormFromRecord(rec: StaffRecordView): TrackForm {
  return {
    kind: rec.kind,
    trackingStatus: rec.trackingStatus,
    issuingInstitution: rec.issuingInstitution ?? "",
    documentTypeLabel: rec.documentTypeLabel ?? "",
    documentReference: rec.documentReference ?? "",
    documentId: rec.documentId ?? "",
    matricola: rec.details.matricola ?? "",
    issuingCountry: rec.details.issuingCountry ?? "",
    topic: rec.details.topic ?? "",
    ceremonyDate: rec.details.ceremonyDate ?? "",
    question: rec.details.question ?? "",
    note: rec.note ?? "",
  };
}

/**
 * Tracking body. Never contains verification, outcome or any official field:
 * ordinary tracking is never blocked by missing evidence and never official.
 * `existingDetails` is merged so a PATCH does not erase unrelated details.
 */
export function buildTrackBody(f: TrackForm, existingDetails: Record<string, unknown> = {}, includeKind = false): TrackRecord & { kind?: RecordKind } {
  const details: Record<string, unknown> = { ...existingDetails };
  const set = (k: string, v: string) => {
    const t = blank(v);
    if (t) details[k] = t;
    else delete details[k];
  };
  // Only the details this kind edits are touched; other keys are preserved.
  if (f.kind === "university_registration") set("matricola", f.matricola);
  if (f.kind === "undergraduate_documents") set("issuingCountry", f.issuingCountry.toUpperCase());
  if (f.kind === "thesis_topic") set("topic", f.topic);
  if (f.kind === "graduation_procedure") set("ceremonyDate", f.ceremonyDate);
  if (f.kind === "institutional_question") set("question", f.question);
  const body: Record<string, unknown> = {
    trackingStatus: f.trackingStatus,
    issuingInstitution: blank(f.issuingInstitution),
    documentTypeLabel: blank(f.documentTypeLabel),
    documentReference: blank(f.documentReference),
    documentId: blank(f.documentId),
    details,
    note: blank(f.note),
  };
  if (includeKind) body.kind = f.kind;
  return body as TrackRecord & { kind?: RecordKind };
}

export interface ResultForm {
  resultStatus: string;
  gradeValue: string;
  gradeScale: string;
  gradeDisplay: string;
  issuingInstitution: string;
  verificationStatus: string;
  documentReference: string;
  kind: string;
  note: string;
}

export const emptyResultForm = (authority: "eneb" | "unimarconi"): ResultForm => ({ resultStatus: "passed", gradeValue: "", gradeScale: "", gradeDisplay: "", issuingInstitution: authority, verificationStatus: "institution_stated", documentReference: "", kind: "initial", note: "" });

export function buildResultBody(f: ResultForm): RecordSubjectResult {
  const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));
  return {
    resultStatus: f.resultStatus as RecordSubjectResult["resultStatus"],
    gradeValue: num(f.gradeValue),
    gradeScale: num(f.gradeScale),
    gradeDisplay: blank(f.gradeDisplay),
    issuingInstitution: f.issuingInstitution as Institution,
    verificationStatus: f.verificationStatus as RecordSubjectResult["verificationStatus"],
    documentId: null,
    documentReference: blank(f.documentReference),
    kind: f.kind as RecordSubjectResult["kind"],
    note: blank(f.note),
  };
}

/** Verified subject results need the authority's own issuer and a document reference (server enforces). */
export function resultGate(f: ResultForm, authority: "eneb" | "unimarconi"): { ok: boolean; reason: string | null } {
  if (f.verificationStatus === "verified") {
    if (f.issuingInstitution !== authority) return { ok: false, reason: `A verified result must come from ${INSTITUTION_LABEL[authority]}.` };
    if (!f.documentReference.trim()) return { ok: false, reason: "A verified result needs the document reference." };
  }
  return { ok: true, reason: null };
}

export interface CreditForm {
  authority: string;
  recordId: string;
  label: string;
  amount: string;
  unit: string;
  recognitionOutcome: string;
  conditions: string;
}

export const emptyCreditForm = (recordId: string): CreditForm => ({ authority: "university_recognized", recordId, label: "", amount: "", unit: "ECTS", recognitionOutcome: "recognized", conditions: "" });

export function creditGate(f: CreditForm): { ok: boolean; reason: string | null } {
  if (!f.recordId) return { ok: false, reason: "Choose the record this credit comes from." };
  if (!f.label.trim()) return { ok: false, reason: "Name the module or block." };
  const n = Number(f.amount);
  if (f.amount.trim() === "" || !Number.isFinite(n) || n < 0 || n > 120) return { ok: false, reason: "Enter the credits stated by the document (0-120)." };
  if (f.authority === "university_recognized" && f.recognitionOutcome === "recognized_with_conditions" && !f.conditions.trim()) return { ok: false, reason: "State the conditions of the conditional recognition." };
  return { ok: true, reason: null };
}

export function buildCreditBody(f: CreditForm): CreateCreditEntry {
  const recognized = f.authority === "university_recognized";
  return {
    authority: f.authority as CreateCreditEntry["authority"],
    recordId: f.recordId,
    subjectId: null,
    label: f.label.trim(),
    amount: Number(f.amount),
    unit: f.unit as CreateCreditEntry["unit"],
    recognitionOutcome: recognized ? (f.recognitionOutcome as CreateCreditEntry["recognitionOutcome"]) : null,
    conditions: recognized ? blank(f.conditions) : null,
    note: null,
  };
}

// ---------------------------------------------------------------------------
// Misc labels
// ---------------------------------------------------------------------------

export const kindLabel = (k: RecordKind) => RECORD_KIND_LABEL[k];
export const isOfficialRecordKind = (k: string) => (OFFICIAL_RECORD_KINDS as readonly string[]).includes(k);

export function creditLayerText(amount: number | null, unit: string | null): string {
  return amount === null ? "Unknown" : `${amount}${unit ? ` ${unit}` : ""}`;
}

/** Counts shown per programme. "Awaiting verification" is computed from records AND subjects. */
export function programSummary(p: StaffGraduateProgramView): { verified: number; subjectsVerified: number; needAction: number; openQuestions: number; recordsAwaiting: number; subjectsAwaiting: number } {
  const official = p.records.filter((r) => r.official);
  const recordsAwaiting = p.records.filter((r) => r.verificationStatus !== "verified" && (recordActions(r).length > 0 && (r.official ? r.trackingStatus !== "not_started" && r.trackingStatus !== "not_applicable" || isClaimedStatus(r.verificationStatus) : isClaimedStatus(r.verificationStatus)))).length;
  const subjectsAwaiting = p.subjects.filter(subjectNeedsVerification).length;
  return {
    verified: official.filter((r) => r.verificationStatus === "verified").length,
    subjectsVerified: p.subjects.filter((s) => s.resultStatus !== "none" && s.verificationStatus === "verified").length,
    needAction: recordsAwaiting + subjectsAwaiting,
    openQuestions: p.openQuestions.length,
    recordsAwaiting,
    subjectsAwaiting,
  };
}

/** Thesis topic decision: PATCH { outcome }. Only thesis_topic records take an outcome through tracking. */
export const TOPIC_DECISIONS = { approved: "Approve topic", changes_requested: "Request changes" } as const;
export function buildTopicDecisionBody(outcome: keyof typeof TOPIC_DECISIONS): { outcome: string } {
  return { outcome };
}
export function canDecideTopic(rec: { kind: string }): boolean {
  return rec.kind === "thesis_topic";
}


// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

/** A result is on file (passed, failed, ...) but Lumière has not checked it against the issuer's document. */
export function subjectNeedsVerification(s: SubjectRecord): boolean {
  return s.resultStatus !== "none" && s.verificationStatus !== "verified";
}

export function subjectResultText(s: SubjectRecord): string {
  if (s.resultStatus === "none") return RESULT_LABEL.none;
  return `${RESULT_LABEL[s.resultStatus] ?? sentence(humanize(s.resultStatus))}${s.gradeDisplay ? ` ${s.gradeDisplay}` : ""}`;
}

export function subjectAction(s: SubjectRecord): string | null {
  if (!subjectNeedsVerification(s)) return null;
  return s.authority === "eneb" ? "Verify against the ENEB transcript." : "Verify against the university exam record.";
}

export const AUTHORITY_NAME: Record<"eneb" | "unimarconi", string> = { eneb: "ENEB", unimarconi: "University" };

export function subjectGroups(p: StaffGraduateProgramView): { authority: "eneb" | "unimarconi"; title: string; subjects: SubjectRecord[]; unverified: number }[] {
  return (["eneb", "unimarconi"] as const)
    .map((a) => {
      const subjects = p.subjects.filter((s) => s.authority === a);
      return { authority: a, title: a === "eneb" ? "ENEB subjects" : "University subjects", subjects, unverified: subjects.filter(subjectNeedsVerification).length };
    })
    .filter((g) => g.subjects.length > 0);
}

/** Form prefilled to VERIFY an existing result: same grade, evidence level set to verified. */
export function resultFormForVerify(s: SubjectRecord): ResultForm {
  return {
    resultStatus: s.resultStatus === "none" ? "passed" : s.resultStatus,
    gradeValue: s.gradeValue === null ? "" : String(s.gradeValue),
    gradeScale: s.gradeScale === null ? "" : String(s.gradeScale),
    gradeDisplay: s.gradeDisplay ?? "",
    issuingInstitution: s.authority,
    verificationStatus: "verified",
    documentReference: s.documentReference ?? "",
    kind: "initial",
    note: "",
  };
}

// ---------------------------------------------------------------------------
// Credits: shown once, grouped by authority, conditions visible
// ---------------------------------------------------------------------------

export interface CreditGroup {
  readonly authority: CreditAuthority;
  readonly label: string;
  readonly amountText: string;
  readonly state: "recorded" | "unknown" | "not_applicable";
  readonly explanation: string;
  readonly conditionalText: string | null;
  readonly entries: readonly { readonly id: string; readonly text: string; readonly outcome: string | null; readonly conditions: string | null }[];
}

const RECOGNITION_ENTRY_LABEL: Record<string, string> = { recognized: "Recognised", recognized_with_conditions: "Recognised with conditions", not_recognized: "Not recognised" };

export function creditGroups(p: StaffGraduateProgramView): CreditGroup[] {
  return p.creditLayers
    .map((c) => {
      const entries = p.credits
        .filter((e) => e.authority === c.authority)
        .map((e) => ({ id: e.id, text: `${e.label}, ${e.amount} ${e.unit}`, outcome: e.recognitionOutcome ? RECOGNITION_ENTRY_LABEL[e.recognitionOutcome] ?? humanize(e.recognitionOutcome) : null, conditions: e.conditions }));
      return {
        authority: c.authority,
        label: c.label,
        amountText: c.state === "not_applicable" ? "Not applicable" : creditLayerText(c.amount, c.unit),
        state: c.state,
        explanation: c.explanation,
        conditionalText: c.conditionalAmount ? `${c.conditionalAmount}${c.unit ? ` ${c.unit}` : ""} of this only counts if its conditions are met` : null,
        entries,
      };
    })
    // The Universidad Isabel I layer is hidden until something is recorded for it.
    .filter((g) => !(g.authority === "ui1_certified" && g.state !== "recorded" && g.entries.length === 0));
}

// ---------------------------------------------------------------------------
// Two-track summary (compact staff version)
// ---------------------------------------------------------------------------

export type TrackState = "done" | "active" | "attention" | "todo" | "na";
/** verified = checked against the issuer's document; claimed = stated, reported or tracked only; none = not started. */
export type TrackEvidence = "verified" | "claimed" | "none";
export interface TrackNode {
  readonly key: string;
  readonly label: string;
  readonly state: TrackState;
  readonly evidence: TrackEvidence;
  readonly detail: string;
}
export const TRACK_EVIDENCE_LABEL: Record<TrackEvidence, string> = { verified: "Verified", claimed: "Stated or claimed, not verified", none: "Not started" };
export const TRACK_LEGEND: readonly { readonly evidence: TrackEvidence; readonly text: string }[] = [
  { evidence: "verified", text: "Filled: verified" },
  { evidence: "claimed", text: "Hatched: stated or claimed" },
  { evidence: "none", text: "Dashed: not started" },
];
export interface TrackSummary {
  readonly eneb: readonly TrackNode[];
  /** null on an ENEB-only programme. */
  readonly university: readonly TrackNode[] | null;
}

function recNode(key: string, label: string, rec: StaffRecordView | undefined): TrackNode {
  if (!rec) return { key, label, state: "todo", evidence: "none", detail: "No record yet" };
  if (rec.verificationStatus === "verified") return { key, label, state: "done", evidence: "verified", detail: rec.outcome ? `Verified · ${outcomeLabel(rec.outcome)}` : "Verified" };
  if (rec.verificationStatus === "rejected" || rec.verificationStatus === "conflicting") return { key, label, state: "attention", evidence: "claimed", detail: trustBadge(rec.verificationStatus).label };
  if (isClaimedStatus(rec.verificationStatus) || rec.trackingStatus === "in_progress" || rec.trackingStatus === "submitted" || rec.trackingStatus === "completed") {
    return { key, label, state: "active", evidence: "claimed", detail: rec.trackingStatus === "completed" ? "Completed, not verified" : isClaimedStatus(rec.verificationStatus) ? trustBadge(rec.verificationStatus).label : `${trackingLabel(rec.trackingStatus)}, not verified` };
  }
  return { key, label, state: "todo", evidence: "none", detail: trackingLabel(rec.trackingStatus) };
}

/** The ENEB status tile is named after the status itself ("ENEB coursework complete"), never a fixed "Studying". */
function enebStatusNode(p: StaffGraduateProgramView, completion: StaffRecordView | undefined): TrackNode {
  const s = p.program.enebStatus;
  const label = p.studentView.enebStatusLabel;
  if (s === "withdrawn") return { key: "status", label, state: "attention", evidence: "claimed", detail: "Programme closed" };
  if (s === "enrolled") return { key: "status", label, state: "todo", evidence: "none", detail: "Enrolled, not started" };
  if (s === "in_progress") return { key: "status", label, state: "active", evidence: "claimed", detail: "Set by staff, in progress" };
  const checked = s === "completed" && completion?.verificationStatus === "verified";
  return { key: "status", label, state: "done", evidence: checked ? "verified" : "claimed", detail: checked ? "Completion verified" : s === "completed" ? "Completion not yet verified" : "Coursework finished, not yet certified" };
}

export function trackSummary(p: StaffGraduateProgramView): TrackSummary {
  const rec = (k: RecordKind) => p.records.find((r) => r.kind === k);
  const eneb = p.subjects.filter((s) => s.authority === "eneb");
  const enebPassed = eneb.filter((s) => s.resultStatus === "passed");
  const enebChecked = enebPassed.filter((s) => s.verificationStatus === "verified");
  const subjectsDone = eneb.length > 0 && enebPassed.length === eneb.length && enebChecked.length === eneb.length;
  const subjectsNode: TrackNode = !eneb.length
    ? { key: "subjects", label: "Subjects", state: "todo", evidence: "none", detail: "No subjects recorded" }
    : { key: "subjects", label: "Subjects", state: subjectsDone ? "done" : enebPassed.length ? "active" : "todo", evidence: subjectsDone ? "verified" : eneb.some((s) => s.resultStatus !== "none") ? "claimed" : "none", detail: `${enebPassed.length} of ${eneb.length} passed · ${enebChecked.length} checked` };
  const enebNodes: TrackNode[] = [
    enebStatusNode(p, rec("eneb_completion")),
    subjectsNode,
    recNode("completion", "Completion", rec("eneb_completion")),
    recNode("certificate", "Certificate", rec("eneb_certificate")),
  ];
  if (p.program.route !== "eneb_unimarconi") return { eneb: enebNodes, university: null };
  const uni = p.subjects.filter((s) => s.authority === "unimarconi");
  const uniPassed = uni.filter((s) => s.resultStatus === "passed");
  const uniAllChecked = uni.length > 0 && uniPassed.length === uni.length && uni.every((s) => s.verificationStatus === "verified");
  const uniNodes: TrackNode[] = [
    recNode("eligibility", "Eligibility", rec("eligibility_review")),
    recNode("admission", "Admission", rec("university_admission")),
    recNode("registration", "Registration", rec("university_registration")),
    recNode("recognition", "Recognition", rec("recognition_decision") ?? (rec("recognition_request") ? { ...rec("recognition_request")!, kind: "recognition_decision", verificationStatus: "unknown", outcome: null, trackingStatus: "submitted" } : undefined)),
    uni.length ? { key: "uni-subjects", label: "University subjects", state: uniAllChecked ? "done" : uniPassed.length ? "active" : "todo", evidence: uniAllChecked ? "verified" : uni.some((s) => s.resultStatus !== "none") ? "claimed" : "none", detail: `${uniPassed.length} of ${uni.length} passed` } : { key: "uni-subjects", label: "University subjects", state: "todo", evidence: "none", detail: "None recorded" },
    recNode("thesis", "Thesis", rec("thesis_result")),
    recNode("conferral", "Conferral", rec("award_conferral")),
  ];
  return { eneb: enebNodes, university: uniNodes };
}

// ---------------------------------------------------------------------------
// Action queue ("Needs a decision")
// ---------------------------------------------------------------------------

export type QueueCategory = "record_blocked" | "record_ready" | "record_claimed" | "subjects_unverified" | "tracking" | "conditional_credit" | "question" | "evaluation" | "evaluation_preliminary";
export const QUEUE_ORDER: readonly QueueCategory[] = ["record_blocked", "record_ready", "record_claimed", "subjects_unverified", "tracking", "conditional_credit", "question", "evaluation", "evaluation_preliminary"];

export type QueueTarget =
  | { readonly t: "verify-record"; readonly recordId: string }
  | { readonly t: "track-record"; readonly recordId: string }
  | { readonly t: "anchor"; readonly anchor: "subjects" | "credits"; readonly authority?: "eneb" | "unimarconi" }
  | { readonly t: "verify-evaluation"; readonly evaluationId: string };

export interface QueueItem {
  readonly key: string;
  readonly category: QueueCategory;
  readonly title: string;
  readonly detail: string;
  readonly actionLabel: string;
  readonly target: QueueTarget;
  /** Set when the viewer cannot take the action (conferral is admin-only). */
  readonly disabledReason: string | null;
}

type EvaluationRow = StaffGraduateWorkspace["evaluations"][number];

export function evaluationAwaitingVerification(e: Pick<CredentialEvaluationRecord, "status" | "verificationStatus">): boolean {
  return e.status === "completed" && e.verificationStatus !== "verified" && e.verificationStatus !== "rejected";
}

/** Tracking kinds whose job is done once the official record that follows them is verified. */
const DOWNSTREAM_RECORD: Partial<Record<RecordKind, RecordKind>> = {
  recognition_request: "recognition_decision",
  thesis_submission: "thesis_result",
  university_application: "university_admission",
  diploma_ordered: "diploma_issued",
  graduation_procedure: "award_conferral",
};

/**
 * A tracking record is resolved (never queued) when its downstream official record is verified,
 * when a thesis topic is approved, or when staff marked tracking completed. A completed tracking
 * status never resolves a record that still carries an unverified claim.
 */
export function isResolvedTracking(r: StaffRecordView, records: readonly StaffRecordView[]): boolean {
  if (r.official) return false;
  const next = DOWNSTREAM_RECORD[r.kind];
  if (next && records.some((x) => x.kind === next && x.verificationStatus === "verified")) return true;
  if (r.kind === "thesis_topic" && r.outcome === "approved") return true;
  return r.trackingStatus === "completed" && !isClaimedStatus(r.verificationStatus);
}

/** Institutional questions marked completed are Resolved, not open. */
export const isResolvedQuestion = (r: Pick<StaffRecordView, "kind" | "trackingStatus">) => r.kind === "institutional_question" && r.trackingStatus === "completed";

const shortList = (xs: readonly string[], n = 2) => (xs.length <= n ? xs.join(" ") : `${xs.slice(0, n).join(" ")} +${xs.length - n} more`);

function queueItems(p: StaffGraduateProgramView, evaluations: readonly EvaluationRow[], role: "staff" | "admin"): QueueItem[] {
  const items: QueueItem[] = [];
  for (const r of p.records) {
    if (r.verificationStatus === "verified" || r.trackingStatus === "withdrawn") continue;
    if (isResolvedTracking(r, p.records)) continue;
    const claimed = isClaimedStatus(r.verificationStatus);
    if (r.official) {
      const started = (r.trackingStatus !== "not_started" && r.trackingStatus !== "not_applicable") || claimed || r.verificationStatus === "rejected" || r.verificationStatus === "conflicting";
      if (!started) continue;
      const gate = verifyGate(r, role);
      const blocked = r.blockers.length > 0;
      items.push({
        key: `rec-${r.id}`,
        category: blocked ? "record_blocked" : "record_ready",
        title: r.label,
        detail: blocked ? `Missing before it can be verified: ${shortList(missingMessages(r.blockers))}` : recordActions(r)[0] ?? "Verify against the document.",
        actionLabel: "Verify…",
        target: { t: "verify-record", recordId: r.id },
        disabledReason: gate.enabled ? null : gate.reason,
      });
    } else if (claimed) {
      items.push({ key: `rec-${r.id}`, category: "record_claimed", title: r.label, detail: recordActions(r)[0] ?? "", actionLabel: "Update tracking…", target: { t: "track-record", recordId: r.id }, disabledReason: null });
    } else if (r.kind !== "institutional_question" && (r.trackingStatus === "in_progress" || r.trackingStatus === "submitted" || r.trackingStatus === "blocked")) {
      items.push({ key: `trk-${r.id}`, category: "tracking", title: `${r.label}: ${trackingLabel(r.trackingStatus).toLowerCase()}`, detail: "Tracking only, no official status. Update it as the institution responds.", actionLabel: "Update tracking…", target: { t: "track-record", recordId: r.id }, disabledReason: null });
    }
  }
  for (const a of ["eneb", "unimarconi"] as const) {
    const list = p.subjects.filter((s) => s.authority === a && subjectNeedsVerification(s));
    if (!list.length) continue;
    const name = AUTHORITY_NAME[a];
    const stated = list.every((s) => s.verificationStatus === "institution_stated");
    const noun = list.length === 1 ? "result" : "results";
    items.push({
      key: `sub-${a}`,
      category: "subjects_unverified",
      title: stated ? `${list.length} ${name} ${noun} stated by ${a === "eneb" ? "ENEB" : "the university"}, not yet checked` : `${list.length} ${name} ${noun} not yet verified`,
      detail: a === "eneb" ? "Verify against the ENEB transcript." : "Verify against the university exam record.",
      actionLabel: "Review results",
      target: { t: "anchor", anchor: "subjects", authority: a },
      disabledReason: null,
    });
  }
  for (const c of p.credits) {
    if (c.recognitionOutcome !== "recognized_with_conditions") continue;
    items.push({ key: `cond-${c.id}`, category: "conditional_credit", title: `${c.label}, ${c.amount} ${c.unit}: recognised with a condition`, detail: `Waiting on: ${c.conditions ?? "condition not stated"}`, actionLabel: "See credits", target: { t: "anchor", anchor: "credits" }, disabledReason: null });
  }
  for (const q of p.openQuestions.filter((x) => !isResolvedQuestion(x))) {
    items.push({ key: `q-${q.id}`, category: "question", title: `Open question: ${q.details.question ?? "no wording recorded"}`, detail: q.details.owner ? `With ${q.details.owner}.` : "No owner recorded.", actionLabel: "Update…", target: { t: "track-record", recordId: q.id }, disabledReason: null });
  }
  for (const e of evaluations.filter((x) => x.programId === p.program.id && evaluationAwaitingVerification(x))) items.push(evaluationQueueItem(e));
  return items.sort((x, y) => QUEUE_ORDER.indexOf(x.category) - QUEUE_ORDER.indexOf(y.category));
}

/** Low-value items live in the collapsed "Tidy up" group, not in the decision queue. */
export const isTidyItem = (i: QueueItem) => i.category === "tracking" || i.category === "evaluation_preliminary";

/** "Needs a decision": real decisions only. */
export function buildActionQueue(p: StaffGraduateProgramView, evaluations: readonly EvaluationRow[] = [], role: "staff" | "admin" = "staff"): QueueItem[] {
  return queueItems(p, evaluations, role).filter((i) => !isTidyItem(i));
}

/** "Tidy up": tracking-only items still in flight and preliminary tool results. Never counted as decisions. */
export function buildTidyUp(p: StaffGraduateProgramView, evaluations: readonly EvaluationRow[] = [], role: "staff" | "admin" = "staff"): QueueItem[] {
  return queueItems(p, evaluations, role).filter(isTidyItem);
}

/** "WES (United States)" already names its country; other evaluators get the country code appended. */
export function evaluatorWithCountry(e: Pick<EvaluationRow, "evaluator" | "destinationCountry" | "view">): string {
  return evaluatorCountryLock(e.evaluator) ? e.view.evaluatorLabel : `${e.view.evaluatorLabel} (${e.destinationCountry})`;
}

export function evaluationQueueItem(e: EvaluationRow): QueueItem {
  const pre = e.evaluationType === "preliminary_tool";
  return {
    key: `ev-${e.id}`,
    category: pre ? "evaluation_preliminary" : "evaluation",
    title: pre ? `${evaluatorWithCountry(e)} tool result, preliminary` : `${evaluatorWithCountry(e)} evaluation awaiting verification`,
    detail: pre ? "Not an evaluation report. Confirm the tool result is genuine, then request the official report." : e.blockers.length ? `Missing: ${shortList(missingMessages(e.blockers, "evaluation"))}` : "Compare with the evaluator's own report, then verify.",
    actionLabel: pre ? "Confirm tool result…" : "Verify…",
    target: { t: "verify-evaluation", evaluationId: e.id },
    disabledReason: null,
  };
}

/** Evaluations awaiting verification that belong to no programme (the programme queues cannot show them). */
export function unlinkedEvaluationQueue(evaluations: readonly EvaluationRow[], programIds: readonly string[]): QueueItem[] {
  return evaluations.filter((e) => (!e.programId || !programIds.includes(e.programId)) && evaluationAwaitingVerification(e)).map(evaluationQueueItem);
}

// ---------------------------------------------------------------------------
// Inline field errors for the 422 dialog
// ---------------------------------------------------------------------------

const RECORD_FIELD: Partial<Record<GuardCode, string>> = {
  ISSUER_REQUIRED: "v-issuer",
  WRONG_ISSUER: "v-issuer",
  DOCUMENT_TYPE_REQUIRED: "v-doctype",
  DOCUMENT_REFERENCE_REQUIRED: "v-docref",
  DECISION_DATE_REQUIRED: "v-date",
  OUTCOME_REQUIRED: "v-outcome",
  OUTCOME_INVALID: "v-outcome",
  MATRICOLA_REQUIRED: "v-matricola",
  CONFERRAL_DATE_REQUIRED: "v-effective",
  ISSUING_COUNTRY_REQUIRED: "v-country",
  CONFLICT_DETAIL_REQUIRED: "v-conflict",
  DOCUMENT_NOT_OWNED: "v-docid",
  DOCUMENT_NOT_VERIFIED: "v-docid",
};
const EVALUATION_FIELD: Partial<Record<EvaluationGuardCode, string>> = {
  EVALUATOR_COUNTRY_MISMATCH: "ev-country",
  REPORT_DATE_REQUIRED: "ev-date",
  REPORT_REFERENCE_REQUIRED: "ev-ref",
  CONCLUSION_REQUIRED: "ev-conclusion",
  CONCLUSION_TEXT_REQUIRED: "ev-conclusion-text",
  NOT_COMPLETED: "ev-status",
  CONFLICT_DETAIL_REQUIRED: "ev-conflict",
};

/** Maps guard codes to dialog field ids with their plain-language message. Codes with no field stay in the summary only. */
export function fieldErrors(codes: readonly AnyGuardCode[], scope: GuardScope = "record"): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const table = (scope === "evaluation" ? EVALUATION_FIELD : RECORD_FIELD) as Record<string, string | undefined>;
  for (const c of codes) {
    const field = table[c];
    if (!field) continue;
    (out[field] ??= []).push(...missingMessages([c], scope));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Foreign credential evaluations
// ---------------------------------------------------------------------------

export const EVALUATION_NOTE = "An evaluation outcome never changes ENEB or university rules, credits, recognition or graduation. It is evidence about how another country reads the award.";

// Evaluator names are the contract's EVALUATOR_LABEL, exactly as the student sees them.

/** "18 Oct 2026" for a yyyy-mm-dd value; null when it is not a real date. */
export function formatDisplayDate(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1];
  const day = Number(m[3]);
  if (!mon || day < 1 || day > 31) return null;
  return `${day} ${mon} ${m[1]}`;
}
export const DATE_HINT = "e.g. 18 Oct 2026";

/** Where the framing text says "the Italian award" and the student has no university programme, say "the qualification". */
export function evaluationFraming(framing: string, hasUniversityProgramme: boolean): string {
  return hasUniversityProgramme ? framing : framing.replace(/the Italian award/g, "the qualification");
}
export const hasUniversityProgramme = (w: Pick<StaffGraduateWorkspace, "programs">) => w.programs.some((p) => p.program.route === "eneb_unimarconi");

export const EVALUATION_TYPE_SHORT: Record<string, string> = {
  preliminary_tool: "Preliminary — not an evaluation report",
  completed_report: "Completed evaluation report",
  advisory_statement: "Advisory statement — not an evaluation report",
};
export const EVALUATION_STATUS_LABEL: Record<string, string> = { planned: "Planned", submitted: "Submitted to the evaluator", in_progress: "Evaluator working on it", completed: "Completed", withdrawn: "Withdrawn" };
export const EVALUATION_USE_LABEL: Record<string, string> = { employment: "Employment", further_study: "Further study", immigration: "Immigration", professional_licensing: "Professional licensing", other: "Other use" };

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export interface EvaluationRowView {
  readonly id: string;
  readonly evaluator: string;
  readonly country: string;
  readonly qualification: string;
  readonly use: string;
  readonly typeLabel: string;
  readonly preliminary: boolean;
  readonly status: string;
  /** The completed-but-preliminary state reads "Preliminary", never "Completed". */
  readonly nextStep: string | null;
  readonly reportDate: string | null;
  readonly conclusionLabel: string;
  readonly conclusionText: string | null;
  readonly trust: TrustBadge;
  readonly verified: null | { readonly reviewer: string | null; readonly reviewedAt: string | null; readonly reference: string };
  readonly claimed: readonly string[];
  readonly action: readonly string[];
  readonly canVerify: boolean;
  /** Preliminary tool results cannot become an evaluation outcome: the action is a lighter "confirm the tool result". */
  readonly verifyKind: "full" | "tool_result" | null;
}

export function evaluationRow(e: EvaluationRow): EvaluationRowView {
  const verified = e.verificationStatus === "verified";
  const evaluator = e.view.evaluatorLabel;
  const preliminary = e.evaluationType === "preliminary_tool";
  const claimed: string[] = [];
  if (!verified) {
    if (e.verificationStatus !== "unknown") claimed.push(trustBadge(e.verificationStatus).label);
    if (e.conclusion !== "not_yet_known") claimed.push(`Conclusion recorded: ${EVALUATION_CONCLUSION_LABEL[e.conclusion]}`);
    if (e.reportReference) claimed.push(`Reference stated: ${e.reportReference}`);
    if (e.reportDate) claimed.push(`Report date stated: ${e.reportDate}`);
  }
  if (e.conflictingEvidence) claimed.push(`Conflicting evidence: ${e.conflictingEvidence}`);
  const action: string[] = [];
  if (!verified) {
    if (e.status !== "completed") action.push(e.status === "withdrawn" ? "Withdrawn. Nothing to verify." : "Waiting for the evaluator. Update the status when the result arrives.");
    else if (preliminary) action.push("Confirm the tool result is genuine. It stays preliminary and is not an evaluation report.");
    else if (e.blockers.length) action.push(...missingMessages(e.blockers, "evaluation"));
    else action.push("Compare with the evaluator's own report, then verify.");
  }
  return {
    id: e.id,
    evaluator,
    country: evaluatorCountryLock(e.evaluator) ? countryName(e.destinationCountry) : `${countryName(e.destinationCountry)} (${e.destinationCountry})`,
    qualification: e.qualificationEvaluated,
    use: EVALUATION_USE_LABEL[e.intendedUse] ?? humanize(e.intendedUse),
    typeLabel: EVALUATION_TYPE_SHORT[e.evaluationType] ?? e.view.typeLabel,
    preliminary: e.evaluationType === "preliminary_tool",
    status: preliminary && e.status === "completed" ? EVALUATION_TYPE_SHORT.preliminary_tool : EVALUATION_STATUS_LABEL[e.status] ?? humanize(e.status),
    nextStep: preliminary && !verified ? (e.evaluator === "wes_us" || e.evaluator === "wes_canada" ? "Next step: request the official WES report for this country and purpose" : "Next step: request the official evaluation report from the evaluator for this country and purpose") : null,
    reportDate: e.reportDate,
    conclusionLabel: EVALUATION_CONCLUSION_LABEL[e.conclusion],
    conclusionText: e.conclusionText,
    trust: trustBadge(e.verificationStatus),
    verified: verified ? { reviewer: e.reviewerUserId, reviewedAt: date10(e.reviewedAt), reference: e.reportReference ?? (e.documentId ? "attached report" : "no reference") } : null,
    claimed,
    action,
    canVerify: !verified && e.status === "completed",
    verifyKind: verified || e.status !== "completed" ? null : preliminary ? "tool_result" : "full",
  };
}

export const evaluationsOf = (w: Pick<StaffGraduateWorkspace, "evaluations">): readonly EvaluationRow[] => w.evaluations ?? [];

/** The country is locked (and preset) for evaluators that report for one country only. */
export const evaluatorCountryLock = (e: string): string | null => (EVALUATOR_FIXED_COUNTRY as Record<string, string | undefined>)[e] ?? null;

export interface EvaluationForm {
  programId: string;
  evaluator: string;
  evaluatorName: string;
  destinationCountry: string;
  qualificationEvaluated: string;
  awardingInstitution: string;
  intendedUse: string;
  evaluationType: string;
  status: string;
  reportDate: string;
  reportReference: string;
  documentId: string;
  conclusion: string;
  conclusionText: string;
  note: string;
}

export const emptyEvaluationForm = (program?: StaffGraduateProgramView): EvaluationForm => ({
  programId: program?.program.id ?? "",
  evaluator: "wes_us",
  evaluatorName: "",
  destinationCountry: "US",
  qualificationEvaluated: program ? program.program.enrollmentContractTitle ?? program.offering.universityLegalTitle ?? program.offering.marketingTitle : "",
  awardingInstitution: program?.offering.awardingInstitution ?? "unimarconi",
  intendedUse: "employment",
  evaluationType: "preliminary_tool",
  status: "planned",
  reportDate: "",
  reportReference: "",
  documentId: "",
  conclusion: "not_yet_known",
  conclusionText: "",
  note: "",
});

/** Changing the evaluator presets and locks the country when the evaluator is tied to one. */
export function setEvaluator(f: EvaluationForm, evaluator: string): EvaluationForm {
  const lock = evaluatorCountryLock(evaluator);
  return { ...f, evaluator, destinationCountry: lock ?? f.destinationCountry };
}

export function buildEvaluationBody(f: EvaluationForm): Record<string, unknown> {
  const lock = evaluatorCountryLock(f.evaluator);
  return {
    programId: blank(f.programId),
    evaluator: f.evaluator,
    evaluatorName: blank(f.evaluatorName),
    destinationCountry: (lock ?? f.destinationCountry).trim().toUpperCase(),
    qualificationEvaluated: f.qualificationEvaluated.trim(),
    awardingInstitution: f.awardingInstitution,
    intendedUse: f.intendedUse,
    evaluationType: f.evaluationType,
    status: f.status,
    reportDate: blank(f.reportDate),
    reportReference: blank(f.reportReference),
    documentId: blank(f.documentId),
    conclusion: f.conclusion,
    conclusionText: blank(f.conclusionText),
    note: blank(f.note),
  };
}

export function evaluationFormGate(f: EvaluationForm): { ok: boolean; reason: string | null } {
  const parsed = recordEvaluationSchema.safeParse(buildEvaluationBody(f));
  if (parsed.success) return { ok: true, reason: null };
  const issue = parsed.error.issues[0];
  const path = String(issue.path[0] ?? "");
  const reasons: Record<string, string> = {
    destinationCountry: "Enter the two-letter country code, for example US.",
    qualificationEvaluated: "Enter the qualification exactly as submitted to the evaluator.",
    evaluatorName: "Name the evaluator.",
  };
  return { ok: false, reason: reasons[path] ?? issue.message };
}

export interface EvaluationUpdateForm {
  status: string;
  reportDate: string;
  reportReference: string;
  documentId: string;
  conclusion: string;
  conclusionText: string;
  note: string;
}

export const evaluationUpdateDefaults = (e: EvaluationRow): EvaluationUpdateForm => ({
  status: e.status,
  reportDate: e.reportDate ?? "",
  reportReference: e.reportReference ?? "",
  documentId: e.documentId ?? "",
  conclusion: e.conclusion,
  conclusionText: e.conclusionText ?? "",
  note: e.note ?? "",
});

/**
 * PATCH body. A verified evaluation accepts only note and status (the server answers 409 otherwise),
 * so only those two are sent for it.
 */
export function buildEvaluationUpdateBody(f: EvaluationUpdateForm, verified: boolean): Record<string, unknown> {
  if (verified) return { status: f.status, note: blank(f.note) };
  return { status: f.status, reportDate: blank(f.reportDate), reportReference: blank(f.reportReference), documentId: blank(f.documentId), conclusion: f.conclusion, conclusionText: blank(f.conclusionText), note: blank(f.note) };
}

export interface EvaluationVerifyForm {
  decision: "verified" | "rejected" | "conflicting";
  conflictingEvidence: string;
  note: string;
}
export const emptyEvaluationVerifyForm = (): EvaluationVerifyForm => ({ decision: "verified", conflictingEvidence: "", note: "" });
export const EVALUATION_DECISION_LABEL: Record<string, string> = { verified: "Verified: matches the evaluator's report", conflicting: "Evidence conflicts", rejected: "Not accepted" };

export function buildEvaluationVerifyBody(f: EvaluationVerifyForm): Record<string, unknown> {
  return { decision: f.decision, conflictingEvidence: f.decision === "conflicting" ? blank(f.conflictingEvidence) : null, note: f.note.trim() };
}
export function evaluationVerifyGate(f: EvaluationVerifyForm): { ok: boolean; reason: string | null } {
  return f.note.trim().length >= 3 ? { ok: true, reason: null } : { ok: false, reason: "Add a note of at least 3 characters explaining what you checked." };
}

export const EVALUATION_OPTIONS = {
  evaluators: EVALUATORS.map((x) => ({ value: x, label: EVALUATOR_LABEL[x] })),
  types: EVALUATION_TYPES.map((x) => ({ value: x, label: EVALUATION_TYPE_SHORT[x] })),
  uses: EVALUATION_USES.map((x) => ({ value: x, label: EVALUATION_USE_LABEL[x] })),
  statuses: EVALUATION_STATUSES.map((x) => ({ value: x, label: EVALUATION_STATUS_LABEL[x] })),
  conclusions: EVALUATION_CONCLUSIONS.map((x) => ({ value: x, label: EVALUATION_CONCLUSION_LABEL[x] })),
} as const;

export { CREDIT_AUTHORITY_LABEL };

/** Badge for a record: tracking-only records are labelled as such unless a claim is attached. */
export function recordBadge(rec: StaffRecordView): TrustBadge {
  if (!rec.official && !isClaimedStatus(rec.verificationStatus)) return { label: `Tracking only · ${trackingLabel(rec.trackingStatus).toLowerCase()}`, tone: "reported" };
  if (rec.official && rec.verificationStatus === "unknown") return { label: "Not verified", tone: "reported" };
  return trustBadge(rec.verificationStatus);
}

export function trackNodeTone(state: TrackState): TrustBadge["tone"] {
  return state === "done" ? "verified" : state === "active" ? "pending" : state === "attention" ? "problem" : "reported";
}
export const TRACK_STATE_LABEL: Record<TrackState, string> = { done: "Done", active: "In progress", attention: "Needs attention", todo: "Not started", na: "Not applicable" };
