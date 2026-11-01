/**
 * S32-B (SA-07): the enrollment status shown on the Student File, derived only from authoritative records:
 * the student record (email, linked user), the latest portal invitation for the record email, and student-role
 * accounts with that email. Nothing here completes enrollment, links an account or activates a student; it only
 * says where the student is and what the one next action is. Pure: shared by the server view and the client.
 */

export type InvitationState = "none" | "pending" | "expired" | "revoked" | "accepted";

export interface InvitationFacts {
  readonly state: InvitationState;
  readonly sentAt: string | null;
  readonly expiresAt: string | null;
  readonly acceptedAt: string | null;
}

export type EnrollmentStage =
  /** The record has no email: an invitation cannot be sent and no account can be linked. */
  | "no_email"
  /** No invitation has been sent to the record email. */
  | "not_invited"
  /** An invitation is waiting for the student. */
  | "invited"
  /** The last invitation expired or was revoked before use. */
  | "invitation_lapsed"
  /** The invitation was used but no student account with the record email exists (e.g. the student typed another email). */
  | "accepted_no_account"
  /** A student account with the record email exists and is not linked: an administrator must confirm the link. */
  | "ready_to_link"
  /** Linked: the student portal works for this record. */
  | "linked";

export type EnrollmentNextAction = "add_email" | "send_invitation" | "wait_for_student" | "resend_invitation" | "check_email" | "link_account" | "none";

export interface EnrollmentStatus {
  readonly stage: EnrollmentStage;
  readonly next: EnrollmentNextAction;
  readonly invitation: InvitationFacts;
  readonly candidateCount: number;
}

export interface EnrollmentInput {
  readonly studentEmail: string;
  readonly linked: boolean;
  readonly candidateCount: number;
  readonly invitation: InvitationFacts | null;
}

const NO_INVITATION: InvitationFacts = { state: "none", sentAt: null, expiresAt: null, acceptedAt: null };

/** Latest invitation row -> its state at `now`. */
export function invitationState(row: { createdAt: string; expiresAt: string; consumedAt: string | null; revokedAt: string | null } | null, now: Date): InvitationFacts {
  if (!row) return NO_INVITATION;
  const state: InvitationState = row.consumedAt ? "accepted" : row.revokedAt ? "revoked" : Date.parse(row.expiresAt) <= now.getTime() ? "expired" : "pending";
  return { state, sentAt: row.createdAt, expiresAt: row.expiresAt, acceptedAt: row.consumedAt };
}

export function deriveEnrollmentStatus(i: EnrollmentInput): EnrollmentStatus {
  const invitation = i.invitation ?? NO_INVITATION;
  const base = { invitation, candidateCount: i.candidateCount };
  if (i.linked) return { ...base, stage: "linked", next: "none" };
  if (!i.studentEmail.trim()) return { ...base, stage: "no_email", next: "add_email" };
  if (i.candidateCount > 0) return { ...base, stage: "ready_to_link", next: "link_account" };
  switch (invitation.state) {
    case "pending": return { ...base, stage: "invited", next: "wait_for_student" };
    case "expired":
    case "revoked": return { ...base, stage: "invitation_lapsed", next: "resend_invitation" };
    case "accepted": return { ...base, stage: "accepted_no_account", next: "check_email" };
    default: return { ...base, stage: "not_invited", next: "send_invitation" };
  }
}

/** A plausible single email address (the same shape the invitation flow accepts). */
export function isPlausibleEmail(v: string): boolean {
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
