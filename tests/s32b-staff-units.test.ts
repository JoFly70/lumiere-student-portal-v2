/**
 * S32-B pure-rule tests: next step on the Student File (SA-08), one "needs you" count (SA-15), enrollment derivation
 * (SA-07), signup error mapping EN/FR (SA-18), password policy (SA-35), agreement-driven gates (SA-26), staff menus
 * (SA-16, SA-13, SA-36) and the remembered return path (SA-19).
 */
import { describe, expect, it } from "vitest";
import { fileNextStep } from "../client/src/lib/file-decisions";
import { deriveEnrollmentStatus, invitationState } from "../shared/enrollment-status";
import { AuthRequestError, signUpErrorMessage } from "../client/src/lib/auth-errors";
import { translate } from "../client/src/i18n";
import { MIN_PASSWORD_LENGTH, passwordTooShort } from "../shared/password-policy";
import { contractGates } from "../client/src/components/admin/student-file-hs";
import { rememberReturnPath, takeReturnPath, forgetReturnPath } from "../client/src/lib/return-to";
import { RETURN_TO_STORAGE_KEY } from "../shared/staff-links";

const base = { status: "lead", isAdmin: true, programKind: "diploma" as const, profileDecisions: 0, supportAwaiting: 0, billingConfigured: true, studentId: "s1" };

describe("SA-08 next step on the Student File", () => {
  it("a brand-new lead without a program is told to set it up (never 'nothing is waiting')", () => {
    expect(fileNextStep({ ...base, programKind: "none" })).toMatchObject({ key: "s32.next.program", href: "/admin/students/s1/high-school" });
  });
  it("follows the Workspace order: identity, support, program, billing, enrollment, activation", () => {
    expect(fileNextStep({ ...base, profileDecisions: 2, supportAwaiting: 1, programKind: "none" })).toMatchObject({ key: "s32.next.identity", href: "/admin/students/s1/workspace#profile" });
    expect(fileNextStep({ ...base, supportAwaiting: 1 })).toMatchObject({ key: "s32.next.support", href: "/support?studentId=s1" });
    expect(fileNextStep({ ...base, billingConfigured: false })).toMatchObject({ key: "s32.next.billing", tab: "billing" });
    expect(fileNextStep({ ...base, enrollmentStage: "invited" })).toMatchObject({ key: "s32.next.enroll" });
    expect(fileNextStep({ ...base, enrollmentStage: "linked" })).toMatchObject({ key: "s32.next.activate" });
    expect(fileNextStep({ ...base, status: "active" })).toBeNull();
  });
  it("staff never get an admin-only destination", () => {
    expect(fileNextStep({ ...base, isAdmin: false, profileDecisions: 3 })?.href ?? "").not.toContain("/workspace");
    expect(fileNextStep({ ...base, isAdmin: false })).toMatchObject({ key: "s32.next.activateStaff" });
  });
  it("claims nothing about billing until it is loaded", () => {
    expect(fileNextStep({ ...base, status: "active", billingConfigured: undefined })).toBeNull();
  });
});

describe("SA-07 enrollment derivation (authoritative facts only)", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const inv = (o: Partial<{ consumedAt: string | null; revokedAt: string | null; expiresAt: string }>) =>
    invitationState({ createdAt: "2026-11-09T00:00:00Z", expiresAt: o.expiresAt ?? "2026-11-12T00:00:00Z", consumedAt: o.consumedAt ?? null, revokedAt: o.revokedAt ?? null }, now);
  it("maps each record state to one stage and one next action", () => {
    const d = (x: Partial<Parameters<typeof deriveEnrollmentStatus>[0]>) => deriveEnrollmentStatus({ studentEmail: "a@x.test", linked: false, candidateCount: 0, invitation: null, ...x });
    expect(d({ studentEmail: "" })).toMatchObject({ stage: "no_email", next: "add_email" });
    expect(d({})).toMatchObject({ stage: "not_invited", next: "send_invitation" });
    expect(d({ invitation: inv({}) })).toMatchObject({ stage: "invited", next: "wait_for_student" });
    expect(d({ invitation: inv({ expiresAt: "2026-11-10T00:00:00Z" }) })).toMatchObject({ stage: "invitation_lapsed", next: "resend_invitation" });
    expect(d({ invitation: inv({ revokedAt: "2026-11-10T00:00:00Z" }) }).stage).toBe("invitation_lapsed");
    expect(d({ invitation: inv({ consumedAt: "2026-11-10T00:00:00Z" }) })).toMatchObject({ stage: "accepted_no_account", next: "check_email" });
    expect(d({ candidateCount: 1, invitation: inv({ consumedAt: "2026-11-10T00:00:00Z" }) })).toMatchObject({ stage: "ready_to_link", next: "link_account" });
    expect(d({ linked: true, candidateCount: 1 })).toMatchObject({ stage: "linked", next: "none" });
  });
});

describe("SA-18 signup errors are translated and actionable", () => {
  const tEn = (k: string) => translate("en", k);
  const tFr = (k: string) => translate("fr", k);
  it("maps the invitation code to a recovery hint in EN and FR", () => {
    const e = new AuthRequestError("Invitation is invalid or has expired", 403, "INVITATION_INVALID");
    expect(signUpErrorMessage(e, tEn as never)).toMatch(/exact email address the invitation was sent to/);
    expect(signUpErrorMessage(e, tEn as never)).toMatch(/ask your Lumière advisor for a new one/);
    expect(signUpErrorMessage(e, tFr as never)).toMatch(/exactement l’adresse e-mail/);
    expect(signUpErrorMessage(e, tFr as never)).not.toMatch(/invalid/i);
  });
  it("tells an existing user to sign in or reset", () => {
    const e = new AuthRequestError("Email already registered", 409, "EMAIL_ALREADY_REGISTERED");
    expect(signUpErrorMessage(e, tEn as never)).toMatch(/Sign in instead/);
    expect(signUpErrorMessage(e, tFr as never)).toMatch(/Connectez-vous/);
  });
  it("never shows raw server text", () => {
    expect(signUpErrorMessage(new AuthRequestError("pg: duplicate key value", 400), tEn as never)).toBe(tEn("auth.invite.failed"));
    expect(signUpErrorMessage(new TypeError("fetch failed"), tFr as never)).toBe(tFr("auth.error.network"));
  });
});

describe("SA-35 password policy", () => {
  it("requires at least 10 characters for new passwords", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(passwordTooShort("123456789")).toBe(true);
    expect(passwordTooShort("1234567890")).toBe(false);
    expect(translate("en", "auth.field.passwordHint")).toMatch(/10 characters/);
    expect(translate("fr", "auth.field.passwordHint")).toMatch(/10 caractères/);
  });
});

describe("SA-26 contract gates read the agreement", () => {
  const state = { current: { enrollment: { startedOn: null, institutionDisclosed: false }, priorEducation: [] } } as never;
  const agreement = {
    signedOn: "2026-10-01", activatedOn: "2026-10-15", supportMonths: 12, supportEndsOn: "2027-10-15", supportMonthsLeft: 11, accessMonths: 36, accessEndsOn: null,
    deadlines: [{ key: "language_test", label: "Language test", rule: "45 days after signing", dueOn: "2026-11-15", status: "open", doneOn: null, detail: null, daysLeft: 4 }],
    orientationSessionsIncluded: 2, orientationSessionsUsed: 0, goal: null, languageTestDays: 45, priorSchoolingDays: 60,
  } as never;
  it("uses the agreement's signing date and edited terms, not 30 / 90 days and 9 months", () => {
    const g = Object.fromEntries(contractGates({ state, documents: [], agreement }).map((x) => [x.key, x]));
    expect(g.agreement).toMatchObject({ status: "done" });
    expect(g.english!.label).toContain("45 days");
    expect(g.english!.detail).toContain("2026-11-15");
    expect(g.records!.label).toContain("60 days");
    expect(g.records!.detail).toContain("2026-12-14");
    expect(g.support!.label).toContain("12 months");
    expect(g.support!.detail).toContain("2027-10-15");
  });
  it("an unsigned agreement is not signed, even if a consent document was verified", () => {
    const g = contractGates({ state, documents: [{ doc_type: "consent_form", status: "verified", verified_at: "2026-09-01" } as never], agreement: { ...(agreement as object), signedOn: null, activatedOn: null, supportEndsOn: null, deadlines: [] } as never });
    expect(g.find((x) => x.key === "agreement")!.status).toBe("pending");
  });
});

describe("SA-19 remembered return path", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
  it("remembers a safe path once, restores it for an allowed role and clears it", () => {
    const s = mem();
    rememberReturnPath("/admin/students/s1?tab=documents", s);
    expect(takeReturnPath("staff", s)).toBe("/admin/students/s1?tab=documents");
    expect(s.m.has(RETURN_TO_STORAGE_KEY)).toBe(false);
  });
  it("ignores unsafe paths and paths the role cannot open", () => {
    const s = mem();
    rememberReturnPath("//evil.example", s);
    expect(s.m.size).toBe(0);
    rememberReturnPath("/admin/students/s1/workspace", s);
    expect(takeReturnPath("staff", s)).toBeNull();
    rememberReturnPath("/documents", s);
    forgetReturnPath(s);
    expect(takeReturnPath("student", s)).toBeNull();
  });
});
