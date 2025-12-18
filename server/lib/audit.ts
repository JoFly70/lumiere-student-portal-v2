/**
 * Comprehensive Audit Logging Service
 * FERPA-compliant audit trail for all sensitive operations
 */

import { supabaseAdmin, isSupabaseConfigured } from './supabase';
import { logger } from './logger';

// ==================== TYPES ====================

export type AuditEventType =
  // Authentication events
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.logout'
  | 'auth.password_change'
  | 'auth.password_reset_request'
  | 'auth.password_reset_complete'
  | 'auth.2fa_enabled'
  | 'auth.2fa_disabled'
  | 'auth.2fa_verified'
  | 'auth.2fa_failed'
  | 'auth.session_expired'
  // Profile events
  | 'profile.created'
  | 'profile.updated'
  | 'profile.viewed'
  | 'profile.status_changed'
  | 'profile.photo_uploaded'
  // Document events
  | 'document.uploaded'
  | 'document.downloaded'
  | 'document.viewed'
  | 'document.deleted'
  | 'document.status_changed'
  | 'document.verified'
  | 'document.rejected'
  // Payment events
  | 'payment.created'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded'
  | 'payment.subscription_created'
  | 'payment.subscription_updated'
  | 'payment.subscription_canceled'
  // Enrollment events
  | 'enrollment.created'
  | 'enrollment.updated'
  | 'enrollment.dropped'
  | 'enrollment.completed'
  | 'enrollment.status_changed'
  // Grade events
  | 'grade.created'
  | 'grade.updated'
  | 'grade.manual_adjustment'
  | 'grade.override'
  // Admin events
  | 'admin.role_changed'
  | 'admin.permission_granted'
  | 'admin.permission_revoked'
  | 'admin.user_impersonation'
  | 'admin.bulk_operation'
  | 'admin.data_export'
  // System events
  | 'system.migration_applied'
  | 'system.backup_created'
  | 'system.backup_restored'
  | 'system.maintenance_mode'
  | 'system.error';

export type AuditSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface AuditLogEntry {
  eventType: AuditEventType;
  severity?: AuditSeverity;
  actorUserId?: string;
  actorRole?: string;
  actorIp?: string;
  actorUserAgent?: string;
  targetUserId?: string;
  targetResourceType?: string;
  targetResourceId?: string;
  actionDescription: string;
  metadata?: Record<string, any>;
  isEducationalRecord?: boolean;
  isFinancialRecord?: boolean;
  requestId?: string;
  sessionId?: string;
}

// ==================== MAIN AUDIT LOGGING FUNCTION ====================

/**
 * Create an audit log entry
 * Automatically determines retention based on record type
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    if (!isSupabaseConfigured) {
      logger.warn('Audit log not created: Supabase not configured', {
        eventType: entry.eventType,
      });
      return;
    }

    // Convert camelCase to snake_case for database
    const dbEntry = {
      event_type: entry.eventType,
      severity: entry.severity || 'info',
      actor_user_id: entry.actorUserId,
      actor_role: entry.actorRole,
      actor_ip: entry.actorIp,
      actor_user_agent: entry.actorUserAgent,
      target_user_id: entry.targetUserId,
      target_resource_type: entry.targetResourceType,
      target_resource_id: entry.targetResourceId,
      action_description: entry.actionDescription,
      metadata: entry.metadata || {},
      is_educational_record: entry.isEducationalRecord || false,
      is_financial_record: entry.isFinancialRecord || false,
      request_id: entry.requestId,
      session_id: entry.sessionId,
    };

    const { error } = await supabaseAdmin
      .from('audit_logs')
      .insert(dbEntry);

    if (error) {
      logger.error('Failed to create audit log', {
        error: error.message,
        eventType: entry.eventType,
      });
    } else {
      logger.debug('Audit log created', {
        eventType: entry.eventType,
        actorUserId: entry.actorUserId,
        targetUserId: entry.targetUserId,
      });
    }
  } catch (error) {
    logger.error('Audit logging error', {
      error: error instanceof Error ? error.message : String(error),
      eventType: entry.eventType,
    });
  }
}

// ==================== CONVENIENCE FUNCTIONS FOR COMMON EVENTS ====================

/**
 * Log authentication event
 */
export async function auditAuth(
  eventType: Extract<AuditEventType, `auth.${string}`>,
  userId: string,
  description: string,
  options?: {
    ip?: string;
    userAgent?: string;
    metadata?: Record<string, any>;
    severity?: AuditSeverity;
  }
) {
  await createAuditLog({
    eventType,
    severity: options?.severity || (eventType.includes('failure') || eventType.includes('failed') ? 'warning' : 'info'),
    actorUserId: userId,
    actorIp: options?.ip,
    actorUserAgent: options?.userAgent,
    actionDescription: description,
    metadata: options?.metadata,
  });
}

/**
 * Log profile modification (FERPA educational record)
 */
export async function auditProfile(
  eventType: Extract<AuditEventType, `profile.${string}`>,
  actorUserId: string,
  targetUserId: string,
  description: string,
  metadata?: Record<string, any>
) {
  await createAuditLog({
    eventType,
    severity: 'info',
    actorUserId,
    targetUserId,
    targetResourceType: 'profile',
    targetResourceId: targetUserId,
    actionDescription: description,
    metadata,
    isEducationalRecord: true, // FERPA: 3-year retention
  });
}

/**
 * Log document access (FERPA educational record)
 */
export async function auditDocument(
  eventType: Extract<AuditEventType, `document.${string}`>,
  actorUserId: string,
  documentId: string,
  targetUserId: string,
  description: string,
  metadata?: Record<string, any>
) {
  await createAuditLog({
    eventType,
    severity: eventType.includes('deleted') ? 'warning' : 'info',
    actorUserId,
    targetUserId,
    targetResourceType: 'document',
    targetResourceId: documentId,
    actionDescription: description,
    metadata,
    isEducationalRecord: true, // FERPA: 3-year retention
  });
}

/**
 * Log payment transaction (Financial record)
 */
export async function auditPayment(
  eventType: Extract<AuditEventType, `payment.${string}`>,
  actorUserId: string,
  targetUserId: string,
  description: string,
  metadata?: Record<string, any>
) {
  await createAuditLog({
    eventType,
    severity: eventType.includes('failed') ? 'warning' : 'info',
    actorUserId,
    targetUserId,
    targetResourceType: 'payment',
    actionDescription: description,
    metadata,
    isFinancialRecord: true, // IRS: 7-year retention
  });
}

/**
 * Log enrollment change (FERPA educational record)
 */
export async function auditEnrollment(
  eventType: Extract<AuditEventType, `enrollment.${string}`>,
  actorUserId: string,
  targetUserId: string,
  enrollmentId: string,
  description: string,
  metadata?: Record<string, any>
) {
  await createAuditLog({
    eventType,
    severity: 'info',
    actorUserId,
    targetUserId,
    targetResourceType: 'enrollment',
    targetResourceId: enrollmentId,
    actionDescription: description,
    metadata,
    isEducationalRecord: true, // FERPA: 3-year retention
  });
}

/**
 * Log grade modification (FERPA educational record - CRITICAL)
 */
export async function auditGrade(
  eventType: Extract<AuditEventType, `grade.${string}`>,
  actorUserId: string,
  targetUserId: string,
  gradeId: string,
  description: string,
  metadata?: Record<string, any>
) {
  await createAuditLog({
    eventType,
    severity: eventType.includes('override') || eventType.includes('manual') ? 'warning' : 'info',
    actorUserId,
    targetUserId,
    targetResourceType: 'grade',
    targetResourceId: gradeId,
    actionDescription: description,
    metadata,
    isEducationalRecord: true, // FERPA: 3-year retention
  });
}

/**
 * Log admin action
 */
export async function auditAdmin(
  eventType: Extract<AuditEventType, `admin.${string}`>,
  actorUserId: string,
  targetUserId: string | undefined,
  description: string,
  metadata?: Record<string, any>
) {
  await createAuditLog({
    eventType,
    severity: 'warning', // Admin actions are always noteworthy
    actorUserId,
    actorRole: 'admin',
    targetUserId,
    actionDescription: description,
    metadata,
  });
}

/**
 * Log system event
 */
export async function auditSystem(
  eventType: Extract<AuditEventType, `system.${string}`>,
  description: string,
  metadata?: Record<string, any>,
  severity?: AuditSeverity
) {
  await createAuditLog({
    eventType,
    severity: severity || 'info',
    actionDescription: description,
    metadata,
  });
}

// ==================== QUERY FUNCTIONS ====================

/**
 * Get audit logs for a specific user
 */
export async function getUserAuditLogs(
  userId: string,
  options?: {
    limit?: number;
    offset?: number;
    eventType?: AuditEventType;
    startDate?: Date;
    endDate?: Date;
  }
) {
  if (!isSupabaseConfigured) {
    return { data: null, error: new Error('Supabase not configured') };
  }

  let query = supabaseAdmin
    .from('audit_logs')
    .select('*')
    .or(`actor_user_id.eq.${userId},target_user_id.eq.${userId}`)
    .order('created_at', { ascending: false });

  if (options?.eventType) {
    query = query.eq('event_type', options.eventType);
  }

  if (options?.startDate) {
    query = query.gte('created_at', options.startDate.toISOString());
  }

  if (options?.endDate) {
    query = query.lte('created_at', options.endDate.toISOString());
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
  }

  return await query;
}

/**
 * Get recent security events for monitoring
 */
export async function getSecurityEvents(limit: number = 100) {
  if (!isSupabaseConfigured) {
    return { data: null, error: new Error('Supabase not configured') };
  }

  return await supabaseAdmin
    .from('audit_logs')
    .select('*')
    .in('event_type', [
      'auth.login.failure',
      'auth.2fa_failed',
      'auth.password_reset_request',
      'admin.role_changed',
      'admin.permission_granted',
      'admin.user_impersonation',
    ])
    .order('created_at', { ascending: false })
    .limit(limit);
}

/**
 * Get educational records for FERPA compliance audit
 */
export async function getEducationalRecords(
  userId: string,
  options?: { startDate?: Date; endDate?: Date }
) {
  if (!isSupabaseConfigured) {
    return { data: null, error: new Error('Supabase not configured') };
  }

  let query = supabaseAdmin
    .from('audit_logs')
    .select('*')
    .eq('target_user_id', userId)
    .eq('is_educational_record', true)
    .order('created_at', { ascending: false });

  if (options?.startDate) {
    query = query.gte('created_at', options.startDate.toISOString());
  }

  if (options?.endDate) {
    query = query.lte('created_at', options.endDate.toISOString());
  }

  return await query;
}

/**
 * Get financial records for compliance audit
 */
export async function getFinancialRecords(
  userId: string,
  options?: { startDate?: Date; endDate?: Date }
) {
  if (!isSupabaseConfigured) {
    return { data: null, error: new Error('Supabase not configured') };
  }

  let query = supabaseAdmin
    .from('audit_logs')
    .select('*')
    .eq('target_user_id', userId)
    .eq('is_financial_record', true)
    .order('created_at', { ascending: false});

  if (options?.startDate) {
    query = query.gte('created_at', options.startDate.toISOString());
  }

  if (options?.endDate) {
    query = query.lte('created_at', options.endDate.toISOString());
  }

  return await query;
}

/**
 * Purge expired audit logs (call from scheduled job)
 */
export async function purgeExpiredAuditLogs(): Promise<number> {
  if (!isSupabaseConfigured) {
    logger.warn('Cannot purge audit logs: Supabase not configured');
    return 0;
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('purge_expired_audit_logs');

    if (error) {
      logger.error('Failed to purge expired audit logs', { error: error.message });
      return 0;
    }

    logger.info('Purged expired audit logs', { count: data });
    return data || 0;
  } catch (error) {
    logger.error('Error purging audit logs', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}
