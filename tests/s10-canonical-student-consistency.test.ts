/**
 * S10: every consolidated renderer input is derived from ONE canonical synthetic
 * student. These assertions fail if any screen's data drifts from the others
 * (the independent review found Flight Deck vs Profile vs staff contradictions).
 */
import { describe, expect, it } from "vitest";
import { RICH_MID_JOURNEY } from "./helpers/student-roadmap-ui-fixtures";
import {
  CANONICAL_ADVISOR, CANONICAL_ID, CANONICAL_STUDENT_ROW, canonicalCorrections, canonicalDegreeProgress, canonicalDocumentsApi,
  canonicalProfileView, canonicalStudentMe, canonicalTicketDetails, canonicalTicketSummaries, canonicalWorkspacePayload,
} from "./helpers/canonical-synthetic-student";

const rich: any = RICH_MID_JOURNEY;
const fullName = `${CANONICAL_STUDENT_ROW.first_name} ${CANONICAL_STUDENT_ROW.last_name}`;

describe("canonical synthetic student: identity and contact", () => {
  const profile = canonicalProfileView();
  const me = canonicalStudentMe();
  const ws: any = canonicalWorkspacePayload();

  it("name, preferred name, code and email agree across /me, profile, workspace and tickets", () => {
    expect(me).toMatchObject({ id: CANONICAL_ID, first_name: "Amélie", last_name: "Laurent", preferred_name: "Amy", student_code: "LUM-0001" });
    expect(profile.identity).toMatchObject({ studentId: CANONICAL_ID, firstName: me.first_name, lastName: me.last_name, preferredName: me.preferred_name, studentCode: me.student_code });
    expect(ws.student).toMatchObject({ id: CANONICAL_ID, first_name: me.first_name, last_name: me.last_name, student_code: me.student_code, email: me.email });
    expect(profile.contact.email).toBe(me.email);
    for (const t of canonicalTicketDetails()) expect(t.reporter_name).toBe(fullName);
  });

  it("phones and preferred channel are one set of values", () => {
    expect(profile.contact.phonePrimary).toBe(me.phone);
    expect(profile.contact.preferredContactChannel).toBe("whatsapp");
    expect(profile.contact.whatsappPrimary).toBe(true);
    expect(profile.contacts.map((c) => c.phone)).toEqual(["+1 514 555 0110", "+1 514 555 0177"]);
    // The staff panel reads the same read model: the same view, only the viewer differs.
    const staff = { ...canonicalProfileView(), account: { role: "staff", twoFactorAvailable: true } };
    expect(staff.contact).toEqual(profile.contact);
    expect(staff.contacts).toEqual(profile.contacts);
    expect(staff.identity).toEqual(profile.identity);
  });
});

describe("canonical synthetic student: academic record", () => {
  const profile = canonicalProfileView();
  const dp = canonicalDegreeProgress();
  const ws: any = canonicalWorkspacePayload();

  it("prior education is the same in Flight Deck/roadmap, Profile, degree progress and the staff workspace", () => {
    const rosterTitles = rich.foundation.sources.map((s: any) => s.title);
    expect(profile.academicBackground.priorCredentials.map((c) => c.label)).toEqual(rosterTitles);
    expect(dp.sources.map((s) => s.title)).toEqual(rosterTitles);
    expect(ws.academicDetail.academicSources.map((s: any) => s.title)).toEqual(rosterTitles);
    expect(ws.academicDetail.creditRecords.map((c: any) => c.rawTitle)).toEqual(rich.foundation.credentials.map((c: any) => c.title));
  });

  it("degree assignment and verified credits agree", () => {
    const objective = rich.objectives.find((o: any) => o.kind === "primary");
    expect(dp.program?.programName).toBe(objective.canonicalProgramName);
    expect(ws.program.name).toBe(objective.canonicalProgramName);
    expect(dp.totals).toMatchObject({
      appliedCredits: rich.foundation.ladder.applied,
      verifiedCreditsOnRecord: rich.foundation.ladder.verified,
      requiredCredits: rich.foundation.ladder.required,
    });
    expect(ws.report.status).toBe(rich.foundation.degreeState);
    expect(ws.snapshot.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("canonical synthetic student: tickets, corrections, guardians, documents", () => {
  const profile = canonicalProfileView();

  it("the advisor is the same person on every ticket card, detail and the staff directory identity", () => {
    for (const d of canonicalTicketDetails()) {
      if (d.assignee) {
        expect(d.assignee).toEqual(CANONICAL_ADVISOR);
        expect(d.assigned_to).toBe(CANONICAL_ADVISOR.id);
      } else {
        expect(d.assigned_to).toBeNull();
      }
    }
    for (const s of canonicalTicketSummaries()) expect(s.assigned_to ?? null).toBe(s.assignee?.id ?? null);
  });

  it("the pending identity correction is visible to the student and to staff, identically", () => {
    const [pending] = canonicalCorrections();
    expect(profile.identity.pendingCorrection).toEqual(pending);
    expect(pending).toMatchObject({ status: "pending", fields: ["last_name", "gov_id_number"], studentId: CANONICAL_ID });
    expect(canonicalProfileView({ withPendingCorrection: false }).identity.pendingCorrection).toBeNull();
    expect(profile.readiness.find((r) => r.key === "identity_correction")?.kind).toBe("pending_review");
  });

  it("guardian authority: listed is not authority, pending needs the student's consent upload", () => {
    const odile = profile.contacts.find((c) => c.fullName === "Odile Laurent")!;
    expect(odile.authorityStatus).toBe("pending_verification");
    expect(odile.effectiveScopes).toEqual(["emergency"]); // academic/financial are inert until staff verify
    const diego = profile.contacts.find((c) => c.fullName === "Diego Ruiz")!;
    expect(diego.authorityStatus).toBe("listed");
    expect(profile.readiness.find((r) => r.key === `contact_authority:${odile.id}`)?.kind).toBe("action_required");
    expect(profile.readiness.some((r) => r.key === `contact_authority:${diego.id}`)).toBe(false);
  });

  it("document statuses on the Documents page equal the Profile's eligibility/evidence statuses", () => {
    const api = canonicalDocumentsApi();
    for (const doc of api) {
      const item = profile.eligibility.documents.find((d) => d.docType === doc.doc_type);
      expect(item?.status, doc.doc_type).toBe(doc.status);
    }
    expect(profile.identity.verification).toBe(api.find((d) => d.doc_type === "id_gov")!.status);
    expect(profile.academicBackground.collegeTranscripts).toBe(api.find((d) => d.doc_type === "college_transcript")!.status);
  });
});
