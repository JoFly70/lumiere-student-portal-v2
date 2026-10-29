import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoginView, parseInviteCode } from "../client/src/components/auth/login-view";
import { I18nProvider, translate } from "../client/src/i18n";
import { authEn, authFr } from "../client/src/i18n/modules/auth";

// Components use the classic JSX runtime under vitest (esbuild default); expose React like other SSR tests.
(globalThis as { React?: unknown }).React = React;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const noop = async () => {};
const render = (props: Record<string, unknown> = {}, lang: "en" | "fr" = "en") =>
  renderToStaticMarkup(
    createElement(I18nProvider, { initialLanguage: lang }, createElement(LoginView, { login: noop, signup: noop, onNavigate: () => {}, ...props })),
  );

describe("S19 login", () => {
  it("renders labelled sign-in fields with password-manager attributes", () => {
    const html = render();
    expect(html).toContain('for="login-email"');
    expect(html).toMatch(/id="login-email"[^>]*/);
    expect(html).toContain('name="email"');
    expect(html).toContain('autoComplete="email"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('name="password"');
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('href="/reset-password"');
    expect(html).toContain('role="tablist"');
  });

  it("parses ?invite= and opens the invitation form prefilled", () => {
    expect(parseInviteCode("?invite=ABC-123")).toBe("ABC-123");
    expect(parseInviteCode("")).toBe("");
    const html = render({ initialInvite: "ABC-123" });
    expect(html).toContain('id="signup-invitation"');
    expect(html).toContain('value="ABC-123"');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('name="new-password"');
    expect(html).not.toContain('id="login-password"');
  });

  it("offers no open signup, and no fabricated support address", () => {
    const html = render();
    expect(html).not.toMatch(/Sign Up|Create account|Register/i);
    expect(html).toContain("I have an invitation");
    for (const f of ["login.tsx", "reset-password.tsx", "verify-email.tsx"]) expect(read(`client/src/pages/${f}`)).not.toContain("support@");
    expect(JSON.stringify([authEn, authFr])).not.toContain("support@");
    expect(html).not.toContain("support@lumiere.edu");
  });

  it("renders French with non-breaking spaces before ? when language is fr", () => {
    const html = render({}, "fr");
    expect(html).toContain("Bienvenue chez Lumière");
    expect(html).toContain("Votre parcours commence ici.");
    expect(html).toContain("Adresse e-mail");
    expect(html).toContain("Mot de passe oublié ?");
    expect(html).not.toContain("Forgot your password");
  });

  it("French defines every key and keeps interpolation placeholders", () => {
    for (const k of Object.keys(authEn) as Array<keyof typeof authEn>) {
      expect(authFr[k], k).toBeTruthy();
      expect(authFr[k].match(/\{\w+\}/g) ?? []).toEqual(authEn[k].match(/\{\w+\}/g) ?? []);
      expect(k.startsWith("auth.")).toBe(true);
    }
    expect(translate("fr", "auth.reset.sentBody", { email: "a@b.c" })).toContain("a@b.c");
  });

  it("keeps the role-based redirect and request bodies unchanged", () => {
    expect(read("client/src/pages/login.tsx")).toContain("user?.role === 'admin' ? '/admin/support-center'");
    const reset = read("client/src/pages/reset-password.tsx");
    expect(reset).toContain("'/api/auth/update-password'");
    expect(reset).toContain("recovery_type: 'recovery'");
  });
});
