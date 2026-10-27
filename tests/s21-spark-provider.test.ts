import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { loadAssistantConfig, ASSISTANT_MODEL, MIN_OUTPUT_TOKENS } from '../server/services/academic-assistant/config';
import { callMuseSpark, assertContributorModel, ProviderError } from '../server/services/academic-assistant/meta-adapter';
import { MemoryBudgetStore } from '../server/services/academic-assistant/budget';
import { answerMessage } from '../server/services/academic-assistant/service';

const CONTRIBUTOR = 'muse-spark-1.3-contributor';
const msgs = [{ role: 'user' as const, content: 'hi' }];
const reply = (body: any) => vi.fn(async (_u: string, _i: any) => ({ ok: true, status: 200, json: async () => body }));
const liveOk = {
  choices: [{ finish_reason: 'stop', message: { content: 'Hello, welcome new student!' } }],
  usage: { prompt_tokens: 26, completion_tokens: 312, total_tokens: 338, completion_tokens_details: { reasoning_tokens: 297 } },
};
const truncated = {
  choices: [{ finish_reason: 'length', message: { content: '' } }],
  usage: { prompt_tokens: 26, completion_tokens: 200, total_tokens: 226, completion_tokens_details: { reasoning_tokens: 198 } },
};
const ENV_KEYS = ['SPARK_ASSISTANT_MODEL', 'META_MODEL', 'MODEL', 'META_MODEL_NAME', 'SPARK_ASSISTANT_API_BASE', 'META_API_BASE', 'SPARK_ASSISTANT_MAX_OUTPUT_TOKENS'];

beforeEach(() => {
  process.env.META_MODEL_API_KEY = 'synthetic-key';
  process.env.SPARK_ASSISTANT_ENABLED = 'true';
  process.env.SPARK_ASSISTANT_LIVE_ROLES = 'staff';
});
afterEach(() => {
  for (const k of [...ENV_KEYS, 'META_MODEL_API_KEY', 'SPARK_ASSISTANT_ENABLED', 'SPARK_ASSISTANT_LIVE_ROLES']) delete process.env[k];
  vi.restoreAllMocks();
});

describe('S21 Spark: hard model enforcement', () => {
  it.each(['muse-spark-1.3', 'muse-spark-1.3-contributor ', ' muse-spark-1.3-contributor', 'MUSE-SPARK-1.3-CONTRIBUTOR', 'muse-spark-1.2-contributor', 'muse-spark-1.3-pro', 'muse', '', 'gpt-4o'])(
    'rejects %j before any fetch',
    async (bad) => {
      const f = reply(liveOk);
      await expect(callMuseSpark(msgs, { maxOutputTokens: 700, timeoutMs: 1000, fetchImpl: f as any, model: bad })).rejects.toMatchObject({ kind: 'model_rejected' });
      expect(f).not.toHaveBeenCalled();
    },
  );

  it('assertContributorModel accepts only the exact id and rejects non-strings', () => {
    expect(() => assertContributorModel(CONTRIBUTOR)).not.toThrow();
    for (const v of [undefined, null, 1, {}, ['muse-spark-1.3-contributor']]) expect(() => assertContributorModel(v)).toThrow(ProviderError);
  });

  it('rejects a foreign API base before fetch', async () => {
    const f = reply(liveOk);
    await expect(callMuseSpark(msgs, { maxOutputTokens: 700, timeoutMs: 1000, fetchImpl: f as any, apiBase: 'https://evil.example/v1' })).rejects.toMatchObject({ kind: 'model_rejected' });
    expect(f).not.toHaveBeenCalled();
  });

  it('environment variables cannot change model or API base', async () => {
    for (const k of ['SPARK_ASSISTANT_MODEL', 'META_MODEL', 'MODEL', 'META_MODEL_NAME']) process.env[k] = 'muse-spark-1.3';
    process.env.SPARK_ASSISTANT_API_BASE = 'https://evil.example/v1';
    process.env.META_API_BASE = 'https://evil.example/v1';
    const cfg = loadAssistantConfig();
    expect(cfg.model).toBe(CONTRIBUTOR);
    expect(cfg.apiBase).toBe('https://api.meta.ai/v1');
    const f = reply(liveOk);
    await callMuseSpark(msgs, { maxOutputTokens: 700, timeoutMs: 1000, fetchImpl: f as any, model: cfg.model, apiBase: cfg.apiBase });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.meta.ai/v1/chat/completions');
    expect(JSON.parse(init.body).model).toBe(CONTRIBUTOR);
  });

  it('a request/client payload cannot carry a model into the provider body', async () => {
    const f = reply(liveOk);
    await answerMessage(
      { id: 'u1', role: 'staff' },
      { message: 'What is a roadmap?', language: 'en', history: [], model: 'muse-spark-1.3', apiBase: 'https://evil.example' } as any,
      { budget: new MemoryBudgetStore(), fetchImpl: f as any },
    );
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.mock.calls[0][1].body).model).toBe(CONTRIBUTOR);
    expect(f.mock.calls[0][0]).toBe('https://api.meta.ai/v1/chat/completions');
  });

  it('service: a mutated config.model is rejected before fetch, falls back to local, reservation released', async () => {
    const f = reply(liveOk);
    const budget = new MemoryBudgetStore();
    const out = await answerMessage(
      { id: 'u1', role: 'staff' },
      { message: 'What is a roadmap?', language: 'en' },
      { budget, fetchImpl: f as any, config: () => ({ ...loadAssistantConfig(), model: 'muse-spark-1.3' }) },
    );
    expect(f).not.toHaveBeenCalled();
    expect(out.mode).toBe('local');
    expect([...budget.totals.values()][0]).toBe(0);
  });

  it('students never reach the provider', async () => {
    process.env.SPARK_ASSISTANT_LIVE_ROLES = 'student,staff';
    const f = reply(liveOk);
    const out = await answerMessage({ id: 's', role: 'student' }, { message: 'What is a roadmap?', language: 'en' }, { budget: new MemoryBudgetStore(), fetchImpl: f as any });
    expect(f).not.toHaveBeenCalled();
    expect(out.mode).toBe('local');
  });

  it('the source contains no other model id as a default', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const dir = path.join(__dirname, '../server/services/academic-assistant');
    for (const f of fs.readdirSync(dir)) {
      const ids = fs.readFileSync(path.join(dir, f), 'utf8').match(/muse-spark-[\w.\-]+/g) ?? [];
      for (const id of ids) expect(id).toBe(CONTRIBUTOR);
    }
  });
});

describe('S21 Spark: live-response compatibility', () => {
  it('parses the real response shape: reasoning tokens inside completion_tokens, cost unchanged', async () => {
    const out = await callMuseSpark(msgs, { maxOutputTokens: 700, timeoutMs: 1000, fetchImpl: reply(liveOk) as any });
    expect(out).toMatchObject({ text: 'Hello, welcome new student!', promptTokens: 26, completionTokens: 312, reasoningTokens: 297, finishReason: 'stop' });
  });

  it('reasoningTokens is null when absent', async () => {
    const body = { ...liveOk, usage: { prompt_tokens: 1, completion_tokens: 2 } };
    expect((await callMuseSpark(msgs, { maxOutputTokens: 700, timeoutMs: 1000, fetchImpl: reply(body) as any })).reasoningTokens).toBeNull();
  });

  it('finish_reason length with empty content is a distinct truncated error carrying usage', async () => {
    const err: any = await callMuseSpark(msgs, { maxOutputTokens: 200, timeoutMs: 1000, fetchImpl: reply(truncated) as any }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe('truncated');
    expect(err.usage).toEqual({ promptTokens: 26, completionTokens: 200, reasoningTokens: 198 });
  });

  it('empty content with a stop reason stays bad_response, still carrying usage', async () => {
    const body = { choices: [{ finish_reason: 'stop', message: { content: '' } }], usage: { prompt_tokens: 5, completion_tokens: 9 } };
    const err: any = await callMuseSpark(msgs, { maxOutputTokens: 700, timeoutMs: 1000, fetchImpl: reply(body) as any }).catch((e) => e);
    expect(err.kind).toBe('bad_response');
    expect(err.usage).toMatchObject({ promptTokens: 5, completionTokens: 9 });
  });

  it('service settles at actual usage on truncated (provider billed) and falls back to local', async () => {
    const budget = new MemoryBudgetStore();
    const out = await answerMessage({ id: 'u1', role: 'staff' }, { message: 'What is a roadmap?', language: 'en' }, { budget, fetchImpl: reply(truncated) as any });
    expect(out.mode).toBe('local');
    expect([...budget.totals.values()][0]).toBe(Math.ceil((26 * 0.1 + 200 * 0.2)));
  });

  it('service settles at actual usage on bad_response with usage', async () => {
    const body = { choices: [{ finish_reason: 'stop', message: { content: '' } }], usage: { prompt_tokens: 100, completion_tokens: 50 } };
    const budget = new MemoryBudgetStore();
    await answerMessage({ id: 'u1', role: 'staff' }, { message: 'What is a roadmap?', language: 'en' }, { budget, fetchImpl: reply(body) as any });
    expect([...budget.totals.values()][0]).toBe(Math.ceil(100 * 0.1 + 50 * 0.2));
  });

  it('bad_response without usage keeps the full reservation (conservative)', async () => {
    const budget = new MemoryBudgetStore();
    await answerMessage({ id: 'u1', role: 'staff' }, { message: 'What is a roadmap?', language: 'en' }, { budget, fetchImpl: reply({ choices: [] }) as any });
    expect([...budget.totals.values()][0]).toBeGreaterThan(100);
  });

  it('live-evidence cost of the successful call is about $0.000065', async () => {
    const budget = new MemoryBudgetStore();
    const out = await answerMessage({ id: 'u1', role: 'staff' }, { message: 'What is a roadmap?', language: 'en' }, { budget, fetchImpl: reply(liveOk) as any });
    expect(out.mode).toBe('live');
    expect([...budget.totals.values()][0]).toBe(65); // 26*0.1 + 312*0.2 = 65.0 -> micro-USD
  });

  it('output cap defaults to 700 and is clamped to the safe minimum', () => {
    expect(loadAssistantConfig().maxOutputTokens).toBe(700);
    process.env.SPARK_ASSISTANT_MAX_OUTPUT_TOKENS = '200';
    expect(loadAssistantConfig().maxOutputTokens).toBe(MIN_OUTPUT_TOKENS);
    expect(MIN_OUTPUT_TOKENS).toBeGreaterThanOrEqual(400);
    process.env.SPARK_ASSISTANT_MAX_OUTPUT_TOKENS = '99999';
    expect(loadAssistantConfig().maxOutputTokens).toBe(4000);
  });

  it('sends the pinned shape: low reasoning, no stream, capped output', async () => {
    const f = reply(liveOk);
    await callMuseSpark(msgs, { maxOutputTokens: 700, timeoutMs: 1000, fetchImpl: f as any });
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ model: ASSISTANT_MODEL, max_completion_tokens: 700, reasoning_effort: 'low', stream: false });
  });
});
