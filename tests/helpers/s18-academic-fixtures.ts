/** S18 fixtures: real StudentHighSchoolView built from template us-hs-diploma-21 v2 (never a constant). */
import { TEMPLATE_STANDARD_21_V2, type HsRoadmapContent, type StudentHighSchoolView } from "../../shared/high-school-contract";
import { contentFromTemplate, projectStudentView, type HsAwardRecord, type HsCourseResultRecord, type HsProgressRecord, type HsProjectionInput } from "../../shared/high-school-projection";

export const NOW = "2026-10-27T12:00:00.000Z";
export const TEMPLATE = TEMPLATE_STANDARD_21_V2;

export interface Opts {
  published?: boolean;
  mutate?: (c: HsRoadmapContent) => HsRoadmapContent;
  progress?: HsProgressRecord[];
  courseResults?: HsCourseResultRecord[];
  awards?: HsAwardRecord[];
}

export function baseContent(): HsRoadmapContent {
  return contentFromTemplate(TEMPLATE, TEMPLATE.totalRequiredHalfUnits, null).content;
}

export const withTask = (c: HsRoadmapContent, courseKey: string, key = "t1", dueDate: string | null = null): HsRoadmapContent => ({
  ...c,
  courses: c.courses.map((x) => (x.key === courseKey ? { ...x, tasks: [...x.tasks, { key, kind: "lesson" as const, title: `Task ${key}`, dueDate }] } : x)),
});

export const award = (courseKey: string, areaKey: string, halfUnits: number, id = `a-${courseKey}`): HsAwardRecord => ({
  id,
  source: "course_completion",
  courseKey,
  areaKey,
  halfUnits,
  status: "active",
});

export function makeView(o: Opts = {}): StudentHighSchoolView {
  const published = o.published ?? true;
  const content = o.mutate ? o.mutate(baseContent()) : baseContent();
  const input: HsProjectionInput = {
    enrollment: {
      id: "enr-1",
      status: "active",
      programTitle: TEMPLATE.title,
      startedOn: "2026-09-01",
      targetCompletionDate: null,
      institutionDisclosed: false,
      awardingSchoolName: null,
      totalRequiredHalfUnits: TEMPLATE.totalRequiredHalfUnits,
    },
    fallbackAreas: content.areas,
    roadmap: published ? { versionNumber: 1, publishedAt: NOW, content } : null,
    progress: o.progress ?? [],
    taskResults: [],
    courseResults: o.courseResults ?? [],
    awards: o.awards ?? [],
    priorEducation: [],
    graduation: null,
    guardians: [],
    nowIso: NOW,
  };
  return projectStudentView(input);
}

export const META = { templateKey: TEMPLATE.templateKey, templateVersion: TEMPLATE.version };
