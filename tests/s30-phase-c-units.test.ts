/**
 * S30 Phase C — on S29's Fleet copilot: Unicode-aware EN/FR intent rules, the two calendar/pace intents
 * (deadlines_soon, behind_pace) built from the S30 calendar context, provenance labels, demo exclusion, and the
 * guarantee that these answers are deterministic (no AI call, requiresHumanApproval). Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { answerFleet, classifyIntent } from "../server/services/s29/fleet";
import { buildFleetCalendarContext } from "../server/services/s30/fleet-context";
import { MemoryBudgetStore } from "../server/services/academic-assistant/budget";
import type { ControlStudentRow } from "../shared/s27-contract";
import type { CalendarItem } from "../shared/s30-contract";

const NOW = new Date("2026-11-10T15:00:00.000Z");
const row = (o: Partial<ControlStudentRow> & Pick<ControlStudentRow, "studentId" | "name">): ControlStudentRow => ({
  code: `SYN-${o.studentId}`, program: "high_school", isDemo: false, creditsConfirmed: 4, creditsRequired: 21, paceLabel: "1 credits per week", estimatedFinishOn: "2027-06-01",
  status: { tone: "ok", label: "On track" }, nextDeadline: null, lastActivityOn: "2026-11-08", supportMonthsLeft: 6, ...o,
});
const cal = (o: Partial<CalendarItem> & Pick<CalendarItem, "id" | "kind" | "start" | "studentId">): CalendarItem => ({
  source: "agreement", studentName: "Ada Synthetic", studentCode: "SYN-a", isDemo: false, title: "Language test", titleKey: "s30.cal.title.language_test", end: null, allDay: true,
  timeZone: "UTC", status: "scheduled", location: null, href: `/admin/students/${o.studentId}?tab=overview`, editable: false, recordId: "r", ...o,
});
const ctx = buildFleetCalendarContext({
  now: NOW,
  students: [
    row({ studentId: "a", name: "Ada Synthetic" }),
    row({ studentId: "b", name: "Ben Example", estimatedFinishOn: "2027-09-01" }),
    row({ studentId: "c", name: "Chloé Exemple", estimatedFinishOn: null }),
    row({ studentId: "d", name: "Demo Person", isDemo: true, estimatedFinishOn: "2028-01-01" }),
    row({ studentId: "e", name: "Eve Lead", program: "none" }),
  ],
  targets: new Map([["a", "2027-12-01"], ["b", "2027-06-30"], ["c", "2027-03-01"], ["d", "2027-01-01"]]),
  calendar: [
    cal({ id: "agreement:a:language_test", kind: "academic_deadline", start: "2026-11-12", studentId: "a" }),
    cal({ id: "agreement:c:prior", kind: "document_deadline", start: "2026-11-05", studentId: "c", studentName: "Chloé Exemple", status: "overdue", titleKey: "s30.cal.title.prior_schooling_proof" }),
    cal({ id: "hsplan:b:m1", kind: "course_milestone", source: "high_school_plan", start: "2026-11-01", studentId: "b", studentName: "Ben Example", status: "overdue", title: "English 9 — Unit 1", titleKey: null }),
    cal({ id: "hsplan:b:m2", kind: "course_milestone", source: "high_school_plan", start: "2026-11-03", studentId: "b", studentName: "Ben Example", status: "overdue", title: "English 9 — Unit 2", titleKey: null }),
    cal({ id: "hsplan:b:old", kind: "course_milestone", source: "high_school_plan", start: "2026-10-01", studentId: "b", studentName: "Ben Example", status: "overdue", title: "Old", titleKey: null }),
    cal({ id: "checkpoint:a:done", kind: "program_checkpoint", source: "checkpoint", start: "2026-11-11", studentId: "a", status: "done" }),
    cal({ id: "event:x", kind: "advisor_meeting", source: "calendar_event", start: "2026-11-11T14:00:00.000Z", allDay: false, studentId: "a" }),
    cal({ id: "agreement:d:language_test", kind: "academic_deadline", start: "2026-11-13", studentId: "d", studentName: "Demo Person", isDemo: true }),
  ],
});
const deps = { budget: new MemoryBudgetStore(), now: () => NOW, calendar: ctx };

describe("intent rules (EN/FR, Unicode-aware)", () => {
  it("classifies the owner's questions, including French words starting with accented letters", () => {
    expect(classifyIntent("Who is approaching an important academic deadline?")).toBe("deadlines_soon");
    expect(classifyIntent("Quels élèves approchent d’une échéance académique importante ?")).toBe("deadlines_soon");
    expect(classifyIntent("Which students may be falling behind their planned pace?")).toBe("behind_pace");
    expect(classifyIntent("Quels élèves risquent de prendre du retard sur leur rythme prévu ?")).toBe("behind_pace");
    expect(classifyIntent("Prepare French follow-up messages for students with approaching deadlines")).toBe("draft_followups");
    expect(classifyIntent("Prépare des messages de relance en français pour les élèves dont l’échéance approche")).toBe("draft_followups");
    expect(classifyIntent("What enrollment or document issues are unresolved?")).toBe("documents_blocking");
    expect(classifyIntent("Which support conversations are waiting for replies?")).toBe("support_waiting");
    expect(classifyIntent("Which students have not made progress recently?")).toBe("no_recent_progress");
    expect(classifyIntent("What are the highest-priority actions this week?")).toBe("week_priorities");
    expect(classifyIntent("Which students need attention today?")).toBe("attention_today");
    expect(classifyIntent("bonjour")).toBe("overview");
  });
});

describe("calendar context", () => {
  it("deadlines: ±14 days, not done/cancelled, deadline kinds only, earliest first", () => {
    expect(ctx.deadlines.map((d) => [d.key, d.daysLeft])).toEqual([
      ["calendar:hsplan:b:m1", -9], ["calendar:hsplan:b:m2", -7], ["calendar:agreement:c:prior", -5], ["calendar:agreement:a:language_test", 2], ["calendar:agreement:d:language_test", 3],
    ]);
  });
  it("pace: finish after target, no pace toward a target, or ≥ 2 milestones past; programs only", () => {
    expect(ctx.pace.map((p) => [p.studentId, p.reason, p.missedMilestones])).toEqual([["b", "finish_after_target", 3], ["d", "finish_after_target", 0], ["c", "no_pace_with_target", 0]]);
  });
});

describe("answers on S29's copilot", () => {
  it("deadlines_soon: one cited line per deadline with links, planned dates labelled, demo excluded, deterministic", async () => {
    const a = await answerFleet({ question: "Who is approaching an important academic deadline?", language: "en", includeDemo: false }, [], deps);
    expect(a.intent).toBe("deadlines_soon");
    expect(a.ai.mode).toBe("not_requested");
    expect(a.requiresHumanApproval).toBe(true);
    expect(a.references).toHaveLength(4);
    expect(a.references.every((r) => r.href.startsWith("/admin/students/") && r.provenance === "fact" && !r.isDemo)).toBe(true);
    expect(a.lines.every((l) => l.refs.length === 1 && a.references.some((r) => r.ref === l.refs[0]))).toBe(true);
    expect(a.lines.find((l) => l.text.startsWith("Ada"))?.text).toContain("Language test · academic deadline");
    expect(a.lines.find((l) => l.text.includes("English 9 — Unit 1"))?.text).toContain("planned date, not a school requirement");
    expect(a.summary).toContain("4 academic deadline(s)");
    const withDemo = await answerFleet({ question: "deadline", language: "en", includeDemo: true }, [], deps);
    expect(withDemo.references.some((r) => r.isDemo)).toBe(true);
  });
  it("behind_pace: French, student-reported provenance, estimate wording", async () => {
    const a = await answerFleet({ question: "Quels élèves risquent de prendre du retard sur leur rythme prévu ?", language: "fr", includeDemo: false }, [], deps);
    expect(a.intent).toBe("behind_pace");
    expect(a.references.map((r) => [r.studentId, r.provenance])).toEqual([["b", "student_reported"], ["c", "student_reported"]]);
    expect(a.lines[0]!.text).toContain("après la date visée");
    expect(a.lines[0]!.text).toContain("3 jalon(s) dépassé(s)");
    expect(a.lines[0]!.text).toContain("estimation fondée sur les progrès déclarés par l’élève");
    expect(a.summary).toContain("2 élève(s)");
  });
  it("without calendar context the answer is empty but honest", async () => {
    const a = await answerFleet({ question: "deadline", language: "en", includeDemo: false }, [], { budget: new MemoryBudgetStore(), now: () => NOW });
    expect(a.references).toEqual([]);
    expect(a.summary).toBe("No academic deadline or milestone falls within the next 14 days.");
  });
});
