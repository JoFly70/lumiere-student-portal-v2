/** Admin invitation endpoints (server/routes/admin.ts). The token is returned once per issue/resend and never listed. */
import { apiRequest } from "@/lib/queryClient";

export type InvitationLanguage = "en" | "fr";
export type EmailDelivery = "sent" | "not_configured" | "failed" | "skipped";
export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface IssuedInvitation {
  id: string;
  email: string;
  expiresAt: string;
  token: string;
  emailDelivery: EmailDelivery;
}

export interface InvitationRow {
  id: string;
  email: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  status: InvitationStatus;
}

export const INVITATIONS_KEY = ["/api/admin/invitations"] as const;

/** The exact sign-up link the login page consumes (?invite= opens the invitation tab; ?lang= picks the language). */
export function invitationSignupUrl(token: string, language?: InvitationLanguage, origin = typeof window === "undefined" ? "" : window.location.origin) {
  return `${origin}/login?invite=${encodeURIComponent(token)}${language ? `&lang=${language}` : ""}`;
}

export async function issueInvitation(body: { email: string; language: InvitationLanguage; sendEmail: boolean }): Promise<IssuedInvitation> {
  return (await apiRequest("POST", "/api/admin/invitations", body)).json();
}

export async function resendInvitation(id: string, body: { language: InvitationLanguage; sendEmail: boolean }): Promise<IssuedInvitation> {
  return (await apiRequest("POST", `/api/admin/invitations/${encodeURIComponent(id)}/resend`, body)).json();
}

export async function revokeInvitation(id: string): Promise<void> {
  await apiRequest("POST", `/api/admin/invitations/${encodeURIComponent(id)}/revoke`);
}

/** One sentence the admin can trust about what happened to the email. */
export function deliveryMessage(d: EmailDelivery, email: string): string {
  switch (d) {
    case "sent": return `Invitation emailed to ${email}.`;
    case "not_configured": return "Email sending is not configured on this server, so nothing was emailed. Copy the link below and send it to the student yourself.";
    case "failed": return "The email could not be sent. Copy the link below and send it to the student yourself, or try Resend later.";
    case "skipped": return "No email was sent (you chose copy only). Copy the link below and send it to the student yourself.";
  }
}
