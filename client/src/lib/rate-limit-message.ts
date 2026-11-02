/**
 * S34 (S33-02): one friendly, localized message for HTTP 429, shared by both client fetch helpers
 * (queryClient.ts and api.ts). Never shows raw JSON or English server text to a French user.
 */
import { currentLanguage, translate } from "../i18n";

export const RATE_LIMITED_CODE = "rate_limited";

/** Seconds from a Retry-After header value (delta-seconds form only), or null. */
export function parseRetryAfterSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value.trim());
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/** The user-facing text for a 429. Mentions minutes only when the wait is clearly longer than a minute. */
export function rateLimitedMessage(retryAfterSeconds?: number | null): string {
  const lang = currentLanguage();
  if (retryAfterSeconds && retryAfterSeconds >= 90) {
    return translate(lang, "auth.requests.rateLimitedWait", { minutes: Math.ceil(retryAfterSeconds / 60) });
  }
  return translate(lang, "auth.requests.rateLimited");
}
