/**
 * S32-B staff billing UI: history (show all, staff names), the start list (overdue first, every student reachable),
 * the existing-document picker and EN/FR rendering. Synthetic data only.
 */
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({ Link: ({ href, children, ...rest }: any) => createElement("a", { href, ...rest }, children) }));
import type { BillingLedgerData, BillingReceiptRow } from "../shared/billing-contract";
import { computeStaffBilling } from "../shared/billing-ledger";
import { I18nProvider } from "../client/src/i18n";
import { BillingHistoryList, HISTORY_COLLAPSED_COUNT } from "../client/src/components/admin/billing/history-list";
import { selectableEvidenceDocuments } from "../client/src/components/admin/billing/billing-panels";
import { BillingStartList, buildBillingStartList } from "../client/src/pages/staff-billing-lookup";
import { en } from "../client/src/i18n/en";
import { fr } from "../client/src/i18n/fr";

(globalThis as { React?: unknown }).React = React;
const wrap = (lang: "en" | "fr", node: React.ReactElement) => renderToStaticMarkup(createElement(I18nProvider, { initialLanguage: lang }, node));

const receipt = (n: number): BillingReceiptRow => ({
  id: `r${n}`, amountCents: 10_000 + n, receivedDate: `2026-09-${String(n).padStart(2, "0")}`, methodLabel: "Synthetic transfer", reference: null, note: null,
  confirmedBy: n % 2 ? "u-ana" : "u-ben", confirmedAt: `2026-09-${String(n).padStart(2, "0")}T09:00:00.000Z`, evidenceId: null,
});
const ledger: BillingLedgerData = {
  obligation: { agreedCents: 900_000, currency: "USD", note: null },
  discounts: [], installments: [],
  receipts: Array.from({ length: 15 }, (_, i) => receipt(i + 1)),
  evidence: [],
};
const view = { ...computeStaffBilling(ledger, "2026-10-27"), actorNames: { "u-ana": "Ana Synthetic", "u-ben": "Ben Synthetic" } };

describe("S32-B billing history", () => {
  it("shows the first 12 with a Show all button and names who confirmed each entry", () => {
    const html = wrap("en", createElement(BillingHistoryList, { view }));
    expect((html.match(/data-testid="history-item"/g) ?? []).length).toBe(HISTORY_COLLAPSED_COUNT);
    expect(html).toContain("Show all (15)");
    expect(html).toContain("by Ana Synthetic");
    expect(html).toContain("by Ben Synthetic");
  });
  it("Show all lists all 15 entries, and the French text is localized", () => {
    const en15 = wrap("en", createElement(BillingHistoryList, { view, defaultExpanded: true }));
    expect((en15.match(/data-testid="history-item"/g) ?? []).length).toBe(15);
    expect(en15).toContain("Show fewer");
    const fr15 = wrap("fr", createElement(BillingHistoryList, { view, defaultExpanded: true }));
    expect(fr15).toContain("par Ana Synthetic");
    expect(fr15).toContain("reçu le");
    expect(fr15).not.toContain("received");
  });
  it("an unresolved id reads as a staff member, never as a raw id", () => {
    const html = wrap("en", createElement(BillingHistoryList, { view: { ...view, actorNames: {} } }));
    expect(html).toContain("by a staff member");
    expect(html).not.toContain("u-ana");
  });
});

describe("S32-B billing start list", () => {
  const students = Array.from({ length: 20 }, (_, i) => ({
    id: `s${i}`, first_name: `Student${i}`, last_name: "Synthetic", student_code: `LUM-${i}`, status: "active",
    // s0 is the OLDEST, s19 the newest
    created_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
  }));
  const fact = (id: string, balanceCents: number, overdue: boolean) => ({ studentId: id, program: null, lastActivityAt: null, billing: { currency: "USD", agreedCents: 500_000, netCents: 500_000, paidCents: 500_000 - balanceCents, balanceCents, overdue } });
  const facts = new Map([["s0", fact("s0", 400_000, true)], ["s5", fact("s5", 200_000, false)]]);
  it("a student far outside the 12 newest who is overdue comes first; awaiting proof next; then recent", () => {
    const rows = buildBillingStartList(students, facts, new Map([["s3", 1]]));
    expect(rows[0]!.id).toBe("s0");
    expect(rows[0]!.overdue).toBe(true);
    expect(rows[1]!.id).toBe("s3");
    expect(rows[1]!.awaitingEvidence).toBe(1);
    expect(rows[2]!.id).toBe("s19");
    expect(rows.length).toBe(12);
    expect(rows.find((r) => r.id === "s5")?.balance).toBeUndefined(); // s5 is not among the 12 newest; search reaches it
    expect(buildBillingStartList(students, facts, new Map(), 20).find((r) => r.id === "s5")!.balance!.balanceCents).toBe(200_000);
  });
  it("keeps every overdue account even past the minimum length", () => {
    const many = new Map(students.map((s) => [s.id, fact(s.id, 1, true)]));
    expect(buildBillingStartList(students, many, new Map()).length).toBe(20);
  });
  it("without facts it still lists students, newest first", () => {
    expect(buildBillingStartList(students, new Map(), new Map())[0]!.id).toBe("s19");
  });
  it("renders overdue state and the outstanding balance per row, EN and FR", () => {
    const rows = buildBillingStartList(students, facts, new Map([["s3", 1]]));
    const html = wrap("en", createElement(BillingStartList, { rows }));
    expect(html).toContain("Payment overdue");
    expect(html).toContain("Proof waiting for review");
    expect(html).toContain("Outstanding $4,000");
    const fh = wrap("fr", createElement(BillingStartList, { rows }));
    expect(fh).toContain("Paiement en retard");
    expect(fh).toContain("Solde dû");
  });
});

describe("S32-B evidence picker and wording", () => {
  const doc = (id: string, name: string, status: string) => ({ id, file_name: name, status }) as any;
  it("offers pending documents first and hides documents already registered as live evidence", () => {
    const docs = [doc("a", "b-passport.pdf", "verified"), doc("b", "z-slip.pdf", "pending"), doc("c", "a-slip.pdf", "pending"), doc("d", "used.pdf", "pending"), doc("e", "old.pdf", "pending")];
    const evidence = [{ id: "e1", documentId: "d", status: "awaiting_review" }, { id: "e2", documentId: "e", status: "rejected" }] as any;
    // d is live evidence (hidden); e was rejected so it can be registered again
    expect(selectableEvidenceDocuments(docs, evidence).map((x) => x.id)).toEqual(["c", "e", "b", "a"]);
  });
  it("the banner no longer claims the student uploaded the proof; staff keys are bilingual", () => {
    expect(en["owner.bill.ev.uploaded"]).toBe("Proof of payment from {name} is waiting for review");
    expect(fr["owner.bill.ev.uploaded"]).toContain("{name}");
    expect(en["owner.bill.plan.foot"]).not.toContain("with your name");
    const keys = Object.keys(en).filter((k) => k.startsWith("s32.bill"));
    expect(keys.length).toBeGreaterThan(50);
    for (const k of keys) expect((fr as Record<string, string>)[k]).not.toBe((en as Record<string, string>)[k]);
  });
});
