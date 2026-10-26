import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { ProfilePageView, ReadinessPanel } from "../client/src/components/profile/profile-page-view";
import { ContactCard, ContactsSection } from "../client/src/components/profile/contacts-section";
import { buildCorrectionChanges } from "../client/src/components/profile/identity-section";
import { splitReadiness, describeError, validatePhone } from "../client/src/components/profile/profile-presentation";
import { PHOTO_MAX_BYTES, validatePhotoFile } from "../client/src/components/profile-avatar-upload";
import { NEW_STUDENT_PROFILE, RESOLVED_PROFILE, RICH_PROFILE } from "./helpers/s09-profile-ui-fixtures";

(globalThis as any).React = React;

const html = (el: React.ReactElement) =>
  renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(Router, { ssrPath: "/profile" }, el)),
  );
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const count = (m: string, needle: string) => m.split(needle).length - 1;
const section = (m: string, id: string) => {
  const start = m.indexOf(`id="section-${id}"`);
  const next = m.indexOf("<section", start + 10);
  return m.slice(start, next === -1 ? undefined : next);
};

describe("S09 profile: rich profile", () => {
  const markup = html(React.createElement(ProfilePageView, { profile: RICH_PROFILE }));
  const t = text(markup);

  it("renders all six sections with one in-page navigation", () => {
    for (const id of ["identity", "contact", "background", "contacts", "eligibility", "account"]) {
      expect(markup).toContain(`id="section-${id}"`);
      expect(markup).toContain(`href="#section-${id}"`);
    }
    expect(markup).toContain('data-testid="section-nav"');
    expect(markup).not.toContain('data-testid="jump-menu"');
  });

  it("shows header with preferred name, legal name and student id", () => {
    expect(markup).toMatch(/<h1[^>]*>Amy<\/h1>/);
    expect(t).toContain("Legal name: Amara Nkechi Okafor-Demo");
    expect(t).toContain("Student ID: LUM-24-0417");
  });

  it("shows only the masked government ID", () => {
    expect(t).toContain("•••• 4821");
    expect(t).not.toMatch(/\bP\d{7,}\b/);
    expect(markup).not.toContain('name="gov_id_number"');
  });

  it("identity and eligibility are read-only: no inputs, only a correction request", () => {
    const identity = section(markup, "identity");
    expect(identity).not.toMatch(/<input[^>]*(first_name|last_name|dob|gov_id)/);
    const inputs = identity.match(/<input[^>]*>/g) ?? [];
    expect(inputs.every((i) => i.includes('type="file"'))).toBe(true); // only the photo picker
    expect(identity).not.toContain("<textarea");
    expect(markup).not.toContain('data-testid="button-request-correction"'); // hidden while one is pending
    const eligibility = section(markup, "eligibility");
    expect(eligibility).not.toContain("<input");
    expect(eligibility).not.toContain("<form");
    expect(eligibility).not.toContain("<select");
    expect(markup).not.toContain("button-edit-identity");
  });

  it("explains a verified identity stays until review and shows the pending request", () => {
    expect(markup).toContain('data-testid="identity-verification-badge"');
    expect(t).toContain("Verified");
    expect(t).toContain("stays exactly as recorded until Lumière finishes reviewing");
    expect(markup).toContain('data-testid="pending-correction"');
    expect(t).toContain("Okafor-Sample");
    expect(t).toContain("On record:");
    expect(markup).toContain('data-testid="button-withdraw-correction"');
  });

  it("login email is read-only with a support pointer", () => {
    expect(t).toContain("To change it, contact support");
    expect(markup).toContain('href="/support"');
    expect(markup).not.toContain('data-testid="input-login-email"');
  });

  it("separates 'Needs your attention' from 'Waiting on Lumière'", () => {
    const attn = markup.slice(markup.indexOf('data-testid="readiness-attention"'), markup.indexOf('data-testid="readiness-waiting"'));
    const wait = markup.slice(markup.indexOf('data-testid="readiness-waiting"'), markup.indexOf('id="section-identity"'));
    expect(text(attn)).toContain("English proficiency proof needs to be resubmitted");
    expect(text(attn)).toContain("Proof of residency needs to be resubmitted");
    expect(text(attn)).toContain("Upload a signed consent for Ngozi Eze-Demo");
    expect(text(attn)).toContain("Jordan Lake-Demo: authority was not approved");
    // Emergency contacts are on file, so nothing about them is "missing".
    expect(text(markup)).not.toContain("Add an emergency contact");
    expect(text(attn)).not.toContain("being reviewed");
    expect(text(wait)).toContain("High school transcript under review");
    expect(text(wait)).toContain("Completed");
    expect(text(wait)).toContain("Identity document verified");
    expect(count(markup, 'data-testid="readiness-item"')).toBe(7);
    expect(markup).toContain('href="#section-eligibility"');
  });

  it("contacts: explainer, statuses, scopes and locks", () => {
    expect(markup).toContain('data-testid="authority-explainer"');
    expect(t).toContain("Adding someone does not give them access");
    expect(t).toContain("cannot see your academic or financial records");
    expect(t).toContain("Verified by Lumière");
    expect(t).toContain("Verification pending");
    expect(t).toContain("Listed by you");
    expect(t).toContain("Not authorized");
    // pending guardian: requested financial/release but only emergency in force
    const cards = markup.split('data-testid="contact-card"').slice(1);
    expect(cards).toHaveLength(4);
    const pending = text(cards[1]);
    expect(pending).toContain("In force today: Emergency contact");
    expect(pending).toContain("You asked for: Emergency contact, Financial matters, Release of information");
    expect(pending).toContain("Not in force until Lumière verifies authority: ");
    // verified: lock, no remove, contact-lumiere message
    expect(cards[0]).toContain('data-testid="contact-locked"');
    expect(cards[0]).not.toContain('data-testid="button-delete-contact"');
    expect(text(cards[0])).toContain("Contact Lumière to change");
    expect(cards[1]).toContain('data-testid="button-delete-contact"');
    expect(text(cards[3])).toContain("The consent document was unsigned");
    expect(markup).not.toMatch(/portal access granted/i);
  });

  it("eligibility shows upload links only for missing/rejected/resubmit documents", () => {
    // Education documents (transcript, degree) are shown under Background only, so they do not repeat here.
    expect(count(markup, 'data-testid="link-upload-document"')).toBe(2);
    const eligibilityDocs = markup.slice(markup.indexOf('data-testid="eligibility-documents"'));
    expect(eligibilityDocs.split('data-testid="eligibility-document"').length - 1).toBe(3);
    expect(text(eligibilityDocs.slice(0, eligibilityDocs.indexOf("</ul>")))).not.toContain("Degree certificate");
    expect(markup).toContain('data-testid="revoked-hint"');
    expect(t).toContain("Resubmission requested");
    expect(t).toContain("Meets the requirement");
  });

  it("background is read-only and distinguishes recorded from verified", () => {
    const bg = section(markup, "background");
    expect(bg).not.toContain("<input");
    expect(text(bg)).toContain("Recorded does not mean verified");
    expect(bg).toContain('href="/roadmap"');
    expect(bg).toContain('href="/documents"');
  });

  it("account links to password reset and mentions two-step verification", () => {
    expect(markup).toContain('href="/reset-password"');
    expect(t).toContain("Two-step verification");
    expect(t).toContain("managed by Lumière support");
  });

  it("never prints a percentage and has labelled controls", () => {
    expect(t).not.toMatch(/\d\s?%/);
    expect(t.toLowerCase()).not.toContain("percent");
    expect(markup).toContain('aria-label="Edit phone numbers"');
    expect(markup).toContain('aria-label="Profile sections"');
    expect(markup).toContain('aria-live="polite"');
  });
});

describe("S09 profile: new student", () => {
  const markup = html(React.createElement(ProfilePageView, { profile: NEW_STUDENT_PROFILE }));
  const t = text(markup);
  it("flags missing items as attention and unverified as waiting, not as verified", () => {
    const attn = text(markup.slice(markup.indexOf('data-testid="readiness-attention"'), markup.indexOf('data-testid="readiness-waiting"')));
    expect(attn).toContain("Add a primary phone number");
    expect(attn).toContain("Upload a government ID");
    expect(attn).not.toContain("Sign-in email is not yet verified");
    expect(text(markup.slice(markup.indexOf('data-testid="readiness-waiting"'), markup.indexOf('id="section-identity"')))).toContain(
      "Sign-in email is not yet verified",
    );
    expect(t).toContain("Not yet verified");
    expect(text(markup.slice(markup.indexOf('data-testid="email-verified"'), markup.indexOf('data-testid="text-login-email"')))).toContain("Not yet verified");
    expect(t).not.toMatch(/Identity: Verified/);
  });
  it("shows honest empty states", () => {
    expect(markup).toContain('data-testid="contacts-empty"');
    expect(markup).toContain('data-testid="prior-credentials-empty"');
    expect(t).toContain("Not on record");
    expect(t).toContain("No address on file yet");
    expect(t).toContain("Not recorded yet");
    expect(markup).toContain('data-testid="button-request-correction"');
    expect(t).not.toMatch(/\d\s?%/);
  });
  it("hides the optional fields from readiness", () => {
    expect(t).not.toMatch(/Alternative phone[^.]*missing/i);
    expect(count(markup, 'data-testid="readiness-item"')).toBe(4);
  });
});

describe("S09 profile: resolved correction", () => {
  const markup = html(React.createElement(ProfilePageView, { profile: RESOLVED_PROFILE }));
  const t = text(markup);
  it("shows the not-approved outcome with the staff note and re-enables requests", () => {
    expect(markup).toContain('data-testid="resolved-correction"');
    expect(t).toContain("Not approved");
    expect(t).toContain("Your passport shows 17 April 2001");
    expect(markup).not.toContain('data-testid="pending-correction"');
    expect(markup).toContain('data-testid="button-request-correction"');
  });
});

describe("S09 profile: pieces and helpers", () => {
  it("ReadinessPanel says so when nothing is outstanding", () => {
    const m = html(React.createElement(ReadinessPanel, { items: [{ key: "x", kind: "complete", label: "Done", detail: null, section: "identity" }] }));
    expect(m).toContain('data-testid="readiness-clear"');
    // Completed work is shown in its own group, never mixed into "needs your attention".
    expect(m).toContain('data-testid="readiness-completed"');
    expect(m).not.toContain('data-testid="readiness-attention"');
    expect(text(m)).toContain("Done");
  });
  it("S10: the RICH fixture's readiness agrees with its own documents and contacts (nothing student-actionable is omitted)", () => {
    const actions = RICH_PROFILE.readiness.filter((r) => r.kind === "action_required").map((r) => r.label).join(" | ");
    for (const d of RICH_PROFILE.eligibility.documents) {
      if (d.status === "rejected" || d.status === "resubmit_requested") expect(actions.toLowerCase()).toContain(d.label.toLowerCase().split(" ")[0]);
    }
    for (const c of RICH_PROFILE.contacts) {
      if (c.authorityStatus === "pending_verification" || c.authorityStatus === "revoked") expect(actions).toContain(c.fullName);
    }
    // And the panel shows them, not "Nothing for you to do".
    const m = html(React.createElement(ReadinessPanel, { items: RICH_PROFILE.readiness }));
    expect(text(m)).not.toContain("Nothing for you to do");
  });
  it("S10: four groups, and requested documents (incl. guardian consent) are action required", () => {
    const items = [
      { key: "document:consent_form", kind: "action_required", label: "Consent form needs to be resubmitted", detail: null, section: "eligibility" },
      { key: "contact_authority:c1", kind: "action_required", label: "Upload a signed consent for Odile", detail: null, section: "contacts" },
      { key: "identity_correction", kind: "pending_review", label: "Identity correction under review", detail: null, section: "identity" },
      { key: "document:foreign_eval", kind: "waiting_external", label: "Evaluation is with the evaluation service", detail: null, section: "eligibility" },
      { key: "document:hs_transcript", kind: "complete", label: "High school transcript verified", detail: null, section: "eligibility" },
    ] as const;
    const g = splitReadiness(items);
    expect(g.attention.map((i) => i.key)).toEqual(["document:consent_form", "contact_authority:c1"]);
    expect(g.waiting.map((i) => i.key)).toEqual(["identity_correction"]);
    expect(g.external).toHaveLength(1);
    expect(g.completed).toHaveLength(1);
    const m = html(React.createElement(ReadinessPanel, { items }));
    const t = text(m.slice(m.indexOf('data-testid="readiness-attention"'), m.indexOf('data-testid="readiness-waiting"')));
    expect(t).toContain("Needs your attention");
    expect(t).toContain("Consent form needs to be resubmitted");
    expect(t).not.toContain("Nothing for you to do");
    expect(m).toContain("Waiting on an outside institution");
    expect(m).toContain('data-testid="readiness-completed"');
  });
  it("S10: a pending authority card says Lumière is reviewing only when a consent is already on file", () => {
    const pending = { ...RICH_PROFILE.contacts[1], authorityStatus: "pending_verification" as const };
    const need = html(React.createElement(ContactsSection, { contacts: [pending], readiness: [{ key: `contact_authority:${pending.id}`, kind: "action_required", label: "x", detail: null, section: "contacts" }] }));
    const hint = (m: string) => text(m.slice(m.indexOf('data-testid="pending-hint"'), m.indexOf('data-testid="pending-hint"') + 400));
    expect(hint(need)).toContain("Upload it in Documents");
    const rev = html(React.createElement(ContactsSection, { contacts: [pending], readiness: [{ key: `contact_authority:${pending.id}`, kind: "pending_review", label: "x", detail: null, section: "contacts" }] }));
    expect(text(rev)).toContain("Lumière is reviewing the consent you sent");
    expect(hint(rev)).not.toContain("Upload it in Documents");
  });
  it("splitReadiness groups by kind", () => {
    const g = splitReadiness(NEW_STUDENT_PROFILE.readiness);
    expect(g.attention.map((i) => i.kind).every((k) => k === "missing" || k === "action_required")).toBe(true);
    expect(g.waiting).toHaveLength(1);
  });
  it("ContactCard renders alone and ContactsSection offers Add", () => {
    const one = html(React.createElement("ul", null, React.createElement(ContactCard, { contact: RICH_PROFILE.contacts[2] })));
    expect(one).toContain("Roommate");
    const sec = html(React.createElement(ContactsSection, { contacts: [] }));
    expect(sec).toContain('data-testid="button-add-contact"');
  });
  it("buildCorrectionChanges validates and rejects no-ops", () => {
    const id = RICH_PROFILE.identity;
    const values = { first_name: "Amara", middle_name: "", last_name: "Okafor-Demo", dob: "2001-04-17", sex: "", nationality: "", gov_id_type: "", gov_id_number: "" };
    expect(buildCorrectionChanges(id, new Set(["first_name"] as const), values).errors.first_name).toMatch(/matches/);
    const ok = buildCorrectionChanges(id, new Set(["last_name"] as const), { ...values, last_name: "Okafor-Sample" });
    expect(ok.errors).toEqual({});
    expect(ok.changes).toEqual({ last_name: "Okafor-Sample" });
    expect(buildCorrectionChanges(id, new Set(["gov_id_number"] as const), { ...values, gov_id_number: "1" }).errors.gov_id_number).toBeTruthy();
    expect(buildCorrectionChanges(id, new Set(["dob"] as const), { ...values, dob: "2999-01-01" }).errors.dob).toMatch(/future/);
  });
  it("photo pre-check enforces type and size", () => {
    expect(validatePhotoFile({ type: "image/png", size: 100 })).toBeNull();
    expect(validatePhotoFile({ type: "image/gif", size: 100 })).toMatch(/PNG, JPEG or WEBP/);
    expect(validatePhotoFile({ type: "image/webp", size: PHOTO_MAX_BYTES + 1 })).toMatch(/5 MB/);
  });
  it("describeError maps stable codes and strips status prefixes", () => {
    expect(describeError({ code: "PROFILE_CORRECTION_ALREADY_PENDING", message: "x" })).toMatch(/already have a correction/);
    expect(describeError(new Error("403: Forbidden thing"))).toBe("Forbidden thing");
    expect(validatePhone("12", true)).toBeTruthy();
    expect(validatePhone("", false)).toBeNull();
  });
});
