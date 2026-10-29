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
  /** The model the provider reports in its response body (`model`), or null when it does not say. */
  servedModel: string | null;
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
    const servedModel = typeof body?.model === 'string' && body.model.trim() ? body.model.trim().slice(0, 120) : null;
    return { text: (text as string).trim(), ...usage, finishReason, servedModel };
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if ((err as any)?.name === 'AbortError' || controller.signal.aborted) throw new ProviderError('timeout');
    throw new ProviderError('network');
  } finally {
    clearTimeout(timer);
  }
}

// ── S27: web research (staff only) — Responses API with the built-in web_search tool ─────────────

export interface WebCitation { url: string; title: string }
export interface WebSearchResult extends ProviderUsage {
  text: string;
  citations: WebCitation[];
  /** True when the provider reports at least one web_search_call in the output. */
  searched: boolean;
  servedModel: string | null;
}

/** Only http(s) URLs are kept as citations (anything else is dropped, never rendered as a link). */
function safeCitationUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * One search-grounded answer. Search grounding exists only on the Responses API
 * (POST /v1/responses, tools: [{ type: "web_search" }]); the model decides whether to search and
 * cites sources as `url_citation` annotations. Same pinned model and host as every other call.
 */
export async function callMuseSparkWebSearch(
  input: { instructions: string; question: string },
  opts: { maxOutputTokens: number; timeoutMs: number; maxSearches: number; fetchImpl?: FetchLike; model?: string; apiBase?: string },
): Promise<WebSearchResult> {
  const key = getProviderApiKey();
  if (!key) throw new ProviderError('not_configured');
  const model = opts.model ?? ASSISTANT_MODEL;
  assertContributorModel(model);
  if ((opts.apiBase ?? ASSISTANT_API_BASE) !== ASSISTANT_API_BASE) throw new ProviderError('model_rejected');
  const serialized = JSON.stringify({
    model,
    instructions: input.instructions,
    input: input.question,
    tools: [{ type: 'web_search' }],
    max_tool_calls: opts.maxSearches,
    max_output_tokens: opts.maxOutputTokens,
    reasoning: { effort: 'low' },
    stream: false,
  });
  assertContributorModel(JSON.parse(serialized).model);
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((globalThis.fetch as unknown) as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetchImpl(`${ASSISTANT_API_BASE}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: serialized,
      signal: controller.signal,
    });
    if (!res.ok) throw new ProviderError('http', res.status);
    const body = await res.json();
    const output: any[] = Array.isArray(body?.output) ? body.output : [];
    const searched = output.some((o) => o?.type === 'web_search_call');
    const texts: string[] = [];
    const seen = new Set<string>();
    const citations: WebCitation[] = [];
    for (const item of output) {
      if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
      for (const block of item.content) {
        if (block?.type !== 'output_text' || typeof block.text !== 'string') continue;
        texts.push(block.text);
        for (const ann of Array.isArray(block.annotations) ? block.annotations : []) {
          const url = ann?.type === 'url_citation' ? safeCitationUrl(ann.url) : null;
          if (!url || seen.has(url)) continue;
          seen.add(url);
          citations.push({ url, title: typeof ann.title === 'string' && ann.title.trim() ? ann.title.trim().slice(0, 200) : new URL(url).hostname });
        }
      }
    }
    const text = texts.join('\n\n').trim();
    const u = body?.usage;
    const promptTokens = Number(u?.input_tokens ?? u?.prompt_tokens);
    const completionTokens = Number(u?.output_tokens ?? u?.completion_tokens);
    const usageOk = Number.isFinite(promptTokens) && Number.isFinite(completionTokens) && promptTokens >= 0 && completionTokens >= 0;
    const usage: ProviderUsage | undefined = usageOk ? { promptTokens, completionTokens, reasoningTokens: Number.isFinite(Number(u?.output_tokens_details?.reasoning_tokens)) ? Number(u.output_tokens_details.reasoning_tokens) : null } : undefined;
    if (!text && body?.status === 'incomplete') throw new ProviderError('truncated', undefined, usage);
    if (!text || !usage) throw new ProviderError('bad_response', undefined, usage);
    const servedModel = typeof body?.model === 'string' && body.model.trim() ? body.model.trim().slice(0, 120) : null;
    return { text, citations: citations.slice(0, 12), searched, servedModel, ...usage };
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if ((err as any)?.name === 'AbortError' || controller.signal.aborted) throw new ProviderError('timeout');
    throw new ProviderError('network');
  } finally {
    clearTimeout(timer);
  }
}
