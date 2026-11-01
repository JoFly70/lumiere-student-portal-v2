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
import { parseStageNote } from "@/lib/elective-stage";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { formatDistanceToNowStrict } from "date-fns";
import { fr as frLocale } from "date-fns/locale";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Download, Inbox, Loader2, Lock, MessageSquare, Paperclip, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { useT, type Language } from "@/i18n";
import type { TranslationKey } from "@/i18n/en";
import { supportText } from "./original-support-text";
import {
  SUPPORT_TOPIC_INFO,
  type SupportComment,
  type SupportStatusEvent,
  type SupportPerson,
  type SupportStatsResponse,
  type SupportTicketDetail,
  type SupportTicketSummary,
  type TicketPriority,
  type TicketStatus,
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
  STAFF_QUEUE_REFRESH_MS,
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

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;
const K = (key: string) => key as TranslationKey;

// S32-B: every staff word comes from the s32sup.* dictionary; colours from the student status language.
const STATUS_KEYS: Record<TicketStatus, string> = {
  open: "s32sup.status.open",
  in_progress: "s32sup.status.in_progress",
  waiting_on_student: "s32sup.status.waiting_on_student",
  resolved: "s32sup.status.resolved",
  closed: "s32sup.status.closed",
};

/** One restrained pill family (the Control Center's TonePill): "New" is the single gold accent, working states
 * are neutral, resolved is a quiet green, and red is kept for "Overdue" only.
 */
const STATUS_TONE: Record<TicketStatus, Tone> = { open: "gold", in_progress: "neutral", waiting_on_student: "neutral", resolved: "ok", closed: "neutral" };

function TicketStatusPill({ status, testId }: { status: TicketStatus; testId?: string }) {
  const { t } = useT();
  return <TonePill tone={STATUS_TONE[status]} testId={testId}><span data-status={ticketStatusKey(status)}>{t(K(STATUS_KEYS[status]))}</span></TonePill>;
}

function PriorityPill({ priority, always }: { priority: TicketPriority; always?: boolean }) {
  const { t } = useT();
  if (priority === "urgent") return <TonePill tone="attention" dot={false}><AlertTriangle className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden="true" />{t(K("s32sup.priority.urgent"))}</TonePill>;
  if (priority === "high") return <TonePill tone="neutral" dot={false}>{t(K("s32sup.priority.highPill"))}</TonePill>;
  return always ? <TonePill tone="neutral" dot={false}>{t(K("s32sup.priority.suffix"), { level: t(K(`s32sup.priority.${priority}`)) })}</TonePill> : null;
}

function OverduePill({ testId }: { testId?: string }) {
  const { t } = useT();
  return <TonePill tone="urgent" testId={testId}>{t(K("s32sup.overdue"))}</TonePill>;
}

function age(iso: string, language: Language): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : formatDistanceToNowStrict(d, { addSuffix: false, ...(language === "fr" ? { locale: frLocale } : {}) });
}

/** Translated recovery text. Raw server wording is never shown: the cause class decides what the person is told to do. */
export function recoveryText(t: TFn, e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401 || e.status === 403) return t(K("s32sup.err.denied"));
    if (e.status === 404) return t(K("s32sup.err.notFound"));
    if (e.status === 409 || e.status === 412) return t(K("s32sup.err.conflict"));
    if (e.status === 400 || e.status === 422) return t(K("s32sup.err.invalid"));
    if (e.status >= 500) return t(K("s32sup.err.server"));
    return t(K("s32sup.err.generic"));
  }
  if (e instanceof TypeError) return t(K("s32sup.err.network"));
  return t(K("s32sup.err.generic"));
}

function topicLabel(language: Language, ticket: { topic?: string | null; category: string }): string {
  const key = (ticket.topic ?? topicForTicket(null, ticket.category as never)) as keyof typeof SUPPORT_TOPIC_INFO;
  return supportText(language).topics[key]?.label ?? SUPPORT_TOPIC_INFO[key]?.label ?? String(key);
}

// ---------------------------------------------------------------------------
// KPI tiles = queue filters
// ---------------------------------------------------------------------------

const TILES: { queue: QueueKey; tone?: "urgent" | "attention"; pick: (s: SupportStatsResponse["stats"]) => number }[] = [
  { queue: "needs", pick: (s) => s.awaitingStaff },
  { queue: "overdue", tone: "urgent", pick: (s) => s.overdue },
  { queue: "unassigned", pick: (s) => s.unassigned },
  { queue: "waiting", pick: (s) => s.awaitingStudent },
];
/** Coaches only ever see tickets assigned to them, so an "Unassigned" count is always 0 by design: the tile is not shown. */
export const tilesFor = (manager: boolean) => (manager ? TILES : TILES.filter((x) => x.queue !== "unassigned"));

function StatsStrip({ stats, active, onPick, manager }: { stats?: SupportStatsResponse["stats"]; active: QueueKey; onPick: (q: QueueKey) => void; manager: boolean }) {
  const { t } = useT();
  const tiles = tilesFor(manager);
  return (
    <div role="group" aria-label={t(K("s32sup.stats.aria"))} className={cn("grid grid-cols-2 gap-3", tiles.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")} data-testid="staff-stats">
      {tiles.map((tile) => (
        <KpiTile
          key={tile.queue}
          label={t(K(`s32sup.q.${tile.queue}.label`))}
          value={stats ? tile.pick(stats) : "–"}
          hint={t(K(`s32sup.q.${tile.queue}.help`))}
          tone={tile.tone}
          pressed={active === tile.queue}
          showingLabel={t(K("s32sup.stats.showing"))}
          onClick={() => onPick(tile.queue)}
          testId={`tile-${tile.queue}`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticket list
// ---------------------------------------------------------------------------

export function TicketRow({ ticket, selected, onSelect }: { ticket: SupportTicketSummary; selected: boolean; onSelect: () => void }) {
  const { t, language } = useT();
  const topic = { label: topicLabel(language, ticket) };
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
            {staffRowAge(ticket, now, language)}
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
                <span className="min-w-0 truncate text-student-muted">{t(K("s32sup.row.assigned"), { name: ticket.assignee.name })}</span>
              </>
            ) : (
              <>
                <StaffAvatar name="?" size="sm" muted />
                <span className={cn(needsOwner ? "font-medium text-student-gold-ink" : "text-student-muted")}>{t(K("s32sup.row.unassigned"))}</span>
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
  const { t, language } = useT();
  if (comment.is_internal) {
    const stage = parseStageNote(comment.content);
    return (
      <li data-testid="internal-note" className="rounded-xl border border-dashed border-student-line-strong bg-student-bg/70 px-4 py-3">
        <div className="mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-student-muted">
          <span className="inline-flex items-center gap-1.5 font-semibold text-student-ink">
            <Lock className="h-3.5 w-3.5 text-student-gold-ink" aria-hidden="true" />
            {t(K("s32sup.comment.internal"))}
          </span>
          <span>· {t(K("s32sup.comment.internalMeta"))} · {comment.author_name} · {t(K("s32sup.age.ago"), { span: age(comment.created_at, language) })}</span>
        </div>
        {stage ? (
          <p className="text-sm leading-relaxed text-student-ink" data-testid="elective-stage-note"><span className="font-semibold">{t(K("s32sup.elective.stage"), { stage: t(K(`s32sup.stage.${stage.stage}`)) })}</span>{stage.reason ? <span className="block whitespace-pre-wrap">{stage.reason}</span> : null}</p>
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
          <span className="font-semibold text-student-ink">{comment.author_name}</span> · {staff ? t(K("s32sup.comment.team")) : t(K("s32sup.comment.student"))} · {t(K("s32sup.age.ago"), { span: age(comment.created_at, language) })}
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-student-ink">{comment.content}</p>
      </div>
    </li>
  );
}

/** One plain sentence: who is waiting, how long, and whether the target is missed. */
function WaitingBanner({ ticket }: { ticket: SupportTicketDetail }) {
  const { t, language } = useT();
  const { user } = useAuth();
  const canAssign = user?.role === "admin" || user?.role === "staff";
  const now = new Date();
  const over = overdueByLabel(ticket, now, language);
  if (ticket.awaiting === "staff") {
    return (
      <StaffNotice
        tone={over ? "urgent" : "gold"}
        icon={<Clock className="h-4 w-4" />}
        role="status"
        testId="waiting-banner"
      >
        <p className="font-medium">{over ? t(K("s32sup.overdue")) : t(K("s32sup.banner.waitingTeam"))} · {staffRowAge(ticket, now, language)}</p>
        <p className="text-student-muted">
          {over ? `${over}. ` : ""}{ticket.assignee ? t(K("s32sup.banner.owner"), { name: ticket.assignee.name }) : (canAssign ? t(K("s32sup.banner.nobodyAssign")) : t(K("s32sup.banner.nobody")))}
        </p>
      </StaffNotice>
    );
  }
  if (ticket.awaiting === "student") {
    return (
      <StaffNotice tone="info" icon={<Clock className="h-4 w-4" />} testId="waiting-banner">
        <p className="font-medium">{t(K("s32sup.banner.waitingStudent"))} · {staffRowAge(ticket, now, language)}</p>
        <p className="text-student-muted">{t(K("s32sup.banner.noAction"))}</p>
      </StaffNotice>
    );
  }
  return (
    <StaffNotice tone="success" testId="waiting-banner">
      <p className="font-medium">{staffRowAge(ticket, now, language)}</p>
    </StaffNotice>
  );
}

export function StatusHistory({ history, staff }: { history: readonly SupportStatusEvent[]; staff: readonly SupportPerson[] }) {
  const { t, language } = useT();
  if (history.length === 0) return null;
  const ordered = [...history].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const label = (s: TicketStatus) => t(K(STATUS_KEYS[s]));
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(language === "fr" ? "fr-CA" : "en-CA", { dateStyle: "medium", timeStyle: "short" });
  };
  return (
    <section aria-label={t(K("s32sup.history.heading"))} data-testid="ticket-status-history">
      <h4 className={cn(staffLabel, "mb-1.5")}>{t(K("s32sup.history.heading"))}</h4>
      <ol className="space-y-1 text-sm text-student-ink">
        {ordered.map((h) => {
          const who = h.changed_by ? staff.find((p) => p.id === h.changed_by)?.name : undefined;
          return (
            <li key={h.id} className="flex flex-wrap items-baseline gap-x-2" data-testid="status-history-row">
              <span className="font-medium">
                {h.old_status ? `${label(h.old_status)} → ${label(h.new_status)}` : t(K("s32sup.history.created"), { to: label(h.new_status) })}
              </span>
              <span className="text-xs text-student-muted">{when(h.created_at)}{who ? ` · ${t(K("s32sup.history.by"), { name: who })}` : ""}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TicketDetailPane({ ticketId, staff, onBack }: { ticketId: string; staff: readonly SupportPerson[]; onBack: () => void }) {
  const { t, language } = useT();
  const { data, isLoading, error } = useTicket(ticketId, { refetchInterval: STAFF_QUEUE_REFRESH_MS });
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
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-student-muted" aria-label={t(K("s32sup.detail.loading"))} /></div>;
  }
  if (error || !ticket) {
    return (
      <StaffNotice tone="urgent" role="alert" action={<Button variant="outline" size="sm" className={staffBtn.outline} onClick={onBack}>{t(K("s32sup.detail.back"))}</Button>}>
        {error ? recoveryText(t, error) : t(K("s32sup.detail.unavailable"))}
      </StaffNotice>
    );
  }

  const perms = ticket.permissions;
  const busy = update.isPending || createComment.isPending || upload.isPending;
  const topic = { label: topicLabel(language, ticket) };
  const closedTicket = ticket.status === "closed";

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "ok", text: ok });
      return true;
    } catch (e) {
      setMsg({ kind: "error", text: recoveryText(t, e) });
      return false;
    }
  };

  const changeStatus = (value: string) => {
    if (value === ticket.status) return;
    if (value === "resolved") { setResolving(true); return; }
    void run(() => update.mutateAsync({ status: value as TicketStatus }), t(K("s32sup.detail.statusChanged"), { status: t(K(STATUS_KEYS[value as TicketStatus])) }));
  };

  const confirmResolve = async () => {
    const ok = await run(() => update.mutateAsync({ status: "resolved", resolutionNotes: resolution.trim() }), t(K("s32sup.detail.resolved")));
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
        ? { kind: "error", text: failedFiles > 1 ? t(K("s32sup.detail.attachFailMany"), { n: failedFiles }) : t(K("s32sup.detail.attachFailOne")) }
        : { kind: "ok", text: internal ? t(K("s32sup.detail.noteSaved")) : t(K("s32sup.detail.replySent")) });
    } catch (e) {
      setMsg({ kind: "error", text: recoveryText(t, e) });
    }
  };

  const openDownload = async (attachmentId: string) => {
    setMsg(null);
    try {
      const r = (await download.mutateAsync(attachmentId));
      window.open(r.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      setMsg({ kind: "error", text: recoveryText(t, e) });
    }
  };

  const statusOptions = [ticket.status, ...perms.allowed_statuses.filter((s) => s !== ticket.status)];
  const comments = ticket.ticket_comments ?? [];
  const attachments = ticket.ticket_attachments ?? [];
  const canResolve = perms.allowed_statuses.includes("resolved");
  const canWait = perms.allowed_statuses.includes("waiting_on_student");

  return (
    <article className="space-y-5" data-testid="staff-ticket-detail" aria-label={t(K("s32sup.detail.aria"), { number: ticket.ticket_number })}>
      <div className="space-y-2">
        <Button variant="ghost" size="sm" className={cn(staffBtn.ghost, "-ml-3 lg:hidden")} onClick={onBack} data-testid="staff-back-to-queue">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t(K("s32sup.detail.back"))}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-student-muted">{ticket.ticket_number}</span>
          <TicketStatusPill status={ticket.status} testId="detail-status" />
          <PriorityPill priority={ticket.priority} always />
          {ticket.is_overdue && <OverduePill />}
          {isElectiveChangeSubject(ticket.subject) && <TonePill tone="neutral" dot={false} testId="pill-elective-change">{t(K("s32sup.elective.pill"))}</TonePill>}
        </div>
        <h2 tabIndex={-1} data-testid="staff-ticket-title" className="font-serif text-2xl leading-snug tracking-tight text-student-ink focus-visible:outline-none">{ticket.subject}</h2>
        <p className="text-sm text-student-muted">
          <span className="font-medium text-student-ink">{ticket.reporter_name}</span>{ticket.reporter_email ? ` · ${ticket.reporter_email}` : ""} · {topic.label} · {t(K("s32sup.detail.opened"), { span: age(ticket.created_at, language) })}
        </p>
        {/* Admin and staff open the Student File; coaches never get a student-record link (the server also withholds student_id). */}
        {(user?.role === "admin" || user?.role === "staff") && ticket.student_id ? (
          <Link
            href={`/admin/students/${encodeURIComponent(ticket.student_id)}`}
            className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-student-gold-ink underline-offset-4 hover:underline"
            data-testid="link-ticket-student-workspace"
          >
            {t(K("s32sup.detail.openStudent"))} <ArrowLeft className="h-4 w-4 rotate-180" aria-hidden="true" />
          </Link>
        ) : null}
        {isElectiveChangeSubject(ticket.subject) && (
          <p className="rounded-lg border border-student-line-strong bg-student-card px-3 py-2 text-sm text-student-ink" data-testid="elective-change-hint">
            {t(K("s32sup.elective.hint"))}
            {user?.role === "admin" ? (
              <>
                {" "}
                <Link href={`/admin/elective-requests?ticket=${encodeURIComponent(ticket.id)}`} className="font-semibold text-student-gold-ink underline underline-offset-4" data-testid="link-elective-requests">
                  {t(K("s32sup.elective.decide"))}
                </Link>
              </>
            ) : null}
            {user?.role === "admin" && ticket.student_id ? (
              <>
                {" · "}
                <Link href={`/admin/students/${encodeURIComponent(ticket.student_id)}/high-school`} className="font-semibold text-student-gold-ink underline underline-offset-4" data-testid="link-elective-high-school">
                  {t(K("s32sup.elective.hsPathway"))}
                </Link>
              </>
            ) : null}
          </p>
        )}
        {ticket.context && (
          <p className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-student-line-strong bg-student-card px-2.5 py-1.5 text-xs" data-testid="academic-context">
            <span className="font-semibold text-student-ink">{t(K("s32sup.detail.context"))}</span>
            <span>{ticket.context.code ? `${ticket.context.code} · ` : ""}{ticket.context.title}</span>
            <span className="text-student-muted">{t(K("s32sup.detail.contextNote"), { v: ticket.context.planVersion })}</span>
          </p>
        )}
      </div>

      <WaitingBanner ticket={ticket} />

      <section aria-label={t(K("s32sup.detail.controls"))} className="grid gap-3 rounded-xl border border-student-line bg-student-bg/60 p-3 sm:grid-cols-3">
        <label className="space-y-1.5">
          <span className={staffLabel}>{t(K("s32sup.detail.status"))}</span>
          <select className={staffField} value={ticket.status} disabled={busy || perms.allowed_statuses.length === 0} onChange={(e) => changeStatus(e.target.value)}>
            {statusOptions.map((s) => <option key={s} value={s}>{t(K(STATUS_KEYS[s]))}</option>)}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className={staffLabel}>{t(K("s32sup.detail.assignedTo"))}</span>
          {perms.can_assign ? (
            <select
              className={staffField}
              value={assigneeSelectValue(ticket)}
              disabled={busy}
              onChange={(e) => void run(() => update.mutateAsync({ assignedTo: e.target.value || null }), e.target.value ? t(K("s32sup.detail.reassigned")) : t(K("s32sup.detail.unassignedDone")))}
            >
              <option value="">{t(K("s32sup.detail.unassignedOpt"))}</option>
              {staff.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
              {ticket.assignee && !staff.some((p) => p.id === ticket.assignee?.id) && (
                <option value={ticket.assignee.id}>{ticket.assignee.name}</option>
              )}
            </select>
          ) : (
            <div className="flex min-h-10 items-center gap-2 text-sm font-normal text-student-ink">
              {ticket.assignee ? <><StaffAvatar name={ticket.assignee.name} size="sm" />{ticket.assignee.name}</> : t(K("s32sup.detail.unassignedOpt"))}
            </div>
          )}
        </label>
        <label className="space-y-1.5">
          <span className={staffLabel}>{t(K("s32sup.detail.priority"))}</span>
          {perms.can_change_priority ? (
            <select className={staffField} value={ticket.priority} disabled={busy} onChange={(e) => void run(() => update.mutateAsync({ priority: e.target.value as TicketPriority }), t(K("s32sup.detail.priorityUpdated")))}>
              {(["low", "medium", "high", "urgent"] as const).map((p) => <option key={p} value={p}>{t(K(`s32sup.priority.${p}`))}</option>)}
            </select>
          ) : (
            <div className="flex min-h-10 items-center text-sm font-normal text-student-ink">{t(K(`s32sup.priority.${ticket.priority}`))}</div>
          )}
        </label>
        {resolving && (
          <div className="space-y-2 sm:col-span-3" data-testid="resolve-form">
            <label htmlFor="resolution-note" className={staffLabel}>{t(K("s32sup.detail.resolutionLabel"))}</label>
            <Textarea id="resolution-note" rows={3} className={cn(staffField, "min-h-[88px] py-2")} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder={t(K("s32sup.detail.resolutionPlaceholder"))} />
            <div className="flex gap-2">
              <Button size="sm" className={staffBtn.seal} onClick={confirmResolve} disabled={!resolution.trim() || busy}>{t(K("s32sup.detail.resolveBtn"))}</Button>
              <Button size="sm" variant="outline" className={staffBtn.outline} onClick={() => setResolving(false)}>{t(K("s32sup.detail.cancel"))}</Button>
            </div>
          </div>
        )}
      </section>

      {ticket.resolution_notes && (
        <section className="rounded-xl border border-l-[3px] border-student-line border-l-st-applied bg-st-applied-soft/40 px-4 py-3 text-sm text-student-ink" aria-label={t(K("s32sup.detail.resolutionAria"))}>
          <div className="text-xs font-semibold uppercase tracking-[0.1em] text-st-applied">{t(K("s32sup.detail.resolutionHeading"))}</div>
          <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{ticket.resolution_notes}</p>
        </section>
      )}

      <section aria-label={t(K("s32sup.detail.conversation"))}>
        <h3 className="mb-3 font-serif text-lg tracking-tight text-student-ink">{t(K("s32sup.detail.conversation"))} <span className="text-sm text-student-muted">({comments.length})</span></h3>
        <ul className="space-y-3">
          {comments.map((c) => <CommentBubble key={c.id} comment={c} />)}
        </ul>
        {attachments.length > 0 && (
          <div className="mt-4" data-testid="staff-attachments">
            <h4 className={cn(staffLabel, "mb-1.5")}>{t(K("s32sup.detail.attachments"))}</h4>
            <ul className="space-y-1.5">
              {attachments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-student-line bg-student-card px-3 py-1.5 text-sm text-student-ink">
                  <span className="min-w-0 truncate"><Paperclip className="mr-1.5 inline h-3.5 w-3.5 text-student-gold-ink" aria-hidden="true" />{a.file_name}</span>
                  <Button variant="ghost" size="sm" className={staffBtn.ghost} onClick={() => openDownload(a.id)} aria-label={t(K("s32sup.detail.download"), { name: a.file_name })}>
                    <Download className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-4"><StatusHistory history={ticket.ticket_status_history ?? []} staff={staff} /></div>
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
        <section aria-label={t(K("s32sup.detail.replyAria"))} data-mode={mode} className={cn("space-y-3 rounded-2xl border p-4 transition-colors", mode === "internal" ? "border-dashed border-student-line-strong bg-student-bg/70" : "border-student-line bg-student-card")}>
          <div role="group" aria-label={t(K("s32sup.detail.msgAria"))} className="inline-flex rounded-lg border border-student-line bg-student-bg p-1 text-sm">
            <button type="button" aria-pressed={mode === "public"} onClick={() => setMode("public")} className={cn(SEGMENT, mode === "public" ? SEGMENT_ON : SEGMENT_OFF)}>{t(K("s32sup.detail.publicReply"))}</button>
            {perms.can_add_internal_note && (
              <button type="button" aria-pressed={mode === "internal"} onClick={() => setMode("internal")} className={cn(SEGMENT, mode === "internal" ? SEGMENT_ON : SEGMENT_OFF)}><Lock className="h-3.5 w-3.5" aria-hidden="true" />{t(K("s32sup.detail.internalBtn"))}</button>
            )}
          </div>
          {mode === "internal" ? (
            <p className="flex items-center gap-1.5 text-xs text-student-muted"><Lock className="h-3.5 w-3.5 text-student-gold-ink" aria-hidden="true" /> {t(K("s32sup.detail.internalHelp"))}</p>
          ) : (
            <p className="text-xs leading-relaxed text-student-muted">{t(K("s32sup.detail.publicHelp"))}</p>
          )}
          <label htmlFor="staff-composer" className="sr-only">{mode === "internal" ? t(K("s32sup.detail.composerInternal")) : t(K("s32sup.detail.composerReply"))}</label>
          <Textarea id="staff-composer" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "internal" ? t(K("s32sup.detail.phInternal")) : t(K("s32sup.detail.phReply"))} className={cn(staffField, "min-h-[112px] py-2.5")} />
          {perms.can_attach && mode === "public" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input ref={fileRef} type="file" className="sr-only" id="staff-file" aria-label={t(K("s32sup.detail.attachFiles"))} multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.doc,.docx" onChange={(e) => { setFiles((p) => [...p, ...Array.from(e.target.files ?? [])]); if (fileRef.current) fileRef.current.value = ""; }} />
              <Button type="button" variant="outline" size="sm" className={staffBtn.outline} onClick={() => fileRef.current?.click()}><Paperclip className="h-4 w-4" aria-hidden="true" />{t(K("s32sup.detail.attachBtn"))}</Button>
              {files.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full border border-student-line-strong px-2.5 py-1 text-xs text-student-ink">{f.name} <button type="button" className="ml-1 inline-flex min-h-6 items-center underline" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>{t(K("s32sup.detail.remove"))}</button></span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {mode === "internal" ? (
              <Button className={staffBtn.seal} onClick={() => sendReply()} disabled={!text.trim() || busy}>{t(K("s32sup.detail.addInternal"))}</Button>
            ) : (
              <>
                {canWait && <Button className={staffBtn.primary} onClick={() => sendReply("waiting_on_student")} disabled={!text.trim() || busy}>{t(K("s32sup.detail.replyWait"))}</Button>}
                <Button variant={canWait ? "outline" : "default"} className={canWait ? staffBtn.outline : staffBtn.primary} onClick={() => sendReply()} disabled={!text.trim() || busy}>{t(K("s32sup.detail.reply"))}</Button>
                {canResolve && <Button variant="outline" className={staffBtn.outline} onClick={() => sendReply("resolved")} disabled={!text.trim() || busy}>{t(K("s32sup.detail.replyResolve"))}</Button>}
              </>
            )}
            {busy && <Loader2 className="h-4 w-4 animate-spin self-center text-student-muted" aria-label={t(K("s32sup.detail.working"))} />}
          </div>
          {mode === "public" && canResolve && <p className="text-xs text-student-muted">{t(K("s32sup.detail.resolveHelp"))}</p>}
        </section>
      ) : (
        <p className="text-sm text-student-muted">{closedTicket ? t(K("s32sup.detail.closed")) : t(K("s32sup.detail.readOnly"))}</p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Desk
// ---------------------------------------------------------------------------

const isTwoPane = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(min-width: 1024px)").matches;

export function StaffSupportDesk() {
  const { t, language } = useT();
  const { user } = useAuth();
  const isManager = user?.role === "admin" || user?.role === "staff";
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
  // Admin and staff may filter by student (server rule); a coach never can.
  const activeStudentFilter = isManager ? studentFilter : null;
  // Arriving from a Student File (?studentId=) shows every request of that student, not just the ones needing a response.
  const [queue, setQueue] = useState<QueueKey>(() => (isManager && studentFilter ? "all" : "needs"));
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
  const list = useTickets(filters, { refetchInterval: STAFF_QUEUE_REFRESH_MS });
  const stats = useTicketStats(true, { refetchInterval: STAFF_QUEUE_REFRESH_MS });
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
  const studentName = tickets.find((x) => x.reporter_name)?.reporter_name || t(K("s32sup.desk.thisStudent"));
  const moreViews = STAFF_QUEUES.filter((q) => {
    if (q.key === "unassigned" && !isManager) return false;
    return activeStudentFilter ? true : !tilesFor(isManager).some((x) => x.queue === q.key);
  });
  const searching = !!search || !!activeStudentFilter;

  return (
    <StaffPage width="wide" testId="staff-support-desk">
      <StaffPageHeader
        eyebrow={t(K("s32sup.desk.eyebrow"))}
        title={t(K("s32sup.desk.title"))}
        description={isManager ? t(K("s32sup.desk.descManager")) : t(K("s32sup.desk.descCoach"))}
      />

      {activeStudentFilter ? (
        <div className="flex flex-wrap items-center gap-3" data-testid="student-filter">
          <span className="inline-flex min-h-9 items-center gap-2 rounded-full border border-student-gold bg-student-gold-soft/60 pl-4 pr-1 text-sm font-medium text-student-ink" data-testid="student-filter-chip">
            {t(K("s32sup.desk.studentChip"), { name: studentName })}
            <button
              type="button"
              onClick={clearStudentFilter}
              aria-label={t(K("s32sup.desk.removeStudent"))}
              data-testid="student-filter-remove"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-student-muted hover:bg-student-card hover:text-student-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-student-gold-ink"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </span>
          <span className="text-xs text-student-muted">{t(K("s32sup.desk.studentNote"))}</span>
        </div>
      ) : (
        <div className={cn(selectedId && "hidden lg:block")}>
          <StatsStrip stats={(stats.data as SupportStatsResponse | undefined)?.stats} active={queue} onPick={pick} manager={isManager} />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
        <section className={cn(selectedId && "hidden lg:block", "min-w-0 space-y-3")} aria-label={t(K("s32sup.desk.queueAria"))}>
          <div className="flex flex-wrap items-center justify-between gap-2" data-testid="queue-header">
            <div className="min-w-0">
              <h2 className="font-serif text-xl tracking-tight text-student-ink" data-testid="queue-title">{t(K(`s32sup.q.${queue}.label`))}</h2>
              <p className="text-xs text-student-muted" aria-live="polite" data-testid="queue-count">
                {list.isLoading ? t(K("s32sup.desk.loading")) : `${total === 1 ? t(K("s32sup.desk.countOne")) : t(K("s32sup.desk.countMany"), { n: total })}${search ? ` ${t(K("s32sup.desk.matching"), { q: search })}` : ""}`}
              </p>
            </div>
            {queue !== "needs" && (
              <Button type="button" variant="ghost" size="sm" className={staffBtn.ghost} onClick={() => pick("needs")}>
                <X className="h-4 w-4" aria-hidden="true" />{t(K("s32sup.desk.clearFilter"))}
              </Button>
            )}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-student-muted" aria-hidden="true" />
            <label htmlFor="staff-search" className="sr-only">{isManager ? t(K("s32sup.desk.searchLabelManager")) : t(K("s32sup.desk.searchLabelCoach"))}</label>
            <Input id="staff-search" className={cn(staffField, "pl-9")} placeholder={t(K("s32sup.desk.searchPlaceholder"))} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
          <div role="group" aria-label={t(K("s32sup.desk.moreViews"))} className="flex flex-wrap gap-1.5" data-testid="more-views">
            {moreViews.map((q) => (
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
                {t(K(`s32sup.q.${q.key}.label`))}
              </button>
            ))}
          </div>
          {list.isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-student-muted" aria-label={t(K("s32sup.desk.loadingTickets"))} /></div>
          ) : list.error ? (
            <StaffNotice
              tone="urgent"
              role="alert"
              testId="queue-error"
              action={<Button type="button" size="sm" variant="outline" className={staffBtn.outline} onClick={() => void list.refetch()}>{t(K("s32sup.err.retry"))}</Button>}
            >
              {t(K("s32sup.err.listFailed"))} {recoveryText(t, list.error)}
            </StaffNotice>
          ) : tickets.length === 0 ? (
            <StaffEmpty
              icon={<Inbox className="h-8 w-8" />}
              title={searching ? t(K("s32sup.empty.search.title")) : t(K(`s32sup.empty.${queue}.title`))}
              testId="queue-empty"
            >
              {searching ? t(K("s32sup.empty.search.body")) : t(K(`s32sup.empty.${queue}.body`))}
            </StaffEmpty>
          ) : (
            <ul className="space-y-2.5" data-testid="staff-ticket-list">
              {tickets.map((t) => <TicketRow key={t.id} ticket={t} selected={t.id === selectedId} onSelect={() => select(t.id)} />)}
            </ul>
          )}
        </section>

        <section ref={detailRef} className={cn(selectedId ? "" : "hidden lg:block", "min-w-0")} aria-label={t(K("s32sup.desk.detailAria"))}>
          <StaffCard as="div" className="lg:min-h-[420px]">
            {selectedId ? (
              <TicketDetailPane ticketId={selectedId} staff={staff} onBack={back} />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-student-muted">
                <MessageSquare className="h-10 w-10 text-student-gold-ink" aria-hidden="true" />
                <p className="font-serif text-lg tracking-tight text-student-ink">{t(K("s32sup.desk.selectTitle"))}</p>
                <p className="max-w-xs text-sm">{t(K("s32sup.desk.selectBody"))}</p>
              </div>
            )}
          </StaffCard>
        </section>
      </div>
    </StaffPage>
  );
}

export default StaffSupportDesk;
