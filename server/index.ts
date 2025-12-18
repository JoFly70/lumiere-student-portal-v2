import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { registerHealthRoutes } from "./routes/health";
import { registerWebhookRoutes } from "./routes/webhooks";
import { setupVite, serveStatic, log } from "./vite";
import {
  helmetConfig,
  corsConfig,
  rateLimitConfig,
  compressionConfig,
} from "./config/production";
import { logger, logStartup, generateRequestId } from "./lib/logger";

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

// Dynamically import Sentry (optional dependency)
let Sentry: any = null;
let isSentryConfigured = false;
try {
  const sentryModule = await import('./lib/sentry');
  Sentry = sentryModule.Sentry;
  isSentryConfigured = sentryModule.isSentryConfigured;
  
  // Sentry request handler (must be first!)
  if (isSentryConfigured) {
    app.use(Sentry.Handlers.requestHandler());
    app.use(Sentry.Handlers.tracingHandler());
  }
} catch (error) {
  logger.warn('⚠️  Sentry not available (optional dependency)');
}

// Trust proxy (required for Replit deployments)
app.set('trust proxy', 1);

// Security middleware (Helmet)
if (isProduction) {
  app.use(helmet(helmetConfig));
} else {
  // Relaxed CSP for development
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
}

// CORS configuration
app.use(cors(corsConfig));

// Compression (streaming gzip/deflate)
// Note: Brotli compression typically handled at CDN layer (Cloudflare, Fastly, etc.)
app.use(compression(compressionConfig));

// Initialize Redis client for rate limiting (if configured)
let redisStore: any = undefined;
const redisUrl = process.env.REDIS_URL;

if (redisUrl && isProduction) {
  // Dynamically import Redis (optional dependency)
  try {
    const { default: RedisStoreClass } = await import('rate-limit-redis');
    const { createClient } = await import('redis');

    const redisClient = createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          // Exponential backoff: 50ms, 100ms, 200ms, ..., up to 3 seconds
          const delay = Math.min(50 * Math.pow(2, retries), 3000);
          logger.warn(`Redis reconnecting (attempt ${retries + 1})...`, { delay });
          return delay;
        },
        connectTimeout: 5000,
      },
    });

    // Redis connection event handlers with comprehensive monitoring
    let connectionState = 'disconnected';
    let failureCount = 0;
    const MAX_FAILURES = 10;

    redisClient.on('error', (err) => {
      failureCount++;
      logger.error('Redis connection error', {
        error: err.message,
        stack: err.stack,
        failureCount,
        connectionState,
      });

      // Alert if failures exceed threshold
      if (failureCount >= MAX_FAILURES) {
        logger.error('CRITICAL: Redis failure threshold exceeded', {
          failureCount,
          maxFailures: MAX_FAILURES,
          message: 'Rate limiting may be degraded. Consider manual intervention.',
        });

        // Send to Sentry if configured
        if (isSentryConfigured && Sentry) {
          Sentry.captureException(new Error('Redis failure threshold exceeded'), {
            level: 'fatal',
            tags: {
              component: 'redis',
              failure_count: failureCount,
            },
          });
        }
      }
    });

    redisClient.on('connect', () => {
      connectionState = 'connected';
      failureCount = 0; // Reset failure count on successful connection
      logger.info('✓ Redis connected for rate limiting', { connectionState });
    });

    redisClient.on('ready', () => {
      connectionState = 'ready';
      logger.info('✓ Redis ready', { connectionState });
    });

    redisClient.on('reconnecting', () => {
      connectionState = 'reconnecting';
      logger.warn('Redis reconnecting...', { connectionState, failureCount });
    });

    redisClient.on('end', () => {
      connectionState = 'disconnected';
      logger.warn('Redis connection ended', { connectionState });
    });

    // Attempt initial connection with timeout
    try {
      await Promise.race([
        redisClient.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Redis connection timeout')), 10000)
        ),
      ]);
    } catch (connectError) {
      logger.error('Failed to establish initial Redis connection', {
        error: connectError instanceof Error ? connectError.message : String(connectError),
      });
      throw connectError;
    }

    redisStore = new RedisStoreClass({
      // @ts-expect-error - RedisStore types are outdated
      client: redisClient,
      prefix: 'rl:',
    });

    // Periodic health check
    setInterval(async () => {
      try {
        await redisClient.ping();
        logger.debug('Redis health check: OK');
      } catch (pingError) {
        logger.error('Redis health check failed', {
          error: pingError instanceof Error ? pingError.message : String(pingError),
        });
      }
    }, 60000); // Check every 60 seconds

  } catch (error) {
    logger.error('⚠️  Redis initialization failed. Falling back to in-memory rate limiting.', {
      error: error instanceof Error ? error.message : String(error),
    });
    logger.warn('   In-memory rate limiting is NOT suitable for multi-instance deployments.');

    // Alert for production failures
    if (isSentryConfigured && Sentry) {
      Sentry.captureException(error, {
        level: 'error',
        tags: {
          component: 'redis',
          fallback: 'in-memory',
        },
      });
    }
  }
} else {
  if (isProduction && !redisUrl) {
    logger.warn('⚠️  REDIS_URL not set in production. Using in-memory rate limiting.');
    logger.warn('   For production with multiple instances, configure Redis.');

    // Alert that Redis is not configured in production
    if (isSentryConfigured && Sentry) {
      Sentry.captureMessage('Redis not configured in production', {
        level: 'warning',
        tags: {
          component: 'redis',
          issue: 'not-configured',
        },
      });
    }
  }
}

// Rate limiting configuration with Redis (if available)
const createLimiter = (config: typeof rateLimitConfig.api) => {
  return rateLimit({
    ...config,
    ...(redisStore ? { store: redisStore } : {}),
  });
};

const apiLimiter = createLimiter(rateLimitConfig.api);
const adminLimiter = createLimiter(rateLimitConfig.admin);
const authLimiter = createLimiter(rateLimitConfig.auth);

// Webhook routes MUST come before body parsing AND rate limiting
declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}

// Register webhook routes (requires raw body, no rate limiting)
registerWebhookRoutes(app);

// Apply rate limits AFTER webhooks (webhooks excluded - Stripe handles their own rate limiting)
app.use('/api/admin', adminLimiter);
app.use('/api/auth', authLimiter);
// API limiter must be last (after more specific routes)
app.use('/api', apiLimiter);

// Body parsing middleware
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = generateRequestId();
  const path = req.path;

  // Add request ID to headers for tracing
  res.setHeader('X-Request-ID', requestId);

  res.on("finish", () => {
    const duration = Date.now() - start;
    
    // Log all requests in production, only API requests in dev
    if (isProduction || path.startsWith("/api")) {
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger.log(level, `${req.method} ${path} ${res.statusCode}`, {
        method: req.method,
        path,
        statusCode: res.statusCode,
        duration,
        requestId,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
    }
  });

  next();
});

(async () => {
  // Register health check routes
  registerHealthRoutes(app);

  // Register application routes
  const server = await registerRoutes(app);

  // Sentry error handler (must be after routes, before other error handlers)
  if (isSentryConfigured) {
    app.use(Sentry.Handlers.errorHandler());
  }

  // Global error handler
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Log error with full context
    logger.error('Request error', {
      error: {
        name: err.name,
        message: err.message,
        stack: isProduction ? undefined : err.stack,
      },
      request: {
        method: req.method,
        path: req.path,
        ip: req.ip,
      },
      statusCode: status,
    });

    // Send error to Sentry (if not already sent by Sentry middleware)
    if (isSentryConfigured && status >= 500) {
      Sentry.captureException(err, {
        contexts: {
          request: {
            method: req.method,
            url: req.url,
            headers: req.headers,
          },
        },
      });
    }

    // Don't expose error details in production
    if (isProduction) {
      res.status(status).json({
        error: status >= 500 ? 'Internal Server Error' : message,
      });
    } else {
      res.status(status).json({
        error: message,
        stack: err.stack,
      });
    }
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    logStartup(port);
    log(`serving on port ${port}`);
    
    if (isProduction) {
      logger.info('Production mode enabled', {
        features: [
          'Security headers (Helmet with strict CSP)',
          'CORS protection',
          `Rate limiting${redisStore ? ' (Redis-backed)' : ' (in-memory)'}`,
          'Gzip/Deflate compression (streaming)',
          'Structured logging (Winston)',
          'Health checks (/health, /ready, /live)',
          'Stripe webhooks (signature verified)',
          isSentryConfigured ? 'Sentry error tracking' : 'Sentry not configured',
        ],
      });
    }
  });
})();
