/**
 * Lumière academic assistant (S20, extended in S21): a floating crest button that opens a chat drawer.
 *
 * Mount once, inside the AUTHENTICATED student shell only (never on login / reset / verify):
 *   import { AcademicAssistant } from "@/components/academic-assistant";
 *   <AcademicAssistant />
 *
 * S21 adds saved conversations (history, search, rename, archive, resume), file attachments, "From your records"
 * references, a Support link for answers with no source, and deep links (`/assistant?conversation=<id>` or the
 * ASSISTANT_OPEN_EVENT window event used by global search).
 *
 * Honesty rule (unchanged): when the server answers in "local" mode the answer is labelled as Lumière guide / local
 * guidance and never described as AI. Server text is rendered as plain text (never HTML).
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowLeft, ArrowRight, BookmarkCheck, ExternalLink, History, LifeBuoy, MessageSquarePlus, RotateCcw, SendHorizontal, X } from "lucide-react";
import { LumiereCrest } from "@/components/brand/lumiere-brand";
import { api, apiRequest } from "@/lib/api";
import { useT, type Language } from "@/i18n";
import {
  ASSISTANT_OPEN_EVENT,
  ASSISTANT_PATH,
  FOCUSABLE_SELECTOR,
  MAX_MESSAGE_LENGTH,
  SEARCH_MIN_CHARS,
  THROTTLE_COOLDOWN_MS,
  classifyFailure,
  deepLinkFromSearch,
  CONVERSATION_PARAM,
  isOpenableUrl,
  needsSupportEscalation,
  nextTrapTarget,
  normaliseMessage,
  normaliseTitle,
  planSend,
  sanitiseConversation,
  sanitiseConversationList,
  sanitiseDocuments,
  sanitiseHits,
  sanitiseMessage,
  sanitiseMessages,
  sanitisePolicy,
  titleFromMessage,
  type AssistantStatus,
  type AttachableDocument,
  type AttachmentPolicy,
  type ChatEntry,
  type ConversationHit,
  type ConversationSummary,
  type FailureKind,
  type MessageAttachment,
  type PendingSend,
} from "./logic";
import { makeTr, type Tr } from "./tr";
import { HistoryView, type HistoryViewProps } from "./history";
import {
  AttachMenuButton, AttachmentChips, DocumentPicker, SentAttachments, useComposerAttachments, type ComposerAttachment,
} from "./attachments";
import { MemoryView, sanitiseMemory, type MemoryViewProps } from "./memory";
import "@/styles/academic-assistant.css";

void React; // classic JSX runtime when rendered under vitest/esbuild

export { makeTr };

function formatDate(value: string, language: Language): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA", { year: "numeric", month: "short", day: "numeric" });
}

/* ------------------------------------------------------------------------------------------------ view */

export interface AssistantFeatures {
  panel: "chat" | "history" | "picker" | "memory";
  /** Title of the open saved conversation (null = a new one). */
  conversationTitle: string | null;
  conversationArchived: boolean;
  conversationState: "idle" | "loading" | "error";
  history: Omit<HistoryViewProps, "tr" | "language">;
  memory?: Omit<MemoryViewProps, "tr" | "language">;
  onOpenMemory?: () => void;
  picker: {
    state: "loading" | "ready" | "error"; docs: readonly AttachableDocument[]; selected: readonly string[];
    onToggle: (id: string) => void; onConfirm: () => void; onCancel: () => void; onRetry: () => void;
  };
  attach: {
    items: readonly ComposerAttachment[]; policy: AttachmentPolicy | null; problem: string | null; menuOpen: boolean;
    onToggleMenu: () => void; onUploadClick: () => void; onChoose: () => void; onRemove: (key: string) => void; onRetry: (key: string) => void;
    onFiles: (files: File[]) => void; fileInputRef?: React.Ref<HTMLInputElement>; busy: boolean;
  };
  onOpenHistory: () => void;
  onBack: () => void;
  onRestore: () => void;
  onOpenAttachment: (documentId: string) => void;
  attachmentError: string | null;
}

export interface AssistantViewProps {
  language: Language;
  entries: readonly ChatEntry[];
  status: AssistantStatus | undefined;
  statusState: "loading" | "ready" | "error";
  pending: boolean;
  failure: { kind: FailureKind; text: string } | null;
  cooling: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onSend: (text: string) => void;
  onRetry: () => void;
  onRetryStatus: () => void;
  onClear: () => void;
  onClose: () => void;
  features?: AssistantFeatures;
  panelRef?: React.Ref<HTMLElement>;
  inputRef?: React.Ref<HTMLTextAreaElement>;
  titleRef?: React.Ref<HTMLHeadingElement>;
  bodyRef?: React.Ref<HTMLDivElement>;
}

export function AssistantPanelView(p: AssistantViewProps) {
  const tr = useMemo(() => makeTr(p.language), [p.language]);
  const uid = useId();
  const titleId = `${uid}-title`;
  const discId = `${uid}-disclaimer`;
  const counterId = `${uid}-count`;
  const f = p.features;
  const panel = f?.panel ?? "chat";
  const unavailable = p.statusState === "error" || (p.statusState === "ready" && p.status?.enabled === false);
  const archived = !!f?.conversationArchived;
  const inputDisabled = unavailable || p.cooling || archived;
  const attachBusy = !!f?.attach.busy;
  const canSend = !inputDisabled && !p.pending && !attachBusy && normaliseMessage(p.draft).length > 0;
  const showGreeting = !f || f.conversationTitle === null;
  const suggestions = showGreeting && p.entries.length === 0 && p.status ? p.status.suggestions.slice(0, 4) : [];
  const failureText = (kind: FailureKind): string =>
    tr(kind === "throttled" ? "assistant.throttled" : kind === "unavailable" ? "assistant.unavailable" : kind === "attachment" ? "at.err.send" : kind === "archived" ? "ah.archivedNotice" : "assistant.error.generic");
  const attachMenuId = `${uid}-attach-menu`;
  const sub = panel !== "chat";

  return (
    <div className="aa-root" data-testid="assistant-root">
      <div className="aa-scrim" onClick={p.onClose} aria-hidden="true" data-testid="assistant-scrim" />
      <section
        ref={p.panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={discId}
        lang={p.language}
        className="aa-panel"
        data-testid="assistant-panel"
        data-panel={panel}
      >
        <header className="aa-head">
          {sub && f ? (
            <button type="button" className="aa-iconbtn" onClick={f.onBack} aria-label={tr("ah.back")} title={tr("ah.back")} data-testid="assistant-back">
              <ArrowLeft aria-hidden="true" size={20} />
            </button>
          ) : (
            <LumiereCrest size={34} />
          )}
          <div className="aa-head-text">
            <h2 id={titleId} ref={p.titleRef} tabIndex={-1} className="aa-title">{tr("assistant.title")}</h2>
            <p className="aa-subtitle" data-testid="assistant-subtitle">{f?.conversationTitle ? f.conversationTitle : tr("assistant.subtitle")}</p>
          </div>
          {f && (
            <button type="button" className="aa-iconbtn" onClick={f.onOpenHistory} aria-label={tr("ah.historyAria")} title={tr("ah.history")} data-testid="assistant-history-btn" aria-pressed={panel === "history"}>
              <History aria-hidden="true" size={19} />
            </button>
          )}
          {f?.onOpenMemory && (
            <button type="button" className="aa-iconbtn" onClick={f.onOpenMemory} aria-label={tr("am.open")} title={tr("am.open")} data-testid="assistant-memory-btn" aria-pressed={panel === "memory"}>
              <BookmarkCheck aria-hidden="true" size={19} />
            </button>
          )}
          {(p.entries.length > 0 || (f && f.conversationTitle !== null)) && (
            <button type="button" className="aa-iconbtn" onClick={p.onClear} aria-label={tr("assistant.clearAria")} title={tr("assistant.clear")} data-testid="assistant-clear">
              {f ? <MessageSquarePlus aria-hidden="true" size={19} /> : <RotateCcw aria-hidden="true" size={18} />}
            </button>
          )}
          <button type="button" className="aa-iconbtn" onClick={p.onClose} aria-label={tr("assistant.closeAria")} title={tr("assistant.close")} data-testid="assistant-close">
            <X aria-hidden="true" size={20} />
          </button>
        </header>

        {f && panel === "history" && <HistoryView tr={tr} language={p.language} {...f.history} />}
        {f && panel === "memory" && f.memory && <MemoryView tr={tr} language={p.language} {...f.memory} />}
        {f && panel === "picker" && (
          <DocumentPicker
            tr={tr} language={p.language} state={f.picker.state} docs={f.picker.docs} policy={f.attach.policy}
            current={{ ids: f.attach.items.map((i) => i.documentId).filter((x): x is string => !!x), bytes: f.attach.items.reduce((n, i) => n + i.sizeBytes, 0) }}
            selected={f.picker.selected} onToggle={f.picker.onToggle} onConfirm={f.picker.onConfirm} onCancel={f.picker.onCancel} onRetry={f.picker.onRetry}
          />
        )}

        <div ref={p.bodyRef} className="aa-body" hidden={sub} role="log" aria-live="polite" aria-relevant="additions" aria-label={tr("assistant.conversation")} data-testid="assistant-log">
          {showGreeting && (
            <div className="aa-msg aa-msg-assistant" data-testid="assistant-greeting">
              <p className="aa-msg-label">{tr("assistant.title")}</p>
              <div className="aa-bubble"><p className="aa-text">{tr("assistant.greeting")}</p></div>
            </div>
          )}

          {f?.conversationState === "loading" && <p className="aa-quiet" role="status" data-testid="assistant-conversation-loading">{tr("ah.loading")}</p>}
          {f?.conversationState === "error" && (
            <div className="aa-alert aa-alert-error" role="alert" data-testid="assistant-conversation-error"><p>{tr("ah.loadError")}</p></div>
          )}

          {suggestions.length > 0 && (
            <div className="aa-suggest" data-testid="assistant-suggestions">
              <p className="aa-suggest-title">{tr("assistant.suggestions.title")}</p>
              <ul>
                {suggestions.map((s) => {
                  const text = p.language === "fr" ? s.fr : s.en;
                  return (
                    <li key={s.id}>
                      <button type="button" className="aa-chip" disabled={inputDisabled || p.pending} onClick={() => p.onSend(text)} data-testid={`assistant-suggestion-${s.id}`}>
                        {text}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {p.entries.map((e) =>
            e.role === "user" ? (
              <div key={e.id} data-entry-id={e.id} className="aa-msg aa-msg-user" data-testid="assistant-user-message">
                <p className="aa-msg-label">{tr("assistant.you")}</p>
                <div className="aa-bubble">
                  <p className="aa-text">{e.text}</p>
                  {e.attachments && e.attachments.length > 0 && (
                    <SentAttachments items={e.attachments} tr={tr} language={p.language} onOpen={(id) => f?.onOpenAttachment(id)} />
                  )}
                </div>
              </div>
            ) : (
              <AssistantAnswer key={e.id} entry={e} language={p.language} tr={tr} onNavigate={p.onClose} />
            ),
          )}

          {p.pending && (
            <div className="aa-msg aa-msg-assistant" data-testid="assistant-thinking">
              <div className="aa-bubble aa-thinking">
                <span className="aa-dots" aria-hidden="true"><i /><i /><i /></span>
                <span>{tr("assistant.thinking")}</span>
              </div>
            </div>
          )}

          {p.failure && p.failure.kind !== "archived" && (
            <div className={`aa-alert aa-alert-${p.failure.kind}`} role="alert" data-testid={`assistant-${p.failure.kind}`}>
              <p>{failureText(p.failure.kind)}</p>
              <div className="aa-alert-actions">
                <button type="button" className="aa-linkbtn" onClick={p.onRetry} disabled={p.cooling || p.pending} data-testid="assistant-retry">
                  <RotateCcw aria-hidden="true" size={15} />{tr("assistant.retry")}
                </button>
                {p.failure.kind === "unavailable" && <SupportLink tr={tr} onNavigate={p.onClose} />}
              </div>
            </div>
          )}

          {f?.attachmentError && <div className="aa-alert aa-alert-error" role="alert" data-testid="assistant-attachment-error"><p>{f.attachmentError}</p></div>}

          {p.statusState === "loading" && <p className="aa-quiet" data-testid="assistant-status-loading">{tr("assistant.status.loading")}</p>}
          {unavailable && !p.failure && (
            <div className="aa-alert aa-alert-unavailable" role="alert" data-testid="assistant-status-unavailable">
              <p>{tr("assistant.unavailable")}</p>
              <div className="aa-alert-actions">
                <button type="button" className="aa-linkbtn" onClick={p.onRetryStatus} data-testid="assistant-status-retry">
                  <RotateCcw aria-hidden="true" size={15} />{tr("assistant.retry")}
                </button>
                <SupportLink tr={tr} onNavigate={p.onClose} />
              </div>
            </div>
          )}
        </div>

        <footer className="aa-foot" hidden={sub}>
          {archived && f ? (
            <div className="aa-alert aa-alert-unavailable" role="status" data-testid="assistant-archived-notice">
              <p>{tr("ah.archivedNotice")}</p>
              <div className="aa-alert-actions">
                <button type="button" className="aa-linkbtn" onClick={f.onRestore} data-testid="assistant-restore"><RotateCcw aria-hidden="true" size={15} />{tr("ah.restoreContinue")}</button>
              </div>
            </div>
          ) : (
            <>
              {f && <AttachmentChips items={f.attach.items} tr={tr} language={p.language} onRemove={f.attach.onRemove} onRetry={f.attach.onRetry} />}
              {f?.attach.problem && <p className="aa-attach-problem" role="alert" data-testid="assistant-attach-problem">{f.attach.problem}</p>}
              {f && f.attach.items.length > 0 && f.attach.policy && (
                <p className="aa-attach-info" data-testid="assistant-attach-info">
                  {tr("at.count", { n: f.attach.items.length, max: f.attach.policy.maxPerMessage })}
                </p>
              )}
              <form
                className="aa-form"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  if (canSend) p.onSend(p.draft);
                }}
              >
                {f && (
                  <>
                    <AttachMenuButton
                      open={f.attach.menuOpen} disabled={inputDisabled || p.pending} onToggle={f.attach.onToggleMenu} onUpload={f.attach.onUploadClick} onChoose={f.attach.onChoose} tr={tr} menuId={attachMenuId}
                    />
                    <input
                      ref={f.attach.fileInputRef}
                      type="file"
                      multiple
                      className="aa-sr"
                      tabIndex={-1}
                      aria-hidden="true"
                      accept={f.attach.policy ? f.attach.policy.types.map((t) => `.${t.ext}`).join(",") : undefined}
                      onChange={(ev) => {
                        const files = Array.from(ev.target.files ?? []);
                        ev.target.value = "";
                        if (files.length) f.attach.onFiles(files);
                      }}
                      data-testid="assistant-file-input"
                    />
                  </>
                )}
                <label className="aa-sr" htmlFor={`${uid}-input`}>{tr("assistant.input.label")}</label>
                <textarea
                  id={`${uid}-input`}
                  ref={p.inputRef}
                  className="aa-input"
                  rows={2}
                  maxLength={MAX_MESSAGE_LENGTH}
                  value={p.draft}
                  disabled={inputDisabled}
                  placeholder={tr("assistant.input.placeholder")}
                  aria-describedby={`${discId} ${counterId}`}
                  onChange={(ev) => p.onDraft(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) {
                      ev.preventDefault();
                      if (canSend) p.onSend(p.draft);
                    }
                  }}
                  data-testid="assistant-input"
                />
                <button type="submit" className="aa-send" disabled={!canSend} aria-label={tr("assistant.sendAria")} data-testid="assistant-send">
                  <SendHorizontal aria-hidden="true" size={18} />
                  <span>{tr("assistant.send")}</span>
                </button>
              </form>
            </>
          )}
          <p id={counterId} className={`aa-count${p.draft.length > MAX_MESSAGE_LENGTH - 60 ? " aa-count-near" : ""}`} aria-live="off">
            {p.draft.length > MAX_MESSAGE_LENGTH - 100 ? tr("assistant.counter", { n: p.draft.length, max: MAX_MESSAGE_LENGTH }) : " "}
          </p>
          <p id={discId} className="aa-disclaimer" data-testid="assistant-disclaimer">{tr("assistant.disclaimer")}</p>
        </footer>
      </section>
    </div>
  );
}

function SupportLink({ tr, onNavigate }: { tr: Tr; onNavigate: () => void }) {
  return (
    <Link href="/support" className="aa-linkbtn" onClick={onNavigate} data-testid="assistant-support-link">
      <LifeBuoy aria-hidden="true" size={15} />{tr("assistant.unavailable.support")}
    </Link>
  );
}

function AssistantAnswer({ entry, language, tr, onNavigate }: { entry: Extract<ChatEntry, { role: "assistant" }>; language: Language; tr: Tr; onNavigate: () => void }) {
  const local = entry.mode === "local";
  const refs = entry.privateRefs ?? [];
  return (
    <div data-entry-id={entry.id} className={`aa-msg aa-msg-assistant ${local ? "aa-local" : "aa-live"}`} data-testid="assistant-answer" data-mode={entry.mode}>
      <p className="aa-msg-label">
        <span className="aa-mode" data-testid="assistant-mode-label">{tr(local ? "assistant.label.local" : "assistant.label.live")}</span>
      </p>
      <div className="aa-bubble">
        <p className="aa-text">{entry.text}</p>
        {entry.notice && <p className="aa-notice" data-testid="assistant-notice">{entry.notice}</p>}
        {entry.links.length > 0 && (
          <div className="aa-block" data-testid="assistant-links">
            <p className="aa-block-title">{tr("assistant.links")}</p>
            <ul className="aa-linklist">
              {entry.links.map((l) => (
                <li key={l.path + l.label}>
                  <Link href={l.path} className="aa-portal-link" onClick={onNavigate}>{l.label}<ArrowRight aria-hidden="true" size={14} /></Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {refs.length > 0 && (
          <div className="aa-block" data-testid="assistant-private-refs">
            <p className="aa-block-title">{tr("ah.records")}</p>
            <ul className="aa-linklist">
              {refs.map((r) => (
                <li key={r.path + r.title}>
                  <Link href={r.path} className="aa-portal-link aa-ref-link" onClick={onNavigate}>{r.title}<ArrowRight aria-hidden="true" size={14} /></Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {entry.sources.length > 0 && (
          <div className="aa-block" data-testid="assistant-sources">
            <p className="aa-block-title">{tr("assistant.sources")}</p>
            <ul className="aa-sourcelist">
              {entry.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="aa-source-link">
                    <span>{s.title}</span>
                    <ExternalLink aria-hidden="true" size={13} />
                    <span className="aa-sr"> ({tr("assistant.source.newTab")})</span>
                  </a>
                  {s.verifiedAt && <span className="aa-verified"> · {tr("assistant.source.verified", { date: formatDate(s.verifiedAt, language) })}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {needsSupportEscalation(entry) && (
          <div className="aa-block aa-escalate" data-testid="assistant-escalate">
            <p className="aa-note aa-note-flat">{tr("ah.support.note")}</p>
            <Link href="/support" className="aa-linkbtn" onClick={onNavigate} data-testid="assistant-escalate-link">
              <LifeBuoy aria-hidden="true" size={15} />{tr("ah.support.cta")}
            </Link>
          </div>
        )}
        <p className="aa-note">{tr(local ? "assistant.note.local" : "assistant.note.live")}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- container */

let entrySeq = 0;
const nextId = () => `aa-${Date.now().toString(36)}-${++entrySeq}`;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const LIST_KEY = "/api/assistant/conversations";

export function AcademicAssistant({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const { language } = useT();
  const tr = useMemo(() => makeTr(language), [language]);
  const qc = useQueryClient();
  const [location, navigate] = useLocation();
  const search = useSearch();
  const [open, setOpen] = useState(defaultOpen);
  const [panel, setPanel] = useState<"chat" | "history" | "picker" | "memory">("chat");
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ title: string; archived: boolean } | null>(null);
  const [conversationState, setConversationState] = useState<"idle" | "loading" | "error">("idle");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ kind: FailureKind; text: string } | null>(null);
  const [cooling, setCooling] = useState(false);
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [histQuery, setHistQuery] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const fabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);
  const coolTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PendingSend | null>(null);
  const loadToken = useRef(0);
  const autoOpened = useRef(false);
  const justLoaded = useRef(false);
  const lastPanel = useRef<"chat" | "history" | "picker" | "memory">("chat");

  /* ---- queries ---- */
  const statusQuery = useQuery<AssistantStatus>({
    queryKey: ["/api/assistant/status"],
    queryFn: () => api.get<AssistantStatus>("/api/assistant/status"),
    enabled: open,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const listQuery = useQuery<ConversationSummary[]>({
    queryKey: [LIST_KEY, filter],
    queryFn: async () => sanitiseConversationList(await api.get(`${LIST_KEY}?archived=${filter === "archived"}&limit=50`)),
    enabled: open,
    retry: false,
  });
  const dq = useDebounced(histQuery.trim(), 250);
  const searchEnabled = open && panel === "history" && dq.length >= SEARCH_MIN_CHARS;
  const searchQuery = useQuery<ConversationHit[]>({
    queryKey: [LIST_KEY, "search", dq],
    queryFn: async () => sanitiseHits(await api.get(`${LIST_KEY}/search?q=${encodeURIComponent(dq)}`)),
    enabled: searchEnabled,
    retry: false,
  });
  const policyQuery = useQuery<AttachmentPolicy | null>({
    queryKey: ["/api/student/attachments/policy"],
    queryFn: async () => sanitisePolicy(await api.get("/api/student/attachments/policy")),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });
  const docsQuery = useQuery<AttachableDocument[]>({
    queryKey: ["/api/student/attachments/documents"],
    queryFn: async () => sanitiseDocuments(await api.get("/api/student/attachments/documents")),
    enabled: open && panel === "picker",
    staleTime: 0,
    retry: false,
  });
  const policy = policyQuery.data ?? null;

  const attach = useComposerAttachments(policy, tr, language, () => void qc.invalidateQueries({ queryKey: ["/api/student/attachments/policy"] }));
  const clearAttach = attach.clear;

  const [memoryHighlight, setMemoryHighlight] = useState<string | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const memoryQuery = useQuery({
    queryKey: ["/api/assistant/memory"],
    queryFn: async () => sanitiseMemory(await api.get<unknown>("/api/assistant/memory")),
    enabled: open && panel === "memory",
    staleTime: 10_000,
  });
  const memoryAction = useCallback(async (path: string, body: unknown) => {
    setMemoryError(null);
    try {
      await apiRequest(path, { method: "POST", body: JSON.stringify(body) });
      await qc.invalidateQueries({ queryKey: ["/api/assistant/memory"] });
    } catch (err) {
      setMemoryError(tr("am.actionError"));
      throw err;
    }
  }, [qc, tr]);

  const close = useCallback(() => {
    setOpen(false);
    setMenuOpen(false);
    if (location === ASSISTANT_PATH) navigate("/", { replace: true });
  }, [location, navigate]);

  /* ---- conversations ---- */
  const loadConversation = useCallback(async (id: string) => {
    autoOpened.current = true;
    const token = ++loadToken.current;
    setConversationState("loading");
    setPanel("chat");
    setFailure(null);
    try {
      const res = await api.get<{ conversation?: unknown; messages?: unknown }>(`${LIST_KEY}/${encodeURIComponent(id)}`);
      if (token !== loadToken.current) return;
      const c = sanitiseConversation(res.conversation);
      pendingRef.current = null;
      clearAttach();
      justLoaded.current = true;
      setActiveId(id);
      setMeta({ title: c?.title || c?.lastMessagePreview?.slice(0, 60) || tr("ah.untitled"), archived: c?.archived === true });
      setEntries(sanitiseMessages(res));
      setConversationState("idle");
    } catch {
      if (token !== loadToken.current) return;
      setConversationState("error");
    }
  }, [clearAttach, tr]);

  const startNew = useCallback(() => {
    autoOpened.current = true;
    loadToken.current += 1;
    pendingRef.current = null;
    setActiveId(null);
    setMeta(null);
    setEntries([]);
    setFailure(null);
    setDraft("");
    setConversationState("idle");
    setAttachmentError(null);
    clearAttach();
    setPanel("chat");
  }, [clearAttach]);

  // Opening the drawer resumes the latest conversation, once, unless the student already chose something.
  useEffect(() => {
    if (!open || autoOpened.current || !listQuery.data) return;
    autoOpened.current = true;
    if (activeId || entries.length > 0) return;
    const latest = listQuery.data.find((c) => !c.archived);
    if (latest) void loadConversation(latest.id);
  }, [open, listQuery.data, activeId, entries.length, loadConversation]);

  // Deep link and cross-component open (global search).
  useEffect(() => {
    const onOpen = (ev: Event) => {
      const id = (ev as CustomEvent<{ conversationId?: string | null }>).detail?.conversationId;
      setOpen(true);
      if (id) void loadConversation(id);
    };
    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpen);
  }, [loadConversation]);
  useEffect(() => {
    const { conversationId, memoryId } = deepLinkFromSearch(search);
    if (location !== ASSISTANT_PATH && !conversationId && !memoryId) return;
    setOpen(true);
    if (conversationId) void loadConversation(conversationId);
    else if (memoryId) { autoOpened.current = true; setMemoryHighlight(memoryId); setPanel("memory"); }
    else autoOpened.current = false;
    // Consume the params so a reload or back does not reopen it; the path itself is left alone.
    if (typeof window !== "undefined" && (conversationId || memoryId)) {
      const u = new URL(window.location.href);
      u.searchParams.delete(CONVERSATION_PARAM);
      u.searchParams.delete("memory");
      window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
    }
  }, [location, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const renameConversation = useCallback(async (id: string, title: string) => {
    setActionError(null);
    const t = normaliseTitle(title);
    if (!t) throw new Error("blank");
    try {
      await apiRequest(`${LIST_KEY}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ title: t }) });
    } catch (err) {
      throw err;
    }
    if (id === activeId) setMeta((m) => (m ? { ...m, title: t } : m));
    void qc.invalidateQueries({ queryKey: [LIST_KEY] });
  }, [activeId, qc]);

  const archiveConversation = useCallback(async (id: string, archived: boolean) => {
    setActionError(null);
    try {
      await api.post(`${LIST_KEY}/${encodeURIComponent(id)}/${archived ? "archive" : "unarchive"}`);
      if (id === activeId) setMeta((m) => (m ? { ...m, archived } : m));
      void qc.invalidateQueries({ queryKey: [LIST_KEY] });
    } catch {
      setActionError(tr("ah.action.error"));
    }
  }, [activeId, qc, tr]);

  const restoreActive = useCallback(async () => {
    if (activeId) await archiveConversation(activeId, false);
    setFailure(null);
  }, [activeId, archiveConversation]);

  /* ---- focus, keys, scrolling ---- */
  useEffect(() => {
    if (open && !wasOpen.current) {
      const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
      const target = coarse ? titleRef.current : inputRef.current ?? titleRef.current;
      const id = requestAnimationFrame(() => target?.focus({ preventScroll: true }));
      wasOpen.current = true;
      return () => cancelAnimationFrame(id);
    }
    if (!open && wasOpen.current) {
      wasOpen.current = false;
      fabRef.current?.focus({ preventScroll: true });
    }
    return undefined;
  }, [open]);

  // Moving between chat / history / picker moves focus to the new view.
  useEffect(() => {
    if (!open || lastPanel.current === panel) return undefined;
    lastPanel.current = panel;
    const id = requestAnimationFrame(() => {
      const root = panelRef.current;
      if (!root) return;
      if (panel === "chat") {
        const coarse = window.matchMedia?.("(pointer: coarse)").matches;
        (coarse ? titleRef.current : inputRef.current ?? titleRef.current)?.focus({ preventScroll: true });
      } else root.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [panel, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        if (menuOpen) setMenuOpen(false);
        else if (panel !== "chat") setPanel("chat");
        else close();
        return;
      }
      if (ev.key !== "Tab" || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((n) => !n.hasAttribute("disabled") && n.offsetParent !== null);
      const active = document.activeElement as HTMLElement | null;
      const inside = active && panelRef.current.contains(active) ? active : null;
      const target = nextTrapTarget(nodes, inside, ev.shiftKey);
      if (target) {
        ev.preventDefault();
        target.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close, menuOpen, panel]);

  // Keep the newest message in view: an answer from its start, a question (or a loaded conversation) at the bottom.
  useEffect(() => {
    const body = bodyRef.current;
    if (!open || !body || entries.length === 0 || panel !== "chat") return;
    const last = entries[entries.length - 1]!;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const behavior: ScrollBehavior = reduce ? "auto" : "smooth";
    if (justLoaded.current) {
      justLoaded.current = false;
      body.scrollTo({ top: body.scrollHeight, behavior: "auto" });
    } else if (last.role === "assistant") {
      body.querySelector<HTMLElement>(`[data-entry-id="${last.id}"]`)?.scrollIntoView({ block: "start", behavior });
    } else {
      body.scrollTo({ top: body.scrollHeight, behavior });
    }
  }, [entries, open, pending, panel]);

  useEffect(() => () => { if (coolTimer.current) clearTimeout(coolTimer.current); }, []);

  /* ---- sending ---- */
  const send = useCallback(
    async (raw: string, explicitIds?: readonly string[]) => {
      const text = normaliseMessage(raw);
      if (!text || pending || cooling || attach.uploading) return;
      setFailure(null);
      setAttachmentError(null);
      const ids = explicitIds ?? attach.readyIds;
      const previous = pendingRef.current;
      const plan = planSend(previous, text, ids, activeId);
      pendingRef.current = plan;
      const optimisticId = `pending-${plan.messageRequestId}`;
      // A different message after a failed one: the old unsent question is dropped from the transcript.
      const staleId = previous && previous.messageRequestId !== plan.messageRequestId ? `pending-${previous.messageRequestId}` : null;
      const shown: MessageAttachment[] = attach.items
        .filter((i) => i.documentId && ids.includes(i.documentId))
        .map((i) => ({ documentId: i.documentId!, fileName: i.fileName, mimeType: i.mimeType, sizeBytes: i.sizeBytes }));
      setEntries((prev) => {
        const base = staleId ? prev.filter((e) => e.id !== staleId) : prev;
        return base.some((e) => e.id === optimisticId) ? base : [...base, { id: optimisticId, role: "user", text, attachments: shown }];
      });
      setDraft("");
      setPending(true);
      try {
        let conversationId = plan.conversationId ?? activeId;
        if (!conversationId) {
          const created = await api.post<{ conversation?: unknown }>(LIST_KEY, { clientRequestId: plan.createRequestId, title: titleFromMessage(text) });
          const c = sanitiseConversation(created.conversation);
          if (!c) throw new Error("no conversation");
          conversationId = c.id;
          plan.conversationId = c.id;
          loadToken.current += 1;
          setActiveId(c.id);
          setMeta({ title: c.title || titleFromMessage(text), archived: false });
        }
        const res = await api.post<{ studentMessage?: unknown; assistantMessage?: unknown }>(`${LIST_KEY}/${encodeURIComponent(conversationId)}/messages`, {
          clientRequestId: plan.messageRequestId,
          message: text,
          language,
          ...(ids.length ? { attachmentDocumentIds: [...ids] } : {}),
        });
        const sm = sanitiseMessage(res.studentMessage);
        const am = sanitiseMessage(res.assistantMessage);
        setEntries((prev) => {
          const base = prev.filter((e) => e.id !== optimisticId);
          return [...base, ...(sm ? [sm] : [{ id: nextId(), role: "user" as const, text, attachments: shown }]), ...(am ? [am] : [])];
        });
        pendingRef.current = null;
        attach.clear();
        void qc.invalidateQueries({ queryKey: [LIST_KEY] });
      } catch (err) {
        const kind = classifyFailure(err);
        if (kind === "archived") setMeta((m) => (m ? { ...m, archived: true } : m));
        setFailure({ kind, text });
        if (kind === "throttled") {
          setCooling(true);
          if (coolTimer.current) clearTimeout(coolTimer.current);
          coolTimer.current = setTimeout(() => setCooling(false), THROTTLE_COOLDOWN_MS);
        }
      } finally {
        setPending(false);
      }
    },
    [pending, cooling, attach, activeId, language, qc],
  );

  const onRetry = useCallback(() => {
    if (failure) void send(failure.text, pendingRef.current?.attachmentIds);
  }, [failure, send]);

  const openAttachment = useCallback(async (documentId: string) => {
    setAttachmentError(null);
    try {
      const d = await api.get<{ download_url?: unknown }>(`/api/documents/${encodeURIComponent(documentId)}`);
      if (!isOpenableUrl(d.download_url)) throw new Error("no url");
      window.open(d.download_url, "_blank", "noopener,noreferrer");
    } catch {
      setAttachmentError(tr("at.err.open"));
    }
  }, [tr]);

  /* ---- composer attachments ---- */
  const chooseDocs = useCallback(() => { setMenuOpen(false); setSelectedDocs([]); setPanel("picker"); }, []);
  const confirmDocs = useCallback(() => {
    attach.addDocuments((docsQuery.data ?? []).filter((d) => selectedDocs.includes(d.id)));
    setSelectedDocs([]);
    setPanel("chat");
  }, [attach, docsQuery.data, selectedDocs]);

  const statusState: "loading" | "ready" | "error" = statusQuery.isError ? "error" : statusQuery.data ? "ready" : "loading";
  const listState: "loading" | "ready" | "error" = listQuery.isError ? "error" : listQuery.data ? "ready" : "loading";
  const searchState: "idle" | "loading" | "ready" | "error" = !searchEnabled ? "idle" : searchQuery.isError ? "error" : searchQuery.data && searchQuery.fetchStatus === "idle" ? "ready" : "loading";

  const features: AssistantFeatures = {
    panel,
    conversationTitle: activeId ? meta?.title ?? tr("ah.untitled") : null,
    conversationArchived: !!meta?.archived,
    conversationState,
    history: {
      conversations: listQuery.data ?? [],
      listState,
      filter,
      activeId,
      query: histQuery,
      hits: searchQuery.data ?? [],
      searchState,
      actionError,
      onQuery: setHistQuery,
      onFilter: setFilter,
      onSelect: (id) => void loadConversation(id),
      onNew: startNew,
      onRename: renameConversation,
      onArchive: archiveConversation,
      onRetry: () => void listQuery.refetch(),
    },
    picker: {
      state: docsQuery.isError ? "error" : docsQuery.data ? "ready" : "loading",
      docs: docsQuery.data ?? [],
      selected: selectedDocs,
      onToggle: (id) => setSelectedDocs((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
      onConfirm: confirmDocs,
      onCancel: () => setPanel("chat"),
      onRetry: () => void docsQuery.refetch(),
    },
    attach: {
      items: attach.items,
      policy,
      problem: attach.problem ?? (policyQuery.isError && menuOpen ? tr("at.policy.error") : null),
      menuOpen,
      onToggleMenu: () => setMenuOpen((m) => !m),
      onUploadClick: () => { setMenuOpen(false); fileInputRef.current?.click(); },
      onChoose: chooseDocs,
      onRemove: attach.remove,
      onRetry: attach.retry,
      onFiles: attach.addFiles,
      fileInputRef,
      busy: attach.uploading,
    },
    memory: {
      state: memoryQuery.isError ? "error" : memoryQuery.data ? "ready" : "loading",
      items: memoryQuery.data ?? [],
      highlightId: memoryHighlight,
      actionError: memoryError,
      onCorrect: (id, statement) => memoryAction(`/api/assistant/memory/${encodeURIComponent(id)}/correct`, { statement }),
      onRetract: (id) => memoryAction(`/api/assistant/memory/${encodeURIComponent(id)}/retract`, {}),
      onRetry: () => void memoryQuery.refetch(),
    },
    onOpenMemory: () => setPanel((p) => (p === "memory" ? "chat" : "memory")),
    onOpenHistory: () => setPanel((p) => (p === "history" ? "chat" : "history")),
    onBack: () => setPanel("chat"),
    onRestore: () => void restoreActive(),
    onOpenAttachment: (id) => void openAttachment(id),
    attachmentError,
  };

  const panelNode = open ? (
    <AssistantPanelView
      language={language}
      entries={entries}
      status={statusQuery.data}
      statusState={statusState}
      pending={pending}
      failure={failure}
      cooling={cooling}
      draft={draft}
      onDraft={setDraft}
      onSend={(t) => void send(t)}
      onRetry={onRetry}
      onRetryStatus={() => void statusQuery.refetch()}
      onClear={startNew}
      onClose={close}
      features={features}
      panelRef={panelRef}
      inputRef={inputRef}
      titleRef={titleRef}
      bodyRef={bodyRef}
    />
  ) : null;

  const fab = (
    <button
      ref={fabRef}
      type="button"
      className="aa-fab"
      data-open={open ? "true" : "false"}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={tr("assistant.openAria")}
      onClick={() => setOpen(true)}
      data-testid="assistant-fab"
    >
      <span className="aa-fab-crest"><LumiereCrest size={30} /></span>
      <span className="aa-fab-label">{tr("assistant.open")}</span>
    </button>
  );

  const tree = (<>{fab}{panelNode}</>);
  return typeof document !== "undefined" ? createPortal(tree, document.body) : tree;
}

export default AcademicAssistant;
