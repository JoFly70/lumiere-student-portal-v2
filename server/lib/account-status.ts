import { supabaseAdmin } from "./supabase";
import { logger } from "./logger";

/**
 * Account lifecycle gate. An account may authenticate only when its profile
 * row exists with status 'active'. Archived, inactive and pending accounts are
 * rejected, and a missing profile or a failed lookup fails closed.
 */
export type AccountStatus = "active" | "inactive" | "pending" | "archived" | "missing" | "unknown";

export const ACCOUNT_INACTIVE_RESPONSE = {
  error: "Account is not active",
  code: "ACCOUNT_INACTIVE",
} as const;

const KNOWN_STATUSES = new Set(["active", "inactive", "pending", "archived"]);

export async function getAccountStatus(userId: string): Promise<AccountStatus> {
  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      logger.warn("Account status lookup failed", { userId, error: error.message });
      return "unknown";
    }
    if (!data) return "missing";
    return KNOWN_STATUSES.has(data.status) ? (data.status as AccountStatus) : "unknown";
  } catch (error) {
    logger.warn("Account status lookup failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "unknown";
  }
}

export async function isAccountActive(userId: string): Promise<boolean> {
  return (await getAccountStatus(userId)) === "active";
}
