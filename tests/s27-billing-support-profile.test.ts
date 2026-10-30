import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({ Link: ({ href, children, ...rest }: any) => createElement("a", { href, ...rest }, children) }));
import type { StudentBillingConfigured } from "../shared/billing-contract";
import { I18nProvider } from "../client/src/i18n";
import { BillingS27 } from "../client/src/components/s27/billing-view";
import { SupportLead, whatsappHref } from "../client/src/components/s27/support-lead";
import { AgreementCard } from "../client/src/components/s27/profile-agreement";
import { BILLING_CONFIGURED, BILLING_NOT_CONFIGURED } from "./helpers/s18-billing-fixtures";
import { s27Journey } from "./helpers/s27-fixtures";

const wrap = (lang: "en" | "fr", node: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(I18nProvider, { initialLanguage: lang }, node));

describe("S27 Billing", () => {
  const cfg = BILLING_CONFIGURED as StudentBillingConfigured;
  it("balance hero, schedule with statuses, receipts and awaiting-confirmation notice (EN + FR)", () => {
    const en = wrap("en", createElement(BillingS27, { data: cfg }));
    expect(en).toContain("left to pay");
    expect(en).toContain('data-testid="billing-schedule"');
    expect(en).toContain('data-testid="billing-receipts"');
    expect(en).toContain("Upload proof of payment in Documents");
    expect(en).not.toMatch(/Pay now|Pay online/i);
    const fr = wrap("fr", createElement(BillingS27, { data: cfg }));
    expect(fr).toContain("restant à payer");
    expect(fr).toContain("Reçus");
  });
  it("fully paid shows 'Paid in full'", () => {
    const paid = { ...cfg, paidCents: cfg.netObligationCents, remainingCents: 0, evidenceAwaitingReview: [] } as StudentBillingConfigured;
    const html = wrap("en", createElement(BillingS27, { data: paid }));
    expect(html).toContain("Paid in full");
    expect(html).toContain('data-settled="true"');
  });
  it("a zero balance with nothing received is 'Nothing to pay', never 'Paid in full'", () => {
    const free = { ...cfg, paidCents: 0, netObligationCents: 0, remainingCents: 0, receipts: [], evidenceAwaitingReview: [] } as StudentBillingConfigured;
    const html = wrap("en", createElement(BillingS27, { data: free }));
    expect(html).toContain("Nothing to pay");
    expect(html).not.toContain("Paid in full");
  });
  it("not configured is an explicit state, never zeros", () => {
    const html = wrap("en", createElement(BillingS27, { data: BILLING_NOT_CONFIGURED }));
    expect(html).toContain('data-testid="billing-not-configured"');
    expect(html).not.toContain('data-testid="billing-schedule"');
  });
});

describe("S27 Support lead", () => {
  it("offers Ask Lumière first; the official WhatsApp contact is a separate card (S28)", () => {
    const html = wrap("en", createElement(SupportLead, { action: null }));
    expect(html).toContain("Ask Lumière");
    expect(html).not.toContain("wa.me");
  });
  it("whatsappHref accepts plausible international numbers only", () => {
    expect(whatsappHref("+1 (555) 123-4567")).toBe("https://wa.me/15551234567");
    expect(whatsappHref("")).toBeNull();
    expect(whatsappHref(undefined)).toBeNull();
    expect(whatsappHref("12345")).toBeNull();
    expect(whatsappHref("1".repeat(20))).toBeNull();
  });
});

describe("S27 Profile agreement card", () => {
  it("renders dates and deadlines from the journey; renders nothing without an agreement", () => {
    const html = wrap("en", createElement(AgreementCard, { journey: s27Journey() }));
    expect(html).toContain("Your agreement");
    expect(html).toContain("7 Jun 2027 (9 months)");
    expect(html).toContain("English proficiency test");
    expect(wrap("en", createElement(AgreementCard, { journey: null }))).toBe("");
    expect(wrap("en", createElement(AgreementCard, { journey: { ...s27Journey(), agreement: null } }))).toBe("");
  });
  it("is translated", () => {
    expect(wrap("fr", createElement(AgreementCard, { journey: s27Journey() }))).toContain("Votre entente");
  });
});
