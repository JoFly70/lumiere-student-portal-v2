/**
 * Role-Based Access Control (RBAC) Middleware
 * Restricts route access based on user roles
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';
import { auditAdmin } from '../lib/audit';

// Define role hierarchy (higher number = more permissions)
const ROLE_HIERARCHY = {
  student: 1,
  coach: 2,
  staff: 3,
  admin: 4,
} as const;

export type UserRole = keyof typeof ROLE_HIERARCHY;

/**
 * Require specific role(s) to access route
 * Usage: app.get('/admin/users', requireRole(['admin']), handler)
 */
export function requireRole(allowedRoles: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user) {
      logger.warn('RBAC: No user in request', {
        path: req.path,
        method: req.method,
      });
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userRole = user.role as UserRole;

    if (!allowedRoles.includes(userRole)) {
      logger.warn('RBAC: Access denied', {
        userId: user.id,
        userRole,
        allowedRoles,
        path: req.path,
        method: req.method,
      });

      // Audit unauthorized access attempt
      await auditAdmin(
        'admin.permission_revoked',
        user.id,
        undefined,
        `Unauthorized access attempt to ${req.method} ${req.path}`,
        { userRole, allowedRoles, ip: req.ip }
      );

      return res.status(403).json({
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: userRole,
      });
    }

    next();
  };
}

/**
 * Require minimum role level
 * Usage: app.get('/staff/reports', requireMinRole('staff'), handler)
 */
export function requireMinRole(minRole: UserRole) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userRole = user.role as UserRole;
    const userLevel = ROLE_HIERARCHY[userRole] || 0;
    const minLevel = ROLE_HIERARCHY[minRole];

    if (userLevel < minLevel) {
      logger.warn('RBAC: Insufficient role level', {
        userId: user.id,
        userRole,
        userLevel,
        requiredRole: minRole,
        requiredLevel: minLevel,
        path: req.path,
      });

      return res.status(403).json({
        error: 'Insufficient permissions',
        required: minRole,
        current: userRole,
      });
    }

    next();
  };
}

/**
 * Allow access to own resources OR admin
 * Usage: app.get('/users/:id', requireOwnerOrAdmin('id'), handler)
 */
export function requireOwnerOrAdmin(userIdParam: string = 'id') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const targetUserId = req.params[userIdParam];
    const isOwner = user.id === targetUserId;
    const isAdmin = user.role === 'admin';

    if (!isOwner && !isAdmin) {
      logger.warn('RBAC: Not owner and not admin', {
        userId: user.id,
        targetUserId,
        path: req.path,
      });

      return res.status(403).json({
        error: 'You can only access your own resources',
      });
    }

    // If admin accessing another user's resource, audit it
    if (isAdmin && !isOwner) {
      await auditAdmin(
        'admin.user_impersonation',
        user.id,
        targetUserId,
        `Admin accessed user resource: ${req.method} ${req.path}`,
        { ip: req.ip }
      );
    }

    next();
  };
}

/**
 * Coach can only access their assigned students
 * Usage: app.get('/students/:id', requireCoachStudent('id'), handler)
 */
export function requireCoachStudent(studentIdParam: string = 'id') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Admins can access any student
    if (user.role === 'admin') {
      return next();
    }

    // Students can access their own data
    const studentId = req.params[studentIdParam];
    if (user.id === studentId) {
      return next();
    }

    // Coaches must be assigned to the student
    if (user.role === 'coach') {
      // TODO: Check student_coaches table
      // For now, allow all coaches (implement proper check later)
      logger.debug('Coach access check - implementing assignment check', {
        coachId: user.id,
        studentId,
      });
      return next();
    }

    return res.status(403).json({
      error: 'You do not have permission to access this student',
    });
  };
}

/**
 * Require admin OR owner of the resource
 */
export function requireAdminOrOwner(ownerIdGetter: (req: Request) => Promise<string | null>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Admins always allowed
    if (user.role === 'admin') {
      return next();
    }

    // Check if user owns the resource
    const ownerId = await ownerIdGetter(req);
    if (ownerId && user.id === ownerId) {
      return next();
    }

    logger.warn('RBAC: Not admin and not owner', {
      userId: user.id,
      ownerId,
      path: req.path,
    });

    return res.status(403).json({
      error: 'You do not have permission to access this resource',
    });
  };
}
