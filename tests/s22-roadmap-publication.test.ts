import { describe, expect, it } from "vitest";
import { TEMPLATE_STANDARD_21, TEMPLATE_STANDARD_21_V2, TEMPLATE_TN_22, hsRoadmapContentSchema } from "../shared/high-school-contract";
import { contentFromTemplate, validateRoadmapContent, validateRoadmapPublicationCoverage } from "../shared/high-school-projection";

// Test-only allocation fixtures reuse a template title; they are not an
// offering list and are never persisted or published to any school database.
function plan(template = TEMPLATE_STANDARD_21_V2, total = template.totalRequiredHalfUnits, electiveHalfUnits = 10) {
  const content = structuredClone(contentFromTemplate(template, total, null).content);
  if (electiveHalfUnits) content.courses.push({
    ...content.courses[0], key: "test-only-coverage", areaKey: "electives",
    halfUnits: electiveHalfUnits, tasks: [], replacesCourseKey: null,
  });
  return content;
}

describe("publication-only diploma coverage", () => {
  it("allows structurally valid incomplete drafts but refuses publication without five electives", () => {
    const content = plan(TEMPLATE_STANDARD_21_V2, 42, 0);
    expect(hsRoadmapContentSchema.safeParse(content).success).toBe(true);
    expect(validateRoadmapContent(content, TEMPLATE_STANDARD_21_V2)).toEqual([]);
    expect(validateRoadmapPublicationCoverage(content, TEMPLATE_STANDARD_21_V2).join(" ")).toContain("at least 5 credits");
  });
  it.each([TEMPLATE_STANDARD_21, TEMPLATE_STANDARD_21_V2])("requires 16 core plus at least five elective credits for standard templates", (template) => {
    expect(validateRoadmapPublicationCoverage(plan(template), template)).toEqual([]);
    expect(validateRoadmapPublicationCoverage(plan(template, 42, 9), template)).not.toEqual([]);
    expect(validateRoadmapPublicationCoverage(plan(template, 42, 11), template)).toEqual([]);
  });
  it.each(["removed", "replaced"] as const)("does not count %s elective courses", (status) => {
    const content = plan();
    content.courses.at(-1)!.status = status;
    expect(validateRoadmapPublicationCoverage(content, TEMPLATE_STANDARD_21_V2)).not.toEqual([]);
  });
  it("requires exact core allocation, not merely enough total credits", () => {
    const missing = plan();
    missing.courses[0].status = "removed";
    expect(validateRoadmapPublicationCoverage(missing, TEMPLATE_STANDARD_21_V2).join(" ")).toContain("exactly");
    const excess = plan();
    excess.courses[0].halfUnits += 1;
    expect(validateRoadmapPublicationCoverage(excess, TEMPLATE_STANDARD_21_V2)).not.toEqual([]);
  });
  it("counts an active replacement once, without deleting protected historical courses", () => {
    const content = plan();
    const original = content.courses[0];
    content.courses.push({ ...original, key: "test-only-replacement", replacesCourseKey: original.key });
    original.status = "replaced";
    expect(validateRoadmapPublicationCoverage(content, TEMPLATE_STANDARD_21_V2)).toEqual([]);
  });
  it("refuses moving requirements between core and electives to bypass the contract", () => {
    const content = plan();
    content.areas[0].requiredHalfUnits -= 1;
    content.areas.find((a) => a.kind === "elective")!.requiredHalfUnits += 1;
    expect(validateRoadmapPublicationCoverage(content, TEMPLATE_STANDARD_21_V2).join(" ")).toContain("Restore");
  });
  it.each([[44, 12], [40, 8]])("preserves authorized total exceptions of %i half units", (total, electives) => {
    expect(validateRoadmapPublicationCoverage(plan(TEMPLATE_STANDARD_21_V2, total, electives), TEMPLATE_STANDARD_21_V2, total)).toEqual([]);
    expect(validateRoadmapPublicationCoverage(plan(TEMPLATE_STANDARD_21_V2, total, electives - 1), TEMPLATE_STANDARD_21_V2, total)).not.toEqual([]);
  });
  it("keeps the separate 22-credit template's core allocation, rather than hardcoding 16", () => {
    expect(validateRoadmapPublicationCoverage(plan(TEMPLATE_TN_22, 44), TEMPLATE_TN_22, 44)).toEqual([]);
  });
});
