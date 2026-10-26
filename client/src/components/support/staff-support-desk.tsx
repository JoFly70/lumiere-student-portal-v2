/**
 * S08 staff support desk: the staff mode of the /support route.
 * One focused queue + conversation workspace for admin, staff and coach.
 * Server decisions (permissions, allowed statuses) are authoritative; this
 * component only reflects them and shows server errors plainly.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, ArrowLeft, Download, EyeOff, Loader2, Lock, MessageSquare, Paperclip, Search } from "lucide-react";
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
import { assigneeSelectValue, staffQueueFilters as queueFilters, type StaffQueueKey as QueueKey, staffRowAge } from "./support-presentation";
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

// ---------------------------------------------------------------------------
// Local presentation (kept local so the desk does not depend on student UI)
// ---------------------------------------------------------------------------

// Staff wording comes from the one shared map (shared/support-contract.ts).
const STATUS_LABEL: Record<TicketStatus, string> = {
  open: staffStatusLabel("open"),
  in_progress: staffStatusLabel("in_progress"),
  waiting_on_student: staffStatusLabel("waiting_on_student"),
  resolved: staffStatusLabel("resolved"),
  closed: staffStatusLabel("closed"),
};

const STATUS_CLASS: Record<TicketStatus, string> = {
  open: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  in_progress: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  waiting_on_student: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200",
  resolved: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  closed: "bg-muted text-muted-foreground",
};

const PRIORITY_LABEL: Record<TicketPriority, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
const PRIORITY_CLASS: Record<TicketPriority, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100",
  high: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  urgent: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

function Pill({ className, children, testId }: { className: string; children: React.ReactNode; testId?: string }) {
  return (
    <span data-testid={testId} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
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

const QUEUES: { key: QueueKey; label: string }[] = [
  { key: "needs", label: "Needs response" },
  { key: "waiting", label: "Waiting on student" },
  { key: "overdue", label: "Overdue" },
  { key: "mine", label: "Mine" },
  { key: "unassigned", label: "Unassigned" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];

// ---------------------------------------------------------------------------
// Stats strip
// ---------------------------------------------------------------------------

function StatsStrip({ stats, active, onPick }: { stats?: SupportStatsResponse["stats"]; active: QueueKey; onPick: (q: QueueKey) => void }) {
  const tiles: { label: string; value: number | undefined; queue: QueueKey; warn?: boolean }[] = [
    { label: "Awaiting staff", value: stats?.awaitingStaff, queue: "needs" },
    { label: "Awaiting student", value: stats?.awaitingStudent, queue: "waiting" },
    { label: "Overdue", value: stats?.overdue, queue: "overdue", warn: true },
    { label: "Unassigned", value: stats?.unassigned, queue: "unassigned" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="staff-stats">
      {tiles.map((t) => (
        <button
          key={t.label}
          type="button"
          onClick={() => onPick(t.queue)}
          aria-pressed={active === t.queue}
          className={`rounded-lg border p-3 text-left transition-colors hover:bg-accent ${active === t.queue ? "border-foreground bg-accent" : "bg-card"} focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring`}
        >
          <div className="text-xs text-muted-foreground">{t.label}</div>
          <div className={`text-2xl font-semibold tabular-nums ${t.warn && (t.value ?? 0) > 0 ? "text-red-700 dark:text-red-400" : ""}`}>
            {t.value ?? "–"}
          </div>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticket list
// ---------------------------------------------------------------------------

export function TicketRow({ ticket, selected, onSelect }: { ticket: SupportTicketSummary; selected: boolean; onSelect: () => void }) {
  const topic = SUPPORT_TOPIC_INFO[ticket.topic ?? topicForTicket(null, ticket.category)];
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-testid="staff-ticket-row"
        className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${selected ? "border-primary bg-accent" : "bg-card"}`}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium text-sm">{ticket.reporter_name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{staffRowAge(ticket, new Date())}</span>
        </div>
        <div className="mt-0.5 line-clamp-2 text-sm">{ticket.subject}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{topic.label}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Pill className={STATUS_CLASS[ticket.status]}>{STATUS_LABEL[ticket.status]}</Pill>
          <Pill className={PRIORITY_CLASS[ticket.priority]}>{PRIORITY_LABEL[ticket.priority]}</Pill>
          {ticket.is_overdue && (
            <Pill className="bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" testId="overdue-flag">
              <AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />
              Overdue
            </Pill>
          )}
          <span className="text-xs text-muted-foreground">
            {ticket.assignee ? `Assigned: ${ticket.assignee.name}` : "Unassigned"}
          </span>
        </div>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

function CommentBubble({ comment }: { comment: SupportComment }) {
  if (comment.is_internal) {
    return (
      <li data-testid="internal-note" className="rounded-lg border-2 border-dashed border-amber-500 bg-amber-50 p-3 dark:border-amber-600 dark:bg-amber-950/40">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          Internal note — not visible to the student
        </div>
        <div className="mb-1 text-xs text-muted-foreground">
          {comment.author_name} · {age(comment.created_at)} ago
        </div>
        <p className="whitespace-pre-wrap text-sm">{comment.content}</p>
      </li>
    );
  }
  const staff = comment.author_kind === "staff";
  return (
    <li className={`rounded-lg border p-3 ${staff ? "bg-primary/5" : "bg-card"}`} data-testid={staff ? "staff-message" : "student-message"}>
      <div className="mb-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{comment.author_name}</span> · {staff ? "Lumière team" : "Student"} · {age(comment.created_at)} ago
      </div>
      <p className="whitespace-pre-wrap text-sm">{comment.content}</p>
    </li>
  );
}

function selectClass() {
  return "h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60";
}

function TicketDetailPane({ ticketId, staff, onBack }: { ticketId: string; staff: readonly SupportPerson[]; onBack: () => void }) {
  const { data, isLoading, error } = useTicket(ticketId);
  const ticket = (data as { ticket?: SupportTicketDetail } | undefined)?.ticket;
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
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading ticket" /></div>;
  }
  if (error || !ticket) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm">
        {error ? errorText(error) : "This ticket is not available."}
        <div className="mt-2"><Button variant="outline" size="sm" onClick={onBack}>Back to queue</Button></div>
      </div>
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
    <article className="space-y-4" data-testid="staff-ticket-detail" aria-label={`Ticket ${ticket.ticket_number}`}>
      <div>
        <Button variant="ghost" size="sm" className="mb-2 -ml-2 lg:hidden" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Queue
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{ticket.ticket_number}</span>
          <Pill className={STATUS_CLASS[ticket.status]}>{STATUS_LABEL[ticket.status]}</Pill>
          <Pill className={PRIORITY_CLASS[ticket.priority]}>{PRIORITY_LABEL[ticket.priority]}</Pill>
          {ticket.is_overdue && <Pill className="bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200">Overdue</Pill>}
        </div>
        <h2 className="mt-1 text-xl font-semibold leading-snug">{ticket.subject}</h2>
        <p className="text-sm text-muted-foreground">
          {ticket.reporter_name}{ticket.reporter_email ? ` · ${ticket.reporter_email}` : ""} · {topic.label} · opened {age(ticket.created_at)} ago
        </p>
        {ticket.context && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border bg-muted px-2 py-1 text-xs" data-testid="academic-context">
            <span className="font-medium">Academic context</span>
            <span>{ticket.context.code ? `${ticket.context.code} · ` : ""}{ticket.context.title}</span>
            <span className="text-muted-foreground">(plan v{ticket.context.planVersion}, verified from the student's roadmap)</span>
          </p>
        )}
      </div>

      <section aria-label="Ticket controls" className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs font-medium">
          Status
          <select className={selectClass()} value={ticket.status} disabled={busy || perms.allowed_statuses.length === 0} onChange={(e) => changeStatus(e.target.value)}>
            {statusOptions.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium">
          Assigned to
          {perms.can_assign ? (
            <select
              className={selectClass()}
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
            <div className="flex h-9 items-center text-sm font-normal">{ticket.assignee ? ticket.assignee.name : "Unassigned"}</div>
          )}
        </label>
        <label className="space-y-1 text-xs font-medium">
          Priority
          {perms.can_change_priority ? (
            <select className={selectClass()} value={ticket.priority} disabled={busy} onChange={(e) => void run(() => update.mutateAsync({ priority: e.target.value as TicketPriority }), "Priority updated.")}>
              {(["low", "medium", "high", "urgent"] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          ) : (
            <div className="flex h-9 items-center text-sm font-normal">{PRIORITY_LABEL[ticket.priority]}</div>
          )}
        </label>
        {resolving && (
          <div className="space-y-2 sm:col-span-3" data-testid="resolve-form">
            <label htmlFor="resolution-note" className="text-xs font-medium">Resolution note (required, shown to the student)</label>
            <Textarea id="resolution-note" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="What was done, and what the student should do next if anything." />
            <div className="flex gap-2">
              <Button size="sm" onClick={confirmResolve} disabled={!resolution.trim() || busy}>Resolve ticket</Button>
              <Button size="sm" variant="outline" onClick={() => setResolving(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </section>

      {ticket.resolution_notes && (
        <section className="rounded-lg border border-green-600/40 bg-green-50 p-3 text-sm dark:bg-green-950/30" aria-label="Resolution">
          <div className="text-xs font-semibold">Resolution shown to the student</div>
          <p className="mt-1 whitespace-pre-wrap">{ticket.resolution_notes}</p>
        </section>
      )}

      <section aria-label="Conversation">
        <h3 className="mb-2 text-sm font-semibold">Conversation ({comments.length})</h3>
        <ul className="space-y-2">
          {comments.map((c) => <CommentBubble key={c.id} comment={c} />)}
        </ul>
        {attachments.length > 0 && (
          <div className="mt-3" data-testid="staff-attachments">
            <h4 className="mb-1 text-xs font-semibold text-muted-foreground">Attachments</h4>
            <ul className="space-y-1">
              {attachments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm">
                  <span className="min-w-0 truncate"><Paperclip className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{a.file_name}</span>
                  <Button variant="ghost" size="sm" onClick={() => openDownload(a.id)} aria-label={`Download ${a.file_name}`}>
                    <Download className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {msg && (
        <div role={msg.kind === "error" ? "alert" : "status"} className={`rounded-md border p-2 text-sm ${msg.kind === "error" ? "border-destructive/50 text-destructive" : "border-green-600/40"}`}>
          {msg.text}
        </div>
      )}

      {perms.can_reply && !closedTicket ? (
        <section aria-label="Reply" className="space-y-2 rounded-lg border p-3">
          <div role="group" aria-label="Message type" className="inline-flex rounded-md border p-0.5 text-sm">
            <button type="button" aria-pressed={mode === "public"} onClick={() => setMode("public")} className={`rounded px-3 py-1 ${mode === "public" ? "bg-foreground text-background" : ""}`}>Public reply</button>
            {perms.can_add_internal_note && (
              <button type="button" aria-pressed={mode === "internal"} onClick={() => setMode("internal")} className={`rounded px-3 py-1 ${mode === "internal" ? "bg-amber-500 text-black" : ""}`}>Internal note</button>
            )}
          </div>
          {mode === "internal" ? (
            <p className="flex items-center gap-1.5 text-xs text-amber-900 dark:text-amber-200"><Lock className="h-3.5 w-3.5" aria-hidden="true" /> Internal note — not visible to the student. It never changes the status.</p>
          ) : (
            <p className="text-xs text-muted-foreground">The student reads this. Use plain, student-safe language: no internal jargon, no other students' details, no promises about credit acceptance or outcomes you cannot guarantee.</p>
          )}
          <label htmlFor="staff-composer" className="sr-only">{mode === "internal" ? "Internal note" : "Reply to student"}</label>
          <Textarea id="staff-composer" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "internal" ? "Write a note for the team…" : "Write your reply to the student…"} className={mode === "internal" ? "border-amber-500" : ""} />
          {perms.can_attach && mode === "public" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input ref={fileRef} type="file" className="sr-only" id="staff-file" aria-label="Attach files" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.doc,.docx" onChange={(e) => { setFiles((p) => [...p, ...Array.from(e.target.files ?? [])]); if (fileRef.current) fileRef.current.value = ""; }} />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Paperclip className="mr-1 h-4 w-4" aria-hidden="true" />Attach file</Button>
              {files.map((f, i) => (
                <span key={i} className="rounded border px-2 py-0.5 text-xs">{f.name} <button type="button" className="ml-1 underline" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>remove</button></span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {mode === "internal" ? (
              <Button onClick={() => sendReply()} disabled={!text.trim() || busy}>Add internal note</Button>
            ) : (
              <>
                {canWait && <Button onClick={() => sendReply("waiting_on_student")} disabled={!text.trim() || busy}>Reply &amp; wait for student</Button>}
                <Button variant={canWait ? "outline" : "default"} onClick={() => sendReply()} disabled={!text.trim() || busy}>Reply</Button>
                {canResolve && <Button variant="outline" onClick={() => sendReply("resolved")} disabled={!text.trim() || busy}>Reply &amp; resolve</Button>}
              </>
            )}
            {busy && <Loader2 className="h-4 w-4 animate-spin self-center" aria-label="Working" />}
          </div>
          {mode === "public" && canResolve && <p className="text-xs text-muted-foreground">“Reply &amp; resolve” uses your reply as the resolution note the student sees.</p>}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">{closedTicket ? "This ticket is closed." : "You can view this ticket but not reply to it."}</p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Desk
// ---------------------------------------------------------------------------

export function StaffSupportDesk() {
  const { user } = useAuth();
  const isManager = user?.role === "admin" || user?.role === "staff";
  const [queue, setQueue] = useState<QueueKey>("needs");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters = useMemo(() => ({ ...queueFilters(queue), ...(search ? { search } : {}), limit: 50 }), [queue, search]);
  const list = useTickets(filters);
  const stats = useTicketStats(true);
  const directory = useSupportStaffDirectory(isManager);

  const tickets = ((list.data as { tickets?: SupportTicketSummary[] } | undefined)?.tickets ?? []) as SupportTicketSummary[];
  const total = (list.data as { pagination?: { total: number } } | undefined)?.pagination?.total ?? tickets.length;
  const staff = ((directory.data as { staff?: SupportPerson[] } | undefined)?.staff ?? []) as SupportPerson[];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-4 sm:px-6" data-testid="staff-support-desk">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Support desk</h1>
        <p className="text-sm text-muted-foreground">{isManager ? "All student requests." : "Requests assigned to you."}</p>
      </header>

      <StatsStrip stats={(stats.data as SupportStatsResponse | undefined)?.stats} active={queue} onPick={(q) => { setQueue(q); setSelectedId(null); }} />

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,400px)_1fr]">
        <section className={`${selectedId ? "hidden lg:block" : ""} space-y-3`} aria-label="Queue">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <label htmlFor="staff-search" className="sr-only">Search tickets by subject</label>
            <Input id="staff-search" className="pl-8" placeholder="Search by subject…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
          <div role="group" aria-label="Queue filter" className="flex flex-wrap gap-1.5">
            {QUEUES.map((q) => (
              <button
                key={q.key}
                type="button"
                aria-pressed={queue === q.key}
                onClick={() => { setQueue(q.key); setSelectedId(null); }}
                className={`rounded-full border px-3 py-1 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${queue === q.key ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent"}`}
              >
                {q.label}
              </button>
            ))}
          </div>
          {list.isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading tickets" /></div>
          ) : list.error ? (
            <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">{errorText(list.error)}</div>
          ) : tickets.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing in this queue.</div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground" aria-live="polite">{total} ticket{total === 1 ? "" : "s"}</p>
              <ul className="space-y-2">
                {tickets.map((t) => <TicketRow key={t.id} ticket={t} selected={t.id === selectedId} onSelect={() => setSelectedId(t.id)} />)}
              </ul>
            </>
          )}
        </section>

        <section className={`${selectedId ? "" : "hidden lg:block"} min-w-0 rounded-lg border bg-card p-4`} aria-label="Ticket detail">
          {selectedId ? (
            <TicketDetailPane ticketId={selectedId} staff={staff} onBack={() => setSelectedId(null)} />
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
              <MessageSquare className="mb-3 h-10 w-10" aria-hidden="true" />
              <p className="text-sm">Select a ticket to read the conversation and reply.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default StaffSupportDesk;
