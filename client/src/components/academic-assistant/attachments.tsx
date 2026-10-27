/**
 * Chat attachments (S21): the paperclip menu, removable chips, the "my documents" picker and the upload flow.
 * Flow for a new file: pre-validate against GET /api/student/attachments/policy, POST upload-url, PUT to the signed URL,
 * POST finalize. The server re-checks everything; the pre-check only spares a round trip.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, Paperclip, RotateCcw, Upload, X, FolderOpen } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Language } from "@/i18n";
import {
  canAddDocument, formatBytes, validateAttachmentFile, type AttachableDocument, type AttachmentPolicy, type AttachmentProblem, type MessageAttachment,
} from "./logic";
import { rovingIndex } from "./logic";
import type { Tr } from "./tr";

void React;

export interface ComposerAttachment {
  key: string;
  documentId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  state: "uploading" | "ready" | "failed";
  source: "upload" | "library";
  file?: File;
}

export function problemMessage(tr: Tr, problem: AttachmentProblem, ctx: { name: string; policy: AttachmentPolicy | null; language: Language }): string {
  const types = ctx.policy ? Array.from(new Set(ctx.policy.types.map((t) => t.ext.toUpperCase()))).join(", ") : "";
  const maxFile = ctx.policy ? formatBytes(Math.max(0, ...ctx.policy.types.map((t) => t.maxBytes)), ctx.language) : "";
  switch (problem) {
    case "type": return tr("at.err.type", { name: ctx.name, types });
    case "size": return tr("at.err.size", { name: ctx.name, max: maxFile });
    case "count": return tr("at.err.count", { max: ctx.policy?.maxPerMessage ?? 5 });
    case "total": return tr("at.err.total", { max: formatBytes(ctx.policy?.maxBytesPerMessage ?? 52428800, ctx.language) });
    case "quota": return tr("at.err.quota", { name: ctx.name });
    case "empty": return tr("at.err.empty", { name: ctx.name });
    case "duplicate": return tr("at.err.duplicate", { name: ctx.name });
  }
}

let keySeq = 0;
const nextKey = () => `att-${Date.now().toString(36)}-${++keySeq}`;

export interface UploadDeps {
  post: <T>(url: string, body: unknown) => Promise<T>;
  put: (url: string, file: File, contentType: string) => Promise<void>;
}
export const defaultUploadDeps: UploadDeps = {
  post: (url, body) => api.post(url, body),
  put: async (url, file, contentType) => {
    const res = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType, "x-upsert": "false" }, body: file });
    if (!res.ok) throw new ApiError("Upload failed", res.status);
  },
};

/** The three-step upload. Resolves to the stored document; rejects on any failed step. */
export async function uploadChatAttachment(file: File, policy: AttachmentPolicy, deps: UploadDeps = defaultUploadDeps): Promise<AttachableDocument> {
  const rule = policy.types.find((t) => file.name.toLowerCase().endsWith(`.${t.ext}`));
  const mimeType = file.type || rule?.mime || "application/octet-stream";
  const target = await deps.post<{ uploadUrl: string; storagePath: string }>("/api/student/attachments/upload-url", { fileName: file.name, sizeBytes: file.size, mimeType });
  await deps.put(target.uploadUrl, file, mimeType);
  const done = await deps.post<{ document: Record<string, unknown> }>("/api/student/attachments/finalize", { storagePath: target.storagePath, fileName: file.name });
  const d = done.document;
  return {
    id: String(d.id), fileName: String(d.fileName ?? file.name), mimeType: String(d.mimeType ?? mimeType), sizeBytes: Number(d.sizeBytes ?? file.size),
    docType: typeof d.docType === "string" ? d.docType : undefined, source: "chat", status: typeof d.status === "string" ? d.status : undefined,
    uploadedAt: typeof d.uploadedAt === "string" ? d.uploadedAt : undefined, extractionStatus: typeof d.extractionStatus === "string" ? d.extractionStatus : null,
  };
}

/** Composer attachment state. `deps` is injectable for tests. */
export function useComposerAttachments(policy: AttachmentPolicy | null, tr: Tr, language: Language, onUploaded?: () => void, deps: UploadDeps = defaultUploadDeps) {
  const [items, setItems] = useState<ComposerAttachment[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const totals = useMemo(() => {
    const live = items.filter((i) => i.state !== "failed");
    return { count: live.length, bytes: live.reduce((n, i) => n + i.sizeBytes, 0), names: live.map((i) => i.fileName), uploaded: live.filter((i) => i.source === "upload").reduce((n, i) => n + i.sizeBytes, 0) };
  }, [items]);

  const patch = useCallback((key: string, p: Partial<ComposerAttachment>) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...p } : i))), []);

  const runUpload = useCallback(async (key: string, file: File) => {
    if (!policy) return;
    try {
      const doc = await uploadChatAttachment(file, policy, deps);
      patch(key, { state: "ready", documentId: doc.id, fileName: doc.fileName, sizeBytes: doc.sizeBytes, mimeType: doc.mimeType });
      onUploaded?.();
    } catch (err) {
      patch(key, { state: "failed" });
      setProblem(err instanceof ApiError && err.status === 413 ? tr("at.err.size", { name: file.name, max: formatBytes(Math.max(0, ...policy.types.map((t) => t.maxBytes)), language) }) : tr("at.err.upload", { name: file.name }));
    }
  }, [policy, deps, patch, tr, language, onUploaded]);

  const addFiles = useCallback((files: readonly File[]) => {
    if (!policy) { setProblem(tr("at.policy.error")); return; }
    setProblem(null);
    let count = itemsRef.current.filter((i) => i.state !== "failed").length;
    let bytes = itemsRef.current.filter((i) => i.state !== "failed").reduce((n, i) => n + i.sizeBytes, 0);
    let uploaded = itemsRef.current.filter((i) => i.state !== "failed" && i.source === "upload").reduce((n, i) => n + i.sizeBytes, 0);
    const names = itemsRef.current.filter((i) => i.state !== "failed").map((i) => i.fileName);
    const accepted: ComposerAttachment[] = [];
    let firstProblem: string | null = null;
    for (const file of files) {
      const p = validateAttachmentFile(file, policy, { count, bytes, names }, uploaded);
      if (p) { firstProblem ??= problemMessage(tr, p, { name: file.name, policy, language }); continue; }
      count += 1; bytes += file.size; uploaded += file.size; names.push(file.name);
      accepted.push({ key: nextKey(), documentId: null, fileName: file.name, mimeType: file.type, sizeBytes: file.size, state: "uploading", source: "upload", file });
    }
    if (firstProblem) setProblem(firstProblem);
    if (!accepted.length) return;
    setItems((prev) => [...prev, ...accepted]);
    for (const a of accepted) void runUpload(a.key, a.file!);
  }, [policy, tr, language, runUpload]);

  const addDocuments = useCallback((docs: readonly AttachableDocument[]) => {
    setProblem(null);
    const cur = itemsRef.current.filter((i) => i.state !== "failed");
    const ids = cur.map((i) => i.documentId).filter((x): x is string => !!x);
    let bytes = cur.reduce((n, i) => n + i.sizeBytes, 0);
    const added: ComposerAttachment[] = [];
    for (const d of docs) {
      const p = canAddDocument(d, policy, { ids: [...ids, ...added.map((a) => a.documentId!)], bytes });
      if (p) { setProblem(problemMessage(tr, p, { name: d.fileName, policy, language })); continue; }
      bytes += d.sizeBytes;
      added.push({ key: nextKey(), documentId: d.id, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, state: "ready", source: "library" });
    }
    if (added.length) setItems((prev) => [...prev, ...added]);
  }, [policy, tr, language]);

  const remove = useCallback((key: string) => { setItems((prev) => prev.filter((i) => i.key !== key)); setProblem(null); }, []);
  const retry = useCallback((key: string) => {
    const it = itemsRef.current.find((i) => i.key === key);
    if (!it?.file) return;
    setProblem(null);
    patch(key, { state: "uploading" });
    void runUpload(key, it.file);
  }, [patch, runUpload]);
  const clear = useCallback(() => { setItems([]); setProblem(null); }, []);

  const readyIds = items.filter((i) => i.state === "ready" && i.documentId).map((i) => i.documentId!);
  return { items, problem, setProblem, totals, addFiles, addDocuments, remove, retry, clear, readyIds, uploading: items.some((i) => i.state === "uploading"), hasFailed: items.some((i) => i.state === "failed") };
}

/* ------------------------------------------------------------------------------------------ presentation */

export function AttachmentChips({
  items, tr, language, onRemove, onRetry,
}: {
  items: readonly ComposerAttachment[]; tr: Tr; language: Language; onRemove: (key: string) => void; onRetry: (key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="aa-chips" aria-label={tr("at.list")} data-testid="assistant-attachment-chips">
      {items.map((i) => (
        <li key={i.key} className={`aa-attchip aa-attchip-${i.state}`} data-testid="assistant-attachment-chip" data-state={i.state}>
          {i.state === "uploading" ? <Loader2 aria-hidden="true" size={14} className="aa-spin" /> : <FileText aria-hidden="true" size={14} />}
          <span className="aa-attchip-name" title={i.fileName}>{i.fileName}</span>
          <span className="aa-attchip-size">{formatBytes(i.sizeBytes, language)}</span>
          {i.state === "uploading" && <span className="aa-sr" role="status">{tr("at.chip.uploading", { name: i.fileName })}</span>}
          {i.state === "failed" && (
            <button type="button" className="aa-attchip-btn" onClick={() => onRetry(i.key)} aria-label={`${tr("at.chip.failed", { name: i.fileName })}. ${tr("at.chip.retry")}`} data-testid="assistant-attachment-retry">
              <RotateCcw aria-hidden="true" size={13} />
            </button>
          )}
          <button type="button" className="aa-attchip-btn" onClick={() => onRemove(i.key)} aria-label={tr("at.chip.remove", { name: i.fileName })} data-testid="assistant-attachment-remove">
            <X aria-hidden="true" size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Files already on a sent message. Each opens through the signed-URL route. */
export function SentAttachments({ items, tr, language, onOpen }: { items: readonly MessageAttachment[]; tr: Tr; language: Language; onOpen: (documentId: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="aa-chips aa-chips-sent" aria-label={tr("ah.attachment.attachedFiles")} data-testid="assistant-sent-attachments">
      {items.map((a) => (
        <li key={a.documentId}>
          <button type="button" className="aa-attchip aa-attchip-btn-open" onClick={() => onOpen(a.documentId)} aria-label={tr("at.chip.open", { name: a.fileName })} data-testid="assistant-sent-attachment">
            <FileText aria-hidden="true" size={14} />
            <span className="aa-attchip-name" title={a.fileName}>{a.fileName}</span>
            <span className="aa-attchip-size">{formatBytes(a.sizeBytes, language)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function AttachMenuButton({
  open, disabled, onToggle, onUpload, onChoose, tr, menuId,
}: {
  open: boolean; disabled: boolean; onToggle: () => void; onUpload: () => void; onChoose: () => void; tr: Tr; menuId: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus(); }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const cur = items.indexOf(document.activeElement as HTMLElement);
    const next = rovingIndex(e.key, cur, items.length);
    if (next !== null) { e.preventDefault(); items[next]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onToggle(); }
  };
  return (
    <div className="aa-attach">
      <button type="button" className="aa-iconbtn aa-attach-btn" disabled={disabled} onClick={onToggle} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label={tr("at.attachAria")} title={tr("at.attach")} data-testid="assistant-attach">
        <Paperclip aria-hidden="true" size={19} />
      </button>
      {open && (
        <div ref={menuRef} id={menuId} role="menu" aria-label={tr("at.menu")} className="aa-menu" onKeyDown={onKey} data-testid="assistant-attach-menu">
          <button type="button" role="menuitem" className="aa-menuitem" onClick={onUpload} data-testid="assistant-attach-upload"><Upload aria-hidden="true" size={16} />{tr("at.menu.upload")}</button>
          <button type="button" role="menuitem" className="aa-menuitem" onClick={onChoose} data-testid="assistant-attach-choose"><FolderOpen aria-hidden="true" size={16} />{tr("at.menu.choose")}</button>
        </div>
      )}
    </div>
  );
}

/** "Choose from my documents" as a panel view (not a nested dialog), so the drawer's focus trap stays whole. */
export function DocumentPicker({
  tr, language, state, docs, policy, current, selected, onToggle, onConfirm, onCancel, onRetry,
}: {
  tr: Tr; language: Language; state: "loading" | "ready" | "error"; docs: readonly AttachableDocument[]; policy: AttachmentPolicy | null;
  current: { ids: readonly string[]; bytes: number }; selected: readonly string[]; onToggle: (id: string) => void; onConfirm: () => void; onCancel: () => void; onRetry: () => void;
}) {
  const [filter, setFilter] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const visible = docs.filter((d) => d.fileName.toLowerCase().includes(filter.trim().toLowerCase()));
  const max = policy?.maxPerMessage ?? 5;
  const onKey = (e: React.KeyboardEvent) => {
    const boxes = Array.from(listRef.current?.querySelectorAll<HTMLElement>("input[type=checkbox]:not(:disabled)") ?? []);
    const next = rovingIndex(e.key, boxes.indexOf(document.activeElement as HTMLElement), boxes.length);
    if (next !== null) { e.preventDefault(); boxes[next]?.focus(); }
  };
  return (
    <div className="aa-sub" data-testid="assistant-picker">
      <div className="aa-sub-head">
        <h3 className="aa-sub-title" tabIndex={-1} data-autofocus="true">{tr("at.picker.title")}</h3>
        <p className="aa-quiet">{tr("at.picker.desc", { max })}</p>
        {docs.length > 4 && (
          <input type="search" className="aa-search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={tr("at.picker.search")} aria-label={tr("at.picker.search")} data-testid="assistant-picker-filter" />
        )}
      </div>
      <div className="aa-sub-body" onKeyDown={onKey}>
        {state === "loading" && <p className="aa-quiet" role="status" data-testid="assistant-picker-loading">{tr("at.picker.loading")}</p>}
        {state === "error" && (
          <div className="aa-alert aa-alert-error" role="alert" data-testid="assistant-picker-error">
            <p>{tr("at.picker.error")}</p>
            <div className="aa-alert-actions"><button type="button" className="aa-linkbtn" onClick={onRetry}><RotateCcw aria-hidden="true" size={15} />{tr("assistant.retry")}</button></div>
          </div>
        )}
        {state === "ready" && docs.length === 0 && <p className="aa-quiet" data-testid="assistant-picker-empty">{tr("at.picker.empty")}</p>}
        {state === "ready" && docs.length > 0 && (
          <ul ref={listRef} className="aa-pick-list" aria-label={tr("at.picker.title")}>
            {visible.map((d) => {
              const already = current.ids.includes(d.id);
              const isSel = selected.includes(d.id);
              const blocked = !already && !isSel && canAddDocument(d, policy, { ids: [...current.ids, ...selected], bytes: current.bytes + docs.filter((x) => selected.includes(x.id)).reduce((n, x) => n + x.sizeBytes, 0) });
              const dis = already || !!blocked;
              const extract = d.extractionStatus ? tr(`at.extract.${d.extractionStatus}` as "at.extract.indexed") : null;
              return (
                <li key={d.id} className="aa-pick-item">
                  <label className={`aa-pick-label${dis ? " is-disabled" : ""}`}>
                    <input type="checkbox" checked={isSel || already} disabled={dis} onChange={() => onToggle(d.id)} data-testid="assistant-picker-item" />
                    <span className="aa-pick-text">
                      <span className="aa-pick-name">{d.fileName}</span>
                      <span className="aa-pick-meta">
                        {formatBytes(d.sizeBytes, language)} · {tr(d.source === "chat" ? "at.source.chat" : "at.source.documents")}{extract ? ` · ${extract}` : ""}
                        {blocked ? ` · ${tr("at.picker.cannot")}` : ""}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="aa-sub-foot">
        <button type="button" className="aa-linkbtn" onClick={onCancel} data-testid="assistant-picker-cancel">{tr("at.picker.cancel")}</button>
        <button type="button" className="aa-send" onClick={onConfirm} disabled={selected.length === 0} data-testid="assistant-picker-add">{tr("at.picker.add", { n: selected.length })}</button>
      </div>
    </div>
  );
}
