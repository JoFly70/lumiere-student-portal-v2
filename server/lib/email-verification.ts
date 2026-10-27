/**
 * Email verification + resend handlers.
 *
 * Verification is confirmed by the identity provider, never inferred from the
 * mere presence of a token: the credential is either exchanged with Supabase
 * (verifyOtp with token_hash) or introspected (getUser) and only an
 * email_confirmed_at timestamp from the provider counts as success.
 * Credentials are never logged and never echoed in a response.
 */
import type { Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";
import { createRateLimitStore } from "./rate-limit-store";

export const RESEND_GENERIC_MESSAGE =
  "If that address has a pending verification, a new email is on its way.";

const VERIFY_TYPES = new Set(["signup", "email"]);
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const JWT_RE = /^[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*$/;
const TOKEN_HASH_RE = /^[A-Za-z0-9_-]{8,256}$/;

export type VerificationCode = "MISSING" | "MALFORMED" | "INVALID_OR_EXPIRED" | "UNVERIFIED" | "UNAVAILABLE";

export function isPlausibleEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 320 && EMAIL_RE.test(value.trim());
}

type ConfirmedUser = { email_confirmed_at?: string | null } | null | undefined;
type AuthResult = { data?: { user?: ConfirmedUser } | null; error?: unknown };

export interface VerificationDeps {
  isConfigured: () => boolean;
  getUser: (accessToken: string) => Promise<AuthResult>;
  verifyOtp: (params: { token_hash: string; type: "signup" | "email" }) => Promise<AuthResult>;
  resend: (email: string, redirectTo: string | undefined) => Promise<{ error?: unknown }>;
  appUrl: () => string | null;
  warn: (message: string, meta?: Record<string, unknown>) => void;
}

function fail(res: Response, status: number, code: VerificationCode) {
  return res.status(status).json({ verified: false, code });
}

export function createVerifyEmailHandler(deps: VerificationDeps): RequestHandler {
  return async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const accessToken = body.access_token;
      const tokenHash = body.token_hash;
      const type = body.type;

      const hasAccess = accessToken !== undefined && accessToken !== null && accessToken !== "";
      const hasHash = tokenHash !== undefined && tokenHash !== null && tokenHash !== "";
      if (!hasAccess && !hasHash) return fail(res, 400, "MISSING");

      if (!deps.isConfigured()) return fail(res, 503, "UNAVAILABLE");

      let result: AuthResult;
      if (hasHash) {
        if (typeof tokenHash !== "string" || !TOKEN_HASH_RE.test(tokenHash) || typeof type !== "string" || !VERIFY_TYPES.has(type)) {
          return fail(res, 400, "MALFORMED");
        }
        result = await deps.verifyOtp({ token_hash: tokenHash, type: type as "signup" | "email" });
      } else {
        if (typeof accessToken !== "string" || accessToken.length > 4096 || !JWT_RE.test(accessToken)) {
          return fail(res, 400, "MALFORMED");
        }
        if (type !== undefined && (typeof type !== "string" || !VERIFY_TYPES.has(type))) {
          // e.g. a recovery link must never count as an email verification
          return fail(res, 400, "MALFORMED");
        }
        result = await deps.getUser(accessToken);
      }

      const user = result.data?.user;
      if (result.error || !user) {
        deps.warn("Email verification rejected by provider");
        return fail(res, 401, "INVALID_OR_EXPIRED");
      }
      if (!user.email_confirmed_at) return fail(res, 401, "UNVERIFIED");

      return res.json({ verified: true });
    } catch {
      deps.warn("Email verification error");
      return fail(res, 503, "UNAVAILABLE");
    }
  };
}

export function createResendVerificationHandler(deps: VerificationDeps): RequestHandler {
  return async (req: Request, res: Response) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    if (!isPlausibleEmail(email)) {
      return res.status(400).json({ error: "A valid email address is required" });
    }
    if (!deps.isConfigured()) {
      return res.status(503).json({ error: "Service unavailable" });
    }
    try {
      // type "signup" only re-sends for an existing unconfirmed account; it can
      // never create one, so invitation-only registration is unaffected.
      const { error } = await deps.resend(email.trim(), deps.appUrl() ? `${deps.appUrl()}/verify-email` : undefined);
      if (error) deps.warn("Verification resend not delivered");
    } catch {
      deps.warn("Verification resend error");
    }
    // Identical response whether or not the address exists / is already verified.
    return res.json({ success: true, message: RESEND_GENERIC_MESSAGE });
  };
}

export const verifyEmailRateLimit = rateLimit({
  store: createRateLimitStore("rl:verify-email:"),
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ verified: false, error: "Too many verification attempts. Please try again later." });
  },
  skip: () => process.env.NODE_ENV === "test",
});

export const resendVerificationRateLimit = rateLimit({
  store: createRateLimitStore("rl:resend-verification:"),
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many requests. Please try again in an hour." });
  },
  skip: () => process.env.NODE_ENV === "test",
});
