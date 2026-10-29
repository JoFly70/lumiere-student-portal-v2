import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../client/src/i18n";
import { DocumentsLead, neededItems, type LeadDoc } from "../client/src/components/s27/documents-lead";
import { S27_DOCS, s27Journey } from "./helpers/s27-fixtures";

const docs = S27_DOCS as unknown as LeadDoc[];

describe("S27 Documents: needed from you", () => {
  it("a rejected / resubmit file asks for a replacement and hides the matching deadline card", () => {
    const items = neededItems(docs, s27Journey());
    expect(items.map((i) => i.kind)).toEqual(["replace"]);
  });
  it("an open deadline with no file asks for an upload; with a pending file it shows as received", () => {
    const none = neededItems(docs.filter((d) => d.doc_type !== "hs_transcript"), s27Journey());
    expect(none).toEqual([expect.objectContaining({ kind: "deadline", key: "prior_schooling_proof", docType: "hs_transcript", inReview: false })]);
    const pending = neededItems([{ ...docs[3]!, status: "pending" }], s27Journey());
    expect(pending).toEqual([expect.objectContaining({ kind: "deadline", inReview: true })]);
  });
  it("a verified file, a done deadline and a missing journey ask for nothing", () => {
    expect(neededItems([{ ...docs[3]!, status: "verified" }], s27Journey())).toEqual([]);
    expect(neededItems([], null)).toEqual([]);
  });
});

describe("S27 Documents: lead renders", () => {
  const render = (lang: "en" | "fr", g = null as never) =>
    renderToStaticMarkup(createElement(I18nProvider, { initialLanguage: lang }, createElement(DocumentsLead, { docs, journey: s27Journey(), graduation: g, onReplace: () => {}, onUploadFor: () => {}, busy: false })));
  it("shows tiles, the replacement action and the deadline in English and French", () => {
    const en = render("en");
    expect(en).toContain("Needed from you");
    expect(en).toContain("Upload a replacement");
    expect(en).toContain("High-school transcript");
    expect(render("fr")).toContain("Attendus de votre part");
  });
  it("shows the after-diploma list only when graduation data exists", () => {
    expect(render("en")).not.toContain("After your diploma");
    const g = { transcript: { status: "not_requested", documentId: null }, diploma: { status: "issued", documentId: null, conferredOn: null } } as never;
    const html = render("en", g);
    expect(html).toContain("After your diploma");
    expect(html).toContain("Issued");
  });
});
