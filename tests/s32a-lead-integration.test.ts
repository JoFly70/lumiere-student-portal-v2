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
