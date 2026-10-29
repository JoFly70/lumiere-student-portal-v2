/**
 * S18 — restored original ticket detail modal (support-old.tsx TicketDetailModal)
 * wired to the secured S16 API. Students can reply and attach files; they never
 * see internal notes, emails or status-change authors (the adapter drops them),
 * and there is no status select or internal-note switch.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, FileText, Loader2, MessageSquare, Paperclip, Send, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  newIdempotencyKey,
  useAttachmentDownload,
  useCreateComment,
  useTicket,
  useUploadTicketAttachment,
} from "@/hooks/use-tickets";
import { statusAfterStudentReply } from "@shared/support-contract";
import {
  ORIGINAL_CATEGORY_STYLE,
  ORIGINAL_PRIORITY_STYLE,
  ORIGINAL_STATUS_STYLE,
  toDetailModel,
  type OriginalAttachmentModel,
  type OriginalDetailModel,
} from "./original-support-adapter";
import { useSupportText } from "./original-support-text";
import { StatusBadge, formatDate, formatDateTime, formatFileSize } from "./original-support-bits";
import { attachmentError } from "./support-presentation";

function MetaField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

/** Right-side metadata panel (desktop) / stacked block (mobile). */
export function MetadataPanel({ ticket, className }: { ticket: OriginalDetailModel; className?: string }) {
  const { T, language } = useSupportText();
  return (
    <div className={className} data-testid="ticket-metadata">
      <h4 className="mb-4 text-sm font-medium">{T.meta.heading}</h4>
      <div className="space-y-4">
        <MetaField label={T.meta.status}><StatusBadge status={ticket.status} /></MetaField>
        <MetaField label={T.meta.priority}>
          <Badge variant="secondary" className={`${ORIGINAL_PRIORITY_STYLE[ticket.priority].bgColor} ${ORIGINAL_PRIORITY_STYLE[ticket.priority].color}`}>
            {T.priority[ticket.priority]}
          </Badge>
        </MetaField>
        <MetaField label={T.meta.category}>
          <Badge variant="secondary" className={ORIGINAL_CATEGORY_STYLE[ticket.category]}>{T.topics[ticket.topic]?.label ?? ticket.topicLabel}</Badge>
        </MetaField>
        <MetaField label={T.meta.advisor}>{ticket.advisorName ?? T.meta.unassigned}</MetaField>
        <MetaField label={T.meta.reference}><code className="font-mono text-xs">{ticket.ticketNumber}</code></MetaField>
        <MetaField label={T.meta.lastUpdated}>{formatDateTime(ticket.updatedAt, language)}</MetaField>
        <Separator />
        <div>
          <Label className="mb-2 block text-xs text-muted-foreground">{T.meta.history}</Label>
          <div className="space-y-2" data-testid="status-history-list">
            {ticket.statusHistory.length === 0 && <p className="text-xs text-muted-foreground">{T.meta.noHistory}</p>}
            {ticket.statusHistory.map((h, idx) => (
              <div key={h.id} className="flex items-start gap-2 text-xs" data-testid={`status-history-item-${idx}`}>
                <div className={cn("mt-1.5 h-2 w-2 rounded-full", ORIGINAL_STATUS_STYLE[h.status].bgColor)} />
                <div>
                  <span className="font-medium">{T.status[h.status]}</span>
                  <p className="text-muted-foreground">{formatDate(h.createdAt, language)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AttachmentBadge({ a, onOpen, busy }: { a: OriginalAttachmentModel; onOpen: (a: OriginalAttachmentModel) => void; busy: boolean }) {
  const { T, language } = useSupportText();
  return (
    <button
      type="button"
      onClick={() => onOpen(a)}
      disabled={busy}
      aria-label={T.detail.download(`${a.name}, ${formatFileSize(a.size, language)}`)}
      data-testid={`badge-attachment-${a.id}`}
      className="inline-flex"
    >
      <Badge variant="outline" className="cursor-pointer gap-1 hover-elevate">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
        {a.name}
        <span className="text-muted-foreground">({formatFileSize(a.size, language)})</span>
      </Badge>
    </button>
  );
}

function DetailBody({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const { T, language } = useSupportText();
  // One idempotency key per reply attempt: stable across retries of the same submission, reset after success.
  const replyKey = useRef<{ content: string; key: string } | null>(null);
  const query = useTicket(ticketId);
  const comment = useCreateComment(ticketId);
  const download = useAttachmentDownload(ticketId);
  const upload = useUploadTicketAttachment(ticketId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const ticket = useMemo(() => (query.data?.ticket ? toDetailModel(query.data.ticket) : null), [query.data]);

  if (query.isLoading) {
    return (
      <div role="status" className="space-y-3 p-6" data-testid="detail-loading">
        <div className="h-6 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded bg-muted" />
        <DialogTitle className="sr-only">{T.detail.loading}</DialogTitle>
        <DialogDescription className="sr-only">{T.detail.loading}</DialogDescription>
      </div>
    );
  }
  if (query.isError || !ticket) {
    return (
      <div role="alert" className="space-y-3 p-6" data-testid="detail-error">
        <DialogTitle className="text-lg font-medium">{T.detail.loadErrorTitle}</DialogTitle>
        <DialogDescription>{query.error instanceof Error ? query.error.message : ""}</DialogDescription>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => query.refetch()}>{T.list.retry}</Button>
          <Button variant="ghost" onClick={onClose}>{T.detail.close}</Button>
        </div>
      </div>
    );
  }

  const reply = statusAfterStudentReply(ticket.status, ticket.resolvedAt, new Date());
  const canReply = reply.ok && ticket.canReply !== false;
  const replyBlockedWhy = !reply.ok
    ? (reply.code === "TICKET_CLOSED" ? T.next.closed : T.reply.expired(14))
    : ticket.canReply === false ? T.reply.blocked : null;

  const send = () => {
    if (!draft.trim() || !canReply || comment.isPending) return;
    setNotice(null);
    const content = draft.trim();
    if (replyKey.current?.content !== content) replyKey.current = { content, key: newIdempotencyKey() };
    comment.mutate({ content, idempotencyKey: replyKey.current.key }, {
      onSuccess: () => { replyKey.current = null; setDraft(""); setNotice(T.detail.sent); },
    });
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const err = attachmentError(file);
    if (err) { setFileError(err); return; }
    setFileError(null);
    setNotice(null);
    upload.mutate({ file }, {
      onSuccess: () => setNotice(T.detail.fileAdded(file.name)),
      onError: (e) => setFileError(`${e.message} ${T.files.notAdded(file.name)}`),
    });
  };

  const openAttachment = (a: OriginalAttachmentModel) => {
    setDownloadError(null);
    setDownloadingId(a.id);
    download.mutate(a.id, {
      onSuccess: ({ downloadUrl }) => {
        setDownloadingId(null);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.click();
      },
      onError: (e) => { setDownloadingId(null); setDownloadError(`${e.message} ${T.detail.downloadFailed}`); },
    });
  };

  const done = ticket.status === "resolved" || ticket.status === "closed";

  return (
    <>
      <DialogHeader className="border-b p-4 pb-3 text-left sm:p-6 sm:pb-4">
        <div className="mb-1 flex flex-wrap items-center gap-2 pr-6">
          <code className="font-mono text-sm text-muted-foreground">{ticket.ticketNumber}</code>
          <Badge variant="secondary" className={ORIGINAL_CATEGORY_STYLE[ticket.category]}>{T.topics[ticket.topic]?.label ?? ticket.topicLabel}</Badge>
        </div>
        <DialogTitle className="text-lg leading-snug [overflow-wrap:anywhere] sm:text-xl" data-testid="detail-title">{ticket.subject}</DialogTitle>
        <DialogDescription>{T.detail.createdOn(formatDateTime(ticket.createdAt, language))}</DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto p-4 sm:p-6" data-testid="detail-main">
          <details className="group mb-4 rounded-lg border bg-muted/30 lg:hidden" data-testid="metadata-disclosure">
            <summary className="flex min-h-[44px] cursor-pointer list-none flex-wrap items-center gap-2 p-3 text-sm font-medium">
              <span>{T.meta.heading}</span>
              <StatusBadge status={ticket.status} />
              <span className="ml-auto text-xs text-muted-foreground">{formatDate(ticket.updatedAt, language)}</span>
            </summary>
            <MetadataPanel ticket={ticket} className="border-t p-4" />
          </details>

          <p className="mb-4 rounded-lg border bg-muted/30 p-3 text-sm" data-testid="next-action">{T.next[ticket.status]}</p>

          <div className="mb-6 space-y-4">
            <div>
              <h4 className="mb-2 text-sm font-medium">{T.detail.description}</h4>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]">{ticket.description}</p>
              {ticket.contextLabel && (
                <p className="mt-2 text-sm text-muted-foreground" data-testid="detail-context">
                  {T.detail.relatedTo} <span className="font-medium text-foreground">{ticket.contextLabel}</span>
                </p>
              )}
            </div>

            {done && (
              <div className="rounded-xl border border-l-[3px] border-student-line border-l-st-applied bg-st-applied-soft/40 p-3" data-testid="resolution-card">
                <h4 className="mb-1 flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-st-applied" />{T.detail.resolutionHeading}</h4>
                <p className="whitespace-pre-wrap text-sm">{ticket.resolutionNotes ?? T.detail.resolutionDefault}</p>
              </div>
            )}

            <div data-testid="detail-attachments">
              <h4 className="mb-2 text-sm font-medium">{T.detail.attachments}</h4>
              {ticket.attachments.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {ticket.attachments.map((a) => (
                    <AttachmentBadge key={a.id} a={a} onOpen={openAttachment} busy={downloadingId === a.id} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{T.detail.noAttachments}</p>
              )}
              {downloadError && <p role="alert" className="mt-2 text-sm font-medium text-destructive" data-testid="download-error">{downloadError}</p>}
            </div>
          </div>

          <Separator className="my-6" />

          <div>
            <h4 className="mb-4 flex items-center gap-2 text-sm font-medium">
              <MessageSquare className="h-4 w-4" />
              {T.detail.conversation(ticket.comments.length)}
            </h4>
            <ol className="space-y-4" data-testid="thread">
              {ticket.comments.map((c) => (
                <li
                  key={c.id}
                  data-testid="thread-message"
                  data-author-kind={c.authorKind}
                  className={cn(
                    "rounded-lg p-4",
                    c.authorKind === "student" ? "bg-muted" : "border border-student-gold/60 bg-student-gold-soft/60",
                  )}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", c.authorKind === "student" ? "bg-primary text-primary-foreground" : "bg-blue-600 text-white")}>
                        <User className="h-4 w-4" />
                      </div>
                      <span className="truncate text-sm font-medium">{c.authorKind === "student" ? T.detail.you : c.authorName || T.detail.team}</span>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(c.createdAt, language)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm sm:ml-10 [overflow-wrap:anywhere]">{c.content}</p>
                </li>
              ))}
            </ol>

            <div className="mt-6 space-y-3" data-testid="composer">
              <Label htmlFor="original-reply" className="sr-only">{T.detail.replyLabel}</Label>
              <Textarea
                id="original-reply"
                placeholder={T.detail.replyPlaceholder}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={!canReply}
                className="min-h-[100px] text-base sm:text-sm"
                maxLength={5000}
                data-testid="input-new-comment"
              />
              {replyBlockedWhy && <p className="text-sm text-muted-foreground" data-testid="composer-note">{replyBlockedWhy}</p>}
              {canReply && ticket.status === "resolved" && <p className="text-sm text-muted-foreground">{T.reply.reopens}</p>}
              {comment.isError && <p role="alert" className="text-sm font-medium text-destructive" data-testid="reply-error">{comment.error.message} {T.detail.sendFailed}</p>}
              <div aria-live="polite">
                {notice && <p className="text-sm" data-testid="detail-notice">{notice}</p>}
                {fileError && <p role="alert" className="text-sm font-medium text-destructive" data-testid="attach-error">{fileError}</p>}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  {ticket.canAttach ? (
                    <>
                      <input
                        ref={fileRef}
                        type="file"
                        className="sr-only"
                        aria-label={T.detail.attachFile}
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.doc,.docx"
                        data-testid="input-attach"
                        onChange={(e) => { onFile(e.target.files?.[0]); if (fileRef.current) fileRef.current.value = ""; }}
                      />
                      <Button variant="ghost" size="sm" type="button" onClick={() => fileRef.current?.click()} disabled={upload.isPending} data-testid="button-attach-file">
                        {upload.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Paperclip className="mr-1 h-4 w-4" />}
                        {upload.isPending ? T.detail.uploading : T.detail.attachFile}
                      </Button>
                      <span className="text-xs text-muted-foreground">{T.detail.attachHelp}</span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground" data-testid="attach-unavailable">
                      {T.detail.attachNotAllowed}{" "}
                      <Link href="/documents" className="underline">{T.detail.documentsLink}</Link>
                    </span>
                  )}
                </div>
                <Button type="button" onClick={send} disabled={!draft.trim() || !canReply || comment.isPending} data-testid="button-submit-comment">
                  {comment.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                  {comment.isPending ? T.detail.sending : ticket.status === "resolved" ? T.detail.sendAndReopen : T.detail.send}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <MetadataPanel ticket={ticket} className="hidden w-72 shrink-0 overflow-auto border-l bg-muted/30 p-6 lg:block" />
      </div>
    </>
  );
}

export function OriginalTicketDetailModal({ ticketId, onClose }: { ticketId: string | null; onClose: () => void }) {
  // Keep the last id while the close animation runs.
  const [shown, setShown] = useState<string | null>(ticketId);
  useEffect(() => { if (ticketId) setShown(ticketId); }, [ticketId]);
  return (
    <Dialog open={!!ticketId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-1rem)] max-w-4xl flex-col gap-0 p-0 sm:w-full" data-testid="ticket-detail-modal">
        {shown ? <DetailBody key={shown} ticketId={shown} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}
