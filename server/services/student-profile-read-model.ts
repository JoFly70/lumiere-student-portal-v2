/**
 * Pure StudentProfileView read model (no database, no network). Split out of
 * student-profile-service so the screenshot renderer and tests can build the
 * exact same view the API serves from plain rows.
 */
import {
  CONTACT_SCOPES,
  PREFERRED_CONTACT_CHANNELS,
  effectiveContactScopes,
  maskIdentifier,
  type ContactAuthorityStatus,
  type ContactScope,
  type ContactType,
  type EvidenceStatus,
  type IdentityCorrectionRequestView,
  type PreferredContactChannel,
  type ProfileEvidenceItem,
  type ProfileReadinessItem,
  type StudentContactView,
  type StudentProfileView,
} from '@shared/student-profile-contract';
import type { Student } from '@shared/schema';

export interface ProfileDocumentRow {
  id: string;
  doc_type: string;
  status: string;
  required_for_enrollment: boolean;
  updated_at: string | null;
}

export function authorityStatusOf(value: unknown): ContactAuthorityStatus {
  return value === 'pending_verification' || value === 'verified' || value === 'revoked' ? value : 'listed';
}

export function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function toContactView(row: Record<string, unknown>): StudentContactView {
  const status = authorityStatusOf(row.authority_status);
  const requested = (Array.isArray(row.scopes) ? row.scopes : []).filter(
    (s): s is ContactScope => (CONTACT_SCOPES as readonly string[]).includes(String(s)),
  );
  return {
    id: String(row.id),
    type: row.type as ContactType,
    fullName: String(row.full_name),
    relationship: String(row.relationship),
    phone: String(row.phone),
    email: (row.email as string | null) ?? null,
    language: (row.language as string | null) ?? null,
    requestedScopes: requested,
    effectiveScopes: effectiveContactScopes(requested, status),
    authorityStatus: status,
    authorityVerifiedAt: isoOrNull(row.authority_verified_at),
    authorityNote: (row.authority_note as string | null) ?? null,
    hasPortalAccess: false,
    createdAt: isoOrNull(row.created_at) ?? '',
  };
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

const EVIDENCE_TYPES: ReadonlyArray<{ docType: string; label: string }> = [
  { docType: 'id_gov', label: 'Government-issued ID' },
  { docType: 'hs_diploma', label: 'High school diploma' },
  { docType: 'hs_transcript', label: 'High school transcript' },
  { docType: 'degree_certificate', label: 'Degree certificate' },
  { docType: 'college_transcript', label: 'College transcript' },
  { docType: 'foreign_eval', label: 'Foreign credential evaluation' },
  { docType: 'english_cert', label: 'English proficiency certificate' },
  { docType: 'residency_doc', label: 'Residency document' },
  { docType: 'consent_form', label: 'Consent form' },
];

const KNOWN_EVIDENCE: ReadonlySet<string> = new Set(['pending', 'verified', 'rejected', 'resubmit_requested']);

export interface ProfileViewInputs {
  student: Student;
  contacts: StudentContactView[];
  documents: ProfileDocumentRow[];
  englishProof: { proof_type?: string | null; meets_requirement?: boolean | null } | null;
  corrections: IdentityCorrectionRequestView[];
  priorCredentials: StudentProfileView['academicBackground']['priorCredentials'];
  photoUrl: string | null;
  role: string;
  now?: Date;
}

function latestDocFor(docs: ProfileDocumentRow[], docType: string) {
  // Rows arrive newest first.
  return docs.find((d) => d.doc_type === docType) ?? null;
}

function evidenceStatus(docs: ProfileDocumentRow[], docType: string): EvidenceStatus {
  const d = latestDocFor(docs, docType);
  return d && KNOWN_EVIDENCE.has(d.status) ? (d.status as EvidenceStatus) : 'not_submitted';
}

const blank = (v: string | null | undefined) => !v || v.trim().length === 0;

export function buildStudentProfileView(input: ProfileViewInputs): StudentProfileView {
  const { student: s, contacts, documents, corrections } = input;
  const idStatus = evidenceStatus(documents, 'id_gov');

  const pendingCorrection = corrections.find((c) => c.status === 'pending') ?? null;
  const lastResolved = corrections.find((c) => c.status === 'approved' || c.status === 'rejected') ?? null;
  const latestOverall = corrections[0] ?? null;

  const channel: PreferredContactChannel = (PREFERRED_CONTACT_CHANNELS as readonly string[]).includes(
    s.preferred_contact_channel,
  )
    ? (s.preferred_contact_channel as PreferredContactChannel)
    : 'email';

  const evidenceItems: ProfileEvidenceItem[] = EVIDENCE_TYPES.map(({ docType, label }) => {
    const d = latestDocFor(documents, docType);
    return {
      docType,
      label,
      status: evidenceStatus(documents, docType),
      requiredForEnrollment: d?.required_for_enrollment ?? false,
      updatedAt: d?.updated_at ?? null,
    };
  });

  const hsEvidence = evidenceStatus(documents, 'hs_diploma') !== 'not_submitted'
    ? evidenceStatus(documents, 'hs_diploma')
    : evidenceStatus(documents, 'hs_transcript');

  const readiness: ProfileReadinessItem[] = [];
  if (blank(s.phone_primary)) {
    readiness.push({ key: 'phone_primary', kind: 'missing', label: 'Add a phone number', detail: null, section: 'contact' });
  }
  if (blank(s.address_line1) || blank(s.address_country)) {
    readiness.push({ key: 'address', kind: 'missing', label: 'Add your address', detail: 'Street address and country', section: 'contact' });
  }
  const hasEmergency = contacts.some(
    (c) => c.effectiveScopes.includes('emergency') || c.type === 'emergency' || c.type === 'parent' || c.type === 'guardian',
  );
  if (!hasEmergency) {
    readiness.push({ key: 'emergency_contact', kind: 'missing', label: 'Add an emergency contact', detail: null, section: 'contacts' });
  }

  if (idStatus === 'not_submitted') {
    readiness.push({ key: 'identity_document', kind: 'unverified', label: 'Identity not yet verified', detail: 'Upload a government-issued ID', section: 'identity' });
  } else if (idStatus === 'pending') {
    readiness.push({ key: 'identity_document', kind: 'pending_review', label: 'Identity document under review', detail: null, section: 'identity' });
  } else if (idStatus === 'rejected' || idStatus === 'resubmit_requested') {
    readiness.push({ key: 'identity_document', kind: 'action_required', label: 'Identity document needs to be resubmitted', detail: null, section: 'identity' });
  }

  if (pendingCorrection) {
    readiness.push({ key: 'identity_correction', kind: 'pending_review', label: 'Identity correction under review', detail: null, section: 'identity' });
  } else if (latestOverall && latestOverall.status === 'rejected') {
    readiness.push({
      key: 'identity_correction',
      kind: 'action_required',
      label: 'Identity correction was not approved',
      detail: latestOverall.reviewNote,
      section: 'identity',
    });
  }

  // A contact whose authority is pending (or was declined) needs a signed consent
  // from the STUDENT. Until one is on file that is the student's action, not
  // something Lumière is waiting on; once uploaded, Lumière is the one reviewing.
  // (A rejected or resubmit-requested consent form is reported by the document loop below.)
  const consentStatus = evidenceStatus(documents, 'consent_form');
  const consentOnFile = consentStatus !== 'not_submitted';
  for (const c of contacts) {
    if (c.authorityStatus === 'pending_verification') {
      readiness.push(consentOnFile
        ? { key: `contact_authority:${c.id}`, kind: 'pending_review', label: `${c.fullName}: authority awaiting verification`, detail: null, section: 'contacts' }
        : { key: `contact_authority:${c.id}`, kind: 'action_required', label: `Upload a signed consent for ${c.fullName}`, detail: 'Lumière verifies authority from a signed consent or legal document.', section: 'contacts' });
    } else if (c.authorityStatus === 'revoked' && !consentOnFile) {
      readiness.push({
        key: `contact_authority:${c.id}`,
        kind: 'action_required',
        label: `${c.fullName}: authority was not approved`,
        detail: c.authorityNote ?? 'Upload a signed consent to ask Lumière to review again.',
        section: 'contacts',
      });
    }
  }

  if (idStatus === 'verified') {
    readiness.push({ key: 'identity_document', kind: 'complete', label: 'Identity document verified', detail: null, section: 'identity' });
  }
  for (const c of contacts) {
    // Only a staff-verified status is authority; a merely listed contact never is.
    if (c.authorityStatus === 'verified') {
      readiness.push({ key: `contact_authority:${c.id}`, kind: 'complete', label: `${c.fullName}: authority verified`, detail: null, section: 'contacts' });
    }
  }
  for (const item of evidenceItems) {
    if (item.docType === 'id_gov') continue;
    if (item.status === 'verified') {
      readiness.push({ key: `document:${item.docType}`, kind: 'complete', label: `${item.label} verified`, detail: null, section: 'eligibility' });
    } else if (item.status === 'pending' && item.docType === 'foreign_eval') {
      // Credential evaluations are done by an outside evaluation service, not by Lumière staff.
      readiness.push({ key: `document:${item.docType}`, kind: 'waiting_external', label: `${item.label} is with the evaluation service`, detail: null, section: 'eligibility' });
    } else if (item.status === 'pending') {
      readiness.push({ key: `document:${item.docType}`, kind: 'pending_review', label: `${item.label} under review`, detail: null, section: 'eligibility' });
    } else if (item.status === 'rejected' || item.status === 'resubmit_requested') {
      readiness.push({ key: `document:${item.docType}`, kind: 'action_required', label: `${item.label} needs to be resubmitted`, detail: null, section: 'eligibility' });
    }
  }

  return {
    identity: {
      studentId: s.id,
      studentCode: s.student_code,
      firstName: s.first_name,
      middleName: s.middle_name ?? null,
      lastName: s.last_name,
      preferredName: s.preferred_name ?? null,
      dob: s.dob ?? null,
      sex: s.sex ?? null,
      nationality: s.nationality ?? [],
      govIdType: s.gov_id_type ?? null,
      govIdNumberMasked: maskIdentifier(s.gov_id_number),
      photoUrl: input.photoUrl,
      verification: idStatus,
      pendingCorrection,
      lastResolvedCorrection: lastResolved,
    },
    contact: {
      email: s.email,
      emailVerified: !!s.email_verified_at,
      phonePrimary: s.phone_primary ?? null,
      phoneSecondary: s.phone_secondary ?? null,
      whatsappPrimary: !!s.whatsapp_primary,
      timezone: s.timezone ?? null,
      preferredContactChannel: channel,
      addressLine1: s.address_line1 ?? null,
      addressLine2: s.address_line2 ?? null,
      addressCity: s.address_city ?? null,
      addressState: s.address_state ?? null,
      addressPostal: s.address_postal ?? null,
      addressCountry: s.address_country ?? null,
      marketingOptIn: !!s.marketing_opt_in,
      mediaRelease: !!s.media_release,
    },
    contacts,
    academicBackground: {
      highSchool: {
        completionRecorded: !!s.hs_completion,
        path: s.hs_path ?? null,
        school: s.hs_school ?? null,
        country: s.hs_country ?? null,
        year: s.hs_year ?? null,
        evidence: hsEvidence,
      },
      priorCredentials: input.priorCredentials,
      priorCreditsReported: !!s.prior_credits,
      foreignEvaluation: evidenceStatus(documents, 'foreign_eval'),
      collegeTranscripts: evidenceStatus(documents, 'college_transcript'),
      degreeCertificate: evidenceStatus(documents, 'degree_certificate'),
    },
    eligibility: {
      residency: s.residency ?? null,
      residencyEvidence: evidenceStatus(documents, 'residency_doc'),
      englishProficiency: {
        meetsRequirement: input.englishProof ? !!input.englishProof.meets_requirement : null,
        proofType: input.englishProof?.proof_type ?? null,
        evidence: evidenceStatus(documents, 'english_cert'),
      },
      documents: evidenceItems,
    },
    readiness,
    account: { role: input.role, twoFactorAvailable: true },
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}

/** Prior credentials as the API derives them: one row per canonical academic source. */
export function priorCredentialsFromSources(
  sources: ReadonlyArray<{ title?: unknown; sourceType?: unknown; status?: unknown }>,
): StudentProfileView['academicBackground']['priorCredentials'] {
  return sources.map((src) => ({
    label: String(src.title ?? src.sourceType),
    institution: null,
    detail: String(src.sourceType ?? '') || null,
    status: String(src.status ?? '') || null,
  }));
}
