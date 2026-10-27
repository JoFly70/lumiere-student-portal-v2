import { describe, expect, it } from "vitest";
import { zodResolver } from "@hookform/resolvers/zod";
import { courseFormSchema, courseEditSchema } from "../client/src/lib/course-form-schema";
import { TEMPLATE_STANDARD_21_V2, hsRoadmapContentSchema, createEnrollmentSchema } from "../shared/high-school-contract";
import { contentFromTemplate, validateRoadmapContent } from "../shared/high-school-projection";

const course = {
  providerId: "synthetic-provider",
  courseCode: "TEST101",
  title: "Synthetic Course",
  credits: "3",
};
const resolverOptions = { fields: {}, shouldUseNativeValidation: false } as any;

describe("S16 first-student validation with patched Zod and real form resolver", () => {
  it("coerces numeric course input, applies the creation default, and returns numeric credits", async () => {
    const result = await zodResolver(courseFormSchema)(course, {}, resolverOptions);
    expect(result.errors).toEqual({});
    expect(result.values).toMatchObject({ credits: 3, status: "todo" });
  });

  it.each(["invalid", "0", "7"])("returns a field error for invalid credits %s", async (credits) => {
    const result = await zodResolver(courseFormSchema)({ ...course, credits }, {}, resolverOptions);
    expect(result.errors).toHaveProperty("credits");
    expect(result.values).toEqual({});
  });

  it("does not let course self-reporting award completed credit", () => {
    expect(courseFormSchema.safeParse({ ...course, status: "completed" }).success).toBe(false);
    expect(courseEditSchema.parse({ ...course, status: "completed" })).toMatchObject({ credits: 3, status: "completed" });
  });

  it("keeps an S16 21-credit first-student draft valid and credit totals unchanged", () => {
    const template = TEMPLATE_STANDARD_21_V2;
    const { content, error } = contentFromTemplate(template, template.totalRequiredHalfUnits, null);
    expect(error).toBeNull();
    const parsed = hsRoadmapContentSchema.parse(JSON.parse(JSON.stringify(content)));
    expect(validateRoadmapContent(parsed, template, { expectedTotalHalfUnits: 42 })).toEqual([]);
    expect(template.totalRequiredHalfUnits).toBe(42);
    expect(template.courses).toHaveLength(17);
  });

  it("keeps strict first-student enrollment bodies closed to actor spoofing", () => {
    const input = {
      templateKey: TEMPLATE_STANDARD_21_V2.templateKey,
      templateVersion: TEMPLATE_STANDARD_21_V2.version,
    };
    expect(createEnrollmentSchema.safeParse(input).success).toBe(true);
    expect(createEnrollmentSchema.safeParse({ ...input, createdBy: "spoofed" }).success).toBe(false);
  });
});
