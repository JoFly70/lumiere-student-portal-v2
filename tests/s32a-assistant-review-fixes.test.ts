/**
 * S32-A independent-review fixes (synthetic): (1) earlier record answers in conversation history never reach the
 * provider; (2) in live mode only questions about the student themself are preempted by record answers.
 */
import { describe, expect, it } from "vitest";
import { answerMessage, buildProviderMessages, providerSafeHistory } from "../server/services/academic-assistant/service";
import { MemoryBudgetStore } from "../server/services/academic-assistant/budget";
import { ASSISTANT_API_BASE, ASSISTANT_MODEL } from "../server/services/academic-assistant/config";
import { isPersonalQuestion, type StudentRecord } from "../server/services/academic-assistant/student-record";

const RECORDS: StudentRecord[] = [
  { ref: "S1", label: "Credits", path: "/high-school", text: "Program requires 21 credits. Officially earned: 7. SECRET-COURSE-TITLE." },
  { ref: "S2", label: "Billing", path: "/billing", text: "Remaining 6,750.00 USD." },
  { ref: "S3", label: "Support", path: "/support", text: 'Support requests: "SYNTHETIC ticket subject" is open.' },
  { ref: "S4", label: "Next tasks", path: "/high-school", text: "Your next open tasks: Unit 2 exam." },
  { ref: "S5", label: "Timeline", path: "/high-school", text: "Pace: on track." },
];
const cfg = () => ({ liveEnabled: true, hasApiKey: true, monthlyBudgetUsd: 2, maxInputTokens: 2500, maxOutputTokens: 700, timeoutMs: 1000, rateLimitPerMinute: 6, liveRoles: new Set<string>(), studentPolicy: "minor_safe_v1" as const, apiBase: ASSISTANT_API_BASE, model: ASSISTANT_MODEL });
function fakeProvider() {
  const bodies: string[] = [];
  const fetchImpl = (async (_u: string, init: any) => { bodies.push(String(init?.body ?? "")); return new Response(JSON.stringify({ choices: [{ message: { content: "general answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 }); }) as any;
  return { bodies, fetchImpl };
}
const ask = (message: string, language: "en" | "fr", history: unknown, p: ReturnType<typeof fakeProvider>) =>
  answerMessage({ id: "u1", role: "student" }, { message, language, history, records: RECORDS }, { budget: new MemoryBudgetStore(), fetchImpl: p.fetchImpl, config: cfg as any });

describe("review fix 1: record answers in history never reach the provider", () => {
  const recordTurn = "From your record (system facts, not AI):\n• Program requires 21 credits. Officially earned: 7. SECRET-COURSE-TITLE. [S1]";
  const frTurn = "D’après votre dossier (faits du système, pas une IA) :\n• Montant restant : 6 750,00 USD. [S2]";
  it("drops record answers and the question that produced them", () => {
    const h = providerSafeHistory([
      { role: "user", content: "How many credits do I still need?" }, { role: "assistant", content: recordTurn },
      { role: "user", content: "Combien je dois ?" }, { role: "assistant", content: frTurn },
      { role: "user", content: "What is photosynthesis?" }, { role: "assistant", content: "Plants use light." },
    ]);
    expect(h).toEqual([{ role: "user", content: "What is photosynthesis?" }, { role: "assistant", content: "Plants use light." }]);
  });
  it("a general question after a record answer sends no record text to the provider (end to end)", async () => {
    const p = fakeProvider();
    const history = [{ role: "user", content: "How many credits do I still need?" }, { role: "assistant", content: recordTurn }];
    process.env.META_MODEL_API_KEY = "synthetic-not-a-key";
    const r = await ask("Can you explain photosynthesis?", "en", history, p);
    delete process.env.META_MODEL_API_KEY;
    expect(r.mode).toBe("live");
    expect(p.bodies).toHaveLength(1);
    expect(p.bodies[0]).not.toMatch(/SECRET-COURSE-TITLE|Officially earned|21 credits|How many credits do I still need/);
  });
  it("buildProviderMessages applies the same filter for any caller", () => {
    const msgs = buildProviderMessages("hello", "en", [{ role: "user", content: "q" }, { role: "assistant", content: recordTurn }], [], 2500, true, RECORDS);
    expect(JSON.stringify(msgs)).not.toMatch(/SECRET-COURSE-TITLE|6,750|SYNTHETIC ticket subject/);
  });
  it("a date inside an earlier record answer no longer makes every later question refuse", async () => {
    const p = fakeProvider();
    const history = [{ role: "user", content: "When is my next task?" }, { role: "assistant", content: "From your record (system facts, not AI):\n• Next task planned by 2026-11-02. [S1]" }];
    const r = await ask("Where are my credits?", "en", history, p);
    expect(r.grounded).toBe("record");
    expect(r.notice ?? "").not.toMatch(/privacy/i);
  });
});

describe("review fix 2: live mode preempts only personal questions", () => {
  it.each([
    "How do transfer credits work in the US?", "What is a credit hour?", "Explain what a syllabus document is", "How do I contact support at a university?".replace("How do I", "How does one"),
  ])("general question goes live: %s", async (q) => {
    const p = fakeProvider();
    process.env.META_MODEL_API_KEY = "synthetic-not-a-key";
    const r = await ask(q, "en", [], p);
    delete process.env.META_MODEL_API_KEY;
    expect(r.mode).toBe("live");
    expect(p.bodies[0]).not.toMatch(/SECRET-COURSE-TITLE|6,750|SYNTHETIC ticket subject/);
  });
  it.each([
    ["How many credits do I still need?", "en"], ["What's most urgent?", "en"], ["Am I on track?", "en"], ["What is my balance?", "en"],
    ["Combien de crédits me faut-il encore ?", "fr"], ["Qu’est-ce qui est le plus urgent ?", "fr"], ["Suis-je dans les temps ?", "fr"], ["Où en sont mes crédits ?", "fr"], ["Combien je dois payer ?", "fr"],
  ] as const)("personal question stays deterministic with zero provider calls: %s", async (q, lang) => {
    const p = fakeProvider();
    process.env.META_MODEL_API_KEY = "synthetic-not-a-key";
    const r = await ask(q, lang, [], p);
    delete process.env.META_MODEL_API_KEY;
    expect(r.grounded).toBe("record");
    expect(p.bodies).toHaveLength(0);
  });
  it("classifies personal signals", () => {
    expect(isPersonalQuestion("What is a credit hour?")).toBe(false);
    expect(isPersonalQuestion("When is my next exam?")).toBe(true);
    expect(isPersonalQuestion("Quels documents dois-je fournir ?")).toBe(true);
  });
});
