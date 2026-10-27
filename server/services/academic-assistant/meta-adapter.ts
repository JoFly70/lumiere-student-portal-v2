/**
 * ONLY file that talks to the Meta Model API. Verified against the official docs
 * (ai.developer.meta.com / dev.meta.ai, retrieved 2026-10-27):
 *  - POST https://api.meta.ai/v1/chat/completions, `Authorization: Bearer <key>`
 *  - `developer` role for instructions (`system` accepted); `max_completion_tokens`
 *  - Muse Spark always reasons: reasoning_effort "none" -> HTTP 400; we send "low"
 *  - `stop`, `n>1`, `logprobs`, `web_search_options` unsupported (never sent)
 *  - usage.prompt_tokens / completion_tokens / total_tokens
 * No tools, no search grounding, no other model or provider.
 */
import { ASSISTANT_API_BASE, ASSISTANT_MODEL, getProviderApiKey } from './config';

export type FetchLike = (url: string, init: any) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
}>;

export interface ProviderMessage {
  role: 'developer' | 'user' | 'assistant';
  content: string;
}

export interface ProviderResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

export class ProviderError extends Error {
  constructor(public readonly kind: 'not_configured' | 'timeout' | 'http' | 'bad_response' | 'network', public readonly status?: number) {
    // Deliberately generic: never carry provider body text or the key.
    super(`provider_${kind}${status ? `_${status}` : ''}`);
  }
}

export async function callMuseSpark(
  messages: ProviderMessage[],
  opts: { maxOutputTokens: number; timeoutMs: number; fetchImpl?: FetchLike },
): Promise<ProviderResult> {
  const key = getProviderApiKey();
  if (!key) throw new ProviderError('not_configured');
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((globalThis.fetch as unknown) as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetchImpl(`${ASSISTANT_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: ASSISTANT_MODEL,
        messages,
        max_completion_tokens: opts.maxOutputTokens,
        reasoning_effort: 'low',
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new ProviderError('http', res.status);
    const body = await res.json();
    const text = body?.choices?.[0]?.message?.content;
    const usage = body?.usage;
    if (typeof text !== 'string' || !text.trim() || !usage) throw new ProviderError('bad_response');
    const promptTokens = Number(usage.prompt_tokens);
    const completionTokens = Number(usage.completion_tokens);
    if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) throw new ProviderError('bad_response');
    return { text: text.trim(), promptTokens, completionTokens };
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if ((err as any)?.name === 'AbortError' || controller.signal.aborted) throw new ProviderError('timeout');
    throw new ProviderError('network');
  } finally {
    clearTimeout(timer);
  }
}
