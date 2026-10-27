/**
 * Lumière academic assistant (S20): a floating crest button that opens a text chat drawer.
 *
 * Mount once, inside the AUTHENTICATED student shell only (never on login / reset / verify):
 *   import { AcademicAssistant } from "@/components/academic-assistant";
 *   <AcademicAssistant />
 *
 * Honesty rule: when the server answers in "local" mode the answer is labelled as Lumière guide / local guidance
 * and never described as AI. Server text is rendered as plain text (never HTML). Nothing is stored in the browser.
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, ExternalLink, LifeBuoy, RotateCcw, SendHorizontal, X } from "lucide-react";
import { LumiereCrest } from "@/components/brand/lumiere-brand";
import { api } from "@/lib/api";
import { frTypo, useT, type Language } from "@/i18n";
import { assistantEn, assistantFr, type AssistantKey } from "@/i18n/modules/assistant";
import {
  FOCUSABLE_SELECTOR,
  MAX_MESSAGE_LENGTH,
  THROTTLE_COOLDOWN_MS,
  buildHistory,
  classifyFailure,
  nextTrapTarget,
  normaliseMessage,
  sanitiseReply,
  type AssistantReply,
  type AssistantStatus,
  type ChatEntry,
  type FailureKind,
} from "./logic";
import "@/styles/academic-assistant.css";

void React; // classic JSX runtime when rendered under vitest/esbuild

type Tr = (key: AssistantKey, vars?: Record<string, string | number>) => string;

/** Self-contained lookup: works whether or not the module has been spread into the global dictionaries yet. */
export function makeTr(language: Language): Tr {
  const dict: Record<string, string> = language === "fr" ? assistantFr : assistantEn;
  return (key, vars) => {
    let s = dict[key] ?? assistantEn[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return language === "fr" ? frTypo(s) : s;
  };
}

function formatDate(value: string, language: Language): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA", { year: "numeric", month: "short", day: "numeric" });
}

/* ------------------------------------------------------------------------------------------------ view */

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
  const unavailable = p.statusState === "error" || (p.statusState === "ready" && p.status?.enabled === false);
  const inputDisabled = unavailable || p.cooling;
  const canSend = !inputDisabled && !p.pending && normaliseMessage(p.draft).length > 0;
  const suggestions = p.entries.length === 0 && p.status ? p.status.suggestions.slice(0, 4) : [];

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
      >
        <header className="aa-head">
          <LumiereCrest size={34} />
          <div className="aa-head-text">
            <h2 id={titleId} ref={p.titleRef} tabIndex={-1} className="aa-title">{tr("assistant.title")}</h2>
            <p className="aa-subtitle">{tr("assistant.subtitle")}</p>
          </div>
          {p.entries.length > 0 && (
            <button type="button" className="aa-iconbtn" onClick={p.onClear} aria-label={tr("assistant.clearAria")} title={tr("assistant.clear")} data-testid="assistant-clear">
              <RotateCcw aria-hidden="true" size={18} />
            </button>
          )}
          <button type="button" className="aa-iconbtn" onClick={p.onClose} aria-label={tr("assistant.closeAria")} title={tr("assistant.close")} data-testid="assistant-close">
            <X aria-hidden="true" size={20} />
          </button>
        </header>

        <div ref={p.bodyRef} className="aa-body" role="log" aria-live="polite" aria-relevant="additions" aria-label={tr("assistant.conversation")} data-testid="assistant-log">
          <div className="aa-msg aa-msg-assistant" data-testid="assistant-greeting">
            <p className="aa-msg-label">{tr("assistant.title")}</p>
            <div className="aa-bubble"><p className="aa-text">{tr("assistant.greeting")}</p></div>
          </div>

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
                <div className="aa-bubble"><p className="aa-text">{e.text}</p></div>
              </div>
            ) : (
              <AssistantAnswer key={e.id} entry={e} language={p.language} tr={tr} />
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

          {p.failure && (
            <div className={`aa-alert aa-alert-${p.failure.kind}`} role="alert" data-testid={`assistant-${p.failure.kind}`}>
              <p>{tr(p.failure.kind === "throttled" ? "assistant.throttled" : p.failure.kind === "unavailable" ? "assistant.unavailable" : "assistant.error.generic")}</p>
              <div className="aa-alert-actions">
                <button type="button" className="aa-linkbtn" onClick={p.onRetry} disabled={p.cooling || p.pending} data-testid="assistant-retry">
                  <RotateCcw aria-hidden="true" size={15} />{tr("assistant.retry")}
                </button>
                {p.failure.kind === "unavailable" && <SupportLink tr={tr} onNavigate={p.onClose} />}
              </div>
            </div>
          )}

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

        <footer className="aa-foot">
          <form
            className="aa-form"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (canSend) p.onSend(p.draft);
            }}
          >
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
          <p id={counterId} className={`aa-count${p.draft.length > MAX_MESSAGE_LENGTH - 60 ? " aa-count-near" : ""}`} aria-live="off">
            {p.draft.length > MAX_MESSAGE_LENGTH - 100 ? tr("assistant.counter", { n: p.draft.length, max: MAX_MESSAGE_LENGTH }) : " "}
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

function AssistantAnswer({ entry, language, tr }: { entry: Extract<ChatEntry, { role: "assistant" }>; language: Language; tr: Tr }) {
  const local = entry.mode === "local";
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
                  <Link href={l.path} className="aa-portal-link">{l.label}<ArrowRight aria-hidden="true" size={14} /></Link>
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
        <p className="aa-note">{tr(local ? "assistant.note.local" : "assistant.note.live")}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- container */

let entrySeq = 0;
const nextId = () => `aa-${Date.now().toString(36)}-${++entrySeq}`;

export function AcademicAssistant({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const { language } = useT();
  const tr = useMemo(() => makeTr(language), [language]);
  const [open, setOpen] = useState(defaultOpen);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [failure, setFailure] = useState<{ kind: FailureKind; text: string } | null>(null);
  const [cooling, setCooling] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const coolTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const statusQuery = useQuery<AssistantStatus>({
    queryKey: ["/api/assistant/status"],
    queryFn: () => api.get<AssistantStatus>("/api/assistant/status"),
    enabled: open,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const mutation = useMutation<AssistantReply, unknown, { text: string; history: ReturnType<typeof buildHistory> }>({
    mutationFn: async ({ text, history }) =>
      sanitiseReply(await api.post("/api/assistant/message", { message: text, language, ...(history.length ? { history } : {}) })),
  });

  const close = useCallback(() => setOpen(false), []);

  // Focus: into the panel on open, back to the button on close.
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

  // Escape closes; Tab is trapped inside the dialog.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        close();
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
  }, [open, close]);

  // Keep the newest message in view: an answer from its start, a question at the bottom.
  useEffect(() => {
    const body = bodyRef.current;
    if (!open || !body || entries.length === 0) return;
    const last = entries[entries.length - 1]!;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const behavior: ScrollBehavior = reduce ? "auto" : "smooth";
    if (last.role === "assistant") {
      body.querySelector<HTMLElement>(`[data-entry-id="${last.id}"]`)?.scrollIntoView({ block: "start", behavior });
    } else {
      body.scrollTo({ top: body.scrollHeight, behavior });
    }
  }, [entries, open, mutation.isPending]);

  useEffect(() => () => { if (coolTimer.current) clearTimeout(coolTimer.current); }, []);

  const ask = useCallback(
    (raw: string, retryOf?: string) => {
      const text = normaliseMessage(raw);
      if (!text || mutation.isPending || cooling) return;
      setFailure(null);
      let history: ReturnType<typeof buildHistory>;
      if (retryOf) {
        const idx = entries.findIndex((e) => e.id === retryOf);
        history = buildHistory(idx >= 0 ? entries.slice(0, idx) : entries);
      } else {
        history = buildHistory(entries);
        setEntries((prev) => [...prev, { id: nextId(), role: "user", text }]);
        setDraft("");
      }
      mutation.mutate(
        { text, history },
        {
          onSuccess: (r) => setEntries((prev) => [...prev, { id: nextId(), role: "assistant", text: r.reply, mode: r.mode, sources: r.sources, links: r.links, notice: r.notice }]),
          onError: (err) => {
            const kind = classifyFailure(err);
            setFailure({ kind, text });
            if (kind === "throttled") {
              setCooling(true);
              if (coolTimer.current) clearTimeout(coolTimer.current);
              coolTimer.current = setTimeout(() => setCooling(false), THROTTLE_COOLDOWN_MS);
            }
          },
        },
      );
    },
    [entries, mutation, cooling],
  );

  const lastUser = [...entries].reverse().find((e) => e.role === "user");
  const onRetry = useCallback(() => {
    if (failure && lastUser) ask(failure.text, lastUser.id);
  }, [failure, lastUser, ask]);

  const clear = useCallback(() => {
    mutation.reset();
    setEntries([]);
    setFailure(null);
    setDraft("");
    inputRef.current?.focus();
  }, [mutation]);

  const statusState: "loading" | "ready" | "error" = statusQuery.isError ? "error" : statusQuery.data ? "ready" : "loading";

  const panel = open ? (
    <AssistantPanelView
      language={language}
      entries={entries}
      status={statusQuery.data}
      statusState={statusState}
      pending={mutation.isPending}
      failure={failure}
      cooling={cooling}
      draft={draft}
      onDraft={setDraft}
      onSend={(t) => ask(t)}
      onRetry={onRetry}
      onRetryStatus={() => void statusQuery.refetch()}
      onClear={clear}
      onClose={close}
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

  const tree = (<>{fab}{panel}</>);
  return typeof document !== "undefined" ? createPortal(tree, document.body) : tree;
}

export default AcademicAssistant;
