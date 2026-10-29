/** Global "session expired" signal: any authenticated API call that gets a 401 asks the AuthProvider to sign out. */
export const SESSION_EXPIRED_EVENT = "lumiere:session-expired";

const EXPIRY_MESSAGES = [
  "Invalid or expired token",
  "Invalid or expired session",
  "Missing or invalid authorization header",
  "Authentication required",
  "Account profile is not available",
];

/** True when a 401 body message means the bearer session is no longer valid (not e.g. a wrong password). */
export function isSessionExpiredResponse(status: number, message: string | null | undefined): boolean {
  if (status !== 401) return false;
  if (!message) return true;
  return EXPIRY_MESSAGES.some((m) => message.includes(m));
}

export function notifySessionExpired(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}
