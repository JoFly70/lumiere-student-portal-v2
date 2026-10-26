/** Student conversation: thread, status, resolution, attachments, reply box. */
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, Paperclip, Send } from "lucide-react";
import type { SupportAttachment } from "@shared/support-contract";
import {
  useAttachmentDownload,
  useCreateComment,
  useTicket,
  useUploadTicketAttachment,
  type Ticket,
} from "@/hooks/use-tickets";
import { cn } from "@/lib/utils";
import { buttonClass, cardClass } from "@/components/student-progress/student-ui";
import {
  AttachmentChip,
  MessageBubble,
  NextActionBanner,
  StatusPill,
  SupportError,
  SupportLoading,
  Timestamp,
} from "./support-ui";
import {
  ATTACHMENT_HELP,
  attachmentError,
  contextLabel,
  publicAttachments,
  publicComments,
  replyState,
  topicLabel,
} from "./support-presentation";

const DESCRIPTION_MAX = 5000;

export function ResolutionCard({ ticket, now }: { ticket: Pick<Ticket, "status" | "resolution_notes" | "resolved_at">; now: Date }) {
  if (ticket.status !== "resolved" && ticket.status !== "closed") return null;
  return (
    <section className={cn(cardClass, "space-y-2 border-student-gold")} aria-labelledby="resolution-title" data-testid="resolution-card">
      <h3 id="resolution-title" className="flex items-center gap-2 font-serif text-lg tracking-tight text-student-ink">
        <CheckCircle2 className="h-5 w-5 text-student-gold-ink" aria-hidden="true" /> How this was resolved
      </h3>
      {ticket.resolution_notes ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-student-ink">{ticket.resolution_notes}</p>
      ) : (
        <p className="text-sm text-student-muted">Your advisor marked this request as complete.</p>
      )}
      {ticket.resolved_at && <p className="text-xs text-student-muted">Resolved <Timestamp iso={ticket.resolved_at} now={now} /></p>}
    </section>
  );
}

export function ReplyComposer({
  ticket,
  now,
  value,
  onChange,
  onSend,
  sending,
  error,
}: {
  ticket: Pick<Ticket, "status" | "resolved_at" | "permissions">;
  now: Date;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending?: boolean;
  error?: string | null;
}) {
  const uid = useId();
  const state = replyState(ticket, ticket.permissions?.can_reply, now);
  const tooLong = value.trim().length > DESCRIPTION_MAX;
  const disabled = !state.canReply || sending;
  return (
    <form
      className={cn(cardClass, "space-y-3")}
      data-testid="composer"
      onSubmit={(e) => { e.preventDefault(); if (!disabled && value.trim() && !tooLong) onSend(); }}
    >
      <label htmlFor={`${uid}-reply`} className="text-sm font-semibold text-student-ink">Your reply</label>
      <textarea
        id={`${uid}-reply`}
        data-testid="input-reply"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!state.canReply}
        rows={4}
        placeholder={state.canReply ? "Write your message to your Lumière advisor" : undefined}
        aria-describedby={`${uid}-note`}
        className="w-full rounded-lg border border-student-line-strong bg-student-card px-3 py-2.5 text-base text-student-ink placeholder:text-student-muted disabled:opacity-60 sm:text-sm"
      />
      <p id={`${uid}-note`} className="text-sm text-student-muted" data-testid="composer-note">
        {state.reason ?? state.note ?? "Your advisor sees your message right away."}
      </p>
      {tooLong && <p role="alert" className="text-sm font-medium text-student-attn">Please keep your message under {DESCRIPTION_MAX} characters.</p>}
      {error && <p role="alert" className="text-sm font-medium text-student-attn" data-testid="reply-error">{error} Your message has not been sent.</p>}
      <div className="flex justify-end">
        <button
          type="submit"
          className={buttonClass.solid}
          disabled={disabled || !value.trim() || tooLong}
          data-testid="button-send-reply"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          {sending ? "Sending…" : ticket.status === "resolved" ? "Send and reopen" : "Send reply"}
        </button>
      </div>
    </form>
  );
}

/** Pure view of one request. No hooks that fetch; safe to render with fixtures. */
export function ConversationThread({
  ticket,
  now,
  headingRef,
  onDownload,
  downloadingId,
  attachSlot,
}: {
  ticket: Ticket;
  now: Date;
  headingRef?: React.Ref<HTMLHeadingElement>;
  onDownload?: (a: SupportAttachment) => void;
  downloadingId?: string | null;
  attachSlot?: React.ReactNode;
}) {
  const comments = publicComments(ticket.ticket_comments);
  const files = publicAttachments(ticket.ticket_attachments, ticket.ticket_comments);
  const ctx = contextLabel(ticket.context);
  return (
    <div className="space-y-5" data-testid="conversation">
      <header className="space-y-2">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="font-serif text-2xl leading-tight tracking-tight text-student-ink [overflow-wrap:anywhere] focus:outline-none sm:text-3xl"
          data-testid="conversation-title"
        >
          {ticket.subject}
        </h2>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-student-muted">
          <StatusPill status={ticket.status} />
          <span>{topicLabel(ticket.topic)}</span>
          <span aria-hidden="true">·</span>
          <span>Opened <Timestamp iso={ticket.created_at} now={now} /></span>
          <span aria-hidden="true">·</span>
          <span className="font-mono" title="Reference number">Ref {ticket.ticket_number}</span>
        </p>
        {ctx && (
          <p className="text-sm text-student-muted" data-testid="conversation-context">
            Related to <span className="font-medium text-student-ink">{ctx}</span>
          </p>
        )}
      </header>

      <NextActionBanner ticket={ticket} now={now} />
      <ResolutionCard ticket={ticket} now={now} />

      <section aria-label="Conversation">
        <ol className="space-y-3" data-testid="thread">
          {comments.map((c, i) => (
            <MessageBubble key={c.id} comment={c} now={now} isFirst={i === 0} />
          ))}
        </ol>
      </section>

      {(files.length > 0 || attachSlot) && (
        <section aria-labelledby="files-title" className="space-y-2" data-testid="attachments">
          <h3 id="files-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-student-gold-ink">Files</h3>
          {files.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {files.map((a) => (
                <li key={a.id} className="max-w-full">
                  <AttachmentChip attachment={a} onDownload={onDownload} busy={downloadingId === a.id} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-student-muted">No files yet.</p>
          )}
          {attachSlot}
        </section>
      )}
    </div>
  );
}

function AttachControl({ ticketId, autoFile }: { ticketId: string; autoFile?: File | null }) {
  const upload = useUploadTicketAttachment(ticketId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const started = useRef(false);

  const run = (file: File) => {
    const err = attachmentError(file);
    if (err) { setError(err); setDone(null); return; }
    setError(null);
    setDone(null);
    upload.mutate({ file }, {
      onSuccess: () => setDone(`${file.name} was added.`),
      onError: (e) => setError(`${e.message} ${file.name} was not added.`),
    });
  };

  useEffect(() => {
    if (autoFile && !started.current) { started.current = true; run(autoFile); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFile]);

  return (
    <div className="space-y-2">
      <input
        ref={fileRef}
        type="file"
        className="sr-only"
        aria-label="Attach a file to this request"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.doc,.docx"
        data-testid="input-attach"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); if (fileRef.current) fileRef.current.value = ""; }}
      />
      <button type="button" className={buttonClass.outline} onClick={() => fileRef.current?.click()} disabled={upload.isPending} data-testid="button-attach">
        {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Paperclip className="h-4 w-4" aria-hidden="true" />}
        {upload.isPending ? "Uploading…" : "Attach a file"}
      </button>
      <p className="text-xs text-student-muted">{ATTACHMENT_HELP}</p>
      <div aria-live="polite">
        {done && <p className="text-sm text-student-ink" data-testid="attach-success">{done}</p>}
        {error && <p role="alert" className="text-sm font-medium text-student-attn" data-testid="attach-error">{error}</p>}
      </div>
    </div>
  );
}

export function StudentConversation({
  ticketId,
  onBack,
  confirmation,
  pendingFile,
}: {
  ticketId: string;
  onBack: () => void;
  /** Set only after the API returned 201 for this ticket. */
  confirmation?: { ticketNumber: string } | null;
  pendingFile?: File | null;
}) {
  const query = useTicket(ticketId);
  const comment = useCreateComment(ticketId);
  const download = useAttachmentDownload(ticketId);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState("");
  const [sentNotice, setSentNotice] = useState("");
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const ticket = query.data?.ticket;
  const now = useMemo(() => new Date(), [query.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setDraft(""); setSentNotice(""); }, [ticketId]);
  useEffect(() => { if (ticket) headingRef.current?.focus(); }, [ticket?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = () => {
    setSentNotice("");
    comment.mutate({ content: draft.trim() }, {
      onSuccess: () => { setDraft(""); setSentNotice("Message sent. Your Lumière advisor will see it right away."); },
    });
  };

  const onDownload = (a: SupportAttachment) => {
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
      onError: (e) => { setDownloadingId(null); setDownloadError(`${e.message} The file could not be opened.`); },
    });
  };

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className={cn(buttonClass.link, "lg:hidden")} data-testid="button-back">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All requests
      </button>

      <div aria-live="polite" role="status" className={cn(!confirmation && !sentNotice && "sr-only")} data-testid="live-region">
        {confirmation && (
          <div className="flex items-start gap-3 rounded-xl border border-student-gold bg-student-gold-soft p-4" data-testid="confirmation">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-student-gold-ink" aria-hidden="true" />
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-student-ink">Lumière has received your request</p>
              <p className="text-sm text-student-muted">Your reference is {confirmation.ticketNumber}. Your advisor will reply in this conversation.</p>
            </div>
          </div>
        )}
        {sentNotice && <p className="rounded-xl border border-student-line bg-student-card p-3 text-sm text-student-ink" data-testid="sent-notice">{sentNotice}</p>}
      </div>

      {query.isLoading ? (
        <SupportLoading label="Loading this conversation" />
      ) : query.isError || !ticket ? (
        <SupportError
          title="We could not open this request"
          message={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => query.refetch()}
        />
      ) : (
        <>
          <ConversationThread
            ticket={ticket}
            now={now}
            headingRef={headingRef}
            onDownload={onDownload}
            downloadingId={downloadingId}
            attachSlot={ticket.permissions?.can_attach ? <AttachControl ticketId={ticket.id} autoFile={pendingFile} /> : undefined}
          />
          {downloadError && <p role="alert" className="text-sm font-medium text-student-attn" data-testid="download-error">{downloadError}</p>}
          <ReplyComposer
            ticket={ticket}
            now={now}
            value={draft}
            onChange={setDraft}
            onSend={send}
            sending={comment.isPending}
            error={comment.isError ? comment.error.message : null}
          />
        </>
      )}
    </div>
  );
}
