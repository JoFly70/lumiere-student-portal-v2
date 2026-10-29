/**
 * Synthetic fixtures for the S27 student screens (unit tests and the screenshot harness). One invented student
 * (Noa Fischer) and invented universities. No real people, schools or documents.
 */
import type { StudentHighSchoolView } from "../../shared/high-school-contract";
import type { StudentJourneyView } from "../../shared/s27-contract";
import { buildHsView } from "./s11-hs-ui-fixtures";

export const S27_TODAY = "2026-10-29";

/** Mid-program student: 9 credits confirmed, a retake, an exam waiting for a grade, electives awaiting approval. */
export function s27HsView(): StudentHighSchoolView {
  const base = buildHsView({
    states: {
      "startup-personal-growth": "done",
      "startup-learning-tech": "done",
      "humanities-digital-literacy": "done",
      "english-1": "done",
      "english-2": "done",
      "english-3": "progress",
      "math-general-1": "done",
      "math-general-2": "done",
      "science-earth": "done",
      "science-physical": "progress",
      "science-biology": "awaiting",
      "social-world-history": "done",
      "social-2": "progress",
    },
    startedOn: "2026-09-07",
    target: "2026-12-28",
    publishedAt: "2026-09-07",
    dueBase: "2026-10-22",
    pace: { weeklyTargetHalfUnits: 3, expectedByNowHalfUnits: 15, status: "ahead", nextMilestone: null },
    guardians: [],
    studentMessage: null,
  });
  const subjects = base.subjects.map((s) => ({
    ...s,
    courses: s.courses.map((c) => {
      let course = c;
      if (c.key.startsWith("elective-") && c.status === "not_started") course = { ...c, title: `${c.title} (PROPOSED)` };
      if (c.key === "science-physical") {
        // first try failed: retake is needed on the exam
        course = { ...c, tasks: c.tasks.map((t) => (t.kind === "exam" ? { ...t, status: "retake_required" as const, reportedScorePercent: null } : t)) };
      }
      return course;
    }),
  }));
  const milestones = [["2026-09", 4], ["2026-10", 9], ["2026-11", 15], ["2026-12", 21]].map(([month, c]) => ({ month: month as string, cumulativeHalfUnits: (c as number) * 2 }));
  return { ...base, subjects, milestones };
}

export function s27Journey(): StudentJourneyView {
  return {
    agreement: {
      signedOn: "2026-08-31",
      activatedOn: "2026-09-07",
      supportMonths: 9,
      supportEndsOn: "2027-06-07",
      supportMonthsLeft: 7,
      accessMonths: 36,
      accessEndsOn: "2029-09-07",
      deadlines: [
        { key: "language_test", label: "English proficiency test", rule: "30 days after signing", dueOn: "2026-09-30", status: "done", doneOn: "2026-09-24", detail: "Score 112 (target 105–115)", daysLeft: null },
        { key: "prior_schooling_proof", label: "Proof of previous schooling", rule: "90 days after activation", dueOn: "2026-12-06", status: "open", doneOn: null, detail: null, daysLeft: 38 },
      ],
      orientationSessionsIncluded: 2,
      orientationSessionsUsed: 1,
      goal: {
        field: "Communication",
        region: "Québec",
        interests: ["Media", "Public relations", "Digital communication", "Marketing"],
        targets: [
          { name: "Université du Lac", city: "Lacville", track: "French track", program: "Baccalauréat en communication appliquée", why: "A French-language program aimed at professional communication, with co-op terms.", admission: "A preparatory year may be offered; the university decides.", url: "https://example.org/lac" },
          { name: "Metro College", city: "Metropolis", track: "English track", program: "B.A. Communication Studies", why: "English-language programs in a large city, strong in media production.", admission: "Accredited diplomas usually enter an extended program.", url: "https://example.org/metro" },
          { name: "Université du Nord", city: "Nordville", track: "Politics", program: "Baccalauréat en communication et politique", why: "Combines media, public life and institutional communication.", admission: "Rules are confirmed for the year you apply.", url: null },
        ],
        alsoReviewed: ["Université Est", "Collège Ouest"],
        studyOn: "2026-10-20",
      },
    },
    checkpoints: [
      { key: "file_opened", label: "File opened", status: "done", plannedOn: null, doneOn: "2026-08-31" },
      { key: "program_activated", label: "Program activated", status: "done", plannedOn: null, doneOn: "2026-09-07" },
      { key: "kickoff_call", label: "Kickoff call", status: "done", plannedOn: null, doneOn: "2026-09-09" },
      { key: "language_test", label: "Language test", status: "done", plannedOn: null, doneOn: "2026-09-24" },
      { key: "midpoint_check", label: "Midpoint check", status: "next", plannedOn: "2026-11-12", doneOn: null },
      { key: "readiness_check", label: "Diploma-readiness check", status: "upcoming", plannedOn: null, doneOn: null },
      { key: "closing", label: "Closing: transcript & diploma", status: "upcoming", plannedOn: null, doneOn: null },
    ],
    sessions: [
      { id: "ses-1", slotAt: "2026-11-03T17:00:00+01:00", status: "confirmed", prep: { fields: ["Media", "Marketing"], language: ["French"] }, notes: null, createdAt: "2026-10-25T10:00:00Z" },
    ],
    pace: { creditsPerWeek: 1.6, itemsLogged28d: 27, lastLoggedOn: "2026-10-28", stale: false, estimatedFinishOn: "2026-12-21", examsThisWeek: 4, weeklyExamLimit: 15 },
  };
}

export const S27_DOCS = [
  { id: "d1", doc_type: "id_gov", file_name: "id.pdf", status: "verified", created_at: "2026-09-01T10:00:00Z" },
  { id: "d2", doc_type: "agreement", file_name: "agreement.pdf", status: "verified", created_at: "2026-09-01T10:00:00Z" },
  { id: "d3", doc_type: "language_test", file_name: "english-test.pdf", status: "verified", created_at: "2026-09-25T10:00:00Z" },
  { id: "d4", doc_type: "hs_transcript", file_name: "report-card.pdf", status: "resubmit_requested", created_at: "2026-10-10T10:00:00Z" },
];
