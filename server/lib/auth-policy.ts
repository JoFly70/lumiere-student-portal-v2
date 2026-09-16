export type SupabaseAuthErrorLike = {
  status?: number;
  code?: string;
  message?: string;
};

export function isDuplicateSignupError(error: SupabaseAuthErrorLike): boolean {
  const normalizedCode = error.code?.toLowerCase();
  return error.status === 409 ||
    normalizedCode === "user_already_exists" ||
    /already\s+(?:been\s+)?registered|already\s+exists/i.test(error.message ?? "");
}

export function resolvePasswordResetAppUrl(
  value: string | undefined,
  isProduction: boolean,
): string | null {
  const candidate = value || (isProduction ? "" : "http://localhost:5000");
  try {
    const parsed = new URL(candidate);
    if (
      isProduction &&
      (parsed.protocol !== "https:" ||
        ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname))
    ) {
      return null;
    }
    return parsed.origin + parsed.pathname.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function hasRecoveryAuthenticationMethod(token: string): boolean {
  try {
    const payload = token.split(".")[1];
    if (!payload) return false;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      amr?: unknown[];
    };
    return decoded.amr?.some((entry) =>
      typeof entry === "string"
        ? entry === "otp" || entry === "recovery"
        : Boolean(
            entry &&
            typeof entry === "object" &&
            "method" in entry &&
            ((entry as { method?: unknown }).method === "otp" ||
              (entry as { method?: unknown }).method === "recovery"),
          ),
    ) === true;
  } catch {
    return false;
  }
}