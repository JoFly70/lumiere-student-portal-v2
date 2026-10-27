import { describe, expect, it } from "vitest";
import { allowListCovers, authSettingsChecklist, checkAuthSettings, classifyTemplate } from "../scripts/s22/auth-config-checks";

const APP = "https://staging-portal.example.app";
const good = {
  disable_signup: true,
  mailer_autoconfirm: false,
  site_url: `${APP}/`,
  uri_allow_list: `${APP}/auth/verify, ${APP}/verify-email, ${APP}/reset-password`,
  mailer_templates_confirmation_content: '<a href="{{ .SiteURL }}/auth/verify?token_hash={{ .TokenHash }}&type=signup">Confirm</a>',
  mailer_templates_recovery_content: '<a href="{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery">Reset</a>',
};
const failing = (r: ReturnType<typeof checkAuthSettings>) => r.checks.filter((c) => !c.ok && c.severity === "fail").map((c) => c.id);

describe("S22 auth settings checks (LOCAL: pure function over a settings snapshot)", () => {
  it("passes for a correct staging configuration", () => {
    const r = checkAuthSettings(good, APP);
    expect(r.ok).toBe(true);
    expect(failing(r)).toEqual([]);
  });
  it("fails on signups enabled, confirm email off, wrong site url", () => {
    expect(failing(checkAuthSettings({ ...good, disable_signup: false }, APP))).toContain("signups_disabled");
    expect(failing(checkAuthSettings({ ...good, mailer_autoconfirm: true }, APP))).toContain("confirm_email_on");
    expect(failing(checkAuthSettings({ ...good, mailer_autoconfirm: undefined }, APP))).toContain("confirm_email_on");
    expect(failing(checkAuthSettings({ ...good, site_url: "https://other.example" }, APP))).toContain("site_url_matches_app_url");
  });
  it("requires each of the three redirect URLs", () => {
    for (const path of ["/auth/verify", "/verify-email", "/reset-password"]) {
      const list = good.uri_allow_list.split(", ").filter((e) => !e.endsWith(path)).join(", ");
      expect(failing(checkAuthSettings({ ...good, uri_allow_list: list }, APP))).toEqual([`redirect_allow_list:${APP}${path}`]);
    }
  });
  it("accepts wildcard allow-list entries", () => {
    expect(checkAuthSettings({ ...good, uri_allow_list: `${APP}/**` }, APP).ok).toBe(true);
    expect(allowListCovers([`${APP}/*`], `${APP}/reset-password`)).toBe(true);
    expect(allowListCovers([`${APP}/*`], `${APP}/a/b`)).toBe(false);
    expect(allowListCovers(["https://evil.example/**"], `${APP}/reset-password`)).toBe(false);
  });
  it("production adds the lumiereportal.app equivalents", () => {
    const prod = "https://lumiereportal.app";
    const cfg = { ...good, site_url: prod, uri_allow_list: ["/auth/verify", "/verify-email", "/reset-password"].map((p) => prod + p).join("\n") };
    expect(checkAuthSettings(cfg, prod).ok).toBe(true);
    // The currently published origin must also stay allowed while both are live.
    expect(failing(checkAuthSettings(cfg, prod, ["https://lumiere-student-portal-v-2.replit.app"])).length).toBe(3);
  });
  it("template format is a warning, not a failure", () => {
    const r = checkAuthSettings({ ...good, mailer_templates_confirmation_content: '<a href="{{ .ConfirmationURL }}">x</a>' }, APP);
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.id === "confirmation_template_token_hash")).toMatchObject({ ok: false, severity: "warn" });
    expect(classifyTemplate("{{ .TokenHash }}")).toBe("token_hash");
    expect(classifyTemplate(undefined)).toBe("unknown");
  });
  it("checklist names the real app paths", () => {
    const text = authSettingsChecklist(APP, ["https://lumiereportal.app"]).join("\n");
    for (const p of ["/auth/verify", "/verify-email", "/reset-password"]) {
      expect(text).toContain(`${APP}${p}`);
      expect(text).toContain(`https://lumiereportal.app${p}`);
    }
  });
});
