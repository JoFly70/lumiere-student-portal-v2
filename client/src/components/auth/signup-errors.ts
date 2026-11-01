/**
 * S32-A (F19): localised sign-up / invitation errors. Presentation only.
 *
 * The server answers /api/auth/signup with `{ error, code }` (server/routes.ts). lib/auth.tsx currently throws a plain
 * Error(error.error), which drops the code; until that preserves it as an AuthRequestError, the known English server messages
 * are mapped as a fallback so the student never sees raw English on a French screen.
 */
import type { TranslationKey } from "@/i18n";
import { AuthRequestError } from "@/lib/auth-errors";

type T = (key: TranslationKey) => string;

export type SignupErrorKind = "invitation_invalid" | "invitation_required" | "email_registered" | "password_short" | "invalid_input" | "unavailable" | "generic";

const BY_CODE: Record<string, SignupErrorKind> = {
  INVITATION_INVALID: "invitation_invalid",
  INVITATION_REQUIRED: "invitation_required",
  EMAIL_ALREADY_REGISTERED: "email_registered",
  EMAIL_CONFIRMATION_CONFIGURATION: "unavailable",
};

/** Exact English messages the sign-up server returns (fallback when the code did not survive). */
const BY_MESSAGE: Array<[RegExp, SignupErrorKind]> = [
  [/invitation is invalid or has expired/i, "invitation_invalid"],
  [/an invitation is required/i, "invitation_required"],
  [/email already registered/i, "email_registered"],
  [/password must be at least 6 characters/i, "password_short"],
  [/invalid input format/i, "invalid_input"],
  [/account creation error|failed to create user profile|email confirmation configuration/i, "unavailable"],
];

export function classifySignupError(error: unknown): SignupErrorKind {
  if (error instanceof AuthRequestError) {
    if (error.code && BY_CODE[error.code]) return BY_CODE[error.code]!;
    if (error.status >= 500) return "unavailable";
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && BY_CODE[code]) return BY_CODE[code]!;
  const message = error instanceof Error ? error.message : "";
  for (const [re, kind] of BY_MESSAGE) if (re.test(message)) return kind;
  return "generic";
}

const KEY: Record<SignupErrorKind, TranslationKey> = {
  invitation_invalid: "s32.auth.err.invitationInvalid" as TranslationKey,
  invitation_required: "s32.auth.err.invitationRequired" as TranslationKey,
  email_registered: "s32.auth.err.emailRegistered" as TranslationKey,
  password_short: "s32.auth.err.passwordShort" as TranslationKey,
  invalid_input: "s32.auth.err.invalidInput" as TranslationKey,
  unavailable: "auth.error.unavailable",
  generic: "auth.invite.failed",
};

/** Localised message plus whether to offer "Sign in / Reset password" (duplicate email). */
export function signUpErrorInfo(error: unknown, t: T): { kind: SignupErrorKind; message: string; offerSignIn: boolean } {
  const kind = classifySignupError(error);
  return { kind, message: t(KEY[kind]), offerSignIn: kind === "email_registered" };
}
