-- S03 security remediation — DISPOSABLE ENVIRONMENT ONLY.
--
-- NOT A PRODUCTION MIGRATION. This file is written against the S02
-- *reconstructed* schema (see README.md). The production schema is unverified;
-- table names, policies and grants there may differ. Before anything here is
-- considered for production it must be re-derived against a verified
-- production schema dump and reviewed.
--
-- Principle: the browser never queries Postgres or Storage directly (all data
-- access goes through the Express server using the service role), so anon and
-- authenticated receive only what the canonical policies already require.
--
-- Idempotent: safe to re-run on the disposable database.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Account status helper. An account is usable only when it has a profile
--    row whose status is 'active' (archived / inactive / pending are denied,
--    and a missing profile fails closed).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = auth.uid()::text
       AND p.status = 'active'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.current_user_is_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_active() TO authenticated, service_role;

-- Role helpers return no role / false for non-active accounts, so every
-- policy built on them denies archived or disabled users.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.role::text FROM public.users u
   WHERE u.id = auth.uid()::text
     AND public.current_user_is_active()
$$;

CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()::text AND role IN ('staff', 'admin'))
     AND public.current_user_is_active();
$$;

CREATE OR REPLACE FUNCTION public.student_owns_record(p_student_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id AND user_id = auth.uid()::text)
     AND public.current_user_is_active();
$$;

-- ---------------------------------------------------------------------------
-- 2. Reconstructed legacy / supplement tables that had RLS disabled and full
--    anon + authenticated privileges. Enable RLS with no client policies and
--    remove all client-role privileges. The server (service role) is the only
--    access path.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  legacy text[] := ARRAY[
    'course_templates', 'courses_catalog', 'duration_rules', 'enrollments',
    'exam_catalog', 'financial_rules', 'metrics', 'payments',
    'plan_financials', 'plans', 'pricing_rules', 'programs', 'providers',
    'snapshots_weekly', 'student_audit_log', 'student_contacts',
    'student_documents', 'student_english_proof',
    -- RLS already on, zero policies, but client grants present:
    'ticket_attachments', 'ticket_status_history'
  ];
BEGIN
  FOREACH t IN ARRAY legacy LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
      EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Anonymous role: no table privileges anywhere in public. Policies on
--    these tables are all TO authenticated, so this removes no working path.
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Future tables created by the migration owner start with no client grants.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- Trigger / utility functions are not an RPC surface.
DO $$
DECLARE
  f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN (
         'generate_student_code', 'student_cp_cross_binding_guard',
         'student_cp_guard_immutable_history', 'student_cp_guard_lifecycle',
         'student_cp_guard_terminal_updates', 'student_cp_validate_lifecycle_graph',
         'update_pricing_rules_timestamp', 'update_weekly_metrics_timestamp',
         'validate_english_requirement')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Coach role. There is no coach-assignment table in this schema, so a
--    coach cannot be scoped to assigned students; coach is removed from
--    blanket student/document/user/profile/metrics access. Coaches keep
--    access to support tickets assigned to them (assigned_to clause).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can view all users" ON public.users;
CREATE POLICY "Staff can view all users" ON public.users
  FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS "Users can view own record" ON public.users;
CREATE POLICY "Users can view own record" ON public.users
  FOR SELECT TO authenticated
  USING (id::text = (SELECT auth.uid()::text) AND public.current_user_is_active());

DROP POLICY IF EXISTS "Staff can manage students" ON public.students;
CREATE POLICY "Staff can manage students" ON public.students
  FOR ALL TO authenticated
  USING (public.current_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.current_user_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS "Students can view own profile" ON public.students;
CREATE POLICY "Students can view own profile" ON public.students
  FOR SELECT TO authenticated
  USING ((user_id = (SELECT auth.uid()::text) AND public.current_user_is_active())
         OR public.current_user_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS "Staff can manage documents" ON public.documents;
CREATE POLICY "Staff can manage documents" ON public.documents
  FOR ALL TO authenticated
  USING (public.current_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.current_user_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS "Students can view own documents" ON public.documents;
CREATE POLICY "Students can view own documents" ON public.documents
  FOR SELECT TO authenticated
  USING (public.student_owns_record(student_id::text)
         OR public.current_user_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS "Staff can view profiles" ON public.profiles;
CREATE POLICY "Staff can view profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS "Users can view own metrics" ON public.weekly_metrics;
CREATE POLICY "Users can view own metrics" ON public.weekly_metrics
  FOR SELECT TO authenticated
  USING ((user_id::text = (SELECT auth.uid()::text) AND public.current_user_is_active())
         OR public.current_user_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS "Users can manage own metrics" ON public.weekly_metrics;
CREATE POLICY "Users can manage own metrics" ON public.weekly_metrics
  FOR ALL TO authenticated
  USING (user_id::text = (SELECT auth.uid()::text) AND public.current_user_is_active())
  WITH CHECK (user_id::text = (SELECT auth.uid()::text) AND public.current_user_is_active());

DROP POLICY IF EXISTS "Staff can update tickets" ON public.support_tickets;
CREATE POLICY "Staff can update tickets" ON public.support_tickets
  FOR UPDATE TO authenticated
  USING (public.current_user_role() IN ('admin', 'staff')
         OR (assigned_to = (SELECT auth.uid()::text) AND public.current_user_role() = 'coach'))
  WITH CHECK (public.current_user_role() IN ('admin', 'staff')
         OR (assigned_to = (SELECT auth.uid()::text) AND public.current_user_role() = 'coach'));

DROP POLICY IF EXISTS "Users can view own tickets" ON public.support_tickets;
CREATE POLICY "Users can view own tickets" ON public.support_tickets
  FOR SELECT TO authenticated
  USING (((reporter_id = (SELECT auth.uid()::text) OR assigned_to = (SELECT auth.uid()::text))
          AND public.current_user_is_active())
         OR public.current_user_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS "Users can create tickets" ON public.support_tickets;
CREATE POLICY "Users can create tickets" ON public.support_tickets
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = (SELECT auth.uid()::text) AND public.current_user_is_active());

DROP POLICY IF EXISTS "Users can view ticket comments" ON public.ticket_comments;
CREATE POLICY "Users can view ticket comments" ON public.ticket_comments
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_active()
    AND EXISTS (
      SELECT 1 FROM public.support_tickets st
       WHERE st.id = ticket_comments.ticket_id
         AND (st.reporter_id = (SELECT auth.uid()::text)
              OR st.assigned_to = (SELECT auth.uid()::text)
              OR public.current_user_role() IN ('admin', 'staff')))
    AND (is_internal = false OR public.current_user_role() IN ('admin', 'staff', 'coach'))
  );

DROP POLICY IF EXISTS "Users can create comments" ON public.ticket_comments;
CREATE POLICY "Users can create comments" ON public.ticket_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_is_active()
    AND EXISTS (
      SELECT 1 FROM public.support_tickets st
       WHERE st.id = ticket_comments.ticket_id
         AND (st.reporter_id = (SELECT auth.uid()::text)
              OR st.assigned_to = (SELECT auth.uid()::text)
              OR public.current_user_role() IN ('admin', 'staff')))
  );

-- ---------------------------------------------------------------------------
-- 5. Profiles: a user may read their own row but may only change contact
--    preferences, never status (which gates account access).
-- ---------------------------------------------------------------------------
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (timezone, phone) ON public.profiles TO authenticated;
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles FROM authenticated;

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()::varchar) AND status = 'active')
  WITH CHECK (user_id = (SELECT auth.uid()::varchar) AND status = 'active');

-- ---------------------------------------------------------------------------
-- 6. Invitation-only account creation. Service role only; tokens are stored
--    as SHA-256 hashes and are single-use.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'student' CHECK (role = 'student'),
  created_by varchar REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  consumed_at timestamptz,
  consumed_by varchar REFERENCES public.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  CONSTRAINT account_invitations_email_lower CHECK (email = lower(email)),
  CONSTRAINT account_invitations_expiry_after_create CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS account_invitations_email_idx ON public.account_invitations (email);
ALTER TABLE public.account_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_invitations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.account_invitations TO service_role;

COMMIT;
