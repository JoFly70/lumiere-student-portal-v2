/**
 * S21: ONE minimal, non-personal live call to the Meta Model API through the production adapter.
 *
 *   SPARK_SMOKE_CONFIRM=1 npx tsx scripts/s21/spark-contributor-smoke.ts
 *
 * - The model is the server-pinned ASSISTANT_MODEL; the script refuses to run unless it is exactly
 *   `muse-spark-1.3-contributor`, and asserts the outgoing request body carries that id before sending.
 * - In the Claude Code cloud environment the network proxy injects the real credential for api.meta.ai.
 *   The adapter still requires META_MODEL_API_KEY to be set, so this script (and only this process) sets a
 *   placeholder when it is absent. Server key handling is unchanged.
 * - Exactly one request; bounded output; no retry; no fallback. Writes the observed usage to stdout as JSON.
 */
import { ASSISTANT_MODEL, estimateCostUsd, loadAssistantConfig } from "../../server/services/academic-assistant/config";
import { callMuseSpark, type FetchLike } from "../../server/services/academic-assistant/meta-adapter";

const REQUIRED = "muse-spark-1.3-contributor";

async function main() {
  if (process.env.SPARK_SMOKE_CONFIRM !== "1") {
    console.error("Refusing: set SPARK_SMOKE_CONFIRM=1 to make one billable request.");
    process.exit(2);
  }
  if (ASSISTANT_MODEL !== REQUIRED) throw new Error(`model pin is ${ASSISTANT_MODEL}, expected ${REQUIRED}`);
  if (!process.env.META_MODEL_API_KEY) process.env.META_MODEL_API_KEY = "proxy-injected";

  let sentModel: string | undefined;
  let rawUsage: unknown;
  let finishReason: unknown;
  let contentType: string | undefined;
  const guarded: FetchLike = async (url, init) => {
    const body = JSON.parse(init.body);
    sentModel = body.model;
    if (body.model !== REQUIRED) throw new Error(`blocked: outgoing model ${body.model}`);
    if (!String(url).startsWith("https://api.meta.ai/v1/")) throw new Error(`blocked host ${url}`);
    const res = await fetch(url, init);
    const json = await res.json().catch(() => null);
    rawUsage = json?.usage;
    finishReason = json?.choices?.[0]?.finish_reason;
    contentType = typeof json?.choices?.[0]?.message?.content;
    return { ok: res.ok, status: res.status, json: async () => json };
  };

  const started = Date.now();
  try {
    const out = await callMuseSpark(
      [
        { role: "developer", content: "Reply in at most five words." },
        { role: "user", content: "Say hello to a new student." },
      ],
      // Production output cap: Muse Spark always reasons and reasoning tokens share this cap
      // (a 200-token cap was observed to be consumed entirely by reasoning, 2026-10-27).
      { maxOutputTokens: loadAssistantConfig().maxOutputTokens, timeoutMs: 30000, fetchImpl: guarded },
    );
    console.log(JSON.stringify({
      ok: true, model: sentModel, latencyMs: Date.now() - started,
      finishReason, reply: out.text, promptTokens: out.promptTokens, completionTokens: out.completionTokens,
      rawUsage, estimatedCostUsd: estimateCostUsd(out.promptTokens, out.completionTokens),
    }, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, model: sentModel, error: (err as Error).message, finishReason, contentType, rawUsage, latencyMs: Date.now() - started }, null, 2));
    process.exit(1);
  }
}
main();
