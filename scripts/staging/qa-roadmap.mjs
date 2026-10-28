export const QA_STUDENT_CODE = "S24-STAGING-OWNER-QA";
export const QA_NOTICE = "STAGING TEST ONLY / NOT SCHOOL-APPROVED";

/** Local fixture, never a school catalog or a modification of the shared template. */
export function makeQaRoadmap(templateContent) {
  const content = structuredClone(templateContent);
  const core = content.areas.filter(a => a.kind === "core");
  const electives = content.areas.filter(a => a.kind === "elective");
  if (content.totalRequiredHalfUnits !== 42
    || core.reduce((n, a) => n + a.requiredHalfUnits, 0) !== 32
    || electives.length !== 1 || electives[0].requiredHalfUnits !== 10
    || content.courses.filter(c => c.status === "planned").reduce((n, c) => n + c.halfUnits, 0) !== 32
    || content.courses.some(c => c.areaKey === electives[0].key)) {
    throw new Error("QA_TEMPLATE_MISMATCH");
  }
  content.courses.push(...Array.from({ length: 5 }, (_, i) => ({
    key: `s24-test-only-elective-${i + 1}`,
    title: `${QA_NOTICE} — Placeholder elective ${i + 1}`,
    areaKey: electives[0].key, halfUnits: 2, status: "planned",
    replacesCourseKey: null, plannedStart: null, plannedEnd: null, tasks: [],
  })));
  content.studentMessage = `${QA_NOTICE}. Synthetic QA plan, not an enrollment, transcript, grade, certification or school-approved curriculum. Existing 16-core template structure retained; five elective credits are placeholders ONLY. No official credits have been awarded.`;
  return content;
}
