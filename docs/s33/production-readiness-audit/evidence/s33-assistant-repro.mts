import { composeWithPrivateContext } from "../../../../server/services/assistant-conversations/reply";
import { buildProviderMessages, answerMessage } from "../../../../server/services/academic-assistant/service";
const base = { content: "A syllabus is the course outline.", mode: "live" as const, sources: [], links: [], notice: null, privateRefs: [] };
const stored = composeWithPrivateContext(base, [{ kind: "document", title: "Passport scan - Synthetic Student", snippet: "uploaded 2026-10-01", path: "/documents" }], "en", "conv-1");
const msgs = buildProviderMessages("And what is a credit hour?", "en", [{ role: "user", content: "What is a syllabus?" }, { role: "assistant", content: stored.content }], [], 2500, true, []);
console.log("A stored reply:\n" + stored.content);
console.log("A provider body contains private appendix:", JSON.stringify(msgs).includes("Passport scan - Synthetic Student"));
const records = [{ label: "Credits", ref: "R1", text: "Earned 3.0 of 24 credits", path: "/high-school", title: "Credits" }] as any;
const cfg = () => ({ liveEnabled: false, hasApiKey: false, monthlyBudgetUsd: 0, maxInputTokens: 2500, maxOutputTokens: 400, timeoutMs: 1000, liveRoles: new Set(), studentPolicy: null, apiBase: "", model: "" }) as any;
for (const q of ["Qu'est-ce qu'un crédit ?", "What is a credit hour?", "Explain what a document is"]) {
  const out = await answerMessage({ id: "u1", role: "student" } as any, { message: q, language: q.startsWith("Qu") ? "fr" : "en", records }, { budget: {} as any, config: cfg } as any);
  console.log(`B local [${q}] grounded=${(out as any).grounded ?? "-"} ->`, out.reply.split("\n").slice(0,2).join(" | "));
}
