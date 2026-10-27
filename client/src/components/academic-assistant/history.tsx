/**
 * Conversation history (S21): newest first, search across messages, rename, archive / restore, and an archived filter.
 * Rendered inside the drawer (not as a nested dialog) so the drawer's focus trap and Escape handling stay in one place.
 */
import React, { useRef, useState } from "react";
import { Archive, ArchiveRestore, MessageSquarePlus, Pencil, RotateCcw, Search } from "lucide-react";
import type { Language } from "@/i18n";
import { SEARCH_MIN_CHARS, displayTitle, normaliseTitle, rovingIndex, type ConversationHit, type ConversationSummary } from "./logic";
import type { Tr } from "./tr";

void React;

export interface HistoryViewProps {
  tr: Tr;
  language: Language;
  conversations: readonly ConversationSummary[];
  listState: "loading" | "ready" | "error";
  filter: "active" | "archived";
  activeId: string | null;
  query: string;
  hits: readonly ConversationHit[];
  searchState: "idle" | "loading" | "ready" | "error";
  actionError: string | null;
  onQuery: (q: string) => void;
  onFilter: (f: "active" | "archived") => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => Promise<void> | void;
  onArchive: (id: string, archived: boolean) => Promise<void> | void;
  onRetry: () => void;
}

function formatDate(value: string, language: Language): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function ConversationRow({ c, p }: { c: ConversationSummary; p: HistoryViewProps }) {
  const { tr } = p;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.title);
  const [renameError, setRenameError] = useState(false);
  const title = displayTitle(c, tr("ah.untitled"));
  const current = c.id === p.activeId;
  const editRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    const t = normaliseTitle(draft);
    if (!t) { setRenameError(true); return; }
    if (t === c.title) { setEditing(false); return; }
    try { await p.onRename(c.id, t); setEditing(false); setRenameError(false); } catch { setRenameError(true); }
  };

  if (editing) {
    return (
      <li className="aa-conv aa-conv-edit" data-testid="assistant-conversation-edit">
        <label className="aa-sr" htmlFor={`aa-rename-${c.id}`}>{tr("ah.rename.label")}</label>
        <input
          id={`aa-rename-${c.id}`}
          ref={editRef}
          className="aa-search"
          value={draft}
          maxLength={120}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void save(); }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(false); setDraft(c.title); }
          }}
          aria-invalid={renameError}
          data-testid="assistant-rename-input"
        />
        <div className="aa-conv-editactions">
          <button type="button" className="aa-linkbtn" onClick={() => void save()} data-testid="assistant-rename-save">{tr("ah.rename.save")}</button>
          <button type="button" className="aa-linkbtn" onClick={() => { setEditing(false); setDraft(c.title); setRenameError(false); }} data-testid="assistant-rename-cancel">{tr("ah.rename.cancel")}</button>
        </div>
        {renameError && <p className="aa-conv-error" role="alert">{tr("ah.rename.error")}</p>}
      </li>
    );
  }
  return (
    <li className={`aa-conv${current ? " is-current" : ""}${c.archived ? " is-archived" : ""}`} data-testid="assistant-conversation" data-conversation-id={c.id}>
      <button type="button" className="aa-conv-open" data-roving="true" onClick={() => p.onSelect(c.id)} aria-current={current ? "true" : undefined} aria-label={tr("ah.open", { title })}>
        <span className="aa-conv-title">{title}</span>
        {c.lastMessagePreview ? <span className="aa-conv-preview">{c.lastMessagePreview}</span> : null}
        <span className="aa-conv-meta">
          {formatDate(c.lastActivityAt, p.language)}
          {" · "}{c.messageCount === 1 ? tr("ah.messages.one") : tr("ah.messages.other", { n: c.messageCount })}
          {current ? ` · ${tr("ah.current")}` : ""}
          {c.archived ? ` · ${tr("ah.archivedBadge")}` : ""}
        </span>
      </button>
      <div className="aa-conv-actions">
        <button type="button" className="aa-iconbtn aa-iconbtn-sm" onClick={() => { setDraft(c.title || title); setEditing(true); }} aria-label={tr("ah.renameAria", { title })} title={tr("ah.rename")} data-testid="assistant-conversation-rename">
          <Pencil aria-hidden="true" size={16} />
        </button>
        <button type="button" className="aa-iconbtn aa-iconbtn-sm" onClick={() => void p.onArchive(c.id, !c.archived)} aria-label={tr(c.archived ? "ah.unarchiveAria" : "ah.archiveAria", { title })} title={tr(c.archived ? "ah.unarchive" : "ah.archive")} data-testid="assistant-conversation-archive">
          {c.archived ? <ArchiveRestore aria-hidden="true" size={16} /> : <Archive aria-hidden="true" size={16} />}
        </button>
      </div>
    </li>
  );
}

export function HistoryView(p: HistoryViewProps) {
  const { tr } = p;
  const listRef = useRef<HTMLDivElement>(null);
  const searching = p.query.trim().length > 0;
  const longEnough = p.query.trim().length >= SEARCH_MIN_CHARS;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    const nodes = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-roving]") ?? []);
    const next = rovingIndex(e.key, nodes.indexOf(document.activeElement as HTMLElement), nodes.length);
    if (next !== null) { e.preventDefault(); nodes[next]?.focus(); }
  };

  return (
    <div className="aa-sub" data-testid="assistant-history">
      <div className="aa-sub-head">
        <div className="aa-sub-row">
          <h3 className="aa-sub-title" tabIndex={-1} data-autofocus="true">{tr("ah.history")}</h3>
          <button type="button" className="aa-linkbtn" onClick={p.onNew} data-testid="assistant-history-new">
            <MessageSquarePlus aria-hidden="true" size={15} />{tr("ah.new")}
          </button>
        </div>
        <div className="aa-searchwrap">
          <Search aria-hidden="true" size={15} className="aa-searchicon" />
          <input type="search" className="aa-search aa-search-pad" value={p.query} onChange={(e) => p.onQuery(e.target.value)} placeholder={tr("ah.search.placeholder")} aria-label={tr("ah.search.label")} autoComplete="off" data-testid="assistant-history-search" />
        </div>
        {!searching && (
          <div className="aa-seg" role="group" aria-label={tr("ah.filter.aria")}>
            <button type="button" className="aa-segbtn" aria-pressed={p.filter === "active"} onClick={() => p.onFilter("active")} data-testid="assistant-filter-active">{tr("ah.filter.active")}</button>
            <button type="button" className="aa-segbtn" aria-pressed={p.filter === "archived"} onClick={() => p.onFilter("archived")} data-testid="assistant-filter-archived">{tr("ah.filter.archived")}</button>
          </div>
        )}
      </div>
      <div className="aa-sub-body" ref={listRef} onKeyDown={onKey}>
        {p.actionError && <p className="aa-conv-error" role="alert" data-testid="assistant-history-action-error">{p.actionError}</p>}
        {searching ? (
          !longEnough ? (
            <p className="aa-quiet">{tr("ah.search.short")}</p>
          ) : p.searchState === "loading" ? (
            <p className="aa-quiet" role="status">{tr("ah.search.loading")}</p>
          ) : p.searchState === "error" ? (
            <p className="aa-conv-error" role="alert">{tr("ah.search.error")}</p>
          ) : p.hits.length === 0 ? (
            <p className="aa-quiet" role="status" data-testid="assistant-search-none">{tr("ah.search.none", { q: p.query.trim() })}</p>
          ) : (
            <ul className="aa-conv-list" aria-label={tr("ah.search.results")} data-testid="assistant-search-hits">
              {p.hits.map((h) => (
                <li key={`${h.conversationId}:${h.messageId}`} className="aa-conv">
                  <button type="button" className="aa-conv-open" data-roving="true" onClick={() => p.onSelect(h.conversationId)} aria-label={tr("ah.open", { title: h.conversationTitle || tr("ah.untitled") })} data-testid="assistant-search-hit">
                    <span className="aa-conv-title">{h.conversationTitle || tr("ah.untitled")}</span>
                    <span className="aa-conv-preview"><strong>{h.role === "student" ? tr("ah.hit.you") : tr("ah.hit.guide")}</strong>{": "}{h.snippet}</span>
                    <span className="aa-conv-meta">{formatDate(h.createdAt, p.language)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : p.listState === "loading" ? (
          <p className="aa-quiet" role="status" data-testid="assistant-history-loading">{tr("ah.list.loading")}</p>
        ) : p.listState === "error" ? (
          <div className="aa-alert aa-alert-error" role="alert" data-testid="assistant-history-error">
            <p>{tr("ah.list.error")}</p>
            <div className="aa-alert-actions"><button type="button" className="aa-linkbtn" onClick={p.onRetry}><RotateCcw aria-hidden="true" size={15} />{tr("assistant.retry")}</button></div>
          </div>
        ) : p.conversations.length === 0 ? (
          <p className="aa-quiet" data-testid="assistant-history-empty">{tr(p.filter === "archived" ? "ah.list.emptyArchived" : "ah.list.empty")}</p>
        ) : (
          <ul className="aa-conv-list" aria-label={tr("ah.history")} data-testid="assistant-conversation-list">
            {p.conversations.map((c) => <ConversationRow key={c.id} c={c} p={p} />)}
          </ul>
        )}
      </div>
    </div>
  );
}
