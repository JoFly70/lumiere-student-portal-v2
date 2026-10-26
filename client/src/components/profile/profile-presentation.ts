/**
 * Pure presentation helpers for the student profile (S09). No React, no
 * network: safe to unit test and to reuse from fixtures.
 */
import type {
  ContactAuthorityStatus,
  ContactScope,
  ContactType,
  EvidenceStatus,
  PreferredContactChannel,
  ProfileReadinessItem,
  StudentContactView,
} from "@shared/student-profile-contract";

export const PROFILE_SECTIONS = [
  { id: "identity", label: "My Identity" },
  { id: "contact", label: "Contact" },
  { id: "background", label: "Academic Background" },
  { id: "contacts", label: "Authorized Contacts" },
  { id: "eligibility", label: "Eligibility & Documents" },
  { id: "account", label: "Account" },
] as const;
export type ProfileSectionId = (typeof PROFILE_SECTIONS)[number]["id"];

export const sectionDomId = (id: string) => `section-${id}`;

export function displayName(identity: {
  firstName: string;
  lastName: string;
  middleName?: string | null;
  preferredName?: string | null;
}): { primary: string; legal: string } {
  const legal = [identity.firstName, identity.middleName, identity.lastName].filter(Boolean).join(" ");
  const preferred = identity.preferredName?.trim();
  return { primary: preferred ? preferred : `${identity.firstName} ${identity.lastName}`.trim(), legal };
}

export function initials(first?: string | null, last?: string | null): string {
  const a = first?.trim().charAt(0).toUpperCase() ?? "";
  const b = last?.trim().charAt(0).toUpperCase() ?? "";
  return a + b || "?";
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------------------
// Evidence / verification vocabulary
// ---------------------------------------------------------------------------

export type ChipTone = "verified" | "waiting" | "missing" | "attention" | "neutral";

export function evidenceChip(status: EvidenceStatus): { label: string; tone: ChipTone } {
  switch (status) {
    case "verified":
      return { label: "Verified", tone: "verified" };
    case "pending":
      return { label: "Under review", tone: "waiting" };
    case "rejected":
      return { label: "Not accepted", tone: "attention" };
    case "resubmit_requested":
      return { label: "Resubmission requested", tone: "attention" };
    default:
      return { label: "Not submitted", tone: "missing" };
  }
}

/** Identity verification badge, derived from identity.verification. */
export function verificationChip(status: EvidenceStatus): { label: string; tone: ChipTone; explain: string } {
  switch (status) {
    case "verified":
      return {
        label: "Verified",
        tone: "verified",
        explain: "Lumière has checked your government ID. Your legal identity stays as recorded until a correction is reviewed.",
      };
    case "pending":
      return {
        label: "Under review",
        tone: "waiting",
        explain: "We received your ID and Lumière is reviewing it. Nothing more is needed from you right now.",
      };
    case "rejected":
    case "resubmit_requested":
      return {
        label: "Action required",
        tone: "attention",
        explain: "Lumière could not accept the ID on file. Upload a new copy in Documents.",
      };
    default:
      return {
        label: "Not yet verified",
        tone: "missing",
        explain: "Upload a government ID in Documents so Lumière can verify your identity.",
      };
  }
}

export function needsUpload(status: EvidenceStatus): boolean {
  return status === "not_submitted" || status === "rejected" || status === "resubmit_requested";
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export function splitReadiness(items: readonly ProfileReadinessItem[]) {
  const attention = items.filter((i) => i.kind === "missing" || i.kind === "action_required");
  const waiting = items.filter((i) => i.kind === "pending_review" || i.kind === "unverified");
  return { attention, waiting };
}

export function readinessChip(kind: ProfileReadinessItem["kind"]): { label: string; tone: ChipTone } {
  switch (kind) {
    case "missing":
      return { label: "Missing", tone: "missing" };
    case "action_required":
      return { label: "Action required", tone: "attention" };
    case "pending_review":
      return { label: "Under review", tone: "waiting" };
    case "unverified":
      return { label: "Not yet verified", tone: "waiting" };
    default:
      return { label: "Complete", tone: "verified" };
  }
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export const FIELD_LABELS: Record<string, string> = {
  first_name: "First name",
  middle_name: "Middle name",
  last_name: "Last name",
  dob: "Date of birth",
  sex: "Sex",
  nationality: "Nationality",
  gov_id_type: "Government ID type",
  gov_id_number: "Government ID number",
};

export const CHANNEL_LABELS: Record<PreferredContactChannel, string> = {
  email: "Email",
  phone: "Phone call",
  whatsapp: "WhatsApp",
  sms: "Text message (SMS)",
};

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  parent: "Parent",
  guardian: "Guardian",
  emergency: "Emergency contact",
  representative: "Representative",
  spouse: "Spouse or partner",
  other: "Other",
};

export const SCOPE_INFO: Record<ContactScope, { label: string; help: string; authority: boolean }> = {
  emergency: { label: "Emergency contact", help: "Lumière may call this person if we cannot reach you in an urgent situation.", authority: false },
  academic: { label: "Academic records", help: "Discuss your academic progress and records.", authority: true },
  financial: { label: "Financial matters", help: "Discuss billing, payments and financial aid.", authority: true },
  release: { label: "Release of information", help: "Receive information Lumière would otherwise share only with you.", authority: true },
};

export function authorityChip(status: ContactAuthorityStatus): { label: string; tone: ChipTone } {
  switch (status) {
    case "verified":
      return { label: "Verified by Lumière", tone: "verified" };
    case "pending_verification":
      return { label: "Verification pending", tone: "waiting" };
    case "revoked":
      return { label: "Not authorized", tone: "attention" };
    default:
      return { label: "Listed by you", tone: "neutral" };
  }
}

export function scopeLabels(scopes: readonly ContactScope[]): string[] {
  return scopes.map((s) => SCOPE_INFO[s]?.label ?? s);
}

/** Requested scopes that are not in force yet. */
export function inactiveScopes(c: Pick<StudentContactView, "requestedScopes" | "effectiveScopes">): ContactScope[] {
  return c.requestedScopes.filter((s) => !c.effectiveScopes.includes(s));
}

export function isVerifiedAuthority(c: Pick<StudentContactView, "authorityStatus">): boolean {
  return c.authorityStatus === "verified";
}

export function residencyLabel(r: "us" | "foreign" | null): string {
  if (r === "us") return "U.S. resident";
  if (r === "foreign") return "International (non-U.S.)";
  return "Not recorded";
}

export function hsPathLabel(p: "local_diploma" | "ged" | "foreign" | null): string {
  if (p === "local_diploma") return "High school diploma";
  if (p === "ged") return "GED";
  if (p === "foreign") return "Foreign secondary credential";
  return "Not recorded";
}

export function docTypeActionHref(): string {
  return "/documents";
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const FRIENDLY_CODES: Record<string, string> = {
  PROFILE_CORRECTION_ALREADY_PENDING:
    "You already have a correction under review. Withdraw it first if you want to submit a different one.",
  PROFILE_CORRECTION_NO_CHANGE: "Those values are the same as what is on record. Change at least one field.",
  PROFILE_CORRECTION_NOT_PENDING: "That request is no longer pending.",
  PROFILE_CONTACT_AUTHORITY_STAFF_MANAGED:
    "This contact's authority was verified by Lumière, so it can only be changed by our team. Please contact Lumière.",
  PROFILE_PHOTO_INVALID: "That photo could not be used. Choose a PNG, JPEG or WEBP image under 5 MB.",
  PROFILE_EVIDENCE_NOT_OWNED: "That document could not be attached to your request.",
  PROFILE_IDENTITY_REQUIRES_CORRECTION: "Legal identity can only be changed through a correction request.",
  PROFILE_FIELDS_STAFF_CONTROLLED: "That information is managed by Lumière staff.",
  PROFILE_EMAIL_MANAGED_BY_ACCOUNT: "Your sign-in email is managed by your account. Contact support to change it.",
};

export function describeError(error: unknown, fallback = "Something went wrong. Please try again."): string {
  const e = error as { code?: string; message?: string; status?: number } | null;
  if (e?.code && FRIENDLY_CODES[e.code]) return FRIENDLY_CODES[e.code];
  if (e?.status === 413) return "That file is too large. Choose an image under 5 MB.";
  const msg = e?.message?.trim();
  if (!msg) return fallback;
  // Strip a leading "403: " style status prefix from generic fetch errors.
  return msg.replace(/^\d{3}:\s*/, "");
}

// ---------------------------------------------------------------------------
// Timezones
// ---------------------------------------------------------------------------

const FALLBACK_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Mexico_City",
  "America/Bogota",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Madrid",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Manila",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export function listTimezones(current?: string | null): string[] {
  let zones: string[] = FALLBACK_TIMEZONES;
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const supported = fn?.("timeZone");
    if (supported && supported.length > 0) zones = supported.includes("UTC") ? supported : ["UTC", ...supported];
  } catch {
    /* fall back */
  }
  if (current && !zones.includes(current)) zones = [current, ...zones];
  return zones;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type FieldErrors = Record<string, string>;

export function validatePhone(value: string, required: boolean): string | null {
  const v = value.trim();
  if (!v) return required ? "Enter a phone number" : null;
  if (v.length < 5) return "Enter at least 5 characters";
  if (v.length > 32) return "Use 32 characters or fewer";
  if (!/^[+()\d][\d\s().\-+]*$/.test(v)) return "Use digits, spaces, + and dashes only";
  return null;
}

export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "Enter a valid email address";
}

/** Document types shown under Academic Background, so Eligibility does not list them again. */
export const EDUCATION_DOC_TYPES: ReadonlySet<string> = new Set([
  "hs_transcript",
  "hs_diploma",
  "degree_certificate",
  "college_transcript",
  "foreign_eval",
]);
