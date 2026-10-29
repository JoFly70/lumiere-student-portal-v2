/**
 * S26/S27 synthetic first-student demonstration plan (pure, no I/O).
 * Spec: docs/recovery/S26-FIRST-STUDENT-SYNTHETIC-21-CREDIT-PLAN.md
 *
 * S27: built from template us-hs-diploma-21 VERSION 3 (22 courses: 17 core = 16 credits + 5 electives = 5 credits,
 * with the contracted exam/project structure as plan tasks). Months are relative to the fictional QA start date.
 * Task due dates are planning placeholders, never school policy or graded work.
 */
export const DEMO_TAG = "DEMO / SYNTHETIC — NOT A REAL STUDENT";
export const ELECTIVE_TAG = "TEST ONLY / SCHOOL APPROVAL PENDING";
export const DEMO_START = "2026-11-02";
export const DEMO_TARGET = "2027-10-29";
export const TEMPLATE_VERSION = 3;

/** Month (1-12) -> course keys of template v3. */
export const MONTH_PLAN = [
  ["startup-personal-growth", "startup-learning-tech"],
  ["humanities-digital-literacy", "english-1"],
  ["english-2", "math-general-1"],
  ["english-3", "science-earth"],
  ["english-4", "math-personal-finance"],
  ["science-biology", "math-general-2"],
  ["science-physical", "social-us-history"],
  ["social-world-history", "social-us-gov-econ"],
  ["health-nutrition", "elective-business-math"],
  ["elective-word-excel", "elective-english-communications"],
  ["elective-human-relations"],
  ["elective-reading-skills"],
];

const iso = (d) => d.toISOString().slice(0, 10);
function addDays(isoDate, days) { const d = new Date(`${isoDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return iso(d); }
function monthStart(i, start = DEMO_START) { const d = new Date(`${start}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + i); return iso(d); }

/** Keeps the template's tasks (exam-1..N, project) and spreads their planned dates over the course window. */
function datedTasks(tasks, start, end) {
  const span = Math.max(7, Math.round((Date.parse(end) - Date.parse(start)) / 86400000));
  return tasks.map((t, i) => ({ ...t, dueDate: addDays(start, Math.round(span * 0.9 * ((i + 1) / tasks.length))) }));
}

function assertV3(content) {
  const electiveArea = content.areas.find((a) => a.kind === "elective");
  const coreHalf = content.areas.filter((a) => a.kind === "core").reduce((n, a) => n + a.requiredHalfUnits, 0);
  const planned = content.courses.filter((c) => c.status === "planned");
  if (content.totalRequiredHalfUnits !== 42 || coreHalf !== 32 || electiveArea?.requiredHalfUnits !== 10
    || planned.length !== 22 || planned.reduce((n, c) => n + c.halfUnits, 0) !== 42
    || planned.filter((c) => c.areaKey === electiveArea.key).length !== 5 || planned.some((c) => c.tasks.length === 0)) throw new Error("DEMO_TEMPLATE_MISMATCH");
  return electiveArea;
}

const retitleElectives = (courses, electiveAreaKey, tag) =>
  courses.map((c) => (c.areaKey === electiveAreaKey ? { ...c, title: `${c.title.split(" — ")[0]} — ${tag}` } : c));

/** Turns a template-v3 draft into the full 21-credit demonstration plan. */
export function makeDemoPlan(draftContent, start = DEMO_START) {
  const content = structuredClone(draftContent);
  const electiveArea = assertV3(content);
  const courses = retitleElectives(content.courses.filter((c) => !c.key.startsWith("s24-")), electiveArea.key, ELECTIVE_TAG);
  MONTH_PLAN.forEach((keys, m) => {
    const s0 = monthStart(m, start), end = addDays(monthStart(m + 1, start), -1);
    for (const key of keys) {
      const course = courses.find((c) => c.key === key);
      if (!course) throw new Error(`DEMO_COURSE_MISSING_${key}`);
      Object.assign(course, { plannedStart: s0, plannedEnd: end, tasks: datedTasks(course.tasks, s0, end) });
    }
  });
  let cumulative = 0;
  const milestones = MONTH_PLAN.map((keys, m) => {
    cumulative += keys.reduce((n, k) => n + courses.find((c) => c.key === k).halfUnits, 0);
    return { month: monthStart(m, start).slice(0, 7), cumulativeHalfUnits: cumulative };
  });
  if (cumulative !== 42 || courses.length !== 22) throw new Error("DEMO_PLAN_TOTAL_MISMATCH");
  content.courses = courses;
  content.pacing = { targetCompletionDate: start === DEMO_START ? DEMO_TARGET : addDays(monthStart(12, start), -3), weeklyTargetHalfUnits: null, milestones };
  content.studentMessage =
    `${DEMO_TAG}. Plan de démonstration sur 12 mois / 12-month demonstration plan: 21 crédits prévus (16 obligatoires + 5 options ${ELECTIVE_TAG}). ` +
    "0 crédit officiel. Les dates sont des objectifs, pas des exigences de l’école. / Dates are targets, not school requirements; only the school awards credit.";
  return content;
}

/* ------------------------------------------------------------------------------------------------
 * Contract-aligned plan for the REAL first student (docs/recovery/S26-CONTRACT-ALIGNED-FIRST-STUDENT-OVERRIDE.md).
 * DRAFT ONLY until signature, payment and activation are verified: no dates are set (timelines are
 * relative to actual academic activation), nothing is published, no credit is awarded.
 * ---------------------------------------------------------------------------------------------- */
export const CONTRACT_TAG = "PROPOSED — AWAITING SCHOOL ACCEPTANCE";
export const CONTRACT_PHASES = [
  { weeks: "1–4", cumulative: 3, keys: ["startup-personal-growth", "startup-learning-tech", "english-1", "math-general-1"] },
  { weeks: "5–8", cumulative: 8, keys: ["english-2", "math-general-2", "humanities-digital-literacy", "science-earth", "social-world-history"] },
  { weeks: "9–13", cumulative: 16, keys: ["english-3", "english-4", "science-biology", "science-physical", "math-personal-finance", "social-us-history", "social-us-gov-econ", "health-nutrition"] },
  { weeks: "14–16", cumulative: 21, keys: ["elective-word-excel", "elective-business-math", "elective-english-communications", "elective-human-relations", "elective-reading-skills"] },
];

/**
 * Contract draft from a template-v3 draft: courses ordered by the 16-week phases, the five contracted electives
 * marked as proposed, the template's exam/project tasks kept (no dates). The phase itself is conveyed by the
 * order and the student message, not by an extra task (an extra task would distort the logged-pace math).
 */
export function makeContractPlan(draftContent) {
  const content = structuredClone(draftContent);
  const electiveArea = assertV3(content);
  const byKey = new Map(retitleElectives(content.courses.filter((c) => !c.key.startsWith("s24-")), electiveArea.key, CONTRACT_TAG).map((c) => [c.key, c]));
  const ordered = [];
  let cumulative = 0;
  for (const phase of CONTRACT_PHASES) {
    for (const key of phase.keys) {
      const c = byKey.get(key);
      if (!c) throw new Error(`CONTRACT_COURSE_MISSING_${key}`);
      cumulative += c.halfUnits;
      ordered.push({ ...c, plannedStart: null, plannedEnd: null });
    }
    if (cumulative !== phase.cumulative * 2) throw new Error(`CONTRACT_PHASE_TOTAL_${phase.weeks}`);
  }
  if (ordered.length !== byKey.size) throw new Error("CONTRACT_COURSE_COUNT");
  content.courses = ordered;
  content.pacing = { targetCompletionDate: null, weeklyTargetHalfUnits: null, milestones: [] };
  content.studentMessage =
    "Plan indicatif (brouillon) : 21 crédits — 16 obligatoires + 5 options proposées en attente d’acceptation par l’école. " +
    "Objectif accéléré de 16 semaines après l’activation (horizon indicatif de 4 à 6 mois) : 3 crédits prévus à la semaine 4, 8 à la semaine 8, 16 à la semaine 13, 21 à la semaine 16. " +
    "Ce sont des objectifs de planification, pas des crédits obtenus ; seule l’école attribue les crédits.";
  return content;
}
