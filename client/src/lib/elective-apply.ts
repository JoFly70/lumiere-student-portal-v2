/**
 * Applying an approved elective change to the roadmap WITHOUT editing the published version: the
 * substitution goes into a new draft version (replacesCourseKey keeps the old course and its history),
 * and an administrator publishes it from the High school pathway. Pure helpers.
 */
import type { HsRoadmapContent, StaffHighSchoolState } from "@shared/high-school-contract";
import { formatHalfUnits } from "@shared/high-school-contract";
import { replaceCourse, validateNewCourse } from "./admin-high-school-logic";

export type SubstitutionStatus =
  | { kind: "published"; versionNumber: number }
  | { kind: "draft"; versionNumber: number; revision: number }
  | { kind: "can_draft"; hasDraft: false }
  | { kind: "blocked"; reason: string };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function hasSubstitution(content: HsRoadmapContent | undefined | null, courseKey: string, alternate: string): boolean {
  return !!content?.courses.some((c) => c.status === "planned" && c.replacesCourseKey === courseKey && same(c.title, alternate));
}

/** Where the substitution stands in the student's roadmap versions. */
export function substitutionStatus(state: StaffHighSchoolState | undefined, courseKey: string | null, alternate: string): SubstitutionStatus {
  const cur = state?.current;
  if (!cur) return { kind: "blocked", reason: "This student has no high school program yet." };
  if (!courseKey) return { kind: "blocked", reason: "The request does not name a roadmap course, so the swap cannot be prepared automatically. Edit the roadmap by hand." };
  if (hasSubstitution(cur.published?.content, courseKey, alternate)) return { kind: "published", versionNumber: cur.published!.versionNumber };
  if (cur.draft && hasSubstitution(cur.draft.content, courseKey, alternate)) return { kind: "draft", versionNumber: cur.draft.versionNumber, revision: cur.draft.draftRevision };
  if (cur.draft) return { kind: "blocked", reason: `A draft (version ${cur.draft.versionNumber}) is already open. Add the swap there so no work is lost.` };
  const source = cur.published?.content;
  if (!source) return { kind: "blocked", reason: "There is no published roadmap to draft from." };
  const old = source.courses.find((c) => c.key === courseKey);
  if (!old) return { kind: "blocked", reason: "The course to replace is not in the published roadmap." };
  if (old.status !== "planned") return { kind: "blocked", reason: "That course is no longer planned in the published roadmap." };
  return { kind: "can_draft", hasDraft: false };
}

/** The draft content with `courseKey` replaced by `alternate` (same area, credit and dates). Throws a readable Error when impossible. */
export function substituteInDraft(content: HsRoadmapContent, courseKey: string, alternate: string): HsRoadmapContent {
  const old = content.courses.find((c) => c.key === courseKey);
  if (!old || old.status !== "planned") throw new Error("The course to replace is not planned in this draft.");
  const form = { title: alternate.trim(), areaKey: old.areaKey, credits: formatHalfUnits(old.halfUnits), plannedStart: old.plannedStart ?? "", plannedEnd: old.plannedEnd ?? "" };
  const problem = validateNewCourse(content, form);
  if (problem) throw new Error(problem);
  return replaceCourse(content, courseKey, form);
}
