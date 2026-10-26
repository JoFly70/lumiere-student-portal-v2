/**
 * Synthetic StudentProfileView fixtures for the S09 profile UI tests and
 * screenshot pages. No real people, IDs or documents.
 */
import type { IdentityCorrectionRequestView, StudentContactView, StudentProfileView } from "../../shared/student-profile-contract";

const NOW = "2026-10-20T15:00:00.000Z";

const contact = (over: Partial<StudentContactView> & Pick<StudentContactView, "id" | "fullName">): StudentContactView => ({
  type: "emergency",
  relationship: "Friend",
  phone: "+1 555 010 0000",
  email: null,
  language: null,
  requestedScopes: ["emergency"],
  effectiveScopes: ["emergency"],
  authorityStatus: "listed",
  authorityVerifiedAt: null,
  authorityNote: null,
  hasPortalAccess: false,
  createdAt: "2026-08-01T12:00:00.000Z",
  ...over,
});

export const RICH_PROFILE: StudentProfileView = {
  identity: {
    studentId: "stu-demo-001",
    studentCode: "LUM-24-0417",
    firstName: "Amara",
    middleName: "Nkechi",
    lastName: "Okafor-Demo",
    preferredName: "Amy",
    dob: "2001-04-17",
    sex: "Female",
    nationality: ["Nigerian", "British"],
    govIdType: "Passport",
    govIdNumberMasked: "•••• 4821",
    photoUrl: null,
    verification: "verified",
    pendingCorrection: {
      id: "corr-001",
      studentId: "stu-demo-001",
      status: "pending",
      fields: ["last_name", "gov_id_number"],
      currentDisplay: { last_name: "Okafor-Demo", gov_id_number: "•••• 4821" },
      requestedDisplay: { last_name: "Okafor-Sample", gov_id_number: "•••• 9930" },
      reason: "My passport was reissued after I married and the surname changed.",
      evidenceDocumentId: null,
      createdAt: "2026-10-12T09:00:00.000Z",
      reviewedAt: null,
      reviewNote: null,
      reviewerUserId: null,
    },
    lastResolvedCorrection: null,
  },
  contact: {
    email: "amara.demo@example.test",
    emailVerified: true,
    phonePrimary: "+1 555 010 1234",
    phoneSecondary: null,
    whatsappPrimary: true,
    timezone: "America/New_York",
    preferredContactChannel: "whatsapp",
    addressLine1: "12 Sample Street",
    addressLine2: "Apt 4B",
    addressCity: "Springfield",
    addressState: "IL",
    addressPostal: "62701",
    addressCountry: "United States",
    marketingOptIn: false,
    mediaRelease: true,
  },
  contacts: [
    contact({ id: "c-1", fullName: "Chidi Okafor-Demo", type: "parent", relationship: "Father", email: "chidi@example.test", requestedScopes: ["emergency", "academic"], effectiveScopes: ["emergency", "academic"], authorityStatus: "verified", authorityVerifiedAt: "2026-09-01T10:00:00.000Z" }),
    contact({ id: "c-2", fullName: "Ngozi Eze-Demo", type: "guardian", relationship: "Aunt", requestedScopes: ["emergency", "financial", "release"], effectiveScopes: ["emergency"], authorityStatus: "pending_verification" }),
    contact({ id: "c-3", fullName: "Taylor Reed-Demo", type: "emergency", relationship: "Roommate" }),
    contact({ id: "c-4", fullName: "Jordan Lake-Demo", type: "representative", relationship: "Family attorney", requestedScopes: ["academic"], effectiveScopes: [], authorityStatus: "revoked", authorityNote: "The consent document was unsigned." }),
  ],
  academicBackground: {
    highSchool: { completionRecorded: true, path: "foreign", school: "Sample Grammar School", country: "Nigeria", year: 2019, evidence: "pending" },
    priorCredentials: [{ label: "Diploma in Business Studies", institution: "Demo Polytechnic", detail: "2020", status: "Recorded" }],
    priorCreditsReported: true,
    foreignEvaluation: "pending",
    collegeTranscripts: "verified",
    degreeCertificate: "not_submitted",
  },
  eligibility: {
    residency: "foreign",
    residencyEvidence: "verified",
    englishProficiency: { meetsRequirement: true, proofType: "TOEFL iBT", evidence: "verified" },
    documents: [
      { docType: "id_gov", label: "Government ID", status: "verified", requiredForEnrollment: true, updatedAt: NOW },
      { docType: "hs_transcript", label: "High school transcript", status: "pending", requiredForEnrollment: true, updatedAt: NOW },
      { docType: "english_proof", label: "English proficiency proof", status: "rejected", requiredForEnrollment: true, updatedAt: NOW },
      { docType: "residency_proof", label: "Proof of residency", status: "resubmit_requested", requiredForEnrollment: false, updatedAt: NOW },
      { docType: "degree_certificate", label: "Degree certificate", status: "not_submitted", requiredForEnrollment: false, updatedAt: null },
    ],
  },
  // Mirrors what buildStudentProfileView derives from the documents and contacts above:
  // every rejected / resubmit-requested document and every contact still needing a consent is student action.
  readiness: [
    { key: "document:english_cert", kind: "action_required", label: "English proficiency proof needs to be resubmitted", detail: "Lumière could not accept the file you sent.", section: "eligibility" },
    { key: "document:residency_doc", kind: "action_required", label: "Proof of residency needs to be resubmitted", detail: null, section: "eligibility" },
    { key: "contact_authority:c-2", kind: "action_required", label: "Upload a signed consent for Ngozi Eze-Demo", detail: "Lumière verifies authority from a signed consent or legal document.", section: "contacts" },
    { key: "contact_authority:c-4", kind: "action_required", label: "Jordan Lake-Demo: authority was not approved", detail: "The consent document was unsigned.", section: "contacts" },
    { key: "document:hs_transcript", kind: "pending_review", label: "High school transcript under review", detail: null, section: "eligibility" },
    { key: "contact_authority:c-1", kind: "complete", label: "Chidi Okafor-Demo: authority verified", detail: null, section: "contacts" },
    { key: "identity_document", kind: "complete", label: "Identity document verified", detail: null, section: "identity" },
  ],
  account: { role: "student", twoFactorAvailable: true },
  generatedAt: NOW,
};

export const NEW_STUDENT_PROFILE: StudentProfileView = {
  identity: {
    studentId: "stu-demo-002",
    studentCode: "LUM-26-0002",
    firstName: "Sam",
    middleName: null,
    lastName: "Rivera-Demo",
    preferredName: null,
    dob: null,
    sex: null,
    nationality: [],
    govIdType: null,
    govIdNumberMasked: null,
    photoUrl: null,
    verification: "not_submitted",
    pendingCorrection: null,
    lastResolvedCorrection: null,
  },
  contact: {
    email: "sam.demo@example.test",
    emailVerified: false,
    phonePrimary: null,
    phoneSecondary: null,
    whatsappPrimary: false,
    timezone: null,
    preferredContactChannel: "email",
    addressLine1: null,
    addressLine2: null,
    addressCity: null,
    addressState: null,
    addressPostal: null,
    addressCountry: null,
    marketingOptIn: false,
    mediaRelease: false,
  },
  contacts: [],
  academicBackground: {
    highSchool: { completionRecorded: false, path: null, school: null, country: null, year: null, evidence: "not_submitted" },
    priorCredentials: [],
    priorCreditsReported: false,
    foreignEvaluation: "not_submitted",
    collegeTranscripts: "not_submitted",
    degreeCertificate: "not_submitted",
  },
  eligibility: {
    residency: null,
    residencyEvidence: "not_submitted",
    englishProficiency: { meetsRequirement: null, proofType: null, evidence: "not_submitted" },
    documents: [
      { docType: "id_gov", label: "Government ID", status: "not_submitted", requiredForEnrollment: true, updatedAt: null },
      { docType: "hs_transcript", label: "High school transcript", status: "not_submitted", requiredForEnrollment: true, updatedAt: null },
    ],
  },
  readiness: [
    { key: "phone", kind: "missing", label: "Add a primary phone number", detail: null, section: "contact" },
    { key: "address", kind: "missing", label: "Add your mailing address", detail: null, section: "contact" },
    { key: "id_gov", kind: "missing", label: "Upload a government ID", detail: "Needed to verify your identity.", section: "identity" },
    { key: "email_verify", kind: "unverified", label: "Sign-in email is not yet verified", detail: null, section: "account" },
  ],
  account: { role: "student", twoFactorAvailable: false },
  generatedAt: NOW,
};

export const RESOLVED_PROFILE: StudentProfileView = {
  ...RICH_PROFILE,
  identity: {
    ...RICH_PROFILE.identity,
    pendingCorrection: null,
    lastResolvedCorrection: {
      id: "corr-000",
      studentId: "stu-demo-001",
      status: "rejected",
      fields: ["dob"],
      currentDisplay: { dob: "Apr 17, 2001" },
      requestedDisplay: { dob: "Apr 18, 2001" },
      reason: "I think my birth date was entered one day off.",
      evidenceDocumentId: null,
      createdAt: "2026-09-20T09:00:00.000Z",
      reviewedAt: "2026-09-24T09:00:00.000Z",
      reviewNote: "Your passport shows 17 April 2001, which matches our record.",
      reviewerUserId: null,
    },
  },
};

// ---------------------------------------------------------------------------
// One consistent synthetic student for the consolidated (S10) screens: the same
// person as the support, roadmap and documents fixtures (Amélie Laurent, LUM-0001).
// Her records agree with the documents fixtures: transcript verified, ID waiting
// for review, transfer transcript waiting for review.
// ---------------------------------------------------------------------------

export const CONSOLIDATED_STUDENT = {
  id: "s1",
  userId: "u1",
  studentCode: "LUM-0001",
  firstName: "Amélie",
  lastName: "Laurent",
  email: "amelie.laurent@synthetic.example",
  phone: "+1 555 0100",
} as const;

export const CONSOLIDATED_PROFILE: StudentProfileView = {
  identity: {
    studentId: CONSOLIDATED_STUDENT.id,
    studentCode: CONSOLIDATED_STUDENT.studentCode,
    firstName: CONSOLIDATED_STUDENT.firstName,
    middleName: null,
    lastName: CONSOLIDATED_STUDENT.lastName,
    preferredName: null,
    dob: "1996-05-14",
    sex: "Female",
    nationality: ["Canadian"],
    govIdType: "Passport",
    govIdNumberMasked: "•••• 3318",
    photoUrl: null,
    verification: "pending",
    pendingCorrection: null,
    lastResolvedCorrection: null,
  },
  contact: {
    email: CONSOLIDATED_STUDENT.email,
    emailVerified: true,
    phonePrimary: CONSOLIDATED_STUDENT.phone,
    phoneSecondary: null,
    whatsappPrimary: false,
    timezone: "America/Toronto",
    preferredContactChannel: "email",
    addressLine1: "88 Rue des Lilas",
    addressLine2: null,
    addressCity: "Montréal",
    addressState: "QC",
    addressPostal: "H2X 1Y4",
    addressCountry: "Canada",
    marketingOptIn: false,
    mediaRelease: false,
  },
  contacts: [
    contact({ id: "c-1", fullName: "Odile Laurent", type: "parent", relationship: "Mother", email: "odile@synthetic.example", requestedScopes: ["emergency", "academic"], effectiveScopes: ["emergency"], authorityStatus: "pending_verification" }),
    contact({ id: "c-2", fullName: "Diego Ruiz", type: "emergency", relationship: "Friend" }),
  ],
  academicBackground: {
    highSchool: { completionRecorded: true, path: "local_diploma", school: "Collège Jean-de-Brébeuf", country: "Canada", year: 2014, evidence: "verified" },
    priorCredentials: [{ label: "Associate degree in Business Administration", institution: "Collège Ahuntsic", detail: "2017", status: "Recorded" }],
    priorCreditsReported: true,
    foreignEvaluation: "not_submitted",
    collegeTranscripts: "pending",
    degreeCertificate: "not_submitted",
  },
  eligibility: {
    residency: "foreign",
    residencyEvidence: "verified",
    englishProficiency: { meetsRequirement: true, proofType: "TOEFL iBT", evidence: "verified" },
    documents: [
      { docType: "id_gov", label: "Government ID", status: "pending", requiredForEnrollment: true, updatedAt: NOW },
      { docType: "hs_transcript", label: "High school transcript", status: "verified", requiredForEnrollment: true, updatedAt: NOW },
      { docType: "college_transcript", label: "College transcript", status: "pending", requiredForEnrollment: false, updatedAt: NOW },
    ],
  },
  readiness: [
    { key: "id_gov", kind: "pending_review", label: "Government ID is being reviewed", detail: null, section: "identity" },
    { key: "college_transcript", kind: "pending_review", label: "College transcript is being reviewed", detail: null, section: "background" },
    { key: "guardian_auth", kind: "unverified", label: "Guardian authority is not yet verified", detail: "Odile Laurent", section: "contacts" },
  ],
  account: { role: "student", twoFactorAvailable: false },
  generatedAt: NOW,
};

// Staff review panel fixtures: the same student, with a correction request waiting.
export const STAFF_STUDENT_ID = "11111111-aaaa-4bbb-8ccc-000000000009";

export const STAFF_PENDING_CORRECTION: IdentityCorrectionRequestView = {
  id: "corr-0001", studentId: STAFF_STUDENT_ID, status: "pending", fields: ["last_name", "gov_id_number"],
  currentDisplay: { last_name: "Laurent", gov_id_number: "•••• 3318" },
  requestedDisplay: { last_name: "Laurent-Moreau", gov_id_number: "•••• 8830" },
  reason: "My legal surname changed after marriage; the new passport is attached.", evidenceDocumentId: "doc-id-1",
  createdAt: "2026-10-22T14:05:00.000Z", reviewedAt: null, reviewNote: null, reviewerUserId: null,
};
export const STAFF_OLD_REJECTED_CORRECTION: IdentityCorrectionRequestView = {
  ...STAFF_PENDING_CORRECTION, id: "corr-0000", status: "rejected", fields: ["dob"], currentDisplay: { dob: "1996-05-14" }, requestedDisplay: { dob: "1996-05-24" },
  reason: "Typo in date of birth.", evidenceDocumentId: null, createdAt: "2026-09-01T10:00:00.000Z", reviewedAt: "2026-09-02T09:00:00.000Z",
  reviewNote: "The passport shows 14 May 1996; no change needed.", reviewerUserId: "staff-1",
};

export function staffReviewProfile(): StudentProfileView {
  return {
    ...CONSOLIDATED_PROFILE,
    identity: {
      ...CONSOLIDATED_PROFILE.identity,
      studentId: STAFF_STUDENT_ID,
      preferredName: "Amy",
      pendingCorrection: STAFF_PENDING_CORRECTION,
      lastResolvedCorrection: STAFF_OLD_REJECTED_CORRECTION,
    },
    contact: { ...CONSOLIDATED_PROFILE.contact, preferredContactChannel: "whatsapp", whatsappPrimary: true },
    contacts: [
      contact({ id: "c1", fullName: "Odile Laurent", type: "guardian", relationship: "Mother", phone: "+1 514 555 0110", email: "odile@synthetic.example", requestedScopes: ["emergency", "academic", "financial"], effectiveScopes: ["emergency"], authorityStatus: "pending_verification", createdAt: "2026-10-20T10:00:00.000Z" }),
      contact({ id: "c2", fullName: "Diego Ruiz", type: "emergency", relationship: "Friend", phone: "+1 514 555 0177", createdAt: "2026-10-01T10:00:00.000Z" }),
    ],
  };
}

export const staffWorkspacePayload = () => ({
  student: { id: STAFF_STUDENT_ID, first_name: CONSOLIDATED_STUDENT.firstName, last_name: CONSOLIDATED_STUDENT.lastName, email: CONSOLIDATED_STUDENT.email, student_code: CONSOLIDATED_STUDENT.studentCode },
  report: { status: "IN_PROGRESS" },
  needsAttention: { groups: {}, diagnostics: [], integrationDiagnostics: [], reasons: [] },
  academicDetail: { academicSources: [], creditRecords: [], placements: [] },
  displayLabels: {}, program: null, snapshot: null,
});
