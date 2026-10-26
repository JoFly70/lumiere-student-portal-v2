import React from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import type { StudentProfileView } from "@shared/student-profile-contract";
import { ProfileSection, Fact, FactGrid, SubCard, TextLink } from "./profile-ui";

export function AccountSection({ account, email }: { account: StudentProfileView["account"]; email: string }) {
  return (
    <ProfileSection id="account" title="My Account" description="Sign-in and security. Sign out any time from the menu." collapsible={{ summary: `Signed in as ${email}` }}>
      <div className="grid gap-4 md:grid-cols-2">
        <SubCard title="Account" testId="account-card">
          <FactGrid className="sm:grid-cols-1">
            <Fact label="Role" testId="fact-role"><span className="capitalize">{account.role}</span></Fact>
            <Fact label="Sign-in email" testId="fact-account-email">{email}</Fact>
          </FactGrid>
        </SubCard>
        <SubCard title="Security" testId="security-card">
          <div className="space-y-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-student-ink">
                <KeyRound className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
                Password
              </p>
              <TextLink href="/reset-password" testId="link-change-password">Change password</TextLink>
            </div>
            <div className="border-t border-student-line pt-3" data-testid="two-factor-note">
              <p className="flex items-center gap-2 text-sm font-medium text-student-ink">
                <ShieldCheck className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
                Two-step verification
              </p>
              <p className="mt-1 text-sm text-student-muted">
                {account.twoFactorAvailable
                  ? "Available for your account. It is set up and managed by Lumière support."
                  : "Not available for your account yet."}
              </p>
              {account.twoFactorAvailable && <TextLink href="/support">Ask support to turn it on</TextLink>}
            </div>
          </div>
        </SubCard>
      </div>
    </ProfileSection>
  );
}
