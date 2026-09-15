/*
# Phase 2D — Canonical Audit Logging Infrastructure

1. Purpose
   Creates the FERPA-compliant audit trail (public.audit_logs) that
   server/lib/audit.ts writes to through the Supabase service-role client.
   The canonical development project was missing this schema entirely, so
   every audit write was silently dropped. This migration creates only the
   audit infrastructure; it touches no other table and no existing data.

2. New Types
   - audit_event_type (enum): auth.*, profile.*, document.*, payment.*,
     enrollment.*, grade.*, admin.* (incl. admin.bulk_operation), system.*
   - audit_severity (enum): info, warning, error, critical

3. New Table: audit_logs
   - id (uuid, PK, default gen_random_uuid())
   - event_type (audit_event_type, NOT NULL)
   - severity (audit_severity, NOT NULL, default 'info')
   - actor_user_id (varchar — FK to public.users(id) ON DELETE SET NULL)
   - actor_role, actor_ip, actor_user_agent (text)
   - target_user_id (varchar — FK to public.users(id) ON DELETE SET NULL)
   - target_resource_type, target_resource_id (text; NO FK on resource id)
   - action_description (text, NOT NULL)
   - metadata (jsonb, NOT NULL, default '{}')
   - is_educational_record (boolean, NOT NULL, default false)
   - is_financial_record (boolean, NOT NULL, default false)
   - retention_until (timestamptz; set by trigger from record type)
   - request_id, session_id (text)
   - created_at (timestamptz, NOT NULL, default now())

4. Retention
   BEFORE INSERT trigger set_audit_retention computes retention_until:
   financial record -> 7 years; educational record -> 3 years; else 1 year.
   purge_expired_audit_logs() deletes only rows past retention_until
   (explicit invocation only; no broad auto-deletion).

5. Compatibility Function
   create_audit_log() — SECURITY DEFINER insert helper preserving the
   canonical field contract; provided for RPC callers.

6. Helper Function
   current_user_role() — SECURITY DEFINER lookup of the caller's role in
   public.users (bypasses users RLS so the audit policy can evaluate it).

7. Indexes
   event_type+created_at, actor_user_id+created_at, target_user_id+created_at,
   target_resource_type+target_resource_id, retention_until (partial).

8. Security (RLS)
   - RLS ENABLED on audit_logs.
   - No INSERT/UPDATE/DELETE policies for anon/authenticated: writes happen
     exclusively through the service-role client (bypasses RLS).
   - SELECT: admin sees all rows; an authenticated user sees rows where
     their own users.id is actor_user_id or target_user_id.
   - All user comparisons use auth.uid()::text because public.users.id is
     varchar while auth.uid() returns uuid (direct comparison fails).
   - Grants: SELECT/INSERT to service_role; anon/authenticated get no new
     table privileges. current_user_role() EXECUTE granted to authenticated.

9. Compatibility Notes
   - No role 'system' is referenced (current role enum: student, coach,
     staff, admin).
   - Safe to re-run: enums guarded in DO blocks; trigger dropped before
     recreate; policies dropped before create.
*/

-- 1. Enums (guarded; do not overwrite existing types)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'audit_event_type' AND n.nspname = 'public') THEN
    CREATE TYPE public.audit_event_type AS ENUM (
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
      'profile.created',
      'profile.updated',
      'profile.viewed',
      'profile.status_changed',
      'profile.photo_uploaded',
      'document.uploaded',
      'document.downloaded',
      'document.viewed',
      'document.deleted',
      'document.status_changed',
      'document.verified',
      'document.rejected',
      'payment.created',
      'payment.succeeded',
      'payment.failed',
      'payment.refunded',
      'payment.subscription_created',
      'payment.subscription_updated',
      'payment.subscription_canceled',
      'enrollment.created',
      'enrollment.updated',
      'enrollment.dropped',
      'enrollment.completed',
      'enrollment.status_changed',
      'grade.created',
      'grade.updated',
      'grade.manual_adjustment',
      'grade.override',
      'admin.role_changed',
      'admin.permission_granted',
      'admin.permission_revoked',
      'admin.user_impersonation',
      'admin.bulk_operation',
      'admin.data_export',
      'system.migration_applied',
      'system.backup_created',
      'system.backup_restored',
      'system.maintenance_mode',
      'system.error'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'audit_severity' AND n.nspname = 'public') THEN
    CREATE TYPE public.audit_severity AS ENUM ('info', 'warning', 'error', 'critical');
  END IF;
END
$$;

-- 2. Table

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type public.audit_event_type NOT NULL,
  severity public.audit_severity NOT NULL DEFAULT 'info',

  actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
  actor_role text,
  actor_ip text,
  actor_user_agent text,

  target_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
  target_resource_type text,
  target_resource_id text,

  action_description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  is_educational_record boolean NOT NULL DEFAULT false,
  is_financial_record boolean NOT NULL DEFAULT false,
  retention_until timestamptz,

  request_id text,
  session_id text,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Indexes

CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type
  ON public.audit_logs(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON public.audit_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user
  ON public.audit_logs(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource
  ON public.audit_logs(target_resource_type, target_resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_retention
  ON public.audit_logs(retention_until)
  WHERE retention_until IS NOT NULL;

-- 4. Retention trigger (rerunnable)

CREATE OR REPLACE FUNCTION public.set_audit_retention()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_financial_record THEN
    NEW.retention_until := now() + interval '7 years';
  ELSIF NEW.is_educational_record THEN
    NEW.retention_until := now() + interval '3 years';
  ELSE
    NEW.retention_until := now() + interval '1 year';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_retention ON public.audit_logs;
CREATE TRIGGER trg_audit_retention
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_audit_retention();

-- 5. Purge function (explicit invocation only)

CREATE OR REPLACE FUNCTION public.purge_expired_audit_logs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  purged integer;
BEGIN
  DELETE FROM public.audit_logs
  WHERE retention_until IS NOT NULL AND retention_until <= now();
  GET DIAGNOSTICS purged = ROW_COUNT;
  RETURN purged;
END;
$$;

-- 6. Compatibility insert function

CREATE OR REPLACE FUNCTION public.create_audit_log(
  p_event_type public.audit_event_type,
  p_action_description text,
  p_severity public.audit_severity DEFAULT 'info',
  p_actor_user_id varchar DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_actor_ip text DEFAULT NULL,
  p_actor_user_agent text DEFAULT NULL,
  p_target_user_id varchar DEFAULT NULL,
  p_target_resource_type text DEFAULT NULL,
  p_target_resource_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_is_educational_record boolean DEFAULT false,
  p_is_financial_record boolean DEFAULT false,
  p_request_id text DEFAULT NULL,
  p_session_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO public.audit_logs (
    event_type, severity, actor_user_id, actor_role, actor_ip, actor_user_agent,
    target_user_id, target_resource_type, target_resource_id, action_description,
    metadata, is_educational_record, is_financial_record, request_id, session_id
  ) VALUES (
    p_event_type, p_severity, p_actor_user_id, p_actor_role, p_actor_ip, p_actor_user_agent,
    p_target_user_id, p_target_resource_type, p_target_resource_id, p_action_description,
    p_metadata, p_is_educational_record, p_is_financial_record, p_request_id, p_session_id
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- 6b. Helper: caller's role, evaluated as definer so users RLS does not
--     interfere with the audit policy check.

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text FROM public.users WHERE id = auth.uid()::text
$$;

GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- 7. RLS

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Write paths: service-role only. No INSERT/UPDATE/DELETE policies are
-- created for anon or authenticated.
REVOKE ALL ON public.audit_logs FROM anon, authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO service_role;

-- Read: admins see all rows.
DROP POLICY IF EXISTS "admin_read_all_audit_logs" ON public.audit_logs;
CREATE POLICY "admin_read_all_audit_logs"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (public.current_user_role() = 'admin');

-- Read: users see rows where they are the actor or the subject.
DROP POLICY IF EXISTS "authenticated_read_own_audit_logs" ON public.audit_logs;
CREATE POLICY "authenticated_read_own_audit_logs"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (
    actor_user_id = auth.uid()::text
    OR target_user_id = auth.uid()::text
  );
