import { describe, expect, it } from "vitest";
import {
  attentionHref,
  attentionOwnerLabel,
  milestoneSegmentFills,
  requirementLegend,
  requirementLegendSummary,
  requirementsGroupedByTone,
  verifiedReconciliation,
  visibleAttention,
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
    expect(keyFigures(COMPOSED).map((f) => f.value)).toEqual(["1 of 4", "39.5", "2"]);
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

  it("labels the no-program attention item as the advisor's turn", () => {
    expect(attentionOwnerLabel("staff", "NO_ACTIVE_PROGRAM")).toBe("Your advisor acts next");
    expect(attentionOwnerLabel("staff", "NO_ACTIVE_PROGRAM")).not.toContain("reviewing");
  });

  it("links student-owned attention items and de-duplicates the hero next step", () => {
    const items = COMPOSED.attention;
    expect(attentionHref(items[0], COMPOSED)).toBeNull();
    expect(attentionHref(items[1], COMPOSED)).toBe("/documents");
    expect(attentionHref(items[2], COMPOSED)).toBe("/documents");
    expect(visibleAttention(COMPOSED).map((i) => i.title)).toEqual([
      "Credit awaiting verification",
      "Send your Sophia transcript",
    ]);
  });

  it("builds a legend with counts in the same tones as the strip", () => {
    expect(requirementLegend(COMPOSED.requirements).map((e) => `${e.count} ${e.label}`)).toEqual([
      "1 satisfied", "1 in progress", "1 under review", "1 outstanding",
    ]);
  });

  it("fills milestone segments proportionally to applied credits", () => {
    expect(milestoneSegmentFills(COMPOSED.milestones, "36.50")[0]).toBeCloseTo(6.5 / 30);
    expect(milestoneSegmentFills(COMPOSED.milestones, "36.50")[1]).toBe(0);
    expect(milestoneSegmentFills(COMPOSED.milestones, "100")[0]).toBe(1);
  });

  it("groups strip segments by status, reconciles verified credits, and drops review duplicates", () => {
    expect(requirementsGroupedByTone(COMPOSED.requirements).map((r) => r.requirementId)).toEqual(["r1", "r3", "r4", "r2"]);
    expect(requirementLegendSummary(COMPOSED.requirements)).toContain("4 requirements: 1 satisfied");
    expect(verifiedReconciliation(COMPOSED)!.text).toBe("39.5 verified on record \u00b7 1 verified course not applied to a requirement");
    expect(verifiedReconciliation(UNDER_REVIEW)).toBeNull();
    const none = { ...COMPOSED, credits: COMPOSED.credits.filter((c) => c.standing !== "VERIFIED_NOT_APPLIED") };
    expect(verifiedReconciliation(none)!.text).toBe("39.5 verified on record");
    expect(visibleAttention(UNDER_REVIEW)).toEqual([]);
  });
});

describe("next step action label matches its destination", () => {
  it("labels the degree-complete step for the advisor conversation it links to", async () => {
    const { nextStepActionLabel } = await import("../client/src/pages/student-progress-presentation");
    expect(nextStepActionLabel({
      kind: "DEGREE_REQUIREMENTS_MET", title: "Degree requirements met", detail: "", href: "/support",
    })).toBe("Talk to your advisor");
  });
});
