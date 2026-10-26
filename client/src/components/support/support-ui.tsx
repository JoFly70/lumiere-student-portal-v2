/**
 * Shared presentational pieces for the Support Center (student and staff).
 * Uses the student-surface tokens (index.css .student-surface); render inside
 * a StudentSurface.
 */
import React from "react";
import { AlertCircle, CheckCircle2, Clock, Download, FileText, Inbox, Loader2, MessageCircle, RefreshCw, UserRound } from "lucide-react";
import type { SupportAttachment, SupportComment, TicketStatus } from "@shared/support-contract";
import { cn } from "@/lib/utils";
import { buttonClass, cardClass, Pill } from "@/components/student-progress/student-ui";
import {
  absoluteTime,
  formatFileSize,
  nextAction,
  relativeTime,
  studentStatusLabel,
  type NextAction,
} from "./support-presentation";

export function StatusPill({ status, className }: { status: TicketStatus; className?: string }) {
  const tone = status === "waiting_on_student" ? "attn" : status === "resolved" || status === "closed" ? "neutral" : "gold";
  const Icon = status === "waiting_on_student" ? Clock : status === "resolved" || status === "closed" ? CheckCircle2 : MessageCircle;
  return (
    <Pill tone={tone} className={className} icon={<Icon className="h-3 w-3" aria-hidden="true" />} data-testid="status-pill">
      {studentStatusLabel(status)}
    </Pill>
  );
}

/** "Waiting for you" / "With your Lumière advisor" / "Resolved". */
export function NextActionBanner({
  ticket,
  now,
}: {
  ticket: { status: TicketStatus; resolved_at?: string | null; assignee?: { name: string } | null };
  now: Date;
}) {
  const action: NextAction = nextAction(ticket, now);
  const tones = {
    you: "border-student-attn bg-student-attn-soft",
    lumiere: "border-student-gold bg-student-gold-soft",
    done: "border-student-line bg-student-card",
  } as const;
  const Icon = action.tone === "you" ? Clock : action.tone === "lumiere" ? UserRound : CheckCircle2;
  return (
    <div
      className={cn("flex items-start gap-3 rounded-xl border p-4", tones[action.tone])}
      data-testid="status-banner"
      data-tone={action.tone}
    >
      <Icon
        className={cn("mt-0.5 h-5 w-5 shrink-0", action.tone === "you" ? "text-student-attn" : "text-student-gold-ink")}
        aria-hidden="true"
      />
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-semibold text-student-ink" data-testid="next-action-title">{action.title}</p>
        <p className="text-sm leading-relaxed text-student-muted" data-testid="next-action-detail">{action.detail}</p>
      </div>
    </div>
  );
}

export function Timestamp({ iso, now, className }: { iso: string; now: Date; className?: string }) {
  const abs = absoluteTime(iso);
  return (
    <time dateTime={iso} title={abs} className={cn("text-xs text-student-muted", className)}>
      {relativeTime(iso, now)}
    </time>
  );
}

export function MessageBubble({
  comment,
  now,
  isFirst,
  attachments = [],
  onDownload,
}: {
  comment: Pick<SupportComment, "id" | "author_name" | "author_kind" | "content" | "created_at">;
  now: Date;
  isFirst?: boolean;
  attachments?: readonly SupportAttachment[];
  onDownload?: (a: SupportAttachment) => void;
}) {
  const mine = comment.author_kind === "student";
  return (
    <li className={cn("flex", mine ? "justify-end" : "justify-start")} data-testid={mine ? "message-student" : "message-advisor"}>
      <article
        className={cn(
          "max-w-[92%] space-y-2 rounded-2xl border p-4 sm:max-w-[80%]",
          mine ? "border-student-line bg-student-card" : "border-student-gold bg-student-gold-soft",
        )}
        aria-label={`${mine ? "You" : "Lumière advisor"}, ${absoluteTime(comment.created_at)}`}
      >
        <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-student-ink">
            {mine ? "You" : comment.author_name}
          </span>
          {!mine && <span className="text-xs font-medium text-student-gold-ink">Lumière advisor</span>}
          {isFirst && <span className="text-xs text-student-muted">Original request</span>}
          <Timestamp iso={comment.created_at} now={now} />
        </header>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-student-ink">{comment.content}</p>
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Attachments on this message">
            {attachments.map((a) => (
              <li key={a.id}><AttachmentChip attachment={a} onDownload={onDownload} /></li>
            ))}
          </ul>
        )}
      </article>
    </li>
  );
}

export function AttachmentChip({
  attachment,
  onDownload,
  busy,
}: {
  attachment: Pick<SupportAttachment, "id" | "file_name" | "file_size">;
  onDownload?: (a: any) => void;
  busy?: boolean;
}) {
  const body = (
    <>
      <FileText className="h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />
      <span className="min-w-0 truncate">{attachment.file_name}</span>
      <span className="shrink-0 text-xs text-student-muted">{formatFileSize(attachment.file_size)}</span>
      {onDownload && (busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4 shrink-0" aria-hidden="true" />)}
    </>
  );
  const cls = "inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-lg border border-student-line-strong bg-student-card px-3 text-sm text-student-ink";
  return onDownload ? (
    <button
      type="button"
      className={cn(cls, "hover:bg-student-gold-soft disabled:opacity-60")}
      onClick={() => onDownload(attachment)}
      disabled={busy}
      aria-label={`Download ${attachment.file_name}, ${formatFileSize(attachment.file_size)}`}
      data-testid="attachment-chip"
    >
      {body}
    </button>
  ) : (
    <span className={cls} data-testid="attachment-chip">{body}</span>
  );
}

export function SupportEmptyState({
  title,
  children,
  action,
  testId = "support-empty",
  icon,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  testId?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className={cn(cardClass, "flex flex-col items-center gap-3 py-10 text-center")} data-testid={testId}>
      {icon ?? <Inbox className="h-8 w-8 text-student-gold-ink" aria-hidden="true" />}
      <h3 className="font-serif text-xl tracking-tight text-student-ink">{title}</h3>
      {children && <div className="max-w-md text-sm leading-relaxed text-student-muted">{children}</div>}
      {action}
    </div>
  );
}

export function SupportLoading({ label = "Loading your requests" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3" data-testid="support-loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl border border-student-line bg-student-card" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function SupportError({
  title = "Support is temporarily unavailable",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className={cn(cardClass, "space-y-3 border-student-attn")} data-testid="support-error">
      <AlertCircle className="h-6 w-6 text-student-attn" aria-hidden="true" />
      <h3 className="font-serif text-xl tracking-tight text-student-ink">{title}</h3>
      <p className="text-sm leading-relaxed text-student-muted">
        {message && message !== title ? `${message} ` : ""}Nothing you wrote has been lost. Please try again in a moment.
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={buttonClass.outline} data-testid="button-retry">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again
        </button>
      )}
    </div>
  );
}
