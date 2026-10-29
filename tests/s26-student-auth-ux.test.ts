import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoginView } from "../client/src/components/auth/login-view";
import { I18nProvider, translate } from "../client/src/i18n";
import { AuthRequestError, authErrorFromResponse, resetErrorMessage, signInErrorMessage } from "../client/src/lib/auth-errors";
import { isSessionExpiredResponse } from "../client/src/lib/session-expiry";

(globalThis as { React?: unknown }).React = React;
const noop = async () => {};
const render = (props: Record<string, unknown> = {}, lang: "en" | "fr" = "en") =>
  renderToStaticMarkup(createElement(I18nProvider, { initialLanguage: lang }, createElement(LoginView, { login: noop, signup: noop, onNavigate: () => {}, ...props })));
const tEn = (k: any) => translate("en", k);
const tFr = (k: any) => translate("fr", k);

describe("login page", () => {
  it("shows the forgot-password link pointing at the reset page (EN and FR)", () => {
    expect(render()).toContain('data-testid="link-forgot-password"');
    expect(render()).toContain('href="/reset-password"');
    expect(render({}, "fr")).toContain("Mot de passe oublié");
  });
  it("shows the expired-session notice when given one", () => {
    const html = render({ notice: tFr("auth.sessionExpired") }, "fr");
    expect(html).toContain('data-testid="text-session-notice"');
    expect(html).toContain("Votre session a expiré");
    expect(render()).not.toContain("text-session-notice");
  });
});

describe("auth error messages are translated, not raw server English", () => {
  it("maps sign-in failures", () => {
    expect(signInErrorMessage(new AuthRequestError("Invalid credentials", 401), tFr)).toBe(tFr("auth.error.invalidCredentials"));
    expect(signInErrorMessage(new AuthRequestError("Too many authentication attempts. Please try again in 15 minutes.", 429), tFr)).toBe(tFr("auth.error.rateLimited"));
    expect(signInErrorMessage(new AuthRequestError("x", 403, "EMAIL_VERIFICATION_REQUIRED"), tEn)).toBe(tEn("auth.error.verifyEmail"));
    expect(signInErrorMessage(new AuthRequestError("x", 403, "ACCOUNT_INACTIVE"), tEn)).toBe(tEn("auth.error.inactive"));
    expect(signInErrorMessage(new AuthRequestError("x", 503), tEn)).toBe(tEn("auth.error.unavailable"));
    expect(signInErrorMessage(new TypeError("Failed to fetch"), tFr)).toBe(tFr("auth.error.network"));
    expect(tFr("auth.error.invalidCredentials")).not.toBe(tEn("auth.error.invalidCredentials"));
  });
  it("maps reset failures", () => {
    expect(resetErrorMessage(new AuthRequestError("Too many password reset requests", 429), tFr, "auth.reset.failed")).toBe(tFr("auth.error.rateLimitedReset"));
    expect(resetErrorMessage(new AuthRequestError("Invalid", 401), tEn, "auth.newPassword.failed")).toBe(tEn("auth.error.tokenInvalid"));
    expect(resetErrorMessage(new AuthRequestError("Email is required", 400), tFr, "auth.reset.failed")).toBe(tFr("auth.reset.failed"));
  });
  it("builds an AuthRequestError from a response", async () => {
    const err = await authErrorFromResponse({ status: 403, json: async () => ({ error: "No", code: "ACCOUNT_INACTIVE" }) }, "fallback");
    expect(err).toMatchObject({ status: 403, code: "ACCOUNT_INACTIVE", message: "No" });
  });
});

describe("expired-session detection", () => {
  it("treats auth-middleware 401s as expiry but not other 401s", () => {
    expect(isSessionExpiredResponse(401, "Invalid or expired token")).toBe(true);
    expect(isSessionExpiredResponse(401, '{"error":"Invalid or expired session"}')).toBe(true);
    expect(isSessionExpiredResponse(401, "Invalid password")).toBe(false);
    expect(isSessionExpiredResponse(403, "Invalid or expired token")).toBe(false);
  });
});
