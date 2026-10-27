import { describe, expect, it } from "vitest";
import { en } from "../client/src/i18n/en";
import { fr } from "../client/src/i18n/fr";
import { frTypo, translate } from "../client/src/i18n";
import { SUPPORT_TEXT_EN, SUPPORT_TEXT_FR } from "../client/src/components/support/original-support-text";

/** French values that legitimately equal the English ones: proper nouns, shared loanwords, cognates. */
const SAME_ALLOWED = new Set<string>([
  "language.en", "language.fr", "nav.documents", "documents.col.type", "documents.col.actions",
  "support.conversation", "auth.hero.footerRight", // identical cognate / brand line
]);
const SAME_VALUE_ALLOWED = new Set<string>(["Documents", "Type", "Actions", "Description", "Documents", "Support", "Total", "Date", "Format", "Portail", "Contact", "Message", "Notes", "Section", "Original", "Image", "Photo", "Maintenance", "Standard", "Information", "Parent", "Passeport", "Transfer", "Admin", "Email", "Lumière", "English", "Français", "Dr", "Mme", "M."]);

describe("S19 EN/FR parity (core + modules)", () => {
  it("every EN key exists in FR and FR has no extras", () => {
    const missing = Object.keys(en).filter((k) => !(k in fr));
    const extra = Object.keys(fr).filter((k) => !(k in en));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });
  it("no French value equals its English value (allow-listed proper nouns / cognates excepted)", () => {
    const same = Object.keys(en).filter((k) => {
      const e = (en as Record<string, string>)[k]!;
      const f = (fr as Record<string, string>)[k]!;
      return e === f && !SAME_ALLOWED.has(k) && !SAME_VALUE_ALLOWED.has(e);
    });
    expect(same).toEqual([]);
  });
  it("French applies typographic spacing before : ; ? !", () => {
    expect(frTypo("Bonjour : vous ? oui ! ok ;")).toBe("Bonjour : vous ? oui ! ok ;");
    expect(translate("fr", "documents.confirmDelete", { name: "x" })).toContain(" ?");
    expect(/ [?!;]| :/.test(translate("fr", "documents.accepted"))).toBe(false);
  });
});

type Tree = Record<string, unknown>;
function leaves(node: unknown, path: string, out: Map<string, unknown>) {
  if (node && typeof node === "object") for (const [k, v] of Object.entries(node as Tree)) leaves(v, path ? `${path}.${k}` : k, out);
  else out.set(path, node);
}
describe("S19 Support text parity", () => {
  const e = new Map<string, unknown>(); const f = new Map<string, unknown>();
  leaves(SUPPORT_TEXT_EN, "", e); leaves(SUPPORT_TEXT_FR, "", f);
  it("same structure", () => expect([...f.keys()].sort()).toEqual([...e.keys()].sort()));
  it("every string and function output is translated", () => {
    const same: string[] = [];
    for (const [k, ev] of e) {
      const fv = f.get(k);
      expect(typeof fv, k).toBe(typeof ev);
      const a = typeof ev === "function" ? String((ev as (...x: unknown[]) => unknown)(3, 7, "DOC-1")) : String(ev);
      const b = typeof fv === "function" ? String((fv as (...x: unknown[]) => unknown)(3, 7, "DOC-1")) : String(fv);
      expect(b.trim(), k).not.toBe("");
      if (a === b && !["detail.description", "meta.reference", "units.b", "list.comment", "detail.conversation", "create.descriptionLabel"].includes(k) && !/^(priority\.|topics\.)/.test(k)) same.push(k);
    }
    expect(same).toEqual([]);
  });
  it("uses vouvoiement and no English leftovers in the main student-facing labels", () => {
    expect(SUPPORT_TEXT_FR.status.waiting_on_student).toBe("En attente de votre réponse");
    expect(SUPPORT_TEXT_FR.detail.attachments).toBe("Pièces jointes");
    expect(SUPPORT_TEXT_FR.list.searchPlaceholder).toBe("Rechercher une demande…");
    expect(JSON.stringify(SUPPORT_TEXT_FR)).not.toMatch(/\b(ticket|your|please)\b/i);
  });
});
