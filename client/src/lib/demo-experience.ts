/**
 * "Experience as student" (owner): opens the complete student UI for a synthetic mirror of a student in a new tab.
 * Call from a click handler. The tab is opened synchronously (popup blockers), then the server mints the mirror
 * session and it is handed to the tab with postMessage once the tab says it is ready.
 */
import { apiRequest } from "@/lib/api";
import {
  EXPERIENCE_PATH, EXPERIENCE_SESSION_TYPE, sanitizeReturnPath, isExperienceReadyMessage, isExperiencePayload,
  type ExperiencePayload,
} from "@/lib/experience-session";

const READY_TIMEOUT_MS = 20_000;

export async function openStudentExperience(studentId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const origin = window.location.origin;
  // Synchronous, before any await, so the browser treats it as user-initiated.
  // The demo tab remembers where "Back to staff portal" should land: this very page (file or list).
  const back = sanitizeReturnPath(window.location.pathname + window.location.search);
  const tab = window.open(`${EXPERIENCE_PATH}?return=${encodeURIComponent(back)}`, "_blank");
  if (!tab) return { ok: false, message: "The browser blocked the new tab. Allow pop-ups for this site and try again." };

  let onMessage: ((e: MessageEvent) => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    onMessage = (e: MessageEvent) => {
      if (isExperienceReadyMessage(e, origin, tab)) resolve();
    };
    window.addEventListener("message", onMessage);
  });
  const cleanup = () => { if (onMessage) window.removeEventListener("message", onMessage); };
  const fail = (message: string) => {
    cleanup();
    try { tab.close(); } catch { /* ignore */ }
    return { ok: false as const, message };
  };

  try {
    const payload = await apiRequest<ExperiencePayload>(`/api/admin/students/${encodeURIComponent(studentId)}/experience`, { method: "POST" });
    if (!isExperiencePayload(payload)) return fail("The demo session could not be created. Please try again.");
    const timedOut = await Promise.race([
      ready.then(() => false),
      new Promise<boolean>((r) => setTimeout(() => r(true), READY_TIMEOUT_MS)),
    ]);
    if (timedOut || tab.closed) return fail("The demo tab did not open. Please try again.");
    tab.postMessage({ type: EXPERIENCE_SESSION_TYPE, payload }, origin);
    cleanup();
    return { ok: true };
  } catch (error) {
    return fail(error instanceof Error && error.message ? error.message : "The demo session could not be created.");
  }
}
