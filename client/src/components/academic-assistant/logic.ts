/**
 * Pure logic for the Lumière academic assistant (S20). No React, no DOM globals at import time, so it can be
 * unit-tested under node. The component in ./index.tsx is the only consumer.
 */
import { ApiError } from "@/lib/api";

export const MAX_MESSAGE_LENGTH = 500;
export const MAX_HISTORY_TURNS = 6;
export const THROTTLE_COOLDOWN_MS = 10_000;

export type AssistantMode = "live" | "local";
export interface AssistantSource { title: string; url: string; verifiedAt?: string | null }
export interface AssistantLink { label: string; path: string }
export interface AssistantStatus {
  enabled: boolean;
  liveModel: boolean;
  mode: AssistantMode;
  reason?: string;
  suggestions: { id: string; en: string; fr: string }[];
}
export interface AssistantReply {
  reply: string;
  mode: AssistantMode;
  sources: AssistantSource[];
  links: AssistantLink[];
  notice?: string;
}

export type ChatEntry =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; mode: AssistantMode; sources: AssistantSource[]; links: AssistantLink[]; notice?: string };

export type FailureKind = "throttled" | "unavailable" | "error";

/** Maps any thrown value from the message request to a user-facing state. */
export function classifyFailure(err: unknown): FailureKind {
  const status = err instanceof ApiError ? err.status : typeof err === "object" && err && "status" in err ? Number((err as { status: unknown }).status) : 0;
  if (status === 429) return "throttled";
  if (status === 503) return "unavailable";
  return "error";
}

/** Trims, collapses runaway whitespace and caps the length. Returns "" for blank input. */
export function normaliseMessage(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_MESSAGE_LENGTH);
}

/** The last turns, in the shape the API expects. Errors and the greeting are never in `entries`. */
export function buildHistory(entries: readonly ChatEntry[]): { role: "user" | "assistant"; content: string }[] {
  return entries.slice(-MAX_HISTORY_TURNS).map((e) => ({ role: e.role, content: e.text.slice(0, 400) }));
}

/** Only in-app absolute paths ("/roadmap"); never protocol-relative ("//x") or schemes. */
export function isSafeInternalPath(path: unknown): path is string {
  return typeof path === "string" && /^\/(?!\/)[^\s\\]*$/.test(path);
}

/** Only http(s) URLs are rendered as external source links. */
export function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Defensive shaping of the server payload: anything malformed is dropped rather than rendered. */
export function sanitiseReply(raw: unknown): AssistantReply {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const reply = typeof r.reply === "string" ? r.reply : "";
  if (!reply.trim()) throw new ApiError("Empty reply", 502);
  const sources = (Array.isArray(r.sources) ? r.sources : [])
    .filter((s): s is AssistantSource => !!s && typeof (s as AssistantSource).title === "string" && isSafeExternalUrl((s as AssistantSource).url))
    .map((s) => ({ title: s.title, url: s.url, verifiedAt: typeof s.verifiedAt === "string" ? s.verifiedAt : null }));
  const links = (Array.isArray(r.links) ? r.links : [])
    .filter((l): l is AssistantLink => !!l && typeof (l as AssistantLink).label === "string" && isSafeInternalPath((l as AssistantLink).path))
    .map((l) => ({ label: l.label, path: l.path }));
  return {
    reply,
    // Anything that is not explicitly "live" is treated as local: we never imply an AI answered unless told so.
    mode: r.mode === "live" ? "live" : "local",
    sources,
    links,
    notice: typeof r.notice === "string" && r.notice.trim() ? r.notice : undefined,
  };
}

/** Focus trap: given Tab / Shift+Tab on `active`, returns the element that should receive focus, or null to let the browser act. */
export function nextTrapTarget<T>(focusables: readonly T[], active: T | null, shift: boolean): T | null {
  if (focusables.length === 0) return null;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const idx = active === null ? -1 : focusables.indexOf(active);
  if (idx === -1) return shift ? last : first;
  if (shift && active === first) return last;
  if (!shift && active === last) return first;
  return null;
}

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
