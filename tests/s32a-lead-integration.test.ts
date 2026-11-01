/**
 * S32-A lead integration checks for cross-stream follow-ups (synthetic, no network).
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { UPLOAD_DOC_TYPE, uploadDocTypeFor } from "../client/src/lib/library-model";
import { documentsTabFromSearch } from "../client/src/lib/s32-services-docs";

describe("S32-A F10 follow-up: Library uploads are never auto-filed as HS transcripts for degree students", () => {
  it("files academic uploads as hs_transcript only for high-school students", () => {
    expect(uploadDocTypeFor("academic", true)).toBe("hs_transcript");
    expect(uploadDocTypeFor("academic", false)).toBe("other");
  });
  it("leaves the other categories unchanged", () => {
    for (const c of ["coursework", "language", "identity"] as const) {
      expect(uploadDocTypeFor(c, false)).toBe(UPLOAD_DOC_TYPE[c]);
      expect(uploadDocTypeFor(c, true)).toBe(UPLOAD_DOC_TYPE[c]);
    }
  });
  it("the Library page passes the student's program to the uploader", () => {
    expect(fs.readFileSync("client/src/pages/library.tsx", "utf8")).toContain("hasHighSchool={programs.hasHighSchool}");
  });
});

describe("S32-A F26 / F05: evidence links land on the right Documents tab", () => {
  it("the degree log sheet certificate link targets the academic tab, which Documents accepts", () => {
    const sheet = fs.readFileSync("client/src/components/degree-journey/log-sheet.tsx", "utf8");
    expect(sheet).toContain('href="/documents?tab=academic"');
    expect(documentsTabFromSearch("?tab=academic")).toBe("academic");
  });
  it("the billing proof link targets the financial tab, which Documents accepts", () => {
    expect(fs.readFileSync("client/src/components/s27/billing-view.tsx", "utf8")).toContain("/documents?tab=financial");
    expect(documentsTabFromSearch("?tab=financial")).toBe("financial");
    expect(documentsTabFromSearch("?tab=bogus")).toBe("all");
  });
});

import { answerFromRecord } from "../server/services/academic-assistant/student-record";
describe("S32-A F13 follow-up: billing questions without a Billing record get a truthful answer", () => {
  const recs = [{ ref: "S1", label: "Degree credits", path: "/roadmap", text: "x" }];
  it("answers 'How much do I owe?' truthfully (EN/FR) instead of an unrelated knowledge-base entry", () => {
    expect(answerFromRecord("How much do I owe?", "en", recs)!.text).toContain("No billing information is on your portal account");
    expect(answerFromRecord("Combien je dois payer ?", "fr", recs)!.text).toContain("Aucune information de facturation");
  });
  it("does not add the line when a Billing record exists, or when no record was loaded at all", () => {
    const withBilling = [...recs, { ref: "S2", label: "Billing", path: "/billing", text: "Remaining 10.00 USD." }];
    expect(answerFromRecord("How much do I owe?", "en", withBilling)!.text).not.toContain("No billing information");
    expect(answerFromRecord("How much do I owe?", "en", [])).toBeNull();
  });
});

import { studentDocTypeLabel } from "../client/src/lib/student-doc-type-label";
import { translate } from "../client/src/i18n";
describe("S32-A visual-review fix: student document type names follow the student's language", () => {
  const tFr = (k: any) => translate("fr", k);
  const tEn = (k: any) => translate("en", k);
  it("translates known types and aliases, falls back for unknown ones", () => {
    expect(studentDocTypeLabel("hs_transcript", tFr)).toBe("Relevé de notes du secondaire");
    expect(studentDocTypeLabel("hs_transcript", tEn)).toBe("High-school transcript");
    expect(studentDocTypeLabel("english_proof", tFr)).toBe("Preuve de compétence en anglais");
    expect(studentDocTypeLabel("mystery_type", tFr)).toBe("Mystery type");
  });
  it("is used by the deck Documents card, the Documents page and the documents-needed list", () => {
    for (const f of ["client/src/components/s27/deck-parts.tsx", "client/src/pages/documents.tsx", "client/src/components/s27/documents-lead.tsx"]) {
      expect(fs.readFileSync(f, "utf8")).toContain("studentDocTypeLabel(");
    }
  });
});
