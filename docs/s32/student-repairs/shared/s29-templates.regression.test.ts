/**
 * S32-A regression for server/services/s29/templates.ts (owned by S32-B). Apply s29-templates.patch FIRST, then copy this file
 * to tests/s32a-s29-templates.test.ts (it is kept out of tests/ so the suite does not run it before the patch is applied).
 * Covers F20 (orientation-cancelled points to Beyond, not the Flight Deck), F20/F05 (overdue instalment copy matches Billing,
 * which now offers an always-visible "Send proof of payment" link) and F30 (feminine agreement with « pièce d’identité »).
 */
import { describe, expect, it } from "vitest";
import { renderTemplate } from "../server/services/s29/templates";

describe("S32 s29 templates", () => {
  it("F20: orientation-cancelled sends the student to Beyond, not the Flight Deck", () => {
    const en = renderTemplate("orientation.cancelled", "en", { whenEn: "Mon 3 Nov", whenFr: "lun. 3 nov." });
    const fr = renderTemplate("orientation.cancelled", "fr", { whenEn: "Mon 3 Nov", whenFr: "lun. 3 nov." });
    expect(en.href).toBe("/beyond");
    expect(en.body).not.toMatch(/Flight Deck/i);
    expect(en.body).toContain("Beyond the Diploma");
    expect(fr.body).not.toMatch(/tableau de bord/i);
    expect(fr.body).toContain("Au-delà du diplôme");
  });

  it("F05/F20: overdue instalment copy still says the proof can be sent from Billing (Billing now offers that link)", () => {
    const fr = renderTemplate("concierge.payment", "fr", { overdue: true, dueFr: "1 oct.", dueEn: "Oct 1" });
    expect(fr.body).toContain("envoyer la preuve depuis Facturation");
    expect(fr.href).toBe("/billing");
  });

  it("F30: « pièce d’identité » takes feminine agreement; masculine labels are unchanged", () => {
    const id = { docType: "id_document" };
    expect(renderTemplate("document.verified", "fr", id).body).toContain("examinée et acceptée");
    expect(renderTemplate("document.rejected", "fr", id).body).toContain("n’a pas pu être acceptée");
    expect(renderTemplate("document.received", "fr", id).body).toMatch(/Elle est en attente/);
    const tr = { docType: "transcript" };
    expect(renderTemplate("document.verified", "fr", tr).body).toContain("examiné et accepté");
    expect(renderTemplate("document.rejected", "fr", tr).body).toContain("n’a pas pu être accepté.");
    expect(renderTemplate("document.received", "fr", tr).body).toMatch(/Il est en attente/);
  });
});
