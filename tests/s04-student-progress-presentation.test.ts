import { describe, expect, it } from "vitest";
import {
  attentionOwnerLabel,
  creditAmountDisplay,
  creditsAppliedToRequirement,
  formatDecimal,
  groupCredits,
  isMissingRecordError,
  keyFigures,
  progressMode,
  ratioForGraphic,
  requirementStatusPresentation,
  safeInternalHref,
  sortRequirements,
  visibleTotals,
} from "../client/src/pages/student-progress-presentation";
import {
  COMPOSED,
  COMPOSED_NO_TOTALS,
  CREDITS,
  NO_ACTIVE_PROGRAM,
  UNDER_REVIEW,
} from "./helpers/student-progress-ui-fixtures";

describe("S04 student progress presentation", () => {
  it("formats API decimal strings without computing", () => {
    expect(formatDecimal("3.50")).toBe("3.5");
    expect(formatDecimal("12.00")).toBe("12");
    expect(formatDecimal("0.00")).toBe("0");
    expect(formatDecimal("36.25")).toBe("36.25");
    expect(formatDecimal("120")).toBe("120");
    expect(formatDecimal(null)).toBeNull();
  });

  it("maps requirement statuses to student labels", () => {
    expect(requirementStatusPresentation("SATISFIED").label).toBe("Satisfied");
    expect(requirementStatusPresentation("PARTIAL").label).toBe("In progress");
    expect(requirementStatusPresentation("MISSING").label).toBe("Outstanding");
    expect(requirementStatusPresentation("CONFLICT").label).toBe("Under staff review");
    expect(requirementStatusPresentation("MANUAL_REVIEW").tone).toBe("review");
  });

  it("orders requirements by canonical sequence", () => {
    expect(sortRequirements(COMPOSED.requirements).map((r) => r.requirementId)).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("groups credits into verified, awaiting and not accepted", () => {
    const g = groupCredits(CREDITS);
    expect(g.verified.map((c) => c.creditRecordId)).toEqual(["c1", "c2"]);
    expect(g.awaiting.map((c) => c.creditRecordId)).toEqual(["c3", "c4"]);
    expect(g.notAccepted.map((c) => c.creditRecordId)).toEqual(["c5"]);
  });

  it("shows awarded credits when verified and reported credits otherwise", () => {
    expect(creditAmountDisplay(CREDITS[0])).toEqual({ text: "3 credits", basis: "awarded" });
    expect(creditAmountDisplay(CREDITS[2])).toEqual({ text: "3.5 credits", basis: "reported" });
  });

  it("matches applied credits to a requirement by credit record id", () => {
    const req = COMPOSED.requirements.find((r) => r.requirementId === "r1")!;
    expect(creditsAppliedToRequirement(req, CREDITS).map((c) => c.creditRecordId)).toEqual(["c1"]);
  });

  it("labels who acts next", () => {
    expect(attentionOwnerLabel("staff")).toBe("Lumière staff is reviewing");
    expect(attentionOwnerLabel("student")).toBe("Action for you");
  });

  it("exposes totals only for a composed result and never in under review", () => {
    expect(progressMode(COMPOSED)).toBe("composed");
    expect(progressMode(COMPOSED_NO_TOTALS)).toBe("composed-without-totals");
    expect(progressMode(UNDER_REVIEW)).toBe("under-review");
    expect(progressMode(NO_ACTIVE_PROGRAM)).toBe("no-program");
    expect(keyFigures(COMPOSED).map((f) => f.value)).toEqual(["36.5", "120", "83.5", "1 of 4"]);
    expect(keyFigures(UNDER_REVIEW)).toEqual([]);
    expect(keyFigures(COMPOSED_NO_TOTALS)).toEqual([]);
    expect(visibleTotals(UNDER_REVIEW)).toBeNull();
    // Even if a faulty payload carried totals, UNDER_REVIEW must not expose them.
    expect(visibleTotals({ ...UNDER_REVIEW, totals: COMPOSED.totals })).toBeNull();
  });

  it("sizes graphics from ratios clamped to 0..1 and only for known amounts", () => {
    expect(ratioForGraphic("30.00", "120.00")).toBeCloseTo(0.25);
    expect(ratioForGraphic("200", "100")).toBe(1);
    expect(ratioForGraphic(null, "100")).toBe(0);
    expect(ratioForGraphic("5", "0")).toBe(0);
  });

  it("only links to in-app absolute paths and detects missing-record errors", () => {
    expect(safeInternalHref("/documents")).toBe("/documents");
    expect(safeInternalHref("//evil.example")).toBeNull();
    expect(safeInternalHref("https://evil.example")).toBeNull();
    expect(safeInternalHref(null)).toBeNull();
    expect(isMissingRecordError(new Error("404: not found"))).toBe(true);
    expect(isMissingRecordError(new Error("500: boom"))).toBe(false);
  });
});
