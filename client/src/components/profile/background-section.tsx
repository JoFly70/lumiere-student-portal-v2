import React from "react";
import type { EvidenceStatus, ProfileAcademicBackground } from "@shared/student-profile-contract";
import { CollapsibleList, ProfileSection, Fact, FactGrid, ReadOnlyNote, StatusChip, SubCard, TextLink } from "./profile-ui";
import { evidenceChip, hsPathLabel } from "./profile-presentation";
import { pt } from "./pt";

function EvidenceRow({ label, status, testId }: { label: string; status: EvidenceStatus; testId?: string }) {
  const chip = evidenceChip(status);
  return (
    <li className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 border-b border-student-line py-2 last:border-b-0" data-testid={testId}>
      <span className="text-sm text-student-ink">{label}</span>
      <StatusChip label={chip.label} tone={chip.tone} />
    </li>
  );
}

export function BackgroundSection({ background }: { background: ProfileAcademicBackground }) {
  const hs = background.highSchool;
  return (
    <ProfileSection
      id="background"
      title={pt("My Academic Background")}
      description={pt("What Lumière has on record about your schooling before Lumière. This is maintained by your advisor and the registrar, so it is read-only here.")}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <SubCard
          title={pt("High school")}
          testId="highschool-card"
          action={
            <StatusChip
              label={hs.completionRecorded ? pt("Completion recorded") : pt("Not recorded yet")}
              tone={hs.completionRecorded ? "neutral" : "missing"}
              testId="hs-recorded"
            />
          }
        >
          <FactGrid>
            <Fact label={pt("Path")} testId="fact-hs-path">{hs.path ? hsPathLabel(hs.path) : null}</Fact>
            <Fact label={pt("School")} testId="fact-hs-school">{hs.school}</Fact>
            <Fact label={pt("Country")} testId="fact-hs-country">{hs.country}</Fact>
            <Fact label={pt("Year")} testId="fact-hs-year">{hs.year ? String(hs.year) : null}</Fact>
          </FactGrid>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-student-line pt-3">
            <span className="text-sm text-student-ink">{pt("Proof of completion")}</span>
            <StatusChip {...evidenceChip(hs.evidence)} testId="hs-evidence" />
          </div>
          {hs.completionRecorded && hs.evidence !== "verified" && (
            <p className="mt-2 text-xs text-student-muted" data-testid="hs-recorded-note">
              {pt("Recorded does not mean verified. Lumière marks it verified after reviewing your proof.")}
            </p>
          )}
        </SubCard>

        <SubCard title={pt("Education evidence on file")} testId="evidence-card">
          <ul>
            <EvidenceRow label={pt("Foreign credential evaluation")} status={background.foreignEvaluation} testId="ev-foreign" />
            <EvidenceRow label={pt("College transcripts")} status={background.collegeTranscripts} testId="ev-transcripts" />
            <EvidenceRow label={pt("Degree certificate")} status={background.degreeCertificate} testId="ev-degree" />
          </ul>
        </SubCard>
      </div>

      <SubCard title={pt("Prior credentials")} testId="prior-credentials">
        {background.priorCredentials.length === 0 ? (
          <p className="text-sm text-student-muted" data-testid="prior-credentials-empty">
            {background.priorCreditsReported
              ? pt("You reported prior learning, but no credentials are recorded yet. Your advisor will add them after reviewing your documents.")
              : pt("No prior credentials are recorded. That is fine if you are starting fresh.")}
          </p>
        ) : (
          <CollapsibleList className="divide-y divide-student-line" label={pt("credentials")} items={background.priorCredentials.map((c, i) => (
              <li key={`${c.label}-${i}`} className="flex flex-wrap items-start justify-between gap-2 py-3" data-testid="prior-credential">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-student-ink">{c.label}</p>
                  {(c.institution || c.detail) && (
                    <p className="text-sm text-student-muted">{[c.institution, c.detail].filter(Boolean).join(" · ")}</p>
                  )}
                </div>
                {c.status && <span className="text-xs text-student-muted">{c.status}</span>}
              </li>
            ))} />
        )}
      </SubCard>

      <ReadOnlyNote>{pt("To correct something here, tell your advisor or upload proof in Documents.")}</ReadOnlyNote>
      <div className="flex flex-wrap gap-x-6">
        <TextLink href="/roadmap" testId="link-roadmap">{pt("See your academic foundation")}</TextLink>
        <TextLink href="/documents" testId="link-documents-background">{pt("Open Documents")}</TextLink>
      </div>
    </ProfileSection>
  );
}
