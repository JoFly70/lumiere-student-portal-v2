import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  IdentityCorrectionRequestView,
  StudentContactView,
  StudentProfileView,
} from "@shared/student-profile-contract";

vi.stubGlobal("React", React);
vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ isLoading: false, isError: false, data: undefined, refetch: vi.fn() })),
  useMutation: vi.fn(() => ({ isPending: false, mutate: vi.fn() })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

import { StudentProfileReviewView, CorrectionTable } from "@/components/admin/student-profile-review";
import {
  STAFF_PROFILE_PATHS,
  authorityBody,
  authorityDecisionGate,
  authorityTrust,
  classifyResolveFailure,
  contactActions,
  correctionDecisionGate,
  correctionRows,
  identityTrust,
  normalizeHistory,
  resolveBody,
} from "@/components/admin/student-profile-review-logic";

const pending: IdentityCorrectionRequestView = {
  id: "req-1", studentId: "stu-1", status: "pending", fields: ["last_name", "gov_id_number"],
  currentDisplay: { last_name: "Smyth", gov_id_number: "•••• 1111" },
  requestedDisplay: { last_name: "Smith", gov_id_number: "•••• 4821" },
  reason: "Passport spelling differs from what was entered.", evidenceDocumentId: "doc-1",
  createdAt: "2026-10-20T10:00:00.000Z", reviewedAt: null, reviewNote: null, reviewerUserId: null,
};
const rejectedOld: IdentityCorrectionRequestView = { ...pending, id: "req-0", status: "rejected", fields: ["dob"], currentDisplay: { dob: "1990-01-01" }, requestedDisplay: { dob: "1991-01-01" }, reviewedAt: "2026-10-10T10:00:00.000Z", reviewNote: "Document did not match.", reviewerUserId: "staff-1" };
const contact = (over: Partial<StudentContactView>): StudentContactView => ({
  id: "c-1", type: "guardian", fullName: "Gina Guardian", relationship: "Mother", phone: "+15550001111", email: null, language: null,
  requestedScopes: ["emergency", "academic"], effectiveScopes: ["emergency"], authorityStatus: "pending_verification",
  authorityVerifiedAt: null, authorityNote: null, hasPortalAccess: false, createdAt: "2026-10-01T00:00:00.000Z", ...over,
});
const profile = (over: { verification?: StudentProfileView["identity"]["verification"]; pendingCorrection?: IdentityCorrectionRequestView | null; contacts?: StudentContactView[] } = {}): StudentProfileView => ({
  identity: {
    studentId: "stu-1", studentCode: "LUM-0001", firstName: "Sam", middleName: null, lastName: "Smyth", preferredName: null,
    dob: "1990-01-01", sex: null, nationality: ["US"], govIdType: "Passport", govIdNumberMasked: "•••• 1111", photoUrl: null,
    verification: over.verification ?? "not_submitted", pendingCorrection: over.pendingCorrection === undefined ? pending : over.pendingCorrection, lastResolvedCorrection: null,
  },
  contact: {
    email: "sam@synthetic.example", emailVerified: true, phonePrimary: "+15550000000", phoneSecondary: null, whatsappPrimary: false, timezone: null,
    preferredContactChannel: "email", addressLine1: "1 Synthetic Way", addressLine2: null, addressCity: "Austin", addressState: "TX", addressPostal: "78701", addressCountry: "US",
    marketingOptIn: false, mediaRelease: false,
  },
  contacts: over.contacts ?? [contact({})],
  academicBackground: {
    highSchool: { completionRecorded: false, path: null, school: null, country: null, year: null, evidence: "not_submitted" },
    priorCredentials: [], priorCreditsReported: false, foreignEvaluation: "not_submitted", collegeTranscripts: "not_submitted", degreeCertificate: "not_submitted",
  },
  eligibility: { residency: null, residencyEvidence: "not_submitted", englishProficiency: { meetsRequirement: null, proofType: null, evidence: "not_submitted" }, documents: [] },
  readiness: [], account: { role: "student", twoFactorAvailable: false }, generatedAt: "2026-10-26T00:00:00.000Z",
});
const html = (p: StudentProfileView, history: IdentityCorrectionRequestView[] = [rejectedOld]) =>
  renderToStaticMarkup(React.createElement(StudentProfileReviewView, { profile: p, history, studentId: "stu-1" }));

describe("S09 staff profile review — trust language", () => {
  it("only a verified id document reads as Verified by Lumière", () => {
    expect(identityTrust("verified").label).toBe("Verified by Lumière");
    for (const s of ["not_submitted", "pending", "rejected", "resubmit_requested"] as const) {
      expect(identityTrust(s).label).toMatch(/^Reported by student/);
      expect(identityTrust(s).tone).not.toBe("verified");
    }
  });
  it("a fully populated identity without verified evidence is still 'Reported by student'", () => {
    const out = html(profile({ verification: "not_submitted" }));
    expect(out).toContain("Reported by student");
    expect(out).not.toContain("Verified by Lumière");
    expect(html(profile({ verification: "verified" }))).toContain("Verified by Lumière");
  });
  it("authority labels come from authority status, not requested scopes", () => {
    expect(authorityTrust("verified").tone).toBe("verified");
    expect(authorityTrust("pending_verification").label).toMatch(/awaiting verification/);
    expect(authorityTrust("listed").label).toMatch(/no authority/);
    expect(authorityTrust("revoked").tone).toBe("problem");
    const out = html(profile({ contacts: [contact({ requestedScopes: ["academic", "financial"], effectiveScopes: [], authorityStatus: "pending_verification" })] }));
    expect(out).not.toContain("Authority verified by Lumière");
    expect(out).toContain("Portal access: none");
  });
});

describe("S09 staff profile review — pending correction", () => {
  it("shows current vs requested values, reason, approve/reject and a documents link", () => {
    const out = html(profile());
    expect(out).toContain('data-testid="pending-correction"');
    expect(out).toContain("Smyth");
    expect(out).toContain("Smith");
    expect(out).toContain("•••• 4821");
    expect(out).toContain("Passport spelling differs");
    expect(out).toContain("Approve…");
    expect(out).toContain("Reject…");
    expect(out).toContain("/admin/students/stu-1#workspace-documents");
    expect(out).toContain("Approving does not change document verification");
  });
  it("omits the pending card when there is no pending request", () => {
    expect(html(profile({ pendingCorrection: null }))).not.toContain('data-testid="pending-correction"');
  });
  it("renders accessible current/requested table", () => {
    const out = renderToStaticMarkup(React.createElement(CorrectionTable, { request: pending }));
    expect(out).toContain('scope="col"');
    expect(out).toContain('scope="row"');
    expect(correctionRows(pending).map((r) => r.label)).toEqual(["Last name", "Government ID number"]);
  });
  it("shows unmasked government id nowhere: only masked display values are rendered", () => {
    expect(html(profile())).not.toMatch(/(?<![+\d])\d{8,}/);
  });
  it("lists resolved history with reviewer note", () => {
    const out = html(profile());
    expect(out).toContain('data-testid="correction-history-item"');
    expect(out).toContain("Rejected");
    expect(out).toContain("Document did not match.");
  });
});

describe("S09 staff profile review — decisions", () => {
  it("rejection requires a note of 5+ characters; approval does not", () => {
    expect(correctionDecisionGate("reject", "").ok).toBe(false);
    expect(correctionDecisionGate("reject", "  no ").ok).toBe(false);
    expect(correctionDecisionGate("reject", "Name matches passport").ok).toBe(true);
    expect(correctionDecisionGate("approve", "").ok).toBe(true);
    expect(resolveBody("approve", "  ")).toEqual({ decision: "approve" });
    expect(resolveBody("reject", " not supported ")).toEqual({ decision: "reject", note: "not supported" });
  });
  it("authority verify/revoke both require an audit note", () => {
    expect(authorityDecisionGate("ok").ok).toBe(false);
    expect(authorityDecisionGate("Checked court order, doc 123").ok).toBe(true);
    expect(authorityBody("verify", " checked order ")).toEqual({ decision: "verify", note: "checked order" });
  });
  it("offers verify for pending, revoke for verified", () => {
    expect(contactActions({ authorityStatus: "pending_verification" })).toEqual({ canVerify: true, canRevoke: true });
    expect(contactActions({ authorityStatus: "verified" })).toEqual({ canVerify: false, canRevoke: true });
    expect(contactActions({ authorityStatus: "revoked" }).canRevoke).toBe(false);
    const verified = html(profile({ contacts: [contact({ authorityStatus: "verified", effectiveScopes: ["emergency", "academic"] })] }));
    expect(verified).toContain("Revoke…");
    expect(verified).not.toContain("Verify authority…");
    // A never-granted request is declined, not "revoked".
    const pending = html(profile({ contacts: [contact({ authorityStatus: "pending_verification", requestedScopes: ["emergency", "financial"], effectiveScopes: ["emergency"] })] }));
    expect(pending).toContain("Decline request…");
    expect(pending).not.toContain("Revoke…");
  });
  it("maps failures to calm messages and uses the contract endpoints", () => {
    expect(classifyResolveFailure(409).kind).toBe("conflict");
    expect(classifyResolveFailure(403).kind).toBe("forbidden");
    expect(classifyResolveFailure(422).kind).toBe("invalid");
    expect(classifyResolveFailure(500).kind).toBe("other");
    expect(STAFF_PROFILE_PATHS.resolve("r/1")).toBe("/api/students/identity-corrections/r%2F1/resolve");
    expect(STAFF_PROFILE_PATHS.authority("c1")).toBe("/api/students/contacts/c1/authority");
    expect(STAFF_PROFILE_PATHS.profile("s1")).toBe("/api/students/s1/profile");
  });
  it("normalizes history payload shapes", () => {
    expect(normalizeHistory([pending])).toHaveLength(1);
    expect(normalizeHistory({ requests: [pending, rejectedOld] })).toHaveLength(2);
    expect(normalizeHistory(null)).toEqual([]);
  });
});
