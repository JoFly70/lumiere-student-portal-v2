/**
 * S16: standard 21-credit diploma template, version 2 (four corrected core titles).
 * Version 1 must stay byte-for-byte what existing enrollments were created on.
 */
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_TEMPLATES,
  NO_POLICIES,
  TEMPLATE_STANDARD_21,
  TEMPLATE_STANDARD_21_V2,
  TEMPLATE_TN_22,
  latestTemplateVersions,
  sumHalfUnits,
  validateTemplate,
} from "../shared/high-school-contract";
import { contentFromTemplate, validateRoadmapContent } from "../shared/high-school-projection";
import { addCourse, areaPlanRows, blockingDraftIssues } from "../client/src/lib/admin-high-school-logic";

const v2 = TEMPLATE_STANDARD_21_V2;
const titles = (t: typeof v2) => t.courses.map((c) => c.title);

describe("us-hs-diploma-21 version 2", () => {
  it("is a new version of the same key, valid, and totals exactly 21 credits (42 half-units)", () => {
    expect(v2.templateKey).toBe("us-hs-diploma-21");
    expect(v2.version).toBe(2);
    expect(validateTemplate(v2)).toEqual([]);
    expect(v2.totalRequiredHalfUnits).toBe(42);
    expect(sumHalfUnits(v2.areas.map((a) => a.requiredHalfUnits))).toBe(42);
  });

  it("has 17 mandatory core courses: two 0.5-credit startup courses and fifteen 1-credit courses = 16 core credits", () => {
    expect(v2.courses).toHaveLength(17);
    expect(v2.courses.every((c) => c.required)).toBe(true);
    expect(v2.courses.filter((c) => c.halfUnits === 1).map((c) => c.areaKey)).toEqual(["startup", "startup"]);
    expect(v2.courses.filter((c) => c.halfUnits === 2)).toHaveLength(15);
    expect(sumHalfUnits(v2.courses.map((c) => c.halfUnits))).toBe(32);
    const core = v2.areas.filter((a) => a.kind === "core");
    expect(sumHalfUnits(core.map((a) => a.requiredHalfUnits))).toBe(32);
    expect(v2.areas.find((a) => a.kind === "elective")?.requiredHalfUnits).toBe(10);
  });

  it("carries the four corrected titles and no placeholder", () => {
    const byArea = (k: string) => v2.courses.filter((c) => c.areaKey === k).map((c) => c.title);
    expect(byArea("math")).toEqual(["General Math 1", "General Math 2", "Personal Finance"]);
    expect(byArea("social")).toEqual(["World History", "U.S. History", "U.S. Government and Economics"]);
    expect(byArea("health_pe")).toEqual(["Health and Nutrition"]);
    expect(titles(v2).join(" ")).not.toMatch(/confirmed per enrollment/i);
  });

  it("adds no elective courses (the draft builder plans every template course) and keeps policies unconfigured", () => {
    expect(v2.courses.some((c) => c.areaKey === "electives")).toBe(false);
    expect(v2.policies).toEqual(NO_POLICIES);
    expect(v2.policies.maxTransferHalfUnits).toBeNull();
    expect(v2.policies.maxExamAttempts).toBeNull();
  });

  it("never names an institution in shared, client-bundled template text", () => {
    for (const t of BUILT_IN_TEMPLATES) expect(`${t.title} ${t.sourceNote} ${titles(t).join(" ")}`).not.toMatch(/penn|foster|pfhs/i);
  });
});

describe("version 1 is preserved for existing enrollments", () => {
  it("v1 keeps its placeholders and course keys; TN still derives from v1", () => {
    expect(TEMPLATE_STANDARD_21.version).toBe(1);
    expect(TEMPLATE_STANDARD_21.courses.map((c) => c.key)).toContain("math-3");
    expect(titles(TEMPLATE_STANDARD_21)).toContain("Mathematics course 3 (confirmed per enrollment)");
    expect(TEMPLATE_TN_22.courses.map((c) => c.key)).toContain("math-3");
  });

  it("both versions are seeded; new enrollments are offered only the latest version of each key", () => {
    expect(BUILT_IN_TEMPLATES.map((t) => `${t.templateKey}@${t.version}`)).toEqual([
      "us-hs-diploma-21@1",
      "us-hs-diploma-21@2",
      "us-hs-diploma-21@3",
      "us-hs-diploma-tn-22@1",
    ]);
    expect(latestTemplateVersions(BUILT_IN_TEMPLATES).map((t) => `${t.templateKey}@${t.version}`)).toEqual([
      "us-hs-diploma-21@3",
      "us-hs-diploma-tn-22@1",
    ]);
  });
});

describe("first-student draft from v2", () => {
  it("builds a valid 21-credit draft with 10 elective half-units still to plan, then accepts five 1-credit electives", () => {
    const { content, error } = contentFromTemplate(v2, v2.totalRequiredHalfUnits, null);
    expect(error).toBeNull();
    expect(validateRoadmapContent(content, v2, { expectedTotalHalfUnits: 42 })).toEqual([]);
    expect(areaPlanRows(content).find((r) => r.key === "electives")).toMatchObject({ requiredHalfUnits: 10 });

    let draft = content;
    for (const title of ["Elective A", "Elective B", "Elective C", "Elective D", "Elective E"]) {
      draft = addCourse(draft, { title, areaKey: "electives", credits: "1", plannedStart: "", plannedEnd: "" });
    }
    expect(validateRoadmapContent(draft, v2, { expectedTotalHalfUnits: 42 })).toEqual([]);
    expect(blockingDraftIssues(draft)).toEqual([]);
    for (const row of areaPlanRows(draft)) expect(row.plannedHalfUnits).toBe(row.requiredHalfUnits);
  });
});
