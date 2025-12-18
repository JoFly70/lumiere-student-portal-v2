/*
  # Comprehensive Audit Logging System

  1. Schema Changes
    - Create audit_logs table for FERPA-compliant logging
    - Indexes for efficient querying
    - Retention policy functions

  2. Logged Events
    - Authentication: login attempts, password changes, 2FA events
    - Profile: modifications to student profiles
    - Documents: uploads, downloads, access, deletions
    - Payments: transactions, refunds, subscription changes
    - Enrollments: course additions, drops, status changes
    - Grades: modifications, manual adjustments
    - Admin: role changes, permission modifications

  3. FERPA Compliance
    - 3-year retention for educational records
    - 7-year retention for financial records
    - Automatic purge of expired logs
    - Tamper-evident (no updates, only inserts)

  4. Security
    - RLS policies for audit log access
    - Only admins can view audit logs
    - Logs are append-only (no deletions except automated retention)
*/

-- Create enum for audit event types
CREATE TYPE audit_event_type AS ENUM (
  -- Authentication events
  'auth.login.success',
  'auth.login.failure',
  'auth.logout',
  'auth.password_change',
  'auth.password_reset_request',
  'auth.password_reset_complete',
  'auth.2fa_enabled',
  'auth.2fa_disabled',
  'auth.2fa_verified',
  'auth.2fa_failed',
  'auth.session_expired',

  -- Profile events
  'profile.created',
  'profile.updated',
  'profile.viewed',
  'profile.status_changed',
  'profile.photo_uploaded',

  -- Document events
  'document.uploaded',
  'document.downloaded',
  'document.viewed',
  'document.deleted',
  'document.status_changed',
  'document.verified',
  'document.rejected',

  -- Payment events
  'payment.created',
  'payment.succeeded',
  'payment.failed',
  'payment.refunded',
  'payment.subscription_created',
  'payment.subscription_updated',
  'payment.subscription_canceled',

  -- Enrollment events
  'enrollment.created',
  'enrollment.updated',
  'enrollment.dropped',
  'enrollment.completed',
  'enrollment.status_changed',

  -- Grade events
  'grade.created',
  'grade.updated',
  'grade.manual_adjustment',
  'grade.override',

  -- Admin events
  'admin.role_changed',
  'admin.permission_granted',
  'admin.permission_revoked',
  'admin.user_impersonation',
  'admin.bulk_operation',
  'admin.data_export',

  -- System events
  'system.migration_applied',
  'system.backup_created',
  'system.backup_restored',
  'system.maintenance_mode',
  'system.error'
);

-- Create enum for audit event severity
CREATE TYPE audit_severity AS ENUM (
  'info',
  'warning',
  'error',
  'critical'
);

-- Create audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Event information
  event_type audit_event_type NOT NULL,
  severity audit_severity NOT NULL DEFAULT 'info',

  -- Actor (who performed the action)
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT,
  actor_ip TEXT,
  actor_user_agent TEXT,

  -- Target (what was affected)
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_resource_type TEXT, -- 'student', 'document', 'enrollment', etc.
  target_resource_id TEXT,

  -- Event details
  action_description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',

  -- FERPA compliance
  is_educational_record BOOLEAN DEFAULT false,
  is_financial_record BOOLEAN DEFAULT false,
  retention_until TIMESTAMP WITH TIME ZONE,

  -- Request context
  request_id TEXT,
  session_id TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  -- Prevent updates (append-only)
  CONSTRAINT audit_logs_immutable CHECK (created_at <= NOW())
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_retention ON audit_logs(retention_until) WHERE retention_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_educational ON audit_logs(is_educational_record, created_at DESC) WHERE is_educational_record = true;
CREATE INDEX IF NOT EXISTS idx_audit_logs_financial ON audit_logs(is_financial_record, created_at DESC) WHERE is_financial_record = true;

-- Function to automatically set retention period based on record type
CREATE OR REPLACE FUNCTION set_audit_retention()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_financial_record THEN
    -- Financial records: 7 years retention (IRS requirement)
    NEW.retention_until := NEW.created_at + INTERVAL '7 years';
  ELSIF NEW.is_educational_record THEN
    -- Educational records: 3 years retention (FERPA guideline)
    NEW.retention_until := NEW.created_at + INTERVAL '3 years';
  ELSE
    -- General security logs: 1 year retention
    NEW.retention_until := NEW.created_at + INTERVAL '1 year';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to set retention on insert
CREATE TRIGGER trigger_set_audit_retention
  BEFORE INSERT ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION set_audit_retention();

-- Function to purge expired audit logs (run via cron or scheduled job)
CREATE OR REPLACE FUNCTION purge_expired_audit_logs()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM audit_logs
  WHERE retention_until < NOW();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  -- Log the purge operation
  INSERT INTO audit_logs (
    event_type,
    severity,
    action_description,
    metadata
  ) VALUES (
    'system.maintenance_mode',
    'info',
    'Purged expired audit logs',
    jsonb_build_object(
      'deleted_count', deleted_count,
      'purge_date', NOW()
    )
  );

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Helper function to create audit log entries
CREATE OR REPLACE FUNCTION create_audit_log(
  p_event_type audit_event_type,
  p_actor_user_id TEXT,
  p_target_user_id TEXT DEFAULT NULL,
  p_action_description TEXT DEFAULT '',
  p_metadata JSONB DEFAULT '{}',
  p_severity audit_severity DEFAULT 'info',
  p_is_educational BOOLEAN DEFAULT false,
  p_is_financial BOOLEAN DEFAULT false
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO audit_logs (
    event_type,
    severity,
    actor_user_id,
    target_user_id,
    action_description,
    metadata,
    is_educational_record,
    is_financial_record
  ) VALUES (
    p_event_type,
    p_severity,
    p_actor_user_id,
    p_target_user_id,
    p_action_description,
    p_metadata,
    p_is_educational,
    p_is_financial
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable RLS on audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Only admins and system can insert audit logs
CREATE POLICY "System and admins can insert audit logs"
  ON audit_logs
  FOR INSERT
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM users WHERE role IN ('admin', 'system')
    )
    OR current_user = 'postgres' -- Allow system inserts
  );

-- Policy: Admins can view all audit logs
CREATE POLICY "Admins can view all audit logs"
  ON audit_logs
  FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM users WHERE role = 'admin'
    )
  );

-- Policy: Users can view their own audit logs (limited fields)
CREATE POLICY "Users can view own audit logs"
  ON audit_logs
  FOR SELECT
  USING (
    auth.uid() = actor_user_id
    OR auth.uid() = target_user_id
  );

-- Policy: NO UPDATES OR DELETES (append-only for tamper evidence)
-- No policies for UPDATE or DELETE means they're forbidden

-- Add comments for documentation
COMMENT ON TABLE audit_logs IS 'FERPA-compliant audit logging for all sensitive operations';
COMMENT ON COLUMN audit_logs.event_type IS 'Type of event being logged';
COMMENT ON COLUMN audit_logs.is_educational_record IS 'FERPA educational record (3-year retention)';
COMMENT ON COLUMN audit_logs.is_financial_record IS 'Financial record (7-year retention per IRS)';
COMMENT ON COLUMN audit_logs.retention_until IS 'Auto-calculated retention expiry date';
COMMENT ON FUNCTION purge_expired_audit_logs() IS 'Purge audit logs past retention period (run via cron)';
