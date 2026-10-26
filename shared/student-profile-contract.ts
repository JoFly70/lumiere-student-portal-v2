/**
 * S09 — Student Profile contract.
 *
 * Single source of truth for the student profile's field ownership, the
 * identity-correction workflow, contact/guardian authority, and the
 * read model returned by GET /api/students/me/profile.
 *
 * Ownership rules (see docs/recovery/S09-progress-record.md for the matrix):
 *  - STUDENT_EDITABLE_PROFILE_FIELDS: ordinary self-service fields.
 *  - IDENTITY_CORRECTION_FIELDS: legal identity. Students never write these
 *    directly; they submit an IdentityCorrectionRequest that staff resolve.
 *  - Everything else on `students` (status, residency, high-school eligibility,
 *    program intent, prior credits/transcripts, consent, photo reference,
 *    user link, student code, login email) is staff- or system-controlled.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Field ownership
// ---------------------------------------------------------------------------

/** Fields a student may change directly on their own record. */
export const STUDENT_EDITABLE_PROFILE_FIELDS = [
  "preferred_name",
  "phone_primary",
  "phone_secondary",
  "whatsapp_primary",
  "timezone",
  "preferred_contact_channel",
  "address_country",
  "address_state",
  "address_city",
  "address_postal",
  "address_line1",
  "address_line2",
  "marketing_opt_in",
  "media_release",
] as const;
export type StudentEditableProfileField = (typeof STUDENT_EDITABLE_PROFILE_FIELDS)[number];

/** Legal-identity fields: changed only by approving a correction request (or by staff directly). */
export const IDENTITY_CORRECTION_FIELDS = [
  "first_name",
  "middle_name",
  "last_name",
  "dob",
  "sex",
  "nationality",
  "gov_id_type",
  "gov_id_number",
] as const;
export type IdentityCorrectionField = (typeof IDENTITY_CORRECTION_FIELDS)[number];

/**
 * The profile `email` mirrors the authenticated login email. It is not
 * editable through the profile API by anyone; a change must go through the
 * account (auth) email-change flow so the two never diverge silently.
 */
export const LOGIN_EMAIL_FIELD = "email" as const;

export const PREFERRED_CONTACT_CHANNELS = ["email", "phone", "whatsapp", "sms"] as const;
export type PreferredContactChannel = (typeof PREFERRED_CONTACT_CHANNELS)[number];

/** Validation for a student self-service update (PUT /api/students/:id by a student). */
export const studentSelfServiceUpdateSchema = z
  .object({
    preferred_name: z.string().trim().max(80).nullable(),
    phone_primary: z.string().trim().min(5).max(32),
    phone_secondary: z.string().trim().max(32).nullable(),
    whatsapp_primary: z.boolean(),
    timezone: z.string().trim().max(64).nullable(),
    preferred_contact_channel: z.enum(PREFERRED_CONTACT_CHANNELS),
    address_country: z.string().trim().min(2).max(80),
    address_state: z.string().trim().max(80).nullable(),
    address_city: z.string().trim().max(80).nullable(),
    address_postal: z.string().trim().max(20).nullable(),
    address_line1: z.string().trim().min(1).max(160),
    address_line2: z.string().trim().max(160).nullable(),
    marketing_opt_in: z.boolean(),
    media_release: z.boolean(),
  })
  .partial()
  .strict();
export type StudentSelfServiceUpdate = z.infer<typeof studentSelfServiceUpdateSchema>;

// ---------------------------------------------------------------------------
// Identity correction requests
// ---------------------------------------------------------------------------

export const CORRECTION_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

/** Requested values. Every key optional; at least one required. */
export const identityCorrectionChangesSchema = z
  .object({
    first_name: z.string().trim().min(1).max(80),
    middle_name: z.string().trim().max(80).nullable(),
    last_name: z.string().trim().min(1).max(80),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    sex: z.string().trim().max(40).nullable(),
    nationality: z.array(z.string().trim().min(2).max(80)).max(4),
    gov_id_type: z.string().trim().max(60).nullable(),
    gov_id_number: z.string().trim().min(3).max(60).nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Request at least one correction" });
export type IdentityCorrectionChanges = z.infer<typeof identityCorrectionChangesSchema>;

/** POST /api/students/me/identity-corrections */
export const createIdentityCorrectionSchema = z
  .object({
    changes: identityCorrectionChangesSchema,
    reason: z.string().trim().min(10, "Tell us briefly why this needs correcting").max(1000),
    /** Optional supporting document the student already uploaded (must belong to them). */
    evidence_document_id: z.string().min(1).nullable().optional(),
  })
  .strict();
export type CreateIdentityCorrection = z.infer<typeof createIdentityCorrectionSchema>;

/** POST /api/students/identity-corrections/:requestId/resolve (staff) */
export const resolveIdentityCorrectionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    /** Required on reject; shown to the student. */
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((v) => v.decision === "approve" || (v.note && v.note.length >= 5), {
    message: "Explain the rejection to the student",
    path: ["note"],
  });
export type ResolveIdentityCorrection = z.infer<typeof resolveIdentityCorrectionSchema>;

/**
 * Display shape. Sensitive values (gov_id_number) are always masked
 * (e.g. "•••• 4821") in every response; raw values never leave the server.
 */
export interface IdentityCorrectionRequestView {
  readonly id: string;
  readonly studentId: string;
  readonly status: CorrectionStatus;
  readonly fields: readonly IdentityCorrectionField[];
  /** field -> masked display value currently on record (captured at request time). */
  readonly currentDisplay: Readonly<Partial<Record<IdentityCorrectionField, string | null>>>;
  /** field -> masked display value requested. */
  readonly requestedDisplay: Readonly<Partial<Record<IdentityCorrectionField, string | null>>>;
  readonly reason: string;
  readonly evidenceDocumentId: string | null;
  readonly createdAt: string;
  readonly reviewedAt: string | null;
  /** Staff note on resolution (always set on reject). */
  readonly reviewNote: string | null;
  /** Staff-only views include the reviewer id; student views receive null. */
  readonly reviewerUserId: string | null;
}

// ---------------------------------------------------------------------------
// Contacts and guardian/representative authority
// ---------------------------------------------------------------------------

/** contact_type_enum, extended by the S09 migration with 'emergency' and 'representative'. */
export const CONTACT_TYPES = ["parent", "guardian", "emergency", "representative", "spouse", "other"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const CONTACT_SCOPES = ["emergency", "academic", "financial", "release"] as const;
export type ContactScope = (typeof CONTACT_SCOPES)[number];

/** Scopes that confer authority over protected records; inert until staff verify. */
export const AUTHORITY_SCOPES = ["academic", "financial", "release"] as const satisfies readonly ContactScope[];

/**
 * listed               – the student listed this person (no authority).
 * pending_verification – the student asked for guardian/representative authority; staff must verify evidence.
 * verified             – staff verified the authority (consent/legal document). Only staff set this.
 * revoked              – staff withdrew or declined the authority.
 */
export const CONTACT_AUTHORITY_STATUSES = ["listed", "pending_verification", "verified", "revoked"] as const;
export type ContactAuthorityStatus = (typeof CONTACT_AUTHORITY_STATUSES)[number];

/** Student create/update payload. Never includes authority_status or verification fields. */
export const studentContactInputSchema = z
  .object({
    type: z.enum(CONTACT_TYPES),
    full_name: z.string().trim().min(1).max(120),
    relationship: z.string().trim().min(1).max(60),
    phone: z.string().trim().min(5).max(32),
    email: z.string().trim().email().max(160).nullable(),
    language: z.string().trim().max(40).nullable(),
    /** Requested scopes. AUTHORITY_SCOPES only take effect after staff verification. */
    scopes: z.array(z.enum(CONTACT_SCOPES)).max(4).default([]),
  })
  .strict();
export type StudentContactInput = z.infer<typeof studentContactInputSchema>;

/** POST /api/students/contacts/:contactId/authority (staff) */
export const resolveContactAuthoritySchema = z
  .object({
    decision: z.enum(["verify", "revoke"]),
    note: z.string().trim().min(5).max(1000),
  })
  .strict();
export type ResolveContactAuthority = z.infer<typeof resolveContactAuthoritySchema>;

export interface StudentContactView {
  readonly id: string;
  readonly type: ContactType;
  readonly fullName: string;
  readonly relationship: string;
  readonly phone: string;
  readonly email: string | null;
  readonly language: string | null;
  /** What the student asked for. */
  readonly requestedScopes: readonly ContactScope[];
  /** What is actually in force: requested ∩ {emergency} unless authority is verified. */
  readonly effectiveScopes: readonly ContactScope[];
  readonly authorityStatus: ContactAuthorityStatus;
  readonly authorityVerifiedAt: string | null;
  readonly authorityNote: string | null;
  /** A contact never has portal login access in S09. Always false. */
  readonly hasPortalAccess: false;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Read model: GET /api/students/me/profile (student) and
//             GET /api/students/:id/profile (staff, or the owning student)
// ---------------------------------------------------------------------------

/** Status vocabulary reused from student_documents.status, plus not_submitted. */
export type EvidenceStatus = "not_submitted" | "pending" | "verified" | "rejected" | "resubmit_requested";

export interface ProfileIdentity {
  readonly studentId: string;
  readonly studentCode: string;
  readonly firstName: string;
  readonly middleName: string | null;
  readonly lastName: string;
  readonly preferredName: string | null;
  readonly dob: string | null;
  readonly sex: string | null;
  readonly nationality: readonly string[];
  readonly govIdType: string | null;
  /** Always masked, e.g. "•••• 4821"; null when none on record. */
  readonly govIdNumberMasked: string | null;
  /** Short-lived signed URL or null. */
  readonly photoUrl: string | null;
  /** Derived from the student's id_gov document status (existing Documents verification). */
  readonly verification: EvidenceStatus;
  readonly pendingCorrection: IdentityCorrectionRequestView | null;
  /** Most recent resolved (approved/rejected) request, so the student sees the outcome. */
  readonly lastResolvedCorrection: IdentityCorrectionRequestView | null;
}

export interface ProfileContactInfo {
  /** Login email (read-only here; changed via account security). */
  readonly email: string;
  readonly emailVerified: boolean;
  readonly phonePrimary: string | null;
  readonly phoneSecondary: string | null;
  readonly whatsappPrimary: boolean;
  readonly timezone: string | null;
  readonly preferredContactChannel: PreferredContactChannel;
  readonly addressLine1: string | null;
  readonly addressLine2: string | null;
  readonly addressCity: string | null;
  readonly addressState: string | null;
  readonly addressPostal: string | null;
  readonly addressCountry: string | null;
  readonly marketingOptIn: boolean;
  readonly mediaRelease: boolean;
}

export interface ProfileEvidenceItem {
  /** student_documents.doc_type */
  readonly docType: string;
  readonly label: string;
  readonly status: EvidenceStatus;
  readonly requiredForEnrollment: boolean;
  readonly updatedAt: string | null;
}

export interface ProfileAcademicBackground {
  readonly highSchool: {
    /** Recorded by staff; a populated field is not proof of verification. */
    readonly completionRecorded: boolean;
    readonly path: "local_diploma" | "ged" | "foreign" | null;
    readonly school: string | null;
    readonly country: string | null;
    readonly year: number | null;
    readonly evidence: EvidenceStatus;
  };
  /** Prior institutions / credentials from existing authorized academic records (read-only). */
  readonly priorCredentials: ReadonlyArray<{
    readonly label: string;
    readonly institution: string | null;
    readonly detail: string | null;
    readonly status: string | null;
  }>;
  readonly priorCreditsReported: boolean;
  readonly foreignEvaluation: EvidenceStatus;
  readonly collegeTranscripts: EvidenceStatus;
  readonly degreeCertificate: EvidenceStatus;
}

export interface ProfileEligibility {
  readonly residency: "us" | "foreign" | null;
  readonly residencyEvidence: EvidenceStatus;
  readonly englishProficiency: {
    /** null when no proof recorded by staff. */
    readonly meetsRequirement: boolean | null;
    readonly proofType: string | null;
    readonly evidence: EvidenceStatus;
  };
  readonly documents: readonly ProfileEvidenceItem[];
}

/**
 * The four groups the student sees (see splitReadiness):
 *   action required from the student  = missing | action_required
 *   waiting on Lumière                = pending_review | unverified
 *   waiting on an external institution = waiting_external
 *   completed                          = complete
 * A requested or resubmit-requested document is ALWAYS action_required. A listed
 * contact never implies authority: only a staff-verified status does.
 */
export type ReadinessKind = "missing" | "unverified" | "pending_review" | "action_required" | "waiting_external" | "complete";

export interface ProfileReadinessItem {
  readonly key: string;
  readonly kind: ReadinessKind;
  readonly label: string;
  readonly detail: string | null;
  /** Section anchor the student should go to: identity | contact | background | contacts | eligibility | account */
  readonly section: string;
}

export interface StudentProfileView {
  readonly identity: ProfileIdentity;
  readonly contact: ProfileContactInfo;
  readonly contacts: readonly StudentContactView[];
  readonly academicBackground: ProfileAcademicBackground;
  readonly eligibility: ProfileEligibility;
  /** Only real, actionable items. No percentage. Optional fields never appear as "missing". */
  readonly readiness: readonly ProfileReadinessItem[];
  readonly account: {
    readonly role: string;
    readonly twoFactorAvailable: boolean;
  };
  readonly generatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers shared by server and client
// ---------------------------------------------------------------------------

/** "•••• 4821" — never reveals more than the last four characters. */
export function maskIdentifier(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const compact = String(value).replace(/\s+/g, "");
  if (compact.length === 0) return null;
  const tail = compact.length > 6 ? compact.slice(-4) : "";
  return tail ? `•••• ${tail}` : "••••";
}

export function effectiveContactScopes(
  requested: readonly string[],
  authorityStatus: ContactAuthorityStatus,
): ContactScope[] {
  const valid = requested.filter((s): s is ContactScope => (CONTACT_SCOPES as readonly string[]).includes(s));
  if (authorityStatus === "verified") return Array.from(new Set(valid));
  return valid.includes("emergency") ? ["emergency"] : [];
}

/** Whether a student-submitted contact needs staff verification before any authority applies. */
export function contactRequestsAuthority(type: ContactType, scopes: readonly ContactScope[]): boolean {
  return (
    type === "guardian" ||
    type === "representative" ||
    scopes.some((s) => (AUTHORITY_SCOPES as readonly string[]).includes(s))
  );
}

/** Stable error codes returned by the profile API. */
export const PROFILE_ERROR_CODES = {
  FIELDS_STAFF_CONTROLLED: "PROFILE_FIELDS_STAFF_CONTROLLED",
  IDENTITY_REQUIRES_CORRECTION: "PROFILE_IDENTITY_REQUIRES_CORRECTION",
  EMAIL_MANAGED_BY_ACCOUNT: "PROFILE_EMAIL_MANAGED_BY_ACCOUNT",
  CORRECTION_ALREADY_PENDING: "PROFILE_CORRECTION_ALREADY_PENDING",
  CORRECTION_NOT_PENDING: "PROFILE_CORRECTION_NOT_PENDING",
  CORRECTION_NO_CHANGE: "PROFILE_CORRECTION_NO_CHANGE",
  EVIDENCE_NOT_OWNED: "PROFILE_EVIDENCE_NOT_OWNED",
  CONTACT_AUTHORITY_STAFF_MANAGED: "PROFILE_CONTACT_AUTHORITY_STAFF_MANAGED",
  PHOTO_INVALID: "PROFILE_PHOTO_INVALID",
} as const;
