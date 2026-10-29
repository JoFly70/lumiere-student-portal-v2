/**
 * S26 synthetic first-student demonstration plan (pure, no I/O).
 * Spec: docs/recovery/S26-FIRST-STUDENT-SYNTHETIC-21-CREDIT-PLAN.md
 *
 * 17 core courses from template us-hs-diploma-21 v2 (16 credits) + 5 TEST ONLY elective
 * candidates (5 credits) = 21 planned credits = 42 half-units. Months are relative to the
 * fictional QA start date; tasks are planning placeholders, never school policy or graded work.
 */
export const DEMO_TAG = "DEMO / SYNTHETIC — NOT A REAL STUDENT";
export const ELECTIVE_TAG = "TEST ONLY / SCHOOL APPROVAL PENDING";
export const DEMO_START = "2026-11-02";
export const DEMO_TARGET = "2027-10-29";

/** Month (1-12) -> course keys, exactly as the S26 12-month table. */
export const MONTH_PLAN = [
  ["startup-personal-growth", "startup-learning-tech"],
  ["humanities-digital-literacy", "english-1"],
  ["english-2", "math-general-1"],
  ["english-3", "science-earth"],
  ["english-4", "math-personal-finance"],
  ["science-biology", "math-general-2"],
  ["science-physical", "social-us-history"],
  ["social-world-history", "social-us-gov-econ"],
  ["health-nutrition", "demo-elective-business-math"],
  ["demo-elective-word-excel", "demo-elective-english-communications"],
  ["demo-elective-art-appreciation"],
  ["demo-elective-economics"],
];

export const DEMO_ELECTIVES = [
  ["demo-elective-business-math", "Business Math"],
  ["demo-elective-word-excel", "Microsoft Word & Excel"],
  ["demo-elective-english-communications", "English Communications"],
  ["demo-elective-art-appreciation", "Art Appreciation"],
  ["demo-elective-economics", "Economics (check overlap with U.S. Government and Economics)"],
];

const iso = (d) => d.toISOString().slice(0, 10);
function addDays(isoDate, days) { const d = new Date(`${isoDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return iso(d); }
function monthStart(i) { const d = new Date(`${DEMO_START}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + i); return iso(d); }

function tasksFor(key, start, end) {
  const span = Math.max(7, Math.round((Date.parse(end) - Date.parse(start)) / 86400000));
  const at = (f) => addDays(start, Math.round(span * f));
  return [
    { key: `${key}-enter`, kind: "lesson", title: "DEMO — Enter the course and complete its orientation", dueDate: at(0.1) },
    { key: `${key}-lessons`, kind: "lesson", title: "DEMO — Work through the required lessons listed in the school LMS", dueDate: at(0.5) },
    { key: `${key}-checks`, kind: "exam", title: "DEMO — Knowledge checks as listed in the school LMS (count set by the school)", dueDate: at(0.7) },
    { key: `${key}-graded`, kind: "project", title: "DEMO — Required graded work as listed in the school LMS", dueDate: at(0.9) },
    { key: `${key}-evidence`, kind: "lesson", title: "DEMO — Share the school's result evidence for staff reconciliation", dueDate: end },
  ];
}

/** Turns a template-v2 draft into the full 21-credit demonstration plan. */
export function makeDemoPlan(draftContent) {
  const content = structuredClone(draftContent);
  const electiveArea = content.areas.find((a) => a.kind === "elective");
  const coreHalf = content.areas.filter((a) => a.kind === "core").reduce((n, a) => n + a.requiredHalfUnits, 0);
  const planned = content.courses.filter((c) => c.status === "planned");
  if (content.totalRequiredHalfUnits !== 42 || coreHalf !== 32 || electiveArea?.requiredHalfUnits !== 10
    || planned.length !== 17 || planned.reduce((n, c) => n + c.halfUnits, 0) !== 32) throw new Error("DEMO_TEMPLATE_MISMATCH");

  const base = content.courses.filter((c) => !c.key.startsWith("demo-elective-") && !c.key.startsWith("s24-"));
  const electives = DEMO_ELECTIVES.map(([key, name]) => ({
    key, title: `${name} — ${ELECTIVE_TAG}`, areaKey: electiveArea.key, halfUnits: 2, status: "planned",
    replacesCourseKey: null, plannedStart: null, plannedEnd: null, tasks: [],
  }));
  const courses = [...base, ...electives];
  MONTH_PLAN.forEach((keys, m) => {
    const start = monthStart(m), end = addDays(monthStart(m + 1), -1);
    for (const key of keys) {
      const course = courses.find((c) => c.key === key);
      if (!course) throw new Error(`DEMO_COURSE_MISSING_${key}`);
      Object.assign(course, { plannedStart: start, plannedEnd: end, tasks: tasksFor(key, start, end) });
    }
  });
  let cumulative = 0;
  const milestones = MONTH_PLAN.map((keys, m) => {
    cumulative += keys.reduce((n, k) => n + courses.find((c) => c.key === k).halfUnits, 0);
    return { month: monthStart(m).slice(0, 7), cumulativeHalfUnits: cumulative };
  });
  if (cumulative !== 42 || courses.length !== 22) throw new Error("DEMO_PLAN_TOTAL_MISMATCH");
  content.courses = courses;
  content.pacing = { targetCompletionDate: DEMO_TARGET, weeklyTargetHalfUnits: null, milestones };
  content.studentMessage =
    `${DEMO_TAG}. Plan de démonstration sur 12 mois / 12-month demonstration plan: 21 crédits prévus (16 obligatoires + 5 options ${ELECTIVE_TAG}). ` +
    "0 crédit officiel. Les dates sont des objectifs, pas des exigences de l’école. / Dates are targets, not school requirements; only the school awards credit.";
  return content;
}
