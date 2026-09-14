import { logger } from './logger';

/**
 * Sentry is an optional dependency. When @sentry/node and
 * @sentry/profiling-node are not installed we fall back to no-op stubs so the
 * application still type-checks and runs. The packages are loaded lazily via
 * dynamic import so their absence never breaks startup.
 */

// Minimal structural type for the subset of the Sentry SDK we use. This avoids
// importing the (possibly missing) @sentry/node types at compile time.
interface SentrySDKLike {
  init: (opts: Record<string, unknown>) => void;
  Handlers: {
    requestHandler: () => (req: unknown, res: unknown, next: () => void) => void;
    tracingHandler: () => (req: unknown, res: unknown, next: () => void) => void;
    errorHandler: () => (err: unknown, req: unknown, res: unknown, next: (err?: unknown) => void) => void;
  };
  captureException: (err: unknown) => void;
}

let SentrySDK: SentrySDKLike | null = null;
let nodeProfilingIntegration: (() => unknown) | null = null;

// Try to import Sentry (optional dependency)
try {
  // Use a non-literal module specifier and `any` typing so TypeScript does not
  // try to resolve the (optional, possibly uninstalled) @sentry packages at
  // compile time. The packages are loaded lazily; if they are missing the
  // catch branch leaves SentrySDK as null and the no-op fallback is used.
  const sentryModuleSpec: string = '@sentry/node';
  const profilingModuleSpec: string = '@sentry/profiling-node';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sentryModule: any = await import(sentryModuleSpec);
  SentrySDK = sentryModule as SentrySDKLike;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profiling: any = await import(profilingModuleSpec);
  nodeProfilingIntegration = profiling?.nodeProfilingIntegration ?? null;
} catch {
  logger.debug('Sentry packages not installed (optional)');
}

const dsn = process.env.SENTRY_DSN;
const environment = process.env.NODE_ENV || 'development';
const isProduction = environment === 'production';

// Initialize Sentry if SDK available and DSN is provided
if (SentrySDK && dsn) {
  SentrySDK.init({
    dsn,
    environment,
    integrations: nodeProfilingIntegration ? [nodeProfilingIntegration()] : [],
    // Performance Monitoring
    tracesSampleRate: isProduction ? 0.1 : 1.0, // 10% in prod, 100% in dev
    // Profiling
    profilesSampleRate: isProduction ? 0.1 : 1.0,
    // Filter out health check requests
    beforeSend(event: { request?: { url?: string } }) {
      const url = event.request?.url;
      if (url && (url.includes('/health') || url.includes('/live') || url.includes('/ready'))) {
        return null; // Don't send health check errors
      }
      return event;
    },
  });

  logger.info('✓ Sentry error tracking initialized', {
    environment,
    dsn: dsn.substring(0, 20) + '...',
  });
} else {
  if (!SentrySDK) {
    logger.debug('Sentry SDK not installed (optional dependency)');
  } else if (isProduction) {
    logger.warn('⚠️  SENTRY_DSN not set in production! Error tracking disabled.');
  } else {
    logger.debug('Sentry not configured (optional in development)');
  }
}

const noOpHandler = () => (_req: unknown, _res: unknown, next: () => void) => next();
const noOpErrorHandler = () => (err: unknown, _req: unknown, _res: unknown, next: (e?: unknown) => void) => next(err);

export const Sentry: SentrySDKLike = SentrySDK ?? ({
  Handlers: {
    requestHandler: noOpHandler,
    tracingHandler: noOpHandler,
    errorHandler: noOpErrorHandler,
  },
  captureException: () => {},
} as unknown as SentrySDKLike);
export const isSentryConfigured = Boolean(SentrySDK && dsn);
