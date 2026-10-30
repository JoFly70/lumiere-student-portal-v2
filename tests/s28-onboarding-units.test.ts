/**
 * S28 unit tests: invitation email (EN/FR, escaping, link), app email transport (never claims delivery it did not
 * make), server-side installment schedule rules, and the official WhatsApp contact (Support card, EN/FR).
 * Synthetic data only.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildInvitationEmail, invitationSignupLink } from "../server/lib/invitation-email";
import { deliverEmail, emailTransportConfigured } from "../server/lib/email";
import { validateReplacementSchedule, isInstallmentPaid } from "../shared/billing-ledger";
import type { BillingLedgerData } from "../shared/billing-contract";
import { I18nProvider, translate } from "../client/src/i18n";
import { LUMIERE_WHATSAPP_URL, WhatsAppContactCard } from "../client/src/components/support/whatsapp-contact";
import { deliveryMessage, invitationSignupUrl } from "../client/src/components/admin/invitations-api";
import { invitationStatus } from "../server/routes/admin";

const APP = "https://portal.synthetic.example";
const TOKEN = "tok_ABC-123_synthetic";

describe("S28 invitation email", () => {
  it("builds a French email with the ?invite=&lang=fr link, the code, the expiry and the exact address", () => {
    const m = buildInvitationEmail({ email: "eleve@synthetic.example", token: TOKEN, expiresAt: "2026-11-02T15:00:00Z", appUrl: APP, language: "fr" });
    expect(m.subject).toBe("Votre invitation au Portail étudiant Lumière");
    expect(m.link).toBe(`${APP}/login?invite=${TOKEN}&lang=fr`);
    expect(m.html).toContain('lang="fr"');
    expect(m.html).toContain("Créer mon compte");
    expect(m.html).toContain("eleve@synthetic.example");
    expect(m.html).toContain(TOKEN);
    expect(m.html).toContain("#c29a4e"); // Lumière gold
    expect(m.text).toContain(m.link);
    expect(m.text).toMatch(/expire le .*2026/);
  });

  it("builds the English variant and escapes every interpolated value", () => {
    const m = buildInvitationEmail({ email: "a<b>\"x\"@synthetic.example", token: "t<script>", expiresAt: "2026-11-02T15:00:00Z", appUrl: APP, language: "en" });
    expect(m.subject).toBe("Your invitation to the Lumière Student Portal");
    expect(m.html).toContain("Create my account");
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain('a<b>"x"');
    expect(m.html).toContain("a&lt;b&gt;&quot;x&quot;");
    expect(invitationSignupLink(APP, "a b&c", "en")).toBe(`${APP}/login?invite=a%20b%26c&lang=en`);
  });

  it("client link helper produces the same shape the email uses", () => {
    expect(invitationSignupUrl(TOKEN, "fr", APP)).toBe(`${APP}/login?invite=${TOKEN}&lang=fr`);
    expect(invitationSignupUrl(TOKEN, undefined, APP)).toBe(`${APP}/login?invite=${TOKEN}`);
  });

  it("delivery messages never claim an email was sent unless it was", () => {
    expect(deliveryMessage("sent", "x@synthetic.example")).toMatch(/emailed to x@synthetic\.example/);
    for (const d of ["not_configured", "failed", "skipped"] as const) {
      expect(deliveryMessage(d, "x@synthetic.example")).not.toMatch(/emailed to/);
      expect(deliveryMessage(d, "x@synthetic.example")).toMatch(/Copy the link/);
    }
  });

  it("invitation status is derived from consumed/revoked/expiry", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    expect(invitationStatus({ expires_at: "2026-11-02T00:00:00Z", consumed_at: null, revoked_at: null }, now)).toBe("pending");
    expect(invitationStatus({ expires_at: "2026-10-30T00:00:00Z", consumed_at: null, revoked_at: null }, now)).toBe("expired");
    expect(invitationStatus({ expires_at: "2026-11-02T00:00:00Z", consumed_at: null, revoked_at: "2026-10-31T00:00:00Z" }, now)).toBe("revoked");
    expect(invitationStatus({ expires_at: "2026-10-30T00:00:00Z", consumed_at: "2026-10-29T00:00:00Z", revoked_at: "2026-10-31T00:00:00Z" }, now)).toBe("accepted");
  });
});

describe("S28 app email transport", () => {
  const configured = { EMAIL_ENABLED: "true", EMAIL_FROM: "Lumière <noreply@synthetic.example>", RESEND_API_KEY: "re_synthetic" };
  const msg = { to: "x@synthetic.example", subject: "s", html: "<p>h</p>", text: "h" };

  it("is not configured unless EMAIL_ENABLED=true, EMAIL_FROM and RESEND_API_KEY are all set", () => {
    expect(emailTransportConfigured({})).toBe(false);
    expect(emailTransportConfigured({ ...configured, EMAIL_ENABLED: "false" })).toBe(false);
    expect(emailTransportConfigured({ ...configured, RESEND_API_KEY: "" })).toBe(false);
    expect(emailTransportConfigured({ ...configured, EMAIL_FROM: undefined })).toBe(false);
    expect(emailTransportConfigured(configured)).toBe(true);
  });

  it("reports not_configured without any network call", async () => {
    const f = vi.fn();
    expect(await deliverEmail(msg, {}, f as unknown as typeof fetch)).toBe("not_configured");
    expect(f).not.toHaveBeenCalled();
  });

  it("posts to the provider once and reports sent / failed truthfully", async () => {
    const ok = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await deliverEmail(msg, configured, ok as unknown as typeof fetch)).toBe("sent");
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_synthetic");
    expect(JSON.parse(String(init.body))).toMatchObject({ from: configured.EMAIL_FROM, to: ["x@synthetic.example"], subject: "s", text: "h" });
    const rejected = vi.fn(async () => new Response("{}", { status: 422 }));
    expect(await deliverEmail(msg, configured, rejected as unknown as typeof fetch)).toBe("failed");
    const down = vi.fn(async () => { throw new TypeError("network"); });
    expect(await deliverEmail(msg, configured, down as unknown as typeof fetch)).toBe("failed");
  });
});

function ledger(over: Partial<BillingLedgerData> = {}): BillingLedgerData {
  return {
    obligation: { agreedCents: 400_000, currency: "USD", note: null, createdBy: "a", createdAt: "2026-10-01T00:00:00Z", updatedBy: "a", updatedAt: "2026-10-01T00:00:00Z" },
    discounts: [],
    installments: [],
    receipts: [],
    evidence: [],
    ...over,
  } as BillingLedgerData;
}
const inst = (id: string, dueDate: string, amountCents: number, sortOrder = 0) => ({ id, dueDate, amountCents, label: null, sortOrder });
const receipt = (amountCents: number) => ({ id: `r${amountCents}`, amountCents, receivedDate: "2026-10-02", methodLabel: "x", reference: null, note: null, evidenceId: null, confirmedBy: "a", confirmedAt: "2026-10-02T00:00:00Z" });
const TODAY = "2026-10-30";

describe("S28 server-side installment rules", () => {
  it("requires the schedule to equal the net obligation (agreed minus active discounts); empty is allowed", () => {
    const l = ledger({ discounts: [{ id: "d", amountCents: 25_000, reason: "x", approvedBy: "a", approvedAt: "x", createdBy: "a", createdAt: "x" }] as never });
    expect(validateReplacementSchedule(l, [], TODAY)).toBeNull();
    expect(validateReplacementSchedule(l, [{ dueDate: "2026-11-01", amountCents: 200_000 }, { dueDate: "2027-01-01", amountCents: 175_000 }], TODAY)).toBeNull();
    expect(validateReplacementSchedule(l, [{ dueDate: "2026-11-01", amountCents: 400_000 }], TODAY)).toEqual({ code: "sum_mismatch", scheduledCents: 400_000, netCents: 375_000 });
    expect(validateReplacementSchedule(l, [{ dueDate: "2026-11-01", amountCents: 374_999 }], TODAY)?.code).toBe("sum_mismatch");
  });

  it("keeps fully paid rows first with the same date and amount", () => {
    const l = ledger({ installments: [inst("i1", "2026-10-01", 100_000), inst("i2", "2026-11-01", 300_000)], receipts: [receipt(100_000)] as never });
    expect(isInstallmentPaid(l, "i1", TODAY)).toBe(true);
    expect(isInstallmentPaid(l, "i2", TODAY)).toBe(false);
    // re-splitting unpaid money is fine
    expect(validateReplacementSchedule(l, [{ dueDate: "2026-10-01", amountCents: 100_000 }, { dueDate: "2026-11-01", amountCents: 150_000 }, { dueDate: "2026-12-01", amountCents: 150_000 }], TODAY)).toBeNull();
    // order in the request does not matter; chronology does
    expect(validateReplacementSchedule(l, [{ dueDate: "2026-11-01", amountCents: 300_000 }, { dueDate: "2026-10-01", amountCents: 100_000 }], TODAY)).toBeNull();
    // changing the paid row's amount or date, or dropping it, is refused
    expect(validateReplacementSchedule(l, [{ dueDate: "2026-10-01", amountCents: 150_000 }, { dueDate: "2026-11-01", amountCents: 250_000 }], TODAY)).toEqual({ code: "paid_row_changed", installmentId: "i1" });
    expect(validateReplacementSchedule(l, [{ dueDate: "2026-10-02", amountCents: 100_000 }, { dueDate: "2026-11-01", amountCents: 300_000 }], TODAY)?.code).toBe("paid_row_changed");
    expect(validateReplacementSchedule(l, [{ dueDate: "2026-09-01", amountCents: 50_000 }, { dueDate: "2026-10-01", amountCents: 100_000 }, { dueDate: "2026-11-01", amountCents: 250_000 }], TODAY)?.code).toBe("paid_row_changed");
  });
});

describe("S28 WhatsApp contact", () => {
  const render = (lang: "en" | "fr") => renderToStaticMarkup(createElement(I18nProvider, { initialLanguage: lang }, createElement(WhatsAppContactCard)));

  it("uses the official wa.me link with safe external-link attributes and no personal data", () => {
    expect(LUMIERE_WHATSAPP_URL).toBe("https://wa.me/19453917325");
    const html = render("en");
    expect(html).toContain('href="https://wa.me/19453917325"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toMatch(/wa\.me\/19453917325\?/); // no prefilled text / query
  });

  it("renders the approved English and French labels", () => {
    const en = render("en");
    expect(en).toContain("Contact Lumière on WhatsApp");
    expect(en).toContain("Have a question? Contact your Lumière advisor directly on WhatsApp.");
    const fr = render("fr");
    expect(fr).toContain("Contacter Lumière sur WhatsApp");
    expect(fr).toContain("Une question\u202f? Contactez votre conseiller Lumière directement sur WhatsApp.");
    expect(translate("fr", "support.whatsapp.cta")).toBe("Contacter Lumière sur WhatsApp");
    expect(translate("en", "support.whatsapp.cta")).toBe("Contact Lumière on WhatsApp");
  });
});
