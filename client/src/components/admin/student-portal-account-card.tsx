import React, { useState } from "react";

void React; // classic JSX runtime under vitest/esbuild
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StaffCard, StaffNotice, StaffPill, staffBtn, staffField, staffLabel } from "@/components/staff/staff-ui";
import { apiRequest } from "@/lib/queryClient";
import { deliveryMessage, issueInvitation, type InvitationLanguage, type IssuedInvitation } from "./invitations-api";
import { useT } from "@/i18n";
import { enTr, type WsTr } from "@/pages/admin-student-workspace-presentation";

interface AccountView {
  studentId: string;
  studentEmail: string;
  linked: boolean;
  account: { userId: string; email: string; role: string } | null;
  candidates: Array<{ userId: string; email: string; name: string; createdAt: string }>;
}

type Invitation = IssuedInvitation;

const KNOWN_CODES = {
  nf: "s32ws.acct.err.nf",
  not_found: "s32ws.acct.err.nf",
  forbidden: "s32ws.acct.err.forbidden",
  unauthorized: "s32ws.acct.err.unauthorized",
} as const;

/**
 * apiRequest throws `${status}: ${body}`. Surface the server's message only when it is a readable sentence;
 * bare codes ("nf") are mapped to text or dropped, so a raw code never reaches the screen.
 */
export function errorMessage(error: unknown, fallback = "", tr: WsTr = enTr): string {
  const text = error instanceof Error ? error.message : String(error);
  const body = text.replace(/^\d+:\s*/, "");
  let msg = body;
  try {
    const parsed = JSON.parse(body);
    const e = parsed?.error;
    if (typeof e === "string") msg = e;
    else if (e?.message) msg = String(e.message);
  } catch { /* not JSON */ }
  msg = msg.trim();
  const known = (KNOWN_CODES as Record<string, (typeof KNOWN_CODES)[keyof typeof KNOWN_CODES]>)[msg.toLowerCase()];
  if (known) return tr(known);
  return msg.length > 3 && /\s/.test(msg) ? msg : fallback;
}

export const accountQueryKey = (studentId: string) => ["/api/admin/students", studentId, "account"] as const;

/** The exact sign-up link the login page consumes (?invite= prefills the Invitation Code field on its Sign Up tab). */
export function invitationSignupUrl(token: string, origin = typeof window === "undefined" ? "" : window.location.origin, language?: InvitationLanguage) {
  return `${origin}/login?invite=${encodeURIComponent(token)}${language ? `&lang=${language}` : ""}`;
}

export function StudentPortalAccountCard({ studentId }: { studentId: string }) {
  const queryClient = useQueryClient();
  const { t, language } = useT();
  const [inviteLang, setInviteLang] = useState<InvitationLanguage>(language === "fr" ? "fr" : "en");
  const [confirmLink, setConfirmLink] = useState<AccountView["candidates"][number] | null>(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery<AccountView>({
    queryKey: accountQueryKey(studentId),
    queryFn: async () => (await apiRequest("GET", `/api/admin/students/${encodeURIComponent(studentId)}/account`)).json(),
    enabled: !!studentId,
  });
  const view = query.data;
  const settle = (next: AccountView) => {
    queryClient.setQueryData(accountQueryKey(studentId), next);
    setError(null);
  };

  const link = useMutation({
    mutationFn: async (userId: string): Promise<AccountView> =>
      (await apiRequest("POST", `/api/admin/students/${encodeURIComponent(studentId)}/account/link`, { userId })).json(),
    onSuccess: (next) => { settle(next); setConfirmLink(null); setInvitation(null); },
    onError: (e) => { setError(errorMessage(e, "", t)); setConfirmLink(null); },
  });
  const unlink = useMutation({
    mutationFn: async (): Promise<AccountView> =>
      (await apiRequest("POST", `/api/admin/students/${encodeURIComponent(studentId)}/account/unlink`, { reason: reason.trim() })).json(),
    onSuccess: (next) => { settle(next); setUnlinkOpen(false); setReason(""); },
    onError: (e) => { setError(errorMessage(e, "", t)); setUnlinkOpen(false); },
  });
  const invite = useMutation({
    mutationFn: (email: string): Promise<Invitation> => issueInvitation({ email, language: inviteLang, sendEmail: true }),
    onSuccess: (next) => { setInvitation(next); setError(null); },
    onError: (e) => setError(errorMessage(e, "", t)),
  });

  const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => undefined); };

  return (
    <StaffCard aria-labelledby="portal-account-heading" data-testid="portal-account-card" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-student-muted" aria-hidden="true" />
          <h2 id="portal-account-heading" className={staffLabel}>{t("s32ws.acct.title")}</h2>
        </div>
        {view ? <StaffPill tone={view.linked ? "gold" : "attention"} testId="portal-account-state">{view.linked ? t("s32ws.acct.linked") : t("s32ws.acct.notLinked")}</StaffPill> : null}
      </div>

      {query.isLoading ? <p className="text-sm text-student-muted">{t("s32ws.acct.loading")}</p> : null}
      {query.isError ? <p role="alert" className="text-sm text-st-urgent">{t("s32ws.acct.unavailable")} {errorMessage(query.error, t("s32ws.acct.tryLater"), t)}</p> : null}
      {error ? <p role="alert" className="text-sm text-st-urgent" data-testid="portal-account-error">{error}</p> : null}

      {view?.linked ? (
        <>
          <p className="text-sm text-student-ink">{t("s32ws.acct.signsInAs")} <span className="font-medium" data-testid="portal-account-email">{view.account?.email || t("s32ws.acct.emailUnavailable")}</span>.</p>
          <Button type="button" size="sm" variant="outline" className={staffBtn.ghost} onClick={() => setUnlinkOpen(true)} data-testid="portal-account-unlink"><Unlink className="h-4 w-4" aria-hidden="true" />{t("s32ws.acct.unlink")}</Button>
        </>
      ) : null}

      {view && !view.linked ? (
        <>
          {view.candidates.length > 0 ? (
            <ul className="space-y-2" data-testid="portal-account-candidates">
              {view.candidates.map((c) => (
                <li key={c.userId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 break-words text-student-ink">{t("s32ws.acct.candidate.pre")} <span className="font-medium">{c.email}</span>{t("s32ws.acct.candidate.post")}</span>
                  <Button type="button" size="sm" className={staffBtn.primary} onClick={() => setConfirmLink(c)} data-testid="portal-account-link"><Link2 className="h-4 w-4" aria-hidden="true" />{t("s32ws.acct.link")}</Button>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p className="text-sm text-student-muted" data-testid="portal-account-none">
                {view.studentEmail
                  ? <>{t("s32ws.acct.none.pre")} <span className="font-medium text-student-ink">{view.studentEmail}</span>{t("s32ws.acct.none.post")}</>
                  : t("s32ws.acct.noEmail")}
              </p>
              {view.studentEmail && !invitation ? (
                <div className="space-y-2" data-testid="portal-account-invite-options">
                  <fieldset className="space-y-1">
                    <legend className="text-xs font-medium text-student-muted">{t("s32ws.acct.inviteLang")}</legend>
                    <div className="flex gap-4 text-sm">
                      {(["en", "fr"] as const).map((l) => (
                        <label key={l} className="inline-flex min-h-10 items-center gap-2">
                          <input type="radio" name="portal-account-invite-lang" value={l} checked={inviteLang === l} onChange={() => setInviteLang(l)} />
                          {t(l === "en" ? "language.en" : "language.fr")}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <p className="text-xs text-student-muted">{t("s32ws.acct.inviteOlder")}</p>
                  <Button type="button" size="sm" variant="outline" className={staffBtn.outline} disabled={invite.isPending} onClick={() => invite.mutate(view.studentEmail)} data-testid="portal-account-invite">{invite.isPending ? t("s32ws.acct.issuing") : t("s32ws.acct.issue")}</Button>
                </div>
              ) : null}
            </>
          )}
        </>
      ) : null}

      {invitation ? (
        <StaffNotice tone="gold" role="status" testId="portal-account-invitation">
          <div className="min-w-0 space-y-2">
            <p className="font-medium" data-delivery={invitation.emailDelivery}>{t("s32ws.acct.issued", { email: invitation.email })} {deliveryMessage(invitation.emailDelivery, invitation.email, language)} {t("s32ws.acct.shownOnce")}</p>
            <label className={staffLabel} htmlFor="invitation-link">{t("s32ws.acct.signupLink")}</label>
            <div className="flex gap-2">
              <Input id="invitation-link" readOnly className={staffField} value={invitationSignupUrl(invitation.token, undefined, inviteLang)} onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" size="sm" variant="outline" className={staffBtn.outline} onClick={() => copy(invitationSignupUrl(invitation.token, undefined, inviteLang))}>{t("s32ws.acct.copy")}</Button>
            </div>
            <p className="text-xs text-student-muted">{t("s32ws.acct.code")} <span className="break-all font-mono">{invitation.token}</span></p>
            <ol className="list-decimal space-y-1 pl-5 text-xs text-student-muted">
              <li>{t("s32ws.acct.step1")}</li>
              <li>{t("s32ws.acct.step2.pre")} <strong>{invitation.email}</strong> {t("s32ws.acct.step2.post")}</li>
              <li>{t("s32ws.acct.step3", { date: new Date(invitation.expiresAt).toLocaleString(language === "fr" ? "fr-CA" : "en-US") })}</li>
            </ol>
          </div>
        </StaffNotice>
      ) : null}

      <Dialog open={!!confirmLink} onOpenChange={(open) => { if (!open) setConfirmLink(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("s32ws.acct.linkTitle")}</DialogTitle>
            <DialogDescription>{t("s32ws.acct.linkBody.pre")} <strong>{confirmLink?.email}</strong> {t("s32ws.acct.linkBody.post")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className={staffBtn.outline} onClick={() => setConfirmLink(null)}>{t("s32ws.acct.cancel")}</Button>
            <Button type="button" className={staffBtn.primary} disabled={link.isPending} onClick={() => confirmLink && link.mutate(confirmLink.userId)} data-testid="portal-account-link-confirm">{link.isPending ? t("s32ws.acct.linking") : t("s32ws.acct.link")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unlinkOpen} onOpenChange={setUnlinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("s32ws.acct.unlinkTitle")}</DialogTitle>
            <DialogDescription>{view?.account?.email} {t("s32ws.acct.unlinkBody")}</DialogDescription>
          </DialogHeader>
          <label className={staffLabel} htmlFor="unlink-reason">{t("s32ws.acct.reason")}</label>
          <Input id="unlink-reason" className={staffField} value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button type="button" variant="outline" className={staffBtn.outline} onClick={() => setUnlinkOpen(false)}>{t("s32ws.acct.cancel")}</Button>
            <Button type="button" className={staffBtn.danger} disabled={reason.trim().length < 5 || unlink.isPending} onClick={() => unlink.mutate()} data-testid="portal-account-unlink-confirm">{unlink.isPending ? t("s32ws.acct.unlinking") : t("s32ws.acct.unlink")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffCard>
  );
}
