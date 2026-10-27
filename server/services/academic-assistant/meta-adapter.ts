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

export interface ProviderUsage {
  promptTokens: number;
  /** As billed: INCLUDES reasoning tokens (live-verified). */
  completionTokens: number;
  /** completion_tokens_details.reasoning_tokens, for logging only (already inside completionTokens). */
  reasoningTokens: number | null;
}

export interface ProviderResult extends ProviderUsage {
  text: string;
  finishReason: string | null;
}

export type ProviderErrorKind = 'not_configured' | 'model_rejected' | 'timeout' | 'http' | 'bad_response' | 'truncated' | 'network';

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    public readonly status?: number,
    /** Present when the provider returned usage (so it billed us), even for failed answers. */
    public readonly usage?: ProviderUsage,
  ) {
    // Deliberately generic: never carry provider body text or the key.
    super(`provider_${kind}${status ? `_${status}` : ''}`);
  }
}

/**
 * Hard pin. Only the exact contributor-tier id may ever leave the server: no case, whitespace or
 * variant tolerance. Runs immediately before fetch and again on the serialized body.
 */
export function assertContributorModel(model: unknown): asserts model is typeof ASSISTANT_MODEL {
  if (model !== ASSISTANT_MODEL) throw new ProviderError('model_rejected');
}

function parseUsage(raw: any): ProviderUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const promptTokens = Number(raw.prompt_tokens);
  const completionTokens = Number(raw.completion_tokens);
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens) || promptTokens < 0 || completionTokens < 0) return undefined;
  const r = Number(raw.completion_tokens_details?.reasoning_tokens);
  return { promptTokens, completionTokens, reasoningTokens: Number.isFinite(r) && r >= 0 ? r : null };
}

export async function callMuseSpark(
  messages: ProviderMessage[],
  opts: { maxOutputTokens: number; timeoutMs: number; fetchImpl?: FetchLike; model?: string; apiBase?: string },
): Promise<ProviderResult> {
  const key = getProviderApiKey();
  if (!key) throw new ProviderError('not_configured');
  // Pin check on the configured values (a mutated config must fail before any outbound call).
  const model = opts.model ?? ASSISTANT_MODEL;
  assertContributorModel(model);
  if ((opts.apiBase ?? ASSISTANT_API_BASE) !== ASSISTANT_API_BASE) throw new ProviderError('model_rejected');
  const serialized = JSON.stringify({
    model,
    messages,
    max_completion_tokens: opts.maxOutputTokens,
    reasoning_effort: 'low',
    stream: false,
  });
  assertContributorModel(JSON.parse(serialized).model); // and on the exact bytes that will be sent
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((globalThis.fetch as unknown) as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetchImpl(`${ASSISTANT_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: serialized,
      signal: controller.signal,
    });
    if (!res.ok) throw new ProviderError('http', res.status);
    const body = await res.json();
    const choice = body?.choices?.[0];
    const text = choice?.message?.content;
    const finishReason: string | null = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
    const usage = parseUsage(body?.usage);
    const empty = typeof text !== 'string' || !text.trim();
    // Empty answer cut off by the cap (reasoning consumed the budget): distinct kind, billed usage kept.
    if (empty && finishReason === 'length') throw new ProviderError('truncated', undefined, usage);
    if (empty || !usage) throw new ProviderError('bad_response', undefined, usage);
    return { text: (text as string).trim(), ...usage, finishReason };
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if ((err as any)?.name === 'AbortError' || controller.signal.aborted) throw new ProviderError('timeout');
    throw new ProviderError('network');
  } finally {
    clearTimeout(timer);
  }
}
