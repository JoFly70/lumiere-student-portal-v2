import { describe, expect, it } from "vitest";
import { composeStudentRecords, answerFromRecord } from "../server/services/academic-assistant/student-record";
import { composeOwnerContext } from "../server/services/owner-assistant/context";
import { CHECKPOINT_KEYS, CHECKPOINT_LABELS, type StudentJourneyView } from "../shared/s27-contract";

const journey: StudentJourneyView = {
  agreement: {
    signedOn: "2026-11-02", activatedOn: "2026-11-09", supportMonths: 9, supportEndsOn: "2027-08-09", supportMonthsLeft: 9, accessMonths: 36, accessEndsOn: "2029-11-09",
    deadlines: [
      { key: "language_test", label: "Language test", rule: "30 days after signing", dueOn: "2026-12-02", status: "open", doneOn: null, detail: null, daysLeft: 21 },
      { key: "prior_schooling_proof", label: "Proof of prior schooling", rule: "90 days after activation", dueOn: "2027-02-07", status: "open", doneOn: null, detail: null, daysLeft: 88 },
    ],
    orientationSessionsIncluded: 2, orientationSessionsUsed: 1,
    goal: { field: "Communication", region: "Québec", interests: [], targets: [], alsoReviewed: [], studyOn: null },
  },
  checkpoints: CHECKPOINT_KEYS.map((key, i) => ({ key, label: CHECKPOINT_LABELS[key], status: i === 0 ? "done" as const : i === 1 ? "next" as const : "upcoming" as const, plannedOn: null, doneOn: i === 0 ? "2026-10-30" : null })),
  sessions: [],
  pace: { creditsPerWeek: 0.5, itemsLogged28d: 6, lastLoggedOn: "2026-11-10", stale: false, estimatedFinishOn: "2027-03-01", examsThisWeek: 2, weeklyExamLimit: 15 },
};

describe("S27 assistant context", () => {
  it("student records gain journey records after the existing ones, student-safe", () => {
    const base = composeStudentRecords({ highSchool: null, documents: [], tickets: [], billing: null, today: "2026-11-11" });
    const withJ = composeStudentRecords({ highSchool: null, documents: [], tickets: [], billing: null, journey, today: "2026-11-11" });
    expect(withJ.slice(0, base.length)).toEqual(base);
    const labels = withJ.slice(base.length).map((r) => r.label);
    expect(labels).toEqual(["Program agreement", "Goal", "Checkpoints", "Pace", "Orientation sessions"]);
    const text = withJ.map((r) => r.text).join("\n");
    expect(text).toMatch(/due 2026-12-02, 21 day\(s\) left/);
    expect(text).toMatch(/estimate/);
    expect(text).not.toMatch(/internal|staff note/i);
    const ans = answerFromRecord("When is my language test deadline?", "en", withJ);
    expect(ans?.text).toMatch(/Language test/);
  });
  it("owner context adds agreement, checkpoints, pace, notes count and billing schedule; bodies are scrubbed", () => {
    const records = composeOwnerContext({
      student: { id: "s1", student_code: "C1", status: "active", user_id: "u" }, highSchool: null, reviewQueue: [], documents: [], tickets: [],
      billing: { state: "configured", currency: "USD", agreedCents: 400000, paidCents: 200000, remainingCents: 200000, evidenceAwaiting: 1,
        schedule: [{ dueDate: "2026-10-05", amountCents: 100000, status: "paid" }, { dueDate: "2026-11-02", amountCents: 100000, status: "paid" }, { dueDate: "2026-12-01", amountCents: 100000, status: "upcoming" }, { dueDate: "2027-01-04", amountCents: 100000, status: "upcoming" }] },
      program: { journey, notesCount: 2, noteBodies: ["Call parent at +212 600 000 000 or a@b.invalid"] },
    });
    const text = records.map((r) => r.text).join("\n");
    expect(text).toMatch(/Installment schedule: 4 installment\(s\); 2 paid, 0 overdue, 0 due today, 2 upcoming/);
    expect(text).toMatch(/Agreement signed 2026-11-02/);
    expect(text).toMatch(/2 internal staff note\(s\)/);
    expect(text).toContain("[number]");
    expect(text).toContain("[email]");
    expect(text).not.toContain("a@b.invalid");
    const noBodies = composeOwnerContext({ student: { id: "s1", status: "active" }, highSchool: null, reviewQueue: [], documents: [], tickets: [], program: { journey: null, notesCount: 3 } });
    expect(noBodies.map((r) => r.text).join("\n")).toMatch(/3 internal staff note\(s\) on file\.$/m);
  });
});
