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
  { weeks: "14–16", cumulative: 21, keys: ["contract-elective-word-excel", "contract-elective-business-math", "contract-elective-english-communications", "contract-elective-human-relations", "contract-elective-reading-skills"] },
];
export const CONTRACT_ELECTIVES = [
  ["contract-elective-word-excel", "Microsoft Word & Excel"],
  ["contract-elective-business-math", "Business Math"],
  ["contract-elective-english-communications", "English Communications"],
  ["contract-elective-human-relations", "Human Relations"],
  ["contract-elective-reading-skills", "Reading Skills"],
];

export function makeContractPlan(draftContent) {
  const content = structuredClone(draftContent);
  const electiveArea = content.areas.find((a) => a.kind === "elective");
  const base = content.courses.filter((c) => !/^(demo|contract)-elective-/.test(c.key) && !c.key.startsWith("s24-"));
  if (content.totalRequiredHalfUnits !== 42 || base.length !== 17 || base.reduce((n, c) => n + c.halfUnits, 0) !== 32) throw new Error("CONTRACT_TEMPLATE_MISMATCH");
  const electives = CONTRACT_ELECTIVES.map(([key, name]) => ({
    key, title: `${name} — ${CONTRACT_TAG}`, areaKey: electiveArea.key, halfUnits: 2, status: "planned",
    replacesCourseKey: null, plannedStart: null, plannedEnd: null, tasks: [],
  }));
  const byKey = new Map([...base, ...electives].map((c) => [c.key, c]));
  const ordered = [];
  let cumulative = 0;
  for (const phase of CONTRACT_PHASES) {
    for (const key of phase.keys) {
      const c = byKey.get(key);
      if (!c) throw new Error(`CONTRACT_COURSE_MISSING_${key}`);
      cumulative += c.halfUnits;
      c.tasks = [{ key: `${key}-target`, kind: "lesson", title: `Planning target: accelerated weeks ${phase.weeks} after activation (not a school deadline)`, dueDate: null }];
      ordered.push(c);
    }
    if (cumulative !== phase.cumulative * 2) throw new Error(`CONTRACT_PHASE_TOTAL_${phase.weeks}`);
  }
  content.courses = ordered;
  content.pacing = { targetCompletionDate: null, weeklyTargetHalfUnits: null, milestones: [] };
  content.studentMessage =
    "Plan indicatif (brouillon) : 21 crédits — 16 obligatoires + 5 options proposées en attente d’acceptation par l’école. " +
    "Objectif accéléré de 16 semaines après l’activation (horizon indicatif de 4 à 6 mois) : 3 crédits prévus à la semaine 4, 8 à la semaine 8, 16 à la semaine 13, 21 à la semaine 16. " +
    "Ce sont des objectifs de planification, pas des crédits obtenus ; seule l’école attribue les crédits.";
  return content;
}
