/**
 * CSRF Protection Middleware
 * Protects against Cross-Site Request Forgery attacks
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

// Store CSRF tokens in memory (in production, use Redis or similar)
const csrfTokenStore = new Map<string, { token: string; expires: number }>();

// Clean up expired tokens every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of csrfTokenStore.entries()) {
    if (value.expires < now) {
      csrfTokenStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Generate a CSRF token for a user session
 */
export function generateCsrfToken(userId: string): string {
  // Generate cryptographically secure random token
  const token = crypto.randomBytes(32).toString('base64url');

  // Store token with 1-hour expiry
  const expires = Date.now() + 60 * 60 * 1000; // 1 hour
  csrfTokenStore.set(`${userId}:${token}`, { token, expires });

  return token;
}

/**
 * Verify a CSRF token
 */
export function verifyCsrfToken(userId: string, token: string): boolean {
  if (!userId || !token) {
    return false;
  }

  const key = `${userId}:${token}`;
  const stored = csrfTokenStore.get(key);

  if (!stored) {
    return false;
  }

  // Check if token is expired
  if (stored.expires < Date.now()) {
    csrfTokenStore.delete(key);
    return false;
  }

  return stored.token === token;
}

/**
 * Delete a CSRF token (for logout)
 */
export function deleteCsrfToken(userId: string, token: string): void {
  const key = `${userId}:${token}`;
  csrfTokenStore.delete(key);
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
