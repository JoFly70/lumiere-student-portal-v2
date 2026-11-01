/**
 * S32-A assistant probe (synthetic, local). Runs the REAL answerMessage on the S31-A probe questions with records composed
 * from repo fixtures (HS: s27HsView + s27Journey + BILLING_CONFIGURED; degree: RICH_MID_JOURNEY + COMPOSED), in a LIVE
 * configuration with a fake provider, and records whether a provider call happened and what kind of answer came back.
 *   npx tsx docs/s32/student-repairs/harness/assistant-probe.ts > out.json
 */
import { composeStudentRecords } from "../../../../server/services/academic-assistant/student-record";
import { answerMessage } from "../../../../server/services/academic-assistant/service";
import { ASSISTANT_API_BASE, ASSISTANT_MODEL } from "../../../../server/services/academic-assistant/config";
import { MemoryBudgetStore } from "../../../../server/services/academic-assistant/budget";
import { s27HsView, s27Journey, S27_DOCS } from "../../../../tests/helpers/s27-fixtures";
import { BILLING_CONFIGURED } from "../../../../tests/helpers/s18-billing-fixtures";
import { RICH_MID_JOURNEY } from "../../../../tests/helpers/student-roadmap-ui-fixtures";
import { COMPOSED } from "../../../../tests/helpers/student-progress-ui-fixtures";

const QS: [string, "en" | "fr"][] = [
  ["How many credits do I still need?", "en"], ["What's most urgent?", "en"], ["Am I on track?", "en"], ["Which documents do I owe?", "en"],
  ["Combien de crédits me faut-il encore ?", "fr"], ["Qu’est-ce qui est le plus urgent ?", "fr"], ["Suis-je dans les temps ?", "fr"], ["Quels documents dois-je fournir ?", "fr"],
  ["Where are my credits?", "en"], ["What is my balance?", "en"], ["How much do I owe?", "en"], ["When is my next exam?", "en"],
  ["Où en sont mes crédits ?", "fr"], ["Quand est mon prochain examen ?", "fr"], ["Combien je dois payer ?", "fr"], ["Explique-moi ma feuille de route", "fr"],
  ["Can you explain photosynthesis?", "en"], ["My email is someone@example.com, what are my credits?", "en"],
];

async function run() {
  const out: unknown[] = [];
  for (const persona of ["hs", "degree"] as const) {
    for (const [q, lang] of QS) {
      const docs = (S27_DOCS as any).documents ?? S27_DOCS;
      const records = composeStudentRecords({
        highSchool: persona === "hs" ? s27HsView() : null,
        documents: Array.isArray(docs) ? docs : [],
        tickets: [{ subject: "SYNTHETIC ticket subject", status: "open" }],
        billing: persona === "hs" ? BILLING_CONFIGURED : null,
        journey: s27Journey(),
        degreeRoadmap: persona === "degree" ? (RICH_MID_JOURNEY as any) : null,
        degreeProgress: persona === "degree" ? (COMPOSED as any) : null,
        today: "2026-10-29",
      }, lang);
      const bodies: string[] = [];
      const fetchImpl = (async (_u: string, init: any) => { bodies.push(String(init?.body ?? "")); return new Response(JSON.stringify({ choices: [{ message: { content: "general answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 }); }) as any;
      const cfg = () => ({ liveEnabled: true, hasApiKey: true, monthlyBudgetUsd: 2, maxInputTokens: 2500, maxOutputTokens: 700, timeoutMs: 1000, rateLimitPerMinute: 6, liveRoles: new Set<string>(), studentPolicy: "minor_safe_v1" as const, apiBase: ASSISTANT_API_BASE, model: ASSISTANT_MODEL });
      const r = await answerMessage({ id: "u1", role: "student" }, { message: q, language: lang, records }, { budget: new MemoryBudgetStore(), fetchImpl, config: cfg as any });
      const leaked = bodies.some((b) => /SYNTHETIC ticket subject|\d[\d ,.]*\d{2} USD|hs_transcript|Business Administration/.test(b));
      out.push({ persona, lang, q, mode: r.mode, grounded: r.grounded ?? null, refs: (r.recordRefs ?? []).map((x) => x.path), providerCalls: bodies.length, recordDataInProviderBody: leaked, piiNotice: /privacy|vie privée/i.test(r.notice ?? ""), firstLine: r.reply.split("\n").slice(0, 2).join(" ").slice(0, 160) });
    }
  }
  const file = process.argv[2];
  if (file) (await import("node:fs")).writeFileSync(file, JSON.stringify(out, null, 1)); else console.log(JSON.stringify(out, null, 1));
}
run().catch((e) => { console.error(e); process.exit(1); });
