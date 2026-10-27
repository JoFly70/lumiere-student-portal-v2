-- S22: restore the active-account check on the RLS helper functions, and close anon EXECUTE on
-- assistant_purge_active().
--
-- Why: 20261030100000_s18_billing_ledger.sql runs CREATE OR REPLACE is_staff_or_admin() WITHOUT the
-- active-account check that scripts/release/s14/30-account-gate.sql installs, so a deactivated staff
-- or admin account kept staff-level RLS access through PostgREST. 20261102100000_s21_assistant_conversations.sql
-- creates assistant_purge_active() after the client-privilege hardening, so PUBLIC/anon could execute it.
-- Forward fix (applied migrations are not edited). Definitions are those of 30-account-gate.sql.
-- Idempotent; additive; no data change. Requires public.users and public.profiles.
BEGIN;

CREATE OR REPLACE FUNCTION public.current_user_is_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid()::text AND p.status = 'active'); $$;
REVOKE EXECUTE ON FUNCTION public.current_user_is_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_active() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT u.role::text FROM public.users u WHERE u.id = auth.uid()::text AND public.current_user_is_active() $$;

CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()::text AND role IN ('staff', 'admin'))
          AND public.current_user_is_active(); $$;

CREATE OR REPLACE FUNCTION public.student_owns_record(p_student_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id AND user_id = auth.uid()::text)
          AND public.current_user_is_active(); $$;

DO $$
BEGIN
  IF to_regprocedure('public.assistant_purge_active()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.assistant_purge_active() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.assistant_purge_active() TO authenticated, service_role;
  END IF;
END
$$;

COMMIT;
