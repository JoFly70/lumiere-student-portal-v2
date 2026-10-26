/**
 * S12 — pure presentation logic for the staff graduate-programme workspace.
 * No React, no I/O: unit-tested by tests/s12-staff-graduate-review.test.ts.
 *
 * Central principle: for every record show three things at a glance:
 *   VERIFIED (issuer, document, date, reviewer), CLAIMED / REPORTED (not yet
 *   official) and ACTION (what still blocks `verified`, in plain language).
 */
import {
  GUARD_MESSAGES,
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
  type GraduateRoute,
  type GuardCode,
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
  readonly missing: readonly GuardCode[];
}

/** `apiRequest` throws `Error("<status>: <body text>")`. */
export function parseApiFailure(err: unknown): ApiFailure {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const m = /^(\d{3}):\s*([\s\S]*)$/.exec(raw);
  const status = m ? Number(m[1]) : 0;
  let code: string | null = null;
  let message = "";
  let missing: GuardCode[] = [];
  if (m) {
    try {
      const body = JSON.parse(m[2]) as { error?: unknown };
      if (body && typeof body.error === "object" && body.error) {
        const e = body.error as { code?: unknown; message?: unknown; missing?: unknown };
        code = typeof e.code === "string" ? e.code : null;
        message = typeof e.message === "string" ? e.message : "";
        if (Array.isArray(e.missing)) missing = e.missing.filter((x): x is GuardCode => typeof x === "string" && x in GUARD_MESSAGES);
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

export function missingMessages(codes: readonly GuardCode[]): string[] {
  return codes.map((c) => GUARD_MESSAGES[c] ?? c);
}

/** Dialog feedback for a failed submit: 422 lists what is missing, others one line. */
export function failureSummary(f: ApiFailure): { headline: string; items: string[] } {
  if (f.status === 422 && f.code === "GRADUATE_EVIDENCE_REQUIRED") {
    return { headline: "Not saved. The evidence is incomplete:", items: missingMessages(f.missing) };
  }
  if (f.status === 422) return { headline: f.message, items: missingMessages(f.missing) };
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

export function recordTriad(rec: StaffRecordView): RecordTriad {
  const isVerified = rec.verificationStatus === "verified";
  const verified = isVerified
    ? {
        issuer: rec.issuingInstitution ? INSTITUTION_LABEL[rec.issuingInstitution] : "Issuer not recorded",
        document: [rec.documentTypeLabel, rec.documentReference ? `ref. ${rec.documentReference}` : rec.documentId ? "attached document" : null].filter(Boolean).join(" · ") || "Document not described",
        decisionDate: rec.decisionDate,
        effectiveDate: rec.effectiveDate,
        outcome: rec.outcome,
        reviewer: rec.reviewerUserId,
        reviewedAt: date10(rec.reviewedAt),
      }
    : null;
  const claimed: string[] = [];
  if (!isVerified) {
    if (rec.verificationStatus !== "unknown") claimed.push(verificationLabel(rec.verificationStatus));
    if (rec.outcome) claimed.push(`Outcome claimed: ${rec.outcome}`);
    if (rec.issuingInstitution) claimed.push(`Issuer stated: ${INSTITUTION_LABEL[rec.issuingInstitution]}`);
    if (rec.documentReference) claimed.push(`Reference stated: ${rec.documentReference}`);
    if (rec.details.matricola) claimed.push(`Matricola stated: ${rec.details.matricola}`);
    if (rec.details.issuingCountry) claimed.push(`Issued in: ${rec.details.issuingCountry}`);
    if (rec.trackingStatus !== "not_started") claimed.push(`Tracking: ${rec.trackingStatus.replace(/_/g, " ")}`);
  }
  if (rec.conflictingEvidence) claimed.push(`Conflicting evidence: ${rec.conflictingEvidence}`);
  const action = isVerified ? [] : missingMessages(rec.blockers);
  return { verified, claimed, action, officialKind: rec.official };
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

/** Counts shown in the panel header: official items awaiting action and open questions. */
export function programSummary(p: StaffGraduateProgramView): { verified: number; needAction: number; openQuestions: number } {
  const official = p.records.filter((r) => r.official);
  return {
    verified: official.filter((r) => r.verificationStatus === "verified").length,
    needAction: official.filter((r) => r.verificationStatus !== "verified" && r.trackingStatus !== "not_applicable" && r.trackingStatus !== "not_started").length,
    openQuestions: p.openQuestions.length,
  };
}
