/**
 * S34 (S33-01) privacy regression: the "From your records" appendix and record answers shown to the student must never
 * reach the external model through conversation history.
 *
 * Runs the PRODUCTION wiring end to end: createConversationService -> createIntegratedGenerateReply (private retrieval)
 * -> generateReply (default deps, own-record loading) -> answerMessage -> callMuseSpark -> fetch. Only the SQL store,
 * the record loader and the budget store are replaced by in-memory fakes; the captured artefact is the exact HTTP request
 * body that would leave the server.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mem = vi.hoisted(() => ({
  messages: [] as any[],
  records: [] as any[],
  providerBodies: [] as string[],
  providerStatus: 200,
  privateItems: [] as any[],
}));

vi.mock("../server/services/assistant-conversations/store", async (orig) => {
  const actual: any = await orig();
  let id = 0;
  const mk = (m: any) => ({ sources: [], links: [], privateRefs: [], notice: null, attachments: [], createdAt: new Date().toISOString(), mode: null, ...m });
  return {
    ...actual,
    appendStudentMessage: async (_db: any, owner: string, conversationId: string, input: any) => {
      const dup = mem.messages.find((m) => m.conversationId === conversationId && m.role === "student" && m.clientRequestId === input.clientRequestId);
      if (dup) return { studentMessage: dup, existing: true, assistantMessage: mem.messages.find((m) => m.replyToMessageId === dup.id) ?? null, checkpoint: null };
      const msg = mk({ id: `m${++id}`, seq: mem.messages.length + 1, role: "student", content: input.content, language: input.language, owner, conversationId, clientRequestId: input.clientRequestId,
        attachments: (input.attachmentDocumentIds ?? []).map((d: string) => ({ documentId: d, fileName: "PRIVATE-ATTACHMENT-passport.pdf", mimeType: "application/pdf", sizeBytes: 10 })) });
      mem.messages.push(msg);
      return { studentMessage: msg, existing: false, assistantMessage: null, checkpoint: null };
    },
    appendAssistantReply: async (_db: any, owner: string, conversationId: string, studentMessageId: string, reply: any) => {
      const existing = mem.messages.find((m) => m.replyToMessageId === studentMessageId);
      if (existing) return { assistantMessage: existing, created: false, checkpoint: null };
      const msg = mk({ id: `m${++id}`, seq: mem.messages.length + 1, role: "assistant", owner, conversationId, replyToMessageId: studentMessageId, ...reply });
      mem.messages.push(msg);
      return { assistantMessage: msg, created: true, checkpoint: null };
    },
    // Mirrors store.recentTurns: raw stored content + the structural signals (mode, private_refs).
    recentTurns: async (_db: any, owner: string, conversationId: string, beforeSeq: number, n = 6) =>
      mem.messages.filter((m) => m.owner === owner && m.conversationId === conversationId && m.seq < beforeSeq).slice(-n)
        .map((m) => ({ role: m.role === "student" ? "user" : "assistant", content: m.content, mode: m.mode ?? null, privateRefs: m.privateRefs ?? [] })),
  };
});
vi.mock("../server/services/academic-assistant/student-record", async (orig) => {
  const actual: any = await orig();
  return { ...actual, loadOwnStudentRecord: async () => mem.records };
});
vi.mock("../server/services/academic-assistant/budget", async (orig) => {
  const actual: any = await orig();
  return { ...actual, PgBudgetStore: actual.MemoryBudgetStore };
});

import { createConversationService } from "../server/services/assistant-conversations/service";
import { createIntegratedGenerateReply } from "../server/services/assistant-conversations/reply";
import { buildProviderMessages, getStatus } from "../server/services/academic-assistant/service";
import { MemoryBudgetStore } from "../server/services/academic-assistant/budget";
import { PRIVATE_APPENDIX_HEADS, providerSafeTurns } from "../server/services/academic-assistant/private-boundary";
import { isRecordAnswerText } from "../server/services/academic-assistant/student-record";

const OWNER = "student-user-1";
const STUDENT = { id: OWNER, role: "student" };
const CONV = "11111111-1111-4111-8111-111111111111";

// Synthetic private material. Every marker below must never appear in any provider body.
const SECRETS = [
  "Passport scan - Synthetic Student", "uploaded 2026-10-01", "Prefers the name Amy", "SYNTH-LYON-ADDRESS",
  "SECRET-COURSE-TITLE", "Officially earned: 7", "6,750.00", "SYNTHETIC ticket subject", "PRIVATE-ATTACHMENT",
  PRIVATE_APPENDIX_HEADS.en, PRIVATE_APPENDIX_HEADS.fr, "From your record", "D’après votre dossier",
];
const RECORDS = [
  { ref: "S1", label: "Credits", path: "/high-school", title: "Credits", text: "Program requires 21 credits. Officially earned: 7. SECRET-COURSE-TITLE." },
  { ref: "S2", label: "Billing", path: "/billing", title: "Billing", text: "Remaining 6,750.00 USD." },
  { ref: "S3", label: "Support", path: "/support", title: "Support", text: 'Support requests: "SYNTHETIC ticket subject" is open.' },
];
const PRIVATE_ITEMS = [
  { kind: "document", title: "Passport scan - Synthetic Student", snippet: "uploaded 2026-10-01", path: "/documents?doc=d1" },
  { kind: "memory", title: "Prefers the name Amy", snippet: "SYNTH-LYON-ADDRESS", path: "/assistant?panel=memory" },
];

function answerFor(body: string) {
  const parsed = JSON.parse(body);
  const last = parsed.messages[parsed.messages.length - 1].content as string;
  return `Public model answer about: ${last.slice(0, 40)}`;
}

const ENV = ["SPARK_ASSISTANT_ENABLED", "META_MODEL_API_KEY", "SPARK_ASSISTANT_STUDENT_POLICY"] as const;
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.SPARK_ASSISTANT_ENABLED = "true";
  process.env.META_MODEL_API_KEY = "synthetic-not-a-key";
  process.env.SPARK_ASSISTANT_STUDENT_POLICY = "minor_safe_v1";
  vi.stubGlobal("fetch", async (_url: string, init: any) => {
    const body = String(init?.body ?? "");
    mem.providerBodies.push(body);
    if (mem.providerStatus !== 200) return new Response(JSON.stringify({ error: { message: "upstream" } }), { status: mem.providerStatus });
    return new Response(JSON.stringify({ choices: [{ message: { content: answerFor(body) }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 20 } }), { status: 200 });
  });
});
afterAll(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
});
beforeEach(() => {
  mem.messages = []; mem.providerBodies = []; mem.providerStatus = 200;
  mem.records = RECORDS; mem.privateItems = PRIVATE_ITEMS;
});

const service = () => createConversationService({
  database: {} as any,
  logger: { info: () => {}, warn: () => {}, error: () => {} } as any,
  generateReply: createIntegratedGenerateReply({ retrievePrivate: async () => ({ items: mem.privateItems }) }),
});
let n = 0;
const post = (svc: ReturnType<typeof service>, message: string, language: "en" | "fr", extra: Record<string, unknown> = {}) =>
  svc.postMessage(STUDENT, CONV, { clientRequestId: `req-${++n}`, message, language, ...extra } as any);

function expectClean(body: string) {
  for (const s of SECRETS) expect(body, `provider body leaked: ${s}`).not.toContain(s);
}
const lastBody = () => mem.providerBodies[mem.providerBodies.length - 1]!;
const historyOf = (body: string) => (JSON.parse(body).messages as Array<{ role: string; content: string }>).slice(1);

describe("S33-01 baseline reproduction (structure of the defect)", () => {
  it("raw stored content contains the appendix, so forwarding raw turns would leak", async () => {
    const svc = service();
    const r = await post(svc, "What is a syllabus?", "en");
    expect(r.assistantMessage.content).toContain(PRIVATE_APPENDIX_HEADS.en);
    expect(r.assistantMessage.content).toContain("Passport scan - Synthetic Student");
  });
});

for (const lang of ["en", "fr"] as const) {
  const q1 = lang === "en" ? "What is a syllabus?" : "Qu’est-ce qu’un plan de cours ?";
  const q2 = lang === "en" ? "And what is a credit hour?" : "Et qu’est-ce qu’une heure-crédit ?";
  describe(`live conversation with private appendix (${lang.toUpperCase()})`, () => {
    it("student sees the private section and links; next provider payload carries only the public model text", async () => {
      const svc = service();
      const first = await post(svc, q1, lang);
      // 1-2: the student-visible reply has the private appendix with the right data and working deep links.
      expect(first.assistantMessage.mode).toBe("live");
      expect(first.assistantMessage.content).toContain(PRIVATE_APPENDIX_HEADS[lang]);
      expect(first.assistantMessage.content).toContain("Passport scan - Synthetic Student — uploaded 2026-10-01");
      expect(first.assistantMessage.privateRefs).toEqual(expect.arrayContaining([
        { kind: "document", title: "Passport scan - Synthetic Student", path: "/documents?doc=d1" },
        { kind: "memory", title: "Prefers the name Amy", path: "/assistant?panel=memory" },
      ]));
      expectClean(mem.providerBodies[0]!); // the first question itself carried nothing private

      await post(svc, q2, lang);
      expect(mem.providerBodies).toHaveLength(2);
      const body = lastBody();
      // 3-4: complete outgoing structure is provider-safe...
      expectClean(body);
      // ...and still keeps useful public context (the earlier question and the model's own public answer).
      expect(historyOf(body)).toEqual([
        { role: "user", content: q1 },
        { role: "assistant", content: `Public model answer about: ${q1.slice(0, 40)}` },
        { role: "user", content: q2 },
      ]);
    });
  });
}

describe("record answers, general follow-ups and multi-turn windows", () => {
  it("a personal record answer stays local; the following general question sends no record data", async () => {
    const svc = service();
    const rec = await post(svc, "How many credits have I earned?", "en");
    expect(rec.assistantMessage.mode).toBe("local");
    expect(rec.assistantMessage.content).toContain("Officially earned: 7"); // 7: works locally for the student
    expect(mem.providerBodies).toHaveLength(0); // never called the model

    await post(svc, "What is photosynthesis?", "en"); // 8: general questions still go live
    expect(mem.providerBodies).toHaveLength(1);
    expectClean(lastBody());
    expect(lastBody()).not.toContain("How many credits have I earned?");
  });

  it("FR personal answer then FR general question", async () => {
    const svc = service();
    await post(svc, "Combien de crédits ai-je obtenus ?", "fr");
    await post(svc, "Qu’est-ce que la photosynthèse ?", "fr");
    for (const b of mem.providerBodies) expectClean(b);
  });

  it("several consecutive live turns, each with an appendix, across the 6-turn truncation window", async () => {
    const svc = service();
    for (let i = 0; i < 6; i++) await post(svc, `General study question number ${i}?`, i % 2 ? "fr" : "en");
    expect(mem.providerBodies).toHaveLength(6);
    for (const b of mem.providerBodies) expectClean(b);
    // The latest payload kept the public history (bounded) rather than dropping everything.
    expect(historyOf(lastBody()).filter((t) => t.role === "assistant").length).toBeGreaterThan(0);
  });

  it("attachments on earlier student messages never reach the provider", async () => {
    const svc = service();
    await post(svc, "Here is my file, what is a transcript?", "en", { attachmentDocumentIds: ["doc-1"] });
    await post(svc, "And what is a diploma?", "en");
    for (const b of mem.providerBodies) expectClean(b);
  });
});

describe("previously stored (pre-S34) vulnerable history is sanitized on read", () => {
  const seed = (rows: any[]) => rows.forEach((r, i) => mem.messages.push({ id: `old${i}`, seq: i + 1, owner: OWNER, conversationId: CONV, language: "en", sources: [], links: [], notice: null, attachments: [], createdAt: "2026-10-30T00:00:00.000Z", privateRefs: [], mode: null, ...r }));

  it("live-with-appendix (EN/FR, both apostrophes) keeps public text; legacy record answers dropped", async () => {
    seed([
      { role: "student", content: "What is a syllabus?" },
      // live + appendix + private refs (the S33 reproduction shape)
      { role: "assistant", mode: "live", content: `A syllabus is the course outline.\n\n${PRIVATE_APPENDIX_HEADS.en}\n- Passport scan - Synthetic Student — uploaded 2026-10-01`, privateRefs: [{ kind: "document", title: "Passport scan - Synthetic Student", path: "/documents" }] },
      { role: "student", content: "Et un crédit ?" },
      // FR appendix with a straight apostrophe variant and NO private refs recorded
      { role: "assistant", mode: "live", content: `Un crédit mesure le travail.\n\n${PRIVATE_APPENDIX_HEADS.fr.replace("’", "'")}\n- Prefers the name Amy — SYNTH-LYON-ADDRESS`, privateRefs: [] },
      { role: "student", content: "How many credits do I have?" },
      // pre-F34 record answer: local, no refs
      { role: "assistant", mode: "local", content: "From your record (system facts, not AI):\n• Officially earned: 7. SECRET-COURSE-TITLE [S1]", privateRefs: [] },
    ]);
    const r = await post(service(), "What is a semester?", "en");
    expect(r.assistantMessage.mode).toBe("live");
    const body = lastBody();
    expectClean(body);
    const hist = historyOf(body);
    expect(hist).toContainEqual({ role: "assistant", content: "A syllabus is the course outline." });
    expect(hist).toContainEqual({ role: "assistant", content: "Un crédit mesure le travail." });
    expect(body).not.toContain("How many credits do I have?"); // record answer dropped with its question
  });

  it("unknown-format private turns and old local turns are dropped (fail closed)", async () => {
    seed([
      { role: "student", content: "What is a GPA?" },
      // private refs present but the appendix was rendered in an unknown format: must fail closed
      { role: "assistant", mode: "live", content: "A GPA is an average.\n\nPrivate:\n- SYNTHETIC ticket subject", privateRefs: [{ kind: "ticket", title: "x", path: "/support" }] },
      { role: "student", content: "Ok" },
      // local knowledge-base answer with an appendix (mode missing on very old rows)
      { role: "assistant", mode: null, content: `Office hours are...\n\n${PRIVATE_APPENDIX_HEADS.en}\n- 6,750.00 USD balance`, privateRefs: [] },
    ]);
    await post(service(), "What is a semester?", "en");
    const body = lastBody();
    expectClean(body);
    expect(body).not.toContain("A GPA is an average"); // dropped whole (fail closed)
    expect(body).not.toContain("Office hours are");
  });
});

describe("fallback and retry paths", () => {
  it("a provider failure falls back locally, sent nothing private, and the retry replays without a new call", async () => {
    const svc = service();
    await post(svc, "What is a syllabus?", "en");
    mem.providerStatus = 500;
    const failed = await svc.postMessage(STUDENT, CONV, { clientRequestId: "retry-1", message: "What is a credit hour?", language: "en" } as any);
    expect(failed.assistantMessage.mode).toBe("local");
    expect(mem.providerBodies).toHaveLength(2); // one attempt only, no hidden adapter retry
    expectClean(mem.providerBodies[1]!);
    const again = await svc.postMessage(STUDENT, CONV, { clientRequestId: "retry-1", message: "What is a credit hour?", language: "en" } as any);
    expect(again.replayed).toBe(true);
    expect(mem.providerBodies).toHaveLength(2);
  });
});

describe("defence in depth on any caller (client-supplied history on /api/assistant/message)", () => {
  it("buildProviderMessages strips appendices even from client history and keeps the public part", () => {
    const msgs = buildProviderMessages("next?", "fr", [
      { role: "user", content: "q1" },
      { role: "assistant", content: `Réponse publique.\n\n${PRIVATE_APPENDIX_HEADS.fr}\n- Passport scan - Synthetic Student` },
      { role: "user", content: "q2" },
      { role: "assistant", content: `${PRIVATE_APPENDIX_HEADS.en}\n- SYNTH-LYON-ADDRESS` },
    ], [], 2500, true, RECORDS as any);
    const s = JSON.stringify(msgs);
    expectClean(s);
    expect(s).toContain("Réponse publique.");
    expect(s).not.toContain('"q2"');
  });

  it("providerSafeTurns: only live, ref-free (or exactly split) assistant turns survive", () => {
    expect(providerSafeTurns([
      { role: "user", content: "a" }, { role: "assistant", content: "kb text", mode: "local", privateRefs: [] },
      { role: "user", content: "b" }, { role: "assistant", content: "model text", mode: "live", privateRefs: [] },
    ], isRecordAnswerText)).toEqual([{ role: "user", content: "b" }, { role: "assistant", content: "model text" }]);
  });
});

describe("student live/local status follows the student policy, not LIVE_ROLES", () => {
  it("student is live only under SPARK_ASSISTANT_STUDENT_POLICY=minor_safe_v1", async () => {
    const deps = { budget: new MemoryBudgetStore() };
    expect((await getStatus(STUDENT, deps)).mode).toBe("live");
    process.env.SPARK_ASSISTANT_STUDENT_POLICY = "off";
    process.env.SPARK_ASSISTANT_LIVE_ROLES = "admin,student";
    expect(await getStatus(STUDENT, deps)).toMatchObject({ mode: "local", reason: "not_eligible" });
    delete process.env.SPARK_ASSISTANT_LIVE_ROLES;
    process.env.SPARK_ASSISTANT_STUDENT_POLICY = "minor_safe_v1";
  });
});
