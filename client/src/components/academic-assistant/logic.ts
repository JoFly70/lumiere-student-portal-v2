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

export interface MessageAttachment { documentId: string; fileName: string; mimeType: string; sizeBytes: number }
export interface PrivateRef { kind: string; title: string; path: string }

export type ChatEntry =
  | { id: string; role: "user"; text: string; attachments?: MessageAttachment[]; createdAt?: string }
  | {
      id: string; role: "assistant"; text: string; mode: AssistantMode; sources: AssistantSource[]; links: AssistantLink[]; notice?: string;
      privateRefs?: PrivateRef[]; createdAt?: string;
    };

export type FailureKind = "throttled" | "unavailable" | "error" | "archived" | "attachment";

/** Maps any thrown value from the message request to a user-facing state. */
export function classifyFailure(err: unknown): FailureKind {
  const status = err instanceof ApiError ? err.status : typeof err === "object" && err && "status" in err ? Number((err as { status: unknown }).status) : 0;
  if (status === 429) return "throttled";
  if (status === 503) return "unavailable";
  if (status === 409) return "archived";
  if (status === 422) return "attachment";
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

/* ----------------------------------------------------------------------------------------------- S21 */

export const ASSISTANT_OPEN_EVENT = "lumiere:assistant-open";
export const CONVERSATION_PARAM = "conversation";
export const ASSISTANT_PATH = "/assistant";
export const SEARCH_MIN_CHARS = 2;
export const TITLE_MAX = 120;

/** Asks the mounted assistant (students only) to open, optionally on a given conversation. Safe under SSR. */
export function openAssistantConversation(conversationId?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ASSISTANT_OPEN_EVENT, { detail: { conversationId: conversationId ?? null } }));
}

/** Deep link: `/assistant?conversation=<id>`. */
export function assistantDeepLink(conversationId: string): string {
  return `${ASSISTANT_PATH}?${CONVERSATION_PARAM}=${encodeURIComponent(conversationId)}`;
}

/** Deep link on ANY student page: `?conversation=<id>` (or `?memory=<id>`, which just opens the drawer). */
export function deepLinkFromSearch(search: string): { conversationId: string | null; memoryId: string | null } {
  const q = new URLSearchParams(search);
  const c = q.get(CONVERSATION_PARAM);
  const m = q.get("memory");
  return { conversationId: c && UUIDISH.test(c) ? c : null, memoryId: m && UUIDISH.test(m) ? m : null };
}

const UUIDISH = /^[A-Za-z0-9_-]{8,64}$/;
/** Reads the conversation id from a deep link (`location`, `search`). Anything odd is ignored. */
export function conversationFromLocation(pathname: string, search: string): string | null {
  if (pathname !== ASSISTANT_PATH) return null;
  const id = new URLSearchParams(search).get(CONVERSATION_PARAM);
  return id && UUIDISH.test(id) ? id : null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  lastActivityAt: string;
  archived: boolean;
  messageCount: number;
  lastMessagePreview: string | null;
}
export interface ConversationHit {
  conversationId: string;
  conversationTitle: string;
  messageId: string;
  role: string;
  snippet: string;
  createdAt: string;
}

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);

export function sanitiseConversation(raw: unknown): ConversationSummary | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  return {
    id: r.id,
    title: str(r.title).trim(),
    createdAt: str(r.createdAt),
    lastActivityAt: str(r.lastActivityAt) || str(r.createdAt),
    archived: r.archived === true,
    messageCount: typeof r.messageCount === "number" ? r.messageCount : 0,
    lastMessagePreview: typeof r.lastMessagePreview === "string" && r.lastMessagePreview.trim() ? r.lastMessagePreview : null,
  };
}

/** Newest activity first; stable for equal timestamps. */
export function sortConversations(list: readonly ConversationSummary[]): ConversationSummary[] {
  return list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (Date.parse(b.c.lastActivityAt) || 0) - (Date.parse(a.c.lastActivityAt) || 0) || a.i - b.i)
    .map((x) => x.c);
}

export function sanitiseConversationList(raw: unknown): ConversationSummary[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { conversations?: unknown }).conversations) ? (raw as { conversations: unknown[] }).conversations : [];
  return sortConversations(list.map(sanitiseConversation).filter((c): c is ConversationSummary => !!c));
}

export function sanitiseHits(raw: unknown): ConversationHit[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { hits?: unknown }).hits) ? (raw as { hits: unknown[] }).hits : [];
  return list
    .map((h) => (h && typeof h === "object" ? (h as Record<string, unknown>) : null))
    .filter((h): h is Record<string, unknown> => !!h && typeof h.conversationId === "string" && typeof h.snippet === "string")
    .map((h) => ({
      conversationId: String(h.conversationId), conversationTitle: str(h.conversationTitle), messageId: str(h.messageId),
      role: str(h.role), snippet: String(h.snippet), createdAt: str(h.createdAt),
    }));
}

/** A conversation title is never blank in the UI. */
export function displayTitle(c: Pick<ConversationSummary, "title" | "lastMessagePreview">, fallback: string): string {
  return c.title.trim() || (c.lastMessagePreview ?? "").trim().slice(0, 60) || fallback;
}

/** Trimmed, length-capped rename input; null when it would be rejected (blank). */
export function normaliseTitle(raw: string): string | null {
  const t = raw.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
  return t.length ? t : null;
}

/** A short automatic title from the first question. */
export function titleFromMessage(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= 60 ? t : `${t.slice(0, 57).trimEnd()}…`;
}

/** Shapes a server `Message` into a ChatEntry. System messages are not shown. */
export function sanitiseMessage(raw: unknown): ChatEntry | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  const text = str(r.content);
  if (!id || (r.role !== "student" && r.role !== "assistant")) return null;
  const createdAt = str(r.createdAt) || undefined;
  if (r.role === "student") {
    const attachments = (Array.isArray(r.attachments) ? r.attachments : [])
      .map((a) => (a && typeof a === "object" ? (a as Record<string, unknown>) : null))
      .filter((a): a is Record<string, unknown> => !!a && typeof a.documentId === "string" && typeof a.fileName === "string")
      .map((a) => ({ documentId: String(a.documentId), fileName: String(a.fileName), mimeType: str(a.mimeType), sizeBytes: typeof a.sizeBytes === "number" ? a.sizeBytes : 0 }));
    return { id, role: "user", text, attachments, createdAt };
  }
  const base = sanitiseReply({ reply: text || "…", mode: r.mode, sources: r.sources, links: r.links, notice: r.notice });
  const privateRefs = (Array.isArray(r.privateRefs) ? r.privateRefs : [])
    .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>) : null))
    .filter((p): p is Record<string, unknown> => !!p && typeof p.title === "string" && isSafeInternalPath(p.path))
    .map((p) => ({ kind: str(p.kind), title: String(p.title), path: String(p.path) }));
  return { id, role: "assistant", text, mode: base.mode, sources: base.sources, links: base.links, notice: base.notice, privateRefs, createdAt };
}

export function sanitiseMessages(raw: unknown): ChatEntry[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { messages?: unknown }).messages) ? (raw as { messages: unknown[] }).messages : [];
  return list.map(sanitiseMessage).filter((e): e is ChatEntry => !!e);
}

/** Offer Support when an answer rests on no source and no record of the student's. */
export function needsSupportEscalation(e: Extract<ChatEntry, { role: "assistant" }>): boolean {
  return e.sources.length === 0 && (e.privateRefs?.length ?? 0) === 0;
}

/** Download URL: only http(s) targets are ever opened. */
export function isOpenableUrl(url: unknown): url is string {
  return isSafeExternalUrl(url);
}

/* ---- attachments ---- */

export interface AttachmentPolicy {
  types: { ext: string; mime: string; maxBytes: number }[];
  maxPerMessage: number;
  maxBytesPerMessage: number;
  quotaBytes: number;
  usedBytes: number;
}
export interface AttachableDocument {
  id: string; fileName: string; mimeType: string; sizeBytes: number; docType?: string;
  source: "documents" | "chat"; status?: string; uploadedAt?: string; extractionStatus?: string | null;
}
export const MAX_ATTACHMENTS_DEFAULT = 5;
export const MAX_ATTACHMENT_BYTES_DEFAULT = 50 * 1024 * 1024;

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
export function sanitisePolicy(raw: unknown): AttachmentPolicy | null {
  const r = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!r || !Array.isArray(r.types)) return null;
  const types = r.types
    .map((t) => (t && typeof t === "object" ? (t as Record<string, unknown>) : null))
    .filter((t): t is Record<string, unknown> => !!t && typeof t.ext === "string" && typeof t.mime === "string")
    .map((t) => ({ ext: String(t.ext).replace(/^\./, "").toLowerCase(), mime: String(t.mime).toLowerCase(), maxBytes: num(t.maxBytes, MAX_ATTACHMENT_BYTES_DEFAULT) }));
  return {
    types,
    maxPerMessage: Math.min(MAX_ATTACHMENTS_DEFAULT, num(r.maxPerMessage, MAX_ATTACHMENTS_DEFAULT)),
    maxBytesPerMessage: num(r.maxBytesPerMessage, MAX_ATTACHMENT_BYTES_DEFAULT),
    quotaBytes: num(r.quotaBytes, 0),
    usedBytes: num(r.usedBytes, 0),
  };
}

export function sanitiseDocuments(raw: unknown): AttachableDocument[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { documents?: unknown }).documents) ? (raw as { documents: unknown[] }).documents : [];
  return list
    .map((d) => (d && typeof d === "object" ? (d as Record<string, unknown>) : null))
    .filter((d): d is Record<string, unknown> => !!d && typeof d.id === "string" && typeof d.fileName === "string")
    .map((d) => ({
      id: String(d.id), fileName: String(d.fileName), mimeType: str(d.mimeType), sizeBytes: num(d.sizeBytes, 0), docType: str(d.docType) || undefined,
      source: d.source === "chat" ? ("chat" as const) : ("documents" as const), status: str(d.status) || undefined, uploadedAt: str(d.uploadedAt) || undefined,
      extractionStatus: typeof d.extractionStatus === "string" ? d.extractionStatus : null,
    }));
}

export type AttachmentProblem = "empty" | "type" | "size" | "count" | "total" | "quota" | "duplicate";

export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/**
 * Client pre-check against GET /api/student/attachments/policy. The server stays the authority.
 * `current` is what is already on the message; `uploadedBytes` is what this composer has already added to the quota.
 */
export function validateAttachmentFile(
  file: { name: string; type: string; size: number },
  policy: AttachmentPolicy,
  current: { count: number; bytes: number; names?: readonly string[] },
  uploadedBytes = 0,
): AttachmentProblem | null {
  if (current.count >= policy.maxPerMessage) return "count";
  if (file.size <= 0) return "empty";
  const ext = fileExtension(file.name);
  const rule = policy.types.find((t) => t.ext === ext);
  const mime = file.type.toLowerCase();
  if (!rule || (mime && mime !== rule.mime && mime !== "application/octet-stream")) return "type";
  if (file.size > rule.maxBytes) return "size";
  if (current.bytes + file.size > policy.maxBytesPerMessage) return "total";
  if (policy.quotaBytes > 0 && policy.usedBytes + uploadedBytes + file.size > policy.quotaBytes) return "quota";
  if (current.names?.includes(file.name)) return "duplicate";
  return null;
}

/** Whether an already stored document can still join the message. */
export function canAddDocument(doc: Pick<AttachableDocument, "id" | "sizeBytes">, policy: AttachmentPolicy | null, current: { ids: readonly string[]; bytes: number }): AttachmentProblem | null {
  const max = policy?.maxPerMessage ?? MAX_ATTACHMENTS_DEFAULT;
  const maxBytes = policy?.maxBytesPerMessage ?? MAX_ATTACHMENT_BYTES_DEFAULT;
  if (current.ids.includes(doc.id)) return "duplicate";
  if (current.ids.length >= max) return "count";
  if (current.bytes + doc.sizeBytes > maxBytes) return "total";
  return null;
}

export function formatBytes(n: number, language: "en" | "fr" = "en"): string {
  const fr = language === "fr";
  const unit = (u: "B" | "KB" | "MB" | "GB") => (fr ? { B: "o", KB: "Ko", MB: "Mo", GB: "Go" }[u] : u);
  const fmt = (v: number) => (fr ? v.toFixed(v < 10 ? 1 : 0).replace(".", ",") : v.toFixed(v < 10 ? 1 : 0));
  if (n < 1024) return `${n} ${unit("B")}`;
  if (n < 1024 * 1024) return `${fmt(n / 1024)} ${unit("KB")}`;
  if (n < 1024 * 1024 * 1024) return `${fmt(n / (1024 * 1024))} ${unit("MB")}`;
  return `${fmt(n / (1024 * 1024 * 1024))} ${unit("GB")}`;
}

/* ---- idempotent sends ---- */

export function newClientRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}

export interface PendingSend {
  messageRequestId: string;
  createRequestId: string;
  text: string;
  attachmentIds: string[];
  conversationId: string | null;
}

/**
 * A retry of the same text with the same attachments keeps its clientRequestIds, so the server replays the stored
 * pair instead of writing a duplicate. Any change (new text, different files) is a new request.
 */
export function planSend(prev: PendingSend | null, text: string, attachmentIds: readonly string[], conversationId: string | null): PendingSend {
  if (
    prev && prev.text === text && prev.attachmentIds.length === attachmentIds.length &&
    prev.attachmentIds.every((id, i) => id === attachmentIds[i]) && prev.conversationId === conversationId
  ) {
    return prev;
  }
  return { messageRequestId: newClientRequestId(), createRequestId: newClientRequestId(), text, attachmentIds: [...attachmentIds], conversationId };
}

/* ---- roving focus in lists ---- */

/** Arrow / Home / End navigation for a vertical list. Returns the new index, or null when the key is not handled. */
export function rovingIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  if (key === "ArrowUp") return current < 0 ? count - 1 : (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
