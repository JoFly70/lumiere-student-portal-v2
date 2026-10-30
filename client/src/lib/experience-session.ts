/**
 * "Experience as student" tab session helpers (pure, unit tested).
 *
 * The owner opens the complete student UI for a synthetic mirror student in a NEW tab. That tab keeps its
 * session in sessionStorage (tab scoped) so the admin's localStorage session is never touched.
 */

export const TAB_AUTH_STORAGE_KEY = "lumiere_auth_tab";
export const EXPERIENCE_READY_TYPE = "lumiere-experience-ready";
export const EXPERIENCE_SESSION_TYPE = "lumiere-experience-session";
export const EXPERIENCE_PATH = "/experience";
/** The Flight Deck route picks the right deck for the student's program (a bachelor's student must never land on a high-school page). */
export const EXPERIENCE_LANDING_PATH = "/flight-deck";

export interface ExperienceMirror {
  readonly studentId: string;
  readonly code: string;
  readonly label: string;
}
export interface ExperienceUser {
  id: string;
  email: string;
  name: string;
  role: "student";
}
export interface ExperienceSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}
export interface ExperiencePayload {
  readonly mirror: ExperienceMirror;
  readonly user: ExperienceUser;
  readonly session: ExperienceSession;
}
/** What is persisted in sessionStorage[lumiere_auth_tab]. */
export interface TabAuthState {
  user: ExperienceUser;
  session: ExperienceSession & { csrf_token?: string };
  experience: { label: string; code: string };
}

/** Minimal Storage surface so tests can pass a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export function isExperiencePayload(v: unknown, nowSec = Math.floor(Date.now() / 1000)): v is ExperiencePayload {
  if (!isRecord(v) || !isRecord(v.mirror) || !isRecord(v.user) || !isRecord(v.session)) return false;
  const { mirror, user, session } = v;
  return (
    nonEmpty(mirror.studentId) && nonEmpty(mirror.code) && nonEmpty(mirror.label) &&
    nonEmpty(user.id) && nonEmpty(user.email) && typeof user.name === "string" && user.role === "student" &&
    nonEmpty(session.access_token) && nonEmpty(session.refresh_token) &&
    typeof session.expires_at === "number" && Number.isFinite(session.expires_at) && session.expires_at > nowSec
  );
}

export interface MessageLike {
  readonly origin: string;
  readonly source: unknown;
  readonly data: unknown;
}

/**
 * Validate a message received by the /experience tab: same origin, sent by window.opener, right type and shape.
 * Returns the payload or null. Never throws.
 */
export function parseExperienceMessage(
  event: MessageLike,
  expectedOrigin: string,
  opener: unknown,
  nowSec = Math.floor(Date.now() / 1000),
): ExperiencePayload | null {
  if (!opener || event.source !== opener) return null;
  if (event.origin !== expectedOrigin) return null;
  const d = event.data;
  if (!isRecord(d) || d.type !== EXPERIENCE_SESSION_TYPE) return null;
  return isExperiencePayload(d.payload, nowSec) ? d.payload : null;
}

/** Validate the "ready" ping the admin tab receives from the tab it opened. */
export function isExperienceReadyMessage(event: MessageLike, expectedOrigin: string, child: unknown): boolean {
  if (!child || event.source !== child || event.origin !== expectedOrigin) return false;
  return isRecord(event.data) && event.data.type === EXPERIENCE_READY_TYPE;
}

export function buildTabAuthState(p: ExperiencePayload): TabAuthState {
  return {
    user: p.user,
    session: { ...p.session },
    experience: { label: p.mirror.label, code: p.mirror.code },
  };
}

/** Read the tab-scoped session; null when absent or malformed (a malformed value is removed). */
export function readTabAuth(storage: StorageLike | null, nowSec = Math.floor(Date.now() / 1000)): TabAuthState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(TAB_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (
      isRecord(data) && isRecord(data.experience) && nonEmpty(data.experience.label) &&
      isRecord(data.user) && isRecord(data.session) &&
      nonEmpty(data.user.id) && nonEmpty(data.user.email) && data.user.role === "student" &&
      nonEmpty(data.session.access_token) && typeof data.session.expires_at === "number" && data.session.expires_at > nowSec
    ) {
      return data as unknown as TabAuthState;
    }
    storage.removeItem(TAB_AUTH_STORAGE_KEY);
  } catch {
    try { storage.removeItem(TAB_AUTH_STORAGE_KEY); } catch { /* ignore */ }
  }
  return null;
}

export type AuthStorageChoice =
  | { readonly kind: "tab"; readonly storage: StorageLike }
  | { readonly kind: "persistent"; readonly storage: StorageLike | null };

/** Which storage holds the session: the tab one when `lumiere_auth_tab` exists, else the persistent (localStorage) one. */
export function chooseAuthStorage(tab: StorageLike | null, persistent: StorageLike | null): AuthStorageChoice {
  if (tab) {
    try {
      if (tab.getItem(TAB_AUTH_STORAGE_KEY)) return { kind: "tab", storage: tab };
    } catch { /* blocked storage: fall through */ }
  }
  return { kind: "persistent", storage: persistent };
}

export function banner(language: string, label: string): { text: string; exit: string } {
  return language === "fr"
    ? { text: `Session démo — ${label}. Les modifications n’affectent que des données de démonstration.`, exit: "Quitter" }
    : { text: `Demo session — ${label}. Changes affect demo data only.`, exit: "Exit" };
}
