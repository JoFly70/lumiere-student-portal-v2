import { describe, expect, it } from "vitest";
import {
  arcGeometry, creditsFraction, daysLeftTone, filterStudentRows, formatArrival, greetingKey, installmentStatusMeta, mergeTimeline,
  offsetIsoToLocal, planPayload, queueActionHref, queueItemMeta, sessionActions, sortQueue, splitRemainingEvenly, toOffsetIso,
  validatePlan, fileTabFromSearch, fileTabsFor, type PlanRow,
} from "../client/src/lib/owner-presentation";
import { agreementToForm, formToUpdate } from "../client/src/lib/agreement-form";
import { buildDecisions, courseAverage, creditsBySource } from "../client/src/lib/file-decisions";
import type { ProgramAgreementView } from "../shared/s27-contract";

const row = (dueDate: string, amount: string, locked = false, key = dueDate): PlanRow => ({ key, dueDate, amount, label: "", locked });

describe("queue mapping", () => {
  it("maps severity to tone and kind to icon + action", () => {
    expect(queueItemMeta({ kind: "inactive", severity: "critical" })).toMatchObject({ icon: "alert", tone: "urgent", actionKey: "owner.q.act.openFile" });
    expect(queueItemMeta({ kind: "document_review", severity: "warning" })).toMatchObject({ icon: "document", tone: "attention" });
    expect(queueItemMeta({ kind: "low_grade", severity: "info" }).tone).toBe("neutral");
  });
  it("sorts critical first and keeps server order inside a severity", () => {
    const out = sortQueue([{ severity: "info", id: 1 }, { severity: "critical", id: 2 }, { severity: "warning", id: 3 }, { severity: "critical", id: 4 }]);
    expect(out.map((x) => x.id)).toEqual([2, 4, 3, 1]);
  });
  it("sends admin links as-is and rewrites file links for staff", () => {
    expect(queueActionHref("/admin/students/s1?tab=billing", "admin")).toBe("/admin/students/s1?tab=billing");
    expect(queueActionHref("/admin/students/s1?tab=billing", "staff")).toBe("/admin/students/s1/billing");
    expect(queueActionHref("/admin/students/s1?tab=documents", "staff")).toBe("/support");
    expect(queueActionHref("/support?x=1", "staff")).toBe("/support?x=1");
  });
  it("greets by hour", () => {
    expect(greetingKey(8)).toBe("owner.cc.hello.morning");
    expect(greetingKey(13)).toBe("owner.cc.hello.afternoon");
    expect(greetingKey(21)).toBe("owner.cc.hello.evening");
    expect(greetingKey(2)).toBe("owner.cc.hello.evening");
  });
});

describe("days left and dates", () => {
  it("tones", () => {
    expect([-2, 0, 3, 4, 7, 8].map(daysLeftTone)).toEqual(["urgent", "urgent", "urgent", "attention", "attention", "neutral"]);
  });
  it("formats arrival as day-month near, month-year far", () => {
    expect(formatArrival("2026-12-21", "2026-10-29", "en-US")).toBe("Dec 21");
    expect(formatArrival("2027-03-15", "2026-10-29", "en-US")).toBe("Mar 2027");
    expect(formatArrival(null, "2026-10-29", "en-US")).toBeNull();
  });
});

describe("flight arc geometry", () => {
  it("starts at the start and ends at the end, clamped", () => {
    const a = arcGeometry(120, 34, 0);
    expect(a.point).toEqual({ x: a.start.x, y: a.start.y });
    const b = arcGeometry(120, 34, 1.7);
    expect(b.fraction).toBe(1);
    expect(b.point.x).toBeCloseTo(b.end.x, 1);
    expect(b.point.y).toBeCloseTo(b.end.y, 1);
  });
  it("moves right monotonically and the progress path is a prefix of the route", () => {
    const xs = [0, 0.25, 0.5, 0.75, 1].map((f) => arcGeometry(120, 34, f).point.x);
    expect([...xs].sort((p, q) => p - q)).toEqual(xs);
    expect(arcGeometry(120, 34, 0.4).progressPath.startsWith("M 6 28")).toBe(true);
  });
  it("credits fraction", () => {
    expect(creditsFraction(9, 21)).toBeCloseTo(0.4286, 3);
    expect(creditsFraction(5, null)).toBe(0);
    expect(creditsFraction(50, 21)).toBe(1);
    expect(creditsFraction(Number.NaN, 21)).toBe(0);
  });
});

describe("student table filters", () => {
  const rows = [
    { program: "high_school", status: { tone: "ok", label: "x" }, nextDeadline: null },
    { program: "degree", status: { tone: "warning", label: "x" }, nextDeadline: null },
    { program: "high_school", status: { tone: "ok", label: "x" }, nextDeadline: { label: "a", dueOn: "2026-11-01", daysLeft: 2 } },
  ] as const;
  it("filters by program and attention", () => {
    expect(filterStudentRows(rows, "diploma")).toHaveLength(2);
    expect(filterStudentRows(rows, "bachelor")).toHaveLength(1);
    expect(filterStudentRows(rows, "attention")).toHaveLength(2);
    expect(filterStudentRows(rows, "all")).toHaveLength(3);
  });
});

describe("file tabs", () => {
  it("offers Roadmap for diploma, Degree plan for degree, from ?tab=", () => {
    expect(fileTabsFor("diploma")).toContain("roadmap");
    expect(fileTabsFor("degree")).toContain("plan");
    expect(fileTabsFor("degree")).not.toContain("roadmap");
    expect(fileTabFromSearch("?tab=billing", "diploma")).toBe("billing");
    expect(fileTabFromSearch("?tab=roadmap", "degree")).toBe("overview");
    expect(fileTabFromSearch("?tab=timeline", "none")).toBe("notes");
    expect(fileTabFromSearch("", "none")).toBe("overview");
  });
});

describe("installment plan edit math", () => {
  it("splits remaining evenly over unlocked rows, remainder cents on the last", () => {
    const rows = [row("2026-09-01", "900.00", true), row("2026-10-01", "0"), row("2026-11-01", "0"), row("2026-12-01", "0")];
    const out = splitRemainingEvenly(rows, 360000, "USD");
    expect(out.map((r) => r.amount)).toEqual(["900.00", "900.00", "900.00", "900.00"]);
    const odd = splitRemainingEvenly([row("2026-10-01", "0"), row("2026-11-01", "0"), row("2026-12-01", "0")], 10000, "USD");
    expect(odd.map((r) => r.amount)).toEqual(["33.33", "33.33", "33.34"]);
    expect(validatePlan(odd, 10000, "USD").ok).toBe(true);
  });
  it("never touches locked rows and does nothing when there is nothing to split", () => {
    const locked = [row("2026-09-01", "900", true)];
    expect(splitRemainingEvenly(locked, 90000, "USD")).toEqual(locked);
    const over = [row("2026-09-01", "1000", true), row("2026-10-01", "5")];
    expect(splitRemainingEvenly(over, 90000, "USD")).toEqual(over);
  });
  it("validates sum against the net obligation and each row", () => {
    const rows = [row("2026-09-01", "900"), row("2026-10-01", "800")];
    const v = validatePlan(rows, 180000, "USD");
    expect(v.ok).toBe(false);
    expect(v.diffCents).toBe(-10000);
    expect(v.problems).toContainEqual({ code: "sum_mismatch", diffCents: -10000 });
    expect(validatePlan([], 100, "USD").problems).toEqual([{ code: "no_rows" }]);
    const bad = validatePlan([row("2026-13-45", "x")], 100, "USD");
    expect(bad.problems.map((p) => p.code)).toEqual(expect.arrayContaining(["bad_date", "bad_amount"]));
    expect(validatePlan([row("2026-09-01", "900"), row("2026-10-01", "900")], 180000, "USD").ok).toBe(true);
  });
  it("builds a chronological integer-cents payload", () => {
    const rows = [row("2026-12-01", "900"), { ...row("2026-09-01", "900.50"), label: " First " }];
    expect(planPayload(rows, "USD")).toEqual([{ dueDate: "2026-09-01", amountCents: 90050, label: "First" }, { dueDate: "2026-12-01", amountCents: 90000 }]);
  });
  it("describes instalment status", () => {
    expect(installmentStatusMeta("paid", "2026-09-01", "2026-10-29").tone).toBe("ok");
    expect(installmentStatusMeta("overdue", "2026-10-20", "2026-10-29")).toMatchObject({ tone: "urgent", vars: { n: 9 } });
    expect(installmentStatusMeta("upcoming", "2026-11-01", "2026-10-29")).toMatchObject({ key: "owner.bill.st.inDays", vars: { n: 3 } });
    expect(installmentStatusMeta("upcoming", "2027-01-01", "2026-10-29").key).toBe("owner.bill.st.due");
  });
});

describe("sessions and timeline", () => {
  it("offsets", () => {
    expect(toOffsetIso("2026-11-03T17:00", 60)).toBe("2026-11-03T17:00:00+01:00");
    expect(toOffsetIso("2026-11-03T17:00", -330)).toBe("2026-11-03T17:00:00-05:30");
    expect(toOffsetIso("nope", 0)).toBeNull();
    expect(offsetIsoToLocal("2026-11-03T17:00:00+01:00")).toBe("2026-11-03T17:00");
  });
  it("actions per status", () => {
    expect(sessionActions("requested")).toEqual(["confirm", "reschedule", "cancel"]);
    expect(sessionActions("cancelled")).toEqual([]);
  });
  it("merges notes and events newest first and keeps note kind", () => {
    const out = mergeTimeline([{ id: "n1", body: "b", authorName: "A", createdAt: "2026-10-28T10:00:00Z" }], [{ id: "e1", at: "2026-10-29T10:00:00Z", text: "t" }, { id: "e2", at: null, text: "skip" }]);
    expect(out.map((e) => e.id)).toEqual(["ev-e1", "note-n1"]);
    expect(out[1]!.kind).toBe("note");
  });
});

describe("agreement form", () => {
  const view: ProgramAgreementView = {
    signedOn: "2026-08-31", activatedOn: "2026-09-07", supportMonths: 9, supportEndsOn: null, supportMonthsLeft: 7, accessMonths: 36, accessEndsOn: null,
    deadlines: [
      { key: "language_test", label: "Test", rule: "30 days after signing", dueOn: "2026-09-30", status: "done", doneOn: "2026-09-24", detail: "Score 112 (target 105–115)", daysLeft: null },
      { key: "prior_schooling_proof", label: "Proof", rule: "90 days after activation", dueOn: "2026-12-06", status: "open", doneOn: null, detail: null, daysLeft: 38 },
    ],
    orientationSessionsIncluded: 2, orientationSessionsUsed: 0, goal: null,
  };
  it("sends nothing when untouched and only changed parts otherwise", () => {
    const initial = agreementToForm(view);
    expect(initial.ltScore).toBe("112");
    expect(initial.languageTestDays).toBe("30");
    expect(initial.priorSchoolingDays).toBe("90");
    expect(formToUpdate(initial, initial)).toMatchObject({ changed: false, errors: [] });
    const r = formToUpdate(initial, { ...initial, supportMonths: "12", psStatus: "done", psDoneOn: "2026-10-01" });
    expect(r.errors).toEqual([]);
    expect(r.input).toEqual({ supportMonths: 12, priorSchoolingProof: { status: "done", doneOn: "2026-10-01" } });
  });
  it("reports schema problems and validates a goal", () => {
    const initial = agreementToForm(view);
    expect(formToUpdate(initial, { ...initial, supportMonths: "0" }).errors.length).toBeGreaterThan(0);
    const bad = formToUpdate(initial, { ...initial, hasGoal: true, goal: { ...initial.goal, field: "" } });
    expect(bad.errors.length).toBeGreaterThan(0);
    const ok = formToUpdate(initial, { ...initial, hasGoal: true, goal: { field: "Communication", region: "Québec", interests: "media, writing", targets: [], alsoReviewed: "", studyOn: "" } });
    expect(ok.errors).toEqual([]);
    expect(ok.input.goal).toMatchObject({ field: "Communication", interests: ["media", "writing"], studyOn: null });
  });
});

describe("file decisions", () => {
  it("collects decisions from counts, evidence, sessions and deadlines", () => {
    const d = buildDecisions({
      documentsPending: 2,
      billing: { evidence: [{ status: "awaiting_review" }, { status: "confirmed" }] } as never,
      sessions: [{ status: "requested" }] as never,
      deadlines: [
        { key: "language_test", label: "Test", rule: "", dueOn: "x", status: "open", doneOn: null, detail: null, daysLeft: -2 },
        { key: "prior_schooling_proof", label: "Proof", rule: "", dueOn: "x", status: "open", doneOn: null, detail: null, daysLeft: 40 },
      ],
    });
    expect(d.map((x) => x.kind)).toEqual(["documents", "evidence", "session", "deadline"]);
    expect(d[3]).toMatchObject({ tone: "urgent", key: "owner.dec.deadlineLate" });
  });
  it("averages scores and sums credits by source", () => {
    expect(courseAverage({ tasks: [{ officialScorePercent: 80, reportedScorePercent: 70 }, { officialScorePercent: null, reportedScorePercent: 90 }, { officialScorePercent: null, reportedScorePercent: null }] } as never)).toBe(85);
    const out = creditsBySource([
      { creditRecord: { rawCredits: "3" }, source: { title: "College" }, latestDecision: { action: "accepted", creditsAwarded: "3.00" } },
      { creditRecord: { rawCredits: "3" }, source: { title: "College" } },
      { creditRecord: { normalizedCredits: "7" }, source: { title: "Other" }, latestDecision: { action: "rejected" } },
    ]);
    expect(out[0]).toEqual({ source: "Other", accepted: 0, waiting: 7 });
    expect(out[1]).toEqual({ source: "College", accepted: 3, waiting: 3 });
  });
});
