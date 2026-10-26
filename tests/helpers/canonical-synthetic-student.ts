/**
 * ONE canonical synthetic student (Amélie Laurent, LUM-0001) for every consolidated
 * screen. Every renderer input (roadmap, degree progress, profile for the student
 * and for staff, documents, support tickets, identity corrections, guardian
 * contacts, staff workspace) is DERIVED from the data below through the real
 * read-model code (buildStudentProfileView, priorCredentialsFromSources) or the
 * existing view-model fixtures, never typed again per screen.
 *
 * tests/s10-canonical-student-consistency.test.ts asserts the derived inputs agree.
 * All data is synthetic (@synthetic.example, 555 numbers).
 */
import type { IdentityCorrectionRequestView, StudentProfileView } from "../../shared/student-profile-contract";
import type { StudentDegreeProgressView } from "../../shared/student-degree-progress-view";
import {
  buildStudentProfileView,
  priorCredentialsFromSources,
  toContactView,
} from "../../server/services/student-profile-read-model";
import { COMPOSED } from "./student-progress-ui-fixtures";
import { RICH_MID_JOURNEY } from "./student-roadmap-ui-fixtures";
import { ALL_DETAILS, SUPPORT_NOW, toSummary } from "./support-ui-fixtures";

export const CANONICAL_NOW = SUPPORT_NOW;

/** The single student record (storage shape, snake_case) every view is built from. */
export const CANONICAL_STUDENT_ROW = {
  id: "11111111-aaaa-4bbb-8ccc-000000000009",
  user_id: "u1",
  student_code: "LUM-0001",
  status: "active",
  first_name: "Amélie",
  middle_name: null,
  last_name: "Laurent",
  preferred_name: "Amy",
  dob: "1996-05-14",
  sex: "Female",
  nationality: ["Canadian"],
  gov_id_type: "Passport",
  gov_id_number: "AB123318",
  email: "amelie.laurent@synthetic.example",
  email_verified_at: "2026-01-05T10:00:00.000Z",
  phone_primary: "+1 514 555 0100",
  phone_secondary: null,
  whatsapp_primary: true,
  timezone: "America/Toronto",
  preferred_contact_channel: "whatsapp",
  address_line1: "88 Rue des Lilas",
  address_line2: null,
  address_city: "Montréal",
  address_state: "QC",
  address_postal: "H2X 1Y4",
  address_country: "Canada",
  marketing_opt_in: false,
  media_release: false,
  residency: "foreign",
  hs_completion: true,
  hs_path: "local_diploma",
  hs_school: "Collège Jean-de-Brébeuf",
  hs_country: "Canada",
  hs_year: 2014,
  prior_credits: true,
  photo_url: null,
} as const;

export const CANONICAL_ID = CANONICAL_STUDENT_ROW.id;
export const CANONICAL_ADVISOR = { id: "advisor-1", name: "Camille Moreau", role: "staff" as const };

/** Documents on file (storage rows). The Documents page, Profile and Staff panel all read these. */
export const CANONICAL_DOCUMENT_ROWS = [
  { id: "d1", doc_type: "hs_transcript", file_name: "high-school-transcript.pdf", file_size: 482113, mime_type: "application/pdf", status: "verified", required_for_enrollment: true, uploaded_at: "2026-09-10T10:00:00.000Z", verified_at: "2026-09-12T10:00:00.000Z", updated_at: "2026-09-12T10:00:00.000Z" },
  { id: "d2", doc_type: "id_gov", file_name: "government-id.png", file_size: 912344, mime_type: "image/png", status: "pending", required_for_enrollment: true, uploaded_at: "2026-10-20T10:00:00.000Z", verified_at: null, updated_at: "2026-10-20T10:00:00.000Z" },
  { id: "d3", doc_type: "college_transcript", file_name: "transfer-transcript.pdf", file_size: 733201, mime_type: "application/pdf", status: "pending", required_for_enrollment: false, uploaded_at: "2026-10-22T10:00:00.000Z", verified_at: null, updated_at: "2026-10-22T10:00:00.000Z" },
] as const;
// No consent_form on file: the guardian below is waiting for the student to upload one.

/** Guardian / emergency contacts (storage rows). */
export const CANONICAL_CONTACT_ROWS = [
  { id: "c1", type: "guardian", full_name: "Odile Laurent", relationship: "Mother", phone: "+1 514 555 0110", email: "odile@synthetic.example", language: null, scopes: ["emergency", "academic", "financial"], authority_status: "pending_verification", created_at: "2026-10-20T10:00:00.000Z" },
  { id: "c2", type: "emergency", full_name: "Diego Ruiz", relationship: "Friend", phone: "+1 514 555 0177", email: null, language: null, scopes: ["emergency"], authority_status: "listed", created_at: "2026-10-01T10:00:00.000Z" },
] as const;

export const CANONICAL_PENDING_CORRECTION: IdentityCorrectionRequestView = {
  id: "corr-0001", studentId: CANONICAL_ID, status: "pending", fields: ["last_name", "gov_id_number"],
  currentDisplay: { last_name: "Laurent", gov_id_number: "•••• 3318" },
  requestedDisplay: { last_name: "Laurent-Moreau", gov_id_number: "•••• 8830" },
  reason: "My legal surname changed after marriage; the new passport is attached.", evidenceDocumentId: "d2",
  createdAt: "2026-10-22T14:05:00.000Z", reviewedAt: null, reviewNote: null, reviewerUserId: null,
};
export const CANONICAL_OLD_REJECTED_CORRECTION: IdentityCorrectionRequestView = {
  ...CANONICAL_PENDING_CORRECTION, id: "corr-0000", status: "rejected", fields: ["dob"],
  currentDisplay: { dob: "1996-05-14" }, requestedDisplay: { dob: "1996-05-24" },
  reason: "Typo in date of birth.", evidenceDocumentId: null, createdAt: "2026-09-01T10:00:00.000Z", reviewedAt: "2026-09-02T09:00:00.000Z",
  reviewNote: "The passport shows 14 May 1996; no change needed.", reviewerUserId: "staff-1",
};

const rich: any = RICH_MID_JOURNEY;

/** The profile exactly as the API would serve it. withPendingCorrection=false is the moment BEFORE the student sent the request. */
export function canonicalProfileView(opts: { withPendingCorrection?: boolean } = {}): StudentProfileView {
  const withPending = opts.withPendingCorrection ?? true;
  return buildStudentProfileView({
    student: CANONICAL_STUDENT_ROW as any,
    contacts: CANONICAL_CONTACT_ROWS.map((r) => toContactView(r as unknown as Record<string, unknown>)),
    documents: CANONICAL_DOCUMENT_ROWS.map((d) => ({ id: d.id, doc_type: d.doc_type, status: d.status, required_for_enrollment: d.required_for_enrollment, updated_at: d.updated_at })),
    englishProof: { proof_type: "TOEFL iBT", meets_requirement: true },
    corrections: withPending ? [CANONICAL_PENDING_CORRECTION, CANONICAL_OLD_REJECTED_CORRECTION] : [CANONICAL_OLD_REJECTED_CORRECTION],
    // Same derivation as production: one row per canonical academic source (the roadmap's foundation sources).
    priorCredentials: priorCredentialsFromSources(rich.foundation.sources),
    photoUrl: null,
    role: "student",
    now: CANONICAL_NOW,
  });
}

export const canonicalCorrections = (withPending = true) =>
  withPending ? [CANONICAL_PENDING_CORRECTION, CANONICAL_OLD_REJECTED_CORRECTION] : [CANONICAL_OLD_REJECTED_CORRECTION];

/** GET /api/students/me */
export function canonicalStudentMe() {
  const r = CANONICAL_STUDENT_ROW;
  return { id: r.id, user_id: r.user_id, student_code: r.student_code, first_name: r.first_name, last_name: r.last_name, preferred_name: r.preferred_name, email: r.email, phone: r.phone_primary, photo_url: null, residency: r.residency, status: r.status };
}

/** GET /api/documents/student/:id */
export function canonicalDocumentsApi() {
  return CANONICAL_DOCUMENT_ROWS.map((d) => ({ ...d, student_id: CANONICAL_ID, notes: null, created_at: d.uploaded_at }));
}

/** GET /api/student/degree-progress: the roadmap's foundation numbers, so both screens quote the same credits. */
export function canonicalDegreeProgress(): StudentDegreeProgressView {
  const f = rich.foundation;
  const objective = rich.objectives.find((o: any) => o.kind === "primary");
  const required = Number(f.ladder.required);
  const applied = Number(f.ladder.applied);
  return {
    ...COMPOSED,
    asOf: CANONICAL_NOW.toISOString(),
    program: { ...COMPOSED.program!, programName: objective.canonicalProgramName, programCode: objective.credentialLabel },
    totals: {
      unit: "credit",
      requiredCredits: f.ladder.required,
      appliedCredits: f.ladder.applied,
      remainingCredits: (required - applied).toFixed(2),
      verifiedCreditsOnRecord: f.ladder.verified,
      requirementsSatisfied: 1,
      requirementsTotal: 4,
    },
    sources: f.sources.map((s: any) => ({ sourceId: s.sourceId, title: s.title, sourceType: s.sourceType, status: s.status, sourceDate: null, receivedAt: null, creditRecordCount: s.creditRecordCount })),
  } as StudentDegreeProgressView;
}

/** Support tickets, with the advisor bound by id so list cards and detail dropdowns agree. */
export const canonicalTicketDetails = () => ALL_DETAILS.map((d) => ({ ...d, assigned_to: d.assignee?.id ?? null }));
export const canonicalTicketSummaries = () => canonicalTicketDetails().map((d) => toSummary(d as any));

/** GET /api/admin/students/:id/workspace, populated from the same academic sources and credentials. */
export function canonicalWorkspacePayload() {
  const f = rich.foundation;
  const objective = rich.objectives.find((o: any) => o.kind === "primary");
  const r = CANONICAL_STUDENT_ROW;
  return {
    student: { id: r.id, first_name: r.first_name, last_name: r.last_name, preferred_name: r.preferred_name, email: r.email, student_code: r.student_code },
    report: { status: f.degreeState },
    program: { id: "prog-bba", name: objective.canonicalProgramName },
    programVersion: { id: "pv-bba", versionLabel: `Plan v${rich.plan.versionNumber}` },
    asOf: CANONICAL_NOW.toISOString(),
    snapshot: { asOf: CANONICAL_NOW.toISOString(), fingerprint: `sha256:${"ab12".repeat(16)}` },
    needsAttention: { groups: {}, diagnostics: [], integrationDiagnostics: [], reasons: [] },
    displayLabels: { programs: { "prog-bba": objective.canonicalProgramName }, programVersions: { "pv-bba": { label: `Plan v${rich.plan.versionNumber}` } } },
    academicDetail: {
      academicSources: f.sources.map((s: any) => ({ id: s.sourceId, title: s.title, sourceType: s.sourceType, status: s.status })),
      creditRecords: f.credentials.map((c: any, i: number) => ({
        id: c.creditRecordId, sourceId: f.sources[i]?.sourceId, rawTitle: c.title, recordType: "transfer",
        status: c.standing, rawCredits: c.reportedCredits, normalizedCredits: c.awardedCredits ?? undefined, term: c.completedOn?.slice(0, 4),
      })),
      latestVerifications: {}, latestDecisions: {}, placements: [],
    },
  };
}
