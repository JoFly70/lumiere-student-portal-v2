import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudentRoadmapItemView, StudentRoadmapPhaseView, StudentRoadmapView } from "../shared/student-roadmap-contract";
import type { StudentDegreeProgressView, StudentRequirementView } from "../shared/student-degree-progress-view";
import { degreeFigures } from "../client/src/lib/s27/degree-cockpit-model";
import { composeStudentRecords, answerFromRecord } from "../server/services/academic-assistant/student-record";
import { degreeFiguresLite } from "../server/services/academic-assistant/degree-record";
import { MemoryBudgetStore } from "../server/services/academic-assistant/budget";
import { answerMessage, audienceOf, getStatus } from "../server/services/academic-assistant/service";
import { searchKnowledge } from "../server/services/academic-assistant/retrieval";
import { KNOWLEDGE, SUGGESTIONS } from "../server/data/academic-assistant/knowledge";
import { HS_MID_WAY } from "./helpers/s11-hs-ui-fixtures";
import { CHECKPOINT_KEYS, CHECKPOINT_LABELS, type StudentJourneyView } from "../shared/s27-contract";
import { translate } from "../client/src/i18n";

const TODAY = "2026-10-29";
const task = (key: string, status: "not_started" | "in_progress" | "graded", dueDate: string | null = null) => ({ key, kind: "challenge" as const, title: `Task ${key}`, dueDate, status, revision: 0, updatedAt: null });
function item(over: Partial<StudentRoadmapItemView> & { key: string }): StudentRoadmapItemView {
  return {
    phaseKey: "gen", objectiveKey: "o1", sequence: 1, kind: "course", code: null, title: `Course ${over.key}`, provider: "Sophia Learning", institution: null,
    credits: "3", plannedStart: null, plannedEnd: null, planStatus: "planned", holdReason: null, approval: null, alternativeOf: null,
    studentNote: null, waitingOn: [], itemStatus: "not_started", itemRevision: 0, tasks: [],
    taskCounts: { total: 0, graded: 0, submitted: 0, inProgress: 0, notStarted: 0 },
    stage: "not_started", official: null, canReport: true, reportBlockedReason: null, ...over,
  } as StudentRoadmapItemView;
}
const phase = (key: string, sequence: number, items: StudentRoadmapItemView[]): StudentRoadmapPhaseView => ({ key, title: key, sequence, objectiveKey: null, startDate: null, endDate: null, description: null, items, counts: {} as never, state: "current" });
function roadmap(phases: StudentRoadmapPhaseView[], over: Partial<StudentRoadmapView> = {}): StudentRoadmapView {
  return {
    contractVersion: "student-roadmap/1", state: "PUBLISHED", preview: false, plan: { title: "Plan", summary: null, versionNumber: 1, publishedAt: null },
    objectives: [], phases, milestones: [], counts: {} as never, today: { focusItemKeys: [], headline: "", detail: "", nextMilestoneKey: null },
    foundation: { credentials: [], sources: [], degreeState: "COMPOSED", ladder: { reported: "0", provisional: "0", verified: "60", applied: "60", surplus: null, planned: "0", required: "120" } },
    history: { previousVersions: [], retiredProgress: [] }, ...over,
  } as StudentRoadmapView;
}
const req = (id: string, title: string, required: string, applied: string, status: StudentRequirementView["status"] = "PARTIAL"): StudentRequirementView => ({
  requirementId: id, code: id.toUpperCase(), title, sequence: 1, status, unit: "credit", requiredAmount: required, appliedAmount: applied,
  remainingAmount: String(Number(required) - Number(applied)), appliedCreditRecordIds: [],
} as StudentRequirementView);
const progress = (requirements: StudentRequirementView[] = [], state: "COMPOSED" | "UNDER_REVIEW" = "COMPOSED"): StudentDegreeProgressView => ({
  contractVersion: "student-degree-progress/1", state, asOf: null, program: null,
  totals: state === "COMPOSED" ? { unit: "credit", requiredCredits: "120", appliedCredits: "60", remainingCredits: "60", verifiedCreditsOnRecord: "60", requirementsSatisfied: 1, requirementsTotal: requirements.length } : null,
  requirements: state === "COMPOSED" ? requirements : [], attention: [], milestones: [], nextSteps: [], sources: [], credits: [],
} as unknown as StudentDegreeProgressView);

const GEN = [
  item({ key: "eng101", title: "English Composition I", stage: "in_progress", tasks: [task("c2", "in_progress", "2026-11-02"), task("c3", "not_started", "2026-11-09")], plannedEnd: "2026-11-23" }),
  item({ key: "his110", title: "U.S. History I", plannedEnd: "2026-12-07" }),
  item({ key: "rep", title: "Reported done", stage: "provider_complete" }),
];
const BUS = [item({ key: "eco201", title: "Microeconomics", phaseKey: "bus", plannedEnd: "2027-01-04" }), item({ key: "acc210", title: "Financial Accounting", phaseKey: "bus" })];
const rm = () => roadmap([phase("gen", 1, GEN), phase("bus", 2, BUS)]);
const reqs = () => [req("gen", "General education", "36", "36", "SATISFIED"), req("res", "Residency (institution-taught term course)", "15", "0", "MISSING"), req("bus", "Business major", "36", "12")];
const journey = {
  agreement: { signedOn: "2026-11-02", activatedOn: "2026-11-09", supportMonths: 9, supportEndsOn: "2027-08-09", supportMonthsLeft: 9, accessMonths: 36, accessEndsOn: "2029-11-09",
    deadlines: [{ key: "language_test", label: "Language test", rule: "30 days after signing", dueOn: "2026-12-02", status: "open", doneOn: null, detail: null, daysLeft: 21 }],
    orientationSessionsIncluded: 2, orientationSessionsUsed: 1, goal: null },
  checkpoints: CHECKPOINT_KEYS.map((key, i) => ({ key, label: CHECKPOINT_LABELS[key], status: i === 0 ? "done" : i === 1 ? "next" : "upcoming", plannedOn: null, doneOn: null })),
  sessions: [], pace: null,
} as unknown as StudentJourneyView;
const degreeRecords = (lang: "en" | "fr" = "en", over: Partial<Parameters<typeof composeStudentRecords>[0]> = {}) =>
  composeStudentRecords({ highSchool: null, documents: [], tickets: [], billing: null, journey, degreeRoadmap: rm(), degreeProgress: progress(reqs()), today: TODAY, ...over }, lang);

describe("S32-A F03 - Degree credits record", () => {
  it("figures equal the Flight Deck's degreeFigures (Earned / Planned / Still open), never mixed", () => {
    const f = degreeFigures(rm(), progress(reqs()));
    const lite = degreeFiguresLite(rm(), progress(reqs()));
    expect([lite.required, lite.earned, lite.planned, lite.open]).toEqual([f.required * 100, f.confirmed * 100, f.planned * 100, f.source.openCents]);
    expect(f).toMatchObject({ required: 120, confirmed: 60, planned: 15 });
  });
  it("EN text uses the deck vocabulary and says planned/reported work is not earned", () => {
    const r = degreeRecords("en").find((x) => x.label === "Degree credits")!;
    expect(r.text).toContain("Your degree requires 120 credits.");
    expect(r.text).toContain("Earned (accepted by the university): 60.");
    expect(r.text).toContain("Planned (on your roadmap, not yet accepted): 15.");
    expect(r.text).toContain("Still open (not yet earned or planned): 45.");
    expect(r.text).toMatch(/not earned/);
    expect(r.path).toBe("/roadmap");
  });
  it("FR text uses Acquis / Prévus / Encore ouverts", () => {
    const r = degreeRecords("fr").find((x) => x.label === "Degree credits")!;
    expect(r.title).toBe("Crédits du diplôme");
    expect(r.text).toContain("Acquis (acceptés par l’université) : 60.");
    expect(r.text).toContain("Prévus (à votre feuille de route, pas encore acceptés) : 15.");
    expect(r.text).toContain("Encore ouverts (ni acquis ni prévus) : 45.");
  });
  it("Degree requirements record lists residency first with canonical figures only", () => {
    const r = degreeRecords("en").find((x) => x.label === "Degree requirements")!;
    expect(r.text).toMatch(/Requirements still to meet \(2 of 3\): Residency \(institution-taught term course\): 0 of 15 credits earned, 15 still open; Business major: 12 of 36/);
    expect(r.text).toMatch(/university decides/);
    const frText = degreeRecords("fr").find((x) => x.label === "Degree requirements")!.text;
    expect(frText).toMatch(/Exigences encore à remplir \(2 sur 3\)/);
  });
  it("under review: no earned figure is invented", () => {
    const records = degreeRecords("en", { degreeProgress: progress([], "UNDER_REVIEW"), degreeRoadmap: roadmap([phase("gen", 1, GEN)], { foundation: { credentials: [], sources: [], degreeState: "UNDER_REVIEW", ladder: { reported: "0", provisional: "0", verified: "0", applied: null, surplus: null, planned: "0", required: "120" } } as never }) });
    const r = records.find((x) => x.label === "Degree credits")!;
    expect(r.text).toMatch(/cannot be shown yet/);
    expect(r.text).not.toMatch(/Earned \(accepted/);
    expect(records.find((x) => x.label === "Degree requirements")).toBeUndefined();
  });
  it("no program and no roadmap: no degree records at all; high-school students never get them", () => {
    expect(degreeRecords("en", { degreeRoadmap: roadmap([], { state: "NOT_PUBLISHED" } as never), degreeProgress: { ...progress(), state: "NO_ACTIVE_PROGRAM", totals: null } as never }).some((r) => r.label.startsWith("Degree"))).toBe(false);
    expect(composeStudentRecords({ highSchool: HS_MID_WAY, documents: [], tickets: [], billing: null, degreeRoadmap: rm(), degreeProgress: progress(reqs()), today: TODAY }).some((r) => r.label.startsWith("Degree"))).toBe(false);
  });
  it("earlier S1.. refs are unchanged by adding degree records", () => {
    const base = composeStudentRecords({ highSchool: null, documents: [], tickets: [], billing: null, journey, today: TODAY });
    const withDeg = degreeRecords("en");
    expect(withDeg.slice(0, base.length)).toEqual(base);
  });
  it("Next tasks come from the degree roadmap (dated first, never held or accepted courses)", () => {
    const r = degreeRecords("en").find((x) => x.label === "Next tasks")!;
    expect(r.text).toMatch(/^Your next open tasks: Task c2 — English Composition I, planned by 2026-11-02; Task c3/);
  });
});

describe("S32-A degree chips and intents answer from the degree record, with no provider call", () => {
  const chips = ["s27.ai.q.credits", "s27.ai.q.urgent", "s27.ai.q.track", "s27.sup.q.credits", "s27.sup.q.documents", "s27.sup.q.urgent"];
  for (const lang of ["en", "fr"] as const) for (const k of chips) {
    it(`${lang} ${k}`, async () => {
      const q = translate(lang, k as any);
      const f = vi.fn();
      const out = await answerMessage({ id: "u", role: "student" }, { message: q, language: lang, records: degreeRecords(lang, { documents: [{ doc_type: "other", status: "pending" }] }) }, { budget: new MemoryBudgetStore(), fetchImpl: f as any });
      expect(out.grounded, q).toBe("record");
      expect(out.reply, q).toMatch(lang === "fr" ? /D’après votre dossier/ : /From your record/);
      expect(f).not.toHaveBeenCalled();
      if (k.endsWith("credits")) expect(out.reply).toMatch(lang === "fr" ? /Acquis \(acceptés/ : /Earned \(accepted/);
      if (k.endsWith("track")) expect(out.reply).toMatch(lang === "fr" ? /Encore ouverts|Prévus/ : /Still open|Planned/);
    });
  }
  it("graduation / residency / timeline questions map to the degree records", () => {
    const labels = (q: string) => (answerFromRecord(q, "en", degreeRecords("en"))?.cited ?? []).map((r) => r.label);
    expect(labels("What do I need to graduate?")).toEqual(expect.arrayContaining(["Degree requirements", "Degree credits"]));
    expect(labels("What is my residency requirement?")).toContain("Degree requirements");
    expect(labels("When will I finish?")).toContain("Degree credits");
  });
});

describe("S32-A F25 - knowledge base is filtered by program", () => {
  it("every entry has a known audience, and the HS-only 15-credit transfer cap never reaches a degree student", () => {
    for (const e of KNOWLEDGE) expect([undefined, "hs", "degree", "all"]).toContain(e.audience);
    const q = "What is the residency requirement and how many credits must I take with the school?";
    const asHs = searchKnowledge(q, 3, new Date(), "hs").map((h) => h.entry.id);
    const asDegree = searchKnowledge(q, 3, new Date(), "degree").map((h) => h.entry.id);
    const unfiltered = searchKnowledge(q, 3).map((h) => h.entry.id);
    expect(unfiltered).toContain("awarding-school-transfer-minimum");
    expect(asHs).toContain("awarding-school-transfer-minimum");
    expect(asDegree).not.toContain("awarding-school-transfer-minimum");
    expect(asDegree).toContain("degree-residency");
    expect(asHs).not.toContain("degree-residency");
  });
  it("audience is derived from the record kinds", () => {
    expect(audienceOf(degreeRecords("en"))).toBe("degree");
    expect(audienceOf(composeStudentRecords({ highSchool: HS_MID_WAY, documents: [], tickets: [], billing: null, today: TODAY }))).toBe("hs");
    expect(audienceOf([])).toBe("all");
  });
  it("a degree student's local answer for residency uses the degree entry and invents no number", async () => {
    const out = await answerMessage({ id: "u", role: "student" }, { message: "How does residency work?", language: "en", records: degreeRecords("en", { degreeProgress: progress([]) }) }, { budget: new MemoryBudgetStore() });
    expect(out.reply).not.toMatch(/\b15 transfer credits|\b6 credits\b/);
  });
  it("degree entries are anonymised and add no numeric requirement", () => {
    const degree = KNOWLEDGE.filter((e) => e.audience === "degree" && e.id.startsWith("degree-"));
    expect(degree.length).toBeGreaterThanOrEqual(4);
    for (const e of degree) {
      const txt = `${e.text.en} ${e.text.fr}`;
      expect(txt).not.toMatch(/TESU|Thomas Edison|Sophia|Study\.com/i);
      expect(txt.replace(/300|400|NCCRS/g, "")).not.toMatch(/\b\d{1,3}\b\s*(semester |transfer )?credits/i);
    }
  });
  it("owner AI keeps working (default audience 'all' sees every entry)", () => {
    expect(searchKnowledge("what do the statuses mean", 2).length).toBeGreaterThan(0);
    expect(searchKnowledge("residency requirement degree", 3).map((h) => h.entry.id)).toContain("degree-residency");
  });
  it("suggestions still resolve to entries", () => {
    for (const s of SUGGESTIONS) expect(KNOWLEDGE.some((e) => e.id === s.entryId)).toBe(true);
  });
});

describe("S32-A F07 - knowledge-base credit vocabulary matches the screens", () => {
  const e = KNOWLEDGE.find((x) => x.id === "statuses")!;
  it("EN teaches Earned / Planned / Still open and that reported work is not earned", () => {
    expect(e.text.en).toMatch(/Earned:.*Planned:.*Still open:/);
    expect(e.text.en).toMatch(/not earned until it is confirmed/);
  });
  it("FR teaches Acquis / Prévus / Encore ouverts", () => {
    expect(e.text.fr).toMatch(/Acquis :.*Prévus :.*Encore ouverts :/);
    expect(e.text.fr).toMatch(/n’est pas acquis/);
  });
  it("status endpoint still lists suggestions", async () => {
    const s = await getStatus({ id: "u", role: "student" }, { budget: new MemoryBudgetStore() });
    expect(s.suggestions.length).toBeGreaterThan(0);
  });
});
beforeEach(() => { for (const k of ["SPARK_ASSISTANT_ENABLED", "META_MODEL_API_KEY", "SPARK_ASSISTANT_STUDENT_POLICY"]) delete process.env[k]; });
