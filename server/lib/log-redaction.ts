/**
 * Log / error-report hygiene (S22). Pure functions, no I/O.
 *
 * Strips credentials, signed storage URLs and assistant/file content from
 * anything that is logged or sent to an error tracker. Deliberately keeps
 * integrity-checkpoint fields (`hash`, `seq`, `conversationId`).
 */

export const REDACTED = '[redacted]';

export const SENSITIVE_LOG_KEY =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-csrf-token|x-api-key|apikey|password|passwd|secret|access_token|refresh_token|id_token|token|token_hash|signedurl|signed_url|signedurls|uploadurl|upload_url|downloadurl|download_url|service_key|supabase_service_key|prompt|messages|reply|filecontent|file_content|fileContent|extractedtext|extracted_text|body|rawbody)$/i;

const QUERY_SECRET =
  /([?&#](?:access_token|refresh_token|token|token_hash|code|apikey|signature|sig|x-amz-signature)=)[^&\s"'#]+/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/=-]{8,}/gi;
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const SIGNED_STORAGE = /(\/storage\/v1\/object\/(?:sign|upload\/sign)\/[^?\s"']*)\?[^\s"']*/gi;

export function redactString(text: string): string {
  return text
    .replace(SIGNED_STORAGE, '$1?token=***')
    .replace(QUERY_SECRET, '$1***')
    .replace(BEARER, 'Bearer ***')
    .replace(JWT, '<jwt>');
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6) return REDACTED;
  if (value instanceof Error) {
    const out: Record<string, unknown> = { name: value.name, message: redactString(value.message) };
    if (value.stack) out.stack = redactString(value.stack);
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_LOG_KEY.test(k) ? REDACTED : redactValue(v, depth + 1);
  }
  return out;
}

/** Request facts that are safe to attach to an error report (no headers, no query string, no body). */
export function safeRequestContext(req: { method?: string; path?: string; ip?: string }) {
  return { method: req.method, path: req.path, ip: req.ip };
}

/** Sentry `beforeSend`: drop health probes, scrub credentials and request payloads. */
export function scrubSentryEvent<T extends Record<string, any>>(event: T): T | null {
  const url: string | undefined = event.request?.url;
  if (url && (url.includes('/health') || url.includes('/live') || url.includes('/ready'))) return null;
  const clean: Record<string, any> = redactValue(event) as Record<string, any>;
  if (clean.request) {
    delete clean.request.cookies;
    delete clean.request.headers;
    delete clean.request.data;
    delete clean.request.query_string;
    if (typeof clean.request.url === 'string') clean.request.url = clean.request.url.split('?')[0];
  }
  return clean as T;
}
