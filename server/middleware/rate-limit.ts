/**
 * Rate Limiting Middleware
 * Protects endpoints from brute force and DDoS attacks
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { rateLimitConfig } from '../config/production';
import { logger } from '../lib/logger';
import { createRateLimitStore } from '../lib/rate-limit-store';
import { redactFeedPath } from '../lib/log-redaction';

/**
 * Aggressive rate limiting for authentication endpoints
 * - 5 attempts per 15 minutes per IP
 * - Prevents brute force password attacks
 */
export const authRateLimit = rateLimit({
  store: createRateLimitStore('rl:auth:'),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded', {
      ip: req.ip,
      path: redactFeedPath(req.path),
      method: req.method,
    });
    res.status(429).json({
      error: 'Too many authentication attempts. Please try again in 15 minutes.',
    });
  },
  skip: (req) => {
    // Skip rate limiting in test environment
    return process.env.NODE_ENV === 'test';
  },
});

/**
 * Rate limiting for password reset requests
 * - 3 attempts per hour per IP
 * - Prevents email enumeration attacks
 */
export const passwordResetRateLimit = rateLimit({
  store: createRateLimitStore('rl:password-reset:'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per window
  message: { error: 'Too many password reset requests. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Password reset rate limit exceeded', {
      ip: req.ip,
      email: req.body?.email,
    });
    res.status(429).json({
      error: 'Too many password reset requests. Please try again in an hour.',
    });
  },
  skip: (req) => {
    return process.env.NODE_ENV === 'test';
  },
});

/**
 * Rate limiting for password changes after recovery
 * - 5 attempts per 15 minutes per IP
 */
export const passwordUpdateRateLimit = rateLimit({
  store: createRateLimitStore('rl:password-update:'),
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many password update attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many password update attempts. Please try again later.',
    });
  },
  skip: (req) => process.env.NODE_ENV === 'test',
});

/**
 * Strict rate limiting for document uploads
 * - 10 uploads per hour per IP
 * - Prevents storage abuse
 */
export const uploadRateLimit = rateLimit({
  store: createRateLimitStore('rl:upload:'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 uploads per window
  message: { error: 'Too many file uploads. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Upload rate limit exceeded', {
      ip: req.ip,
      userId: (req as any).user?.id,
    });
    res.status(429).json({
      error: 'Too many file uploads. Please try again in an hour.',
    });
  },
  skip: (req) => {
    return process.env.NODE_ENV === 'test';
  },
});

/**
 * Very strict rate limiting for signup
 * - 3 signups per hour per IP
 * - Prevents automated account creation
 */
export const signupRateLimit = rateLimit({
  store: createRateLimitStore('rl:signup:'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 signups per window
  message: { error: 'Too many signup attempts. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Signup rate limit exceeded', {
      ip: req.ip,
      email: req.body?.email,
    });
    res.status(429).json({
      error: 'Too many signup attempts. Please try again in an hour.',
    });
  },
  skip: (req) => {
    return process.env.NODE_ENV === 'test';
  },
});

// ---------------------------------------------------------------------------
// S34 (S33-02): general / per-user / login / refresh limiters
// ---------------------------------------------------------------------------

export const RATE_LIMITED_CODE = 'rate_limited';
const RATE_LIMITED_MESSAGE = 'Too many requests. Please wait a minute and try again.';

/** Clean, stable 429 body: { error, code: 'rate_limited', retryAfter (seconds) } plus a Retry-After header. */
function rateLimitedHandler(scope: string, logContext: (req: Request) => Record<string, unknown>) {
  return (req: Request, res: Response) => {
    const resetTime = (req as any).rateLimit?.resetTime as Date | undefined;
    const retryAfter = resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : 60;
    logger.warn('Rate limit exceeded', { scope, path: redactFeedPath(req.path), method: req.method, ...logContext(req) });
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: RATE_LIMITED_MESSAGE, code: RATE_LIMITED_CODE, scope, retryAfter });
  };
}

const skipInTest = () => process.env.NODE_ENV === 'test';

export interface LimiterOverrides {
  /** Tests only: replaces the default NODE_ENV==='test' skip so limiters can be exercised. */
  skip?: (req: Request) => boolean;
  max?: number;
  windowMs?: number;
  store?: ReturnType<typeof createRateLimitStore>;
}

/**
 * The ONE general /api limiter. Keyed by client IP (req.ip; `trust proxy` is 1 hop, so this is the address the
 * platform proxy saw, not a client-supplied header). Runs before authentication, so it is only a flood ceiling.
 */
export function createIpCeilingLimiter(o: LimiterOverrides = {}): RequestHandler {
  const cfg = rateLimitConfig.ipCeiling;
  return rateLimit({
    store: o.store ?? createRateLimitStore('rl:ip-ceiling:'),
    windowMs: o.windowMs ?? cfg.windowMs,
    max: o.max ?? cfg.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitedHandler('ip', (req) => ({ ip: req.ip })),
    skip: o.skip ?? skipInTest,
  });
}
export const ipCeilingRateLimit = createIpCeilingLimiter();

/** Key for per-user limiters: the id set by requireAuth ONLY. Never read from headers, body or query. */
export function verifiedUserKey(req: Request): string {
  const id = req.user?.id;
  // Unreachable when mounted after requireAuth; fall back to a shared bucket rather than trusting anything else.
  return id ? `user:${id}` : `anon:${ipKeyGenerator(req.ip ?? '')}`;
}

export function createUserLimiter(prefix: string, base: { max: number; windowMs: number }, scope: string, o: LimiterOverrides = {}): RequestHandler {
  return rateLimit({
    store: o.store ?? createRateLimitStore(prefix),
    windowMs: o.windowMs ?? base.windowMs,
    max: o.max ?? base.max,
    keyGenerator: verifiedUserKey,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitedHandler(scope, (req) => ({ userId: req.user?.id })),
    skip: o.skip ?? skipInTest,
  });
}

export function createLoginLimiter(o: LimiterOverrides = {}): RequestHandler {
  return rateLimit({
    store: o.store ?? createRateLimitStore('rl:login:'),
    windowMs: o.windowMs ?? rateLimitConfig.login.windowMs,
    max: o.max ?? rateLimitConfig.login.max,
    // Brute-force guard: only failed attempts (status >= 400) consume the budget.
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitedHandler('login', (req) => ({ ip: req.ip })),
    skip: o.skip ?? skipInTest,
  });
}

export function createRefreshLimiter(o: LimiterOverrides = {}): RequestHandler {
  return rateLimit({
    store: o.store ?? createRateLimitStore('rl:refresh:'),
    windowMs: o.windowMs ?? rateLimitConfig.refresh.windowMs,
    max: o.max ?? rateLimitConfig.refresh.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitedHandler('refresh', (req) => ({ ip: req.ip })),
    skip: o.skip ?? skipInTest,
  });
}

export const loginRateLimit = createLoginLimiter();
export const refreshRateLimit = createRefreshLimiter();
const userLimiter = createUserLimiter('rl:user:', rateLimitConfig.user, 'user');
const adminUserLimiter = createUserLimiter('rl:admin-user:', rateLimitConfig.adminUser, 'admin-user');

/** Builds the post-auth chain (exported for tests). Counts a request at most once, even if requireAuth runs twice. */
export function createPostAuthRateLimit(general: RequestHandler, admin: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const flagged = req as Request & { __userRateCounted?: boolean };
    if (flagged.__userRateCounted) return next();
    flagged.__userRateCounted = true;
    general(req, res, (err?: unknown) => {
      if (err) return next(err);
      if ((req.originalUrl ?? req.url ?? '').startsWith('/api/admin')) return admin(req, res, next);
      next();
    });
  };
}

/** Called by requireAuth right after it has set req.user from a verified token. */
export const postAuthRateLimit = createPostAuthRateLimit(userLimiter, adminUserLimiter);

/**
 * Promise form for requireAuth: resolves true when the request may continue, false when a response
 * (the 429) was already sent. Errors are passed on as a rejection.
 */
export function enforceUserRateLimit(req: Request, res: Response): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    if (typeof res.once === 'function') res.once('close', () => resolve(false));
    postAuthRateLimit(req, res, (err?: unknown) => (err ? reject(err) : resolve(true)));
  });
}
