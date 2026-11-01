import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({ Link: ({ href, children, ...rest }: any) => createElement("a", { href, ...rest }, children) }));
import type { StudentBillingConfigured } from "../shared/billing-contract";
import { I18nProvider } from "../client/src/i18n";
import { BillingS27, nextDueKey } from "../client/src/components/s27/billing-view";
import { LUMIERE_WHATSAPP_URL } from "../client/src/components/support/whatsapp-contact";
import { BILLING_CONFIGURED, BILLING_NOT_CONFIGURED } from "./helpers/s18-billing-fixtures";

(globalThis as { React?: unknown }).React = React;
const wrap = (lang: "en" | "fr", node: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(I18nProvider, { initialLanguage: lang }, node));
const cfg = BILLING_CONFIGURED as StudentBillingConfigured;
const noEvidence = { ...cfg, evidenceAwaitingReview: [] } as StudentBillingConfigured;

describe("S32 F05 billing: how to pay, proof link, next / overdue line", () => {
  it("with no awaiting evidence the proof link and the truthful how-to-pay block are both visible", () => {
    const html = wrap("en", createElement(BillingS27, { data: noEvidence }));
    expect(html).not.toContain('data-testid="billing-awaiting"');
    expect(html).toContain('data-testid="link-send-proof"');
    expect(html).toContain('href="/documents?tab=financial"');
    expect(html).toContain('data-testid="billing-how-to-pay"');
    expect(html).toContain("Your payment instructions are provided by your Lumière team");
    expect(html).toContain('href="/support?topic=billing"');
    expect(html).toContain(`href="${LUMIERE_WHATSAPP_URL}"`);
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("invents no payment method, bank detail or card payment", () => {
    const html = wrap("en", createElement(BillingS27, { data: noEvidence }));
    const fr = wrap("fr", createElement(BillingS27, { data: noEvidence }));
    for (const h of [html, fr]) expect(h).not.toMatch(/IBAN|SWIFT|routing number|account number|credit card|Visa|Mastercard|PayPal|Interac|e-transfer|Pay now|Pay online/i);
  });
  it("keeps 'submitted evidence is not a confirmed payment' wording", () => {
    const html = wrap("en", createElement(BillingS27, { data: cfg }));
    expect(html).toContain("It counts as a payment once our team confirms it");
    expect(html).toContain("only once Lumière confirms it");
    expect(html).toContain('data-testid="link-upload-proof"');
  });
  it("an overdue instalment is the first line of the hero, before the balance", () => {
    expect(cfg.nextDue?.status).toBe("overdue");
    const html = wrap("en", createElement(BillingS27, { data: cfg }));
    const hero = html.slice(html.indexOf('data-testid="billing-hero"'));
    const next = hero.indexOf('data-testid="billing-next-due"');
    expect(next).toBeGreaterThan(-1);
    expect(next).toBeLessThan(hero.indexOf("left to pay"));
    expect(hero).toContain('data-status="overdue"');
    expect(hero).toContain("Overdue:");
    const fr = wrap("fr", createElement(BillingS27, { data: cfg }));
    expect(fr).toContain("En retard :");
  });
  it("no next-due line once everything is paid; no how-to-pay block, but the proof link stays", () => {
    const paid = { ...cfg, paidCents: cfg.netObligationCents, remainingCents: 0, nextDue: null, evidenceAwaitingReview: [] } as StudentBillingConfigured;
    const html = wrap("en", createElement(BillingS27, { data: paid }));
    expect(html).not.toContain('data-testid="billing-next-due"');
    expect(html).not.toContain('data-testid="billing-how-to-pay"');
    expect(html).toContain('data-testid="link-send-proof"');
  });
  it("not configured billing still offers the proof link and no circular /billing link", () => {
    const html = wrap("en", createElement(BillingS27, { data: BILLING_NOT_CONFIGURED }));
    expect(html).toContain('data-testid="link-send-proof"');
    expect(html).not.toContain('href="/billing"');
  });
  it("nextDueKey picks overdue / due / upcoming copy", () => {
    expect(nextDueKey("overdue")).toBe("s27.bill.nextOverdue");
    expect(nextDueKey("due")).toBe("s27.bill.nextDueNow");
    expect(nextDueKey("upcoming")).toBe("s27.bill.nextUpcoming");
  });
});
