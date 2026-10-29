/** Elective request detail: facts, auditable stage history, stage actions and the roadmap hand-off. */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, ExternalLink, FileEdit, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { StaffCard, StaffNotice, StaffPill, StaffSectionHeader, staffBtn, staffField, staffLabel } from "@/components/staff/staff-ui";
import { newIdempotencyKey, useCreateComment, useTicket, useUpdateTicket, type TicketComment } from "@/hooks/use-tickets";
import { adminHighSchoolApi, HsApiError, useHsState } from "@/lib/admin-high-school-api";
import { HS_STAFF_QUERY_KEY, fromTemplateBody, saveDraftBody } from "@/lib/admin-high-school-logic";
import { substituteInDraft, substitutionStatus } from "@/lib/elective-apply";
import {
  NEXT_STAGES, NOTIFIES_STUDENT, REASON_REQUIRED, STAGE_LABEL, buildStageNote, decisionReply, deriveStage, parseElectiveRequest,
  stageHistory, ticketStatusForStage, type ElectiveStage,
} from "@/lib/elective-stage";
import { staffStatusLabel } from "@shared/support-contract";
import { StagePill } from "./stage-pill";

const LINK = `${staffBtn.outline} inline-flex items-center justify-center border`;
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

const ACTION: Readonly<Record<ElectiveStage, { label: string; tone: "seal" | "danger" | "outline" | "primary"; blurb: string; reasonLabel: string }>> = {
  requested: { label: "", tone: "outline", blurb: "", reasonLabel: "" },
  lumiere_review: { label: "Start Lumière review", tone: "outline", blurb: "Lumière reviews the request against the student's plan and credit requirements. Nothing is sent to the student.", reasonLabel: "Note (internal, optional)" },
  school_pending: { label: "Send to school for approval", tone: "seal", blurb: "Lumière asks the awarding school to approve the substitution. Nothing is sent to the student.", reasonLabel: "Note (internal, optional)" },
  approved: { label: "Record school approval", tone: "primary", blurb: "The school approved the substitution. The student receives a reply (English and French) and the ticket stays in progress until the roadmap is updated.", reasonLabel: "Approval reference (internal, optional)" },
  rejected: { label: "Reject request", tone: "danger", blurb: "The student receives a reply (English and French) that includes your reason, and the ticket is resolved. The current course stays on the roadmap.", reasonLabel: "Reason (shown to the student, required)" },
  applied: { label: "Mark applied to roadmap", tone: "primary", blurb: "Confirms the new roadmap version is published. The student receives a reply (English and French) and the ticket is resolved.", reasonLabel: "Note (internal, optional)" },
};

interface PendingReply { content: string; nextStatus?: "resolved" | "in_progress"; key: string }

export function ElectiveDetail({ ticketId, onChanged }: { ticketId: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const query = useTicket(ticketId);
  const comment = useCreateComment(ticketId);
  const update = useUpdateTicket(ticketId);
  const ticket = query.data?.ticket as (NonNullable<typeof query.data>["ticket"] & { student_id?: string | null }) | undefined;
  const [dialog, setDialog] = useState<ElectiveStage | null>(null);
  const [reason, setReason] = useState("");
  const [noteKey, setNoteKey] = useState(newIdempotencyKey);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [retry, setRetry] = useState<PendingReply | null>(null);

  useEffect(() => { setDialog(null); setError(null); setDone(null); setRetry(null); }, [ticketId]);

  const comments = (ticket?.ticket_comments ?? []) as TicketComment[];
  const stage = useMemo(() => deriveStage(comments), [comments]);
  const history = useMemo(() => stageHistory(comments), [comments]);
  const facts = ticket ? parseElectiveRequest(ticket.subject, ticket.description) : null;
  const studentId = ticket?.student_id ?? null;
  const hs = useHsState(studentId ?? "");

  if (query.isLoading) return <StaffCard as="div"><p role="status" className="flex items-center gap-2 text-sm text-student-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading request…</p></StaffCard>;
  if (query.isError || !ticket || !facts) {
    return <StaffNotice tone="urgent" role="alert" action={<Button type="button" variant="outline" className={staffBtn.outline} onClick={() => void query.refetch()}>Retry</Button>}>This request could not be loaded.</StaffNotice>;
  }

  const target = (s: ElectiveStage) => ticketStatusForStage(s);
  const next = NEXT_STAGES[stage];
  const needsReason = dialog ? REASON_REQUIRED.has(dialog) : false;

  const openDialog = (s: ElectiveStage) => { setReason(""); setError(null); setDone(null); setNoteKey(newIdempotencyKey()); setDialog(s); };

  async function sendReply(r: PendingReply) {
    await comment.mutateAsync({ content: r.content, isInternal: false, nextStatus: r.nextStatus, idempotencyKey: r.key });
  }

  async function confirmStage() {
    if (!dialog || !ticket || !facts) return;
    const to = dialog;
    setWorking(true); setError(null); setRetry(null);
    try {
      await comment.mutateAsync({ content: buildStageNote(to, reason), isInternal: true, idempotencyKey: noteKey });
    } catch (e) {
      setError(`The stage was not recorded: ${e instanceof Error ? e.message : "please try again."}`);
      setWorking(false);
      return;
    }
    const want = target(to);
    const text = NOTIFIES_STUDENT.has(to) ? decisionReply(to, { from: facts.courseTitle, to: facts.alternate, reason: to === "rejected" ? reason : undefined }) : null;
    try {
      if (text) {
        const pending: PendingReply = { content: text, nextStatus: ticket.status !== want ? want : undefined, key: newIdempotencyKey() };
        setRetry(pending);
        await sendReply(pending);
        setRetry(null);
      } else if (ticket.status !== want) {
        await update.mutateAsync({ status: want });
      }
      setDialog(null);
      setDone(`Stage recorded: ${STAGE_LABEL[to]}.${text ? " The student has been notified." : ""}`);
    } catch (e) {
      setDialog(null);
      setError(`${STAGE_LABEL[to]} was recorded, but ${text ? "the reply to the student" : "the ticket status"} could not be saved: ${e instanceof Error ? e.message : "please try again."}`);
    } finally {
      setWorking(false);
      onChanged();
    }
  }

  async function retryReply() {
    if (!retry) return;
    setWorking(true); setError(null);
    try { await sendReply(retry); setRetry(null); setDone("The reply to the student was sent."); }
    catch (e) { setError(`The reply could not be sent: ${e instanceof Error ? e.message : "please try again."}`); }
    finally { setWorking(false); onChanged(); }
  }

  const pathwayHref = studentId ? `/admin/students/${encodeURIComponent(studentId)}/high-school?tab=roadmap` : null;
  const substitution = substitutionStatus(hs.data, facts.courseKey, facts.alternate);

  return (
    <div className="space-y-4" data-testid="elective-detail">
      <StaffCard as="div" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={staffLabel}>{ticket.ticket_number} · {ticket.reporter_name}</p>
            <h2 className="mt-1 break-words font-serif text-xl leading-snug text-student-ink sm:text-2xl" data-testid="elective-detail-title">{facts.courseTitle || "Current course"} <span aria-hidden="true">→</span><span className="sr-only"> to </span> {facts.alternate || "Requested course"}</h2>
          </div>
          <StagePill stage={stage} />
        </div>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className={staffLabel}>Current course</dt><dd className="mt-1 break-words">{facts.courseTitle || "Not stated"}</dd></div>
          <div><dt className={staffLabel}>Requested course</dt><dd className="mt-1 break-words">{facts.alternate || "Not stated"}</dd></div>
          <div className="sm:col-span-2"><dt className={staffLabel}>Student's reason</dt><dd className="mt-1 whitespace-pre-wrap break-words">{facts.reason || "No reason given."}</dd></div>
          <div><dt className={staffLabel}>Ticket status</dt><dd className="mt-1">{staffStatusLabel(ticket.status)}</dd></div>
          <div><dt className={staffLabel}>Opened</dt><dd className="mt-1">{when(ticket.created_at)}</dd></div>
        </dl>
        <div className="flex flex-wrap gap-2">
          {studentId ? <Link href={`/admin/students/${encodeURIComponent(studentId)}`} className={LINK} data-testid="link-elective-student">Student file<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link> : null}
          <Link href={`/support?${studentId ? `studentId=${encodeURIComponent(studentId)}&` : ""}ticket=${encodeURIComponent(ticket.id)}`} className={LINK} data-testid="link-elective-ticket">Open conversation<ExternalLink className="h-4 w-4" aria-hidden="true" /></Link>
        </div>
      </StaffCard>

      {done ? <StaffNotice tone="success" role="status" icon={<CheckCircle2 className="h-4 w-4" />}>{done}</StaffNotice> : null}
      {error ? <StaffNotice tone="urgent" role="alert" action={retry ? <Button type="button" className={staffBtn.outline} variant="outline" disabled={working} onClick={() => void retryReply()}>Retry sending reply</Button> : undefined}>{error}</StaffNotice> : null}

      <StaffCard as="div" className="space-y-3" data-testid="elective-actions">
        <StaffSectionHeader level={3} title="Decision" description={next.length ? "Each action is saved as an internal note on the ticket, with your name and time." : stage === "applied" ? "This request is complete. The roadmap was updated in a new version." : "No further action."} className="mb-0" />
        {next.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {next.filter((s) => s !== "applied").map((s) => (
              <Button key={s} type="button" className={s === "rejected" ? staffBtn.outline : s === "approved" ? staffBtn.primary : staffBtn.seal} variant="outline" disabled={working} onClick={() => openDialog(s)} data-testid={`button-stage-${s}`}>
                {stage === "rejected" && s === "lumiere_review" ? "Reopen for review" : ACTION[s].label}
              </Button>
            ))}
          </div>
        ) : null}
      </StaffCard>

      {stage === "approved" || stage === "applied" ? (
        <StaffCard as="div" className="space-y-3" data-testid="elective-apply" tone="gold">
          <StaffSectionHeader level={3} title="Apply to the roadmap" description="The published version is never edited in place. The swap goes into a new draft version; an administrator reviews and publishes it from the High school pathway. The old version stays stored." className="mb-0" />
          {!studentId ? <p className="text-sm text-student-muted">No student file is linked to this ticket, so the roadmap cannot be opened from here.</p>
            : hs.isLoading ? <p role="status" className="text-sm text-student-muted">Checking the student's roadmap…</p>
            : hs.isError ? <StaffNotice tone="attention" role="alert" action={<Button type="button" variant="outline" className={staffBtn.outline} onClick={() => void hs.refetch()}>Retry</Button>}>The roadmap could not be loaded.</StaffNotice>
            : (
              <ApplyBlock
                stage={stage}
                substitution={substitution}
                studentId={studentId}
                courseKey={facts.courseKey}
                alternate={facts.alternate}
                from={facts.courseTitle}
                pathwayHref={pathwayHref!}
                onMarkApplied={() => openDialog("applied")}
                working={working}
                onDrafted={(msg) => { setDone(msg); qc.invalidateQueries({ queryKey: HS_STAFF_QUERY_KEY(studentId) }); }}
                onError={(m) => { setError(m); }}
              />
            )}
          {stage === "applied" && pathwayHref ? <Link href={pathwayHref} className={LINK}>Open High school pathway<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link> : null}
        </StaffCard>
      ) : null}

      <StaffCard as="div" className="space-y-3" data-testid="elective-history">
        <StaffSectionHeader level={3} title="Stage history" description="Internal notes on the ticket. Only staff can see them." className="mb-0" />
        <ol className="space-y-3 border-l border-student-line-strong pl-4">
          <li className="relative">
            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border border-student-line-strong bg-student-card" aria-hidden="true" />
            <p className="text-sm font-medium text-student-ink">Requested</p>
            <p className="text-xs text-student-muted">{ticket.reporter_name} · {when(ticket.created_at)}</p>
          </li>
          {history.map((h, i) => (
            <li key={`${h.at}-${i}`} className="relative" data-testid="elective-history-item">
              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-student-gold-ink" aria-hidden="true" />
              <p className="text-sm font-medium text-student-ink">{STAGE_LABEL[h.stage]}</p>
              <p className="text-xs text-student-muted">{h.by} · {when(h.at)}</p>
              {h.reason ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-student-ink">{h.reason}</p> : null}
            </li>
          ))}
        </ol>
        {history.length === 0 ? <p className="text-sm text-student-muted">No stage change yet. The request is waiting for Lumière.</p> : null}
      </StaffCard>

      <Dialog open={dialog !== null} onOpenChange={(o) => { if (!o && !working) setDialog(null); }}>
        <DialogContent data-testid="dialog-elective-stage">
          <DialogHeader>
            <DialogTitle>{dialog ? (stage === "rejected" && dialog === "lumiere_review" ? "Reopen for review" : ACTION[dialog].label) : ""}</DialogTitle>
            <DialogDescription>{dialog ? ACTION[dialog].blurb : ""}</DialogDescription>
          </DialogHeader>
          {dialog ? (
            <div className="space-y-1.5">
              <Label htmlFor="elective-reason">{needsReason ? ACTION[dialog].reasonLabel : ACTION[dialog].reasonLabel}</Label>
              <textarea id="elective-reason" className={`${staffField} py-2`} rows={4} maxLength={1500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-elective-reason" aria-required={needsReason} />
              {needsReason && !reason.trim() ? <p className="text-xs text-st-urgent">A reason is required.</p> : null}
              {dialog === "rejected" || dialog === "approved" || dialog === "applied" ? <p className="text-xs text-student-muted">A reply is sent to {ticket.reporter_name} in English and French.</p> : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" className={staffBtn.outline} disabled={working} onClick={() => setDialog(null)}>Cancel</Button>
            <Button type="button" className={dialog === "rejected" ? staffBtn.danger : staffBtn.seal} disabled={working || (needsReason && !reason.trim())} onClick={() => void confirmStage()} data-testid="button-confirm-stage">
              {working ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApplyBlock({ stage, substitution, studentId, courseKey, alternate, from, pathwayHref, onMarkApplied, working, onDrafted, onError }: {
  stage: ElectiveStage;
  substitution: ReturnType<typeof substitutionStatus>;
  studentId: string;
  courseKey: string | null;
  alternate: string;
  from: string;
  pathwayHref: string;
  onMarkApplied: () => void;
  working: boolean;
  onDrafted: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function createDraft() {
    if (!courseKey) return;
    setBusy(true); setLocalError(null);
    try {
      // Re-read the live state: the cached one may be stale, and the draft revision must be current.
      const fresh = await adminHighSchoolApi.get(studentId);
      const status = substitutionStatus(fresh, courseKey, alternate);
      if (status.kind !== "can_draft" || !fresh.current) throw new Error(status.kind === "blocked" ? status.reason : "The roadmap already contains this change.");
      const eid = fresh.current.enrollment.id;
      const withDraft = await adminHighSchoolApi.draftFromTemplate(studentId, eid, fromTemplateBody());
      const draft = withDraft.current?.draft;
      if (!draft) throw new Error("The new draft could not be created.");
      const content = substituteInDraft(draft.content, courseKey, alternate);
      const saved = await adminHighSchoolApi.saveDraft(studentId, eid, saveDraftBody(draft.draftRevision, content));
      setConfirm(false);
      onDrafted(`Draft version ${saved.current?.draft?.versionNumber ?? draft.versionNumber} created with "${alternate}" replacing "${from}". Review it and publish from the High school pathway; the published version has not changed.`);
    } catch (e) {
      const m = e instanceof HsApiError ? e.failure.message : e instanceof Error ? e.message : "The draft could not be created.";
      setLocalError(m);
      onError(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {substitution.kind === "published" ? (
        <StaffNotice tone="success" icon={<CheckCircle2 className="h-4 w-4" />} testId="apply-published">Published roadmap version {substitution.versionNumber} already contains "{alternate}" in place of "{from}".</StaffNotice>
      ) : substitution.kind === "draft" ? (
        <StaffNotice tone="gold" icon={<FileEdit className="h-4 w-4" />} testId="apply-draft">Draft version {substitution.versionNumber} contains the swap. Review it and publish from the High school pathway.</StaffNotice>
      ) : substitution.kind === "blocked" ? (
        <StaffNotice tone="attention" testId="apply-blocked">{substitution.reason}</StaffNotice>
      ) : (
        <p className="text-sm text-student-muted">A new draft version will be created from the published roadmap with "{alternate}" replacing "{from}". Credit, area and dates are kept.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {substitution.kind === "can_draft" ? <Button type="button" className={staffBtn.primary} disabled={busy || working} onClick={() => { setLocalError(null); setConfirm(true); }} data-testid="button-create-substitution-draft"><FileEdit className="h-4 w-4" aria-hidden="true" />Create draft with this substitution</Button> : null}
        <Link href={pathwayHref} className={LINK} data-testid="link-elective-pathway">{substitution.kind === "draft" ? "Review and publish draft" : "Open High school pathway"}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        {stage === "approved" && substitution.kind === "published" ? <Button type="button" className={staffBtn.seal} disabled={working} onClick={onMarkApplied} data-testid="button-stage-applied">Mark applied to roadmap</Button> : null}
        {stage === "approved" && substitution.kind === "blocked" ? <Button type="button" variant="outline" className={staffBtn.outline} disabled={working} onClick={onMarkApplied} data-testid="button-stage-applied-manual">Mark applied (updated by hand)</Button> : null}
      </div>
      <Dialog open={confirm} onOpenChange={(o) => { if (!busy) setConfirm(o); }}>
        <DialogContent data-testid="dialog-create-substitution">
          <DialogHeader>
            <DialogTitle>Create a draft roadmap version?</DialogTitle>
            <DialogDescription>
              A new draft is created from the published roadmap and "{from}" is replaced by "{alternate}". The student sees nothing until an administrator publishes it. The published version and its history are not modified.
            </DialogDescription>
          </DialogHeader>
          {localError ? <StaffNotice tone="urgent" role="alert">{localError}</StaffNotice> : null}
          <DialogFooter>
            <Button type="button" variant="outline" className={staffBtn.outline} disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button>
            <Button type="button" className={staffBtn.primary} disabled={busy} onClick={() => void createDraft()} data-testid="button-confirm-substitution-draft">{busy ? "Creating…" : "Create draft"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
