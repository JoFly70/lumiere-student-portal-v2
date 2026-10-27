import React from "react";
import type { ProfileEligibility } from "@shared/student-profile-contract";
import { Link } from "wouter";
import { CollapsibleList, ProfileSection, Fact, FactGrid, ReadOnlyNote, StatusChip, SubCard } from "./profile-ui";
import { buttonClass } from "@/components/student-progress/student-ui";
import { EDUCATION_DOC_TYPES, evidenceChip, needsUpload, residencyLabel } from "./profile-presentation";
import { pt } from "./pt";

export function EligibilitySection({ eligibility }: { eligibility: ProfileEligibility }) {
  const eng = eligibility.englishProficiency;
  // Education evidence (transcripts, degree, evaluation) lives under Academic Background.
  const documents = eligibility.documents.filter((d) => !EDUCATION_DOC_TYPES.has(d.docType));
  const engLabel =
    eng.meetsRequirement === true ? pt("Meets the requirement") : eng.meetsRequirement === false ? pt("Not yet met") : pt("Not recorded");
  const engTone = eng.meetsRequirement === true ? "verified" : eng.meetsRequirement === false ? "attention" : "missing";
  // Low-frequency: closed by default. The page-level readiness panel is where actions are surfaced.
  const redo = documents.filter((d) => d.status === "rejected" || d.status === "resubmit_requested").length;
  const summary = [
    eligibility.residency ? residencyLabel(eligibility.residency) : pt("Residency not recorded"),
    pt("English: {status}", { status: engLabel.toLowerCase() }),
    documents.length ? pt(documents.length === 1 ? "{n} document tracked" : "{n} documents tracked", { n: documents.length }) : pt("no documents required"),
    ...(redo ? [pt(redo === 1 ? "{n} needs a new copy" : "{n} need a new copy", { n: redo })] : []),
  ].join(" · ");
  return (
    <ProfileSection
      id="eligibility"
      title={pt("Academic Eligibility & Documentation")}
      description={pt("Lumière confirms your eligibility from the documents you provide. You cannot mark anything verified yourself. Upload proof and our team does the rest.")}
      collapsible={{ summary }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <SubCard title={pt("Residency")} testId="residency-card">
          <FactGrid className="sm:grid-cols-1">
            <Fact label={pt("Classification")} testId="fact-residency">
              {eligibility.residency ? residencyLabel(eligibility.residency) : null}
            </Fact>
          </FactGrid>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-student-line pt-3">
            <span className="text-sm text-student-ink">{pt("Supporting evidence")}</span>
            <StatusChip {...evidenceChip(eligibility.residencyEvidence)} testId="residency-evidence" />
          </div>
        </SubCard>

        <SubCard title={pt("English proficiency")} testId="english-card" action={<StatusChip label={engLabel} tone={engTone} testId="english-status" />}>
          <FactGrid className="sm:grid-cols-1">
            <Fact label={pt("Proof type")} testId="fact-english-proof" empty={pt("None recorded")}>{eng.proofType}</Fact>
          </FactGrid>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-student-line pt-3">
            <span className="text-sm text-student-ink">{pt("Supporting evidence")}</span>
            <StatusChip {...evidenceChip(eng.evidence)} testId="english-evidence" />
          </div>
        </SubCard>
      </div>

      <SubCard title={pt("Documents for eligibility")} testId="eligibility-documents">
        {documents.length === 0 ? (
          <p className="text-sm text-student-muted" data-testid="documents-empty">{pt("No documents are required of you right now.")}</p>
        ) : (
          <CollapsibleList className="divide-y divide-student-line" label={pt("documents")} items={documents.map((d) => {
              const chip = evidenceChip(d.status);
              return (
                <li key={d.docType} className="flex flex-wrap items-center justify-between gap-2 py-2.5 sm:gap-3 sm:py-3" data-testid="eligibility-document" data-status={d.status}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-student-ink">{d.label}</p>
                    <p className="text-xs text-student-muted">{d.requiredForEnrollment ? pt("Required for enrollment") : pt("Optional")}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip label={chip.label} tone={chip.tone} />
                    {needsUpload(d.status) && (
                      <Link href="/documents" className={buttonClass.outline} aria-label={pt("Upload {label} in Documents", { label: d.label })} data-testid="link-upload-document">
                        {pt("Upload in Documents")}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })} />
        )}
      </SubCard>
      <ReadOnlyNote>{pt("This section is read-only. Residency, English proficiency and document status are set by Lumière after review.")}</ReadOnlyNote>
    </ProfileSection>
  );
}
