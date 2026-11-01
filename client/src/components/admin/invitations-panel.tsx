/** Administration > Invitations: issue, resend (fresh code), copy and revoke student portal invitations. */
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, MailPlus, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StaffCard, StaffEmpty, StaffNotice, StaffPill, StaffSectionHeader, staffBtn, staffField, staffLabel, staffTable } from "@/components/staff/staff-ui";
import { getQueryFn } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useT, type TranslationKey } from "@/i18n";
import {
  INVITATIONS_KEY, issueInvitation, resendInvitation, revokeInvitation,
  type InvitationLanguage, type InvitationRow, type InvitationStatus, type IssuedInvitation,
} from "./invitations-api";
import { IssuedInvitationNotice } from "./issued-invitation-notice";

const STATUS_TONE: Record<InvitationStatus, "gold" | "neutral" | "dashed" | "attention"> = {
  pending: "gold",
  accepted: "neutral",
  revoked: "dashed",
  expired: "attention",
};
const STATUS_LABEL: Record<InvitationStatus, TranslationKey> = {
  pending: "sa.inv.statusPending",
  accepted: "sa.inv.statusAccepted",
  revoked: "sa.inv.statusRevoked",
  expired: "sa.inv.statusExpired",
};

function errorText(e: unknown, fallback: string): string {
  const raw = (e instanceof Error ? e.message : String(e)).replace(/^\d+:\s*/, "");
  try { const j = JSON.parse(raw); if (typeof j?.error === "string") return j.error; } catch { /* plain */ }
  return raw || fallback;
}

export function InvitationsPanel() {
  const { t, language: uiLanguage } = useT();
  const locale = uiLanguage;
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const queryClient = useQueryClient();
  const list = useQuery<{ invitations: InvitationRow[]; emailConfigured: boolean }>({ queryKey: INVITATIONS_KEY, queryFn: getQueryFn({ on401: "throw" }) });
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState<InvitationLanguage>("fr");
  const [sendEmail, setSendEmail] = useState(true);
  const [issued, setIssued] = useState<{ invitation: IssuedInvitation; language: InvitationLanguage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Resend has its OWN per-row choices (language + send email); they never reuse the issue form's.
  const [resendRow, setResendRow] = useState<InvitationRow | null>(null);
  const [resendLanguage, setResendLanguage] = useState<InvitationLanguage>(uiLanguage);
  const [resendSendEmail, setResendSendEmail] = useState(true);
  const refresh = () => queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY });
  const fallback = t("sa.inv.genericError");

  const issue = useMutation({
    mutationFn: () => issueInvitation({ email: email.trim(), language, sendEmail }),
    onSuccess: (inv) => { setIssued({ invitation: inv, language }); setEmail(""); setError(null); void refresh(); },
    onError: (e) => setError(errorText(e, fallback)),
  });
  const resend = useMutation({
    mutationFn: (v: { id: string; language: InvitationLanguage; sendEmail: boolean }) => resendInvitation(v.id, { language: v.language, sendEmail: v.sendEmail }),
    onSuccess: (inv, v) => { setIssued({ invitation: inv, language: v.language }); setError(null); setResendRow(null); void refresh(); },
    onError: (e) => { setError(errorText(e, fallback)); setResendRow(null); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
    onSuccess: () => { setError(null); void refresh(); },
    onError: (e) => setError(errorText(e, fallback)),
  });

  const rows = list.data?.invitations ?? [];
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const emailConfigured = list.data?.emailConfigured ?? true;
  const openResend = (row: InvitationRow) => {
    setResendRow(row);
    setResendLanguage(uiLanguage);
    setResendSendEmail(emailConfigured);
  };

  return (
    <div className="space-y-6" data-testid="admin-invitations">
      <StaffCard>
        <StaffSectionHeader title={t("sa.inv.issueTitle")} icon={<MailPlus className="h-4 w-4" />} description={t("sa.inv.issueDescription")} />
        {list.data && !list.data.emailConfigured ? (
          <StaffNotice tone="attention" className="mb-4" testId="invitations-email-not-configured">
            {t("sa.inv.emailNotConfigured")}
          </StaffNotice>
        ) : null}
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); if (emailValid) issue.mutate(); }}>
          <div className="space-y-1">
            <label className={cn(staffLabel, "block")} htmlFor="invite-email">{t("sa.inv.studentEmail")}</label>
            <Input id="invite-email" type="email" autoComplete="off" className={staffField} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" data-testid="input-invite-email" />
          </div>
          <div className="space-y-1">
            <label className={cn(staffLabel, "block")} htmlFor="invite-language">{t("sa.inv.emailLanguage")}</label>
            <select id="invite-language" className={cn(staffField, "lg:w-36")} value={language} onChange={(e) => setLanguage(e.target.value as InvitationLanguage)} data-testid="select-invite-language">
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm text-student-ink">
            <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--s-gold-ink))]" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} data-testid="checkbox-invite-send-email" />
            {t("sa.inv.sendEmail")}
          </label>
          <Button type="submit" className={staffBtn.primary} disabled={!emailValid || issue.isPending} data-testid="button-issue-invitation">
            <Send className="h-4 w-4" aria-hidden="true" />{issue.isPending ? t("sa.inv.issuing") : t("sa.inv.issue")}
          </Button>
        </form>
        {error ? <p role="alert" className="mt-3 text-sm text-st-urgent" data-testid="invitations-error">{error}</p> : null}
        {issued ? <div className="mt-4"><IssuedInvitationNotice invitation={issued.invitation} language={issued.language} /></div> : null}
      </StaffCard>

      <StaffCard padded={false}>
        <div className="flex items-center justify-between gap-3 px-5 pt-5">
          <StaffSectionHeader title={t("sa.inv.listTitle")} description={t("sa.inv.listDescription")} className="mb-0" />
          <Button type="button" variant="outline" className={staffBtn.outline} onClick={() => void list.refetch()} aria-label={t("sa.inv.refresh")}><RefreshCw className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
        <div className="p-5">
          {list.isLoading ? <p className="text-sm text-student-muted">{t("sa.inv.loading")}</p> : null}
          {list.isError ? <StaffNotice tone="urgent" role="alert">{errorText(list.error, fallback)}</StaffNotice> : null}
          {list.isSuccess && rows.length === 0 ? <StaffEmpty title={t("sa.inv.emptyTitle")} testId="invitations-empty">{t("sa.inv.emptyBody")}</StaffEmpty> : null}
          {rows.length > 0 ? (
            <div className={cn(staffTable.frame, "overflow-x-auto")}>
              <table className="w-full min-w-[760px] text-sm" data-testid="invitations-table">
                <thead className="bg-student-bg text-left text-xs uppercase tracking-[0.1em] text-student-muted">
                  <tr><th className="px-4 py-3 font-semibold">{t("sa.inv.colEmail")}</th><th className="px-4 py-3 font-semibold">{t("sa.inv.colStatus")}</th><th className="px-4 py-3 font-semibold">{t("sa.inv.colIssued")}</th><th className="px-4 py-3 font-semibold">{t("sa.inv.colExpires")}</th><th className="px-4 py-3 text-right font-semibold">{t("sa.inv.colActions")}</th></tr>
                </thead>
                <tbody className="divide-y divide-student-line">
                  {rows.map((r) => (
                    <tr key={r.id} data-testid={`invitation-row-${r.id}`} data-status={r.status}>
                      <td className="min-w-[220px] px-4 py-3 font-medium text-student-ink [overflow-wrap:anywhere]">{r.email}</td>
                      <td className="px-4 py-3"><StaffPill tone={STATUS_TONE[r.status]}>{t(STATUS_LABEL[r.status])}</StaffPill></td>
                      <td className="whitespace-nowrap px-4 py-3 text-student-muted">{fmt(r.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-student-muted">{r.status === "accepted" && r.consumed_at ? t("sa.inv.used", { date: fmt(r.consumed_at) }) : fmt(r.expires_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {r.status !== "accepted" ? (
                            <Button type="button" variant="outline" className={staffBtn.outline} disabled={resend.isPending} onClick={() => openResend(r)} data-testid={`button-resend-${r.id}`}>
                              <Send className="h-4 w-4" aria-hidden="true" />{t("sa.inv.resend")}
                            </Button>
                          ) : null}
                          {r.status === "pending" ? (
                            <Button type="button" variant="outline" className={cn(staffBtn.outline, "text-st-urgent")} disabled={revoke.isPending}
                              onClick={() => { if (window.confirm(t("sa.inv.revokeConfirm", { email: r.email }))) revoke.mutate(r.id); }} data-testid={`button-revoke-${r.id}`}>
                              <Ban className="h-4 w-4" aria-hidden="true" />{t("sa.inv.revoke")}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </StaffCard>

      <Dialog open={resendRow !== null} onOpenChange={(o) => { if (!o) setResendRow(null); }}>
        <DialogContent data-testid="resend-dialog">
          <DialogHeader>
            <DialogTitle>{t("sa.inv.resendTitle", { email: resendRow?.email ?? "" })}</DialogTitle>
            <DialogDescription>{t("sa.inv.resendHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className={cn(staffLabel, "block")} htmlFor="resend-language">{t("sa.inv.emailLanguage")}</label>
              <select id="resend-language" className={staffField} value={resendLanguage} onChange={(e) => setResendLanguage(e.target.value as InvitationLanguage)} data-testid="select-resend-language">
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
            </div>
            <label className="flex min-h-10 items-center gap-2 text-sm text-student-ink">
              <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--s-gold-ink))]" checked={resendSendEmail} onChange={(e) => setResendSendEmail(e.target.checked)} data-testid="checkbox-resend-send-email" />
              {t("sa.inv.sendEmail")}
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className={staffBtn.outline} onClick={() => setResendRow(null)}>{t("sa.inv.resendCancel")}</Button>
            <Button type="button" className={staffBtn.primary} disabled={resend.isPending} data-testid="button-resend-confirm"
              onClick={() => { if (resendRow) resend.mutate({ id: resendRow.id, language: resendLanguage, sendEmail: resendSendEmail }); }}>
              <Send className="h-4 w-4" aria-hidden="true" />{t("sa.inv.resendConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
