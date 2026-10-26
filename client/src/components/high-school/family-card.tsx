/** "Family & guardians": who is listed, their standing, and what Lumière may discuss. Contacts are edited in Profile (S09). */
import React from "react";
import { Link } from "wouter";
import { ArrowRight, UsersRound } from "lucide-react";
import type { HsGuardianView } from "@shared/high-school-contract";
import { GUARDIAN_EXPLAINER, guardianSharingLabel, guardianStandingView } from "@/pages/high-school-presentation";
import { StatusPill, buttonClass } from "@/components/student-progress/student-ui";
import { Panel } from "./hs-ui";

export const CONTACTS_HREF = "/profile#section-contacts";

export function FamilyCard({ guardians }: { guardians: readonly HsGuardianView[] }) {
  return (
    <Panel title="Family & guardians" headingId="hs-family" testId="family-card">
      <p className="flex items-start gap-2 text-sm leading-relaxed text-student-muted" data-testid="guardian-explainer">
        <UsersRound className="mt-0.5 h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />
        <span>{GUARDIAN_EXPLAINER}</span>
      </p>
      {guardians.length === 0 ? (
        <p className="text-sm text-student-muted" data-testid="guardians-empty">No parent or guardian is listed yet.</p>
      ) : (
        <ul className="divide-y divide-student-line" aria-label="Parents and guardians" data-testid="guardian-list">
          {guardians.map((g) => {
            const st = guardianStandingView(g.standing);
            return (
              <li key={g.contactId} className="space-y-1 py-3 first:pt-0 last:pb-0" data-testid="guardian-row" data-standing={g.standing}>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-semibold text-student-ink">
                    {g.fullName} <span className="font-normal text-student-muted">· {g.relationship}</span>
                  </p>
                  <StatusPill status={st.key} label={st.label} />
                </div>
                <p className="text-sm text-student-muted">
                  {st.detail} {guardianSharingLabel(g)} <span data-testid="no-portal-access">No portal access.</span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <Link href={CONTACTS_HREF} className={buttonClass.link} data-testid="link-manage-contacts">
        Manage contacts in your profile
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </Panel>
  );
}
