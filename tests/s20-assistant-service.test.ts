import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { loadAssistantConfig, parseLiveRoles, ASSISTANT_MODEL, estimateCostUsd } from '../server/services/academic-assistant/config';
import { callMuseSpark, ProviderError } from '../server/services/academic-assistant/meta-adapter';
import { detectPii } from '../server/services/academic-assistant/pii';
import { searchKnowledge } from '../server/services/academic-assistant/retrieval';
import { MemoryBudgetStore } from '../server/services/academic-assistant/budget';
import { answerMessage, getStatus, sanitizeHistory, buildProviderMessages, type AssistantDeps } from '../server/services/academic-assistant/service';
import { logger } from '../server/lib/logger';

const KEY = 'LLM_123456_SECRETKEYVALUE';
const okFetch = (over: any = {}) =>
  vi.fn(async (_url: string, _init: any) => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { role: 'assistant', content: 'A roadmap is a plan.' } }],
      usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 },
      ...over,
    }),
  }));

function liveEnv() {
  process.env.SPARK_ASSISTANT_ENABLED = 'true';
  process.env.META_MODEL_API_KEY = KEY;
  process.env.SPARK_ASSISTANT_LIVE_ROLES = 'staff,admin';
}
const staff = { id: 'u-staff', role: 'staff' };
const student = { id: 'u-stud', role: 'student' };

beforeEach(() => {
  delete process.env.SPARK_ASSISTANT_ENABLED;
  delete process.env.META_MODEL_API_KEY;
  delete process.env.SPARK_ASSISTANT_LIVE_ROLES;
  delete process.env.SPARK_ASSISTANT_MONTHLY_BUDGET_USD;
});
afterEach(() => vi.restoreAllMocks());

function deps(fetchImpl: any, budget = new MemoryBudgetStore()): AssistantDeps {
  return { budget, fetchImpl };
}

describe('config', () => {
  it('is disabled by default and only literal "true" enables', () => {
    expect(loadAssistantConfig().liveEnabled).toBe(false);
    for (const v of ['1', 'TRUE', 'yes', 'True']) {
      process.env.SPARK_ASSISTANT_ENABLED = v;
      expect(loadAssistantConfig().liveEnabled).toBe(false);
    }
    process.env.SPARK_ASSISTANT_ENABLED = 'true';
    expect(loadAssistantConfig().liveEnabled).toBe(true);
  });
  it('defaults budget to $2, never exposes the key, and never lists students as live', () => {
    expect(loadAssistantConfig().monthlyBudgetUsd).toBe(2);
    process.env.META_MODEL_API_KEY = KEY;
    expect(JSON.stringify(loadAssistantConfig())).not.toContain(KEY);
    expect([...parseLiveRoles('student, staff,bogus')]).toEqual(['staff']);
  });
  it('prices contributor tier tokens', () => {
    expect(estimateCostUsd(1_000_000, 1_000_000)).toBeCloseTo(0.3, 6);
  });
});

describe('adapter', () => {
  it('targets exactly api.meta.ai and muse-spark-1.3-contributor, bearer auth, caps output', async () => {
    process.env.META_MODEL_API_KEY = KEY;
    const f = okFetch();
    const r = await callMuseSpark([{ role: 'user', content: 'hi' }], { maxOutputTokens: 321, timeoutMs: 5000, fetchImpl: f as any });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.meta.ai/v1/chat/completions');
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init.body);
    expect(body.model).toBe('muse-spark-1.3-contributor');
    expect(ASSISTANT_MODEL).toBe('muse-spark-1.3-contributor');
    expect(body.max_completion_tokens).toBe(321);
    expect(body.tools).toBeUndefined();
    expect(body.stream).toBe(false);
    expect(r).toMatchObject({ text: 'A roadmap is a plan.', promptTokens: 500, completionTokens: 100 });
  });
  it('times out via abort and does not leak details', async () => {
    process.env.META_MODEL_API_KEY = KEY;
    const f = vi.fn((_u: string, init: any) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(Object.assign(new Error(`boom ${KEY}`), { name: 'AbortError' })));
    }));
    const err: any = await callMuseSpark([{ role: 'user', content: 'x' }], { maxOutputTokens: 10, timeoutMs: 20, fetchImpl: f as any }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe('timeout');
    expect(err.message).not.toContain(KEY);
  });
  it('rejects malformed responses and missing key', async () => {
    await expect(callMuseSpark([], { maxOutputTokens: 1, timeoutMs: 100, fetchImpl: okFetch() as any })).rejects.toMatchObject({ kind: 'not_configured' });
    process.env.META_MODEL_API_KEY = KEY;
    const bad = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) }));
    await expect(callMuseSpark([], { maxOutputTokens: 1, timeoutMs: 100, fetchImpl: bad as any })).rejects.toMatchObject({ kind: 'bad_response' });
  });
});

describe('PII guard', () => {
  const flagged = [
    'email me at jane.doe@gmail.com', 'call 514-555-1234', 'my student id is 20231234', '123 Main Street apt 4',
    'my name is Jane', 'je m’appelle Marie', 'what is my GPA', 'mes notes sont basses', 'born on 03/04/2009',
    'date de naissance 2008', 'jane [at] gmail [dot] com', 'ma moyenne est 3.2', 'my address is somewhere',
  ];
  for (const t of flagged) it(`flags: ${t}`, () => expect(detectPii(t).flagged).toBe(true));
  for (const t of ['What is a credit hour?', 'Comment fonctionne une feuille de route ?', 'How many credits is a bachelor degree?'])
    it(`allows: ${t}`, () => expect(detectPii(t).flagged).toBe(false));
});

describe('service gating', () => {
  it('disabled by default: local, provider never called', async () => {
    const f = okFetch();
    const r = await answerMessage(staff, { message: 'How does a roadmap work?', language: 'en' }, deps(f));
    expect(r.mode).toBe('local');
    expect(f).not.toHaveBeenCalled();
  });
  it('missing key -> local', async () => {
    process.env.SPARK_ASSISTANT_ENABLED = 'true';
    process.env.SPARK_ASSISTANT_LIVE_ROLES = 'staff';
    const f = okFetch();
    expect((await answerMessage(staff, { message: 'roadmap?', language: 'en' }, deps(f))).mode).toBe('local');
    expect(f).not.toHaveBeenCalled();
  });
  it('students never call the provider, even if env lists student', async () => {
    liveEnv();
    process.env.SPARK_ASSISTANT_LIVE_ROLES = 'student,staff';
    const f = okFetch();
    const r = await answerMessage(student, { message: 'How does a roadmap work?', language: 'en' }, deps(f));
    expect(r.mode).toBe('local');
    expect(f).not.toHaveBeenCalled();
    const st: any = await getStatus(student, deps(f));
    expect(st).toMatchObject({ mode: 'local', liveModel: false, reason: 'not_eligible', enabled: true });
  });
  it('PII blocks the provider call even for eligible users', async () => {
    liveEnv();
    const f = okFetch();
    const r = await answerMessage(staff, { message: 'My name is Jane, what is a credit hour?', language: 'en' }, deps(f));
    expect(r.mode).toBe('local');
    expect(r.notice).toMatch(/privacy/);
    expect(f).not.toHaveBeenCalled();
    // PII hidden in history is blocked too
    const r2 = await answerMessage(staff, { message: 'and a credit?', language: 'fr', history: [{ role: 'user', content: 'mon courriel est a@b.co' }] }, deps(f));
    expect(r2.mode).toBe('local');
    expect(f).not.toHaveBeenCalled();
  });
  it('eligible adult staff gets live answer; sends only question+history+public notes', async () => {
    liveEnv();
    const f = okFetch();
    const r = await answerMessage(staff, { message: 'How does a roadmap work?', language: 'en', history: [{ role: 'user', content: 'hello' }] }, deps(f));
    expect(r.mode).toBe('live');
    expect(r.reply).toContain('roadmap');
    const sent = JSON.parse(f.mock.calls[0][1].body);
    const blob = JSON.stringify(sent);
    expect(blob).not.toContain('u-staff');
    expect(blob).not.toContain(KEY);
    expect(sent.messages[0].role).toBe('developer');
    expect(JSON.stringify(r)).not.toContain(KEY);
    const st: any = await getStatus(staff, deps(f));
    expect(st).toMatchObject({ mode: 'live', liveModel: true });
    expect(st.reason).toBeUndefined();
  });
  it('budget exhaustion fails closed (and store errors do too)', async () => {
    liveEnv();
    process.env.SPARK_ASSISTANT_MONTHLY_BUDGET_USD = '0.0001'; // 100 micro < worst case reservation
    const f = okFetch();
    const r = await answerMessage(staff, { message: 'roadmap', language: 'en' }, deps(f));
    expect(r.mode).toBe('local');
    expect(f).not.toHaveBeenCalled();
    expect(((await getStatus(staff, deps(f))) as any).reason).toBe('budget_exhausted');

    delete process.env.SPARK_ASSISTANT_MONTHLY_BUDGET_USD;
    const down = new MemoryBudgetStore(); down.failing = true;
    expect((await answerMessage(staff, { message: 'roadmap', language: 'en' }, deps(f, down))).mode).toBe('local');
    expect(((await getStatus(staff, deps(f, down))) as any).reason).toBe('budget_exhausted');
    expect(f).not.toHaveBeenCalled();
  });
  it('accumulates actual spend and stops at the cap', async () => {
    liveEnv();
    process.env.SPARK_ASSISTANT_MONTHLY_BUDGET_USD = '0.002'; // 2000 micro; worst case ~390
    const budget = new MemoryBudgetStore();
    const f = okFetch({ usage: { prompt_tokens: 2500, completion_tokens: 700, total_tokens: 3200 } }); // ~390 micro each
    const modes: string[] = [];
    for (let i = 0; i < 8; i++) modes.push((await answerMessage(staff, { message: 'roadmap', language: 'en' }, deps(f, budget))).mode);
    expect(modes.filter((m) => m === 'live').length).toBeGreaterThan(0);
    expect(modes.filter((m) => m === 'live').length).toBeLessThan(8);
    expect([...budget.totals.values()][0]).toBeLessThanOrEqual(2000);
  });
  it('provider failure degrades to local and logs no content or key', async () => {
    liveEnv();
    const warn = vi.spyOn(logger, 'warn');
    const err = vi.spyOn(logger, 'error');
    const f = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: `secret ${KEY}` }) }));
    const r = await answerMessage(staff, { message: 'secret question about roadmap', language: 'en' }, deps(f as any));
    expect(r.mode).toBe('local');
    expect(r.notice).toMatch(/unavailable/);
    const logged = JSON.stringify([...warn.mock.calls, ...err.mock.calls]);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain('secret question');
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
});

describe('limits', () => {
  it('bounds history to 6 turns and truncates each', () => {
    const h = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}`.padEnd(1000, 'x') }));
    const s = sanitizeHistory(h);
    expect(s).toHaveLength(6);
    expect(s.every((t) => t.content.length <= 400)).toBe(true);
    expect(s[5].content.startsWith('19')).toBe(true);
    expect(sanitizeHistory('nope')).toEqual([]);
  });
  it('trims provider input to the token cap', () => {
    const hist = sanitizeHistory(Array.from({ length: 6 }, () => ({ role: 'user', content: 'word '.repeat(80) })));
    const msgs = buildProviderMessages('roadmap?', 'en', hist, searchKnowledge('transfer credit tesu', 3).map((h) => h.entry), 400);
    const total = msgs.reduce((s, m) => s + Math.ceil(m.content.length / 3.5) + 4, 0);
    expect(total).toBeLessThanOrEqual(400);
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'roadmap?' });
  });
});

describe('local knowledge', () => {
  it('answers EN and FR with sources where relevant', async () => {
    const d = deps(okFetch());
    const en = await answerMessage(student, { message: 'What does TESU say about transfer credit and ACE?', language: 'en' }, d);
    expect(en.mode).toBe('local');
    expect(en.reply).toMatch(/TESU/);
    expect(en.sources.length).toBeGreaterThan(0);
    expect(en.sources[0].url).toMatch(/^https:\/\/www\.tesu\.edu/);
    expect(en.sources[0].verifiedAt).toBe('2026-10-27');
    const fr = await answerMessage(student, { message: 'Que signifient les statuts officiel et en attente de vérification ?', language: 'fr' }, d);
    expect(fr.reply).toMatch(/Officiel/);
    const fr2 = await answerMessage(student, { message: 'Comment fonctionne une feuille de route ?', language: 'fr' }, d);
    expect(fr2.reply).toMatch(/feuille de route/i);
    expect(fr2.links.some((l) => l.path === '/roadmap')).toBe(true);
  });
  it('never asserts transfer acceptance and falls back for unknown questions', async () => {
    const r = await answerMessage(student, { message: 'Will Sophia credits transfer to my college?', language: 'en' }, deps(okFetch()));
    expect(r.reply).not.toMatch(/will be accepted|guaranteed to transfer/i);
    expect(r.reply).toMatch(/decides|decision|decide/i);
    const none = await answerMessage(student, { message: 'qzxv blorp', language: 'en' }, deps(okFetch()));
    expect(none.mode).toBe('local');
    expect(none.links[0].path).toBe('/support');
  });
});
