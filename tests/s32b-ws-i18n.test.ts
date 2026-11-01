import React from "react";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, translate } from "../client/src/i18n";
import { StudentFileHsOverview, StudentFileHsAcademics, contractGates, enrollmentCheckpoints } from "../client/src/components/admin/student-file-hs";
import { NextStepBanner, nextStep } from "../client/src/components/admin/dossier/dossier-parts";
import { BillingSummaryCard } from "../client/src/components/admin/billing/billing-summary-card";
import { StudentProfileReviewView } from "../client/src/components/admin/student-profile-review";
import { StudentPortalAccountCard, accountQueryKey, errorMessage } from "../client/src/components/admin/student-portal-account-card";
import { creditRecordStanding, formatWorkspaceDateTime, tokenLabel, workspaceProgressStatusLabel } from "../client/src/pages/admin-student-workspace-presentation";

// student-profile-review.tsx relies on the classic JSX runtime (global React) under vitest, like tests/s09-staff-profile-review.test.ts.
vi.stubGlobal("React", React);

const fr = (key: string, vars?: Record<string, string | number>) => translate("fr", key, vars);
const frT = fr as never;

function render(node: React.ReactElement, lang: "en" | "fr", client = new QueryClient()) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, { initialLanguage: lang },
      React.createElement(QueryClientProvider, { client },
        React.createElement(Router, { ssrPath: "/x" }, node))),
  );
}

const course = (key: string, title: string, halfUnits: number) => ({ key, title, areaKey: "core", halfUnits, status: "planned", replacesCourseKey: null, plannedStart: "2026-11-01", plannedEnd: "2026-12-15", tasks: [] });
const state: any = {
  studentId: "s1", enrollments: [], hasUniversityProgram: false, guardians: [], events: [],
  current: {
    enrollment: { id: "e1", status: "active", programTitle: "Ontario Secondary School Diploma", startedOn: "2026-10-01", targetCompletionDate: "2027-06-30", institutionDisclosed: false, schoolStudentRef: null },
    published: { versionNumber: 2, content: { courses: [course("a", "English 11", 2), course("b", "TEST ONLY Course", 1)] } },
    draft: null,
    credits: { requiredHalfUnits: 60, earnedHalfUnits: 4, awaitingConfirmationHalfUnits: 1, remainingHalfUnits: 56, core: { requiredHalfUnits: 36, earnedHalfUnits: 4 }, elective: { requiredHalfUnits: 24, earnedHalfUnits: 0 } },
    reviewQueue: [{ courseKey: "a" }], results: [], priorEducation: [], graduation: { status: "in_progress" },
  },
};
const student = { id: "s1", status: "active", user_id: null };

describe("S32-B workspace i18n — French rendering", () => {
  it("renders the older student-file overview in French", () => {
    const html = render(React.createElement(StudentFileHsOverview, { studentId: "s1", student, state, attention: [] }), "fr");
    expect(html).toContain("Étapes de l’inscription");
    expect(html).toContain("Officiellement acquis");
    expect(html).toContain("Étapes du contrat et de la préinscription");
    expect(html).toContain("Compte du portail");
    expect(html).toContain("0,5");
    for (const en of ["Enrollment checkpoints", "Officially earned", "Contract and pre-enrollment gates", "Portal account linked", "Reported, awaiting confirmation"]) {
      expect(html).not.toContain(en);
    }
    const academics = render(React.createElement(StudentFileHsAcademics, { studentId: "s1", state }), "fr");
    expect(academics).toContain("Feuille de route des cours");
    expect(academics).toContain("Approbation en attente");
    expect(academics).not.toContain("Course roadmap");
    expect(academics).not.toContain("Approval pending");
  });

  it("keeps the same overview in English by default", () => {
    const html = render(React.createElement(StudentFileHsOverview, { studentId: "s1", student, state, attention: [] }), "en");
    expect(html).toContain("Enrollment checkpoints");
    expect(html).toContain("Officially earned");
    expect(html).not.toContain("Étapes de l’inscription");
  });

  it("translates the pure helpers through an optional translator and defaults to English", () => {
    expect(enrollmentCheckpoints({ student, state })[0]!.label).toBe("Portal account linked");
    expect(enrollmentCheckpoints({ student, state }, frT)[0]!.label).toBe("Compte du portail lié");
    expect(contractGates({ state })[0]!.label).toBe("Agreement signed by both parties");
    expect(contractGates({ state }, frT)[0]!.label).toBe("Entente signée par les deux parties");
    expect(contractGates({ state }, frT)[0]!.detail).toBe("Aucune entente au dossier.");
    expect(nextStep({ status: "active", profileDecisions: 2, docsPending: 0, supportAwaiting: 0 }, "s1").title).toBe("Decide 2 identity or guardian requests");
    expect(nextStep({ status: "active", profileDecisions: 2, docsPending: 0, supportAwaiting: 0 }, "s1", frT).title).toBe("Statuer sur 2 demandes d’identité ou de tutelle");
    expect(creditRecordStanding("pending").label).toBe("Waiting for verification");
    expect(creditRecordStanding("pending", frT).label).toBe("En attente de vérification");
    expect(workspaceProgressStatusLabel("in_progress")).toBe("In progress");
    expect(workspaceProgressStatusLabel("in_progress", frT)).toBe("En cours");
    expect(workspaceProgressStatusLabel(undefined, frT)).toBe("Pas encore signalé");
    expect(tokenLabel("MANUAL_REVIEW", frT)).toBe("Revue manuelle");
    expect(tokenLabel("something_new", frT)).toBe("Something new");
    expect(formatWorkspaceDateTime("2026-10-25T09:00:00.000Z", "UTC")).toBe("Oct 25, 2026 · 9:00");
    expect(formatWorkspaceDateTime("2026-10-25T09:00:00.000Z", "UTC", "fr")).toBe("25 oct. 2026 · 9 h 00");
    expect(errorMessage(new Error("404: nf"))).toBe("This record was not found.");
    expect(errorMessage(new Error("404: nf"), "", frT)).toBe("Cet enregistrement est introuvable.");
  });

  it("renders the next-step banner and billing summary in French", () => {
    const step = nextStep({ status: "lead", profileDecisions: 0, docsPending: 3, supportAwaiting: 0 }, "s1", frT);
    const banner = render(React.createElement(NextStepBanner, { step, onTab: () => undefined, experience: { pending: false, error: null, run: async () => undefined, dismiss: () => undefined } }), "fr");
    expect(banner).toContain("Prochaine étape");
    expect(banner).toContain("Examiner 3 documents téléversés");
    expect(banner).not.toContain("Next step");
    const billing = render(React.createElement(BillingSummaryCard, { studentId: "s1" }), "fr");
    expect(billing).toContain("Résumé de la facturation");
    expect(billing).toContain("Aucun montant convenu pour l’instant");
    expect(billing).not.toContain("Billing summary");
    expect(billing).not.toContain("No agreed amount yet");
  });

  it("renders the Guardian & identity panel in French", () => {
    const profile: any = {
      identity: { studentId: "s1", studentCode: "LUM-1", firstName: "Sam", middleName: null, lastName: "Smyth", preferredName: null, dob: null, sex: null, nationality: [], govIdType: null, govIdNumberMasked: null, photoUrl: null, verification: "not_submitted", pendingCorrection: null, lastResolvedCorrection: null },
      contact: { email: "sam@example.test", emailVerified: true, phonePrimary: null, phoneSecondary: null, whatsappPrimary: false, timezone: null, preferredContactChannel: "email", addressLine1: null, addressLine2: null, addressCity: null, addressState: null, addressPostal: null, addressCountry: null, marketingOptIn: false, mediaRelease: false },
      contacts: [{ id: "c1", type: "guardian", fullName: "Gina Guardian", relationship: "Mère", phone: "+15550001111", email: null, language: null, requestedScopes: ["academic"], effectiveScopes: [], authorityStatus: "pending_verification", authorityVerifiedAt: null, authorityNote: null, hasPortalAccess: false, createdAt: "2026-10-01T00:00:00.000Z" }],
    };
    const html = render(React.createElement(StudentProfileReviewView, { profile, history: [], studentId: "s1" }), "fr");
    expect(html).toContain("Profil et identité");
    expect(html).toContain("Identité légale");
    expect(html).toContain("Déclaré par l’étudiant");
    expect(html).toContain("Autorité demandée · en attente de vérification");
    expect(html).toContain("Vérifier l’autorité…");
    expect(html).toMatch(/Accès au portail\s*: aucun/); // frTypo puts a no-break space before the colon
    for (const en of ["Legal identity", "Contact information", "Reported by student", "Verify authority", "Portal access: none", "Correction history"]) {
      expect(html).not.toContain(en);
    }
  });

  it("offers an EN/FR invitation choice defaulting to the UI language and says older codes are revoked", () => {
    const client = new QueryClient();
    client.setQueryData(accountQueryKey("s1"), { studentId: "s1", studentEmail: "sam@example.test", linked: false, account: null, candidates: [] });
    const frHtml = render(React.createElement(StudentPortalAccountCard, { studentId: "s1" }), "fr", client);
    expect(frHtml).toContain("Langue de l’invitation");
    expect(frHtml).toContain("Émettre l’invitation au portail");
    expect(frHtml).toContain("révoque tout code antérieur non utilisé");
    expect(frHtml).toMatch(/checked=""[^>]*value="fr"/);
    expect(frHtml).not.toMatch(/checked=""[^>]*value="en"/);
    expect(frHtml).not.toContain("Issue portal invitation");
    const enHtml = render(React.createElement(StudentPortalAccountCard, { studentId: "s1" }), "en", client);
    expect(enHtml).toContain("Language of the invitation");
    expect(enHtml).toContain("Issue portal invitation");
    expect(enHtml).toContain("revokes any earlier unclaimed code");
    expect(enHtml).toMatch(/checked=""[^>]*value="en"/);
  });
});
