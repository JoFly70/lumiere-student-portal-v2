/**
 * S32-B (SA-07): the enrollment status on the Student File Overview (admin). One card answers "where is this student
 * in enrollment and what is the one next action": invitation (pending / expired / accepted), account (ready to link /
 * linked) and the next step. Every fact comes from GET /api/admin/students/:id/account (authoritative records); the
 * actions reuse the existing admin-only endpoints: link (explicit confirmation, audited), issue invitation, and the
 * audited record-email correction. Nothing is linked, completed or activated automatically.
 */
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, MailPlus, PencilLine } from "lucide-react";
import type { EnrollmentStage, InvitationFacts } from "@shared/enrollment-status";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StaffNotice, staffField } from "@/components/staff/staff-ui";
import { ownerBtn } from "@/components/admin/control/owner-ui";
import { apiRequest } from "@/lib/queryClient";
import { useT, type TranslationKey } from "@/i18n";
import { formatDay, localeOf } from "@/lib/owner-presentation";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { accountQueryKey } from "@/components/admin/student-portal-account-card";
import { invitationSignupUrl, issueInvitation, type EmailDelivery, type InvitationLanguage, type IssuedInvitation } from "@/components/admin/invitations-api";
import { KeyValue, Panel } from "./file-parts";

export interface EnrollmentAccountView {
  studentId: string;
  studentEmail: string;
  linked: boolean;
  account: { userId: string; email: string; role: string } | null;
  candidates: Array<{ userId: string; email: string; name: string; createdAt: string }>;
  invitation?: InvitationFacts;
  enrollment?: { stage: EnrollmentStage; next: string; candidateCount: number };
}

const STAGE_KEY: Record<EnrollmentStage, TranslationKey> = {
  no_email: "s32.enr.stage.no_email",
  not_invited: "s32.enr.stage.not_invited",
  invited: "s32.enr.stage.invited",
  invitation_lapsed: "s32.enr.stage.invitation_lapsed",
  accepted_no_account: "s32.enr.stage.accepted_no_account",
  ready_to_link: "s32.enr.stage.ready_to_link",
  linked: "s32.enr.stage.linked",
};
const NEXT_KEY: Record<EnrollmentStage, TranslationKey> = {
  no_email: "s32.enr.next.no_email",
  not_invited: "s32.enr.next.not_invited",
  invited: "s32.enr.next.invited",
  invitation_lapsed: "s32.enr.next.invitation_lapsed",
  accepted_no_account: "s32.enr.next.accepted_no_account",
  ready_to_link: "s32.enr.next.ready_to_link",
  linked: "s32.enr.next.linked",
};
const DELIVERY_KEY: Record<EmailDelivery, TranslationKey> = {
  sent: "s32.enr.delivery.sent", not_configured: "s32.enr.delivery.not_configured", failed: "s32.enr.delivery.failed", skipped: "s32.enr.delivery.skipped",
};

/** Error text from the account endpoints, by code; never a raw server sentence. */
export function enrollmentErrorKey(error: unknown): TranslationKey {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const code = /"code"\s*:\s*"([A-Z_]+)"/.exec(text)?.[1];
  switch (code) {
    case "EMAIL_INVALID": return "s32.enr.err.emailInvalid";
    case "STUDENT_EMAIL_TAKEN": return "s32.enr.err.emailTaken";
    case "EMAIL_BELONGS_TO_STAFF": return "s32.enr.err.emailStaff";
    case "EMAIL_UNCHANGED": return "s32.enr.err.emailUnchanged";
    case "STUDENT_ALREADY_LINKED": return "s32.enr.err.alreadyLinked";
    case "ACCOUNT_ALREADY_LINKED": return "s32.enr.err.accountLinked";
    case "EMAIL_MISMATCH": return "s32.enr.err.mismatch";
    default: return "s32.enr.err.generic";
  }
}

export function useEnrollmentAccount(studentId: string, enabled: boolean) {
  return useQuery<EnrollmentAccountView>({
    queryKey: accountQueryKey(studentId),
    queryFn: async () => (await apiRequest("GET", `/api/admin/students/${encodeURIComponent(studentId)}/account`)).json(),
    enabled: enabled && !!studentId,
    retry: false,
    staleTime: 30_000,
  });
}

export function EnrollmentPanel({ studentId }: { studentId: string }) {
  const { t, language } = useT();
  const locale = localeOf(language);
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useEnrollmentAccount(studentId, true);
  const [confirmLink, setConfirmLink] = useState<EnrollmentAccountView["candidates"][number] | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLang, setInviteLang] = useState<InvitationLanguage>(language === "fr" ? "fr" : "en");
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<TranslationKey | null>(null);

  const settle = (next: EnrollmentAccountView) => {
    qc.setQueryData(accountQueryKey(studentId), next);
    void qc.invalidateQueries({ queryKey: ["/api/admin/s29/attention"] });
    setError(null);
  };
  const link = useMutation({
    mutationFn: async (userId: string): Promise<EnrollmentAccountView> =>
      (await apiRequest("POST", `/api/admin/students/${encodeURIComponent(studentId)}/account/link`, { userId })).json(),
    onSuccess: (next) => { settle(next); setConfirmLink(null); toast({ title: t("s32.enr.linked.toast") }); },
    onError: (e) => { setError(enrollmentErrorKey(e)); setConfirmLink(null); },
  });
  const invite = useMutation({
    mutationFn: (email: string) => issueInvitation({ email, language: inviteLang, sendEmail: true }),
    onSuccess: (next) => { setIssued(next); setInviteOpen(false); setError(null); void q.refetch(); },
    onError: (e) => { setError(enrollmentErrorKey(e)); setInviteOpen(false); },
  });
  const correct = useMutation({
    mutationFn: async (): Promise<EnrollmentAccountView> =>
      (await apiRequest("POST", `/api/admin/students/${encodeURIComponent(studentId)}/email`, { email: newEmail.trim(), reason: reason.trim() })).json(),
    onSuccess: (next) => {
      settle(next); setEmailOpen(false); setReason("");
      void qc.invalidateQueries({ queryKey: [`/api/students/${encodeURIComponent(studentId)}`] });
      toast({ title: t("s32.enr.email.toast") });
    },
    onError: (e) => setError(enrollmentErrorKey(e)),
  });

  const v = q.data;
  const stage: EnrollmentStage | null = v?.enrollment?.stage ?? null;
  const inv = v?.invitation ?? null;
  const date = (iso: string | null | undefined) => (iso ? formatDay(iso.slice(0, 10), locale, { day: "numeric", month: "short", year: "numeric" }) : "·");
  const invitationText = !inv || inv.state === "none" ? t("s32.enr.inv.none")
    : inv.state === "pending" ? t("s32.enr.inv.pending", { sent: date(inv.sentAt), expires: date(inv.expiresAt) })
    : inv.state === "expired" ? t("s32.enr.inv.expired", { date: date(inv.expiresAt) })
    : inv.state === "revoked" ? t("s32.enr.inv.revoked")
    : t("s32.enr.inv.accepted", { date: date(inv.acceptedAt) });
  const accountText = !v ? "·" : v.linked ? t("s32.enr.acc.linked", { email: v.account?.email || v.studentEmail })
    : v.candidates.length > 0 ? t("s32.enr.acc.ready") : t("s32.enr.acc.none");
  const canInvite = !!v && !v.linked && !!v.studentEmail && v.candidates.length === 0;

  return (
    <Panel id="ov-enrollment" title={t("s32.enr.title")} aside={stage ? t(STAGE_KEY[stage]) : undefined} testId="ov-enrollment">
      {q.isLoading ? <p role="status" className="text-sm text-student-muted">{t("owner.loading")}</p> : null}
      {q.isError ? <StaffNotice tone="attention" role="status" testId="enrollment-unavailable" action={<button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => void q.refetch()}>{t("owner.retry")}</button>}>{t("s32.enr.unavailable")}</StaffNotice> : null}
      {v && stage ? (
        <>
          <dl data-testid="enrollment-facts" data-stage={stage}>
            <KeyValue label={t("s32.enr.row.email")} testId="enrollment-email"><span className="break-all">{v.studentEmail || t("s32.enr.noEmail")}</span></KeyValue>
            <KeyValue label={t("s32.enr.row.invitation")} testId="enrollment-invitation">{invitationText}</KeyValue>
            <KeyValue label={t("s32.enr.row.account")} tone={v.linked ? "ok" : v.candidates.length > 0 ? "attention" : undefined} testId="enrollment-account">{accountText}</KeyValue>
          </dl>
          <p className={cn("mt-3 rounded-xl border px-4 py-3 text-sm leading-snug", stage === "linked" ? "border-student-line bg-student-card text-student-muted" : "border-student-gold bg-student-gold-soft/60 text-student-ink")} data-testid="enrollment-next">
            <span className="font-semibold">{t("s32.enr.nextLabel")}</span> {t(NEXT_KEY[stage])}
          </p>
          {error ? <StaffNotice tone="urgent" role="alert" className="mt-3" testId="enrollment-error">{t(error)}</StaffNotice> : null}
          {issued ? (
            <StaffNotice tone="gold" role="status" className="mt-3" testId="enrollment-issued">
              <span className="block">{t(DELIVERY_KEY[issued.emailDelivery], { email: issued.email })}</span>
              <span className="mt-1 block break-all font-mono text-xs">{invitationSignupUrl(issued.token, inviteLang)}</span>
            </StaffNotice>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {!v.linked ? v.candidates.map((c) => (
              <button key={c.userId} type="button" className={ownerBtn.seal} onClick={() => setConfirmLink(c)} data-testid="enrollment-link"><Link2 className="h-4 w-4" aria-hidden="true" />{t("s32.enr.link")}</button>
            )) : null}
            {canInvite ? (
              <button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => setInviteOpen(true)} data-testid="enrollment-invite">
                <MailPlus className="h-4 w-4" aria-hidden="true" />{t(inv && inv.state !== "none" ? "s32.enr.resend" : "s32.enr.invite")}
              </button>
            ) : null}
            {!v.linked ? (
              <button type="button" className={ownerBtn.ghost} onClick={() => { setNewEmail(v.studentEmail); setEmailOpen(true); setError(null); }} data-testid="enrollment-correct-email">
                <PencilLine className="h-4 w-4" aria-hidden="true" />{t("s32.enr.email.open")}
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      <Dialog open={!!confirmLink} onOpenChange={(open) => { if (!open) setConfirmLink(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("s32.enr.link.title")}</DialogTitle>
            <DialogDescription>{t("s32.enr.link.body", { email: confirmLink?.email ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => setConfirmLink(null)}>{t("owner.cancel")}</button>
            <button type="button" className={ownerBtn.seal} disabled={link.isPending} onClick={() => confirmLink && link.mutate(confirmLink.userId)} data-testid="enrollment-link-confirm">{link.isPending ? t("owner.saving") : t("s32.enr.link")}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("s32.enr.invite.title")}</DialogTitle>
            <DialogDescription>{t("s32.enr.invite.body", { email: v?.studentEmail ?? "" })}</DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-student-ink">{t("s32.enr.invite.lang")}</legend>
            <div className="flex gap-4 text-sm">
              {(["en", "fr"] as const).map((l) => (
                <label key={l} className="inline-flex min-h-10 items-center gap-2">
                  <input type="radio" name="enrollment-invite-lang" value={l} checked={inviteLang === l} onChange={() => setInviteLang(l)} />
                  {t(l === "en" ? "language.en" : "language.fr")}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-student-muted">{t("s32.enr.invite.older")}</p>
          <DialogFooter>
            <button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => setInviteOpen(false)}>{t("owner.cancel")}</button>
            <button type="button" className={ownerBtn.seal} disabled={invite.isPending || !v?.studentEmail} onClick={() => v && invite.mutate(v.studentEmail)} data-testid="enrollment-invite-confirm">{invite.isPending ? t("owner.saving") : t("s32.enr.invite.send")}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("s32.enr.email.title")}</DialogTitle>
            <DialogDescription>{t("s32.enr.email.body")}</DialogDescription>
          </DialogHeader>
          <label className="block text-sm font-medium text-student-ink" htmlFor="enrollment-new-email">{t("s32.enr.email.new")}</label>
          <input id="enrollment-new-email" type="email" autoComplete="off" className={staffField} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} data-testid="enrollment-new-email" />
          <label className="block text-sm font-medium text-student-ink" htmlFor="enrollment-email-reason">{t("s32.enr.email.reason")}</label>
          <input id="enrollment-email-reason" className={staffField} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="enrollment-email-reason" />
          {error && emailOpen ? <p role="alert" className="text-sm text-st-urgent">{t(error)}</p> : null}
          <DialogFooter>
            <button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => setEmailOpen(false)}>{t("owner.cancel")}</button>
            <button type="button" className={ownerBtn.seal} disabled={correct.isPending || reason.trim().length < 5 || newEmail.trim().length < 3} onClick={() => correct.mutate()} data-testid="enrollment-email-save">{correct.isPending ? t("owner.saving") : t("s32.enr.email.save")}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
