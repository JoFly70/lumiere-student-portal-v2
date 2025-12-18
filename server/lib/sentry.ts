import type * as Sentry from '@sentry/node';
import { logger } from './logger';

let SentrySDK: typeof Sentry | null = null;
let nodeProfilingIntegration: any = null;

// Try to import Sentry (optional dependency)
try {
  SentrySDK = await import('@sentry/node');
  const profiling = await import('@sentry/profiling-node');
  nodeProfilingIntegration = profiling.nodeProfilingIntegration;
} catch (error) {
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
    beforeSend(event, hint) {
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

export const Sentry = SentrySDK || {
  Handlers: {
    requestHandler: () => (req: any, res: any, next: any) => next(),
    tracingHandler: () => (req: any, res: any, next: any) => next(),
    errorHandler: () => (err: any, req: any, res: any, next: any) => next(err),
  },
  captureException: () => {},
};
export const isSentryConfigured = Boolean(SentrySDK && dsn);
