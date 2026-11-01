/** Shown once after an invitation is issued or resent: what happened to the email, plus copy link / copy code. */
import React, { useState } from "react";
import { Check, Copy, MailCheck, MailWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StaffNotice, staffBtn } from "@/components/staff/staff-ui";
import { useT } from "@/i18n";
import { deliveryMessage, invitationSignupUrl, type InvitationLanguage, type IssuedInvitation } from "./invitations-api";

function CopyButton({ value, label, testId }: { value: string; label: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useT();
  return (
    <Button
      type="button"
      variant="outline"
      className={staffBtn.outline}
      data-testid={testId}
      onClick={() => void navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
    >
      {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      {copied ? t("sa.inv.copied") : label}
    </Button>
  );
}

export function IssuedInvitationNotice({ invitation, language }: { invitation: IssuedInvitation; language: InvitationLanguage }) {
  const { t, language: uiLanguage } = useT();
  const url = invitationSignupUrl(invitation.token, language);
  const sent = invitation.emailDelivery === "sent";
  return (
    <StaffNotice tone={sent ? "success" : "attention"} role="status" icon={sent ? <MailCheck className="h-4 w-4" /> : <MailWarning className="h-4 w-4" />} testId="issued-invitation">
      <div className="space-y-2">
        <p className="font-medium" data-testid="issued-invitation-delivery" data-delivery={invitation.emailDelivery}>{deliveryMessage(invitation.emailDelivery, invitation.email, uiLanguage)}</p>
        <p className="text-student-muted">
          {t("sa.inv.noticeDetail", { email: invitation.email, date: new Date(invitation.expiresAt).toLocaleString(uiLanguage) })}
        </p>
        <p className="break-all rounded-lg border border-student-line bg-student-card px-3 py-2 font-mono text-xs text-student-ink" data-testid="issued-invitation-link">{url}</p>
        <div className="flex flex-wrap gap-2">
          <CopyButton value={url} label={t("sa.inv.copyLink")} testId="button-copy-invite-link" />
          <CopyButton value={invitation.token} label={t("sa.inv.copyCode")} testId="button-copy-invite-code" />
        </div>
      </div>
    </StaffNotice>
  );
}
