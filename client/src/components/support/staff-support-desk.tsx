/**
 * S08 staff support desk: the staff mode of the /support route.
 * One focused queue + conversation workspace for admin, staff and coach.
 * Server decisions (permissions, allowed statuses) are authoritative; this
 * component only reflects them and shows server errors plainly.
 *
 * S10 staff pass: Lumière look (shared tokens, staff primitives). The KPI tiles
 * are the queue filters (pressed state + "Showing"), every ticket card says who is
 * waiting, for how long and who owns it, and status words/colours come from the
 * one student status vocabulary (SUPPORT_STATUS_LABEL + StatusPill).
 */
import { isElectiveChangeSubject } from "@/lib/elective-change";
import { STAGE_LABEL, parseStageNote } from "@/lib/elective-stage";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Download, Inbox, Loader2, Lock, MessageSquare, Paperclip, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import {
  SUPPORT_TOPIC_INFO,
  type SupportComment,
  type SupportPerson,
  type SupportStatsResponse,
  type SupportTicketDetail,
  type SupportTicketSummary,
  type TicketPriority,
  type TicketStatus,
  staffStatusLabel,
  topicForTicket,
} from "@shared/support-contract";
import {
  STAFF_QUEUES,
  assigneeSelectValue,
  orderStaffQueue,
  overdueByLabel,
  staffQueueFilters as queueFilters,
  type StaffQueueKey as QueueKey,
  staffRowAge,
  ticketStatusKey,
} from "./support-presentation";
import {
  useAttachmentDownload,
  useCreateComment,
  useSupportStaffDirectory,
  useTicket,
  useTicketStats,
  useTickets,
  useUpdateTicket,
  useUploadTicketAttachment,
} from "@/hooks/use-tickets";
import {
  KpiTile,
  StaffAvatar,
  StaffCard,
  StaffEmpty,
  StaffNotice,
  StaffPage,
  StaffPageHeader,
  staffBtn,
  staffField,
  staffLabel,
} from "@/components/staff/staff-ui";
import { cn } from "@/lib/utils";
import { TonePill } from "@/components/admin/control/owner-ui";
import type { Tone } from "@/lib/owner-presentation";
import { supportSearchWithStudent, supportSearchWithTicket, supportStudentFromSearch, supportTicketFromSearch } from "./support-navigation";

// ---------------------------------------------------------------------------
// Local presentation
// ---------------------------------------------------------------------------

// Staff wording comes from the one shared map (shared/support-contract.ts); colours from the student status language.
const STATUS_LABEL: Record<TicketStatus, string> = {
  open: staffStatusLabel("open"),
  in_progress: staffStatusLabel("in_progress"),
  waiting_on_student: staffStatusLabel("waiting_on_student"),
  resolved: staffStatusLabel("resolved"),
  closed: staffStatusLabel("closed"),
};

const PRIORITY_LABEL: Record<TicketPriority, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };

/**
 * One restrained pill family (the Control Center's TonePill): "New" is the single gold accent, working states
 * are neutral, resolved is a quiet green, and red is kept for "Overdue" only.
 */
const STATUS_TONE: Record<TicketStatus, Tone> = { open: "gold", in_progress: "neutral", waiting_on_student: "neutral", resolved: "ok", closed: "neutral" };

function TicketStatusPill({ status, testId }: { status: TicketStatus; testId?: string }) {
  return <TonePill tone={STATUS_TONE[status]} testId={testId}><span data-status={ticketStatusKey(status)}>{STATUS_LABEL[status]}</span></TonePill>;
}

function PriorityPill({ priority, always }: { priority: TicketPriority; always?: boolean }) {
  if (priority === "urgent") return <TonePill tone="attention" dot={false}><AlertTriangle className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden="true" />Urgent</TonePill>;
  if (priority === "high") return <TonePill tone="neutral" dot={false}>High priority</TonePill>;
  return always ? <TonePill tone="neutral" dot={false}>{PRIORITY_LABEL[priority]} priority</TonePill> : null;
}

function OverduePill({ testId }: { testId?: string }) {
  return <TonePill tone="urgent" testId={testId}>Overdue</TonePill>;
}

function age(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : formatDistanceToNowStrict(t, { addSuffix: false });
}

function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object" && "error" in e && typeof (e as any).error === "string") return (e as any).error;
  return "Something went wrong. Please try again.";
}

const ELECTIVE_STAFF_HINT = "Approve only after the awarding school accepts the substitute; apply by publishing a new roadmap version from the student's High school pathway (old version and progress are preserved).";
const QUEUE_LABEL = Object.fromEntries(STAFF_QUEUES.map((q) => [q.key, q.label])) as Record<QueueKey, string>;

const EMPTY_COPY: Record<QueueKey, { title: string; body: string }> = {
  needs: { title: "You are all caught up", body: "No request is waiting on Lumière right now." },
  waiting: { title: "Nothing is waiting on a student", body: "Requests you have answered and are waiting on a student for appear here." },
  overdue: { title: "Nothing is overdue", body: "Every request waiting on Lumière is inside its response target." },
  mine: { title: "Nothing is assigned to you", body: "Requests assigned to you appear here." },
  unassigned: { title: "Every open request has an advisor", body: "Requests waiting on Lumière with nobody assigned appear here." },
  resolved: { title: "No resolved requests yet", body: "Resolved and closed requests appear here." },
  all: { title: "No requests yet", body: "Student requests appear here as they arrive." },
};

// ---------------------------------------------------------------------------
// KPI tiles = queue filters
// ---------------------------------------------------------------------------

const TILES: { queue: QueueKey; label: string; hint: string; tone?: "urgent" | "attention"; pick: (s: SupportStatsResponse["stats"]) => number }[] = [
  { queue: "needs", label: "Needs response", hint: "Waiting on Lumière", pick: (s) => s.awaitingStaff },
  { queue: "overdue", label: "Overdue", hint: "Past the response target", tone: "urgent", pick: (s) => s.overdue },
  { queue: "unassigned", label: "Unassigned", hint: "No advisor yet", pick: (s) => s.unassigned },
  { queue: "waiting", label: "Waiting on student", hint: "Ball is with the student", pick: (s) => s.awaitingStudent },
];

function StatsStrip({ stats, active, onPick }: { stats?: SupportStatsResponse["stats"]; active: QueueKey; onPick: (q: QueueKey) => void }) {
  return (
    <div role="group" aria-label="Queue summary. Select a tile to filter the list." className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="staff-stats">
      {TILES.map((t) => (
        <KpiTile
          key={t.queue}
          label={t.label}
          value={stats ? t.pick(stats) : "–"}
          hint={t.hint}
          tone={t.tone}
          pressed={active === t.queue}
          onClick={() => onPick(t.queue)}
          testId={`tile-${t.queue}`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticket list
// ---------------------------------------------------------------------------

export function TicketRow({ ticket, selected, onSelect }: { ticket: SupportTicketSummary; selected: boolean; onSelect: () => void }) {
  const topic = SUPPORT_TOPIC_INFO[ticket.topic ?? topicForTicket(null, ticket.category)];
  const now = new Date();
  const overdue = !!ticket.is_overdue;
  const needsOwner = !ticket.assignee && ticket.awaiting === "staff";
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-testid="staff-ticket-row"
        data-ticket-id={ticket.id}
        className={cn(
          "relative w-full overflow-hidden rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink",
          selected ? "border-student-gold bg-student-gold-soft/60 shadow-[0_1px_2px_hsl(var(--s-ink)/0.05)]" : "border-student-line bg-student-card hover:border-student-line-strong hover:bg-student-gold-soft/30",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-semibold text-student-ink">{ticket.reporter_name}</span>
          <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs", overdue ? "font-medium text-st-urgent" : "text-student-muted")}>
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {staffRowAge(ticket, now)}
          </span>
        </div>
        <div className="mt-1 line-clamp-2 text-sm leading-snug text-student-ink">{ticket.subject}</div>
        <div className="mt-1 text-xs text-student-muted">{topic.label} · <span className="font-mono">{ticket.ticket_number}</span></div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-student-line pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <TicketStatusPill status={ticket.status} />
            {overdue && <OverduePill testId="overdue-flag" />}
            <PriorityPill priority={ticket.priority} />
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs">
            {ticket.assignee ? (
              <>
                <StaffAvatar name={ticket.assignee.name} size="sm" />
                <span className="min-w-0 truncate text-student-muted">Assigned: {ticket.assignee.name}</span>
              </>
            ) : (
              <>
                <StaffAvatar name="?" size="sm" muted />
                <span className={cn(needsOwner ? "font-medium text-student-gold-ink" : "text-student-muted")}>Unassigned</span>
              </>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

const SEGMENT = "inline-flex min-h-9 items-center gap-1.5 rounded-md px-4 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-student-gold-ink";
const SEGMENT_ON = "bg-student-card text-student-ink shadow-[0_1px_2px_hsl(var(--s-ink)/0.08)] ring-1 ring-student-line-strong";
const SEGMENT_OFF = "text-student-muted hover:text-student-ink";

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

function CommentBubble({ comment }: { comment: SupportComment }) {
  if (comment.is_internal) {
    const stage = parseStageNote(comment.content);
    return (
      <li data-testid="internal-note" className="rounded-xl border border-dashed border-student-line-strong bg-student-bg/70 px-4 py-3">
        <div className="mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-student-muted">
          <span className="inline-flex items-center gap-1.5 font-semibold text-student-ink">
            <Lock className="h-3.5 w-3.5 text-student-gold-ink" aria-hidden="true" />
            Internal note
          </span>
          <span>· not visible to the student · {comment.author_name} · {age(comment.created_at)} ago</span>
        </div>
        {stage ? (
          <p className="text-sm leading-relaxed text-student-ink" data-testid="elective-stage-note"><span className="font-semibold">Elective stage: {STAGE_LABEL[stage.stage]}</span>{stage.reason ? <span className="block whitespace-pre-wrap">{stage.reason}</span> : null}</p>
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-student-ink">{comment.content}</p>
        )}
      </li>
    );
  }
  const staff = comment.author_kind === "staff";
  return (
    <li className={cn("flex gap-3", staff && "flex-row-reverse")} data-testid={staff ? "staff-message" : "student-message"}>
      <StaffAvatar name={comment.author_name} muted={!staff} />
      <div className={cn("min-w-0 max-w-[92%] rounded-2xl border p-4", staff ? "border-student-gold/60 bg-student-gold-soft/60" : "border-student-line bg-student-card")}>
        <div className="mb-1 text-xs text-student-muted">
          <span className="font-semibold text-student-ink">{comment.author_name}</span> · {staff ? "Lumière team" : "Student"} · {age(comment.created_at)} ago
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-student-ink">{comment.content}</p>
      </div>
    </li>
  );
}

/** One plain sentence: who is waiting, how long, and whether the target is missed. */
function WaitingBanner({ ticket }: { ticket: SupportTicketDetail }) {
  const now = new Date();
  const over = overdueByLabel(ticket, now);
  if (ticket.awaiting === "staff") {
    return (
      <StaffNotice
        tone={over ? "urgent" : "gold"}
        icon={<Clock className="h-4 w-4" />}
        role="status"
        testId="waiting-banner"
      >
        <p className="font-medium">{over ? "Overdue" : "Waiting on Lumière"} · {staffRowAge(ticket, now)}</p>
        <p className="text-student-muted">
          {over ? `${over}. ` : ""}{ticket.assignee ? `Owner: ${ticket.assignee.name}.` : "Nobody owns this request yet. Assign an advisor."}
        </p>
      </StaffNotice>
    );
  }
  if (ticket.awaiting === "student") {
    return (
      <StaffNotice tone="info" icon={<Clock className="h-4 w-4" />} testId="waiting-banner">
        <p className="font-medium">Waiting on the student · {staffRowAge(ticket, now)}</p>
        <p className="text-student-muted">No action is needed from Lumière until the student replies.</p>
      </StaffNotice>
    );
  }
  return (
    <StaffNotice tone="success" testId="waiting-banner">
      <p className="font-medium">{staffRowAge(ticket, now)}</p>
    </StaffNotice>
  );
}

function TicketDetailPane({ ticketId, staff, onBack }: { ticketId: string; staff: readonly SupportPerson[]; onBack: () => void }) {
  const { data, isLoading, error } = useTicket(ticketId);
  const ticket = (data as { ticket?: SupportTicketDetail } | undefined)?.ticket;
  const { user } = useAuth();
  const update = useUpdateTicket(ticketId);
  const createComment = useCreateComment(ticketId);
  const download = useAttachmentDownload(ticketId);
  const upload = useUploadTicketAttachment(ticketId);

  const [mode, setMode] = useState<"public" | "internal">("public");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState("");
  const [msg, setMsg] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(""); setFiles([]); setResolving(false); setResolution(""); setMsg(null); setMode("public");
  }, [ticketId]);

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-student-muted" aria-label="Loading ticket" /></div>;
  }
  if (error || !ticket) {
    return (
      <StaffNotice tone="urgent" role="alert" action={<Button variant="outline" size="sm" className={staffBtn.outline} onClick={onBack}>Back to queue</Button>}>
        {error ? errorText(error) : "This ticket is not available."}
      </StaffNotice>
    );
  }

  const perms = ticket.permissions;
  const busy = update.isPending || createComment.isPending || upload.isPending;
  const topic = SUPPORT_TOPIC_INFO[ticket.topic ?? topicForTicket(null, ticket.category)];
  const closedTicket = ticket.status === "closed";

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "ok", text: ok });
      return true;
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
      return false;
    }
  };

  const changeStatus = (value: string) => {
    if (value === ticket.status) return;
    if (value === "resolved") { setResolving(true); return; }
    void run(() => update.mutateAsync({ status: value as TicketStatus }), `Status changed to ${STATUS_LABEL[value as TicketStatus]}.`);
  };

  const confirmResolve = async () => {
    const ok = await run(() => update.mutateAsync({ status: "resolved", resolutionNotes: resolution.trim() }), "Ticket resolved. The student sees your resolution note.");
    if (ok) { setResolving(false); setResolution(""); }
  };

  const sendReply = async (nextStatus?: TicketStatus) => {
    const content = text.trim();
    if (!content) return;
    const internal = mode === "internal";
    setMsg(null);
    try {
      const res = (await createComment.mutateAsync({ content, isInternal: internal, ...(nextStatus && !internal ? { nextStatus } : {}) })) as { comment?: { id: string } };
      let failedFiles = 0;
      for (const f of files) {
        try { await upload.mutateAsync({ file: f, commentId: res?.comment?.id }); } catch { failedFiles++; }
      }
      setText(""); setFiles([]);
      setMsg(failedFiles
        ? { kind: "error", text: `Message sent, but ${failedFiles} attachment${failedFiles > 1 ? "s" : ""} could not be uploaded.` }
        : { kind: "ok", text: internal ? "Internal note saved. The student cannot see it." : "Reply sent to the student." });
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    }
  };

  const openDownload = async (attachmentId: string) => {
    setMsg(null);
    try {
      const r = (await download.mutateAsync(attachmentId));
      window.open(r.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    }
  };

  const statusOptions = [ticket.status, ...perms.allowed_statuses.filter((s) => s !== ticket.status)];
  const comments = ticket.ticket_comments ?? [];
  const attachments = ticket.ticket_attachments ?? [];
  const canResolve = perms.allowed_statuses.includes("resolved");
  const canWait = perms.allowed_statuses.includes("waiting_on_student");

  return (
    <article className="space-y-5" data-testid="staff-ticket-detail" aria-label={`Ticket ${ticket.ticket_number}`}>
      <div className="space-y-2">
        <Button variant="ghost" size="sm" className={cn(staffBtn.ghost, "-ml-3 lg:hidden")} onClick={onBack} data-testid="staff-back-to-queue">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to queue
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-student-muted">{ticket.ticket_number}</span>
          <TicketStatusPill status={ticket.status} testId="detail-status" />
          <PriorityPill priority={ticket.priority} always />
          {ticket.is_overdue && <OverduePill />}
          {isElectiveChangeSubject(ticket.subject) && <TonePill tone="neutral" dot={false} testId="pill-elective-change">Elective change</TonePill>}
        </div>
        <h2 tabIndex={-1} data-testid="staff-ticket-title" className="font-serif text-2xl leading-snug tracking-tight text-student-ink focus-visible:outline-none">{ticket.subject}</h2>
        <p className="text-sm text-student-muted">
          <span className="font-medium text-student-ink">{ticket.reporter_name}</span>{ticket.reporter_email ? ` · ${ticket.reporter_email}` : ""} · {topic.label} · opened {age(ticket.created_at)} ago
        </p>
        {user?.role === "admin" && ticket.student_id ? (
          <Link
            href={`/admin/students/${encodeURIComponent(ticket.student_id)}`}
            className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-student-gold-ink underline-offset-4 hover:underline"
            data-testid="link-ticket-student-workspace"
          >
            Open student record <ArrowLeft className="h-4 w-4 rotate-180" aria-hidden="true" />
          </Link>
        ) : null}
        {isElectiveChangeSubject(ticket.subject) && (
          <p className="rounded-lg border border-student-line-strong bg-student-card px-3 py-2 text-sm text-student-ink" data-testid="elective-change-hint">
            {ELECTIVE_STAFF_HINT}
            {user?.role === "admin" ? (
              <>
                {" "}
                <Link href={`/admin/elective-requests?ticket=${encodeURIComponent(ticket.id)}`} className="font-semibold text-student-gold-ink underline underline-offset-4" data-testid="link-elective-requests">
                  Decide in Elective requests
                </Link>
              </>
            ) : null}
            {user?.role === "admin" && ticket.student_id ? (
              <>
                {" · "}
                <Link href={`/admin/students/${encodeURIComponent(ticket.student_id)}/high-school`} className="font-semibold text-student-gold-ink underline underline-offset-4" data-testid="link-elective-high-school">
                  Open High school pathway
                </Link>
              </>
            ) : null}
          </p>
        )}
        {ticket.context && (
          <p className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-student-line-strong bg-student-card px-2.5 py-1.5 text-xs" data-testid="academic-context">
            <span className="font-semibold text-student-ink">Academic context</span>
            <span>{ticket.context.code ? `${ticket.context.code} · ` : ""}{ticket.context.title}</span>
            <span className="text-student-muted">(plan v{ticket.context.planVersion}, verified from the student's roadmap)</span>
          </p>
        )}
      </div>

      <WaitingBanner ticket={ticket} />

      <section aria-label="Ticket controls" className="grid gap-3 rounded-xl border border-student-line bg-student-bg/60 p-3 sm:grid-cols-3">
        <label className="space-y-1.5">
          <span className={staffLabel}>Status</span>
          <select className={staffField} value={ticket.status} disabled={busy || perms.allowed_statuses.length === 0} onChange={(e) => changeStatus(e.target.value)}>
            {statusOptions.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className={staffLabel}>Assigned to</span>
          {perms.can_assign ? (
            <select
              className={staffField}
              value={assigneeSelectValue(ticket)}
              disabled={busy}
              onChange={(e) => void run(() => update.mutateAsync({ assignedTo: e.target.value || null }), e.target.value ? "Ticket reassigned." : "Ticket unassigned.")}
            >
              <option value="">Unassigned</option>
              {staff.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
              {ticket.assignee && !staff.some((p) => p.id === ticket.assignee?.id) && (
                <option value={ticket.assignee.id}>{ticket.assignee.name}</option>
              )}
            </select>
          ) : (
            <div className="flex min-h-10 items-center gap-2 text-sm font-normal text-student-ink">
              {ticket.assignee ? <><StaffAvatar name={ticket.assignee.name} size="sm" />{ticket.assignee.name}</> : "Unassigned"}
            </div>
          )}
        </label>
        <label className="space-y-1.5">
          <span className={staffLabel}>Priority</span>
          {perms.can_change_priority ? (
            <select className={staffField} value={ticket.priority} disabled={busy} onChange={(e) => void run(() => update.mutateAsync({ priority: e.target.value as TicketPriority }), "Priority updated.")}>
              {(["low", "medium", "high", "urgent"] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          ) : (
            <div className="flex min-h-10 items-center text-sm font-normal text-student-ink">{PRIORITY_LABEL[ticket.priority]}</div>
          )}
        </label>
        {resolving && (
          <div className="space-y-2 sm:col-span-3" data-testid="resolve-form">
            <label htmlFor="resolution-note" className={staffLabel}>Resolution note (required, shown to the student)</label>
            <Textarea id="resolution-note" rows={3} className={cn(staffField, "min-h-[88px] py-2")} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="What was done, and what the student should do next if anything." />
            <div className="flex gap-2">
              <Button size="sm" className={staffBtn.seal} onClick={confirmResolve} disabled={!resolution.trim() || busy}>Resolve ticket</Button>
              <Button size="sm" variant="outline" className={staffBtn.outline} onClick={() => setResolving(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </section>

      {ticket.resolution_notes && (
        <section className="rounded-xl border border-l-[3px] border-student-line border-l-st-applied bg-st-applied-soft/40 px-4 py-3 text-sm text-student-ink" aria-label="Resolution">
          <div className="text-xs font-semibold uppercase tracking-[0.1em] text-st-applied">Resolution shown to the student</div>
          <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{ticket.resolution_notes}</p>
        </section>
      )}

      <section aria-label="Conversation">
        <h3 className="mb-3 font-serif text-lg tracking-tight text-student-ink">Conversation <span className="text-sm text-student-muted">({comments.length})</span></h3>
        <ul className="space-y-3">
          {comments.map((c) => <CommentBubble key={c.id} comment={c} />)}
        </ul>
        {attachments.length > 0 && (
          <div className="mt-4" data-testid="staff-attachments">
            <h4 className={cn(staffLabel, "mb-1.5")}>Attachments</h4>
            <ul className="space-y-1.5">
              {attachments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-student-line bg-student-card px-3 py-1.5 text-sm text-student-ink">
                  <span className="min-w-0 truncate"><Paperclip className="mr-1.5 inline h-3.5 w-3.5 text-student-gold-ink" aria-hidden="true" />{a.file_name}</span>
                  <Button variant="ghost" size="sm" className={staffBtn.ghost} onClick={() => openDownload(a.id)} aria-label={`Download ${a.file_name}`}>
                    <Download className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {msg && (msg.kind === "error" ? (
        <StaffNotice tone="urgent" role="alert" testId="desk-message">{msg.text}</StaffNotice>
      ) : (
        <p role="status" data-testid="desk-message" className="flex items-center gap-2 text-sm text-student-muted">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-st-applied" aria-hidden="true" />
          {msg.text}
        </p>
      ))}

      {perms.can_reply && !closedTicket ? (
        <section aria-label="Reply" data-mode={mode} className={cn("space-y-3 rounded-2xl border p-4 transition-colors", mode === "internal" ? "border-dashed border-student-line-strong bg-student-bg/70" : "border-student-line bg-student-card")}>
          <div role="group" aria-label="Message type" className="inline-flex rounded-lg border border-student-line bg-student-bg p-1 text-sm">
            <button type="button" aria-pressed={mode === "public"} onClick={() => setMode("public")} className={cn(SEGMENT, mode === "public" ? SEGMENT_ON : SEGMENT_OFF)}>Public reply</button>
            {perms.can_add_internal_note && (
              <button type="button" aria-pressed={mode === "internal"} onClick={() => setMode("internal")} className={cn(SEGMENT, mode === "internal" ? SEGMENT_ON : SEGMENT_OFF)}><Lock className="h-3.5 w-3.5" aria-hidden="true" />Internal note</button>
            )}
          </div>
          {mode === "internal" ? (
            <p className="flex items-center gap-1.5 text-xs text-student-muted"><Lock className="h-3.5 w-3.5 text-student-gold-ink" aria-hidden="true" /> Internal note · only the Lumière team sees it. It never changes the status.</p>
          ) : (
            <p className="text-xs leading-relaxed text-student-muted">The student reads this. Use plain, student-safe language: no internal jargon, no other students' details, no promises about credit acceptance or outcomes you cannot guarantee.</p>
          )}
          <label htmlFor="staff-composer" className="sr-only">{mode === "internal" ? "Internal note" : "Reply to student"}</label>
          <Textarea id="staff-composer" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "internal" ? "Write a note for the team…" : "Write your reply to the student…"} className={cn(staffField, "min-h-[112px] py-2.5")} />
          {perms.can_attach && mode === "public" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input ref={fileRef} type="file" className="sr-only" id="staff-file" aria-label="Attach files" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.doc,.docx" onChange={(e) => { setFiles((p) => [...p, ...Array.from(e.target.files ?? [])]); if (fileRef.current) fileRef.current.value = ""; }} />
              <Button type="button" variant="outline" size="sm" className={staffBtn.outline} onClick={() => fileRef.current?.click()}><Paperclip className="h-4 w-4" aria-hidden="true" />Attach file</Button>
              {files.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full border border-student-line-strong px-2.5 py-1 text-xs text-student-ink">{f.name} <button type="button" className="ml-1 inline-flex min-h-6 items-center underline" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>remove</button></span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {mode === "internal" ? (
              <Button className={staffBtn.seal} onClick={() => sendReply()} disabled={!text.trim() || busy}>Add internal note</Button>
            ) : (
              <>
                {canWait && <Button className={staffBtn.primary} onClick={() => sendReply("waiting_on_student")} disabled={!text.trim() || busy}>Reply &amp; wait for student</Button>}
                <Button variant={canWait ? "outline" : "default"} className={canWait ? staffBtn.outline : staffBtn.primary} onClick={() => sendReply()} disabled={!text.trim() || busy}>Reply</Button>
                {canResolve && <Button variant="outline" className={staffBtn.outline} onClick={() => sendReply("resolved")} disabled={!text.trim() || busy}>Reply &amp; resolve</Button>}
              </>
            )}
            {busy && <Loader2 className="h-4 w-4 animate-spin self-center text-student-muted" aria-label="Working" />}
          </div>
          {mode === "public" && canResolve && <p className="text-xs text-student-muted">“Reply &amp; resolve” uses your reply as the resolution note the student sees.</p>}
        </section>
      ) : (
        <p className="text-sm text-student-muted">{closedTicket ? "This ticket is closed." : "You can view this ticket but not reply to it."}</p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Desk
// ---------------------------------------------------------------------------

const TILE_QUEUES = new Set<QueueKey>(TILES.map((t) => t.queue));
const MORE_VIEWS = STAFF_QUEUES.filter((q) => !TILE_QUEUES.has(q.key));

const isTwoPane = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(min-width: 1024px)").matches;

export function StaffSupportDesk() {
  const { user } = useAuth();
  const isManager = user?.role === "admin" || user?.role === "staff";
  const [queue, setQueue] = useState<QueueKey>("needs");
  // ?search= deep link (e.g. the Control Center's "Elective change requests" tile) pre-fills the search.
  const initialSearch = typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("search") ?? "").trim().slice(0, 100);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : supportTicketFromSearch(window.location.search),
  );
  const [studentFilter, setStudentFilter] = useState<string | null>(() =>
    typeof window === "undefined" ? null : supportStudentFromSearch(window.location.search),
  );
  const activeStudentFilter = user?.role === "admin" ? studentFilter : null;
  const detailRef = useRef<HTMLElement>(null);
  const lastSelected = useRef<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Single-pane (phone, tablet): move focus into the conversation when a ticket opens, and back to its row on return.
  useEffect(() => {
    if (!selectedId || isTwoPane()) return;
    const t = setTimeout(() => detailRef.current?.querySelector<HTMLElement>('[data-testid="staff-ticket-title"]')?.focus(), 80);
    return () => clearTimeout(t);
  }, [selectedId]);

  const filters = useMemo(() => ({
    ...queueFilters(queue),
    ...(search ? { search } : {}),
    ...(activeStudentFilter ? { studentId: activeStudentFilter } : {}),
    limit: 50,
  }), [queue, search, activeStudentFilter]);
  const list = useTickets(filters);
  const stats = useTicketStats(true);
  const directory = useSupportStaffDirectory(isManager);

  const tickets = orderStaffQueue(((list.data as { tickets?: SupportTicketSummary[] } | undefined)?.tickets ?? []) as SupportTicketSummary[]);
  const total = (list.data as { pagination?: { total: number } } | undefined)?.pagination?.total ?? tickets.length;
  const staff = ((directory.data as { staff?: SupportPerson[] } | undefined)?.staff ?? []) as SupportPerson[];

  const updateTicketSearch = (id: string | null) => {
    if (typeof window === "undefined") return;
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${supportSearchWithTicket(window.location.search, id)}${window.location.hash}`,
    );
  };
  const clearStudentFilter = () => {
    setStudentFilter(null);
    if (typeof window !== "undefined") {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${supportSearchWithStudent(window.location.search, null)}${window.location.hash}`,
      );
    }
  };
  const pick = (q: QueueKey) => { setQueue(q); setSelectedId(null); updateTicketSearch(null); };
  const select = (id: string) => { lastSelected.current = id; setSelectedId(id); updateTicketSearch(id); };
  const back = () => {
    const id = selectedId ?? lastSelected.current;
    setSelectedId(null);
    updateTicketSearch(null);
    if (id) setTimeout(() => document.querySelector<HTMLElement>(`[data-ticket-id="${CSS.escape(id)}"]`)?.focus(), 80);
  };
  const empty = EMPTY_COPY[queue];

  return (
    <StaffPage width="wide" testId="staff-support-desk">
      <StaffPageHeader
        eyebrow="Staff Portal"
        title="Support desk"
        description={isManager
          ? "Every student request, who owns it and how long it has waited. Select a tile to filter the queue."
          : "Requests assigned to you, and how long each has waited."}
      />

      {activeStudentFilter ? (
        <StaffNotice
          tone="info"
          action={<Button type="button" size="sm" variant="outline" className={staffBtn.outline} onClick={clearStudentFilter}>Show all students</Button>}
        >
          This queue is filtered to one student's support requests.
        </StaffNotice>
      ) : (
        <div className={cn(selectedId && "hidden lg:block")}>
          <StatsStrip stats={(stats.data as SupportStatsResponse | undefined)?.stats} active={queue} onPick={pick} />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
        <section className={cn(selectedId && "hidden lg:block", "min-w-0 space-y-3")} aria-label="Queue">
          <div className="flex flex-wrap items-center justify-between gap-2" data-testid="queue-header">
            <div className="min-w-0">
              <h2 className="font-serif text-xl tracking-tight text-student-ink" data-testid="queue-title">{QUEUE_LABEL[queue]}</h2>
              <p className="text-xs text-student-muted" aria-live="polite" data-testid="queue-count">
                {list.isLoading ? "Loading…" : `${total} ticket${total === 1 ? "" : "s"}${search ? ` matching “${search}”` : ""}`}
              </p>
            </div>
            {queue !== "needs" && (
              <Button type="button" variant="ghost" size="sm" className={staffBtn.ghost} onClick={() => pick("needs")}>
                <X className="h-4 w-4" aria-hidden="true" />Clear filter
              </Button>
            )}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-student-muted" aria-hidden="true" />
            <label htmlFor="staff-search" className="sr-only">Search tickets by subject</label>
            <Input id="staff-search" className={cn(staffField, "pl-9")} placeholder="Search by subject…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
          <div role="group" aria-label="More views" className="flex flex-wrap gap-1.5" data-testid="more-views">
            {MORE_VIEWS.map((q) => (
              <button
                key={q.key}
                type="button"
                aria-pressed={queue === q.key}
                onClick={() => pick(q.key)}
                className={cn(
                  "min-h-10 rounded-full border px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink",
                  queue === q.key ? "border-student-seal bg-student-seal text-student-seal-ink" : "border-student-line-strong bg-student-card text-student-ink hover:bg-student-gold-soft",
                )}
              >
                {q.label}
              </button>
            ))}
          </div>
          {list.isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-student-muted" aria-label="Loading tickets" /></div>
          ) : list.error ? (
            <StaffNotice tone="urgent" role="alert">{errorText(list.error)}</StaffNotice>
          ) : tickets.length === 0 ? (
            <StaffEmpty icon={<Inbox className="h-8 w-8" />} title={empty.title} testId="queue-empty">{empty.body}</StaffEmpty>
          ) : (
            <ul className="space-y-2.5" data-testid="staff-ticket-list">
              {tickets.map((t) => <TicketRow key={t.id} ticket={t} selected={t.id === selectedId} onSelect={() => select(t.id)} />)}
            </ul>
          )}
        </section>

        <section ref={detailRef} className={cn(selectedId ? "" : "hidden lg:block", "min-w-0")} aria-label="Ticket detail">
          <StaffCard as="div" className="lg:min-h-[420px]">
            {selectedId ? (
              <TicketDetailPane ticketId={selectedId} staff={staff} onBack={back} />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-student-muted">
                <MessageSquare className="h-10 w-10 text-student-gold-ink" aria-hidden="true" />
                <p className="font-serif text-lg tracking-tight text-student-ink">Select a request</p>
                <p className="max-w-xs text-sm">Read the conversation, assign an advisor and reply from here.</p>
              </div>
            )}
          </StaffCard>
        </section>
      </div>
    </StaffPage>
  );
}

export default StaffSupportDesk;
