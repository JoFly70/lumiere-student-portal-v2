import winston from 'winston';
import { redactValue, redactString, redactFeedPath, SENSITIVE_LOG_KEY, REDACTED } from './log-redaction';

// Defense in depth: every log record passes through redaction before output.
const redactFormat = winston.format((info) => {
  // Mutate in place: winston keeps LEVEL/MESSAGE/SPLAT on symbol keys that must survive.
  for (const key of Object.keys(info)) {
    if (key === 'level') continue;
    (info as any)[key] = key === 'message' && typeof info.message === 'string'
      ? redactString(info.message)
      : SENSITIVE_LOG_KEY.test(key) ? REDACTED : redactValue((info as any)[key]);
  }
  return info;
});

const isProduction = process.env.NODE_ENV === 'production';

// Custom format for development (pretty print)
const devFormat = winston.format.combine(
  redactFormat(),
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}] ${message} ${metaStr}`;
  })
);

// Production format (JSON for log aggregation)
const prodFormat = winston.format.combine(
  redactFormat(),
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
export const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: isProduction ? prodFormat : devFormat,
  defaultMeta: {
    service: 'lumiere-portal',
    env: process.env.NODE_ENV,
  },
  transports: [
    new winston.transports.Console(),
  ],
});

// ── S34 (S33-07): forward logger.error to the error tracker ─────────────────────────────────────────
// Sentry registers a reporter at init (setErrorReporter); with none registered this is a no-op. The logger never
// imports Sentry (no import cycle) and a failing reporter can never throw into request handling.

export type ErrorReporter = (error: Error, context: Record<string, string | number | boolean>) => void;

let errorReporter: ErrorReporter | null = null;
const reportedErrors = new WeakSet<object>();

export function setErrorReporter(reporter: ErrorReporter | null): void {
  errorReporter = reporter;
}

/** True once an Error object has been sent to the tracker (via logger.error), so other handlers can skip it. */
export function wasErrorReported(error: unknown): boolean {
  return typeof error === 'object' && error !== null && reportedErrors.has(error);
}

/** Small allowlist of non-sensitive structured context. Everything else (records, bodies, tokens) is dropped. */
const REPORT_CONTEXT_ALLOWLIST = ['method', 'path', 'statusCode', 'event', 'route', 'code', 'service'] as const;

function reportContext(meta: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!meta) return out;
  for (const key of REPORT_CONTEXT_ALLOWLIST) {
    const v = meta[key];
    if (typeof v === 'number' || typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'string') {
      let text = v;
      if (key === 'path') text = redactFeedPath(text.split('?')[0]);
      out[key] = redactString(text).slice(0, 200);
    }
  }
  return out;
}

function isErrorLike(v: unknown): v is { message: string; stack?: string; name?: string } {
  return typeof v === 'object' && v !== null && typeof (v as any).message === 'string';
}

function forwardToReporter(args: unknown[]): void {
  const reporter = errorReporter;
  if (!reporter) return;
  try {
    const message = typeof args[0] === 'string' ? args[0] : undefined;
    const meta = args.find((a, i) => i > 0 && typeof a === 'object' && a !== null && !(a instanceof Error)) as Record<string, unknown> | undefined;
    const candidate = args.find((a) => a instanceof Error)
      ?? (meta && (meta.error instanceof Error ? meta.error : meta.err instanceof Error ? meta.err : undefined));
    let error: Error;
    if (candidate instanceof Error) {
      if (reportedErrors.has(candidate)) return; // once per Error object
      reportedErrors.add(candidate);
      error = candidate;
    } else {
      // Only a message / plain error description was logged: report a redacted synthetic error.
      const plain = meta && [meta.error, meta.err].find(isErrorLike);
      const text = redactString([message, plain?.message].filter(Boolean).join(': ') || 'logger.error');
      error = new Error(text.slice(0, 500));
      if (plain?.stack) error.stack = redactString(plain.stack);
    }
    reporter(error, reportContext(meta));
  } catch {
    // monitoring failures must never reach request handling
  }
}

const originalError = logger.error.bind(logger);
(logger as any).error = (...args: unknown[]) => {
  forwardToReporter(args);
  return (originalError as (...a: unknown[]) => unknown)(...args);
};

// Request ID middleware helper
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

// Log HTTP requests
export function logRequest(method: string, path: string, statusCode: number, duration: number, meta?: any) {
  const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
  logger.log(level, `${method} ${path} ${statusCode}`, {
    method,
    path,
    statusCode,
    duration,
    ...meta,
  });
}

// Log errors with full context
export function logError(error: Error, context?: Record<string, any>) {
  logger.error(error.message, {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    ...context,
  });
}

// Log Supabase connection status
export function logSupabaseConnection(success: boolean, error?: Error) {
  if (success) {
    logger.info('✓ Supabase connected successfully');
  } else {
    logger.error('✗ Supabase connection failed', {
      error: error?.message,
      stack: error?.stack,
    });
  }
}

// Log startup information
export function logStartup(port: number) {
  logger.info(`🚀 Lumiere Portal starting on port ${port}`, {
    port,
    env: process.env.NODE_ENV,
    nodeVersion: process.version,
  });
}
