/**
 * Personalized welcome banner (S21). Brief, inline at the top of the Flight Deck (no modal), dismissible, shown once
 * per login. What it says comes from the server: GET /api/student/welcome decides first vs returning and counts only
 * real items awaiting the student. The photo reuses the signed URL that GET /api/students/me already returns.
 * Theme tokens only; no motion under prefers-reduced-motion.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
void React;
import { X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useT, type TranslationKey } from "@/i18n";
import { apiRequest, getCsrfToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export interface WelcomeData {
  firstName: string | null;
  kind: "first" | "returning";
  attention: { count: number; path: string | null };
  photo: boolean;
}

export const WELCOME_API = "/api/student/welcome";
export const WELCOME_SHOWN_KEY = "lumiere_welcome_shown";

/** first wins; otherwise a real attention count switches the returning message. */
export function welcomeMessageKey(d: Pick<WelcomeData, "kind" | "attention" | "firstName">): TranslationKey {
  const anon = !d.firstName;
  if (d.kind === "first") return (anon ? "welcome.firstAnon" : "welcome.first") as TranslationKey;
  if (d.attention.count > 0) return (anon ? "welcome.attentionAnon" : "welcome.attention") as TranslationKey;
  return (anon ? "welcome.returningAnon" : "welcome.returning") as TranslationKey;
}

export function initialsOf(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((p) => Array.from(p)[0]!.toUpperCase()).join("") : "L";
}

/** Only same-origin app paths are ever linked, whatever the server sent. */
export function safeAttentionPath(path: string | null): string | null {
  return path && /^\/[a-z][a-z0-9/-]*$/.test(path) ? path : null;
}

/** One stable marker per login (the CSRF token is minted at login and survives token refreshes). Never stores the token itself. */
export function sessionMarker(seed: string | null | undefined): string {
  let h = 5381;
  for (const ch of seed ?? "anonymous") h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return `s${(h >>> 0).toString(36)}`;
}

function readShown(): string | null {
  try { return window.sessionStorage.getItem(WELCOME_SHOWN_KEY); } catch { return null; }
}
function writeShown(marker: string): void {
  try { window.sessionStorage.setItem(WELCOME_SHOWN_KEY, marker); } catch { /* private mode: banner may reappear on reload, harmless */ }
}

export interface WelcomeBannerViewProps {
  data: WelcomeData;
  photoUrl?: string | null;
  onDismiss?: () => void;
}

/** Pure presentation (rendered in tests without a network). */
export function WelcomeBannerView({ data, photoUrl, onDismiss }: WelcomeBannerViewProps) {
  const { t } = useT();
  const href = data.kind === "first" ? null : data.attention.count > 0 ? safeAttentionPath(data.attention.path) : null;
  const message = t(welcomeMessageKey(data), { name: data.firstName ?? "" });
  return (
    <section
      role="region"
      aria-label={t("welcome.region" as TranslationKey)}
      data-testid="welcome-banner"
      data-kind={data.kind}
      data-attention={data.attention.count > 0 ? "true" : "false"}
      className="mx-auto mb-4 flex w-full max-w-6xl items-center gap-3 rounded-xl px-4 py-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300"
      style={{ background: "var(--t-panel)", border: "1px solid var(--t-accent-line, var(--t-line-2))", color: "var(--t-text)", boxShadow: "var(--t-shadow)" }}
    >
      <Avatar className="h-10 w-10" data-testid="welcome-avatar">
        {photoUrl ? <AvatarImage src={photoUrl} alt="" /> : null}
        <AvatarFallback aria-hidden="true" style={{ background: "var(--t-accent-dim)", color: "var(--t-accent-text, var(--t-heading))" }}>
          {initialsOf(data.firstName)}
        </AvatarFallback>
      </Avatar>
      <p className="min-w-0 flex-1 text-sm font-medium leading-snug" style={{ color: "var(--t-heading)" }} data-testid="welcome-message">
        {message}
        {href && (
          <>
            {" "}
            <Link href={href} className="underline underline-offset-2" style={{ color: "var(--t-accent-text, var(--t-heading))" }} data-testid="welcome-attention-link">
              {t("welcome.review" as TranslationKey)}
            </Link>
          </>
        )}
      </p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("welcome.dismiss" as TranslationKey)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ color: "var(--t-text-2)", outlineColor: "var(--t-focus)" }}
          data-testid="welcome-dismiss"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

/** Connected banner. Renders nothing while loading, on any error, once dismissed, or when already shown this login. */
export function WelcomeBanner() {
  const { session } = useAuth();
  const marker = sessionMarker(session?.csrf_token ?? session?.access_token?.slice(-16));
  const [hidden, setHidden] = useState<boolean>(() => readShown() === marker);

  const welcome = useQuery<WelcomeData>({
    queryKey: [WELCOME_API],
    queryFn: () => apiRequest<WelcomeData>(WELCOME_API),
    enabled: !hidden,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const hasPhoto = !hidden && welcome.data?.photo === true;
  const photo = useQuery<string | null>({
    queryKey: [WELCOME_API, "photo"],
    queryFn: async () => (await apiRequest<{ photo_url?: string | null }>("/api/students/me")).photo_url ?? null,
    enabled: hasPhoto,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const shown = !hidden && !!welcome.data;
  useEffect(() => {
    if (!shown) return;
    writeShown(marker);
    // Server records that the welcome was shown, so the next login is "returning". Fire and forget.
    if (getCsrfToken()) void apiRequest(`${WELCOME_API}/seen`, { method: "POST" }).catch(() => undefined);
  }, [shown, marker]);

  const dismiss = useCallback(() => { writeShown(marker); setHidden(true); }, [marker]);

  if (!shown || !welcome.data) return null;
  return <WelcomeBannerView data={welcome.data} photoUrl={photo.data ?? null} onDismiss={dismiss} />;
}

export default WelcomeBanner;
