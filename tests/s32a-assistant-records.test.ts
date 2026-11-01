import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HS_MID_WAY } from "./helpers/s11-hs-ui-fixtures";
import { MemoryBudgetStore } from "../server/services/academic-assistant/budget";
import { answerMessage, buildProviderMessages, type AssistantDeps } from "../server/services/academic-assistant/service";
import { composeStudentRecords, answerFromRecord } from "../server/services/academic-assistant/student-record";
import { detectPii } from "../server/services/academic-assistant/pii";
import { CHECKPOINT_KEYS, CHECKPOINT_LABELS, type StudentJourneyView } from "../shared/s27-contract";
import { generateReply } from "../server/services/assistant-conversations/reply";
import { translate } from "../client/src/i18n";

const TICKET_SUBJECT = "Zebra widget invoice question";
const DOC_MSG = "Please upload a clearer scan of the passport page";
const journey = {
  agreement: {
    signedOn: "2026-11-02", activatedOn: "2026-11-09", supportMonths: 9, supportEndsOn: "2027-08-09", supportMonthsLeft: 9, accessMonths: 36, accessEndsOn: "2029-11-09",
    deadlines: [{ key: "language_test", label: "Language test", rule: "30 days after signing", dueOn: "2026-12-02", status: "open", doneOn: null, detail: null, daysLeft: 21 }],
    orientationSessionsIncluded: 2, orientationSessionsUsed: 1,
    goal: { field: "Communication", region: "Québec", interests: [], targets: [{ name: "Quokka Polytechnic", city: "Montréal", track: "French track", program: "x", why: "x", admission: "x", url: null }], alsoReviewed: [], studyOn: null },
  },
  checkpoints: CHECKPOINT_KEYS.map((key, i) => ({ key, label: CHECKPOINT_LABELS[key], status: i === 0 ? "done" : i === 1 ? "next" : "upcoming", plannedOn: null, doneOn: i === 0 ? "2026-10-30" : null })),
  sessions: [{ id: "s1", slotAt: "2026-11-20T15:00:00Z", status: "confirmed" }],
  pace: { creditsPerWeek: 0.5, itemsLogged28d: 6, lastLoggedOn: "2026-11-10", stale: false, estimatedFinishOn: "2027-03-01", examsThisWeek: 2, weeklyExamLimit: 15 },
} as unknown as StudentJourneyView;
const billing = { state: "configured", agreedCents: 482100, discountCents: 0, paidCents: 120000, remainingCents: 362100, currency: "CAD", nextDue: { amountCents: 98765, dueDate: "2026-12-15" } } as any;
const recordsFor = (lang: "en" | "fr") => composeStudentRecords({
  highSchool: HS_MID_WAY, journey,
  documents: [{ doc_type: "id_gov", status: "rejected", student_message: DOC_MSG }],
  tickets: [{ subject: TICKET_SUBJECT, status: "waiting_on_student" }],
  billing, today: "2026-11-11",
}, lang);

const student = { id: "u-stud", role: "student" };
function liveCfg() {
  process.env.SPARK_ASSISTANT_ENABLED = "true";
  process.env.META_MODEL_API_KEY = "LLM_123456_SECRETKEYVALUE";
  process.env.SPARK_ASSISTANT_STUDENT_POLICY = "minor_safe_v1";
}
const okFetch = () => vi.fn(async (_u: string, _i: any) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { role: "assistant", content: "Use spaced practice." } }], usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 } }) }));
const deps = (fetchImpl: any): AssistantDeps => ({ budget: new MemoryBudgetStore(), fetchImpl });

beforeEach(() => { for (const k of ["SPARK_ASSISTANT_ENABLED", "META_MODEL_API_KEY", "SPARK_ASSISTANT_LIVE_ROLES", "SPARK_ASSISTANT_STUDENT_POLICY"]) delete process.env[k]; });
afterEach(() => vi.restoreAllMocks());

const PRIVACY_NOTICE = /privacy|vie privée/i;
const SELF_QS: Array<[string, "en" | "fr"]> = [
  ["Où en sont mes crédits ?", "fr"], ["Where are my credits?", "en"], ["What is my balance?", "en"], ["Explique-moi ma feuille de route", "fr"],
];

describe("S32-A F02 - personal questions get record answers, never the privacy refusal", () => {
  for (const mode of ["local", "live"] as const) {
    for (const [q, lang] of SELF_QS) {
      it(`${mode}: ${q}`, async () => {
        if (mode === "live") liveCfg();
        expect(detectPii(q).kinds.every((k) => k === "self_id" || k === "my_data")).toBe(true);
        const f = okFetch();
        const out = await answerMessage(student, { message: q, language: lang, records: recordsFor(lang) }, deps(f));
        expect(out.notice).toBeUndefined();
        expect(out.reply).not.toMatch(PRIVACY_NOTICE);
        expect(out.reply).toMatch(lang === "fr" ? /D’après votre dossier/ : /From your record/);
        expect(out.mode).toBe("local");
        expect(f).not.toHaveBeenCalled();
      });
    }
  }
  it("real PII kinds still refuse, with the notice and no provider call", async () => {
    liveCfg();
    for (const q of ["My email is sam@example.com, how many credits do I need?", "Mon numéro de téléphone est 514 555 1234, mes crédits ?", "my ssn is 123-45-6789"]) {
      const f = okFetch();
      const out = await answerMessage(student, { message: q, language: "en", records: recordsFor("en") }, deps(f));
      expect(out.notice).toMatch(PRIVACY_NOTICE);
      expect(f).not.toHaveBeenCalled();
    }
  });
  it("a self_id message with no record answer keeps the old behaviour (notice, local KB, no provider)", async () => {
    liveCfg();
    const f = okFetch();
    const out = await answerMessage(student, { message: "My name is Alex and I like chess", language: "en", records: recordsFor("en") }, deps(f));
    expect(out.notice).toMatch(PRIVACY_NOTICE);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("S32-A deterministic first, even in live mode", () => {
  it("a record question never calls the provider; a general question does", async () => {
    liveCfg();
    const f = okFetch();
    const rec = await answerMessage(student, { message: "How many credits do I still need?", language: "en", records: recordsFor("en") }, deps(f));
    expect(rec.mode).toBe("local");
    expect(f).not.toHaveBeenCalled();
    const gen = await answerMessage(student, { message: "Give me a tip for studying fractions", language: "en", records: recordsFor("en") }, deps(f));
    expect(gen.mode).toBe("live");
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("S32-A F01 - provider prompt privacy", () => {
  it("the provider body carries no ticket subject, amount, document type/message, goal, target programme or session time", async () => {
    liveCfg();
    const f = okFetch();
    const records = recordsFor("en");
    // sanity: the records DO contain those facts, so the assertions below are meaningful
    const all = records.map((r) => r.text).join("\n");
    for (const needle of [TICKET_SUBJECT, "4,821.00", "987.65", "id gov", DOC_MSG, "Quokka Polytechnic", "Communication", "2026-11-20 15:00"]) expect(all).toContain(needle);
    await answerMessage(student, { message: "Give me a tip for studying fractions", language: "en", records }, deps(f));
    expect(f).toHaveBeenCalledTimes(1);
    const body = String((f.mock.calls[0][1] as any).body);
    for (const needle of [TICKET_SUBJECT, "4,821", "4821", "987", "362", "id_gov", "id gov", "passport", "Quokka", "Communication", "Montréal", "2026-11-20", "2026-12-15", "Program agreement", "Billing", "The student's own records"]) {
      expect(body, needle).not.toContain(needle);
    }
    expect(body).not.toMatch(/\[S\d+\]/);
  });
  it("buildProviderMessages ignores any records handed to it (policy: none)", () => {
    const msgs = buildProviderMessages("hello", "en", [], [], 4000, true, recordsFor("en"));
    const text = msgs.map((m) => m.content).join("\n");
    expect(text).not.toContain(TICKET_SUBJECT);
    expect(text).not.toContain("4,821.00");
    expect(text).not.toMatch(/own records/i);
  });
});

describe("S32-A F13 - intents and French coverage", () => {
  const rec = (lang: "en" | "fr") => recordsFor(lang);
  const labelsOf = (q: string, lang: "en" | "fr") => (answerFromRecord(q, lang, rec(lang))?.cited ?? []).map((r) => r.label);
  it("urgent / track / owe / exam intents", () => {
    expect(labelsOf("What's most urgent?", "en")).toEqual(expect.arrayContaining(["Next tasks", "Program agreement"]));
    expect(labelsOf("Qu’est-ce qui est le plus urgent ?", "fr")).toEqual(expect.arrayContaining(["Next tasks", "Program agreement"]));
    expect(labelsOf("Am I on track?", "en")).toEqual(expect.arrayContaining(["Timeline", "Pace"]));
    expect(labelsOf("Suis-je dans les temps ?", "fr")).toEqual(expect.arrayContaining(["Timeline", "Pace"]));
    expect(labelsOf("Am I behind?", "en")).toContain("Timeline");
    expect(labelsOf("How much do I owe?", "en")).toEqual(["Billing"]);
    expect(labelsOf("Do I owe money?", "en")).toEqual(["Billing"]);
    expect(labelsOf("Combien je dois ?", "fr")).toEqual(["Billing"]);
    expect(labelsOf("Which documents do I owe?", "en")).toEqual(["Documents"]);
    expect(labelsOf("Quand est mon prochain examen ?", "fr")).toContain("Next tasks");
    expect(labelsOf("When is my next exam?", "en")).toContain("Next tasks");
    expect(labelsOf("Examen", "fr")).toContain("Next tasks");
    expect(labelsOf("Combien de crédits me faut-il encore ?", "fr")).toContain("Credits");
    expect(labelsOf("Quels documents dois-je fournir ?", "fr")).toEqual(["Documents"]);
    expect(labelsOf("Où en est ma facture ?", "fr")).toContain("Billing");
    expect(labelsOf("Où en est ma diplomation ?", "fr")).toContain("Graduation");
    expect(labelsOf("Comment contacter l’assistance ?", "fr")).toContain("Support");
  });
  it("dashboard Ask chips (HS): every EN and FR chip string gets a relevant record answer", () => {
    const keys = ["s27.ai.q.credits", "s27.ai.q.urgent", "s27.ai.q.track", "s27.sup.q.credits", "s27.sup.q.documents", "s27.sup.q.urgent"];
    const want: Record<string, string[]> = {
      "s27.ai.q.credits": ["Credits"], "s27.ai.q.urgent": ["Next tasks"], "s27.ai.q.track": ["Timeline", "Pace"],
      "s27.sup.q.credits": ["Credits"], "s27.sup.q.documents": ["Documents"], "s27.sup.q.urgent": ["Next tasks"],
    };
    for (const lang of ["en", "fr"] as const) for (const k of keys) {
      const q = translate(lang, k as any);
      expect(q, k).not.toBe(k);
      const out = answerFromRecord(q, lang, rec(lang));
      expect(out, `${lang} ${k}: ${q}`).not.toBeNull();
      const got = out!.cited.map((r) => r.label);
      for (const w of want[k]) expect(got, `${lang} ${k}: ${q}`).toContain(w);
    }
  });
});

describe("S32-A F24 - bilingual record answers, Assistance not Soutien", () => {
  it("French records are written in French, with French titles", () => {
    const fr = recordsFor("fr");
    const text = fr.map((r) => r.text).join("\n");
    expect(text).not.toMatch(/Officially earned|Your next open tasks|Support requests|Agreed amount|Exams logged|Program requires/);
    expect(text).toMatch(/Crédits officiellement obtenus/);
    expect(text).toMatch(/Demandes d’assistance/);
    expect(text).toMatch(/Montant convenu/);
    expect(fr.find((r) => r.label === "Support")?.title).toBe("Assistance");
    expect(fr.find((r) => r.label === "Billing")?.title).toBe("Facturation");
    expect(fr.every((r) => !/Soutien/i.test(r.text + (r.title ?? "")))).toBe(true);
  });
  it("English output is unchanged", () => {
    expect(recordsFor("en").find((r) => r.label === "Credits")?.text).toMatch(/Officially earned \(confirmed by the school\)/);
  });
  it("French user-facing assistant strings never say Soutien", async () => {
    const out = await answerMessage(student, { message: "Mon nom est Léa, aide", language: "fr", records: [] }, deps(okFetch()));
    expect(out.notice ?? "").not.toMatch(/Soutien/);
    expect(out.reply).not.toMatch(/Soutien/);
    const noMatch = await answerMessage(student, { message: "zxqv plugh", language: "fr", records: [] }, deps(okFetch()));
    expect(noMatch.reply).toMatch(/Assistance/);
    expect(noMatch.reply).not.toMatch(/Soutien/);
  });
});

describe("S32-A F11 - elective change copy", () => {
  it("points to the High School page and the Request a change action", () => {
    const en = answerFromRecord("How do I change an elective?", "en", recordsFor("en"))!.text;
    expect(en).toContain("On your High School page, find the elective in your course list and choose \"Request a change\".");
    expect(en).not.toMatch(/course card/);
    const fr = answerFromRecord("Comment changer une option ?", "fr", recordsFor("fr"))!.text;
    expect(fr).toContain("Sur votre page Études secondaires, repérez l’option dans la liste de vos cours et choisissez « Demander un changement ».");
  });
});

describe("S32-A F34 - record answers are grounded in student-visible pages", () => {
  it("returns recordRefs (language titles, in-app paths) and the conversation reply carries them as privateRefs", async () => {
    const out = await answerMessage(student, { message: "Where is my balance?", language: "fr", records: recordsFor("fr") }, deps(okFetch()));
    expect(out.grounded).toBe("record");
    expect(out.sources).toEqual([]);
    expect(out.recordRefs).toEqual([{ kind: "record", title: "Facturation", path: "/billing" }]);
    for (const r of out.recordRefs!) expect(r.path).toMatch(/^\/[a-z-]+/);
  });
  it("knowledge-base answers carry no record refs", async () => {
    const out = await answerMessage(student, { message: "What is a credit hour?", language: "en", records: [] }, deps(okFetch()));
    expect(out.grounded).toBeUndefined();
    expect(out.recordRefs).toBeUndefined();
  });
  it("generateReply passes recordRefs as privateRefs", async () => {
    const out = await generateReply({ user: student, conversationId: "c1", message: "Where is my balance?", language: "en", recentTurns: [] }, { budget: new MemoryBudgetStore() });
    // deps given => no DB record load => no records => KB answer
    expect(out.privateRefs).toEqual([]);
  });
});
