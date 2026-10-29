/**
 * Academic Assistant configuration. Read lazily from the environment so tests can
 * override it. The API key is only ever exposed through getProviderApiKey() and is
 * never part of the object returned by loadAssistantConfig().
 */

export const ASSISTANT_MODEL = 'muse-spark-1.3-contributor' as const;
export const ASSISTANT_API_BASE = 'https://api.meta.ai/v1' as const;

/**
 * Contributor-tier pricing, USD per 1M tokens.
 * Source: https://dev.meta.ai/docs/pricing-rate-limits.md (retrieved 2026-10-27):
 * Contributor mode input $0.10, output $0.20, cached input $0.002. Cached-input
 * discounts are ignored (we price every input token at the full input rate: conservative).
 * Reasoning tokens ARE included in usage.completion_tokens: confirmed by the live smoke
 * test (2026-10-27, docs/recovery/s21/spark-live-smoke.json: completion_tokens 312 with
 * completion_tokens_details.reasoning_tokens 297). Cost therefore uses completion_tokens
 * as-is; reasoning_tokens is parsed for logging only and never added on top.
 */
export const PRICE_PER_MILLION_USD = { input: 0.1, output: 0.2 } as const;

/**
 * Output-cap floor. Muse Spark always reasons and reasoning shares max_completion_tokens.
 * Live evidence: a 200-token cap returned EMPTY content (finish_reason length, 198/200 spent on
 * reasoning); the same prompt at 700 used 312 tokens and answered. 400 is the lowest value that
 * leaves answer headroom above the observed ~300 reasoning tokens for a trivial prompt (knowledge-
 * grounded answers reason more), so lower caps are unsafe and are clamped up. Default stays 700.
 */
export const MIN_OUTPUT_TOKENS = 400;

export interface AssistantConfig {
  /** Only the literal string "true" enables live inference. */
  liveEnabled: boolean;
  hasApiKey: boolean;
  monthlyBudgetUsd: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
  rateLimitPerMinute: number;
  /** Roles allowed live inference. "student" can never be listed (no adult attestation exists). */
  liveRoles: ReadonlySet<string>;
  /**
   * S26: owner-approved policy that lets STUDENT sessions (minors included) use live inference
   * under the stricter minor-safe prompt. Only the exact value "minor_safe_v1" enables it; it is
   * separate from liveRoles so students can never be enabled by a role list.
   */
  studentPolicy?: 'minor_safe_v1' | null;
  apiBase: string;
  model: string;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function parseLiveRoles(raw: string | undefined): Set<string> {
  const roles = new Set<string>();
  for (const part of (raw ?? '').split(',')) {
    const role = part.trim().toLowerCase();
    // Fail closed: students are never eligible without a server-side adult attestation.
    if (role && role !== 'student' && ['coach', 'staff', 'admin'].includes(role)) roles.add(role);
  }
  return roles;
}

export function loadAssistantConfig(): AssistantConfig {
  return {
    liveEnabled: process.env.SPARK_ASSISTANT_ENABLED === 'true',
    hasApiKey: Boolean(process.env.META_MODEL_API_KEY && process.env.META_MODEL_API_KEY.trim()),
    monthlyBudgetUsd: numEnv('SPARK_ASSISTANT_MONTHLY_BUDGET_USD', 2),
    maxInputTokens: intEnv('SPARK_ASSISTANT_MAX_INPUT_TOKENS', 2500, 200, 20000),
    // Muse Spark always reasons; reasoning tokens share this cap, so keep it comfortable.
    maxOutputTokens: intEnv('SPARK_ASSISTANT_MAX_OUTPUT_TOKENS', 700, MIN_OUTPUT_TOKENS, 4000),
    timeoutMs: intEnv('SPARK_ASSISTANT_TIMEOUT_MS', 15000, 1000, 60000),
    rateLimitPerMinute: intEnv('SPARK_ASSISTANT_RATE_LIMIT_PER_MINUTE', 6, 1, 120),
    liveRoles: parseLiveRoles(process.env.SPARK_ASSISTANT_LIVE_ROLES),
    studentPolicy: process.env.SPARK_ASSISTANT_STUDENT_POLICY === 'minor_safe_v1' ? 'minor_safe_v1' : null,
    // Model and API base are code constants. No environment variable or request field can change them.
    apiBase: ASSISTANT_API_BASE,
    model: ASSISTANT_MODEL,
  };
}

/** The only accessor for the secret. Server-side adapter use only. */
export function getProviderApiKey(): string | null {
  const key = process.env.META_MODEL_API_KEY?.trim();
  return key ? key : null;
}

export function estimateCostUsd(promptTokens: number, completionTokens: number): number {
  return (
    (Math.max(0, promptTokens) * PRICE_PER_MILLION_USD.input +
      Math.max(0, completionTokens) * PRICE_PER_MILLION_USD.output) /
    1_000_000
  );
}

/** ~4 chars per token, rounded up (conservative). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
