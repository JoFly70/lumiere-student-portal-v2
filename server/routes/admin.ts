/**
 * Admin Dashboard API Routes
 * Comprehensive admin panel for managing users, students, enrollments, etc.
 */

import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { asyncHandler } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { auditAdmin } from '../lib/audit';
import { changeStudentStatus } from '../services/admin-student-status';
import { createInvitation, DEFAULT_INVITATION_TTL_HOURS, MAX_INVITATION_TTL_HOURS } from '../lib/invitations';

// Supabase Auth ban applied when an account is archived, so refresh tokens
// stop working in addition to the application-level status check.
const ARCHIVED_BAN_DURATION = '876000h';

const router = Router();

// All admin routes require authentication then admin role
router.use(requireAuth);
router.use(requireRole(['admin']));

// ==================== USER MANAGEMENT ====================

/**
 * GET /api/admin/users
 * List all users with filtering and pagination
 */
router.get('/users', asyncHandler(async (req: any, res) => {
  const {
    role,
    status,
    search,
    limit = 50,
    offset = 0,
  } = req.query;

  try {
    let query = supabaseAdmin
      .from('users')
      .select(`
        *,
        profiles(*)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (role) {
      query = query.eq('role', role);
    }

    if (search) {
      query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
    }

    const { data: users, error, count } = await query;

    if (error) {
      logger.error('Failed to fetch users', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch users' });
    }

    res.json({
      users,
      pagination: {
        total: count || 0,
        limit: Number(limit),
        offset: Number(offset),
      },
    });
  } catch (error: any) {
    logger.error('Error fetching users', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

/**
 * PATCH /api/admin/users/:id/role
 * Change user role
 */
router.patch('/users/:id/role', asyncHandler(async (req: any, res) => {
  const { id } = req.params;
  const { role } = req.body;
  const admin = req.user;

  if (!['student', 'coach', 'staff', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .update({ role })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update user role', { error: error.message });
      return res.status(500).json({ error: 'Failed to update user role' });
    }

    // Audit log
    await auditAdmin(
      'admin.role_changed',
      admin.id,
      id,
      `Changed user role to ${role}`,
      { oldRole: user.role, newRole: role }
    );

    logger.info('User role updated', { userId: id, newRole: role, adminId: admin.id });

    res.json({ user });
  } catch (error: any) {
    logger.error('Error updating user role', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

/**
 * DELETE /api/admin/users/:id
 * Delete user account (soft delete - changes status to archived)
 */
router.delete('/users/:id', asyncHandler(async (req: any, res) => {
  const { id } = req.params;
  const admin = req.user;

  // Prevent self-deletion
  if (id === admin.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  try {
    // Soft delete: update status instead of actual deletion
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ status: 'archived' })
      .eq('user_id', id);

    if (error) {
      logger.error('Failed to archive user', { error: error.message });
      return res.status(500).json({ error: 'Failed to archive user' });
    }

    // The status change above is authoritative (every auth path checks it);
    // the Supabase ban additionally invalidates existing refresh tokens.
    let sessionsRevoked = true;
    try {
      const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(id, {
        ban_duration: ARCHIVED_BAN_DURATION,
      });
      if (banError) {
        sessionsRevoked = false;
        logger.warn('Archived user but failed to revoke auth sessions', { userId: id, error: banError.message });
      }
    } catch (banError: any) {
      sessionsRevoked = false;
      logger.warn('Archived user but failed to revoke auth sessions', { userId: id, error: banError?.message });
    }

    // Audit log
    await auditAdmin(
      'admin.bulk_operation',
      admin.id,
      id,
      'Archived user account',
      { action: 'soft_delete', sessionsRevoked }
    );

    logger.info('User archived', { userId: id, adminId: admin.id, sessionsRevoked });

    res.json({ success: true, sessionsRevoked });
  } catch (error: any) {
    logger.error('Error archiving user', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// ==================== INVITATIONS ====================
// Account creation is invitation-only. Invitations are issued here by an
// admin; the token is returned once and is not emailed by the server
// (outbound communications are not enabled).

const createInvitationSchema = z.object({
  email: z.string().trim().email().max(320),
  expiresInHours: z.number().int().min(1).max(MAX_INVITATION_TTL_HOURS).optional(),
}).strict();

/**
 * POST /api/admin/invitations
 * Issue a single-use student invitation bound to one email address.
 */
router.post('/invitations', asyncHandler(async (req: any, res) => {
  const parsed = createInvitationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
  }
  const admin = req.user;
  try {
    const invitation = await createInvitation({
      email: parsed.data.email,
      createdBy: admin.id,
      ttlHours: parsed.data.expiresInHours ?? DEFAULT_INVITATION_TTL_HOURS,
    });
    await auditAdmin(
      'admin.permission_granted',
      admin.id,
      undefined,
      'Issued student account invitation',
      { invitationId: invitation.id, email: invitation.email, expiresAt: invitation.expiresAt },
    );
    res.status(201).json({
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      // Shown once; only its hash is stored.
      token: invitation.token,
    });
  } catch (error: any) {
    logger.error('Failed to create invitation', { error: error.message });
    res.status(500).json({ error: 'Failed to create invitation' });
  }
}));

/**
 * GET /api/admin/invitations
 * List invitations (never returns token hashes).
 */
router.get('/invitations', asyncHandler(async (_req: any, res) => {
  const { data, error } = await supabaseAdmin
    .from('account_invitations')
    .select('id, email, role, created_by, created_at, expires_at, consumed_at, consumed_by, revoked_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    logger.error('Failed to list invitations', { error: error.message });
    return res.status(500).json({ error: 'Failed to list invitations' });
  }
  res.json({ invitations: data ?? [] });
}));

/**
 * POST /api/admin/invitations/:id/revoke
 * Revoke an unused invitation.
 */
router.post('/invitations/:id/revoke', asyncHandler(async (req: any, res) => {
  const { id } = req.params;
  if (!z.string().uuid().safeParse(id).success) {
    return res.status(400).json({ error: 'Invalid invitation id' });
  }
  const { data, error } = await supabaseAdmin
    .from('account_invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('consumed_at', null)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();
  if (error) {
    logger.error('Failed to revoke invitation', { error: error.message });
    return res.status(500).json({ error: 'Failed to revoke invitation' });
  }
  if (!data) {
    return res.status(409).json({ error: 'Invitation not found, already used, or already revoked' });
  }
  await auditAdmin('admin.permission_revoked', req.user.id, undefined, 'Revoked student account invitation', { invitationId: id });
  res.json({ success: true });
}));

// ==================== STUDENT MANAGEMENT ====================

/**
 * GET /api/admin/students
 * List all students with detailed information
 */
router.get('/students', asyncHandler(async (req: any, res) => {
  const {
    status,
    residency,
    search,
    limit = 50,
    offset = 0,
  } = req.query;

  try {
    let query = supabaseAdmin
      .from('students')
      .select(`
        *,
        user:user_id(email, name, role)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (residency) {
      query = query.eq('residency', residency);
    }

    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,student_code.ilike.%${search}%`);
    }

    const { data: students, error, count } = await query;

    if (error) {
      logger.error('Failed to fetch students', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch students' });
    }

    res.json({
      students,
      pagination: {
        total: count || 0,
        limit: Number(limit),
        offset: Number(offset),
      },
    });
  } catch (error: any) {
    logger.error('Error fetching students', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

/**
 * GET /api/admin/students/:id
 * Get detailed student information
 */
router.get('/students/:id', asyncHandler(async (req: any, res) => {
  const { id } = req.params;

  try {
    const { data: student, error } = await supabaseAdmin
      .from('students')
      .select(`
        *,
        user:user_id(*),
        enrollments:student_enrollments(*),
        documents:student_documents(*),
        contacts:student_emergency_contacts(*)
      `)
      .eq('id', id)
      .single();

    if (error || !student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({ student });
  } catch (error: any) {
    logger.error('Error fetching student', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

/**
 * PATCH /api/admin/students/:id/status
 * Change student status (lead, active, paused, graduated)
 */
router.patch('/students/:id/status', asyncHandler(async (req: any, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const admin = req.user;

  if (!['lead', 'active', 'paused', 'graduated'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const student = await changeStudentStatus(id, status, admin.id);

    logger.info('Student status updated', { studentId: id, newStatus: status, adminId: admin.id });

    res.json({ student });
  } catch (error: any) {
    logger.error('Error updating student status', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// ==================== ENROLLMENT MANAGEMENT ====================

/**
 * GET /api/admin/enrollments
 * List all enrollments
 */
router.get('/enrollments', asyncHandler(async (req: any, res) => {
  const {
    status,
    studentId,
    limit = 100,
    offset = 0,
  } = req.query;

  try {
    let query = supabaseAdmin
      .from('student_enrollments')
      .select(`
        *,
        student:students(id, first_name, last_name, student_code)
      `, { count: 'exact' })
      .order('enrolled_date', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (studentId) {
      query = query.eq('student_id', studentId);
    }

    const { data: enrollments, error, count } = await query;

    if (error) {
      logger.error('Failed to fetch enrollments', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch enrollments' });
    }

    res.json({
      enrollments,
      pagination: {
        total: count || 0,
        limit: Number(limit),
        offset: Number(offset),
      },
    });
  } catch (error: any) {
    logger.error('Error fetching enrollments', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// ==================== PAYMENT RECORDS ====================

/**
 * GET /api/admin/payments
 * View all payment transactions
 */
router.get('/payments', asyncHandler(async (req: any, res) => {
  const {
    status,
    studentId,
    startDate,
    endDate,
    limit = 100,
    offset = 0,
  } = req.query;

  try {
    let query = supabaseAdmin
      .from('payment_records')
      .select(`
        *,
        student:students(id, first_name, last_name, student_code)
      `, { count: 'exact' })
      .order('payment_date', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (studentId) {
      query = query.eq('student_id', studentId);
    }

    if (startDate) {
      query = query.gte('payment_date', startDate);
    }

    if (endDate) {
      query = query.lte('payment_date', endDate);
    }

    const { data: payments, error, count } = await query;

    if (error) {
      logger.error('Failed to fetch payments', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch payments' });
    }

    res.json({
      payments,
      pagination: {
        total: count || 0,
        limit: Number(limit),
        offset: Number(offset),
      },
    });
  } catch (error: any) {
    logger.error('Error fetching payments', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// ==================== AUDIT LOGS ====================

/**
 * GET /api/admin/audit-logs
 * View audit logs with filtering
 */
router.get('/audit-logs', asyncHandler(async (req: any, res) => {
  const {
    eventType,
    actorId,
    targetId,
    startDate,
    endDate,
    limit = 100,
    offset = 0,
  } = req.query;

  try {
    let query = supabaseAdmin
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (eventType) {
      query = query.eq('event_type', eventType);
    }

    if (actorId) {
      query = query.eq('actor_user_id', actorId);
    }

    if (targetId) {
      query = query.eq('target_user_id', targetId);
    }

    if (startDate) {
      query = query.gte('created_at', startDate);
    }

    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    const { data: logs, error, count } = await query;

    if (error) {
      logger.error('Failed to fetch audit logs', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch audit logs' });
    }

    res.json({
      logs,
      pagination: {
        total: count || 0,
        limit: Number(limit),
        offset: Number(offset),
      },
    });
  } catch (error: any) {
    logger.error('Error fetching audit logs', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// ==================== SYSTEM ANALYTICS ====================

/**
 * GET /api/admin/analytics/dashboard
 * Get dashboard analytics
 */
router.get('/analytics/dashboard', asyncHandler(async (req: any, res) => {
  try {
    // Total users by role
    const { data: usersByRole } = await supabaseAdmin
      .from('users')
      .select('role')
      .then(result => {
        const counts: Record<string, number> = {
          student: 0,
          coach: 0,
          staff: 0,
          admin: 0,
        };
        if (result.data) {
          result.data.forEach((user: any) => {
            counts[user.role] = (counts[user.role] || 0) + 1;
          });
        }
        return { data: counts };
      });

    // Total students by status
    const { data: studentsByStatus } = await supabaseAdmin
      .from('students')
      .select('status')
      .then(result => {
        const counts: Record<string, number> = {};
        if (result.data) {
          result.data.forEach((student: any) => {
            counts[student.status] = (counts[student.status] || 0) + 1;
          });
        }
        return { data: counts };
      });

    // Active enrollments
    const { count: activeEnrollments } = await supabaseAdmin
      .from('student_enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'in_progress');

    // Recent signups (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { count: recentSignups } = await supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', thirtyDaysAgo.toISOString());

    // Total revenue (last 30 days)
    const { data: recentPayments } = await supabaseAdmin
      .from('payment_records')
      .select('amount')
      .eq('status', 'paid')
      .gte('payment_date', thirtyDaysAgo.toISOString());

    const totalRevenue = recentPayments?.reduce((sum: number, p: any) => sum + (p.amount || 0), 0) || 0;

    res.json({
      analytics: {
        usersByRole,
        studentsByStatus,
        activeEnrollments: activeEnrollments || 0,
        recentSignups: recentSignups || 0,
        totalRevenue,
      },
    });
  } catch (error: any) {
    logger.error('Error fetching analytics', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

/**
 * GET /api/admin/analytics/trends
 * Get trend data for charts
 */
router.get('/analytics/trends', asyncHandler(async (req: any, res) => {
  const { period = '30d' } = req.query;

  try {
    let days = 30;
    if (period === '7d') days = 7;
    if (period === '90d') days = 90;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // User signups trend
    const { data: signups } = await supabaseAdmin
      .from('users')
      .select('created_at')
      .gte('created_at', startDate.toISOString());

    // Enrollment trend
    const { data: enrollments } = await supabaseAdmin
      .from('student_enrollments')
      .select('enrolled_date')
      .gte('enrolled_date', startDate.toISOString());

    // Revenue trend
    const { data: payments } = await supabaseAdmin
      .from('payment_records')
      .select('payment_date, amount')
      .eq('status', 'paid')
      .gte('payment_date', startDate.toISOString());

    res.json({
      trends: {
        signups: signups || [],
        enrollments: enrollments || [],
        payments: payments || [],
      },
    });
  } catch (error: any) {
    logger.error('Error fetching trends', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// ==================== BULK OPERATIONS ====================

/**
 * POST /api/admin/bulk/import-students
 * Bulk import students from CSV
 */
router.post('/bulk/import-students', asyncHandler(async (req: any, res) => {
  const { students } = req.body;
  const admin = req.user;

  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ error: 'No students provided' });
  }

  try {
    // Import students (simplified - would need full validation in production)
    const { data, error } = await supabaseAdmin
      .from('students')
      .insert(students)
      .select();

    if (error) {
      logger.error('Bulk import failed', { error: error.message });
      return res.status(500).json({ error: 'Bulk import failed' });
    }

    // Audit log
    await auditAdmin(
      'admin.bulk_operation',
      admin.id,
      undefined,
      `Bulk imported ${students.length} students`,
      { count: students.length }
    );

    logger.info('Bulk import completed', { count: students.length, adminId: admin.id });

    res.json({ imported: data.length, students: data });
  } catch (error: any) {
    logger.error('Error during bulk import', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

/**
 * POST /api/admin/bulk/export-data
 * Export data for compliance/backup
 */
router.post('/bulk/export-data', asyncHandler(async (req: any, res) => {
  const { dataType, filters } = req.body;
  const admin = req.user;

  try {
    let data: any = null;

    switch (dataType) {
      case 'students':
        const { data: students } = await supabaseAdmin
          .from('students')
          .select('*');
        data = students;
        break;
      case 'users':
        const { data: users } = await supabaseAdmin
          .from('users')
          .select('*');
        data = users;
        break;
      case 'enrollments':
        const { data: enrollments } = await supabaseAdmin
          .from('student_enrollments')
          .select('*');
        data = enrollments;
        break;
      default:
        return res.status(400).json({ error: 'Invalid data type' });
    }

    // Audit log
    await auditAdmin(
      'admin.data_export',
      admin.id,
      undefined,
      `Exported ${dataType} data`,
      { dataType, count: data?.length || 0 }
    );

    logger.info('Data export completed', { dataType, count: data?.length || 0, adminId: admin.id });

    res.json({ data });
  } catch (error: any) {
    logger.error('Error during data export', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

export default router;
