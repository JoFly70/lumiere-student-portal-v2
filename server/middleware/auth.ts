/**
 * Authentication and Authorization Middleware
 */

import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { db } from '../lib/db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';

// Local JWT secret (must match routes.ts)
const LOCAL_JWT_SECRET = process.env.SESSION_SECRET || 'local-dev-secret-change-in-production';

// Helper to verify local JWT
function verifyLocalJWT(token: string): { userId: string; email: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    
    // Verify signature
    const expectedSignature = crypto.createHmac('sha256', LOCAL_JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');
    
    if (signature !== expectedSignature) {
      logger.debug('Local JWT signature mismatch');
      return null;
    }

    // Decode payload
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    
    // Check expiration
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      logger.debug('Local JWT expired');
      return null;
    }

    // Check issuer
    if (decoded.iss !== 'lumiere-local') {
      return null;
    }

    return { userId: decoded.userId, email: decoded.email };
  } catch (error) {
    logger.debug('Local JWT verification failed', { error });
    return null;
  }
}

// Extend Express Request to include user and audit context
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
      };
      audit?: {
        actorId: string | null;
      };
    }
  }
}

/**
 * Verify JWT token and attach user to request
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    const allowDemoMode = process.env.ALLOW_DEMO_MODE === 'true';

    // Demo mode ONLY if no auth header is present
    if (allowDemoMode && (!authHeader || !authHeader.startsWith('Bearer '))) {
      logger.info('Auth middleware: Using demo mode (no auth token provided)');
      req.user = {
        id: 'fcad952c-adb6-45fb-8ea8-9ee1356a80dd', // Demo user ID from users/students table
        email: 'demo@student.lumiere.app',
        role: 'student',
      };
      req.audit = {
        actorId: req.user.id,
      };
      return next();
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // First try local JWT verification (faster, no network call)
    const localAuth = verifyLocalJWT(token);
    if (localAuth) {
      logger.debug('Auth user from local JWT', { 
        userId: localAuth.userId, 
        email: localAuth.email 
      });

      // Fetch user from local database
      const userData = await db.select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, localAuth.userId))
      .limit(1);

      if (userData.length > 0) {
        req.user = {
          id: userData[0].id,
          email: userData[0].email,
          role: userData[0].role,
        };
        req.audit = { actorId: userData[0].id };
        return next();
      }
    }

    // Try Supabase verification
    try {
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

      if (error || !user) {
        logger.warn('Invalid auth token', { error: error?.message });
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      logger.debug('Auth user from JWT', { 
        userId: user.id, 
        userIdType: typeof user.id, 
        userIdLength: user.id?.length,
        email: user.email 
      });

      // Fetch user from local database (not Supabase)
      logger.debug('Querying users table', { userId: user.id, query: 'select id, email, name, role' });
      let userData = await db.select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

      logger.debug('Query result', { userId: user.id, found: userData.length > 0 });

      // Auto-create user if doesn't exist
      if (userData.length === 0) {
        logger.info('Creating new user in local database', { userId: user.id, email: user.email });
        
        const newUser = await db.insert(users).values({
          id: user.id,
          email: user.email || '',
          name: user.user_metadata?.name || user.email?.split('@')[0] || 'User',
          role: 'student', // Default role
        }).returning();

        userData = newUser;
        logger.info('User created successfully', { userId: user.id });
      }

      // Attach user to request
      req.user = {
        id: userData[0].id,
        email: userData[0].email,
        role: userData[0].role,
      };

      // Attach audit context
      req.audit = {
        actorId: userData[0].id,
      };

      next();
    } catch (supabaseError) {
      logger.warn('Supabase auth failed', { error: supabaseError });
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
  } catch (error) {
    logger.error('Auth middleware error', { error });
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Require specific role(s)
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn('Insufficient permissions', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles: allowedRoles,
      });
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: req.user.role,
      });
    }

    next();
  };
}

/**
 * Require admin role
 */
export const requireAdmin = requireRole('admin');

/**
 * Require staff role (admin, coach, or staff)
 */
export const requireStaff = requireRole('admin', 'coach', 'staff');

/**
 * Optional auth - attach user if token provided, but don't fail if missing
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No auth provided - continue without user
      return next();
    }

    const token = authHeader.substring(7);

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (!error && user) {
      // Query local database instead of Supabase
      let userData = await db.select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

      // Auto-create user if doesn't exist
      if (userData.length === 0) {
        logger.info('Creating new user in local database (optionalAuth)', { userId: user.id, email: user.email });
        
        const newUser = await db.insert(users).values({
          id: user.id,
          email: user.email || '',
          name: user.user_metadata?.name || user.email?.split('@')[0] || 'User',
          role: 'student',
        }).returning();

        userData = newUser;
      }

      if (userData.length > 0) {
        req.user = {
          id: userData[0].id,
          email: userData[0].email,
          role: userData[0].role,
        };
        
        // Attach audit context
        req.audit = {
          actorId: userData[0].id,
        };
      }
    }

    next();
  } catch (error) {
    // Don't fail on optional auth errors
    logger.debug('Optional auth failed', { error });
    next();
  }
}
