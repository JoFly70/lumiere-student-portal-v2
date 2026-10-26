import React from "react";
import type { ProfileEligibility } from "@shared/student-profile-contract";
import { Link } from "wouter";
import { ProfileSection, Fact, FactGrid, ReadOnlyNote, StatusChip, SubCard } from "./profile-ui";
import { buttonClass } from "@/components/student-progress/student-ui";
import { evidenceChip, needsUpload, residencyLabel } from "./profile-presentation";

export function EligibilitySection({ eligibility }: { eligibility: ProfileEligibility }) {
  const eng = eligibility.englishProficiency;
  const engLabel =
    eng.meetsRequirement === true ? "Meets the requirement" : eng.meetsRequirement === false ? "Not yet met" : "Not recorded";
  const engTone = eng.meetsRequirement === true ? "verified" : eng.meetsRequirement === false ? "attention" : "missing";
  return (
    <ProfileSection
      id="eligibility"
      eyebrow="Section 5"
      title="Academic Eligibility & Documentation"
      description="Lumière confirms your eligibility from the documents you provide. You cannot mark anything verified yourself. Upload proof and our team does the rest."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <SubCard title="Residency" testId="residency-card">
          <FactGrid className="sm:grid-cols-1">
            <Fact label="Classification" testId="fact-residency">
              {eligibility.residency ? residencyLabel(eligibility.residency) : null}
            </Fact>
          </FactGrid>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-student-line pt-3">
            <span className="text-sm text-student-ink">Supporting evidence</span>
            <StatusChip {...evidenceChip(eligibility.residencyEvidence)} testId="residency-evidence" />
          </div>
        </SubCard>

        <SubCard title="English proficiency" testId="english-card" action={<StatusChip label={engLabel} tone={engTone} testId="english-status" />}>
          <FactGrid className="sm:grid-cols-1">
            <Fact label="Proof type" testId="fact-english-proof" empty="None recorded">{eng.proofType}</Fact>
          </FactGrid>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-student-line pt-3">
            <span className="text-sm text-student-ink">Supporting evidence</span>
            <StatusChip {...evidenceChip(eng.evidence)} testId="english-evidence" />
          </div>
        </SubCard>
      </div>

      <SubCard title="Documents" testId="eligibility-documents">
        {eligibility.documents.length === 0 ? (
          <p className="text-sm text-student-muted" data-testid="documents-empty">No documents are required of you right now.</p>
        ) : (
          <ul className="divide-y divide-student-line">
            {eligibility.documents.map((d) => {
              const chip = evidenceChip(d.status);
              return (
                <li key={d.docType} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="eligibility-document" data-status={d.status}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-student-ink">{d.label}</p>
                    <p className="text-xs text-student-muted">{d.requiredForEnrollment ? "Required for enrollment" : "Optional"}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip label={chip.label} tone={chip.tone} />
                    {needsUpload(d.status) && (
                      <Link href="/documents" className={buttonClass.outline} aria-label={`Upload ${d.label} in Documents`} data-testid="link-upload-document">
                        Upload in Documents
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SubCard>
      <ReadOnlyNote>This section is read-only. Residency, English proficiency and document status are set by Lumière after review.</ReadOnlyNote>
    </ProfileSection>
  );
}
