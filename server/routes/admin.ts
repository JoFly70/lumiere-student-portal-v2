/**
 * Admin Dashboard API Routes
 * Comprehensive admin panel for managing users, students, enrollments, etc.
 */

import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { isSyntheticAccount } from '@shared/synthetic-accounts';
import { logger } from '../lib/logger';
import { asyncHandler } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { auditAdmin } from '../lib/audit';
import { changeStudentStatus } from '../services/admin-student-status';
import { createInvitation, DEFAULT_INVITATION_TTL_HOURS, MAX_INVITATION_TTL_HOURS } from '../lib/invitations';
import { requireCsrf } from '../middleware/csrf';
import { deliverEmail, emailTransportConfigured, type EmailDelivery } from '../lib/email';
import { buildInvitationEmail } from '../lib/invitation-email';
import { resolvePasswordResetAppUrl } from '../lib/auth-policy';

// Supabase Auth ban applied when an account is archived, so refresh tokens
// stop working in addition to the application-level status check.
const ARCHIVED_BAN_DURATION = '876000h';

const router = Router();

// All admin routes require authentication then admin role
router.use(requireAuth);
router.use(requireRole(['admin']));
// Every state-changing admin request carries the CSRF token (requireCsrf passes GET/HEAD through).
router.use(requireCsrf);

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
// Account creation is invitation-only. Invitations are issued here by an admin. The token is returned once (to copy)
// and, when the app email transport is configured, emailed to the invitee in their language. Resend issues a fresh
// token and revokes the previous one, because only token hashes are stored. Every write requires the CSRF token.

const invitationLanguage = z.enum(['en', 'fr']);
const createInvitationSchema = z.object({
  email: z.string().trim().email().max(320),
  expiresInHours: z.number().int().min(1).max(MAX_INVITATION_TTL_HOURS).optional(),
  language: invitationLanguage.optional(),
  sendEmail: z.boolean().optional(),
}).strict();
const resendInvitationSchema = z.object({
  language: invitationLanguage.optional(),
  sendEmail: z.boolean().optional(),
}).strict();

type InvitationListRow = { id: string; email: string; role: string; created_by: string | null; created_at: string; expires_at: string; consumed_at: string | null; consumed_by: string | null; revoked_at: string | null };

export function invitationStatus(row: Pick<InvitationListRow, 'expires_at' | 'consumed_at' | 'revoked_at'>, now = new Date()): 'pending' | 'accepted' | 'revoked' | 'expired' {
  if (row.consumed_at) return 'accepted';
  if (row.revoked_at) return 'revoked';
  return new Date(row.expires_at).getTime() <= now.getTime() ? 'expired' : 'pending';
}

async function issueAndDeliver(params: { email: string; adminId: string; ttlHours: number; language: 'en' | 'fr'; sendEmail: boolean }) {
  const invitation = await createInvitation({ email: params.email, createdBy: params.adminId, ttlHours: params.ttlHours });
  let delivery: EmailDelivery | 'skipped' = 'skipped';
  if (params.sendEmail) {
    const appUrl = resolvePasswordResetAppUrl(process.env.APP_URL, process.env.NODE_ENV === 'production');
    if (!appUrl) {
      delivery = 'not_configured';
    } else {
      const mail = buildInvitationEmail({ email: invitation.email, token: invitation.token, expiresAt: invitation.expiresAt, appUrl, language: params.language });
      delivery = await deliverEmail({ to: invitation.email, subject: mail.subject, html: mail.html, text: mail.text });
    }
  }
  return { invitation, delivery };
}

/**
 * POST /api/admin/invitations
 * Issue a single-use student invitation bound to one email address; email it unless sendEmail is false.
 */
router.post('/invitations', asyncHandler(async (req: any, res) => {
  const parsed = createInvitationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
  }
  const admin = req.user;
  const language = parsed.data.language ?? 'en';
  try {
    const { invitation, delivery } = await issueAndDeliver({
      email: parsed.data.email,
      adminId: admin.id,
      ttlHours: parsed.data.expiresInHours ?? DEFAULT_INVITATION_TTL_HOURS,
      language,
      sendEmail: parsed.data.sendEmail ?? true,
    });
    await auditAdmin(
      'admin.permission_granted',
      admin.id,
      undefined,
      'Issued student account invitation',
      { invitationId: invitation.id, email: invitation.email, expiresAt: invitation.expiresAt, language, emailDelivery: delivery },
    );
    res.status(201).json({
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      // Shown once; only its hash is stored.
      token: invitation.token,
      emailDelivery: delivery,
    });
  } catch (error: any) {
    logger.error('Failed to create invitation', { error: error.message });
    res.status(500).json({ error: 'Failed to create invitation' });
  }
}));

/**
 * GET /api/admin/invitations
 * List invitations with a derived status (never returns token hashes).
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
  const now = new Date();
  const rows = ((data ?? []) as InvitationListRow[])
    .map((r) => ({
      id: r.id, email: r.email, role: r.role, created_by: r.created_by, created_at: r.created_at, expires_at: r.expires_at,
      consumed_at: r.consumed_at, consumed_by: r.consumed_by, revoked_at: r.revoked_at, status: invitationStatus(r, now),
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json({ invitations: rows, emailConfigured: emailTransportConfigured() });
}));

/**
 * POST /api/admin/invitations/:id/resend
 * Issue a fresh code for the same address (the old one is revoked first) and email it. Accepted invitations cannot be resent.
 */
router.post('/invitations/:id/resend', asyncHandler(async (req: any, res) => {
  const { id } = req.params;
  if (!z.string().uuid().safeParse(id).success) {
    return res.status(400).json({ error: 'Invalid invitation id' });
  }
  const parsed = resendInvitationSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
  }
  const { data: previous, error: findError } = await supabaseAdmin
    .from('account_invitations')
    .select('id, email, consumed_at, revoked_at')
    .eq('id', id)
    .maybeSingle();
  if (findError) {
    logger.error('Failed to load invitation', { error: findError.message });
    return res.status(500).json({ error: 'Failed to resend invitation' });
  }
  if (!previous) return res.status(404).json({ error: 'Invitation not found' });
  if (previous.consumed_at) return res.status(409).json({ error: 'This invitation was already used to create an account' });

  if (!previous.revoked_at) {
    const { error: revokeError } = await supabaseAdmin
      .from('account_invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .is('consumed_at', null)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();
    if (revokeError) {
      logger.error('Failed to revoke invitation before resend', { error: revokeError.message });
      return res.status(500).json({ error: 'Failed to resend invitation' });
    }
  }
  const language = parsed.data.language ?? 'en';
  try {
    const { invitation, delivery } = await issueAndDeliver({
      email: previous.email,
      adminId: req.user.id,
      ttlHours: DEFAULT_INVITATION_TTL_HOURS,
      language,
      sendEmail: parsed.data.sendEmail ?? true,
    });
    await auditAdmin('admin.permission_granted', req.user.id, undefined, 'Reissued student account invitation', {
      invitationId: invitation.id, replacesInvitationId: id, email: invitation.email, expiresAt: invitation.expiresAt, language, emailDelivery: delivery,
    });
    res.status(201).json({ id: invitation.id, email: invitation.email, expiresAt: invitation.expiresAt, token: invitation.token, emailDelivery: delivery, replaces: id });
  } catch (error: any) {
    logger.error('Failed to reissue invitation', { error: error.message });
    res.status(500).json({ error: 'Failed to resend invitation' });
  }
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
    // Total users by role (synthetic/test accounts excluded and counted separately)
    const usersRes = await supabaseAdmin.from('users').select('role, email, name');
    const usersByRole: Record<string, number> = { student: 0, coach: 0, staff: 0, admin: 0 };
    let testUsers = 0;
    (usersRes.data ?? []).forEach((user: any) => {
      if (isSyntheticAccount(user)) { testUsers += 1; return; }
      usersByRole[user.role] = (usersByRole[user.role] || 0) + 1;
    });

    // Total students by status (synthetic/test students excluded and counted separately)
    const studentsRes = await supabaseAdmin.from('students').select('id, status, email, first_name, preferred_name');
    const studentsByStatus: Record<string, number> = {};
    let testStudents = 0;
    const syntheticStudentIds = new Set<string>();
    (studentsRes.data ?? []).forEach((student: any) => {
      if (isSyntheticAccount(student)) { testStudents += 1; syntheticStudentIds.add(student.id); return; }
      studentsByStatus[student.status] = (studentsByStatus[student.status] || 0) + 1;
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

    // High-school enrollments that are open (planned/active/on hold), real students only.
    const { data: hsOpen } = await supabaseAdmin
      .from('hs_enrollments')
      .select('student_id, status')
      .in('status', ['planned', 'active', 'on_hold']);
    const realHs = (hsOpen ?? []).filter((e: any) => !syntheticStudentIds.has(e.student_id));
    const hsEnrollments = { active: realHs.filter((e: any) => e.status === 'active').length, pending: realHs.filter((e: any) => e.status !== 'active').length };

    // Money received in the last 30 days: staff-confirmed billing receipts (voided rows excluded),
    // real students only. Amounts are in each student's agreed currency; all current obligations are USD.
    const { data: recentReceipts } = await supabaseAdmin
      .from('student_billing_receipts')
      .select('student_id, amount_cents, voided_at')
      .gte('received_date', thirtyDaysAgo.toISOString().slice(0, 10));
    const totalRevenue = (recentReceipts ?? [])
      .filter((r: any) => !r.voided_at && !syntheticStudentIds.has(r.student_id))
      .reduce((sum: number, r: any) => sum + Number(r.amount_cents || 0), 0); // cents, like the previous field

    res.json({
      analytics: {
        usersByRole,
        studentsByStatus,
        testAccounts: { users: testUsers, students: testStudents },
        hsEnrollments,
        activeEnrollments: (activeEnrollments || 0) + hsEnrollments.active,
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
