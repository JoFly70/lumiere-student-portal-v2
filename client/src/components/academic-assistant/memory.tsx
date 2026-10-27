/**
 * "What Lumière remembers" (S21): the student's own academic memory, each item with its basis (student-reported vs
 * official record) and provenance link, plus correct / retract. Rendered inside the drawer like the history view.
 * Remembered items never change official credits, verification, billing or acceptance decisions.
 */
import React, { useState } from "react";
import { Check, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { Link } from "wouter";
import type { Language } from "@/i18n";
import { isSafeInternalPath } from "./logic";
import type { Tr } from "./tr";

void React;

export interface MemoryItem {
  id: string;
  category: string;
  statement: string;
  status: string;
  basis: string;
  sources: { kind: string; path: string | null; excerpt: string | null; createdAt: string | null }[];
  updatedAt: string | null;
}

export function sanitiseMemory(raw: unknown): MemoryItem[] {
  const items = (raw as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const out: MemoryItem[] = [];
  for (const i of items) {
    if (!i || typeof i !== "object") continue;
    const r = i as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.statement !== "string") continue;
    const sources = Array.isArray(r.sources) ? r.sources : [];
    out.push({
      id: r.id,
      category: typeof r.category === "string" ? r.category : "preference",
      statement: r.statement,
      status: typeof r.status === "string" ? r.status : "active",
      basis: typeof r.basis === "string" ? r.basis : "student_reported",
      updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
      sources: sources.filter((s): s is Record<string, unknown> => !!s && typeof s === "object").map((s) => ({
        kind: typeof s.kind === "string" ? s.kind : "message",
        path: isSafeInternalPath(s.path) ? (s.path as string) : null,
        excerpt: typeof s.excerpt === "string" ? s.excerpt : null,
        createdAt: typeof s.createdAt === "string" ? s.createdAt : null,
      })),
    });
  }
  return out;
}

export interface MemoryViewProps {
  tr: Tr;
  language: Language;
  state: "loading" | "ready" | "error";
  items: readonly MemoryItem[];
  highlightId: string | null;
  actionError: string | null;
  onCorrect: (id: string, statement: string) => Promise<void>;
  onRetract: (id: string) => Promise<void>;
  onRetry: () => void;
}

function MemoryRow({ item, p }: { item: MemoryItem; p: MemoryViewProps }) {
  const { tr } = p;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.statement);
  const [busy, setBusy] = useState(false);
  const source = item.sources.find((s) => s.path);
  const save = async () => {
    const t = draft.replace(/\s+/g, " ").trim();
    if (!t || t === item.statement) { setEditing(false); return; }
    setBusy(true);
    try { await p.onCorrect(item.id, t); setEditing(false); } finally { setBusy(false); }
  };
  return (
    <li className={`aa-conv aa-mem${p.highlightId === item.id ? " is-current" : ""}`} data-testid="assistant-memory-item">
      <div className="aa-mem-main">
        <span className="aa-conv-meta">{tr(item.basis === "official_record" ? "am.basis.official" : "am.basis.reported")}</span>
        {editing ? (
          <>
            <label className="aa-sr" htmlFor={`aa-mem-${item.id}`}>{tr("am.correct.label")}</label>
            <input id={`aa-mem-${item.id}`} className="aa-search" value={draft} maxLength={300} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }}
              autoFocus data-testid="assistant-memory-input" />
          </>
        ) : (
          <span className="aa-conv-title aa-mem-text">{item.statement}</span>
        )}
        {source?.path && !editing && (
          <Link href={source.path} className="aa-conv-preview" data-testid="assistant-memory-source">{source.excerpt ? tr("am.sourceQuote", { q: source.excerpt.slice(0, 90) }) : tr("am.source")}</Link>
        )}
      </div>
      <div className="aa-conv-actions">
        {editing ? (
          <>
            <button type="button" className="aa-iconbtn" disabled={busy} onClick={() => void save()} aria-label={tr("am.save")} title={tr("am.save")}><Check aria-hidden="true" size={16} /></button>
            <button type="button" className="aa-iconbtn" onClick={() => setEditing(false)} aria-label={tr("am.cancel")} title={tr("am.cancel")}><X aria-hidden="true" size={16} /></button>
          </>
        ) : (
          <>
            <button type="button" className="aa-iconbtn" onClick={() => { setDraft(item.statement); setEditing(true); }} aria-label={tr("am.correct", { item: item.statement })} title={tr("am.correctShort")} data-testid="assistant-memory-correct"><Pencil aria-hidden="true" size={16} /></button>
            <button type="button" className="aa-iconbtn" disabled={busy} onClick={async () => { setBusy(true); try { await p.onRetract(item.id); } finally { setBusy(false); } }} aria-label={tr("am.retract", { item: item.statement })} title={tr("am.retractShort")} data-testid="assistant-memory-retract"><Trash2 aria-hidden="true" size={16} /></button>
          </>
        )}
      </div>
    </li>
  );
}

export function MemoryView(p: MemoryViewProps) {
  const { tr } = p;
  const active = p.items.filter((i) => i.status === "active");
  return (
    <div className="aa-sub" data-testid="assistant-memory">
      <div className="aa-sub-head">
        <h3 className="aa-sub-title" tabIndex={-1} data-autofocus="true">{tr("am.title")}</h3>
        <p className="aa-quiet">{tr("am.intro")}</p>
      </div>
      <div className="aa-sub-body">
        {p.actionError && <p className="aa-conv-error" role="alert">{p.actionError}</p>}
        {p.state === "loading" ? (
          <p className="aa-quiet" role="status">{tr("am.loading")}</p>
        ) : p.state === "error" ? (
          <div className="aa-alert aa-alert-error" role="alert">
            <p>{tr("am.error")}</p>
            <div className="aa-alert-actions"><button type="button" className="aa-linkbtn" onClick={p.onRetry}><RotateCcw aria-hidden="true" size={15} />{tr("assistant.retry")}</button></div>
          </div>
        ) : active.length === 0 ? (
          <p className="aa-quiet" data-testid="assistant-memory-empty">{tr("am.empty")}</p>
        ) : (
          <ul className="aa-conv-list" aria-label={tr("am.title")}>
            {active.map((i) => <MemoryRow key={i.id} item={i} p={p} />)}
          </ul>
        )}
      </div>
    </div>
  );
}
