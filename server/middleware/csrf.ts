/**
 * CSRF Protection Middleware
 * Protects against Cross-Site Request Forgery attacks
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

// Stateless, HMAC-signed tokens: any instance holding SESSION_SECRET can verify a
// token minted by another, so the check works on multi-instance Autoscale without a
// shared store. Format: <expiresMs>.<nonce>.<hmac(userId|expiresMs|nonce)>.
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Without SESSION_SECRET fall back to a per-process random key (never a known
// default): tokens then only verify on the instance that issued them.
const csrfSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  logger.warn('SESSION_SECRET unset: CSRF tokens are per-instance only');
}

// Best-effort logout revocation on this instance (the Supabase session is revoked
// as well, so a stolen token is useless without a live bearer token).
const revokedTokens = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [key, expires] of revokedTokens.entries()) {
    if (expires < now) revokedTokens.delete(key);
  }
}, 5 * 60 * 1000).unref();

function sign(userId: string, expires: number, nonce: string): string {
  return crypto.createHmac('sha256', csrfSecret).update(`${userId}|${expires}|${nonce}`).digest('base64url');
}

/**
 * Generate a CSRF token for a user session
 */
export function generateCsrfToken(userId: string): string {
  const expires = Date.now() + TOKEN_TTL_MS;
  const nonce = crypto.randomBytes(16).toString('base64url');
  return `${expires}.${nonce}.${sign(userId, expires, nonce)}`;
}

/**
 * Verify a CSRF token
 */
export function verifyCsrfToken(userId: string, token: string): boolean {
  if (!userId || !token || typeof token !== 'string') {
    return false;
  }

  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expiresText, nonce, mac] = parts;
  const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires < Date.now()) return false;

  const expected = Buffer.from(sign(userId, expires, nonce));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return false;
  }
  return !revokedTokens.has(`${userId}:${token}`);
}

/**
 * Revoke a CSRF token (for logout)
 */
export function deleteCsrfToken(userId: string, token: string): void {
  const expires = Number(token.split('.')[0]);
  if (Number.isSafeInteger(expires) && expires > Date.now()) {
    revokedTokens.set(`${userId}:${token}`, expires);
  }
}

/**
 * Middleware to require CSRF token on state-changing requests
 *
 * Usage:
 *   app.post('/api/data', requireCsrf, handler);
 */
export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  // Only check CSRF on state-changing methods
  const stateMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
  if (!stateMethods.includes(req.method)) {
    return next();
  }

  // Extract user ID from request (set by auth middleware)
  const user = (req as any).user;
  if (!user || !user.id) {
    logger.warn('CSRF check failed: No user in request', {
      method: req.method,
      path: req.path,
    });
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Get CSRF token from header (preferred) or body
  const csrfToken = req.headers['x-csrf-token'] as string || req.body._csrf;

  if (!csrfToken) {
    logger.warn('CSRF check failed: Missing token', {
      method: req.method,
      path: req.path,
      userId: user.id,
    });
    return res.status(403).json({
      error: 'CSRF token required',
      code: 'CSRF_TOKEN_MISSING',
    });
  }

  // Verify token
  if (!verifyCsrfToken(user.id, csrfToken)) {
    logger.warn('CSRF check failed: Invalid token', {
      method: req.method,
      path: req.path,
      userId: user.id,
    });
    return res.status(403).json({
      error: 'Invalid or expired CSRF token',
      code: 'CSRF_TOKEN_INVALID',
    });
  }

  // Token is valid, proceed
  next();
}

/**
 * Middleware to generate and attach CSRF token to authenticated requests
 *
 * Usage:
 *   app.get('/api/csrf-token', attachCsrfToken, handler);
 */
export function attachCsrfToken(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;

  if (user && user.id) {
    const token = generateCsrfToken(user.id);
    (req as any).csrfToken = token;
    res.setHeader('X-CSRF-Token', token);
  }

  next();
}

/**
 * Conditional CSRF middleware that only requires CSRF for authenticated requests
 * This is useful for endpoints that support both public and authenticated access
 */
export function csrfIfAuthenticated(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;

  // If user is authenticated, require CSRF
  if (user && user.id) {
    return requireCsrf(req, res, next);
  }

  // Not authenticated, skip CSRF check
  next();
}
