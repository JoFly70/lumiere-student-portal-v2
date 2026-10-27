/**
 * Pure presentation helpers for the student profile (S09). No React, no
 * network: safe to unit test and to reuse from fixtures.
 */
import { currentLanguage, type Language } from "@/i18n";
import { pt } from "./pt";
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
  { id: "identity", label: "Identity" },
  { id: "contact", label: "Contact" },
  { id: "background", label: "Background" },
  { id: "contacts", label: "Authorized contacts" },
  { id: "eligibility", label: "Eligibility" },
  { id: "account", label: "Account" },
] as const;

/** One-tap actions for readiness items that ask the student to supply something. */
export function readinessAction(item: { key: string; kind: string; section: string }): { label: string; href: string; external: boolean } | null {
  if (item.kind !== "missing" && item.kind !== "action_required") return null;
  switch (item.key) {
    case "phone": return { label: pt("Add phone"), href: `#${sectionDomId("contact")}`, external: false };
    case "address": return { label: pt("Add address"), href: `#${sectionDomId("contact")}`, external: false };
    case "id_gov": return { label: pt("Upload government ID"), href: "/documents", external: true };
    default:
      // Anything that asks for a (new) file goes straight to Documents.
      if (item.key.startsWith("contact_authority:")) return { label: pt("Upload signed consent"), href: "/documents", external: true };
      if (item.key.startsWith("document:") || item.key === "identity_document") return { label: pt("Upload new file"), href: "/documents", external: true };
      return { label: item.kind === "missing" ? pt("Add") : pt("Review"), href: `#${sectionDomId(item.section)}`, external: false };
  }
}
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

export function formatDate(value: string | null | undefined, language: Language = currentLanguage()): string {
  if (!value) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(language, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

// ---------------------------------------------------------------------------
// Evidence / verification vocabulary
// ---------------------------------------------------------------------------

export type ChipTone = "verified" | "waiting" | "missing" | "attention" | "neutral";

export function evidenceChip(status: EvidenceStatus): { label: string; tone: ChipTone } {
  switch (status) {
    case "verified":
      return { label: pt("Verified"), tone: "verified" };
    case "pending":
      return { label: pt("Under review"), tone: "waiting" };
    case "rejected":
      return { label: pt("Not accepted"), tone: "attention" };
    case "resubmit_requested":
      return { label: pt("Resubmission requested"), tone: "attention" };
    default:
      return { label: pt("Not submitted"), tone: "missing" };
  }
}

/** Identity verification badge, derived from identity.verification. */
export function verificationChip(status: EvidenceStatus): { label: string; tone: ChipTone; explain: string } {
  switch (status) {
    case "verified":
      return {
        label: pt("Verified"),
        tone: "verified",
        explain: pt("Lumière has checked your government ID. Your legal identity stays as recorded until a correction is reviewed."),
      };
    case "pending":
      return {
        label: pt("Under review"),
        tone: "waiting",
        explain: pt("We received your ID and Lumière is reviewing it. Nothing more is needed from you right now."),
      };
    case "rejected":
    case "resubmit_requested":
      return {
        label: pt("Action required"),
        tone: "attention",
        explain: pt("Lumière could not accept the ID on file. Upload a new copy in Documents."),
      };
    default:
      return {
        label: pt("Not yet verified"),
        tone: "missing",
        explain: pt("Upload a government ID in Documents so Lumière can verify your identity."),
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
  const external = items.filter((i) => i.kind === "waiting_external");
  const completed = items.filter((i) => i.kind === "complete");
  return { attention, waiting, external, completed };
}

export function readinessChip(kind: ProfileReadinessItem["kind"]): { label: string; tone: ChipTone } {
  switch (kind) {
    case "missing":
      return { label: pt("Missing"), tone: "missing" };
    case "action_required":
      return { label: pt("Action required"), tone: "attention" };
    case "pending_review":
      return { label: pt("Under review"), tone: "waiting" };
    case "unverified":
      return { label: pt("Not yet verified"), tone: "waiting" };
    case "waiting_external":
      return { label: pt("With an outside institution"), tone: "waiting" };
    default:
      return { label: pt("Complete"), tone: "verified" };
  }
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export const FIELD_LABELS: Record<string, string> = {
  get first_name() { return pt("First name"); },
  get middle_name() { return pt("Middle name"); },
  get last_name() { return pt("Last name"); },
  get dob() { return pt("Date of birth"); },
  get sex() { return pt("Sex"); },
  get nationality() { return pt("Nationality"); },
  get gov_id_type() { return pt("Government ID type"); },
  get gov_id_number() { return pt("Government ID number"); },
};

export const CHANNEL_LABELS: Record<PreferredContactChannel, string> = {
  get email() { return pt("Email"); },
  get phone() { return pt("Phone call"); },
  get whatsapp() { return pt("WhatsApp"); },
  get sms() { return pt("Text message (SMS)"); },
};

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  get parent() { return pt("Parent"); },
  get guardian() { return pt("Guardian"); },
  get emergency() { return pt("Emergency contact"); },
  get representative() { return pt("Representative"); },
  get spouse() { return pt("Spouse or partner"); },
  get other() { return pt("Other"); },
};

export const SCOPE_INFO: Record<ContactScope, { label: string; help: string; authority: boolean }> = {
  emergency: { get label() { return pt("Emergency contact"); }, get help() { return pt("Lumière may call this person if we cannot reach you in an urgent situation."); }, authority: false },
  academic: { get label() { return pt("Academic records"); }, get help() { return pt("Discuss your academic progress and records."); }, authority: true },
  financial: { get label() { return pt("Financial matters"); }, get help() { return pt("Discuss billing, payments and financial aid."); }, authority: true },
  release: { get label() { return pt("Release of information"); }, get help() { return pt("Receive information Lumière would otherwise share only with you."); }, authority: true },
};

export function authorityChip(status: ContactAuthorityStatus): { label: string; tone: ChipTone } {
  switch (status) {
    case "verified":
      return { label: pt("Verified by Lumière"), tone: "verified" };
    case "pending_verification":
      return { label: pt("Verification pending"), tone: "waiting" };
    case "revoked":
      return { label: pt("Not authorized"), tone: "attention" };
    default:
      return { label: pt("Listed by you"), tone: "neutral" };
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
  if (r === "us") return pt("U.S. resident");
  if (r === "foreign") return pt("International (non-U.S.)");
  return pt("Not recorded");
}

export function hsPathLabel(p: "local_diploma" | "ged" | "foreign" | null): string {
  if (p === "local_diploma") return pt("High school diploma");
  if (p === "ged") return pt("GED");
  if (p === "foreign") return pt("Foreign secondary credential");
  return pt("Not recorded");
}

export function docTypeActionHref(): string {
  return "/documents";
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const FRIENDLY_CODES: Record<string, string> = {
  get PROFILE_CORRECTION_ALREADY_PENDING() { return pt("You already have a correction under review. Withdraw it first if you want to submit a different one."); },
  get PROFILE_CORRECTION_NO_CHANGE() { return pt("Those values are the same as what is on record. Change at least one field."); },
  get PROFILE_CORRECTION_NOT_PENDING() { return pt("That request is no longer pending."); },
  get PROFILE_CONTACT_AUTHORITY_STAFF_MANAGED() { return pt("This contact's authority was verified by Lumière, so it can only be changed by our team. Please contact Lumière."); },
  get PROFILE_PHOTO_INVALID() { return pt("That photo could not be used. Choose a PNG, JPEG or WEBP image under 5 MB."); },
  get PROFILE_EVIDENCE_NOT_OWNED() { return pt("That document could not be attached to your request."); },
  get PROFILE_IDENTITY_REQUIRES_CORRECTION() { return pt("Legal identity can only be changed through a correction request."); },
  get PROFILE_FIELDS_STAFF_CONTROLLED() { return pt("That information is managed by Lumière staff."); },
  get PROFILE_EMAIL_MANAGED_BY_ACCOUNT() { return pt("Your sign-in email is managed by your account. Contact support to change it."); },
};

export function describeError(error: unknown, fallback = pt("Something went wrong. Please try again.")): string {
  const e = error as { code?: string; message?: string; status?: number } | null;
  if (e?.code && FRIENDLY_CODES[e.code]) return FRIENDLY_CODES[e.code];
  if (e?.status === 413) return pt("That file is too large. Choose an image under 5 MB.");
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
  if (!v) return required ? pt("Enter a phone number") : null;
  if (v.length < 5) return pt("Enter at least 5 characters");
  if (v.length > 32) return pt("Use 32 characters or fewer");
  if (!/^[+()\d][\d\s().\-+]*$/.test(v)) return pt("Use digits, spaces, + and dashes only");
  return null;
}

export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : pt("Enter a valid email address");
}

/** Document types shown under Academic Background, so Eligibility does not list them again. */
export const EDUCATION_DOC_TYPES: ReadonlySet<string> = new Set([
  "hs_transcript",
  "hs_diploma",
  "degree_certificate",
  "college_transcript",
  "foreign_eval",
]);
