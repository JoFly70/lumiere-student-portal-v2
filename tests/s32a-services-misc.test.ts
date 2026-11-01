import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoginView } from "../client/src/components/auth/login-view";
import { classifySignupError, signUpErrorInfo } from "../client/src/components/auth/signup-errors";
import { AuthRequestError } from "../client/src/lib/auth-errors";
import { I18nProvider, detectBrowserLanguage, readStoredLanguage, translate } from "../client/src/i18n";
import { readinessText } from "../client/src/components/profile/profile-presentation";
import { LUMIERE_WHATSAPP_URL } from "../client/src/components/support/whatsapp-contact";

(globalThis as { React?: unknown }).React = React;
const read = (p: string) => readFileSync(p, "utf8");
const t = (lang: "en" | "fr") => (k: any) => translate(lang, k);

describe("S32 F19 sign-up errors", () => {
  it("maps codes and falls back to the English server messages", () => {
    expect(classifySignupError(new AuthRequestError("x", 403, "INVITATION_INVALID"))).toBe("invitation_invalid");
    expect(classifySignupError(new AuthRequestError("x", 409, "EMAIL_ALREADY_REGISTERED"))).toBe("email_registered");
    expect(classifySignupError(new Error("Email already registered"))).toBe("email_registered");
    expect(classifySignupError(new Error("Invitation is invalid or has expired"))).toBe("invitation_invalid");
    expect(classifySignupError(new Error("weird"))).toBe("generic");
  });
  it("French message has no raw English and offers sign-in only for duplicates", () => {
    const d = signUpErrorInfo(new Error("Email already registered"), t("fr"));
    expect(d.message).not.toMatch(/already registered/i);
    expect(d.offerSignIn).toBe(true);
    expect(signUpErrorInfo(new Error("Invitation is invalid or has expired"), t("fr")).offerSignIn).toBe(false);
  });
});

describe("S32 F22 login help link", () => {
  it("is a WhatsApp link opening a new tab safely", () => {
    const html = renderToStaticMarkup(createElement(I18nProvider, { initialLanguage: "fr" }, createElement(LoginView, { login: async () => {}, signup: async () => {}, onNavigate: () => {} })));
    expect(html).toMatch(new RegExp(`<a[^>]*href="${LUMIERE_WHATSAPP_URL}"[^>]*>`));
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });
});

describe("S32 F23 language detection", () => {
  it("French browsers default to French, others to English", () => {
    expect(detectBrowserLanguage({ language: "fr-CA" })).toBe("fr");
    expect(detectBrowserLanguage({ languages: ["fr-FR", "en"], language: "en" })).toBe("fr");
    expect(detectBrowserLanguage({ languages: ["en-US", "fr"] })).toBe("en");
    expect(detectBrowserLanguage({})).toBe("en");
  });
  it("saved choice wins; nothing is persisted by detection", () => {
    const g = globalThis as any;
    const prev = Object.getOwnPropertyDescriptor(g, "navigator");
    Object.defineProperty(g, "navigator", { value: { language: "fr-CA", languages: ["fr-CA"] }, configurable: true });
    try {
      let writes = 0;
      expect(readStoredLanguage({ getItem: () => null })).toBe("fr");
      expect(readStoredLanguage({ getItem: () => "en" })).toBe("en");
      expect(writes).toBe(0);
    } finally {
      if (prev) Object.defineProperty(g, "navigator", prev); else delete g.navigator;
    }
  });
});

describe("S32 F08 profile readiness in French", () => {
  it("renders from the key, with names, and falls back for unknown keys", () => {
    expect(readinessText({ key: "phone_primary", kind: "missing", label: "Add a phone number", detail: null }, "fr").label).toBe("Ajoutez un numéro de téléphone");
    expect(readinessText({ key: "address", kind: "missing", label: "Add your address", detail: "Street address and country" }, "fr").detail).toBe("Adresse municipale et pays");
    expect(readinessText({ key: "contact_authority:1", kind: "complete", label: "Ann Roy: authority verified", detail: null }, "fr").label).toMatch(/^Ann Roy\s:\sautorité vérifiée$/);
    expect(readinessText({ key: "document:hs_diploma", kind: "pending_review", label: "High-school diploma under review", detail: null }, "fr").label).toContain("en cours d’examen");
    expect(readinessText({ key: "mystery", kind: "missing", label: "Server text", detail: "d" }, "fr")).toEqual({ label: "Server text", detail: "d" });
    expect(readinessText({ key: "phone_primary", kind: "missing", label: "Add a phone number", detail: null }, "en").label).toBe("Add a phone number");
  });
});

describe("S32 static checks", () => {
  it("F21 bell uses the bright gold pair", () => {
    const s = read("client/src/components/s29/core/notification-bell.tsx");
    expect(s).toContain("bg-student-gold-bright");
    expect(s).toContain("text-student-gold-bright-ink");
    expect(s).not.toContain("bg-student-gold-fill");
  });
  it("F32 index.html has theme-color and viewport-fit=cover, no max-scale", () => {
    const s = read("client/index.html");
    expect(s).toContain("viewport-fit=cover");
    expect(s).toMatch(/name="theme-color" content="#f4f3ef" media="\(prefers-color-scheme: light\)"/);
    expect(s).toMatch(/name="theme-color" content="#09090a" media="\(prefers-color-scheme: dark\)"/);
    expect(s).not.toMatch(/maximum-scale|user-scalable/);
  });
  it("F29 shared sr strings are no longer hard-coded English", () => {
    expect(read("client/src/components/ui/sidebar.tsx")).not.toContain("Displays the mobile sidebar");
    expect(read("client/src/components/ui/sheet.tsx")).not.toContain('>Close</span>');
    expect(read("client/src/components/ui/dialog.tsx")).not.toContain('>Close</span>');
    expect(read("client/src/components/profile-avatar-upload.tsx")).not.toContain('aria-label="Upload profile photo"');
    expect(translate("fr", "s32.a11y.uploadPhoto")).not.toBe("Upload profile photo");
  });
  it("F27 orb clearance CSS is mobile-only", () => {
    const c = read("client/src/styles/student-s27.css");
    expect(c).toMatch(/@media \(max-width:767px\)\{\s*\.s27 \.inner\{padding-bottom/);
  });
  it("F24 terminology", () => {
    expect(translate("fr", "s27.sup.title")).toBe("Assistance");
    expect(translate("fr", "s27.bill.contact")).not.toMatch(/Soutien/);
    expect(translate("fr", "nav.highSchoolFlightDeck")).not.toMatch(/lycée/);
    expect(translate("fr", "auth.field.email")).not.toMatch(/e-mail/i);
  });
});
