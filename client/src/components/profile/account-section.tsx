import React from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import type { StudentProfileView } from "@shared/student-profile-contract";
import { ProfileSection, Fact, FactGrid, SubCard, TextLink } from "./profile-ui";
import { pt } from "./pt";

export function AccountSection({ account, email }: { account: StudentProfileView["account"]; email: string }) {
  return (
    <ProfileSection id="account" title={pt("My Account")} description={pt("Sign-in and security. Sign out any time from the menu.")} collapsible={{ summary: pt("Signed in as {email}", { email }) }}>
      <div className="grid gap-4 md:grid-cols-2">
        <SubCard title={pt("Account")} testId="account-card">
          <FactGrid className="sm:grid-cols-1">
            <Fact label={pt("Role")} testId="fact-role"><span className="capitalize">{account.role}</span></Fact>
            <Fact label={pt("Sign-in email")} testId="fact-account-email">{email}</Fact>
          </FactGrid>
        </SubCard>
        <SubCard title={pt("Security")} testId="security-card">
          <div className="space-y-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-student-ink">
                <KeyRound className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
                {pt("Password")}
              </p>
              <TextLink href="/reset-password" testId="link-change-password">{pt("Change password")}</TextLink>
            </div>
            <div className="border-t border-student-line pt-3" data-testid="two-factor-note">
              <p className="flex items-center gap-2 text-sm font-medium text-student-ink">
                <ShieldCheck className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
                {pt("Two-step verification")}
              </p>
              <p className="mt-1 text-sm text-student-muted">
                {account.twoFactorAvailable
                  ? pt("Available for your account. It is set up and managed by Lumière support.")
                  : pt("Not available for your account yet.")}
              </p>
              {account.twoFactorAvailable && <TextLink href="/support">{pt("Ask support to turn it on")}</TextLink>}
            </div>
          </div>
        </SubCard>
      </div>
    </ProfileSection>
  );
}
