import type { TranslationKey } from "@/i18n";

/** Failure from an /api/auth/* call; keeps the HTTP status and machine code so the UI can translate it. */
export class AuthRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AuthRequestError";
    this.status = status;
    this.code = code;
  }
}

/** Parse a failed fetch Response from an auth endpoint into an AuthRequestError. */
export async function authErrorFromResponse(res: { status: number; json: () => Promise<any> }, fallback: string): Promise<AuthRequestError> {
  const body = await res.json().catch(() => ({}));
  return new AuthRequestError(typeof body?.error === "string" ? body.error : fallback, res.status, typeof body?.code === "string" ? body.code : undefined);
}

type T = (key: TranslationKey) => string;

/** Localised, non-leaky message for a sign-in failure. */
export function signInErrorMessage(error: unknown, t: T): string {
  if (error instanceof AuthRequestError) {
    if (error.status === 401) return t("auth.error.invalidCredentials");
    if (error.status === 429) return t("auth.error.rateLimited");
    if (error.status === 403 && error.code === "EMAIL_VERIFICATION_REQUIRED") return t("auth.error.verifyEmail");
    if (error.status === 403 && error.code === "ACCOUNT_INACTIVE") return t("auth.error.inactive");
    if (error.status >= 500) return t("auth.error.unavailable");
    return t("auth.signin.failed");
  }
  if (error instanceof TypeError) return t("auth.error.network");
  return error instanceof Error && error.message ? error.message : t("auth.signin.failed");
}

/** Localised message for a failed reset request / password update. */
export function resetErrorMessage(error: unknown, t: T, fallback: TranslationKey): string {
  if (error instanceof AuthRequestError) {
    if (error.status === 429) return t("auth.error.rateLimitedReset");
    if (error.status === 401) return t("auth.error.tokenInvalid");
    if (error.status >= 500) return t("auth.error.unavailable");
    return t(fallback);
  }
  if (error instanceof TypeError) return t("auth.error.network");
  return t(fallback);
}

/**
 * S32-B (SA-18): localised, actionable message for a failed invitation sign-up. The server deliberately uses one
 * code for every invitation problem (wrong code, other email, used, revoked or expired) so invitation state never
 * leaks; the message therefore tells the person what to check and how to recover.
 */
export function signUpErrorMessage(error: unknown, t: T): string {
  if (error instanceof AuthRequestError) {
    switch (error.code) {
      case "INVITATION_INVALID": return t("auth.signup.error.invitationInvalid");
      case "INVITATION_REQUIRED": return t("auth.signup.error.invitationRequired");
      case "EMAIL_ALREADY_REGISTERED": return t("auth.signup.error.alreadyRegistered");
      case "PASSWORD_TOO_SHORT": return t("auth.signup.error.passwordShort");
      default: break;
    }
    if (error.status === 429) return t("auth.error.rateLimited");
    if (error.status >= 500) return t("auth.error.unavailable");
    return t("auth.invite.failed");
  }
  if (error instanceof TypeError) return t("auth.error.network");
  return t("auth.invite.failed");
}
