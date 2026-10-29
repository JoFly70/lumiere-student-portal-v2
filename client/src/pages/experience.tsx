/**
 * /experience: landing page of the owner's "Experience as student" tab. Waits for the session handed over by the
 * admin tab that opened it (same-origin postMessage from window.opener), stores it in sessionStorage (tab scoped; the
 * admin's localStorage session is untouched) and enters the complete student UI.
 */
import { useEffect, useState } from "react";
import {
  EXPERIENCE_LANDING_PATH, EXPERIENCE_READY_TYPE, TAB_AUTH_STORAGE_KEY, buildTabAuthState, parseExperienceMessage,
} from "@/lib/experience-session";

const TIMEOUT_MS = 25_000;

export default function ExperiencePage() {
  const [state, setState] = useState<"waiting" | "entering" | "failed">("waiting");

  useEffect(() => {
    const opener = window.opener as Window | null;
    const origin = window.location.origin;
    if (!opener) { setState("failed"); return; }
    let done = false;

    const onMessage = async (event: MessageEvent) => {
      if (done) return;
      const payload = parseExperienceMessage(event, origin, opener);
      if (!payload) return;
      done = true;
      setState("entering");
      const tabState = buildTabAuthState(payload);
      try {
        const res = await fetch("/api/csrf-token", { headers: { Authorization: `Bearer ${payload.session.access_token}` } });
        if (res.ok) {
          const body = await res.json();
          if (typeof body?.csrfToken === "string") tabState.session.csrf_token = body.csrfToken;
        }
      } catch { /* the app fetches CSRF lazily is not guaranteed; continue */ }
      try {
        sessionStorage.setItem(TAB_AUTH_STORAGE_KEY, JSON.stringify(tabState));
      } catch {
        setState("failed");
        return;
      }
      // A full navigation so the AuthProvider boots straight into the tab-scoped session.
      window.location.replace(EXPERIENCE_LANDING_PATH);
    };
    window.addEventListener("message", onMessage);
    const ping = () => { try { opener.postMessage({ type: EXPERIENCE_READY_TYPE }, origin); } catch { /* ignore */ } };
    ping();
    const interval = window.setInterval(ping, 500);
    const timeout = window.setTimeout(() => { if (!done) setState("failed"); }, TIMEOUT_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#0f1b33] p-6 text-center text-white" data-testid="experience-page">
      <div className="max-w-md space-y-3" role="status" aria-live="polite">
        <p className="font-serif text-2xl">Lumière</p>
        {state === "failed" ? (
          <>
            <p className="text-lg font-semibold">Demo experience unavailable</p>
            <p className="text-sm text-white/80">Start it from a student's file in the admin dashboard (“Experience as student”).</p>
          </>
        ) : (
          <p className="text-sm text-white/80">{state === "entering" ? "Opening the student experience…" : "Preparing the student demo…"}</p>
        )}
      </div>
    </main>
  );
}
