/**
 * S09 — pure presentation logic for the staff "Profile & identity" panel.
 * No React, no I/O: unit-tested by tests/s09-staff-profile-review.test.ts.
 *
 * Trust language is derived from evidence/authority STATUS only. A populated
 * field is never treated as verified.
 */
import type {
  ContactAuthorityStatus,
  CorrectionStatus,
  EvidenceStatus,
  IdentityCorrectionField,
  IdentityCorrectionRequestView,
  StudentContactView,
} from "@shared/student-profile-contract";
import { contactRequestsAuthority } from "@shared/student-profile-contract";

export const STAFF_PROFILE_PATHS = {
  profile: (studentId: string) => `/api/students/${encodeURIComponent(studentId)}/profile`,
  history: (studentId: string) => `/api/students/${encodeURIComponent(studentId)}/identity-corrections`,
  resolve: (requestId: string) => `/api/students/identity-corrections/${encodeURIComponent(requestId)}/resolve`,
  authority: (contactId: string) => `/api/students/contacts/${encodeURIComponent(contactId)}/authority`,
  queue: "/api/students/identity-corrections?status=pending",
  documents: (studentId: string) => `/admin/students/${encodeURIComponent(studentId)}#workspace-documents`,
} as const;

export const STAFF_PROFILE_QUERY_KEY = (studentId: string) => ["admin-student-profile", studentId] as const;
export const STAFF_PROFILE_HISTORY_QUERY_KEY = (studentId: string) => ["admin-student-profile-history", studentId] as const;

export const FIELD_LABELS: Readonly<Record<IdentityCorrectionField, string>> = {
  first_name: "First name",
  middle_name: "Middle name",
  last_name: "Last name",
  dob: "Date of birth",
  sex: "Sex",
  nationality: "Nationality",
  gov_id_type: "Government ID type",
  gov_id_number: "Government ID number",
};

export function fieldLabel(field: string): string {
  return (FIELD_LABELS as Record<string, string>)[field] ?? field;
}

export interface TrustBadge {
  readonly label: string;
  readonly tone: "verified" | "reported" | "pending" | "problem";
}

/** Identity trust: only a verified id_gov document makes identity "Verified by Lumière". */
export function identityTrust(verification: EvidenceStatus): TrustBadge {
  switch (verification) {
    case "verified":
      return { label: "Verified by Lumière", tone: "verified" };
    case "pending":
      return { label: "Reported by student · document under review", tone: "pending" };
    case "rejected":
      return { label: "Reported by student · document rejected", tone: "problem" };
    case "resubmit_requested":
      return { label: "Reported by student · new document requested", tone: "problem" };
    default:
      return { label: "Reported by student · no document on file", tone: "reported" };
  }
}

/** Explicit identity chip; same mapping as the student header. */
export function identityStatusChip(verification: EvidenceStatus): TrustBadge {
  switch (verification) {
    case "verified":
      return { label: "Identity: Verified", tone: "verified" };
    case "pending":
      return { label: "Identity: Under review", tone: "pending" };
    case "rejected":
    case "resubmit_requested":
      return { label: "Identity: Action required", tone: "problem" };
    default:
      return { label: "Identity: Not verified", tone: "reported" };
  }
}

export function authorityTrust(status: ContactAuthorityStatus): TrustBadge {
  switch (status) {
    case "verified":
      return { label: "Authority verified by Lumière", tone: "verified" };
    case "pending_verification":
      return { label: "Authority requested · awaiting verification", tone: "pending" };
    case "revoked":
      return { label: "Authority revoked", tone: "problem" };
    default:
      return { label: "Listed by student · no authority", tone: "reported" };
  }
}

export function correctionStatusLabel(status: CorrectionStatus): string {
  return { pending: "Pending review", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn by student" }[status];
}

export interface CorrectionRow {
  readonly field: IdentityCorrectionField;
  readonly label: string;
  readonly current: string;
  readonly requested: string;
}

const show = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? "Not on record" : v);

/** Current-vs-requested rows for a correction request (display values are already masked by the server). */
export function correctionRows(request: Pick<IdentityCorrectionRequestView, "fields" | "currentDisplay" | "requestedDisplay">): CorrectionRow[] {
  return request.fields.map((field) => ({
    field,
    label: fieldLabel(field),
    current: show(request.currentDisplay[field]),
    requested: show(request.requestedDisplay[field]),
  }));
}

export interface DecisionGate {
  readonly ok: boolean;
  readonly reason: string | null;
}

/** Reject needs a student-facing explanation (>= 5 chars); approve needs none. */
export function correctionDecisionGate(decision: "approve" | "reject", note: string): DecisionGate {
  if (decision === "approve") return { ok: true, reason: null };
  return note.trim().length >= 5
    ? { ok: true, reason: null }
    : { ok: false, reason: "Explain the rejection to the student (at least 5 characters)." };
}

/** Verify and revoke both require an audit note (>= 5 chars). */
export function authorityDecisionGate(note: string): DecisionGate {
  return note.trim().length >= 5
    ? { ok: true, reason: null }
    : { ok: false, reason: "Record the evidence you checked (at least 5 characters)." };
}

export function resolveBody(decision: "approve" | "reject", note: string) {
  const trimmed = note.trim();
  return trimmed ? { decision, note: trimmed } : { decision };
}

export function authorityBody(decision: "verify" | "revoke", note: string) {
  return { decision, note: note.trim() };
}

/** Which actions are available for a contact. Both are staff-only decisions. */
export function contactActions(contact: Pick<StudentContactView, "authorityStatus">): { canVerify: boolean; canRevoke: boolean } {
  return {
    canVerify: contact.authorityStatus === "pending_verification" || contact.authorityStatus === "revoked" || contact.authorityStatus === "listed",
    canRevoke: contact.authorityStatus === "verified" || contact.authorityStatus === "pending_verification",
  };
}

export type ResolveFailureKind = "conflict" | "forbidden" | "invalid" | "other";

/** Maps an HTTP status from a decision call to a user-facing outcome. */
export function classifyResolveFailure(status: number): { kind: ResolveFailureKind; message: string } {
  if (status === 409) return { kind: "conflict", message: "This request was already resolved. The profile has been refreshed." };
  if (status === 403) return { kind: "forbidden", message: "Your role cannot make this decision." };
  if (status === 400 || status === 422) return { kind: "invalid", message: "The decision was not accepted. Check the note and try again." };
  return { kind: "other", message: "Could not save the decision. Try again." };
}

export function normalizeHistory(payload: unknown): IdentityCorrectionRequestView[] {
  if (Array.isArray(payload)) return payload as IdentityCorrectionRequestView[];
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    for (const key of ["requests", "items", "corrections", "history"]) {
      if (Array.isArray(rec[key])) return rec[key] as IdentityCorrectionRequestView[];
    }
  }
  return [];
}

const SPECIAL_WORDS: Readonly<Record<string, string>> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  id: "ID",
};

/** Turns enum-like values ("IN_PROGRESS", "whatsapp", "pending_verification") into sentence-case words. */
export function humanize(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Not provided";
  const words = value.replace(/[_-]+/g, " ").trim().toLowerCase().split(/\s+/);
  const out = words.map((w) => SPECIAL_WORDS[w] ?? w);
  const first = out[0];
  if (!SPECIAL_WORDS[words[0]]) out[0] = first.charAt(0).toUpperCase() + first.slice(1);
  return out.join(" ");
}

export function humanizeList(values: readonly string[], empty = "None"): string {
  return values.length ? values.map((v) => humanize(v)).join(", ") : empty;
}

/** "Verify authority" is only a decision when authority was requested, never for an emergency-only listing. */
export function showVerifyAction(contact: Pick<StudentContactView, "authorityStatus" | "type" | "requestedScopes">): boolean {
  if (contact.authorityStatus === "pending_verification") return true;
  if (contact.authorityStatus === "revoked") return contactRequestsAuthority(contact.type, contact.requestedScopes);
  return false;
}

/** A contact whose authority request is waiting for a staff decision. */
export function contactNeedsDecision(contact: Pick<StudentContactView, "authorityStatus">): boolean {
  return contact.authorityStatus === "pending_verification";
}
