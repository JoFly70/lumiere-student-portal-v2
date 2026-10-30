import React, { useState } from "react";

void React; // classic JSX runtime under vitest/esbuild
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StaffCard, StaffNotice, StaffPill, staffBtn, staffField, staffLabel } from "@/components/staff/staff-ui";
import { apiRequest } from "@/lib/queryClient";
import { deliveryMessage, issueInvitation, type IssuedInvitation } from "./invitations-api";

interface AccountView {
  studentId: string;
  studentEmail: string;
  linked: boolean;
  account: { userId: string; email: string; role: string } | null;
  candidates: Array<{ userId: string; email: string; name: string; createdAt: string }>;
}

type Invitation = IssuedInvitation;

const KNOWN_CODES: Record<string, string> = {
  nf: "This record was not found.",
  not_found: "This record was not found.",
  forbidden: "You do not have access to this.",
  unauthorized: "Please sign in again.",
};

/**
 * apiRequest throws `${status}: ${body}`. Surface the server's message only when it is a readable sentence;
 * bare codes ("nf") are mapped to text or dropped, so a raw code never reaches the screen.
 */
export function errorMessage(error: unknown, fallback = ""): string {
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
  if (KNOWN_CODES[msg.toLowerCase()]) return KNOWN_CODES[msg.toLowerCase()]!;
  return msg.length > 3 && /\s/.test(msg) ? msg : fallback;
}

export const accountQueryKey = (studentId: string) => ["/api/admin/students", studentId, "account"] as const;

/** The exact sign-up link the login page consumes (?invite= prefills the Invitation Code field on its Sign Up tab). */
export function invitationSignupUrl(token: string, origin = typeof window === "undefined" ? "" : window.location.origin) {
  return `${origin}/login?invite=${encodeURIComponent(token)}`;
}

export function StudentPortalAccountCard({ studentId }: { studentId: string }) {
  const queryClient = useQueryClient();
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
    onError: (e) => { setError(errorMessage(e)); setConfirmLink(null); },
  });
  const unlink = useMutation({
    mutationFn: async (): Promise<AccountView> =>
      (await apiRequest("POST", `/api/admin/students/${encodeURIComponent(studentId)}/account/unlink`, { reason: reason.trim() })).json(),
    onSuccess: (next) => { settle(next); setUnlinkOpen(false); setReason(""); },
    onError: (e) => { setError(errorMessage(e)); setUnlinkOpen(false); },
  });
  const invite = useMutation({
    mutationFn: (email: string): Promise<Invitation> => issueInvitation({ email, language: "fr", sendEmail: true }),
    onSuccess: (next) => { setInvitation(next); setError(null); },
    onError: (e) => setError(errorMessage(e)),
  });

  const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => undefined); };

  return (
    <StaffCard aria-labelledby="portal-account-heading" data-testid="portal-account-card" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-student-muted" aria-hidden="true" />
          <h2 id="portal-account-heading" className={staffLabel}>Portal account</h2>
        </div>
        {view ? <StaffPill tone={view.linked ? "gold" : "attention"} testId="portal-account-state">{view.linked ? "Linked" : "Not linked"}</StaffPill> : null}
      </div>

      {query.isLoading ? <p className="text-sm text-student-muted">Loading portal account...</p> : null}
      {query.isError ? <p role="alert" className="text-sm text-st-urgent">Portal account status is unavailable right now. {errorMessage(query.error, "Try again in a moment.")}</p> : null}
      {error ? <p role="alert" className="text-sm text-st-urgent" data-testid="portal-account-error">{error}</p> : null}

      {view?.linked ? (
        <>
          <p className="text-sm text-student-ink">This student signs in as <span className="font-medium" data-testid="portal-account-email">{view.account?.email || "an account (email unavailable)"}</span>.</p>
          <Button type="button" size="sm" variant="outline" className={staffBtn.ghost} onClick={() => setUnlinkOpen(true)} data-testid="portal-account-unlink"><Unlink className="h-4 w-4" aria-hidden="true" />Unlink account</Button>
        </>
      ) : null}

      {view && !view.linked ? (
        <>
          {view.candidates.length > 0 ? (
            <ul className="space-y-2" data-testid="portal-account-candidates">
              {view.candidates.map((c) => (
                <li key={c.userId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 break-words text-student-ink">A student account exists for <span className="font-medium">{c.email}</span>, but it is not linked to this record.</span>
                  <Button type="button" size="sm" className={staffBtn.primary} onClick={() => setConfirmLink(c)} data-testid="portal-account-link"><Link2 className="h-4 w-4" aria-hidden="true" />Link account</Button>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p className="text-sm text-student-muted" data-testid="portal-account-none">
                {view.studentEmail
                  ? <>No student account exists yet with the record email <span className="font-medium text-student-ink">{view.studentEmail}</span>. The student must sign up with that exact email using an invitation, then return here to link it.</>
                  : "This record has no email address, so an account cannot be matched. Add the student's email to the record first."}
              </p>
              {view.studentEmail && !invitation ? (
                <Button type="button" size="sm" variant="outline" className={staffBtn.outline} disabled={invite.isPending} onClick={() => invite.mutate(view.studentEmail)} data-testid="portal-account-invite">{invite.isPending ? "Issuing..." : "Issue portal invitation"}</Button>
              ) : null}
            </>
          )}
        </>
      ) : null}

      {invitation ? (
        <StaffNotice tone="gold" role="status" testId="portal-account-invitation">
          <div className="min-w-0 space-y-2">
            <p className="font-medium" data-delivery={invitation.emailDelivery}>Invitation issued for {invitation.email}. {deliveryMessage(invitation.emailDelivery, invitation.email)} The code is shown only once.</p>
            <label className={staffLabel} htmlFor="invitation-link">Sign-up link</label>
            <div className="flex gap-2">
              <Input id="invitation-link" readOnly className={staffField} value={invitationSignupUrl(invitation.token)} onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" size="sm" variant="outline" className={staffBtn.outline} onClick={() => copy(invitationSignupUrl(invitation.token))}>Copy</Button>
            </div>
            <p className="text-xs text-student-muted">Invitation code: <span className="break-all font-mono">{invitation.token}</span></p>
            <ol className="list-decimal space-y-1 pl-5 text-xs text-student-muted">
              <li>The student opens the link; the invitation form opens with the code prefilled.</li>
              <li>They sign up with exactly <strong>{invitation.email}</strong> and set a password.</li>
              <li>Expires {new Date(invitation.expiresAt).toLocaleString()}. Then come back here and press Link account.</li>
            </ol>
          </div>
        </StaffNotice>
      ) : null}

      <Dialog open={!!confirmLink} onOpenChange={(open) => { if (!open) setConfirmLink(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link portal account?</DialogTitle>
            <DialogDescription>Link <strong>{confirmLink?.email}</strong> to this student record. The student will then see this record's data when signed in with that account. This is audited.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className={staffBtn.outline} onClick={() => setConfirmLink(null)}>Cancel</Button>
            <Button type="button" className={staffBtn.primary} disabled={link.isPending} onClick={() => confirmLink && link.mutate(confirmLink.userId)} data-testid="portal-account-link-confirm">{link.isPending ? "Linking..." : "Link account"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unlinkOpen} onOpenChange={setUnlinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlink portal account?</DialogTitle>
            <DialogDescription>{view?.account?.email} will lose access to this student record. A reason is recorded in the audit log.</DialogDescription>
          </DialogHeader>
          <label className={staffLabel} htmlFor="unlink-reason">Reason (at least 5 characters)</label>
          <Input id="unlink-reason" className={staffField} value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button type="button" variant="outline" className={staffBtn.outline} onClick={() => setUnlinkOpen(false)}>Cancel</Button>
            <Button type="button" className={staffBtn.danger} disabled={reason.trim().length < 5 || unlink.isPending} onClick={() => unlink.mutate()} data-testid="portal-account-unlink-confirm">{unlink.isPending ? "Unlinking..." : "Unlink account"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffCard>
  );
}
