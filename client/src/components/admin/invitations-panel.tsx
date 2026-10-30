/** Administration > Invitations: issue, resend (fresh code), copy and revoke student portal invitations. */
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, MailPlus, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StaffCard, StaffEmpty, StaffNotice, StaffPill, StaffSectionHeader, staffBtn, staffField, staffLabel, staffTable } from "@/components/staff/staff-ui";
import { getQueryFn } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
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
const STATUS_LABEL: Record<InvitationStatus, string> = { pending: "Pending", accepted: "Account created", revoked: "Revoked", expired: "Expired" };

function errorText(e: unknown): string {
  const raw = (e instanceof Error ? e.message : String(e)).replace(/^\d+:\s*/, "");
  try { const j = JSON.parse(raw); if (typeof j?.error === "string") return j.error; } catch { /* plain */ }
  return raw || "Something went wrong";
}

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function InvitationsPanel() {
  const queryClient = useQueryClient();
  const list = useQuery<{ invitations: InvitationRow[]; emailConfigured: boolean }>({ queryKey: INVITATIONS_KEY, queryFn: getQueryFn({ on401: "throw" }) });
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState<InvitationLanguage>("fr");
  const [sendEmail, setSendEmail] = useState(true);
  const [issued, setIssued] = useState<{ invitation: IssuedInvitation; language: InvitationLanguage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY });

  const issue = useMutation({
    mutationFn: () => issueInvitation({ email: email.trim(), language, sendEmail }),
    onSuccess: (inv) => { setIssued({ invitation: inv, language }); setEmail(""); setError(null); void refresh(); },
    onError: (e) => setError(errorText(e)),
  });
  const resend = useMutation({
    mutationFn: (id: string) => resendInvitation(id, { language, sendEmail }),
    onSuccess: (inv) => { setIssued({ invitation: inv, language }); setError(null); void refresh(); },
    onError: (e) => setError(errorText(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
    onSuccess: () => { setError(null); void refresh(); },
    onError: (e) => setError(errorText(e)),
  });

  const rows = list.data?.invitations ?? [];
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <div className="space-y-6" data-testid="admin-invitations">
      <StaffCard>
        <StaffSectionHeader title="Invite a student" icon={<MailPlus className="h-4 w-4" />} description="Accounts are created by invitation only. Each invitation works once, for this exact email address, and expires after 72 hours. Inviting does not activate or publish anything." />
        {list.data && !list.data.emailConfigured ? (
          <StaffNotice tone="attention" className="mb-4" testId="invitations-email-not-configured">
            Email sending is not configured on this server. Invitations are still created; copy the sign-up link and send it to the student yourself.
          </StaffNotice>
        ) : null}
        <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-end" onSubmit={(e) => { e.preventDefault(); if (emailValid) issue.mutate(); }}>
          <div className="space-y-1">
            <label className={staffLabel} htmlFor="invite-email">Student email</label>
            <Input id="invite-email" type="email" autoComplete="off" className={staffField} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" data-testid="input-invite-email" />
          </div>
          <div className="space-y-1">
            <label className={staffLabel} htmlFor="invite-language">Email language</label>
            <select id="invite-language" className={cn(staffField, "md:w-36")} value={language} onChange={(e) => setLanguage(e.target.value as InvitationLanguage)} data-testid="select-invite-language">
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm text-student-ink">
            <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--s-gold-ink))]" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} data-testid="checkbox-invite-send-email" />
            Send email
          </label>
          <Button type="submit" className={staffBtn.primary} disabled={!emailValid || issue.isPending} data-testid="button-issue-invitation">
            <Send className="h-4 w-4" aria-hidden="true" />{issue.isPending ? "Issuing..." : "Issue invitation"}
          </Button>
        </form>
        {error ? <p role="alert" className="mt-3 text-sm text-st-urgent" data-testid="invitations-error">{error}</p> : null}
        {issued ? <div className="mt-4"><IssuedInvitationNotice invitation={issued.invitation} language={issued.language} /></div> : null}
      </StaffCard>

      <StaffCard padded={false}>
        <div className="flex items-center justify-between gap-3 px-5 pt-5">
          <StaffSectionHeader title="Invitations" description="Most recent first. Resend issues a new code and cancels the previous one." className="mb-0" />
          <Button type="button" variant="outline" className={staffBtn.outline} onClick={() => void list.refetch()} aria-label="Refresh invitations"><RefreshCw className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
        <div className="p-5">
          {list.isLoading ? <p className="text-sm text-student-muted">Loading invitations…</p> : null}
          {list.isError ? <StaffNotice tone="urgent" role="alert">{errorText(list.error)}</StaffNotice> : null}
          {list.isSuccess && rows.length === 0 ? <StaffEmpty title="No invitations yet" testId="invitations-empty">Issue the first invitation above.</StaffEmpty> : null}
          {rows.length > 0 ? (
            <div className={cn(staffTable.frame, "overflow-x-auto")}>
              <table className="w-full min-w-[640px] text-sm" data-testid="invitations-table">
                <thead className="bg-student-bg text-left text-xs uppercase tracking-[0.1em] text-student-muted">
                  <tr><th className="px-4 py-3 font-semibold">Email</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Issued</th><th className="px-4 py-3 font-semibold">Expires</th><th className="px-4 py-3 text-right font-semibold">Actions</th></tr>
                </thead>
                <tbody className="divide-y divide-student-line">
                  {rows.map((r) => (
                    <tr key={r.id} data-testid={`invitation-row-${r.id}`} data-status={r.status}>
                      <td className="px-4 py-3 font-medium text-student-ink [overflow-wrap:anywhere]">{r.email}</td>
                      <td className="px-4 py-3"><StaffPill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StaffPill></td>
                      <td className="px-4 py-3 text-student-muted">{fmt(r.created_at)}</td>
                      <td className="px-4 py-3 text-student-muted">{r.status === "accepted" && r.consumed_at ? `Used ${fmt(r.consumed_at)}` : fmt(r.expires_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {r.status !== "accepted" ? (
                            <Button type="button" variant="outline" className={staffBtn.outline} disabled={resend.isPending} onClick={() => resend.mutate(r.id)} data-testid={`button-resend-${r.id}`}>
                              <Send className="h-4 w-4" aria-hidden="true" />Resend
                            </Button>
                          ) : null}
                          {r.status === "pending" ? (
                            <Button type="button" variant="outline" className={cn(staffBtn.outline, "text-st-urgent")} disabled={revoke.isPending}
                              onClick={() => { if (window.confirm(`Revoke the invitation for ${r.email}? The code will stop working.`)) revoke.mutate(r.id); }} data-testid={`button-revoke-${r.id}`}>
                              <Ban className="h-4 w-4" aria-hidden="true" />Revoke
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
    </div>
  );
}
