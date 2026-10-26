import crypto from "crypto";
import { supabaseAdmin } from "./supabase";

/**
 * Invitation-only account creation. Tokens are random, returned to the
 * inviting admin once, and stored only as SHA-256 hashes. An invitation is
 * bound to one email address, expires, and is single-use.
 */

export const DEFAULT_INVITATION_TTL_HOURS = 72;
export const MAX_INVITATION_TTL_HOURS = 24 * 14;
// A claim that never completes (crashed signup) becomes reclaimable after this.
const CLAIM_LEASE_MS = 10 * 60 * 1000;

export function hashInvitationToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function generateInvitationToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function createInvitation(params: {
  email: string;
  createdBy: string;
  ttlHours?: number;
}): Promise<{ id: string; email: string; expiresAt: string; token: string }> {
  const ttl = Math.min(Math.max(params.ttlHours ?? DEFAULT_INVITATION_TTL_HOURS, 1), MAX_INVITATION_TTL_HOURS);
  const token = generateInvitationToken();
  const email = normalizeInvitationEmail(params.email);
  const expiresAt = new Date(Date.now() + ttl * 3600 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("account_invitations")
    .insert({
      email,
      token_hash: hashInvitationToken(token),
      role: "student",
      created_by: params.createdBy,
      expires_at: expiresAt,
    })
    .select("id, email, expires_at")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create invitation: ${error?.message ?? "no row returned"}`);
  }
  return { id: data.id, email: data.email, expiresAt: data.expires_at, token };
}

/**
 * Atomically claim an unexpired, unrevoked, unconsumed invitation for this
 * email. Concurrent claims of the same token cannot both succeed: the guarded
 * UPDATE matches at most one caller. Returns the invitation id or null.
 */
export async function claimInvitation(token: string, email: string): Promise<string | null> {
  if (!token || typeof token !== "string" || token.length > 256) return null;
  const now = new Date();
  const staleClaim = new Date(now.getTime() - CLAIM_LEASE_MS).toISOString();

  const { data, error } = await supabaseAdmin
    .from("account_invitations")
    .update({ claimed_at: now.toISOString() })
    .eq("token_hash", hashInvitationToken(token))
    .eq("email", normalizeInvitationEmail(email))
    .is("consumed_at", null)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString())
    .or(`claimed_at.is.null,claimed_at.lt.${staleClaim}`)
    .select("id")
    .maybeSingle();

  if (error || !data) return null;
  return data.id;
}

/** Return a claimed invitation to the pool after a failed signup. */
export async function releaseInvitation(id: string): Promise<void> {
  await supabaseAdmin
    .from("account_invitations")
    .update({ claimed_at: null })
    .eq("id", id)
    .is("consumed_at", null);
}

export async function consumeInvitation(id: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("account_invitations")
    .update({ consumed_at: new Date().toISOString(), consumed_by: userId })
    .eq("id", id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  return !error && !!data;
}
